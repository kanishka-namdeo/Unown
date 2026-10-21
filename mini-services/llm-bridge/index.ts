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
 *   - persistent usage & cost tracking: every proxied completion is
 *     appended to <state dir>/usage-log.jsonl (see ./usage.ts) and served
 *     back as aggregates on GET /v1/usage?days=N&model=M
 *
 * This file is the thin SERVING layer: routing, request shaping, tool-call
 * sanitization, SSE stats folding and retry/backoff math live in ./pure.ts
 * (unit-tested by ./pure.test.ts). Usage persistence, pricing and
 * aggregation live in ./usage.ts (unit-tested by ./usage.test.ts).
 * Environment parsing goes through loadConfig(env) so tests can construct
 * configs without process.env.
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
 *   BRIDGE_LOCAL_URL       optional second upstream: a LOCAL OpenAI-compatible
 *                          server (llama.cpp llama-server, Ollama, LM Studio…)
 *                          e.g. http://127.0.0.1:8080/v1 — enables the local lane
 *   BRIDGE_LOCAL_KEY       optional bearer key for the local upstream
 *                          (llama.cpp runs keyless — leave empty)
 *   BRIDGE_LOCAL_MODELS    comma-separated local model ids; empty = any id
 *                          with the `local-` prefix routes locally
 *   BRIDGE_FALLBACK_URL    optional FAILOVER upstream: a second REMOTE
 *                          OpenAI-compatible endpoint (e.g. Agnes AI
 *                          https://apihub.agnes-ai.com/v1). When the PRIMARY
 *                          upstream cannot serve a request — 429/quota
 *                          throttle, 401/403 rejected key, 5xx, network
 *                          failure — the request is retried once against
 *                          this endpoint instead of surfacing the error.
 *                          Empty/unset = failover off (default).
 *   BRIDGE_FALLBACK_KEY    bearer key for the fallback upstream
 *   BRIDGE_FALLBACK_MODEL  model id failed-over requests are rewritten onto
 *                          (e.g. agnes-3.0-flash); empty = keep the routed
 *                          model id (for fallbacks serving the same catalog)
 *   UNOWN_BRIDGE_STATE_DIR where usage-log.jsonl lives (default: <repo>/.run
 *                          when running from the repo, else ~/.unown/bridge)
 *   UNOWN_PRICE_<MODEL>_IN/OUT  USD per 1M tokens, overrides the built-in
 *                          ESTIMATE pricing table (see ./usage.ts)
 */

import { join } from "node:path";

import {
        loadConfig,
        upstreamTimeoutMs,
        routeRequest,
        buildUpstreamBody,
        withLocalThinkingCompat,
        completionStats,
        foldSseLine,
        isRetryableError,
        isFailoverError,
        backoffDelayMs,
        spacingWaitMs,
        coherentKnownModels,
        parseModelCatalog,
        mergeCatalogIntoKnown,
        MAX_ATTEMPTS,
        type BridgeLogEntry,
        type SseStats,
} from "./pure";
import {
        appendUsageRecord,
        buildUsageSummary,
        resolveUsageStateDir,
        USAGE_LOG_FILE_NAME,
        type UsageRecord,
} from "./usage";

const {
        port: PORT,
        apiKey: BRIDGE_API_KEY,
        defaultModel: DEFAULT_MODEL,
        upstreamUrl: UPSTREAM_URL,
        upstreamKey: UPSTREAM_KEY,
        routeDefault: ROUTE_DEFAULT,
        knownModels: ENV_KNOWN_MODELS,
        qwenThinking: QWEN_THINKING,
        minSpacingMs: MIN_SPACING_MS,
        localUrl: LOCAL_URL,
        localKey: LOCAL_KEY,
        localModels: LOCAL_MODELS,
        fallbackUrl: FALLBACK_URL,
        fallbackKey: FALLBACK_KEY,
        fallbackModel: FALLBACK_MODEL,
} = loadConfig();

// Advertised-id coherence (audit M4-a D1): the bridge's own guarantees — the
// no-model default and the route default — must be routable and advertised
// whatever the env allow-list says, or /health advertises a catalog whose
// headline entry (defaultModel) is missing from its own models list.
const KNOWN_MODELS = coherentKnownModels(ENV_KNOWN_MODELS, DEFAULT_MODEL, ROUTE_DEFAULT);

// Upstream /models catalog (audit M4-a D1): parsed whenever an upstream
// probe succeeds (at most every 30s). Served ids are merged into the
// allow-list (capped) so /v1/models, /health and a fresh install's seeded
// models.json reflect what the upstream ACTUALLY serves. Only ids pinned by
// the OPERATOR (BRIDGE_KNOWN_MODELS) can be reported stale: provider
// catalogs can flap between snapshots (Agnes alternates 6/9 ids), so a
// catalog-merged id missing from one snapshot is noise, not a 404 trap.
let upstreamCatalog: string[] | null = null;
let staleKnownModels: string[] = [];
let lastCatalogParse = 0;

/** Merge a parsed upstream catalog into the coherence state. Pure enough to
 *  call from /health probes and the boot probe alike. */
function mergeUpstreamCatalog(catalog: string[]): void {
        upstreamCatalog = catalog;
        const { merged } = mergeCatalogIntoKnown(KNOWN_MODELS, catalog);
        for (const id of merged) {
                if (!KNOWN_MODELS.includes(id)) KNOWN_MODELS.push(id);
        }
        const served = new Set(catalog);
        const stale = ENV_KNOWN_MODELS.filter((id) => !served.has(id));
        if (stale.join(",") !== staleKnownModels.join(",")) {
                staleKnownModels = stale;
                if (stale.length) {
                        console.warn(
                                `[llm-bridge] WARNING: BRIDGE_KNOWN_MODELS lists ${stale.join(", ")} but the upstream catalog does not serve ${stale.length === 1 ? "it" : "them"} — requests naming ${stale.length === 1 ? "it" : "them"} pass through and 404 at the upstream. Remove ${stale.length === 1 ? "it" : "them"} from BRIDGE_KNOWN_MODELS so ${stale.length === 1 ? "it re-routes" : "they re-route"} to the default (${ROUTE_DEFAULT}) instead.`,
                        );
                }
        }
}

// ---------------------------------------------------------------------------
// Request log ring buffer (for the dashboard)
// ---------------------------------------------------------------------------
const log: BridgeLogEntry[] = [];
let totalRequests = 0;
let totalErrors = 0;
let totalFailovers = 0;
let upstreamHealthy: boolean | null = null;

// ---------------------------------------------------------------------------
// Persistent usage & cost log (survives restarts — see ./usage.ts).
// PRIVACY: only counts, model ids, timestamps, durations and status are
// written; prompts, messages and tool payloads never reach this file.
// ---------------------------------------------------------------------------
const USAGE_FILE = join(resolveUsageStateDir(process.env, import.meta.dir), USAGE_LOG_FILE_NAME);
let usageEntries = 0; // appends since process start (health/report only)
let usageLogFailureLogged = false;

/** Append one settled request to the usage log. NEVER throws — a broken
 *  usage log must not take the chat path down. */
function persistUsage(entry: BridgeLogEntry) {
        const record: UsageRecord = {
                ts: entry.ts,
                model: entry.model,
                upstreamModel: entry.upstreamModel,
                stream: entry.stream,
                promptTokens: entry.promptTokens,
                completionTokens: entry.completionTokens,
                ...(typeof entry.cachedTokens === "number" ? { cachedTokens: entry.cachedTokens } : {}),
                durationMs: entry.durationMs,
                status: entry.error ? "error" : "ok",
                ...(entry.error ? { error: String(entry.error).slice(0, 200) } : {}),
        };
        const res = appendUsageRecord(USAGE_FILE, record);
        if (res.appended) {
                usageEntries++;
                return;
        }
        if (!usageLogFailureLogged) {
                usageLogFailureLogged = true;
                console.log(`[llm-bridge] usage log append failed (${res.error ?? "unknown error"}) — usage tracking degraded, chats are unaffected`);
        }
}

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
 *
 * target: { url, key } — the REMOTE upstream by default, or the LOCAL
 * OpenAI-compatible server (llama.cpp / Ollama / LM Studio) for `local-*`
 * model ids. A local target sends no Authorization header when its key is
 * empty (llama.cpp runs keyless by default).
 */
async function upstreamFetch(body: any, signal?: AbortSignal, target: { url: string; key: string } = { url: UPSTREAM_URL, key: UPSTREAM_KEY }): Promise<Response> {
        const timeoutMs = upstreamTimeoutMs();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(new Error(`upstream timeout: no response headers after ${timeoutMs}ms`)), timeoutMs);
        const onOuterAbort = () => ctrl.abort(signal?.reason);
        signal?.addEventListener("abort", onOuterAbort, { once: true });
        try {
                const res = await fetch(`${target.url}/chat/completions`, {
                        method: "POST",
                        headers: {
                                "Content-Type": "application/json",
                                ...(target.key ? { Authorization: `Bearer ${target.key}` } : {}),
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

/** Upstream call with serialized spacing + retry on 429/5xx/network.
 *  Local-lane calls skip the spacing throttle (localhost, no rate limit to
 *  respect — CPU-bound llama.cpp serializes itself). The FAILOVER lane is a
 *  second remote, so it joins the spacing throttle like the primary.
 *
 *  Failover short-circuit: when the PRIMARY (route "remote") attempt fails
 *  with a failover-eligible error (see pure.ts isFailoverError) AND a
 *  fallback upstream is configured, the error is rethrown immediately with
 *  `failoverCandidate: true` — no further primary attempts, no backoff burn.
 *  Without this, a quota throttle (429 for the rest of the hour) would waste
 *  the full 6-attempt / ~90s backoff budget on a primary that cannot
 *  possibly recover. The caller (the POST handler) then decides whether to
 *  retry the request on the fallback lane. The fallback lane itself gets the
 *  plain retry semantics — there is no third endpoint to fail over to. */
async function callUpstream(body: any, route: "remote" | "local" | "fallback"): Promise<Response> {
        const target =
                route === "local"
                        ? { url: LOCAL_URL, key: LOCAL_KEY }
                        : route === "fallback"
                          ? { url: FALLBACK_URL, key: FALLBACK_KEY }
                          : { url: UPSTREAM_URL, key: UPSTREAM_KEY };
        const throttled = route === "remote" || route === "fallback";
        if (throttled) await acquireSlot();
        let lastError: any;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                try {
                        return await upstreamFetch(body, undefined, target);
                } catch (err: any) {
                        lastError = err;
                        const msg = String(err?.message ?? err);
                        if (route === "remote" && FALLBACK_URL && isFailoverError(err)) {
                                throw Object.assign(new Error(msg), { status: err?.status, failoverCandidate: true });
                        }
                        if (!isRetryableError(err) || attempt === MAX_ATTEMPTS) throw err;
                        const backoff = backoffDelayMs(attempt);
                        console.log(`[llm-bridge] retryable error (attempt ${attempt}/${MAX_ATTEMPTS}), backing off ${Math.round(backoff)}ms: ${msg.slice(0, 120)}`);
                        await Bun.sleep(backoff);
                        if (throttled) lastRequestAt = Date.now();
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
                cachedTokens: entry.cachedTokens,
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
                                                entry.cachedTokens = stats.cachedTokens;
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
                                data: [...KNOWN_MODELS, ...(LOCAL_URL ? LOCAL_MODELS : [])].map((id) => ({
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
                                // Catalog coherence (audit M4-a D1): parse the
                                // /models body we already fetched — at most every
                                // 30s — so the allow-list reflects what the
                                // upstream actually serves.
                                if (res.ok && Date.now() - lastCatalogParse > 30_000) {
                                        lastCatalogParse = Date.now();
                                        try {
                                                const catalog = parseModelCatalog(await res.json());
                                                if (catalog) mergeUpstreamCatalog(catalog);
                                        } catch {
                                                /* non-JSON body — env-only behavior */
                                        }
                                }
                        } catch {
                                upstreamHealthy = false;
                                upstream = { ok: false };
                        }
                        // local-lane probe (only when configured): reachable / keyless-friendly
                        let local: any = null;
                        if (LOCAL_URL) {
                                try {
                                        const res = await fetch(`${LOCAL_URL}/models`, {
                                                headers: LOCAL_KEY ? { Authorization: `Bearer ${LOCAL_KEY}` } : {},
                                                signal: AbortSignal.timeout(4000),
                                        });
                                        local = { ok: res.ok, status: res.status, url: LOCAL_URL, models: LOCAL_MODELS };
                                } catch {
                                        local = { ok: false, url: LOCAL_URL, models: LOCAL_MODELS };
                                }
                        }
                        // failover-lane probe (only when configured): is the
                        // fallback reachable, should it be able to take over?
                        let fallback: any = null;
                        if (FALLBACK_URL) {
                                try {
                                        const res = await fetch(`${FALLBACK_URL}/models`, {
                                                headers: FALLBACK_KEY ? { Authorization: `Bearer ${FALLBACK_KEY}` } : {},
                                                signal: AbortSignal.timeout(4000),
                                        });
                                        fallback = { ok: res.ok, status: res.status, url: FALLBACK_URL, model: FALLBACK_MODEL || null };
                                } catch {
                                        fallback = { ok: false, url: FALLBACK_URL, model: FALLBACK_MODEL || null };
                                }
                        }
                        return Response.json({
                                ok: true,
                                port: PORT,
                                requests: totalRequests,
                                errors: totalErrors,
                                upstream,
                                local,
                                fallback,
                                failovers: totalFailovers,
                                upstreamKeyIsSet: Boolean(UPSTREAM_KEY),
                                authRequired: Boolean(BRIDGE_API_KEY),
                                upstreamUrl: UPSTREAM_URL,
                                defaultModel: ROUTE_DEFAULT,
                                models: KNOWN_MODELS,
                                // Catalog coherence (audit M4-a D1): what the
                                // upstream actually serves (null = probe not
                                // succeeded yet) and which allow-listed ids it
                                // disproves (they 404 at the upstream).
                                upstreamModels: upstreamCatalog,
                                staleKnownModels,
                                // usage tracking (additive, non-breaking): where the
                                // persistent log lives + appends since process start
                                usageLog: { file: USAGE_FILE, entries: usageEntries },
                        });
                }

                if (req.method === "GET" && url.pathname === "/v1/usage") {
                        // Aggregated usage & cost over the persistent JSONL log.
                        // ?days=N (default 1, 0 < N <= 365, fractional ok) and
                        // ?model=M (requested OR upstream id) are the filters.
                        const daysRaw = url.searchParams.get("days");
                        let days = 1;
                        if (daysRaw !== null) {
                                const n = Number(daysRaw);
                                if (!Number.isFinite(n) || n <= 0 || n > 365) {
                                        return Response.json(
                                                { error: { message: `invalid days parameter "${daysRaw}" (expected 0 < days <= 365)`, type: "usage_error", code: 400 } },
                                                { status: 400 },
                                        );
                                }
                                days = n;
                        }
                        const model = url.searchParams.get("model")?.trim() || undefined;
                        const summary = buildUsageSummary([USAGE_FILE, `${USAGE_FILE}.1`], { days, model, env: process.env, now: Date.now() });
                        return Response.json(summary);
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
                        // Settle the request on the persistent usage log. Streams
                        // persist in settle() once the pipe finishes (token counts
                        // and duration land there); non-streams and errors persist
                        // right after their pushLog().
                        const persist = () => persistUsage(entry);
                        try {
                                const body = await req.json();
                                const wantsStream = body.stream === true;
                                const { route, upstream, requested } = routeRequest(body.model, KNOWN_MODELS, ROUTE_DEFAULT, DEFAULT_MODEL, LOCAL_URL, LOCAL_MODELS);
                                entry.stream = wantsStream;
                                entry.model = requested;
                                entry.upstreamModel = `${route === "local" ? "local:" : ""}${upstream}`;
                                entry.messages = Array.isArray(body.messages) ? body.messages.length : 0;
                                entry.tools = Array.isArray(body.tools) ? body.tools.length : 0;

                                let upstreamBody = buildUpstreamBody(body, upstream, QWEN_THINKING);
                                if (route === "local") upstreamBody = withLocalThinkingCompat(upstreamBody);
                                // Primary dispatch with FAILOVER: when the primary lane fails
                                // with a failover-eligible error (quota/429, rejected key,
                                // 5xx, network — see pure.ts isFailoverError) and a fallback
                                // upstream is configured, rewrite the request onto the
                                // fallback model and retry there instead of surfacing the
                                // error. Local-lane requests never fail over (they are
                                // already a deliberate second-endpoint routing choice), and
                                // the fallback lane itself gets no second-level failover.
                                let res: Response;
                                try {
                                        res = await callUpstream(upstreamBody, route);
                                } catch (primaryErr: any) {
                                        const failover = route === "remote" && FALLBACK_URL && Boolean(primaryErr?.failoverCandidate || isFailoverError(primaryErr));
                                        if (!failover) throw primaryErr;
                                        const fbModel = FALLBACK_MODEL || upstream;
                                        const fbBody = buildUpstreamBody(body, fbModel, QWEN_THINKING);
                                        totalFailovers++;
                                        entry.upstreamModel = `fb:${fbModel}`;
                                        console.log(
                                                `[llm-bridge] primary upstream unavailable (attempt failed: ${String(primaryErr?.message ?? primaryErr).slice(0, 160)}) — failing over to ${FALLBACK_URL} (model: ${fbModel})`,
                                        );
                                        res = await callUpstream(fbBody, "fallback");
                                }

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
                                                persist();
                                        };
                                        return pipeSse(res, entry, settle);
                                }

                                const completion = await res.json();
                                Object.assign(entry, completionStats(completion));
                                pushLog();
                                persist();
                                return Response.json(completion);
                        } catch (err: any) {
                                totalErrors++;
                                entry.error = err?.message ?? String(err);
                                pushLog();
                                persist();
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
// Boot-time catalog probe (audit M4-a D1): non-blocking — the allow-list and
// /health converge as soon as it lands; a provider without /models or a down
// upstream keeps env-only behavior.
void (async () => {
        try {
                const res = await fetch(`${UPSTREAM_URL}/models`, {
                        headers: UPSTREAM_KEY ? { Authorization: `Bearer ${UPSTREAM_KEY}` } : {},
                        signal: AbortSignal.timeout(6000),
                });
                if (res.ok) {
                        const catalog = parseModelCatalog(await res.json());
                        if (catalog) {
                                mergeUpstreamCatalog(catalog);
                                console.log(
                                        `[llm-bridge] upstream catalog: ${catalog.length} model(s); allow-list now ${KNOWN_MODELS.length} id(s)`,
                                );
                        }
                }
        } catch {
                /* best effort — /health probes keep retrying */
        }
})();
if (LOCAL_URL) {
        console.log(`[llm-bridge] local lane ENABLED: ${LOCAL_URL} (models: ${LOCAL_MODELS.length ? LOCAL_MODELS.join(", ") : "any local-* id"})`);
}
if (FALLBACK_URL) {
        console.log(`[llm-bridge] failover lane ENABLED: ${FALLBACK_URL} (model: ${FALLBACK_MODEL || "<routed id unchanged>"}) — takes over when the primary cannot serve`);
}
console.log(
        `[llm-bridge] listening on http://127.0.0.1:${server.port} (OpenAI-compatible, proxying ${UPSTREAM_URL}; models: ${KNOWN_MODELS.join(", ")}; route default: ${ROUTE_DEFAULT})`,
);
console.log(`[llm-bridge] usage log: ${USAGE_FILE} (GET /v1/usage?days=N for aggregates)`);
