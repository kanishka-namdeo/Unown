import { describe, expect, test } from "bun:test";
import { hex4, mulberry32, newSessionId } from "./ids";

describe("mulberry32", () => {
  test("same seed produces the same sequence", () => {
    const a = mulberry32(0x47a1d3c5);
    const b = mulberry32(0x47a1d3c5);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });

  test("values are in [0, 1)", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("different seeds diverge", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let same = 0;
    for (let i = 0; i < 10; i++) if (a() === b()) same++;
    expect(same).toBeLessThan(2);
  });
});

describe("hex4", () => {
  test("formats a deterministic 4-hex-digit suffix", () => {
    const rng = mulberry32(7);
    const h = hex4(rng);
    expect(h).toMatch(/^[0-9a-f]{4}$/);
    const rng2 = mulberry32(7);
    expect(hex4(rng2)).toBe(h);
  });

  test("distinct draws differ across a 64-draw stream (collision-free at this scale)", () => {
    const rng = mulberry32(99);
    const draws = new Set<string>();
    for (let i = 0; i < 64; i++) draws.add(hex4(rng));
    expect(draws.size).toBeGreaterThan(60);
  });
});

describe("newSessionId", () => {
  test("is deterministic for a given prefix + seed + counter", () => {
    const a = newSessionId("ses", mulberry32(5), 1);
    const b = newSessionId("ses", mulberry32(5), 1);
    expect(a).toBe(b);
    expect(a).toMatch(/^ses_[0-9a-f]{4}_0001$/);
  });

  test("distinct counters produce distinct ids", () => {
    const ids = new Set<string>();
    for (let i = 1; i <= 50; i++) ids.add(newSessionId("ses", mulberry32(3), i));
    expect(ids.size).toBe(50);
  });
});
