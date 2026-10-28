/**
 * Aria file-backed JSON store.
 * Single document at data/aria/state.json, atomic writes, in-memory cache.
 * benchmarks/aria-round/plan.md §2 (the fugue store pattern).
 *
 * Retention: the simulated mailbox is capped at the latest
 * `MAILBOX_RETENTION` messages PER TENANT (risk list item 10) —
 * older messages are pruned on every write.
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
import type { AriaMailboxMessage, AriaState } from "./types";
import { seedAria } from "./seed";

const DATA_DIR = join(process.cwd(), "data", "aria");
const STATE_FILE = join(DATA_DIR, "state.json");

/** The aria store's state version (mismatch → reseed). */
export const STATE_VERSION = 1;

/** Retention: latest N mailbox messages per tenant. */
export const MAILBOX_RETENTION = 100;

let state: AriaState | null = null;

function dataPath(): string {
  return STATE_FILE;
}

/**
 * Structural validation for a parsed state document. A file that is
 * valid JSON carrying the current version with a mangled shape must
 * reseed — the store never serves shape-corrupt state (the
 * "never throws" invariant).
 */
function isValidState(s: unknown): s is AriaState {
  if (typeof s !== "object" || s === null || Array.isArray(s)) return false;
  const o = s as Record<string, unknown>;
  const arrays: Array<[keyof AriaState, string]> = [
    ["tenants", "tenants"],
    ["users", "users"],
    ["memberships", "memberships"],
    ["accounts", "accounts"],
    ["contacts", "contacts"],
    ["leads", "leads"],
    ["pipelines", "pipelines"],
    ["deals", "deals"],
    ["activities", "activities"],
    ["tasks", "tasks"],
    ["notes", "notes"],
    ["tags", "tags"],
    ["sequences", "sequences"],
    ["enrollments", "enrollments"],
    ["emailTemplates", "emailTemplates"],
    ["engagementEvents", "engagementEvents"],
    ["mailbox", "mailbox"],
    ["quotas", "quotas"],
    ["forecastSnapshots", "forecastSnapshots"],
    ["sessions", "sessions"],
    ["audit", "audit"],
  ];
  for (const [key] of arrays) {
    if (!Array.isArray(o[key])) return false;
  }
  return typeof o.seq === "number";
}

function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, path); // POSIX atomic rename
}

/**
 * Retain the latest N mailbox messages per tenant (pure helper).
 * Ordering is by `at`; ties break on id for determinism.
 */
export function retainMailbox(messages: AriaMailboxMessage[]): AriaMailboxMessage[] {
  const byTenant = new Map<string, AriaMailboxMessage[]>();
  for (const m of messages) {
    const arr = byTenant.get(m.tenantId) ?? [];
    arr.push(m);
    byTenant.set(m.tenantId, arr);
  }
  const kept: AriaMailboxMessage[] = [];
  for (const [, arr] of byTenant) {
    arr.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    kept.push(...arr.slice(-MAILBOX_RETENTION));
  }
  // Restore deterministic global ordering: by at asc, then id asc.
  kept.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return kept;
}

function reseed(): AriaState {
  const s = seedAria();
  state = s;
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeAtomic(STATE_FILE, JSON.stringify(s, null, 2));
  return s;
}

export function loadState(): AriaState {
  if (state) return state;
  const p = dataPath();
  if (!existsSync(p)) {
    return reseed();
  }
  try {
    const raw = readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as AriaState;
    if (parsed.version !== STATE_VERSION) {
      // Version mismatch → discard and reseed (the embed-reset pattern).
      return reseed();
    }
    if (!isValidState(parsed)) {
      // Valid JSON + current version but structurally mangled → reseed.
      return reseed();
    }
    // Retention is enforced on writes; re-apply on boot so a legacy
    // document that already exceeds the cap converges immediately.
    state = { ...parsed, mailbox: retainMailbox(parsed.mailbox) };
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

/** Clear only the in-memory cache (the on-disk document is preserved). */
export function _resetCacheForTests(): void {
  state = null;
}

/** Reset to a fresh seed (used by tests / the embed reset route). */
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
