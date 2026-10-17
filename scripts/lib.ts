#!/usr/bin/env bun
/**
 * scripts/lib.ts — shared cross-platform helpers for the Unown lifecycle
 * scripts (install.ts, link.ts, start.ts, stop.ts, serve-dashboard.ts).
 *
 * The scripts run under bun (≥ 1.2) on Windows, macOS and Linux. Everything
 * here uses only Node-compatible APIs (node:fs / node:path / node:child_process)
 * so the files stay reviewable and portable; bun executes them natively.
 *
 * Windows notes (correctness by construction — no POSIX-only API unguarded):
 *   - every path is built with node:path (never hardcoded "/" strings),
 *   - process.kill(pid, 0) works on win32 as a liveness probe,
 *   - os.homedir() resolves %USERPROFILE% on Windows,
 *   - console output switches to plain ASCII on win32 (codepage-safe),
 *   - spawning always uses shell:false with absolute binaries
 *     (resolved via PATH scan incl. bun.exe / bun.cmd).
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";

export const IS_WIN = process.platform === "win32";
export const IS_LINUX = process.platform === "linux";
export const IS_POSIX = !IS_WIN;

/** Absolute repo root (scripts/ lives directly under it). */
export const REPO_ROOT = path.resolve(import.meta.dir, "..");

/**
 * Console glyphs. On win32 the codepage is not guaranteed to be UTF-8, so we
 * fall back to plain ASCII ("where practical": every message the lifecycle
 * scripts print goes through these).
 */
export const sym = IS_WIN
  ? { step: ">", ok: "OK", fail: "X", warn: "!", dot: "-" }
  : { step: "▶", ok: "✓", fail: "✗", warn: "⚠", dot: "·" };

/** Per-OS one-liner that installs bun (docs and error messages use this). */
export function bunInstallHint(): string {
  if (IS_WIN) {
    return 'powershell -c "irm bun.sh/install.ps1 | iex"   (then open a NEW terminal)';
  }
  return "curl -fsSL https://bun.sh/install | bash   (then restart your shell)";
}

/** PATH separator + executable candidates per platform. */
const PATH_SEP = IS_WIN ? ";" : ":";
const BUN_NAMES = IS_WIN ? ["bun.exe", "bun.cmd", "bun.bat", "bun"] : ["bun"];

function isExecutableFile(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false;
    if (IS_WIN) return true; // PATHEXT already filtered by name; Windows
    // decides executability by extension, not the x bit.
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function firstBunIn(dir: string): string | null {
  if (!dir) return null;
  for (const name of BUN_NAMES) {
    const full = path.join(dir, name);
    if (isExecutableFile(full)) return full;
  }
  return null;
}

/**
 * Resolve an absolute bun executable — mirrors `command -v bun` on POSIX and
 * `where bun` on Windows (PATH scan, PATHEXT-aware), with the standard
 * install locations and finally the currently-running bun as fallbacks.
 * Returns null when nothing looks like bun (callers print the install hint).
 */
export function resolveBun(): string | null {
  // 1. PATH scan (what a future shell would find — this is what shims should
  //    point at, matching `command -v bun` in the original link.sh).
  for (const dir of (process.env.PATH ?? "").split(PATH_SEP)) {
    const hit = firstBunIn(path.resolve(dir));
    if (hit) return hit;
  }
  // 2. Standard install locations.
  for (const base of [
    process.env.BUN_INSTALL ? path.join(process.env.BUN_INSTALL, "bin") : null,
    path.join(homedir(), ".bun", "bin"),
  ]) {
    if (!base) continue;
    const hit = firstBunIn(base);
    if (hit) return hit;
  }
  // 3. The bun running this very script.
  if (process.execPath && fs.existsSync(process.execPath)) return process.execPath;
  return null;
}

/** `bun --version` for the given binary, or null if it cannot run. */
export function bunVersion(bun: string): string | null {
  try {
    const r = spawnSync(bun, ["--version"], { encoding: "utf8", windowsHide: IS_WIN });
    const out = (r.stdout ?? "").trim();
    return r.status === 0 && out ? out : null;
  } catch {
    return null;
  }
}

/** True when the parsed "1.x.y" version is ≥ 1.2 (the repo's floor). */
export function bunAtLeast120(version: string): boolean {
  const m = /^(\d+)\.(\d+)/.exec(version);
  if (!m) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > 1 || (major === 1 && minor >= 2);
}

/**
 * Run a command with spawnSync (shell:false, absolute binary, live streamed
 * output via stdio:"inherit"). Returns the child's exit code (1 if killed by
 * a signal). Never throws — callers decide what to do with the code.
 */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined> } = {},
): number {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: "inherit",
    shell: false,
    windowsHide: IS_WIN,
  });
  return r.status ?? 1;
}

/** Run a command and capture stdout (used for `where`-style lookups). */
export function capture(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined> } = {},
): { status: number; stdout: string } {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    encoding: "utf8",
    shell: false,
    windowsHide: IS_WIN,
  });
  return { status: r.status ?? 1, stdout: (r.stdout ?? "").trim() };
}

/**
 * Parse a .env file the way `set -a; . ./.env` did in start.sh:
 * KEY=VALUE lines, blank lines and # comments ignored, one pair of matching
 * surrounding quotes stripped (bash would eat them during sourcing).
 * Values may contain '=' (split at the first).
 */
export function loadEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/** Liveness probe — process.kill(pid, 0) works on win32 too. */
export function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    // EPERM = exists but not ours (still alive); ESRCH = gone.
    const code = (e as { code?: string })?.code;
    return code === "EPERM";
  }
}

/** HTTP probe: resolves true only for a 2xx within the timeout. */
export async function probeHttpOk(url: string, timeoutMs = 2500): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

/** HTTP GET returning parsed JSON, or null on any failure. */
export async function fetchJson(url: string, timeoutMs = 2500): Promise<unknown> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
