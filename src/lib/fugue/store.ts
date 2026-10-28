/**
 * Fugue file-backed JSON store.
 * Single document at data/fugue/state.json, atomic writes, in-memory cache.
 * PLAN.md §4.
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FugueState, Run } from "./types";
import { SEED_VERSION, seedState } from "./seed";

const DATA_DIR = join(process.cwd(), "data", "fugue");
const STATE_FILE = join(DATA_DIR, "state.json");

/** Retention: latest N runs per workspace. */
export const RUN_RETENTION = 50;

let state: FugueState | null = null;

function dataPath(): string {
  return STATE_FILE;
}

/**
 * Structural validation for a parsed state document. JSON-parse + version
 * checks catch byte-level and versioned corruption, but a file that is valid
 * JSON carrying the current version with a mangled shape (e.g. `runs` not an
 * array, missing `seq`) would otherwise be served as-is and crash downstream
 * (retainRuns/stats). Any such document must reseed, matching the store's
 * "never throws" invariant.
 */
function isValidState(s: unknown): s is FugueState {
  if (typeof s !== "object" || s === null || Array.isArray(s)) return false;
  const o = s as Record<string, unknown>;
  return (
    Array.isArray(o.workspaces) &&
    Array.isArray(o.flows) &&
    Array.isArray(o.runs) &&
    Array.isArray(o.users) &&
    typeof o.sessions === "object" &&
    o.sessions !== null &&
    !Array.isArray(o.sessions) &&
    typeof o.seq === "number" &&
    o.runs.every((r) => {
      const rr = r as Record<string, unknown>;
      return typeof rr.id === "string" && typeof rr.startedAt === "string";
    })
  );
}

function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, path); // POSIX atomic rename
}

function reseed(): FugueState {
  const s = seedState();
  state = s;
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeAtomic(STATE_FILE, JSON.stringify(s, null, 2));
  return s;
}

export function loadState(): FugueState {
  if (state) return state;
  const p = dataPath();
  if (!existsSync(p)) {
    return reseed();
  }
  try {
    const raw = readFileSync(p, "utf-8");
    const parsed: FugueState = JSON.parse(raw);
    if (parsed.version !== SEED_VERSION) {
      // Seed-version mismatch → discard and reseed (embed reset pattern).
      return reseed();
    }
    if (!isValidState(parsed)) {
      // Valid JSON + current version but structurally mangled → reseed so the
      // store never serves shape-corrupt state (never-throws invariant).
      return reseed();
    }
    // Retention is enforced on writes (appendRun); re-apply it on boot so a
    // legacy document that already exceeds the retention cap converges
    // immediately rather than on the first write after boot.
    state = { ...parsed, runs: retainRuns(parsed.runs) };
    return state;
  } catch {
    // Corrupt JSON → reseed (the "never throws" rule).
    return reseed();
  }
}

export function saveState(): void {
  if (!state) throw new Error("loadState() not called before saveState()");
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeAtomic(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Retain latest N runs per workspace (pure helper).
 * Ordering is by startedAt; ties break on id for determinism.
 */
export function retainRuns(runs: Run[]): Run[] {
  const byWs = new Map<string, Run[]>();
  for (const r of runs) {
    const arr = byWs.get(r.workspaceId) ?? [];
    arr.push(r);
    byWs.set(r.workspaceId, arr);
  }
  const kept: Run[] = [];
  for (const [, arr] of byWs) {
    // Sort newest-first, keep top N, then re-flatten (order stable per ws).
    arr.sort(
      (a, b) =>
        b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id),
    );
    kept.push(...arr.slice(0, RUN_RETENTION));
  }
  // Restore deterministic global ordering: by startedAt asc, then id asc.
  kept.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  return kept;
}

/** Append a run and apply retention. Mutates the in-memory state. */
export function appendRun(run: Run): void {
  const s = loadState();
  s.runs = [...s.runs, run];
  s.runs = retainRuns(s.runs);
  saveState();
}

/**
 * Generate the next deterministic id: `${prefix}_${seq}`.
 * Increments and persists the seq counter.
 */
export function nextId(prefix: string): string {
  const s = loadState();
  const id = `${prefix}_${s.seq}`;
  s.seq += 1;
  saveState();
  return id;
}

/**
 * Clear only the in-memory cache (the on-disk state.json is preserved).
 * Test-only hook: lets tests rewrite the on-disk document and then force
 * `loadState()` to re-read it, pinning the read-path logic (schema
 * validation, read-time retention) without clobbering the file the way
 * `resetState()` does. Not used in production code paths.
 */
export function _resetCacheForTests(): void {
  state = null;
}

/** Reset to a fresh seed (used by tests / embed reset). */
export function resetState(): void {
  state = null;
  try {
    if (existsSync(STATE_FILE)) {
      unlinkSync(STATE_FILE);
    }
  } catch {
    /* best-effort */
  }
  loadState();
}
