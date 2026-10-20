/**
 * Move 9 (arrival pacing) tests:
 * - the stream render coalescer batches streaming renders to <=8 fps while
 *   never dropping the trailing update, and flushes early at boundaries;
 * - the bash tool renders the history-compaction affordance as a dim chip
 *   (`⋯ N earlier hidden · <expand key>`), with the key resolved dynamically
 *   from the keybinding system.
 */

import { setKeybindings, KeybindingsManager as TuiKeybindingsManager, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import { createBashToolDefinition } from "../src/core/tools/bash.ts";
import { keyText } from "../src/modes/interactive/components/keybinding-hints.ts";
import { createStreamRenderCoalescer } from "../src/modes/interactive/components/stream-render-coalescer.ts";
import { loadThemeFromPath, setThemeInstance, theme } from "../src/modes/interactive/theme/theme.ts";

const darkThemePath = new URL("../src/modes/interactive/theme/dark.json", import.meta.url).pathname;

describe("StreamRenderCoalescer (move 9: arrival pacing)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("renders the leading request immediately and coalesces a same-window burst to one render", () => {
		const render = vi.fn();
		const scheduler = createStreamRenderCoalescer(render);

		scheduler.requestRender(); // leading edge: immediate
		expect(render).toHaveBeenCalledTimes(1);

		for (let i = 0; i < 9; i++) {
			scheduler.requestRender(); // suppressed inside the open window
		}
		expect(render).toHaveBeenCalledTimes(1);

		// Window closes: the suppressed burst lands as exactly one trailing render.
		vi.advanceTimersByTime(125);
		expect(render).toHaveBeenCalledTimes(2);

		// Nothing new arrived: the next window close renders nothing (no idle timer).
		vi.advanceTimersByTime(125);
		expect(render).toHaveBeenCalledTimes(2);

		scheduler.dispose();
	});

	it("never drops the trailing update: a pending request renders at window close", () => {
		const render = vi.fn();
		const scheduler = createStreamRenderCoalescer(render);

		scheduler.requestRender();
		scheduler.requestRender(); // suppressed -> pending

		vi.advanceTimersByTime(124);
		expect(render).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(1);
		expect(render).toHaveBeenCalledTimes(2);

		scheduler.dispose();
	});

	it("flush renders immediately when a request was suppressed, then restores the immediate leading edge", () => {
		const render = vi.fn();
		const scheduler = createStreamRenderCoalescer(render);

		scheduler.requestRender();
		scheduler.requestRender(); // suppressed mid-window

		vi.advanceTimersByTime(50);
		scheduler.flush();
		expect(render).toHaveBeenCalledTimes(2);

		// The window was canceled: the next request renders immediately again.
		scheduler.requestRender();
		expect(render).toHaveBeenCalledTimes(3);

		// No stale window timer fires later.
		vi.advanceTimersByTime(500);
		expect(render).toHaveBeenCalledTimes(3);

		scheduler.dispose();
	});

	it("flush is a no-op when nothing is pending", () => {
		const render = vi.fn();
		const scheduler = createStreamRenderCoalescer(render);

		scheduler.flush(); // idle pipeline: neither a window nor a suppressed request
		expect(render).not.toHaveBeenCalled();

		scheduler.requestRender();
		expect(render).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(125); // window closes with nothing pending
		scheduler.flush(); // still nothing to flush
		expect(render).toHaveBeenCalledTimes(1);

		scheduler.dispose();
	});

	it("dispose cancels pending timers and never renders again", () => {
		const render = vi.fn();
		const scheduler = createStreamRenderCoalescer(render);

		scheduler.requestRender(); // leading render
		scheduler.requestRender(); // suppressed, window open
		scheduler.dispose();

		vi.advanceTimersByTime(10_000);
		expect(render).toHaveBeenCalledTimes(1); // the trailing request never fires

		scheduler.requestRender(); // terminal no-op
		scheduler.flush(); // terminal no-op
		vi.advanceTimersByTime(10_000);
		expect(render).toHaveBeenCalledTimes(1);
	});

	it("honors the minIntervalMs override", () => {
		const render = vi.fn();
		const scheduler = createStreamRenderCoalescer(render, { minIntervalMs: 250 });

		scheduler.requestRender(); // immediate
		expect(render).toHaveBeenCalledTimes(1);
		scheduler.requestRender(); // suppressed

		vi.advanceTimersByTime(249);
		expect(render).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(1); // the 250ms window closes: trailing render
		expect(render).toHaveBeenCalledTimes(2);

		scheduler.dispose();
	});

	it("caps a sustained 10ms chunk stream to <=8 renders per second (move 9 budget)", () => {
		const render = vi.fn();
		const scheduler = createStreamRenderCoalescer(render);

		// Chunks arrive every 10ms for 1250ms (125 chunks, wildly above 8 fps).
		for (let i = 0; i < 125; i++) {
			vi.advanceTimersByTime(10);
			scheduler.requestRender();
		}
		// Renders land at t=10 (leading) then once per closed 125ms window
		// (135, 260, ..., 1135): exactly 10 renders in 1.25s = 8 fps.
		expect(render).toHaveBeenCalledTimes(10);

		scheduler.dispose();
	});
});

describe("bash fold chip (move 9: hidden-history affordance)", () => {
	beforeEach(() => {
		setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
		setKeybindings(new KeybindingsManager());
	});

	/** Render a collapsed (non-expanded) bash result and return its lines. */
	function renderCollapsedBashOutput(text: string, width: number): string[] {
		const definition = createBashToolDefinition(process.cwd());
		const context = {
			args: { command: "seq 1 19" },
			toolCallId: "fold-chip-test",
			invalidate: () => {},
			lastComponent: undefined,
			state: { startedAt: undefined, endedAt: undefined, interval: undefined },
			cwd: process.cwd(),
			executionStarted: false,
			argsComplete: true,
			isPartial: false,
			expanded: false,
			showImages: false,
			isError: false,
		};
		const component = definition.renderResult!(
			{ content: [{ type: "text", text }], details: undefined },
			{ expanded: false, isPartial: false },
			theme,
			context,
		);
		return component.render(width);
	}

	it("renders the `⋯ N earlier hidden · <key>` chip with the dynamic expand key", () => {
		const text = Array.from({ length: 19 }, (_, i) => `line ${i + 1}`).join("\n");
		const lines = renderCollapsedBashOutput(text, 80);

		// ["", chip, ...last 5 preview lines] with 14 lines hidden.
		expect(lines).toHaveLength(7);
		const chip = lines[1]!;
		expect(chip).toContain("⋯");
		expect(chip).toContain("14 earlier hidden");

		// Chip body dim, expand key one step brighter (muted), key dynamic.
		expect(chip).toContain(theme.fg("dim", "⋯ 14 earlier hidden"));
		expect(chip).toContain(theme.fg("dim", " · "));
		expect(chip).toContain(theme.fg("muted", keyText("app.tools.expand")));
		expect(keyText("app.tools.expand")).toBe("ctrl+o"); // resolved, not hardcoded

		// The old prose phrasing is gone.
		expect(chip).not.toContain("earlier lines");
	});

	it("omits the key lane when no expand key is bound", () => {
		setKeybindings(new TuiKeybindingsManager({})); // no app.* definitions registered
		const text = Array.from({ length: 19 }, (_, i) => `line ${i + 1}`).join("\n");
		const lines = renderCollapsedBashOutput(text, 80);

		const chip = lines[1]!;
		expect(chip).toContain("⋯ 14 earlier hidden");
		expect(chip).not.toContain("·"); // no dangling separator without a key
	});

	it("keeps the chip within the render width via truncateToWidth", () => {
		const text = Array.from({ length: 19 }, (_, i) => `line ${i + 1}`).join("\n");
		const lines = renderCollapsedBashOutput(text, 14);

		const chip = lines[1]!;
		expect(visibleWidth(chip)).toBeLessThanOrEqual(14);
	});
});
