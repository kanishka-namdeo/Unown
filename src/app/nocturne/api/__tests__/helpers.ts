/**
 * Shared helpers for the Nocturne API integration tests — drive the
 * exported `GET`/`POST`/`PATCH`/`DELETE` handlers with `Request`
 * objects, a pinned clock + a reset store, and signed session
 * cookies built through the REAL login path (never faked auth
 * state).
 *
 * Follows the aria helpers' shape: `freshStore()` reseeds the
 * file-backed store + wipes the rate-limit buckets, `cookieFor`
 * mints a real session cookie through `loginSession`, and `apiReq`
 * passes the session cookie through the `x-nocturne-cookie`
 * test-lane header (WHATWG's `Request` strips the forbidden
 * `cookie` header in the bun test lane — the real server path uses
 * the standard `cookie` header, exercised only against the running
 * dev server).
 */

import { getNocturne, loginSession, nocturneReset } from "@/app/nocturne/api/_state";
import { makeSignedCookie } from "@/lib/nocturne/sessions";
import { setClock, resetClock } from "@/lib/nocturne/clock";
import { resetRateBuckets } from "@/app/nocturne/api/_rate";
import { AS_OF, type NocturneRole } from "@/lib/nocturne/types";

/** Pin the clock + reseed the store + wipe the rate-limit buckets. */
export function freshStore(): void {
  resetClock();
  setClock(AS_OF);
  nocturneReset();
  resetRateBuckets();
}

/**
 * A signed session cookie for a seeded user (a REAL login — the
 * session row is created through `loginSession`, so
 * `sessionFromRequest` resolves it on the next probe).
 */
export function cookieFor(email: string): string {
  const s = getNocturne();
  const user = s.users.find((u) => u.email === email);
  if (!user) throw new Error(`unknown user: ${email}`);
  const membership = s.memberships.find((m) => m.userId === user.id)!;
  const session = loginSession(user.id, membership.tenantId);
  return `nocturne_ses=${encodeURIComponent(makeSignedCookie(session.id))}`;
}

/**
 * Build a `Request` for a Nocturne API route with an optional
 * session cookie (the `x-nocturne-cookie` test-lane header) + a
 * JSON body.
 */
export function apiReq(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  opts?: {
    cookie?: string;
    body?: unknown;
    xff?: string;
    query?: string;
  },
): Request {
  const headers: Record<string, string> = {};
  if (opts?.body !== undefined) headers["content-type"] = "application/json";
  if (opts?.cookie) {
    headers["x-nocturne-cookie"] = encodeURIComponent(opts.cookie);
  }
  if (opts?.xff) headers["x-forwarded-for"] = opts.xff;

  const url = opts?.query
    ? `http://localhost${path}${opts.query}`
    : `http://localhost${path}`;

  return new Request(url, {
    method,
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

/** The seeded roles, by email (the role switcher's source list). */
export const SEED_ROLES: Record<string, NocturneRole> = {
  "mira@lumen.test": "owner",
  "theo@lumen.test": "admin",
  "ada@lumen.test": "responder",
  "sam@lumen.test": "responder",
  "kai@lumen.test": "viewer",
  "ingrid@northwind.test": "owner",
  "priya@northwind.test": "responder",
  "marco@northwind.test": "viewer",
};

/** Seed-tenant constants (the plan §1 seed discipline). */
export const TENANT_IDS = {
  lumen: "tn-lumen",
  northwind: "tn-northwind",
};

/** A seeded entity id for a tenant (the first row of that kind). */
const SEED_KEY: Record<string, string> = {
  service: "services",
  rotation: "rotations",
  incident: "incidents",
  runbook: "runbooks",
  override: "overrides",
  alert: "alerts",
  note: "notes",
  component: "components",
  postmortem: "postmortems",
  checklist: "checklists",
};

export function seededIdFor(
  tenantId: string,
  kind:
    | "service"
    | "rotation"
    | "incident"
    | "runbook"
    | "override"
    | "alert"
    | "note"
    | "component"
    | "postmortem"
    | "checklist",
  index = 0,
): string {
  const s = getNocturne();
  const key = SEED_KEY[kind];
  type SeedRow = { tenantId: string; id: string };
  const rows = (s as unknown as Record<string, SeedRow[]>)[key];
  const found = rows.filter((x) => x.tenantId === tenantId)[index];
  if (!found) throw new Error(`no ${kind} ${index} for ${tenantId}`);
  return found.id;
}

/** A seeded INCIDENT id in a specific state (the lifecycle probes). */
export function seededIncidentInState(
  tenantId: string,
  status: "triggered" | "acknowledged" | "snoozed" | "resolved",
): string {
  const s = getNocturne();
  const row = s.incidents.find((i) => i.tenantId === tenantId && i.status === status);
  if (!row) throw new Error(`no ${status} incident for ${tenantId}`);
  return row.id;
}

/** The first seeded RESOLVED incident (the postmortem trail's fixture). */
export function resolvedIncidentFor(tenantId: string): string {
  return seededIncidentInState(tenantId, "resolved");
}

/** The first seeded OPEN incident (`triggered`). */
export function openIncidentFor(tenantId: string): string {
  return seededIncidentInState(tenantId, "triggered");
}
