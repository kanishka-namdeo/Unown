// Regression test for the canary-crash path (audit MEDIUM-1).
//
// An EXCEPTION inside canaryCheck (dynamic-import failure, DB error, an
// agent-run rejection) used to escape runDream's outer catch: the new memory
// version stayed LIVE with no canary validation, and the notes were NOT
// marked dreamed — the next dream re-consolidated the same notes into yet
// another version. The canary's whole point is auto-unship; that silently
// failed exactly when infrastructure was flaky.
//
// Harness (post-swap): the FAKE memory platform (test/_fake-platform.ts —
// no LLM, no network) + the canary injected via runDream's opts.canaryFn
// seam (no agent loop needed to make it CRASH). The canary-crash rollback
// must revert BOTH the memory version AND the platform event stream.
import "./_env.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runDream } from "../src/dream.ts";
import { currentVersion, readTier, tierPath, writeTier } from "../src/memory.ts";
import { createNote, undreamedNotes } from "../src/notes.ts";
import { store } from "../src/store.ts";
import { makeFakePlatform } from "./_fake-platform.ts";

const SCRATCH = join(tmpdir(), "engine-tests-dream-canary-crash");

const noReconcile = async () => ({ ops: [] });

beforeAll(() => {
        rmSync(SCRATCH, { recursive: true, force: true });
        store.run(`DELETE FROM memory_versions WHERE tier = 'project'`);
        rmSync(tierPath("project"), { force: true });
        // v1 = established benign memory (not a first mint; the dream writes v2)
        writeTier("project", "# established benign memory\n\n- read-only files are honored [seed]\n", "unit-tests", "establish v1");
});

afterAll(() => {
        store.run(`DELETE FROM memory_versions WHERE tier = 'project'`);
        store.run(`DELETE FROM dreams`);
        store.run(`DELETE FROM notes`);
        rmSync(SCRATCH, { recursive: true, force: true });
});

describe("runDream — a CRASHED canary gates and rolls back (MEDIUM-1)", () => {
        test("canary exception -> status gated, memory rolled back to the pre-dream content, platform reverted, notes consumed", async () => {
                // three undreamed benchmark notes make the dream eligible
                const noteIds = [createNote(null, "Benchmark note: agent honored read-only files, iterated once before green.", "benchmark"),
                        createNote(null, "Benchmark note: verify script is ground truth; tests run with bun.", "benchmark"),
                        createNote(null, "Benchmark note: prefer stdlib over hand-rolled logic.", "benchmark")];
                expect(undreamedNotes(50, "benchmark").length).toBeGreaterThanOrEqual(3);

                const before = readTier("project");
                const beforeVersion = currentVersion("project");
                const platform = makeFakePlatform();

                const result = await runDream({
                        platform,
                        reconcileLlmFn: noReconcile,
                        canaryFn: async () => { throw new Error("infrastructure exploded"); },
                });

                expect(result.status).toBe("gated");
                expect(String(result.note)).toContain("infrastructure exploded");
                // The new memory did NOT stay live: content is back to the pre-dream state.
                expect(readTier("project")).toBe(before);
                expect(currentVersion("project")).toBeGreaterThan(beforeVersion); // rollback wrote a NEW version with old content
                // The platform event stream was reverted: every ADD the dream made is
                // gone — only the pre-dream LEGACY IMPORT (the established v1 content,
                // imported by the swap-boundary guard) survives, which is correct.
                expect([...platform.store.values()].some((m) => m.text.includes("Benchmark note"))).toBe(false);
                expect(platform.calls.filter((c) => c.op === "delete").length).toBeGreaterThan(0);
                // The notes were consumed — no re-dream of the same session.
                const dreamed = noteIds.every((id: string) => {
                        const row = store.get<{ dream_id: string | null }>(`SELECT dream_id FROM notes WHERE id = ?`, [id]);
                        return row?.dream_id != null;
                });
                expect(dreamed).toBe(true);
                // The dream row records the gate with the reason.
                const row = store.get<{ status: string; note: string }>(`SELECT status, note FROM dreams WHERE id = ?`, [result.id]);
                expect(row!.status).toBe("gated");
                expect(row!.note).toContain("canary");
        });

        test("a healthy canary outcome still completes the dream (seam sanity, both directions)", async () => {
                store.run(`DELETE FROM memory_versions WHERE tier = 'project'`);
                rmSync(tierPath("project"), { force: true });
                writeTier("project", "# established benign memory\n\n- read-only files are honored [seed]\n", "unit-tests", "re-establish v1");
                for (let i = 0; i < 3; i++) createNote(null, `Benchmark note ${i}: agent used bun for tests and iterated once.`, "benchmark");

                const platform = makeFakePlatform();
                const result = await runDream({
                        platform,
                        reconcileLlmFn: noReconcile,
                        canaryFn: async () => ({ rolledBack: false, skipped: true, reason: "injected healthy canary" }),
                });
                expect(result.status).toBe("done");
                expect(readTier("project")).toContain("read-only files");
                expect(platform.store.size).toBeGreaterThan(0); // the dream's memories stayed
        });
});
