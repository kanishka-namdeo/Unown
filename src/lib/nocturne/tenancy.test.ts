import { describe, expect, test } from "bun:test";
import {
  assertTenant,
  crossTenant,
  makeCtx,
  NoTenantContextError,
} from "./tenancy";

describe("assertTenant", () => {
  test("throws NoTenantContextError when ctx is null", () => {
    expect(() => assertTenant(null)).toThrow(NoTenantContextError);
  });

  test("throws when ctx is undefined", () => {
    expect(() => assertTenant(undefined)).toThrow(NoTenantContextError);
  });

  test("throws when ctx is empty object", () => {
    expect(() => assertTenant({} as never)).toThrow(NoTenantContextError);
  });

  test("throws when tenantId is empty string", () => {
    expect(() =>
      assertTenant({ tenantId: "", actor: { userId: "u1", role: "owner" } }),
    ).toThrow(NoTenantContextError);
  });

  test("throws when tenantId is undefined", () => {
    expect(() =>
      assertTenant({ tenantId: undefined as never, actor: { userId: "u1", role: "owner" } }),
    ).toThrow(NoTenantContextError);
  });

  test("throws when actor is missing", () => {
    expect(() => assertTenant({ tenantId: "t1" } as never)).toThrow(NoTenantContextError);
  });

  test("throws when actor has no userId", () => {
    expect(() =>
      assertTenant({ tenantId: "t1", actor: { userId: "", role: "owner" } }),
    ).toThrow(NoTenantContextError);
  });

  test("throws when actor is null", () => {
    expect(() =>
      assertTenant({ tenantId: "t1", actor: null as never }),
    ).toThrow(NoTenantContextError);
  });

  test("returns the ctx unchanged when valid", () => {
    const ctx = makeCtx("tn-lumen", "u1", "owner");
    expect(assertTenant(ctx)).toBe(ctx);
  });

  test("the error has a stable name (catchable by class identity)", () => {
    try {
      assertTenant(null);
    } catch (e) {
      expect((e as Error).name).toBe("NoTenantContextError");
      expect(e).toBeInstanceOf(NoTenantContextError);
    }
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

  test("a cross-tenant entity is NEVER read through ctx (the 404 rung)", () => {
    const ctx = makeCtx("tn-lumen", "u1", "owner");
    const foreign = { tenantId: "tn-northwind", name: "X" };
    expect(crossTenant(foreign, ctx)).toBe(true);
  });

  test("the check is exact equality (no case-insensitivity)", () => {
    const ctx = makeCtx("TN-LUMEN", "u1", "viewer");
    expect(crossTenant({ tenantId: "tn-lumen" }, ctx)).toBe(true);
  });
});

describe("makeCtx", () => {
  test("builds a context with the given fields", () => {
    const ctx = makeCtx("tn-lumen", "u-ada", "responder");
    expect(ctx.tenantId).toBe("tn-lumen");
    expect(ctx.actor.userId).toBe("u-ada");
    expect(ctx.actor.role).toBe("responder");
  });

  test("each of the four roles is carried verbatim", () => {
    for (const role of ["owner", "admin", "responder", "viewer"] as const) {
      expect(makeCtx("t", "u", role).actor.role).toBe(role);
    }
  });

  test("two makeCtx calls with the same args deep-equal", () => {
    expect(makeCtx("t", "u", "owner")).toEqual(makeCtx("t", "u", "owner"));
  });
});
