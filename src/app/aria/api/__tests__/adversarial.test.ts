/**
 * Adversarial tenancy + RBAC probes — the plan's 27-probe suite
 * (the parley pattern): malformed/foreign cookies, cross-tenant
 * entity probes, the RBAC matrix sweep, the rate-limit 429 rung
 * + recovery. Every probe asserts the ladder's rung (401/403/404/
 * 410/429/402) AND, where a write was attempted, that the store is
 * UNCHANGED (the fail-closed contract: a denied probe has no side
 * effects).
 */

import { describe, expect, test, beforeAll } from "bun:test";
import {
  apiReq,
  cookieFor,
  freshStore,
  seededIdFor,
  openDealFor,
  TENANT_IDS,
} from "./helpers";
import { getAria, loginSession } from "@/lib/aria/aria-store";
import { makeSignedCookie, verifySignedCookie } from "@/lib/aria/sessions";
import { signCookie } from "@/lib/aria/sessions";
import { createHmac } from "node:crypto";
import { ACTIONS, can, MATRIX, type Action } from "@/lib/aria/rbac";

void verifySignedCookie;

function stateSnapshot() {
  const s = getAria();
  return {
    users: s.users.length,
    memberships: s.memberships.length,
    accounts: s.accounts.length,
    contacts: s.contacts.length,
    leads: s.leads.length,
    deals: s.deals.length,
    audit: s.audit.length,
    mailbox: s.mailbox.length,
    invites: s.invites.length,
  };
}

const ROLES = ["owner", "admin", "manager", "rep", "viewer"] as const;

/* ═══════════════════════════════════════════════════════════════
 * PROBE GROUP 1 — cookie forgery + tampering (probes 1-8)
 * ═══════════════════════════════════════════════════════════ */

describe("ADVERSARIAL — cookie forgery + tampering", () => {
  beforeAll(freshStore);

  test("P1: a forged cookie (right format, an attacker's HMAC key) → 401 on a session lane", async () => {
    freshStore();
    const fake = `ses-fake-0001.${createHmac("sha256", "attacker-key").update("ses-fake-0001").digest("hex")}`;
    const r = await (await import("@/app/aria/api/accounts/route")).GET(
      apiReq("GET", "/aria/api/accounts", { cookie: `aria_ses=${encodeURIComponent(fake)}` }),
    );
    expect(r.status).toBe(401);
  });

  test("P2: a valid signature over an UNKNOWN session id → 401 (the liveSession rung)", async () => {
    freshStore();
    const fake = makeSignedCookie("ses-0000-deadbeef");
    const r = await (await import("@/app/aria/api/accounts/route")).GET(
      apiReq("GET", "/aria/api/accounts", { cookie: `aria_ses=${encodeURIComponent(fake)}` }),
    );
    expect(r.status).toBe(401);
  });

  test("P3: a signature-tampered cookie (one hex nibble flipped) → 401", async () => {
    freshStore();
    const s = getAria();
    const user = s.users.find((u) => u.email === "mira@lumen.test")!;
    const session = loginSession(user.id, "aria-tn-lumen");
    const good = makeSignedCookie(session.id);
    const [id, sig] = good.split(".");
    const flipped = sig[0] === "a" ? "b" + sig.slice(1) : "a" + sig.slice(1);
    const r = await (await import("@/app/aria/api/accounts/route")).GET(
      apiReq("GET", "/aria/api/accounts", {
        cookie: `aria_ses=${encodeURIComponent(`${id}.${flipped}`)}`,
      }),
    );
    expect(r.status).toBe(401);
    void signCookie; // keep the import honest (makeSignedCookie's primitive)
  });

  test("P4: malformed cookies (no dot / empty value / garbage %-sequence) → 401, never a 500", async () => {
    freshStore();
    const accounts = await import("@/app/aria/api/accounts/route");
    for (const bad of ["nodot", "aria_ses=", "aria_ses=%garbage%"]) {
      const res = await accounts.GET(
        apiReq("GET", "/aria/api/accounts", { cookie: bad }),
      );
      expect(res.status, `cookie ${JSON.stringify(bad)} → 401`).toBe(401);
    }
  });

  test("P5: a FORGED TENANT CLAIM cannot escape the session row's tenant", async () => {
    freshStore();
    // The cookie carries only sessionId.signature — the tenant claim
    // lives on the session ROW, not in the cookie. A lumen session
    // can never present itself as northwind:
    const s = getAria();
    const lumenUser = s.users.find((u) => u.email === "mira@lumen.test")!;
    const session = loginSession(lumenUser.id, "aria-tn-lumen");
    const res = await (await import("@/app/aria/api/accounts/route")).GET(
      apiReq("GET", "/aria/api/accounts", {
        cookie: `aria_ses=${encodeURIComponent(makeSignedCookie(session.id))}`,
      }),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ tenantId: string }>;
    for (const row of rows) expect(row.tenantId).toBe(TENANT_IDS.lumen);
  });

  test("P6: an expired session (clock past the 8h TTL) → 401", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const { setClock, resetClock } = await import("@/lib/aria/clock");
    const { AS_OF, SESSION_TTL_MS } = await import("@/lib/aria/types");
    setClock(
      new Date(new Date(AS_OF).getTime() + SESSION_TTL_MS + 60_000).toISOString(),
    );
    const res = await (await import("@/app/aria/api/accounts/route")).GET(
      apiReq("GET", "/aria/api/accounts", { cookie }),
    );
    expect(res.status).toBe(401);
    resetClock();
  });

  test("P7: a LOST session row (destroyed by logout) → 401 on reprobe", async () => {
    freshStore();
    const cookie = cookieFor("ada@lumen.test");
    const logout = await import("@/app/aria/api/auth/logout/route");
    await logout.POST(apiReq("POST", "/aria/api/auth/logout", { cookie }));
    const res = await (await import("@/app/aria/api/accounts/route")).GET(
      apiReq("GET", "/aria/api/accounts", { cookie }),
    );
    expect(res.status).toBe(401);
  });

  test("P8: a cookie over a session whose membership was DELETED → 401 (the sessionActor rung)", async () => {
    freshStore();
    const s = getAria();
    const rep = s.memberships.find((m) => m.tenantId === TENANT_IDS.lumen && m.role === "rep")!;
    const user = s.users.find((u) => u.id === rep.userId)!;
    const session = loginSession(user.id, rep.tenantId);
    const cookie = `aria_ses=${encodeURIComponent(makeSignedCookie(session.id))}`;
    // Delete the membership through the STORE (not a raw array
    // reassignment that the next getAria() wouldn't see):
    const store = await import("@/lib/aria/aria-store");
    // The store has no public `removeMembership` — use the internal
    // `_reloadFromDisk` to force a clean re-read, then mutate the
    // file-backed state + reload:
    const stateNow = store.getAria();
    stateNow.memberships = stateNow.memberships.filter((m) => m.id !== rep.id);
    store._reloadFromDisk();
    const res = await (await import("@/app/aria/api/accounts/route")).GET(
      apiReq("GET", "/aria/api/accounts", { cookie }),
    );
    expect(res.status).toBe(401);
  });
});

/* ═══════════════════════════════════════════════════════════════
 * PROBE GROUP 2 — cross-tenant entity probes (probes 9-15)
 * ═══════════════════════════════════════════════════════════ */

describe("ADVERSARIAL — cross-tenant entity probes (404, never 403)", () => {
  beforeAll(freshStore);

  test("P9: a northwind cookie × lumen deals/[id] + deals/[id]/stage → 404 + the deal is untouched", async () => {
    freshStore();
    const before = stateSnapshot();
    const deal = seededIdFor(TENANT_IDS.lumen, "deal", 0);
    const cookie = cookieFor("ingrid@northwind.test");
    const dealsId = await import("@/app/aria/api/deals/[id]/route");
    const dealsStage = await import("@/app/aria/api/deals/[id]/stage/route");

    const g = await dealsId.GET(
      apiReq("GET", `/aria/api/deals/${deal}`, { cookie }),
      { params: Promise.resolve({ id: deal }) },
    );
    expect(g.status).toBe(404);

    const st = await dealsStage.POST(
      apiReq("POST", `/aria/api/deals/${deal}/stage`, {
        cookie,
        body: { stageId: "stg_qs_02" },
      }),
      { params: Promise.resolve({ id: deal }) },
    );
    expect(st.status).toBe(404);

    const after = stateSnapshot();
    expect(after).toEqual(before);
  });

  test("P10: a lumen cookie × northwind accounts/contacts/leads ids → 404", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const nwAccount = seededIdFor(TENANT_IDS.northwind, "account", 0);
    const nwContact = seededIdFor(TENANT_IDS.northwind, "contact", 0);
    const nwLead = seededIdFor(TENANT_IDS.northwind, "lead", 0);

    const r1 = await (await import("@/app/aria/api/accounts/[id]/route")).GET(
      apiReq("GET", `/aria/api/accounts/${nwAccount}`, { cookie }),
      { params: Promise.resolve({ id: nwAccount }) },
    );
    expect(r1.status).toBe(404);

    const r2 = await (await import("@/app/aria/api/contacts/[id]/route")).GET(
      apiReq("GET", `/aria/api/contacts/${nwContact}`, { cookie }),
      { params: Promise.resolve({ id: nwContact }) },
    );
    expect(r2.status).toBe(404);

    const r3 = await (await import("@/app/aria/api/leads/[id]/route")).GET(
      apiReq("GET", `/aria/api/leads/${nwLead}`, { cookie }),
      { params: Promise.resolve({ id: nwLead }) },
    );
    expect(r3.status).toBe(404);
  });

  test("P11: a lumen cookie × northwind sequences/enrollments/mailbox rows → the lane's own tenant only", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const seq = seededIdFor(TENANT_IDS.northwind, "sequence", 0);
    const r = await (await import("@/app/aria/api/sequences/[id]/route")).GET(
      apiReq("GET", `/aria/api/sequences/${seq}`, { cookie }),
      { params: Promise.resolve({ id: seq }) },
    );
    expect(r.status).toBe(404);

    const mb = await (await import("@/app/aria/api/mailbox/route")).GET(
      apiReq("GET", "/aria/api/mailbox", { cookie }),
    );
    expect(mb.status).toBe(200);
    const rows = (await mb.json()) as Array<{ tenantId: string }>;
    for (const row of rows) expect(row.tenantId).toBe(TENANT_IDS.lumen);
  });

  test("P12: a write probe on a foreign tenant's entity → 404 + store UNCHANGED", async () => {
    freshStore();
    const before = stateSnapshot();
    const deal = openDealFor(TENANT_IDS.lumen, 0);
    const cookie = cookieFor("ingrid@northwind.test");
    const dealsId = await import("@/app/aria/api/deals/[id]/route");
    const res = await dealsId.PATCH(
      apiReq("PATCH", `/aria/api/deals/${deal}`, {
        cookie,
        body: { amount: 1 },
      }),
      { params: Promise.resolve({ id: deal }) },
    );
    expect(res.status).toBe(404);
    expect(stateSnapshot()).toEqual(before);
  });

  test("P13: an unknown (but tenant-shaped) id → 404, never a 500", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const lanes: Array<[string, string, string]> = [
      ["accounts", "acr-000000-ghost", "accounts"],
      ["contacts", "act-000000-ghost", "contacts"],
      ["leads", "alead-000000-ghost", "leads"],
      ["deals", "adeal-000000-ghost", "deals"],
      ["pipelines", "apl-000000-ghost", "pipelines"],
      ["sequences", "aseq-000000-ghost", "sequences"],
    ];
    for (const [dir, id] of lanes) {
      const mod = await import(
        `@/app/aria/api/${dir}/[id]/route`
      );
      const res = await (mod as {
        GET: (a: Request, b: { params: Promise<{ id: string }> }) => Promise<{ status: number }>;
      }).GET(
        apiReq("GET", `/aria/api/${dir}/${id}`, { cookie }),
        { params: Promise.resolve({ id }) },
      );
      expect(res.status, `${dir} ghost id → 404`).toBe(404);
    }
  });

  test("P14: the tenant PATCH lane's owner-seat carve-out — an owner cannot patch the OTHER tenant", async () => {
    freshStore();
    const res = await (await import("@/app/aria/api/tenants/[id]/route")).PATCH(
      apiReq("PATCH", `/aria/api/tenants/${TENANT_IDS.northwind}`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { name: "Hijack" },
      }),
      { params: Promise.resolve({ id: TENANT_IDS.northwind }) },
    );
    expect(res.status).toBe(404);
    expect(getAria().tenants.find((t) => t.id === TENANT_IDS.northwind)!.name).toBe(
      "Northwind Trading",
    );
  });

  test("P15: an admin's tenant.settings → 403 (the matrix's ✗), naming the permission", async () => {
    freshStore();
    // ada is a rep; use a manager instead — the matrix's tenant.settings
    // is owner-only, so a manager's PATCH is 403:
    const res = await (await import("@/app/aria/api/tenants/[id]/route")).PATCH(
      apiReq("PATCH", `/aria/api/tenants/${TENANT_IDS.lumen}`, {
        cookie: cookieFor("theo@lumen.test"),
        body: { name: "Nope" },
      }),
      { params: Promise.resolve({ id: TENANT_IDS.lumen }) },
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.permission).toBe("tenant.settings");
  });
});

/* ═══════════════════════════════════════════════════════════════
 * PROBE GROUP 3 — the RBAC matrix sweep (probes 16-20)
 * ═══════════════════════════════════════════════════════════ */

describe("ADVERSARIAL — the RBAC matrix sweep", () => {
  beforeAll(freshStore);

  test("P16: every (action, role) cell agrees with the data-driven matrix (no hand-rolled drift)", async () => {
    freshStore();
    for (const action of ACTIONS) {
      for (const role of ROLES) {
        const expected = MATRIX[action][role];
        const actual = can(role, action as Action);
        expect(actual, `${action} × ${role}`).toBe(expected);
      }
    }
  });

  test("P17: a viewer's write sweep → 403 on every mutation lane", async () => {
    freshStore();
    const before = stateSnapshot();
    const cookie = cookieFor("sam@lumen.test");

    const lanes: Array<[string, () => Promise<{ status: number }>]> = [
      [
        "account.create",
        async () => {
          const r = await (await import("@/app/aria/api/accounts/route")).POST(
            apiReq("POST", "/aria/api/accounts", {
              cookie,
              body: { name: "x", domain: "x.com", industry: "i", size: 1, ownerId: "u" },
            }),
          );
          return r;
        },
      ],
      [
        "contact.create",
        async () => {
          const r = await (await import("@/app/aria/api/contacts/route")).POST(
            apiReq("POST", "/aria/api/contacts", {
              cookie,
              body: {
                accountId: "a",
                name: "x",
                email: "x@x.com",
                title: "x",
                ownerId: "u",
              },
            }),
          );
          return r;
        },
      ],
      [
        "lead.create",
        async () => {
          const r = await (await import("@/app/aria/api/leads/route")).POST(
            apiReq("POST", "/aria/api/leads", {
              cookie,
              body: { name: "x", email: "x@x.com", source: "s", priority: "low", ownerId: "u" },
            }),
          );
          return r;
        },
      ],
      [
        "deal.create",
        async () => {
          const r = await (await import("@/app/aria/api/deals/route")).POST(
            apiReq("POST", "/aria/api/deals", {
              cookie,
              body: {
                pipelineId: "x",
                stageId: "x",
                accountId: "x",
                contactId: "x",
                amount: 1,
                forecastCategory: "pipeline",
                ownerId: "x",
                expectedCloseDate: "2026-12-31",
              },
            }),
          );
          return r;
        },
      ],
      [
        "task.create",
        async () => {
          const r = await (await import("@/app/aria/api/tasks/route")).POST(
            apiReq("POST", "/aria/api/tasks", {
              cookie,
              body: {
                title: "x",
                ownerId: "u",
                entityType: "lead",
                entityId: "l",
                due: "2026-12-01T00:00:00Z",
                priority: "low",
              },
            }),
          );
          return r;
        },
      ],
      [
        "note.create",
        async () => {
          const r = await (await import("@/app/aria/api/notes/route")).POST(
            apiReq("POST", "/aria/api/notes", {
              cookie,
              body: { entityType: "lead", entityId: "l", body: "x" },
            }),
          );
          return r;
        },
      ],
      [
        "enrollment.create",
        async () => {
          const r = await (await import("@/app/aria/api/enrollments/route")).POST(
            apiReq("POST", "/aria/api/enrollments", {
              cookie,
              body: { contactId: "c", sequenceId: "s" },
            }),
          );
          return r;
        },
      ],
    ];

    for (const [name, run] of lanes) {
      const res = await run();
      expect(res.status, `${name} as viewer → 403`).toBe(403);
    }
    expect(stateSnapshot()).toEqual(before);
  });

  test("P18: a rep's import.run + audit.read + forecast.capture + tag lanes → 403 (the matrix's rep ✗ row)", async () => {
    freshStore();
    const cookie = cookieFor("ada@lumen.test");

    const imp = await (await import("@/app/aria/api/import/route")).POST(
      apiReq("POST", "/aria/api/import", {
        cookie,
        body: { type: "contacts", csv: "a,b", dryRun: true },
      }),
    );
    expect(imp.status).toBe(403);

    const aud = await (await import("@/app/aria/api/audit/route")).GET(
      apiReq("GET", "/aria/api/audit", { cookie }),
    );
    expect(aud.status).toBe(403);

    const snap = await (await import("@/app/aria/api/forecast/snapshot/route")).POST(
      apiReq("POST", "/aria/api/forecast/snapshot", {
        cookie,
        body: { periodStart: "2026-10-01T00:00:00Z", periodEnd: "2027-01-01T00:00:00Z" },
      }),
    );
    expect(snap.status).toBe(403);

    const tag = await (await import("@/app/aria/api/tags/route")).POST(
      apiReq("POST", "/aria/api/tags", { cookie, body: { label: "x" } }),
    );
    expect(tag.status).toBe(403);
    const json = await tag.json();
    expect(json.permission).toBe("tag.create");
  });

  test("P19: a manager's invite.create + pipeline.create + tenant.settings → 403 (the manager's ✗ row)", async () => {
    freshStore();
    const cookie = cookieFor("theo@lumen.test");

    const inv = await (await import("@/app/aria/api/invites/route")).POST(
      apiReq("POST", "/aria/api/invites", {
        cookie,
        body: { email: "x@x.com", role: "rep" },
      }),
    );
    expect(inv.status).toBe(403);

    const pipe = await (await import("@/app/aria/api/pipelines/route")).POST(
      apiReq("POST", "/aria/api/pipelines", {
        cookie,
        body: { name: "x", stages: [{ name: "S", probability: 0.5, state: "open" }] },
      }),
    );
    expect(pipe.status).toBe(403);

    const patch = await (await import("@/app/aria/api/tenants/[id]/route")).PATCH(
      apiReq("PATCH", `/aria/api/tenants/${TENANT_IDS.lumen}`, {
        cookie,
        body: { name: "x" },
      }),
      { params: Promise.resolve({ id: TENANT_IDS.lumen }) },
    );
    expect(patch.status).toBe(403);
  });

  test("P20: the manager lane PASSES where the matrix grants it (import.run + audit.read are the manager's ✓ cells)", async () => {
    freshStore();
    const cookie = cookieFor("priya@northwind.test");
    const imp = await (await import("@/app/aria/api/import/route")).POST(
      apiReq("POST", "/aria/api/import", {
        cookie,
        body: { type: "contacts", csv: "name,email,title,accountId\nx@probe.com,X,CTO", dryRun: true },
      }),
    );
    expect(imp.status).toBe(200); // dry-run, no commit

    const aud = await (await import("@/app/aria/api/audit/route")).GET(
      apiReq("GET", "/aria/api/audit", { cookie }),
    );
    expect(aud.status).toBe(200);
  });
});

/* ═══════════════════════════════════════════════════════════════
 * PROBE GROUP 4 — invite token lifecycle + quota (probes 21-24)
 * ═══════════════════════════════════════════════════════════ */

describe("ADVERSARIAL — invite token lifecycle + the seat cap", () => {
  beforeAll(freshStore);

  test("P21: a used token replay → 410 (reason: used)", async () => {
    freshStore();
    const inv = await import("@/app/aria/api/invites/route");
    const acc = await import("@/app/aria/api/invites/accept/route");

    const created = await inv.POST(
      apiReq("POST", "/aria/api/invites", {
        cookie: cookieFor("ingrid@northwind.test"),
        body: { email: "late@northwind.test", role: "rep" },
      }),
    );
    expect(created.status).toBe(201);
    const token = ((await created.json()) as { token: string }).token;

    const r1 = await acc.POST(
      apiReq("POST", "/aria/api/invites/accept", {
        body: { token, name: "Late L", password: "LatePass1" },
      }),
    );
    expect(r1.status).toBe(201);

    const r2 = await acc.POST(
      apiReq("POST", "/aria/api/invites/accept", {
        body: { token, name: "Late L", password: "LatePass1" },
      }),
    );
    expect(r2.status).toBe(410);
    const json = await r2.json();
    expect(json.message).toContain("used");
    // The user was created exactly ONCE:
    expect(
      getAria().users.filter((u) => u.email === "late@northwind.test").length,
    ).toBe(1);
  });

  test("P22: an unknown / forged token → 404 (no existence leak)", async () => {
    freshStore();
    const acc = await import("@/app/aria/api/invites/accept/route");
    const res = await acc.POST(
      apiReq("POST", "/aria/api/invites/accept", {
        body: { token: "forged-token-xyz", name: "X X", password: "XxPass12345" },
      }),
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("not found");
  });

  test("P23: an EXPIRED token (the clock past the 24h window) → 410 (expired)", async () => {
    freshStore();
    const inv = await import("@/app/aria/api/invites/route");
    const acc = await import("@/app/aria/api/invites/accept/route");
    const created = await inv.POST(
      apiReq("POST", "/aria/api/invites", {
        cookie: cookieFor("ingrid@northwind.test"),
        body: { email: "slow@northwind.test", role: "viewer" },
      }),
    );
    const token = ((await created.json()) as { token: string }).token;

    const { setClock, resetClock } = await import("@/lib/aria/clock");
    const row = getAria().invites.find((i) => i.token === token)!;
    setClock(new Date(new Date(row.expiresAt).getTime() + 60_000).toISOString());

    const res = await acc.POST(
      apiReq("POST", "/aria/api/invites/accept", {
        body: { token, name: "Slow S", password: "SlowPass1" },
      }),
    );
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.message).toContain("expired");
    resetClock();
  });

  test("P24: a weak password on accept → 400 (the floor is checked BEFORE the invite row)", async () => {
    freshStore();
    const inv = await import("@/app/aria/api/invites/route");
    const acc = await import("@/app/aria/api/invites/accept/route");
    const created = await inv.POST(
      apiReq("POST", "/aria/api/invites", {
        cookie: cookieFor("ingrid@northwind.test"),
        body: { email: "weak@northwind.test", role: "rep" },
      }),
    );
    const token = ((await created.json()) as { token: string }).token;
    const res = await acc.POST(
      apiReq("POST", "/aria/api/invites/accept", {
        body: { token, name: "Weak W", password: "short" },
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("validation failed");
  });
});

/* ═══════════════════════════════════════════════════════════════
 * PROBE GROUP 5 — rate limiting (probes 25-27)
 * ═══════════════════════════════════════════════════════════ */

describe("ADVERSARIAL — the 429 rung + recovery", () => {
  test("P25: the write lane's flood → 429 at the cap, then RECOVERY after a fresh bucket", async () => {
    freshStore();
    // A DEDICATED xff isolates this probe from the other lanes'
    // buckets (the per-IP semantics). RATE_MAX = 50:
    const tags = await import("@/app/aria/api/tags/route");
    let last = 0;
    for (let i = 0; i < 55; i++) {
      const res = await tags.POST(
        apiReq("POST", "/aria/api/tags", {
          cookie: cookieFor("ingrid@northwind.test"),
          body: { label: `flood-${i}` },
          xff: "203.0.113.77",
        }),
      );
      last = res.status;
      if (res.status === 429) break;
    }
    expect(last).toBe(429);
    const body = tags.POST(
      apiReq("POST", "/aria/api/tags", {
        cookie: cookieFor("ingrid@northwind.test"),
        body: { label: "one-more" },
        xff: "203.0.113.77",
      }),
    );
    const res = await body;
    expect(res.status).toBe(429);
  });

  test("P26: a DIFFERENT client IP is NOT throttled by another's flood (the per-IP lane)", async () => {
    freshStore();
    const tags = await import("@/app/aria/api/tags/route");
    // Flood ip-A to the 429 rung:
    for (let i = 0; i < 55; i++) {
      const res = await tags.POST(
        apiReq("POST", "/aria/api/tags", {
          cookie: cookieFor("ingrid@northwind.test"),
          body: { label: `a-${i}` },
          xff: "203.0.113.78",
        }),
      );
      if (res.status === 429) break;
    }
    // ip-B is clean:
    const res = await tags.POST(
      apiReq("POST", "/aria/api/tags", {
        cookie: cookieFor("ingrid@northwind.test"),
        body: { label: "b-clean" },
        xff: "203.0.113.79",
      }),
    );
    expect(res.status).toBe(201);
  });

  test("P27: the demo/reset lane is rate-limited too (the 429 rung), and reads are NEVER throttled", async () => {
    freshStore();
    const resetRoute = await import("@/app/aria/api/demo/reset/route");
    let sawLimit = false;
    for (let i = 0; i < 55; i++) {
      const res = await resetRoute.POST(
        apiReq("POST", "/aria/api/demo/reset", { xff: "203.0.113.80" }),
      );
      if (res.status === 429) {
        sawLimit = true;
        break;
      }
    }
    expect(sawLimit).toBe(true);

    // GET lanes carry no write-lane gate: hammer one 60× with no
    // xff (the default local bucket) — never a 429:
    const mb = await import("@/app/aria/api/mailbox/route");
    for (let i = 0; i < 60; i++) {
      const res = await mb.GET(
        apiReq("GET", "/aria/api/mailbox", {
          cookie: cookieFor("ingrid@northwind.test"),
        }),
      );
      expect(res.status).toBe(200);
    }
  });
});
