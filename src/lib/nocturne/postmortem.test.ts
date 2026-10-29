/**
 * Tests for the Nocturne postmortem engine (plan §3.8 + §5.1
 * `postmortem.test.ts` — the ~10-test lane).
 *
 * Pins:
 *  - `createPostmortem` requires a RESOLVED incident
 *    (risk #12 P2: "Postmortem before resolution");
 *  - the postmortem row is linked to the incident's
 *    `postmortemId`;
 *  - the `summary` block carries the trigger → ack → resolve
 *    deltas (ms math via `postmortemDeltas`);
 *  - action items are created with `done: false`, sequential
 *    ids `ai-1…ai-N`;
 *  - `setActionItemState` flips a single item (copy-on-write);
 *    the 404-when-unknown error shape for bad postmortem /
 *    action ids;
 *  - `doneAt` is stamped with `ctx.now()` when omitted on a
 *    `done: true` flip.
 */

import { describe, expect, test } from "bun:test";
import {
  createPostmortem,
  postmortemDeltas,
  setActionItemState,
} from "./postmortem";
import type { NocturneIncident, NocturneState } from "./types";

/* ── helpers ─────────────────────────────────────────────────────── */

function ctxWithNow(now: string, seqStart: number = 1) {
  let seq = seqStart;
  return { now: () => now, nextId: (p: string) => `nc_${p}_${seq++}` };
}

const TENANT = "tn-lumen";
const NOW = "2026-10-28T12:00:00Z";

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

function resolvedIncident(): NocturneIncident {
  return {
    id: "inc-1",
    tenantId: TENANT,
    serviceId: "svc-1",
    title: "Test",
    severity: "sev1",
    status: "resolved",
    triggeredAt: "2026-10-28T10:00:00Z",
    acknowledgedAt: "2026-10-28T10:04:00Z",
    acknowledgedBy: "u-ada",
    snoozedUntil: null,
    resolvedAt: "2026-10-28T10:35:00Z",
    resolvedBy: "u-ada",
    postmortemId: null,
    activeTierIndex: null,
    lastEscalatedAt: null,
    createdAt: "2026-10-28T10:00:00Z",
  };
}

function withResolved(): NocturneState {
  const s = baseState();
  s.incidents = [resolvedIncident()];
  return s;
}

/* ── createPostmortem ────────────────────────────────────────────── */

describe("createPostmortem", () => {
  test("creates a postmortem on a resolved incident + links the incident", () => {
    const s0 = withResolved();
    const r = createPostmortem(s0, "inc-1", "u-mira", {
      body: "A bad deploy flipped the retry budget.",
      actionItems: [
        { title: "Add a canary gate", assigneeId: "u-theo" },
        { title: "Document the retry semantics" },
      ],
    }, ctxWithNow(NOW, 50));
    expect("result" in r).toBe(true);
    const { postmortem, incident } = (r as { result: { postmortem: import("./types").NocturnePostmortem; incident: NocturneIncident } }).result;

    expect(postmortem.id).toBe("nc_pm_50");
    expect(postmortem.tenantId).toBe(TENANT);
    expect(postmortem.incidentId).toBe("inc-1");
    expect(postmortem.body).toBe("A bad deploy flipped the retry budget.");
    expect(postmortem.authorId).toBe("u-mira");
    expect(postmortem.createdAt).toBe(NOW);
    // The summary deltas are captured.
    expect(postmortem.summary.triggeredAt).toBe("2026-10-28T10:00:00Z");
    expect(postmortem.summary.acknowledgedAt).toBe("2026-10-28T10:04:00Z");
    expect(postmortem.summary.resolvedAt).toBe("2026-10-28T10:35:00Z");
    // Action items: sequential ids, done: false, unassigned → null.
    expect(postmortem.actionItems).toHaveLength(2);
    expect(postmortem.actionItems[0]).toEqual({
      id: "ai-1",
      title: "Add a canary gate",
      assigneeId: "u-theo",
      due: null,
      done: false,
      doneAt: null,
    });
    expect(postmortem.actionItems[1]).toEqual({
      id: "ai-2",
      title: "Document the retry semantics",
      assigneeId: null,
      due: null,
      done: false,
      doneAt: null,
    });
    // The incident row is linked.
    expect(incident.postmortemId).toBe("nc_pm_50");
    expect(r.state.postmortems).toHaveLength(1);
  });

  test("refuses a postmortem on a triggered incident (risk #12)", () => {
    const s0 = baseState();
    s0.incidents = [
      { ...resolvedIncident(), status: "triggered", resolvedAt: null, resolvedBy: null, acknowledgedAt: null, acknowledgedBy: null },
    ];
    const r = createPostmortem(s0, "inc-1", "u-mira", { body: "x" }, ctxWithNow(NOW, 50));
    expect("error" in r).toBe(true);
    expect((r as { error: string }).error).toMatch(/triggered/);
  });

  test("refuses a postmortem on an acknowledged incident", () => {
    const s0 = baseState();
    s0.incidents = [
      { ...resolvedIncident(), status: "acknowledged", resolvedAt: null, resolvedBy: null },
    ];
    const r = createPostmortem(s0, "inc-1", "u-mira", { body: "x" }, ctxWithNow(NOW, 50));
    expect((r as { error: string }).error).toMatch(/acknowledged/);
  });

  test("refuses a postmortem on a snoozed incident", () => {
    const s0 = baseState();
    s0.incidents = [
      {
        ...resolvedIncident(),
        status: "snoozed",
        resolvedAt: null,
        resolvedBy: null,
        snoozedUntil: "2026-10-28T14:00:00Z",
      },
    ];
    const r = createPostmortem(s0, "inc-1", "u-mira", { body: "x" }, ctxWithNow(NOW, 50));
    expect((r as { error: string }).error).toMatch(/snoozed/);
  });

  test("an unknown incident → error (route maps to 404)", () => {
    const s0 = baseState();
    const r = createPostmortem(s0, "inc-ghost", "u-mira", { body: "x" }, ctxWithNow(NOW, 50));
    expect((r as { error: string }).error).toMatch(/unknown incident/);
  });

  test("the prior snapshot's incident row is not mutated (copy-on-write)", () => {
    const s0 = withResolved();
    createPostmortem(s0, "inc-1", "u-mira", { body: "x" }, ctxWithNow(NOW, 50));
    expect(s0.incidents[0]!.postmortemId).toBeNull();
  });
});

/* ── postmortemDeltas (the ms-delta summary block) ──────────────── */

describe("postmortemDeltas", () => {
  test("computes the trigger → ack → resolve ms deltas", () => {
    const s = withResolved();
    const r = createPostmortem(s, "inc-1", "u-mira", { body: "x" }, ctxWithNow(NOW, 50));
    const pm = (r as { result: { postmortem: import("./types").NocturnePostmortem } }).result.postmortem;
    const d = postmortemDeltas(pm);
    // 10:00 → 10:04 = 4 min; 10:00 → 10:35 = 35 min; 10:04 → 10:35 = 31 min.
    expect(d.triggerToAckMs).toBe(4 * 60_000);
    expect(d.triggerToResolveMs).toBe(35 * 60_000);
    expect(d.ackToResolveMs).toBe(31 * 60_000);
  });

  test("a null acknowledgedAt yields null deltas around it", () => {
    const s = withResolved();
    s.incidents = [
      {
        ...resolvedIncident(),
        acknowledgedAt: null,
        acknowledgedBy: null,
      },
    ];
    const r = createPostmortem(s, "inc-1", "u-mira", { body: "x" }, ctxWithNow(NOW, 50));
    const pm = (r as { result: { postmortem: import("./types").NocturnePostmortem } }).result.postmortem;
    const d = postmortemDeltas(pm);
    expect(d.triggerToAckMs).toBeNull();
    expect(d.ackToResolveMs).toBeNull();
    expect(d.triggerToResolveMs).toBe(35 * 60_000);
  });
});

/* ── setActionItemState ───────────────────────────────────────────── */

describe("setActionItemState", () => {
  function withPostmortem(): NocturneState {
    const s = withResolved();
    const r = createPostmortem(s, "inc-1", "u-mira", {
      body: "x",
      actionItems: [
        { title: "A", assigneeId: "u-theo" },
        { title: "B" },
      ],
    }, ctxWithNow(NOW, 50));
    return (r as { state: NocturneState }).state;
  }

  test("flipping an item to done stamps doneAt with ctx.now() when omitted", () => {
    const s0 = withPostmortem();
    const r = setActionItemState(s0, "nc_pm_50", "ai-1", true, undefined, ctxWithNow("2026-10-28T13:00:00Z"));
    expect(r.result.ok).toBe(true);
    const ai = (r as { result: { postmortem: import("./types").NocturnePostmortem } }).result.postmortem.actionItems[0]!;
    expect(ai.done).toBe(true);
    expect(ai.doneAt).toBe("2026-10-28T13:00:00Z");
  });

  test("an explicit doneAt wins over the clock stamp", () => {
    const s0 = withPostmortem();
    const r = setActionItemState(s0, "nc_pm_50", "ai-1", true, "2026-10-28T12:30:00Z", ctxWithNow("2026-10-28T13:00:00Z"));
    const ai = (r as { result: { postmortem: import("./types").NocturnePostmortem } }).result.postmortem.actionItems[0]!;
    expect(ai.doneAt).toBe("2026-10-28T12:30:00Z");
  });

  test("flipping back to not-done clears doneAt", () => {
    const s0 = withPostmortem();
    const r1 = setActionItemState(s0, "nc_pm_50", "ai-2", true, undefined, ctxWithNow("2026-10-28T13:00:00Z"));
    const r2 = setActionItemState(
      (r1 as { state: NocturneState }).state,
      "nc_pm_50",
      "ai-2",
      false,
      null,
      ctxWithNow("2026-10-28T13:30:00Z"),
    );
    const ai = (r2 as { result: { postmortem: import("./types").NocturnePostmortem } }).result.postmortem.actionItems[1]!;
    expect(ai.done).toBe(false);
    expect(ai.doneAt).toBeNull();
  });

  test("the prior snapshot's postmortem row is not mutated (copy-on-write)", () => {
    const s0 = withPostmortem();
    const pmBefore = s0.postmortems[0]!;
    setActionItemState(s0, "nc_pm_50", "ai-1", true, undefined, ctxWithNow("2026-10-28T13:00:00Z"));
    expect(pmBefore.actionItems[0]!.done).toBe(false);
    expect(pmBefore.actionItems[0]!.doneAt).toBeNull();
  });

  test("an unknown postmortem id → 404-shape error", () => {
    const s0 = withPostmortem();
    const r = setActionItemState(s0, "nc_pm-ghost", "ai-1", true, undefined, ctxWithNow(NOW));
    expect(r.result.ok).toBe(false);
    expect((r.result as { error: string }).error).toMatch(/unknown postmortem/);
  });

  test("an unknown action item id → 404-shape error", () => {
    const s0 = withPostmortem();
    const r = setActionItemState(s0, "nc_pm_50", "ai-99", true, undefined, ctxWithNow(NOW));
    expect(r.result.ok).toBe(false);
    expect((r.result as { error: string }).error).toMatch(/unknown action item/);
  });
});
