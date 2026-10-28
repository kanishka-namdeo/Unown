import { describe, expect, test } from "bun:test";
import {
  assertTenant,
  crossTenant,
  makeCtx,
  NoTenantContextError,
} from "./tenancy";

describe("tenancy", () => {
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
  });

  describe("makeCtx", () => {
    test("builds a context with the given fields", () => {
      const ctx = makeCtx("northwind", "u-kai", "agent");
      expect(ctx.tenantId).toBe("northwind");
      expect(ctx.actor.userId).toBe("u-kai");
      expect(ctx.actor.role).toBe("agent");
    });
  });
});
