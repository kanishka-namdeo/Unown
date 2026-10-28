/**
 * Domain types for the Parley multi-tenant support inbox.
 *
 * Tenancy is row-level: every tenant-owned row carries a `tenantId`
 * (the fail-closed contract in the TYPE — a row without a tenant
 * cannot exist in the store, and the repository layer enforces the
 * context at call time). Tenancy is path/switcher-based (no
 * subdomains — the app works inside a same-origin iframe).
 */

/* ── Plans ────────────────────────────────────────────────────────── */

export type Plan = "free" | "team" | "scale";

/** Per-plan caps: conversation seats and conversations per month. */
export const PLAN_CAPS: Record<Plan, { seats: number; convosPerMonth: number }> = {
  free: { seats: 3, convosPerMonth: 50 },
  team: { seats: 10, convosPerMonth: 500 },
  scale: { seats: 50, convosPerMonth: 10_000 },
};

/** Seat caps extracted for convenience. */
export const PLAN_SEATS: Record<Plan, number> = {
  free: 3,
  team: 10,
  scale: 50,
};

/* ── Roles & actions ──────────────────────────────────────────────── */

export type Role = "owner" | "admin" | "agent" | "viewer";
export const ROLES: Role[] = ["owner", "admin", "agent", "viewer"];

export type Status = "open" | "pending" | "closed";
export const STATUSES: Status[] = ["open", "pending", "closed"];

export type Priority = "low" | "normal" | "high" | "urgent";
export const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];

/* ── SLA policy ───────────────────────────────────────────────────── */

/** A tenant's SLA targets (hours) by priority. */
export interface SlaPolicy {
  /** First-response targets in hours, per priority. */
  firstResponseHours: Record<Priority, number>;
  /** Resolution targets in hours, per priority. */
  resolveHours: Record<Priority, number>;
}

/* ── Tenants & users ──────────────────────────────────────────────── */

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  plan: Plan;
  slas: SlaPolicy;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  /** scrypt hash (hex), paired with `salt` */
  passwordHash: string;
  /** demo-constant salt (public-by-design for the iframe demo) */
  salt: string;
}

export interface Membership {
  id: string;
  tenantId: string;
  userId: string;
  role: Role;
}

/* ── Conversations ────────────────────────────────────────────────── */

export interface Conversation {
  id: string;
  tenantId: string;
  customerId: string;
  subject: string;
  status: Status;
  priority: Priority;
  /** null = unassigned */
  assigneeId: string | null;
  tags: string[];
  createdAt: string;
  /** ISO timestamp of the first agent reply, null until replied */
  firstRespondedAt: string | null;
  closedAt: string | null;
}

export interface Message {
  id: string;
  tenantId: string;
  conversationId: string;
  /** null for customer messages (they carry a customer ref, not a user) */
  authorId: string | null;
  body: string;
  role: "customer" | "agent";
  createdAt: string;
}

export interface SystemEvent {
  id: string;
  tenantId: string;
  conversationId: string;
  kind: "assigned" | "status_changed" | "priority_changed" | "tag_changed" | "replied" | "created";
  /** compact metadata (e.g. before/after values) */
  meta: Record<string, unknown>;
  actorId: string | null;
  createdAt: string;
}

/* ── Supporting entities ──────────────────────────────────────────── */

export interface Customer {
  id: string;
  tenantId: string;
  name: string;
  email: string;
}

export interface Tag {
  id: string;
  tenantId: string;
  label: string;
}

export interface CannedReply {
  id: string;
  tenantId: string;
  title: string;
  body: string;
}

export interface Invite {
  id: string;
  tenantId: string;
  email: string;
  role: Role;
  /** single-use token (crypto-random in prod, seed-deterministic here) */
  token: string;
  /** ISO — 24h after createdAt */
  expiresAt: string;
  /** ISO, set when accepted */
  usedAt: string | null;
  createdAt: string;
}

export interface SessionRow {
  id: string;
  userId: string;
  tenantId: string;
  /** ISO — now + 8h TTL */
  expiresAt: string;
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  meta: { before: unknown; after: unknown };
  createdAt: string;
}

/* ── Full state (the seed + store own this shape) ────────────────── */

export interface ParleyState {
  tenants: Tenant[];
  users: User[];
  memberships: Membership[];
  customers: Customer[];
  conversations: Conversation[];
  messages: Message[];
  events: SystemEvent[];
  tags: Tag[];
  canned: CannedReply[];
  invites: Invite[];
  sessions: SessionRow[];
  audit: AuditEvent[];
}

/* ── The pinned clock ─────────────────────────────────────────────── */

/**
 * The explicit "today" the seed anchors to. No `Date.now()` at seed
 * time — every time-dependent call takes an explicit `now` param; the
 * clock module (`clock.ts`) owns the single mutable read.
 */
export const AS_OF = "2026-10-28T12:00:00Z";
