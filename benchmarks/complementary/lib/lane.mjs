/**
 * lane.mjs — shared lane plumbing for the complementary testbench.
 *
 * Reuses the local-llm lane (llama.cpp lifecycle, OpenAI client, prompts,
 * fixtures, judge, report) via cross-directory imports — the same pattern
 * nonllm uses. Adds: extra-model provisioning (Qwen3.5-0.8B + mmproj,
 * Qwen2.5-0.5B draft), a timed non-stream chat that surfaces llama-server's
 * `timings` block (prompt_n / prompt_ms / predicted_per_second — the
 * instrument for the C1-C3 speed experiments), /tokenize, and raw
 * /completion access.
 *
 * Pure Node >= 18, no native deps.
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LocalLlamaServer,
  MODELS_DIR,
  provisionEngine,
  provisionModel,
} from "../../local-llm/lib/llama.mjs";
import { chat as chatStream } from "../../local-llm/lib/openai.mjs";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BENCH_ROOT = path.resolve(HERE, "..");
export const RESULTS_DIR = path.join(BENCH_ROOT, "results");
export const MODELS_EXT_DIR = path.join(BENCH_ROOT, "models");

/** Results persistence for THIS bench (same shape as local-llm report.mjs, own dir). */
export function newRunDir(label) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const dir = path.join(RESULTS_DIR, label ?? `${stamp}-${process.platform}-${process.arch}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
export function saveJson(dir, name, obj) {
  const p = path.join(dir, name);
  writeFileSync(p, JSON.stringify(obj, null, 1));
  return p;
}

/** The incumbent lane models we reuse from ../local-llm (already provisioned there). */
export const INCUMBENT = "qwen3-0.6b";
export const EMBED_MODEL = "nomic-embed-v2";

/**
 * Extra models for THIS campaign. `mmproj` optionally names a vision
 * projector GGUF shipped in the same HF repo (provisioned alongside).
 */
export const EXT_MODELS = {
  "qwen3.5-0.8b": {
    file: "qwen3.5-0.8b-q4km.gguf",
    hf: "lmstudio-community/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf",
    mmproj: { file: "qwen3.5-0.8b-mmproj-bf16.gguf", hf: "lmstudio-community/Qwen3.5-0.8B-GGUF/mmproj-Qwen3.5-0.8B-BF16.gguf" },
    params: "0.8B", quant: "Q4_K_M", ctxDefault: 4096, vendor: "Qwen", license: "Apache-2.0",
    arch: "qwen35 (hybrid Gated DeltaNet + attention)", vision: true,
  },
  "qwen2.5-0.5b-draft": {
    file: "qwen2.5-0.5b-q4km.gguf",
    hf: "Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q4_k_m.gguf",
    params: "0.5B", quant: "Q4_K_M", ctxDefault: 2048, vendor: "Qwen", license: "Apache-2.0",
    role: "specdec draft (candidate for Qwen3-0.6B target)",
  },
};

/** Provision an EXT model (and its mmproj when present). Idempotent. */
export async function provisionExt(id) {
  const spec = EXT_MODELS[id];
  if (!spec) throw new Error(`unknown ext model: ${id} (known: ${Object.keys(EXT_MODELS).join(", ")})`);
  await provisionEngine();
  mkdirSync(MODELS_EXT_DIR, { recursive: true });
  const out = {};
  const grab = async (file, hf) => {
    const dest = path.join(MODELS_EXT_DIR, file);
    if (existsSync(dest) && statSync(dest).size > 10_000_000) return { path: dest, cached: true };
    console.log(`[provision] downloading ${id} :: ${file} (${hf}) …`);
    const parts = hf.split("/");
    const repo = parts.slice(0, 2).join("/");
    const fileHf = parts.slice(2).join("/");
    const url = `https://huggingface.co/${repo}/resolve/main/${fileHf}`;
    await downloadTo(url, dest + ".part");
    renameSync(dest + ".part", dest);
    return { path: dest, cached: false };
  };
  out.model = await grab(spec.file, spec.hf);
  if (spec.mmproj) out.mmproj = await grab(spec.mmproj.file, spec.mmproj.hf);
  return out;
}

/** Absolute path for an EXT model file (assumes provisioned). */
export function extModelPath(id) {
  const spec = EXT_MODELS[id];
  if (!spec) throw new Error(`unknown ext model: ${id}`);
  return path.join(MODELS_EXT_DIR, spec.file);
}
export function extMmprojPath(id) {
  const spec = EXT_MODELS[id];
  if (!spec?.mmproj) throw new Error(`no mmproj for ${id}`);
  return path.join(MODELS_EXT_DIR, spec.mmproj.file);
}

/**
 * Start a llama-server on ANY model: a local-llm roster key (qwen3-0.6b,
 * nomic-embed-v2 — provisions on demand) or an EXT_MODELS key (provisions on
 * demand). LocalLlamaServer resolves `model` against ITS OWN MODELS_DIR via
 * path.join, so EXT models are passed as a path RELATIVE to that dir
 * (../../complementary/models/<file>) — no upstream churn needed.
 */
export async function startLane({ model = INCUMBENT, ctx, extraArgs = [], port = 0, timeoutMs = 180_000 } = {}) {
  if (EXT_MODELS[model]) await provisionExt(model);
  else {
    // local-llm roster key (qwen3-0.6b, nomic-embed-v2) — idempotent provisioning
    await provisionEngine();
    await provisionModel(model);
  }
  let modelArg = model;
  if (EXT_MODELS[model]) {
    modelArg = path.relative(MODELS_DIR, extModelPath(model));
  }
  const server = new LocalLlamaServer({ model: modelArg, ctx: ctx ?? EXT_MODELS[model]?.ctxDefault ?? 4096, extraArgs, port });
  await server.start({ timeoutMs });
  return server;
}

/**
 * Timed non-stream chat completion against llama-server's OpenAI endpoint.
 * llama.cpp appends a `timings` object to the non-stream response —
 * { prompt_n, prompt_ms, prompt_per_second, predicted_n, predicted_ms,
 *   predicted_per_second } — surfaced here (null-safe: falls back to
 * latency-only if a build omits it).
 */
export async function chatTimed({ baseUrl, model, messages, maxTokens = 1500, temperature = 0, jsonSchema, extra, timeoutMs = 600_000 }) {
  const body = { model, messages, max_tokens: maxTokens, stream: false, temperature };
  if (jsonSchema) body.response_format = { type: "json_schema", json_schema: { name: "out", schema: jsonSchema, strict: true } };
  if (extra) Object.assign(body, extra);
  const t0 = performance.now();
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
    err.httpStatus = res.status;
    throw err;
  }
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error(`non-JSON response: ${text.slice(0, 200)}`); }
  const t = j.timings ?? null;
  return {
    content: j.choices?.[0]?.message?.content ?? "",
    usage: {
      promptTokens: j.usage?.prompt_tokens ?? null,
      completionTokens: j.usage?.completion_tokens ?? null,
    },
    timings: t ? {
      promptN: t.prompt_n ?? null,
      promptMs: t.prompt_ms ?? null,
      promptPerSecond: t.prompt_per_second ?? null,
      predictedN: t.predicted_n ?? null,
      predictedMs: t.predicted_ms ?? null,
      predictedPerSecond: t.predicted_per_second ?? null,
    } : null,
    latencyMs: Math.round(performance.now() - t0),
    raw: j,
  };
}

/** Raw /completion endpoint (llama.cpp native): prompt in, timings out. */
export async function rawCompletion({ baseUrl, prompt, maxTokens = 512, temperature = 0, timeoutMs = 600_000, extra = {} }) {
  const body = { prompt, n_predict: maxTokens, temperature, ...extra };
  const t0 = performance.now();
  const res = await fetch(`${baseUrl}/completion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  const j = JSON.parse(text);
  const t = j.timings ?? {};
  return {
    content: j.content ?? "",
    stoppedEos: j.stopped_eos ?? null,
    stoppedWord: j.stopping_word ?? null,
    timings: {
      promptN: t.prompt_n ?? null,
      promptMs: t.prompt_ms ?? null,
      promptPerSecond: t.prompt_per_second ?? null,
      predictedN: t.predicted_n ?? null,
      predictedMs: t.predicted_ms ?? null,
      predictedPerSecond: t.predicted_per_second ?? null,
    },
    latencyMs: Math.round(performance.now() - t0),
    raw: j,
  };
}

/** Tokenize text via llama-server (returns token count + ids). */
export async function tokenize({ baseUrl, text }) {
  const res = await fetch(`${baseUrl}/tokenize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`tokenize HTTP ${res.status}`);
  const j = await res.json();
  return { n: Array.isArray(j.tokens) ? j.tokens.length : null, tokens: j.tokens ?? null };
}

/**
 * Probe: does this build's /completion accept prompt-logprobs? (LLMLingua-1
 * style token-drop needs per-prompt-token logprobs; chunk-select is the
 * fallback.) Returns {supported, field} — never throws.
 */
export async function probePromptLogprobs(baseUrl) {
  const candidates = [
    { prompt_logprobs: 0 },
    { prompt_logprobs: 1 },
    { logprobs: 1, n_predict: 0 },
  ];
  for (const extra of candidates) {
    try {
      const res = await fetch(`${baseUrl}/completion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "the quick brown fox", n_predict: 1, temperature: 0, ...extra }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const j = await res.json().catch(() => null);
        if (j && (j.prompt_logprobs || j.logprobs || (extra.prompt_logprobs !== undefined && res.ok))) {
          return { supported: true, field: JSON.stringify(extra), sample: JSON.stringify(j.prompt_logprobs ?? j.logprobs ?? null).slice(0, 120) };
        }
      }
    } catch { /* try next */ }
  }
  return { supported: false, field: null, sample: null };
}

/** Streaming chat passthrough (reuses local-llm client) for TTFT-inclusive replays. */
export function chatStreamed(opts) {
  return chatStream(opts);
}

/** Median + ratio helpers for speed receipts. */
export function median(xs) {
  const a = xs.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.floor(a.length / 2)];
}

// ---------------------------------------------------------------- download

function downloadTo(url, dest) {
  return new Promise((resolve, reject) => {
    (async () => {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) return reject(new Error(`download ${res.status} for ${url}`));
      const out = createWriteStream(dest);
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          out.write(Buffer.from(value));
        }
        out.end(() => resolve(dest));
      } catch (e) {
        out.destroy();
        reject(e);
      }
    })().catch(reject);
  });
}
