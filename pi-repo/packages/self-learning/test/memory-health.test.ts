// memory-health.test.ts — the memory health card (S2-4, ticket SM-2).
//
// Pins the pure health computation (duplicate groups over normalized text,
// supersede conflicts over linked_memory_ids, the three warning kinds), the
// PERSISTENT reconcile-failure record lane (the fail-open pass's durable
// state: write on double LLM failure, clear on success, survives a
// re-read against the same dir — the restart property), the reconcileMemories
// integration of that lane (fail-open writes it, a verdict clears it), the
// hub card (memory.health exists + ranks TOP-3 for "memory health"), and the
// engine API route's registration.
//
// Conventions follow test/automation-spend.test.ts: _env first, tmpdir
// sandboxes for the record dir, the injected fake-platform seam, no real LLM.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryPlatform, PlatformMemory } from "../src/memzero.ts";
import {
        clearReconcileRecord,
        countConflicts,
        countDuplicates,
        engineMemoryHealth,
        lastReconcileTs,
        memoryHealth,
        RECONCILE_STALE_MS,
        recordReconcileFailure,
        recordReconcileSuccess,
        reconcileFailing,
        reconcileRecord,
        reconcileRecordPath,
        normalizeMemoryText,
} from "../src/memory-health.ts";

// ---------------------------------------------------------------------------
// The injected fake platform seam (one memory list per test, no LLM)
// ---------------------------------------------------------------------------

function fakePlatform(memories: PlatformMemory[]): MemoryPlatform {
        return {
                backend: "fake",
                add: async () => [],
                getAll: async () => memories,
                search: async () => memories,
                delete: async () => {},
                update: async () => {},
        };
}

const DIRS: string[] = [];
function freshDir(label: string): string {
        const d = mkdtempSync(join(tmpdir(), `unown-mh-${label}-`));
        DIRS.push(d);
        return d;
}

afterAll(() => {
        for (const d of DIRS) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. The record lane — the persistent warning record
// ---------------------------------------------------------------------------

describe("reconcile record lane", () => {
        test("absent record = the honest empty state", () => {
                const dir = freshDir("absent");
                expect(reconcileRecord(dir)).toEqual({
                        lastSuccessTs: null,
                        lastFailureTs: null,
                        lastError: null,
                });
                expect(lastReconcileTs(dir)).toBeNull();
                expect(reconcileFailing(dir)).toBeNull();
                expect(existsSync(reconcileRecordPath(dir))).toBe(false);
        });

        test("failure writes {lastFailureTs, lastError}; success clears it + stamps lastSuccessTs", () => {
                const dir = freshDir("cycle");
                recordReconcileFailure("bridge 503", 1_700_000_000_000, dir);
                let rec = reconcileRecord(dir);
                expect(rec.lastFailureTs).toBe(1_700_000_000_000);
                expect(rec.lastError).toBe("bridge 503");
                expect(rec.lastSuccessTs).toBeNull();
                expect(reconcileFailing(dir)!.error).toBe("bridge 503");

                recordReconcileSuccess(1_700_000_600_000, dir);
                rec = reconcileRecord(dir);
                expect(rec.lastSuccessTs).toBe(1_700_000_600_000);
                expect(rec.lastFailureTs).toBeNull();
                expect(rec.lastError).toBeNull();
                expect(reconcileFailing(dir)).toBeNull();
                expect(lastReconcileTs(dir)).toBe(1_700_000_600_000);
        });

        test("PERSISTENCE PROPERTY: the record survives a re-read against the same dir (a restart)", () => {
                const dir = freshDir("restart");
                recordReconcileFailure("llm down", 1_700_000_000_000, dir);
                // Simulate the engine restart: a FRESH reader against the same
                // dir (the module re-reads from disk on every call — no
                // in-process cache). The record must still be there.
                const again = reconcileRecord(dir);
                expect(again.lastFailureTs).toBe(1_700_000_000_000);
                expect(again.lastError).toBe("llm down");
                // And the derived surface agrees:
                expect(reconcileFailing(dir)?.error).toBe("llm down");
                // A second failure after a success re-arms the warning (the
                // success is older than the newer failure).
                recordReconcileSuccess(1_700_000_100_000, dir);
                recordReconcileFailure("again", 1_700_000_200_000, dir);
                expect(reconcileFailing(dir)?.error).toBe("again");
                // clearReconcileRecord drops the file entirely.
                clearReconcileRecord(dir);
                expect(lastReconcileTs(dir)).toBeNull();
                expect(reconcileFailing(dir)).toBeNull();
        });

        test("a corrupt record degrades to the empty state, not a throw", () => {
                const dir = freshDir("corrupt");
                require("node:fs").writeFileSync(reconcileRecordPath(dir), "{not json", "utf8");
                expect(lastReconcileTs(dir)).toBeNull();
                expect(reconcileFailing(dir)).toBeNull();
                // A fresh failure overwrites the corruption.
                recordReconcileFailure("recover", 5, dir);
                expect(reconcileFailing(dir)?.error).toBe("recover");
        });
});

// ---------------------------------------------------------------------------
// 2. The pure counters
// ---------------------------------------------------------------------------

describe("duplicate counting (normalized-text groups)", () => {
        test("exact dupes count", () => {
                const mems: PlatformMemory[] = [
                        { id: "1", text: "Run tests with bun test" },
                        { id: "2", text: "Run tests with bun test" },
                        { id: "3", text: "Something else entirely" },
                ];
                expect(countDuplicates(mems)).toBe(2); // the group's members, not the groups
        });

        test("normalized dupes: case, whitespace, punctuation variants", () => {
                const mems: PlatformMemory[] = [
                        { id: "1", text: "Run tests WITH bun!" },
                        { id: "2", text: "run  tests   with bun" },
                        { id: "3", text: "RUN TESTS WITH BUN." },
                        { id: "4", text: "Distinct memory about the CI lane" },
                ];
                expect(normalizeMemoryText(mems[0].text)).toBe(normalizeMemoryText(mems[1].text));
                expect(countDuplicates(mems)).toBe(3); // the three variants, not the fourth
        });

        test("distinct memories are not counted", () => {
                const mems: PlatformMemory[] = [
                        { id: "1", text: "First memory" },
                        { id: "2", text: "Second memory" },
                        { id: "3", text: "Third memory" },
                ];
                expect(countDuplicates(mems)).toBe(0);
        });

        test("a group of 3 counts 3; empty-text rows never count", () => {
                const mems: PlatformMemory[] = [
                        { id: "1", text: "same fact" },
                        { id: "2", text: "SAME FACT?" },
                        { id: "3", text: "  same   fact  " },
                        { id: "4", text: "   " },
                ];
                expect(countDuplicates(mems)).toBe(3);
        });
});

describe("conflict counting (supersede links whose old memory is alive)", () => {
        test("a live old memory linked by a successor counts", () => {
                const mems: PlatformMemory[] = [
                        { id: "old", text: "old rule: use tool A" },
                        {
                                id: "new",
                                text: "new rule: use tool B",
                                metadata: { linked_memory_ids: ["old"] },
                        },
                        { id: "plain", text: "unrelated memory" },
                ];
                expect(countConflicts(mems)).toBe(1);
        });

        test("a retired (absent) old memory does not count", () => {
                const mems: PlatformMemory[] = [
                        {
                                id: "new",
                                text: "new rule: use tool B",
                                metadata: { linked_memory_ids: ["gone"] },
                        },
                ];
                expect(countConflicts(mems)).toBe(0);
        });

        test("self-links do not count; string and array link forms both work", () => {
                const mems: PlatformMemory[] = [
                        { id: "a", text: "memory a", metadata: { linked_memory_ids: ["a"] } },
                        { id: "b", text: "memory b", metadata: { linked_memory_ids: "a" } },
                        { id: "c", text: "memory c" },
                ];
                expect(countConflicts(mems)).toBe(1); // only b→a
        });
});

// ---------------------------------------------------------------------------
// 3. The composed health object — warnings + lastReconcile
// ---------------------------------------------------------------------------

describe("memoryHealth (composed)", () => {
        test("a clean scope with no records and no notes has no warnings", async () => {
                const dir = freshDir("clean");
                const h = await memoryHealth({ agentId: "p1" }, {
                        platform: fakePlatform([]),
                        recordDir: dir,
                        tierSize: { chars: 100, cap: 48_000 },
                        undreamedNotes: 0,
                });
                expect(h.scope).toBe("p1");
                expect(h.lastReconcile).toBeNull();
                expect(h.duplicateCount).toBe(0);
                expect(h.conflictCount).toBe(0);
                expect(h.warnings).toEqual([]);
                expect(h.memoryCount).toBe(0);
        });

        test("reconcile-failing warning carries since-ts + error", async () => {
                const dir = freshDir("failing");
                recordReconcileFailure("llm bridge dead", 1_700_000_000_000, dir);
                const h = await memoryHealth({ agentId: "p1" }, {
                        platform: fakePlatform([]),
                        recordDir: dir,
                });
                const w = h.warnings.find((x) => x.kind === "reconcile-failing")!;
                expect(w.detail.includes("2023-11-14T22:13:20.000Z")).toBe(true); // since-ts rendered (1.7e12 ms — not the 1970 epoch-ms misread)
                expect(w.detail.includes("llm bridge dead")).toBe(true);
        });

        test("a success clears the failure warning", async () => {
                const dir = freshDir("cleared");
                recordReconcileFailure("llm bridge dead", 1_700_000_000_000, dir);
                recordReconcileSuccess(1_700_000_500_000, dir);
                const h = await memoryHealth({ agentId: "p1" }, { platform: fakePlatform([]), recordDir: dir });
                expect(h.warnings).toEqual([]);
                expect(h.lastReconcile).toBe(1_700_000_500_000);
        });

        test("tier-at-cap fires at the cap and not under it", async () => {
                const dir = freshDir("cap");
                const at = await memoryHealth({ agentId: "p1" }, {
                        platform: fakePlatform([]),
                        recordDir: dir,
                        tierSize: { chars: 48_000, cap: 48_000 },
                });
                expect(at.warnings.some((w) => w.kind === "tier-at-cap")).toBe(true);
                const under = await memoryHealth({ agentId: "p1" }, {
                        platform: fakePlatform([]),
                        recordDir: dir,
                        tierSize: { chars: 47_999, cap: 48_000 },
                });
                expect(under.warnings.some((w) => w.kind === "tier-at-cap")).toBe(false);
        });

        test("reconcile-stale fires only with undreamed notes + a stale/absent last success", async () => {
                const dir = freshDir("stale");
                const now = Date.now();

                // no record at all + notes pending → stale
                let h = await memoryHealth({ agentId: "p1" }, {
                        platform: fakePlatform([]),
                        recordDir: dir,
                        undreamedNotes: 3,
                        now,
                });
                expect(h.warnings.some((w) => w.kind === "reconcile-stale")).toBe(true);

                // notes pending but a FRESH success → not stale
                recordReconcileSuccess(now - 1_000, dir);
                h = await memoryHealth({ agentId: "p1" }, {
                        platform: fakePlatform([]),
                        recordDir: dir,
                        undreamedNotes: 3,
                        now,
                });
                expect(h.warnings.some((w) => w.kind === "reconcile-stale")).toBe(false);

                // a success OLDER than the 7d horizon + notes → stale again
                recordReconcileSuccess(now - RECONCILE_STALE_MS - 1_000, dir);
                h = await memoryHealth({ agentId: "p1" }, {
                        platform: fakePlatform([]),
                        recordDir: dir,
                        undreamedNotes: 1,
                        now,
                });
                expect(h.warnings.some((w) => w.kind === "reconcile-stale")).toBe(true);

                // an old success but NO notes pending → still not stale
                h = await memoryHealth({ agentId: "p1" }, {
                        platform: fakePlatform([]),
                        recordDir: dir,
                        undreamedNotes: 0,
                        now,
                });
                expect(h.warnings.some((w) => w.kind === "reconcile-stale")).toBe(false);
        });

        test("duplicates + conflicts surface through the composed object", async () => {
                const dir = freshDir("counts");
                const mems: PlatformMemory[] = [
                        { id: "1", text: "same fact" },
                        { id: "2", text: "same fact" },
                        { id: "3", text: "new rule", metadata: { linked_memory_ids: ["old"] } },
                        { id: "old", text: "old rule" },
                ];
                const h = await memoryHealth({ agentId: "p1" }, {
                        platform: fakePlatform(mems),
                        recordDir: dir,
                });
                expect(h.duplicateCount).toBe(2);
                expect(h.conflictCount).toBe(1);
                expect(h.memoryCount).toBe(4);
        });
});

// ---------------------------------------------------------------------------
// 4. The reconcileMemories integration of the record lane (no real LLM)
// ---------------------------------------------------------------------------

describe("reconcileMemories records its outcome durably", () => {
        test("the fail-open branch writes the failure record; a verdict clears it", async () => {
                const { reconcileMemories } = await import("../src/memzero.ts");
                const dir = freshDir("reconcile");
                const mems: PlatformMemory[] = [
                        { id: "1", text: "rule one" },
                        { id: "2", text: "rule two" },
                ];

                // Double LLM failure → the fail-open branch records it. The
                // 1500ms backoff sits between the two attempts — honest cost.
                const failed = await reconcileMemories({ agentId: "p1" }, {
                        platform: fakePlatform(mems),
                        llmFn: (async () => {
                                throw new Error("nope: bridge down");
                        }) as never,
                        recordDir: dir,
                });
                expect(failed.merged).toBe(0);
                expect(failed.pruned).toBe(0);
                expect(reconcileFailing(dir)?.error).toContain("bridge down");

                // A SUCCESSFUL verdict (even zero ops) clears the lane.
                const ok = await reconcileMemories({ agentId: "p1" }, {
                        platform: fakePlatform(mems),
                        llmFn: (async () => ({ ops: [] })) as never,
                        recordDir: dir,
                });
                expect(ok.ops).toEqual([]);
                expect(reconcileFailing(dir)).toBeNull();
                expect(lastReconcileTs(dir)).toBeGreaterThan(0);
        });
});

// ---------------------------------------------------------------------------
// 5. The hub pin — memory.health exists and ranks TOP-3 for "memory health"
// ---------------------------------------------------------------------------

describe("hub card memory.health", () => {
        test("memory.health exists with kind action, section memory, risk low", async () => {
                const { SETTINGS_REGISTRY } = await import("../src/settings/registry.ts");
                const item = SETTINGS_REGISTRY.find((i) => i.id === "memory.health");
                expect(item).toBeDefined();
                expect(item!.kind).toBe("action");
                expect(item!.section).toBe("memory");
                expect(item!.risk).toBe("low");
                expect(item!.name).toBe("Memory health card");
        });

        test("search ranks memory.health TOP-3 for 'memory health'", async () => {
                const { searchSettings } = await import("../src/settings/search.ts");
                const hits = searchSettings("memory health");
                expect(hits.length).toBeGreaterThan(0);
                const top3 = hits.slice(0, 3).map((h) => h.item.id);
                expect(top3).toContain("memory.health");
        });
});

// ---------------------------------------------------------------------------
// 6. The API route — the handler's registration (route-level pin)
// ---------------------------------------------------------------------------

describe("API route /api/memory/health", () => {
        test("server.ts registers GET /api/memory/health returning the health object", async () => {
                const { readFileSync } = await import("node:fs");
                const src = readFileSync(join(import.meta.dir, "../src/server.ts"), "utf8");
                // The registration is pinned by the source seam (the route's
                // behavior is pinned through engineMemoryHealth above; the
                // route delegates to it).
                expect(src.includes('"/api/memory/health"')).toBe(true);
                expect(src.includes("engineMemoryHealth")).toBe(true);
        });
});

// ---------------------------------------------------------------------------
// 7. The arity bug (Memory Encore round, 2026-11-12) — engineUndreamedNotes
//    used to return the imported FUNCTION's .length (its arity, always 2),
//    so the engine scope's reconcile-stale warning reported a phantom
//    "2 undreamed note(s) pending" whenever the 7d horizon tripped — an
//    empty queue could never clear it and a real backlog always read as 2.
//    engineMemoryHealth must report the REAL benchmark-lane count, and only
//    benchmark notes (terminal notes belong to project scopes, not the
//    engine scope's lane).
// ---------------------------------------------------------------------------

describe("engineMemoryHealth — the real undreamed count (arity-bug regression)", () => {
        test("reports the REAL benchmark-note count, not the function's arity (2)", async () => {
                const { createNote } = await import("../src/notes.ts");
                const { store } = await import("../src/store.ts");
                const dir = freshDir("arity");
                store.run(`DELETE FROM notes WHERE kind = 'benchmark'`);
                try {
                        // 5 undreamed benchmark notes — deliberately ≠ 2 so an
                        // arity regression (always "2") cannot pass by accident.
                        for (let i = 0; i < 5; i++) createNote(null as any, `arity-fix probe note ${i}`, "benchmark");
                        const h = await engineMemoryHealth({ platform: fakePlatform([]), recordDir: dir });
                        const stale = h.warnings.find((w) => w.kind === "reconcile-stale");
                        // no successful reconcile on record + notes pending → stale fires
                        expect(stale).toBeDefined();
                        expect(stale!.detail).toContain("5 undreamed note(s) pending");
                        expect(stale!.detail).not.toContain("2 undreamed note(s) pending");
                } finally {
                        store.run(`DELETE FROM notes WHERE kind = 'benchmark'`);
                }
        });

        test("an empty benchmark queue never fires the stale warning (the phantom-note cure)", async () => {
                const { store } = await import("../src/store.ts");
                const dir = freshDir("arity-empty");
                store.run(`DELETE FROM notes WHERE kind = 'benchmark'`);
                try {
                        const h = await engineMemoryHealth({ platform: fakePlatform([]), recordDir: dir });
                        expect(h.warnings.some((w) => w.kind === "reconcile-stale")).toBe(false);
                } finally {
                        store.run(`DELETE FROM notes WHERE kind = 'benchmark'`);
                }
        });

        test("terminal notes do not count toward the engine scope's lane", async () => {
                const { createNote } = await import("../src/notes.ts");
                const { store } = await import("../src/store.ts");
                const dir = freshDir("arity-terminal");
                store.run(`DELETE FROM notes WHERE kind = 'benchmark'`);
                try {
                        // terminal notes belong to project scopes; the engine's
                        // benchmark lane must stay empty
                        createNote(null as any, "terminal note for another project", "terminal", "/tmp/arity-probe");
                        const h = await engineMemoryHealth({ platform: fakePlatform([]), recordDir: dir });
                        expect(h.warnings.some((w) => w.kind === "reconcile-stale")).toBe(false);
                } finally {
                        store.run(`DELETE FROM notes WHERE kind = 'benchmark'`);
                        store.run(`DELETE FROM notes WHERE project_path = '/tmp/arity-probe'`);
                }
        });
});
