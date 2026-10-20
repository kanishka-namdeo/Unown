import { describe, expect, test } from "vitest";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

describe("UserMessageComponent", () => {
        test("renders the rail with closing OSC markers off line end, height stable", () => {
                initTheme("dark");

                const component = new UserMessageComponent("hello");
                const lines = component.render(20);

                // Beauty contract: the user turn is marked by an accent rail (»), not a
                // padding Box — a one-line message renders as exactly one line.
                expect(lines).toHaveLength(1);
                // Both zone markers open the single line, in order: START then END/FINAL.
                expect(lines[0].startsWith(OSC133_ZONE_START + OSC133_ZONE_END + OSC133_ZONE_FINAL)).toBe(true);
                expect(stripAnsi(lines[0]).startsWith("» hello")).toBe(true);
        });

        test("indents wrapped continuation lines under the rail", () => {
                initTheme("dark");

                const component = new UserMessageComponent("one two three four five six seven eight nine ten eleven twelve");
                const lines = component.render(20);

                expect(lines.length).toBeGreaterThan(1);
                expect(stripAnsi(lines[0]).startsWith("» ")).toBe(true);
                for (const line of lines.slice(1)) {
                        expect(stripAnsi(line).startsWith("  ")).toBe(true);
                }
        });

        test("chains Markdown transformers with user message context", () => {
                initTheme("dark");
                const calls: string[] = [];
                const component = new UserMessageComponent("The input is $x^2$.", undefined, 1, [
                        (markdown, context) => {
                                calls.push("formula");
                                expect(context).toEqual({ messageType: "user", isStreaming: false, availableWidth: 78 });
                                return markdown.replace("$x^2$", "x²");
                        },
                        (markdown) => {
                                calls.push("suffix");
                                return `${markdown} Done.`;
                        },
                ]);

                expect(stripAnsi(component.render(80).join("\n"))).toContain("The input is x². Done.");
                expect(calls).toEqual(["formula", "suffix"]);
        });

        test("reapplies Markdown transformers when invalidated", () => {
                initTheme("dark");
                let suffix = "before";
                const component = new UserMessageComponent("Message", undefined, 1, [(markdown) => `${markdown} ${suffix}`]);

                expect(stripAnsi(component.render(80).join("\n"))).toContain("Message before");

                suffix = "after";
                component.invalidate();

                expect(stripAnsi(component.render(80).join("\n"))).toContain("Message after");
        });
});
