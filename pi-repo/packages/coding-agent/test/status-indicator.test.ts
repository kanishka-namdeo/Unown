import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TUI } from "@earendil-works/pi-tui";
import {
	describeToolActivity,
	WorkingStatusIndicator,
} from "../src/modes/interactive/components/status-indicator.ts";
import { loadThemeFromPath, setThemeInstance } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const darkThemePath = new URL("../src/modes/interactive/theme/dark.json", import.meta.url).pathname;

function makeUi(): { ui: TUI; requestRender: ReturnType<typeof vi.fn> } {
	const requestRender = vi.fn();
	return { ui: { requestRender } as unknown as TUI, requestRender };
}

describe("describeToolActivity (move 7 verb-first labels)", () => {
	it("names the activity from the tool's primary argument", () => {
		expect(describeToolActivity("edit", { file_path: "/repo/src/math.ts" })).toBe("Editing math.ts...");
		expect(describeToolActivity("write", { file_path: "/repo/notes.md" })).toBe("Writing notes.md...");
		expect(describeToolActivity("read", { file_path: "/repo/a/b/c.ts" })).toBe("Reading c.ts...");
	});

	it("uses the first command word for shell tools", () => {
		expect(describeToolActivity("bash", { command: "npm run build --silent" })).toBe("Running npm...");
		expect(describeToolActivity("powershell", { command: "" })).toBe("Running command...");
	});

	it("covers search tools and falls back to a title-cased verb", () => {
		expect(describeToolActivity("grep", { pattern: "TODO" })).toBe("Searching files...");
		expect(describeToolActivity("find", {})).toBe("Finding files...");
		expect(describeToolActivity("ls", {})).toBe("Listing directory...");
		expect(describeToolActivity("deploy", {})).toBe("Deploy...");
	});

	it("keeps the current label for internal read-backs", () => {
		expect(describeToolActivity("bash_output", {})).toBeUndefined();
	});

	it("tolerates missing or malformed args", () => {
		expect(describeToolActivity("edit", undefined)).toBe("Editing files...");
		expect(describeToolActivity("bash", null)).toBe("Running command...");
	});
});

describe("StatusIndicator elapsed-time chip (move 7)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
	});

	it("ticks a dim mm:ss chip once a second", () => {
		const { ui } = makeUi();
		const indicator = new WorkingStatusIndicator(ui, "Working...");
		const initial = indicator.render(80).join("\n");
		expect(initial).toContain("0:00");

		vi.advanceTimersByTime(1000);
		expect(indicator.render(80).join("\n")).toContain("0:01");

		vi.advanceTimersByTime(61_000);
		expect(indicator.render(80).join("\n")).toContain("1:02");
		indicator.dispose();
	});

	it("stops ticking when the chip is hidden", () => {
		const { ui } = makeUi();
		const indicator = new WorkingStatusIndicator(ui, "Working...");
		indicator.hideElapsedChip();
		vi.advanceTimersByTime(5000);
		const rendered = indicator.render(80).join("\n");
		// The shimmer styles the verb label per character â compare visible text.
		expect(stripAnsi(rendered)).toContain("Working...");
		expect(rendered).not.toContain("0:05");
		indicator.dispose();
	});
});

describe("StatusIndicator completion beat (move 7)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
	});

	it("morphs the spinner to a checkmark and resolves the latest verb", () => {
		const { ui } = makeUi();
		const indicator = new WorkingStatusIndicator(ui, "Working...");
		indicator.setMessage("Editing math.ts...");

		const onDone = vi.fn();
		indicator.completeBeat(onDone);

		const rendered = indicator.render(80).join("\n");
		expect(rendered).toContain("✓");
		expect(rendered).toContain("Editing math.ts...");
		expect(onDone).not.toHaveBeenCalled();

		vi.advanceTimersByTime(600);
		expect(onDone).toHaveBeenCalledTimes(1);
		indicator.dispose();
	});

	it("never fires the callback when disposed mid-beat", () => {
		const { ui } = makeUi();
		const indicator = new WorkingStatusIndicator(ui, "Editing math.ts...");
		const onDone = vi.fn();
		indicator.completeBeat(onDone);
		indicator.dispose();
		vi.advanceTimersByTime(600);
		expect(onDone).not.toHaveBeenCalled();
	});

	it("clears the elapsed chip for the beat line", () => {
		const { ui } = makeUi();
		const indicator = new WorkingStatusIndicator(ui, "Working...");
		indicator.completeBeat(vi.fn());
		const rendered = indicator.render(80).join("\n");
		expect(rendered).toContain("✓");
		expect(rendered).not.toMatch(/\d:\d\d/);
		indicator.dispose();
	});

	it("falls back to a plain done label when the message is empty", () => {
		const { ui } = makeUi();
		const indicator = new WorkingStatusIndicator(ui, " ");
		indicator.completeBeat(vi.fn());
		expect(indicator.render(80).join("\n")).toContain("done");
		indicator.dispose();
	});
});

describe("working-line shimmer (beauty-4)", () => {
	// A single-frame indicator keeps the spinner lane quiet, so every byte
	// change below is the shimmer's, and the only timer is the 1s elapsed tick.
	const STATIC_FRAME = { frames: ["⠋"] };

	beforeEach(() => {
		vi.useFakeTimers();
		setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
	});

	it("sweeps the verb label on the elapsed chip's existing 1s tick — no new timers", () => {
		const { ui } = makeUi();
		const indicator = new WorkingStatusIndicator(ui, "Editing pagination.ts...", STATIC_FRAME);
		// The label lane only — the mm:ss chip ticks beside it and would mask
		// the sweep in a whole-line comparison.
		const labelOf = () => {
			const line = indicator.render(80).join("\n");
			return line.slice(0, line.indexOf(" 0:0"));
		};

		const atRest = labelOf();
		expect(stripAnsi(atRest)).toContain("Editing pagination.ts...");

		// The shimmer steps with the mm:ss tick: same visible label, moving bytes.
		vi.advanceTimersByTime(1000);
		const afterOneTick = labelOf();
		expect(stripAnsi(afterOneTick)).toContain("Editing pagination.ts...");
		expect(afterOneTick).not.toBe(atRest);

		vi.advanceTimersByTime(1000);
		expect(labelOf()).not.toBe(afterOneTick);
		// Still exactly one interval (the elapsed chip's) — the sweep rides the
		// existing tick lane and adds no timer of its own.
		expect(vi.getTimerCount()).toBe(1);
		indicator.dispose();
	});

	it("renders the label solid in plain mode (no animation, no escapes)", () => {
		setThemeInstance(loadThemeFromPath(darkThemePath, "plain"));
		const { ui } = makeUi();
		const indicator = new WorkingStatusIndicator(ui, "Editing pagination.ts...", STATIC_FRAME);
		// The label lane only — the mm:ss chip keeps ticking beside it.
		const labelOf = () => {
			const line = indicator.render(80).join("\n");
			return line.slice(0, line.indexOf(" 0:0"));
		};

		const atRest = labelOf();
		expect(atRest).toContain("⠋ Editing pagination.ts...");
		vi.advanceTimersByTime(3000);
		expect(labelOf()).toBe(atRest); // the phase never changes plain output
		indicator.dispose();
	});

	it("resolves to a solid (non-shimmered) ✓ label for the completion beat", () => {
		const { ui } = makeUi();
		const indicator = new WorkingStatusIndicator(ui, "Editing pagination.ts...", STATIC_FRAME);
		indicator.completeBeat(vi.fn());
		const beat = indicator.render(80).join("\n");
		expect(stripAnsi(beat)).toContain("✓ Editing pagination.ts...");
		// The beat line is the theme's solid muted label — a single quiet color.
		const muted = loadThemeFromPath(darkThemePath, "truecolor").getFgAnsi("muted");
		const fgColors = beat.match(/\x1b\[38;2;\d+;\d+;\d+m/g) ?? [];
		expect(fgColors).toContain(muted);
		expect(fgColors.length).toBeLessThanOrEqual(2); // success glyph + muted label
		indicator.dispose();
	});

	it("hides the elapsed chip and stops sweeping together", () => {
		const { ui } = makeUi();
		const indicator = new WorkingStatusIndicator(ui, "Working...", STATIC_FRAME);
		indicator.hideElapsedChip();
		const before = indicator.render(80).join("\n");
		vi.advanceTimersByTime(5000);
		// No interval is alive: the sweep and the mm:ss chip share the tick lane.
		expect(vi.getTimerCount()).toBe(0);
		expect(indicator.render(80).join("\n")).toBe(before);
		indicator.dispose();
	});
});
