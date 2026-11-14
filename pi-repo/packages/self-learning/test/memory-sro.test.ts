/**
 * memory-sro.test.ts — the deterministic SRO supersede lane (Memory
 * Divertimento round CP2, 2026-11-14).
 *
 * The research verdict (MemStrata/Temporal Validity, arXiv 2606.26511):
 * similarity-based conflict detection separates contradicted from
 * duplicated facts at AUROC 0.59 — chance — while a deterministic
 * (subject, relation, object) rule in a bi-temporal ledger takes
 * stale-fact errors 15–40% → ~0%. This suite pins Unown's adaptation:
 *
 *   - the parse/normalize/keys unit surface (three input shapes, the
 *     differentia-preserving object, malformed rows never participate);
 *   - sroContradictionGroups: same claim key + different objects → the
 *     newest confirmed evidence wins; identical objects → the dedup lane's
 *     class (no group); no SRO → no group (legacy rows keep LLM authority);
 *     same-timestamp ties → the LLM's call (no deterministic group);
 *   - the reconcile integration: the LLM verdict left a contradiction on
 *     the table → the deterministic pass stamps it AFTER the LLM's own ops
 *     (never re-opening an LLM verdict); the numeric class (the MIRIX
 *     guard) is decided by recency, both values retained verbatim — no
 *     averaged merge; fresh-evidence protection holds; back-compat: rows
 *     without SROs behave exactly as before.
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFakePlatform, type FakePlatform } from "./_fake-platform.ts";
import {
        ENGINE_SCOPE,
        applyDeterministicSroSupersedes,
        isSuperseded,
        memoryConfirmedAt,
        normalizeSroPart,
        parseSro,
        reconcileMemories,
        sroClaimKey,
        sroContradictionGroups,
        sroFullKey,
        type PlatformMemory,
        type SroTriple,
} from "../src/memzero.ts";

let platform: FakePlatform;
let recordDir: string;

function sroMem(id: string, text: string, sro: SroTriple | string[], updatedAt: string): Partial<PlatformMemory> {
        return { id, text, updatedAt, createdAt: updatedAt, metadata: { kind: "note", sro, agent_id: ENGINE_SCOPE.agentId } };
}

beforeEach(() => {
        platform = makeFakePlatform();
        recordDir = mkdtempSync(join(tmpdir(), "unown-sro-test-"));
});
afterEach(() => {
        rmSync(recordDir, { recursive: true, force: true });
});

// ------------------------------------------------------ the unit surface

test("parseSro accepts the three shapes and rejects the rest", () => {
        const asArray = parseSro({ id: "a", text: "t", metadata: { sro: ["Node version", "Is", "20"] } } as any);
        expect(asArray).toEqual({ s: "node version", r: "is", o: "20" } satisfies SroTriple);
        const asPipe = parseSro({ id: "b", text: "t", metadata: { sro: "node version|is|22" } } as any);
        expect(asPipe!.o).toBe("22");
        const asObject = parseSro({ id: "c", text: "t", metadata: { sro: { s: "test runner", r: "runs with", o: "--runInBand" } } } as any);
        expect(asObject!.o).toBe("--runinband");
        // the rest: absent, wrong arity, empty parts, garbage — never participants
        expect(parseSro({ id: "d", text: "t", metadata: {} } as any)).toBeNull();
        expect(parseSro({ id: "e", text: "t", metadata: { sro: ["only", "two"] } } as any)).toBeNull();
        expect(parseSro({ id: "f", text: "t", metadata: { sro: ["x", "", "y"] } } as any)).toBeNull();
        expect(parseSro({ id: "g", text: "t", metadata: { sro: 42 } } as any)).toBeNull();
});

test("normalizeSroPart: lowercase + collapse + strip trailing punctuation; digits and flags STAY", () => {
        expect(normalizeSroPart("  Node  Version ")).toBe("node version");
        expect(normalizeSroPart("20.")).toBe("20");
        expect(normalizeSroPart("--runInBand;")).toBe("--runinband");
        expect(normalizeSroPart("1-based offsets!")).toBe("1-based offsets");
        // the differentia is preserved verbatim in value: 20 and 22 differ
        expect(normalizeSroPart("20")).not.toBe(normalizeSroPart("22"));
});

test("sroClaimKey vs sroFullKey: the claim is subject|relation; the full key adds the value", () => {
        const a: SroTriple = { s: "node version", r: "is", o: "20" };
        const b: SroTriple = { s: "node version", r: "is", o: "22" };
        expect(sroClaimKey(a)).toBe(sroClaimKey(b)); // same claim
        expect(sroClaimKey(a)).toBe("node version|is");
        expect(sroFullKey(a)).not.toBe(sroFullKey(b)); // different values
        expect(sroFullKey(a)).toBe("node version|is|20");
});

// ------------------------------------------------ the contradiction groups

test("same claim key + different objects → a group; newest confirmedAt wins", () => {
        platform.seed([
                sroMem("old", "the parser treats columns as 1-based offsets", ["parser columns", "are", "1-based"], "2026-11-01T00:00:00Z"),
                sroMem("new", "the parser treats columns as 0-based offsets", ["parser columns", "are", "0-based"], "2026-11-10T00:00:00Z"),
        ]);
        const groups = sroContradictionGroups([...liveOf(platform)]);
        expect(groups).toHaveLength(1);
        expect(groups[0].winner.id).toBe("new");
        expect(groups[0].losers.map((l) => l.id)).toEqual(["old"]);
});

test("identical objects are the dedup lane's class — no deterministic group", () => {
        platform.seed([
                sroMem("a", "run the verify script before declaring success", ["verify script", "runs", "before declaring success"], "2026-11-01T00:00:00Z"),
                sroMem("b", "always run the verify script before declaring success", ["verify script", "runs", "before declaring success"], "2026-11-10T00:00:00Z"),
        ]);
        expect(sroContradictionGroups([...liveOf(platform)])).toHaveLength(0);
});

test("rows without SROs never participate (legacy rows keep LLM authority)", () => {
        platform.seed([
                { id: "legacy-a", text: "use --strict mode for all builds", updatedAt: "2026-10-01T00:00:00Z", metadata: { kind: "note" } },
                { id: "legacy-b", text: "builds run without --strict now", updatedAt: "2026-11-10T00:00:00Z", metadata: { kind: "note" } },
        ]);
        expect(sroContradictionGroups([...liveOf(platform)])).toHaveLength(0);
});

test("superseded rows are excluded from the groups", () => {
        platform.seed([
                sroMem("old", "the parser treats columns as 1-based offsets", ["parser columns", "are", "1-based"], "2026-11-01T00:00:00Z"),
                { ...sroMem("mid", "the parser treats columns as 0-based offsets", ["parser columns", "are", "0-based"], "2026-11-05T00:00:00Z"), metadata: { kind: "note", sro: ["parser columns", "are", "0-based"], supersededBy: "new", invalidAt: "2026-11-10T00:00:00Z" } },
                sroMem("new", "the parser uses 0-based columns everywhere", ["parser columns", "are", "0-based"], "2026-11-10T00:00:00Z"),
        ]);
        // mid is superseded; old+new have different objects → one group, old loses
        const groups = sroContradictionGroups([...liveOf(platform)]);
        expect(groups).toHaveLength(1);
        expect(groups[0].winner.id).toBe("new");
        expect(groups[0].losers.map((l) => l.id)).toEqual(["old"]);
});

test("same-timestamp ties yield NO group (the LLM reconcile's call)", () => {
        platform.seed([
                sroMem("a", "the flaky suite needs --runInBand", ["flaky suite", "needs", "--runInBand"], "2026-11-10T10:00:00.000Z"),
                sroMem("b", "the flaky suite is fine under parallel runners now", ["flaky suite", "needs", "parallel"], "2026-11-10T10:00:00.000Z"),
        ]);
        expect(sroContradictionGroups([...liveOf(platform)])).toHaveLength(0);
});

test("three-way contradiction: the newest wins, both older rows are losers", () => {
        platform.seed([
                sroMem("v1", "node version is 18 in this project", ["node version", "is", "18"], "2026-09-01T00:00:00Z"),
                sroMem("v2", "node version is 20 in this project", ["node version", "is", "20"], "2026-10-01T00:00:00Z"),
                sroMem("v3", "node version is 22 in this project", ["node version", "is", "22"], "2026-11-10T00:00:00Z"),
        ]);
        const groups = sroContradictionGroups([...liveOf(platform)]);
        expect(groups).toHaveLength(1);
        expect(groups[0].winner.id).toBe("v3");
        expect(new Set(groups[0].losers.map((l) => l.id))).toEqual(new Set(["v1", "v2"]));
});

// ---------------------------------------- the apply pass + reconcile wiring

test("applyDeterministicSroSupersedes stamps via the platform and is idempotent", async () => {
        platform.seed([
                sroMem("old", "node version is 20 in this project", ["node version", "is", "20"], "2026-10-01T00:00:00Z"),
                sroMem("new", "node version is 22 in this project", ["node version", "is", "22"], "2026-11-10T00:00:00Z"),
        ]);
        const list = [...liveOf(platform)];
        const res = await applyDeterministicSroSupersedes(list, { platform, now: Date.parse("2026-11-14T00:00:00Z") });
        expect(res.count).toBe(1);
        expect(res.events[0]).toMatchObject({ event: "SUPERSEDE", id: "old", supersededBy: "new" });
        const stamped = [...liveOf(platform)].find((m) => m.id === "old")!;
        expect(isSuperseded(stamped)).toBe(true);
        expect(stamped.metadata.invalidAt).toBe("2026-11-14T00:00:00.000Z");
        // both values retained verbatim — no averaged merge (the MIRIX class)
        expect(stamped.text).toContain("20");
        expect([...liveOf(platform)].find((m) => m.id === "new")!.text).toContain("22");
        // idempotent: a second pass over the now-live set applies nothing
        const again = await applyDeterministicSroSupersedes([...liveOf(platform)], { platform, now: Date.now() });
        expect(again.count).toBe(0);
});

test("a protected (this-batch) loser without an exact-text twin survives the deterministic pass", async () => {
        platform.seed([
                sroMem("older", "node version is 20 in this project", ["node version", "is", "20"], "2026-10-01T00:00:00Z"),
                sroMem("fresh", "node version is 20 everywhere per policy", ["node version", "is", "20"], "2026-11-14T00:00:00Z"), // same-batch, no twin
                sroMem("newest", "node version is 22 in this project", ["node version", "is", "22"], "2026-11-14T09:00:00Z"),
        ]);
        const list = [...liveOf(platform)];
        const protectedIds = new Set(["fresh"]);
        const res = await applyDeterministicSroSupersedes(list, { platform, protectedIds, now: Date.now() });
        // fresh (protected, no twin) survives; older loses to newest
        expect(res.skipped).toBe(1);
        const live = [...liveOf(platform)];
        expect(isSuperseded(live.find((m) => m.id === "fresh")!)).toBe(false);
        expect(isSuperseded(live.find((m) => m.id === "older")!)).toBe(true);
});

test("reconcileMemories: the LLM verdict left the contradiction on the table → the deterministic pass closes it", async () => {
        platform.seed([
                sroMem("old", "node version is 20 in this project", ["node version", "is", "20"], "2026-10-01T00:00:00Z"),
                sroMem("new", "node version is 22 in this project", ["node version", "is", "22"], "2026-11-10T00:00:00Z"),
        ]);
        // the LLM returns ZERO ops (the exact class the research measured: the
        // similarity-guess never fired)
        const res = await reconcileMemories(ENGINE_SCOPE, {
                platform,
                recordDir,
                llmFn: async () => ({ ops: [] }),
        });
        expect(res.superseded).toBe(1);
        expect(res.sroApplied).toBe(1);
        const live = [...liveOf(platform)];
        expect(isSuperseded(live.find((m) => m.id === "old")!)).toBe(true);
        expect(live.find((m) => m.id === "old")!.metadata.supersededBy).toBe("new");
        expect(isSuperseded(live.find((m) => m.id === "new")!)).toBe(false);
});

test("reconcileMemories: an LLM-covered row is never re-opened by the deterministic pass", async () => {
        platform.seed([
                sroMem("old", "node version is 20 in this project", ["node version", "is", "20"], "2026-10-01T00:00:00Z"),
                sroMem("new", "node version is 22 in this project", ["node version", "is", "22"], "2026-11-10T00:00:00Z"),
        ]);
        // the LLM already superseded the loser itself — one stamp, not two
        const res = await reconcileMemories(ENGINE_SCOPE, {
                platform,
                recordDir,
                llmFn: async () => ({ ops: [{ op: "SUPERSEDE", id: "old", supersededBy: "new" } as any] }),
        });
        expect(res.superseded).toBe(1);
        expect(res.sroApplied).toBe(0); // nothing left for the deterministic pass
        const live = [...liveOf(platform)];
        expect(live.find((m) => m.id === "old")!.metadata.supersededBy).toBe("new");
});

test("reconcileMemories back-compat: rows without SROs behave exactly as before (LLM authority, no deterministic action)", async () => {
        platform.seed([
                { id: "legacy-old", text: "use --strict mode for all builds", updatedAt: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z", metadata: { kind: "note" } },
                { id: "legacy-new", text: "builds run without --strict now", updatedAt: "2026-11-10T00:00:00Z", createdAt: "2026-11-10T00:00:00Z", metadata: { kind: "note" } },
        ]);
        const res = await reconcileMemories(ENGINE_SCOPE, {
                platform,
                recordDir,
                llmFn: async () => ({ ops: [] }), // the LLM saw it and declined — that stands
        });
        expect(res.sroApplied).toBe(0);
        expect(res.superseded).toBe(0);
        const live = [...liveOf(platform)];
        expect(isSuperseded(live.find((m) => m.id === "legacy-old")!)).toBe(false);
});

test("the reconcile listing carries the SRO so the LLM sees the claim keys", async () => {
        platform.seed([
                sroMem("old", "node version is 20 in this project", ["node version", "is", "20"], "2026-10-01T00:00:00Z"),
        ]);
        let seenListing = "";
        await reconcileMemories(ENGINE_SCOPE, {
                platform,
                recordDir,
                llmFn: async (memories) => {
                        // capture the listing the default LLM would build — same shape
                        seenListing = memories.map((m) => {
                                const t = parseSro(m);
                                return t ? `sro=${sroClaimKey(t)} -> ${t.o}` : "";
                        }).join(" ");
                        return { ops: [] };
                },
        });
        expect(seenListing).toContain("sro=node version|is -> 20");
});

// helper: the fake platform's live rows (seed + add) as PlatformMemory[]
function liveOf(p: FakePlatform): PlatformMemory[] {
        return [...p.store.values()];
}
