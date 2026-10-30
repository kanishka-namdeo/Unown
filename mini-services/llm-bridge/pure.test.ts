// Unit tests for mini-services/llm-bridge/pure.ts (extracted from index.ts).
//
// Backlog reference: docs/testing-strategy.md §4.4 — the bridge had "no unit
// tests"; the pure logic (routeModel, buildUpstreamBody/thinking resolution,
// sanitizeToolCalls, completionStats/SSE stats, retryability classification,
// backoff + spacing math) was inline in the serving module. It now lives in
// pure.ts, parameterized over config/inputs so it can be tested without
// process.env or the network.
//
// These tests run on `bun test` (bun:test is built in — zero new deps).
//
// A few assertions below pin down *quirks* rather than ideal behavior; each is
// marked with a `QUIRK`/`BUG` comment. They document current behavior so a
// future fix is a deliberate, visible change — behavior was extracted 1:1
// from index.ts and is NOT modified here.

import { describe, expect, test } from "bun:test";

import {
        BACKOFF_BASE_MS,
        BACKOFF_CAP_MS,
        BACKOFF_JITTER_MS,
        MAX_ATTEMPTS,
        backoffDelayMs,
        buildUpstreamBody,
        completionStats,
        foldSseLine,
        sseFrameSignalsContent,
        isDegenerateCompletion,
        isRetryableError,
        isFailoverError,
        loadConfig,
        coherentKnownModels,
        parseModelCatalog,
        mergeCatalogIntoKnown,
        routeModel,
        routeRequest,
        isLocalModel,
        withLocalThinkingCompat,
        sanitizeToolCalls,
        sanitizeMessages,
        laneForRequest,
        spacingWaitMs,
        upstreamTimeoutMs,
        parseCatalogEntrySpecs,
        extractCatalogSpecs,
        parseContextLimitError,
        type SseStats,
} from "./pure";

const KNOWN = ["kimi-k2.5", "qwen3.7-plus", "qwen3.6-plus"];
const ROUTE_DEFAULT = "kimi-k2.5";
const DEFAULT_MODEL = "kimi-k2.5";

function freshStats(): SseStats {
        return { finishReason: null, contentChars: 0, toolCalls: 0, promptTokens: 0, completionTokens: 0 };
}

function foldFrames(lines: string[], initial?: Partial<SseStats>): SseStats {
        const stats: SseStats = { ...freshStats(), ...initial };
        for (const line of lines) foldSseLine(line, stats);
        return stats;
}

// ---------------------------------------------------------------------------
// routeModel
// ---------------------------------------------------------------------------

describe("routeModel", () => {
        test("allow-listed ids pass through unchanged", () => {
                for (const id of KNOWN) {
                        expect(routeModel(id, KNOWN, ROUTE_DEFAULT, DEFAULT_MODEL)).toEqual({ upstream: id, requested: id });
                }
        });

        test("unknown / legacy ids are routed to the route default", () => {
                expect(routeModel("glm-4-plus", KNOWN, ROUTE_DEFAULT, DEFAULT_MODEL)).toEqual({
                        upstream: "kimi-k2.5",
                        requested: "glm-4-plus",
                });
                expect(routeModel("gpt-4o", KNOWN, ROUTE_DEFAULT, DEFAULT_MODEL)).toEqual({
                        upstream: "kimi-k2.5",
                        requested: "gpt-4o",
                });
        });

        test("missing / non-string model falls back to the advertised default model", () => {
                for (const requested of [undefined, null, 42, {}, "", "   "]) {
                        expect(routeModel(requested, KNOWN, ROUTE_DEFAULT, DEFAULT_MODEL)).toEqual({
                                upstream: DEFAULT_MODEL,
                                requested: DEFAULT_MODEL,
                        });
                }
        });

        // QUIRK: the allow-list match is case-sensitive — "Kimi-K2.5" is treated as
        // an unknown model and silently re-routed. No warning, no error.
        test("case sensitivity: differently-cased ids are NOT matched", () => {
                for (const id of ["KIMI-K2.5", "Kimi-k2.5", "QWEN3.7-PLUS"]) {
                        expect(routeModel(id, KNOWN, ROUTE_DEFAULT, DEFAULT_MODEL).upstream).toBe(ROUTE_DEFAULT);
                }
        });

        // QUIRK: requested ids are trimmed before matching AND the trimmed string
        // is echoed back as `requested` (so the log shows the trimmed id).
        test("whitespace is trimmed before matching", () => {
                expect(routeModel("  kimi-k2.5  ", KNOWN, ROUTE_DEFAULT, DEFAULT_MODEL)).toEqual({
                        upstream: "kimi-k2.5",
                        requested: "kimi-k2.5",
                });
        });

        // QUIRK: the default model itself is subject to the allow-list — if
        // BRIDGE_MODEL names a non-allow-listed model, modelless requests are
        // routed to the route default.
        test("default model not on the allow-list gets re-routed", () => {
                expect(routeModel(undefined, KNOWN, ROUTE_DEFAULT, "glm-4-plus")).toEqual({
                        upstream: ROUTE_DEFAULT,
                        requested: "glm-4-plus",
                });
        });

        // QUIRK: the route default is trusted as-is, never re-validated against
        // the allow-list (no recursion, no fallback).
        test("route default is not re-validated against the allow-list", () => {
                expect(routeModel("whatever", KNOWN, "glm-4-plus", DEFAULT_MODEL).upstream).toBe("glm-4-plus");
        });
});

// ---------------------------------------------------------------------------
// sanitizeToolCalls
// ---------------------------------------------------------------------------

describe("sanitizeToolCalls", () => {
        test("undefined -> undefined", () => {
                expect(sanitizeToolCalls(undefined)).toBeUndefined();
        });

        // QUIRK: any non-array input (object, string, null) collapses to undefined
        // rather than being passed through or throwing.
        test("non-array input -> undefined", () => {
                expect(sanitizeToolCalls(null)).toBeUndefined();
                expect(sanitizeToolCalls({ id: "x" } as any)).toBeUndefined();
                expect(sanitizeToolCalls("nope" as any)).toBeUndefined();
        });

        test("normal tool calls pass through with values untouched", () => {
                const input = [
                        {
                                id: "call_abc",
                                type: "function" as const,
                                function: { name: "read", arguments: '{"path":"/tmp/a.txt"}' },
                        },
                ];
                expect(sanitizeToolCalls(input)).toEqual(input);
        });

        test("unwraps double-wrapped arguments:{name,arguments}", () => {
                const fixed = sanitizeToolCalls([
                        {
                                id: "call_1",
                                type: "function" as const,
                                function: { name: "read", arguments: '{"name":"read","arguments":{"path":"/tmp/a.txt"}}' },
                        },
                ]);
                expect(fixed?.[0].function.arguments).toBe('{"path":"/tmp/a.txt"}');
                // the outer function.name is preserved; only arguments is rewritten
                expect(fixed?.[0].function.name).toBe("read");
        });

        test("partial JSON arguments are left as-is", () => {
                const args = '{"name":"read","argum';
                expect(sanitizeToolCalls([{ id: "c", type: "function", function: { name: "read", arguments: args } }])?.[0].function.arguments).toBe(args);
        });

        // QUIRK: the unwrap shape-check requires parsed.name to be a STRING and
        // parsed.arguments to be an OBJECT. {"name":123,"arguments":{...}} or
        // {"name":"x","arguments":"..."} are passed through untouched.
        test("double-wrap detection requires string name + object arguments", () => {
                const notObj = '{"name":"read","arguments":"{\\"path\\":\\"/tmp\\"}"}';
                const notStr = '{"name":123,"arguments":{"path":"/tmp"}}';
                expect(sanitizeToolCalls([{ id: "c", type: "function", function: { name: "read", arguments: notObj } }])?.[0].function.arguments).toBe(notObj);
                expect(sanitizeToolCalls([{ id: "c", type: "function", function: { name: "read", arguments: notStr } }])?.[0].function.arguments).toBe(notStr);
        });

        test("missing ids are synthesized as call_<index>", () => {
                const fixed = sanitizeToolCalls([
                        { type: "function", function: { name: "a", arguments: "{}" } },
                        { type: "function", function: { name: "b", arguments: "{}" } },
                ]);
                expect(fixed?.map((tc) => tc.id)).toEqual(["call_0", "call_1"]);
        });

        test("missing name -> empty string; missing/undefined arguments -> {}", () => {
                const fixed = sanitizeToolCalls([{ id: "x", function: {} }]);
                expect(fixed?.[0].function.name).toBe("");
                expect(fixed?.[0].function.arguments).toBe("{}");
        });

        // QUIRK: the output shape is normalized — extra fields on the input tool
        // call (e.g. OpenAI's streaming `index`) are DROPPED, and arguments that
        // are not strings (already-object arguments) fall through the `?? "{}"`
        // only when nullish: an object arguments value is copied verbatim.
        test("extra fields are dropped (normalized shape)", () => {
                const fixed = sanitizeToolCalls([
                        { id: "x", type: "function", index: 3, function: { name: "read", arguments: '{"a":1}' } } as any,
                ]);
                expect(Object.keys(fixed?.[0] ?? {}).sort()).toEqual(["function", "id", "type"]);
                expect((fixed?.[0] as any).index).toBeUndefined();
        });

        // QUIRK: object-typed arguments (already parsed by a client) are copied
        // verbatim rather than re-serialized — downstream sees a non-string.
        test("object arguments are copied verbatim (not stringified)", () => {
                const fixed = sanitizeToolCalls([{ id: "x", type: "function", function: { name: "read", arguments: { a: 1 } } } as any]);
                expect(fixed?.[0].function.arguments).toEqual({ a: 1 });
        });
});

// ---------------------------------------------------------------------------
// buildUpstreamBody (incl. thinking resolution precedence)
// ---------------------------------------------------------------------------

describe("sanitizeMessages (the stress round's 400-wedge repair)", () => {
        test("passes a healthy history through verbatim", () => {
                const history = [
                        { role: "system", content: "sys" },
                        { role: "user", content: "hi" },
                        { role: "assistant", content: "hello", tool_calls: [{ id: "call_1", type: "function", function: { name: "browser", arguments: "{}" } }] },
                        { role: "tool", tool_call_id: "call_1", content: "ok" },
                ];
                const r = sanitizeMessages(history);
                expect(r.messages).toEqual(history);
                expect(r.repairs).toBe(0);
                expect(r.dropped).toBe(0);
        });

        test("drops tool messages without tool_call_id (the live 400: 'missing field tool_call_id')", () => {
                const history = [
                        { role: "user", content: "hi" },
                        { role: "tool", content: "orphan result" },
                ];
                const r = sanitizeMessages(history);
                expect(r.messages).toHaveLength(1);
                expect(r.dropped).toBe(1);
        });

        test("drops tool messages orphaned from any assistant tool_call", () => {
                const history = [
                        { role: "user", content: "hi" },
                        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "browser", arguments: "{}" } }] },
                        { role: "tool", tool_call_id: "call_9", content: "orphan" },
                        { role: "tool", tool_call_id: "call_1", content: "kept" },
                ];
                const r = sanitizeMessages(history);
                expect(r.messages.map((m: any) => m.content)).toEqual(["hi", null, "kept"]);
                expect(r.dropped).toBe(1);
        });

        test("id-fills assistant tool_calls and drops emptied assistant shells", () => {
                const history = [
                        { role: "user", content: "hi" },
                        { role: "assistant", content: null, tool_calls: [{ type: "function", function: { name: "browser", arguments: "{}" } }] },
                        { role: "assistant", content: null, tool_calls: [] },
                        { role: "assistant", content: "done" },
                ];
                const r = sanitizeMessages(history);
                expect(r.messages).toHaveLength(3);
                const repaired = r.messages[1];
                expect(Array.isArray(repaired.tool_calls)).toBe(true);
                expect(repaired.tool_calls[0].id).toMatch(/^call_/);
                expect(r.messages[2].content).toBe("done");
        });

        test("non-array input answers an empty list, never a crash", () => {
                const r = sanitizeMessages(undefined);
                expect(r.messages).toEqual([]);
                expect(r.dropped).toBe(0);
        });
});

describe("buildUpstreamBody", () => {
        test("qwen models get thinking disabled by default", () => {
                const out = buildUpstreamBody({ messages: [] }, "qwen3.7-plus", false);
                expect(out.enable_thinking).toBe(false);
        });

        test("qwen models keep thinking when the qwenThinking flag is on", () => {
                const out = buildUpstreamBody({ messages: [] }, "qwen3.7-plus", true);
                expect(out.enable_thinking).toBe(true);
        });

        test("kimi receives NO thinking override (model default), whatever the flag", () => {
                for (const flag of [false, true]) {
                        const out = buildUpstreamBody({ messages: [] }, "kimi-k2.5", flag);
                        expect("enable_thinking" in out).toBe(false);
                }
        });

        // QUIRK: the z-ai style `thinking` translation is qwen-only — for kimi the
        // param is silently dropped (no error, no override).
        test("z-ai thinking translation is dropped for kimi", () => {
                const out = buildUpstreamBody({ messages: [], thinking: { type: "enabled" } }, "kimi-k2.5", false);
                expect("enable_thinking" in out).toBe(false);
        });

        // QUIRK (same family): an explicit `enable_thinking` from the client is
        // ALSO dropped for non-qwen models.
        test("explicit enable_thinking is dropped for kimi", () => {
                const out = buildUpstreamBody({ messages: [], enable_thinking: true }, "kimi-k2.5", false);
                expect("enable_thinking" in out).toBe(false);
        });

        test("z-ai thinking {type:'disabled'} -> enable_thinking:false on qwen", () => {
                expect(buildUpstreamBody({ messages: [], thinking: { type: "disabled" } }, "qwen3.6-plus", true).enable_thinking).toBe(false);
        });

        test("z-ai thinking {type:'enabled'} -> enable_thinking:true on qwen", () => {
                expect(buildUpstreamBody({ messages: [], thinking: { type: "enabled" } }, "qwen3.6-plus", false).enable_thinking).toBe(true);
        });

        // QUIRK: only "enabled"/"disabled" are recognized; other thinking types
        // (e.g. "deep_thinking") fall through to the qwen default.
        test("unrecognized thinking types fall through to the qwen default", () => {
                expect(buildUpstreamBody({ messages: [], thinking: { type: "deep_thinking" } }, "qwen3.7-plus", false).enable_thinking).toBe(false);
                expect(buildUpstreamBody({ messages: [], thinking: { type: "deep_thinking" } }, "qwen3.7-plus", true).enable_thinking).toBe(true);
        });

        // BUG (precedence inverted vs. docs): testing-strategy §4.4 and the
        // in-code comment state "explicit client enable_thinking wins", but the
        // code applies the `thinking:{type}` translation AFTER reading
        // body.enable_thinking — so the z-ai param OVERRIDES the explicit flag.
        // Pinned as-is; fixing it is a deliberate behavior change.
        test("PIN: thinking:{type} overrides an explicit enable_thinking", () => {
                expect(buildUpstreamBody({ messages: [], enable_thinking: true, thinking: { type: "disabled" } }, "qwen3.7-plus", true).enable_thinking).toBe(false);
                expect(buildUpstreamBody({ messages: [], enable_thinking: false, thinking: { type: "enabled" } }, "qwen3.7-plus", false).enable_thinking).toBe(true);
        });

        test("explicit enable_thinking beats the qwen default when no thinking param is set", () => {
                expect(buildUpstreamBody({ messages: [], enable_thinking: true }, "qwen3.7-plus", false).enable_thinking).toBe(true);
                expect(buildUpstreamBody({ messages: [], enable_thinking: false }, "qwen3.7-plus", true).enable_thinking).toBe(false);
        });

        test("max_tokens is preserved", () => {
                expect(buildUpstreamBody({ messages: [], max_tokens: 123 }, "kimi-k2.5", false).max_tokens).toBe(123);
        });

        // QUIRK: the newer `max_completion_tokens` alias is folded into
        // `max_tokens` for the upstream; when BOTH are set, max_tokens wins.
        test("max_completion_tokens maps to max_tokens (alias)", () => {
                expect(buildUpstreamBody({ messages: [], max_completion_tokens: 77 }, "kimi-k2.5", false).max_tokens).toBe(77);
                expect(buildUpstreamBody({ messages: [], max_tokens: 1, max_completion_tokens: 77 }, "kimi-k2.5", false).max_tokens).toBe(1);
        });

        test("sampling params pass through verbatim", () => {
                const out = buildUpstreamBody(
                        {
                                messages: [],
                                temperature: 0.2,
                                top_p: 0.9,
                                stop: ["\n"],
                                presence_penalty: 0.1,
                                frequency_penalty: 0.2,
                                response_format: { type: "json_object" },
                                parallel_tool_calls: false,
                                seed: 42,
                                user: "u1",
                                n: 2,
                        },
                        "kimi-k2.5",
                        false,
                );
                expect(out).toEqual({
                        model: "kimi-k2.5",
                        messages: [],
                        temperature: 0.2,
                        top_p: 0.9,
                        stop: ["\n"],
                        presence_penalty: 0.1,
                        frequency_penalty: 0.2,
                        response_format: { type: "json_object" },
                        parallel_tool_calls: false,
                        seed: 42,
                        user: "u1",
                        n: 2,
                });
        });

        // QUIRK: an EMPTY tools array is dropped entirely (length > 0 check), so
        // "no tools" and "tools: []" produce the same upstream body.
        test("empty tools array is omitted", () => {
                expect("tools" in buildUpstreamBody({ messages: [], tools: [] }, "kimi-k2.5", false)).toBe(false);
        });

        test("tools / tool_choice / stream / stream_options pass through", () => {
                const tools = [{ type: "function", function: { name: "read", parameters: { type: "object" } } }];
                const out = buildUpstreamBody(
                        { messages: [], tools, tool_choice: "auto", stream: true, stream_options: { include_usage: true } },
                        "kimi-k2.5",
                        false,
                );
                expect(out.tools).toBe(tools);
                expect(out.tool_choice).toBe("auto");
                expect(out.stream).toBe(true);
                expect(out.stream_options).toEqual({ include_usage: true });
        });

        test("tool-role messages and image_url content parts pass through verbatim", () => {
                const messages = [
                        { role: "system", content: "You are helpful." },
                        { role: "user", content: "look" },
                        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "look", arguments: '{"q":"x"}' } }] },
                        { role: "tool", tool_call_id: "call_1", name: "look", content: "result text" },
                        {
                                role: "user",
                                content: [
                                        { type: "text", text: "what is in this image?" },
                                        { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
                                ],
                        },
                ];
                const out = buildUpstreamBody({ messages }, "qwen3.7-plus", false);
                expect(out.messages).toEqual(messages);
        });

        test("missing messages becomes an empty array", () => {
                expect(buildUpstreamBody({}, "kimi-k2.5", false).messages).toEqual([]);
        });

        // QUIRK: request shaping is an allow-list — unknown body keys (and the
        // translated-away thinking params) are silently dropped, never forwarded.
        test("unknown request keys are dropped", () => {
                const out = buildUpstreamBody({ messages: [], foo: "bar", metadata: { x: 1 }, thinking: { type: "disabled" } }, "kimi-k2.5", false);
                expect(Object.keys(out).sort()).toEqual(["messages", "model"]);
        });
});

// ---------------------------------------------------------------------------
// completionStats (non-stream completions)
// ---------------------------------------------------------------------------

describe("completionStats", () => {
        const golden = {
                id: "chatcmpl-abc",
                object: "chat.completion",
                choices: [
                        {
                                index: 0,
                                finish_reason: "stop",
                                message: { role: "assistant", content: "Hello, world!" },
                        },
                ],
                usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
        };

        test("extracts finish_reason, content chars and usage from a golden completion", () => {
                expect(completionStats(golden)).toEqual({
                        finishReason: "stop",
                        contentChars: 13,
                        toolCalls: 0,
                        promptTokens: 12,
                        completionTokens: 34,
                });
        });

        test("empty / malformed completions yield zeroed stats (no throw)", () => {
                const zero = { finishReason: null, contentChars: 0, toolCalls: 0, promptTokens: 0, completionTokens: 0 };
                expect(completionStats(undefined)).toEqual(zero);
                expect(completionStats({})).toEqual(zero);
                expect(completionStats({ choices: [] })).toEqual(zero);
                expect(completionStats({ choices: [{}] })).toEqual(zero);
        });

        test("missing usage counts as 0 tokens", () => {
                const stats = completionStats({ choices: [{ finish_reason: "length", message: { role: "assistant", content: "hi" } }] });
                expect(stats).toEqual({ finishReason: "length", contentChars: 2, toolCalls: 0, promptTokens: 0, completionTokens: 0 });
        });

        // QUIRK: only STRING content counts — assistant messages with array
        // content (vision-style parts) report contentChars 0.
        test("non-string content reports 0 content chars", () => {
                const stats = completionStats({
                        choices: [{ finish_reason: "stop", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } }],
                });
                expect(stats.contentChars).toBe(0);
        });

        // QUIRK: completionStats MUTATES its input — tool_calls on the assistant
        // message are replaced with sanitized copies. Load-bearing: index.ts
        // serializes the SAME object to the client, so the client receives the
        // unwrapped arguments.
        test("tool calls are counted AND sanitized in place (mutation is load-bearing)", () => {
                const completion = {
                        choices: [
                                {
                                        finish_reason: "tool_calls",
                                        message: {
                                                role: "assistant",
                                                content: null,
                                                tool_calls: [
                                                        {
                                                                id: "call_1",
                                                                type: "function",
                                                                function: { name: "read", arguments: '{"name":"read","arguments":{"path":"/tmp/a"}}' },
                                                        },
                                                ],
                                        },
                                },
                        ],
                        usage: { prompt_tokens: 100, completion_tokens: 7 },
                };
                const stats = completionStats(completion);
                expect(stats).toEqual({
                        finishReason: "tool_calls",
                        contentChars: 0,
                        toolCalls: 1,
                        promptTokens: 100,
                        completionTokens: 7,
                });
                expect(completion.choices[0].message.tool_calls?.[0].function.arguments).toBe('{"path":"/tmp/a"}');
        });

        test("non-array tool_calls are ignored without mutation", () => {
                const completion = { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "hi", tool_calls: null } }] };
                expect(completionStats(completion).toolCalls).toBe(0);
                expect(completion.choices[0].message.tool_calls).toBe(null);
        });

        // usage tracking: OpenAI-style usage.prompt_tokens_details.cached_tokens
        // feeds the persistent usage log (mini-services/llm-bridge/usage.ts).
        test("prompt_tokens_details.cached_tokens is captured when reported", () => {
                const stats = completionStats({
                        choices: [{ finish_reason: "stop", message: { role: "assistant", content: "hi" } }],
                        usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 40 } },
                });
                expect(stats.cachedTokens).toBe(40);
                expect(stats.promptTokens).toBe(100);
        });

        // The key stays ABSENT (not 0/undefined) when the upstream does not
        // report it — the exact toEqual shapes above stay stable.
        test("no prompt_tokens_details → no cachedTokens key", () => {
                const stats = completionStats({ choices: [{ finish_reason: "stop", message: { content: "hi" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
                expect("cachedTokens" in stats).toBe(false);
        });
});

// ---------------------------------------------------------------------------
// foldSseLine (streamed stats — the pipe's peek into SSE frames)
// ---------------------------------------------------------------------------

describe("foldSseLine", () => {
        // Golden Dashscope/OpenAI-style stream: role delta, content deltas,
        // finish_reason, a usage chunk (stream_options.include_usage), [DONE].
        const goldenStream = [
                'data: {"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
                "",
                ': keep-alive comment',
                'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
                'data: {"id":"c1","choices":[{"index":0,"delta":{"content":", world!"},"finish_reason":null}]}',
                'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
                'data: {"id":"c1","choices":[{"index":0,"delta":{}}],"usage":{"prompt_tokens":9,"completion_tokens":12,"total_tokens":21}}',
                "data: [DONE]",
        ];

        test("golden stream: content chars, finish_reason, usage; [DONE] skipped", () => {
                expect(foldFrames(goldenStream)).toEqual({
                        finishReason: "stop",
                        contentChars: 13, // "Hello" + ", world!"
                        toolCalls: 0,
                        promptTokens: 9,
                        completionTokens: 12,
                });
        });

        test("tool-call deltas are recognized", () => {
                const stats = foldFrames([
                        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"read","arguments":""}}]}}]}',
                        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
                        "data: [DONE]",
                ]);
                expect(stats.toolCalls).toBe(1);
                expect(stats.finishReason).toBe("tool_calls");
        });

        // QUIRK: streamed toolCalls counts the MAX number of tool-call deltas in
        // a SINGLE chunk (Math.max per frame), not the accumulated distinct
        // calls. Two sequential deltas each carrying one call report 1 — the
        // non-stream path (completionStats) reports the true total (2).
        test("PIN: toolCalls is max-per-delta, not the accumulated total", () => {
                const stats = foldFrames([
                        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"a","type":"function","function":{"name":"read","arguments":"{}"}}]}}]}',
                        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"b","type":"function","function":{"name":"write","arguments":"{}"}}]}}]}',
                        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
                ]);
                expect(stats.toolCalls).toBe(1);
        });

        test("partial JSON frames and non-data lines are ignored (no throw)", () => {
                const stats = foldFrames([
                        'data: {"choices":[{"index":0,"delta":{"cont',
                        "event: ping",
                        ": comment",
                        "",
                        "notdata at all",
                        "data: not json",
                ]);
                expect(stats).toEqual(freshStats());
        });

        test("[DONE] is detected with or without a space after the colon", () => {
                for (const line of ["data: [DONE]", "data:[DONE]", "data:   [DONE]"]) {
                        expect(foldFrames([line])).toEqual(freshStats());
                }
        });

        // QUIRK: foldSseLine expects pre-trimmed lines (the pipe trims before
        // folding). A line with LEADING whitespace is not recognized as data and
        // silently ignored — unreachable via the pipe, pinned for the contract.
        test("leading whitespace breaks data: detection (expects trimmed lines)", () => {
                expect(foldFrames(['   data: {"choices":[{"delta":{"content":"x"}}]}'])).toEqual(freshStats());
        });

        test("null finish_reason never clears an earlier value", () => {
                const stats = foldFrames([
                        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
                        'data: {"choices":[{"index":0,"delta":{},"finish_reason":null}]}',
                ]);
                expect(stats.finishReason).toBe("stop");
        });

        test("usage chunks with missing fields keep previous counts", () => {
                const stats = foldFrames([
                        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":6}}',
                        'data: {"choices":[],"usage":{"prompt_tokens":7}}',
                ]);
                expect(stats.promptTokens).toBe(7);
                expect(stats.completionTokens).toBe(6);
        });

        test("non-string content deltas are ignored", () => {
                const stats = foldFrames([
                        'data: {"choices":[{"delta":{"content":null}}]}',
                        'data: {"choices":[{"delta":{"content":123}}]}',
                        'data: {"choices":[{"delta":{"role":"assistant"}}]}',
                ]);
                expect(stats.contentChars).toBe(0);
        });

        // usage tracking: a usage chunk carrying cached input tokens folds into
        // the sink (feeds the persistent usage log via the pipe).
        test("cached_tokens in a usage chunk is folded", () => {
                const stats = foldFrames([
                        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":50,"completion_tokens":5}}',
                        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":50,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":12}}}',
                ]);
                expect(stats.cachedTokens).toBe(12);
        });

        test("usage chunks without prompt_tokens_details leave cachedTokens untouched", () => {
                const stats = foldFrames(['data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":6}}']);
                expect("cachedTokens" in stats).toBe(false);
        });
});

// ---------------------------------------------------------------------------
// Retryability classification
// ---------------------------------------------------------------------------

describe("isRetryableError", () => {
        const withStatus = (status: number, msg = `upstream ${status}: boom`) => Object.assign(new Error(msg), { status });

        test("429 and 5xx are retryable", () => {
                for (const status of [429, 500, 502, 503, 504, 529]) {
                        expect(isRetryableError(withStatus(status))).toBe(true);
                }
        });

        test("400 / 401 / 403 / 404 / 422 are NOT retryable", () => {
                for (const status of [400, 401, 403, 404, 409, 422]) {
                        expect(isRetryableError(withStatus(status))).toBe(false);
                }
        });

        test("network / timeout / terminated messages are retryable without a status", () => {
                for (const msg of [
                        "fetch failed",
                        "network error",
                        "socket hang up",
                        "ECONNRESET",
                        "upstream timeout: no response headers after 180000ms",
                        "terminated",
                        "Too Many Requests",
                        "rate limit hit",
                ]) {
                        expect(isRetryableError(new Error(msg))).toBe(true);
                }
        });

        test("plain upstream failures without keywords are not retryable", () => {
                for (const msg of ["upstream 400: bad request", "unauthorized", "invalid api key", "model not found"]) {
                        expect(isRetryableError(new Error(msg))).toBe(false);
                }
        });

        // QUIRK: the message regex can override a non-retryable status — a 400
        // whose body text mentions "rate limit" (or contains "429") is retried.
        test("PIN: message keywords can make a 4xx retryable", () => {
                expect(isRetryableError(withStatus(400, "upstream 400: rate limit exceeded for tier"))).toBe(true);
                expect(isRetryableError(withStatus(400, "upstream 400: plan 429'd"))).toBe(true);
        });

        // QUIRK: a 3xx status is not covered by either branch (not 429, not >=500).
        test("3xx statuses are not retryable", () => {
                expect(isRetryableError(withStatus(302))).toBe(false);
        });

        // QUIRK: only NUMERIC statuses count — a string status "429" fails both
        // the === 429 and the >= 500 checks and relies on the message regex.
        test("string-typed status is not honored (falls back to message text)", () => {
                expect(isRetryableError(Object.assign(new Error("quota exceeded"), { status: "429" }))).toBe(false);
        });

        test("undefined / null errors do not throw", () => {
                expect(isRetryableError(undefined)).toBe(false);
                expect(isRetryableError(null)).toBe(false);
        });

        test("an abort without timeout keywords is not auto-retryable", () => {
                // Bun's default abort reason message — client disconnects must not
                // burn retries; the bridge's own timeout reason says "upstream timeout".
                expect(isRetryableError(new Error("This operation was aborted"))).toBe(false);
        });
});

// ---------------------------------------------------------------------------
// Backoff / spacing math
// ---------------------------------------------------------------------------

describe("backoffDelayMs", () => {
        test("constants are pinned", () => {
                expect(MAX_ATTEMPTS).toBe(6);
                expect(BACKOFF_BASE_MS).toBe(3000);
                expect(BACKOFF_CAP_MS).toBe(45_000);
                expect(BACKOFF_JITTER_MS).toBe(1500);
        });

        test("deterministic with an injected rng: min(3s*2^(n-1), 45s) + rng()*1.5s", () => {
                expect(backoffDelayMs(1, () => 0)).toBe(3000);
                expect(backoffDelayMs(2, () => 0)).toBe(6000);
                expect(backoffDelayMs(3, () => 0)).toBe(12_000);
                expect(backoffDelayMs(4, () => 0)).toBe(24_000);
                expect(backoffDelayMs(5, () => 0)).toBe(45_000); // 48s capped
                expect(backoffDelayMs(6, () => 0)).toBe(45_000); // 96s capped
        });

        test("max jitter lands exactly at base + 1500", () => {
                expect(backoffDelayMs(1, () => 1)).toBe(4500);
                expect(backoffDelayMs(5, () => 1)).toBe(46_500);
        });

        test("midpoint rng adds half the jitter", () => {
                expect(backoffDelayMs(2, () => 0.5)).toBe(6750);
        });

        // QUIRK: the 45s cap applies to the exponential base ONLY — jitter is
        // added after the cap, so total backoff can reach 46.5s (the documented
        // "min(...,45s)+jitter" formula, pinned as written).
        test("PIN: jitter can push the total past the 45s cap", () => {
                const capped = backoffDelayMs(6, () => 1);
                expect(capped).toBe(46_500);
                expect(capped).toBeGreaterThan(BACKOFF_CAP_MS);
        });

        test("random draws stay within [capped base, capped base + 1500) for every attempt", () => {
                for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                        const base = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS);
                        for (let i = 0; i < 500; i++) {
                                const d = backoffDelayMs(attempt);
                                expect(d).toBeGreaterThanOrEqual(base);
                                expect(d).toBeLessThan(base + BACKOFF_JITTER_MS);
                        }
                }
        });
});

describe("spacingWaitMs", () => {
        test.each([
                [1000, 1000, 400, 400],
                [1000, 1399, 400, 1],
                [1000, 1400, 400, 0],
                [1000, 5000, 400, 0],
                [0, 5000, 400, 0],
                [1000, 1000, 0, 0],
        ])("last=%d now=%d spacing=%d -> %d", (last, now, spacing, expected) => {
                expect(spacingWaitMs(last, now, spacing)).toBe(expected);
        });

        // §4.4: "spacing serialization never below BRIDGE_MIN_SPACING_MS" — the
        // next dispatch time (now + wait) never precedes last + spacing.
        test("dispatch time never precedes lastRequestAt + minSpacingMs", () => {
                for (let elapsed = 0; elapsed <= 400; elapsed += 25) {
                        const last = 10_000;
                        const now = last + elapsed;
                        const wait = spacingWaitMs(last, now, 400);
                        expect(now + wait).toBeGreaterThanOrEqual(last + 400);
                        expect(wait).toBe(Math.max(0, 400 - elapsed));
                }
        });

        // QUIRK: a non-numeric BRIDGE_MIN_SPACING_MS yields NaN (Number("abc")),
        // and the caller's `wait > 0` is false for NaN — garbage config DISABLES
        // spacing instead of erroring.
        test("NaN spacing yields NaN (caller treats as no wait)", () => {
                expect(Number.isNaN(spacingWaitMs(1000, 1000, Number("abc")))).toBe(true);
        });

        test("negative spacing clamps to 0", () => {
                expect(spacingWaitMs(1000, 1000, -100)).toBe(0);
        });
});

// ---------------------------------------------------------------------------
// loadConfig / upstreamTimeoutMs (env parsing contract)
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
        test("empty env -> documented defaults, byte-identical", () => {
                expect(loadConfig({})).toEqual({
                        port: 3031,
                        apiKey: "",
                        defaultModel: "agnes-3.0-flash",
                        upstreamUrl: "https://apihub.agnes-ai.com/v1",
                        upstreamKey: "",
                        routeDefault: "agnes-3.0-flash",
                        knownModels: ["agnes-3.0-flash", "agnes-2.5-flash"],
                        qwenThinking: false,
                        minSpacingMs: 400,
                        localUrl: "",
                        localKey: "",
                        localModels: [],
                        fallbackUrl: "",
                        fallbackKey: "",
                        fallbackModel: "",
                });
        });

        test("parses a full env", () => {
                expect(
                        loadConfig({
                                BRIDGE_PORT: "9999",
                                BRIDGE_API_KEY: "secret",
                                BRIDGE_MODEL: "qwen3.7-plus",
                                BRIDGE_UPSTREAM_URL: "https://example.invalid/v1",
                                BRIDGE_UPSTREAM_KEY: "sk-x",
                                BRIDGE_ROUTE_DEFAULT: "qwen3.6-plus",
                                BRIDGE_KNOWN_MODELS: " a , b ,, c ",
                                BRIDGE_QWEN_THINKING: "1",
                                BRIDGE_MIN_SPACING_MS: "250",
                        }),
                ).toEqual({
                        port: 9999,
                        apiKey: "secret",
                        defaultModel: "qwen3.7-plus",
                        upstreamUrl: "https://example.invalid/v1",
                        upstreamKey: "sk-x",
                        routeDefault: "qwen3.6-plus",
                        knownModels: ["a", "b", "c"],
                        qwenThinking: true,
                        minSpacingMs: 250,
                        localUrl: "",
                        localKey: "",
                        localModels: [],
                        fallbackUrl: "",
                        fallbackKey: "",
                        fallbackModel: "",
                });
        });

        test("KNOWN_MODELS entries are trimmed and empty segments dropped", () => {
                expect(loadConfig({ BRIDGE_KNOWN_MODELS: " m1 , , m2 ,m3, " }).knownModels).toEqual(["m1", "m2", "m3"]);
                expect(loadConfig({ BRIDGE_KNOWN_MODELS: ",," }).knownModels).toEqual([]);
        });

        test("upstream trailing slashes are stripped (any number)", () => {
                expect(loadConfig({ BRIDGE_UPSTREAM_URL: "https://x.invalid/v1/" }).upstreamUrl).toBe("https://x.invalid/v1");
                expect(loadConfig({ BRIDGE_UPSTREAM_URL: "https://x.invalid/v1///" }).upstreamUrl).toBe("https://x.invalid/v1");
        });

        test("ROUTE_DEFAULT falls back to BRIDGE_MODEL when unset", () => {
                expect(loadConfig({ BRIDGE_MODEL: "qwen3.7-plus" }).routeDefault).toBe("qwen3.7-plus");
                expect(loadConfig({ BRIDGE_MODEL: "qwen3.7-plus", BRIDGE_ROUTE_DEFAULT: "kimi-k2.5" }).routeDefault).toBe("kimi-k2.5");
        });

        test.each(["1", "true", "TRUE", "yes", "Yes"])("BRIDGE_QWEN_THINKING=%s -> thinking on", (v) => {
                expect(loadConfig({ BRIDGE_QWEN_THINKING: v }).qwenThinking).toBe(true);
        });

        // QUIRK: the truthy regex is ^(1|true|yes)$ — "on", "enable" and "y" are
        // NOT accepted (case-insensitively).
        test.each(["0", "false", "", "on", "enable", "y", "01"])("BRIDGE_QWEN_THINKING=%s -> thinking off", (v) => {
                expect(loadConfig({ BRIDGE_QWEN_THINKING: v }).qwenThinking).toBe(false);
        });

        // QUIRK: numeric env values are not validated — garbage yields NaN
        // (Bun.serve would then pick a random port; spacing silently disables).
        test("non-numeric BRIDGE_PORT yields NaN (no validation)", () => {
                expect(Number.isNaN(loadConfig({ BRIDGE_PORT: "abc" }).port)).toBe(true);
        });

        // Fresh-clone regression (2026-10-19): .env.example ships optional vars
        // EMPTY ("KEY=") and bun auto-loads .env — an empty value must mean
        // "unset, use the default", never Number("") = 0 or a broken URL.
        test("EMPTY env values fall back to defaults (the `cp .env.example .env` shape)", () => {
                const empty = {
                        BRIDGE_MODEL: "",
                        BRIDGE_PORT: "",
                        BRIDGE_ROUTE_DEFAULT: "",
                        BRIDGE_KNOWN_MODELS: "",
                        BRIDGE_MIN_SPACING_MS: "",
                        BRIDGE_UPSTREAM_URL: "",
                };
                const cfg = loadConfig(empty);
                expect(cfg.defaultModel).toBe("agnes-3.0-flash");
                expect(cfg.port).toBe(3031);
                expect(cfg.routeDefault).toBe("agnes-3.0-flash");
                expect(cfg.knownModels).toEqual(["agnes-3.0-flash", "agnes-2.5-flash"]);
                expect(cfg.minSpacingMs).toBe(400);
                expect(cfg.upstreamUrl).toBe("https://apihub.agnes-ai.com/v1");
                expect(upstreamTimeoutMs({ BRIDGE_UPSTREAM_TIMEOUT_MS: "" })).toBe(180_000);
        });
});

describe("upstreamTimeoutMs", () => {
        test("default is 180s", () => {
                expect(upstreamTimeoutMs({})).toBe(180_000);
        });

        test("values are floored at 5s", () => {
                expect(upstreamTimeoutMs({ BRIDGE_UPSTREAM_TIMEOUT_MS: "3000" })).toBe(5000);
                expect(upstreamTimeoutMs({ BRIDGE_UPSTREAM_TIMEOUT_MS: "0" })).toBe(5000);
                expect(upstreamTimeoutMs({ BRIDGE_UPSTREAM_TIMEOUT_MS: "240000" })).toBe(240_000);
        });

        // QUIRK: Math.max(5000, NaN) is NaN — the floor does not guard a
        // non-numeric value, so garbage config disables the headers timeout
        // rather than falling back to 5s.
        test("non-numeric value yields NaN (floor does not guard NaN)", () => {
                expect(Number.isNaN(upstreamTimeoutMs({ BRIDGE_UPSTREAM_TIMEOUT_MS: "abc" }))).toBe(true);
        });
});

// routeRequest — the local lane (second upstream)
describe("routeRequest", () => {
        const KNOWN = ["kimi-k2.5", "qwen3.7-plus", "qwen3.6-plus"];

        test("no localUrl: everything routes remote (local-* falls back to the allow-list -> routeDefault)", () => {
                expect(routeRequest("local-qwen3-0.6b", KNOWN, "kimi-k2.5", "kimi-k2.5", "", [])).toEqual({
                        route: "remote",
                        upstream: "kimi-k2.5", // degrade, not hard-fail
                        requested: "local-qwen3-0.6b",
                });
        });

        test("localUrl set: local-* ids route to the local upstream, id passed through", () => {
                expect(routeRequest("local-qwen3-0.6b", KNOWN, "kimi-k2.5", "kimi-k2.5", "http://127.0.0.1:8080/v1", [])).toEqual({
                        route: "local",
                        upstream: "local-qwen3-0.6b",
                        requested: "local-qwen3-0.6b",
                });
        });

        test("localUrl set: non-local ids route remote exactly as routeModel", () => {
                expect(routeRequest("kimi-k2.5", KNOWN, "kimi-k2.5", "kimi-k2.5", "http://127.0.0.1:8080/v1", [])).toEqual({
                        route: "remote",
                        upstream: "kimi-k2.5",
                        requested: "kimi-k2.5",
                });
                expect(routeRequest("gpt-4", KNOWN, "kimi-k2.5", "kimi-k2.5", "http://127.0.0.1:8080/v1", [])).toEqual({
                        route: "remote",
                        upstream: "kimi-k2.5",
                        requested: "gpt-4",
                });
        });

        test("explicit localModels list: listed ids route local even without the prefix; the prefix alone does NOT when a list exists", () => {
                const models = ["my-gguf-model"];
                expect(routeRequest("my-gguf-model", KNOWN, "kimi-k2.5", "kimi-k2.5", "http://127.0.0.1:8080/v1", models)).toEqual({
                        route: "local",
                        upstream: "my-gguf-model",
                        requested: "my-gguf-model",
                });
                // QUIRK (documented behavior): with a non-empty localModels list, the
                // local- prefix convention is disabled — an unlisted local-* id falls
                // back to the remote allow-list.
                expect(routeRequest("local-qwen3-0.6b", KNOWN, "kimi-k2.5", "kimi-k2.5", "http://127.0.0.1:8080/v1", models)).toEqual({
                        route: "remote",
                        upstream: "kimi-k2.5",
                        requested: "local-qwen3-0.6b",
                });
        });

        test("whitespace is trimmed; missing model falls back to the default (remote)", () => {
                expect(routeRequest("  local-x  ", KNOWN, "kimi-k2.5", "kimi-k2.5", "http://127.0.0.1:8080/v1", [])).toEqual({
                        route: "local",
                        upstream: "local-x",
                        requested: "local-x",
                });
                expect(routeRequest(undefined, KNOWN, "kimi-k2.5", "kimi-k2.5", "http://127.0.0.1:8080/v1", [])).toEqual({
                        route: "remote",
                        upstream: "kimi-k2.5",
                        requested: "kimi-k2.5",
                });
        });
});

// isLocalModel
describe("isLocalModel", () => {
        test("prefix convention applies only when the list is empty", () => {
                expect(isLocalModel("local-foo", [])).toBe(true);
                expect(isLocalModel("local-foo", ["other"])).toBe(false);
                expect(isLocalModel("other", ["other"])).toBe(true);
                expect(isLocalModel("kimi-k2.5", [])).toBe(false);
        });
});

// loadConfig local fields
describe("loadConfig local lane", () => {
        test("defaults: no local upstream, no local models, empty key", () => {
                const cfg = loadConfig({});
                expect(cfg.localUrl).toBe("");
                expect(cfg.localKey).toBe("");
                expect(cfg.localModels).toEqual([]);
        });

        test("BRIDGE_LOCAL_URL trailing slashes are stripped; models list is split+trimmed", () => {
                const cfg = loadConfig({ BRIDGE_LOCAL_URL: "http://127.0.0.1:8080/v1///", BRIDGE_LOCAL_MODELS: " local-a, local-b ,, " });
                expect(cfg.localUrl).toBe("http://127.0.0.1:8080/v1");
                expect(cfg.localModels).toEqual(["local-a", "local-b"]);
        });
});

// local-lane qwen family detection (thinking translation)
describe("buildUpstreamBody local qwen models", () => {
        test("local-qwen3-0.6b gets the qwen thinking-off default (prefix stripped for family detection)", () => {
                const out = buildUpstreamBody({ messages: [], thinking: { type: "disabled" } }, "local-qwen3-0.6b", false);
                expect(out.enable_thinking).toBe(false);
        });

        test("local- ids NOT naming qwen models are untouched", () => {
                const out = buildUpstreamBody({ messages: [] }, "local-granite-4.0-1b", false);
                expect(out.enable_thinking).toBeUndefined();
        });

        test("remote behavior is byte-identical: kimi unaffected, qwen3.7-plus thinking-off", () => {
                expect(buildUpstreamBody({ messages: [] }, "kimi-k2.5", false).enable_thinking).toBeUndefined();
                expect(buildUpstreamBody({ messages: [] }, "qwen3.7-plus", false).enable_thinking).toBe(false);
        });
});

// withLocalThinkingCompat
describe("withLocalThinkingCompat", () => {
        test("mirrors enable_thinking into chat_template_kwargs for llama.cpp-style servers", () => {
                const out = withLocalThinkingCompat({ model: "local-qwen3-0.6b", enable_thinking: false, messages: [] });
                expect(out.chat_template_kwargs).toEqual({ enable_thinking: false });
                expect(out.enable_thinking).toBe(false);
        });

        test("no enable_thinking or existing chat_template_kwargs -> untouched", () => {
                expect(withLocalThinkingCompat({ a: 1 })).toEqual({ a: 1 });
                expect(withLocalThinkingCompat({ enable_thinking: true, chat_template_kwargs: { x: 1 } })).toEqual({
                        enable_thinking: true,
                        chat_template_kwargs: { x: 1 },
                });
        });
});

// ---------------------------------------------------------------------------
// Failover lane (BRIDGE_FALLBACK_*) — classification + config parsing
// ---------------------------------------------------------------------------

describe("isFailoverError", () => {
        const withStatus = (status: number, msg = `upstream ${status}: boom`) => Object.assign(new Error(msg), { status });

        test("429 / 402 / 408 / 401 / 403 / 5xx are failover-eligible (primary cannot serve)", () => {
                for (const status of [429, 402, 408, 401, 403, 500, 502, 503, 504, 529]) {
                        expect(isFailoverError(withStatus(status))).toBe(true);
                }
        });

        test("PIN: Dashscope's live quota-throttle shape (429 + throttling body) is eligible", () => {
                // Measured 2026-10-20: HTTP 429, body {"error":{"code":"throttling",
                // "message":"hour allocated quota exceeded."}} — status branch catches it.
                expect(isFailoverError(withStatus(429, 'upstream 429: {"error":{"code":"throttling","message":"hour allocated quota exceeded."}}'))).toBe(true);
        });

        test("plain 400 / 404 / 409 / 422 schema-model errors are NOT eligible (the fallback would fail too)", () => {
                for (const status of [400, 404, 409, 422]) {
                        expect(isFailoverError(withStatus(status))).toBe(false);
                }
        });

        test("quota / throttle / billing wording makes even a plain 400 eligible (providers that ship quota as 400)", () => {
                for (const msg of [
                        'upstream 400: {"error":{"code":"throttling","message":"hour allocated quota exceeded."}}',
                        "upstream 400: Requests quota exceeded",
                        "upstream 400: Arrearage detected",
                        "upstream 400: billing not active",
                        "upstream 400: insufficient balance",
                ]) {
                        expect(isFailoverError(new Error(msg))).toBe(true);
                }
        });

        test("network / timeout / rate-limit message wording is eligible without a status", () => {
                for (const msg of [
                        "fetch failed",
                        "network error",
                        "socket hang up",
                        "ECONNRESET",
                        "upstream timeout: no response headers after 180000ms",
                        "terminated",
                        "Too Many Requests",
                        "rate limit hit",
                ]) {
                        expect(isFailoverError(new Error(msg))).toBe(true);
                }
        });

        // PIN: Bun's connection-refused phrasing (measured live — no status, no
        // "fetch failed", no ECONN in the message; isRetryableError misses it too).
        test("Bun's 'Unable to connect' phrasing is eligible (dead primary)", () => {
                expect(isFailoverError(new Error("Unable to connect. Is the computer able to access the url?"))).toBe(true);
        });

        test("plain non-quota failures without keywords are NOT eligible", () => {
                for (const msg of ["upstream 400: invalid parameter: temperature", "model not found", "context length exceeded"]) {
                        expect(isFailoverError(new Error(msg))).toBe(false);
                }
        });

        test("undefined / null errors do not throw", () => {
                expect(isFailoverError(undefined)).toBe(false);
                expect(isFailoverError(null)).toBe(false);
        });

        test("broader than isRetryableError: 401/403 fail over but do not retry", () => {
                expect(isRetryableError(withStatus(401))).toBe(false);
                expect(isFailoverError(withStatus(401))).toBe(true);
                expect(isRetryableError(new Error("quota exceeded"))).toBe(false);
                expect(isFailoverError(new Error("quota exceeded"))).toBe(true);
        });
});

describe("loadConfig failover lane", () => {
        test("defaults: failover off (empty url/key/model)", () => {
                const cfg = loadConfig({});
                expect(cfg.fallbackUrl).toBe("");
                expect(cfg.fallbackKey).toBe("");
                expect(cfg.fallbackModel).toBe("");
        });

        test("empty .env values (KEY=) mean OFF — the || convention", () => {
                const cfg = loadConfig({ BRIDGE_FALLBACK_URL: "", BRIDGE_FALLBACK_KEY: "", BRIDGE_FALLBACK_MODEL: "" });
                expect(cfg.fallbackUrl).toBe("");
                expect(cfg.fallbackKey).toBe("");
                expect(cfg.fallbackModel).toBe("");
        });

        test("trailing slashes stripped from the url; model id is trimmed", () => {
                const cfg = loadConfig({ BRIDGE_FALLBACK_URL: "https://apihub.agnes-ai.com/v1///", BRIDGE_FALLBACK_MODEL: "  agnes-3.0-flash " });
                expect(cfg.fallbackUrl).toBe("https://apihub.agnes-ai.com/v1");
                expect(cfg.fallbackModel).toBe("agnes-3.0-flash");
        });
});

describe("buildUpstreamBody failover shaping", () => {
        test("agnes-3.0-flash is not qwen: no enable_thinking, z-ai thinking param dropped", () => {
                const out = buildUpstreamBody({ messages: [], thinking: { type: "disabled" } }, "agnes-3.0-flash", true);
                expect(out.model).toBe("agnes-3.0-flash");
                expect(out.enable_thinking).toBeUndefined();
                expect(out.thinking).toBeUndefined();
        });

        test("failover rewrite keeps tools + sampling params verbatim", () => {
                const out = buildUpstreamBody({ messages: [], tools: [{ type: "function", function: { name: "read", arguments: "{}" } }], temperature: 0.2 }, "agnes-3.0-flash", false);
                expect(out.tools).toHaveLength(1);
                expect(out.temperature).toBe(0.2);
        });
});

// ---------------------------------------------------------------------------
// Catalog coherence (audit M4-a D1 — the stale-allow-list 404 trap)
// ---------------------------------------------------------------------------
describe("coherentKnownModels (M4-a D1)", () => {
        test("adds the default and route default to the allow-list when absent", () => {
                expect(coherentKnownModels(["kimi-k2.5", "qwen3.7-plus"], "agnes-3.0-flash", "agnes-3.0-flash")).toEqual([
                        "kimi-k2.5",
                        "qwen3.7-plus",
                        "agnes-3.0-flash",
                ]);
        });

        test("keeps the allow-list untouched when both ids are already present", () => {
                expect(coherentKnownModels(["a", "b"], "a", "b")).toEqual(["a", "b"]);
        });

        test("handles distinct default and route default ids", () => {
                expect(coherentKnownModels(["a"], "dflt", "route")).toEqual(["a", "dflt", "route"]);
        });

        test("never duplicates an id that appears as both default and route default", () => {
                expect(coherentKnownModels([], "m", "m")).toEqual(["m"]);
        });
});

describe("parseModelCatalog (M4-a D1)", () => {
        test("parses an OpenAI-compatible { data: [{id}] } body", () => {
                expect(parseModelCatalog({ data: [{ id: "agnes-3.0-flash" }, { id: "agnes-2.5-flash" }] })).toEqual([
                        "agnes-3.0-flash",
                        "agnes-2.5-flash",
                ]);
        });

        test("trims ids and drops empty/non-string entries", () => {
                expect(parseModelCatalog({ data: [{ id: " a " }, { id: "" }, { nope: 1 }, "x" as any] })).toEqual(["a"]);
        });

        test("returns null for a missing/empty/malformed catalog", () => {
                expect(parseModelCatalog(null)).toBeNull();
                expect(parseModelCatalog({})).toBeNull();
                expect(parseModelCatalog({ data: "nope" })).toBeNull();
                expect(parseModelCatalog({ data: [] })).toBeNull();
                expect(parseModelCatalog({ data: [{ id: "  " }] })).toBeNull();
        });
});

describe("mergeCatalogIntoKnown (M4-a D1)", () => {
        test("merges catalog ids after the allow-list, without duplicates", () => {
                const { merged, stale } = mergeCatalogIntoKnown(["kimi-k2.5"], ["agnes-3.0-flash", "agnes-2.5-flash", "kimi-k2.5"]);
                expect(merged).toEqual(["kimi-k2.5", "agnes-3.0-flash", "agnes-2.5-flash"]);
                expect(stale).toEqual([]);
        });

        test("reports allow-listed ids the catalog does not serve (the 404 trap)", () => {
                const { merged, stale } = mergeCatalogIntoKnown(["kimi-k2.5", "qwen3.7-plus"], ["agnes-3.0-flash"]);
                expect(merged).toEqual(["kimi-k2.5", "qwen3.7-plus", "agnes-3.0-flash"]);
                expect(stale).toEqual(["kimi-k2.5", "qwen3.7-plus"]);
        });

        test("caps the merged list so provider-scale catalogs cannot flood the picker", () => {
                const catalog = Array.from({ length: 400 }, (_, i) => `m-${i}`);
                const { merged } = mergeCatalogIntoKnown(["pinned"], catalog, 64);
                expect(merged.length).toBe(64);
                expect(merged[0]).toBe("pinned"); // allow-list keeps priority
                expect(merged[1]).toBe("m-0");
        });
});

// ---------------------------------------------------------------------------
// laneForRequest (2026-10-22 M2 — the admission lanes)
// ---------------------------------------------------------------------------
describe("laneForRequest", () => {
        test("no markers -> interactive (the human-waits default)", () => {
                expect(laneForRequest(undefined, undefined)).toBe("interactive");
                expect(laneForRequest("", "")).toBe("interactive");
                expect(laneForRequest(null, null)).toBe("interactive");
        });

        test("the terminal agent's bridge-local key is interactive", () => {
                expect(laneForRequest("Bearer bridge-local", undefined)).toBe("interactive");
                expect(laneForRequest("bearer bridge-local", undefined)).toBe("interactive");
        });

        test("real provider keys are interactive", () => {
                expect(laneForRequest("Bearer sk-real-key-123", undefined)).toBe("interactive");
                expect(laneForRequest("Bearer cpk-whatever", undefined)).toBe("interactive");
        });

        test("the bridge-background bearer signals background", () => {
                expect(laneForRequest("Bearer bridge-background", undefined)).toBe("background");
                expect(laneForRequest("bearer bridge-background", undefined)).toBe("background");
                expect(laneForRequest("  Bearer   bridge-background  ", undefined)).toBe("background");
        });

        test("the x-unown-lane header signals background (case/space tolerant)", () => {
                expect(laneForRequest(undefined, "background")).toBe("background");
                expect(laneForRequest(undefined, "Background")).toBe("background");
                expect(laneForRequest(undefined, "  BACKGROUND  ")).toBe("background");
        });

        test("the header wins over the bearer (explicit opt-in outranks inference)", () => {
                expect(laneForRequest("Bearer bridge-background", "interactive")).toBe("interactive");
                expect(laneForRequest("Bearer bridge-local", "background")).toBe("background");
        });

        test("unrelated header values do not match the background lane", () => {
                expect(laneForRequest(undefined, "fast")).toBe("interactive");
                expect(laneForRequest(undefined, "background-ish")).toBe("interactive");
        });
});

// ---------------------------------------------------------------------------
// Degenerate-completion detection (2026-10-23): the silent-empty-upstream fix.
// sseFrameSignalsContent is the release trigger for the bridge's stream
// holdback; isDegenerateCompletion guards the non-stream path. Both exist
// because the Agnes flash upstream was measured returning 200 completions
// with ZERO content under concurrent load (empty streams with usage 0/0 and
// 48-81s latencies; empty JSON bodies) — every layer used to treat those as
// successful empty answers.
// ---------------------------------------------------------------------------
describe("sseFrameSignalsContent — the holdback release trigger", () => {
        test("text content deltas release", () => {
                expect(sseFrameSignalsContent(`data: ${JSON.stringify({ choices: [{ delta: { content: "hello" } }] })}`)).toBe(true);
        });

        test("tool-call deltas release", () => {
                expect(sseFrameSignalsContent(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "bash" } }] } }] })}`)).toBe(true);
        });

        test("reasoning deltas release (thinking models)", () => {
                expect(sseFrameSignalsContent(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "thinking" } }] })}`)).toBe(true);
                expect(sseFrameSignalsContent(`data: ${JSON.stringify({ choices: [{ delta: { reasoning: "thinking" } }] })}`)).toBe(true);
                expect(sseFrameSignalsContent(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_text: "thinking" } }] })}`)).toBe(true);
        });

        test("role-only frames do NOT release", () => {
                expect(sseFrameSignalsContent(`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" } }] })}`)).toBe(false);
        });

        test("a bare finish_reason frame does NOT release (the degenerate shape)", () => {
                expect(sseFrameSignalsContent(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`)).toBe(false);
        });

        test("usage-only frames do NOT release", () => {
                expect(sseFrameSignalsContent(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 9200, completion_tokens: 0 } })}`)).toBe(false);
        });

        test("[DONE] does not release", () => {
                expect(sseFrameSignalsContent("data: [DONE]")).toBe(false);
        });

        test("empty-string content does not release (an empty string is not work product)", () => {
                expect(sseFrameSignalsContent(`data: ${JSON.stringify({ choices: [{ delta: { content: "" } }] })}`)).toBe(false);
        });

        test("non-data and garbage lines do not release", () => {
                expect(sseFrameSignalsContent(": keepalive")).toBe(false);
                expect(sseFrameSignalsContent("data: {broken json")).toBe(false);
                expect(sseFrameSignalsContent("")).toBe(false);
        });

        test("non-streaming shapes leaked into streams release (defensive)", () => {
                expect(sseFrameSignalsContent(`data: ${JSON.stringify({ choices: [{ message: { content: "full answer" } }] })}`)).toBe(true);
                expect(sseFrameSignalsContent(`data: ${JSON.stringify({ choices: [{ message: { tool_calls: [{ id: "t1", function: { name: "x" } }] } }] })}`)).toBe(true);
        });
});

describe("isDegenerateCompletion — the non-stream guard", () => {
        test("the measured Agnes shape is degenerate: empty content, no tools, 0 completion tokens", () => {
                expect(
                        isDegenerateCompletion({
                                choices: [{ message: { role: "assistant", content: "" }, finish_reason: "stop" }],
                                usage: { prompt_tokens: 9200, completion_tokens: 0 },
                        }),
                ).toBe(true);
        });

        test("missing usage entirely is degenerate when content is empty", () => {
                expect(isDegenerateCompletion({ choices: [{ message: { role: "assistant", content: "" }, finish_reason: "stop" }] })).toBe(true);
        });

        test("a real answer is not degenerate", () => {
                expect(
                        isDegenerateCompletion({
                                choices: [{ message: { role: "assistant", content: "here is the answer" }, finish_reason: "stop" }],
                                usage: { prompt_tokens: 50, completion_tokens: 7 },
                        }),
                ).toBe(false);
        });

        test("a tool-call-only answer is not degenerate", () => {
                expect(
                        isDegenerateCompletion({
                                choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "t1", function: { name: "bash" } }] }, finish_reason: "tool_calls" }],
                                usage: { prompt_tokens: 50, completion_tokens: 0 },
                        }),
                ).toBe(false);
        });

        test("a reasoning-only answer is not degenerate", () => {
                expect(
                        isDegenerateCompletion({
                                choices: [{ message: { role: "assistant", content: "", reasoning_content: "thoughts" }, finish_reason: "stop" }],
                                usage: { prompt_tokens: 50, completion_tokens: 0 },
                        }),
                ).toBe(false);
        });

        test("empty content with NON-zero completion tokens is not flagged (tokens were spent — not the empty-200 fault)", () => {
                expect(
                        isDegenerateCompletion({
                                choices: [{ message: { role: "assistant", content: "" }, finish_reason: "stop" }],
                                usage: { prompt_tokens: 50, completion_tokens: 12 },
                        }),
                ).toBe(false);
        });

        test("200 with no choices array is degenerate", () => {
                expect(isDegenerateCompletion({})).toBe(true);
                expect(isDegenerateCompletion({ choices: [] })).toBe(true);
        });
});

// ---------------------------------------------------------------------------
// The model-specs round: catalog spec extraction + context-limit learning
// ---------------------------------------------------------------------------
describe("the model-specs round — parseCatalogEntrySpecs / extractCatalogSpecs", () => {
	test("vLLM shape: max_model_len + max_completion_tokens normalize; noise ignored", () => {
		const spec = parseCatalogEntrySpecs({
			id: "qwen-custom-72b",
			max_model_len: 32768,
			max_completion_tokens: 4096,
			description: "noise",
			pricing: { prompt: "0.001" },
		});
		expect(spec).toEqual({ contextWindow: 32768, maxTokens: 4096 });
	});

	test("LM Studio shape: loaded_context_length + max_tokens; llama.cpp meta.n_ctx", () => {
		expect(parseCatalogEntrySpecs({ id: "a", loaded_context_length: 8192, max_tokens: 4096 })).toEqual({
			contextWindow: 8192,
			maxTokens: 4096,
		});
		expect(parseCatalogEntrySpecs({ id: "b", meta: { n_ctx: 4096, vocabulary_size: 32000 } })).toEqual({ contextWindow: 4096 });
	});

	test("OpenRouter shape: top_provider + architecture.input_modalities flag vision", () => {
		const spec = parseCatalogEntrySpecs({
			id: "or/model",
			top_provider: { max_completion_tokens: 8192, is_moderated: true },
			architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
		});
		expect(spec).toEqual({ maxTokens: 8192, imageInput: true });
	});

	test("garbage numbers are rejected, not guessed (0, negatives, floats, NaN)", () => {
		expect(parseCatalogEntrySpecs({ id: "a", max_model_len: 0, max_tokens: -5 })).toEqual({});
		expect(parseCatalogEntrySpecs({ id: "a", max_model_len: 1.5 })).toEqual({});
		expect(parseCatalogEntrySpecs({ id: "a", max_model_len: Number.NaN })).toEqual({});
		expect(parseCatalogEntrySpecs(null)).toEqual({});
		expect(parseCatalogEntrySpecs("string")).toEqual({});
	});

	test("extractCatalogSpecs keys by id and keeps only spec-bearing entries", () => {
		const specs = extractCatalogSpecs({
			data: [
				{ id: "with-specs", max_model_len: 65536 },
				{ id: "id-only", object: "model" },
				{ object: "model" },
				"garbage",
			],
		});
		expect(specs).toEqual({ "with-specs": { contextWindow: 65536 } });
		expect(extractCatalogSpecs({})).toEqual({});
		expect(extractCatalogSpecs({ data: "not-an-array" })).toEqual({});
	});
});

describe("the model-specs round — parseContextLimitError (upstream 400 truth)", () => {
	test("OpenAI shape: maximum context length is X tokens", () => {
		expect(
			parseContextLimitError("This model's maximum context length is 131072 tokens. However, your messages resulted in 150000 tokens."),
		).toEqual({ contextWindow: 131072 });
	});

	test("OpenRouter shape: maximum allowed input length of X tokens", () => {
		expect(parseContextLimitError("Input length 250000 exceeds the maximum allowed input length of 200000 tokens.")).toEqual({
			contextWindow: 200000,
		});
	});

	test("Mistral shape: too large for model with X maximum context length", () => {
		expect(parseContextLimitError("Prompt contains 40000 tokens ... too large for model with 32768 maximum context length")).toEqual({
			contextWindow: 32768,
		});
	});

	test("DashScope shape: Range of input length should be [1, X]", () => {
		expect(parseContextLimitError("Range of input length should be [1, 100000], but your input is 120000 tokens")).toEqual({
			contextWindow: 100000,
		});
	});

	test("Kimi shape: exceeded model token limit: X", () => {
		expect(parseContextLimitError("exceeded model token limit: 262144 (requested: 300000)")).toEqual({ contextWindow: 262144 });
	});

	test("non-overflow 400s teach nothing (schema errors, auth, empty)", () => {
		expect(parseContextLimitError("Invalid schema for function 'foo': expected object")).toBeUndefined();
		expect(parseContextLimitError("Invalid model id")).toBeUndefined();
		expect(parseContextLimitError("")).toBeUndefined();
	});

	test("a nonsense number is rejected (below the 1024 floor)", () => {
		expect(parseContextLimitError("maximum context length is 12 tokens")).toBeUndefined();
	});
});
