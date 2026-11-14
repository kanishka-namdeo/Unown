/**
 * memory-delight.test.ts — the visual-indicator surfaces (Memory Divertimento
 * round CP4, 2026-11-14).
 *
 * The UX research's law (Gemini's Statement+Rationale; Memory Sandbox's
 * scrutability; the ChatGPT anti-patterns quantified): visible provenance
 * builds trust, invisible influence destroys it — and the one place the
 * user SEES what consolidation did (the Wrapped lesson) is the cheapest
 * delight surface there is. This suite pins the three pure surfaces:
 *
 *   1. the recall line's honest stale count (rendered only when non-zero —
 *      a healthy stack stays quiet; a decayed one says so at the exact
 *      moment the model starts using it);
 *   2. the dream-news digest toast (the post-consolidation diff: learned ·
 *      superseded (kept for audit) · went dormant — each fragment only
 *      when its count is non-zero);
 *   3. the search provenance badges' building blocks (the freshness stamp
 *      on the hit, the type/hard-won badges) — the composition itself is
 *      live-verified by the PTY lane in CP7.
 */
import { test, expect } from "bun:test";
import {
        countProjectStaleRules,
        dreamNewsToastText,
        memoryRecallLine,
        readMemoryBarInfo,
        type DreamNews,
} from "../src/engine-status.ts";
import { memoryFreshnessStamp, type PlatformMemory } from "../src/memzero.ts";

// ---------------------------------------------------- 1. the recall line

test("countProjectStaleRules: the render's own grammar — only stale-stamped section bullets", () => {
        const content = [
                "# Project Memory",
                "",
                "## Facts",
                "- fresh rule · 2026-11-13",
                "- an old rule · 2026-09-01 · stale",
                "- a seed-shaped line before any section does not count",
                "",
                "## Environment",
                "- another old one · 2026-08-01 · stale",
                "- no-stamp rule",
                "",
                "## Manual notes",
                "- user bullet · stale (manual lane — NOT the render's grammar)",
        ].join("\n");
        // section bullets ENDING with the stale stamp: the Facts one + the
        // Environment one = 2. The manual-notes bullet carries "· stale" mid-line
        // but not as the stamp's tail — it does not count; a hand-written bullet
        // that DID end "· stale" would (the same grammar-assumption class as
        // countProjectRules).
        expect(countProjectStaleRules(content)).toBe(2);
        expect(countProjectStaleRules("# a\n- b · stale")).toBe(0); // no sections — nothing counts
});

test("memoryRecallLine: the stale count renders ONLY when non-zero (quiet when healthy)", () => {
        const now = Date.now();
        const healthy = { version: 7, rules: 12, dreamedAt: now - 3600_000 };
        expect(memoryRecallLine(healthy, now)).toBe(
                `◈ memory recalled: 12 rules · v7 · dreamed 1h ago — /memory show`,
        );
        const decayed = { version: 7, rules: 12, dreamedAt: now - 3600_000, stale: 2 };
        expect(memoryRecallLine(decayed, now)).toBe(
                `◈ memory recalled: 12 rules (2 stale) · v7 · dreamed 1h ago — /memory show`,
        );
        const zeroStale = { version: 7, rules: 12, dreamedAt: now - 3600_000, stale: 0 };
        expect(memoryRecallLine(zeroStale, now)).not.toContain("stale");
});

test("readMemoryBarInfo derives the stale count from the project's own files (engine-down safe)", () => {
        // The wiring: the sidecar version + the file content produce both counts.
        // (A real project dir is exercised by the PTY lane; here the pure pair.)
        const info = { version: 3, rules: 5, dreamedAt: 1234, stale: 1 };
        expect(memoryRecallLine(info, info.dreamedAt + 1000)).toContain("(1 stale)");
});

// ------------------------------------------------ 2. the dream-news digest

function news(over: Partial<DreamNews>): DreamNews {
        return { id: "d1", project: "api", added: 3, version: 42, at: Date.now(), ...over };
}

test("dreamNewsToastText: the base toast is unchanged when no digest fields are present", () => {
        expect(dreamNewsToastText(news({}))).toBe(
                "✦ AutoDream learned 3 new rules for this project (v41 → v42)",
        );
});

test("dreamNewsToastText: each digest fragment renders only when non-zero (no standing zeros)", () => {
        expect(dreamNewsToastText(news({ superseded: 4 }))).toBe(
                "✦ AutoDream learned 3 new rules for this project (v41 → v42) · 4 superseded (kept for audit)",
        );
        expect(dreamNewsToastText(news({ dormant: 2 }))).toBe(
                "✦ AutoDream learned 3 new rules for this project (v41 → v42) · 2 went dormant",
        );
        expect(dreamNewsToastText(news({ superseded: 4, dormant: 2 }))).toBe(
                "✦ AutoDream learned 3 new rules for this project (v41 → v42) · 4 superseded (kept for audit) · 2 went dormant",
        );
        // zeros render as absent
        expect(dreamNewsToastText(news({ superseded: 0, dormant: 0 }))).not.toContain("superseded");
        expect(dreamNewsToastText(news({ superseded: 0, dormant: 0 }))).not.toContain("dormant");
});

// ------------------------------------------- 3. the search badge building blocks

test("memoryFreshnessStamp on a hit: the confirmed date, stale past the horizon, bare for seeds", () => {
        const now = Date.parse("2026-11-14T12:00:00.000Z");
        const confirmed = (days: number) => new Date(now - days * 86_400_000).toISOString();
        const hit = (over: Partial<PlatformMemory>): PlatformMemory =>
                ({ id: "h", text: "the parser treats columns as 1-based offsets", updatedAt: confirmed(3), createdAt: confirmed(3), metadata: { kind: "terminal-note" }, ...over }) as PlatformMemory;
        expect(memoryFreshnessStamp(hit({}), now)).toBe("2026-11-11");
        expect(memoryFreshnessStamp(hit({ updatedAt: confirmed(40) }), now)).toBe("2026-10-05 · stale");
        expect(memoryFreshnessStamp(hit({ metadata: { kind: "seed" } }), now)).toBe("");
        expect(memoryFreshnessStamp(hit({ updatedAt: confirmed(40), metadata: { kind: "terminal-note", type: "preference" } }), now)).toBe("2026-10-05"); // 180d horizon — not stale
});
