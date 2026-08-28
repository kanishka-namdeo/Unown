/**
 * llm-bridge — OpenAI-compatible gateway over z-ai-web-dev-sdk.
 *
 * Lets the pi coding agent (and the self-learning layer) use the sandbox LLM
 * through a standard `openai-completions` provider config:
 *   baseUrl: http://127.0.0.1:3031/v1
 *
 * The z-ai SDK supports native tool calling but not usable SSE streaming,
 * so we always call it non-streaming and synthesize an SSE stream when the
 * client asks for `stream: true` (pi always does).
 */
import ZAI from "z-ai-web-dev-sdk";

const PORT = 3031;

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
let zai: Awaited<typeof ZAI.create> | null = null;

// ---------------------------------------------------------------------------
// Rate-limit protection: serialize z-ai calls with spacing + retry on 429.
// ---------------------------------------------------------------------------
let chain: Promise<void> = Promise.resolve();
const MIN_SPACING_MS = 2000;
let lastRequestAt = 0;

async function callZaiThrottled(body: any): Promise<any> {
        // serialize through a promise chain (max 1 in flight)
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

        const MAX_ATTEMPTS = 6;
        let lastError: any;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                try {
                        const zaiClient = await getZai();
                        return await zaiClient.chat.completions.create(body);
                } catch (err: any) {
                        lastError = err;
                        const msg = String(err?.message ?? err);
                        const retryable = /429|too many requests|rate limit/i.test(msg) || /5\d\d/.test(msg);
                        if (!retryable || attempt === MAX_ATTEMPTS) throw err;
                        const backoff = Math.min(3000 * 2 ** (attempt - 1), 45000) + Math.random() * 1500;
                        console.log(`[llm-bridge] retryable error (attempt ${attempt}/${MAX_ATTEMPTS}), backing off ${Math.round(backoff)}ms: ${msg.slice(0, 120)}`);
                        await Bun.sleep(backoff);
                        lastRequestAt = Date.now();
                }
        }
        throw lastError;
}

async function getZai() {
        if (!zai) zai = await ZAI.create();
        return zai;
}

// ---------------------------------------------------------------------------
// Message normalization: OpenAI protocol -> z-ai SDK (system/user/assistant only)
// ---------------------------------------------------------------------------
function contentToText(content: unknown): string {
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
                return content
                        .map((part: any) => {
                                if (typeof part === "string") return part;
                                if (part?.type === "text" && typeof part.text === "string") return part.text;
                                if (part?.type === "image_url") return "[image omitted]";
                                return "";
                        })
                        .join("");
        }
        return content == null ? "" : String(content);
}

function normalizeMessages(messages: OaiMessage[]): { role: "system" | "user" | "assistant"; content: string }[] {
        // call_id -> tool name lookup so tool results can be framed with the tool name
        const toolNameById = new Map<string, string>();
        for (const m of messages) {
                if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
                        for (const tc of m.tool_calls) {
                                if (tc.id) {
                                        let name = tc.function?.name;
                                        try {
                                                const parsed = JSON.parse(tc.function?.arguments ?? "{}");
                                                if (parsed && typeof parsed === "object" && typeof parsed.name === "string" && parsed.arguments && typeof parsed.arguments === "object") {
                                                        name = parsed.name; // unwrap double-wrapped calls
                                                }
                                        } catch {
                                                /* leave as-is */
                                        }
                                        toolNameById.set(tc.id, name ?? "tool");
                                }
                        }
                }
        }

        const out: { role: "system" | "user" | "assistant"; content: string }[] = [];
        for (const m of messages) {
                if (m.role === "system") {
                        out.push({ role: "system", content: contentToText(m.content) });
                } else if (m.role === "user") {
                        out.push({ role: "user", content: contentToText(m.content) });
                } else if (m.role === "assistant") {
                        // Render ONLY the visible text. Never echo tool-call JSON back as text:
                        // the model would imitate the framing inside future tool arguments.
                        const text = contentToText(m.content);
                        out.push({ role: "assistant", content: text || "..." });
                } else if (m.role === "tool") {
                        const name = toolNameById.get(m.tool_call_id ?? "") ?? m.name ?? "tool";
                        out.push({
                                role: "user",
                                content: `[Result of the ${name} tool]\n${contentToText(m.content)}`,
                        });
                }
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
// SSE synthesis: full completion -> OpenAI streaming chunks
// ---------------------------------------------------------------------------
function sse(res: Response, chunks: unknown[]) {
        const encoder = new TextEncoder();
        let closed = false;
        const stream = new ReadableStream({
                start(controller) {
                        const push = (obj: unknown) => {
                                if (closed) return;
                                controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
                        };
                        for (const c of chunks) push(c);
                        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                        controller.close();
                        closed = true;
                },
                cancel() {
                        closed = true;
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

function completionToChunks(completion: any, model: string) {
        const choice = completion?.choices?.[0] ?? {};
        const message = choice.message ?? {};
        const finishReason = choice.finish_reason ?? "stop";
        const id = completion?.id ?? `bridge-${Date.now()}`;
        const created = completion?.created ?? Math.floor(Date.now() / 1000);
        const chunks: any[] = [];

        // initial role chunk
        chunks.push({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });

        // content in slices
        const text = typeof message.content === "string" ? message.content : contentToText(message.content);
        if (text) {
                const SLICE = 240;
                for (let i = 0; i < text.length; i += SLICE) {
                        chunks.push({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: text.slice(i, i + SLICE) }, finish_reason: null }] });
                }
        }

        // tool calls (delta format with index), defensively unwrapped
        const toolCalls = sanitizeToolCalls(message.tool_calls);
        if (toolCalls && toolCalls.length) {
                toolCalls.forEach((tc, i) => {
                        chunks.push({
                                id,
                                object: "chat.completion.chunk",
                                created,
                                model,
                                choices: [
                                        {
                                                index: 0,
                                                delta: {
                                                        tool_calls: [
                                                                {
                                                                        index: i,
                                                                        id: tc.id,
                                                                        type: "function",
                                                                        function: { name: tc.function.name, arguments: tc.function.arguments },
                                                                },
                                                        ],
                                                },
                                                finish_reason: null,
                                        },
                                ],
                        });
                });
        }

        // finish_reason
        chunks.push({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] });

        // usage (pi requests stream_options.include_usage)
        if (completion?.usage) {
                chunks.push({
                        id,
                        object: "chat.completion.chunk",
                        created,
                        model,
                        choices: [],
                        usage: {
                                prompt_tokens: completion.usage.prompt_tokens ?? 0,
                                completion_tokens: completion.usage.completion_tokens ?? 0,
                                total_tokens: completion.usage.total_tokens ?? 0,
                        },
                });
        }
        return chunks;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = Bun.serve({
        port: PORT,
        idleTimeout: 255, // LLM calls are slow; keep connections open (max 255s)
        async fetch(req) {
                const url = new URL(req.url);

                if (req.method === "GET" && url.pathname === "/v1/models") {
                        return Response.json({
                                object: "list",
                                data: [
                                        { id: "glm-4-plus", object: "model", created: Math.floor(Date.now() / 1000), owned_by: "zai-bridge" },
                                ],
                        });
                }

                if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
                        return Response.json({ ok: true, port: PORT, requests: totalRequests, errors: totalErrors });
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
                        try {
                                const body = await req.json();
                                const wantsStream = body.stream === true;
                                entry.stream = wantsStream;
                                entry.model = body.model ?? "glm-4-plus";
                                entry.messages = Array.isArray(body.messages) ? body.messages.length : 0;
                                entry.tools = Array.isArray(body.tools) ? body.tools.length : 0;

                                // Do NOT ask the z-ai SDK for streaming — call non-streaming,
                                // throttled + retried by callZaiThrottled.
                                const completion = await callZaiThrottled({
                                        model: body.model,
                                        messages: normalizeMessages(body.messages ?? []),
                                        tools: Array.isArray(body.tools) && body.tools.length > 0 ? body.tools : undefined,
                                        tool_choice: body.tool_choice,
                                        max_tokens: body.max_tokens ?? body.max_completion_tokens,
                                        temperature: body.temperature,
                                        thinking: { type: "disabled" },
                                });

                                const choice = completion?.choices?.[0] ?? {};
                                const message = choice.message ?? {};
                                // Sanitize double-wrapped tool calls before handing the completion back.
                                if (Array.isArray(message.tool_calls)) {
                                        message.tool_calls = sanitizeToolCalls(message.tool_calls);
                                }
                                entry.finishReason = choice.finish_reason ?? null;
                                entry.contentChars = typeof message.content === "string" ? message.content.length : 0;
                                entry.toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.length : 0;
                                entry.promptTokens = completion?.usage?.prompt_tokens ?? 0;
                                entry.completionTokens = completion?.usage?.completion_tokens ?? 0;

                                if (wantsStream) {
                                        entry.durationMs = Date.now() - started;
                                        log.push(entry);
                                        if (log.length > 500) log.shift();
                                        return sse(req, completionToChunks(completion, entry.model));
                                }
                                entry.durationMs = Date.now() - started;
                                log.push(entry);
                                if (log.length > 500) log.shift();
                                return Response.json(completion);
                        } catch (err: any) {
                                totalErrors++;
                                entry.error = err?.message ?? String(err);
                                entry.durationMs = Date.now() - started;
                                log.push(entry);
                                if (log.length > 500) log.shift();
                                const status = /api key|auth/i.test(entry.error) ? 401 : 500;
                                return Response.json(
                                        { error: { message: `llm-bridge: ${entry.error}`, type: "bridge_error", code: status } },
                                        { status },
                                );
                        }
                }

                return Response.json({ error: { message: `Not found: ${req.method} ${url.pathname}` } }, { status: 404 });
        },
});

console.log(`[llm-bridge] listening on http://127.0.0.1:${server.port} (OpenAI-compatible, backed by z-ai-web-dev-sdk)`);
