import assert from "node:assert";
import { describe, it } from "node:test";
import { Loader } from "../src/components/loader.ts";
import type { TUI } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

/**
 * Tests for the beauty-2 Loader suffix support: an optional suffix provider
 * appended after the message (e.g. an elapsed-time chip) plus a public
 * refresh() so callers can drive dynamic suffixes on a timer.
 */

// Single-frame indicators keep the tests synchronous (no animation timer).
const DOT_FRAME = { frames: ["·"] };
const EMPTY_FRAME = { frames: [""] };

const id = (text: string) => text;

/** Create a TUI with a virtual terminal for testing */
function createTestTUI(): TUI {
	return new TuiMainScreen(new VirtualTerminal(80, 24));
}

/** The loader's current display content, without its leading blank line or margins. */
function displayText(loader: Loader, width = 80): string {
	return (loader.render(width)[1] ?? "").slice(1).trimEnd();
}

describe("Loader suffix provider", () => {
	it("renders the indicator + message without a suffix by default", () => {
		const loader = new Loader(createTestTUI(), id, id, "Loading...", DOT_FRAME);
		assert.strictEqual(displayText(loader), "· Loading...");
	});

	it("hides the indicator when the frame is empty", () => {
		const loader = new Loader(createTestTUI(), id, id, "Idle", EMPTY_FRAME);
		assert.strictEqual(displayText(loader), "Idle");
	});

	it("appends the suffix provider output after the message", () => {
		const loader = new Loader(createTestTUI(), id, id, "Loading...", DOT_FRAME);
		loader.setSuffixProvider(() => " 00:12");
		assert.strictEqual(displayText(loader), "· Loading... 00:12");
	});

	it("re-invokes the provider on every display update", () => {
		const loader = new Loader(createTestTUI(), id, id, "Loading...", DOT_FRAME);
		let calls = 0;
		loader.setSuffixProvider(() => {
			calls++;
			return "";
		});
		assert.strictEqual(calls, 1, "setSuffixProvider updates the display");
		loader.setMessage("Editing");
		assert.strictEqual(calls, 2, "setMessage updates the display");
		loader.refresh();
		assert.strictEqual(calls, 3, "refresh updates the display");
		assert.strictEqual(displayText(loader), "· Editing");
	});

	it("refresh() re-renders dynamic suffix content without other updates", () => {
		const loader = new Loader(createTestTUI(), id, id, "Loading...", DOT_FRAME);
		let elapsed = 0;
		loader.setSuffixProvider(() => ` 00:${String(elapsed).padStart(2, "0")}`);
		assert.strictEqual(displayText(loader), "· Loading... 00:00");
		elapsed = 5;
		// The loader owns no suffix timer; callers drive updates via refresh().
		assert.strictEqual(displayText(loader), "· Loading... 00:00");
		loader.refresh();
		assert.strictEqual(displayText(loader), "· Loading... 00:05");
	});

	it("clears the suffix when the provider is removed", () => {
		const loader = new Loader(createTestTUI(), id, id, "Loading...", DOT_FRAME);
		loader.setSuffixProvider(() => " 00:12");
		loader.setSuffixProvider(undefined);
		assert.strictEqual(displayText(loader), "· Loading...");
	});
});
