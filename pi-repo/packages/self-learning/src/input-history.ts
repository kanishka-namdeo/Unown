/**
 * input-history.ts — the persisted per-cwd input history store (the
 * Toccata round, 2026-11-15; the Da capo round adds the dual-form entries).
 *
 * The Claude Code history contract (fetched 2026-11-15,
 * code.claude.com/docs/en/interactive-mode): "Input history is stored per
 * working directory", survives sessions, dedupes consecutive repeats, and
 * feeds the Ctrl+R reverse search across scopes (this session / this
 * project / all projects).
 *
 * Unown's form: one JSONL file per working directory under
 * `<unown-home>/input-history/<sha256(cwd)>.jsonl`, entries
 * `{"t":<epoch-ms>,"c":<text>}`, oldest-first, capped at 500 entries per
 * file (rewritten when the file drifts past 600 — append stays cheap,
 * trimming stays rare). The "all projects" scope merges every file by
 * timestamp, newest first, capped the same.
 *
 * Da capo R6 (Claude Code v2.1.314: "Ctrl+R now matches text inside
 * collapsed [Pasted text] pills"): entries may carry an optional `x`
 * expansion — `c` is the marker/pill form (what Up-recall displays), `x`
 * the paste-resolved form the search dialog matches. `load()` returns the
 * SAFE form (`x` when present — a recalled marker from a dead session
 * would submit literally), `loadEntries()` returns both forms.
 *
 * Everything is failure-tolerant by contract: a history write must never
 * break a submission (append never throws), a corrupt line is skipped
 * without warning, and `UNOWN_INPUT_HISTORY=0` detaches the whole lane.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EditorHistoryStore } from "@earendil-works/pi-coding-agent";
import { resolveUnownHome } from "./unown-home.ts";

/** Kill switch: 0 disables persistence entirely (search stays session-scoped). */
export const INPUT_HISTORY_ENV = "UNOWN_INPUT_HISTORY";

/** Per-file entry cap (matches the editor's in-memory cap). */
export const INPUT_HISTORY_FILE_CAP = 500;

/** Rewrite threshold: trim the file back to the cap once it drifts this far. */
export const INPUT_HISTORY_TRIM_AT = 600;

export interface InputHistoryEntry {
        t: number;
        c: string;
        /** The paste-resolved expansion (Da capo R6) — present only when it differs from `c`. */
        x?: string;
}

export interface InputHistoryPaths {
        dir: string;
        file: string;
}

/** Deterministic per-cwd file layout (exported for tests). */
export function inputHistoryPaths(cwd: string, env: NodeJS.ProcessEnv = process.env): InputHistoryPaths {
        const dir = join(resolveUnownHome(env), "input-history");
        const digest = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
        return { dir, file: join(dir, `${digest}.jsonl`) };
}

/** Parse one JSONL line; corrupt lines return undefined (never throw). */
export function parseInputHistoryLine(line: string): InputHistoryEntry | undefined {
        const trimmed = line.trim();
        if (!trimmed) return undefined;
        try {
                const parsed = JSON.parse(trimmed) as { t?: unknown; c?: unknown; x?: unknown };
                if (typeof parsed.c !== "string" || typeof parsed.t !== "number") return undefined;
                if (!Number.isFinite(parsed.t)) return undefined;
                if (parsed.x !== undefined && typeof parsed.x !== "string") return undefined;
                return { t: parsed.t, c: parsed.c, ...(parsed.x !== undefined ? { x: parsed.x } : {}) };
        } catch {
                return undefined;
        }
}

/** Read one history file, oldest-first, skipping corrupt lines. */
export function readInputHistoryFile(file: string): InputHistoryEntry[] {
        if (!existsSync(file)) return [];
        let raw: string;
        try {
                raw = readFileSync(file, "utf8");
        } catch {
                return [];
        }
        const entries: InputHistoryEntry[] = [];
        for (const line of raw.split("\n")) {
                const entry = parseInputHistoryLine(line);
                if (entry && entry.c.trim()) entries.push(entry);
        }
        return entries;
}

/** Newest-first view of a file, deduped by exact text, capped (the SAFE form — expansion when present). */
export function loadFileNewestFirst(file: string): string[] {
        return loadFileEntriesNewestFirst(file).map((entry) => entry.expanded ?? entry.text);
}

/** Dual-form entries of one file, newest first, deduped by marker form (Da capo R6). */
export function loadFileEntriesNewestFirst(file: string): Array<{ text: string; expanded?: string }> {
        const entries = readInputHistoryFile(file);
        const seen = new Set<string>();
        const result: Array<{ text: string; expanded?: string }> = [];
        for (let i = entries.length - 1; i >= 0; i--) {
                const text = entries[i].c.trim();
                if (!text || seen.has(text)) continue;
                seen.add(text);
                const expanded = entries[i].x?.trim();
                result.push(expanded && expanded !== text ? { text, expanded } : { text });
                if (result.length >= INPUT_HISTORY_FILE_CAP) break;
        }
        return result;
}

/** Append one prompt to a per-cwd file. Never throws. The optional
 *  expansion (Da capo R6) is recorded when it differs from the text. */
export function appendInputHistory(
        cwd: string,
        text: string,
        expanded: string | undefined,
        env: NodeJS.ProcessEnv = process.env,
        now = Date.now(),
): void {
        const trimmed = text.trim();
        if (!trimmed) return;
        try {
                const { dir, file } = inputHistoryPaths(cwd, env);
                const entries = readInputHistoryFile(file);
                // Claude Code parity: submitting the same prompt twice in a row
                // records one history entry.
                if (entries.length > 0 && entries[entries.length - 1].c === trimmed) return;
                const cleanExpansion = expanded?.trim();
                const entry: InputHistoryEntry =
                        cleanExpansion && cleanExpansion !== trimmed ? { t: now, c: trimmed, x: cleanExpansion } : { t: now, c: trimmed };
                entries.push(entry);
                mkdirSync(dir, { recursive: true });
                const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
                writeFileSync(file, lines, "utf8");
        } catch {
                // A history write must never break a submission.
        }
}

/** The "all projects" scope: merge every per-cwd file by timestamp, newest first (the SAFE form). */
export function loadAllProjectsNewestFirst(dir: string): string[] {
        return loadAllProjectsEntriesNewestFirst(dir).map((entry) => entry.expanded ?? entry.text);
}

/** Dual-form "all projects" entries, newest first, deduped by marker form (Da capo R6). */
export function loadAllProjectsEntriesNewestFirst(dir: string): Array<{ text: string; expanded?: string }> {
        let files: string[];
        try {
                files = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
        } catch {
                return [];
        }
        const collected: InputHistoryEntry[] = [];
        for (const name of files) {
                // Within a file entries are oldest-first; reversing makes each file
                // newest-first so the stable timestamp sort resolves ties by
                // recency (later-in-file wins), matching the per-file loader.
                collected.push(...readInputHistoryFile(join(dir, name)).reverse());
        }
        collected.sort((a, b) => b.t - a.t);
        const seen = new Set<string>();
        const result: Array<{ text: string; expanded?: string }> = [];
        for (const entry of collected) {
                const text = entry.c.trim();
                if (!text || seen.has(text)) continue;
                seen.add(text);
                const expanded = entry.x?.trim();
                result.push(expanded && expanded !== text ? { text, expanded } : { text });
                if (result.length >= INPUT_HISTORY_FILE_CAP) break;
        }
        return result;
}

/** Is the persisted input-history lane enabled? (default on) */
export function inputHistoryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
        return env[INPUT_HISTORY_ENV] !== "0";
}

export interface InputHistoryStoreOptions {
        cwd?: string;
        env?: NodeJS.ProcessEnv;
        now?: () => number;
}

/**
 * The EditorHistoryStore handed to `ctx.ui.setHistoryStore` at session
 * start: two scopes — "project" (this working directory, cross-session)
 * and "all" (every working directory on the machine).
 */
export function createInputHistoryStore(options: InputHistoryStoreOptions = {}): EditorHistoryStore {
        const cwd = options.cwd ?? process.cwd();
        const env = options.env ?? process.env;
        const now = options.now ?? Date.now;
        return {
                scopes: () => [
                        { id: "project", label: "this project" },
                        { id: "all", label: "all projects" },
                ],
                load: (scope: string): string[] => {
                        try {
                                const { dir, file } = inputHistoryPaths(cwd, env);
                                if (scope === "project") return loadFileNewestFirst(file);
                                if (scope === "all") return loadAllProjectsNewestFirst(dir);
                        } catch {
                                // Corrupt or unreadable history reads as empty, never throws.
                        }
                        return [];
                },
                loadEntries: (scope: string): Array<{ text: string; expanded?: string }> => {
                        try {
                                const { dir, file } = inputHistoryPaths(cwd, env);
                                if (scope === "project") return loadFileEntriesNewestFirst(file);
                                if (scope === "all") return loadAllProjectsEntriesNewestFirst(dir);
                        } catch {
                                // Corrupt or unreadable history reads as empty, never throws.
                        }
                        return [];
                },
                append: (text: string, expanded?: string): void => {
                        if (!inputHistoryEnabled(env)) return;
                        appendInputHistory(cwd, text, expanded, env, now());
                },
        };
}
