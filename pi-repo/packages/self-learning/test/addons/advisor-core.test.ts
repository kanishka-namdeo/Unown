// Unit tests for the advisor addon's pure core (src/addons/advisor-core.ts):
// the emission guard (noise filter → rank-aware dedupe → per-update budget),
// the delivery policy (aside vs steer with immune turns), the transcript
// delta renderer (compact observer context), token estimation/trimming and
// the WATCHDOG.md guidance reader. The live runtime is exercised through
// the /advisor command path and the TUI-capture scenarios.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	decideDelivery,
	dedupeKey,
	EmissionGuard,
	estimateTokens,
	formatAdvisorBatchContent,
	isNoise,
	readWatchdogGuidance,
	renderDelta,
	trimToBudget,
} from "../../src/addons/advisor-core.ts";

// ---------------------------------------------------------------------------
// Emission guard
// ---------------------------------------------------------------------------

describe("emission guard", () => {
	test("noise phrases are suppressed", () => {
		for (const phrase of ["stop", "Done.", "no issues, continue", "lgtm", "nothing to add", "on track", "OK", "  "]) {
			expect(isNoise(phrase)).toBe(true);
		}
		expect(isNoise("The parser drops the last row when the CSV ends with a newline")).toBe(false);
	});

	test("dedupe key normalization", () => {
		expect(dedupeKey("Drop the LAST row!")).toBe(dedupeKey("drop the last row"));
		expect(dedupeKey("cache, then retry")).toBe("cache then retry");
	});

	test("admits within budget; duplicates suppressed at equal or lower rank", () => {
		const guard = new EmissionGuard({ budgetPerUpdate: 2 });
		guard.beginUpdate();
		expect(guard.evaluate("Check the boundary condition", "nit").verdict).toBe("admit");
		expect(guard.evaluate("Check the boundary condition", "nit").verdict).toBe("suppressed");
		expect(guard.evaluate("Different concern entirely", "nit").verdict).toBe("admit");
		expect(guard.evaluate("Third note", "nit").verdict).toBe("suppressed");
	});

	test("blockers bypass the budget", () => {
		const guard = new EmissionGuard({ budgetPerUpdate: 1 });
		guard.beginUpdate();
		expect(guard.evaluate("first nit", "nit").verdict).toBe("admit");
		expect(guard.evaluate("second nit", "nit").verdict).toBe("suppressed");
		expect(guard.evaluate("BLOCKER: contradicts the instruction", "blocker").verdict).toBe("admit");
	});

	test("a strictly higher rank displaces the lowest pending slot", () => {
		const guard = new EmissionGuard({ budgetPerUpdate: 1 });
		guard.beginUpdate();
		expect(guard.evaluate("minor wording", "nit").verdict).toBe("admit");
		const verdict = guard.evaluate("the approach is materially wrong", "concern");
		expect(verdict.verdict).toBe("displaced");
		if (verdict.verdict === "displaced") expect(verdict.displacedKey).toBe(dedupeKey("minor wording"));
	});

	test("equal-rank re-raise after budget reset stays deduped by history", () => {
		const guard = new EmissionGuard({ budgetPerUpdate: 4 });
		guard.beginUpdate();
		expect(guard.evaluate("same note", "nit").verdict).toBe("admit");
		guard.beginUpdate();
		expect(guard.evaluate("same note", "nit").verdict).toBe("suppressed");
		expect(guard.evaluate("same note", "concern").verdict).toBe("admit");
	});

	test("reset clears history", () => {
		const guard = new EmissionGuard({ budgetPerUpdate: 4 });
		guard.beginUpdate();
		guard.evaluate("note", "nit");
		guard.reset();
		guard.beginUpdate();
		expect(guard.evaluate("note", "nit").verdict).toBe("admit");
	});
});

// ---------------------------------------------------------------------------
// Delivery policy
// ---------------------------------------------------------------------------

describe("delivery policy", () => {
	test("nits always queue as asides", () => {
		expect(decideDelivery(undefined, 0).channel).toBe("aside");
		expect(decideDelivery("nit", 5).channel).toBe("aside");
	});
	test("concerns steer unless immune turns remain; blockers always steer", () => {
		expect(decideDelivery("concern", 0).channel).toBe("steer");
		expect(decideDelivery("concern", 2).channel).toBe("aside");
		expect(decideDelivery("blocker", 9).channel).toBe("steer");
	});
});

// ---------------------------------------------------------------------------
// Delta renderer
// ---------------------------------------------------------------------------

function userMessage(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: Date.now() } as AgentMessage;
}

function toolResult(name: string, body: string, isError = false): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: `call-${name}`,
		toolName: name,
		content: [{ type: "text", text: body }],
		isError,
	} as AgentMessage;
}

describe("renderDelta", () => {
	test("full user text, tool-result cards, WIP marker last", () => {
		const delta: AgentMessage[] = [
			userMessage("fix the parser"),
			toolResult("read", "line1\nline2"),
			toolResult("bash", "Error: ENOENT", true),
		];
		const text = renderDelta(delta, { inProgress: true });
		expect(text).toContain("### Session update");
		expect(text).toContain("**user**:\nfix the parser");
		expect(text).toContain("→ read ⇒ 2 lines");
		expect(text).toContain("Tool result:\nline1\nline2");
		expect(text).toContain("→ bash ⇒ error · 1 lines — Error: ENOENT");
		// The WIP marker rides at the END (cacheable prefix never flips).
		expect(text.trimEnd().endsWith("[in progress — more steps follow]")).toBe(true);
	});

	test("final batches carry no WIP marker", () => {
		const text = renderDelta([userMessage("hi")], { inProgress: false });
		expect(text).not.toContain("[in progress");
	});

	test("large tool bodies are omitted from the card expansion", () => {
		const big = "x".repeat(9000);
		const text = renderDelta([toolResult("read", big)], { inProgress: false });
		expect(text).toContain("→ read ⇒ 1 lines");
		expect(text).not.toContain(big);
	});

	test("assistant text renders under the agent label", () => {
		const assistant = {
			role: "assistant",
			content: [{ type: "text", text: "I will read the file." }],
		} as AgentMessage;
		const text = renderDelta([assistant], { inProgress: false });
		expect(text).toContain("**agent**:\nI will read the file.");
	});
});

// ---------------------------------------------------------------------------
// Token budget
// ---------------------------------------------------------------------------

describe("token estimation + trimming", () => {
	test("estimateTokens is ~4 chars per token", () => {
		expect(estimateTokens("12345678")).toBe(2);
		expect(estimateTokens("")).toBe(0);
	});
	test("trimToBudget keeps newest messages and reports the trim count", () => {
		const messages: AgentMessage[] = Array.from({ length: 10 }, (_, index) =>
			userMessage(`message number ${index} with some padding text to give it weight`),
		);
		const total = messages.reduce(
			(sum, message) => sum + estimateTokens(JSON.stringify((message as { content?: unknown }).content)) + 8,
			0,
		);
		const result = trimToBudget(messages, Math.floor(total / 2));
		expect(result.trimmed).toBeGreaterThan(0);
		expect(result.messages.length).toBeLessThan(messages.length);
		// The newest message survives.
		expect(result.messages[result.messages.length - 1]).toBe(messages[messages.length - 1]);
	});
	test("under-budget inputs pass through untouched", () => {
		const messages = [userMessage("tiny")];
		expect(trimToBudget(messages, 10000)).toEqual({ messages, trimmed: 0 });
	});
});

// ---------------------------------------------------------------------------
// Batch content
// ---------------------------------------------------------------------------

describe("formatAdvisorBatchContent", () => {
	test("advisory XML with severity and escaping", () => {
		const text = formatAdvisorBatchContent([
			{ note: "use `x < y` here", severity: "concern", turnIndex: 2 },
			{ note: "plain note", turnIndex: 0 },
		]);
		expect(text).toContain('<advisory severity="concern" turns_ago="2" guidance="weigh, don\'t blindly obey">');
		expect(text).toContain("use `x &lt; y` here");
		expect(text).toContain("plain note");
	});
});

// ---------------------------------------------------------------------------
// WATCHDOG.md guidance
// ---------------------------------------------------------------------------

describe("readWatchdogGuidance", () => {
	const root = mkdtempSync(join(tmpdir(), "unown-advisor-test-"));
	test("reads WATCHDOG.md from the project root", () => {
		writeFileSync(join(root, "WATCHDOG.md"), "# priorities\n- watch memory writes\n", "utf8");
		const guidance = readWatchdogGuidance(root);
		expect(guidance).toContain("watch memory writes");
		expect(guidance).toContain("<advisor-only guidance>");
	});
	test("falls back to .unown/WATCHDOG.md; missing files yield undefined", () => {
		const nested = join(root, "proj");
		mkdirSync(join(nested, ".unown"), { recursive: true });
		writeFileSync(join(nested, ".unown", "WATCHDOG.md"), "trap notes", "utf8");
		expect(readWatchdogGuidance(nested)).toContain("trap notes");
		expect(readWatchdogGuidance(join(root, "empty"))).toBeUndefined();
	});
	test("blank files yield undefined", () => {
		const blank = join(root, "blank");
		mkdirSync(blank, { recursive: true });
		writeFileSync(join(blank, "WATCHDOG.md"), "   \n", "utf8");
		expect(readWatchdogGuidance(blank)).toBeUndefined();
	});
});
