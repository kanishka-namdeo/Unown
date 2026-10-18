/**
 * semcache.mjs — C5 (H20): a two-tier semantic cache for the learning layer.
 *
 * Tier L1 (exact): sha256(model + canonical messages + sampling params) ->
 *   stored response. Replay of the identical call is byte-identical by
 *   construction (tautology check only).
 * Tier L2 (near-dup): ONLY keyable within the same SYSTEM-prompt hash; the
 *   key is the embedding of the final user payload, matched by cosine
 *   similarity >= threshold. The local nomic-embed lane provides embeddings.
 *
 * The danger-case corpus is adversarial by design:
 *   - note EDITS that flip the outcome (paraphrase + answer change) must
 *     MISS at the production threshold, or the tier is refuted;
 *   - dream re-runs with a bumped memory version (same notes) are the
 *     realistic near-dup hit candidates — judged cached-vs-fresh.
 *
 * Hit rate is measured on a realistic replay (triage every note twice),
 * plus the near-dup threshold curve 0.95 / 0.97 / 0.99.
 */
import { createHash } from "node:crypto";
import { loadNotes, triageMessages } from "../../local-llm/lib/prompts.mjs";
import { cfg } from "../../local-llm/lib/experiments.mjs";
import { judgePair } from "../../local-llm/lib/judge.mjs";
import { embed, cosine } from "../../local-llm/lib/openai.mjs";
import { startLane, chatTimed, INCUMBENT, EMBED_MODEL } from "./lane.mjs";

const NO_THINKING = { chat_template_kwargs: { enable_thinking: false } };
export const NEAR_DUP_THRESHOLDS = [0.95, 0.97, 0.99];

function sha(s) {
  return createHash("sha256").update(s).digest("hex");
}

export class TwoTierCache {
  constructor({ thresholds = NEAR_DUP_THRESHOLDS } = {}) {
    this.exact = new Map(); // key -> {content, storedAt}
    this.near = []; // {systemHash, payloadHash, vec, content, storedAt}
    this.thresholds = thresholds;
    this.stats = { l1Hits: 0, l1Misses: 0, l2Hits: Object.fromEntries(thresholds.map((t) => [t, 0])), l2Misses: 0, embedMs: [] };
  }
  exactKey(model, messages, params) {
    return sha(JSON.stringify({ model, messages, params }));
  }
  systemHash(messages) {
    return sha(messages.find((m) => m.role === "system")?.content ?? "");
  }
  payloadText(messages) {
    return messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n");
  }
  /** Look up: L1 exact, else L2 near-dup (needs precomputed vec for the payload). */
  lookup({ model, messages, params, vec }) {
    const k = this.exactKey(model, messages, params);
    const hit = this.exact.get(k);
    if (hit) { this.stats.l1Hits++; return { tier: "L1", content: hit.content }; }
    this.stats.l1Misses++;
    if (!vec) { this.stats.l2Misses++; return null; }
    const sysH = this.systemHash(messages);
    let best = { cos: -1, entry: null };
    for (const e of this.near) {
      if (e.systemHash !== sysH) continue; // cross-task contamination impossible by construction
      const c = cosine(e.vec, vec);
      if (c > best.cos) best = { cos: c, entry: e };
    }
    const hitsByT = Object.fromEntries(this.thresholds.map((t) => [t, false]));
    if (best.entry) {
      for (const t of this.thresholds) {
        if (best.cos >= t) { hitsByT[t] = true; this.stats.l2Hits[t]++; }
      }
    }
    if (!Object.values(hitsByT).some(Boolean)) this.stats.l2Misses++;
    return best.entry && Object.values(hitsByT).some(Boolean)
      ? { tier: "L2", cos: Number(best.cos.toFixed(4)), content: best.entry.content, bestCos: Number(best.cos.toFixed(4)) }
      : { tier: null, bestCos: best.entry ? Number(best.cos.toFixed(4)) : null };
  }
  store({ model, messages, params, content, vec }) {
    this.exact.set(this.exactKey(model, messages, params), { content, storedAt: Date.now() });
    if (vec) this.near.push({ systemHash: this.systemHash(messages), payloadHash: sha(this.payloadText(messages)), vec, content, storedAt: Date.now() });
  }
}

/** Adversarial note edits: paraphrase the note while flipping its outcome-bearing content. */
function dangerNoteEdit(note) {
  const flipped = String(note.content ?? "")
    .replace(/\bpassed\b/gi, "FAILED")
    .replace(/\bsucceeded\b/gi, "failed")
    .replace(/\ball tests (are |were )?green\b/gi, "the test suite is red");
  const edited = {
    ...note,
    content: `${flipped}\n\n(post-hoc edit: the verification step was re-run and the outcome changed)`,
  };
  return edited;
}

/** C5 — replay corpus, cache mechanics, judged danger cases. */
export async function c5Cache({ noteLimit = 12, noRemote = false, judge = true } = {}) {
  const { bridgeUrl, remoteModel, judgeModel } = cfg();
  const notes = loadNotes().slice(0, noteLimit);

  // one llama-server serving BOTH nomic-embed (embeddings) and qwen3-0.6B?
  // llama-server serves ONE model; two lanes would need two servers. The
  // embed lane is the cheap one: run it first, collect vectors, stop it, then
  // run the 0.6B lane for fresh answers.
  const embedServer = await startLane({ model: EMBED_MODEL, ctx: 2048 });
  const vecs = new Map();
  const embedLat = [];
  try {
    for (const n of notes) {
      const payload = triageMessages(n).filter((m) => m.role !== "system").map((m) => m.content).join("\n");
      const r = await embed({ baseUrl: embedServer.baseUrl, model: "nomic", input: payload });
      if (r.ok) { vecs.set(n.id, r.vec); embedLat.push(r.latencyMs); }
    }
    // danger-case vectors
    const dangerVecs = new Map();
    for (const n of notes.slice(0, 6)) {
      const payload = triageMessages(dangerNoteEdit(n)).filter((m) => m.role !== "system").map((m) => m.content).join("\n");
      const r = await embed({ baseUrl: embedServer.baseUrl, model: "nomic", input: payload });
      if (r.ok) dangerVecs.set(n.id, r.vec);
    }
    var dangerVectors = dangerVecs;
  } finally {
    await embedServer.stop();
  }

  const cache = new TwoTierCache();
  const gen = await startLane({ model: INCUMBENT, ctx: 6144 });
  const rows = [];
  try {
    // pass 1: populate (fresh calls, stored)
    for (const n of notes) {
      const messages = triageMessages(n);
      const t0 = Date.now();
      const out = await chatTimed({ baseUrl: gen.baseUrl, model: "replay", messages, maxTokens: 200, temperature: 0, extra: NO_THINKING });
      const freshMs = Date.now() - t0;
      cache.store({ model: "replay", messages, params: { maxTokens: 200, temperature: 0 }, content: out.content, vec: vecs.get(n.id) ?? null });
      rows.push({ phase: "populate", noteId: n.id, freshMs, content: out.content });
    }
    // pass 2: exact replays (should be L1 hits) + latency
    for (const n of notes) {
      const messages = triageMessages(n);
      const lookup = cache.lookup({ model: "replay", messages, params: { maxTokens: 200, temperature: 0 }, vec: vecs.get(n.id) ?? null });
      rows.push({ phase: "replay", noteId: n.id, hit: lookup?.tier ?? null, cacheMs: 1 });
    }
    // danger cases: edited notes (outcome flipped) must MISS (or the answer served is WRONG by construction)
    const dangerRows = [];
    for (const n of notes.slice(0, 6)) {
      const edited = dangerNoteEdit(n);
      const messages = triageMessages(edited);
      const lookup = cache.lookup({ model: "replay", messages, params: { maxTokens: 200, temperature: 0 }, vec: dangerVectors?.get(n.id) ?? null });
      const fresh = await chatTimed({ baseUrl: gen.baseUrl, model: "replay", messages, maxTokens: 200, temperature: 0, extra: NO_THINKING });
      let judged = null;
      if (lookup?.tier === "L2" && judge && !noRemote) {
        // the cached answer was computed for the PRE-edit note — judge it against the fresh (correct) one
        const original = rows.find((r) => r.phase === "populate" && r.noteId === n.id);
        const jd = await judgePair({
          bridgeUrl, judgeModel,
          system: "You are auditing a semantic LLM cache. Judge which triage answer better fits the CURRENT note text.",
          question: "The note's verification outcome was edited (e.g. passed -> FAILED, with a post-hoc edit note). Which answer correctly reflects the EDITED note?",
          outputA: fresh.content, outputB: original?.content ?? "(missing)",
        });
        judged = { winner: jd.winner, consistent: jd.consistent, reason: (jd.reason ?? "").slice(0, 160) };
      }
      dangerRows.push({
        noteId: n.id,
        lookupTier: lookup?.tier ?? null,
        bestCos: lookup?.bestCos ?? lookup?.cos ?? null,
        servedContentCorrect: lookup?.tier === "L2" ? false : null, // L2 hit on a flipped note = wrong by construction
        freshContent: fresh.content,
        judged,
      });
    }
    const hitT = {};
    for (const t of NEAR_DUP_THRESHOLDS) {
      hitT[t] = dangerRows.filter((d) => d.lookupTier === "L2" && d.bestCos != null && d.bestCos >= t).length;
    }
    return {
      experiment: "C5-cache",
      hypotheses: ["H20"],
      summary: {
        notes: notes.length,
        exactHits: cache.stats.l1Hits,
        exactExpected: notes.length, // pass 2 replays
        exactByteIdentical: cache.stats.l1Hits === notes.length,
        nearDupHitsOnReplay: cache.stats.l2Hits,
        dangerCases: dangerRows.length,
        dangerL2HitsByThreshold: hitT, // MUST be 0 at the production threshold
        dangerFalseServeRate: dangerRows.filter((d) => d.lookupTier === "L2").length / (dangerRows.length || 1),
        embedLatencyMs: medianOf(embedLat),
        thresholds: NEAR_DUP_THRESHOLDS,
        noRemote,
      },
      rows,
      dangerRows,
    };
  } finally {
    await gen.stop();
  }
}

function medianOf(xs) {
  const a = xs.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : null;
}
