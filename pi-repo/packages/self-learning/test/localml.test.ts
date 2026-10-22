// Unit tests for the H15 local-ML dream lanes (src/localml.ts + the dream.ts
// wiring) — the opt-in pre-processors around the UNCHANGED dream LLM call,
// ported from the VERIFIED benchmarks/nonllm experiments:
//   - MinHash-union dedup  (N2 / H11: structural tier 100% recall @0.18ms/doc)
//   - activation ranking   (N4 / H13: no-recency recipe, rho 0.486-0.567)
//   - hybrid curation      (N5 / H14: top-30% full + LexRank tail, 19.9% cut,
//                           judge leans curated)
//
// What is pinned, per the wiring contract:
//   - all flags unset (default): applyDreamNoteLanes is the identity — notes
//     out === notes in (same array), no events, mode "off" — so the dream
//     prompt is byte-identical to the pre-integration shape.
//   - live mode + dedup: seeded near-dup notes collapse (the LATER duplicate
//     drops), distinct notes survive, and the surviving note carries
//     origIndex so guard banners derive from ORIGINAL content.
//   - live mode + rank: notes reorder by the no-recency activation recipe
//     (outcome-bearing, substantial notes dream FIRST; recency tiebreaks).
//   - live mode + curate: the top-30% head passes through UNCHANGED, the
//     tail compresses (never below the floor, first line always kept) —
//     token accounting lands in events.curate.
//   - shadow mode: lanes compute (events emitted) but the RETURNED notes are
//     the originals — the assembled dream prompt stays byte-identical.
//   - the embedder degrades: PI_LOCAL_ML_DIR pointing at a nonexistent dir
//     means MinHash-only dedup (no throw, embedder event absent).
//   - runDream integration (post-swap): the lanes are RETIRED from the dream
//     pipeline — dedup is the memory platform's job now (mem0 extraction + the
//     reconcile pass), so the dream hands every note to the platform verbatim
//     regardless of the legacy lane flags, and no lane:dream event fires. What
//     is pinned: unset flags -> exactly ONE llm.ts chat call (the reconcile
//     pass — cost parity with the old single-call dream) and every original
//     note body reaching the platform's add() input; live mode -> the near-dup
//     ALSO flows into the platform (the engine never pre-drops notes) and the
//     collapse happens inside the platform via the reconcile verdict; shadow
//     mode -> the platform input is byte-identical to flags-unset (the retired
//     lanes cannot alter the dream's input surface).
//
// Env: ./_env.ts redirects the store to scratch before module scope opens.
// The lane flags are CALL-time reads (the mint.ts pattern), so tests toggle
// them per case; the LLM is mocked via globalThis.fetch; runDream gets the
// deterministic fake platform via opts.platform (dream-guard.test.ts style —
// no real embedder, no mem0 SQLite, no network).
import "./_env.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { applyDreamNoteLanes, compressNote, localmlConfig, nearDupPairs, resetEmbedder, structuralScore } from "../src/localml.ts";
import { runDream } from "../src/dream.ts";
import { subscribe } from "../src/bus.ts";
import { readTier, tierPath } from "../src/memory.ts";
import { undreamedNotes } from "../src/notes.ts";
import { makeFakePlatform, type FakePlatform } from "./_fake-platform.ts";
import { store } from "../src/store.ts";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
let bodies: any[] = [];

/**
 * Mock the llm-bridge chat endpoint. A reply is either a canned record or a
 * function of the REQUEST body (the reconcile-verdict tests derive their
 * verdict from the memory listing the engine actually sent).
 */
function mockBridge(replies: Array<Record<string, unknown> | ((body: any) => Record<string, unknown>)>): void {
        bodies = [];
        globalThis.fetch = (async (_input: unknown, init?: any) => {
                const body = JSON.parse(String(init?.body ?? "{}"));
                bodies.push(body);
                const reply = replies[Math.min(bodies.length - 1, replies.length - 1)];
                const resolved = typeof reply === "function" ? (reply as (b: any) => Record<string, unknown>)(body) : reply;
                const content = resolved.content ?? "";
                return new Response(
                        JSON.stringify({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] }),
                        { headers: { "content-type": "application/json" } },
                );
        }) as typeof fetch;
}

/** A benign reconcile verdict: the LLM said "nothing to reconcile". */
function noOpsReply(): Record<string, unknown> {
        return { content: JSON.stringify({ ops: [] }) };
}

/** The note contents handed to the platform's add() (the extraction input). */
function platformAddInputs(platform: FakePlatform): string[] {
        const inputs: string[] = [];
        for (const c of platform.calls.filter((x) => x.op === "add")) {
                try {
                        const parsed = JSON.parse(String(c.input ?? "[]"));
                        if (Array.isArray(parsed)) for (const m of parsed) inputs.push(String(m?.content ?? ""));
                        else inputs.push(String(parsed));
                } catch {
                        /* non-JSON add input (string form) */
                }
        }
        return inputs;
}

function seedNotes(n: number, prefix = "note"): Array<{ id: string; content: string; created_at: number; run_id: string }> {
        const base = Date.now() - n * 60_000;
        return Array.from({ length: n }, (_, i) => ({
                id: `n${prefix}-${i}-${Math.random().toString(36).slice(2, 8)}`,
                content:
                        `Task t${i}: ${prefix} ${i}\n` +
                        (i % 3 === 0
                                ? "Status: PASSED. The test run verified the fixture count matches the spec after the parser fix."
                                : "Status: FAILED. Error: the parser returned 0 rows for the quoted-field case; fix the split loop.") +
                        `\nTool notes: ran the bash test command for task t${i}.`,
                created_at: base + i * 60_000,
                run_id: `run-${i}`,
        }));
}

function insertNotes(notes: Array<{ id: string; content: string; created_at: number; run_id: string }>) {
        for (const n of notes) {
                store.run(
                        `INSERT INTO notes (id, run_id, content, created_at, kind) VALUES (?, ?, ?, ?, 'benchmark')`,
                        [n.id, n.run_id, n.content, n.created_at],
                );
        }
}


async function withBusEvents(name: string, fn: () => Promise<any>): Promise<{ result: any; events: any[] }> {
        const events: any[] = [];
        const unsub = subscribe((e: any) => {
                if (e.event === name) events.push(e.payload);
        });
        try {
                const result = await fn();
                return { result, events };
        } finally {
                unsub();
        }
}

const LANE_ENV_KEYS = ["PI_LOCAL_ML", "PI_NOTE_DEDUP", "PI_MEMORY_RANK", "PI_DREAM_CURATE", "PI_LOCAL_ML_DIR"] as const;

afterEach(() => {
        globalThis.fetch = realFetch;
        for (const k of [...LANE_ENV_KEYS, "PI_DREAM_GATE"]) delete process.env[k];
        resetEmbedder();
});

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

describe("localmlConfig", () => {
        test("unset = everything off (the identity default)", () => {
                const cfg = localmlConfig({});
                expect(cfg.mode).toBe("off");
                expect(cfg.dedup).toBe(false);
                expect(cfg.rank).toBe(false);
                expect(cfg.curate).toBe(false);
        });

        test("mode parsing: shadow / 1 / live", () => {
                expect(localmlConfig({ PI_LOCAL_ML: "shadow" }).mode).toBe("shadow");
                expect(localmlConfig({ PI_LOCAL_ML: "1" }).mode).toBe("live");
                expect(localmlConfig({ PI_LOCAL_ML: "live" }).mode).toBe("live");
                expect(localmlConfig({ PI_LOCAL_ML: "nope" }).mode).toBe("off");
        });

        test("lane flags are exact-match opt-in", () => {
                expect(localmlConfig({ PI_NOTE_DEDUP: "UNION" }).dedup).toBe(true);
                expect(localmlConfig({ PI_NOTE_DEDUP: "lsh" }).dedup).toBe(false);
                expect(localmlConfig({ PI_MEMORY_RANK: "activation" }).rank).toBe(true);
                expect(localmlConfig({ PI_DREAM_CURATE: "hybrid" }).curate).toBe(true);
        });
});

// ---------------------------------------------------------------------------
// lanes (pure)
// ---------------------------------------------------------------------------

describe("nearDupPairs (H11 union lane)", () => {
        test("collapses structural near-dups, keeps distinct notes", () => {
                const base = "Status: PASSED. The parser fix landed and the test run verified the fixture count. Tool notes: ran the bash test command.";
                const near = base + "\nLatency note: 2.1s wall clock on this run."; // append-noise perturbation (N2 class)
                const other = "Completely different topic: the router now fences hook payloads by schema before dispatch.";
                const pairs = nearDupPairs([base, near, other]);
                expect(pairs.length).toBe(1);
                expect(pairs[0]![0]).toBe(0);
                expect(pairs[0]![1]).toBe(1);
                expect(pairs[0]![2]).toBeGreaterThan(0.5);
        });

        test("empty and tiny inputs are safe", () => {
                expect(nearDupPairs([])).toEqual([]);
                expect(nearDupPairs(["", "completely different content here"]).length).toBe(0);
                // two empty strings are trivially identical — they DO pair (harmless:
                // dream notes are never empty, ingestion validates)
                expect(nearDupPairs(["", ""]).length).toBe(1);
        });
});

describe("compressNote (H14 curation lane)", () => {
        test("keeps the first line and floors the ratio — never collapses to nothing", () => {
                const note =
                        "Task 12: fix the CSV parser\n" +
                        "Status: FAILED. The split loop broke on quoted commas. " +
                        "The regression suite caught it after the refactor. " +
                        "The fix moved the quote handling into a helper. " +
                        "Tests now pass with embedded commas.";
                const c = compressNote(note);
                expect(c.total).toBeGreaterThan(3);
                expect(c.kept).toBeGreaterThanOrEqual(Math.max(1, Math.round(c.total * 0.35)));
                expect(c.text.split("\n")[0]).toBe("Task 12: fix the CSV parser");
                expect(c.kept).toBeLessThanOrEqual(c.total);
        });

        test("short notes pass through effectively unchanged", () => {
                const short = "one line status passed";
                const c = compressNote(short);
                expect(c.total).toBeLessThanOrEqual(1);
        });
});

describe("structuralScore (H13 activation lane)", () => {
        test("outcome-bearing substantive notes outrank stubs", () => {
                const rich = "Status: FAILED. Error: parser returned 0 rows; tool: bash test run; ".repeat(4);
                const stub = "ok";
                expect(structuralScore(rich)).toBeGreaterThan(structuralScore(stub));
        });
});

// ---------------------------------------------------------------------------
// applyDreamNoteLanes (the orchestration)
// ---------------------------------------------------------------------------

describe("applyDreamNoteLanes", () => {
        test("flags unset: identity — same array out, mode off, no events", async () => {
                const notes = seedNotes(4);
                const r = await applyDreamNoteLanes(notes);
                expect(r.events.mode).toBe("off");
                expect(r.notes).toBe(notes); // SAME array (not a copy)
        });

        test("live + dedup: later near-dups drop, survivors carry origIndex", async () => {
                process.env.PI_LOCAL_ML = "live";
                process.env.PI_NOTE_DEDUP = "union";
                process.env.PI_LOCAL_ML_DIR = "/nonexistent-local-ml"; // embedder off -> minhash-only
                const base = "Status: PASSED. Parser fix verified the fixture count. Tool notes: bash test run.";
                const near = base + "\nLatency note: 2.1s wall clock.";
                const other = "Different: router fences hook payloads by schema before dispatch now.";
                const r = await applyDreamNoteLanes([
                        { content: base, created_at: 1 },
                        { content: near, created_at: 2 },
                        { content: other, created_at: 3 },
                ]);
                expect(r.events.mode).toBe("live");
                expect(r.events.dedup).toBeDefined();
                expect(r.events.dedup!.dropped).toBe(1);
                expect(r.notes.length).toBe(2);
                expect(r.notes[0]!.origIndex).toBe(0);
                expect(r.notes[0]!.content).toBe(base);
        });

        test("shadow mode: events computed, notes returned UNCHANGED", async () => {
                process.env.PI_LOCAL_ML = "shadow";
                process.env.PI_NOTE_DEDUP = "union";
                process.env.PI_DREAM_CURATE = "hybrid";
                process.env.PI_LOCAL_ML_DIR = "/nonexistent-local-ml";
                const base = "Status: PASSED. Parser fix verified the fixture count. Tool notes: bash test run.";
                const near = base + "\nLatency note: 2.1s wall clock.";
                const other = "Different: router fences hook payloads by schema before dispatch now.";
                const input = [
                        { content: base, created_at: 1 },
                        { content: near, created_at: 2 },
                        { content: other, created_at: 3 },
                ];
                const r = await applyDreamNoteLanes(input);
                expect(r.events.mode).toBe("shadow");
                expect(r.events.dedup).toBeDefined(); // computed...
                expect(r.events.curate).toBeDefined(); // ...reported...
                expect(r.notes).toBe(input); // ...but NOT applied
        });

        test("live + curate: head full, tail compressed, token accounting", async () => {
                process.env.PI_LOCAL_ML = "live";
                process.env.PI_DREAM_CURATE = "hybrid";
                process.env.PI_LOCAL_ML_DIR = "/nonexistent-local-ml";
                const notes = Array.from({ length: 10 }, (_, i) => ({
                        content:
                                `Task ${i}: header line for task ${i}\n` +
                                "Status: FAILED. The split loop broke on quoted commas badly. ".repeat(6) +
                                "The fix moved quote handling into a helper function. Tests now pass with embedded commas.",
                        created_at: Date.now() - i * 60_000,
                }));
                const r = await applyDreamNoteLanes(notes);
                expect(r.events.curate).toBeDefined();
                const c = r.events.curate!;
                expect(c.notes).toBe(10);
                expect(c.compressed).toBeGreaterThan(0); // the 70% tail
                expect(c.tokensAfter).toBeLessThan(c.tokensBefore);
                // head (top 30% = 3 notes) must be byte-identical
                expect(r.notes[0]!.content).toBe(notes[0]!.content);
                expect(r.notes[2]!.content).toBe(notes[2]!.content);
                // first line of every compressed note survives
                for (const n of r.notes.slice(3)) {
                        const orig = notes[n.origIndex!]!;
                        expect(n.content.split("\n")[0]).toBe(orig.content.split("\n")[0]);
                }
        });

        test("live + rank: activation ordering with recency as tiebreaker only", async () => {
                process.env.PI_LOCAL_ML = "live";
                process.env.PI_MEMORY_RANK = "activation";
                process.env.PI_LOCAL_ML_DIR = "/nonexistent-local-ml";
                const now = Date.now();
                const stubOld = { content: "ok", created_at: now - 100_000 }; // old stub
                const richNew = {
                        content: "Status: FAILED. Error: parser returned 0 rows for quoted fields. Tool: bash test. " + "x".repeat(400),
                        created_at: now - 1000,
                };
                const r = await applyDreamNoteLanes([stubOld, richNew]);
                expect(r.events.rank).toBeDefined();
                // the substantive FAILED note outranks the stub regardless of age
                expect(r.notes[0]!.content).toBe(richNew.content);
        });

        test("missing embedder degrades silently (minhash-only via, no embedder event)", async () => {
                process.env.PI_LOCAL_ML = "live";
                process.env.PI_NOTE_DEDUP = "union";
                process.env.PI_MEMORY_RANK = "activation";
                process.env.PI_LOCAL_ML_DIR = "/nonexistent-local-ml";
                const base = "Status: PASSED. Parser fix verified the fixture count. Tool notes: bash test run.";
                const near = base + "\nLatency note: 2.1s wall clock.";
                const r = await applyDreamNoteLanes([
                        { content: base, created_at: 1 },
                        { content: near, created_at: 2 },
                ]);
                expect(r.events.embedder).toBeNull();
                expect(r.events.dedup!.via).toContain("minhash-only");
        });
});

// ---------------------------------------------------------------------------
// runDream wiring (the seam, post-swap)
// ---------------------------------------------------------------------------

/** Reset the dream's engine-scope state so each wiring test is self-contained. */
function resetDreamState(): void {
        store.run(`DELETE FROM notes`);
        store.run(`DELETE FROM dreams`);
        store.run(`DELETE FROM memory_versions WHERE tier = 'project'`);
        rmSync(tierPath("project"), { force: true });
}

describe("runDream wiring", () => {
        test("flags unset: one chat call, original note contents reach the platform, no lane events", async () => {
                process.env.PI_DREAM_GATE = "0";
                resetDreamState();

                const notes = seedNotes(3);
                insertNotes(notes);
                mockBridge([noOpsReply()]);
                const platform = makeFakePlatform();
                const { result: res, events } = await withBusEvents("lane:dream", () => runDream({ platform }));
                expect(res.status).toBe("done");
                // ONE llm.ts chat call: the reconcile pass over the extracted memories
                // (cost parity with the old single-call AutoDream dream).
                expect(bodies.length).toBe(1);
                // The reconcile call saw the extracted memories (kind=terminal-note),
                // not a hand-built prompt of raw notes.
                const reconcileUser = String(bodies[0]!.messages[1].content);
                expect(reconcileUser).toContain("kind=terminal-note");
                expect(reconcileUser).toContain("verified the fixture count matches the spec");
                // Every ORIGINAL note body reached the platform's extraction input
                // verbatim — the engine no longer rewrites dream input at all.
                const inputs = platformAddInputs(platform);
                for (const n of notes) expect(inputs).toContain(n.content);
                // The retired lane pipeline never fires from the dream path.
                expect(events.length).toBe(0);
                // Notes consumed — the dream completed honestly.
                expect(undreamedNotes(24, "benchmark").length).toBe(0);
        });

        test("live mode: dedup is the platform's job — the near-dup flows in verbatim and the reconcile verdict collapses it", async () => {
                process.env.PI_DREAM_GATE = "0";
                resetDreamState();

                process.env.PI_LOCAL_ML = "live";
                process.env.PI_NOTE_DEDUP = "union";
                process.env.PI_LOCAL_ML_DIR = "/nonexistent-local-ml";
                const base = "Status: PASSED. Parser fix verified the fixture count matches the spec. Tool notes: ran the bash test command.";
                const near = base + "\nLatency note: 2.1s wall clock on this run.";
                const other = "Router note: hook payloads are fenced by schema before dispatch reaches the runner.";
                // undreamedNotes returns NEWEST-FIRST — base must be the newest note
                const notes = [
                        { id: `a-${Math.random().toString(36).slice(2, 8)}`, content: base, created_at: Date.now() - 30_000, run_id: "r1" },
                        { id: `b-${Math.random().toString(36).slice(2, 8)}`, content: near, created_at: Date.now() - 60_000, run_id: "r2" },
                        { id: `c-${Math.random().toString(36).slice(2, 8)}`, content: other, created_at: Date.now() - 90_000, run_id: "r3" },
                ];
                insertNotes(notes);
                const platform = makeFakePlatform();
                // The reconcile verdict is derived from the memory listing the engine
                // actually sent: the base line was extracted from BOTH near-dup notes —
                // the verdict DELETEs the duplicate (mem0's dedup judgment, applied
                // through the platform's own primitives).
                mockBridge([
                        (body: any) => {
                                const listing = String(body.messages[1].content);
                                const idsForText = (text: string) =>
                                        [...listing.matchAll(/^- id=(\S+).*?: (.+)$/gm)].filter((m) => m[2] === text).map((m) => m[1]!);
                                const dupIds = idsForText(base);
                                expect(dupIds.length).toBe(2); // the near-dup pair, both in the platform
                                return { content: JSON.stringify({ ops: [{ op: "DELETE", id: dupIds[1]!, reason: "near-duplicate" }] }) };
                        },
                ]);
                const { result: res, events } = await withBusEvents("lane:dream", () => runDream({ platform }));
                expect(res.status).toBe("done");
                expect(bodies.length).toBe(1);
                // BOTH near-dup notes flowed into the platform VERBATIM: pre-dream note
                // dedup is the platform's job now, never the engine's prompt surgery.
                const inputs = platformAddInputs(platform);
                expect(inputs).toContain(base);
                expect(inputs).toContain(near);
                expect(inputs).toContain(other);
                // The duplicate collapsed INSIDE the platform: one copy left, and the
                // shipped tier renders it exactly once.
                expect([...platform.store.values()].filter((m) => m.text === base).length).toBe(1);
                expect(res.pruned).toBe(1); // the DELETE verdict, attributed to the dream
                const tier = readTier("project");
                expect(tier.split(base).length - 1).toBe(1);
                // The retired lane pipeline never fires from the dream path.
                expect(events.length).toBe(0);
        });

        test("shadow mode: the platform input is byte-identical to flags-unset (the retired lanes cannot alter the dream)", async () => {
                process.env.PI_DREAM_GATE = "0";

                const base = "Status: PASSED. Parser fix verified the fixture count matches the spec. Tool notes: ran the bash test command.";
                const near = base + "\nLatency note: 2.1s wall clock on this run.";
                const other = "Router note: hook payloads are fenced by schema before dispatch reaches the runner.";
                const mk = (content: string, i: number, at: number) => ({
                        id: `s-${i}-${Math.random().toString(36).slice(2, 8)}`,
                        content,
                        created_at: at,
                        run_id: `r${i}`,
                });
                const at = Date.now() - 60_000;

                // -- baseline pass (flags unset)
                resetDreamState();
                const notes1 = [mk(base, 1, at - 30_000), mk(near, 2, at - 60_000), mk(other, 3, at - 90_000)];
                insertNotes(notes1);
                mockBridge([noOpsReply()]);
                const platformA = makeFakePlatform();
                const unset = await withBusEvents("lane:dream", () => runDream({ platform: platformA }));
                expect(unset.result.status).toBe("done");
                expect(unset.events.length).toBe(0);

                // -- shadow pass (same note contents, same created_at ordering)
                resetDreamState();
                const notes2 = [mk(base, 4, at - 30_000), mk(near, 5, at - 60_000), mk(other, 6, at - 90_000)];
                insertNotes(notes2);
                process.env.PI_LOCAL_ML = "shadow";
                process.env.PI_NOTE_DEDUP = "union";
                process.env.PI_DREAM_CURATE = "hybrid";
                process.env.PI_LOCAL_ML_DIR = "/nonexistent-local-ml";
                mockBridge([noOpsReply()]);
                const platformB = makeFakePlatform();
                const shadow = await withBusEvents("lane:dream", () => runDream({ platform: platformB }));
                expect(shadow.result.status).toBe("done");

                // The dream's input surface (what it hands the platform) is byte-identical:
                // shadow mode computes nothing that can reach the pipeline anymore.
                expect(platformAddInputs(platformB)).toEqual(platformAddInputs(platformA));
                // And the lane pipeline stays silent either way.
                expect(shadow.events.length).toBe(0);
        });
});
