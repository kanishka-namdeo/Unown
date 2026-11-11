#!/usr/bin/env node
/**
 * test-memory-guard.mjs — the H-22 memory-guard's deterministic paired
 * test suite (the heading-exactness refinement's GATE measure; the 35th
 * lineage's recycle-test edge, 2026-11-07).
 *
 * Hermetic: each case builds a throwaway git repo carrying a fixture
 * .unown/memory/project.md, mutates the worktree file, and runs the
 * guard's --check against that cwd with A1_HOME pointed at a temp ring.
 * Zero network, zero engine, zero writes outside the temp dirs.
 *
 * The paired A/B law: against the PRE-refinement guard, case 1 FAILS
 * (the append-only heading rename passes clean — the blind spot);
 * against the refined guard all cases pass. Run the BEFORE arm with
 *   node scripts/a1/test-memory-guard.mjs --guard /tmp/guard-before.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
let guardPath = join(import.meta.dirname, "memory-guard.mjs");
if (args[0] === "--guard") guardPath = args[1];

const FIXTURE = `## Known pitfalls
- a plain pitfall bullet

## Environment
- the e2e config boots serve.mjs with default env

## Facts
- a plain fact bullet

## Manual notes

- Failed cycles auto-recover — do NOT restart engine to fix them. (Restored by hand 2026-11-07; this Manual notes lane is its durable home.)
- Second durable note.
`;

function git(cwd, ...a) {
  // timeout is MILLISECONDS in execFileSync (the 30-ms flake class caught
  // while debugging this very suite — 30 read as seconds is a Pythonism)
  execFileSync("git", a, { cwd, encoding: "utf8", timeout: 30_000 });
}

function fixtureRepo(tmp, name, mutate) {
  const repo = join(tmp, name);
  mkdirSync(join(repo, ".unown", "memory"), { recursive: true });
  git(repo, "init", "-b", "main");
  writeFileSync(join(repo, ".unown", "memory", "project.md"), FIXTURE);
  git(repo, "add", "-A");
  git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "base");
  mutate(join(repo, ".unown", "memory", "project.md"));
  return repo;
}

const CASES = [
  ["1-flag-append-only-heading-rename", (p) => {
    // the blind spot: rename ## Environment -> ## EnvironmentX (the old
    // line is a substring of the new — the pre-refinement guard read a move)
    let s = read(p); write(p, s.replace("## Environment", "## EnvironmentX"));
  }, 1, "an append-only rename of a landing-quoted heading flags (the quoted bytes changed)"],
  ["2-flag-durable-bullet-deletion", (p) => {
    let s = read(p); write(p, s.replace("- Failed cycles auto-recover — do NOT restart engine to fix them. (Restored by hand 2026-11-07; this Manual notes lane is its durable home.)\n", ""));
  }, 1, "the real #46 class — a whole durable-bullet deletion — still flags"],
  ["3-pass-legit-heading-relocation", (p) => {
    // the move class preserved: the heading line still exists verbatim elsewhere
    let s = read(p);
    s = s.replace("## Environment\n", "");
    s = s.replace("## Facts\n", "## Environment\n## Facts\n");
    write(p, s);
  }, 0, "a true relocation (the exact line re-present) passes — the move class preserved"],
  ["4-pass-clean-diff", (p) => {
    let s = read(p); write(p, s + "- a harmless new fact bullet\n");
  }, 0, "an addition-only diff passes clean"],
];

// CodeQL js/unnecessary-use-of-cat (alert #89, the 2026-11-11 Recital
// dependency-hygiene round): spawning `cat` to read a file is the flagged
// pattern — a direct readFileSync is the same bytes with no child process.
function read(p) { return readFileSync(p, "utf8"); }
function write(p, s) { writeFileSync(p, s); }

let pass = 0, fail = 0;
const tmp = mkdtempSync(join(tmpdir(), "h22-guard-"));
const ring = join(tmp, "ring");
try {
  for (const [name, mutate, expected, what] of CASES) {
    const repo = fixtureRepo(tmp, name, mutate);
    let rc = 0, err = "";
    try {
      execFileSync("node", [guardPath, "--check"], {
        cwd: repo, encoding: "utf8", timeout: 30_000,
        env: { ...process.env, A1_HOME: ring },
      });
    } catch (e) {
      rc = e.status ?? 1;
      err = (e.stderr ?? String(e)).split("\n").filter(Boolean).slice(0, 2).join(" | ");
    }
    const ok = rc === expected;
    pass += ok; fail += !ok;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}: rc=${rc} expected=${expected} — ${what}`
      + (ok ? "" : `\n      guard said: ${err}`));
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} pass / ${fail} fail`
  + (fail === 0 ? "  — the heading refinement holds, the move class preserved"
                : "  — RED: the append-only rename blind spot is LIVE"));
process.exit(fail ? 1 : 0);
