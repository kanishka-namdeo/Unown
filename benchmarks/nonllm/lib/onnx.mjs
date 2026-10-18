/**
 * onnx.mjs — local ONNX encoder lane via transformers.js (+ onnxruntime-node
 * backend). This is the ONLY file that touches native deps; everything else in
 * the bench is dependency-free so `node --test lib/renders.test.mjs` runs
 * without an install (mirrors local-llm's "pure Node runner" discipline).
 *
 * Cross-platform gate (H9): onnxruntime-node ships prebuilds for
 * linux-x64/arm64, darwin-x64/arm64, win32-x64 — matching Unown's matrix.
 * Bun compatibility: transformers.js >= v3 is Bun-supported (the single known
 * onnxruntime-node regression, bun#18079, was fixed in Bun 1.2.6+); we still
 * record runtime identity and assert both runtimes in N0.
 *
 * Models (all downloaded ONCE into the gitignored HF cache under models/):
 *   bge-small   Xenova/bge-small-en-v1.5        33M q8 ~35MB  MIT       (embed, cls-pooling)
 *   minilm      Xenova/all-MiniLM-L6-v2         22M q8 ~23MB  Apache-2.0 (embed, mean-pooling)
 *   rerank      Xenova/ms-marco-MiniLM-L-6-v2   23M q8 ~23MB  Apache-2.0 (cross-encoder relevance)
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { BENCH_ROOT } from "./report.mjs";

export const MODELS = {
  "bge-small": {
    id: "Xenova/bge-small-en-v1.5", task: "feature-extraction", dim: 384,
    params: "33M", quant: "q8", license: "MIT", vendor: "BAAI (ONNX: Xenova)",
    pooling: "cls", normalize: true, // bge family: CLS pooling + L2 normalize
  },
  "minilm": {
    id: "Xenova/all-MiniLM-L6-v2", task: "feature-extraction", dim: 384,
    params: "22M", quant: "q8", license: "Apache-2.0", vendor: "sentence-transformers (ONNX: Xenova)",
    pooling: "mean", normalize: true,
  },
  "rerank": {
    id: "Xenova/ms-marco-MiniLM-L-6-v2", task: "text-classification", dim: null,
    params: "23M", quant: "q8", license: "Apache-2.0", vendor: "cross-encoder (ONNX: Xenova)",
    pair: true, // { text, text_pair } relevance scoring, LABEL_0 = relevant
  },
};

export function runtimeInfo() {
  return {
    runtime: process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`,
    isBun: Boolean(process.versions.bun),
    platform: `${process.platform}-${process.arch}`,
  };
}

/** RSS in MB (process.memoryUsage is portable; /proc read is more precise on Linux). */
export function rssMB() {
  try {
    if (process.platform === "linux") {
      const status = readFileSync("/proc/self/status", "utf8");
      const m = status.match(/VmRSS:\s+(\d+) kB/);
      if (m) return Math.round(Number(m[1]) / 1024);
    }
  } catch { /* fall through */ }
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

// ---------------------------------------------------------------- loader

let tfjs = null; // cached module handle
let pipelines = new Map(); // key -> loaded pipeline
let rerankRaw = null; // { tokenizer, model } for the single-logit cross-encoder

async function getTransformers() {
  if (tfjs) return tfjs;
  const mod = await import("@huggingface/transformers");
  // cache into the bench-local gitignored dir (never the user's HOME)
  mod.env.cacheDir = path.join(BENCH_ROOT, "models", "hf-cache");
  mod.env.allowLocalModels = false; // avoid noisy file:// lookups; we always fetch from the hub
  mod.env.remoteHost = process.env.NONLLM_HF_HOST ?? mod.env.remoteHost; // escape hatch for mirrors
  tfjs = mod;
  return mod;
}

/**
 * Load a model pipeline. Returns { key, loadMs, cold (downloaded this call),
 * rssBeforeMB, rssAfterMB, error? }. Loads are cached in-process.
 */
export async function loadModel(key, { force = false } = {}) {
  const spec = MODELS[key];
  if (!spec) throw new Error(`unknown model key: ${key}`);
  if (!force && pipelines.has(key)) {
    return { key, loadMs: 0, cached: true, cold: false, rssBeforeMB: rssMB(), rssAfterMB: rssMB(), spec };
  }
  const t0 = performance.now();
  const rssBeforeMB = rssMB();
  try {
    const mod = await getTransformers();
    if (spec.pair) {
      // single-logit cross-encoder: load tokenizer + model directly (the
      // text-classification pipeline softmaxes the 1-element logit -> always 1.0)
      let tokenizer, model;
      try {
        tokenizer = await mod.AutoTokenizer.from_pretrained(spec.id);
        model = await mod.AutoModelForSequenceClassification.from_pretrained(spec.id, { dtype: "q8", device: "cpu" });
      } catch (e1) {
        tokenizer = await mod.AutoTokenizer.from_pretrained(spec.id);
        model = await mod.AutoModelForSequenceClassification.from_pretrained(spec.id);
      }
      rerankRaw = { tokenizer, model };
    } else {
      const opts = { dtype: "q8", device: "cpu" };
      let pipe;
      try {
        pipe = await mod.pipeline(spec.task, spec.id, opts);
      } catch (e1) {
        // Older artifact sets / registries may not accept dtype:q8 — retry default.
        pipe = await mod.pipeline(spec.task, spec.id);
      }
      pipelines.set(key, pipe);
    }
    pipelines.set(`${key}:ready`, true); // marker so isLoaded() covers the raw lane too
    return { key, loadMs: Math.round(performance.now() - t0), cached: false, cold: false, rssBeforeMB, rssAfterMB: rssMB(), spec };
  } catch (err) {
    return { key, loadMs: Math.round(performance.now() - t0), cached: false, cold: false, rssBeforeMB, rssAfterMB: rssMB(), spec, error: String(err?.message ?? err) };
  }
}

export function isLoaded(key) { return pipelines.has(key) || (key === "rerank" && rerankRaw !== null); }

// ---------------------------------------------------------------- inference

/**
 * Embed one text with an embedding model. Returns { ok, vec, dim, latencyMs }.
 */
export async function embedText(key, text) {
  const pipe = pipelines.get(key);
  if (!pipe) return { ok: false, error: `model not loaded: ${key}` };
  const spec = MODELS[key];
  const t0 = performance.now();
  try {
    const out = await pipe(text, { pooling: spec.pooling, normalize: spec.normalize });
    const vec = out.data ?? out.tolist?.()[0] ?? out[0]?.data;
    if (!vec) return { ok: false, error: "no embedding data in output", latencyMs: Math.round(performance.now() - t0) };
    return { ok: true, vec: Array.from(vec), dim: (Array.isArray(vec) ? vec.length : vec.size), latencyMs: Math.round(performance.now() - t0) };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err), latencyMs: Math.round(performance.now() - t0) };
  }
}

/** Embed many texts, reporting per-text latency (the honest per-note number). */
export async function embedAll(key, texts) {
  const rows = [];
  for (const t of texts) {
    const r = await embedText(key, t);
    rows.push(r);
  }
  return rows;
}

/**
 * Cross-encoder relevance score of (query, doc). ms-marco-MiniLM is a
 * SINGLE-LOGIT binary classifier (logit > 0 = relevant): the text-classification
 * pipeline softmaxes a 1-element vector and always returns LABEL_0 = 1.0, so
 * we run the tokenizer + model directly and sigmoid the raw logit
 * (verified on the canonical pair: +9.27 relevant / -11.19 irrelevant).
 */
export async function rerankPair(key, query, doc) {
  if (!rerankRaw) return { ok: false, error: `model not loaded: ${key}` };
  const t0 = performance.now();
  try {
    const inputs = rerankRaw.tokenizer(String(query).slice(0, 1000), { text_pair: String(doc).slice(0, 2000), padding: true, truncation: true });
    const { logits } = await rerankRaw.model(inputs);
    const logit = Number(logits.data[0]);
    if (!Number.isFinite(logit)) return { ok: false, error: "no finite logit in reranker output", latencyMs: Math.round(performance.now() - t0) };
    return { ok: true, score: 1 / (1 + Math.exp(-logit)), logit, latencyMs: Math.round(performance.now() - t0) };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err), latencyMs: Math.round(performance.now() - t0) };
  }
}

/** Rerank N docs against one query, preserving order; returns rows with scores + latency. */
export async function rerankAll(key, query, docs) {
  const rows = [];
  for (let i = 0; i < docs.length; i++) {
    const r = await rerankPair(key, query, docs[i]);
    rows.push({ index: i, ...r });
  }
  return rows;
}

/** Unload everything (drop native memory) — used between experiment phases. */
export function unloadAll() {
  pipelines = new Map();
  rerankRaw = null;
  tfjs = null;
}
