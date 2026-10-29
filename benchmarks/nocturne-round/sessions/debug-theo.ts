/** debug-theo.ts — trace the failing admin override DELETE (N14's stuck fix).
 *  Reproduces the exact test steps with per-step prints. */
import { getNocturne, nocturneReset, loginSession } from "../../../src/app/nocturne/api/_state";
import { seedNocturne } from "../../../src/lib/nocturne/seed";
import { resetClock, setClock } from "../../../src/lib/nocturne/clock";
import { AS_OF } from "../../../src/lib/nocturne/types";
import * as overridesPostRoute from "../../../src/app/nocturne/api/rotations/[id]/overrides/route";
import * as overrideByIdRoute from "../../../src/app/nocturne/api/overrides/[id]/route";
import { makeSignedCookie } from "../../../src/lib/nocturne/sessions";
import { getNocturne } from "../../../src/app/nocturne/api/_state";

// --- freshStore() equivalent ---
resetClock();
setClock(AS_OF);
nocturneReset();
console.log("store seeded, overrides:", getNocturne().overrides.length);

const s = getNocturne();
const theo = s.users.find((u) => u.email === "theo@lumen.test")!;
const theoMem = s.memberships.find((m) => m.userId === theo.id)!;
console.log("theo membership:", theoMem.id, theoMem.tenantId, theoMem.role);
const sam = s.users.find((u) => u.email === "sam@lumen.test")!;

function cookieFor(email: string): string {
  const st = getNocturne();
  const user = st.users.find((u) => u.email === email)!;
  const membership = st.memberships.find((m) => m.userId === user.id)!;
  const session = loginSession(user.id, membership.tenantId);
  return `nocturne_ses=${encodeURIComponent(makeSignedCookie(session.id))}`;
}

function apiReq(method: string, path: string, opts: { cookie?: string; body?: unknown }): Request {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers["x-nocturne-cookie"] = encodeURIComponent(opts.cookie);
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

const cookie = cookieFor("theo@lumen.test");
const create = await overridesPostRoute.POST(
  apiReq("POST", "/nocturne/api/rotations/nc_seed_rot_01/overrides", {
    cookie,
    body: {
      forUserId: "usr-lumen-mira",
      userId: "usr-lumen-theo",
      startsAt: "2026-11-02T00:00:00Z",
      endsAt: "2026-11-05T00:00:00Z",
      reason: "Theo covers Mira",
    },
  }),
  { params: Promise.resolve({ id: "nc_seed_rot_01" }) },
);
console.log("CREATE status:", create.status);
const created = await create.json();
console.log("CREATE body:", JSON.stringify(created).slice(0, 300));
const ovr = created.id;
if (!ovr) {
  console.log("CREATE FAILED — override id missing; the DELETE then 404s/403s on undefined");
  process.exit(0);
}

const den = await overrideByIdRoute.DELETE(
  apiReq("DELETE", `/nocturne/api/overrides/${ovr}`, { cookie: cookieFor("sam@lumen.test") }),
  { params: Promise.resolve({ id: ovr }) },
);
console.log("SAM DELETE status (want 403):", den.status, JSON.stringify(await den.json()));

import { sessionFromRequest } from "../../../src/app/nocturne/api/_auth";
const theoCookieReq = apiReq("GET", "/nocturne/api/overrides/x", { cookie: cookieFor("theo@lumen.test") });
const resolved = sessionFromRequest(theoCookieReq);
console.log("RESOLVED theo session role:", resolved?.role, "| tenant:", resolved?.tenant.id, "| user:", resolved?.user.email);
const samReq = apiReq("GET", "/nocturne/api/overrides/x", { cookie: cookieFor("sam@lumen.test") });
const samResolved = sessionFromRequest(samReq);
console.log("RESOLVED sam session role:", samResolved?.role, "| tenant:", samResolved?.tenant.id);
const ok = await overrideByIdRoute.DELETE(
  apiReq("DELETE", `/nocturne/api/overrides/${ovr}`, { cookie: cookieFor("theo@lumen.test") }),
  { params: Promise.resolve({ id: ovr }) },
);
console.log("THEO DELETE status (want 204):", ok.status, ok.status === 403 ? JSON.stringify(await ok.json()) : "");
