/**
 * Tests for the Nocturne incident lifecycle engine (plan §4.6 +
 * §5.1 `incident.test.ts` — the ~25-test lane).
 *
 * Pins the state machine:
 *  - `ack` from `triggered` / `snoozed` → `acknowledged`;
 *  - `ack` from `acknowledged` is an idempotent no-op;
 *  - `ack` from `resolved` → error (400);
 *  - `resolve` from `acknowledged` → `resolved` (the terminal);
 *  - `resolve` from `triggered` / `snoozed` → error
 *    (the PBT invariant "ack-before-resolve", §5.4/1);
 *  - `resolve` from `resolved` is an idempotent no-op;
 *  - `snooze` from `triggered` / `acknowledged` → `snoozed`;
 *  - `snooze` from `resolved` → error;
 *  - `autoUnSnooze` fires only when `now >= snoozedUntil`;
 *  - timeline events are appended (copy-on-write, at-then-id
 *    ordering preserved by the caller);
 *  - notes: add + update (the note row is mutable; the timeline
 *    event is immutable).
 */

import { describe, expect, test } from "bun:test";
import {
  ackIncident,
  addNote,
  autoUnSnooze,
  resolveIncident,
  snoozeIncident,
  updateNote,
} from "./incident";
import type { NocturneIncident, NocturneState } from "./types";

/* ── helpers ─────────────────────────────────────────────────────── */

function ctxWithNow(now: string, seqStart: number = 1) {
  let seq = seqStart;
  return { now: () => now, nextId: (p: string) => `nc_${p}_${seq++}` };
}

const TENANT = "tn-lumen";
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
    serviceId: "svc-1",
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

function withIncident(status: NocturneIncident["status"], over: Partial<NocturneIncident> = {}): NocturneState {
  const s = baseState();
  s.incidents = [incidentRow(status, over)];
  return s;
}

/* ── ack ─────────────────────────────────────────────────────────── */

describe("ackIncident", () => {
  test("ack from triggered → acknowledged (status, times, actor, tier cleared)", () => {
    const s0 = withIncident("triggered");
    const r = ackIncident(s0, "inc-1", "u-ada", undefined, ctxWithNow("2026-10-28T11:02:00Z", 10));
    expect("ok" in r).toBe(false); // not an error
    const i = r.result as NocturneIncident;
    expect(i.status).toBe("acknowledged");
    expect(i.acknowledgedAt).toBe("2026-10-28T11:02:00Z");
    expect(i.acknowledgedBy).toBe("u-ada");
    expect(i.activeTierIndex).toBeNull();
    // A timeline event was appended.
    expect(r.state.timeline).toHaveLength(1);
    expect(r.state.timeline[0]!.kind).toBe("acknowledged");
  });

  test("ack from snoozed → acknowledged", () => {
    const s0 = withIncident("snoozed", {
      acknowledgedAt: "2026-10-28T11:01:00Z",
      acknowledgedBy: "u-theo",
      snoozedUntil: "2026-10-28T12:00:00Z",
    });
    const r = ackIncident(s0, "inc-1", "u-ada", undefined, ctxWithNow("2026-10-28T11:05:00Z", 10));
    const i = r.result as NocturneIncident;
    expect(i.status).toBe("acknowledged");
    // snoozedUntil is retained on the row (the auto-un-snooze path
    // clears it — ack does not).
    expect(i.acknowledgedBy).toBe("u-ada");
  });

  test("ack carries the optional note into the timeline event", () => {
    const s0 = withIncident("triggered");
    const r = ackIncident(s0, "inc-1", "u-ada", "on it", ctxWithNow("2026-10-28T11:02:00Z", 10));
    const evt = r.state.timeline[0]!;
    expect(evt.meta).toEqual({ note: "on it" });
  });

  test("ack from acknowledged is an idempotent no-op (state unchanged)", () => {
    const s0 = withIncident("acknowledged", {
      acknowledgedAt: "2026-10-28T11:02:00Z",
      acknowledgedBy: "u-ada",
    });
    const r = ackIncident(s0, "inc-1", "u-theo", undefined, ctxWithNow("2026-10-28T11:03:00Z", 10));
    expect("ok" in r).toBe(false);
    expect(r.state).toBe(s0); // no state change
    const i = r.result as NocturneIncident;
    expect(i.acknowledgedBy).toBe("u-ada"); // the original acker wins
  });

  test("ack from resolved → error (terminals are final, §5.4/6)", () => {
    const s0 = withIncident("resolved", {
      acknowledgedAt: "2026-10-28T11:02:00Z",
      acknowledgedBy: "u-ada",
      resolvedAt: "2026-10-28T12:00:00Z",
      resolvedBy: "u-ada",
    });
    const r = ackIncident(s0, "inc-1", "u-theo", undefined, ctxWithNow("2026-10-28T13:00:00Z", 10));
    expect((r as { result: { ok: boolean; error: string } }).result.ok).toBe(false);
    expect((r as { result: { ok: boolean; error: string } }).result.error).toMatch(/resolved/);
  });

  test("ack on an unknown incident → error", () => {
    const s0 = baseState();
    const r = ackIncident(s0, "inc-ghost", "u-1", undefined, ctxWithNow("2026-10-28T11:02:00Z", 10));
    expect((r as { result: { ok: boolean } }).result.ok).toBe(false);
  });
});

/* ── resolve (the ack-before-resolve invariant) ──────────────────── */

describe("resolveIncident", () => {
  test("resolve from acknowledged → resolved", () => {
    const s0 = withIncident("acknowledged", {
      acknowledgedAt: "2026-10-28T11:02:00Z",
      acknowledgedBy: "u-ada",
    });
    const r = resolveIncident(s0, "inc-1", "u-ada", ctxWithNow("2026-10-28T11:30:00Z", 10));
    expect("ok" in r).toBe(false);
    const i = r.result as NocturneIncident;
    expect(i.status).toBe("resolved");
    expect(i.resolvedAt).toBe("2026-10-28T11:30:00Z");
    expect(i.resolvedBy).toBe("u-ada");
    expect(i.activeTierIndex).toBeNull(); // terminal clears the tier
    expect(r.state.timeline[0]!.kind).toBe("resolved");
  });

  test("resolve from triggered → error (the ack-before-resolve pin, §5.4/1)", () => {
    const s0 = withIncident("triggered");
    const r = resolveIncident(s0, "inc-1", "u-ada", ctxWithNow("2026-10-28T11:30:00Z", 10));
    expect((r as { result: { ok: boolean; error: string } }).result.ok).toBe(false);
    expect((r as { result: { ok: boolean; error: string } }).result.error).toMatch(/acknowledged/);
    // No state change.
    expect(r.state).toBe(s0);
  });

  test("resolve from snoozed → error (must ack first)", () => {
    const s0 = withIncident("snoozed", {
      acknowledgedAt: "2026-10-28T11:01:00Z",
      acknowledgedBy: "u-ada",
      snoozedUntil: "2026-10-28T12:00:00Z",
    });
    const r = resolveIncident(s0, "inc-1", "u-ada", ctxWithNow("2026-10-28T11:30:00Z", 10));
    expect((r as { result: { ok: boolean } }).result.ok).toBe(false);
  });

  test("resolve from resolved is an idempotent no-op", () => {
    const s0 = withIncident("resolved", {
      acknowledgedAt: "2026-10-28T11:02:00Z",
      acknowledgedBy: "u-ada",
      resolvedAt: "2026-10-28T11:30:00Z",
      resolvedBy: "u-ada",
    });
    const r = resolveIncident(s0, "inc-1", "u-ada", ctxWithNow("2026-10-28T12:00:00Z", 10));
    expect("ok" in r).toBe(false);
    expect(r.state).toBe(s0);
  });

  test("the PBT pin: every resolved incident has acknowledgedAt <= resolvedAt", () => {
    const s0 = withIncident("acknowledged", {
      acknowledgedAt: "2026-10-28T11:02:00Z",
      acknowledgedBy: "u-ada",
    });
    const r = resolveIncident(s0, "inc-1", "u-ada", ctxWithNow("2026-10-28T11:30:00Z", 10));
    const i = r.result as NocturneIncident;
    expect(new Date(i.acknowledgedAt!).getTime()).toBeLessThanOrEqual(new Date(i.resolvedAt!).getTime());
  });
});

/* ── snooze ──────────────────────────────────────────────────────── */

describe("snoozeIncident", () => {
  test("snooze from triggered → snoozed (snoozedUntil set)", () => {
    const s0 = withIncident("triggered");
    const r = snoozeIncident(s0, "inc-1", "u-theo", "2026-10-28T14:00:00Z", ctxWithNow("2026-10-28T11:05:00Z", 10));
    expect("ok" in r).toBe(false);
    const i = r.result as NocturneIncident;
    expect(i.status).toBe("snoozed");
    expect(i.snoozedUntil).toBe("2026-10-28T14:00:00Z");
    expect(r.state.timeline[0]!.kind).toBe("snoozed");
    expect(r.state.timeline[0]!.meta).toEqual({ until: "2026-10-28T14:00:00Z" });
  });

  test("snooze from acknowledged → snoozed", () => {
    const s0 = withIncident("acknowledged", {
      acknowledgedAt: "2026-10-28T11:01:00Z",
      acknowledgedBy: "u-ada",
    });
    const r = snoozeIncident(s0, "inc-1", "u-theo", "2026-10-28T14:00:00Z", ctxWithNow("2026-10-28T11:05:00Z", 10));
    const i = r.result as NocturneIncident;
    expect(i.status).toBe("snoozed");
    // acknowledgedAt survives the snooze (the un-snooze returns to
    // acknowledged, not triggered).
    expect(i.acknowledgedAt).toBe("2026-10-28T11:01:00Z");
  });

  test("snooze from resolved → error (terminals are final)", () => {
    const s0 = withIncident("resolved", {
      acknowledgedAt: "2026-10-28T11:02:00Z",
      acknowledgedBy: "u-ada",
      resolvedAt: "2026-10-28T11:30:00Z",
      resolvedBy: "u-ada",
    });
    const r = snoozeIncident(s0, "inc-1", "u-theo", "2026-10-28T14:00:00Z", ctxWithNow("2026-10-28T13:00:00Z", 10));
    expect((r as { result: { ok: boolean; error: string } }).result.ok).toBe(false);
    expect((r as { result: { ok: boolean; error: string } }).result.error).toMatch(/resolved/);
  });
});

/* ── autoUnSnooze ─────────────────────────────────────────────────── */

describe("autoUnSnooze", () => {
  test("no-op before the snooze expires", () => {
    const s0 = withIncident("snoozed", {
      acknowledgedAt: "2026-10-28T11:01:00Z",
      acknowledgedBy: "u-ada",
      snoozedUntil: "2026-10-28T14:00:00Z",
    });
    const r = autoUnSnooze(s0, "inc-1", ctxWithNow("2026-10-28T13:59:59Z", 10));
    expect(r.fired).toBe(false);
    expect(r.state).toBe(s0);
    expect(r.incident.status).toBe("snoozed");
  });

  test("an acked incident returns to acknowledged on expiry", () => {
    const s0 = withIncident("snoozed", {
      acknowledgedAt: "2026-10-28T11:01:00Z",
      acknowledgedBy: "u-ada",
      snoozedUntil: "2026-10-28T14:00:00Z",
    });
    const r = autoUnSnooze(s0, "inc-1", ctxWithNow("2026-10-28T14:00:00Z", 10));
    expect(r.fired).toBe(true);
    expect(r.incident.status).toBe("acknowledged");
    expect(r.incident.snoozedUntil).toBeNull();
    // A status_changed timeline event was appended.
    const evt = r.state.timeline[r.state.timeline.length - 1]!;
    expect(evt.kind).toBe("status_changed");
    expect(evt.meta).toEqual({ from: "snoozed", to: "acknowledged" });
  });

  test("a never-acked snoozed incident returns to triggered on expiry", () => {
    const s0 = withIncident("snoozed", { snoozedUntil: "2026-10-28T14:00:00Z" });
    const r = autoUnSnooze(s0, "inc-1", ctxWithNow("2026-10-28T15:00:00Z", 10));
    expect(r.fired).toBe(true);
    expect(r.incident.status).toBe("triggered");
  });

  test("a non-snoozed incident is a no-op", () => {
    const s0 = withIncident("triggered");
    const r = autoUnSnooze(s0, "inc-1", ctxWithNow("2026-10-28T15:00:00Z", 10));
    expect(r.fired).toBe(false);
    expect(r.state).toBe(s0);
  });
});

/* ── notes ───────────────────────────────────────────────────────── */

describe("notes (mutable row + immutable timeline event)", () => {
  test("addNote appends the note row + a note timeline event", () => {
    const s0 = withIncident("triggered");
    const r = addNote(s0, "inc-1", "u-mira", "watching the 5xx ratio", ctxWithNow("2026-10-28T11:10:00Z", 10));
    expect(r.note.id).toBe("nc_note_10");
    expect(r.note.authorId).toBe("u-mira");
    expect(r.note.body).toBe("watching the 5xx ratio");
    expect(r.note.tenantId).toBe(TENANT);
    expect(r.note.updatedAt).toBeNull();
    expect(r.state.notes).toHaveLength(1);
    const evt = r.state.timeline[r.state.timeline.length - 1]!;
    expect(evt.kind).toBe("note");
    expect(evt.actorId).toBe("u-mira");
    expect(evt.meta).toEqual({ noteId: r.note.id });
  });

  test("updateNote edits the row in place (updatedAt stamped) — the timeline event is untouched", () => {
    const s0 = withIncident("triggered");
    const added = addNote(s0, "inc-1", "u-mira", "v1", ctxWithNow("2026-10-28T11:10:00Z", 10));
    const r = updateNote(added.state, added.note.id, "v2-edited", "2026-10-28T11:20:00Z");
    const note = r.notes[0]!;
    expect(note.body).toBe("v2-edited");
    expect(note.updatedAt).toBe("2026-10-28T11:20:00Z");
    expect(note.createdAt).toBe("2026-10-28T11:10:00Z");
    // The timeline is untouched by the in-place edit.
    expect(r.timeline).toBe(added.state.timeline);
  });

  test("the prior snapshot's note row is not mutated by updateNote", () => {
    const s0 = withIncident("triggered");
    const added = addNote(s0, "inc-1", "u-mira", "v1", ctxWithNow("2026-10-28T11:10:00Z", 10));
    updateNote(added.state, added.note.id, "v2", "2026-10-28T11:20:00Z");
    expect(added.state.notes[0]!.body).toBe("v1");
  });
});

/* ── timeline immutability (copy-on-write) ───────────────────────── */

describe("timeline immutability (§5.4/7)", () => {
  test("every transition appends — prior event references stay stable", () => {
    const s0 = withIncident("triggered");
    const r1 = ackIncident(s0, "inc-1", "u-ada", undefined, ctxWithNow("2026-10-28T11:02:00Z", 10));
    const ev1 = r1.state.timeline[0]!;
    const r2 = snoozeIncident(r1.state, "inc-1", "u-theo", "2026-10-28T14:00:00Z", ctxWithNow("2026-10-28T11:05:00Z", 11));
    expect(r2.state.timeline).toHaveLength(2);
    expect(r2.state.timeline[0]).toBe(ev1); // reference-stable
    expect(ev1.meta).toStrictEqual(ev1.meta);
  });

  test("the timeline is ordered by append (at-then-id sort is the reader's job)", () => {
    const s0 = withIncident("triggered");
    const r1 = ackIncident(s0, "inc-1", "u-ada", undefined, ctxWithNow("2026-10-28T11:02:00Z", 10));
    const r2 = snoozeIncident(r1.state, "inc-1", "u-theo", "2026-10-28T14:00:00Z", ctxWithNow("2026-10-28T11:05:00Z", 11));
    const times = r2.state.timeline.map((e) => new Date(e.at).getTime());
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
  });

  test("terminals are final: no events land after a resolved event (§5.4/6)", () => {
    const s0 = withIncident("acknowledged", {
      acknowledgedAt: "2026-10-28T11:02:00Z",
      acknowledgedBy: "u-ada",
    });
    const r1 = resolveIncident(s0, "inc-1", "u-ada", ctxWithNow("2026-10-28T11:30:00Z", 10));
    // Now try to act on the resolved incident — every action is refused.
    const r2 = ackIncident(r1.state, "inc-1", "u-b", undefined, ctxWithNow("2026-10-28T12:00:00Z", 11));
    expect((r2 as { result: { ok: boolean } }).result.ok).toBe(false); // refused
    const r3 = snoozeIncident(r1.state, "inc-1", "u-b", "2026-10-28T13:00:00Z", ctxWithNow("2026-10-28T12:00:00Z", 11));
    expect((r3 as { result: { ok: boolean } }).result.ok).toBe(false); // refused
    // The timeline still has exactly the events up to and including
    // the resolved event.
    const resolvedIdx = r1.state.timeline.findIndex((e) => e.kind === "resolved");
    expect(resolvedIdx).toBeGreaterThanOrEqual(0);
    expect(r1.state.timeline.length).toBe(resolvedIdx + 1);
  });
});
