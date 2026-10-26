// Cross-module pins for stress round four (2026-10-26) — the sync lane's
// pid-kill orphans. Round 3 gave FLEET children a durable lifecycle journal,
// a ~1x/s child heartbeat, and a boot sweep (fleet-reaper.ts); round 4 extends
// the same contract to SYNC-lane children (runSubagentOnce spawns), whose
// only hygiene was the signal-path child-reaper registration — a SIGKILLed
// parent left them alive with zero trace (live-measured pre-fix: orphan +
// bash grandchild alive, no .unown/fleet, second boot silent).
//
// What this file pins that fleet-reaper.test.ts does not:
//   1. The cross-module timing/env contracts (interval + staleness + env name).
//   2. The vendored bash tool's env strip — a sync child's shell grandchild
//      must never inherit UNOWN_SYNC_HEARTBEAT (it would keep OUR heartbeat
//      file fresh under its own pid and lie to the sweep about which process
//      is the orphan). Source-level contract pin, same spirit as check:claims.
//   3. The fleet manager's journal dir now resolves through subagentJournalDir
//      (git toplevel) — both lanes must meet at ONE journal file or the sync
//      sweep would read a different file than the fleet writes.
//   4. recordSyncSubagentSpawn's entry shape (the lane tag + the prompt-file
//      identity token) — what the sweep's parser keys off.
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
        HEARTBEAT_STALE_MS,
        recordSyncSubagentSpawn,
        readFleetJournal,
        SYNC_HEARTBEAT_ENV,
        SYNC_HEARTBEAT_INTERVAL_MS,
        subagentJournalDir,
} from "../src/fleet-reaper.ts";
import { FleetManager } from "../src/fleet-runtime.ts";

const TMP = mkdtempSync(join(tmpdir(), "unown-stress-r4-"));

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const VENDORED_BASH = join(REPO_ROOT, "pi-repo", "packages", "coding-agent", "src", "core", "tools", "bash.ts");

describe("round 4 — the sync-lane crash-sweep contracts", () => {
        test("the freshness contract is shared by both lanes: 1 s beats, 5 s staleness", () => {
                expect(SYNC_HEARTBEAT_INTERVAL_MS).toBe(1_000);
                expect(HEARTBEAT_STALE_MS).toBe(5_000);
        });

        test("the heartbeat env name is the one the parent sets and the child reads", () => {
                expect(SYNC_HEARTBEAT_ENV).toBe("UNOWN_SYNC_HEARTBEAT");
        });

        test("the vendored bash tool strips the heartbeat env from shell children", () => {
                // A source-level contract pin (the vendored package has no unit
                // seam for its env scrubbing): the strip list must name the sync
                // heartbeat var right beside the fleet channel vars it mirrors.
                expect(existsSync(VENDORED_BASH)).toBe(true);
                const src = readFileSync(VENDORED_BASH, "utf8");
                expect(src).toContain("delete env.UNOWN_FLEET_CONTROL;");
                expect(src).toContain("delete env.UNOWN_SYNC_HEARTBEAT;");
        });

        test("recordSyncSubagentSpawn writes the lane tag + the prompt-file identity token", () => {
                const dir = join(TMP, "journal-shape");
                rmSync(dir, { recursive: true, force: true });
                recordSyncSubagentSpawn(dir, {
                        id: "sync-abc123-def456",
                        name: "general",
                        agent: "general",
                        pid: 4242,
                        parentPid: 4241,
                        promptFile: "/tmp/unown-subagent-Xyz/system-prompt.md",
                        ts: 1_700_000_000_000,
                });
                const entries = readFleetJournal(dir);
                expect(entries).toHaveLength(1);
                expect(entries[0]!.op).toBe("spawned");
                expect((entries[0] as { lane?: string }).lane).toBe("sync");
                expect((entries[0] as { promptFile?: string }).promptFile).toBe("/tmp/unown-subagent-Xyz/system-prompt.md");
                expect((entries[0] as { parentPid?: number }).parentPid).toBe(4241);
        });

        test.skipIf(process.platform === "win32")(
                "the fleet manager journals at the SAME git-toplevel dir the sync sweep reads",
                () => {
                        const repoRoot = join(TMP, "toplevel-meet");
                        rmSync(repoRoot, { recursive: true, force: true });
                        mkdirSync(repoRoot, { recursive: true });
                        const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
                        try {
                                execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: repoRoot, env: gitEnv, stdio: "ignore" });
                        } catch {
                                execFileSync("git", ["init", "-q"], { cwd: repoRoot, env: gitEnv, stdio: "ignore" });
                        }
                        const subdir = join(repoRoot, "packages", "app");
                        mkdirSync(subdir, { recursive: true });
                        // macOS canonicalizes /var → /private/var in git's
                        // toplevel — compare the realpath (test/_env.ts's own
                        // documented pattern), never the literal spelling.
                        const canonical = realpathSync(repoRoot);
                        const manager = new FleetManager({
                                cwd: subdir,
                                invocation: () => ({ command: "unown", args: [] }),
                        });
                        try {
                                expect(manager.fleetDirPath()).toBe(join(canonical, ".unown", "fleet"));
                                expect(manager.fleetDirPath()).toBe(subagentJournalDir(subdir));
                        } finally {
                                manager.dispose();
                        }
                },
        );
});

// Keep the tmp area honest even when a test above fails mid-way.
try {
        writeFileSync(join(TMP, ".keep"), "");
} catch {
        /* best effort */
}
