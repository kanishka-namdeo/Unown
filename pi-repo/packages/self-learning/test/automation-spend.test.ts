// automation-spend.test.ts — the automation spend meter + ceilings (S2-11).
//
// Pins the windowed aggregation (per-routine + global, rolling 24h + 7d
// tokens/runs/turns), the dispatcher gate's graduated semantics (at/over ->
// a RECORDED spend_ceiling skip, never a lifecycle change; the window drains
// and the routine resumes), the manual-run bypass (bypasses the gate but its
// tokens count toward the windows), the global ceiling across routines, and
// the CLI parse helper + the hub card's search ranking.
//
// The scheduler cases never start the poll loop (tick()/dispatchEvent() are
// the public seams) and inject a fake RunDispatcher, so no real CLI session
// is spawned.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        AutomationsScheduler,
        createAutomation,
        ensureAutomationsSchema,
        getAutomation,
        listRuns,
        updateAutomation,
        type AutomationRow,
} from "../src/automations.ts";
import {
        globalSpendCapTokensDay,
        SPEND_WINDOW_DAY_MS,
        SPEND_WINDOW_7D_MS,
        spendGate,
        automationSpendReport,
} from "../src/automation-spend.ts";
import { store } from "../src/store.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKSPACE = mkdtempSync(join(tmpdir(), "unown-spend-ws-"));

/** IDs created by these tests — deleted in afterAll (and on the hot path). */
const created: string[] = [];

function track(r: { ok: true; automation: AutomationRow } | { ok: false; error: string }): AutomationRow {
        if (!r.ok) throw new Error(`createAutomation failed: ${r.error}`);
        created.push(r.automation.id);
        return r.automation;
}

function drop(id: string): void {
        store.run(`DELETE FROM automation_runs WHERE automation_id = ?`, [id]);
        store.run(`DELETE FROM automations WHERE id = ?`, [id]);
        const i = created.indexOf(id);
        if (i >= 0) created.splice(i, 1);
}

function scheduledRoutine(title: string, opts: { spendCap?: number | null; every?: string } = {}): AutomationRow {
        return track(
                createAutomation({
                        title,
                        prompt: "test prompt",
                        workspace: WORKSPACE,
                        schedule: { every: opts.every ?? "1d" },
                        spendCap: opts.spendCap ?? null,
                }),
        );
}

/** Insert a finished run row directly (deterministic tokens; no spawn). */
function insertRun(
        automationId: string,
        ts: number,
        tokensIn: number,
        tokensOut: number,
        turns: number,
        trigger: "schedule" | "manual" | "event" | "retry" = "schedule",
): void {
        store.run(
                `INSERT INTO automation_runs (id, automation_id, trigger_kind, scheduled_at, status, started_at, ended_at, turns, tokens_in, tokens_out)
                 VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?, ?, ?)`,
                [`${automationId}:test:${ts}`, automationId, trigger, ts, ts, ts, turns, tokensIn, tokensOut],
        );
}

/** An instant fake dispatcher that records who it ran. */
function instantDispatcher(tokensIn = 0, tokensOut = 0) {
        const seen: string[] = [];
        const dispatch = async (a: AutomationRow) => {
                seen.push(a.id);
                return { exitCode: 0, output: `ran ${a.title}`, turns: 1, tokensIn, tokensOut };
        };
        return { dispatch, seen };
}

const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));

afterAll(() => {
        for (const id of created) drop(id);
        rmSync(WORKSPACE, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Aggregation — windowed sums, boundary, zero-runs
// ---------------------------------------------------------------------------

describe("automation spend aggregation", () => {
        beforeAll(() => {
                // Test isolation: failed runs in earlier suites leave rows behind
                // (their inline drop() never ran) — start from a clean slate.
                // ensureAutomationsSchema FIRST: the `automations` table is NOT in
                // store.ts's base SCHEMA — it is created lazily by the
                // automations module. On a fresh test DB this file can be the
                // FIRST store caller (Windows CI's alphabetical discovery runs
                // `automation-spend` before every `automations*` sibling), so the
                // raw DELETE below would hit "no such table" — the v0.0.56
                // release-blocking defect (receipted: the v0.0.56 tag's CI red,
                // its release never rendered; reproduced locally by wiping
                // /tmp/engine-tests-b and running this file alone).
                ensureAutomationsSchema();
                store.run(`DELETE FROM automations`);
                store.run(`DELETE FROM automation_runs`);
        });

        test("per-routine + global windowed sums (24h + 7d), the boundary, zero-runs", () => {
                const now = Date.now();
                const a = scheduledRoutine("agg-a", { spendCap: 1000 });
                const b = scheduledRoutine("agg-b");
                try {
                        // Zero-runs state.
                        let report = automationSpendReport(now);
                        let ra = report.routines.find((r) => r.automationId === a.id)!;
                        expect(ra.day.tokens).toBe(0);
                        expect(ra.day.runs).toBe(0);
                        expect(ra.week.tokens).toBe(0);
                        expect(report.total.day.tokens).toBe(0);

                        // A run exactly ON the 24h window edge counts (>= boundary).
                        insertRun(a.id, now - SPEND_WINDOW_DAY_MS, 100, 50, 2); // 150 tokens, 2 turns
                        // A run 1ms PAST the edge does NOT.
                        insertRun(b.id, now - SPEND_WINDOW_DAY_MS - 1, 999, 999, 9);
                        report = automationSpendReport(now);
                        ra = report.routines.find((r) => r.automationId === a.id)!;
                        const rb = report.routines.find((r) => r.automationId === b.id)!;
                        expect(ra.day.tokens).toBe(150); // only the on-edge run is in 24h
                        expect(ra.day.runs).toBe(1);
                        expect(ra.day.turns).toBe(2);
                        expect(rb.day.tokens).toBe(0); // past the edge, out of 24h
                        expect(rb.week.tokens).toBe(1998); // but in 7d
                        expect(report.total.day.tokens).toBe(150);
                        expect(report.total.week.tokens).toBe(150 + 1998);

                        // A routine with a cap reports throttledNow when day >= cap.
                        store.run(`UPDATE automations SET spend_cap = 100 WHERE id = ?`, [a.id]);
                        report = automationSpendReport(now);
                        ra = report.routines.find((r) => r.automationId === a.id)!;
                        expect(ra.cap).toBe(100);
                        expect(ra.throttledNow).toBe(true); // 150 >= 100
                        expect(ra.drainAt === null || ra.drainAt > 0).toBe(true);
                        drop(a.id);
                        drop(b.id);
                } finally {
                        // no-op: drop() above already cleaned up; keep the try/finally shape honest
                }
        });
});

// ---------------------------------------------------------------------------
// 2. The gate — at-cap scheduled/event skips, drain-resume, bypass, global
// ---------------------------------------------------------------------------

describe("spend ceiling gate", () => {
        test("at-cap scheduled dispatch records a spend_ceiling skip; no spawn", async () => {
                const now = Date.now();
                const row = scheduledRoutine("gate-scheduled", { spendCap: 100 });
                        insertRun(row.id, now - 1000, 80, 40, 1); // 120 >= 100 -> at/over
                        expect(spendGate(row.id, now).allow).toBe(false);
                        expect(spendGate(row.id, now).reason!.startsWith("spend_ceiling")).toBe(true);

                        // The dispatcher gate records a skip row, no spawn.
                        const s = new AutomationsScheduler(async () => {
                                throw new Error("must not spawn at/over the cap");
                        }, 60_000);
                        // Bend the row to look due.
                        store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [now - 1000, row.id]);
                        await s.tick(new Date(now));
                        const runs = listRuns(row.id);
                        const skip = runs.find((r) => r.status === "skipped");
                        expect(skip).toBeDefined();
                        expect(skip!.error!.includes("spend_ceiling")).toBe(true);
                        // No spawned run: exactly the pre-inserted test row + the recorded skip.
                        expect(runs.length).toBe(2);
                        expect(runs.filter((r) => r.status === "skipped").length).toBe(1);
                        expect(runs.some((r) => r.id === `${row.id}:test:${now - 1000}`)).toBe(true);
                        drop(row.id);
        });

        test("window drains -> dispatch resumes (a fresh window under the cap allows)", async () => {
                const now = Date.now();
                const row = scheduledRoutine("gate-drain", { spendCap: 1000 });
                        insertRun(row.id, now - 1000, 900, 200, 1); // 1100 >= 1000 -> at/over now
                        expect(spendGate(row.id, now).allow).toBe(false);
                        // The same run is OUT of the 24h window 24h later -> allowed.
                        const later = now + SPEND_WINDOW_DAY_MS + 5000;
                        expect(spendGate(row.id, later).allow).toBe(true);
                        drop(row.id);
        });

        test("at-cap event dispatch records a skip (not spawned)", async () => {
                const now = Date.now();
                const ev = "m2.spend.ceiling";
                const row = track(
                        createAutomation({
                                title: "gate-event",
                                prompt: "test prompt",
                                workspace: WORKSPACE,
                                schedule: {},
                                eventKind: ev,
                                spendCap: 100,
                        }),
                );
                        insertRun(row.id, now - 1000, 80, 40, 1); // 120 >= 100 -> at/over
                        const gate = instantDispatcher();
                        const s = new AutomationsScheduler(gate.dispatch, 60_000);
                        const r = await s.dispatchEvent(ev, {}, now);
                        expect(r.dispatched).toBe(0);
                        expect(r.results[0].outcome).toBe("spend-ceiling");
                        expect(gate.seen).toEqual([]); // never spawned
                        const runs = listRuns(row.id);
                        expect(runs.some((x) => x.status === "skipped" && (x.error ?? "").includes("spend_ceiling"))).toBe(true);
                        drop(row.id);
        });

        test("manual runNow BYPASSES the gate but its tokens COUNT toward the window", async () => {
                const now = Date.now();
                const row = scheduledRoutine("gate-manual", { spendCap: 100 });
                        // At/over the cap: a scheduled gate would skip...
                        insertRun(row.id, now - 1000, 80, 40, 1); // 120 >= 100
                        expect(spendGate(row.id, now).allow).toBe(false);
                        // ...but a MANUAL run bypasses (runNow never consults the gate).
                        const gate = instantDispatcher(5, 5); // manual run records 10 tokens
                        const s = new AutomationsScheduler(gate.dispatch, 60_000);
                        const res = await s.runNow(row.id);
                        expect(res.ok).toBe(true);
                        gate.seen.push(row.id); // the dispatcher was reached (bypass)
                        await settle();
                        // The manual run's tokens landed in the window: the gate now
                        // sees the higher total (120 + 10) and is still at/over.
                        const after = automationSpendReport(now).routines.find((r) => r.automationId === row.id)!;
                        expect(after.day.tokens).toBe(130); // 120 (insert) + 10 (manual)
                        drop(row.id);
        });

        test("global ceiling enforces across routines' combined sum", () => {
                const now = Date.now();
                process.env.PI_AUTOMATION_MAX_TOKENS_DAY = "100";
                let a: ReturnType<typeof scheduledRoutine>;
                let b: ReturnType<typeof scheduledRoutine>;
                try {
                        expect(globalSpendCapTokensDay()).toBe(100);
                        a = scheduledRoutine("gate-global-a");
                        b = scheduledRoutine("gate-global-b");
                        // Individually under a per-routine cap, but combined >= 100.
                        insertRun(a.id, now - 1000, 40, 40, 1); // 80
                        insertRun(b.id, now - 500, 30, 30, 1); // 60 -> global 140 >= 100
                        // No per-routine caps set; the global cap governs.
                        expect(spendGate(a.id, now).allow).toBe(false);
                        expect(spendGate(b.id, now).allow).toBe(false);
                        expect(spendGate(a.id, now).reason!.includes("PI_AUTOMATION_MAX_TOKENS_DAY")).toBe(true);
                } finally {
                        if (a) drop(a.id);
                        if (b) drop(b.id);
                        delete process.env.PI_AUTOMATION_MAX_TOKENS_DAY;
                }
        });

        test("ceiling OFF (NULL cap, unset global) never skips", () => {
                const now = Date.now();
                delete process.env.PI_AUTOMATION_MAX_TOKENS_DAY;
                const row = scheduledRoutine("gate-off", { spendCap: null });
                        insertRun(row.id, now - 1000, 1_000_000, 1_000_000, 9); // huge spend, no cap
                        expect(spendGate(row.id, now).allow).toBe(true);
                        expect(spendGate(row.id, now).reason).toBeNull();
                        drop(row.id);
        });
});

// ---------------------------------------------------------------------------
// 3. CLI parse — --spend-cap semantics (pin the parse helper's behavior via the
//    createAutomation validation, since the CLI helper is not exported).
// ---------------------------------------------------------------------------

describe("CLI --spend-cap parse semantics", () => {
        test("createAutomation validates spendCap: positive integer, 0/null clears, invalid rejected", () => {
                // 0 normalizes to "off" (no ceiling) — accepted, stored null.
                const off = track(createAutomation({
                        title: "cap-zero", prompt: "p", workspace: WORKSPACE,
                        schedule: { every: "1d" }, spendCap: 0,
                }));
                expect(getAutomation(off.id)!.spend_cap).toBeNull();
                drop(off.id);

                // A positive integer is stored.
                const set = track(createAutomation({
                        title: "cap-set", prompt: "p", workspace: WORKSPACE,
                        schedule: { every: "1d" }, spendCap: 500,
                }));
                expect(getAutomation(set.id)!.spend_cap).toBe(500);
                drop(set.id);

                // Invalid: a non-positive / non-integer is rejected.
                const bad = createAutomation({
                        title: "cap-bad", prompt: "p", workspace: WORKSPACE,
                        schedule: { every: "1d" }, spendCap: -5,
                });
                expect(bad.ok).toBe(false);
                const bad2 = createAutomation({
                        title: "cap-bad2", prompt: "p", workspace: WORKSPACE,
                        schedule: { every: "1d" }, spendCap: 2.5,
                });
                expect(bad2.ok).toBe(false);

                // updateAutomation: --spend-cap off (null) clears; a positive int sets.
                const u = track(createAutomation({
                        title: "cap-edit", prompt: "p", workspace: WORKSPACE,
                        schedule: { every: "1d" }, spendCap: 300,
                }));
                updateAutomation(u.id, { spend_cap: 777 });
                expect(getAutomation(u.id)!.spend_cap).toBe(777);
                updateAutomation(u.id, { spend_cap: 0 }); // off -> clears
                expect(getAutomation(u.id)!.spend_cap).toBeNull();
                const badEdit = updateAutomation(u.id, { spend_cap: -1 });
                expect((badEdit as any).ok).toBe(false);
                drop(u.id);
        });
});

// ---------------------------------------------------------------------------
// 4. Hub card — automation.spend exists (kind action, section automation) and
//    ranks TOP-3 for the search query "spend".
// ---------------------------------------------------------------------------

describe("hub card automation.spend", () => {
        test("automation.spend exists with kind action, section automation, risk low", async () => {
                const { SETTINGS_REGISTRY } = await import("../src/settings/registry.ts");
                const item = SETTINGS_REGISTRY.find((i) => i.id === "automation.spend");
                expect(item).toBeDefined();
                expect(item!.kind).toBe("action");
                expect(item!.section).toBe("automation");
                expect(item!.risk).toBe("low");
                expect(item!.name).toBe("Automation spend meter");
        });

        test("search ranks automation.spend TOP-3 for 'spend'", async () => {
                const { searchSettings } = await import("../src/settings/search.ts");
                const hits = searchSettings("spend");
                expect(hits.length).toBeGreaterThan(0);
                const top3 = hits.slice(0, 3).map((h) => h.item.id);
                expect(top3).toContain("automation.spend");
        });
});
