/**
 * Session-shutdown deadline (2026-10-22 M2): a session_shutdown handler that
 * never resolves must not hang the quit chain (upstream pi #9997; the Unown
 * benchtest caught a finished print session surviving 6+ minutes behind a
 * wedged teardown). emitSessionShutdownEvent is fail-open: on deadline it
 * reports through the error channel and the quit proceeds.
 */
import { afterEach, describe, expect, it } from "vitest";
import { emitSessionShutdownEvent } from "../src/core/extensions/runner.ts";

/** Minimal ExtensionRunner stand-in: just the surface the emitter touches. */
function fakeRunner(handlers: Array<(event: any, ctx: any) => any>) {
	return {
		hasHandlers: (type: string) => type === "session_shutdown" && handlers.length > 0,
		emit: async (event: any) => {
			for (const handler of handlers) await handler(event, {});
			return undefined;
		},
		emitError: (error: any) => {
			errors.push(error);
		},
	} as any;
}

const errors: any[] = [];

afterEach(() => {
	errors.length = 0;
});

describe("emitSessionShutdownEvent deadline", () => {
	it("returns true when handlers exist and settle", async () => {
		const seen: string[] = [];
		const ok = await emitSessionShutdownEvent(fakeRunner([() => {}]) as any, {
			type: "session_shutdown",
			reason: "quit",
		});
		expect(ok).toBe(true);
		expect(seen).toEqual([]);
	});

	it("returns false when there are no handlers", async () => {
		const ok = await emitSessionShutdownEvent(fakeRunner([]) as any, { type: "session_shutdown", reason: "quit" });
		expect(ok).toBe(false);
	});

	it("a never-resolving handler is abandoned at the deadline and the quit proceeds (fail-open)", async () => {
		process.env.PI_SHUTDOWN_DEADLINE_MS = "1500";
		try {
			const t0 = Date.now();
			const ok = await emitSessionShutdownEvent(
				fakeRunner([() => new Promise<void>(() => {})]) as any,
				{ type: "session_shutdown", reason: "quit" },
			);
			const elapsed = Date.now() - t0;
			expect(ok).toBe(true); // emitted — the chain ran, it just never settled
			expect(elapsed).toBeGreaterThanOrEqual(1400); // the deadline fired (timing tolerance)
			expect(elapsed).toBeLessThan(10_000); // ...but it did not hang
			expect(errors).toHaveLength(1);
			expect(errors[0].event).toBe("session_shutdown");
			expect(String(errors[0].error)).toContain("did not settle within 1500ms");
		} finally {
			delete process.env.PI_SHUTDOWN_DEADLINE_MS;
		}
	});

	it("handlers after a slow (but settling) one still run", async () => {
		process.env.PI_SHUTDOWN_DEADLINE_MS = "1500";
		try {
			const order: number[] = [];
			await emitSessionShutdownEvent(
				fakeRunner([
					async () => {
						await new Promise((r) => setTimeout(r, 100));
						order.push(1);
					},
					() => order.push(2),
				]) as any,
				{ type: "session_shutdown", reason: "quit" },
			);
			expect(order).toEqual([1, 2]);
			expect(errors).toHaveLength(0);
		} finally {
			delete process.env.PI_SHUTDOWN_DEADLINE_MS;
		}
	});
});
