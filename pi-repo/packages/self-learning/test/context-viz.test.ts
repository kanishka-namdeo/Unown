// Unit tests for src/context-viz.ts — the /context command's pure core
// (the 2026-10-24 parity round: Claude Code /context, aider /tokens,
// Gemini /stats, Codex /usage — the user-facing context-window view).
import { describe, expect, test } from "bun:test";
import {
    bandFor,
    computeContextReport,
    estimateConversationTokens,
    estimateTokens,
    memoryTierOf,
    renderBar,
    renderContextReport,
    type MemoryStackFile,
} from "../src/context-viz.ts";

// ---------------------------------------------------------------------------
// estimateTokens / estimateConversationTokens / memoryTierOf
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
    test("chars/4, min 1, round up", () => {
        expect(estimateTokens("")).toBe(1);
        expect(estimateTokens("abcd")).toBe(1);
        expect(estimateTokens("abcde")).toBe(2);
        expect(estimateTokens("a".repeat(400))).toBe(100);
    });
});

describe("estimateConversationTokens", () => {
    test("walks text blocks, tool calls and thinking; tolerates junk", () => {
        const entries = [
            {
                type: "message",
                message: { role: "user", content: [{ type: "text", text: "a".repeat(400) }] },
            },
            {
                type: "message",
                message: {
                    role: "assistant",
                    content: [
                        { type: "text", text: "b".repeat(200) },
                        { type: "toolCall", name: "bash", arguments: {} },
                        { type: "thinking", thinking: "c".repeat(200) },
                    ],
                },
            },
            { type: "model_change" }, // non-message entries skipped
            null, // malformed — tolerated
            { type: "message", message: { role: "user", content: "raw string content" } },
        ];
        // chars: 400 + 200 + 80 (toolCall skeleton) + 200 + 18 = 898 → 225
        expect(estimateConversationTokens(entries)).toBe(225);
        expect(estimateConversationTokens([])).toBe(0);
    });
});

describe("memoryTierOf", () => {
    test("derives the tier from the filename (both separators)", () => {
        expect(memoryTierOf("/home/u/.unown/memory/policy.md")).toBe("policy");
        expect(memoryTierOf(".unown/memory/project.md")).toBe("project");
        expect(memoryTierOf("C:\\Users\\u\\.unown\\memory\\user.md")).toBe("user");
        expect(memoryTierOf("some/local.md")).toBe("local");
        expect(memoryTierOf("extra/README.md")).toBe("other");
    });
    test("prefers the producer tier label (term.ts tier0-policy → policy)", () => {
        expect(memoryTierOf("memory/tier0-policy.md (enterprise policy)", "tier0-policy")).toBe("policy");
        expect(memoryTierOf("memory/tier2-user.md (user memory)", "tier2-user")).toBe("user");
        expect(memoryTierOf("guide", "guide")).toBe("guide");
    });
});

// ---------------------------------------------------------------------------
// computeContextReport
// ---------------------------------------------------------------------------

const STACK: MemoryStackFile[] = [
    { path: "/h/.unown/memory/policy.md", content: "p".repeat(400) },
    { path: "/proj/.unown/memory/project.md", content: "q".repeat(800) },
];

describe("computeContextReport", () => {
    test("actual accounting drives the numbers", () => {
        const r = computeContextReport({
            model: "agnes-3.0-flash",
            provider: "zai-bridge",
            contextWindow: 524288,
            usedTokens: 131072,
            memoryStack: STACK,
            entries: [],
            sessionUsage: { messages: 4, tokensIn: 1000, tokensOut: 100, cacheRead: 500, cacheWrite: 0, models: ["agnes-3.0-flash"] },
            toolCount: 12,
        });
        expect(r.used).toBe(131072);
        expect(r.usedIsActual).toBeTrue();
        expect(r.usedPercent).toBeCloseTo(25, 5);
        expect(r.remaining).toBe(524288 - 131072);
        expect(r.memoryStackTokens).toBe(100 + 200);
        expect(r.memoryStackFiles.map((f) => f.tier)).toEqual(["policy", "project"]);
        expect(r.conversationTokens).toBe(0);
        // residual = used − memory − conversation, clamped at 0
        expect(r.systemAndToolsTokens).toBe(131072 - 300);
        expect(r.band).toBe("fresh");
    });

    test("estimate fallback when the host has not reported (used = conversation est.)", () => {
        const entries = [
            { type: "message", message: { role: "user", content: [{ type: "text", text: "x".repeat(4000) }] } },
        ];
        const r = computeContextReport({
            model: "agnes-3.0-flash",
            contextWindow: 524288,
            usedTokens: null,
            memoryStack: STACK,
            entries,
        });
        expect(r.usedIsActual).toBeFalse();
        expect(r.used).toBe(1000);
        expect(r.systemAndToolsTokens).toBeNull(); // residual only with actuals
        expect(r.band).toBe("fresh");
    });

    test("bands map to thresholds", () => {
        const mk = (pct: number) =>
            computeContextReport({ contextWindow: 1000, usedTokens: Math.round(10 * pct), entries: [] });
        expect(mk(40).band).toBe("fresh");
        expect(mk(55).band).toBe("healthy");
        expect(mk(72).band).toBe("compact-soon");
        expect(mk(90).band).toBe("compact-now");
        expect(bandFor(null)).toBe("unknown");
    });

    test("no window → unknown band, nulls everywhere honest", () => {
        const r = computeContextReport({ model: "m", usedTokens: null, entries: [] });
        expect(r.contextWindow).toBeNull();
        expect(r.usedPercent).toBeNull();
        expect(r.remaining).toBeNull();
        expect(r.band).toBe("unknown");
    });
});

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

describe("renderBar", () => {
    test("fills proportionally; null renders the no-data lane", () => {
        expect(renderBar(50)).toBe(`${"█".repeat(16)}${"░".repeat(16)}`);
        expect(renderBar(0)).toBe("░".repeat(32));
        expect(renderBar(100)).toBe("█".repeat(32));
        expect(renderBar(150)).toBe("█".repeat(32)); // clamped
        expect(renderBar(null)).toContain("no usage data yet");
    });
});

describe("renderContextReport", () => {
    test("the report carries the model line, bar, breakdown and advice", () => {
        const r = computeContextReport({
            model: "agnes-3.0-flash",
            provider: "zai-bridge",
            contextWindow: 524288,
            usedTokens: 419430, // 80%
            memoryStack: STACK,
            entries: [],
            sessionUsage: { messages: 9, tokensIn: 8000, tokensOut: 900, cacheRead: 7000, cacheWrite: 0, models: ["agnes-3.0-flash"] },
            toolCount: 12,
        });
        const text = renderContextReport(r);
        expect(text).toContain("Context — agnes-3.0-flash (zai-bridge) · window 524,288 tokens");
        expect(text).toContain("% used");
        expect(text).toContain("419,430 used · 104,858 remaining");
        expect(text).toContain("Memory stack  ~300 tokens (policy 100 · project 200)");
        expect(text).toContain("Conversation  ~0 tokens");
        expect(text).toContain("System+tools  ~419,130 tokens (prompt, tool schemas, 12 tools)");
        expect(text).toContain("9 assistant messages · 8,000 in / 900 out");
        expect(text).toContain("cache 7.0k read");
        expect(text).toContain("Compact soon");
    });

    test("estimates are labeled; the tool-pointer line is always present", () => {
        const r = computeContextReport({ usedTokens: null, contextWindow: 1000, entries: [{ type: "message", message: { role: "user", content: [{ type: "text", text: "y".repeat(2000) }] } }] });
        const text = renderContextReport(r);
        expect(text).toContain("(estimated — no host accounting yet)");
        expect(text).toContain("get_context_remaining");
    });
});
