/**
 * The Nocturne API's state access layer — the single surface every
 * route + the test lane imports for store reads/writes.
 *
 * `@/lib/nocturne/store` is the file-backed JSON store facade
 * (the fugue pattern: atomic writes, in-memory cache, structural
 * reseed). This helper adds the API layer's two concerns on top:
 *
 * - The session↔membership join: a nocturne `NocturneSessionRow`
 *   is the lib's `NocturneSession` shape + `membershipId` (the
 *   join key `_auth.sessionFromRequest` resolves through). Every
 *   write path stores sessions through this type, so the join is a
 *   lookup, never a guess.
 * - The mutation helpers for lanes the lib's engines do not own
 *   (sessions, invites, tenant settings) — kept here so the lib
 *   layer stays the plan's pure domain surface (Phase 1 is frozen).
 *
 * Per-instance semantics: each server instance has its own state +
 * its own mutations (plan §7/15's accepted Vercel multi-instance
 * property — the file-backed store is per-instance; `data/nocturne/
 * state.json`).
 */

import {
  loadState,
  saveState,
  nextId as storeNextId,
  transaction as storeTransaction,
  resetState,
} from "@/lib/nocturne/store";
import {
  createSession,
  removeSession,
  findSession,
  isExpired,
  makeSignedCookie,
} from "@/lib/nocturne/sessions";
import { hashPassword, verifyPassword } from "@/lib/nocturne/password";
import { recordAudit } from "@/lib/nocturne/audit";
import { canInvite } from "@/lib/nocturne/metering";
import { now as nowClock } from "@/lib/nocturne/clock";
import type {
  NocturneState,
  NocturneTenant,
  NocturneUser,
  NocturneMembership,
  NocturneRole,
  NocturneSession,
} from "@/lib/nocturne/types";

export type { NocturneState };

/** A session row as the API layer stores it: lib shape + the join key. */
export interface NocturneSessionRow extends NocturneSession {
  membershipId: string;
}

/** Read the sessions of a state document as API-layer rows. */
export function sessionRows(s: NocturneState): NocturneSessionRow[] {
  return s.sessions as unknown as NocturneSessionRow[];
}

/* ── reads ───────────────────────────────────────────────────────── */

/** Read the current state (lazy load via the lib file store). */
export function getNocturne(): NocturneState {
  return loadState();
}

/** Look up a stored session row by id (the auth lane's join). */
export function findStoredSession(
  s: NocturneState,
  sessionId: string,
): NocturneSessionRow | undefined {
  return findSession(sessionRows(s), sessionId) as NocturneSessionRow | undefined;
}

/* ── the atomic read-modify-write lane ───────────────────────────── */

/**
 * The full read-modify-write: mutate the state under the store lock
 * (a synchronous in-memory operation followed by an atomic persist).
 * One `loadState` + `saveState` pair — the P1 dedup-race mitigation
 * (plan §7/4). Returns the NEW state.
 */
export function nocturneTransaction(mutate: (s: NocturneState) => NocturneState): NocturneState {
  return storeTransaction(mutate);
}

/** Wipe + reseed (the demo reset + the test lane's `freshStore`). */
export function nocturneReset(): NocturneState {
  resetState();
  return getNocturne();
}

/** The store's deterministic id mint (`nc_${prefix}_${seq}`). */
export function nextId(prefix: string): string {
  return storeNextId(prefix);
}

/** Persist the in-memory state atomically (used by the test lane). */
export function persist(): void {
  saveState();
}

/* ── errors (the route's mapping targets) ────────────────────────── */

/** Unknown entity / cross-tenant → the route's 404 rung. */
export class NotFoundError extends Error {
  constructor(msg = "not found") {
    super(msg);
    this.name = "NotFoundError";
  }
}

/** Plan-cap breach → the route's 402 rung. */
export class QuotaExceededError extends Error {
  constructor(msg = "quota exceeded") {
    super(msg);
    this.name = "QuotaExceededError";
  }
}

/** Used/expired invite → the route's 410 rung (the parley shape). */
export class InviteError extends Error {
  readonly reason: "used" | "expired";
  constructor(reason: "used" | "expired") {
    super(`invite ${reason}`);
    this.name = "InviteError";
    this.reason = reason;
  }
}

/* ── users & sessions (the auth lane) ────────────────────────────── */

/** A user by email (login's credential check; undefined → 401, no user-exists leak). */
export function userByEmail(email: string): NocturneUser | undefined {
  return getNocturne().users.find((u) => u.email === email);
}

/** True when the password verifies against the user's stored scrypt row. */
export function userPasswordOk(user: NocturneUser, password: string): boolean {
  return verifyPassword(password, user.salt, user.passwordHash);
}

/**
 * The REAL login path: mint a session row (8h TTL from the pinned
 * clock) + the membership join key. The route signs the row's id
 * into the `nocturne_ses` cookie (never faked auth state).
 *
 * The id comes from the seq-bumping allocator (`nextId`), never a
 * raw `s.seq` read — two logins with no other seq-bumping
 * operation between them must mint DISTINCT session ids, or the
 * second user's cookie resolves to the first user's session
 * (`findStoredSession` returns the first match).
 */
export function loginSession(userId: string, tenantId: string): NocturneSessionRow {
  const s = getNocturne();
  const membership = s.memberships.find((m) => m.userId === userId && m.tenantId === tenantId);
  if (!membership) throw new NotFoundError("no membership for the user/tenant pair");
  const base = createSession(userId, tenantId, nowClock(), 0);
  const id = nextId("ses");
  const row: NocturneSessionRow = { ...base, id, membershipId: membership.id };
  nocturneTransaction((state) => ({ ...state, sessions: [...state.sessions, row] }));
  return row;
}

/** Destroy a session row (logout; idempotent when the id is unknown). */
export function destroySession(sessionId: string): void {
  nocturneTransaction((state) => ({ ...state, sessions: removeSession(state.sessions, sessionId) }));
}

/** The demo-reset lane: reseed + a REAL demo-owner login (mira@lumen.test). */
export function demoLogin(): { row: NocturneSessionRow; cookie: string } {
  nocturneReset();
  const s = getNocturne();
  const owner = s.memberships.find((m) => m.tenantId === "tn-lumen" && m.role === "owner");
  if (!owner) throw new NotFoundError("no demo owner in the seed");
  const row = loginSession(owner.userId, owner.tenantId);
  return { row, cookie: makeSignedCookie(row.id) };
}

/* ── invites (the single-use token lane, plan §3.2) ──────────────── */

/**
 * Create a single-use invite (24h from the pinned clock). The seat-cap
 * gate is here: a tenant AT its plan's seat cap gets a 402
 * (`QuotaExceededError`). The token is the invite's id stream —
 * deterministic, no `Math.random()` (the fugue contract).
 */
export function createInvite(
  ctx: { tenantId: string; actorUserId: string },
  email: string,
  role: NocturneRole,
): NocturneState["invites"][number] {
  const s = getNocturne();
  if (!canInvite(s, ctx.tenantId)) throw new QuotaExceededError("seat cap");
  const now = nowClock();
  const id = nextId("inv");
  const invite: NocturneState["invites"][number] = {
    id,
    tenantId: ctx.tenantId,
    email,
    role,
    token: id,
    usedAt: null,
    expiresAt: new Date(new Date(now).getTime() + 24 * 3_600_000)
      .toISOString()
      .replace(".000Z", "Z"),
    createdAt: now,
  };
  nocturneTransaction((state) => ({ ...state, invites: [...state.invites, invite] }));
  nocturneTransaction((state) =>
    recordAudit(state, ctx.actorUserId, "invite.create", "invite", id, null, invite, now, ctx.tenantId, nextId("aud")),
  );
  return invite;
}

/**
 * Accept a single-use invite: creates the user row (a REAL scrypt
 * hash of the chosen password, deterministic salt
 * `s-nocturne-<slug>-<name>`) + the membership at the invited role.
 * The 404 unknown / 410 used / 410 expired / 402 seat-cap ladder
 * lives here (the parley lane).
 */
export function acceptInvite(
  token: string,
  name: string,
  password: string,
): { user: NocturneUser; membership: NocturneMembership } {
  const s = getNocturne();
  const inv = s.invites.find((i) => i.token === token);
  if (!inv) throw new NotFoundError("unknown invite token");
  const now = nowClock();
  if (inv.usedAt !== null) throw new InviteError("used");
  if (new Date(inv.expiresAt).getTime() < new Date(now).getTime()) throw new InviteError("expired");
  if (!canInvite(s, inv.tenantId)) throw new QuotaExceededError("seat cap");

  const tenant = s.tenants.find((t) => t.id === inv.tenantId);
  if (!tenant) throw new NotFoundError("unknown tenant for invite");

  const salt = `s-nocturne-${tenant.slug}-${name.toLowerCase().replace(/\s+/g, "-")}`;
  const { hash } = hashPassword(password, salt);
  const userId = nextId("usr");
  const user: NocturneUser = {
    id: userId,
    email: inv.email,
    name,
    passwordHash: hash,
    salt,
    createdAt: now,
    timezone: "UTC",
  };
  const membership: NocturneMembership = {
    id: nextId("mem"),
    tenantId: inv.tenantId,
    userId,
    role: inv.role,
  };
  nocturneTransaction((state) => ({
    ...state,
    users: [...state.users, user],
    memberships: [...state.memberships, membership],
    invites: state.invites.map((i) => (i.id === inv.id ? { ...i, usedAt: now } : i)),
  }));
  nocturneTransaction((state) =>
    recordAudit(state, userId, "invite.accept", "user", userId, null, { email: inv.email, role: inv.role }, now, inv.tenantId, nextId("aud")),
  );
  return { user, membership };
}

/* ── tenant settings (PATCH /tenants/[id], owner-gated) ─────────── */

/**
 * Patch the tenant's settings (`tenant.settings` lane). Returns the
 * updated tenant, or `null` when the id is not the caller's tenant —
 * the route maps that to a 404 (cross-tenant is NEVER a 403, the
 * plan's tenancy floor).
 */
export function patchTenant(
  tenantId: string,
  actorUserId: string,
  patch: { name?: string; slaMinutes?: NocturneTenant["slaMinutes"] },
): NocturneTenant | null {
  const s = getNocturne();
  const tenant = s.tenants.find((t) => t.id === tenantId);
  if (!tenant) return null;
  const now = nowClock();
  const updated: NocturneTenant = {
    ...tenant,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.slaMinutes !== undefined ? { slaMinutes: patch.slaMinutes } : {}),
  };
  nocturneTransaction((state) => ({
    ...state,
    tenants: state.tenants.map((t) => (t.id === tenantId ? updated : t)),
  }));
  nocturneTransaction((state) =>
    recordAudit(state, actorUserId, "tenant.settings", "tenant", tenantId, tenant, updated, now, tenantId, nextId("aud")),
  );
  return updated;
}

/** A membership for a user+tenant pair (the session lane's join). */
export function membershipFor(
  s: NocturneState,
  userId: string,
  tenantId: string,
): NocturneMembership | undefined {
  return s.memberships.find((m) => m.userId === userId && m.tenantId === tenantId);
}

/** Sweep expired session rows at the pinned clock (the lazy GC). */
export function sweepExpiredSessions(): void {
  const now = nowClock();
  const s = getNocturne();
  const live = s.sessions.filter((row) => !isExpired(row, now));
  if (live.length === s.sessions.length) return;
  nocturneTransaction((state) => ({ ...state, sessions: live }));
}
