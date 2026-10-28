/**
 * Aria domain types — the enterprise CRM data model.
 * benchmarks/aria-round/plan.md §1.
 *
 * Conventions (the plan's literal list):
 *  - Row-level tenancy: every tenant-owned row carries `tenantId`.
 *  - Deterministic ids: `${prefix}_${seq}` for live rows (the store's
 *    `seq` counter), seed-constant prefixed ids for seeded rows.
 *  - Every time-dependent field is an ISO string; every domain
 *    function takes an explicit `now`.
 *  - `AS_OF` anchor: 2026-10-28T12:00:00Z; the seed spans 2026-04..2026-10.
 */

/* ── Plans ────────────────────────────────────────────────────────── */

export type AriaPlan = "starter" | "growth" | "enterprise";
export const ARIA_PLANS: AriaPlan[] = ["starter", "growth", "enterprise"];

/** Per-plan caps: seats, pipelines and sequences (plan §1). */
export const ARIA_PLAN_CAPS: Record<AriaPlan, { seats: number; pipelines: number; sequences: number }> = {
  starter: { seats: 5, pipelines: 1, sequences: 1 },
  growth: { seats: 25, pipelines: 4, sequences: 10 },
  enterprise: { seats: 100, pipelines: 20, sequences: 50 },
};

/* ── Roles ────────────────────────────────────────────────────────── */

export type AriaRole = "owner" | "admin" | "manager" | "rep" | "viewer";
export const ARIA_ROLES: AriaRole[] = ["owner", "admin", "manager", "rep", "viewer"];

export type LeadPriority = "low" | "normal" | "high" | "urgent";
export const LEAD_PRIORITIES: LeadPriority[] = ["low", "normal", "high", "urgent"];

export type TaskPriority = "low" | "normal" | "high" | "urgent";
export const TASK_PRIORITIES: TaskPriority[] = ["low", "normal", "high", "urgent"];

export type LeadStatus = "new" | "working" | "nurturing" | "unqualified" | "qualified";
export const LEAD_STATUSES: LeadStatus[] = ["new", "working", "nurturing", "unqualified", "qualified"];

export type AccountStatus = "active" | "inactive";
export const ACCOUNT_STATUSES: AccountStatus[] = ["active", "inactive"];

export type ForecastCategory = "pipeline" | "best_case" | "commit" | "omitted" | "closed";
export const FORECAST_CATEGORIES: ForecastCategory[] = [
  "pipeline",
  "best_case",
  "commit",
  "omitted",
  "closed",
];

export type DealStatus = "open" | "won" | "lost";

export type EntityState = "account" | "contact" | "deal" | "lead";
export const ENTITY_STATES: EntityState[] = ["account", "contact", "deal", "lead"];

/* ── Tenants & users ──────────────────────────────────────────────── */

export interface AriaTenant {
  id: string;
  slug: string;
  name: string;
  plan: AriaPlan;
  /** Per-rep annual quota in $ (the period is a quarter). */
  quotas: Record<string, number>;
  /** manager → rep ids they supervise. */
  manages: Record<string, string[]>;
  /** Lead SLA: first-response minutes by lead priority. */
  leadSlaMinutes: Record<LeadPriority, number>;
  createdAt: string;
}

export interface AriaUser {
  id: string;
  email: string;
  name: string;
  /** scrypt hash (hex), paired with `salt`. */
  passwordHash: string;
  /** demo-constant salt (public-by-design for the iframe demo). */
  salt: string;
  createdAt: string;
}

export interface AriaMembership {
  id: string;
  tenantId: string;
  userId: string;
  role: AriaRole;
}

/* ── CRM entities ─────────────────────────────────────────────────── */

export interface AriaAccount {
  id: string;
  tenantId: string;
  name: string;
  /** The company email domain. */
  domain: string;
  /** Industry (for firmographic fit). */
  industry: string;
  /** Employee count. */
  size: number;
  /** The rep who owns the account. */
  ownerId: string;
  status: AccountStatus;
  createdAt: string;
}

export interface AriaContact {
  id: string;
  tenantId: string;
  accountId: string;
  name: string;
  email: string;
  title: string;
  ownerId: string;
  /** Traits the sequence engine seeds deterministically from. */
  traits: { replyRate: number; openRate: number; busySignal: boolean };
  createdAt: string;
}

export interface AriaLead {
  id: string;
  tenantId: string;
  status: LeadStatus;
  source: string;
  priority: LeadPriority;
  /** ISO — set when the first reply to this lead landed. */
  firstResponseAt: string | null;
  /** ISO — created + SLA target by priority. */
  slaDueAt: string;
  /** Null until converted. */
  converted: { accountId: string; contactId: string; dealId: string | null; at: string } | null;
  ownerId: string;
  createdAt: string;
}

export interface AriaPipeline {
  id: string;
  tenantId: string;
  name: string;
  /** Ordered stages; index = position. open = not won/lost, closed = won|lost. */
  stages: Array<{
    id: string;
    name: string;
    probability: number;
    state: "open" | "closed_won" | "closed_lost";
  }>;
  createdAt: string;
}

export interface AriaDeal {
  id: string;
  tenantId: string;
  pipelineId: string;
  /** The current stage within the pipeline. */
  stageId: string;
  accountId: string;
  contactId: string;
  /** USD. */
  amount: number;
  forecastCategory: ForecastCategory;
  ownerId: string;
  /** YYYY-MM-DD. */
  expectedCloseDate: string;
  /** ISO when the deal closed (won or lost); null while open. */
  closedAt: string | null;
  /** REQUIRED when moving to a lost stage. */
  lostReason: string | null;
  /** ISO of the LAST stage change — the stalled-days signal. */
  lastStageChangeAt: string;
  createdAt: string;
}

/* ── Activities & tasks ───────────────────────────────────────────── */

export type ActivityKind = "call" | "email" | "meeting" | "note" | "system";
export const ACTIVITY_KINDS: ActivityKind[] = ["call", "email", "meeting", "note", "system"];

export interface AriaActivity {
  id: string;
  tenantId: string;
  kind: ActivityKind;
  /** Which entity the activity is attached to. */
  entityType: "account" | "contact" | "deal";
  entityId: string;
  body: string;
  /** Null for system events. */
  actorId: string | null;
  at: string;
}

export interface AriaTask {
  id: string;
  tenantId: string;
  title: string;
  ownerId: string;
  entityType: "account" | "contact" | "deal" | "lead";
  entityId: string;
  /** ISO. */
  due: string;
  priority: TaskPriority;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
}

/* ── Notes & tags ─────────────────────────────────────────────────── */

export interface AriaNote {
  id: string;
  tenantId: string;
  entityType: "account" | "contact" | "deal" | "lead";
  entityId: string;
  authorId: string;
  body: string;
  at: string;
}

export interface AriaTag {
  id: string;
  tenantId: string;
  label: string;
}

/* ── Sequences (the deterministic cadence engine) ─────────────────── */

export type SeqStepType = "email" | "wait" | "task" | "branch";
export const SEQ_STEP_TYPES: SeqStepType[] = ["email", "wait", "task", "branch"];

export interface AriaSequence {
  id: string;
  tenantId: string;
  name: string;
  /** The ordered step list. */
  steps: Array<SeqStep>;
  /** The deterministic trait seed the engine uses (0..1). */
  traitSeed: number;
  createdAt: string;
}

export interface SeqStep {
  id: string;
  type: SeqStepType;
  name: string;
  /** email step: the template + variables. */
  email?: {
    templateId: string;
    subject: string;
    body: string;
    variables?: Record<string, string>;
  };
  /** wait step: business days to wait. */
  waitDays?: number;
  /** task step: the task title + priority. */
  task?: { title: string; priority: TaskPriority };
  /** branch step: on engagement state. */
  branch?: { onEngagement: "none" | "replied" | "opened" | "meeting_booked"; targetStepId?: string };
}

export type AriaEngagement = "sent" | "open" | "reply" | "meeting_booked";
export const ARIA_ENGAGEMENTS: AriaEngagement[] = ["sent", "open", "reply", "meeting_booked"];

export interface AriaEnrollment {
  id: string;
  tenantId: string;
  contactId: string;
  sequenceId: string;
  state:
    | "enrolled"
    | "active"
    | "completed"
    | "exited_by_reply"
    | "exited_manually"
    | "bounced";
  /** The current step cursor. */
  stepIndex: number;
  /** ISO — when the enrollment was created. */
  createdAt: string;
  /** ISO — when the enrollment reached a terminal state. */
  completedAt: string | null;
  /** The deterministic per-contact trait multiplier (0..1). */
  traitMult: number;
}

export interface AriaEmailTemplate {
  id: string;
  tenantId: string;
  subject: string;
  body: string;
  variables: string[];
  createdAt: string;
}

/* ── The deterministic engagement event log (simulated from traits) ─ */

export interface AriaEngagementEvent {
  id: string;
  tenantId: string;
  enrollmentId: string;
  kind: AriaEngagement;
  /** ISO. */
  at: string;
}

/* ── Mailbox (the simulated outbound) ─────────────────────────────── */

export interface AriaMailboxMessage {
  id: string;
  tenantId: string;
  /** Null for manual outbound. */
  enrollmentId: string | null;
  contactId: string;
  subject: string;
  body: string;
  /** ISO. */
  at: string;
  /** The deterministic engagement outcome (sent → open → reply?). */
  outcome: "sent" | "opened" | "replied" | "bounced";
}

/* ── Quotas ───────────────────────────────────────────────────────── */

export interface AriaQuota {
  id: string;
  tenantId: string;
  userId: string;
  /** ISO of the period start (quarter boundary). */
  periodStart: string;
  /** ISO of the period end. */
  periodEnd: string;
  /** USD. */
  target: number;
}

/* ── Forecast snapshots (IMMUTABLE) ───────────────────────────────── */

export interface AriaForecastSnapshot {
  id: string;
  tenantId: string;
  /** ISO quarter start. */
  periodStart: string;
  periodEnd: string;
  /** ISO — when the snapshot was taken. */
  capturedAt: string;
  /** The weighted pipeline total at capture. */
  weightedTotal: number;
  /** Per-stage breakdown. */
  byStage: Record<string, number>;
  /** Per-category breakdown. */
  byCategory: Record<string, number>;
  /** The raw record ids this total was computed from (drill-down). */
  dealIds: string[];
}

/* ── Audit (immutable, copy-on-write) ─────────────────────────────── */

export interface AriaAuditEvent {
  id: string;
  tenantId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  meta: { before: unknown; after: unknown };
  createdAt: string;
}

/* ── Sessions ─────────────────────────────────────────────────────── */

export interface AriaSession {
  id: string;
  userId: string;
  tenantId: string;
  /** ISO — now + 8h TTL. */
  expiresAt: string;
}

/* ── Full state (the seed + store own this shape) ────────────────── */

export interface AriaState {
  version: 1;
  tenants: AriaTenant[];
  users: AriaUser[];
  memberships: AriaMembership[];
  accounts: AriaAccount[];
  contacts: AriaContact[];
  leads: AriaLead[];
  pipelines: AriaPipeline[];
  deals: AriaDeal[];
  activities: AriaActivity[];
  tasks: AriaTask[];
  notes: AriaNote[];
  tags: AriaTag[];
  sequences: AriaSequence[];
  enrollments: AriaEnrollment[];
  emailTemplates: AriaEmailTemplate[];
  engagementEvents: AriaEngagementEvent[];
  mailbox: AriaMailboxMessage[];
  quotas: AriaQuota[];
  forecastSnapshots: AriaForecastSnapshot[];
  sessions: AriaSession[];
  audit: AriaAuditEvent[];
  /** Monotonic counter for deterministic id generation. */
  seq: number;
}

/* ── The pinned clock (the repo's pinned clock) ──────────────────── */

export const AS_OF = "2026-10-28T12:00:00Z";

/** The demo seed constants (plan §1). */
export const DEMO_PASSWORD = "aria-demo-1";
export const HMAC_SECRET = "aria-demo-hmac-secret";
export const SESSION_TTL_MS = 8 * 3_600_000;

/** The seed's fixed integer RNG seed (the parley SEED_INTEGER discipline). */
export const SEED_INTEGER = 0x47a1d3c5;
