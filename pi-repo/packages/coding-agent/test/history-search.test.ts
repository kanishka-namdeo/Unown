/**
 * history-search.test.ts — the Da capo R6 lane: the Ctrl+R dialog matches
 * text inside collapsed paste pills (Claude Code v2.1.314's contract) while
 * displaying the marker form and accepting the expansion.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getKeybindings } from "@earendil-works/pi-tui";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { HistorySearchComponent, type HistorySearchScope } from "../src/modes/interactive/components/history-search.ts";
import type { EditorHistoryEntry } from "../src/core/extensions/index.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const ENTER = "\r";
const ESCAPE = "\x1b";
const TAB = "\t";
const CTRL_R = "\x12";

interface AcceptCapture {
        text: string;
        mode: "submit" | "edit";
}

function makeScopes(entries: EditorHistoryEntry[]): HistorySearchScope[] {
        return [
                {
                        id: "session",
                        label: "this session",
                        load: () => entries.map((entry) => entry.text),
                        loadEntries: () => entries,
                },
        ];
}

function makeComponent(entries: EditorHistoryEntry[], accepted: AcceptCapture[]): HistorySearchComponent {
        return new HistorySearchComponent({
                scopes: makeScopes(entries),
                terminalHeight: 40,
                onAccept: (text, mode) => {
                        accepted.push({ text, mode });
                },
                onCancel: () => {},
        });
}

describe("HistorySearch dual-form entries (Da capo R6)", () => {
        beforeAll(() => {
                initTheme(undefined, false);
        });

        const pillEntries: EditorHistoryEntry[] = [
                { text: "fix the login bug\n[paste #1 +120 lines]" },
                { text: "explain this\n[paste #2 845 chars]", expanded: "explain this\nexport function toggleSidebar() {\n  const open = useStore((s) => s.sidebarOpen);" },
        ];

        it("matches a query that only exists inside the paste expansion", () => {
                const accepted: AcceptCapture[] = [];
                const component = makeComponent(pillEntries, accepted);
                // "toggleSidebar" appears only in the second entry's expansion.
                for (const char of "toggleSidebar") {
                        component.handleInput(char);
                }
                const rendered = component.render(120).map(stripAnsi).join("\n");
                expect(rendered).toContain("explain this");
                expect(rendered).not.toContain("fix the login bug");
        });

        it("displays the marker form even when matching the expansion", () => {
                const accepted: AcceptCapture[] = [];
                const component = makeComponent(pillEntries, accepted);
                for (const char of "toggleSidebar") {
                        component.handleInput(char);
                }
                const rendered = component.render(120).map(stripAnsi).join("\n");
                expect(rendered).toContain("explain this");
                expect(rendered).toContain("in paste");
        });

        it("accept inserts the EXPANSION, never the dead marker", () => {
                const accepted: AcceptCapture[] = [];
                const component = makeComponent(pillEntries, accepted);
                for (const char of "toggleSidebar") {
                        component.handleInput(char);
                }
                component.handleInput(ENTER);
                expect(accepted).toHaveLength(1);
                expect(accepted[0].mode).toBe("submit");
                expect(accepted[0].text).toContain("export function toggleSidebar()");
                expect(accepted[0].text).not.toContain("[paste #2");
        });

        it("Tab accepts into edit mode with the expansion", () => {
                const accepted: AcceptCapture[] = [];
                const component = makeComponent(pillEntries, accepted);
                for (const char of "toggleSidebar") {
                        component.handleInput(char);
                }
                component.handleInput(TAB);
                expect(accepted).toHaveLength(1);
                expect(accepted[0].mode).toBe("edit");
                expect(accepted[0].text).toContain("toggleSidebar()");
        });

        it("markerless entries keep matching and accepting themselves", () => {
                const accepted: AcceptCapture[] = [];
                const component = makeComponent(pillEntries, accepted);
                for (const char of "fix the login") {
                        component.handleInput(char);
                }
                component.handleInput(ENTER);
                expect(accepted[0].text).toBe("fix the login bug\n[paste #1 +120 lines]");
        });

        it("scopes without loadEntries fall back to load() strings", () => {
                const accepted: AcceptCapture[] = [];
                const component = new HistorySearchComponent({
                        scopes: [
                                {
                                        id: "legacy",
                                        label: "legacy store",
                                        load: () => ["legacy prompt"],
                                },
                        ],
                        terminalHeight: 40,
                        onAccept: (text, mode) => {
                                accepted.push({ text, mode });
                        },
                        onCancel: () => {},
                });
                for (const char of "legacy") {
                        component.handleInput(char);
                }
                component.handleInput(ENTER);
                expect(accepted[0].text).toBe("legacy prompt");
        });

        it("Esc cancels without accepting", () => {
                const accepted: AcceptCapture[] = [];
                const component = makeComponent(pillEntries, accepted);
                component.handleInput(ESCAPE);
                expect(accepted).toHaveLength(0);
        });

        it("the global keybindings manager is available for select keys", () => {
                // The component routes tui.select.* through getKeybindings();
                // this pins that the shared manager exists in the test env.
                expect(getKeybindings()).toBeDefined();
                expect(typeof getKeybindings().matches).toBe("function");
        });
});
