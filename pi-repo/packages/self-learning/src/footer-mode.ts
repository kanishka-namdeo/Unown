/**
 * footer-mode.ts — the footer quiet round's kill switch, self-learning side.
 *
 * `UNOWN_FOOTER_CLASSIC=1` restores the pre-round footer everywhere it
 * changed: the vendored four-row layout (coding-agent's
 * `isFooterClassicMode`, which this mirrors — one env var, two layers) AND
 * the ambient chips this package used to paint unconditionally (the engine
 * up-state with its memory bar, mcp's healthy line, lsp's ready line, the
 * conf and goal-active chips the mission panel already carries). In the
 * default quiet layout those chips paint only when they need attention —
 * failures, blocked/degraded states, active work — and carry a priority
 * that orders the footer's attention row (critical 2 > active 1 > default 0).
 *
 * Pure module: no pi imports, no fs. Read per call (never cached) so tests
 * and embedders can flip it without a rebuild — the same posture as the
 * vendored check.
 */

/** Footer chip priorities (the attention row's sort key — higher first). */
export const FOOTER_PRIORITY = {
	/** Critical: failures, blockers and standing conditions the user must act on
	 *  (health ✗, engine down/blocked/paused/stale, model unconfigured, mcp
	 *  failures/withheld, lsp restarts exhausted). */
	critical: 2,
	/** Active: work in flight or fresh events worth a row (plan, fleet, review,
	 *  update, goal transitions, feed, delegation, turn meter, lsp restarting). */
	active: 1,
	/** Default: extension chips that never asked for a priority (the vendored
	 *  footer renders them last, key-alphabetical). */
	default: 0,
} as const;

/** Is the classic (pre-round) footer active? UNOWN_FOOTER_CLASSIC=1. */
export function footerClassicMode(env: Record<string, string | undefined> = process.env): boolean {
	return (env.UNOWN_FOOTER_CLASSIC ?? "") === "1";
}
