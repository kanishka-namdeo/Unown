/**
 * experiments.mjs — E1..E5 for the local-llm testbench.
 *
 * Every experiment replays REAL Unown learning-layer workloads (byte-faithful
 * prompt assemblies from prompts.mjs, fixtures captured from the live engine)
 * against:
 *   - REMOTE baseline: the production model (kimi-k2.5) via the llm-bridge
 *   - LOCAL candidates: small GGUF models via llama-server
 * and measures: latency (p50/p90), TTFT, tokens, JSON validity (Unown's own
 * extractJson), harness-validator pass, blind A/B judge verdicts (remote big
 * model as judge), and estimated API cost.
 */
import { MODELS } from "./llama.mjs";
import { chat, embed, extractJson, cosine } from "./openai.mjs";
import { judgePair, judgeSolo } from "./judge.mjs";
import { latencyStats, mdTable, pct } from "./report.mjs";
import {
  loadNotes, loadTasks, loadRuns, loadMemory, minerMessages, dreamMessages,
  triageMessages, mintCurriculumMessages, skillMessages,
} from "./prompts.mjs";

/** List prices (USD per 1M tokens) used for cost estimates — OpenRouter/public list, Oct 2026. */
export const COSTS = {
  "kimi-k2.5": { in: 0.49, out: 2.5 },
  "qwen3.7-plus": { in: 0.6, out: 2.2 },
  "qwen3.6-plus": { in: 0.4, out: 1.6 },
};

export function cfg() {
  return {
    bridgeUrl: process.env.TEST_BRIDGE_URL ?? "http://127.0.0.1:3031",
    remoteModel: process.env.TEST_REMOTE_MODEL ?? process.env.PI_MODEL_ID ?? "kimi-k2.5",
    judgeModel: process.env.TEST_JUDGE_MODEL ?? "kimi-k2.5",
  };
}

/** llama-server request extras: disable thinking for hybrid/thinking models (grammar+content safety). */
export const NO_THINKING = { chat_template_kwargs: { enable_thinking: false } };

function costOf(model, promptTokens, completionTokens) {
  const c = COSTS[model];
  if (!c || !promptTokens) return 0;
  return (promptTokens / 1e6) * c.in + ((completionTokens ?? 0) / 1e6) * c.out;
}

// =============================================================== E1 triage

/**
 * E1 — note triage (new local-capability probe; H2).
 * Classify every session note; agreement measured against the remote model's
 * labels (production-model labels as reference), plus latency/validity/cost.
 */
export async function e1Triage({ localServer, localModel, noteLimit = 30, judge = true, noRemote = false } = {}) {
  const { bridgeUrl, remoteModel } = cfg();
  const notes = loadNotes().slice(0, noteLimit);
  const rows = [];
  const remoteLabels = [];

  for (const note of notes) {
    const messages = triageMessages(note);
    let remote, rParsed, rVal;
    if (noRemote) {
      remote = { ok: false, latencyMs: null, usage: {} };
      rParsed = { ok: false };
      rVal = null;
    } else {
      remote = await chat({ baseUrl: bridgeUrl, model: remoteModel, messages, maxTokens: 200, temperature: 0 });
      rParsed = remote.ok ? extractJson(remote.content) : { ok: false };
      rVal = rParsed.ok ? rParsed.value : null;
    }
    remoteLabels.push(rVal?.kind ?? "unparsed");

    const local = await chat({ baseUrl: localServer.baseUrl, model: localModel, messages, maxTokens: 300, temperature: 0, extra: NO_THINKING });
    const lParsed = local.ok ? extractJson(local.content) : { ok: false };
    const lVal = lParsed.ok ? lParsed.value : null;

    rows.push({
      noteId: String(note.id).slice(0, 8),
      remoteKind: rVal?.kind ?? null, remoteOutcome: rVal?.outcome ?? null, remoteValid: rParsed.ok,
      remoteLatencyMs: remote.latencyMs, remoteCost: costOf(remoteModel, remote.usage.promptTokens, remote.usage.completionTokens),
      localKind: lVal?.kind ?? null, localOutcome: lVal?.outcome ?? null, localValid: lParsed.ok,
      localLatencyMs: local.latencyMs, localTTFTms: local.ttftMs,
      agreeKind: noRemote ? null : lVal?.kind === rVal?.kind, agreeOutcome: noRemote ? null : lVal?.outcome === rVal?.outcome,
      localLesson: (lVal?.lesson ?? "").slice(0, 60),
    });
  }

  const n = rows.length || 1;
  const agreeRows = rows.filter((r) => r.agreeKind !== null);
  const an = agreeRows.length || 1;
  const summary = {
    experiment: "E1-note-triage",
    localModel, remoteModel, notes: rows.length, noRemote,
    localJsonValidity: rows.filter((r) => r.localValid).length / n,
    remoteJsonValidity: noRemote ? null : rows.filter((r) => r.remoteValid).length / n,
    kindAgreement: noRemote ? null : agreeRows.filter((r) => r.agreeKind).length / an,
    outcomeAgreement: noRemote ? null : agreeRows.filter((r) => r.agreeOutcome).length / an,
    remoteLatency: latencyStats(rows.filter((r) => r.remoteLatencyMs != null).map((r) => ({ latencyMs: r.remoteLatencyMs }))),
    localLatency: latencyStats(rows.filter((r) => r.localLatencyMs != null).map((r) => ({ latencyMs: r.localLatencyMs }))),
    remoteCostUsd: round4(rows.reduce((a, r) => a + r.remoteCost, 0)),
    localCostUsd: 0,
  };
  return { summary, rows };
}

// =============================================================== E2 dream

/** E2 — AutoDream consolidation replay (H4): notes + memory -> next project.md. */
export async function e2Dream({ localServer, localModel, grammar = true, noteLimit = 12 } = {}) {
  const { bridgeUrl, remoteModel, judgeModel } = cfg();
  const mem = loadMemory();
  // engine project tier content (the API export shape: {tiers:{...}})
  const currentMemory = mem?.tiers?.project ?? { content: "(no project memory yet)", version: 0 };
  const notes = loadNotes().filter((n) => String(n.content ?? "").length > 40).slice(0, noteLimit);
  const messages = dreamMessages(currentMemory, notes);

  const call = async (target) => {
    const res = await chat({
      baseUrl: target.baseUrl,
      model: target.model,
      messages,
      maxTokens: 3000,
      temperature: 0.2,
      jsonSchema: target.local && grammar ? DREAM_SCHEMA : undefined,
      extra: target.local ? NO_THINKING : undefined,
    });
    const parsed = res.ok ? extractJson(res.content) : { ok: false, error: res.error };
    return { res, parsed };
  };

  const remote = await call({ baseUrl: bridgeUrl, model: remoteModel, local: false });
  const local = await call({ baseUrl: localServer.baseUrl, model: localModel, local: true });

  const analyze = ({ res, parsed }) => {
    const val = parsed.ok ? parsed.value : null;
    const md = typeof val?.projectMd === "string" ? val.projectMd : "";
    return {
      ok: parsed.ok,
      latencyMs: res.latencyMs,
      ttftMs: res.ttftMs,
      promptTokens: res.usage.promptTokens,
      completionTokens: res.usage.completionTokens,
      costUsd: costOf(remoteModel, res.usage.promptTokens, res.usage.completionTokens),
      lines: md ? md.split("\n").length : 0,
      chars: md.length,
      stats: val?.stats ?? null,
      saneLength: md.length >= 60 && md.split("\n").length <= 160,
      // guard scan: did the output embed injection directives? (heuristic port of guard.ts spirit)
      suspicious: /<!--\s*guard|ignore (previous|all)|disregard/i.test(md),
    };
  };
  const remoteA = analyze(remote);
  const localA = analyze(local);

  // blind judge: which next-memory version is better?
  let judged = null;
  if (remoteA.ok && localA.ok) {
    judged = await judgePair({
      bridgeUrl, judgeModel,
      system: "You are an expert reviewer of agent memory systems. Judge which consolidated memory file is better for a coding agent's long-term memory.",
      question: "Criteria: (1) correctness/faithfulness to the notes, (2) concision and organization, (3) preservation of hard-won rules, (4) absence of untrusted directives, (5) usefulness to future runs. The notes are benchmark/terminal session notes; each candidate is the NEXT version of a project memory markdown.",
      outputA: remote.parsed.value?.projectMd ?? "",
      outputB: local.parsed.value?.projectMd ?? "",
    });
  }

  return {
    summary: {
      experiment: "E2-dream-replay", localModel, remoteModel, grammar,
      notesIn: notes.length,
      remote: remoteA, local: localA,
      judged: judged ? { winner: judged.winner, consistent: judged.consistent, aScore: judged.aScore, bScore: judged.bScore, reason: judged.reason } : null,
    },
    outputs: {
      remoteProjectMd: remote.parsed.ok ? remote.parsed.value?.projectMd ?? null : null,
      localProjectMd: local.parsed.ok ? local.parsed.value?.projectMd ?? null : null,
      localRaw: local.res.ok ? local.res.content.slice(0, 3000) : local.res.error,
    },
  };
}

const DREAM_SCHEMA = {
  type: "object",
  properties: {
    projectMd: { type: "string" },
    stats: {
      type: "object",
      properties: {
        merged: { type: "integer" }, pruned: { type: "integer" },
        added: { type: "integer" },
        topics: { type: "array", items: { type: "string" } },
      },
      required: ["merged", "pruned", "added"],
    },
  },
  required: ["projectMd", "stats"],
};

// =============================================================== E3 mine

/** E3 — failure-mining replay (H3): failed run -> {diagnosis, proposal, patchLines, targetTier}. */
export async function e3Mine({ localServer, localModel, grammar = true, runLimit = 4 } = {}) {
  const { bridgeUrl, remoteModel, judgeModel } = cfg();
  const tasks = loadTasks();
  const runs = loadRuns().filter((r) => r.status === "failed" && Array.isArray(r.transcript) && r.transcript.length > 0);
  const mem = loadMemory();
  const memoryTiers = {
    policy: tierText(mem, "policy"), project: tierText(mem, "project"),
    user: tierText(mem, "user"), local: tierText(mem, "local"),
  };

  const rows = [];
  for (const run of runs.slice(0, runLimit)) {
    const task = tasks.get(run.task_id);
    if (!task) continue;
    const messages = minerMessages(task, run, memoryTiers);

    const runOne = async (target) => {
      const res = await chat({
        baseUrl: target.baseUrl, model: target.model, messages,
        maxTokens: 1500, temperature: 0.1,
        jsonSchema: target.local && grammar ? MINER_SCHEMA : undefined,
        extra: target.local ? NO_THINKING : undefined,
      });
      const parsed = res.ok ? extractJson(res.content) : { ok: false, error: res.error };
      const val = parsed.ok ? parsed.value : null;
      // harness.ts post-validation (L82-92): <=6 lines, tier whitelist, nonempty
      const patchLines = Array.isArray(val?.patchLines) ? val.patchLines.filter((l) => typeof l === "string" && l.trim()) : [];
      const validator =
        parsed.ok &&
        typeof val.diagnosis === "string" && val.diagnosis.length > 0 &&
        patchLines.length > 0 && patchLines.length <= 6 &&
        patchLines.every((l) => l.length <= 200) &&
        (val.targetTier === "project" || val.targetTier === "local");
      return {
        res, val, validator,
        record: {
          ok: parsed.ok, validator,
          latencyMs: res.latencyMs, ttftMs: res.ttftMs,
          promptTokens: res.usage.promptTokens, completionTokens: res.usage.completionTokens,
          costUsd: costOf(remoteModel, res.usage.promptTokens, res.usage.completionTokens),
          patchLines: patchLines.length, targetTier: val?.targetTier ?? null,
        },
      };
    };

    const remote = await runOne({ baseUrl: bridgeUrl, model: remoteModel, local: false });
    const local = await runOne({ baseUrl: localServer.baseUrl, model: localModel, local: true });

    let judged = null;
    if (remote.val && local.val) {
      judged = await judgePair({
        bridgeUrl, judgeModel,
        system: "You are an expert on self-improving coding agents. Judge which failure-mining result is better.",
        question: "Criteria: (1) root-cause correctness (does the diagnosis match the failure?), (2) actionability of the proposed memory rule for future runs, (3) appropriate tier choice, (4) rule hygiene (imperative, concise, <=200 chars/line).",
        outputA: JSON.stringify({ diagnosis: remote.val.diagnosis, proposal: remote.val.proposal, patchLines: remote.val.patchLines, targetTier: remote.val.targetTier }),
        outputB: JSON.stringify({ diagnosis: local.val.diagnosis, proposal: local.val.proposal, patchLines: local.val.patchLines, targetTier: local.val.targetTier }),
      });
    }

    rows.push({
      taskId: task.id, runId: String(run.id).slice(0, 8),
      remote: remote.record, local: local.record,
      judged: judged ? { winner: judged.winner, consistent: judged.consistent, aScore: judged.aScore, bScore: judged.bScore, reason: judged.reason } : null,
      localDiagnosis: (local.val?.diagnosis ?? "").slice(0, 160),
      remoteDiagnosis: (remote.val?.diagnosis ?? "").slice(0, 160),
    });
  }

  const agg = (side) => {
    const xs = rows.map((r) => r[side]).filter(Boolean);
    return {
      n: xs.length,
      jsonOk: xs.filter((x) => x.ok).length / (xs.length || 1),
      validatorPass: xs.filter((x) => x.validator).length / (xs.length || 1),
      latency: latencyStats(xs),
      costUsd: round4(xs.reduce((a, x) => a + (x.costUsd ?? 0), 0)),
    };
  };
  return {
    summary: {
      experiment: "E3-mine-replay", localModel, remoteModel, grammar,
      runs: rows.length, remote: agg("remote"), local: agg("local"),
      judged: rows.map((r) => ({ taskId: r.taskId, winner: r.judged?.winner ?? "unjudged" })),
    },
    rows,
  };
}

const MINER_SCHEMA = {
  type: "object",
  properties: {
    diagnosis: { type: "string" },
    proposal: { type: "string" },
    patchLines: { type: "array", items: { type: "string" }, maxItems: 6 },
    targetTier: { type: "string", enum: ["project", "local"] },
  },
  required: ["diagnosis", "proposal", "patchLines", "targetTier"],
};

// =============================================================== E4 mint

/** E4 — curriculum task-mint replay (H6): author a harder variant of a task. */
export async function e4Mint({ localServer, localModel } = {}) {
  const { bridgeUrl, remoteModel, judgeModel } = cfg();
  const tasks = loadTasks();
  // source tasks: a representative mix (one easy seed, one hard seed)
  const sources = ["impl-debounce", "hard-lru-cache"].filter((id) => tasks.has(id));
  const rows = [];

  for (const srcId of sources) {
    const task = tasks.get(srcId);
    const messages = mintCurriculumMessages(task);

    const runOne = async (target) => {
      const res = await chat({ baseUrl: target.baseUrl, model: target.model, messages, maxTokens: 3000, temperature: 0.3, extra: target.local ? NO_THINKING : undefined });
      const parsed = res.ok ? extractJson(res.content) : { ok: false, error: res.error };
      const val = parsed.ok ? parsed.value : null;
      // mint.ts validateDraft essentials (L101-139): 1-6 files, exactly one *.test.mjs, sizes, category/difficulty
      const files = val && typeof val.files === "object" ? val.files : null;
      const names = files ? Object.keys(files) : [];
      const testFiles = names.filter((f) => /\.test\.mjs$/.test(f));
      const validator = !!(
        parsed.ok && files && names.length >= 1 && names.length <= 6 &&
        testFiles.length === 1 && val.verifyTestFile === testFiles[0] &&
        names.every((f) => (files[f] ?? "").length <= 12_000) &&
        Object.values(files).reduce((a, c) => a + c.length, 0) <= 40_000 &&
        ["bugfix", "implementation", "algorithm", "refactor"].includes(val.category) &&
        Number.isInteger(val.difficulty) && val.difficulty >= 1 && val.difficulty <= 5
      );
      return {
        res, val, validator,
        record: {
          ok: parsed.ok, validator,
          latencyMs: res.latencyMs, ttftMs: res.ttftMs,
          promptTokens: res.usage.promptTokens, completionTokens: res.usage.completionTokens,
          costUsd: costOf(remoteModel, res.usage.promptTokens, res.usage.completionTokens),
          files: names.length, hasTest: testFiles.length === 1,
        },
      };
    };

    const remote = await runOne({ baseUrl: bridgeUrl, model: remoteModel, local: false });
    const local = await runOne({ baseUrl: localServer.baseUrl, model: localModel, local: true });

    let judged = null;
    if (remote.val && local.val) {
      judged = await judgePair({
        bridgeUrl, judgeModel,
        system: "You are an expert on benchmark design for coding agents. Judge which minted task is better.",
        question: "Criteria: (1) valid self-contained exercise (imports resolve, tests are meaningful), (2) appropriate difficulty bump over the source, (3) prompt quality (no solution leak), (4) determinism of the tests.",
        outputA: JSON.stringify({ id: remote.val.id, prompt: remote.val.prompt, files: remote.val.files }),
        outputB: JSON.stringify({ id: local.val.id, prompt: local.val.prompt, files: local.val.files }),
      });
    }

    rows.push({
      sourceTask: srcId,
      remote: remote.record, local: local.record,
      judged: judged ? { winner: judged.winner, consistent: judged.consistent, aScore: judged.aScore, bScore: judged.bScore } : null,
    });
  }

  const agg = (side) => {
    const xs = rows.map((r) => r[side]).filter(Boolean);
    return {
      n: xs.length,
      jsonOk: xs.filter((x) => x.ok).length / (xs.length || 1),
      validatorPass: xs.filter((x) => x.validator).length / (xs.length || 1),
      latency: latencyStats(xs),
      costUsd: round4(xs.reduce((a, x) => a + (x.costUsd ?? 0), 0)),
    };
  };
  return {
    summary: { experiment: "E4-mint-replay", localModel, remoteModel, sources: sources.length, remote: agg("remote"), local: agg("local") },
    rows,
  };
}

// =============================================================== E5 embed

/** E5 — embedding classification lane (H1): nomic-embed zero-shot note triage. */
export async function e5Embed({ localServer, noteLimit = 30 } = {}) {
  const { bridgeUrl, remoteModel } = cfg();
  const notes = loadNotes().slice(0, noteLimit);

  const prototypes = {
    benchmark: "Session note from a sandboxed benchmark task run of a coding agent: task id, pass/fail verification, tools used, agent commentary about the exercise.",
    terminal: "Session note from an interactive terminal coding session in a real project: what the developer asked, what files were edited, what worked and what failed.",
    other: "Miscellaneous note that is neither a benchmark run nor a terminal session: general observation, idea, or chatter.",
  };

  // reference labels from the remote model (cheap single calls)
  const ref = [];
  for (const note of notes) {
    const r = await chat({ baseUrl: bridgeUrl, model: remoteModel, messages: triageMessages(note), maxTokens: 150, temperature: 0 });
    const p = r.ok ? extractJson(r.content) : { ok: false };
    ref.push(p.ok ? p.value?.kind ?? "other" : "unparsed");
  }

  // embed prototypes + notes
  const protoVecs = {};
  for (const [k, text] of Object.entries(prototypes)) {
    const e = await embed({ baseUrl: localServer.baseUrl, model: "nomic-embed", input: text });
    protoVecs[k] = e.ok ? e.vec : null;
  }
  const rows = [];
  for (let i = 0; i < notes.length; i++) {
    const e = await embed({ baseUrl: localServer.baseUrl, model: "nomic-embed", input: String(notes[i].content ?? "").slice(0, 1800) });
    if (!e.ok) { rows.push({ noteId: String(notes[i].id).slice(0, 8), embedOk: false, ref: ref[i] }); continue; }
    const sims = Object.fromEntries(Object.entries(protoVecs).map(([k, v]) => [k, v ? cosine(e.vec, v) : -1]));
    const pred = Object.entries(sims).sort((a, b) => b[1] - a[1])[0][0];
    rows.push({ noteId: String(notes[i].id).slice(0, 8), embedOk: true, latencyMs: e.latencyMs, pred, ref: ref[i], agree: pred === ref[i], topSim: round2(Object.entries(sims).sort((a, b) => b[1] - a[1])[0][1]) });
  }
  const ok = rows.filter((r) => r.embedOk);
  return {
    summary: {
      experiment: "E5-embed-triage",
      n: rows.length,
      embedOkRate: ok.length / (rows.length || 1),
      agreementWithRemote: ok.filter((r) => r.agree).length / (ok.length || 1),
      latency: latencyStats(ok),
    },
    rows,
  };
}

// =============================================================== helpers

function tierText(memExport, tier) {
  const t = memExport?.tiers?.[tier];
  if (!t) return "";
  if (typeof t === "string") return t;
  return t.content ?? "";
}
function round2(x) { return Math.round(x * 100) / 100; }
function round4(x) { return Math.round(x * 10000) / 10000; }
