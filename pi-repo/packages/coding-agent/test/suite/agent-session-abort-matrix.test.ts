/**
 * agent-session-abort-matrix.test.ts — the unified abort surface
 * (`AgentSession.abortActiveOperation` + the extension
 * `ctx.abortActiveOperation()` action, added by the unown sessions round).
 *
 * Pins:
 *   1.  idle → abortActiveOperation() returns false (honest "nothing to
 *       abort" — the /abort command's idle branch depends on it)
 *   2.  streaming → an extension command dispatched mid-run (the /abort
 *       flow: commands execute immediately during streaming) sees
 *       ctx.abortActiveOperation() === true, the turn settles aborted, and
 *       the partial assistant message is persisted with stopReason
 *       "aborted"
 *   3.  ctx.abort() keeps its void fire-and-forget semantics (the action
 *       matrix does not change the old surface)
 *   4.  the raw session method aborts a streaming run the same way
 */

import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

describe("AgentSession abort matrix", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("returns false when the session is idle", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		expect(harness.session.isIdle).toBe(true);
		expect(harness.session.abortActiveOperation()).toBe(false);
	});

	it("extension command mid-run: ctx.abortActiveOperation() is true, the turn settles aborted and is persisted", async () => {
		let reportedByCommand: boolean | undefined;
		let sawCommandRun = false;
		const harness = await createHarness({
			extensionFactories: [
				(pi: ExtensionAPI) => {
					pi.registerCommand("matrixabort", {
						description: "Reports the abort matrix answer, then aborts",
						handler: async (_args, ctx) => {
							sawCommandRun = true;
							// Probe the streaming state first — the /abort
							// command does the same to word its notice.
							reportedByCommand = !ctx.isIdle();
							const aborted = ctx.abortActiveOperation();
							if (reportedByCommand !== aborted) {
								throw new Error("isIdle and abortActiveOperation disagree mid-run");
							}
						},
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("x".repeat(20_000))]);

		const sawMessageUpdate = new Promise<void>((resolve) => {
			const unsubscribe = harness.session.subscribe((event) => {
				if (event.type === "message_update") {
					unsubscribe();
					resolve();
				}
			});
		});

		const promptPromise = harness.session.prompt("hi");
		await sawMessageUpdate;

		// Extension commands execute immediately during streaming — this is
		// exactly how /abort typed into a running turn reaches the matrix.
		await harness.session.prompt("/matrixabort");
		await promptPromise;

		expect(sawCommandRun).toBe(true);
		expect(reportedByCommand).toBe(true);

		const entries = harness.sessionManager.getEntries();
		const lastEntry = entries[entries.length - 1];
		expect(lastEntry?.type).toBe("message");
		if (lastEntry?.type === "message") {
			expect(lastEntry.message.role).toBe("assistant");
			if (lastEntry.message.role === "assistant") {
				expect(lastEntry.message.stopReason).toBe("aborted");
			}
		}
	});

	it("the raw session method aborts a streaming run and reports true", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("y".repeat(20_000))]);

		const sawMessageUpdate = new Promise<void>((resolve) => {
			const unsubscribe = harness.session.subscribe((event) => {
				if (event.type === "message_update") {
					unsubscribe();
					resolve();
				}
			});
		});

		const promptPromise = harness.session.prompt("hi");
		await sawMessageUpdate;

		expect(harness.session.abortActiveOperation()).toBe(true);
		await promptPromise;

		expect(harness.session.isIdle).toBe(true);
		const entries = harness.sessionManager.getEntries();
		const lastEntry = entries[entries.length - 1];
		if (lastEntry?.type === "message" && lastEntry.message.role === "assistant") {
			expect(lastEntry.message.stopReason).toBe("aborted");
		} else {
			throw new Error(`expected an aborted assistant message, got ${JSON.stringify(lastEntry?.type)}`);
		}
	});

	it("a second abortActiveOperation() after settling reports false again", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("z".repeat(20_000))]);

		const sawMessageUpdate = new Promise<void>((resolve) => {
			const unsubscribe = harness.session.subscribe((event) => {
				if (event.type === "message_update") {
					unsubscribe();
					resolve();
				}
			});
		});

		const promptPromise = harness.session.prompt("hi");
		await sawMessageUpdate;
		expect(harness.session.abortActiveOperation()).toBe(true);
		await promptPromise;
		expect(harness.session.abortActiveOperation()).toBe(false);
	});
});
