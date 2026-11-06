/**
 * Chaconne runner — the schedule loop (C-4; PLAN §1 "schedule loop:
 * one-shot/interval, misfire policy skip-and-record, no catch-up storm;
 * run-history dedup").
 *
 * This module owns the REAL loop over the pure domain decisions
 * (`src/domain/scheduler.ts`):
 *
 *   read the disk store → ask `decideSchedule` with the real clock →
 *   when due, execute via `executeRecipe` → record the run + persist
 *   the schedule state (lastFiredIso/nextDueIso) through the C-1
 *   model functions (`recordSchedule`) → on a misfire, record the
 *   skip and advance nextDue, NEVER a catch-up storm.
 *
 * No new storage mechanisms: runs, recipes and artifacts go through the
 * `ChaconneDiskStore` temp-file + rename-swap atomically, exactly the
 * way `cmdRun` does (NON-OVERLAP: the runner reuses `executeRecipe`
 * and the disk store AS-IS).
 *
 * The dedup law (PLAN §1 row "run-history dedup" + PRD edge case 6):
 * a fired due records ONCE. Firing stamps `lastFiredIso` to the DUE
 * instant (not `nowMs`), so a restart re-deciding the same due is a
 * no-op — the same due never fires twice.
 */
import type { PageAdapter } from "./page-adapter.js";
import { decideSchedule, type ScheduleDecision, type SkipReason } from "../src/domain/scheduler.js";
import { recordSchedule } from "../src/domain/model.js";
import type { ChaconneData, Recipe, RunRecord, Schedule } from "../src/domain/types.js";
import { ChaconneDiskStore } from "./store.js";
import { executeRecipe, setInTick, type ExecutionResult } from "./index.js";

/** One tick of the schedule loop for a single recipe. */
export type TickResult = {
  recipeId: number;
  /** true when a recipe execution ran (fire=true from the decision). */
  fired: boolean;
  /** the skip reason, when the due was skipped (misfire / dedup). */
  skip: { reason: SkipReason } | null;
  /** the run record persisted for this tick (fire OR misfire-skip). */
  run: RunRecord | null;
  /** the schedule state after this tick (null = the one-shot retired). */
  nextSchedule: Schedule | null;
};

export type ScheduleLoopOptions = {
  dataDir?: string;
  /** ISO-8601 clock seam. Default: `new Date().toISOString()`. */
  nowIso?: () => string;
  /** epoch-ms clock seam. Default: `Date.now()`. */
  nowMs?: () => number;
  /** run the recipes with the fake page adapter (the test / unit lane). */
  fake?: boolean;
  baseUrl?: string;
  /**
   * Test seam: a full store snapshot that replaces the disk read for
   * the tick's DECISION (the executor still runs and persists through
   * the real store, so the fake-lane loop stays end-to-end without a
   * pre-populated disk).
   */
  dataOverride?: ChaconneData;
};

const DEFAULT_DATA_DIR = "apps/chaconne/data";

/**
 * Run ONE schedule tick for a single recipe. Reads the store, asks the
 * pure scheduler, and — if due — executes the recipe and persists the
 * resulting run + the advanced schedule state atomically.
 *
 * A not-due tick and a dedup no-op persist nothing (the state is
 * unchanged) and return `run: null`.
 */
export async function tickSchedule(
  recipe: Recipe,
  opts: ScheduleLoopOptions = {},
): Promise<TickResult> {
  const store = new ChaconneDiskStore(opts.dataDir ?? DEFAULT_DATA_DIR);
  store.recover();
  const nowIsoFn = opts.nowIso ?? (() => new Date().toISOString());
  const nowMsFn = opts.nowMs ?? Date.now;
  const data: ChaconneData =
    opts.dataOverride ??
    { schema: "chaconne.v1", recipes: store.loadRecipes(), runs: store.loadRuns() };
  const current = data.recipes.find((r) => r.id === recipe.id);
  if (!current) {
    throw new Error(`tickSchedule: unknown recipe ${recipe.id}`);
  }

  const decision = decideSchedule(current, nowMsFn(), { nowIso: nowIsoFn() });

  // Not due: nothing happens, state carries forward untouched.
  if (decision.fire === false && decision.skip === null) {
    return {
      recipeId: recipe.id,
      fired: false,
      skip: null,
      run: null,
      nextSchedule: decision.next ?? current.schedule ?? null,
    };
  }

  // A misfire skip-and-record: no fire, but the state ADVANCES and the
  // miss is recorded (the no-catch-up-storm pin).
  if (decision.skip !== null && decision.fire === false) {
    let run: RunRecord | null = null;
    if (decision.record !== null) {
      run = persistSkipRecord(store, decision.record);
      // A misfire advances the state: persist it.
      await persistScheduleState(store, current, decision.next, nowIsoFn);
    } else if (decision.skip.reason === "interval-already-fired") {
      // The dedup-heal path: nextDue was advanced past now but nothing
      // was fired — persist the healed state so the next tick sees it.
      await persistScheduleState(store, current, decision.next, nowIsoFn);
    }
    return {
      recipeId: recipe.id,
      fired: false,
      skip: decision.skip,
      run,
      nextSchedule: decision.next ?? current.schedule ?? null,
    };
  }

  // FIRE: execute the recipe via the existing executeRecipe (AS-IS).
  // setInTick(true) prevents re-entrancy through the scheduleHook.
  setInTick(true);
  const adapter: PageAdapter = opts.fake
    ? await makeFakeAdapter()
    : await makeRealAdapter(opts.baseUrl);
  let result: ExecutionResult;
  try {
    result = await executeRecipe(adapter, current, { nowIso: nowIsoFn });
  } finally {
    setInTick(false);
    await (adapter as { close?: () => Promise<void> }).close?.();
  }
  const run = persistFireRecord(store, result, current, nowIsoFn);
  // A fired one-shot retires (next === null) → persist the retirement;
  // an interval fire advances nextDue + lastFiredIso → persist both.
  await persistScheduleState(store, current, decision.next, nowIsoFn);
  return {
    recipeId: recipe.id,
    fired: true,
    skip: null,
    run,
    nextSchedule: decision.next,
  };
}

/**
 * Persist a fired recipe's run record. Assigns the deterministic run
 * id (max+1) and stamps the run with the caller's clock; the run
 * record carries the recipe's CURRENT version (snapshot law, edge 6).
 */
function persistFireRecord(
  store: ChaconneDiskStore,
  result: ExecutionResult,
  recipe: Recipe,
  nowIso: () => string,
): RunRecord {
  const existing = store.loadRuns();
  const runId = existing.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const refs: RunRecord["artifacts"] = [];
  for (const a of result.artifacts) {
    const payload = a.kind === "json" ? JSON.stringify(a.payload, null, 2) : a.payload;
    const hex = store.artifactRef(a.stepIdx, runId, a.ext, payload);
    store.saveArtifact(a.stepIdx, runId, a.ext, payload);
    refs.push(hex);
  }
  const logRef = store.artifactRef(0, runId, "log", result.logText);
  store.saveArtifact(0, runId, "log", result.logText);
  refs.push(logRef);

  const run: RunRecord = {
    id: runId,
    recipeId: recipe.id,
    recipeVersion: recipe.version,
    status: result.status,
    startedAt: nowIso(),
    finishedAt: nowIso(),
    committedPrefix: result.committedPrefix,
    failedStepIdx: result.failedStepIdx,
    extracted: Object.keys(result.extracted).length > 0 ? result.extracted : undefined,
    artifacts: refs,
  };
  store.saveRun(run, JSON.stringify(run));
  return run;
}

/**
 * Persist a misfire skip record. The record's `startedAt`/`finishedAt`
 * are the decision's stamped window (the missed due + the post-advance
 * nextDue); the run id is the same deterministic max+1.
 */
function persistSkipRecord(store: ChaconneDiskStore, rec: RunRecord): RunRecord {
  const existing = store.loadRuns();
  const runId = existing.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const run: RunRecord = { ...rec, id: runId };
  store.saveRun(run, JSON.stringify(run));
  return run;
}

/**
 * Persist the schedule state (lastFiredIso / nextDueIso, or null to
 * retire a fired one-shot) through the C-1 model function
 * `recordSchedule` — the atomic, re-validating mutation — and write the
 * recipe doc back through the disk store's temp-file + rename-swap.
 */
async function persistScheduleState(
  store: ChaconneDiskStore,
  recipe: Recipe,
  next: Schedule | null,
  _nowIso: () => string,
): Promise<void> {
  void _nowIso; // the model stamps no wall clock; the state IS the decision's
  const recipes = store.loadRecipes();
  const data: ChaconneData = {
    schema: "chaconne.v1",
    recipes,
    runs: store.loadRuns(),
  };
  const nextData = recordSchedule(data, recipe.id, next);
  const updated = nextData.recipes.find((r) => r.id === recipe.id);
  if (updated) store.saveRecipe(updated, JSON.stringify(updated));
}

async function makeFakeAdapter(): Promise<PageAdapter> {
  const { FakePageAdapter } = await import("./page-adapter.js");
  return new FakePageAdapter({ dom: (url) => defaultFakeDom(url) });
}

async function makeRealAdapter(baseUrl?: string): Promise<PageAdapter> {
  void baseUrl;
  const { makeRealAdapter: real } = await import("./real-adapter.js");
  return real();
}

/** The same named-fixture fake table as the CLI's `--fake` flag. */
function defaultFakeDom(url: string): {
  elements: Record<string, import("./page-adapter.js").FakeElement>;
} {
  const el = (selector: string, text = "", extra: Partial<import("./page-adapter.js").FakeElement> = {}) => ({
    selector,
    text,
    attrs: {},
    present: true,
    clickable: true,
    ...extra,
  });
  const byUrl: Record<string, Record<string, import("./page-adapter.js").FakeElement>> = {
    "about:blank": {},
    "http://127.0.0.1:4014/test/fixtures/blank.html": {},
    "http://127.0.0.1:4014/test/fixtures/form-iframe.html": {
      "#name": el("#name", "", { value: "" }),
      "inner::#token": el("inner::#token", "", { value: "" }),
    },
    "http://127.0.0.1:4014/test/fixtures/tall.html": {
      "#bottom": el("#bottom", "bottom-marker"),
    },
    "http://127.0.0.1:4014/test/fixtures/slow.html": {
      "#ready": el("#ready", "ready", { appearsAt: 2000 }),
    },
    "http://127.0.0.1:4014/test/fixtures/dynamic.html": {
      "#label": el("#label", "changing"),
      "#pop": el("#pop", "", { appearsAt: 1000 }),
    },
  };
  return { elements: byUrl[url] ?? {} };
}

/**
 * The schedule loop's single-call entry: tick EVERY scheduled recipe
 * once (one pull, not a poll — the caller re-invokes on its own clock).
 * Repeated invocations across boots re-decide the advanced state, so a
 * fired due can never double-fire (the dedup law).
 */
export async function runScheduleTick(opts: ScheduleLoopOptions = {}): Promise<TickResult[]> {
  const store = new ChaconneDiskStore(opts.dataDir ?? DEFAULT_DATA_DIR);
  store.recover();
  const data: ChaconneData =
    opts.dataOverride ??
    { schema: "chaconne.v1", recipes: store.loadRecipes(), runs: store.loadRuns() };
  const out: TickResult[] = [];
  for (const r of data.recipes) {
    if (r.schedule === undefined) continue; // unscheduled: no tick
    out.push(await tickSchedule(r, opts));
  }
  return out;
}

/**
 * The C-4 real wiring (replaces the C-2 stub call-site in index.ts):
 * when `executeRecipe` runs a scheduled recipe, this function is the
 * schedule hook — it reads the disk store, asks the pure scheduler,
 * and advances the schedule state. The stub now calls this.
 */
export { runScheduleTick as scheduleTick };

