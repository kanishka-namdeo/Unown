import { describe, expect, test } from "bun:test";
import {
  AS_OF,
  PLAN_CAPS,
  PLAN_SEATS,
  PRIORITIES,
  ROLES,
  STATUSES,
  type Plan,
  type Priority,
  type Role,
} from "./types";

/*
 * Shape/union sanity pins. The 4-role × 10-action matrix table lives
 * in rbac.test.ts; everything here is pinned by the other modules'
 * tests, so this file only asserts the constants that the whole
 * domain reads from.
 */

describe("types constants", () => {
  test("ROLES are exactly the 4 RBAC roles", () => {
    expect(ROLES).toEqual(["owner", "admin", "agent", "viewer"]);
  });

  test("STATUSES are open/pending/closed", () => {
    expect(STATUSES).toEqual(["open", "pending", "closed"]);
  });

  test("PRIORITIES are low/normal/high/urgent", () => {
    expect(PRIORITIES).toEqual(["low", "normal", "high", "urgent"]);
  });

  test("PLAN_SEATS and PLAN_CAPS agree on seats", () => {
    for (const plan of Object.keys(PLAN_CAPS) as Plan[]) {
      expect(PLAN_SEATS[plan]).toBe(PLAN_CAPS[plan].seats);
    }
  });

  test("free < team < scale for both caps", () => {
    expect(PLAN_SEATS.free).toBeLessThan(PLAN_SEATS.team);
    expect(PLAN_SEATS.team).toBeLessThan(PLAN_SEATS.scale);
    expect(PLAN_CAPS.free.convosPerMonth).toBeLessThan(PLAN_CAPS.team.convosPerMonth);
  });

  test("every role is a valid literal", () => {
    const valid: Role[] = ["owner", "admin", "agent", "viewer"];
    for (const r of ROLES) expect(valid).toContain(r);
  });

  test("every priority is a valid literal", () => {
    const valid: Priority[] = ["low", "normal", "high", "urgent"];
    for (const p of PRIORITIES) expect(valid).toContain(p);
  });

  test("AS_OF is an ISO timestamp string in October 2026", () => {
    expect(AS_OF).toMatch(/^\d{4}-10-\d{2}T/);
    expect(new Date(AS_OF).toISOString().replace(".000Z", "Z")).toBe(AS_OF);
  });
});
