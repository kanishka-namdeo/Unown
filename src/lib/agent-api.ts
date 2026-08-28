// Fetch helpers for the self-learning agent service.
// ALL requests go through the gateway as relative URLs with XTransformPort=3030.

import type {
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
  NotesResponse,
  OverviewResponse,
  RunDetailResponse,
  RunsResponse,
  TasksResponse,
} from "./agent-types";

const PORT = 3030;

export function apiUrl(
  path: string,
  params?: Record<string, string | number | undefined>
) {
  const sp = new URLSearchParams({ XTransformPort: String(PORT) });
  if (params)
    for (const [k, v] of Object.entries(params))
      if (v !== undefined && v !== null) sp.set(k, String(v));
  return `${path}?${sp.toString()}`;
}

const EVENTS_URL = `/api/events?XTransformPort=${PORT}`;

export { EVENTS_URL };

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

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `POST ${path} failed (${res.status})`);
  return data as T;
}

// ---- Queries ----

export const qk = {
  overview: ["overview"] as const,
  tasks: ["tasks"] as const,
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
  bridge: ["bridge"] as const,
};

export const api = {
  overview: () => getJson<OverviewResponse>("/api/overview"),
  tasks: () => getJson<TasksResponse>("/api/tasks"),
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
  bridge: () => getJson<BridgeResponse>("/api/bridge"),
};

// ---- Mutations ----

export const mutations = {
  runTask: (taskId: string) => postJson<{ started: boolean }>(`/api/tasks/${taskId}/run`),
  prompt: (prompt: string) => postJson<{ started: boolean }>("/api/agent/prompt", { prompt }),
  dreamRun: () =>
    postJson<{ started?: boolean; pendingNotes?: number; skipped?: string }>("/api/dreams/run"),
  rollback: (tier: MemoryTier, version: number) =>
    postJson<{ ok: boolean }>(`/api/memory/${tier}/rollback`, { version }),
  jobTrigger: (id: string) => postJson<{ ok: boolean; result?: unknown }>(`/api/jobs/${id}/trigger`),
  jobToggle: (id: string) => postJson<{ job: Job }>(`/api/jobs/${id}/toggle`),
};
