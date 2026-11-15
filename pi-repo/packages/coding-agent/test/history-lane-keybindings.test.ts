/**
 * history-lane-keybindings.test.ts — the Toccata round's new app actions
 * reach their handlers through CustomEditor (Ctrl+R history search,
 * Ctrl+S draft stash, Ctrl+Enter / Alt+S send-queued-now), and Ctrl+D
 * still deletes forward when the editor holds text (exit only when empty).
 */
import { describe, expect, it, vi } from "vitest";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { TuiMainScreen } from "@earendil-works/pi-tui";
import { defaultEditorTheme } from "../../tui/test/test-themes.ts";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";

describe("history lane keybindings (the Toccata round)", () => {
        it("ctrl+r dispatches app.history.search", () => {
                const editor = new CustomEditor(new TuiMainScreen(new VirtualTerminal()), defaultEditorTheme, new KeybindingsManager());
                const handler = vi.fn();
                editor.onAction("app.history.search", handler);
                editor.handleInput("\x12"); // Ctrl+R
                expect(handler).toHaveBeenCalledTimes(1);
        });

        it("ctrl+s dispatches app.editor.stash", () => {
                const editor = new CustomEditor(new TuiMainScreen(new VirtualTerminal()), defaultEditorTheme, new KeybindingsManager());
                const handler = vi.fn();
                editor.onAction("app.editor.stash", handler);
                editor.handleInput("\x13"); // Ctrl+S
                expect(handler).toHaveBeenCalledTimes(1);
        });

        it("alt+s dispatches app.message.sendQueued (the always-works key)", () => {
                const editor = new CustomEditor(new TuiMainScreen(new VirtualTerminal()), defaultEditorTheme, new KeybindingsManager());
                const handler = vi.fn();
                editor.onAction("app.message.sendQueued", handler);
                editor.handleInput("\x1bs"); // ESC + s = Alt+S
                expect(handler).toHaveBeenCalledTimes(1);
        });

        it("kitty ctrl+enter sequence dispatches app.message.sendQueued", () => {
                const editor = new CustomEditor(new TuiMainScreen(new VirtualTerminal()), defaultEditorTheme, new KeybindingsManager());
                const handler = vi.fn();
                editor.onAction("app.message.sendQueued", handler);
                editor.handleInput("\x1b[13;5u"); // Kitty CSI-u ctrl+enter
                expect(handler).toHaveBeenCalledTimes(1);
        });

        it("ctrl+d with text deletes the character after the cursor instead of exiting", () => {
                const editor = new CustomEditor(new TuiMainScreen(new VirtualTerminal()), defaultEditorTheme, new KeybindingsManager());
                const exitHandler = vi.fn();
                editor.onCtrlD = exitHandler;
                editor.setText("abc");
                editor.handleInput("\x1b[D"); // Left — cursor between b and c
                editor.handleInput("\x04"); // Ctrl+D deletes forward ("c")
                expect(exitHandler).not.toHaveBeenCalled();
                expect(editor.getText()).toBe("ab");
        });

        it("ctrl+d on an empty editor routes to the exit handler (two-press confirm lives there)", () => {
                const editor = new CustomEditor(new TuiMainScreen(new VirtualTerminal()), defaultEditorTheme, new KeybindingsManager());
                const exitHandler = vi.fn();
                editor.onCtrlD = exitHandler;
                editor.handleInput("\x04"); // Ctrl+D
                expect(exitHandler).toHaveBeenCalledTimes(1);
        });
});
