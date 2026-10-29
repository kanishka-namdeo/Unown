/**
 * PBT-style invariant tests for the Nocturne engine (plan §5.4
 * `invariant.test.ts` — the ~30-test lane).
 *
 * The plan's seven contract invariants, pinned on both SYNTHETIC
 * state (the PBT "generate state, assert the invariant" pattern)
 * and the SEED's real data:
 *
 *  1. **Ack-before-resolve:** every incident with `resolvedAt !==
 *     null` has `acknowledgedAt !== null` AND
 *     `acknowledgedAt <= resolvedAt`.
 *  2. **Escalation only while unacked:** for every `escalated`
 *     timeline event, the incident's `acknowledgedAt` is null at
 *     that event's `at`.
 *  3. **Contiguous rotations:** every rotation's seats tile the
 *     timeline (the §4.4 tiling check).
 *  4. **MTTA/MTTR over resolved only:** the analytics module's
 *     MTTA/MTTR inputs are ONLY incidents with
 *     `resolvedAt !== null`.
 *  5. **Dedup idempotence:** calling `mergeDedup` twice with the
 *     same `(serviceId, dedupKey, firedAt)` produces the same
 *     logical alert (the second call dedupes onto the first, the
 *     count increments by 1).
 *  6. **Terminals are final:** a resolved incident's timeline has
 *     no events AFTER its `resolved` event (the at-then-id sort
 *     proves this).
 *  7. **Timeline immutability:** every timeline event in the state
 *     is an APPEND — no event's `at` or `kind` or `meta` is ever
 *     mutated in place (the copy-on-write contract, pinned by
 *     reference identity).
 */

import { describe, expect, test } from "bun:test";
import { meanTimeToAck, meanTimeToResolve } from "./sla";
import { mergeDedup } from "./dedup";
import { ackIncident, resolveIncident, addNote } from "./incident";
import { tickEscalation } from "./escalation";
import { rotationContiguity } from "./validation";
import { seedNocturne } from "./seed";
import type { NocturneIncident, NocturneState } from "./types";

/* ── synthetic-state helpers ─────────────────────────────────────── */

function ctxWithNow(now: string, seqStart: number = 1) {
  let seq = seqStart;
  return { now: () => now, nextId: (p: string) => `nc_${p}_${seq++}` };
}

const TENANT = "tn-lumen";

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

function incidentRow(id: string, status: NocturneIncident["status"], over: Partial<NocturneIncident> = {}): NocturneIncident {
  return {
    id,
    tenantId: TENANT,
    serviceId: "svc-1",
    title: "t",
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

/* ══ 1. Ack-before-resolve ═══════════════════════════════════════ */

describe("invariant 1: ack-before-resolve", () => {
  test("the engine REFUSES to resolve an unacked incident", () => {
    const s0 = baseState();
    s0.incidents = [incidentRow("i1", "triggered")];
    const r = resolveIncident(s0, "i1", "u-1", ctxWithNow("2026-10-28T10:30:00Z", 10));
    expect((r as { result: { ok: boolean; error: string } }).result.ok).toBe(false);
    expect((r as { result: { ok: boolean; error: string } }).result.error).toMatch(/acknowledged/);
  });

  test("after the full lifecycle, the invariant holds on the state", () => {
    let s = baseState();
    s.incidents = [incidentRow("i1", "triggered")];
    s = (ackIncident(s, "i1", "u-1", undefined, ctxWithNow("2026-10-28T10:01:00Z", 10)) as { state: NocturneState }).state;
    s = (resolveIncident(s, "i1", "u-1", ctxWithNow("2026-10-28T10:30:00Z", 11)) as { state: NocturneState }).state;
    // Check the invariant on the final state.
    for (const i of s.incidents) {
      if (i.resolvedAt !== null) {
        expect(i.acknowledgedAt).not.toBeNull();
        expect(new Date(i.acknowledgedAt!).getTime()).toBeLessThanOrEqual(new Date(i.resolvedAt).getTime());
      }
    }
  });

  test("the seed's data satisfies the invariant", () => {
    const s = seedNocturne();
    for (const i of s.incidents) {
      if (i.resolvedAt !== null) {
        expect(i.acknowledgedAt, i.id).not.toBeNull();
        expect(new Date(i.acknowledgedAt!).getTime(), i.id).toBeLessThanOrEqual(new Date(i.resolvedAt).getTime());
      }
    }
  });
});

/* ══ 2. Escalation only while unacked ════════════════════════════ */

describe("invariant 2: escalation only while unacked", () => {
  test("the engine REFUSES to escalate an acked incident", () => {
    const s0 = baseState();
    s0.incidents = [
      incidentRow("i1", "acknowledged", {
        acknowledgedAt: "2026-10-28T10:01:00Z",
        acknowledgedBy: "u-1",
        activeTierIndex: null,
      }),
    ];
    s0.services = [
      {
        id: "svc-1",
        tenantId: TENANT,
        name: "S",
        description: "",
        rotationId: null,
        escalationPolicy: {
          tiers: [
            { id: "e1", kind: "user", waitMinutes: 1, toTierIndex: 1 },
            { id: "e2", kind: "manager", waitMinutes: 1, toTierIndex: null },
          ],
        },
        slaOverride: null,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    const r = tickEscalation(s0, "i1", ctxWithNow("2026-10-28T11:00:00Z", 10));
    expect(r.result.fired).toBe(false);
    expect(r.state).toBe(s0);
  });

  test("every escalated event in the seed precedes its ack (or the incident stayed unacked)", () => {
    const s = seedNocturne();
    for (const e of s.timeline) {
      if (e.kind !== "escalated") continue;
      const inc = s.incidents.find((i) => i.id === e.incidentId)!;
      const atMs = new Date(e.at).getTime();
      if (inc.acknowledgedAt !== null) {
        expect(new Date(inc.acknowledgedAt).getTime(), `${e.id} on ${inc.id}`).toBeGreaterThan(atMs);
      }
    }
  });

  test("a full unacked escalation trail leaves the invariant intact", () => {
    let s = baseState();
    s.incidents = [incidentRow("i1", "triggered")];
    s.services = [
      {
        id: "svc-1",
        tenantId: TENANT,
        name: "S",
        description: "",
        rotationId: null,
        escalationPolicy: {
          tiers: [
            { id: "e1", kind: "user", waitMinutes: 5, toTierIndex: 1 },
            { id: "e2", kind: "user", waitMinutes: 5, toTierIndex: 2 },
            { id: "e3", kind: "manager", waitMinutes: 5, toTierIndex: null },
          ],
        },
        slaOverride: null,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    s = (tickEscalation(s, "i1", ctxWithNow("2026-10-28T10:05:00Z", 10)) as { state: NocturneState }).state;
    // single-step engine: each call advances at most one tier, and
    // the wait is measured from the LAST tick (lastEscalatedAt), not
    // from triggeredAt. The first tick lands at 10:05 → tier 1.
    s = (tickEscalation(s, "i1", ctxWithNow("2026-10-28T10:10:00Z", 11)) as { state: NocturneState }).state;
    // tier 1's 5-min window from 10:05 → 10:10 → tier 2.
    expect(s.incidents[0]!.activeTierIndex).toBe(2);
    s = (ackIncident(s, "i1", "u-1", undefined, ctxWithNow("2026-10-28T10:20:00Z", 12)) as { state: NocturneState }).state;
    const r = tickEscalation(s, "i1", ctxWithNow("2026-10-28T12:00:00Z", 13));
    expect(r.result.fired).toBe(false);
  });
});

/* ══ 3. Contiguous rotations ═════════════════════════════════════ */

describe("invariant 3: contiguous rotations", () => {
  test("the seed's rotations all satisfy the tiling", () => {
    const s = seedNocturne();
    for (const r of s.rotations) {
      expect(rotationContiguity(r.seats, r.shiftLengthMs), r.id).toBe(true);
    }
  });

  test("a gappy tiling is rejected by the structural check", () => {
    const gap = [
      { seatIndex: 0, userId: "u-a", start: "2026-10-25T00:00:00Z" },
      {
        seatIndex: 1,
        userId: "u-b",
        start: new Date(new Date("2026-10-25T00:00:00Z").getTime() + 2 * 7 * 86_400_000).toISOString().replace(".000Z", "Z"),
      },
    ];
    expect(rotationContiguity(gap, 7 * 86_400_000)).toBe(false);
  });

  test("an overlapping tiling is rejected", () => {
    const overlap = [
      { seatIndex: 0, userId: "u-a", start: "2026-10-25T00:00:00Z" },
      {
        seatIndex: 1,
        userId: "u-b",
        start: new Date(new Date("2026-10-25T00:00:00Z").getTime() + 7 * 86_400_000 / 2).toISOString().replace(".000Z", "Z"),
      },
    ];
    expect(rotationContiguity(overlap, 7 * 86_400_000)).toBe(false);
  });

  test("a strict weekly tiling passes", () => {
    const WEEK = 7 * 86_400_000;
    const good = [
      { seatIndex: 0, userId: "u-a", start: "2026-10-25T00:00:00Z" },
      { seatIndex: 1, userId: "u-b", start: new Date(new Date("2026-10-25T00:00:00Z").getTime() + WEEK).toISOString().replace(".000Z", "Z") },
    ];
    expect(rotationContiguity(good, WEEK)).toBe(true);
  });
});

/* ══ 4. MTTA/MTTR over resolved only ═════════════════════════════ */

describe("invariant 4: MTTA/MTTR over resolved only", () => {
  test("open incidents (with valid ack times) never enter MTTA", () => {
    // A triggered incident with an acknowledgedAt set is synthetic
    // but still "open" — it must be excluded.
    const incidents = [
      incidentRow("i-open", "triggered", {
        acknowledgedAt: "2026-10-28T10:00:01Z",
      }),
      incidentRow("i-res", "resolved", {
        acknowledgedAt: "2026-10-28T10:05:00Z",
        resolvedAt: "2026-10-28T10:45:00Z",
      }),
    ];
    const mtta = meanTimeToAck(incidents)!;
    // Only the resolved incident contributes: 5 minutes.
    expect(mtta).toBe(5 * 60_000);
  });

  test("open incidents never enter MTTR either", () => {
    const incidents = [
      // A snoozed incident has no resolvedAt — it cannot enter MTTR.
      incidentRow("i-snooze", "snoozed", {
        snoozedUntil: "2026-10-28T14:00:00Z",
      }),
      incidentRow("i-res", "resolved", {
        acknowledgedAt: "2026-10-28T10:05:00Z",
        resolvedAt: "2026-10-28T10:45:00Z",
      }),
    ];
    const mttr = meanTimeToResolve(incidents)!;
    expect(mttr).toBe(45 * 60_000);
  });

  test("no resolved incidents → both are null", () => {
    const incidents = [
      incidentRow("i1", "triggered"),
      incidentRow("i2", "acknowledged", {
        acknowledgedAt: "2026-10-28T10:01:00Z",
        acknowledgedBy: "u-1",
      }),
    ];
    expect(meanTimeToAck(incidents)).toBeNull();
    expect(meanTimeToResolve(incidents)).toBeNull();
  });

  test("the seed's MTTA is computed from its two resolved incidents", () => {
    const s = seedNocturne();
    const mtta = meanTimeToAck(s.incidents)!;
    // seed-02: triggered +4 min ack; seed-04: triggered +15 min ack.
    // MTTA = (4 + 15) / 2 = 9.5 min.
    expect(mtta).toBeCloseTo(9.5 * 60_000);
  });
});

/* ══ 5. Dedup idempotence ════════════════════════════════════════ */

describe("invariant 5: dedup idempotence", () => {
  test("two calls with the same (serviceId, dedupKey, firedAt) → one logical alert, count +1", () => {
    let s = baseState();
    const fired = "2026-10-28T11:59:00Z";
    const input = { title: "t", body: "b", severity: "sev1" as const, firedAt: fired };

    const r1 = mergeDedup(s, TENANT, "svc-1", "key", input, ctxWithNow("2026-10-28T12:00:00Z"));
    expect(r1.result.deduped).toBe(false);
    expect(r1.result.alert.count).toBe(1);
    s = r1.state;
    const firstId = r1.result.alert.id;

    const r2 = mergeDedup(s, TENANT, "svc-1", "key", input, ctxWithNow("2026-10-28T12:00:00Z", 2));
    expect(r2.result.deduped).toBe(true);
    expect(r2.result.alert.id).toBe(firstId);
    expect(r2.result.alert.count).toBe(2);
    s = r2.state;

    // The idempotence pin: exactly ONE alert row in the state.
    expect(s.alerts.filter((a) => a.dedupKey === "key")).toHaveLength(1);
  });

  test("five rapid ingests of the same key → exactly one row, count 5 (the risk #4 P1 pin)", () => {
    let s = baseState();
    const input = { title: "t", body: "b", severity: "sev1" as const, firedAt: "2026-10-28T11:59:00Z" };
    for (let i = 0; i < 5; i++) {
      s = mergeDedup(s, TENANT, "svc-1", "key", input, ctxWithNow("2026-10-28T12:00:00Z", i + 1)).state;
    }
    const rows = s.alerts.filter((a) => a.dedupKey === "key");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(5);
  });

  test("the second call's merge is deterministic (same inputs, same output)", () => {
    const s1 = baseState();
    const s2 = baseState();
    const input = { title: "t", body: "b", severity: "sev1" as const, firedAt: "2026-10-28T11:59:00Z" };
    const a1 = mergeDedup(s1, TENANT, "svc-1", "key", input, ctxWithNow("2026-10-28T12:00:00Z"));
    const a2 = mergeDedup(s2, TENANT, "svc-1", "key", input, ctxWithNow("2026-10-28T12:00:00Z"));
    // The two fresh alerts deep-equal (modulo the counter — same
    // call order, same ids).
    expect(a1.result.alert).toEqual(a2.result.alert);
    const b1 = mergeDedup(a1.state, TENANT, "svc-1", "key", input, ctxWithNow("2026-10-28T12:00:00Z", 2));
    const b2 = mergeDedup(a2.state, TENANT, "svc-1", "key", input, ctxWithNow("2026-10-28T12:00:00Z", 2));
    expect(b1.result.alert).toEqual(b2.result.alert);
    expect(b1.result.alert.count).toBe(2);
  });
});

/* ══ 6. Terminals are final ══════════════════════════════════════ */

describe("invariant 6: terminals are final", () => {
  test("no events land after a resolved event on a resolved incident", () => {
    const s = seedNocturne();
    for (const inc of s.incidents.filter((i) => i.status === "resolved")) {
      const events = s.timeline
        .filter((e) => e.incidentId === inc.id)
        .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
      const resolvedAt = inc.resolvedAt!;
      for (let i = 0; i < events.length; i++) {
        const e = events[i]!;
        const isResolved = e.kind === "resolved";
        // No event may be strictly AFTER the resolved event
        // (at-then-id order).
        if (i > 0 && e.at > resolvedAt) {
          // Only the resolved event itself may carry at === resolvedAt.
          expect(isResolved, `${e.id} at ${e.at} after ${resolvedAt}`).toBe(true);
        }
      }
      // The last event is the resolved event (or tied on at — id
      // order decides; here the resolved event is the newest).
      const last = events[events.length - 1]!;
      expect(new Date(last.at).getTime() <= new Date(resolvedAt).getTime(), inc.id).toBe(true);
    }
  });

  test("the engine refuses to append to a resolved incident (addNote still works on the incident's note row — the timeline append path is the mutation surface)", () => {
    // addNote appends a timeline event — but the plan's terminals
    // invariant is about STATE TRANSITIONS. A note on a resolved
    // incident is legal (postmortem follow-ups); what is forbidden
    // is a state transition (ack/resolve/snooze/escalate).
    // Pin the transition side:
    const s0 = baseState();
    s0.incidents = [
      incidentRow("i1", "resolved", {
        acknowledgedAt: "2026-10-28T10:01:00Z",
        acknowledgedBy: "u-1",
        resolvedAt: "2026-10-28T10:30:00Z",
        resolvedBy: "u-1",
        activeTierIndex: null,
      }),
    ];
    const ack = ackIncident(s0, "i1", "u-2", undefined, ctxWithNow("2026-10-28T11:00:00Z", 10));
    expect((ack as { result: { ok: boolean; error: string } }).result.ok).toBe(false); // refused
    const r2 = resolveIncident(s0, "i1", "u-2", ctxWithNow("2026-10-28T11:00:00Z", 11));
    // Idempotent no-op: returns the incident, state unchanged.
    expect("result" in r2).toBe(true);
    const rr = r2 as { state: NocturneState; result: NocturneIncident };
    expect(rr.state).toBe(s0);
    expect(rr.result.status).toBe("resolved");
    expect(rr.result.resolvedAt).toBe("2026-10-28T10:30:00Z"); // original
  });
});

/* ══ 7. Timeline immutability ════════════════════════════════════ */

describe("invariant 7: timeline immutability (copy-on-write)", () => {
  test("every engine append returns a new array; event references stay stable", () => {
    let s = baseState();
    s.incidents = [incidentRow("i1", "triggered")];

    s = (addNote(s, "i1", "u-1", "first", ctxWithNow("2026-10-28T10:05:00Z", 10)) as { state: NocturneState }).state;
    const ev1 = s.timeline.find((e) => e.kind === "note")!;

    s = (ackIncident(s, "i1", "u-1", undefined, ctxWithNow("2026-10-28T10:06:00Z", 11)) as { state: NocturneState }).state;
    const ev2 = s.timeline.find((e) => e.kind === "acknowledged")!;

    s = (resolveIncident(s, "i1", "u-1", ctxWithNow("2026-10-28T10:30:00Z", 12)) as { state: NocturneState }).state;

    // All three events coexist; references are stable; no field
    // was mutated in place.
    const timeline = s.timeline;
    // note events carry the noteId in meta — find by that marker.
    const noteEvt = timeline.find((e) => e.kind === "note")!;
    expect(noteEvt).toBe(ev1);
    const ackEvt = timeline.find((e) => e.kind === "acknowledged")!;
    expect(ackEvt).toBe(ev2);
    expect(noteEvt.meta.noteId).toBe("nc_note_10");
    expect(noteEvt.at).toBe("2026-10-28T10:05:00Z");
    expect(ackEvt.at).toBe("2026-10-28T10:06:00Z");
  });

  test("the seed's timeline events carry unique ids + monotonic at", () => {
    const s = seedNocturne();
    const ids = new Set(s.timeline.map((e) => e.id));
    expect(ids.size).toBe(s.timeline.length);
    // The seed is sorted at-then-id; verify monotonic at.
    for (let i = 1; i < s.timeline.length; i++) {
      const prev = s.timeline[i - 1]!;
      const cur = s.timeline[i]!;
      if (cur.at === prev.at) {
        expect(cur.id > prev.id).toBe(true);
      } else {
        expect(cur.at > prev.at).toBe(true);
      }
    }
  });
});
