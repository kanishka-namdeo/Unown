/**
 * repomap-cli.ts — the repo-map surfaces: the `/repomap` command + the
 * subagent spawn injection (the two v1 integration points from the
 * research plan).
 *
 * `/repomap` (TUI, beside /lsp): render the map for the session cwd.
 *   /repomap               — the map at the default budget
 *   /repomap --tokens 2048 — a bigger map
 *   /repomap --refresh     — bypass caches (post-edit freshness)
 *   /repomap clear         — drop the on-disk tag cache + in-memory map
 *
 * Subagent injection (`withRepoMap`): the task tool's spawn lanes append a
 * read-only map block to EVERY child task (fresh + summary agents) when
 * the run cwd is a git repo — aider's whole-file overview without the
 * LSP dependency. Contract:
 *   - never blocks the spawn: the build races a timeout (default 2500ms,
 *     UNOWN_REPOMAP_TIMEOUT_MS); a loss = no map, never an error;
 *   - the FIRST build of a big repo pays the parse cost in the background
 *     — the in-flight promise is shared, so the next spawn hits the cache;
 *   - budget 512 tokens (the map is a supplement, not the payload);
 *   - the block is framed READ-ONLY (aider's contract wording) — map files
 *     are summaries, not edit targets.
 */

import { rmSync } from "node:fs";
import { join } from "node:path";
import { runGit } from "../gittools.ts";
import { buildRepoMap, clearRepomapCaches, extractMentions, mapTokenBudget, type RepoMapResult } from "./repomap-core.ts";
import { repomapEnabled, repomapRuntimeError, getRepomapRuntime } from "./treesitter.ts";

/** Subagent map budget (tokens) — half the interactive default; the task
 * text is the payload, the map is orientation. */
export const SUBAGENT_MAP_TOKENS = 512;
const DEFAULT_SPAWN_TIMEOUT_MS = 2500;

function spawnTimeoutMs(env: Record<string, string | undefined> = process.env): number {
        const raw = env.UNOWN_REPOMAP_TIMEOUT_MS;
        if (raw === undefined || raw === "") return DEFAULT_SPAWN_TIMEOUT_MS;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_SPAWN_TIMEOUT_MS;
}

/** List tracked files (git ls-files -z; the -z form survives spaces). An
 * in-flight cache dedupes concurrent spawns; non-repo → null. */
const listCache = new Map<string, { at: number; files: string[] } | null>();
const LIST_TTL_MS = 10_000;

export async function listRepoFiles(cwd: string): Promise<string[] | null> {
        const hit = listCache.get(cwd);
        if (hit !== undefined && (hit === null || Date.now() - hit.at < LIST_TTL_MS)) return hit?.files ?? null;
        let files: string[] | null = null;
        try {
                const res = await runGit(cwd, ["ls-files", "-z"], { readOnly: true });
                if (res.code === 0 && !res.gitMissing && !res.timedOut) {
                        files = res.stdout.split("\0").filter((f) => f.length > 0);
                }
        } catch {
                files = null;
        }
        listCache.set(cwd, files === null ? null : { at: Date.now(), files });
        return files;
}

export function clearRepoFileListings(): void {
        listCache.clear();
}

/** In-flight build memoization: concurrent spawns share the first build. */
const inFlight = new Map<string, Promise<RepoMapResult | null>>();

function buildForSpawn(cwd: string, task: string): Promise<RepoMapResult | null> {
        const key = cwd;
        const existing = inFlight.get(key);
        if (existing) return existing;
        const p = (async () => {
                const files = await listRepoFiles(cwd);
                if (!files || files.length === 0) return null;
                const mentions = extractMentions(task, files);
                return buildRepoMap({
                        root: cwd,
                        files,
                        mentionedFiles: mentions.files,
                        mentionedIdents: mentions.idents,
                        budgetTokens: SUBAGENT_MAP_TOKENS,
                });
        })()
                .catch(() => null)
                .finally(() => {
                        // Drop the memo THE MOMENT the build settles: its purpose is
                        // deduping CONCURRENT builds (one parse shared by a fleet spawn).
                        // Serving a settled build to a later, DIFFERENT task would ship
                        // the old task's mentions-steered map (caught live in the M6
                        // E2E: a 0 ms "second build" that could never have run).
                        inFlight.delete(key);
                });
        inFlight.set(key, p);
        return p;
}

/** Compose the read-only map block onto a subagent task (aider's
 * repo_content_prefix wording, adapted). The map rides BEFORE the task —
 * the established composition order (context-brief.ts puts the brief
 * first, the task LAST) so end-anchored scripting conventions (the test
 * bridge's TOOLCALL/JSONREPLY matchers, downstream parsers) keep working;
 * caught live by the worktree-isolation golden test. Pure string layer. */
export function composeTaskWithMap(mapText: string, task: string): string {
        return (
                `Repo map (read-only structural summaries of the working directory — do NOT edit these files unless the task says to; use them to navigate and target your work):\n${mapText}` +
                `\n\nTask:\n${task}`
        );
}

/** The spawn-lane wrapper: task + map (racing the timeout), null-map-safe.
 * Never throws — a map failure must not fail the delegation. */
export async function withRepoMap(cwd: string, task: string, env: Record<string, string | undefined> = process.env): Promise<string> {
        if (!repomapEnabled(env)) return task;
        const timeout = spawnTimeoutMs(env);
        if (timeout === 0) return task; // explicit zero = opt out of waiting (build still warms)
        const build = buildForSpawn(cwd, task);
        let result: RepoMapResult | null;
        if (Number.isFinite(timeout)) {
                result = await Promise.race([
                        build,
                        new Promise<RepoMapResult | null>((resolve) => setTimeout(() => resolve(null), timeout)),
                ]);
        } else {
                result = await build;
        }
        if (!result || !result.text.trim()) return task;
        return composeTaskWithMap(result.text, task);
}

// ---------------------------------------------------------------------------
// /repomap command
// ---------------------------------------------------------------------------

export interface RepomapCommandResult {
        message: string;
        level: "info" | "warning" | "error";
}

/** Pure arg parse (test-pinned): returns the action + flags. */
export function parseRepomapArgs(raw: string): { action: "show" | "clear"; tokens?: number; refresh: boolean } {
        const parts = (raw ?? "").trim().split(/\s+/).filter(Boolean);
        if (parts[0]?.toLowerCase() === "clear") return { action: "clear", refresh: false };
        let tokens: number | undefined;
        let refresh = false;
        for (let i = 0; i < parts.length; i++) {
                if (parts[i] === "--tokens" || parts[i] === "-t") {
                        const v = Number(parts[i + 1]);
                        if (Number.isFinite(v) && v >= 64 && v <= 32_768) tokens = Math.floor(v);
                        i++;
                } else if (parts[i] === "--refresh" || parts[i] === "-r") {
                        refresh = true;
                }
        }
        return { action: "show", tokens, refresh };
}

/** The command body (TUI handler + tests). Non-repo, disabled, and
 * init-failure paths render as actionable messages, never crashes. */
export async function runRepomapCommand(cwd: string, rawArgs: string): Promise<RepomapCommandResult> {
        const parsed = parseRepomapArgs(rawArgs);
        if (parsed.action === "clear") {
                clearRepomapCaches();
                clearRepoFileListings();
                try {
                        rmSync(join(cwd, ".unown", "repomap-cache.json"), { force: true });
                } catch {
                        /* best effort */
                }
                return { message: "Repo-map caches cleared (tag cache + in-memory maps).", level: "info" };
        }
        if (!repomapEnabled()) {
                return { message: "Repo map is disabled (UNOWN_REPOMAP=0).", level: "info" };
        }
        const files = await listRepoFiles(cwd);
        if (files === null) {
                return { message: "Not a git repository (or git unavailable) — the repo map needs `git ls-files`.", level: "warning" };
        }
        if (files.length === 0) {
                return { message: "This repository has no tracked files — nothing to map.", level: "info" };
        }
        // Warm the runtime so a grammar problem surfaces HERE as a reason,
        // not as an empty map.
        await getRepomapRuntime();
        const err = repomapRuntimeError();
        const budget = parsed.tokens ?? mapTokenBudget();
        const result = await buildRepoMap({
                root: cwd,
                files,
                budgetTokens: budget,
                refresh: parsed.refresh,
        });
        if (!result || !result.text.trim()) {
                return {
                        message: `Repo map came back empty (${files.length} tracked files).${err ? ` Note: ${err}` : ""}`,
                        level: "warning",
                };
        }
        const suffix = err ? `\n⚠ tree-sitter degraded (${err}) — regex fallback in use.` : "";
        return {
                message:
                        `Repo map — ${result.taggedFiles} file(s) with tags, ${result.tokens} est. tokens (budget ${budget}${parsed.refresh ? ", refreshed" : ""}):\n\n${result.text}${suffix}`,
                level: "info",
        };
}

// ---------------------------------------------------------------------------
// `unown repomap` (shell surface — scripts + E2E; mirrors the TUI command)
// ---------------------------------------------------------------------------

export interface RepomapCliResult {
        stdout: string;
        stderr: string;
        exitCode: number;
}

/** `unown repomap [--tokens N] [--refresh] [path] | clear | --json`. */
export async function runRepomapCliCommand(argv: string[], opts: { cwd: string }): Promise<RepomapCliResult> {
        const asJson = argv.includes("--json");
        // Arg walk that knows --tokens/-t CONSUMES a value — a bare positional
        // is a path, but `--tokens 512` must not treat 512 as one (found live
        // in the M6 E2E: it resolved cwd to ".../512" and reported non-repo).
        let pathArg: string | undefined;
        const rest: string[] = [];
        for (let i = 0; i < argv.length; i++) {
                const a = argv[i];
                if (a === "--json") continue;
                if (a === "--tokens" || a === "-t") {
                        if (i + 1 < argv.length) {
                                rest.push(a, argv[i + 1]);
                                i++; // consume the value
                        }
                        continue;
                }
                if (a.startsWith("-") || a === "clear") {
                        rest.push(a);
                        continue;
                }
                if (pathArg === undefined) pathArg = a;
        }
        const cwd = pathArg ? (await import("node:path")).resolve(opts.cwd, pathArg) : opts.cwd;
        try {
                const result = await runRepomapCommand(cwd, rest.join(" "));
                if (asJson) {
                        const payload = { level: result.level, message: result.message };
                        return { stdout: `${JSON.stringify(payload)}\n`, stderr: "", exitCode: result.level === "error" ? 1 : 0 };
                }
                return { stdout: `${result.message}\n`, stderr: result.level === "error" ? "" : "", exitCode: result.level === "error" ? 1 : 0 };
        } catch (err: any) {
                const message = `repomap failed: ${err?.message ?? err}`;
                return asJson
                        ? { stdout: "", stderr: `${JSON.stringify({ error: message })}\n`, exitCode: 2 }
                        : { stdout: "", stderr: `${message}\n`, exitCode: 2 };
        }
}
