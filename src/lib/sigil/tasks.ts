import type { ColumnId, FocusLogEntry, Priority, Task } from "./types";
import { COLUMNS, PRIORITIES } from "./types";

export function uid(): string {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createTask(
  draft: {
    title: string;
    description?: string;
    priority?: Priority;
    labels?: string[];
    storyPoints?: number | null;
    column?: ColumnId;
  },
  now: Date = new Date(),
): Task {
  const iso = now.toISOString();
  return {
    id: uid(),
    title: draft.title.trim(),
    description: (draft.description ?? "").trim(),
    priority: draft.priority ?? "medium",
    labels: (draft.labels ?? []).slice(0, 8).map((l) => l.trim()).filter(Boolean),
    storyPoints: draft.storyPoints == null ? null : clampStoryPoints(draft.storyPoints),
    column: draft.column ?? "backlog",
    createdAt: iso,
    updatedAt: iso,
    completedAt: draft.column === "done" ? iso : null,
    focusSessions: [],
  };
}

export function clampStoryPoints(v: number): number | null {
  if (!Number.isFinite(v)) return null;
  const n = Math.round(v);
  if (n < 1) return null;
  if (n > 64) return 64;
  return n;
}

export function isColumnId(v: unknown): v is ColumnId {
  return COLUMNS.some((c) => c.id === v);
}

export function isPriority(v: unknown): v is Priority {
  return PRIORITIES.includes(v as Priority);
}

/**
 * Coerce arbitrary data (from localStorage or API) into valid tasks.
 * Invalid entries are dropped; valid ones are normalized.
 */
export function normalizeTasks(raw: unknown): Task[] {
  if (!Array.isArray(raw)) return [];
  const out: Task[] = [];
  for (const item of raw) {
    const t = normalizeTask(item);
    if (t) out.push(t);
  }
  return out;
}

export function normalizeTask(raw: unknown): Task | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  if (typeof r.title !== "string" || r.title.trim().length === 0) return null;
  const column = isColumnId(r.column) ? r.column : "backlog";
  const priority = isPriority(r.priority) ? r.priority : "medium";
  const labels = Array.isArray(r.labels)
    ? r.labels.filter((l): l is string => typeof l === "string").slice(0, 8)
    : [];
  const completedAt =
    typeof r.completedAt === "string"
      ? r.completedAt
      : column === "done"
        ? (typeof r.updatedAt === "string" ? r.updatedAt : nowIso())
        : null;
  const sessions: Task["focusSessions"] = Array.isArray(r.focusSessions)
    ? r.focusSessions
        .filter(
          (s): s is Record<string, unknown> =>
            typeof s === "object" && s !== null,
        )
        .map((s) => ({
          id: typeof s.id === "string" ? s.id : uid(),
          startedAt: typeof s.startedAt === "string" ? s.startedAt : nowIso(),
          durationMin:
            typeof s.durationMin === "number" && s.durationMin > 0
              ? s.durationMin
              : 25,
          completed: Boolean(s.completed),
        }))
    : [];
  return {
    id: r.id,
    title: r.title,
    description: typeof r.description === "string" ? r.description : "",
    priority,
    labels,
    storyPoints: clampStoryPoints(r.storyPoints as unknown as number),
    column,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : nowIso(),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : nowIso(),
    completedAt,
    focusSessions: sessions,
  };
}

export function normalizeFocusLog(raw: unknown): FocusLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: FocusLogEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.taskId !== "string" || typeof r.startedAt !== "string") continue;
    const durationMin =
      typeof r.durationMin === "number" && r.durationMin > 0 ? r.durationMin : 0;
    out.push({ taskId: r.taskId, startedAt: r.startedAt, durationMin });
  }
  return out;
}

export function moveTask(task: Task, column: ColumnId, now: Date = new Date()): Task {
  const iso = now.toISOString();
  return {
    ...task,
    column,
    updatedAt: iso,
    completedAt: column === "done" ? iso : null,
  };
}
