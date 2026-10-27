// LR-2 pins (2026-10-27 long-run stress round): the terminal mid-exchange
// auto-compact extension. pi checks compaction only at agent_end / pre-prompt
// (agent-session.ts: "checked on agent_end"), so a long single-prompt tool
// exchange never compacts mid-run — measured live by the longrun
// compact-thrash scenario (stop=length at ~80 output tokens, then a 1-token
// empty completion, then the run died as an upstream-empty error). These pins
// hold the terminal twin to the engine curve's exact contract — evaluated in
// RESERVE-AWARE effective-window space (the clamp zone starts at
// window − reserve, which for small windows sits BELOW the plain 85% mark).
import { describe, expect, test } from "bun:test";
import {
        TERMINAL_AUTO_COMPACT_MAX_CONTINUATIONS,
        activeTerminalAutoCompact,
        createTerminalAutoCompactExtension,
        decideTerminalAutoCompact,
        PI_DEFAULT_RESERVE_TOKENS,
        TERMINAL_AUTO_COMPACT_ENV,
        effectiveContextWindow,
} from "../src/terminal-auto-compact.ts";
import { DEFAULT_COMPACT_THRESHOLD, DEFAULT_HARD_LIMIT, DEFAULT_WARN_THRESHOLD } from "../src/auto-compact.ts";

/** Fire a synthetic assistant message_end through the extension factory. */
function fireMessageEnd(ext: { factory: (pi: any) => void }, ctx: any) {
        const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
        ext.factory({
                on: (name: string, h: (event: unknown, ctx: unknown) => void) => {
                        handlers[name] = h as (event: unknown, ctx: unknown) => void;
                },
        });
        handlers["message_end"]?.({ type: "message_end", message: { role: "assistant", stopReason: "toolUse" } }, ctx);
}

function makeCtx(
        usage?: { tokens: number; contextWindow: number },
        log: string[] = [],
        mode: string = "print",
) {
        return {
                mode,
                getContextUsage: () => usage,
                compact: (opts?: { onComplete?: () => void; onError?: (e: Error) => void }) => {
                        log.push("compact");
                        opts?.onComplete?.();
                },
                abort: () => log.push("abort"),
        };
}

describe("effectiveContextWindow (pure)", () => {
        test("large windows: window minus the default reserve (the plain-curve no-op band)", () => {
                // The default 524k window: effective 507.9k — the 85% mark moves from
                // 445.6k to 431.7k; compaction fires slightly earlier, never later.
                expect(effectiveContextWindow(524_288, PI_DEFAULT_RESERVE_TOKENS)).toBe(524_288 - 16_384);
        });

        test("small windows: the reserve-aware marks sit BELOW the clamp zone start", () => {
                // The 24k thrash arm with a 6k reserve: pi clamps output at
                // 24k - 6k = 18k; the effective window IS 18k, so the 85% compact mark
                // (15.3k) and even the 95% block mark (17.1k) fire before the death zone.
                const eff = effectiveContextWindow(24_000, 6_000);
                expect(eff).toBe(18_000);
                expect((eff * DEFAULT_COMPACT_THRESHOLD) / 100).toBeLessThan(18_000);
                expect((eff * DEFAULT_HARD_LIMIT) / 100).toBeLessThan(18_000);
        });

        test("a reserve larger than the window degrades to quarter-window, never zero", () => {
                expect(effectiveContextWindow(10_000, 50_000)).toBe(2_500);
                expect(effectiveContextWindow(10_000, 10_000)).toBe(2_500);
        });
});

describe("decideTerminalAutoCompact (pure)", () => {
        test("the engine curve buckets over the effective window, warn printed once per crossing", () => {
                const eff = effectiveContextWindow(100_000, PI_DEFAULT_RESERVE_TOKENS); // 83,616
                expect(decideTerminalAutoCompact(10_000, 100_000, PI_DEFAULT_RESERVE_TOKENS, "none").decision.action).toBe("none");

                // First entry into the warn bucket prints; staying in it does not.
                // (ceil at the boundary: exactly 70% of the effective window is "in".)
                const warnAt = Math.ceil((eff * DEFAULT_WARN_THRESHOLD) / 100);
                const first = decideTerminalAutoCompact(warnAt, 100_000, PI_DEFAULT_RESERVE_TOKENS, "none");
                expect(first.decision.action).toBe("warn");
                expect(first.printWarn).toBe(true);
                const still = decideTerminalAutoCompact(warnAt + 500, 100_000, PI_DEFAULT_RESERVE_TOKENS, "warn");
                expect(still.decision.action).toBe("warn");
                expect(still.printWarn).toBe(false);

                const compactAt = Math.ceil((eff * DEFAULT_COMPACT_THRESHOLD) / 100);
                expect(decideTerminalAutoCompact(compactAt, 100_000, PI_DEFAULT_RESERVE_TOKENS, "warn").decision.action).toBe("compact");
                const blockAt = Math.ceil((eff * DEFAULT_HARD_LIMIT) / 100);
                expect(decideTerminalAutoCompact(blockAt, 100_000, PI_DEFAULT_RESERVE_TOKENS, "compact").decision.action).toBe("block");
        });

        test("the 24k thrash arm: compact fires at 15.3k — before the 18k clamp zone", () => {
                // The exact live-failure shape: at 15.3k tokens the decision must be
                // "compact" (the pre-fix run sailed past this into the clamp zone).
                const d = decideTerminalAutoCompact(15_300, 24_000, 6_000, "warn");
                expect(d.decision.action).toBe("compact");
                // ...and at 17.2k (still below the 18k clamp start) it must block
                // rather than let the request die as a 1-token empty completion.
                const b = decideTerminalAutoCompact(17_200, 24_000, 6_000, "compact");
                expect(b.decision.action).toBe("block");
        });

        test("re-entering warn after a compact prints again (a new crossing)", () => {
                const eff = effectiveContextWindow(100_000, PI_DEFAULT_RESERVE_TOKENS);
                const again = decideTerminalAutoCompact(Math.ceil((eff * DEFAULT_WARN_THRESHOLD) / 100), 100_000, PI_DEFAULT_RESERVE_TOKENS, "compact");
                expect(again.decision.action).toBe("warn");
                expect(again.printWarn).toBe(true);
        });
});

describe("createTerminalAutoCompactExtension (event-driven)", () => {
        test("compact fires ctx.compact() at 85% of effective in PRINT mode and settles", () => {
                const log: string[] = [];
                const { extension, state } = createTerminalAutoCompactExtension();
                // 75k of a 100k window with the default 16,384 reserve → 75k is between
                // 85% (71,073) and 95% (79,435) of the 83,616 effective window → compact.
                fireMessageEnd(extension, makeCtx({ tokens: 75_000, contextWindow: 100_000 }, log));
                expect(log).toEqual(["compact"]);
                expect(state.compactions).toBe(1);
                expect(state.compactInFlight).toBe(false); // onComplete settled it
                expect(state.lastCompactSucceeded).toBe(true);
                expect(state.continuationRounds).toBe(1);
                expect(state.lastAction).toBe("compact");
        });

        test("compact stays WARN-ONLY in TUI mode (the user is present and in control)", () => {
                const log: string[] = [];
                const { extension, state } = createTerminalAutoCompactExtension();
                fireMessageEnd(extension, makeCtx({ tokens: 75_000, contextWindow: 100_000 }, log, "tui"));
                expect(log).toEqual([]); // no compact, no abort
                expect(state.compactions).toBe(0);
                expect(state.continuationRounds).toBe(0);
        });

        test("a failed compaction settles as not-succeeded (the caller must not continue)", () => {
                const log: string[] = [];
                const { extension, state } = createTerminalAutoCompactExtension();
                const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
                extension.factory({
                        on: (name: string, h: (event: unknown, ctx: unknown) => void) => {
                                handlers[name] = h as (event: unknown, ctx: unknown) => void;
                        },
                });
                handlers["message_end"]?.(
                        { type: "message_end", message: { role: "assistant", stopReason: "toolUse" } },
                        {
                                mode: "print",
                                getContextUsage: () => ({ tokens: 75_000, contextWindow: 100_000 }),
                                compact: (opts: any) => {
                                        log.push("compact");
                                opts?.onError?.(new Error("Nothing to compact (session too small)"));
                                },
                                abort: () => log.push("abort"),
                        },
                );
                expect(log).toEqual(["compact"]);
                expect(state.lastCompactSucceeded).toBe(false);
                expect(state.compactInFlight).toBe(false);
        });

        test("the continuation cap degrades to warn-only (the curve never bricks a session)", () => {
                const log: string[] = [];
                const { extension, state } = createTerminalAutoCompactExtension();
                for (let i = 0; i < 10; i++) {
                        fireMessageEnd(extension, makeCtx({ tokens: 75_000, contextWindow: 100_000 }, log));
                }
                // TERMINAL_AUTO_COMPACT_MAX_CONTINUATIONS compactions, then warn-only.
                expect(state.compactions).toBe(8);
                expect(state.continuationRounds).toBe(8);
        });

        test("block (≥95%) now takes the SAME compact+continue action (LR-2c — abort is the last resort)", () => {
                const log: string[] = [];
                const { extension, state } = createTerminalAutoCompactExtension();
                fireMessageEnd(extension, makeCtx({ tokens: 96_000, contextWindow: 100_000 }, log));
                // Measured live: a single large tool result can jump 72% → 116% in one
                // turn — aborting there kills runs pi's own overflow recovery saves.
                expect(log).toEqual(["compact"]);
                expect(state.compactions).toBe(1);
                expect(state.lastCompactSucceeded).toBe(true);
        });

        test("warn bucket prints one line per crossing, not per turn", () => {
                const log: string[] = [];
                const { extension, state } = createTerminalAutoCompactExtension();
                // 65k of a 100k window → between 70% (58,531) and 85% (71,073) of the
                // effective window → the warn bucket.
                const ctx = makeCtx({ tokens: 65_000, contextWindow: 100_000 }, log);
                fireMessageEnd(extension, ctx);
                fireMessageEnd(extension, ctx);
                fireMessageEnd(extension, ctx);
                expect(state.warnings).toBe(1);
                expect(state.lastAction).toBe("warn");
        });

        test("non-assistant and error/aborted messages are ignored; no usage signal is a no-op", () => {
                const log: string[] = [];
                const { extension, state } = createTerminalAutoCompactExtension();
                const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
                extension.factory({
                        on: (name: string, h: (event: unknown, ctx: unknown) => void) => {
                                handlers[name] = h as (event: unknown, ctx: unknown) => void;
                        },
                });
                const ctx = makeCtx({ tokens: 99_000, contextWindow: 100_000 }, log);
                handlers["message_end"]?.({ type: "message_end", message: { role: "user" } }, ctx);
                handlers["message_end"]?.({ type: "message_end", message: { role: "assistant", stopReason: "error" } }, ctx);
                handlers["message_end"]?.({ type: "message_end", message: { role: "assistant", stopReason: "aborted" } }, ctx);
                handlers["message_end"]?.(
                        { type: "message_end", message: { role: "assistant", stopReason: "toolUse" } },
                        makeCtx(undefined, log),
                );
                expect(log).toEqual([]);
                expect(state.lastAction).toBe("none");
        });

        test("UNOWN_TERMINAL_AUTO_COMPACT=0 is the kill switch (read per event)", () => {
                const log: string[] = [];
                const { extension } = createTerminalAutoCompactExtension();
                process.env[TERMINAL_AUTO_COMPACT_ENV] = "0";
                try {
                        fireMessageEnd(extension, makeCtx({ tokens: 96_000, contextWindow: 100_000 }, log));
                        expect(log).toEqual([]);
                } finally {
                        delete process.env[TERMINAL_AUTO_COMPACT_ENV];
                }
                fireMessageEnd(extension, makeCtx({ tokens: 96_000, contextWindow: 100_000 }, log));
                expect(log).toEqual(["compact"]);
        });

        test("the module registry exposes the most recently created state (the fleetManagers pattern)", () => {
                const { state } = createTerminalAutoCompactExtension();
                expect(activeTerminalAutoCompact()).toBe(state);
        });

        test("TERMINAL_AUTO_COMPACT_MAX_CONTINUATIONS is the documented cap (8)", () => {
                expect(TERMINAL_AUTO_COMPACT_MAX_CONTINUATIONS).toBe(8);
        });
});
