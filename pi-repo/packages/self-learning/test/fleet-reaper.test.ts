// Unit tests for src/fleet-reaper.ts — the fleet lifecycle journal + boot
// sweep (Round 3, R3-F4: a crashed parent left live orphans with ZERO trace).
//
// The sweep's decision table is pinned case by case with hand-crafted
// journals: live parent → skip; dead parent + fresh heartbeat (self-written
// by a LIVE child whose /proc cmdline names our session file) → reaped; dead
// parent + stale/absent heartbeat → abandoned (traced); finished → untouched.
// The kill is injected so no real process depends on the assertions, except
// the two live-child pins which spawn a real `bash -c "sleep 30; true # <session>"` (the trailing command defeats bash's exec-optimization, which would replace the cmdline)
// (POSIX-only — Windows has no /proc cmdline probe; its conservative branch
// is pinned as trace-only in the code comments and docs).
import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepStaleFleetChildren } from "../src/fleet-reaper.ts";

const TMP = mkdtempSync(join(tmpdir(), "unown-fleet-reaper-"));
afterAll(() => {
        try {
                rmSync(TMP, { recursive: true, force: true });
        } catch {
                /* best effort */
        }
});

let n = 0;
function freshRepo(): string {
        const repoRoot = join(TMP, `repo-${n++}`);
        rmSync(repoRoot, { recursive: true, force: true });
        return repoRoot;
}

/** A pid that is dead on every test platform (never a real one). */
const DEAD_PID = 999_999;

function fleetDirOf(repoRoot: string): string {
        return join(repoRoot, ".unown", "fleet");
}

function writeJournal(repoRoot: string, entries: Array<Record<string, unknown>>): void {
        const fleetDir = fleetDirOf(repoRoot);
        mkdirSync(fleetDir, { recursive: true });
        writeFileSync(join(fleetDir, "journal.jsonl"), `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`);
}

function journalEntries(repoRoot: string): Array<Record<string, any>> {
        try {
                return readFileSync(join(fleetDirOf(repoRoot), "journal.jsonl"), "utf8")
                        .split("\n")
                        .filter((l) => l.trim())
                        .map((l) => JSON.parse(l));
        } catch {
                return [];
        }
}

function spawnEntry(over: Record<string, unknown> = {}): Record<string, unknown> {
        const repo = `REPO${n}`;
        return {
                op: "spawned",
                id: "kid-1",
                name: "crashkid",
                agent: "slow-runner",
                pid: null,
                parentPid: DEAD_PID,
                sessionFile: `/${repo}/.unown/fleet/sessions/crashkid-kid-1.jsonl`,
                controlFile: `/${repo}/.unown/fleet/kid-1.control.json`,
                askFile: `/${repo}/.unown/fleet/kid-1.ask.json`,
                ts: Date.now(),
                ...over,
        };
}

/** Channel files for kid-1 inside THIS repo's fleet dir (the crash's rot). */
function writeChannelFiles(repoRoot: string): void {
        const fleetDir = fleetDirOf(repoRoot);
        mkdirSync(fleetDir, { recursive: true });
        writeFileSync(join(fleetDir, "kid-1.control.json"), "[]");
        writeFileSync(join(fleetDir, "kid-1.ask.json"), "{}");
}

describe("sweepStaleFleetChildren — guards", () => {
        test("no journal → a no-op boot (the common case)", () => {
                const repoRoot = freshRepo();
                const report = sweepStaleFleetChildren(repoRoot, { env: {} });
                expect(report.ran).toBe(false);
                expect(report.open).toBe(0);
        });

        test("never sweeps inside a subagent (UNOWN_SUBAGENT / fleet env)", () => {
                const repoRoot = freshRepo();
                writeJournal(repoRoot, [spawnEntry()]);
                for (const env of [{ UNOWN_SUBAGENT: "1" }, { UNOWN_FLEET_CONTROL: "/tmp/x.control.json" }]) {
                        const report = sweepStaleFleetChildren(repoRoot, { env });
                        expect(report.ran).toBe(false);
                }
        });

        test("kill-switch UNOWN_FLEET_REAPER=0 disables the sweep", () => {
                const repoRoot = freshRepo();
                writeJournal(repoRoot, [spawnEntry()]);
                const report = sweepStaleFleetChildren(repoRoot, { env: { UNOWN_FLEET_REAPER: "0" } });
                expect(report.ran).toBe(false);
        });
});

describe("sweepStaleFleetChildren — the decision table", () => {
        test("a LIVE parent wins: its children are left alone", () => {
                const repoRoot = freshRepo();
                writeJournal(repoRoot, [spawnEntry({ parentPid: process.pid })]);
                writeChannelFiles(repoRoot);
                const killed: number[] = [];
                const report = sweepStaleFleetChildren(repoRoot, { killPid: (pid) => killed.push(pid), env: {} });
                expect(report.ran).toBe(true);
                expect(report.skippedLiveParent).toContain("kid-1");
                expect(killed).toHaveLength(0);
                // Nothing was cleaned and no terminal record was invented.
                expect(existsSync(join(fleetDirOf(repoRoot), "kid-1.control.json"))).toBe(true);
                expect(journalEntries(repoRoot).some((e) => e.op === "reaped" || e.op === "abandoned")).toBe(false);
        });

        test("dead parent + stale heartbeat → abandoned (traced) + files cleaned", () => {
                const repoRoot = freshRepo();
                const fleetDir = fleetDirOf(repoRoot);
                writeJournal(repoRoot, [spawnEntry()]);
                writeChannelFiles(repoRoot);
                writeFileSync(join(fleetDir, "kid-1.hb.json"), JSON.stringify({ pid: 12345, ts: Date.now() - 60_000 }));
                const killed: number[] = [];
                const report = sweepStaleFleetChildren(repoRoot, { killPid: (pid) => killed.push(pid), env: {} });
                expect(report.abandoned).toContain("kid-1");
                expect(killed).toHaveLength(0);
                expect(journalEntries(repoRoot).some((e) => e.op === "abandoned" && e.id === "kid-1")).toBe(true);
                expect(existsSync(join(fleetDir, "kid-1.control.json"))).toBe(false);
                expect(existsSync(join(fleetDir, "kid-1.ask.json"))).toBe(false);
                expect(existsSync(join(fleetDir, "kid-1.hb.json"))).toBe(false);
        });

        test("dead parent + no heartbeat + dead pid → abandoned (already gone)", () => {
                const repoRoot = freshRepo();
                writeJournal(repoRoot, [spawnEntry({ pid: DEAD_PID })]);
                writeChannelFiles(repoRoot);
                const killed: number[] = [];
                const report = sweepStaleFleetChildren(repoRoot, { killPid: (pid) => killed.push(pid), env: {} });
                expect(report.abandoned).toContain("kid-1");
                expect(killed).toHaveLength(0);
        });

        test.skipIf(process.platform === "win32")(
                "dead parent + fresh heartbeat on a LIVE cmdline-verified child → REAPED",
                () => {
                        const repoRoot = freshRepo();
                        const fleetDir = fleetDirOf(repoRoot);
                        const sessionFile = join(fleetDir, "sessions", "crashkid-kid-1.jsonl");
                        // A real live process whose ps cmdline names the session file —
                        // exactly what a heartbeat-fresh fleet child looks like.
                        const child = spawn("bash", ["-c", `sleep 30; true # ${sessionFile}`]);
                        writeJournal(repoRoot, [spawnEntry({ pid: child.pid, sessionFile })]);
                        writeChannelFiles(repoRoot);
                        writeFileSync(join(fleetDir, "kid-1.hb.json"), JSON.stringify({ pid: child.pid, ts: Date.now() }));
                        const killed: number[] = [];
                        const report = sweepStaleFleetChildren(repoRoot, { killPid: (pid) => killed.push(pid), env: {} });
                        expect(report.reaped).toContain("kid-1");
                        expect(killed).toEqual([child.pid]);
                        expect(journalEntries(repoRoot).some((e) => e.op === "reaped" && e.id === "kid-1")).toBe(true);
                        // The crash's rotting channels are gone.
                        expect(existsSync(join(fleetDir, "kid-1.control.json"))).toBe(false);
                        expect(existsSync(join(fleetDir, "kid-1.ask.json"))).toBe(false);
                        child.kill("SIGKILL");
                },
                { timeout: 20_000 } as const,
        );

        test.skipIf(process.platform === "win32")(
                "dead parent + live cmdline-verified pid WITHOUT heartbeat → REAPED (pre-0.0.26 child, POSIX)",
                () => {
                        const repoRoot = freshRepo();
                        const fleetDir = fleetDirOf(repoRoot);
                        const sessionFile = join(fleetDir, "sessions", "crashkid-kid-1.jsonl");
                        const child = spawn("bash", ["-c", `sleep 30; true # ${sessionFile}`]);
                        writeJournal(repoRoot, [spawnEntry({ pid: child.pid, sessionFile })]);
                        const killed: number[] = [];
                        const report = sweepStaleFleetChildren(repoRoot, { killPid: (pid) => killed.push(pid), env: {} });
                        expect(report.reaped).toContain("kid-1");
                        expect(killed).toEqual([child.pid]);
                        child.kill("SIGKILL");
                },
                { timeout: 20_000 } as const,
        );

        test.skipIf(process.platform === "win32")(
                "fresh heartbeat whose pid no longer matches → abandoned, never a blind kill",
                () => {
                        const repoRoot = freshRepo();
                        const fleetDir = fleetDirOf(repoRoot);
                        writeJournal(repoRoot, [spawnEntry()]);
                        writeChannelFiles(repoRoot);
                        // Fresh ts, pid pointing at nothing we can verify — the
                        // reuse hazard the identity gate exists for.
                        writeFileSync(join(fleetDir, "kid-1.hb.json"), JSON.stringify({ pid: 999_998, ts: Date.now() }));
                        const killed: number[] = [];
                        const report = sweepStaleFleetChildren(repoRoot, { killPid: (pid) => killed.push(pid), env: {} });
                        expect(report.abandoned).toContain("kid-1");
                        expect(killed).toHaveLength(0);
                },
        );

        test("a finished child is untouched — the sweep is idempotent", () => {
                const repoRoot = freshRepo();
                writeJournal(repoRoot, [spawnEntry(), { op: "finished", id: "kid-1", status: "done", ts: Date.now() }]);
                const killed: number[] = [];
                const report = sweepStaleFleetChildren(repoRoot, { killPid: (pid) => killed.push(pid), env: {} });
                expect(report.ran).toBe(true);
                expect(report.open).toBe(0);
                expect(killed).toHaveLength(0);
                // A second sweep of the same journal adds nothing (terminal ops
                // close the entries; append-only stays append-only).
                const second = sweepStaleFleetChildren(repoRoot, { killPid: (pid) => killed.push(pid), env: {} });
                expect(second.open).toBe(0);
                expect(journalEntries(repoRoot)).toHaveLength(2);
        });
});

describe("sweepStaleFleetChildren — orphaned worktree marking", () => {
        test("an adopted worktree whose child was orphaned is marked 'orphaned' and KEPT on disk", () => {
                const repoRoot = freshRepo();
                const treePath = join(repoRoot, ".unown", "worktrees", "slow-runner-kid-1");
                mkdirSync(treePath, { recursive: true });
                writeFileSync(join(treePath, "child-work.txt"), "possible work — human territory");
                // The spawned record the orphan marker reuses for baseCommit.
                const worktreeRegistry = join(repoRoot, ".unown", "worktrees", "registry.jsonl");
                writeFileSync(
                        worktreeRegistry,
                        `${JSON.stringify({
                                op: "spawned",
                                id: "slow-runner-kid-1",
                                path: treePath,
                                baseCommit: "abc123",
                                policy: "remove_if_clean",
                                ts: Date.now(),
                        })}\n`,
                );
                const sessionFile = join(repoRoot, ".unown", "fleet", "sessions", "crashkid-kid-1.jsonl");
                writeJournal(repoRoot, [
                        spawnEntry({ sessionFile }),
                        { op: "worktree", id: "kid-1", path: treePath, ts: Date.now() },
                ]);
                const report = sweepStaleFleetChildren(repoRoot, { env: {} });
                expect(report.orphanedWorktrees).toContain(treePath);
                // The tree is still on disk (kept-tree rule)…
                expect(existsSync(join(treePath, "child-work.txt"))).toBe(true);
                // …and the worktree journal carries the visible orphan record.
                const records = readFileSync(worktreeRegistry, "utf8")
                        .split("\n")
                        .filter((l) => l.trim())
                        .map((l) => JSON.parse(l));
                const orphaned = records.find((r) => r.op === "orphaned");
                expect(orphaned).toBeDefined();
                expect(orphaned.path).toBe(treePath);
                expect(orphaned.baseCommit).toBe("abc123");
                expect(orphaned.reason).toContain("crashed parent");
        });

        test("a worktree amendment whose path is already gone marks nothing", () => {
                const repoRoot = freshRepo();
                const treePath = join(repoRoot, ".unown", "worktrees", "gone-tree");
                writeJournal(repoRoot, [
                        spawnEntry(),
                        { op: "worktree", id: "kid-1", path: treePath, ts: Date.now() },
                ]);
                const report = sweepStaleFleetChildren(repoRoot, { env: {} });
                expect(report.orphanedWorktrees).toHaveLength(0);
        });
});
