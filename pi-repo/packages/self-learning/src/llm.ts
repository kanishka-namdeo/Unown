/**
 * llm.ts — thin LLM client for the self-learning layer.
 *
 * All learning-layer intelligence (failure mining, dream consolidation, note
 * summarization) goes through the same llm-bridge the pi agent itself uses.
 */
import { emit } from "./bus.ts";
import { BRIDGE_URL } from "./store.ts";

const LLM_MODEL = process.env.PI_MODEL_ID ?? "kimi-k2.5";

/**
 * Bridge endpoint, read at CALL time (not module-load time): tests and
 * embedders may redirect PI_BRIDGE_URL after this module first loaded —
 * the store's BRIDGE_URL const is the fallback default, matching the
 * pre-existing process-wide behavior.
 */
function bridgeUrl(): string {
        return process.env.PI_BRIDGE_URL ?? BRIDGE_URL;
}

export interface ChatMsg {
        role: "system" | "user" | "assistant";
        content: string;
}

export interface LlmTool {
        type: "function";
        function: { name: string; description?: string; parameters?: unknown };
}

export async function chat(
        messages: ChatMsg[],
        opts: { tools?: LlmTool[]; toolChoice?: unknown; maxTokens?: number; timeoutMs?: number } = {},
): Promise<any> {
        const attempt = async (): Promise<any> => {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 240_000);
                try {
                        const res = await fetch(`${bridgeUrl()}/v1/chat/completions`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                        model: LLM_MODEL,
                                        messages,
                                        tools: opts.tools,
                                        tool_choice: opts.toolChoice,
                                        max_tokens: opts.maxTokens ?? 4096,
                                        stream: false,
                                        thinking: { type: "disabled" },
                                }),
                                signal: ctrl.signal,
                        });
                        if (!res.ok) {
                                const text = await res.text().catch(() => "");
                                throw new Error(`llm-bridge ${res.status}: ${text.slice(0, 400)}`);
                        }
                        return await res.json();
                } finally {
                        clearTimeout(timer);
                }
        };
        // bridge already retries 429s; this is a safety net for transient network resets
        for (let i = 0; i < 3; i++) {
                try {
                        return await attempt();
                } catch (err: any) {
                        const msg = String(err?.message ?? err);
                        if (i === 2 || !/abort|network|socket|ECONN|fetch failed|timeout/i.test(msg)) throw err;
                        await Bun.sleep(2000 * (i + 1));
                }
        }
        throw new Error("unreachable");
}

/**
 * Response texts of one completion, in priority order: the visible content,
 * then reasoning_content. The bridge passes upstream replies through
 * verbatim, and reasoning-capable models (kimi/qwen thinking) can leave
 * message.content empty while the whole answer lives in
 * message.reasoning_content — without the fallback the JSON is lost there.
 */
function completionTexts(completion: any): string[] {
        const message = completion?.choices?.[0]?.message;
        const texts: string[] = [];
        if (typeof message?.content === "string" && message.content.length > 0) texts.push(message.content);
        if (typeof message?.reasoning_content === "string" && message.reasoning_content.length > 0) {
                texts.push(message.reasoning_content);
        }
        return texts;
}

export async function chatText(
        messages: ChatMsg[],
        opts: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<string> {
        const completion = await chat(messages, opts);
        const texts = completionTexts(completion);
        if (texts.length === 0) throw new Error("llm: empty completion");
        return texts[0];
}

/**
 * First top-level balanced {...} span in text, scanned with string/escape
 * awareness so a '}' inside a string literal cannot fake the closing brace
 * (the old first-'{'-to-last-'}' slice corrupted on both). Returns null when
 * no balanced object exists: prose only, a refusal, or output truncated
 * before the first object could close (maxTokens cutoff).
 */
function firstBalancedObject(text: string): string | null {
        let start = -1;
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = 0; i < text.length; i++) {
                const ch = text[i];
                if (inString) {
                        if (escaped) escaped = false;
                        else if (ch === "\\") escaped = true;
                        else if (ch === '"') inString = false;
                        continue;
                }
                if (ch === '"') inString = true;
                else if (ch === "{") {
                        if (depth === 0) start = i;
                        depth++;
                } else if (ch === "}" && depth > 0 && --depth === 0) {
                        return text.slice(start, i + 1);
                }
        }
        return null;
}

/**
 * Extract a JSON object from a model response (tolerates code fences / prose).
 *
 * Candidates are tried in order: the first fenced ```json block (the fence
 * regex needs a closing ```), then the raw text — so a fence that swallowed
 * or truncated the JSON still falls through to the prose. Within a candidate
 * the first balanced {...} span wins; a span that exists but does not parse
 * surfaces the raw JSON.parse SyntaxError, and no span at all throws the
 * module's own "no JSON object found" error.
 */
export function extractJson<T = any>(text: string): T {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        const candidates = fenced ? [fenced[1], text] : [text];
        let parseError: SyntaxError | undefined;
        for (const candidate of candidates) {
                const span = firstBalancedObject(candidate);
                if (span === null) continue;
                try {
                        return JSON.parse(span) as T;
                } catch (err) {
                        parseError = err as SyntaxError; // keep trying the next candidate
                }
        }
        if (parseError) throw parseError;
        throw new Error("llm: no JSON object found in response");
}

/** Corrective nudge for chatJson's single retry (prose / refusal / truncation). */
const JSON_ONLY_NUDGE =
        "Respond with ONLY a valid JSON object — no prose before or after it, no code fences, no explanation. Output the complete object.";

/** Extend the system message with the JSON-only nudge (prepend one when absent). */
function withJsonOnlyNudge(messages: ChatMsg[]): ChatMsg[] {
        if (messages[0]?.role === "system") {
                return [{ role: "system", content: `${messages[0].content}\n\n${JSON_ONLY_NUDGE}` }, ...messages.slice(1)];
        }
        return [{ role: "system", content: JSON_ONLY_NUDGE }, ...messages];
}

/** First successful extractJson over the candidate texts, else the last error. */
function jsonFromTexts<T>(texts: string[]): { ok: true; value: T } | { ok: false; error: unknown } {
        let error: unknown = new Error("llm: empty completion");
        for (const text of texts) {
                try {
                        return { ok: true, value: extractJson<T>(text) };
                } catch (err) {
                        error = err;
                }
        }
        return { ok: false, error };
}

export async function chatJson<T = any>(
        messages: ChatMsg[],
        opts: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<T> {
        const firstTexts = completionTexts(await chat(messages, opts));
        const first = jsonFromTexts<T>(firstTexts);
        if (first.ok) return first.value;

        // ONE corrective retry: the first response yielded no parseable JSON
        // (prose, a refusal, truncation, or reasoning-only content). The retry
        // re-asks with the JSON-only nudge on the system message; the extra
        // call is observable on the bus (SSE stream + router event jobs).
        emit("llm:json-retry", {
                model: LLM_MODEL,
                reason: String((first.error as Error)?.message ?? first.error),
                preview: firstTexts[0]?.slice(0, 240),
        });

        const retry = jsonFromTexts<T>(completionTexts(await chat(withJsonOnlyNudge(messages), opts)));
        if (retry.ok) return retry.value;
        throw retry.error;
}

export async function bridgeHealth(): Promise<any> {
        try {
                const res = await fetch(`${bridgeUrl()}/health`, { signal: AbortSignal.timeout(3000) });
                return await res.json();
        } catch {
                return { ok: false };
        }
}

export async function bridgeLog(): Promise<any> {
        try {
                const res = await fetch(`${bridgeUrl()}/v1/log`, { signal: AbortSignal.timeout(3000) });
                return await res.json();
        } catch {
                return { log: [], requests: 0, errors: 0 };
        }
}
