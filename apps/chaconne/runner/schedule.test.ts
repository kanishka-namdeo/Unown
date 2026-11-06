/**
 * Schedule-loop tests — the C-4 battery (PLAN §1 "run-history dedup";
 * PRD P0 #3 + edge case 6: the misfire policy "skip-and-record, never
 * silent-double-run").
 *
 * The loop is tested against a TEMP data dir + the fake executor
 * lane (the fake page adapter over the named fixture tables, the
 * same `--fake` set the CLI uses). Every clock is INJECTED (a number
 * + an ISO string) — no real timers, no Date.now() in the test path:
 *
 *   1. a due recipe runs ONCE and nextDue advances (the fire + state
 *      advance persists through the disk store);
 *   2. a misfired due records the skip (ONE run record, nextDue
 *      jumps forward — no catch-up storm);
 *   3. the same due never double-runs THROUGH A RESTART (a fresh
 *      store re-read + a second tick at the same instant fires 0
 *      times — the dedup law, acceptance (6));
 *   4. a one-shot retires after firing (the schedule disappears from
 *      the recipe doc on disk).
 */
import { test, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runScheduleTick, tickSchedule } from "./schedule.js";
import { ChaconneDiskStore } from "./store.js";
import type { Recipe, Schedule } from "../src/domain/types.js";

const P = 60_000; // 1 minute
const NOW = 1_760_000_000_000; // a fixed "wall" instant (injected)
const iso = (ms: number) => new Date(ms).toISOString();
const T0 = iso(NOW + P); // the first due

/** A minimal recipe that runs cleanly on the fake table (one goto). */
function mkRecipe(id: number, schedule: Schedule): Recipe {
  return {
    id,
    name: `rec-${id}`,
    version: 1,
    steps: [{ id: 100 + id, kind: "goto", selector: "about:blank" }],
    schedule,
  };
}

function intervalSched(nextDueIso: string, extra: Partial<Schedule> = {}): Schedule {
  return { kind: "interval", everyMs: P, nextDueIso, ...extra };
}

function oneShotSched(nextDueIso: string, extra: Partial<Schedule> = {}): Schedule {
  return { kind: "one-shot", nextDueIso, ...extra };
}

/** Seed a fresh temp data dir with one recipe doc (via the store). */
function seed(dataDir: string, recipe: Recipe): ChaconneDiskStore {
  const store = new ChaconneDiskStore(dataDir);
  store.recover();
  store.saveRecipe(recipe, JSON.stringify(recipe));
  return store;
}

function freshDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chaconne-sched-"));
}

const fakeOpts = (dataDir: string, nowMs: number) => ({
  dataDir,
  fake: true,
  nowMs: () => nowMs,
  nowIso: () => iso(nowMs),
});

// ─── 1. a due recipe runs once; nextDue advances ─────────────────────

test("fire: a due interval recipe runs once and nextDue advances", async () => {
  const dir = freshDir();
  try {
    const store = seed(dir, mkRecipe(1, intervalSched(T0)));
    const tick = await tickSchedule(store.loadRecipes()[0], fakeOpts(dir, NOW + P));
    expect(tick.fired).toBe(true);
    expect(tick.skip).toBeNull();
    expect(tick.run?.status).toBe("ok");
    // The state advanced: nextDue is one period past the anchor.
    expect(tick.nextSchedule?.nextDueIso).toBe(iso(NOW + 2 * P));
    expect(tick.nextSchedule?.lastFiredIso).toBe(iso(NOW + P)); // the due instant
    // And it persisted to disk: a fresh store read sees the new state.
    const re = new ChaconneDiskStore(dir);
    re.recover();
    const onDisk = re.loadRecipes().find((r) => r.id === 1)!;
    expect(onDisk.schedule?.nextDueIso).toBe(tick.nextSchedule?.nextDueIso);
    expect(onDisk.schedule?.lastFiredIso).toBe(iso(NOW + P));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 2. a misfired due records the skip; nextDue jumps; no storm ────

test("misfire: a sleep gap records ONE skip and jumps nextDue forward", async () => {
  const dir = freshDir();
  try {
    const store = seed(dir, mkRecipe(1, intervalSched(T0)));
    // 5 periods of sleep past the due → misfire (now − due = 5P > P).
    const tick = await tickSchedule(store.loadRecipes()[0], fakeOpts(dir, NOW + 6 * P));
    expect(tick.fired).toBe(false);
    expect(tick.skip?.reason).toBe("misfire");
    expect(tick.run).not.toBeNull(); // the skip IS recorded (honest history)
    // nextDue jumped to the first period boundary strictly after now:
    // NOW + 7P.
    expect(tick.nextSchedule?.nextDueIso).toBe(iso(NOW + 7 * P));
    // On disk: the state advanced, and a tick at the new due fires
    // exactly once — NO catch-up storm of the 5 missed periods.
    const re = new ChaconneDiskStore(dir);
    re.recover();
    const nextDueMs = new Date(re.loadRecipes().find((r) => r.id === 1)!.schedule!.nextDueIso!).getTime();
    const fires = await runScheduleTick(fakeOpts(dir, nextDueMs));
    expect(fires.filter((f) => f.fired).length).toBe(1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 3. the same due never double-runs through a restart ────────────

test("dedup: a restart re-deciding the same fired due fires 0 times", async () => {
  const dir = freshDir();
  try {
    const store = seed(dir, mkRecipe(1, intervalSched(T0)));
    // First boot: the due fires once (state advances, persists).
    const first = await tickSchedule(store.loadRecipes()[0], fakeOpts(dir, NOW + P));
    expect(first.fired).toBe(true);

    // RESTART: a brand-new store over the same dir (the dedup-through-
    // restart law, acceptance (6)). Re-decide at the SAME instant the
    // first boot decided: the due is now ≤ lastFiredIso → no-op.
    const store2 = new ChaconneDiskStore(dir);
    store2.recover();
    const recipe2 = store2.loadRecipes().find((r) => r.id === 1)!;
    const second = await tickSchedule(recipe2, fakeOpts(dir, NOW + P));
    // After the fire, the persisted state's due (T0+2P) is P into the
    // future at the re-decide instant → a not-due no-op (no skip).
    expect(second.fired).toBe(false);
    expect(second.skip).toBeNull();
    expect(second.run).toBeNull(); // no second run record for the same due
    // The store gained exactly ONE run record from the original fire.
    const runs = store2.loadRuns();
    expect(runs.length).toBe(1);
    expect(runs[0].id).toBe(first.run!.id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The explicit DEDUP pin (acceptance 6): a crash that persists the
// lastFiredIso WITHOUT the advanced nextDue must not let the old due
// fire twice on boot. The dedup no-op records nothing and leaves the
// state untouched (the loop advances it on the next tick).
test("dedup: a stale due with lastFiredIso set is a recorded no-op, never a re-fire", async () => {
  const dir = freshDir();
  try {
    // Simulate the crash-persistence window: the fire recorded
    // lastFiredIso but the nextDue advance was NOT persisted.
    const crashed = mkRecipe(1, intervalSched(T0, { lastFiredIso: T0 }));
    const store = seed(dir, crashed);
    const tick = await tickSchedule(store.loadRecipes()[0], fakeOpts(dir, NOW + P));
    expect(tick.fired).toBe(false); // the old due T0 cannot fire twice
    expect(tick.skip?.reason).toBe("interval-already-fired");
    expect(tick.run).toBeNull(); // the dedup records nothing new
    // And the advanced state comes back on a LATER tick — no lost
    // progress, no double fire.
    const store2 = new ChaconneDiskStore(dir);
    store2.recover();
    const later = await tickSchedule(
      store2.loadRecipes().find((r) => r.id === 1)!,
      fakeOpts(dir, NOW + 3 * P),
    );
    expect(later.fired).toBe(true); // the due at T0+3P fires exactly once
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 4. a one-shot retires after firing ──────────────────────────────

test("one-shot: fires once and retires (the schedule leaves the recipe)", async () => {
  const dir = freshDir();
  try {
    const store = seed(dir, mkRecipe(1, oneShotSched(T0)));
    const tick = await tickSchedule(store.loadRecipes()[0], fakeOpts(dir, NOW + P));
    expect(tick.fired).toBe(true);
    expect(tick.nextSchedule).toBeNull(); // retired
    const onDisk = new ChaconneDiskStore(dir);
    onDisk.recover();
    const recipe = onDisk.loadRecipes().find((r) => r.id === 1)!;
    expect(recipe.schedule).toBeUndefined(); // retired on disk
    // And re-ticking a retired recipe is a no-op (unscheduled).
    const again = await tickSchedule(recipe, fakeOpts(dir, NOW + 2 * P));
    expect(again.fired).toBe(false);
    expect(again.run).toBeNull();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 5. the whole-store entry point: multiple schedules, one pass ──

test("runScheduleTick: ticks every scheduled recipe in one pass", async () => {
  const dir = freshDir();
  try {
    const s = seed(dir, mkRecipe(1, intervalSched(T0)));
    s.saveRecipe(mkRecipe(2, oneShotSched(T0)), JSON.stringify(mkRecipe(2, oneShotSched(T0))));
    const out = await runScheduleTick(fakeOpts(dir, NOW + P));
    expect(out.map((o) => o.recipeId)).toEqual([1, 2]);
    expect(out[0].fired).toBe(true);
    expect(out[1].fired).toBe(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
