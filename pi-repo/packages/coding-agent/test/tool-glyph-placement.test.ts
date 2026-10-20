import { setKeybindings, Text, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { beforeAll, describe, expect, it } from "vitest";
import type { ToolDefinition } from "../src/core/extensions/types.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { createWriteToolDefinition } from "../src/core/tools/write.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function createFakeTui(): TUI {
        return { requestRender: () => {} } as unknown as TUI;
}

/**
 * Round 5 (density): the state glyph must ride the tool block's first
 * CONTENT line (the title), never a Box padding row. Pane-verified defect:
 * default-shell blocks opened with the glyph orphaned on its own blank row
 * and the title indented below it.
 */
describe("ToolExecutionComponent glyph placement (round 5, density)", () => {
        beforeAll(() => {
                initTheme("dark");
                setKeybindings(new KeybindingsManager());
        });

        function renderWriteBlock(args: Record<string, unknown>): string[] {
                const toolDefinition: ToolDefinition = {
                        ...createWriteToolDefinition(process.cwd()),
                } as ToolDefinition;
                const component = new ToolExecutionComponent(
                        "write",
                        "test-call",
                        args,
                        {},
                        toolDefinition,
                        createFakeTui(),
                        "/tmp/project",
                );
                // Complete the call and give it a successful result so the glyph
                // is the ✓ state.
                component.setArgsComplete();
                component.updateResult({ content: [{ type: "text", text: "ok" }], isError: false });
                return component.render(100);
        }

        it("places the glyph on the write title line, not on a padding row", () => {
                const lines = renderWriteBlock({ file_path: "/tmp/project/hi.py", content: "print('hi')" });
                const plain = lines.map(stripAnsi);
                const titleRow = plain.find((line) => line.includes("write"));
                expect(titleRow).toBeDefined();
                expect(titleRow!.trimStart().startsWith("✓")).toBe(true);
                expect(titleRow!.includes("write")).toBe(true);
                // No row may be the orphaned glyph alone.
                for (const line of plain) {
                        expect(line.trim() === "✓").toBe(false);
                }
        });

        it("renders a self-shell block's glyph on its first content line too", () => {
                const toolDefinition: ToolDefinition = {
                        name: "custom_tool",
                        label: "custom_tool",
                        description: "custom tool",
                        parameters: Type.Any(),
                        execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
                        renderCall: () => new Text("custom call body", 0, 0),
                        renderResult: () => new Text("", 0, 0),
                };
                const component = new ToolExecutionComponent(
                        "custom_tool",
                        "tool-1",
                        {},
                        {},
                        toolDefinition,
                        createFakeTui(),
                        process.cwd(),
                );
                component.setArgsComplete();
                component.updateResult({ content: [{ type: "text", text: "ok" }], isError: false });
                const plain = component.render(80).map(stripAnsi);
                const titleRow = plain.find((line) => line.includes("custom call"));
                expect(titleRow).toBeDefined();
                expect(titleRow!.trimStart().startsWith("✓")).toBe(true);
        });
});
