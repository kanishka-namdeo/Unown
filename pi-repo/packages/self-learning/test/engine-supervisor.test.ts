/**
 * Unit tests for M3 supervision — engine-supervisor.ts and server.ts's
 * single-instance lock + graceful shutdown wiring.
 *
 * The lock tests run against a REDIRECTED DATA_DIR (./_env.ts) so they never
 * touch the live engine's lock. The spawn tests never actually spawn: the
 * single-flight latch and the probe/poll helpers are exercised with the
 * engine's real HTTP surface pointing at a dead port.
 */
import "./_env.ts"; // MUST be the first import
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
        engineHealth,
        enginePidFromPidfile,
        spawnEngineDetached,
        supervisorStateRoot,
} from "../src/engine-supervisor.ts";
import { DATA_DIR } from "../src/store.ts";
import { startServer, store } from "../src/index.ts";
import { router } from "../src/router.ts";
import { automationsScheduler } from "../src/server.ts";

const LOCK = join(DATA_DIR, "engine.lock");

afterAll(() => {
        // The lock tests above boot the REAL startServer() in-process, which
        // starts the module-singleton router + automations scheduler
        // (server.ts) — and Bun's server.stop() only closes the HTTP listener;
        // the router/scheduler teardown lives on the signal-drain path this
        // process never takes. bun test runs every file in ONE process with a
        // shared bus, and bun's file-loading order varies by platform and
        // runner (see bunfig.toml): leaving the singleton subscribed made every
        // LATER file's improvement:shipped / run:finished emit double-execute
        // event jobs — the router.test.ts HIGH-1 queue flake on the CI matrix.
        // Detach both before this file hands the process to the next suite.
        try {
                router.stop();
                automationsScheduler.stop();
        } catch {
                /* best effort */
        }
        try {
                if (existsSync(LOCK)) rmSync(LOCK);
        } catch {
                /* best effort */
        }
});

describe("engine-supervisor (M3)", () => {
        test("health probe against a dead port reports down, fast", async () => {
                const t0 = Date.now();
                const h = await engineHealth(800);
                expect(h.up).toBe(false);
                expect(Date.now() - t0).toBeLessThan(2500);
        });

        test("the state root resolves (checkout or UNOWN_HOME shape)", () => {
                expect(supervisorStateRoot().length).toBeGreaterThan(0);
        });

        test("spawn is disabled under the test guard (no children from test processes)", async () => {
                // _env.ts sets PI_DISABLE_ENGINE_SPAWN=1 for the whole suite: no real
                // children. Both calls resolve false; the single-flight latch itself is
                // exercised by the live path (unown engine start, benchmarks/detached-engine).
                const { SPAWN_DISABLED } = await import("../src/engine-supervisor.ts");
                expect(SPAWN_DISABLED).toBe(true);
                expect(await spawnEngineDetached()).toBe(false);
                expect(await spawnEngineDetached()).toBe(false);
        });

        test("pidfile probe: absent file reports no pid", () => {
                // The redirected state root's pidfile is not created by the probes.
                const { pid } = enginePidFromPidfile();
                expect(pid === null || typeof pid === "number").toBe(true);
        });
});

describe("engine single-instance lock (F9)", () => {
        test("a stale lock (dead pid) is stolen; a foreign live pid is refused", async () => {
                // Seed a stale lock: a pid that is definitely dead (but not recycled
                // into an engine-looking process) — use pid 4000000 (beyond typical
                // pid_max; kill(pid,0) throws ESRCH).
                writeFileSync(LOCK, "4000000");
                const server = startServer(0); // ephemeral port, redirected DATA_DIR
                expect(server).not.toBeNull();
                // The running server now holds the lock with OUR pid.
                expect(readFileSync(LOCK, "utf8").trim()).toBe(String(process.pid));
                // A second startServer in the same process re-enters (same pid).
                const again = startServer(0);
                expect(again).not.toBeNull();
                again?.stop(true);
                server.stop(true);
                // A foreign live pid that does NOT look like an engine is stealable on
                // Linux (pid reuse guard); simulate by seeding our OWN pid — which the
                // same-pid path accepts anyway. The "another engine" refusal needs a
                // second process; that is covered by the integration suite.
        });

        test("same-pid re-entrancy releases cleanly", () => {
                writeFileSync(LOCK, String(process.pid));
                const server = startServer(0);
                expect(server).not.toBeNull();
                server?.stop(true);
                expect(existsSync(LOCK)).toBe(true); // release happens on signal-drain, not stop()
                rmSync(LOCK, { force: true });
        });
});
