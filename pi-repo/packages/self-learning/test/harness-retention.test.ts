// harness-retention.test.ts — the harness's retention auto-unship (BUG 4 +
// BUG 9, audit #4/#9), driven directly against the fake platform.
//
// retentionCheck is the safety net that keeps a shipped lesson from lingering
// in memory after the task fails again. Two defects are pinned here:
//
//   BUG 4 (a): a project-tier ship whose memory_ids is EMPTY (every mem0
//   event was UPDATE/NONE — the platform folded the rules into existing
//   memories) used to fall into the legacy branch and roll the tier file back
//   to version-1 — resurrecting a render that no longer matched platform
//   state while the next dream re-rendered the same content (version
//   ping-pong). It must instead RE-RENDER the project tier from the platform.
//
//   BUG 4 (b): the shipped query took ORDER BY created_at DESC LIMIT 1, so a
//   task with several shipped iterations only ever un-shipped the latest —
//   older lessons stayed in memory while their rows still claimed 'shipped'.
//
//   BUG 9: a FAILED regression sweep never ran the retention path at all
//   (only a later failed baseline of the SAME task did) — a shipped patch
//   that broke other tasks lingered forever. recordRegressionOutcome now
//   routes sweep FAILURES (not errors) through retentionCheck.
//
// Plus the Fisher-Yates shuffle that replaced the biased comparator sort in
// runRegression (determinism via rng injection — no statistical flake).
//
// Env: ./_env.ts redirects the store before module scope opens; every case
// resets the tiers/improvements rows it touches (bun runs all files in ONE
// process against one store) and never leaks the fake platform singleton.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";

import { recordRegressionOutcome, retentionCheck, shuffled } from "../src/harness.ts";
import { currentVersion, history, readTier, tierPath, writeTier, type Tier } from "../src/memory.ts";
import { ENGINE_SCOPE, renderProjectMemoryMarkdown, setMemoryPlatformForTests, shipEngineRules } from "../src/memzero.ts";
import { store } from "../src/store.ts";
import { makeFakePlatform, type FakePlatform } from "./_fake-platform.ts";

/** Reset a tier + the improvements of a task to pristine state. */
function reset(tier: Tier, taskId: string) {
        store.run(`DELETE FROM memory_versions WHERE tier = ?`, [tier]);
        rmSync(tierPath(tier), { force: true });
        store.run(`DELETE FROM improvements WHERE task_id = ?`, [taskId]);
        expect(currentVersion(tier)).toBe(0);
}

/** Insert a SHIPPED improvement row (the retention input state). */
function seedShippedRow(id: string, taskId: string, tier: string, memoryVersion: number | null, memoryIds: string[] | null) {
        store.run(
                `INSERT INTO improvements (id, cycle_id, task_id, iteration, target_tier, status, memory_version, memory_ids, created_at)
                 VALUES (?, 'cycle-x', ?, 1, ?, 'shipped', ?, ?, ?)`,
                [id, taskId, tier, memoryVersion, memoryIds ? JSON.stringify(memoryIds) : null, Date.now()],
        );
}

afterAll(() => {
        // Never leak the fake platform singleton into later test files (bun runs
        // every file in ONE process; the override is module state in memzero.ts).
        setMemoryPlatformForTests(null);
});

// ---------------------------------------------------------------------------
// BUG 4 (a): empty memory_ids on a project ship — re-render, never rollback
// ---------------------------------------------------------------------------
describe("retentionCheck — empty-ids project ship re-renders from the platform (BUG 4)", () => {
        const TASK = "retention-empty-ids";

        test("no version rollback: the tier is re-rendered FROM the platform, so file and platform agree", async () => {
                reset("project", TASK);
                const platform = makeFakePlatform();
                setMemoryPlatformForTests(platform);
                // The platform holds one seed rule the ship folded into (UPDATE/NONE —
                // no ADD events, hence memory_ids is empty on the improvement row). The
                // {role, content} message form is what the engine's writers send.
                await platform.add([{ role: "user", content: "- run the suite with bun, not node" }], ENGINE_SCOPE, { kind: "seed" }, { infer: false });

                // v1: the pre-ship render — DISTINCT content, so a legacy rollback to
                // version-1 would be observable (this is exactly the ping-pong content
                // the bug resurrected).
                writeTier("project", "# PRE-SHIP SKELETON", "seed", "initial skeleton");
                // v2: the ship's version (all events UPDATE/NONE — nothing to delete by id).
                const shipVersion = writeTier("project", "# SHIP RENDER (rules folded into platform)", "harness", "fixed task");
                // v3: a later dream diverged the file from the platform (stale render).
                writeTier("project", "# STALE POST-DREAM RENDER", "dream", "a dream re-rendered something else");
                seedShippedRow("imp-empty-ids", TASK, "project", shipVersion, null);

                await retentionCheck(TASK, "cycle-1234");

                // The improvement is regressed…
                const row = store.get<{ status: string }>(`SELECT status FROM improvements WHERE id = 'imp-empty-ids'`);
                expect(row?.status).toBe("regressed");

                // …and the tier was RE-RENDERED from the platform, not rolled back:
                // exactly one new version row, changed_by 'rollback', the retention
                // note says re-rendered, and the content is the platform render — not
                // the stale post-dream render (v3) and not the pre-ship skeleton (v1,
                // the legacy rollback target the bug used to resurrect).
                const versions = history("project", 10);
                expect(versions.length).toBe(4);
                const latest = versions[0];
                expect(latest.changed_by).toBe("rollback");
                expect(latest.note).toContain("re-rendered from the platform");
                expect(latest.note).not.toContain("unshipped improvement");
                // The render carries the platform's rule text (the footer timestamp
                // differs per render, so assert on the memories, not byte equality).
                expect(latest.content).toContain("run the suite with bun");
                expect(latest.content).not.toContain("STALE POST-DREAM RENDER");
                expect(latest.content).not.toContain("PRE-SHIP SKELETON");
                // The file follows the version row (materialized cache).
                expect(readTier("project")).toBe(latest.content);
                // The platform itself is untouched — an empty-ids ship changed no ids.
                expect(platform.calls.filter((c) => c.op === "delete")).toHaveLength(0);
        });

        test("memory_ids recorded as an empty JSON array takes the same re-render path (not the legacy branch)", async () => {
                reset("project", TASK);
                const platform = makeFakePlatform();
                setMemoryPlatformForTests(platform);
                await platform.add([{ role: "user", content: "- cache package downloads in CI" }], ENGINE_SCOPE, { kind: "seed" }, { infer: false });
                writeTier("project", "# v1 legacy content", "seed", "v1");
                const shipVersion = writeTier("project", "# v2 ship render", "harness", "fixed task");
                seedShippedRow("imp-empty-arr", TASK, "project", shipVersion, []);

                await retentionCheck(TASK, "cycle-4321");

                const latest = history("project", 10)[0];
                expect(latest.note).toContain("re-rendered from the platform");
                expect(latest.content).toContain("cache package downloads");
        });
});

// ---------------------------------------------------------------------------
// BUG 4 (b): EVERY shipped improvement of the task is un-shipped
// ---------------------------------------------------------------------------
describe("retentionCheck — all shipped improvements regress and unship (BUG 4 LIMIT 1)", () => {
        const TASK = "retention-two-ships";

        test("two shipped iterations: both rows regress, both ships' memory ids are deleted, tier re-rendered clean", async () => {
                reset("project", TASK);
                const platform: FakePlatform = makeFakePlatform();
                setMemoryPlatformForTests(platform);
                // Two REAL ships through the mem0 seam (fake platform): each returns
                // the memory ids the retention unship must delete.
                const ship1 = await shipEngineRules(["- prefer early returns over nested guards"], "harness", "fixed iteration 1");
                const ship2 = await shipEngineRules(["- always copy read-only fixtures before editing"], "harness", "fixed iteration 2");
                expect(ship1.memoryIds.length).toBe(1);
                expect(ship2.memoryIds.length).toBe(1);
                seedShippedRow("imp-ship-1", TASK, "project", ship1.version, ship1.memoryIds);
                seedShippedRow("imp-ship-2", TASK, "project", ship2.version, ship2.memoryIds);

                await retentionCheck(TASK, "cycle-777");

                // BOTH rows regressed (the old LIMIT 1 left the older one 'shipped').
                const statuses = store
                        .query<{ id: string; status: string }>(`SELECT id, status FROM improvements WHERE task_id = ? ORDER BY id`, [TASK])
                        .map((r) => r.status);
                expect(statuses).toEqual(["regressed", "regressed"]);

                // BOTH ships' memories left the platform (deletes for both id sets).
                const deletes = platform.calls.filter((c) => c.op === "delete");
                expect(deletes.map((d) => d.id).sort()).toEqual([...ship1.memoryIds, ...ship2.memoryIds].sort());
                const remaining = (await platform.getAll(ENGINE_SCOPE)).map((m) => m.text).join("\n");
                expect(remaining).not.toContain("early returns");
                expect(remaining).not.toContain("read-only fixtures");

                // The tier file was re-rendered from the now-clean platform state.
                // Byte-equality would be flaky here — the render footer embeds a
                // per-render timestamp — so compare with the footer line stripped
                // (the same discipline the empty-ids case above uses).
                const latest = history("project", 10)[0];
                const stripFooter = (md: string) => md.split("\n").filter((l) => !/^<!-- unown: rendered/.test(l)).join("\n");
                expect(stripFooter(latest.content)).toBe(stripFooter(renderProjectMemoryMarkdown(await platform.getAll(ENGINE_SCOPE))));
                expect(readTier("project")).not.toContain("early returns");
                expect(readTier("project")).not.toContain("read-only fixtures");
        });
});

// ---------------------------------------------------------------------------
// The unchanged legacy branch: non-project tiers still roll the file back
// ---------------------------------------------------------------------------
describe("retentionCheck — legacy file-tier ships keep the version rollback", () => {
        const TASK = "retention-legacy-local";

        test("a 'local' ship with a recorded version rolls the tier back to version-1", async () => {
                reset("local", TASK);
                setMemoryPlatformForTests(null);
                writeTier("local", "- keep the local baseline content v1", "unit-tests", "v1");
                writeTier("local", "- v1\n- shipped local rule", "harness", "ship v2");
                writeTier("local", "- v1\n- shipped local rule\n- later", "dream", "v3");
                seedShippedRow("imp-local", TASK, "local", 2, null);

                await retentionCheck(TASK, "cycle-legacy");

                const row = store.get<{ status: string }>(`SELECT status FROM improvements WHERE id = 'imp-local'`);
                expect(row?.status).toBe("regressed");
                const latest = history("local", 10)[0];
                // v2's pre-ship content is v1 — the rollback restores exactly that.
                expect(latest.content).toBe("- keep the local baseline content v1");
                expect(readTier("local")).toBe("- keep the local baseline content v1");
                // The version-row note is the legacy branch's retention note.
                expect(latest.note).toContain("retention:");
                expect(latest.note).toContain("unshipped improvement");
        });
});

// ---------------------------------------------------------------------------
// BUG 9: a FAILED regression sweep runs the retention path
// ---------------------------------------------------------------------------
describe("recordRegressionOutcome — the sweep-failure retention hook (BUG 9)", () => {
        const TASK = "retention-sweep-task";

        function seedTask() {
                store.run(`DELETE FROM tasks WHERE id = ?`, [TASK]);
                store.run(
                        `INSERT INTO tasks (id, name, description, prompt, files, verify, created_at, active, pass_count, fail_count)
                         VALUES (?, 'Sweep probe', 'D', 'P', '{}', 'x', ?, 1, 0, 0)`,
                        [TASK, Date.now()],
                );
        }

        afterAll(() => {
                store.run(`DELETE FROM tasks WHERE id = ?`, [TASK]);
        });

        test("a FAILED sweep un-ships the task's shipped improvement (same evidence class as a failed baseline)", async () => {
                reset("project", TASK);
                seedTask();
                const platform: FakePlatform = makeFakePlatform();
                setMemoryPlatformForTests(platform);
                const ship = await shipEngineRules(["- never ship on a red suite"], "harness", "fixed task");
                seedShippedRow("imp-sweep", TASK, "project", ship.version, ship.memoryIds);

                await recordRegressionOutcome(TASK, { id: "run-ab12cd34", status: "failed" });

                // The sweep failure regressed the ship and deleted its rules.
                expect(store.get<{ status: string }>(`SELECT status FROM improvements WHERE id = 'imp-sweep'`)?.status).toBe(
                        "regressed",
                );
                expect(platform.calls.some((c) => c.op === "delete" && c.id === ship.memoryIds[0])).toBe(true);
                expect(readTier("project")).not.toContain("never ship on a red suite");
                // The fail counter bumped too (the pre-hook behavior, preserved).
                expect(store.get<{ fail_count: number }>(`SELECT fail_count FROM tasks WHERE id = ?`, [TASK])?.fail_count).toBe(1);
        });

        test("an ERRORED sweep only bumps fail_count — infra death is not evidence about the lesson", async () => {
                reset("project", TASK);
                seedTask();
                const platform: FakePlatform = makeFakePlatform();
                setMemoryPlatformForTests(platform);
                const ship = await shipEngineRules(["- keep the suite green before shipping"], "harness", "fixed task");
                seedShippedRow("imp-sweep-err", TASK, "project", ship.version, ship.memoryIds);

                await recordRegressionOutcome(TASK, { id: "run-ef56ab78", status: "error" });

                expect(store.get<{ status: string }>(`SELECT status FROM improvements WHERE id = 'imp-sweep-err'`)?.status).toBe(
                        "shipped",
                );
                expect(platform.calls.filter((c) => c.op === "delete")).toHaveLength(0);
                expect(store.get<{ fail_count: number }>(`SELECT fail_count FROM tasks WHERE id = ?`, [TASK])?.fail_count).toBe(1);
        });

        test("a PASSED sweep bumps pass_count and never touches retention", async () => {
                reset("project", TASK);
                seedTask();
                const platform: FakePlatform = makeFakePlatform();
                setMemoryPlatformForTests(platform);
                const ship = await shipEngineRules(["- write the failing test first"], "harness", "fixed task");
                seedShippedRow("imp-sweep-ok", TASK, "project", ship.version, ship.memoryIds);

                await recordRegressionOutcome(TASK, { id: "run-cd90ef12", status: "passed" });

                expect(store.get<{ status: string }>(`SELECT status FROM improvements WHERE id = 'imp-sweep-ok'`)?.status).toBe("shipped");
                expect(platform.calls.filter((c) => c.op === "delete")).toHaveLength(0);
                expect(store.get<{ pass_count: number }>(`SELECT pass_count FROM tasks WHERE id = ?`, [TASK])?.pass_count).toBe(1);
                expect(store.get<{ fail_count: number }>(`SELECT fail_count FROM tasks WHERE id = ?`, [TASK])?.fail_count).toBe(0);
        });
});

// ---------------------------------------------------------------------------
// BUG 9: the Fisher-Yates shuffle (deterministic via rng injection — the
// statistical-distribution route is deliberately avoided: it is flaky by
// construction on loaded CI runners)
// ---------------------------------------------------------------------------
describe("shuffled — uniform Fisher-Yates (BUG 9 biased comparator sort)", () => {
        test("seeded rng is fully deterministic: the same draws produce the same permutation", () => {
                const items = [1, 2, 3, 4, 5];
                expect(shuffled(items, () => 0.25)).toEqual([4, 3, 1, 5, 2]);
                expect(shuffled(items, () => 0.25)).toEqual([4, 3, 1, 5, 2]); // same draws, same result
                expect(shuffled(items, () => 0)).toEqual([2, 3, 4, 5, 1]);
        });

        test("the input array is never mutated (the old sort() shuffled in place)", () => {
                const items = [1, 2, 3, 4, 5];
                const out = shuffled(items, () => 0.25);
                expect(items).toEqual([1, 2, 3, 4, 5]);
                expect(out).not.toBe(items);
        });

        test("every draw sequence yields a permutation of the input (no element lost or duplicated)", () => {
                const items = Array.from({ length: 40 }, (_, i) => i);
                for (const seed of [0, 0.1, 0.2, 0.3, 0.5, 0.7, 0.99]) {
                        const out = shuffled(items, () => seed);
                        expect([...out].sort((a, b) => a - b)).toEqual(items);
                }
        });

        test("an rng returning exactly 1.0 cannot index out of bounds (clamped to a no-op swap)", () => {
                const items = [1, 2, 3];
                expect(() => shuffled(items, () => 1)).not.toThrow();
                expect(shuffled(items, () => 1)).toEqual([1, 2, 3]); // j === i every round
        });

        test("surjectivity on n=3: all 6 permutations are reachable — the shuffle is not stuck in a subset (the biased-sort signature)", () => {
                // Fisher-Yates on 3 elements draws j in {0,1,2} then j in {0,1}: the six
                // draw pairs produce the six permutations exactly once each.
                const seen = new Set<string>();
                for (let first = 0; first <= 2; first++) {
                        for (let second = 0; second <= 1; second++) {
                                const draws = [first / 3 + 0.001, second / 2 + 0.001];
                                seen.add(shuffled([1, 2, 3], () => draws.shift() ?? 0).join(","));
                        }
                }
                expect(seen.size).toBe(6);
        });

        test("empty and single-element inputs are the identity", () => {
                expect(shuffled([])).toEqual([]);
                expect(shuffled(["only"])).toEqual(["only"]);
        });
});
