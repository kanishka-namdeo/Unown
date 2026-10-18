// Unit tests for src/llm.ts — extractJson (the model-response JSON parser)
// plus the chatText/chatJson robustness layer (reasoning_content fallback,
// single corrective JSON-only retry).
//
// Task ref: engine unit tests, module 1/4 (llm.ts extractJson: fenced ```json
// blocks, plain JSON, JSON in prose, arrays, malformed). The network functions
// (chat/chatText/chatJson) are exercised through a hermetic globalThis.fetch
// mock (no live bridge, no paid tokens); bridgeHealth/bridgeLog only run
// their dead-endpoint fallback paths.
//
// This file imports ./_env.ts FIRST: it redirects PI_SELFLEARNING_* / PI_BRIDGE_URL
// into /tmp fixtures so importing src/llm.ts (which eagerly opens the engine's
// SQLite store via src/store.ts) never touches the live engine state.
//
// extractJson now scans for the FIRST string/escape-aware balanced {...}
// object (fenced candidate first, then the raw text — the live kimi-k2.5
// "no JSON object found" hardening). The QUIRK pins that described the old
// first-'{'-to-last-'}' slice corruption were re-pinned to the fixed behavior
// (FIXED: comments); assertions that still pin quirks keep theirs.

import "./_env.ts";
import { TEST_TMP } from "./_env.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import { DATA_DIR } from "../src/store.ts";
import { subscribe } from "../src/bus.ts";
import { bridgeHealth, bridgeLog, chatJson, chatText, extractJson } from "../src/llm.ts";

// The shared /tmp redirect root created by importing the store is co-owned
// with the parallel b-suite via test/_env.ts (cleaned by whoever owns it);
// this file only reads it.

test("env redirect is active (never touch the live engine db)", () => {
        // Tripwire: if this fails, ./_env.ts was not the first import and the tests
        // would be running against the live engine store — abort loudly instead.
        // The exact tmpdir root is co-owned with the parallel b-suite (test/_env.ts).
        const DATA_REAL = existsSync(DATA_DIR) ? realpathSync(DATA_DIR) : DATA_DIR; // realpath when it exists (macOS /var -> /private); lexical before first mkdir
        expect(DATA_REAL.startsWith(TEST_TMP)).toBe(true);
        expect(DATA_DIR).toContain("/data");
});

// ---------------------------------------------------------------------------
// extractJson — happy paths
// ---------------------------------------------------------------------------

describe("extractJson: plain JSON", () => {
        test.each([
                ['{"a":1}', { a: 1 }],
                ['  \n{"a":1}\n  ', { a: 1 }],
                ['{"a":{"b":[1,2,{"c":true}]}}', { a: { b: [1, 2, { c: true }] } }],
                ['{}', {}],
                ['{"s":"}"}', { s: "}" }], // escaped brace inside a string
                ['{"s":"```"}', { s: "```" }], // fence chars inside a string value
        ])("%s parses", (text, expected) => {
                expect(extractJson(text)).toEqual(expected);
        });

        test("deep object round-trips", () => {
                const obj = { tiers: ["policy", "project"], meta: { n: 1, nested: { deep: null } } };
                expect(extractJson(JSON.stringify(obj))).toEqual(obj);
        });
});

describe("extractJson: fenced ```json blocks", () => {
        test.each([
                ['```json\n{"a":1}\n```', { a: 1 }],
                ["```\n{\"a\":1}\n```", { a: 1 }], // fence with no language tag
                ['```json{"a":1}```', { a: 1 }], // no whitespace after the tag
                ['```json\n  {"a": 1}  \n```', { a: 1 }], // padding inside the fence
                ['```json\n{"a":{"b":2}}\n```', { a: { b: 2 } }], // nested braces
        ])("%s parses", (text, expected) => {
                expect(extractJson(text)).toEqual(expected);
        });

        test("first fence wins when several fenced blocks are present", () => {
                const text = '```json\n{"first":1}\n```\nmiddle prose\n```json\n{"second":2}\n```';
                expect(extractJson(text)).toEqual({ first: 1 });
        });

        test("unclosed fence falls back to whole-text brace scan", () => {
                // QUIRK: the fence regex needs a closing ```, so an unterminated fence is
                // not matched at all — the plain-text path then finds the object anyway.
                const text = '```json\n{"a":1}';
                expect(extractJson(text)).toEqual({ a: 1 });
        });

        test("QUIRK: language tags other than exactly 'json' still work (brace scan rescues them)", () => {
                // (?:json)? only matches the exact lowercase tag; 'json5' leaves the '5'
                // behind in the candidate, but indexOf('{') skips it.
                expect(extractJson('```json5\n{"a":1}\n```')).toEqual({ a: 1 });
                expect(extractJson('```JSON\n{"a":1}\n```')).toEqual({ a: 1 });
        });
});

describe("extractJson: JSON in prose", () => {
        test.each([
                ['Sure! Here is the JSON: {"a": 1} — let me know if you need more.', { a: 1 }],
                ["The answer is:\n{\"a\":1}\nThanks.", { a: 1 }],
                ['prose before {"a":1} prose after with no braces', { a: 1 }],
        ])("%s parses", (text, expected) => {
                expect(extractJson(text)).toEqual(expected);
        });

        test("FIXED: braces in the trailing prose no longer corrupt the extraction", () => {
                // The balanced scan closes the object at its own '}' and ignores the
                // stray brace in the prose after it (the old first-'{'-to-last-'}'
                // slice produced a SyntaxError here).
                const text = 'result {"a":1} done } brace';
                expect(extractJson(text)).toEqual({ a: 1 });
        });

        test("FIXED: two objects in prose — the first balanced one wins", () => {
                // The old slice spanned both objects ('{"a":1} and then {"b":2}') and
                // failed to parse; the scan now stops at the first complete object.
                const text = '{"a":1} and then {"b":2}';
                expect(extractJson(text)).toEqual({ a: 1 });
        });

        test("FIXED: an empty fenced block no longer shadows JSON living in the prose", () => {
                // The fence candidate contains no object, so the scan falls through to
                // the raw text (the old fence-wins behavior threw "no JSON object
                // found" even with valid JSON outside the fence).
                const text = 'prose {"a":1}\n```\nnothing here\n```';
                expect(extractJson(text)).toEqual({ a: 1 });
        });
});

// ---------------------------------------------------------------------------
// extractJson — arrays (task brief calls these out explicitly)
// ---------------------------------------------------------------------------

describe("extractJson: arrays", () => {
        test("BUG: top-level arrays are unsupported — no object braces means 'not found'", () => {
                // extractJson only extracts balanced {...} spans, so a bare array
                // response (tasks.ts TaskDef-list style) throws the no-object error
                // instead of returning the array. Pin current behavior (tasks.ts:76-82).
                expect(() => extractJson("[1,2,3]")).toThrow("llm: no JSON object found in response");
                expect(() => extractJson('```json\n[1,2,3]\n```')).toThrow("llm: no JSON object found in response");
                expect(() => extractJson("result: [1,2]")).toThrow("llm: no JSON object found in response");
        });

        test("QUIRK: an array with exactly ONE object silently unwraps to that object", () => {
                // '[{"a":1}]': the first balanced {...} span is the object INSIDE the
                // array, so the array itself is dropped.
                expect(extractJson('[{"a":1}]')).toEqual({ a: 1 });
                expect(extractJson('```json\n[{"a":1}]\n```')).toEqual({ a: 1 });
        });

        test("QUIRK: an array with two objects returns the first object", () => {
                // The scan stops at the first balanced {...} — the ',{"b":2}' tail is
                // dropped (the old span across both objects was invalid JSON).
                expect(extractJson('[{"a":1},{"b":2}]')).toEqual({ a: 1 });
        });
});

// ---------------------------------------------------------------------------
// extractJson — malformed / degenerate inputs
// ---------------------------------------------------------------------------

describe("extractJson: malformed and missing JSON", () => {
        test("throws the module's own error when no object braces exist", () => {
                expect(() => extractJson("")).toThrow("llm: no JSON object found in response");
                expect(() => extractJson("no json here")).toThrow("llm: no JSON object found in response");
                expect(() => extractJson("```\n```")).toThrow("llm: no JSON object found in response");
                expect(() => extractJson("42")).toThrow("llm: no JSON object found in response");
        });

        test("truncated object reports 'no JSON object found' (last '}' missing)", () => {
                // A maxTokens cutoff can leave no closing '}' at all — the balanced
                // scan finds no complete object and reports "not found" (no
                // corrupt slice, no misleading SyntaxError).
                expect(() => extractJson('{"a":1')).toThrow("llm: no JSON object found in response");
                expect(() => extractJson('{"a":{"b":2}')).toThrow("llm: no JSON object found in response");
        });

        test("truncated JSON inside a fence also reports 'no JSON object found'", () => {
                // maxTokens cutoff mid-object, fenced: the fence candidate is
                // unbalanced, the raw text is unbalanced — clean not-found.
                expect(() => extractJson('```json\n{"skills": [{"name": "run-tests", "desc')).toThrow(
                        "llm: no JSON object found in response",
                );
        });

        test("closing brace before opening brace is rejected", () => {
                expect(() => extractJson("junk } then { bad")).toThrow("llm: no JSON object found in response");
        });

        test("malformed JSON surfaces as a raw SyntaxError (not wrapped)", () => {
                // QUIRK: JSON.parse failures propagate unwrapped — callers see SyntaxError
                // with no llm: prefix, unlike the no-object case.
                expect(() => extractJson('```json\n{"a":}\n```')).toThrow(SyntaxError);
                expect(extractJson('{"a":1}}')).toEqual({ a: 1 }); // FIXED: the trailing brace sits outside the balanced span
                expect(() => extractJson('{"a":1,}')).toThrow(SyntaxError); // trailing comma
        });
});

// ---------------------------------------------------------------------------
// extractJson — brace-in-string + multi-object robustness (balanced scan)
// ---------------------------------------------------------------------------

describe("extractJson: braces inside string literals", () => {
        test("both brace kinds inside string values are ignored by the balance tracker", () => {
                const text = 'result: {"s":"}","t":"{"} done';
                expect(extractJson(text)).toEqual({ s: "}", t: "{" });
        });

        test("escaped quotes and braces inside string values", () => {
                const text = '{"s":"a \\"} b","t":"c \\\\ d"}';
                expect(extractJson(text)).toEqual({ s: 'a "} b', t: "c \\ d" });
        });
});

describe("extractJson: multiple objects / nested fences", () => {
        test("multiple top-level objects in prose: the first balanced one wins", () => {
                expect(extractJson('first {"a":1} then {"b":2} last')).toEqual({ a: 1 });
        });

        test("a nested fence inside a string value: the raw-text scan recovers the object", () => {
                // The fence regex stops at the first ``` — which sits INSIDE the JSON
                // string value — so the fenced candidate is a broken fragment
                // ('{"md":"'). The raw-text balanced scan then finds the complete
                // object (string-aware, so the fence chars are just string content).
                const text = '```json\n{"md":"```nested```"}\n```';
                expect(extractJson(text)).toEqual({ md: "```nested```" });
        });

        test("prose-only refusal (no braces at all) keeps the no-object error", () => {
                expect(() => extractJson("I'm sorry, I can't help with that request.")).toThrow(
                        "llm: no JSON object found in response",
                );
        });
});

// ---------------------------------------------------------------------------
// chatText / chatJson — hermetic globalThis.fetch mock (no live bridge, no
// paid tokens): reasoning_content fallback + the single corrective retry.
// ---------------------------------------------------------------------------

describe("chatText: reasoning_content fallback", () => {
        const realFetch = globalThis.fetch;

        afterEach(() => {
                globalThis.fetch = realFetch;
        });

        function mockCompletion(fields: Record<string, unknown>): void {
                globalThis.fetch = (async () =>
                        new Response(
                                JSON.stringify({ choices: [{ message: { role: "assistant", ...fields }, finish_reason: "stop" }] }),
                                { headers: { "content-type": "application/json" } },
                        )) as typeof fetch;
        }

        test("returns message.content when non-empty", async () => {
                mockCompletion({ content: '{"a":1}' });
                expect(await chatText([{ role: "user", content: "hi" }])).toBe('{"a":1}');
        });

        test("falls back to reasoning_content when content is empty (reasoning models)", async () => {
                // Dashscope reasoning models can split the reply: content empty,
                // answer in reasoning_content (the bridge passes both through).
                mockCompletion({ content: "", reasoning_content: 'thinking... {"a":1}' });
                expect(await chatText([{ role: "user", content: "hi" }])).toBe('thinking... {"a":1}');
        });

        test("falls back to reasoning_content when content is missing entirely", async () => {
                mockCompletion({ reasoning_content: '{"a":1}' });
                expect(await chatText([{ role: "user", content: "hi" }])).toBe('{"a":1}');
        });

        test("empty completion error survives when both fields are empty", async () => {
                mockCompletion({ content: "" });
                await expect(chatText([{ role: "user", content: "hi" }])).rejects.toThrow("llm: empty completion");
        });
});

describe("chatJson: single corrective retry", () => {
        const realFetch = globalThis.fetch;
        let bodies: any[] = [];

        afterEach(() => {
                globalThis.fetch = realFetch;
        });

        /** Serve one canned reply per request (the last reply repeats if more arrive). */
        function mockBridge(replies: Array<Record<string, unknown>>): void {
                bodies = [];
                globalThis.fetch = (async (_input: unknown, init?: any) => {
                        bodies.push(JSON.parse(String(init?.body ?? "{}")));
                        const reply = replies[Math.min(bodies.length - 1, replies.length - 1)];
                        return new Response(
                                JSON.stringify({ choices: [{ message: { role: "assistant", ...reply }, finish_reason: "stop" }] }),
                                { headers: { "content-type": "application/json" } },
                        );
                }) as typeof fetch;
        }

        test("parses JSON content on the first call — no retry, one request", async () => {
                mockBridge([{ content: '{"a":1}' }]);
                const result = await chatJson([{ role: "system", content: "sys" }, { role: "user", content: "u" }]);
                expect(result).toEqual({ a: 1 });
                expect(bodies).toHaveLength(1);
        });

        test("reasoning-only completion parses without a retry", async () => {
                mockBridge([{ content: "", reasoning_content: 'Here it is: {"a":1}' }]);
                const result = await chatJson([{ role: "user", content: "u" }]);
                expect(result).toEqual({ a: 1 });
                expect(bodies).toHaveLength(1);
        });

        test("prose-only first answer: exactly one retry that carries the nudge and parses", async () => {
                mockBridge([{ content: "I would rather explain in prose, thanks." }, { content: '{"a":1}' }]);
                const result = await chatJson([{ role: "system", content: "sys prompt" }, { role: "user", content: "u" }]);
                expect(result).toEqual({ a: 1 });
                expect(bodies).toHaveLength(2);
                // The retry EXTENDS the original system message with the JSON-only nudge.
                const retryMessages = bodies[1].messages;
                expect(retryMessages).toHaveLength(2);
                expect(retryMessages[0].role).toBe("system");
                expect(retryMessages[0].content).toContain("sys prompt");
                expect(retryMessages[0].content).toContain("valid JSON object");
                expect(retryMessages[1]).toEqual({ role: "user", content: "u" });
                // The retry keeps the caller's budget (chat() default max_tokens 4096).
                expect(bodies[1].max_tokens).toBe(bodies[0].max_tokens);
                expect(bodies[1].model).toBe(bodies[0].model);
        });

        test("no system message in the original call: the retry prepends one carrying the nudge", async () => {
                mockBridge([{ content: "no json here" }, { content: '{"a":1}' }]);
                const result = await chatJson([{ role: "user", content: "u" }]);
                expect(result).toEqual({ a: 1 });
                expect(bodies[1].messages).toHaveLength(2);
                expect(bodies[1].messages[0].role).toBe("system");
                expect(bodies[1].messages[0].content).toContain("valid JSON object");
                expect(bodies[1].messages[1]).toEqual({ role: "user", content: "u" });
        });

        test("retry failure: exactly two requests, the no-object error propagates", async () => {
                mockBridge([{ content: "still prose" }, { content: "still prose after the nudge" }]);
                await expect(chatJson([{ role: "user", content: "u" }])).rejects.toThrow("llm: no JSON object found in response");
                expect(bodies).toHaveLength(2); // never a third call
        });

        test("empty completion: one retry, then the empty-completion error propagates", async () => {
                mockBridge([{}, {}]);
                await expect(chatJson([{ role: "user", content: "u" }])).rejects.toThrow("llm: empty completion");
                expect(bodies).toHaveLength(2);
        });

        test("the retry is observable on the bus ('llm:json-retry')", async () => {
                const seen: Array<{ event: string; payload: any }> = [];
                const unsub = subscribe((e) => seen.push(e));
                try {
                        mockBridge([{ content: "refusal prose" }, { content: '{"a":1}' }]);
                        await chatJson([{ role: "user", content: "u" }]);
                } finally {
                        unsub();
                }
                const retryEvents = seen.filter((e) => e.event === "llm:json-retry");
                expect(retryEvents).toHaveLength(1);
                expect(String(retryEvents[0].payload.reason)).toContain("llm: no JSON object found");
                expect(String(retryEvents[0].payload.preview)).toContain("refusal prose");
        });
});

// ---------------------------------------------------------------------------
// chatJson/chat: responseSchema — json_schema structured output + the 400
// portability fallback (other OpenAI-compat endpoints lack json_schema
// support; one retry without response_format, logged on the bus).
// ---------------------------------------------------------------------------

describe("chatJson/chat: responseSchema (json_schema structured output)", () => {
        const realFetch = globalThis.fetch;
        let bodies: any[] = [];

        afterEach(() => {
                globalThis.fetch = realFetch;
        });

        /** Serve one canned reply per request ({ status?, content? }); the last repeats. */
        function mockBridge(replies: Array<{ status?: number; content?: string }>): void {
                bodies = [];
                globalThis.fetch = (async (_input: unknown, init?: any) => {
                        bodies.push(JSON.parse(String(init?.body ?? "{}")));
                        const reply = replies[Math.min(bodies.length - 1, replies.length - 1)];
                        if (reply.status && reply.status !== 200) {
                                return new Response(JSON.stringify({ error: { message: `upstream rejected (${reply.status})` } }), {
                                        status: reply.status,
                                        headers: { "content-type": "application/json" },
                                });
                        }
                        return new Response(
                                JSON.stringify({ choices: [{ message: { role: "assistant", content: reply.content ?? "" }, finish_reason: "stop" }] }),
                                { headers: { "content-type": "application/json" } },
                        );
                }) as typeof fetch;
        }

        const SCHEMA = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };

        test("responseSchema attaches response_format {type:json_schema, name:result, strict:true, schema}", async () => {
                mockBridge([{ content: '{"a":"x"}' }]);
                const result = await chatJson([{ role: "user", content: "u" }], { responseSchema: SCHEMA });
                expect(result).toEqual({ a: "x" });
                expect(bodies).toHaveLength(1);
                expect(bodies[0].response_format).toEqual({
                        type: "json_schema",
                        json_schema: { name: "result", strict: true, schema: SCHEMA },
                });
        });

        test("no schema → the body carries no response_format key at all", async () => {
                mockBridge([{ content: '{"a":1}' }]);
                await chatJson([{ role: "user", content: "u" }]);
                expect(bodies).toHaveLength(1);
                expect("response_format" in bodies[0]).toBe(false);
        });

        test("400 with a schema attached → ONE retry without response_format, then success", async () => {
                mockBridge([{ status: 400 }, { content: '{"a":"recovered"}' }]);
                const result = await chatJson([{ role: "user", content: "u" }], { responseSchema: SCHEMA });
                expect(result).toEqual({ a: "recovered" });
                expect(bodies).toHaveLength(2);
                expect(bodies[0].response_format).toBeDefined();
                expect("response_format" in bodies[1]).toBe(false);
                // The fallback retry keeps the caller's model + token budget.
                expect(bodies[1].model).toBe(bodies[0].model);
                expect(bodies[1].max_tokens).toBe(bodies[0].max_tokens);
        });

        test("the 400 fallback is observable on the bus ('llm:schema-fallback')", async () => {
                const seen: Array<{ event: string; payload: any }> = [];
                const unsub = subscribe((e) => seen.push(e));
                try {
                        mockBridge([{ status: 400 }, { content: '{"a":1}' }]);
                        await chatJson([{ role: "user", content: "u" }], { responseSchema: SCHEMA, model: "local-qwen3-0.6b" });
                } finally {
                        unsub();
                }
                const events = seen.filter((e) => e.event === "llm:schema-fallback");
                expect(events).toHaveLength(1);
                expect(events[0].payload.model).toBe("local-qwen3-0.6b");
                expect(String(events[0].payload.reason)).toContain("llm-bridge 400");
        });

        test("non-400 failure with a schema → no fallback retry, the error propagates", async () => {
                mockBridge([{ status: 500 }]);
                await expect(chatJson([{ role: "user", content: "u" }], { responseSchema: SCHEMA })).rejects.toThrow(
                        "llm-bridge 500",
                );
                expect(bodies).toHaveLength(1); // a 500 is neither transient-retried nor a schema fallback
        });

        test("fallback retry also 400s → the second 400 propagates (never a third call)", async () => {
                mockBridge([{ status: 400 }, { status: 400 }]);
                await expect(chatJson([{ role: "user", content: "u" }], { responseSchema: SCHEMA })).rejects.toThrow(
                        "llm-bridge 400",
                );
                expect(bodies).toHaveLength(2);
        });

        test("the corrective JSON retry keeps the schema attached (opts forwarded wholesale)", async () => {
                mockBridge([{ content: "prose, no json" }, { content: '{"a":1}' }]);
                const result = await chatJson([{ role: "user", content: "u" }], { responseSchema: SCHEMA });
                expect(result).toEqual({ a: 1 });
                expect(bodies).toHaveLength(2);
                expect(bodies[0].response_format).toBeDefined();
                expect(bodies[1].response_format).toEqual(bodies[0].response_format);
        });
});

// ---------------------------------------------------------------------------
// bridge health/log — dead-endpoint fallbacks only (hermetic)
// ---------------------------------------------------------------------------

describe("bridgeHealth / bridgeLog on an unreachable bridge", () => {
        // PI_BRIDGE_URL points at a dead port via ./_env.ts — these only exercise
        // the catch-fallbacks, never the live bridge.
        test("bridgeHealth falls back to { ok: false }", async () => {
                expect(await bridgeHealth()).toEqual({ ok: false });
        });

        test("bridgeLog falls back to an empty log", async () => {
                expect(await bridgeLog()).toEqual({ log: [], requests: 0, errors: 0 });
        });
});
