/**
 * retrieval.mjs — C6 (H21): small-model query rewriting for memory
 * retrieval, on the recall-qa corpus (40 LongMemEval-adapted questions with
 * oracle evidence sessions).
 *
 * The retrieval layer this experiment measures does NOT exist in production
 * (memory injection is whole-tier) — this is the candidate pre-processor:
 *   question -> [raw arm] embed(question) -> kNN over session embeddings
 *   question -> [rewrite arm] 0.6B rewrites to keyword phrases -> embed -> kNN
 * recall@5 / recall@10 against oracle evidence (sessions containing
 * hasAnswer turns). Same pool, same embedder — the ONLY variable is the
 * query text.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embed } from "../../local-llm/lib/openai.mjs";
import { buildBM25, rrfFuse } from "../../nonllm/lib/bm25.mjs"; // campaign-2-verified lane (their H24, post-renumber): Lucene-default BM25 + RRF fusion, zero deps
import { startLane, chatTimed, median, INCUMBENT, EMBED_MODEL } from "./lane.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.resolve(HERE, "../../memory-eval/recall-qa/corpus.json");

const NO_THINKING = { chat_template_kwargs: { enable_thinking: false } };

const REWRITE_SCHEMA = {
  type: "object",
  properties: {
    queries: { type: "array", items: { type: "string", maxLength: 160 }, maxItems: 4 },
  },
  required: ["queries"],
};

function rewriteMessages(question, questionDate) {
  return [
    {
      role: "system",
      content: `You expand a user question into short keyword search phrases for retrieving relevant session notes from a personal memory store. The notes record the user's past assistant sessions (questions, plans, preferences, activities). Produce 2-4 short keyword phrases (not sentences) that a text search over session notes should use. Include concrete entities (names, places, topics). The question may reference relative dates; today's date is ${questionDate ?? "unknown"} — translate relative time references into the absolute dates the notes would carry.`,
    },
    { role: "user", content: `Question: ${question}\n\nReturn the keyword phrases.` },
  ];
}

/** Session doc = its turns, lightly truncated for the embedder's 2048 ctx. */
function sessionDoc(session) {
  const text = (session.turns ?? [])
    .map((t) => `${t.role}: ${t.content}`)
    .join("\n");
  return text.length > 6000 ? text.slice(0, 3000) + "\n[…]\n" + text.slice(-2500) : text;
}

export function loadCorpus() {
  const j = JSON.parse(readFileSync(CORPUS, "utf8"));
  return j;
}

export async function c6Retrieval({ caseLimit = 40, topK = [5, 10], noRewriteLatencyCap = false } = {}) {
  const corpus = loadCorpus();
  const cases = corpus.cases.slice(0, caseLimit);
  if (!cases.length) throw new Error("recall-qa corpus empty");

  // ---- embed lane (nomic) ----
  const embedServer = await startLane({ model: EMBED_MODEL, ctx: 2048 });
  const pool = new Map(); // caseId -> [{sessionId, doc, vec}]
  const embedMs = [];
  try {
    for (const c of cases) {
      const docs = [];
      for (const s of c.sessions ?? []) {
        const doc = sessionDoc(s);
        const r = await embed({ baseUrl: embedServer.baseUrl, model: "nomic", input: doc });
        embedMs.push(r.latencyMs);
        docs.push({ sessionId: s.sessionId, doc, vec: r.ok ? r.vec : null, hasAnswer: (s.turns ?? []).some((t) => t.hasAnswer) });
      }
      pool.set(c.id, docs);
    }
  } finally {
    await embedServer.stop();
  }

  // ---- build the per-case pools (no LLM needed beyond the embed lane above) ----
  const rows = [];
  for (const c of cases) {
    const docs = pool.get(c.id);
    const evidence = docs.filter((d) => d.hasAnswer).map((d) => d.sessionId);
    if (!evidence.length) continue; // no oracle — skip
    rows.push({
      caseId: c.id, questionType: c.questionType, question: c.question,
      evidence, poolSize: docs.length,
      _docs: docs,
    });
  }
  // ---- query lane: rewrites (0.6B) + query embeddings (nomic) ----
  const embedServer2 = await startLane({ model: EMBED_MODEL, ctx: 2048 });
  const results = [];
  const rewriteLat = [];
  const rewriteFailures = [];
  try {
    // rewrite pass first (needs the 0.6B — already stopped above; redo rewrite inside its own lane below)
    // -> restructure: run rewrites in a second 0.6B lane
    const gen2 = await startLane({ model: INCUMBENT, ctx: 4096 });
    try {
      for (const row of rows) {
        const c = { question: row.question, questionDate: undefined };
        const t0 = Date.now();
        let rewrites = null;
        try {
          const out = await chatTimed({
            baseUrl: gen2.baseUrl, model: "rewriter",
            messages: rewriteMessages(row.question, undefined),
            maxTokens: 200, temperature: 0, jsonSchema: REWRITE_SCHEMA, extra: NO_THINKING,
          });
          const m = out.content.match(/\{[\s\S]*\}/);
          if (m) {
            const parsed = JSON.parse(m[0]);
            if (Array.isArray(parsed.queries) && parsed.queries.length) rewrites = parsed.queries.slice(0, 4);
          }
        } catch { /* fall back to raw */ }
        rewriteLat.push(Date.now() - t0);
        if (!rewrites) rewriteFailures.push(row.caseId);
        row._rewrites = rewrites;
      }
    } finally {
      await gen2.stop();
    }
    // query embeddings (raw + rewritten) on the embed lane
    for (const row of rows) {
      const rawE = await embed({ baseUrl: embedServer2.baseUrl, model: "nomic", input: row.question });
      row._rawVec = rawE.ok ? rawE.vec : null;
      const rq = row._rewrites?.length ? row._rewrites.join("\n") : row.question;
      const rwE = await embed({ baseUrl: embedServer2.baseUrl, model: "nomic", input: rq });
      row._rwVec = rwE.ok ? rwE.vec : null;
    }

    // scoring — four arms: embed(raw q), embed(rewritten q), BM25(raw q)
    // [the nonllm campaign-2 lane (their H24), on THIS corpus], and
    // RRF fusion(embed-rewrite + BM25-raw). Same pool, same oracle, one
    // variable per comparison.
    for (const row of rows) {
      const docs = row._docs.filter((d) => d.vec);
      const knn = (vec) => {
        const scored = docs.map((d) => ({ sessionId: d.sessionId, cos: cosineOf(vec, d.vec), hasAnswer: d.hasAnswer }));
        scored.sort((a, b) => b.cos - a.cos);
        return scored;
      };
      const rawRank = row._rawVec ? knn(row._rawVec) : [];
      const rwRank = row._rwVec ? knn(row._rwVec) : [];
      const bm25 = buildBM25(docs.map((d) => d.doc));
      const bm25Rank = bm25.rank(row.question).map((i) => docs[i]);
      const fused = rrfFuse([
        rwRank.map((d) => d.sessionId),
        bm25Rank.map((d) => d.sessionId),
      ]).map((sid) => docs.find((d) => d.sessionId === sid)).filter(Boolean);
      const recallAt = (rank, k) => (rank.slice(0, k).some((d) => d.hasAnswer) ? 1 : 0);
      results.push({
        caseId: row.caseId, questionType: row.questionType,
        poolSize: row.poolSize, evidenceCount: row.evidence.length,
        rewrites: row._rewrites ?? null,
        rawRecall5: rawRank.length ? recallAt(rawRank, 5) : null,
        rawRecall10: rawRank.length ? recallAt(rawRank, 10) : null,
        rwRecall5: rwRank.length ? recallAt(rwRank, 5) : null,
        rwRecall10: rwRank.length ? recallAt(rwRank, 10) : null,
        bm25Recall5: bm25Rank.length ? recallAt(bm25Rank, 5) : null,
        bm25Recall10: bm25Rank.length ? recallAt(bm25Rank, 10) : null,
        fusedRecall5: fused.length ? recallAt(fused, 5) : null,
        fusedRecall10: fused.length ? recallAt(fused, 10) : null,
        rawTop1: rawRank[0]?.sessionId ?? null,
        rwTop1: rwRank[0]?.sessionId ?? null,
      });
    }
  } finally {
    await embedServer2.stop();
  }

  const mean = (xs) => {
    const a = xs.filter((v) => typeof v === "number");
    return a.length ? Number((a.reduce((x, y) => x + y, 0) / a.length).toFixed(4)) : null;
  };
  const byType = {};
  for (const r of results) {
    byType[r.questionType] ??= { n: 0, raw5: [], rw5: [] };
    byType[r.questionType].n++;
    byType[r.questionType].raw5.push(r.rawRecall5);
    byType[r.questionType].rw5.push(r.rwRecall5);
  }
  for (const t of Object.keys(byType)) {
    byType[t].rawRecall5 = mean(byType[t].raw5);
    byType[t].rwRecall5 = mean(byType[t].rw5);
    delete byType[t].raw5;
    delete byType[t].rw5;
  }
  return {
    experiment: "C6-retrieval",
    hypotheses: ["H21"],
    summary: {
      cases: results.length,
      poolEmbedMs: medianOfArr(embedMs),
      rewriteP50Ms: medianOfArr(rewriteLat),
      rewriteJsonOkRate: 1 - rewriteFailures.length / (rows.length || 1),
      rawRecall5: mean(results.map((r) => r.rawRecall5)),
      rawRecall10: mean(results.map((r) => r.rawRecall10)),
      rwRecall5: mean(results.map((r) => r.rwRecall5)),
      rwRecall10: mean(results.map((r) => r.rwRecall10)),
      bm25Recall5: mean(results.map((r) => r.bm25Recall5)),
      bm25Recall10: mean(results.map((r) => r.bm25Recall10)),
      fusedRecall5: mean(results.map((r) => r.fusedRecall5)),
      fusedRecall10: mean(results.map((r) => r.fusedRecall10)),
      recall5Lift: Number(((mean(results.map((r) => r.rwRecall5)) ?? 0) - (mean(results.map((r) => r.rawRecall5)) ?? 0)).toFixed(4)),
      recall10Lift: Number(((mean(results.map((r) => r.rwRecall10)) ?? 0) - (mean(results.map((r) => r.rawRecall10)) ?? 0)).toFixed(4)),
      byQuestionType: byType,
    },
    results,
  };
}

function cosineOf(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
function medianOfArr(xs) {
  const a = xs.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : null;
}
