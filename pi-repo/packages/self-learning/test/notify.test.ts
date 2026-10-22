/**
 * Unit tests for src/notify.ts — the M3 OSC-9 print-mode answer ping.
 *
 * The module's contract is deliberately split: everything that DECIDES or
 * FORMATS is pure and pinned here (the escape bytes, the 80-char truncation,
 * the TTY/opt-out gate matrix, the long-run threshold, the arrival decision);
 * the one side effect — writing control bytes to the process's real stdout —
 * is exercised only against an injected recorder stream, never the runner's
 * own stdout (escape bytes in a test runner's output corrupt its own
 * reporting). The wiring site (cmdPrint, text lane only, after the answer
 * has flushed) is documented in cli.ts.
 */
import { describe, expect, test } from "bun:test";
import {
	emitOsc9,
	formatOsc9,
	notifyGated,
	notifyThresholdMs,
	shouldNotifyOnAnswer,
	truncateForNotify,
} from "../src/notify.ts";

// ---------------------------------------------------------------------------
// formatOsc9 — the wire bytes, pinned exactly
// ---------------------------------------------------------------------------

describe("formatOsc9 (OSC-9 + BEL fallback, byte-pinned)", () => {
	test("title and body ride the one OSC string; one bare BEL follows", () => {
		expect(formatOsc9("unown", "done")).toBe("\x1b]9;unown: done\x07\x07");
	});

	test("the body is NOT escaped here — the caller truncates first (truncateForNotify)", () => {
		expect(formatOsc9("unown", "a\x1b[2mweird answer")).toBe("\x1b]9;unown: a\x1b[2mweird answer\x07\x07");
	});
});

describe("emitOsc9 — the one side effect, against a recorder stream", () => {
	test("writes exactly the payload to the injected stream", () => {
		const writes: string[] = [];
		const recorder = {
			write: (s: string) => {
				writes.push(s);
				return true;
			},
		};
		emitOsc9("unown", "shipped", recorder);
		expect(writes).toEqual(["\x1b]9;unown: shipped\x07\x07"]);
	});

	test("a throwing stream sink never breaks the run (cosmetic by contract)", () => {
		expect(() =>
			emitOsc9("unown", "x", {
				write: () => {
					throw new Error("EPIPE");
				},
			}),
		).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// truncateForNotify — the first-80-chars body
// ---------------------------------------------------------------------------

describe("truncateForNotify", () => {
	test("short text passes through", () => {
		expect(truncateForNotify("fixed the failing test")).toBe("fixed the failing test");
	});

	test("whitespace collapses to one line — a raw newline would terminate the OSC string", () => {
		expect(truncateForNotify("step 1 done\n\n   step 2 done\t\tstep 3 pending")).toBe(
			"step 1 done step 2 done step 3 pending",
		);
	});

	test("80 chars is the cap; truncation adds the ellipsis", () => {
		const text = "x".repeat(100);
		expect(truncateForNotify(text)).toHaveLength(81);
		expect(truncateForNotify(text).endsWith("…")).toBe(true);
		expect(truncateForNotify("y".repeat(80))).toBe("y".repeat(80)); // exactly 80 — no ellipsis
	});

	test("empty and whitespace-only answers truncate to empty (the decision layer rejects them)", () => {
		expect(truncateForNotify("")).toBe("");
		expect(truncateForNotify("  \n\t ")).toBe("");
	});
});

// ---------------------------------------------------------------------------
// notifyGated — the gate matrix (pure, takes the TTY flag + env record)
// ---------------------------------------------------------------------------

describe("notifyGated (isTty + opt-outs)", () => {
	const env = (over: Record<string, string> = {}) => over;

	test("a TTY with no opt-outs is enabled", () => {
		expect(notifyGated(true, { env: env() })).toBe(true);
	});

	test("no TTY (piped/redirected/CI) — never, regardless of env", () => {
		expect(notifyGated(false, { env: env() })).toBe(false);
		expect(notifyGated(false, { env: env({ UNOWN_NOTIFY: "1" }) })).toBe(false);
	});

	test.each([["0"], ["false"], ["off"], ["no"], ["NO"]])("UNOWN_NOTIFY=%s kills the ping", (v) => {
		expect(notifyGated(true, { env: env({ UNOWN_NOTIFY: v }) })).toBe(false);
	});

	test("UNOWN_NOTIFY=1 is still enabled (only the negative spellings opt out)", () => {
		expect(notifyGated(true, { env: env({ UNOWN_NOTIFY: "1" }) })).toBe(true);
	});

	test.each([["1"], ["true"], ["yes"]])(
		"DO_NOT_TRACK=%s is honored as the ecosystem no-nonessential-traffic signal",
		(v) => {
			expect(notifyGated(true, { env: env({ DO_NOT_TRACK: v }) })).toBe(false);
		},
	);

	test("DO_NOT_TRACK=0 means unset for our purposes (the standard is the =1 form)", () => {
		expect(notifyGated(true, { env: env({ DO_NOT_TRACK: "0" }) })).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// notifyThresholdMs — the long-run definition
// ---------------------------------------------------------------------------

describe("notifyThresholdMs", () => {
	test("default is 120s", () => {
		expect(notifyThresholdMs({})).toBe(120_000);
	});

	test('an unset OR EMPTY value means the default (repo .env ships KEY= — Number("") is 0)', () => {
		expect(notifyThresholdMs({ UNOWN_NOTIFY_MS: "" })).toBe(120_000);
	});

	test("UNOWN_NOTIFY_MS overrides (0 allowed — the tests' instant lane)", () => {
		expect(notifyThresholdMs({ UNOWN_NOTIFY_MS: "0" })).toBe(0);
		expect(notifyThresholdMs({ UNOWN_NOTIFY_MS: "45000" })).toBe(45_000);
	});

	test("garbage and negatives fall back to the default", () => {
		expect(notifyThresholdMs({ UNOWN_NOTIFY_MS: "soon" })).toBe(120_000);
		expect(notifyThresholdMs({ UNOWN_NOTIFY_MS: "-5" })).toBe(120_000);
	});
});

// ---------------------------------------------------------------------------
// shouldNotifyOnAnswer — the arrival decision for a print session (pure)
// ---------------------------------------------------------------------------

describe("shouldNotifyOnAnswer", () => {
	const base = {
		elapsedMs: 300_000,
		thresholdMs: 120_000,
		gated: true,
		answer: { stopReason: "stop", text: "all tests pass" },
	};

	test("a long print session with a real answer pings", () => {
		expect(shouldNotifyOnAnswer(base)).toBe(true);
	});

	test("a short session never pings (the threshold is the whole point)", () => {
		expect(shouldNotifyOnAnswer({ ...base, elapsedMs: 119_999 })).toBe(false);
	});

	test("the boundary is inclusive — exactly the threshold pings", () => {
		expect(shouldNotifyOnAnswer({ ...base, elapsedMs: 120_000 })).toBe(true);
	});

	test("error and aborted endings are not arrivals (print mode prints nothing for them)", () => {
		expect(shouldNotifyOnAnswer({ ...base, answer: { stopReason: "error", text: "boom" } })).toBe(false);
		expect(shouldNotifyOnAnswer({ ...base, answer: { stopReason: "aborted", text: "…" } })).toBe(false);
	});

	test("an empty answer has nothing to announce", () => {
		expect(shouldNotifyOnAnswer({ ...base, answer: { stopReason: "stop", text: "" } })).toBe(false);
		expect(shouldNotifyOnAnswer({ ...base, answer: null })).toBe(false);
		expect(shouldNotifyOnAnswer({ ...base, answer: undefined })).toBe(false);
	});

	test("the gate (TTY/opt-out) is respected before anything else", () => {
		expect(shouldNotifyOnAnswer({ ...base, gated: false })).toBe(false);
	});
});
