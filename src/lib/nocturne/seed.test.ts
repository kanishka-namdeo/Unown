/**
 * Tests for the Nocturne seed's structural invariants (plan §5.1
 * `seed.test.ts` — the ~15-test lane).
 *
 * Pins:
 *  - two seeds deep-equal (determinism);
 *  - the AS_OF pin: the seed's clock defaults to
 *    `2026-10-28T12:00:00Z`;
 *  - tenant-differentiated SLA policies (Lumen professional vs
 *    Northwind starter);
 *  - all rotations satisfy `rotationContiguity`;
 *  - seed-constant id schemes (the parley discipline:
 *    `nc_seed_*` / `nc_inc_seed_*` / …);
 *  - the seed's 5 incidents + 5 alerts + 2 postmortems;
 *  - the `seq` counter starts after the largest seed constant so
 *    live ids never collide.
 */

import { describe, expect, test } from "bun:test";
import { seedNocturne } from "./seed";
import { AS_OF } from "./types";
import { rotationContiguity } from "./validation";

describe("seed determinism", () => {
  test("two seeds with the default clock deep-equal", () => {
    const a = seedNocturne();
    const b = seedNocturne();
    expect(a).toEqual(b);
  });

  test("two seeds with an explicit clock deep-equal", () => {
    const a = seedNocturne("2026-09-15T00:00:00Z");
    const b = seedNocturne("2026-09-15T00:00:00Z");
    expect(a).toEqual(b);
  });

  test("the seed's fixture is a 9-week trail anchored at AS_OF (relative to the default clock)", () => {
    // The seed's fixture is a deterministic 9-week trail
    // (2026-08-31 … 2026-10-28) anchored at AS_OF (the default
    // clock). The `now` parameter of `seedNocturne` is honored for
    // the seed's own trail math (the fixtures are anchored at the
    // explicit clock, not at AS_OF — this is the parley
    // "two seeds deep-equal" pin: two calls with the same
    // explicit clock deep-equal, and two calls with different
    // explicit clocks produce different trails).
    const a = seedNocturne("2026-10-28T12:00:00Z");
    const b = seedNocturne("2026-09-15T00:00:00Z");
    // The seed's ALERTS are anchored to AS_OF (the module constant),
    // not to `now` — so the alert trail is identical across calls.
    // The INCIDENT trail shifts with `now` (the incidents use the
    // relative anchors from `now`).
    const aAlerts = a.alerts.map((x) => x.firedAt).sort();
    const bAlerts = b.alerts.map((x) => x.firedAt).sort();
    expect(aAlerts).toEqual(bAlerts); // alerts anchored at AS_OF
    // The AS_OF-pinned constant (the default clock) gives the
    // "2026-10-28" trail — the 9-week span's end date.
    const defaultSeed = seedNocturne();
    const latestTriggered = defaultSeed.incidents.map((i) => i.triggeredAt).sort();
    expect(latestTriggered[latestTriggered.length - 1]!).toBe("2026-10-28T11:15:00Z");
  });
});

describe("the AS_OF pin", () => {
  test("the default seed clock is 2026-10-28T12:00:00Z", () => {
    const s = seedNocturne();
    // The Lumen unacked sev1 triggered 45 minutes before AS_OF.
    expect(s.incidents[0]!.triggeredAt).toBe("2026-10-28T11:15:00Z");
    expect(AS_OF).toBe("2026-10-28T12:00:00Z");
  });
});

describe("tenant-differentiated SLA policies", () => {
  test("Lumen (professional) has faster sev1 targets than Northwind (starter)", () => {
    const s = seedNocturne();
    const lumen = s.tenants.find((t) => t.id === "tn-lumen")!;
    const nw = s.tenants.find((t) => t.id === "tn-northwind")!;
    expect(lumen.plan).toBe("professional");
    expect(nw.plan).toBe("starter");
    expect(lumen.slaMinutes.sev1.ack).toBeLessThan(nw.slaMinutes.sev1.ack);
    expect(lumen.slaMinutes.sev1.resolve).toBeLessThan(nw.slaMinutes.sev1.resolve);
  });

  test("both tenants carry all four severities", () => {
    const s = seedNocturne();
    for (const t of s.tenants) {
      expect(Object.keys(t.slaMinutes).sort()).toEqual(
        ["sev1", "sev2", "sev3", "sev4"],
      );
    }
  });

  test("the Lumen Web Console service carries a service-level SLA override", () => {
    const s = seedNocturne();
    const web = s.services.find((x) => x.id === "nc_seed_svc_02")!;
    expect(web.slaOverride).not.toBeNull();
    expect(web.slaOverride!.sev1).toBe(60);
  });
});

describe("rotation contiguity (the PBT invariant §5.4/3)", () => {
  test("every seeded rotation satisfies rotationContiguity", () => {
    const s = seedNocturne();
    for (const r of s.rotations) {
      expect(rotationContiguity(r.seats, r.shiftLengthMs), r.id).toBe(true);
    }
  });

  test("the seed's rotations are weekly (shiftLengthMs = 7 days)", () => {
    const s = seedNocturne();
    for (const r of s.rotations) {
      expect(r.shiftLengthMs).toBe(7 * 86_400_000);
      expect(r.seats.length).toBe(4);
    }
  });

  test("seat indices are dense 0..n-1", () => {
    const s = seedNocturne();
    for (const r of s.rotations) {
      const idxs = r.seats.map((x) => x.seatIndex).sort((a, b) => a - b);
      expect(idxs).toEqual(Array.from({ length: r.seats.length }, (_, i) => i));
    }
  });
});

describe("the seed's fixture shapes", () => {
  test("exactly 2 tenants, 8 users, 8 memberships", () => {
    const s = seedNocturne();
    expect(s.tenants).toHaveLength(2);
    expect(s.users).toHaveLength(8);
    expect(s.memberships).toHaveLength(8);
  });

  test("exactly 5 seeded incidents + 5 seeded alerts", () => {
    const s = seedNocturne();
    expect(s.incidents).toHaveLength(5);
    expect(s.alerts).toHaveLength(5);
  });

  test("the 5 incidents span the status ladder (the fixture variety)", () => {
    const s = seedNocturne();
    const statuses = s.incidents.map((i) => i.status).sort();
    expect(statuses).toEqual(["resolved", "resolved", "snoozed", "triggered", "triggered"]);
  });

  test("every seeded alert is linked to an incident", () => {
    const s = seedNocturne();
    for (const a of s.alerts) {
      expect(a.incidentId).not.toBeNull();
      expect(s.incidents.some((i) => i.id === a.incidentId)).toBe(true);
    }
  });

  test("exactly 2 seeded postmortems, both on RESOLVED incidents", () => {
    const s = seedNocturne();
    expect(s.postmortems).toHaveLength(2);
    for (const pm of s.postmortems) {
      const inc = s.incidents.find((i) => i.id === pm.incidentId)!;
      expect(inc.status).toBe("resolved");
      expect(inc.postmortemId).toBe(pm.id);
    }
  });

  test("the Lumen rich incident (seed-02) carries the full trail", () => {
    const s = seedNocturne();
    const rich = s.incidents.find((i) => i.id === "nc_inc_seed_02")!;
    expect(rich.status).toBe("resolved");
    expect(rich.activeTierIndex).toBeNull(); // terminal
    expect(rich.lastEscalatedAt).not.toBeNull();
    const trail = s.timeline.filter((e) => e.incidentId === rich.id);
    const kinds = trail.map((e) => e.kind);
    expect(kinds).toContain("alert_received");
    expect(kinds).toContain("incident_created");
    expect(kinds).toContain("acknowledged");
    expect(kinds).toContain("escalated");
    expect(kinds).toContain("note");
    expect(kinds).toContain("resolved");
  });
});

describe("the seed's tenancy + id discipline", () => {
  test("every tenant-owned row carries a tenantId matching a seeded tenant", () => {
    const s = seedNocturne();
    const ids = new Set(s.tenants.map((t) => t.id));
    for (const arr of [
      s.services,
      s.rotations,
      s.overrides,
      s.alerts,
      s.incidents,
      s.notes,
      s.runbooks,
      s.checklists,
      s.components,
      s.postmortems,
      s.invites,
      s.audit,
      s.sessions,
    ]) {
      for (const row of arr) {
        expect(ids.has(row.tenantId), `${row.tenantId}`).toBe(true);
      }
    }
  });

  test("live ids never collide with seed ids (seq starts at 100)", () => {
    const s = seedNocturne();
    expect(s.seq).toBe(100);
    const seedIds = new Set([
      ...s.alerts.map((a) => a.id),
      ...s.incidents.map((i) => i.id),
      ...s.timeline.map((e) => e.id),
      ...s.notes.map((n) => n.id),
      ...s.runbooks.map((r) => r.id),
      ...s.checklists.map((c) => c.id),
      ...s.services.map((x) => x.id),
      ...s.rotations.map((r) => r.id),
      ...s.components.map((c) => c.id),
      ...s.postmortems.map((p) => p.id),
    ]);
    // A live id at seq 100 must not be in the seed's id space.
    expect(seedIds.has("nc_al_100")).toBe(false);
    expect(seedIds.has("nc_inc_100")).toBe(false);
  });

  test("the timeline is sorted by at then id (the pinned render order)", () => {
    const s = seedNocturne();
    const sorted = [...s.timeline].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    expect(s.timeline).toEqual(sorted);
  });

  test("the ack-before-resolve invariant holds on the seed (§5.4/1)", () => {
    const s = seedNocturne();
    for (const i of s.incidents) {
      if (i.resolvedAt !== null) {
        expect(i.acknowledgedAt, i.id).not.toBeNull();
        expect(
          new Date(i.acknowledgedAt!).getTime() <= new Date(i.resolvedAt).getTime(),
          i.id,
        ).toBe(true);
      }
    }
  });

  test("the escalation-only-while-unacked invariant holds on the seed: every escalated event predates the incident's ack (§5.4/2)", () => {
    const s = seedNocturne();
    for (const e of s.timeline) {
      if (e.kind !== "escalated") continue;
      const inc = s.incidents.find((i) => i.id === e.incidentId)!;
      // At the event's `at`, the incident must not yet be acked:
      // acknowledgedAt is null, OR the ack instant is strictly after
      // the escalation event's instant.
      expect(
        inc.acknowledgedAt === null ||
          new Date(inc.acknowledgedAt).getTime() > new Date(e.at).getTime(),
        `${e.id} on ${inc.id}`,
      ).toBe(true);
    }
  });

  test("the terminals-are-final invariant holds on the seed (§5.4/6)", () => {
    const s = seedNocturne();
    for (const inc of s.incidents) {
      if (inc.resolvedAt === null) continue;
      const events = s.timeline
        .filter((e) => e.incidentId === inc.id)
        .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
      const resolvedIdx = events.findIndex((e) => e.kind === "resolved");
      expect(resolvedIdx, inc.id).toBe(events.length - 1);
      // A resolved incident's activeTierIndex is null.
      expect(inc.activeTierIndex, inc.id).toBeNull();
    }
  });

  test("seeded users carry the fixed demo-constant salts", () => {
    const s = seedNocturne();
    for (const u of s.users) {
      expect(u.salt.startsWith("s-nocturne-"), u.id).toBe(true);
    }
  });
});
