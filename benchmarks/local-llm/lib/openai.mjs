/**
 * openai.mjs — minimal OpenAI-compatible chat/embeddings client with timing,
 * for both the local llama-server and the Unown llm-bridge (remote models).
 */
import { performance } from "node:perf_hooks";

/**
 * One chat completion. Returns:
 * { ok, content, reasoning, usage:{promptTokens,completionTokens}, latencyMs,
 *   ttftMs, retries, error }
 * - ttftMs requires stream:true (measures first content chunk).
 * - jsonSchema: sets response_format {type:"json_schema", json_schema:{schema}}.
 *   llama-server enforces grammar-constrained decoding with it.
 */
export async function chat({ baseUrl, model, messages, maxTokens = 1500, temperature, jsonSchema, stream = true, timeoutMs = 300_000, apiKey, retries = 1, extra, signal: outerSignal }) {
  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    stream,
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "out", schema: jsonSchema, strict: true },
    };
  }
  if (extra) Object.assign(body, extra); // e.g. {chat_template_kwargs:{enable_thinking:false}} for local llama-server
  if (stream) body.stream_options = { include_usage: true }; // usage in the final chunk (OpenAI-compat; llama-server supports it)
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    outerSignal?.addEventListener("abort", () => ctrl.abort(), { once: true });
    const t0 = performance.now();
    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      }

      if (!stream) {
        const j = await res.json();
        const msg = j.choices?.[0]?.message ?? {};
        return {
          ok: true,
          content: typeof msg.content === "string" ? msg.content : "",
          reasoning: typeof msg.reasoning_content === "string" ? msg.reasoning_content : "",
          usage: {
            promptTokens: j.usage?.prompt_tokens ?? null,
            completionTokens: j.usage?.completion_tokens ?? null,
          },
          latencyMs: Math.round(performance.now() - t0),
          ttftMs: null,
          retries: attempt,
        };
      }

      // streaming: capture TTFT + full text
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let content = "";
      let reasoning = "";
      let usage = null;
      let ttft = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const j = JSON.parse(data);
            const d = j.choices?.[0]?.delta ?? {};
            if ((d.content ?? "") !== "") {
              if (ttft === null) ttft = Math.round(performance.now() - t0);
              content += d.content;
            }
            if (typeof d.reasoning_content === "string" && d.reasoning_content) {
              if (ttft === null) ttft = Math.round(performance.now() - t0); // thinking models: first reasoning token is the TTFT
              reasoning += d.reasoning_content;
            }
            if (j.usage) usage = { promptTokens: j.usage.prompt_tokens ?? null, completionTokens: j.usage.completion_tokens ?? null };
          } catch { /* partial line */ }
        }
      }
      return {
        ok: true,
        content,
        reasoning,
        usage: usage ?? { promptTokens: null, completionTokens: null },
        latencyMs: Math.round(performance.now() - t0),
        ttftMs: ttft,
        // fall back to counting streamed text when usage is absent
        approxTokens: content ? Math.max(1, Math.round(content.length / 4)) : null,
        retries: attempt,
      };
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message ?? err);
      if (/abort/i.test(msg) || attempt >= retries || !/network|socket|ECONN|fetch failed|HTTP 5/i.test(msg)) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: String(lastErr?.message ?? lastErr), retries, latencyMs: null, content: "", usage: {} };
}

/** Embeddings via /v1/embeddings. */
export async function embed({ baseUrl, model, input, apiKey, timeoutMs = 60_000 }) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const t0 = performance.now();
  try {
    const res = await fetch(`${baseUrl}/v1/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const j = await res.json();
    const vec = j.data?.[0]?.embedding;
    if (!Array.isArray(vec)) throw new Error("no embedding in response");
    return { ok: true, vec, dim: vec.length, latencyMs: Math.round(performance.now() - t0), usage: j.usage ?? null };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err), latencyMs: Math.round(performance.now() - t0), vec: null };
  }
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ---------------------------------------------------------------- json utils

/** Port of Unown's llm.ts extractJson: fenced-json first, then first balanced {...}. */
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = fenced ? [fenced[1], text] : [text];
  let parseError;
  for (const candidate of candidates) {
    const span = firstBalancedObject(candidate);
    if (span === null) continue;
    try { return { ok: true, value: JSON.parse(span) }; } catch (err) { parseError = err; }
  }
  return { ok: false, error: parseError ? String(parseError) : "no JSON object found" };
}

function firstBalancedObject(text) {
  let start = -1, depth = 0, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}" && depth > 0 && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}
