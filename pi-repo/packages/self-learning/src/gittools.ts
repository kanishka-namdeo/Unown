/**
 * gittools.ts — git-native commit workflow for the unown terminal agent.
 *
 * The aider/Codex CLI port: a coding agent that edits a git repository owes
 * the user a one-keystroke way to seal that work into history WITHOUT
 * handing over a shell. Two surfaces, both registered from tools.ts via
 * `registerGitTools` (same modularization as lsp.ts / websearch.ts):
 *
 *   - `/commit [message]` — stage every change in the project dir
 *     (`git add -A .`, jailed to the session cwd — never the whole repo
 *     when the cwd is a subtree) and commit it. With a message the message
 *     is used VERBATIM; without one a deterministic conventional-commit
 *     message is generated from the session's recent assistant text
 *     (`unown(session): <summary>` + a `Generated-by: unown` trailer), with
 *     a dated fallback when no session text is reachable.
 *   - `UNOWN_AUTO_COMMIT=1` (opt-in, default OFF) — on session shutdown,
 *     commit any pending project-dir changes as
 *     `unown(auto): session end snapshot <date>`. Fires for teardowns that
 *     actually end the session (quit / new / resume / fork); `reload`
 *     re-creates the runtime for the SAME session, so it is skipped.
 *
 * Hard production rules (pinned by test/gittools.test.ts):
 *
 *   - NEVER `git push`. Only `add` + `commit`, ever.
 *   - The jail is the session cwd: staging is scoped with the `.` pathspec,
 *     so a session opened in a subdirectory cannot sweep the rest of the
 *     repository into its commits.
 *   - Read-only probes (rev-parse / status / config / show) run with
 *     repository hooks DISABLED and `--no-optional-locks`, exactly like
 *     worktree.ts's hardened probes — hostile repo config must not execute
 *     hook commands when we merely LOOK. The commit path is different on
 *     purpose: `git add` / `git commit` run with the user's hooks live
 *     (husky / lint-staged installed by the user must gate agent commits
 *     like any other), and a failing hook surfaces as a typed failure.
 *   - Identity fallback: a fresh clone with no user.name/user.email would
 *     make `git commit` exit 128 — we probe both and pass
 *     `-c user.name=unown -c user.email=unown@local` ONLY for the missing
 *     ones, per invocation (never written to any config). Env-provided
 *     identity (GIT_AUTHOR_NAME…) keeps its normal precedence over `-c`.
 *   - Clean no-ops: not-a-repo, git-missing and nothing-to-commit all return
 *     typed reasons the command renders as friendly messages — never a
 *     crash, never git's raw stderr as the user's problem.
 *   - Subagents (`UNOWN_SUBAGENT=1`) and automation runs
 *     (`UNOWN_AUTOMATION=1`) never commit: /commit explains itself as a
 *     no-op there, and the auto-commit hook stays silent.
 *
 * Cross-platform: git is spawned through node:child_process with an args
 * array and `shell: false` (Windows resolves git.exe from PATH via
 * CreateProcess's .exe append; macOS/Linux use the inherited PATH), paths
 * come from node:path only, and every invocation carries a scrubbed env
 * (GIT_DIR/GIT_WORK_TREE/… redirections removed — an inherited GIT_DIR must
 * not repoint whose repository we mutate) plus a 30 s kill timer.
 *
 * Receipts: intentionally NOT appended here — the ledger instance is owned
 * by the checkpoints extension's closure (per-boot file, closed entry
 * union); reaching it from tools.ts would mean editing checkpoints.ts, which
 * is out of scope for this change. The session transcript (the /commit
 * command + its notify) remains the visible audit trail.
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { assistantTextOf } from "./messages.ts";

// ---------------------------------------------------------------------------
// Safe git invocation
// ---------------------------------------------------------------------------

const GIT_TIMEOUT_MS = 30_000;

/** One private empty hooks dir per process — read-only git probes run with
 *  hooks disabled. Same construction as worktree.ts (the /dev/null trick is
 *  not portable to Windows; git silently skips an empty hook dir). */
let emptyHooksDir: string | null = null;
function hooksDisabledArgs(): string[] {
    if (emptyHooksDir === null) {
        emptyHooksDir = mkdtempSync(join(tmpdir(), "unown-git-hooks-off-"));
    }
    return ["-c", `core.hooksPath=${emptyHooksDir}`];
}

/** Environment for our git invocations: strip inherited GIT_* redirection
 *  so a hostile parent env cannot repoint the repository we operate on. */
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
    /** Exit code; -1 when git could not be spawned or was killed by the timeout. */
    code: number;
    stdout: string;
    stderr: string;
    /** True when git was not spawnable at all (missing from PATH). */
    gitMissing?: boolean;
    /** True when the invocation exceeded GIT_TIMEOUT_MS and was killed. */
    timedOut?: boolean;
}

/** Run git in `cwd`. Never throws — callers decide what a failure means.
 *
 *  `readOnly: true` (probes) disables repository hooks and takes no optional
 *  locks; the default (mutations: add/commit) keeps the user's hooks live.
 *  A 30 s kill timer bounds every invocation (a hung hook, a giant repo). */
export function runGit(cwd: string, args: string[], opts: { readOnly?: boolean } = {}): Promise<GitResult> {
    return new Promise((resolve) => {
        const finalArgs = opts.readOnly ? [...hooksDisabledArgs(), "--no-optional-locks", ...args] : args;
        const child = spawn("git", finalArgs, {
            cwd,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
            env: gitEnv(),
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            try {
                child.kill("SIGKILL");
            } catch {
                /* already gone */
            }
        }, GIT_TIMEOUT_MS);
        const finish = (patch: { code?: number; gitMissing?: boolean; timedOut?: boolean }) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ code: patch.code ?? 0, stdout, stderr, gitMissing: patch.gitMissing, timedOut: patch.timedOut });
        };
        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("close", (c) => finish({ code: timedOut ? -1 : (c ?? 1), timedOut: timedOut || undefined }));
        child.on("error", (err: NodeJS.ErrnoException) => {
            stderr += String(err?.message ?? err);
            finish({ code: -1, gitMissing: err?.code === "ENOENT" });
        });
    });
}

let gitAvailableCache: boolean | undefined;
/** Is a spawnable git on PATH? Cached per process; probes with hooks off. */
export async function gitAvailable(): Promise<boolean> {
    if (gitAvailableCache === undefined) {
        const res = await runGit(tmpdir(), ["--version"], { readOnly: true });
        gitAvailableCache = res.code === 0 && !res.gitMissing;
    }
    return gitAvailableCache;
}

/** Test seam: reset the availability cache (env changes in tests). */
export function resetGitAvailableCache(): void {
    gitAvailableCache = undefined;
}

/** True when `cwd` is inside a git work tree (bare repos / .git dirs are not). */
export async function isGitRepo(cwd: string): Promise<boolean> {
    const res = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"], { readOnly: true });
    return res.code === 0 && res.stdout.trim() === "true";
}

// ---------------------------------------------------------------------------
// Porcelain v1 parsing
// ---------------------------------------------------------------------------

export interface PorcelainEntry {
    /** Index (staged) status column — "M", "A", "D", "R", "C", "T", "?" or " ". */
    x: string;
    /** Work-tree (unstaged) status column — "M", "D", "T", "?" or " ". */
    y: string;
    /** Repo-root-relative path (rename destinations keep git's "old -> new" spelling). */
    path: string;
    untracked: boolean;
}

/** Parse `git status --porcelain` (v1) output into entries. Pure. */
export function parsePorcelain(output: string): PorcelainEntry[] {
    const entries: PorcelainEntry[] = [];
    for (const line of output.split(/\r?\n/)) {
        if (line.length < 4) continue;
        const x = line[0];
        const y = line[1];
        const path = line.slice(3).trim();
        if (!path) continue;
        entries.push({ x, y, path, untracked: x === "?" && y === "?" });
    }
    return entries;
}

/** Porcelain status of the cwd subtree only (the session's project jail).
 *  Untracked files count as changes — `git add -A .` would stage them. */
export async function porcelainStatus(cwd: string): Promise<PorcelainEntry[]> {
    const res = await runGit(cwd, ["status", "--porcelain", "--", "."], { readOnly: true });
    if (res.code !== 0) return [];
    return parsePorcelain(res.stdout);
}

/** Any staged, unstaged or untracked change under the project dir? */
export async function hasStagedOrUnstagedChanges(cwd: string): Promise<boolean> {
    return (await porcelainStatus(cwd)).length > 0;
}

/** Compact human summary of porcelain entries ("2 modified, 1 added, 3 untracked"). */
export function summarizePorcelain(entries: PorcelainEntry[]): string {
    let modified = 0;
    let added = 0;
    let deleted = 0;
    let renamed = 0;
    let untracked = 0;
    for (const e of entries) {
        if (e.untracked) untracked++;
        else if (e.x === "A" || e.x === "C") added++;
        else if (e.x === "D" || e.y === "D") deleted++;
        else if (e.x === "R") renamed++;
        else modified++;
    }
    const parts: string[] = [];
    if (modified) parts.push(`${modified} modified`);
    if (added) parts.push(`${added} added`);
    if (deleted) parts.push(`${deleted} deleted`);
    if (renamed) parts.push(`${renamed} renamed`);
    if (untracked) parts.push(`${untracked} untracked`);
    return parts.length > 0 ? parts.join(", ") : "no changes";
}

// ---------------------------------------------------------------------------
// Commit messages (deterministic templates — no extra model round-trip)
// ---------------------------------------------------------------------------

const SUBJECT_CAP = 72;

/** Render a YYYY-MM-DD date (UTC, deterministic). */
function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/** First usable line of `text` as a commit subject: first non-empty line,
 *  bullets/quote markers stripped, whitespace collapsed, control characters
 *  removed, capped at `cap` chars. */
export function summarizeToSubject(text: string | undefined, cap = SUBJECT_CAP): string | undefined {
    if (!text) return undefined;
    const firstLine = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0);
    if (!firstLine) return undefined;
    const cleaned = firstLine
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .replace(/^\s*(?:#{1,6}\s+|[-*+>]\s+)+/, "")
        .replace(/\s+/g, " ")
        .trim();
    if (cleaned.length < 4) return undefined;
    return cleaned.slice(0, cap).trim();
}

/** Deterministic session-commit message when the user gave none:
 *  `unown(session): <short summary>` + a plain-ASCII provenance trailer.
 *  Falls back to a dated snapshot when no summary is reachable. The subject
 *  line is capped at 72 chars TOTAL (conventional-commit length). */
export function generateCommitMessage(sessionSummary?: string, date: Date = new Date()): string {
    const prefix = "unown(session): ";
    const summary = summarizeToSubject(sessionSummary, SUBJECT_CAP - prefix.length) ?? `work snapshot ${isoDate(date)}`;
    return `${prefix}${summary}\n\nGenerated-by: unown`;
}

/** Deterministic shutdown-snapshot message for UNOWN_AUTO_COMMIT. */
export function generateAutoCommitMessage(date: Date = new Date()): string {
    return `unown(auto): session end snapshot ${isoDate(date)}\n\nGenerated-by: unown`;
}

// ---------------------------------------------------------------------------
// Commit flow
// ---------------------------------------------------------------------------

export type CommitAllOutcome =
    | { ok: true; commitHash: string; filesChanged: number; subject: string }
    | {
          ok: false;
          reason: "not_a_git_repo" | "git_unavailable" | "nothing_to_commit" | "add_failed" | "commit_failed";
          detail: string;
      };

function capDetail(text: string, cap = 400): string {
    const cleaned = text.replace(/\s+/g, " ").trim();
    return cleaned.length > cap ? `${cleaned.slice(0, cap)}…` : cleaned;
}

/** `-c` args supplying `user.name` / `user.email` for the missing ones only —
 *  a fresh clone must never fail a commit for lack of identity, and we never
 *  write identity into any config file. */
export async function missingIdentityArgs(cwd: string): Promise<string[]> {
    const args: string[] = [];
    const name = await runGit(cwd, ["config", "--get", "user.name"], { readOnly: true });
    if (name.code !== 0 || !name.stdout.trim()) args.push("-c", "user.name=unown");
    const email = await runGit(cwd, ["config", "--get", "user.email"], { readOnly: true });
    if (email.code !== 0 || !email.stdout.trim()) args.push("-c", "user.email=unown@local");
    return args;
}

/**
 * Stage everything under `cwd` (`git add -A .` — the project-dir jail) and
 * commit. The message is passed VERBATIM (multi-line bodies included) as a
 * single argv element — never shell-interpreted. Returns the new commit's
 * full hash and its changed-file count; every failure is a typed reason.
 * Never pushes, never amends, never touches config.
 */
export async function commitAll(cwd: string, message: string): Promise<CommitAllOutcome> {
    if (!(await gitAvailable())) {
        return { ok: false, reason: "git_unavailable", detail: "git executable not found on PATH" };
    }
    if (!(await isGitRepo(cwd))) {
        return { ok: false, reason: "not_a_git_repo", detail: "the project directory is not inside a git work tree" };
    }
    const before = await porcelainStatus(cwd);
    if (before.length === 0) {
        return { ok: false, reason: "nothing_to_commit", detail: "no staged, unstaged or untracked changes in the project dir" };
    }

    const add = await runGit(cwd, ["add", "-A", "."]);
    if (add.code !== 0) {
        return { ok: false, reason: "add_failed", detail: capDetail(add.stderr || add.stdout || `git add exited ${add.code}`) };
    }

    const identity = await missingIdentityArgs(cwd);
    const commit = await runGit(cwd, [...identity, "commit", "-m", message]);
    if (commit.code !== 0) {
        // Race (changes vanished between the status probe and the commit) or a
        // concurrent committer got there first — a clean no-op either way.
        if (/nothing to commit/i.test(commit.stdout + commit.stderr)) {
            return { ok: false, reason: "nothing_to_commit", detail: "nothing to commit, working tree clean" };
        }
        const detail = commit.timedOut
            ? `git commit timed out after ${GIT_TIMEOUT_MS / 1000}s (a pre-commit hook can hang — inspect with git commit --dry-run)`
            : capDetail(commit.stderr || commit.stdout || `git commit exited ${commit.code}`);
        return { ok: false, reason: "commit_failed", detail };
    }

    const head = await runGit(cwd, ["rev-parse", "HEAD"], { readOnly: true });
    const commitHash = head.code === 0 ? head.stdout.trim() : "";
    const numstat = await runGit(cwd, ["show", "--numstat", "--format=", "HEAD"], { readOnly: true });
    const filesChanged =
        numstat.code === 0
            ? numstat.stdout
                  .split(/\r?\n/)
                  .filter((l) => l.trim().length > 0).length
            : before.length;
    const subject = message.split(/\r?\n/)[0]?.trim() ?? message.trim();
    return { ok: true, commitHash, filesChanged, subject };
}

// ---------------------------------------------------------------------------
// Context + gating helpers
// ---------------------------------------------------------------------------

/** The most recent substantial assistant text in the session branch, for
 *  /commit's generated message. Best-effort: no session access → undefined. */
export function recentAssistantSummary(ctx: any): string | undefined {
    try {
        const sm = ctx?.sessionManager;
        if (!sm) return undefined;
        const entries: any[] =
            typeof sm.getBranch === "function" ? sm.getBranch() : typeof sm.getEntries === "function" ? sm.getEntries() : [];
        for (let i = entries.length - 1; i >= 0; i--) {
            const text = assistantTextOf(entries[i]?.message ?? entries[i]);
            if (text && text.trim().length >= 8) return text;
        }
    } catch {
        /* session access is best-effort */
    }
    return undefined;
}

/** Env gates that make the git workflow a no-op: subagent sessions (the
 *  parent session owns commits) and automation runs (unattended commits are
 *  out of scope by the automations trust design). Pure. */
export function gitWorkflowSuppressed(
    env: NodeJS.ProcessEnv = process.env,
): { env: string; why: string } | null {
    if (/^(1|true)$/i.test(env.UNOWN_SUBAGENT ?? "")) {
        return { env: "UNOWN_SUBAGENT", why: "subagent session — the parent session owns commits" };
    }
    if (/^(1|true)$/i.test(env.UNOWN_AUTOMATION ?? "")) {
        return { env: "UNOWN_AUTOMATION", why: "automation run — unattended commits are out of scope" };
    }
    return null;
}

/** UNOWN_AUTO_COMMIT is opt-in (default OFF): 1/true enable. */
export function autoCommitEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return /^(1|true)$/i.test(env.UNOWN_AUTO_COMMIT ?? "");
}

/** Teardown reasons that actually END the session. `reload` re-creates the
 *  runtime for the SAME session (extensions/config refresh), so a snapshot
 *  there would mislabel mid-session work as a session end. */
const AUTO_COMMIT_REASONS = new Set(["quit", "new", "resume", "fork"]);

// ---------------------------------------------------------------------------
// Extension registration (called from tools.ts — the websearch.ts pattern)
// ---------------------------------------------------------------------------

export interface GitToolsOptions {
    /** The session's project directory — the jail every git operation respects. */
    cwd: string;
    /** Inside a spawned subagent (UNOWN_SUBAGENT): /commit explains itself as a no-op. */
    isSubagent?: boolean;
    verbose?: boolean;
}

/** Best-effort reporting that survives every context: the TUI footer while a
 *  UI lives, stderr in headless/print mode. Never throws. */
function report(ctx: any, text: string, level: "info" | "warning" | "error" = "info"): void {
    try {
        if (ctx?.hasUI && typeof ctx.ui?.notify === "function") {
            ctx.ui.notify(text, level);
            return;
        }
    } catch {
        /* fall through to stderr */
    }
    console.error(text);
}

function shortHash(hash: string): string {
    return hash ? hash.slice(0, 7) : "?";
}

/**
 * Registers the git-native commit workflow on a pi ExtensionAPI:
 *   - the `/commit [message]` session command
 *   - the opt-in UNOWN_AUTO_COMMIT session-shutdown snapshot
 * Used by the unown-tools extension (terminal sessions inherit it in TUI,
 * print and plan modes alike).
 */
export function registerGitTools(pi: ExtensionAPI, opts: GitToolsOptions): void {
    const log = (msg: string) => {
        if (opts.verbose) console.error(`[unown-git] ${msg}`);
    };
    const isSubagent = opts.isSubagent ?? process.env.UNOWN_SUBAGENT === "1";

    pi.registerCommand("commit", {
        description: "Stage and commit all project-dir changes (never pushes): /commit [message]",
        handler: async (args: string, ctx: any) => {
            // Guardrail interplay: subagents and automation runs never commit.
            const suppressed = gitWorkflowSuppressed();
            const gate = isSubagent ? "UNOWN_SUBAGENT" : suppressed?.env ?? null;
            if (gate) {
                ctx.ui.notify(
                    `/commit is a no-op here (${gate} is set) — commits belong to the interactive session that owns this project.`,
                    "info",
                );
                return;
            }
            const userMessage = (args ?? "").trim();
            let message = userMessage;
            if (!message) {
                const summary = recentAssistantSummary(ctx);
                message = generateCommitMessage(summary);
                log(`generated message from ${summary ? "session text" : "dated fallback"}: ${message.split("\n")[0]}`);
            }
            try {
                const outcome = await commitAll(opts.cwd, message);
                if (outcome.ok) {
                    log(`committed ${outcome.commitHash} (${outcome.filesChanged} files)`);
                    ctx.ui.notify(
                        `Committed ${shortHash(outcome.commitHash)} — ${outcome.filesChanged} file${outcome.filesChanged === 1 ? "" : "s"} changed\n` +
                            `${outcome.subject}\n` +
                            `(local commit only — unown never pushes; git log -1 to inspect)`,
                        "info",
                    );
                    return;
                }
                switch (outcome.reason) {
                    case "nothing_to_commit":
                        ctx.ui.notify("Nothing to commit — the project directory has no staged, unstaged or untracked changes.", "info");
                        return;
                    case "not_a_git_repo":
                        ctx.ui.notify(
                            "Not inside a git repository — /commit has nothing to do here (git init first if this project should have history).",
                            "warning",
                        );
                        return;
                    case "git_unavailable":
                        ctx.ui.notify("git executable not found on PATH — /commit needs a git binary.", "warning");
                        return;
                    default:
                        ctx.ui.notify(`/commit failed (${outcome.reason}): ${outcome.detail}`, "error");
                        return;
                }
            } catch (err: any) {
                ctx.ui.notify(`/commit failed: ${err?.message ?? String(err)}`, "error");
            }
        },
    });

    pi.on("session_shutdown", async (event: any, ctx: any) => {
        try {
            if (!autoCommitEnabled()) return;
            // Only teardowns that END the session (reload keeps the same one).
            const reason = event?.reason;
            if (reason && !AUTO_COMMIT_REASONS.has(reason)) {
                log(`auto-commit skipped: session_shutdown reason "${reason}" does not end the session`);
                return;
            }
            // Subagents and automation runs stay silent — their parents own commits.
            if (isSubagent || gitWorkflowSuppressed()) return;
            const outcome = await commitAll(opts.cwd, generateAutoCommitMessage());
            if (outcome.ok) {
                log(`auto-committed ${outcome.commitHash} (${outcome.filesChanged} files) on ${reason}`);
                report(
                    ctx,
                    `unown(auto): committed ${shortHash(outcome.commitHash)} — ${outcome.filesChanged} file${outcome.filesChanged === 1 ? "" : "s"} changed (session end snapshot; not pushed)`,
                );
            } else if (outcome.reason === "nothing_to_commit" || outcome.reason === "not_a_git_repo" || outcome.reason === "git_unavailable") {
                log(`auto-commit no-op: ${outcome.reason}`);
            } else {
                report(ctx, `unown(auto): session-end commit failed (${outcome.reason}): ${outcome.detail}`, "warning");
            }
        } catch (err: any) {
            // Shutdown must never break on our account.
            log(`auto-commit error: ${err?.message ?? String(err)}`);
        }
    });
}
