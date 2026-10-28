/**
 * Deterministic seed state — fixed timestamps, no randomness.
 * PLAN.md §4: 2 workspaces, 1 demo user, 1 demo flow per workspace,
 * 3 seeded runs per workspace.
 */
import type { FugueState, Flow, Run, StepType, User, Workspace } from "./types";
import { STEP_TYPES } from "./types";

export const SEED_VERSION = 1 as const;

// Fixed ISO timestamps for seeded data — no clock at seed time.
const SEED_TS = "2025-06-01T00:00:00.000Z";

// Demo user credentials (shown in UI login hint; password is a fixed literal).
export const DEMO_USER_EMAIL = "demo@fugue.local";
export const DEMO_USER_PASSWORD = "fugue-demo";

/**
 * Fixed scrypt hash for the demo user (PLAN.md §5, R4).
 * Computed once at seed time with a fixed 16-byte zero salt and committed as a
 * literal so the seed is byte-stable. auth.ts's scryptVerify() re-derives this
 * at login time (N=16384, r=8, p=1) — no runtime randomness in the seed.
 * Salt: 16 zero bytes → hex "00000000000000000000000000000000".
 * Password: DEMO_USER_PASSWORD ("fugue-demo").
 */
const DEMO_USER_PASSWORD_HASH =
  "scrypt:16:00000000000000000000000000000000$ba5ee3e8b6330d0aa816fa69d2bb7e96f7f7c48dbe12a73d069009ac396904bb";
const DEMO_USER_SALT = "00000000000000000000000000000000";

function demoFlow(workspaceId: string, wsSuffix: string): Flow {
  const stPrefix = `st_${wsSuffix}`;
  return {
    id: `fl_${wsSuffix}`,
    workspaceId,
    name: `${wsSuffix === "atlas" ? "Atlas" : "Borealis"} Triage Pipeline`,
    description: "Demo flow: transform → classify → branch → notify",
    enabled: true,
    updatedAt: SEED_TS,
    steps: [
      {
        id: `${stPrefix}_transform`,
        type: "transform",
        name: "Normalise text",
        config: { template: "{{input}}" },
        retry: { maxAttempts: 2 },
      },
      {
        id: `${stPrefix}_classify`,
        type: "classify",
        name: "Classify urgency",
        config: { rules: { urgent: ["urgent", "critical", "asap"], routine: ["routine", "normal"] } },
        retry: { maxAttempts: 1 },
      },
      {
        id: `${stPrefix}_branch`,
        type: "branch",
        name: "Route by label",
        config: {
          when: [
            { field: "labels:urgent", target: `${stPrefix}_notify_urgent` },
            { field: "labels:routine", target: "end" },
          ],
        },
        retry: { maxAttempts: 1 },
      },
      {
        id: `${stPrefix}_notify_urgent`,
        type: "notify",
        name: "Flag urgent",
        config: { message: "Urgent item flagged for review" },
        retry: { maxAttempts: 1 },
      },
    ],
  };
}

/**
 * Build a seeded run (deterministic, no clock).
 */
function seededRun(
  runSeq: number,
  flow: Flow,
  workspaceId: string,
  status: "passed" | "failed",
  textPayload: string,
  offsetDays: number,
): Run {
  // Derive a fixed ISO string per run from SEED_TS + offsetDays (no Date.now).
  const daysInMs = offsetDays * 86400_000;
  const startedAt = new Date(new Date(SEED_TS).getTime() - daysInMs).toISOString();
  const durationMs = 5 * flow.steps.length; // 5ms per step, matching engine's test clock

  const attempts: Run["attempts"] = flow.steps.map((step, i) => ({
    stepId: step.id,
    stepType: step.type,
    name: step.name,
    status: status === "passed" ? "passed" : i === flow.steps.length - 1 ? "failed" : "passed",
    error: status === "failed" && i === flow.steps.length - 1 ? "simulated step failure" : undefined,
    input: { text: textPayload },
    output: status === "failed" && i === flow.steps.length - 1 ? undefined : { text: textPayload },
    durationMs,
    attempt: 1,
  }));

  const notifications: Run["notifications"] =
    status === "passed"
      ? [
          {
            stepId: `${flow.id.replace("fl_", "st_")}_notify_urgent`,
            message: "Urgent item flagged for review",
            at: startedAt,
          },
        ]
      : [];

  return {
    id: `run_${flow.id}_${runSeq}`,
    flowId: flow.id,
    workspaceId,
    status,
    startedAt,
    endedAt: new Date(new Date(startedAt).getTime() + durationMs).toISOString(),
    payload: { text: textPayload },
    attempts,
    notifications,
  };
}

export function seedState(): FugueState {
  const atlas: Workspace = {
    id: "ws_atlas",
    slug: "atlas",
    name: "Atlas",
    description: "Primary operations workspace",
    createdAt: SEED_TS,
  };
  const borealis: Workspace = {
    id: "ws_borealis",
    slug: "borealis",
    name: "Borealis",
    description: "Secondary / experimentation workspace",
    createdAt: SEED_TS,
  };

  const demoUser: User = {
    id: "usr_demo",
    email: DEMO_USER_EMAIL,
    passwordHash: DEMO_USER_PASSWORD_HASH,
    salt: DEMO_USER_SALT,
    createdAt: SEED_TS,
  };

  const atlasFlow = demoFlow(atlas.id, "atlas");
  const borealisFlow = demoFlow(borealis.id, "borealis");

  // 3 seeded runs per workspace (2 passed, 1 failed for atlas; 3 passed for borealis).
  const atlasRuns: Run[] = [
    seededRun(1, atlasFlow, atlas.id, "passed", "urgent: server down", 3),
    seededRun(2, atlasFlow, atlas.id, "failed", "routine: disk cleanup", 2),
    seededRun(3, atlasFlow, atlas.id, "passed", "critical: memory leak", 1),
  ];
  const borealisRuns: Run[] = [
    seededRun(1, borealisFlow, borealis.id, "passed", "asap: page not found", 3),
    seededRun(2, borealisFlow, borealis.id, "passed", "routine: backup rotation", 2),
    seededRun(3, borealisFlow, borealis.id, "passed", "urgent: TLS cert expiry", 1),
  ];

  // seq counter: starts after all seeded ids (ws_atlas=1, ws_borealis=2, usr_demo=3,
  // fl_atlas=4, fl_borealis=5, run_*=6..14 → seq = 15)
  const seq = 15;

  return {
    version: 1,
    workspaces: [atlas, borealis],
    flows: [atlasFlow, borealisFlow],
    runs: [...atlasRuns, ...borealisRuns],
    users: [demoUser],
    sessions: {},
    seq,
  };
}

/**
 * Step-type counts helper — used by stats.ts for a fixed set.
 */
export function emptyStepTypeCounts(): Record<StepType, number> {
  return STEP_TYPES.reduce(
    (acc, t) => {
      acc[t] = 0;
      return acc;
    },
    {} as Record<StepType, number>,
  );
}
