/**
 * Pure validators for every parley API input. Each returns
 * `{ errors: string[] }` — an empty array means valid; otherwise the
 * 400 body's field-level `errors[]` (the cadence habits-API shape the
 * brief points at). Zero crypto, zero DOM.
 */

import type { Priority, Role, Status } from "./types";
import { PRIORITIES, ROLES, STATUSES } from "./types";

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

export interface LoginInput {
  email: string;
  password: string;
}

export function validateLogin(input: LoginInput): ValidationResult {
  const errors: string[] = [];
  errors.push(...checkEmail(input.email, "Email"));
  if (!String(input.password ?? "").trim()) errors.push("Password is required.");
  return { errors };
}

/* ── create conversation (customer-side) ──────────────────────────── */

export interface CreateConvoInput {
  subject: string;
  customerName: string;
  customerEmail: string;
  priority?: Priority;
}

export const SUBJECT_MAX = 120;

export function validateCreateConvo(input: CreateConvoInput): ValidationResult {
  const errors: string[] = [];
  const subject = String(input.subject ?? "").trim();
  if (subject.length === 0) errors.push("Subject is required.");
  else if (subject.length > SUBJECT_MAX)
    errors.push(`Subject is ${SUBJECT_MAX} characters or fewer — this one has ${subject.length}.`);
  const name = String(input.customerName ?? "").trim();
  if (!name) errors.push("Customer name is required.");
  errors.push(...checkEmail(input.customerEmail, "Customer email"));
  if (input.priority !== undefined && !PRIORITIES.includes(input.priority))
    errors.push(`Priority must be one of: ${PRIORITIES.join(", ")}.`);
  return { errors };
}

/* ── reply ────────────────────────────────────────────────────────── */

export const REPLY_MAX = 4000;

export function validateReply(input: { body: string }): ValidationResult {
  const errors: string[] = [];
  const body = String(input.body ?? "").trim();
  if (!body) errors.push("Reply body is required.");
  else if (body.length > REPLY_MAX)
    errors.push(`Reply is ${REPLY_MAX} characters or fewer — this one has ${body.length}.`);
  return { errors };
}

/* ── assign / status / priority / tags ────────────────────────────── */

/** A real user id (non-empty string) or an explicit null to unassign. */
export function validateAssign(input: { userId: string | null }): ValidationResult {
  const errors: string[] = [];
  if (input.userId !== null && !String(input.userId ?? "").trim())
    errors.push("Assign a user id, or null to unassign.");
  return { errors };
}

export function validateStatus(input: { status: Status }): ValidationResult {
  const errors: string[] = [];
  if (!STATUSES.includes(input.status))
    errors.push(`Status must be one of: ${STATUSES.join(", ")}.`);
  return { errors };
}

export function validatePriority(input: { priority: Priority }): ValidationResult {
  const errors: string[] = [];
  if (!PRIORITIES.includes(input.priority))
    errors.push(`Priority must be one of: ${PRIORITIES.join(", ")}.`);
  return { errors };
}

export const TAG_MAX = 32;

/**
 * An array of label strings — existing or new. Each is trimmed,
 * non-empty, ≤ 32 chars, and the set is de-duplicated (case-insensitively).
 */
export function validateTags(input: { tags: string[] }): ValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(input.tags)) return { errors: ["Tags must be an array."], };
  const seen = new Set<string>();
  for (const raw of input.tags) {
    const label = String(raw ?? "").trim();
    if (!label) errors.push("Tags must not be empty.");
    else if (label.length > TAG_MAX)
      errors.push(`Tag labels are ${TAG_MAX} characters or fewer — "${label.slice(0, 20)}…" has ${label.length}.`);
    else if (seen.has(label.toLowerCase()))
      errors.push(`Duplicate tag: "${label}".`);
    else seen.add(label.toLowerCase());
  }
  return { errors };
}

/* ── invites ──────────────────────────────────────────────────────── */

export interface InviteInput {
  email: string;
  role: Role;
}

/**
 * email + one of the 4 roles. The owner-seat guard is a SERVER check
 * (the rbac resource carve-out); here we validate the shape only.
 */
export function validateInvite(input: InviteInput): ValidationResult {
  const errors: string[] = [];
  errors.push(...checkEmail(input.email, "Email"));
  if (!ROLES.includes(input.role))
    errors.push(`Role must be one of: ${ROLES.join(", ")}.`);
  return { errors };
}

/* ── accept invite ────────────────────────────────────────────────── */

export interface AcceptInviteInput {
  name: string;
  password: string;
}

export function validateAcceptInvite(input: AcceptInviteInput): ValidationResult {
  const errors: string[] = [];
  const name = String(input.name ?? "").trim();
  if (!name) errors.push("Name is required.");
  errors.push(...passwordFloorErrors(input.password));
  return { errors };
}

/* ── canned replies ───────────────────────────────────────────────── */

export const CANNED_TITLE_MAX = 80;

export function validateCanned(
  input: { title: string; body: string },
): ValidationResult {
  const errors: string[] = [];
  const title = String(input.title ?? "").trim();
  if (!title) errors.push("Title is required.");
  else if (title.length > CANNED_TITLE_MAX)
    errors.push(`Title is ${CANNED_TITLE_MAX} characters or fewer.`);
  if (!String(input.body ?? "").trim()) errors.push("Body is required.");
  return { errors };
}

/* ── remove member ────────────────────────────────────────────────── */

/**
 * A real membership id. "Not the owner" and "not yourself" are
 * server-side checks (they need the store); here we validate the id
 * is present.
 */
export function validateRemoveMember(input: { membershipId: string }): ValidationResult {
  const errors: string[] = [];
  if (!String(input.membershipId ?? "").trim()) errors.push("Membership id is required.");
  return { errors };
}
