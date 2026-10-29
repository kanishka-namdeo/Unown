/**
 * Pure validators for every Nocturne API input. Each returns
 * `{ errors: string[] }` — an empty array means valid; otherwise the
 * 400 body's field-level `errors[]` (the parley/cadence shape).
 * Zero crypto, zero DOM, zero I/O.
 *
 * Includes the plan's rotation contiguity check (§4.4): a rotation's
 * seats must tile the timeline with zero gaps and no overlaps —
 * structural at create time (400), never checked at read time.
 */

import type {
  NocturneRotation,
  NocturneService,
  Severity,
} from "./types";
import { NocturneRoles, NocturneSeverities } from "./types";

export interface ValidationResult {
  errors: string[];
}

/* ── shared primitives ────────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function checkEmail(email: string, field: string): string[] {
  const v = String(email ?? "").trim();
  if (!v) return [`${field} is required.`];
  if (!EMAIL_RE.test(v)) return [`${field} must be a valid email address.`];
  return [];
}

function checkIso(v: unknown, field: string, errors: string[]): void {
  if (typeof v !== "string" || Number.isNaN(new Date(v).getTime())) {
    errors.push(`${field} must be a valid ISO-8601 timestamp.`);
  }
}

/** The password complexity floor for a REAL credential (accept-invite):
 * 8+ chars, at least one letter and one digit. */
export function passwordFloorErrors(password: string): string[] {
  const v = String(password ?? "");
  const out: string[] = [];
  if (v.length < 8) out.push("Password must be at least 8 characters.");
  if (!/[a-zA-Z]/.test(v)) out.push("Password must contain at least one letter.");
  if (!/\d/.test(v)) out.push("Password must contain at least one digit.");
  return out;
}

/* ── login ────────────────────────────────────────────────────────── */

export function validateLogin(input: { email: string; password: string }): ValidationResult {
  const errors: string[] = [];
  errors.push(...checkEmail(input.email, "Email"));
  if (!String(input.password ?? "").trim()) errors.push("Password is required.");
  return { errors };
}

/* ── tenant settings (PATCH) ──────────────────────────────────────── */

export function validateTenantPatch(input: {
  name?: string;
  slaMinutes?: Record<Severity, { ack: number; resolve: number }>;
}): ValidationResult {
  const errors: string[] = [];
  if (input.name !== undefined) {
    const name = String(input.name ?? "").trim();
    if (!name) errors.push("Name is required.");
    else if (name.length > 80) errors.push("Name is 80 characters or fewer.");
  }
  if (input.slaMinutes !== undefined) {
    for (const sev of NocturneSeverities) {
      const t = input.slaMinutes[sev];
      if (!t || !Number.isFinite(t.ack) || t.ack <= 0 || !Number.isFinite(t.resolve) || t.resolve <= 0) {
        errors.push(`SLA targets for ${sev} must be positive minutes (ack + resolve).`);
      }
    }
  }
  return { errors };
}

/* ── services ─────────────────────────────────────────────────────── */

export interface CreateServiceInput {
  name: string;
  description: string;
  rotationId?: string | null;
  escalationPolicy?: NocturneService["escalationPolicy"];
}

export interface NocturneServiceInput {
  name: string;
  description: string;
  rotationId?: string | null;
  escalationPolicy?: import("./types").EscalationPolicy;
  slaOverride?: Record<Severity, number> | null;
}

export function validateService(input: NocturneServiceInput, partial?: boolean): ValidationResult {
  const errors: string[] = [];
  if (!partial || input.name !== undefined) {
    const name = String(input.name ?? "").trim();
    if (!name) errors.push("Name is required.");
    else if (name.length > 80) errors.push("Name is 80 characters or fewer.");
  }
  if (input.description !== undefined && typeof input.description !== "string") {
    errors.push("Description must be a string.");
  }
  if (input.slaOverride !== undefined && input.slaOverride !== null) {
    for (const sev of NocturneSeverities) {
      const v = input.slaOverride[sev];
      if (v !== undefined && (!Number.isFinite(v) || v <= 0)) {
        errors.push(`slaOverride.${sev} must be positive minutes.`);
      }
    }
  }
  if (input.escalationPolicy !== undefined) {
    errors.push(...validateEscalationPolicy(input.escalationPolicy).errors);
  }
  return { errors };
}

/* ── escalation policies ──────────────────────────────────────────── */

export function validateEscalationPolicy(policy: import("./types").EscalationPolicy): ValidationResult {
  const errors: string[] = [];
  if (!policy || !Array.isArray(policy.tiers)) {
    return { errors: ["An escalation policy needs an ordered tiers array."] };
  }
  if (policy.tiers.length === 0) {
    errors.push("At least one escalation tier is required.");
  }
  const seen = new Set<string>();
  policy.tiers.forEach((t, i) => {
    if (!t?.id || String(t.id).trim() === "") errors.push(`Tier ${i + 1} needs an id.`);
    else if (seen.has(t.id)) errors.push(`Duplicate tier id "${t.id}".`);
    else seen.add(t.id);
    if (t.kind !== "rotation" && t.kind !== "user" && t.kind !== "manager") {
      errors.push(`Tier ${i + 1} kind must be "rotation" | "user" | "manager".`);
    }
    if (!Number.isFinite(t.waitMinutes) || t.waitMinutes <= 0) {
      errors.push(`Tier ${i + 1} waitMinutes must be a positive number.`);
    }
  if (t.toTierIndex !== null && t.toTierIndex !== undefined) {
      if (!Number.isInteger(t.toTierIndex) || t.toTierIndex < 0 || t.toTierIndex >= policy.tiers.length) {
        errors.push(`Tier ${i + 1} toTierIndex must be null or a valid index into the tiers.`);
      }
      // every earlier tier MUST point at a LATER tier (the ladder is
      // forward-only); the last tier's toTierIndex stays null (infinite ring).
      if (t.toTierIndex !== null && t.toTierIndex <= i) {
        errors.push(`Tier ${i + 1} toTierIndex must point forward (at a LATER tier).`);
      }
    }
    if (i === policy.tiers.length - 1 && t.toTierIndex !== null && t.toTierIndex !== undefined) {
      errors.push("The last tier keeps ringing: toTierIndex must be null.");
    }
  });
  if (policy.appliesTo !== undefined && policy.appliesTo !== null) {
    if (!Array.isArray(policy.appliesTo)) {
      errors.push("appliesTo must be an array of severities.");
    } else {
      for (const s of policy.appliesTo) {
        if (!NocturneSeverities.includes(s)) errors.push(`Unknown severity "${String(s)}".`);
      }
    }
  }
  return { errors };
}

/* ── rotations (the contiguity invariant, §4.4) ──────────────────── */

export interface CreateRotationInput {
  name: string;
  seats: Array<{ userId: string; start: string }>;
  shiftLengthMs: number;
  boundaryDow: number;
}

/**
 * The period (ms) of the strict tiling: seats tile with zero gaps AND
 * the cycle closes: `seats[n-1].start + k*shift == seats[0].start`
 * for some integer cycle length k ≥ 1. The seed rotations use the
 * k = 1 form (4 weekly seats span one 4-week cycle, the tiling wraps
 * within one period); k ≥ 2 covers the repeating-period form (an
 * 8-week tiling stored as 4 seats, etc.). Demo scope: both are
 * zero-gap, no-overlap tilings.
 */
export function rotationContiguity(
  seats: NocturneRotation["seats"],
  shiftLengthMs: number,
): boolean {
  if (!Array.isArray(seats) || seats.length === 0) return false;
  if (!Number.isFinite(shiftLengthMs) || shiftLengthMs <= 0) return false;
  const n = seats.length;
  const starts = seats
    .map((s) => new Date(s.start).getTime())
    .sort((a, b) => a - b);
  // 1. zero gaps, no overlaps on adjacent edges
  for (let i = 0; i < n - 1; i++) {
    if (starts[i]! + shiftLengthMs !== starts[i + 1]!) return false;
  }
  // 2. distinct starts (a duplicate start always breaks the tiling)
  for (let i = 1; i < n; i++) {
    if (starts[i] === starts[i - 1]!) return false;
  }
  // 3. the cycle closes: the span from first to last seat is an
  //    integer multiple of the shift (k ≥ 1 cycles)
  const span = starts[n - 1]! - starts[0]!;
  if (span % shiftLengthMs !== 0) return false;
  return true;
}

export function validateCreateRotation(input: CreateRotationInput): ValidationResult {
  const errors: string[] = [];
  const name = String(input.name ?? "").trim();
  if (!name) errors.push("Name is required.");
  else if (name.length > 80) errors.push("Name is 80 characters or fewer.");

  if (!Number.isFinite(input.shiftLengthMs) || input.shiftLengthMs <= 0) {
    errors.push("shiftLengthMs must be a positive number of milliseconds.");
  }
  if (!Number.isInteger(input.boundaryDow) || input.boundaryDow < 0 || input.boundaryDow > 6) {
    errors.push("boundaryDow must be an integer 0–6 (Sun–Sat).");
  }

  if (!Array.isArray(input.seats) || input.seats.length === 0) {
    errors.push("A rotation needs at least one seat.");
  } else {
    const userIds = new Set<string>();
    input.seats.forEach((seat, i) => {
      const uid = String(seat.userId ?? "").trim();
      if (!uid) errors.push(`Seat ${i + 1} needs a userId.`);
      else if (userIds.has(uid)) errors.push(`Seat ${i + 1} duplicates userId "${uid}" — one seat = one user.`);
      else userIds.add(uid);
      checkIso(seat.start, `Seat ${i + 1} start`, errors);
    });
    // the contiguity gate: reject a gappy/overlapping tiling at create (400).
    const asSeats: NocturneRotation["seats"] = input.seats.map((s, i) => ({
      seatIndex: i,
      userId: String(s.userId ?? ""),
      start: String(s.start ?? ""),
    }));
    if (!errors.some((e) => e.startsWith("Seat")) && !Number.isNaN(new Date(input.seats[0]!.start).getTime()) && Number.isFinite(input.shiftLengthMs) && input.shiftLengthMs > 0) {
      if (!rotationContiguity(asSeats, input.shiftLengthMs)) {
        errors.push(
          "Rotation seats must tile the timeline: adjacent seats start exactly shiftLengthMs apart and the cycle closes on an integer number of shifts (zero gaps, no overlaps).",
        );
      }
    }
  }
  return { errors };
}

export function validateUpdateRotation(input: {
  name?: string;
  shiftLengthMs?: number;
  boundaryDow?: number;
}): ValidationResult {
  const errors: string[] = [];
  if (input.name !== undefined) {
    const name = String(input.name ?? "").trim();
    if (!name) errors.push("Name is required.");
    else if (name.length > 80) errors.push("Name is 80 characters or fewer.");
  }
  if (input.shiftLengthMs !== undefined && (!Number.isFinite(input.shiftLengthMs) || input.shiftLengthMs <= 0)) {
    errors.push("shiftLengthMs must be a positive number of milliseconds.");
  }
  if (input.boundaryDow !== undefined && (!Number.isInteger(input.boundaryDow) || input.boundaryDow < 0 || input.boundaryDow > 6)) {
    errors.push("boundaryDow must be an integer 0–6 (Sun–Sat).");
  }
  return { errors };
}

/* ── overrides ────────────────────────────────────────────────────── */

export function validateCreateOverride(input: {
  forUserId: string;
  userId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
}): ValidationResult {
  const errors: string[] = [];
  const forUserId = String(input.forUserId ?? "").trim();
  const userId = String(input.userId ?? "").trim();
  if (!forUserId) errors.push("forUserId is required (who is being covered).");
  if (!userId) errors.push("userId is required (the cover).");
  if (forUserId && userId && forUserId === userId) {
    errors.push("A cover must be a DIFFERENT user than the one being covered.");
  }
  checkIso(input.startsAt, "startsAt", errors);
  checkIso(input.endsAt, "endsAt", errors);
  const s = new Date(input.startsAt).getTime();
  const e = new Date(input.endsAt).getTime();
  if (!Number.isNaN(s) && !Number.isNaN(e) && s >= e) {
    errors.push("startsAt must be before endsAt (a bounded window, start inclusive, end exclusive).");
  }
  const reason = String(input.reason ?? "").trim();
  if (!reason) errors.push("reason is required.");
  return { errors };
}

/* ── alerts (ingest) ──────────────────────────────────────────────── */

export const ALERT_TITLE_MAX = 200;

export function validateIngestAlert(input: {
  serviceId: string;
  dedupKey: string;
  title: string;
  body: string;
  severity: Severity;
  firedAt?: string;
}): ValidationResult {
  const errors: string[] = [];
  if (!String(input.serviceId ?? "").trim()) errors.push("serviceId is required.");
  const key = String(input.dedupKey ?? "").trim();
  if (!key) errors.push("dedupKey is required.");
  const title = String(input.title ?? "").trim();
  if (!title) errors.push("Title is required.");
  else if (title.length > ALERT_TITLE_MAX)
    errors.push(`Title is ${ALERT_TITLE_MAX} characters or fewer — this one has ${title.length}.`);
  if (typeof input.body !== "string") errors.push("Body must be a string.");
  if (!NocturneSeverities.includes(input.severity)) {
    errors.push(`Severity must be one of: ${NocturneSeverities.join(", ")}.`);
  }
  if (input.firedAt !== undefined) checkIso(input.firedAt, "firedAt", errors);
  return { errors };
}

/* ── incident lifecycle inputs ────────────────────────────────────── */

export const NOTE_MAX = 4000;

export function validateAck(input: { note?: string }): ValidationResult {
  const errors: string[] = [];
  if (input.note !== undefined && String(input.note ?? "").trim().length > NOTE_MAX) {
    errors.push(`Ack note is ${NOTE_MAX} characters or fewer.`);
  }
  return { errors };
}

export function validateResolve(input: {
  postmortemBody?: string;
  actionItems?: Array<{ title: string; assigneeId?: string | null; due?: string | null }>;
}): ValidationResult {
  const errors: string[] = [];
  if (input.postmortemBody !== undefined && !String(input.postmortemBody ?? "").trim()) {
    errors.push("postmortemBody, when given, must be non-empty.");
  }
  if (input.actionItems !== undefined) {
    if (!Array.isArray(input.actionItems)) {
      errors.push("actionItems must be an array.");
    } else {
      input.actionItems.forEach((item, i) => {
        if (!String(item.title ?? "").trim()) errors.push(`Action item ${i + 1} needs a title.`);
        if (item.due !== undefined && item.due !== null) checkIso(item.due, `Action item ${i + 1} due`, errors);
      });
    }
  }
  return { errors };
}

export function validateSnooze(input: { until: string }): ValidationResult {
  const errors: string[] = [];
  checkIso(input.until, "until", errors);
  return { errors };
}

export function validateNote(input: { body: string }): ValidationResult {
  const errors: string[] = [];
  const body = String(input.body ?? "").trim();
  if (!body) errors.push("Note body is required.");
  else if (body.length > NOTE_MAX)
    errors.push(`Note is ${NOTE_MAX} characters or fewer — this one has ${body.length}.`);
  return { errors };
}

/* ── runbooks ─────────────────────────────────────────────────────── */

export const RUNBOOK_NAME_MAX = 120;

export interface CreateRunbookInput {
  serviceId: string;
  name: string;
  steps: Array<{ title: string; command?: string }>;
  forSeverities?: Severity[];
}

export function validateCreateRunbook(input: CreateRunbookInput): ValidationResult {
  const errors: string[] = [];
  if (!String(input.serviceId ?? "").trim()) errors.push("serviceId is required.");
  const name = String(input.name ?? "").trim();
  if (!name) errors.push("Name is required.");
  else if (name.length > RUNBOOK_NAME_MAX)
    errors.push(`Name is ${RUNBOOK_NAME_MAX} characters or fewer.`);
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    errors.push("A runbook needs at least one step.");
  } else {
    input.steps.forEach((s, i) => {
      if (!String(s.title ?? "").trim()) errors.push(`Step ${i + 1} needs a title.`);
      if (s.command !== undefined && typeof s.command !== "string") {
        errors.push(`Step ${i + 1} command must be a string.`);
      }
    });
  }
  if (input.forSeverities !== undefined) {
    if (!Array.isArray(input.forSeverities)) {
      errors.push("forSeverities must be an array of severities.");
    } else {
      for (const s of input.forSeverities) {
        if (!NocturneSeverities.includes(s)) errors.push(`Unknown severity "${String(s)}".`);
      }
    }
  }
  return { errors };
}

export function validateUpdateRunbook(input: {
  name?: string;
  steps?: Array<{ title: string; command?: string }>;
  forSeverities?: Severity[];
}): ValidationResult {
  const errors: string[] = [];
  if (input.name !== undefined) {
    const name = String(input.name ?? "").trim();
    if (!name) errors.push("Name is required.");
    else if (name.length > RUNBOOK_NAME_MAX) errors.push(`Name is ${RUNBOOK_NAME_MAX} characters or fewer.`);
  }
  if (input.steps !== undefined && (!Array.isArray(input.steps) || input.steps.length === 0)) {
    errors.push("A runbook needs at least one step.");
  }
  if (input.forSeverities !== undefined) {
    for (const s of input.forSeverities ?? []) {
      if (!NocturneSeverities.includes(s)) errors.push(`Unknown severity "${String(s)}".`);
    }
  }
  return { errors };
}

/* ── checklists ───────────────────────────────────────────────────── */

export function validateChecklistStart(input: {
  incidentId: string;
  runbookId: string;
}): ValidationResult {
  const errors: string[] = [];
  if (!String(input.incidentId ?? "").trim()) errors.push("incidentId is required.");
  if (!String(input.runbookId ?? "").trim()) errors.push("runbookId is required.");
  return { errors };
}

export function validateChecklistUpdate(input: {
  stepId: string;
  state: "pending" | "done" | "skipped";
}): ValidationResult {
  const errors: string[] = [];
  if (!String(input.stepId ?? "").trim()) errors.push("stepId is required.");
  if (!["pending", "done", "skipped"].includes(input.state)) {
    errors.push('state must be "pending" | "done" | "skipped".');
  }
  return { errors };
}

/* ── components (the status page) ─────────────────────────────────── */

export function validateComponentStatus(input: {
  status: "operational" | "degraded" | "down" | "maintenance" | "unknown";
  note?: string | null;
}): ValidationResult {
  const errors: string[] = [];
  if (!["operational", "degraded", "down", "maintenance", "unknown"].includes(input.status)) {
    errors.push('status must be "operational" | "degraded" | "down" | "maintenance" | "unknown".');
  }
  if (input.note !== undefined && input.note !== null && String(input.note).length > 200) {
    errors.push("note is 200 characters or fewer.");
  }
  return { errors };
}

/* ── invites ──────────────────────────────────────────────────────── */

export function validateInvite(input: { email: string; role: import("./types").NocturneRole }): ValidationResult {
  const errors: string[] = [];
  errors.push(...checkEmail(input.email, "Email"));
  if (!NocturneRoles.includes(input.role)) {
    errors.push(`Role must be one of: ${NocturneRoles.join(", ")}.`);
  }
  return { errors };
}

export function validateAcceptInvite(input: { name: string; password: string }): ValidationResult {
  const errors: string[] = [];
  const name = String(input.name ?? "").trim();
  if (!name) errors.push("Name is required.");
  errors.push(...passwordFloorErrors(input.password));
  return { errors };
}

/* ── postmortem actions ───────────────────────────────────────────── */

export function validatePostmortemAction(input: {
  done: boolean;
  doneAt?: string | null;
}): ValidationResult {
  const errors: string[] = [];
  if (typeof input.done !== "boolean") errors.push("done must be a boolean.");
  if (input.doneAt !== undefined && input.doneAt !== null) checkIso(input.doneAt, "doneAt", errors);
  return { errors };
}
