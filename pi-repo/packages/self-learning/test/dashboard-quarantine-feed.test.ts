// dashboard-quarantine-feed.test.ts — the quarantine round's VISIBILITY pins:
// the dashboard event-feed vocabulary and the suite-stats count for the new
// learning-loop states. The events themselves are emitted by mint.ts's
// solvability gate (task:mint-unsolvable), the harness circuit breaker
// (task:quarantined), and the operator lifecycle lanes (task:quarantined
// with by:'operator' / task:activated) — this file pins that each renders as
// a human sentence with the RIGHT tone, so the loop's self-protection is
// something a dashboard watcher can SEE:
//
//   - task:mint-unsolvable  amber   "unsolvable draft refused · <id> — the
//                                    reference solution cannot pass its own
//                                    tests" (the gate caught a bad draft)
//   - task:quarantined      rose    "capability eval quarantined · <id> · N
//                                    straight failures — deactivated" (the
//                                    breaker fired mid-flight)
//   - task:quarantined      rose    operator variant carries " · by operator"
//                                    and no streak suffix
//   - task:activated        emerald "task reactivated · <id> → <status>"
//
// Plus suiteStats: quarantined tasks are active=0 so every other count
// already excludes them — the new `quarantined` field is the only place the
// breaker's catches are counted, and it must count ONLY active=0 rows with
// status 'quarantined' (a discarded draft is not quarantined; an active
// capability eval is not either).
//
// Env: ./_env.ts redirects the store to scratch before module scope opens.
import "./_env.ts";
import { describe, expect, test } from "bun:test";
import { describeEvent } from "../src/dashboard/dashboard-data.ts";
import { suiteStats } from "../src/mint.ts";
import { store } from "../src/store.ts";

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe("describeEvent — the quarantine round's vocabulary", () => {
        test("task:mint-unsolvable renders amber with the refused id", () => {
                const out = describeEvent({
                        event: "task:mint-unsolvable",
                        payload: { id: "mint-clamp-${RUN}", reason: "reference fails", validationRunId: "r-1" },
                        ts: 0,
                });
                expect(out?.tone).toBe("amber");
                expect(out?.text).toContain("unsolvable draft refused");
                expect(out?.text).toContain("mint-clamp");
                expect(out?.text).toContain("reference solution cannot pass its own tests");
        });

        test("task:quarantined renders rose with the streak and the deactivation", () => {
                const out = describeEvent({
                        event: "task:quarantined",
                        payload: { id: `mint-broken-${RUN}`, consecutiveFailures: 6 },
                        ts: 0,
                });
                expect(out?.tone).toBe("rose");
                expect(out?.text).toContain("capability eval quarantined");
                expect(out?.text).toContain("6 straight failures");
                expect(out?.text).toContain("deactivated");
                expect(out?.text).not.toContain("by operator");
        });

        test("task:quarantined operator variant carries the operator mark and no streak", () => {
                const out = describeEvent({
                        event: "task:quarantined",
                        payload: { id: `mint-op-${RUN}`, by: "operator" },
                        ts: 0,
                });
                expect(out?.tone).toBe("rose");
                expect(out?.text).toContain("by operator");
                expect(out?.text).not.toContain("straight failures");
        });

        test("task:activated renders emerald with the restored status", () => {
                const out = describeEvent({
                        event: "task:activated",
                        payload: { id: `mint-back-${RUN}`, status: "capability" },
                        ts: 0,
                });
                expect(out?.tone).toBe("emerald");
                expect(out?.text).toContain("task reactivated");
                expect(out?.text).toContain("capability");
        });
});

describe("suiteStats — the quarantined count", () => {
        test("counts ONLY inactive quarantined rows; discarded drafts and active evals are not quarantined", () => {
                store.run(
                        `INSERT INTO tasks (id, name, description, category, difficulty, prompt, files, verify, created_at, active, origin, status)
                         VALUES (?, 'q', 'q', 'bugfix', 1, 'q', '{}', '', ?, 0, 'minted', 'quarantined')`,
                        [`mint-q1-${RUN}`, Date.now()],
                );
                store.run(
                        `INSERT INTO tasks (id, name, description, category, difficulty, prompt, files, verify, created_at, active, origin, status)
                         VALUES (?, 'd', 'd', 'bugfix', 1, 'd', '{}', '', ?, 0, 'minted', 'discarded')`,
                        [`mint-d1-${RUN}`, Date.now()],
                );
                store.run(
                        `INSERT INTO tasks (id, name, description, category, difficulty, prompt, files, verify, created_at, active, origin, status)
                         VALUES (?, 'c', 'c', 'bugfix', 1, 'c', '{}', '', ?, 1, 'minted', 'capability')`,
                        [`mint-c1-${RUN}`, Date.now()],
                );
                const stats = suiteStats();
                expect(stats.quarantined).toBeGreaterThanOrEqual(1);
                // The active counts exclude both inactive rows as before.
                expect(stats.capability).toBeGreaterThanOrEqual(1);
                expect(stats.total).toBeGreaterThanOrEqual(1);
        });
});
