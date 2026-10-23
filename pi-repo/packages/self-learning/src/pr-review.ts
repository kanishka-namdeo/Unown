/**
 * pr-review.ts — `/review` PR URL/number support (Milestone 3.3).
 *
 * Reverse-engineered from opencode's `plugin/command/review.txt:18-27` which
 * invokes `gh pr view` / `gh pr diff` for PR-shaped input. The existing
 * `/review` (in review.ts) already supports a base-branch arg. This module
 * extends it to ALSO accept:
 *
 *   - A PR URL: `https://github.com/owner/repo/pull/123`
 *   - A PR number with optional repo: `#123` or `owner/repo#123`
 *   - A commit range: `abc1234..def5678`
 *
 * When given a PR URL/number, the review flow:
 *   1. `gh pr view <PR> --json title,body,baseRefName,headRefName,files,additions,deletions`
 *      fetches PR metadata.
 *   2. `gh pr diff <PR>` fetches the diff.
 *   3. The existing parallel-subagent review runs over the diff.
 *   4. Optionally posts the verdict as a PR comment (with `--comment`).
 *
 * Purity contract:
 *   - `node:child_process` + `node:fs` + `node:path` only. No pi imports, no
 *     bus, no store. The `which` binary check is injectable via `WhichFn` so
 *     tests run hermetically (mirrors `lsp.ts:commandExists`'s no-spawn
 *     posture). The spawn runner is injectable via `SpawnFn` so tests verify
 *     the exact `gh` args without forking a process.
 *   - Tolerant: a missing `gh` binary surfaces the actionable error message
 *     specified by the task spec, never a stack trace.
 *
 * Composition: `review.ts:captureReviewTarget` calls `parseReviewTarget` on
 * its `base` arg; when the result is `pr-url` or `pr-number`, it delegates
 * here instead of running `git diff` directly.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ReviewTargetKind = "branch" | "pr-url" | "pr-number" | "commit-range" | "diff-path";

export interface ParsedReviewTarget {
    kind: ReviewTargetKind;
    /** The original (trimmed) input string — passed to `gh` verbatim. */
    value: string;
}

export interface PrMetadata {
    title: string;
    body: string;
    baseRef: string;
    headRef: string;
    /** List of file paths touched by the PR. */
    files: string[];
    additions: number;
    deletions: number;
}

// ---------------------------------------------------------------------------
// Actionable error (thrown by the fetchers when gh is missing/unavailable)
// ---------------------------------------------------------------------------

/** The exact actionable message required by the Milestone 3.3 spec. */
export const GH_MISSING_MESSAGE =
    "GitHub CLI (gh) is required for PR review. Install from https://cli.github.com/.";

/** Thrown when `gh` is not on PATH — surfaces the actionable message above. */
export class GhUnavailableError extends Error {
    constructor(message: string = GH_MISSING_MESSAGE) {
        super(message);
        this.name = "GhUnavailableError";
    }
}

// ---------------------------------------------------------------------------
// parseReviewTarget — pure classifier (no fs, no spawn)
// ---------------------------------------------------------------------------

/** GitHub PR URL: `https://github.com/owner/repo/pull/123` (with optional query/anchor). */
const GITHUB_PR_URL = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i;
/** PR number for the current repo: `#123`. */
const PR_NUMBER_HASH = /^#(\d+)$/;
/** PR number with explicit repo: `owner/repo#123`. */
const PR_NUMBER_REPO = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)#(\d+)$/;
/** Commit range with hash refs: `abc1234..def5678` (4-40 hex chars per side). */
const COMMIT_RANGE_HEX = /^[0-9a-f]{4,40}\.\.[0-9a-f]{4,40}$/i;
/** Commit range with named refs: `feature..main` (non-empty identifier-ish refs). */
const REF_RANGE = /^([A-Za-z0-9._/-]+)\.\.([A-Za-z0-9._/-]+)$/;

/**
 * Classify a `/review` argument into one of:
 *
 *   - `pr-url`        — `https://github.com/owner/repo/pull/123`
 *   - `pr-number`     — `#123` (current repo) OR `owner/repo#123`
 *   - `commit-range`  — `abc1234..def5678` OR `feature..main`
 *   - `branch`        — bare branch name (`main`, `feature/branch`)
 *   - `diff-path`     — never returned here; the caller (captureReviewTarget)
 *                       reclassifies a `branch` whose value resolves to an
 *                       existing file as a `diff-path`. Pure: no fs lookup.
 *
 * Pure and synchronous — no fs / no spawn — so unit tests are hermetic.
 */
export function parseReviewTarget(input: string): ParsedReviewTarget {
    const value = (input ?? "").trim();
    if (!value) return { kind: "branch", value: "" };
    if (GITHUB_PR_URL.test(value)) return { kind: "pr-url", value };
    if (PR_NUMBER_REPO.test(value)) return { kind: "pr-number", value };
    if (PR_NUMBER_HASH.test(value)) return { kind: "pr-number", value };
    if (COMMIT_RANGE_HEX.test(value) || REF_RANGE.test(value)) return { kind: "commit-range", value };
    return { kind: "branch", value };
}

// ---------------------------------------------------------------------------
// which / spawn seams (injectable for tests)
// ---------------------------------------------------------------------------

/** A `which`-style lookup: returns the resolved path or null when absent. */
export type WhichFn = (cmd: string) => string | null;

/** A spawn runner that returns the captured stdout/stderr/exit code. */
export type SpawnFn = (cmd: string, args: string[], opts: SpawnOpts) => SpawnResult;

export interface SpawnOpts {
    cwd?: string;
    /** Kill the child after this many ms. */
    timeout?: number;
    /** Max bytes to buffer per stream (matches spawnSync's maxBuffer). */
    maxBuffer?: number;
}

export interface SpawnResult {
    ok: boolean;
    /** Process exit code; -1 for spawn-level failures. */
    code: number;
    stdout: string;
    stderr: string;
    /** Spawn-level failure kind (mirrors review.ts:GitResult.spawnError). */
    spawnError?: "ENOENT" | "ETIMEDOUT" | "MAXBUFFER" | "SPAWN_FAILED";
}

/**
 * Default `which` — pure fs PATH scan, no `which` subprocess (mirrors
 * `lsp.ts:commandExists`). Accepts an env override so tests can point PATH
 * at a fixture directory; the default reads `process.env`.
 */
export function defaultWhich(
    cmd: string,
    env: Record<string, string | undefined> = process.env,
): string | null {
    if (!cmd) return null;
    // Absolute / relative path: resolve directly.
    if (cmd.includes("/") || (process.platform === "win32" && cmd.includes("\\"))) {
        for (const candidate of withExeExtensions(cmd)) {
            if (existsSync(candidate)) return candidate;
        }
        return null;
    }
    const pathValue = env.PATH ?? env.Path ?? "";
    if (!pathValue) return null;
    const sep = process.platform === "win32" ? ";" : ":";
    for (const dir of pathValue.split(sep)) {
        if (!dir) continue;
        for (const candidate of withExeExtensions(join(dir, cmd))) {
            if (existsSync(candidate)) return candidate;
        }
    }
    return null;
}

function withExeExtensions(filePath: string): string[] {
    if (process.platform !== "win32") return [filePath];
    const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";");
    return exts.filter(Boolean).map((ext) => filePath + ext.toLowerCase());
}

/**
 * Default spawn runner — `spawnSync` with array args (no shell), bounded
 * buffering, stdout/stderr decoded SEPARATELY (mirrors review.ts:git's
 * whole-buffer utf8 decode posture).
 */
export function defaultSpawn(cmd: string, args: string[], opts: SpawnOpts): SpawnResult {
    let res: ReturnType<typeof spawnSync>;
    try {
        res = spawnSync(cmd, args, {
            cwd: opts.cwd,
            timeout: opts.timeout ?? 30_000,
            maxBuffer: opts.maxBuffer ?? 2 * 1024 * 1024,
            shell: false,
            windowsHide: true,
            encoding: "buffer",
        });
    } catch (err) {
        return { ok: false, code: -1, stdout: "", stderr: err instanceof Error ? err.message : String(err), spawnError: "SPAWN_FAILED" };
    }
    const stdout = Buffer.from(res.stdout ?? []).toString("utf8");
    const stderr = Buffer.from(res.stderr ?? []).toString("utf8");
    if (res.error) {
        const code = (res.error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return { ok: false, code: -1, stdout, stderr, spawnError: "ENOENT" };
        if (code === "ETIMEDOUT") return { ok: false, code: -1, stdout, stderr, spawnError: "ETIMEDOUT" };
        if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
            return { ok: false, code: -1, stdout, stderr, spawnError: "MAXBUFFER" };
        return { ok: false, code: -1, stdout, stderr, spawnError: "SPAWN_FAILED" };
    }
    const code = res.status ?? -1;
    return { ok: res.status === 0, code, stdout, stderr };
}

// ---------------------------------------------------------------------------
// isGhAvailable / isGhAuthenticated
// ---------------------------------------------------------------------------

/** True when `gh` is on PATH (pure fs scan, no spawn). Injectable for tests. */
export function isGhAvailable(which: WhichFn = defaultWhich): boolean {
    return which("gh") !== null;
}

/**
 * Verify the `gh` binary is authenticated. Shells out to `gh auth status`
 * (which exits 0 only when a valid token is configured). Returns false on
 * any failure — the caller surfaces the actionable message via the thrown
 * `GhUnavailableError` when posting a comment.
 */
export function isGhAuthenticated(opts: PrFetchOptions = {}): boolean {
    const which = opts.which ?? defaultWhich;
    const spawn = opts.spawn ?? defaultSpawn;
    if (!which("gh")) return false;
    const res = spawn("gh", ["auth", "status"], { cwd: opts.cwd });
    return res.ok;
}

// ---------------------------------------------------------------------------
// PR fetchers + comment poster
// ---------------------------------------------------------------------------

export interface PrFetchOptions {
    /** Override the `which` lookup (tests). Default: `defaultWhich`. */
    which?: WhichFn;
    /** Override the spawn runner (tests). Default: `defaultSpawn`. */
    spawn?: SpawnFn;
    /** Working directory for `gh` invocations (the local git checkout). */
    cwd?: string;
}

/** The JSON fields requested from `gh pr view` (one comma-joined string). */
export const PR_VIEW_FIELDS = "title,body,baseRefName,headRefName,files,additions,deletions";

/**
 * Fetch PR metadata via `gh pr view <PR> --json title,body,...`. Throws
 * `GhUnavailableError` when `gh` is missing (actionable message); throws a
 * plain `Error` with stderr on any other failure.
 */
export async function fetchPrMetadata(prRef: string, opts: PrFetchOptions = {}): Promise<PrMetadata> {
    const which = opts.which ?? defaultWhich;
    const spawn = opts.spawn ?? defaultSpawn;
    if (!which("gh")) throw new GhUnavailableError();
    const args = ["pr", "view", prRef, "--json", PR_VIEW_FIELDS];
    const res = spawn("gh", args, { cwd: opts.cwd });
    if (!res.ok) {
        throw new Error(
            `gh pr view ${prRef} failed (exit ${res.code})${res.stderr ? `: ${res.stderr.trim().slice(0, 500)}` : ""}`,
        );
    }
    let json: any;
    try {
        json = JSON.parse(res.stdout);
    } catch (e) {
        throw new Error(`gh pr view ${prRef} returned non-JSON output: ${(e as Error).message}`);
    }
    const files: string[] = Array.isArray(json?.files)
        ? json.files.map((f: any) => (typeof f?.path === "string" ? f.path : "")).filter((p: string) => p.length > 0)
        : [];
    return {
        title: typeof json?.title === "string" ? json.title : "",
        body: typeof json?.body === "string" ? json.body : "",
        baseRef: typeof json?.baseRefName === "string" ? json.baseRefName : "",
        headRef: typeof json?.headRefName === "string" ? json.headRefName : "",
        files,
        additions: typeof json?.additions === "number" ? json.additions : 0,
        deletions: typeof json?.deletions === "number" ? json.deletions : 0,
    };
}

/**
 * Fetch the PR diff via `gh pr diff <PR>`. Returns the raw diff text (the
 * same shape `git diff` produces — `gh` shells out to `git` internally).
 */
export async function fetchPrDiff(prRef: string, opts: PrFetchOptions = {}): Promise<string> {
    const which = opts.which ?? defaultWhich;
    const spawn = opts.spawn ?? defaultSpawn;
    if (!which("gh")) throw new GhUnavailableError();
    const args = ["pr", "diff", prRef];
    const res = spawn("gh", args, { cwd: opts.cwd });
    if (!res.ok) {
        throw new Error(
            `gh pr diff ${prRef} failed (exit ${res.code})${res.stderr ? `: ${res.stderr.trim().slice(0, 500)}` : ""}`,
        );
    }
    return res.stdout;
}

/**
 * Post a comment on the PR via `gh pr comment <PR> --body <comment>`.
 * Requires `gh auth status` to be valid (the caller can pre-check via
 * `isGhAuthenticated`).
 */
export async function postPrComment(prRef: string, comment: string, opts: PrFetchOptions = {}): Promise<void> {
    const which = opts.which ?? defaultWhich;
    const spawn = opts.spawn ?? defaultSpawn;
    if (!which("gh")) throw new GhUnavailableError();
    const args = ["pr", "comment", prRef, "--body", comment];
    const res = spawn("gh", args, { cwd: opts.cwd });
    if (!res.ok) {
        throw new Error(
            `gh pr comment ${prRef} failed (exit ${res.code})${res.stderr ? `: ${res.stderr.trim().slice(0, 500)}` : ""}`,
        );
    }
}
