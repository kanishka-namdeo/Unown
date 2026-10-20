import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import {
	SUBAGENT_LANE_TOKENS,
	subagentLaneIndex,
	subagentLaneToken,
} from "../src/modes/interactive/components/subagent-lanes.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { loadThemeFromPath, setThemeInstance } from "../src/modes/interactive/theme/theme.ts";

/**
 * Per-subagent color lanes on the tool-execution rail (beauty-4): sync
 * task-tool blocks tint their state-glyph column with the child's lane color —
 * the glyph shape still names the state, and themes without the optional lane
 * palette keep the legacy state colors byte-identical.
 */

const darkThemePath = new URL("../src/modes/interactive/theme/dark.json", import.meta.url).pathname;
const tempDirs: string[] = [];

function createFakeTui(): TUI {
	return { requestRender: () => {} } as unknown as TUI;
}

const SUCCESS_RESULT = {
	content: [{ type: "text", text: "done" }],
	details: {},
	isError: false,
};

const ERROR_RESULT = {
	content: [{ type: "text", text: "boom" }],
	details: {},
	isError: true,
};

function firstLine(component: ToolExecutionComponent): string {
	return component.render(120).find((l) => l.trim().length > 0) ?? "";
}

function writeLegacyTheme(): string {
	const themeJson = JSON.parse(readFileSync(darkThemePath, "utf8")) as {
		name: string;
		colors: Record<string, string | number>;
	};
	themeJson.name = "legacy-lane-glyph-theme";
	for (const token of SUBAGENT_LANE_TOKENS) delete themeJson.colors[token];
	const dir = mkdtempSync(join(tmpdir(), "pi-tool-exec-lanes-"));
	tempDirs.push(dir);
	const themePath = join(dir, `${themeJson.name}.json`);
	writeFileSync(themePath, JSON.stringify(themeJson));
	return themePath;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("ToolExecutionComponent subagent lanes (beauty-4)", () => {
	it("tints the task-tool glyph column with the child's lane when the palette exists", () => {
		const dark = loadThemeFromPath(darkThemePath, "truecolor");
		setThemeInstance(dark);

		for (const child of ["scout", "worker", "reviewer", "refactor-ast"]) {
			const component = new ToolExecutionComponent(
				"task",
				`t-${child}`,
				{ agent: child },
				{},
				undefined,
				createFakeTui(),
				process.cwd(),
			);
			component.updateResult(SUCCESS_RESULT, false);
			const token = subagentLaneToken(subagentLaneIndex(child));
			expect(firstLine(component)).toContain(`${dark.getFgAnsi(token)}✓\x1b[39m`);
		}
	});

	it("takes the lane from the fleet label (name) first, like the fleet widget", () => {
		const dark = loadThemeFromPath(darkThemePath, "truecolor");
		setThemeInstance(dark);

		const component = new ToolExecutionComponent(
			"task",
			"t-named",
			{ agent: "explore", name: "scout" },
			{},
			undefined,
			createFakeTui(),
			process.cwd(),
		);
		component.updateResult(SUCCESS_RESULT, false);
		const scout = subagentLaneToken(subagentLaneIndex("scout"));
		const explore = subagentLaneToken(subagentLaneIndex("explore"));
		const line = firstLine(component);
		expect(line).toContain(`${dark.getFgAnsi(scout)}✓\x1b[39m`);
		expect(line).not.toContain(`${dark.getFgAnsi(explore)}✓\x1b[39m`);
	});

	it("keeps the glyph shape per state: • partial, ✓ success, ✗ error — only the hue changes", () => {
		const dark = loadThemeFromPath(darkThemePath, "truecolor");
		setThemeInstance(dark);
		const token = subagentLaneToken(subagentLaneIndex("scout"));

		const partial = new ToolExecutionComponent(
			"task",
			"t-partial",
			{ agent: "scout" },
			{},
			undefined,
			createFakeTui(),
			process.cwd(),
		);
		expect(firstLine(partial)).toContain(`${dark.getFgAnsi(token)}•\x1b[39m`);

		const failed = new ToolExecutionComponent(
			"task",
			"t-failed",
			{ agent: "scout" },
			{},
			undefined,
			createFakeTui(),
			process.cwd(),
		);
		failed.updateResult(ERROR_RESULT, false);
		expect(firstLine(failed)).toContain(`${dark.getFgAnsi(token)}✗\x1b[39m`);
	});

	it("carries no single lane for parallel fan-outs (tasks[] with several children)", () => {
		const dark = loadThemeFromPath(darkThemePath, "truecolor");
		setThemeInstance(dark);

		const component = new ToolExecutionComponent(
			"task",
			"t-fanout",
			{
				tasks: [
					{ agent: "a", task: "x" },
					{ agent: "b", task: "y" },
				],
			},
			{},
			undefined,
			createFakeTui(),
			process.cwd(),
		);
		component.updateResult(SUCCESS_RESULT, false);
		// State-colored glyph, not any single child's lane.
		expect(firstLine(component)).toContain(`${dark.getFgAnsi("success")}✓\x1b[39m`);
	});

	it("keeps other tools on their state colors even with a lane palette on", () => {
		const dark = loadThemeFromPath(darkThemePath, "truecolor");
		setThemeInstance(dark);

		const component = new ToolExecutionComponent(
			"edit",
			"t-edit",
			{ path: "a.ts" },
			{},
			undefined,
			createFakeTui(),
			process.cwd(),
		);
		component.updateResult(SUCCESS_RESULT, false);
		const line = firstLine(component);
		expect(line).toContain(`${dark.getFgAnsi("success")}✓\x1b[39m`);
		for (const token of SUBAGENT_LANE_TOKENS) {
			expect(line).not.toContain(`${dark.getFgAnsi(token)}✓`);
		}
	});

	it("legacy themes (no lane tokens) keep the state-colored glyphs byte-identical", () => {
		const legacy = loadThemeFromPath(writeLegacyTheme(), "truecolor");
		setThemeInstance(legacy);

		const component = new ToolExecutionComponent(
			"task",
			"t-legacy",
			{ agent: "scout" },
			{},
			undefined,
			createFakeTui(),
			process.cwd(),
		);
		component.updateResult(SUCCESS_RESULT, false);
		const line = firstLine(component);
		expect(line).toContain(`${legacy.getFgAnsi("success")}✓\x1b[39m`);
		for (const token of SUBAGENT_LANE_TOKENS) {
			expect(line).not.toContain(`${legacy.getFgAnsi(token)}✓`);
		}
	});

	it("keeps every rendered line width-safe with the lane escapes present", () => {
		setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
		const component = new ToolExecutionComponent(
			"task",
			"t-width",
			{ agent: "scout" },
			{},
			undefined,
			createFakeTui(),
			process.cwd(),
		);
		component.updateResult(SUCCESS_RESULT, false);
		for (const width of [30, 60, 120]) {
			for (const line of component.render(width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});
});
