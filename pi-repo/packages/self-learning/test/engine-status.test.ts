/**
 * Unit tests for src/engine-status.ts — the M6 agent-side engine-health
 * state machine (footer row, one-toast-per-transition, gated auto-start
 * kicks, engineAssumedDown fast-path hint).
 *
 * Everything runs against INJECTED probe/kickSpawn hooks: no real network,
 * no real spawns, no timers waited on beyond one deliberate 2.3s fast-reprobe
 * window in the fresh-process section. The pure text functions (footer,
 * toast, circuit summary) are pinned exactly — they are UI copy.
 *
 * Two process scopes, on purpose:
 *   - in-process: the loop + transitions + fallback snapshot (the suite's
 *     PI_DISABLE_ENGINE_SPAWN=1 guard means kickSpawn is never invoked —
 *     itself a pinned invariant);
 *   - fresh bun subprocess (the detachment.test.ts pattern): the "starting"
 *     and kill-switch paths sit BEHIND the SPAWN_DISABLED module-load const,
 *     so they can only be exercised with the guard absent from the env.
 *
 * The supervisor's circuit file lives in the REPO's .run/ (source shape —
 * stateRoot ignores UNOWN_HOME for checkouts), which the live stack also
 * uses: every scenario that touches it snapshots + restores byte-for-byte.
 * The outbox counts come from the redirected UNOWN_HOME (./_env.ts).
 */
import "./_env.ts"; // MUST be the first import
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	countProjectRules,
	DREAM_NEWS_MAX_AGE_MS,
	type DreamNews,
	describeSpawnCircuit,
	dreamNewsToastText,
	type EngineState,
	type EngineStatusHooks,
	type EngineStatusInfo,
	engineAssumedDown,
	engineFooterText,
	engineToastText,
	formatMemoryBar,
	getEngineStatusInfo,
	humanizeDreamAge,
	readMemoryBarInfo,
	shouldToastDreamNews,
	startEngineStatusLoop,
	stopEngineStatusLoop,
} from "../src/engine-status.ts";
import { enginePidFile, readSpawnState, type SpawnState, spawnStateFile } from "../src/engine-supervisor.ts";
import { agentGitSha, agentVersion } from "../src/engine-version.ts";
import { outboxStats, slugifyPath, UNOWN_OUTBOX_DIR, writeOutboxNote } from "../src/term.ts";
import { TEST_TMP } from "./_env.ts";

const PKG_ROOT = join(import.meta.dir, "..");
const MARKER = `engine-status-${Date.now().toString(36)}`;
const PROJECT = join("/tmp", MARKER);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function freshCircuit(now = Date.now()): SpawnState {
	return { attempts: 0, windowStart: now, lastAttemptAt: 0, lastHealthyAt: 0, gaveUp: false };
}

function makeInfo(state: EngineState, overrides: Partial<EngineStatusInfo> = {}): EngineStatusInfo {
	return {
		state,
		since: Date.now(),
		lastProbeAt: Date.now(),
		queuedNotes: 0,
		droppedNotes: 0,
		spawn: freshCircuit(),
		...overrides,
	};
}

/** Read a .run file without failing when absent (snapshot helper). */
function tryRead(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

/** Restore a .run file to its exact prior state (null = it did not exist). */
function tryWrite(path: string, content: string | null) {
	try {
		if (content === null) rmSync(path, { force: true });
		else {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, content, "utf8");
		}
	} catch {
		/* best effort */
	}
}

/** The loop is a process-wide singleton; every scenario starts from zero. */
function startFresh(hooks: EngineStatusHooks) {
	stopEngineStatusLoop();
	return startEngineStatusLoop(hooks);
}

function seedCircuit(state: SpawnState) {
	mkdirSync(dirname(spawnStateFile()), { recursive: true });
	writeFileSync(spawnStateFile(), JSON.stringify(state), "utf8");
}

/** Parse the probe scripts' single-line JSON result (TAG={...}). */
function parseTagged(stdout: string, tag: string): any {
	const m = stdout.match(new RegExp(`${tag}=(\\{.*\\})`, "s"));
	if (!m) throw new Error(`probe did not print ${tag}; stdout=${stdout}`);
	return JSON.parse(m[1]);
}

let savedSpawnState: string | null = null;
let savedPidFile: string | null = null;
let savedProbeInterval: string | undefined;

beforeAll(() => {
	savedSpawnState = tryRead(spawnStateFile());
	savedPidFile = tryRead(enginePidFile());
	savedProbeInterval = process.env.PI_ENGINE_PROBE_INTERVAL_MS;
	// 5s is the probe-interval FLOOR: the loop's interval timer never fires
	// during a scenario (tests finish in milliseconds), but engineAssumedDown's
	// freshness window is max(60s, 2×interval) — pinned deterministically here.
	process.env.PI_ENGINE_PROBE_INTERVAL_MS = "5000";
	stopEngineStatusLoop(); // defensive: no loop left over from anywhere
});

afterAll(() => {
	stopEngineStatusLoop();
	tryWrite(spawnStateFile(), savedSpawnState);
	tryWrite(enginePidFile(), savedPidFile);
	if (savedProbeInterval === undefined) delete process.env.PI_ENGINE_PROBE_INTERVAL_MS;
	else process.env.PI_ENGINE_PROBE_INTERVAL_MS = savedProbeInterval;
	// this suite's outbox files (queue-count scenarios) never leak
	try {
		for (const f of readdirSync(UNOWN_OUTBOX_DIR))
			if (f.includes(MARKER)) rmSync(join(UNOWN_OUTBOX_DIR, f), { force: true });
	} catch {
		/* no outbox dir */
	}
});

// ---------------------------------------------------------------------------
// engineFooterText — the five states (UI copy, pinned exactly)
// ---------------------------------------------------------------------------

describe("engineFooterText", () => {
	test.each([
		["unknown", "memory: --"],
		["up", "memory: up"],
		["starting", "memory: starting…"],
		["down", "memory: down"],
		["paused", "memory: paused · /engine"],
	] as Array<[EngineState, string]>)("%s → %s", (state, expected) => {
		expect(engineFooterText(makeInfo(state))).toBe(expected);
	});

	test("down with a backlog appends the queued count", () => {
		expect(engineFooterText(makeInfo("down", { queuedNotes: 3 }))).toBe("memory: down · 3 queued");
	});

	test("down with zero queued notes shows no backlog suffix", () => {
		expect(engineFooterText(makeInfo("down", { queuedNotes: 0 }))).toBe("memory: down");
	});
});

// ---------------------------------------------------------------------------
// engineFooterText — the M11 activity suffix (UI copy, pinned exactly)
// ---------------------------------------------------------------------------

describe("engineFooterText — the router-activity suffix", () => {
	test("an idle engine (no active job) is byte-identical to the M6 copy", () => {
		expect(engineFooterText(makeInfo("up"))).toBe("memory: up");
		expect(engineFooterText(makeInfo("up", { activeJob: "", busyMs: 0 }))).toBe("memory: up");
	});

	test("a running job names itself even before a minute elapses (activeJob, not busyMs, is the idle test)", () => {
		expect(engineFooterText(makeInfo("up", { activeJob: "auto-dream" }))).toBe("memory: up · auto-dream");
		expect(engineFooterText(makeInfo("up", { activeJob: "auto-dream", busyMs: 200 }))).toBe(
			"memory: up · auto-dream",
		);
	});

	test("under a minute of elapsed shows no number — the job starting IS the news", () => {
		expect(engineFooterText(makeInfo("up", { activeJob: "note-sync", busyMs: 59_999 }))).toBe(
			"memory: up · note-sync",
		);
	});

	test("elapsed buckets to whole minutes, so a 30s probe cadence cannot churn the line", () => {
		expect(engineFooterText(makeInfo("up", { activeJob: "harness-cycle", busyMs: 60_000 }))).toBe(
			"memory: up · harness-cycle 1m",
		);
		expect(engineFooterText(makeInfo("up", { activeJob: "harness-cycle", busyMs: 90_000 }))).toBe(
			"memory: up · harness-cycle 1m",
		);
		expect(engineFooterText(makeInfo("up", { activeJob: "harness-cycle", busyMs: 259_000 }))).toBe(
			"memory: up · harness-cycle 4m",
		);
	});

	test("an hour-plus job reads as h+m and never as a bare minute count", () => {
		expect(engineFooterText(makeInfo("up", { activeJob: "harness-cycle", busyMs: 3_600_000 }))).toBe(
			"memory: up · harness-cycle 1h0m",
		);
		expect(engineFooterText(makeInfo("up", { activeJob: "harness-cycle", busyMs: 4_500_000 }))).toBe(
			"memory: up · harness-cycle 1h15m",
		);
	});

	test("a wedged-but-alive engine (job far past the watchdog) still reports it — the suffix has no cap", () => {
		expect(engineFooterText(makeInfo("up", { activeJob: "auto-dream", busyMs: 86_400_000 }))).toBe(
			"memory: up · auto-dream 24h0m",
		);
	});

	test("negative/NaN busyMs never reaches the footer", () => {
		expect(engineFooterText(makeInfo("up", { activeJob: "auto-dream", busyMs: -5 }))).toBe("memory: up · auto-dream");
		expect(engineFooterText(makeInfo("up", { activeJob: "auto-dream", busyMs: Number.NaN }))).toBe(
			"memory: up · auto-dream",
		);
	});

	test("the M8 build suffix WINS: a stale engine shows the action, not the job", () => {
		const verdict = (v: string) => ({ verdict: v as any, detail: "test" });
		expect(
			engineFooterText(
				makeInfo("up", {
					buildVerdict: verdict("stale"),
					engineVersion: { version: "2.1.0" },
					activeJob: "auto-dream",
					busyMs: 240_000,
				}),
			),
		).toBe("memory: up · stale (v2.1.0)");
	});

	test("the activity suffix never rides a non-up state", () => {
		expect(engineFooterText(makeInfo("down", { activeJob: "auto-dream", busyMs: 240_000 }))).toBe("memory: down");
		expect(engineFooterText(makeInfo("starting", { activeJob: "auto-dream", busyMs: 240_000 }))).toBe(
			"memory: starting…",
		);
	});
});

// ---------------------------------------------------------------------------
// engineToastText — one toast per TRANSITION, never at session start
// ---------------------------------------------------------------------------

describe("engineToastText", () => {
	test("same-state transitions are silent", () => {
		for (const s of ["unknown", "up", "starting", "down", "paused"] as EngineState[]) {
			expect(engineToastText(s, s, 5)).toBeUndefined();
		}
	});

	test("unknown on either side is silent (session start / first probe in flight)", () => {
		expect(engineToastText("unknown", "up", 0)).toBeUndefined();
		expect(engineToastText("unknown", "down", 4)).toBeUndefined();
		expect(engineToastText("unknown", "paused", 4)).toBeUndefined();
		expect(engineToastText("down", "unknown", 4)).toBeUndefined();
		expect(engineToastText("up", "unknown", 0)).toBeUndefined();
	});

	test("→down warns: chat unaffected, notes queue locally", () => {
		expect(engineToastText("up", "down", 2)).toEqual({
			message: "memory engine unreachable — chat unaffected, notes queue locally",
			level: "warning",
		});
	});

	test("→paused warns with the actionable repair hint", () => {
		const t = engineToastText("starting", "paused", 7);
		expect(t?.level).toBe("warning");
		expect(t?.message).toBe(
			"memory engine won't start (repeated failures) — run `unown engine status`; chat unaffected, notes keep queuing locally",
		);
	});

	test("→up from down announces resumed learning + draining when notes queued", () => {
		expect(engineToastText("down", "up", 3)).toEqual({
			message: "memory engine online — learning resumed — draining 3 queued note(s)",
			level: "info",
		});
	});

	test("→up after starting does NOT drain-count (the queue was just probed into existence)", () => {
		expect(engineToastText("starting", "up", 3)).toEqual({
			message: "memory engine online — learning resumed",
			level: "info",
		});
	});

	test("→up with an empty queue has no draining suffix", () => {
		expect(engineToastText("down", "up", 0)).toEqual({
			message: "memory engine online — learning resumed",
			level: "info",
		});
	});

	test("→starting is silent (a kick is not an event worth interrupting for)", () => {
		expect(engineToastText("up", "starting", 0)).toBeUndefined();
		expect(engineToastText("down", "starting", 2)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// describeSpawnCircuit — /engine + doctor diagnosis copy
// ---------------------------------------------------------------------------

describe("describeSpawnCircuit", () => {
	test("idle: no failed starts recorded", () => {
		expect(describeSpawnCircuit(freshCircuit())).toBe("idle — no failed starts recorded");
	});

	test("gave up: counts the attempts and names both remedies", () => {
		const s = describeSpawnCircuit({ ...freshCircuit(), attempts: 5, gaveUp: true });
		expect(s).toContain("gave up after 5 failed start(s)");
		expect(s).toContain("unown engine start");
		expect(s).toContain("repair");
	});

	test("backoff: attempt number + next auto-start countdown + reassurance", () => {
		const s = describeSpawnCircuit({ ...freshCircuit(), attempts: 1, lastAttemptAt: Date.now() - 500 });
		expect(s).toContain("backing off");
		expect(s).toContain("attempt 1");
		expect(s).toContain("next auto-start in");
		expect(s).toContain("auto-start works");
	});

	test("attempts recorded but auto-start allowed (backoff served)", () => {
		const s = describeSpawnCircuit({ ...freshCircuit(), attempts: 2, lastAttemptAt: Date.now() - 60_000 });
		expect(s).toBe("2 recent attempt(s) recorded, auto-start allowed");
	});
});

// ---------------------------------------------------------------------------
// the status loop, in-process — injected probe + kickSpawn, no network
// ---------------------------------------------------------------------------

describe("engine status loop (injected hooks)", () => {
	test("first probe up: footer flips silently (no session-start toast), circuit reset observed", async () => {
		seedCircuit({ ...freshCircuit(), attempts: 3, lastAttemptAt: Date.now() });
		const footers: string[] = [];
		const toasts: Array<[string, string]> = [];
		const loop = startFresh({
			probe: async () => ({ up: true, pid: 4242, busyMs: 12, activeJob: "dream-check" }),
			kickSpawn: async () => {
				throw new Error("an up probe must never kick a spawn");
			},
			onFooter: (t) => footers.push(t ?? ""),
			onToast: (m, l) => toasts.push([m, l]),
		});
		const info = await loop.probeNow();
		expect(info.state).toBe("up");
		expect(info.pid).toBe(4242);
		expect(info.busyMs).toBe(12);
		expect(info.activeJob).toBe("dream-check");
		// M11: a busy engine names its job on the footer (busyMs 12 ms is
		// under the whole-minute bucket, so no elapsed number yet).
		expect(footers).toContain("memory: up · dream-check");
		expect(toasts).toEqual([]); // session-start silence: the initial state is a fact, not an event
		// markEngineHealthy side effect: an observed-healthy engine resets the crash circuit
		const circuit = readSpawnState();
		expect(circuit.attempts).toBe(0);
		expect(circuit.gaveUp).toBe(false);
		expect(circuit.lastHealthyAt).toBeGreaterThan(0);
		stopEngineStatusLoop();
	});

	test("circuit gave up + down probe → paused, no spawn kicked, no toast", async () => {
		seedCircuit({ ...freshCircuit(), attempts: 5, lastAttemptAt: Date.now(), gaveUp: true });
		let kicks = 0;
		const footers: string[] = [];
		const toasts: Array<[string, string]> = [];
		const loop = startFresh({
			probe: async () => ({ up: false }),
			kickSpawn: async () => {
				kicks++;
				return true;
			},
			onFooter: (t) => footers.push(t ?? ""),
			onToast: (m, l) => toasts.push([m, l]),
		});
		const info = await loop.probeNow();
		expect(info.state).toBe("paused"); // gave-up wins over another doomed kick
		expect(footers).toContain("memory: paused · /engine");
		expect(kicks).toBe(0);
		expect(toasts).toEqual([]); // even paused arrives silently at session start
		expect(engineAssumedDown()).toBe(true); // paused + fresh probe counts as known-down
		stopEngineStatusLoop();
	});

	test("up→down warns once and counts the queue; down→up announces draining", async () => {
		seedCircuit(freshCircuit()); // healthy circuit: down probes may kick (gated)
		const before = outboxStats().queued;
		writeOutboxNote({ content: `status-loop queue probe A ${MARKER}`, projectPath: PROJECT, ts: Date.now() });
		writeOutboxNote({ content: `status-loop queue probe B ${MARKER}`, projectPath: PROJECT, ts: Date.now() });
		let up = true;
		let kicks = 0;
		const footers: string[] = [];
		const toasts: Array<[string, string]> = [];
		const loop = startFresh({
			probe: async () => ({ up }),
			kickSpawn: async () => {
				kicks++;
				return false;
			},
			onFooter: (t) => footers.push(t ?? ""),
			onToast: (m, l) => toasts.push([m, l]),
		});
		await loop.probeNow(); // session starts healthy — silent
		expect(toasts).toEqual([]);

		up = false;
		const downInfo = await loop.probeNow();
		const queued = outboxStats().queued;
		expect(downInfo.state).toBe("down");
		expect(queued).toBeGreaterThanOrEqual(before + 2); // our two notes (+ anything already queued)
		expect(footers).toContain(`memory: down · ${queued} queued`);
		expect(toasts).toEqual([["memory engine unreachable — chat unaffected, notes queue locally", "warning"]]);
		expect(kicks).toBe(0); // PI_DISABLE_ENGINE_SPAWN=1 in the suite — the hook is never invoked
		expect(engineAssumedDown()).toBe(true);

		up = true;
		const upInfo = await loop.probeNow();
		expect(upInfo.state).toBe("up");
		expect(footers).toContain("memory: up");
		expect(toasts).toHaveLength(2);
		expect(toasts[1]).toEqual([
			`memory engine online — learning resumed — draining ${outboxStats().queued} queued note(s)`,
			"info",
		]);
		expect(engineAssumedDown()).toBe(false); // up is the opposite of assumed down
		stopEngineStatusLoop();
	});

	test("a throwing probe is simply down — the loop never dies", async () => {
		seedCircuit(freshCircuit());
		const loop = startFresh({
			probe: async () => {
				throw new Error("probe blew up");
			},
			kickSpawn: async () => false,
		});
		const info = await loop.probeNow();
		expect(info.state).toBe("down");
		stopEngineStatusLoop();
	});

	test("engineAssumedDown trusts a down snapshot only while fresh (60s floor at the 5s interval)", async () => {
		seedCircuit(freshCircuit());
		const loop = startFresh({ probe: async () => ({ up: false }), kickSpawn: async () => false });
		await loop.probeNow();
		expect(engineAssumedDown()).toBe(true); // fresh down snapshot
		const anchor = Date.now();
		const realNow = Date.now;
		try {
			Date.now = () => anchor + 30_000; // still inside max(60s, 2×5s)
			expect(engineAssumedDown()).toBe(true);
			Date.now = () => anchor + 61_000; // stale — a delivery must re-probe for itself
			expect(engineAssumedDown()).toBe(false);
		} finally {
			Date.now = realNow;
		}
		stopEngineStatusLoop();
	});

	test("stopEngineStatusLoop clears the loop; getEngineStatusInfo falls back to the file snapshot", async () => {
		// A DOWN probe keeps the circuit file exactly as seeded (only an observed
		// healthy engine rewrites it), so the fallback snapshot is provably
		// file-backed, not loop-memory-backed.
		seedCircuit({ attempts: 2, windowStart: 111, lastAttemptAt: 222, lastHealthyAt: 0, gaveUp: false });
		const loop = startFresh({ probe: async () => ({ up: false }), kickSpawn: async () => false });
		await loop.probeNow();
		expect(getEngineStatusInfo().state).toBe("down"); // the live loop answers

		stopEngineStatusLoop();
		const snap = getEngineStatusInfo();
		expect(snap.state).toBe("unknown"); // no loop: cheap file-only snapshot, never probes
		expect(snap.lastProbeAt).toBe(0);
		expect(snap.queuedNotes).toBe(outboxStats().queued);
		expect(snap.droppedNotes).toBe(outboxStats().dropped);
		expect(snap.spawn).toEqual({
			attempts: 2,
			windowStart: 111,
			lastAttemptAt: 222,
			lastHealthyAt: 0,
			gaveUp: false,
		});
		expect(engineAssumedDown()).toBe(false); // no loop → never assume down
	});

	test("restarting the loop is a no-op while one runs (the loop survives /new)", async () => {
		seedCircuit(freshCircuit());
		let calls = 0;
		const first = startFresh({
			probe: async () => {
				calls++;
				return { up: true };
			},
		});
		const second = startEngineStatusLoop({ probe: async () => ({ up: false }) }); // different hooks — IGNORED
		expect(second).toBe(first); // same singleton, the second call's hooks never take effect
		await first.probeNow();
		expect(getEngineStatusInfo().state).toBe("up");
		expect(calls).toBeGreaterThanOrEqual(1);
		stopEngineStatusLoop();
	});
});

// ---------------------------------------------------------------------------
// spawn-guarded paths — fresh bun subprocess (SPAWN_DISABLED is a module-load
// const, so the "starting"/kill-switch branches need the guard absent).
// The probe/kickSpawn hooks are still injected: no network, and the kick
// never reaches the real supervisor spawn.
// ---------------------------------------------------------------------------

function runEngineStatusProbe(
	overrides: { autostart?: string },
	body: string,
): { code: number; stdout: string; stderr: string } {
	const root = mkdtempSync(join(tmpdir(), "unown-engine-status-"));
	const script = `
// Parity guard with the other probe suites: this script doubles as the
// "engine serve" spawn target elsewhere; here nothing spawns.
if (process.argv[2] === "engine" && process.argv[3] === "serve") process.exit(0);
const mod = await import(${JSON.stringify(join(PKG_ROOT, "src/engine-status.ts"))});
${body}
`;
	const probePath = join(root, "probe.ts");
	writeFileSync(probePath, script);
	const env: NodeJS.ProcessEnv = {
		...process.env,
		PI_SELFLEARNING_DB: join(root, "engine.db"),
		PI_SELFLEARNING_DATA: join(root, "data"),
		PI_BRIDGE_URL: "http://127.0.0.1:9",
		UNOWN_HOME: join(root, "unown-home"),
		UNOWN_ENGINE_URL: "http://127.0.0.1:9",
		PI_ENGINE_PROBE_INTERVAL_MS: "5000",
		NO_UPDATE_NOTIFIER: "1",
	};
	delete env.PI_DISABLE_ENGINE_SPAWN; // the whole point of the fresh process
	delete env.UNOWN_ENGINE_AUTOSTART;
	if (overrides.autostart !== undefined) env.UNOWN_ENGINE_AUTOSTART = overrides.autostart;
	const res = spawnSync(process.execPath, [probePath], { env, encoding: "utf8", timeout: 60_000 });
	rmSync(root, { recursive: true, force: true });
	return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe("engine status loop (fresh process, spawn guard absent)", () => {
	test("down probe + successful kick → starting, with fast re-probes re-kicking", async () => {
		const saved = tryRead(spawnStateFile());
		seedCircuit(freshCircuit()); // healthy circuit: the kick path is live
		try {
			const r = runEngineStatusProbe(
				{},
				`
const footers = [];
const toasts = [];
let kicks = 0;
const loop = mod.startEngineStatusLoop({
        probe: async () => ({ up: false }),
        kickSpawn: async () => { kicks++; return true; },
        onFooter: (t) => footers.push(t ?? ""),
        onToast: (m, l) => toasts.push([m, l]),
});
const first = await loop.probeNow();
const kicksBefore = kicks;
await Bun.sleep(2300); // the 2s fast re-probe after a kicked spawn fires here
console.log("PROBE_RESULT=" + JSON.stringify({
        firstState: first.state,
        laterState: mod.getEngineStatusInfo().state,
        kicksBefore,
        kicksAfter: kicks,
        footers,
        toasts,
        assumedDown: mod.engineAssumedDown(),
}));
mod.stopEngineStatusLoop();
process.exit(0);
`,
			);
			expect(r.code).toBe(0);
			const out = parseTagged(r.stdout, "PROBE_RESULT");
			expect(out.firstState).toBe("starting");
			expect(out.laterState).toBe("starting"); // fast re-probe re-kicked (still booting)
			expect(out.kicksBefore).toBeGreaterThanOrEqual(2); // initial probe + probeNow
			expect(out.kicksAfter).toBeGreaterThan(out.kicksBefore); // the ~2s fast re-probe
			expect(out.footers).toContain("memory: starting…");
			expect(out.toasts).toEqual([]); // starting is silent (and session-start silence)
			expect(out.assumedDown).toBe(false); // starting ≠ known-down
		} finally {
			tryWrite(spawnStateFile(), saved);
		}
	}, 15_000);

	test("UNOWN_ENGINE_AUTOSTART=0 (kill switch): down probe kicks nothing → down", async () => {
		const saved = tryRead(spawnStateFile());
		seedCircuit(freshCircuit());
		try {
			const r = runEngineStatusProbe(
				{ autostart: "0" },
				`
const footers = [];
const toasts = [];
let kicks = 0;
const loop = mod.startEngineStatusLoop({
        probe: async () => ({ up: false }),
        kickSpawn: async () => { kicks++; return true; },
        onFooter: (t) => footers.push(t ?? ""),
        onToast: (m, l) => toasts.push([m, l]),
});
const first = await loop.probeNow();
console.log("PROBE_RESULT=" + JSON.stringify({
        firstState: first.state,
        kicks,
        footers,
        toasts,
        assumedDown: mod.engineAssumedDown(),
}));
mod.stopEngineStatusLoop();
process.exit(0);
`,
			);
			expect(r.code).toBe(0);
			const out = parseTagged(r.stdout, "PROBE_RESULT");
			expect(out.firstState).toBe("down"); // kill switch honored even with a kicking hook
			expect(out.kicks).toBe(0);
			expect(out.footers).toContain("memory: down"); // fresh UNOWN_HOME → no queue suffix
			expect(out.toasts).toEqual([]);
			expect(out.assumedDown).toBe(true); // down + fresh
		} finally {
			tryWrite(spawnStateFile(), saved);
		}
	}, 15_000);
});

// ---------------------------------------------------------------------------
// M8: the version-skew surfaces — footer suffix + one build toast per
// fresh→stale transition. The handshake block injected through the probe is
// crafted against the REAL agent build (agentVersion/agentGitSha/
// codeMtimeMs of this checkout), exactly what a live probe would receive.
// ---------------------------------------------------------------------------

describe("engineFooterText — the M8 build suffix (UI copy, pinned exactly)", () => {
	const verdict = (v: string) => ({ verdict: v as any, detail: "test" });

	test("up + old-build (same version, different sha) → 'memory: up · old build'", () => {
		expect(
			engineFooterText(makeInfo("up", { buildVerdict: verdict("old-build"), engineVersion: { version: "2.1.0" } })),
		).toBe("memory: up · old build");
	});

	test("up + stale → 'memory: up · stale (v<engine version>)'", () => {
		expect(
			engineFooterText(makeInfo("up", { buildVerdict: verdict("stale"), engineVersion: { version: "2.1.0" } })),
		).toBe("memory: up · stale (v2.1.0)");
	});

	test("up + ancient → 'memory: up · very stale (v<engine version>)'", () => {
		expect(
			engineFooterText(makeInfo("up", { buildVerdict: verdict("ancient"), engineVersion: { version: "1.9.0" } })),
		).toBe("memory: up · very stale (v1.9.0)");
	});

	test("up + fresh / unknown / ahead / no verdict → the unchanged 'memory: up'", () => {
		expect(engineFooterText(makeInfo("up"))).toBe("memory: up");
		expect(
			engineFooterText(makeInfo("up", { buildVerdict: verdict("fresh"), engineVersion: { version: "2.1.0" } })),
		).toBe("memory: up");
		expect(engineFooterText(makeInfo("up", { buildVerdict: verdict("unknown") }))).toBe("memory: up");
		expect(
			engineFooterText(makeInfo("up", { buildVerdict: verdict("ahead"), engineVersion: { version: "9.9.9" } })),
		).toBe("memory: up");
	});

	test("the suffix never rides a non-up state (down/paused stay exactly as M6 pinned them)", () => {
		expect(
			engineFooterText(makeInfo("down", { buildVerdict: verdict("stale"), engineVersion: { version: "2.1.0" } })),
		).toBe("memory: down");
		expect(engineFooterText(makeInfo("paused", { buildVerdict: verdict("ancient") }))).toBe(
			"memory: paused · /engine",
		);
	});
});

describe("engine status loop — the M8 version handshake (injected probe)", () => {
	/** A handshake block that compares FRESH against this real checkout. */
	function freshBlock() {
		return { version: agentVersion(), gitSha: agentGitSha(), bootedAt: Date.now() };
	}
	/** A handshake block one minor version behind (plain stale — not ancient). */
	function staleBlock() {
		const [maj, min] = agentVersion().split(".").map(Number);
		const older = `${maj}.${Math.max(0, min - 1)}.0`;
		return { version: older, bootedAt: Date.now() - 3600_000 };
	}

	test("footer carries the stale suffix; ONE info toast on the fresh→stale transition, none at session start", async () => {
		seedCircuit(freshCircuit());
		let block: any = freshBlock();
		const footers: string[] = [];
		const toasts: Array<[string, string]> = [];
		const loop = startFresh({
			probe: async () => ({ up: true, pid: 777, version: block }),
			kickSpawn: async () => false,
			onFooter: (t) => footers.push(t ?? ""),
			onToast: (m, l) => toasts.push([m, l]),
		});
		const first = await loop.probeNow(); // session starts fresh — silent
		expect(first.state).toBe("up");
		expect(first.buildVerdict?.verdict).toBe("fresh");
		expect(footers).toContain("memory: up");
		expect(toasts).toEqual([]);

		block = staleBlock(); // the agent updated underneath the engine
		const staleInfo = await loop.probeNow();
		expect(staleInfo.buildVerdict?.verdict).toBe("stale");
		expect(footers).toContain(`memory: up · stale (v${staleBlock().version})`);
		expect(toasts).toHaveLength(1);
		expect(toasts[0][1]).toBe("info");
		expect(toasts[0][0]).toContain(`memory engine is an older build (v${staleBlock().version}`);
		expect(toasts[0][0]).toContain("booted 1h 0m ago");
		expect(toasts[0][0]).toContain("run `unown engine restart`; chat unaffected");

		await loop.probeNow(); // still stale — the toast does NOT repeat
		expect(toasts).toHaveLength(1);
		stopEngineStatusLoop();
	});

	test("a session that STARTS against a stale engine is silent (fact, not event) — footer still says it", async () => {
		seedCircuit(freshCircuit());
		const block = staleBlock();
		const footers: string[] = [];
		const toasts: Array<[string, string]> = [];
		const loop = startFresh({
			probe: async () => ({ up: true, pid: 778, version: block }),
			kickSpawn: async () => false,
			onFooter: (t) => footers.push(t ?? ""),
			onToast: (m, l) => toasts.push([m, l]),
		});
		const info = await loop.probeNow();
		expect(info.state).toBe("up");
		expect(info.buildVerdict?.verdict).toBe("stale");
		expect(footers).toContain(`memory: up · stale (v${block.version})`);
		expect(toasts).toEqual([]); // no session-start nagging
		stopEngineStatusLoop();
	});

	test("a down probe clears the handshake (no stale verdict about an engine we cannot reach)", async () => {
		seedCircuit(freshCircuit());
		let up = true;
		const block = freshBlock();
		const loop = startFresh({
			probe: async () => (up ? { up: true, pid: 779, version: block } : { up: false }),
			kickSpawn: async () => false,
		});
		const upInfo = await loop.probeNow();
		expect(upInfo.buildVerdict?.verdict).toBe("fresh");
		up = false;
		const downInfo = await loop.probeNow();
		expect(downInfo.state).toBe("down");
		expect(downInfo.buildVerdict).toBeUndefined();
		expect(downInfo.engineVersion).toBeUndefined();
		stopEngineStatusLoop();
	});

	test("a pre-M8 engine (up, no version block) reports verdict unknown and renders the plain footer", async () => {
		seedCircuit(freshCircuit());
		const footers: string[] = [];
		const toasts: Array<[string, string]> = [];
		const loop = startFresh({
			probe: async () => ({ up: true, pid: 780 }), // no version field
			kickSpawn: async () => false,
			onFooter: (t) => footers.push(t ?? ""),
			onToast: (m, l) => toasts.push([m, l]),
		});
		const info = await loop.probeNow();
		expect(info.state).toBe("up");
		expect(info.buildVerdict?.verdict).toBe("unknown");
		expect(info.engineVersion).toBeUndefined();
		expect(footers).toContain("memory: up"); // pre-M8 engines never break the footer
		expect(toasts).toEqual([]);
		stopEngineStatusLoop();
	});
});

// ---------------------------------------------------------------------------
// M3: the memory bar — pure formatting pins + disk reads + footer precedence.
// The bar is UI copy: every segment is pinned byte-for-byte, including the
// pi-footer chrome characters (▕█░▏) it deliberately shares with the context
// meter (coding-agent footer.ts renderContextMeter).
// ---------------------------------------------------------------------------

describe("formatMemoryBar (UI copy, pinned exactly)", () => {
	test("the canonical line: v17, 4 rules, dreamed 12m ago", () => {
		const now = Date.now();
		expect(formatMemoryBar({ version: 17, rules: 4, dreamedAt: now - 12 * 60_000 }, now)).toBe(
			"mem ▕█░░░▏ v17 · 4 rules · dreamed 12m ago",
		);
	});

	test("no sidecar: version 0, no dreamed segment (the file exists, it was just never dreamed)", () => {
		expect(formatMemoryBar({ version: 0, rules: 2 })).toBe("mem ▕█░░░▏ v0 · 2 rules");
	});

	test("huge counts pin the meter full and keep the honest digits", () => {
		expect(formatMemoryBar({ version: 9, rules: 400, dreamedAt: Date.now() - 90_000_000 })).toBe(
			"mem ▕████▏ v9 · 400 rules · dreamed 1d ago",
		);
		expect(formatMemoryBar({ version: 3, rules: 16 })).toBe("mem ▕████▏ v3 · 16 rules");
	});

	test("fill mapping is min(rules,16)/16 over 4 cells — bounded, deterministic", () => {
		// round(rules/4) per cell: 0 rules → empty, 2 → 1 cell, 4 → 1, 6 → 2, 12 → 3, 16 → 4
		const cells = (rules: number) => formatMemoryBar({ version: 1, rules }).slice(5, 9);
		expect(cells(0)).toBe("░░░░");
		expect(cells(2)).toBe("█░░░");
		expect(cells(4)).toBe("█░░░");
		expect(cells(6)).toBe("██░░");
		expect(cells(12)).toBe("███░");
		expect(cells(16)).toBe("████");
		expect(cells(10_000)).toBe("████"); // bounded — the meter never overflows
	});

	test("singular rule count reads '1 rule'", () => {
		expect(formatMemoryBar({ version: 0, rules: 1 })).toBe("mem ▕░░░░▏ v0 · 1 rule");
	});

	test("fresh and old dreams humanize on the M11 ladder (just now / Xm / Xh / Xd)", () => {
		const now = Date.now();
		expect(formatMemoryBar({ version: 1, rules: 3, dreamedAt: now - 5_000 }, now)).toContain("dreamed just now");
		expect(formatMemoryBar({ version: 1, rules: 3, dreamedAt: now - 59 * 60_000 }, now)).toContain("dreamed 59m ago");
		expect(formatMemoryBar({ version: 1, rules: 3, dreamedAt: now - 60 * 60_000 }, now)).toContain("dreamed 1h ago");
		expect(formatMemoryBar({ version: 1, rules: 3, dreamedAt: now - 26 * 3_600_000 }, now)).toContain(
			"dreamed 1d ago",
		);
		expect(formatMemoryBar({ version: 1, rules: 3, dreamedAt: now + 60_000 }, now)).toContain("dreamed just now"); // clock skew clamps
	});
});

describe("humanizeDreamAge — the bucket ladder (never seconds granularity)", () => {
	test.each([
		[-5_000, "just now"], // negative clamps
		[0, "just now"],
		[59_999, "just now"],
		[60_000, "1m ago"],
		[12 * 60_000, "12m ago"],
		[59 * 60_000 + 59_999, "59m ago"],
		[60 * 60_000, "1h ago"],
		[23 * 3_600_000 + 59 * 60_000, "23h ago"],
		[24 * 3_600_000, "1d ago"],
		[14 * 86_400_000, "14d ago"],
	])("%d ms → %s", (ms, expected) => {
		expect(humanizeDreamAge(ms)).toBe(expected);
	});
});

describe("countProjectRules — the project-memory render grammar", () => {
	test("counts '- ' bullets under '## ' sections only", () => {
		const md = [
			"# Project memory", // title — not a section
			"- not counted (preamble, no section yet)",
			"",
			"## Workflow",
			"- run tests before declaring success",
			"-  keep the diff minimal",
			"",
			"## Known pitfalls",
			"- the build cache lies",
			"",
			"prose between sections",
			"* star bullets are not the render grammar",
		].join("\n");
		expect(countProjectRules(md)).toBe(3);
	});

	test("an empty document counts zero", () => {
		expect(countProjectRules("")).toBe(0);
		expect(countProjectRules("# just a title\n")).toBe(0);
	});
});

describe("readMemoryBarInfo — disk facts (project.md + provenance sidecar)", () => {
	test("no project memory file → null (the old footer text stands)", () => {
		const dir = join(TEST_TMP, `m3-nomem-${Date.now().toString(36)}`);
		mkdirSync(dir, { recursive: true });
		expect(readMemoryBarInfo(dir)).toBeNull();
	});

	test("file + sidecar → version, rules, dreamedAt", () => {
		const dir = join(TEST_TMP, `m3-full-${Date.now().toString(36)}`);
		mkdirSync(join(dir, ".unown", "memory"), { recursive: true });
		writeFileSync(
			join(dir, ".unown", "memory", "project.md"),
			"# Project memory\n\n## Workflow\n- rule one\n- rule two\n",
			"utf8",
		);
		const at = Date.now() - 5 * 60_000;
		writeFileSync(
			join(dir, ".unown", "memory", "project.provenance.json"),
			JSON.stringify({ version: 17, changedBy: "mem0", at, sha256: "0".repeat(64) }),
			"utf8",
		);
		const info = readMemoryBarInfo(dir)!;
		expect(info.version).toBe(17);
		expect(info.rules).toBe(2);
		expect(info.dreamedAt).toBe(at);
	});

	test("file without a sidecar → version 0, no dreamedAt (hand-seeded memory is not a lie)", () => {
		const dir = join(TEST_TMP, `m3-noside-${Date.now().toString(36)}`);
		mkdirSync(join(dir, ".unown", "memory"), { recursive: true });
		writeFileSync(join(dir, ".unown", "memory", "project.md"), "# Project memory\n\n## Facts\n- one\n", "utf8");
		const info = readMemoryBarInfo(dir)!;
		expect(info.version).toBe(0);
		expect(info.dreamedAt).toBeUndefined();
		expect(info.rules).toBe(1);
	});

	test("a corrupt sidecar degrades to version 0 (readProjectProvenance contract)", () => {
		const dir = join(TEST_TMP, `m3-badside-${Date.now().toString(36)}`);
		mkdirSync(join(dir, ".unown", "memory"), { recursive: true });
		writeFileSync(join(dir, ".unown", "memory", "project.md"), "# Project memory\n\n## Facts\n- one\n", "utf8");
		writeFileSync(join(dir, ".unown", "memory", "project.provenance.json"), "{not json", "utf8");
		const info = readMemoryBarInfo(dir)!;
		expect(info.version).toBe(0);
		expect(info.dreamedAt).toBeUndefined();
	});
});

describe("engineFooterText — the M3 bar precedence (pinned exactly)", () => {
	const BAR = "mem ▕█░░▏ v17 · 4 rules · dreamed 12m ago";

	test("the bar rides the clean up line as a trailing segment", () => {
		expect(engineFooterText(makeInfo("up"), BAR)).toBe(`memory: up · ${BAR}`);
	});

	test("the bar rides AFTER the M11 activity suffix (activity is engine news, bar is project state)", () => {
		expect(engineFooterText(makeInfo("up", { activeJob: "auto-dream", busyMs: 4 * 60_000 }), BAR)).toBe(
			`memory: up · auto-dream 4m · ${BAR}`,
		);
	});

	test("the bar never dilutes a standing-condition or warning line", () => {
		const verdict = (v: string) => ({ verdict: v as any, detail: "test" });
		expect(engineFooterText(makeInfo("up", { buildVerdict: verdict("old-build") }), BAR)).toBe(
			"memory: up · old build",
		);
		expect(
			engineFooterText(makeInfo("up", { buildVerdict: verdict("stale"), engineVersion: { version: "2.1.0" } }), BAR),
		).toBe("memory: up · stale (v2.1.0)");
		expect(engineFooterText(makeInfo("down", { queuedNotes: 2 }), BAR)).toBe("memory: down · 2 queued");
		expect(engineFooterText(makeInfo("paused"), BAR)).toBe("memory: paused · /engine");
		expect(engineFooterText(makeInfo("starting"), BAR)).toBe("memory: starting…");
	});

	test("no bar (undefined) keeps every pre-M3 copy byte-identical", () => {
		expect(engineFooterText(makeInfo("up"))).toBe("memory: up");
		expect(engineFooterText(makeInfo("up"), undefined)).toBe("memory: up");
	});
});

describe("engine status loop — the M3 memory bar (projectDir wired)", () => {
	test("a project with dreamed memory shows the bar on the up footer", async () => {
		seedCircuit(freshCircuit());
		const dir = join(TEST_TMP, `m3-loop-${Date.now().toString(36)}`);
		mkdirSync(join(dir, ".unown", "memory"), { recursive: true });
		writeFileSync(
			join(dir, ".unown", "memory", "project.md"),
			"# P\n\n## Workflow\n- one\n- two\n- three\n- four\n",
			"utf8",
		);
		writeFileSync(
			join(dir, ".unown", "memory", "project.provenance.json"),
			JSON.stringify({ version: 17, changedBy: "mem0", at: Date.now() - 12 * 60_000, sha256: "0".repeat(64) }),
			"utf8",
		);
		const footers: string[] = [];
		const loop = startFresh({
			projectDir: dir,
			probe: async () => ({ up: true, pid: 901 }),
			kickSpawn: async () => false,
			onFooter: (t) => footers.push(t ?? ""),
		});
		await loop.probeNow();
		expect(footers).toContain(`memory: up · mem ▕█░░░▏ v17 · 4 rules · dreamed 12m ago`);
		stopEngineStatusLoop();
	});

	test("a project with NO memory file keeps the plain footer (the pre-M3 contract)", async () => {
		seedCircuit(freshCircuit());
		const dir = join(TEST_TMP, `m3-loop-empty-${Date.now().toString(36)}`);
		mkdirSync(dir, { recursive: true });
		const footers: string[] = [];
		const loop = startFresh({
			projectDir: dir,
			probe: async () => ({ up: true, pid: 902 }),
			kickSpawn: async () => false,
			onFooter: (t) => footers.push(t ?? ""),
		});
		await loop.probeNow();
		expect(footers).toContain("memory: up");
		expect(footers.every((f) => !f.includes("mem ▕"))).toBe(true);
		stopEngineStatusLoop();
	});
});

// ---------------------------------------------------------------------------
// M3: dream news — the zero-spam toast decision (pure) + the loop's latch.
// ---------------------------------------------------------------------------

describe("shouldToastDreamNews — the zero-spam rules (pure)", () => {
	const NOW = 1_700_000_000_000;
	const news = (over: Partial<DreamNews> = {}): DreamNews => ({
		id: "project-abc",
		project: "acme",
		added: 3,
		version: 18,
		at: NOW - 5 * 60_000,
		...over,
	});

	test("a fresh unseen dream for this project toasts", () => {
		expect(shouldToastDreamNews(new Map(), news(), "acme", NOW)).toBe(true);
		expect(shouldToastDreamNews(null, news(), "acme", NOW)).toBe(true);
	});

	test("the same dream twice is silent (the once-per-new-dream latch)", () => {
		expect(shouldToastDreamNews(new Map([["acme", "project-abc"]]), news(), "acme", NOW)).toBe(false);
		// a DIFFERENT dream id for the same project is new again
		expect(shouldToastDreamNews(new Map([["acme", "project-old"]]), news({ id: "project-new" }), "acme", NOW)).toBe(
			true,
		);
	});

	test("another project's dream is not ours to announce", () => {
		expect(shouldToastDreamNews(new Map(), news({ project: "other" }), "acme", NOW)).toBe(false);
	});

	test("added=0 is honest no-change, never news", () => {
		expect(shouldToastDreamNews(new Map(), news({ added: 0 }), "acme", NOW)).toBe(false);
	});

	test("stale news (>1h) is silent; exactly 1h is still news (boundary is inclusive)", () => {
		expect(shouldToastDreamNews(new Map(), news({ at: NOW - DREAM_NEWS_MAX_AGE_MS - 1 }), "acme", NOW)).toBe(false);
		expect(shouldToastDreamNews(new Map(), news({ at: NOW - DREAM_NEWS_MAX_AGE_MS }), "acme", NOW)).toBe(true);
	});

	test("no project slug (print mode / CLI surfaces never pass one) → never", () => {
		expect(shouldToastDreamNews(new Map(), news(), undefined, NOW)).toBe(false);
	});

	test("no news at all → never", () => {
		expect(shouldToastDreamNews(new Map(), null, "acme", NOW)).toBe(false);
		expect(shouldToastDreamNews(new Map(), undefined, "acme", NOW)).toBe(false);
	});
});

describe("dreamNewsToastText — the confirmation copy (pinned exactly)", () => {
	test("plural + the honest version pair", () => {
		expect(dreamNewsToastText({ id: "x", project: "acme", added: 3, version: 18, at: 0 })).toBe(
			"✦ AutoDream learned 3 new rules for this project (v17 → v18)",
		);
	});

	test("singular + first mint (v0 → v1 says there was no prior version)", () => {
		expect(dreamNewsToastText({ id: "x", project: "acme", added: 1, version: 1, at: 0 })).toBe(
			"✦ AutoDream learned 1 new rule for this project (v0 → v1)",
		);
	});
});

describe("engine status loop — the M3 dream-news toast (injected probe)", () => {
	// The latch is the loop's in-memory Map (per-session by design — see
	// engine-status.ts), so slugs need no cross-run uniqueness; a fresh
	// loop always starts with an empty latch.
	const SLUG = `m3dream-${Date.now().toString(36)}`;
	const DIR = join(TEST_TMP, SLUG);

	function newsFor(id: string, over: Partial<DreamNews> = {}): DreamNews {
		return { id, project: slugifyPath(DIR), added: 3, version: 18, at: Date.now() - 60_000, ...over };
	}

	test("ONE info toast per new dream — session start included, repeats suppressed, per session", async () => {
		seedCircuit(freshCircuit());
		mkdirSync(DIR, { recursive: true });
		const toasts: Array<[string, string]> = [];
		let news: DreamNews | undefined = newsFor("project-dream-1");
		const loop = startFresh({
			projectDir: DIR,
			probe: async () => ({ up: true, pid: 910, dreamNews: news }),
			kickSpawn: async () => false,
			onToast: (m, l) => toasts.push([m, l]),
		});
		// session start: learning that happened while away IS the event — toast
		await loop.probeNow();
		expect(toasts).toEqual([["✦ AutoDream learned 3 new rules for this project (v17 → v18)", "info"]]);
		// the in-session latch: the next probe (30s later) stays silent
		await loop.probeNow();
		expect(toasts).toHaveLength(1);
		stopEngineStatusLoop();

		// A NEW session (fresh loop = fresh Map) re-announces the same
		// still-fresh learning exactly ONCE — the per-session semantics
		// the in-memory latch buys (engine-status.ts documents the trade:
		// the 1h window bounds it, no home-dir state file needed).
		const loop2 = startFresh({
			projectDir: DIR,
			probe: async () => ({ up: true, pid: 911, dreamNews: news }),
			kickSpawn: async () => false,
			onToast: (m, l) => toasts.push([m, l]),
		});
		await loop2.probeNow();
		expect(toasts).toHaveLength(2); // once per session, not once per boot
		await loop2.probeNow();
		expect(toasts).toHaveLength(2); // ...and once only
		stopEngineStatusLoop();

		// a NEW dream toasts exactly once more
		news = newsFor("project-dream-2", { added: 1, version: 19 });
		const loop3 = startFresh({
			projectDir: DIR,
			probe: async () => ({ up: true, pid: 912, dreamNews: news }),
			kickSpawn: async () => false,
			onToast: (m, l) => toasts.push([m, l]),
		});
		await loop3.probeNow();
		expect(toasts).toHaveLength(3);
		expect(toasts[2]).toEqual(["✦ AutoDream learned 1 new rule for this project (v18 → v19)", "info"]);
		stopEngineStatusLoop();
	});

	test("another project's news never toasts here", async () => {
		seedCircuit(freshCircuit());
		const toasts: Array<[string, string]> = [];
		const loop = startFresh({
			projectDir: DIR,
			probe: async () => ({ up: true, pid: 913, dreamNews: newsFor("project-x", { project: "someone-else" }) }),
			kickSpawn: async () => false,
			onToast: (m, l) => toasts.push([m, l]),
		});
		await loop.probeNow();
		expect(toasts).toEqual([]);
		stopEngineStatusLoop();
	});

	test("a down probe carries no news lane (news rides healthy probes only)", async () => {
		seedCircuit(freshCircuit());
		const toasts: Array<[string, string]> = [];
		const loop = startFresh({
			projectDir: DIR,
			probe: async () => ({ up: false, dreamNews: newsFor("project-down") }),
			kickSpawn: async () => false,
			onToast: (m, l) => toasts.push([m, l]),
		});
		await loop.probeNow();
		expect(toasts).toEqual([]);
		stopEngineStatusLoop();
	});
});
