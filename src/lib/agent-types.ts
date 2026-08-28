// Types for the self-learning agent service (port 3030) API responses.

export type RunKind = "baseline" | "candidate" | "regression" | "interactive";
export type RunStatus = "running" | "passed" | "failed" | "error";
export type MemoryTier = "policy" | "project" | "user" | "local";
export type CycleStatus = "improved" | "no-fix" | "already-passing" | "running";
export type ImprovementStatus = "proposed" | "validated" | "shipped" | "rejected";
export type DreamStatus = "done" | "running" | "no-notes" | "error";
export type HookName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "Stop"
  | "SubagentStop";
export type HookDecision = "allow" | "deny" | "augment" | "log" | "log-error";
export type ChangedBy = "autodream" | "harness" | "seed" | "manual" | "rollback";

export interface BridgeInfo {
  ok: boolean;
  port: number;
  requests: number;
  errors: number;
}

export interface OverviewAgent {
  name: string;
  layer: string;
  provider: string;
  bridge: BridgeInfo;
}

export interface OverviewKpis {
  totalRuns: number;
  passed: number;
  failed: number;
  errors: number;
  passRate: number;
  tasks: number;
  improvementsShipped: number;
  dreams: number;
  notes: { total: number; pending: number };
  hooks: { total: number; denies: number };
  tokens: { in: number; out: number };
}

export interface TrendPoint {
  ts: number;
  cumulativePass: number;
}

export interface OverviewResponse {
  ok: boolean;
  agent: OverviewAgent;
  kpis: OverviewKpis;
  memoryVersions: Record<MemoryTier, number>;
  trend: TrendPoint[];
  routerBusy: boolean;
}

export interface Task {
  id: string;
  name: string;
  description: string;
  category: string;
  difficulty: number;
  created_at: number;
  passes: number;
  fails: number;
  improvements: number;
  pass_count?: number;
  fail_count?: number;
}

export interface TasksResponse {
  tasks: Task[];
}

export interface Run {
  id: string;
  task_id: string;
  kind: RunKind;
  status: RunStatus;
  started_at: number;
  ended_at: number | null;
  sandbox_id: string | null;
  cycle_id: string | null;
  improvement_id: string | null;
  tokens_in: number;
  tokens_out: number;
  tool_calls: number;
  turns: number;
  error: string | null;
}

export interface RunsResponse {
  runs: Run[];
}

export type TranscriptEntry =
  | { type: "text"; ts: number; text: string }
  | { type: "tool_start"; ts: number; tool: string; input: string }
  | { type: "tool_end"; ts: number; tool: string; output: string; isError: boolean };

export interface VerifyOutput {
  passed: boolean;
  summary: string;
  log: string;
}

export interface RunDetail extends Run {
  prompt: string | null;
  transcript: TranscriptEntry[];
  verify_output: VerifyOutput | null;
}

export interface RunDetailResponse {
  run: RunDetail;
}

export interface MemoryTierInfo {
  tier: MemoryTier;
  version: number;
  content: string;
  chars: number;
  updatedAt: number;
}

export interface MemoryResponse {
  tiers: MemoryTierInfo[];
  resolvedChars: number;
}

export interface MemoryHistoryEntry {
  id: number;
  tier: MemoryTier;
  version: number;
  content: string;
  changed_by: ChangedBy;
  note: string | null;
  created_at: number;
}

export interface MemoryHistoryResponse {
  history: MemoryHistoryEntry[];
}

export interface Cycle {
  id: string;
  task_id: string;
  task_name?: string;
  status: CycleStatus;
  iteration: number;
  created_at: number;
  ended_at: number | null;
  summary: string | null;
  shipped: number;
}

export interface CyclesResponse {
  cycles: Cycle[];
}

export interface Improvement {
  id: string;
  cycle_id: string;
  task_id: string;
  iteration: number;
  diagnosis: string;
  proposal: string;
  patch: string;
  target_tier: MemoryTier;
  status: ImprovementStatus;
  baseline_run_id: string;
  candidate_run_id: string;
  score_before: string;
  score_after: string;
  created_at: number;
  decided_at: number | null;
}

export interface ImprovementsResponse {
  improvements: Improvement[];
}

export interface Dream {
  id: string;
  started_at: number;
  ended_at: number | null;
  status: DreamStatus;
  notes_in: number;
  entries_merged: number;
  entries_pruned: number;
  entries_added: number;
  output: string | null;
  note: string | null;
}

export interface DreamsResponse {
  dreams: Dream[];
}

export interface DreamNote {
  id: string;
  run_id: string;
  content: string;
  created_at: number;
}

export interface DreamNotesResponse {
  notes: DreamNote[];
}

export interface HookEntry {
  ts: number;
  run_id: string | null;
  hook: HookName;
  tool: string | null;
  decision: HookDecision;
  reason: string | null;
  details: string | null;
}

export interface HooksResponse {
  hooks: HookEntry[];
}

export interface Note {
  id: string;
  run_id: string;
  content: string;
  created_at: number;
  dream_id: string | null;
}

export interface NotesResponse {
  notes: Note[];
}

export interface Job {
  id: string;
  name: string;
  kind: "interval" | "event";
  schedule_ms: number | null;
  event: string | null;
  enabled: number;
  last_run: number | null;
  next_run: number | null;
  run_count: number;
  status: "idle" | "running";
  description: string;
}

export interface JobsResponse {
  jobs: Job[];
}

export interface Sandbox {
  id: string;
  createdAt: number;
  label: string;
  files: number;
}

export interface SandboxesResponse {
  sandboxes: Sandbox[];
}

export interface BridgeLogEntry {
  ts: number;
  model: string;
  stream: boolean;
  messages: number;
  tools: number;
  finishReason: string;
  contentChars: number;
  toolCalls: number;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

export interface BridgeResponse {
  log: BridgeLogEntry[];
  requests: number;
  errors: number;
  url: string;
}

// ---- SSE events ----

export interface AgentEvent {
  event: string;
  payload: Record<string, unknown>;
  ts: number;
}

export interface ActivityItem {
  key: string;
  ts: number;
  event: string;
  text: string;
  tone: "emerald" | "amber" | "rose" | "zinc";
}
