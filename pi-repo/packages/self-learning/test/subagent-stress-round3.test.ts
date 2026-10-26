// Round 3 (2026-10-26) — the subagent stress round THREE summary pins.
//
// The round's three seams (all live-reproduced against agnes-3.0-flash before
// the fixes; see content/blog/ the round's post + the CHANGELOG):
//   R3-F1  stop-while-parked killed the parked child (exit 143, ask-file rot,
//          wrap-up never model-visible) + F1b double result delivery — fixed
//          in fleet-child.ts (unpark with typed cancellation) + fleet-runtime
//          (idempotent finalize, 12s unref'd backstop, channel cleanup).
//   R3-F2  identical-text re-ask swallowed by text-keyed dedup — fixed by the
//          ask INSTANCE identity ((ts, seq)) in fleet-child.ts + tick().
//   R3-F3  worktree safeId entropy stripped by slice(0,48) on long names —
//          fixed by entropy-preserving truncation in worktree.ts (pinned in
//          test/worktree.test.ts).
//   R3-F4  crashed parent left live orphans with ZERO trace — fixed by the
//          lifecycle journal + heartbeat + boot sweep (fleet-reaper.ts; pins
//          in test/fleet-reaper.test.ts) and reaper registration for both
//          subagent lanes (pinned HERE with a real process).
//
// This file pins the cross-module contracts the other files cannot: reaper
// registration through the REAL spawn seam, and the stop-grace constant the
// round's docs promise.
import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedChildrenCount } from "../src/child-reaper.ts";
import { FLEET_STOP_KILL_GRACE_MS } from "../src/fleet.ts";
import { HEARTBEAT_STALE_MS } from "../src/fleet-reaper.ts";
import { FleetManager } from "../src/fleet-runtime.ts";

const TMP = mkdtempSync(join(tmpdir(), "unown-r3-"));
afterAll(() => {
        try {
                rmSync(TMP, { recursive: true, force: true });
        } catch {
                /* best effort */
        }
});

describe("reaper registration (R3-F4): subagent children ride the last-resort reaper", () => {
        test(
                "a fleet child process is tracked from spawn to natural exit",
                async () => {
                        const before = trackedChildrenCount();
                        const manager = new FleetManager({
                                cwd: TMP,
                                fleetDir: join(TMP, "fleet"),
                                // A REAL short-lived process through the REAL spawn
                                // seam — the reaper only tracks genuine ChildProcess
                                // objects (fake harness procs no-op by design).
                                invocation: () => ({ command: "bash", args: ["-c", "sleep 0.4"] }),
                                spawnProc: spawn,
                                timeoutMs: 30_000,
                        });
                        try {
                                const ack = manager.spawnFleetChild({
                                        agent: "prober",
                                        task: "sleep briefly",
                                        routing: {},
                                        systemPrompt: "p",
                                });
                                expect(ack.ok).toBe(true);
                                // Registered AT SPAWN: a SIGINT/SIGTERM/exit of the parent
                                // now SIGTERM→SIGKILLs this child (pre-fix: only LSP/MCP
                                // servers registered — subagents were second-class
                                // citizens).
                                expect(trackedChildrenCount()).toBe(before + 1);
                                // Natural exit → auto-untracked (no leak in the reaper set).
                                await new Promise((r) => setTimeout(r, 1_500));
                                expect(trackedChildrenCount()).toBe(before);
                        } finally {
                                // The suite shares ONE process: a throw before dispose()
                                // leaks a manager into the Symbol registry and poisons
                                // every later drain pin (the v0.0.26 release-run lesson).
                                manager.dispose();
                        }
                },
                { timeout: 20_000 } as const,
        );
});

describe("the round's timing contracts (docs/subagents.md limits table)", () => {
        test("stop backstop grace is 12s — one wrap-up model round trip, unref'd", () => {
                expect(FLEET_STOP_KILL_GRACE_MS).toBe(12_000);
        });

        test("heartbeat freshness window is 5s (the child beats ~1x/s)", () => {
                expect(HEARTBEAT_STALE_MS).toBe(5_000);
        });
});
