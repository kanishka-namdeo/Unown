import type { FocusLogEntry, Task } from "@/lib/sigil/types";

/**
 * Shared in-memory store for the API routes. This is best-effort sync only;
 * the UI's source of truth is localStorage. Data resets on server restart.
 */
const store: { tasks: Task[]; focusLog: FocusLogEntry[] } = {
  tasks: [],
  focusLog: [],
};

export function getServerTasks(): Task[] {
  return store.tasks;
}

export function setServerTasks(tasks: Task[]): Task[] {
  store.tasks = tasks;
  return tasks;
}

export function getServerFocusLog(): FocusLogEntry[] {
  return store.focusLog;
}

export function setServerFocusLog(log: FocusLogEntry[]): FocusLogEntry[] {
  store.focusLog = log;
  return log;
}
