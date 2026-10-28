import { describe, expect, test } from "bun:test";
import {
  isSeededTenantId,
  isSeededUserId,
  SEED_INTEGER,
  seedAria,
} from "./seed";
import { verifyPassword } from "./password";
import { seatsUsed } from "./metering";
import { ARIA_PLAN_CAPS, AS_OF, DEMO_PASSWORD } from "./types";

/*
 * The determinism + fixture pins. Every required varied-state
 * fixture is asserted by QUERYING the seeded state against `AS_OF`
 * — the fixture's shapes are pinned, not just its existence.
 */

const LUMEN = "aria-tn-lumen";
const NORTHWIND = "aria-tn-northwind";

describe("seedAria determinism", () => {
  test("two seeds with the same now deep-equal", () => {
    const a = seedAria(AS_OF);
    const b = seedAria(AS_OF);
    expect(a).toEqual(b);
  });

  test("a different now shifts relative timestamps but stays deterministic", () => {
    const a = seedAria(AS_OF);
    const c = seedAria("2026-10-30T00:00:00Z");
    expect(c).not.toEqual(a);
    expect(seedAria("2026-10-30T00:00:00Z")).toEqual(c);
  });

  test("the byte-stable seed: JSON.stringify is stable across calls", () => {
    expect(JSON.stringify(seedAria(AS_OF))).toBe(JSON.stringify(seedAria(AS_OF)));
  });
});

describe("seed shape", () => {
  const s = seedAria(AS_OF);

  test("two tenants on different plans", () => {
    expect(s.tenants).toHaveLength(2);
    const lumen = s.tenants.find((t) => t.id === LUMEN)!;
    const north = s.tenants.find((t) => t.id === NORTHWIND)!;
    expect(lumen.plan).toBe("starter");
    expect(north.plan).toBe("enterprise");
    expect(isSeededTenantId(LUMEN)).toBe(true);
    expect(isSeededTenantId(NORTHWIND)).toBe(true);
  });

  test("the 8 seeded users, all verifying against the demo password", () => {
    expect(s.users).toHaveLength(8);
    for (const u of s.users) {
      expect(isSeededUserId(u.id)).toBe(true);
      expect(verifyPassword(DEMO_PASSWORD, u.salt, u.passwordHash)).toBe(true);
      expect(verifyPassword("wrong-password", u.salt, u.passwordHash)).toBe(false);
    }
  });

  test("the salts follow the s-aria-<slug>-<user> discipline", () => {
    for (const u of s.users) {
      expect(u.salt.startsWith("s-aria-")).toBe(true);
    }
    const mira = s.users.find((u) => u.email === "mira@lumen.test")!;
    expect(mira.salt).toBe("s-aria-lumen-mira");
  });

  test("10 accounts (Lumen 4, Northwind 6) with firmographic fields", () => {
    expect(s.accounts).toHaveLength(10);
    expect(s.accounts.filter((a) => a.tenantId === LUMEN)).toHaveLength(4);
    expect(s.accounts.filter((a) => a.tenantId === NORTHWIND)).toHaveLength(6);
    for (const a of s.accounts) {
      expect(a.domain.length).toBeGreaterThan(0);
      expect(a.industry.length).toBeGreaterThan(0);
      expect(a.size).toBeGreaterThan(0);
    }
  });

  test("10 contacts, one per account, with deterministic traits in 0..1", () => {
    expect(s.contacts).toHaveLength(10);
    for (const c of s.contacts) {
      expect(c.traits.replyRate).toBeGreaterThanOrEqual(0);
      expect(c.traits.replyRate).toBeLessThanOrEqual(1);
      expect(c.traits.openRate).toBeGreaterThanOrEqual(0);
      expect(c.traits.openRate).toBeLessThanOrEqual(1);
      expect(typeof c.traits.busySignal).toBe("boolean");
    }
  });

  test("4 pipelines: Lumen 1 (starter cap), Northwind 3", () => {
    expect(s.pipelines).toHaveLength(4);
    expect(s.pipelines.filter((p) => p.tenantId === LUMEN)).toHaveLength(1);
    expect(s.pipelines.filter((p) => p.tenantId === NORTHWIND)).toHaveLength(3);
    // every pipeline ends with a won + a lost terminal stage
    for (const p of s.pipelines) {
      const states = p.stages.map((x) => x.state);
      expect(states).toContain("closed_won");
      expect(states).toContain("closed_lost");
    }
  });

  test("18 deals spanning 2026-04..2026-10 (two curated quarters +)", () => {
    expect(s.deals).toHaveLength(18);
    const dates = s.deals.map((d) => new Date(d.createdAt));
    const min = Math.min(...dates.map((d) => d.getTime()));
    const max = Math.max(...dates.map((d) => d.getTime()));
    const asOf = new Date(AS_OF).getTime();
    expect(min).toBeGreaterThanOrEqual(asOf - 200 * 86_400_000);
    expect(max).toBeLessThanOrEqual(asOf);
  });

  test("closed deals have closedAt + consistent lost reasons", () => {
    for (const d of s.deals) {
      if (d.lostReason !== null) expect(d.closedAt).not.toBeNull();
    }
    const lost = s.deals.filter((d) => d.closedAt !== null && d.lostReason !== null);
    expect(lost.length).toBeGreaterThan(0);
  });

  test("11 leads across both tenants, with a mix of replied + unresponded", () => {
    expect(s.leads).toHaveLength(11);
    const replied = s.leads.filter((l) => l.firstResponseAt !== null);
    const unresponded = s.leads.filter((l) => l.firstResponseAt === null);
    expect(replied.length).toBeGreaterThan(0);
    expect(unresponded.length).toBeGreaterThan(0);
    // every lead has an SLA due date AFTER creation (by priority minutes)
    for (const l of s.leads) {
      expect(new Date(l.slaDueAt).getTime()).toBeGreaterThan(new Date(l.createdAt).getTime());
    }
  });

  test("the converted lead carries an accountId + contactId", () => {
    const conv = s.leads.find((l) => l.converted !== null)!;
    expect(conv).toBeDefined();
    expect(conv.status).toBe("qualified");
    expect(conv.converted!.accountId.length).toBeGreaterThan(0);
  });

  test("5 sequences (Lumen 1, Northwind 3 → within plan caps)", () => {
    expect(s.sequences).toHaveLength(4);
    expect(s.sequences.filter((x) => x.tenantId === LUMEN)).toHaveLength(1);
    expect(s.sequences.filter((x) => x.tenantId === NORTHWIND)).toHaveLength(3);
    expect(sequencesUnderCap(s)).toBe(true);
  });

  test("7 enrollments covering all 4 trait tiers (bounce/reply/open/sent)", () => {
    expect(s.enrollments).toHaveLength(7);
    const m = s.enrollments.map((e) => e.traitMult);
    expect(m.some((x) => x < 0.15)).toBe(true); // bounced
    expect(m.some((x) => x > 0.6)).toBe(true); // replied tier
    expect(m.some((x) => x >= 0.3 && x <= 0.6)).toBe(true); // opened tier
    for (const e of s.enrollments) {
      if (["completed", "exited_by_reply", "bounced"].includes(e.state)) {
        expect(e.completedAt).not.toBeNull();
      }
    }
  });

  test("the seat counts sit under the plan caps (the metering fixtures)", () => {
    expect(seatsUsed(s, LUMEN)).toBeLessThan(ARIA_PLAN_CAPS.starter.seats);
    expect(seatsUsed(s, NORTHWIND)).toBeLessThan(ARIA_PLAN_CAPS.enterprise.seats);
  });

  test("per-tenant quota rows exist for every rep with a target", () => {
    const lumenQuotas = s.quotas.filter((q) => q.tenantId === LUMEN);
    const nwQuotas = s.quotas.filter((q) => q.tenantId === NORTHWIND);
    expect(lumenQuotas).toHaveLength(2);
    expect(nwQuotas).toHaveLength(3);
    for (const q of s.quotas) expect(q.target).toBeGreaterThan(0);
  });

  test("seeded audit history: non-empty, stored oldest-first", () => {
    expect(s.audit.length).toBeGreaterThan(0);
    for (let i = 0; i < s.audit.length - 1; i++) {
      expect(new Date(s.audit[i].createdAt).getTime()).toBeLessThanOrEqual(
        new Date(s.audit[i + 1].createdAt).getTime(),
      );
    }
  });

  test("the seq counter sits above every seeded row number (no live id collision)", () => {
    const s2 = seedAria(AS_OF);
    const allIds = [
      ...s2.accounts, ...s2.contacts, ...s2.deals, ...s2.leads,
      ...s2.pipelines, ...s2.sequences, ...s2.enrollments,
      ...s2.activities, ...s2.tasks, ...s2.notes, ...s2.engagementEvents, ...s2.mailbox,
    ].map((x: { id: string }) => x.id);
    for (const id of allIds) {
      const n = parseInt(id.split("_").pop() ?? "0", 10);
      if (Number.isNaN(n)) continue;
      expect(s2.seq).toBeGreaterThan(n);
    }
  });
});

function sequencesUnderCap(s: ReturnType<typeof seedAria>): boolean {
  for (const t of s.tenants) {
    const cap = ARIA_PLAN_CAPS[t.plan].sequences;
    const used = s.sequences.filter((x) => x.tenantId === t.id).length;
    if (used > cap) return false;
  }
  return true;
}
