import { describe, expect, test } from "bun:test";
import {
  ARIA_PLANS,
  ARIA_PLAN_CAPS,
  ARIA_ROLES,
  AS_OF,
  DEMO_PASSWORD,
  FORECAST_CATEGORIES,
  HMAC_SECRET,
  LEAD_PRIORITIES,
  SESSION_TTL_MS,
  SEED_INTEGER,
} from "./types";

describe("plan caps", () => {
  test("the three plans exist in the documented ladder", () => {
    expect(ARIA_PLANS).toEqual(["starter", "growth", "enterprise"]);
  });

  test("the cap table matches the plan's literal numbers", () => {
    expect(ARIA_PLAN_CAPS.starter).toEqual({ seats: 5, pipelines: 1, sequences: 1 });
    expect(ARIA_PLAN_CAPS.growth).toEqual({ seats: 25, pipelines: 4, sequences: 10 });
    expect(ARIA_PLAN_CAPS.enterprise).toEqual({ seats: 100, pipelines: 20, sequences: 50 });
  });

  test("caps grow monotonically with the plan tier", () => {
    const tiers = ARIA_PLANS;
    for (const k of ["seats", "pipelines", "sequences"] as const) {
      expect(ARIA_PLAN_CAPS[tiers[0]][k]).toBeLessThanOrEqual(ARIA_PLAN_CAPS[tiers[1]][k]);
      expect(ARIA_PLAN_CAPS[tiers[1]][k]).toBeLessThanOrEqual(ARIA_PLAN_CAPS[tiers[2]][k]);
    }
  });
});

describe("roles", () => {
  test("the five roles in the documented order", () => {
    expect(ARIA_ROLES).toEqual(["owner", "admin", "manager", "rep", "viewer"]);
  });
});

describe("enums", () => {
  test("lead priorities are the documented four", () => {
    expect(LEAD_PRIORITIES).toEqual(["low", "normal", "high", "urgent"]);
  });

  test("forecast categories cover the commit ladder + closed", () => {
    expect(FORECAST_CATEGORIES).toEqual(["pipeline", "best_case", "commit", "omitted", "closed"]);
  });
});

describe("demo constants", () => {
  test("AS_OF is the repo's pinned clock", () => {
    expect(AS_OF).toBe("2026-10-28T12:00:00Z");
  });

  test("SESSION_TTL_MS is exactly 8h in ms", () => {
    expect(SESSION_TTL_MS).toBe(8 * 3_600_000);
  });

  test("DEMO_PASSWORD + HMAC_SECRET are module constants (public-by-design)", () => {
    expect(DEMO_PASSWORD).toBe("aria-demo-1");
    expect(HMAC_SECRET).toBe("aria-demo-hmac-secret");
  });

  test("SEED_INTEGER is a fixed 32-bit seed", () => {
    expect(SEED_INTEGER).toBe(0x47a1d3c5);
  });
});
