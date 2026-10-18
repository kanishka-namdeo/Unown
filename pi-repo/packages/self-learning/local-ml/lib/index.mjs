/**
 * local-ml — the OPTIONAL ONNX embedding lane for the Unown engine (H15).
 *
 * Surface (imported by ../src/localml.ts via guarded dynamic import):
 *   export async function embedText(text) -> { ok, vec?, dim?, latencyMs?, error? }
 *   export const backend = "bge-small q8 (transformers.js + onnxruntime-node)"
 *   export async function warm(texts) -> { ok, n }        (pre-embed a batch)
 *
 * Model: Xenova/bge-small-en-v1.5 q8 (33M, ~35MB, MIT, MTEB 62.11) — the
 * H10/H11/H12-verified embedding lane from benchmarks/nonllm. Same pinned
 * transformers.js version as the bench (keep in sync — the bench holds the
 * evidence). Weights download ONCE into this directory's gitignored
 * models/hf-cache on first use (keyless, MIT license).
 *
 * This file is a vendored, trimmed port of benchmarks/nonllm/lib/onnx.mjs
 * (bge-small only). Keep the loader semantics identical to the bench so the
 * H9 cross-platform receipts apply (CI run 39156669131, 3 OSes green).
 *
 * Run `node lib/index.mjs --probe` standalone to verify the lane locally:
 * prints load time, embed latency, and RSS.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.join(HERE, "..");

export const MODEL = {
        id: "Xenova/bge-small-en-v1.5",
        task: "feature-extraction",
        dim: 384,
        params: "33M",
        quant: "q8",
        license: "MIT",
        pooling: "cls",
        normalize: true,
};

export const backend = `bge-small q8 (transformers.js + onnxruntime-node)`;

let tfjs = null;
let pipe = null;
let loadError = null;

async function getTransformers() {
        if (tfjs) return tfjs;
        const mod = await import("@huggingface/transformers");
        // cache into this package's gitignored dir (never the user's HOME)
        mod.env.cacheDir = path.join(PKG_ROOT, "models", "hf-cache");
        mod.env.allowLocalModels = false;
        mod.env.remoteHost = process.env.NONLLM_HF_HOST ?? mod.env.remoteHost;
        tfjs = mod;
        return mod;
}

/** Load the model (cached in-process; records load errors for diagnostics). */
export async function loadModel() {
        if (pipe) return { ok: true, cached: true, backend };
        if (loadError) return { ok: false, cached: false, error: loadError, backend };
        try {
                const mod = await getTransformers();
                const opts = { dtype: "q8", device: "cpu" };
                try {
                        pipe = await mod.pipeline(MODEL.task, MODEL.id, opts);
                } catch {
                        // older artifact sets may reject dtype:q8 — retry default
                        pipe = await mod.pipeline(MODEL.task, MODEL.id);
                }
                return { ok: true, cached: false, backend };
        } catch (err) {
                loadError = String(err?.message ?? err);
                return { ok: false, cached: false, error: loadError, backend };
        }
}

/**
 * Embed one text. Returns { ok, vec (number[]), dim, latencyMs } or
 * { ok: false, error }. Never throws.
 */
export async function embedText(text) {
        const t0 = performance.now();
        try {
                if (!pipe) {
                        const load = await loadModel();
                        if (!load.ok) return { ok: false, error: load.error };
                }
                const out = await pipe(String(text ?? "").slice(0, 4000), {
                        pooling: MODEL.pooling,
                        normalize: MODEL.normalize,
                });
                const vec = out.data ?? out.tolist?.()[0] ?? out[0]?.data;
                if (!vec) return { ok: false, error: "no embedding data in output" };
                return {
                        ok: true,
                        vec: Array.from(vec),
                        dim: Array.isArray(vec) ? vec.length : vec.size,
                        latencyMs: Math.round(performance.now() - t0),
                };
        } catch (err) {
                return { ok: false, error: String(err?.message ?? err), latencyMs: Math.round(performance.now() - t0) };
        }
}

/** Pre-embed a batch (the engine's warm path before the dream lanes run). */
export async function warm(texts) {
        let ok = 0;
        for (const t of texts) {
                const r = await embedText(t);
                if (r.ok) ok++;
        }
        return { ok: ok === texts.length, n: ok, total: texts.length };
}

// ---------------------------------------------------------------- standalone
if (process.argv[1] && process.argv[1].endsWith("index.mjs") && process.argv.includes("--probe")) {
        const rss = () => Math.round(process.memoryUsage().rss / 1024 / 1024);
        const before = rss();
        const t0 = performance.now();
        const load = await loadModel();
        const loadMs = Math.round(performance.now() - t0);
        if (!load.ok) {
                console.error("LOAD FAILED:", load.error);
                process.exit(1);
        }
        const r = await embedText("Warm up the local ONNX embedding lane.");
        console.log(
                JSON.stringify(
                        {
                                ok: r.ok,
                                backend,
                                model: MODEL.id,
                                loadMs,
                                embedMs: r.latencyMs,
                                dim: r.dim,
                                rssDeltaMB: rss() - before,
                        },
                        null,
                        1,
                ),
        );
}
