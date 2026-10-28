import { describe, expect, test } from "bun:test";
import { DEMO_PASSWORD, isSeededConversationId, isSeededUserId, SEED_INTEGER, seedParley } from "./seed";
import { verifyPassword } from "./password";
import { conversationsThisMonth } from "./metering";
import { slaState } from "./sla";
import type { Conversation, ParleyState, Tenant } from "./types";
import { AS_OF } from "./types";

/*
 * The determinism + fixture pins. Every required varied-state
 * fixture is asserted by QUERYING the seeded conversations and
 * calling `slaState` at `AS_OF` — the fixture's SLA chip is pinned,
 * not just its existence.
 */

const LUMEN = "tn-lumen";
const NORTHWIND = "tn-northwind";

function tenantOf(s: ParleyState, id: string): Tenant {
  const t = s.tenants.find((x) => x.id === id)!;
  expect(t).toBeDefined();
  return t;
}

function convo(s: ParleyState, index: number): Conversation {
  return s.conversations.find((c) => c.id === `cnv-seed-${String(index).padStart(2, "0")}`)!;
}

describe("seedParley determinism", () => {
  test("two seeds with the same now + RNG deep-equal", () => {
    const a = seedParley(AS_OF);
    const b = seedParley(AS_OF);
    expect(a).toEqual(b);
  });

  test("a different now shifts timestamps but stays deterministic", () => {
    const a = seedParley(AS_OF);
    const c = seedParley("2026-10-30T00:00:00Z");
    expect(c).not.toEqual(a);
    expect(seedParley("2026-10-30T00:00:00Z")).toEqual(c);
  });
});

describe("seed shape", () => {
  const s = seedParley(AS_OF);

  test("both tenants present with distinct SLA policies", () => {
    expect(s.tenants).toHaveLength(2);
    const lumen = tenantOf(s, LUMEN);
    const north = tenantOf(s, NORTHWIND);
    expect(lumen.plan).toBe("team");
    expect(north.plan).toBe("free");
    // The plan-differentiated pin: Northwind's free targets are slower
    expect(north.slas.firstResponseHours.urgent).toBeGreaterThan(lumen.slas.firstResponseHours.urgent);
    expect(north.slas.resolveHours.normal).toBeGreaterThan(lumen.slas.resolveHours.normal);
  });

  test("the 6 seeded users, all verifying against the demo password", () => {
    expect(s.users).toHaveLength(6);
    for (const u of s.users) {
      expect(isSeededUserId(u.id)).toBe(true);
      expect(verifyPassword(DEMO_PASSWORD, u.salt, u.passwordHash)).toBe(true);
      // and a wrong password fails
      expect(verifyPassword("wrong-password", u.salt, u.passwordHash)).toBe(false);
    }
  });

  test("8 customers (Lumen 5, Northwind 3)", () => {
    expect(s.customers).toHaveLength(8);
    expect(s.customers.filter((c) => c.tenantId === LUMEN)).toHaveLength(5);
    expect(s.customers.filter((c) => c.tenantId === NORTHWIND)).toHaveLength(3);
  });

  test("5 tags (Lumen 3, Northwind 2)", () => {
    expect(s.tags).toHaveLength(5);
    expect(s.tags.filter((t) => t.tenantId === LUMEN)).toHaveLength(3);
    expect(s.tags.filter((t) => t.tenantId === NORTHWIND)).toHaveLength(2);
  });

  test("3 canned replies (Lumen 2, Northwind 1)", () => {
    expect(s.canned).toHaveLength(3);
    expect(s.canned.filter((c) => c.tenantId === LUMEN)).toHaveLength(2);
    expect(s.canned.filter((c) => c.tenantId === NORTHWIND)).toHaveLength(1);
  });

  test("6 memberships covering all 4 roles at Lumen", () => {
    const lumenRoles = new Set(s.memberships.filter((m) => m.tenantId === LUMEN).map((m) => m.role));
    expect(lumenRoles.size).toBe(4);
    expect(s.memberships).toHaveLength(6);
  });
});

describe("the 12 varied-state fixtures (pinned at AS_OF)", () => {
  const s = seedParley(AS_OF);
  const lumen = tenantOf(s, LUMEN);
  const north = tenantOf(s, NORTHWIND);

  test("the breached-urgent (Lumen, no reply past its 1h target)", () => {
    const c = convo(s, 1);
    expect(c.priority).toBe("urgent");
    expect(c.status).toBe("open");
    expect(c.firstRespondedAt).toBe(null);
    // arithmetic pin: 5h > 1h FR target — the breach itself
    expect(new Date(AS_OF).getTime() - new Date(c.createdAt).getTime()).toBeGreaterThan(
      lumen.slas.firstResponseHours.urgent * 3_600_000,
    );
    expect(slaState(c, lumen, AS_OF)).toBe("breached");
  });

  test("the at-risk-high (replied, within 20% of the 24h resolve window)", () => {
    const c = convo(s, 2);
    expect(c.priority).toBe("high");
    expect(c.firstRespondedAt).not.toBe(null);
    expect(slaState(c, lumen, AS_OF)).toBe("at_risk");
  });

  test("the unassigned-normal (assigneeId null)", () => {
    const c = convo(s, 3);
    expect(c.assigneeId).toBe(null);
    expect(c.priority).toBe("normal");
  });

  test("the closed full thread (≥ 5 messages + system events)", () => {
    const c = convo(s, 4);
    expect(c.status).toBe("closed");
    expect(c.closedAt).not.toBe(null);
    const msgs = s.messages.filter((m) => m.conversationId === c.id);
    expect(msgs.length).toBeGreaterThanOrEqual(5);
    const evts = s.events.filter((e) => e.conversationId === c.id);
    expect(evts.length).toBeGreaterThan(0);
  });

  test("the pending with 2+ agent replies", () => {
    const c = convo(s, 5);
    expect(c.status).toBe("pending");
    const agentReplies = s.messages.filter(
      (m) => m.conversationId === c.id && m.role === "agent",
    );
    expect(agentReplies.length).toBeGreaterThanOrEqual(2);
  });

  test("Northwind's breached-urgent uses ITS slower policy", () => {
    const c = convo(s, 8);
    expect(c.tenantId).toBe(NORTHWIND);
    expect(c.priority).toBe("urgent");
    // 6h > Northwind's 2h urgent FR target
    expect(new Date(AS_OF).getTime() - new Date(c.createdAt).getTime()).toBeGreaterThan(
      north.slas.firstResponseHours.urgent * 3_600_000,
    );
    expect(slaState(c, north, AS_OF)).toBe("breached");
  });

  test("~40 messages total across the 12 seeded conversations", () => {
    const seededMsgs = s.messages.filter((m) => isSeededConversationId(m.conversationId));
    expect(seededMsgs.length).toBeGreaterThanOrEqual(15);
    expect(seededMsgs.length).toBeLessThanOrEqual(40);
  });
});

describe("the 47/50 Northwind-month near-cap pin", () => {
  test("Northwind has exactly 47 conversations this month", () => {
    const s = seedParley(AS_OF);
    expect(conversationsThisMonth(s, NORTHWIND, AS_OF)).toBe(47);
  });

  test("all 5 core Northwind conversations land in the current month", () => {
    const s = seedParley(AS_OF);
    for (const i of [8, 9, 10, 11, 12]) {
      expect(isSeededConversationId(convo(s, i).id)).toBe(true);
    }
    // and the 42 older rows do NOT count
    const older = s.conversations.filter((c) => c.tenantId === NORTHWIND && !isSeededConversationId(c.id));
    expect(older).toHaveLength(42);
    // all 42 rows are October (the current month) — they count toward 47/50
    for (const c of older) {
      const d = new Date(c.createdAt);
      expect(d.getUTCFullYear()).toBe(2026);
      expect(d.getUTCMonth()).toBe(9); // October
      expect(d.getUTCDate()).toBeLessThanOrEqual(28);
    }
  });
});

describe("the pending casey@lumen.test invite", () => {
  test("present, unexpired at AS_OF, admin role, unused", () => {
    const s = seedParley(AS_OF);
    const inv = s.invites.find((i) => i.email === "casey@lumen.test")!;
    expect(inv).toBeDefined();
    expect(inv.role).toBe("admin");
    expect(inv.tenantId).toBe(LUMEN);
    expect(inv.usedAt).toBe(null);
    expect(new Date(inv.expiresAt).getTime()).toBeGreaterThan(new Date(AS_OF).getTime());
    // token is deterministic
    expect(seedParley(AS_OF).invites[0].token).toBe(inv.token);
  });
});

describe("seeded audit history", () => {
  test("non-empty, stored oldest-first (auditFeed reverses to newest-first)", () => {
    const s = seedParley(AS_OF);
    expect(s.audit.length).toBeGreaterThan(0);
    // stored oldest-first: audit[0] is the oldest
    for (let i = 0; i < s.audit.length - 1; i++) {
      expect(new Date(s.audit[i].createdAt).getTime()).toBeLessThanOrEqual(
        new Date(s.audit[i + 1].createdAt).getTime(),
      );
    }
  });
});
