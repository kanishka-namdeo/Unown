import { describe, expect, it } from "bun:test";
import { createTask, uid } from "@/lib/sigil/tasks";

describe("tasks: uid (CSPRNG-sourced ids)", () => {
  it("keeps the <time36>-<8 base36 chars> shape the old Math.random id had", () => {
    expect(uid()).toMatch(/^[0-9a-z]+-[0-9a-z]{8}$/);
  });

  it("mints distinct ids inside the same millisecond (random half carries)", () => {
    const a = uid();
    const b = uid();
    expect(a).not.toBe(b);
  });

  it("createTask stamps a fresh uid on every task", () => {
    const t1 = createTask({ title: "a" });
    const t2 = createTask({ title: "b" });
    expect(t1.id).toMatch(/^[0-9a-z]+-[0-9a-z]{8}$/);
    expect(t2.id).toMatch(/^[0-9a-z]+-[0-9a-z]{8}$/);
    expect(t1.id).not.toBe(t2.id);
  });

  it("does not source randomness from Math.random (CodeQL js/insecure-randomness)", () => {
    // Pin the swap: Math.random is spied on and made deterministic; the id's
    // random half must STILL vary, proving it comes from the CSPRNG lane.
    const original = Math.random;
    let calls = 0;
    Math.random = () => {
      calls++;
      return 0.5;
    };
    try {
      const a = uid();
      const b = uid();
      expect(a).not.toBe(b);
      expect(calls).toBe(0);
    } finally {
      Math.random = original;
    }
  });
});
