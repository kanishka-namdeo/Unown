/**
 * repomap-core.ts — the build orchestrator (aider's get_ranked_tags_map,
 * ported). Composition of the pure layers:
 *
 *   files ──extract──▶ tags ──graph──▶ PageRank ──distribute──▶ render(budget)
 *            (cached per file: mtime+size fast path, sha256 on mismatch)
 *
 * Everything with a side effect is injected (readFile/statFile/extract) —
 * the module itself is deterministic given inputs, hermetic for tests.
 *
 * The public contract (context-brief.ts's degradation rule): a build that
 * cannot happen returns null — disabled, no repo files, unreadable
 * everything — and the caller proceeds WITHOUT the map. A repo map is
 * never worth aborting a delegation for.
 *
 * Env knobs (mirroring lsp.ts's family):
 *   UNOWN_REPOMAP=0          kill switch
 *   UNOWN_REPOMAP_TOKENS     budget override (default 1024)
 *   UNOWN_REPOMAP_MAX_FILES  file cap (default 5000; bigger repos rank the
 *                            first N git-listed files — a cap beats a hang)
 */

import { buildRefGraph, rankGraph, type RefGraph } from "./graph.ts";
import { buildRenderEntries, fitToBudget, type RenderEntry } from "./render.ts";
import { entryMatchesHash, entryMatchesStat, loadTagsCache, MapCache, saveTagsCache, sha256Of, trimCache, type TagsCacheFile } from "./cache.ts";
import { extOf, grammarForExt, regexFallbackTags, type Tag } from "./tags.ts";
import { getRepomapRuntime, repomapEnabled, type RepomapRuntime } from "./treesitter.ts";

export const DEFAULT_MAP_TOKENS = 1024;
export const DEFAULT_MAX_FILES = 5000;
/** Files git-listed but skipped outright (vendored deps, lock files,
 * binaries — the noise aider's .gitignore + excludes handle for it). */
const SKIP_PATH = /(^|\/)(node_modules|vendor|dist|\.next|target|__pycache__)\//;
const SKIP_EXT = /\.(lock|png|jpe?g|gif|svg|ico|pdf|zip|tar|gz|wasm|node|exe|bin|dylib|so|mp4|webm|woff2?|ttf|db|sqlite3?)$/i;

export function mapTokenBudget(env: Record<string, string | undefined> = process.env): number {
        const raw = env.UNOWN_REPOMAP_TOKENS;
        if (raw === undefined || raw === "") return DEFAULT_MAP_TOKENS;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 64 && n <= 32_768 ? Math.floor(n) : DEFAULT_MAP_TOKENS;
}

export function maxFilesCap(env: Record<string, string | undefined> = process.env): number {
        const raw = env.UNOWN_REPOMAP_MAX_FILES;
        if (raw === undefined || raw === "") return DEFAULT_MAX_FILES;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 10 ? Math.floor(n) : DEFAULT_MAX_FILES;
}

export interface BuildRepoMapArgs {
        /** Repo root (absolute). */
        root: string;
        /** Tracked repo files, RELATIVE to root (listRepoFiles supplies them). */
        files: string[];
        /** Context files (aider's chat files): ×50 ref boost, own defs skipped. */
        chatFiles?: string[];
        /** User-mentioned idents/files (task-text extraction — see mentions.ts). */
        mentionedFiles?: string[];
        mentionedIdents?: string[];
        budgetTokens?: number;
        /** The per-file cache path (default <root>/.unown/repomap-cache.json). */
        cachePath?: string;
        /** Injected seams (tests). */
        readFile?: (abs: string) => string | null;
        statFile?: (abs: string) => { mtimeMs: number; size: number } | null;
        extract?: (relFname: string, ext: string, code: string) => Tag[] | null;
        /** Bypass both caches (the /repomap --refresh flag). */
        refresh?: boolean;
        /** Test seam: treat the build as slow so the in-memory map cache serves
         * the next identical build (mirrors aider's refresh="auto" threshold). */
        mapCacheForcedMs?: number;
}

export interface RepoMapResult {
        text: string;
        tokens: number;
        filesIncluded: number;
        /** How many files produced tags (diagnostics). */
        taggedFiles: number;
        fromMapCache: boolean;
}

/** Extract mentions from free text (aider's mention detection, simplified
 * to the deterministic core): whitespace-split tokens matched against the
 * known file list (paths + stems), \W-split words ≥4 chars as idents.
 * Pure — repomap-cli.ts feeds it the task string. */
export function extractMentions(text: string, files: string[]): { files: string[]; idents: string[] } {
        const byPath = new Map<string, string>();
        const byStem = new Map<string, string>();
        for (const f of files) {
                byPath.set(f, f);
                const base = f.slice(f.lastIndexOf("/") + 1);
                const dot = base.lastIndexOf(".");
                const stem = dot > 0 ? base.slice(0, dot) : base;
                if (stem.length >= 5 && !byStem.has(stem)) byStem.set(stem, f);
        }
        const mentionedFiles = new Set<string>();
        for (const tok of text.split(/\s+/)) {
                const clean = tok.replace(/^[`'"([{]+|[`'")\]}:;,!?..]+$/g, "");
                if (!clean) continue;
                const hit = byPath.get(clean);
                if (hit) {
                        mentionedFiles.add(hit);
                        continue;
                }
                // A trailing path fragment (`src/foo.ts:` in prose) — try prefix match.
                const pathHit = files.find((f) => clean === f || clean.startsWith(`${f}:`));
                if (pathHit) mentionedFiles.add(pathHit);
        }
        const mentionedIdents = new Set<string>();
        for (const word of text.split(/\W+/)) {
                if (word.length >= 4) mentionedIdents.add(word);
        }
        // File stems double as idents (aider matches stems both ways).
        for (const stem of byStem.keys()) {
                if (mentionedIdents.has(stem)) mentionedFiles.add(byStem.get(stem)!);
        }
        return { files: [...mentionedFiles], idents: [...mentionedIdents] };
}

/** The module-wide in-memory map cache (aider's map_cache). */
const mapCache = new MapCache();

export function clearRepomapCaches(): void {
        mapCache.clear();
}

/** Build the repo map. Returns null when disabled/empty — never throws
 * (context-brief.ts's contract: the map degrades, the delegation does
 * not). The per-file cache is written best-effort at the end. */
export async function buildRepoMap(args: BuildRepoMapArgs): Promise<RepoMapResult | null> {
        if (!repomapEnabled()) return null;
        const startedAt = Date.now();
        let files = args.files.filter((f) => !SKIP_PATH.test(f) && !SKIP_EXT.test(f));
        if (files.length === 0) return null;
        const cap = maxFilesCap();
        if (files.length > cap) files = files.slice(0, cap);

        const budget = args.budgetTokens ?? mapTokenBudget();
        const mentionsKey = `${(args.mentionedFiles ?? []).sort().join(",")}|${(args.mentionedIdents ?? []).sort().join(",")}`;
        const cached = args.refresh === true ? null : mapCache.get(files, budget, mentionsKey);
        if (cached) {
                return { ...cached, taggedFiles: 0, fromMapCache: true };
        }

        const cachePath = args.cachePath ?? joinDotUnown(args.root);
        const cache: TagsCacheFile = args.refresh === true ? { version: 1, entries: {} } : loadTagsCache(cachePath);

        const readFile = args.readFile ?? ((abs: string) => {
                try {
                        return readFileSyncText(abs);
                } catch {
                        return null;
                }
        });
        const statFile =
                args.statFile ??
                ((abs: string) => {
                        try {
                                return statSyncBestEffort(abs);
                        } catch {
                                return null;
                        }
                });
        // The default extractor: tree-sitter for vendored grammars, regex
        // fallback for the fallback languages, null (→ bare filename) beyond.
        let runtime: RepomapRuntime | null = null;
        const extract =
                args.extract ??
                ((rel: string, ext: string, code: string) => {
                        if (grammarForExt(ext) !== null) {
                                return runtime?.extract(rel, ext, code) ?? null;
                        }
                        const tags = regexFallbackTags(rel, code);
                        return tags.length > 0 ? tags : null;
                });
        if (!args.extract) runtime = await getRepomapRuntime();

        const allTags: Tag[] = [];
        const lineCache = new Map<string, string[] | null>();
        const readLines = (rel: string): string[] | null => {
                if (lineCache.has(rel)) return lineCache.get(rel)!;
                const content = readFile(joinAbs(args.root, rel));
                const lines = content === null ? null : content.split("\n");
                lineCache.set(rel, lines);
                return lines;
        };

        let taggedFiles = 0;
        for (const rel of files) {
                const abs = joinAbs(args.root, rel);
                const stat = statFile(abs);
                if (!stat) continue; // deleted between listing and build — skip
                const prev = cache.entries[rel];
                // Fast path: stat matches → tags without reading the file at all
                // (the cache's purpose; aider's mtime trust, + size).
                if (entryMatchesStat(prev, stat)) {
                        if (prev!.tags.length > 0) {
                                allTags.push(...prev!.tags);
                                taggedFiles++;
                        }
                        continue;
                }
                const content = readFile(abs);
                if (content === null) continue;
                const ext = extOf(rel);
                if (!ext) continue; // extensionless scripts → bare filename lane
                const hash = sha256Of(content);
                if (entryMatchesHash(prev, hash)) {
                        // Stat moved but content is identical (the rewrite race):
                        // keep the tags, self-heal the entry's stat so the fast path
                        // hits next time.
                        cache.entries[rel] = { ...prev!, mtimeMs: stat.mtimeMs, size: stat.size };
                        if (prev!.tags.length > 0) {
                                allTags.push(...prev!.tags);
                                taggedFiles++;
                        }
                        continue;
                }
                const tags = extract(rel, ext, content) ?? [];
                cache.entries[rel] = { mtimeMs: stat.mtimeMs, size: stat.size, sha256: hash, tags };
                if (tags.length > 0) {
                        allTags.push(...tags);
                        taggedFiles++;
                }
        }
        trimCache(cache);

        const chatFiles = new Set(args.chatFiles ?? []);
        const graph: RefGraph = buildRefGraph(files, allTags, {
                chatFiles,
                mentionedFiles: new Set(args.mentionedFiles ?? []),
                mentionedIdents: new Set(args.mentionedIdents ?? []),
        });
        const ranked = rankGraph(graph);
        const entries: RenderEntry[] = buildRenderEntries(ranked, graph, files, chatFiles);
        const fitted = fitToBudget(entries, budget, readLines);

        const result: RepoMapResult = {
                text: fitted.text,
                tokens: fitted.tokens,
                filesIncluded: entries.length,
                taggedFiles,
                fromMapCache: false,
        };
        mapCache.set(files, budget, mentionsKey, { text: result.text, tokens: result.tokens, filesIncluded: result.filesIncluded }, args.mapCacheForcedMs ?? Date.now() - startedAt);
        if (!args.refresh) saveTagsCache(cachePath, cache);
        return result;
}

// ---------------------------------------------------------------------------
// fs defaults (kept trivial + swappable — the module's logic is the above)
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function readFileSyncText(abs: string): string | null {
        try {
                return readFileSync(abs, "utf8");
        } catch {
                return null;
        }
}

function statSyncBestEffort(abs: string): { mtimeMs: number; size: number } | null {
        if (!existsSync(abs)) return null;
        const s = statSync(abs);
        return { mtimeMs: s.mtimeMs, size: s.size };
}

function joinAbs(root: string, rel: string): string {
        return join(root, rel);
}

function joinDotUnown(root: string): string {
        return join(root, ".unown", "repomap-cache.json");
}
