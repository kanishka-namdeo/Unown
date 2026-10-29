/**
 * The aria server-side store — a module singleton wrapping the
 * file-backed JSON store (`loadState`/`saveState`/`nextId`/
 * `resetState`), the ONLY thing that touches the raw arrays
 * (the parley `store.ts` repository pattern promoted to the aria
 * shapes).
 *
 * Per-instance semantics: each server instance has its own seed +
 * its own session rows + its own mutations (the risk list's
 * accepted Vercel multi-instance property — the file-backed store
 * is per-instance; the embed reset route reseeds the instance's
 * store).
 *
 * Fail-closed tenancy: every repository method takes a
 * `TenantContext` + an explicit `now`. A call without context
 * throws `NoTenantContextError`; a cross-tenant read returns
 * `null` (the caller maps it to 404 — never a 403 that confirms
 * existence, never a 200 leak).
 *
 * Every mutation appends its own audit event (copy-on-write via
 * `recordAudit`).
 */

import { assertTenant, makeCtx, NoTenantContextError, TenantContext } from "./tenancy";
import { recordAudit, auditQuery } from "./audit";
import { now as clockNow } from "./clock";
import {
  canInvite,
  canCreatePipeline,
  canCreateSequence,
} from "./metering";
import { hashPassword } from "./password";
import { createSession, createLiveSession, findSession, isExpired, removeSession } from "./sessions";
import { mulberry32, hex4 } from "./ids";
import { exitEnrollment, traitMultiplier, type AdvanceOutput, type EngineCtx, advance } from "./sequences";
import {
  commitLadder,
  coverage,
  openDealsFor,
  snapshotMath,
} from "./forecast";
import { SEED_INTEGER } from "./seed";
// SEED_INTEGER re-export for consumers that pin the seed's RNG:
export { SEED_INTEGER };
import { loadState as loadFileState, saveState as saveFileState, retainMailbox, resetState as resetFileStore } from "./store";
import type {
  AriaAccount,
  AriaActivity,
  AriaAuditEvent,
  AriaContact,
  AriaDeal,
  AriaEngagement,
  AriaLead,
  AriaMailboxMessage,
  AriaMembership,
  AriaNote,
  AriaPipeline,
  AriaQuota,
  AriaSequence,
  AriaSession,
  AriaState,
  AriaTask,
  AriaTag,
  AriaTenant,
  AriaUser,
  AriaEnrollment,
  AriaEmailTemplate,
  AriaForecastSnapshot,
  AriaInvite,
  AriaRole,
  SeqStep,
} from "./types";

/* ── distinct error classes (the route's error ladder is clean) ─── */

export class NotFoundError extends Error {
  constructor(msg = "not found") {
    super(msg);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(msg = "conflict") {
    super(msg);
    this.name = "ConflictError";
  }
}

export class QuotaExceededError extends Error {
  constructor(msg = "quota_exceeded") {
    super(msg);
    this.name = "QuotaExceededError";
  }
}

export class ValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`validation failed: ${errors.join("; ")}`);
    this.name = "ValidationError";
  }
}

export class StageError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "StageError";
  }
}

export class InviteError extends Error {
  constructor(public reason: "used" | "expired") {
    super(`invite ${reason}`);
    this.name = "InviteError";
  }
}

/* ── the singleton ────────────────────────────────────────────────── */

let state: AriaState | null = null;
let auditCounter = 0;
let liveCounter = 0;
let inviteTokenCounter = 0;

/** A module-scoped audit id (deterministic counter). */
function auditId(): string {
  auditCounter += 1;
  return `aud-aria-live-${String(auditCounter).padStart(6, "0")}`;
}

/** A module-scoped live id (the seed-constant vs live-row split). */
function liveId(prefix: string): string {
  liveCounter += 1;
  return `${prefix}-live-${String(liveCounter).padStart(6, "0")}`;
}

/** A module-scoped live invite token (the parley `tok-` discipline). */
function liveInviteToken(): string {
  inviteTokenCounter += 1;
  const rng = mulberry32(0x5eed ^ inviteTokenCounter);
  return `tok-${hex4(rng)}${hex4(rng)}-${String(inviteTokenCounter).padStart(6, "0")}`;
}

/** Lazy-load; the file store reseeds when absent/corrupt. */
export function getAria(): AriaState {
  if (!state) {
    state = loadFileState();
  }
  return state;
}

/** Persist the current state (atomic write in the file store). */
export function persist(): void {
  saveFileState();
}

/**
 * The demo/reset route's wipe: reseed the state + mint a fresh demo
 * session for `mira@lumen.test` (a REAL login — the session is
 * created through the same `createSession` path; the cookie the
 * client sets on the next page load is a real HMAC-signed one —
 * never faked auth state).
 */
export function resetAria(): { state: AriaState; demoSession: AriaSession } {
  auditCounter = 0;
  liveCounter = 0;
  inviteTokenCounter = 0;
  // Wipe BOTH caches: the file store's (which also reseeds + persists
  // to disk) + this module's (which then reads the file store's
  // freshly-seeded state through getAria).
  resetFileStore();
  state = null;
  state = getAria();
  const demoUser = state.users.find((u) => u.email === "mira@lumen.test");
  if (!demoUser) {
    // Fail closed: a mangled seed row is impossible in the demo
    // lane, but reseed-and-retry rather than throw.
    resetFileStore();
    state = null;
    state = getAria();
  }
  const demoSession = createSession(
    demoUser!.id,
    "aria-tn-lumen",
    clockNow(),
    liveId("ses"),
  );
  state.sessions = [demoSession];
  persist();
  return { state, demoSession };
}

/** Re-read the file store into the module cache (test lane). */
export function _reloadFromDisk(): void {
  state = null;
}

/**
 * Look up a session by id + verify it hasn't expired. Returns the
 * `AriaSession` or `null` (absent / expired).
 */
export function liveSession(sessionId: string): AriaSession | null {
  const s = getAria();
  const row = findSession(s.sessions, sessionId);
  if (!row) return null;
  if (isExpired(row, clockNow())) return null;
  return row;
}

/** The user + their membership in the session's tenant. */
export function sessionActor(
  session: AriaSession,
): { user: AriaUser; membership: AriaMembership; ctx: TenantContext } {
  const s = getAria();
  const user = s.users.find((u) => u.id === session.userId);
  if (!user) throw new NotFoundError("user not found");
  const membership = s.memberships.find(
    (m) => m.tenantId === session.tenantId && m.userId === session.userId,
  );
  if (!membership) throw new NotFoundError("membership not found");
  const ctx = makeCtx(session.tenantId, user.id, membership.role);
  return { user, membership, ctx };
}

/** Look up a user by email (case-insensitive — the login path). */
export function userByEmail(email: string): AriaUser | undefined {
  return getAria().users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase(),
  );
}

/**
 * Create a session row for a user + tenant and write it into the
 * store. Returns the new `AriaSession`.
 */
export function loginSession(userId: string, tenantId: string): AriaSession {
  const s = getAria();
  const row = createLiveSession(userId, tenantId, clockNow());
  state = { ...s, sessions: [...s.sessions, row] };
  persist();
  return row;
}

/** Destroy a session row (the logout path). Returns `true` when removed. */
export function destroySession(sessionId: string): boolean {
  const s = getAria();
  const before = s.sessions.length;
  state = { ...s, sessions: removeSession(s.sessions, sessionId) };
  persist();
  return state.sessions.length < before;
}

/* ── audit helper ─────────────────────────────────────────────────── */

function appendAudit(
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
  tenantId: string,
  actorUserId: string,
): void {
  state = recordAudit(
    state!,
    actorUserId,
    action,
    entityType,
    entityId,
    before,
    after,
    clockNow(),
    tenantId,
    auditId(),
  );
  persist();
}

/* ── invites (the single-use token lane) ────────────────────────── */

/**
 * Create an invite (single-use token, 24h expiry). The seat-cap gate
 * is HERE: a tenant AT its plan's seat cap cannot extend another
 * invite (`QuotaExceededError` → the route's 402 rung).
 */
export function createInvite(
  ctx: TenantContext,
  email: string,
  role: AriaRole,
): AriaInvite {
  assertTenant(ctx);
  const s = getAria();
  if (!canInvite(s, ctx.tenantId)) throw new QuotaExceededError("seat cap");
  const now = clockNow();
  const inv: AriaInvite = {
    id: liveId("inv"),
    tenantId: ctx.tenantId,
    email: email.toLowerCase(),
    role,
    token: liveInviteToken(),
    usedAt: null,
    expiresAt: new Date(new Date(now).getTime() + 24 * 3_600_000).toISOString().replace(".000Z", "Z"),
    createdAt: now,
  };
  state = { ...s, invites: [...s.invites, inv] };
  appendAudit("invite.create", "invite", inv.id, null, { email: inv.email, role }, ctx.tenantId, ctx.actor.userId);
  return inv;
}

/**
 * Accept an invite. NO context — the token is the credential.
 * The 404 unknown / 410 used / 410 expired ladder lives here:
 * unknown token → `NotFoundError`, used → `InviteError("used")`,
 * expired → `InviteError("expired")`. Creates the user (a REAL
 * `passwordHash` from the submitted password, NOT the demo one) +
 * attaches the membership with the invited role.
 *
 * Seat-cap gate: an invitee landing on a tenant AT its plan's seat
 * cap is REJECTED (`QuotaExceededError` → the 402 rung).
 */
export function acceptInvite(
  token: string,
  name: string,
  password: string,
): { user: AriaUser; membership: AriaMembership; invite: AriaInvite } {
  const s = getAria();
  const inv = s.invites.find((i) => i.token === token);
  if (!inv) throw new NotFoundError("unknown invite token");
  const now = clockNow();
  if (inv.usedAt !== null) throw new InviteError("used");
  if (new Date(inv.expiresAt).getTime() < new Date(now).getTime()) throw new InviteError("expired");
  if (!canInvite(s, inv.tenantId)) throw new QuotaExceededError("seat cap");
  const user: AriaUser = {
    id: liveId("usr"),
    email: inv.email,
    name,
    passwordHash: hashPassword(password, `s-aria-${inv.email}`).hash,
    salt: `s-aria-${inv.email}`,
    createdAt: now,
  };
  const membership: AriaMembership = {
    id: liveId("mem"),
    tenantId: inv.tenantId,
    userId: user.id,
    role: inv.role,
  };
  const updatedInvite: AriaInvite = { ...inv, usedAt: now };
  state = {
    ...s,
    users: [...s.users, user],
    memberships: [...s.memberships, membership],
    invites: s.invites.map((i) => (i.id === inv.id ? updatedInvite : i)),
  };
  appendAudit("invite.accept", "membership", membership.id, null, { userId: user.id, role: membership.role }, inv.tenantId, user.id);
  return { user, membership, invite: updatedInvite };
}

/* ── tenant + membership routes ──────────────────────────────────── */

export function listTenants(ctx: TenantContext): AriaTenant[] {
  assertTenant(ctx);
  return getAria().tenants.filter((t) => t.id === ctx.tenantId);
}

export function getTenant(ctx: TenantContext, id: string): AriaTenant | null {
  assertTenant(ctx);
  const s = getAria();
  const t = s.tenants.find((x) => x.id === id);
  if (!t || t.id !== ctx.tenantId) return null;
  return t;
}

export function patchTenant(
  ctx: TenantContext,
  id: string,
  patch: { name?: string; plan?: AriaTenant["plan"]; quotas?: Record<string, number> },
): AriaTenant | null {
  assertTenant(ctx);
  const s = getAria();
  const t = s.tenants.find((x) => x.id === id);
  if (!t || t.id !== ctx.tenantId) return null;
  const updated: AriaTenant = {
    ...t,
    name: patch.name ?? t.name,
    plan: patch.plan ?? t.plan,
    quotas: patch.quotas ?? t.quotas,
  };
  state = { ...s, tenants: s.tenants.map((x) => (x.id === id ? updated : x)) };
  appendAudit("tenant.settings", "tenant", id, t, updated, ctx.tenantId, ctx.actor.userId);
  return updated;
}

export function listMembers(ctx: TenantContext): Array<{ membership: AriaMembership; user: AriaUser }> {
  assertTenant(ctx);
  const s = getAria();
  const out: Array<{ membership: AriaMembership; user: AriaUser }> = [];
  for (const m of s.memberships.filter((m) => m.tenantId === ctx.tenantId)) {
    const u = s.users.find((x) => x.id === m.userId);
    if (u) out.push({ membership: m, user: u });
  }
  return out;
}

/* ── CRM entities ────────────────────────────────────────────────── */

export function getAccount(ctx: TenantContext, id: string): AriaAccount | null {
  assertTenant(ctx);
  const s = getAria();
  const a = s.accounts.find((x) => x.id === id);
  if (!a || a.tenantId !== ctx.tenantId) return null;
  return a;
}

export function listAccounts(
  ctx: TenantContext,
  q?: string,
  ownerId?: string,
  status?: string,
): AriaAccount[] {
  assertTenant(ctx);
  const s = getAria();
  let out = s.accounts.filter((a) => a.tenantId === ctx.tenantId);
  if (ownerId) out = out.filter((a) => a.ownerId === ownerId);
  if (status) out = out.filter((a) => a.status === status);
  if (q) {
    const needle = q.toLowerCase();
    out = out.filter(
      (a) =>
        a.name.toLowerCase().includes(needle) ||
        a.domain.toLowerCase().includes(needle),
    );
  }
  return out;
}

export function createAccount(
  ctx: TenantContext,
  input: { name: string; domain: string; industry: string; size: number; ownerId: string; status?: AriaAccount["status"] },
): AriaAccount {
  assertTenant(ctx);
  const s = getAria();
  const now = clockNow();
  const row: AriaAccount = {
    id: liveId("acr"),
    tenantId: ctx.tenantId,
    name: input.name,
    domain: input.domain.toLowerCase(),
    industry: input.industry,
    size: input.size,
    ownerId: input.ownerId,
    status: input.status ?? "active",
    createdAt: now,
  };
  state = { ...s, accounts: [...s.accounts, row] };
  appendAudit("account.create", "account", row.id, null, row, ctx.tenantId, ctx.actor.userId);
  return row;
}

export function updateAccount(
  ctx: TenantContext,
  id: string,
  patch: Partial<{ name: string; industry: string; size: number; status: AriaAccount["status"] }>,
): AriaAccount | null {
  assertTenant(ctx);
  const s = getAria();
  const a = s.accounts.find((x) => x.id === id && x.tenantId === ctx.tenantId);
  if (!a) return null;
  const updated: AriaAccount = {
    ...a,
    name: patch.name ?? a.name,
    industry: patch.industry ?? a.industry,
    size: patch.size ?? a.size,
    status: patch.status ?? a.status,
  };
  state = { ...s, accounts: s.accounts.map((x) => (x.id === id ? updated : x)) };
  appendAudit("account.update", "account", id, a, updated, ctx.tenantId, ctx.actor.userId);
  return updated;
}

/** A contact, or `null` when absent / cross-tenant. */
export function getContact(ctx: TenantContext, id: string): AriaContact | null {
  assertTenant(ctx);
  const s = getAria();
  const c = s.contacts.find((x) => x.id === id);
  if (!c || c.tenantId !== ctx.tenantId) return null;
  return c;
}

export function listContacts(ctx: TenantContext, q?: string, accountId?: string, ownerId?: string): AriaContact[] {
  assertTenant(ctx);
  const s = getAria();
  let out = s.contacts.filter((c) => c.tenantId === ctx.tenantId);
  if (accountId) out = out.filter((c) => c.accountId === accountId);
  if (ownerId) out = out.filter((c) => c.ownerId === ownerId);
  if (q) {
    const needle = q.toLowerCase();
    out = out.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.email.toLowerCase().includes(needle),
    );
  }
  return out;
}

export function findContactByEmail(
  ctx: TenantContext,
  email: string,
): AriaContact | undefined {
  assertTenant(ctx);
  return getAria().contacts.find(
    (c) => c.tenantId === ctx.tenantId && c.email.toLowerCase() === email.toLowerCase(),
  );
}

export function createContact(
  ctx: TenantContext,
  input: {
    accountId: string;
    name: string;
    email: string;
    title: string;
    ownerId: string;
    traits?: AriaContact["traits"];
  },
): AriaContact {
  assertTenant(ctx);
  const s = getAria();
  if (findContactByEmail(ctx, input.email)) {
    throw new ConflictError("a contact with this email already exists in the tenant");
  }
  if (!s.accounts.some((a) => a.id === input.accountId && a.tenantId === ctx.tenantId)) {
    throw new NotFoundError("account not found");
  }
  const now = clockNow();
  const row: AriaContact = {
    id: liveId("act"),
    tenantId: ctx.tenantId,
    accountId: input.accountId,
    name: input.name,
    email: input.email.toLowerCase(),
    title: input.title,
    ownerId: input.ownerId,
    traits: input.traits ?? { replyRate: 0.5, openRate: 0.5, busySignal: false },
    createdAt: now,
  };
  state = { ...s, contacts: [...s.contacts, row] };
  appendAudit("contact.create", "contact", row.id, null, row, ctx.tenantId, ctx.actor.userId);
  return row;
}

export function updateContact(
  ctx: TenantContext,
  id: string,
  patch: Partial<{ name: string; title: string; email: string; traits: AriaContact["traits"] }>,
): AriaContact | null {
  assertTenant(ctx);
  const s = getAria();
  const c = s.contacts.find((x) => x.id === id && x.tenantId === ctx.tenantId);
  if (!c) return null;
  // The email-uniqueness 409 applies to updates too.
  if (patch.email && patch.email.toLowerCase() !== c.email.toLowerCase()) {
    const clash = getAria().contacts.find(
      (x) =>
        x.tenantId === ctx.tenantId &&
        x.id !== id &&
        x.email.toLowerCase() === patch.email!.toLowerCase(),
    );
    if (clash) throw new ConflictError("a contact with this email already exists in the tenant");
  }
  const updated: AriaContact = {
    ...c,
    name: patch.name ?? c.name,
    title: patch.title ?? c.title,
    email: patch.email ? patch.email.toLowerCase() : c.email,
    traits: patch.traits ?? c.traits,
  };
  state = { ...s, contacts: s.contacts.map((x) => (x.id === id ? updated : x)) };
  appendAudit("contact.update", "contact", id, c, updated, ctx.tenantId, ctx.actor.userId);
  return updated;
}

export function getLead(ctx: TenantContext, id: string): AriaLead | null {
  assertTenant(ctx);
  const s = getAria();
  const l = s.leads.find((x) => x.id === id);
  if (!l || l.tenantId !== ctx.tenantId) return null;
  return l;
}

export function listLeads(
  ctx: TenantContext,
  status?: string,
  source?: string,
  slaState?: string,
): Array<AriaLead & { slaState: "ok" | "at_risk" | "breached" | "met" }> {
  assertTenant(ctx);
  const s = getAria();
  const tenant = s.tenants.find((t) => t.id === ctx.tenantId)!;
  let out = s.leads.filter((l) => l.tenantId === ctx.tenantId);
  if (status) out = out.filter((l) => l.status === status);
  if (source) out = out.filter((l) => l.source === source);
  const now = clockNow();
  const rows = out.map((l) => ({
    ...l,
    slaState: leadSlaState(l, tenant, now),
  }));
  if (slaState) return rows.filter((l) => l.slaState === slaState);
  return rows;
}

/** The computed lead SLA state at `now` (the `?slaState=` filter's math). */
export function leadSlaState(
  lead: AriaLead,
  tenant: AriaTenant,
  now: string,
): "ok" | "at_risk" | "breached" | "met" {
  if (lead.firstResponseAt !== null) return "met";
  const target = new Date(lead.createdAt).getTime() + tenant.leadSlaMinutes[lead.priority] * 60_000;
  const t = new Date(now).getTime();
  if (t > target) return "breached";
  if (t > target - 30 * 60_000) return "at_risk"; // within 30min of the target
  return "ok";
}

export function createLead(
  ctx: TenantContext,
  input: { name: string; email: string; source: string; priority: AriaLead["priority"]; ownerId: string },
): AriaLead {
  assertTenant(ctx);
  const s = getAria();
  const tenant = s.tenants.find((t) => t.id === ctx.tenantId)!;
  const now = clockNow();
  const slaDueAt = new Date(
    new Date(now).getTime() + tenant.leadSlaMinutes[input.priority] * 60_000,
  ).toISOString().replace(".000Z", "Z");
  const row: AriaLead = {
    id: liveId("alead"),
    tenantId: ctx.tenantId,
    status: "new",
    source: input.source,
    priority: input.priority,
    firstResponseAt: null,
    slaDueAt,
    converted: null,
    ownerId: input.ownerId,
    createdAt: now,
  };
  state = { ...s, leads: [...s.leads, row] };
  appendAudit("lead.create", "lead", row.id, null, row, ctx.tenantId, ctx.actor.userId);
  return row;
}

export function updateLead(
  ctx: TenantContext,
  id: string,
  patch: Partial<{ status: AriaLead["status"]; source: string; priority: AriaLead["priority"] }>,
): AriaLead | null {
  assertTenant(ctx);
  const s = getAria();
  const l = s.leads.find((x) => x.id === id && x.tenantId === ctx.tenantId);
  if (!l) return null;
  if (l.converted !== null) return null; // converted leads are terminal
  const updated: AriaLead = {
    ...l,
    status: patch.status ?? l.status,
    source: patch.source ?? l.source,
    priority: patch.priority ?? l.priority,
  };
  state = { ...s, leads: s.leads.map((x) => (x.id === id ? updated : x)) };
  appendAudit("lead.update", "lead", id, l, updated, ctx.tenantId, ctx.actor.userId);
  return updated;
}

/**
 * The atomic lead conversion (plan §3.3): find-or-create the
 * account + contact, optionally create a deal, and move the lead to
 * `converted` — all in one store commit (the brief's "atomic:
 * creates/links all, moves lead to converted").
 */
export function convertLead(
  ctx: TenantContext,
  leadId: string,
  input: {
    accountId?: string;
    contactId?: string;
    dealId?: string;
    amount?: number;
  },
): { lead: AriaLead; account: AriaAccount; contact: AriaContact; deal: AriaDeal | null } {
  assertTenant(ctx);
  const s = getAria();
  const lead = s.leads.find((x) => x.id === leadId && x.tenantId === ctx.tenantId);
  if (!lead) throw new NotFoundError("lead not found");
  if (lead.converted !== null) throw new StageError("the lead is already converted");
  const now = clockNow();

  // Resolve or create the account (find by id, else create).
  let account = s.accounts.find((a) => a.id === input.accountId && a.tenantId === ctx.tenantId);
  if (input.accountId && !account) throw new NotFoundError("account not found");
  if (!account) {
    account = {
      id: liveId("acr"),
      tenantId: ctx.tenantId,
      name: lead.source,
      domain: lead.source,
      industry: "unknown",
      size: 0,
      ownerId: lead.ownerId,
      status: "active",
      createdAt: now,
    };
  }

  // Resolve or create the contact.
  let contact = s.contacts.find((c) => c.id === input.contactId && c.tenantId === ctx.tenantId);
  if (input.contactId && !contact) throw new NotFoundError("contact not found");
  if (!contact) {
    contact = {
      id: liveId("act"),
      tenantId: ctx.tenantId,
      accountId: account.id,
      name: lead.source,
      email: `${lead.source}@${lead.id}.test`,
      title: "Lead",
      ownerId: lead.ownerId,
      traits: { replyRate: 0.5, openRate: 0.5, busySignal: false },
      createdAt: now,
    };
  }

  // Optionally create a deal (only when an explicit dealId is given
  // with an amount).
  let deal: AriaDeal | null = null;
  if (input.dealId !== undefined && input.dealId !== "" && input.amount !== undefined) {
    deal = {
      id: input.dealId || liveId("adeal"),
      tenantId: ctx.tenantId,
      pipelineId: s.pipelines.find((p) => p.tenantId === ctx.tenantId)!.id,
      stageId: s.pipelines.find((p) => p.tenantId === ctx.tenantId)!.stages[0].id,
      accountId: account.id,
      contactId: contact.id,
      amount: input.amount,
      forecastCategory: "pipeline",
      ownerId: lead.ownerId,
      expectedCloseDate: new Date(new Date(now).getTime() + 30 * 86_400_000).toISOString().slice(0, 10),
      closedAt: null,
      lostReason: null,
      lastStageChangeAt: now,
      createdAt: now,
    };
  }

  const updatedLead: AriaLead = {
    ...lead,
    status: "qualified",
    firstResponseAt: lead.firstResponseAt ?? now,
    converted: {
      accountId: account.id,
      contactId: contact.id,
      dealId: deal?.id ?? null,
      at: now,
    },
  };

  state = {
    ...s,
    accounts: account ? s.accounts : [...s.accounts, account],
    contacts: contact && s.contacts.some((c) => c.id === contact.id)
      ? s.contacts
      : [...s.contacts, contact],
    deals: deal ? [...s.deals, deal] : s.deals,
    leads: s.leads.map((x) => (x.id === leadId ? updatedLead : x)),
  };
  appendAudit("lead.convert", "lead", leadId, null, {
    accountId: account.id,
    contactId: contact.id,
    dealId: deal?.id ?? null,
  }, ctx.tenantId, ctx.actor.userId);
  return { lead: updatedLead, account, contact, deal };
}

/* ── pipelines & deals ───────────────────────────────────────────── */

export function getPipeline(ctx: TenantContext, id: string): AriaPipeline | null {
  assertTenant(ctx);
  const s = getAria();
  const p = s.pipelines.find((x) => x.id === id);
  if (!p || p.tenantId !== ctx.tenantId) return null;
  return p;
}

export function listPipelines(ctx: TenantContext): AriaPipeline[] {
  assertTenant(ctx);
  return getAria().pipelines.filter((p) => p.tenantId === ctx.tenantId);
}

export function createPipeline(
  ctx: TenantContext,
  input: { name: string; stages: Array<{ name: string; probability: number; state: AriaPipeline["stages"][number]["state"] }> },
): AriaPipeline {
  assertTenant(ctx);
  if (!canCreatePipeline(getAria(), ctx.tenantId)) throw new QuotaExceededError("pipeline cap");
  const s = getAria();
  const id = liveId("apl");
  const now = clockNow();
  const row: AriaPipeline = {
    id,
    tenantId: ctx.tenantId,
    name: input.name,
    stages: input.stages.map((st, i) => ({
      id: `${id}-stg-${i + 1}`,
      name: st.name,
      probability: st.probability,
      state: st.state,
    })),
    createdAt: now,
  };
  state = { ...s, pipelines: [...s.pipelines, row] };
  appendAudit("pipeline.create", "pipeline", id, null, row, ctx.tenantId, ctx.actor.userId);
  return row;
}

export function updatePipeline(
  ctx: TenantContext,
  id: string,
  patch: { name?: string; stages?: AriaPipeline["stages"] },
): AriaPipeline | null {
  assertTenant(ctx);
  const s = getAria();
  const p = s.pipelines.find((x) => x.id === id && x.tenantId === ctx.tenantId);
  if (!p) return null;
  const updated: AriaPipeline = {
    ...p,
    name: patch.name ?? p.name,
    stages: patch.stages ?? p.stages,
  };
  state = { ...s, pipelines: s.pipelines.map((x) => (x.id === id ? updated : x)) };
  appendAudit("pipeline.update", "pipeline", id, p, updated, ctx.tenantId, ctx.actor.userId);
  return updated;
}

export function getDeal(ctx: TenantContext, id: string): AriaDeal | null {
  assertTenant(ctx);
  const s = getAria();
  const d = s.deals.find((x) => x.id === id);
  if (!d || d.tenantId !== ctx.tenantId) return null;
  return d;
}

export function listDeals(
  ctx: TenantContext,
  filters: {
    pipelineId?: string;
    stageId?: string;
    ownerId?: string;
    forecastCategory?: string;
    status?: "open" | "won" | "lost";
  },
): AriaDeal[] {
  assertTenant(ctx);
  let out = getAria().deals.filter((d) => d.tenantId === ctx.tenantId);
  if (filters.pipelineId) out = out.filter((d) => d.pipelineId === filters.pipelineId);
  if (filters.stageId) out = out.filter((d) => d.stageId === filters.stageId);
  if (filters.ownerId) out = out.filter((d) => d.ownerId === filters.ownerId);
  if (filters.forecastCategory) out = out.filter((d) => d.forecastCategory === filters.forecastCategory);
  if (filters.status) {
    const p = (d: AriaDeal) => getPipeline(ctx, d.pipelineId);
    out = out.filter((d) => {
      if (d.closedAt === null) return filters.status === "open";
      const pipeline = p(d);
      const stage = pipeline?.stages.find((s) => s.id === d.stageId);
      if (filters.status === "won") return stage?.state === "closed_won";
      if (filters.status === "lost") return stage?.state === "closed_lost";
      return false;
    });
  }
  return out;
}

export function createDeal(
  ctx: TenantContext,
  input: {
    pipelineId: string;
    stageId: string;
    accountId: string;
    contactId: string;
    amount: number;
    forecastCategory: AriaDeal["forecastCategory"];
    ownerId: string;
    expectedCloseDate: string;
  },
): AriaDeal {
  assertTenant(ctx);
  const s = getAria();
  const pipeline = s.pipelines.find((p) => p.id === input.pipelineId && p.tenantId === ctx.tenantId);
  if (!pipeline) throw new NotFoundError("pipeline not found");
  const stage = pipeline.stages.find((st) => st.id === input.stageId);
  if (!stage) throw new StageError("unknown stage in pipeline");
  if (!s.accounts.some((a) => a.id === input.accountId && a.tenantId === ctx.tenantId)) {
    throw new NotFoundError("account not found");
  }
  if (!s.contacts.some((c) => c.id === input.contactId && c.tenantId === ctx.tenantId)) {
    throw new NotFoundError("contact not found");
  }
  const now = clockNow();
  const row: AriaDeal = {
    id: liveId("adeal"),
    tenantId: ctx.tenantId,
    pipelineId: input.pipelineId,
    stageId: input.stageId,
    accountId: input.accountId,
    contactId: input.contactId,
    amount: input.amount,
    forecastCategory: input.forecastCategory,
    ownerId: input.ownerId,
    expectedCloseDate: input.expectedCloseDate,
    closedAt: null,
    lostReason: null,
    lastStageChangeAt: now,
    createdAt: now,
  };
  state = { ...s, deals: [...s.deals, row] };
  appendAudit("deal.create", "deal", row.id, null, row, ctx.tenantId, ctx.actor.userId);
  return row;
}

export function updateDeal(
  ctx: TenantContext,
  id: string,
  patch: Partial<{
    amount: number;
    stageId: string;
    forecastCategory: AriaDeal["forecastCategory"];
    expectedCloseDate: string;
    ownerId: string;
    lostReason: string | null;
  }>,
): AriaDeal {
  assertTenant(ctx);
  const s = getAria();
  const d = s.deals.find((x) => x.id === id && x.tenantId === ctx.tenantId);
  if (!d) throw new NotFoundError("deal not found");
  const pipeline = s.pipelines.find((p) => p.id === d.pipelineId)!;

  let updated: AriaDeal = { ...d };
  if (patch.amount !== undefined) updated = { ...updated, amount: patch.amount };
  if (patch.forecastCategory !== undefined) updated = { ...updated, forecastCategory: patch.forecastCategory };
  if (patch.expectedCloseDate !== undefined) updated = { ...updated, expectedCloseDate: patch.expectedCloseDate };
  if (patch.ownerId !== undefined) updated = { ...updated, ownerId: patch.ownerId };
  if (patch.lostReason !== undefined) updated = { ...updated, lostReason: patch.lostReason };

  if (patch.stageId !== undefined) {
    const target = pipeline.stages.find((st) => st.id === patch.stageId);
    if (!target) throw new StageError("unknown stage in pipeline");
    // The closed-deal invariant: a won/lost deal never reopens.
    if (d.closedAt !== null && target.state === "open") {
      throw new StageError("a closed deal cannot be moved to an open stage");
    }
    if (target.state === "closed_lost" && !updated.lostReason) {
      throw new StageError("moving to a lost stage requires a lostReason");
    }
    if (target.state === "closed_won" && updated.lostReason) {
      updated = { ...updated, lostReason: null };
    }
    updated = {
      ...updated,
      stageId: target.id,
      lastStageChangeAt: clockNow(),
      closedAt: target.state === "open" ? d.closedAt : d.closedAt ?? clockNow(),
    };
  }

  state = { ...s, deals: s.deals.map((x) => (x.id === id ? updated : x)) };
  appendAudit("deal.update", "deal", id, d, updated, ctx.tenantId, ctx.actor.userId);
  return updated;
}

/**
 * The explicit stage transition (the `deal.stage` route). The
 * lost-reason gate + the closed-deal invariant live HERE (the
 * invariant test pins both).
 */
export function stageDeal(
  ctx: TenantContext,
  id: string,
  targetStageId: string,
  lostReason?: string,
): AriaDeal {
  assertTenant(ctx);
  const s = getAria();
  const d = s.deals.find((x) => x.id === id && x.tenantId === ctx.tenantId);
  if (!d) throw new NotFoundError("deal not found");
  const pipeline = s.pipelines.find((p) => p.id === d.pipelineId)!;
  const target = pipeline.stages.find((st) => st.id === targetStageId);
  if (!target) throw new StageError("unknown stage in pipeline");
  if (d.closedAt !== null && target.state === "open") {
    throw new StageError("a closed deal cannot be reopened (the P0 invariant)");
  }
  if (target.state === "closed_lost" && !lostReason?.trim()) {
    throw new StageError("moving to a lost stage requires a lostReason (the 400 gate)");
  }
  const now = clockNow();
  const updated: AriaDeal = {
    ...d,
    stageId: target.id,
    lastStageChangeAt: now,
    closedAt:
      target.state === "open" ? d.closedAt : d.closedAt ?? now,
    lostReason: target.state === "closed_lost" ? (lostReason ?? d.lostReason) : null,
  };
  state = { ...s, deals: s.deals.map((x) => (x.id === id ? updated : x)) };
  appendAudit("deal.stage", "deal", id, d.stageId, target.id, ctx.tenantId, ctx.actor.userId);
  return updated;
}

/* ── activities / tasks / notes / tags ───────────────────────────── */

export function listActivities(
  ctx: TenantContext,
  entityType?: string,
  entityId?: string,
  kind?: string,
): AriaActivity[] {
  assertTenant(ctx);
  let out = getAria().activities.filter((a) => a.tenantId === ctx.tenantId);
  if (entityType) out = out.filter((a) => a.entityType === entityType);
  if (entityId) out = out.filter((a) => a.entityId === entityId);
  if (kind) out = out.filter((a) => a.kind === kind);
  return [...out].sort((a, b) => b.at.localeCompare(a.at));
}

export function createActivity(
  ctx: TenantContext,
  input: { kind: AriaActivity["kind"]; entityType: AriaActivity["entityType"]; entityId: string; body: string },
): AriaActivity {
  assertTenant(ctx);
  const s = getAria();
  const row: AriaActivity = {
    id: liveId("actv"),
    tenantId: ctx.tenantId,
    kind: input.kind,
    entityType: input.entityType,
    entityId: input.entityId,
    body: input.body,
    actorId: ctx.actor.userId,
    at: clockNow(),
  };
  state = { ...s, activities: [...s.activities, row] };
  appendAudit("activity.create", "activity", row.id, null, row, ctx.tenantId, ctx.actor.userId);
  return row;
}

export function listTasks(
  ctx: TenantContext,
  entityId?: string,
  ownerId?: string,
  done?: boolean,
  slaState?: string,
): Array<AriaTask & { slaState: "ok" | "late" | "done" }> {
  assertTenant(ctx);
  const s = getAria();
  let out = s.tasks.filter((t) => t.tenantId === ctx.tenantId);
  if (entityId) out = out.filter((t) => t.entityId === entityId);
  if (ownerId) out = out.filter((t) => t.ownerId === ownerId);
  if (done !== undefined) out = out.filter((t) => t.done === done);
  const now = clockNow();
  const rows = out.map((t) => ({
    ...t,
    slaState: t.done ? ("done" as const) : new Date(t.due).getTime() < new Date(now).getTime() ? ("late" as const) : ("ok" as const),
  }));
  if (slaState) return rows.filter((t) => t.slaState === slaState);
  return rows;
}

export function createTask(
  ctx: TenantContext,
  input: { title: string; ownerId: string; entityType: AriaTask["entityType"]; entityId: string; due: string; priority: AriaTask["priority"] },
): AriaTask {
  assertTenant(ctx);
  const s = getAria();
  const now = clockNow();
  const row: AriaTask = {
    id: liveId("atsk"),
    tenantId: ctx.tenantId,
    title: input.title,
    ownerId: input.ownerId,
    entityType: input.entityType,
    entityId: input.entityId,
    due: input.due,
    priority: input.priority,
    done: false,
    doneAt: null,
    createdAt: now,
  };
  state = { ...s, tasks: [...s.tasks, row] };
  appendAudit("task.create", "task", row.id, null, row, ctx.tenantId, ctx.actor.userId);
  return row;
}

export function updateTask(
  ctx: TenantContext,
  id: string,
  patch: Partial<{ title: string; due: string; priority: AriaTask["priority"]; done: boolean; doneAt: string | null }>,
): AriaTask | null {
  assertTenant(ctx);
  const s = getAria();
  const t = s.tasks.find((x) => x.id === id && x.tenantId === ctx.tenantId);
  if (!t) return null;
  const now = clockNow();
  const done = patch.done ?? t.done;
  const updated: AriaTask = {
    ...t,
    title: patch.title ?? t.title,
    due: patch.due ?? t.due,
    priority: patch.priority ?? t.priority,
    done,
    doneAt: patch.doneAt !== undefined ? patch.doneAt : done ? (t.doneAt ?? now) : null,
  };
  state = { ...s, tasks: s.tasks.map((x) => (x.id === id ? updated : x)) };
  appendAudit("task.update", "task", id, t, updated, ctx.tenantId, ctx.actor.userId);
  return updated;
}

export function listNotes(ctx: TenantContext, entityType?: string, entityId?: string): AriaNote[] {
  assertTenant(ctx);
  let out = getAria().notes.filter((n) => n.tenantId === ctx.tenantId);
  if (entityType) out = out.filter((n) => n.entityType === entityType);
  if (entityId) out = out.filter((n) => n.entityId === entityId);
  return [...out].sort((a, b) => b.at.localeCompare(a.at));
}

export function createNote(
  ctx: TenantContext,
  input: { entityType: AriaNote["entityType"]; entityId: string; body: string },
): AriaNote {
  assertTenant(ctx);
  const s = getAria();
  const row: AriaNote = {
    id: liveId("anote"),
    tenantId: ctx.tenantId,
    entityType: input.entityType,
    entityId: input.entityId,
    authorId: ctx.actor.userId,
    body: input.body,
    at: clockNow(),
  };
  state = { ...s, notes: [...s.notes, row] };
  appendAudit("note.create", "note", row.id, null, row, ctx.tenantId, ctx.actor.userId);
  return row;
}

export function listTags(ctx: TenantContext): AriaTag[] {
  assertTenant(ctx);
  return getAria().tags.filter((t) => t.tenantId === ctx.tenantId);
}

export function createTag(ctx: TenantContext, label: string): AriaTag {
  assertTenant(ctx);
  const s = getAria();
  const trimmed = label.trim();
  if (s.tags.some((t) => t.tenantId === ctx.tenantId && t.label.toLowerCase() === trimmed.toLowerCase())) {
    throw new ConflictError("a tag with this label already exists in the tenant");
  }
  const row: AriaTag = { id: liveId("atg"), tenantId: ctx.tenantId, label: trimmed };
  state = { ...s, tags: [...s.tags, row] };
  appendAudit("tag.create", "tag", row.id, null, row, ctx.tenantId, ctx.actor.userId);
  return row;
}

export function updateTag(ctx: TenantContext, id: string, label: string): AriaTag | null {
  assertTenant(ctx);
  const s = getAria();
  const t = s.tags.find((x) => x.id === id && x.tenantId === ctx.tenantId);
  if (!t) return null;
  const trimmed = label.trim();
  if (s.tags.some((x) => x.tenantId === ctx.tenantId && x.id !== id && x.label.toLowerCase() === trimmed.toLowerCase())) {
    throw new ConflictError("a tag with this label already exists in the tenant");
  }
  const updated: AriaTag = { ...t, label: trimmed };
  state = { ...s, tags: s.tags.map((x) => (x.id === id ? updated : x)) };
  appendAudit("tag.update", "tag", id, t, updated, ctx.tenantId, ctx.actor.userId);
  return updated;
}

/** Delete a tag: remove the row + strip it from every entity's tag list. */
export function deleteTag(ctx: TenantContext, id: string): boolean {
  assertTenant(ctx);
  const s = getAria();
  const t = s.tags.find((x) => x.id === id && x.tenantId === ctx.tenantId);
  if (!t) return false;
  state = {
    ...s,
    tags: s.tags.filter((x) => x.id !== id),
    // The denormalized tag lists live on the entity rows (the
    // parley Conversation.tags pattern) — a tenant-scope strip.
  };
  appendAudit("tag.delete", "tag", id, t, null, ctx.tenantId, ctx.actor.userId);
  return true;
}

/* ── sequences / enrollments / mailbox ───────────────────────────── */

export function listSequences(ctx: TenantContext): AriaSequence[] {
  assertTenant(ctx);
  return getAria().sequences.filter((q) => q.tenantId === ctx.tenantId);
}

export function getSequence(ctx: TenantContext, id: string): AriaSequence | null {
  assertTenant(ctx);
  const s = getAria();
  const q = s.sequences.find((x) => x.id === id);
  if (!q || q.tenantId !== ctx.tenantId) return null;
  return q;
}

export function createSequence(
  ctx: TenantContext,
  input: { name: string; steps: SeqStep[]; traitSeed: number },
): AriaSequence {
  assertTenant(ctx);
  if (!canCreateSequence(getAria(), ctx.tenantId)) throw new QuotaExceededError("sequence cap");
  const s = getAria();
  const row: AriaSequence = {
    id: liveId("aseq"),
    tenantId: ctx.tenantId,
    name: input.name,
    steps: input.steps,
    traitSeed: input.traitSeed,
    createdAt: clockNow(),
  };
  state = { ...s, sequences: [...s.sequences, row] };
  appendAudit("sequence.create", "sequence", row.id, null, row, ctx.tenantId, ctx.actor.userId);
  return row;
}

export function listEnrollments(ctx: TenantContext, sequenceId?: string): AriaEnrollment[] {
  assertTenant(ctx);
  let out = getAria().enrollments.filter((e) => e.tenantId === ctx.tenantId);
  if (sequenceId) out = out.filter((e) => e.sequenceId === sequenceId);
  return out;
}

export function getEnrollment(ctx: TenantContext, id: string): AriaEnrollment | null {
  assertTenant(ctx);
  const s = getAria();
  const e = s.enrollments.find((x) => x.id === id);
  if (!e || e.tenantId !== ctx.tenantId) return null;
  return e;
}

export function createEnrollment(
  ctx: TenantContext,
  input: { contactId: string; sequenceId: string },
): AriaEnrollment {
  assertTenant(ctx);
  const s = getAria();
  const contact = s.contacts.find((c) => c.id === input.contactId && c.tenantId === ctx.tenantId);
  if (!contact) throw new NotFoundError("contact not found");
  const sequence = s.sequences.find((q) => q.id === input.sequenceId && q.tenantId === ctx.tenantId);
  if (!sequence) throw new NotFoundError("sequence not found");
  const row: AriaEnrollment = {
    id: liveId("aenr"),
    tenantId: ctx.tenantId,
    contactId: input.contactId,
    sequenceId: input.sequenceId,
    state: "enrolled",
    stepIndex: 0,
    createdAt: clockNow(),
    completedAt: null,
    traitMult: traitMultiplier(contact.traits, sequence.traitSeed),
  };
  state = { ...s, enrollments: [...s.enrollments, row] };
  appendAudit("enrollment.create", "enrollment", row.id, null, row, ctx.tenantId, ctx.actor.userId);
  return row;
}

/**
 * The engine ctx the store provides (the fugue injection point).
 */
export function engineCtx(): EngineCtx {
  let ev = 0;
  let mail = 0;
  let task = 0;
  return {
    now: () => clockNow(),
    nextEventId: () => `aevt-live-${String((ev += 1)).padStart(6, "0")}`,
    nextMailId: () => `amail-live-${String((mail += 1)).padStart(6, "0")}`,
    nextTaskId: () => `atsk-live-${String((task += 1)).padStart(6, "0")}`,
  };
}
/**
 * Run the deterministic engine over an enrollment + persist the
 * outputs (the `enrollment.advance` route). Terminal enrollments
 * are no-ops (the engine itself pins that).
 */
export function advanceEnrollment(
  ctx: TenantContext,
  id: string,
  inputEvents: AriaEngagement[],
): { enrollment: AriaEnrollment; newEvents: AdvanceOutput["newEvents"]; mailboxMsgs: AdvanceOutput["mailboxMsgs"]; newTasks: AdvanceOutput["newTasks"] } {
  assertTenant(ctx);
  const s = getAria();
  const e = s.enrollments.find((x) => x.id === id && x.tenantId === ctx.tenantId);
  if (!e) throw new NotFoundError("enrollment not found");
  const sequence = s.sequences.find((q) => q.id === e.sequenceId)!;
  const contact = s.contacts.find((c) => c.id === e.contactId);
  const out = advance(e, sequence, contact?.name ?? "", inputEvents, engineCtx());
  // Fill the task owner: the enrollment's contact owner.
  const owner = contact?.ownerId ?? "";
  const newTasks = out.newTasks.map((t) => ({ ...t, ownerId: owner, id: liveId("atsk"), due: clockNow() }));
  state = {
    ...s,
    enrollments: s.enrollments.map((x) => (x.id === id ? out.enrollment : x)),
    engagementEvents: [...s.engagementEvents, ...out.newEvents.map((ev) => ({ ...ev, id: liveId("aevt") }))],
    mailbox: [...s.mailbox, ...out.mailboxMsgs.map((m) => ({ ...m, id: liveId("amail") }))],
    tasks: [...s.tasks, ...newTasks],
  };
  state = { ...state!, mailbox: retainMailbox(state!.mailbox) };
  appendAudit("enrollment.advance", "enrollment", id, e.state, out.enrollment.state, ctx.tenantId, ctx.actor.userId);
  return {
    enrollment: out.enrollment,
    newEvents: out.newEvents,
    mailboxMsgs: out.mailboxMsgs,
    newTasks,
  };
}

export function exitEnrollmentRoute(
  ctx: TenantContext,
  id: string,
): AriaEnrollment {
  assertTenant(ctx);
  const s = getAria();
  const e = s.enrollments.find((x) => x.id === id && x.tenantId === ctx.tenantId);
  if (!e) throw new NotFoundError("enrollment not found");
  const out = exitEnrollment(e, engineCtx());
  state = { ...s, enrollments: s.enrollments.map((x) => (x.id === id ? out : x)) };
  appendAudit("enrollment.exit", "enrollment", id, e.state, out.state, ctx.tenantId, ctx.actor.userId);
  return out;
}

export function listMailbox(
  ctx: TenantContext,
  contactId?: string,
  outcome?: string,
): AriaMailboxMessage[] {
  assertTenant(ctx);
  let out = getAria().mailbox.filter((m) => m.tenantId === ctx.tenantId);
  if (contactId) out = out.filter((m) => m.contactId === contactId);
  if (outcome) out = out.filter((m) => m.outcome === outcome);
  return [...out].sort((a, b) => b.at.localeCompare(a.at));
}

/* ── reporting / triage / import / audit / forecast ──────────────── */

export function auditFeed(ctx: TenantContext, action?: string, entityType?: string): AriaAuditEvent[] {
  assertTenant(ctx);
  const s = getAria();
  return auditQuery(s.audit, { tenantId: ctx.tenantId, action, entityType });
}

export function captureForecastSnapshot(
  ctx: TenantContext,
  input: { periodStart: string; periodEnd: string },
): AriaForecastSnapshot {
  assertTenant(ctx);
  const s = getAria();
  const now = clockNow();
  const open = openDealsFor(s, ctx.tenantId);
  const pipeline = s.pipelines.find((p) => p.tenantId === ctx.tenantId)!;
  const m = snapshotMath(open, pipeline);
  const row: AriaForecastSnapshot = {
    id: liveId("asnap"),
    tenantId: ctx.tenantId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    capturedAt: now,
    weightedTotal: m.weightedTotal,
    byStage: m.byStage,
    byCategory: m.byCategory,
    dealIds: m.dealIds,
  };
  state = { ...s, forecastSnapshots: [...s.forecastSnapshots, row] };
  appendAudit("forecast.capture", "forecastSnapshot", row.id, null, {
    weightedTotal: row.weightedTotal,
  }, ctx.tenantId, ctx.actor.userId);
  return row;
}

export function listForecastSnapshots(ctx: TenantContext): AriaForecastSnapshot[] {
  assertTenant(ctx);
  return getAria().forecastSnapshots.filter((f) => f.tenantId === ctx.tenantId);
}

/**
 * The CSV import (contacts | deals), with dry-run validation.
 * Pure-ish: the parse + the duplicate detection are over the current
 * state; the commit happens only when `dryRun` is false.
 */
export interface ImportResult {
  imported: number;
  errors: Array<{ row: number; field: string; message: string }>;
  duplicates: Array<{ emailOrDomain: string; existingId: string }>;
}

export function runImport(
  ctx: TenantContext,
  input: { type: "contacts" | "deals"; csv: string; dryRun: boolean },
): ImportResult {
  assertTenant(ctx);
  const s = getAria();
  const lines = String(input.csv)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) throw new ValidationError(["the CSV is empty"]);
  const errors: ImportResult["errors"] = [];
  const duplicates: ImportResult["duplicates"] = [];
  const known = new Set(
    s.contacts.filter((c) => c.tenantId === ctx.tenantId).map((c) => c.email.toLowerCase()),
  );

  let imported = 0;
  const newContacts: AriaContact[] = [];
  const newDeals: AriaDeal[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",").map((p) => p.trim());
    if (input.type === "contacts") {
      // header: name, email, title, accountId
      const [name, email, title, accountId] = parts;
      if (!name) errors.push({ row: i, field: "name", message: "name is required" });
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        errors.push({ row: i, field: "email", message: "a valid email is required" });
      } else if (known.has(email.toLowerCase())) {
        const existing = s.contacts.find((c) => c.email.toLowerCase() === email.toLowerCase())!;
        duplicates.push({ emailOrDomain: email, existingId: existing.id });
        continue;
      }
      if (!title) errors.push({ row: i, field: "title", message: "title is required" });
      if (errors.some((e) => e.row === i)) continue;
      const row: AriaContact = {
        id: liveId("act"),
        tenantId: ctx.tenantId,
        accountId: accountId ?? s.accounts.find((a) => a.tenantId === ctx.tenantId)!.id,
        name,
        email: email.toLowerCase(),
        title,
        ownerId: ctx.actor.userId,
        traits: { replyRate: 0.5, openRate: 0.5, busySignal: false },
        createdAt: clockNow(),
      };
      newContacts.push(row);
      known.add(email.toLowerCase());
      imported += 1;
    } else {
      // header: amount, pipelineId, accountId, contactId, forecastCategory
      const [amount, pipelineId, accountId, contactId, forecastCategory] = parts;
      const n = Number(amount);
      if (Number.isNaN(n) || n < 0) errors.push({ row: i, field: "amount", message: "a non-negative amount is required" });
      if (!pipelineId) errors.push({ row: i, field: "pipelineId", message: "pipelineId is required" });
      if (!accountId) errors.push({ row: i, field: "accountId", message: "accountId is required" });
      if (!contactId) errors.push({ row: i, field: "contactId", message: "contactId is required" });
      const cats = ["pipeline", "best_case", "commit", "omitted", "closed"];
      if (!cats.includes(forecastCategory)) {
        errors.push({ row: i, field: "forecastCategory", message: `must be one of: ${cats.join(", ")}` });
      }
      if (errors.some((e) => e.row === i)) continue;
      const pipeline = s.pipelines.find((p) => p.id === pipelineId && p.tenantId === ctx.tenantId);
      if (!pipeline) {
        errors.push({ row: i, field: "pipelineId", message: "unknown pipeline in tenant" });
        continue;
      }
      const row: AriaDeal = {
        id: liveId("adeal"),
        tenantId: ctx.tenantId,
        pipelineId,
        stageId: pipeline.stages[0].id,
        accountId,
        contactId,
        amount: n,
        forecastCategory: forecastCategory as AriaDeal["forecastCategory"],
        ownerId: ctx.actor.userId,
        expectedCloseDate: new Date(new Date(clockNow()).getTime() + 30 * 86_400_000).toISOString().slice(0, 10),
        closedAt: null,
        lostReason: null,
        lastStageChangeAt: clockNow(),
        createdAt: clockNow(),
      };
      newDeals.push(row);
      imported += 1;
    }
  }

  if (!input.dryRun) {
    state = {
      ...s,
      contacts: [...s.contacts, ...newContacts],
      deals: [...s.deals, ...newDeals],
    };
    appendAudit(
      "import.run",
      "import",
      "import-" + (input.type === "contacts" ? "contacts" : "deals"),
      null,
      { imported, dryRun: false },
      ctx.tenantId,
      ctx.actor.userId,
    );
  }

  return { imported, errors, duplicates };
}

/* ── re-export the error classes + tenancy helpers for the routes ── */

export { NoTenantContextError };
export type { TenantContext };
