/**
 * renders.mjs — receipt rendering for the nonllm bench. NULL-SAFETY CONTRACT:
 * every render accepts summaries whose lanes can be entirely absent (--no-remote
 * nulls remote stats; a failed model load nulls its lane) — absent lanes print
 * an em dash, nothing throws. This class of bug cost local-llm a red CI run
 * (39123722085); the contract is pinned by renders.test.mjs.
 */
import { mdTable, pct, num } from "./report.mjs";

export function renderN0(r) {
  console.log("\n== N0 runtime probe (H9) ==");
  const rows = (r.summary.results ?? []).map((x) => ({
    model: x.model, params: x.params, loadOk: x.loadOk ?? false, loadMs: x.loadMs ?? "—",
    embedP50ms: num(x.embedP50ms, 0), embedP90ms: num(x.embedP90ms, 0), rerankP50ms: num(x.rerankP50ms, 0),
    dim: x.dim ?? "—", rssDeltaMB: num(x.rssDeltaMB, 0), error: x.error ?? "",
  }));
  console.log(mdTable(rows));
  console.log(`runtime: ${r.summary.runtime?.runtime ?? "?"} on ${r.summary.runtime?.platform ?? "?"} | rss peak ${num(r.summary.rssPeakMB, 0)}MB`);
}

export function renderN1(r) {
  const s = r.summary;
  console.log("\n== N1 embedding triage vs remote (H10) ==");
  const rows = Object.entries(s.lanes ?? {}).map(([lane, v]) => ({
    lane, kindAcc: num(v.kindAcc, 3), kindMacroF1: num(v.kindMacroF1, 3), centroidAcc: num(v.kindCentroidAcc, 3),
    outcomeAcc: num(v.outcomeAcc, 3), failedRecall: num(v.outcomeFailedRecall, 2),
    embedP50ms: num(v.embedP50ms, 0), okRate: num(v.embedOkRate, 3),
    cascade15: `${pct(v.cascadeCoverage15)} cov @ ${num(v.cascadeAcc15, 3)} acc`,
  }));
  console.log(mdTable(rows));
  const rem = s.remote;
  if (rem) {
    console.log(mdTable([{
      lane: "remote-llm", kindAcc: num(rem.kindAcc, 3), kindMacroF1: num(rem.kindMacroF1, 3),
      outcomeAcc: num(rem.outcomeNAcc, 3), parseOkRate: num(rem.parseOkRate, 3),
      p50ms: num(rem.latency?.p50, 0),
    }]));
  } else {
    console.log("remote baseline: — (--no-remote)");
  }
  if (s.corpus) console.log(`corpus: ${s.corpus.n} notes, kinds [${(s.corpus.kinds ?? []).join(", ")}]`);
}

export function renderN2(r) {
  const s = r.summary;
  console.log("\n== N2 near-dup detection (H11) ==");
  if (s.corpus) console.log(`corpus: ${s.corpus.bases} bases, ${s.corpus.docs} docs, ${s.corpus.pairs} pairs (${s.corpus.dups} dup / ${s.corpus.negatives} non-dup, ${s.corpus.paraphrases ?? 0} paraphrase)`);
  console.log(mdTable([
    { lane: "minhash", msPerDoc: num(s.minhash?.msPerDoc, 2), estMAE: num(s.minhash?.estMAE, 3), bestF1: num(s.minhash?.bestF1, 3), at: num(s.minhash?.bestThreshold, 2) },
    { lane: "bge-cosine", msPerDoc: num(s.embedding?.msPerDoc, 1), estMAE: "—", bestF1: num(s.embedding?.bestF1, 3), at: num(s.embedding?.bestThreshold, 2) },
    { lane: "two-stage(confirm)", msPerDoc: "—", estMAE: "—", bestF1: num(s.twoStage?.f1, 3), at: "LSH>=0.35 & cos>=0.92" },
    { lane: "two-stage(union)", msPerDoc: num((s.minhash?.msPerDoc ?? 0) + (s.embedding?.msPerDoc ?? 0), 1), estMAE: "—", bestF1: num(s.union?.f1, 3), at: "minhash>=0.5 | cos>=0.92" },
  ]));
  if (s.byClass?.length) {
    console.log("by perturbation class (recall at each lane's best threshold):");
    console.log(mdTable(s.byClass.map((c) => ({
      class: c.class, n: c.n, minhashRecall: num(c.minhashRecallAtBest, 2), cosineRecall: num(c.cosineRecallAtBest, 2),
      avgJaccard: num(c.avgExactJaccard, 3), avgCos: num(c.avgCos, 3),
    }))));
  }
}

export function renderN3(r) {
  const s = r.summary;
  console.log("\n== N3 dream-input reranking (H12) ==");
  const row = { candidates: s.candidates ?? "—" };
  if (s.crossEncoder && !s.crossEncoder.error) {
    row.ceSpearman = num(s.crossEncoder.spearmanVsRemote, 3);
    row.ceTop5 = num(s.crossEncoder.top5OverlapVsRemote, 2);
    row.ceP50ms = num(s.crossEncoder.p50ms, 0);
    row.ceTotalMs = num(s.crossEncoder?.totalMs, 0);
  } else row.ce = s.crossEncoder?.error ? "load failed" : "—";
  if (s.biEncoder && !s.biEncoder.error) {
    row.biSpearman = num(s.biEncoder.spearmanVsRemote, 3);
    row.biTop5 = num(s.biEncoder.top5OverlapVsRemote, 2);
    row.biP50ms = num(s.biEncoder.p50ms, 0);
  } else row.bi = s.biEncoder?.error ? "load failed" : "—";
  console.log(mdTable([row]));
  if (s.remote) console.log(`remote scoring call: ${s.remote.latencyMs ?? "—"}ms, ${s.remote.ok ?? "?"}/${s.candidates ?? "?"} parsed`);
}

export function renderN4(r) {
  const s = r.summary;
  console.log("\n== N4 activation scoring vs remote importance (H13) ==");
  const sp = s.spearman ?? {};
  console.log(mdTable([{
    notes: s.notes ?? "—",
    full: num(sp.activationFull, 3), noRecency: num(sp.activationNoRecency, 3),
    recencyOnly: num(sp.recencyOnly, 3),
    relevanceOnly: num(sp.relevanceOnly, 3), frequencyOnly: num(sp.frequencyOnly, 3),
    structuralOnly: num(sp.structuralOnly, 3), top5: num(s.top5OverlapVsRemote, 2), top5noRec: num(s.top5OverlapNoRecency, 2),
    embedMs: num(s.embedMs, 0), scoreMs: num(s.scoreMs, 1),
  }]));
}

export function renderN5(r) {
  const s = r.summary;
  console.log("\n== N5 extractive dream-input curation (H14) ==");
  const c = s.compression ?? {};
  console.log(mdTable([{
    notes: c.notes ?? "—", avgKeptRatio: num(c.avgKeptRatio, 2),
    fullPromptTokens: c.fullPromptTokens ?? "—", compressedPromptTokens: c.compressedPromptTokens ?? "—",
    reductionPct: num(c.reductionPct, 1) + "%",
  }]));
  console.log(mdTable([
    { lane: "control (full)", jsonOk: s.control?.jsonOk ?? "—", saneLength: s.control?.saneLength ?? "—", suspicious: s.control?.suspicious ?? "—", latencyMs: num(s.control?.latencyMs, 0) },
    { lane: "curated (lexrank)", jsonOk: s.curated?.jsonOk ?? "—", saneLength: s.curated?.saneLength ?? "—", suspicious: s.curated?.suspicious ?? "—", latencyMs: num(s.curated?.latencyMs, 0) },
  ]));
  if (s.judge) {
    console.log(`judge: winner=${s.judge.winner} consistent=${s.judge.consistent} | A(full)=${JSON.stringify(s.judge.aScore)} B(curated)=${JSON.stringify(s.judge.bScore)}`);
    if (s.judge.reason) console.log(`reason: ${s.judge.reason}`);
  } else {
    console.log("judge: — (skipped or a lane failed structural checks)");
  }
}
