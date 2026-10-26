/**
 * Bench-owned acceptance helpers (benchmarks/longrun/acceptance).
 * These files are NOT part of the agent workspace during a session; the
 * runner copies them into <workspace>/tests/acceptance/ at scoring time
 * and removes them afterwards.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "..", ".."); // the fixture workspace root
export const CLI = join(ROOT, "src", "cli.ts");

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Fresh isolated state dir (.ledger/ lands here), CLI from the workspace. */
export function state(): string {
  return mkdtempSync(join(tmpdir(), "acc-"));
}

export function cli(args: string[], cwd: string): CliResult {
  const r = spawnSync("bun", [CLI, ...args], { cwd, encoding: "utf8", timeout: 30_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function read(cwd: string, rel: string): string {
  return readFileSync(join(cwd, rel), "utf8");
}

export function readJson(cwd: string, rel: string): any {
  return JSON.parse(read(cwd, rel));
}

export function writeJson(cwd: string, rel: string, data: any): void {
  mkdirSync(join(cwd, ".ledger"), { recursive: true });
  writeFileSync(join(cwd, rel), JSON.stringify(data, null, 2) + "\n");
}

export function exists(cwd: string, rel: string): boolean {
  return existsSync(join(cwd, rel));
}
