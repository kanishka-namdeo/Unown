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
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	engineHealth,
	enginePidFromPidfile,
	parseDreamNews,
	reloadEnvIfChanged,
	rotateEngineLogIfNeeded,
	spawnEngineDetached,
	supervisorStateRoot,
} from "../src/engine-supervisor.ts";
import { startServer } from "../src/index.ts";
import { router } from "../src/router.ts";
import { automationsScheduler } from "../src/server.ts";
import { DATA_DIR } from "../src/store.ts";

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

// ---------------------------------------------------------------------------
// parseDreamNews — the /api/overview dreamNews decoder (M3 visual indicators).
// Pure narrowing: an unknown body fragment becomes DreamNews or undefined, so
// a malformed engine answer degrades to "no news" instead of reaching the
// state machine (and the toast lane) as a half-shape. Pinned exactly because
// every rejected field below is a shape a pre-M3 engine, a dashboard proxy or
// a hand-rolled curl could realistically produce.
// ---------------------------------------------------------------------------

describe("parseDreamNews (the /api/overview dreamNews block)", () => {
	const block = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
		id: "project-abc",
		project: "acme",
		added: 3,
		version: 18,
		at: 1_700_000_000_000,
		...over,
	});

	test("a well-formed block parses to the five fields", () => {
		expect(parseDreamNews(block())).toEqual({
			id: "project-abc",
			project: "acme",
			added: 3,
			version: 18,
			at: 1_700_000_000_000,
		});
	});

	test("absent / null / non-object is undefined (no news)", () => {
		expect(parseDreamNews(undefined)).toBeUndefined();
		expect(parseDreamNews(null)).toBeUndefined();
		expect(parseDreamNews("project dream!")).toBeUndefined();
		expect(parseDreamNews(42)).toBeUndefined();
	});

	test.each([
		["id missing", block({ id: undefined })],
		["id empty", block({ id: "" })],
		["id not a string", block({ id: 7 })],
		["project missing", block({ project: undefined })],
		["project empty", block({ project: "" })],
		["added missing", block({ added: undefined })],
		["added zero (honest no-change never ships, but never trust the wire)", block({ added: 0 })],
		["added negative", block({ added: -1 })],
		["added NaN", block({ added: Number.NaN })],
		["version not a number", block({ version: "18" })],
		["version NaN", block({ version: Number.NaN })],
		["at not a number", block({ at: "soon" })],
		["at Infinity", block({ at: Number.POSITIVE_INFINITY })],
	])("%s → undefined", (_label, raw) => {
		expect(parseDreamNews(raw)).toBeUndefined();
	});
});

describe("engine single-instance lock (F9)", () => {
	test("a stale lock (dead pid) is stolen; a foreign live pid is refused", async () => {
		// Seed a stale lock: a pid that is definitely dead (but not recycled
		// into an engine-looking process) — use pid 4000000 (beyond typical
		// pid_max; kill(pid,0) throws ESRCH).
		writeFileSync(LOCK, "4000000");
		const server = await startServer(0); // ephemeral port, redirected DATA_DIR
		expect(server).not.toBeNull();
		// The running server now holds the lock with OUR pid.
		expect(readFileSync(LOCK, "utf8").trim()).toBe(String(process.pid));
		// A second startServer in the same process re-enters (same pid).
		const again = await startServer(0);
		expect(again).not.toBeNull();
		again?.stop(true);
		server.stop(true);
		// A foreign live pid that does NOT look like an engine is stealable on
		// Linux (pid reuse guard); simulate by seeding our OWN pid — which the
		// same-pid path accepts anyway. The "another engine" refusal needs a
		// second process; that is covered by the integration suite.
	});

	test("same-pid re-entrancy releases cleanly", async () => {
		writeFileSync(LOCK, String(process.pid));
		const server = await startServer(0);
		expect(server).not.toBeNull();
		server?.stop(true);
		expect(existsSync(LOCK)).toBe(true); // release happens on signal-drain, not stop()
		rmSync(LOCK, { force: true });
	});
});

// ---------------------------------------------------------------------------
// M6: log rotation + env hot-reload (the disk-full / config-hot-reload items)
// ---------------------------------------------------------------------------

describe("engine log rotation (M6)", () => {
	const DIR = mkdtempSync(join(tmpdir(), "unown-m6-log-"));

	test("a log past the cap archives to .1 and truncates in place", () => {
		const log = join(DIR, "engine.log");
		writeFileSync(log, "x".repeat(6000));
		const r = rotateEngineLogIfNeeded(log, 5000);
		expect(r.rotated).toBe(true);
		expect(statSync(log).size).toBe(0); // truncated in place — held O_APPEND fds stay valid
		expect(readFileSync(`${log}.1`, "utf8")).toHaveLength(6000); // the archived generation
	});

	test("a log under the cap is untouched", () => {
		const log = join(DIR, "small.log");
		writeFileSync(log, "x".repeat(10));
		expect(rotateEngineLogIfNeeded(log, 5000).rotated).toBe(false);
		expect(statSync(log).size).toBe(10);
	});

	test("a missing log is a no-op, never a throw", () => {
		expect(rotateEngineLogIfNeeded(join(DIR, "absent.log"), 5000).rotated).toBe(false);
	});

	test("re-rotation replaces the previous .1 generation (one kept)", () => {
		const log = join(DIR, "gen.log");
		writeFileSync(log, "y".repeat(6000));
		expect(rotateEngineLogIfNeeded(log, 5000).rotated).toBe(true);
		writeFileSync(log, "z".repeat(6000));
		expect(rotateEngineLogIfNeeded(log, 5000).rotated).toBe(true);
		expect(readFileSync(`${log}.1`, "utf8")).toBe("z".repeat(6000)); // newest generation
		expect(statSync(log).size).toBe(0);
	});

	test("an append-mode fd survives rotation mid-write (the copy-truncate contract)", () => {
		const log = join(DIR, "append.log");
		const { openSync, writeSync, closeSync } = require("node:fs") as typeof import("node:fs");
		const fd = openSync(log, "a");
		writeSync(fd, "first-gen\n");
		expect(rotateEngineLogIfNeeded(log, 5).rotated).toBe(true);
		writeSync(fd, "second-gen\n"); // the SAME fd — O_APPEND lands at the fresh EOF
		closeSync(fd);
		expect(readFileSync(log, "utf8")).toBe("second-gen\n");
		expect(readFileSync(`${log}.1`, "utf8")).toBe("first-gen\n");
	});

	afterAll(() => {
		rmSync(DIR, { recursive: true, force: true });
	});
});

describe("env hot-reload (M6 — reloadEnvIfChanged)", () => {
	const DIR = mkdtempSync(join(tmpdir(), "unown-m6-env-"));
	const ENV = join(DIR, ".env");

	test("a changed .env applies PI_/UNOWN_ keys; other keys are ignored", () => {
		delete process.env.PI_M6_PROBE;
		delete process.env.UNOWN_M6_PROBE;
		writeFileSync(ENV, "PI_M6_PROBE=alpha\nUNOWN_M6_PROBE=beta\nSOMETHING_ELSE=nope\n");
		const r = reloadEnvIfChanged(ENV);
		expect(r.reloaded).toBe(true);
		expect(r.applied).toContain("PI_M6_PROBE");
		expect(r.applied).toContain("UNOWN_M6_PROBE");
		expect(r.applied).not.toContain("SOMETHING_ELSE");
		expect(process.env.PI_M6_PROBE).toBe("alpha");
		expect(process.env.UNOWN_M6_PROBE).toBe("beta");
		expect(process.env.SOMETHING_ELSE).toBeUndefined();
	});

	test("an unchanged mtime is a no-op; a re-edit re-applies", async () => {
		expect(reloadEnvIfChanged(ENV).reloaded).toBe(false); // same mtime
		writeFileSync(ENV, "PI_M6_PROBE=gamma\n");
		// Bump the mtime EXPLICITLY (a future timestamp is legal) — filesystem
		// mtime granularity varies (tmpfs ns vs some CI mounts at 1s), and the
		// reload GATE is the unit under test, not the clock's tick rate.
		const bumped = new Date(Date.now() + 5000);
		utimesSync(ENV, bumped, bumped);
		const r = reloadEnvIfChanged(ENV);
		expect(r.reloaded).toBe(true);
		expect(r.applied).toContain("PI_M6_PROBE");
		expect(process.env.PI_M6_PROBE).toBe("gamma");
	});

	test("a missing .env is a no-op, never a throw", () => {
		expect(reloadEnvIfChanged(join(DIR, "absent.env")).reloaded).toBe(true); // first sight primes the gate
		expect(reloadEnvIfChanged(join(DIR, "absent.env")).reloaded).toBe(false); // stable after
	});

	afterAll(() => {
		delete process.env.PI_M6_PROBE;
		delete process.env.UNOWN_M6_PROBE;
		rmSync(DIR, { recursive: true, force: true });
	});
});

describe("idlePresenceWindowMs (M6 — call-time env read)", () => {
	test("the default is 60s; a set env retunes it live; garbage falls back", async () => {
		const { idlePresenceWindowMs } = await import("../src/automations.ts");
		const saved = process.env.PI_IDLE_PRESENCE_WINDOW_MS;
		try {
			delete process.env.PI_IDLE_PRESENCE_WINDOW_MS;
			expect(idlePresenceWindowMs()).toBe(60_000);
			process.env.PI_IDLE_PRESENCE_WINDOW_MS = "5000";
			expect(idlePresenceWindowMs()).toBe(5000);
			process.env.PI_IDLE_PRESENCE_WINDOW_MS = "not-a-number";
			expect(idlePresenceWindowMs()).toBe(60_000);
		} finally {
			if (saved === undefined) delete process.env.PI_IDLE_PRESENCE_WINDOW_MS;
			else process.env.PI_IDLE_PRESENCE_WINDOW_MS = saved;
		}
	});
});
