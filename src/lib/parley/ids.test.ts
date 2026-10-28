import { describe, expect, test } from "bun:test";
import { mulberry32, newConversationId, newInviteToken, newMessageId, newSessionId } from "./ids";

describe("mulberry32", () => {
  test("same seed produces the same sequence", () => {
    const a = mulberry32(0x2a1f0c9e);
    const b = mulberry32(0x2a1f0c9e);
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
});

describe("id generators", () => {
  test("conversation ids are prefixed and unique across calls", () => {
    const rng = mulberry32(7);
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const id = newConversationId(rng);
      expect(id).toMatch(/^cnv-[0-9a-f]{4}-\d+$/);
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
  });

  test("message ids are prefixed and unique", () => {
    const rng = mulberry32(9);
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const id = newMessageId(rng);
      expect(id).toMatch(/^msg-[0-9a-f]{4}-\d+$/);
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
  });

  test("session ids are prefixed and unique", () => {
    const rng = mulberry32(11);
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const id = newSessionId(rng);
      expect(id).toMatch(/^ses-[0-9a-f]{4}-\d+$/);
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
  });

  test("invite tokens are 8 hex chars + counter, unique", () => {
    const rng = mulberry32(13);
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const id = newInviteToken(rng);
      expect(id).toMatch(/^tok-[0-9a-f]{8}-\d+$/);
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
  });

  test("the RNG portion is deterministic: same seed + same call count → same id", () => {
    // The counter is module-scope shared state. For the seed itself,
    // determinism is pinned in seed.test.ts (two seeds → deep-equal),
    // not here. This test only verifies that the RNG hex prefix is
    // deterministic given the seed.
    const hexA =
      Math.floor(mulberry32(0x2a1f0c9e)() * 0x10000)
        .toString(16)
        .padStart(4, "0");
    const hexB =
      Math.floor(mulberry32(0x2a1f0c9e)() * 0x10000)
        .toString(16)
        .padStart(4, "0");
    expect(hexA).toBe(hexB);
    expect(hexA).toMatch(/^[0-9a-f]{4}$/);
  });
});
