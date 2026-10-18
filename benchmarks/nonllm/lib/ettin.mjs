/**
 * ettin.mjs — cross-encoder/ettin-reranker-17m-v1 lane (H16).
 *
 * WHY THIS FILE EXISTS (the artifact gap, found 2026-10-18): the official
 * in-repo ONNX export of the Ettin reranker family is the BASE ModernBERT
 * encoder only — session outputs are `['last_hidden_state']`, config
 * architectures is `["ModernBertModel"]`, and the classification head lives
 * in the sentence-transformers module chain (1_Pooling[cls] → 2_Dense[256→256,
 * GELU, no bias] → 3_LayerNorm[256] → 4_Dense[256→1, bias]) which is NOT fused
 * into the exported graph. Anyone loading `AutoModelForSequenceClassification`
 * through transformers.js gets logits === undefined and a silently mislabeled
 * `attentions` holding last_hidden_state — the same bug class as the ms-marco
 * single-logit softmax trap.
 *
 * The fix implemented here: run the base encoder through transformers.js
 * (the ONNX that DOES exist), then reconstruct the head in pure JS from the
 * safetensors files the repo ships (2_Dense/3_LayerNorm/4_Dense — 263KB total).
 * CLS pooling per modules.json's 1_Pooling (pooling_mode: "cls").
 *
 * Everything here is dependency-free apart from the transformers.js import
 * (guarded — callers handle load failure like any other lane).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { BENCH_ROOT } from "./report.mjs";

export const ETTIN = {
  id: "cross-encoder/ettin-reranker-17m-v1",
  baseOutput: "last_hidden_state", // session outputNames — verified empirically
  hidden: 256,
  head: {
    dense1: { inF: 256, outF: 256, bias: false, act: "gelu" }, // 2_Dense
    layerNorm: { dim: 256 }, // 3_LayerNorm
    dense2: { inF: 256, outF: 1, bias: true, act: "identity" }, // 4_Dense
    pooling: "cls", // 1_Pooling config (pooling_mode: "cls")
  },
  params: "17M", quant: "fp32", license: "Apache-2.0",
  vendor: "cross-encoder (Ettin v1, tomaarsen 2026)",
};

const HEAD_DIR = path.join(BENCH_ROOT, "models", "ettin-head");
const HEAD_FILES = {
  "2_Dense.safetensors": "cross-encoder/ettin-reranker-17m-v1/resolve/main/2_Dense/model.safetensors",
  "3_LayerNorm.safetensors": "cross-encoder/ettin-reranker-17m-v1/resolve/main/3_LayerNorm/model.safetensors",
  "4_Dense.safetensors": "cross-encoder/ettin-reranker-17m-v1/resolve/main/4_Dense/model.safetensors",
};

// ---------------------------------------------------------------- safetensors

/**
 * Parse a .safetensors file into { name: Float32Array } (F32 tensors only).
 * Format: [u64 LE header_len][JSON header][raw tensor bytes]. The header maps
 * name -> { dtype, shape, data_offsets: [start, end] } (offsets relative to
 * the data section start).
 *
 * TRAP (found the hard way): files < ~4KB come back as pooled Buffers —
 * readFileSync allocates them inside Node's shared 8KB ArrayBuffer pool, and
 * the NEXT small readFileSync reuses the same pool bytes. A Float32Array VIEW
 * over `buf.buffer` therefore silently aliases stale/overwritten memory once
 * another file is read (symptoms: weights that re-parse differently on every
 * run, denormals, 48.98M spikes — while the file's sha256 stays perfect).
 * Fix: ALWAYS copy the tensor data out of the view.
 */
export function parseSafetensors(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const headerLen = Number(dv.getBigUint64(0, true));
  const header = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + headerLen)));
  const dataStart = 8 + headerLen;
  const out = {};
  for (const [name, meta] of Object.entries(header)) {
    if (meta.dtype !== "F32") continue;
    // data_offsets are BYTE offsets relative to the data section (NOT element
    // offsets — the s*4 reading was the actual head-NaN bug; tensors starting
    // at byte 0 parsed correctly by luck, everything else read pool garbage)
    const [s, e] = meta.data_offsets;
    const view = new Float32Array(buf.buffer, buf.byteOffset + dataStart + s, (e - s) / 4);
    out[name] = new Float32Array(view); // copy — pooled Buffer aliasing guard
  }
  return out;
}

async function ensureHeadFiles() {
  mkdirSync(HEAD_DIR, { recursive: true });
  const missing = Object.keys(HEAD_FILES).filter((f) => !existsSync(path.join(HEAD_DIR, f)));
  if (!missing.length) return { downloaded: 0 };
  const host = process.env.NONLLM_HF_HOST ?? "https://huggingface.co";
  for (const f of missing) {
    const url = `${host}/${HEAD_FILES[f]}`;
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`ettin head download failed (${res.status}): ${url}`);
    writeFileSync(path.join(HEAD_DIR, f), Buffer.from(await res.arrayBuffer()));
  }
  return { downloaded: missing.length };
}

// ---------------------------------------------------------------- JS head

/** GELU (erf form, Abramowitz-Stegun 7.1.26 rational approximation for erf). */
function gelu(x) {
  // erf(x/sqrt(2)) via the standard approximation (max abs err ~1.5e-7)
  const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  const erf = x >= 0 ? y : -y;
  return 0.5 * x * (1 + erf);
}

function makeHead() {
  const dense1 = parseSafetensors(readFileSync(path.join(HEAD_DIR, "2_Dense.safetensors")));
  const ln = parseSafetensors(readFileSync(path.join(HEAD_DIR, "3_LayerNorm.safetensors")));
  const dense2 = parseSafetensors(readFileSync(path.join(HEAD_DIR, "4_Dense.safetensors")));
  // tensor names inside each module file (2_Dense has one weight; 4_Dense weight+bias; LN weight+bias)
  const pick = (store, suffix) => {
    const key = Object.keys(store).find((k) => k.endsWith(suffix));
    if (!key) throw new Error(`head tensor '${suffix}' not found (keys: ${Object.keys(store).join(",")})`);
    return store[key];
  };
  const w1 = pick(dense1, "weight"); // [256, 256] (out, in) — PyTorch Linear
  const lnW = pick(ln, "weight"); // [256]
  const lnB = pick(ln, "bias"); // [256]
  const w2 = pick(dense2, "weight"); // [1, 256]
  const b2 = pick(dense2, "bias"); // [1]
  if (w1.length !== 256 * 256) throw new Error(`w1 len ${w1.length} != 65536`);
  if (lnW.length !== 256 || lnB.length !== 256) throw new Error("layerNorm dim mismatch");
  if (w2.length !== 256) throw new Error(`w2 len ${w2.length} != 256`);
  const eps = 1e-5;

  /**
   * Head forward on a CLS-pooled hidden vector [256] -> scalar relevance score.
   * PyTorch Linear: y = x @ W^T + b, W stored [out, in].
   */
  return function headForward(x) {
    const h = new Float32Array(256);
    for (let o = 0; o < 256; o++) {
      let acc = 0;
      const row = o * 256;
      for (let i = 0; i < 256; i++) acc += x[i] * w1[row + i];
      h[o] = gelu(acc); // bias: false, activation GELU
    }
    // LayerNorm over 256
    let mu = 0;
    for (let i = 0; i < 256; i++) mu += h[i];
    mu /= 256;
    let varr = 0;
    for (let i = 0; i < 256; i++) varr += (h[i] - mu) * (h[i] - mu);
    const inv = 1 / Math.sqrt(varr / 256 + eps);
    const normed = new Float32Array(256);
    for (let i = 0; i < 256; i++) normed[i] = (h[i] - mu) * inv * lnW[i] + lnB[i];
    // final Dense 256 -> 1 (bias: true)
    let score = b2[0];
    for (let i = 0; i < 256; i++) score += normed[i] * w2[i];
    return score;
  };
}

// ---------------------------------------------------------------- lane API

let lane = null; // { tokenizer, model, head, mod }

export function isEttinLoaded() {
  return lane !== null;
}

/**
 * Load the Ettin lane: base encoder via transformers.js + JS head.
 * Returns { loadMs, cold, rssDeltaMB, error? } — tolerant shape like onnx.mjs.
 */
export async function loadEttin() {
  if (lane) return { loadMs: 0, cached: true, rssDeltaMB: 0 };
  const t0 = performance.now();
  const rssBefore = Math.round(process.memoryUsage().rss / 1024 / 1024);
  try {
    await ensureHeadFiles();
    const mod = await import("@huggingface/transformers");
    mod.env.cacheDir = path.join(BENCH_ROOT, "models", "hf-cache");
    mod.env.allowLocalModels = false;
    mod.env.remoteHost = process.env.NONLLM_HF_HOST ?? mod.env.remoteHost;
    const tokenizer = await mod.AutoTokenizer.from_pretrained(ETTIN.id);
    // the ONNX export is the BASE encoder: use AutoModel, not AutoModelForSequenceClassification
    const model = await mod.AutoModel.from_pretrained(ETTIN.id, { device: "cpu" });
    const head = makeHead();
    lane = { tokenizer, model, head, mod };
    return {
      loadMs: Math.round(performance.now() - t0), cached: false,
      rssDeltaMB: Math.round(process.memoryUsage().rss / 1024 / 1024) - rssBefore,
    };
  } catch (err) {
    return {
      loadMs: Math.round(performance.now() - t0), cached: false, rssDeltaMB: 0,
      error: String(err?.message ?? err),
    };
  }
}

/**
 * Score ONE (query, doc) pair. CLS pooling: the first token's hidden state.
 * Returns { ok, score, logit, latencyMs } (score = sigmoid(logit), matching
 * the ms-marco lane's output convention; ranking metrics are rank-invariant).
 */
export async function ettinPair(query, doc) {
  if (!lane) return { ok: false, error: "ettin lane not loaded" };
  const t0 = performance.now();
  try {
    const inputs = lane.tokenizer(String(query).slice(0, 1000), {
      text_pair: String(doc).slice(0, 2000), padding: true, truncation: true,
    });
    const out = await lane.model(inputs);
    const hidden = out.last_hidden_state; // [1, seq, 256] — the session's ONLY output
    if (!hidden?.dims) return { ok: false, error: "no last_hidden_state in output", latencyMs: Math.round(performance.now() - t0) };
    const seq = hidden.dims[1] ?? hidden.dims[hidden.dims.length - 1];
    const data = hidden.data;
    // CLS = token 0 → first 256 floats
    const cls = new Float32Array(256);
    for (let i = 0; i < 256; i++) cls[i] = data[i];
    void seq;
    const logit = lane.head(cls);
    if (!Number.isFinite(logit)) return { ok: false, error: "non-finite logit", latencyMs: Math.round(performance.now() - t0) };
    return { ok: true, logit, score: 1 / (1 + Math.exp(-logit)), latencyMs: Math.round(performance.now() - t0) };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err), latencyMs: Math.round(performance.now() - t0) };
  }
}

/**
 * Score N docs against one query — same LENGTH-SORTED CHUNK-8 discipline as
 * rerankAll (the N3 engineering receipt applies to any cross-encoder shape).
 * Returns [{ index, ok, score, logit, latencyMs(amortized), totalMs }].
 */
export async function ettinAll(query, docs) {
  if (!lane) return docs.map((_, i) => ({ index: i, ok: false, error: "ettin lane not loaded" }));
  const t0 = performance.now();
  try {
    const CHUNK = 8;
    const order = docs.map((_, i) => i).sort((a, b) => String(docs[a]).length - String(docs[b]).length);
    const out = new Array(docs.length);
    for (let c = 0; c < order.length; c += CHUNK) {
      const idx = order.slice(c, c + CHUNK);
      const inputs = lane.tokenizer(idx.map(() => String(query).slice(0, 1000)), {
        text_pair: idx.map((i) => String(docs[i]).slice(0, 2000)),
        padding: true, truncation: true,
      });
      const res = await lane.model(inputs);
      const hidden = res.last_hidden_state;
      if (!hidden?.dims) throw new Error("no last_hidden_state in batch output");
      // dims = [batch, seq, hidden=256]: doc j's CLS starts at j*seq*256
      if (hidden.dims.length !== 3 || hidden.dims[2] !== 256) {
        throw new Error(`unexpected hidden dims [${hidden.dims}] (expected [n, seq, 256])`);
      }
      const seq = hidden.dims[1];
      const data = hidden.data;
      for (let j = 0; j < idx.length; j++) {
        const off = j * seq * 256;
        const cls = new Float32Array(256);
        for (let i = 0; i < 256; i++) cls[i] = data[off + i];
        const logit = lane.head(cls);
        out[idx[j]] = Number.isFinite(logit)
          ? { index: idx[j], ok: true, logit, score: 1 / (1 + Math.exp(-logit)) }
          : { index: idx[j], ok: false, error: "non-finite logit" };
      }
    }
    const totalMs = Math.round(performance.now() - t0);
    const per = docs.length ? Math.round(totalMs / docs.length) : totalMs;
    return out.map((r, i) => ({ ...r, index: i, latencyMs: per, totalMs }));
  } catch (err) {
    return docs.map((_, i) => ({ index: i, ok: false, error: String(err?.message ?? err), latencyMs: null }));
  }
}

export function unloadEttin() {
  lane = null;
}
