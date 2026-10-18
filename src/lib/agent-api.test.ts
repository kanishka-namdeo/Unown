// Unit tests for src/lib/agent-api.ts (engine fetch client, pure parts).
//
// Backlog reference: docs/testing-strategy.md §4.1 asks for coverage of
// `apiUrl()` DIRECT vs GATEWAY branch logic, `ApiError` mapping in
// getJson/postJson (non-2xx -> ApiError{status}, 409 surfaces `data.error`,
// network throw -> clean error), and query-key stability of `qk.*`.
//
// Strategy — no new dependencies, `bun test` only (bun:test is built in):
//
// 1. `getJson`/`postJson` are module-private, so their error mapping is
//    exercised through the exported `api`/`mutations` facades with
//    `globalThis.fetch` monkey-patched (restored in `afterAll`). The stub
//    records every (url, init) and builds a *fresh* Response per call, so
//    bodies can be consumed repeatedly.
// 2. `RAW_BASE`/`DIRECT` are computed once at module load from
//    `NEXT_PUBLIC_AGENT_API_BASE`, so the two deployment modes need separate
//    module evaluations: the test sets the env var and re-imports the module
//    under a query-suffixed specifier (`./agent-api?direct`), which Bun
//    treats as a distinct module and re-evaluates. The ambient env is
//    restored right after (it is `""` in .env, i.e. GATEWAY).
//
// A few assertions pin down *quirks* rather than ideal behavior; each is
// marked with a `QUIRK`/`BUG` comment. The source module is not modified.

import { afterAll, describe, expect, test } from "bun:test"

type AgentApi = typeof import("./agent-api")

const ORIG_BASE = process.env.NEXT_PUBLIC_AGENT_API_BASE

// Load a second, independent evaluation of agent-api with the given env value
// (query suffix busts Bun's module cache). Non-literal specifier on purpose:
// TypeScript must not try to resolve "./agent-api?<bust>" as a path.
async function loadInstance(
  envValue: string | undefined,
  bust: string,
): Promise<AgentApi> {
  if (envValue === undefined) delete process.env.NEXT_PUBLIC_AGENT_API_BASE
  else process.env.NEXT_PUBLIC_AGENT_API_BASE = envValue
  return import(`./agent-api?${bust}`) as Promise<AgentApi>
}

// Default (GATEWAY) instance: env cleared before the module evaluates.
delete process.env.NEXT_PUBLIC_AGENT_API_BASE
const gateway: AgentApi = await import("./agent-api")

const direct = await loadInstance("http://direct.example:9000", "direct")
const padded = await loadInstance("  http://trim.example:9//  ", "padded")
const blank = await loadInstance("   ", "blank")

// Restore ambient env for anything that runs after this file.
if (ORIG_BASE === undefined) delete process.env.NEXT_PUBLIC_AGENT_API_BASE
else process.env.NEXT_PUBLIC_AGENT_API_BASE = ORIG_BASE

// ---------------------------------------------------------------------------
// fetch stub
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string
  init: RequestInit | undefined
}

const RESOLVED = "RESOLVED_UNEXPECTEDLY"
const realFetch = globalThis.fetch
const calls: FetchCall[] = []
// Fresh per call — a Response body can only be consumed once.
let makeResult: () => Response | Error = () => new Response("{}", { status: 200 })

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  calls.push({ url: String(input), init })
  const result = makeResult()
  if (result instanceof Error) throw result
  return result
}) as typeof fetch

afterAll(() => {
  globalThis.fetch = realFetch
})

// Await a promise, returning the rejection reason (or a sentinel if it
// resolved — the test then fails on the `not.toBe(RESOLVED)` assert).
async function rejectionOf<T>(p: Promise<T>): Promise<unknown> {
  try {
    await p
  } catch (err) {
    return err
  }
  return RESOLVED
}

function asApiError(err: unknown): InstanceType<typeof gateway.ApiError> {
  return err as InstanceType<typeof gateway.ApiError>
}

// ---------------------------------------------------------------------------
// apiUrl() — GATEWAY (default: no NEXT_PUBLIC_AGENT_API_BASE)
// ---------------------------------------------------------------------------

describe("apiUrl (GATEWAY mode)", () => {
  test("bare path carries the sandbox gateway port param", () => {
    expect(gateway.apiUrl("/api/overview")).toBe("/api/overview?XTransformPort=3030")
  })

  test("params are appended after XTransformPort, numbers stringified", () => {
    expect(gateway.apiUrl("/api/runs", { limit: 200, kind: "cycle" })).toBe(
      "/api/runs?XTransformPort=3030&limit=200&kind=cycle",
    )
  })

  test("undefined params are skipped; 0 is kept", () => {
    expect(gateway.apiUrl("/api/runs", { task: undefined, limit: 0 })).toBe(
      "/api/runs?XTransformPort=3030&limit=0",
    )
  })

  test("EVENTS_URL points at the engine's SSE route via the gateway", () => {
    expect(gateway.EVENTS_URL).toBe("/api/events?XTransformPort=3030")
  })
})

// ---------------------------------------------------------------------------
// apiUrl() — DIRECT (NEXT_PUBLIC_AGENT_API_BASE set)
// ---------------------------------------------------------------------------

describe("apiUrl (DIRECT mode)", () => {
  test("absolute URLs against the configured base, no XTransformPort", () => {
    expect(direct.apiUrl("/api/overview")).toBe("http://direct.example:9000/api/overview")
    expect(direct.apiUrl("/api/runs", { limit: 5 })).toBe(
      "http://direct.example:9000/api/runs?limit=5",
    )
  })

  test("EVENTS_URL is absolute in DIRECT mode", () => {
    expect(direct.EVENTS_URL).toBe("http://direct.example:9000/api/events")
  })

  test("base is trimmed and trailing slashes are stripped", () => {
    // "  http://trim.example:9//  " -> "http://trim.example:9"
    expect(padded.apiUrl("/api/overview")).toBe("http://trim.example:9/api/overview")
  })

  test("QUIRK: whitespace-only base env falls back to GATEWAY", () => {
    // RAW_BASE trims to "" and DIRECT is `length > 0`, so a blank value
    // behaves exactly like an unset one.
    expect(blank.apiUrl("/api/x")).toBe("/api/x?XTransformPort=3030")
  })
})

// ---------------------------------------------------------------------------
// getJson error mapping (via api.* — getJson is module-private)
// ---------------------------------------------------------------------------

describe("getJson (via api facade)", () => {
  test("2xx returns the parsed body; request is no-store via apiUrl()", async () => {
    calls.length = 0
    makeResult = () => new Response(JSON.stringify({ hello: "world" }), { status: 200 })
    const data = await gateway.api.overview()
    expect(data as unknown).toEqual({ hello: "world" })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe("/api/overview?XTransformPort=3030")
    expect(calls[0]?.init).toEqual({ cache: "no-store" })
  })

  test("non-2xx -> ApiError with status and a generic path message", async () => {
    calls.length = 0
    makeResult = () =>
      new Response(JSON.stringify({ error: "kaboom" }), { status: 500 })
    const err = await rejectionOf(gateway.api.overview())
    expect(err).not.toBe(RESOLVED)
    expect(err).toBeInstanceOf(gateway.ApiError)
    expect(asApiError(err).status).toBe(500)
    expect(asApiError(err).message).toBe("GET /api/overview failed (500)")
    // QUIRK: getJson never reads the error body — a JSON `error` field from a
    // GET failure is discarded (only postJson surfaces it).
    expect(asApiError(err).message).not.toContain("kaboom")
  })

  test("404 is mapped the same way (status carried through)", async () => {
    makeResult = () => new Response("nope", { status: 404 })
    const err = await rejectionOf(gateway.api.run("missing-id"))
    expect(err).toBeInstanceOf(gateway.ApiError)
    expect(asApiError(err).status).toBe(404)
    expect(asApiError(err).message).toBe("GET /api/runs/missing-id failed (404)")
  })

  test("network throw -> the raw fetch error propagates, unwrapped", async () => {
    // QUIRK: network failures are NOT mapped to ApiError — getJson has no
    // try/catch, so react-query's retry/onError sees the original TypeError
    // (i.e. a "clean" error: not swallowed, not double-wrapped).
    const boom = new TypeError("fetch failed")
    makeResult = () => boom
    const err = await rejectionOf(gateway.api.overview())
    expect(err).toBe(boom)
    expect(err).not.toBeInstanceOf(gateway.ApiError)
  })
})

// ---------------------------------------------------------------------------
// postJson error mapping (via mutations.* — postJson is module-private)
// ---------------------------------------------------------------------------

describe("postJson (via mutations facade)", () => {
  test("2xx returns the parsed body; POST + JSON headers + JSON body", async () => {
    calls.length = 0
    makeResult = () => new Response(JSON.stringify({ started: true }), { status: 200 })
    const data = await gateway.mutations.prompt("hello world")
    expect(data).toEqual({ started: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe("/api/agent/prompt?XTransformPort=3030")
    expect(calls[0]?.init?.method).toBe("POST")
    expect(calls[0]?.init?.headers).toEqual({ "Content-Type": "application/json" })
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ prompt: "hello world" }))
  })

  test("body-less mutations send no body", async () => {
    calls.length = 0
    makeResult = () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    await gateway.mutations.skillRetire("skill-1")
    expect(calls[0]?.init?.body).toBeUndefined()
    expect(calls[0]?.url).toBe("/api/skills/skill-1/retire?XTransformPort=3030")
  })

  test("409 surfaces the body's error field (engine busy)", async () => {
    // The dashboard's busy-mutex UX depends on this: the engine answers 409
    // with { error: "..." } and the toast shows exactly that string.
    makeResult = () =>
      new Response(
        JSON.stringify({ error: "engine busy: a run is already in progress" }),
        { status: 409 },
      )
    const err = await rejectionOf(gateway.mutations.prompt("go"))
    expect(err).toBeInstanceOf(gateway.ApiError)
    expect(asApiError(err).status).toBe(409)
    expect(asApiError(err).message).toBe("engine busy: a run is already in progress")
  })

  test("non-2xx without a JSON body -> generic path message", async () => {
    // res.json() rejects on plain-text bodies; postJson catches and falls
    // back to `{}` so the message must come from the path + status.
    makeResult = () => new Response("Internal Server Error", { status: 500 })
    const err = await rejectionOf(gateway.mutations.dreamRun())
    expect(err).toBeInstanceOf(gateway.ApiError)
    expect(asApiError(err).status).toBe(500)
    expect(asApiError(err).message).toBe("POST /api/dreams/run failed (500)")
  })

  test("non-2xx JSON body without an error field -> generic path message", async () => {
    makeResult = () => new Response(JSON.stringify({ ok: false }), { status: 502 })
    const err = await rejectionOf(gateway.mutations.jobTrigger("job-1"))
    expect(err).toBeInstanceOf(gateway.ApiError)
    expect(asApiError(err).status).toBe(502)
    expect(asApiError(err).message).toBe("POST /api/jobs/job-1/trigger failed (502)")
  })

  test("network throw -> the raw fetch error propagates, unwrapped", async () => {
    const boom = new Error("socket hang up")
    makeResult = () => boom
    const err = await rejectionOf(gateway.mutations.prompt("go"))
    expect(err).toBe(boom)
    expect(err).not.toBeInstanceOf(gateway.ApiError)
  })
})

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------

describe("ApiError", () => {
  test("is an Error carrying a numeric status", () => {
    const e = new gateway.ApiError(503, "service unavailable")
    expect(e).toBeInstanceOf(Error)
    expect(e.status).toBe(503)
    expect(e.message).toBe("service unavailable")
  })
})

// ---------------------------------------------------------------------------
// qk — react-query query keys
// ---------------------------------------------------------------------------

describe("qk (query keys)", () => {
  test("static keys are pinned exactly (invalidation contract)", () => {
    // providers.tsx invalidations() only works while these arrays match what
    // the tab hooks use — pin every key's exact shape.
    expect(gateway.qk.overview).toEqual(["overview"])
    expect(gateway.qk.tasks).toEqual(["tasks"])
    expect(gateway.qk.runs).toEqual(["runs"])
    expect(gateway.qk.memory).toEqual(["memory"])
    expect(gateway.qk.cycles).toEqual(["cycles"])
    expect(gateway.qk.improvements).toEqual(["improvements"])
    expect(gateway.qk.dreams).toEqual(["dreams"])
    expect(gateway.qk.hooks).toEqual(["hooks"])
    expect(gateway.qk.notes).toEqual(["notes"])
    expect(gateway.qk.jobs).toEqual(["jobs"])
    expect(gateway.qk.sandboxes).toEqual(["sandboxes"])
    expect(gateway.qk.skills).toEqual(["skills"])
    expect(gateway.qk.bridge).toEqual(["bridge"])
  })

  test("factory keys are stable: same input -> same serialized key", () => {
    expect(JSON.stringify(gateway.qk.run("abc"))).toBe(JSON.stringify(gateway.qk.run("abc")))
    expect(JSON.stringify(gateway.qk.run("abc"))).toBe('["run","abc"]')
    expect(JSON.stringify(gateway.qk.memoryHistory("policy"))).toBe(
      '["memory-history","policy"]',
    )
    expect(JSON.stringify(gateway.qk.dreamNotes("d7"))).toBe('["dream-notes","d7"]')
  })

  test("factory keys: different inputs never collide", () => {
    expect(JSON.stringify(gateway.qk.run("a"))).not.toBe(JSON.stringify(gateway.qk.run("b")))
    expect(JSON.stringify(gateway.qk.memoryHistory("user"))).not.toBe(
      JSON.stringify(gateway.qk.memoryHistory("project")),
    )
    expect(JSON.stringify(gateway.qk.dreamNotes("d1"))).not.toBe(
      JSON.stringify(gateway.qk.dreamNotes("d2")),
    )
  })

  test("every key is a flat array of strings (react-query hashable)", () => {
    const keys: readonly (readonly unknown[])[] = [
      gateway.qk.overview,
      gateway.qk.tasks,
      gateway.qk.runs,
      gateway.qk.memory,
      gateway.qk.cycles,
      gateway.qk.improvements,
      gateway.qk.dreams,
      gateway.qk.hooks,
      gateway.qk.notes,
      gateway.qk.jobs,
      gateway.qk.sandboxes,
      gateway.qk.skills,
      gateway.qk.bridge,
      gateway.qk.run("r"),
      gateway.qk.memoryHistory("local"),
      gateway.qk.dreamNotes("d"),
    ]
    for (const key of keys) {
      expect(Array.isArray(key)).toBe(true)
      expect(key.every((k) => typeof k === "string")).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Automations client surface (queries + the PATCH/DELETE mutation verbs)
// ---------------------------------------------------------------------------

describe("automations client surface", () => {
  test("api.automations GETs the automations list", async () => {
    calls.length = 0
    makeResult = () => new Response(JSON.stringify({ automations: [] }), { status: 200 })
    await gateway.api.automations()
    expect(calls[0]?.url).toBe("/api/automations?XTransformPort=3030")
    expect(calls[0]?.init).toEqual({ cache: "no-store" })
  })

  test("api.automationRuns GETs the per-automation run history with limit", async () => {
    calls.length = 0
    makeResult = () => new Response(JSON.stringify({ runs: [] }), { status: 200 })
    await gateway.api.automationRuns("auto-1", 5)
    expect(calls[0]?.url).toBe("/api/automations/auto-1/runs?XTransformPort=3030&limit=5")
  })

  test("automationCreate POSTs the create body", async () => {
    calls.length = 0
    makeResult = () => new Response(JSON.stringify({ automation: { id: "a1" } }), { status: 200 })
    await gateway.mutations.automationCreate({ title: "t", prompt: "p", cron: "0 9 * * *" })
    expect(calls[0]?.init?.method).toBe("POST")
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ title: "t", prompt: "p", cron: "0 9 * * *" }))
    expect(calls[0]?.url).toBe("/api/automations?XTransformPort=3030")
  })

  test("automationPatch sends PATCH with the patch body", async () => {
    calls.length = 0
    makeResult = () => new Response(JSON.stringify({ automation: { id: "a1" } }), { status: 200 })
    await gateway.mutations.automationPatch("a1", { lifecycle: "paused" })
    expect(calls[0]?.init?.method).toBe("PATCH")
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ lifecycle: "paused" }))
    expect(calls[0]?.url).toBe("/api/automations/a1?XTransformPort=3030")
  })

  test("automationDelete sends DELETE with an empty JSON body", async () => {
    calls.length = 0
    makeResult = () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    await gateway.mutations.automationDelete("a1")
    expect(calls[0]?.init?.method).toBe("DELETE")
    expect(calls[0]?.init?.body).toBe(JSON.stringify({}))
    expect(calls[0]?.url).toBe("/api/automations/a1?XTransformPort=3030")
  })

  test("automationRunNow POSTs the run-now route body-less", async () => {
    calls.length = 0
    makeResult = () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    await gateway.mutations.automationRunNow("a1")
    expect(calls[0]?.init?.method).toBe("POST")
    expect(calls[0]?.init?.body).toBeUndefined()
    expect(calls[0]?.url).toBe("/api/automations/a1/run?XTransformPort=3030")
  })
})
