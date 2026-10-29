/**
 * Tests for the Nocturne escalation engine (plan §4.3 + §5.1
 * `escalation.test.ts` — the ~20-test lane).
 *
 * Pins:
 *  - the tick fires after the tier's `waitMinutes` silence window
 *    (clock-injected, deterministic);
 *  - an ACKNOWLEDGED incident NEVER escalates (the PBT invariant
 *    "escalation only while unacked");
 *  - a SNOOZED incident NEVER escalates;
 *  - a RESOLVED incident is a no-op (the terminal is final,
 *    `activeTierIndex` is null);
 *  - the LAST tier never advances;
 *  - no policy / empty tiers → no-op;
 *  - the timeline `escalated` event is appended with
 *    `meta.tier = newTierIndex`;
 *  - `resolveManager` tie-break (first owner, else first admin,
 *    by createdAt ascending, then id ascending).
 */

import { describe, expect, test } from "bun:test";
import { resolveManager, resolvePageTarget, tickEscalation } from "./escalation";
import { whoIsOnCall } from "./rotation";
import type {
  NocturneIncident,
  NocturneService,
  NocturneState,
  NocturneUser,
} from "./types";

/* ── helpers ─────────────────────────────────────────────────────── */

function ctxWithNow(now: string, seqStart: number = 1) {
  let seq = seqStart;
  return { now: () => now, nextId: (p: string) => `nc_${p}_${seq++}` };
}

const TENANT = "tn-lumen";
const SERVICE = "svc-payments";
const TRIGGER = "2026-10-28T11:00:00Z";

function baseState(): NocturneState {
  return {
    version: 1,
    tenants: [],
    users: [],
    memberships: [],
    services: [],
    rotations: [],
    overrides: [],
    alerts: [],
    incidents: [],
    timeline: [],
    notes: [],
    runbooks: [],
    checklists: [],
    components: [],
    postmortems: [],
    invites: [],
    audit: [],
    sessions: [],
    seq: 1,
  };
}

function incidentRow(status: NocturneIncident["status"], over: Partial<NocturneIncident> = {}): NocturneIncident {
  return {
    id: "inc-1",
    tenantId: TENANT,
    serviceId: SERVICE,
    title: "Test",
    severity: "sev1",
    status,
    triggeredAt: TRIGGER,
    acknowledgedAt: null,
    acknowledgedBy: null,
    snoozedUntil: null,
    resolvedAt: null,
    resolvedBy: null,
    postmortemId: null,
    activeTierIndex: 0,
    lastEscalatedAt: null,
    createdAt: TRIGGER,
    ...over,
  };
}

function serviceWithTiers(tiers: NocturneService["escalationPolicy"]["tiers"]): NocturneState {
  const s = baseState();
  s.incidents = [incidentRow("triggered")];
  s.services = [
    {
      id: SERVICE,
      tenantId: TENANT,
      name: "Payments",
      description: "",
      rotationId: null,
      escalationPolicy: { tiers },
      slaOverride: null,
      createdAt: "2026-01-01T00:00:00Z",
    },
  ];
  return s;
}

/* ── the tick ────────────────────────────────────────────────────── */

describe("tickEscalation — the silence-window tick", () => {
  test("a tick fires when the silence window has elapsed", () => {
    const tiers = [
      { id: "e1", kind: "user" as const, waitMinutes: 10, toTierIndex: 1 as const },
      { id: "e2", kind: "manager" as const, waitMinutes: 20, toTierIndex: null },
    ];
    const s0 = serviceWithTiers(tiers);
    // 11 minutes after trigger > 10 min wait → tier 0 → 1.
    const r = tickEscalation(s0, "inc-1", ctxWithNow("2026-10-28T11:11:00Z", 10));
    expect(r.result.fired).toBe(true);
    expect(r.result.incident.activeTierIndex).toBe(1);
    expect(r.result.incident.lastEscalatedAt).toBe("2026-10-28T11:11:00Z");
  });

  test("no tick when the silence window has NOT elapsed", () => {
    const tiers = [
      { id: "e1", kind: "user" as const, waitMinutes: 10, toTierIndex: 1 as const },
      { id: "e2", kind: "manager" as const, waitMinutes: 20, toTierIndex: null },
    ];
    const s0 = serviceWithTiers(tiers);
    // 9 minutes after trigger < 10 min wait → no tick.
    const r = tickEscalation(s0, "inc-1", ctxWithNow("2026-10-28T11:09:00Z", 10));
    expect(r.result.fired).toBe(false);
    expect(r.result.incident.activeTierIndex).toBe(0);
    // State unchanged (same reference).
    expect(r.state).toBe(s0);
  });

  test("the boundary: exactly waitMinutes elapsed → tick fires (>=)", () => {
    const tiers = [
      { id: "e1", kind: "user" as const, waitMinutes: 10, toTierIndex: 1 as const },
      { id: "e2", kind: "manager" as const, waitMinutes: 20, toTierIndex: null },
    ];
    const s0 = serviceWithTiers(tiers);
    const r = tickEscalation(s0, "inc-1", ctxWithNow("2026-10-28T11:10:00Z", 10));
    expect(r.result.fired).toBe(true);
  });

  test("after a tick, the NEXT tick waits from lastEscalatedAt (not triggeredAt)", () => {
    const tiers = [
      { id: "e1", kind: "user" as const, waitMinutes: 10, toTierIndex: 1 as const },
      { id: "e2", kind: "user" as const, waitMinutes: 10, toTierIndex: 2 as const },
      { id: "e3", kind: "user" as const, waitMinutes: 20, toTierIndex: 3 as const },
      { id: "e4", kind: "manager" as const, waitMinutes: 20, toTierIndex: null },
    ];
    // Build a clean incident (triggeredAt 11:00, tier 0, no prior
    // escalation) so the tick sequence is deterministic.
    const s1 = serviceWithTiers(tiers);
    s1.incidents = [
      {
        id: "inc-1",
        tenantId: TENANT,
        serviceId: SERVICE,
        title: "Test",
        severity: "sev1",
        status: "triggered",
        triggeredAt: "2026-10-28T11:00:00Z",
        acknowledgedAt: null,
        acknowledgedBy: null,
        snoozedUntil: null,
        resolvedAt: null,
        resolvedBy: null,
        postmortemId: null,
        activeTierIndex: 0,
        lastEscalatedAt: null,
        createdAt: "2026-10-28T11:00:00Z",
      },
    ];
    // Tick 1 at 11:11 (10 min silence → tier 0 → 1).
    const r1 = tickEscalation(s1, "inc-1", ctxWithNow("2026-10-28T11:11:00Z", 10));
    expect(r1.result.fired).toBe(true);
    expect(r1.result.incident.activeTierIndex).toBe(1);

    // Tick 2: tier 1's wait is 10 min → next tick at 11:21 or later.
    const r2 = tickEscalation(r1.state, "inc-1", ctxWithNow("2026-10-28T11:20:59Z", 11));
    expect(r2.result.fired).toBe(false);
    const r3 = tickEscalation(r2.state, "inc-1", ctxWithNow("2026-10-28T11:21:00Z", 12));
    expect(r3.result.fired).toBe(true);
    expect(r3.result.incident.activeTierIndex).toBe(2);

    // Tick 3: tier 2's wait is 20 min → next tick at 11:41 or later.
    const r4 = tickEscalation(r3.state, "inc-1", ctxWithNow("2026-10-28T11:40:59Z", 13));
    expect(r4.result.fired).toBe(false);
    const r5 = tickEscalation(r4.state, "inc-1", ctxWithNow("2026-10-28T11:41:00Z", 14));
    expect(r5.result.fired).toBe(true);
    expect(r5.result.incident.activeTierIndex).toBe(3);

    // At the LAST tier (index 3): no further advance (the guard).
    const r6 = tickEscalation(r5.state, "inc-1", ctxWithNow("2026-10-28T12:00:00Z", 15));
    expect(r6.result.fired).toBe(false);
    expect(r6.result.incident.activeTierIndex).toBe(3);
  });

  test("the LAST tier never advances (the off-by-one guard)", () => {
    const tiers = [
      { id: "e1", kind: "user" as const, waitMinutes: 5, toTierIndex: 1 as const },
      { id: "e2", kind: "user" as const, waitMinutes: 5, toTierIndex: 2 as const },
      { id: "e3", kind: "manager" as const, waitMinutes: 10, toTierIndex: null },
    ];
    const s0 = serviceWithTiers(tiers);
    // Force the incident to the last tier.
    s0.incidents = [
      incidentRow("triggered", { activeTierIndex: 2, lastEscalatedAt: "2026-10-28T11:00:00Z" }),
    ];
    const r = tickEscalation(s0, "inc-1", ctxWithNow("2026-10-28T12:00:00Z", 10));
    expect(r.result.fired).toBe(false);
    expect(r.result.incident.activeTierIndex).toBe(2);
    expect(r.state).toBe(s0);
  });
});

/* ── the "escalation only while unacked" invariant ───────────────── */

describe("escalation only fires while unacked (PBT §5.4/2)", () => {
  test("an ACKNOWLEDGED incident never escalates", () => {
    const tiers = [
      { id: "e1", kind: "user" as const, waitMinutes: 5, toTierIndex: 1 as const },
      { id: "e2", kind: "manager" as const, waitMinutes: 10, toTierIndex: null },
    ];
    const s0 = serviceWithTiers(tiers);
    s0.incidents = [
      incidentRow("acknowledged", {
        acknowledgedAt: "2026-10-28T11:01:00Z",
        acknowledgedBy: "u-1",
        activeTierIndex: null,
      }),
    ];
    // An hour later — way past any wait window, but the incident is
    // acked → no tick.
    const r = tickEscalation(s0, "inc-1", ctxWithNow("2026-10-28T12:00:00Z", 10));
    expect(r.result.fired).toBe(false);
    expect(r.state).toBe(s0);
  });

  test("a SNOOZED incident never escalates", () => {
    const tiers = [
      { id: "e1", kind: "user" as const, waitMinutes: 5, toTierIndex: 1 as const },
      { id: "e2", kind: "manager" as const, waitMinutes: 10, toTierIndex: null },
    ];
    const s0 = serviceWithTiers(tiers);
    s0.incidents = [
      incidentRow("snoozed", {
        acknowledgedAt: "2026-10-28T11:01:00Z",
        acknowledgedBy: "u-1",
        snoozedUntil: "2026-10-28T13:00:00Z",
      }),
    ];
    const r = tickEscalation(s0, "inc-1", ctxWithNow("2026-10-28T12:00:00Z", 10));
    expect(r.result.fired).toBe(false);
  });

  test("a RESOLVED incident is a no-op (the terminal is final)", () => {
    const tiers = [
      { id: "e1", kind: "user" as const, waitMinutes: 5, toTierIndex: 1 as const },
      { id: "e2", kind: "manager" as const, waitMinutes: 10, toTierIndex: null },
    ];
    const s0 = serviceWithTiers(tiers);
    s0.incidents = [
      incidentRow("resolved", {
        acknowledgedAt: "2026-10-28T11:01:00Z",
        acknowledgedBy: "u-1",
        resolvedAt: "2026-10-28T11:30:00Z",
        resolvedBy: "u-1",
        activeTierIndex: null,
      }),
    ];
    const r = tickEscalation(s0, "inc-1", ctxWithNow("2026-10-28T12:00:00Z", 10));
    expect(r.result.fired).toBe(false);
  });
});

/* ── no policy / empty tiers ─────────────────────────────────────── */

describe("no-policy cases", () => {
  test("no escalation policy → no-op", () => {
    const s0 = baseState();
    s0.incidents = [incidentRow("triggered")];
    s0.services = [
      {
        id: SERVICE,
        tenantId: TENANT,
        name: "No policy",
        description: "",
        rotationId: null,
        escalationPolicy: { tiers: [] },
        slaOverride: null,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    const r = tickEscalation(s0, "inc-1", ctxWithNow("2026-10-28T12:00:00Z", 10));
    expect(r.result.fired).toBe(false);
  });

  test("an unknown service → no-op", () => {
    const s0 = baseState();
    s0.incidents = [incidentRow("triggered", { serviceId: "svc-ghost" })];
    const r = tickEscalation(s0, "inc-1", ctxWithNow("2026-10-28T12:00:00Z", 10));
    expect(r.result.fired).toBe(false);
  });
});

/* ── timeline event ──────────────────────────────────────────────── */

describe("the escalated timeline event", () => {
  test("a fired tick appends an `escalated` event with meta.tier = new index", () => {
    const tiers = [
      { id: "e1", kind: "user" as const, waitMinutes: 5, toTierIndex: 1 as const },
      { id: "e2", kind: "manager" as const, waitMinutes: 10, toTierIndex: null },
    ];
    const s0 = serviceWithTiers(tiers);
    const r = tickEscalation(s0, "inc-1", ctxWithNow("2026-10-28T11:06:00Z", 10));
    expect(r.result.fired).toBe(true);
    const evt = r.state.timeline[r.state.timeline.length - 1]!;
    expect(evt.kind).toBe("escalated");
    expect(evt.incidentId).toBe("inc-1");
    expect(evt.actorId).toBeNull(); // system event
    expect(evt.meta).toEqual({ tier: 1 });
    expect(evt.at).toBe("2026-10-28T11:06:00Z");
  });

  test("the incident row in the new state has the advanced tier", () => {
    const tiers = [
      { id: "e1", kind: "user" as const, waitMinutes: 5, toTierIndex: 1 as const },
      { id: "e2", kind: "manager" as const, waitMinutes: 10, toTierIndex: null },
    ];
    const s0 = serviceWithTiers(tiers);
    const r = tickEscalation(s0, "inc-1", ctxWithNow("2026-10-28T11:06:00Z", 10));
    expect(r.state.incidents[0]!.activeTierIndex).toBe(1);
    // The prior snapshot keeps its old value (copy-on-write).
    expect(s0.incidents[0]!.activeTierIndex).toBe(0);
  });
});

/* ── a full 4-tier ladder (the risk-list off-by-one pin) ────────── */

describe("the 4-tier ladder (risk #5: 4 ticks, the last one stops)", () => {
  test("a 4-tier policy fires 3 advances then stops at the last tier", () => {
    const tiers = [
      { id: "e1", kind: "user" as const, waitMinutes: 5, toTierIndex: 1 as const },
      { id: "e2", kind: "user" as const, waitMinutes: 5, toTierIndex: 2 as const },
      { id: "e3", kind: "user" as const, waitMinutes: 5, toTierIndex: 3 as const },
      { id: "e4", kind: "manager" as const, waitMinutes: 5, toTierIndex: null },
    ];
    let s = serviceWithTiers(tiers);
    let r = tickEscalation(s, "inc-1", ctxWithNow("2026-10-28T11:05:00Z", 10));
    expect(r.result.fired).toBe(true);
    s = r.state;
    r = tickEscalation(s, "inc-1", ctxWithNow("2026-10-28T11:10:00Z", 11));
    expect(r.result.fired).toBe(true);
    s = r.state;
    r = tickEscalation(s, "inc-1", ctxWithNow("2026-10-28T11:15:00Z", 12));
    expect(r.result.fired).toBe(true);
    // Now at the last tier (index 3): no further advance.
    s = r.state;
    r = tickEscalation(s, "inc-1", ctxWithNow("2026-10-28T12:00:00Z", 13));
    expect(r.result.fired).toBe(false);
    expect(r.result.incident.activeTierIndex).toBe(3);
  });
});

/* ── resolvePageTarget ───────────────────────────────────────────── */

describe("resolvePageTarget — the tier-kind resolution", () => {
  test("a rotation tier resolves via whoIsOnCall (overrides applied)", () => {
    const s = baseState();
    const seat = {
      seatIndex: 0,
      userId: "u-theo",
      start: "2026-10-25T00:00:00Z",
    };
    const rotation = {
      id: "rot-1",
      tenantId: TENANT,
      name: "Weekly",
      seats: [seat],
      shiftLengthMs: 7 * 86_400_000,
      boundaryDow: 0,
      createdAt: "2026-01-01T00:00:00Z",
    };
    s.rotations = [rotation];
    const service: NocturneService = {
      id: SERVICE,
      tenantId: TENANT,
      name: "Payments",
      description: "",
      rotationId: "rot-1",
      escalationPolicy: { tiers: [] },
      slaOverride: null,
      createdAt: "2026-01-01T00:00:00Z",
    };
    const tier = { id: "e1", kind: "rotation" as const, waitMinutes: 5, toTierIndex: null };
    // 2026-10-28 is inside the single seat's window → u-theo.
    expect(resolvePageTarget(tier, service, s, "2026-10-28T12:00:00Z")).toBe("u-theo");
  });

  test("a user tier resolves the fixed user id", () => {
    const s = baseState();
    const service: NocturneService = {
      id: SERVICE,
      tenantId: TENANT,
      name: "Payments",
      description: "",
      rotationId: null,
      escalationPolicy: { tiers: [] },
      slaOverride: null,
      createdAt: "2026-01-01T00:00:00Z",
    };
    // The tier object carries the fixed user as a dynamic key.
    const tier = {
      id: "e1",
      kind: "user" as const,
      waitMinutes: 5,
      toTierIndex: null,
      userId: "u-ada",
    } as NocturneService["escalationPolicy"]["tiers"][number] & { userId: string };
    expect(resolvePageTarget(tier, service, s, "2026-10-28T12:00:00Z")).toBe("u-ada");
  });

  test("a rotation tier with no rotation set resolves to null", () => {
    const s = baseState();
    const service: NocturneService = {
      id: SERVICE,
      tenantId: TENANT,
      name: "Payments",
      description: "",
      rotationId: null,
      escalationPolicy: { tiers: [] },
      slaOverride: null,
      createdAt: "2026-01-01T00:00:00Z",
    };
    const tier = { id: "e1", kind: "rotation" as const, waitMinutes: 5, toTierIndex: null };
    expect(resolvePageTarget(tier, service, s, "2026-10-28T12:00:00Z")).toBe(null);
  });
});

/* ── resolveManager tie-break ────────────────────────────────────── */

describe("resolveManager — the deterministic tie-break", () => {
  function stateWithUsers(users: Array<Pick<NocturneUser, "id" | "createdAt">>, roles: string[]): NocturneState {
    const s = baseState();
    s.users = users.map((u) => ({
      id: u.id,
      email: `${u.id}@x.test`,
      name: u.id,
      passwordHash: "",
      salt: "s",
      createdAt: u.createdAt,
      timezone: "UTC",
    }));
    s.memberships = users.map((u, i) => ({
      id: `mem-${i}`,
      tenantId: TENANT,
      userId: u.id,
      role: roles[i] as NocturneState["memberships"][number]["role"],
    }));
    return s;
  }

  test("the first owner (by createdAt) wins", () => {
    const s = stateWithUsers(
      [
        { id: "u-b", createdAt: "2026-01-02T00:00:00Z" },
        { id: "u-a", createdAt: "2026-01-01T00:00:00Z" },
      ],
      ["owner", "owner"],
    );
    expect(resolveManager(s, TENANT)).toBe("u-a");
  });

  test("the id breaks a createdAt tie", () => {
    const s = stateWithUsers(
      [
        { id: "u-b", createdAt: "2026-01-01T00:00:00Z" },
        { id: "u-a", createdAt: "2026-01-01T00:00:00Z" },
      ],
      ["owner", "owner"],
    );
    expect(resolveManager(s, TENANT)).toBe("u-a");
  });

  test("no owner → the first admin", () => {
    const s = stateWithUsers(
      [
        { id: "u-admin", createdAt: "2026-01-01T00:00:00Z" },
        { id: "u-resp", createdAt: "2026-01-01T00:00:00Z" },
      ],
      ["admin", "responder"],
    );
    expect(resolveManager(s, TENANT)).toBe("u-admin");
  });

  test("no owner AND no admin → null", () => {
    const s = stateWithUsers([{ id: "u-resp", createdAt: "2026-01-01T00:00:00Z" }], ["responder"]);
    expect(resolveManager(s, TENANT)).toBe(null);
  });

  test("members of ANOTHER tenant never count", () => {
    const s = stateWithUsers([{ id: "u-other", createdAt: "2026-01-01T00:00:00Z" }], ["owner"]);
    // u-other belongs to TENANT — but we ask for a different one.
    s.memberships = [{ id: "mem-1", tenantId: "tn-other", userId: "u-other", role: "owner" }];
    expect(resolveManager(s, TENANT)).toBe(null);
  });
});

/* ── unknown incident ────────────────────────────────────────────── */

describe("unknown incident", () => {
  test("tickEscalation on an unknown incident id is a no-op", () => {
    const s0 = baseState();
    const r = tickEscalation(s0, "inc-ghost", ctxWithNow("2026-10-28T12:00:00Z", 10));
    expect(r.result.fired).toBe(false);
    expect(r.state).toBe(s0);
  });
});
