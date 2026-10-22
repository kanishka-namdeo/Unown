// Unit tests for the sandbox seed-path jail (audit MEDIUM-LOW-1) and crash
// recovery (LOW-2).
//
// ML-1: seedFiles used a bare startsWith(workspace) prefix check —
// resolve("/s/workspace", "../workspace-evil/x") = "/s/workspace-evil/x"
// which DOES start with "/s/workspace", so a crafted path wrote into a
// SIBLING directory, outside the OS jail (bwrap/seatbelt confines
// sandbox.workspace only) and invisible to snapshotFiles. Currently
// unreachable through mint.ts (which blocks ".." upstream) — this is the
// defense-in-depth layer, pinned directly.
//
// LOW-2: recoverOrphans now also heals dreams stuck 'running' (phantom
// in-flight dream on the dashboard) and tasks stuck 'validating' (invisible:
// active=0 with source_run_id set — the lesson silently lost).
import "./_env.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createSandbox, execInSandbox, seedFiles } from "../src/sandbox.ts";
import { SandboxRequiredError } from "../src/bwrap.ts";
import { recoverOrphans } from "../src/server.ts";
import { store } from "../src/store.ts";

describe("seedFiles boundary-aware jail (ML-1)", () => {
        test("in-workspace paths seed normally", () => {
                const sb = createSandbox("jail-ok");
                try {
                        expect(() => seedFiles(sb, { "a.js": "x", "nested/dir/b.js": "y" })).not.toThrow();
                        expect(readFileSync(join(sb.workspace, "a.js"), "utf8")).toBe("x");
                        expect(readFileSync(join(sb.workspace, "nested/dir/b.js"), "utf8")).toBe("y");
                } finally {
                        rmSync(sb.root, { recursive: true, force: true });
                }
        });

        test("REJECTED: a sibling directory sharing the workspace prefix (the old bare startsWith let this through)", () => {
                // resolve(workspace, "../workspace-evil/x.js") lives OUTSIDE the workspace
                // but its path starts with the workspace string — the exact ML-1 escape.
                const sb = createSandbox("jail-prefix");
                const sibling = join(join(sb.root, ".."), `${join("/", "workspace").split("/").pop()}-evil`);
                try {
                        expect(() => seedFiles(sb, { "../workspace-evil/x.js": "pwn" })).toThrow(/escapes sandbox/);
                        // And nothing was written outside the sandbox.
                        expect(existsSync(join(sibling, "x.js"))).toBe(false);
                } finally {
                        rmSync(sb.root, { recursive: true, force: true });
                        rmSync(sibling, { recursive: true, force: true });
                }
        });

        test("REJECTED: a plain parent traversal", () => {
                const sb = createSandbox("jail-parent");
                try {
                        expect(() => seedFiles(sb, { "../escape.js": "pwn" })).toThrow(/escapes sandbox/);
                        expect(existsSync(join(sb.root, "escape.js"))).toBe(false);
                } finally {
                        rmSync(sb.root, { recursive: true, force: true });
                }
        });
});

describe("recoverOrphans (LOW-2)", () => {
        test("heals orphaned runs, cycles, dreams and unvalidated minted tasks", () => {
                const runId = randomUUID();
                const cycleId = randomUUID();
                const dreamId = `dream-${randomUUID()}`;
                const taskId = `task-${randomUUID().slice(0, 8)}`;
                store.run(
                        `INSERT INTO runs (id, task_id, kind, status, started_at) VALUES (?, ?, 'baseline', 'running', ?)`,
                        [runId, taskId, Date.now()],
                );
                store.run(
                        `INSERT INTO cycles (id, task_id, status, iteration, created_at) VALUES (?, ?, 'running', 1, ?)`,
                        [cycleId, taskId, Date.now()],
                );
                store.run(`INSERT INTO dreams (id, started_at, status, notes_in) VALUES (?, ?, 'running', 3)`, [dreamId, Date.now()]);
                store.run(
                        `INSERT INTO tasks (id, name, description, prompt, files, verify, status, active, source_run_id, created_at) VALUES (?, 'n', 'd', 'p', '{}', 'v', 'validating', 0, ?, ?)`,
                        [taskId, runId, Date.now()],
                );

                recoverOrphans();

                expect(store.get(`SELECT status FROM runs WHERE id = ?`, [runId])!.status).toBe("error");
                expect(store.get(`SELECT status FROM cycles WHERE id = ?`, [cycleId])!.status).toBe("no-fix");
                const dream = store.get(`SELECT status, note FROM dreams WHERE id = ?`, [dreamId])!;
                expect(dream.status).toBe("error");
                expect(String(dream.note)).toContain("orphaned by service restart");
                // A task that never finished validating is discarded — visible and
                // consistent, not stuck-invisible with its lesson lost.
                expect(store.get(`SELECT status FROM tasks WHERE id = ?`, [taskId])!.status).toBe("discarded");

                // Idempotent: a second pass changes nothing.
                recoverOrphans();
                expect(store.get(`SELECT status FROM dreams WHERE id = ?`, [dreamId])!.status).toBe("error");
        });

        test("does not touch completed rows", () => {
                const dreamId = `dream-${randomUUID()}`;
                store.run(`INSERT INTO dreams (id, started_at, ended_at, status, notes_in) VALUES (?, ?, ?, 'finished', 3)`, [
                        dreamId,
                        Date.now(),
                        Date.now(),
                ]);
                recoverOrphans();
                expect(store.get(`SELECT status FROM dreams WHERE id = ?`, [dreamId])!.status).toBe("finished");
        });
});

// ---------------------------------------------------------------------------
// SA-B1 — the UNOWN_SANDBOX_REQUIRED fail-closed knob on the engine exec
// path (execInSandbox; the second seam, runner.ts runAgent's agent-shell
// guard, is the same decideSandboxFallback composition pinned in
// bwrap.test.ts). The UNOWN_OS_SANDBOX=0 kill-switch forces the degraded
// state deterministically on EVERY host — including hosts where a real
// bwrap/seatbelt backend exists — so these tests never depend on (and never
// spawn) the host's OS sandbox. That forced state is exactly what a
// native-Windows host always is: no backend, 'process' isolation.
// ---------------------------------------------------------------------------
describe("execInSandbox — UNOWN_SANDBOX_REQUIRED fail-closed knob (SA-B1)", () => {
        const SAVED_OS = process.env.UNOWN_OS_SANDBOX;
        const SAVED_REQ = process.env.UNOWN_SANDBOX_REQUIRED;

        afterEach(() => {
                if (SAVED_OS === undefined) delete process.env.UNOWN_OS_SANDBOX;
                else process.env.UNOWN_OS_SANDBOX = SAVED_OS;
                if (SAVED_REQ === undefined) delete process.env.UNOWN_SANDBOX_REQUIRED;
                else process.env.UNOWN_SANDBOX_REQUIRED = SAVED_REQ;
        });

        test("knob unset (default): the degraded exec still RUNS — transparent fallback unchanged", async () => {
                process.env.UNOWN_OS_SANDBOX = "0"; // force the degrade on every host
                delete process.env.UNOWN_SANDBOX_REQUIRED;
                const sb = createSandbox("knob-off");
                try {
                        const res = await execInSandbox(sb, [process.execPath, "-e", "0"], { timeoutMs: 15_000 });
                        expect(res.isolation).toBe("process");
                        expect(res.exitCode).toBe(0);
                } finally {
                        rmSync(sb.root, { recursive: true, force: true });
                }
        });

        test("knob armed: the degraded exec REFUSES with the typed error (the Windows story, forced)", async () => {
                process.env.UNOWN_OS_SANDBOX = "0";
                process.env.UNOWN_SANDBOX_REQUIRED = "1";
                const sb = createSandbox("knob-on");
                try {
                        try {
                                await execInSandbox(sb, [process.execPath, "-e", "0"], { timeoutMs: 15_000 });
                                expect.unreachable("execInSandbox must throw when the knob is armed and no OS sandbox exists");
                        } catch (err: any) {
                                expect(err).toBeInstanceOf(SandboxRequiredError);
                                expect(err.name).toBe("SandboxRequiredError");
                                expect(err.message).toContain("UNOWN_SANDBOX_REQUIRED");
                                expect(err.message).toContain("UNOWN_OS_SANDBOX=0"); // the contradictory kill-switch is called out
                        }
                } finally {
                        rmSync(sb.root, { recursive: true, force: true });
                }
        });

        test('knob accepts "true" as well as "1"', async () => {
                process.env.UNOWN_OS_SANDBOX = "0";
                process.env.UNOWN_SANDBOX_REQUIRED = "true";
                const sb = createSandbox("knob-true");
                try {
                        await expect(execInSandbox(sb, [process.execPath, "-e", "0"], { timeoutMs: 15_000 })).rejects.toThrow(
                                /UNOWN_SANDBOX_REQUIRED/,
                        );
                } finally {
                        rmSync(sb.root, { recursive: true, force: true });
                }
        });
});

