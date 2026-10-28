import { describe, expect, test } from "bun:test";
import * as clock from "./clock";
import { AS_OF } from "./types";

describe("clock", () => {
  test("default value is AS_OF", () => {
    clock.resetClock();
    expect(clock.now()).toBe(AS_OF);
  });

  test("setClock pins a custom timestamp", () => {
    const custom = "2030-01-01T00:00:00Z";
    clock.setClock(custom);
    expect(clock.now()).toBe(custom);
    clock.resetClock();
  });

  test("pin/restore round-trip", () => {
    clock.resetClock();
    const saved = clock.now();
    clock.setClock("1999-12-31T23:59:59Z");
    expect(clock.now()).toBe("1999-12-31T23:59:59Z");
    clock.resetClock();
    expect(clock.now()).toBe(saved);
  });

  test("now() returns an ISO string each time", () => {
    const v = clock.now();
    expect(typeof v).toBe("string");
    expect(new Date(v).toISOString()).toMatch(/^20\d{2}/);
  });
});
