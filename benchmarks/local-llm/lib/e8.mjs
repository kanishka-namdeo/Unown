/**
 * e8.mjs — E8 (H10): local-draft → validate → remote-repair cascade for task minting.
 *
 * H10: "A local-draft → validate → remote-repair cascade for task minting
 * achieves an accept-rate within 10 points of pure-remote minting, at strictly
 * lower expected remote cost per accepted task, with blind-judge quality parity."
 *
 * This is H5's salvage path: E4 refuted PURE-LOCAL minting (qwen3-0.6B 50%
 * draft validity, granite-4.0-1B 0%), so the cascade keeps the local model as
 * the cheap first author and escalates ONLY on validator failure — the same
 * FrugalGPT ladder the campaign verified for mining (H3).
 *
 * Arms (same fixture sources as E4: one easy seed, one hard seed; E4 used one
 * sample per source, so E8 runs `samplesPerSource` independent samples per
 * source with E4's sampling settings):
 *
 *   CASCADE  stage 1  local qwen3-0.6b drafts via llama-server with E4's
 *            MINT_SCHEMA json_schema grammar + thinking off (e4Mint local arm
 *            settings) on the byte-faithful authorDraft prompt
 *            stage 2  validateMintDraft (the shared e4Mint/mint.ts validator)
 *            — valid ⇒ ACCEPT at remoteCost=0
 *            stage 3  invalid ⇒ one remote kimi-k2.5 REPAIR call with the
 *            authorDraft transcript + the validator error
 *            ([system, user, assistant(bad draft), user("That draft failed
 *            validation with: <errors>. Return the complete corrected JSON
 *            draft only.")]), e4 remote-arm sampling; re-validate — valid ⇒
 *            ACCEPT at the repair-call cost, else REJECT.
 *
 *   REMOTE   fresh pure-remote baseline: e4Mint's remote arm exactly
 *            (authorDraft → validate), n = same sources × samples. E4's n=2
 *            baseline was too thin; this refresh gives real accept/cost/latency
 *            numbers.
 *
 * Judging: cascade-FINAL (accepted only — rejects have no output to judge) vs
 * remote-FINAL outputs, judge.mjs blind pair (position-swapped +
 * consistency-gated), E4's mint judge prompt. Only variants where BOTH arms
 * produced an accepted draft are judged.
 */
import { chat, extractJson } from "./openai.mjs";
import { judgePair } from "./judge.mjs";
import { latencyStats, mdTable, num } from "./report.mjs";
import { loadTasks, mintCurriculumMessages } from "./prompts.mjs";
import { cfg, NO_THINKING, costOf, MINT_SCHEMA, validateMintDraft } from "./experiments.mjs";
import { existsSync, readFileSync } from "node:fs";

/** E4's mint judge prompt (same instrument as the E4 baseline judgement). */
const JUDGE_SYSTEM = "You are an expert on benchmark design for coding agents. Judge which minted task is better.";
const JUDGE_QUESTION = "Criteria: (1) valid self-contained exercise (imports resolve, tests are meaningful), (2) appropriate difficulty bump over the source, (3) prompt quality (no solution leak), (4) determinism of the tests.";

export async function e8MintCascade({ localServer, localModel, samplesPerSource = 3, judge = true, onPartial, resumeFile } = {}) {
  const { bridgeUrl, remoteModel, judgeModel } = cfg();
  const tasks = loadTasks();
  const sources = ["impl-debounce", "hard-lru-cache"].filter((id) => tasks.has(id));
  const startedAt = Date.now();

  // resume: a prior (partial) run's completed variants are kept as-is; their
  // remote/local spend already happened, so they are never re-run
  let priorRows = [];
  if (resumeFile && existsSync(resumeFile)) {
    try {
      const prev = JSON.parse(readFileSync(resumeFile, "utf8"));
      priorRows = Array.isArray(prev.rows) ? prev.rows.filter((r) => r && r.sourceTask && r.sample) : [];
      console.log(`[e8] resume: ${priorRows.length} completed variant(s) loaded from ${resumeFile}`);
    } catch (err) {
      console.warn(`[e8] resume file unreadable (${err?.message ?? err}) — starting fresh`);
    }
  }
  const done = new Set(priorRows.map((r) => `${r.sourceTask}#${r.sample}`));
  const rows = [...priorRows];

  const draftSummary = (val) => (val
    ? { id: val.id, category: val.category, difficulty: val.difficulty, verifyTestFile: val.verifyTestFile, fileNames: val.files ? Object.keys(val.files) : [] }
    : null);

  /** e4Mint's remote arm exactly: authorDraft → extractJson → validateMintDraft. */
  const remoteArm = async (messages) => {
    const res = await chat({ baseUrl: bridgeUrl, model: remoteModel, messages, maxTokens: 3000, temperature: 0.3 });
    const parsed = res.ok ? extractJson(res.content) : { ok: false, error: res.error };
    const { val, names, testFiles, validator, failReasons } = validateMintDraft(parsed);
    return {
      val, accepted: validator,
      record: {
        ok: parsed.ok, accepted: validator, failReasons,
        latencyMs: res.latencyMs, ttftMs: res.ttftMs,
        promptTokens: res.usage.promptTokens, completionTokens: res.usage.completionTokens,
        costUsd: costOf(remoteModel, res.usage.promptTokens, res.usage.completionTokens),
        files: names.length, hasTest: testFiles.length === 1,
        // full final draft for the blind judge (accepted only; resume-safe — it
        // lives in the saved row, not just in this process's memory)
        judgePayload: validator && val ? { id: val.id, prompt: val.prompt, files: val.files } : null,
      },
    };
  };

  /** Cascade arm: local draft → validate → (invalid ⇒) one remote repair → validate. */
  const cascadeArm = async (messages) => {
    // stage 1 — LOCAL DRAFT (e4Mint local arm: grammar on, thinking off, t=0.3, 3000 max)
    const draft = await chat({
      baseUrl: localServer.baseUrl, model: localModel, messages,
      maxTokens: 3000, temperature: 0.3, jsonSchema: MINT_SCHEMA, extra: NO_THINKING,
      timeoutMs: 900_000, // 2-vCPU prefill-bound worst case (E4 saw ~295s under load)
    });
    const draftParsed = draft.ok ? extractJson(draft.content) : { ok: false, error: draft.error };
    const v1 = validateMintDraft(draftParsed);
    const rec = {
      localDraftOk: draftParsed.ok,
      localDraftValid: v1.validator,
      draftFailReasons: v1.failReasons,
      localLatencyMs: draft.latencyMs, localTtftMs: draft.ttftMs,
      localPromptTokens: draft.usage.promptTokens, localCompletionTokens: draft.usage.completionTokens,
      repaired: false, // repair attempted (draft failed stage-2 validation)
      accepted: false,
      origin: null, // "local" | "repair" | null(rejected)
      remoteCostUsd: 0,
    };
    let finalVal = null;
    if (v1.validator) {
      finalVal = v1.val;
      rec.accepted = true;
      rec.origin = "local";
    } else {
      rec.repaired = true;
      // stage 3 — REMOTE REPAIR: the authorDraft transcript + the validator error
      const assistantDraft = draft.content && draft.content.trim()
        ? draft.content
        : "(the local model returned an empty draft)";
      const repairMessages = [
        ...messages,
        { role: "assistant", content: assistantDraft },
        { role: "user", content: `That draft failed validation with: ${v1.failReasons.join("; ")}. Return the complete corrected JSON draft only.` },
      ];
      const rep = await chat({ baseUrl: bridgeUrl, model: remoteModel, messages: repairMessages, maxTokens: 3000, temperature: 0.3 });
      const repParsed = rep.ok ? extractJson(rep.content) : { ok: false, error: rep.error };
      const v2 = validateMintDraft(repParsed);
      rec.repairOk = repParsed.ok;
      rec.repairValid = v2.validator;
      rec.repairFailReasons = v2.failReasons;
      rec.repairLatencyMs = rep.latencyMs;
      rec.repairTtftMs = rep.ttftMs;
      rec.repairPromptTokens = rep.usage.promptTokens;
      rec.repairCompletionTokens = rep.usage.completionTokens;
      rec.remoteCostUsd = costOf(remoteModel, rep.usage.promptTokens, rep.usage.completionTokens);
      if (v2.validator) {
        finalVal = v2.val;
        rec.accepted = true;
        rec.origin = "repair";
      }
      // failure-mode forensics (clipped — full drafts are kept out of the JSON)
      if (!draftParsed.ok) rec.rawLocalDraftHead = String(draft.content ?? "").slice(0, 300);
      if (repParsed.ok && !v2.validator) rec.rawRepairHead = String(rep.content ?? "").slice(0, 300);
    }
    rec.draft = draftSummary(v1.val);
    rec.final = draftSummary(finalVal);
    rec.judgePayload = finalVal ? { id: finalVal.id, prompt: finalVal.prompt, files: finalVal.files } : null;
    return { val: finalVal, record: rec };
  };

  for (const srcId of sources) {
    const task = tasks.get(srcId);
    const messages = mintCurriculumMessages(task);
    for (let k = 0; k < samplesPerSource; k++) {
      if (done.has(`${srcId}#${k + 1}`)) {
        console.log(`[e8] ${srcId} #${k + 1}/${samplesPerSource}: already recorded (resume) — skipping`);
        continue;
      }
      const t0 = Date.now();
      console.log(`[e8] ${srcId} #${k + 1}/${samplesPerSource}: remote baseline draft …`);
      const remote = await remoteArm(messages);
      console.log(`[e8] ${srcId} #${k + 1}: remote ${remote.accepted ? "ACCEPTED" : `REJECTED (${remote.record.failReasons?.join("; ")})`} in ${remote.record.latencyMs}ms ($${remote.record.costUsd.toFixed(4)})`);
      console.log(`[e8] ${srcId} #${k + 1}: local cascade draft (qwen3-0.6b) …`);
      const cascade = await cascadeArm(messages);
      const c = cascade.record;
      console.log(`[e8] ${srcId} #${k + 1}: cascade draft ${c.localDraftValid ? "VALID (accept, $0 remote)" : `INVALID (${c.draftFailReasons.join("; ")})`}`);
      if (c.repaired) {
        console.log(`[e8] ${srcId} #${k + 1}: repair ${c.accepted ? "ACCEPTED" : `REJECTED (${c.repairFailReasons?.join("; ")})`} in ${c.repairLatencyMs}ms ($${c.remoteCostUsd.toFixed(4)})`);
      }
      rows.push({
        sourceTask: srcId, sample: k + 1,
        remote: remote.record,
        cascade: c,
        judged: null, // filled after all runs (see below)
        variantElapsedMs: Date.now() - t0,
      });
      if (onPartial) onPartial(buildResult({ rows, sources, localModel, remoteModel, judgeModel, samplesPerSource, startedAt, partial: true, resumedFrom: priorRows.length }));
    }
  }

  // blind judge — only cascade ACCEPTS have an output to judge; pair them with
  // the same variant's remote-final output when the remote arm also accepted.
  // (resume-safe: rows already judged keep their verdict)
  if (judge) {
    for (const row of rows) {
      if (row.judged || !row.cascade.judgePayload || !row.remote.judgePayload) continue;
      const j = await judgePair({
        bridgeUrl, judgeModel,
        system: JUDGE_SYSTEM,
        question: JUDGE_QUESTION,
        outputA: JSON.stringify(row.cascade.judgePayload),
        outputB: JSON.stringify(row.remote.judgePayload),
      });
      row.judged = { winner: j.winner, consistent: j.consistent, aScore: j.aScore, bScore: j.bScore };
      console.log(`[e8] judge ${row.sourceTask} #${row.sample}: ${j.winner}${j.consistent ? "" : " (flip→tie)"}`);
      if (onPartial) onPartial(buildResult({ rows, sources, localModel, remoteModel, judgeModel, samplesPerSource, startedAt, partial: true, resumedFrom: priorRows.length }));
    }
  }

  const result = buildResult({ rows, sources, localModel, remoteModel, judgeModel, samplesPerSource, startedAt, partial: false, resumedFrom: priorRows.length });
  if (onPartial) onPartial(result);
  return result;
}

// ---------------------------------------------------------------- aggregation

function buildResult({ rows, sources, localModel, remoteModel, judgeModel, samplesPerSource, startedAt, partial, resumedFrom = 0 }) {
  const n = rows.length || 1;
  const cascadeRows = rows.map((r) => r.cascade);
  const remoteRows = rows.map((r) => r.remote);

  const cAccepted = cascadeRows.filter((c) => c.accepted).length;
  const rAccepted = remoteRows.filter((x) => x.accepted).length;
  const repairAttempts = cascadeRows.filter((c) => c.repaired).length;
  const repairValid = cascadeRows.filter((c) => c.repaired && c.repairValid).length;

  const totalRepairCost = round6(cascadeRows.reduce((a, c) => a + (c.remoteCostUsd ?? 0), 0));
  const totalRemoteCost = round6(remoteRows.reduce((a, x) => a + (x.costUsd ?? 0), 0));

  const cascadeAcceptRate = cAccepted / n;
  const remoteAcceptRate = rAccepted / n;
  const cascadeCostPerAccepted = cAccepted ? totalRepairCost / cAccepted : null;
  const remoteCostPerAccepted = rAccepted ? totalRemoteCost / rAccepted : null;

  const judgedRows = rows.filter((r) => r.judged);
  const cascadeWins = judgedRows.filter((r) => r.judged.winner === "A").length;
  const cascadeLosses = judgedRows.filter((r) => r.judged.winner === "B").length;
  const ties = judgedRows.filter((r) => r.judged.winner === "tie").length;

  const summary = {
    experiment: "E8-mint-cascade",
    hypothesis: "H10",
    localModel, remoteModel, judgeModel,
    sources: sources.length, samplesPerSource, samples: rows.length,
    partial, resumedFrom,
    complete: rows.length >= sources.length * samplesPerSource,
    elapsedMs: Date.now() - startedAt,
    cascade: {
      n: rows.length,
      localDraftValidRate: cascadeRows.filter((c) => c.localDraftValid).length / n,
      repairAttempted: repairAttempts,
      repairValidRate: repairAttempts ? repairValid / repairAttempts : null,
      acceptRate: cascadeAcceptRate,
      origins: {
        local: cascadeRows.filter((c) => c.origin === "local").length,
        repair: cascadeRows.filter((c) => c.origin === "repair").length,
        rejected: cascadeRows.filter((c) => !c.accepted).length,
      },
      localLatency: latencyStats(cascadeRows.map((c) => ({ latencyMs: c.localLatencyMs }))),
      repairLatency: latencyStats(cascadeRows.filter((c) => c.repaired).map((c) => ({ latencyMs: c.repairLatencyMs }))),
      totalRemoteCostUsd: totalRepairCost,
      costPerAcceptedUsd: cascadeCostPerAccepted === null ? null : round6(cascadeCostPerAccepted),
    },
    remote: {
      n: rows.length,
      acceptRate: remoteAcceptRate,
      latency: latencyStats(remoteRows),
      totalCostUsd: totalRemoteCost,
      costPerAcceptedUsd: remoteCostPerAccepted === null ? null : round6(remoteCostPerAccepted),
    },
    judge: {
      pairsJudged: judgedRows.length,
      cascadeWins, ties, cascadeLosses,
      unjudged: rows.length - judgedRows.length,
      unjudgedWhy: {
        cascadeRejected: rows.filter((r) => !r.cascade.accepted).length,
        remoteRejected: rows.filter((r) => !r.remote.accepted && r.cascade.accepted).length,
      },
    },
    h10: {
      // thresholds: accept-rate within 10pts of remote, strictly cheaper per
      // accepted, judge wins+ties >= losses (consistency-gated)
      acceptRateGap: round4(cascadeAcceptRate - remoteAcceptRate),
      thresholdAcceptRate: cascadeAcceptRate >= remoteAcceptRate - 0.10,
      thresholdCostPerAccepted: cascadeCostPerAccepted !== null && remoteCostPerAccepted !== null
        ? cascadeCostPerAccepted < remoteCostPerAccepted
        : null,
      thresholdJudgeParity: judgedRows.length ? (cascadeWins + ties) >= cascadeLosses : null,
    },
  };
  return { summary, rows };
}

// ---------------------------------------------------------------- rendering

export function renderE8(r, log = console.log) {
  const s = r.summary;
  log("\n=== E8 mint cascade (H10) ===");
  log(mdTable([{
    model: s.localModel, samples: s.samples,
    cascadeAccept: num(s.cascade.acceptRate), remoteAccept: num(s.remote.acceptRate),
    localDraftValid: num(s.cascade.localDraftValidRate),
    repairAttempts: s.cascade.repairAttempted,
    costPerAccCascade: s.cascade.costPerAcceptedUsd == null ? "—" : `$${num(s.cascade.costPerAcceptedUsd, 5)}`,
    costPerAccRemote: s.remote.costPerAcceptedUsd == null ? "—" : `$${num(s.remote.costPerAcceptedUsd, 5)}`,
    judgeWTL: `${s.judge.cascadeWins}/${s.judge.ties}/${s.judge.cascadeLosses}`,
  }]));
  log(`  cascade: local p50 ${s.cascade.localLatency?.p50 ?? "—"}ms` +
    ` | repair p50 ${s.cascade.repairLatency?.p50 ?? "—"}ms (${s.cascade.repairAttempted} attempted, ${Math.round((s.cascade.repairValidRate ?? 0) * 100)}% valid)` +
    ` | remote arm p50 ${s.remote.latency?.p50 ?? "—"}ms`);
  log(`  H10 thresholds: acceptGap ${num(s.h10.acceptRateGap)} (need >= -0.10): ${pass(s.h10.thresholdAcceptRate)}` +
    ` | cost/accepted cascade ${s.cascade.costPerAcceptedUsd == null ? "—" : `$${s.cascade.costPerAcceptedUsd}`} < remote ${s.remote.costPerAcceptedUsd == null ? "—" : `$${s.remote.costPerAcceptedUsd}`}: ${pass(s.h10.thresholdCostPerAccepted)}` +
    ` | judge W+T>=L: ${pass(s.h10.thresholdJudgeParity)}`);
}

function pass(b) { return b === null || b === undefined ? "—" : b ? "PASS" : "FAIL"; }
function round4(x) { return Math.round(x * 10000) / 10000; }
function round6(x) { return Math.round(x * 1000000) / 1000000; }
