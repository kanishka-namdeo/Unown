// Unit tests for the mineFailure status guard (M6-4, audit M4-c D3: the
// exported miner accepted passed runs — mining a success mints "lessons"
// from nothing that then ride every future system prompt).
//
// The guard fires BEFORE any LLM call, so these tests are spend-free and
// need no bridge: they construct RunResult literals and assert the throw.
// The happy path (status='failed' reaches the LLM) is covered live by
// test/e6-local-mining.ts against a real failed run.
//
// _env.ts first: harness.ts opens the store at module load.

import "./_env.ts";
import { describe, expect, test } from "bun:test";
import { mineFailure } from "../src/harness.ts";
import type { RunResult } from "../src/runner.ts";

const baseRun = (over: Partial<RunResult>): RunResult => ({
        id: "run-x",
        status: "failed",
        transcript: [],
        sandboxId: "sbx",
        tokensIn: 0,
        tokensOut: 0,
        toolCalls: 0,
        turns: 0,
        lastAssistantText: "",
        toolsUsed: [],
        durationMs: 1000,
        ...over,
});

const task = { id: "t", name: "T", difficulty: 1, prompt: "p" };

describe("mineFailure — the mines-failures-only guard", () => {
        test("passed run -> throws before any LLM spend", async () => {
                const err = await mineFailure(task as any, baseRun({ status: "passed", verify: { passed: true, summary: "ok", log: "ok" } })).catch((e: Error) => e);
                expect(err).toBeInstanceOf(Error);
                expect(String((err as Error).message)).toContain("not a mineable failure");
                expect(String((err as Error).message)).toContain("status=passed");
        });

        test("errored run (infra-dead) -> throws", async () => {
                const err = await mineFailure(task as any, baseRun({ status: "error" })).catch((e: Error) => e);
                expect(String((err as Error).message)).toContain("status=error");
        });

        test("status='failed' but verify claims passed (inconsistent hand-built run) -> throws", async () => {
                const err = await mineFailure(task as any, baseRun({ verify: { passed: true, summary: "", log: "" } })).catch((e: Error) => e);
                expect(String((err as Error).message)).toContain("verify.passed=true");
        });

        test("a genuine failed run passes the guard (fails later on the dead-bridge lane, NOT on the guard)", async () => {
                // _env.ts points PI_BRIDGE_URL at a dead port, so the LLM call
                // rejects — the point is the error is a BRIDGE error, proving the
                // guard let the failed run through to the mining lane. Explicit
                // 120s timeout: chat()'s transient-retry ladder against a dead
                // port (2s+4s backoff) plus the mining pipeline exceeds bun's
                // 5s default on loaded 2-vCPU CI runners (the detachment suite
                // hit the same class — see test/detachment.test.ts).
                const err = await mineFailure(task as any, baseRun({ verify: { passed: false, summary: "nope", log: "assert failed" } })).catch((e: Error) => e);
                expect(err).toBeInstanceOf(Error);
                expect(String((err as Error).message)).not.toContain("not a mineable failure");
        }, 120_000);
});
