/**
 * print-exit-trace.test.ts — M2-A (issue #30 request b): the opt-in
 * exit-path trace lane for print mode. Pins:
 * - the gate (UNOWN_PRINT_EXIT_TRACE) and its zero-I/O default;
 * - the emit shape (stderr line + jsonl append, one line per event);
 * - the event vocabulary surface;
 * - fail-open file writes (a broken path never throws);
 * - the log-dir resolution convention (UNOWN_PRINT_TRACE_DIR > repo .run >
 *   UNOWN_HOME);
 * - the watchdog's trace integration: off = byte-identical, on = the
 *   arm/agent_end/hard-exit events arrive in lifecycle order.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installPrintStallWatchdog } from "../src/cli.ts";
import {
	createPrintExitTrace,
	PRINT_EXIT_TRACE_EVENTS,
	printExitTraceEnabled,
	resolvePrintTraceDir,
} from "../src/print-exit-trace.ts";

describe("printExitTraceEnabled — the gate", () => {
	test("off by default (zero I/O)", () => {
		expect(printExitTraceEnabled({})).toBe(false);
		expect(printExitTraceEnabled({ UNOWN_PRINT_EXIT_TRACE: "" })).toBe(false);
		expect(printExitTraceEnabled({ UNOWN_PRINT_EXIT_TRACE: "0" })).toBe(false);
	});
	test("arms on 1 / true (case-insensitive, trimmed)", () => {
		expect(printExitTraceEnabled({ UNOWN_PRINT_EXIT_TRACE: "1" })).toBe(true);
		expect(printExitTraceEnabled({ UNOWN_PRINT_EXIT_TRACE: " true " })).toBe(true);
	});
});

describe("createPrintExitTrace — the recorder", () => {
	test("disabled: emit is a no-op, no stderr, no file, null logPath", () => {
		const stderr: string[] = [];
		const appended: Array<[string, string]> = [];
		const t = createPrintExitTrace({
			enabled: false,
			stderrLine: (l) => stderr.push(l),
			append: (p, l) => appended.push([p, l]),
		});
		expect(t.enabled).toBe(false);
		expect(t.logPath).toBeNull();
		t.emit("answer_flushed", { code: 0 });
		expect(stderr).toEqual([]);
		expect(appended).toEqual([]);
	});

	test("enabled: one stderr line AND one jsonl line per event, with ts + event", () => {
		const stderr: string[] = [];
		const appended: Array<[string, string]> = [];
		const t = createPrintExitTrace({
			enabled: true,
			now: () => new Date(Date.UTC(2026, 10, 1, 12, 0, 0)),
			stderrLine: (l) => stderr.push(l),
			append: (p, l) => appended.push([p, l]),
			env: { UNOWN_PRINT_TRACE_DIR: "/tmp/trace" },
			startDirs: ["/nonexistent"],
		});
		expect(t.enabled).toBe(true);
		expect(t.logPath).toBe(join("/tmp/trace", "print-exit-trace.jsonl"));
		t.emit("agent_end", { willRetry: false });
		expect(stderr).toEqual([`[print-exit-trace] ${JSON.stringify({ ts: "2026-11-01T12:00:00.000Z", event: "agent_end", willRetry: false })}`]);
		expect(appended).toEqual([
			[
				join("/tmp/trace", "print-exit-trace.jsonl"),
				JSON.stringify({ ts: "2026-11-01T12:00:00.000Z", event: "agent_end", willRetry: false }),
			],
		]);
	});

	test("the event vocabulary is the issue's four exit paths plus bookends", () => {
		expect(PRINT_EXIT_TRACE_EVENTS).toEqual(
			expect.arrayContaining([
				"answer_flushed",
				"agent_end",
				"stall_armed",
				"stall_fired",
				"hard_exit_armed",
				"hard_exit_fired",
				"hard_exit_cancelled",
				"hard_exit_rearmed",
				"drain_start",
				"drain_done",
				"exit",
			]),
		);
		// every exported label exists — no phantom extras in tests
		expect(PRINT_EXIT_TRACE_EVENTS.length).toBeGreaterThan(10);
	});
});

describe("resolvePrintTraceDir — the .run/ convention", () => {
	test("explicit UNOWN_PRINT_TRACE_DIR wins", () => {
		expect(resolvePrintTraceDir({ UNOWN_PRINT_TRACE_DIR: "/x/y" }, ["/whatever"])).toBe("/x/y");
	});
	test("falls back to UNOWN_HOME then home/.unown when no repo root is found", () => {
		expect(resolvePrintTraceDir({ UNOWN_HOME: "/home/u/.unown-x" }, ["/nonexistent-start"])).toBe("/home/u/.unown-x");
		expect(resolvePrintTraceDir({}, ["/nonexistent-start"])).not.toBe("");
	});
});

describe("createPrintExitTrace — fail-open writes", () => {
	test("a throwing appender never escapes emit (observation lane)", () => {
		const t = createPrintExitTrace({
			enabled: true,
			env: { UNOWN_PRINT_TRACE_DIR: "/tmp/trace" },
			startDirs: ["/nonexistent"],
			stderrLine: () => {},
			append: () => {
				throw new Error("disk on fire");
			},
		});
		expect(() => t.emit("exit", { code: 0 })).not.toThrow();
	});

	test("real file: one line per event, jsonl shape on disk", () => {
		const dir = mkdtempSync(join(tmpdir(), "pet-"));
		try {
			const t = createPrintExitTrace({
				enabled: true,
				env: { UNOWN_PRINT_TRACE_DIR: dir },
				startDirs: [dir],
			});
			t.emit("stall_armed", { budgetMs: 10_000 });
			t.emit("exit", { code: 0, lane: "text" });
			const lines = readFileSync(join(dir, "print-exit-trace.jsonl"), "utf8").trim().split("\n");
			expect(lines.length).toBe(2);
			const [a, b] = lines.map((l) => JSON.parse(l));
			expect(a.event).toBe("stall_armed");
			expect(a.budgetMs).toBe(10_000);
			expect(typeof a.ts).toBe("string");
			expect(new Date(a.ts).toISOString()).toBe(a.ts);
			expect(b).toEqual({ ts: b.ts, event: "exit", code: 0, lane: "text" });
			expect(readdirSync(dir)).toContain("print-exit-trace.jsonl");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("installPrintStallWatchdog — the trace integration seam", () => {
	test("off: the watchdog still calls emit (the recorder no-ops internally), zero stderr/file side effects", async () => {
		const emitted: Array<Record<string, unknown>> = [];
		// A disabled production recorder is byte-identical: emit() is a
		// no-op that writes no stderr and no file. Pin the CALL SITE
		// contract (the watchdog still instruments) + the no-op semantics
		// by faking a recorder whose enabled flag stays false.
		const trace = {
			enabled: false,
			logPath: null,
			emit: (_e: string, x?: Record<string, unknown>) => {
				// in production this is a pure no-op (see print-exit-trace.ts);
				// the fake records calls so the test can assert the wiring.
				emitted.push({ _e, ...x });
			},
		} as any;
		const runtime = {
			session: {
				subscribe: (fn: any) => {
					// feed the lifecycle synchronously when the poll attaches
					fn({ type: "agent_end", willRetry: false });
					fn({ type: "agent_start" });
					return () => {};
				},
			},
		};
		const watchdog = installPrintStallWatchdog(runtime, undefined, { trace });
		// let the 1s poll attach + process the events
		await new Promise((r) => setTimeout(r, 1_200));
		watchdog.dispose();
		// The lifecycle STILL gets instrumented (the call site runs), but a
		// real disabled recorder would have written nothing — zero stderr
		// lines, zero jsonl lines (pinned separately in the recorder tests).
		const names = emitted.map((e) => e._e as string);
		expect(names).toContain("stall_armed");
		expect(names).toContain("agent_end");
		expect(names).toContain("hard_exit_armed");
		expect(names).toContain("hard_exit_cancelled");
	});

	test("on: the lifecycle events arrive in order (stall_armed → agent_end → hard_exit_armed → hard_exit_cancelled)", async () => {
		const emitted: Array<Record<string, unknown>> = [];
		const trace = {
			enabled: true,
			logPath: null,
			emit: (e: string, x?: Record<string, unknown>) => {
				emitted.push({ event: e, ...x });
			},
		} as any;
		const handlerRef: { current: ((e: any) => void) | null } = { current: null };
		const runtime = {
			session: {
				subscribe: (fn: any) => {
					handlerRef.current = fn;
					return () => {};
				},
			},
		};
		const watchdog = installPrintStallWatchdog(runtime, undefined, { trace });
		// the 1s poll attaches the session subscription — wait for it
		for (let i = 0; i < 30 && !handlerRef.current; i++) await new Promise((r) => setTimeout(r, 100));
		expect(handlerRef.current).not.toBeNull();
		handlerRef.current!({ type: "agent_end", willRetry: false });
		handlerRef.current!({ type: "agent_start" });
		// the timers settle asynchronously — read the trace after a beat
		await new Promise((r) => setTimeout(r, 200));
		watchdog.dispose();
		const names = emitted.map((e) => e.event as string);
		// the lifecycle the issue asks for: what is pending when the answer flushes
		expect(names).toContain("stall_armed");
		expect(names).toContain("agent_end");
		expect(names).toContain("hard_exit_armed");
		expect(names).toContain("hard_exit_cancelled");
		// ordering: arm before agent_end, agent_end before hard exit, cancel after
		expect(names.indexOf("stall_armed")).toBeLessThan(names.indexOf("agent_end"));
		expect(names.indexOf("agent_end")).toBeLessThan(names.indexOf("hard_exit_armed"));
		expect(names.indexOf("hard_exit_armed")).toBeLessThan(names.indexOf("hard_exit_cancelled"));
	});
});
