// LR-1 pins (2026-10-27 long-run stress round): the --max-turns exit
// contract at the EMPTY boundary, driven through the real CLI against the
// local mock bridge (the same hermetic pattern as the other test/cli suites).
//
// The defect the round found live: a cap that lands mid-tool-work printed
// TWO contradictory stderr lines — "the answer so far stands" (at cap time,
// before any answer state exists) and then the F11 guard's "the run ended
// without an answer". The fix: the cap note no longer promises an answer,
// and the empty-at-cap exit names the cap explicitly.
//
// Contract under test (docs in cli.ts + the root AGENTS.md exit table):
//   capped + answer     -> exit 0, subtype "success", capped:true
//   capped + no answer  -> exit 1, subtype "error_during_execution",
//                          capped:true, stderr names the cap
import { describe, expect, test } from "bun:test";
import { startMockBridge, unown } from "./helpers.ts";

describe("LR-1: --max-turns at the empty boundary", () => {
        test("a cap that lands mid-tool-work exits 1 and names the cap (never 'answer so far stands')", async () => {
                const bridge = startMockBridge();
                try {
                        // TOOLCALL fires ONCE: turn 1 = a bash tool call (no text), the tool
                        // result comes back, the 2nd message_start aborts (--max-turns 1) —
                        // the last assistant message has no text => empty at cap.
                        const run = await unown(
                                ["-p", 'TOOLCALL bash {"command":"echo hi"}', "--max-turns", "1", "--output-format", "json"],
                                { bridge, env: { UNOWN_NO_PREFLIGHT: "1" } },
                        );
                        expect(run.exitCode).toBe(1);
                        expect(run.stderr).toContain("--max-turns 1 reached");
                        expect(run.stderr).not.toContain("the answer so far stands");
                        expect(run.stderr).toContain("cap hit mid-work");
                        expect(run.stderr).toContain("no answer was produced");
                        const envelope = JSON.parse(run.stdout.trim().split("\n").pop() ?? "{}");
                        expect(envelope.type).toBe("result");
                        expect(envelope.subtype).toBe("error_during_execution");
                        expect(envelope.capped).toBe(true);
                        expect(envelope.result).toBe("");
                } finally {
                        bridge.close();
                }
        });

        test("a capped run whose last settled message carries text recovers it: exit 0, capped_answer_recovered", async () => {
                const bridge = startMockBridge();
                try {
                        // TOOLCALLTEXT: text + the tool call in ONE assistant message — turn 1
                        // settles text, the 2nd start aborts, and pi's print mode prints
                        // NOTHING for the aborted last message. LR-1b: the cap (a CONTROLLED
                        // stop) recovers the last SETTLED assistant text — the documented
                        // "the answer produced so far still prints" contract, now real.
                        const run = await unown(
                                [
                                        "-p",
                                        'TOOLCALLTEXT "Working on it." bash {"command":"echo hi"}',
                                        "--max-turns",
                                        "1",
                                        "--output-format",
                                        "json",
                                ],
                                { bridge, env: { UNOWN_NO_PREFLIGHT: "1" } },
                        );
                        expect(run.exitCode).toBe(0);
                        expect(run.stderr).not.toContain("no answer was produced");
                        const envelope = JSON.parse(run.stdout.trim().split("\n").pop() ?? "{}");
                        expect(envelope.subtype).toBe("success");
                        expect(envelope.capped).toBe(true);
                        expect(envelope.capped_answer_recovered).toBe(true);
                        expect(envelope.result).toBe("Working on it.");
                        expect(envelope.num_turns).toBe(1);
                } finally {
                        bridge.close();
                }
        });

        test("a capped run with NO settled text stays exit 1 with the honest cap message (text lane)", async () => {
                const bridge = startMockBridge();
                try {
                        // Text lane (no --output-format): turn 1 = a tool call only, the cap
                        // aborts turn 2 — nothing to recover, pi prints nothing, the F11
                        // contract holds: empty stdout, loud stderr, exit 1.
                        const run = await unown(["-p", 'TOOLCALL bash {"command":"echo hi"}', "--max-turns", "1"], {
                                bridge,
                                env: { UNOWN_NO_PREFLIGHT: "1" },
                        });
                        expect(run.exitCode).toBe(1);
                        expect(run.stdout.trim()).toBe("");
                        expect(run.stderr).toContain("cap hit mid-work");
                } finally {
                        bridge.close();
                }
        });
});
