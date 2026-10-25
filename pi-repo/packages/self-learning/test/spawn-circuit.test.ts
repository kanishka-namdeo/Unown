/**
 * Unit tests for the M6 crash-loop circuit — src/engine-supervisor.ts's
 * cross-process spawn-state machine (SpawnState / spawnBackoffMs /
 * evaluateSpawnGate / recordSpawnAttempt / readSpawnState / autoStartDisabled
 * / the force-vs-gated spawnEngineDetached semantics).
 *
 * Design refs (docs/resilience.md): systemd StartLimitBurst/StartLimitIntervalSec,
 * supervisord startretries→FATAL, k8s CrashLoopBackOff — backoff between
 * attempts, hard stop after SPAWN_MAX_ATTEMPTS, any observed-healthy probe
 * resets, manual start (`force`) bypasses + resets.
 *
 * The pure gates are tested with an injected clock. The FILE-backed tests run
 * against the suite's UNOWN_RUNTIME_DIR temp dir (./_env.ts) — never the live
 * checkout's .run, which a running Windows engine can hold exclusively — and
 * every write is snapshotted + restored byte-for-byte in afterAll. The
 * force-spawn path runs in a fresh bun subprocess (the suite's
 * PI_DISABLE_ENGINE_SPAWN=1 guard is a module-load const, so the force branch
 * is unreachable in-process); the spawned "engine" is this suite's own probe
 * script, whose argv guard makes it a no-op child.
 */
import "./_env.ts"; // MUST be the first import
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describeSpawnCircuit } from "../src/engine-status.ts";
import {
        autoStartDisabled,
        enginePidFile,
        evaluateSpawnGate,
        markEngineHealthy,
        readSpawnState,
        recordSpawnAttempt,
        recordSpawnBlocked,
        resetSpawnCircuit,
        spawnBackoffMs,
        spawnEngineDetached,
        spawnStateFile,
        SPAWN_MAX_ATTEMPTS,
} from "../src/engine-supervisor.ts";

const PKG_ROOT = join(import.meta.dir, "..");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function freshCircuit(now = Date.now()) {
        return { attempts: 0, windowStart: now, lastAttemptAt: 0, lastHealthyAt: 0, gaveUp: false };
}

function tryRead(path: string): string | null {
        try {
                return readFileSync(path, "utf8");
        } catch {
                return null;
        }
}

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

function seedCircuit(state: ReturnType<typeof freshCircuit>) {
        mkdirSync(dirname(spawnStateFile()), { recursive: true });
        writeFileSync(spawnStateFile(), JSON.stringify(state), "utf8");
}

let savedSpawnState: string | null = null;
let savedPidFile: string | null = null;

beforeAll(() => {
        savedSpawnState = tryRead(spawnStateFile());
        savedPidFile = tryRead(enginePidFile());
});

afterAll(() => {
        // restore the live stack's .run files byte-for-byte
        tryWrite(spawnStateFile(), savedSpawnState);
        tryWrite(enginePidFile(), savedPidFile);
});

// ---------------------------------------------------------------------------
// spawnBackoffMs — exponential, capped (pure)
// ---------------------------------------------------------------------------

describe("spawnBackoffMs", () => {
        test.each([
                [0, 0], // no failures → no wait
                [-1, 0], // defensive: negatives never wait
                [1, 2_000],
                [2, 4_000],
                [3, 8_000],
                [4, 16_000],
                [5, 32_000],
                [6, 60_000], // cap reached (64s clamped)
                [10, 60_000], // cap holds
                [100, 60_000],
        ])("spawnBackoffMs(%d) = %d", (attempts, expected) => {
                expect(spawnBackoffMs(attempts)).toBe(expected);
        });

        test("SPAWN_MAX_ATTEMPTS is 5 (supervisord startretries parity)", () => {
                expect(SPAWN_MAX_ATTEMPTS).toBe(5);
        });
});

// ---------------------------------------------------------------------------
// evaluateSpawnGate — should an AUTO-spawn fire right now (pure, injected now)
// ---------------------------------------------------------------------------

describe("evaluateSpawnGate", () => {
        const NOW = 1_700_000_000_000;

        test("fresh circuit → allowed, reason ok", () => {
                expect(evaluateSpawnGate(freshCircuit(NOW), NOW)).toEqual({ allowed: true, reason: "ok" });
        });

        test("gave-up circuit stays closed until a healthy probe or manual start resets it", () => {
                expect(evaluateSpawnGate({ ...freshCircuit(NOW), attempts: 5, lastAttemptAt: NOW, gaveUp: true }, NOW)).toEqual({
                        allowed: false,
                        reason: "gave-up",
                        attempts: 5,
                });
        });

        test("within backoff → not yet, with the exact retry countdown", () => {
                const state = { ...freshCircuit(NOW), attempts: 1, lastAttemptAt: NOW - 1_000 };
                expect(evaluateSpawnGate(state, NOW)).toEqual({ allowed: false, reason: "backoff", retryInMs: 1_000, attempts: 1 });
        });

        test("backoff served → allowed again (same window, count kept)", () => {
                const state = { ...freshCircuit(NOW), attempts: 1, lastAttemptAt: NOW - 2_000 };
                expect(evaluateSpawnGate(state, NOW)).toEqual({ allowed: true, reason: "ok" });
        });

        test("a quiet window (10 min) reopens auto-start — the returning-user reset", () => {
                const state = { ...freshCircuit(NOW), attempts: 5, lastAttemptAt: NOW - 11 * 60_000 };
                expect(evaluateSpawnGate(state, NOW)).toEqual({ allowed: true, reason: "stale-window" });
        });

        test("attempts without a launch timestamp never gate (lastAttemptAt 0)", () => {
                const state = { ...freshCircuit(NOW), attempts: 3, lastAttemptAt: 0 };
                expect(evaluateSpawnGate(state, NOW)).toEqual({ allowed: true, reason: "ok" });
        });
});

// ---------------------------------------------------------------------------
// recordSpawnAttempt — recording a LAUNCH (pure, injected now)
// ---------------------------------------------------------------------------

describe("recordSpawnAttempt", () => {
        const NOW = 1_700_000_000_000;

        test("increments consecutive attempts, anchors the backoff clock", () => {
                const state = { ...freshCircuit(NOW), attempts: 2, lastAttemptAt: NOW - 1_000 };
                const next = recordSpawnAttempt(state, NOW);
                expect(next.attempts).toBe(3);
                expect(next.lastAttemptAt).toBe(NOW);
                expect(next.gaveUp).toBe(false);
                expect(next.lastHealthyAt).toBe(state.lastHealthyAt); // preserved
        });

        test("pure: the input state is never mutated", () => {
                const state = { ...freshCircuit(NOW), attempts: 2, lastAttemptAt: NOW - 1_000 };
                recordSpawnAttempt(state, NOW);
                expect(state.attempts).toBe(2);
                expect(state.lastAttemptAt).toBe(NOW - 1_000);
                expect(state.gaveUp).toBe(false);
        });

        test("a quiet window restarts the count at 1 (systemd StartLimitIntervalSec)", () => {
                const state = { ...freshCircuit(NOW - 11 * 60_000), attempts: 4, lastAttemptAt: NOW - 11 * 60_000 };
                const next = recordSpawnAttempt(state, NOW);
                expect(next.attempts).toBe(1);
                expect(next.windowStart).toBe(NOW);
                expect(next.gaveUp).toBe(false);
        });

        test("an engine observed healthy since the last attempt restarts the count", () => {
                const state = { ...freshCircuit(NOW), attempts: 4, lastAttemptAt: NOW - 1_000, lastHealthyAt: NOW - 500 };
                expect(recordSpawnAttempt(state, NOW).attempts).toBe(1);
        });

        test("the 5th consecutive attempt trips gave-up (supervisord FATAL)", () => {
                const state = { ...freshCircuit(NOW), attempts: 4, lastAttemptAt: NOW - 1_000 };
                const next = recordSpawnAttempt(state, NOW);
                expect(next.attempts).toBe(5);
                expect(next.gaveUp).toBe(true);
        });
});

// ---------------------------------------------------------------------------
// recordSpawnBlocked — a refusal caused by a foreign/occupied/incompatible
// engine, NOT a failed child launch (P0 taxonomy)
// ---------------------------------------------------------------------------

describe("recordSpawnBlocked", () => {
        const NOW = 1_700_000_000_000;

        test("stores the cause without counting an attempt or arming backoff", () => {
                const state = freshCircuit(NOW);
                const next = recordSpawnBlocked(state, "unauthorized", NOW);
                expect(next.attempts).toBe(0);
                expect(next.gaveUp).toBe(false);
                expect(next.lastCause).toBe("unauthorized");
                expect(next.lastProbeAt).toBe(NOW);
                expect(evaluateSpawnGate(next, NOW).allowed).toBe(true); // no attempt → no backoff
        });

        test("the circuit summary explains the owner problem and never invites a spawn", () => {
                const text = describeSpawnCircuit(recordSpawnBlocked(freshCircuit(NOW), "occupied", NOW));
                expect(text).toContain("auto-start blocked");
                expect(text).toContain("port");
                expect(text).toContain("no spawn attempted");
                expect(text).not.toContain("unown engine start (resets");
        });

        test("readSpawnState round-trips the optional cause fields", () => {
                const saved = tryRead(spawnStateFile());
                try {
                        seedCircuit({ ...freshCircuit(NOW), lastCause: "unauthorized", lastProbeAt: NOW } as any);
                        const state = readSpawnState();
                        expect(state.lastCause).toBe("unauthorized");
                        expect(state.lastProbeAt).toBe(NOW);
                } finally {
                        tryWrite(spawnStateFile(), saved);
                }
        });
});

// ---------------------------------------------------------------------------
// autoStartDisabled — the user-facing kill switch (injectable env)
// ---------------------------------------------------------------------------

describe("autoStartDisabled (UNOWN_ENGINE_AUTOSTART)", () => {
        test.each([
                ["0", true],
                ["false", true],
                ["OFF", true], // case-insensitive
                ["no", true],
                ["No", true],
                ["", false], // empty value = unset (the .env.example convention)
                ["1", false],
                ["yes", false],
                ["true", false],
                ["on", false],
                [undefined, false],
        ])("%j → %s", (value, expected) => {
                const env: NodeJS.ProcessEnv = {};
                if (value !== undefined) env.UNOWN_ENGINE_AUTOSTART = value as string;
                expect(autoStartDisabled(env)).toBe(expected);
        });

        test("QUIRK: values are matched strictly — surrounding whitespace is not trimmed", () => {
                expect(autoStartDisabled({ UNOWN_ENGINE_AUTOSTART: "0 " })).toBe(false);
                expect(autoStartDisabled({ UNOWN_ENGINE_AUTOSTART: " off" })).toBe(false);
        });
});

// ---------------------------------------------------------------------------
// readSpawnState — the fail-open file circuit
// ---------------------------------------------------------------------------

describe("readSpawnState (file-backed, fail-open)", () => {
        test("missing file → fresh circuit", () => {
                rmSync(spawnStateFile(), { force: true });
                const s = readSpawnState();
                expect(s.attempts).toBe(0);
                expect(s.lastAttemptAt).toBe(0);
                expect(s.lastHealthyAt).toBe(0);
                expect(s.gaveUp).toBe(false);
        });

        test("corrupt JSON → fresh circuit (a damaged counter must not brick auto-start)", () => {
                seedCircuit({ garbage: true } as any); // writes "{...}" fine, but:
                writeFileSync(spawnStateFile(), "{not json at all", "utf8");
                expect(readSpawnState().attempts).toBe(0);
                expect(readSpawnState().gaveUp).toBe(false);
        });

        test("non-object JSON → fresh circuit", () => {
                writeFileSync(spawnStateFile(), "42", "utf8");
                expect(readSpawnState().attempts).toBe(0);
                writeFileSync(spawnStateFile(), "[1,2,3]", "utf8");
                expect(readSpawnState().attempts).toBe(0);
        });

        test("field coercion: numeric strings parse; gaveUp is only the literal true", () => {
                writeFileSync(
                        spawnStateFile(),
                        JSON.stringify({ attempts: "2", windowStart: 123, lastAttemptAt: "456", lastHealthyAt: "789", gaveUp: "yes" }),
                        "utf8",
                );
                expect(readSpawnState()).toEqual({ attempts: 2, windowStart: 123, lastAttemptAt: 456, lastHealthyAt: 789, gaveUp: false });
                writeFileSync(spawnStateFile(), JSON.stringify({ attempts: 5, windowStart: 1, lastAttemptAt: 2, lastHealthyAt: 3, gaveUp: true }), "utf8");
                expect(readSpawnState().gaveUp).toBe(true);
        });

        test("round-trips through the public writers (resetSpawnCircuit / markEngineHealthy)", () => {
                resetSpawnCircuit();
                let s = readSpawnState();
                expect(s.attempts).toBe(0);
                expect(s.lastHealthyAt).toBe(0);
                expect(s.gaveUp).toBe(false);

                markEngineHealthy();
                s = readSpawnState();
                expect(s.attempts).toBe(0); // observed healthy → the circuit forgets its failures
                expect(s.gaveUp).toBe(false);
                expect(s.lastHealthyAt).toBeGreaterThan(0);
                // and the file itself is the durable cross-process record:
                const raw = JSON.parse(readFileSync(spawnStateFile(), "utf8"));
                expect(raw.lastHealthyAt).toBe(s.lastHealthyAt);
                expect(raw.attempts).toBe(0);
        });
});

// ---------------------------------------------------------------------------
// spawnEngineDetached — gates
// ---------------------------------------------------------------------------

describe("spawnEngineDetached gates", () => {
        test("under the suite's test guard (PI_DISABLE_ENGINE_SPAWN=1) even force:true never spawns or writes", async () => {
                resetSpawnCircuit(); // a known on-disk baseline makes any accidental write observable
                const before = tryRead(spawnStateFile());
                try {
                        expect(await spawnEngineDetached()).toBe(false);
                        expect(await spawnEngineDetached({ force: true })).toBe(false); // the guard wins over manual
                        expect(tryRead(spawnStateFile())).toBe(before); // untouched — returned before any circuit write
                } finally {
                        // afterAll restores the pre-suite state; nothing to do here
                }
        });

        test("UNOWN_ENGINE_AUTOSTART=0 disables auto-start but not force (pure env check)", async () => {
                const saved = process.env.UNOWN_ENGINE_AUTOSTART;
                process.env.UNOWN_ENGINE_AUTOSTART = "0";
                try {
                        // SPAWN_DISABLED=1 in-process returns before the kill switch is even
                        // consulted — the observable here is autoStartDisabled() itself:
                        expect(autoStartDisabled()).toBe(true);
                        expect(await spawnEngineDetached()).toBe(false);
                } finally {
                        if (saved === undefined) delete process.env.UNOWN_ENGINE_AUTOSTART;
                        else process.env.UNOWN_ENGINE_AUTOSTART = saved;
                }
        });

        test("fresh process, guard absent: a gave-up circuit refuses the AUTO spawn; force resets + records", () => {
                // The spawned "engine" is this probe script itself: its argv guard makes
                // `bun <probe.ts> engine serve` a child that exits 0 immediately — the
                // spawn path is genuinely exercised (child launched, pidfile written)
                // without ever running a real engine.
                const root = mkdtempSync(join(tmpdir(), "unown-spawn-force-"));
                const script = `
if (process.argv[2] === "engine" && process.argv[3] === "serve") process.exit(0); // harmless spawn target
const sup = await import(${JSON.stringify(join(PKG_ROOT, "src/engine-supervisor.ts"))});
const fs = await import("node:fs");
const path = await import("node:path");
const savedState = ${JSON.stringify(tryRead(spawnStateFile()))};
const savedPid = ${JSON.stringify(tryRead(enginePidFile()))};
try {
        fs.mkdirSync(path.dirname(sup.spawnStateFile()), { recursive: true });
        // a circuit that already burned its 5 attempts
        fs.writeFileSync(sup.spawnStateFile(), JSON.stringify({ attempts: 5, windowStart: Date.now(), lastAttemptAt: Date.now(), lastHealthyAt: 0, gaveUp: true }));
        const gated = await sup.spawnEngineDetached(); // AUTO path: gave-up → refused, file untouched
        const afterGated = sup.readSpawnState();
        const forced = await sup.spawnEngineDetached({ force: true }); // manual: bypasses + resets, then records like any attempt
        const afterForced = sup.readSpawnState();
        console.log("FORCE_RESULT=" + JSON.stringify({
                gated, afterGated, forced, afterForced,
        }));
} finally {
        // restore the live stack's .run files (the spawn wrote a short-lived child pid)
        if (savedState === null) fs.rmSync(sup.spawnStateFile(), { force: true });
        else fs.writeFileSync(sup.spawnStateFile(), savedState);
        if (savedPid === null) fs.rmSync(sup.enginePidFile(), { force: true });
        else fs.writeFileSync(sup.enginePidFile(), savedPid);
}
process.exit(0);
`;
                const probePath = join(root, "probe.ts");
                writeFileSync(probePath, script);
                const env: NodeJS.ProcessEnv = {
                        ...process.env,
                        UNOWN_HOME: join(root, "unown-home"),
                        UNOWN_ENGINE_URL: "http://127.0.0.1:9",
                        NO_UPDATE_NOTIFIER: "1",
                };
                delete env.PI_DISABLE_ENGINE_SPAWN; // the branch under test sits behind the guard
                delete env.UNOWN_ENGINE_AUTOSTART;
                const res = spawnSync(process.execPath, [probePath], { env, encoding: "utf8", timeout: 60_000 });
                rmSync(root, { recursive: true, force: true });
                expect(res.status).toBe(0);
                const m = (res.stdout ?? "").match(/FORCE_RESULT=(\{.*\})/s);
                expect(m).not.toBeNull();
                const out = JSON.parse(m![1]);
                // AUTO path: the gave-up circuit refuses, and refuses WITHOUT recording
                expect(out.gated).toBe(false);
                expect(out.afterGated.attempts).toBe(5);
                expect(out.afterGated.gaveUp).toBe(true);
                // FORCE path: clean slate (markEngineHealthy), then the attempt is recorded
                expect(out.forced).toBe(true); // the child (this script's no-op branch) launched
                expect(out.afterForced.attempts).toBe(1);
                expect(out.afterForced.gaveUp).toBe(false);
                expect(out.afterForced.lastAttemptAt).toBeGreaterThan(0);
                expect(out.afterForced.lastHealthyAt).toBeGreaterThan(0);
        }, 15_000);
});
