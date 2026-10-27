import { describe, expect, it } from "bun:test";
import { buildDemoStore } from "@/lib/sigil/demo-data";

describe("demo-data: buildDemoStore", () => {
  it("produces a valid store with tasks spread across columns", () => {
    const s = buildDemoStore();
    expect(s.version).toBe(1);
    expect(s.tasks.length).toBeGreaterThanOrEqual(5);
    const cols = new Set(s.tasks.map((t) => t.column));
    // At least 3 distinct columns populated
    expect(cols.size).toBeGreaterThanOrEqual(3);
  });

  it("gives done tasks a completedAt within the last few days (streak-friendly)", () => {
    const s = buildDemoStore();
    const done = s.tasks.filter((t) => t.column === "done");
    expect(done.length).toBeGreaterThanOrEqual(2);
    for (const t of done) {
      expect(t.completedAt).not.toBeNull();
      // completedAt is within the last 30 days
      const age = Date.now() - new Date(t.completedAt as string).getTime();
      expect(age).toBeLessThan(30 * 24 * 60 * 60 * 1000);
    }
  });

  it("includes focus log entries that reference real task ids", () => {
    const s = buildDemoStore();
    expect(s.focusLog.length).toBeGreaterThanOrEqual(3);
    const ids = new Set(s.tasks.map((t) => t.id));
    for (const e of s.focusLog) {
      expect(ids.has(e.taskId)).toBe(true);
      expect(e.durationMin).toBeGreaterThan(0);
    }
  });

  it("attaches focus sessions onto tasks that have log entries", () => {
    const s = buildDemoStore();
    const withLog = s.focusLog[0];
    const task = s.tasks.find((t) => t.id === withLog.taskId);
    expect(task?.focusSessions.length).toBeGreaterThan(0);
  });
});
