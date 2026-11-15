/**
 * editor-history-persistence.test.ts — the Toccata round's Editor history
 * surface: seedHistory (persisted entries under in-session entries),
 * getHistoryEntries (read-only view), and saveEditorState /
 * restoreEditorState (the Ctrl+S draft-stash snapshot, paste markers
 * included).
 */
import assert from "node:assert";
import { afterEach, describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "../src/keybindings.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

afterEach(() => {
        setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
});

function makeEditor(): Editor {
        return new Editor(new TuiMainScreen(new VirtualTerminal()), defaultEditorTheme);
}

describe("Editor seedHistory + getHistoryEntries", () => {
        it("seeds persisted entries under in-session entries", () => {
                const editor = makeEditor();
                editor.addToHistory("in-session prompt");
                editor.seedHistory(["persisted prompt"]);
                assert.strictEqual(editor.getHistoryEntries()[0], "in-session prompt");
                assert.ok(editor.getHistoryEntries().includes("persisted prompt"));
        });

        it("dedupes seeded entries against existing history by exact text", () => {
                const editor = makeEditor();
                editor.addToHistory("same prompt");
                editor.seedHistory(["same prompt", "fresh prompt", "  same prompt  "]);
                const entries = editor.getHistoryEntries();
                assert.strictEqual(entries.filter((e) => e === "same prompt").length, 1);
                assert.ok(entries.includes("fresh prompt"));
        });

        it("Up recall reaches seeded entries across sessions", () => {
                const editor = makeEditor();
                editor.seedHistory(["persisted prompt"]);
                editor.handleInput("\x1b[A"); // Up
                assert.strictEqual(editor.getText(), "persisted prompt");
        });

        it("seeded empty and blank entries are skipped", () => {
                const editor = makeEditor();
                editor.seedHistory(["", "   "]);
                assert.deepStrictEqual(editor.getHistoryEntries(), []);
        });

        it("returns a copy — mutating the view never mutates history", () => {
                const editor = makeEditor();
                editor.addToHistory("prompt");
                const view = editor.getHistoryEntries();
                view.pop();
                assert.strictEqual(editor.getHistoryEntries().length, 1);
        });

        it("the history cap is 500 and the oldest entries drop", () => {
                const editor = makeEditor();
                for (let i = 0; i < 520; i++) {
                        editor.addToHistory(`prompt ${i}`);
                }
                const entries = editor.getHistoryEntries();
                assert.strictEqual(entries.length, 500);
                assert.strictEqual(entries[0], "prompt 519");
                assert.strictEqual(entries[entries.length - 1], "prompt 20");
        });
});

describe("Editor saveEditorState + restoreEditorState (the draft stash)", () => {
        it("round-trips text and cursor", () => {
                const editor = makeEditor();
                editor.setText("line one\nline two");
                editor.handleInput("\x1b[A"); // Up to line 0
                editor.handleInput("\x1b[D"); // Left one col
                const snapshot = editor.saveEditorState();
                assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });
                editor.setText("replacement");
                editor.restoreEditorState(snapshot);
                assert.strictEqual(editor.getText(), "line one\nline two");
                assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });
        });

        it("restoring an empty snapshot yields an empty editor", () => {
                const editor = makeEditor();
                editor.setText("draft");
                const emptySnapshot = makeEditor().saveEditorState();
                editor.restoreEditorState(emptySnapshot);
                assert.strictEqual(editor.getText(), "");
        });

        it("clamps the cursor when the restored text is shorter than the snapshot", () => {
                const editor = makeEditor();
                editor.setText("a very long draft line");
                const snapshot = editor.saveEditorState();
                // Simulate a stale snapshot (text shrank after save): lines mutated.
                snapshot.lines = ["short"];
                editor.restoreEditorState(snapshot);
                assert.strictEqual(editor.getText(), "short");
                assert.ok(editor.getCursor().col <= 5);
        });

        it("restore is undoable as a single step (ctrl+- / ctrl+shift+- lane)", () => {
                const editor = makeEditor();
                editor.setText("stashed draft");
                const snapshot = editor.saveEditorState();
                editor.setText("");
                editor.restoreEditorState(snapshot);
                editor.handleInput("\x1f"); // Ctrl+_ (undo)
                assert.strictEqual(editor.getText(), "");
        });
});
