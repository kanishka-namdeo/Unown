/**
 * engine-cli.ts — `unown engine status|start|stop|repair|serve` (M3 + M6).
 *
 * The supervision surface for the detached self-learning engine
 * (docs/detached-engine-architecture.md, design rules 1 + 5):
 *
 *   status  ping + report (pid, uptime, jobs, governor budget/breaker, outbox,
 *           crash-loop circuit) — the DEGRADED-MODE diagnosis command
 *   start   ping-or-spawn: detached `engine serve` child + jittered health poll;
 *           FORCE — bypasses and resets the M6 crash-loop circuit (manual wins)
 *   stop    graceful: HTTP /api/shutdown (drains requests, stops the router,
 *           checkpoints the WAL, releases the lock) with hard-kill fallback
 *   repair  quarantine a corrupt SQLite DB (backup-aside + fresh boot);
 *           memory files on disk and the note outbox survive by design
 *   serve   run the engine in the FOREGROUND of this process — the entry a
 *           supervisor (systemd user unit, launchd agent, Windows service,
 *           dev shell) should own. The engine import is DYNAMIC: a normal
 *           terminal session never loads the engine half of the package
 *           (the M2 detachment contract).
 */
import { existsSync, renameSync, statSync } from "node:fs";
import { Database } from "bun:sqlite";
import { ENGINE_URL, outboxStats } from "./term.ts";
import { DB_PATH } from "./store.ts";
import {
        engineHealth,
        enginePidFile,
        enginePidFromPidfile,
        ensureEngineRunning,
        spawnEngineDetached,
        readSpawnState,
        resetSpawnCircuit,
} from "./engine-supervisor.ts";
import { describeSpawnCircuit } from "./engine-status.ts";

export const ENGINE_USAGE = `unown engine <sub> — the detached self-learning engine:
  status   is the engine up? pid, uptime, jobs, governor, outbox, auto-start circuit
  start    start it if down (detached; waits for health, Ctrl-C safe) — resets the
           crash-loop circuit (use after repeated failed auto-starts)
  stop     graceful stop (drains requests, checkpoints the WAL, releases the lock)
  repair   quarantine a corrupt engine DB (backs it up aside, boots fresh; memory
           files on disk + queued notes survive) — when the engine won't start
  serve    run the engine in THIS process (the supervisor entry — systemd/
           launchd/Windows services should use this)`;

export async function runEngineCommand(argv: string[], ctx: { out?: (s: string) => void } = {}): Promise<number> {
        const out = ctx.out ?? ((s: string) => console.log(s));
        const sub = argv[0] ?? "status";
        if (sub === "help" || sub === "--help" || sub === "-h") {
                out(ENGINE_USAGE);
                return 0;
        }
        if (sub === "status") return cmdStatus(out);
        if (sub === "start") return cmdStart(out);
        if (sub === "stop") return cmdStop(out);
        if (sub === "repair") return cmdRepair(out);
        if (sub === "serve") return cmdServe();
        out(`unown: unknown engine subcommand '${sub}'`);
        out(ENGINE_USAGE);
        return 2;
}

async function cmdStatus(out: (s: string) => void): Promise<number> {
        const health = await engineHealth(2500);
        const stats = outboxStats();
        if (!health.up) {
                const pf = enginePidFromPidfile();
                const circuit = readSpawnState();
                out(`engine: DOWN (${ENGINE_URL})`);
                out(`  pidfile ${enginePidFile()}: ${pf.pid ? `pid ${pf.pid} (${pf.alive ? "alive — wedged beyond HTTP?" : "dead"})` : "absent"}`);
                out(`  outbox: ${stats.queued} note(s) queued locally${stats.dropped > 0 ? ` · ${stats.dropped} dropped while offline` : ""}`);
                out(`  auto-start: ${describeSpawnCircuit(circuit)}`);
                if (circuit.gaveUp) out(`  if it keeps failing: inspect .run/engine.log, then try unown engine repair (corrupt DB?)`);
                out("  start it with: unown engine start");
                return 1;
        }
        // Full report (the cheap probe passed; now the detailed one, still bounded).
        try {
                const res = await fetch(`${ENGINE_URL}/api/overview`, { signal: AbortSignal.timeout(3000) });
                const body: any = await res.json();
                const r = body?.router ?? {};
                const g = body?.governor ?? {};
                const b = g.budget ?? {};
                const br = g.breaker ?? {};
                const uptimeS = Math.round((body?.uptimeMs ?? 0) / 1000);
                out(`engine: UP (pid ${body?.pid ?? "?"}, up ${Math.floor(uptimeS / 60)}m${uptimeS % 60}s)`);
                out(`  router: ${r.busy ? `busy on '${r.activeJob}' for ${Math.round((r.busyMs ?? 0) / 1000)}s` : "idle"} (watchdog ${Math.round((r.jobTimeoutMs ?? 0) / 1000)}s)`);
                out(`  budget: ${b.callsHour ?? "?"} calls/h, ${b.tokensHour ?? "?"} tok/h (limits ${b.limits?.callsHour ?? "?"}/${b.limits?.tokensHour ?? "?"})${b.overBudget ? " — THROTTLED" : ""}`);
                out(`  breaker: ${br.open ? `OPEN (retry in ${Math.ceil((br.retryInMs ?? 0) / 1000)}s)` : "closed"}`);
                out(`  kpis: ${body?.kpis?.totalRuns ?? "?"} runs, ${body?.kpis?.dreams ?? "?"} dreams, ${body?.kpis?.improvementsShipped ?? "?"} improvements shipped`);
                out(`  outbox: ${stats.queued} note(s) pending sync${stats.dropped > 0 ? ` · ${stats.dropped} dropped while offline` : ""}`);
                return 0;
        } catch {
                out(`engine: UP (health probe passed, detailed report timed out — ${ENGINE_URL})`);
                return 0;
        }
}

async function cmdStart(out: (s: string) => void): Promise<number> {
        const pre = await engineHealth(1500);
        if (pre.up) {
                out(`engine: already up (pid ${pre.pid ?? "?"})`);
                return 0;
        }
        out(`engine: down — spawning a detached engine…`);
        // FORCE: an explicit user action bypasses the M6 crash-loop circuit
        // (backoff / gave-up) and resets it — the manual equivalent of
        // systemd's `systemctl reset-failed` before `start`.
        const spawned = await spawnEngineDetached({ force: true });
        if (!spawned) {
                out(`engine: spawn failed (see the log at .run/engine.log) — start the stack manually: bun run agent:start`);
                return 1;
        }
        // skipSpawn: the force-spawn above already launched the child (and its
        // recorded attempt would gate this function's own un-forced spawn call
        // into a 2s backoff — the M6 gate composing wrong with the wait).
        const result = await ensureEngineRunning(20_000, { skipSpawn: true });
        if (result.up) {
                out(`engine: UP (pid ${result.pid ?? "?"})`);
                return 0;
        }
        out(`engine: spawned but not healthy yet after 20s — it may still be booting; check:`);
        out(`  unown engine status   ·   ${process.platform === "win32" ? "Get-Content -Wait .run\\engine.log" : "tail -f .run/engine.log"}`);
        return 1;
}

async function cmdStop(out: (s: string) => void): Promise<number> {
        // HTTP-first (M3, cross-platform): POST /api/shutdown runs the SAME drain
        // path as the signal handlers and works on Windows, where SIGTERM cannot
        // reach JS handlers (TerminateProcess skips them). Signals remain the
        // fallback for an engine that answers neither way.
        try {
                const res = await fetch(`${ENGINE_URL}/api/shutdown`, { method: "POST", signal: AbortSignal.timeout(3000) });
                if (res.ok) {
                        out("engine: drain requested (in-flight requests finish, WAL checkpointed, lock released)…");
                        for (let i = 0; i < 20; i++) {
                                await new Promise((r) => setTimeout(r, 500));
                                if (!(await engineHealth(600)).up) {
                                        out("engine: stopped cleanly");
                                        return 0;
                                }
                        }
                        out("engine: still draining after 10s — falling back to signals");
                }
        } catch {
                /* engine not serving HTTP — fall through to the signal path */
        }
        const health = await engineHealth(1500);
        let pid = health.pid ?? undefined;
        if (!pid) {
                const pf = enginePidFromPidfile();
                if (pf.pid && pf.alive) pid = pf.pid;
        }
        if (!pid) {
                if (health.up) {
                        // The engine answers HTTP but reports no pid and the pidfile is
                        // stale/dead — it predates supervised starts. Never blind-signal a
                        // pid we cannot verify; point at the legacy stop path instead.
                        out("engine: UP but its pid is unknown (engine predates supervision, pidfile is stale)");
                        out("  stop it with: bun run agent:stop   (then start it with: unown engine start)");
                        return 1;
                }
                out("engine: not running");
                return 0;
        }
        out(`engine: SIGTERM to pid ${pid} (draining in-flight requests)…`);
        try {
                process.kill(pid, "SIGTERM");
        } catch (err: any) {
                out(`engine: cannot signal pid ${pid}: ${err?.message ?? err}`);
                return 1;
        }
        // The graceful drain (server.stop + router stop + WAL checkpoint) is fast;
        // allow 10s before reporting the hard-kill fallback.
        for (let i = 0; i < 20; i++) {
                await new Promise((r) => setTimeout(r, 500));
                const probe = await engineHealth(600);
                if (!probe.up) {
                        out("engine: stopped cleanly (drained, checkpointed, lock released)");
                        return 0;
                }
        }
        try {
                process.kill(pid, "SIGKILL");
                out("engine: did not drain in 10s — SIGKILLed (WAL recovery covers it at next boot)");
                return 0;
        } catch {
                out("engine: stopped");
                return 0;
        }
}

/**
 * `unown engine repair` (M6) — the corrupt-DB recovery path.
 *
 * WHEN: the engine crash-loops on boot (auto-start circuit gave up, the log
 * shows SQLITE_CORRUPT / "database disk image is malformed"). Research
 * (sqlite.org howtocorrupt + cli docs, docs/resilience.md): corruption is
 * almost always environmental (lying drives, power loss mid-sync), the
 * honest recovery is backup → quarantine → fresh DB, and the OUTBOX + the
 * on-disk memory files make the loss BOUNDED by design:
 *   - queued notes replay from $UNOWN_HOME/notes/outbox at next boot;
 *   - project memory lives in <project>/.unown/memory/*.md, untouched;
 *   - only engine-internal history (runs/dreams/skills tables) is left
 *     behind in the quarantined file — recoverable via `sqlite3 .recover`.
 */
async function cmdRepair(out: (s: string) => void): Promise<number> {
        // Never pull the DB out from under a live engine.
        const health = await engineHealth(1500);
        if (health.up) {
                out("engine: UP — stop it first (unown engine stop), then re-run repair");
                return 1;
        }
        const db = DB_PATH;
        if (!existsSync(db)) {
                out(`engine: no database at ${db} — nothing to repair (a fresh one is created by: unown engine start)`);
                return 0;
        }
        // 1. Quick integrity triage — a HEALTHY db needs no repair (the crash
        //    loop had another cause; point at the log instead of nuking data).
        let verdict = "unknown";
        try {
                const probe = new Database(db, { create: false });
                const rows = probe.prepare("PRAGMA quick_check").all() as Array<{ quick_check?: string }>;
                verdict = String(rows[0]?.quick_check ?? "unknown");
                probe.close();
        } catch (err: any) {
                verdict = `unreadable: ${err?.message ?? err}`;
        }
        const sizeKb = (() => {
                try {
                        return Math.max(1, Math.round(statSync(db).size / 1024));
                } catch {
                        return -1;
                }
        })();
        if (verdict === "ok") {
                out(`engine: database at ${db} passes PRAGMA quick_check (${sizeKb} KB) — no repair needed.`);
                out("  the failed starts had another cause — inspect .run/engine.log (port conflict? missing bun? env?)");
                return 0;
        }
        // 2. Quarantine: rename db + WAL sidecars aside (keeps every byte for
        //    forensic `sqlite3 <file> .recover`; a copy would double disk use).
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const moved: string[] = [];
        for (const suffix of ["", "-wal", "-shm"]) {
                const from = `${db}${suffix}`;
                if (!existsSync(from)) continue;
                const to = `${db}.corrupt-${stamp}${suffix}`;
                try {
                        renameSync(from, to);
                        moved.push(to);
                } catch (err: any) {
                        out(`engine: repair failed — cannot move ${from}: ${err?.message ?? err}`);
                        out("  (close any process holding the file and re-run: unown engine repair)");
                        return 1;
                }
        }
        out(`engine: database quarantined — quick_check said: ${verdict} (${sizeKb} KB)`);
        for (const to of moved) out(`  → ${to}`);
        out("  kept for forensics: sqlite3 <file> '.recover' can salvage rows; delete when confident");
        // 3. Fresh slate: the circuit that gave up on the old DB must not
        //    block the fresh boot; notes replay from the outbox, memory files
        //    on disk are untouched.
        resetSpawnCircuit();
        out("  auto-start circuit reset; queued notes replay from the outbox at next boot");
        out("  start it fresh with: unown engine start");
        return 0;
}

async function cmdServe(): Promise<number> {
        // DYNAMIC import — the M2 detachment contract: a terminal session must
        // never load the engine half of the package (or its SQLite handle).
        try {
                const { startServer } = await import("./index.ts");
                const server = startServer(Number(process.env.PI_AGENT_PORT ?? 3030));
                if (!server) {
                        // startServer already logged why (another engine holds the lock).
                        return 0;
                }
                // Bun.serve keeps the event loop alive; serve until SIGTERM/SIGINT or
                // POST /api/shutdown, both handled by server.ts's graceful drain.
                return new Promise<number>(() => {});
        } catch (err: any) {
                const msg = String(err?.message ?? err);
                console.error(`unown engine: failed to start — ${msg}`);
                if (/corrupt|malformed|not a database/i.test(msg)) {
                        console.error("  the database is damaged — quarantine it and boot fresh with: unown engine repair");
                } else {
                        console.error("  (is the port already in use? see .run/engine.log)");
                }
                return 1;
        }
}
