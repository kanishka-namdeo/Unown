/**
 * worktree.ts — runtime-managed git worktree isolation for subagents
 * (the muse code "worktree fan-out" port; muse docs: "An isolated child gets
 * a managed Git worktree… The request can be rejected when the current
 * profile, workspace, provider, or Git state cannot support isolation. It
 * never silently falls back to the shared checkout.").
 *
 * Unown's contract, pinned by test/worktree.test.ts:
 *
 *   - WORKTREES ARE OPT-IN per spawn (`worktree_isolation: true` on the task
 *     tool). A rejected request is a typed failure — never a silent fallback
 *     to the shared checkout (muse is emphatic; so are we).
 *   - Creation: `git worktree add --detach <repo>/.unown/worktrees/<id> HEAD`
 *     from the parent's HEAD — repo-relative, matching muse's .muse/worktrees.
 *   - Every git probe runs with repository hooks DISABLED (empty core.hooksPath
 *     into a private empty dir) and --no-optional-locks: hostile repo config
 *     must not execute filter/hook commands when WE poke the repo (muse ADR
 *     33406 — they shipped a security fix for exactly this).
 *   - Lifecycle journal: `.unown/worktrees/registry.jsonl` (append-only) —
 *     spawn/commit/keep/quarantine/remove records with base commit + policy.
 *     Ownership after a crash is proven by the journal: unknown trees are
 *     QUARANTINED (renamed aside), never wrongly deleted (muse's own rule).
 *   - Cleanup policy `remove_if_clean` (muse's default): remove when the
 *     tree is unmodified AND carries no unmerged commits; keep + report the
 *     path when it does; a worktree we cannot attribute stays on disk.
 *
 * Cross-platform: git via spawn (shell:false), paths via node:path, hooks
 * disabled by pointing core.hooksPath at a private EMPTY directory (the
 * `/dev/null` trick is not portable to Windows; an empty dir is, and git
 * silently skips missing/empty hook dirs). No Unix-only constructs.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/** Where worktrees live inside a repo (gitignored via the checkpoints
 *  extension's self-healing .unown/.gitignore — added in the same change). */
export function worktreeRoot(repoRoot: string): string {
	return join(repoRoot, ".unown", "worktrees");
}

/** The append-only lifecycle journal (muse's worktree event log analog). */
function registryPath(repoRoot: string): string {
	return join(worktreeRoot(repoRoot), "registry.jsonl");
}

export interface WorktreeRecord {
	/** Event: spawned | kept | removed | quarantined | failed */
	op: string;
	id: string;
	path: string;
	baseCommit: string;
	/** cleanup policy in force (always remove_if_clean today). */
	policy: "remove_if_clean";
	ts: number;
	/** present on kept/quarantined/failed: why. */
	reason?: string;
}

export type WorktreeOp = WorktreeRecord["op"];

function appendRecord(repoRoot: string, record: WorktreeRecord): void {
	const dir = worktreeRoot(repoRoot);
	mkdirSync(dir, { recursive: true });
	writeFileSync(registryPath(repoRoot), `${JSON.stringify(record)}\n`, { flag: "a" });
}

export function readRegistry(repoRoot: string): WorktreeRecord[] {
	try {
		return readFileSync(registryPath(repoRoot), "utf8")
			.split("\n")
			.filter((l) => l.trim().length > 0)
			.map((l) => JSON.parse(l) as WorktreeRecord);
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Safe git invocation
// ---------------------------------------------------------------------------

const GIT_TIMEOUT_MS = 30_000;

/** One private empty hooks dir per process — git pokes with hooks disabled.
 *  Created lazily; reused for every probe (cheap, idempotent). */
let emptyHooksDir: string | null = null;
function hooksDisabledArgs(): string[] {
	if (emptyHooksDir === null) {
		emptyHooksDir = mkdtempSync(join(tmpdir(), "unown-hooks-off-"));
	}
	return ["-c", `core.hooksPath=${emptyHooksDir}`];
}

/** Environment for OUR git probes: strip any inherited GIT_* redirection so
 *  a hostile parent env cannot repoint the repo we operate on. */
function gitEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (v === undefined) continue;
		if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG|NAMESPACE)$/.test(k)) continue;
		env[k] = v;
	}
	return env;
}

export interface GitResult {
	code: number;
	stdout: string;
	stderr: string;
}

/** Run git with hooks disabled + no optional locks; never throws (returns
 *  the exit code + captured output — callers decide what a failure means). */
export function runGit(cwd: string, args: string[]): Promise<GitResult> {
	return new Promise((resolve) => {
		const child = spawn(
			"git",
			[...hooksDisabledArgs(), "--no-optional-locks", ...args],
			{ cwd, shell: false, stdio: ["ignore", "pipe", "pipe"], env: gitEnv() },
		);
		let stdout = "";
		let stderr = "";
		let settled = false;
		const timer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				/* already gone */
			}
		}, GIT_TIMEOUT_MS);
		const finish = (code: number) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		};
		child.stdout.on("data", (d) => (stdout += d.toString()));
		child.stderr.on("data", (d) => (stderr += d.toString()));
		child.on("close", (c) => finish(c ?? 1));
		child.on("error", (err) => {
			stderr += String(err);
			finish(1);
		});
	});
}

/** Repo toplevel for a directory, or null (not a repo / git missing). */
export async function findGitRepo(cwd: string): Promise<string | null> {
	const res = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
	if (res.code !== 0) return null;
	const top = res.stdout.trim();
	return top.length > 0 ? top : null;
}

// ---------------------------------------------------------------------------
// Worktree lifecycle
// ---------------------------------------------------------------------------

export interface WorktreeHandle {
	id: string;
	path: string;
	repoRoot: string;
	baseCommit: string;
}

export type WorktreeCreateResult =
	| { ok: true; handle: WorktreeHandle }
	| { ok: false; reason: "not_a_git_repo" | "git_unavailable" | "create_failed" | "disabled"; detail: string };

/** Isolation enabled? Env gate `UNOWN_WORKTREE_ISOLATION` (default on; the
 *  kill-switch follows the repo's UNOWN_LSP/UNOWN_MCP boolean convention:
 *  0/false/no disables, anything else (incl. empty) leaves it on). */
export function worktreeIsolationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return !/^(0|false|no)$/i.test(env.UNOWN_WORKTREE_ISOLATION ?? "");
}

/** Create an isolated worktree for `id` at the parent repo's HEAD.
 *  Fail-closed: every failure is a typed reason — the caller must surface
 *  it to the model instead of falling back to the shared checkout. */
export async function createWorktree(cwd: string, id: string): Promise<WorktreeCreateResult> {
	if (!worktreeIsolationEnabled()) {
		return { ok: false, reason: "disabled", detail: "worktree isolation is disabled (UNOWN_WORKTREE_ISOLATION=0)" };
	}
	const repoRoot = await findGitRepo(cwd);
	if (repoRoot === null) {
		return { ok: false, reason: "not_a_git_repo", detail: "worktree isolation requires a git repository (cwd is not inside one)" };
	}
	const head = await runGit(repoRoot, ["rev-parse", "HEAD"]);
	if (head.code !== 0 || !head.stdout.trim()) {
		return { ok: false, reason: "create_failed", detail: `could not resolve HEAD: ${head.stderr.trim().slice(0, 200)}` };
	}
	const baseCommit = head.stdout.trim();
	const safeId = id.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 48) || "child";
	const path = join(worktreeRoot(repoRoot), safeId);
	if (existsSync(path)) {
		return { ok: false, reason: "create_failed", detail: `worktree path already exists: ${basename(path)} (retry the spawn for a fresh id)` };
	}
	const created = await runGit(repoRoot, ["worktree", "add", "--detach", path, baseCommit]);
	if (created.code !== 0) {
		appendRecord(repoRoot, { op: "failed", id: safeId, path, baseCommit, policy: "remove_if_clean", ts: Date.now(), reason: created.stderr.trim().slice(0, 300) });
		return { ok: false, reason: "create_failed", detail: `git worktree add failed: ${created.stderr.trim().slice(0, 300)}` };
	}
	appendRecord(repoRoot, { op: "spawned", id: safeId, path, baseCommit, policy: "remove_if_clean", ts: Date.now() });
	return { ok: true, handle: { id: safeId, path, repoRoot, baseCommit } };
}

export interface WorktreeStatus {
	/** Modified/untracked files per `git status --porcelain`. */
	dirtyFiles: string[];
	/** Commits made in the tree since its base. */
	newCommits: number;
	/** HEAD of the tree right now (== base when nothing committed). */
	headCommit: string;
	error?: string;
}

/** Probe a tree: dirtiness + commits since base. Never throws. */
export async function worktreeStatus(handle: WorktreeHandle): Promise<WorktreeStatus> {
	const status = await runGit(handle.path, ["status", "--porcelain"]);
	const head = await runGit(handle.path, ["rev-parse", "HEAD"]);
	if (status.code !== 0 || head.code !== 0) {
		return { dirtyFiles: [], newCommits: 0, headCommit: "", error: "git status/rev-parse failed (worktree missing or corrupt)" };
	}
	const dirtyFiles = status.stdout
		.split(/\r?\n/)
		.map((l) => l.slice(3).trim())
		.filter((l) => l.length > 0);
	const headCommit = head.stdout.trim();
	let newCommits = 0;
	if (headCommit !== handle.baseCommit) {
		const count = await runGit(handle.path, ["rev-list", "--count", `${handle.baseCommit}..${headCommit}`]);
		newCommits = count.code === 0 ? Number.parseInt(count.stdout.trim(), 10) || 0 : 0;
	}
	return { dirtyFiles, newCommits, headCommit };
}

export interface CleanupResult {
	action: "removed" | "kept" | "quarantined" | "left";
	detail: string;
}

/** Cleanup per policy `remove_if_clean`:
 *   - clean + no new commits            → remove (and prune the admin files)
 *   - dirty or unmerged commits present → KEEP + report the path (the user
 *     merges via normal source control — muse merges nothing automatically)
 *   - probe fails (tree missing/corrupt, ownership unproven) → quarantine:
 *     rename aside rather than delete. */
export async function cleanupWorktree(handle: WorktreeHandle): Promise<CleanupResult> {
	const status = await worktreeStatus(handle);
	if (status.error) {
		// Ownership cannot be proven — quarantine, never delete.
		try {
			const quarantined = `${handle.path}.quarantined-${Date.now()}`;
			renameSync(handle.path, quarantined);
			appendRecord(handle.repoRoot, { op: "quarantined", id: handle.id, path: quarantined, baseCommit: handle.baseCommit, policy: "remove_if_clean", ts: Date.now(), reason: status.error });
			return { action: "quarantined", detail: `worktree state unprovable (${status.error}); kept at ${quarantined}` };
		} catch {
			appendRecord(handle.repoRoot, { op: "left", id: handle.id, path: handle.path, baseCommit: handle.baseCommit, policy: "remove_if_clean", ts: Date.now(), reason: `quarantine rename failed: ${status.error}` });
			return { action: "left", detail: `could not quarantine ${handle.path} (${status.error}); left on disk` };
		}
	}
	if (status.dirtyFiles.length > 0 || status.newCommits > 0) {
		const why = [
			status.dirtyFiles.length > 0 ? `${status.dirtyFiles.length} uncommitted file(s)` : null,
			status.newCommits > 0 ? `${status.newCommits} commit(s) ahead of ${handle.baseCommit.slice(0, 10)}` : null,
		]
			.filter(Boolean)
			.join(" + ");
		appendRecord(handle.repoRoot, { op: "kept", id: handle.id, path: handle.path, baseCommit: handle.baseCommit, policy: "remove_if_clean", ts: Date.now(), reason: why });
		return {
			action: "kept",
			detail: `${why}; worktree kept for review/merge at ${handle.path} (nothing was merged automatically — review and merge via your normal source-control workflow, then git worktree remove)`,
		};
	}
	const removed = await runGit(handle.repoRoot, ["worktree", "remove", handle.path]);
	if (removed.code !== 0) {
		// e.g. locked files on Windows — fall back to keep + report.
		appendRecord(handle.repoRoot, { op: "kept", id: handle.id, path: handle.path, baseCommit: handle.baseCommit, policy: "remove_if_clean", ts: Date.now(), reason: `worktree remove failed: ${removed.stderr.trim().slice(0, 200)}` });
		return { action: "kept", detail: `worktree was clean but removal failed (${removed.stderr.trim().slice(0, 200)}); kept at ${handle.path}` };
	}
	await runGit(handle.repoRoot, ["worktree", "prune"]);
	appendRecord(handle.repoRoot, { op: "removed", id: handle.id, path: handle.path, baseCommit: handle.baseCommit, policy: "remove_if_clean", ts: Date.now() });
	return { action: "removed", detail: "worktree was clean with no new commits; removed" };
}
