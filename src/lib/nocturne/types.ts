/** Nocturne domain types — the AI-native incident operations data model. benchmarks/nocturne-round/plan.md §1. */

/* ── Plans & caps ── */

export type NocturnePlan = "starter" | "professional" | "enterprise";

export const NOCTURNE_PLAN_CAPS: Record<
  NocturnePlan,
  { seats: number; services: number; rotations: number; runbooks: number }
> = {
  starter: { seats: 5, services: 2, rotations: 2, runbooks: 5 },
  professional: { seats: 25, services: 10, rotations: 10, runbooks: 30 },
  enterprise: { seats: 100, services: 50, rotations: 50, runbooks: 100 },
};

/* ── Roles ── */

export type NocturneRole = "owner" | "admin" | "responder" | "viewer";

export const NocturneRoles: NocturneRole[] = ["owner", "admin", "responder", "viewer"];

/* ── Severities ── */

export type Severity = "sev1" | "sev2" | "sev3" | "sev4";
// sev1 = outage, sev2 = degradation, sev3 = anomaly, sev4 = informational
export const NocturneSeverities: Severity[] = ["sev1", "sev2", "sev3", "sev4"];

/* ── Tenants & users ── */

export interface NocturneTenant {
  id: string;
  slug: string;
  name: string;
  plan: NocturnePlan;
  /** ack + resolve SLA targets in MINUTES, per severity (data-driven, plan-differentiated). */
  slaMinutes: Record<Severity, { ack: number; resolve: number }>;
  /** the 402-cap fields */
  createdAt: string;
}

export interface NocturneUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  /** ISO-8601 tz, e.g. "UTC", "America/Los_Angeles" — display-only, never used in math */
  timezone: string;
}

export interface NocturneMembership {
  id: string;
  tenantId: string;
  userId: string;
  role: NocturneRole;
}

/* ── Services, severity rules & escalation ── */

export interface NocturneService {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  /** the service the on-call rotation schedules (null = no rotation yet). */
  rotationId: string | null;
  /** who pages first for this service (the rotation's window, else an explicit user). */
  escalationPolicy: EscalationPolicy;
  /**
   * Per-severity override of the tenant's resolve SLA: minutes from ack to resolve.
   * null = inherit the tenant target; an incident's effective target = override ?? tenant target.
   */
  slaOverride: Record<Severity, number> | null;
  createdAt: string;
}

export interface EscalationPolicy {
  /** ordered tiers; tier[i] is paged only after tier[0..i-1] stayed silent. */
  tiers: Array<{
    id: string; // "e1", "e2", "e3"
    kind: "rotation" | "user" | "manager"; // rotation → primary seat, user → fixed user, manager → owner-role user of the tenant (deterministic: first owner, else first admin)
    /** minutes of silence before the NEXT tier is paged (tier N uses its own timeout). */
    waitMinutes: number;
    /** null = infinite (the last tier just keeps ringing). */
    toTierIndex: number | null;
  }>;
  /** which severities this policy applies to; defaults to all when null. */
  appliesTo?: Severity[];
}

/* ── On-call rotations ── */
/** A rotation = an ordered seat list that repeats on a period. A "seat" is one
    position in the list; one seat = one user (no multi-user seats, no underpages —
    the demo's deterministic scope). Contiguity invariant: seats tile the timeline
    with zero gaps and no overlaps. */
export interface NocturneRotation {
  id: string;
  tenantId: string;
  name: string;
  /** one seat per entry; `length` = the number of people in the cycle. */
  seats: Array<{
    seatIndex: number; // 0-based position in the cycle
    userId: string;
    /** ISO instant when this seat's shift BEGINS (the tiling's left edge).
        For seats after the first: seats[i].start = seats[i-1].start + i*shiftLengthMs.
        The tiling is checked by `contiguity(seats, shiftLengthMs)` — the PBT invariant. */
    start: string;
  }>;
  /** the shift length every seat gets (ms); e.g. 7 days = 604_800_000. */
  shiftLengthMs: number;
  /** day-of-week + hour the week boundary falls on (e.g. 0=Sunday, 1=Monday …)
      — used only for display ("weekly handoff Sun 00:00"). */
  boundaryDow: number;
  createdAt: string;
}

/** An override: one user pages FOR another user for a bounded window.
    `forUserId` is the person being covered; `userId` is the cover. */
export interface NocturneOverride {
  id: string;
  tenantId: string;
  rotationId: string;
  forUserId: string;
  userId: string; // who is on call during the window
  /** ISO start (inclusive). */
  startsAt: string;
  /** ISO end (exclusive). */
  endsAt: string;
  reason: string;
  createdAt: string;
}

/* ── Alerts & incidents ── */

export interface NocturneAlert {
  id: string;
  tenantId: string;
  /** the free-text key used for DEDUP: same service + same dedupKey inside the window
      = the same logical alert (one incident entry). */
  serviceId: string;
  dedupKey: string;
  /** human-readable title + body. */
  title: string;
  body: string;
  severity: Severity;
  /** the instant this alert fired (ISO). For dedup the engine uses the LATEST fire inside the window. */
  firedAt: string;
  /** ISO of the last alert that merged into this logical alert (the dedup's "last seen"). */
  lastSeenAt: string;
  /** how many raw alerts merged into this one (dedup count — the UI's "×3" chip). */
  count: number;
  /** which incident this alert feeds; null when it was never correlated (a standalone alert). */
  incidentId: string | null;
  createdAt: string;
}

export type IncidentStatus = "triggered" | "acknowledged" | "snoozed" | "resolved";

export type IncidentLifecyclePhase = "triggered" | "acknowledged" | "resolved";

export const NocturneIncidentStatuses: IncidentStatus[] = [
  "triggered",
  "acknowledged",
  "snoozed",
  "resolved",
];

export interface NocturneIncident {
  id: string;
  tenantId: string;
  serviceId: string;
  title: string; // the title of the alert that TRIGGERED the incident
  severity: Severity;
  status: IncidentStatus;
  /** ISO of the trigger alert's `firedAt`. */
  triggeredAt: string;
  /** ISO of the FIRST ack; null while unacked. */
  acknowledgedAt: string | null;
  /** who acked (user id); null while unacked. */
  acknowledgedBy: string | null;
  /** ISO of the last snooze; null when not snoozed. */
  snoozedUntil: string | null;
  /** ISO of resolution; null while open. */
  resolvedAt: string | null;
  resolvedBy: string | null;
  /** the postmortem's id, set when one is written (null = open). */
  postmortemId: string | null;
  /** the escalation tier index currently paging (0-based); null while untriggered or resolved. */
  activeTierIndex: number | null;
  /** ISO of the last escalation tick; null while no tick fired yet. */
  lastEscalatedAt: string | null;
  createdAt: string;
}

/* ── The event-sourced timeline (IMMUTABLE — append-only, like parley's events) ── */

export type TimelineEventKind =
  | "alert_received" // the alert that triggered the incident
  | "alert_deduped" // an alert merged into an open logical alert (count++)
  | "alert_correlated" // a standalone alert was correlated into an open incident
  | "incident_created" // a new incident was born from the trigger alert
  | "acknowledged"
  | "snoozed"
  | "escalated" // a tier advanced (the tier's index in meta)
  | "note"
  | "status_changed" // triggered → acknowledged / acknowledged → snoozed / …
  | "resolved";

export const NocturneTimelineEventKinds: TimelineEventKind[] = [
  "alert_received",
  "alert_deduped",
  "alert_correlated",
  "incident_created",
  "acknowledged",
  "snoozed",
  "escalated",
  "note",
  "status_changed",
  "resolved",
];

export interface NocturneTimelineEvent {
  id: string;
  tenantId: string;
  incidentId: string;
  kind: TimelineEventKind;
  actorId: string | null; // null for system events (alerts, escalations)
  meta: Record<string, unknown>;
  /** ISO — when the event happened. TIMELINE ORDER: sort by `at` then `id`. */
  at: string;
}

/* ── Notes (separate from the timeline so a note can be edited/updated in place) ── */

export interface NocturneNote {
  id: string;
  tenantId: string;
  incidentId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string | null;
}

/* ── Runbooks ── */

export interface NocturneRunbook {
  id: string;
  tenantId: string;
  serviceId: string; // the service this runbook belongs to
  name: string;
  /** the ordered checklist. Each step: `title` + optional `command` (a copy-paste snippet). */
  steps: Array<{ id: string; title: string; command?: string }>;
  /** which severities this runbook is recommended for (empty = all). */
  forSeverities: Severity[];
  createdAt: string;
}

/** Per-incident runbook checklist STATE (the "progress" overlay). */
export interface NocturneChecklistState {
  id: string;
  tenantId: string;
  incidentId: string;
  runbookId: string;
  /** stepId → "pending" | "done" | "skipped" (steps not in the map are pending). */
  stepStates: Record<string, ChecklistStepState>;
  /** ISO of the last step transition. */
  updatedAt: string;
}

/* ── Public status page (per-tenant, by slug) ── */

export interface NocturneComponent {
  id: string;
  tenantId: string;
  serviceId: string;
  /** the component's public label ("API", "Database", "CDN"). */
  name: string;
  /** the component's own status INDEPENDENT of the incident (for manual maintenance windows). */
  status: NocturneComponentStatus;
  /** ISO of the last status change; null when seeded. */
  lastChangedAt: string | null;
  /** short public note ("Scheduled maintenance Sun 02:00–06:00 UTC"). */
  note: string | null;
}

/* ── Postmortems (on resolved incidents) ── */

export interface NocturnePostmortem {
  id: string;
  tenantId: string;
  incidentId: string;
  /** the root-cause writeup (markdown). */
  body: string;
  /** the timeline summary: triggered → ack → escalate → resolve (ms deltas). */
  summary: { triggeredAt: string; acknowledgedAt: string | null; resolvedAt: string };
  /** the action items. */
  actionItems: Array<{
    id: string;
    title: string;
    assigneeId: string | null; // null = unassigned
    due: string | null; // ISO, null = no due
    done: boolean;
    doneAt: string | null;
  }>;
  /** ISO when the postmortem was written (required for a resolved incident). */
  createdAt: string;
  authorId: string;
}

/* ── Audit (immutable, copy-on-write) ── */

export interface NocturneAuditEvent {
  id: string;
  tenantId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  meta: { before: unknown; after: unknown };
  createdAt: string;
}

/* ── Sessions ── */

export interface NocturneSession {
  id: string;
  userId: string;
  tenantId: string;
  expiresAt: string; // ISO — now + 8h TTL
}

/* ── The invite (the parley single-use token pattern) ── */

export interface NocturneInvite {
  id: string;
  tenantId: string;
  email: string;
  role: NocturneRole;
  token: string;
  usedAt: string | null;
  expiresAt: string; // ISO — 24h from creation
  createdAt: string;
}

/* ── The checklist step states & component statuses ── */

export type ChecklistStepState = "pending" | "done" | "skipped";

export const ChecklistStepStates: ChecklistStepState[] = ["pending", "done", "skipped"];

export type NocturneComponentStatus =
  | "operational"
  | "degraded"
  | "down"
  | "maintenance"
  | "unknown";

export const NocturneComponentStatuses: NocturneComponentStatus[] = [
  "operational",
  "degraded",
  "down",
  "maintenance",
  "unknown",
];

/* ── Full state (the seed + store own this shape) ── */

export interface NocturneState {
  version: 1;
  tenants: NocturneTenant[];
  users: NocturneUser[];
  memberships: NocturneMembership[];
  services: NocturneService[];
  rotations: NocturneRotation[];
  overrides: NocturneOverride[];
  alerts: NocturneAlert[];
  incidents: NocturneIncident[];
  timeline: NocturneTimelineEvent[];
  notes: NocturneNote[];
  runbooks: NocturneRunbook[];
  checklists: NocturneChecklistState[];
  components: NocturneComponent[];
  postmortems: NocturnePostmortem[];
  invites: NocturneInvite[];
  audit: NocturneAuditEvent[];
  sessions: NocturneSession[];
  /** monotonic counter for deterministic id generation. */
  seq: number;
}

/* ── The pinned clock ── */

export const AS_OF = "2026-10-28T12:00:00Z";

export const DEMO_PASSWORD = "nocturne-demo-1";
export const HMAC_SECRET = "nocturne-demo-hmac-secret";
export const SESSION_TTL_MS = 8 * 3_600_000;
export const SEED_INTEGER = 0x5e2b7c11;
