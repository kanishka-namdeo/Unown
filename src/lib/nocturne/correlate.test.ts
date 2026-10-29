/**
 * Tests for the Nocturne correlation engine (plan §4.2 + §5.1
 * `correlate.test.ts` — the ~15-test lane).
 *
 * Pins:
 *  - a standalone alert on the same service + severity as EXACTLY
 *    one open incident (triggered | acknowledged) within
 *    CORRELATION_WINDOW_MS → correlated (incidentId set,
 *    timeline event appended);
 *  - no open incident → standalone (incidentId stays null,
 *    correlated: false);
 *  - two open incidents on the same service + severity → no
 *    correlation (ambiguous → standalone);
 *  - the correlation window: 5 minutes from triggeredAt;
 *  - a RESOLVED incident never correlates (only open ones);
 *  - a SNOOZED incident is NOT "open" for correlation purposes;
 *  - an alert that already has an incidentId is returned as-is
 *    (correlated: false, no new timeline event).
 */

import { describe, expect, test } from "bun:test";
import { CORRELATION_WINDOW_MS, correlate } from "./correlate";
import type { NocturneAlert, NocturneIncident, NocturneState } from "./types";

/* ── helpers ─────────────────────────────────────────────────────── */

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

function ctxWithNow(now: string, seqStart: number = 1) {
  let seq = seqStart;
  return { now: () => now, nextId: (p: string) => `nc_${p}_${seq++}` };
}

const NOW = "2026-10-28T12:00:00Z";
const TENANT = "tn-lumen";
const SERVICE = "svc-payments";
const TRIGGER = "2026-10-28T11:59:00Z";

function incidentRow(
  id: string,
  status: NocturneIncident["status"],
  over: Partial<NocturneIncident> = {},
): NocturneIncident {
  return {
    id,
    tenantId: TENANT,
    serviceId: SERVICE,
    title: "Test incident",
    severity: "sev1",
    status,
    triggeredAt: TRIGGER,
    acknowledgedAt: status === "acknowledged" ? "2026-10-28T11:59:05Z" : null,
    acknowledgedBy: status === "acknowledged" ? "u-1" : null,
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

function alertRow(id: string, firedAt: string, incidentId: string | null): NocturneAlert {
  return {
    id,
    tenantId: TENANT,
    serviceId: SERVICE,
    dedupKey: "key-1",
    title: "Test alert",
    body: "body",
    severity: "sev1",
    firedAt,
    lastSeenAt: firedAt,
    count: 1,
    incidentId,
    createdAt: firedAt,
  };
}

/* ── correlation window constant ─────────────────────────────────── */

describe("the correlation window constant", () => {
  test("CORRELATION_WINDOW_MS is 5 minutes", () => {
    expect(CORRELATION_WINDOW_MS).toBe(3_600_000);
  });
});

/* ── basic correlation ───────────────────────────────────────────── */

describe("correlation into an open incident", () => {
  test("a standalone alert within the window of the ONLY open incident → correlated", () => {
    const s0 = baseState();
    s0.incidents = [incidentRow("inc-1", "triggered")];
    s0.alerts = [alertRow("al-1", "2026-10-28T11:59:30Z", null)];

    const r = correlate(s0, "al-1", ctxWithNow(NOW, 10));
    expect(r.result.correlated).toBe(true);
    expect(r.result.incident?.id).toBe("inc-1");
    expect(r.state.alerts[0]!.incidentId).toBe("inc-1");
  });

  test("an acknowledged incident is still OPEN for correlation", () => {
    const s0 = baseState();
    s0.incidents = [incidentRow("inc-1", "acknowledged")];
    s0.alerts = [alertRow("al-1", "2026-10-28T11:59:30Z", null)];

    const r = correlate(s0, "al-1", ctxWithNow(NOW, 10));
    expect(r.result.correlated).toBe(true);
  });

  test("the alert gets a timeline event of kind alert_correlated", () => {
    const s0 = baseState();
    s0.incidents = [incidentRow("inc-1", "triggered")];
    s0.alerts = [alertRow("al-1", "2026-10-28T11:59:30Z", null)];

    const r = correlate(s0, "al-1", ctxWithNow(NOW, 10));
    const evt = r.state.timeline[r.state.timeline.length - 1]!;
    expect(evt.kind).toBe("alert_correlated");
    expect(evt.incidentId).toBe("inc-1");
    expect(evt.meta).toEqual({ alertId: "al-1" });
  });

  test("the input state's timeline is not mutated (copy-on-write)", () => {
    const s0 = baseState();
    s0.incidents = [incidentRow("inc-1", "triggered")];
    s0.alerts = [alertRow("al-1", "2026-10-28T11:59:30Z", null)];
    const timelineBefore = s0.timeline;

    const r = correlate(s0, "al-1", ctxWithNow(NOW, 10));
    expect(r.state.timeline).not.toBe(timelineBefore);
    expect(timelineBefore).toHaveLength(0);
  });
});

/* ── no correlation cases ────────────────────────────────────────── */

describe("no correlation (standalone stays standalone)", () => {
  test("no open incident on the service → standalone", () => {
    const s0 = baseState();
    s0.alerts = [alertRow("al-1", "2026-10-28T11:59:30Z", null)];

    const r = correlate(s0, "al-1", ctxWithNow(NOW));
    expect(r.result.correlated).toBe(false);
    expect(r.result.incident).toBeNull();
    expect(r.state.alerts[0]!.incidentId).toBeNull();
  });

  test("two open incidents on the same service + severity → no correlation", () => {
    const s0 = baseState();
    s0.incidents = [
      incidentRow("inc-1", "triggered"),
      incidentRow("inc-2", "triggered", { triggeredAt: "2026-10-28T11:58:00Z" }),
    ];
    s0.alerts = [alertRow("al-1", "2026-10-28T11:59:30Z", null)];

    const r = correlate(s0, "al-1", ctxWithNow(NOW, 10));
    expect(r.result.correlated).toBe(false);
    expect(r.state.alerts[0]!.incidentId).toBeNull();
  });

  test("a RESOLVED incident never correlates", () => {
    const s0 = baseState();
    s0.incidents = [
      incidentRow("inc-1", "resolved", {
        resolvedAt: "2026-10-28T12:00:00Z",
        resolvedBy: "u-1",
        activeTierIndex: null,
      }),
    ];
    s0.alerts = [alertRow("al-1", "2026-10-28T11:59:30Z", null)];

    const r = correlate(s0, "al-1", ctxWithNow(NOW, 10));
    expect(r.result.correlated).toBe(false);
  });

  test("a SNOOZED incident is NOT open for correlation", () => {
    const s0 = baseState();
    s0.incidents = [
      incidentRow("inc-1", "snoozed", {
        acknowledgedAt: "2026-10-28T11:59:05Z",
        acknowledgedBy: "u-1",
        snoozedUntil: "2026-10-28T13:00:00Z",
      }),
    ];
    s0.alerts = [alertRow("al-1", "2026-10-28T11:59:30Z", null)];

    const r = correlate(s0, "al-1", ctxWithNow(NOW, 10));
    expect(r.result.correlated).toBe(false);
  });

  test("a different severity never correlates", () => {
    const s0 = baseState();
    s0.incidents = [incidentRow("inc-1", "triggered", { severity: "sev2" })];
    s0.alerts = [alertRow("al-1", "2026-10-28T11:59:30Z", null)]; // alert is sev1

    const r = correlate(s0, "al-1", ctxWithNow(NOW, 10));
    expect(r.result.correlated).toBe(false);
  });

  test("a different serviceId never correlates", () => {
    const s0 = baseState();
    s0.incidents = [incidentRow("inc-1", "triggered", { serviceId: "svc-other" })];
    s0.alerts = [alertRow("al-1", "2026-10-28T11:59:30Z", null)];

    const r = correlate(s0, "al-1", ctxWithNow(NOW, 10));
    expect(r.result.correlated).toBe(false);
  });
});

/* ── the correlation window boundary ─────────────────────────────── */

describe("the correlation window boundary", () => {
  test("an alert within CORRELATION_WINDOW_MS (3_600_000 ms = 1 hour) of triggeredAt is correlated", () => {
    const s0 = baseState();
    s0.incidents = [incidentRow("inc-1", "triggered")]; // triggeredAt = 11:59:00
    // 5 minutes after the trigger → well inside the 1-hour window.
    s0.alerts = [alertRow("al-1", "2026-10-28T12:04:00Z", null)];
    const r = correlate(s0, "al-1", ctxWithNow(NOW, 10));
    expect(r.result.correlated).toBe(true);
  });

  test("an alert exactly CORRELATION_WINDOW_MS (3_600_000 ms) from triggeredAt is NOT correlated (strict < boundary)", () => {
    const s0 = baseState();
    s0.incidents = [incidentRow("inc-1", "triggered")]; // triggeredAt = 11:59:00
    // Exactly 1 hour after the trigger → the boundary instant. The
    // plan's rule is `(firedAt - triggeredAt) < CORRELATION_WINDOW_MS`,
    // so an alert at exactly 3_600_000 ms does NOT correlate.
    s0.alerts = [alertRow("al-1", "2026-10-28T12:59:00Z", null)];
    const r = correlate(s0, "al-1", ctxWithNow(NOW, 10));
    expect(r.result.correlated).toBe(false);
  });

  test("an alert 1 ms inside the CORRELATION_WINDOW_MS boundary IS correlated", () => {
    const s0 = baseState();
    s0.incidents = [incidentRow("inc-1", "triggered")]; // triggeredAt = 11:59:00
    // 59:59 after the trigger → 3_599_000 ms, just inside the boundary.
    s0.alerts = [alertRow("al-1", "2026-10-28T12:58:59Z", null)];
    const r = correlate(s0, "al-1", ctxWithNow(NOW, 10));
    expect(r.result.correlated).toBe(true);
  });

  test("an alert 4 minutes 59 seconds from triggeredAt IS correlated", () => {
    const s0 = baseState();
    s0.incidents = [incidentRow("inc-1", "triggered")];
    s0.alerts = [alertRow("al-1", "2026-10-28T12:03:59Z", null)];

    const r = correlate(s0, "al-1", ctxWithNow(NOW, 10));
    expect(r.result.correlated).toBe(true);
  });

  test("an alert BEFORE the incident's triggeredAt within the window is also correlated (symmetric)", () => {
    const s0 = baseState();
    s0.incidents = [incidentRow("inc-1", "triggered", { triggeredAt: "2026-10-28T11:59:00Z" })];
    s0.alerts = [alertRow("al-1", "2026-10-28T11:57:30Z", null)]; // 90s before

    const r = correlate(s0, "al-1", ctxWithNow(NOW, 10));
    expect(r.result.correlated).toBe(true);
  });
});

/* ── already-linked alerts ───────────────────────────────────────── */

describe("already-linked alerts", () => {
  test("an alert that already has an incidentId returns it, correlated: false", () => {
    const s0 = baseState();
    s0.incidents = [incidentRow("inc-1", "triggered")];
    s0.alerts = [alertRow("al-1", "2026-10-28T11:59:30Z", "inc-1")];

    const r = correlate(s0, "al-1", ctxWithNow(NOW, 10));
    expect(r.result.correlated).toBe(false);
    expect(r.result.incident?.id).toBe("inc-1");
    // No new timeline event
    expect(r.state.timeline).toHaveLength(0);
  });
});

/* ── cross-tenant isolation ──────────────────────────────────────── */

describe("cross-tenant isolation", () => {
  test("an alert from tenant A never correlates into tenant B's incident", () => {
    const s0 = baseState();
    s0.incidents = [incidentRow("inc-1", "triggered", { tenantId: "tn-other" })];
    s0.alerts = [alertRow("al-1", "2026-10-28T11:59:30Z", null)];

    const r = correlate(s0, "al-1", ctxWithNow(NOW, 10));
    expect(r.result.correlated).toBe(false);
  });
});

/* ── unknown alert id ────────────────────────────────────────────── */

describe("unknown alert id", () => {
  test("correlating an unknown alert id is a no-op (defensive)", () => {
    const s0 = baseState();
    s0.incidents = [incidentRow("inc-1", "triggered")];

    const r = correlate(s0, "al-ghost", ctxWithNow(NOW, 10));
    expect(r.result.correlated).toBe(false);
    expect(r.state).toBe(s0);
  });
});
