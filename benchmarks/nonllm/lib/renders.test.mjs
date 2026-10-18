/**
 * renders.test.mjs — pins the null-safety contract of every receipt render:
 * each render must survive a summary whose lanes are entirely absent (the
 * exact class of the local-llm red run 39123722085: `.toFixed` on null in
 * --no-remote mode). Runs with plain `node --test` — NO install needed
 * (renders import only report.mjs, which imports only local-llm's llama.mjs
 * constants — no native deps).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderN0, renderN1, renderN2, renderN3, renderN4, renderN5 } from "./renders.mjs";

// capture console output so renders run silently
const captured = [];
const origLog = console.log;
console.log = (...a) => captured.push(a.map(String).join(" "));

test("renderN0 survives empty/failed lanes", () => {
  assert.doesNotThrow(() => renderN0({ summary: { results: [] } }));
  assert.doesNotThrow(() => renderN0({ summary: { results: [{ model: "bge-small", loadOk: false, error: "boom" }], runtime: { runtime: "node x", platform: "linux-x64" } } }));
});

test("renderN1 survives --no-remote (null remote) and empty lanes", () => {
  assert.doesNotThrow(() => renderN1({ summary: { lanes: {}, remote: null } }));
  assert.doesNotThrow(() => renderN1({ summary: { lanes: { "bge-small": { kindAcc: 0.9, embedP50ms: null } }, remote: null, corpus: { n: 10, kinds: ["benchmark"] } } }));
  assert.doesNotThrow(() => renderN1({ summary: { lanes: { "bge-small": {} }, remote: { kindAcc: 0.95, latency: { p50: null } } } }));
});

test("renderN2 survives absent embedding lane and empty byClass", () => {
  assert.doesNotThrow(() => renderN2({ summary: {} }));
  assert.doesNotThrow(() => renderN2({ summary: { corpus: { bases: 0, docs: 0, pairs: 0, dups: 0, negatives: 0 }, minhash: { msPerDoc: null }, embedding: { error: "load failed" }, twoStage: {}, byClass: [] } }));
});

test("renderN3 survives failed cross-encoder and absent remote", () => {
  assert.doesNotThrow(() => renderN3({ summary: {} }));
  assert.doesNotThrow(() => renderN3({ summary: { candidates: 20, crossEncoder: { error: "no native module" }, biEncoder: { error: "x" }, remote: null } }));
  assert.doesNotThrow(() => renderN3({ summary: { candidates: 20, crossEncoder: { spearmanVsRemote: null, top5OverlapVsRemote: null, p50ms: null, totalMs: null }, biEncoder: { spearmanVsRemote: 0.4, top5OverlapVsRemote: null, p50ms: 20 }, remote: { latencyMs: 900, ok: 20 } } }));
});

test("renderN4 survives null spearman components", () => {
  assert.doesNotThrow(() => renderN4({ summary: {} }));
  assert.doesNotThrow(() => renderN4({ summary: { notes: 40, spearman: { activationFull: null, recencyOnly: null }, top5OverlapVsRemote: null, embedMs: null, scoreMs: null } }));
});

test("renderN5 survives null judge and missing lanes", () => {
  assert.doesNotThrow(() => renderN5({ summary: {} }));
  assert.doesNotThrow(() => renderN5({ summary: { compression: { notes: 12, fullPromptTokens: null, reductionPct: null }, control: null, curated: null, judge: null } }));
  assert.doesNotThrow(() => renderN5({ summary: { compression: { notes: 12, fullPromptTokens: 5000, compressedPromptTokens: 3000, reductionPct: 40 }, control: { jsonOk: true, saneLength: true, suspicious: false, latencyMs: 12000 }, curated: { jsonOk: false, saneLength: false, suspicious: false, latencyMs: 9000 }, judge: { winner: "tie", consistent: false, aScore: null, bScore: null, reason: "flips" } } }));
});

test("every render prints something even for empty summaries", () => {
  captured.length = 0;
  renderN0({ summary: { results: [] } });
  renderN1({ summary: {} });
  renderN2({ summary: {} });
  renderN3({ summary: {} });
  renderN4({ summary: {} });
  renderN5({ summary: {} });
  console.log = origLog;
  assert.ok(captured.length >= 6, `expected output from all six renders, got ${captured.length}`);
});
