/**
 * viewport-tiers.ts — the TUI's breakpoint vocabulary.
 *
 * One place that knows how terminal widths map to layout behavior. Both
 * renderers, the components and the extensions (split-view, addons) import
 * the same truth instead of private constants, so the whole UI moves
 * together at a breakpoint.
 *
 * The tiers follow the published practice of the leading agent CLIs
 * (Claude Code's 110/144 column dock model) adapted to pi's surfaces:
 *
 *   narrow  < 80     compact — priority-only footer, no hint strip,
 *                    overlays hug the terminal (86%), split dock hidden
 *   regular 80–109   the default layout (full footer, hints, overlays ~80)
 *   wide    110–143  dock-capable — side panels may appear
 *   ultra   ≥ 144    auto-dockable — side panels may open on their own
 *
 * Everything here is a pure function of the geometry — no state, no I/O —
 * so tests are width tables.
 */

/** The four width tiers, in ascending order. */
export type ViewportTier = "narrow" | "regular" | "wide" | "ultra";

/** Tier boundaries in terminal columns (inclusive lower bounds). */
export const VIEWPORT_TIER_BOUNDS: Readonly<Record<ViewportTier, number>> = {
	narrow: 0,
	regular: 80,
	wide: 110,
	ultra: 144,
};

/** Map a terminal width to its tier. */
export function viewportTier(width: number): ViewportTier {
	if (width >= VIEWPORT_TIER_BOUNDS.ultra) return "ultra";
	if (width >= VIEWPORT_TIER_BOUNDS.wide) return "wide";
	if (width >= VIEWPORT_TIER_BOUNDS.regular) return "regular";
	return "narrow";
}

/** True when the width is in the compact tier (below 80 columns). */
export function isCompactViewport(width: number): boolean {
	return viewportTier(width) === "narrow";
}

/**
 * The smallest geometry the fullscreen layout will render into. Below it
 * the renderer shows the "terminal too small" notice instead of a broken
 * layout (see `isTerminalTooSmall`); regular mode has no gate — scrollback
 * tolerates any width, its chrome simply degrades by tier.
 */
export const MIN_TERMINAL_COLS = 48;
export const MIN_TERMINAL_ROWS = 16;

/** True when the fullscreen layout should refuse to render (too small). */
export function isTerminalTooSmall(cols: number, rows: number): boolean {
	return cols < MIN_TERMINAL_COLS || rows < MIN_TERMINAL_ROWS;
}

/**
 * Default overlay width for a terminal width.
 *
 * History: overlays used to default to `min(80, width)` — a constant from a
 * time when 80-column terminals were the norm. At 56 cols that made a
 * selector full-bleed edge to edge; at 200 cols it hugged the left margin.
 * Now: 86% of the width, rounded, clamped to a [40, 96] band so an overlay
 * never becomes unreadably narrow nor pointlessly wide. `preferred`
 * (a caller's explicit wish) wins whenever it fits the terminal.
 */
export const OVERLAY_MIN_WIDTH = 40;
export const OVERLAY_MAX_WIDTH = 96;

export function overlayWidthFor(width: number, preferred?: number): number {
	if (preferred !== undefined && preferred >= 1) {
		return Math.max(1, Math.min(preferred, width));
	}
	const proportional = Math.round((width * 86) / 100);
	const clamped = Math.max(OVERLAY_MIN_WIDTH, Math.min(OVERLAY_MAX_WIDTH, proportional));
	return Math.max(1, Math.min(clamped, width));
}
