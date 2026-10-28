import { describe, expect, test } from "bun:test";
import { computeAnalytics, formatDurationMs } from "./analytics";
import type { Conversation, ParleyState } from "./types";

function emptyState(): ParleyState {
  return {
    tenants: [],
    users: [],
    memberships: [],
    customers: [],
    conversations: [],
    messages: [],
    events: [],
    tags: [],
    canned: [],
    invites: [],
    sessions: [],
    audit: [],
  };
}

function convo(over: Partial<Conversation>): Conversation {
  return {
    id: "cnv-x",
    tenantId: "t1",
    customerId: "c1",
    subject: "s",
    status: "open",
    priority: "normal",
    assigneeId: null,
    tags: [],
    createdAt: "2026-10-20T00:00:00Z",
    firstRespondedAt: null,
    closedAt: null,
    ...over,
  };
}

describe("computeAnalytics", () => {
  test("empty tenant → zeroed analytics, no NaN", () => {
    const s = emptyState();
    const a = computeAnalytics(s, "t1", "2026-10-28T12:00:00Z");
    expect(a.volumeByStatus).toEqual({ open: 0, pending: 0, closed: 0 });
    expect(a.medianFirstResponseMs).toBe(0);
    expect(a.resolutionRate).toBe(0);
    expect(a.perAgentLoad).toEqual({});
  });

  test("volumeByStatus counts each status", () => {
    const s = emptyState();
    s.conversations = [
      convo({ id: "1", status: "open" }),
      convo({ id: "2", status: "open" }),
      convo({ id: "3", status: "pending" }),
      convo({ id: "4", status: "closed" }),
      convo({ id: "5", tenantId: "t2", status: "open" }), // other tenant
    ];
    const a = computeAnalytics(s, "t1", "2026-10-28T12:00:00Z");
    expect(a.volumeByStatus).toEqual({ open: 2, pending: 1, closed: 1 });
  });

  test("median first-response over the replied convos (odd median)", () => {
    const s = emptyState();
    s.conversations = [
      convo({ id: "1", firstRespondedAt: "2026-10-20T01:00:00Z" }), // 1h
      convo({ id: "2", firstRespondedAt: "2026-10-20T03:00:00Z" }), // 3h
      convo({ id: "3", firstRespondedAt: "2026-10-20T02:00:00Z" }), // 2h
      convo({ id: "4" }), // no reply
    ];
    const a = computeAnalytics(s, "t1", "2026-10-28T12:00:00Z");
    expect(a.medianFirstResponseMs).toBe(2 * 3_600_000);
    // 1 of 3 replied convos counts; 4th has no reply
    expect(a.resolutionRate).toBeCloseTo(3 / 4);
  });

  test("median with an even count averages the middle two", () => {
    const s = emptyState();
    s.conversations = [
      convo({ id: "1", firstRespondedAt: "2026-10-20T01:00:00Z" }), // 1h
      convo({ id: "2", firstRespondedAt: "2026-10-20T05:00:00Z" }), // 5h
    ];
    const a = computeAnalytics(s, "t1", "2026-10-28T12:00:00Z");
    expect(a.medianFirstResponseMs).toBe(3 * 3_600_000); // (1h + 5h) / 2
  });

  test("perAgentLoad counts only open convos, with the unassigned key", () => {
    const s = emptyState();
    s.conversations = [
      convo({ id: "1", assigneeId: "u-ada", status: "open" }),
      convo({ id: "2", assigneeId: "u-ada", status: "open" }),
      convo({ id: "3", assigneeId: "u-theo", status: "closed" }), // closed → not counted
      convo({ id: "4", assigneeId: null, status: "open" }),
    ];
    const a = computeAnalytics(s, "t1", "2026-10-28T12:00:00Z");
    expect(a.perAgentLoad).toEqual({ "u-ada": 2, __unassigned: 1 });
  });

  test("cross-tenant convos are excluded", () => {
    const s = emptyState();
    s.conversations = [
      convo({ id: "1", status: "open" }),
      convo({ id: "2", tenantId: "t2", status: "open" }),
    ];
    const a = computeAnalytics(s, "t1", "2026-10-28T12:00:00Z");
    expect(a.volumeByStatus.open).toBe(1);
  });
});

describe("formatDurationMs", () => {
  test("formats h + m", () => {
    expect(formatDurationMs(7_980_000)).toBe("2h 13m");
  });
  test("minutes only below an hour", () => {
    expect(formatDurationMs(45 * 60_000)).toBe("45m");
  });
  test("non-positive → 0m", () => {
    expect(formatDurationMs(0)).toBe("0m");
    expect(formatDurationMs(-5)).toBe("0m");
  });
});
