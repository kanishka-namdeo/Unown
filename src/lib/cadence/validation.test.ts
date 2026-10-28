import { describe, expect, test } from "bun:test";
import {
  habitErrors,
  validateGlyph,
  validateHabitGoal,
  validateHabitName,
  type HabitDraft,
} from "./validation";

describe("validateHabitName (1..60 chars)", () => {
  test("accepts a normal name", () => {
    expect(validateHabitName("Read 20 pages")).toBeNull();
  });

  test("trims surrounding whitespace before checking", () => {
    expect(validateHabitName("   Morning stretch   ")).toBeNull();
  });

  test("rejects empty / whitespace-only", () => {
    expect(validateHabitName("")).toMatch(/habit name/i);
    expect(validateHabitName("   ")).toMatch(/habit name/i);
  });

  test("rejects over 60 characters with an actionable message", () => {
    expect(validateHabitName("x".repeat(61))).toMatch(/or fewer/);
    expect(validateHabitName("x".repeat(60))).toBeNull(); // boundary OK
  });
});

describe("validateHabitGoal (1-7, 0 = daily)", () => {
  test("accepts 0..7 whole numbers", () => {
    for (const g of [0, 1, 2, 3, 4, 5, 6, 7]) expect(validateHabitGoal(g)).toBeNull();
  });

  test("rejects out-of-range weekly goals", () => {
    expect(validateHabitGoal(8)).toMatch(/must be 1–7/);
    expect(validateHabitGoal(-1)).toMatch(/whole number/);
  });

  test("rejects non-integers", () => {
    expect(validateHabitGoal(2.5)).toMatch(/whole number/);
  });
});

describe("validateGlyph (0 or 1 emoji-ish char)", () => {
  test("accepts empty", () => {
    expect(validateGlyph("")).toBeNull();
  });

  test("accepts a single character / emoji", () => {
    expect(validateGlyph("a")).toBeNull();
    expect(validateGlyph("🏋")).toBeNull(); // single code point
  });

  test("rejects two or more characters", () => {
    expect(validateGlyph("ab")).toMatch(/single glyph/i);
    expect(validateGlyph("🏋️")).toMatch(/single glyph/i); // emoji + variation selector
  });
});

describe("habitErrors (composite)", () => {
  test("clean draft → no errors", () => {
    const draft: HabitDraft = { name: "Meditate", weeklyTarget: 2, glyph: "🧘" };
    expect(Object.keys(habitErrors(draft))).toHaveLength(0);
  });

  test("rejects an all-bad draft on every field", () => {
    const draft: HabitDraft = { name: "", weeklyTarget: 9, glyph: "ab" };
    const errs = habitErrors(draft);
    expect(Object.keys(errs)).toEqual(
      expect.arrayContaining(["name", "weeklyTarget", "glyph"]),
    );
  });

  test("only the offending fields are reported", () => {
    const errs = habitErrors({ name: "Fine", weeklyTarget: 3, glyph: "zz" });
    expect(errs.glyph).toBeDefined();
    expect(errs.name).toBeUndefined();
    expect(errs.weeklyTarget).toBeUndefined();
  });
});
