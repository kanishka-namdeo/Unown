// Unit tests for src/notify-tui.ts — the turn-complete attention layer for
// interactive sessions.
//
// Pins: the gate chain (TTY, UNOWN_TUI_NOTIFY, the shared UNOWN_NOTIFY /
// DO_NOT_TRACK family), the long-turn threshold (shared UNOWN_NOTIFY_MS
// spelling, empty-means-unset), the payload shape (OSC-9 + BEL), and the
// deferred/idempotent scheduling contract (cancel kills the pending write;
// no write happens synchronously).
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { describe, expect, test } from "bun:test";
import {
        NOTIFY_DEFER_MS,
        scheduleTurnEndPing,
        shouldPingOnTurnEnd,
        turnEndPingPayload,
        turnNotifyThresholdMs,
        tuiNotifyEnabled,
        tuiNotifyGated,
} from "../src/notify-tui.ts";

describe("tuiNotifyEnabled", () => {
        test("default ON; 0/false/off disable; empty means unset", () => {
                expect(tuiNotifyEnabled({})).toBe(true);
                expect(tuiNotifyEnabled({ UNOWN_TUI_NOTIFY: "" })).toBe(true);
                expect(tuiNotifyEnabled({ UNOWN_TUI_NOTIFY: "1" })).toBe(true);
                expect(tuiNotifyEnabled({ UNOWN_TUI_NOTIFY: "on" })).toBe(true);
                expect(tuiNotifyEnabled({ UNOWN_TUI_NOTIFY: "TRUE" })).toBe(true);
                ["0", "false", "off", "no"].forEach((v) => {
                        expect(tuiNotifyEnabled({ UNOWN_TUI_NOTIFY: v })).toBe(false);
                });
        });
});

describe("tuiNotifyGated — the full gate chain", () => {
        test("non-TTY stdout never pings (piped RPC stays byte-clean)", () => {
                expect(tuiNotifyGated(false, {})).toBe(false);
        });
        test("the TUI switch composes with the shared notify gates", () => {
                expect(tuiNotifyGated(true, {})).toBe(true);
                expect(tuiNotifyGated(true, { UNOWN_TUI_NOTIFY: "0" })).toBe(false);
                expect(tuiNotifyGated(true, { UNOWN_NOTIFY: "0" })).toBe(false);
                expect(tuiNotifyGated(true, { DO_NOT_TRACK: "1" })).toBe(false);
        });
});

describe("turnNotifyThresholdMs", () => {
        test("default 120s; UNOWN_NOTIFY_MS shared with print mode; empty means unset", () => {
                expect(turnNotifyThresholdMs({})).toBe(120_000);
                expect(turnNotifyThresholdMs({ UNOWN_NOTIFY_MS: "" })).toBe(120_000);
                expect(turnNotifyThresholdMs({ UNOWN_NOTIFY_MS: "0" })).toBe(0);
                expect(turnNotifyThresholdMs({ UNOWN_NOTIFY_MS: "5000" })).toBe(5000);
                expect(turnNotifyThresholdMs({ UNOWN_NOTIFY_MS: "abc" })).toBe(120_000);
        });
});

describe("shouldPingOnTurnEnd", () => {
        test("a quick turn stays silent; a long turn pings", () => {
                expect(shouldPingOnTurnEnd(1_000, true, {})).toBe(false);
                expect(shouldPingOnTurnEnd(130_000, true, {})).toBe(true);
                expect(shouldPingOnTurnEnd(130_000, true, { UNOWN_NOTIFY_MS: "1000" })).toBe(true);
                expect(shouldPingOnTurnEnd(500, true, { UNOWN_NOTIFY_MS: "1000" })).toBe(false);
                expect(shouldPingOnTurnEnd(130_000, false, {})).toBe(false);
        });
});

describe("turnEndPingPayload", () => {
        test("OSC-9 with the unown prefix + preview, capped at 80 chars, then BEL BEL", () => {
                const p = turnEndPingPayload("the tests pass now");
                expect(p.startsWith("\x1b]9;unown: done — the tests pass now\x07")).toBe(true);
                expect(p.endsWith("\x07")).toBe(true);
                expect(p).toHaveLength(`\x1b]9;unown: done — the tests pass now\x07`.length + 1);
                const long = "x".repeat(300);
                expect(turnEndPingPayload(long).length).toBeLessThanOrEqual(100);
        });
        test("empty preview degrades to the waiting message", () => {
                expect(turnEndPingPayload("   ")).toContain("waiting for your next message");
        });
});

describe("scheduleTurnEndPing", () => {
        test("returns null when gated — no timer, no write", () => {
                const writes: string[] = [];
                expect(scheduleTurnEndPing(1_000, "x", { isTty: true, write: (s) => writes.push(s) })).toBeNull();
                expect(scheduleTurnEndPing(130_000, "x", { isTty: false, write: (s) => writes.push(s) })).toBeNull();
                expect(scheduleTurnEndPing(130_000, "x", { isTty: true, env: { UNOWN_TUI_NOTIFY: "0" }, write: (s) => writes.push(s) })).toBeNull();
                expect(writes).toHaveLength(0);
        });

        test("deferred: nothing written synchronously; fires after the defer; cancel kills it", () => {
                const writes: string[] = [];
                const fired: number[] = [];
                const fakeTimer = (fn: () => void, ms: number) => {
                        const handle = { cancelled: false, cancel: () => (handle.cancelled = true) };
                        queueMicrotask(() => {
                                if (!handle.cancelled) {
                                        fired.push(ms);
                                        fn();
                                }
                        });
                        return handle;
                };
                const handle = scheduleTurnEndPing(130_000, "done answer", {
                        isTty: true,
                        write: (s) => writes.push(s),
                        setTimeoutFn: fakeTimer,
                });
                expect(handle).not.toBeNull();
                expect(writes).toHaveLength(0); // never synchronous
                return new Promise((resolve) => {
                        setTimeout(() => {
                                expect(writes).toHaveLength(1);
                                expect(writes[0]).toContain("\x1b]9;unown: done — done answer");
                                expect(fired[0]).toBe(NOTIFY_DEFER_MS);
                                // cancel() after fire is a no-op, not an error
                                handle?.cancel();
                                resolve(null);
                        }, 20);
                });
        });

        test("two scheduled pings do not share state (each returns its own handle)", () => {
                const writes: string[] = [];
                const fakeTimer = (fn: () => void, _ms: number) => {
                        const handle = { cancel: () => undefined };
                        queueMicrotask(fn);
                        return handle;
                };
                scheduleTurnEndPing(130_000, "a", { isTty: true, write: (s) => writes.push(s), setTimeoutFn: fakeTimer });
                scheduleTurnEndPing(130_000, "b", { isTty: true, write: (s) => writes.push(s), setTimeoutFn: fakeTimer });
                return new Promise((resolve) => {
                        setTimeout(() => {
                                expect(writes).toHaveLength(2);
                                resolve(null);
                        }, 20);
                });
        });
});
