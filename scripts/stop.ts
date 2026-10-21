#!/usr/bin/env bun
/**
 * scripts/stop.ts — Unown stopper, cross-platform port of scripts/stop.sh
 * (which now delegates here). Halts the dashboard, engine and llm-bridge
 * started by scripts/start.ts, falling back to pattern matching when
 * pidfiles are stale.
 *
 * Exit codes (deliberate change from stop.sh, which always exited 0):
 *   0 = at least one process was stopped,
 *   1 = nothing was running.
 *
 * Platform behavior:
 *   - POSIX: pidfile processes get SIGTERM via process.kill(pid).
 *     Stray sweeps use pkill/pgrep (deviation from stop.sh: the /proc/$pid/cwd
 *     bun-service sweep runs on Linux ONLY — no /proc elsewhere — and now
 *     matches only THIS checkout's mini-services dirs, so running stop from
 *     one worktree can never kill another checkout's live stack).
 *   - Windows: pidfile processes (and their whole trees) get
 *     `taskkill /F /T /PID <pid>`; when a pidfile is missing or stale the
 *     netstat -ano fallback (audit 2-d) maps the service PORT to its owning
 *     pid and tree-kills it.
 *   - macOS: like POSIX for pidfiles; for a missing/stale pidfile the lsof
 *     fallback (audit M4-d) maps the service port to its owning pid
 *     (`lsof -ti tcp:<port>`) — the darwin twin of the Windows netstat path.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { IS_LINUX, IS_WIN, REPO_ROOT, alive, capture, probeHttpOk, sym } from "./lib";

const RUN_DIR = path.join(REPO_ROOT, ".run");
let stoppedAny = false;

function stopService(name: string): void {
  const pidFile = path.join(RUN_DIR, `${name}.pid`);
  if (!fs.existsSync(pidFile)) {
    console.log(`${sym.dot} ${name} not running (no pidfile)`);
    return;
  }
  const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
  if (alive(pid)) {
    if (IS_WIN) {
      // Tree kill: the dashboard's `next dev` and bun workers die with it.
      const r = spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
        windowsHide: true,
      });
      if (r.status === 0) {
        console.log(`${sym.step} ${name} stopped (pid ${pid}, tree)`);
        stoppedAny = true;
      } else {
        console.log(`${sym.warn} ${name}: taskkill exited ${r.status} for pid ${pid}`);
      }
    } else {
      try {
        process.kill(pid); // SIGTERM, like stop.sh's `kill "$pid"`
        console.log(`${sym.step} ${name} stopped (pid ${pid})`);
        stoppedAny = true;
      } catch {
        console.log(`${sym.warn} ${name}: SIGTERM failed for pid ${pid}`);
      }
    }
  } else {
    console.log(`${sym.dot} ${name} pidfile stale (pid ${pid})`);
  }
  fs.rmSync(pidFile, { force: true });
}

/** Windows netstat fallback (audit 2-d): a MISSING pidfile used to mean "no
 *  portable way to find the stray" — but the service port is knowable, and
 *  `netstat -ano` maps a LISTENING port to its owning pid, which taskkill
 *  /T can tree-kill. Runs only when the pidfile is absent/stale, only on
 *  win32, and only for ports this stack owns. */
function stopServiceByPort(name: string, port: string): void {
  if (!IS_WIN) return;
  const pidFile = path.join(RUN_DIR, `${name}.pid`);
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    if (alive(pid)) return; // the pidfile path handles it
  }
  try {
    const r = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
    if (r.status !== 0 || !r.stdout) return;
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/);
      if (m && m[1] === port) {
        const pid = Number(m[2]);
        if (!Number.isInteger(pid) || pid <= 0) continue;
        const kill = spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], {
          stdio: "ignore",
          windowsHide: true,
        });
        if (kill.status === 0) {
          console.log(`${sym.step} ${name} stopped (pid ${pid} via port ${port}, tree)`);
          stoppedAny = true;
        }
        return;
      }
    }
  } catch {
    /* best effort */
  }
}

/** macOS lsof fallback (audit M4-d): the darwin twin of stopServiceByPort —
 *  with a missing/stale pidfile, `lsof -ti tcp:<port>` maps the service port
 *  to its owning pid (comma-separated when several), which gets SIGTERM.
 *  Runs only when the pidfile is absent/stale, only on darwin, and only for
 *  ports this stack owns. */
function stopServiceByPortDarwin(name: string, port: string): void {
  if (process.platform !== "darwin") return;
  const pidFile = path.join(RUN_DIR, `${name}.pid`);
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    if (alive(pid)) return; // the pidfile path handles it
  }
  try {
    const r = spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    });
    if (r.status !== 0 || !r.stdout) return;
    for (const tok of r.stdout.split(/[\s,]+/)) {
      const pid = Number(tok);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      try {
        process.kill(pid); // SIGTERM, like the pidfile path
        console.log(`${sym.step} ${name} stopped (pid ${pid} via port ${port})`);
        stoppedAny = true;
      } catch {
        // already gone — fine
      }
    }
  } catch {
    /* best effort */
  }
}

stopService("dashboard");
stopService("engine");
stopService("bridge");
stopService("zai-upstream");
// Windows netstat fallback for missing/stale pidfiles (see stopServiceByPort).
stopServiceByPort("dashboard", process.env.PI_DASHBOARD_PORT ?? "3000");
stopServiceByPort("engine", process.env.PI_AGENT_PORT ?? "3030");
stopServiceByPort("bridge", process.env.BRIDGE_PORT ?? "3031");
stopServiceByPort("zai-upstream", process.env.ZAI_UPSTREAM_PORT ?? "3032");
// macOS lsof fallback for missing/stale pidfiles (see stopServiceByPortDarwin).
stopServiceByPortDarwin("dashboard", process.env.PI_DASHBOARD_PORT ?? "3000");
stopServiceByPortDarwin("engine", process.env.PI_AGENT_PORT ?? "3030");
stopServiceByPortDarwin("bridge", process.env.BRIDGE_PORT ?? "3031");
stopServiceByPortDarwin("zai-upstream", process.env.ZAI_UPSTREAM_PORT ?? "3032");

if (!IS_WIN) {
  // Fallback: catch strays spawned by `next dev` (pipelines, tee'd logs) or
  // bun hot reloads. pkill's exit 0 = something matched and was signaled.
  if (capture("pkill", ["-f", "next dev"]).status === 0) {
    console.log(`${sym.step} stray next dev stopped`);
    stoppedAny = true;
  }
  if (capture("pkill", ["-f", "tee dev.log"]).status === 0) {
    console.log(`${sym.step} stray dev log tee stopped`);
    stoppedAny = true;
  }
}

// bun service processes share the cmdline "bun --hot index.ts", so match them
// by working directory instead of command line — possible only where /proc
// exists, and scoped to THIS checkout (see header).
if (IS_LINUX) {
  const pgrep = capture("pgrep", ["-f", "bun.*index\\.ts"]);
  if (pgrep.status === 0) {
    for (const line of pgrep.stdout.split(/\r?\n/)) {
      const pid = Number(line.trim());
      if (!Number.isInteger(pid) || pid <= 0) continue;
      let cwd = "";
      try {
        cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
      } catch {
        continue; // process exited between pgrep and readlink
      }
      for (const svc of ["agent-service", "llm-bridge", "zai-upstream"]) {
        if (path.resolve(cwd) === path.join(REPO_ROOT, "mini-services", svc)) {
          try {
            process.kill(pid);
            console.log(`${sym.step} stray bun service stopped (pid ${pid}, cwd ${cwd})`);
            stoppedAny = true;
          } catch {
            // already gone — fine
          }
        }
      }
    }
  }
}

if (!stoppedAny) {
  console.log(`${sym.dot} nothing was running`);
  process.exit(1);
}

// Drain wait (M3, mirrors start.ts's waitForPortFree): SIGTERM asks the
// engine/bridge to DRAIN in-flight work before exiting, and stop used to
// return while the ports were still bound — an immediate `agent:start` or
// e2e run then collided with the dying process. Wait (bounded) for the
// engine/bridge ports to actually stop answering.
const ENGINE_PORT = process.env.PI_AGENT_PORT || "3030";
const BRIDGE_PORT = process.env.BRIDGE_PORT || "3031";
async function waitForPortFree(url: string, label: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await probeHttpOk(url, 750))) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
const engineFreed = await waitForPortFree(`http://127.0.0.1:${ENGINE_PORT}/api/overview`, "engine", 15_000);
const bridgeFreed = await waitForPortFree(`http://127.0.0.1:${BRIDGE_PORT}/health`, "bridge", 10_000);
if (!engineFreed || !bridgeFreed) {
  console.log(
    `${sym.warn} still draining after the wait (engine ${engineFreed ? "released" : "busy"}, bridge ${
      bridgeFreed ? "released" : "busy"
    }) — ports may need a moment longer.`,
  );
}
process.exit(0);
