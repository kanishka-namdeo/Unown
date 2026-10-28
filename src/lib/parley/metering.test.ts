import { describe, expect, test } from "bun:test";
import { canCreate, conversationsThisMonth, overage, perAgentLoad, seatsUsed } from "./metering";
import type { ParleyState, Tenant } from "./types";

const NOW = "2026-10-28T12:00:00Z";

function tenant(id: string, plan: "free" | "team" | "scale"): Tenant {
  return {
    id,
    slug: id,
    name: id,
    plan,
    slas: {
      firstResponseHours: { urgent: 1, high: 4, normal: 24, low: 72 },
      resolveHours: { urgent: 4, high: 24, normal: 72, low: 168 },
    },
    createdAt: "2026-01-01T00:00:00Z",
  };
}

/** A minimal state with N conversations created in the current month. */
function stateWith(n: number, tenantId: string, plan: "free" | "team" | "scale" = "free"): ParleyState {
  return {
    tenants: [tenant(tenantId, plan)],
    users: [],
    memberships: [],
    customers: [],
    conversations: Array.from({ length: n }, (_, i) => ({
      id: `cnv-${i}`,
      tenantId,
      customerId: "c1",
      subject: `s${i}`,
      status: "open" as const,
      priority: "normal" as const,
      assigneeId: null,
      tags: [],
      createdAt: "2026-10-15T00:00:00Z", // inside the current month (Oct 2026)
      firstRespondedAt: null,
      closedAt: null,
    })),
    messages: [],
    events: [],
    tags: [],
    canned: [],
    invites: [],
    sessions: [],
    audit: [],
  };
}

describe("conversationsThisMonth", () => {
  test("counts only conversations in the current calendar month", () => {
    const s = stateWith(3, "t1", "free");
    expect(conversationsThisMonth(s, "t1", NOW)).toBe(3);
  });

  test("excludes older-month conversations", () => {
    const s = stateWith(2, "t1", "free");
    s.conversations.push({
      id: "cnv-old",
      tenantId: "t1",
      customerId: "c1",
      subject: "old",
      status: "closed",
      priority: "low",
      assigneeId: null,
      tags: [],
      createdAt: "2026-09-30T00:00:00Z", // September
      firstRespondedAt: null,
      closedAt: null,
    });
    expect(conversationsThisMonth(s, "t1", NOW)).toBe(2);
  });

  test("is scoped to the tenant (other tenants' convos excluded)", () => {
    const s = stateWith(3, "t1", "free");
    s.conversations.push({
      id: "cnv-other",
      tenantId: "t2",
      customerId: "c1",
      subject: "x",
      status: "open",
      priority: "normal",
      assigneeId: null,
      tags: [],
      createdAt: "2026-10-20T00:00:00Z",
      firstRespondedAt: null,
      closedAt: null,
    });
    expect(conversationsThisMonth(s, "t1", NOW)).toBe(3);
  });
});

describe("overage", () => {
  test("47/50 free plan → near cap, not over", () => {
    const s = stateWith(47, "t-nw", "free");
    const o = overage(s, "t-nw", NOW);
    expect(o.convos.used).toBe(47);
    expect(o.convos.cap).toBe(50);
    expect(o.convos.over).toBe(false);
  });

  test("51/50 free plan → over", () => {
    const s = stateWith(51, "t-nw", "free");
    const o = overage(s, "t-nw", NOW);
    expect(o.convos.over).toBe(true);
  });

  test("seats over-cap is detected", () => {
    const s = stateWith(0, "t-nw", "free");
    // 4 memberships > 3 seats cap
    for (let i = 0; i < 4; i++)
      s.memberships.push({ id: `mem-${i}`, tenantId: "t-nw", userId: `u${i}`, role: "agent" });
    const o = overage(s, "t-nw", NOW);
    expect(o.seats.used).toBe(4);
    expect(o.seats.cap).toBe(3);
    expect(o.seats.over).toBe(true);
  });

  test("scale plan's high caps are reflected", () => {
    const s = stateWith(0, "t-scale", "scale");
    const o = overage(s, "t-scale", NOW);
    expect(o.convos.cap).toBe(10_000);
    expect(o.seats.cap).toBe(50);
  });
});

describe("canCreate", () => {
  test("true below the cap", () => {
    expect(canCreate(stateWith(49, "t1"), "t1", NOW)).toBe(true);
  });

  test("false at the cap (50/50 free)", () => {
    expect(canCreate(stateWith(50, "t1"), "t1", NOW)).toBe(false);
  });

  test("team plan cap is 500", () => {
    expect(canCreate(stateWith(500, "t-team", "team"), "t-team", NOW)).toBe(false);
    expect(canCreate(stateWith(499, "t-team", "team"), "t-team", NOW)).toBe(true);
  });
});

describe("perAgentLoad", () => {
  test("counts open conversations per assignee", () => {
    const s = stateWith(0, "t1");
    const mk = (id: string, assigneeId: string | null, status: "open" | "closed") => ({
      id,
      tenantId: "t1",
      customerId: "c1",
      subject: "s",
      status,
      priority: "normal" as const,
      assigneeId,
      tags: [],
      createdAt: "2026-10-15T00:00:00Z",
      firstRespondedAt: null,
      closedAt: null,
    });
    s.conversations = [
      mk("a", "u-ada", "open"),
      mk("b", "u-ada", "open"),
      mk("c", "u-theo", "open"),
      mk("d", null, "open"),
      mk("e", "u-ada", "closed"), // closed → not counted
    ];
    const load = perAgentLoad(s, "t1");
    expect(load["u-ada"]).toBe(2);
    expect(load["u-theo"]).toBe(1);
    expect(load["__unassigned"]).toBe(1);
  });
});
