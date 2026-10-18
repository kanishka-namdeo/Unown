/**
 * renders.mjs — receipt rendering for each experiment, extracted from the
 * runner so it is unit-testable (`node --test`) without a model, a server,
 * or an API key.
 *
 * Null-safety contract: a summary lane can be legitimately ABSENT — E1 runs
 * `--no-remote` in CI (fixtures only, no key), which nulls every remote
 * stat (remoteJsonValidity/kindAgreement/outcomeAgreement null, remote
 * latency {n:0}). Renders must print "—" for absent lanes, never throw.
 * This is exactly the class that red run 39123722085 crashed on
 * (renderE1 calling .toFixed on null) — regression-tested in
 * renders.test.mjs.
 */
import { mdTable, num } from "./report.mjs";

const p50 = (s) => s?.latency?.p50 ?? "—";

export function renderE1(r, log = console.log) {
  const s = r.summary;
  log("\n=== E1 note triage ===");
  log(mdTable([{
    model: s.localModel, notes: s.notes,
    localJSON: num(s.localJsonValidity), remoteJSON: num(s.remoteJsonValidity),
    kindAgree: num(s.kindAgreement), outcomeAgree: num(s.outcomeAgreement),
    localP50ms: s.localLatency?.p50 ?? "—", remoteP50ms: s.remoteLatency?.p50 ?? "—",
    remoteCost: s.remoteCostUsd == null ? "—" : `$${s.remoteCostUsd}`, localCost: "$0",
  }]));
}

export function renderE2(r, log = console.log) {
  const s = r.summary;
  log("\n=== E2 dream replay ===");
  log(mdTable([{
    model: s.localModel, grammar: s.grammar,
    remoteOk: s.remote?.ok ?? "—", localOk: s.local?.ok ?? "—", localValidatorSane: s.local?.saneLength ?? "—",
    remoteP50ms: s.remote?.latencyMs ?? "—", localMs: s.local?.latencyMs ?? "—",
    judge: s.judged ? `${s.judged.winner} (${s.judged.consistent ? "consistent" : "flip"})` : "unjudged",
    remoteCost: s.remote?.costUsd == null ? "—" : `$${num(s.remote.costUsd, 4)}`, localCost: "$0",
  }]));
}

export function renderE3(r, log = console.log) {
  const s = r.summary;
  log("\n=== E3 mine replay ===");
  log(mdTable([{
    model: s.localModel, grammar: s.grammar, runs: s.runs,
    remoteJSON: num(s.remote?.jsonOk), localJSON: num(s.local?.jsonOk),
    remoteValid: num(s.remote?.validatorPass), localValid: num(s.local?.validatorPass),
    remoteP50ms: p50(s.remote), localP50ms: p50(s.local),
    remoteCost: s.remote?.costUsd == null ? "—" : `$${s.remote.costUsd}`, localCost: "$0",
  }]));
  for (const j of s.judged ?? []) log(`  judge ${j.taskId}: ${j.winner}`);
}

export function renderE4(r, log = console.log) {
  const s = r.summary;
  log("\n=== E4 mint replay ===");
  log(mdTable([{
    model: s.localModel,
    remoteJSON: num(s.remote?.jsonOk), localJSON: num(s.local?.jsonOk),
    remoteValid: num(s.remote?.validatorPass), localValid: num(s.local?.validatorPass),
    remoteMs: p50(s.remote), localMs: p50(s.local),
    remoteCost: s.remote?.costUsd == null ? "—" : `$${s.remote.costUsd}`, localCost: "$0",
  }]));
}

export function renderE5(r, log = console.log) {
  const s = r.summary;
  log("\n=== E5 embed triage ===");
  log(mdTable([{
    n: s.n, embedOkRate: num(s.embedOkRate), agreementWithRemote: num(s.agreementWithRemote), p50ms: s.latency?.p50 ?? "—",
  }]));
}
