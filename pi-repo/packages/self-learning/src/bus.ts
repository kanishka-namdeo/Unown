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

export function onAsync(event: string, handler: (payload: any) => void | Promise<void>) {
        bus.on(event, async (payload) => {
                try {
                        await handler(payload);
                } catch (err: any) {
                        emit("router:error", { event, error: err?.message ?? String(err) });
                }
        });
        return () => bus.off(event, handler);
}
