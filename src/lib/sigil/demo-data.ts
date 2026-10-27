import type { AppStore, Task } from "./types";
import { createTask, moveTask } from "./tasks";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS);
}

/**
 * Build a realistic demo dataset for first-run showcase.
 * Creates 5 tasks spread across columns with labels/priorities/estimates,
 * plus a few days of focus history and completed tasks so stats has life.
 */
export function buildDemoStore(): AppStore {
  const now = new Date();
  const tasks: Task[] = [];

  // Backlog
  tasks.push(
    createTask(
      {
        title: "Refactor notification service",
        description: "Consolidate the three legacy notification paths into one.",
        priority: "medium",
        labels: ["backend", "tech-debt"],
        storyPoints: 8,
        column: "backlog",
      },
      daysAgo(5),
    ),
    createTask(
      {
        title: "Add dark-mode audit to CI",
        description: "Screenshot-diff key routes in both themes.",
        priority: "low",
        labels: ["qa"],
        storyPoints: 3,
        column: "backlog",
      },
      daysAgo(4),
    ),
  );

  // Doing
  tasks.push(
    createTask(
      {
        title: "Ship billing dashboard",
        description: "Invoices, usage meters, and the new pricing tiers.",
        priority: "high",
        labels: ["billing", "feature"],
        storyPoints: 13,
        column: "doing",
      },
      daysAgo(2),
    ),
  );

  // Review
  tasks.push(
    createTask(
      {
        title: "Fix race in session refresh",
        description: "Two parallel token refreshes clobber each other.",
        priority: "high",
        labels: ["bug", "auth"],
        storyPoints: 5,
        column: "review",
      },
      daysAgo(3),
    ),
  );

  // Done — completed over the last 4 days for streak
  const done1 = createTask(
    {
      title: "Perf: lazy-load heavy widgets",
      description: "Code-split the chart module behind a Suspense boundary.",
      priority: "medium",
      labels: ["performance"],
      storyPoints: 5,
      column: "done",
    },
    daysAgo(4),
  );
  const done1M = moveTask(done1, "done", daysAgo(2));
  tasks.push(done1M);

  const done2 = createTask(
    {
      title: "Empty-state illustrations",
      description: "Quiet inline SVGs for board / stats / focus views.",
      priority: "low",
      labels: ["design"],
      storyPoints: 2,
      column: "done",
    },
    daysAgo(3),
  );
  const done2M = moveTask(done2, "done", daysAgo(1));
  tasks.push(done2M);

  const done3 = createTask(
    {
      title: "Write onboarding tour",
      priority: "medium",
      labels: ["growth"],
      storyPoints: 3,
      column: "done",
    },
    daysAgo(1),
  );
  const done3M = moveTask(done3, "done", now);
  tasks.push(done3M);

  // Focus log: attach sessions to a couple of tasks across the last days
  const focusLog: AppStore["focusLog"] = [];
  const deep = tasks[2]; // doing task
  const billing = deep.id;
  focusLog.push(
    { taskId: billing, startedAt: daysAgo(2).toISOString(), durationMin: 50 },
    { taskId: billing, startedAt: daysAgo(1).toISOString(), durationMin: 25 },
    { taskId: done2M.id, startedAt: daysAgo(1).toISOString(), durationMin: 25 },
    { taskId: done3M.id, startedAt: now.toISOString(), durationMin: 25 },
  );

  // Record the sessions onto the tasks too
  const withSessions = tasks.map((t) => {
    const mine = focusLog.filter((f) => f.taskId === t.id);
    if (mine.length === 0) return t;
    return {
      ...t,
      focusSessions: mine.map((f, i) => ({
        id: `${f.taskId}-demo-${i}`,
        startedAt: f.startedAt,
        durationMin: f.durationMin,
        completed: true,
      })),
    };
  });

  return {
    version: 1,
    tasks: withSessions,
    focusLog,
    timer: { focusMin: 25, breakMin: 5 },
    theme: "dark",
  };
}

export const DEMO_BADGE_KEY = "sigil-focus-demo-badge";
