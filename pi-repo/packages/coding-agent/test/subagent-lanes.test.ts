import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_LANE_COUNT, stableLaneIndex } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import {
	hasSubagentLanePalette,
	SUBAGENT_LANE_TOKENS,
	subagentLaneColor,
	subagentLaneIndex,
	subagentLaneToken,
	taskToolChildName,
} from "../src/modes/interactive/components/subagent-lanes.ts";
import { loadThemeFromPath, setThemeInstance } from "../src/modes/interactive/theme/theme.ts";

/**
 * Per-subagent color lanes (beauty-4): every spawned subagent — fleet children
 * and sync task-tool blocks alike — gets one of eight lane colors, assigned by
 * a deterministic hash of its name (stable across renders and restarts). The
 * eight tokens are OPTIONAL theme tokens: legacy themes fall back to the
 * terminal-default fg exactly like chromeBg, and consumers treat an absent
 * palette as "no lanes" so legacy rendering stays byte-identical.
 */

const darkThemePath = new URL("../src/modes/interactive/theme/dark.json", import.meta.url).pathname;
const lightThemePath = new URL("../src/modes/interactive/theme/light.json", import.meta.url).pathname;
const tempDirs: string[] = [];

function loadDarkTheme(): { name: string; colors: Record<string, string | number> } {
	return JSON.parse(readFileSync(darkThemePath, "utf8")) as {
		name: string;
		colors: Record<string, string | number>;
	};
}

function writeTheme(theme: { name: string; colors: Record<string, string | number> }): string {
	const testDir = mkdtempSync(join(tmpdir(), "pi-subagent-lanes-"));
	tempDirs.push(testDir);
	const themePath = join(testDir, `${theme.name}.json`);
	writeFileSync(themePath, JSON.stringify(theme));
	return themePath;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("lane assignment", () => {
	it("exposes exactly 8 lane tokens matching the theme schema", () => {
		expect(SUBAGENT_LANE_TOKENS).toHaveLength(8);
		expect(SUBAGENT_LANE_TOKENS).toEqual([
			"subagentLane0",
			"subagentLane1",
			"subagentLane2",
			"subagentLane3",
			"subagentLane4",
			"subagentLane5",
			"subagentLane6",
			"subagentLane7",
		]);
	});

	it("assigns the same lane to the same name forever (stable across renders/restarts)", () => {
		for (const name of ["scout", "worker", "researcher", "scout-2", "refactor-ast"]) {
			const lane = subagentLaneIndex(name);
			expect(lane).toBe(stableLaneIndex(name, 8));
			expect(lane).toBe(subagentLaneIndex(name));
			expect(lane).toBeGreaterThanOrEqual(0);
			expect(lane).toBeLessThan(DEFAULT_LANE_COUNT);
		}
	});

	it("spreads a realistic roster across all 8 lanes", () => {
		const names = [
			"scout",
			"worker",
			"researcher",
			"explore",
			"general",
			"reviewer",
			"planner",
			"mapper",
			"analyzer",
			"tester",
			"implementer",
			"debugger",
			"optimizer",
			"documenter",
			"architect",
			"auditor",
		];
		expect(new Set(names.map((n) => subagentLaneIndex(n))).size).toBe(8);
	});

	it("wraps the lane token index into [0, 8)", () => {
		expect(subagentLaneToken(0)).toBe("subagentLane0");
		expect(subagentLaneToken(8)).toBe("subagentLane0");
		expect(subagentLaneToken(-1)).toBe("subagentLane7");
		expect(subagentLaneToken(15)).toBe("subagentLane7");
	});
});

describe("taskToolChildName (which child a task block belongs to)", () => {
	it("prefers the fleet label, then the sync agent name, defaulting to general", () => {
		expect(taskToolChildName({ name: "scout", agent: "explore" })).toBe("scout");
		expect(taskToolChildName({ agent: "explore" })).toBe("explore");
		expect(taskToolChildName({})).toBe("general");
		expect(taskToolChildName(undefined)).toBe("general");
	});

	it("trims whitespace so padded labels do not fork lanes", () => {
		expect(taskToolChildName({ name: "  scout  " })).toBe("scout");
		expect(taskToolChildName({ agent: " " })).toBe("general");
	});

	it("takes the agent of a single-task fan-out but none for multi-task fan-outs", () => {
		expect(taskToolChildName({ tasks: [{ agent: "reviewer", task: "x" }] })).toBe("reviewer");
		expect(taskToolChildName({ tasks: [{ task: "x" }] })).toBe("general");
		expect(taskToolChildName({ tasks: [] })).toBeUndefined();
		expect(
			taskToolChildName({
				tasks: [
					{ agent: "a", task: "x" },
					{ agent: "b", task: "y" },
				],
			}),
		).toBeUndefined();
	});
});

describe("lane palette presence + fallbacks (the chromeBg precedent)", () => {
	it("dark/light ship the palette; subagentLaneColor paints with the lane token", () => {
		const dark = loadThemeFromPath(darkThemePath, "truecolor");
		setThemeInstance(dark);
		expect(hasSubagentLanePalette()).toBe(true);
		// subagentLaneColor resolves through the same token the hash picks.
		const token = subagentLaneToken(subagentLaneIndex("scout"));
		expect(subagentLaneColor("scout", "✓")).toBe(`${dark.getFgAnsi(token)}✓\x1b[39m`);

		setThemeInstance(loadThemeFromPath(lightThemePath, "truecolor"));
		expect(hasSubagentLanePalette()).toBe(true);
	});

	it("legacy themes without lane tokens fall back to the terminal-default fg", () => {
		const themeJson = loadDarkTheme();
		themeJson.name = "legacy-lane-theme";
		for (const token of SUBAGENT_LANE_TOKENS) delete themeJson.colors[token];
		const legacy = loadThemeFromPath(writeTheme(themeJson), "truecolor");
		setThemeInstance(legacy);

		expect(hasSubagentLanePalette()).toBe(false);
		for (const token of SUBAGENT_LANE_TOKENS) {
			expect(legacy.getFgAnsi(token)).toBe("\x1b[39m");
			expect(legacy.getFgRgb(token)).toBeUndefined();
		}
	});

	it("a partial palette keeps the defined lanes and defaults the rest", () => {
		const themeJson = loadDarkTheme();
		themeJson.name = "partial-lane-theme";
		for (const token of SUBAGENT_LANE_TOKENS.slice(1)) delete themeJson.colors[token];
		const partial = loadThemeFromPath(writeTheme(themeJson), "truecolor");
		setThemeInstance(partial);

		expect(partial.getFgAnsi("subagentLane0")).toBe("\x1b[38;2;95;135;215m");
		expect(partial.getFgAnsi("subagentLane7")).toBe("\x1b[39m");
	});

	it("dark/light lane values are 256-ladder-exact (they quantize onto themselves)", () => {
		// The beauty-1 contract: every hand-tuned hex is a cube entry, so the
		// 256-color quantizer can never drift a lane onto a neon neighbor.
		const dark256 = loadThemeFromPath(darkThemePath, "256color");
		const expectedDark = [68, 74, 79, 149, 179, 173, 168, 134];
		for (let i = 0; i < 8; i++) {
			expect(dark256.getFgAnsi(SUBAGENT_LANE_TOKENS[i])).toBe(`\x1b[38;5;${expectedDark[i]}m`);
		}
		const light256 = loadThemeFromPath(lightThemePath, "256color");
		const expectedLight = [25, 31, 29, 64, 136, 166, 125, 91];
		for (let i = 0; i < 8; i++) {
			expect(light256.getFgAnsi(SUBAGENT_LANE_TOKENS[i])).toBe(`\x1b[38;5;${expectedLight[i]}m`);
		}
	});

	it("lane tokens stay unstyled in plain mode", () => {
		const plain = loadThemeFromPath(darkThemePath, "plain");
		for (const token of SUBAGENT_LANE_TOKENS) {
			expect(plain.getFgAnsi(token)).toBe("");
		}
	});
});
