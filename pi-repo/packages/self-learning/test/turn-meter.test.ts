/**
 * turn-meter.test.ts — the per-turn footer chip (the 2026-10 convergence
 * round; goose v1.42+ / Gemini /stats / Claude Code statusline parity).
 * Pins the pure core: env gate, compact formatters, the pricing estimate and
 * the assembled chip text.
 */
import { describe, expect, test } from "bun:test";
import {
        compactDuration,
        compactTokens,
        estimateSessionCostUsd,
        formatTurnMeter,
        turnMeterEnabled,
        type TurnMeterInput,
} from "../src/turn-meter.ts";

const FIXED_PRICE = { inputUsdPer1M: 0.6, outputUsdPer1M: 2.5 };

function input(overrides: Partial<TurnMeterInput> = {}): TurnMeterInput {
        return {
                usage: { tokensIn: 12_345, tokensOut: 678, cacheRead: 9_000, model: "kimi-k2.5" },
                durationMs: 3_400,
                context: { tokens: 62_000, contextWindow: 100_000 },
                env: {},
                resolvePrice: () => FIXED_PRICE,
                ...overrides,
        };
}

describe("the gate", () => {
        test("on by default", () => {
                expect(turnMeterEnabled({})).toBe(true);
        });
        test("UNOWN_TURN_METER=0 disables", () => {
                expect(turnMeterEnabled({ UNOWN_TURN_METER: "0" })).toBe(false);
        });
        test("disabled → empty text, enabled=false", () => {
                const result = formatTurnMeter(input({ env: { UNOWN_TURN_METER: "0" } }));
                expect(result.enabled).toBe(false);
                expect(result.text).toBe("");
        });
});

describe("compact formatters", () => {
        test("tokens: raw, k, M", () => {
                expect(compactTokens(942)).toBe("942");
                expect(compactTokens(12_345)).toBe("12.3k");
                expect(compactTokens(123_456)).toBe("123k");
                expect(compactTokens(1_234_567)).toBe("1.23M");
                expect(compactTokens(-5)).toBe("0");
        });
        test("durations: sub-second, seconds, minutes", () => {
                expect(compactDuration(830)).toBe("<1s");
                expect(compactDuration(34_200)).toBe("34.2s");
                expect(compactDuration(92_000)).toBe("1.5m");
        });
});

describe("cost estimate", () => {
        test("prices the session rollup via the resolver", () => {
                const usd = estimateSessionCostUsd(input().usage, () => FIXED_PRICE, {});
                // 12_345/1M * 0.6 + 678/1M * 2.5
                expect(usd).toBeCloseTo(0.007407 + 0.001695, 6);
        });
        test("unknown model → null (a price is never invented)", () => {
                expect(estimateSessionCostUsd({ tokensIn: 1, tokensOut: 1, model: "mystery" }, () => null, {})).toBeNull();
                expect(estimateSessionCostUsd({ tokensIn: 1, tokensOut: 1 }, () => FIXED_PRICE, {})).toBeNull();
        });
});

describe("the chip", () => {
        test("assembled order: turn, ctx, tokens, cost", () => {
                const { text, enabled } = formatTurnMeter(input());
                expect(enabled).toBe(true);
                expect(text).toBe("turn 3.4s · ctx 62% · in 12.3k out 678 (cached 9k) · ~$0.0091");
        });
        test("without context usage the ctx segment is omitted", () => {
                const { text } = formatTurnMeter(input({ context: undefined }));
                expect(text).toBe("turn 3.4s · in 12.3k out 678 (cached 9k) · ~$0.0091");
        });
        test("zero cache reads drop the cached segment", () => {
                const { text } = formatTurnMeter(input({ usage: { tokensIn: 100, tokensOut: 10, cacheRead: 0, model: "kimi-k2.5" } }));
                expect(text).toBe("turn 3.4s · ctx 62% · in 100 out 10 · ~$0.0001");
        });
        test("without a price the cost segment is omitted, tokens remain", () => {
                const { text } = formatTurnMeter(input({ resolvePrice: () => null }));
                expect(text).toBe("turn 3.4s · ctx 62% · in 12.3k out 678 (cached 9k)");
        });
        test("sub-cent costs keep four decimals", () => {
                const { text } = formatTurnMeter(input({ usage: { tokensIn: 1_000, tokensOut: 100, cacheRead: 0, model: "kimi-k2.5" } }));
                expect(text).toContain("~$0.0009");
        });
});
