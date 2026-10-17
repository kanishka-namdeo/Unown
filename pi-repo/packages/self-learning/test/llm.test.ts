// Unit tests for src/llm.ts — extractJson (the model-response JSON parser).
//
// Task ref: engine unit tests, module 1/4 (llm.ts extractJson: fenced ```json
// blocks, plain JSON, JSON in prose, arrays, malformed). The network functions
// (chat/chatText/chatJson) are only covered on their dead-endpoint fallback
// paths — no live bridge, no paid tokens.
//
// This file imports ./_env.ts FIRST: it redirects PI_SELFLEARNING_* / PI_BRIDGE_URL
// into /tmp fixtures so importing src/llm.ts (which eagerly opens the engine's
// SQLite store via src/store.ts) never touches the live engine state.
//
// Several assertions pin *quirks* rather than ideal behavior (QUIRK/BUG
// comments); the module itself is NOT modified.

import "./_env.ts";
import { TEST_TMP } from "./_env.ts";
import { describe, expect, test } from "bun:test";
import { DATA_DIR } from "../src/store.ts";
import { bridgeHealth, bridgeLog, extractJson } from "../src/llm.ts";

// The shared /tmp redirect root created by importing the store is co-owned
// with the parallel b-suite via test/_env.ts (cleaned by whoever owns it);
// this file only reads it.

test("env redirect is active (never touch the live engine db)", () => {
        // Tripwire: if this fails, ./_env.ts was not the first import and the tests
        // would be running against the live engine store — abort loudly instead.
        // The exact tmpdir root is co-owned with the parallel b-suite (test/_env.ts).
        expect(DATA_DIR.startsWith(TEST_TMP)).toBe(true);
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

        test("QUIRK: braces in the trailing prose corrupt the slice", () => {
                // The span runs from the FIRST '{' to the LAST '}', so a stray '}' after
                // the object makes the extracted slice unparseable.
                const text = 'result {"a":1} done } brace';
                expect(() => extractJson(text)).toThrow(SyntaxError);
        });

        test("QUIRK: two objects in prose are spanned together (not first-wins)", () => {
                const text = '{"a":1} and then {"b":2}';
                expect(() => extractJson(text)).toThrow(SyntaxError);
        });

        test("QUIRK: a fenced block shadows JSON living in the prose", () => {
                // The fence regex wins over the whole text even when the fence has no JSON
                // and valid JSON sits outside it.
                const text = 'prose {"a":1}\n```\nnothing here\n```';
                expect(() => extractJson(text)).toThrow("llm: no JSON object found in response");
        });
});

// ---------------------------------------------------------------------------
// extractJson — arrays (task brief calls these out explicitly)
// ---------------------------------------------------------------------------

describe("extractJson: arrays", () => {
        test("BUG: top-level arrays are unsupported — no object braces means 'not found'", () => {
                // extractJson only looks for '{'...'}' spans, so a bare array response
                // (tasks.ts TaskDef-list style) throws the no-object error instead of
                // returning the array. Pin current behavior (tasks.ts:76-82).
                expect(() => extractJson("[1,2,3]")).toThrow("llm: no JSON object found in response");
                expect(() => extractJson('```json\n[1,2,3]\n```')).toThrow("llm: no JSON object found in response");
                expect(() => extractJson("result: [1,2]")).toThrow("llm: no JSON object found in response");
        });

        test("QUIRK: an array with exactly ONE object silently unwraps to that object", () => {
                // '[{"a":1}]': first '{' is inside the array, last '}' closes the object,
                // so the slice is '{"a":1}' — the array itself is dropped.
                expect(extractJson('[{"a":1}]')).toEqual({ a: 1 });
                expect(extractJson('```json\n[{"a":1}]\n```')).toEqual({ a: 1 });
        });

        test("QUIRK: an array with two objects becomes a malformed slice", () => {
                // Span runs from the first '{' to the last '}' across the ',': invalid JSON.
                expect(() => extractJson('[{"a":1},{"b":2}]')).toThrow(SyntaxError);
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
                // QUIRK: '{"a":1' has an opening brace but no closing one, so it is
                // reported as "no JSON object found" rather than as a parse error.
                expect(() => extractJson('{"a":1')).toThrow("llm: no JSON object found in response");
        });

        test("closing brace before opening brace is rejected", () => {
                expect(() => extractJson("junk } then { bad")).toThrow("llm: no JSON object found in response");
        });

        test("malformed JSON surfaces as a raw SyntaxError (not wrapped)", () => {
                // QUIRK: JSON.parse failures propagate unwrapped — callers see SyntaxError
                // with no llm: prefix, unlike the no-object case.
                expect(() => extractJson('```json\n{"a":}\n```')).toThrow(SyntaxError);
                expect(() => extractJson('{"a":1}}')).toThrow(SyntaxError); // trailing brace included in the span
                expect(() => extractJson('{"a":1,}')).toThrow(SyntaxError); // trailing comma
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
