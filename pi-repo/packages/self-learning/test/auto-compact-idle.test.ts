/**
 * auto-compact-idle.test.ts — the idle-compaction curve (Claude Code
 * v2.1.299 parity, the 2026-10 convergence round): the idle threshold, the
 * usage floor, the kill switch, env overrides and the notice line.
 */
import { describe, expect, test } from "bun:test";
import {
	DEFAULT_IDLE_COMPACT_MINUTES,
	DEFAULT_IDLE_COMPACT_MIN_USAGE,
	formatIdleCompactNotice,
	IDLE_COMPACT_MINUTES_ENV,
	IDLE_COMPACT_MIN_USAGE_ENV,
	resolveIdleCompactConfig,
	shouldIdleCompact,
} from "../src/auto-compact.ts";

describe("shouldIdleCompact — the curve", () => {
	test("default: compact at 45m idle when usage ≥ 50%", () => {
		expect(shouldIdleCompact(44 * 60_000, 80_000, 100_000).action).toBe("none");
		const decision = shouldIdleCompact(46 * 60_000, 80_000, 100_000);
		expect(decision.action).toBe("compact");
		expect(decision.usagePercent).toBe(80);
		expect(decision.idleMinutes).toBe(46);
	});

	test("light context never compacts (usage below the floor)", () => {
		const decision = shouldIdleCompact(46 * 60_000, 20_000, 100_000);
		expect(decision.action).toBe("none");
		expect(decision.reason).toContain("light context");
	});

	test("minutes=0 is the kill switch", () => {
		const prev = process.env[IDLE_COMPACT_MINUTES_ENV];
		process.env[IDLE_COMPACT_MINUTES_ENV] = "0";
		try {
			expect(shouldIdleCompact(9 * 60_000 * 60, 99_000, 100_000).action).toBe("none");
		} finally {
			process.env[IDLE_COMPACT_MINUTES_ENV] = prev;
		}
	});

	test("no context-window signal → skip (cannot judge usage)", () => {
		const decision = shouldIdleCompact(46 * 60_000, 50_000, 0);
		expect(decision.action).toBe("none");
		expect(decision.reason).toContain("no context window signal");
	});

	test("env overrides: minutes + usage floor", () => {
		const prevMin = process.env[IDLE_COMPACT_MINUTES_ENV];
		const prevUsage = process.env[IDLE_COMPACT_MIN_USAGE_ENV];
		process.env[IDLE_COMPACT_MINUTES_ENV] = "10";
		process.env[IDLE_COMPACT_MIN_USAGE_ENV] = "25";
		try {
			expect(shouldIdleCompact(9 * 60_000, 30_000, 100_000).action).toBe("none");
			expect(shouldIdleCompact(11 * 60_000, 30_000, 100_000).action).toBe("compact");
			// Below the 25% floor at 11m idle → still none.
			expect(shouldIdleCompact(11 * 60_000, 20_000, 100_000).action).toBe("none");
		} finally {
			process.env[IDLE_COMPACT_MINUTES_ENV] = prevMin;
			process.env[IDLE_COMPACT_MIN_USAGE_ENV] = prevUsage;
		}
	});

	test("explicit config wins over env", () => {
		const prev = process.env[IDLE_COMPACT_MINUTES_ENV];
		process.env[IDLE_COMPACT_MINUTES_ENV] = "99";
		try {
			expect(resolveIdleCompactConfig({ minutes: 5 }).minutes).toBe(5);
		} finally {
			process.env[IDLE_COMPACT_MINUTES_ENV] = prev;
		}
		expect(resolveIdleCompactConfig().minutes).toBe(DEFAULT_IDLE_COMPACT_MINUTES);
		expect(resolveIdleCompactConfig().minUsagePercent).toBe(DEFAULT_IDLE_COMPACT_MIN_USAGE);
	});
});

describe("the notice line", () => {
	test("plain language: the span, the usage, the tuning knobs", () => {
		const notice = formatIdleCompactNotice({
			action: "compact",
			reason: "idle 52.0m with usage 71% ≥ 50% — compacting before the next prompt",
			idleMinutes: 52,
			usagePercent: 71,
		});
		expect(notice).toContain("[idle-compact]");
		expect(notice).toContain("52m");
		expect(notice).toContain("71%");
		expect(notice).toContain("UNOWN_IDLE_COMPACT_MINUTES");
		expect(notice).toContain("/compact");
	});
});
