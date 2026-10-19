// Unit tests for src/auto-compact.ts — the Milestone 3.7 auto-compact-on-
// token-limit feature (the goose auto-compact port).
//
// Pins (per the spec):
//   1.  shouldAutoCompact returns "none" when usage is below 70%
//   2.  shouldAutoCompact returns "warn" when usage is 70–85%
//   3.  shouldAutoCompact returns "compact" when usage is 85–95%
//   4.  shouldAutoCompact returns "block" when usage is above 95%
//   5.  shouldAutoCompact respects `warnThreshold` override
//   6.  shouldAutoCompact respects `compactThreshold` override
//   7.  shouldAutoCompact respects `hardLimit` override
//   8.  shouldAutoCompact handles edge cases: 0 tokens used, exactly at
//       threshold, exactly at hard limit
//   9.  shouldAutoCompact handles `maxTokens === 0` gracefully (returns "none")
//  10.  formatCompactionWarning returns a non-empty string mentioning the percentage
//  11.  formatContextExhaustedError returns a non-empty error message
//  12.  Env var `UNOWN_AUTO_COMPACT_THRESHOLD` overrides the default (mock process.env)
//  13.  Env var `UNOWN_AUTO_COMPACT_HARD_LIMIT` overrides the default
//
// Hermeticity: this file imports ONLY from `../src/auto-compact.ts` — no pi
// modules, no fs, no network. Env-var tests snapshot + restore process.env so
// they cannot leak across the suite (the helpers read process.env lazily, so a
// per-test mutation is observable without re-importing).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    AUTO_COMPACT_HARD_LIMIT_ENV,
    AUTO_COMPACT_THRESHOLD_ENV,
    DEFAULT_COMPACT_THRESHOLD,
    DEFAULT_HARD_LIMIT,
    DEFAULT_WARN_THRESHOLD,
    formatCompactionWarning,
    formatContextExhaustedError,
    resolveAutoCompactConfig,
    shouldAutoCompact,
    type AutoCompactConfig,
} from "../src/auto-compact.ts";

// ---------------------------------------------------------------------------
// Env-var snapshot/restore — the helpers read process.env lazily; tests that
// need to assert env-var overrides set their own values and the restore
// guarantees no cross-test pollution.
// ---------------------------------------------------------------------------
const ENV_KEYS = [AUTO_COMPACT_THRESHOLD_ENV, AUTO_COMPACT_HARD_LIMIT_ENV];
const envSnapshots: Record<string, string | undefined> = {};

beforeEach(() => {
    for (const k of ENV_KEYS) envSnapshots[k] = process.env[k];
});

afterEach(() => {
    for (const k of ENV_KEYS) {
        if (envSnapshots[k] === undefined) delete process.env[k];
        else process.env[k] = envSnapshots[k];
    }
});

// ---------------------------------------------------------------------------
// Curve buckets (spec cases 1–4)
// ---------------------------------------------------------------------------

describe("shouldAutoCompact — the proportional curve (defaults 70/85/95)", () => {
    const MAX = 100_000; // tokens

    test("1. usage < 70% → 'none' (full context available)", () => {
        for (const used of [0, 1_000, 50_000, 69_999]) {
            const decision = shouldAutoCompact(used, MAX);
            expect(decision.action).toBe("none");
            expect(decision.threshold).toBe(DEFAULT_WARN_THRESHOLD);
        }
    });

    test("2. 70% ≤ usage < 85% → 'warn' (compaction imminent)", () => {
        for (const used of [70_000, 75_000, 84_999]) {
            const decision = shouldAutoCompact(used, MAX);
            expect(decision.action).toBe("warn");
            expect(decision.threshold).toBe(DEFAULT_WARN_THRESHOLD);
        }
    });

    test("3. 85% ≤ usage < 95% → 'compact' (auto-trigger on next turn)", () => {
        for (const used of [85_000, 90_000, 94_999]) {
            const decision = shouldAutoCompact(used, MAX);
            expect(decision.action).toBe("compact");
            expect(decision.threshold).toBe(DEFAULT_COMPACT_THRESHOLD);
        }
    });

    test("4. usage ≥ 95% → 'block' (hard-block the next model request)", () => {
        for (const used of [95_000, 99_000, 200_000]) {
            const decision = shouldAutoCompact(used, MAX);
            expect(decision.action).toBe("block");
            expect(decision.threshold).toBe(DEFAULT_HARD_LIMIT);
        }
    });
});

// ---------------------------------------------------------------------------
// Threshold overrides (spec cases 5–7)
// ---------------------------------------------------------------------------

describe("shouldAutoCompact — explicit AutoCompactConfig overrides", () => {
    const MAX = 100_000;

    test("5. warnThreshold override wins over env + default", () => {
        // Set the env vars to confirm the explicit override wins.
        process.env[AUTO_COMPACT_THRESHOLD_ENV] = "85"; // default
        process.env[AUTO_COMPACT_HARD_LIMIT_ENV] = "95"; // default

        const cfg: AutoCompactConfig = { warnThreshold: 50 };
        // 49% → none, 50% → warn, 60% → warn, 84% → warn, 85% → compact
        expect(shouldAutoCompact(49_000, MAX, cfg).action).toBe("none");
        expect(shouldAutoCompact(50_000, MAX, cfg).action).toBe("warn");
        expect(shouldAutoCompact(60_000, MAX, cfg).action).toBe("warn");
        expect(shouldAutoCompact(84_000, MAX, cfg).action).toBe("warn");
        expect(shouldAutoCompact(85_000, MAX, cfg).action).toBe("compact");
        expect(shouldAutoCompact(95_000, MAX, cfg).action).toBe("block");
    });

    test("6. compactThreshold override wins over env + default", () => {
        // Set the env var to confirm the explicit override wins.
        process.env[AUTO_COMPACT_THRESHOLD_ENV] = "85"; // default

        const cfg: AutoCompactConfig = { compactThreshold: 75 };
        // 69% → none (still under default warn), 70% → warn, 74% → warn,
        // 75% → compact, 94% → compact, 95% → block
        expect(shouldAutoCompact(69_000, MAX, cfg).action).toBe("none");
        expect(shouldAutoCompact(70_000, MAX, cfg).action).toBe("warn");
        expect(shouldAutoCompact(74_000, MAX, cfg).action).toBe("warn");
        expect(shouldAutoCompact(75_000, MAX, cfg).action).toBe("compact");
        expect(shouldAutoCompact(94_000, MAX, cfg).action).toBe("compact");
        expect(shouldAutoCompact(95_000, MAX, cfg).action).toBe("block");
    });

    test("7. hardLimit override wins over env + default", () => {
        // Set the env var to confirm the explicit override wins.
        process.env[AUTO_COMPACT_HARD_LIMIT_ENV] = "95"; // default

        const cfg: AutoCompactConfig = { hardLimit: 90 };
        // 84% → warn, 85% → compact, 89% → compact, 90% → block, 99% → block
        expect(shouldAutoCompact(84_000, MAX, cfg).action).toBe("warn");
        expect(shouldAutoCompact(85_000, MAX, cfg).action).toBe("compact");
        expect(shouldAutoCompact(89_000, MAX, cfg).action).toBe("compact");
        expect(shouldAutoCompact(90_000, MAX, cfg).action).toBe("block");
        expect(shouldAutoCompact(99_000, MAX, cfg).action).toBe("block");
    });

    test("5b. all three overrides together compose", () => {
        const cfg: AutoCompactConfig = { warnThreshold: 40, compactThreshold: 60, hardLimit: 80 };
        expect(shouldAutoCompact(39_000, MAX, cfg).action).toBe("none");
        expect(shouldAutoCompact(40_000, MAX, cfg).action).toBe("warn");
        expect(shouldAutoCompact(59_000, MAX, cfg).action).toBe("warn");
        expect(shouldAutoCompact(60_000, MAX, cfg).action).toBe("compact");
        expect(shouldAutoCompact(79_000, MAX, cfg).action).toBe("compact");
        expect(shouldAutoCompact(80_000, MAX, cfg).action).toBe("block");
    });
});

// ---------------------------------------------------------------------------
// Edge cases (spec case 8)
// ---------------------------------------------------------------------------

describe("shouldAutoCompact — edge cases", () => {
    const MAX = 100_000;

    test("8a. 0 tokens used → 'none' (session just started)", () => {
        const decision = shouldAutoCompact(0, MAX);
        expect(decision.action).toBe("none");
        expect(decision.usagePercent).toBe(0);
        expect(decision.reason).toContain("full context available");
    });

    test("8b. exactly at warn threshold (70%) → 'warn'", () => {
        const decision = shouldAutoCompact(70_000, MAX);
        expect(decision.action).toBe("warn");
        expect(decision.usagePercent).toBe(70);
        expect(decision.reason).toContain("70%");
    });

    test("8c. exactly at compact threshold (85%) → 'compact'", () => {
        const decision = shouldAutoCompact(85_000, MAX);
        expect(decision.action).toBe("compact");
        expect(decision.usagePercent).toBe(85);
        expect(decision.reason).toContain("85%");
    });

    test("8d. exactly at hard limit (95%) → 'block'", () => {
        const decision = shouldAutoCompact(95_000, MAX);
        expect(decision.action).toBe("block");
        expect(decision.usagePercent).toBe(95);
        expect(decision.reason).toContain("95%");
        expect(decision.reason).toContain("context exhausted");
    });

    test("8e. just under hard limit (94.99%) → 'compact' (not 'block')", () => {
        const decision = shouldAutoCompact(94_990, MAX);
        expect(decision.action).toBe("compact");
    });

    test("8f. just over hard limit (200% — runaway / oversized) → 'block'", () => {
        const decision = shouldAutoCompact(200_000, MAX);
        expect(decision.action).toBe("block");
        expect(decision.usagePercent).toBeGreaterThan(100);
    });

    test("8g. negative tokensUsed coerced to 0 → 'none'", () => {
        const decision = shouldAutoCompact(-500, MAX);
        expect(decision.action).toBe("none");
        expect(decision.usagePercent).toBe(0);
    });

    test("8h. NaN tokensUsed coerced to 0 → 'none'", () => {
        const decision = shouldAutoCompact(Number.NaN, MAX);
        expect(decision.action).toBe("none");
    });

    test("8i. Infinity tokensUsed coerced to 0 → 'none' (defensive — never throws)", () => {
        const decision = shouldAutoCompact(Number.POSITIVE_INFINITY, MAX);
        expect(decision.action).toBe("none");
    });
});

// ---------------------------------------------------------------------------
// maxTokens === 0 / negative (spec case 9)
// ---------------------------------------------------------------------------

describe("shouldAutoCompact — maxTokens zero / negative", () => {
    test("9a. maxTokens === 0 → 'none' (curve disabled)", () => {
        const decision = shouldAutoCompact(50_000, 0);
        expect(decision.action).toBe("none");
        expect(decision.threshold).toBe(0);
        expect(decision.usagePercent).toBe(0);
        expect(decision.reason).toContain("disabled");
    });

    test("9b. negative maxTokens → 'none' (defensive)", () => {
        const decision = shouldAutoCompact(50_000, -1);
        expect(decision.action).toBe("none");
        expect(decision.threshold).toBe(0);
    });

    test("9c. NaN maxTokens → 'none' (defensive — never throws)", () => {
        const decision = shouldAutoCompact(50_000, Number.NaN);
        expect(decision.action).toBe("none");
    });

    test("9d. maxTokens === 0 does NOT block even with runaway tokensUsed", () => {
        const decision = shouldAutoCompact(1_000_000, 0);
        expect(decision.action).toBe("none");
    });
});

// ---------------------------------------------------------------------------
// Formatters (spec cases 10–11)
// ---------------------------------------------------------------------------

describe("formatCompactionWarning", () => {
    test("10a. returns a non-empty string mentioning the percentage", () => {
        const msg = formatCompactionWarning(75_000, 100_000);
        expect(typeof msg).toBe("string");
        expect(msg.length).toBeGreaterThan(0);
        expect(msg).toContain("75%");
        expect(msg).toContain("75,000");
        expect(msg).toContain("100,000");
    });

    test("10b. mentions compaction + the winding-down guidance", () => {
        const msg = formatCompactionWarning(80_000, 100_000);
        expect(msg).toMatch(/compact/i);
        expect(msg).toMatch(/next turn|wind down/i);
    });

    test("10c. handles maxTokens === 0 without throwing", () => {
        const msg = formatCompactionWarning(0, 0);
        expect(typeof msg).toBe("string");
        expect(msg).toContain("0%");
    });
});

describe("formatContextExhaustedError", () => {
    test("11a. returns a non-empty error message", () => {
        const msg = formatContextExhaustedError(98_000, 100_000);
        expect(typeof msg).toBe("string");
        expect(msg.length).toBeGreaterThan(0);
        expect(msg).toContain("98%");
    });

    test("11b. mentions the spec recovery actions (/compact or new session)", () => {
        const msg = formatContextExhaustedError(100_000, 100_000);
        expect(msg).toMatch(/\/compact/i);
        expect(msg).toMatch(/new session/i);
    });

    test("11c. includes the token counts (so the user can see how far over they are)", () => {
        const msg = formatContextExhaustedError(105_000, 100_000);
        expect(msg).toContain("105,000");
        expect(msg).toContain("100,000");
    });

    test("11d. handles maxTokens === 0 without throwing", () => {
        const msg = formatContextExhaustedError(0, 0);
        expect(typeof msg).toBe("string");
        expect(msg).toContain("0%");
    });
});

// ---------------------------------------------------------------------------
// Env var overrides (spec cases 12–13)
// ---------------------------------------------------------------------------

describe("resolveAutoCompactConfig — env-var precedence", () => {
    test("12. UNOWN_AUTO_COMPACT_THRESHOLD overrides the default compactThreshold", () => {
        process.env[AUTO_COMPACT_THRESHOLD_ENV] = "80";
        const cfg = resolveAutoCompactConfig();
        expect(cfg.compactThreshold).toBe(80);
        // warn + hardLimit are still the defaults (the env var only touches compact).
        expect(cfg.warnThreshold).toBe(DEFAULT_WARN_THRESHOLD);
        expect(cfg.hardLimit).toBe(DEFAULT_HARD_LIMIT);
    });

    test("13. UNOWN_AUTO_COMPACT_HARD_LIMIT overrides the default hardLimit", () => {
        process.env[AUTO_COMPACT_HARD_LIMIT_ENV] = "90";
        const cfg = resolveAutoCompactConfig();
        expect(cfg.hardLimit).toBe(90);
        expect(cfg.warnThreshold).toBe(DEFAULT_WARN_THRESHOLD);
        expect(cfg.compactThreshold).toBe(DEFAULT_COMPACT_THRESHOLD);
    });

    test("12b. UNOWN_AUTO_COMPACT_THRESHOLD affects shouldAutoCompact decisions", () => {
        process.env[AUTO_COMPACT_THRESHOLD_ENV] = "80";
        // 80% should now be 'compact' (not 'warn' as with the default 85).
        expect(shouldAutoCompact(80_000, 100_000).action).toBe("compact");
        // 79% is still 'warn' (warnThreshold stays at default 70).
        expect(shouldAutoCompact(79_000, 100_000).action).toBe("warn");
    });

    test("13b. UNOWN_AUTO_COMPACT_HARD_LIMIT affects shouldAutoCompact decisions", () => {
        process.env[AUTO_COMPACT_HARD_LIMIT_ENV] = "90";
        // 90% should now be 'block' (not 'compact' as with the default 95).
        expect(shouldAutoCompact(90_000, 100_000).action).toBe("block");
        // 89% is still 'compact' (compactThreshold stays at default 85).
        expect(shouldAutoCompact(89_000, 100_000).action).toBe("compact");
    });

    test("12c. explicit cfg.compactThreshold still wins over the env var", () => {
        process.env[AUTO_COMPACT_THRESHOLD_ENV] = "80";
        const cfg: AutoCompactConfig = { compactThreshold: 75 };
        expect(shouldAutoCompact(74_000, 100_000, cfg).action).toBe("warn");
        expect(shouldAutoCompact(75_000, 100_000, cfg).action).toBe("compact");
    });

    test("13c. explicit cfg.hardLimit still wins over the env var", () => {
        process.env[AUTO_COMPACT_HARD_LIMIT_ENV] = "90";
        const cfg: AutoCompactConfig = { hardLimit: 85 };
        // At 85% with cfg.hardLimit=85: 'block' (the cfg override wins over
        // the env var 90 — without the cfg, the env would have given 'compact').
        expect(shouldAutoCompact(85_000, 100_000, cfg).action).toBe("block");
        // At 84%: still 'warn' (under both default compactThreshold 85 AND cfg.hardLimit 85).
        expect(shouldAutoCompact(84_000, 100_000, cfg).action).toBe("warn");
        // At 95%: still 'block' (well above either limit).
        expect(shouldAutoCompact(95_000, 100_000, cfg).action).toBe("block");
    });

    test("12d. garbage env values fall back to the default (curve stays intact)", () => {
        process.env[AUTO_COMPACT_THRESHOLD_ENV] = "not-a-number";
        const cfg = resolveAutoCompactConfig();
        expect(cfg.compactThreshold).toBe(DEFAULT_COMPACT_THRESHOLD);
    });

    test("12e. out-of-range env values (>100) fall back to the default", () => {
        process.env[AUTO_COMPACT_THRESHOLD_ENV] = "150";
        const cfg = resolveAutoCompactConfig();
        expect(cfg.compactThreshold).toBe(DEFAULT_COMPACT_THRESHOLD);
    });

    test("12f. negative env values fall back to the default", () => {
        process.env[AUTO_COMPACT_THRESHOLD_ENV] = "-5";
        const cfg = resolveAutoCompactConfig();
        expect(cfg.compactThreshold).toBe(DEFAULT_COMPACT_THRESHOLD);
    });

    test("12g. empty env value falls back to the default", () => {
        process.env[AUTO_COMPACT_THRESHOLD_ENV] = "";
        const cfg = resolveAutoCompactConfig();
        expect(cfg.compactThreshold).toBe(DEFAULT_COMPACT_THRESHOLD);
    });
});

// ---------------------------------------------------------------------------
// Decision shape — sanity check (helps catch regressions in the interface)
// ---------------------------------------------------------------------------

describe("AutoCompactDecision shape", () => {
    test("every decision includes action + threshold + reason + usagePercent", () => {
        for (const used of [0, 50_000, 75_000, 90_000, 99_000]) {
            const decision = shouldAutoCompact(used, 100_000);
            expect(decision).toHaveProperty("action");
            expect(decision).toHaveProperty("threshold");
            expect(decision).toHaveProperty("reason");
            expect(decision).toHaveProperty("usagePercent");
            expect(typeof decision.reason).toBe("string");
            expect(decision.reason.length).toBeGreaterThan(0);
            expect(["none", "warn", "compact", "block"]).toContain(decision.action);
        }
    });
});
