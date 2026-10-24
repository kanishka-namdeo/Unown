// worktree-session.test.ts — `unown --worktree` (the 2026-10-24 parity
// round): main-session worktrees (src/worktree-session.ts), against a REAL
// git repository in a temp dir (git is a hard dependency; skips gracefully
// when git is missing).
//
// What is pinned:
//   1. withSessionWorktree: the session runs INSIDE the tree (cwd switches),
//      the startup notice names the tree + base, an untouched tree is
//      REMOVED after the session, and the registry records the lifecycle
//   2. a session that writes files leaves the tree KEPT (remove_if_clean),
//      with the cleanup line naming the why + the merge guidance
//   3. fail-closed outside a git repo (typed reason, no silent shared run)
//   4. autoWorktreeName: the bare-flag lane's name shape
//   5. listSessionWorktrees: live status per tree (clean/dirty/commits)
//   6. removeSessionWorktree: removes a kept tree; not_found for unknowns
//   7. runWorktreesCommand: list/remove/usage exit codes
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRegistry } from "../src/worktree.ts";

import {
	autoWorktreeName,
	listSessionWorktrees,
	removeSessionWorktree,
	runWorktreesCommand,
	withSessionWorktree,
} from "../src/worktree-session.ts";
import { TEST_TMP } from "./_env.ts";

function gitAvailable(): boolean {
	try {
		execFileSync("git", ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

const HAS_GIT = gitAvailable();
const roots: string[] = [];

function makeRepo(): string {
	const root = mkdtempSync(join(TEST_TMP, "unown-wt-session-"));
	roots.push(root);
	const run = (cwd: string, args: string[]) =>
		execFileSync("git", args, {
			cwd,
			env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
		});
	run(root, ["init", "--initial-branch=main"]);
	run(root, ["config", "user.email", "test@test.test"]);
	run(root, ["config", "user.name", "Test"]);
	writeFileSync(join(root, "README.md"), "# repo\n");
	run(root, ["add", "."]);
	run(root, ["commit", "-m", "init"]);
	// Windows path normalization (the v0.0.13/v0.0.16 release matrix): the
	// product derives every worktree path from git's `rev-parse --show-toplevel`
	// (the LONG form, runneradmin) while mkdtemp/tmpdir can hand back the 8.3
	// short form (RUNNER~1) that bun's realpathSync does NOT expand — so the
	// test must anchor its comparisons to git's canonical form, the exact
	// form the implementation under test uses. (realpathSync alone was the
	// v0.0.13 fix and it was insufficient: bun's realpath keeps 8.3 components.)
	const out = run(root, ["rev-parse", "--show-toplevel"]).toString().trim();
	return out.length > 0 ? out : realpathSync(root);
}

beforeAll(() => mkdirSync(TEST_TMP, { recursive: true }));
afterAll(() => {
	for (const r of roots) {
		try {
			rmSync(r, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	}
});

describe("withSessionWorktree (real git)", () => {
	test.skipIf(!HAS_GIT)("runs the session inside the tree; untouched tree removed after", async () => {
		const repo = makeRepo();
		const notices: string[] = [];
		const prevCwd = process.cwd();
		let cwdInside: string | null = null;
		process.chdir(repo); // the wrapper resolves process.cwd()
		try {
			const result = await withSessionWorktree(
				"clean-run",
				async (handle) => {
					cwdInside = process.cwd();
					return "ran";
				},
				(line) => notices.push(line),
			);
			expect(result.ok).toBeTrue();
			if (result.ok) {
				expect(result.result.fnResult).toBe("ran");
				expect(result.result.handle.path).toContain(join(repo, ".unown", "worktrees", "clean-run"));
				expect(cwdInside).toBe(result.result.handle.path); // the session ran INSIDE
				expect(notices[0]).toContain("session worktree clean-run");
				expect(notices[1]).toContain("removed");
				// Untouched → gone.
				expect(await listSessionWorktrees(repo)).toHaveLength(0);
				// The journal recorded the lifecycle.
				const ops = readRegistry(repo).map((r) => r.op);
				expect(ops).toContain("spawned");
				expect(ops).toContain("removed");
			}
		} finally {
			process.chdir(prevCwd);
		}
	});

	test.skipIf(!HAS_GIT)("a dirty session keeps the tree with merge guidance", async () => {
		const repo = makeRepo();
		const notices: string[] = [];
		const prevCwd = process.cwd();
		process.chdir(repo); // the wrapper resolves process.cwd()
		try {
			const result = await withSessionWorktree(
				"dirty-run",
				async () => {
					writeFileSync(join(process.cwd(), "notes.txt"), "work in progress\n");
				},
				(line) => notices.push(line),
			);
			expect(result.ok).toBeTrue();
			expect(notices[1]).toContain("kept");
			expect(notices[1]).toContain("1 uncommitted file(s)");
			expect(notices[1]).toContain("nothing was merged automatically");
			// The tree is still there, listed dirty.
			const entries = await listSessionWorktrees(repo);
			expect(entries).toHaveLength(1);
			expect(entries[0].name).toBe("dirty-run");
			expect(entries[0].dirtyFiles).toBe(1);
		} finally {
			process.chdir(prevCwd);
		}
	});

	test.skipIf(!HAS_GIT)("a committing session keeps the tree with commit count", async () => {
		const repo = makeRepo();
		const prevCwd = process.cwd();
		process.chdir(repo); // the wrapper resolves process.cwd()
		try {
			const result = await withSessionWorktree("commit-run", async () => {
				writeFileSync(join(process.cwd(), "feat.txt"), "feat\n");
				execFileSync("git", ["add", "."], { cwd: process.cwd() });
				execFileSync("git", ["-c", "user.email=t@t.t", "-c", "user.name=T", "commit", "-m", "wip"], {
					cwd: process.cwd(),
				});
			});
			expect(result.ok).toBeTrue();
			const entries = await listSessionWorktrees(repo);
			expect(entries[0].newCommits).toBe(1);
			expect(entries[0].dirtyFiles).toBe(0);
		} finally {
			process.chdir(prevCwd);
		}
	});

	test.skipIf(!HAS_GIT)("fail-closed outside a git repo (typed reason, no shared run)", async () => {
		const nowhere = mkdtempSync(join(tmpdir(), "unown-nowhere-"));
		roots.push(nowhere);
		const prevCwd = process.cwd();
		process.chdir(nowhere);
		try {
			let ran = false;
			const result = await withSessionWorktree("x", async () => {
				ran = true;
			});
			expect(result.ok).toBeFalse();
			if (!result.ok) {
				expect(result.reason).toBe("not_a_git_repo");
				expect(ran).toBeFalse(); // never a silent shared-checkout run
			}
		} finally {
			process.chdir(prevCwd);
		}
	});
});

describe("worktrees management CLI", () => {
	test.skipIf(!HAS_GIT)("list shows live status; remove removes; unknown names exit 1", async () => {
		const repo = makeRepo();
		const prevCwd = process.cwd();
		process.chdir(repo);
		try {
			// Create a kept tree via a dirty session.
			await withSessionWorktree("keeper", async () => {
				writeFileSync(join(process.cwd(), "k.txt"), "keep me\n");
			});
			const listCode = await runWorktreesCommand(["list"]);
			expect(listCode).toBe(0);
			// Remove without force fails on a dirty tree (the safety).
			const refused = await removeSessionWorktree(repo, "keeper");
			expect(refused.action).toBe("failed");
			expect(refused.detail).toContain("--force");
			// Force after review removes it.
			const forced = await removeSessionWorktree(repo, "keeper", true);
			expect(forced.action).toBe("removed");
			expect(await listSessionWorktrees(repo)).toHaveLength(0);
			// Unknown name.
			const missing = await removeSessionWorktree(repo, "nope");
			expect(missing.action).toBe("not_found");
		} finally {
			process.chdir(prevCwd);
		}
	});

	test.skipIf(!HAS_GIT)("empty list + usage + unknown subcommand exit codes", async () => {
		const repo = makeRepo();
		const prevCwd = process.cwd();
		process.chdir(repo);
		try {
			expect(await runWorktreesCommand(["list"])).toBe(0);
			expect(await runWorktreesCommand(["help"])).toBe(0);
			expect(await runWorktreesCommand(["bogus"])).toBe(1);
			expect(await runWorktreesCommand(["remove"])).toBe(1);
		} finally {
			process.chdir(prevCwd);
		}
	});
});

describe("autoWorktreeName", () => {
	test("the bare-flag lane's name shape: s-<timestamp36>", () => {
		expect(autoWorktreeName(1729776000000)).toBe("s-m2nbyvpc");
		expect(autoWorktreeName(0)).toBe("s-0");
	});
});

describe("withSessionWorktree exit interception (the cmdPrint contract)", () => {
	test.skipIf(!HAS_GIT)("a session that exits via process.exit still runs cleanup first", async () => {
		const repo = makeRepo();
		const prevCwd = process.cwd();
		process.chdir(repo);
		// Pre-stub the REAL exit so the wrapper's deferred exit cannot kill
		// the test runner — the wrapper captures process.exit (its patch),
		// runs cleanup, then calls what IT captured as real (our stub).
		const realExit = process.exit.bind(process);
		const exits: number[] = [];
		process.exit = ((code?: number) => {
			exits.push(code ?? 0);
		}) as typeof process.exit;
		try {
			const notices: string[] = [];
			const result = await withSessionWorktree(
				"exit-lane",
				async () => {
					// The print/TUI exit shape: the session exits from INSIDE fn.
					process.exit(3);
				},
				(line) => notices.push(line),
			);
			// The wrapper returned (our stub absorbed the deferred exit).
			expect(result.ok).toBeTrue();
			// Cleanup ran before the exit fired — the notice precedes it.
			expect(notices[1]).toContain("removed");
			expect(exits).toEqual([3]); // the session's own code, post-cleanup
		} finally {
			process.exit = realExit;
			process.chdir(prevCwd);
		}
	});
});
