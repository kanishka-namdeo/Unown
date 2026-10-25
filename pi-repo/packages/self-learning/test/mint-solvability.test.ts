// mint-solvability.test.ts — the mint pipeline's SOLVABILITY GATE (2026-10-25
// live finding), pinned at every seam:
//
//   - validateDraft's reference lane (through authorDraft, the same
//     fetch-mock pattern as mint-cascade.test.ts): a reference must be an
//     object of files-keys -> strings, must never touch a test file (the
//     verify hashes those — a reference touching one is always a rewrite
//     attempt), must not be empty when present, and must respect the
//     per-file cap. A valid reference rides on the def; no reference leaves
//     def.reference undefined (the authored fallback lane's trigger).
//
//   - proveSolvability, the activation gate's decision:
//       * def.reference that PASSES the task's own verify in a real sandbox
//         -> { ok: true, via: "draft" } (the hard-but-solvable case — the
//         capability-eval semantics stay intact).
//       * def.reference that FAILS the verify -> { ok: false } with the
//         "unsolvable as drafted" reason (the live finding's exact shape:
//         the contradictory dropRightWhile test file).
//       * def WITHOUT reference + an authored reference that passes
//         -> { ok: true, via: "authored" } (the one bounded repair call).
//       * def WITHOUT reference + an authored reference that still fails
//         -> { ok: false, unsolvable }.
//       * def WITHOUT reference + junk from the solver lane (unparseable /
//         wrong keys / non-strings) -> { ok: false, unprovable } — the task
//         is REFUSED rather than activated on faith.
//
// The gate's motivation is measured, not hypothetical: minted task
// mint-fix-drop-right-while carried a test file whose line 14
// (dropRightWhile([1,2,3,4], v => v % 2 === 0) === [1,2]) contradicts lines
// 13/15/17/18/19 under every consistent semantics — an independent correct
// implementation fails it (verified live), the agent correctly refused, and
// the pre-gate pipeline activated it anyway as a "capability eval" that
// pickNextTask() then selected FIRST on every cycle, burning one full agent
// run per cycle on an impossible task forever.
//
// Env: ./_env.ts redirects the store to scratch before module scope opens;
// the LLM (chatJson -> chat -> fetch -> bridge) is mocked via globalThis.fetch.
import "./_env.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { authorDraft, proveSolvability } from "../src/mint.ts";
import type { TaskDef } from "../src/tasks.ts";
import { store } from "../src/store.ts";

// ---------------------------------------------------------------------------
// LLM mock (chatJson -> chat -> fetch -> bridge) — one canned reply per call
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;

function mockBridge(replies: Array<Record<string, unknown>>): void {
        globalThis.fetch = (async (_input: unknown, init?: any) => {
                const reply = replies[Math.min(replies.length - 1, replies.length - 1)];
                const content = reply.content ?? JSON.stringify(reply);
                return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] }), {
                        headers: { "content-type": "application/json" },
                });
        }) as typeof fetch;
}

afterEach(() => {
        globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// Fixtures — run-unique ids (the redirected SQLite DB persists across runs)
// ---------------------------------------------------------------------------

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const BROKEN_SRC = `export function clamp(v, lo, hi) {\n\treturn Math.min(hi, Math.max(lo, v + 1)); // BUG: off-by-one\n}\n`;
const SOLVED_SRC = `export function clamp(v, lo, hi) {\n\treturn Math.min(hi, Math.max(lo, v));\n}\n`;
const WRONG_SRC = `export function clamp(v, lo, hi) {\n\treturn v; // "solved" but wrong: no bounds at all\n}\n`;
const TEST_FILE = `import assert from "node:assert/strict";\nimport { clamp } from "./src.js";\nassert.equal(clamp(5, 1, 10), 5);\nassert.equal(clamp(-3, 0, 10), 0);\nassert.equal(clamp(15, 0, 10), 10);\nconsole.log("clamp tests passed");\n`;

function draftWith(id: string, reference: unknown) {
        return {
                id,
                name: "Clamp variant",
                description: "An off-by-one clamp exercise.",
                category: "bugfix",
                difficulty: 2,
                prompt: "Fix the clamp function so the tests pass; the test file describes the expected behaviour.",
                files: { "src.js": BROKEN_SRC, "src.test.mjs": TEST_FILE },
                ...(reference === undefined ? {} : { reference }),
                verifyTestFile: "src.test.mjs",
        };
}

function defFrom(draft: Record<string, unknown>): TaskDef {
        // authorDraft returns the validated def; the test asserts ok upstream.
        return draft as unknown as TaskDef;
}

// ---------------------------------------------------------------------------
// validateDraft's reference lane (through authorDraft)
// ---------------------------------------------------------------------------

describe("validateDraft — the reference lane", () => {
        test("a valid reference rides on the def", async () => {
                mockBridge([{ content: JSON.stringify(draftWith(`cl-${RUN}`, { "src.js": SOLVED_SRC })) }]);
                const out = await authorDraft("author a clamp task");
                expect(out.ok).toBe(true);
                if (out.ok) expect(out.def.reference).toEqual({ "src.js": SOLVED_SRC });
        });

        test("no reference leaves def.reference undefined (the authored lane's trigger)", async () => {
                mockBridge([{ content: JSON.stringify(draftWith(`cl-noref-${RUN}`, undefined)) }]);
                const out = await authorDraft("author a clamp task");
                expect(out.ok).toBe(true);
                if (out.ok) expect(out.def.reference).toBeUndefined();
        });

        test("a reference key not present in files is refused", async () => {
                mockBridge([{ content: JSON.stringify(draftWith(`cl-badkey-${RUN}`, { "other.js": SOLVED_SRC })) }]);
                const out = await authorDraft("author a clamp task");
                expect(out.ok).toBe(false);
                if (!out.ok) expect(out.error).toContain("reference key not in files");
        });

        test("a reference touching the test file is refused (the verify hashes it — always a rewrite attempt)", async () => {
                mockBridge([{ content: JSON.stringify(draftWith(`cl-rewrite-${RUN}`, { "src.test.mjs": "assert.ok(true)" })) }]);
                const out = await authorDraft("author a clamp task");
                expect(out.ok).toBe(false);
                if (!out.ok) expect(out.error).toContain("reference must not touch test files");
        });

        test("an empty reference object is refused", async () => {
                mockBridge([{ content: JSON.stringify(draftWith(`cl-empty-${RUN}`, {})) }]);
                const out = await authorDraft("author a clamp task");
                expect(out.ok).toBe(false);
                if (!out.ok) expect(out.error).toContain("reference must not be empty");
        });

        test("non-string reference content is refused", async () => {
                mockBridge([{ content: JSON.stringify(draftWith(`cl-nonstr-${RUN}`, { "src.js": 42 })) }]);
                const out = await authorDraft("author a clamp task");
                expect(out.ok).toBe(false);
                if (!out.ok) expect(out.error).toContain("reference content must be a string");
        });
});

// ---------------------------------------------------------------------------
// proveSolvability — the activation gate's decision (real sandboxes)
// ---------------------------------------------------------------------------

describe("proveSolvability — the activation gate", () => {
        test("a passing draft reference proves solvability (the hard-but-solvable case keeps capability-eval semantics)", async () => {
                const out = await proveSolvability(defFrom(draftWith(`cl-pass-${RUN}`, { "src.js": SOLVED_SRC })));
                expect(out.ok).toBe(true);
                if (out.ok) expect(out.via).toBe("draft");
        });

        test("a FAILING draft reference is refused as unsolvable — the live finding's exact shape", async () => {
                const out = await proveSolvability(defFrom(draftWith(`cl-fail-${RUN}`, { "src.js": WRONG_SRC })));
                expect(out.ok).toBe(false);
                if (!out.ok) expect(out.reason).toContain("unsolvable as drafted");
        });

        test("no draft reference + an authored reference that passes -> via 'authored'", async () => {
                mockBridge([{ content: JSON.stringify({ reference: { "src.js": SOLVED_SRC } }) }]);
                const out = await proveSolvability(defFrom(draftWith(`cl-auth-${RUN}`, undefined)));
                expect(out.ok).toBe(true);
                if (out.ok) expect(out.via).toBe("authored");
        });

        test("no draft reference + an authored reference that still fails -> unsolvable", async () => {
                mockBridge([{ content: JSON.stringify({ reference: { "src.js": WRONG_SRC } }) }]);
                const out = await proveSolvability(defFrom(draftWith(`cl-authfail-${RUN}`, undefined)));
                expect(out.ok).toBe(false);
                if (!out.ok) expect(out.reason).toContain("unsolvable as drafted");
        });

        test("no draft reference + junk from the solver lane -> unprovable, the task is refused", async () => {
                mockBridge([{ content: JSON.stringify({ nonsense: true }) }]);
                const out = await proveSolvability(defFrom(draftWith(`cl-junk-${RUN}`, undefined)));
                expect(out.ok).toBe(false);
                if (!out.ok) expect(out.reason).toContain("unprovable");
        });

        test("no draft reference + solver lane down (bridge error) -> unprovable, never activated on faith", async () => {
                globalThis.fetch = (async () => {
                        throw new Error("bridge down");
                }) as typeof fetch;
                const out = await proveSolvability(defFrom(draftWith(`cl-down-${RUN}`, undefined)));
                expect(out.ok).toBe(false);
                if (!out.ok) expect(out.reason).toContain("unprovable");
        });
});

// The store redirect sanity check: validateDraft's duplicate-id refusal still
// holds with the reference lane in place (the def above inserted nothing, but
// the lane must not have weakened the id gate).
describe("validateDraft — id uniqueness is untouched by the reference lane", () => {
        test("an id that already exists is still refused", async () => {
                // slugifyId prefixes every minted id with 'mint-' — the seeded
                // collision must use the SLUGGED form to collide.
                const id = `cl-dup-${RUN}`;
                store.run(
                        `INSERT INTO tasks (id, name, description, category, difficulty, prompt, files, verify, created_at, active, origin, status)
                         VALUES (?, 'x', 'x', 'bugfix', 1, 'x', '{}', '', ?, 0, 'minted', 'discarded')`,
                        [`mint-${id}`, Date.now()],
                );
                mockBridge([{ content: JSON.stringify(draftWith(id, { "src.js": SOLVED_SRC })) }]);
                const out = await authorDraft("author a clamp task");
                expect(out.ok).toBe(false);
                if (!out.ok) expect(out.error).toContain("already exists");
        });
});
