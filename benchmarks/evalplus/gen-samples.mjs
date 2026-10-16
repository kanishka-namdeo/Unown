#!/usr/bin/env node
/**
 * evalplus HumanEval+ sample generator (greedy pass@1 protocol)
 * =============================================================
 *
 * Generates ONE greedy completion (temperature=0, top_p=1, max_tokens=2048,
 * n=1) per HumanEval+ problem (164 problems) for one model, through the
 * local OpenAI-compatible LLM bridge, and writes an evalplus-format samples
 * file that the official evaluator (`evalplus.evaluate`) consumes directly.
 *
 * Samples file schema (verified against evalplus 0.3.1 source:
 *   evalplus/data/utils.py::load_solutions + evalplus/evaluate.py::evaluate):
 *   - one JSON object per line
 *   - required: {"task_id": "HumanEval/<i>", "solution": <str>}   ("solution"
 *     = full standalone Python; "completion" variant prepends the dataset
 *     prompt instead — we use "solution")
 *   - every task_id of the dataset must appear at least once (evalplus
 *     asserts `len(completion_id) == len(problems)`)
 *   - extra fields are ignored by the evaluator -> we keep receipts
 *     (raw_output, usage, finish_reason, latency, retries) in the same file.
 *
 * Prompt: the official evalplus chat-model instruction from
 *   evalplus/codegen.py::run_codegen (used by provider/openai.py):
 *   "Please provide a self-contained Python script that solves the following
 *    problem in a markdown code block:\n```python\n{prompt.strip()}\n```"
 *   which implements the required "complete the function; reply with ONLY
 *    code, no explanations" completion prompt.
 *
 * Resume support: task_ids already present in the output file (success or
 * recorded permanent failure) are skipped; the run can be killed and
 * restarted at any time.
 *
 * Usage:
 *   node gen-samples.mjs --model kimi-k2.5 \
 *        [--bridge http://127.0.0.1:3031/v1] [--out results] \
 *        [--dataset dataset/humaneval_plus_prompts.json] \
 *        [--max-tokens 2048] [--max-attempts 6] [--ids 0,5,7-9]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- CLI ----------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const MODEL = args.model;
if (!MODEL || typeof MODEL !== 'string') {
  console.error('usage: node gen-samples.mjs --model <model-id> [options]');
  process.exit(2);
}
const BRIDGE = String(args.bridge || process.env.BRIDGE_URL || 'http://127.0.0.1:3031/v1').replace(/\/+$/, '');
const DATASET = path.resolve(__dirname, String(args.dataset || 'dataset/humaneval_plus_prompts.json'));
const OUTDIR = path.resolve(__dirname, args.out ? String(args.out) : path.join('results', MODEL));
const MAX_TOKENS = Number(args['max-tokens'] || 2048);
const MAX_ATTEMPTS = Number(args['max-attempts'] || 6);
const PER_REQ_TIMEOUT_MS = Number(args['timeout-ms'] || 300_000);
const TEMPERATURE = 0; // greedy
const TOP_P = 1;

// tasks: default = all HumanEval/0..163; --ids restricts (debug)
const IDS = args.ids ? parseIds(String(args.ids)) : null;
function parseIds(spec) {
  const set = new Set();
  for (const part of spec.split(',')) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`bad --ids spec: ${part}`);
    const lo = +m[1], hi = m[2] ? +m[2] : lo;
    for (let i = lo; i <= hi; i++) set.add(i);
  }
  return set;
}

// ---------- constants ----------
// Official evalplus chat-model instruction (evalplus/codegen.py::run_codegen)
const INSTRUCTION =
  'Please provide a self-contained Python script that solves the following problem in a markdown code block:';

const BACKOFF_S = [5, 15, 45, 90, 180]; // sleep before attempt n+1 (index = attemptsSoFar-1)

// ---------- state ----------
const problems = JSON.parse(fs.readFileSync(DATASET, 'utf8')); // {task_id: {prompt, entry_point, task_id}}
const taskIds = Object.keys(problems)
  .filter((id) => !IDS || IDS.has(Number(id.split('/')[1])))
  .sort((a, b) => Number(a.split('/')[1]) - Number(b.split('/')[1]));
if (taskIds.length === 0) { console.error('no tasks selected'); process.exit(2); }

fs.mkdirSync(OUTDIR, { recursive: true });
const SAMPLES = path.join(OUTDIR, 'samples.jsonl');
const FAILLOG = path.join(OUTDIR, 'generation-failures.log');

// resume: skip task_ids already in output file
const done = new Set();
if (fs.existsSync(SAMPLES)) {
  for (const line of fs.readFileSync(SAMPLES, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).task_id); } catch { /* tolerate torn tail line */ }
  }
}
const remaining = taskIds.filter((id) => !done.has(id));
console.log(`[gen-samples] model=${MODEL} bridge=${BRIDGE} dataset=${DATASET}`);
console.log(`[gen-samples] out=${SAMPLES} tasks_total=${taskIds.length} resume_skip=${done.size} todo=${remaining.length}`);

// ---------- helpers ----------
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Build the official evalplus chat message for a HumanEval problem. */
function buildMessage(prompt) {
  // NB: JS .trim() == Python .strip() here
  return `${INSTRUCTION}\n\`\`\`python\n${prompt.trim()}\n\`\`\``;
}

/**
 * Extract Python code from a model reply: first fenced ```/```python block
 * (or to end-of-text if the closing fence is missing, e.g. truncation),
 * else the raw text. Mirrors "strip markdown fences" requirement; the
 * official `evalplus.sanitize` pass afterwards does the heavy cleanup.
 */
function extractCode(content) {
  const text = String(content ?? '').trim();
  if (!text) return '';
  const open = text.match(/```[^\S\n]*(?:python|py)?[^\S\n]*\r?\n?/);
  if (open) {
    const start = open.index + open[0].length;
    const close = text.indexOf('```', start);
    const body = close === -1 ? text.slice(start) : text.slice(start, close);
    return body.trim();
  }
  return text;
}

/** POST /v1/chat/completions with timeout; returns {ok, http?, data?, error?} */
async function callBridge(msg, signalLog) {
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(new Error('per-request timeout')), PER_REQ_TIMEOUT_MS);
  try {
    const res = await fetch(`${BRIDGE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: msg }],
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
    if (typeof content !== 'string') {
      return { ok: false, http: res.status, error: `no content (choices=${JSON.stringify(data?.choices ?? null).slice(0, 300)})` };
    }
    return { ok: true, data, content };
  } catch (e) {
    return { ok: false, error: String(e?.cause?.message || e?.message || e) };
  } finally {
    clearTimeout(killer);
  }
}

function appendLine(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

// ---------- main loop ----------
let nGen = 0, nFail = 0, nSkip = done.size;
const t0 = Date.now();
for (let idx = 0; idx < remaining.length; idx++) {
  const taskId = remaining[idx];
  const problem = problems[taskId];
  const msg = buildMessage(problem.prompt);

  let attempt = 0, lastErr = null, result = null;
  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    const t = Date.now();
    // eslint-disable-next-line no-await-in-loop
    const r = await callBridge(msg);
    const dt = (Date.now() - t) / 1000;
    if (r.ok) { result = { ...r, dt, attempt }; break; }
    lastErr = r.error;
    console.log(`[gen-samples] ${MODEL} ${taskId} attempt ${attempt}/${MAX_ATTEMPTS} FAILED (${dt.toFixed(1)}s): ${r.error}`);
    if (attempt < MAX_ATTEMPTS) {
      const wait = BACKOFF_S[Math.min(attempt - 1, BACKOFF_S.length - 1)] ?? 180;
      console.log(`[gen-samples] ${MODEL} ${taskId} backing off ${wait}s`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(wait * 1000);
    }
  }

  if (result) {
    const solution = extractCode(result.content);
    const rec = {
      task_id: taskId,
      model: MODEL,
      solution,
      raw_output: result.content,
      finish_reason: result.data?.choices?.[0]?.finish_reason ?? null,
      usage: result.data?.usage ?? null,
      attempts: result.attempt,
      latency_s: Number(result.dt.toFixed(1)),
      generated_at: new Date().toISOString(),
      settings: { temperature: TEMPERATURE, top_p: TOP_P, max_tokens: MAX_TOKENS, n: 1 },
    };
    appendLine(SAMPLES, rec);
    nGen++;
    const eta = ((Date.now() - t0) / 1000 / nGen) * (remaining.length - idx - 1);
    console.log(
      `[gen-samples] ${MODEL} ${taskId} ok attempt=${result.attempt} ${result.dt.toFixed(1)}s finish=${rec.finish_reason} sol_chars=${solution.length} [${nSkip + nGen + nFail}/${taskIds.length}] eta=${(eta / 60).toFixed(1)}m`
    );
  } else {
    // permanent failure: still emit the line (solution="") so the official
    // evaluator sees the task (its asserts require all 164 task_ids) — it
    // will correctly count as a failure. Keep partial results + resume-safe.
    appendLine(SAMPLES, {
      task_id: taskId, model: MODEL, solution: '', raw_output: null,
      finish_reason: null, usage: null, attempts: attempt,
      error: `generation failed after ${MAX_ATTEMPTS} attempts: ${lastErr}`,
      generated_at: new Date().toISOString(),
      settings: { temperature: TEMPERATURE, top_p: TOP_P, max_tokens: MAX_TOKENS, n: 1 },
    });
    appendLine(FAILLOG, `${new Date().toISOString()} ${MODEL} ${taskId} failed x${MAX_ATTEMPTS}: ${lastErr}\n`);
    nFail++;
    console.log(`[gen-samples] ${MODEL} ${taskId} PERMANENT FAILURE: ${lastErr}`);
  }
}

console.log(
  `[gen-samples] DONE model=${MODEL} generated=${nGen} failed=${nFail} skipped(resume)=${nSkip} total=${taskIds.length} elapsed=${((Date.now() - t0) / 60000).toFixed(1)}m out=${SAMPLES}`
);
if (nFail > 0) { console.log(`[gen-samples] NOTE: ${nFail} permanent failure(s) recorded with solution="" and logged to ${FAILLOG}`); process.exitCode = 1; }
