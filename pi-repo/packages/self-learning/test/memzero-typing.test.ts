/**
 * memzero-typing.test.ts — memory typing with per-type decay (Memory v2 round).
 *
 * The field has moved past "one memory type" — Supermemory's typed
 * auto-forgetting (facts persist, preferences strengthen, episodes decay),
 * MemOS's L1→L2→L3→skills tiering, and LangMem's semantic/episodic/procedural
 * taxonomy all give each memory type a different decay policy. This suite pins
 * the contract: the type is read from metadata.type (default "fact"), each
 * type has its own stale horizon, the freshness stamp uses the per-type
 * horizon, and the health card's typeBreakdown counts them.
 */
import { test, expect } from "bun:test";
import {
        MEM0_CUSTOM_INSTRUCTIONS,
        MEMORY_TYPES,
        type MemoryType,
        type PlatformMemory,
        memoryFreshnessStamp,
        memoryType,
        mem0StaleDaysForType,
} from "../src/memzero.ts";
import { countByType } from "../src/memory-health.ts";

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0); // 2026-11-12T12:00:00Z

function mem(text: string, type: MemoryType | undefined, ageDays: number): PlatformMemory {
        const ts = new Date(NOW - ageDays * 86_400_000).toISOString();
        return {
                id: `mem-${type ?? "default"}-${ageDays}`,
                text,
                updatedAt: ts,
                createdAt: ts,
                metadata: type ? { type } : {},
        };
}

// ------------------------------------------------------------- the type

test("memoryType reads metadata.type (default 'fact' for backward compat)", () => {
        expect(memoryType({ id: "a", text: "x", metadata: { type: "episode" } } as PlatformMemory)).toBe("episode");
        expect(memoryType({ id: "a", text: "x", metadata: { type: "procedure" } } as PlatformMemory)).toBe("procedure");
        expect(memoryType({ id: "a", text: "x", metadata: { type: "preference" } } as PlatformMemory)).toBe("preference");
        expect(memoryType({ id: "a", text: "x", metadata: { type: "fact" } } as PlatformMemory)).toBe("fact");
        expect(memoryType({ id: "a", text: "x", metadata: {} } as PlatformMemory)).toBe("fact");
        expect(memoryType({ id: "a", text: "x", metadata: undefined } as PlatformMemory)).toBe("fact");
        // invalid type → fact (the default)
        expect(memoryType({ id: "a", text: "x", metadata: { type: "bogus" } } as PlatformMemory)).toBe("fact");
});

test("MEMORY_TYPES lists the four types", () => {
        expect(MEMORY_TYPES).toEqual(["fact", "episode", "procedure", "preference"]);
});

// ------------------------------------------------------- per-type decay

test("mem0StaleDaysForType returns per-type horizons (episode < fact < procedure < preference)", () => {
        const ep = mem0StaleDaysForType("episode");
        const fact = mem0StaleDaysForType("fact");
        const proc = mem0StaleDaysForType("procedure");
        const pref = mem0StaleDaysForType("preference");
        expect(ep).toBeLessThanOrEqual(fact); // episodes decay fastest
        expect(fact).toBeLessThanOrEqual(proc); // facts < procedures
        expect(proc).toBeLessThanOrEqual(pref); // procedures < preferences
});

test("mem0StaleDaysForType respects PI_MEM0_STALE_DAYS_<TYPE> env override", () => {
        process.env.PI_MEM0_STALE_DAYS_EPISODE = "7";
        expect(mem0StaleDaysForType("episode")).toBe(7);
        delete process.env.PI_MEM0_STALE_DAYS_EPISODE;
        // falls back to the default
        expect(mem0StaleDaysForType("episode")).toBe(14);
});

// ----------------------------------------------------- the freshness stamp

test("memoryFreshnessStamp uses per-type decay: an episode goes stale at 14d, a preference at 180d", () => {
        // 15-day-old episode → stale (14d horizon)
        const episode = mem("the build broke on Tuesday", "episode", 15);
        expect(memoryFreshnessStamp(episode, NOW)).toContain("stale");
        // 15-day-old preference → NOT stale (180d horizon)
        const preference = mem("comments in sentence case", "preference", 15);
        expect(memoryFreshnessStamp(preference, NOW)).not.toContain("stale");
        // 15-day-old fact → NOT stale (28d horizon)
        const fact = mem("node version is 20", "fact", 15);
        expect(memoryFreshnessStamp(fact, NOW)).not.toContain("stale");
        // 100-day-old procedure → NOT stale (90d horizon... wait, 100 > 90 → stale)
        const proc = mem("to deploy: first X then Y", "procedure", 100);
        expect(memoryFreshnessStamp(proc, NOW)).toContain("stale");
});

test("memoryFreshnessStamp: a 95-day-old preference is NOT stale (180d horizon)", () => {
        const pref = mem("commit messages under 72 chars", "preference", 95);
        expect(memoryFreshnessStamp(pref, NOW)).not.toContain("stale");
});

test("memoryFreshnessStamp: backward compat — a memory without type uses the fact horizon (28d)", () => {
        const m = mem("some fact", undefined, 30); // 30d old, no type → fact (28d)
        expect(memoryFreshnessStamp(m, NOW)).toContain("stale");
});

// ------------------------------------------------------- the health card

test("countByType counts memories by type", () => {
        const memories: PlatformMemory[] = [
                { id: "1", text: "a", metadata: { type: "fact" } },
                { id: "2", text: "b", metadata: { type: "fact" } },
                { id: "3", text: "c", metadata: { type: "episode" } },
                { id: "4", text: "d", metadata: { type: "procedure" } },
                { id: "5", text: "e", metadata: { type: "preference" } },
                { id: "6", text: "f", metadata: {} }, // no type → fact
        ];
        const counts = countByType(memories);
        expect(counts.fact).toBe(3); // 2 explicit + 1 default
        expect(counts.episode).toBe(1);
        expect(counts.procedure).toBe(1);
        expect(counts.preference).toBe(1);
});

test("countByType handles an empty scope", () => {
        const counts = countByType([]);
        expect(counts.fact).toBe(0);
        expect(counts.episode).toBe(0);
        expect(counts.procedure).toBe(0);
        expect(counts.preference).toBe(0);
});

// ------------------------------------------------------- the extraction prompt

test("MEM0_CUSTOM_INSTRUCTIONS teaches the type field with all four types", () => {
        expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("type");
        expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("fact");
        expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("episode");
        expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("procedure");
        expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("preference");
        // the per-type decay horizons are documented
        expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("14d");
        expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("180d");
});
