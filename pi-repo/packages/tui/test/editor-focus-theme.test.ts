import assert from "node:assert";
import { describe, it } from "node:test";
import type { AutocompleteProvider } from "../src/autocomplete.ts";
import { buildTopBorderLine, Editor, type EditorTheme } from "../src/components/editor.ts";
import { CURSOR_MARKER, type TUI } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { visibleWidth } from "../src/utils.ts";
import { defaultSelectListTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

/**
 * Tests for the beauty-2 editor theme hooks: focus-aware borders (chevron +
 * focusBorderColor), the border badge, theme-provided cursor styles, the
 * editor background surface, and render-on-focus-change.
 */

// Real ANSI escape byte, built programmatically so this file contains no raw
// control characters or escape-sequence literals.
const ESC = String.fromCharCode(0x1b);

// Arrow-key sequence for moving the caret one grapheme left.
const LEFT_ARROW = `${ESC}[D`;

const id = (text: string) => text;
const red = (text: string) => `${ESC}[31m${text}${ESC}[0m`;
const blue = (text: string) => `${ESC}[34m${text}${ESC}[0m`;

/** Create a TUI with a virtual terminal for testing */
function createTestTUI(cols = 80, rows = 24): TUI {
	return new TuiMainScreen(new VirtualTerminal(cols, rows));
}

const plainTheme: EditorTheme = { borderColor: id, selectList: defaultSelectListTheme };

describe("buildTopBorderLine", () => {
	it("fills the line with plain dashes while unfocused", () => {
		assert.strictEqual(buildTopBorderLine(10, { focused: false, borderColor: id }), "─".repeat(10));
	});

	it("renders the focus chevron as the first cell while focused", () => {
		assert.strictEqual(buildTopBorderLine(10, { focused: true, borderColor: id }), `»${"─".repeat(9)}`);
	});

	it("styles chevron and dashes with focusBorderColor while focused", () => {
		assert.strictEqual(
			buildTopBorderLine(10, { focused: true, borderColor: id, focusBorderColor: red }),
			`${red("»─")}${red("─".repeat(8))}`,
		);
	});

	it("keeps borderColor while unfocused even when focusBorderColor is set", () => {
		assert.strictEqual(
			buildTopBorderLine(10, { focused: false, borderColor: id, focusBorderColor: red }),
			"─".repeat(10),
		);
	});

	it("embeds the badge after the lead cells with flanking spaces", () => {
		const line = buildTopBorderLine(20, { focused: false, borderColor: id, badge: "bash" });
		assert.strictEqual(line, `── bash ${"─".repeat(12)}`);
		assert.strictEqual(visibleWidth(line), 20);
	});

	it("keeps the badge position stable across focus changes", () => {
		const unfocused = buildTopBorderLine(20, { focused: false, borderColor: id, badge: "bash" });
		const focused = buildTopBorderLine(20, { focused: true, borderColor: id, badge: "bash" });
		assert.ok(unfocused.startsWith("── bash "), `unfocused: ${unfocused}`);
		assert.ok(focused.startsWith("»─ bash "), `focused: ${focused}`);
	});

	it("drops the badge when it cannot fit", () => {
		// "── bash ─" needs 9 cells; at width 8 the badge must be dropped.
		assert.strictEqual(buildTopBorderLine(8, { focused: false, borderColor: id, badge: "bash" }), "─".repeat(8));
		assert.strictEqual(buildTopBorderLine(9, { focused: false, borderColor: id, badge: "bash" }), "── bash ─");
	});

	it("treats a badge without visible content as unset", () => {
		assert.strictEqual(buildTopBorderLine(10, { focused: false, borderColor: id, badge: "" }), "─".repeat(10));
	});

	it("styles the badge with badgeColor, falling back to borderColor", () => {
		const styled = buildTopBorderLine(10, { focused: false, borderColor: id, badge: "sh", badgeColor: blue });
		assert.strictEqual(styled, `── ${blue("sh")} ${"─".repeat(4)}`);
		const fallback = buildTopBorderLine(10, { focused: false, borderColor: id, badge: "sh" });
		assert.strictEqual(fallback, `── sh ${"─".repeat(4)}`);
	});

	it("supports a custom chevron glyph", () => {
		assert.strictEqual(buildTopBorderLine(6, { focused: true, borderColor: id, chevron: ">" }), `>${"─".repeat(5)}`);
	});

	it("degrades to a single cell at width 1", () => {
		assert.strictEqual(buildTopBorderLine(1, { focused: true, borderColor: id }), "»");
		assert.strictEqual(buildTopBorderLine(1, { focused: false, borderColor: id }), "─");
	});

	it("returns an empty line for width 0", () => {
		assert.strictEqual(buildTopBorderLine(0, { focused: true, borderColor: id }), "");
	});

	it("composes exactly `width` visible cells for every width and option combination", () => {
		for (let width = 0; width <= 30; width++) {
			for (const focused of [false, true]) {
				for (const badge of [undefined, "a", "bash", "tool: extremely long badge"]) {
					for (const chevron of [undefined, "»", "»»", "日"]) {
						const line = buildTopBorderLine(width, {
							focused,
							borderColor: id,
							focusBorderColor: red,
							badge,
							badgeColor: blue,
							chevron,
						});
						assert.strictEqual(
							visibleWidth(line),
							width,
							`width drift at ${width} (focused=${focused}, badge=${badge}, chevron=${chevron}): ${line}`,
						);
					}
				}
			}
		}
	});
});

describe("Editor focus + theme integration", () => {
	it("brightens both borders with focusBorderColor while focused, chevron on top only", () => {
		const editor = new Editor(createTestTUI(), {
			borderColor: id,
			focusBorderColor: red,
			selectList: defaultSelectListTheme,
		});
		editor.focused = true;
		const lines = editor.render(20);
		assert.strictEqual(lines[0], `${red("»─")}${red("─".repeat(18))}`);
		// Bottom border: focus styling, but no chevron and no badge.
		assert.strictEqual(lines.at(-1), red("─").repeat(20));
		assert.ok(!lines.at(-1)!.includes("»"));
	});

	it("falls back to borderColor for focused borders without focusBorderColor", () => {
		const editor = new Editor(createTestTUI(), plainTheme);
		editor.focused = true;
		const lines = editor.render(20);
		assert.strictEqual(lines[0], `»${"─".repeat(19)}`);
		assert.strictEqual(lines.at(-1), "─".repeat(20));
	});

	it("renders the chevron from theme.focusChevron when provided", () => {
		const editor = new Editor(createTestTUI(), { ...plainTheme, focusChevron: ">" });
		editor.focused = true;
		const lines = editor.render(20);
		assert.strictEqual(lines[0], `>${"─".repeat(19)}`);
		assert.strictEqual(lines.at(-1), "─".repeat(20));
	});

	it("embeds borderBadge in the top border, styled with borderBadgeColor", () => {
		const editor = new Editor(createTestTUI(), plainTheme);
		editor.borderBadge = "bash";
		assert.strictEqual(editor.render(20)[0], `── bash ${"─".repeat(12)}`);
		editor.borderBadgeColor = blue;
		assert.strictEqual(editor.render(20)[0], `── ${blue("bash")} ${"─".repeat(12)}`);
	});

	it("renders the legacy inverse-video caret when cursorStyle is absent", () => {
		const editor = new Editor(createTestTUI(), plainTheme);
		editor.setText("hello");
		const endLine = editor.render(20)[1] ?? "";
		assert.ok(endLine.includes(`${ESC}[7m ${ESC}[0m`), `legacy end-of-line caret: ${JSON.stringify(endLine)}`);
		editor.handleInput(LEFT_ARROW);
		const midLine = editor.render(20)[1] ?? "";
		assert.ok(midLine.includes(`${ESC}[7mo${ESC}[0m`), `legacy mid-line caret: ${JSON.stringify(midLine)}`);
	});

	it("replaces the legacy caret with theme.cursorStyle when present", () => {
		const editor = new Editor(createTestTUI(), { ...plainTheme, cursorStyle: blue });
		editor.setText("hello");
		editor.focused = true;
		const endLine = editor.render(20)[1] ?? "";
		// CURSOR_MARKER is still emitted, immediately before the styled caret.
		assert.ok(
			endLine.includes(`hello${CURSOR_MARKER}${blue(" ")}`),
			`styled end-of-line caret: ${JSON.stringify(endLine)}`,
		);
		assert.ok(!endLine.includes(`${ESC}[7m`), "cursorStyle must replace the legacy inverse-video caret");
		editor.handleInput(LEFT_ARROW);
		const midLine = editor.render(20)[1] ?? "";
		assert.ok(
			midLine.includes(`hell${CURSOR_MARKER}${blue("o")}`),
			`styled mid-line caret: ${JSON.stringify(midLine)}`,
		);
	});

	it("applies theme.background to every rendered line as the last render step", () => {
		const bg = (line: string) => `${ESC}[48;5;233m${line}${ESC}[49m`;
		const editor = new Editor(createTestTUI(), { ...plainTheme, background: bg });
		editor.setText("hello");
		const lines = editor.render(20);
		assert.ok(lines.length >= 3, "expected borders + content lines");
		for (const line of lines) {
			assert.ok(line.startsWith(`${ESC}[48;5;233m`), `missing background: ${JSON.stringify(line)}`);
			assert.ok(line.endsWith(`${ESC}[49m`), `background not applied last: ${JSON.stringify(line)}`);
		}
	});

	it("applies theme.background to autocomplete rows too", async () => {
		const bg = (line: string) => `${ESC}[48;5;233m${line}${ESC}[49m`;
		const editor = new Editor(createTestTUI(), { ...plainTheme, background: bg });
		const provider: AutocompleteProvider = {
			getSuggestions: async () => ({
				items: [
					{ value: "alpha", label: "alpha" },
					{ value: "beta", label: "beta" },
				],
				prefix: "@",
			}),
			applyCompletion: (lines, cursorLine, cursorCol, item) => {
				const line = lines[cursorLine] || "";
				const before = line.slice(0, cursorCol - 1);
				const after = line.slice(cursorCol);
				const newLines = [...lines];
				newLines[cursorLine] = before + item.value + after;
				return { lines: newLines, cursorLine, cursorCol: cursorCol - 1 + item.value.length };
			},
		};
		editor.setAutocompleteProvider(provider);
		editor.handleInput("@");
		await new Promise((resolve) => setTimeout(resolve, 40));
		assert.ok(editor.isShowingAutocomplete(), "autocomplete menu should be visible");
		const lines = editor.render(60);
		assert.ok(lines.length > 3, `expected autocomplete rows: ${lines.length}`);
		for (const line of lines) {
			assert.ok(line.startsWith(`${ESC}[48;5;233m`), `missing background: ${JSON.stringify(line)}`);
			assert.ok(line.endsWith(`${ESC}[49m`), `background not applied last: ${JSON.stringify(line)}`);
		}
	});

	it("requests a render whenever the focused value changes", () => {
		const tui = createTestTUI();
		const editor = new Editor(tui, plainTheme);
		assert.strictEqual(editor.focused, false);
		const original = tui.requestRender.bind(tui);
		let renderRequests = 0;
		tui.requestRender = () => {
			renderRequests++;
		};
		editor.focused = true;
		assert.strictEqual(editor.focused, true);
		assert.strictEqual(renderRequests, 1);
		editor.focused = true; // No change: no additional render request.
		assert.strictEqual(renderRequests, 1);
		editor.focused = false;
		assert.strictEqual(renderRequests, 2);
		tui.requestRender = original;
	});
});
