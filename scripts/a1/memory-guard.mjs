#!/usr/bin/env node
/**
 * memory-guard — the H-22 dream-render diff log + close-gate flag
 * (operator tooling; registry row docs/a1-augmentation-registry.md H-22).
 *
 * Landed 2026-11-07 by the thirty-first lineage at the NINTH #46
 * occurrence (the second ENTIRE durable-lane loss in one day — the
 * class the row predicted). The design, encoded from the row:
 *
 * - Every memory re-render keeps a unified diff (ring buffer, last
 *   N=16, operator-side at .a1/memory-diffs/) — the log lane.
 * - The standing close gate gains a one-line check: a diff that
 *   deletes ANY landing-quoted line flags BEFORE commit — the flag
 *   lane. AutoDream is untouched (the render itself is never gated);
 *   the flag fires at the operator's commit boundary.
 *
 * Usage:
 *   node scripts/a1/memory-guard.mjs --check    # the close gate (exit 1 on a flagged deletion)
 *   node scripts/a1/memory-guard.mjs --record   # just append the current diff to the ring buffer
 *   node scripts/a1/memory-guard.mjs --show     # list the ring buffer
 *
 * The protected set (the landing-quoted lines, per the receipts):
 *   - the '## Environment' and '## Workflow' headings
 *   - ANY line inside the '## Manual notes' durable lane (deletions there are the sixth/ninth-occurrence class)
 *   - any line carrying the landing-quoted markers (loop.tsx, landing-quoted, the claims-gate bullets)
 *
 * Exit codes: 0 clean · 1 flagged (the diff names the deleted lines) · 2 usage.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const A1 = process.env.A1_HOME ?? "/home/z/my-project/.a1";
const RING = join(A1, "memory-diffs");
const RING_N = 16;
const MEMORY_PATH = ".unown/memory/project.md";

const mode = process.argv[2] ?? "--check";
if (!["--check", "--record", "--show"].includes(mode)) {
  console.error("usage: memory-guard.mjs --check | --record | --show");
  process.exit(2);
}

function git(args) {
  return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
}

/** The current worktree diff for the memory file vs HEAD ('' when clean). */
function memoryDiff() {
  try {
    return git(["diff", "HEAD", "--", MEMORY_PATH]);
  } catch {
    return "";
  }
}

/** Is this deleted line protected? (the durable + known-restored set; the
 *  claims gate remains the real arbiter of landing-quoted literals — the
 *  guard protects the DURABLE lane and the receipts' restored lines, not
 *  every line that mentions a component) */
function isProtected(line) {
  const t = line.trim();
  if (t === "") return false;
  // The render's own provenance marker (`<!-- unown: rendered N/M … -->`)
  // is METADATA, not a memory: every render rewrites it, so flagging it
  // would fire on every single commit (the false-positive class caught
  // at the H-24 close, 2026-11-07 — the marker carries the render stats,
  // never a durable line).
  if (t.startsWith("<!--")) return false;
  if (t === "## Environment" || t === "## Workflow" || t === "## Manual notes") return true;
  if (/landing-quoted|claims gate reddens|durable home|issue #46|occurrence receipt/i.test(t)) return true;
  // The durable-lane bullets (their stable first words)
  if (/^-\s*(Failed cycles auto-recover|Stealth verification suite|bin: Cross-platform CLI launcher|Remove unused variable declarations|For high-reliability frontend)/.test(t)) return true;
  return false;
}

function ringAppend(diff) {
  mkdirSync(RING, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(RING, `${ts}.diff`);
  writeFileSync(file, diff);
  // keep the last RING_N
  const files = readdirSync(RING).filter((f) => f.endsWith(".diff")).sort();
  while (files.length > RING_N) rmSync(join(RING, files.shift()));
  return file;
}

if (mode === "--show") {
  if (!existsSync(RING)) { console.log("memory-guard: no diffs recorded yet"); process.exit(0); }
  for (const f of readdirSync(RING).sort()) {
    const head = readFileSync(join(RING, f), "utf8").split("\n").slice(0, 3).join(" | ");
    console.log(`${f}  ${head.slice(0, 120)}`);
  }
  process.exit(0);
}

const diff = memoryDiff();
if (!diff.trim()) {
  console.log("memory-guard: no memory diff — clean");
  process.exit(0);
}

if (mode === "--record") {
  const f = ringAppend(diff);
  console.log(`memory-guard: recorded ${f}`);
  process.exit(0);
}

// --check: flag protected deletions BEFORE the commit
const deleted = [];
let inManualNotes = false;
// A deleted line that still EXISTS in the new file is a MOVE, not a
// deletion (the Environment heading's durable-home relocation class) —
// the guard never flags a move.
// The heading refinement (the 35th lineage's recycle-test edge, 2026-11-07):
// the three protected headings match EXACTLY (trimmed line equality) —
// their literal bytes are landing-quoted (loop.tsx:129 quotes "##
// Environment"), so an append-only rename (## Environment ->
// ## EnvironmentX) changes the quoted bytes without deleting a line,
// and the substring form read that as a "move" (verified live: the
// rename passed clean). Bullets keep the tolerant substring form (a
// render may reflow their whitespace; their content is the identity).
const HEADING_EXACT = new Set(["## Environment", "## Workflow", "## Manual notes"]);
let newText = "";
try { newText = readFileSync(join(process.cwd(), MEMORY_PATH), "utf8"); } catch { /* absent */ }
const moved = (line) => {
  const t = line.trim();
  if (t === "") return false;
  if (HEADING_EXACT.has(t)) {
    return newText.split("\n").some((l) => l.trim() === t);
  }
  return newText.includes(t);
};
for (const line of diff.split("\n")) {
  if (line.startsWith("@@") || line.startsWith("diff ") || line.startsWith("index ")) continue;
  if (line.startsWith("+")) {
    if (line.slice(1).trim() === "## Manual notes") inManualNotes = true;
    continue;
  }
  if (line.startsWith("-")) {
    const body = line.slice(1);
    if (body.trim() === "## Manual notes") { inManualNotes = false; continue; }
    // a section END is the next heading line — but in a unified diff we cannot
    // see forward reliably; treat Manual-notes-body deletions as protected
    // whenever the last Manual-notes marker seen is still in force and no new
    // heading appeared since (handled below).
    if (inManualNotes) {
      // The render's provenance marker (`<!-- unown: rendered … -->`) rides
      // at the file tail after the Manual-notes section — metadata, never a
      // note bullet (the false-positive class caught at the H-24 close).
      if (!moved(body) && !body.trim().startsWith("<!--")) deleted.push(body);
    }
    else if (isProtected(body) && !moved(body)) deleted.push(body);
  } else if (line.startsWith(" ")) {
    if (line.trim() === "## Manual notes") inManualNotes = true;
    // any other heading ends the Manual-notes body
    else if (/^ ## /.test(line)) inManualNotes = false;
  }
}

if (deleted.length > 0) {
  const f = ringAppend(diff);
  console.error(`memory-guard: FLAGGED — the diff deletes ${deleted.length} protected line(s) (the #46 class; the render is untouched, the COMMIT is gated):`);
  for (const d of deleted.slice(0, 12)) console.error(`  - ${d.slice(0, 140)}`);
  console.error(`memory-guard: diff preserved at ${f}`);
  console.error("memory-guard: restore the durable lane before committing (see the receipts' hand-restore pattern), or pass --record to log without gating.");
  process.exit(1);
}

ringAppend(diff);
console.log("memory-guard: clean — no protected deletions (diff recorded)");
process.exit(0);
