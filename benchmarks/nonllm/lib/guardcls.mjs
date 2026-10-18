/**
 * guardcls.mjs — local prompt-injection classifier lane (H18).
 *
 * Model: testsavantai/prompt-injection-defender-small-v0-onnx
 * (bert-small, 2-label SAFE/INJECTION, Apache-2.0 per the model card family,
 * purpose-built tiny ONNX artifact, ~114 downloads — chosen because it is
 * UNGATED with in-repo ONNX; the better-known protectai/deberta-v3-*-v2
 * models are gated:auto on the HF hub, which breaks keyless CI and
 * first-run UX).
 *
 * Artifact quirk handled here: the ONNX lives at the repo ROOT
 * (model.onnx), not under onnx/ — transformers.js defaults to the onnx/
 * subfolder, so we pass subfolder:"" + model_file_name:"model".
 *
 * ROLE (from the research digest, §3): a SHADOW triage lane only — encoder
 * classifiers miss obfuscated/base64/homoglyph payloads (the poison corpus's
 * v03/v07 variants), so this can never be the sole gate; it sits beside the
 * deterministic 3-layer guard as a cheap additional signal.
 */
import path from "node:path";
import { BENCH_ROOT } from "./report.mjs";

export const GUARD = {
  id: "testsavantai/prompt-injection-defender-small-v0-onnx",
  labels: { 0: "SAFE", 1: "INJECTION" },
  params: "~29M", quant: "fp32", license: "Apache-2.0 (model card)",
  vendor: "TestSavant (ONNX-native CPU tier)",
  role: "shadow triage lane — never a sole gate",
};

let lane = null;

export function isGuardLoaded() {
  return lane !== null;
}

/** Load the classifier. Tolerant { loadMs, rssDeltaMB, error? } shape. */
export async function loadGuard() {
  if (lane) return { loadMs: 0, cached: true, rssDeltaMB: 0 };
  const t0 = performance.now();
  const rssBefore = Math.round(process.memoryUsage().rss / 1024 / 1024);
  try {
    const mod = await import("@huggingface/transformers");
    mod.env.cacheDir = path.join(BENCH_ROOT, "models", "hf-cache");
    mod.env.allowLocalModels = false;
    mod.env.remoteHost = process.env.NONLLM_HF_HOST ?? mod.env.remoteHost;
    const tokenizer = await mod.AutoTokenizer.from_pretrained(GUARD.id);
    const model = await mod.AutoModelForSequenceClassification.from_pretrained(GUARD.id, {
      device: "cpu", subfolder: "", model_file_name: "model",
    });
    lane = { tokenizer, model };
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
 * Classify texts (chunked batches of CHUNK — a single 70-case batch can throw
 * on constrained hosts and would silently null the whole corpus). Returns
 * per-text { ok, pInjection, logit, latencyMs, error? } — pInjection =
 * softmax over the 2 logits at label 1 (INJECTION).
 */
const CHUNK = 16;

export async function guardClassify(texts) {
  if (!lane) return texts.map(() => ({ ok: false, error: "guard lane not loaded" }));
  const t0 = performance.now();
  const rows = new Array(texts.length).fill(null);
  for (let c = 0; c < texts.length; c += CHUNK) {
    const slice = texts.slice(c, c + CHUNK);
    try {
      // max_length pinned to 512: the artifact ships model_max_length = 1e30
      // (the HF default placeholder), so `truncation: true` alone lets
      // sequences run past the position-embedding table and ONNX dies with a
      // broadcast error at /bert/embeddings/Add_1 (512 by N). Found the hard
      // way on the MPBench long contexts.
      const inputs = lane.tokenizer(slice.map((t) => String(t).slice(0, 4000)), {
        padding: true, truncation: true, max_length: 512,
      });
      const out = await lane.model(inputs);
      const lg = out.logits;
      if (lg?.dims && lg.dims.length === 2 && lg.dims[1] === 2) {
        for (let i = 0; i < slice.length; i++) {
          const a = Number(lg.data[i * 2]);
          const b = Number(lg.data[i * 2 + 1]);
          const m = Math.max(a, b);
          const ea = Math.exp(a - m);
          const eb = Math.exp(b - m);
          rows[c + i] = { ok: true, pInjection: eb / (ea + eb), logit: b - a };
        }
      } else if (lg?.data?.length) {
        for (let i = 0; i < slice.length; i++) {
          const z = Number(lg.data[i] ?? NaN);
          rows[c + i] = Number.isFinite(z)
            ? { ok: true, pInjection: 1 / (1 + Math.exp(-z)), logit: z }
            : { ok: false, error: "non-finite logit" };
        }
      } else {
        for (let i = 0; i < slice.length; i++) rows[c + i] = { ok: false, error: "no logits in classifier output" };
      }
    } catch (err) {
      for (let i = 0; i < slice.length; i++) rows[c + i] = { ok: false, error: String(err?.message ?? err) };
    }
  }
  const dt = Math.round(performance.now() - t0);
  return rows.map((r) => ({ ...(r ?? { ok: false, error: "unclassified" }), latencyMs: Math.round(dt / texts.length) }));
}

export function unloadGuard() {
  lane = null;
}
