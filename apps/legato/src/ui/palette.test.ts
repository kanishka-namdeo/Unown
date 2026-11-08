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

test("the L-5/L-7/L-9-wired commands are enabled: clip-url, search, theme, filter-tags, export, import", () => {
  // THE L-11 REALITY (the command table's current state — the
  // L-5 stub contract is no longer the law: L-6/L-7/L-9 LANDED,
  // the export/import commands are ENABLED via the app's
  // wireExport / wireImport closures (the L-11 io lane, the
  // Ostinato O-4 download-lane + file-chooser-lane precedent,
  // the Fugue F-8 lane). The "export via the palette → import
  // round-trip" flow step (the L-11 brief's deliverable #1's
  // last two steps) drives these ENABLED rows.
  for (const id of ["clip-url", "search", "theme", "filter-tags", "export", "import"]) {
    expect(PALETTE_BY_ID[id].enabled, `${id} is enabled (the L-11 reality)`).toBe(true);
  }
});

test("the L-6 keyboard-lane commands are honestly stubbed: disabled + a ticket named", () => {
  // THE HONEST STUBS (the brief's "keep pinning that any still-
  // unimplemented command — if any remains — stays honestly
  // disabled" requirement): L-6's state machine (mark-reading /
  // mark-done / archive) is the KEYBOARD-FIRST queue's lane (the
  // r/d/a/u keys in app.ts, the L-6 close — the queue's runner
  // is the keyboard, the palette's M/D/A rows are the "the
  // queue's state flips are keyboard-driven, not palette-
  // driven" contract's executable form). They render dimmed +
  // aria-disabled + a ticket-named title (the Ostinato "never
  // a dead row that looks clickable" law — the "honestly
  // stubbed" requirement: the dispatch checks `enabled` first,
  // a disabled row is INERT, not dead).
  const stubbed: Array<[string, string]> = [
    ["mark-reading", "L-6"],
    ["mark-done", "L-6"],
    ["archive", "L-6"],
  ];
  for (const [id, ticket] of stubbed) {
    expect(PALETTE_BY_ID[id].enabled, `${id} is honestly disabled (the L-6 keyboard-lane stub)`).toBe(false);
    expect(PALETTE_BY_ID[id].stubFor, `${id} names its landing ticket`).toBe(ticket);
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
    // THE L-11 REALITY: the L-9-wired export/import rows are
    // now ENABLED (the L-11 io lane — the app's wireExport /
    // wireImport closures, the Ostinato O-4 download-lane +
    // file-chooser-lane precedent). The export row's
    // aria-disabled is "false" (the enabled lane), its title is
    // the label (the enabled row's title lane, the palette.ts's
    // `li.title = cmd.label` for enabled commands).
    const exportRow = Array.from(rows).find((r) => r.getAttribute("data-cmd") === "export")!;
    expect(exportRow.getAttribute("aria-disabled"), "the export row is enabled (the L-11 io lane)").toBe("false");
    // THE L-6 KEYBOARD-LANE STUBS: the mark-reading row is
    // honestly disabled + a ticket-named title (the "keep
    // pinning that any still-unimplemented command stays
    // honestly disabled" requirement — the Ostinato "never a
    // dead row that looks clickable" law, the "honestly
    // stubbed" contract's executable form).
    const markReadingRow = Array.from(rows).find((r) => r.getAttribute("data-cmd") === "mark-reading")!;
    expect(markReadingRow.getAttribute("aria-disabled"), "the mark-reading row is honestly disabled (the L-6 keyboard-lane stub)").toBe("true");
    expect(markReadingRow.title).toContain("L-6");
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

  test("palette: a keydown Escape event on the overlay closes it (the EVENT lane — not the closePalette function) (DOM)", async () => {
    // THE ESC-KEYDOWN EVENT-LANE PIN (the Ostinato P0 #9 focus-
    // return contract's executable form — the "Esc closes the
    // palette and focus returns to the invoking control" law,
    // driven via a dispatched KEYDOWN EVENT on the overlay's
    // `onkeydown` handler, NOT via the `closePalette` function
    // call): this pin closes the unit/e2e coverage-gap class —
    // the prior pin exercised the exported `closePalette()`
    // function directly (the "the focus-return lane" contract's
    // function-lane half), but the REAL browser path is the
    // overlay's `onkeydown` handler's Escape branch (the
    // "the Esc key's activation lane" contract: a keydown
    // Escape event dispatched on the overlay — or the input
    // inside it, which BUBBLES to the overlay's handler —
    // triggers the Escape branch's `closePalette` call + the
    // focus-return). The dispatched event is the "the EVENT
    // lane, not the function lane" pin: the `onkeydown` handler
    // is the production code path (the Ostinato "the
    // keyboard-first affordance's activation fires the same
    // callback as the click lane" law's executable form — the
    // keydown event's activation is the `closePalette` callback,
    // the "the Esc lane's closure" contract). If the `onkey-
    // down` handler's Escape branch were missing (the L-11
    // defect: the handler's Tab/Arrow/Enter/Backspace/printable
    // branches with NO Escape branch), the dispatched event
    // would be swallowed by the document-level handler (which
    // only closes the DETAIL view, not the palette) — the
    // palette would stay open, and this pin's "the overlay is
    // gone" assertion would FAIL (the coverage-gap's
    // executable proof: the unit lane now catches the e2e
    // defect, the "the unit pin drives the EVENT" contract's
    // honesty).
    const { openPalette, renderPalette } = await import("./palette.js");
    const state: PaletteState = {
      open: false,
      query: "",
      selection: 0,
      invokingEl: null,
      actions: { clipUrl: () => {}, focusSearch: () => {} },
    };
    const invoker = document.createElement("button");
    invoker.id = "esc-invoker";
    document.body.append(invoker);
    invoker.focus();
    openPalette(state);
    renderPalette(state);
    const overlay = document.getElementById("legato-palette");
    expect(overlay !== null, "the overlay is in the DOM before the Esc keydown").toBe(true);
    expect(state.open, "the palette is open before the Esc keydown").toBe(true);
    // THE DISPATCHED KEYDOWN EVENT (the "the EVENT lane, not the
    // function lane" contract's executable form): a synthetic
    // KeyboardEvent with `key: "Escape"` dispatched on the
    // overlay (the overlay's `onkeydown` handler is the
    // production code path — the event BUBBLES from the
    // focused input to the overlay's handler, the "the Esc
    // key's activation lane" contract's DOM-order half: the
    // input's keydown bubbles to the overlay, the overlay's
    // handler's Escape branch is the activation's target). The
    // `bubbles: true` is the "the event's DOM propagation"
    // contract: the input's keydown bubbles up to the overlay's
    // `onkeydown` (the "the overlay's handler's activation"
    // law's DOM-order executable form).
    const input = overlay!.querySelector<HTMLInputElement>(".legato-palette-input")!;
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    // THE ESC-LANE'S CLOSURE (the "the Esc key's activation
    // lane" contract's executable proof): the overlay's
    // `onkeydown` handler's Escape branch called
    // `closePalette(state)` — the overlay is removed from the
    // DOM + the focus returned to the invoking element (the
    // Ostinato P0 #9 focus-recovery lane, the "focus never
    // wanders to body" law's executable form).
    expect(state.open, "the palette is closed after the Esc keydown event").toBe(false);
    expect(document.getElementById("legato-palette"), "the overlay is removed from the DOM after the Esc keydown event").toBeNull();
    expect(document.activeElement === invoker || document.activeElement!.isSameNode(invoker), "focus returned to the invoking element after the Esc keydown event (the Ostinato P0 #9 focus-recovery lane)").toBe(true);
    invoker.remove();
  });
}
