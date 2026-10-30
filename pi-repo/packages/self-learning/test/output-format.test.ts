import { describe, expect, test } from "bun:test";
import {
	accumulateUsage,
	assembleResultJson,
	captureStdout,
	createOutputCapture,
	createOutputCaptureExtension,
	preferFinalAssistantText,
} from "../src/output-format.ts";

describe("output-format — usage accumulation", () => {
	test("folds multiple assistant usage objects", () => {
		const cap = createOutputCapture();
		accumulateUsage(cap, { input: 100, output: 10, cacheRead: 5, cacheWrite: 1, cost: { total: 0.01 } });
		accumulateUsage(cap, { input: 50, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0.005 } });
		expect(cap.usage).toEqual({ input: 150, output: 15, cacheRead: 5, cacheWrite: 1 });
		expect(cap.costUsd).toBeCloseTo(0.015);
	});

	test("missing/zero cost stays null; malformed usage is ignored", () => {
		const cap = createOutputCapture();
		accumulateUsage(cap, { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 });
		expect(cap.costUsd).toBeNull();
		accumulateUsage(cap, null);
		accumulateUsage(cap, "nope");
		accumulateUsage(cap, undefined);
		expect(cap.usage.input).toBe(1);
	});

	test("non-numeric fields contribute zero, never NaN", () => {
		const cap = createOutputCapture();
		accumulateUsage(cap, { input: "x", output: {}, cacheRead: undefined, cacheWrite: null, cost: { total: "free" } });
		expect(cap.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
		expect(cap.costUsd).toBeNull();
	});
});

describe("output-format — result assembly", () => {
	test("stable shape: the CI contract", () => {
		const cap = createOutputCapture();
		cap.sessionId = "sess-123";
		cap.model = "kimi-k2.5";
		cap.numTurns = 2;
		cap.usage = { input: 10, output: 20, cacheRead: 1, cacheWrite: 2 };
		cap.costUsd = 0.5;
		const obj = assembleResultJson({
			capture: cap,
			text: "all done",
			subtype: "success",
			durationMs: 1234,
			version: "9.9.9",
		});
		expect(obj).toEqual({
			type: "result",
			subtype: "success",
			result: "all done",
			session_id: "sess-123",
			model: "kimi-k2.5",
			usage: {
				input_tokens: 10,
				output_tokens: 20,
				cache_read_input_tokens: 1,
				cache_creation_input_tokens: 2,
			},
			cost_usd: 0.5,
			duration_ms: 1234,
			num_turns: 2,
			unown_version: "9.9.9",
		});
		// JSON round-trip: the object is one-line serializable, keys stable
		expect(Object.keys(JSON.parse(JSON.stringify(obj)))).toEqual([
			"type",
			"subtype",
			"result",
			"session_id",
			"model",
			"usage",
			"cost_usd",
			"duration_ms",
			"num_turns",
			"unown_version",
		]);
	});

	test("null session/model/cost are honest nulls, not zeros or strings", () => {
		const obj = assembleResultJson({
			capture: createOutputCapture(),
			text: "",
			subtype: "error_during_execution",
			durationMs: 0,
			version: "1.0.0",
		});
		expect(obj.session_id).toBeNull();
		expect(obj.model).toBeNull();
		expect(obj.cost_usd).toBeNull();
		expect(obj.subtype).toBe("error_during_execution");
	});
});

describe("output-format — capture extension (fake pi)", () => {
	function fakePi() {
		const handlers: Record<string, Array<(event: unknown, ctx: unknown) => void>> = {};
		return {
			on(event: string, handler: any) {
				(handlers[event] ??= []).push(handler);
			},
			emit(event: string, ev: unknown, ctx?: unknown) {
				for (const h of handlers[event] ?? []) h(ev, ctx);
			},
		};
	}

	test("session_start captures the session id (getSessionId accessor); model_select captures the model", () => {
		const pi = fakePi();
		const cap = createOutputCapture();
		createOutputCaptureExtension(cap).factory(pi as any);
		pi.emit("session_start", {}, { sessionManager: { getSessionId: () => "abc" } });
		pi.emit("model_select", { model: { id: "qwen3.7-plus" } });
		expect(cap.sessionId).toBe("abc");
		expect(cap.model).toBe("qwen3.7-plus");
	});

	test("session_start falls back to currentSessionId when getSessionId is absent", () => {
		const pi = fakePi();
		const cap = createOutputCapture();
		createOutputCaptureExtension(cap).factory(pi as any);
		pi.emit("session_start", {}, { sessionManager: { currentSessionId: "legacy" } });
		expect(cap.sessionId).toBe("legacy");
	});

	test("assistant message_end events accumulate usage + turns; other roles do not", () => {
		const pi = fakePi();
		const cap = createOutputCapture();
		createOutputCaptureExtension(cap).factory(pi as any);
		pi.emit("message_end", { message: { role: "assistant", usage: { input: 5, output: 6 } } });
		pi.emit("message_end", { message: { role: "user" } });
		pi.emit("message_end", { message: { role: "assistant", model: "kimi-k2.5", usage: { input: 1, output: 2 } } });
		expect(cap.numTurns).toBe(2);
		expect(cap.usage.input).toBe(6);
		expect(cap.usage.output).toBe(8);
		expect(cap.model).toBe("kimi-k2.5");
	});

	test("a throwing ctx in session_start degrades to null, never crashes", () => {
		const pi = fakePi();
		const cap = createOutputCapture();
		createOutputCaptureExtension(cap).factory(pi as any);
		const evil = {
			get sessionManager() {
				throw new Error("no");
			},
		};
		expect(() => pi.emit("session_start", {}, evil)).not.toThrow();
		expect(cap.sessionId).toBeNull();
	});
});

describe("output-format — stdout capture wrapper", () => {
	test("captures writes, restores the original on unwrap, preserves callbacks", () => {
		const before = (process.stdout as any).write;
		const wrap = captureStdout();
		let drained = false;
		process.stdout.write("hello ", () => {
			drained = true;
		});
		process.stdout.write("world");
		const text = wrap.unwrap();
		expect(text).toBe("hello world");
		expect(drained).toBe(true);
		expect((process.stdout as any).write).toBe(before);
	});
});

// F35 (the delegation round, live 2026-10-30): an async fleet child
// delivered after the main print loop settled runs its answering turn in the
// session, but pi's text channel never prints the synthesis — the captured
// stdout held the interim answer while the session's last message carried
// the real one. The envelope's contract is the FINAL assistant text.
describe("preferFinalAssistantText — the F35 lane", () => {
	test("a later completed assistant text REPLACES the stale captured interim", () => {
		const captured = "Spawned ts-count — I'll report the final number the moment its result lands.";
		const final = "Final count: 82,746 lines of TypeScript.";
		expect(preferFinalAssistantText(captured, final, 0)).toBe(final);
	});
	test("equal or empty watcher text changes nothing (the normal single-answer run)", () => {
		const captured = "the answer";
		expect(preferFinalAssistantText(captured, "the answer", 0)).toBe("the answer");
		expect(preferFinalAssistantText(captured, "", 0)).toBe("the answer");
		expect(preferFinalAssistantText(captured, undefined, 0)).toBe("the answer");
	});
	test("error paths keep the captured text (pi's error/abort handling prints there)", () => {
		const captured = "Error: upstream 502";
		const stale = "an earlier assistant message";
		expect(preferFinalAssistantText(captured, stale, 1)).toBe("Error: upstream 502");
	});
	test("whitespace-only watcher text is ignored", () => {
		expect(preferFinalAssistantText("captured", "   \n  ", 0)).toBe("captured");
	});
});
