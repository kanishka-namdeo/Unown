/**
 * llm-bridge — OpenAI-compatible gateway over a remote OpenAI-compatible
 * upstream (Dashscope coding plan endpoint).
 *
 * Lets the pi coding agent (and the self-learning layer) use any remote
 * OpenAI-compatible endpoint through a standard `openai-completions` provider
 * config: baseUrl: http://127.0.0.1:3031/v1
 *
 * Responsibilities:
 *   - injects upstream authentication (BRIDGE_UPSTREAM_KEY)
 *   - routes any requested model onto the configured model allow-list
 *     (unknown / legacy model ids are mapped to BRIDGE_ROUTE_DEFAULT)
 *   - translates the z-ai style `thinking` param into Dashscope's
 *     `enable_thinking` flag (qwen thinking models)
 *   - passes messages through verbatim — including tool-role messages and
 *     image_url content parts, so tool calling AND vision (VLM) work natively
 *   - true SSE streaming passthrough (the upstream supports native streaming)
 *   - request serialization + spacing + 429/5xx backoff retries
 *   - request log ring buffer + health endpoint for the dashboard
 *
 * Environment:
 *   BRIDGE_PORT            listen port (3031)
 *   BRIDGE_MODEL           advertised default model (kimi-k2.5)
 *   BRIDGE_UPSTREAM_URL    upstream base url, no trailing slash
 *                           (https://coding-intl.dashscope.aliyuncs.com/v1)
 *   BRIDGE_UPSTREAM_KEY    upstream bearer key
 *   BRIDGE_ROUTE_DEFAULT   model used when a request names an unknown model
 *   BRIDGE_KNOWN_MODELS    comma-separated passthrough allow-list
 *   BRIDGE_QWEN_THINKING   1 = leave qwen thinking models in thinking mode
 *                          (default: disable thinking for snappy agent turns)
 *   BRIDGE_API_KEY         optional local shared secret for this bridge
 *   BRIDGE_MIN_SPACING_MS  min ms between upstream requests (default 400)
 */

const PORT = Number(process.env.BRIDGE_PORT ?? 3031);
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY ?? "";
const DEFAULT_MODEL = process.env.BRIDGE_MODEL ?? "kimi-k2.5";

const UPSTREAM_URL = (process.env.BRIDGE_UPSTREAM_URL ?? "https://coding-intl.dashscope.aliyuncs.com/v1").replace(/\/+$/, "");
const UPSTREAM_KEY = process.env.BRIDGE_UPSTREAM_KEY ?? "";
const ROUTE_DEFAULT = process.env.BRIDGE_ROUTE_DEFAULT ?? DEFAULT_MODEL;
const KNOWN_MODELS = (process.env.BRIDGE_KNOWN_MODELS ?? "kimi-k2.5,qwen3.7-plus,qwen3.6-plus")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
const QWEN_THINKING = /^(1|true|yes)$/i.test(process.env.BRIDGE_QWEN_THINKING ?? "");
const MIN_SPACING_MS = Number(process.env.BRIDGE_MIN_SPACING_MS ?? 400);

// ---------------------------------------------------------------------------
// Types (OpenAI wire format subset we need)
// ---------------------------------------------------------------------------
interface OaiToolCall {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
        index?: number;
}
interface OaiMessage {
        role: "system" | "user" | "assistant" | "tool";
        content: unknown;
        tool_calls?: OaiToolCall[];
        tool_call_id?: string;
        name?: string;
}

// ---------------------------------------------------------------------------
// Request log ring buffer (for the dashboard)
// ---------------------------------------------------------------------------
interface BridgeLogEntry {
        ts: number;
        model: string;
        upstreamModel: string;
        stream: boolean;
        messages: number;
        tools: number;
        finishReason: string | null;
        contentChars: number;
        toolCalls: number;
        promptTokens: number;
        completionTokens: number;
        durationMs: number;
        error?: string;
}
const log: BridgeLogEntry[] = [];
let totalRequests = 0;
let totalErrors = 0;
let upstreamHealthy: boolean | null = null;

// ---------------------------------------------------------------------------
// Rate-limit protection: serialize upstream calls with spacing + retry on 429.
// ---------------------------------------------------------------------------
let chain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

async function acquireSlot() {
        const run = chain.then(async () => {
                const wait = Math.max(0, lastRequestAt + MIN_SPACING_MS - Date.now());
                if (wait > 0) await Bun.sleep(wait);
                lastRequestAt = Date.now();
        });
        chain = run.then(
                () => {},
                () => {},
        );
        await run;
}

const MAX_ATTEMPTS = 6;

/** One upstream attempt. Returns the raw Response (stream or JSON). */
async function upstreamFetch(body: any, signal?: AbortSignal): Promise<Response> {
        const res = await fetch(`${UPSTREAM_URL}/chat/completions`, {
                method: "POST",
                headers: {
                        "Content-Type": "application/json",
                        ...(UPSTREAM_KEY ? { Authorization: `Bearer ${UPSTREAM_KEY}` } : {}),
                },
                body: JSON.stringify(body),
                signal,
        });
        if (!res.ok) {
                const text = await res.text().catch(() => "");
                throw Object.assign(new Error(`upstream ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
        }
        return res;
}

/** Upstream call with serialized spacing + retry on 429/5xx/network. */
async function callUpstream(body: any): Promise<Response> {
        await acquireSlot();
        let lastError: any;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                try {
                        return await upstreamFetch(body);
                } catch (err: any) {
                        lastError = err;
                        const msg = String(err?.message ?? err);
                        const status = err?.status;
                        const retryable =
                                status === 429 ||
                                (typeof status === "number" && status >= 500) ||
                                /429|too many requests|rate limit|network|socket|ECONN|fetch failed|timeout|terminated/i.test(msg);
                        if (!retryable || attempt === MAX_ATTEMPTS) throw err;
                        const backoff = Math.min(3000 * 2 ** (attempt - 1), 45000) + Math.random() * 1500;
                        console.log(`[llm-bridge] retryable error (attempt ${attempt}/${MAX_ATTEMPTS}), backing off ${Math.round(backoff)}ms: ${msg.slice(0, 120)}`);
                        await Bun.sleep(backoff);
                        lastRequestAt = Date.now();
                }
        }
        throw lastError;
}

// ---------------------------------------------------------------------------
// Model routing + request shaping
// ---------------------------------------------------------------------------
function routeModel(requested: unknown): { upstream: string; requested: string } {
        const asked = typeof requested === "string" && requested.trim() ? requested.trim() : DEFAULT_MODEL;
        const upstream = KNOWN_MODELS.includes(asked) ? asked : ROUTE_DEFAULT;
        return { upstream, requested: asked };
}

/**
 * Build the upstream request body.
 *
 * - messages / tools / tool_choice / stream / stream_options / sampling
 *   params pass through verbatim (tool-role messages and image_url content
 *   parts included — the upstream is fully OpenAI-compatible).
 * - the z-ai style `thinking: { type: ... }` param is translated away.
 * - qwen thinking models get `enable_thinking` (default: disabled, so agent
 *   turns stay fast; set BRIDGE_QWEN_THINKING=1 to keep deep reasoning).
 */
function buildUpstreamBody(body: any, upstreamModel: string): any {
        const out: any = {
                model: upstreamModel,
                messages: body.messages ?? [],
        };
        if (Array.isArray(body.tools) && body.tools.length > 0) out.tools = body.tools;
        if (body.tool_choice !== undefined) out.tool_choice = body.tool_choice;
        if (body.stream !== undefined) out.stream = body.stream;
        if (body.stream_options !== undefined) out.stream_options = body.stream_options;
        const maxTokens = body.max_tokens ?? body.max_completion_tokens;
        if (maxTokens !== undefined) out.max_tokens = maxTokens;
        for (const k of ["temperature", "top_p", "stop", "presence_penalty", "frequency_penalty", "response_format", "parallel_tool_calls", "seed", "user", "n"]) {
                if (body[k] !== undefined) out[k] = body[k];
        }

        // thinking-mode resolution:
        //   explicit client `enable_thinking` wins; then the z-ai style
        //   `thinking` translation; then per-model defaults.
        let enableThinking: boolean | undefined = body.enable_thinking;
        if (body.thinking?.type === "disabled") enableThinking = false;
        else if (body.thinking?.type === "enabled") enableThinking = true;
        if (enableThinking === undefined && /^qwen/i.test(upstreamModel)) {
                enableThinking = QWEN_THINKING;
        }
        if (enableThinking !== undefined && /^qwen/i.test(upstreamModel)) {
                out.enable_thinking = enableThinking;
        }
        return out;
}

/**
 * Defensive unwrapping of double-wrapped tool calls: some models occasionally
 * emit arguments like {"name":"read","arguments":{...}} (imitating the wire
 * format). Unwrap to the inner arguments object.
 */
function sanitizeToolCalls(toolCalls: any[] | undefined): any[] | undefined {
        if (!Array.isArray(toolCalls)) return undefined;
        const fixed = toolCalls.map((tc, i) => {
                let args = tc?.function?.arguments;
                if (typeof args === "string") {
                        try {
                                const parsed = JSON.parse(args);
                                if (parsed && typeof parsed === "object" && typeof parsed.name === "string" && parsed.arguments && typeof parsed.arguments === "object") {
                                        args = JSON.stringify(parsed.arguments);
                                }
                        } catch {
                                /* partial JSON — leave as-is */
                        }
                }
                return {
                        id: tc?.id ?? `call_${i}`,
                        type: "function" as const,
                        function: { name: tc?.function?.name ?? "", arguments: args ?? "{}" },
                };
        });
        return fixed;
}

// ---------------------------------------------------------------------------
// SSE pipe: forward upstream SSE frames to the client verbatim.
// Dashscope emits OpenAI-style `data: {...}` chunks + a final `data: [DONE]`
// (including a usage chunk when stream_options.include_usage is set), so a
// verbatim pipe keeps pi's streaming parser happy. While forwarding, we peek
// at finish_reason / usage / tool-call deltas so the request log stays
// accurate for streamed requests too.
// ---------------------------------------------------------------------------
function pipeSse(res: Response, entry: BridgeLogEntry, onDone: () => void): Response {
        const decoder = new TextDecoder();
        let buffer = "";
        let contentChars = 0;
        const stream = new ReadableStream({
                async start(controller) {
                        try {
                                // @ts-ignore - Bun exposes the response body stream
                                const reader = res.body.getReader();
                                for (;;) {
                                        const { done, value } = await reader.read();
                                        if (done) break;
                                        // peek into the frame stream for log stats
                                        buffer += decoder.decode(value, { stream: true });
                                        let nl: number;
                                        while ((nl = buffer.indexOf("\n")) !== -1) {
                                                const line = buffer.slice(0, nl).trim();
                                                buffer = buffer.slice(nl + 1);
                                                if (!line.startsWith("data:")) continue;
                                                const payload = line.slice(5).trim();
                                                if (payload === "[DONE]") continue;
                                                try {
                                                        const obj = JSON.parse(payload);
                                                        const choice = obj?.choices?.[0];
                                                        if (choice?.finish_reason) entry.finishReason = choice.finish_reason;
                                                        const delta = choice?.delta;
                                                        if (typeof delta?.content === "string") contentChars += delta.content.length;
                                                        if (Array.isArray(delta?.tool_calls)) entry.toolCalls = Math.max(entry.toolCalls, delta.tool_calls.length);
                                                        if (obj?.usage) {
                                                                entry.promptTokens = obj.usage.prompt_tokens ?? entry.promptTokens;
                                                                entry.completionTokens = obj.usage.completion_tokens ?? entry.completionTokens;
                                                        }
                                                } catch {
                                                        /* partial JSON frame — ignore */
                                                }
                                        }
                                        controller.enqueue(value);
                                }
                        } catch (err: any) {
                                // Client disconnect or upstream reset mid-stream:
                                // close cleanly rather than surface a broken stream.
                                console.log(`[llm-bridge] stream ended early: ${String(err?.message ?? err).slice(0, 120)}`);
                        } finally {
                                entry.contentChars = contentChars;
                                try {
                                        controller.close();
                                } catch {
                                        /* already closed */
                                }
                                onDone();
                        }
                },
                cancel() {
                        // best-effort abort of the upstream body
                        try {
                                // @ts-ignore
                                res.body?.cancel();
                        } catch {
                                /* ignore */
                        }
                        onDone();
                },
        });
        return new Response(stream, {
                headers: {
                        "Content-Type": "text/event-stream",
                        "Cache-Control": "no-cache",
                        Connection: "keep-alive",
                },
        });
}

// Extract summary stats from a non-stream completion for the log entry.
function completionStats(completion: any) {
        const choice = completion?.choices?.[0] ?? {};
        const message = choice.message ?? {};
        if (Array.isArray(message.tool_calls)) {
                message.tool_calls = sanitizeToolCalls(message.tool_calls);
        }
        return {
                finishReason: choice.finish_reason ?? null,
                contentChars: typeof message.content === "string" ? message.content.length : 0,
                toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls.length : 0,
                promptTokens: completion?.usage?.prompt_tokens ?? 0,
                completionTokens: completion?.usage?.completion_tokens ?? 0,
        };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = Bun.serve({
        port: PORT,
        idleTimeout: 255, // LLM calls are slow; keep connections open (max 255s)
        async fetch(req) {
                const url = new URL(req.url);

                if (BRIDGE_API_KEY) {
                        const auth = req.headers.get("authorization") ?? "";
                        if (auth !== `Bearer ${BRIDGE_API_KEY}`) {
                                return Response.json(
                                        { error: { message: "unauthorized: missing or invalid bearer token (BRIDGE_API_KEY is set)", type: "bridge_auth", code: 401 } },
                                        { status: 401 },
                                );
                        }
                }

                if (req.method === "GET" && url.pathname === "/v1/models") {
                        return Response.json({
                                object: "list",
                                data: KNOWN_MODELS.map((id) => ({
                                        id,
                                        object: "model",
                                        created: Math.floor(Date.now() / 1000),
                                        owned_by: "llm-bridge",
                                })),
                        });
                }

                if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
                        // Light upstream probe: cached result, refreshed at most every 30s.
                        let upstream: any = { ok: upstreamHealthy };
                        try {
                                const res = await fetch(`${UPSTREAM_URL}/models`, {
                                        headers: UPSTREAM_KEY ? { Authorization: `Bearer ${UPSTREAM_KEY}` } : {},
                                        signal: AbortSignal.timeout(8000),
                                });
                                upstreamHealthy = res.ok;
                                upstream = { ok: res.ok, status: res.status };
                        } catch {
                                upstreamHealthy = false;
                                upstream = { ok: false };
                        }
                        return Response.json({
                                ok: true,
                                port: PORT,
                                requests: totalRequests,
                                errors: totalErrors,
                                upstream,
                                upstreamUrl: UPSTREAM_URL,
                                defaultModel: ROUTE_DEFAULT,
                                models: KNOWN_MODELS,
                        });
                }

                if (req.method === "GET" && url.pathname === "/v1/log") {
                        return Response.json({ log: log.slice(-200), requests: totalRequests, errors: totalErrors });
                }

                if (req.method === "POST" && (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")) {
                        totalRequests++;
                        const started = Date.now();
                        let entry: BridgeLogEntry = {
                                ts: started,
                                model: "?",
                                upstreamModel: "?",
                                stream: false,
                                messages: 0,
                                tools: 0,
                                finishReason: null,
                                contentChars: 0,
                                toolCalls: 0,
                                promptTokens: 0,
                                completionTokens: 0,
                                durationMs: 0,
                        };
                        const pushLog = () => {
                                entry.durationMs = Date.now() - started;
                                log.push(entry);
                                if (log.length > 500) log.shift();
                        };
                        try {
                                const body = await req.json();
                                const wantsStream = body.stream === true;
                                const { upstream, requested } = routeModel(body.model);
                                entry.stream = wantsStream;
                                entry.model = requested;
                                entry.upstreamModel = upstream;
                                entry.messages = Array.isArray(body.messages) ? body.messages.length : 0;
                                entry.tools = Array.isArray(body.tools) ? body.tools.length : 0;

                                const upstreamBody = buildUpstreamBody(body, upstream);
                                const res = await callUpstream(upstreamBody);

                                if (wantsStream) {
                                        // True SSE passthrough. Push the log entry at stream
                                        // open, then let the pipe fill in finish_reason /
                                        // usage / content stats as frames flow through.
                                        pushLog();
                                        let settled = false;
                                        const settle = () => {
                                                if (settled) return;
                                                settled = true;
                                                entry.durationMs = Date.now() - started;
                                        };
                                        return pipeSse(res, entry, settle);
                                }

                                const completion = await res.json();
                                Object.assign(entry, completionStats(completion));
                                pushLog();
                                return Response.json(completion);
                        } catch (err: any) {
                                totalErrors++;
                                entry.error = err?.message ?? String(err);
                                pushLog();
                                const status = err?.status ?? (/api key|auth|401|403/i.test(String(entry.error)) ? 401 : 500);
                                return Response.json(
                                        { error: { message: `llm-bridge: ${entry.error}`, type: "bridge_error", code: status } },
                                        { status: typeof status === "number" && status >= 400 && status <= 599 ? status : 500 },
                                );
                        }
                }

                return Response.json({ error: { message: `Not found: ${req.method} ${url.pathname}` } }, { status: 404 });
        },
});

if (!UPSTREAM_KEY) {
        console.warn("[llm-bridge] WARNING: BRIDGE_UPSTREAM_KEY is not set — upstream requests will be unauthenticated.");
}
console.log(
        `[llm-bridge] listening on http://127.0.0.1:${server.port} (OpenAI-compatible, proxying ${UPSTREAM_URL}; models: ${KNOWN_MODELS.join(", ")}; route default: ${ROUTE_DEFAULT})`,
);
