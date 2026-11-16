/**
 * invisible.test.ts — the Da capo R7 lane: invisible-character
 * sanitization for prompt input (Claude Code v2.1.314's "plain prompts now
 * send cleaned on the first Enter" + paste-time stripping).
 */
import assert from "node:assert";
import { describe, it } from "node:test";
import { sanitizeInvisibleCharacters } from "../src/invisible.ts";
import { Editor } from "../src/components/editor.ts";
import { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "../src/keybindings.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

function makeEditor(): Editor {
        return new Editor(new TuiMainScreen(new VirtualTerminal()), defaultEditorTheme);
}

describe("sanitizeInvisibleCharacters (pure)", () => {
        it("strips zero-width characters", () => {
                const result = sanitizeInvisibleCharacters("clean\u200Btext\u200Dhere");
                assert.strictEqual(result.text, "cleantexthere");
                assert.strictEqual(result.stripped, 2);
        });

        it("strips bidi overrides (the trojan-source class)", () => {
                const result = sanitizeInvisibleCharacters("if (isAdmin)\u202E /* not admin */");
                assert.strictEqual(result.text, "if (isAdmin) /* not admin */");
                assert.strictEqual(result.stripped, 1);
        });

        it("strips bidi isolates and word joiners", () => {
                const result = sanitizeInvisibleCharacters("\u2066rtl\u2069\u2060join");
                assert.strictEqual(result.text, "rtljoin");
                assert.strictEqual(result.stripped, 3);
        });

        it("strips the BOM and interlinear annotations", () => {
                const result = sanitizeInvisibleCharacters("\uFEFFhello\uFFF9world\uFFFB");
                assert.strictEqual(result.text, "helloworld");
                assert.strictEqual(result.stripped, 3);
        });

        it("strips tag characters (emoji-flag ASCII smuggling)", () => {
                const result = sanitizeInvisibleCharacters("\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F} end");
                assert.ok(result.stripped >= 6);
                assert.ok(result.text.startsWith("\u{1F3F4}"));
                assert.ok(result.text.endsWith(" end"));
        });

        it("keeps visible text, whitespace, CJK, combining marks and emoji", () => {
                const input = "héllo 世界\tline2\n👍é";
                const result = sanitizeInvisibleCharacters(input);
                assert.strictEqual(result.text, input);
                assert.strictEqual(result.stripped, 0);
        });

        it("keeps soft hyphens and normal punctuation", () => {
                const input = "co­operate (y) [n] {x}";
                const result = sanitizeInvisibleCharacters(input);
                assert.strictEqual(result.text, input);
                assert.strictEqual(result.stripped, 0);
        });

        it("handles empty input", () => {
                const result = sanitizeInvisibleCharacters("");
                assert.deepStrictEqual(result, { text: "", stripped: 0 });
        });

        it("is stable across repeated calls (regex lastIndex discipline)", () => {
                const dirty = "a\u200Bb";
                assert.strictEqual(sanitizeInvisibleCharacters(dirty).stripped, 1);
                assert.strictEqual(sanitizeInvisibleCharacters(dirty).stripped, 1);
                assert.strictEqual(sanitizeInvisibleCharacters(dirty).stripped, 1);
        });
});

describe("Editor paste sanitization (R7)", () => {
        it("strips invisible characters from a bracketed paste", () => {
                const editor = makeEditor();
                editor.handleInput("\x1b[200~vi\u200Bsible\u202E only\x1b[201~");
                assert.strictEqual(editor.getText(), "visible only");
        });

        it("fires onInvisibleStripped with the count", () => {
                const editor = makeEditor();
                let noticed = 0;
                editor.onInvisibleStripped = (count) => {
                        noticed = count;
                };
                editor.handleInput("\x1b[200~a\u200Bb\u200Cc\x1b[201~");
                assert.strictEqual(noticed, 2);
        });

        it("leaves clean pastes untouched and silent", () => {
                const editor = makeEditor();
                let noticed = 0;
                editor.onInvisibleStripped = () => {
                        noticed++;
                };
                editor.handleInput("\x1b[200~clean paste\x1b[201~");
                assert.strictEqual(editor.getText(), "clean paste");
                assert.strictEqual(noticed, 0);
        });
});

describe("Editor onSubmit raw form (R6)", () => {
        it("submit reports the expanded text AND the raw marker form", () => {
                setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
                const editor = makeEditor();
                let captured: { text: string; raw?: string } | undefined;
                editor.onSubmit = (text, raw) => {
                        captured = { text, raw };
                };
                // A large paste (12 lines) collapses to a marker.
                const big = Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n");
                editor.handleInput(`\x1b[200~${big}\x1b[201~`);
                assert.ok(editor.getText().includes("[paste #1"));
                editor.handleInput("\r");
                assert.ok(captured);
                assert.ok(captured!.text.includes("line 11"), "expanded form carries the content");
                assert.ok(captured!.raw?.includes("[paste #1"), "raw form keeps the marker");
                assert.ok(!captured!.raw?.includes("line 11"), "raw form is compact");
        });
});
