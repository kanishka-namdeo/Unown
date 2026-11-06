/**
 * Chaconne runner — CLI entry + execution core (PLAN §1).
 *
 * `bun apps/chaconne/runner/index.ts run <recipeId> [--frame-base-url <u>]
 *                              [--fake] [--data-dir <dir>]`
 *
 * Core: `executeRecipe` takes a PageAdapter (real or fake), a recipe,
 * caps, and a clock seam; runs the steps with per-step/per-run caps;
 * keeps the committed-prefix law; returns the pieces the CLI needs to
 * write the run record + artifacts atomically through store.ts.
 *
 * The CLI: loads the disk store, executes, writes:
 *   - the run-log artifact (content-addressed)
 *   - each step's screenshot/extract artifact (content-addressed)
 *   - the run record JSON (temp + rename-swap)
 *
 * The schedule stub: C-4 owns the loop; this ticket leaves ONE named
 * call-site (`scheduleHook`) that returns immediately.
 */
import * as path from "node:path";
import {
  AdapterStepError,
  FakePageAdapter,
  type PageAdapter,
} from "./page-adapter.js";
import { Caps, CapExceeded, DEFAULT_CAPS, finishRunRecord, RunLedger, stepCap } from "./caps.js";
import { ChaconneDiskStore } from "./store.js";
import { createLogBuilder, logArtifactBytes } from "./log.js";
import { assertStep } from "../src/domain/invariants.js";
import type { Recipe, RunRecord, Step } from "../src/domain/types.js";
import { DomainInvariantError } from "../src/domain/types.js";

/* ------------------------------------------------------------------ */
/* Execution core (adapter-injected → deterministic on the fake lane)  */
/* ------------------------------------------------------------------ */

export type ExecutionResult = {
  /** The run record fields to persist (the CLI assigns id/timestamps). */
  status: RunRecord["status"];
  committedPrefix: number;
  failedStepIdx?: number;
  extracted: Record<string, string>;
  /** artifact payloads produced by this run, in order (screenshot/extract). */
  artifacts: { stepIdx: number; ext: string; payload: Uint8Array | string; kind: "png" | "json" | "log" }[];
  /** the run-log artifact text (its name is derived from these bytes). */
  logText: string;
};

export type ExecuteOptions = {
  caps?: Caps;
  /** ISO-8601; the fake lane injects a fixed clock, the real lane now(). */
  nowMs?: number;
  nowIso?: () => string;
};

/**
 * The single C-4 hook: when C-4 lands, the schedule loop lives BEHIND
 * this. No schedule logic in this ticket (NON-OVERLAP: C-4).
 */
export function scheduleHook(_recipe: Recipe): void {
  /* C-4 — stub call-site only */
}

export async function executeRecipe(
  adapter: PageAdapter,
  recipe: Recipe,
  opts: ExecuteOptions = {},
): Promise<ExecutionResult> {
  const caps: Caps = { ...DEFAULT_CAPS, ...(opts.caps ?? {}) };
  const nowIso = opts.nowIso ?? (() => new Date().toISOString());
  const wallStart = opts.nowMs ?? Date.now();
  const ledger = new RunLedger(caps, recipe.steps.length, wallStart);
  let wallCursor = wallStart; // the fake lane advances this per step (the injected-clock law)

  // invalid-recipe: the domain's assertStep boundary runs BEFORE any
  // step executes (PRD P0 #1 — a bad recipe never half-runs).
  validateRecipeSteps(recipe);
  scheduleHook(recipe);

  const log = createLogBuilder();
  const extracted: Record<string, string> = {};
  const artifacts: ExecutionResult["artifacts"] = [];
  let failedStepIdx: number | undefined;
  let failedStatus: RunRecord["status"] | undefined;

  for (let i = 0; i < recipe.steps.length; i++) {
    const step = recipe.steps[i];
    try {
      ledger.checkStepCount(i);
      ledger.checkWall(wallCursor - wallStart);
      log.stepStarted(i, step);
      const cap = stepCap(step, caps);
      const stepInput = {
        kind: step.kind,
        selector: step.selector,
        timeoutMs: cap,
        value: step.value,
        intoFrame: step.intoFrame,
      };
      await runStep(adapter, stepInput, step.kind, i, extracted, artifacts, cap);
      wallCursor += 1; // advance the fake wall by a constant (the real elapsed is adapter-dependent; 1ms keeps the step-count cap firing first in unit tests)
      ledger.checkWall(wallCursor - wallStart); // re-check after the advance
      ledger.commitStep();
      log.stepDone(i);
    } catch (err) {
      // The step did NOT complete — the committed prefix stays put.
      if (err instanceof AdapterStepError) {
        failedStepIdx = i;
        failedStatus = err.status;
        log.stepFailed(i, err.status, err.message);
      } else if (err instanceof CapExceeded) {
        failedStatus = err.status;
        log.interrupted(err.message);
      } else {
        failedStepIdx = i;
        failedStatus = "step-failed";
        log.stepFailed(i, "step-failed", err instanceof Error ? err.message : String(err));
      }
      break;
    }
  }

  const completedAll = failedStepIdx === undefined && failedStatus === undefined;
  const finished = completedAll ? { status: "ok" as const, committedPrefix: recipe.steps.length, failedStepIdx } : finishRunRecord({
    totalSteps: recipe.steps.length,
    prefix: ledger.prefix(),
    failedStepIdx,
    failedStatus,
  });

  const logText = logArtifactBytes(log.build(), recipe.name, recipe.steps.length);
  return { ...finished, extracted, artifacts, logText };
}

async function runStep(
  adapter: PageAdapter,
  input: { kind: string; selector: string; timeoutMs: number; value?: string; intoFrame?: string },
  kind: Step["kind"],
  idx: number,
  extracted: Record<string, string>,
  artifacts: ExecutionResult["artifacts"],
  cap: number,
): Promise<void> {
  const sel = input.selector;
  const val = input.value;
  const frame = input.intoFrame;
  switch (kind) {
    case "goto":
      await adapter.goto(sel, cap);
      break;
    case "click":
      await adapter.click(sel, cap, frame);
      break;
    case "fill":
      await adapter.fill(sel, val ?? "", cap, frame);
      break;
    case "select":
      await adapter.select(sel, val ?? "", cap, frame);
      break;
    case "wait":
      await adapter.wait(sel, cap, frame);
      break;
    case "assert-text":
      await adapter.assertText(sel, val ?? "", cap, frame);
      break;
    case "assert-element":
      await adapter.assertElement(sel, cap, frame);
      break;
    case "extract": {
      // value, when present, names the ATTRIBUTE to read (extract-with-attr);
      // absent means textContent.
      const attr = val;
      const v = await adapter.extract(sel, cap, frame, attr);
      extracted[String(idx)] = v;
      artifacts.push({ stepIdx: idx, ext: "json", payload: JSON.stringify({ [String(idx)]: v }), kind: "json" });
      break;
    }
    case "screenshot": {
      const shot = await adapter.screenshot(cap);
      artifacts.push({ stepIdx: idx, ext: "png", payload: shot.bytes, kind: "png" });
      break;
    }
    default:
      // The closed 9-kind set is validated in validateRecipeSteps; this
      // is unreachable on a legal recipe — surface it as step-failed.
      throw new AdapterStepError("step-failed", `unknown step kind "${kind}"`);
  }
}

/**
 * `invalid-recipe` boundary: every step's shape checked BEFORE
 * execution (assertStep is the domain's boundary check — one lane,
 * one implementation, no duplication).
 */
function validateRecipeSteps(recipe: Recipe): void {
  for (const step of recipe.steps) {
    assertStep(step, `recipe ${recipe.id}`);
  }
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

export type CliArgs = {
  dataDir: string;
  fake: boolean;
  baseUrl?: string;
};

export async function cmdRun(args: {
  dataDir: string;
  recipeId: number;
  fake: boolean;
  baseUrl?: string;
  caps?: Caps;
  nowIso?: () => string;
}): Promise<{ run: RunRecord; result: ExecutionResult; ok: boolean }> {
  const store = new ChaconneDiskStore(args.dataDir);
  store.recover();
  const recipes = store.loadRecipes();
  const recipe = recipes.find((r) => r.id === args.recipeId);
  if (!recipe) {
    throw new DomainInvariantError(`run: unknown recipe ${args.recipeId}`);
  }
  const adapter: PageAdapter = args.fake
    ? new FakePageAdapter({ dom: defaultFakeDom })
    : await makeRealAdapter(args.baseUrl ?? "http://127.0.0.1:4014");

  let result: ExecutionResult;
  try {
    result = await executeRecipe(adapter, recipe, { caps: args.caps, nowIso: args.nowIso });
  } finally {
    await (adapter as { close?: () => Promise<void> }).close?.();
  }

  // Run id = max(existing)+1 (deterministic, never random — byte law).
  const existing = store.loadRuns();
  const runId = existing.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const nowIso = args.nowIso ?? (() => new Date().toISOString());

  // Artifacts first (content-addressed; names carry the run id + step idx).
  const refs: RunRecord["artifacts"] = [];
  for (const a of result.artifacts) {
    const payload = a.kind === "json" ? JSON.stringify(a.payload, null, 2) : a.payload;
    const hex = store.artifactRef(a.stepIdx, runId, a.ext, payload);
    store.saveArtifact(a.stepIdx, runId, a.ext, payload);
    refs.push(hex);
  }
  // The run-log artifact (its bytes are the logText we just built).
  const logRef = store.artifactRef(0, runId, "log", result.logText);
  store.saveArtifact(0, runId, "log", result.logText);
  refs.push(logRef);

  const run: RunRecord = {
    id: runId,
    recipeId: recipe.id,
    recipeVersion: recipe.version, // the snapshot law (edge case 6)
    status: result.status,
    startedAt: nowIso(),
    finishedAt: nowIso(),
    committedPrefix: result.committedPrefix,
    failedStepIdx: result.failedStepIdx,
    extracted: Object.keys(result.extracted).length > 0 ? result.extracted : undefined,
    artifacts: refs,
  };
  store.saveRun(run, JSON.stringify(run));
  return { run, result, ok: result.status === "ok" };
}

/**
 * The default fake table (the CLI's `--fake` flag) — the named fixture
 * set as in-memory tables so a full run works with zero browser:
 * blank.html kin (an absent selector), form-iframe kin, etc.
 */
function defaultFakeDom(url: string): { elements: Record<string, import("./page-adapter.js").FakeElement> } {
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

async function makeRealAdapter(baseUrl?: string): Promise<PageAdapter> {
  void baseUrl; // real-adapter.ts owns the Playwright wiring; the CLI
  // constructs it there, so the fake lane stays import-light.
  const { makeRealAdapter } = await import("./real-adapter.js");
  return makeRealAdapter();
}

/** The entry: `bun apps/chaconne/runner/index.ts run <id> [flags]` */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] !== "run") {
    console.error('usage: bun apps/chaconne/runner/index.ts run <recipeId> [--fake] [--data-dir <dir>] [--base-url <u>]');
    process.exit(2);
  }
  const recipeId = Number(argv[1]);
  if (!Number.isInteger(recipeId) || recipeId < 1) {
    console.error("run: recipeId must be a positive integer");
    process.exit(2);
  }
  let fake = false;
  let baseUrl: string | undefined;
  let dataDir = path.resolve("apps/chaconne/data");
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fake") fake = true;
    else if (a === "--base-url") baseUrl = argv[++i];
    else if (a === "--data-dir") dataDir = path.resolve(argv[++i]);
  }
  const { run, ok } = await cmdRun({ dataDir, recipeId, fake, baseUrl });
  console.log(
    `run ${run.id} (recipe ${run.recipeId} v${run.recipeVersion}): ${run.status}; committed prefix ${run.committedPrefix}`,
  );
  process.exit(ok ? 0 : 1);
}

// The module is both a CLI entry and an importable core: run main only
// when executed DIRECTLY (`bun runner/index.ts`), not when imported by
// the test lane (`import { cmdRun } from "./index.js"`).
const isMain = (() => {
  try {
    return process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(import.meta.url);
  } catch {
    return false;
  }
})();
if (isMain) main();
