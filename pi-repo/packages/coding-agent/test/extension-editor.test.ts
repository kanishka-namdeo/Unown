import type { TUI } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ExtensionEditorComponent } from "../src/modes/interactive/components/extension-editor.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

/**
 * The plan editor dialog's discard guard (the plan-mode keyboard round,
 * 2026-10-31). A stray Esc previously discarded minutes of plan editing with
 * no confirmation — the guard arms on the first cancel key while dirty, the
 * second consecutive press discards, any other key disarms. No timer: the
 * state machine is deterministic and clock-free.
 */

function createFakeTui(): TUI {
	return { requestRender: () => {}, terminal: { rows: 24, columns: 80 } } as unknown as TUI;
}

interface EditorProbe {
	component: ExtensionEditorComponent;
	submitted: (string | undefined)[];
	cancelled: number[];
}

function createEditor(prefill?: string): EditorProbe {
	const submitted: (string | undefined)[] = [];
	const cancelled: number[] = [];
	const component = new ExtensionEditorComponent(
		createFakeTui(),
		new KeybindingsManager(),
		"Edit the plan:",
		prefill,
		(text) => submitted.push(text),
		() => cancelled.push(1),
	);
	return { component, submitted, cancelled };
}

describe("extension editor discard guard (the plan edit dialog)", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("a clean editor cancels immediately on escape", () => {
		const probe = createEditor();
		probe.component.handleInput("\x1b");
		expect(probe.cancelled).toHaveLength(1);
		expect(probe.submitted).toHaveLength(0);
	});

	it("a dirty editor survives a stray escape; the second consecutive escape discards", () => {
		const probe = createEditor("# Plan: original");
		probe.component.handleInput("x"); // dirty: one character past the prefill
		probe.component.handleInput("\x1b"); // arms — nothing cancelled yet
		expect(probe.cancelled).toHaveLength(0);
		const armed = stripAnsi(probe.component.render(120).join("\n"));
		expect(armed).toContain("again to discard");
		expect(armed).toContain("unsaved edits");
		probe.component.handleInput("\x1b"); // second consecutive press discards
		expect(probe.cancelled).toHaveLength(1);
		expect(probe.submitted).toHaveLength(0);
	});

	it("any other key disarms; a later escape re-arms rather than discarding", () => {
		const probe = createEditor("# Plan: original");
		probe.component.handleInput("x");
		probe.component.handleInput("\x1b"); // armed
		probe.component.handleInput("\x1b[C"); // right arrow — disarms
		expect(probe.cancelled).toHaveLength(0);
		const disarmed = stripAnsi(probe.component.render(120).join("\n"));
		expect(disarmed).not.toContain("again to discard");
		probe.component.handleInput("\x1b"); // re-arm (not a discard)
		expect(probe.cancelled).toHaveLength(0);
		probe.component.handleInput("\x1b"); // now it discards
		expect(probe.cancelled).toHaveLength(1);
	});

	it("escape with unmodified prefill content cancels immediately (not dirty)", () => {
		const probe = createEditor("# Plan: untouched");
		probe.component.handleInput("\x1b[C"); // cursor move does not dirty the text
		probe.component.handleInput("\x1b");
		expect(probe.cancelled).toHaveLength(1);
	});

	it("ctrl+c rides the same guard as escape on a dirty editor", () => {
		const probe = createEditor("# Plan: original");
		probe.component.handleInput("x");
		probe.component.handleInput("\x03"); // ctrl+c — arms
		expect(probe.cancelled).toHaveLength(0);
		probe.component.handleInput("\x03"); // discards
		expect(probe.cancelled).toHaveLength(1);
	});

	it("enter still submits (the save path needs no guard)", () => {
		const probe = createEditor("# Plan: original");
		probe.component.handleInput("x");
		probe.component.handleInput("\r");
		expect(probe.submitted).toEqual(["# Plan: originalx"]);
		expect(probe.cancelled).toHaveLength(0);
	});
});
