/**
 * judge.mjs — blind A/B judging by the remote big model (via the Unown bridge).
 *
 * Method (bias-controlled):
 *  - The judge never sees which system produced an output: they are labelled
 *    "Output A"/"Output B", and each pair is judged TWICE with positions
 *    swapped. Only position-consistent verdicts are counted; flips count as
 *    ties. Scores per output on 1-5 per criterion, plus an overall winner.
 *  - Used to answer: "is the local model's output as good as the remote
 *    baseline's for this subtask?" without disclosing origins.
 */

import { chat, extractJson } from "./openai.mjs";

/**
 * Judge two outputs on criteria. Returns { aScore, bScore, winner, consistent, reason }.
 * criteria: [{key, description}] — judged 1-5 each; winner from pairwise question.
 */
export async function judgePair({ bridgeUrl, judgeModel, system, question, outputA, outputB, maxTokens = 800 }) {
  const orderings = [
    ["A", "B"],
    ["B", "A"], // position swap
  ];
  const verdicts = [];
  for (const [first, second] of orderings) {
    const of = first === "A" ? outputA : outputB;
    const os = second === "A" ? outputA : outputB;
    const res = await chat({
      baseUrl: bridgeUrl,
      model: judgeModel,
      stream: false,
      maxTokens,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `${question}

OUTPUT A:
${clip(of, 4000)}

OUTPUT B:
${clip(os, 4000)}

Score BOTH outputs 1-5 on each criterion, then pick the overall winner.
Return STRICT JSON: {"scores": {"A": {"<criterion>": <1-5>, ...}, "B": {...}}, "winner": "A"|"B"|"tie", "reason": "<one sentence>"}`,
        },
      ],
    });
    if (!res.ok) { verdicts.push({ error: res.error }); continue; }
    const parsed = extractJson(res.content);
    if (parsed.ok) verdicts.push(parsed.value);
    else verdicts.push({ error: parsed.error });
  }

  const valid = verdicts.filter((v) => v && v.scores);
  if (valid.length < 2) {
    return { aScore: null, bScore: null, winner: "unjudged", consistent: false, reason: "judge failed", raw: verdicts };
  }
  // average scores across the two orderings (scores are keyed by A/B label, not position)
  const avg = (which) => {
    const vals = {};
    for (const v of valid) {
      for (const [k, s] of Object.entries(v.scores?.[which] ?? {})) {
        (vals[k] ??= []).push(Number(s));
      }
    }
    const out = {};
    for (const [k, arr] of Object.entries(vals)) out[k] = round2(arr.reduce((a, b) => a + b, 0) / arr.length);
    return out;
  };
  const aScore = avg("A");
  const bScore = avg("B");
  const [w1, w2] = verdicts.map((v) => (v && v.winner ? v.winner : null));
  const consistent = w1 === w2 && w1 !== null;
  const winner = consistent ? w1 : "tie";
  return { aScore, bScore, winner, consistent, reason: valid[0]?.reason ?? "", raw: verdicts.map((v) => ({ winner: v.winner, scores: v.scores, reason: v.reason })) };
}

/** Solo quality score (1-5 per criterion) for one output — used for absolute floors. */
export async function judgeSolo({ bridgeUrl, judgeModel, system, question, output, maxTokens = 500 }) {
  const res = await chat({
    baseUrl: bridgeUrl,
    model: judgeModel,
    stream: false,
    maxTokens,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: `${question}

OUTPUT:
${clip(output, 4000)}

Score the output 1-5 on each criterion.
Return STRICT JSON: {"scores": {"<criterion>": <1-5>, ...}, "reason": "<one sentence>"}`,
      },
    ],
  });
  if (!res.ok) return { ok: false, error: res.error };
  const parsed = extractJson(res.content);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, ...parsed.value };
}

function clip(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n / 2) + "\n...[clipped]...\n" + s.slice(-n / 2) : s;
}
function round2(x) { return Math.round(x * 100) / 100; }
