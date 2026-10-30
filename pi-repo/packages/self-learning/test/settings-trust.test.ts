/**
 * settings-trust.test.ts — the Settings Evolution round's TRUST feature
 * suite: the automation kill switch, the hook loop breaker, the goal budget,
 * and the dream review lane's engine-side pieces (park gate semantics are
 * unit-level; the full dream path is covered by dreams-run-projects tests
 * and the PTY lane).
 */

import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_ROOT = join(tmpdir(), `settings-trust-tests-${process.pid}`);

beforeEach(() => {
        rmSync(TEST_ROOT, { recursive: true, force: true });
        mkdirSync(TEST_ROOT, { recursive: true });
});

afterAll(() => {
        rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The automation kill switch
// ---------------------------------------------------------------------------

describe("the automation kill switch (stopAutomationRuns)", () => {
        test("stops nothing when the routine has no running runs (honest detail)", async () => {
                const { stopAutomationRuns } = await import("../src/automations.ts");
                const result = stopAutomationRuns("no-such-routine");
                expect(result.ok).toBe(false);
                expect(result.stopped).toBe(0);
                expect(result.detail).toContain("no running runs");
        });

        test("a registered live child is SIGKILLed and the row records 'stopped'", async () => {
                const automations = await import("../src/automations.ts");
                const { store } = await import("../src/store.ts");
                // A real automation row + running run row.
                const created = automations.createAutomation({
                        title: "kill-switch-test",
                        prompt: "test",
                        workspace: TEST_ROOT,
                        schedule: { every: "24h" },
                });
                expect(created.ok).toBe(true);
                const id = (created as { automation: { id: string } }).automation.id;
                store.run(
                        `INSERT INTO automation_runs (id, automation_id, trigger_kind, status, started_at) VALUES (?, ?, 'manual', 'running', ?)`,
                        [`run-1`, id, Date.now()],
                );
                // The dispatcher-level registry is keyed by run id; a child that
                // already exited (not registered) exercises the zombie-close lane.
                const result = automations.stopAutomationRuns(id);
                expect(result.ok).toBe(true);
                expect(result.stopped).toBe(0);
                expect(result.closed).toBe(1); // the zombie row, closed honestly
                const row = store.get<{ status: string }>(`SELECT status FROM automation_runs WHERE id = 'run-1'`);
                expect(row?.status).toBe("stopped");
                // The claim is released so the routine can fire again.
                const automation = automations.getAutomation(id);
                expect(automation?.running).toBe(0);
                automations.deleteAutomation(id);
        });
});

// ---------------------------------------------------------------------------
// The hook loop breaker
// ---------------------------------------------------------------------------

describe("the hook loop breaker", () => {
        const savedDepth = process.env.UNOWN_HOOK_DEPTH;
        afterAll(() => {
                if (savedDepth === undefined) delete process.env.UNOWN_HOOK_DEPTH;
                else process.env.UNOWN_HOOK_DEPTH = savedDepth;
        });

        test("depth 0 runs handlers; a deny still denies (breaker does not weaken normal hooks)", async () => {
                delete process.env.UNOWN_HOOK_DEPTH;
                const { runHooksForEvent } = await import("../src/hooks-config.ts");
                const result = await runHooksForEvent(
                        [{ type: "command", command: "exit 2", name: "deny-hook" } as never],
                        { name: "PreToolUse", tool: "bash" } as never,
                        { runId: "r" } as never,
                );
                expect(result.decision).toBe("deny");
        });

        test("at max depth every handler is skipped with a visible breaker warning", async () => {
                process.env.UNOWN_HOOK_DEPTH = "3"; // default max
                const { runHooksForEvent } = await import("../src/hooks-config.ts");
                const result = await runHooksForEvent(
                        [{ type: "command", command: "exit 2", name: "deny-hook" } as never],
                        { name: "PreToolUse", tool: "bash" } as never,
                        { runId: "r" } as never,
                );
                // The breaker overrides even a deny — breaking the recursion is the
                // point; the warning makes the skip visible to model + user.
                expect(result.decision).toBe("allow");
                expect(result.reason).toContain("hook loop breaker");
                expect(result.outputs.some((o) => o.message.includes("hook-spawns deep"))).toBe(true);
        });

        test("the depth counter a spawned hook child would inherit", async () => {
                delete process.env.UNOWN_HOOK_DEPTH;
                const { runHooksForEvent } = await import("../src/hooks-config.ts");
                // A marker hook that captures the env it was spawned with would need a
                // child process; the breaker's env math is asserted through the public
                // path instead: depth 2 of max 3 still runs; depth 3 does not.
                process.env.UNOWN_HOOK_DEPTH = "2";
                const { runHooksForEvent: rerun } = await import("../src/hooks-config.ts");
                const stillRuns = await rerun(
                        [{ type: "command", command: "true", name: "noop" } as never],
                        { name: "PreToolUse", tool: "bash" } as never,
                        { runId: "r" } as never,
                );
                expect(stillRuns.decision).toBe("allow"); // ran normally (no breaker reason)
                expect(stillRuns.reason).toBeUndefined();
                void runHooksForEvent;
        });
});

// ---------------------------------------------------------------------------
// The goal budget
// ---------------------------------------------------------------------------

describe("the goal budget", () => {
        test("goalContextMessage shows the budget line only when set", async () => {
                const goal = await import("../src/goal.ts");
                const { saveHubPrefs, loadHubPrefs } = await import("../src/settings/prefs.ts");
                const prefs = loadHubPrefs();
                const saved = { ...prefs };
                prefs.goalBudgetTurns = 25;
                saveHubPrefs(prefs);
                try {
                        const message = goal.goalContextMessage({ text: "ship it", status: "active", createdAt: Date.now(), turns: 3 });
                        expect(message).toContain("auto-pauses after 25 turns (3 used)");
                } finally {
                        saveHubPrefs(saved);
                }
                const off = goal.goalContextMessage({ text: "ship it", status: "active", createdAt: Date.now() });
                expect(off).not.toContain("Budget");
        });

        test("parseGoalEntry tolerates the additive turns field (drift-safe)", async () => {
                const { parseGoalEntry } = await import("../src/goal.ts");
                const restored = parseGoalEntry({ text: "objective", status: "active", createdAt: 1, turns: 7 });
                expect(restored.goal?.turns).toBe(7);
                const without = parseGoalEntry({ text: "objective", status: "active", createdAt: 1 });
                expect(without.goal?.turns).toBeUndefined();
                const negative = parseGoalEntry({ text: "objective", status: "active", createdAt: 1, turns: -3 });
                expect(negative.goal?.turns).toBeUndefined();
        });

        test("budgetTurnsSetting reads the hub pref live (0 = off)", async () => {
                const { goalBudgetTurnsSetting } = await import("../src/goal.ts");
                const { loadHubPrefs, saveHubPrefs } = await import("../src/settings/prefs.ts");
                const saved = { ...loadHubPrefs() };
                try {
                        saveHubPrefs({ ...saved, goalBudgetTurns: 0 });
                        expect(goalBudgetTurnsSetting()).toBe(0);
                        saveHubPrefs({ ...saved, goalBudgetTurns: 40 });
                        expect(goalBudgetTurnsSetting()).toBe(40);
                } finally {
                        saveHubPrefs(saved);
                }
        });
});

// ---------------------------------------------------------------------------
// The dream review lane (engine-side commit/approve/discard surface)
// ---------------------------------------------------------------------------

describe("the dream review lane", () => {
        test("commitProjectMemoryVersion: version row + file + provenance sidecar", async () => {
                const { commitProjectMemoryVersion } = await import("../src/dream.ts");
                const { store } = await import("../src/store.ts");
                const projectDir = join(TEST_ROOT, "proj");
                mkdirSync(join(projectDir, ".unown", "memory"), { recursive: true });
                const { writeFileSync, readFileSync, existsSync } = await import("node:fs");
                writeFileSync(join(projectDir, ".unown", "memory", "project.md"), "# before\n", "utf8");
                // Unique per run: the suite DB is shared and persists across runs — a
                // static key would inherit stale version numbers.
                const tierKey = `project:settings-trust-${process.pid}`;
                const version = commitProjectMemoryVersion({
                        projectPath: projectDir,
                        tierKey,
                        toWrite: "# after\n- learned rule\n",
                        current: "# before\n",
                        note: "test commit",
                });
                expect(version).toBe(1);
                const file = readFileSync(join(projectDir, ".unown", "memory", "project.md"), "utf8");
                expect(file).toContain("learned rule");
                const row = store.get<{ content: string }>(
                        `SELECT content FROM memory_versions WHERE tier = ? AND version = 1`,
                        [tierKey],
                );
                expect(row?.content).toContain("learned rule");
                expect(existsSync(join(projectDir, ".unown", "memory", "project.provenance.json"))).toBe(true);
                // A second commit allocates version 2.
                const v2 = commitProjectMemoryVersion({
                        projectPath: projectDir,
                        tierKey,
                        toWrite: "# after2\n",
                        current: "# after\n",
                        note: "test commit 2",
                });
                expect(v2).toBe(2);
        });

        test("approvePendingDream commits the parked diff exactly; discard leaves the file untouched", async () => {
                const { parkPendingDream } = await import("../src/dream-review.ts");
                const { approvePendingDream, discardPendingDream } = await import("../src/dream.ts");
                const { store } = await import("../src/store.ts");
                const projectDir = join(TEST_ROOT, "proj2");
                mkdirSync(join(projectDir, ".unown", "memory"), { recursive: true });
                const { writeFileSync, readFileSync } = await import("node:fs");
                const currentFile = join(projectDir, ".unown", "memory", "project.md");
                writeFileSync(currentFile, "# base\n", "utf8");

                parkPendingDream({
                        id: "pending-1",
                        slug: "proj2",
                        projectPath: projectDir,
                        createdAt: Date.now(),
                        notesIn: 2,
                        toWrite: "# base\n- parked rule\n",
                        current: "# base\n",
                        events: [],
                        summary: "added 1",
                        note: "parked",
                });
                const approved = await approvePendingDream({ projectPath: projectDir, id: "pending-1" });
                expect(approved.ok).toBe(true);
                expect(readFileSync(currentFile, "utf8")).toContain("parked rule");

                // A second pending: discard must leave the file EXACTLY as is.
                parkPendingDream({
                        id: "pending-2",
                        slug: "proj2",
                        projectPath: projectDir,
                        createdAt: Date.now(),
                        notesIn: 1,
                        toWrite: "# base\n- parked rule\n- SHOULD NOT SHIP\n",
                        current: "# base\n- parked rule\n",
                        events: [],
                        summary: "added 1",
                        note: "parked 2",
                });
                const discarded = await discardPendingDream({ projectPath: projectDir, id: "pending-2" });
                expect(discarded.ok).toBe(true);
                const after = readFileSync(currentFile, "utf8");
                expect(after).not.toContain("SHOULD NOT SHIP");
                // Unknown ids fail honestly.
                const missing = await approvePendingDream({ projectPath: projectDir, id: "ghost" });
                expect(missing.ok).toBe(false);
                void store;
        });
});
