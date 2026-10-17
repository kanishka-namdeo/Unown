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
 * This file is the thin SERVING layer: routing, request shaping, tool-call
 * sanitization, SSE stats folding and retry/backoff math live in ./pure.ts
 * (unit-tested by ./pure.test.ts). Environment parsing goes through
 * loadConfig(env) so tests can construct configs without process.env.
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

import {
        loadConfig,
        upstreamTimeoutMs,
        routeModel,
        buildUpstreamBody,
        completionStats,
        foldSseLine,
        isRetryableError,
        backoffDelayMs,
        spacingWaitMs,
        MAX_ATTEMPTS,
        type BridgeLogEntry,
        type SseStats,
} from "./pure";

const {
        port: PORT,
        apiKey: BRIDGE_API_KEY,
        defaultModel: DEFAULT_MODEL,
        upstreamUrl: UPSTREAM_URL,
        upstreamKey: UPSTREAM_KEY,
        routeDefault: ROUTE_DEFAULT,
        knownModels: KNOWN_MODELS,
        qwenThinking: QWEN_THINKING,
        minSpacingMs: MIN_SPACING_MS,
} = loadConfig();

// ---------------------------------------------------------------------------
// Request log ring buffer (for the dashboard)
// ---------------------------------------------------------------------------
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
                const wait = spacingWaitMs(lastRequestAt, Date.now(), MIN_SPACING_MS);
                if (wait > 0) await Bun.sleep(wait);
                lastRequestAt = Date.now();
        });
        chain = run.then(
                () => {},
                () => {},
        );
        await run;
}

/**
 * One upstream attempt. Returns the raw Response (stream or JSON).
 * Time-to-HEADERS is capped (BRIDGE_UPSTREAM_TIMEOUT_MS, default 180s): a
 * stalled upstream can no longer wedge requests forever, while streaming
 * bodies remain uncapped once headers have arrived.
 */
async function upstreamFetch(body: any, signal?: AbortSignal): Promise<Response> {
        const timeoutMs = upstreamTimeoutMs();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(new Error(`upstream timeout: no response headers after ${timeoutMs}ms`)), timeoutMs);
        const onOuterAbort = () => ctrl.abort(signal?.reason);
        signal?.addEventListener("abort", onOuterAbort, { once: true });
        try {
                const res = await fetch(`${UPSTREAM_URL}/chat/completions`, {
                        method: "POST",
                        headers: {
                                "Content-Type": "application/json",
                                ...(UPSTREAM_KEY ? { Authorization: `Bearer ${UPSTREAM_KEY}` } : {}),
                        },
                        body: JSON.stringify(body),
                        signal: ctrl.signal,
                });
                clearTimeout(timer); // headers arrived — the body may stream as long as it needs
                if (!res.ok) {
                        const text = await res.text().catch(() => "");
                        throw Object.assign(new Error(`upstream ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
                }
                return res;
        } finally {
                clearTimeout(timer);
                signal?.removeEventListener("abort", onOuterAbort);
        }
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
                        if (!isRetryableError(err) || attempt === MAX_ATTEMPTS) throw err;
                        const backoff = backoffDelayMs(attempt);
                        console.log(`[llm-bridge] retryable error (attempt ${attempt}/${MAX_ATTEMPTS}), backing off ${Math.round(backoff)}ms: ${msg.slice(0, 120)}`);
                        await Bun.sleep(backoff);
                        lastRequestAt = Date.now();
                }
        }
        throw lastError;
}

// ---------------------------------------------------------------------------
// SSE pipe: forward upstream SSE frames to the client verbatim.
// Dashscope emits OpenAI-style `data: {...}` chunks + a final `data: [DONE]`
// (including a usage chunk when stream_options.include_usage is set), so a
// verbatim pipe keeps pi's streaming parser happy. While forwarding, we peek
// at finish_reason / usage / tool-call deltas (pure.ts foldSseLine) so the
// request log stays accurate for streamed requests too.
// ---------------------------------------------------------------------------
function pipeSse(res: Response, entry: BridgeLogEntry, onDone: () => void): Response {
        const decoder = new TextDecoder();
        let buffer = "";
        // Stats accumulator, folded per frame by pure.ts foldSseLine. The
        // entry's finishReason / toolCalls / token counts update live as frames
        // flow (so /v1/log shows progress mid-stream); contentChars lands on
        // the entry only once the stream completes, matching the original
        // inline loop.
        const stats: SseStats = {
                finishReason: entry.finishReason,
                contentChars: 0,
                toolCalls: entry.toolCalls,
                promptTokens: entry.promptTokens,
                completionTokens: entry.completionTokens,
        };
        // The reader locks res.body for the forwarding loop; cancel() below must
        // go through it (res.body.cancel() on a locked stream rejects asynchronously
        // — an unhandled rejection that crashed stream teardown under load).
        let reader: any;
        const stream = new ReadableStream({
                async start(controller) {
                        try {
                                // @ts-ignore - Bun exposes the response body stream
                                reader = res.body.getReader();
                                for (;;) {
                                        const { done, value } = await reader.read();
                                        if (done) break;
                                        // peek into the frame stream for log stats
                                        buffer += decoder.decode(value, { stream: true });
                                        let nl: number;
                                        while ((nl = buffer.indexOf("\n")) !== -1) {
                                                const line = buffer.slice(0, nl).trim();
                                                buffer = buffer.slice(nl + 1);
                                                foldSseLine(line, stats);
                                                entry.finishReason = stats.finishReason;
                                                entry.toolCalls = stats.toolCalls;
                                                entry.promptTokens = stats.promptTokens;
                                                entry.completionTokens = stats.completionTokens;
                                        }
                                        controller.enqueue(value);
                                }
                        } catch (err: any) {
                                // Client disconnect or upstream reset mid-stream:
                                // close cleanly rather than surface a broken stream.
                                console.log(`[llm-bridge] stream ended early: ${String(err?.message ?? err).slice(0, 120)}`);
                        } finally {
                                entry.contentChars = stats.contentChars;
                                try {
                                        controller.close();
                                } catch {
                                        /* already closed */
                                }
                                onDone();
                        }
                },
                cancel() {
                        // Client went away mid-stream: stop the upstream transfer.
                        // reader.cancel() resolves the pending read() with done and
                        // releases the upstream body; never let its rejection escape
                        // (unhandled rejections took the stream machinery down).
                        try {
                                reader?.cancel()?.catch(() => {});
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
                                upstreamKeyIsSet: Boolean(UPSTREAM_KEY),
                                authRequired: Boolean(BRIDGE_API_KEY),
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
                                const { upstream, requested } = routeModel(body.model, KNOWN_MODELS, ROUTE_DEFAULT, DEFAULT_MODEL);
                                entry.stream = wantsStream;
                                entry.model = requested;
                                entry.upstreamModel = upstream;
                                entry.messages = Array.isArray(body.messages) ? body.messages.length : 0;
                                entry.tools = Array.isArray(body.tools) ? body.tools.length : 0;

                                const upstreamBody = buildUpstreamBody(body, upstream, QWEN_THINKING);
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
