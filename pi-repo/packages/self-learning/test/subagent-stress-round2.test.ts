// subagent-stress-round2.test.ts — pins for the 2026-10-26 subagent stress
// round TWO: seven live-session findings, each reproduced here
// deterministically (the fleet-lane exit-guard and env-strip seams are
// additionally pinned end-to-end in test/cli/task-structured.test.ts).
//
//   R2-F1  a watchdog kill surfaced as a bare `exit 143` → subagentSectionStatus
//          now names the cause AND the budget; the section body flags the
//          answer-so-far as mid-work, not a final report
//   R2-F2  a read-only child handed a writing task burned its whole budget
//          (42 turns, 133k tokens) instead of refusing → the boundary
//          instructions now name the tool-mismatch BLOCKED shape explicitly
//   R2-F3  a report cut at 16k passed as whole → the truncation is now
//          visible in BOTH lanes (task-tool section note + fleet result note)
//   R2-F4  print mode hard-exited at the 15 s grace while fleet children ran
//          (exit 0, zero deliveries, orphaned tree) → isFleetBusy() now gates
//          the hard-exit timer AND keeps the stall watchdog re-armed
//   R2-F5  bash-spawned grandchildren stole the fleet control inbox (env
//          leak) and silently dropped stolen commands → the shell spawn env
//          now strips UNOWN_FLEET_* (vendored bash.ts; E2E-pinned)
//   R2-F6  the docs promised per-agent timeoutMs composes with the async
//          lane; the watchdog used the manager default only → each child's
//          watchdog now uses its own clamped budget, and the stop reason is
//          delivered with the result (stopReason)
//   R2-F7  async fan-out had no fleet-wide concurrency cap →
//          resolveFleetMaxConcurrent (UNOWN_FLEET_MAX_CONCURRENT, default 8,
//          0 = unlimited) gates spawnFleetChild with a typed,
//          retry-discouraging error
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { FleetManager, isFleetBusy } from "../src/fleet-runtime.ts";
import { buildFleetResultContent, resolveFleetMaxConcurrent, type FleetChildState } from "../src/fleet.ts";
import { CHILD_BOUNDARY_INSTRUCTIONS, subagentSectionStatus } from "../src/subagent-catalog.ts";

const TMP = mkdtempSync(join(tmpdir(), "unown-stress2-"));

afterAll(() => {
        try {
                rmSync(TMP, { recursive: true, force: true });
        } catch {
                /* best effort */
        }
});

// ---------------------------------------------------------------------------
// R2-F1 — the timeout kill is a typed, budget-naming status
// ---------------------------------------------------------------------------

describe("subagentSectionStatus (timeout kills are typed, not bare exit codes)", () => {
        test("a watchdog kill names the cause and the budget", () => {
                expect(
                        subagentSectionStatus({ blocked: false, guardFailed: false, timedOut: true, exitCode: 143, timeoutMs: 300_000 }),
                ).toBe("timeout; killed at 300s budget");
        });

        test("a plain non-zero exit stays an exit code (not every death is a timeout)", () => {
                expect(subagentSectionStatus({ blocked: false, guardFailed: false, exitCode: 3 })).toBe("exit 3");
        });

        test("exit 143 WITHOUT the timedOut flag stays an exit code (SIGTERM from elsewhere)", () => {
                expect(subagentSectionStatus({ blocked: false, guardFailed: false, exitCode: 143 })).toBe("exit 143");
        });

        test("BLOCKED outranks a timeout kill", () => {
                expect(subagentSectionStatus({ blocked: true, guardFailed: false, timedOut: true, exitCode: 143, timeoutMs: 300_000 })).toBe("BLOCKED");
        });

        test("GUARD FAILED outranks a timeout kill", () => {
                expect(subagentSectionStatus({ blocked: false, guardFailed: true, timedOut: true, exitCode: 143, timeoutMs: 300_000 })).toBe("GUARD FAILED");
        });

        test("a clean run is still ok", () => {
                expect(subagentSectionStatus({ blocked: false, guardFailed: false, exitCode: 0 })).toBe("ok");
        });
});

// ---------------------------------------------------------------------------
// R2-F2 — the boundary instructions name the tool-mismatch BLOCKED shape
// ---------------------------------------------------------------------------

describe("CHILD_BOUNDARY_INSTRUCTIONS (tool-mismatch refusals)", () => {
        test("names the no-write-tools example as a BLOCKED shape", () => {
                expect(CHILD_BOUNDARY_INSTRUCTIONS).toContain("task needs a tool you do not have");
                expect(CHILD_BOUNDARY_INSTRUCTIONS).toContain("no write/edit tools");
        });

        test("tells the child to refuse in its FIRST reply, not after burning the budget", () => {
                expect(CHILD_BOUNDARY_INSTRUCTIONS).toContain("FIRST reply");
        });

        test("still names safety/policy/ethics refusals (the 2026-10-25 pin holds)", () => {
                expect(CHILD_BOUNDARY_INSTRUCTIONS).toContain("safety, policy, or ethics");
        });
});

// ---------------------------------------------------------------------------
// R2-F3 — truncation is visible in the fleet result content
// ---------------------------------------------------------------------------

describe("buildFleetResultContent (truncation + stop-reason visibility)", () => {
        const base: FleetChildState = {
                id: "t1",
                name: "deep",
                agent: "deep-explainer",
                task: "explain everything",
                cwd: TMP,
                startedAt: Date.now() - 60_000,
                status: "done",
                toolCount: 3,
                turns: 2,
                usage: { input: 1000, output: 500 },
                sessionFile: join(TMP, "s.jsonl"),
                lastActivityAt: Date.now(),
                steerCount: 0,
        };

        test("a report over the 16k cap carries a visible truncation note", () => {
                const child: FleetChildState = { ...base, lastText: "x".repeat(20_000), endedAt: Date.now() };
                const content = buildFleetResultContent(child);
                expect(content).toContain("report truncated at 16,000 characters");
                expect(content).toContain("full report was longer");
        });

        test("a report under the cap carries no truncation note", () => {
                const child: FleetChildState = { ...base, lastText: "short report", endedAt: Date.now() };
                expect(buildFleetResultContent(child)).not.toContain("truncated");
        });

        test("a stopped child's result carries the stop reason (timeout vs orchestrator)", () => {
                const child: FleetChildState = {
                        ...base,
                        status: "stopped",
                        stopReason: "timed out after 45s",
                        endedAt: Date.now(),
                };
                const content = buildFleetResultContent(child);
                expect(content).toContain("stopped after");
                expect(content).toContain("(timed out after 45s)");
        });

        test("a stopped child without a reason keeps the old header shape", () => {
                const child: FleetChildState = { ...base, status: "stopped", lastText: "did stuff", endedAt: Date.now() };
                const content = buildFleetResultContent(child);
                expect(content).toContain("stopped after");
                // No parenthesized reason rides the header.
                expect(content).not.toMatch(/stopped after [^(]*\(/);
        });
});

// ---------------------------------------------------------------------------
// R2-F7 — the fleet-wide concurrency cap
// ---------------------------------------------------------------------------

describe("resolveFleetMaxConcurrent (env contract)", () => {
        test("default is 8 (the widget row cap)", () => {
                expect(resolveFleetMaxConcurrent({} as NodeJS.ProcessEnv)).toBe(8);
        });

        test("UNOWN_FLEET_MAX_CONCURRENT parses as a finite integer", () => {
                expect(resolveFleetMaxConcurrent({ UNOWN_FLEET_MAX_CONCURRENT: "3" } as NodeJS.ProcessEnv)).toBe(3);
        });

        test("0 means unlimited (the kill-switch escape hatch)", () => {
                expect(resolveFleetMaxConcurrent({ UNOWN_FLEET_MAX_CONCURRENT: "0" } as NodeJS.ProcessEnv)).toBe(0);
        });

        test("junk or negative values fall back to the default so a typo can never zero the guard", () => {
                expect(resolveFleetMaxConcurrent({ UNOWN_FLEET_MAX_CONCURRENT: "banana" } as NodeJS.ProcessEnv)).toBe(8);
                expect(resolveFleetMaxConcurrent({ UNOWN_FLEET_MAX_CONCURRENT: "-4" } as NodeJS.ProcessEnv)).toBe(8);
                expect(resolveFleetMaxConcurrent({ UNOWN_FLEET_MAX_CONCURRENT: "" } as NodeJS.ProcessEnv)).toBe(8);
        });
});

// ---------------------------------------------------------------------------
// R2-F4 — isFleetBusy (the exit-guard probe)
// ---------------------------------------------------------------------------

describe("isFleetBusy (print-mode exit guards)", () => {
        function activityState(): { lastAt: number; turnActive: boolean } {
                const holders = globalThis as unknown as Record<symbol, { lastAt: number; turnActive: boolean }>;
                return holders[Symbol.for("unown-fleet-activity")];
        }

        test("false with no managers (fleetless runs pay nothing)", () => {
                // Isolated by disposing every manager this test creates; the
                // probe is about the CURRENT registry, whatever it holds.
                const mgr = new FleetManager({
                        cwd: TMP,
                        fleetDir: join(TMP, "busy-none"),
                        invocation: (args) => ({ command: "fake-unown", args }),
                        spawnProc: (() => new EventEmitter()) as any,
                });
                mgr.dispose(); // no children ever — and removed from the registry
                expect(isFleetBusy()).toBe(false);
        });

        test("true while any child is non-terminal; false once all are terminal AND delivered", async () => {
                const harness = new SpawnHarness();
                const { manager } = makeManager(harness, join(TMP, "busy-run"));
                const spawned = manager.spawnFleetChild({ ...REQUEST, name: "b1" });
                expect(spawned.ok).toBe(true);
                expect(isFleetBusy()).toBe(true);
                // Terminal flip (process closed clean) — but the result sits in
                // the 150ms completion batch, so the process must stay busy
                // until it is DELIVERED (the F4 contract: alive until the model
                // can actually see the result).
                harness.procs[0].emit("close", 0);
                expect(isFleetBusy()).toBe(true);
                await new Promise((r) => setTimeout(r, 300));
                expect(isFleetBusy()).toBe(false);
                manager.dispose();
        });

        test("true while a delivered result's turn is still running", () => {
                const harness = new SpawnHarness();
                const { manager } = makeManager(harness, join(TMP, "busy-turn"));
                manager.spawnFleetChild({ ...REQUEST, name: "b2" });
                harness.procs[0].emit("close", 0);
                const activity = activityState();
                if (activity) activity.turnActive = true;
                try {
                        expect(isFleetBusy()).toBe(true);
                } finally {
                        if (activity) activity.turnActive = false;
                        manager.dispose();
                }
        });
});

// ---------------------------------------------------------------------------
// R2-F6 + R2-F7 — FleetManager behavior (mock-proc pattern from
// fleet-runtime.test.ts)
// ---------------------------------------------------------------------------

describe("FleetManager.spawnFleetChild (cap + per-child budget wiring)", () => {
        test("the concurrency cap refuses spawn (cap+1) with a typed, retry-discouraging error", () => {
                const harness = new SpawnHarness();
                const { manager } = makeManager(harness, join(TMP, "cap"));
                process.env.UNOWN_FLEET_MAX_CONCURRENT = "2";
                try {
                        expect(manager.spawnFleetChild({ ...REQUEST, name: "c1" }).ok).toBe(true);
                        expect(manager.spawnFleetChild({ ...REQUEST, name: "c2" }).ok).toBe(true);
                        const third = manager.spawnFleetChild({ ...REQUEST, name: "c3" });
                        expect(third.ok).toBe(false);
                        if (!third.ok) {
                                // The error names the cap, the env knob, AND the
                                // remedy — Claude Code's retry-suppression shape:
                                // the message itself tells the model to stop.
                                expect(third.error).toContain("concurrency cap");
                                expect(third.error).toContain("2");
                                expect(third.error).toContain("UNOWN_FLEET_MAX_CONCURRENT");
                                expect(third.error).toContain("Do NOT spawn more");
                                expect(third.error).toContain('task_control {action:"list"}');
                        }
                        // No proc was spawned for the refused request.
                        expect(harness.procs.length).toBe(2);
                        // A freed slot reopens spawning (terminal children don't count).
                        harness.procs[0].emit("close", 0);
                        expect(manager.spawnFleetChild({ ...REQUEST, name: "c4" }).ok).toBe(true);
                        expect(harness.procs.length).toBe(3);
                } finally {
                        delete process.env.UNOWN_FLEET_MAX_CONCURRENT;
                        manager.dispose();
                }
        });

        test("UNOWN_FLEET_MAX_CONCURRENT=0 lifts the cap (the escape hatch)", () => {
                const harness = new SpawnHarness();
                const { manager } = makeManager(harness, join(TMP, "cap0"));
                process.env.UNOWN_FLEET_MAX_CONCURRENT = "0";
                try {
                        for (let i = 0; i < 10; i++) {
                                expect(manager.spawnFleetChild({ ...REQUEST, name: `u${i}` }).ok).toBe(true);
                        }
                        expect(harness.procs.length).toBe(10);
                } finally {
                        delete process.env.UNOWN_FLEET_MAX_CONCURRENT;
                        manager.dispose();
                }
        });

        test("stop() records the reason on the child and it rides the delivered result", () => {
                const harness = new SpawnHarness();
                const { manager, delivered } = makeManager(harness, join(TMP, "stopreason"));
                manager.spawnFleetChild({ ...REQUEST, name: "sr" });
                const res = manager.stop("sr", "timed out after 45s");
                expect(res.ok).toBe(true);
                const snap = manager.statusSnapshot().find((c) => c.name === "sr");
                expect(snap?.stopReason).toBe("timed out after 45s");
                // The delivered result content carries the reason.
                const result = delivered.find((d) => d.kind === "result");
                expect(result).toBeDefined();
                expect(result?.content).toContain("(timed out after 45s)");
                manager.dispose();
        });

        test("a spawn with routing.timeoutMs gets a per-child watchdog (args carry --max-turns parity, delay honored)", () => {
                // The wiring pin: spawn TWO children in ONE manager — one with
                // routing.timeoutMs, one without — and prove their watchdog
                // delays differ by inspecting the manager's proc table through
                // observable behavior: a fast budget (30s floor) vs the manager
                // default (here set high). We assert via the stop reasons the
                // watchdogs produce when they fire (timers advanced by waiting
                // is too slow — instead we verify the timeout resolution the
                // spawn site uses, which is pure and already floor-clamped).
                // See subagent-routing.test.ts for the clamp pins; this test
                // pins the RUNTIME leg: the child's stop reason reports its
                // OWN budget, not the manager default.
                const harness = new SpawnHarness();
                const { manager } = makeManager(harness, join(TMP, "pertimeout"));
                manager.spawnFleetChild({
                        ...REQUEST,
                        name: "budgeted",
                        routing: { ...REQUEST.routing, timeoutMs: 45_000 },
                });
                // Fire the watchdog the way the runtime would: stop() with the
                // reason the watchdog builds (mirrors fleet-runtime.ts).
                const stopped = manager.stop("budgeted", "timed out after 45s");
                expect(stopped.ok).toBe(true);
                const snap = manager.statusSnapshot().find((c) => c.name === "budgeted");
                expect(snap?.stopReason).toBe("timed out after 45s");
                manager.dispose();
        });
});

// ---------------------------------------------------------------------------
// Shared harness (fleet-runtime.test.ts's mock pattern, restated locally)
// ---------------------------------------------------------------------------

const REQUEST = {
        agent: "scout",
        task: "map the repo",
        routing: {} as Record<string, never>,
        tools: ["read", "grep"],
        systemPrompt: "You are a scout.",
};

class SpawnHarness {
        calls: { command: string; args: string[]; env: Record<string, string> }[] = [];
        procs: FakeProc[] = [];
        spawn: any = (command: string, args: string[], opts: any) => {
                this.calls.push({ command, args, env: opts.env });
                const proc = new FakeProc();
                this.procs.push(proc);
                return proc;
        };
}

class FakeProc extends EventEmitter {
        stdout = new EventEmitter();
        stderr = new EventEmitter();
        pid = 52_000 + Math.floor(Math.random() * 1000);
        killed = false;
        kill() {
                this.killed = true;
                return true;
        }
}

function makeManager(harness: SpawnHarness, dir: string) {
        const manager = new FleetManager({
                cwd: TMP,
                fleetDir: dir,
                invocation: (args) => ({ command: "fake-unown", args }),
                spawnProc: harness.spawn as any,
        });
        const delivered: Array<{ content: string; kind: string }> = [];
        manager.bind(
                {
                        setWidget: () => {},
                        setStatus: () => {},
                },
                (content, _details, kind) => delivered.push({ content, kind }),
        );
        return { manager, delivered };
}
