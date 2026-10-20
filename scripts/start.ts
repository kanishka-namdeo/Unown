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
import { spawn } from "node:child_process";
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

// zai-upstream shim: a local OpenAI-compatible endpoint backed by the
// sandbox's z-ai-web-dev-sdk gateway. Only started when the bridge is pointed
// at it (BRIDGE_UPSTREAM_URL=http://127.0.0.1:3032/v1) — a real provider
// (Dashscope, OpenAI, ...) needs no shim.
if ((process.env.BRIDGE_UPSTREAM_URL ?? "").includes("127.0.0.1:3032")) {
  if (await probeHttpOk(`http://127.0.0.1:${ZAI_PORT}/v1/models`)) {
    console.log(`${sym.dot} zai-upstream already healthy on :${ZAI_PORT} — reusing it`);
  } else {
    startService("zai-upstream", path.join("mini-services", "zai-upstream"), ["index.ts"]);
  }
}

// The bridge may already be healthy (started by another supervisor / earlier
// run) — reuse it instead of dying with EADDRINUSE.
if (await probeHttpOk(`http://127.0.0.1:${BRIDGE_PORT}/health`)) {
  console.log(`${sym.dot} bridge already healthy on :${BRIDGE_PORT} — reusing it`);
} else {
  startService("bridge", path.join("mini-services", "llm-bridge"), ["index.ts"]);
}
startService("engine", path.join("mini-services", "agent-service"), ["index.ts"]);
startService("dashboard", ".", ["run", "dev"]);

// ------------------------------------------------------- health wait (~60s)
console.log(`${sym.dot} waiting for services to come up…`);
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
  console.log(`  ${sym.warn} BRIDGE_UPSTREAM_KEY is not set in .env — every chat will fail with 401.`);
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
    console.log(`  ${sym.warn} The bridge reached the upstream but the upstream is unhealthy —`);
    console.log("    check BRIDGE_UPSTREAM_URL / BRIDGE_UPSTREAM_KEY in .env.");
  }
} else if (health && typeof health.failovers === "number" && health.failovers > 0) {
  console.log(
    `  ${sym.warn} ${health.failovers} request${health.failovers === 1 ? "" : "s"} served by the fallback upstream so far — the primary upstream is failing some requests.`,
  );
}

console.log("  Logs: .run/bridge.log, .run/engine.log, .run/dashboard.log");
console.log("  Stop: bun run agent:stop");
