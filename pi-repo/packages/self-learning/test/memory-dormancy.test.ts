/**
 * memory-dormancy.test.ts — the usage-conditioned decay lane (Memory
 * Divertimento round CP3, 2026-11-14).
 *
 * The field's verdict (MIRIX's experience pool: retire at 3 ignored
 * pushes, RECURRENCE RESETS; CAMeR: time-driven decay collapses to ~zero,
 * use-conditioned reinforcement is the driver; MemDream: soft, reversible
 * decay) adapted to Unown's render budget: a LIVE memory the budget
 * repeatedly refuses to render goes DORMANT after PI_MEM0_DORMANT_AFTER
 * (default 3) consecutive excluded renders — a badge and a reversible
 * state, never a deletion. Inclusion resets (recurrence), a search hit
 * revives (use). The bookkeeping lives in a per-scope side record,
 * deliberately NOT on the platform rows: a counter bump is not a
 * re-assertion, and platform.update would refresh updatedAt — falsely
 * refreshing the freshness stamp and flipping the SRO winner order.
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFakePlatform, type FakePlatform } from "./_fake-platform.ts";
import {
        computeRenderPlan,
        dormantCountAll,
        dormantCountFor,
        dormancyRecordPath,
        dormancyScopeKey,
        ENGINE_SCOPE,
        isDormantId,
        mem0DormantAfter,
        readDormancyRecord,
        reviveDormantByIds,
        trackDormancyFromPlan,
        writeDormancyRecord,
        renderProjectMemoryMarkdown,
        type PlatformMemory,
} from "../src/memzero.ts";

let dir: string;
let platform: FakePlatform;

function mem(id: string, i: number, updatedAt: string): Partial<PlatformMemory> {
        return { id, text: `fact number ${i} about the parser offsets and the flaky runner`, updatedAt, createdAt: updatedAt, metadata: { kind: "terminal-note", agent_id: "unown-engine" } };
}

beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "unown-dormancy-"));
        platform = makeFakePlatform();
});
afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
        delete process.env.PI_MEM0_DORMANT_AFTER;
        delete process.env.PI_MEM0_MAX_RENDERED;
});

// ------------------------------------------------------------ the unit lane

test("mem0DormantAfter: default 3, env override, garbage, 0 disables", () => {
        expect(mem0DormantAfter()).toBe(3);
        process.env.PI_MEM0_DORMANT_AFTER = "5";
        expect(mem0DormantAfter()).toBe(5);
        process.env.PI_MEM0_DORMANT_AFTER = "not-a-number";
        expect(mem0DormantAfter()).toBe(3);
        process.env.PI_MEM0_DORMANT_AFTER = "0";
        expect(mem0DormantAfter()).toBe(0);
        delete process.env.PI_MEM0_DORMANT_AFTER;
});

test("dormancyRecordPath: sanitized per-scope files under the mem0 dir", () => {
        const path = dormancyRecordPath("project:api-3f9c21d", dir);
        expect(path.startsWith(dir)).toBe(true);
        expect(path.split(/[\\/]/).pop()).toBe("dormancy-project-api-3f9c21d.json");
        expect(dormancyScopeKey(ENGINE_SCOPE)).toBe(String(ENGINE_SCOPE.agentId));
        expect(dormancyScopeKey({ userId: "u1" })).toBe("user:u1");
        expect(dormancyScopeKey({ runId: "r1" })).toBe("run:r1");
});

// -------------------------------------------------- tracking over renders

function seedOverCapStore() {
        // 110 cap default; 120 live rows → 10 excluded every render
        for (let i = 0; i < 120; i++) platform.seed([mem(`m${i}`, i, new Date(2026, 10, 1 + (i % 20)).toISOString())]);
}

test("three consecutive excluded renders → dormant; the plan and the render agree on the in/out list", () => {
        seedOverCapStore();
        const list = () => [...platform.store.values()];
        // render 1: bump
        let plan = computeRenderPlan(list());
        let out = trackDormancyFromPlan(plan, { scopeKey: "engine", dir, now: 1 });
        expect(out.excludedBumps).toBe(10);
        expect(out.newlyDormant).toBe(0);
        // the plan's excluded rows are exactly the rows the TEXT render omits
        const text = renderProjectMemoryMarkdown(list());
        expect(text.split("\n").filter((l) => l.startsWith("- ")).length).toBe(plan.kept.length);
        expect(plan.excluded.length).toBe(10);
        // render 2: bump again
        plan = computeRenderPlan(list());
        out = trackDormancyFromPlan(plan, { scopeKey: "engine", dir, now: 2 });
        expect(out.excludedBumps).toBe(10);
        // render 3: threshold → dormant
        plan = computeRenderPlan(list());
        out = trackDormancyFromPlan(plan, { scopeKey: "engine", dir, now: 3 });
        expect(out.newlyDormant).toBe(10);
        const rec = readDormancyRecord("engine", dir);
        let dormant = 0;
        for (const e of Object.values(rec)) if (e.dormantSince !== undefined) dormant++;
        expect(dormant).toBe(10);
        expect(dormantCountFor("engine", dir)).toBe(10);
        // render 4: already dormant — no more counting (state, not a counter)
        plan = computeRenderPlan(list());
        out = trackDormancyFromPlan(plan, { scopeKey: "engine", dir, now: 4 });
        expect(out.newlyDormant).toBe(0);
        expect(out.excludedBumps).toBe(0);
        expect(dormantCountFor("engine", dir)).toBe(10);
});

test("inclusion RESETS (recurrence): one render that includes the row clears counter AND dormant state", () => {
        seedOverCapStore();
        const key = "engine";
        // push the whole shelf to dormant over three renders
        for (let i = 0; i < 3; i++) {
                trackDormancyFromPlan(computeRenderPlan([...platform.store.values()]), { scopeKey: key, dir, now: i + 1 });
        }
        expect(dormantCountFor(key, dir)).toBe(10);
        // now render a store where the cap fits everyone (the budget reconsidered)
        process.env.PI_MEM0_MAX_RENDERED = "130";
        const plan = computeRenderPlan([...platform.store.values()]);
        expect(plan.excluded.length).toBe(0);
        const out = trackDormancyFromPlan(plan, { scopeKey: key, dir, now: 10 });
        expect(out.resets).toBe(10); // all ten revived by inclusion
        expect(out.newlyDormant).toBe(0);
        const rec = readDormancyRecord(key, dir);
        let dormant = 0;
        for (const e of Object.values(rec)) if (e.dormantSince !== undefined) dormant++;
        expect(dormant).toBe(0);
        // the revived entries record their revival lane
        const firstRevived = Object.values(rec)[0];
        expect(firstRevived.excluded).toBe(0);
        expect(firstRevived.revives).toBeGreaterThan(0);
        expect(firstRevived.lastRevivedBy).toBe("render");
        delete process.env.PI_MEM0_MAX_RENDERED;
});

test("pruning: entries for ids absent from the live set are dropped on the next pass", () => {
        writeDormancyRecord("engine", { "gone-id": { excluded: 2 }, "kept-id": { excluded: 1 } }, dir);
        platform.seed([mem("kept-id", 1, "2026-11-10T00:00:00Z"), mem("live-2", 2, "2026-11-11T00:00:00Z")]);
        const plan = computeRenderPlan([...platform.store.values()]);
        const out = trackDormancyFromPlan(plan, { scopeKey: "engine", dir, now: 1 });
        expect(out.prunedEntries).toBe(1);
        const rec = readDormancyRecord("engine", dir);
        expect(rec["gone-id"]).toBeUndefined();
        expect(rec["kept-id"]).toBeDefined();
});

test("PI_MEM0_DORMANT_AFTER=0 disables the whole lane (no reads, no writes)", () => {
        process.env.PI_MEM0_DORMANT_AFTER = "0";
        seedOverCapStore();
        const plan = computeRenderPlan([...platform.store.values()]);
        const out = trackDormancyFromPlan(plan, { scopeKey: "engine", dir, now: 1 });
        expect(out).toMatchObject({ newlyDormant: 0, resets: 0, excludedBumps: 0, prunedEntries: 0 });
        expect(reviveDormantByIds(["m0"], { scopeKey: "engine", dir })).toBe(0);
        expect(dormantCountFor("engine", dir)).toBe(0);
});

// ------------------------------------------------------------- the revival

test("reviveDormantByIds: a search hit revives (recurrence reset by use); non-dormant untouched", () => {
        writeDormancyRecord(
                "project:api",
                { "d1": { excluded: 3, dormantSince: 123, revives: 1 }, "d2": { excluded: 3, dormantSince: 123 }, "live1": { excluded: 1 } },
                dir,
        );
        const n = reviveDormantByIds(["d1", "d2", "live1"], { scopeKey: "project:api", dir, by: "search" });
        expect(n).toBe(2); // only the two dormant
        const rec = readDormancyRecord("project:api", dir);
        expect(rec.d1.dormantSince).toBeUndefined();
        expect(rec.d1.excluded).toBe(0);
        expect(rec.d1.revives).toBe(2); // the prior one + this search
        expect(rec.d1.lastRevivedBy).toBe("search");
        expect(rec.live1.excluded).toBe(1); // untouched (not dormant — nothing to revive)
        expect(dormantCountFor("project:api", dir)).toBe(0);
});

test("dormantCountAll sums across every scope's record", () => {
        writeDormancyRecord("engine", { a: { excluded: 3, dormantSince: 1 } }, dir);
        writeDormancyRecord("project:api", { b: { excluded: 3, dormantSince: 1 }, c: { excluded: 3, dormantSince: 1 } }, dir);
        writeDormancyRecord("project:csv", { d: { excluded: 2 } }, dir);
        expect(dormantCountAll(dir)).toBe(3);
});

// ------------------------------------------------- the dream + server wiring

test("the dream path tracks dormancy per scope (consolidate wiring via the engine dream)", async () => {
        // consolidate() is internal; the public seam it uses is exactly this
        // pair, pinned end-to-end through a real dream in the CP7 battery.
        // Here: the scope key the dream path passes matches the record the
        // surfaces read — one key space, no drift.
        const engineKey = dormancyScopeKey(ENGINE_SCOPE);
        expect(engineKey).toBe("unown-engine");
        writeDormancyRecord(engineKey, { x: { excluded: 2 } }, dir);
        expect(isDormantId(readDormancyRecord(engineKey, dir), "x")).toBe(false);
});

test("the search lane revives and annotates: a dormant hit carries the badge and flips the record", async () => {
        // seed the platform + a dormant record in THIS test's dir, then drive
        // the engine API with PI_MEM0_DORMANT_AFTER=1 (excluded once → dormant)
        process.env.PI_MEM0_DORMANT_AFTER = "1";
        const { handleApi } = await import("../src/server.ts");
        const { setMemoryPlatformForTests } = await import("../src/memzero.ts");
        const prevMem0Dir = process.env.PI_MEM0_DIR;
        process.env.PI_MEM0_DIR = dir;
        platform.seed([
                { id: "sleepy", text: "the parser treats columns as 1-based offsets", updatedAt: "2026-11-01T00:00:00Z", metadata: { kind: "terminal-note", agent_id: "unown-engine" } },
        ]);
        setMemoryPlatformForTests(platform);
        try {
                // make the row dormant in the engine scope's record
                writeDormancyRecord("unown-engine", { sleepy: { excluded: 1, dormantSince: Date.now() } }, dir);
                const res = await handleApi({
                        method: "GET",
                        path: "/api/memories",
                        query: new URLSearchParams("q=parser"),
                        body: null,
                } as any);
                expect(res.status).toBe(200);
                const body = (await res.json()) as any;
                const hit = body.memories.find((m: any) => m.id === "sleepy");
                expect(hit).toBeDefined();
                expect(hit.dormant).toBe(true);       // the badge: answered from the sleeping shelf
                expect(hit.revivedBy).toBe("search"); // and this very search revived it
                const rec = readDormancyRecord("unown-engine", dir);
                expect(rec.sleepy.dormantSince).toBeUndefined();
                expect(rec.sleepy.lastRevivedBy).toBe("search");
        } finally {
                setMemoryPlatformForTests(null);
                if (prevMem0Dir === undefined) delete process.env.PI_MEM0_DIR;
                else process.env.PI_MEM0_DIR = prevMem0Dir;
        }
});
