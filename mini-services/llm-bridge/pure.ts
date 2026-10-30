/**
 * llm-bridge — pure logic (no Bun.serve, no fetch, no env reads at call time).
 *
 * Everything here is parameterized over its inputs (config values, model
 * lists, clocks/rng) so `pure.test.ts` can exercise routing, request
 * shaping, tool-call sanitization, SSE stats folding and retry/backoff math
 * without touching process.env or the network. `index.ts` is the thin
 * serving layer: it derives a config from the environment via loadConfig()
 * and feeds it into these functions.
 *
 * Defaults and behavior are extracted 1:1 from index.ts — byte-identical,
 * quirks included (each pinned by a QUIRK/BUG comment in pure.test.ts).
 */

// ---------------------------------------------------------------------------
// Types (OpenAI wire format subset)
// ---------------------------------------------------------------------------
export interface OaiToolCall {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
        index?: number;
}
export interface OaiMessage {
        role: "system" | "user" | "assistant" | "tool";
        content: unknown;
        tool_calls?: OaiToolCall[];
        tool_call_id?: string;
        name?: string;
}

export interface BridgeLogEntry {
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
        /** Cached input tokens (usage.prompt_tokens_details.cached_tokens), when reported. Used by the usage log. */
        cachedTokens?: number;
        durationMs: number;
        error?: string;
        /** Which admission lane served the request (M5: recorded for the usage
         *  log — `unown usage` can split human vs engine traffic, and the
         *  engine's --idle-only routines read interactive presence from it). */
        lane?: BridgeLane;
}

/** Mutable stat sink shared by SSE folding and the log entry. */
export interface SseStats {
        finishReason: string | null;
        contentChars: number;
        toolCalls: number;
        promptTokens: number;
        completionTokens: number;
        /** Cached input tokens when a usage frame reports them (else untouched). */
        cachedTokens?: number;
}

// ---------------------------------------------------------------------------
// Configuration (env parsing lives here so tests can pass a plain object)
// ---------------------------------------------------------------------------
export interface BridgeConfig {
        port: number;
        apiKey: string;
        defaultModel: string;
        upstreamUrl: string;
        upstreamKey: string;
        routeDefault: string;
        knownModels: string[];
        qwenThinking: boolean;
        minSpacingMs: number;
        /** Optional SECOND upstream: a local OpenAI-compatible server (llama.cpp/Ollama/LM Studio). */
        localUrl: string;
        localKey: string;
        /** Model ids served by the local upstream (advertised on /v1/models, routed when BRIDGE_LOCAL_URL is set). */
        localModels: string[];
        /** Optional FAILOVER upstream: a second REMOTE OpenAI-compatible endpoint that serves requests when the primary cannot (quota/429, auth, 5xx, network). Empty = failover off. */
        fallbackUrl: string;
        /** Bearer key for the fallback upstream (empty = keyless). */
        fallbackKey: string;
        /** Model id failed-over requests are rewritten onto (empty = keep the routed model id). */
        fallbackModel: string;
}

/**
 * Parse the bridge config from an env-like record. Defaults exactly as
 * documented in index.ts / AGENTS.md:
 *   BRIDGE_PORT 3031, BRIDGE_MODEL agnes-3.0-flash, upstream
 *   https://apihub.agnes-ai.com/v1 (trailing slashes stripped),
 *   BRIDGE_ROUTE_DEFAULT falls back to BRIDGE_MODEL, KNOWN_MODELS
 *   "agnes-3.0-flash,agnes-2.5-flash", BRIDGE_QWEN_THINKING off,
 *   BRIDGE_MIN_SPACING_MS 400.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): BridgeConfig {
        // `||` (never `??`) on every defaulted var: bun auto-loads the repo .env
        // where optional vars ship EMPTY ("KEY=") — an empty value must mean
        // "unset, use the default", or Number("") = 0 flips ports/thresholds.
        const defaultModel = env.BRIDGE_MODEL || "agnes-3.0-flash";
        return {
                port: Number(env.BRIDGE_PORT || 3031),
                apiKey: env.BRIDGE_API_KEY ?? "",
                defaultModel,
                upstreamUrl: (env.BRIDGE_UPSTREAM_URL || "https://apihub.agnes-ai.com/v1").replace(/\/+$/, ""),
                upstreamKey: env.BRIDGE_UPSTREAM_KEY ?? "",
                routeDefault: env.BRIDGE_ROUTE_DEFAULT || defaultModel,
                knownModels: (env.BRIDGE_KNOWN_MODELS || "agnes-3.0-flash,agnes-2.5-flash")
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                qwenThinking: /^(1|true|yes)$/i.test(env.BRIDGE_QWEN_THINKING ?? ""),
                minSpacingMs: Number(env.BRIDGE_MIN_SPACING_MS || 400),
                localUrl: (env.BRIDGE_LOCAL_URL ?? "").replace(/\/+$/, ""),
                localKey: env.BRIDGE_LOCAL_KEY ?? "",
                localModels: (env.BRIDGE_LOCAL_MODELS ?? "")
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                // Failover lane: same `||`/`??` conventions — optional vars ship
                // EMPTY in .env ("KEY="), which must mean "off". Trailing
                // slashes are stripped like every other URL var.
                fallbackUrl: (env.BRIDGE_FALLBACK_URL ?? "").replace(/\/+$/, ""),
                fallbackKey: env.BRIDGE_FALLBACK_KEY ?? "",
                fallbackModel: (env.BRIDGE_FALLBACK_MODEL ?? "").trim(),
        };
}

/**
 * Per-attempt headers timeout. Read from env at CALL time (index.ts passes
 * process.env on every attempt, matching the original inline read) and
 * floored at 5s. NOTE: the floor does not guard NaN — a non-numeric
 * BRIDGE_UPSTREAM_TIMEOUT_MS yields NaN (pinned as a QUIRK in pure.test.ts).
 */
export function upstreamTimeoutMs(env: Record<string, string | undefined> = process.env): number {
        return Math.max(5000, Number(env.BRIDGE_UPSTREAM_TIMEOUT_MS || 180_000)); // `||`: Number("") is 0
}

// ---------------------------------------------------------------------------
// Retry / backoff / spacing math
// ---------------------------------------------------------------------------
export const MAX_ATTEMPTS = 6;
export const BACKOFF_BASE_MS = 3000;
export const BACKOFF_CAP_MS = 45_000;
export const BACKOFF_JITTER_MS = 1500;

/**
 * Retryability classification for a failed upstream attempt: HTTP 429, any
 * 5xx status, or a network-ish error message (connection resets, fetch
 * failures, timeouts, aborted transfers). 400/401/403/404 are NOT retryable.
 */
export function isRetryableError(err: any): boolean {
        const msg = String(err?.message ?? err);
        const status = err?.status;
        return (
                status === 429 ||
                (typeof status === "number" && status >= 500) ||
                /429|too many requests|rate limit|network|socket|ECONN|fetch failed|timeout|terminated/i.test(msg)
        );
}

/**
 * FAILOVER classification for a failed PRIMARY attempt: does this error mean
 * the primary endpoint cannot serve the request right now, such that a
 * second endpoint should take over? Broader than isRetryableError on
 * purpose:
 *   - status 429 (rate limit / quota throttle — Dashscope's "hour allocated
 *     quota exceeded" ships as 429) and 402/408
 *   - status 401/403 — a rejected/dead primary key IS "primary not working";
 *     the fallback (its own provider, its own key) can still serve
 *   - any 5xx
 *   - message text: quota/throttle/arrears/billing/balance wording (some
 *     providers ship quota errors as plain 400s), rate-limit wording, and
 *     the network-ish set — including Bun's connection-refused phrasing
 *     ("Unable to connect. Is the computer able to access the url?"),
 *     which matches NEITHER the retryable set nor any status
 * NOT failover-eligible: plain 400/404 (schema/model errors — the same
 * request would fail on the fallback too; the engine has its own schema
 * retry for those).
 */
export function isFailoverError(err: any): boolean {
        const msg = String(err?.message ?? err);
        const status = err?.status;
        if (
                status === 429 ||
                status === 402 ||
                status === 408 ||
                status === 401 ||
                status === 403 ||
                (typeof status === "number" && status >= 500)
        ) {
                return true;
        }
        return /quota|throttl|arrearage|billing|balance|insufficient|rate.?limit|too many requests|429|network|socket|ECONN|fetch failed|unable to connect|refused|timeout|terminated/i.test(msg);
}

/**
 * Backoff before retry N: min(3s * 2^(N-1), 45s) + up to 1.5s jitter.
 * The 45s cap applies to the exponential base only — with jitter the total
 * can reach 46.5s (pinned as a QUIRK in pure.test.ts).
 */
export function backoffDelayMs(attempt: number, rng: () => number = Math.random): number {
        return Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS) + rng() * BACKOFF_JITTER_MS;
}

/**
 * Milliseconds the serialization chain must sleep before the next upstream
 * dispatch: max(0, lastRequestAt + minSpacingMs - now). The caller treats
 * NaN as "no wait" (NaN > 0 is false), so a garbage BRIDGE_MIN_SPACING_MS
 * disables spacing rather than wedging the chain (QUIRK, pinned in tests).
 */
export function spacingWaitMs(lastRequestAt: number, now: number, minSpacingMs: number): number {
        return Math.max(0, lastRequestAt + minSpacingMs - now);
}

// ---------------------------------------------------------------------------
// Admission lanes (2026-10-22 M2 — the starvation fix)
// ---------------------------------------------------------------------------

export type BridgeLane = "interactive" | "background";

/**
 * Which admission lane a request belongs to. The measured starvation
 * (2026-10-22 benchtest) was upstream-side: with 3-4 concurrent streams from
 * one key the provider degraded 2s calls into 45s calls, so an engine dream
 * (a batch of sequential LLM calls) made interactive terminal sessions look
 * hung for minutes. The bridge now caps in-flight upstream attempts and
 * admits INTERACTIVE requests (a human waiting on a terminal/print session)
 * ahead of queued BACKGROUND work (engine learning jobs).
 *
 * Signaling, in priority order:
 *   1. `x-unown-lane: background` request header (explicit; works with any
 *      client that can set headers, including BRIDGE_API_KEY deployments)
 *   2. the bearer `bridge-background` (the engine's learning clients signal
 *      through the apiKey because mem0's internal OpenAI client cannot
 *      forward custom headers — apiKey/baseURL/timeout are all it passes)
 *
 * Anything else — including the terminal agent's `bridge-local`, real
 * provider keys, and unauthenticated local traffic — is interactive: when a
 * marker is absent, the request that cannot wait is the safe default.
 * QUIRK (documented): when BRIDGE_API_KEY is set, the engine's mem0 calls
 * must present THAT key, so they fall back to interactive priority; the
 * header lane (1) remains available for explicit opt-in.
 */
export function laneForRequest(authHeader: string | undefined, laneHeader: string | undefined): BridgeLane {
        // Explicit header wins in BOTH directions (an "interactive" marker
        // outranks a background-looking bearer, and vice versa).
        const header = typeof laneHeader === "string" ? laneHeader.trim().toLowerCase() : "";
        if (header === "background") return "background";
        if (header === "interactive") return "interactive";
        const bearer = String(authHeader ?? "")
                .trim()
                .replace(/^Bearer\s+/i, "")
                .trim();
        if (bearer === "bridge-background") return "background";
        return "interactive";
}

// ---------------------------------------------------------------------------
// Model routing + request shaping
// ---------------------------------------------------------------------------
/**
 * Route a requested model onto the allow-list: known ids pass through
 * unchanged; anything else (unknown/legacy ids, missing/non-string values)
 * is routed to routeDefault. Whitespace is trimmed. The allow-list match is
 * case-sensitive ("Kimi-K2.5" is NOT known — QUIRK, pinned in tests).
 */
export function routeModel(
        requested: unknown,
        knownModels: string[],
        routeDefault: string,
        defaultModel: string,
): { upstream: string; requested: string } {
        const asked = typeof requested === "string" && requested.trim() ? requested.trim() : defaultModel;
        const upstream = knownModels.includes(asked) ? asked : routeDefault;
        return { upstream, requested: asked };
}

/** A model id is served by the local upstream when it is listed in localModels,
 *  or (when localModels is empty) when it carries the `local-` prefix — the
 *  convention for the bundled local lane (e.g. `local-qwen3-0.6b`). */
export function isLocalModel(requested: string, localModels: string[]): boolean {
        return localModels.includes(requested) || (localModels.length === 0 && requested.startsWith("local-"));
}

/**
 * Full routing decision for a request: which upstream (remote allow-list or
 * local server) and which model id to send there.
 *
 * - local candidates: ids in localModels, or `local-*` ids when the list is
 *   empty — but ONLY when a localUrl is configured. A `local-*` id with no
 *   BRIDGE_LOCAL_URL falls back to the remote allow-list (which routes it to
 *   routeDefault) so a missing local server degrades instead of hard-failing.
 * - everything else: the existing routeModel allow-list behavior, unchanged.
 */
export function routeRequest(
        requested: unknown,
        knownModels: string[],
        routeDefault: string,
        defaultModel: string,
        localUrl: string,
        localModels: string[],
): { route: "remote" | "local"; upstream: string; requested: string } {
        const asked = typeof requested === "string" && requested.trim() ? requested.trim() : defaultModel;
        if (localUrl && isLocalModel(asked, localModels)) {
                return { route: "local", upstream: asked, requested: asked };
        }
        const { upstream } = routeModel(asked, knownModels, routeDefault, defaultModel);
        return { route: "remote", upstream, requested: asked };
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
export function buildUpstreamBody(body: any, upstreamModel: string, qwenThinking: boolean): any {
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
        //   `thinking` translation; then per-model defaults. The qwen check
        //   strips a leading `local-` first so local-lane ids naming qwen
        //   models (e.g. `local-qwen3-0.6b` on a llama.cpp server) get the
        //   same thinking-off default — otherwise the hybrid model burns the
        //   whole completion on reasoning_content and returns empty content.
        const modelFamily = upstreamModel.replace(/^local-/, "");
        let enableThinking: boolean | undefined = body.enable_thinking;
        if (body.thinking?.type === "disabled") enableThinking = false;
        else if (body.thinking?.type === "enabled") enableThinking = true;
        if (enableThinking === undefined && /^qwen/i.test(modelFamily)) {
                enableThinking = qwenThinking;
        }
        if (enableThinking !== undefined && /^qwen/i.test(modelFamily)) {
                out.enable_thinking = enableThinking;
        }
        return out;
}

/**
 * Local-lane compatibility: llama.cpp's OpenAI endpoint controls template
 * flags via `chat_template_kwargs` (e.g. {enable_thinking:false} for hybrid
 * qwen models), while Dashscope reads the top-level `enable_thinking`.
 * When a resolved body carries enable_thinking and is headed to a LOCAL
 * server, mirror it into chat_template_kwargs so both dialects work.
 */
export function withLocalThinkingCompat(body: any): any {
        if (body && body.enable_thinking !== undefined && body.chat_template_kwargs === undefined) {
                return { ...body, chat_template_kwargs: { enable_thinking: body.enable_thinking } };
        }
        return body;
}

/**
 * Defensive unwrapping of double-wrapped tool calls: some models occasionally
 * emit arguments like {"name":"read","arguments":{...}} (imitating the wire
 * format). Unwrap to the inner arguments object.
 */
export function sanitizeToolCalls(toolCalls: any[] | undefined): any[] | undefined {
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

/**
 * Repair a REQUEST messages array before it goes upstream.
 *
 * The stress round's live find: an interrupted tool sequence can leave a
 * role:"tool" message with no tool_call_id (or an assistant tool_call with
 * no id) in the history, and OpenAI-compatible upstreams answer that with a
 * hard 400 ("missing field `tool_call_id`") — every retry re-sends the same
 * broken list, so the session is wedged at the provider, not the model.
 * Three repairs, each counted:
 *   1. tool messages without a usable tool_call_id are dropped;
 *   2. tool messages whose tool_call_id matches no earlier assistant
 *      tool_call are dropped (orphans — same 400 upstream);
 *   3. assistant tool_calls entries are id-filled/deep-santized (via
 *      sanitizeToolCalls), and an assistant message left with neither
 *      content nor tool_calls is dropped.
 * Verbatim passthrough is preserved when nothing needs repair.
 */
export function sanitizeMessages(messages: any): { messages: any[]; repairs: number; dropped: number } {
        if (!Array.isArray(messages)) return { messages: [], repairs: 0, dropped: 0 };
        const seenCallIds = new Set<string>();
        const out: any[] = [];
        let repairs = 0;
        let dropped = 0;
        for (const m of messages) {
                if (!m || typeof m !== "object" || typeof m.role !== "string") {
                        dropped++;
                        continue;
                }
                if (m.role === "tool") {
                        const id = typeof m.tool_call_id === "string" ? m.tool_call_id : "";
                        if (!id || !seenCallIds.has(id)) {
                                dropped++;
                                continue;
                        }
                        out.push(m);
                        continue;
                }
                if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
                        const fixed = sanitizeToolCalls(m.tool_calls);
                        if (fixed.length !== m.tool_calls.length) repairs++;
                        for (const tc of fixed) seenCallIds.add(tc.id);
                        const clone = { ...m, tool_calls: fixed };
                        const hasContent = clone.content !== undefined && clone.content !== null && clone.content !== "";
                        if (!hasContent && fixed.length === 0) {
                                dropped++;
                                continue;
                        }
                        out.push(clone);
                        continue;
                }
                if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length === 0) {
                        // an empty tool_calls array is itself a 400 on strict upstreams
                        const clone = { ...m };
                        delete clone.tool_calls;
                        repairs++;
                        const hasContent = clone.content !== undefined && clone.content !== null && clone.content !== "";
                        if (!hasContent) {
                                dropped++;
                                continue;
                        }
                        out.push(clone);
                        continue;
                }
                out.push(m);
        }
        return { messages: out, repairs, dropped };
}

// ---------------------------------------------------------------------------
// Completion / SSE stats
// ---------------------------------------------------------------------------
/**
 * Extract summary stats from a non-stream completion for the log entry.
 * NOTE: this MUTATES `completion` when the assistant message carries
 * tool_calls — it replaces them with sanitized copies, which is
 * load-bearing: index.ts serializes the same object to the client, so the
 * client receives the unwrapped arguments (pinned as a QUIRK in tests).
 */
export function completionStats(completion: any) {
        const choice = completion?.choices?.[0] ?? {};
        const message = choice.message ?? {};
        if (Array.isArray(message.tool_calls)) {
                message.tool_calls = sanitizeToolCalls(message.tool_calls);
        }
        const cached = completion?.usage?.prompt_tokens_details?.cached_tokens;
        return {
                finishReason: choice.finish_reason ?? null,
                contentChars: typeof message.content === "string" ? message.content.length : 0,
                toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls.length : 0,
                promptTokens: completion?.usage?.prompt_tokens ?? 0,
                completionTokens: completion?.usage?.completion_tokens ?? 0,
                // Only present when the upstream reports it — keeps the exact
                // toEqual shapes in pure.test.ts stable for completions without
                // prompt_tokens_details.
                ...(typeof cached === "number" ? { cachedTokens: cached } : {}),
        };
}

/**
 * Fold one SSE line (as split from the byte stream: already newline-split
 * and trimmed) into the stat sink. Handles "data: {...}" frames, skips the
 * "data: [DONE]" terminator and non-data lines, and ignores partial/garbage
 * JSON. Used by the SSE pipe so the request log stays accurate for streamed
 * requests; the same folding is unit-tested here against golden frames.
 *
 * QUIRK (pinned in tests): tool_calls counts the MAX number of tool-call
 * deltas seen in a single chunk (Math.max per frame), NOT the accumulated
 * total across chunks.
 */
export function foldSseLine(line: string, stats: SseStats): void {
        if (!line.startsWith("data:")) return;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
                const obj = JSON.parse(payload);
                const choice = obj?.choices?.[0];
                if (choice?.finish_reason) stats.finishReason = choice.finish_reason;
                const delta = choice?.delta;
                if (typeof delta?.content === "string") stats.contentChars += delta.content.length;
                if (Array.isArray(delta?.tool_calls)) stats.toolCalls = Math.max(stats.toolCalls, delta.tool_calls.length);
                if (obj?.usage) {
                        stats.promptTokens = obj.usage.prompt_tokens ?? stats.promptTokens;
                        stats.completionTokens = obj.usage.completion_tokens ?? stats.completionTokens;
                        const cached = obj.usage.prompt_tokens_details?.cached_tokens;
                        if (typeof cached === "number") stats.cachedTokens = cached;
                }
        } catch {
                /* partial JSON frame — ignore */
        }
}

// ---------------------------------------------------------------------------
// Degenerate-completion detection (2026-10-23 — the silent-empty-upstream fix)
// ---------------------------------------------------------------------------

/**
 * Release trigger for the degenerate-stream holdback: does this SSE data
 * frame carry ASSISTANT WORK PRODUCT (text content, a tool call, or
 * reasoning)? Role-only frames, bare finish_reason frames, usage-only
 * frames and [DONE] do NOT release — a stream that ends without ever
 * releasing is degenerate.
 *
 * WHY THIS EXISTS (measured live, 2026-10-23): the Agnes AI flash upstream
 * under concurrent load occasionally answers a 200 SSE stream that carries
 * ZERO content frames — a role delta, a bare finish_reason "stop", maybe a
 * 0/0 usage chunk, then [DONE] — after holding the connection 48-81s. Every
 * layer used to treat that as a successful (empty) answer: the bridge logged
 * status "ok" with pt=0/ct=0, pi-ai minted a valid empty assistant turn, and
 * `unown -p` exited 0 with an empty stdout. The bridge now HOLDS frames
 * until this predicate releases (the first real work product) and retries
 * the upstream once when the stream degenerates instead; the client-side
 * guard (pi-ai openai-completions' empty-completion throw) is the second
 * layer. Pure + unit-tested (pure.test.ts).
 */
export function sseFrameSignalsContent(line: string): boolean {
        if (!line.startsWith("data:")) return false;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return false;
        try {
                const obj = JSON.parse(payload);
                const choice = obj?.choices?.[0];
                const delta = choice?.delta;
                if (typeof delta?.content === "string" && delta.content.length > 0) return true;
                if (Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0) return true;
                // Reasoning deltas (llama.cpp reasoning_content, other OpenAI-compatible
                // servers' reasoning / reasoning_text) are work product for thinking models.
                for (const field of ["reasoning_content", "reasoning", "reasoning_text"]) {
                        const value = (delta as Record<string, unknown> | undefined)?.[field];
                        if (typeof value === "string" && value.length > 0) return true;
                }
                // Some providers leak non-streaming shapes inside streams.
                const message = choice?.message;
                if (typeof message?.content === "string" && message.content.length > 0) return true;
                if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) return true;
                return false;
        } catch {
                return false; // partial/garbage JSON — keep holding (a later frame decides)
        }
}

/**
 * Degenerate NON-STREAM completion detector: a 200 JSON body whose single
 * choice carries no message content, no tool calls, no reasoning and zero
 * completion tokens is not an answer — the same upstream fault as the empty
 * stream above, in the request/response shape (this is what mem0's OpenAI
 * SDK client sees). A missing/empty choices array with a 200 is degenerate
 * too. Pure + unit-tested.
 */
export function isDegenerateCompletion(body: unknown): boolean {
        const choice = (body as { choices?: unknown[] } | null)?.choices?.[0] as
                | { message?: { content?: unknown; tool_calls?: unknown; reasoning_content?: unknown } }
                | undefined;
        if (!choice) return true;
        const message = choice.message ?? {};
        const content = typeof message.content === "string" ? message.content : "";
        const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.length : 0;
        const reasoning = typeof message.reasoning_content === "string" ? message.reasoning_content.length : 0;
        const completionTokens = (body as { usage?: { completion_tokens?: unknown } } | null)?.usage?.completion_tokens;
        return (
                content.length === 0 &&
                toolCalls === 0 &&
                reasoning === 0 &&
                (typeof completionTokens === "number" ? completionTokens : 0) === 0
        );
}

// ---------------------------------------------------------------------------
// Catalog coherence (audit M4-a D1 — the stale-allow-list 404 trap)
// ---------------------------------------------------------------------------

/**
 * Union the env allow-list with the bridge's own guaranteed ids: the
 * no-model default (BRIDGE_MODEL) and the route default
 * (BRIDGE_ROUTE_DEFAULT) are, by definition, ids this bridge serves, so they
 * must be routable AND advertised by /v1/models + /health. Before this, an
 * operator who set BRIDGE_MODEL=agnes-3.0-flash but left
 * BRIDGE_KNOWN_MODELS at its Dashscope defaults shipped a /health whose
 * headline default was absent from its own models list — and every fresh
 * unown install that seeded from /health inherited the incoherence.
 */
export function coherentKnownModels(knownModels: string[], defaultModel: string, routeDefault: string): string[] {
        const out = [...knownModels];
        for (const id of [defaultModel, routeDefault]) {
                if (id && !out.includes(id)) out.push(id);
        }
        return out;
}

/**
 * Parse an OpenAI-compatible GET /models response body into id strings.
 * null when the shape is wrong or empty — a provider without the endpoint
 * keeps env-only behavior.
 */
export function parseModelCatalog(body: unknown): string[] | null {
        const data = (body as { data?: unknown } | null)?.data;
        if (!Array.isArray(data)) return null;
        const ids = data
                .map((m: unknown) => (typeof (m as { id?: unknown })?.id === "string" ? (m as { id: string }).id.trim() : ""))
                .filter(Boolean);
        return ids.length ? ids : null;
}

/**
 * Merge a fetched upstream catalog into the allow-list (in place of the
 * caller's array). Capped: a provider-scale catalog (OpenRouter: 400+) would
 * flood the TUI /model picker and a fresh models.json; the operator can
 * still allow-list more via BRIDGE_KNOWN_MODELS. Also reports which
 * allow-listed ids the catalog does NOT serve — the stale-id trap: requests
 * naming them pass through and 404 at the upstream instead of re-routing.
 */
export function mergeCatalogIntoKnown(
        known: string[],
        catalog: string[],
        cap = 64,
): { merged: string[]; stale: string[] } {
        const served = new Set(catalog);
        const stale = known.filter((id) => !served.has(id));
        const merged = [...known];
        for (const id of catalog) {
                if (merged.length >= cap) break;
                if (!merged.includes(id)) merged.push(id);
        }
        return { merged, stale };
}

// ---------------------------------------------------------------------------
// Upstream catalog specs (the model-specs round)
// ---------------------------------------------------------------------------

/** Spec fields one upstream /models entry may carry, normalized. */
export interface CatalogSpec {
        contextWindow?: number;
        maxTokens?: number;
        imageInput?: boolean;
}

function specNum(v: unknown): number | undefined {
        return typeof v === "number" && Number.isFinite(v) && v > 0 && Number.isInteger(v) ? v : undefined;
}

/**
 * Extract the spec fields from ONE upstream /models entry — the same field
 * names the agent's `parseEndpointCatalogEntry` reads (vLLM `max_model_len`,
 * LM Studio `loaded_context_length`, llama.cpp `meta.n_ctx`, OpenRouter
 * `top_provider.max_completion_tokens` + `architecture.input_modalities`,
 * DeepInfra `metadata.*`), so the bridge's /v1/models passthrough speaks the
 * agent's dialect natively and no translation layer is needed.
 */
export function parseCatalogEntrySpecs(entry: unknown): CatalogSpec {
        if (!entry || typeof entry !== "object") return {};
        const e = entry as Record<string, any>;
        const meta = e.meta ?? {};
        const metadata = e.metadata ?? {};
        const top = e.top_provider ?? {};
        const contextCandidates = [
                specNum(metadata.loaded_context_length),
                specNum(e.loaded_context_length),
                specNum(e.max_model_len),
                specNum(meta.n_ctx),
                specNum(metadata.max_model_len),
                specNum(e.max_context_length),
                specNum(metadata.context_length),
                specNum(e.context_length),
                specNum(e.context_window),
                specNum(metadata.max_input_tokens),
                specNum(e.max_input_tokens),
        ];
        const outputCandidates = [
                specNum(top.max_completion_tokens),
                specNum(metadata.max_tokens),
                specNum(e.max_completion_tokens),
                specNum(e.max_output_tokens),
                specNum(metadata.max_output_tokens),
                specNum(e.max_tokens),
        ];
        const contextWindow = contextCandidates.find((n) => n !== undefined);
        const maxTokens = outputCandidates.find((n) => n !== undefined);
        const arch = e.architecture ?? {};
        const caps = e.capabilities;
        const imageInput =
                (Array.isArray(caps) && caps.includes("vision")) ||
                (Array.isArray(arch.input_modalities) && arch.input_modalities.includes("image"));
        return {
                ...(contextWindow !== undefined ? { contextWindow } : {}),
                ...(maxTokens !== undefined ? { maxTokens } : {}),
                ...(imageInput ? { imageInput: true } : {}),
        };
}

/**
 * The upstream catalog's specs, by model id — only the entries that carry at
 * least one spec field. This is what /health reports as `modelSpecs` and what
 * /v1/models passes through per entry.
 */
export function extractCatalogSpecs(body: unknown): Record<string, CatalogSpec> {
        const out: Record<string, CatalogSpec> = {};
        const data = (body as { data?: unknown } | null)?.data;
        if (!Array.isArray(data)) return out;
        for (const entry of data) {
                const id = typeof (entry as { id?: unknown })?.id === "string" ? ((entry as { id: string }).id ?? "").trim() : "";
                if (!id) continue;
                const spec = parseCatalogEntrySpecs(entry);
                if (spec.contextWindow !== undefined || spec.maxTokens !== undefined || spec.imageInput) out[id] = spec;
        }
        return out;
}

// ---------------------------------------------------------------------------
// Context-limit learning from upstream 400s (surfaced, never auto-applied)
// ---------------------------------------------------------------------------

/**
 * Parse an upstream 400/413 error text for the REAL limits it reveals —
 * contextWindow AND maxTokens when the error names both. The patterns mirror
 * pi's `isContextOverflow` catalog (OpenAI, OpenRouter, Together, Mistral,
 * Grok, Kimi, DS4, DashScope, xAI, Bedrock…) — but where pi only asks "is
 * this an overflow?", we want the NUMBERs the upstream just told us, so the
 * next `unown models verify` can record them.
 */
export function parseContextLimitError(text: string): { contextWindow?: number; maxTokens?: number } | undefined {
        if (!text || typeof text !== "string") return undefined;
        // "maximum context length is 131072 tokens" / "maximum context length of 65536 tokens"
        // "maximum allowed input length of 200000 tokens" / "context size is 32768 tokens"
        // "context length (131072 tokens)" / "exceeded model token limit: 262144 (requested: …)"
        const contextPatterns = [
                /maximum(?:'s)?\s+(?:model\s+)?context\s+length\s+(?:is|of)\s+(\d{4,})\s*tokens?/i,
                /maximum\s+context\s+length\s+\((\d{4,})\)/i,
                /maximum\s+allowed\s+input\s+length\s+of\s+(\d{4,})\s*tokens?/i,
                /configured\s+context\s+size\s+is\s+(\d{4,})\s*tokens?/i,
                /context\s+length\s+\((\d{4,})\s*tokens?\)/i,
                /exceeded\s+model\s+token\s+limit:\s*(\d{4,})/i,
                /maximum\s+context\s+size\s+(?:is\s+)?(\d{4,})/i,
                // Mistral: "too large for model with 131072 maximum context length"
                /with\s+(\d{4,})\s+maximum\s+context\s+length/i,
                // DashScope/Qwen: "Range of input length should be [1, 100000]"
                /Range\s+of\s+input\s+length\s+should\s+be\s*\[1,\s*(\d{4,})\]/i,
                // xAI (Grok): "maximum prompt length is 131072"
                /maximum\s+prompt\s+length\s+is\s+(\d{4,})/i,
                // Amazon Bedrock: "input is too long for requested model. max tokens is 2097152"
                /input\s+is\s+too\s+long[^\d]*max(?:imum)?\s*tokens?\s+is\s+(\d{4,})/i,
        ];
        // Output caps: "max_tokens must be at most 65536" (OpenAI-style
        // validation) / "max output tokens is 65536" — evidence for the OUTPUT
        // limit, which the context patterns never carry.
        const outputPatterns = [
                /max_tokens\s+must\s+be\s+at\s+most\s+(\d{4,})/i,
                /max(?:imum)?\s+output\s+tokens\s+(?:is|of)\s+(\d{4,})/i,
        ];
        const sane = (n: number) => Number.isInteger(n) && n >= 1024 && n <= 100_000_000;
        const out: { contextWindow?: number; maxTokens?: number } = {};
        for (const re of contextPatterns) {
                const m = text.match(re);
                if (m) {
                        const n = Number(m[1]);
                        if (sane(n)) out.contextWindow = n;
                        break; // one context number — the first (most specific) pattern wins
                }
        }
        for (const re of outputPatterns) {
                const m = text.match(re);
                if (m) {
                        const n = Number(m[1]);
                        if (sane(n)) {
                                out.maxTokens = n;
                                break;
                        }
                }
        }
        return out.contextWindow !== undefined || out.maxTokens !== undefined ? out : undefined;
}
