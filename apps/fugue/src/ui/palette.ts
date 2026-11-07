/**
 * palette.ts — the Fugue command palette (Ctrl+K, the ostinato kin).
 *
 * DOM-free command table + filter semantics; the DOM wiring (open /
 * close / key handling) lives in app.ts.
 * 15 commands covering every P0 action: new job, run now, pause,
 * resume, skip, snooze, refresh, export, import, theme, help, and the
 * learning band's routes (dreams, memory, skills, manual-notes).
 */

/** One palette command (the closed P0 action set + the meta actions). */
export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  enabled: (ctx: PaletteCtx) => boolean;
}

/** The minimal context a command needs to be enabled. */
export interface PaletteCtx {
  selectedJobId: number | null;
  selectedJobState: "active" | "paused" | null;
  hasData: boolean;
}

/** The 15-command table (one per P0 action + the learning band). */
export const PALETTE_COMMANDS: readonly PaletteCommand[] = [
  {
    id: "new-job",
    label: "New job",
    hint: "open the compose dialog",
    enabled: () => true,
  },
  {
    id: "run-now",
    label: "Run now",
    hint: "trigger the selected job immediately",
    enabled: (c) => c.selectedJobId !== null,
  },
  {
    id: "pause",
    label: "Pause",
    hint: "pause the selected job",
    enabled: (c) => c.selectedJobState === "active",
  },
  {
    id: "resume",
    label: "Resume",
    hint: "resume the selected job",
    enabled: (c) => c.selectedJobState === "paused",
  },
  {
    id: "skip",
    label: "Skip",
    hint: "skip the selected job's next occurrence",
    enabled: (c) => c.selectedJobId !== null,
  },
  {
    id: "snooze",
    label: "Snooze",
    hint: "push the selected job's next run back",
    enabled: (c) => c.selectedJobId !== null,
  },
  {
    id: "refresh",
    label: "Refresh",
    hint: "re-fetch the engine lane",
    enabled: () => true,
  },
  {
    id: "export",
    label: "Export",
    hint: "download the store as canonical JSON",
    enabled: (c) => c.hasData,
  },
  {
    id: "import",
    label: "Import",
    hint: "load a canonical-JSON store (schema-gated)",
    enabled: () => true,
  },
  {
    id: "theme",
    label: "Toggle theme",
    hint: "switch light / dark",
    enabled: () => true,
  },
  {
    id: "help",
    label: "Help",
    hint: "show the key surface",
    enabled: () => true,
  },
  // F-7 chunk 2: the learning band's two routes (the dreams journal
  // + the tiered-memory view). Both are always enabled — the
  // load helper's honest catch surfaces a failed lane, the palette
  // itself never gates them on job selection.
  {
    id: "open-dreams",
    label: "Open dreams journal",
    hint: "the AutoDream consolidation log (newest first)",
    enabled: () => true,
  },
  {
    id: "open-memory",
    label: "Open memory view",
    hint: "the tiered memory + health card",
    enabled: () => true,
  },
  // F-7 chunk 3: the learning band's second half — the skills view
  // (the staged queue, read-only + the engine's skills) and the
  // Manual-notes editor (the ONE hand-edit lane, marked unverified in
  // the render). Both are always enabled, like their dreams/memory
  // kin: the load helper's honest catch surfaces a failed lane.
  {
    id: "open-skills",
    label: "Open skills",
    hint: "the staged queue (read-only) + the engine's skills",
    enabled: () => true,
  },
  {
    id: "open-manual-notes",
    label: "Open manual notes",
    hint: "the hand-edited memory lane (unverified in the render)",
    enabled: () => true,
  },
];

export const PALETTE_BY_ID: Record<string, PaletteCommand> = Object.fromEntries(
  PALETTE_COMMANDS.map((c) => [c.id, c]),
) as Record<string, PaletteCommand>;

/** Filter the command table by a (case-insensitive) substring match
 *  over `label` and `id`. The DOM-free kin of the ostinato filter. */
export function filterCommands(filter: string, ctx: PaletteCtx): PaletteCommand[] {
  const f = filter.trim().toLowerCase();
  if (!f) return PALETTE_COMMANDS.filter((c) => c.enabled(ctx));
  return PALETTE_COMMANDS.filter(
    (c) => c.enabled(ctx) && (c.label.toLowerCase().includes(f) || c.id.includes(f)),
  );
}

/** Is this command currently enabled? (The DOM lane consults this to
 *  dim rows and disable the Enter pick.) */
export function isCommandEnabled(id: string, ctx: PaletteCtx): boolean {
  const c = PALETTE_BY_ID[id];
  return c ? c.enabled(ctx) : false;
}
