// mint-caps.test.ts — the F3/F3b pins (the validation round, 2026-10-29):
// the authoring prompt must STATE the size caps validateDraft enforces, and
// a failed draft gets exactly ONE bounded repair pass.
//
// F3: on a saturated suite, `POST /api/tasks/mint` minted a curriculum
// variant whose draft was discarded by validateDraft with
// "name/description/prompt exceed size caps" — every time, blind: the
// MINT_SYSTEM authoring prompt never mentioned the caps (name <= 80,
// description <= 300, prompt <= 2000), so a verbose model authored past
// them and the mint lane dead-ended (no task can enter the suite while
// the suite is saturated — the self-improvement loop loses its expansion
// path exactly when it needs one).
//
// F3b (measured live after the F3 fix): the next mint's draft failed at a
// different shape seam ("id/name/description/prompt must be non-empty") —
// the remote model's draft authoring is flaky at the JSON-shape level, not
// just the size level. The fix: authorDraft's non-cascade path now makes
// exactly ONE repair call carrying the invalid draft + the validator's
// error, then re-validates; still-invalid keeps the discarded path with a
// repair-aware reason.
//
// Env: ./_env.ts redirects the store to scratch before module scope opens;
// the LLM (chatJson -> chat -> fetch -> bridge) is mocked sequentially.
import "./_env.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { authorDraft, MINT_SYSTEM } from "../src/mint.ts";

const realFetch = globalThis.fetch;
let calls = 0;

/** Sequential bridge mock: replies[i] answers the (i+1)-th chat call. */
function mockBridgeSequential(replies: Array<Record<string, unknown>>): void {
        calls = 0;
        globalThis.fetch = (async (_input: unknown, _init?: any) => {
                const reply = replies[Math.min(calls, replies.length - 1)];
                calls += 1;
                const content = reply.content ?? JSON.stringify(reply);
                return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] }), {
                        headers: { "content-type": "application/json" },
                });
        }) as typeof fetch;
}

afterEach(() => {
        globalThis.fetch = realFetch;
});

const VALID_DRAFT = {
        id: "f3-pin-caps-repair",
        name: "Caps repair pin",
        description: "A tiny valid draft exercising the repair lane.",
        category: "bugfix",
        difficulty: 2,
        prompt: "Fix the broken function so the test file passes.",
        files: {
                "src.js": "export const broken = () => 1;\n",
                "src.test.mjs": 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { broken } from "./src.js";\ntest("broken", () => assert.equal(broken(), 2));\n',
        },
        verifyTestFile: "src.test.mjs",
};

describe("F3 pin — the mint authoring prompt states the size caps it enforces", () => {
        test("the prompt names the size caps explicitly", () => {
                expect(MINT_SYSTEM).toContain("SIZE CAPS");
                expect(MINT_SYSTEM).toMatch(/name at most 80 characters/);
                expect(MINT_SYSTEM).toMatch(/description at most 300 characters/);
                expect(MINT_SYSTEM).toMatch(/prompt at most 2000 characters/);
        });

        test("the prompt warns that the harness rejects over-cap drafts", () => {
                expect(MINT_SYSTEM).toContain("REJECTS drafts over these");
        });

        test("the prompt still carries the core task contract (no regression)", () => {
                expect(MINT_SYSTEM).toContain("exactly ONE test file");
                expect(MINT_SYSTEM).toContain("must NOT leak the solution");
                expect(MINT_SYSTEM).toContain("Return STRICT JSON only");
        });
});

describe("F3b pin — one bounded repair pass on a failed draft", () => {
        test("an over-cap first draft is repaired by the second call", async () => {
                mockBridgeSequential([
                { ...VALID_DRAFT, name: "x".repeat(200), description: "y".repeat(400) },
                VALID_DRAFT,
        ]);
                const out = await authorDraft("author a task");
                expect(out.ok).toBe(true);
                expect(calls).toBe(2); // exactly one authoring call + one repair call
        });

        test("an empty-fields first draft is repaired by the second call", async () => {
                mockBridgeSequential([
                { ...VALID_DRAFT, id: "", name: "", description: "", prompt: "" },
                VALID_DRAFT,
        ]);
                const out = await authorDraft("author a task");
                expect(out.ok).toBe(true);
                expect(calls).toBe(2);
        });

        test("a draft that fails BOTH passes discards with a repair-aware reason", async () => {
                mockBridgeSequential([{ ...VALID_DRAFT, id: "", name: "" }]);
                const out = await authorDraft("author a task");
                expect(out.ok).toBe(false);
                if (!out.ok) {
                        expect(out.error).toContain("must be non-empty");
                        expect(out.error).toContain("repair pass:");
                }
                expect(calls).toBe(2); // bounded: never a third call
        });

        test("a valid first draft makes exactly one call (no repair spend)", async () => {
                mockBridgeSequential([VALID_DRAFT]);
                const out = await authorDraft("author a task");
                expect(out.ok).toBe(true);
                expect(calls).toBe(1);
        });
});
