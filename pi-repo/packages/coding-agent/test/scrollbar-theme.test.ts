import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadThemeFromPath } from "../src/modes/interactive/theme/theme.ts";

const tempDirs: string[] = [];

function loadDarkTheme(): { name: string; colors: Record<string, string | number> } {
	return JSON.parse(readFileSync(new URL("../src/modes/interactive/theme/dark.json", import.meta.url), "utf8")) as {
		name: string;
		colors: Record<string, string | number>;
	};
}

function writeTheme(theme: { name: string; colors: Record<string, string | number> }): string {
	const testDir = mkdtempSync(join(tmpdir(), "pi-scrollbar-theme-"));
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

describe("optional fullscreen theme colors", () => {
	it("falls back to borderMuted when scrollbarTrack is omitted", () => {
		const themeJson = loadDarkTheme();
		themeJson.name = "legacy-scrollbar-track-theme";
		delete themeJson.colors.scrollbarTrack;

		const loadedTheme = loadThemeFromPath(writeTheme(themeJson), "truecolor");
		expect(loadedTheme.getFgAnsi("scrollbarTrack")).toBe(loadedTheme.getFgAnsi("borderMuted"));
	});

	it("falls back to muted when scrollbarThumb is omitted", () => {
		const themeJson = loadDarkTheme();
		themeJson.name = "legacy-scrollbar-thumb-theme";
		delete themeJson.colors.scrollbarThumb;

		const loadedTheme = loadThemeFromPath(writeTheme(themeJson), "truecolor");
		expect(loadedTheme.getFgAnsi("scrollbarThumb")).toBe(loadedTheme.getFgAnsi("muted"));
	});

	it("uses explicitly configured scrollbar track and thumb colors", () => {
		const themeJson = loadDarkTheme();
		themeJson.name = "custom-scrollbar-theme";
		themeJson.colors.scrollbarTrack = "#123456";
		themeJson.colors.scrollbarThumb = "#654321";

		const loadedTheme = loadThemeFromPath(writeTheme(themeJson), "truecolor");
		expect(loadedTheme.getFgAnsi("scrollbarTrack")).toBe("\x1b[38;2;18;52;86m");
		expect(loadedTheme.getFgAnsi("scrollbarThumb")).toBe("\x1b[38;2;101;67;33m");
	});

	it("falls back to existing selection and text colors for search highlights", () => {
		const themeJson = loadDarkTheme();
		themeJson.name = "legacy-search-theme";
		delete themeJson.colors.searchMatchBg;
		delete themeJson.colors.searchMatchText;

		const loadedTheme = loadThemeFromPath(writeTheme(themeJson), "truecolor");
		expect(loadedTheme.getBgAnsi("searchMatchBg")).toBe(loadedTheme.getBgAnsi("selectedBg"));
		expect(loadedTheme.getFgAnsi("searchMatchText")).toBe(loadedTheme.getFgAnsi("text"));
	});

	it("uses explicitly configured search highlight colors", () => {
		const themeJson = loadDarkTheme();
		themeJson.name = "custom-search-theme";
		themeJson.colors.searchMatchBg = "#112233";
		themeJson.colors.searchMatchText = "#223344";

		const loadedTheme = loadThemeFromPath(writeTheme(themeJson), "truecolor");
		expect(loadedTheme.getBgAnsi("searchMatchBg")).toBe("\x1b[48;2;17;34;51m");
		expect(loadedTheme.getFgAnsi("searchMatchText")).toBe("\x1b[38;2;34;51;68m");
	});

	it("falls back to transparent chrome and overlay surfaces when omitted", () => {
		const themeJson = loadDarkTheme();
		themeJson.name = "legacy-chrome-theme";
		delete themeJson.colors.chromeBg;
		delete themeJson.colors.overlayBg;

		const loadedTheme = loadThemeFromPath(writeTheme(themeJson), "truecolor");
		expect(loadedTheme.getBgAnsi("chromeBg")).toBe("\x1b[49m");
		expect(loadedTheme.getBgAnsi("overlayBg")).toBe("\x1b[49m");
	});

	it("uses explicitly configured chrome and overlay surface colors", () => {
		const themeJson = loadDarkTheme();
		themeJson.name = "custom-chrome-theme";
		themeJson.colors.chromeBg = "#16161c";
		themeJson.colors.overlayBg = "#1c1c24";

		const loadedTheme = loadThemeFromPath(writeTheme(themeJson), "truecolor");
		expect(loadedTheme.getBgAnsi("chromeBg")).toBe("\x1b[48;2;22;22;28m");
		expect(loadedTheme.getBgAnsi("overlayBg")).toBe("\x1b[48;2;28;28;36m");
	});
});
