// Fetch helpers for the self-learning agent service.
//
// Two deployment modes:
//  1. DIRECT  — set NEXT_PUBLIC_AGENT_API_BASE (e.g. "http://localhost:3030"
//     or an API-gateway prefix) and requests go straight to the engine.
//     This is the DEFAULT: next.config.ts bakes http://127.0.0.1:3030 when
//     the env is unset/empty (the launcher always pairs the dashboard with a
//     local engine — P0 fix for the stock-gateway-404 regression).
//  2. GATEWAY — set NEXT_PUBLIC_AGENT_API_BASE=gateway for origins behind
//     the z.ai sandbox preview gateway: relative URLs carry
//     ?XTransformPort=3030 so the gateway routes them to the engine port.

const PORT = 3030;
const RAW_BASE = (process.env.NEXT_PUBLIC_AGENT_API_BASE ?? "").trim().replace(/\/+$/, "");
const GATEWAY = RAW_BASE.length === 0 || RAW_BASE.toLowerCase() === "gateway";
const DIRECT = !GATEWAY;

export function apiUrl(
  path: string,
  params?: Record<string, string | number | undefined>
) {
  const sp = new URLSearchParams();
  if (!DIRECT) sp.set("XTransformPort", String(PORT));
  if (params)
    for (const [k, v] of Object.entries(params))
      if (v !== undefined && v !== null) sp.set(k, String(v));
  const qs = sp.toString();
  const prefix = DIRECT ? `${RAW_BASE}${path}` : path;
  return qs ? `${prefix}?${qs.toString()}` : prefix;
}

const EVENTS_URL = DIRECT
  ? `${RAW_BASE}/api/events`
  : `/api/events?XTransformPort=${PORT}`;

export { EVENTS_URL };

import type {
  Automation,
  AutomationRunsResponse,
  AutomationsResponse,
  BridgeResponse,
  CyclesResponse,
  DreamNotesResponse,
  DreamsResponse,
  HooksResponse,
  ImprovementsResponse,
  JobsResponse,
  Job,
  MemoryHistoryResponse,
  MemoryResponse,
  MemoryTier,
  MintResponse,
  NoteCreateResponse,
  NotesResponse,
  NotesSyncResponse,
  OverviewResponse,
  RunDetailResponse,
  RunsResponse,
  SandboxesResponse,
  SkillDetailResponse,
  SkillsResponse,
  TaskDetailResponse,
  TasksResponse,
  WebCacheClearResponse,
  WebCacheStats,
  WebCacheSweepResponse,
} from "./agent-types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function getJson<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const res = await fetch(apiUrl(path, params), { cache: "no-store" });
  if (!res.ok) throw new ApiError(res.status, `GET ${path} failed (${res.status})`);
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body?: unknown, method: "POST" | "PATCH" | "DELETE" = "POST"): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined && method !== "DELETE" ? undefined : JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `${method} ${path} failed (${res.status})`);
  return data as T;
}

// ---- Queries ----

export const qk = {
  overview: ["overview"] as const,
  tasks: ["tasks"] as const,
  task: (id: string) => ["task", id] as const,
  runs: ["runs"] as const,
  run: (id: string) => ["run", id] as const,
  memory: ["memory"] as const,
  memoryHistory: (tier: MemoryTier) => ["memory-history", tier] as const,
  cycles: ["cycles"] as const,
  improvements: ["improvements"] as const,
  dreams: ["dreams"] as const,
  dreamNotes: (id: string) => ["dream-notes", id] as const,
  hooks: ["hooks"] as const,
  notes: ["notes"] as const,
  jobs: ["jobs"] as const,
  sandboxes: ["sandboxes"] as const,
  skills: ["skills"] as const,
  skill: (id: string) => ["skill", id] as const,
  bridge: ["bridge"] as const,
  automations: ["automations"] as const,
  automationRuns: (id: string) => ["automation-runs", id] as const,
  webcache: ["webcache"] as const,
};

export const api = {
  overview: () => getJson<OverviewResponse>("/api/overview"),
  tasks: () => getJson<TasksResponse>("/api/tasks"),
  task: (id: string) => getJson<TaskDetailResponse>(`/api/tasks/${id}`),
  runs: (opts?: { limit?: number; task?: string; kind?: string }) =>
    getJson<RunsResponse>("/api/runs", { limit: opts?.limit ?? 200, task: opts?.task, kind: opts?.kind }),
  run: (id: string) => getJson<RunDetailResponse>(`/api/runs/${id}`),
  memory: () => getJson<MemoryResponse>("/api/memory"),
  memoryHistory: (tier: MemoryTier) =>
    getJson<MemoryHistoryResponse>(`/api/memory/${tier}/history`),
  cycles: () => getJson<CyclesResponse>("/api/cycles"),
  improvements: () => getJson<ImprovementsResponse>("/api/improvements"),
  dreams: () => getJson<DreamsResponse>("/api/dreams"),
  dreamNotes: (id: string) => getJson<DreamNotesResponse>(`/api/dreams/${id}/notes`),
  hooks: (limit = 200) => getJson<HooksResponse>("/api/hooks", { limit }),
  notes: (limit = 40) => getJson<NotesResponse>("/api/notes", { limit }),
  jobs: () => getJson<JobsResponse>("/api/jobs"),
  sandboxes: () => getJson<SandboxesResponse>("/api/sandboxes"),
  skills: (project?: string) =>
    getJson<SkillsResponse>("/api/skills", project ? { project } : undefined),
  skill: (id: string) => getJson<SkillDetailResponse>(`/api/skills/${id}`),
  bridge: () => getJson<BridgeResponse>("/api/bridge"),
  automations: () => getJson<AutomationsResponse>("/api/automations"),
  automationRuns: (id: string, limit = 20) =>
    getJson<AutomationRunsResponse>(`/api/automations/${id}/runs`, { limit }),
  webCacheStats: () => getJson<WebCacheStats>("/api/webcache"),
};

// ---- Mutations ----

export const mutations = {
  runTask: (taskId: string) => postJson<{ started: boolean }>(`/api/tasks/${taskId}/run`),
  prompt: (prompt: string) => postJson<{ started: boolean }>("/api/agent/prompt", { prompt }),
  dreamRun: () =>
    postJson<{ started?: boolean; pendingNotes?: number; skipped?: string }>("/api/dreams/run"),
  rollback: (tier: MemoryTier, version: number) =>
    postJson<{ ok: boolean }>(`/api/memory/${tier}/rollback`, { version }),
  skillRollback: (id: string, version: number) =>
    postJson<{ ok: boolean }>(`/api/skills/${id}/rollback`, { version }),
  skillRetire: (id: string) => postJson<{ ok: boolean }>(`/api/skills/${id}/retire`),
  jobTrigger: (id: string) => postJson<{ ok: boolean; result?: unknown }>(`/api/jobs/${id}/trigger`),
  jobToggle: (id: string) => postJson<{ job: Job }>(`/api/jobs/${id}/toggle`),
  mintTask: () => postJson<MintResponse>("/api/tasks/mint"),
  noteCreate: (content: string, projectPath: string) =>
    postJson<NoteCreateResponse>("/api/notes", { content, project_path: projectPath }),
  notesSync: () => postJson<NotesSyncResponse>("/api/notes/sync"),
  automationCreate: (body: {
    title: string;
    prompt: string;
    cron?: string;
    delayMinutes?: number;
    mode?: "read-only" | "standard";
    model?: string | null;
    maxRuns?: number | null;
  }) => postJson<{ automation: Automation }>("/api/automations", body),
  automationPatch: (
    id: string,
    patch: {
      title?: string;
      prompt?: string;
      mode?: "read-only" | "standard";
      lifecycle?: "active" | "paused";
      cron?: string;
      maxRuns?: number | null;
    }
  ) => postJson<{ automation: Automation }>(`/api/automations/${id}`, patch, "PATCH"),
  automationDelete: (id: string) => postJson<{ ok: boolean }>(`/api/automations/${id}`, undefined, "DELETE"),
  automationRunNow: (id: string) => postJson<{ ok: boolean }>(`/api/automations/${id}/run`),
  webCacheClear: () => postJson<WebCacheClearResponse>("/api/webcache/clear"),
  webCacheSweep: () => postJson<WebCacheSweepResponse>("/api/webcache/sweep"),
};
