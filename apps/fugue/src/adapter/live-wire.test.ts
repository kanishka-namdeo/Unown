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
import { mapRuns } from "./rest-adapter.js";

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
