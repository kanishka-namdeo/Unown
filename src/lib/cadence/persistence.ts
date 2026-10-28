import { seedCadence } from "./seed";
import type { CadenceState, CheckoffDate, Habit, HabitFrequency } from "./types";

/**
 * localStorage persistence for the Cadence habit tracker. SSR-safe: no
 * `window`/`localStorage` access at import time — every touch is guarded.
 * Mirrors the sigil-bazaar persistence pattern (brief § domain layer).
 */

export const STORAGE_KEY = "cadence:v1";
export const SEED_VERSION_KEY = "cadence:seedVersion";

/** Bump when the demo data changes and every visitor should see the new seed. */
export const SEED_VERSION = 1;

/** True when a day key is a well-formed local `YYYY-MM-DD`. */
function isDayKey(v: unknown): v is CheckoffDate {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** Coerce an unknown value into a valid HabitFrequency, or null to drop. */
function normalizeFrequency(v: unknown): HabitFrequency | null {
  if (v === "daily") return { kind: "daily" };
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    if (o.kind === "weekly" && typeof o.target === "number" && Number.isFinite(o.target)) {
      const t = Math.max(1, Math.min(7, Math.round(o.target)));
      return { kind: "weekly", target: t };
    }
    if (o.kind === "daily") return { kind: "daily" };
  }
  return null;
}

/** Coerce a raw persisted habit into a valid one, or null to drop it. */
function normalizeHabit(v: unknown): Habit | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return null;
  const name = typeof o.name === "string" ? o.name : "";
  const glyph = typeof o.glyph === "string" ? o.glyph : "";
  const frequency = normalizeFrequency(o.frequency);
  if (!frequency) return null;
  const createdAt = isDayKey(o.createdAt) ? (o.createdAt as CheckoffDate) : "1970-01-01";
  return { id: o.id, name, glyph, frequency, createdAt };
}

/** Coerce raw persisted entries into a clean Records map. */
function normalizeEntries(
  habits: Habit[],
  raw: unknown,
): Record<string, CheckoffDate[]> {
  const byId = new Set(habits.map((h) => h.id));
  const out: Record<string, CheckoffDate[]> = {};
  for (const h of habits) out[h.id] = [];
  if (typeof raw !== "object" || raw === null) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!byId.has(k)) continue;
    if (!Array.isArray(v)) continue;
    out[k] = v.filter(isDayKey).sort();
  }
  return out;
}

/**
 * Deterministic starting state — shared by client hydration and any API.
 * The clock defaults to the real `now` but is overridable for tests.
 */
export function seedState(now: Date = new Date()): CadenceState {
  return seedCadence(now);
}

/** Fallback used on missing / corrupt / stale stored state. */
function fallback(now: Date = new Date()): CadenceState {
  const s = seedCadence(now);
  saveState(s);
  return s;
}

/** True when the stored state was seeded by a DIFFERENT build. */
function hasStaleSeedVersion(): boolean {
  try {
    const v = localStorage.getItem(SEED_VERSION_KEY);
    return v !== null && v !== String(SEED_VERSION);
  } catch {
    return false;
  }
}

/** Tag the current storage with the seed version in force. */
function markSeedVersion(): void {
  try {
    localStorage.setItem(SEED_VERSION_KEY, String(SEED_VERSION));
  } catch {
    /* noop */
  }
}

/**
 * Wipe every persisted key the app owns — the state, the seed-version tag.
 * The next loadState() then takes the first-load path (fresh seed). Powers
 * the embed reset channel so every visitor is one click from pristine.
 */
export function wipeCadenceStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SEED_VERSION_KEY);
  } catch {
    /* noop */
  }
}

/**
 * Read and normalize stored state. Corrupt or unknown data never throws —
 * it falls back to the deterministic seed (brief § domain layer).
 * Missing `localStorage` (SSR / non-browser) returns the pure seed.
 */
export function loadState(now: Date = new Date()): CadenceState {
  if (typeof localStorage === "undefined") return seedCadence(now);
  let raw: string;
  try {
    raw = localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return fallback(now);
  }
  if (!raw || hasStaleSeedVersion()) return fallback(now);
  markSeedVersion();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback(now);
  }
  const obj =
    typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};

  const habits: Habit[] = Array.isArray(obj.habits)
    ? (obj.habits.map(normalizeHabit).filter((h): h is Habit => h !== null))
    : [];

  const entries = normalizeEntries(habits, obj.entries);
  const theme = obj.theme === "light" ? "light" : "dark";
  return { habits, entries, theme };
}

/** Persist the full state (never throws — silent on quota / security errors). */
export function saveState(state: CadenceState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        habits: state.habits,
        entries: state.entries,
        theme: state.theme,
      }),
    );
  } catch {
    // storage full or blocked — app stays usable in-memory
  }
}
