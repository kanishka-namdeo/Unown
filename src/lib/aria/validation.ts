/**
 * Pure validators for every aria API input. Each returns
 * `{ errors: string[] }` — an empty array means valid; otherwise the
 * 400 body's field-level `errors[]`. Zero crypto, zero DOM.
 */

import type {
  AriaPlan,
  AriaRole,
  EntityState,
  LeadPriority,
  TaskPriority,
} from "./types";
import {
  ARIA_PLANS,
  ARIA_ROLES,
  ENTITY_STATES,
  LEAD_PRIORITIES,
  TASK_PRIORITIES,
} from "./types";

export interface ValidationResult {
  errors: string[];
}

/* ── shared primitives ────────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function checkEmail(email: unknown, field: string): string[] {
  const v = String(email ?? "").trim();
  if (!v) return [`${field} is required.`];
  if (!EMAIL_RE.test(v)) return [`${field} must be a valid email address.`];
  return [];
}

/** A YYYY-MM-DD date check (format + real-calendar-date). */
export function checkDate(v: unknown, field: string): string[] {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return [`${field} must be a YYYY-MM-DD date.`];
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return [`${field} must be a valid date.`];
  // Reject impossible dates (e.g. Feb 30) via round-trip: the UTC
  // components must come back as what was given.
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return [`${field} must be a valid date.`];
  }
  return [];
}

/** An ISO timestamp check. */
export function checkIso(v: unknown, field: string): string[] {
  const s = String(v ?? "").trim();
  if (!s) return [`${field} is required.`];
  if (Number.isNaN(new Date(s).getTime())) return [`${field} must be a valid ISO timestamp.`];
  return [];
}

/** A non-negative number check. */
export function checkAmount(v: unknown, field: string): string[] {
  const n = Number(v);
  if (Number.isNaN(n)) return [`${field} must be a number.`];
  if (n < 0) return [`${field} must be non-negative.`];
  return [];
}

/** A positive integer check. */
export function checkPositiveInt(v: unknown, field: string): string[] {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return [`${field} must be a positive integer.`];
  return [];
}

/**
 * The password complexity floor for a REAL credential (invite accept):
 * 8+ chars, at least one letter and one digit.
 */
export function passwordFloorErrors(password: unknown): string[] {
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

/* ── account ──────────────────────────────────────────────────────── */

export interface CreateAccountInput {
  name: string;
  domain: string;
  industry: string;
  size: number;
  ownerId: string;
}

export function validateCreateAccount(input: CreateAccountInput): ValidationResult {
  const errors: string[] = [];
  const name = String(input.name ?? "").trim();
  if (!name) errors.push("Name is required.");
  else if (name.length > 120) errors.push("Name is 120 characters or fewer.");
  const domain = String(input.domain ?? "").trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(domain))
    errors.push("Domain must be a valid company email domain (e.g. acme.com).");
  if (!String(input.industry ?? "").trim()) errors.push("Industry is required.");
  if (Number.isNaN(Number(input.size))) errors.push("Size must be a number.");
  else if (Number(input.size) < 1) errors.push("Size must be at least 1 employee.");
  if (!String(input.ownerId ?? "").trim()) errors.push("Owner id is required.");
  return { errors };
}

export function validateUpdateAccount(input: Partial<{ name: string; industry: string; size: number; status: string }>): ValidationResult {
  const errors: string[] = [];
  if (input.name !== undefined && !String(input.name).trim()) errors.push("Name must be non-empty when provided.");
  if (input.status !== undefined && input.status !== "active" && input.status !== "inactive")
    errors.push('Status must be "active" or "inactive".');
  if (input.size !== undefined && (Number.isNaN(Number(input.size)) || Number(input.size) < 1))
    errors.push("Size must be a positive number when provided.");
  return { errors };
}

/* ── contact ──────────────────────────────────────────────────────── */

export interface CreateContactInput {
  accountId: string;
  name: string;
  email: string;
  title: string;
  ownerId: string;
  traits?: { replyRate?: number; openRate?: number; busySignal?: boolean };
}

export function validateCreateContact(input: CreateContactInput): ValidationResult {
  const errors: string[] = [];
  if (!String(input.accountId ?? "").trim()) errors.push("Account id is required.");
  if (!String(input.name ?? "").trim()) errors.push("Name is required.");
  errors.push(...checkEmail(input.email, "Email"));
  if (!String(input.title ?? "").trim()) errors.push("Title is required.");
  if (!String(input.ownerId ?? "").trim()) errors.push("Owner id is required.");
  if (input.traits !== undefined) errors.push(...checkTraits(input.traits, "Traits"));
  return { errors };
}

export function checkTraits(
  traits: { replyRate?: number; openRate?: number; busySignal?: boolean } | undefined,
  field: string,
): string[] {
  const errors: string[] = [];
  if (traits === undefined || traits === null) return errors;
  for (const rate of [traits.replyRate, traits.openRate]) {
    if (rate !== undefined && (typeof rate !== "number" || rate < 0 || rate > 1))
      errors.push(`${field} rates must be in 0..1.`);
  }
  if (traits.busySignal !== undefined && typeof traits.busySignal !== "boolean")
    errors.push(`${field}.busySignal must be a boolean.`);
  return errors;
}

export function validateUpdateContact(input: Partial<{ name: string; title: string; email: string; traits?: CreateContactInput["traits"] }>): ValidationResult {
  const errors: string[] = [];
  if (input.email !== undefined) errors.push(...checkEmail(input.email, "Email"));
  if (input.traits !== undefined) errors.push(...checkTraits(input.traits, "Traits"));
  return { errors };
}

/* ── lead ─────────────────────────────────────────────────────────── */

export interface CreateLeadInput {
  name: string;
  email: string;
  source: string;
  priority: LeadPriority;
  ownerId: string;
}

export function validateCreateLead(input: CreateLeadInput): ValidationResult {
  const errors: string[] = [];
  if (!String(input.name ?? "").trim()) errors.push("Name is required.");
  errors.push(...checkEmail(input.email, "Email"));
  if (!String(input.source ?? "").trim()) errors.push("Source is required.");
  if (!LEAD_PRIORITIES.includes(input.priority))
    errors.push(`Priority must be one of: ${LEAD_PRIORITIES.join(", ")}.`);
  if (!String(input.ownerId ?? "").trim()) errors.push("Owner id is required.");
  return { errors };
}

export function validateUpdateLead(input: Partial<{ status: string; source: string; priority: LeadPriority }>): ValidationResult {
  const errors: string[] = [];
  const statuses = ["new", "working", "nurturing", "unqualified", "qualified", "converted"];
  if (input.status !== undefined && !statuses.includes(input.status))
    errors.push(`Status must be one of: ${statuses.join(", ")}.`);
  if (input.priority !== undefined && !LEAD_PRIORITIES.includes(input.priority))
    errors.push(`Priority must be one of: ${LEAD_PRIORITIES.join(", ")}.`);
  return { errors };
}

/* ── pipeline ─────────────────────────────────────────────────────── */

export interface CreatePipelineInput {
  name: string;
  stages: Array<{ name: string; probability: number; state: string }>;
}

export function validateCreatePipeline(input: CreatePipelineInput): ValidationResult {
  const errors: string[] = [];
  if (!String(input.name ?? "").trim()) errors.push("Name is required.");
  if (!Array.isArray(input.stages) || input.stages.length === 0) {
    errors.push("Stages must be a non-empty array.");
    return { errors };
  }
  input.stages.forEach((s, i) => {
    if (!String(s.name ?? "").trim()) errors.push(`Stage ${i + 1} name is required.`);
    if (Number.isNaN(Number(s.probability)) || Number(s.probability) < 0 || Number(s.probability) > 1)
      errors.push(`Stage ${i + 1} probability must be in 0..1.`);
    if (s.state !== "open" && s.state !== "closed_won" && s.state !== "closed_lost")
      errors.push(`Stage ${i + 1} state must be "open", "closed_won" or "closed_lost".`);
  });
  return { errors };
}

/* ── deal ─────────────────────────────────────────────────────────── */

export interface CreateDealInput {
  pipelineId: string;
  stageId: string;
  accountId: string;
  contactId: string;
  amount: number;
  forecastCategory: string;
  ownerId: string;
  expectedCloseDate: string;
}

export function validateCreateDeal(input: CreateDealInput): ValidationResult {
  const errors: string[] = [];
  if (!String(input.pipelineId ?? "").trim()) errors.push("Pipeline id is required.");
  if (!String(input.stageId ?? "").trim()) errors.push("Stage id is required.");
  if (!String(input.accountId ?? "").trim()) errors.push("Account id is required.");
  if (!String(input.contactId ?? "").trim()) errors.push("Contact id is required.");
  errors.push(...checkAmount(input.amount, "Amount"));
  const categories = ["pipeline", "best_case", "commit", "omitted", "closed"];
  if (!categories.includes(input.forecastCategory))
    errors.push(`Forecast category must be one of: ${categories.join(", ")}.`);
  if (!String(input.ownerId ?? "").trim()) errors.push("Owner id is required.");
  errors.push(...checkDate(input.expectedCloseDate, "Expected close date"));
  return { errors };
}

export function validateUpdateDeal(input: Partial<{
  amount: number;
  stageId: string;
  forecastCategory: string;
  expectedCloseDate: string;
  ownerId: string;
  lostReason: string | null;
}>): ValidationResult {
  const errors: string[] = [];
  if (input.amount !== undefined) errors.push(...checkAmount(input.amount, "Amount"));
  if (input.forecastCategory !== undefined) {
    const categories = ["pipeline", "best_case", "commit", "omitted", "closed"];
    if (!categories.includes(input.forecastCategory))
      errors.push(`Forecast category must be one of: ${categories.join(", ")}.`);
  }
  if (input.expectedCloseDate !== undefined)
    errors.push(...checkDate(input.expectedCloseDate, "Expected close date"));
  return { errors };
}

/* ── activity / task / note / tag ─────────────────────────────────── */

export interface CreateActivityInput {
  kind: string;
  entityType: EntityState;
  entityId: string;
  body: string;
}

export function validateCreateActivity(input: CreateActivityInput): ValidationResult {
  const errors: string[] = [];
  const kinds = ["call", "email", "meeting", "note", "system"];
  if (!kinds.includes(input.kind)) errors.push(`Kind must be one of: ${kinds.join(", ")}.`);
  const allowed: EntityState[] = ["account", "contact", "deal"];
  if (!allowed.includes(input.entityType))
    errors.push(`Entity type must be one of: ${allowed.join(", ")}.`);
  if (!String(input.entityId ?? "").trim()) errors.push("Entity id is required.");
  if (!String(input.body ?? "").trim()) errors.push("Body is required.");
  return { errors };
}

export interface CreateTaskInput {
  title: string;
  ownerId: string;
  entityType: EntityState;
  entityId: string;
  due: string;
  priority: TaskPriority;
}

export function validateCreateTask(input: CreateTaskInput): ValidationResult {
  const errors: string[] = [];
  if (!String(input.title ?? "").trim()) errors.push("Title is required.");
  if (!String(input.ownerId ?? "").trim()) errors.push("Owner id is required.");
  if (!ENTITY_STATES.includes(input.entityType))
    errors.push(`Entity type must be one of: ${ENTITY_STATES.join(", ")}.`);
  if (!String(input.entityId ?? "").trim()) errors.push("Entity id is required.");
  errors.push(...checkIso(input.due, "Due"));
  if (!TASK_PRIORITIES.includes(input.priority))
    errors.push(`Priority must be one of: ${TASK_PRIORITIES.join(", ")}.`);
  return { errors };
}

export function validateUpdateTask(input: Partial<{ title: string; due: string; priority: TaskPriority; done: boolean; doneAt: string | null }>): ValidationResult {
  const errors: string[] = [];
  if (input.due !== undefined) errors.push(...checkIso(input.due, "Due"));
  if (input.priority !== undefined && !TASK_PRIORITIES.includes(input.priority))
    errors.push(`Priority must be one of: ${TASK_PRIORITIES.join(", ")}.`);
  if (input.done !== undefined && typeof input.done !== "boolean")
    errors.push("Done must be a boolean.");
  return { errors };
}

export function validateCreateNote(input: { entityType: EntityState; entityId: string; body: string }): ValidationResult {
  const errors: string[] = [];
  if (!ENTITY_STATES.includes(input.entityType))
    errors.push(`Entity type must be one of: ${ENTITY_STATES.join(", ")}.`);
  if (!String(input.entityId ?? "").trim()) errors.push("Entity id is required.");
  if (!String(input.body ?? "").trim()) errors.push("Body is required.");
  else if (String(input.body).length > 4000) errors.push("Body is 4000 characters or fewer.");
  return { errors };
}

export const TAG_MAX = 32;

export function validateCreateTag(input: { label: string }): ValidationResult {
  const errors: string[] = [];
  const label = String(input.label ?? "").trim();
  if (!label) errors.push("Label is required.");
  else if (label.length > TAG_MAX)
    errors.push(`Label is ${TAG_MAX} characters or fewer.`);
  return { errors };
}

/* ── sequence / enrollment ───────────────────────────────────────── */

export interface CreateSequenceInput {
  name: string;
  steps: unknown[];
  traitSeed: number;
}

export function validateCreateSequence(input: CreateSequenceInput): ValidationResult {
  const errors: string[] = [];
  if (!String(input.name ?? "").trim()) errors.push("Name is required.");
  if (typeof input.traitSeed !== "number" || input.traitSeed < 0 || input.traitSeed > 1)
    errors.push("Trait seed must be a number in 0..1.");
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    errors.push("Steps must be a non-empty array.");
    return { errors };
  }
  const seen = new Set<string>();
  const types = ["email", "wait", "task", "branch"];
  input.steps.forEach((raw, i) => {
    const s = raw as Record<string, unknown>;
    if (typeof s?.id !== "string" || !s.id) errors.push(`Step ${i + 1} id is required.`);
    else if (seen.has(s.id)) errors.push(`Duplicate step id '${s.id}'.`);
    else seen.add(s.id);
    if (!types.includes(s?.type as string))
      errors.push(`Step ${i + 1} type must be one of: ${types.join(", ")}.`);
    if (s?.type === "email") {
      const e = s.email as Record<string, unknown> | undefined;
      if (!e || typeof e.templateId !== "string" || !e.templateId)
        errors.push(`Step ${i + 1}: email.templateId is required.`);
      if (!e || typeof e.subject !== "string" || !e.subject)
        errors.push(`Step ${i + 1}: email.subject is required.`);
    }
    if (s?.type === "wait") {
      if (typeof s.waitDays !== "number" || s.waitDays < 0)
        errors.push(`Step ${i + 1}: waitDays must be a non-negative number.`);
    }
    if (s?.type === "task") {
      const t = s.task as Record<string, unknown> | undefined;
      if (!t || typeof t.title !== "string" || !t.title)
        errors.push(`Step ${i + 1}: task.title is required.`);
    }
    if (s?.type === "branch") {
      const b = s.branch as Record<string, unknown> | undefined;
      if (!b || !["none", "replied", "opened", "meeting_booked"].includes(b.onEngagement as string))
        errors.push(`Step ${i + 1}: branch.onEngagement must be none/replied/opened/meeting_booked.`);
      if (b?.targetStepId !== undefined && (typeof b.targetStepId !== "string" || !seen.has(b.targetStepId)))
        errors.push(`Step ${i + 1}: branch.targetStepId must reference an earlier or declared step id.`);
    }
  });
  return { errors };
}

export function validateCreateEnrollment(input: { contactId: string; sequenceId: string }): ValidationResult {
  const errors: string[] = [];
  if (!String(input.contactId ?? "").trim()) errors.push("Contact id is required.");
  if (!String(input.sequenceId ?? "").trim()) errors.push("Sequence id is required.");
  return { errors };
}

/* ── invite / member ─────────────────────────────────────────────── */

export function validateInvite(input: { email: string; role: AriaRole }): ValidationResult {
  const errors: string[] = [];
  errors.push(...checkEmail(input.email, "Email"));
  if (!ARIA_ROLES.includes(input.role))
    errors.push(`Role must be one of: ${ARIA_ROLES.join(", ")}.`);
  return { errors };
}

export function validateAcceptInvite(input: { name: string; password: string }): ValidationResult {
  const errors: string[] = [];
  if (!String(input.name ?? "").trim()) errors.push("Name is required.");
  errors.push(...passwordFloorErrors(input.password));
  return { errors };
}

/* ── tenant settings ─────────────────────────────────────────────── */

export function validateTenantPatch(input: Partial<{ name: string; plan: AriaPlan; quotas: Record<string, number> }>): ValidationResult {
  const errors: string[] = [];
  if (input.name !== undefined && !String(input.name).trim())
    errors.push("Tenant name must be non-empty when provided.");
  if (input.plan !== undefined && !ARIA_PLANS.includes(input.plan))
    errors.push(`Plan must be one of: ${ARIA_PLANS.join(", ")}.`);
  if (input.quotas !== undefined) {
    if (typeof input.quotas !== "object" || input.quotas === null || Array.isArray(input.quotas)) {
      errors.push("Quotas must be an object (rep id → dollars).");
    } else {
      for (const [k, v] of Object.entries(input.quotas)) {
        if (!k || typeof v !== "number" || v < 0)
          errors.push(`Quota for "${k || "?"}" must be a non-negative number.`);
      }
    }
  }
  return { errors };
}

/* ── import (CSV) ────────────────────────────────────────────────── */

export function validateImport(input: { type: string; csv: string; dryRun: boolean }): ValidationResult {
  const errors: string[] = [];
  if (input.type !== "contacts" && input.type !== "deals")
    errors.push('Type must be "contacts" or "deals".');
  if (!String(input.csv ?? "").trim()) errors.push("CSV content is required.");
  return { errors };
}
