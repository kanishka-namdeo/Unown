/**
 * color-lanes.ts — stable color-lane assignment for named actors.
 *
 * Multi-actor surfaces (a subagent fleet, parallel task runs) give every named
 * actor one of a fixed number of color "lanes" so its rows stay recognizable
 * across renders and restarts: the lane comes from a deterministic hash of the
 * actor's name, never from arrival order (which reshuffles on every relist).
 * The Claude Code subagent precedent: one of eight named colors per agent.
 *
 * Pure module: no terminal, no theme — consumers map the lane index onto
 * their own palette (theme tokens, 256-color entries, ...).
 */

export const DEFAULT_LANE_COUNT = 8;

/** FNV-1a 32-bit — small, stable across runtimes, dependency-free. */
function fnv1a(text: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/**
 * The stable lane for a named actor: the same name always lands in the same
 * lane (render to render, run to run, restart to restart); distinct names
 * spread over the lanes (see the spread test — 8 lanes cover all 8 within 32
 * typical agent names).
 */
export function stableLaneIndex(name: string, laneCount: number = DEFAULT_LANE_COUNT): number {
	const count = Math.max(1, Math.floor(laneCount));
	return fnv1a(name) % count;
}
