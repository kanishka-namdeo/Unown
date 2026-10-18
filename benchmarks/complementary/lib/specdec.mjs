/**
 * specdec.mjs — C1 (n-gram speculative decoding), C2 (draft-model specdec),
 * C3 (prefix KV reuse): the local-lane SPEED experiments (H16, H17, H18).
 *
 * Method:
 *  - Replays REAL production prompt assemblies (triage + mining, imported
 *    byte-faithful from local-llm/lib/prompts.mjs) against llama-server
 *    variants spawned with different extraArgs.
 *  - Every call goes through chatTimed (non-stream) so llama.cpp's own
 *    `timings` block (prompt_n / prompt_ms / predicted_per_second) is the
 *    instrument — not wall-clock guesses.
 *  - Greedy (temperature 0) everywhere: speculative decoding is only
 *    guaranteed output-identical under greedy sampling (llama.cpp docs),
 *    so byte-identity between baseline and spec variants is the guard.
 *  - C1 arms: baseline / ngram-simple / ngram-mod, each × {triage, mining}
 *    × {plain, grammar (json_schema)}.
 *  - C2 arms: baseline / draft-simple (Qwen2.5-0.5B draft), same replays.
 *  - C3: one server, call sequences sharing the big SYSTEM prefix; the
 *    2nd call's prompt_n vs its full length shows whether prefix reuse
 *    engaged (guard), prompt_ms delta shows the win.
 */
import {
  loadNotes, loadRuns, loadMemory, loadTasks,
  minerMessages, triageMessages,
} from "../../local-llm/lib/prompts.mjs";
import { startLane, chatTimed, median, INCUMBENT, EXT_MODELS, extModelPath } from "./lane.mjs";
import { extractJson } from "../../local-llm/lib/openai.mjs";
import { LLAMA_BUILD } from "../../local-llm/lib/llama.mjs";

const NO_THINKING = { chat_template_kwargs: { enable_thinking: false } };

// SYNC local-llm/lib/experiments.mjs MINER_SCHEMA (not exported there; copied
// verbatim — same constraint the production miner's prompt text carries)
const MINER_SCHEMA = {
  type: "object",
  properties: {
    diagnosis: { type: "string" },
    proposal: { type: "string" },
    patchLines: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: 6 },
    targetTier: { type: "string", enum: ["project", "local"] },
  },
  required: ["diagnosis", "proposal", "patchLines", "targetTier"],
};

/** Build the replay sets once: triage (short outputs, schema) + mining (long, the lane's heavy lane). */
export function buildReplays({ noteLimit = 12, runLimit = 4 } = {}) {
  const notes = loadNotes().slice(0, noteLimit);
  const tasks = loadTasks();
  const runs = loadRuns().filter((r) => r.status === "FAILED" || r.outcome === "FAILED").slice(0, runLimit);
  const memoryTiers = loadMemory();
  const triage = notes.map((note, i) => ({
    family: "triage",
    id: `triage-${i}`,
    messages: triageMessages(note),
    schema: null, // TRIAGE probe has no grammar in production
    maxTokens: 300,
  }));
  const mining = runs.map((run, i) => {
    const task = tasks.find((t) => t.id === run.taskId) ?? tasks[0];
    return {
      family: "mining",
      id: `mine-${run.id ?? i}`,
      messages: minerMessages(task, run, memoryTiers),
      schema: MINER_SCHEMA,
      maxTokens: 1500,
    };
  });
  return { triage, mining, all: [...triage, ...mining] };
}

/**
 * Run one server variant over the replay set. Returns per-replay rows +
 * aggregate. `variant` = { id, extraArgs, note }.
 */
export async function runVariant({ variant, replays, ctx = 12288, model = INCUMBENT, grammar = true, progress }) {
  const server = await startLane({ model, ctx, extraArgs: variant.extraArgs });
  try {
    const rssMB = await server.rssMB();
    const rows = [];
    for (const r of replays) {
      const useGrammar = grammar && r.schema;
      let out;
      try {
        out = await chatTimed({
          baseUrl: server.baseUrl,
          model: "replay",
          messages: r.messages,
          maxTokens: r.maxTokens,
          temperature: 0,
          jsonSchema: useGrammar ? r.schema : undefined,
          extra: NO_THINKING,
        });
      } catch (err) {
        rows.push({ id: r.id, family: r.family, ok: false, error: String(err.message).slice(0, 200), ...blankTimings() });
        continue;
      }
      const t = out.timings ?? blankTimings();
      rows.push({
        id: r.id, family: r.family, ok: true,
        content: out.content,
        promptTokens: out.usage.promptTokens, completionTokens: out.usage.completionTokens,
        latencyMs: out.latencyMs,
        promptN: t.promptN, promptMs: t.promptMs, promptPerSecond: t.promptPerSecond,
        predictedN: t.predictedN, predictedMs: t.predictedMs, predictedPerSecond: t.predictedPerSecond,
        error: null,
      });
      progress?.(`${variant.id} ${r.id}: ${t.predictedPerSecond ?? "?"} tok/s, ${out.latencyMs}ms`);
    }
    const agg = aggregate(rows);
    return { variant: variant.id, note: variant.note, grammar, rows, agg, rssMB, startupMs: server.startupMs };
  } finally {
    await server.stop();
  }
}

function blankTimings() {
  return { promptN: null, promptMs: null, promptPerSecond: null, predictedN: null, predictedMs: null, predictedPerSecond: null };
}

export function aggregate(rows) {
  const ok = rows.filter((r) => r.ok);
  const tps = ok.map((r) => r.predictedPerSecond).filter(Boolean);
  const lat = ok.map((r) => r.latencyMs);
  const gen = ok.map((r) => r.predictedN).filter(Boolean);
  return {
    n: rows.length, ok: ok.length, failed: rows.length - ok.length,
    medianTokPerSec: median(tps),
    meanTokPerSec: tps.length ? Number((tps.reduce((a, b) => a + b, 0) / tps.length).toFixed(2)) : null,
    medianLatencyMs: median(lat),
    totalGenerated: gen.reduce((a, b) => a + b, 0),
  };
}

/** Compare every spec variant's outputs to the baseline's (greedy identity guard). */
export function identityCheck(baselineRows, specRows) {
  const base = new Map(baselineRows.filter((r) => r.ok).map((r) => [r.id, r.content]));
  return specRows.filter((r) => r.ok).map((r) => ({
    id: r.id,
    identical: base.has(r.id) ? base.get(r.id) === r.content : null,
  }));
}

// ---------------------------------------------------------------- C1 + C2

export const NGRAM_VARIANTS = [
  { id: "baseline", extraArgs: [], note: "no speculative decoding" },
  { id: "ngram-simple", extraArgs: ["--spec-type", "ngram-simple"], note: "model-free n-gram lookup drafting" },
  { id: "ngram-mod", extraArgs: ["--spec-type", "ngram-mod"], note: "n-gram-mod (llama.cpp recommended for repetitive/structured output)" },
];

export function draftVariants(draftModel = "qwen2.5-0.5b-draft") {
  return [
    { id: "baseline", extraArgs: [], note: "no speculative decoding" },
    {
      id: "draft-simple",
      extraArgs: ["--spec-type", "draft-simple", "--model-draft", extModelPath(draftModel), "--spec-draft-n-max", "8"],
      note: `draft-model specdec (${EXT_MODELS[draftModel]?.params ?? draftModel} draft, K=8)`,
    },
  ];
}

async function speedExperiment({ variants, replays, label, ctx, model, grammar }) {
  const results = [];
  const baseline = await runVariant({ variant: variants[0], replays, ctx, model, grammar });
  results.push(baseline);
  for (const v of variants.slice(1)) {
    let r;
    try {
      r = await runVariant({ variant: v, replays, ctx, model, grammar });
    } catch (err) {
      r = { variant: v.id, note: v.note, bootError: String(err.message).slice(0, 500), rows: [], agg: null, rssMB: null };
    }
    r.identity = r.agg ? identityCheck(baseline.rows, r.rows) : null;
    r.identitySummary = r.identity
      ? { checked: r.identity.length, identical: r.identity.filter((x) => x.identical).length, differing: r.identity.filter((x) => x.identical === false).length }
      : null;
    r.tokPerSecRatio = r.agg?.medianTokPerSec && baseline.agg.medianTokPerSec
      ? Number((r.agg.medianTokPerSec / baseline.agg.medianTokPerSec).toFixed(3)) : null;
    results.push(r);
  }
  return { label, ctx, model, llamaBuild: LLAMA_BUILD, grammar, results };
}

/** C1 — n-gram specdec (H16). Triage (short) runs plain+grammar; mining (the heavy production lane) runs grammar only. */
export async function c1Ngram(opts = {}) {
  const replays = buildReplays(opts);
  const out = [];
  for (const grammar of [true, false]) {
    const set = replays.triage;
    if (set.length) out.push(await speedExperiment({ variants: NGRAM_VARIANTS, replays: set, label: `C1 ngram · triage · ${grammar ? "grammar" : "plain"}`, ctx: 6144, grammar }));
  }
  if (replays.mining.length) {
    out.push(await speedExperiment({ variants: NGRAM_VARIANTS, replays: replays.mining, label: `C1 ngram · mining · grammar`, ctx: 12288, grammar: true }));
  }
  return { experiment: "C1-ngram", hypotheses: ["H16"], runs: out };
}

/** C2 — draft-model specdec (H17). */
export async function c2Draft(opts = {}) {
  const replays = buildReplays(opts);
  const out = [];
  for (const family of ["triage", "mining"]) {
    const grammar = true;
    const set = replays[family];
    if (!set.length) continue;
    out.push(await speedExperiment({ variants: draftVariants(opts.draftModel), replays: set, label: `C2 draft · ${family} · grammar`, ctx: family === "mining" ? 12288 : 6144, grammar }));
  }
  return { experiment: "C2-draft", hypotheses: ["H17"], runs: out };
}

// ---------------------------------------------------------------- C3

/**
 * C3 — prefix KV reuse (H18). One server (cache_prompt is llama-server's
 * default). Sequences:
 *  - triage-seq: N triage calls, each with the SAME TRIAGE_SYSTEM prefix and
 *    a DIFFERENT note payload — the production call shape.
 *  - control-seq: alternating system prompts (no shared prefix) to show the
 *    mechanism is prefix-driven, not free.
 * Metrics per call: prompt_n (tokens actually processed) vs promptTokens
 * (full prompt length reported by usage), prompt_ms.
 */
export async function c3KvReuse({ noteLimit = 10 } = {}) {
  const notes = loadNotes().slice(0, noteLimit);
  const server = await startLane({ model: INCUMBENT, ctx: 6144 });
  try {
    const calls = [];
    // 1st call: cold slot, full prefill
    // subsequent: shared SYSTEM prefix + new note
    for (let i = 0; i < notes.length; i++) {
      const msgs = triageMessages(notes[i]);
      const out = await chatTimed({ baseUrl: server.baseUrl, model: "replay", messages: msgs, maxTokens: 120, temperature: 0, extra: NO_THINKING });
      calls.push({
        seq: "shared-prefix", i,
        promptTokens: out.usage.promptTokens,
        promptN: out.timings?.promptN ?? null,
        promptMs: out.timings?.promptMs ?? null,
        promptPerSecond: out.timings?.promptPerSecond ?? null,
        latencyMs: out.latencyMs,
        content: out.content,
      });
    }
    // control: same note, DIFFERENT system each time (prefix broken)
    const altSystems = ["You are a tax auditor.", "You are a weather reporter.", "You are a chess engine.", "You are a kitchen timer.", "You are a ferry captain."];
    const control = [];
    for (let i = 0; i < Math.min(altSystems.length, notes.length); i++) {
      const msgs = triageMessages(notes[i]);
      msgs[0] = { role: "system", content: altSystems[i] };
      const out = await chatTimed({ baseUrl: server.baseUrl, model: "replay", messages: msgs, maxTokens: 120, temperature: 0, extra: NO_THINKING });
      control.push({
        seq: "broken-prefix", i,
        promptTokens: out.usage.promptTokens,
        promptN: out.timings?.promptN ?? null,
        promptMs: out.timings?.promptMs ?? null,
        promptPerSecond: out.timings?.promptPerSecond ?? null,
        latencyMs: out.latencyMs,
      });
    }
    const first = calls[0];
    const rest = calls.slice(1);
    const avgFull = first?.promptTokens ?? null;
    const avgProcessed2nd = median(rest.map((c) => c.promptN));
    const avgPromptMs2nd = median(rest.map((c) => c.promptMs));
    const ctrlProcessed = median(control.map((c) => c.promptN));
    const ctrlPromptMs = median(control.map((c) => c.promptMs));
    // identity guard: replay the FIRST call again — with reuse it must return the same content
    const repeat = await chatTimed({ baseUrl: server.baseUrl, model: "replay", messages: triageMessages(notes[0]), maxTokens: 120, temperature: 0, extra: NO_THINKING });
    return {
      experiment: "C3-kvreuse",
      hypotheses: ["H18"],
      llamaBuild: LLAMA_BUILD,
      calls, control,
      summary: {
        firstCallPromptTokens: avgFull,
        firstCallPromptMs: first?.promptMs ?? null,
        secondCallProcessedTokensMedian: avgProcessed2nd,
        secondCallPromptMsMedian: avgPromptMs2nd,
        controlProcessedTokensMedian: ctrlProcessed,
        controlPromptMsMedian: ctrlPromptMs,
        prefixTokensSavedMedian: avgFull != null && avgProcessed2nd != null ? avgFull - avgProcessed2nd : null,
        prefillTimeSavedPct: first?.promptMs && avgPromptMs2nd ? Number((100 * (1 - avgPromptMs2nd / first.promptMs)).toFixed(1)) : null,
        repeatIdentical: repeat.content === first?.content,
      },
    };
  } finally {
    await server.stop();
  }
}
