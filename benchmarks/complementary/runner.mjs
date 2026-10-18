#!/usr/bin/env node
/**
 * runner.mjs — CLI driver for the complementary testbench (campaign 3).
 *
 * Pure Node >= 18, no native deps. Commands:
 *
 *   provision [qwen3.5-0.8b|qwen2.5-0.5b-draft|all]   download ext models
 *   probe (C0)      keyless runtime gate: specdec flags, /tokenize,
 *                   /completion timings, prompt-logprobs availability,
 *                   ngram boot + answer, KV-reuse engagement, (when ext
 *                   models present) qwen35 load + draft tokenizer compat
 *   c1-ngram (C1)   n-gram specdec vs baseline (H16)
 *   c2-draft (C2)   draft-model specdec vs baseline (H17)
 *   c3-kvreuse (C3) prefix KV reuse (H18)
 *   c4-compress (C4) local compression -> remote savings (H19; needs bridge
 *                   or --no-remote for the local-only lane)
 *   c5-cache (C5)   two-tier semantic cache (H20)
 *   c6-retrieval (C6) query rewriting for memory retrieval (H21)
 *   c7-bakeoff (C7) Qwen3.5-0.8B vs incumbent + vision probe (H22)
 *   all             everything (in order; stops at first hard failure)
 *
 * Env: TEST_BRIDGE_URL (default http://127.0.0.1:3031), TEST_REMOTE_MODEL
 * (default kimi-k2.5), TEST_JUDGE_MODEL, LLAMA_BUILD (default b11718),
 * UNOWN_LLAMA_BIN_DIR / UNOWN_LLAMA_MODELS_DIR (shared asset cache).
 * Flags: --no-remote (keyless lanes), --notes N, --runs N, --keep-pct P,
 * --draft-model ID, --label NAME, --ctx N.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hostInfo, provisionEngine, provisionModel, LLAMA_BUILD } from "../local-llm/lib/llama.mjs";
import {
  startLane, chatTimed, rawCompletion, tokenize, probePromptLogprobs,
  provisionExt, EXT_MODELS, extModelPath, INCUMBENT, newRunDir, saveJson,
} from "./lib/lane.mjs";
import { c1Ngram, c2Draft, c3KvReuse, buildReplays } from "./lib/specdec.mjs";
import { c4Compress } from "./lib/compress.mjs";
import { c5Cache } from "./lib/semcache.mjs";
import { c6Retrieval } from "./lib/retrieval.mjs";
import { c7Bakeoff } from "./lib/bakeoff.mjs";
import {
  renderSpeed, renderKvReuse, renderCompress, renderCache, renderRetrieval, renderBakeoff,
} from "./lib/renders.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH_ROOT = path.resolve(HERE, "..");
const RESULTS_DIR = path.join(BENCH_ROOT, "results");

// ---------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
const command = argv.find((a) => !a.startsWith("--")) ?? "help";
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};
const noRemote = flags.has("--no-remote");

const COMMANDS = {
  help: cmdHelp,
  provision: cmdProvision,
  probe: cmdProbe,
  "c1-ngram": () => withResults("C1-ngram", async (dir) => {
    const out = await c1Ngram({ noteLimit: intOpt("notes", 12), runLimit: intOpt("runs", 4) });
    saveJson(dir, "c1-ngram.json", out);
    return out.runs.map(renderSpeed).join("") + summaryOf(out);
  }),
  "c2-draft": () => withResults("C2-draft", async (dir) => {
    const out = await c2Draft({ noteLimit: intOpt("notes", 12), runLimit: intOpt("runs", 4), draftModel: opt("draft-model", "qwen2.5-0.5b-draft") });
    saveJson(dir, "c2-draft.json", out);
    return out.runs.map(renderSpeed).join("") + summaryOf(out);
  }),
  "c3-kvreuse": () => withResults("C3-kvreuse", async (dir) => {
    const out = await c3KvReuse({ noteLimit: intOpt("notes", 10) });
    saveJson(dir, "c3-kvreuse.json", out);
    return renderKvReuse(out);
  }),
  "c4-compress": () => withResults("C4-compress", async (dir) => {
    const out = await c4Compress({ runLimit: intOpt("runs", 4), keepPct: numOpt("keep-pct", 0.5), noRemote, judge: !noRemote });
    saveJson(dir, "c4-compress.json", out);
    return renderCompress(out);
  }),
  "c5-cache": () => withResults("C5-cache", async (dir) => {
    const out = await c5Cache({ noteLimit: intOpt("notes", 12), noRemote, judge: !noRemote });
    saveJson(dir, "c5-cache.json", out);
    return renderCache(out);
  }),
  "c6-retrieval": () => withResults("C6-retrieval", async (dir) => {
    const out = await c6Retrieval({ caseLimit: intOpt("cases", 40) });
    saveJson(dir, "c6-retrieval.json", out);
    return renderRetrieval(out);
  }),
  "c7-bakeoff": () => withResults("C7-bakeoff", async (dir) => {
    const out = await c7Bakeoff({ noteLimit: intOpt("notes", 12), noRemote, vision: !flags.has("--no-vision") });
    saveJson(dir, "c7-bakeoff.json", out);
    return renderBakeoff(out);
  }),
  all: cmdAll,
};

function intOpt(name, dflt) {
  const v = parseInt(opt(name, String(dflt)), 10);
  return Number.isFinite(v) ? v : dflt;
}
function numOpt(name, dflt) {
  const v = parseFloat(opt(name, String(dflt)));
  return Number.isFinite(v) ? v : dflt;
}

function summaryOf(out) {
  return `\n_Experiment ${out.experiment} · hypotheses ${out.hypotheses.join(", ")} · llama.cpp ${LLAMA_BUILD}_\n`;
}

async function withResults(label, fn) {
  const dir = newRunDir(opt("label", null) ?? `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${label}`);
  console.log(`\n=== ${label} — receipts: ${dir} ===`);
  const md = await fn(dir);
  writeFileSync(path.join(dir, "RECEIPT.md"), `# ${label}\n\n${md}\n`);
  console.log(`\n${md}`);
  console.log(`receipts: ${dir}`);
}

// ---------------------------------------------------------------- commands

async function cmdProvision() {
  const which = opt("models", "all");
  await provisionEngine();
  await provisionModel(INCUMBENT);
  if (which === "all" || which === "qwen3.5-0.8b") await provisionExt("qwen3.5-0.8b");
  if (which === "all" || which === "qwen2.5-0.5b-draft") await provisionExt("qwen2.5-0.5b-draft");
  if (which !== "incumbent-only") await provisionModel("nomic-embed-v2");
  console.log(`[provision] done (${which}: engine + qwen3-0.6b${which === "incumbent-only" ? "" : " + nomic-embed + ext models"})`);
}

/**
 * C0 — keyless runtime gate. Everything assertable WITHOUT an API key and
 * without the ext models (CI runs this on the incumbent only; the ext-model
 * section runs when the files are present).
 */
async function cmdProbe() {
  const dir = newRunDir(opt("label", null) ?? `c0-probe-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`);
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail: detail ?? null });
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${String(detail).slice(0, 160)}` : ""}`);
  };

  await provisionEngine();
  await provisionModel(INCUMBENT);

  // 1) specdec + cache flags exist in this build
  const { execFile } = await import("node:child_process");
  const bin = (await import("../local-llm/lib/llama.mjs")).llamaBinPath();
  const help = await new Promise((resolve) => {
    execFile(bin, ["--help"], { timeout: 30_000 }, (err, stdout) => resolve(err ? "" : String(stdout)));
  });
  check("spec-type flag present (ngram-mod, draft-simple)", /--spec-type/.test(help) && /ngram-mod/.test(help) && /draft-simple/.test(help));
  check("cache flags present (--cache-reuse, --slots)", /--cache-reuse/.test(help) && /--slots/.test(help));
  check("mmproj flag present", /--mmproj/.test(help));

  // 2) boot the incumbent with ngram-mod + answer + timings + tokenize
  let server;
  try {
    server = await startLane({ model: INCUMBENT, ctx: 4096, extraArgs: ["--spec-type", "ngram-mod"] });
    check("ngram-mod lane boots", true, `startup ${server.startupMs}ms`);
    const chat = await chatTimed({
      baseUrl: server.baseUrl, model: "probe",
      messages: [{ role: "user", content: 'Reply with exactly {"ok":true} and nothing else.' }],
      maxTokens: 40, temperature: 0,
      jsonSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      extra: { chat_template_kwargs: { enable_thinking: false } },
    });
    check("chat completions answer under ngram-mod", /true/.test(chat.content), `${chat.content.slice(0, 60)}`);
    check("timings block present (predicted_per_second)", chat.timings?.predictedPerSecond != null, chat.timings ? `pred ${chat.timings.predictedPerSecond} tok/s` : "no timings");
    check("timings block present (prompt_n)", chat.timings?.promptN != null, chat.timings ? `prompt_n ${chat.timings.promptN}` : "no timings");
    const tok = await tokenize({ baseUrl: server.baseUrl, text: "hello world" });
    check("/tokenize works", tok.n != null && tok.n > 0, `${tok.n} tokens`);
    const raw = await rawCompletion({ baseUrl: server.baseUrl, prompt: "The capital of France is", maxTokens: 8 });
    check("/completion raw endpoint works", typeof raw.content === "string" && raw.timings?.predictedN != null, `${JSON.stringify(raw.timings).slice(0, 120)}`);
    // KV reuse engagement: 2nd shared-prefix call processes fewer tokens
    const sys = "You are a terse assistant. Answer with one word.";
    const c1 = await chatTimed({ baseUrl: server.baseUrl, model: "probe", messages: [{ role: "system", content: sys }, { role: "user", content: "What color is the sky on a clear day?" }], maxTokens: 12, temperature: 0 });
    const c2 = await chatTimed({ baseUrl: server.baseUrl, model: "probe", messages: [{ role: "system", content: sys }, { role: "user", content: "What color is grass on a sunny day?" }], maxTokens: 12, temperature: 0 });
    check("KV prefix reuse engages (2nd call processes fewer tokens)", c2.timings?.promptN != null && c1.timings?.promptN != null && c2.timings.promptN < c1.timings.promptN, `1st prompt_n ${c1.timings?.promptN} -> 2nd ${c2.timings?.promptN}`);
    const lp = await probePromptLogprobs(server.baseUrl);
    check("prompt-logprobs availability (LLMLingua-1 arm) — informational", true, lp.supported ? `supported via ${lp.field}` : "NOT supported — chunk-select arm is the C4 mechanism");
  } catch (err) {
    check("ngram-mod lane boots", false, String(err.message));
  } finally {
    await server?.stop();
  }

  // 3) ext-model sections (present-file gated; CI incumbent-only lane skips)
  if (existsSync(extModelPath("qwen2.5-0.5b-draft"))) {
    let draftServer;
    try {
      draftServer = await startLane({ model: INCUMBENT, ctx: 4096, extraArgs: ["--spec-type", "draft-simple", "--model-draft", extModelPath("qwen2.5-0.5b-draft"), "--spec-draft-n-max", "8"] });
      const r = await chatTimed({ baseUrl: draftServer.baseUrl, model: "probe", messages: [{ role: "user", content: "Say hi." }], maxTokens: 20, temperature: 0 });
      check("draft specdec boots (Qwen2.5-0.5B drafting for Qwen3-0.6B — tokenizer compatible)", true, `${r.content.slice(0, 40)} / pred ${r.timings?.predictedPerSecond} tok/s`);
    } catch (err) {
      check("draft specdec boots (tokenizer compat)", false, String(err.message));
    } finally {
      await draftServer?.stop();
    }
  } else {
    console.log("---- draft model not present — skipping draft-compat probe (run: provision qwen2.5-0.5b-draft)");
  }
  if (existsSync(extModelPath("qwen3.5-0.8b"))) {
    let q35;
    try {
      q35 = await startLane({ model: "qwen3.5-0.8b", ctx: 4096 });
      const r = await chatTimed({ baseUrl: q35.baseUrl, model: "probe", messages: [{ role: "user", content: "Reply with the single word: ready" }], maxTokens: 20, temperature: 0, extra: { chat_template_kwargs: { enable_thinking: false } } });
      check("qwen3.5-0.8b (qwen35 hybrid arch) loads + answers", /ready/i.test(r.content), `pred ${r.timings?.predictedPerSecond} tok/s`);
    } catch (err) {
      check("qwen3.5-0.8b loads", false, String(err.message));
    } finally {
      await q35?.stop();
    }
  } else {
    console.log("---- qwen3.5-0.8b not present — skipping arch probe (run: provision qwen3.5-0.8b)");
  }

  const failed = checks.filter((c) => !c.ok);
  const out = { experiment: "C0-probe", host: hostInfo(), llamaBuild: LLAMA_BUILD, checks, failed: failed.length };
  saveJson(dir, "c0-probe.json", out);
  writeFileSync(path.join(dir, "RECEIPT.md"), `# C0 runtime gate\n\n${checks.map((c) => `- ${c.ok ? "ok" : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`).join("\n")}\n`);
  console.log(`\nC0: ${checks.length - failed.length}/${checks.length} checks passed — receipts: ${dir}`);
  if (failed.length) process.exitCode = 1;
}

async function cmdAll() {
  await cmdProbe();
  for (const c of ["c1-ngram", "c2-draft", "c3-kvreuse", "c4-compress", "c5-cache", "c6-retrieval", "c7-bakeoff"]) {
    console.log(`\n########## ${c} ##########`);
    await COMMANDS[c]();
  }
}

function cmdHelp() {
  console.log(`complementary testbench — campaign 3 (H16-H22)

commands: ${Object.keys(COMMANDS).join(" | ")}
flags:    --no-remote --notes N --runs N --cases N --keep-pct P --draft-model ID --label NAME

see hypotheses.json for the registry, README.md for the method.`);
}

// ---------------------------------------------------------------- go
const fn = COMMANDS[command] ?? cmdHelp;
try {
  mkdirSync(RESULTS_DIR, { recursive: true });
  await fn();
} catch (err) {
  console.error(`\n${command} failed: ${err?.stack ?? err}`);
  process.exitCode = 1;
}
