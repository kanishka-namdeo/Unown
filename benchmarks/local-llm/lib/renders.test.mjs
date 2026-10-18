/**
 * renders.test.mjs — null-safety regression tests for the receipt renders.
 *
 * Red-run provenance: CI run 39123722085 (local-llm probe, commit e5393ee)
 * failed on all three OSes at the "E1 note triage, local-only" step —
 * `renderE1` called `.toFixed(2)` on `remoteJsonValidity`, which is null
 * in `--no-remote` mode (the mode CI itself runs). The experiments SUCCEEDED;
 * only the receipt rendering crashed. These tests pin the contract that
 * renders never throw on legitimately-absent lanes.
 *
 * Run: node --test benchmarks/local-llm/   (no model, no server, no key)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderE1, renderE2, renderE3, renderE4, renderE5 } from "./renders.mjs";
import { mdTable, num, latencyStats } from "./report.mjs";

const capture = () => {
  const lines = [];
  const log = (...xs) => lines.push(xs.map(String).join(" "));
  return { log, lines, text: () => lines.join("\n") };
};

// The exact summary shape e1Triage({... noRemote: true}) produces —
// remote stats null, remoteLatency = latencyStats([]) = {n: 0}.
const e1NoRemote = {
  summary: {
    experiment: "E1-note-triage",
    localModel: "qwen3-0.6b", remoteModel: "kimi-k2.5", notes: 8, noRemote: true,
    localJsonValidity: 0.9667,
    remoteJsonValidity: null,
    kindAgreement: null,
    outcomeAgreement: null,
    remoteLatency: latencyStats([]), // { n: 0 } — no p50 key at all
    localLatency: latencyStats([{ latencyMs: 812 }, { latencyMs: 966 }, { latencyMs: 1104 }]),
    remoteCostUsd: 0,
    localCostUsd: 0,
  },
};

const e1Full = {
  summary: {
    experiment: "E1-note-triage",
    localModel: "qwen3-0.6b", remoteModel: "kimi-k2.5", notes: 30, noRemote: false,
    localJsonValidity: 0.9667, remoteJsonValidity: 1,
    kindAgreement: 0.8, outcomeAgreement: 0.7333,
    remoteLatency: latencyStats([{ latencyMs: 2100 }, { latencyMs: 2600 }]),
    localLatency: latencyStats([{ latencyMs: 900 }]),
    remoteCostUsd: 0.0123, localCostUsd: 0,
  },
};

test("E1 render survives the exact --no-remote summary that red run 39123722085 crashed on", () => {
  const c = capture();
  assert.doesNotThrow(() => renderE1(e1NoRemote, c.log));
  const t = c.text();
  assert.match(t, /=== E1 note triage ===/);
  assert.match(t, /0\.97/); // localJsonValidity rendered
  assert.match(t, /—/);     // absent remote lanes rendered as em dash, not thrown
  assert.doesNotMatch(t, /undefined/);
  assert.doesNotMatch(t, /null/);
});

test("E1 render still renders numbers when every lane is present", () => {
  const c = capture();
  renderE1(e1Full, c.log);
  const t = c.text();
  assert.match(t, /1\.00/); // remoteJsonValidity
  assert.match(t, /0\.80/); // kindAgreement
  assert.match(t, /\$0\.0123/);
  assert.doesNotMatch(t, /—/);
});

test("E2 render tolerates absent judge, null cost and missing lanes", () => {
  const c = capture();
  assert.doesNotThrow(() => renderE2({
    summary: {
      experiment: "E2-dream-replay", localModel: "lfm2.5-2.6b", remoteModel: "kimi-k2.5", grammar: true,
      notesIn: 12,
      remote: null, local: { ok: true, latencyMs: 413000, saneLength: true, costUsd: null },
      judged: null,
    },
  }, c.log));
  const t = c.text();
  assert.match(t, /unjudged/);
  assert.match(t, /—/);
  assert.doesNotMatch(t, /undefined/); // `$${costUsd?.toFixed(4)}` used to print "$undefined"
  assert.doesNotMatch(t, /\$undefined/);
});

test("E3/E4 renders tolerate zero-sample aggregates (latencyStats([]) = {n:0})", () => {
  const empty = { n: 0, jsonOk: 0, validatorPass: 0, latency: latencyStats([]), costUsd: 0 };
  const c3 = capture();
  assert.doesNotThrow(() => renderE3({
    summary: { experiment: "E3-mine-replay", localModel: "qwen3-0.6b", remoteModel: "kimi-k2.5", grammar: true, runs: 0, remote: empty, local: empty, judged: [] },
  }, c3.log));
  assert.doesNotMatch(c3.text(), /undefined/);

  const c4 = capture();
  assert.doesNotThrow(() => renderE4({
    summary: { experiment: "E4-mint-replay", localModel: "lfm2.5-2.6b", remoteModel: "kimi-k2.5", sources: 0, remote: empty, local: empty },
  }, c4.log));
  assert.doesNotMatch(c4.text(), /undefined/);
});

test("E3 render still prints judged rows when present", () => {
  const c = capture();
  renderE3({
    summary: {
      experiment: "E3-mine-replay", localModel: "qwen3-0.6b", remoteModel: "kimi-k2.5", grammar: true, runs: 2,
      remote: { n: 2, jsonOk: 1, validatorPass: 0.5, latency: latencyStats([{ latencyMs: 3000 }]), costUsd: 0.01 },
      local: { n: 2, jsonOk: 0.5, validatorPass: 0.5, latency: latencyStats([{ latencyMs: 400 }]), costUsd: 0 },
      judged: [{ taskId: "t1", winner: "local" }, { taskId: "t2", winner: "unjudged" }],
    },
  }, c.log);
  assert.match(c.text(), /judge t1: local/);
  assert.match(c.text(), /judge t2: unjudged/);
});

test("E5 render tolerates an empty run (n=0 rates, no latency p50)", () => {
  const c = capture();
  assert.doesNotThrow(() => renderE5({
    summary: { experiment: "E5-embed-triage", n: 0, embedOkRate: 0, agreementWithRemote: 0, latency: latencyStats([]) },
  }, c.log));
  assert.doesNotMatch(c.text(), /undefined/);
});

// ---------------------------------------------------------------- helpers

test("num(): fixed-point for numbers, em dash for null/undefined/NaN", () => {
  assert.equal(num(0.9667), "0.97");
  assert.equal(num(1), "1.00");
  assert.equal(num(0.0123, 4), "0.0123");
  assert.equal(num(null), "—");
  assert.equal(num(undefined), "—");
  assert.equal(num(NaN), "—");
});

test("mdTable(): null/undefined cells render empty, numbers keep 2dp, never throw", () => {
  const t = mdTable([{ a: null, b: undefined, c: 0.5, d: "x|y" }]);
  assert.match(t, /---/);
  assert.doesNotMatch(t, /null/);
  assert.doesNotMatch(t, /undefined/);
  assert.match(t, /0\.50/);
  assert.ok(t.includes("x\\|y"), "pipe must be escaped as x\\|y in cell text");
  assert.doesNotThrow(() => mdTable([]));
});

test("latencyStats(): empty input returns {n:0} with no percentile keys", () => {
  const s = latencyStats([]);
  assert.equal(s.n, 0);
  assert.equal(s.p50, undefined); // callers must treat as absent, not crash
});
