#!/usr/bin/env node
/**
 * runner.mjs — the local-llm testbench driver for Unown.
 *
 * Hypothesis-driven experiment bench for evaluating FULLY-LOCAL, performance-
 * optimized LLMs (llama.cpp + small GGUF quants) against the production remote
 * model on Unown's real learning-layer subtasks. Cross-platform by design
 * (Linux/macOS/Windows, x64/arm64) — `probe` + local-only modes need no API
 * key and run anywhere Node >= 18 runs.
 *
 * Usage:
 *   node runner.mjs provision [--models qwen3-0.6b,lfm2.5-2.6b] [--engine-only]
 *   node runner.mjs probe [models...]              # E0: startup/RAM/tok/s per model
 *   node runner.mjs detect                         # scan for existing local runtimes
 *   node runner.mjs e1-triage --model qwen3-0.6b [--no-remote] [--notes N]
 *   node runner.mjs e2-dream    --model lfm2.5-2.6b [--no-grammar]
 *   node runner.mjs e3-mine     --model qwen3-0.6b [--no-grammar]
 *   node runner.mjs e4-mint     --model lfm2.5-2.6b
 *   node runner.mjs e5-embed                        # needs nomic-embed-v2
 *   node runner.mjs all [--models a,b] [--quick]    # full suite -> results/<run>/
 *
 * Env: TEST_BRIDGE_URL (default http://127.0.0.1:3031), TEST_REMOTE_MODEL
 * (default kimi-k2.5), TEST_JUDGE_MODEL, LLAMA_BUILD (default b11718).
 */
import { cpus } from "node:os";
import {
  MODELS, LLAMA_BUILD, LocalLlamaServer, provisionEngine, provisionModel,
  platformSpec, hostInfo, llamaBinPath, RESULTS_DIR, sleep,
} from "./lib/llama.mjs";
import { chat } from "./lib/openai.mjs";
import { newRunDir, saveJson, mdTable } from "./lib/report.mjs";
import { e1Triage, e2Dream, e3Mine, e4Mint, e5Embed, cfg } from "./lib/experiments.mjs";
import { renderE1, renderE2, renderE3, renderE4, renderE5 } from "./lib/renders.mjs";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const modelsArg = () => (opt("models", "") || "").split(",").map((s) => s.trim()).filter(Boolean);

const CHAT_MODEL_IDS = Object.keys(MODELS).filter((m) => !MODELS[m].embedding);

// ---------------------------------------------------------------- provision

async function cmdProvision() {
  const { bin, cached } = await provisionEngine({ force: flag("force") });
  console.log(`[provision] engine: ${bin} ${cached ? "(cached)" : "(downloaded)"}`);
  if (flag("engine-only")) return;
  const ids = modelsArg().length ? modelsArg() : Object.keys(MODELS);
  for (const id of ids) {
    const { path: p, cached: c } = await provisionModel(id);
    console.log(`[provision] model ${id}: ${p} ${c ? "(cached)" : "(downloaded)"}`);
  }
}

// ---------------------------------------------------------------- E0 probe

async function cmdProbe(outDir) {
  const dir = outDir ?? newRunDir("probe");
  const ids = args.slice(1).filter((a) => !a.startsWith("--"));
  const runIds = ids.length ? ids : CHAT_MODEL_IDS;
  const results = [];
  for (const id of runIds) {
    console.log(`\n=== E0 probe: ${id} ===`);
    const server = new LocalLlamaServer({ model: id, ctx: MODELS[id].ctxDefault });
    const r = { model: id, ...MODELS[id], host: hostInfo() };
    try {
      await server.start();
      r.startupMs = server.startupMs;
      r.rssMB = await server.rssMB();

      // generation speed: 96-token completion of a tiny prompt (thinking off)
      const gen = await chat({ baseUrl: server.baseUrl, model: id, stream: true, maxTokens: 96, temperature: 0, extra: { chat_template_kwargs: { enable_thinking: false } }, messages: [{ role: "user", content: "Count from 1 to 150, comma-separated, no other text." }] });
      if (gen.ok) {
        const toks = gen.usage.completionTokens ?? gen.approxTokens ?? null;
        r.genTokens = toks;
        r.genLatencyMs = gen.latencyMs;
        r.ttftMs = gen.ttftMs;
        r.genTokPerSec = toks ? round2(toks / (gen.latencyMs / 1000)) : null;
      } else r.genError = gen.error;

      // prefill speed: ~1400-token prompt, 1-token completion
      const filler = Array.from({ length: 120 }, (_, i) => `Line ${i}: the quick brown fox jumps over the lazy dog while agents run benchmarks and verify tests offline.`).join("\n");
      const pre = await chat({ baseUrl: server.baseUrl, model: id, stream: false, maxTokens: 4, temperature: 0, messages: [{ role: "user", content: `${filler}\n\nReply with the single word OK.` }] });
      if (pre.ok) {
        r.prefillPromptTokens = pre.usage.promptTokens;
        r.prefillLatencyMs = pre.latencyMs;
        r.prefillTokPerSec = pre.usage.promptTokens ? round2(pre.usage.promptTokens / (pre.latencyMs / 1000)) : null;
      } else r.prefillError = pre.error;

      // JSON-schema mode sanity: constrained decoding works (thinking off)
      const js = await chat({
        baseUrl: server.baseUrl, model: id, stream: false, maxTokens: 200, temperature: 0,
        extra: { chat_template_kwargs: { enable_thinking: false } },
        jsonSchema: { type: "object", properties: { a: { type: "integer" }, b: { type: "string" } }, required: ["a", "b"] },
        messages: [{ role: "user", content: 'Return JSON {"a": 42, "b": "hello"}' }],
      });
      r.jsonSchemaOk = js.ok && /^\{/.test(js.content) && /"a"\s*:/.test(js.content);
      results.push(r);
      console.log(mdTable([pick(r, ["model", "params", "startupMs", "rssMB", "genTokPerSec", "ttftMs", "prefillTokPerSec", "jsonSchemaOk"])]));
    } catch (err) {
      results.push({ model: id, error: String(err?.message ?? err), ...MODELS[id] });
      console.error(`  ERROR: ${err?.message ?? err}`);
    } finally {
      await server.stop();
    }
  }
  saveJson(dir, "e0-probe.json", { generatedAt: new Date().toISOString(), llamaBuild: LLAMA_BUILD, results });
  console.log(`\n[probe] saved ${dir}/e0-probe.json`);
}

// ---------------------------------------------------------------- detect

async function cmdDetect() {
  const ports = [
    { port: 11434, name: "Ollama" }, { port: 1234, name: "LM Studio" },
    { port: 1337, name: "Jan" }, { port: 8080, name: "llama-server/llamafile (legacy)" },
    { port: 9931, name: "llama-server (default since v0.7.0)" }, { port: 5001, name: "koboldcpp" },
    { port: 8000, name: "vLLM" },
  ];
  const found = [];
  for (const { port, name } of ports) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(700) });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        found.push({ port, name, models: (j.data ?? []).map((m) => m.id).slice(0, 6) });
      }
    } catch { /* nothing here */ }
  }
  console.log(found.length ? mdTable(found.map((f) => ({ runtime: f.name, port: f.port, models: f.models.join(", ") }))) : "No local OpenAI-compatible runtimes detected on common ports.");
  return found;
}

// ---------------------------------------------------------------- experiments

async function withLocal(modelId, ctx, fn) {
  const server = new LocalLlamaServer({ model: modelId, ctx: Number(opt("ctx", 0)) || ctx });
  await server.start();
  console.log(`[server] ${modelId} up in ${server.startupMs}ms on :${server.actualPort} (rss ${await server.rssMB()}MB)`);
  try {
    return await fn(server);
  } finally {
    await server.stop();
    console.log(`[server] ${modelId} stopped`);
  }
}

async function cmdE1(outDir) {
  const model = opt("model", "qwen3-0.6b");
  const dir = outDir ?? newRunDir(`e1-${model}`);
  const r = await withLocal(model, MODELS[model].ctxDefault, (server) => e1Triage({ localServer: server, localModel: model, noteLimit: Number(opt("notes", 30)), noRemote: flag("no-remote") }));
  saveJson(dir, "e1-triage.json", r);
  renderE1(r);
  return r;
}

async function cmdE2(outDir) {
  const model = opt("model", "lfm2.5-2.6b");
  const dir = outDir ?? newRunDir(`e2-${model}`);
  const r = await withLocal(model, MODELS[model].ctxDefault, (server) => e2Dream({ localServer: server, localModel: model, grammar: !flag("no-grammar"), noteLimit: Number(opt("notes", 12)) }));
  saveJson(dir, "e2-dream.json", r);
  renderE2(r);
  return r;
}

async function cmdE3(outDir) {
  const model = opt("model", "qwen3-0.6b");
  const dir = outDir ?? newRunDir(`e3-${model}`);
  const r = await withLocal(model, MODELS[model].ctxDefault, (server) => e3Mine({ localServer: server, localModel: model, grammar: !flag("no-grammar"), runLimit: Number(opt("runs", 4)) }));
  saveJson(dir, "e3-mine.json", r);
  renderE3(r);
  return r;
}

async function cmdE4(outDir) {
  const model = opt("model", "lfm2.5-2.6b");
  const dir = outDir ?? newRunDir(`e4-${model}`);
  const r = await withLocal(model, MODELS[model].ctxDefault, (server) => e4Mint({ localServer: server, localModel: model }));
  saveJson(dir, "e4-mint.json", r);
  renderE4(r);
  return r;
}

async function cmdE5(outDir) {
  const dir = outDir ?? newRunDir("e5-embed");
  const r = await withLocal("nomic-embed-v2", 2048, (server) => e5Embed({ localServer: server, noteLimit: Number(opt("notes", 30)) }));
  saveJson(dir, "e5-embed.json", r);
  renderE5(r);
  return r;
}

// ---------------------------------------------------------------- all

async function cmdAll() {
  const models = modelsArg().length ? modelsArg() : CHAT_MODEL_IDS;
  const dir = newRunDir(opt("label", undefined));
  const summary = { run: dir, host: hostInfo(), startedAt: new Date().toISOString(), experiments: {} };
  console.log(`[all] results -> ${dir}`);
  console.log(`[all] remote baseline: ${cfg().remoteModel} via ${cfg().bridgeUrl}`);

  // E0
  await cmdProbe(dir).catch((e) => console.error("[e0]", e.message));
  summary.experiments.e0 = "probe saved";

  for (const m of models) {
    if (flag("quick")) break;
    const tag = m.replace(/[^a-z0-9.]+/g, "");
    try {
      console.log(`\n########## experiments with ${m} ##########`);
      const e1 = await withLocal(m, MODELS[m].ctxDefault, (server) => e1Triage({ localServer: server, localModel: m, noteLimit: Number(opt("notes", 24)) }));
      saveJson(dir, `e1-triage-${tag}.json`, e1);
      summary.experiments[`e1_${m}`] = e1.summary;
      renderE1(e1);
    } catch (e) { console.error(`[e1 ${m}]`, e.message); }
    try {
      const e3 = await withLocal(m, MODELS[m].ctxDefault, (server) => e3Mine({ localServer: server, localModel: m, grammar: true }));
      saveJson(dir, `e3-mine-${tag}.json`, e3);
      summary.experiments[`e3_${m}`] = { remote: e3.summary.remote, local: e3.summary.local, judged: e3.summary.judged };
    } catch (e) { console.error(`[e3 ${m}]`, e.message); }
  }

  // E2/E4 on the best-quality local model if present
  const quality = models.includes("lfm2.5-2.6b") ? "lfm2.5-2.6b" : models[0];
  if (quality && !flag("quick")) {
    try {
      const e2 = await withLocal(quality, MODELS[quality].ctxDefault, (server) => e2Dream({ localServer: server, localModel: quality, grammar: true }));
      saveJson(dir, `e2-dream-${quality.replace(/[^a-z0-9.]+/g, "")}.json`, e2);
      summary.experiments[`e2_${quality}`] = { remote: e2.summary.remote, local: e2.summary.local, judged: e2.summary.judged };
    } catch (e) { console.error("[e2]", e.message); }
    try {
      const e4 = await withLocal(quality, MODELS[quality].ctxDefault, (server) => e4Mint({ localServer: server, localModel: quality }));
      saveJson(dir, `e4-mint-${quality.replace(/[^a-z0-9.]+/g, "")}.json`, e4);
      summary.experiments[`e4_${quality}`] = { remote: e4.summary.remote, local: e4.summary.local };
    } catch (e) { console.error("[e4]", e.message); }
  }

  // E5 embeddings
  if (!flag("quick")) {
    try {
      const e5 = await withLocal("nomic-embed-v2", 2048, (server) => e5Embed({ localServer: server }));
      saveJson(dir, "e5-embed.json", e5);
      summary.experiments.e5 = e5.summary;
    } catch (e) { console.error("[e5]", e.message); }
  }

  summary.endedAt = new Date().toISOString();
  saveJson(dir, "summary.json", summary);
  console.log(`\n[all] complete -> ${dir}/summary.json`);
}

// ---------------------------------------------------------------- main

function pick(obj, keys) { const o = {}; for (const k of keys) o[k] = obj[k]; return o; }
function round2(x) { return Math.round(x * 100) / 100; }

const COMMANDS = {
  provision: cmdProvision, probe: cmdProbe, detect: cmdDetect,
  "e1-triage": cmdE1, "e2-dream": cmdE2, "e3-mine": cmdE3, "e4-mint": cmdE4, "e5-embed": cmdE5,
  all: cmdAll,
};

if (cmd === "help" || !COMMANDS[cmd]) {
  console.log(`Usage: node runner.mjs <command> [options]

Commands:
  provision [--models id,id] [--engine-only] [--force]   download llama.cpp + GGUFs
  probe [models...]                                       E0 capability probe
  detect                                                  find existing local runtimes
  e1-triage --model <id> [--notes N]                      note triage vs remote
  e2-dream   --model <id> [--no-grammar] [--notes N]      AutoDream replay + judge
  e3-mine    --model <id> [--no-grammar]                  failure-mining replay + judge
  e4-mint    --model <id>                                 task-mint replay + validator
  e5-embed                                                nomic-embed classification lane
  all [--models id,id] [--quick] [--label NAME]           full suite

Models: ${[...CHAT_MODEL_IDS, "nomic-embed-v2"].join(", ")}
llama.cpp build: ${LLAMA_BUILD} | platform: ${platformSpec().key}`);
} else {
  COMMANDS[cmd]().catch((err) => {
    console.error(`\n[${cmd}] FATAL:`, err?.stack ?? err);
    process.exit(1);
  });
}
