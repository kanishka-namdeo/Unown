#!/usr/bin/env node
/**
 * mock-engine.mjs — the E2E stand-in for the self-learning engine (:3030).
 *
 * Why it exists: docs/testing-strategy.md §6 gate 16 — Playwright E2E + axe
 * need a dashboard with the engine up, and CI must not depend on a live
 * engine (bun, bwrap, SQLite state) to exercise the UI contract. This server
 * implements exactly the REST + SSE surface `src/lib/agent-api.ts` consumes,
 * with shapes matching `src/lib/agent-types.ts` and event payloads matching
 * the describe()/invalidations() switch in providers.tsx — so the tests
 * exercise the real client code paths, not a stubbed fetch layer.
 *
 * Zero dependencies on purpose (node:http only): it must run under plain
 * `node` on any CI runner and locally under bun, with no install step.
 *
 * CORS: the dashboard build pins NEXT_PUBLIC_AGENT_API_BASE to this origin
 * (DIRECT mode), so every response carries permissive CORS headers and OPTIONS
 * preflights (the mutations POST JSON) are answered.
 *
 * Stateful where the console flow needs it: POST /api/agent/prompt appends an
 * interactive run, emits run:started, then flips it to passed + run:finished
 * after ~1.5s — the Console tab's "watch for the new interactive run" query
 * sees a real shape flow through.
 *
 * Usage: node e2e/mock-engine.mjs [port]   (default 3030)
 */
import { createServer } from "node:http";

const PORT = Number(process.argv[2] ?? process.env.MOCK_ENGINE_PORT ?? 3030);
const now = () => Date.now();
const T0 = now();
const MIN = 60_000;

/* ---------- fixtures ---------- */
const tiers = ["policy", "project", "user", "local"].map((tier, i) => ({
  tier,
  version: 4 + i,
  content: `# ${tier} memory (mock)\n\n- mock rule ${i + 1}: prefer standard library functions\n- mock rule ${i + 2}: run tests before pushing\n`,
  chars: 96 + i * 11,
  updatedAt: T0 - (i + 1) * 3 * MIN,
}));

const tasks = [
  { id: "task-e2e-1", name: "fix-failing-test", description: "Make `bun test` pass after a regression.", category: "testing", difficulty: 2, created_at: T0 - 900 * MIN, passes: 12, fails: 3, improvements: 2, origin: "seed", status: "regression" },
  { id: "task-e2e-2", name: "parse-json-robustly", description: "Extract JSON from noisy model output.", category: "parsing", difficulty: 3, created_at: T0 - 500 * MIN, passes: 9, fails: 1, improvements: 1, origin: "seed", status: "regression" },
  { id: "task-e2e-3", name: "sandbox-escape-guard", description: "Deny bash redirect escapes in PreToolUse.", category: "security", difficulty: 4, created_at: T0 - 90 * MIN, passes: 4, fails: 2, improvements: 1, origin: "minted", status: "capability" },
  { id: "task-e2e-4", name: "curriculum-variant-hard", description: "Minted harder variant of parse-json-robustly.", category: "parsing", difficulty: 5, created_at: T0 - 30 * MIN, passes: 0, fails: 1, improvements: 0, origin: "minted", status: "capability" },
];

const runs = [
  { id: "run-e2e-10", task_id: "task-e2e-1", kind: "baseline", status: "failed", started_at: T0 - 42 * MIN, ended_at: T0 - 41 * MIN, sandbox_id: "sbx-e2e-1", cycle_id: "cyc-e2e-3", improvement_id: null, tokens_in: 8100, tokens_out: 2100, tool_calls: 14, turns: 6, error: null },
  { id: "run-e2e-11", task_id: "task-e2e-1", kind: "candidate", status: "passed", started_at: T0 - 38 * MIN, ended_at: T0 - 37 * MIN, sandbox_id: "sbx-e2e-2", cycle_id: "cyc-e2e-3", improvement_id: "imp-e2e-2", tokens_in: 8300, tokens_out: 1900, tool_calls: 12, turns: 5, error: null },
  { id: "run-e2e-12", task_id: "task-e2e-3", kind: "regression", status: "passed", started_at: T0 - 25 * MIN, ended_at: T0 - 24 * MIN, sandbox_id: "sbx-e2e-3", cycle_id: null, improvement_id: null, tokens_in: 4200, tokens_out: 900, tool_calls: 8, turns: 4, error: null },
  { id: "run-e2e-13", task_id: "task-e2e-4", kind: "baseline", status: "error", started_at: T0 - 12 * MIN, ended_at: T0 - 12 * MIN, sandbox_id: "sbx-e2e-4", cycle_id: null, improvement_id: null, tokens_in: 300, tokens_out: 0, tool_calls: 0, turns: 1, error: "bridge 504: upstream timeout" },
];

const runDetails = new Map(
  runs.map((r, i) => [
    r.id,
    {
      ...r,
      prompt: `Complete task ${r.task_id}.`,
      transcript: [
        { type: "text", ts: r.started_at + 900, text: "Reading the task files first." },
        { type: "tool_start", ts: r.started_at + 1500, tool: "read", input: "src/main.ts" },
        { type: "tool_end", ts: r.started_at + 1700, tool: "read", output: "84 lines", isError: false },
        { type: "tool_start", ts: r.started_at + 3000, tool: "bash", input: "bun test" },
        { type: "tool_end", ts: r.started_at + 9000, tool: "bash", output: i === 0 ? "1 fail" : "all green", isError: i === 0 },
        { type: "text", ts: r.started_at + 12000, text: "Done — summary written." },
      ],
      verify_output: { passed: r.status === "passed", summary: r.status === "passed" ? "tests green" : "1 failing test", log: "ran 12 tests in 3.1s" },
    },
  ]),
);

const cycles = [
  { id: "cyc-e2e-3", task_id: "task-e2e-1", task_name: "fix-failing-test", status: "improved", iteration: 2, created_at: T0 - 40 * MIN, ended_at: T0 - 35 * MIN, summary: "patched project memory rule; candidate verified twice", shipped: 1 },
  { id: "cyc-e2e-2", task_id: "task-e2e-2", task_name: "parse-json-robustly", status: "no-fix", iteration: 1, created_at: T0 - 300 * MIN, ended_at: T0 - 295 * MIN, summary: "mining produced no viable rule", shipped: 0 },
  { id: "cyc-e2e-1", task_id: "task-e2e-1", task_name: "fix-failing-test", status: "already-passing", iteration: 0, created_at: T0 - 800 * MIN, ended_at: T0 - 798 * MIN, summary: null, shipped: 0 },
];

const improvements = [
  { id: "imp-e2e-2", cycle_id: "cyc-e2e-3", task_id: "task-e2e-1", iteration: 2, diagnosis: "agent retried the same failing command without reading the assertion", proposal: "rule: read the failing assertion before retrying", patch: "- Before re-running a failing test, read the assertion output.", target_tier: "project", status: "shipped", baseline_run_id: "run-e2e-10", candidate_run_id: "run-e2e-11", score_before: "0/1", score_after: "1/1", created_at: T0 - 37 * MIN, decided_at: T0 - 35 * MIN },
  { id: "imp-e2e-1", cycle_id: "cyc-e2e-2", task_id: "task-e2e-2", iteration: 1, diagnosis: "json extraction broke on reasoning prefixes", proposal: "rule: balanced-brace scan before JSON.parse", patch: "- Scan for the first balanced {...} block.", target_tier: "policy", status: "rejected", baseline_run_id: "run-e2e-1", candidate_run_id: "run-e2e-2", score_before: "1/1", score_after: "1/1", created_at: T0 - 299 * MIN, decided_at: T0 - 296 * MIN },
  { id: "imp-e2e-3", cycle_id: null, task_id: "task-e2e-4", iteration: 1, diagnosis: "harder variant needs multi-step planning", proposal: "rule: plan before editing when difficulty >= 5", patch: "- Emit a plan for difficulty-5 tasks.", target_tier: "user", status: "proposed", baseline_run_id: "run-e2e-13", candidate_run_id: "run-e2e-14", score_before: "0/1", score_after: null, created_at: T0 - 11 * MIN, decided_at: null },
];

const dreams = [
  { id: "drm-e2e-2", started_at: T0 - 36 * MIN, ended_at: T0 - 35 * MIN, status: "done", notes_in: 3, entries_merged: 2, entries_pruned: 1, entries_added: 1, output: "consolidated retry discipline into project memory", note: "canary kept the last-passing task green" },
  { id: "drm-e2e-1", started_at: T0 - 600 * MIN, ended_at: T0 - 599 * MIN, status: "no-notes", notes_in: 0, entries_merged: 0, entries_pruned: 0, entries_added: 0, output: null, note: null },
];

const dreamNotes = [
  { id: "nte-e2e-1", run_id: "run-e2e-10", project_slug: "unown", content: "The agent retried the same failing command; the fix was to read the assertion first.", created_at: T0 - 41 * MIN },
  { id: "nte-e2e-2", run_id: "run-e2e-12", project_slug: "unown", content: "Redirect-escape guard fired correctly on the bash deny-list test.", created_at: T0 - 24 * MIN },
];

const hooks = [
  { ts: T0 - 23 * MIN, run_id: "run-e2e-12", hook: "PreToolUse", tool: "bash", decision: "deny", reason: "bash redirect escape", details: "cmd: cat /etc/passwd > out" },
  { ts: T0 - 24 * MIN, run_id: "run-e2e-12", hook: "SessionStart", tool: null, decision: "log", reason: "sandbox session opened", details: null },
  { ts: T0 - 38 * MIN, run_id: "run-e2e-11", hook: "PostToolUse", tool: "bash", decision: "log-error", reason: "syntax gate: 1 failing test fed back", details: "exit 1" },
  { ts: T0 - 41 * MIN, run_id: "run-e2e-10", hook: "UserPromptSubmit", tool: null, decision: "augment", reason: "tiered memory injected (4 tiers, 402 chars)", details: null },
];

const jobs = [
  { id: "job-harness-cycle", name: "harness-cycle", kind: "interval", schedule_ms: 900000, event: null, enabled: 1, last_run: T0 - 9 * MIN, next_run: T0 + 6 * MIN, run_count: 132, status: "idle", description: "Pick a task, run it in a fresh sandbox, mine failures." },
  { id: "job-task-mint", name: "task-mint", kind: "interval", schedule_ms: 3600000, event: null, enabled: 1, last_run: T0 - 55 * MIN, next_run: T0 + 5 * MIN, run_count: 18, status: "idle", description: "Convert failures and curriculum variants into new tasks." },
  { id: "job-auto-dream", name: "auto-dream", kind: "interval", schedule_ms: 1800000, event: null, enabled: 1, last_run: T0 - 36 * MIN, next_run: T0 + 24 * MIN, run_count: 47, status: "idle", description: "Consolidate session notes into tiered memory." },
  { id: "job-note-sync", name: "note-sync", kind: "interval", schedule_ms: 60000, event: null, enabled: 1, last_run: T0 - 1 * MIN, next_run: T0 + 0.5 * MIN, run_count: 921, status: "running", description: "Pull terminal session notes into the engine." },
  { id: "job-sandbox-gc", name: "sandbox-gc", kind: "interval", schedule_ms: 600000, event: null, enabled: 1, last_run: T0 - 7 * MIN, next_run: T0 + 3 * MIN, run_count: 88, status: "idle", description: "Reap sandboxes older than the retention window." },
  { id: "job-improvement-shipped", name: "improvement-shipped", kind: "event", schedule_ms: null, event: "improvement:shipped", enabled: 1, last_run: T0 - 35 * MIN, next_run: null, run_count: 12, status: "idle", description: "Sweep regressions right after a memory patch ships." },
  { id: "job-run-finished", name: "run-finished", kind: "event", schedule_ms: null, event: "run:finished", enabled: 1, last_run: T0 - 24 * MIN, next_run: null, run_count: 304, status: "idle", description: "Record the run note for the next dream." },
];

const sandboxes = [
  { id: "sbx-e2e-4", createdAt: T0 - 12 * MIN, label: "task-e2e-4/baseline", files: 41 },
  { id: "sbx-e2e-5", createdAt: T0 - 2 * MIN, label: "interactive/session", files: 12 },
];

const automations = [
  {
    id: "auto-e2e-1",
    title: "nightly repo health check",
    prompt: "Review the repo health and report anomalies.",
    cron_expr: "0 3 * * *",
    delay_ms: null,
    workspace: "/home/dev/unown",
    mode: "read-only",
    model: null,
    max_runs: null,
    run_count: 4,
    scheduled_run_count: 4,
    lifecycle: "active",
    next_run_at: T0 + 6 * 60 * MIN,
    last_run_at: T0 - 18 * MIN,
    created_at: T0 - 3 * 24 * 60 * MIN,
    updated_at: T0 - 18 * MIN,
    schedule: "at 03:00",
    lastRun: {
      id: "arun-e2e-1",
      automation_id: "auto-e2e-1",
      trigger_kind: "schedule",
      scheduled_at: T0 - 18 * MIN,
      status: "succeeded",
      started_at: T0 - 18 * MIN,
      ended_at: T0 - 17 * MIN,
      exit_code: 0,
      output: "## Nightly Repo Health Check\n\nAll gates green.",
      error: null,
      turns: 9,
      tokens_in: 41000,
      tokens_out: 1500,
    },
  },
];

const automationRuns = {
  "auto-e2e-1": [
    automations[0].lastRun,
    {
      id: "arun-e2e-0",
      automation_id: "auto-e2e-1",
      trigger_kind: "manual",
      scheduled_at: null,
      status: "failed",
      started_at: T0 - 27 * MIN,
      ended_at: T0 - 26 * MIN,
      exit_code: 1,
      output: null,
      error: "session timed out",
      turns: 3,
      tokens_in: 9000,
      tokens_out: 200,
    },
  ],
};

const skills = [
  { id: "skl-e2e-1", project_slug: "unown", project_path: "/home/dev/unown", name: "recover-failed-cycle", description: "Recover a failed harness cycle without restarting the engine.", body: "# recover-failed-cycle\n\n1. Read the cycle summary.\n2. Re-arm the job.", status: "shipped", version: 2, dream_id: "drm-e2e-2", created_at: T0 - 34 * MIN, updated_at: T0 - 34 * MIN },
];

const bridge = {
  log: [
    { ts: T0 - 9 * MIN, model: "qwen3.7-plus", stream: true, messages: 12, tools: 6, finishReason: "stop", contentChars: 1840, toolCalls: 3, promptTokens: 8100, completionTokens: 1900, durationMs: 4120 },
    { ts: T0 - 37 * MIN, model: "kimi-k2.5", stream: true, messages: 10, tools: 6, finishReason: "stop", contentChars: 990, toolCalls: 2, promptTokens: 8300, completionTokens: 900, durationMs: 3890 },
  ],
  requests: 927,
  errors: 3,
  url: "http://127.0.0.1:3031/v1",
};

// Web results store: hit rate (118+34)/(118+34+67) = 69%, 152 saved requests.
const webcache = {
  enabled: true,
  root: "/home/dev/.unown/cache/web",
  entries: 214,
  bytes: 41_234_567,
  maxBytes: 268_435_456,
  ttl: { searchMs: 3_600_000, fetchMs: 1_800_000, searchStaleMs: 86_400_000, fetchStaleMs: 604_800_000 },
  totals: { hit: 118, revalidated: 34, miss: 67, stale: 5, bypass: 2, evict: 8, clear: 1, error: 0 },
  savedRequests: 152,
  byTool: { web_search: 96, webfetch: 71, fetch_url: 19 },
  byProvider: { duckduckgo: 74, direct: 62, tavily: 29, searxng: 21 },
  recentEvents: [
    { ts: T0 - 2 * MIN, kind: "hit", tool: "web_search", provider: "duckduckgo", detail: "bun sqlite tutorial", ageMs: 12 * MIN },
    { ts: T0 - 6 * MIN, kind: "revalidated", tool: "webfetch", provider: "direct", detail: "bun.sh/docs", ageMs: 2 * 60 * MIN },
    { ts: T0 - 11 * MIN, kind: "miss", tool: "web_search", provider: "tavily", detail: "react 19 release notes" },
    { ts: T0 - 23 * MIN, kind: "stale", tool: "webfetch", provider: "direct", detail: "example.com", ageMs: 25 * 60 * MIN },
    { ts: T0 - 41 * MIN, kind: "evict", tool: "engine", detail: "2 entries (0.4 MiB) — LRU sweep" },
  ],
};

const overview = () => ({
  ok: true,
  agent: { name: "unown (mock)", layer: "mock", provider: "mock", bridge: { ok: true, port: 3031, requests: bridge.requests, errors: bridge.errors } },
  kpis: {
    totalRuns: 132,
    passed: 118,
    failed: 11,
    errors: 3,
    passRate: 89,
    tasks: tasks.length,
    improvementsShipped: 1,
    dreams: dreams.length,
    notes: { total: 42, pending: 2 },
    hooks: { total: 304, denies: 27 },
    tokens: { in: 1_240_000, out: 340_000 },
    suite: { total: tasks.length, passing: 3, capability: 2, regression: 2, minted: 2, graduated: 1, saturated: false },
  },
  memoryVersions: { policy: 4, project: 5, user: 6, local: 7 },
  trend: Array.from({ length: 12 }, (_, i) => ({ ts: T0 - (12 - i) * 60 * MIN, cumulativePass: 20 + i * 9 })),
  routerBusy: false,
});

/* ---------- SSE fan-out ---------- */
const sseClients = new Set();
function emit(event, payload) {
  const frame = `data: ${JSON.stringify({ event, payload, ts: now() })}\n\n`;
  for (const res of sseClients) res.write(frame);
}
function sseHandler(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
  });
  res.write(`retry: 2000\n\n`);
  // Join the broadcast set BEFORE the greeting — the original order emitted
  // hello to a set that did not contain this client yet, so no page ever
  // saw "connected to agent event stream" (found while wiring the E2E gate).
  sseClients.add(res);
  const write = (event, payload) =>
    res.write(`data: ${JSON.stringify({ event, payload, ts: now() })}\n\n`);
  write("hello", { engine: "mock" });
  // Per-connection scripted burst: every page load sees the same sequence at
  // the same offsets (a server-start-time burst races page connections and
  // is not a testable contract).
  const timers = canned.map(([event, payload], i) =>
    setTimeout(() => {
      if (sseClients.has(res)) write(event, payload);
    }, 300 + i * 250),
  );
  req.on("close", () => {
    timers.forEach(clearTimeout);
    sseClients.delete(res);
  });
}
const heartbeat = setInterval(() => emit("ping", { ts: now() }), 10_000);
heartbeat.unref();

/* ---------- helpers ---------- */
const json = (res, body, status = 200) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
};

const canned = [
  ["job:finished", { name: "note-sync" }],
  ["memory:changed", { tier: "project", version: 5, changedBy: "autodream" }],
  ["note:created", { runId: "run-e2e-12" }],
  ["run:finished", { taskId: "task-e2e-3", status: "passed", durationMs: 61000 }],
  ["hook", { hook: "PreToolUse", tool: "bash", decision: "deny", reason: "bash redirect escape" }],
];

/* ---------- server ---------- */
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;

  if (req.method === "OPTIONS") return json(res, {}, 204);
  if (req.method === "GET" && p === "/api/events") return sseHandler(req, res);

  if (req.method === "GET") {
    if (p === "/api/overview") return json(res, overview());
    if (p === "/api/tasks") return json(res, { tasks });
    if (p === "/api/runs") {
      let list = runs;
      const task = url.searchParams.get("task");
      const kind = url.searchParams.get("kind");
      if (task) list = list.filter((r) => r.task_id === task);
      if (kind) list = list.filter((r) => r.kind === kind);
      return json(res, { runs: list });
    }
    const runMatch = p.match(/^\/api\/runs\/([^/]+)$/);
    if (runMatch) {
      const d = runDetails.get(runMatch[1]);
      return d ? json(res, { run: d }) : json(res, { error: "run not found" }, 404);
    }
    if (p === "/api/memory") return json(res, { tiers, resolvedChars: 402 });
    const histMatch = p.match(/^\/api\/memory\/([^/]+)\/history$/);
    if (histMatch) {
      const tier = histMatch[1];
      return json(res, {
        history: [0, 1, 2].map((i) => ({
          id: 3 - i,
          tier,
          version: 5 - i,
          content: `# ${tier} memory v${5 - i}\n\n- earlier revision ${i}`,
          changed_by: i === 0 ? "autodream" : i === 1 ? "harness" : "seed",
          note: i === 0 ? "canary-verified consolidation" : null,
          created_at: T0 - (i + 1) * 100 * MIN,
        })),
      });
    }
    if (p === "/api/cycles") return json(res, { cycles });
    if (p === "/api/improvements") return json(res, { improvements });
    if (p === "/api/dreams") return json(res, { dreams });
    const dreamNotesMatch = p.match(/^\/api\/dreams\/([^/]+)\/notes$/);
    if (dreamNotesMatch) return json(res, { notes: dreamNotes });
    if (p === "/api/hooks") return json(res, { hooks });
    if (p === "/api/notes") return json(res, { notes: dreamNotes });
    if (p === "/api/jobs") return json(res, { jobs });
    if (p === "/api/sandboxes") return json(res, { sandboxes });
    if (p === "/api/skills") return json(res, { skills });
    if (p === "/api/bridge") return json(res, bridge);
    if (p === "/api/webcache") return json(res, webcache);
    if (p === "/api/automations") return json(res, { automations });
    const autoRunsMatch = p.match(/^\/api\/automations\/([^/]+)\/runs$/);
    if (autoRunsMatch)
      return json(res, { runs: automationRuns[autoRunsMatch[1]] ?? [] });
    return json(res, { error: "not found" }, 404);
  }

  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      // A malformed body must answer 400, not crash the whole mock (the
      // webServer dies with the process — found by review M4-R).
      let data = {};
      if (body) {
        try {
          data = JSON.parse(body);
        } catch {
          return json(res, { error: "invalid JSON body" }, 400);
        }
      }
      if (p === "/api/agent/prompt") {
        const id = `run-e2e-prompt-${now() % 100000}`;
        const run = {
          id, task_id: "task-e2e-interactive", kind: "interactive", status: "running",
          started_at: now(), ended_at: null, sandbox_id: "sbx-e2e-5", cycle_id: null, improvement_id: null,
          tokens_in: 0, tokens_out: 0, tool_calls: 0, turns: 1, error: null,
        };
        runs.unshift(run);
        runDetails.set(id, {
          ...run,
          prompt: data.prompt ?? "",
          transcript: [{ type: "text", ts: now(), text: "Planning the request." }],
          verify_output: null,
        });
        emit("run:started", { taskId: "task-e2e-interactive", kind: "interactive", runId: id });
        setTimeout(() => {
          run.status = "passed";
          run.ended_at = now();
          run.tokens_in = 1200;
          run.tokens_out = 400;
          run.tool_calls = 3;
          const d = runDetails.get(id);
          if (d) {
            d.status = "passed";
            d.ended_at = run.ended_at;
            d.transcript.push({ type: "text", ts: now(), text: "Finished the requested edit." });
            d.verify_output = { passed: true, summary: "mock pass", log: "mock" };
          }
          emit("run:finished", { taskId: "task-e2e-interactive", status: "passed", durationMs: 1500, runId: id });
        }, 1500);
        return json(res, { started: true });
      }
      const taskRun = p.match(/^\/api\/tasks\/([^/]+)\/run$/);
      if (taskRun) {
        emit("cycle:started", { taskId: taskRun[1] });
        return json(res, { started: true });
      }
      if (p === "/api/dreams/run") return json(res, { started: true });
      const rollbackMatch = p.match(/^\/api\/memory\/([^/]+)\/rollback$/);
      if (rollbackMatch) {
        emit("memory:changed", { tier: rollbackMatch[1], version: data.version, changedBy: "rollback" });
        return json(res, { ok: true });
      }
      const jobAction = p.match(/^\/api\/jobs\/([^/]+)\/(trigger|toggle)$/);
      if (jobAction) {
        if (jobAction[2] === "toggle") {
          const j = jobs.find((x) => x.id === jobAction[1]);
          if (j) j.enabled = j.enabled ? 0 : 1;
          return json(res, { job: j });
        }
        emit("job:started", { name: jobAction[1] });
        setTimeout(() => emit("job:finished", { name: jobAction[1] }), 400);
        return json(res, { ok: true, result: "mock" });
      }
      if (p === "/api/webcache/clear") {
        const removed = webcache.entries;
        const bytes = webcache.bytes;
        // Mirror the real engine: the mutation announces itself on the bus so
        // every connected dashboard refetches (providers.tsx invalidation).
        emit("webcache:cleared", { removed, bytes });
        return json(res, { ok: true, removed, bytes });
      }
      if (p === "/api/webcache/sweep") {
        return json(res, { ok: true, evicted: 2, freedBytes: 812_345, totalBytes: webcache.bytes });
      }
      return json(res, { error: "not found" }, 404);
    });
    return;
  }

  json(res, { error: "method not allowed" }, 405);
});

// A short scripted burst so the Live Activity feed has real rows to render.

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock engine listening on http://127.0.0.1:${PORT} (REST + SSE, CORS open)`);
});
