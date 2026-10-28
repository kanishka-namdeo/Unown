/**
 * Fugue domain types — all exported interfaces, no `any`.
 * See PLAN.md §2.
 */

// ── Workspaces ──

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  description: string;
  createdAt: string;
}

// ── Flows ──

export type StepType = "transform" | "classify" | "enrich" | "branch" | "notify";

export const STEP_TYPES: StepType[] = ["transform", "classify", "enrich", "branch", "notify"];

export interface RetryPolicy {
  /** Must be ≥ 1. */
  maxAttempts: number;
}

export interface TransformStepConfig {
  /** Template with {{input}} / {{field}} placeholders. */
  template: string;
}

export interface ClassifyStepConfig {
  /** Label → keyword list; first matching label wins. */
  rules: Record<string, string[]>;
}

export interface EnrichStepConfig {
  /** Static fields shallow-merged onto the payload. */
  fields: Record<string, unknown>;
}

export interface BranchWhen {
  /** A payload key, or "labels:<label>". */
  field: string;
  equals?: unknown;
  /** Target: a step id or "end". */
  target?: string;
}

export interface BranchStepConfig {
  when: BranchWhen[];
}

export interface NotifyStepConfig {
  message?: string;
}

export type StepConfig =
  | TransformStepConfig
  | ClassifyStepConfig
  | EnrichStepConfig
  | BranchStepConfig
  | NotifyStepConfig;

export interface FlowStep {
  id: string;
  type: StepType;
  name: string;
  config: StepConfig;
  retry: RetryPolicy;
}

export interface Flow {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  enabled: boolean;
  updatedAt: string;
  steps: FlowStep[];
}

// ── Runs ──

export type RunStatus = "running" | "passed" | "failed";

export interface StepAttempt {
  stepId: string;
  stepType: StepType;
  name: string;
  status: "passed" | "failed";
  error?: string;
  /** Payload snapshot BEFORE this step. Truncated to 500 chars. */
  input: unknown;
  /** Payload snapshot AFTER this step; absent on failed attempts. */
  output?: unknown;
  durationMs: number;
  /** 1-based attempt number. */
  attempt: number;
}

export interface RunNotification {
  stepId: string;
  message: string;
  at: string;
}

export interface Run {
  id: string;
  flowId: string;
  workspaceId: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  /** Final payload after all steps. */
  payload: unknown;
  attempts: StepAttempt[];
  notifications: RunNotification[];
}

// ── Stats ──

export interface WorkspaceStats {
  totalRuns: number;
  /** 0..1 */
  passRate: number;
  meanDurationMs: number;
  mostUsedStepType: StepType | null;
  stepTypeCounts: Record<StepType, number>;
}

// ── Auth ──

export interface User {
  id: string;
  email: string;
  /** scrypt hash: `salty:saltlen:salt$hex` */
  passwordHash: string;
  salt: string;
  createdAt: string;
}

/** The only user shape that crosses the API boundary — never includes password/salt. */
export interface PublicUser {
  id: string;
  email: string;
  createdAt: string;
}

// ── Store ──

export interface FugueState {
  version: 1;
  workspaces: Workspace[];
  flows: Flow[];
  /** Retention: latest 50 per workspace. */
  runs: Run[];
  users: User[];
  sessions: Record<string, { userId: string; createdAt: string; expiresAt: string }>;
  /** Monotonic counter for deterministic id generation. */
  seq: number;
}

// ── Validation ──

export interface FieldError {
  path: string;
  message: string;
}

export type FlowDraft = Omit<Flow, "id" | "workspaceId" | "updatedAt" | "enabled"> & {
  steps: Array<Omit<FlowStep, "id"> & { id?: string }>;
};

export type ValidationResult =
  | { ok: true; flow: Flow }
  | { ok: false; errors: FieldError[] };
