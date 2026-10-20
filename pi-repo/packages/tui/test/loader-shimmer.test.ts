import assert from "node:assert";
import { describe, it } from "node:test";
import { Loader } from "../src/components/loader.ts";
import type { TUI } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

/**
 * Tests for beauty-4's Loader shimmer support: an optional per-phase message
 * colorizer (a gradient sweep) that supersedes messageColorFn while set and is
 * stepped by the caller via advanceShimmerPhase() — the loader never adds a
 * timer for it (the caller's existing tick lane advances both phase + refresh).
 */

// Single-frame indicators keep the tests synchronous (no animation timer).
const DOT_FRAME = { frames: ["·"] };

const id = (text: string) => text;

/** Create a TUI with a virtual terminal for testing */
function createTestTUI(): TUI {
	return new TuiMainScreen(new VirtualTerminal(80, 24));
}

/** The loader's current display content, without its leading blank line or margins. */
function displayText(loader: Loader, width = 80): string {
	return (loader.render(width)[1] ?? "").slice(1).trimEnd();
}

/** A shimmer fn that paints the phase into the label — lanes stay inspectable. */
const phaseTagger = (phase: number, text: string) => `[${phase}]${text}`;

describe("Loader shimmer lane", () => {
	it("falls back to messageColorFn when no shimmer is set", () => {
		const loader = new Loader(createTestTUI(), id, (t) => `«${t}»`, "Working...", DOT_FRAME);
		assert.strictEqual(displayText(loader), "· «Working...»");
	});

	it("supersedes messageColorFn while a shimmer is set", () => {
		const loader = new Loader(createTestTUI(), id, (t) => `«${t}»`, "Working...", DOT_FRAME);
		loader.setMessageShimmer(phaseTagger);
		assert.strictEqual(displayText(loader), "· [0]Working...");
	});

	it("steps the band only when the caller advances the phase (no loader timer)", () => {
		const loader = new Loader(createTestTUI(), id, id, "Working...", DOT_FRAME);
		loader.setMessageShimmer(phaseTagger);
		assert.strictEqual(displayText(loader), "· [0]Working...");
		// A plain refresh re-renders the SAME phase — the loader owns no clock.
		loader.refresh();
		assert.strictEqual(displayText(loader), "· [0]Working...");
		loader.advanceShimmerPhase();
		loader.refresh();
		assert.strictEqual(displayText(loader), "· [1]Working...");
		loader.advanceShimmerPhase();
		loader.advanceShimmerPhase();
		loader.refresh();
		assert.strictEqual(displayText(loader), "· [3]Working...");
	});

	it("sees message updates through the shimmer fn", () => {
		const loader = new Loader(createTestTUI(), id, id, "Reading...", DOT_FRAME);
		loader.setMessageShimmer(phaseTagger);
		loader.setMessage("Editing math.ts...");
		assert.strictEqual(displayText(loader), "· [0]Editing math.ts...");
	});

	it("composes with the suffix lane (the mm:ss chip)", () => {
		const loader = new Loader(createTestTUI(), id, id, "Working...", DOT_FRAME);
		loader.setMessageShimmer(phaseTagger);
		loader.setSuffixProvider(() => " 0:12");
		assert.strictEqual(displayText(loader), "· [0]Working... 0:12");
		loader.advanceShimmerPhase();
		loader.refresh();
		assert.strictEqual(displayText(loader), "· [1]Working... 0:12");
	});

	it("clears back to messageColorFn when the shimmer is removed", () => {
		const loader = new Loader(createTestTUI(), id, (t) => `«${t}»`, "Working...", DOT_FRAME);
		loader.setMessageShimmer(phaseTagger);
		loader.advanceShimmerPhase();
		loader.setMessageShimmer(undefined);
		assert.strictEqual(displayText(loader), "· «Working...»");
	});
});
