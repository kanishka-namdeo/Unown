/**
 * Tests for the Nocturne analytics engine (plan §3.9 + §5.1
 * `analytics.test.ts` — the ~20-test lane).
 *
 * Pins:
 *  - MTTA/MTTR over RESOLVED incidents ONLY (the PBT invariant
 *    "MTTA/MTTR over resolved only", §5.4/4);
 *  - `null` when no resolved incidents;
 *  - `incidentsBySeverity` / `incidentsByService` counts (ALL
 *    incidents, not just resolved);
 *  - the breach rate (resolved only, 0..1, `null` when no
 *    resolved);
 *  - on-call load: open incidents per paged user (triggered →
 *    current tier target; acknowledged / snoozed → the ack
 *    owner);
 *  - `openIncidentCount` (the dashboard's red KPI);
 *  - `servicesWithOnCall` (the API's computed `primaryOnCall`).
 */

import { describe, expect, test } from "bun:test";
import {
  analytics,
  openIncidentCount,
  servicesWithOnCall,
} from "./analytics";
import type {
  NocturneIncident,
  NocturneMembership,
  NocturneService,
  NocturneState,
  NocturneTenant,
  NocturneUser,
} from "./types";

/* ── helpers ─────────────────────────────────────────────────────── */

const TENANT = "tn-lumen";
const NOW = "2026-10-28T12:00:00Z";

function stateWith(opts: {
  tenant?: Partial<NocturneTenant>;
  incidents?: NocturneIncident[];
  services?: NocturneService[];
  users?: NocturneUser[];
  memberships?: NocturneMembership[];
}): NocturneState {
  const s: NocturneState = {
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
  s.tenants = [
    {
      id: TENANT,
      slug: "lumen",
      name: "Lumen",
      plan: "professional",
      slaMinutes: {
        sev1: { ack: 5, resolve: 120 },
        sev2: { ack: 15, resolve: 240 },
        sev3: { ack: 60, resolve: 720 },
        sev4: { ack: 240, resolve: 1440 },
      },
      createdAt: "2026-01-01T00:00:00Z",
      ...(opts.tenant ?? {}),
    },
  ];
  s.incidents = opts.incidents ?? [];
  s.services = opts.services ?? [];
  s.users = opts.users ?? [];
  s.memberships = opts.memberships ?? [];
  return s;
}

function user(
  id: string,
  over: { name?: string; createdAt?: string } = {},
): NocturneUser {
  return {
    id,
    email: `${id}@x.test`,
    name: over.name ?? id,
    passwordHash: "",
    salt: "s",
    createdAt: over.createdAt ?? "2026-01-01T00:00:00Z",
    timezone: "UTC",
  };
}

function membership(userId: string, role: NocturneMembership["role"], n: number): NocturneMembership {
  return { id: `mem-${n}`, tenantId: TENANT, userId, role };
}

function incidentRow(
  id: string,
  status: NocturneIncident["status"],
  over: Partial<NocturneIncident> = {},
): NocturneIncident {
  return {
    id,
    tenantId: TENANT,
    serviceId: "svc-1",
    title: "Test",
    severity: "sev1",
    status,
    triggeredAt: "2026-10-28T10:00:00Z",
    acknowledgedAt: null,
    acknowledgedBy: null,
    snoozedUntil: null,
    resolvedAt: null,
    resolvedBy: null,
    postmortemId: null,
    activeTierIndex: 0,
    lastEscalatedAt: null,
    createdAt: "2026-10-28T10:00:00Z",
    ...over,
  };
}

/* ── MTTA / MTTR ─────────────────────────────────────────────────── */

describe("mttaMs / mttrMs (resolved only)", () => {
  test("MTTA is the mean (acknowledgedAt − triggeredAt) over RESOLVED incidents", () => {
    const s = stateWith({
      incidents: [
        incidentRow("i1", "resolved", {
          triggeredAt: "2026-10-28T10:00:00Z",
          acknowledgedAt: "2026-10-28T10:02:00Z", // 2 min ack
          resolvedAt: "2026-10-28T10:30:00Z",
        }),
        incidentRow("i2", "resolved", {
          triggeredAt: "2026-10-28T10:00:00Z",
          acknowledgedAt: "2026-10-28T10:10:00Z", // 10 min ack
          resolvedAt: "2026-10-28T10:40:00Z",
        }),
      ],
    });
    const r = analytics(s, TENANT, NOW);
    // MTTA = (2 min + 10 min) / 2 = 6 min.
    expect(r.mttaMs).toBe(6 * 60_000);
  });

  test("MTTR is the mean (resolvedAt − triggeredAt) over RESOLVED incidents", () => {
    const s = stateWith({
      incidents: [
        incidentRow("i1", "resolved", {
          triggeredAt: "2026-10-28T10:00:00Z",
          acknowledgedAt: "2026-10-28T10:02:00Z",
          resolvedAt: "2026-10-28T10:30:00Z", // 30 min
        }),
        incidentRow("i2", "resolved", {
          triggeredAt: "2026-10-28T10:00:00Z",
          acknowledgedAt: "2026-10-28T10:10:00Z",
          resolvedAt: "2026-10-28T10:40:00Z", // 40 min
        }),
      ],
    });
    const r = analytics(s, TENANT, NOW);
    expect(r.mttrMs).toBe(35 * 60_000);
  });

  test("OPEN incidents never contribute to MTTA / MTTR (§5.4/4)", () => {
    const s = stateWith({
      incidents: [
        // This open incident has a fast hypothetical ack — it must
        // NOT appear in the MTTA.
        incidentRow("i-open", "triggered", {
          triggeredAt: "2026-10-28T11:59:00Z",
          acknowledgedAt: "2026-10-28T11:59:01Z",
        }),
        incidentRow("i-res", "resolved", {
          triggeredAt: "2026-10-28T10:00:00Z",
          acknowledgedAt: "2026-10-28T10:05:00Z",
          resolvedAt: "2026-10-28T10:20:00Z",
        }),
      ],
    });
    const r = analytics(s, TENANT, NOW);
    expect(r.mttaMs).toBe(5 * 60_000); // only the resolved incident
    expect(r.mttrMs).toBe(20 * 60_000);
  });

  test("no resolved incidents → null for both", () => {
    const s = stateWith({
      incidents: [incidentRow("i-open", "triggered")],
    });
    const r = analytics(s, TENANT, NOW);
    expect(r.mttaMs).toBeNull();
    expect(r.mttrMs).toBeNull();
  });

  test("an empty state → null for both", () => {
    const s = stateWith({});
    const r = analytics(s, TENANT, NOW);
    expect(r.mttaMs).toBeNull();
    expect(r.mttrMs).toBeNull();
  });
});

/* ── counts by severity / service ────────────────────────────────── */

describe("incidentsBySeverity / incidentsByService (ALL incidents)", () => {
  test("counts all incidents regardless of status", () => {
    const s = stateWith({
      incidents: [
        incidentRow("i1", "triggered", { severity: "sev1" }),
        incidentRow("i2", "resolved", { severity: "sev1", resolvedAt: "x" }),
        incidentRow("i3", "acknowledged", { severity: "sev2", acknowledgedAt: "2026-10-28T10:01:00Z", acknowledgedBy: "u-1" }),
        incidentRow("i4", "triggered", { severity: "sev3" }),
      ],
    });
    const r = analytics(s, TENANT, NOW);
    expect(r.incidentsBySeverity).toEqual({ sev1: 2, sev2: 1, sev3: 1, sev4: 0 });
  });

  test("counts per service id", () => {
    const s = stateWith({
      incidents: [
        incidentRow("i1", "triggered", { serviceId: "svc-1" }),
        incidentRow("i2", "triggered", { serviceId: "svc-1" }),
        incidentRow("i3", "triggered", { serviceId: "svc-2" }),
      ],
    });
    const r = analytics(s, TENANT, NOW);
    expect(r.incidentsByService).toEqual({ "svc-1": 2, "svc-2": 1 });
  });

  test("an empty state → zero counts", () => {
    const r = analytics(stateWith({}), TENANT, NOW);
    expect(r.incidentsBySeverity).toEqual({ sev1: 0, sev2: 0, sev3: 0, sev4: 0 });
    expect(r.incidentsByService).toEqual({});
  });

  test("other tenants' incidents are excluded (fail-closed tenancy)", () => {
    const s = stateWith({
      incidents: [
        incidentRow("i1", "triggered", { tenantId: "tn-other" }),
        incidentRow("i2", "triggered"),
      ],
    });
    const r = analytics(s, TENANT, NOW);
    expect(r.incidentsBySeverity.sev1).toBe(1);
  });
});

/* ── breach rate ─────────────────────────────────────────────────── */

describe("breachRate", () => {
  test("a resolved-within-target incident → breachRate 0", () => {
    const s = stateWith({
      incidents: [
        // Triggered 10:00, acked 10:02, resolved 10:30 → well inside
        // the sev1 targets (5 min ack, 120 min resolve).
        incidentRow("i1", "resolved", {
          triggeredAt: "2026-10-28T10:00:00Z",
          acknowledgedAt: "2026-10-28T10:02:00Z",
          resolvedAt: "2026-10-28T10:30:00Z",
        }),
      ],
    });
    const r = analytics(s, TENANT, NOW);
    expect(r.breachRate).toBe(0);
  });

  test("a resolved past the target → breachRate 1", () => {
    const s = stateWith({
      incidents: [
        // Resolved 3 hours after ack — the sev1 resolve target is
        // 120 min → breached.
        incidentRow("i1", "resolved", {
          triggeredAt: "2026-10-28T10:00:00Z",
          acknowledgedAt: "2026-10-28T10:02:00Z",
          resolvedAt: "2026-10-28T13:02:00Z",
        }),
      ],
    });
    const r = analytics(s, TENANT, NOW);
    expect(r.breachRate).toBe(1);
  });

  test("a mix → the fraction", () => {
    const s = stateWith({
      incidents: [
        incidentRow("i-met", "resolved", {
          triggeredAt: "2026-10-28T10:00:00Z",
          acknowledgedAt: "2026-10-28T10:02:00Z",
          resolvedAt: "2026-10-28T10:30:00Z",
        }),
        incidentRow("i-bad", "resolved", {
          triggeredAt: "2026-10-28T10:00:00Z",
          acknowledgedAt: "2026-10-28T10:02:00Z",
          resolvedAt: "2026-10-28T13:02:00Z",
        }),
      ],
    });
    const r = analytics(s, TENANT, NOW);
    expect(r.breachRate).toBeCloseTo(0.5);
  });

  test("no resolved incidents → null", () => {
    const s = stateWith({ incidents: [incidentRow("i-open", "triggered")] });
    const r = analytics(s, TENANT, NOW);
    expect(r.breachRate).toBeNull();
  });
});

/* ── on-call load ────────────────────────────────────────────────── */

describe("onCallLoad (open incidents per paged user)", () => {
  test("an acked incident loads the acknowledgedBy user", () => {
    const s = stateWith({
      incidents: [
        incidentRow("i1", "acknowledged", {
          acknowledgedAt: "2026-10-28T10:01:00Z",
          acknowledgedBy: "u-ada",
        }),
        incidentRow("i2", "snoozed", {
          acknowledgedAt: "2026-10-28T10:01:00Z",
          acknowledgedBy: "u-ada",
          snoozedUntil: "2026-10-28T14:00:00Z",
        }),
      ],
      users: [user("u-ada")],
      memberships: [membership("u-ada", "responder", 1)],
    });
    const r = analytics(s, TENANT, NOW);
    expect(r.onCallLoad).toEqual({ "u-ada": 2 });
  });

  test("resolved incidents never count toward the load", () => {
    const s = stateWith({
      incidents: [
        incidentRow("i1", "resolved", {
          acknowledgedAt: "2026-10-28T10:01:00Z",
          acknowledgedBy: "u-ada",
          resolvedAt: "2026-10-28T10:30:00Z",
        }),
        incidentRow("i2", "acknowledged", {
          acknowledgedAt: "2026-10-28T11:00:00Z",
          acknowledgedBy: "u-ada",
        }),
      ],
      users: [user("u-ada")],
      memberships: [membership("u-ada", "responder", 1)],
    });
    const r = analytics(s, TENANT, NOW);
    expect(r.onCallLoad).toEqual({ "u-ada": 1 });
  });

  test("unknown users (not in the tenant) are excluded", () => {
    const s = stateWith({
      incidents: [
        incidentRow("i1", "acknowledged", {
          acknowledgedAt: "2026-10-28T10:01:00Z",
          acknowledgedBy: "u-ghost",
        }),
      ],
      users: [user("u-ada")],
      memberships: [membership("u-ada", "responder", 1)],
    });
    const r = analytics(s, TENANT, NOW);
    expect(r.onCallLoad).toEqual({});
  });

  test("no open incidents → empty load", () => {
    const s = stateWith({
      incidents: [
        incidentRow("i1", "resolved", {
          acknowledgedAt: "2026-10-28T10:01:00Z",
          acknowledgedBy: "u-ada",
          resolvedAt: "2026-10-28T10:30:00Z",
        }),
      ],
      users: [user("u-ada")],
      memberships: [membership("u-ada", "responder", 1)],
    });
    const r = analytics(s, TENANT, NOW);
    expect(r.onCallLoad).toEqual({});
  });
});

/* ── openIncidentCount ───────────────────────────────────────────── */

describe("openIncidentCount (the dashboard's red KPI)", () => {
  test("counts triggered + acknowledged + snoozed", () => {
    const s = stateWith({
      incidents: [
        incidentRow("i1", "triggered"),
        incidentRow("i2", "acknowledged", {
          acknowledgedAt: "2026-10-28T10:01:00Z",
          acknowledgedBy: "u-1",
        }),
        incidentRow("i3", "snoozed", {
          acknowledgedAt: "2026-10-28T10:01:00Z",
          acknowledgedBy: "u-1",
          snoozedUntil: "2026-10-28T14:00:00Z",
        }),
        incidentRow("i4", "resolved", {
          acknowledgedAt: "2026-10-28T10:01:00Z",
          acknowledgedBy: "u-1",
          resolvedAt: "2026-10-28T10:30:00Z",
        }),
      ],
    });
    expect(openIncidentCount(s, TENANT)).toBe(3);
  });

  test("an empty state → 0", () => {
    expect(openIncidentCount(stateWith({}), TENANT)).toBe(0);
  });

  test("other tenants' incidents are excluded", () => {
    const s = stateWith({
      incidents: [
        incidentRow("i1", "triggered", { tenantId: "tn-other" }),
        incidentRow("i2", "triggered"),
      ],
    });
    expect(openIncidentCount(s, TENANT)).toBe(1);
  });
});

/* ── servicesWithOnCall ──────────────────────────────────────────── */

describe("servicesWithOnCall (the API's computed primaryOnCall)", () => {
  test("a service with no rotation → null primaryOnCall", () => {
    const s = stateWith({
      services: [
        {
          id: "svc-1",
          tenantId: TENANT,
          name: "API",
          description: "",
          rotationId: null,
          escalationPolicy: { tiers: [] },
          slaOverride: null,
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    const r = servicesWithOnCall(s, TENANT, NOW);
    expect(r).toHaveLength(1);
    expect(r[0]!.primaryOnCall).toBeNull();
  });

  test("a service with a rotation resolves the current seat's user", () => {
    const s = stateWith({
      services: [
        {
          id: "svc-1",
          tenantId: TENANT,
          name: "API",
          description: "",
          rotationId: "rot-1",
          escalationPolicy: { tiers: [] },
          slaOverride: null,
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
      users: [user("u-theo", { name: "Theo Reyes" })],
      memberships: [membership("u-theo", "responder", 1)],
    });
    s.rotations = [
      {
        id: "rot-1",
        tenantId: TENANT,
        name: "Weekly",
        seats: [{ seatIndex: 0, userId: "u-theo", start: "2026-10-25T00:00:00Z" }],
        shiftLengthMs: 7 * 86_400_000,
        boundaryDow: 0,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    const r = servicesWithOnCall(s, TENANT, NOW);
    expect(r[0]!.primaryOnCall).toEqual({ userId: "u-theo", name: "Theo Reyes" });
  });

  test("other tenants' services are excluded", () => {
    const s = stateWith({
      services: [
        {
          id: "svc-other",
          tenantId: "tn-other",
          name: "Other",
          description: "",
          rotationId: null,
          escalationPolicy: { tiers: [] },
          slaOverride: null,
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    const r = servicesWithOnCall(s, TENANT, NOW);
    expect(r).toHaveLength(0);
  });
});
