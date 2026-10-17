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
 *     `taskkill /F /T /PID <pid>`; no pkill/pgrep exists, so stray sweeping
 *     relies on the tree kill. If a pidfile is missing on Windows there is
 *     no portable way to find the stray — kill it by hand or re-run start
 *     so the pidfile exists again.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { IS_LINUX, IS_WIN, REPO_ROOT, alive, capture, sym } from "./lib";

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

stopService("dashboard");
stopService("engine");
stopService("bridge");
stopService("zai-upstream");

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
process.exit(0);
