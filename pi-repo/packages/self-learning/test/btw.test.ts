// Unit tests for src/btw.ts — the /btw side-question lane.
//
// Pins: context building (recency window, clipping, total cap, tool-noise
// elision, chronological order, malformed-entry tolerance), answer
// formatting, the never-throws failure posture, and the question guard.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { describe, expect, test } from "bun:test";
import {
        answerBtw,
        BTW_CONTEXT_MESSAGES,
        BTW_MESSAGE_CAP,
        BTW_SYSTEM_PROMPT,
        buildBtwMessages,
        btwHeader,
        btwMessageText,
        formatBtwAnswer,
} from "../src/btw.ts";

function msg(id: string, role: "user" | "assistant", text: string) {
        return { type: "message", id, parentId: null, timestamp: "", message: { role, content: text } };
}

describe("btwMessageText", () => {
        test("string content passes through; block arrays flatten text and elide tool noise to markers", () => {
                expect(btwMessageText("hello")).toBe("hello");
                expect(btwMessageText(null)).toBe("");
                expect(btwMessageText(42)).toBe("");
                expect(
                        btwMessageText([
                                { type: "text", text: "part one" },
                                { type: "toolCall", name: "bash" },
                                { type: "text", text: "part two" },
                                { type: "toolResult", content: "x" },
                        ]),
                ).toBe("part one\n[tool: bash]\npart two");
        });
});

describe("buildBtwMessages", () => {
        test("system + recent turns (chronological) + the question last", () => {
                const entries = [
                        msg("m1", "user", "first question"),
                        msg("m2", "assistant", "first answer"),
                        msg("m3", "user", "second question"),
                        msg("m4", "assistant", "second answer"),
                ];
                const out = buildBtwMessages(entries, "what did you do?");
                expect(out[0]).toEqual({ role: "system", content: BTW_SYSTEM_PROMPT });
                expect(out.slice(1, 5).map((m) => m.content)).toEqual([
                        "first question",
                        "first answer",
                        "second question",
                        "second answer",
                ]);
                expect(out[out.length - 1].role).toBe("user");
                expect(out[out.length - 1].content).toContain("what did you do?");
                expect(out[out.length - 1].content).toContain("invisible to it");
        });

        test("toolResult and malformed entries never enter the context", () => {
                const entries = [
                        { type: "message", message: { role: "toolResult", content: "noise" } },
                        null,
                        { type: "compaction" },
                        msg("m1", "user", "real question"),
                        { type: "message", message: { role: "assistant" } }, // no content field
                ];
                const out = buildBtwMessages(entries, "q");
                expect(out).toHaveLength(3); // system + the one real turn + the question
                expect(out[1].content).toBe("real question");
                expect(out[2].content).toContain("Side question");
                expect(out[2].content.trimEnd()).toContain("q");
        });

        test("recency window: only the last N messages ride", () => {
                const entries: unknown[] = [];
                for (let i = 0; i < 30; i++) entries.push(msg(`m${i}`, i % 2 ? "assistant" : "user", `message ${i}`));
                const out = buildBtwMessages(entries, "q", { contextMessages: 4 });
                expect(out.length).toBe(6); // system + 4 + question
                expect(out[1].content).toBe("message 26");
        });

        test("per-message clip and total cap (oldest dropped first)", () => {
                const long = "x".repeat(5000);
                const entries = [msg("m1", "user", long), msg("m2", "assistant", long), msg("m3", "user", "short")];
                const out = buildBtwMessages(entries, "q", { messageCap: 100, totalCap: 150 });
                // The question is the payload, not budgeted context: it rides last.
                const question = out[out.length - 1];
                expect(question.role).toBe("user");
                expect(question.content).toContain("Side question");
                const contextMsgs = out.slice(1, -1);
                // Newest kept: m3 ("short") survives; one clipped long message fits the budget; the oldest is dropped.
                expect(contextMsgs.some((m) => m.content === "short")).toBe(true);
                expect(contextMsgs.every((m) => m.content.length <= 105)).toBe(true);
                const total = contextMsgs.reduce((n, m) => n + m.content.length, 0);
                expect(total).toBeLessThanOrEqual(150);
                expect(contextMsgs).toHaveLength(2);
        });

        test("empty entries degrade to system + question only", () => {
                const out = buildBtwMessages([], "q");
                expect(out).toHaveLength(2);
                expect(out[0].role).toBe("system");
        });

        test("clipped messages carry the marker", () => {
                const entries = [msg("m1", "user", "y".repeat(5000))];
                const out = buildBtwMessages(entries, "q", { messageCap: 100 });
                expect(out[1].content).toContain("… [clipped]");
        });
});

describe("formatBtwAnswer / btwHeader", () => {
        test("answer is trimmed, capped, whitespace-collapsed", () => {
                expect(formatBtwAnswer("  hi  ")).toBe("hi");
                expect(formatBtwAnswer(`${"a".repeat(5000)}`, 100)).toHaveLength(101); // 100 + ellipsis char
                expect(formatBtwAnswer("a\n\n\n\n\nb")).toBe("a\n\nb");
        });
        test("header clips long questions to 60 chars", () => {
                expect(btwHeader("short")).toBe("btw · short");
                const long = "q".repeat(100);
                const header = btwHeader(long);
                expect(header.startsWith("btw · qqq")).toBe(true);
                expect(header.length).toBeLessThanOrEqual(70);
        });
});

describe("answerBtw", () => {
        test("success path returns the formatted answer", async () => {
                const chat = async () => "  it retries with backoff  ";
                const out = await answerBtw([msg("m1", "user", "explain the retry")], "why does it retry?", chat);
                expect(out.answer).toBe("it retries with backoff");
                expect(out.error).toBeUndefined();
        });

        test("chat throwing returns an actionable error, never throws", async () => {
                const chat = async () => {
                        throw new Error("bridge unreachable");
                };
                const out = await answerBtw([], "q", chat);
                expect(out.answer).toBeUndefined();
                expect(out.error).toContain("side question failed");
                expect(out.error).toContain("bridge unreachable");
                expect(out.error).toContain("unown doctor");
        });

        test("empty question returns usage guidance", async () => {
                const out = await answerBtw([], "   ", async () => "never called");
                expect(out.error).toContain("usage: /btw");
        });

        test("empty completion returns a rephrase suggestion", async () => {
                const out = await answerBtw([msg("m1", "user", "ctx")], "q", async () => "   ");
                expect(out.error).toContain("empty answer");
        });

        test("context caps flow into the chat call (message list shape)", async () => {
                let seen: { role: string; content: string }[] = [];
                const chat = async (messages: { role: string; content: string }[]) => {
                        seen = messages;
                        return "ok";
                };
                const entries = [msg("m1", "user", "x".repeat(4000))];
                await answerBtw(entries, "q", chat as any);
                expect(seen[0].role).toBe("system");
                expect(seen[seen.length - 1].content).toContain("q");
                // The long message was clipped to the default cap.
                const userTurn = seen.find((m) => m.content.startsWith("xxxx"));
                expect(userTurn ? userTurn.content.length : 0).toBeLessThanOrEqual(BTW_MESSAGE_CAP + 20);
                expect(seen.length).toBeLessThanOrEqual(BTW_CONTEXT_MESSAGES + 2);
        });
});
