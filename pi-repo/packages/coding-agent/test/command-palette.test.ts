import { beforeAll, describe, expect, it, vi } from "vitest";
import { CommandPalette, type PaletteEntry } from "../src/modes/interactive/components/command-palette.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

function makeEntries(): PaletteEntry[] {
        return [
                { id: "cmd:model", label: "/model", description: "Switch model", run: vi.fn() },
                { id: "cmd:quit", label: "/quit", description: "Exit the session", run: vi.fn() },
                { id: "action:model-select", label: "Select model…", description: "ctrl+l · switch", run: vi.fn() },
        ];
}

describe("CommandPalette (round 5, I2)", () => {
        beforeAll(() => {
                initTheme(undefined, false);
        });

        function makePalette(entries: PaletteEntry[] = makeEntries()) {
                const onSelect = vi.fn((entry: PaletteEntry) => entry.run());
                const onCancel = vi.fn();
                const palette = new CommandPalette({
                        title: "Command palette",
                        entries,
                        onSelect,
                        onCancel,
                });
                return { palette, onSelect, onCancel, entries };
        }

        it("renders the title and every entry label", () => {
                const { palette } = makePalette();
                const text = stripAnsi(palette.render(100).join("\n"));
                expect(text).toContain("Command palette");
                expect(text).toContain("/model");
                expect(text).toContain("/quit");
                expect(text).toContain("Select model…");
        });

        it("keeps every rendered line within the width at narrow terminals", () => {
                for (const width of [48, 56, 72, 96]) {
                        const { palette } = makePalette();
                        for (const line of palette.render(width)) {
                                expect(visibleWidth(line)).toBeLessThanOrEqual(width);
                        }
                }
        });

        it("filters by fuzzy query and Enter runs the selected entry", () => {
                const { palette, entries } = makePalette();
                palette.handleInput("q"); // matches /quit only
                palette.handleInput("u");
                palette.handleInput("i");
                palette.handleInput("t");
                // confirm
                palette.handleInput("\r");
                expect(entries[1]!.run).toHaveBeenCalled();
                expect(entries[0]!.run).not.toHaveBeenCalled();
        });

        it("Escape cancels without running", () => {
                const { palette, onCancel, entries } = makePalette();
                palette.handleInput("\x1b");
                expect(onCancel).toHaveBeenCalled();
                for (const entry of entries) expect(entry.run).not.toHaveBeenCalled();
        });

        it("arrow-down moves the selection before Enter", () => {
                const { palette, entries } = makePalette();
                palette.handleInput("\x1b[B"); // down
                palette.handleInput("\r"); // Enter
                expect(entries[1]!.run).toHaveBeenCalled();
        });
});

describe("CustomEditor help key (round 5, I1)", () => {
        beforeAll(() => {
                initTheme(undefined, false);
        });

        function makeEditor(): CustomEditor {
                const editor = new CustomEditor(
                        { requestRender: () => {}, invalidate: () => {}, setFocus: () => {} } as never,
                        {} as never,
                        { matches: () => false } as never,
                );
                return editor;
        }

        it("calls onHelpKey when ? is typed into an empty editor", () => {
                const editor = makeEditor();
                const onHelpKey = vi.fn();
                editor.onHelpKey = onHelpKey;
                editor.handleInput("?");
                expect(onHelpKey).toHaveBeenCalledOnce();
                expect(editor.getText()).toBe("");
        });

        it("types ? literally when the editor has content", () => {
                const editor = makeEditor();
                const onHelpKey = vi.fn();
                editor.onHelpKey = onHelpKey;
                editor.handleInput("h");
                editor.handleInput("?");
                expect(onHelpKey).not.toHaveBeenCalled();
                expect(editor.getText()).toContain("h?");
        });

        it("types ? literally when no help handler is set", () => {
                const editor = makeEditor();
                editor.handleInput("?");
                expect(editor.getText()).toBe("?");
        });
});
