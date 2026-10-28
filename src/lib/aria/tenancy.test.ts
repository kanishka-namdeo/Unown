import { describe, expect, test } from "bun:test";
import {
  assertTenant,
  crossTenant,
  makeCtx,
  NoTenantContextError,
  teamOf,
} from "./tenancy";

describe("assertTenant", () => {
  test("throws NoTenantContextError when ctx is null", () => {
    expect(() => assertTenant(null)).toThrow(NoTenantContextError);
  });

  test("throws when ctx is undefined", () => {
    expect(() => assertTenant(undefined)).toThrow(NoTenantContextError);
  });

  test("throws when ctx has no tenantId", () => {
    expect(() =>
      assertTenant({ tenantId: "", actor: { userId: "u1", role: "owner" } }),
    ).toThrow(NoTenantContextError);
  });

  test("throws when ctx has no actor", () => {
    expect(() => assertTenant({ tenantId: "t1" } as never)).toThrow(NoTenantContextError);
  });

  test("throws when the actor has no userId", () => {
    expect(() =>
      assertTenant({ tenantId: "t1", actor: { userId: "", role: "owner" } }),
    ).toThrow(NoTenantContextError);
  });

  test("returns the ctx when valid", () => {
    const ctx = makeCtx("t1", "u1", "owner");
    expect(assertTenant(ctx)).toBe(ctx);
  });
});

describe("crossTenant", () => {
  test("same tenant → false", () => {
    const ctx = makeCtx("t1", "u1", "owner");
    expect(crossTenant({ tenantId: "t1" }, ctx)).toBe(false);
  });

  test("different tenant → true", () => {
    const ctx = makeCtx("t1", "u1", "owner");
    expect(crossTenant({ tenantId: "t2" }, ctx)).toBe(true);
  });

  test("works with any entity shape carrying a tenantId", () => {
    const ctx = makeCtx("a", "u", "rep");
    expect(crossTenant({ tenantId: "a", extra: 1 } as { tenantId: string }, ctx)).toBe(false);
  });
});

describe("makeCtx", () => {
  test("builds a context with the given fields", () => {
    const ctx = makeCtx("tn-northwind", "u-kai", "manager");
    expect(ctx.tenantId).toBe("tn-northwind");
    expect(ctx.actor.userId).toBe("u-kai");
    expect(ctx.actor.role).toBe("manager");
  });
});

describe("teamOf", () => {
  const state = {
    tenants: [
      {
        id: "t1",
        slug: "t1",
        name: "T1",
        plan: "starter" as const,
        quotas: {},
        manages: { mgr1: ["rep-a", "rep-b"] },
        leadSlaMinutes: { low: 0, normal: 0, high: 0, urgent: 0 },
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "t2",
        slug: "t2",
        name: "T2",
        plan: "enterprise" as const,
        quotas: {},
        manages: {} as Record<string, string[]>,
        leadSlaMinutes: { low: 0, normal: 0, high: 0, urgent: 0 },
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
  };

  test("returns the managed rep ids for a known manager", () => {
    expect(teamOf(state, "t1", "mgr1")).toEqual(["rep-a", "rep-b"]);
  });

  test("returns [] for an unknown manager id", () => {
    expect(teamOf(state, "t1", "nobody")).toEqual([]);
  });

  test("returns [] for an unknown tenant", () => {
    expect(teamOf(state, "no-such-tenant", "mgr1")).toEqual([]);
  });

  test("returns [] when the tenant manages nobody", () => {
    expect(teamOf(state, "t2", "mgr1")).toEqual([]);
  });
});
