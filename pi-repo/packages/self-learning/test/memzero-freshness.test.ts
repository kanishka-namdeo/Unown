// memzero-freshness.test.ts — the freshness lane (Memory Encore round,
// 2026-11-12).
//
// Every rendered memory bullet now carries the date it was last confirmed,
// with a `stale` marker past the horizon — the Claude Code per-memory
// modified-timestamp pattern ("helping Claude reason about which memories
// are fresh vs. stale", v2.1.75) and the soft, visible version of Copilot's
// 28-day memory TTL (their un-refreshed memories vanish; ours stay but are
// marked weaker evidence the guide tells the agent to verify first).
//
// This file pins the whole lane deterministically (no LLM, no bridge):
//   1. memoryFreshnessStamp — the pure suffix: date, date+stale, no-stamp
//      (unknown age, seeds), the horizon boundary, the env knob;
//   2. the render integration — bullets stamped, manual notes and seeds
//      never stamped, the stamp surviving the char-ceiling trim;
//   3. idempotence — the same memory set at the same clock renders
//      byte-identical (only an UPDATE verdict moves a date; the dream
//      no-change check must keep working);
//   4. the injection-budget interplay — a stamped stack still prunes to
//      budget with the visible marker (stamps are content, not chrome).
import "./_env.ts";
import { describe, expect, test } from "bun:test";
import {
        memoryConfirmedAt,
        memoryFreshnessStamp,
        mem0StaleDays,
        renderProjectMemoryMarkdown,
        renderFooterMatches,
        type PlatformMemory,
} from "../src/memzero.ts";

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0); // 2026-11-12T12:00:00Z
const DAY = 86_400_000;

function mem(opts: Partial<PlatformMemory> & { text: string }): PlatformMemory {
        return { id: opts.id ?? "m1", metadata: { kind: "note" }, ...opts } as PlatformMemory;
}

describe("memoryFreshnessStamp — the pure suffix", () => {
        test("a fresh memory renders its last-confirmed date", () => {
                const s = memoryFreshnessStamp(
                        mem({ text: "run tests with bun", updatedAt: new Date(NOW - 3 * DAY).toISOString() }),
                        NOW,
                );
                expect(s).toBe("2026-11-09");
        });

        test("a memory older than the horizon renders date · stale", () => {
                const s = memoryFreshnessStamp(
                        mem({ text: "legacy db path", updatedAt: new Date(NOW - 29 * DAY).toISOString() }),
                        NOW,
                );
                expect(s).toBe("2026-10-14 · stale");
        });

        test("the horizon boundary: 27d fresh, 28d+1ms stale (default 28)", () => {
                expect(memoryFreshnessStamp(mem({ text: "a", updatedAt: new Date(NOW - 27 * DAY).toISOString() }), NOW)).not.toContain("stale");
                expect(
                        memoryFreshnessStamp(mem({ text: "a", updatedAt: new Date(NOW - 28 * DAY - 1).toISOString() }), NOW),
                ).toContain("stale");
        });

        test("unknown age renders NO stamp — never a fake date, never a 1970-stale", () => {
                // no timestamps at all (legacy migrated rows)
                expect(memoryFreshnessStamp(mem({ text: "legacy" }), NOW)).toBe("");
                // unparseable timestamp strings must not fall through to 1970
                expect(memoryFreshnessStamp(mem({ text: "junk", updatedAt: "not-a-date" }), NOW)).toBe("");
                expect(memoryConfirmedAt(mem({ text: "junk", updatedAt: "not-a-date" }))).toBeNull();
        });

        test("seeds are exempt — the repo's scaffolding is instruction, not dated evidence", () => {
                const s = memoryFreshnessStamp(
                        mem({ text: "run the test suite before declaring success", metadata: { kind: "seed" }, updatedAt: new Date(NOW - 400 * DAY).toISOString() }),
                        NOW,
                );
                expect(s).toBe("");
        });

        test("updatedAt wins over createdAt (a re-asserted rule shows its refresh)", () => {
                const s = memoryFreshnessStamp(
                        mem({
                                text: "provider defaults live in .env",
                                createdAt: new Date(NOW - 90 * DAY).toISOString(),
                                updatedAt: new Date(NOW - 2 * DAY).toISOString(),
                        }),
                        NOW,
                );
                expect(s).toBe("2026-11-10"); // the refresh, not the origin
        });

        test("PI_MEM0_STALE_DAYS=0 disables the stale marker, dates still render", () => {
                const old = mem({ text: "old rule", updatedAt: new Date(NOW - 365 * DAY).toISOString() });
                const prev = process.env.PI_MEM0_STALE_DAYS;
                try {
                        process.env.PI_MEM0_STALE_DAYS = "0";
                        expect(mem0StaleDays()).toBe(0);
                        expect(memoryFreshnessStamp(old, NOW)).toBe("2025-11-12");
                } finally {
                        if (prev === undefined) delete process.env.PI_MEM0_STALE_DAYS;
                        else process.env.PI_MEM0_STALE_DAYS = prev;
                }
        });

        test("a future timestamp (clock skew) renders its date and is never stale", () => {
                const s = memoryFreshnessStamp(mem({ text: "skewed", updatedAt: new Date(NOW + DAY).toISOString() }), NOW);
                expect(s).toBe("2026-11-13");
        });
});

describe("renderProjectMemoryMarkdown — the stamped render", () => {
        const MEM: PlatformMemory[] = [
                mem({ id: "fresh", text: "run tests with bun test", updatedAt: new Date(NOW - 3 * DAY).toISOString() }),
                mem({ id: "old", text: "the legacy schema needs a manual migration", updatedAt: new Date(NOW - 60 * DAY).toISOString() }),
                mem({ id: "seed", text: "seed scaffolding rule", metadata: { kind: "seed" }, updatedAt: new Date(NOW - 300 * DAY).toISOString() }),
                mem({ id: "undated", text: "a legacy row with no timestamps" }),
        ];

        test("bullets carry their date; stale ones say so; seeds and unknown-age rows stay bare", () => {
                const out = renderProjectMemoryMarkdown(MEM, { backend: "lexical", now: NOW });
                expect(out).toContain("- run tests with bun test · 2026-11-09");
                expect(out).toContain("- the legacy schema needs a manual migration · 2026-09-13 · stale");
                expect(out).toContain("- seed scaffolding rule\n"); // no stamp
                expect(out).toContain("- a legacy row with no timestamps\n"); // no stamp
        });

        test("the Manual notes lane is NEVER stamped (user-authored, preserved verbatim)", () => {
                const previous = `# Project Memory\n\n## Manual notes\n- always run the formatter before committing\n`;
                const out = renderProjectMemoryMarkdown(MEM, { backend: "lexical", now: NOW, preserveManualNotesFrom: previous });
                expect(out).toContain("- always run the formatter before committing\n"); // verbatim, no date
        });

        test("IDEMPOTENCE: the same set at the same clock renders byte-identical (no-change dreams stay no-change)", () => {
                const a = renderProjectMemoryMarkdown(MEM, { backend: "lexical", now: NOW });
                const b = renderProjectMemoryMarkdown(MEM, { backend: "lexical", now: NOW });
                expect(a).toBe(b);
                // and the dream-side comparison shape (footer-timestamp-insensitive)
                // still agrees with itself under a different render clock
                const c = renderProjectMemoryMarkdown(MEM, { backend: "lexical", now: NOW + 5 * DAY });
                expect(renderFooterMatches(a, c)).toBe(true); // same memories: the 5-day clock shift alone is not a change
        });

        test("a re-asserted memory (UPDATE verdict) changes its rendered date — the refresh is visible", () => {
                const before = renderProjectMemoryMarkdown(
                        [mem({ id: "r", text: "use the lexical embedder in CI", updatedAt: new Date(NOW - 90 * DAY).toISOString() })],
                        { backend: "lexical", now: NOW },
                );
                const after = renderProjectMemoryMarkdown(
                        [mem({ id: "r", text: "use the lexical embedder in CI", updatedAt: new Date(NOW - 1 * DAY).toISOString() })],
                        { backend: "lexical", now: NOW },
                );
                expect(before).toContain("· stale");
                expect(after).toContain("· 2026-11-11");
                expect(after).not.toContain("· stale");
                expect(renderFooterMatches(before, after)).toBe(false); // the refresh IS a change
        });

        test("stamps are content: a stamped render at the char ceiling still converges under it", () => {
                // 130 wide memories — past the 110 bullet cap; each text is long
                // enough that stamps materially add chars. The render must still
                // land under the ceiling with the visible degradation marker.
                const wide: PlatformMemory[] = Array.from({ length: 130 }, (_, i) =>
                        mem({
                                id: `w-${i}`,
                                text: `rule number ${i} with a deliberately long body of text so the stamped render has real mass to trim ${"x".repeat(220)}`,
                                updatedAt: new Date(NOW - i * DAY).toISOString(),
                        }),
                );
                const out = renderProjectMemoryMarkdown(wide, { backend: "lexical", now: NOW });
                expect(out.length).toBeLessThanOrEqual(48_000);
                expect(out).toContain("oldest pruned at render");
                // and the surviving bullets are still stamped
                expect(out).toMatch(/- rule number \d+ with a deliberately long body.* · 20\d\d-\d\d-\d\d\n/);
        });
});
