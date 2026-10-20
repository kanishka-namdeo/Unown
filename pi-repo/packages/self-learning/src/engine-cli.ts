/**
 * engine-cli.ts — `unown engine status|start|stop|serve` (M3).
 *
 * The supervision surface for the detached self-learning engine
 * (docs/detached-engine-architecture.md, design rules 1 + 5):
 *
 *   status  ping + report (pid, uptime, jobs, governor budget/breaker)
 *   start   ping-or-spawn: detached `engine serve` child + jittered health poll
 *   stop    graceful: SIGTERM (the engine drains in-flight requests, stops the
 *           router, checkpoints the WAL, releases its lock) with a hard-kill
 *           fallback after a deadline
 *   serve   run the engine in the FOREGROUND of this process — the entry a
 *           supervisor (systemd user unit, launchd agent, Windows service,
 *           dev shell) should own. The engine import is DYNAMIC: a normal
 *           terminal session never loads the engine half of the package
 *           (the M2 detachment contract).
 */
import { ENGINE_URL } from "./term.ts";
import {
        engineHealth,
        enginePidFile,
        enginePidFromPidfile,
        ensureEngineRunning,
        spawnEngineDetached,
} from "./engine-supervisor.ts";

export const ENGINE_USAGE = `unown engine <sub> — the detached self-learning engine:
  status   is the engine up? pid, uptime, active job, governor budget/breaker
  start    start it if down (detached; waits for health, Ctrl-C safe)
  stop     graceful stop (drains requests, checkpoints the WAL, releases the lock)
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
        if (sub === "serve") return cmdServe();
        out(`unown: unknown engine subcommand '${sub}'`);
        out(ENGINE_USAGE);
        return 2;
}

async function cmdStatus(out: (s: string) => void): Promise<number> {
        const health = await engineHealth(2500);
        if (!health.up) {
                const pf = enginePidFromPidfile();
                out(`engine: DOWN (${ENGINE_URL})`);
                out(`  pidfile ${enginePidFile()}: ${pf.pid ? `pid ${pf.pid} (${pf.alive ? "alive — wedged beyond HTTP?" : "dead"})` : "absent"}`);
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
        const spawned = await spawnEngineDetached();
        if (!spawned) {
                out(`engine: spawn failed (see the log at .run/engine.log) — start the stack manually: bun run agent:start`);
                return 1;
        }
        const result = await ensureEngineRunning(20_000);
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
                console.error(`unown engine: failed to start — ${err?.message ?? err}`);
                console.error("  (is the port already in use? see .run/engine.log)");
                return 1;
        }
}
