import { setKeybindings, type TUI } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ExtensionSelectorComponent } from "../src/modes/interactive/components/extension-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

/**
 * The permission-comment lane (Toccata round A11 — Claude Code's "Tab to
 * amend"): on a permission ask, Tab on a commentable option opens a comment
 * field on it; Enter answers with the comment attached; Tab/Esc close the
 * field and KEEP the text (it rides if the option is answered later); the
 * rule-saving option never takes one.
 */

function createFakeTui(): TUI {
        // The comment field's Editor reads tui.terminal.rows for its visible window.
        return { requestRender: () => {}, terminal: { rows: 24 } } as unknown as TUI;
}

interface CommentProbe {
        component: ExtensionSelectorComponent;
        selected: Array<{ option: string; comment?: string }>;
        cancelled: number[];
}

function createCommentSelector(commentOn?: string[]): CommentProbe {
        const selected: Array<{ option: string; comment?: string }> = [];
        const cancelled: number[] = [];
        const options = ["Allow once", "Always allow (this session)", "Deny"];
        const component = new ExtensionSelectorComponent(
                "unown permissions: bash matched ask rule",
                options,
                (option, comment) => selected.push(comment === undefined ? { option } : { option, comment }),
                () => cancelled.push(1),
                { tui: createFakeTui(), commentOn: commentOn ?? ["Allow once", "Deny"] },
        );
        return { component, selected, cancelled };
}

describe("extension selector comment lane (Toccata A11 — Tab to amend)", () => {
        beforeAll(() => {
                initTheme("dark");
                setKeybindings(new KeybindingsManager());
        });

        it("hints 'Tab to amend' only when options take comments", () => {
                const withComments = createCommentSelector();
                expect(stripAnsi(withComments.component.render(120).join("\n"))).toContain("Tab to amend");

                const withoutComments = createCommentSelector([]);
                expect(stripAnsi(withoutComments.component.render(120).join("\n"))).not.toContain("Tab to amend");
        });

        it("Tab on a commentable option opens the field; typing goes to it, not the list", () => {
                const probe = createCommentSelector();
                probe.component.handleInput("\t"); // "Allow once" is focused
                const rendered = stripAnsi(probe.component.render(120).join("\n"));
                expect(rendered).toContain('comment on "Allow once"');

                probe.component.handleInput("p");
                probe.component.handleInput("l");
                probe.component.handleInput("e");
                probe.component.handleInput("a");
                probe.component.handleInput("s");
                probe.component.handleInput("e");
                // j/k are editor keys while the field is open (no list navigation)
                expect(probe.selected).toHaveLength(0);
        });

        it("Enter in the field answers the option WITH the comment", () => {
                const probe = createCommentSelector();
                probe.component.handleInput("\t");
                probe.component.handleInput("use a temp dir");
                probe.component.handleInput("\r");
                expect(probe.selected).toEqual([{ option: "Allow once", comment: "use a temp dir" }]);
        });

        it("Tab in the field closes it and keeps the text; a later Enter carries the comment", () => {
                const probe = createCommentSelector();
                probe.component.handleInput("\t");
                probe.component.handleInput("be careful");
                probe.component.handleInput("\t"); // close, keep text
                expect(stripAnsi(probe.component.render(120).join("\n"))).not.toContain("comment on");

                probe.component.handleInput("\r"); // plain Enter on the option
                expect(probe.selected).toEqual([{ option: "Allow once", comment: "be careful" }]);
        });

        it("Esc in the field closes it and keeps the text (the dialog is not cancelled)", () => {
                const probe = createCommentSelector();
                probe.component.handleInput("\t");
                probe.component.handleInput("note");
                probe.component.handleInput("\x1b");
                expect(probe.cancelled).toHaveLength(0);
                expect(stripAnsi(probe.component.render(120).join("\n"))).not.toContain("comment on");

                probe.component.handleInput("\r");
                expect(probe.selected).toEqual([{ option: "Allow once", comment: "note" }]);
        });

        it("re-opening the field seeds the kept text; clearing it drops the comment", () => {
                const probe = createCommentSelector();
                probe.component.handleInput("\t");
                probe.component.handleInput("kept");
                probe.component.handleInput("\t");
                probe.component.handleInput("\t"); // re-open — seeded with "kept"
                probe.component.handleInput("\r");
                expect(probe.selected).toEqual([{ option: "Allow once", comment: "kept" }]);

                // Clearing (backspaces) then answering drops the empty comment.
                const probe2 = createCommentSelector();
                probe2.component.handleInput("\t");
                probe2.component.handleInput("x");
                probe2.component.handleInput("\t");
                probe2.component.handleInput("\t");
                probe2.component.handleInput("\x7f"); // backspace the "x"
                probe2.component.handleInput("\r");
                expect(probe2.selected).toEqual([{ option: "Allow once" }]);
        });

        it("Tab on the rule-saving option never opens the field (Claude Code's own rule)", () => {
                const probe = createCommentSelector();
                probe.component.handleInput("j"); // move to "Always allow (this session)"
                probe.component.handleInput("\t");
                expect(stripAnsi(probe.component.render(120).join("\n"))).not.toContain("comment on");
                probe.component.handleInput("\r");
                expect(probe.selected).toEqual([{ option: "Always allow (this session)" }]);
        });

        it("Tab on a commentable Deny row answers Deny with the comment (the denial reason)", () => {
                const probe = createCommentSelector();
                probe.component.handleInput("j");
                probe.component.handleInput("j"); // focus "Deny"
                probe.component.handleInput("\t");
                probe.component.handleInput("too risky");
                probe.component.handleInput("\r");
                expect(probe.selected).toEqual([{ option: "Deny", comment: "too risky" }]);
        });
});
