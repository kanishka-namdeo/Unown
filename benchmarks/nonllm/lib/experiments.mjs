/**
 * experiments.mjs — N0..N5 for the nonllm testbench.
 *
 * Every experiment runs REAL Unown learning-layer workloads (fixtures captured
 * from the live engine, byte-faithful prompt assemblies reused from
 * ../local-llm/lib/prompts.mjs) against:
 *   - LOCAL non-LLM lanes: ONNX encoders via transformers.js (embedding
 *     triage, cosine dedup, cross-encoder rerank), plus ZERO-model symbolic
 *     lanes (MinHash-LSH, LexRank, activation scoring)
 *   - REMOTE baseline: the production model (kimi-k2.5) via the llm-bridge —
 *     for triage labels, relevance/importance judgments, dream outputs and
 *     blind A/B judging (judge.mjs, position-swapped, consistency-gated)
 *
 * Corpus: benchmarks/nonllm/fixtures (live engine export) MERGED with
 * ../local-llm/fixtures (the earlier engine generation, which carries the
 * failed-run notes the current DB lost on re-provision).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chat, extractJson } from "../../local-llm/lib/openai.mjs";
import { judgePair } from "../../local-llm/lib/judge.mjs";
import {
  loadNotes as loadNotesV1, loadRuns as loadRunsV1, loadMemory as loadMemoryV1,
  loadDreams as loadDreamsV1, triageMessages, dreamMessages,
} from "../../local-llm/lib/prompts.mjs";
import { latencyStats, mdTable, pct, num } from "./report.mjs";
import { spearman, accuracy, macroF1, prf, topkOverlap, round, mean } from "./stats.mjs";
import { knnClassify, centroidClassify, cosine } from "./knn.mjs";
import { MinHasher, LshIndex, exactJaccard, perturbations } from "./minhash.mjs";
import { lexrank, compressNote } from "./lexrank.mjs";
import { scoreNotes, recencyScore } from "./activation.mjs";
import {
  MODELS, loadModel, embedText, embedAll, rerankPair, rerankAll,
  rssMB, runtimeInfo, unloadAll,
} from "./onnx.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "..", "fixtures");

export function cfg() {
  return {
    bridgeUrl: process.env.TEST_BRIDGE_URL ?? "http://127.0.0.1:3031",
    remoteModel: process.env.TEST_REMOTE_MODEL ?? "kimi-k2.5",
    judgeModel: process.env.TEST_JUDGE_MODEL ?? "kimi-k2.5",
  };
}

// ---------------------------------------------------------------- corpus

/** Live-engine fixtures (bench-local export). */
function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
}

/**
 * Merged note corpus: live export + the v1 (local-llm) export, tagged by
 * source. Ground truth: kind from the engine's own note rows; outcome from the
 * linked run's status (v1 corpus carries the 4 failed runs).
 */
export function mergedNotes() {
  const live = loadFixture("notes.json").notes;
  const liveRuns = new Map(loadFixture("runs.json").runs.map((r) => [r.id, r.status]));
  const v1 = loadNotesV1();
  const v1Runs = new Map(loadRunsV1().map((r) => [r.id, r.status]));
  const out = [];
  for (const n of live) {
    out.push({
      ...n, source: "live",
      kindGT: n.kind ?? "other",
      outcomeGT: n.run_id && liveRuns.has(n.run_id) ? liveRuns.get(n.run_id) : null,
    });
  }
  for (const n of v1) {
    out.push({
      ...n, source: "v1",
      kindGT: n.kind ?? "other",
      outcomeGT: n.run_id && v1Runs.has(n.run_id) ? v1Runs.get(n.run_id) : null,
    });
  }
  return out;
}

export function currentMemory() {
  const live = loadFixture("memory.json").tiers;
  if (live?.project?.content) return live.project;
  // fall back to the v1 export memory snapshot
  const m = loadMemoryV1();
  return m.tiers?.project ?? m;
}

/** The AutoDream consolidation focus (used as the retrieval/rerank query). */
export const CONSOLIDATION_GOAL =
  "AutoDream memory consolidation for the Unown self-learning coding harness: durable lessons about what makes benchmark task runs pass or fail, workflow pitfalls worth remembering, and reusable procedures for future sessions.";

// =============================================================== N0 probe

/**
 * N0 — runtime viability probe (H9): load each ONNX model, embed/rerank a
 * REAL note, measure cold/cached load, latency, RSS. KEYLESS — the
 * cross-platform CI lane. `models` defaults to all three.
 */
export async function n0Probe({ models = Object.keys(MODELS), reps = 10 } = {}) {
  const note = mergedNotes().find((n) => n.kindGT === "benchmark" && n.content.length > 200) ?? mergedNotes()[0];
  const query = CONSOLIDATION_GOAL;
  const results = [];
  const rssStart = rssMB();

  for (const key of models) {
    const spec = MODELS[key];
    const row = { model: key, hubId: spec.id, params: spec.params, license: spec.license, ...runtimeInfo() };
    const loaded = await loadModel(key);
    row.loadMs = loaded.loadMs;
    row.rssDeltaMB = loaded.rssAfterMB - loaded.rssBeforeMB;
    row.rssMB = loaded.rssAfterMB;
    if (loaded.error) {
      row.loadOk = false; row.error = loaded.error;
      results.push(row);
      continue;
    }
    row.loadOk = true;

    if (spec.task === "feature-extraction") {
      const runs = [];
      for (let i = 0; i < reps; i++) runs.push(await embedText(key, note.content));
      const ok = runs.filter((r) => r.ok);
      row.embedOkRate = ok.length / runs.length;
      row.dim = ok[0]?.dim ?? null;
      const stats = latencyStats(ok);
      row.embedP50ms = stats.p50 ?? null;
      row.embedP90ms = stats.p90 ?? null;
      row.embedMeanMs = stats.mean ?? null;
      row.embedOk = ok.length > 0;
    } else {
      // cross-encoder: one query against `reps` docs (pair latency is the metric)
      const docs = Array.from({ length: reps }, (_, i) => mergedNotes()[i % 25].content);
      const runs = await rerankAll(key, query, docs);
      const ok = runs.filter((r) => r.ok);
      row.rerankOkRate = ok.length / runs.length;
      const stats = latencyStats(ok);
      row.rerankP50ms = stats.p50 ?? null;
      row.rerankP90ms = stats.p90 ?? null;
      row.rerankOk = ok.length > 0;
    }
    results.push(row);
  }

  return {
    experiment: "N0", hypothesis: "H9",
    summary: { runtime: runtimeInfo(), rssStartMB: rssStart, rssPeakMB: rssMB(), results },
  };
}

// =============================================================== N1 triage

/**
 * N1 — embedding triage (H10): classify notes (kind + outcome) with
 * kNN/centroid over local bge-small (and MiniLM comparison lane) embeddings,
 * against the engine's own ground truth; the remote production model's TRIAGE
 * labels (same byte-faithful prompt as E1) as the baseline row.
 */
export async function n1Triage({ noteLimit = 0, noRemote = false, k = 5 } = {}) {
  const { bridgeUrl, remoteModel } = cfg();
  const notes = mergedNotes();
  const corpus = noteLimit ? notes.slice(-noteLimit) : notes;

  // -- local embeddings (both encoder lanes, per-note latency measured)
  const lanes = {};
  for (const key of ["bge-small", "minilm"]) {
    const loaded = await loadModel(key);
    if (loaded.error) { lanes[key] = { error: loaded.error }; continue; }
    const t0 = performance.now();
    const rows = await embedAll(key, corpus.map((n) => n.content));
    lanes[key] = {
      loadMs: loaded.loadMs,
      embedTotalMs: Math.round(performance.now() - t0),
      ok: rows.filter((r) => r.ok).length,
      okRate: rows.filter((r) => r.ok).length / rows.length,
      latency: latencyStats(rows),
      vecs: rows.map((r) => (r.ok ? r.vec : null)),
    };
  }

  // -- remote TRIAGE baseline (byte-faithful E1 prompt)
  const remote = [];
  if (!noRemote) {
    for (const note of corpus) {
      const res = await chat({ baseUrl: bridgeUrl, model: remoteModel, messages: triageMessages(note), maxTokens: 200, temperature: 0 });
      const parsed = res.ok ? extractJson(res.content) : { ok: false };
      remote.push({ ok: res.ok && parsed.ok, kind: parsed.ok ? parsed.value?.kind ?? null : null, outcome: parsed.ok ? parsed.value?.outcome ?? null : null, latencyMs: res.latencyMs });
    }
  }

  // -- ground truth vectors
  const kindGold = corpus.map((n) => n.kindGT);
  const kindLabels = [...new Set(kindGold)];
  const outcomeIdx = corpus.map((n, i) => i).filter((i) => corpus[i].outcomeGT);
  const outcomeGold = outcomeIdx.map((i) => corpus[i].outcomeGT);
  const outcomeLabels = [...new Set(outcomeGold)];

  const evals = {};
  for (const key of Object.keys(lanes)) {
    const lane = lanes[key];
    if (lane.error || !lane.vecs) continue;
    const train = corpus.map((n, i) => ({ vec: lane.vecs[i], label: n.kindGT, index: i })).filter((t) => t.vec);

    // LOO kNN — kind
    const kindRows = [];
    for (let i = 0; i < train.length; i++) {
      const rest = train.filter((_, j) => j !== i);
      kindRows.push({ ...knnClassify(rest, train[i].vec, k), index: train[i].index });
    }
    // LOO kNN — outcome (benchmark-linked notes only)
    const outTrain = train.filter((t) => corpus[t.index].outcomeGT);
    const outRows = [];
    for (const t of outTrain) {
      const rest = outTrain.filter((x) => x !== t);
      if (!rest.length) continue;
      outRows.push({ ...knnClassify(rest, t.vec, k), index: t.index, gold: corpus[t.index].outcomeGT });
    }
    // centroid — kind
    const centRows = train.map((t) => ({ ...centroidClassify(train.filter((x) => x !== t), t.vec), index: t.index }));

    evals[key] = {
      kindKnn: {
        acc: accuracy(kindGold, kindRows.map((r) => r.label ?? "other")),
        macroF1: macroF1(kindGold, kindRows.map((r) => r.label ?? "other"), kindLabels),
        perClass: kindLabels.map((l) => {
          const idx = kindRows.filter((r) => kindGold[r.index] === l);
          return { label: l, n: idx.length, recall: idx.length ? idx.filter((r) => r.label === l).length / idx.length : null };
        }),
      },
      kindCentroid: {
        acc: accuracy(kindGold, centRows.map((r) => r.label ?? "other")),
        macroF1: macroF1(kindGold, centRows.map((r) => r.label ?? "other"), kindLabels),
      },
      outcomeKnn: outRows.length >= 5 ? {
        n: outRows.length,
        acc: accuracy(outRows.map((r) => r.gold), outRows.map((r) => r.label ?? "inconclusive")),
        macroF1: macroF1(outRows.map((r) => r.gold), outRows.map((r) => r.label ?? "inconclusive"), outcomeLabels),
        failedRecall: (() => {
          const f = outRows.filter((r) => r.gold === "failed");
          return f.length ? f.filter((r) => r.label === "failed").length / f.length : null;
        })(),
      } : { n: outRows.length },
      // cascade: accuracy on the confident subset at a few margins
      cascade: [0.05, 0.15, 0.3].map((tau) => {
        const conf = kindRows.filter((r) => r.confidence >= tau);
        return {
          tau,
          coverage: conf.length / kindRows.length,
          acc: conf.length ? accuracy(conf.map((r) => kindGold[r.index]), conf.map((r) => r.label ?? "other")) : null,
        };
      }),
    };
  }

  const remoteEval = noRemote ? null : {
    kindAcc: accuracy(kindGold, remote.map((r) => r.kind ?? "other")),
    kindMacroF1: macroF1(kindGold, remote.map((r) => r.kind ?? "other"), kindLabels),
    parseOkRate: remote.filter((r) => r.ok).length / remote.length,
    latency: latencyStats(remote.filter((r) => r.ok)),
    outcomeNAcc: (() => {
      const idx = outcomeIdx.filter((i) => remote[i]?.outcome);
      return idx.length ? accuracy(idx.map((i) => corpus[i].outcomeGT), idx.map((i) => remote[i].outcome)) : null;
    })(),
  };

  return {
    experiment: "N1", hypothesis: "H10",
    summary: {
      corpus: { n: corpus.length, kinds: kindLabels, outcomes: outcomeLabels.reduce((m, l) => ((m[l] = outcomeGold.filter((g) => g === l).length), m), {}) },
      lanes: Object.fromEntries(Object.entries(evals).map(([k2, v]) => [k2, {
        kindAcc: v.kindKnn.acc, kindMacroF1: v.kindKnn.macroF1, kindCentroidAcc: v.kindCentroid.acc,
        outcomeAcc: v.outcomeKnn.acc ?? null, outcomeFailedRecall: v.outcomeKnn.failedRecall ?? null,
        embedP50ms: lanes[k2].latency?.p50 ?? null, embedOkRate: lanes[k2].okRate,
        cascadeCoverage15: v.cascade.find((c) => c.tau === 0.15)?.coverage ?? null,
        cascadeAcc15: v.cascade.find((c) => c.tau === 0.15)?.acc ?? null,
      }])),
      remote: remoteEval,
      perLane: evals, remoteRaw: { latency: remoteEval?.latency ?? null },
    },
  };
}

// =============================================================== N2 dedup

/**
 * N2 — near-duplicate detection (H11): seeded corpus from real notes
 * (deterministic perturbations + optional remote paraphrases + true negatives),
 * MinHash-LSH vs embedding cosine vs the two-stage combo. Pair P/R/F1 at
 * swept thresholds + ms/doc per lane.
 */
export async function n2Dedup({ bases = 14, useParaphrase = true, thresholds = [0.4, 0.5, 0.6, 0.7], cosThresholds = [0.85, 0.9, 0.92, 0.95] } = {}) {
  const { bridgeUrl, remoteModel } = cfg();
  const corpus = mergedNotes();
  // diverse bases: longest notes across kinds/sources
  const pool = [...corpus].filter((n) => n.content.length > 250).sort((a, b) => b.content.length - a.content.length);
  const picked = [];
  const seenKind = new Map();
  for (const n of pool) {
    const c = seenKind.get(n.kindGT) ?? 0;
    if (c >= Math.ceil(bases / 2)) continue;
    seenKind.set(n.kindGT, c + 1);
    picked.push(n);
    if (picked.length >= bases) break;
  }

  // -- build variants
  const docs = []; // { id, text, baseId? (variant of), kind: 'base'|'variant'|'negative', perturbation }
  const variantsOf = new Map(); // baseId -> [docId]
  for (const n of picked) {
    const baseId = `b-${n.id.slice(0, 8)}`;
    docs.push({ id: baseId, text: n.content, baseId, kind: "base" });
    const perts = perturbations(n.content);
    const vs = [];
    for (const [name, text] of Object.entries(perts)) {
      const id = `${baseId}--${name}`;
      docs.push({ id, text, baseId, kind: "variant", perturbation: name });
      vs.push(id);
    }
    variantsOf.set(baseId, vs);
  }

  // -- remote paraphrases (the HARD near-dups: same facts, different wording)
  let paraphraseCount = 0;
  if (useParaphrase) {
    const targets = picked.slice(0, Math.min(8, picked.length));
    const list = targets.map((n, i) => `${i + 1}. ${n.content.slice(0, 700)}`).join("\n\n");
    const res = await chat({
      baseUrl: bridgeUrl, model: remoteModel, maxTokens: 3500, temperature: 0.3,
      messages: [
        { role: "system", content: "You rewrite session notes. Preserve every fact, outcome and identifier; change wording and sentence structure. Same length roughly." },
        { role: "user", content: `Rewrite each note. Return STRICT JSON: {"rewrites": ["...", ...]} matching the numbering.\n\n${list}` },
      ],
    });
    const parsed = res.ok ? extractJson(res.content) : { ok: false };
    if (parsed.ok && Array.isArray(parsed.value?.rewrites)) {
      parsed.value.rewrites.forEach((text, i) => {
        if (typeof text !== "string" || !text.trim() || i >= targets.length) return;
        const baseId = `b-${targets[i].id.slice(0, 8)}`;
        const id = `${baseId}--paraphrase`;
        docs.push({ id, text, baseId, kind: "variant", perturbation: "paraphrase" });
        variantsOf.get(baseId)?.push(id);
        paraphraseCount++;
      });
    }
  }

  // -- negatives: every base against 2 random OTHER bases (cross pairs are true non-dups)
  const pairs = []; // { a, b, dup: bool, class: perturbation|negative }
  const baseIds = docs.filter((d) => d.kind === "base").map((d) => d.id);
  for (const [i, baseId] of baseIds.entries()) {
    for (const v of variantsOf.get(baseId) ?? []) {
      const cls = docs.find((d) => d.id === v)?.perturbation ?? "variant";
      pairs.push({ a: baseId, b: v, dup: true, class: cls });
    }
    for (let n = 0; n < 2; n++) {
      const other = baseIds[(i + 3 + n * 5) % baseIds.length];
      if (other !== baseId) pairs.push({ a: baseId, b: other, dup: false, class: "negative" });
    }
  }

  // -- lane: MinHash (est Jaccard per labeled pair + timing)
  const hasher = new MinHasher();
  const t0 = performance.now();
  const sigs = new Map();
  for (const d of docs) sigs.set(d.id, hasher.signature(d.text));
  const minhashTotalMs = performance.now() - t0;
  const minhashMsPerDoc = minhashTotalMs / docs.length;

  for (const p of pairs) {
    p.estJaccard = hasher.similarity(sigs.get(p.a).sig, sigs.get(p.b).sig);
    p.exactJaccard = exactJaccard(docs.find((d) => d.id === p.a).text, docs.find((d) => d.id === p.b).text);
  }
  const estMAE = mean(pairs.map((p) => Math.abs(p.estJaccard - p.exactJaccard)));

  // -- lane: embedding cosine
  const loaded = await loadModel("bge-small");
  const embedLane = { error: loaded.error ?? null };
  if (!loaded.error) {
    const tE = performance.now();
    const embRows = await embedAll("bge-small", docs.map((d) => d.text));
    const embedMsPerDoc = (performance.now() - tE) / docs.length;
    const embs = new Map(docs.map((d, i) => [d.id, embRows[i].ok ? embRows[i].vec : null]));
    for (const p of pairs) p.cos = embs.get(p.a) && embs.get(p.b) ? cosine(embs.get(p.a), embs.get(p.b)) : null;
    embedLane.msPerDoc = embedMsPerDoc;
    embedLane.okRate = embRows.filter((r) => r.ok).length / embRows.length;
  }

  // -- sweep thresholds
  const sweep = (scoreFn, ths) => ths.map((th) => {
    let tp = 0, fp = 0, fn = 0;
    for (const p of pairs) {
      const s = scoreFn(p);
      const pred = s !== null && s >= th;
      if (pred && p.dup) tp++;
      else if (pred && !p.dup) fp++;
      else if (!pred && p.dup) fn++;
    }
    return { threshold: th, ...prf(tp, fp, fn) };
  });

  const minhashSweep = sweep((p) => p.estJaccard, thresholds);
  const cosineSweep = embedLane.error ? [] : sweep((p) => p.cos, cosThresholds);

  // -- two-stage: LSH candidates (est >= 0.35) then cosine >= 0.92 confirm
  const lsh = new LshIndex(hasher);
  for (const d of docs) lsh.insert(d.id, d.text);
  const tL = performance.now();
  const cands = lsh.candidatePairs(0.35);
  const lshMs = performance.now() - tL;
  const candSet = new Set(cands.map((p) => (p.a < p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`)));
  let twoStageTp = 0, twoStageFp = 0, twoStageFn = 0;
  for (const p of pairs) {
    const key = p.a < p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`;
    const pred = candSet.has(key) && p.cos !== null && p.cos >= 0.92;
    if (pred && p.dup) twoStageTp++;
    else if (pred && !p.dup) twoStageFp++;
    else if (!pred && p.dup) twoStageFn++;
  }
  const twoStage = { ...prf(twoStageTp, twoStageFp, twoStageFn), lshMs, candidates: candSet.size, lshRecallVsSweep: (() => {
    const dupKeys = new Set(pairs.filter((p) => p.dup).map((p) => (p.a < p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`)));
    const hit = [...dupKeys].filter((k) => candSet.has(k)).length;
    return dupKeys.size ? hit / dupKeys.size : null;
  })() };

  // -- per-perturbation recall at the best operating points
  const bestMinhash = minhashSweep.filter((s) => s.f1 !== null).sort((a, b) => b.f1 - a.f1)[0] ?? {};
  const bestCos = cosineSweep.filter((s) => s.f1 !== null).sort((a, b) => b.f1 - a.f1)[0] ?? {};
  const byClass = [...new Set(pairs.map((p) => p.class))].map((cls) => {
    const subset = pairs.filter((p) => p.class === cls && p.dup);
    return {
      class: cls,
      n: subset.length,
      minhashRecallAtBest: subset.length && bestMinhash.threshold !== undefined ? subset.filter((p) => p.estJaccard >= bestMinhash.threshold).length / subset.length : null,
      cosineRecallAtBest: subset.length && bestCos.threshold !== undefined ? subset.filter((p) => p.cos !== null && p.cos >= bestCos.threshold).length / subset.length : null,
      avgExactJaccard: mean(subset.map((p) => p.exactJaccard)),
      avgCos: mean(subset.map((p) => p.cos)),
    };
  });

  return {
    experiment: "N2", hypothesis: "H11",
    summary: {
      corpus: { bases: baseIds.length, docs: docs.length, pairs: pairs.length, dups: pairs.filter((p) => p.dup).length, negatives: pairs.filter((p) => !p.dup).length, paraphrases: paraphraseCount },
      minhash: { msPerDoc: minhashMsPerDoc, estMAE, bestF1: bestMinhash.f1 ?? null, bestThreshold: bestMinhash.threshold ?? null, sweep: minhashSweep },
      embedding: embedLane.error ? { error: embedLane.error } : { msPerDoc: embedLane.msPerDoc, okRate: embedLane.okRate, bestF1: bestCos.f1 ?? null, bestThreshold: bestCos.threshold ?? null, sweep: cosineSweep },
      twoStage,
      byClass,
    },
  };
}

// =============================================================== N3 rerank

/**
 * N3 — cross-encoder reranking of dream-input candidates (H12): the remote
 * model scores each note 0-10 for consolidation relevance; the local
 * ms-marco cross-encoder (pairwise) and the bge bi-encoder cosine both rank
 * the same candidates. Agreement = Spearman rho + top-5 overlap; latency =
 * ms/pair. Answers: "is a 23M local cross-encoder enough to rank dream
 * inputs instead of an LLM call?"
 */
export async function n3Rerank({ candidates = 20 } = {}) {
  const { bridgeUrl, remoteModel } = cfg();
  const corpus = mergedNotes();
  const notes = corpus.slice(-candidates); // most recent notes = the dream queue
  const query = CONSOLIDATION_GOAL;

  // -- remote relevance judgments (one call, JSON array)
  const list = notes.map((n, i) => `${i}: ${n.content.slice(0, 400).replace(/\n/g, " ")}`).join("\n");
  const res = await chat({
    baseUrl: bridgeUrl, model: remoteModel, maxTokens: 1500, temperature: 0,
    messages: [
      { role: "system", content: "You score session notes by how valuable they are to consolidate into long-term memory for future coding sessions. Be discriminating: routine passes score low, novel lessons/failures/workarounds score high." },
      { role: "user", content: `Score each note 0-10 for consolidation value.\nReturn STRICT JSON: {"scores": [{"i": <index>, "s": <0-10>}, ...]} for every index.\n\n${list}` },
    ],
  });
  const parsed = res.ok ? extractJson(res.content) : { ok: false };
  const remoteScores = new Array(notes.length).fill(null);
  if (parsed.ok && Array.isArray(parsed.value?.scores)) {
    for (const row of parsed.value.scores) {
      const i = Number(row?.i);
      if (Number.isInteger(i) && i >= 0 && i < notes.length) remoteScores[i] = Number(row?.s);
    }
  }
  const remoteOk = remoteScores.filter((s) => s !== null).length;

  // -- local lanes
  const ceLoaded = await loadModel("rerank");
  const ceLane = { error: ceLoaded.error ?? null };
  if (!ceLoaded.error) {
    const rows = await rerankAll("rerank", query, notes.map((n) => n.content));
    ceLane.scores = rows.map((r) => (r.ok ? r.score : null));
    ceLane.okRate = rows.filter((r) => r.ok).length / rows.length;
    ceLane.latency = latencyStats(rows.filter((r) => r.ok));
    ceLane.totalMs = rows.filter((r) => r.ok).reduce((a, b) => a + b.latencyMs, 0);
  }

  const bgeLoaded = await loadModel("bge-small");
  const biLane = { error: bgeLoaded.error ?? null };
  if (!bgeLoaded.error) {
    const qEmb = await embedText("bge-small", query);
    const rows = await embedAll("bge-small", notes.map((n) => n.content));
    biLane.scores = rows.map((r) => (r.ok && qEmb.ok ? cosine(qEmb.vec, r.vec) : null));
    biLane.okRate = rows.filter((r) => r.ok).length / rows.length;
    biLane.latency = latencyStats(rows.filter((r) => r.ok));
  }

  const valid = notes.map((_, i) => i).filter((i) => remoteScores[i] !== null && ceLane.scores?.[i] != null && biLane.scores?.[i] != null);
  const rankOf = (scores) => {
    const idx = valid.slice().sort((a, b) => scores[b] - scores[a]);
    const rank = new Map();
    idx.forEach((i, r) => rank.set(i, r));
    return rank;
  };
  const remoteRank = rankOf(remoteScores);
  const top5 = (scores) => valid.slice().sort((a, b) => scores[b] - scores[a]).slice(0, 5);

  return {
    experiment: "N3", hypothesis: "H12",
    summary: {
      candidates: notes.length,
      remote: { ok: remoteOk, latencyMs: res.latencyMs, tokens: res.usage },
      crossEncoder: ceLane.error ? { error: ceLane.error } : {
        okRate: ceLane.okRate,
        p50ms: ceLane.latency?.p50 ?? null,
        p90ms: ceLane.latency?.p90 ?? null,
        totalMs: ceLane.totalMs,
        spearmanVsRemote: valid.length >= 3 ? round(spearman(valid.map((i) => remoteScores[i]), valid.map((i) => ceLane.scores[i]))) : null,
        top5OverlapVsRemote: round(topkOverlap(top5(remoteScores), top5(ceLane.scores))),
      },
      biEncoder: biLane.error ? { error: biLane.error } : {
        okRate: biLane.okRate,
        p50ms: biLane.latency?.p50 ?? null,
        spearmanVsRemote: valid.length >= 3 ? round(spearman(valid.map((i) => remoteScores[i]), valid.map((i) => biLane.scores[i]))) : null,
        top5OverlapVsRemote: round(topkOverlap(top5(remoteScores), top5(biLane.scores))),
      },
      ceVsBiSpearman: valid.length >= 3 && !ceLane.error && !biLane.error ? round(spearman(valid.map((i) => ceLane.scores[i]), valid.map((i) => biLane.scores[i]))) : null,
    },
  };
}

// =============================================================== N4 activation

/**
 * N4 — non-LLM activation scoring for dream-input curation (H13): Park-2023 /
 * Hou-2024 style scoring (recency decay x relevance x frequency + structural
 * heuristics) vs the remote model's per-note importance ratings. Pure math
 * after one embedding pass — zero LLM calls at runtime.
 */
export async function n4Activation({ noteCount = 40 } = {}) {
  const { bridgeUrl, remoteModel } = cfg();
  const corpus = mergedNotes().slice(-noteCount);
  const nowMs = Date.now();

  // frequency proxy: notes per project_slug (how much activity that context saw)
  const bySlug = new Map();
  for (const n of corpus) {
    const slug = n.project_slug ?? n.source;
    bySlug.set(slug, (bySlug.get(slug) ?? 0) + 1);
  }

  // -- remote importance judgments (one call)
  const list = corpus.map((n, i) => `${i}: ${n.content.slice(0, 350).replace(/\n/g, " ")}`).join("\n");
  const res = await chat({
    baseUrl: bridgeUrl, model: remoteModel, maxTokens: 1500, temperature: 0,
    messages: [
      { role: "system", content: "You rate how important each session note is to carry into future long-term memory. Judge future value, not recency: a hard-won failure lesson beats a routine pass." },
      { role: "user", content: `Rate each note 1-10 for long-term importance.\nReturn STRICT JSON: {"scores": [{"i": <index>, "s": <1-10>}, ...]} for every index.\n\n${list}` },
    ],
  });
  const parsed = res.ok ? extractJson(res.content) : { ok: false };
  const remoteScores = new Array(corpus.length).fill(null);
  if (parsed.ok && Array.isArray(parsed.value?.scores)) {
    for (const row of parsed.value.scores) {
      const i = Number(row?.i);
      if (Number.isInteger(i) && i >= 0 && i < corpus.length) remoteScores[i] = Number(row?.s);
    }
  }

  // -- local embedding pass (relevance component)
  const loaded = await loadModel("bge-small");
  let embs = null, embedMs = null;
  if (!loaded.error) {
    const t0 = performance.now();
    const rows = await embedAll("bge-small", corpus.map((n) => n.content));
    embedMs = performance.now() - t0;
    embs = rows.map((r) => (r.ok ? r.vec : null));
  }
  const goal = embs ? await embedText("bge-small", CONSOLIDATION_GOAL) : { ok: false };

  const tScore = performance.now();
  const rows = scoreNotes({
    notes: corpus.map((n, i) => ({ id: i, content: n.content, created_at: n.created_at, freq: bySlug.get(n.project_slug ?? n.source) })),
    nowMs,
    goalEmb: goal.ok ? goal.vec : null,
    embedOf: embs ? ((n) => embs[n.id]) : null,
  });
  const scoreMs = performance.now() - tScore;
  const byId = new Map(rows.map((r) => [r.id, r]));

  // component ablations vs remote importance
  const valid = corpus.map((_, i) => i).filter((i) => remoteScores[i] !== null && byId.has(i));
  const comp = (pick) => (valid.length >= 3 ? round(spearman(valid.map((i) => remoteScores[i]), valid.map((i) => pick(byId.get(i))))) : null);

  return {
    experiment: "N4", hypothesis: "H13",
    summary: {
      notes: corpus.length,
      remote: { ok: valid.length, latencyMs: res.latencyMs },
      embedMs: embedMs !== null ? Math.round(embedMs) : null,
      scoreMs: Math.round(scoreMs),
      spearman: {
        activationFull: comp((r) => r.activation),
        recencyOnly: comp((r) => r.recency),
        relevanceOnly: comp((r) => r.relevance),
        frequencyOnly: comp((r) => r.frequency),
        structuralOnly: comp((r) => r.structural),
      },
      top5OverlapVsRemote: (() => {
        const remoteTop = valid.slice().sort((a, b) => remoteScores[b] - remoteScores[a]).slice(0, 5);
        const localTop = valid.slice().sort((a, b) => byId.get(b).activation - byId.get(a).activation).slice(0, 5);
        return round(topkOverlap(remoteTop, localTop));
      })(),
    },
  };
}

// =============================================================== N5 dream curation

/**
 * N5 — extractive dream-input curation (H14): AutoDream replayed with FULL
 * notes (control) vs LexRank-compressed notes (treatment), both on the remote
 * production model with the byte-faithful dream prompt. Measures the
 * prompt-token cut and blind-judges whether the resulting NEXT MEMORY is
 * materially worse. The zero-model curation lane.
 */
export async function n5DreamCuration({ notesCount = 12, judge = true } = {}) {
  const { bridgeUrl, remoteModel, judgeModel } = cfg();
  const memory = currentMemory();
  const corpus = mergedNotes().slice(-notesCount);

  // -- control: full notes
  const fullMsgs = dreamMessages(memory, corpus);
  const full = await chat({ baseUrl: bridgeUrl, model: remoteModel, messages: fullMsgs, maxTokens: 2600, temperature: 0.2 });
  const fullParsed = full.ok ? extractJson(full.content) : { ok: false };

  // -- treatment: LexRank top-2-sentence compression per note
  const compressed = corpus.map((n) => {
    const c = compressNote(n.content, { topK: 2, minRatio: 0.35 });
    return { ...n, content: c.text, keptSentences: c.kept, totalSentences: c.total, ratio: c.ratio };
  });
  const compMsgs = dreamMessages(memory, compressed);
  const comp = await chat({ baseUrl: bridgeUrl, model: remoteModel, messages: compMsgs, maxTokens: 2600, temperature: 0.2 });
  const compParsed = comp.ok ? extractJson(comp.content) : { ok: false };

  // -- structural checks (E2 essentials)
  const structural = (parsed) => {
    const v = parsed.ok ? parsed.value : null;
    const md = typeof v?.projectMd === "string" ? v.projectMd : "";
    return {
      jsonOk: parsed.ok,
      saneLength: md.length >= 60 && md.split("\n").length <= 160,
      hasStats: v && v.stats && typeof v.stats.merged === "number",
      suspicious: /<!-- guard:|ignore (all|previous) instructions|disregard (previous|above)/i.test(md),
      lines: md ? md.split("\n").length : 0,
    };
  };
  const fullStruct = structural(fullParsed);
  const compStruct = structural(compParsed);

  // -- token economics
  const fullIn = full.usage.promptTokens ?? Math.round(fullMsgs[1].content.length / 4);
  const compIn = comp.usage.promptTokens ?? Math.round(compMsgs[1].content.length / 4);
  const reduction = fullIn ? 1 - compIn / fullIn : null;

  // -- blind A/B judge (position-swapped, consistency-gated)
  let judged = null;
  if (judge && fullParsed.ok && compParsed.ok) {
    judged = await judgePair({
      bridgeUrl, judgeModel,
      system: "You are reviewing candidate NEXT-VERSION memory files for a self-learning coding agent. Judge which memory file better consolidates the session notes: coverage of durable lessons, precision (no junk), and usable structure.",
      question: "Which next-memory file is better for future sessions?",
      outputA: fullParsed.value.projectMd,
      outputB: compParsed.value.projectMd,
      maxTokens: 600,
    });
  }

  const compression = {
    notes: corpus.length,
    avgKeptRatio: round(mean(compressed.map((c) => c.ratio))),
    fullPromptTokens: fullIn,
    compressedPromptTokens: compIn,
    reductionPct: reduction !== null ? round(100 * reduction, 1) : null,
    fullChars: fullMsgs[1].content.length,
    compressedChars: compMsgs[1].content.length,
  };

  return {
    experiment: "N5", hypothesis: "H14",
    summary: {
      compression,
      control: { latencyMs: full.latencyMs, ...fullStruct, tokens: full.usage },
      curated: { latencyMs: comp.latencyMs, ...compStruct, tokens: comp.usage },
      judge: judged ? { winner: judged.winner, consistent: judged.consistent, aScore: judged.aScore, bScore: judged.bScore, reason: judged.reason } : null,
    },
  };
}
