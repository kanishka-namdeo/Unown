/**
 * bus.ts — tiny in-process event bus used for routing (pattern 3/5),
 * live SSE updates to the dashboard, and inter-module signaling.
 */
import { EventEmitter } from "node:events";

export const bus = new EventEmitter();
bus.setMaxListeners(100);

export function emit(event: string, payload?: any) {
	// meta event consumed by the SSE stream / dashboard
	bus.emit("event", { event, payload, ts: Date.now() });
	// named event consumed by the router's event jobs
	bus.emit(event, payload);
}

export function subscribe(listener: (e: { event: string; payload: any; ts: number }) => void) {
	bus.on("event", listener);
	return () => bus.off("event", listener);
}

/** Fire-and-forget async event handlers (routing layer listens on these). */
export function emitAsync(event: string, payload?: any) {
	setImmediate(() => bus.emit(event, payload));
}

/**
 * Register an async handler; returns an unsubscriber that ACTUALLY removes
 * the listener. The old version returned `bus.off(event, handler)` — but the
 * registered listener was the error-trapping WRAPPER, not `handler`, so the
 * unsubscriber removed nothing: router.stop() left every event handler live
 * on the bus forever (stale routers kept double-executing event jobs after
 * stop — found live by test/router.test.ts's queue tests).
 */
export function onAsync(event: string, handler: (payload: any) => void | Promise<void>) {
	const wrapper = async (payload: any) => {
		try {
			await handler(payload);
		} catch (err: any) {
			emit("router:error", { event, error: err?.message ?? String(err) });
		}
	};
	bus.on(event, wrapper);
	return () => bus.off(event, wrapper);
}
