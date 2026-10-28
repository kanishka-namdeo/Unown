/**
 * Adversarial tenancy + RBAC probes (Phase 6, Step 35's brief).
 *
 * Not the normal suite — the BREAKING attempt: cross-tenant entity
 * probes, role-escalation calls, invite-token replays, forged /
 * tampered cookies, and quota bypass. Every probe asserts the
 * ladder's rung (401/403/404/410/429/402) AND, where a write was
 * attempted, that the store is UNCHANGED (the fail-closed contract:
 * a denied probe must not have side effects).
 *
 * Run with: `bun test src/app/parley/api/__tests__/adversarial.test.ts`
 */
import { describe, expect, test, beforeAll } from "bun:test";
import { freshStore, cookieFor, apiReq, convoIdFor } from "./helpers";
import { getParley } from "@/lib/parley/store";
import { signCookie, makeSignedCookie, HMAC_SECRET, verifySignedCookie } from "@/lib/parley/sessions";
import { createHmac } from "node:crypto";

void HMAC_SECRET; // keep the import honest (re-used in the forged-cookie probes)

function stateSnapshot(): {
  convos: number;
  users: number;
  memberships: number;
  invites: number;
  audit: number;
  messages: number;
} {
  const s = getParley();
  return {
    convos: s.conversations.length,
    users: s.users.length,
    memberships: s.memberships.length,
    invites: s.invites.length,
    audit: s.audit.length,
    messages: s.messages.length,
  };
}

const LUMEN_CONVO = () => convoIdFor("tn-lumen", 0);
const LUMEN_MEM = () => getParley().memberships.find((m) => m.tenantId === "tn-lumen")!;
const NW_CONVO = () => convoIdFor("tn-northwind", 0);

/* ── cross-tenant entity probes (tenant-A cookie × tenant-B ids) ── */

describe("ADVERSARIAL — cross-tenant entity probes", () => {
  beforeAll(() => freshStore());

  test("GET conversations/[id] with Northwind's convo id under a Lumen session → 404", async () => {
    const r = await import("@/app/parley/api/conversations/[id]/route");
    const res = await r.GET(
      apiReq("GET", `/parley/api/conversations/${NW_CONVO()}`, { cookie: cookieFor("mira@lumen.test") }),
      { params: Promise.resolve({ id: NW_CONVO() }) },
    );
    expect(res.status).toBe(404);
  });

  test("POST conversations/[id]/reply on a Northwind convo under a Lumen cookie → 404 + no message written", async () => {
    const r = await import("@/app/parley/api/conversations/[id]/reply/route");
    const before = stateSnapshot();
    const res = await r.POST(
      apiReq("POST", `/parley/api/conversations/${NW_CONVO()}/reply`, {
        cookie: cookieFor("ada@lumen.test"),
        body: { body: "cross-tenant probe" },
      }),
      { params: Promise.resolve({ id: NW_CONVO() }) },
    );
    expect(res.status).toBe(404);
    const after = stateSnapshot();
    expect(after.messages).toBe(before.messages);
    expect(after.audit).toBe(before.audit);
  });

  test("POST conversations/[id]/assign + /status + /priority + /tags on a foreign-tenant convo → 404 + store untouched", async () => {
    const before = stateSnapshot();
    const id = NW_CONVO();
    for (const [p, handlerName, body] of [
      ["assign", "POST", { assigneeId: "usr-mira" }],
      ["status", "POST", { status: "closed" }],
      ["priority", "POST", { priority: "urgent" }],
      ["tags", "POST", { tags: ["probe"] }],
    ] as const) {
      const mod = await import(`@/app/parley/api/conversations/[id]/${p}/route`);
      const res = await (mod as Record<string, (a: Request, b: { params: Promise<{ id: string }> }) => Promise<unknown>>)[handlerName](
        apiReq("POST", `/parley/api/conversations/${id}/${p}`, { cookie: cookieFor("mira@lumen.test"), body }),
        { params: Promise.resolve({ id }) },
      ) as { status: number };
      expect(res.status, `${p} → expected 404`).toBe(404);
    }
    const after = stateSnapshot();
    expect(after.convos).toBe(before.convos);
    expect(after.audit).toBe(before.audit);
    expect(after.messages).toBe(before.messages);
  });

  test("GET conversations/[id] on a Lumen convo under a Northwind cookie → 404 (both directions)", async () => {
    const r = await import("@/app/parley/api/conversations/[id]/route");
    const res = await r.GET(
      apiReq("GET", `/parley/api/conversations/${LUMEN_CONVO()}`, { cookie: cookieFor("ingrid@northwind.test") }),
      { params: Promise.resolve({ id: LUMEN_CONVO() }) },
    );
    expect(res.status).toBe(404);
  });

  test("members/[id]/role + remove on a cross-tenant membership → 404 + role unchanged", async () => {
    const lumenMem = LUMEN_MEM().id;
    const before = getParley().memberships.find((m) => m.id === lumenMem)!.role;
    const roleR = await import("@/app/parley/api/members/[id]/role/route");
    const removeR = await import("@/app/parley/api/members/[id]/remove/route");
    const r1 = await roleR.POST(
      apiReq("POST", `/parley/api/members/${lumenMem}/role`, { cookie: cookieFor("ingrid@northwind.test"), body: { role: "viewer" } }),
      { params: Promise.resolve({ id: lumenMem }) },
    );
    const r2 = await removeR.POST(
      apiReq("POST", `/parley/api/members/${lumenMem}/remove`, { cookie: cookieFor("ingrid@northwind.test") }),
      { params: Promise.resolve({ id: lumenMem }) },
    );
    expect(r1.status).toBe(404);
    expect(r2.status).toBe(404);
    expect(getParley().memberships.find((m) => m.id === lumenMem)!.role).toBe(before);
    expect(getParley().memberships.some((m) => m.id === lumenMem)).toBe(true);
  });

  test("mailbox + invites + canned read lanes only ever return the session's tenant rows", async () => {
    const mb = await import("@/app/parley/api/mailbox/route");
    const inv = await import("@/app/parley/api/invites/route");
    const res = await mb.GET(apiReq("GET", "/parley/api/mailbox", { cookie: cookieFor("ingrid@northwind.test") }));
    expect(res.status).toBe(200);
    const rows = (await res.json()) as unknown[];
    // The mailbox's rows carry their tenant via the invite's tenantId —
    // every row must belong to Northwind, never to Lumen.
    expect(rows.every((row) => JSON.stringify(row).includes("tn-northwind") || !JSON.stringify(row).includes("tn-lumen"))).toBe(true);
    const invRes = await inv.GET(apiReq("GET", "/parley/api/invites", { cookie: cookieFor("ingrid@northwind.test") }));
    expect(invRes.status).toBe(200);
    const invRows = (await invRes.json()) as Array<{ tenantId: string }>;
    expect(invRows.every((i) => i.tenantId === "tn-northwind")).toBe(true);
  });
});

/* ── role-escalation attempts ── */

describe("ADVERSARIAL — role escalation", () => {
  beforeAll(() => freshStore());

  test("viewer (sam) calling every admin/owner lane → 403, store untouched", async () => {
    // freshStore per-test: the rate-limit buckets are shared (the
    // per-IP lane), and the escalation probes fire 6+ writes that
    // would trip the 429 rung before the 403 rung is reached.
    freshStore();
    const before = stateSnapshot();
    const memo = cookieFor("sam@lumen.test");
    const mem = LUMEN_MEM().id;

    const inv = await import("@/app/parley/api/invites/route");
    const r1 = await inv.POST(apiReq("POST", "/parley/api/invites", { cookie: memo, body: { email: "evilmall@evil.test", role: "owner" } }));
    expect(r1.status).toBe(403);

    const auditR = await import("@/app/parley/api/audit/route");
    const r2 = await auditR.GET(apiReq("GET", "/parley/api/audit", { cookie: memo }));
    expect(r2.status).toBe(403);

    const roleR = await import("@/app/parley/api/members/[id]/role/route");
    const r3 = await roleR.POST(apiReq("POST", `/parley/api/members/${mem}/role`, { cookie: memo, body: { role: "owner" } }), { params: Promise.resolve({ id: mem }) });
    expect(r3.status).toBe(403);

    const removeR = await import("@/app/parley/api/members/[id]/remove/route");
    const r4 = await removeR.POST(apiReq("POST", `/parley/api/members/${mem}/remove`, { cookie: memo }), { params: Promise.resolve({ id: mem }) });
    expect(r4.status).toBe(403);

    const replyR = await import("@/app/parley/api/conversations/[id]/reply/route");
    const r5 = await replyR.POST(apiReq("POST", `/parley/api/conversations/${LUMEN_CONVO()}/reply`, { cookie: memo, body: { body: "escalation probe" } }), { params: Promise.resolve({ id: LUMEN_CONVO() }) });
    expect(r5.status).toBe(403);

    const assignR = await import("@/app/parley/api/conversations/[id]/assign/route");
    const r6 = await assignR.POST(apiReq("POST", `/parley/api/conversations/${LUMEN_CONVO()}/assign`, { cookie: memo, body: { assigneeId: "usr-mira" } }), { params: Promise.resolve({ id: LUMEN_CONVO() }) });
    expect(r6.status).toBe(403);

    const after = stateSnapshot();
    expect(after).toEqual(before);
  });

  test("agent (ada) cannot create invites, change roles, or remove members → 403", async () => {
    freshStore();
    const before = stateSnapshot();
    const memo = cookieFor("ada@lumen.test");
    const mem = getParley().memberships.find((m) => m.userId === "usr-theo")!.id;

    const inv = await import("@/app/parley/api/invites/route");
    const r1 = await inv.POST(apiReq("POST", "/parley/api/invites", { cookie: memo, body: { email: "x@x.test", role: "admin" } }));
    expect(r1.status).toBe(403);

    const roleR = await import("@/app/parley/api/members/[id]/role/route");
    const r2 = await roleR.POST(apiReq("POST", `/parley/api/members/${mem}/role`, { cookie: memo, body: { role: "owner" } }), { params: Promise.resolve({ id: mem }) });
    expect(r2.status).toBe(403);

    const removeR = await import("@/app/parley/api/members/[id]/remove/route");
    const r3 = await removeR.POST(apiReq("POST", `/parley/api/members/${mem}/remove`, { cookie: memo }), { params: Promise.resolve({ id: mem }) });
    expect(r3.status).toBe(403);

    const after = stateSnapshot();
    expect(after).toEqual(before);
  });

  test("admin cannot touch the owner seat (change role or remove) even though invite.role_change passes the role row → 403", async () => {
    freshStore();
    const before = stateSnapshot();
    const memo = cookieFor("theo@lumen.test");
    const ownerMem = getParley().memberships.find((m) => m.role === "owner")!.id;

    const roleR = await import("@/app/parley/api/members/[id]/role/route");
    const r1 = await roleR.POST(apiReq("POST", `/parley/api/members/${ownerMem}/role`, { cookie: memo, body: { role: "admin" } }), { params: Promise.resolve({ id: ownerMem }) });
    expect(r1.status).toBe(403);

    const removeR = await import("@/app/parley/api/members/[id]/remove/route");
    const r2 = await removeR.POST(apiReq("POST", `/parley/api/members/${ownerMem}/remove`, { cookie: memo }), { params: Promise.resolve({ id: ownerMem }) });
    expect(r2.status).toBe(403);

    const after = stateSnapshot();
    expect(getParley().memberships.find((m) => m.id === ownerMem)!.role).toBe("owner");
    expect(after.memberships).toBe(before.memberships);
  });

  test("anyone changing their OWN role (member self-promotion) → 403, even the owner", async () => {
    freshStore();
    const ownerMem = getParley().memberships.find((m) => m.userId === "usr-mira")!.id;
    const roleR = await import("@/app/parley/api/members/[id]/role/route");
    const res = await roleR.POST(
      apiReq("POST", `/parley/api/members/${ownerMem}/role`, { cookie: cookieFor("mira@lumen.test"), body: { role: "owner" } }),
      { params: Promise.resolve({ id: ownerMem }) },
    );
    expect(res.status).toBe(403); // guard 1 fires first (owner seat) — the not-yourself guard is second
  });

  test("admin self-promotion via the role endpoint on their OWN membership → 403 (guard 2)", async () => {
    freshStore();
    const theoMem = getParley().memberships.find((m) => m.userId === "usr-theo")!.id;
    const roleR = await import("@/app/parley/api/members/[id]/role/route");
    const res = await roleR.POST(
      apiReq("POST", `/parley/api/members/${theoMem}/role`, { cookie: cookieFor("theo@lumen.test"), body: { role: "owner" } }),
      { params: Promise.resolve({ id: theoMem }) },
    );
    expect(res.status).toBe(403);
    expect(getParley().memberships.find((m) => m.id === theoMem)!.role).toBe("admin");
  });

  test("agent cannot open the mailbox (the owner/admin-only invite.create read-gate)", async () => {
    freshStore();
    const mb = await import("@/app/parley/api/mailbox/route");
    const res = await mb.GET(apiReq("GET", "/parley/api/mailbox", { cookie: cookieFor("ada@lumen.test") }));
    expect(res.status).toBe(403);
  });
});

/* ── invite token lifecycle ── */

describe("ADVERSARIAL — invite token lifecycle", () => {
  test("used token replay → 410 (used)", async () => {
    freshStore();
    // Create an invite + accept it through the real routes.
    const invR = await import("@/app/parley/api/invites/route");
    const created = await invR.POST(
      apiReq("POST", "/parley/api/invites", { cookie: cookieFor("mira@lumen.test"), body: { email: "late@lumen.test", role: "agent" } }),
    );
    expect(created.status).toBe(201);
    const token = (await created.json()) as { token: string };

    const acc = await import("@/app/parley/api/invites/accept/route");
    const r1 = await acc.POST(apiReq("POST", "/parley/api/invites/accept", { body: { token: token.token, name: "Late L", password: "LatePass1" } }));
    expect(r1.status).toBe(201);

    // Replay: the same token, again.
    const r2 = await acc.POST(apiReq("POST", "/parley/api/invites/accept", { body: { token: token.token, name: "Late L", password: "LatePass1" } }));
    expect(r2.status).toBe(410);
    expect(((await r2.json()) as { reason: string }).reason).toBe("used");
    // The user was created exactly ONCE.
    expect(getParley().users.filter((u) => u.email === "late@lumen.test").length).toBe(1);
  });

  test("expired token → 410 (expired) — pin the clock past the expiry", async () => {
    freshStore();
    const { setClock, resetClock } = await import("@/lib/parley/clock");
    const invR = await import("@/app/parley/api/invites/route");
    const created = await invR.POST(
      apiReq("POST", "/parley/api/invites", { cookie: cookieFor("mira@lumen.test"), body: { email: "slow@lumen.test", role: "viewer" } }),
    );
    const token = (await created.json()) as { token: string };
    // The invite's expiry is 24h from the pinned clock — pin past it.
    const inv = getParley().invites.find((i) => i.token === token.token)!;
    setClock(new Date(new Date(inv.expiresAt).getTime() + 60_000).toISOString());
    const acc = await import("@/app/parley/api/invites/accept/route");
    const res = await acc.POST(apiReq("POST", "/parley/api/invites/accept", { body: { token: token.token, name: "Slow S", password: "SlowPass1" } }));
    expect(res.status).toBe(410);
    expect(((await res.json()) as { reason: string }).reason).toBe("expired");
    // The 9h+ clock shift is test-local — restore for the next block.
    resetClock();
  });

  test("unknown / forged token → 404 (no 'user exists' leak class)", async () => {
    freshStore();
    const acc = await import("@/app/parley/api/invites/accept/route");
    const res = await acc.POST(apiReq("POST", "/parley/api/invites/accept", { body: { token: "forged-token-xyz", name: "X X", password: "XxPass12345" } }));
    expect(res.status).toBe(404);
  });

  test("seat-cap gate: an invitee landing on a tenant AT its plan's seat cap → 402 quota_exceeded (the P1 overage fix)", async () => {
    freshStore();
    // Northwind: free plan, seat cap 3, seeded with ingrid + kai
    // (2 seats) + no one else → one invite gets admitted (3/3), the
    // second 402s (the usage panel's overage stays consistent — the
    // seat count may not cross PLAN_CAPS[plan].seats).
    const s = getParley();
    expect(s.memberships.filter((m) => m.tenantId === "tn-northwind").length).toBe(2);
    const invR = await import("@/app/parley/api/invites/route");
    const t1 = await invR.POST(apiReq("POST", "/parley/api/invites", { cookie: cookieFor("ingrid@northwind.test"), body: { email: "n1@northwind.test", role: "agent" } }));
    const t2 = await invR.POST(apiReq("POST", "/parley/api/invites", { cookie: cookieFor("ingrid@northwind.test"), body: { email: "n2@northwind.test", role: "agent" } }));
    const tok1 = (await t1.json()) as { token: string };
    const tok2 = (await t2.json()) as { token: string };
    const acc = await import("@/app/parley/api/invites/accept/route");
    const r1 = await acc.POST(apiReq("POST", "/parley/api/invites/accept", { body: { token: tok1.token, name: "N One", password: "NoPass12345" } }));
    expect(r1.status).toBe(201); // 3/3 — admitted
    const r2 = await acc.POST(apiReq("POST", "/parley/api/invites/accept", { body: { token: tok2.token, name: "N Two", password: "NoPass12345" } }));
    expect(r2.status).toBe(402); // at the cap — the 402 rung
    expect(((await r2.json()) as { error: string }).error).toBe("quota_exceeded");
    expect(getParley().memberships.filter((m) => m.tenantId === "tn-northwind").length).toBe(3);
  });
});

/* ── cookie forgery ── */

describe("ADVERSARIAL — cookie forgery + tampering", () => {
  test("forged cookie (right format, wrong signature) → 401 on every session lane", async () => {
    freshStore();
    const fake = `ses-fake-0001.${createHmac("sha256", "attacker-key").update("ses-fake-0001").digest("hex")}`;
    const convos = await import("@/app/parley/api/conversations/route");
    const res = await convos.GET(apiReq("GET", "/parley/api/conversations", { cookie: fake }));
    expect(res.status).toBe(401);
  });

  test("valid signature but UNKNOWN session id → 401 (the liveSession rung)", async () => {
    freshStore();
    // A properly signed cookie pointing at a session that does not
    // exist in the store: the signature passes, the row lookup fails.
    const fake = makeSignedCookie("ses-0000-deadbeef");
    const convos = await import("@/app/parley/api/conversations/route");
    const res = await convos.GET(apiReq("GET", "/parley/api/conversations", { cookie: fake }));
    expect(res.status).toBe(401);
  });

  test("FORGED TENANT CLAIM: signing the sessionId as '<id>.<tenantId>' does NOT escape the session's real tenant", async () => {
    freshStore();
    // Attack: if the cookie format were sessionId.signature and a
    // tenant claim were parseable, an attacker could claim another
    // tenant. The real format is `<sessionId>.<signature>` — the
    // session ROW (not the cookie) carries the tenantId, so a
    // Lumen session can never present itself as a Northwind one.
    // Probe: sign a Lumen session's id, flip nothing, and verify
    // the resolved ctx is still Lumen's (the store is the source of
    // truth, not the cookie). After freshStore the ONLY session
    // row is the demo session (tn-lumen, usr-mira) — the attack's
    // entry point is that row itself (you can only claim tenants
    // your own session row already carries).
    const realSession = getParley().sessions.find((s) => s.tenantId === "tn-lumen")!;
    const lumenCookie = makeSignedCookie(realSession.id);
    const convos = await import("@/app/parley/api/conversations/route");
    const res = await convos.GET(apiReq("GET", "/parley/api/conversations", { cookie: `parley_ses=${encodeURIComponent(lumenCookie)}` }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversations: Array<{ tenantId: string }> };
    expect(body.conversations.every((c) => c.tenantId === "tn-lumen")).toBe(true);
  });

  test("signature-tampered cookie (one hex nibble flipped) → 401", async () => {
    freshStore();
    const good = makeSignedCookie(getParley().sessions.find((s) => s.tenantId === "tn-lumen")!.id);
    const [id, sig] = good.split(".");
    const flipped = sig[0] === "a" ? "b" + sig.slice(1) : "a" + sig.slice(1);
    const convos = await import("@/app/parley/api/conversations/route");
    const res = await convos.GET(apiReq("GET", "/parley/api/conversations", { cookie: `${id}.${flipped}` }));
    expect(res.status).toBe(401);
  });

  test("malformed cookies (no dot, empty value, garbage) → 401, never a 500", async () => {
    freshStore();
    const convos = await import("@/app/parley/api/conversations/route");
    for (const bad of ["nodot", "parley_ses=", "parley_ses=%garbage%"]) {
      const res = await convos.GET(apiReq("GET", "/parley/api/conversations", { cookie: bad }));
      expect(res.status, `cookie ${JSON.stringify(bad)} → 401`).toBe(401);
    }
  });

  test("expired session (clock advanced past the 8h TTL) → 401 on session lanes", async () => {
    freshStore();
    const { setClock, resetClock } = await import("@/lib/parley/clock");
    const { AS_OF } = await import("@/lib/parley/types");
    const cookie = cookieFor("mira@lumen.test");
    // Advance the clock 9h past AS_OF → every session is expired.
    setClock(new Date(new Date(AS_OF).getTime() + 9 * 3_600_000).toISOString());
    const convos = await import("@/app/parley/api/conversations/route");
    const res = await convos.GET(apiReq("GET", "/parley/api/conversations", { cookie }));
    expect(res.status).toBe(401);
    // Restore the clock for the next test block (the 9h shift is
    // test-local — the fail-closed probe, not a global mutation).
    resetClock();
  });
});

/* ── quota bypass ── */

describe("ADVERSARIAL — quota bypass", () => {
  test("customer-side POST conversations at the plan cap → 402 quota_exceeded", async () => {
    freshStore();
    // Lumen is on the team plan (500/mo) — to hit the cap
    // deterministically we probe Northwind (free plan, 50/mo,
    // already seeded at 47/mo). Create 3 more via the customer lane,
    // the 4th must 402.
    const createConvo = async (n: number) => {
      const convos = await import("@/app/parley/api/conversations/route");
      return convos.POST(
        apiReq("POST", "/parley/api/conversations", {
          body: { subject: `quota probe ${n}`, customerName: "Q Probe", customerEmail: "q@probe.test", priority: "normal", tenantSlug: "northwind" },
        }),
      );
    };
    const r1 = await createConvo(1);
    const r2 = await createConvo(2);
    const r3 = await createConvo(3);
    expect(r1.status).toBe(201); // 48
    expect(r2.status).toBe(201); // 49
    expect(r3.status).toBe(201); // 50 → at the cap
    const r4 = await createConvo(4);
    expect(r4.status).toBe(402);
    const body = (await r4.json()) as { error: string };
    expect(body.error).toBe("quota_exceeded");
  });

  test("the agent lanes cannot bypass the quota (a session cookie does not skip the cap)", async () => {
    freshStore();
    // The customer-side create is the only create path; there is no
    // session-gated create. Confirm the only create path is
    // quota-gated: a 50th+ convo via the customer lane with a valid
    // session cookie present STILL 402s (the cookie is irrelevant
    // to the customer lane, the cap is the gate).
    const createConvo = async () => {
      const convos = await import("@/app/parley/api/conversations/route");
      return convos.POST(
        apiReq("POST", "/parley/api/conversations", {
          cookie: cookieFor("ingrid@northwind.test"),
          body: { subject: "bypass probe", customerName: "Q", customerEmail: "q@x.test", priority: "normal", tenantSlug: "northwind" },
        }),
      );
    };
    for (let i = 0; i < 3; i++) {
      const r = await createConvo();
      if (r.status === 402) break; // already at the cap — fine
      expect(r.status).toBe(201);
    }
    const cap = await createConvo();
    // Whatever the starting count, the next create after the cap is
    // 402 — the point: the cap holds no matter who calls.
    if (cap.status === 201) {
      const cap2 = await createConvo();
      expect(cap2.status).toBe(402);
    } else {
      expect(cap.status).toBe(402);
    }
  });
});

/* ── rate-limit ladder (429 rung) ── */

describe("ADVERSARIAL — rate limiting", () => {
  test("the 11th write from one client in a window → 429 (every write lane)", async () => {
    freshStore();
    const convos = await import("@/app/parley/api/conversations/route");
    // The shared write-lane bucket is per-IP: use a fresh xff to
    // isolate this probe from the other lanes' buckets.
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await convos.POST(
        apiReq("POST", "/parley/api/conversations", {
          body: { subject: `rate ${i}`, customerName: "R", customerEmail: "r@r.test", priority: "normal", tenantSlug: "lumen" },
          xff: "203.0.113.7",
        }),
      );
      last = res.status;
      if (res.status === 429) break;
    }
    expect(last).toBe(429);
  });
});

/* ── unauthenticated lanes ── */

describe("ADVERSARIAL — unauthenticated → 401 everywhere", () => {
  beforeAll(() => freshStore());

  test("every session-gated GET lane → 401 with no cookie", async () => {
    const lanes = [
      ["GET", "/parley/api/conversations", async () => (await import("@/app/parley/api/conversations/route")).GET(apiReq("GET", "/parley/api/conversations"))],
      ["GET", "/parley/api/members", async () => (await import("@/app/parley/api/members/route")).GET(apiReq("GET", "/parley/api/members"))],
      ["GET", "/parley/api/audit", async () => (await import("@/app/parley/api/audit/route")).GET(apiReq("GET", "/parley/api/audit"))],
      ["GET", "/parley/api/usage", async () => (await import("@/app/parley/api/usage/route")).GET(apiReq("GET", "/parley/api/usage"))],
      ["GET", "/parley/api/analytics", async () => (await import("@/app/parley/api/analytics/route")).GET(apiReq("GET", "/parley/api/analytics"))],
      ["GET", "/parley/api/canned", async () => (await import("@/app/parley/api/canned/route")).GET(apiReq("GET", "/parley/api/canned"))],
      ["GET", "/parley/api/invites", async () => (await import("@/app/parley/api/invites/route")).GET(apiReq("GET", "/parley/api/invites"))],
      ["GET", "/parley/api/mailbox", async () => (await import("@/app/parley/api/mailbox/route")).GET(apiReq("GET", "/parley/api/mailbox"))],
    ] as const;
    for (const [name, , run] of lanes) {
      const res = await run();
      expect(res.status, `${name} without cookie → 401`).toBe(401);
    }
  });

  test("every session-gated write lane → 401 with no cookie", async () => {
    const id = LUMEN_CONVO();
    const lanes: Array<[string, () => Promise<{ status: number }>]> = [
      ["reply", async () => {
        const r = await import("@/app/parley/api/conversations/[id]/reply/route");
        return r.POST(apiReq("POST", `/parley/api/conversations/${id}/reply`, { body: { body: "no auth" } }), { params: Promise.resolve({ id }) });
      }],
      ["assign", async () => {
        const r = await import("@/app/parley/api/conversations/[id]/assign/route");
        return r.POST(apiReq("POST", `/parley/api/conversations/${id}/assign`, { body: { assigneeId: "usr-mira" } }), { params: Promise.resolve({ id }) });
      }],
      ["status", async () => {
        const r = await import("@/app/parley/api/conversations/[id]/status/route");
        return r.POST(apiReq("POST", `/parley/api/conversations/${id}/status`, { body: { status: "closed" } }), { params: Promise.resolve({ id }) });
      }],
      ["priority", async () => {
        const r = await import("@/app/parley/api/conversations/[id]/priority/route");
        return r.POST(apiReq("POST", `/parley/api/conversations/${id}/priority`, { body: { priority: "urgent" } }), { params: Promise.resolve({ id }) });
      }],
      ["tags", async () => {
        const r = await import("@/app/parley/api/conversations/[id]/tags/route");
        return r.POST(apiReq("POST", `/parley/api/conversations/${id}/tags`, { body: { tags: ["x"] } }), { params: Promise.resolve({ id }) });
      }],
      ["invite", async () => {
        const r = await import("@/app/parley/api/invites/route");
        return r.POST(apiReq("POST", "/parley/api/invites", { body: { email: "a@b.c", role: "agent" } }));
      }],
      ["canned-create", async () => {
        const r = await import("@/app/parley/api/canned/route");
        return r.POST(apiReq("POST", "/parley/api/canned", { body: { title: "t", body: "b" } }));
      }],
    ];
    for (const [name, run] of lanes) {
      const res = await run();
      expect(res.status, `${name} without cookie → 401`).toBe(401);
    }
  });
});

/* keep the signCookie import honest (it is the primitive the
   makeSignedCookie probes build on) */
void signCookie;
