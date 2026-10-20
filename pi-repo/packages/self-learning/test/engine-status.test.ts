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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
        describeSpawnCircuit,
        engineAssumedDown,
        engineFooterText,
        engineToastText,
        getEngineStatusInfo,
        startEngineStatusLoop,
        stopEngineStatusLoop,
        type EngineState,
        type EngineStatusHooks,
        type EngineStatusInfo,
} from "../src/engine-status.ts";
import { enginePidFile, readSpawnState, resetSpawnCircuit, spawnStateFile, type SpawnState } from "../src/engine-supervisor.ts";
import { outboxStats, writeOutboxNote, UNOWN_OUTBOX_DIR } from "../src/term.ts";

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
        return { state, since: Date.now(), lastProbeAt: Date.now(), queuedNotes: 0, droppedNotes: 0, spawn: freshCircuit(), ...overrides };
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
                for (const f of readdirSync(UNOWN_OUTBOX_DIR)) if (f.includes(MARKER)) rmSync(join(UNOWN_OUTBOX_DIR, f), { force: true });
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
                expect(footers).toContain("memory: up");
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
                expect(toasts[1]).toEqual([`memory engine online — learning resumed — draining ${outboxStats().queued} queued note(s)`, "info"]);
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
                expect(snap.spawn).toEqual({ attempts: 2, windowStart: 111, lastAttemptAt: 222, lastHealthyAt: 0, gaveUp: false });
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

function runEngineStatusProbe(overrides: { autostart?: string }, body: string): { code: number; stdout: string; stderr: string } {
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
                        const r = runEngineStatusProbe({}, `
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
`);
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
                        const r = runEngineStatusProbe({ autostart: "0" }, `
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
`);
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
