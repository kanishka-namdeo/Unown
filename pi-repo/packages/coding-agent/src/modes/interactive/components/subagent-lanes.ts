import { stableLaneIndex } from "@earendil-works/pi-tui";
import { type ThemeColor, theme } from "../theme/theme.ts";

/**
 * subagent-lanes.ts — one stable color lane per subagent (beauty-4).
 *
 * Every spawned subagent — fleet children and sync task-tool blocks alike —
 * gets one of eight lane colors, assigned by a deterministic hash of its name
 * (pi-tui's stableLaneIndex), so a child keeps its color across renders and
 * restarts and sibling children stay distinguishable at a glance. The Claude
 * Code precedent: "each subagent and parallel task ... one of eight named
 * colors".
 *
 * The eight tokens (subagentLane0..7) are OPTIONAL theme tokens: themes that
 * predate them fall back to "" (terminal default fg) exactly like chromeBg,
 * and consumers treat a "" palette as "no lanes" so legacy rendering stays
 * byte-identical (state-colored glyphs, no fleet rail).
 */

export const SUBAGENT_LANE_COUNT = 8;

export const SUBAGENT_LANE_TOKENS = [
	"subagentLane0",
	"subagentLane1",
	"subagentLane2",
	"subagentLane3",
	"subagentLane4",
	"subagentLane5",
	"subagentLane6",
	"subagentLane7",
] as const satisfies readonly ThemeColor[];

export type SubagentLaneToken = (typeof SUBAGENT_LANE_TOKENS)[number];

/** The stable lane index for a child name (0..7, same hash the fleet widget uses). */
export function subagentLaneIndex(name: string): number {
	return stableLaneIndex(name, SUBAGENT_LANE_COUNT);
}

export function subagentLaneToken(lane: number): SubagentLaneToken {
	const index = ((lane % SUBAGENT_LANE_COUNT) + SUBAGENT_LANE_COUNT) % SUBAGENT_LANE_COUNT;
	return SUBAGENT_LANE_TOKENS[index];
}

/**
 * Whether the active theme carries a lane palette. Omitted tokens resolve to
 * "" (the legacy fallback), and "" has no RGB value — so any concrete lane0
 * means the theme opted in.
 */
export function hasSubagentLanePalette(): boolean {
	return theme.getFgRgb(subagentLaneToken(0)) !== undefined;
}

/** Paint text in the child's lane color. Only meaningful when the palette exists. */
export function subagentLaneColor(childName: string, text: string): string {
	return theme.fg(subagentLaneToken(subagentLaneIndex(childName)), text);
}

/**
 * The child identity a task-tool call block should take its lane from:
 * the fleet label (name) first — it is what the fleet widget shows — then the
 * sync agent name (defaulting to "general", the task tool's own default).
 * Parallel fan-outs (tasks[]) have no single child, so they carry no single
 * lane; their per-agent summary lines are colored individually instead.
 */
export function taskToolChildName(args: unknown): string | undefined {
	const a = (args ?? {}) as Record<string, unknown>;
	if (typeof a.name === "string" && a.name.trim()) {
		return a.name.trim();
	}
	if (Array.isArray(a.tasks)) {
		if (a.tasks.length === 1) {
			const agent = (a.tasks[0] as { agent?: unknown } | undefined)?.agent;
			return typeof agent === "string" && agent.trim() ? agent.trim() : "general";
		}
		return undefined;
	}
	if (typeof a.agent === "string" && a.agent.trim()) {
		return a.agent.trim();
	}
	return "general";
}
