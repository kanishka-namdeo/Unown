/**
 * editor-image-chips.test.ts — the Toccata round's `[Image #N]` chips:
 * pasted images insert as atomic cursor units referencing the stored file
 * positionally (Claude Code's contract), expand to the path on submit, and
 * survive the draft-stash round-trip.
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

describe("Editor image chips", () => {
        it("inserts an atomic [Image #N] chip at the cursor", () => {
                const editor = makeEditor();
                const id = editor.insertImageChip("/tmp/shot-1.png");
                assert.strictEqual(id, 1);
                assert.strictEqual(editor.getText(), "[Image #1]");
        });

        it("chips increment and reference distinct paths", () => {
                const editor = makeEditor();
                editor.insertImageChip("/tmp/shot-1.png");
                const second = editor.insertImageChip("/tmp/shot-2.png");
                assert.strictEqual(second, 2);
                assert.strictEqual(editor.getText(), "[Image #1][Image #2]");
        });

        it("getExpandedText expands chips to their file paths", () => {
                const editor = makeEditor();
                editor.setText("compare ");
                editor.insertImageChip("/tmp/a.png");
                editor.insertImageChip("/tmp/b.png");
                assert.strictEqual(editor.getExpandedText(), "compare /tmp/a.png/tmp/b.png");
        });

        it("submit expands chips to the path (the model receives the file path)", () => {
                const editor = makeEditor();
                let submitted: string | undefined;
                editor.onSubmit = (text) => {
                        submitted = text;
                };
                editor.insertImageChip("/tmp/shot.png");
                editor.handleInput("\r"); // Enter
                assert.strictEqual(submitted, "/tmp/shot.png");
                assert.strictEqual(editor.getText(), "");
        });

        it("backspace deletes a whole chip in one press", () => {
                const editor = makeEditor();
                editor.insertImageChip("/tmp/shot.png");
                editor.handleInput("\x7f"); // Backspace
                assert.strictEqual(editor.getText(), "");
        });

        it("cursor-left then backspace removes the chip atomically mid-line", () => {
                const editor = makeEditor();
                editor.setText("hello ");
                editor.insertImageChip("/tmp/shot.png");
                editor.insertTextAtCursor(" tail");
                // "hello [Image #1] tail" — cursor at end; walk back over "tail"
                for (let i = 0; i < 5; i++) editor.handleInput("\x1b[D");
                editor.handleInput("\x7f"); // deletes the chip whole
                assert.strictEqual(editor.getText(), "hello  tail");
        });

        it("a literal [Image #1] with no registered chip stays literal on submit", () => {
                const editor = makeEditor();
                let submitted: string | undefined;
                editor.onSubmit = (text) => {
                        submitted = text;
                };
                editor.setText("typo [Image #1] reference");
                editor.handleInput("\r");
                assert.strictEqual(submitted, "typo [Image #1] reference");
        });

        it("deleting a chip keeps later chip ids stable", () => {
                const editor = makeEditor();
                let submitted: string | undefined;
                editor.onSubmit = (text) => {
                        submitted = text;
                };
                editor.insertImageChip("/tmp/a.png");
                editor.insertImageChip("/tmp/b.png");
                editor.insertTextAtCursor(" ");
                // Delete the first chip: cursor after "[Image #1][Image #2] "
                editor.handleInput("\x1b[D"); // left over the space
                editor.handleInput("\x7f"); // deletes [Image #2] (cursor lands where it was)
                assert.strictEqual(editor.getText(), "[Image #1] ");
                editor.insertImageChip("/tmp/c.png");
                // New chip gets id 3 (stable ids, no renumber) and inserts at the cursor
                assert.strictEqual(editor.getText(), "[Image #1][Image #3] ");
                editor.handleInput("\r");
                assert.strictEqual(submitted, "/tmp/a.png/tmp/c.png");
        });

        it("chips ride the draft-stash snapshot round-trip", () => {
                const editor = makeEditor();
                editor.setText("look at ");
                editor.insertImageChip("/tmp/shot.png");
                const snapshot = editor.saveEditorState();
                editor.setText("");
                editor.restoreEditorState(snapshot);
                let submitted: string | undefined;
                editor.onSubmit = (text) => {
                        submitted = text;
                };
                editor.handleInput("\r");
                assert.strictEqual(submitted, "look at /tmp/shot.png");
        });

        it("undo restores a deleted chip and its registry entry", () => {
                const editor = makeEditor();
                let submitted: string | undefined;
                editor.onSubmit = (text) => {
                        submitted = text;
                };
                editor.insertImageChip("/tmp/shot.png");
                editor.handleInput("\x7f"); // delete chip
                assert.strictEqual(editor.getText(), "");
                editor.handleInput("\x1f"); // Ctrl+_ undo
                assert.strictEqual(editor.getText(), "[Image #1]");
                editor.handleInput("\r");
                assert.strictEqual(submitted, "/tmp/shot.png");
        });
});
