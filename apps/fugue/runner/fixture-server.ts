/**
 * fixture-server.ts — F-3's stub engine (PLAN §5: fixed port 4130,
 * FUGUE_FIXTURE_PORT override; zero runtime deps — Bun.serve).
 *
 * Serves the F-2 contract fixtures on the pinned engine routes, with
 * an in-memory store that PERSISTS across restarts within one process
 * (the E-03 ruling: a routine created before a "restart" re-syncs by
 * id after the server comes back — the store is module-level, not
 * per-server).
 *
 * Configurable failure modes for the error-path tests:
 *   - setAuth(true)          -> 401 on every /api route (EngineLocked)
 *   - setFailure(503)        -> the next /api call answers 503
 *   - setPayload(endpoint, p)-> the next matching GET answers p verbatim
 *
 * CORS is browser-ready (origin-echo + preflight), mirroring the real
 * engine's posture so the PWA's direct-call path is exercised too.
 */
import {
  CONTRACT_FIXTURES,
  DREAMS_LIVE_FIXTURE,
  DREAM_FIXTURE,
  MEMORIES_FIXTURE,
  MEMORY_LIVE_FIXTURE,
  MEMORY_HEALTH_LIVE_FIXTURE,
  NOTE_FIXTURE,
  OVERVIEW_FIXTURE,
  RUN_FIXTURE,
  SPEND_FIXTURE,
} from "../src/adapter/contract.js";

/** Module-level store: survives close() within one process. */
interface FixtureStore {
  automations: Record<string, Record<string, unknown>>;
  nextAutoId: number;
  nextRunId: number;
  /** Simulated restart counter (E-03 re-sync evidence). */
  restarts: number;
}
const store: FixtureStore = {
  automations: {},
  nextAutoId: 3, // fixtures carry ids 1 and 2
  nextRunId: 13, // fixtures carry run ids 11 and 12
  restarts: 0,
};

type FailureMode = 503 | null;

export interface FixtureServerOpts {
  port?: number; // default 4130 (FUGUE_FIXTURE_PORT wins)
  /** Re-seed the module store from CONTRACT_FIXTURES (the first
   *  server in a process; "restarts" inherit the mutated store). */
  reseed?: boolean;
}

export interface FixtureServer {
  port: number;
  close(): Promise<void>;
  setAuth(locked: boolean): void;
  setFailure(code: FailureMode): void;
  setPayload(
    endpoint: "automations" | "runs" | "overview" | "dreams" | "notes" | "memories" | "spend",
    payload: { status: number; body: unknown },
  ): void;
  handle(method: string, path: string, url: URL, req: Request): Promise<{ status: number; body: unknown }>;
  mutations(): { restarts: number; store: FixtureStore };
}

export function startFixtureServer(opts: FixtureServerOpts = {}): FixtureServer {
  const port = opts.port ?? Number(process.env.FUGUE_FIXTURE_PORT ?? 4130);
  if (opts.reseed) reseed();

  let authLocked = false;
  let failure: FailureMode = null;
  let payloadOverride: { status: number; body: unknown } | null = null;
  let payloadEndpoint: string | null = null;

  const serve = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      // CORS preflight — the browser PWA's OPTIONS probe.
      if (method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: { ...corsHeaders(req), "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS" },
        });
      }

      const out = await handle(method, path, url, req);
      if (out.status === 204) {
        return new Response(null, { status: 204, headers: corsHeaders(req) });
      }
      return new Response(JSON.stringify(out.body), {
        status: out.status,
        headers: { "content-type": "application/json", ...corsHeaders(req) },
      });
    },
  });

  /** The per-request pipeline (auth gate -> failure mode -> scripted
   *  payload -> the route table). Exported on the returned object so
   *  tests can reach it without the network hop. */
  async function handle(method: string, path: string, url: URL, req: Request): Promise<{ status: number; body: unknown }> {
    if (authLocked && path.startsWith("/api/")) {
      return { status: 401, body: { error: "unauthorized" } };
    }
    if (failure !== null && path.startsWith("/api/")) {
      const code = failure;
      failure = null; // one-shot, like the real error paths
      return { status: code, body: { error: `fixture failure mode ${code}` } };
    }
    // The scripted payload wins over the canned store (one-shot).
    if (payloadOverride !== null) {
      const ep = payloadEndpoint;
      const out = payloadOverride;
      payloadOverride = null;
      payloadEndpoint = null;
      if (ep === "automations" && path === "/api/automations" && method === "GET") return out;
      if (ep === "overview" && path === "/api/overview" && method === "GET") return out;
    }
    return route(method, path, url, req);
  }

  return {
    port: serve.port,
    close: async () => {
      serve.stop(true);
      store.restarts += 1; // the restart the E-03 test then proves
    },
    setAuth(locked: boolean) {
      authLocked = locked;
    },
    setFailure(code: FailureMode) {
      failure = code;
    },
    setPayload(endpoint: string, payload: { status: number; body: unknown }) {
      payloadEndpoint = endpoint;
      payloadOverride = payload;
    },
    handle,
    mutations() {
      return { restarts: store.restarts, store };
    },
  };
}

/** Seed the module store from the F-2 fixtures (ids stay numeric). */
function reseed(): void {
  store.automations = {};
  for (const row of CONTRACT_FIXTURES.automations) {
    store.automations[String(row.id)] = structuredClone(row);
  }
  store.nextAutoId = 3;
  store.nextRunId = 13;
}

/** Read the JSON request body ({} when absent / not an object). */
async function safeBody(req: Request | null): Promise<Record<string, unknown>> {
  if (!req) return {};
  try {
    const text = await req.text();
    if (!text) return {};
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The loopback echo of the real engine's CORS posture. */
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "Content-Type, Authorization",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

/** The route table — verbs + payloads pinned from server.ts. */
async function route(
  method: string,
  path: string,
  url: URL,
  req: Request,
): Promise<{ status: number; body: unknown }> {
  if (method === "GET" && path === "/api/overview")
    return { status: 200, body: structuredClone(OVERVIEW_FIXTURE) };
  if (method === "GET" && path === "/api/automations")
    return { status: 200, body: { automations: Object.values(store.automations) } };
  if (method === "POST" && path === "/api/automations") {
    const body = await safeBody(req);
    const id = store.nextAutoId++;
    const now = Date.now();
    const row: Record<string, unknown> = {
      id,
      title: String(body.title ?? "Untitled"),
      prompt: String(body.prompt ?? ""),
      schedule: describeSchedule(body),
      mode: body.mode === "standard" ? "standard" : "read-only",
      model: body.model != null ? String(body.model) : undefined,
      timezone: body.timezone != null ? String(body.timezone) : undefined,
      state: "active",
      created_at: now,
      updated_at: 0,
    };
    store.automations[id] = row;
    return { status: 201, body: { automation: row } };
  }

  // Reserved sub-routes on the /api/automations prefix — they win over
  // the per-id table below (the spend lane; per-id sub-paths never
  // collide with a literal reserved word).
  if (method === "GET" && path === "/api/automations/spend")
    return { status: 200, body: structuredClone(SPEND_FIXTURE) };

  const m = path.match(/^\/api\/automations\/([^/]+)(?:\/(run|runs|skip|snooze))?$/);
  if (m) {
    const id = m[1];
    const sub = m[2];
    const row = store.automations[id];
    if (sub === "run" && method === "POST") {
      if (!row) return { status: 404, body: { error: "unknown automation" } };
      const run = {
        id: String(store.nextRunId++),
        taskId: id,
        kind: "manual",
        status: "ok",
        startedAt: "2026-11-08T10:00:00Z",
        endedAt: "2026-11-08T10:00:04Z",
        tokensIn: 100,
        tokensOut: 25,
        toolCalls: 1,
        turns: 1,
        error: null,
      };
      row.state = row.state; // untouched — the run is synthetic
      return { status: 200, body: { ok: true, run } };
    }
    if (sub === "skip" && method === "POST") {
      if (!row) return { status: 404, body: { error: "unknown automation" } };
      return { status: 200, body: { automation: row } };
    }
    if (sub === "snooze" && method === "POST") {
      if (!row) return { status: 404, body: { error: "unknown automation" } };
      return { status: 200, body: { automation: row } };
    }
    if (sub === "runs" && method === "GET") {
      if (!row) return { status: 404, body: { error: "unknown automation" } };
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const runs = structuredClone(RUN_FIXTURE).filter((r) => String(r.taskId) === id);
      return { status: 200, body: { runs: runs.slice(0, limit) } };
    }
    if (method === "GET") {
      if (!row) return { status: 404, body: { error: "unknown automation" } };
      return { status: 200, body: { automation: row } };
    }
    if (method === "PATCH") {
      if (!row) return { status: 404, body: { error: "unknown automation" } };
      const body = await safeBody(req);
      const patch: Record<string, unknown> = {};
      for (const k of ["title", "prompt", "mode", "model", "lifecycle", "cron", "every", "after", "timezone", "misfire"] as const) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      if (patch.lifecycle === "active" || patch.lifecycle === "paused") {
        row.state = patch.lifecycle;
        row.lifecycle = patch.lifecycle;
      }
      for (const [k, v] of Object.entries(patch)) if (k !== "lifecycle") row[k] = v;
      return { status: 200, body: { automation: row } };
    }
    if (method === "DELETE") {
      if (!row) return { status: 404, body: { error: "unknown automation" } };
      delete store.automations[id];
      return { status: 200, body: { ok: true } };
    }
  }

  if (method === "GET" && path === "/api/runs") {
    const limit = Number(url.searchParams.get("limit") ?? 20);
    return { status: 200, body: { runs: structuredClone(RUN_FIXTURE).slice(0, limit) } };
  }
  if (method === "GET" && path === "/api/dreams")
    // F-7 chunk 2 (V-24): the fixture now serves the LIVE wire form
    // (the operator's verbatim capture, done + gated + running) — the
    // real engine's shape. The fixture lane's camelCase rows stay
    // admitted in the pins; the server's answer is the live truth.
    return { status: 200, body: { dreams: structuredClone(DREAMS_LIVE_FIXTURE.dreams) } };
  // The F-7 chunk 2 memory lane: /api/memory (the tiers array) and
  // /api/memory/health (the health + platform objects) — the rest
  // adapter's memories() merges both into the MemoryView.
  if (method === "GET" && path === "/api/memory")
    return { status: 200, body: structuredClone(MEMORY_LIVE_FIXTURE) };
  if (method === "GET" && path === "/api/memory/health")
    return { status: 200, body: structuredClone(MEMORY_HEALTH_LIVE_FIXTURE) };
  if (method === "GET" && path === "/api/notes") {
    const limit = Number(url.searchParams.get("limit") ?? 40);
    return { status: 200, body: { notes: structuredClone(NOTE_FIXTURE).slice(0, limit) } };
  }
  return { status: 404, body: { error: `no fixture route ${method} ${path}` } };
}

/** The fixture's POST create body -> a five-kind schedule spec. */
function describeSchedule(body: Record<string, unknown>): Record<string, unknown> {
  if (typeof body.cron === "string") return { kind: "cron", expr: body.cron };
  if (typeof body.every === "string") return { kind: "every", spec: body.every };
  if (typeof body.after === "string") return { kind: "after", spec: body.after };
  if (typeof body.delayMinutes === "number") return { kind: "once", delayMinutes: body.delayMinutes };
  if (typeof body.event === "string")
    return {
      kind: "event",
      name: body.event,
      ...(typeof body.filter === "string" ? { filter: body.filter } : {}),
    };
  return { kind: "every", spec: "1d" };
}
