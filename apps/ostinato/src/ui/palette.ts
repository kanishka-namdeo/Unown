/**
 * Ostinato — the command palette's DOM-free core (ticket O-3, P0 #4).
 *
 * The PRD's hardening table row: "every command reachable from the
 * palette — pinned by enumeration". This module is that enumeration:
 * a pure, testable command table + the filter/rank logic the palette
 * UI renders. The DOM wiring (the Ctrl+K open/close, the focus
 * return to the invoking control, the visible selection ring) lives
 * in `src/ui/app.ts`; this file owns the semantics so they are
 * unit-pinned without a browser.
 *
 * The command set (every runner action, enumerated — the receipt's
 * D7). 18 commands:
 *
 *   group "review"   — the review loop's direct controls:
 *     - `reveal`       — show the card's back (Space / Enter)
 *     - `grade-again`  — grade the current card 1 (Again, q=0)
 *     - `grade-hard`   — grade the current card 2 (Hard,  q=1)
 *     - `grade-good`   — grade the current card 3 (Good,  q=2)
 *     - `grade-easy`   — grade the current card 4 (Easy,  q=3)
 *     - `skip`         — skip the current card without grading (S)
 *     - `restart`      — restart the review queue from the top (R)
 *
 *   group "navigate" — the list surface (P0 #4's j/k/g/G):
 *     - `next-card`    — `j`
 *     - `prev-card`    — `k`
 *     - `first-card`   — `g`
 *     - `last-card`    — `G`
 *
 *   group "filter"   — the card/deck search (P0 #4's `/`):
 *     - `search`       — focus the card/deck filter
 *
 *   group "data"     — the persistent-state actions:
 *     - `create-deck`  — create a new deck (N) — creates are legal in
 *                        every phase (a fresh deck recomputes the
 *                        review queue from the data set)
 *     - `create-card`  — create a new card (C) — same every-phase law
 *     - `export`       — download the data set (P0 #7's JSON round-trip)
 *     - `import`       — load a JSON document
 *
 *   group "app"      — surface-level controls:
 *     - `clear-session` — discard the persisted review session
 *     - `stats`        — open the review stats heatmap (T) — the R-1
 *                        activity-log surface, enabled in every phase
 *
 * 18 commands. The table is data, not code: `PALETTE_COMMANDS`
 * carries the id, the label, the hint (the keyboard shortcut,
 * honest copy), the group, and a `disabledIn` set (a command that
 * cannot apply in the current phase is disabled in the palette,
 * not hidden — the enumeration stays total).
 */
import type { ReviewSession } from "./runner-core.js";
import type { Grade } from "../domain/ports.js";

/** One palette command (the row the UI renders, the row the tests pin). */
export type PaletteCommand = {
  /** The stable id the UI dispatches on (not the label — labels change). */
  id: string;
  /** The human label (shown in the palette row). */
  label: string;
  /** The keyboard hint (honest copy: the actual key the UI binds). */
  hint: string;
  /** The group (the palette's section header). */
  group: "review" | "navigate" | "filter" | "data" | "app";
  /**
   * The phases in which the command is NOT applicable. A command
   * is enabled when its `disabledIn` does NOT contain the current
   * phase. (The enumeration stays total: a disabled command still
   * renders, dimmed — never hidden, the hardening table's "pinned
   * by enumeration" rule.)
   */
  disabledIn: Array<ReviewSession["phase"]>;
};

/** The group order (the palette renders groups in this order). */
export const PALETTE_GROUPS: Array<PaletteCommand["group"]> = [
  "review",
  "navigate",
  "filter",
  "data",
  "app",
];

/**
 * The command table — THE enumeration (the PRD's hardening row,
 * the receipt's D7). Every runner action lands here; a new action
 * is a new row, and the test suite's count assertion (18 commands,
 * one per id) fails if a row is silently dropped.
 */
export const PALETTE_COMMANDS: PaletteCommand[] = [
  // review group
  { id: "reveal", label: "Reveal answer", hint: "Space / Enter", group: "review", disabledIn: ["revealed", "done"] },
  { id: "grade-again", label: "Grade: Again", hint: "1", group: "review", disabledIn: ["front", "done"] },
  { id: "grade-hard", label: "Grade: Hard", hint: "2", group: "review", disabledIn: ["front", "done"] },
  { id: "grade-good", label: "Grade: Good", hint: "3", group: "review", disabledIn: ["front", "done"] },
  { id: "grade-easy", label: "Grade: Easy", hint: "4", group: "review", disabledIn: ["front", "done"] },
  { id: "skip", label: "Skip card", hint: "S", group: "review", disabledIn: ["done"] },
  { id: "restart", label: "Restart queue", hint: "R", group: "review", disabledIn: [] },
  // navigate group
  { id: "next-card", label: "Next card", hint: "J", group: "navigate", disabledIn: ["done"] },
  { id: "prev-card", label: "Previous card", hint: "K", group: "navigate", disabledIn: ["done"] },
  { id: "first-card", label: "First card", hint: "G", group: "navigate", disabledIn: ["done"] },
  { id: "last-card", label: "Last card", hint: "Shift+G", group: "navigate", disabledIn: ["done"] },
  // filter group
  { id: "search", label: "Search cards", hint: "/", group: "filter", disabledIn: [] },
  // data group
  { id: "create-deck", label: "Create deck", hint: "N", group: "data", disabledIn: [] },
  { id: "create-card", label: "Create card", hint: "C", group: "data", disabledIn: [] },
  { id: "export", label: "Export data (JSON)", hint: "Ctrl+E", group: "data", disabledIn: [] },
  { id: "import", label: "Import data (JSON)", hint: "Ctrl+O", group: "data", disabledIn: [] },
  // app group
  { id: "clear-session", label: "Clear review session", hint: "Ctrl+X", group: "app", disabledIn: [] },
  { id: "stats", label: "Review stats (heatmap)", hint: "T", group: "app", disabledIn: [] },
];

/** The command id → command map (dispatch lookup, O(n)→O(1)). */
export const PALETTE_BY_ID: Record<string, PaletteCommand> = Object.fromEntries(
  PALETTE_COMMANDS.map((c) => [c.id, c]),
);

/** The total command count (the test suite pins 18 — a silently
 *  dropped row fails the count check, the "pinned by enumeration"
 *  guarantee). */
export const PALETTE_COMMAND_COUNT = PALETTE_COMMANDS.length;

/**
 * Is this command enabled at `phase`? A command is enabled when
 * its `disabledIn` does NOT contain the phase.
 */
export function isCommandEnabled(cmd: PaletteCommand, phase: ReviewSession["phase"]): boolean {
  return !cmd.disabledIn.includes(phase);
}

/**
 * Filter the command table by a query (the palette's Ctrl+K input).
 * Pure: returns the matching commands in their original table
 * order (no fuzzy re-rank — the table is short, the order is
 * stable, the hardening lane pins determinism).
 *
 * Matching: case-insensitive substring over the label AND the id
 * AND the group AND the hint.
 *
 * @param query the user's input ("" or null → the full table)
 */
export function filterCommands(query: string | null | undefined): PaletteCommand[] {
  const q = (query ?? "").trim().toLowerCase();
  if (q === "") return PALETTE_COMMANDS;
  return PALETTE_COMMANDS.filter((c) => {
    return (
      c.label.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      c.group.toLowerCase().includes(q) ||
      c.hint.toLowerCase().includes(q)
    );
  });
}

/**
 * The command ids the UI's key handler routes INTO the dispatch
 * (every command's keyboard surface — the enumeration's dispatch
 * side). The palette itself is opened by Ctrl+K (the UI-level
 * binding, not a command). The `1`–`4` + Space/Enter keys are the
 * review loop's own keys (the runner-core's `GRADE_KEYS` +
 * `REVEAL_KEYS` own them); they are NOT in this table because
 * they route through the grade/reveal path, not the palette's
 * command dispatch.
 */
export const COMMAND_KEY_DISPATCH: Record<string, string> = {
  s: "skip",
  S: "skip",
  r: "restart",
  R: "restart",
  j: "next-card",
  k: "prev-card",
  g: "first-card",
  G: "last-card",
  "/": "search",
  n: "create-deck",
  N: "create-deck",
  c: "create-card",
  C: "create-card",
  t: "stats",
  T: "stats",
};

/** The grade → command id mapping (the runner-core's GRADE_LABELS
 *  label → the palette's id). The UI's `gradeKeyToGrade` returns a
 * `Grade`; this table maps it to the palette's command id. */
export const GRADE_COMMAND_ID: Record<Grade, string> = {
  1: "grade-again",
  2: "grade-hard",
  3: "grade-good",
  4: "grade-easy",
};
