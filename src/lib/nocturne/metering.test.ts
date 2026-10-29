import { describe, expect, test } from "bun:test";
import {
  canCreateRotation,
  canCreateRunbook,
  canCreateService,
  canInvite,
  overage,
  rotationsUsed,
  runbooksUsed,
  seatsUsed,
  servicesUsed,
} from "./metering";
import type { NocturneState } from "./types";

function tenant(id: string, plan: "starter" | "professional" | "enterprise"): NocturneState["tenants"][number] {
  const sla = {
    sev1: { ack: 5, resolve: 60 },
    sev2: { ack: 15, resolve: 240 },
    sev3: { ack: 60, resolve: 720 },
    sev4: { ack: 240, resolve: 2880 },
  };
  return {
    id,
    slug: id.replace("tn-", ""),
    name: id,
    plan,
    slaMinutes: sla,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function stateWith(
  tId: string,
  plan: "starter" | "professional" | "enterprise",
  n: { seats?: number; services?: number; rotations?: number; runbooks?: number },
): NocturneState {
  const s: NocturneState = {
    version: 1,
    tenants: [tenant(tId, plan)],
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
  for (let i = 0; i < (n.seats ?? 0); i++) {
    s.users.push({
      id: `u${i}`,
      email: `u${i}@x.test`,
      name: `U${i}`,
      passwordHash: "0".repeat(64),
      salt: `s-${tId}-u${i}`,
      createdAt: "2026-01-01T00:00:00Z",
      timezone: "UTC",
    });
    s.memberships.push({ id: `mem-${i}`, tenantId: tId, userId: `u${i}`, role: "responder" });
  }
  for (let i = 0; i < (n.services ?? 0); i++) {
    s.services.push({
      id: `svc-${i}`,
      tenantId: tId,
      name: `S${i}`,
      description: "",
      rotationId: null,
      escalationPolicy: { tiers: [] },
      slaOverride: null,
      createdAt: "2026-01-01T00:00:00Z",
    });
  }
  for (let i = 0; i < (n.rotations ?? 0); i++) {
    s.rotations.push({
      id: `rot-${i}`,
      tenantId: tId,
      name: `R${i}`,
      seats: [],
      shiftLengthMs: 604_800_000,
      boundaryDow: 0,
      createdAt: "2026-01-01T00:00:00Z",
    });
  }
  for (let i = 0; i < (n.runbooks ?? 0); i++) {
    s.runbooks.push({
      id: `rb-${i}`,
      tenantId: tId,
      serviceId: `svc-${i}`,
      name: `RB${i}`,
      steps: [],
      forSeverities: [],
      createdAt: "2026-01-01T00:00:00Z",
    });
  }
  return s;
}

describe("usage counters", () => {
  test("seatsUsed counts distinct user memberships", () => {
    const s = stateWith("tn-1", "starter", { seats: 3, services: 1, rotations: 1, runbooks: 1 });
    expect(seatsUsed(s, "tn-1")).toBe(3);
    expect(servicesUsed(s, "tn-1")).toBe(1);
    expect(rotationsUsed(s, "tn-1")).toBe(1);
    expect(runbooksUsed(s, "tn-1")).toBe(1);
  });

  test("is scoped to the tenant", () => {
    const s = stateWith("tn-1", "starter", { seats: 2 });
    s.tenants.push(tenant("tn-2", "professional"));
    expect(seatsUsed(s, "tn-2")).toBe(0);
    expect(servicesUsed(s, "tn-2")).toBe(0);
  });
});

describe("overage verdicts", () => {
  test("starter at the cap is not over", () => {
    const s = stateWith("tn-1", "starter", { seats: 4, services: 1, rotations: 1, runbooks: 4 });
    const o = overage(s, "tn-1");
    expect(o.seats).toEqual({ used: 4, cap: 5, over: false });
    expect(o.services).toEqual({ used: 1, cap: 2, over: false });
    expect(o.rotations).toEqual({ used: 1, cap: 2, over: false });
    expect(o.runbooks).toEqual({ used: 4, cap: 5, over: false });
  });

  test("past the cap is over", () => {
    const s = stateWith("tn-1", "starter", { seats: 6, services: 3 });
    const o = overage(s, "tn-1");
    expect(o.seats.over).toBe(true);
    expect(o.services.over).toBe(true);
  });

  test("professional caps", () => {
    const s = stateWith("tn-1", "professional", { seats: 25 });
    const o = overage(s, "tn-1");
    expect(o.seats.cap).toBe(25);
    expect(o.seats.over).toBe(false); // at-cap is not over
  });

  test("enterprise caps are roomy", () => {
    const s = stateWith("tn-1", "enterprise", {});
    const o = overage(s, "tn-1");
    expect(o.seats.cap).toBe(100);
    expect(o.services.cap).toBe(50);
    expect(o.rotations.cap).toBe(50);
    expect(o.runbooks.cap).toBe(100);
  });
});

describe("the 402 gates", () => {
  test("canCreateService: true below, false at the cap", () => {
    const s = stateWith("tn-1", "starter", { services: 2 });
    expect(canCreateService(s, "tn-1")).toBe(false);
    s.services.pop()!;
    expect(canCreateService(s, "tn-1")).toBe(true);
  });

  test("canCreateRotation honors the plan cap", () => {
    const s = stateWith("tn-1", "professional", { rotations: 10 });
    expect(canCreateRotation(s, "tn-1")).toBe(false);
    expect(canCreateRotation(stateWith("tn-2", "starter", { rotations: 1 }), "tn-2")).toBe(true);
  });

  test("canCreateRunbook honors the plan cap", () => {
    const s = stateWith("tn-1", "starter", { runbooks: 5 });
    expect(canCreateRunbook(s, "tn-1")).toBe(false);
    const s2 = stateWith("tn-1", "professional", { runbooks: 30 });
    expect(canCreateRunbook(s2, "tn-1")).toBe(false);
    expect(canCreateRunbook(stateWith("tn-1", "professional", { runbooks: 29 }), "tn-1")).toBe(true);
  });

  test("canInvite rejects at the seat cap (the P1 overage pin)", () => {
    expect(canInvite(stateWith("tn-1", "starter", { seats: 5 }), "tn-1")).toBe(false);
    expect(canInvite(stateWith("tn-1", "starter", { seats: 4 }), "tn-1")).toBe(true);
    // two tenants are judged independently
    expect(canInvite(stateWith("tn-1", "professional", { seats: 25 }), "tn-1")).toBe(false);
  });

  test("an unknown tenant throws (the store always knows its tenant)", () => {
    const s = stateWith("tn-1", "starter", {});
    expect(() => overage(s, "tn-x")).toThrow(/unknown tenant/);
    expect(() => canInvite(s, "tn-x")).toThrow(/unknown tenant/);
  });
});
