#!/usr/bin/env bun
/**
 * scripts/link.ts — puts `unown` on your PATH. Cross-platform port of
 * scripts/link.sh (which now delegates here).
 *
 * A small shim is written into a bin directory; the shim always executes
 * THIS checkout's bin/unown with bun. A shim (instead of a global package
 * install) keeps subagent spawning, the vendored pi-repo workspace deps and
 * `git pull` updates working with zero maintenance.
 *
 * Env:
 *   UNOWN_BIN_DIR   target directory (default: see below)
 *
 * Platform behavior:
 *   - macOS/Linux: target = first writable dir of ~/.local/bin, ~/bin,
 *     /usr/local/bin (same as link.sh). Writes a bash shim `unown`
 *     (`exec <bun> <repo>/bin/unown "$@"`), chmod 0755, and warns with the
 *     exact profile line when the dir is not on PATH.
 *   - Windows: target = %USERPROFILE%\.local\bin (created). Writes TWO shims:
 *     `unown.cmd` for cmd.exe (`@"<bun.exe>" "<repo>\bin\unown" %*`) and
 *     `unown.ps1` for PowerShell (`& "<bun.exe>" "<repo>\bin\unown" $args;
 *     exit $LASTEXITCODE`). Both are plain ASCII with LF newlines — cmd
 *     handles LF fine and the codepage stays happy.
 *     If the dir is missing from the user PATH (checked case-insensitively,
 *     split on ';'), it is appended via PowerShell
 *     [Environment]::SetEnvironmentVariable('Path', ..., 'User') — NEVER
 *     setx (it truncates at 1024 chars) — and a "restart your terminal" hint
 *     is printed.
 *
 * Idempotent: re-running overwrites the shims cleanly (safe after moving
 * the repo — re-run to re-point).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { IS_WIN, REPO_ROOT, capture, resolveBun, sym } from "./lib";
import {
  detectPlatform,
  readInstallMetadata,
  writeInstallMetadata,
  writeShimSet,
} from "../pi-repo/packages/self-learning/src/install-layout.ts";

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Escape a string for a single-quoted PowerShell literal ('' for '). */
function psEscape(s: string): string {
  return s.replace(/'/g, "''");
}

/** Normalize a PATH entry for comparison: lowercase (win) + no trailing sep. */
function normEntry(entry: string): string {
  let e = entry.trim();
  while (e.endsWith("\\") || e.endsWith("/")) e = e.slice(0, -1);
  return IS_WIN ? e.toLowerCase() : e;
}

const HOME = homedir();
const TARGET = path.join(REPO_ROOT, "bin", "unown");

// ------------------------------------------------------------------ bun check
const BUN = resolveBun();
if (!BUN) {
  die(
    `${sym.fail} bun is required (https://bun.sh) — it must be on PATH when unown runs.\n` +
      `    install it and re-run: bun run agent:link`,
  );
}

// -------------------------------------------------------------- pick bin dir
let binDir = process.env.UNOWN_BIN_DIR ?? "";

if (!binDir && !IS_WIN) {
  // POSIX: first writable candidate of ~/.local/bin, ~/bin, /usr/local/bin.
  for (const candidate of [
    path.join(HOME, ".local", "bin"),
    path.join(HOME, "bin"),
    "/usr/local/bin",
  ]) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK);
      binDir = candidate;
      break;
    } catch {
      // not writable — try the next candidate
    }
  }
}
if (!binDir && IS_WIN) {
  // Windows: %USERPROFILE%\.local\bin (created if needed).
  binDir = path.join(HOME, ".local", "bin");
  try {
    fs.mkdirSync(binDir, { recursive: true });
  } catch {
    binDir = "";
  }
}
if (!binDir) {
  die(
    `${sym.fail} no writable bin directory found — re-run with:\n` +
      `    UNOWN_BIN_DIR=/your/path/dir bun run agent:link`,
  );
}
fs.mkdirSync(binDir, { recursive: true });

// ------------------------------------------------------------- write the shim
const existing = readInstallMetadata(process.env.UNOWN_HOME || path.join(HOME, ".unown"));
const written = writeShimSet({
  dir: binDir,
  platform: process.platform,
  command: BUN,
  args: [TARGET],
  header: ["unown shim — created by scripts/link.ts; re-run it after moving the repo."],
});
if (IS_WIN) {
  console.log(`${sym.ok} linked ${path.join(binDir, "unown.cmd")} + unown.ps1 -> ${TARGET}`);
} else {
  console.log(`${sym.ok} linked ${written.primary} -> ${TARGET}`);
}

// ---------------------------------------------------- install metadata record
// ~/.unown/install.json records the ACTIVE install so `unown update` /
// `unown uninstall` know which shape they are looking at. A checkout link
// replaces a binary record (the shim just moved to this checkout) and says so.
try {
  const version = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).version;
  writeInstallMetadata(process.env.UNOWN_HOME || path.join(HOME, ".unown"), {
    schema: 1,
    mode: "checkout",
    version: String(version ?? "unknown"),
    platform: detectPlatform() ?? `${process.platform}-${process.arch}`,
    root: REPO_ROOT,
    bin: TARGET,
    shim: written.primary,
    installedAt: new Date().toISOString(),
  });
} catch (err) {
  console.log(`${sym.warn} could not write install metadata (${String(err)}) - ` +
    "unown update will treat this as a plain checkout");
}
if (existing?.mode === "binary") {
  console.log(`${sym.warn} a binary install is still present at ${existing.root};`);
  console.log("  this checkout now owns the PATH shim - run that install's uninstall to remove it");
}

// ------------------------------------------------------------------ PATH check
function onProcessPath(dir: string): boolean {
  const sep = IS_WIN ? ";" : ":";
  const want = normEntry(dir);
  for (const entry of (process.env.PATH ?? "").split(sep)) {
    if (normEntry(entry) === want) return true;
  }
  return false;
}

if (onProcessPath(binDir)) {
  // Already visible in this shell — nothing to do.
} else if (IS_WIN) {
  // Check the *user* PATH (registry), not just this session's merged PATH.
  const query = capture("powershell", [
    "-NoProfile",
    "-Command",
    "[Environment]::GetEnvironmentVariable('Path','User')",
  ]);
  const inUserPath = (query.stdout ?? "")
    .split(";")
    .some((entry) => normEntry(entry) === normEntry(binDir));
  if (inUserPath) {
    console.log(`${sym.warn} ${binDir} is in your user PATH but not this session's.`);
    console.log("  restart your terminal, then: unown doctor");
  } else {
    // Append via PowerShell (NEVER setx — it truncates at 1024 chars).
    const appendCmd =
      `[Environment]::SetEnvironmentVariable('Path', ` +
      `[Environment]::GetEnvironmentVariable('Path','User') + ';${psEscape(binDir)}', 'User')`;
    const res = capture("powershell", ["-NoProfile", "-Command", appendCmd]);
    if (res.status === 0) {
      console.log(`${sym.ok} added ${binDir} to your user PATH.`);
      console.log("  restart your terminal (new cmd/PowerShell window), then: unown doctor");
    } else {
      console.log(`${sym.warn} could not update the user PATH (PowerShell exited ${res.status}).`);
      console.log("  add this dir to PATH manually, then restart your terminal:");
      console.log(`      ${binDir}`);
    }
  }
} else {
  // POSIX: warn + the exact profile line to add.
  console.log(`${sym.warn} ${binDir} is not on your PATH.`);
  console.log("  add this line to your shell profile, then restart the shell:");
  console.log(`      export PATH="${binDir}:$PATH"`);
}

console.log("  verify: unown doctor");
