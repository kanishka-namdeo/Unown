/**
 * The parley server-side store — a module singleton, the ONLY thing
 * that touches the raw arrays (the brief's Architecture line, the
 * sigil `server-store.ts` pattern promoted to the full repository
 * shape the brief asks for).
 *
 * Per-instance semantics: each server instance has its own seed +
 * its own session rows + its own mutations (documented honest
 * bound — the risk list's accepted Vercel multi-instance property;
 * not fixed with Redis/DB).
 *
 * Fail-closed tenancy: every repository method takes a
 * `TenantContext` + an explicit `now`. A call without context
 * throws `NoTenantContextError` (the top rung of the 404 ladder);
 * a cross-tenant read returns `null` (the caller maps it to 404 —
 * never a 403 that confirms existence, never a 200 leak).
 *
 * Every mutation above appends its own audit event (the brief's
 * "every mutation" list): reply, assign, status, priority, tags,
 * invite, accept, member-role, member-remove, canned create /
 * update / delete, create-convo — 13 mutation sites.
 */

import { recordAudit } from "./audit";
import { now as clockNow } from "./clock";
import { slaState } from "./sla";
import {
  canCreate,
  conversationsThisMonth,
} from "./metering";
import { newConversationId, newInviteToken, newMessageId, mulberry32 } from "./ids";
import { hashPassword } from "./password";
import { createSession, findSession, isExpired } from "./sessions";
import { seedParley, SEED_INTEGER } from "./seed";
import {
  TenantContext,
  assertTenant,
  NoTenantContextError,
  makeCtx,
} from "./tenancy";
import type {
  AuditEvent,
  CannedReply,
  Conversation,
  Customer,
  Invite,
  Membership,
  Message,
  ParleyState,
  Priority,
  Role,
  SessionRow,
  Status,
  SystemEvent,
  Tenant,
  User,
} from "./types";
import { validateAcceptInvite } from "./validation";

/* ── distinct error classes (the route's error ladder is clean) ──── */

export class NotFoundError extends Error {
  constructor(msg = "not found") {
    super(msg);
    this.name = "NotFoundError";
  }
}

export class QuotaExceededError extends Error {
  constructor(msg = "quota_exceeded") {
    super(msg);
    this.name = "QuotaExceededError";
  }
}

export class ForbiddenError extends Error {
  constructor(msg = "forbidden") {
    super(msg);
    this.name = "ForbiddenError";
  }
}

export class InviteUsedError extends Error {
  constructor(public reason: "used" | "expired" = "used") {
    super(`invite ${reason}`);
    this.name = "InviteUsedError";
  }
}

/* ── the singleton ────────────────────────────────────────────────── */

/**
 * A module-scope RNG seeded from `SEED_INTEGER` so live (non-seed)
 * id generation stays deterministic across a reset (the brief's
 * "Reset returns to seed" pin: two resets → deep-equal states).
 */
function resetLiveCounters(): void {
  rng = mulberry32(SEED_INTEGER);
  auditCounter = 0;
  eventCounter = 0;
  liveCounter = 0;
}
let rng: () => number = mulberry32(SEED_INTEGER);
let auditCounter = 0;
let eventCounter = 0;
let liveCounter = 0;

let state: ParleyState | null = null;

/** A module-scoped audit id (deterministic counter, seed-deterministic). */
function auditId(): string {
  auditCounter += 1;
  return `aud-live-${String(auditCounter).padStart(6, "0")}`;
}

/** A module-scoped system-event id. */
function eventId(): string {
  eventCounter += 1;
  return `evt-live-${String(eventCounter).padStart(6, "0")}`;
}

/** A module-scoped live id for customers / canned / invites / memberships. */
function liveId(prefix: string): string {
  liveCounter += 1;
  return `${prefix}-live-${String(liveCounter).padStart(6, "0")}`;
}

/**
 * Lazy-seed on first call. `now` defaults to the clock's pinned
 * value, so `setClock` + `getParley` stay deterministic for the
 * demo's whole session.
 */
export function getParley(): ParleyState {
  if (!state) {
    resetLiveCounters();
    state = seedParley(clockNow());
  }
  return state;
}

/**
 * The demo/reset route's wipe: reseed via `seedParley()` + return
 * the fresh state + a fresh demo session row for `mira@lumen.test`
 * (a REAL login — the session is created through the same
 * `createSession` path; the cookie the client sets on the next page
 * load is a real HMAC-signed one — the brief's "never faked auth
 * state").
 */
export function resetParley(): { state: ParleyState; demoSession: SessionRow } {
  resetLiveCounters();
  state = seedParley(clockNow());
  const demoUser = state!.users.find((u) => u.email === "mira@lumen.test")!;
  const demoSession = createSession(demoUser.id, "tn-lumen", clockNow(), rng);
  state!.sessions = [demoSession];
  return { state: state!, demoSession };
}

/**
 * Look up a session by id + verify it hasn't expired. Returns the
 * `SessionRow` or `null` (absent / expired).
 */
export function liveSession(sessionId: string): SessionRow | null {
  const s = getParley();
  const row = findSession(s.sessions, sessionId);
  if (!row) return null;
  if (isExpired(row, clockNow())) return null;
  return row;
}

/** The user + their membership in the session's tenant. */
export function sessionActor(session: SessionRow): { user: User; membership: Membership; ctx: TenantContext } {
  const s = getParley();
  const user = s.users.find((u) => u.id === session.userId)!;
  const membership = s.memberships.find((m) => m.tenantId === session.tenantId && m.userId === session.userId);
  if (!membership) throw new NotFoundError("membership not found");
  const ctx = makeCtx(session.tenantId, user.id, membership.role);
  return { user, membership, ctx };
}

/* ── audit helper ─────────────────────────────────────────────────── */

/**
 * Append an audit event to the current state (copy-on-write via
 * `recordAudit`). The store is the single mutator, so this wraps the
 * helper with the module's `state` ref.
 */
function appendAudit(
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
  tenantId: string,
  actorUserId: string,
): void {
  const now = clockNow();
  state = recordAudit(state!, actorUserId, action, entityType, entityId, before, after, now, tenantId, auditId());
}

/* ── repository API ───────────────────────────────────────────────── */

export type ConvoFilter =
  | "all"
  | "open"
  | "pending"
  | "closed"
  | "unassigned"
  | "sla_risk";

export interface ConvoQuery {
  filter?: ConvoFilter;
  q?: string;
}

/**
 * List the tenant's conversations (the filtered inbox). Cross-tenant
 * is impossible here (the filter is scoped by `ctx.tenantId`); a
 * no-context call throws.
 */
export function listConvos(ctx: TenantContext, query?: ConvoQuery): Conversation[] {
  assertTenant(ctx);
  const s = getParley();
  let out = s.conversations.filter((c) => c.tenantId === ctx.tenantId);
  if (query?.filter && query.filter !== "all") {
    out = out.filter((c) => {
      switch (query.filter) {
        case "open": return c.status === "open";
        case "pending": return c.status === "pending";
        case "closed": return c.status === "closed";
        case "unassigned": return c.assigneeId === null;
        case "sla_risk": {
          const tenant = s.tenants.find((t) => t.id === ctx.tenantId)!;
          const st = slaState(c, tenant, clockNow());
          return st === "at_risk" || st === "breached";
        }
        default: return true;
      }
    });
  }
  if (query?.q) {
    const needle = query.q.toLowerCase();
    out = out.filter((c) => c.subject.toLowerCase().includes(needle));
  }
  return out;
}

/**
 * Fetch a single conversation. `null` when absent or cross-tenant
 * (the caller maps `null` to 404 — never a 403 that confirms
 * existence).
 */
export function getConvo(ctx: TenantContext, id: string): Conversation | null {
  assertTenant(ctx);
  const s = getParley();
  const c = s.conversations.find((x) => x.id === id);
  if (!c || c.tenantId !== ctx.tenantId) return null;
  return c;
}

/** Fetch a customer row by id (the thread's customer card). */
export function getCustomer(ctx: TenantContext, customerId: string): Customer | null {
  assertTenant(ctx);
  const s = getParley();
  const cust = s.customers.find((c) => c.id === customerId && c.tenantId === ctx.tenantId);
  return cust ?? null;
}

/** The thread's messages (customer + agent), oldest-first. */
export function getThread(ctx: TenantContext, convoId: string): Message[] {
  assertTenant(ctx);
  const c = getConvo(ctx, convoId);
  if (!c) return [];
  const s = getParley();
  return s.messages
    .filter((m) => m.conversationId === convoId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The thread's system events (timeline entries), oldest-first. */
export function getEvents(ctx: TenantContext, convoId: string): SystemEvent[] {
  assertTenant(ctx);
  const c = getConvo(ctx, convoId);
  if (!c) return [];
  return getParley().events
    .filter((e) => e.conversationId === convoId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Append an agent message to a conversation. If it's the
 * conversation's first reply, ALSO append the "replied" system
 * event + set `firstRespondedAt` (the brief's "system event if
 * first reply — sets firstRespondedAt"). An audit event is always
 * appended.
 *
 * `null` when the conversation is absent or cross-tenant.
 */
export function appendMessage(
  ctx: TenantContext,
  convoId: string,
  body: string,
): Message | null {
  assertTenant(ctx);
  const c = getConvo(ctx, convoId);
  if (!c) return null;
  const s = getParley();
  const now = clockNow();
  const msg: Message = {
    id: newMessageId(rng),
    tenantId: ctx.tenantId,
    conversationId: convoId,
    authorId: ctx.actor.userId,
    body,
    role: "agent",
    createdAt: now,
  };
  const isFirst = c.firstRespondedAt === null;
  const updated: Conversation = {
    ...c,
    firstRespondedAt: isFirst ? now : c.firstRespondedAt,
    status: c.status === "closed" ? "open" : c.status, // a reply reopens a closed conv
    closedAt: c.status === "closed" ? null : c.closedAt,
  };
  state = {
    ...s,
    conversations: s.conversations.map((x) => (x.id === convoId ? updated : x)),
    messages: [...s.messages, msg],
    events: isFirst
      ? [...s.events, {
          id: eventId(),
          tenantId: ctx.tenantId,
          conversationId: convoId,
          kind: "replied",
          meta: { messageId: msg.id },
          actorId: ctx.actor.userId,
          createdAt: now,
        }]
      : s.events,
  };
  appendAudit("conversation.reply", "message", msg.id, null, { body: body.slice(0, 60) }, ctx.tenantId, ctx.actor.userId);
  return msg;
}

/**
 * Assign a conversation to a user (or unassign with `null`).
 * Appends the "assigned" system event + an audit event.
 * `null` when the conversation is absent or cross-tenant.
 */
export function assign(ctx: TenantContext, convoId: string, userId: string | null): Conversation | null {
  assertTenant(ctx);
  const c = getConvo(ctx, convoId);
  if (!c) return null;
  const s = getParley();
  const now = clockNow();
  const updated: Conversation = { ...c, assigneeId: userId };
  state = {
    ...s,
    conversations: s.conversations.map((x) => (x.id === convoId ? updated : x)),
    events: [...s.events, {
      id: eventId(),
      tenantId: ctx.tenantId,
      conversationId: convoId,
      kind: "assigned",
      meta: { from: c.assigneeId, to: userId },
      actorId: ctx.actor.userId,
      createdAt: now,
    }],
  };
  appendAudit("conversation.assign", "conversation", convoId, c.assigneeId, userId, ctx.tenantId, ctx.actor.userId);
  return updated;
}

/**
 * Set the conversation's status. Appends the "status_changed"
 * system event + an audit event. `null` when absent / cross-tenant.
 */
export function setStatus(ctx: TenantContext, convoId: string, status: Status): Conversation | null {
  assertTenant(ctx);
  const c = getConvo(ctx, convoId);
  if (!c) return null;
  const s = getParley();
  const now = clockNow();
  const updated: Conversation = {
    ...c,
    status,
    closedAt: status === "closed" ? now : null,
  };
  state = {
    ...s,
    conversations: s.conversations.map((x) => (x.id === convoId ? updated : x)),
    events: [...s.events, {
      id: eventId(),
      tenantId: ctx.tenantId,
      conversationId: convoId,
      kind: "status_changed",
      meta: { before: c.status, after: status },
      actorId: ctx.actor.userId,
      createdAt: now,
    }],
  };
  appendAudit("conversation.status", "conversation", convoId, c.status, status, ctx.tenantId, ctx.actor.userId);
  return updated;
}

/**
 * Set the conversation's priority. A field-only change — no system
 * event (documented in the brief); the audit event is still appended.
 */
export function setPriority(ctx: TenantContext, convoId: string, priority: Priority): Conversation | null {
  assertTenant(ctx);
  const c = getConvo(ctx, convoId);
  if (!c) return null;
  const s = getParley();
  const updated: Conversation = { ...c, priority };
  state = {
    ...s,
    conversations: s.conversations.map((x) => (x.id === convoId ? updated : x)),
  };
  appendAudit("conversation.priority", "conversation", convoId, c.priority, priority, ctx.tenantId, ctx.actor.userId);
  return updated;
}

/**
 * Set the conversation's tag list. Appends the "tag_changed" system
 * event + an audit event.
 */
export function setTags(ctx: TenantContext, convoId: string, tags: string[]): Conversation | null {
  assertTenant(ctx);
  const c = getConvo(ctx, convoId);
  if (!c) return null;
  const s = getParley();
  const now = clockNow();
  const updated: Conversation = { ...c, tags };
  state = {
    ...s,
    conversations: s.conversations.map((x) => (x.id === convoId ? updated : x)),
    events: [...s.events, {
      id: eventId(),
      tenantId: ctx.tenantId,
      conversationId: convoId,
      kind: "tag_changed",
      meta: { before: c.tags, after: tags },
      actorId: ctx.actor.userId,
      createdAt: now,
    }],
  };
  appendAudit("conversation.tags", "conversation", convoId, c.tags, tags, ctx.tenantId, ctx.actor.userId);
  return updated;
}

/**
 * Create a new conversation (the customer-side / portal flow).
 * Quota-gated: when the tenant's plan cap is hit, throws
 * `QuotaExceededError` (the route maps it to the 402
 * `quota_exceeded` body).
 */
export function createConvo(
  ctx: TenantContext,
  input: { subject: string; customerName: string; customerEmail: string; priority?: Priority },
): Conversation {
  assertTenant(ctx);
  const s = getParley();
  const now = clockNow();
  if (!canCreate(s, ctx.tenantId, now)) throw new QuotaExceededError();
  // find-or-create the customer row
  let customer = s.customers.find(
    (c) => c.tenantId === ctx.tenantId && c.email.toLowerCase() === input.customerEmail.toLowerCase(),
  );
  if (!customer) {
    const newCustomer: Customer = {
      id: liveId("cst"),
      tenantId: ctx.tenantId,
      name: input.customerName,
      email: input.customerEmail,
    };
    customer = newCustomer;
    state = { ...s, customers: [...s.customers, newCustomer] };
  }
  const convo: Conversation = {
    id: newConversationId(rng),
    tenantId: ctx.tenantId,
    customerId: customer.id,
    subject: input.subject,
    status: "open",
    priority: input.priority ?? "normal",
    assigneeId: null,
    tags: [],
    createdAt: now,
    firstRespondedAt: null,
    closedAt: null,
  };
  state = {
    ...state!,
    conversations: [...state!.conversations, convo],
    events: [...state!.events, {
      id: eventId(),
      tenantId: ctx.tenantId,
      conversationId: convo.id,
      kind: "created",
      meta: { subject: convo.subject },
      actorId: ctx.actor.userId,
      createdAt: now,
    }],
  };
  appendAudit("conversation.create", "conversation", convo.id, null, {
    subject: convo.subject,
    priority: convo.priority,
  }, ctx.tenantId, ctx.actor.userId);
  return convo;
}

/* ── members & invites ────────────────────────────────────────────── */

/** The tenant's memberships joined with their users. */
export function listMembers(ctx: TenantContext): Array<{ membership: Membership; user: User }> {
  assertTenant(ctx);
  const s = getParley();
  const out: Array<{ membership: Membership; user: User }> = [];
  for (const m of s.memberships.filter((m) => m.tenantId === ctx.tenantId)) {
    const u = s.users.find((x) => x.id === m.userId);
    if (u) out.push({ membership: m, user: u });
  }
  return out;
}

/**
 * Create an invite (single-use token via `ids.ts`, 24h expiry).
 * The owner-seat carve-out is the caller's concern (the API layer
 * enforces it via `rbac.can(role, action, resource)` before
 * calling this — the store trusts the gate).
 */
export function createInvite(ctx: TenantContext, email: string, role: Role): Invite {
  assertTenant(ctx);
  const s = getParley();
  const now = clockNow();
  const inv: Invite = {
    id: liveId("inv"),
    tenantId: ctx.tenantId,
    email,
    role,
    token: newInviteToken(rng),
    expiresAt: new Date(new Date(now).getTime() + 24 * 3_600_000).toISOString().replace(".000Z", "Z"),
    usedAt: null,
    createdAt: now,
  };
  state = { ...s, invites: [...s.invites, inv] };
  appendAudit("invite.create", "invite", inv.id, null, { email, role }, ctx.tenantId, ctx.actor.userId);
  return inv;
}

/**
 * Accept an invite. NO context — the token is the credential.
 * The 404 unknown / 410 used / 410 expired ladder lives here:
 * unknown token → `NotFoundError`, used → `InviteUsedError("used")`,
 * expired → `InviteUsedError("expired")`. Creates the user (a REAL
 * `passwordHash` from the submitted password, NOT the demo one) +
 * attaches the membership with the invited role.
 */
export function acceptInvite(
  token: string,
  name: string,
  password: string,
): { user: User; membership: Membership; invite: Invite } {
  const s = getParley();
  const inv = s.invites.find((i) => i.token === token);
  if (!inv) throw new NotFoundError("unknown invite token");
  const now = clockNow();
  if (inv.usedAt !== null) throw new InviteUsedError("used");
  if (new Date(inv.expiresAt).getTime() < new Date(now).getTime()) throw new InviteUsedError("expired");
  const { errors } = validateAcceptInvite({ name, password });
  if (errors.length > 0) throw new Error(`validation failed: ${errors.join("; ")}`);
  const user: User = {
    id: liveId("usr"),
    email: inv.email,
    name,
    passwordHash: hashPassword(password, `s-${inv.email}`).hash,
    salt: `s-${inv.email}`,
  };
  const membership: Membership = {
    id: liveId("mem"),
    tenantId: inv.tenantId,
    userId: user.id,
    role: inv.role,
  };
  const updatedInvite: Invite = { ...inv, usedAt: now };
  state = {
    ...s,
    users: [...s.users, user],
    memberships: [...s.memberships, membership],
    invites: s.invites.map((i) => (i.id === inv.id ? updatedInvite : i)),
  };
  state = recordAudit(
    state!,
    user.id,
    "invite.accept",
    "membership",
    membership.id,
    null,
    { userId: user.id, role: membership.role },
    now,
    inv.tenantId,
    auditId(),
  );
  return { user, membership, invite: updatedInvite };
}

/**
 * Change a membership's role. The owner-seat + not-yourself guards
 * are the caller's concern (the API layer enforces them via the
 * `rbac` owner-seat carve-out + a self-guard).
 */
export function changeRole(ctx: TenantContext, membershipId: string, newRole: Role): Membership | null {
  assertTenant(ctx);
  const s = getParley();
  const m = s.memberships.find((x) => x.id === membershipId && x.tenantId === ctx.tenantId);
  if (!m) return null;
  const updated: Membership = { ...m, role: newRole };
  state = {
    ...s,
    memberships: s.memberships.map((x) => (x.id === membershipId ? updated : x)),
  };
  appendAudit("member.role_change", "membership", membershipId, m.role, newRole, ctx.tenantId, ctx.actor.userId);
  return updated;
}

/**
 * Remove a membership. "Not the owner" + "not yourself" guards are
 * the caller's concern (the API layer enforces them).
 */
export function removeMember(ctx: TenantContext, membershipId: string): boolean {
  assertTenant(ctx);
  const s = getParley();
  const m = s.memberships.find((x) => x.id === membershipId && x.tenantId === ctx.tenantId);
  if (!m) return false;
  state = {
    ...s,
    memberships: s.memberships.filter((x) => x.id !== membershipId),
  };
  appendAudit("member.remove", "membership", membershipId, m, null, ctx.tenantId, ctx.actor.userId);
  return true;
}

/* ── canned replies ───────────────────────────────────────────────── */

export function listCanned(ctx: TenantContext): CannedReply[] {
  assertTenant(ctx);
  return getParley().canned.filter((c) => c.tenantId === ctx.tenantId);
}

export function upsertCanned(
  ctx: TenantContext,
  input: { id?: string; title: string; body: string },
): CannedReply {
  assertTenant(ctx);
  const s = getParley();
  if (input.id) {
    const existing = s.canned.find((c) => c.id === input.id && c.tenantId === ctx.tenantId);
    if (!existing) throw new NotFoundError("canned reply not found");
    const updated: CannedReply = { ...existing, title: input.title, body: input.body };
    state = { ...s, canned: s.canned.map((c) => (c.id === input.id ? updated : c)) };
    appendAudit("canned.update", "canned", input.id, existing, updated, ctx.tenantId, ctx.actor.userId);
    return updated;
  }
  const created: CannedReply = {
    id: liveId("can"),
    tenantId: ctx.tenantId,
    title: input.title,
    body: input.body,
  };
  state = { ...s, canned: [...s.canned, created] };
  appendAudit("canned.create", "canned", created.id, null, created, ctx.tenantId, ctx.actor.userId);
  return created;
}

export function deleteCanned(ctx: TenantContext, id: string): boolean {
  assertTenant(ctx);
  const s = getParley();
  const existing = s.canned.find((c) => c.id === id && c.tenantId === ctx.tenantId);
  if (!existing) return false;
  state = { ...s, canned: s.canned.filter((c) => c.id !== id) };
  appendAudit("canned.delete", "canned", id, existing, null, ctx.tenantId, ctx.actor.userId);
  return true;
}

/* ── audit feed ───────────────────────────────────────────────────── */

/** The tenant's audit feed, newest first, optionally filtered by action. */
export function auditFeed(ctx: TenantContext, action?: string): AuditEvent[] {
  assertTenant(ctx);
  const s = getParley();
  let out = s.audit.filter((e) => e.tenantId === ctx.tenantId);
  if (action) out = out.filter((e) => e.action === action);
  return [...out].reverse();
}

/* ── usage / metering re-exports ──────────────────────────────────── */

export { conversationsThisMonth };

/* ── re-export the error classes for the route's clean ladder ────── */
export { NoTenantContextError };
