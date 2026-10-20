import assert from "node:assert";
import { describe, it } from "node:test";
import { SelectList } from "../src/components/select-list.ts";
import type { Component, TUI } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { stripTerminalSequences, visibleWidth } from "../src/utils.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// Byte-exact, display-pipeline-safe SGR helpers: ESC is built via
// String.fromCharCode so the file carries no raw control bytes and the
// Bash/Read display pipeline can never mangle the probes.
const ESC = String.fromCharCode(27);
const sgr = (open: string, close: string) => (text: string) => `${ESC}${open}${text}${ESC}${close}`;

const fgAccent = sgr("[38;5;201m", "[39m");
const fgMuted = sgr("[38;5;240m", "[39m");
const bgOverlay = sgr("[48;5;234m", "[49m");
const bgSelected = sgr("[48;5;17m", "[49m");
const overlayOpen = `${ESC}[48;5;234m`;
const selectedOpen = `${ESC}[48;5;17m`;
const bgClose = `${ESC}[49m`;

// Move-8 surface theme: every hook carries a distinct, reconstructable SGR pair.
const surfaceTheme = {
	selectedPrefix: fgAccent,
	selectedText: fgAccent,
	description: fgMuted,
	scrollInfo: fgMuted,
	noMatch: fgMuted,
	background: bgOverlay,
	selectedRowStyle: bgSelected,
	hintStyle: fgMuted,
};

// Legacy theme: no surface hooks — must keep rendering byte-identically.
const legacyTheme = {
	selectedPrefix: (text: string) => text,
	selectedText: (text: string) => text,
	description: (text: string) => text,
	scrollInfo: (text: string) => text,
	noMatch: (text: string) => text,
};

const items = [
	{ value: "alpha", label: "alpha", description: "first item" },
	{ value: "beta", label: "beta", description: "second item" },
];

const visibleIndexOf = (line: string, text: string): number => {
	const index = line.indexOf(text);
	assert.notEqual(index, -1);
	return visibleWidth(line.slice(0, index));
};

describe("SelectList raised selected row (beauty move 8)", () => {
	it("keeps legacy themes byte-identical (no surface hooks, no padding)", () => {
		const list = new SelectList(items, 5, legacyTheme);
		assert.deepEqual(list.render(20), ["→ alpha", "  beta"]);
	});

	it("renders the selected row as a full-width selectedBg bar with the accent rail at column 0", () => {
		const list = new SelectList(items, 5, surfaceTheme);
		const rendered = list.render(40);
		const selected = rendered[0]!;

		// Width discipline: the bar is exactly the component width.
		assert.strictEqual(visibleWidth(selected), 40);
		// The bar wraps AFTER padding: style(line + padding-to-width).
		assert.ok(selected.startsWith(selectedOpen), "selected row opens with the selectedBg code");
		assert.ok(selected.endsWith(bgClose), "selected row closes the background");
		// 1-cell accent left rail at column 0 (replacing the legacy arrow).
		assert.strictEqual(visibleIndexOf(selected, "▌"), 0);
		assert.ok(selected.includes(fgAccent("▌")), "rail is styled by selectedPrefix");
		// The rest of the row keeps selectedText for content.
		assert.ok(selected.includes(fgAccent("alpha")), "content keeps selectedText");
		assert.strictEqual(stripTerminalSequences(selected), "▌ alpha".padEnd(40));
	});

	it("pads non-selected body rows onto the overlayBg surface", () => {
		const list = new SelectList(items, 5, surfaceTheme);
		const rendered = list.render(40);
		const body = rendered[1]!;

		assert.strictEqual(visibleWidth(body), 40);
		assert.ok(body.startsWith(overlayOpen), "body row opens with the overlayBg code");
		assert.ok(body.endsWith(bgClose), "body row closes the background");
		assert.strictEqual(stripTerminalSequences(body), "  beta".padEnd(40));
	});

	it("keeps description rows aligned on the surface with exact width (width > 40)", () => {
		const list = new SelectList(items, 5, surfaceTheme);
		const rendered = list.render(60);
		const selected = rendered[0]!;
		const body = rendered[1]!;

		assert.strictEqual(visibleWidth(selected), 60);
		assert.strictEqual(visibleWidth(body), 60);
		assert.ok(selected.startsWith(selectedOpen));
		assert.ok(body.startsWith(overlayOpen));
		// Primary column width is 32; descriptions start at column 34 on every row.
		assert.strictEqual(visibleIndexOf(selected, "first item"), 34);
		assert.strictEqual(visibleIndexOf(body, "second item"), 34);
		assert.strictEqual(stripTerminalSequences(selected), `▌ alpha${" ".repeat(27)}first item`.padEnd(60));
		assert.strictEqual(stripTerminalSequences(body), `  beta${" ".repeat(28)}second item`.padEnd(60));
	});

	it("keeps scroll info and no-match lines at their current styling (no bar)", () => {
		const many = Array.from({ length: 8 }, (_, i) => ({ value: `item-${i}`, label: `item-${i}` }));
		const list = new SelectList(many, 3, surfaceTheme);
		const rendered = list.render(40);
		assert.strictEqual(rendered.length, 4);
		const scroll = rendered[3]!;
		assert.strictEqual(scroll, fgMuted("  (1/8)"));
		assert.ok(visibleWidth(scroll) < 40, "scroll info is not padded to a full-width bar");

		const none = new SelectList(many, 3, surfaceTheme);
		none.setFilter("zzz");
		assert.deepStrictEqual(none.render(40), [fgMuted("  No matching commands")]);
	});

	it("keeps every surface row within the component width at narrow widths", () => {
		const longItems = [
			{ value: "abcdefghij", label: "abcdefghij" },
			{ value: "kl", label: "kl" },
		];
		const list = new SelectList(longItems, 5, surfaceTheme);
		for (const width of [4, 8, 12]) {
			const rendered = list.render(width);
			for (const line of rendered) {
				assert.ok(visibleWidth(line) <= width, `width ${width}: line measured ${visibleWidth(line)} cells`);
			}
		}
		// The selected row is padded to exactly the narrow width.
		assert.strictEqual(stripTerminalSequences(list.render(8)[0]!), "▌ abcd".padEnd(8));
	});

	it("accepts hintStyle without rendering a hint line (SelectList has none today)", () => {
		const withHint = { ...legacyTheme, hintStyle: fgMuted };
		const list = new SelectList(items, 5, withHint);
		assert.deepEqual(list.render(20), ["→ alpha", "  beta"]);
	});
});

class SolidContent implements Component {
	private readonly tag: string;

	constructor(tag: string) {
		this.tag = tag;
	}

	render(width: number): string[] {
		return Array.from({ length: 24 }, () => this.tag.repeat(width));
	}

	invalidate(): void {}
}

class LineOverlay implements Component {
	private readonly lines: string[];

	constructor(lines: string[]) {
		this.lines = lines;
	}

	render(): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

async function renderAndFlush(tui: TUI, terminal: VirtualTerminal): Promise<void> {
	tui.requestRender(true);
	await new Promise<void>((resolve) => process.nextTick(resolve));
	await terminal.waitForRender();
}

describe("TUI overlay scrim (beauty move 8)", () => {
	it("paints one full-width scrim row above and below the overlay body", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const tui: TUI = new TuiMainScreen(terminal);
		tui.addChild(new SolidContent("A"));
		tui.setOverlayScrimStyle((width) => "=".repeat(width));
		tui.showOverlay(new LineOverlay(["OVERLAY"]), { width: 20, col: 30, row: 10 });
		tui.start();
		await renderAndFlush(tui, terminal);

		const viewport = terminal.getViewport();
		assert.ok(viewport[10]?.includes("OVERLAY"));
		assert.strictEqual(viewport[9], "=".repeat(80), "one scrim row above");
		assert.strictEqual(viewport[11], "=".repeat(80), "one scrim row below");
		assert.strictEqual(viewport[8], "A".repeat(80), "rows beyond the scrim stay base content");
		assert.strictEqual(viewport[12], "A".repeat(80));
		tui.stop();
	});

	it("renders no scrim rows when no style is set (legacy behavior)", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const tui: TUI = new TuiMainScreen(terminal);
		tui.addChild(new SolidContent("A"));
		tui.showOverlay(new LineOverlay(["OVERLAY"]), { width: 20, col: 30, row: 10 });
		tui.start();
		await renderAndFlush(tui, terminal);

		const viewport = terminal.getViewport();
		assert.ok(viewport[10]?.includes("OVERLAY"));
		assert.strictEqual(viewport[9], "A".repeat(80));
		assert.strictEqual(viewport[11], "A".repeat(80));
		tui.stop();
	});

	it("restores legacy rendering after the style is cleared", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const tui: TUI = new TuiMainScreen(terminal);
		tui.addChild(new SolidContent("A"));
		tui.setOverlayScrimStyle((width) => "=".repeat(width));
		tui.showOverlay(new LineOverlay(["OVERLAY"]), { width: 20, col: 30, row: 10 });
		tui.start();
		await renderAndFlush(tui, terminal);
		assert.strictEqual(terminal.getViewport()[9], "=".repeat(80));

		tui.setOverlayScrimStyle(undefined);
		await renderAndFlush(tui, terminal);
		assert.strictEqual(terminal.getViewport()[9], "A".repeat(80));
		tui.stop();
	});

	it("lets the style own the scrim bytes — short and blank lines still composite over the row", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const tui: TUI = new TuiMainScreen(terminal);
		tui.addChild(new SolidContent("A"));
		tui.setOverlayScrimStyle(() => "=".repeat(10));
		tui.showOverlay(new LineOverlay(["OVERLAY"]), { width: 20, col: 30, row: 10 });
		tui.start();
		await renderAndFlush(tui, terminal);

		// The compositor pads the scrim to the full width: the rest of the
		// row is blanked (spaces), the base document is gone.
		let viewport = terminal.getViewport();
		assert.strictEqual(viewport[9], "=".repeat(10) + " ".repeat(70));
		assert.strictEqual(viewport[10]?.includes("OVERLAY"), true);
		tui.stop();

		const blankTerminal = new VirtualTerminal(80, 24);
		const blankTui: TUI = new TuiMainScreen(blankTerminal);
		blankTui.addChild(new SolidContent("A"));
		blankTui.setOverlayScrimStyle((width) => " ".repeat(width));
		blankTui.showOverlay(new LineOverlay(["OVERLAY"]), { width: 20, col: 30, row: 10 });
		blankTui.start();
		await renderAndFlush(blankTui, blankTerminal);
		viewport = blankTerminal.getViewport();
		assert.strictEqual(viewport[9], " ".repeat(80), "an all-space scrim blanks the row");
		assert.strictEqual(viewport[11], " ".repeat(80));
		blankTui.stop();
	});

	it("skips the scrim when the overlay touches the terminal edge", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const tui: TUI = new TuiMainScreen(terminal);
		tui.addChild(new SolidContent("A"));
		tui.setOverlayScrimStyle((width) => "=".repeat(width));
		tui.showOverlay(new LineOverlay(["TOP"]), { width: 20, col: 0, row: 0 });
		tui.start();
		await renderAndFlush(tui, terminal);

		let viewport = terminal.getViewport();
		assert.ok(viewport[0]?.includes("TOP"));
		assert.strictEqual(viewport[1], "=".repeat(80), "below-scrim still painted at the top edge");
		tui.stop();

		const bottomTerminal = new VirtualTerminal(80, 24);
		const bottomTui: TUI = new TuiMainScreen(bottomTerminal);
		bottomTui.addChild(new SolidContent("A"));
		bottomTui.setOverlayScrimStyle((width) => "=".repeat(width));
		bottomTui.showOverlay(new LineOverlay(["BOTTOM"]), { width: 20, col: 0, row: 23 });
		bottomTui.start();
		await renderAndFlush(bottomTui, bottomTerminal);
		viewport = bottomTerminal.getViewport();
		assert.ok(viewport[23]?.includes("BOTTOM"));
		assert.strictEqual(viewport[22], "=".repeat(80), "above-scrim still painted at the bottom edge");
		bottomTui.stop();
	});

	it("never paints a scrim over another overlay body (stacked overlays)", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const tui: TUI = new TuiMainScreen(terminal);
		tui.addChild(new SolidContent("A"));
		tui.setOverlayScrimStyle((width) => "=".repeat(width));
		tui.showOverlay(new LineOverlay(["A1", "A2"]), { width: 20, col: 30, row: 10 });
		tui.showOverlay(new LineOverlay(["B1", "B2"]), { width: 20, col: 30, row: 12 });
		tui.start();
		await renderAndFlush(tui, terminal);

		const viewport = terminal.getViewport();
		assert.strictEqual(viewport[9], "=".repeat(80), "scrim above the top overlay");
		assert.ok(viewport[10]?.includes("A1"), "first overlay body row untouched");
		assert.ok(viewport[11]?.includes("A2"), "body rows never receive a scrim");
		assert.ok(viewport[12]?.includes("B1"), "second overlay body row untouched");
		assert.ok(viewport[13]?.includes("B2"));
		assert.strictEqual(viewport[14], "=".repeat(80), "scrim below the bottom overlay");
		tui.stop();
	});

	it("paints no scrim for hidden overlays", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const tui: TUI = new TuiMainScreen(terminal);
		tui.addChild(new SolidContent("A"));
		tui.setOverlayScrimStyle((width) => "=".repeat(width));
		const handle = tui.showOverlay(new LineOverlay(["OVERLAY"]), { width: 20, col: 30, row: 10 });
		handle.setHidden(true);
		tui.start();
		await renderAndFlush(tui, terminal);

		const viewport = terminal.getViewport();
		assert.strictEqual(viewport[9], "A".repeat(80));
		assert.strictEqual(viewport[11], "A".repeat(80));
		tui.stop();
	});
});
