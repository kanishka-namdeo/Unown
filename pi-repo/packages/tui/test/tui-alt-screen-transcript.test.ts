import assert from "node:assert";
import { describe, it } from "node:test";
import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import { getKeybindings, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "../src/keybindings.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

class RecordingTerminal extends VirtualTerminal {
        readonly events: Array<{ type: "write"; data: string } | { type: "start" } | { type: "stop" }> = [];

        override start(onInput: (data: string) => void, onResize: () => void): void {
                this.events.push({ type: "start" });
                super.start(onInput, onResize);
        }

        override write(data: string): void {
                this.events.push({ type: "write", data });
                super.write(data);
        }

        override stop(): void {
                this.events.push({ type: "stop" });
                super.stop();
        }
}

const OSC133_ZONE_START = "\x1b]133;A\x07";

interface EditorProbe {
        component: {
                focused: boolean;
                render: () => string[];
                invalidate: () => void;
                handleInput: (data: string) => void;
        };
        inputs: string[];
}

function makeEditorProbe(): EditorProbe {
        const inputs: string[] = [];
        return {
                inputs,
                component: {
                        focused: false,
                        render: () => ["editor"],
                        invalidate: () => {},
                        handleInput: (data: string) => inputs.push(data),
                },
        };
}

function makeLayout(tui: TuiAltScreen, transcriptContent: Text, editor: EditorProbe["component"]): ScrollView {
        const transcript = new ScrollView(transcriptContent, { follow: "end", primary: true });
        tui.setLayoutRoot(
                new VStack([
                        { component: transcript, basis: 0, grow: 1, minSize: 1 },
                        { component: editor, basis: 1, shrink: 0 },
                ]),
        );
        return transcript;
}

describe("TuiAltScreen transcript mode (Toccata A9)", () => {
        it("ctrl+o toggles the mode: the hint bar shows, editor typing is consumed, q exits", async () => {
                const originalKeybindings = getKeybindings();
                setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
                const terminal = new VirtualTerminal(60, 8);
                const modeChanges: boolean[] = [];
                const tui = new TuiAltScreen(terminal, undefined, undefined, {
                        onTranscriptModeChange: (active) => modeChanges.push(active),
                });
                const editor = makeEditorProbe();
                makeLayout(tui, new Text(Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n"), 0, 0), editor.component);
                tui.setFocus(editor.component);
                tui.start();
                try {
                        await terminal.waitForRender();

                        // Enter: ctrl+o (legacy 0x0f).
                        terminal.sendInput("\x0f");
                        await terminal.waitForRender();
                        assert.strictEqual(tui.isTranscriptModeActive(), true);
                        assert.ok(terminal.getViewport().some((line) => line.includes("transcript")));
                        assert.deepStrictEqual(modeChanges, [true]);

                        // Editor typing is consumed by the mode.
                        terminal.sendInput("x");
                        terminal.sendInput("{");
                        await terminal.waitForRender();
                        assert.deepStrictEqual(editor.inputs, []);

                        // Exit via q.
                        terminal.sendInput("q");
                        await terminal.waitForRender();
                        assert.strictEqual(tui.isTranscriptModeActive(), false);
                        assert.ok(!terminal.getViewport().some((line) => line.includes("transcript ·")));
                        assert.deepStrictEqual(modeChanges, [true, false]);

                        // Editor receives typing again.
                        terminal.sendInput("x");
                        await terminal.waitForRender();
                        assert.deepStrictEqual(editor.inputs, ["x"]);
                } finally {
                        tui.stop();
                        setKeybindings(originalKeybindings);
                }
        });

        it("esc and ctrl+c exit the mode", async () => {
                const originalKeybindings = getKeybindings();
                setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
                const terminal = new VirtualTerminal(60, 8);
                const tui = new TuiAltScreen(terminal);
                const editor = makeEditorProbe();
                makeLayout(tui, new Text("content", 0, 0), editor.component);
                tui.setFocus(editor.component);
                tui.start();
                try {
                        await terminal.waitForRender();
                        terminal.sendInput("\x0f");
                        await terminal.waitForRender();
                        assert.strictEqual(tui.isTranscriptModeActive(), true);

                        terminal.sendInput("\x1b");
                        await terminal.waitForRender();
                        assert.strictEqual(tui.isTranscriptModeActive(), false);

                        terminal.sendInput("\x0f");
                        await terminal.waitForRender();
                        assert.strictEqual(tui.isTranscriptModeActive(), true);
                        terminal.sendInput("\x03");
                        await terminal.waitForRender();
                        assert.strictEqual(tui.isTranscriptModeActive(), false);
                } finally {
                        tui.stop();
                        setKeybindings(originalKeybindings);
                }
        });

        it("{ and } jump between OSC 133 prompts like vim paragraph motion", async () => {
                const originalKeybindings = getKeybindings();
                setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
                const terminal = new VirtualTerminal(30, 3);
                const tui = new TuiAltScreen(terminal);
                const editor = makeEditorProbe();
                makeLayout(
                        tui,
                        new Text(
                                [1, 2, 3, 4].flatMap((message) => [`${OSC133_ZONE_START}message ${message}`, "detail"]).join("\n"),
                                0,
                                0,
                        ),
                        editor.component,
                );
                tui.setFocus(editor.component);
                tui.start();
                try {
                        await terminal.waitForRender();
                        // 3-row terminal minus the dock row = 2 visible rows of 8 lines.
                        assert.strictEqual(tui.viewportTop, 6);

                        terminal.sendInput("\x0f");
                        await terminal.waitForRender();

                        // { = previous prompt (up one prompt block).
                        terminal.sendInput("{");
                        await terminal.waitForRender();
                        assert.strictEqual(tui.viewportTop, 4);

                        terminal.sendInput("{");
                        await terminal.waitForRender();
                        assert.strictEqual(tui.viewportTop, 2);

                        // } = next prompt (down one prompt block).
                        terminal.sendInput("}");
                        await terminal.waitForRender();
                        assert.strictEqual(tui.viewportTop, 4);
                } finally {
                        tui.stop();
                        setKeybindings(originalKeybindings);
                }
        });

        it("? toggles the keyboard-help panel", async () => {
                const originalKeybindings = getKeybindings();
                setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
                const terminal = new VirtualTerminal(60, 34);
                const tui = new TuiAltScreen(terminal);
                const editor = makeEditorProbe();
                makeLayout(tui, new Text("content", 0, 0), editor.component);
                tui.setFocus(editor.component);
                tui.start();
                try {
                        await terminal.waitForRender();
                        terminal.sendInput("\x0f");
                        await terminal.waitForRender();

                        terminal.sendInput("?");
                        await terminal.waitForRender();
                        const withHelp = terminal.getViewport();
                        assert.ok(withHelp.some((line) => line.includes("Transcript mode")));
                        assert.ok(withHelp.some((line) => line.includes("Navigation")));
                        assert.ok(withHelp.some((line) => line.includes("Prompts & search")));
                        assert.ok(withHelp.some((line) => line.includes("Actions")));

                        terminal.sendInput("?");
                        await terminal.waitForRender();
                        assert.ok(!terminal.getViewport().some((line) => line.includes("Transcript mode")));
                } finally {
                        tui.stop();
                        setKeybindings(originalKeybindings);
                }
        });

        it("less-style navigation: j/k lines, g/G ends, ctrl+u/d half pages, space page-down", async () => {
                const originalKeybindings = getKeybindings();
                setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
                const terminal = new VirtualTerminal(20, 5);
                const tui = new TuiAltScreen(terminal);
                const editor = makeEditorProbe();
                makeLayout(tui, new Text(Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"), 0, 0), editor.component);
                tui.setFocus(editor.component);
                tui.start();
                try {
                        await terminal.waitForRender();
                        // 5-row terminal minus the dock row = 4 visible rows of 30 lines.
                        assert.strictEqual(tui.viewportTop, 26);

                        terminal.sendInput("\x0f");
                        await terminal.waitForRender();

                        terminal.sendInput("k");
                        await terminal.waitForRender();
                        assert.strictEqual(tui.viewportTop, 25);
                        terminal.sendInput("j");
                        await terminal.waitForRender();
                        assert.strictEqual(tui.viewportTop, 26);

                        terminal.sendInput("g");
                        await terminal.waitForRender();
                        assert.strictEqual(tui.viewportTop, 0);
                        terminal.sendInput("\x04");
                        await terminal.waitForRender();
                        assert.strictEqual(tui.viewportTop, 2);
                        // space = page down (page = viewport height minus overlap, min 1).
                        terminal.sendInput(" ");
                        await terminal.waitForRender();
                        assert.strictEqual(tui.viewportTop, 3);

                        terminal.sendInput("G");
                        await terminal.waitForRender();
                        assert.strictEqual(tui.viewportTop, 26);
                } finally {
                        tui.stop();
                        setKeybindings(originalKeybindings);
                }
        });

        it("/ opens the transcript search and typing queries it", async () => {
                const originalKeybindings = getKeybindings();
                setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
                const terminal = new VirtualTerminal(60, 8);
                const tui = new TuiAltScreen(terminal);
                const editor = makeEditorProbe();
                makeLayout(
                        tui,
                        new Text(
                                Array.from({ length: 12 }, (_, index) => (index === 9 ? "line 10 needle" : `line ${index + 1}`)).join("\n"),
                                0,
                                0,
                        ),
                        editor.component,
                );
                tui.setFocus(editor.component);
                tui.start();
                try {
                        await terminal.waitForRender();
                        terminal.sendInput("\x0f");
                        await terminal.waitForRender();

                        terminal.sendInput("/");
                        await terminal.waitForRender();
                        assert.ok(terminal.getViewport().some((line) => line.includes("Find transcript")));

                        // Typing goes to the search overlay, not the editor.
                        terminal.sendInput("needle");
                        await terminal.waitForRender();
                        assert.ok(terminal.getViewport().some((line) => line.includes("Find transcript") && line.includes("1/1")));
                        assert.deepStrictEqual(editor.inputs, []);

                        // Esc closes the search; the mode stays active.
                        terminal.sendInput("\x1b");
                        await terminal.waitForRender();
                        assert.ok(!terminal.getViewport().some((line) => line.includes("Find transcript")));
                        assert.strictEqual(tui.isTranscriptModeActive(), true);
                } finally {
                        tui.stop();
                        setKeybindings(originalKeybindings);
                }
        });

        it("v hands the conversation to the host editor flow and re-arms the mode", async () => {
                const originalKeybindings = getKeybindings();
                setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
                const terminal = new VirtualTerminal(60, 8);
                let editorCalls = 0;
                const tui = new TuiAltScreen(terminal, undefined, undefined, {
                        onTranscriptOpenEditor: async () => {
                                editorCalls += 1;
                        },
                });
                const editor = makeEditorProbe();
                makeLayout(tui, new Text("content", 0, 0), editor.component);
                tui.setFocus(editor.component);
                tui.start();
                try {
                        await terminal.waitForRender();
                        terminal.sendInput("\x0f");
                        await terminal.waitForRender();
                        assert.strictEqual(tui.isTranscriptModeActive(), true);

                        terminal.sendInput("v");
                        await terminal.waitForRender();
                        assert.strictEqual(editorCalls, 1);
                        assert.strictEqual(tui.isTranscriptModeActive(), true);
                } finally {
                        tui.stop();
                        setKeybindings(originalKeybindings);
                }
        });

        it("[ writes the document to the scrollback, parks, and re-arms on the next keypress", async () => {
                const originalKeybindings = getKeybindings();
                setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
                const terminal = new RecordingTerminal(40, 4);
                let releaseKeypress: (() => void) | undefined;
                const tui = new TuiAltScreen(terminal, undefined, undefined, {
                        onTranscriptWaitKeypress: () =>
                                new Promise<void>((resolve) => {
                                        releaseKeypress = resolve;
                                }),
                });
                const editor = makeEditorProbe();
                makeLayout(tui, new Text(Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join("\n"), 0, 0), editor.component);
                tui.setFocus(editor.component);
                tui.start();
                try {
                        await terminal.waitForRender();
                        terminal.sendInput("\x0f");
                        await terminal.waitForRender();

                        terminal.sendInput("[");
                        await terminal.waitForRender();
                        // The TUI stopped and wrote the document + the parking hint.
                        assert.ok(terminal.events.some((event) => event.type === "stop"));
                        assert.ok(
                                terminal.events.some(
                                        (event) => event.type === "write" && event.data.includes("transcript written to scrollback"),
                                ),
                        );
                        assert.ok(terminal.events.some((event) => event.type === "write" && event.data.includes("line 8")));
                        assert.strictEqual(tui.isTranscriptModeActive(), false);

                        assert.ok(releaseKeypress);
                        releaseKeypress!();
                        await terminal.waitForRender();
                        assert.ok(terminal.events.some((event) => event.type === "start"));
                        assert.strictEqual(tui.isTranscriptModeActive(), true);
                } finally {
                        tui.stop();
                        setKeybindings(originalKeybindings);
                }
        });

        it("yields to a focused docked dialog that wants viewport navigation", async () => {
                const originalKeybindings = getKeybindings();
                setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
                const terminal = new VirtualTerminal(40, 6);
                const tui = new TuiAltScreen(terminal);
                const editor = makeEditorProbe();
                const transcript = makeLayout(tui, new Text("content", 0, 0), editor.component);
                // A docked dialog that claims viewport nav keys, like the extension selector.
                const dialogInputs: string[] = [];
                const dialog = {
                        focused: false,
                        wantsViewportNav: true,
                        render: () => ["dialog"],
                        invalidate: () => {},
                        handleInput: (data: string) => dialogInputs.push(data),
                };
                tui.setFocus(editor.component);
                tui.start();
                try {
                        await terminal.waitForRender();
                        terminal.sendInput("\x0f");
                        await terminal.waitForRender();
                        assert.strictEqual(tui.isTranscriptModeActive(), true);

                        // A dialog takes the dock (focus swaps) — the next key exits the
                        // mode and reaches the dialog.
                        tui.setFocus(dialog);
                        terminal.sendInput("x");
                        await terminal.waitForRender();
                        assert.strictEqual(tui.isTranscriptModeActive(), false);
                        assert.deepStrictEqual(dialogInputs, ["x"]);

                        // The dialog keeps ctrl+o for itself (the mode never re-enters).
                        terminal.sendInput("\x0f");
                        await terminal.waitForRender();
                        assert.deepStrictEqual(dialogInputs, ["x", "\x0f"]);
                        assert.strictEqual(tui.isTranscriptModeActive(), false);
                } finally {
                        tui.stop();
                        setKeybindings(originalKeybindings);
                }
        });
});
