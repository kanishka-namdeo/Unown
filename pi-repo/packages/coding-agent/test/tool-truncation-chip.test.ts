/**
 * Move 9 chip propagation (b3-c): every tool render that hides collapsed output
 * carries the same dim truncation chip bash.ts landed (`⋯ N earlier hidden · <key>`)
 * — grep/find/ls result renders, the write call preview, the read error-result
 * preview, the BashExecutionComponent status lane, and the tool-execution
 * fallback. The expand key is resolved dynamically from the keybinding system
 * and the key lane is omitted when no binding resolves.
 */
import { setKeybindings, KeybindingsManager as TuiKeybindingsManager } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import { createFindToolDefinition } from "../src/core/tools/find.ts";
import { createGrepToolDefinition } from "../src/core/tools/grep.ts";
import { createLsToolDefinition } from "../src/core/tools/ls.ts";
import { createReadToolDefinition } from "../src/core/tools/read.ts";
import { createWriteToolDefinition } from "../src/core/tools/write.ts";
import { BashExecutionComponent } from "../src/modes/interactive/components/bash-execution.ts";
import { keyText } from "../src/modes/interactive/components/keybinding-hints.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { loadThemeFromPath, setThemeInstance, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const darkThemePath = new URL("../src/modes/interactive/theme/dark.json", import.meta.url).pathname;

function fakeTui(): any {
	return { requestRender: () => {}, addInterval: () => ({ dispose: () => {} }), removeInterval: () => {} };
}

/** Render a collapsed (non-expanded) tool result through the real component. */
function renderCollapsed(definition: any, args: any, text: string): string {
	const component = new ToolExecutionComponent(
		definition.name,
		"b3c-smoke",
		args,
		{},
		definition,
		fakeTui(),
		process.cwd(),
	);
	component.updateResult({ content: [{ type: "text", text }], details: undefined, isError: false }, false);
	return stripAnsi(component.render(120).join("\n"));
}

describe("b3-c chip propagation smoke", () => {
	beforeAll(() => {
		setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	it("grep result: dim chip with dynamic key, old prose gone", () => {
		const text = Array.from({ length: 25 }, (_, i) => `match ${i + 1}`).join("\n");
		const collapsed = renderCollapsed(createGrepToolDefinition(process.cwd()), { pattern: "x" }, text);
		expect(collapsed).toContain("⋯ 10 earlier hidden");
		expect(collapsed).toContain("ctrl+o"); // keyText("app.tools.expand") under the default manager
		expect(keyText("app.tools.expand")).toBe("ctrl+o");
		expect(collapsed).not.toContain("more lines");
		expect(collapsed).not.toContain("to expand");
	});

	it("find and ls results carry the same chip", () => {
		const text = Array.from({ length: 40 }, (_, i) => `entry ${i + 1}`).join("\n");
		const find = renderCollapsed(createFindToolDefinition(process.cwd()), { pattern: "x" }, text);
		expect(find).toContain("⋯ 20 earlier hidden");
		const ls = renderCollapsed(createLsToolDefinition(process.cwd()), { path: "." }, text);
		expect(ls).toContain("⋯ 20 earlier hidden");
	});

	it("read error result keeps the chip on the error preview path", () => {
		const errorLines = Array.from({ length: 30 }, (_, i) => `error ${i + 1}`).join("\n");
		const definition = createReadToolDefinition(process.cwd());
		const component = new ToolExecutionComponent(
			"read",
			"b3c-smoke-read",
			{ path: "missing.txt" },
			{},
			definition,
			fakeTui(),
			process.cwd(),
		);
		component.updateResult(
			{ content: [{ type: "text", text: errorLines }], details: undefined, isError: true },
			false,
		);
		const collapsed = stripAnsi(component.render(120).join("\n"));
		expect(collapsed).toContain("⋯ 20 earlier hidden");
	});

	it("write call preview carries the chip (no 'total' prose)", () => {
		const content = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join("\n");
		const definition = createWriteToolDefinition(process.cwd());
		const component = new ToolExecutionComponent(
			"write",
			"b3c-smoke-write",
			{ path: "big.txt", content },
			{},
			definition,
			fakeTui(),
			process.cwd(),
		);
		const call = stripAnsi(component.render(120).join("\n"));
		expect(call).toContain("⋯ 15 earlier hidden");
		expect(call).not.toContain("total");
	});

	it("BashExecutionComponent status lane carries the chip", () => {
		const component = new BashExecutionComponent("seq 1 40", fakeTui());
		const lines = Array.from({ length: 40 }, (_, i) => `${i + 1}`).join("\n");
		component.appendOutput(`${lines}\n`);
		component.setComplete(0, false);
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("⋯ 21 earlier hidden"); // 41 logical lines (trailing \n) - 20 previewed
		expect(rendered).not.toContain("more lines");
		expect(rendered).not.toContain("to expand");
		// the expanded branch keeps its collapse hint (unchanged affordance)
		component.setExpanded(true);
		const expanded = stripAnsi(component.render(120).join("\n"));
		expect(expanded).toContain("to collapse");
	});

	it("omits the key lane when no binding resolves (no dangling separator)", () => {
		setKeybindings(new TuiKeybindingsManager({})); // no app.* definitions registered
		const text = Array.from({ length: 25 }, (_, i) => `match ${i + 1}`).join("\n");
		const collapsed = renderCollapsed(createGrepToolDefinition(process.cwd()), { pattern: "x" }, text);
		expect(collapsed).toContain("⋯ 10 earlier hidden");
		expect(collapsed).not.toContain("·");
	});

	it("chip composition uses dim body + dim separator + muted key", () => {
		const text = Array.from({ length: 25 }, (_, i) => `match ${i + 1}`).join("\n");
		const definition = createGrepToolDefinition(process.cwd());
		const component = new ToolExecutionComponent(
			definition.name,
			"b3c-smoke-comp",
			{ pattern: "x" },
			{},
			definition,
			fakeTui(),
			process.cwd(),
		);
		component.updateResult({ content: [{ type: "text", text }], details: undefined, isError: false }, false);
		const raw = component.render(120).join("\n");
		expect(raw).toContain(theme.fg("dim", "⋯ 10 earlier hidden"));
		expect(raw).toContain(theme.fg("dim", " · "));
		expect(raw).toContain(theme.fg("muted", "ctrl+o"));
	});
});
