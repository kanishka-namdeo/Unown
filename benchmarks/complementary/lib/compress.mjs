/**
 * compress.mjs — C4 (H19): local token-level prompt compression for the
 * REMOTE lane. The tiny local model selects which payload chunks survive
 * BEFORE the expensive remote call.
 *
 * Method:
 *  - Payload = the production prompt's user message, split into chunks at
 *    line granularity (transcript lines for mining, note blocks for dream).
 *    SYSTEM prompt and the JSON contract are NEVER compressed.
 *  - The local 0.6B sees the numbered chunks + the task context + a token
 *    budget (keep <= B% of chunks), answers with a json_schema-constrained
 *    {keep:[int]} — grammar makes the shape structurally guaranteed.
 *  - Arms on the SAME remote model: (a) full replay, (b) compressed replay.
 *    Metrics: payload token cut (via llama-server /tokenize on the exact
 *    user payload before/after), remote usage.prompt_tokens delta, harness
 *    validator pass both arms, blind judge (position-swapped) of the two
 *    outputs, cost via local-llm COSTS.
 */
import { loadNotes, loadRuns, loadMemory, loadTasks, minerMessages, dreamMessages } from "../../local-llm/lib/prompts.mjs";
import { cfg, costOf } from "../../local-llm/lib/experiments.mjs";
import { judgePair } from "../../local-llm/lib/judge.mjs";
import { extractJson } from "../../local-llm/lib/openai.mjs";
import { startLane, chatTimed, tokenize, INCUMBENT } from "./lane.mjs";

const NO_THINKING = { chat_template_kwargs: { enable_thinking: false } };

// SYNC local-llm/lib/experiments.mjs MINER_SCHEMA (not exported there; copied
// verbatim — same constraint the production miner's prompt text carries)
const MINER_SCHEMA = {
  type: "object",
  properties: {
    diagnosis: { type: "string" },
    proposal: { type: "string" },
    patchLines: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: 6 },
    targetTier: { type: "string", enum: ["project", "local"] },
  },
  required: ["diagnosis", "proposal", "patchLines", "targetTier"],
};

const COMPRESS_SCHEMA = {
  type: "object",
  properties: {
    keep: { type: "array", items: { type: "integer" }, maxItems: 200 },
  },
  required: ["keep"],
};

/** Split the user payload into compressible chunks. Mining: transcript lines (non-empty). Dream: note blocks. */
export function chunkPayload(family, userContent) {
  if (family === "dream") {
    // split on "--- note (...)" block separators; keep separator lines as part of blocks
    const parts = userContent.split(/(?=^--- note \()/m);
    return parts.map((p) => p.trim()).filter((p) => p.length > 0);
  }
  // mining: group transcript into multi-line chunks on blank-ish boundaries for coherent context
  const lines = userContent.split("\n");
  const chunks = [];
  let buf = [];
  for (const line of lines) {
    buf.push(line);
    if (buf.join("\n").length >= 220) {
      chunks.push(buf.join("\n"));
      buf = [];
    }
  }
  if (buf.length) chunks.push(buf.join("\n"));
  return chunks.filter((c) => c.trim().length > 0);
}

function compressorMessages(family, chunks, keepBudget) {
  const system = `You are a prompt compressor for a self-improving coding agent's background jobs. You see numbered chunks of a ${family === "dream" ? "session-notes" : "failed-run transcript"} payload. Decide which chunks to KEEP so the downstream analyzer model can still do its job. Keep the chunks that carry failure signal, commands, error output, test results, code changes, decisions and concrete facts; drop filler, restatements and boilerplate. You may keep at most ${keepBudget} of the ${chunks.length} chunks.`;
  const user = `Payload chunks:\n\n${chunks.map((c, i) => `#chunk ${i}\n${c}`).join("\n\n")}\n\nReturn the indices of the chunks to keep (at most ${keepBudget}), ordered by importance.`;
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

/** Ask the local model which chunks to keep. Returns ordered keep list (may be shorter than budget). */
export async function compressPayload({ baseUrl, family, chunks, keepPct = 0.5 }) {
  const keepBudget = Math.max(1, Math.ceil(chunks.length * keepPct));
  const out = await chatTimed({
    baseUrl,
    model: "compressor",
    messages: compressorMessages(family, chunks, keepBudget),
    maxTokens: 800,
    temperature: 0,
    jsonSchema: COMPRESS_SCHEMA,
    extra: NO_THINKING,
  });
  const parsed = extractJson(out.content);
  const keep = parsed.ok && Array.isArray(parsed.value?.keep)
    ? [...new Set(parsed.value.keep.filter((i) => Number.isInteger(i) && i >= 0 && i < chunks.length))].sort((a, b) => a - b)
    : null;
  return {
    ok: keep !== null && keep.length > 0,
    keep: keep ?? [],
    keepBudget,
    completionTokens: out.usage.completionTokens,
    latencyMs: out.latencyMs,
    raw: parsed.ok ? null : out.content.slice(0, 200),
  };
}

function harnessValidator(val) {
  const patchLines = Array.isArray(val?.patchLines) ? val.patchLines.filter((l) => typeof l === "string" && l.trim()) : [];
  return Boolean(
    typeof val?.diagnosis === "string" && val.diagnosis.length > 0 &&
    patchLines.length > 0 && patchLines.length <= 6 &&
    patchLines.every((l) => l.length <= 200) &&
    (val.targetTier === "project" || val.targetTier === "local"),
  );
}

/**
 * C4 — compress-then-remote vs full-remote, on the SAME remote model.
 * Replays: mining (real FAILED runs) + dream (real notes + memory).
 */
export async function c4Compress({ runLimit = 4, keepPct = 0.5, noRemote = false, judge = true } = {}) {
  const { bridgeUrl, remoteModel, judgeModel } = cfg();
  const tasks = loadTasks();
  const runs = loadRuns().filter((r) => r.status === "failed" && Array.isArray(r.transcript) && r.transcript.length > 0).slice(0, runLimit);
  const mem = loadMemory();
  const memoryTiers = {
    policy: tierTextOf(mem, "policy"), project: tierTextOf(mem, "project"),
    user: tierTextOf(mem, "user"), local: tierTextOf(mem, "local"),
  };
  const notes = loadNotes().filter((n) => !n.dreamed).slice(0, 12);
  const dreams = notes.length >= 3 ? [dreamMessages({ version: mem?.version, content: tierTextOf(mem, "project") }, notes)] : [];

  const replays = [
    ...runs.map((run, i) => {
      const task = tasks.get(run.task_id) ?? tasks.get(tasks.keys().next().value);
      return { id: `mine-${String(run.id).slice(0, 8)}`, family: "mining", messages: minerMessages(task, run, memoryTiers), schema: MINER_SCHEMA, maxTokens: 1500 };
    }),
    ...dreams.map((m, i) => ({ id: `dream-${i}`, family: "dream", messages: m, schema: null, maxTokens: 2000 })),
  ];

  // local compressor lane (embed-capable not needed; one lane serves compressor + tokenizer)
  const server = await startLane({ model: INCUMBENT, ctx: 12288 });
  const rows = [];
  try {
    for (const r of replays) {
      const userMsg = r.messages[r.messages.length - 1].content;
      const chunks = chunkPayload(r.family, userMsg);
      const tokFull = await tokenize({ baseUrl: server.baseUrl, text: userMsg });

      // compression pass (local)
      const comp = await compressPayload({ baseUrl: server.baseUrl, family: r.family, chunks, keepPct });
      const compressedUser = comp.ok ? comp.keep.map((i) => chunks[i]).join("\n") : userMsg;
      const tokComp = await tokenize({ baseUrl: server.baseUrl, text: compressedUser });

      const row = {
        id: r.id, family: r.family, chunks: chunks.length, keepBudget: comp.keepBudget, kept: comp.keep.length,
        compressorOk: comp.ok, compressorLatencyMs: comp.latencyMs, compressorTokens: comp.completionTokens,
        payloadTokensFull: tokFull.n, payloadTokensCompressed: tokComp.n,
        payloadCutPct: tokFull.n && tokComp.n ? Number((100 * (1 - tokComp.n / tokFull.n)).toFixed(1)) : null,
      };

      if (!noRemote) {
        const remoteCall = async (messages) => {
          const res = await fetch(`${bridgeUrl}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: remoteModel, messages, max_tokens: r.maxTokens, temperature: 0.1, stream: false }),
            signal: AbortSignal.timeout(240_000),
          });
          if (!res.ok) throw new Error(`remote HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
          const j = await res.json();
          const content = j.choices?.[0]?.message?.content ?? "";
          const parsed = extractJson(content);
          return {
            content, parsed: parsed.ok ? parsed.value : null,
            promptTokens: j.usage?.prompt_tokens ?? null, completionTokens: j.usage?.completion_tokens ?? null,
          };
        };
        try {
          const full = await remoteCall(r.messages);
          const compMessages = [...r.messages.slice(0, -1), { role: "user", content: compressedUser }];
          const comp2 = await remoteCall(compMessages);
          row.full = {
            ok: Boolean(full.parsed), validator: harnessValidator(full.parsed),
            promptTokens: full.promptTokens, completionTokens: full.completionTokens,
            costUsd: costOf(remoteModel, full.promptTokens, full.completionTokens),
          };
          row.compressed = {
            ok: Boolean(comp2.parsed), validator: harnessValidator(comp2.parsed),
            promptTokens: comp2.promptTokens, completionTokens: comp2.completionTokens,
            costUsd: costOf(remoteModel, comp2.promptTokens, comp2.completionTokens),
          };
          row.remoteTokensSaved = full.promptTokens && comp2.promptTokens ? full.promptTokens - comp2.promptTokens : null;
          row.remoteCostSavedPct = full.promptTokens && comp2.promptTokens
            ? Number((100 * (1 - comp2.promptTokens / full.promptTokens)).toFixed(1)) : null;
          if (judge && full.content && comp2.content) {
            const jd = await judgePair({
              bridgeUrl, judgeModel,
              system: "You are an expert on self-improving coding agents. Judge which analyzer output is better given the same task.",
              question: "Criteria: (1) root-cause/factual correctness, (2) actionability of the result, (3) no loss of critical detail.",
              outputA: full.content, outputB: comp2.content,
            });
            row.judged = { winner: jd.winner, consistent: jd.consistent, reason: (jd.reason ?? "").slice(0, 200) };
          }
        } catch (err) {
          row.remoteError = String(err.message).slice(0, 200);
        }
      }
      rows.push(row);
    }
  } finally {
    await server.stop();
  }

  const judged = rows.filter((r) => r.judged);
  const summary = {
    experiment: "C4-compress",
    hypotheses: ["H19"],
    remoteModel, keepPct, noRemote,
    replays: rows.length,
    compressorOkRate: rows.filter((r) => r.compressorOk).length / (rows.length || 1),
    medianPayloadCutPct: medianOf(rows.map((r) => r.payloadCutPct)),
    validatorPassFull: noRemote ? null : rows.filter((r) => r.full?.validator).length / (rows.filter((r) => r.full).length || 1),
    validatorPassCompressed: noRemote ? null : rows.filter((r) => r.compressed?.validator).length / (rows.filter((r) => r.compressed).length || 1),
    medianRemoteCostSavedPct: noRemote ? null : medianOf(rows.map((r) => r.remoteCostSavedPct)),
    judge: judged.length ? {
      wins: judged.filter((r) => r.judged.winner === "B").length, // B = compressed
      losses: judged.filter((r) => r.judged.winner === "A").length, // A = full
      ties: judged.filter((r) => r.judged.winner === "tie" || r.judged.winner == null || r.judged.consistent === false).length,
      n: judged.length,
    } : null,
    compressor: {
      latency: medianOf(rows.map((r) => r.compressorLatencyMs)),
      tokens: medianOf(rows.map((r) => r.compressorTokens)),
    },
  };
  return { summary, rows };
}

function medianOf(xs) {
  const a = xs.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : null;
}

/** Minimal tierText port (same shape as local-llm experiments.mjs). */
function tierTextOf(memExport, tier) {
  const t = memExport?.tiers?.find((x) => x.tier === tier) ?? null;
  return t?.content ?? "";
}
