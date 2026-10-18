/**
 * renders.test.mjs — pins the null-safety contract of renders.mjs.
 *
 * An absent lane (no remote in --no-remote mode, a boot-failed specdec
 * variant, missing timings on an old build) must render as "—", never throw.
 * Run: node --test lib/renders.test.mjs (cwd: benchmarks/complementary).
 * Gated in CI BEFORE model provisioning (same pattern as local-llm).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  renderSpeed, renderKvReuse, renderCompress, renderCache, renderRetrieval, renderBakeoff,
  num, pct, ratio,
} from "./renders.mjs";

test("num/pct/ratio null contract", () => {
  assert.equal(num(null), "—");
  assert.equal(num(undefined), "—");
  assert.equal(num(Number.NaN), "—");
  assert.equal(num(1.234), "1.23");
  assert.equal(pct(null), "—");
  assert.equal(pct(0.5), "50%");
  assert.equal(ratio(null), "—");
  assert.equal(ratio(1.35), "1.35x");
});

test("renderSpeed handles boot-failed variant and missing lanes", () => {
  const run = {
    label: "C1 ngram · triage · grammar",
    results: [
      { variant: "baseline", agg: { ok: 10, n: 10, medianTokPerSec: 20.5, medianLatencyMs: 3200 }, rssMB: 1040 },
      { variant: "ngram-mod", agg: null, bootError: "spec-type flag rejected", rssMB: null, tokPerSecRatio: null, identitySummary: null },
    ],
  };
  const md = renderSpeed(run);
  assert.match(md, /baseline/);
  assert.match(md, /boot-fail/);
  assert.match(md, /—/);
  assert.doesNotThrow(() => renderSpeed(null));
  assert.doesNotThrow(() => renderSpeed({}));
});

test("renderKvReuse with partial timings", () => {
  const md = renderKvReuse({ summary: { firstCallPromptTokens: 640, firstCallPromptMs: null, prefillTimeSavedPct: null, repeatIdentical: true } });
  assert.match(md, /640/);
  assert.match(md, /identical/);
  assert.match(md, /—/);
  assert.doesNotThrow(() => renderKvReuse(null));
});

test("renderCompress with and without remote lanes", () => {
  const withRemote = renderCompress({ summary: { replays: 5, compressorOkRate: 1, medianPayloadCutPct: 41.2, validatorPassFull: 0.5, validatorPassCompressed: 0.5, judge: { wins: 1, ties: 3, losses: 1 } } });
  assert.match(withRemote, /41\.2%/);
  assert.match(withRemote, /3/);
  const noRemote = renderCompress({ summary: { replays: 5, compressorOkRate: 1, validatorPassFull: null, judge: null } });
  assert.match(noRemote, /—/);
  assert.doesNotThrow(() => renderCompress(null));
});

test("renderCache danger-case shape", () => {
  const md = renderCache({ summary: { notes: 12, exactHits: 12, exactExpected: 12, dangerCases: 6, dangerL2HitsByThreshold: { "0.95": 0, "0.97": 0, "0.99": 0 }, dangerFalseServeRate: 0, embedLatencyMs: 210 } });
  assert.match(md, /12\/12/);
  assert.match(md, /MUST be 0/);
  assert.doesNotThrow(() => renderCache(null));
});

test("renderRetrieval lift formatting", () => {
  const md = renderRetrieval({ summary: { cases: 40, rawRecall5: 0.52, rwRecall5: 0.61, recall5Lift: 0.09, rewriteP50Ms: 1400, rewriteJsonOkRate: 1, byQuestionType: { "temporal-reasoning": { n: 10, rawRecall5: 0.4, rwRecall5: 0.6 } } } });
  assert.match(md, /9\.0pp/);
  assert.match(md, /temporal-reasoning/);
  assert.doesNotThrow(() => renderRetrieval(null));
});

test("renderBakeoff with vision probe variants", () => {
  const md = renderBakeoff({
    probes: [{ model: "qwen3-0.6b", startupMs: 1050, rssMB: 1040, genTokPerSec: 20.1, ttftMs: 170, jsonSchemaOk: true }],
    triage: { incumbent: { summary: { jsonOkRate: 1, latency: 3700 } }, candidate: { summary: { jsonOkRate: 1, latency: 2100, agreementWithRef: 0.92 } } },
    vision: { local: { model: "qwen3.5-0.8b", mmproj: "mmproj-x.gguf", boots: true, answeredColor: true, latencyMs: 4200 } },
  });
  assert.match(md, /qwen3\.5-0\.8b/);
  assert.match(md, /answered=true/);
  const err = renderBakeoff({ vision: { error: "mmproj download 404" } });
  assert.match(err, /FAILED/);
  assert.doesNotThrow(() => renderBakeoff(null));
});
