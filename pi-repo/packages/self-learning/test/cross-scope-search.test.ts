// Unit tests for the cross-scope memory search (memzero.ts searchAcrossScopes
// + memory.ts knownProjectScopes) — the shared-memory recall surface of the
// 2026-10-22 consistency work.
//
// Pinned here:
//   1. one query fans out over engine + project scopes, results tagged with
//      their source scope, merged best-first;
//   2. a dead scope never kills the fan-out (partial results still ship);
//   3. the total limit is honored across the merged set;
//   4. knownProjectScopes lists dreamed composite project tiers and skips
//      legacy-superseded ones (their memories migrated onto the composite key);
//   5. (2026-11-10 round, F3) the HTTP scoped lane resolves a raw project
//      SLUG to its prefixed platform scope — `?agent_id=<slug>` used to
//      search a scope that does not exist and answer a silent empty set
//      (measured live: 0/2 memories through the slug, 2/2 through
//      `project:<slug>`); the explicit prefixed form and foreign agent ids
//      pass through unchanged.
import "./_env.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { searchAcrossScopes } from "../src/memzero.ts";
import { knownProjectScopes } from "../src/memory.ts";
import { store } from "../src/store.ts";
import { ENGINE_SCOPE, projectScope } from "../src/memzero.ts";
import { makeFakePlatform } from "./_fake-platform.ts";

beforeAll(() => {
        store.run(`DELETE FROM memory_versions WHERE tier LIKE 'project:%'`);
});
afterAll(() => {
        store.run(`DELETE FROM memory_versions WHERE tier LIKE 'project:%'`);
});

describe("searchAcrossScopes", () => {
        function seededPlatform() {
                const platform = makeFakePlatform();
                platform.seed([
                        { id: "e1", text: "run the verify script before declaring success", metadata: { kind: "seed", agent_id: "unown-engine" } },
                        { id: "e2", text: "keep diffs minimal and focused", metadata: { kind: "legacy", agent_id: "unown-engine" } },
                        { id: "p1", text: "the parser treats columns as 1-based offsets", metadata: { kind: "terminal-note", agent_id: "project:api-3f9c21d" } },
                        { id: "p2", text: "parser edge cases live in tests/parser.spec.ts", metadata: { kind: "terminal-note", agent_id: "project:api-3f9c21d" } },
                        { id: "q1", text: "parser failures are logged with byte offsets", metadata: { kind: "terminal-note", agent_id: "project:csv-kit-8a71b0" } },
                ]);
                return platform;
        }
        const SCOPES = [
                { scope: ENGINE_SCOPE, label: "engine" },
                { scope: projectScope("api-3f9c21d"), label: "api-3f9c21d" },
                { scope: projectScope("csv-kit-8a71b0"), label: "csv-kit-8a71b0" },
        ];

        test("fans out, tags each result with its source scope, merges best-first", async () => {
                const platform = seededPlatform();
                const hits = await searchAcrossScopes("parser columns offsets", SCOPES, 12, { platform });
                expect(hits.length).toBeGreaterThan(0);
                // every result carries a scope label from the fan-out set
                for (const h of hits) expect(SCOPES.some((s) => s.label === h.scope)).toBe(true);
                // the parser-adjacent memories from BOTH project scopes surface —
                // a session in one project recalls the other's learning
                const scopesHit = new Set(hits.map((h) => h.scope));
                expect(scopesHit.has("api-3f9c21d")).toBe(true);
                expect(scopesHit.has("csv-kit-8a71b0")).toBe(true);
                // merged best-first: scores are non-increasing
                for (let i = 1; i < hits.length; i++) {
                        expect((hits[i].score ?? -1)).toBeLessThanOrEqual((hits[i - 1].score ?? -1));
                }
        });

        test("a query that matches only the engine scope still answers (no cross-hits fabricated)", async () => {
                const platform = seededPlatform();
                const hits = await searchAcrossScopes("verify script success", SCOPES, 12, { platform });
                expect(hits.length).toBeGreaterThan(0);
                // the RELEVANT hits (score > 0 — the fake platform returns zero-score
                // rows for token-disjoint memories) are all engine-scope
                const relevant = hits.filter((h) => (h.score ?? 0) > 0);
                expect(relevant.length).toBeGreaterThan(0);
                expect(relevant.every((h) => h.scope === "engine")).toBe(true);
        });

        test("the total limit is honored across the merged set", async () => {
                const platform = seededPlatform();
                const hits = await searchAcrossScopes("parser", SCOPES, 2, { platform });
                expect(hits.length).toBeLessThanOrEqual(2);
        });

        test("a dead scope never kills the fan-out (partial results ship)", async () => {
                const platform = seededPlatform();
                platform.getAll = () => {
                        throw new Error("scope store gone");
                };
                // search still works for the other scopes
                const hits = await searchAcrossScopes("parser columns", SCOPES, 12, { platform });
                expect(hits.length).toBeGreaterThan(0);
        });
});

describe("knownProjectScopes", () => {
        test("lists dreamed project tiers; legacy-superseded tiers are skipped", () => {
                // three tiers: a composite one, its legacy parent, and an unrelated composite
                store.run(`DELETE FROM memory_versions WHERE tier LIKE 'project:%'`);
                for (const [tier, version, content] of [
                        ["project:api-3f9c21", 1, "# a"],
                        ["project:api-3f9c21", 2, "# b"],
                        ["project:api", 1, "# legacy"],
                        ["project:csv-kit-8a71b0", 1, "# c"],
                ] as const) {
                        store.run(
                                `INSERT INTO memory_versions (tier, version, content, changed_by, note, created_at) VALUES (?, ?, ?, 'mem0', 'test', ?)`,
                                [tier, version, content, Date.now()],
                        );
                }
                const scopes = knownProjectScopes();
                expect(scopes).toContain("api-3f9c21");
                expect(scopes).toContain("csv-kit-8a71b0");
                expect(scopes).not.toContain("api"); // superseded by its composite child
                store.run(`DELETE FROM memory_versions WHERE tier LIKE 'project:%'`);
        });

        test("empty store: only the engine scope would fan out (no project tiers)", () => {
                store.run(`DELETE FROM memory_versions WHERE tier LIKE 'project:%'`);
                expect(knownProjectScopes()).toEqual([]);
        });
});

describe("GET /api/memories — the scoped lane's project-slug resolution (F3)", () => {
        const REQ = {
                method: "GET",
                query: new URLSearchParams(),
                body: null as any,
        };

        beforeAll(() => {
                store.run(`DELETE FROM memory_versions WHERE tier LIKE 'project:%'`);
                store.run(
                        `INSERT INTO memory_versions (tier, version, content, changed_by, note, created_at) VALUES ('project:api-3f9c21d', 1, '# a', 'mem0', 'test', ?)`,
                        [Date.now()],
                );
        });
        afterAll(() => {
                store.run(`DELETE FROM memory_versions WHERE tier LIKE 'project:%'`);
        });

        test("a raw project slug resolves to the prefixed platform scope (was: silent empty set)", async () => {
                const { handleApi } = await import("../src/server.ts");
                const { setMemoryPlatformForTests } = await import("../src/memzero.ts");
                const platform = makeFakePlatform();
                platform.seed([
                        { id: "p1", text: "the parser treats columns as 1-based offsets", metadata: { kind: "terminal-note", agent_id: "project:api-3f9c21d" } },
                        { id: "e1", text: "run the verify script before declaring success", metadata: { kind: "seed", agent_id: "unown-engine" } },
                ]);
                setMemoryPlatformForTests(platform);
                try {
                        const res = await handleApi({
                                ...REQ,
                                path: "/api/memories",
                                query: new URLSearchParams("agent_id=api-3f9c21d"),
                        });
                        expect(res.status).toBe(200);
                        const body = (await res.json()) as Record<string, any>;
                        // the scope the caller's slug MEANT, not the raw spelling
                        expect(body.scope).toEqual({ agentId: "project:api-3f9c21d" });
                        // and its memories actually come back (the pre-fix lane
                        // answered an empty set for the same request)
                        expect(body.memories.length).toBe(1);
                        expect(body.memories[0].text).toContain("1-based offsets");
                } finally {
                        setMemoryPlatformForTests(null);
                }
        });

        test("the explicit prefixed form and foreign agent ids pass through unchanged", async () => {
                const { handleApi } = await import("../src/server.ts");
                const { setMemoryPlatformForTests } = await import("../src/memzero.ts");
                const platform = makeFakePlatform();
                platform.seed([
                        { id: "p1", text: "the parser treats columns as 1-based offsets", metadata: { kind: "terminal-note", agent_id: "project:api-3f9c21d" } },
                        { id: "x1", text: "an unrelated foreign agent's memory", metadata: { kind: "note", agent_id: "some-other-agent" } },
                ]);
                setMemoryPlatformForTests(platform);
                try {
                        const explicit = await handleApi({
                                ...REQ,
                                path: "/api/memories",
                                query: new URLSearchParams("agent_id=project:api-3f9c21d"),
                        });
                        expect((await explicit.json() as Record<string, any>).scope).toEqual({ agentId: "project:api-3f9c21d" });
                        const foreign = await handleApi({
                                ...REQ,
                                path: "/api/memories",
                                query: new URLSearchParams("agent_id=some-other-agent"),
                        });
                        const foreignBody = (await foreign.json()) as Record<string, any>;
                        expect(foreignBody.scope).toEqual({ agentId: "some-other-agent" });
                        expect(foreignBody.memories.length).toBe(1);
                        expect(foreignBody.memories[0].text).toContain("foreign agent");
                        // a slug-like id that is NOT a dreamed scope stays raw too
                        const unknown = await handleApi({
                                ...REQ,
                                path: "/api/memories",
                                query: new URLSearchParams("agent_id=api-3f9c21d-unknown-child"),
                        });
                        expect((await unknown.json() as Record<string, any>).scope).toEqual({ agentId: "api-3f9c21d-unknown-child" });
                } finally {
                        setMemoryPlatformForTests(null);
                }
        });
});
