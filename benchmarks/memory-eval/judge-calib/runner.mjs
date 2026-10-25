#!/usr/bin/env bun
/**
 * judge-calib/runner.mjs — LLM-judge calibration for memory-QA verdicts
 * (docs/testing-strategy.md §7.6 open item "judge calibration for every graded
 * number" / §10 item L).
 *
 * What it measures: every published memory benchmark leans on an LLM judge —
 * LoCoMo's J, LongMemEval (arXiv 2410.10813, whose paper meta-evaluates its
 * judge), Letta's leaderboard grader template — and the 2026 audit literature
 * shows the uncalibrated judge is the weak link: MemStrata (arXiv 2610.05343)
 * measured 1.5-2.3% SAME-SEED label flips on public memory benchmarks, and
 * "Auditing Long-Term Memory Evaluation" (arXiv 2609.38021) makes judge
 * calibration a first-class requirement. This suite measures OUR judge
 * protocol — the Mem0-style binary J-judge (arXiv 2504.19413): system prompt +
 * question -> reference -> candidate, temperature 0, one word — against
 * corpus.json's 24 gold-labeled items, judged through the bundled llm-bridge
 * DIRECTLY (POST /v1/chat/completions; no mem0 platform, no engine).
 *
 * Per item (3 identical runs at temperature 0, sequential awaits — Agnes is a
 * ~20 RPM metered tier and the bridge spaces/backoffs requests; nothing here
 * ever fires in parallel):
 *   - run verdict  = first /\b(CORRECT|WRONG)\b/i word-boundary match in the
 *                   raw reply (case-insensitive; "INCORRECT" cannot parse as
 *                   CORRECT — the boundary forbids it); every raw reply is
 *                   kept in the receipt so each verdict is human-auditable;
 *   - item verdict = majority of the parsed runs.
 *
 * Metrics (majority-level unless stated):
 *   - agreement   — majority == expect over the 20 hard-labeled items (the 4
 *                   `partial` items are excluded: they are the LENIENCY
 *                   profile — their pass rate (judged CORRECT) is the judge's
 *                   leniency, recorded, not scored);
 *   - FPR         — share of wrong-* items (wrong-number + wrong-entity)
 *                   judged CORRECT;
 *   - FNR         — share of correct-* items (correct-gold +
 *                   correct-paraphrase) judged WRONG;
 *   - abstention  — ab-* must be judged WRONG (refusing an answerable
 *                   question fails — the LoCoMo/Mem0 contract); au-* must be
 *                   judged CORRECT (abstaining on an unanswerable question
 *                   passes — the LongMemEval _abs contract);
 *   - flipRate    — share of item x run verdicts that differ from their
 *                   item's majority (MemStrata's same-seed label-flip
 *                   measure, here at temperature 0);
 *   - orderSensitivity — for the 6 orderSwapProbe items, ONE extra call with
 *                   the swappedOrder template (candidate BEFORE reference —
 *                   the Letta-grader-style order): share of probed items
 *                   whose swapped verdict differs from the standard-order
 *                   majority.
 *
 * The judge and the corpus's candidate answers share the same served model
 * (PI_MODEL_ID ?? agnes-3.0-flash) — the honest constraint of a metered
 * single-model deployment, recorded in every receipt.
 *
 * LLM economy: a full run is 24 x 3 + 6 = 78 calls; --limit 2 is ~8.
 *
 * Resume-safe: an item with an existing ERROR-FREE receipt is skipped (errored
 * items re-run); --fresh ignores receipts. Model-scoped results: a run whose
 * model differs from the one recorded in results/summary.json writes to
 * results/<model>/ instead of clobbering (quality-axes pattern).
 *
 * Usage: bun runner.mjs [--dry] [--fresh] [--limit N] [--case <id>]
 *   --dry: NO bridge calls — corpus validation (parse, template substitution
 *          with a fake item, unique ids, orderSwapProbe ids exist) plus the
 *          full receipt plumbing with a deterministic fake judge verdict
 *          sequence (flips, parse failures and order-swap deltas included, so
 *          every metric branch runs); receipts are built + serialized in
 *          memory, never written; exits non-zero on corpus errors.
 * Live mode requires the llm-bridge on :3031 (health-gated before any call).
 * Receipts: results/per-case/<id>.json (every run's raw reply + parsed
 * verdict + the order-swap probe) + results/summary.json (every metric + the
 * judge protocol echo).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
// Model-scoped results (quality-axes pattern): a run whose model differs from
// the one recorded in the legacy results/summary.json writes to
// results/<model>/ instead of clobbering the committed single-model receipts —
// same model keeps the legacy layout byte-compatible.
const _RESULTS_MODEL = process.env.PI_MODEL_ID ?? "agnes-3.0-flash";
let _LEGACY_MODEL = _RESULTS_MODEL;
try {
        _LEGACY_MODEL = JSON.parse(readFileSync(join(HERE, "results", "summary.json"), "utf8")).model ?? _RESULTS_MODEL;
} catch { /* no legacy summary yet — the first run defines the layout */ }
const RESULTS = _RESULTS_MODEL !== _LEGACY_MODEL ? join(HERE, "results", _RESULTS_MODEL) : join(HERE, "results");
const PER_CASE = join(RESULTS, "per-case");

// ---- flags
const DRY = process.argv.includes("--dry");
const FRESH = process.argv.includes("--fresh");
const LIMIT = process.argv.includes("--limit") ? Number(process.argv[process.argv.indexOf("--limit") + 1]) : Infinity;
if (process.argv.includes("--limit") && (!Number.isFinite(LIMIT) || LIMIT < 1)) {
        console.error(`--limit: expected a positive number, got "${process.argv[process.argv.indexOf("--limit") + 1]}"`);
        process.exit(1);
}
const CASE = process.argv.includes("--case") ? process.argv[process.argv.indexOf("--case") + 1] : null;

// Scratch env FIRST (hard convention) — this suite never imports the
// self-learning package (the judge talks to the bridge directly), but the
// convention holds defensively: any accidental import must land in scratch,
// never the live engine DB or the live mem0 dir.
process.env.PI_SELFLEARNING_DATA ??= "/home/z/my-project/scratch-mem/judge-calib/data";
process.env.PI_SELFLEARNING_DB ??= "/home/z/my-project/scratch-mem/judge-calib/db/judge-calib.db";
process.env.PI_MEM0_DIR ??= "/home/z/my-project/scratch-mem/judge-calib/mem0";
process.env.PI_MODEL_ID ??= "agnes-3.0-flash";
process.env.PI_PROVIDER ??= "zai-bridge";

// ---- corpus (after the env block) + protocol pins
let corpus;
try {
        corpus = JSON.parse(readFileSync(join(HERE, "corpus.json"), "utf8"));
} catch (err) {
        console.error(`corpus.json unreadable: ${String(err?.message ?? err)}`);
        process.exit(1);
}
const MODEL = process.env.PI_MODEL_ID ?? "agnes-3.0-flash";
const PROTOCOL = corpus.judgeProtocol ?? {};
const RUNS = Number.isInteger(PROTOCOL.runs) && PROTOCOL.runs >= 1 ? PROTOCOL.runs : 3;
const TEMPERATURE = typeof PROTOCOL.temperature === "number" ? PROTOCOL.temperature : 0;
const MAX_TOKENS = 16;
const BRIDGE = process.env.PI_BRIDGE_URL || "http://127.0.0.1:3031";
const PROBE_IDS = corpus.orderSwapProbe ?? [];

// ---- item selection (--case wins over --limit)
function selectedItems() {
        if (CASE) {
                const item = (corpus.items ?? []).find((i) => i.id === CASE);
                if (!item) {
                        console.error(`--case ${CASE}: no such item id in corpus.json (ids: ${(corpus.items ?? []).map((i) => i.id).join(", ")})`);
                        process.exit(1);
                }
                return [item];
        }
        return (corpus.items ?? []).slice(0, Math.min(LIMIT, corpus.items.length));
}
const SELECTED = selectedItems();
const SELECTION = { case: CASE, limit: Number.isFinite(LIMIT) ? LIMIT : null, selected: SELECTED.length, of: (corpus.items ?? []).length };

if (DRY) {
        // no receipts in dry mode — committed results/ stay untouched
} else {
        if (FRESH) rmSync(PER_CASE, { recursive: true, force: true });
        mkdirSync(PER_CASE, { recursive: true });
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
/** Template substitution. Function replacements disable the $-pattern
 *  interpretation of String.replaceAll's string form — a "$&" inside a
 *  candidate answer must never corrupt the prompt. */
function fillTemplate(tpl, item) {
        return String(tpl)
                .replaceAll("{q}", () => item.q)
                .replaceAll("{gold}", () => item.gold)
                .replaceAll("{hyp}", () => item.hyp);
}

/** First word-boundary CORRECT/WRONG in the reply, case-insensitive. */
const VERDICT_RE = /\b(CORRECT|WRONG)\b/i;
function parseVerdict(raw) {
        if (typeof raw !== "string" || raw.length === 0) return { verdict: null, matched: null, index: null };
        const m = VERDICT_RE.exec(raw);
        return m ? { verdict: m[1].toUpperCase(), matched: m[0], index: m.index } : { verdict: null, matched: null, index: null };
}

/** Majority over parsed verdicts; ties (possible with even parsed counts) and
 *  zero-parsed runs are no-verdict — recorded as item errors, never guessed. */
function majorityOf(verdicts) {
        const c = verdicts.filter((v) => v === "CORRECT").length;
        const w = verdicts.filter((v) => v === "WRONG").length;
        if (c === 0 && w === 0) return null;
        if (c === w) return null;
        return c > w ? "CORRECT" : "WRONG";
}

const rate = (n, d) => (d > 0 ? Number((n / d).toFixed(3)) : null);
const pct = (n, d) => (d > 0 ? `${n}/${d} (${rate(n, d)})` : `${n}/${d} (n/a)`);

/** The judge-protocol echo every receipt carries (audit trail standalone). */
function protocolEcho() {
        return {
                system: PROTOCOL.system,
                standardOrder: PROTOCOL.standardOrder,
                swappedOrder: PROTOCOL.swappedOrder,
                temperature: TEMPERATURE,
                runs: RUNS,
                maxTokens: MAX_TOKENS,
                model: MODEL,
                parser: "first /\\b(CORRECT|WRONG)\\b/i match (word boundary, case-insensitive; INCORRECT cannot parse as CORRECT)",
                verdictOrder: { standardOrder: "question -> reference -> candidate", swappedOrder: "question -> candidate -> reference" },
                selfJudging: "judge and the corpus candidate answers share the same served model (metered single-model deployment)",
        };
}

// ---------------------------------------------------------------------------
// Bridge (direct llm-bridge calls — mirrors src/llm.ts chat()/bridgeHealth())
// ---------------------------------------------------------------------------
async function bridgeHealth(timeoutMs = 3000) {
        try {
                const res = await fetch(`${BRIDGE}/health`, { signal: AbortSignal.timeout(timeoutMs) });
                return await res.json();
        } catch {
                return { ok: false };
        }
}

/**
 * ONE judge call: POST /v1/chat/completions, model, system + user message,
 * temperature 0, max_tokens 16, non-stream. Mirrors the production learning
 * layer (llm.ts): the background-lane bearer (benchmark traffic yields to
 * interactive humans at the bridge) and the transient-retry safety net — the
 * bridge itself already spaces requests and retries 429/5xx upstream.
 */
async function judgeCall(prompt) {
        const started = Date.now();
        const attempt = async () => {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 150_000); // outlives the bridge's internal 429/5xx backoff budget
                try {
                        const res = await fetch(`${BRIDGE}/v1/chat/completions`, {
                                method: "POST",
                                headers: {
                                        "Content-Type": "application/json",
                                        ...(process.env.BRIDGE_API_KEY
                                                ? { Authorization: `Bearer ${process.env.BRIDGE_API_KEY}` }
                                                : { Authorization: "Bearer bridge-background" }),
                                },
                                body: JSON.stringify({
                                        model: MODEL,
                                        messages: [
                                                { role: "system", content: PROTOCOL.system },
                                                { role: "user", content: prompt },
                                        ],
                                        temperature: TEMPERATURE,
                                        max_tokens: MAX_TOKENS,
                                        stream: false,
                                }),
                                signal: ctrl.signal,
                        });
                        if (!res.ok) {
                                const text = await res.text().catch(() => "");
                                throw new Error(`llm-bridge ${res.status}: ${text.slice(0, 300)}`);
                        }
                        const completion = await res.json();
                        const message = completion?.choices?.[0]?.message;
                        // content first, then reasoning_content (completionTexts priority — a
                        // reasoning-capable upstream can leave message.content empty)
                        const raw =
                                typeof message?.content === "string" && message.content.length > 0
                                        ? message.content
                                        : typeof message?.reasoning_content === "string" && message.reasoning_content.length > 0
                                                ? message.reasoning_content
                                                : "";
                        return {
                                raw,
                                finishReason: completion?.choices?.[0]?.finish_reason ?? null,
                                completionTokens: completion?.usage?.completion_tokens ?? null,
                        };
                } finally {
                        clearTimeout(timer);
                }
        };
        for (let i = 0; i < 3; i++) {
                try {
                        const out = await attempt();
                        return { ...out, durationMs: Date.now() - started, error: null };
                } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        if (i === 2 || !/abort|network|socket|ECONN|fetch failed|timeout/i.test(msg)) {
                                return { raw: null, finishReason: null, completionTokens: null, durationMs: Date.now() - started, error: msg };
                        }
                        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
                }
        }
}

// ---------------------------------------------------------------------------
// --dry fake judge: a DETERMINISTIC verdict sequence (FNV-1a over id:kind:run)
// that exercises every plumbing branch — flips, parse failures, mixed-case
// matches, order-swap deltas. Numbers from it are meaningless by construction
// (stated in the output); the plumbing is what is validated.
// ---------------------------------------------------------------------------
function fnv1a(s) {
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
                h ^= s.charCodeAt(i);
                h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h >>> 0;
}
function dryJudgeCall(item, kind, runIdx) {
        const h = fnv1a(`${item.id}:${kind}:${runIdx}`);
        let raw;
        if (kind === "swap") raw = h % 3 === 0 ? "wrong" : "Correct."; // mixed case; deltas DO occur (plumbing coverage)
        else {
                const m = h % 11;
                if (m === 0) raw = "I am not sure how to grade this one."; // unparsable — parse-failure branch
                else if (m === 1) raw = "The candidate looks correct to me."; // case-insensitive parse branch
                else if (m === 2) raw = "WRONG — the details do not match."; // verdict + trailing text
                else raw = h % 2 === 0 ? "CORRECT" : "WRONG";
        }
        return { raw, finishReason: "stop", completionTokens: raw.split(/\s+/).length, durationMs: 0, error: null };
}

// ---------------------------------------------------------------------------
// Corpus validation (runs in BOTH modes — before the bridge gate in live)
// ---------------------------------------------------------------------------
function validateCorpus() {
        const errs = [];
        const jp = corpus.judgeProtocol;
        if (!jp || typeof jp !== "object") {
                errs.push("corpus.judgeProtocol missing");
        } else {
                if (typeof jp.system !== "string" || jp.system.trim().length < 20) errs.push("judgeProtocol.system missing/too short");
                for (const t of ["standardOrder", "swappedOrder"]) {
                        const tpl = jp[t];
                        if (typeof tpl !== "string") {
                                errs.push(`judgeProtocol.${t} missing`);
                                continue;
                        }
                        for (const k of ["{q}", "{gold}", "{hyp}"]) if (!tpl.includes(k)) errs.push(`judgeProtocol.${t} missing placeholder ${k}`);
                }
                if (typeof jp.runs !== "number" || jp.runs < 1) errs.push("judgeProtocol.runs must be a number >= 1");
        }
        if (!Array.isArray(corpus.items) || corpus.items.length === 0) errs.push("corpus.items missing/empty");
        const ids = new Set();
        for (const it of corpus.items ?? []) {
                const w = it?.id ?? `(no id: ${JSON.stringify(it).slice(0, 60)}`;
                if (!it?.id) errs.push(`item without id: ${w}`);
                else if (ids.has(it.id)) errs.push(`duplicate item id: ${it.id}`);
                else ids.add(it.id);
                for (const k of ["cls", "q", "gold", "hyp"]) if (typeof it?.[k] !== "string" || !it[k].trim()) errs.push(`${w}: field ${k} missing/empty`);
                if (!["CORRECT", "WRONG"].includes(it?.expect)) errs.push(`${w}: expect must be CORRECT or WRONG (got ${JSON.stringify(it?.expect)})`);
        }
        // template substitution with a FAKE item (spec: parse + substitution check)
        const fake = { q: "ZZQ fake question", gold: "ZZG fake gold", hyp: "ZZH fake hypothesis" };
        for (const t of ["standardOrder", "swappedOrder"]) {
                if (typeof jp?.[t] !== "string") continue; // already flagged above
                const filled = fillTemplate(jp[t], fake);
                if (!filled.includes("ZZQ fake question") || !filled.includes("ZZG fake gold") || !filled.includes("ZZH fake hypothesis"))
                        errs.push(`judgeProtocol.${t} substitution broken: ${JSON.stringify(filled)}`);
                if (/\{q\}|\{gold\}|\{hyp\}/.test(filled)) errs.push(`judgeProtocol.${t} left unsubstituted placeholders: ${JSON.stringify(filled)}`);
        }
        for (const pid of PROBE_IDS) if (!ids.has(pid)) errs.push(`orderSwapProbe id not in items: ${pid}`);
        if (!Array.isArray(PROBE_IDS)) errs.push("corpus.orderSwapProbe missing");
        return errs;
}

// ---------------------------------------------------------------------------
// Per-item runner (resume-safe)
// ---------------------------------------------------------------------------
async function runItem(item, idx, total) {
        const receiptPath = join(PER_CASE, `${item.id}.json`);
        if (!DRY && existsSync(receiptPath)) {
                const prev = JSON.parse(readFileSync(receiptPath, "utf8"));
                if (!prev.error && prev.majority) {
                        console.log(`[skip] ${item.id} (receipt exists, no error)`);
                        return prev;
                }
                console.log(`[rerun] ${item.id} (previous receipt had an error)`);
        }
        const started = Date.now();
        if (!DRY) console.log(`[item ${idx + 1}/${total}] ${item.id} ${item.cls} — Q: ${item.q.slice(0, 70)}`);
        const standardPrompt = fillTemplate(PROTOCOL.standardOrder, item);
        const swappedPrompt = PROBE_IDS.includes(item.id) ? fillTemplate(PROTOCOL.swappedOrder, item) : null;

        const runs = [];
        for (let r = 1; r <= RUNS; r++) {
                const call = DRY ? dryJudgeCall(item, "standard", r) : await judgeCall(standardPrompt); // sequential — never parallel
                const parsed = parseVerdict(call.raw);
                runs.push({
                        run: r,
                        raw: call.raw,
                        verdict: parsed.verdict,
                        matched: parsed.matched,
                        index: parsed.index,
                        finishReason: call.finishReason,
                        completionTokens: call.completionTokens,
                        durationMs: call.durationMs,
                        error: call.error,
                });
                if (!DRY)
                        console.log(
                                `  [run ${r}/${RUNS}] ${
                                        call.error
                                                ? `ERROR: ${call.error.slice(0, 100)}`
                                                : `${parsed.verdict ?? "UNPARSED"} ← "${String(call.raw).replace(/\s+/g, " ").slice(0, 70)}"`
                                }`,
                        );
        }

        // order-swap probe: ONE extra call, candidate BEFORE reference
        let orderSwap = null;
        if (swappedPrompt !== null) {
                const call = DRY ? dryJudgeCall(item, "swap", 0) : await judgeCall(swappedPrompt);
                const parsed = parseVerdict(call.raw);
                orderSwap = {
                        template: "swappedOrder",
                        raw: call.raw,
                        verdict: parsed.verdict,
                        matched: parsed.matched,
                        index: parsed.index,
                        finishReason: call.finishReason,
                        completionTokens: call.completionTokens,
                        durationMs: call.durationMs,
                        error: call.error,
                };
                if (!DRY)
                        console.log(
                                `  [swap] ${
                                        call.error
                                                ? `ERROR: ${call.error.slice(0, 100)}`
                                                : `${parsed.verdict ?? "UNPARSED"} ← "${String(call.raw).replace(/\s+/g, " ").slice(0, 70)}" (order-swap probe)`
                                }`,
                        );
        }

        const counts = {
                CORRECT: runs.filter((r) => r.verdict === "CORRECT").length,
                WRONG: runs.filter((r) => r.verdict === "WRONG").length,
                unparsed: runs.filter((r) => !r.verdict).length,
        };
        const majority = majorityOf(runs.map((r) => r.verdict));
        const error = runs.every((r) => r.error) ? "all judge runs errored" : majority ? null : "no parseable verdict in any run";
        const receipt = {
                suite: "judge-calib",
                id: item.id,
                cls: item.cls,
                q: item.q,
                gold: item.gold,
                hyp: item.hyp,
                expect: item.expect,
                note: item.note ?? null,
                model: MODEL,
                date: new Date().toISOString(),
                judgeProtocol: protocolEcho(),
                prompts: { standard: standardPrompt, swapped: swappedPrompt },
                runs,
                orderSwap,
                majority,
                majorityCounts: counts,
                agree: majority ? majority === item.expect : null,
                orderSwapDelta: orderSwap && majority && orderSwap.verdict ? orderSwap.verdict !== majority : null,
                error,
                durationMs: Date.now() - started,
        };
        if (!DRY) writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
        console.log(
                `  -> ${item.id}: majority ${majority ?? "NONE"} (${counts.CORRECT}C/${counts.WRONG}W/${counts.unparsed}unparsed)` +
                        `${item.cls === "partial" ? " [leniency profile — pass rate, not agreement]" : ` agree=${receipt.agree}`}` +
                        `${orderSwap ? ` orderSwap=${orderSwap.verdict ?? "UNPARSED"}${receipt.orderSwapDelta === true ? " (DELTA)" : ""}` : ""}`,
        );
        return receipt;
}

// ---------------------------------------------------------------------------
// Metrics summary
// ---------------------------------------------------------------------------
function computeSummary(receipts, health) {
        const hard = receipts.filter((r) => r.cls !== "partial");
        const agreed = hard.filter((r) => r.majority === r.expect);
        const wrongCls = receipts.filter((r) => r.cls.startsWith("wrong-"));
        const falsePositives = wrongCls.filter((r) => r.majority === "CORRECT");
        const correctCls = receipts.filter((r) => r.cls.startsWith("correct-"));
        const falseNegatives = correctCls.filter((r) => r.majority === "WRONG");
        const partial = receipts.filter((r) => r.cls === "partial");
        const lenientPasses = partial.filter((r) => r.majority === "CORRECT");
        const ab = receipts.filter((r) => r.cls === "abstention-answerable");
        const abOk = ab.filter((r) => r.majority === "WRONG");
        const au = receipts.filter((r) => r.cls === "abstention-unanswerable");
        const auOk = au.filter((r) => r.majority === "CORRECT");
        const swapRows = receipts.filter((r) => r.orderSwap);
        const swapEvaluated = swapRows.filter((r) => r.majority && r.orderSwap.verdict);
        const swapFlips = swapEvaluated.filter((r) => r.orderSwap.verdict !== r.majority);
        let parsedRuns = 0;
        let flips = 0;
        for (const r of receipts)
                for (const run of r.runs) {
                        if (run.verdict && r.majority) {
                                parsedRuns++;
                                if (run.verdict !== r.majority) flips++;
                        }
                }
        const totalCalls = receipts.reduce((n, r) => n + r.runs.length + (r.orderSwap ? 1 : 0), 0);
        const unparsedCalls = receipts.reduce((n, r) => n + r.runs.filter((x) => !x.verdict).length + (r.orderSwap && !r.orderSwap.verdict ? 1 : 0), 0);
        const byClass = {};
        for (const r of receipts) {
                const c = (byClass[r.cls] ??= { n: 0, agreed: 0, majorityCORRECT: 0, majorityWRONG: 0, noMajority: 0 });
                c.n++;
                if (r.majority === "CORRECT") c.majorityCORRECT++;
                else if (r.majority === "WRONG") c.majorityWRONG++;
                else c.noMajority++;
                if (r.cls !== "partial" && r.majority === r.expect) c.agreed++;
        }
        return {
                suite: "judge-calib",
                date: new Date().toISOString(),
                model: MODEL,
                dry: DRY,
                bridgeUpstreamStatus: DRY ? null : (health?.upstream?.status ?? null),
                judgeProtocol: { ...protocolEcho(), orderSwapProbeIds: PROBE_IDS },
                selection: SELECTION,
                n: receipts.length,
                itemsTotal: corpus.items.length,
                complete: receipts.length === corpus.items.length,
                agreement: {
                        n: hard.length,
                        agreed: agreed.length,
                        rate: rate(agreed.length, hard.length),
                        disagreements: hard.filter((r) => r.majority !== r.expect).map((r) => ({ id: r.id, cls: r.cls, expect: r.expect, majority: r.majority })),
                        note: "majority verdict == expect over the hard-labeled items (partial items excluded — they are the leniency profile)",
                },
                fpr: {
                        n: wrongCls.length,
                        falsePositives: falsePositives.map((r) => r.id),
                        rate: rate(falsePositives.length, wrongCls.length),
                        note: "share of wrong-* items (wrong-number, wrong-entity) judged CORRECT",
                },
                fnr: {
                        n: correctCls.length,
                        falseNegatives: falseNegatives.map((r) => r.id),
                        rate: rate(falseNegatives.length, correctCls.length),
                        note: "share of correct-* items (correct-gold, correct-paraphrase) judged WRONG",
                },
                leniency: {
                        n: partial.length,
                        passed: lenientPasses.length,
                        passRate: rate(lenientPasses.length, partial.length),
                        perItem: partial.map((r) => ({ id: r.id, majority: r.majority })),
                        note: "share of the partial items the judge PASSED (majority CORRECT) — a strict judge scores 0; the corpus's strict label (incomplete => WRONG) is deliberately not folded into agreement",
                },
                abstention: {
                        answerable: {
                                n: ab.length,
                                judgedWrong: abOk.length,
                                judgedWrongRate: rate(abOk.length, ab.length),
                                perItem: ab.map((r) => ({ id: r.id, majority: r.majority })),
                                note: "ab-* must be judged WRONG — refusing an answerable question fails (LoCoMo/Mem0 contract)",
                        },
                        unanswerable: {
                                n: au.length,
                                judgedCorrect: auOk.length,
                                judgedCorrectRate: rate(auOk.length, au.length),
                                perItem: au.map((r) => ({ id: r.id, majority: r.majority })),
                                note: "au-* must be judged CORRECT — abstaining on an unanswerable question passes (LongMemEval _abs contract)",
                        },
                },
                flipRate: {
                        parsedRuns,
                        flips,
                        rate: rate(flips, parsedRuns),
                        note: "share of item x run verdicts differing from their item's majority (MemStrata's same-seed label-flip measure, at temperature 0)",
                },
                orderSensitivity: {
                        probed: swapRows.length,
                        evaluated: swapEvaluated.length,
                        flips: swapFlips.length,
                        rate: rate(swapFlips.length, swapEvaluated.length),
                        perItem: swapRows.map((r) => ({
                                id: r.id,
                                standardMajority: r.majority,
                                swappedVerdict: r.orderSwap.verdict,
                                delta: r.orderSwap.verdict && r.majority && r.orderSwap.verdict !== r.majority ? true : r.orderSwap.verdict && r.majority ? false : null,
                        })),
                        note: "swappedOrder probe (candidate before reference) — verdict delta vs the standard-order majority",
                },
                parseFailures: { calls: totalCalls, unparsed: unparsedCalls, rate: rate(unparsedCalls, totalCalls) },
                byClass,
                errors: receipts.filter((r) => r.error).map((r) => ({ id: r.id, error: r.error })),
                llmCalls: {
                        judge: receipts.reduce((n, r) => n + r.runs.length, 0),
                        orderSwap: swapRows.length,
                        total: totalCalls,
                        sequential: true,
                        note: DRY ? "none — fake judge (dry mode)" : "sequential awaits; the bridge spaces them (~20 RPM metered upstream)",
                },
                totalDurationMs: receipts.reduce((n, r) => n + (r.durationMs ?? 0), 0),
                perCase: "(see results/per-case/<id>.json — every run's raw reply + parsed verdict + order-swap probe)",
        };
}

// ---------------------------------------------------------------------------
// --dry main + live main
// ---------------------------------------------------------------------------
async function runDry() {
        const t0 = Date.now();
        console.log(
                `[dry] no-LLM smoke mode — corpus validation + receipt plumbing with a deterministic fake judge, zero bridge calls, no receipt writes (model ${MODEL}, ${SELECTED.length} item(s) x ${RUNS} runs)`,
        );
        const errs = validateCorpus();
        if (errs.length) {
                console.error(`\n[dry] ${errs.length} corpus error(s):`);
                for (const e of errs) console.error(`  - ${e}`);
                process.exit(1);
        }
        console.log(
                `[validate] corpus OK — ${corpus.items.length} items, ${new Set(corpus.items.map((i) => i.cls)).size} classes, ${PROBE_IDS.length} order-swap probe id(s)`,
        );
        const receipts = [];
        for (let i = 0; i < SELECTED.length; i++) receipts.push(await runItem(SELECTED[i], i, SELECTED.length));

        // receipt plumbing: every receipt must serialize and carry the audit trail
        const failures = [];
        for (const r of receipts) {
                try {
                        JSON.stringify(r);
                } catch (err) {
                        failures.push(`${r.id}: receipt not serializable: ${String(err?.message ?? err)}`);
                        continue;
                }
                if (r.runs.length !== RUNS) failures.push(`${r.id}: expected ${RUNS} runs, got ${r.runs.length}`);
                for (const run of r.runs) {
                        if (typeof run.raw !== "string" && !run.error) failures.push(`${r.id} run ${run.run}: no raw reply recorded`);
                        if (run.verdict !== null && !["CORRECT", "WRONG"].includes(run.verdict)) failures.push(`${r.id} run ${run.run}: bad verdict ${run.verdict}`);
                        if (!("matched" in run) || !("index" in run)) failures.push(`${r.id} run ${run.run}: parse audit fields missing`);
                }
                if (PROBE_IDS.includes(r.id) && !r.orderSwap) failures.push(`${r.id}: order-swap probe missing`);
                if (!PROBE_IDS.includes(r.id) && r.orderSwap) failures.push(`${r.id}: unexpected order-swap probe`);
                if (typeof r.majority !== "string" && !r.error) failures.push(`${r.id}: no majority and no error recorded`);
                if (!r.judgeProtocol || !r.judgeProtocol.system) failures.push(`${r.id}: judge-protocol echo missing`);
        }
        const summary = computeSummary(receipts, null);
        try {
                JSON.stringify(summary);
        } catch (err) {
                failures.push(`summary not serializable: ${String(err?.message ?? err)}`);
        }
        for (const [k, path] of [
                ["agreement", "rate"],
                ["fpr", "rate"],
                ["fnr", "rate"],
                ["leniency", "passRate"],
                ["flipRate", "rate"],
                ["orderSensitivity", "rate"],
                ["parseFailures", "rate"],
        ]) {
                if (typeof summary[k]?.[path] !== "number" && summary[k]?.[path] !== null) failures.push(`summary.${k}.${path} missing`);
        }
        if (typeof summary.abstention?.answerable?.judgedWrongRate !== "number" && summary.abstention?.answerable?.judgedWrongRate !== null)
                failures.push("summary.abstention.answerable.judgedWrongRate missing");
        if (typeof summary.abstention?.unanswerable?.judgedCorrectRate !== "number" && summary.abstention?.unanswerable?.judgedCorrectRate !== null)
                failures.push("summary.abstention.unanswerable.judgedCorrectRate missing");
        if (failures.length) {
                console.error(`\n[dry] ${failures.length} plumbing failure(s):`);
                for (const f of failures) console.error(`  - ${f}`);
                process.exit(1);
        }
        console.log(
                `[dry] fake-judge plumbing metrics (meaningless by construction): agreement=${summary.agreement.rate} flipRate=${summary.flipRate.rate} orderSensitivity=${summary.orderSensitivity.rate} parseFailures=${summary.parseFailures.unparsed}/${summary.parseFailures.calls}`,
        );
        console.log(`\n[dry] PASS — ${receipts.length} item receipt(s) + summary exercised in memory in ${Date.now() - t0}ms (plumbing only; calibration numbers are live-mode only)`);
}

async function main() {
        if (DRY) {
                await runDry();
                return;
        }
        const errs = validateCorpus();
        if (errs.length) {
                console.error(`corpus invalid — ${errs.length} error(s):`);
                for (const e of errs) console.error(`  - ${e}`);
                process.exit(1);
        }
        const health = await bridgeHealth();
        if (!health?.ok) {
                console.error(`llm-bridge on :3031 is not healthy — aborting before any judge call: ${JSON.stringify(health)}`);
                process.exit(1);
        }
        // honest call estimate: resume-safe items (existing error-free receipts) are skipped
        const pending = SELECTED.filter((i) => {
                const p = join(PER_CASE, `${i.id}.json`);
                if (!existsSync(p)) return true;
                try {
                        const prev = JSON.parse(readFileSync(p, "utf8"));
                        return Boolean(prev.error || !prev.majority);
                } catch {
                        return true;
                }
        });
        const nSwapPending = pending.filter((i) => PROBE_IDS.includes(i.id)).length;
        console.log(
                `bridge healthy (model ${MODEL}, upstream ${health.upstream?.status ?? "?"}) — ${SELECTED.length} item(s) selected (${pending.length} to run — resume skips error-free receipts) x ${RUNS} judge runs + ${nSwapPending} order-swap probe(s) ≈ ${pending.length * RUNS + nSwapPending} LLM calls (sequential; the bridge spaces them)`,
        );
        const receipts = [];
        for (let i = 0; i < SELECTED.length; i++) receipts.push(await runItem(SELECTED[i], i, SELECTED.length));
        const summary = computeSummary(receipts, health);
        writeFileSync(join(RESULTS, "summary.json"), JSON.stringify(summary, null, 2));
        console.log("\n=== judge-calib summary ===");
        console.log(`agreement: ${pct(summary.agreement.agreed, summary.agreement.n)}`);
        console.log(`FPR (wrong-* judged CORRECT): ${pct(summary.fpr.falsePositives.length, summary.fpr.n)}`);
        console.log(`FNR (correct-* judged WRONG): ${pct(summary.fnr.falseNegatives.length, summary.fnr.n)}`);
        console.log(`leniency (partial judged CORRECT): ${pct(summary.leniency.passed, summary.leniency.n)}`);
        console.log(
                `abstention: answerable→WRONG ${pct(summary.abstention.answerable.judgedWrong, summary.abstention.answerable.n)} · unanswerable→CORRECT ${pct(summary.abstention.unanswerable.judgedCorrect, summary.abstention.unanswerable.n)}`,
        );
        console.log(`flipRate: ${pct(summary.flipRate.flips, summary.flipRate.parsedRuns)}`);
        console.log(`orderSensitivity: ${pct(summary.orderSensitivity.flips, summary.orderSensitivity.evaluated)} (of ${summary.orderSensitivity.probed} probed)`);
        console.log(
                `parse failures: ${pct(summary.parseFailures.unparsed, summary.parseFailures.calls)} · item errors: ${summary.errors.length} · ${summary.complete ? "complete run" : `PARTIAL run (${summary.n}/${summary.itemsTotal} items — see summary.selection)`} · receipts in ${RESULTS}`,
        );
}

if (import.meta.main) {
        await main();
}
