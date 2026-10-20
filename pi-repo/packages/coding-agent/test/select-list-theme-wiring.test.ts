import { SelectList, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { getSelectListTheme, loadThemeFromPath, setThemeInstance } from "../src/modes/interactive/theme/theme.ts";

const darkThemePath = new URL("../src/modes/interactive/theme/dark.json", import.meta.url).pathname;
// dark.json: overlayBg = overlay var (#1c1c24), selectedBg = selection var (#303030),
// accent = teal (#56b6c2), muted = #7d8799
const overlayBgPrefix = "\x1b[48;2;28;28;36m";
const selectedBgPrefix = "\x1b[48;2;48;48;48m";
const accentPrefix = "\x1b[38;2;86;182;194m";
const mutedPrefix = "\x1b[38;2;125;135;153m";
const fgReset = "\x1b[39m";
const bgReset = "\x1b[49m";

describe("select-list theme wiring (beauty move 8)", () => {
	it("wires the body surface to overlayBg and the selected row to selectedBg (truecolor)", () => {
		setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
		const selectTheme = getSelectListTheme();
		expect(selectTheme.background).toBeTypeOf("function");
		expect(selectTheme.selectedRowStyle).toBeTypeOf("function");
		expect(selectTheme.background?.("row")).toBe(`${overlayBgPrefix}row${bgReset}`);
		expect(selectTheme.selectedRowStyle?.("bar")).toBe(`${selectedBgPrefix}bar${bgReset}`);
	});

	it("keeps every legacy member wired (accent selection, muted metadata)", () => {
		setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
		const selectTheme = getSelectListTheme();
		expect(selectTheme.selectedPrefix("▌")).toBe(`${accentPrefix}▌${fgReset}`);
		expect(selectTheme.selectedText("alpha")).toBe(`${accentPrefix}alpha${fgReset}`);
		expect(selectTheme.description("d")).toBe(`${mutedPrefix}d${fgReset}`);
		expect(selectTheme.scrollInfo("1/8")).toBe(`${mutedPrefix}1/8${fgReset}`);
		expect(selectTheme.noMatch("none")).toBe(`${mutedPrefix}none${fgReset}`);
	});

	it("renders a raised selected row: selectedBg bar, accent rail at column 0, exact width", () => {
		setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
		const selectTheme = getSelectListTheme();
		const list = new SelectList(
			[
				{ value: "alpha", label: "alpha" },
				{ value: "beta", label: "beta" },
			],
			5,
			selectTheme,
		);
		const rendered = list.render(40);

		const selected = rendered[0]!;
		// Full-width bar + 1-cell accent rail at column 0.
		expect(visibleWidth(selected)).toBe(40);
		expect(stripTerminalSequences(selected)).toBe("▌ alpha".padEnd(40));
		expect(selected).toContain(selectTheme.selectedPrefix("▌"));
		expect(selected).toContain(selectTheme.selectedText("alpha"));
		// Byte-exact shape: selectedRowStyle(selectedPrefix(rail) + " " + selectedText(content) + padding).
		const expectedSelected = selectTheme.selectedRowStyle?.(
			`${selectTheme.selectedPrefix("▌")} ${selectTheme.selectedText("alpha")}${" ".repeat(33)}`,
		);
		expect(selected).toBe(expectedSelected);

		// Non-selected body rows ride the overlayBg surface, padded first.
		const body = rendered[1]!;
		expect(visibleWidth(body)).toBe(40);
		expect(stripTerminalSequences(body)).toBe("  beta".padEnd(40));
		expect(body).toBe(selectTheme.background?.("  beta".padEnd(40)));
	});

	it("passes rows through unchanged in plain mode", () => {
		setThemeInstance(loadThemeFromPath(darkThemePath, "plain"));
		const selectTheme = getSelectListTheme();
		expect(selectTheme.background?.("row")).toBe("row");
		expect(selectTheme.selectedRowStyle?.("bar")).toBe("bar");
		expect(selectTheme.selectedText("alpha")).toBe("alpha");
		expect(selectTheme.description("d")).toBe("d");
	});
});
