import { setKeybindings, type TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ExtensionSelectorComponent } from "../src/modes/interactive/components/extension-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

/**
 * The plan-approval gate's keyboard surface (the plan-mode keyboard round,
 * 2026-10-31). The selector previously handled ONLY up/down/j/k/enter/cancel —
 * pageUp/pageDown (bindings that exist and SelectList honors), home/end and
 * Claude-Code-style numbered quick-select were all missing. This matrix pins
 * every key the component now answers, in every encoding family that matters.
 */

function createFakeTui(): TUI {
	return { requestRender: () => {} } as unknown as TUI;
}

interface SelectorProbe {
	component: ExtensionSelectorComponent;
	selected: (string | undefined)[];
	cancelled: number[];
	toggled: number[];
}

function createSelector(options: string[], opts?: { timeout?: number }): SelectorProbe {
	const selected: (string | undefined)[] = [];
	const cancelled: number[] = [];
	const toggled: number[] = [];
	const component = new ExtensionSelectorComponent(
		"Plan ready — 72/100",
		options,
		(option) => selected.push(option),
		() => cancelled.push(1),
		{ tui: createFakeTui(), timeout: opts?.timeout, onToggleToolsExpanded: () => toggled.push(1) },
	);
	return { component, selected, cancelled, toggled };
}

describe("extension selector keyboard matrix (the plan approval gate)", () => {
	beforeAll(() => {
		initTheme("dark");
		// The component resolves app.* actions (app.tools.expand) through the
		// global manager — install the real coding-agent defaults so ctrl+o
		// behaves exactly as it does in a live session.
		setKeybindings(new KeybindingsManager());
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	const PLAN_OPTIONS = [
		"Execute — auto-accept edits",
		"Execute — approve each edit",
		"Edit the plan",
		"Keep planning (send feedback)",
	];

	it("numbers the options and hints the digit lane when 1-9 can reach every row", () => {
		const { component } = createSelector(PLAN_OPTIONS);
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("1. Execute — auto-accept edits");
		expect(rendered).toContain("4. Keep planning (send feedback)");
		expect(rendered).toContain("1-4 quick select");
	});

	it("does not number or digit-select when the list is longer than 9 (unreachable rows)", () => {
		const many = Array.from({ length: 10 }, (_, i) => `option ${i + 1}`);
		const probe = createSelector(many);
		const rendered = stripAnsi(probe.component.render(120).join("\n"));
		expect(rendered).not.toContain("1. option 1");
		expect(rendered).not.toContain("quick select");
		probe.component.handleInput("1");
		expect(probe.selected).toHaveLength(0); // digits are inert without numbering
	});

	it("up/down clamp at the ends (no wrap), j/k move like the arrows", () => {
		const probe = createSelector(PLAN_OPTIONS);
		probe.component.handleInput("\x1b[A"); // up at index 0 — clamped
		probe.component.handleInput("\r");
		expect(probe.selected).toEqual([PLAN_OPTIONS[0]]);
		probe.component.handleInput("j"); // down
		probe.component.handleInput("j");
		probe.component.handleInput("j");
		probe.component.handleInput("j"); // past the end — clamped
		probe.component.handleInput("\r");
		expect(probe.selected[1]).toBe(PLAN_OPTIONS[3]);
		probe.component.handleInput("k"); // back up
		probe.component.handleInput("\r");
		expect(probe.selected[2]).toBe(PLAN_OPTIONS[2]);
	});

	it("pageUp/pageDown and home/end land on the first/last row", () => {
		const probe = createSelector(PLAN_OPTIONS);
		probe.component.handleInput("\x1b[6~"); // pageDown — whole list visible, so last
		probe.component.handleInput("\r");
		expect(probe.selected[0]).toBe(PLAN_OPTIONS[3]);
		probe.component.handleInput("\x1b[5~"); // pageUp — first
		probe.component.handleInput("\r");
		expect(probe.selected[1]).toBe(PLAN_OPTIONS[0]);
		probe.component.handleInput("\x1b[F"); // End
		probe.component.handleInput("\x1b[H"); // Home
		probe.component.handleInput("\r");
		expect(probe.selected[2]).toBe(PLAN_OPTIONS[0]);
	});

	it("digits 1-9 select immediately; out-of-range and 0 are inert", () => {
		const probe = createSelector(PLAN_OPTIONS);
		probe.component.handleInput("3");
		expect(probe.selected).toEqual([PLAN_OPTIONS[2]]);
		probe.component.handleInput("5"); // beyond the list — nothing
		probe.component.handleInput("0"); // never a valid quick-select
		probe.component.handleInput("q"); // unknown key
		expect(probe.selected).toHaveLength(1);
		expect(probe.cancelled).toHaveLength(0);
	});

	it("Kitty CSI-u encoded digits quick-select too", () => {
		const probe = createSelector(PLAN_OPTIONS);
		probe.component.handleInput("\x1b[49;1u"); // Kitty encoding of "1"
		expect(probe.selected).toEqual([PLAN_OPTIONS[0]]);
	});

	it("enter selects in \\r and \\n forms; escape and ctrl+c cancel", () => {
		const probe = createSelector(PLAN_OPTIONS);
		probe.component.handleInput("\n");
		expect(probe.selected).toEqual([PLAN_OPTIONS[0]]);
		probe.component.handleInput("\x1b"); // escape — cancel, nothing selected
		expect(probe.cancelled).toHaveLength(1);
		probe.component.handleInput("\x03"); // ctrl+c — cancel
		expect(probe.cancelled).toHaveLength(2);
		expect(probe.selected).toHaveLength(1);
	});

	it("ctrl+o toggles tool expansion without selecting or cancelling", () => {
		const probe = createSelector(PLAN_OPTIONS);
		probe.component.handleInput("\x0f");
		expect(probe.toggled).toHaveLength(1);
		expect(probe.selected).toHaveLength(0);
		expect(probe.cancelled).toHaveLength(0);
	});
});
