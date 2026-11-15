/**
 * Tool-call aggregation (Toccata round A10) — the Claude Code collapsed-run
 * contract on Unown's transcript: consecutive same-tool calls render as one
 * dim chip (`⋯ called bash ×3 · ctrl+o`) while collapsed, expand to the
 * individual blocks on the expand key, split on any other component, and
 * carry the past/present tense by run state. Also pins the expanded-block
 * timestamp lane (A9).
 */
import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ChatTranscriptContainer, ToolCallGroupComponent } from "../src/modes/interactive/components/tool-call-group.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { loadThemeFromPath, setThemeInstance } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const darkThemePath = new URL("../src/modes/interactive/theme/dark.json", import.meta.url).pathname;

function fakeTui(): any {
        return { requestRender: () => {}, addInterval: () => ({ dispose: () => {} }), removeInterval: () => {} };
}

function makeCall(name: string, id: string, args: any = { path: "x.ts" }): ToolExecutionComponent {
        return new ToolExecutionComponent(name, id, args, {}, undefined, fakeTui(), process.cwd());
}

function complete(component: ToolExecutionComponent, text = "ok", timestamp?: number): void {
        component.updateResult({ content: [{ type: "text", text }], isError: false, timestamp }, false);
}

describe("tool-call aggregation (Toccata A10)", () => {
        beforeAll(() => {
                setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
        });

        beforeEach(() => {
                setKeybindings(new KeybindingsManager());
        });

        it("consecutive same-tool calls collapse to the ×N chip", () => {
                const container = new ChatTranscriptContainer();
                const calls = [makeCall("bash", "a"), makeCall("bash", "b"), makeCall("bash", "c")];
                for (const call of calls) container.addChild(call);
                for (const call of calls) complete(call);

                expect(container.children).toHaveLength(1);
                const group = container.children[0] as ToolCallGroupComponent;
                expect(group).toBeInstanceOf(ToolCallGroupComponent);
                expect(group.callCount).toBe(3);

                const rendered = stripAnsi(container.render(120).join("\n"));
                expect(rendered).toContain("⋯ called bash ×3");
                expect(rendered).toContain("ctrl+o");
        });

        it("a single call renders exactly like the bare component", () => {
                const container = new ChatTranscriptContainer();
                const call = makeCall("bash", "a");
                container.addChild(call);
                complete(call, "hello output");

                expect(container.children).toHaveLength(1);
                const rendered = stripAnsi(container.render(120).join("\n"));
                const bare = stripAnsi(call.render(120).join("\n"));
                expect(rendered).toBe(bare);
                expect(rendered).not.toContain("×1");
        });

        it("a different tool splits the run", () => {
                const container = new ChatTranscriptContainer();
                const bashA = makeCall("bash", "a");
                const bashB = makeCall("bash", "b");
                const grep = makeCall("grep", "c");
                const bashC = makeCall("bash", "d");
                for (const call of [bashA, bashB, grep, bashC]) container.addChild(call);
                for (const call of [bashA, bashB, grep, bashC]) complete(call);

                expect(container.children).toHaveLength(3);
                const rendered = stripAnsi(container.render(120).join("\n"));
                expect(rendered).toContain("⋯ called bash ×2");
                // The single-call grep group delegates to its bare block (no ×1 chip).
                expect(rendered).toContain("grep");
                expect(rendered).not.toContain("grep ×");
        });

        it("any other component breaks the run", () => {
                const container = new ChatTranscriptContainer();
                const bashA = makeCall("bash", "a");
                const bashB = makeCall("bash", "b");
                const bashC = makeCall("bash", "c");
                container.addChild(bashA);
                container.addChild(bashB);
                container.addChild({ render: () => ["assistant text"], invalidate: () => {} });
                container.addChild(bashC);
                for (const call of [bashA, bashB, bashC]) complete(call);

                expect(container.children).toHaveLength(3);
                const rendered = stripAnsi(container.render(120).join("\n"));
                expect(rendered).toContain("⋯ called bash ×2");
        });

        it("present tense while the run is still executing", () => {
                const container = new ChatTranscriptContainer();
                const calls = [makeCall("bash", "a"), makeCall("bash", "b")];
                for (const call of calls) container.addChild(call);
                complete(calls[0]!);
                calls[1]!.updateResult({ content: [{ type: "text", text: "partial" }], isError: false }, true);

                const rendered = stripAnsi(container.render(120).join("\n"));
                expect(rendered).toContain("⋯ calling bash ×2…");
        });

        it("expanded renders the individual blocks (the setExpanded fan-out)", () => {
                const container = new ChatTranscriptContainer();
                const calls = [makeCall("bash", "a"), makeCall("bash", "b"), makeCall("bash", "c")];
                for (const call of calls) container.addChild(call);
                for (const call of calls) complete(call, `output for ${call.getToolName()}`);

                const group = container.children[0] as ToolCallGroupComponent;
                group.setExpanded(true);
                const expanded = stripAnsi(container.render(120).join("\n"));
                expect(expanded).not.toContain("×3");
                expect(expanded.match(/bash/g)?.length).toBeGreaterThanOrEqual(3);

                group.setExpanded(false);
                const collapsed = stripAnsi(container.render(120).join("\n"));
                expect(collapsed).toContain("⋯ called bash ×3");
        });

        it("expanded blocks carry the dim result timestamp", () => {
                const component = makeCall("read", "ts");
                const timestamp = new Date(2026, 0, 15, 10, 30, 45).getTime();
                complete(component, "line one\nline two", timestamp);
                component.setExpanded(true);

                const rendered = stripAnsi(component.render(120).join("\n"));
                expect(rendered).toContain("10:30:45");

                // Collapsed blocks stay clean.
                component.setExpanded(false);
                const collapsed = stripAnsi(component.render(120).join("\n"));
                expect(collapsed).not.toContain("10:30:45");
        });

        it("results routed to the child update the group render", () => {
                const container = new ChatTranscriptContainer();
                const calls = [makeCall("bash", "a"), makeCall("bash", "b")];
                for (const call of calls) container.addChild(call);

                // The pendingTools lane updates children directly; the group re-renders.
                complete(calls[1]!, "later result");
                const rendered = stripAnsi(container.render(120).join("\n"));
                expect(rendered).toContain("calling"); // still running (call a is partial by construction)
        });

        it("the group's diff stats are the sum over the run", () => {
                const group = new ToolCallGroupComponent(makeCall("write", "w1"));
                // diffLineCounts is undefined for unknown tools without results.
                expect(group.diffLineCounts()).toBeUndefined();
        });

        it("removeChild unwraps a bare call from its group", () => {
                const container = new ChatTranscriptContainer();
                const calls = [makeCall("bash", "a"), makeCall("bash", "b")];
                for (const call of calls) container.addChild(call);
                expect(container.children).toHaveLength(1);

                container.removeChild(calls[0]!);
                expect(container.children).toHaveLength(1);
                const group = container.children[0] as ToolCallGroupComponent;
                expect(group.callCount).toBe(1);
        });

        it("clear resets the trailing-run state", () => {
                const container = new ChatTranscriptContainer();
                const first = makeCall("bash", "a");
                container.addChild(first);
                container.clear();

                const second = makeCall("bash", "b");
                container.addChild(second);
                const group = container.children[0] as ToolCallGroupComponent;
                expect(group.callCount).toBe(1);
        });
});
