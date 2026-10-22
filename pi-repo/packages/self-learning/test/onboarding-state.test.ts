/**
 * onboarding-state.test.ts — the persistent onboarding latch
 * (<UNOWN_HOME>/onboarding.json, schema 1).
 *
 * Covers: default-on-error reads (missing / corrupt / wrong-or-absent
 * schema — never a throw), the write→read round-trip with the exact 2-space
 * JSON + trailing-newline bytes, the home override (+ the module UNOWN_HOME
 * default), atomic writes (no leftover *.tmp), nested-parent creation, and
 * the never-throws read posture against hostile paths/content.
 *
 * State isolation: every case passes its own mkdtemp'd home EXPLICITLY —
 * never process.env.UNOWN_HOME (the shared suite redirect) — so these tests
 * stay hermetic whatever env they run under.
 */
import "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UNOWN_HOME } from "../src/term.ts";
import {
        defaultOnboardingState,
        type OnboardingState,
        onboardingStatePath,
        readOnboardingState,
        writeOnboardingState,
} from "../src/onboarding-state.ts";

const TMP = mkdtempSync(join(tmpdir(), "unown-onboarding-state-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** A fresh isolated home per case (under the suite tmp root, cleaned once). */
function tempHome(): string {
        return mkdtempSync(join(TMP, "home-"));
}

describe("readOnboardingState (default-on-error, never throws)", () => {
        test("missing file → default state", () => {
                const home = tempHome();
                expect(readOnboardingState(home)).toEqual(defaultOnboardingState());
                expect(readOnboardingState(home)).toEqual({ schema: 1, flightsDismissed: false, tipsSeen: [] });
        });

        test("corrupt JSON (\"{oops\") → default state", () => {
                const home = tempHome();
                writeFileSync(onboardingStatePath(home), "{oops", "utf8");
                expect(readOnboardingState(home)).toEqual(defaultOnboardingState());
        });

        test("schema 2 → default state", () => {
                const home = tempHome();
                writeFileSync(onboardingStatePath(home), JSON.stringify({ schema: 2, flightsDismissed: true, tipsSeen: ["a"] }), "utf8");
                expect(readOnboardingState(home)).toEqual(defaultOnboardingState());
        });

        test("schema absent → default state", () => {
                const home = tempHome();
                writeFileSync(onboardingStatePath(home), JSON.stringify({ flightsDismissed: true, tipsSeen: ["a"] }), "utf8");
                expect(readOnboardingState(home)).toEqual(defaultOnboardingState());
        });

        test("schema-1 payload with wrong-typed fields is normalized, not fatal", () => {
                const home = tempHome();
                writeFileSync(
                        onboardingStatePath(home),
                        JSON.stringify({ schema: 1, flightsDismissed: "yes", firstTaskAt: "not-a-date", tipsSeen: "nope" }),
                        "utf8",
                );
                expect(readOnboardingState(home)).toEqual({ schema: 1, flightsDismissed: false, tipsSeen: [] });
        });

        test("a directory sitting at the file path → default state, no throw", () => {
                const home = tempHome();
                mkdirSync(onboardingStatePath(home), { recursive: true });
                expect(readOnboardingState(home)).toEqual(defaultOnboardingState());
        });

        test("null-byte garbage content → default state, no throw", () => {
                const home = tempHome();
                writeFileSync(onboardingStatePath(home), "\u0000\u0001 not json \ufffd", "utf8");
                expect(readOnboardingState(home)).toEqual(defaultOnboardingState());
        });
        // NOTE: a chmod-000 file is NOT simulated — this suite may run as root
        // (root reads straight through mode 000), so the case is not portable.
});

describe("writeOnboardingState / round-trip", () => {
        test("write → read equals; file is valid JSON, 2-space indented, trailing newline", () => {
                const home = tempHome();
                const state: OnboardingState = {
                        schema: 1,
                        flightsDismissed: true,
                        firstTaskAt: "2026-10-22T10:00:00.000Z",
                        tipsSeen: ["a"],
                };
                writeOnboardingState(state, home);
                expect(readOnboardingState(home)).toEqual(state);
                const content = readFileSync(onboardingStatePath(home), "utf8");
                expect(content).toBe(`${JSON.stringify(state, null, 2)}\n`);
                expect(content).toContain('\n  "schema": 1'); // the 2-space indent
                expect(JSON.parse(content)).toEqual(state); // valid JSON
        });

        test("atomic: no leftover *.tmp files in the target dir after writes", () => {
                const home = tempHome();
                writeOnboardingState(defaultOnboardingState(), home);
                // a second write exercises the rename-over-existing path
                writeOnboardingState({ schema: 1, flightsDismissed: true, tipsSeen: [] }, home);
                const leftovers = readdirSync(home).filter((name) => name.endsWith(".tmp"));
                expect(leftovers).toEqual([]);
                expect(readOnboardingState(home).flightsDismissed).toBe(true); // last write won
        });

        test("creates nested parent dirs when missing", () => {
                const home = join(tempHome(), "nested", "deeper");
                expect(existsSync(home)).toBe(false);
                writeOnboardingState(defaultOnboardingState(), home);
                expect(existsSync(onboardingStatePath(home))).toBe(true);
                expect(readOnboardingState(home)).toEqual(defaultOnboardingState());
        });
});

describe("onboardingStatePath (home override + module default)", () => {
        test("explicit home joins <home>/onboarding.json", () => {
                const home = tempHome();
                expect(onboardingStatePath(home)).toBe(join(home, "onboarding.json"));
        });

        test("no home → the module UNOWN_HOME (term.ts) is used", () => {
                expect(onboardingStatePath()).toBe(join(UNOWN_HOME, "onboarding.json"));
        });
});
