// harness-quarantine.test.ts — the capability-eval QUARANTINE circuit breaker
// (the 2026-10-25 live finding's safety net), pinned at the decision seam:
//
//   - the streak: UNOWN_CAPABILITY_QUARANTINE_AFTER (default 6) consecutive
//     FAILED baselines with zero passes quarantines an active minted
//     capability task (active=0, status='quarantined', task:quarantined on
//     the bus). One run short of the threshold does nothing.
//   - the streak's honesty: an 'error' (infra) run BREAKS the streak — it
//     says nothing about solvability; a 'passed' run breaks it too (and in
//     the live flow graduateTask has already flipped the status).
//   - the gates: seed-origin tasks never quarantine (only minted capability
//     evals — the circuit breaker protects the learning loop from unsolvable
//     MINTED drafts); pass_count > 0 never quarantines (it was solvable);
//     already-inactive tasks are no-ops (idempotent).
//   - the knob: 0 disables; a custom threshold applies at call time.
//
// Why this exists: pickNextTask() selects failing tasks FIRST, so a
// never-passing task burns one full agent run EVERY cycle and starves every
// real learning target. The mint solvability gate (proveSolvability) stops
// unsolvable drafts at activation; this breaker is the defense in depth for
// anything that slips past or degrades later (environment drift, an upstream
// model change making a once-solvable task unreachable).
//
// Env: ./_env.ts redirects the store before module scope opens. Runs rows are
// seeded directly (the cycle-retrigger.test.ts pattern — no LLM, no runAgent).
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterEach, describe, expect, test } from "bun:test";
import { capabilityQuarantineAfter, quarantineCheck } from "../src/harness.ts";
import { subscribe } from "../src/bus.ts";
import { store } from "../src/store.ts";

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function seedTask(id: string, opts: { origin?: string; status?: string; active?: number; passCount?: number } = {}) {
        store.run(
                `INSERT INTO tasks (id, name, description, category, difficulty, prompt, files, verify, created_at, active, origin, status, pass_count)
                 VALUES (?, 'q', 'q', 'bugfix', 1, 'q', '{}', '', ?, ?, ?, ?, ?)`,
                [id, Date.now(), opts.active ?? 1, opts.origin ?? "minted", opts.status ?? "capability", opts.passCount ?? 0],
        );
}

function seedRun(taskId: string, status: string, n: number) {
        for (let i = 0; i < n; i++) {
                store.run(
                        `INSERT INTO runs (id, task_id, kind, status, started_at) VALUES (?, ?, 'baseline', ?, ?)`,
                        [`${taskId}-r${RUN}-${i}`, taskId, status, Date.now() + i],
                );
        }
}

function taskRow(id: string) {
        return store.get<{ active: number; status: string }>(`SELECT active, status FROM tasks WHERE id = ?`, [id]);
}

afterEach(() => {
        delete process.env.UNOWN_CAPABILITY_QUARANTINE_AFTER;
});

describe("quarantineCheck — the streak", () => {
        test("default threshold 6: five failures do not quarantine", () => {
                const id = `q-short-${RUN}`;
                seedTask(id);
                seedRun(id, "failed", 5);
                expect(quarantineCheck(id).quarantined).toBe(false);
                expect(taskRow(id).active).toBe(1);
        });

        test("six consecutive failures quarantine: active=0, status='quarantined', event on the bus", () => {
                const id = `q-exact-${RUN}`;
                seedTask(id);
                seedRun(id, "failed", 6);
                const events: any[] = [];
                // subscribe() takes ONE meta-listener on the {event, payload} stream.
                const off = subscribe((e) => {
                        if (e.event === "task:quarantined") events.push(e.payload);
                });
                const out = quarantineCheck(id);
                off();
                expect(out.quarantined).toBe(true);
                expect((out as any).reason).toContain("consecutive failed baselines");
                expect(taskRow(id)).toEqual({ active: 0, status: "quarantined" });
                expect(events.length).toBe(1);
                expect(events[0].id).toBe(id);
                expect(events[0].consecutiveFailures).toBe(6);
        });

        test("an infra 'error' run breaks the streak — it says nothing about solvability", () => {
                const id = `q-errbreak-${RUN}`;
                seedTask(id);
                seedRun(id, "failed", 6);
                // newest run is an infra error (started_at DESC ordering)
                store.run(`INSERT INTO runs (id, task_id, kind, status, started_at) VALUES (?, ?, 'baseline', 'error', ?)`, [
                        `${id}-err-${RUN}`,
                        id,
                        Date.now() + 1000,
                ]);
                expect(quarantineCheck(id).quarantined).toBe(false);
                expect(taskRow(id).active).toBe(1);
        });

        test("a passed run breaks the streak", () => {
                const id = `q-passbreak-${RUN}`;
                seedTask(id);
                seedRun(id, "failed", 6);
                store.run(`INSERT INTO runs (id, task_id, kind, status, started_at) VALUES (?, ?, 'baseline', 'passed', ?)`, [
                        `${id}-pass-${RUN}`,
                        id,
                        Date.now() + 1000,
                ]);
                expect(quarantineCheck(id).quarantined).toBe(false);
        });
});

describe("quarantineCheck — the gates", () => {
        test("seed-origin tasks never quarantine (only minted capability evals)", () => {
                const id = `q-seed-${RUN}`;
                seedTask(id, { origin: "seed", status: "regression" });
                seedRun(id, "failed", 10);
                expect(quarantineCheck(id).quarantined).toBe(false);
                expect(taskRow(id).active).toBe(1);
        });

        test("a graduated task (pass_count > 0) never quarantines", () => {
                const id = `q-grad-${RUN}`;
                seedTask(id, { passCount: 1 });
                seedRun(id, "failed", 10);
                expect(quarantineCheck(id).quarantined).toBe(false);
        });

        test("an already-inactive task is a no-op (idempotent)", () => {
                const id = `q-inactive-${RUN}`;
                seedTask(id, { active: 0, status: "quarantined" });
                seedRun(id, "failed", 10);
                expect(quarantineCheck(id).quarantined).toBe(false);
                expect(taskRow(id).status).toBe("quarantined");
        });

        test("an unknown task id is a no-op", () => {
                expect(quarantineCheck(`q-missing-${RUN}`).quarantined).toBe(false);
        });
});

describe("quarantineCheck — the knob", () => {
        test("UNOWN_CAPABILITY_QUARANTINE_AFTER=0 disables the breaker", () => {
                process.env.UNOWN_CAPABILITY_QUARANTINE_AFTER = "0";
                const id = `q-off-${RUN}`;
                seedTask(id);
                seedRun(id, "failed", 20);
                expect(capabilityQuarantineAfter()).toBe(0);
                expect(quarantineCheck(id).quarantined).toBe(false);
                expect(taskRow(id).active).toBe(1);
        });

        test("a custom threshold applies (2 failures quarantine)", () => {
                process.env.UNOWN_CAPABILITY_QUARANTINE_AFTER = "2";
                const id = `q-two-${RUN}`;
                seedTask(id);
                seedRun(id, "failed", 2);
                expect(quarantineCheck(id).quarantined).toBe(true);
                expect(taskRow(id)).toEqual({ active: 0, status: "quarantined" });
        });

        test("a junk value falls back to the default 6", () => {
                process.env.UNOWN_CAPABILITY_QUARANTINE_AFTER = "not-a-number";
                expect(capabilityQuarantineAfter()).toBe(6);
        });

        test("an EMPTY value falls back to the default 6 (Number('') is 0 — the .env.example trap)", () => {
                process.env.UNOWN_CAPABILITY_QUARANTINE_AFTER = "";
                expect(capabilityQuarantineAfter()).toBe(6);
        });

        test("unset falls back to the default 6", () => {
                delete process.env.UNOWN_CAPABILITY_QUARANTINE_AFTER;
                expect(capabilityQuarantineAfter()).toBe(6);
        });
});
