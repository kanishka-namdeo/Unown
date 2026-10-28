import type { CadenceState, CheckoffDate, Habit } from "./types";

/**
 * Deterministic seed for the Cadence habit & streak tracker. Client and any
 * server-side consumer import the same function, so both sides agree (brief
 * § domain layer). No `Math.random`, no `Date.now()` — the clock is taken
 * as an explicit `now` parameter and the RNG is a fixed-seed mulberry32.
 */

/** True when a habit id belongs to the deterministic seed. */
export function isSeededHabitId(id: string): boolean {
  return SEED_HABIT_IDS.has(id);
}

const SEED_HABIT_IDS = new Set<string>([
  "hab-daily-water",
  "hab-daily-reading",
  "hab-daily-stretch",
  "hab-weekly-gym",
  "hab-weekly-meditation",
  "hab-weekly-journal",
]);

/** mulberry32 — a tiny deterministic PRNG (fixed integer seed). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED_INTEGER = 0x9d1c6c53; // stable fixed integer seed

interface SeedHabit {
  id: string;
  name: string;
  glyph: string;
  frequency: Habit["frequency"];
  /** 0..1 probability a day counts */
  p: number;
}

const SEED_HABITS: SeedHabit[] = [
  { id: "hab-daily-water", name: "Drink 8 glasses of water", glyph: "💧", frequency: { kind: "daily" }, p: 0.85 },
  { id: "hab-daily-reading", name: "Read 20 pages", glyph: "📖", frequency: { kind: "daily" }, p: 0.7 },
  { id: "hab-daily-stretch", name: "Morning stretch", glyph: "🧘", frequency: { kind: "daily" }, p: 0.6 },
  { id: "hab-weekly-gym", name: "Gym sessions", glyph: "🏋️", frequency: { kind: "weekly", target: 3 }, p: 0.45 },
  { id: "hab-weekly-meditation", name: "Meditation", glyph: "🪷", frequency: { kind: "weekly", target: 2 }, p: 0.55 },
  { id: "hab-weekly-journal", name: "Journal", glyph: "✍️", frequency: { kind: "weekly", target: 1 }, p: 0.75 },
];

const SEED_DAYS_BACK = 270; // ~9 months

/** Format a local Date to a YYYY-MM-DD day key. */
function dayKey(d: Date): CheckoffDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Build the deterministic seeded state: 6 habits plus ~9 months of checkoff
 * history. `now` is the explicit clock; the walk is anchored to its local
 * midnight, so no seeded day is ever in the future.
 */
export function seedCadence(now: Date = new Date()): CadenceState {
  const rand = mulberry32(SEED_INTEGER);
  const entries: Record<string, CheckoffDate[]> = {};

  // A stable local-midnight anchor, then walk back SEED_DAYS_BACK days.
  const anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (const h of SEED_HABITS) {
    const list: CheckoffDate[] = [];
    for (let i = SEED_DAYS_BACK; i >= 0; i--) {
      // Walk back from the local-midnight anchor; never a future date.
      const d = new Date(anchor);
      d.setDate(d.getDate() - i);
      if (rand() < h.p) list.push(dayKey(d));
    }
    entries[h.id] = list;
  }

  const habits: Habit[] = SEED_HABITS.map((h) => ({
    id: h.id,
    name: h.name,
    glyph: h.glyph,
    frequency: h.frequency,
    createdAt: dayKey(new Date(anchor.getFullYear(), anchor.getMonth(), 1)),
  }));

  return { habits, entries, theme: "dark" };
}
