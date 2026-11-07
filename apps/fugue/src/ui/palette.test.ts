/**
 * palette.test.ts — the 13-command table + filter + enable pins
 * (Lane A, DOM-free).
 */
import { describe, test, expect } from "bun:test";
import {
  PALETTE_COMMANDS,
  PALETTE_BY_ID,
  filterCommands,
  isCommandEnabled,
  type PaletteCtx,
} from "./palette.js";

const noJob: PaletteCtx = { selectedJobId: null, selectedJobState: null, hasData: false };
const activeJob: PaletteCtx = { selectedJobId: 1, selectedJobState: "active", hasData: true };
const pausedJob: PaletteCtx = { selectedJobId: 2, selectedJobState: "paused", hasData: true };

describe("palette table", () => {
  test("the table has 13 commands (the P0 action set + the learning band)", () => {
    expect(PALETTE_COMMANDS.length).toBe(13);
  });

  test("every P0 action is covered", () => {
    const ids = PALETTE_COMMANDS.map((c) => c.id);
    for (const id of [
      "new-job", "run-now", "pause", "resume", "skip", "snooze",
      "refresh", "export", "import", "theme", "help",
      "open-dreams", "open-memory",
    ]) {
      expect(ids).toContain(id);
      expect(PALETTE_BY_ID[id]).toBeDefined();
    }
  });

  test("filter with no query returns every enabled command", () => {
    const all = filterCommands("", noJob);
    // new-job, refresh, import, theme, help are always enabled (5).
    expect(all.map((c) => c.id)).toEqual(
      expect.arrayContaining(["new-job", "refresh", "import", "theme", "help"]),
    );
  });

  test("job-scoped commands are disabled with no selection", () => {
    for (const id of ["run-now", "skip", "snooze", "pause", "resume"]) {
      expect(isCommandEnabled(id, noJob)).toBe(false);
    }
  });

  test("pause enabled only on active, resume only on paused", () => {
    expect(isCommandEnabled("pause", activeJob)).toBe(true);
    expect(isCommandEnabled("pause", pausedJob)).toBe(false);
    expect(isCommandEnabled("resume", activeJob)).toBe(false);
    expect(isCommandEnabled("resume", pausedJob)).toBe(true);
  });

  test("export is gated on hasData", () => {
    expect(isCommandEnabled("export", noJob)).toBe(false);
    expect(isCommandEnabled("export", activeJob)).toBe(true);
  });

  test("the learning-band commands are always enabled (the honest catch lane)", () => {
    for (const id of ["open-dreams", "open-memory"]) {
      expect(isCommandEnabled(id, noJob)).toBe(true);
      expect(isCommandEnabled(id, activeJob)).toBe(true);
    }
  });

  test("the substring filter matches label + id", () => {
    const hits = filterCommands("run", activeJob);
    expect(hits.map((c) => c.id)).toContain("run-now");
    const none = filterCommands("zzz", activeJob);
    expect(none).toHaveLength(0);
  });
});
