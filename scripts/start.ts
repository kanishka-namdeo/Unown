#!/usr/bin/env bun
/**
 * scripts/start.ts — Unown launcher, cross-platform port of scripts/start.sh
 * (which now delegates here). Starts the llm-bridge (:3031), the self-learning
 * engine (:3030) and the dashboard (:3000), each as a background process
 * managed through pidfiles in .run/.
 *
 * Behavior preserved from start.sh:
 *   - repo-root .env is parsed (KEY=VALUE lines, comments/blanks ignored) and
 *     merged into the environment of every child (bun does NOT read the
 *     repo-root .env from a mini-services cwd, so the launcher must export
 *     it — exactly what `set -a; . ./.env` did). .env values override
 *     inherited ones, like bash sourcing did.
 *   - an already-healthy bridge (or zai-upstream) is reused instead of dying
 *     with EADDRINUSE;
 *   - the zai-upstream shim only starts when BRIDGE_UPSTREAM_URL points at
 *     the loopback gateway (contains 127.0.0.1:3032);
 *   - health polling up to ~60s (fetch + AbortSignal.timeout), then the
 *     honest key/upstream report from the bridge's /health payload;
 *   - the dashboard is started with the repo's `dev` package script
 *     (`next dev -p 3000`); its output lands in .run/dashboard.log.
 *
 * Detached children SURVIVE parent exit:
 *   - POSIX: node:child_process spawn with detached:true puts each child in
 *     a new session (the nohup/setsid equivalent) + unref(), stdio pointed
 *     at the .run/<name>.log file — the parent can exit at any time.
 *   - Windows: detached:true alone (CREATE_NEW_PROCESS_GROUP) +
 *     windowsHide:true; there is no setsid/nohup concept to emulate.
 */
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  IS_WIN,
  REPO_ROOT,
  alive,
  fetchJson,
  loadEnvFile,
  probeHttpOk,
  resolveBun,
  sleep,
  sym,
} from "./lib";

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

const RUN_DIR = path.join(REPO_ROOT, ".run");
fs.mkdirSync(RUN_DIR, { recursive: true });

// Load .env if present (KEY=VALUE lines, no quoting tricks) and export the
// values into this process (mirrors `set -a; . ./.env; set +a`) so both our
// own port reads below and every spawned child see them.
const envFile = loadEnvFile(path.join(REPO_ROOT, ".env"));
for (const [key, value] of Object.entries(envFile)) {
  process.env[key] = value;
}

const BRIDGE_PORT = process.env.BRIDGE_PORT || "3031";
const ENGINE_PORT = process.env.PI_AGENT_PORT || "3030";
const ZAI_PORT = process.env.ZAI_UPSTREAM_PORT || "3032";

// ------------------------------------------------------------------ bun check
const BUN = resolveBun();
if (!BUN) {
  die(
    `${sym.fail} bun is required to start the stack — install it from https://bun.sh\n` +
      `    and re-run: bun run agent:start`,
  );
}

/**
 * Start one service unless its pidfile is alive. The child is detached
 * (survives this launcher's exit) with stdio appended to .run/<name>.log.
 *
 * Windows (bun#31603, audit 2-d gap #1): `spawn(..., { detached: true })`
 * children of a bun process die with the parent on win32 — the exact pattern
 * this launcher used on every platform, which would take the whole stack down
 * ~60 s after "Unown is up" (nothing on CI catches it: the Windows leg never
 * boots the stack). The escape is the one `unown engine start` already uses:
 * `cmd /c start /b "" <cmd>` launches into its own session that survives. The
 * empty "" is the window-title slot — without it `start` eats a quoted
 * executable path with spaces as the title. cmd.exe's own pid is NOT the
 * service's pid (it exits right after `start` returns), so no pidfile is
 * written on this branch; after the health wait, resolvePortPid() finds the
 * real listener pid via netstat and writes THAT (stop.ts tree-kills it).
 */
function startService(name: string, cwdRel: string, args: string[]): void {
  const pidFile = path.join(RUN_DIR, `${name}.pid`);
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    if (alive(pid)) {
      console.log(`${sym.dot} ${name} already running (pid ${pid})`);
      return;
    }
  }
  const logFd = fs.openSync(path.join(RUN_DIR, `${name}.log`), "a");
  if (IS_WIN) {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const cmdExe = path.join(systemRoot, "System32", "cmd.exe");
    const child = spawn(cmdExe, ["/c", "start", "/b", "", BUN, ...args], {
      cwd: path.join(REPO_ROOT, cwdRel),
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
    fs.closeSync(logFd);
    console.log(`${sym.step} ${name} started (win32 start /b - pid resolved after the health check)`);
    return;
  }
  const child = spawn(BUN, args, {
    cwd: path.join(REPO_ROOT, cwdRel),
    env: process.env,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: IS_WIN,
  });
  child.unref(); // the parent may exit; children keep running
  fs.writeFileSync(pidFile, String(child.pid));
  console.log(`${sym.step} ${name} started (pid ${child.pid})`);
}

/**
 * Windows pid recovery: after the health wait, find the pid OWNING each
 * service port via `netstat -ano` and write it into the pidfile so stop.ts
 * can tree-kill the real service (the `start /b` branch cannot know the pid
 * at spawn time). Best effort: no netstat match → no pidfile → stop.ts's
 * netstat fallback / guidance path.
 */
function resolvePortPid(name: string, port: string): void {
  if (!IS_WIN) return;
  try {
    const r = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
    if (r.status !== 0 || !r.stdout) return;
    for (const line of r.stdout.split(/\r?\n/)) {
      // TCP    127.0.0.1:3031    0.0.0.0:0    LISTENING    4242
      const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/);
      if (m && m[1] === port) {
        fs.writeFileSync(path.join(RUN_DIR, `${name}.pid`), m[2]);
        console.log(`${sym.dot} ${name} pid resolved via port ${port}: ${m[2]}`);
        return;
      }
    }
    console.log(`${sym.dot} ${name}: no LISTENING pid found on port ${port} (netstat) - stop will fall back to port-based teardown`);
  } catch {
    /* best effort */
  }
}

/**
 * Drain-aware restart (M0): the engine's graceful shutdown DRAINS in-flight
 * HTTP before exiting (engine-supervisor), and stop.ts removes the pidfile
 * the moment SIGTERM is sent — so a fast `agent:stop && agent:start` spawns
 * the new engine while the old one still holds the port, and it dies with
 * "Failed to start server. Is port 3030 in use?". Wait for the port to
 * actually stop answering before spawning. Returns false (and lets the
 * spawn surface the bind error honestly) when the timeout lapses.
 */
async function waitForPortFree(url: string, label: string, timeoutMs = 20_000): Promise<boolean> {
  if (!(await probeHttpOk(url, 750))) return true; // fast path: already free
  console.log(`${sym.dot} waiting for the previous ${label} to drain and release its port...`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await probeHttpOk(url, 750))) return true;
    await sleep(500);
  }
  return false;
}

// zai-upstream shim: a local OpenAI-compatible endpoint backed by the
// sandbox's z-ai-web-dev-sdk gateway. Only started when the bridge is pointed
// at it (BRIDGE_UPSTREAM_URL=http://127.0.0.1:3032/v1) — a real provider
// (Dashscope, OpenAI, ...) needs no shim.
if ((process.env.BRIDGE_UPSTREAM_URL ?? "").includes("127.0.0.1:3032")) {
  if (await probeHttpOk(`http://127.0.0.1:${ZAI_PORT}/v1/models`)) {
    console.log(`${sym.dot} zai-upstream already healthy on :${ZAI_PORT} - reusing it`);
  } else {
    startService("zai-upstream", path.join("mini-services", "zai-upstream"), ["index.ts"]);
  }
}

// The bridge may already be healthy (started by another supervisor / earlier
// run) — reuse it instead of dying with EADDRINUSE.
if (await probeHttpOk(`http://127.0.0.1:${BRIDGE_PORT}/health`)) {
  console.log(`${sym.dot} bridge already healthy on :${BRIDGE_PORT} - reusing it`);
} else {
  // A just-stopped bridge can still be mid-drain on its port — wait it out
  // instead of spawning into EADDRINUSE (same race the engine has).
  await waitForPortFree(`http://127.0.0.1:${BRIDGE_PORT}/health`, "bridge", 15_000);
  startService("bridge", path.join("mini-services", "llm-bridge"), ["index.ts"]);
}
// The engine gets the same reuse rule as the bridge (M4): a HEALTHY engine on
// the port is reused instead of spawning a second one into EADDRINUSE. This
// also kills the stale-pidfile class of strays — an engine whose pidfile went
// missing (manual kill, earlier spawn cycle) stays reused rather than racing
// a duplicate. Only when the port is NOT answering does the drain-aware wait
// + fresh spawn run.
if (await probeHttpOk(`http://127.0.0.1:${ENGINE_PORT}/api/overview`, 1500)) {
  console.log(`${sym.dot} engine already healthy on :${ENGINE_PORT} - reusing it`);
} else {
  await waitForPortFree(`http://127.0.0.1:${ENGINE_PORT}/api/overview`, "engine", 20_000);
  startService("engine", path.join("mini-services", "agent-service"), ["index.ts"]);
}
// Dashboard API base (P0 fix): agent:start always pairs the dashboard with a
// local engine, so an unset/empty NEXT_PUBLIC_AGENT_API_BASE defaults to the
// engine's loopback URL — the stock install must not silently fall into
// gateway mode (relative + XTransformPort), which 404s on any machine without
// the z.ai sandbox preview gateway. Explicit values win; "gateway" (case-
// insensitive) keeps the sandbox preview working.
{
  const raw = (process.env.NEXT_PUBLIC_AGENT_API_BASE ?? "").trim();
  if (raw.length === 0) {
    process.env.NEXT_PUBLIC_AGENT_API_BASE = `http://127.0.0.1:${ENGINE_PORT}`;
    console.log(
      `${sym.dot} dashboard API base defaulted to ${process.env.NEXT_PUBLIC_AGENT_API_BASE} (set NEXT_PUBLIC_AGENT_API_BASE=gateway for the sandbox preview)`,
    );
  }
}
startService("dashboard", ".", ["run", "dev"]);

// ------------------------------------------------------- health wait (~60s)
console.log(`${sym.dot} waiting for services to come up...`);
const deadline = Date.now() + 65_000;
let bridgeOk = false;
let engineOk = false;
let dashOk = false;
while (Date.now() < deadline) {
  bridgeOk = await probeHttpOk(`http://127.0.0.1:${BRIDGE_PORT}/health`, 1500);
  engineOk = await probeHttpOk(`http://127.0.0.1:${ENGINE_PORT}/api/overview`, 1500);
  dashOk = await probeHttpOk("http://127.0.0.1:3000/", 1500);
  if (bridgeOk && engineOk && dashOk) break;
  await sleep(1000);
}

// Windows: the `start /b` branch could not write pidfiles at spawn time —
// now that the services answer their ports, resolve the real listener pids.
if (IS_WIN) {
  if (bridgeOk) resolvePortPid("bridge", BRIDGE_PORT);
  if (engineOk) resolvePortPid("engine", ENGINE_PORT);
  if (dashOk) resolvePortPid("dashboard", "3000");
}

if (!(bridgeOk && engineOk && dashOk)) {
  // Additive honesty (start.sh printed the block below unconditionally):
  // name exactly which checks are still down and where the logs are.
  const state = (ok: boolean) => (ok ? "ok" : "DOWN");
  console.log(
    `  ${sym.warn} after the health wait: bridge ${state(bridgeOk)}, ` +
      `engine ${state(engineOk)}, dashboard ${state(dashOk)}`,
  );
  console.log(`    check the logs: .run/bridge.log, .run/engine.log, .run/dashboard.log`);
}

console.log("");
console.log(`${sym.ok} Unown is up.`);
console.log("    Dashboard      http://localhost:3000/dashboard");
console.log(`    Engine API     http://127.0.0.1:${ENGINE_PORT}/api/overview`);
console.log(`    LLM bridge     http://127.0.0.1:${BRIDGE_PORT}/health`);
console.log("");

// Honest key/upstream reporting: /health only counts as "ok" for the chat path
// when the upstream key is set and the upstream actually answers — OR a
// fallback upstream is configured and serving (failover lane).
const health = (await fetchJson(`http://127.0.0.1:${BRIDGE_PORT}/health`)) as
  | {
      upstreamKeyIsSet?: boolean;
      upstream?: { ok?: boolean };
      fallback?: { ok?: boolean; model?: string | null; url?: string } | null;
      failovers?: number;
    }
  | null;
if (health && health.upstreamKeyIsSet === false) {
  console.log(`  ${sym.warn} BRIDGE_UPSTREAM_KEY is not set in .env - every chat will fail with 401.`);
  console.log(
    "    fix: edit .env, set BRIDGE_UPSTREAM_KEY=<your upstream key>, then: bun run agent:stop && bun run agent:start",
  );
} else if (health && health.upstream && health.upstream.ok === false) {
  if (health.fallback && health.fallback.ok) {
    console.log(
      `  ${sym.warn} The primary upstream is unhealthy — the bridge is FAILING OVER to ${
        health.fallback.model ?? "the fallback model"
      } (${health.fallback.url}).`,
    );
    console.log("    Chats continue on the fallback; check BRIDGE_UPSTREAM_URL / BRIDGE_UPSTREAM_KEY when you want the primary back.");
  } else {
    console.log(`  ${sym.warn} The bridge reached the upstream but the upstream is unhealthy -`);
    console.log("    check BRIDGE_UPSTREAM_URL / BRIDGE_UPSTREAM_KEY in .env.");
  }
} else if (health && typeof health.failovers === "number" && health.failovers > 0) {
  console.log(
    `  ${sym.warn} ${health.failovers} request${health.failovers === 1 ? "" : "s"} served by the fallback upstream so far — the primary upstream is failing some requests.`,
  );
}

console.log("  Logs: .run/bridge.log, .run/engine.log, .run/dashboard.log");
console.log("  Stop: bun run agent:stop");
