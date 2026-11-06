/**
 * Chaconne — the command palette's DOM-free core (C-3, P0 #4; the
 * Ostinato palette.ts precedent).
 *
 * The hardening row: "every P0 action reachable — pinned by
 * enumeration." Every P0 action is a row in `PALETTE_COMMANDS`; the
 * UI's dispatch + the test's count assertion both read this table, so
 * a silently dropped row fails the suite.
 *
 * Command set (the P0 action list from the ticket):
 *   recipes  — new-recipe, edit-recipe, delete-recipe
 *   runs     — run-recipe (honest "not scheduled yet" placeholder,
 *               the C-4 integration; no runner invocation in C-3),
 *              view-run, view-artifact, delete-run
 *   data     — export, import
 *   app      — go-recipes, go-runs (the two main routes)
 *
 * Selection context: the commands need a TARGET (which recipe to
 * edit/delete/run, which run to view, which artifact to open). The
 * UI passes the current selection through `Selection` — the table
 * itself stays pure data; `isCommandEnabled` consults the selection +
 * the route to decide dimmed-vs-active (the Ostinato disabledIn law:
 * a command that cannot apply dims, never hides — the enumeration
 * stays total).
 */

/** The routes the shell renders (app.ts's route-by-route contract). */
export type ChaconneRoute = "recipes" | "runs" | "artifact";

/** What the user has selected on the current route. */
export type Selection = {
  /** recipes route: the focused recipe (edit/delete/run target). */
  recipeId: number | null;
  /** runs route: the focused run (view/delete target). */
  runId: number | null;
  /** runs route: whether the focused run carries at least one artifact. */
  runHasArtifacts: boolean;
  /** artifact route: the focused artifact (always non-null there). */
  artifactRunId: number | null;
};

/** The palette groups in render order. */
export const PALETTE_GROUPS = ["recipes", "runs", "data", "app"] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

export type PaletteCommand = {
  id: string;
  label: string;
  /** honest copy: the keyboard hint (no bound key → "Ctrl+K"). */
  hint: string;
  group: PaletteGroup;
  /**
   * Per-row applicability. `true` = always enabled (the enumeration
   * stays total: rows dim via this function, never vanish).
   */
  enabled: (sel: Selection, route: ChaconneRoute) => boolean;
};

const hasRecipe = (s: Selection) => s.recipeId !== null;
const hasRun = (s: Selection) => s.runId !== null;
const hasArtifact = (s: Selection) => s.artifactRunId !== null;

/**
 * THE command table — every P0 action. The test suite pins the count
 * and the ids (the "pinned by enumeration" guarantee): new recipe,
 * edit, delete, run, view run, view artifact, export, import, + the
 * honest delete-run + route rows.
 */
export const PALETTE_COMMANDS: PaletteCommand[] = [
  { id: "new-recipe", label: "New recipe", hint: "N", group: "recipes", enabled: () => true },
  {
    id: "edit-recipe",
    label: "Edit recipe",
    hint: "E",
    group: "recipes",
    enabled: (s) => hasRecipe(s),
  },
  {
    id: "delete-recipe",
    label: "Delete recipe",
    hint: "Ctrl+K",
    group: "recipes",
    enabled: (s) => hasRecipe(s),
  },
  {
    id: "run-recipe",
    label: "Run recipe (not scheduled yet — C-4)",
    hint: "R",
    group: "runs",
    enabled: (s) => hasRecipe(s),
  },
  {
    id: "view-run",
    label: "View run",
    hint: "V",
    group: "runs",
    enabled: (s) => hasRun(s),
  },
  {
    id: "delete-run",
    label: "Delete run",
    hint: "Ctrl+K",
    group: "runs",
    enabled: (s) => hasRun(s),
  },
  {
    id: "view-artifact",
    label: "View artifact",
    hint: "A",
    group: "runs",
    enabled: (s) => hasArtifact(s) || s.runHasArtifacts,
  },
  { id: "export", label: "Export data (JSON)", hint: "Ctrl+E", group: "data", enabled: () => true },
  { id: "import", label: "Import data (JSON)", hint: "Ctrl+O", group: "data", enabled: () => true },
  { id: "go-recipes", label: "Go to recipes", hint: "1", group: "app", enabled: () => true },
  { id: "go-runs", label: "Go to run history", hint: "2", group: "app", enabled: () => true },
];

/** id → command (dispatch lookup). */
export const PALETTE_BY_ID: Record<string, PaletteCommand> = Object.fromEntries(
  PALETTE_COMMANDS.map((c) => [c.id, c]),
);

/** The total count (the test suite pins 11 — a dropped row fails). */
export const PALETTE_COMMAND_COUNT = PALETTE_COMMANDS.length;

export function isCommandEnabled(cmd: PaletteCommand, sel: Selection, route: ChaconneRoute): boolean {
  return cmd.enabled(sel, route);
}

/**
 * Filter the table by query (the Ctrl+K input). Case-insensitive
 * substring over label AND id AND group AND hint — the Ostinato
 * filterCommands law (stable table order, no re-rank).
 */
export function filterCommands(query: string | null | undefined): PaletteCommand[] {
  const q = (query ?? "").trim().toLowerCase();
  if (q === "") return PALETTE_COMMANDS;
  return PALETTE_COMMANDS.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      c.group.toLowerCase().includes(q) ||
      c.hint.toLowerCase().includes(q),
  );
}

/**
 * The key dispatch map — the letters the palette's rows advertise as
 * bound. The shell's keydown handler routes these INTO dispatchCommand
 * (the Ostinato COMMAND_KEY_DISPATCH pattern). Modifier keys (Ctrl+K
 * palette open, Ctrl+E/O) are owned by the shell, not this table.
 */
export const COMMAND_KEY_DISPATCH: Record<string, string> = {
  n: "new-recipe",
  N: "new-recipe",
  e: "edit-recipe",
  E: "edit-recipe",
  r: "run-recipe",
  R: "run-recipe",
  v: "view-run",
  V: "view-run",
  a: "view-artifact",
  A: "view-artifact",
  "1": "go-recipes",
  "2": "go-runs",
};
