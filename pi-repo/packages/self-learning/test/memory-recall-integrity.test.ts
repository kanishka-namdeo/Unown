/**
 * memory-recall-integrity.test.ts — the recall-integrity seal + the
 * per-type render budget (Memory Divertimento round, 2026-11-14).
 *
 * Two contract groups, both fixing what the in-repo audit found:
 *
 *   A. THE SEAL: superseded memories never answer a recall as if current.
 *      `filterLatestOnly` used to run ONLY inside the render — `/memory
 *      search` and `GET /api/memories` returned invalidated memories bare,
 *      the exact soft-delete-leak class MIRIX's 2026-11-09 security review
 *      fixed (deleted memories still searchable). Now: search excludes them
 *      by default (latest_only=1), latest_only=0 opts IN for the audit view,
 *      and the unfiltered LIST (no q) stays whole — an inspection surface.
 *
 *   B. THE BUDGET: the per-type render budget replaces the flat cap (the v2
 *      round's CP2 goal, finally shipped). PI_MEM0_MAX_RENDERED stays the
 *      TOTAL; shares split it per type with a waterfall; a single-type store
 *      (the untyped back-compat case) behaves exactly like the old flat cap.
 *      The typed sections (Preferences/Episodes) render in the right order,
 *      and the render footer carries the per-type kept/pruned fragment.
 */
import "./_env.ts";
import { afterEach, describe, expect, test } from "bun:test";
import {
        allocateTypeBudget,
        filterLatestOnly,
        renderProjectMemoryMarkdown,
        renderTypeShares,
        RENDER_TYPE_SHARES,
        searchAcrossScopes,
        searchMemories,
        ENGINE_SCOPE,
        type PlatformMemory,
} from "../src/memzero.ts";
import { makeFakePlatform } from "./_fake-platform.ts";

afterEach(() => {
        delete process.env.PI_MEM0_RENDER_SHARE_FACT;
        delete process.env.PI_MEM0_RENDER_SHARE_EPISODE;
        delete process.env.PI_MEM0_RENDER_SHARE_PROCEDURE;
        delete process.env.PI_MEM0_RENDER_SHARE_PREFERENCE;
        delete process.env.PI_MEM0_MAX_RENDERED;
});

// --------------------------------------------------------------- part A — the seal

function seededPlatform() {
        const platform = makeFakePlatform();
        platform.seed([
                { id: "live-1", text: "the parser treats columns as 1-based offsets", metadata: { kind: "terminal-note", agent_id: "unown-engine" } },
                {
                        id: "dead-1",
                        text: "the parser treats columns as 0-based offsets",
                        metadata: {
                                kind: "terminal-note",
                                agent_id: "unown-engine",
                                supersededBy: "live-1",
                                invalidAt: "2026-11-10T00:00:00.000Z",
                        },
                },
        ]);
        return platform;
}

describe("searchMemories — the recall-integrity seal", () => {
        test("default excludes superseded memories from search results (was: leaked bare)", async () => {
                const platform = seededPlatform();
                const hits = await searchMemories("parser columns offsets", ENGINE_SCOPE, 8, { platform });
                expect(hits.some((m) => m.id === "live-1")).toBe(true);
                expect(hits.some((m) => m.id === "dead-1")).toBe(false);
        });

        test("latestOnly:false opts IN — the audit view returns them, for the caller to badge", async () => {
                const platform = seededPlatform();
                const hits = await searchMemories("parser columns offsets", ENGINE_SCOPE, 8, { platform, latestOnly: false });
                expect(hits.some((m) => m.id === "dead-1")).toBe(true);
                expect(hits.find((m) => m.id === "dead-1")?.metadata?.supersededBy).toBe("live-1");
        });
});

describe("searchAcrossScopes — the seal holds on the fan-out lane", () => {
        const SCOPES = [{ scope: ENGINE_SCOPE, label: "engine" }];

        test("default excludes superseded; latestOnly:false includes them", async () => {
                const platform = seededPlatform();
                const sealed = await searchAcrossScopes("parser columns offsets", SCOPES, 8, { platform });
                expect(sealed.some((m) => m.id === "dead-1")).toBe(false);
                const audit = await searchAcrossScopes("parser columns offsets", SCOPES, 8, { platform, latestOnly: false });
                expect(audit.some((m) => m.id === "dead-1")).toBe(true);
        });
});

describe("GET /api/memories — the latest_only query param", () => {
        const REQ = { method: "GET", query: new URLSearchParams(), body: null as any };

        test("search (q) excludes superseded by default; latest_only=0 opts IN; the no-q LIST stays whole", async () => {
                const { handleApi } = await import("../src/server.ts");
                const { setMemoryPlatformForTests } = await import("../src/memzero.ts");
                const platform = seededPlatform();
                setMemoryPlatformForTests(platform);
                try {
                        // q + default: the seal
                        const sealed = await handleApi({ ...REQ, path: "/api/memories", query: new URLSearchParams("q=parser") });
                        const sealedBody = (await sealed.json()) as Record<string, any>;
                        expect(sealedBody.memories.some((m: any) => m.id === "dead-1")).toBe(false);
                        expect(sealedBody.latestOnly).toBe(true);
                        // q + latest_only=0: the audit view
                        const audit = await handleApi({
                                ...REQ,
                                path: "/api/memories",
                                query: new URLSearchParams("q=parser&latest_only=0"),
                        });
                        const auditBody = (await audit.json()) as Record<string, any>;
                        expect(auditBody.memories.some((m: any) => m.id === "dead-1")).toBe(true);
                        expect(auditBody.latestOnly).toBe(false);
                        // no q: the LIST is an inspection surface — whole, superseded included
                        const list = await handleApi({ ...REQ, path: "/api/memories", query: new URLSearchParams() });
                        const listBody = (await list.json()) as Record<string, any>;
                        expect(listBody.memories.length).toBe(2);
                        expect(listBody.latestOnly).toBeUndefined();
                } finally {
                        setMemoryPlatformForTests(null);
                }
        });

        test("the across lane honors latest_only the same way", async () => {
                const { handleApi } = await import("../src/server.ts");
                const { setMemoryPlatformForTests, knownProjectScopes } = await import("../src/memzero.ts");
                const { store } = await import("../src/store.ts");
                // the across lane needs a dreamed project scope to exist
                store.run(`DELETE FROM memory_versions WHERE tier LIKE 'project:%'`);
                store.run(
                        `INSERT INTO memory_versions (tier, version, content, changed_by, note, created_at) VALUES ('project:across-1', 1, '# a', 'mem0', 'test', ?)`,
                        [Date.now()],
                );
                const platform = seededPlatform();
                setMemoryPlatformForTests(platform);
                try {
                        const sealed = await handleApi({
                                ...REQ,
                                path: "/api/memories",
                                query: new URLSearchParams("across=1&q=parser"),
                        });
                        const sealedBody = (await sealed.json()) as Record<string, any>;
                        expect(sealedBody.memories.some((m: any) => m.id === "dead-1")).toBe(false);
                        expect(sealedBody.latestOnly).toBe(true);
                        const audit = await handleApi({
                                ...REQ,
                                path: "/api/memories",
                                query: new URLSearchParams("across=1&q=parser&latest_only=0"),
                        });
                        const auditBody = (await audit.json()) as Record<string, any>;
                        expect(auditBody.memories.some((m: any) => m.id === "dead-1")).toBe(true);
                } finally {
                        setMemoryPlatformForTests(null);
                        store.run(`DELETE FROM memory_versions WHERE tier LIKE 'project:%'`);
                }
        });
});

// ------------------------------------------------------------- part B — the budget

describe("allocateTypeBudget — the waterfall math", () => {
        test("a single-type store gets the whole cap (the untyped back-compat case)", () => {
                // 200 facts, nothing else, total 110: the waterfall returns every
                // unused share to fact — byte-compat with the old flat cap
                const alloc = allocateTypeBudget({ fact: 200, episode: 0, procedure: 0, preference: 0 }, 110);
                expect(alloc.fact).toBe(110);
                expect(alloc.episode + alloc.procedure + alloc.preference).toBe(0);
        });

        test("a mixed store at the cap: share floors + the pool goes to the largest demand in priority order", () => {
                const counts = { fact: 200, episode: 40, procedure: 50, preference: 10 };
                const alloc = allocateTypeBudget(counts, 110);
                // floors: fact 44, procedure 27, preference 22, episode 16 (sum 109)
                // preference returns its surplus (10 < 22 → 12 back); pool 1+12=13 → fact (first in order)
                expect(alloc).toEqual({ fact: 57, procedure: 27, preference: 10, episode: 16 });
                expect(alloc.fact + alloc.procedure + alloc.preference + alloc.episode).toBe(110);
        });

        test("a store smaller than the cap renders whole — leftover pool stays unused", () => {
                const alloc = allocateTypeBudget({ fact: 3, episode: 2, procedure: 0, preference: 0 }, 110);
                expect(alloc).toEqual({ fact: 3, episode: 2, procedure: 0, preference: 0 });
        });

        test("a share of 0 never renders that type (the episode lane can be zeroed)", () => {
                process.env.PI_MEM0_RENDER_SHARE_EPISODE = "0";
                process.env.PI_MEM0_RENDER_SHARE_FACT = "80";
                process.env.PI_MEM0_RENDER_SHARE_PROCEDURE = "20";
                delete process.env.PI_MEM0_RENDER_SHARE_PREFERENCE;
                process.env.PI_MEM0_RENDER_SHARE_PREFERENCE = "0";
                const alloc = allocateTypeBudget({ fact: 200, episode: 40, procedure: 50, preference: 10 }, 100);
                expect(alloc.episode).toBe(0);
                expect(alloc.preference).toBe(0);
                expect(alloc.fact + alloc.procedure).toBe(100);
        });
});

describe("renderTypeShares — env overrides + normalization", () => {
        test("defaults sum to 100", () => {
                const shares = renderTypeShares();
                expect(shares.fact + shares.episode + shares.procedure + shares.preference).toBe(100);
                expect(shares).toEqual(RENDER_TYPE_SHARES);
        });

        test("an over-100 total scales every share down proportionally", () => {
                process.env.PI_MEM0_RENDER_SHARE_FACT = "80";
                process.env.PI_MEM0_RENDER_SHARE_EPISODE = "40";
                process.env.PI_MEM0_RENDER_SHARE_PROCEDURE = "40";
                process.env.PI_MEM0_RENDER_SHARE_PREFERENCE = "40"; // sum 200
                const shares = renderTypeShares();
                expect(shares.fact + shares.episode + shares.procedure + shares.preference).toBe(100);
                expect(shares.fact).toBe(40); // 80/200*100
        });
});

describe("renderProjectMemoryMarkdown — the per-type budget in the render", () => {
        const NOW = Date.parse("2026-11-14T12:00:00.000Z");
        function mem(id: string, text: string, type?: string, updatedAt = "2026-11-13T10:00:00.000Z"): PlatformMemory {
                return { id, text, updatedAt, createdAt: updatedAt, metadata: type ? { kind: "terminal-note", type } : { kind: "terminal-note" } };
        }

        test("typed memories render under Preferences/Episodes in the right order (Episodes last)", () => {
                const out = renderProjectMemoryMarkdown(
                        [
                                mem("f1", "the build needs bun 1.4"),
                                { ...mem("pf1", "never commit directly to main; always open a PR"), metadata: { kind: "terminal-note", type: "preference" } },
                                { ...mem("ep1", "the flaky CI run on 2026-11-02 was the runner, not the suite"), metadata: { kind: "terminal-note", type: "episode" } },
                                mem("pp1", "to release: run the suite, bump the version, tag, push", "procedure"),
                        ],
                        { now: NOW },
                );
                const prefAt = out.indexOf("## Preferences");
                const envAt = out.indexOf("## Environment"); // absent section returns -1 — order check via others
                const verifiedAt = out.indexOf("## Verified fixes"); // may be absent
                const factsAt = out.indexOf("## Facts");
                const episodesAt = out.indexOf("## Episodes");
                expect(prefAt).toBeGreaterThan(0);
                expect(episodesAt).toBeGreaterThan(0);
                expect(prefAt).toBeLessThan(episodesAt);
                // Facts (if present) precedes Episodes; absent sections just skip
                if (factsAt > 0) expect(factsAt).toBeLessThan(episodesAt);
                if (envAt > 0) expect(envAt).toBeLessThan(prefAt);
                if (verifiedAt > 0) expect(verifiedAt).toBeLessThan(episodesAt);
                expect(out).toContain("never commit directly to main");
                expect(out).toContain("the flaky CI run");
        });

        test("a single-type (all-fact) store at the cap keeps every slot — the flat-cap back-compat", () => {
                process.env.PI_MEM0_MAX_RENDERED = "110";
                const facts: PlatformMemory[] = [];
                for (let i = 0; i < 110; i++) facts.push(mem(`f${i}`, `fact number ${i} about the parser offsets`));
                const out = renderProjectMemoryMarkdown(facts, { now: NOW });
                // all 110 rendered (the waterfall gives fact the whole cap)
                const bullets = out.split("\n").filter((l) => l.startsWith("- ")).length;
                expect(bullets).toBe(110);
                expect(out).not.toContain("pruned");
        });

        test("an over-cap store prunes per type and the footer says which type lost the slot", () => {
                process.env.PI_MEM0_MAX_RENDERED = "100";
                const memories: PlatformMemory[] = [];
                for (let i = 0; i < 120; i++) memories.push(mem(`f${i}`, `fact number ${i} about the parser offsets`));
                for (let i = 0; i < 30; i++)
                        memories.push({ ...mem(`e${i}`, `episode ${i} of the flaky runner`), metadata: { kind: "terminal-note", type: "episode" } });
                const out = renderProjectMemoryMarkdown(memories, { now: NOW });
                expect(out).toContain("per-type budget (cap 100)");
                expect(out).toMatch(/pruned \d+f · \d+p · \d+pf · \d+e/);
                // floors: fact 40, procedure 25, preference 20, episode 15 (sum 100, pool 0);
                // pass 1: procedure and preference return their whole allocation (no candidates)
                // → pool 45; pass 2 (priority order): fact takes all 45 → fact 85, episode 15.
                // The waterfall never strands the cap: 85 + 15 = 100 slots used.
                const bullets = out.split("\n").filter((l) => l.startsWith("- ")).length;
                expect(bullets).toBe(100);
                expect(out).toContain("pruned 35f · 0p · 0pf · 15e");
        });

        test("the footer stays quiet on a no-drop, all-fact render (the compat case has no noise)", () => {
                const out = renderProjectMemoryMarkdown([mem("f1", "one fact about the parser")], { now: NOW });
                expect(out).not.toContain("per-type budget");
        });
});
