/**
 * built-improved.test.tsx — pins the "Built & Improved With Unown" band's
 * contracts: the improvement receipts' before/after shape (the band's core
 * exhibit — a receipt without both ends is a claim, not evidence), the
 * learning counters' count, the stills' existence (reused captures — the
 * band must never point at a missing asset), the report exits, and the
 * derivation from the gallery's own data (the app count reads
 * LIVE_DEMO_APPS, never a duplicated constant).
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  IMPROVEMENT_RECEIPTS,
  LEARNING_COUNTERS,
  MISSION_CONTROL_STILLS,
  REPORT_LINKS,
} from "../built-improved-data";
import { LIVE_DEMO_APPS } from "../live-demo-data";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

describe("built-improved-data — the receipts", () => {
  test("two improvement receipts, each with before AND after AND a receipt link", () => {
    expect(IMPROVEMENT_RECEIPTS.length).toBe(2);
    for (const r of IMPROVEMENT_RECEIPTS) {
      expect(r.before.trim().length).toBeGreaterThan(0);
      expect(r.after.trim().length).toBeGreaterThan(0);
      expect(r.loop.trim().length).toBeGreaterThan(40);
      expect(r.receipt.startsWith("https://github.com/kanishka-namdeo/Unown/blob/main/")).toBe(true);
    }
    expect(IMPROVEMENT_RECEIPTS.map((r) => r.id)).toEqual(["first-patch", "envelope"]);
  });

  test("six learning counters, every value non-empty", () => {
    expect(LEARNING_COUNTERS.length).toBe(6);
    for (const c of LEARNING_COUNTERS) {
      expect(c.value.trim().length).toBeGreaterThan(0);
      expect(c.label.trim().length).toBeGreaterThan(2);
    }
    // The tool-success counter carries the one-decimal honest form.
    expect(LEARNING_COUNTERS.find((c) => c.label === "tool success")?.value).toBe("99.5%");
  });

  test("every Mission Control still exists on disk (reused captures, never missing)", () => {
    expect(MISSION_CONTROL_STILLS.length).toBe(3);
    for (const s of MISSION_CONTROL_STILLS) {
      const p = join(REPO_ROOT, "public", s.src.replace(/^\//, ""));
      expect(existsSync(p)).toBe(true);
    }
  });

  test("three report exits, all absolute GitHub links", () => {
    expect(REPORT_LINKS.length).toBe(3);
    for (const l of REPORT_LINKS) {
      expect(l.href.startsWith("https://github.com/kanishka-namdeo/Unown/blob/main/docs/")).toBe(true);
    }
  });

  test("the band derives its app count from the gallery's data (no duplicate constant)", () => {
    // The gallery is the single source for what was built; the band's lead
    // sentence reads LIVE_DEMO_APPS.length at render time. The pin here:
    // the gallery data file keeps its shape (id + receipt fields), so the
    // derivation stays honest as apps join.
    for (const app of LIVE_DEMO_APPS) {
      expect(app.id.length).toBeGreaterThan(0);
      expect(app.route.startsWith("/")).toBe(true);
      expect(app.receipt.tests).toBeGreaterThan(0);
    }
  });
});
