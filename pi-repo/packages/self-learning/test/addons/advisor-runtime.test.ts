// Integration tests for the advisor runtime (src/addons/advisor.ts):
// the in-process advisor loop over a scripted complete() function — advise
// delivery channels (steer vs aside), the graceful stop after the last
// advise, immune-turn degradation, backpressure coalescing and the context
// trim. Pure in-memory: no provider, no TUI.
import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { AdvisorRuntime } from "../../src/addons/advisor.ts";
import { ADVISOR_SYSTEM_PROMPT } from "../../src/addons/advisor-core.ts";
import type { AdvisorAddonConfig } from "../../src/addons/config.ts";

const fakeModel = {
	id: "test-advisor",
	name: "test-advisor",
	api: "openai-completions",
	provider: "test",
	baseUrl: "http://localhost:1",
	reasoning: false,
	input: [],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 131072,
	maxTokens: 8192,
} as unknown as Model<never>;

const baseConfig: AdvisorAddonConfig = {
	enabled: true,
	thinkingLevel: "off",
	reviewMode: "turn",
	reviewInterval: 1,
	maxNotesPerUpdate: 4,
	immuneTurns: 3,
	continueSeverity: "concern",
	showStatus: false,
};

type ScriptedResponse = {
	content: Array<{ type: string; text?: string; name?: string; id?: string; arguments?: Record<string, unknown> }>;
	usage?: { input?: number; output?: number };
	stopReason?: string;
};

function userMessage(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: Date.now() } as AgentMessage;
}

function assistantToolResult(name: string, body: string): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: `call-${name}`,
		toolName: name,
		content: [{ type: "text", text: body }],
	} as AgentMessage;
}

interface Captured {
	note: string;
	severity?: string;
	channel: "steer" | "aside";
}

function makeRuntime(
	script: ScriptedResponse[],
	config: Partial<AdvisorAddonConfig> = {},
): { runtime: AdvisorRuntime; captured: Captured[]; calls: number } {
	const captured: Captured[] = [];
	let callIndex = 0;
	const complete = async () => {
		const response = script[Math.min(callIndex, script.length - 1)]!;
		callIndex++;
		return response;
	};
	const runtime = new AdvisorRuntime({
		config: { ...baseConfig, ...config },
		cwd: process.cwd(),
		complete: complete as never,
		model: fakeModel,
		systemPrompt: ADVISOR_SYSTEM_PROMPT.replace("{{max_notes_per_update}}", "4"),
	});
	runtime.onAdvise = (noteOrNotes, channel) => {
		const notes = Array.isArray(noteOrNotes) ? noteOrNotes : [noteOrNotes];
		for (const entry of notes) captured.push({ note: entry.note, severity: entry.severity, channel });
	};
	return {
		runtime,
		captured,
		get calls() {
			return callIndex;
		},
	};
}

describe("advisor runtime", () => {
	test("a concern steers immediately and is acknowledged", async () => {
		const { runtime, captured } = makeRuntime([
			{
				content: [
					{
						type: "toolCall",
						name: "advise",
						id: "advise-1",
						arguments: { note: "the parser drops the final row", severity: "concern" },
					},
				],
				stopReason: "toolUse",
			},
			{ content: [{ type: "text", text: "noted" }], stopReason: "stop" },
		]);
		runtime.observe(userMessage("fix the CSV parser"));
		runtime.onTurnEnd(true);
		// The dispatch is fire-and-forget; give the microtask queue a beat.
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(captured.length).toBe(1);
		expect(captured[0]!.channel).toBe("steer");
		expect(captured[0]!.note).toContain("parser");
	});

	test("a nit queues as an aside and flushes at agent end", async () => {
		const { runtime, captured } = makeRuntime([
			{
				content: [{ type: "toolCall", name: "advise", id: "advise-1", arguments: { note: "rename the helper" } }],
				stopReason: "toolUse",
			},
			{ content: [{ type: "text", text: "ok" }], stopReason: "stop" },
		]);
		runtime.observe(userMessage("do work"));
		runtime.onTurnEnd(true);
		await new Promise((resolve) => setTimeout(resolve, 20));
		// Asides wait for the boundary — nothing delivered yet.
		expect(captured.length).toBe(0);
		runtime.onAgentEnd();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(captured.length).toBe(1);
		expect(captured[0]!.channel).toBe("aside");
	});

	test("noise is suppressed with an honest acknowledgment", async () => {
		const { runtime, captured } = makeRuntime([
			{
				content: [{ type: "toolCall", name: "advise", id: "advise-1", arguments: { note: "lgtm" } }],
				stopReason: "toolUse",
			},
			{ content: [{ type: "text", text: "silence" }], stopReason: "stop" },
		]);
		runtime.observe(userMessage("x"));
		runtime.onTurnEnd(true);
		await new Promise((resolve) => setTimeout(resolve, 20));
		runtime.onAgentEnd();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(captured.length).toBe(0);
	});

	test("concerns degrade to asides during immune turns; blockers never", async () => {
		const script = (severity: string | undefined, note: string): ScriptedResponse => ({
			content: [{ type: "toolCall", name: "advise", id: `a-${note.length}`, arguments: { note, severity } }],
			stopReason: "toolUse",
		});
		const responses = [
			script("concern", "first concern is unique"),
			script("concern", "second distinct concern arrives"),
			script("blocker", "a blocker overrides immunity"),
		];
		const { runtime, captured } = makeRuntime([
			...responses,
			{ content: [{ type: "text", text: "done" }], stopReason: "stop" },
		]);
		// Turn 1: the first concern steers and starts the immune window.
		runtime.observe(userMessage("t1"));
		runtime.onTurnEnd(true);
		await new Promise((resolve) => setTimeout(resolve, 20));
		// Turn 2 (within immune turns): a DIFFERENT concern degrades to aside.
		runtime.observe(userMessage("t2"));
		runtime.onTurnEnd(true);
		await new Promise((resolve) => setTimeout(resolve, 20));
		// Turn 3: a blocker punches through immunity.
		runtime.observe(assistantToolResult("bash", "ok"));
		runtime.onTurnEnd(true);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(captured.map((entry) => entry.channel)).toEqual(["steer", "aside", "steer"]);
	});

	test("deltas that arrive while a review runs ship as the next batch", async () => {
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const seenBatches: string[] = [];
		let calls = 0;
		const complete = async (_model: unknown, context: { messages: AgentMessage[] }) => {
			calls++;
			const last = context.messages[context.messages.length - 1];
			seenBatches.push(String((last as { content?: unknown }).content ?? ""));
			if (calls === 1) await gate; // hold the first review open
			return { content: [{ type: "text", text: "silent" }], stopReason: "stop" };
		};
		const runtime = new AdvisorRuntime({
			config: baseConfig,
			cwd: process.cwd(),
			complete: complete as never,
			model: fakeModel,
			systemPrompt: "sys",
		});
		runtime.observe(userMessage("turn one work"));
		runtime.onTurnEnd(true);
		// Second delta arrives while review 1 is gated in its model call.
		await new Promise((resolve) => setTimeout(resolve, 5));
		runtime.observe(userMessage("turn two work"));
		runtime.onTurnEnd(true);
		await new Promise((resolve) => setTimeout(resolve, 5));
		release?.();
		await new Promise((resolve) => setTimeout(resolve, 40));
		// Exactly two reviews ran: the first carried delta 1, the second the
		// late delta alone (upstream: the popped batch stays bounded exactly
		// as dispatched — later arrivals ship as their own subsequent batch).
		expect(calls).toBe(2);
		expect(seenBatches[0]).toContain("turn one work");
		expect(seenBatches[1]).toContain("turn two work");
		expect(seenBatches[1]).not.toContain("turn one work");
		expect(seenBatches[0]).not.toContain("turn two work");
	});

	test("reviewMode agent-end reviews only at the boundary", async () => {
		const { runtime, captured } = makeRuntime([{ content: [{ type: "text", text: "silent" }], stopReason: "stop" }], {
			reviewMode: "agent-end",
		});
		runtime.observe(userMessage("work"));
		runtime.onTurnEnd(true);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect((runtime as unknown as { usageTotals: { reviews: number } }).usageTotals.reviews).toBe(0);
		runtime.onAgentEnd();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect((runtime as unknown as { usageTotals: { reviews: number } }).usageTotals.reviews).toBe(1);
		expect(captured.length).toBe(0);
	});

	test("the advisor's own delivered messages never feed back into its transcript", () => {
		const { runtime } = makeRuntime([{ content: [{ type: "text", text: "x" }], stopReason: "stop" }]);
		runtime.observe({ role: "user", content: "real", timestamp: 1 } as AgentMessage);
		runtime.observe({ role: "custom", customType: "unown-advisor", content: "echo" } as unknown as AgentMessage);
		const transcript = (runtime as unknown as { transcript: AgentMessage[] }).transcript;
		expect(transcript.length).toBe(1);
	});
});
