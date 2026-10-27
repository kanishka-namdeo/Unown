export type ColumnId = "backlog" | "doing" | "review" | "done";

export const COLUMNS: readonly { id: ColumnId; title: string }[] = [
  { id: "backlog", title: "Backlog" },
  { id: "doing", title: "Doing" },
  { id: "review", title: "Review" },
  { id: "done", title: "Done" },
] as const;

export type Priority = "low" | "medium" | "high";

export const PRIORITIES: readonly Priority[] = ["low", "medium", "high"] as const;

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  labels: string[];
  storyPoints: number | null;
  column: ColumnId;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  completedAt: string | null; // ISO, set when moved to done
  focusSessions: FocusSession[];
}

export interface FocusSession {
  id: string;
  startedAt: string; // ISO
  durationMin: number; // actual focused minutes
  completed: boolean;
}

export interface TaskDraft {
  title: string;
  description?: string;
  priority?: Priority;
  labels?: string[];
  storyPoints?: number | null;
  column?: ColumnId;
}

export interface FocusTimerConfig {
  focusMin: number;
  breakMin: number;
}

export interface FocusLogEntry {
  taskId: string;
  startedAt: string; // ISO
  durationMin: number;
}

export interface AppStore {
  version: 1;
  tasks: Task[];
  focusLog: FocusLogEntry[];
  timer: FocusTimerConfig;
  theme: "dark" | "light";
}

/** Raw shape persisted in localStorage (validated on load). */
export interface PersistedStore {
  version: 1;
  tasks: unknown;
  focusLog: unknown;
  timer: unknown;
  theme: unknown;
}
