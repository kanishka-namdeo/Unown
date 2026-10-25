/**
 * recap.test.ts — the session recap (Claude Code parity, the 2026-10
 * convergence round): the idle threshold, the deterministic digest over
 * session entries, the welcome-home line, and the /recap question.
 */
import { describe, expect, test } from "bun:test";
import {
	buildRecapDigest,
	buildRecapQuestion,
	renderRecapDigestLine,
	shouldRecap,
} from "../src/recap.ts";

function messageEntry(role: "user" | "assistant", content: unknown, ts = Date.now()): unknown {
	return { type: "message", ts, message: { role, content } };
}

describe("shouldRecap — the idle threshold", () => {
	test("fires at/after the default 3 minutes", () => {
		expect(shouldRecap(3 * 60_000).action).toBe("show");
		expect(shouldRecap(2.9 * 60_000).action).toBe("skip");
	});
	test("UNOWN_RECAP_IDLE_MINUTES=0 is the kill switch", () => {
		const prev = process.env.UNOWN_RECAP_IDLE_MINUTES;
		process.env.UNOWN_RECAP_IDLE_MINUTES = "0";
		try {
			expect(shouldRecap(60 * 60_000).action).toBe("skip");
		} finally {
			process.env.UNOWN_RECAP_IDLE_MINUTES = prev;
		}
	});
	test("the env var tunes the threshold", () => {
		const prev = process.env.UNOWN_RECAP_IDLE_MINUTES;
		process.env.UNOWN_RECAP_IDLE_MINUTES = "10";
		try {
			expect(shouldRecap(5 * 60_000).action).toBe("skip");
			expect(shouldRecap(11 * 60_000).action).toBe("show");
		} finally {
			process.env.UNOWN_RECAP_IDLE_MINUTES = prev;
		}
	});
	test("idle minutes reported 1dp", () => {
		expect(shouldRecap(90_000).idleMinutes).toBe(1.5);
	});
});

describe("buildRecapDigest — session entries", () => {
	test("counts turns, tool calls, files; carries previews", () => {
		const now = Date.now();
		const entries = [
			messageEntry("user", "add a login page", now - 120_000),
			messageEntry(
				"assistant",
				[
					{ type: "text", text: "on it" },
					{ type: "toolCall", toolName: "edit", arguments: { file: "src/login.tsx" } },
				],
				now - 110_000,
			),
			messageEntry(
				"assistant",
				[
					{ type: "text", text: "done — the form validates" },
					{ type: "toolCall", toolName: "edit", arguments: { file: "src/login.css" } },
					{ type: "toolCall", toolName: "grep", arguments: { pattern: "handleLogin" } },
				],
				now - 100_000,
			),
		];
		const digest = buildRecapDigest(entries, now - 130_000, 120_000);
		expect(digest.turns).toBe(1);
		expect(digest.userMessages).toBe(1);
		expect(digest.assistantMessages).toBe(2);
		expect(digest.toolCalls).toBe(3);
		expect(digest.filesTouched).toEqual(["src/login.tsx", "src/login.css"]);
		expect(digest.toolsUsed).toEqual(["edit×2", "grep"]);
		expect(digest.lastAssistantPreview).toContain("done — the form validates");
	});

	test("respects the sinceTs cutoff (idle-window facts only)", () => {
		const now = Date.now();
		const entries = [
			messageEntry("user", "old turn", now - 400_000),
			messageEntry("user", "fresh turn", now - 60_000),
		];
		const digest = buildRecapDigest(entries, now - 100_000, 100_000);
		expect(digest.userMessages).toBe(1);
		expect(digest.lastUserPreview).toBe("fresh turn");
	});

	test("malformed entries are skipped, never thrown", () => {
		const digest = buildRecapDigest([null, { type: "nope" }, "garbage", 7], 0, 1_000);
		expect(digest.turns).toBe(0);
		expect(digest.toolCalls).toBe(0);
	});
});

describe("renderRecapDigestLine — the welcome-home line", () => {
	test("shape of the work + last answer + the pointer", () => {
		const line = renderRecapDigestLine({
			turns: 3,
			userMessages: 3,
			assistantMessages: 3,
			toolCalls: 14,
			toolsUsed: ["edit×4", "bash×3"],
			filesTouched: ["a.ts", "b.ts", "c.ts"],
			idleMinutes: 12.3,
			lastUserPreview: "",
			lastAssistantPreview: "all tests green",
		});
		expect(line).toContain("while you were away (~12.3m idle):");
		expect(line).toContain("3 turns");
		expect(line).toContain("14 tool calls");
		expect(line).toContain("3 files touched");
		expect(line).toContain('last answer ("all tests green")');
		expect(line).toContain("(/recap for the fuller summary)");
	});
	test("no work → the honest no-new-turns shape", () => {
		const line = renderRecapDigestLine({
			turns: 0,
			userMessages: 0,
			assistantMessages: 0,
			toolCalls: 0,
			toolsUsed: [],
			filesTouched: [],
			idleMinutes: 5,
			lastUserPreview: "",
			lastAssistantPreview: "",
		});
		expect(line).toContain("no new turns");
	});
});

describe("buildRecapQuestion — the /recap LLM lane", () => {
	test("asks for one sentence over the last N turns (capped at 12)", () => {
		expect(buildRecapQuestion(6)).toContain("last 6 turns");
		expect(buildRecapQuestion(50)).toContain("last 12 turns");
		expect(buildRecapQuestion(0)).toContain("last 6 turns");
	});
});
