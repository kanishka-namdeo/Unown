/**
 * Tests for the Nocturne status engine (plan §3.7 + §5.1
 * `status.test.ts` — the ~10-test lane).
 *
 * Pins:
 *  - `statusForSlug` returns the public surface (components +
 *    active incidents only, no user ids / emails / schedule
 *    details — the risk list's P1 "Status page leak" mitigation);
 *  - `activeIncidents` = triggered | acknowledged | snoozed
 *    (resolved NEVER appears);
 *  - `lastUpdated` = the latest component `lastChangedAt`;
 *  - unknown slug → `null` (the route's 404);
 *  - `updateComponentStatus` copies-on-write + stamps
 *    `lastChangedAt`; the cross-tenant error is 404-shaped.
 */

import { describe, expect, test } from "bun:test";
import { statusForSlug, tenantBySlug, updateComponentStatus } from "./status";
import type {
  NocturneComponent,
  NocturneIncident,
  NocturneService,
  NocturneState,
  NocturneTenant,
} from "./types";

/* ── helpers ─────────────────────────────────────────────────────── */

function ctxWithNow(now: string) {
  return { now: () => now };
}

const LUMEN = "tn-lumen";
const NOW = "2026-10-28T12:00:00Z";

function stateWith(opts: {
  tenants?: NocturneTenant[];
  services?: NocturneService[];
  components?: NocturneComponent[];
  incidents?: NocturneIncident[];
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
  s.tenants = opts.tenants ?? [];
  s.services = opts.services ?? [];
  s.components = opts.components ?? [];
  s.incidents = opts.incidents ?? [];
  return s;
}

function lumenTenant(): NocturneTenant {
  return {
    id: LUMEN,
    slug: "lumen",
    name: "Lumen Labs",
    plan: "professional",
    slaMinutes: {
      sev1: { ack: 5, resolve: 120 },
      sev2: { ack: 15, resolve: 240 },
      sev3: { ack: 60, resolve: 720 },
      sev4: { ack: 240, resolve: 1440 },
    },
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function svc(id: string, name: string, tenantId = LUMEN): NocturneService {
  return {
    id,
    tenantId,
    name,
    description: "",
    rotationId: null,
    escalationPolicy: { tiers: [] },
    slaOverride: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function component(id: string, name: string, status: NocturneComponent["status"], over: Partial<NocturneComponent> = {}): NocturneComponent {
  return {
    id,
    tenantId: LUMEN,
    serviceId: "svc-1",
    name,
    status,
    lastChangedAt: null,
    note: null,
    ...over,
  };
}

function incident(
  id: string,
  status: NocturneIncident["status"],
  over: Partial<NocturneIncident> = {},
): NocturneIncident {
  return {
    id,
    tenantId: LUMEN,
    serviceId: "svc-1",
    title: `${id} incident`,
    severity: "sev1",
    status,
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
    ...over,
  };
}

/* ── tenantBySlug ────────────────────────────────────────────────── */

describe("tenantBySlug", () => {
  test("finds the tenant by slug", () => {
    const s = stateWith({ tenants: [lumenTenant()] });
    expect(tenantBySlug(s, "lumen")?.id).toBe(LUMEN);
  });

  test("an unknown slug → null", () => {
    const s = stateWith({ tenants: [lumenTenant()] });
    expect(tenantBySlug(s, "ghost")).toBeNull();
  });

  test("the match is exact (case-sensitive)", () => {
    const s = stateWith({ tenants: [lumenTenant()] });
    expect(tenantBySlug(s, "LUMEN")).toBeNull();
  });
});

/* ── statusForSlug: the computed surface ─────────────────────────── */

describe("statusForSlug — the public surface", () => {
  test("returns the tenant name + slug only", () => {
    const s = stateWith({
      tenants: [lumenTenant()],
      services: [svc("svc-1", "Payments")],
      components: [component("cmp-1", "API", "degraded")],
      incidents: [incident("inc-1", "triggered")],
    });
    const r = statusForSlug(s, "lumen")!;
    expect(r.tenant).toEqual({ name: "Lumen Labs", slug: "lumen" });
  });

  test("activeIncidents = triggered | acknowledged | snoozed (resolved excluded, §5.1)", () => {
    const s = stateWith({
      tenants: [lumenTenant()],
      services: [svc("svc-1", "Payments")],
      incidents: [
        incident("inc-trig", "triggered"),
        incident("inc-ack", "acknowledged", {
          acknowledgedAt: "2026-10-28T11:01:00Z",
          acknowledgedBy: "u-1",
        }),
        incident("inc-snooze", "snoozed", {
          acknowledgedAt: "2026-10-28T11:01:00Z",
          acknowledgedBy: "u-1",
          snoozedUntil: "2026-10-28T14:00:00Z",
        }),
        incident("inc-res", "resolved", {
          acknowledgedAt: "2026-10-28T11:01:00Z",
          acknowledgedBy: "u-1",
          resolvedAt: "2026-10-28T11:30:00Z",
        }),
      ],
    });
    const r = statusForSlug(s, "lumen")!;
    expect(r.activeIncidents.map((i) => i.id)).toEqual([
      "inc-trig",
      "inc-ack",
      "inc-snooze",
    ]);
    // The resolved incident NEVER leaks (the P1 leak pin).
    expect(r.activeIncidents.every((i) => i.id !== "inc-res")).toBe(true);
  });

  test("the public incident view NEVER leaks user ids or schedule detail (risk #11 P1)", () => {
    const s = stateWith({
      tenants: [lumenTenant()],
      services: [svc("svc-1", "Payments")],
      incidents: [
        incident("inc-1", "acknowledged", {
          acknowledgedAt: "2026-10-28T11:01:00Z",
          acknowledgedBy: "u-secret",
        }),
      ],
    });
    const r = statusForSlug(s, "lumen")!;
    const view = r.activeIncidents[0]!;
    // The shape has exactly these fields — no acknowledgedBy /
    // resolvedBy / serviceId (internal), only the public fields.
    expect(Object.keys(view).sort()).toEqual(
      [
        "acknowledgedAt",
        "id",
        "resolvedAt",
        "severity",
        "serviceName",
        "status",
        "title",
        "triggeredAt",
      ].sort(),
    );
    expect("acknowledgedBy" in view).toBe(false);
    expect("resolvedBy" in view).toBe(false);
  });

  test("the serviceName joins the service's public name", () => {
    const s = stateWith({
      tenants: [lumenTenant()],
      services: [svc("svc-1", "Payments API")],
      incidents: [incident("inc-1", "triggered")],
    });
    const r = statusForSlug(s, "lumen")!;
    expect(r.activeIncidents[0]!.serviceName).toBe("Payments API");
  });

  test("an unknown service degrades to \"Unknown service\" (never a crash)", () => {
    const s = stateWith({
      tenants: [lumenTenant()],
      incidents: [incident("inc-1", "triggered", { serviceId: "svc-ghost" })],
    });
    const r = statusForSlug(s, "lumen")!;
    expect(r.activeIncidents[0]!.serviceName).toBe("Unknown service");
  });

  test("other tenants' components + incidents are excluded", () => {
    const s = stateWith({
      tenants: [lumenTenant()],
      components: [
        component("cmp-1", "API", "operational", { tenantId: "tn-other", serviceId: "svc-other" }),
        component("cmp-2", "Database", "operational"),
      ],
      incidents: [
        incident("inc-1", "triggered", { tenantId: "tn-other" }),
        incident("inc-2", "triggered"),
      ],
    });
    const r = statusForSlug(s, "lumen")!;
    expect(r.components.map((c) => c.id)).toEqual(["cmp-2"]);
    expect(r.activeIncidents.map((i) => i.id)).toEqual(["inc-2"]);
  });

  test("an unknown slug → null (the route's 404)", () => {
    const s = stateWith({ tenants: [lumenTenant()] });
    expect(statusForSlug(s, "ghost")).toBeNull();
  });
});

/* ── lastUpdated ─────────────────────────────────────────────────── */

describe("lastUpdated (the page's \"last updated\" chip)", () => {
  test("the latest component lastChangedAt wins", () => {
    const s = stateWith({
      tenants: [lumenTenant()],
      components: [
        component("cmp-1", "API", "operational", { lastChangedAt: "2026-10-28T08:00:00Z" }),
        component("cmp-2", "Database", "degraded", { lastChangedAt: "2026-10-28T10:00:00Z" }),
        component("cmp-3", "CDN", "operational", { lastChangedAt: null }),
      ],
    });
    const r = statusForSlug(s, "lumen")!;
    expect(r.lastUpdated).toBe("2026-10-28T10:00:00Z");
  });

  test("no component ever changed → null", () => {
    const s = stateWith({
      tenants: [lumenTenant()],
      components: [component("cmp-1", "API", "operational")],
    });
    const r = statusForSlug(s, "lumen")!;
    expect(r.lastUpdated).toBeNull();
  });

  test("components of OTHER tenants never contribute to lastUpdated", () => {
    const s = stateWith({
      tenants: [lumenTenant()],
      components: [
        component("cmp-1", "API", "operational", {
          tenantId: "tn-other",
          serviceId: "svc-other",
          lastChangedAt: "2026-10-28T11:00:00Z",
        }),
        component("cmp-2", "Database", "operational", { lastChangedAt: "2026-10-28T08:00:00Z" }),
      ],
    });
    const r = statusForSlug(s, "lumen")!;
    expect(r.lastUpdated).toBe("2026-10-28T08:00:00Z");
  });
});

/* ── updateComponentStatus ───────────────────────────────────────── */

describe("updateComponentStatus (the manual override, §3.7)", () => {
  test("updates status + note + stamps lastChangedAt (copy-on-write)", () => {
    const s0 = stateWith({
      tenants: [lumenTenant()],
      components: [component("cmp-1", "API", "operational")],
    });
    const r = updateComponentStatus(
      s0,
      "cmp-1",
      "maintenance",
      "Scheduled maintenance Sun 02:00–06:00 UTC.",
      LUMEN,
      ctxWithNow(NOW),
    );
    expect("component" in r).toBe(true);
    const c = (r as { component: NocturneComponent }).component;
    expect(c.status).toBe("maintenance");
    expect(c.note).toBe("Scheduled maintenance Sun 02:00–06:00 UTC.");
    expect(c.lastChangedAt).toBe(NOW);
    // The prior snapshot is untouched.
    expect(s0.components[0]!.status).toBe("operational");
    expect(s0.components[0]!.lastChangedAt).toBeNull();
  });

  test("nulling the note clears it", () => {
    const s0 = stateWith({
      tenants: [lumenTenant()],
      components: [component("cmp-1", "API", "maintenance", { note: "old", lastChangedAt: "2026-10-27T00:00:00Z" })],
    });
    const r = updateComponentStatus(s0, "cmp-1", "operational", null, LUMEN, ctxWithNow(NOW));
    const c = (r as { component: NocturneComponent }).component;
    expect(c.status).toBe("operational");
    expect(c.note).toBeNull();
  });

  test("an unknown component id → 404-shaped error", () => {
    const s0 = stateWith({ tenants: [lumenTenant()], components: [] });
    const r = updateComponentStatus(s0, "cmp-ghost", "down", null, LUMEN, ctxWithNow(NOW));
    expect("error" in r).toBe(true);
    expect((r as { error: string }).error).toMatch(/unknown component/);
  });

  test("a cross-tenant component → 404-shaped error (never a 403)", () => {
    const s0 = stateWith({
      tenants: [lumenTenant()],
      components: [component("cmp-other", "API", "operational", { tenantId: "tn-other", serviceId: "svc-other" })],
    });
    const r = updateComponentStatus(s0, "cmp-other", "down", null, LUMEN, ctxWithNow(NOW));
    expect((r as { error: string }).error).toMatch(/unknown component/);
  });

  test("the prior state's array reference is shared until a new state is returned", () => {
    const s0 = stateWith({
      tenants: [lumenTenant()],
      components: [component("cmp-1", "API", "operational")],
    });
    const r = updateComponentStatus(s0, "cmp-1", "degraded", null, LUMEN, ctxWithNow(NOW));
    expect((r as { state: NocturneState }).state).not.toBe(s0);
    expect((r as { state: NocturneState }).state.components).not.toBe(s0.components);
  });
});
