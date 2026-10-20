// Unit tests for src/context-brief.ts — summary context mode (pi-cciotti
// port): the newest-first entry projection, the distillation prompt, the
// orchestrator's fallback discipline, and the delivery shape.
import { describe, expect, test } from "bun:test";
import {
        BRIEF_SOURCE_BUDGET_CHARS,
        buildBriefPrompt,
        composeTaskWithBrief,
        CONTEXT_BRIEF_MAX_CHARS,
        extractBriefSource,
        summarizeParentContext,
        type BriefChatFn,
} from "../src/context-brief.ts";

const entries = (mix: Array<Record<string, unknown>>) => mix;

describe("extractBriefSource", () => {
        test("projects user + assistant text with tool NAMES only, newest-first, session headers skipped", () => {
                const source = extractBriefSource([
                        { type: "session", id: "s1" },
                        { type: "message", message: { role: "user", content: "first question" } },
                        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "looking" }, { type: "toolCall", name: "grep" }, { type: "toolResult" }] } },
                        { type: "message", message: { role: "user", content: [{ type: "text", text: "second question" }] } },
                        { type: "message", message: { role: "assistant", content: [{ type: "toolCall", name: "read" }, { type: "text", text: "found it" }] } },
                ]);
                const lines = source.split("\n");
                expect(lines).toHaveLength(4);
                expect(lines[0]).toBe("USER: first question");
                expect(lines[1]).toBe("ASSISTANT: looking [tools: grep]");
                expect(lines[2]).toBe("USER: second question");
                expect(lines[3]).toBe("ASSISTANT: found it [tools: read]");
                // Tool RESULT bodies never appear.
                expect(source).not.toContain("toolResult");
        });
        test("respects the byte budget; the OLDEST (chronologically first) line carries the cut", () => {
                const big = Array.from({ length: 200 }, (_, i) => ({
                        type: "message",
                        message: { role: "user", content: `message number ${i} with some padding text to burn budget` },
                }));
                const source = extractBriefSource(big, 500);
                expect(source.length).toBeLessThanOrEqual(520);
                const lines = source.split("\n");
                // Chronological order: the first line is the oldest — that is
                // where the budget cut landed (newest context wins).
                expect(lines[0].endsWith("…")).toBe(true);
                expect(lines[lines.length - 1]).toContain("message number 199");
        });
        test("empty and unknown shapes are skipped silently", () => {
                expect(extractBriefSource([])).toBe("");
                expect(extractBriefSource([null, 5, "x", { type: "message", message: { role: "tool", content: "y" } }])).toBe("");
        });
});

describe("buildBriefPrompt", () => {
        test("carries the source, the rules, and the role instruction when present", () => {
                const plain = buildBriefPrompt("SRC");
                expect(plain).toContain("=== SESSION (newest last) ===");
                expect(plain).toContain("SRC");
                expect(plain).toContain("newest context wins");
                expect(plain).not.toContain("The consumer of this brief");
                const roled = buildBriefPrompt("SRC", "quote each decision verbatim");
                expect(roled).toContain("quote each decision verbatim");
        });
});

describe("summarizeParentContext", () => {
        const okChat: BriefChatFn = async () => "THE BRIEF";
        test("short sessions skip the paid call entirely (null)", async () => {
                const calls: number[] = [];
                const counting: BriefChatFn = async () => {
                        calls.push(1);
                        return "x";
                };
                expect(await summarizeParentContext(counting, [])).toBeNull();
                expect(await summarizeParentContext(counting, [{ type: "message", message: { role: "user", content: "hi" } }])).toBeNull();
                expect(calls).toHaveLength(0);
        });
        test("success: one call, brief returned (capped)", async () => {
                const calls: string[] = [];
                const recording: BriefChatFn = async (messages) => {
                        calls.push(messages[0].content);
                        return "THE BRIEF";
                };
                const many = Array.from({ length: 20 }, (_, i) => ({
                        type: "message",
                        message: { role: "user", content: `question ${i} about the auth refactor and the router module` },
                }));
                const brief = await summarizeParentContext(recording, many, { roleInstruction: "keep decisions" });
                expect(brief).toBe("THE BRIEF");
                expect(calls).toHaveLength(1);
                expect(calls[0]).toContain("keep decisions");
        });
        test("the final brief is capped at CONTEXT_BRIEF_MAX_CHARS", async () => {
                const long: BriefChatFn = async () => "x".repeat(10_000);
                const brief = await summarizeParentContext(long, entries([{ type: "message", message: { role: "user", content: `a real question with enough substance ${"y".repeat(200)}` } }]));
                expect(brief!.length).toBeLessThanOrEqual(CONTEXT_BRIEF_MAX_CHARS);
                expect(brief!.endsWith("…")).toBe(true);
        });
        test("LLM failure degrades to null (never throws, never aborts)", async () => {
                const failing: BriefChatFn = async () => {
                        throw new Error("429");
                };
                const brief = await summarizeParentContext(failing, entries([
                        { type: "message", message: { role: "user", content: `substantive question ${"z".repeat(200)}` } },
                ]));
                expect(brief).toBeNull();
        });
});

describe("composeTaskWithBrief", () => {
        test("brief first, task after — the cciotti framing", () => {
                const composed = composeTaskWithBrief("THE BRIEF", "do the thing");
                expect(composed).toBe("Context brief from the parent session:\nTHE BRIEF\n\nTask:\ndo the thing");
        });
});
