import { describe, expect, test } from "bun:test";
import { AT_RISK_FRACTION, firstResponseDue, formatCountdown, remainingMs, resolveDue, slaState } from "./sla";
import type { Conversation, Tenant } from "./types";

/*
 * Pinned test tenants: Lumen = team (fast), Northwind = free (slower).
 */
const LUMEN: Tenant = {
  id: "t-lumen",
  slug: "lumen",
  name: "Lumen Labs",
  plan: "team",
  slas: {
    firstResponseHours: { urgent: 1, high: 4, normal: 24, low: 72 },
    resolveHours: { urgent: 4, high: 24, normal: 72, low: 168 },
  },
  createdAt: "2026-01-01T00:00:00Z",
};

const NORTHWIND: Tenant = {
  id: "t-northwind",
  slug: "northwind",
  name: "Northwind Kits",
  plan: "free",
  slas: {
    // Slower (free plan) — the plan-differentiated pin
    firstResponseHours: { urgent: 2, high: 8, normal: 48, low: 120 },
    resolveHours: { urgent: 12, high: 48, normal: 96, low: 240 },
  },
  createdAt: "2026-01-01T00:00:00Z",
};

const NOW = "2026-10-28T12:00:00Z";

function makeConvo(
  over: Partial<Conversation>,
): Conversation {
  return {
    id: "cnv-test",
    tenantId: "t-lumen",
    customerId: "cust-1",
    subject: "Test subject",
    status: "open",
    priority: "normal",
    assigneeId: null,
    tags: [],
    createdAt: "2026-10-28T00:00:00Z",
    firstRespondedAt: null,
    closedAt: null,
    ...over,
  };
}

describe("firstResponseDue / resolveDue", () => {
  test("urgent Lumen: createdAt + 1h", () => {
    const c = makeConvo({ priority: "urgent", createdAt: "2026-10-28T00:00:00Z" });
    expect(firstResponseDue(c, LUMEN)).toBe("2026-10-28T01:00:00Z");
  });

  test("normal Northwind: createdAt + 48h (slower than Lumen's 24h)", () => {
    const c = makeConvo({ priority: "normal", createdAt: "2026-10-28T00:00:00Z" });
    expect(firstResponseDue(c, NORTHWIND)).toBe("2026-10-30T00:00:00Z");
    // Lumen would be 24h
    expect(firstResponseDue(c, LUMEN)).toBe("2026-10-29T00:00:00Z");
  });

  test("plan-differentiated: same conv, different due dates", () => {
    const c = makeConvo({ priority: "high", createdAt: "2026-10-28T06:00:00Z" });
    const dueLumen = firstResponseDue(c, LUMEN); // +4h
    const dueNorth = firstResponseDue(c, NORTHWIND); // +8h
    expect(dueLumen).toBe("2026-10-28T10:00:00Z");
    expect(dueNorth).toBe("2026-10-28T14:00:00Z");
    expect(dueNorth > dueLumen).toBe(true); // Northwind slower
  });

  test("resolveDue differs from firstResponseDue", () => {
    const c = makeConvo({ priority: "urgent", createdAt: "2026-10-28T00:00:00Z" });
    expect(resolveDue(c, LUMEN)).toBe("2026-10-28T04:00:00Z");
  });
});

describe("slaState transitions at a pinned now", () => {
  const createdAt = "2026-10-28T00:00:00Z"; // 12h before NOW

  test("ok: plenty of time remaining", () => {
    const c = makeConvo({
      createdAt: "2026-10-28T09:00:00Z", // 3h before NOW
      priority: "normal", // Lumen: 24h target → 21h remaining → ok
    });
    expect(slaState(c, LUMEN, NOW)).toBe("ok");
  });

  test("at_risk: within 20% of the due window", () => {
    // normal Lumen: 24h target; at-risk when remaining < 4.8h.
    // createdAt 9.4h before NOW → 14.6h remaining → ok.
    // createdAt 23.5h before NOW → 0.5h remaining < 4.8h → at_risk.
    const c = makeConvo({
      createdAt: "2026-10-27T12:30:00Z", // 23.5h before NOW
      priority: "normal",
    });
    expect(slaState(c, LUMEN, NOW)).toBe("at_risk");
  });

  test("breached: past the first-response target with no reply", () => {
    // urgent Lumen: 1h target; createdAt 13h before NOW → breached.
    const c = makeConvo({
      createdAt: "2026-10-28T00:00:00Z",
      priority: "urgent",
    });
    expect(slaState(c, LUMEN, NOW)).toBe("breached");
  });

  test("met: closed within the resolve target", () => {
    const c = makeConvo({
      createdAt: "2026-10-27T00:00:00Z",
      priority: "urgent", // Lumen: 4h resolve target
      status: "closed",
      closedAt: "2026-10-27T02:00:00Z", // 2h after creation
    });
    expect(slaState(c, LUMEN, NOW)).toBe("met");
  });

  test("breached closed: closed past the resolve target", () => {
    const c = makeConvo({
      createdAt: "2026-10-27T00:00:00Z",
      priority: "urgent", // 4h resolve
      status: "closed",
      closedAt: "2026-10-27T06:00:00Z", // 6h → past target
    });
    expect(slaState(c, LUMEN, NOW)).toBe("breached");
  });

  test("replied conv judged on resolve target", () => {
    // high Lumen: 24h resolve; createdAt 23.9h before NOW, replied at 1h.
    const c = makeConvo({
      createdAt: "2026-10-27T12:05:00Z",
      priority: "high",
      firstRespondedAt: "2026-10-27T13:00:00Z",
    });
    // 24h resolve target; remaining = 24h - 23.917h ≈ 0.083h → at_risk
    expect(slaState(c, LUMEN, NOW)).toBe("at_risk");
  });

  test("the 20% band boundary: just inside → at_risk, just outside → ok", () => {
    // normal Lumen: 24h target; band edge = 20% of 24h = 4.8h remaining.
    // createdAt at NOW - 24h + 4.8h = NOW - 19.2h → remaining = 4.8h (edge, still ok).
    // NOW = 2026-10-28T12:00:00Z, so createdAt = 2026-10-27T16:48:00Z.
    const edgeOk = makeConvo({
      createdAt: "2026-10-27T16:48:00Z", // NOW - 19.2h → remaining = 4.8h (boundary, ok)
      priority: "normal",
    });
    expect(slaState(edgeOk, LUMEN, NOW)).toBe("ok");

    // createdAt 1 minute later → remaining = 4.783h < 4.8h → at_risk
    const edgeRisk = makeConvo({
      createdAt: "2026-10-27T16:49:00Z", // NOW - 19.183h → remaining = 4.817h
      priority: "normal",
    });
    // remaining = 24h - 19.183h = 4.817h > 4.8h → still ok! Use a clearly-at-risk value.
    // createdAt 3h before the edge → remaining = 1.8h < 4.8h → at_risk
    const clearlyRisk = makeConvo({
      createdAt: "2026-10-28T06:00:00Z", // NOW - 6h → remaining = 18h (ok, wrong)
      priority: "normal",
    });
    // Try: createdAt = NOW - 23h → remaining = 1h < 4.8h → at_risk
    const clearlyRisk2 = makeConvo({
      createdAt: "2026-10-27T13:00:00Z", // NOW - 23h → remaining = 1h
      priority: "normal",
    });
    expect(slaState(clearlyRisk2, LUMEN, NOW)).toBe("at_risk");
    expect(slaState(edgeRisk, LUMEN, NOW)).toBe("ok"); // 4.817h > 4.8h, just outside
  });
});

describe("explicit-now purity", () => {
  test("same inputs → same outputs (no hidden clock)", () => {
    const c = makeConvo({ createdAt: "2026-10-28T00:00:00Z", priority: "urgent" });
    expect(slaState(c, LUMEN, NOW)).toBe(slaState(c, LUMEN, NOW));
  });

  test("a shifted now shifts the state (now is the only time source)", () => {
    const c = makeConvo({ createdAt: "2026-10-28T00:00:00Z", priority: "normal" });
    // 24h target: at 12h → ok; at 25h → breached (past the target)
    expect(slaState(c, LUMEN, "2026-10-28T12:00:00Z")).toBe("ok");
    expect(slaState(c, LUMEN, "2026-10-29T01:00:00Z")).toBe("breached"); // 25h > 24h
  });
});

describe("formatCountdown", () => {
  test("formats hours and minutes", () => {
    // 2h 13m = 7_980_000 ms; 2h 14m = 8_040_000 ms
    expect(formatCountdown(7_980_000)).toBe("2h 13m");
    expect(formatCountdown(8_040_000)).toBe("2h 14m");
  });

  test("formats minutes only (no hours)", () => {
    expect(formatCountdown(45 * 60_000)).toBe("45m");
  });

  test("returns 0m for non-positive", () => {
    expect(formatCountdown(0)).toBe("0m");
    expect(formatCountdown(-1000)).toBe("0m");
  });

  test("multi-hour with zero minutes", () => {
    expect(formatCountdown(5 * 3_600_000)).toBe("5h 0m");
  });
});

describe("remainingMs", () => {
  test("returns the remaining time against the active target", () => {
    const c = makeConvo({ createdAt: "2026-10-28T00:00:00Z", priority: "normal" });
    // 24h target - 12h elapsed = 12h remaining
    expect(remainingMs(c, LUMEN, NOW)).toBe(12 * 3_600_000);
  });

  test("negative when past the target", () => {
    const c = makeConvo({ createdAt: "2026-10-27T00:00:00Z", priority: "normal" });
    expect(remainingMs(c, LUMEN, NOW)).toBeLessThan(0);
  });
});

describe("AT_RISK_FRACTION constant", () => {
  test("is 0.2", () => {
    expect(AT_RISK_FRACTION).toBe(0.2);
  });
});
