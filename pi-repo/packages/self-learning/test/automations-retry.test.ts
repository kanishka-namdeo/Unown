// automations-retry.test.ts — M6 (routines v5): the failed-run retry policy
// + chained routines (the internal `routine.finished` event).
//
// Two surfaces, one per half:
//
//   1. RETRY POLICY (k8s Job backoffLimit semantics) — create/update
//      validation (retry-max 0..10, retry-backoff 30..3600), the arm/clear
//      chain on failure/success, the tick's retry loop (trigger 'retry',
//      attempt 2+, retry_of link, never re-advancing the schedule and never
//      consuming run_count/maxRuns), the once-kind lifecycle hold, budget
//      exhaustion, the 24h staleness horizon, and orphan recovery's
//      retry-aware no-re-arm branch.
//   2. CHAINED ROUTINES (GitHub's workflow_run pattern) — a completed run
//      broadcasts routine.finished; listeners fire with chainDepth+1; the
//      depth cap refuses past MAX_CHAIN_DEPTH hops (recorded, visible); the
//      public webhook lane refuses the reserved routine.* namespace while
//      the local lane keeps it for rehearsal.
//
// Scheduler cases never start the poll loop (tick()/dispatchEvent() are the
// public seams) and never spawn real CLI sessions — every dispatcher is a
// fake, so PI_DISABLE_ENGINE_SPAWN holds trivially. "Due" states are bent
// directly, same as automations.test.ts. Chain listeners carry
// routineId-specific filters BY DESIGN: listener rows live until afterAll,
// and a filterless listener would fire on every later test's completions.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AutomationRow,
	AutomationsScheduler,
	createAutomation,
	getAutomation,
	listRuns,
	MAX_CHAIN_DEPTH,
	RETRY_BACKOFF_CAP_SECS,
	RETRY_MAX_LIMIT,
	spawnAutomationRun,
	updateAutomation,
} from "../src/automations.ts";
import { engineTokenPath, removeEngineTokenFile, sharedEngineTokenPath } from "../src/engine-auth.ts";
import { startServer } from "../src/index.ts";
import { router } from "../src/router.ts";
import { automationsScheduler } from "../src/server.ts";
import { DATA_DIR, store } from "../src/store.ts";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const WORKSPACE = mkdtempSync(join(tmpdir(), "unown-m6-ws-"));
const created: string[] = [];

/** Let voided executeClaimed chains finish (the automations.test.ts cadence). */
const settle = () => new Promise((r) => setTimeout(r, 25));

/** Hot-path cleanup (the 20-row cap bites mid-file; afterAll is too late).
 *  Every test deletes its rows on exit — the suite DB is shared across runs. */
function cleanupRoutine(id: string): void {
	try {
		store.run(`DELETE FROM automations WHERE id = ?`, [id]);
		store.run(`DELETE FROM automation_runs WHERE automation_id = ?`, [id]);
	} catch {
		/* best effort */
	}
	const i = created.indexOf(id);
	if (i >= 0) created.splice(i, 1);
}

/** Sweep this file's leftovers (a previous failed run leaves rows behind in
 *  the shared redirected DB; titles are this file's namespace). */
function sweepM6(): void {
	for (const row of store.query<{ id: string }>(
		`SELECT id FROM automations WHERE title LIKE 'm6 %' OR title LIKE 'once retry%' OR title = 'budget'`,
	)) {
		cleanupRoutine(row.id);
	}
}

/** createAutomation with the cap-survival retry: a full DB from a previous
 *  partial run sweeps OUR rows and tries once more. */
function mustCreate(input: Parameters<typeof createAutomation>[0]): AutomationRow {
	let r = createAutomation(input);
	if (!r.ok && r.error.includes("limit reached")) {
		sweepM6();
		r = createAutomation(input);
	}
	if (!r.ok) throw new Error(`createAutomation failed: ${r.error}`);
	created.push(r.automation.id);
	return r.automation;
}

function track<T extends { ok: true; automation: AutomationRow }>(r: T): AutomationRow {
	created.push(r.automation.id);
	return r.automation;
}

/** A cron automation that is DUE right now (next_run_at bent to the past). */
function dueAutomation(opts: { retryMax?: number; retryBackoffSecs?: number } = {}): AutomationRow {
	const r = mustCreate({
		title: `m6 ${Math.random().toString(36).slice(2, 8)}`,
		prompt: "test prompt",
		workspace: WORKSPACE,
		schedule: { cron: "*/5 * * * *" },
		retryMax: opts.retryMax ?? null,
		retryBackoffSecs: opts.retryBackoffSecs ?? null,
	});
	store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [Date.now() - 1000, r.id]);
	return getAutomation(r.id)!;
}

/** A event routine listening on routine.finished, scoped to ONE source
 *  routine by id (the chain idiom: B after A). */
function chainListener(sourceId: string, extra = ""): AutomationRow {
	return mustCreate({
		title: `m6 listener ${Math.random().toString(36).slice(2, 8)}`,
		prompt: "chained work",
		workspace: WORKSPACE,
		schedule: {},
		eventKind: "routine.finished",
		eventFilter: `routineId == "${sourceId}"${extra ? ` ${extra}` : ""}`,
	});
}

/** Bend a pending retry chain to "due now". */
function retryDue(id: string): void {
	store.run(`UPDATE automations SET retry_next_at = ? WHERE id = ?`, [Date.now() - 1000, id]);
}

/** A dispatcher whose outcomes the test scripts per call. */
function scriptedDispatcher(outcomes: Array<0 | 1>) {
	let i = 0;
	const calls: Array<{ automationId: string; trigger: string; eventPayload?: string }> = [];
	const dispatch = async (a: AutomationRow, run: any, ctx?: { eventPayload?: string }) => {
		calls.push({ automationId: a.id, trigger: run.trigger_kind, eventPayload: ctx?.eventPayload });
		const exitCode = outcomes[Math.min(i, outcomes.length - 1)] ?? 0;
		i++;
		return { exitCode, output: `call ${i}`, turns: 1, tokensIn: 10, tokensOut: 10 };
	};
	return { dispatch, calls };
}

afterEach(() => {
	// hot-path cleanup — the 20-row cap bites mid-file, afterAll is too late
	for (const id of [...created]) cleanupRoutine(id);
});

afterAll(() => {
	for (const id of created) {
		try {
			store.run(`DELETE FROM automations WHERE id = ?`, [id]);
			store.run(`DELETE FROM automation_runs WHERE automation_id = ?`, [id]);
		} catch {
			/* best effort — temp ids are unique per run */
		}
	}
	rmSync(WORKSPACE, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Retry policy — CRUD validation
// ---------------------------------------------------------------------------

describe("retry policy — create/update validation", () => {
	test("retryMax must be an integer 0..10 (0 normalizes to off/null)", () => {
		expect(
			createAutomation({
				title: "t",
				prompt: "p",
				workspace: WORKSPACE,
				schedule: { cron: "* * * * *" },
				retryMax: RETRY_MAX_LIMIT + 1,
			}).ok,
		).toBe(false);
		expect(
			createAutomation({
				title: "t",
				prompt: "p",
				workspace: WORKSPACE,
				schedule: { cron: "* * * * *" },
				retryMax: -1,
			}).ok,
		).toBe(false);
		expect(
			createAutomation({
				title: "t",
				prompt: "p",
				workspace: WORKSPACE,
				schedule: { cron: "* * * * *" },
				retryMax: 1.5,
			}).ok,
		).toBe(false);
		const zero = track(
			createAutomation({
				title: "t",
				prompt: "p",
				workspace: WORKSPACE,
				schedule: { cron: "* * * * *" },
				retryMax: 0,
			}),
		);
		expect(zero.retry_max).toBeNull(); // 0 = off, stored normalized
		const five = track(
			createAutomation({
				title: "t",
				prompt: "p",
				workspace: WORKSPACE,
				schedule: { cron: "* * * * *" },
				retryMax: 5,
			}),
		);
		expect(five.retry_max).toBe(5);
	});

	test("retryBackoffSecs must be an integer 30..3600", () => {
		expect(
			createAutomation({
				title: "t",
				prompt: "p",
				workspace: WORKSPACE,
				schedule: { cron: "* * * * *" },
				retryBackoffSecs: 29,
			}).ok,
		).toBe(false);
		expect(
			createAutomation({
				title: "t",
				prompt: "p",
				workspace: WORKSPACE,
				schedule: { cron: "* * * * *" },
				retryBackoffSecs: RETRY_BACKOFF_CAP_SECS + 1,
			}).ok,
		).toBe(false);
		const ok = track(
			createAutomation({
				title: "t",
				prompt: "p",
				workspace: WORKSPACE,
				schedule: { cron: "* * * * *" },
				retryMax: 1,
				retryBackoffSecs: 30,
			}),
		);
		expect(ok.retry_backoff_secs).toBe(30);
	});

	test("event routines accept retries (an occurrence can fail like a slot)", () => {
		const row = track(
			createAutomation({
				title: "t",
				prompt: "p",
				workspace: WORKSPACE,
				schedule: {},
				eventKind: "m6.ev.retry",
				retryMax: 2,
			}),
		);
		expect(row.retry_max).toBe(2);
	});

	test("update: retryMax 0/null disarms a pending chain; bad values 400", () => {
		const row = dueAutomation({ retryMax: 2 });
		store.run(`UPDATE automations SET retry_next_at = ?, retry_attempt = 2, retry_of_run = ? WHERE id = ?`, [
			Date.now() + 60_000,
			"x",
			row.id,
		]);
		expect(updateAutomation(row.id, { retryMax: 0 }).ok).toBe(true);
		const cleared = getAutomation(row.id)!;
		expect(cleared.retry_max).toBeNull();
		expect(cleared.retry_next_at).toBeNull();
		expect(cleared.retry_attempt).toBeNull();
		expect(cleared.retry_of_run).toBeNull();
		expect(updateAutomation(row.id, { retryMax: 99 }).ok).toBe(false);
		expect(updateAutomation(row.id, { retryBackoffSecs: 5 }).ok).toBe(false);
		const tuned = updateAutomation(row.id, { retryMax: 3, retryBackoffSecs: 120 });
		expect(tuned.ok).toBe(true);
		if (tuned.ok) {
			expect(tuned.automation.retry_max).toBe(3);
			expect(tuned.automation.retry_backoff_secs).toBe(120);
		}
	});
});

// ---------------------------------------------------------------------------
// Retry policy — the scheduler
// ---------------------------------------------------------------------------

describe("retry policy — the scheduler", () => {
	test("a failed run arms the chain: attempt 2 pending, schedule advanced, run recorded failed", async () => {
		const d = scriptedDispatcher([1]); // the occurrence fails
		const s = new AutomationsScheduler(d.dispatch, 60_000);
		const row = dueAutomation({ retryMax: 2, retryBackoffSecs: 60 });
		await s.tick();
		await settle();
		s.stop();
		const runs = listRuns(row.id);
		expect(runs).toHaveLength(1);
		expect(runs[0].status).toBe("failed");
		expect(runs[0].attempt).toBe(1);
		expect(runs[0].retry_of).toBeNull();
		const after = getAutomation(row.id)!;
		expect(after.retry_next_at).not.toBeNull();
		expect(after.retry_next_at!).toBeGreaterThan(Date.now());
		expect(after.retry_attempt).toBe(2);
		expect(after.retry_of_run).toBe(runs[0].id);
		// the slot advanced independently — the chain is additive
		expect(after.next_run_at!).toBeGreaterThan(Date.now());
	});

	test("the due retry fires as trigger 'retry': attempt 2, linked, never counted, chain cleared on success", async () => {
		const d = scriptedDispatcher([1, 0]); // fail, then the retry succeeds
		const s = new AutomationsScheduler(d.dispatch, 60_000);
		const row = dueAutomation({ retryMax: 1, retryBackoffSecs: 30 });
		await s.tick(); // original fails, chain armed
		await settle();
		const original = listRuns(row.id)[0];
		retryDue(row.id);
		await s.tick(); // the retry fires
		await settle();
		s.stop();
		const runs = listRuns(row.id);
		expect(runs).toHaveLength(2);
		const retry = runs.find((r) => r.trigger_kind === "retry")!;
		expect(retry).toBeDefined();
		expect(retry.attempt).toBe(2);
		expect(retry.retry_of).toBe(original.id);
		expect(retry.status).toBe("succeeded");
		// the retry never consumed the occurrence budget
		const after = getAutomation(row.id)!;
		expect(after.run_count).toBe(1);
		expect(after.scheduled_run_count).toBe(1);
		expect(after.retry_next_at).toBeNull();
		expect(after.retry_attempt).toBeNull();
		expect(after.retry_of_run).toBeNull();
	});

	test("budget exhaustion: retry_max 1 means exactly one retry, then the chain clears", async () => {
		const d = scriptedDispatcher([1, 1, 1]); // everything fails
		const s = new AutomationsScheduler(d.dispatch, 60_000);
		const row = dueAutomation({ retryMax: 1, retryBackoffSecs: 30 });
		await s.tick();
		await settle();
		retryDue(row.id);
		await s.tick(); // retry attempt 2 fails — budget spent
		await settle();
		await s.tick(); // no armed chain, future slot — nothing fires
		await settle();
		s.stop();
		expect(d.calls).toHaveLength(2);
		const after = getAutomation(row.id)!;
		expect(after.retry_next_at).toBeNull();
		expect(listRuns(row.id).filter((r) => r.trigger_kind === "retry")).toHaveLength(1);
	});

	test("backoff doubles per attempt, capped at 3600s", async () => {
		const d = scriptedDispatcher([1, 1, 1]);
		const s = new AutomationsScheduler(d.dispatch, 60_000);
		const row = dueAutomation({ retryMax: 3, retryBackoffSecs: 1800 }); // 2*1800 > 3600 → cap
		await s.tick();
		await settle();
		let after = getAutomation(row.id)!;
		expect(after.retry_next_at!).toBeGreaterThan(Date.now() + 1800_000 - 2000);
		retryDue(row.id);
		await s.tick(); // attempt 2 fails → next wait is capped at 3600s
		await settle();
		after = getAutomation(row.id)!;
		expect(after.retry_attempt).toBe(3);
		expect(after.retry_next_at! - Date.now()).toBeLessThanOrEqual(3600_000 + 5000);
		s.stop();
	});

	test("a successful run of ANY trigger disarms a pending chain (the task completed)", async () => {
		const d = scriptedDispatcher([1]); // the occurrence fails
		const s = new AutomationsScheduler(d.dispatch, 60_000);
		const row = dueAutomation({ retryMax: 2 });
		await s.tick();
		await settle();
		expect(getAutomation(row.id)!.retry_next_at).not.toBeNull();
		s.stop();
		// a manual run succeeds → the chain clears
		const manual = new AutomationsScheduler(
			async () => ({ exitCode: 0, output: "manual ok", turns: 0, tokensIn: 0, tokensOut: 0 }),
			60_000,
		);
		const now = await manual.runNow(row.id);
		expect(now.ok).toBe(true);
		await settle();
		manual.stop();
		const after = getAutomation(row.id)!;
		expect(after.retry_next_at).toBeNull();
	});

	test("a failed ONCE-routine holds 'active' with only the retry armed; the retry finalizes it", async () => {
		const r = mustCreate({
			title: "once retry",
			prompt: "p",
			workspace: WORKSPACE,
			schedule: { delayMinutes: 10 },
			retryMax: 1,
			retryBackoffSecs: 30,
		});
		store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [Date.now() - 1000, r.id]);
		const d = scriptedDispatcher([1, 0]);
		const s = new AutomationsScheduler(d.dispatch, 60_000);
		await s.tick(); // the one occurrence fails → held, chain armed
		await settle();
		const held = getAutomation(r.id)!;
		expect(held.lifecycle).toBe("active"); // NOT completed — the retry is pending
		expect(held.next_run_at).toBeNull();
		expect(held.retry_next_at).not.toBeNull();
		retryDue(r.id);
		await s.tick(); // the retry succeeds → the once finalizes
		await settle();
		s.stop();
		const after = getAutomation(r.id)!;
		expect(after.lifecycle).toBe("completed");
		expect(after.next_run_at).toBeNull();
		expect(after.retry_next_at).toBeNull();
	});

	test("a once-routine whose retry ALSO fails completes (budget spent)", async () => {
		const r = mustCreate({
			title: "once retry fail",
			prompt: "p",
			workspace: WORKSPACE,
			schedule: { delayMinutes: 10 },
			retryMax: 1,
			retryBackoffSecs: 30,
		});
		store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [Date.now() - 1000, r.id]);
		const d = scriptedDispatcher([1, 1]);
		const s = new AutomationsScheduler(d.dispatch, 60_000);
		await s.tick();
		await settle();
		retryDue(r.id);
		await s.tick();
		await settle();
		s.stop();
		const after = getAutomation(r.id)!;
		expect(after.lifecycle).toBe("completed");
		expect(after.retry_next_at).toBeNull();
	});

	test("a retry older than the 24h horizon is stale: recorded, cleared, never dispatched", async () => {
		const d = scriptedDispatcher([1]);
		const s = new AutomationsScheduler(d.dispatch, 60_000);
		const row = dueAutomation({ retryMax: 2 });
		await s.tick(); // arm the chain
		await settle();
		s.stop();
		// bend the pending retry 25 hours into the past
		store.run(`UPDATE automations SET retry_next_at = ? WHERE id = ?`, [Date.now() - 25 * 60 * 60_000, row.id]);
		const stale = new AutomationsScheduler(async () => {
			throw new Error("must not dispatch a stale retry");
		}, 60_000);
		await stale.tick();
		await settle();
		stale.stop();
		const after = getAutomation(row.id)!;
		expect(after.retry_next_at).toBeNull();
		const skips = listRuns(row.id).filter((r) => r.status === "skipped");
		expect(skips.some((r) => r.error === "retry_stale" && r.trigger_kind === "retry")).toBe(true);
	});

	test("retries never consume the maxRuns budget", async () => {
		const r = mustCreate({
			title: "budget",
			prompt: "p",
			workspace: WORKSPACE,
			schedule: { delayMinutes: 10 },
			retryMax: 1,
			retryBackoffSecs: 30,
			maxRuns: 1,
		});
		store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [Date.now() - 1000, r.id]);
		const d = scriptedDispatcher([1, 0]);
		const s = new AutomationsScheduler(d.dispatch, 60_000);
		await s.tick();
		await settle();
		retryDue(r.id);
		await s.tick();
		await settle();
		s.stop();
		const after = getAutomation(r.id)!;
		expect(after.scheduled_run_count).toBe(1); // the occurrence, never its retry
		expect(listRuns(r.id).filter((r) => r.trigger_kind === "retry")).toHaveLength(1);
	});

	test("orphan recovery: a crashed RETRY claim re-fires via the chain and never re-arms the slot", async () => {
		const row = dueAutomation({ retryMax: 2 });
		const slotFuture = Date.now() + 300_000; // a properly-advanced schedule
		store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [slotFuture, row.id]);
		// simulate a crashed retry: stale claim + a dead 'running' retry row + armed chain
		store.run(
			`UPDATE automations SET running = 1, claimed_at = ?, retry_next_at = ?, retry_attempt = 2, retry_of_run = ? WHERE id = ?`,
			[Date.now() - 11 * 60_000, Date.now() - 1000, "orig", row.id],
		);
		store.run(
			`INSERT INTO automation_runs (id, automation_id, trigger_kind, status, started_at, attempt) VALUES (?, ?, 'retry', 'running', ?, 2)`,
			[`${row.id}:retry:crash`, row.id, Date.now() - 11 * 60_000],
		);
		const s = new AutomationsScheduler(
			async () => ({ exitCode: 0, output: "recovered", turns: 0, tokensIn: 0, tokensOut: 0 }),
			60_000,
		);
		(s as any).recoverOrphans();
		const reclaimed = getAutomation(row.id)!;
		expect(reclaimed.running).toBe(0);
		expect(reclaimed.next_run_at).toBe(slotFuture); // NOT re-armed — the slot was never consumed by the retry
		expect(reclaimed.retry_next_at).not.toBeNull(); // the chain survived to re-fire
		const deadRun = listRuns(row.id).find((r) => r.id === `${row.id}:retry:crash`);
		expect(deadRun?.status).toBe("failed");
		expect(deadRun?.error).toContain("engine restarted");
		// and the re-fire works: the next tick dispatches the pending retry
		await s.tick();
		await settle();
		s.stop();
		expect(
			listRuns(row.id).some(
				(r) => r.trigger_kind === "retry" && r.status === "succeeded" && r.id !== `${row.id}:retry:crash`,
			),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Chained routines — routine.finished
// ---------------------------------------------------------------------------

describe("chained routines — routine.finished", () => {
	test("a completed run dispatches listeners: payload framed as data, chainDepth 1", async () => {
		const target = dueAutomation();
		const listener = chainListener(target.id);
		const d = scriptedDispatcher([0]);
		const s = new AutomationsScheduler(d.dispatch, 60_000);
		await s.tick(); // target succeeds → routine.finished → listener fires
		await settle();
		s.stop();
		const listenerCalls = d.calls.filter((c) => c.automationId === listener.id);
		expect(listenerCalls).toHaveLength(1);
		expect(listenerCalls[0].trigger).toBe("event");
		const payload = JSON.parse(listenerCalls[0].eventPayload!);
		expect(payload.routineId).toBe(target.id);
		expect(payload.status).toBe("succeeded");
		expect(payload.chainDepth).toBe(1);
		expect(payload.attempt).toBe(1);
		// and the listener's run row is a real event run
		expect(listRuns(listener.id).some((r) => r.trigger_kind === "event")).toBe(true);
	});

	test("a status filter gates the chain: a FAILED run does not fire a succeeded-only listener", async () => {
		const target = dueAutomation();
		const listener = chainListener(target.id, `status == "succeeded"`);
		const d = scriptedDispatcher([1]); // target fails
		const s = new AutomationsScheduler(d.dispatch, 60_000);
		await s.tick();
		await settle();
		s.stop();
		expect(d.calls.filter((c) => c.automationId === listener.id)).toHaveLength(0);
		expect(listRuns(listener.id)).toHaveLength(0); // filter-rejected, not a run row — same as webhook filters
	});

	test("the depth cap: a chain past MAX_CHAIN_DEPTH is refused and RECORDED", async () => {
		// one listener scoped to a synthetic "kicked" source, kicked manually
		// via the local lane (dispatchEvent is the seam the engine itself uses).
		const listener = chainListener("kicked");
		const d = scriptedDispatcher([0]);
		const s = new AutomationsScheduler(d.dispatch, 60_000);
		// depth MAX_CHAIN_DEPTH is the last dispatchable hop
		const atCap = await s.dispatchEvent("routine.finished", { routineId: "kicked", chainDepth: MAX_CHAIN_DEPTH });
		expect(atCap.results.find((r) => r.id === listener.id)?.outcome).toBe("dispatched");
		await settle();
		// depth + 1 is refused — the listener sees a recorded skip, not a run
		const past = await s.dispatchEvent("routine.finished", { routineId: "kicked", chainDepth: MAX_CHAIN_DEPTH + 1 });
		expect(past.results.find((r) => r.id === listener.id)?.outcome).toBe("dropped-chain-depth");
		s.stop();
		const skips = listRuns(listener.id).filter((r) => r.status === "skipped");
		expect(skips.some((r) => r.error === "chain_depth_capped")).toBe(true);
		expect(listRuns(listener.id).filter((r) => r.status !== "skipped")).toHaveLength(1); // only the at-cap hop ran
	});

	test("a chained listener's OWN completion compounds the depth (workflow_run's anti-recursion, spelled our way)", async () => {
		// A finishes → B (event listener scoped to A) fires at depth 1 →
		// B's completion emits depth 2 → C (scoped to B) fires at depth 2.
		const target = dueAutomation();
		const b = chainListener(target.id);
		const c = chainListener(b.id);
		const d = scriptedDispatcher([0, 0, 0]);
		const s = new AutomationsScheduler(d.dispatch, 60_000);
		await s.tick(); // target → B (depth 1) → B's completion emits depth 2 → C
		await settle();
		await settle(); // two chained hops to settle
		s.stop();
		const bCall = d.calls.find((x) => x.automationId === b.id);
		expect(bCall).toBeDefined();
		expect(JSON.parse(bCall!.eventPayload!).chainDepth).toBe(1);
		const cCall = d.calls.find((x) => x.automationId === c.id);
		expect(cCall).toBeDefined();
		expect(JSON.parse(cCall!.eventPayload!).chainDepth).toBe(2);
		expect(JSON.parse(cCall!.eventPayload!).routineId).toBe(b.id);
	});

	test("retry runs broadcast too (a recovered chain still reports)", async () => {
		const target = dueAutomation({ retryMax: 1, retryBackoffSecs: 30 });
		const listener = chainListener(target.id, `status == "failed" attempt >= 2`);
		const d = scriptedDispatcher([1, 1]); // occurrence fails, retry fails
		const s = new AutomationsScheduler(d.dispatch, 60_000);
		await s.tick();
		await settle();
		retryDue(target.id);
		await s.tick();
		await settle();
		s.stop();
		const calls = d.calls.filter((c) => c.automationId === listener.id);
		expect(calls).toHaveLength(1);
		const payload = JSON.parse(calls[0].eventPayload!);
		expect(payload.attempt).toBe(2);
		expect(payload.status).toBe("failed");
	});
});

// ---------------------------------------------------------------------------
// The public webhook lane reservation (routine.* is engine-emitted only)
// ---------------------------------------------------------------------------

describe("webhook lane — the reserved routine.* namespace", () => {
	let engine: ReturnType<typeof startServer> | null = null;
	let base = "";
	let token = "";
	let hookId = "";
	const d = scriptedDispatcher([]);

	beforeAll(async () => {
		automationsScheduler.setDispatcher(d.dispatch);
		engine = await startServer(0);
		expect(engine).not.toBeNull();
		base = `http://127.0.0.1:${(engine as any).port}`;
		token = readFileSync(engineTokenPath(), "utf8").trim();
		const info = await fetch(`${base}/api/hooks/info`, { headers: { Authorization: `Bearer ${token}` } });
		hookId = String((await info.json()).hookId);
	});

	afterAll(() => {
		try {
			engine?.stop(true);
		} catch {
			/* already stopped */
		}
		try {
			router.stop();
			automationsScheduler.stop();
		} catch {
			/* best effort */
		}
		automationsScheduler.setDispatcher(spawnAutomationRun); // restore the real seam
		// H6 hygiene: this in-process boot wrote the cross-install discovery
		// mirror ($UNOWN_HOME/engine.token) at token-commit — remove BOTH
		// discovery sides so later suites in this shared process keep their
		// "no token discoverable" semantics (the ubuntu CI leg caught the leak).
		try {
			removeEngineTokenFile(engineTokenPath());
			removeEngineTokenFile(sharedEngineTokenPath());
		} catch {
			/* best effort */
		}
		try {
			if (existsSync(join(DATA_DIR, "engine.lock"))) rmSync(join(DATA_DIR, "engine.lock"));
		} catch {
			/* best effort */
		}
	});

	test("the PUBLIC lane 400s on routine.* (senders cannot forge chain events)", async () => {
		const res = await fetch(`${base}/api/hooks/${hookId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				event: "routine.finished",
				payload: { routineId: "forged", status: "succeeded", chainDepth: 1 },
			}),
		});
		expect(res.status).toBe(400);
		expect(String((await res.json()).error)).toContain("reserved");
		// a NON-routine event still flows
		const ok = await fetch(`${base}/api/hooks/${hookId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ event: "m6.public.ok", payload: {} }),
		});
		expect(ok.status).toBe(200);
	});

	test("the LOCAL lane keeps routine.* (tests + chain rehearsal)", async () => {
		const res = await fetch(`${base}/api/automations/event-dispatch`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: JSON.stringify({ event: "routine.finished", payload: { routineId: "rehearsal", chainDepth: 1 } }),
		});
		expect(res.status).toBe(200);
		expect((await res.json()).ok).toBe(true);
	});
});
