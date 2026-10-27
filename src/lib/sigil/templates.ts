import type { TaskDraft } from "./types";

export interface StarterTemplate {
  id: string;
  name: string;
  description: string;
  tasks: TaskDraft[];
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "blank",
    name: "Blank board",
    description: "Start with an empty board and define your own workflow.",
    tasks: [],
  },
  {
    id: "sprint",
    name: "Two-week sprint",
    description: "A compact sprint: a few committed tasks plus a backlog of candidates.",
    tasks: [
      { title: "Ship login fix", description: "Users are bounced on session refresh.", priority: "high", labels: ["bug"], storyPoints: 5, column: "doing" },
      { title: "Onboarding email", description: "Welcome sequence for new signups.", priority: "medium", labels: ["growth"], storyPoints: 8, column: "backlog" },
      { title: "Perf audit", description: "Profile the dashboard page, target < 2s LCP.", priority: "medium", labels: ["performance"], storyPoints: 13, column: "backlog" },
      { title: "Changelog automation", description: "Generate release notes from merged PRs.", priority: "low", labels: ["tooling"], storyPoints: 3, column: "review" },
      { title: "Fix flaky e2e test", description: "Timer spec fails intermittently in CI.", priority: "high", labels: ["test"], storyPoints: 2, column: "done" },
    ],
  },
  {
    id: "focus-daily",
    name: "Daily focus",
    description: "One clear priority plus a short list of small wins for today.",
    tasks: [
      { title: "Deep work block", description: "The one thing that moves the needle today.", priority: "high", labels: ["deep-work"], storyPoints: 5, column: "doing" },
      { title: "Clear inbox", priority: "low", labels: ["admin"], storyPoints: 1, column: "backlog" },
      { title: "Write meeting notes", priority: "medium", labels: ["admin"], storyPoints: 1, column: "backlog" },
      { title: "Plan tomorrow", priority: "medium", labels: ["planning"], storyPoints: 2, column: "review" },
    ],
  },
  {
    id: "product-launch",
    name: "Product launch",
    description: "Track launch prep across engineering, design and marketing.",
    tasks: [
      { title: "Launch page", description: "Hero, pricing, FAQ.", priority: "high", labels: ["marketing", "design"], storyPoints: 8, column: "backlog" },
      { title: "Pricing API", priority: "high", labels: ["backend"], storyPoints: 13, column: "doing" },
      { title: "Press kit", priority: "low", labels: ["marketing"], storyPoints: 3, column: "backlog" },
      { title: "Billing integration QA", priority: "high", labels: ["qa", "backend"], storyPoints: 5, column: "review" },
      { title: "Analytics events", description: "Track activation funnel.", priority: "medium", labels: ["data"], storyPoints: 3, column: "done" },
    ],
  },
];

export function getTemplate(id: string): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((t) => t.id === id);
}
