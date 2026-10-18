/**
 * renders.mjs — null-safe receipt renders for the complementary testbench.
 *
 * Contract (same as local-llm/lib/renders.mjs): an absent lane is a LEGITIMATE
 * state (e.g. --no-remote runs, boot failures, missing timings) and renders
 * as an em dash — never a thrown TypeError. Pinned by renders.test.mjs,
 * gated in CI BEFORE model provisioning.
 */
export function num(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return Number(v).toFixed(digits);
}
export function pct(x, digits = 0) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return (100 * x).toFixed(digits) + "%";
}
export function ratio(v, digits = 2) {
  return v === null || v === undefined ? "—" : `${num(v, digits)}x`;
}

/** C1/C2 speed-lane render: one row per variant. */
export function renderSpeed(run) {
  const rows = (run?.results ?? []).map((r) => ({
    variant: r.variant,
    ok: r.agg ? `${r.agg.ok}/${r.agg.n}` : "boot-fail",
    "tok/s (med)": r.agg ? num(r.agg.medianTokPerSec, 1) : "—",
    "speedup": r.tokPerSecRatio ? ratio(r.tokPerSecRatio) : "—",
    "p50 ms": r.agg ? num(r.agg.medianLatencyMs, 0) : "—",
    "identity": r.identitySummary ? `${r.identitySummary.identical}/${r.identitySummary.checked}` : "—",
    "rss MB": r.rssMB ?? "—",
    bootError: r.bootError ? String(r.bootError).slice(0, 40) : "",
  }));
  return `### ${run?.label ?? "(unlabeled)"}\n\n${mdTable(rows)}\n`;
}

/** C3 KV-reuse render. */
export function renderKvReuse(s) {
  const q = s?.summary ?? {};
  const rows = [
    { metric: "first call: prompt tokens (full prefill)", value: q.firstCallPromptTokens ?? "—" },
    { metric: "first call: prefill ms", value: q.firstCallPromptMs ?? "—" },
    { metric: "follow-up: tokens processed (median)", value: q.secondCallProcessedTokensMedian ?? "—" },
    { metric: "follow-up: prefill ms (median)", value: q.secondCallPromptMsMedian ?? "—" },
    { metric: "control (broken prefix): tokens processed (median)", value: q.controlProcessedTokensMedian ?? "—" },
    { metric: "prefix tokens saved (median)", value: q.prefixTokensSavedMedian ?? "—" },
    { metric: "prefill time saved %", value: q.prefillTimeSavedPct != null ? `${q.prefillTimeSavedPct}%` : "—" },
    { metric: "repeat-call identity (guard)", value: q.repeatIdentical === true ? "identical" : q.repeatIdentical === false ? "DIFFERS" : "—" },
  ];
  return `### C3 — prefix KV reuse\n\n${mdTable(rows)}\n`;
}

/** C4 compression render. */
export function renderCompress(s) {
  const q = s?.summary ?? {};
  const rows = [
    { metric: "replays", value: q.replays ?? "—" },
    { metric: "compressor ok rate", value: pct(q.compressorOkRate, 0) },
    { metric: "payload token cut (median)", value: q.medianPayloadCutPct != null ? `${q.medianPayloadCutPct}%` : "—" },
    { metric: "remote input saved (median)", value: q.medianRemoteCostSavedPct != null ? `${q.medianRemoteCostSavedPct}%` : "—" },
    { metric: "validator pass: full", value: pct(q.validatorPassFull, 0) },
    { metric: "validator pass: compressed", value: pct(q.validatorPassCompressed, 0) },
    { metric: "judge: compressed wins", value: q.judge ? q.judge.wins : "—" },
    { metric: "judge: ties", value: q.judge ? q.judge.ties : "—" },
    { metric: "judge: compressed losses", value: q.judge ? q.judge.losses : "—" },
    { metric: "compressor p50 ms", value: q.compressor ? num(q.compressor.latency, 0) : "—" },
  ];
  return `### C4 — local compression, remote savings\n\n${mdTable(rows)}\n`;
}

/** C5 cache render. */
export function renderCache(s) {
  const q = s?.summary ?? {};
  const rows = [
    { metric: "notes replayed", value: q.notes ?? "—" },
    { metric: "L1 exact hits (byte-identical by construction)", value: `${q.exactHits ?? "—"}/${q.exactExpected ?? "—"}` },
    { metric: "L2 near-dup hits on exact replay (by threshold)", value: JSON.stringify(q.nearDupHitsOnReplay ?? {}) },
    { metric: "danger cases (outcome-flipped edits)", value: q.dangerCases ?? "—" },
    { metric: "danger L2 hits by threshold (MUST be 0 to verify)", value: JSON.stringify(q.dangerL2HitsByThreshold ?? {}) },
    { metric: "danger false-serve rate", value: pct(q.dangerFalseServeRate, 1) },
    { metric: "embed latency p50 (ms)", value: q.embedLatencyMs ?? "—" },
  ];
  return `### C5 — two-tier semantic cache\n\n${mdTable(rows)}\n`;
}

/** C6 retrieval render. */
export function renderRetrieval(s) {
  const q = s?.summary ?? {};
  const rows = [
    { metric: "cases", value: q.cases ?? "—" },
    { metric: "recall@5 embed(raw question)", value: pct(q.rawRecall5, 1) },
    { metric: "recall@5 embed(rewritten)", value: pct(q.rwRecall5, 1) },
    { metric: "recall@5 BM25(raw question)", value: pct(q.bm25Recall5, 1) },
    { metric: "recall@5 RRF(embed-rewrite + BM25)", value: pct(q.fusedRecall5, 1) },
    { metric: "rewrite lift over embed(raw) @5", value: q.recall5Lift != null ? `${(100 * q.recall5Lift).toFixed(1)}pp` : "—" },
    { metric: "recall@10 raw / rewritten / bm25 / fused", value: `${pct(q.rawRecall10, 1)} / ${pct(q.rwRecall10, 1)} / ${pct(q.bm25Recall10, 1)} / ${pct(q.fusedRecall10, 1)}` },
    { metric: "rewrite p50 ms", value: q.rewriteP50Ms ?? "—" },
    { metric: "rewrite JSON ok rate", value: pct(q.rewriteJsonOkRate, 0) },
  ];
  const byType = Object.entries(q.byQuestionType ?? {}).map(([t, v]) => ({
    type: t, n: v.n, "raw@5": pct(v.rawRecall5, 0), "rewritten@5": pct(v.rwRecall5, 0),
  }));
  return `### C6 — query rewriting for memory retrieval\n\n${mdTable(rows)}\n\nBy question type:\n\n${mdTable(byType)}\n`;
}

/** C7 bake-off render. */
export function renderBakeoff(out) {
  const probeRows = (out?.probes ?? []).map((p) => ({
    model: p.model, "startup ms": p.startupMs ?? "—", "rss MB": p.rssMB ?? "—",
    "gen tok/s": num(p.genTokPerSec, 1), "ttft ms": p.ttftMs ?? "—", "json_schema": p.jsonSchemaOk === true ? "ok" : p.jsonSchemaOk === false ? "FAIL" : "—",
  }));
  const t = out?.triage ?? {};
  const triRows = [
    { model: "qwen3-0.6b (incumbent)", "json ok": pct(t.incumbent?.summary?.jsonOkRate, 0), "p50 ms": t.incumbent?.summary?.latency ?? "—" },
    { model: "qwen3.5-0.8b (candidate)", "json ok": pct(t.candidate?.summary?.jsonOkRate, 0), "p50 ms": t.candidate?.summary?.latency ?? "—" },
  ];
  const extra = [];
  if (t.candidate?.summary) extra.push({ metric: "candidate agreement with incumbent", value: pct(t.candidate.summary.agreementWithRef, 0) });
  if (t.remote?.incumbentAgreement != null) extra.push({ metric: "incumbent agreement with remote", value: pct(t.remote.incumbentAgreement, 0) });
  if (t.remote?.candidateAgreement != null) extra.push({ metric: "candidate agreement with remote", value: pct(t.remote.candidateAgreement, 0) });
  let visionTxt = "";
  if (out?.vision && !out.vision.error) {
    visionTxt = `\nVision probe (local ${out.vision.local?.model} + ${out.vision.local?.mmproj}): boots=${out.vision.local?.boots}, answered=${out.vision.local?.answeredColor}, ${out.vision.local?.latencyMs}ms, $0${out.vision.remote ? ` — remote ${out.vision.remote.model}: ${out.vision.remote.answeredColor ? "answered" : "?"} in ${out.vision.remote.latencyMs}ms` : ""}\n`;
  } else if (out?.vision?.error) {
    visionTxt = `\nVision probe: FAILED — ${String(out.vision.error).slice(0, 120)}\n`;
  }
  return `### C7 — tiny-model bake-off\n\nProbes:\n\n${mdTable(probeRows)}\n\nTriage replay:\n\n${mdTable(triRows)}\n\n${mdTable(extra)}\n${visionTxt}`;
}

function mdTable(rows) {
  if (!rows?.length) return "_(no rows)_\n";
  const keys = Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    let s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v);
    s = s.replace(/\|/g, "\\|").replace(/\n/g, " ");
    return s.length > 60 ? s.slice(0, 57) + "…" : s;
  };
  const head = `| ${keys.join(" | ")} |`;
  const sep = `| ${keys.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${keys.map((k) => esc(r[k])).join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}\n`;
}
