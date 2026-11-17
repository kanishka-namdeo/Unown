import { describe, expect, test } from "bun:test";
import { bashDurationLineVisible } from "../src/core/tools/bash.ts";

/**
 * Calando Q2 — the bash duration line's visibility rule.
 *
 * The completed "Took <d>" line renders only when d >= 1 s: a sub-second
 * command's duration is noise ("Took 0.0s" on every fast call was
 * rationed-line waste — the most common case printed a number nobody asks
 * about). The LIVE "Elapsed <d>" line always renders while a command runs:
 * a running command must never look frozen (the occupied-wait rule).
 */
describe("bashDurationLineVisible — Calando Q2", () => {
	test("sub-second completed commands render NO duration line", () => {
		expect(bashDurationLineVisible(false, 0)).toBe(false);
		expect(bashDurationLineVisible(false, 100)).toBe(false);
		expect(bashDurationLineVisible(false, 999)).toBe(false);
	});
	test("completed commands >= 1 s render the Took line", () => {
		expect(bashDurationLineVisible(false, 1000)).toBe(true);
		expect(bashDurationLineVisible(false, 5300)).toBe(true);
		expect(bashDurationLineVisible(false, 120_000)).toBe(true);
	});
	test("running commands ALWAYS render the live Elapsed line (occupied wait)", () => {
		expect(bashDurationLineVisible(true, 0)).toBe(true);
		expect(bashDurationLineVisible(true, 50)).toBe(true);
		expect(bashDurationLineVisible(true, 400)).toBe(true);
	});
});
