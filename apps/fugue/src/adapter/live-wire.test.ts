/**
 * live-wire.test.ts — the dedicated live-wire pins (F-7 chunk 1b, GAP 3).
 *
 * Every body here is a VERBATIM operator-probe capture from the live
 * engine (GET /api/runs and GET /api/automations/:id/runs, live 2026-11-07):
 *   (a) the automation-scoped RUNNING row (epoch ms, string ids,
 *       tokens_in/out, turns, trigger_kind, automation_id)
 *   (b) a SUCCEEDED variant of that row (epoch ended_at, non-zero
 *       tokens/turns)
 *   (c) the global-lane 'passed' row (the learning loop's success
 *       spelling — GAP 2: status 'passed' must be admitted in the
 *       automation-run status lane and map to 'ok')
 *   (d) regression pins: the camelCase fixture form (kind / tokensIn /
 *       startedAt ISO or epoch) still passes both assertContract and
 *       mapRuns.
 *
 * Each live body: assertContract('runs', body) passes AND mapRuns(
 * body.runs) produces valid RunRecordView rows with the RAW string ids
 * passed through uncoerced (the governing tree's raw-passthrough
 * semantics).
 */
import { test, expect } from "bun:test";
import { assertContract } from "./contract.js";
import { mapRuns, mapSpend } from "./rest-adapter.js";

/** (a) the automation-scoped RUNNING row (verbatim operator probe). */
const RUNNING_ROW = {
  id: "auto-mw6ix1jn-2y160r:manual:5metcj",
  automation_id: "auto-mw6ix1jn-2y160r",
  trigger_kind: "manual",
  scheduled_at: null,
  status: "running",
  started_at: 1794063216958,
  ended_at: null,
  exit_code: null,
  output: null,
  error: null,
  turns: 0,
  tokens_in: 0,
  tokens_out: 0,
  delivered: null,
  attempt: 1,
  retry_of: null,
};

/** (b) the SUCCEEDED variant (epoch ended_at, non-zero tokens/turns). */
const SUCCEEDED_ROW = {
  ...RUNNING_ROW,
  status: "succeeded",
  ended_at: 1794063220012,
  exit_code: 0,
  output: "LANE_OK",
  turns: 2,
  tokens_in: 5100,
  tokens_out: 233,
};

/** (c) the global-lane 'passed' body (verbatim operator probe — GAP 2). */
const PASSED_BODY = {
  runs: [
    {
      id: "b3117dfc-61a8-4951-933f-dd85c5b89ee1",
      task_id: "fix-fizzbuzz",
      kind: "baseline",
      status: "passed",
      started_at: 1794062648865,
      ended_at: 1794062655106,
      tokens_in: 1980,
      tokens_out: 431,
      turns: 4,
      error: null,
    },
  ],
};

/** (c2) the operator's live re-probe of the global lane (2026-11-07)
 *  — the live /api/runs row re-verified after the GAP 2 cure: the
 *  'passed' spelling now carries extra optional engine fields
 *  (sandbox_id / cycle_id / improvement_id / tool_calls /
 *  sandbox_isolation) that the pin admits when present. */
const PASSED_LIVE_REPROBE = {
  runs: [
    {
      id: "4c4458a4-6b69-4ff6-91ed-fa759c801a6f",
      task_id: "fix-fizzbuzz",
      kind: "regression",
      status: "passed",
      started_at: 1794063964776,
      ended_at: 1794063969592,
      sandbox_id: "dream-canary-fix-fizzbuz-mw6jd2so-3154",
      cycle_id: null,
      improvement_id: null,
      tokens_in: 2664,
      tokens_out: 370,
      tool_calls: 4,
      turns: 4,
      error: null,
      sandbox_isolation: "bwrap",
    },
  ],
};

/** (d) the camelCase fixture regression row (ISO + epoch startedAt forms). */
const CAMEL_FIXTURE_ROWS = [
  {
    id: "11",
    taskId: "1",
    kind: "cron",
    status: "ok",
    startedAt: "2026-11-07T09:00:00Z",
    endedAt: "2026-11-07T09:04:32Z",
    tokensIn: 1200,
    tokensOut: 340,
    toolCalls: 4,
    turns: 5,
    error: null,
  },
  {
    id: "12",
    taskId: "2",
    kind: "every",
    status: "failed",
    startedAt: 1794068800000, // the epoch-number form
    endedAt: null,
    tokensIn: 800,
    tokensOut: 0,
    toolCalls: 1,
    turns: 2,
    error: "upstream 429: rate limit exceeded",
  },
];

test("live-wire (a): the automation-scoped RUNNING row passes assertContract('runs') and maps with raw string ids", () => {
  assertContract("runs", { runs: [RUNNING_ROW] });
  const [v] = mapRuns([RUNNING_ROW]);
  expect(v.id).toBe("auto-mw6ix1jn-2y160r:manual:5metcj");
  expect(v.taskId).toBe("auto-mw6ix1jn-2y160r");
  expect(v.kind).toBe("manual");
  expect(v.status).toBe("ok"); // running -> ok
  expect(v.endedAt).toBeNull(); // the open-run label
  expect(v.startedAt).toBe(String(1794063216958));
  expect(v.turns).toBe(0);
  expect(v.tokensIn).toBe(0);
});

test("live-wire (b): the SUCCEEDED variant maps to ok with the epoch endedAt", () => {
  assertContract("runs", { runs: [SUCCEEDED_ROW] });
  const [v] = mapRuns([SUCCEEDED_ROW]);
  expect(v.id).toBe("auto-mw6ix1jn-2y160r:manual:5metcj");
  expect(v.status).toBe("ok"); // succeeded -> ok
  expect(v.endedAt).toBe(1794063220012);
  expect(v.tokensIn).toBe(5100);
  expect(v.turns).toBe(2);
});

test("live-wire (c): the global-lane 'passed' body passes assertContract('runs') and maps to ok (GAP 2)", () => {
  // Before the cure this threw EngineDrift: 'passed' was in neither
  // RUN_STATUSES nor autoStatuses.
  assertContract("runs", PASSED_BODY);
  const [v] = mapRuns(PASSED_BODY.runs as unknown[]);
  expect(v.id).toBe("b3117dfc-61a8-4951-933f-dd85c5b89ee1");
  expect(v.taskId).toBe("fix-fizzbuzz");
  expect(v.status).toBe("ok"); // passed -> ok
  expect(v.endedAt).toBe(1794062655106);
  expect(v.tokensIn).toBe(1980);
  expect(v.tokensOut).toBe(431);
});

test("live-wire (c2): the operator's live re-probe 'passed' row (with extra optional fields) passes assertContract and maps to ok", () => {
  assertContract("runs", PASSED_LIVE_REPROBE);
  const [v] = mapRuns(PASSED_LIVE_REPROBE.runs as unknown[]);
  expect(v.id).toBe("4c4458a4-6b69-4ff6-91ed-fa759c801a6f");
  expect(v.taskId).toBe("fix-fizzbuzz");
  expect(v.status).toBe("ok"); // passed -> ok
  expect(v.endedAt).toBe(1794063969592);
  expect(v.tokensIn).toBe(2664);
  expect(v.toolCalls).toBe(4);
});

test("live-wire (d): the camelCase fixture form still passes assertContract('runs') and mapRuns", () => {
  assertContract("runs", { runs: CAMEL_FIXTURE_ROWS });
  const views = mapRuns(CAMEL_FIXTURE_ROWS as unknown[]);
  expect(views.length).toBe(2);
  expect(views[0].id).toBe("11"); // decimal-string round-trip
  expect(views[0].status).toBe("ok");
  expect(views[0].startedAt).toBe(
    String(Date.parse("2026-11-07T09:00:00Z")),
  );
  expect(views[1].id).toBe("12");
  expect(views[1].status).toBe("failed");
  expect(views[1].startedAt).toBe("1794068800000"); // the epoch form
  expect(views[1].error).toBe("upstream 429: rate limit exceeded");
});

/* — (e)(f)(g) the H-24 live catches, dual-laned 2026-11-07 —
 *    The refreshed-fixture lane (fixtures-live.test.ts, the recording
 *    from scripts/a1/fixture-refresh.mjs) caught THREE pins still
 *    pinned to the F-2 fixture fiction on the LIVE wire:
 *      (e) overview.version — the live wire carries a version OBJECT
 *          ({version, gitSha, bootedAt, pid, uptimeMs, api}), the pin
 *          demanded a bare string;
 *      (f) notes rows — the live wire is {id: uuid, run_id?, content,
 *          created_at (epoch), kind?, ...} with explicit nulls on
 *          absent optionals; the pin demanded {id: number, text, at};
 *      (g) spend — the live wire is {now, routines[], total{day,week,
 *          cap, throttledNow, drainAt}}; the pin demanded the six
 *          canned fields (and safeSpend() masked the drift — the spend
 *          panel was silently dead against the real engine).
 *    The bodies below are VERBATIM captures (the recording's rows);
 *    each asserts BOTH lanes: the live body passes, the fixture body
 *    still passes, and a deliberate mutation of the live body still
 *    drifts (the dual-lane never widens to nothing). */

/** (e) the live overview's version object (verbatim capture). */
const LIVE_OVERVIEW_VERSION = {
  version: "0.0.57",
  gitSha: "404b07ad",
  bootedAt: 1794080131241,
  pid: 2265,
  uptimeMs: 1501499,
  api: 1,
};

test("live-wire (e): the live overview version OBJECT passes (dual-lane); the bare string still passes; a wrong-typed version object drifts", () => {
  const liveOverview = { phase: "ready", pid: 2265, version: LIVE_OVERVIEW_VERSION };
  assertContract("overview", liveOverview);
  assertContract("overview", { phase: "ready", version: "engine.v1" }); // the fixture lane
  expect(() =>
    assertContract("overview", {
      phase: "ready",
      version: { gitSha: "x" }, // a version object with no version string
    }),
  ).toThrow(/version\.version/);
});

/** (f) the live notes row (verbatim capture — nulls and all). */
const LIVE_NOTE_ROW = {
  id: "4a0fb195-356d-4408-b7c4-3fd4f53c7fbf",
  run_id: "8bf8a96c-b321-45a1-ab72-3253ff72e671",
  content: "Run 8bf8a96c (baseline) on task fix-fizzbuzz: PASSED",
  created_at: 1794080695611,
  kind: "session",
  project_slug: null,
  project_path: null,
  dream_id: null,
};

test("live-wire (f): the live notes row (uuid id + content + epoch created_at + explicit nulls) passes; the fixture row still passes; mutations drift", () => {
  assertContract("notes", { notes: [LIVE_NOTE_ROW] });
  assertContract("notes", { notes: [{ id: 1, text: "Pinned the invariant.", at: "2026-11-06T12:00:00Z" }] });
  // a row with NO content lane (neither text nor content) is drift
  expect(() =>
    assertContract("notes", { notes: [{ ...LIVE_NOTE_ROW, content: 42 }] }),
  ).toThrow(/notes\[0\]\.text/);
  // a row with NO timestamp lane (neither at nor created_at) is drift
  const { created_at, ...noTs } = LIVE_NOTE_ROW;
  void created_at;
  expect(() => assertContract("notes", { notes: [noTs] })).toThrow(/notes\[0\]\.at/);
});

/** (g) the live spend body (verbatim capture). */
const LIVE_SPEND_BODY = {
  now: 1794081632767,
  routines: [
    {
      id: "auto-mw6tvrfk-7br7ac",
      title: "FIXTURE_REFRESH_20261107200032",
      spend_cap: null,
      day: { tokens: 0, runs: 0, turns: 0 },
      week: { tokens: 0, runs: 0, turns: 0 },
      effective_cap: null,
      throttled: false,
      drain_ms: null,
    },
  ],
  total: {
    day: { tokens: 0, runs: 0, turns: 0 },
    week: { tokens: 0, runs: 0, turns: 0 },
    cap: 0,
    throttledNow: false,
    drainAt: null,
  },
};

test("live-wire (g): the live spend body passes (dual-lane); the canned fixture still passes; a broken total window drifts", () => {
  assertContract("spend", LIVE_SPEND_BODY);
  assertContract("spend", {
    tokensIn: 52_000, tokensOut: 14_500, calls: 41,
    windowStartedAt: "2026-11-06T00:00:00Z", windowLimit: 0, throttled: false,
  }); // the fixture lane
  expect(() =>
    assertContract("spend", {
      ...LIVE_SPEND_BODY,
      total: { ...LIVE_SPEND_BODY.total, day: { tokens: "many" } },
    }),
  ).toThrow(/total\.day\.tokens/);
});

test("live-wire (g2): mapSpend maps the live body honestly (day runs vs cap, the unlimited spelling, throttledNow) and passes the fixture body through verbatim", () => {
  const mapped = mapSpend(LIVE_SPEND_BODY);
  expect(mapped.calls).toBe(0); // total.day.runs
  expect(mapped.windowLimit).toBe(0); // total.cap (0 = unlimited)
  expect(mapped.throttled).toBe(false); // total.throttledNow
  expect(mapped.live?.day.tokens).toBe(0);
  expect(mapped.live?.routines[0]?.id).toBe("auto-mw6tvrfk-7br7ac");
  expect(mapped.live?.drainAt).toBe(null);
  const fixture = {
    tokensIn: 52_000, tokensOut: 14_500, calls: 41,
    windowStartedAt: "2026-11-06T00:00:00Z", windowLimit: 0, throttled: false,
  };
  const passthrough = mapSpend(fixture);
  expect(passthrough.tokensIn).toBe(52_000);
  expect(passthrough.live).toBeUndefined(); // the fixture lane never fabricates a live block
});
