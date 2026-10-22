/**
 * flights-core.test.ts — the pure First-flights core.
 *
 * Covers:
 *   - firstFlightCatalog: four flights, unique ids, prompt/summary relation,
 *     and the four summary lines pinned BYTE-FOR-BYTE (they are the setup
 *     wizard's output bytes — the golden CLI suite prints them, so any drift
 *     here is a user-visible regression).
 *   - flightsHandleKey: the full key-routing table for a 4-item catalog,
 *     selected clamping, and the count=0 guard.
 *
 * The catalog is pure data and the router is a pure function — no TTY, no
 * imports beyond the module under test (that is the point of flights-core.ts).
 */
import "./_env.ts";
import { describe, expect, test } from "bun:test";
import { firstFlightCatalog, flightsHandleKey } from "../src/flights-core.ts";

// The setup-summary bytes, hardcoded from the spec (and the pre-existing
// setup.ts firstFlightCatalog): double-quoted prompts, and TWO spaces before
// the "(or run: …)" suffix on the middle two entries.
const PINNED_SUMMARIES: string[] = [
        '"explain how unown\'s memory tiers work"',
        '"generate an AGENTS.md for this repo"  (or run: unown init-agents)',
        '"open the dashboard and walk me through it"  (or run: unown dashboard)',
        '"run unown doctor and explain anything yellow"',
];

describe("firstFlightCatalog", () => {
        test("four flights; ids unique and non-empty; prompts non-empty", () => {
                const catalog = firstFlightCatalog();
                expect(catalog.length).toBe(4);
                const ids = catalog.map((f) => f.id);
                expect(new Set(ids).size).toBe(4);
                for (const id of ids) expect(id.length).toBeGreaterThan(0);
                for (const f of catalog) expect(f.prompt.length).toBeGreaterThan(0);
        });

        test("summaries are byte-identical to the setup-wizard lines (pinned)", () => {
                expect(firstFlightCatalog().map((f) => f.summary)).toEqual(PINNED_SUMMARIES);
        });

        test("prompt is the quoted text of its summary (suffix entries: substring)", () => {
                const catalog = firstFlightCatalog();
                // Entries without the "(or run: …)" suffix: the summary is
                // exactly the prompt wrapped in double quotes.
                for (const i of [0, 3]) {
                        expect(catalog[i].summary).toBe(`"${catalog[i].prompt}"`);
                }
                // Every summary carries its prompt; the middle two append the
                // two-space "(or run: …)" hint after the closing quote.
                for (const f of catalog) {
                        expect(f.summary).toContain(f.prompt);
                }
                for (const i of [1, 2]) {
                        expect(catalog[i].summary.startsWith(`"${catalog[i].prompt}"  (or run: `)).toBe(true);
                }
        });

        test("the full catalog shape is pinned (ids/titles/blurbs/prompts/summaries)", () => {
                expect(firstFlightCatalog()).toEqual([
                        {
                                id: "memory",
                                title: "How unown's memory works",
                                blurb: "explain how unown's memory tiers work",
                                prompt: "explain how unown's memory tiers work",
                                summary: '"explain how unown\'s memory tiers work"',
                        },
                        {
                                id: "agents-md",
                                title: "Generate an AGENTS.md",
                                blurb: "scaffold repo docs for future agents (or run: unown init-agents)",
                                prompt: "generate an AGENTS.md for this repo",
                                summary: '"generate an AGENTS.md for this repo"  (or run: unown init-agents)',
                        },
                        {
                                id: "dashboard",
                                title: "Open the dashboard",
                                blurb: "boot it and walk me through it (or run: unown dashboard)",
                                prompt: "open the dashboard and walk me through it",
                                summary: '"open the dashboard and walk me through it"  (or run: unown dashboard)',
                        },
                        {
                                id: "doctor",
                                title: "Run a health check",
                                blurb: "run unown doctor and explain anything yellow",
                                prompt: "run unown doctor and explain anything yellow",
                                summary: '"run unown doctor and explain anything yellow"',
                        },
                ]);
        });

        test("pure data: a fresh array of fresh objects on every call", () => {
                const poisoned = firstFlightCatalog();
                poisoned.pop();
                poisoned[0].title = "mutated";
                const again = firstFlightCatalog();
                expect(again.length).toBe(4);
                expect(again[0].title).toBe("How unown's memory works");
        });
});

describe("flightsHandleKey", () => {
        const COUNT = 4;

        test('digits "1".."3" pick 0..2; "4" picks 3; "5".."9" are out of range → none', () => {
                for (let n = 1; n <= 3; n++) {
                        expect(flightsHandleKey(String(n), 0, COUNT)).toEqual({
                                action: { type: "pick", index: n - 1 },
                                selected: n - 1,
                        });
                }
                expect(flightsHandleKey("4", 0, COUNT)).toEqual({ action: { type: "pick", index: 3 }, selected: 3 });
                // a digit pick also MOVES the selection to the picked card
                expect(flightsHandleKey("1", 2, COUNT)).toEqual({ action: { type: "pick", index: 0 }, selected: 0 });
                for (let n = 5; n <= 9; n++) {
                        expect(flightsHandleKey(String(n), 2, COUNT)).toEqual({ action: { type: "none" }, selected: 2 });
                }
        });

        test('"\\r" and "\\n" (Enter) pick the selected card', () => {
                for (const key of ["\r", "\n"]) {
                        expect(flightsHandleKey(key, 2, COUNT)).toEqual({ action: { type: "pick", index: 2 }, selected: 2 });
                }
        });

        test('Up/"\\x1b[A" and "k" decrement, clamped at 0 (no wrap)', () => {
                for (const key of ["\x1b[A", "k"]) {
                        expect(flightsHandleKey(key, 2, COUNT)).toEqual({ action: { type: "move", delta: -1 }, selected: 1 });
                        expect(flightsHandleKey(key, 0, COUNT)).toEqual({ action: { type: "move", delta: -1 }, selected: 0 });
                }
        });

        test('Down/"\\x1b[B" and "j" increment, clamped at count-1 (no wrap)', () => {
                for (const key of ["\x1b[B", "j"]) {
                        expect(flightsHandleKey(key, 1, COUNT)).toEqual({ action: { type: "move", delta: 1 }, selected: 2 });
                        expect(flightsHandleKey(key, 3, COUNT)).toEqual({ action: { type: "move", delta: 1 }, selected: 3 });
                }
        });

        test('bare Esc ("\\x1b") and "q" dismiss', () => {
                for (const key of ["\x1b", "q"]) {
                        expect(flightsHandleKey(key, 1, COUNT)).toEqual({ action: { type: "dismiss" }, selected: 1 });
                }
        });

        test('"x"/"X" mean never-again', () => {
                for (const key of ["x", "X"]) {
                        expect(flightsHandleKey(key, 1, COUNT)).toEqual({ action: { type: "never-again" }, selected: 1 });
                }
        });

        test('unmapped keys ("a"/"Z"/"\\t"/"") are none', () => {
                for (const key of ["a", "Z", "\t", ""]) {
                        expect(flightsHandleKey(key, 2, COUNT)).toEqual({ action: { type: "none" }, selected: 2 });
                }
        });

        test("selected is always clamped into [0, count-1]", () => {
                expect(flightsHandleKey("a", -2, COUNT)).toEqual({ action: { type: "none" }, selected: 0 });
                expect(flightsHandleKey("a", 99, COUNT)).toEqual({ action: { type: "none" }, selected: 3 });
                expect(flightsHandleKey("9", 99, COUNT)).toEqual({ action: { type: "none" }, selected: 3 });
                // active keys clamp too: Enter picks the clamped index
                expect(flightsHandleKey("\r", -2, COUNT)).toEqual({ action: { type: "pick", index: 0 }, selected: 0 });
                expect(flightsHandleKey("\r", 99, COUNT)).toEqual({ action: { type: "pick", index: 3 }, selected: 3 });
        });

        test("count=0: every key is none and selected passes through unchanged", () => {
                for (const key of ["1", "4", "9", "\r", "\n", "\x1b[A", "\x1b[B", "k", "j", "\x1b", "q", "x", "a", ""]) {
                        expect(flightsHandleKey(key, 0, 0)).toEqual({ action: { type: "none" }, selected: 0 });
                        expect(flightsHandleKey(key, 7, 0)).toEqual({ action: { type: "none" }, selected: 7 });
                }
        });
});
