/**
 * The file-backed JSON store for Nocturne (the fugue store pattern).
 * Single document at `data/nocturne/state.json`, atomic writes,
 * in-memory cache, structural reseed.
 *
 * The store is the ONLY I/O owner in the domain layer: every engine
 * module (dedup / correlate / escalation / incident / …) is pure
 * over the state shape; this module loads, persists, and mints ids.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { NocturneState } from "./types";
import { seedNocturne } from "./seed";
import { newId } from "./ids";

const DATA_DIR = join(process.cwd(), "data", "nocturne");
const STATE_FILE = join(DATA_DIR, "state.json");

/** The nocturne store's state version (mismatch → reseed). */
export const STATE_VERSION = 1;

let state: NocturneState | null = null;

function dataPath(): string {
  return STATE_FILE;
}

/**
 * Structural validation for a parsed state document. JSON-parse +
 * version checks catch byte-level and versioned corruption; a file
 * that is valid JSON carrying the current version with a mangled shape
 * must reseed — the store never serves shape-corrupt state
 * (the "never throws" invariant).
 */
function isValidState(s: unknown): s is NocturneState {
  if (typeof s !== "object" || s === null || Array.isArray(s)) return false;
  const o = s as Record<string, unknown>;
  const arrays = [
    "tenants",
    "users",
    "memberships",
    "services",
    "rotations",
    "overrides",
    "alerts",
    "incidents",
    "timeline",
    "notes",
    "runbooks",
    "checklists",
    "components",
    "postmortems",
    "invites",
    "audit",
    "sessions",
  ] as const;
  for (const key of arrays) {
    if (!Array.isArray(o[key])) return false;
  }
  return typeof o.seq === "number" && o.version === 1;
}

function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, path); // POSIX atomic rename
}

function reseed(): NocturneState {
  const s = seedNocturne();
  state = s;
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeAtomic(STATE_FILE, JSON.stringify(s, null, 2));
  return s;
}

/**
 * Load (or lazily reseed) the state. `loadState` / `saveState` /
 * `nextId` / `resetState` are the store's four pinned surfaces:
 *  - missing file → reseed;
 *  - corrupt JSON → reseed (never throws);
 *  - version mismatch → reseed (the embed-reset pattern);
 *  - valid JSON + current version but structurally mangled → reseed.
 */
export function loadState(): NocturneState {
  if (state) return state;
  const p = dataPath();
  if (!existsSync(p)) {
    return reseed();
  }
  try {
    const raw = readFileSync(p, "utf-8");
    const parsed: NocturneState = JSON.parse(raw);
    if (parsed.version !== STATE_VERSION) {
      return reseed();
    }
    if (!isValidState(parsed)) {
      return reseed();
    }
    state = parsed;
    return state;
  } catch {
    return reseed();
  }
}

/**
 * Persist the in-memory state atomically (write-to-tmp + rename).
 * The read-modify-write cycle of every store mutation lives inside
 * one `loadState()` + `saveState()` pair — the dedup race's
 * mitigation (risk list P1).
 */
export function saveState(): void {
  if (!state) throw new Error("loadState() not called before saveState()");
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeAtomic(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Generate the next deterministic id: `nc_${prefix}_${seq}` (the
 * plan's live-row id scheme; increments and persists the `seq`
 * counter so a replayed store replays the same id stream).
 */
export function nextId(prefix: string): string {
  const s = loadState();
  const id = newId(prefix, s.seq);
  s.seq += 1;
  saveState();
  return id;
}

/**
 * The full read-modify-write: mutate the state under the store lock
 * (a synchronous in-memory operation followed by an atomic persist).
 * The engine's atomic ingest path — one `transaction` call performs
 * dedup + correlate + incident-create as a single atomic unit.
 */
export function transaction(mutate: (s: NocturneState) => NocturneState): NocturneState {
  const s = loadState();
  state = mutate(s);
  saveState();
  return state;
}

/** Clear only the in-memory cache (the on-disk document is preserved). */
export function _resetCacheForTests(): void {
  state = null;
}

/** Reset to a fresh seed (used by tests / the demo-reset route). */
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
