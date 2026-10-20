// Engine payload fixtures for dashboard component tests.
//
// Every fixture is a factory returning a fresh object typed against
// src/lib/agent-types.ts, so the stubbed fetch responses mirror the shapes the
// real engine returns (docs/testing-strategy.md §4.1 "Component" tests: happy /
// empty / error states with engine responses stubbed).
//
// Timestamps are relative to `now()` so timeAgo() stays in a stable bucket
// ("1m ago") regardless of when the suite runs; assertions avoid pinning
// exact relative-time strings where the bucket could shift.

import type {
  BridgeInfo,
  BridgeResponse,
  Cycle,
  Dream,
  DreamNote,
  HookEntry,
  Improvement,
  Job,
  MemoryHistoryEntry,
  MemoryResponse,
  MemoryTier,
  MemoryTierInfo,
  Note,
  OverviewResponse,
  Run,
  RunDetail,
  RunDetailResponse,
  RunsResponse,
  Skill,
  Task,
  TaskOrigin,
  TaskStatus,
  WebCacheStats,
} from "@/lib/agent-types";

const now = () => Date.now();
const minutesAgo = (m: number) => now() - m * 60_000;

// ---- shared small builders ----

export function bridgeInfo(over: Partial<BridgeInfo> = {}): BridgeInfo {
  return { ok: true, port: 3031, requests: 42, errors: 1, ...over };
}

export function task(over: Partial<Task> = {}): Task {
  return {
    id: "fix-login-flow",
    name: "fix login flow redirect",
    description: "Regression: session cookie is dropped before the redirect lands.",
    category: "bug",
    difficulty: 3,
    created_at: minutesAgo(600),
    passes: 7,
    fails: 2,
    improvements: 1,
    origin: "seed" as TaskOrigin,
    status: "regression" as TaskStatus,
    ...over,
  };
}

export function run(over: Partial<Run> = {}): Run {
  return {
    id: "run-0001",
    task_id: "fix-login-flow",
    kind: "baseline",
    status: "passed",
    started_at: minutesAgo(12),
    ended_at: minutesAgo(11),
    sandbox_id: "sbx-abc123",
    cycle_id: null,
    improvement_id: null,
    tokens_in: 4200,
    tokens_out: 800,
    tool_calls: 9,
    turns: 4,
    error: null,
    ...over,
  };
}

/** `GET /api/runs/<id>` response — the engine wraps the detail in `{ run }`. */
export function runDetailResponse(over: Partial<RunDetail> = {}): RunDetailResponse {
  return { run: runDetail(over) };
}

export function runDetail(over: Partial<RunDetail> = {}): RunDetail {
  return {
    ...run(),
    prompt: "Reproduce the login redirect bug and fix it.",
    transcript: [
      { type: "text", ts: minutesAgo(12), text: "I will start by reproducing the bug." },
      { type: "tool_start", ts: minutesAgo(12), tool: "bash", input: '{"command":"cat login.ts"}' },
      { type: "tool_end", ts: minutesAgo(11), tool: "bash", output: "…file content…", isError: false },
    ],
    verify_output: { passed: true, summary: "2 checks green", log: "ok" },
    ...over,
  };
}

export function cycle(over: Partial<Cycle> = {}): Cycle {
  return {
    id: "cycle-0001",
    task_id: "fix-login-flow",
    task_name: "fix login flow redirect",
    status: "improved",
    iteration: 2,
    created_at: minutesAgo(30),
    ended_at: minutesAgo(25),
    summary: "shipped a memory patch about cookie scoping",
    shipped: 1,
    ...over,
  };
}

export function improvement(over: Partial<Improvement> = {}): Improvement {
  return {
    id: "imp-0001",
    cycle_id: "cycle-0001",
    task_id: "fix-login-flow",
    iteration: 2,
    diagnosis: "The agent missed that the cookie path was scoped to /auth only.",
    proposal: "Teach the agent to check cookie scope before redirecting.",
    patch: "- When a redirect drops the session, check the cookie path first.",
    target_tier: "project",
    status: "shipped",
    baseline_run_id: "run-0001",
    candidate_run_id: "run-0002",
    score_before: "1/3",
    score_after: "3/3",
    created_at: minutesAgo(28),
    decided_at: minutesAgo(25),
    ...over,
  };
}

export function memoryTierInfo(tier: MemoryTier, over: Partial<MemoryTierInfo> = {}): MemoryTierInfo {
  const versions: Record<MemoryTier, number> = { policy: 1, project: 3, user: 2, local: 1 };
  const contents: Record<MemoryTier, string> = {
    policy: "Never exfiltrate secrets.",
    project: "This repo uses bun; run tests with `bun test src`.",
    user: "Prefer concise answers.",
    local: "Sandbox note: /tmp is writable.",
  };
  return {
    tier,
    version: versions[tier],
    content: contents[tier],
    chars: contents[tier].length,
    updatedAt: minutesAgo(20),
    ...over,
  };
}

export function memoryHistoryEntry(over: Partial<MemoryHistoryEntry> = {}): MemoryHistoryEntry {
  return {
    id: 1,
    tier: "project",
    version: 3,
    content: "This repo uses bun; run tests with `bun test src`.",
    changed_by: "autodream",
    note: "consolidated from session notes",
    created_at: minutesAgo(20),
    ...over,
  };
}

export function dream(over: Partial<Dream> = {}): Dream {
  return {
    id: "dream-0001",
    started_at: minutesAgo(90),
    ended_at: minutesAgo(85),
    status: "done",
    notes_in: 4,
    entries_merged: 2,
    entries_pruned: 1,
    entries_added: 1,
    output: "Merged cookie-scope lessons into project memory.",
    note: "consolidation complete",
    ...over,
  };
}

export function dreamNote(over: Partial<DreamNote> = {}): DreamNote {
  return {
    id: "note-0001",
    run_id: "run-0001",
    project_slug: "unown",
    // Distinct from `note()` so dreams-tab assertions can tell the pending
    // note apart from the dream-consumed note rendering of the same id.
    content: "Cookie scoped to /auth was dropped before the redirect landed.",
    created_at: minutesAgo(95),
    ...over,
  };
}

export function hookEntry(over: Partial<HookEntry> = {}): HookEntry {
  return {
    ts: minutesAgo(5),
    run_id: "run-0001",
    hook: "PreToolUse",
    tool: "bash",
    decision: "allow",
    reason: "command allowed",
    details: null,
    ...over,
  };
}

export function note(over: Partial<Note> = {}): Note {
  return {
    id: "note-0001",
    run_id: "run-0001",
    project_slug: "unown",
    content: "Redirect drops session when cookie path is /auth.",
    created_at: minutesAgo(95),
    dream_id: null,
    ...over,
  };
}

export function skill(over: Partial<Skill> = {}): Skill {
  return {
    id: "skill-0001",
    project_slug: "unown",
    project_path: "/home/dev/unown",
    name: "bun-test-conventions",
    description: "Run dashboard tests with bun test src.",
    body: "# bun-test-conventions\n\nAlways run `bun test src`.",
    status: "shipped",
    version: 2,
    dream_id: "dream-0001",
    created_at: minutesAgo(80),
    updated_at: minutesAgo(60),
    ...over,
  };
}

export function job(over: Partial<Job> = {}): Job {
  return {
    id: "harness-cycle",
    name: "harness cycle",
    kind: "interval",
    schedule_ms: 3_600_000,
    event: null,
    enabled: 1,
    last_run: minutesAgo(40),
    next_run: now() + 3_000_000,
    run_count: 12,
    status: "idle",
    description: "Runs a full self-improvement cycle on the task suite.",
    ...over,
  };
}

// ---- tab-level response fixtures ----

export function overviewResponse(over: Partial<OverviewResponse> = {}): OverviewResponse {
  return {
    ok: true,
    agent: {
      name: "unown",
      layer: "pi harness",
      provider: "zai-bridge/kimi-k2.5",
      bridge: bridgeInfo(),
    },
    kpis: {
      totalRuns: 25,
      passed: 21,
      failed: 3,
      errors: 1,
      passRate: 84,
      tasks: 12,
      improvementsShipped: 4,
      dreams: 2,
      notes: { total: 9, pending: 3 },
      hooks: { total: 55, denies: 4 },
      tokens: { in: 120_000, out: 30_000 },
      suite: {
        total: 12,
        passing: 6,
        capability: 3,
        regression: 6,
        minted: 2,
        graduated: 1,
        saturated: false,
      },
    },
    memoryVersions: { policy: 1, project: 3, user: 2, local: 1 },
    trend: [
      { ts: minutesAgo(60), cumulativePass: 4 },
      { ts: minutesAgo(30), cumulativePass: 12 },
      { ts: minutesAgo(5), cumulativePass: 21 },
    ],
    routerBusy: false,
    ...over,
  };
}

export function tasksResponse(): { tasks: Task[] } {
  return {
    tasks: [
      task(),
      task({
        id: "parse-csv-headers",
        name: "parse csv headers robustly",
        difficulty: 4,
        passes: 3,
        fails: 5,
        improvements: 0,
        origin: "minted",
        status: "capability",
      }),
    ],
  };
}

export function runsResponse(): RunsResponse {
  return {
    runs: [
      run(),
      run({ id: "run-0002", kind: "candidate", status: "passed", cycle_id: "cycle-0001" }),
      run({ id: "run-0003", kind: "regression", status: "failed", error: "verify failed" }),
    ],
  };
}

export function memoryResponse(): MemoryResponse {
  return {
    tiers: (["policy", "project", "user", "local"] as MemoryTier[]).map((t) => memoryTierInfo(t)),
    resolvedChars: 187,
  };
}

export function memoryHistoryResponse(): { history: MemoryHistoryEntry[] } {
  return {
    history: [
      memoryHistoryEntry({ id: 3, version: 3, changed_by: "autodream" }),
      memoryHistoryEntry({ id: 2, version: 2, changed_by: "harness", note: "shipped improvement imp-0001" }),
      memoryHistoryEntry({ id: 1, version: 1, changed_by: "seed", note: null }),
    ],
  };
}

export function cyclesResponse(): { cycles: Cycle[] } {
  return {
    cycles: [
      cycle(),
      cycle({
        id: "cycle-0002",
        task_id: "parse-csv-headers",
        task_name: "parse csv headers robustly",
        status: "no-fix",
        shipped: 0,
        summary: "diagnosis ran but no patch beat the baseline",
      }),
    ],
  };
}

export function improvementsResponse(): { improvements: Improvement[] } {
  return {
    improvements: [
      improvement(),
      improvement({
        id: "imp-0002",
        status: "proposed",
        cycle_id: "cycle-0002",
        task_id: "parse-csv-headers",
        // Distinct text from imp-0001 so cycle-filter assertions can tell
        // which improvement card is rendered.
        diagnosis: "The agent splits CSV headers on commas without honoring quoted fields.",
        proposal: "Teach the agent to use a quote-aware header parser.",
        patch: "- When parsing CSV headers, honor quoted commas before splitting.",
        target_tier: "local",
      }),
    ],
  };
}

export function dreamsResponse(): { dreams: Dream[] } {
  return { dreams: [dream()] };
}

export function dreamNotesResponse(): { notes: DreamNote[] } {
  return { notes: [dreamNote()] };
}

export function hooksResponse(): { hooks: HookEntry[] } {
  return {
    hooks: [
      hookEntry(),
      hookEntry({ hook: "PreToolUse", tool: "bash", decision: "deny", reason: "rm -rf / is blocked", details: '{"cmd":"rm -rf /"}' }),
      hookEntry({ hook: "UserPromptSubmit", tool: null, decision: "log", reason: "prompt logged" }),
    ],
  };
}

export function notesResponse(): { notes: Note[] } {
  return {
    notes: [
      note(), // pending: dream_id null
      note({ id: "note-0002", dream_id: "dream-0001", content: "Already consolidated note." }),
    ],
  };
}

export function skillsResponse(): { skills: Skill[] } {
  return {
    skills: [
      skill(),
      skill({
        id: "skill-0002",
        name: "sandbox-gates",
        description: "Check sandbox gates before running commands.",
        version: 1,
        status: "retired",
        dream_id: null,
      }),
    ],
  };
}

export function jobsResponse(): { jobs: Job[] } {
  return {
    jobs: [
      job(),
      job({
        id: "autodream",
        name: "autodream",
        kind: "event",
        schedule_ms: null,
        event: "note:created",
        enabled: 0,
        run_count: 5,
        status: "idle",
        description: "Consolidates pending session notes into memory.",
      }),
    ],
  };
}

export function sandboxesResponse(): { sandboxes: { id: string; createdAt: number; label: string; files: number }[] } {
  return { sandboxes: [{ id: "sbx-abc123", createdAt: minutesAgo(12), label: "run-0001", files: 14 }] };
}

export function bridgeResponse(): BridgeResponse {
  return {
    log: [
      {
        ts: minutesAgo(10),
        model: "kimi-k2.5",
        stream: true,
        messages: 6,
        tools: 8,
        finishReason: "stop",
        contentChars: 1200,
        toolCalls: 2,
        promptTokens: 4200,
        completionTokens: 800,
        durationMs: 8200,
      },
    ],
    requests: 42,
    errors: 1,
    url: "http://localhost:3031",
  };
}

/** `GET /api/webcache` — hit rate (12+4)/(12+4+9) = 64%, 16 saved requests. */
export function webCacheStatsResponse(over: Partial<WebCacheStats> = {}): WebCacheStats {
  return {
    enabled: true,
    root: "/home/dev/.unown/cache/web",
    entries: 3,
    bytes: 1_234_567,
    maxBytes: 268_435_456,
    ttl: {
      searchMs: 3_600_000,
      fetchMs: 1_800_000,
      searchStaleMs: 86_400_000,
      fetchStaleMs: 604_800_000,
    },
    totals: { hit: 12, revalidated: 4, miss: 9, stale: 1, bypass: 2, evict: 1, clear: 0, error: 0 },
    savedRequests: 16,
    byTool: { web_search: 14, webfetch: 9, fetch_url: 5 },
    byProvider: { duckduckgo: 10, direct: 8, tavily: 4, searxng: 3 },
    recentEvents: [
      { ts: minutesAgo(2), kind: "hit", tool: "web_search", provider: "duckduckgo", detail: "bun sqlite", ageMs: 12 * 60_000 },
      { ts: minutesAgo(6), kind: "revalidated", tool: "webfetch", provider: "direct", detail: "bun.sh/docs", ageMs: 2 * 3_600_000 },
      { ts: minutesAgo(11), kind: "miss", tool: "web_search", provider: "tavily", detail: "react 19 release notes" },
      { ts: minutesAgo(23), kind: "stale", tool: "webfetch", provider: "direct", detail: "example.com", ageMs: 25 * 3_600_000 },
      { ts: minutesAgo(41), kind: "evict", tool: "engine", detail: "2 entries (0.4 MiB) — LRU sweep" },
    ],
    ...over,
  };
}
