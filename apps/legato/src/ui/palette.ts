/**
 * palette.ts — the Ctrl+K command palette (ticket L-5, PLAN §1.1).
 *
 * THE Ostinato DIALOG CONTRACT (binding, from day one):
 *   - the overlay is `role="dialog"` + `aria-modal="true"`
 *   - **attach-before-focus**: the overlay is appended to the
 *     document body BEFORE the input receives focus
 *   - **focus trap**: Tab/Shift+Tab wrap within the dialog
 *   - **Esc focus-return**: Esc closes the palette and returns
 *     focus to the invoking element (the app remembers it in
 *     `invokingEl`)
 *   - **tabindex routing**: every focusable element in the dialog
 *     is created via `el()` with `tabindex` props that route
 *     through setAttribute (the B-12 cure in el.ts)
 *
 * COMMAND SET (the "small command set" the brief names — the
 * L-6/L-7/L-8 commands are HONESTLY STUBBED: they render disabled
 * with a title attribute explaining what lands when, NOT as dead
 * rows that look clickable):
 *
 *   group "clips"   — the pipeline seam (L-3/L-11):
 *     - `clip-url`     — clip a URL (the affordance; L-11 wires
 *                        RealFetcher + the clip pipeline; L-5 leaves
 *                        it ENABLED against the injected clip fn)
 *
 *   group "search"  — the '/' lane:
 *     - `search`       — focus the clip search input
 *
 *   group "states"  — queue state changes (L-6 owns the state
 *     machine; L-5 stubs these rows, disabled + titled):
 *     - `mark-reading` — mark the open clip reading (L-6)
 *     - `mark-done`    — mark the open clip done (L-6)
 *     - `archive`      — archive the open clip (L-6)
 *
 *   group "tags"    — L-7's tag filter lane (stubbed):
 *     - `filter-tags`  — open the tag filter bar (L-7)
 *
 *   group "app"     — surface-level controls:
 *     - `theme`        — toggle light/dark theme (wired now)
 *     - `export`       — export the JSON bundle (L-9, disabled until
 *                        L-9 lands; titled)
 *     - `import`       — import a JSON bundle (L-9, disabled until
 *                        L-9 lands; titled)
 *
 * The L-6/L-7/L-9 rows are the "stubbed honestly" requirement:
 * they render with `aria-disabled="true"` + a `title` attribute
 * naming the ticket that lands the action, and the Enter key does
 * NOT fire them (the dispatch checks `enabled` first — a disabled
 * command is inert, not dead).
 */
import { el } from "./el.js";
import { toggleTheme, currentScheme } from "./theme.js";

/** One palette command. */
export type PaletteCmd = {
  /** stable id (dispatch key) */
  id: string;
  /** human label (the row's text) */
  label: string;
  /** keyboard hint (honest copy — the actual binding) */
  hint: string;
  /** the group header */
  group: "clips" | "search" | "states" | "tags" | "app";
  /**
   * Enabled NOW (L-5's wiring). A disabled command renders dimmed
   * + `aria-disabled` + a `title` naming its landing ticket; it is
   * inert to Enter (dispatch checks this flag first).
   */
  enabled: boolean;
  /** the ticket that lands the action (shown in the title when
   *  disabled; also shown as a subtle suffix in the row when enabled
   *  but the action is still L-5's placeholder). */
  stubFor?: string;
};

/** The command table (the enumeration the tests pin by count). */
export const LEGATO_PALETTE_COMMANDS: PaletteCmd[] = [
  { id: "clip-url", label: "Clip URL", hint: "C", group: "clips", enabled: true },
  { id: "search", label: "Search clips", hint: "/", group: "search", enabled: true },
  { id: "theme", label: "Toggle theme", hint: "t", group: "app", enabled: true },
  // L-6's state machine (L-6's queue lane landed with the r/d/a/u
  // keys in app.ts — the palette's M/D/A rows are HONEST STUBS:
  // the keyboard-first lane is the queue's runner, the palette
  // rows are the "the queue's state flips are keyboard-driven,
  // not palette-driven" contract's executable form. They stay
  // disabled + a ticket named (the Ostinato "never a dead row
  // that looks clickable" law — the "honestly stubbed"
  // requirement: the row renders dimmed + aria-disabled + a
  // title naming the landing ticket, the dispatch checks
  // `enabled` first so a disabled row is INERT, not dead)).
  { id: "mark-reading", label: "Mark reading", hint: "M", group: "states", enabled: false, stubFor: "L-6" },
  { id: "mark-done", label: "Mark done", hint: "D", group: "states", enabled: false, stubFor: "L-6" },
  { id: "archive", label: "Archive clip", hint: "A", group: "states", enabled: false, stubFor: "L-6" },
  // L-7's tag filter lane (landed: the filter bar's tag chips +
  // the "Filter by tag" palette command's focusFilterBar action
  // — the L-7 close).
  { id: "filter-tags", label: "Filter by tag", hint: "T", group: "tags", enabled: true },
  // L-9's export/import (L-11's io lane: the app's wireExport /
  // wireImport closures land the "export via the palette →
  // import round-trip" flow step — the Ostinato O-4 download-
  // lane + file-chooser-lane precedent, the Fugue F-8 lane. The
  // commands are ENABLED (the L-11 lane supersedes L-9's stub —
  // the brief's "export via the palette" step needs the ENABLED
  // row; the `stubFor` field stays as the L-9 ticket name, the
  // row's "lands at" title lane — the enabled row's subtle
  // suffix, the PaletteCmd's doc comment's "the ticket that
  // lands the action (shown in the title when disabled; also
  // shown as a subtle suffix in the row when enabled but the
  // action is still L-5's placeholder)" contract).
  { id: "export", label: "Export bundle (JSON)", hint: "Ctrl+E", group: "app", enabled: true, stubFor: "L-9" },
  { id: "import", label: "Import bundle (JSON)", hint: "Ctrl+O", group: "app", enabled: true, stubFor: "L-9" },
];

export const PALETTE_CMD_COUNT = LEGATO_PALETTE_COMMANDS.length;
export const PALETTE_BY_ID: Record<string, PaletteCmd> = Object.fromEntries(
  LEGATO_PALETTE_COMMANDS.map((c) => [c.id, c]),
);

/** Filter the command table by a query (the Ctrl+K input). Pure,
 *  case-insensitive substring over label + id + group + hint. */
export function filterPaletteCommands(query: string): PaletteCmd[] {
  const q = query.trim().toLowerCase();
  if (q === "") return LEGATO_PALETTE_COMMANDS;
  return LEGATO_PALETTE_COMMANDS.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      c.group.toLowerCase().includes(q) ||
      c.hint.toLowerCase().includes(q),
  );
}

export interface PaletteState {
  open: boolean;
  query: string;
  selection: number;
  /** the invoking element (Esc focus-return target) */
  invokingEl: HTMLElement | null;
  /** the action callbacks the palette dispatches (injected by app.ts
   *  so the palette module stays testable without the app's full
   *  state — the clip-url command's action is the L-3/L-11 seam). */
  actions: {
    clipUrl: () => void;
    focusSearch: () => void;
    /** L-7: focus the tag filter bar's group element (the
     *  "Filter by tag" palette command's action — the app
     *  injects it so the palette module stays testable
     *  without the app's full state, same as clipUrl /
     *  focusSearch). */
    focusFilterBar?: () => void;
    /** L-11: the io module's export lane (exportData → JSON
     *  download event; the Ostinato O-4 / Fugue F-8 lane). */
    export?: () => void;
    /** L-11: the io module's import lane (importData + the
     *  file-chooser event, the Fugue F-8 lane). */
    import?: () => void;
  };
}

/**
 * Open the palette: attach the overlay to the document body BEFORE
 * focusing the input (the attach-before-focus contract).
 */
export function openPalette(state: PaletteState): void {
  state.open = true;
  state.query = "";
  state.selection = 0;
  const w = (globalThis as Record<string, unknown>)["window"] as Window | undefined;
  const active = w?.document?.activeElement;
  state.invokingEl = active instanceof HTMLElement ? active : null;
}

/**
 * Close the palette: remove the overlay, return focus to the
 * invoking element (the Esc focus-return lane — the Ostinato P0 #9).
 */
export function closePalette(state: PaletteState): void {
  state.open = false;
  state.query = "";
  const w = (globalThis as Record<string, unknown>)["window"] as Window | undefined;
  const doc = w?.document;
  doc?.getElementById("legato-palette")?.remove();
  const target = state.invokingEl ?? (doc?.body as HTMLElement | undefined);
  if (target) target.focus();
  state.invokingEl = null;
}

/**
 * Render (or re-render) the palette overlay into the document body.
 * Idempotent: the first call attaches, subsequent calls repaint.
 */
export function renderPalette(state: PaletteState): void {
  const w = (globalThis as Record<string, unknown>)["window"] as Window | undefined;
  const doc = w?.document;
  if (!doc) return;

  let overlay = doc.getElementById("legato-palette");
  if (!overlay) {
    overlay = el("div", {
      id: "legato-palette",
      class: "legato-palette",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Command palette",
    }) as unknown as HTMLElement;
    doc.body.append(overlay);
  }

  const cmds = filterPaletteCommands(state.query);
  const list = el("ul", {
    class: "legato-palette-list",
    role: "listbox",
    "aria-label": "Commands",
    tabindex: "0", // keyboard-scrollable (axe scrollable-region-focusable)
  }) as unknown as HTMLElement;

  let group: string | null = null;
  cmds.forEach((cmd, i) => {
    if (cmd.group !== group) {
      group = cmd.group;
      list.append(el("li", { class: "legato-palette-group", text: group, role: "presentation" }));
    }
    const li = el("li", {
      class:
        "legato-palette-row" +
        (i === state.selection ? " legato-palette-selected" : "") +
        (cmd.enabled ? "" : " legato-palette-disabled"),
      "data-cmd": cmd.id,
      role: "option",
      "aria-selected": i === state.selection ? "true" : "false",
    }) as unknown as HTMLElement;
    if (!cmd.enabled) {
      li.setAttribute("aria-disabled", "true");
      li.title = cmd.label + " — lands at " + (cmd.stubFor ?? "a future ticket");
    } else {
      li.setAttribute("aria-disabled", "false");
      li.title = cmd.label;
    }
    li.append(
      el("span", { text: cmd.label, class: "legato-palette-label" }),
      el("kbd", { text: cmd.hint, class: "legato-palette-hint" }),
    );
    list.append(li);
  });

  const input = el("input", {
    class: "legato-palette-input",
    "aria-label": "Filter commands",
    value: state.query,
  }) as HTMLInputElement;
  input.oninput = () => {
    state.query = input.value;
    state.selection = 0;
    renderPalette(state);
  };

  // THE FOCUS TRAP (the Ostinato dialog contract): Tab/Shift+Tab
  // wrap within the dialog. The input and the list (tabindex=0)
  // are the two focus stops; Tab from the last wraps to the first
  // and vice versa.
  const focusable = () =>
    Array.from(overlay.querySelectorAll<HTMLElement>("input, [tabindex='0'], button"))
      .filter((e) => e.offsetParent !== null || e === doc.activeElement);

  overlay.onkeydown = (e: KeyboardEvent) => {
    // THE ESCAPE LANE (the Ostinato P0 #9 focus-return contract —
    // the "Esc closes the palette and focus returns to the
    // invoking control" law's executable form): the overlay's
    // own onkeydown handles Esc BEFORE the printable-char branch
    // (the printable branch's `e.key.length === 1` check would
    // swallow the Escape key as a query character — the Escape
    // key's `key` value is "Escape" (length 6), so the printable
    // branch's `!e.ctrlKey && !e.metaKey && !e.altKey` +
    // `e.key.length === 1` guards already exclude it, but the
    // explicit branch is the "the Escape key's activation lane"
    // contract's honest form: the Ostinato "never a dead key
    // that looks inert" law — a key that the user expects to
    // close the dialog must NOT be silently consumed by the
    // query-filter lane). The `closePalette` call is the
    // "the Esc lane's closure" contract: the overlay's removal +
    // the focus-return to `state.invokingEl` (the Ostinato P0 #9
    // focus-recovery lane — the "focus never wanders to body"
    // law's executable form). The `preventDefault` is the
    // "the document-level handler's "not re-route over the
    // dialog" contract's twin: the Esc's default action (the
    // browser's "close the active modal" lane) is suppressed —
    // the palette's own `closePalette` lane is the activation's
    // target, NOT the browser's native modal-close (the Ostinato
    // "the affordance's keyboard lane's activation fires the
    // same callback as the click lane" law's executable form:
    // the Esc's activation lane is the `closePalette` callback,
    // not the browser's native lane).
    if (e.key === "Escape") {
      e.preventDefault();
      closePalette(state);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const stops = focusable();
      if (stops.length === 0) return;
      const idx = stops.indexOf(doc.activeElement as HTMLElement);
      const next = e.shiftKey ? (idx - 1 + stops.length) % stops.length : (idx + 1) % stops.length;
      stops[next].focus();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = cmds.length;
      if (n === 0) return;
      state.selection =
        e.key === "ArrowDown"
          ? (state.selection + 1) % n
          : (state.selection - 1 + n) % n;
      renderPalette(state);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const cmd = cmds[state.selection];
      if (cmd && cmd.enabled) {
        closePalette(state);
        dispatchPaletteCmd(cmd, state);
      }
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      state.query = state.query.slice(0, -1);
      state.selection = 0;
      renderPalette(state);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      state.query += e.key;
      state.selection = 0;
      renderPalette(state);
      return;
    }
  };

  overlay.replaceChildren(input, list);
  input.focus(); // attach-before-focus: the overlay is in the DOM
}

/**
 * Dispatch a selected + ENABLED palette command to its action.
 * Disabled commands never reach here (Enter checks `enabled` first).
 */
export function dispatchPaletteCmd(cmd: PaletteCmd, state: PaletteState): void {
  switch (cmd.id) {
    case "clip-url":
      state.actions.clipUrl();
      return;
    case "search":
      state.actions.focusSearch();
      return;
    case "theme":
      toggleTheme();
      return;
    case "filter-tags":
      state.actions.focusFilterBar?.();
      return;
    case "export":
      state.actions.export?.();
      return;
    case "import":
      state.actions.import?.();
      return;
    default:
      // A disabled command's id — unreachable (Enter guards it),
      // but the default lane is honest: no-op.
      return;
  }
}
