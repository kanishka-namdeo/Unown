/**
 * memzero-unit.test.ts — pure-function pins for the Mem0 seam: the note
 * reframe used by the empty-extraction escalation, the add() result mapping,
 * and the payload-shape normalization (the metadata nesting regression).
 *
 * No platform construction, no SQLite, no LLM — these are the deterministic
 * invariants of the 2026-10-22 benchtest fixes.
 */
import { describe, expect, test } from "bun:test";
import {
        MEM0_CUSTOM_INSTRUCTIONS,
        normalizeMemories,
        reframeNoteForExtraction,
        RECONCILE_SYSTEM,
} from "../src/memzero.ts";

// ---------------------------------------------------------------- reframe

describe("reframeNoteForExtraction", () => {
        const NEW_NOTE = [
                "Terminal session outcome in /home/z/scratch/acme-api:",
                'Final outcome: Fixed dedupeRows in src/dedupe.ts — the function only did exact-match dedup, so CRLF line endings left \\r in the comparison key and output. Normalized each line with line.replace(/\\r$/, "") before comparing. bun test passes 2/2.',
                "Session metadata (counts, duration and session id only — data, not knowledge): 1 prompt(s), 5 tool call(s) (read, edit, bash), 1 min.",
        ].join("\n");

        const OLD_NOTE = [
                "Terminal session in /home/z/scratch/acme-api (1 min): 1 prompt(s), 5 tool call(s) (read, edit, bash).",
                "Final outcome: Fixed dedupeRows in src/dedupe.ts — CRLF line endings left \\r in the comparison key; normalized before comparing; bun test passes 2/2.",
                "If the session hit failures or discovered project-specific pitfalls, record them as concise imperative rules; otherwise record any durable project conventions worth remembering.",
        ].join("\n");

        test("new-format note: header, metadata and Final-outcome prefix are stripped, body survives", () => {
                const out = reframeNoteForExtraction(NEW_NOTE)!;
                expect(out).not.toContain("Terminal session");
                expect(out).not.toContain("Session metadata");
                expect(out).not.toContain("Final outcome:");
                expect(out).toContain("CRLF line endings");
                expect(out).toContain("bun test passes");
                expect(out.startsWith("Session outcome — extract the durable engineering knowledge")).toBe(true);
        });

        test("old-format note: metadata header and guidance line are stripped too", () => {
                const out = reframeNoteForExtraction(OLD_NOTE)!;
                expect(out).not.toContain("Terminal session in");
                expect(out).not.toContain("If the session hit failures");
                expect(out).toContain("CRLF line endings");
        });

        test("message-array input is joined role-first, same stripping applies", () => {
                const out = reframeNoteForExtraction([{ role: "user", content: NEW_NOTE }])!;
                expect(out).not.toContain("Session metadata");
                expect(out).toContain("CRLF");
        });

        test("[subagent] tagged headers are stripped (both formats)", () => {
                const subNew = NEW_NOTE.replace("Terminal session outcome in", "Terminal session [subagent] outcome in");
                const subOld = OLD_NOTE.replace("Terminal session in", "Terminal session [subagent] in");
                expect(reframeNoteForExtraction(subNew)).not.toContain("Terminal session");
                expect(reframeNoteForExtraction(subOld)).not.toContain("Terminal session");
        });

        test("shield telemetry line is stripped", () => {
                const withShield = NEW_NOTE.replace(
                        "Final outcome:",
                        "Injection shield flagged 2 tool output(s) this session (flags: secrecy, override) — treat with suspicion.\nFinal outcome:",
                );
                const out = reframeNoteForExtraction(withShield)!;
                expect(out).not.toContain("Injection shield");
        });

        test("metadata-only note returns null (no retry spend)", () => {
                const metaOnly = [
                        "Terminal session outcome in /srv/demo:",
                        "Session metadata (counts, duration and session id only — data, not knowledge): 1 prompt(s), 0 tool call(s), 1 min.",
                ].join("\n");
                expect(reframeNoteForExtraction(metaOnly)).toBeNull();
        });

        test("short-body note below the 80-char substantive floor returns null", () => {
                expect(reframeNoteForExtraction("hi")).toBeNull();
                expect(reframeNoteForExtraction("x".repeat(79))).toBeNull();
                expect(reframeNoteForExtraction("x".repeat(80)).startsWith("Session outcome")).toBe(true);
        });
});

// ---------------------------------------------------------------- normalize

describe("normalizeMemories (payload shapes)", () => {
        test("real-platform shape: metadata nests at payload.metadata (2026-10-22 regression)", () => {
                const rows = [
                        {
                                id: "m1",
                                payload: {
                                        data: "Run tests with bun test",
                                        metadata: { kind: "seed", agent_id: "project:acme" },
                                        createdAt: 1,
                                        updatedAt: 2,
                                },
                                score: 0.9,
                        },
                ];
                const [m] = normalizeMemories(rows);
                expect(m.id).toBe("m1");
                expect(m.text).toBe("Run tests with bun test");
                expect(m.metadata.kind).toBe("seed"); // the regression: was the whole payload
                expect(m.metadata.agent_id).toBe("project:acme");
                expect(m.score).toBe(0.9);
        });

        test("flat/fake shape: whole-payload fallback keeps metadata readable", () => {
                const rows = [{ id: "m2", data: "plain row", kind: "harness" }];
                const [m] = normalizeMemories(rows);
                expect(m.text).toBe("plain row");
                expect(m.metadata.kind).toBe("harness");
        });

        test("empty-text rows are dropped (the observed empty-memory store bug)", () => {
                const rows = [
                        { id: "ok", payload: { data: "real", metadata: {} } },
                        { id: "blank", payload: { data: "", metadata: {} } },
                        { id: "space", payload: { data: "   ", metadata: {} } },
                        { id: "", payload: { data: "no id" } },
                ];
                expect(normalizeMemories(rows)).toHaveLength(1);
        });
});

// ---------------------------------------------------------------- instructions

describe("MEM0_CUSTOM_INSTRUCTIONS", () => {
        test("carries the terminal-note carve-out (pitfalls/fixes are knowledge)", () => {
                expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("Terminal-session notes");
                expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("ONLY the counts/duration metadata itself is never extractable");
        });

        test("carries the pitfall-remedy carve-out (2026-10-23 extraction fix)", () => {
                // Measured live: agnes-3.0-flash read the old "runner/tool switches"
                // prohibition as covering VERIFIED WORKAROUNDS too — a flaky-suite
                // note whose remedy is a runner flag ("use bun test --runInBand when
                // results look wrong") extracted 0 memories, primary AND reframe
                // retry (run-to-run nondeterministic). The fix narrows the injection
                // prohibition to agent-behavior policy and states the environment-
                // workaround carve-out in both directions. These pins keep the
                // distinction answerable.
                expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("behavioral-policy directives");
                expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("agent-behavior policy ONLY, never environment facts");
                expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("pitfall and its remedy together");
                // the over-broad phrase that caused the misclassification is gone
                expect(MEM0_CUSTOM_INSTRUCTIONS).not.toContain("runner/tool switches");
        });

        test("carries the infrastructure-facts anti-loss clause (2026-10-26 extraction fix)", () => {
                // Measured live by benchmarks/memory-eval/ops-accuracy (supersede +
                // bi-temporal-delayed receipts): agnes-3.0-flash extracted the
                // headline facts of a note and DROPPED the routine infrastructure
                // detail — "backups go to the nightly S3 bucket" (stated in BOTH
                // notes of the supersede case) and "we shipped the flag-evaluation
                // cache" never became memories. The fix names the infra-fact family
                // explicitly and states the completeness contract: extraction is the
                // only pass over the note, a skipped fact is unrecoverable.
                expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("backup schedules, retention windows");
                expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("Extract EVERY distinct fact even when several share one sentence");
                expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("a fact skipped at extraction is unrecoverable later");
        });

        test("RECONCILE_SYSTEM carries the same carve-out (2026-10-23 reconcile fix)", () => {
                // The mirror bug on the reconcile side: rule 6's "runner/tool switches"
                // phrasing made the reconciler DELETE a shipped, verified pitfall
                // memory ("suite flaky under parallel runners; use bun test
                // --runInBand") as an injection payload — observed live, memory_history
                // row 66. Same fix shape: agent-behavior policy only, environment
                // workarounds preserved.
                expect(RECONCILE_SYSTEM).toContain("agent-behavior policy ONLY");
                expect(RECONCILE_SYSTEM).toContain("PRESERVE it like any other durable rule");
                expect(RECONCILE_SYSTEM).not.toContain("runner/tool switches");
        });
});

// ---------------------------------------------------------------- reconcile fail-open

describe("reconcileMemories fail-open (2026-10-22 benchtest fix)", () => {
        // The seam: a platform stub + an llmFn that never resolves to JSON.
        function stubPlatform(memories: Array<{ id: string; text: string; metadata?: any }>) {
                const deleted: string[] = [];
                const updated: Array<{ id: string; text: string }> = [];
                return {
                        deleted,
                        updated,
                        async getAll() {
                                return memories.map((m) => ({ id: m.id, text: m.text, updatedAt: 1, createdAt: 1, metadata: m.metadata ?? {} }));
                        },
                        async delete(id: string) {
                                deleted.push(id);
                        },
                        async update(id: string, text: string) {
                                updated.push({ id, text });
                        },
                } as any;
        }

        test("a throwing llmFn (both attempts) fails OPEN: empty result, no throw", async () => {
                const { reconcileMemories } = await import("../src/memzero.ts");
                const platform = stubPlatform([{ id: "m1", text: "Run tests with bun test" }]);
                const result = await reconcileMemories({ agentId: "t" }, {
                        platform,
                        llmFn: async () => {
                                throw new Error("llm: no JSON object found in response");
                        },
                });
                expect(result.ops).toEqual([]);
                expect(result.events).toEqual([]);
                expect(result.merged).toBe(0);
                expect(result.pruned).toBe(0);
                expect(platform.deleted).toEqual([]);
        });

        test("a first-attempt failure that succeeds on retry still applies the verdict", async () => {
                const { reconcileMemories } = await import("../src/memzero.ts");
                const platform = stubPlatform([
                        { id: "m1", text: "old rule: use winston for logging" },
                        { id: "m2", text: "new rule: use pino for logging (replaced winston)" },
                ]);
                let calls = 0;
                const result = await reconcileMemories({ agentId: "t" }, {
                        platform,
                        llmFn: async () => {
                                calls++;
                                if (calls === 1) throw new Error("transient");
                                return { ops: [{ op: "DELETE", id: "m1", reason: "superseded by m2" }] };
                        },
                });
                expect(calls).toBe(2);
                expect(result.pruned).toBe(1);
                expect(platform.deleted).toEqual(["m1"]);
        });

        test("an empty scope skips the LLM entirely (no spend)", async () => {
                const { reconcileMemories } = await import("../src/memzero.ts");
                let llmCalls = 0;
                const result = await reconcileMemories({ agentId: "t" }, {
                        platform: stubPlatform([]),
                        llmFn: async () => {
                                llmCalls++;
                                return { ops: [] };
                        },
                });
                expect(llmCalls).toBe(0);
                expect(result.ops).toEqual([]);
        });
});

describe("reconcileMemories idempotent op application", () => {
        test("a verdict targeting one id twice (DELETE then UPDATE) applies the first, skips the second", async () => {
                const { reconcileMemories } = await import("../src/memzero.ts");
                const deleted: string[] = [];
                const updated: Array<{ id: string; text: string }> = [];
                const platform = {
                        async getAll() {
                                return [
                                        { id: "m1", text: "old rule", updatedAt: 1, createdAt: 1, metadata: {} },
                                        { id: "m2", text: "new rule", updatedAt: 2, createdAt: 2, metadata: {} },
                                ];
                        },
                        async delete(id: string) {
                                if (deleted.includes(id)) throw new Error(`Memory with ID ${id} not found`);
                                deleted.push(id);
                        },
                        async update(id: string, text: string) {
                                if (deleted.includes(id)) throw new Error(`Memory with ID ${id} not found`);
                                updated.push({ id, text });
                        },
                } as any;
                const result = await reconcileMemories({ agentId: "t" }, {
                        platform,
                        llmFn: async () => ({
                                ops: [
                                        { op: "DELETE", id: "m1", reason: "superseded" },
                                        { op: "UPDATE", id: "m1", text: "reworded old rule", reason: "dupe op" },
                                ],
                        }),
                });
                expect(result.pruned).toBe(1);
                expect(deleted).toEqual(["m1"]);
                expect(updated).toEqual([]); // the UPDATE on the removed id was skipped, not thrown
        });

        test("a model leaking its rationale into an UPDATE text is stripped, not shipped", async () => {
                // Found live (2026-10-23, this repo's own scope): the reconciler model
                // answered with "…the new rule. Reason: tightened wording from…" — the
                // rationale belongs to the op's own `reason` field, and shipping it
                // renders meta-commentary into project memory (it reached this
                // repository's committed .unown/memory/project.md and broke the
                // landing page's verbatim-literal claims gate).
                const { reconcileMemories } = await import("../src/memzero.ts");
                const updated: Array<{ id: string; text: string }> = [];
                const platform = {
                        async getAll() {
                                return [
                                        { id: "m1", text: "Verify engine restart: GET /api/overview returns ok:true.", updatedAt: 1, createdAt: 1, metadata: {} },
                                ];
                        },
                        async delete() {},
                        async update(id: string, text: string) {
                                updated.push({ id, text });
                        },
                } as any;
                const result = await reconcileMemories({ agentId: "t" }, {
                        platform,
                        llmFn: async () => ({
                                ops: [
                                        {
                                                op: "UPDATE",
                                                id: "m1",
                                                text: "Verify engine health: GET /api/overview returns ok:true; check this after any engine restart or config change. Reason: Tightened wording from 'restart' to broader 'health' verification since 'ok:true' is a general health indicator.",
                                                reason: "tightened wording",
                                        },
                                ],
                        }),
                });
                expect(updated).toEqual([
                        { id: "m1", text: "Verify engine health: GET /api/overview returns ok:true; check this after any engine restart or config change." },
                ]);
                expect(result.merged).toBe(1);
        });
});

// ---------------------------------------------------------------------------
// Fresh-evidence protection (2026-11-11 Recital round, BUG 1)
//
// The live benchtest: session 3 reversed the strict ISO date rule; extraction
// correctly added the relaxed replacement, and the reconcile verdict then
// deleted BOTH the old strict rule (correct) and the fresh replacement (the
// current-state carrier) — leaving the project's memory with NO date rule at
// all. T3 recall failed with "no information". The guard: DELETE ops on ids
// born in the current batch are rejected deterministically.
// ---------------------------------------------------------------------------
describe("reconcileMemories fresh-evidence protection (2026-11-11 Recital BUG 1)", () => {
        function platformWith(memories: Array<{ id: string; text: string; createdAt: number }>) {
                const deleted: string[] = [];
                const updated: Array<{ id: string; text: string }> = [];
                return {
                        deleted,
                        updated,
                        async getAll() {
                                return memories.map((m) => ({ id: m.id, text: m.text, updatedAt: m.createdAt, createdAt: m.createdAt, metadata: {} }));
                        },
                        async delete(id: string) {
                                if (deleted.includes(id)) throw new Error(`Memory with ID ${id} not found`);
                                deleted.push(id);
                        },
                        async update(id: string, text: string) {
                                updated.push({ id, text });
                        },
                } as any;
        }

        test("a verdict deleting BOTH sides of a contradiction keeps the fresh carrier alive", async () => {
                const { reconcileMemories } = await import("../src/memzero.ts");
                // The exact live shape: old strict rule + fresh relaxed replacement.
                const platform = platformWith([
                        { id: "old-strict", text: "strict ISO date format YYYY-MM-DD enforced", createdAt: 1 },
                        { id: "fresh-relaxed", text: "strict ISO date rejection replaced with relaxed check: empty dates accepted, any parseable date accepted", createdAt: 2 },
                ]);
                const result = await reconcileMemories({ agentId: "t" }, {
                        platform,
                        // The observed failure verdict: the reconciler "resolved" the
                        // topic by deleting every memory about it — including the winner.
                        llmFn: async () => ({
                                ops: [
                                        { op: "DELETE", id: "old-strict", reason: "superseded" },
                                        { op: "DELETE", id: "fresh-relaxed", reason: "transition record about the superseded rule" },
                                ],
                        }),
                        protectedIds: ["fresh-relaxed"],
                });
                expect(platform.deleted).toEqual(["old-strict"]); // the loser still goes
                expect(result.pruned).toBe(1);
                expect(result.protectedDeletes).toBe(1); // the fresh winner survived, counted
        });

        test("protected ids still accept UPDATE (merge INTO the fresh memory is legal)", async () => {
                const { reconcileMemories } = await import("../src/memzero.ts");
                const platform = platformWith([{ id: "fresh", text: "auto-sizing with Math.max(4, ...)", createdAt: 2 }]);
                const result = await reconcileMemories({ agentId: "t" }, {
                        platform,
                        llmFn: async () => ({
                                ops: [{ op: "UPDATE", id: "fresh", text: "auto-sizing with Math.max(4, ...) (Updated 2026-11-05)", reason: "merge temporal marker" }],
                        }),
                        protectedIds: ["fresh"],
                });
                expect(platform.updated).toEqual([{ id: "fresh", text: "auto-sizing with Math.max(4, ...) (Updated 2026-11-05)" }]);
                expect(platform.deleted).toEqual([]);
                expect(result.protectedDeletes).toBe(0);
        });

        test("without protectedIds the same verdict is applied as before (opt-in guard)", async () => {
                const { reconcileMemories } = await import("../src/memzero.ts");
                const platform = platformWith([
                        { id: "old", text: "old rule", createdAt: 1 },
                        { id: "fresh", text: "new rule", createdAt: 2 },
                ]);
                const result = await reconcileMemories({ agentId: "t" }, {
                        platform,
                        llmFn: async () => ({
                                ops: [
                                        { op: "DELETE", id: "old", reason: "x" },
                                        { op: "DELETE", id: "fresh", reason: "y" },
                                ],
                        }),
                });
                expect(platform.deleted).toEqual(["old", "fresh"]);
                expect(result.protectedDeletes).toBe(0);
        });

        test("an empty protectedIds set protects nothing but stays green", async () => {
                const { reconcileMemories } = await import("../src/memzero.ts");
                const platform = platformWith([{ id: "m1", text: "rule", createdAt: 1 }]);
                const result = await reconcileMemories({ agentId: "t" }, {
                        platform,
                        llmFn: async () => ({ ops: [{ op: "DELETE", id: "m1", reason: "stale" }] }),
                        protectedIds: [],
                });
                expect(platform.deleted).toEqual(["m1"]);
                expect(result.protectedDeletes).toBe(0);
        });

        test("exact-twin carve-out: a same-batch duplicate pair may still collapse (platform dedup stays legal)", async () => {
                // mem0's own dedup judgment DELETEs one of two same-batch twins —
                // the content survives in the twin, so the guard must let it
                // through (the localml dream-wiring contract: "dedup is the
                // platform's job — the reconcile verdict collapses the pair").
                const { reconcileMemories } = await import("../src/memzero.ts");
                const twinText = "Parser fix verified the fixture count matches the spec";
                const platform = platformWith([
                        { id: "twin-a", text: twinText, createdAt: 2 },
                        { id: "twin-b", text: twinText, createdAt: 2 },
                        { id: "other", text: "Router note: hook payloads are fenced by schema", createdAt: 1 },
                ]);
                const result = await reconcileMemories({ agentId: "t" }, {
                        platform,
                        llmFn: async () => ({ ops: [{ op: "DELETE", id: "twin-b", reason: "near-duplicate" }] }),
                        protectedIds: ["twin-a", "twin-b", "other"],
                });
                expect(platform.deleted).toEqual(["twin-b"]); // the twin's content survives in twin-a
                expect(result.pruned).toBe(1);
                expect(result.protectedDeletes).toBe(0);
        });

        test("deleting BOTH twins is still rejected (no sole carrier of fresh content dies)", async () => {
                const { reconcileMemories } = await import("../src/memzero.ts");
                const twinText = "Parser fix verified the fixture count matches the spec";
                const platform = platformWith([
                        { id: "twin-a", text: twinText, createdAt: 2 },
                        { id: "twin-b", text: twinText, createdAt: 2 },
                ]);
                const result = await reconcileMemories({ agentId: "t" }, {
                        platform,
                        llmFn: async () => ({
                                ops: [
                                        { op: "DELETE", id: "twin-a", reason: "x" },
                                        { op: "DELETE", id: "twin-b", reason: "y" },
                                ],
                        }),
                        protectedIds: ["twin-a", "twin-b"],
                });
                expect(platform.deleted).toEqual([]); // each twin's only survivor is itself deleted → both rejected
                expect(result.protectedDeletes).toBe(2);
        });
});

// ---------------------------------------------------------------------------
// Prompt-contract tests for the 2026-11-11 Recital fixes (BUG 2 + BUG 4)
// ---------------------------------------------------------------------------

describe("Recital extraction/reconcile prompt contracts (2026-11-11)", () => {
        test("MEM0_CUSTOM_INSTRUCTIONS carries the conventions lane (BUG 2: preferences were dropped)", async () => {
                // Live: the user required "comments in sentence case with no trailing
                // periods", stated AND applied in-session — extraction dropped it
                // (no lane for it), T4 recall failed, and the dream then wrote the
                // abstention's negation ("no comment style is mandated") into memory.
                const { MEM0_CUSTOM_INSTRUCTIONS } = await import("../src/memzero.ts");
                expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("CONVENTIONS AND STYLE RULES");
                expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("sentence case");
                expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("an instruction every future session must follow");
        });

        test("MEM0_CUSTOM_INSTRUCTIONS bans negative-abstention extraction (BUG 3's second layer)", async () => {
                const { MEM0_CUSTOM_INSTRUCTIONS } = await import("../src/memzero.ts");
                expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("NEGATIVE ABSTENTION answers are never facts");
                expect(MEM0_CUSTOM_INSTRUCTIONS).toContain("never extract what it reported NOT finding");
        });

        test("RECONCILE_SYSTEM protects the winner and bans invented history (BUG 1 + BUG 4 prompts)", async () => {
                const { RECONCILE_SYSTEM } = await import("../src/memzero.ts");
                // BUG 1 prompt layer: deleting both sides of a contradiction is the
                // worst outcome; merges keep the newest as carrier.
                expect(RECONCILE_SYSTEM).toContain("The WINNER (the newer memory carrying the current state) is never a valid DELETE target");
                expect(RECONCILE_SYSTEM).toContain("MERGE DIRECTION");
                expect(RECONCILE_SYSTEM).toContain("keep the NEWEST memory as the surviving carrier");
                // BUG 4: the live T1 UPDATE invented "previously stated as a future
                // switch" — history markers must cite only what the memories say.
                expect(RECONCILE_SYSTEM).toContain("never invent history");
                expect(RECONCILE_SYSTEM).toContain("Temporal/history markers in a merged text must cite ONLY what the memories themselves already say");
        });
});
