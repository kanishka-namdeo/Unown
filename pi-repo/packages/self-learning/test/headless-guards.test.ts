// headless-guards.test.ts — the CI-round headless hardening:
// --max-turns (src/max-turns.ts) and --output-schema (src/output-schema.ts).
//
// Coverage contract: the turn cap parses/validates, counts agent_start
// events, aborts the (N+1)th turn via ctx.abort and never crashes on a
// missing ctx; the schema loader reads/parses/shape-checks with actionable
// errors; the answer extractor strips ONE code fence, parses JSON, reports
// parse failures as schema issues; validation folds the dependency-free
// validator (valid, invalid-with-JSON-paths, malformed schema never
// crashes); the failure renderer caps its output.
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { TEST_TMP } from "./_env.ts";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createMaxTurnsGuard, parseMaxTurns } from "../src/max-turns.ts";
import { loadOutputSchema, parseAnswerJson, renderSchemaFailure, stripCodeFence, validateAnswerAgainstSchema } from "../src/output-schema.ts";

const TMP: string[] = [];
afterEachTmp();
function afterEachTmp() {
    // bun:test has no global afterEach import here; called manually at the end.
}

describe("parseMaxTurns", () => {
    test("positive integers pass; zero/negative/floats/junk are usage errors", () => {
        expect(parseMaxTurns("3").ok).toBe(true);
        expect(parseMaxTurns("1").ok).toBe(true);
        for (const bad of ["0", "-1", "1.5", "abc", ""]) {
            const r = parseMaxTurns(bad);
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.error).toContain("--max-turns");
        }
    });
});

describe("createMaxTurnsGuard", () => {
    /** Fire n ASSISTANT message_start events (one per model call) + the
     *  non-assistant events the guard must ignore (user messages, tool
     *  results, agent_start — the agent-loop bracket that is NOT a turn). */
    function fireTurns(guard: ReturnType<typeof createMaxTurnsGuard>, n: number, withCtx = true) {
        const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
        guard.extension.factory({
            on: (name: string, h: (event: unknown, ctx: unknown) => void) => {
                handlers[name] = h as (event: unknown, ctx: unknown) => void;
            },
        });
        let aborted = 0;
        const ctx = withCtx ? { abort: () => (aborted += 1) } : undefined;
        handlers["agent_start"]?.({ type: "agent_start" }, ctx); // NOT a turn
        handlers["message_start"]?.({ type: "message_start", message: { role: "user", content: "hi" } }, ctx); // NOT a turn
        for (let i = 0; i < n; i++) {
            handlers["message_start"]?.({ type: "message_start", message: { role: "assistant" } }, ctx);
        }
        return { aborted };
    }

    test("model turns under the cap never abort; the (N+1)th assistant message_start aborts once", () => {
        const guard = createMaxTurnsGuard(3);
        const under = fireTurns(guard, 3);
        expect(under.aborted).toBe(0);
        expect(guard.state.turns).toBe(3);
        expect(guard.state.capped).toBe(false);
        const over = fireTurns(guard, 2); // assistant turns 4 and 5
        expect(over.aborted).toBe(1); // aborted exactly once (the 4th)
        expect(guard.state.capped).toBe(true);
        expect(guard.state.turns).toBe(5);
    });

    test("non-assistant events never count (user messages / agent-loop brackets)", () => {
        const guard = createMaxTurnsGuard(1);
        const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
        guard.extension.factory({
            on: (name: string, h: (event: unknown, ctx: unknown) => void) => {
                handlers[name] = h as (event: unknown, ctx: unknown) => void;
            },
        });
        handlers["agent_start"]?.({ type: "agent_start" }, {});
        handlers["message_start"]?.({ type: "message_start", message: { role: "user", content: "x" } }, {});
        handlers["message_start"]?.({ type: "message_start", message: { role: "toolResult" } }, {});
        expect(guard.state.turns).toBe(0);
        expect(guard.state.capped).toBe(false);
    });

    test("onCapped fires once with the cap value", () => {
        const seen: number[] = [];
        const guard = createMaxTurnsGuard(2, (n) => seen.push(n));
        fireTurns(guard, 5);
        expect(seen).toEqual([2]);
    });

    test("a missing ctx (or missing abort) never crashes the counter", () => {
        const guard = createMaxTurnsGuard(1);
        expect(() => fireTurns(guard, 3, false)).not.toThrow();
        expect(guard.state.capped).toBe(true);
    });
});

describe("loadOutputSchema", () => {
    // TEST_TMP, not a hardcoded "/tmp" — the literal POSIX path does not exist
    // on Windows (mkdtemp ENOENT, caught by the v0.0.10 release matrix).
    const dir = mkdtempSync(join(TEST_TMP, "unown-schema-"));
    TMP.push(dir);

    test("reads + shape-checks a valid schema", () => {
        const f = join(dir, "ok.json");
        writeFileSync(f, JSON.stringify({ type: "object", properties: { name: { type: "string" } }, required: ["name"] }));
        const r = loadOutputSchema(f);
        expect(r.ok).toBe(true);
    });
    test("missing file / bad JSON / bad shape are actionable errors", () => {
        expect(loadOutputSchema(join(dir, "nope.json")).ok).toBe(false);
        const f = join(dir, "bad.json");
        writeFileSync(f, "{nope");
        const r = loadOutputSchema(f);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toContain("not valid JSON");
        const f2 = join(dir, "shape.json");
        writeFileSync(f2, JSON.stringify("not an object"));
        expect(loadOutputSchema(f2).ok).toBe(false);
    });
});

describe("answer extraction (fences + parse)", () => {
    test("bare JSON passes through", () => {
        expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
        expect(parseAnswerJson('{"a":1}').ok).toBe(true);
    });
    test("ONE wrapping ```json fence is stripped; prose+fence survives", () => {
        expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
        const padded = 'Here you go:\n```json\n{"a":1}\n```\nEnjoy.';
        // Padded text: the fence regex does not match (prose around it) — the
        // parse then fails honestly. That is the documented leniency bound.
        expect(parseAnswerJson(padded).ok).toBe(false);
    });
    test("empty / non-JSON answers are parse failures with clear messages", () => {
        const r = parseAnswerJson("");
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toContain("empty");
        const r2 = parseAnswerJson("just text, no braces");
        expect(r2.ok).toBe(false);
        if (!r2.ok) expect(r2.error).toContain("not valid JSON");
    });
});

describe("validateAnswerAgainstSchema", () => {
    const schema = { type: "object", properties: { name: { type: "string" }, count: { type: "number" } }, required: ["name"] };

    test("a valid answer passes; the parsed data comes back", () => {
        const v = validateAnswerAgainstSchema('{"name":"unown","count":3}', schema);
        expect(v.valid).toBe(true);
        expect((v.data as any).name).toBe("unown");
    });
    test("a fenced valid answer passes (the LLM padding lane)", () => {
        const v = validateAnswerAgainstSchema('```json\n{"name":"x"}\n```', schema);
        expect(v.valid).toBe(true);
    });
    test("schema violations carry JSON paths", () => {
        const v = validateAnswerAgainstSchema('{"name":42}', { type: "object", properties: { name: { type: "string" } } });
        expect(v.valid).toBe(false);
        expect(v.issues.some((i) => i.includes("$.name"))).toBe(true);
    });
    test("missing required keys are issues", () => {
        const v = validateAnswerAgainstSchema("{}", schema);
        expect(v.valid).toBe(false);
        expect(v.issues.join("\n")).toContain("name");
    });
    test("a non-JSON answer reports the parse failure as an issue", () => {
        const v = validateAnswerAgainstSchema("hello world", schema);
        expect(v.valid).toBe(false);
        expect(v.issues[0]).toContain("not valid JSON");
    });
    test("a hostile schema never crashes the validator", () => {
        // Weird subschemas are handled (this one validates trivially — the
        // property is absent and not required); the contract is TOTALITY:
        // any input returns a boolean, never a throw.
        let threw = false;
        let valid: boolean | undefined;
        try {
            valid = validateAnswerAgainstSchema("{}", { type: "object", properties: { a: null } }).valid;
        } catch {
            threw = true;
        }
        expect(threw).toBe(false);
        expect(typeof valid).toBe("boolean");
        // And the deep-recursion cap: a 200-deep anyOf chain returns, not hangs.
        let deep: any = { type: "string" };
        for (let i = 0; i < 200; i++) deep = { anyOf: [deep, { type: "number" }] };
        expect(() => validateAnswerAgainstSchema('"x"', deep)).not.toThrow();
    });
});

describe("renderSchemaFailure", () => {
    test("caps at eight issues with an honest +N line", () => {
        const issues = Array.from({ length: 12 }, (_, i) => `$.a[${i}]: expected string`);
        const text = renderSchemaFailure(issues);
        expect(text).toContain("12 issue(s)");
        expect(text).toContain("… +4 more");
        expect(text).not.toContain("$.a[11]");
    });
});

// Manual cleanup (no global afterEach import needed at this size).
test("cleanup fixture dirs", () => {
    for (const d of TMP) rmSync(d, { recursive: true, force: true });
});
