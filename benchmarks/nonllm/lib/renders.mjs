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

// ---------------------------------------------------------------- campaign #2

export function renderN6(r) {
  const s = r.summary;
  console.log("\n== N6 Ettin-17m cross-encoder A/B (H23) ==");
  const rows = [];
  const lane = (name, v) => rows.push({
    lane: name,
    ok: v && !v.error ? "y" : "n",
    spearmanVsRemote: num(v?.spearmanVsRemote, 3),
    top5OverlapVsRemote: num(v?.top5OverlapVsRemote, 2),
    p50ms: num(v?.p50ms, 0),
    error: v?.error ?? "",
  });
  lane("ms-marco-MiniLM (incumbent)", s.msmarco);
  lane("ettin-reranker-17m (JS head)", s.ettin);
  console.log(mdTable(rows));
  if (s.ettinVsMsmarco) console.log(`ettin-vs-msmarco Spearman: ${num(s.ettinVsMsmarco.spearman, 3)} (inter-lane agreement)`);
  else console.log("ettin-vs-msmarco: — (a lane failed)");
  if (s.remote) console.log(`remote scoring call: ${s.remote.latencyMs ?? "—"}ms, ${s.remote.ok ?? "?"}/${s.candidates ?? "?"} parsed`);
  if (s.ettin?.load) console.log(`ettin load: ${num(s.ettin.load.loadMs, 0)}ms, rss +${num(s.ettin.load.rssDeltaMB, 0)}MB${s.ettin.load.error ? ` ERR ${s.ettin.load.error}` : ""}`);
}

export function renderN7(r) {
  const s = r.summary;
  console.log("\n== N7 BM25 + cosine RRF fusion (H24) ==");
  const lanes = s.lanes ?? {};
  console.log(mdTable([
    {
      lane: "bge-cosine",
      spearmanVsRemote: num(lanes.cosine?.spearmanVsRemote, 3),
      top5OverlapVsRemote: num(lanes.cosine?.top5OverlapVsRemote, 2),
      cost: `${num(lanes.cosine?.embedP50ms, 0)}ms/doc`,
      error: lanes.cosine?.error ?? "",
    },
    {
      lane: "bm25",
      spearmanVsRemote: num(lanes.bm25?.spearmanVsRemote, 3),
      top5OverlapVsRemote: num(lanes.bm25?.top5OverlapVsRemote, 2),
      cost: `${num(lanes.bm25?.totalMs, 1)}ms total`,
      error: "",
    },
    {
      lane: "rrf(cos+bm25, k=60)",
      spearmanVsRemote: "rank-fused",
      top5OverlapVsRemote: num(lanes.rrf?.top5OverlapVsRemote, 2),
      cost: "µs",
      error: "",
    },
  ]));
  if (s.disagreement) {
    console.log(`lexical catch: cosine-only top5 = [${(s.disagreement.cosineOnlyTop5 ?? []).join(", ") || "—"}] | bm25-only top5 = [${(s.disagreement.bm25OnlyTop5 ?? []).join(", ") || "—"}] (${s.disagreement.queryTokens ?? "—"} query tokens)`);
  }
  if (s.remote) console.log(`remote scoring call: ${s.remote.latencyMs ?? "—"}ms, ${s.remote.ok ?? "?"}/${s.candidates ?? "?"} parsed`);
}

export function renderN8(r) {
  const s = r.summary;
  console.log("\n== N8 injection-classifier shadow (H25) ==");
  console.log(`role: ${s.role ?? "shadow triage lane"}`);
  if (s.load && s.load.error) {
    console.log(`classifier load FAILED: ${s.load.error}`);
    return;
  }
  if (s.load) console.log(`load: ${num(s.load.loadMs, 0)}ms, rss +${num(s.load.rssDeltaMB, 0)}MB`);
  if (s.poison) {
    const rows = (s.poison.rows ?? []).map((row) => ({
      variant: row.id, adversarial: row.adversarial ? "ATTACK" : "benign", pInjection: num(row.p, 4),
    }));
    console.log(mdTable(rows));
    const catchRows = Object.entries(s.poison.catchAt ?? {}).map(([t, v]) => ({
      threshold: t, caught: `${v?.caught ?? "—"}/10`, benignFP: v?.fp ?? 0,
    }));
    console.log(mdTable(catchRows));
  }
  if (s.mpbench) {
    const m = s.mpbench;
    console.log(`MPBench-adapted (n=${m.n ?? "—"}, adversarial ${m.adversarial ?? "—"}): benign mean p=${num(m.benignMeanP, 4)}, adversarial mean p=${num(m.adversarialMeanP, 4)}, ${num(m.latencyPerCaseMs, 1)}ms/case`);
    console.log(mdTable((m.sweep ?? []).map((x) => ({
      threshold: x.threshold, precision: num(x.precision, 3), recall: num(x.recall, 3), f1: num(x.f1, 3), tp: x.tp, fp: x.fp, fn: x.fn, tn: x.tn,
    }))));
    if (m.bySignal?.length) console.log(mdTable(m.bySignal.map((x) => ({ signal: x.signal, n: x.n, caughtAt07: `${x.caughtAt07}/${x.n}` }))));
    if (m.byType && Object.keys(m.byType).length) {
      console.log(mdTable(Object.entries(m.byType).map(([k, v]) => ({ attackType: k, n: v.n, caughtAt07: `${v.caughtAt07}/${v.n}` }))));
    }
  }
}
