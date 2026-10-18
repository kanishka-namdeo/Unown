/**
 * bakeoff.mjs — C7 (H22): Qwen3.5-0.8B vs the incumbent Qwen3-0.6B lane,
 * plus the local-vision acceptance probe (mmproj).
 *
 * Arms:
 *  - probe per model: startup, RSS, gen tok/s, TTFT (streamed), json_schema
 *    sanity — the E0 instrument, same thresholds family.
 *  - triage replay per model (E1 lane): JSON validity + label agreement
 *    vs the incumbent; vs the remote model when the bridge is up.
 *  - vision probe (qwen3.5-0.8b + mmproj only): the vlm-smoke red-circle
 *    PNG through /v1/chat/completions image_url — answered + latency +
 *    $0 cost; remote comparison (qwen3.7-plus) when the bridge is up.
 */
import { loadNotes, triageMessages } from "../../local-llm/lib/prompts.mjs";
import { cfg } from "../../local-llm/lib/experiments.mjs";
import { extractJson } from "../../local-llm/lib/openai.mjs";
import {
  startLane, chatTimed, chatStreamed, EXT_MODELS, INCUMBENT, extMmprojPath,
} from "./lane.mjs";
import { LLAMA_BUILD } from "../../local-llm/lib/llama.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NO_THINKING = { chat_template_kwargs: { enable_thinking: false } };

const BAKEOFF_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["benchmark", "terminal", "other"] },
    outcome: { type: "string", enum: ["passed", "failed", "error"] },
    summary: { type: "string", maxLength: 400 },
  },
  required: ["kind", "outcome", "summary"],
};

/** 1x1 solid-red PNG (base64), byte-stable across platforms — the vlm-smoke probe image trick. */
function redPngBase64() {
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
}

/** Probe one model: E0-style metrics (uses the same thresholds family). */
async function probeModel({ model, ctx = 4096, extraArgs = [] }) {
  const server = await startLane({ model, ctx, extraArgs });
  try {
    const rssMB = await server.rssMB();
    // streamed TTFT + throughput probe
    const t = await chatStreamed({
      baseUrl: server.baseUrl, model: "probe",
      messages: [{ role: "user", content: "Count from 1 to 30, comma-separated, digits only." }],
      maxTokens: 120, temperature: 0, stream: true, extra: NO_THINKING,
    });
    // json_schema sanity
    const j = await chatTimed({
      baseUrl: server.baseUrl, model: "probe",
      messages: [{ role: "user", content: 'Return {"ok": true} as JSON.' }],
      maxTokens: 60, temperature: 0, jsonSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }, extra: NO_THINKING,
    });
    const jsonOk = (() => { try { return JSON.parse(j.content).ok === true; } catch { return false; } })();
    return {
      model, startupMs: server.startupMs, rssMB, ctx,
      genTokPerSec: t.usage?.completionTokens && t.latencyMs ? Number((t.usage.completionTokens / ((t.latencyMs - (t.ttftMs ?? 0)) / 1000)).toFixed(2)) : null,
      ttftMs: t.ttftMs, completionTokens: t.usage?.completionTokens, latencyMs: t.latencyMs,
      jsonSchemaOk: jsonOk, llamaBuild: LLAMA_BUILD,
    };
  } finally {
    await server.stop();
  }
}

/** Triage replay for one model; agreement vs the reference labels. */
async function triageLane({ model, notes, refLabels }) {
  const server = await startLane({ model, ctx: 4096 });
  try {
    const rows = [];
    for (const [i, note] of notes.entries()) {
      const out = await chatTimed({
        baseUrl: server.baseUrl, model: "triage",
        messages: triageMessages(note), maxTokens: 200, temperature: 0, extra: NO_THINKING,
      });
      const parsed = extractJson(out.content);
      const val = parsed.ok ? parsed.value : null;
      rows.push({
        noteId: note.id ?? i,
        jsonOk: parsed.ok,
        kind: val?.kind ?? null, outcome: val?.outcome ?? null,
        latencyMs: out.latencyMs,
        tokPerSec: out.timings?.predictedPerSecond ?? null,
      });
    }
    const jsonOkRate = rows.filter((r) => r.jsonOk).length / (rows.length || 1);
    const agree = rows.filter((r) => refLabels.get(r.noteId) && r.kind === refLabels.get(r.noteId).kind && r.outcome === refLabels.get(r.noteId).outcome).length;
    return {
      rows,
      summary: {
        model, n: rows.length,
        jsonOkRate,
        agreementWithRef: agree / (rows.filter((r) => refLabels.has(r.noteId)).length || 1),
        latency: rows.map((r) => r.latencyMs).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? null,
      },
    };
  } finally {
    await server.stop();
  }
}

/** Vision acceptance probe: local mmproj lane answers the red-circle question. */
async function visionProbe({ model = "qwen3.5-0.8b", noRemote = false }) {
  const { bridgeUrl } = cfg();
  const b64 = redPng();
  const ask = {
    model: "vlm",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "What is the dominant color of this image? Answer with one word." },
        { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
      ],
    }],
    max_tokens: 30,
    temperature: 0,
  };
  const local = await startLane({ model, ctx: 4096, extraArgs: ["--mmproj", extMmprojPath(model)] });
  try {
    const t0 = Date.now();
    const res = await fetch(`${local.baseUrl}/v1/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ask), signal: AbortSignal.timeout(240_000),
    });
    const text = await res.text();
    const j = res.ok ? JSON.parse(text) : null;
    const answer = j?.choices?.[0]?.message?.content ?? "";
    const ok = /red/i.test(answer);
    let remote = null;
    if (!noRemote) {
      try {
        const t1 = Date.now();
        const rres = await fetch(`${bridgeUrl}/v1/chat/completions`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...ask, model: "qwen3.7-plus" }),
          signal: AbortSignal.timeout(240_000),
        });
        const rj = rres.ok ? await rres.json() : null;
        const rans = rj?.choices?.[0]?.message?.content ?? "";
        remote = { ok: /red/i.test(rans), answer: rans.slice(0, 60), latencyMs: Date.now() - t1, model: "qwen3.7-plus (remote vision)" };
      } catch (err) {
        remote = { error: String(err.message).slice(0, 120) };
      }
    }
    return {
      local: {
        model, mmproj: path.basename(extMmprojPath(model)),
        boots: res.ok, answeredColor: ok, answer: answer.slice(0, 60),
        latencyMs: Date.now() - t0, costUsd: 0,
        promptTokens: j?.usage?.prompt_tokens ?? null,
      },
      remote,
    };
  } finally {
    await local.stop();
  }
}

function redPng() {
  return redPngBase64();
}

/** C7 — full bake-off. */
export async function c7Bakeoff({ noteLimit = 12, noRemote = false, vision = true } = {}) {
  const { bridgeUrl, remoteModel } = cfg();
  const notes = loadNotes().slice(0, noteLimit);
  const out = { experiment: "C7-bakeoff", hypotheses: ["H22"], llamaBuild: LLAMA_BUILD };

  // 1) probes
  out.probes = [
    await probeModel({ model: INCUMBENT }),
    await probeModel({ model: "qwen3.5-0.8b" }),
  ];

  // 2) triage: incumbent = reference labels (E1-verified 100% agreement with
  // the remote on this lane), then candidate vs incumbent
  const incumbent = await triageLane({ model: INCUMBENT, notes, refLabels: new Map() });
  const ref = new Map(incumbent.rows.map((r) => [r.noteId, { kind: r.kind, outcome: r.outcome }]).filter(([, v]) => v.kind));
  const candidate = await triageLane({ model: "qwen3.5-0.8b", notes, refLabels: ref });
  out.triage = {
    incumbent: incumbent.summary,
    candidate: candidate.summary,
    incumbentRows: incumbent.rows,
    candidateRows: candidate.rows,
  };

  // remote reference when the bridge is up
  if (!noRemote) {
    try {
      const remoteRows = [];
      for (const [i, note] of notes.entries()) {
        const res = await fetch(`${bridgeUrl}/v1/chat/completions`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: remoteModel, messages: triageMessages(note), max_tokens: 200, temperature: 0.1, stream: false }),
          signal: AbortSignal.timeout(240_000),
        });
        const j = await res.json();
        const parsed = extractJson(j.choices?.[0]?.message?.content ?? "");
        remoteRows.push({ noteId: note.id ?? i, jsonOk: parsed.ok, kind: parsed.value?.kind ?? null, outcome: parsed.value?.outcome ?? null, latencyMs: null });
      }
      const agreeInc = incumbent.rows.filter((r) => {
        const rr = remoteRows.find((x) => x.noteId === r.noteId);
        return rr && rr.kind && rr.kind === r.kind && rr.outcome === r.outcome;
      }).length;
      const agreeCand = candidate.rows.filter((r) => {
        const rr = remoteRows.find((x) => x.noteId === r.noteId);
        return rr && rr.kind && rr.kind === r.kind && rr.outcome === r.outcome;
      }).length;
      out.triage.remote = {
        model: remoteModel, n: remoteRows.length,
        incumbentAgreement: agreeInc / (remoteRows.length || 1),
        candidateAgreement: agreeCand / (remoteRows.length || 1),
      };
    } catch (err) {
      out.triage.remote = { error: String(err.message).slice(0, 160) };
    }
  }

  // 3) vision acceptance probe
  if (vision) {
    try {
      out.vision = await visionProbe({ model: "qwen3.5-0.8b", noRemote });
    } catch (err) {
      out.vision = { error: String(err.message).slice(0, 400) };
    }
  }
  return out;
}
