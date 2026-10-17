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
        durationMs: number;
        error?: string;
}

/** Mutable stat sink shared by SSE folding and the log entry. */
export interface SseStats {
        finishReason: string | null;
        contentChars: number;
        toolCalls: number;
        promptTokens: number;
        completionTokens: number;
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
}

/**
 * Parse the bridge config from an env-like record. Defaults exactly as
 * documented in index.ts / AGENTS.md:
 *   BRIDGE_PORT 3031, BRIDGE_MODEL kimi-k2.5, upstream
 *   https://coding-intl.dashscope.aliyuncs.com/v1 (trailing slashes stripped),
 *   BRIDGE_ROUTE_DEFAULT falls back to BRIDGE_MODEL, KNOWN_MODELS
 *   "kimi-k2.5,qwen3.7-plus,qwen3.6-plus", BRIDGE_QWEN_THINKING off,
 *   BRIDGE_MIN_SPACING_MS 400.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): BridgeConfig {
        const defaultModel = env.BRIDGE_MODEL ?? "kimi-k2.5";
        return {
                port: Number(env.BRIDGE_PORT ?? 3031),
                apiKey: env.BRIDGE_API_KEY ?? "",
                defaultModel,
                upstreamUrl: (env.BRIDGE_UPSTREAM_URL ?? "https://coding-intl.dashscope.aliyuncs.com/v1").replace(/\/+$/, ""),
                upstreamKey: env.BRIDGE_UPSTREAM_KEY ?? "",
                routeDefault: env.BRIDGE_ROUTE_DEFAULT ?? defaultModel,
                knownModels: (env.BRIDGE_KNOWN_MODELS ?? "kimi-k2.5,qwen3.7-plus,qwen3.6-plus")
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                qwenThinking: /^(1|true|yes)$/i.test(env.BRIDGE_QWEN_THINKING ?? ""),
                minSpacingMs: Number(env.BRIDGE_MIN_SPACING_MS ?? 400),
        };
}

/**
 * Per-attempt headers timeout. Read from env at CALL time (index.ts passes
 * process.env on every attempt, matching the original inline read) and
 * floored at 5s. NOTE: the floor does not guard NaN — a non-numeric
 * BRIDGE_UPSTREAM_TIMEOUT_MS yields NaN (pinned as a QUIRK in pure.test.ts).
 */
export function upstreamTimeoutMs(env: Record<string, string | undefined> = process.env): number {
        return Math.max(5000, Number(env.BRIDGE_UPSTREAM_TIMEOUT_MS ?? 180_000));
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
        //   `thinking` translation; then per-model defaults.
        let enableThinking: boolean | undefined = body.enable_thinking;
        if (body.thinking?.type === "disabled") enableThinking = false;
        else if (body.thinking?.type === "enabled") enableThinking = true;
        if (enableThinking === undefined && /^qwen/i.test(upstreamModel)) {
                enableThinking = qwenThinking;
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
        return {
                finishReason: choice.finish_reason ?? null,
                contentChars: typeof message.content === "string" ? message.content.length : 0,
                toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls.length : 0,
                promptTokens: completion?.usage?.prompt_tokens ?? 0,
                completionTokens: completion?.usage?.completion_tokens ?? 0,
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
                }
        } catch {
                /* partial JSON frame — ignore */
        }
}
