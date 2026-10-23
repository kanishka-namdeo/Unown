/**
 * cache.ts — the repo-map tag cache.
 *
 * Three layers, aider's shape:
 *   1. Per-file tags on disk: `.unown/repomap-cache.json` —
 *      { relFname: { mtimeMs, size, sha256, tags } }. Aider trusts mtime
 *      alone; we fast-path mtime+size and hash on mismatch (a same-mtime
 *      rewrite — the classic editor save race — still gets caught).
 *   2. In-memory whole-map cache keyed by (files, budget, mentions) —
 *      re-builds of an unchanged repo are free.
 *   3. Rendered-line reads happen per build via the injected reader (no
 *      separate render cache in v1: builds are ms-fast once tags are
 *      cached, and one fewer cache is one fewer invalidation bug).
 *
 * REPOMAP_CACHE_VERSION bumps when the grammar queries or the Tag shape
 * change (aider's CACHE_VERSION pattern) — stale entries are dropped
 * wholesale on version mismatch.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Tag } from "./tags.ts";

export const REPOMAP_CACHE_VERSION = 1;

/** Cap on cached entries (aider's diskcache is unbounded; a JSON file is
 * not — 20k files is far beyond any repo the map is useful for). */
export const MAX_CACHE_ENTRIES = 20_000;

export interface CacheEntry {
        mtimeMs: number;
        size: number;
        sha256: string;
        tags: Tag[];
}

export interface TagsCacheFile {
        version: number;
        entries: Record<string, CacheEntry>;
}

export function emptyCache(): TagsCacheFile {
        return { version: REPOMAP_CACHE_VERSION, entries: {} };
}

/** Load the tags cache (missing/corrupt/stale-version → empty; corrupt
 * caches are REBUILT, never fatal — the map degrades to a full parse). */
export function loadTagsCache(path: string): TagsCacheFile {
        try {
                if (!existsSync(path)) return emptyCache();
                const raw = JSON.parse(readFileSync(path, "utf8"));
                if (!raw || raw.version !== REPOMAP_CACHE_VERSION || typeof raw.entries !== "object") {
                        return emptyCache();
                }
                const cache: TagsCacheFile = { version: REPOMAP_CACHE_VERSION, entries: {} };
                let count = 0;
                for (const [k, v] of Object.entries(raw.entries)) {
                        if (count >= MAX_CACHE_ENTRIES) break;
                        const e = v as CacheEntry;
                        if (typeof e?.mtimeMs === "number" && typeof e?.size === "number" && typeof e?.sha256 === "string" && Array.isArray(e?.tags)) {
                                cache.entries[k] = e;
                                count++;
                        }
                }
                return cache;
        } catch {
                return emptyCache();
        }
}

/** Atomic save (write-temp + rename — the repo-wide convention). Best
 * effort: a read-only .unown or a full disk must never fail a build. */
export function saveTagsCache(path: string, cache: TagsCacheFile): void {
        try {
                mkdirSync(dirname(path), { recursive: true });
                const tmp = `${path}.tmp`;
                writeFileSync(tmp, JSON.stringify(cache));
                renameSync(tmp, path);
        } catch {
                /* cache persistence is best-effort by contract */
        }
}

export function sha256Of(content: string): string {
        return createHash("sha256").update(content).digest("hex");
}

/** Fast-path validity: mtime+size match → the entry is trusted WITHOUT
 * reading the file (that read-avoidance is the cache's whole purpose;
 * aider trusts mtime alone — we add size). Same-stat rewrites with
 * different content are undetectable at this tier by design (they were
 * also invisible to aider). */
export function entryMatchesStat(entry: CacheEntry | undefined, stat: { mtimeMs: number; size: number }): boolean {
        return entry !== undefined && entry.mtimeMs === stat.mtimeMs && entry.size === stat.size;
}

/** Slow-path validity: the stat moved, so the file WAS read — the content
 * hash decides whether the entry survives (the editor-rewrite race: same
 * content, new mtime) or is rebuilt. */
export function entryMatchesHash(entry: CacheEntry | undefined, sha256: string): boolean {
        return entry !== undefined && entry.sha256 === sha256;
}

/** Insertion-ordered LRU-ish trim (Map order = insertion order). */
export function trimCache(cache: TagsCacheFile, max = MAX_CACHE_ENTRIES): TagsCacheFile {
        const keys = Object.keys(cache.entries);
        if (keys.length <= max) return cache;
        for (const k of keys.slice(0, keys.length - max)) delete cache.entries[k];
        return cache;
}

// ---------------------------------------------------------------------------
// In-memory whole-map cache (aider's map_cache)
// ---------------------------------------------------------------------------

interface MapCacheEntry {
        filesKey: string;
        budget: number;
        mentionsKey: string;
        result: RepoMapSnapshot;
        at: number;
        /** How long the ORIGINAL build took (aider's refresh="auto": a cheap
         * build is never worth serving stale — rebuild it). */
        buildMs: number;
}

/** What the core caches: the built map (rendering is deterministic given
 * inputs, so the text is cached directly). */
export interface RepoMapSnapshot {
        text: string;
        tokens: number;
        filesIncluded: number;
}

/** Serve a cached map only within this window of its build (bounds
 * staleness: edits show up on the next build after the TTL). */
export const MAP_CACHE_TTL_MS = 30_000;

/** Only builds slower than this are worth caching (aider's refresh="auto"
 * semantics: `use cache only if the last build took > 1s` — anything
 * cheaper is rebuilt fresh, keeping edits visible at no real cost). */
export const MAP_CACHE_SLOW_MS = 900;

export class MapCache {
        private entries: MapCacheEntry[] = [];
        private max: number;
        private ttlMs: number;
        private slowMs: number;
        constructor(max = 8, ttlMs = MAP_CACHE_TTL_MS, slowMs = MAP_CACHE_SLOW_MS) {
                this.max = max;
                this.ttlMs = ttlMs;
                this.slowMs = slowMs;
        }

        private keyOf(files: string[], budget: number, mentions: string): string {
                return `${files.length}:${files.join(",")}\u0000${budget}\u0000${mentions}`;
        }

        get(files: string[], budget: number, mentions: string): RepoMapSnapshot | null {
                const k = this.keyOf(files, budget, mentions);
                const hit = this.entries.find((e) => e.filesKey === k);
                if (!hit) return null;
                // Fresh enough AND the original build was expensive enough to be
                // worth serving stale. Cheap builds rebuild (edits stay visible).
                if (Date.now() - hit.at > this.ttlMs || hit.buildMs < this.slowMs) return null;
                return hit.result;
        }

        set(files: string[], budget: number, mentions: string, result: RepoMapSnapshot, buildMs = 0): void {
                const k = this.keyOf(files, budget, mentions);
                this.entries = this.entries.filter((e) => e.filesKey !== k);
                this.entries.push({ filesKey: k, budget, mentionsKey: mentions, result, at: Date.now(), buildMs });
                if (this.entries.length > this.max) {
                        this.entries.sort((a, b) => a.at - b.at);
                        this.entries = this.entries.slice(this.entries.length - this.max);
                }
        }

        clear(): void {
                this.entries = [];
        }
}
