/**
 * llm.ts — thin LLM client for the self-learning layer.
 *
 * All learning-layer intelligence (failure mining, dream consolidation, note
 * summarization) goes through the same llm-bridge the pi agent itself uses.
 */
import { BRIDGE_URL } from "./store.ts";

export interface ChatMsg {
        role: "system" | "user" | "assistant";
        content: string;
}

export interface LlmTool {
        type: "function";
        function: { name: string; description?: string; parameters?: unknown };
}

export async function chat(messages: ChatMsg[], opts: { tools?: LlmTool[]; toolChoice?: unknown; maxTokens?: number; timeoutMs?: number } = {}): Promise<any> {
        const attempt = async (): Promise<any> => {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 240_000);
                try {
                        const res = await fetch(`${BRIDGE_URL}/v1/chat/completions`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                        model: "glm-4-plus",
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

export async function chatText(messages: ChatMsg[], opts: { maxTokens?: number; timeoutMs?: number } = {}): Promise<string> {
        const completion = await chat(messages, opts);
        const text = completion?.choices?.[0]?.message?.content;
        if (typeof text !== "string" || text.length === 0) throw new Error("llm: empty completion");
        return text;
}

/** Extract a JSON object from a model response (tolerates code fences / prose). */
export function extractJson<T = any>(text: string): T {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        const candidate = fenced ? fenced[1] : text;
        const start = candidate.indexOf("{");
        const end = candidate.lastIndexOf("}");
        if (start === -1 || end === -1 || end <= start) throw new Error("llm: no JSON object found in response");
        return JSON.parse(candidate.slice(start, end + 1)) as T;
}

export async function chatJson<T = any>(messages: ChatMsg[], opts: { maxTokens?: number; timeoutMs?: number } = {}): Promise<T> {
        const text = await chatText(messages, opts);
        return extractJson<T>(text);
}

export async function bridgeHealth(): Promise<any> {
        try {
                const res = await fetch(`${BRIDGE_URL}/health`, { signal: AbortSignal.timeout(3000) });
                return await res.json();
        } catch {
                return { ok: false };
        }
}

export async function bridgeLog(): Promise<any> {
        try {
                const res = await fetch(`${BRIDGE_URL}/v1/log`, { signal: AbortSignal.timeout(3000) });
                return await res.json();
        } catch {
                return { log: [], requests: 0, errors: 0 };
        }
}
