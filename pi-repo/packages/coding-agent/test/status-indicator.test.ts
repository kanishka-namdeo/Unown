import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TUI } from "@earendil-works/pi-tui";
import {
	describeToolActivity,
	StatusIndicator,
	WorkingStatusIndicator,
} from "../src/modes/interactive/components/status-indicator.ts";
import { loadThemeFromPath, setThemeInstance } from "../src/modes/interactive/theme/theme.ts";

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
		expect(rendered).toContain("Working...");
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
