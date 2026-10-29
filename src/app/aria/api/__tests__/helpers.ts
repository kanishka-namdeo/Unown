/**
 * Shared helpers for the aria API integration tests — drive the
 * exported `GET`/`POST`/`PATCH`/`DELETE` handlers with `Request`
 * objects, a pinned clock + a reset store, and signed session
 * cookies built through the REAL login path (never faked auth
 * state).
 *
 * Follows the parley helpers' shape: `freshStore()` resets the
 * aria-store singleton + reseeds via the file store, `cookieFor`
 * mints a real session cookie through `loginSession`, and `apiReq`
 * passes the session cookie through the `x-aria-cookie` test-lane
 * header (WHATWG's `Request` strips the forbidden `cookie` header
 * in the bun test lane — the real server path uses the standard
 * `cookie` header, exercised only against the running dev server).
 */

import { resetAria, getAria, loginSession } from "@/lib/aria/aria-store";
import { makeSignedCookie } from "@/lib/aria/sessions";
import { setClock, resetClock } from "@/lib/aria/clock";
import { resetRateBuckets } from "@/app/aria/api/_rate";
import { AS_OF, type AriaRole } from "@/lib/aria/types";

/** Pin the clock + reseed the store + wipe the rate-limit buckets. */
export function freshStore(): void {
  resetClock();
  setClock(AS_OF);
  resetAria();
  resetRateBuckets();
}

/**
 * A signed session cookie for a seeded user (a REAL login — the
 * session row is created through `loginSession`, so
 * `sessionFromRequest` resolves it on the next probe).
 */
export function cookieFor(email: string): string {
  const s = getAria();
  const user = s.users.find((u) => u.email === email);
  if (!user) throw new Error(`unknown user: ${email}`);
  const membership = s.memberships.find((m) => m.userId === user.id)!;
  const session = loginSession(user.id, membership.tenantId);
  return `aria_ses=${encodeURIComponent(makeSignedCookie(session.id))}`;
}

/**
 * Build a `Request` for an aria API route with an optional session
 * cookie (the `x-aria-cookie` test-lane header) + a JSON body.
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
    headers["x-aria-cookie"] = encodeURIComponent(opts.cookie);
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
export const SEED_ROLES: Record<string, AriaRole> = {
  "mira@lumen.test": "owner",
  "theo@lumen.test": "manager",
  "ada@lumen.test": "rep",
  "sam@lumen.test": "viewer",
  "ingrid@northwind.test": "owner",
  "priya@northwind.test": "manager",
  "marco@northwind.test": "rep",
  "zoe@northwind.test": "rep",
};

/**
 * A seeded entity id for a tenant (the first one). The `key`
 * dispatch is a plain record so the cast stays clean.
 */
const SEED_KEY: Record<string, string> = {
  account: "accounts",
  contact: "contacts",
  lead: "leads",
  deal: "deals",
  pipeline: "pipelines",
  sequence: "sequences",
  enrollment: "enrollments",
  task: "tasks",
  note: "notes",
  tag: "tags",
};

export function seededIdFor(
  tenantId: string,
  kind:
    | "account"
    | "contact"
    | "lead"
    | "deal"
    | "pipeline"
    | "sequence"
    | "enrollment"
    | "task"
    | "note"
    | "tag",
  index = 0,
): string {
  const s = getAria();
  const key = SEED_KEY[kind];
  type SeedRow = { tenantId: string; id: string };
  const rows = (s as unknown as Record<string, SeedRow[]>)[key];
  const found = rows.filter((x) => x.tenantId === tenantId)[index];
  if (!found) throw new Error(`no ${kind} ${index} for ${tenantId}`);
  return found.id;
}

/** A seeded deal id for a tenant (the first open deal). */
export function openDealFor(tenantId: string, index = 0): string {
  const s = getAria();
  const deals = s.deals.filter((d) => d.tenantId === tenantId && d.closedAt === null);
  const found = deals[index];
  if (!found) throw new Error(`no open deal ${index} for ${tenantId}`);
  return found.id;
}

/** A seed-tenant constant id. */
export const TENANT_IDS = {
  lumen: "aria-tn-lumen",
  northwind: "aria-tn-northwind",
};
