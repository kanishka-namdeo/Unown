import { beforeAll, describe, expect, it } from "vitest";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { SelectorHints } from "../src/modes/interactive/components/selector-hints.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("SelectorHints (round 5, R4)", () => {
        beforeAll(() => {
                initTheme(undefined, false);
        });

        const hints = () =>
                new SelectorHints(["Enter to select", "Ctrl+S to set as default", "Esc to cancel"]);

        it("renders every segment when the width allows", () => {
                const line = stripAnsi(hints().render(120)[0]);
                expect(line).toContain("Enter to select");
                expect(line).toContain("Ctrl+S to set as default");
                expect(line).toContain("Esc to cancel");
        });

        it("drops trailing segments instead of wrapping at narrow widths", () => {
                const lines = hints().render(40);
                expect(lines).toHaveLength(1);
                const line = stripAnsi(lines[0]);
                expect(line.includes("Enter to select")).toBe(true);
                expect(line.includes("Esc to cancel")).toBe(false);
                expect(line.includes("Ctrl+S")).toBe(false);
                expect(line.length).toBeLessThanOrEqual(40);
        });

        it("keeps the first segment with an ellipsis below its natural width", () => {
                const lines = hints().render(12);
                expect(lines).toHaveLength(1);
                const line = stripAnsi(lines[0]);
                expect(line.length).toBeLessThanOrEqual(12);
                expect(line.endsWith("…")).toBe(true);
        });

        it("never emits more than one line at any width", () => {
                for (const width of [8, 16, 24, 32, 48, 64, 96, 128, 200]) {
                        expect(hints().render(width)).toHaveLength(1);
                }
        });
});
