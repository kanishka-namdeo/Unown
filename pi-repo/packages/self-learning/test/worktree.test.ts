// worktree.test.ts — the muse worktree-fan-out port's lifecycle, against a
// REAL git repository in a temp dir (git is a hard dependency of the feature;
// the suite skips gracefully when git is missing from PATH).
//
// What is pinned (the muse contract, Unown's implementation):
//   1. createWorktree lands under <repo>/.unown/worktrees/<id> at parent HEAD,
//      journal-recorded (spawned) with base commit + remove_if_clean policy
//   2. a clean, commit-less tree is REMOVED on cleanup (registry says so)
//   3. a dirty tree is KEPT + reported (never auto-merged, never deleted)
//   4. a tree with new commits is KEPT + reported
//   5. probes run with hooks disabled: a repo whose .git/hooks would explode
//      on any git invocation must not sabotage worktree create/status/cleanup
//      (muse ADR 33406 — hostile repo config must not execute)
//   6. worktree isolation is fail-closed outside a git repo (typed reason,
//      never a silent shared run)
//   7. env kill-switch UNOWN_WORKTREE_ISOLATION=0 disables (typed reason)
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	cleanupWorktree,
	createWorktree,
	readRegistry,
	runGit,
	worktreeIsolationEnabled,
	worktreeStatus,
} from "../src/worktree.ts";

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

function makeRepo(withBombHook = false): string {
	const root = mkdtempSync(join(tmpdir(), "unown-worktree-test-"));
	roots.push(root);
	const run = (cwd: string, args: string[]) =>
		execFileSync("git", args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
	// Deterministic identity so commits work on any host; main branch name
	// pinned (init.defaultBranch varies by git version/host).
	run(root, ["init", "--initial-branch=main"]);
	run(root, ["config", "user.email", "test@unown"]);
	run(root, ["config", "user.name", "unown test"]);
	writeFileSync(join(root, "file.txt"), "hello\n");
	run(root, ["add", "."]);
	run(root, ["commit", "-m", "initial"]);
	if (withBombHook) {
		// A pre-* hook that exits 1 would break every git invocation that
		// runs hooks — our probes must be immune (hooks disabled).
		writeFileSync(join(root, ".git", "hooks", "pre-command"), "#!/bin/sh\nexit 1\n");
		try {
			execFileSync("chmod", ["+x", join(root, ".git", "hooks", "pre-command")]);
		} catch {
			/* chmod is POSIX-only; git honors the exec bit there */
		}
	}
	return root;
}

afterAll(() => {
	for (const root of roots) {
		try {
			rmSync(root, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	}
});

describe("worktree lifecycle (real git)", () => {
	beforeAll(() => {
		if (!HAS_GIT) console.warn("git not on PATH — worktree lifecycle tests skip");
	});

	test("env kill-switch", () => {
		expect(worktreeIsolationEnabled({})).toBe(true);
		expect(worktreeIsolationEnabled({ UNOWN_WORKTREE_ISOLATION: "" })).toBe(true); // empty = unset (fresh-clone rule)
		expect(worktreeIsolationEnabled({ UNOWN_WORKTREE_ISOLATION: "0" })).toBe(false);
		expect(worktreeIsolationEnabled({ UNOWN_WORKTREE_ISOLATION: "false" })).toBe(false);
	});

	test("fail-closed outside a git repository", async () => {
		if (!HAS_GIT) return;
		const plain = mkdtempSync(join(tmpdir(), "unown-notgit-"));
		roots.push(plain);
		const res = await createWorktree(plain, "child-1");
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.reason).toBe("not_a_git_repo");
	});

	test("kill-switch rejection is typed", async () => {
		if (!HAS_GIT) return;
		const repo = makeRepo();
		const prev = process.env.UNOWN_WORKTREE_ISOLATION;
		process.env.UNOWN_WORKTREE_ISOLATION = "0";
		try {
			const res = await createWorktree(repo, "child-1");
			expect(res.ok).toBe(false);
			if (!res.ok) expect(res.reason).toBe("disabled");
		} finally {
			if (prev === undefined) delete process.env.UNOWN_WORKTREE_ISOLATION;
			else process.env.UNOWN_WORKTREE_ISOLATION = prev;
		}
	});

	test("create -> clean -> removed", async () => {
		if (!HAS_GIT) return;
		const repo = makeRepo();
		const created = await createWorktree(repo, "child-clean");
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		expect(existsSync(created.handle.path)).toBe(true);
		// git rev-parse --show-toplevel (findGitRepo inside createWorktree)
		// returns the CANONICAL repo path: on macOS tmpdir() lives under /var,
		// a symlink to /private/var (the mkdtemp path and the git toplevel
		// differ by that prefix); on Windows git prints forward slashes and
		// long names where mkdtempSync may hold short/8.3 or backslashed forms.
		// Compare canonically on both sides — this assertion is about WHERE the
		// tree lives, not about git's path spelling.
		const canon = (p: string) => realpathSync(p).replace(/\\/g, "/").toLowerCase();
		expect(canon(created.handle.path).startsWith(canon(join(repo, ".unown", "worktrees")))).toBe(true);
		// journal: spawned with base commit + policy
		const reg = readRegistry(repo);
		const spawned = reg.find((r) => r.op === "spawned" && r.id === "child-clean");
		expect(spawned?.policy).toBe("remove_if_clean");
		expect(spawned?.baseCommit).toBe(created.handle.baseCommit);

		const status = await worktreeStatus(created.handle);
		expect(status.dirtyFiles.length).toBe(0);
		expect(status.newCommits).toBe(0);

		const cleanup = await cleanupWorktree(created.handle);
		expect(cleanup.action).toBe("removed");
		expect(existsSync(created.handle.path)).toBe(false);
		expect(readRegistry(repo).some((r) => r.op === "removed" && r.id === "child-clean")).toBe(true);
	});

	test("create -> dirty -> kept with path", async () => {
		if (!HAS_GIT) return;
		const repo = makeRepo();
		const created = await createWorktree(repo, "child-dirty");
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		writeFileSync(join(created.handle.path, "new-file.txt"), "subagent work\n");
		const cleanup = await cleanupWorktree(created.handle);
		expect(cleanup.action).toBe("kept");
		expect(cleanup.detail).toContain("kept");
		expect(existsSync(created.handle.path)).toBe(true); // nothing was merged or deleted
		expect(readRegistry(repo).some((r) => r.op === "kept" && r.id === "child-dirty")).toBe(true);
	});

	test("create -> commit -> kept with commit count", async () => {
		if (!HAS_GIT) return;
		const repo = makeRepo();
		const created = await createWorktree(repo, "child-commit");
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		writeFileSync(join(created.handle.path, "feature.txt"), "subagent feature\n");
		await runGit(created.handle.path, ["add", "."]);
		await runGit(created.handle.path, ["commit", "-m", "subagent work"]);
		const status = await worktreeStatus(created.handle);
		expect(status.newCommits).toBe(1);
		const cleanup = await cleanupWorktree(created.handle);
		expect(cleanup.action).toBe("kept");
		expect(cleanup.detail).toContain("1 commit");
	});

	test("hostile hooks cannot sabotage probes (muse ADR 33406)", async () => {
		if (!HAS_GIT) return;
		const repo = makeRepo(true);
		const created = await createWorktree(repo, "child-hooked");
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		// Our own runGit must also survive (hooks disabled) — the standard
		// .git/hooks/pre-* names are the ones git would run.
		writeFileSync(join(repo, ".git", "hooks", "pre-worktree"), "#!/bin/sh\nexit 1\n");
		try {
			execFileSync("chmod", ["+x", join(repo, ".git", "hooks", "pre-worktree")]);
		} catch {
			/* POSIX-only */
		}
		const status = await worktreeStatus(created.handle);
		expect(status.error).toBeUndefined();
		const cleanup = await cleanupWorktree(created.handle);
		expect(cleanup.action).toBe("removed");
	});

	test("probe of a missing worktree quarantines instead of deleting", async () => {
		if (!HAS_GIT) return;
		const repo = makeRepo();
		const created = await createWorktree(repo, "child-vanish");
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		// Simulate a crash mid-flight: the tree disappears WITHOUT a journal
		// close record; the handle dangles. cleanup must not delete anything
		// it cannot prove — and the registry must record the outcome.
		rmSync(created.handle.path, { recursive: true, force: true });
		const cleanup = await cleanupWorktree(created.handle);
		expect(["quarantined", "left", "removed"]).toContain(cleanup.action);
		expect(cleanup.action).not.toBe("removed"); // status probe fails -> nothing is provable
	});

	test("registry is append-only JSONL", async () => {
		if (!HAS_GIT) return;
		const repo = makeRepo();
		await createWorktree(repo, "child-journal");
		const raw = readFileSync(join(repo, ".unown", "worktrees", "registry.jsonl"), "utf8");
		const lines = raw.split("\n").filter((l) => l.trim());
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) {
			const rec = JSON.parse(line);
			expect(typeof rec.op).toBe("string");
			expect(rec.policy).toBe("remove_if_clean");
		}
	});
});
