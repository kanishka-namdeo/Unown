/**
 * print-exit-envelope.test.ts — F3 (2026-10-29, the parley round): the print
 * watchdog's forced exits must never swallow an unattended caller's result.
 *
 * The measured failure: a 59-tool-call headless build session ended with the
 * final agent turn, the receipt stopped at the fleet-drain sentinel, and the
 * process exited through the +15s hard-exit grace with a 0-byte envelope —
 * post-answer teardown (drain/dispose) had hung past the grace, and both
 * boundedness nets (stall guard, hard exit) called process.exit() bare.
 *
 * Pins:
 *   1. the hard-exit grace calls the lastResort hook BEFORE process.exit(0)
 *   2. a throwing lastResort never blocks the exit (boundedness outranks the
 *      envelope — fail-open)
 *   3. assembleResultJson accepts and carries subtype "forced_exit" (the
 *      honest label for the last-resort envelope)
 *
 * Note on the exit stub: process.exit is REPLACED with a recorder (never a
 * throw) — the real call sites are inside timer callbacks, where a thrown
 * sentinel escapes the test's await and lands as an unhandled error. The
 * recorder plus a shared order log pins "hook before exit" exactly.
 */
import { describe, expect, test } from "bun:test";
import "./_env.ts";
import { installPrintStallWatchdog } from "../src/cli.ts";
import { assembleResultJson } from "../src/output-format.ts";

/** A runtime stub whose session immediately delivers a terminal agent_end —
 *  arms the hard-exit grace on the first 1s poll tick. */
function runtimeWithTerminalAgentEnd(): { session: { subscribe: (fn: (event: unknown) => void) => () => void } } {
	return {
		session: {
			subscribe: (fn: (event: unknown) => void) => {
				fn({ type: "agent_end", willRetry: false });
				return () => {};
			},
		},
	};
}

/** Record exit calls + a shared order log; restore on finish. */
async function withRecordedExit(body: (order: string[]) => Promise<void>): Promise<void> {
	const original = process.exit;
	const order: string[] = [];
	(process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
		order.push(`exit:${code ?? 0}`);
		return undefined as never;
	}) as never;
	try {
		await body(order);
	} finally {
		(process as unknown as { exit: (code?: number) => never }).exit = original;
	}
}

describe("installPrintStallWatchdog — the F3 last-resort hook", () => {
	test("hard-exit grace: lastResort fires before process.exit(0)", async () => {
		const graceMs = 2_000; // the enforced floor
		process.env.PI_PRINT_EXIT_GRACE_MS = String(graceMs);
		try {
			await withRecordedExit(async (order) => {
				const w = installPrintStallWatchdog(runtimeWithTerminalAgentEnd(), () => {
					order.push("hook");
				});
				try {
					// 1s poll tick (subscribe → armHardExit) + grace + slack
					await new Promise((r) => setTimeout(r, 1_000 + graceMs + 900));
				} finally {
					w.dispose();
				}
				expect(order).toEqual(["hook", "exit:0"]);
			});
		} finally {
			delete process.env.PI_PRINT_EXIT_GRACE_MS;
		}
	}, 12_000);

	test("a throwing lastResort never blocks the exit (fail-open boundedness)", async () => {
		const graceMs = 2_000;
		process.env.PI_PRINT_EXIT_GRACE_MS = String(graceMs);
		try {
			await withRecordedExit(async (order) => {
				const w = installPrintStallWatchdog(runtimeWithTerminalAgentEnd(), () => {
					order.push("hook");
					throw new Error("envelope lane broken");
				});
				try {
					await new Promise((r) => setTimeout(r, 1_000 + graceMs + 900));
				} finally {
					w.dispose();
				}
				// The hook's throw was swallowed; the exit still happened.
				expect(order).toEqual(["hook", "exit:0"]);
			});
		} finally {
			delete process.env.PI_PRINT_EXIT_GRACE_MS;
		}
	}, 12_000);
});

describe("assembleResultJson — the forced_exit subtype (F3)", () => {
	test("carries the honest label with the answer text and usage", () => {
		const envelope = assembleResultJson({
			capture: {
				sessionId: "sess-f3",
				model: "agnes-3.0-flash",
				usage: { input: 79_653, output: 93, cacheRead: 79_360, cacheWrite: 0 },
				numTurns: 20,
				costUsd: 0,
			},
			text: "the answer stands",
			subtype: "forced_exit",
			durationMs: 184_000,
			version: "0.0.37",
		});
		expect(envelope.type).toBe("result");
		expect(envelope.subtype).toBe("forced_exit");
		expect(envelope.result).toBe("the answer stands");
		expect(envelope.session_id).toBe("sess-f3");
		expect(envelope.usage).toEqual({
			input_tokens: 79_653,
			output_tokens: 93,
			cache_read_input_tokens: 79_360,
			cache_creation_input_tokens: 0,
		});
		expect(envelope.num_turns).toBe(20);
	});
	test("an empty forced_exit text stays distinguishable from success", () => {
		const envelope = assembleResultJson({
			capture: {
				sessionId: null,
				model: null,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				numTurns: 0,
				costUsd: 0,
			},
			text: "",
			subtype: "forced_exit",
			durationMs: 15_000,
			version: "0.0.37",
		});
		expect(envelope.subtype).not.toBe("success");
		expect(envelope.result).toBe("");
	});
});
