#!/usr/bin/env node
/**
 * Unown LiveCodeBench v6 track — contamination-aware model-tier headline.
 * =====================================================================
 *
 * docs/testing-strategy.md §7K: "add LiveCodeBench v6 (post-cutoff,
 * LeetCode/AtCoder/Codeforces) as the model-tier headline instead of
 * HumanEval+". This runner executes it for real, through the bundled
 * llm-bridge (OpenAI-compatible gateway to Dashscope coding-intl), with
 * committed receipts per the repo's benchmark rules (benchmarks/README.md).
 *
 * Protocol (pinned, mirrors the official LiveCodeBench evaluation):
 *   - problems: the 50-problem stratified subset pinned in dataset/subset.json
 *     (see prepare.py; release_v6 increment = newest LCB window, contests
 *     2025-01-04 .. 2025-04-06)
 *   - prompt: LCB's own OpenAIChat template (system message +
 *     get_generic_question_template_answer) from lcb_runner/prompts/
 *     code_generation.py @ main — pinned text, quoted verbatim below
 *   - decoding: greedy (temperature 0, top_p 1, n 1, max_tokens 4096) → pass@1
 *   - extraction: LCB's extract_code for chat models — the code between the
 *     LAST pair of ``` fence lines; fewer than 2 fence lines = no code (fail)
 *   - scoring: scorer.py, a faithful stdlib-only port of lcb_runner's
 *     testing_util.py grader (public + private lite tests, first-fail-stop,
 *     6 s SIGALRM per test, LCB reliability guard), one fresh scratch dir +
 *     process per problem, wall-clock kill at (6+1)*n_tests+30 s (LCB uses
 *     (6+1)*n_tests+5 in-process; +25 headroom here only covers job-JSON load
 *     of multi-MB test payloads + interpreter start — test-level timing is
 *     identical)
 *   - anti-tamper: tests never enter any model-visible prompt (the model sees
 *     only the problem statement + sample I/O embedded in it, as LCB ships);
 *     solutions run in a throwaway scratch dir, killed and discarded
 *
 * Endpoint etiquette: strictly sequential — one request in flight per model,
 * models run one at a time, 1 s sleep between requests (the bridge adds its
 * own 400 ms spacing + 429/5xx retry with backoff upstream of this).
 *
 * Receipts: results/<model>.jsonl — one JSON line per problem with outcome,
 * error_code, test counts, tokens in/out, generation latency, scoring wall
 * time, and stdout/stderr tails. Resume-safe (rows with outcome!="api_error"
 * are skipped on restart).
 *
 * Usage:
 *   node runner.mjs --model kimi-k2.5
 *   node runner.mjs --model qwen3.7-plus --bridge http://127.0.0.1:3031/v1
 *   node runner.mjs --report            # summarize all results/*.jsonl
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- CLI ----------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else { out[key] = next; i++; }
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

const BRIDGE = String(args.bridge || process.env.BRIDGE_URL || "http://127.0.0.1:3031/v1").replace(/\/+$/, "");
const PROBLEMS = path.resolve(String(args.problems || process.env.LCB_PROBLEMS || "/home/z/my-project/bench-data/livecodebench/problems.json"));
const OUTDIR = path.resolve(__dirname, String(args.out || "results"));
const MAX_TOKENS = Number(args["max-tokens"] || 4096);
const MAX_ATTEMPTS = Number(args["max-attempts"] || 6);
const PER_REQ_TIMEOUT_MS = Number(args["timeout-ms"] || 300_000);
const SLEEP_MS = Number(args["sleep-ms"] ?? 1000);
const TIMEOUT_PER_TEST = 6; // LCB default
const TEMPERATURE = 0; // greedy
const TOP_P = 1;
const MODELS = ["kimi-k2.5", "qwen3.7-plus", "qwen3.6-plus"];
const BACKOFF_S = [5, 15, 45, 90, 180];
const BENCH_ROOT = process.env.LCB_BENCH_ROOT || "/home/z/bench-runs/livecodebench";

// ---------- pinned LCB prompt (lcb_runner/prompts/code_generation.py @ main) ----------
const SYSTEM_MESSAGE_GENERIC =
  "You are an expert Python programmer. You will be given a question (problem specification) and will generate a correct Python program that matches the specification and passes all tests.";
const FORMATTING_MESSAGE_WITH_STARTER_CODE =
  "You will use the following starter code to write the solution to the problem and enclose your code within delimiters.";
const FORMATTING_WITHOUT_STARTER_CODE =
  "Read the inputs from stdin solve the problem and write the answer to stdout (do not directly test on the sample inputs). Enclose your code within delimiters as follows. Ensure that when the python program runs, it reads the inputs, runs the algorithm and writes output to STDOUT.";

function buildMessages(problem) {
  let prompt = `### Question:\n${problem.question_content}\n\n`;
  if (problem.starter_code && problem.starter_code.trim()) {
    prompt += `### Format: ${FORMATTING_MESSAGE_WITH_STARTER_CODE}\n`;
    prompt += "```python\n" + problem.starter_code + "\n```\n\n";
  } else {
    prompt += `### Format: ${FORMATTING_WITHOUT_STARTER_CODE}\n`;
    prompt += "```python\n# YOUR CODE HERE\n```\n\n";
  }
  prompt += "### Answer: (use the provided format with backticks)\n\n";
  return [
    { role: "system", content: SYSTEM_MESSAGE_GENERIC },
    { role: "user", content: prompt },
  ];
}

/** LCB extract_code for chat models: code between the LAST ``` fence pair. */
function extractCode(content) {
  const text = String(content ?? "");
  const outputlines = text.split("\n");
  const indexlines = [];
  for (let i = 0; i < outputlines.length; i++) {
    if (outputlines[i].includes("```")) indexlines.push(i);
  }
  if (indexlines.length < 2) return "";
  return outputlines.slice(indexlines[indexlines.length - 2] + 1, indexlines[indexlines.length - 1]).join("\n");
}

// ---------- helpers ----------
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function callBridge(messages) {
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(new Error("per-request timeout")), PER_REQ_TIMEOUT_MS);
  try {
    const res = await fetch(`${BRIDGE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: TEMPERATURE,
        top_p: TOP_P,
        max_tokens: MAX_TOKENS,
        n: 1,
      }),
    });
    const bodyText = await res.text();
    if (!res.ok) return { ok: false, http: res.status, error: `HTTP ${res.status}: ${bodyText.slice(0, 300)}` };
    let data;
    try { data = JSON.parse(bodyText); } catch { return { ok: false, http: res.status, error: `invalid JSON: ${bodyText.slice(0, 300)}` }; }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return { ok: false, http: res.status, error: `no content (choices=${JSON.stringify(data?.choices ?? null).slice(0, 300)})` };
    }
    return { ok: true, data, content };
  } catch (e) {
    return { ok: false, error: String(e?.cause?.message || e?.message || e) };
  } finally {
    clearTimeout(killer);
  }
}

function tail(s, n = 2000) {
  const t = String(s ?? "").trimEnd();
  return t.length <= n ? t : `...${t.slice(-n)}`;
}

/** Run scorer.py on the extracted solution in a fresh scratch dir. */
function scoreSolution(problem, code) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(BENCH_ROOT, "eval-"));
    const jobFile = path.join(dir, "job.json");
    const solutionFile = path.join(dir, "solution.py");
    fs.writeFileSync(solutionFile, code);
    fs.writeFileSync(jobFile, JSON.stringify({
      code,
      fn_name: problem.fn_name ?? null,
      tests: problem.tests,
      timeout_per_test: TIMEOUT_PER_TEST,
    }));
    // LCB's global wall clock: (timeout+1)*n_tests + 5 (in-process); +25 s
    // headroom here covers job-JSON loading of multi-MB test payloads and
    // interpreter startup. Test-level SIGALRM timing is untouched.
    const wallS = (TIMEOUT_PER_TEST + 1) * problem.tests.length + 30;
    const child = spawn("python3", [path.join(__dirname, "scorer.py"), jobFile], {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), wallS * 1000);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    const finish = (codeNum, signal) => {
      clearTimeout(timer);
      let verdict = null;
      const lines = out.trim().split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        try { verdict = JSON.parse(lines[i]); break; } catch { /* keep scanning */ }
      }
      fs.rmSync(dir, { recursive: true, force: true });
      const killed = signal === "SIGKILL" || verdict === null;
      resolve({
        verdict: verdict ?? {
          outcome: "eval_timeout",
          error_code: -1,
          error_message: killed
            ? `global wall-clock kill at ${wallS}s (LCB error_code -1 semantics)`
            : "scorer produced no verdict JSON",
          n_tests: problem.tests.length,
          n_run: 0,
        },
        stdout_tail: tail(out),
        stderr_tail: tail(err),
      });
    };
    child.on("error", (e) => { err += `\n${String(e)}`; finish(-1, null); });
    child.on("close", (codeNum, signal) => finish(codeNum, signal));
  });
}

function appendLine(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + "\n");
}

// ---------- run mode ----------
const MODEL = args.model;
async function runModel() {
  if (!MODEL || typeof MODEL !== "string") {
    console.error("usage: node runner.mjs --model <model-id> [--report]");
    process.exit(2);
  }
  const problems = JSON.parse(fs.readFileSync(PROBLEMS, "utf8"));
  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.mkdirSync(BENCH_ROOT, { recursive: true });
  const RECEIPTS = path.join(OUTDIR, `${MODEL}.jsonl`);

  // resume: rows that already scored (or recorded permanent gen failure)
  const done = new Set();
  if (fs.existsSync(RECEIPTS)) {
    for (const line of fs.readFileSync(RECEIPTS, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); if (r.outcome !== "api_error") done.add(r.question_id); } catch {}
    }
  }
  const remaining = problems.filter((p) => !done.has(p.question_id));
  console.log(`[lcb] model=${MODEL} bridge=${BRIDGE} problems=${PROBLEMS}`);
  console.log(`[lcb] receipts=${RECEIPTS} total=${problems.length} resume_skip=${done.size} todo=${remaining.length}`);

  let nGen = 0, nFail = 0;
  const t0 = Date.now();
  for (let idx = 0; idx < remaining.length; idx++) {
    const problem = remaining[idx];
    const messages = buildMessages(problem);

    let attempt = 0, lastErr = null, result = null;
    while (attempt < MAX_ATTEMPTS) {
      attempt++;
      const t = Date.now();
      // eslint-disable-next-line no-await-in-loop
      const r = await callBridge(messages);
      const dt = (Date.now() - t) / 1000;
      if (r.ok) { result = { ...r, dt, attempt }; break; }
      lastErr = r.error;
      console.log(`[lcb] ${MODEL} ${problem.question_id} attempt ${attempt}/${MAX_ATTEMPTS} FAILED (${dt.toFixed(1)}s): ${r.error}`);
      if (attempt < MAX_ATTEMPTS) {
        const wait = BACKOFF_S[Math.min(attempt - 1, BACKOFF_S.length - 1)] ?? 180;
        console.log(`[lcb] ${MODEL} ${problem.question_id} backing off ${wait}s`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(wait * 1000);
      }
    }

    if (result) {
      const solution = extractCode(result.content);
      let evalRes = null;
      let evalDurationS = 0;
      if (solution.trim().length === 0) {
        evalRes = { verdict: { outcome: "no_code", error_code: -1, error_message: "extract_code found no fenced code block (LCB extract_code semantics)", n_tests: problem.tests.length, n_run: 0 }, stdout_tail: "", stderr_tail: "" };
      } else {
        const te = Date.now();
        evalRes = await scoreSolution(problem, solution);
        evalDurationS = (Date.now() - te) / 1000;
      }
      const v = evalRes.verdict;
      const usage = result.data?.usage ?? null;
      appendLine(RECEIPTS, {
        ts: new Date().toISOString(),
        model: MODEL,
        question_id: problem.question_id,
        platform: problem.platform,
        difficulty: problem.difficulty,
        contest_date: problem.contest_date,
        starter_code: Boolean(problem.starter_code && problem.starter_code.trim()),
        n_tests: problem.tests.length,
        outcome: v.outcome,
        error_code: v.error_code ?? null,
        error_message: v.error_message ?? null,
        failed_test_index: v.failed_test_index ?? null,
        failure: v.failure ?? null,
        tests_run: v.n_run ?? 0,
        test_execution_time_s: v.execution_time_s ?? null,
        solution_chars: solution.length,
        solution: solution.length > 8000 ? solution.slice(0, 8000) + "\n# ... (truncated in receipt)" : solution,
        finish_reason: result.data?.choices?.[0]?.finish_reason ?? null,
        gen_attempts: result.attempt,
        gen_latency_s: Number(result.dt.toFixed(1)),
        tokens: usage
          ? { in: usage.prompt_tokens ?? null, out: usage.completion_tokens ?? null, total: usage.total_tokens ?? null, cached_in: usage.prompt_tokens_details?.cached_tokens ?? null }
          : null,
        eval_duration_s: Number(evalDurationS.toFixed(1)),
        stdout_tail: evalRes.stdout_tail,
        stderr_tail: evalRes.stderr_tail,
        settings: { temperature: TEMPERATURE, top_p: TOP_P, max_tokens: MAX_TOKENS, n: 1, timeout_per_test_s: TIMEOUT_PER_TEST, greedy: true },
      });
      nGen++;
      const eta = ((Date.now() - t0) / 1000 / nGen) * (remaining.length - idx - 1);
      console.log(
        `[lcb] ${MODEL} ${problem.question_id} ${v.outcome.toUpperCase()}${v.error_code ? `(${v.error_code})` : ""} tests=${v.n_run ?? 0}/${problem.tests.length} gen=${result.dt.toFixed(1)}s eval=${evalDurationS.toFixed(1)}s in=${usage?.prompt_tokens ?? "?"} out=${usage?.completion_tokens ?? "?"} [${done.size + nGen + nFail}/${problems.length}] eta=${(eta / 60).toFixed(1)}m`
      );
    } else {
      appendLine(RECEIPTS, {
        ts: new Date().toISOString(),
        model: MODEL,
        question_id: problem.question_id,
        platform: problem.platform,
        difficulty: problem.difficulty,
        contest_date: problem.contest_date,
        n_tests: problem.tests.length,
        outcome: "api_error",
        error_code: null,
        error_message: `generation failed after ${MAX_ATTEMPTS} attempts: ${lastErr}`,
        tokens: null,
        settings: { temperature: TEMPERATURE, top_p: TOP_P, max_tokens: MAX_TOKENS, n: 1, greedy: true },
      });
      nFail++;
      console.log(`[lcb] ${MODEL} ${problem.question_id} PERMANENT GENERATION FAILURE: ${lastErr}`);
    }
    if (idx < remaining.length - 1) await sleep(SLEEP_MS);
  }
  console.log(`[lcb] DONE model=${MODEL} generated=${nGen} gen_failures=${nFail} skipped(resume)=${done.size} elapsed=${((Date.now() - t0) / 60000).toFixed(1)}m out=${RECEIPTS}`);
  if (nFail > 0) process.exitCode = 1;
}

// ---------- report mode ----------
function readReceipts(model) {
  const file = path.join(OUTDIR, `${model}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function report() {
  const subset = JSON.parse(fs.readFileSync(path.join(__dirname, "dataset", "subset.json"), "utf8"));
  const perModel = {};
  for (const model of MODELS) {
    const rows = readReceipts(model);
    if (rows.length === 0) continue;
    const n = rows.length;
    const passes = rows.filter((r) => r.outcome === "pass").length;
    const byOutcome = {};
    for (const r of rows) byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
    const byPlatform = {};
    for (const r of rows) {
      byPlatform[r.platform] ??= { n: 0, pass: 0 };
      byPlatform[r.platform].n++;
      if (r.outcome === "pass") byPlatform[r.platform].pass++;
    }
    const byDifficulty = {};
    for (const r of rows) {
      byDifficulty[r.difficulty] ??= { n: 0, pass: 0 };
      byDifficulty[r.difficulty].n++;
      if (r.outcome === "pass") byDifficulty[r.difficulty].pass++;
    }
    perModel[model] = {
      n,
      subsetTotal: subset.total,
      passed: passes,
      passAt1Pct: Number(((100 * passes) / Math.max(1, n)).toFixed(1)),
      scoredProblems: n,
      byOutcome,
      byPlatform,
      byDifficulty,
      tokens: {
        in: rows.reduce((a, r) => a + (r.tokens?.in ?? 0), 0),
        out: rows.reduce((a, r) => a + (r.tokens?.out ?? 0), 0),
      },
      avgGenLatencyS: Number((rows.reduce((a, r) => a + (r.gen_latency_s ?? 0), 0) / Math.max(1, n)).toFixed(1)),
      avgEvalDurationS: Number((rows.reduce((a, r) => a + (r.eval_duration_s ?? 0), 0) / Math.max(1, n)).toFixed(1)),
    };
    if (rows.length !== subset.total) perModel[model].incomplete = `receipts cover ${n}/${subset.total} problems`;
  }
  const summary = {
    track: "LiveCodeBench v6 (code_generation_lite, release_v6 increment) — contamination-aware model-tier headline",
    benchmarkSource: subset.source,
    subset: {
      total: subset.total,
      cellCounts: subset.cellCounts,
      selection: subset.selection,
      codeforcesNote: subset.codeforcesNote,
      pinnedIn: "benchmarks/livecodebench/dataset/subset.json",
    },
    protocol: {
      attempts: "pass@1, greedy (temperature=0, top_p=1, n=1, max_tokens=4096)",
      prompt: "official LCB OpenAIChat template (system + get_generic_question_template_answer), pinned in runner.mjs",
      extraction: "official LCB extract_code (last fenced pair)",
      scorer: "benchmarks/livecodebench/scorer.py — faithful stdlib port of lcb_runner testing_util.py; public+private lite tests, first-fail-stop, 6s per test",
      endpoint: "Dashscope coding-intl via bundled llm-bridge (http://127.0.0.1:3031/v1)",
      models: MODELS,
    },
    results: perModel,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(OUTDIR, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}

if (args.report) {
  report();
} else {
  await runModel();
}
