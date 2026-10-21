#!/usr/bin/env bun
/**
 * scripts/serve-dashboard.ts — cross-platform `bun run start`.
 *
 * Old start script (POSIX-only): NODE_ENV=production bun .next/standalone/server.js 2>&1 | tee server.log
 * This port sets NODE_ENV=production itself, then spawns the Next standalone
 * server with bun and tees its output to BOTH the console and server.log.
 * SIGINT/SIGTERM are forwarded; the process exits with the server's exit code.
 *
 * Windows: spawned with windowsHide:true; signals are emulated by libuv
 * (TerminatProcess) — best effort, same as node.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { IS_WIN, REPO_ROOT, resolveBun, sym } from "./lib";

const serverJs = path.join(REPO_ROOT, ".next", "standalone", "server.js");
if (!fs.existsSync(serverJs)) {
  console.error(
    `${sym.fail} .next/standalone/server.js is missing — run \`bun run build\` first, then \`bun run start\`.`,
  );
  process.exit(1);
}

const BUN = resolveBun();
if (!BUN) {
  console.error(`${sym.fail} bun is required to serve the dashboard — install it from https://bun.sh`);
  process.exit(1);
}

const logFd = fs.openSync(path.join(REPO_ROOT, "server.log"), "a");
// Dashboard API base (P0 fix — see next.config.ts): an unset/empty value
// defaults to the local engine so the standalone server works out of the box;
// explicit values (including the "gateway" sentinel) always win.
const rawApiBase = (process.env.NEXT_PUBLIC_AGENT_API_BASE ?? "").trim();
const childEnv: Record<string, string | undefined> = { ...process.env, NODE_ENV: "production" };
if (rawApiBase.length === 0) {
  childEnv.NEXT_PUBLIC_AGENT_API_BASE = `http://127.0.0.1:${process.env.PI_AGENT_PORT ?? "3030"}`;
}
const child = spawn(BUN, [serverJs], {
  cwd: REPO_ROOT,
  env: childEnv,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: IS_WIN,
});

child.stdout?.on("data", (chunk) => {
  process.stdout.write(chunk);
  fs.writeSync(logFd, chunk);
});
child.stderr?.on("data", (chunk) => {
  process.stderr.write(chunk);
  fs.writeSync(logFd, chunk);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  });
}

child.on("close", (code, signal) => {
  try {
    fs.closeSync(logFd);
  } catch {
    // fd already closed
  }
  process.exit(code ?? (signal ? 130 : 0));
});

child.on("error", (err) => {
  console.error(`${sym.fail} failed to start ${serverJs}:`, err?.message ?? err);
  process.exit(1);
});
