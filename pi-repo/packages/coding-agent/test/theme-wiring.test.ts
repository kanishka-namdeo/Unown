import { describe, expect, it } from "vitest";
import {
	getEditorTheme,
	getMarkdownTheme,
	loadThemeFromPath,
	setThemeInstance,
	theme,
} from "../src/modes/interactive/theme/theme.ts";

const darkThemePath = new URL("../src/modes/interactive/theme/dark.json", import.meta.url).pathname;
// dark.json accents: accent = borderAccent = teal (#56b6c2), chromeBg = chrome (#16161c)
const accentPrefix = "\x1b[38;2;86;182;194m";
const chromeBgPrefix = "\x1b[48;2;22;22;28m";
const fgReset = "\x1b[39m";
const bgReset = "\x1b[49m";

describe("editor + markdown theme wiring (beauty moves 2, 4, 6)", () => {
	it("wires every new EditorTheme member alongside the legacy ones (truecolor)", () => {
		setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
		const editorTheme = getEditorTheme();
		expect(editorTheme.borderColor).toBeTypeOf("function");
		expect(editorTheme.focusBorderColor).toBeTypeOf("function");
		expect(editorTheme.cursorStyle).toBeTypeOf("function");
		expect(editorTheme.background).toBeTypeOf("function");
		expect(editorTheme.focusChevron).toBe("»");
		expect(editorTheme.selectList).toBeDefined();
	});

	it("brightens the focused border to borderAccent (move 6)", () => {
		setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
		const { borderColor, focusBorderColor } = getEditorTheme();
		expect(focusBorderColor?.("──")).toBe(`${accentPrefix}──${fgReset}`);
		expect(focusBorderColor?.("──")).not.toBe(borderColor("──"));
	});

	it("composes the caret as an accent underline on the accent fg (move 6)", () => {
		setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
		const { cursorStyle } = getEditorTheme();
		const caret = cursorStyle?.("x");
		// theme.underline (chalk) adapts to the terminal, so assert the exact
		// composition plus the deterministic accent fg wrap.
		expect(caret).toBe(theme.underline(theme.fg("accent", "x")));
		expect(caret).toContain(`${accentPrefix}x`);
	});

	it("paints the editor surface with chromeBg (move 2)", () => {
		setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
		const { background } = getEditorTheme();
		expect(background?.("hi")).toBe(`${chromeBgPrefix}hi${bgReset}`);
	});

	it("wires the markdown accent for H3+ headings (move 4)", () => {
		setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
		const { accent, heading } = getMarkdownTheme();
		expect(accent).toBeTypeOf("function");
		expect(accent?.("Sub")).toBe(`${accentPrefix}Sub${fgReset}`);
		// mdHeading keeps its own color (yellow), accent is teal.
		expect(accent?.("Sub")).not.toBe(heading("Sub"));
	});

	it("passes every wired fn through unchanged in plain mode", () => {
		setThemeInstance(loadThemeFromPath(darkThemePath, "plain"));
		const { borderColor, focusBorderColor, background, cursorStyle } = getEditorTheme();
		expect(borderColor("─")).toBe("─");
		expect(focusBorderColor?.("─")).toBe("─");
		expect(background?.("hi")).toBe("hi");
		expect(cursorStyle?.("x")).toBe(theme.underline(theme.fg("accent", "x")));
		expect(getMarkdownTheme().accent?.("Sub")).toBe("Sub");
	});
});
