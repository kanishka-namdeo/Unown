/**
 * worktree-session.ts — `unown --worktree [name]` (the 2026-10-24 parity
 * round): main-session worktrees.
 *
 * Competitive basis: Claude Code `--worktree/-w` (+ EnterWorktree tools and
 * the worktree sessions in the agent view), Codex `--worktree` + `/worktree`,
 * Gemini CLI `-w/--worktree` — parallel work without stashing, one switch.
 * Unown had the machinery for SUBAGENTS only (worktree.ts — the muse fan-out
 * port with the hardened git runner, the lifecycle journal and the
 * remove_if_clean cleanup policy); the MAIN session always shared the
 * checkout.
 *
 * The contract, built on the existing primitives:
 *   - `unown --worktree [name]` (TUI or print mode) creates a managed
 *     worktree at the parent repo's HEAD under `.unown/worktrees/`, chdirs
 *     the whole session into it, and boots. The startup notice names the
 *     tree, the base commit and the cleanup policy.
 *   - Fail-closed, like the subagent lane: outside a git repo, with git
 *     unavailable, or when creation fails, the session does NOT silently run
 *     in the shared checkout — a typed reason exits 1 (the muse rule).
 *   - On exit, the existing remove_if_clean policy runs: untouched tree →
 *     removed; dirty or carrying commits → KEPT with the path + merge
 *     guidance (nothing is ever auto-merged); unprovable state →
 *     quarantined, never deleted.
 *   - `unown worktrees list` enumerates the trees under .unown/worktrees/
 *     with live status (dirty files, commits ahead); `unown worktrees remove
 *     <name>` removes a kept one (the manual merge lane's ending).
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
    cleanupWorktree,
    createWorktree,
    findGitRepo,
    readRegistry,
    runGit,
    worktreeRoot,
    type WorktreeHandle,
} from "./worktree.ts";

// ---------------------------------------------------------------------------
// The session wrapper
// ---------------------------------------------------------------------------

/** Auto name when --worktree came bare: `s-<timestamp36>` (sortable, unique
 *  enough per machine; the journal records the real path anyway). */
export function autoWorktreeName(now: number = Date.now()): string {
    return `s-${now.toString(36)}`;
}

export interface SessionWorktreeOutcome {
    handle: WorktreeHandle | null;
    /** The cleanup result line (absent when cleanup did not run). */
    cleanupLine?: string;
}

/**
 * Run `fn` inside a fresh session worktree. Creates the tree, chdirs into it
 * (the TUI and print mode both read process.cwd() at boot), awaits fn, then
 * runs the remove_if_clean cleanup and returns both the handle and the
 * cleanup line. `onNotice` receives the startup notice (the caller decides
 * stderr vs TUI toast). On creation failure the typed reason is returned —
 * the CALLER exits (fail-closed: never a silent shared-checkout run).
 *
 * Exit interception (the hard-won part): cmdPrint terminates through
 * `process.exit(code)` on EVERY path (its own F10 comment says so), and the
 * TUI exits the same way at session end — a `finally` around `fn` would
 * NEVER run. So for the duration of the session, `process.exit` is patched:
 * the call is captured (code + all), the cleanup runs, and the REAL exit
 * fires after — with the session's own code preserved. Bun permits the
 * patch (measured live); the patch is restored before the real exit.
 */
export async function withSessionWorktree(
    name: string | undefined,
    fn: (handle: WorktreeHandle) => Promise<unknown>,
    onNotice?: (line: string) => void,
): Promise<
    | { ok: true; result: SessionWorktreeOutcome & { fnResult?: unknown } }
    | { ok: false; reason: string; detail: string }
> {
    const created = await createWorktree(process.cwd(), name ?? autoWorktreeName());
    if (!created.ok) {
        return { ok: false, reason: created.reason, detail: created.detail };
    }
    const handle = created.handle;
    onNotice?.(
        `unown: session worktree ${handle.id} at ${handle.path} (from ${handle.baseCommit.slice(0, 10)}) — exit removes it when untouched; changes keep it for review`,
    );
    const prevCwd = process.cwd();
    // Exit interception: capture the session's exit, run cleanup, then exit
    // for real. `pendingExit` is undefined when fn returns without exiting
    // (rare) — the caller's own flow then continues after this call.
    const realExit = process.exit.bind(process);
    let pendingExit: number | undefined;
    process.exit = (((code?: number) => {
        pendingExit = code ?? 0;
    }) as typeof process.exit);
    let fnResult: unknown;
    try {
        process.chdir(handle.path);
        fnResult = await fn(handle);
    } finally {
        // Cleanup runs from the parent repo (move out of the tree first so a
        // remove never deletes the process's cwd out from under it).
        try {
            process.chdir(prevCwd);
        } catch {
            /* prevCwd may be gone — cleanup's own runner handles the rest */
        }
        try {
            // The session lane excludes its own `.unown/` runtime state (the
            // memory scaffold + receipts the session itself writes) from the
            // dirty check — a session that produced no WORK still cleans up.
            // Real code changes (anything outside .unown/) keep the tree.
            const cleanup = await cleanupWorktree(handle, {
                ignore: (file) => file.startsWith(".unown/") || file === ".unown",
            });
            onNotice?.(`unown: worktree ${handle.id} — ${cleanup.action}: ${cleanup.detail}`);
        } catch (err: any) {
            onNotice?.(`unown: worktree ${handle.id} — cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exit = realExit;
        if (pendingExit !== undefined) realExit(pendingExit);
    }
    return { ok: true, result: { handle, fnResult } };
}

// ---------------------------------------------------------------------------
// unown worktrees list / remove
// ---------------------------------------------------------------------------

export interface WorktreeListEntry {
    name: string;
    path: string;
    dirtyFiles: number;
    newCommits: number;
    error?: string;
}

/** Enumerate the managed trees with live status (never throws). */
export async function listSessionWorktrees(cwd: string): Promise<WorktreeListEntry[]> {
    const repoRoot = await findGitRepo(cwd);
    if (repoRoot === null) return [];
    const root = worktreeRoot(repoRoot);
    if (!existsSync(root)) return [];
    const out: WorktreeListEntry[] = [];
    let names: string[];
    try {
        names = readdirSync(root, { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.endsWith(".quarantined"))
            .map((e) => e.name);
    } catch {
        return [];
    }
    for (const name of names) {
        const path = join(root, name);
        // Reconstruct the handle from the registry (base commit) or HEAD.
        const registry = readRegistry(repoRoot);
        const rec = registry.filter((r) => r.path === path).pop();
        const head = await runGit(path, ["rev-parse", "HEAD"]);
        const baseCommit = rec?.baseCommit ?? (head.code === 0 ? head.stdout.trim() : "");
        const handle: WorktreeHandle = { id: name, path, repoRoot, baseCommit };
        // The same session-lane filter as the cleanup: the session's own
        // `.unown/` runtime state is not work changes (consistent counts with
        // the keep/remove policy).
        const status = await (await import("./worktree.ts")).worktreeStatus(handle, {
            ignore: (file) => file.startsWith(".unown/") || file === ".unown",
        });
        if (status.error) {
            out.push({ name, path, dirtyFiles: 0, newCommits: 0, error: status.error });
            continue;
        }
        out.push({ name, path, dirtyFiles: status.dirtyFiles.length, newCommits: status.newCommits });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface WorktreeRemoveResult {
    action: "removed" | "failed" | "not_found";
    detail: string;
}

/** Remove one managed worktree by name (or path suffix). The tree must be
 *  clean OR --force given (the caller owns the flag); git worktree remove
 *  refuses dirty trees by default, which is exactly the safety we want. */
export async function removeSessionWorktree(cwd: string, name: string, force = false): Promise<WorktreeRemoveResult> {
    const repoRoot = await findGitRepo(cwd);
    if (repoRoot === null) {
        return { action: "failed", detail: "not inside a git repository" };
    }
    const entries = await listSessionWorktrees(cwd);
    const entry = entries.find((e) => e.name === name || e.path === name || e.name.endsWith(name));
    if (!entry) {
        return {
            action: "not_found",
            detail: `no managed worktree matching "${name}" under ${worktreeRoot(repoRoot)} (unown worktrees list shows them)`,
        };
    }
    const args = ["worktree", "remove", ...(force ? ["--force"] : []), entry.path];
    const removed = await runGit(repoRoot, args);
    if (removed.code !== 0) {
        return {
            action: "failed",
            detail: `git worktree remove failed (dirty trees need --force after review): ${removed.stderr.trim().slice(0, 200)}`,
        };
    }
    await runGit(repoRoot, ["worktree", "prune"]);
    return { action: "removed", detail: `removed ${entry.name} (${entry.path})` };
}

/** The `unown worktrees` usage + runner (the CLI twin of the flag). Exit-code
 *  returning, stdout/stderr direct — the sessions-cli pattern. */
export const WORKTREES_USAGE = `unown worktrees — manage the session worktrees (.unown/worktrees/)

Usage:
  unown worktrees list                live status of every managed tree
  unown worktrees remove <name>       remove a kept tree (clean only; --force after review)

Session worktrees are created by \`unown --worktree [name]\` (Claude Code
--worktree / Codex --worktree / Gemini -w parity): the session runs inside a
managed worktree at the repo's HEAD; on exit an untouched tree is removed
automatically, and a tree with changes is kept for review — this command is
how you clean up the kept ones after merging.`;

export async function runWorktreesCommand(argv: string[]): Promise<number> {
    const sub = argv[0] ?? "list";
    const cwd = process.cwd();
    if (sub === "list") {
        const entries = await listSessionWorktrees(cwd);
        if (entries.length === 0) {
            process.stdout.write("No managed worktrees (start one with `unown --worktree [name]`).\n");
            return 0;
        }
        const lines = entries.map((e) => {
            if (e.error) return `${e.name}  ERROR: ${e.error}`;
            const state = e.dirtyFiles > 0 ? `${e.dirtyFiles} uncommitted file(s)` : "clean";
            const commits = e.newCommits > 0 ? `, ${e.newCommits} commit(s) ahead` : "";
            return `${e.name}  ${state}${commits}  ${e.path}`;
        });
        process.stdout.write(lines.join("\n") + "\n");
        return 0;
    }
    if (sub === "remove") {
        const name = argv[1];
        if (!name) {
            process.stderr.write("usage: unown worktrees remove <name> [--force]\n");
            return 1;
        }
        const force = argv.includes("--force");
        const result = await removeSessionWorktree(cwd, name, force);
        if (result.action === "removed") {
            process.stdout.write(`✓ ${result.detail}\n`);
            return 0;
        }
        process.stderr.write(`unown worktrees remove: ${result.detail}\n`);
        return result.action === "not_found" ? 1 : 1;
    }
    if (sub === "-h" || sub === "--help" || sub === "help") {
        process.stdout.write(WORKTREES_USAGE + "\n");
        return 0;
    }
    process.stderr.write(`unown worktrees: unknown subcommand "${sub}" (list | remove)\n`);
    return 1;
}
