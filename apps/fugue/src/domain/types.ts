/**
 * Fugue domain types — pure, serializable, DOM-free, Node-free.
 *
 * Single source of truth for the app's data model (the fugue.v1 grammar,
 * PLAN §2). Every entity is plain JSON (no class instances, no Date
 * objects); timestamps are ISO-8601 strings. Ids are INTEGERS
 * (deterministic max+1 in `ids.ts`, never random) so exports are
 * byte-stable across boots.
 */

/**
 * The FIVE ScheduleSpec kinds, exactly as the engine's routines define
 * them (routine-schedule.ts). The `event` kind has no time slot at all —
 * it is dispatched by inbound webhook events, never by the tick.
 */
export type ScheduleSpec =
  | { kind: "cron"; expr: string }
  | { kind: "every"; spec: string }
  | { kind: "after"; spec: string }
  | { kind: "once"; delayMinutes: number }
  | { kind: "event"; name: string; filter?: string };

export const SCHEDULE_KINDS: readonly string[] = [
  "cron",
  "every",
  "after",
  "once",
  "event",
];

/** The closed run-status taxonomy (engine outcome codes). */
export type RunStatus =
  | "ok"
  | "failed"
  | "capped"
  | "schema-invalid"
  | "loop-guard"
  | "budget-throttled"
  | "draining";

export const RUN_STATUSES: readonly RunStatus[] = [
  "ok",
  "failed",
  "capped",
  "schema-invalid",
  "loop-guard",
  "budget-throttled",
  "draining",
];

export const MODES = ["read-only", "standard"] as const;
export type Mode = (typeof MODES)[number];

/** A scheduled agent job (the console's authored unit). */
export interface Job {
  id: number;
  title: string;
  prompt: string;
  schedule: ScheduleSpec;
  mode: Mode;
  model: string;
  timezone: string;
  misfire: "skip" | "catch-up";
  spendCap: number | "off";
  createdAt: number;
  updatedAt: number;
}

/** One engine run, as the console renders it (engine accounting only).
 * The engine-facing run view ids are STRINGS (the automation-scoped lane
 * carries qualified 'auto-xxx:manual:yyy' run ids and string task refs);
 * the fixture lane's numeric rows map to their decimal string form. */
export interface RunRecordView {
  id: string;
  taskId: string;
  kind: string;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  tokensIn: number;
  tokensOut: number;
  toolCalls: number;
  turns: number;
  error: string | null;
}

export interface EngineStatusView {
  phase: "warming" | "ready" | "draining";
  pid?: number;
  version?: string;
  memoryVersion?: number;
  dreams?: number;
}

/** The persisted document — top-level schema literal "fugue.v1".
 * Timestamps are plain JSON: ISO-8601 strings OR epoch milliseconds
 * (the Ostinato law: no Date objects in the domain; schedule.ts's
 * projection takes epoch-ms numbers, and both forms serialize to
 * primitive JSON). */
export interface FugueData {
  schema: "fugue.v1";
  jobs: Job[];
  runs: RunRecordView[];
  nextId: number;
}

/** The domain's guard failure (every boundary throws this). */
export class DomainInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainInvariantError";
  }
}
