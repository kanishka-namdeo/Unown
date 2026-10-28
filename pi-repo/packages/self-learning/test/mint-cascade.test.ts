// Unit tests for the H10 mint cascade (src/mint.ts authorDraft) — the
// opt-in local-draft → validateDraft → remote-repair topology wired from the
// VERIFIED E8 experiment (benchmarks/local-llm/lib/e8.mjs, results in
// benchmarks/local-llm/results/e8-mint-cascade/e8-cascade.json: accept 6/6 vs
// 5/6 pure-remote, 10.6x cheaper per accepted, blind judge 2W/3T/0L).
//
// What is pinned, per the wiring contract:
//   - PI_MINT_CASCADE unset (default): authorDraft makes ONE chatJson call on
//     the default mint model with NO response_format — byte-identical to the
//     pre-cascade authoring call — and emits no cascade events.
//   - enabled + local draft valid: exactly ONE call (the local draft), no
//     remote call at all, mint:cascade {outcome:"local_valid"} on the bus.
//   - enabled + local draft invalid: exactly ONE repair call (remote mint
//     model, NO responseSchema — the remote upstream does not enforce
//     json_schema keywords, E7/H9) with the E8 4-message structure
//     [system, user, assistant(invalid draft), user(E8 repair text verbatim)];
//     the repaired draft re-enters validateDraft and proceeds.
//   - repair still invalid: {ok:false} with a cascade-aware reason, event
//     outcome "discarded_after_repair".
//   - local call failure (lane down): the repair proceeds with E8's
//     "(the local model returned an empty draft)" placeholder.
//   - the public surface (mintTaskFromRun / mintCurriculumVariant) routes
//     through the same authorDraft step, so both inherit the cascade.
//
// Env: ./_env.ts redirects the store to scratch before module scope opens.
// PI_MINT_CASCADE / PI_MINT_DRAFT_MODEL_ID are read at CALL time in mint.ts
// (the llm.ts bridgeUrl() pattern), so these tests toggle them per case; the
// LLM (chatJson → chat → fetch → bridge) is mocked via globalThis.fetch.
import "./_env.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { authorDraft, mintCurriculumVariant, mintTaskFromRun } from "../src/mint.ts";
import { modelFor } from "../src/llm.ts";
import { subscribe } from "../src/bus.ts";
import { store } from "../src/store.ts";

// ---------------------------------------------------------------------------
// LLM mock (chatJson -> chat -> fetch -> bridge) — one canned reply per call
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
let bodies: any[] = [];

function mockBridge(replies: Array<Record<string, unknown>>): void {
        bodies = [];
        globalThis.fetch = (async (_input: unknown, init?: any) => {
                bodies.push(JSON.parse(String(init?.body ?? "{}")));
                const reply = replies[Math.min(bodies.length - 1, replies.length - 1)];
                const content = reply.content ?? "";
                return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] }), {
                        headers: { "content-type": "application/json" },
                });
        }) as typeof fetch;
}

afterEach(() => {
        globalThis.fetch = realFetch;
        delete process.env.PI_MINT_CASCADE;
        delete process.env.PI_MINT_DRAFT_MODEL_ID;
});

// ---------------------------------------------------------------------------
// Fixtures — run-unique ids (the redirected SQLite DB persists across runs,
// and validateDraft rejects ids that already exist)
// ---------------------------------------------------------------------------

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function validDraft(id: string) {
        return {
                id,
                name: "Debounce variant",
                description: "A harder debounce exercise.",
                category: "implementation",
                difficulty: 3,
                prompt: "Implement the missing behaviour so the tests pass; the test file describes the expected behaviour.",
                files: {
                        "src.js": "export function debounce(fn, ms) {\n\t// deliberately unimplemented\n}\n",
                        "src.test.mjs":
                                "import assert from 'node:assert/strict';\nimport { debounce } from './src.js';\n\ntest('debounces', async () => {\n\tlet n = 0;\n\tconst f = debounce(() => n++, 10);\n\tf();\n\tf();\n\tawait new Promise((r) => setTimeout(r, 30));\n\tassert.equal(n, 1);\n});\n",
                },
                verifyTestFile: "src.test.mjs",
        };
}

/** Deterministically invalid for validateDraft: zero files -> "files must contain 1..6 entries". */
function invalidDraft(id: string) {
        return { ...validDraft(id), files: {} };
}

function reply(draft: unknown): Record<string, unknown> {
        return { content: JSON.stringify(draft) };
}

/** Collect bus events by name while fn runs. */
async function withBusEvents<T>(name: string, fn: () => Promise<T>): Promise<{ result: T; events: any[] }> {
        const events: any[] = [];
        const unsub = subscribe((e) => {
                if (e.event === name) events.push(e.payload);
        });
        try {
                const result = await fn();
                return { result, events };
        } finally {
                unsub();
        }
}

// ---------------------------------------------------------------------------
// Cascade DISABLED (default) — behavior identical to the pre-cascade code
// ---------------------------------------------------------------------------

describe("authorDraft — cascade disabled (default)", () => {
        test("one remote call on the default mint model, no response_format, valid draft proceeds", async () => {
                mockBridge([reply(validDraft(`casc${RUN}off`))]);
                const { result, events } = await withBusEvents("mint:cascade", () => authorDraft("author the variant"));
                expect(result.ok).toBe(true);
                if (result.ok) {
                        expect(result.def.id).toBe(`mint-casc${RUN}off`);
                        // (bracket access — toHaveProperty would parse the dots as a path)
                        expect(result.def.files["src.test.mjs"]).toBeTypeOf("string");
                }
                expect(bodies).toHaveLength(1);
                expect(bodies[0].model).toBe(modelFor("mint"));
                expect("response_format" in bodies[0]).toBe(false);
                // The authoring prompt is unchanged: [system MINT_SYSTEM, user content].
                expect(bodies[0].messages).toHaveLength(2);
                expect(bodies[0].messages[0].role).toBe("system");
                expect(bodies[0].messages[0].content).toContain("You are the task minter of a self-improving coding-agent harness.");
                expect(bodies[0].messages[1]).toEqual({ role: "user", content: "author the variant" });
                expect(events).toHaveLength(0); // no cascade machinery runs at all
        });

        test("invalid remote draft -> {ok:false} with the validator error, exactly one bounded repair pass (F3b)", async () => {
                mockBridge([reply(invalidDraft(`casc${RUN}off2`))]);
                const { result, events } = await withBusEvents("mint:cascade", () => authorDraft("author the variant"));
                expect(result.ok).toBe(false);
                // F3b (2026-10-29): a failed draft gets ONE repair call carrying the
                // validator error; still-invalid keeps the discarded path with a
                // repair-aware reason. Bounded: never a third call.
                if (!result.ok) {
                        expect(result.error).toContain("files must contain 1..6 entries");
                        expect(result.error).toContain("repair pass:");
                }
                expect(bodies).toHaveLength(2);
                expect(bodies[1].messages.at(-1).content).toContain("REJECTED by the harness validator");
                expect(events).toHaveLength(0);
        });
});

// ---------------------------------------------------------------------------
// Cascade ENABLED (PI_MINT_CASCADE=1)
// ---------------------------------------------------------------------------

describe("authorDraft — cascade enabled (PI_MINT_CASCADE=1)", () => {
        test("valid local draft: ONE call total (no remote call), grammar attached, local_valid event", async () => {
                process.env.PI_MINT_CASCADE = "1";
                mockBridge([reply(validDraft(`casc${RUN}on`))]);
                const { result, events } = await withBusEvents("mint:cascade", () => authorDraft("author the variant"));
                expect(result.ok).toBe(true);
                if (result.ok) expect(result.def.id).toBe(`mint-casc${RUN}on`);
                // The whole point of the cascade: a valid local draft never touches the
                // remote API (E8: 5 of 6 drafts were accepted at $0 remote cost).
                expect(bodies).toHaveLength(1);
                expect(bodies[0].model).toBe("local-qwen3-0.6b"); // the local-lane default (bridge local-* convention)
                expect(bodies[0].response_format).toBeDefined();
                expect(bodies[0].response_format.type).toBe("json_schema");
                expect(bodies[0].response_format.json_schema.strict).toBe(true);
                expect(bodies[0].response_format.json_schema.schema).toBeDefined();
                expect(bodies[0].messages).toHaveLength(2); // the UNCHANGED authorDraft prompt
                expect(bodies[0].messages[1]).toEqual({ role: "user", content: "author the variant" });
                expect(events).toHaveLength(1);
                expect(events[0].outcome).toBe("local_valid");
                expect(events[0].draftModel).toBe("local-qwen3-0.6b");
                expect(events[0].repairModel).toBeNull();
        });

        test("PI_MINT_DRAFT_MODEL_ID overrides the draft model", async () => {
                process.env.PI_MINT_CASCADE = "1";
                process.env.PI_MINT_DRAFT_MODEL_ID = "local-granite-4.0-1b";
                mockBridge([reply(validDraft(`casc${RUN}ovr`))]);
                const { events } = await withBusEvents("mint:cascade", () => authorDraft("author the variant"));
                expect(bodies).toHaveLength(1);
                expect(bodies[0].model).toBe("local-granite-4.0-1b");
                expect(events[0].draftModel).toBe("local-granite-4.0-1b");
        });

        test("invalid local draft: exactly ONE repair call with the E8 message structure; repaired draft proceeds", async () => {
                process.env.PI_MINT_CASCADE = "1";
                const bad = invalidDraft(`casc${RUN}bad`);
                const good = validDraft(`casc${RUN}rep`);
                mockBridge([reply(bad), reply(good)]);
                const { result, events } = await withBusEvents("mint:cascade", () => authorDraft("author the variant"));
                expect(result.ok).toBe(true);
                if (result.ok) expect(result.def.id).toBe(`mint-casc${RUN}rep`);
                expect(bodies).toHaveLength(2);
                // Call 1 — the local draft, grammar-constrained.
                expect(bodies[0].model).toBe("local-qwen3-0.6b");
                expect(bodies[0].response_format).toBeDefined();
                // Call 2 — the repair: the existing mint model, NO responseSchema (the
                // remote upstream does not enforce json_schema keywords — E7/H9).
                expect(bodies[1].model).toBe(modelFor("mint"));
                expect("response_format" in bodies[1]).toBe(false);
                // The E8 4-message structure: authoring transcript + invalid draft + repair text.
                const msgs = bodies[1].messages;
                expect(msgs).toHaveLength(4);
                expect(msgs[0].role).toBe("system");
                expect(msgs[1]).toEqual({ role: "user", content: "author the variant" });
                expect(msgs[2].role).toBe("assistant");
                expect(JSON.parse(msgs[2].content)).toEqual(bad); // the invalid draft, stringified
                expect(msgs[3].role).toBe("user");
                // Repair text copied verbatim from e8.mjs (the production validator
                // reports a single error string where E8 joins failReasons with "; ").
                expect(msgs[3].content).toBe(
                        "That draft failed validation with: files must contain 1..6 entries. Return the complete corrected JSON draft only.",
                );
                expect(events).toHaveLength(1);
                expect(events[0]).toMatchObject({ outcome: "repaired", draftModel: "local-qwen3-0.6b", repairModel: modelFor("mint") });
        });

        test("repair still invalid: discarded with a cascade-aware reason + discarded_after_repair event", async () => {
                process.env.PI_MINT_CASCADE = "1";
                mockBridge([reply(invalidDraft(`casc${RUN}r1`)), reply(invalidDraft(`casc${RUN}r2`))]);
                const { result, events } = await withBusEvents("mint:cascade", () => authorDraft("author the variant"));
                expect(result.ok).toBe(false);
                if (!result.ok) {
                        expect(result.error).toContain("cascade repair failed");
                        expect(result.error).toContain("files must contain 1..6 entries"); // the repair's failure
                        expect(result.error).toContain("(local draft failed validation with:"); // …and the local draft's
                }
                expect(bodies).toHaveLength(2); // one local draft + one repair, never more
                expect(events).toHaveLength(1);
                expect(events[0].outcome).toBe("discarded_after_repair");
                expect(events[0].taskId).toBeNull();
        });

        test("local draft call fails outright (lane down): the repair proceeds with E8's empty-draft placeholder", async () => {
                process.env.PI_MINT_CASCADE = "1";
                // First call throws (local server unreachable), then the repair
                // succeeds. The thrown message deliberately does NOT match
                // llm.ts's transient-retry regex, so the local call fails fast
                // instead of retrying 3x with backoff sleeps.
                let calls = 0;
                bodies = [];
                globalThis.fetch = (async (_input: unknown, init?: any) => {
                        calls++;
                        bodies.push(JSON.parse(String(init?.body ?? "{}")));
                        if (calls === 1) throw new Error("no-llm-in-tests");
                        return new Response(
                                JSON.stringify({
                                        choices: [{ message: { role: "assistant", content: JSON.stringify(validDraft(`casc${RUN}ph`) ) }, finish_reason: "stop" }],
                                }),
                                { headers: { "content-type": "application/json" } },
                        );
                }) as typeof fetch;
                const { result, events } = await withBusEvents("mint:cascade", () => authorDraft("author the variant"));
                expect(result.ok).toBe(true);
                expect(bodies).toHaveLength(2);
                expect(bodies[0].model).toBe("local-qwen3-0.6b");
                expect(bodies[1].model).toBe(modelFor("mint"));
                // E8's placeholder, verbatim — the remote model re-authors from the prompt.
                expect(bodies[1].messages[2]).toEqual({ role: "assistant", content: "(the local model returned an empty draft)" });
                expect(bodies[1].messages[3].content).toContain("That draft failed validation with:");
                expect(events[0].outcome).toBe("repaired");
        });
});

// ---------------------------------------------------------------------------
// Public surface — both mint sources route through the same authorDraft step
// (the single insertion point), so both inherit the cascade
// ---------------------------------------------------------------------------

describe("mintCurriculumVariant / mintTaskFromRun — the shared authoring step", () => {
        function seedTask(id: string): string {
                store.run(
                        `INSERT INTO tasks (id, name, description, prompt, files, verify, created_at, active)
                         VALUES (?, 'Seed task', 'seed', 'seed prompt', '{}', 'verify', ?, 1)`,
                        [id, Date.now()],
                );
                return id;
        }

        test("cascade disabled: invalid remote draft -> discarded 'authoring failed:' with the bounded repair pass (F3b default)", async () => {
                const taskId = seedTask(`seed${RUN}c`);
                mockBridge([reply(invalidDraft(`casc${RUN}pub1`))]);
                const outcome = await mintCurriculumVariant(taskId);
                expect(outcome.status).toBe("discarded");
                expect(outcome.reason).toContain("authoring failed: files must contain 1..6 entries");
                expect(outcome.reason).toContain("repair pass:");
                // authoring call + exactly ONE repair call — bounded (F3b)
                expect(bodies).toHaveLength(2);
                expect(bodies[0].model).toBe(modelFor("mint"));
                expect(bodies[1].model).toBe(modelFor("mint"));
                expect("response_format" in bodies[0]).toBe(false);
        });

        test("cascade enabled through mintCurriculumVariant: repair fails -> discarded with the cascade-aware reason", async () => {
                process.env.PI_MINT_CASCADE = "1";
                const taskId = seedTask(`seed${RUN}d`);
                mockBridge([reply(invalidDraft(`casc${RUN}pub2`)), reply(invalidDraft(`casc${RUN}pub3`))]);
                const outcome = await mintCurriculumVariant(taskId);
                expect(outcome.status).toBe("discarded");
                expect(outcome.reason).toContain("authoring failed: cascade repair failed:");
                expect(bodies).toHaveLength(2);
                expect(bodies[0].model).toBe("local-qwen3-0.6b");
                expect(bodies[1].model).toBe(modelFor("mint"));
        });

        test("mintTaskFromRun inherits the cascade through the same authorDraft step", async () => {
                process.env.PI_MINT_CASCADE = "1";
                const taskId = seedTask(`seed${RUN}e`);
                const runId = `run${RUN}e`;
                store.run(
                        `INSERT INTO runs (id, task_id, kind, status, started_at, transcript, verify_output)
                         VALUES (?, ?, 'baseline', 'failed', ?, '[]', '{}')`,
                        [runId, taskId, Date.now()],
                );
                mockBridge([reply(invalidDraft(`casc${RUN}run1`)), reply(invalidDraft(`casc${RUN}run2`))]);
                const { result: outcome, events } = await withBusEvents("mint:cascade", () => mintTaskFromRun(runId));
                expect(outcome.status).toBe("discarded");
                expect(outcome.reason).toContain("authoring failed: cascade repair failed:");
                // The failure-minting source gets the same cascade: local draft + one repair.
                expect(bodies).toHaveLength(2);
                expect(bodies[0].model).toBe("local-qwen3-0.6b");
                expect(bodies[0].response_format).toBeDefined();
                expect(bodies[1].model).toBe(modelFor("mint"));
                expect("response_format" in bodies[1]).toBe(false);
                expect(events).toHaveLength(1);
                expect(events[0].outcome).toBe("discarded_after_repair");
        });
});
