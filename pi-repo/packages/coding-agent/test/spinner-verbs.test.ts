// Toccata A15 — the thinking-time spinner verbs: the pure pool helpers
// (parse / resolve / pick) and the WorkingStatusIndicator rotation battery.
// Rotation rides the elapsed chip's existing 1 s tick — the no-new-timers
// discipline pinned by status-indicator.test.ts holds here too.

import type { TUI } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_SPINNER_VERBS,
	parseSpinnerVerbs,
	pickSpinnerVerbIndex,
	resolveSpinnerVerbPool,
	SPINNER_VERB_ROTATE_TICKS,
} from "../src/modes/interactive/components/spinner-verbs.ts";
import { WorkingStatusIndicator } from "../src/modes/interactive/components/status-indicator.ts";
import { loadThemeFromPath, setThemeInstance } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const darkThemePath = new URL("../src/modes/interactive/theme/dark.json", import.meta.url).pathname;

function makeUi(): { ui: TUI; requestRender: ReturnType<typeof vi.fn> } {
	const requestRender = vi.fn();
	return { ui: { requestRender } as unknown as TUI, requestRender };
}

describe("parseSpinnerVerbs", () => {
	it("splits, trims and drops empties", () => {
		expect(parseSpinnerVerbs("Pondering, percolating,,Brewing")).toEqual(["Pondering", "percolating", "Brewing"]);
	});

	it("dedupes case-insensitively, first spelling wins", () => {
		expect(parseSpinnerVerbs("Pondering,PONDERING,ponderING,Brewing")).toEqual(["Pondering", "Brewing"]);
	});

	it("tolerates undefined and separator-only values", () => {
		expect(parseSpinnerVerbs(undefined)).toEqual([]);
		expect(parseSpinnerVerbs(" , , ")).toEqual([]);
	});
});

describe("resolveSpinnerVerbPool (env > setting > default)", () => {
	it("returns the default pool when nothing is configured", () => {
		const pool = resolveSpinnerVerbPool(undefined, undefined);
		expect(pool).toEqual([...DEFAULT_SPINNER_VERBS]);
		// A fresh copy — callers can never poison the catalog.
		expect(pool).not.toBe(DEFAULT_SPINNER_VERBS);
	});

	it("env kill values disable the lane (null)", () => {
		for (const value of ["0", "false", "off", "no", "OFF", " No "]) {
			expect(resolveSpinnerVerbPool(value, undefined)).toBeNull();
			// Env wins even when a setting lists verbs.
			expect(resolveSpinnerVerbPool(value, "Pondering,Brewing")).toBeNull();
		}
	});

	it("env enable values mean the default pool", () => {
		for (const value of ["1", "true", "on", "yes"]) {
			expect(resolveSpinnerVerbPool(value, "Pondering,Brewing")).toEqual([...DEFAULT_SPINNER_VERBS]);
		}
	});

	it("a non-empty env list replaces everything", () => {
		expect(resolveSpinnerVerbPool("Pondering,Brewing", "Vibing")).toEqual(["Pondering", "Brewing"]);
	});

	it("a degenerate env parse falls through to the setting, then the default", () => {
		expect(resolveSpinnerVerbPool(",,", "Vibing")).toEqual(["Vibing"]);
		expect(resolveSpinnerVerbPool(",,", "")).toEqual([...DEFAULT_SPINNER_VERBS]);
	});

	it("a setting list replaces the default pool", () => {
		expect(resolveSpinnerVerbPool(undefined, "Pondering, percolating")).toEqual(["Pondering", "percolating"]);
		// Whitespace-only settings are unset.
		expect(resolveSpinnerVerbPool(undefined, "   ")).toEqual([...DEFAULT_SPINNER_VERBS]);
	});
});

describe("pickSpinnerVerbIndex", () => {
	it("guards degenerate pools", () => {
		expect(pickSpinnerVerbIndex(0, -1)).toBe(-1);
		expect(pickSpinnerVerbIndex(1, -1)).toBe(0);
		expect(pickSpinnerVerbIndex(1, 0)).toBe(0);
	});

	it("never repeats the previous verb when the pool has more than one", () => {
		// A rng that always proposes the previous index — the bounded
		// fallback must unblock rather than loop.
		const stuckOn = (fixed: number) => () => fixed / Math.max(fixed + 1, 1);
		for (let last = 0; last < 4; last++) {
			const rng = vi.fn(() => last / 4);
			expect(pickSpinnerVerbIndex(4, last, rng)).not.toBe(last);
			expect(rng.mock.calls.length).toBeLessThanOrEqual(4);
		}
		expect(pickSpinnerVerbIndex(3, 1, stuckOn(1))).not.toBe(1);
	});

	it("picks within bounds for a uniform rng", () => {
		const rng = vi.fn(() => 0.999999);
		expect(pickSpinnerVerbIndex(5, -1, rng)).toBe(4);
	});
});

describe("the default catalog", () => {
	it("is a curated, deduplicated, trimmed list of plain verbs", () => {
		expect(DEFAULT_SPINNER_VERBS.length).toBeGreaterThanOrEqual(48);
		const seen = new Set<string>();
		for (const verb of DEFAULT_SPINNER_VERBS) {
			expect(verb).toBe(verb.trim());
			expect(verb).not.toMatch(/[,.\s]/); // single words, no ellipses — the "..." is added at render
			expect(seen.has(verb.toLowerCase())).toBe(false);
			seen.add(verb.toLowerCase());
		}
	});

	it("carries the canonical crowd-pleasers", () => {
		for (const verb of ["Pondering", "Percolating", "Cerebrating", "Vibing", "Thinking", "Working"]) {
			expect(DEFAULT_SPINNER_VERBS).toContain(verb);
		}
	});
});

describe("WorkingStatusIndicator verb rotation (Toccata A15)", () => {
	// A single-frame indicator keeps the spinner lane quiet, so the only
	// timer is the elapsed chip's 1 s tick — same discipline as the shimmer
	// battery in status-indicator.test.ts.
	const STATIC_FRAME = { frames: ["⠋"] };

	beforeEach(() => {
		vi.useFakeTimers();
		setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
	});

	const labelOf = (indicator: WorkingStatusIndicator): string => {
		const line = indicator.render(80).join("\n");
		return stripAnsi(line.slice(0, line.indexOf(" 0:0")));
	};

	it("seeds the first verb immediately and rotates on the elapsed tick — no new timers", () => {
		const { ui } = makeUi();
		const indicator = new WorkingStatusIndicator(ui, "Working...", STATIC_FRAME);
		indicator.setVerbPool(["Pondering", "Brewing", "Vibing"]);
		const seeded = labelOf(indicator);
		expect(seeded).toMatch(/(Pondering|Brewing|Vibing)\.\.\.$/);

		vi.advanceTimersByTime(1000 * SPINNER_VERB_ROTATE_TICKS);
		const afterRotation = labelOf(indicator);
		expect(afterRotation).toMatch(/(Pondering|Brewing|Vibing)\.\.\.$/);
		// The pick never repeats the verb it replaces.
		expect(afterRotation).not.toBe(seeded);
		// Still exactly one interval (the elapsed chip's) — rotation adds none.
		expect(vi.getTimerCount()).toBe(1);
		indicator.dispose();
	});

	it("holds the verb between rotation windows", () => {
		const { ui } = makeUi();
		const indicator = new WorkingStatusIndicator(ui, "Working...", STATIC_FRAME);
		indicator.setVerbPool(["Pondering", "Brewing"]);
		const seeded = labelOf(indicator);
		vi.advanceTimersByTime(1000 * (SPINNER_VERB_ROTATE_TICKS - 1));
		expect(labelOf(indicator)).toBe(seeded);
		vi.advanceTimersByTime(1000); // the rotation beat itself
		expect(labelOf(indicator)).not.toBe(seeded);
		indicator.dispose();
	});

	it("a tool label wins and stops the rotation", () => {
		const { ui } = makeUi();
		const indicator = new WorkingStatusIndicator(ui, "Working...", STATIC_FRAME);
		indicator.setVerbPool(["Pondering", "Brewing", "Vibing"]);
		indicator.setMessage("Editing math.ts...");
		vi.advanceTimersByTime(60_000);
		expect(labelOf(indicator)).toContain("Editing math.ts...");
		expect(vi.getTimerCount()).toBe(1);
		indicator.dispose();
	});

	it("an empty pool is a no-op (the static label stays)", () => {
		const { ui } = makeUi();
		const indicator = new WorkingStatusIndicator(ui, "Working...", STATIC_FRAME);
		indicator.setVerbPool([]);
		expect(labelOf(indicator)).toContain("Working...");
		vi.advanceTimersByTime(10_000);
		expect(labelOf(indicator)).toContain("Working...");
		indicator.dispose();
	});

	it("a single-verb pool keeps its verb forever", () => {
		const { ui } = makeUi();
		const indicator = new WorkingStatusIndicator(ui, "Working...", STATIC_FRAME);
		indicator.setVerbPool(["Pondering"]);
		expect(labelOf(indicator)).toContain("Pondering...");
		vi.advanceTimersByTime(60_000);
		expect(labelOf(indicator)).toContain("Pondering...");
		indicator.dispose();
	});

	it("the completion beat resolves the verb label like any other", () => {
		const { ui } = makeUi();
		const indicator = new WorkingStatusIndicator(ui, "Working...", STATIC_FRAME);
		indicator.setVerbPool(["Pondering", "Brewing"]);
		indicator.completeBeat(vi.fn());
		const beat = stripAnsi(indicator.render(80).join("\n"));
		expect(beat).toMatch(/✓ (Pondering|Brewing)\.\.\./);
		indicator.dispose();
	});
});
