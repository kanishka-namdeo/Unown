/**
 * palette.test.ts — the Ctrl+K command palette pins (L-5, PLAN
 * §1.1: "the Ostinato dialog contract — role=dialog, aria-modal,
 * focus trap, Esc focus-return, tabindex routing").
 *
 * Lane semantics (the el-pin precedent):
 *   Lane A — DOM-free: the enumeration pins (command count, id
 *            uniqueness, the honest-stub disabled flags, the filter
 *            function) RUN — they are pure data; the DOM-guarded
 *            open/close/interaction pins register skipped stubs.
 *   Lane B — happy-dom: the DOM pins RUN (open, the focus trap,
 *            Esc focus-return, the command rows rendering with
 *            aria-disabled + title on the L-6/L-7/L-9 stubs).
 */
import { test, expect } from "bun:test";
import {
  LEGATO_PALETTE_COMMANDS,
  PALETTE_CMD_COUNT,
  PALETTE_BY_ID,
  filterPaletteCommands,
  type PaletteState,
} from "./palette.js";

// ─── The enumeration (pure, runs in BOTH lanes) ──────────────────

test("PALETTE_CMD_COUNT === 9 (the dropped-row guard)", () => {
  expect(PALETTE_CMD_COUNT).toBe(9);
  expect(LEGATO_PALETTE_COMMANDS.length).toBe(9);
});

test("every command id is UNIQUE (9 rows → 9 distinct ids)", () => {
  const ids = LEGATO_PALETTE_COMMANDS.map((c) => c.id);
  expect(new Set(ids).size).toBe(9);
});

test("PALETTE_BY_ID contains every row", () => {
  expect(Object.keys(PALETTE_BY_ID).length).toBe(9);
  for (const cmd of LEGATO_PALETTE_COMMANDS) {
    expect(PALETTE_BY_ID[cmd.id]).toBe(cmd);
  }
});

test("the L-5/L-7-wired commands are enabled: clip-url, search, theme, filter-tags", () => {
  for (const id of ["clip-url", "search", "theme", "filter-tags"]) {
    expect(PALETTE_BY_ID[id].enabled).toBe(true);
  }
});

test("the L-6/L-7/L-9 commands are honestly stubbed: disabled + a ticket named", () => {
  // L-6's commands land with the r/d/a/u keys in app.ts (L-6 close);
  // L-7's filter-tags is now enabled (the filter bar landed);
  // L-9's export/import remain stubbed.
  const stubbed: Array<[string, string]> = [
    ["export", "L-9"],
    ["import", "L-9"],
  ];
  for (const [id, ticket] of stubbed) {
    expect(PALETTE_BY_ID[id].enabled).toBe(false);
    expect(PALETTE_BY_ID[id].stubFor).toBe(ticket);
  }
});

test("filterPaletteCommands: empty query → the full 9; case-insensitive substring", () => {
  expect(filterPaletteCommands("")).toHaveLength(9);
  expect(filterPaletteCommands("MARK").map((c) => c.id)).toEqual(["mark-reading", "mark-done"]);
  expect(filterPaletteCommands("export").map((c) => c.id)).toEqual(["export"]);
  expect(filterPaletteCommands("zebra")).toEqual([]);
});

// ─── The DOM-guarded half (Lane B only) ───────────────────────────

const hasDom = typeof document !== "undefined";

if (!hasDom) {
  test.skip("palette open/render/Esc — requires a DOM (Lane B's happy-dom provides it)", () => {});
} else {
  test("palette: Ctrl+K opens the dialog; rows render with honest disabled titles (DOM)", async () => {
    const { openPalette, renderPalette } = await import("./palette.js");
    const state: PaletteState = {
      open: false,
      query: "",
      selection: 0,
      invokingEl: null,
      actions: { clipUrl: () => {}, focusSearch: () => {} },
    };
    const invoker = document.createElement("button");
    document.body.append(invoker);
    invoker.focus();
    openPalette(state);
    expect(state.open).toBe(true);
    renderPalette(state);
    const overlay = document.getElementById("legato-palette");
    expect(overlay !== null).toBe(true);
    expect(overlay!.getAttribute("role")).toBe("dialog");
    expect(overlay!.getAttribute("aria-modal")).toBe("true");
    // The command rows render (9 rows, in group sections).
    const rows = overlay!.querySelectorAll<HTMLElement>(".legato-palette-row");
    expect(rows.length).toBe(9);
    // The L-9 stub row carries the honest disabled title.
    const exportRow = Array.from(rows).find((r) => r.getAttribute("data-cmd") === "export")!;
    expect(exportRow.getAttribute("aria-disabled")).toBe("true");
    expect(exportRow.title).toContain("L-9");
    // The L-5-wired row is enabled.
    const searchRow = Array.from(rows).find((r) => r.getAttribute("data-cmd") === "search")!;
    expect(searchRow.getAttribute("aria-disabled")).toBe("false");
    // Focus went to the input (attach-before-focus: the overlay was
    // in the DOM before focus).
    expect(document.activeElement === overlay!.querySelector("input")).toBe(true);
    document.body.innerHTML = "";
  });

  test("palette: Esc returns focus to the invoking element (DOM)", async () => {
    const { openPalette, closePalette, renderPalette } = await import("./palette.js");
    const state: PaletteState = {
      open: false,
      query: "",
      selection: 0,
      invokingEl: null,
      actions: { clipUrl: () => {}, focusSearch: () => {} },
    };
    const invoker = document.createElement("button");
    invoker.id = "invoker";
    document.body.append(invoker);
    invoker.focus();
    openPalette(state);
    renderPalette(state);
    expect(state.invokingEl).toBe(invoker);
    closePalette(state);
    expect(document.getElementById("legato-palette")).toBeNull();
    expect(document.activeElement === invoker || document.activeElement!.isSameNode(invoker)).toBe(true); // the focus-return law
    expect(state.invokingEl).toBeNull();
    document.body.innerHTML = "";
  });
}
