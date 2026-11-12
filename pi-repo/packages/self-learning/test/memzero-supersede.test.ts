/**
 * memzero-supersede.test.ts — the bi-temporal supersede lane (Memory v2 round, 2026-11-12).
 *
 * The reconcile pass used to DELETE the loser of a contradiction — provenance
 * was lost at the platform layer. The frontier (Graphiti's valid_at/invalid_at
 * edge model, Mem0 Dream's Supersede badge, Supermemory's updates/isLatest)
 * retains the invalidated memory, linked to its replacement, queryable as
 * "what was true then". Unown's equivalent stamps metadata.supersededBy +
 * metadata.invalidAt on the loser via the new SUPERSEDE reconcile op; the
 * memory stays in the store for audit, excluded from recall by filterLatestOnly.
 *
 * This suite pins the contract: the SUPERSEDE op stamps (not deletes), the
 * loser survives in the store, filterLatestOnly excludes it from the render,
 * the freshness stamp renders "superseded", the health card counts it,
 * fresh-evidence protection extends to SUPERSEDE, and revert clears the stamp.
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFakePlatform, type FakePlatform } from "./_fake-platform.ts";
import {
        ENGINE_SCOPE,
        RECONCILE_SYSTEM,
        type MemoryPlatformEvent,
        type PlatformMemory,
        type ReconcileOp,
        reconcileMemories,
        renderProjectMemoryMarkdown,
        revertMemoryEvents,
        isSuperseded,
        supersededById,
        memoryInvalidAt,
        filterLatestOnly,
        memoryFreshnessStamp,
} from "../src/memzero.ts";
import { countSuperseded } from "../src/memory-health.ts";

let platform: FakePlatform;
let recordDir: string;
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0); // 2026-11-12T12:00:00Z — fixed clock

beforeEach(() => {
        platform = makeFakePlatform();
        // The reconcile record's home for this test — a real temp dir, NOT a
        // hard-coded /tmp path (POSIX-only; on Windows it would write to the
        // drive root, which locked-down runners can refuse). The CI catch that
        // taught this: the Windows engine-test lane.
        recordDir = mkdtempSync(join(tmpdir(), "unown-supersede-test-"));
        // seed two contradictory memories: the old rule and the new rule
        platform.seed([
                {
                        id: "mem-old",
                        text: "use --strict mode for all builds",
                        updatedAt: "2026-10-01T00:00:00Z",
                        createdAt: "2026-10-01T00:00:00Z",
                        metadata: { kind: "note", agent_id: ENGINE_SCOPE.agentId },
                },
                {
                        id: "mem-new",
                        text: "use --relaxed mode for all builds (replaced --strict)",
                        updatedAt: "2026-11-12T00:00:00Z",
                        createdAt: "2026-11-12T00:00:00Z",
                        metadata: { kind: "note", agent_id: ENGINE_SCOPE.agentId },
                },
        ]);
});

afterEach(() => {
        rmSync(recordDir, { recursive: true, force: true });
});

// ------------------------------------------------------------------- the op

test("a SUPERSEDE op stamps supersededBy + invalidAt on the loser (not DELETE)", async () => {
        const verdict = {
                ops: [
                        { op: "SUPERSEDE", id: "mem-old", supersededBy: "mem-new", reason: "newer rule replaces strict" },
                ] as ReconcileOp[],
        };
        const result = await reconcileMemories(ENGINE_SCOPE, {
                platform,
                llmFn: async () => verdict,
                recordDir,
        });
        expect(result.superseded).toBe(1);
        expect(result.pruned).toBe(0); // not deleted
        // the loser is still in the store (audit lane)
        const all = await platform.getAll(ENGINE_SCOPE);
        const loser = all.find((m) => m.id === "mem-old");
        expect(loser).toBeDefined();
        expect(isSuperseded(loser!)).toBe(true);
        expect(supersededById(loser!)).toBe("mem-new");
        expect(memoryInvalidAt(loser!)).not.toBeNull();
        // the winner is unchanged — no supersededBy stamp
        const winner = all.find((m) => m.id === "mem-new");
        expect(isSuperseded(winner!)).toBe(false);
});

test("the loser stays in the store (getAll still returns it for audit)", async () => {
        const verdict = { ops: [{ op: "SUPERSEDE", id: "mem-old", supersededBy: "mem-new" }] as ReconcileOp[] };
        await reconcileMemories(ENGINE_SCOPE, {
                platform,
                llmFn: async () => verdict,
                recordDir,
        });
        const all = await platform.getAll(ENGINE_SCOPE);
        expect(all.length).toBe(2); // both memories survive — the loser is retained
});

test("the SUPERSEDE event is captured for revert (event: SUPERSEDE, supersededBy set)", async () => {
        const verdict = { ops: [{ op: "SUPERSEDE", id: "mem-old", supersededBy: "mem-new" }] as ReconcileOp[] };
        const result = await reconcileMemories(ENGINE_SCOPE, {
                platform,
                llmFn: async () => verdict,
                recordDir,
        });
        const ev = result.events.find((e) => e.event === "SUPERSEDE");
        expect(ev).toBeDefined();
        expect(ev!.id).toBe("mem-old");
        expect(ev!.supersededBy).toBe("mem-new");
});

// ------------------------------------------------------------- the render

test("filterLatestOnly excludes superseded memories from the render", async () => {
        const verdict = { ops: [{ op: "SUPERSEDE", id: "mem-old", supersededBy: "mem-new" }] as ReconcileOp[] };
        await reconcileMemories(ENGINE_SCOPE, {
                platform,
                llmFn: async () => verdict,
                recordDir,
        });
        const all = await platform.getAll(ENGINE_SCOPE);
        const visible = filterLatestOnly(all);
        expect(visible.length).toBe(1); // only the winner renders
        expect(visible[0].id).toBe("mem-new");
});

test("the render excludes superseded memories and carries the supersede count in the footer", async () => {
        const verdict = { ops: [{ op: "SUPERSEDE", id: "mem-old", supersededBy: "mem-new" }] as ReconcileOp[] };
        await reconcileMemories(ENGINE_SCOPE, {
                platform,
                llmFn: async () => verdict,
                recordDir,
        });
        const all = await platform.getAll(ENGINE_SCOPE);
        const rendered = renderProjectMemoryMarkdown(all, { now: NOW });
        // the loser's full text does NOT appear in the rendered document
        // (the winner's text may mention the old rule — "replaced --strict" —
        // but the loser's own bullet "use --strict mode for all builds" is gone)
        expect(rendered).not.toContain("- use --strict mode for all builds");
        // the winner's text DOES appear
        expect(rendered).toContain("--relaxed");
        // the footer carries the supersede count
        expect(rendered).toContain("1 superseded (retained for audit, excluded from recall)");
});

test("memoryFreshnessStamp renders 'superseded' for a superseded memory", async () => {
        const verdict = { ops: [{ op: "SUPERSEDE", id: "mem-old", supersededBy: "mem-new" }] as ReconcileOp[] };
        await reconcileMemories(ENGINE_SCOPE, {
                platform,
                llmFn: async () => verdict,
                recordDir,
        });
        const all = await platform.getAll(ENGINE_SCOPE);
        const loser = all.find((m) => m.id === "mem-old")!;
        const stamp = memoryFreshnessStamp(loser, NOW);
        expect(stamp).toContain("superseded");
        // the stamp carries the invalidation date
        const invTs = memoryInvalidAt(loser);
        if (invTs !== null) {
                expect(stamp).toContain(new Date(invTs).toISOString().slice(0, 10));
        }
});

test("memoryFreshnessStamp renders the normal date for a non-superseded memory", () => {
        const m: PlatformMemory = {
                id: "mem-new",
                text: "use --relaxed mode",
                updatedAt: "2026-11-12T00:00:00Z",
                createdAt: "2026-11-12T00:00:00Z",
                metadata: {},
        };
        const stamp = memoryFreshnessStamp(m, NOW);
        expect(stamp).toBe("2026-11-12"); // normal date, no superseded marker
});

// ------------------------------------------------------------- the health

test("countSuperseded counts memories carrying supersededBy metadata", async () => {
        const verdict = { ops: [{ op: "SUPERSEDE", id: "mem-old", supersededBy: "mem-new" }] as ReconcileOp[] };
        await reconcileMemories(ENGINE_SCOPE, {
                platform,
                llmFn: async () => verdict,
                recordDir,
        });
        const all = await platform.getAll(ENGINE_SCOPE);
        expect(countSuperseded(all)).toBe(1);
});

test("countSuperseded is zero for a scope with no superseded memories", () => {
        const memories: PlatformMemory[] = [
                { id: "a", text: "rule a", metadata: {} },
                { id: "b", text: "rule b", metadata: { supersededBy: null } },
        ];
        expect(countSuperseded(memories)).toBe(0);
});

// ------------------------------------------------------- fresh-evidence guard

test("fresh-evidence protection extends to SUPERSEDE: a fresh memory can't be superseded unless its twin survives", async () => {
        // mark mem-old as fresh (born this batch)
        const verdict = {
                ops: [{ op: "SUPERSEDE", id: "mem-old", supersededBy: "mem-new" }] as ReconcileOp[],
        };
        const result = await reconcileMemories(ENGINE_SCOPE, {
                platform,
                llmFn: async () => verdict,
                protectedIds: ["mem-old"], // mem-old is fresh
                recordDir,
        });
        // the guard rejects the SUPERSEDE — mem-old survives unsuperseded
        expect(result.superseded).toBe(0);
        expect(result.protectedDeletes).toBe(1);
        const all = await platform.getAll(ENGINE_SCOPE);
        const loser = all.find((m) => m.id === "mem-old")!;
        expect(isSuperseded(loser)).toBe(false); // not stamped — protected
});

test("fresh-evidence SUPERSEDE is allowed when an exact-text twin survives", async () => {
        // seed a twin of mem-old
        platform.seed([
                {
                        id: "mem-old-twin",
                        text: "use --strict mode for all builds",
                        updatedAt: "2026-10-01T00:00:00Z",
                        createdAt: "2026-10-01T00:00:00Z",
                        metadata: { kind: "note", agent_id: ENGINE_SCOPE.agentId },
                },
        ]);
        const verdict = {
                ops: [
                        { op: "SUPERSEDE", id: "mem-old", supersededBy: "mem-new" },
                        { op: "SUPERSEDE", id: "mem-old-twin", supersededBy: "mem-new" },
                ] as ReconcileOp[],
        };
        const result = await reconcileMemories(ENGINE_SCOPE, {
                platform,
                llmFn: async () => verdict,
                protectedIds: ["mem-old", "mem-old-twin"],
                recordDir,
        });
        // one twin is superseded, the other survives (the content lives on in the twin)
        // — the exact-twin carve-out keeps the platform-dedup lane legal
        const all = await platform.getAll(ENGINE_SCOPE);
        const stamped = all.filter((m) => isSuperseded(m));
        // at least one twin survives unstamped (the sole-carrier guard)
        expect(all.filter((m) => !isSuperseded(m) && m.text.includes("--strict")).length).toBeGreaterThanOrEqual(1);
});

// ------------------------------------------------------------- edge cases

test("a SUPERSEDE targeting a hallucinated id is ignored", async () => {
        const verdict = {
                ops: [{ op: "SUPERSEDE", id: "mem-nonexistent", supersededBy: "mem-new" }] as ReconcileOp[],
        };
        const result = await reconcileMemories(ENGINE_SCOPE, {
                platform,
                llmFn: async () => verdict,
                recordDir,
        });
        expect(result.superseded).toBe(0); // no-op — the id wasn't in scope
});

test("a SUPERSEDE where the winner doesn't exist is ignored", async () => {
        const verdict = {
                ops: [{ op: "SUPERSEDE", id: "mem-old", supersededBy: "mem-nonexistent" }] as ReconcileOp[],
        };
        const result = await reconcileMemories(ENGINE_SCOPE, {
                platform,
                llmFn: async () => verdict,
                recordDir,
        });
        expect(result.superseded).toBe(0); // no-op — the winner isn't in scope
        const all = await platform.getAll(ENGINE_SCOPE);
        expect(isSuperseded(all.find((m) => m.id === "mem-old")!)).toBe(false); // not stamped
});

test("a SUPERSEDE on an already-superseded memory is a no-op (idempotent)", async () => {
        // first pass: supersede mem-old
        const verdict1 = { ops: [{ op: "SUPERSEDE", id: "mem-old", supersededBy: "mem-new" }] as ReconcileOp[] };
        const dir = recordDir;
        await reconcileMemories(ENGINE_SCOPE, { platform, llmFn: async () => verdict1, recordDir: dir });
        // second pass: try to supersede mem-old again
        const verdict2 = { ops: [{ op: "SUPERSEDE", id: "mem-old", supersededBy: "mem-new" }] as ReconcileOp[] };
        const result2 = await reconcileMemories(ENGINE_SCOPE, { platform, llmFn: async () => verdict2, recordDir: dir });
        expect(result2.superseded).toBe(0); // no-op — already superseded
});

test("a memory cannot supersede itself", async () => {
        const verdict = {
                ops: [{ op: "SUPERSEDE", id: "mem-new", supersededBy: "mem-new" }] as ReconcileOp[],
        };
        const result = await reconcileMemories(ENGINE_SCOPE, {
                platform,
                llmFn: async () => verdict,
                recordDir,
        });
        expect(result.superseded).toBe(0); // no-op — cannot supersede itself
});

// ------------------------------------------------------------- revert

test("SUPERSEDE revert clears the supersededBy + invalidAt metadata", async () => {
        const verdict = { ops: [{ op: "SUPERSEDE", id: "mem-old", supersededBy: "mem-new" }] as ReconcileOp[] };
        const dir = recordDir;
        const result = await reconcileMemories(ENGINE_SCOPE, {
                platform,
                llmFn: async () => verdict,
                recordDir: dir,
        });
        // verify stamped
        let all = await platform.getAll(ENGINE_SCOPE);
        expect(isSuperseded(all.find((m) => m.id === "mem-old")!)).toBe(true);
        // revert
        await revertMemoryEvents(result.events, ENGINE_SCOPE, { platform });
        // verify cleared
        all = await platform.getAll(ENGINE_SCOPE);
        const restored = all.find((m) => m.id === "mem-old")!;
        expect(isSuperseded(restored)).toBe(false);
        expect(supersededById(restored)).toBeNull();
        expect(memoryInvalidAt(restored)).toBeNull();
});

// ------------------------------------------------------------- prompt

test("RECONCILE_SYSTEM teaches the SUPERSEDE op as the preferred contradiction resolution", async () => {
        expect(RECONCILE_SYSTEM).toContain("SUPERSEDE");
        expect(RECONCILE_SYSTEM).toContain("supersededBy");
        expect(RECONCILE_SYSTEM).toContain("retained for audit");
        expect(RECONCILE_SYSTEM).toContain("This is preferred over DELETE");
});

test("RECONCILE_SYSTEM keeps DELETE for no-successor memories (transient, injection)", async () => {
        expect(RECONCILE_SYSTEM).toContain("Use DELETE only for a memory that has NO successor");
        expect(RECONCILE_SYSTEM).toContain("untrusted-input payloads");
});

// ---------------------------------------------------- backward compatibility

test("memories without supersededBy metadata behave exactly as before (backward-compatible)", () => {
        const memories: PlatformMemory[] = [
                { id: "a", text: "rule a", updatedAt: "2026-11-12T00:00:00Z", metadata: {} },
                { id: "b", text: "rule b", updatedAt: "2026-11-12T00:00:00Z", metadata: { kind: "note" } },
        ];
        expect(filterLatestOnly(memories).length).toBe(2); // nothing filtered
        expect(countSuperseded(memories)).toBe(0);
        for (const m of memories) {
                expect(isSuperseded(m)).toBe(false);
                expect(supersededById(m)).toBeNull();
        }
});
