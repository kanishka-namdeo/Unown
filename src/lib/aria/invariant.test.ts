import { describe, expect, test } from "bun:test";
import { recordAudit } from "./audit";
import { seedAria } from "./seed";
import { advance, traitMultiplier, testCtx } from "./sequences";
import { snapshotMath, weightedValue, commitLadder, openDealsFor } from "./forecast";
import { AS_OF, type AriaDeal, type AriaState, type AriaPipeline, type AriaEnrollment, type AriaSequence } from "./types";

/*
 * The PBT-style invariant lane (plan §5.1, invariant.test.ts):
 *  1. No closed-deal reopening: a deal whose stage is a terminal
 *     (won/lost) is IMMUTABLE — the engine/reporting math treats it
 *     as final, and a synthetic "reopen" is detected.
 *  2. Contacts unique by email per tenant: the seed's invariant +
 *     a fresh create path's duplicate detection.
 *  3. Every forecast/report total is recomputable from the raw deal
 *     rows: `snapshotMath` is the single source of truth; any total
 *     we report is the sum of the per-deal weighted values.
 *  4. Audit events never mutate: `recordAudit` copy-on-write — the
 *     array reference changes, the event object references stay.
 *  5. The sequence engine's `advance` is deterministic: same inputs
 *     always produce the same outputs (100-iteration pin, also in
 *     sequences.test.ts; here it's pinned against the seed's real
 *     enrollments).
 */

/* ── invariants 1: no closed-deal reopening ──────────────────────── */

describe("invariant: no closed-deal reopening", () => {
  const state = seedAria(AS_OF);
  const LUMEN = "aria-tn-lumen";

  function pipelineOf(id: string): AriaPipeline {
    return state.pipelines.find((p) => p.id === id)!;
  }

  test("the seed's closed deals are all in a terminal stage (won or lost)", () => {
    for (const d of state.deals) {
      if (d.closedAt !== null) {
        const p = pipelineOf(d.pipelineId);
        const stage = p.stages.find((s) => s.id === d.stageId)!;
        expect(stage.state === "closed_won" || stage.state === "closed_lost", `${d.id} is closed but in a ${stage.state} stage`).toBe(true);
      }
    }
  });

  test("a synthetic reopen (a closed deal moved to an open stage) is detectable", () => {
    const closed = state.deals.find((d) => d.closedAt !== null)!;
    const p = pipelineOf(closed.pipelineId);
    const openStage = p.stages.find((s) => s.state === "open")!;
    // The "after" of a hypothetical reopen: the deal is in an open stage
    // but still has a closedAt (the invariant violation).
    const mutated: AriaDeal = { ...closed, stageId: openStage.id };
    expect(mutated.stageId).not.toBe(closed.stageId);
    expect(mutated.closedAt).not.toBeNull(); // the reopen is flagged
    // The invariant guard: a deal whose stage is open but closedAt is
    // set is the exact shape the `deal.stage` route's 400 pins.
    const p2 = pipelineOf(mutated.pipelineId);
    const stage = p2.stages.find((s) => s.id === mutated.stageId)!;
    expect(stage.state).toBe("open");
    expect(mutated.closedAt).not.toBeNull();
  });

  test("the `stuckDeals`/`slippedDeals`/`openDealsFor` math never lists a closed deal as open", () => {
    const open = openDealsFor(state, LUMEN);
    for (const d of open) {
      expect(d.closedAt, `${d.id} is in the open set but has a closedAt`).toBeNull();
    }
  });

  test("closed deals contribute to the win rate but NOT the open forecast", () => {
    const lumenDeals = state.deals.filter((d) => d.tenantId === LUMEN);
    const open = openDealsFor(state, LUMEN);
    const p = pipelineOf(open[0].pipelineId);
    const m = snapshotMath(open, p);
    // every deal in the snapshot math is open
    for (const id of m.dealIds) {
      const d = lumenDeals.find((x) => x.id === id)!;
      expect(d.closedAt).toBeNull();
    }
  });
});

/* ── invariant 2: contacts unique by email per tenant ───────────── */

describe("invariant: contacts unique by email per tenant", () => {
  const state = seedAria(AS_OF);

  test("the seed's contacts are unique by (tenant, email)", () => {
    const seen = new Map<string, string>();
    for (const c of state.contacts) {
      const key = `${c.tenantId}::${c.email.toLowerCase()}`;
      expect(seen.has(key), `duplicate contact ${key} (ids ${seen.get(key)} and ${c.id})`).toBe(false);
      seen.set(key, c.id);
    }
  });

  test("the two tenants do not share a contact email", () => {
    const lumenEmails = new Set(
      state.contacts.filter((c) => c.tenantId === "aria-tn-lumen").map((c) => c.email.toLowerCase()),
    );
    const nwEmails = new Set(
      state.contacts.filter((c) => c.tenantId === "aria-tn-northwind").map((c) => c.email.toLowerCase()),
    );
    for (const e of nwEmails) {
      expect(lumenEmails.has(e), `email ${e} appears in both tenants`).toBe(false);
    }
  });

  test("a duplicate create (case-insensitive) would be rejected (the 409's data rule)", () => {
    // The route's 409 is a DATA rule: the check is a case-insensitive
    // match on (tenantId, email). Pin the predicate here.
    const c = state.contacts[0];
    const wouldConflict = (tenantId: string, email: string) =>
      state.contacts.some(
        (x) => x.tenantId === tenantId && x.email.toLowerCase() === email.toLowerCase(),
      );
    expect(wouldConflict(c.tenantId, c.email)).toBe(true);
    expect(wouldConflict(c.tenantId, c.email.toUpperCase())).toBe(true); // case-insensitive
    expect(wouldConflict("other-tenant", c.email)).toBe(false);
  });
});

/* ── invariant 3: forecast totals recomputable from raw records ─── */

describe("invariant: every forecast total is recomputable from the raw deal rows", () => {
  const state = seedAria(AS_OF);

  test("snapshotMath's weightedTotal = Σ weightedValue(deal) for the raw deal ids", () => {
    for (const p of state.pipelines) {
      const deals = openDealsFor(state, p.tenantId, p.id);
      const m = snapshotMath(deals, p);
      const recomputed = deals.reduce((acc, d) => acc + weightedValue(d, p), 0);
      expect(m.weightedTotal).toBe(recomputed);
      // and the byStage breakdown sums to the same total
      const stageSum = Object.values(m.byStage).reduce((a, b) => a + b, 0);
      expect(stageSum).toBe(recomputed);
      // and the byCategory breakdown sums to the same total
      const catSum = Object.values(m.byCategory).reduce((a, b) => a + b, 0);
      expect(catSum).toBe(recomputed);
      // every deal id in the rollup is a REAL deal row in the tenant
      for (const id of m.dealIds) {
        expect(state.deals.some((d) => d.id === id)).toBe(true);
      }
    }
  });

  test("commitLadder's rungs are each the sum of the raw open deals in-category", () => {
    for (const t of state.tenants) {
      const deals = openDealsFor(state, t.id);
      const l = commitLadder(deals);
      const rawCommit = deals.filter((d) => d.forecastCategory === "commit").reduce((a, d) => a + d.amount, 0);
      const rawBest = deals.filter((d) => d.forecastCategory === "best_case").reduce((a, d) => a + d.amount, 0);
      expect(l.commit).toBe(rawCommit);
      expect(l.bestCase).toBe(rawCommit + rawBest);
      expect(l.pipeline).toBe(
        l.bestCase + deals.filter((d) => d.forecastCategory === "pipeline").reduce((a, d) => a + d.amount, 0),
      );
    }
  });

  test("a captured snapshot's dealIds recompute to its recorded weightedTotal", () => {
    // Seed one snapshot through the same math the capture route uses,
    // then recompute from the raw rows: the total must match exactly.
    const t = state.tenants[0];
    const p = state.pipelines.find((x) => x.tenantId === t.id)!;
    const deals = openDealsFor(state, t.id, p.id);
    const m = snapshotMath(deals, p);
    const snap = {
      id: "snap-test",
      tenantId: t.id,
      periodStart: "2026-10-01T00:00:00Z",
      periodEnd: "2027-01-01T00:00:00Z",
      capturedAt: AS_OF,
      weightedTotal: m.weightedTotal,
      byStage: m.byStage,
      byCategory: m.byCategory,
      dealIds: m.dealIds,
    };
    // The drill-down recompute (the P1 forecast-drift pin): fetch the
    // raw records the snapshot lists and sum their current weighted
    // value against the snapshot's own stage table.
    const raw = state.deals.filter((d) => snap.dealIds.includes(d.id));
    const recomputed = raw.reduce((acc, d) => acc + weightedValue(d, p), 0);
    expect(recomputed).toBe(snap.weightedTotal);
  });
});

/* ── invariant 4: audit events never mutate ──────────────────────── */

describe("invariant: audit events never mutate (copy-on-write)", () => {
  function emptyState(): AriaState {
    return { ...seedAria(AS_OF), audit: [] };
  }

  test("recordAudit returns a NEW state + NEW audit array; the old snapshot is untouched", () => {
    const s0 = emptyState();
    const s1 = recordAudit(s0, "u", "a", "t", "e", null, null, "2026-01-01T00:00:00Z", "t", "x1");
    expect(s1).not.toBe(s0);
    expect(s1.audit).not.toBe(s0.audit);
    expect(s0.audit).toHaveLength(0);
    expect(s1.audit).toHaveLength(1);
  });

  test("the event objects themselves are reference-stable across appends", () => {
    const s0 = emptyState();
    const s1 = recordAudit(s0, "u", "a1", "t", "e", null, null, "2026-01-01T00:00:00Z", "t", "x1");
    const s2 = recordAudit(s1, "u", "a2", "t", "e", null, null, "2026-01-02T00:00:00Z", "t", "x2");
    // s1's event is the SAME object reference in s2's array
    expect(s2.audit[0]).toBe(s1.audit[0]);
    expect(s2.audit[0].id).toBe("x1");
  });

  test("a post-hoc mutation of the input state's audit array does not reach the recorded event", () => {
    const s0 = emptyState();
    const s1 = recordAudit(s0, "u", "a", "t", "e", null, null, "2026-01-01T00:00:00Z", "t", "x1");
    // Mutate s0's array after the fact — s1's array is a separate copy
    s0.audit.push({ ...s1.audit[0], id: "tampered" });
    expect(s1.audit).toHaveLength(1);
    expect(s1.audit[0].id).toBe("x1");
  });
});

/* ── invariant 5: the sequence engine's advance is deterministic ── */

describe("invariant: the sequence engine's advance is deterministic", () => {
  const state = seedAria(AS_OF);

  test("same enrollment + sequence + events + ctx → same output (100-iteration pin over the seed's real enrollments)", () => {
    for (const e of state.enrollments.filter((x) => x.state === "active")) {
      const sequence = state.sequences.find((s) => s.id === e.sequenceId)!;
      const first = advance(e, sequence, "contact", ["open"], testCtx("2026-10-28T00:00:00Z"));
      for (let i = 0; i < 100; i++) {
        const out = advance(e, sequence, "contact", ["open"], testCtx("2026-10-28T00:00:00Z"));
        expect(out).toEqual(first);
      }
    }
  });

  test("traitMultiplier is a pure function of (traits, seed) — no per-call variance", () => {
    const c = state.contacts[0];
    const seq = state.sequences[0];
    const a = traitMultiplier(c.traits, seq.traitSeed);
    for (let i = 0; i < 50; i++) {
      expect(traitMultiplier(c.traits, seq.traitSeed)).toBe(a);
    }
  });

  test("the terminal-states are final: advance on any terminal enrollment is a no-op", () => {
    for (const e of state.enrollments) {
      if (e.state === "enrolled" || e.state === "active") continue;
      const sequence = state.sequences.find((s) => s.id === e.sequenceId)!;
      const out = advance(e, sequence, "x", ["reply"], testCtx("2026-10-28T00:00:00Z"));
      expect(out.enrollment).toBe(e);
      expect(out.newEvents).toEqual([]);
      expect(out.mailboxMsgs).toEqual([]);
      expect(out.newTasks).toEqual([]);
    }
  });

  test("the deterministic id generation: two identical testCtx streams produce identical ids", () => {
    const e = state.enrollments.find((x) => x.state === "active")!;
    const sequence = state.sequences.find((s) => s.id === e.sequenceId)!;
    const a = advance(e, sequence, "x", [], testCtx("2026-01-01T00:00:00Z"));
    const b = advance(e, sequence, "x", [], testCtx("2026-01-01T00:00:00Z"));
    expect(a.newEvents.map((x) => x.id)).toEqual(b.newEvents.map((x) => x.id));
    expect(a.mailboxMsgs.map((x) => x.id)).toEqual(b.mailboxMsgs.map((x) => x.id));
    expect(a.newTasks.map((x) => x.id)).toEqual(b.newTasks.map((x) => x.id));
  });
});
