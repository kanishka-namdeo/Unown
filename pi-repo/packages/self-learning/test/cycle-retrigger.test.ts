// Unit tests for cycleTriggerGuard — the M6-1 re-trigger dedup gate
// (audit M4-c D5: one accidental re-POST of a just-passed task cost ~4 LLM
// calls for a deterministic re-PASS).
//
// What is pinned: the exact decision the REST layer runs BEFORE starting a
// manual cycle (src/harness.ts cycleTriggerGuard, wired in server.ts):
//   rule 1  live cycle for the task            -> block (even with force)
//   rule 2  last cycle succeeded < 5min ago    -> block unless force
//   rule 3  never-run / failed / no-fix / error / stale pass -> allow
//
// The guard is a pure store read; these tests seed cycles rows directly
// (no LLM, no runAgent) and assert the decision at fixed `now` values.
//
// This file imports ./_env.ts FIRST: harness.ts pulls store.ts at module
// scope; the shared redirect keeps the db under /tmp/engine-tests-b and the
// live engine state is never touched.

import "./_env.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import { cycleTriggerGuard, CYCLE_RETRIGGER_COOLDOWN_MS } from "../src/harness.ts";
import { store } from "../src/store.ts";
import { seedTasks } from "../src/tasks.ts";

const TASK = "fix-fizzbuzz";

/** Wipe cycles/tasks and re-seed the suite so each case starts from a
 * deterministic baseline (the shared b-suite db accumulates rows otherwise). */
function resetFixture() {
        store.run(`DELETE FROM cycles`);
        store.run(`DELETE FROM tasks`);
        seedTasks();
        expect(store.get<{ id: string }>(`SELECT id FROM tasks WHERE id = ?`, [TASK])).toBeTruthy();
}

function seedCycle(status: string, endedAt: number | null, createdAt: number, id = `c-${status}-${createdAt}`) {
        store.run(`INSERT INTO cycles (id, task_id, status, iteration, created_at, ended_at) VALUES (?, ?, ?, 0, ?, ?)`, [
                id,
                TASK,
                status,
                createdAt,
                endedAt,
        ]);
}

const NOW = 1_800_000_000_000; // fixed epoch — tests never touch Date.now()

beforeEach(() => {
        resetFixture();
});

describe("cycleTriggerGuard — rule 1: live cycle blocks (force cannot override)", () => {
        test("running cycle -> cycle-active with its id", () => {
                seedCycle("running", null, NOW - 60_000, "live-1");
                const g = cycleTriggerGuard(TASK, { now: NOW });
                expect(g).toEqual({ ok: false, reason: "cycle-active", activeCycleId: "live-1" });
        });

        test("force=true does NOT bypass an active cycle", () => {
                seedCycle("running", null, NOW - 60_000, "live-2");
                const g = cycleTriggerGuard(TASK, { force: true, now: NOW });
                expect(g.ok).toBe(false);
                if (!g.ok) expect(g.reason).toBe("cycle-active");
        });

        test("a running cycle on ANOTHER task does not block this one", () => {
                store.run(
                        `INSERT INTO cycles (id, task_id, status, iteration, created_at) VALUES ('other-live', 'fix-csv-parser', 'running', 0, ?)`,
                        [NOW - 30_000],
                );
                const g = cycleTriggerGuard(TASK, { now: NOW });
                expect(g.ok).toBe(true);
        });
});

describe("cycleTriggerGuard — rule 2: just-succeeded cooldown", () => {
        test("already-passing 60s ago -> cooldown block with retryInMs", () => {
                seedCycle("already-passing", NOW - 60_000, NOW - 120_000);
                const g = cycleTriggerGuard(TASK, { now: NOW });
                expect(g.ok).toBe(false);
                if (!g.ok) {
                        expect(g.reason).toBe("cooldown");
                        expect(g.lastStatus).toBe("already-passing");
                        expect(g.retryInMs).toBe(CYCLE_RETRIGGER_COOLDOWN_MS - 60_000);
                }
        });

        test("improved 1s ago -> cooldown block", () => {
                seedCycle("improved", NOW - 1_000, NOW - 60_000);
                const g = cycleTriggerGuard(TASK, { now: NOW });
                expect(g.ok).toBe(false);
                if (!g.ok) expect(g.lastStatus).toBe("improved");
        });

        test("already-passing exactly at cooldown boundary -> allow", () => {
                seedCycle("already-passing", NOW - CYCLE_RETRIGGER_COOLDOWN_MS, NOW - CYCLE_RETRIGGER_COOLDOWN_MS - 1_000);
                const g = cycleTriggerGuard(TASK, { now: NOW });
                expect(g.ok).toBe(true);
        });

        test("force=true bypasses the cooldown", () => {
                seedCycle("already-passing", NOW - 60_000, NOW - 120_000);
                const g = cycleTriggerGuard(TASK, { force: true, now: NOW });
                expect(g.ok).toBe(true);
        });

        test("an OLDER failed cycle after the pass does not cool down (latest wins)", () => {
                seedCycle("already-passing", NOW - 60_000, NOW - 120_000);
                seedCycle("no-fix", NOW - 10_000, NOW - 30_000); // newer, not a success
                const g = cycleTriggerGuard(TASK, { now: NOW });
                expect(g.ok).toBe(true);
        });
});

describe("cycleTriggerGuard — rule 3: everything else allows", () => {
        test("never-run task -> allow", () => {
                const g = cycleTriggerGuard(TASK, { now: NOW });
                expect(g.ok).toBe(true);
        });

        test("last failed 1s ago -> allow (immediate retry is legitimate)", () => {
                seedCycle("no-fix", NOW - 1_000, NOW - 10_000);
                expect(cycleTriggerGuard(TASK, { now: NOW }).ok).toBe(true);
                seedCycle("error", NOW - 1_000, NOW - 20_000, "err-c");
                expect(cycleTriggerGuard(TASK, { now: NOW }).ok).toBe(true);
        });

        test("stale pass (older than cooldown) -> allow", () => {
                seedCycle("already-passing", NOW - (CYCLE_RETRIGGER_COOLDOWN_MS + 1_000), NOW - CYCLE_RETRIGGER_COOLDOWN_MS - 5_000);
                expect(cycleTriggerGuard(TASK, { now: NOW }).ok).toBe(true);
        });
});
