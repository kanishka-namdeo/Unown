// Unit tests for src/messages.ts — the ONE implementation of pi's assistant
// message shape (audit MEDIUM-2's root cause: two call sites, two divergent
// handlings — termhooks checked only the string shape that pi never emits).
//
// pi-repo/packages/ai/src/types.ts: AssistantMessage.content is
// (TextContent | ThinkingContent | ToolCall)[] — but the goal gate also
// tolerated a legacy string shape, so the helper keeps both.
import "./_env.ts";
import { describe, expect, test } from "bun:test";
import { assistantTextOf } from "../src/messages.ts";

describe("assistantTextOf", () => {
	test("string content (legacy/defensive shape) is trimmed and returned", () => {
		expect(assistantTextOf({ role: "assistant", content: "  done.  " })).toBe("done.");
	});

	test("array content: text blocks are joined; thinking and tool_call blocks are skipped", () => {
		expect(
			assistantTextOf({
				role: "assistant",
				content: [
					{ type: "thinking", text: "reasoning" },
					{ type: "text", text: "first" },
					{ type: "tool_call", id: "t", name: "bash" },
					{ type: "text", text: "second" },
				],
			}),
		).toBe("first\nsecond");
	});

	test("thinking/tool-call-only content yields empty string (no visible text)", () => {
		expect(
			assistantTextOf({
				role: "assistant",
				content: [
					{ type: "thinking", text: "reasoning" },
					{ type: "tool_call", id: "t", name: "write" },
				],
			}),
		).toBe("");
	});

	test("non-assistant roles yield empty string", () => {
		expect(assistantTextOf({ role: "user", content: "hello" })).toBe("");
		expect(assistantTextOf({ role: "tool", content: [{ type: "text", text: "x" }] })).toBe("");
	});

	test("null/undefined/malformed messages yield empty string, never throw", () => {
		expect(assistantTextOf(null)).toBe("");
		expect(assistantTextOf(undefined)).toBe("");
		expect(assistantTextOf({})).toBe("");
		expect(assistantTextOf({ role: "assistant" })).toBe("");
		expect(assistantTextOf({ role: "assistant", content: 42 })).toBe("");
		expect(assistantTextOf({ role: "assistant", content: [null, { type: "text" }] })).toBe("");
	});

	test("array content with non-string text blocks is tolerated", () => {
		expect(assistantTextOf({ role: "assistant", content: [{ type: "text", text: 7 }, { type: "text", text: "ok" }] })).toBe("ok");
	});
});
