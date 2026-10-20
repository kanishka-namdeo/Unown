/**
 * webcache.ts — the web results store: a persistent, cross-process,
 * cross-platform cache for web_search result sets and fetched pages.
 *
 * Why: every unown surface that touches the web — terminal sessions,
 * parallel subagents, engine sandbox runs, automations — is its own
 * process with (until now) only process-local 10-minute fetch memories.
 * Identical queries re-burn provider quotas (Tavily/Brave/Serper credits,
 * IP rate limits on the keyless chain) and re-pay latency for pages that
 * did not change. This module gives all of them one shared, on-disk store:
 *
 *   - exact-key only (the repo's own H20 benchmark refuted near-duplicate
 *     semantic serving — outcome-flipping edits embed at cosine 0.95+)
 *   - "not too old" → TTL windows (search default 60 min; fetch honors
 *     origin Cache-Control/heuristic default 30 min)
 *   - "no version change" → RFC 9111 revalidation: direct fetches capture
 *     ETag/Last-Modified and stale entries are replayed conditionally;
 *     a 304 answer means the page did not change and the stored body is
 *     re-served without paying for a full response
 *   - stale-if-error (RFC 5861 spirit): when every upstream attempt fails
 *     (quota exhausted, network down, provider 5xx), the last good result
 *     is served within a bounded window — always flagged as stale
 *   - content-addressed immutable entries + atomic writes (the npm/cacache
 *     model): reads never lock, corrupt entries self-heal, last-writer-wins
 *     on concurrent identical writes is idempotent
 *   - everything fails open: any filesystem error degrades to a bypass,
 *     never to a failed web call (engine sandboxes may not even see $HOME)
 *
 * Storage layout (user-scoped, machine-local, cross-project by design —
 * the public web is not project-specific; single-user 0700 home dir):
 *
 *   $UNOWN_WEB_CACHE_DIR (default $UNOWN_HOME/cache/web)
 *     entries/<key[0..1]>/<sha256>.json   self-contained cache entries
 *     events.jsonl                        append-only observability feed
 *
 * LRU signal is the entry file's mtime (bumped with utimes on every hit —
 * no content rewrites on the hot path). Eviction is byte-capped with an
 * opportunistic sweep on write. Events rotate at a line cap; stats are
 * derived by scanning on demand (engine API + `unown webcache stats`).
 *
 * Env knobs (unown convention: `||` never `??` — empty string means unset;
 * all read at call time so users can flip them without a restart):
 *
 *   UNOWN_WEB_CACHE=0                      disable the store entirely
 *   UNOWN_WEB_CACHE_DIR=<path>             relocate the store
 *   UNOWN_WEB_SEARCH_CACHE_TTL_MS          search freshness (default 3600000)
 *   UNOWN_WEBFETCH_CACHE_TTL_MS            fetch heuristic freshness (default 1800000)
 *   UNOWN_WEB_SEARCH_STALE_MS              search stale-if-error window (default 86400000)
 *   UNOWN_WEBFETCH_STALE_MS                fetch stale-if-error window (default 604800000)
 *   UNOWN_WEB_CACHE_MAX_BYTES              eviction cap (default 268435456 = 256 MiB)
 *
 * No child processes, no native modules, no process.platform branches —
 * the same portability contract the websearch module keeps. Keys are
 * sha256 hex so filenames are legal and collision-free on every OS
 * (Windows reserved characters, MAX_PATH, case-insensitive filesystems).
 */
import { createHash } from "node:crypto";
import {
        appendFileSync,
        existsSync,
        mkdirSync,
        readFileSync,
        readdirSync,
        rmSync,
        statSync,
        utimesSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { atomicWriteFileSync } from "./atomic.ts";

// ---------------------------------------------------------------------------
// Env knobs
// ---------------------------------------------------------------------------

const DEFAULT_SEARCH_TTL_MS = 60 * 60_000; // 60 min
const DEFAULT_FETCH_TTL_MS = 30 * 60_000; // 30 min heuristic (origin headers may override)
const DEFAULT_SEARCH_STALE_MS = 24 * 60 * 60_000; // 24 h stale-if-error window
const DEFAULT_FETCH_STALE_MS = 7 * 24 * 60 * 60_000; // 7 d stale-if-error window
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024; // 256 MiB
const FETCH_TTL_ORIGIN_CAP_MS = 24 * 60 * 60_000; // never trust an origin beyond 24 h
const EVENTS_ROTATE_BYTES = 2 * 1024 * 1024; // rotate the feed past 2 MiB
const EVENTS_ROTATE_KEEP = 10_000; // ...keeping the newest 10k events
const EVICT_SWEEP_PROBABILITY = 1 / 8; // amortize sweeps across writes
const EVICT_TARGET_RATIO = 0.9; // sweep down to 90% of the byte cap

/** `||` never `??` — and empty string means UNSET, so it must be filtered
 * before Number(): Number("") is 0, which would silently turn every unset
 * knob into "0" (the trap documented at server.ts's PI_AGENT_PORT parse).
 * An explicit "0" stays a legal value (e.g. TTL 0 = always revalidate). */
function envNumber(name: string, fallback: number, opts: { min?: number; max?: number } = {}): number {
        const raw = (process.env[name] || "").trim();
        if (raw === "") return fallback;
        const num = Number(raw);
        if (!Number.isFinite(num) || num < 0) return fallback;
        if (opts.min !== undefined && num < opts.min) return opts.min;
        if (opts.max !== undefined && num > opts.max) return opts.max;
        return Math.floor(num);
}

export function webCacheEnabled(): boolean {
        return (process.env.UNOWN_WEB_CACHE || "1") !== "0";
}

/** The store root: UNOWN_WEB_CACHE_DIR > UNOWN_HOME > ~/.unown (mirrors
 * term.ts/packaging.ts — kept local so this module stays import-light). */
export function webCacheRoot(): string {
        const override = process.env.UNOWN_WEB_CACHE_DIR || "";
        if (override) return resolve(override);
        const home = process.env.UNOWN_HOME || join(homedir(), ".unown");
        return join(home, "cache", "web");
}

export function searchCacheTtlMs(): number {
        return envNumber("UNOWN_WEB_SEARCH_CACHE_TTL_MS", DEFAULT_SEARCH_TTL_MS, { max: 7 * 24 * 60 * 60_000 });
}
export function fetchCacheTtlMs(): number {
        return envNumber("UNOWN_WEBFETCH_CACHE_TTL_MS", DEFAULT_FETCH_TTL_MS, { max: 7 * 24 * 60 * 60_000 });
}
export function searchStaleMs(): number {
        return envNumber("UNOWN_WEB_SEARCH_STALE_MS", DEFAULT_SEARCH_STALE_MS);
}
export function fetchStaleMs(): number {
        return envNumber("UNOWN_WEBFETCH_STALE_MS", DEFAULT_FETCH_STALE_MS);
}
export function webCacheMaxBytes(): number {
        return envNumber("UNOWN_WEB_CACHE_MAX_BYTES", DEFAULT_MAX_BYTES, { min: 1024 });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebCacheKind = "search" | "fetch-text" | "fetch-raw";

/** RFC 9111 validators captured on direct fetches — the "version change"
 * detectors. A 304 against these means the stored body is still current. */
export interface WebCacheValidators {
        etag?: string;
        lastModified?: string;
}

export interface WebCacheEntry<T = any> {
        schema: 1;
        kind: WebCacheKind;
        key: string; // sha256 hex — also the storage filename
        keyMaterial: string; // canonical JSON of the key inputs (debugging)
        payload: T; // WebSearchOutcome | FetchOutcome shape
        provider: string; // provider id or fetch method that produced it
        storedAt: number;
        ttlMs: number;
        staleIfErrorMs: number;
        validators?: WebCacheValidators;
        payloadSha256: string;
        bytes: number;
}

export type WebCacheEventKind =
        | "hit"
        | "revalidated"
        | "miss"
        | "stale"
        | "bypass"
        | "evict"
        | "clear"
        | "error";

export interface WebCacheEvent {
        ts: number;
        kind: WebCacheEventKind;
        tool: "web_search" | "webfetch" | "fetch_url" | "engine";
        /** provider id / fetch method — the by-provider aggregation key. */
        provider?: string;
        /** free-form context (query or host for the feed; sweep notes). */
        detail?: string;
        ageMs?: number;
}

/** What a lookup hands back: the payload plus everything the renderer and
 * the caller need to explain where the answer came from. */
export interface WebCacheHit<T = any> {
        value: T;
        entry: WebCacheEntry<T>;
        provenance: "hit" | "revalidated" | "stale";
        ageMs: number;
}

// ---------------------------------------------------------------------------
// Keys — canonical, cross-platform, exact-match
// ---------------------------------------------------------------------------

/** Query normalization: trim, collapse internal whitespace, casefold.
 * Search engines are case- and whitespace-insensitive; normalizing here is
 * what turns a model's re-phrased retry into a cache hit. */
export function normalizeSearchQuery(query: string): string {
        return query.trim().replace(/\s+/g, " ").toLowerCase();
}

/** URL normalization for fetch keys: lowercase host, strip the fragment,
 * strip default ports. Search params and path stay verbatim (they select
 * different resources). */
export function normalizeFetchUrl(rawUrl: string): string {
        try {
                const url = new URL(rawUrl);
                url.hash = "";
                if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
                        url.port = "";
                }
                return url.toString();
        } catch {
                return rawUrl;
        }
}

function sha256(text: string): string {
        return createHash("sha256").update(text).digest("hex");
}

export interface SearchCacheKey {
        key: string;
        /** Canonical key material (debugging + stored on the entry). */
        keyMaterial: string;
        ttlMs: number;
        staleIfErrorMs: number;
}

/** Key for a search: normalized query + effective maxResults + domain
 * filters (they alter the result set). Deliberately chain-independent —
 * the same web answers regardless of which provider served it. */
export function searchCacheKey(query: string, opts: { maxResults?: number; allowedDomains?: string[]; blockedDomains?: string[] } = {}): SearchCacheKey {
        const material = JSON.stringify({
                kind: "search",
                q: normalizeSearchQuery(query),
                maxResults: opts.maxResults ?? 8,
                allowed: [...(opts.allowedDomains ?? [])].sort(),
                blocked: [...(opts.blockedDomains ?? [])].sort(),
        });
        return { key: sha256(material), keyMaterial: material, ttlMs: searchCacheTtlMs(), staleIfErrorMs: searchStaleMs() };
}

export interface FetchCacheKey {
        key: string;
        /** Canonical key material (debugging + stored on the entry). */
        keyMaterial: string;
        ttlMs: number;
        staleIfErrorMs: number;
}

/** Key for a fetched page. The stored payload is fetched at the ceiling
 * (fetchMaxChars caps at 200k) and sliced per-request at render time, so
 * maxChars is NOT part of the key — one entry serves every cap. */
export function fetchCacheKey(normalizedUrl: string, raw: boolean): FetchCacheKey {
        const material = JSON.stringify({ kind: raw ? "fetch-raw" : "fetch-text", url: normalizedUrl });
        return { key: sha256(material), keyMaterial: material, ttlMs: fetchCacheTtlMs(), staleIfErrorMs: fetchStaleMs() };
}

// ---------------------------------------------------------------------------
// Origin TTL parsing (RFC 9111 §5.2: Cache-Control response directives)
// ---------------------------------------------------------------------------

/** Freshness from origin headers: honor max-age/s-maxage, capped at 24 h;
 * `no-store`/`no-cache` → 0 (not storable); anything else → heuristic
 * default (the env knob). Pure string parsing — no header-object deps. */
export function computeFetchTtlMs(cacheControl: string | null | undefined, expiresEpochMs: number | null | undefined, now: number): number {
        const cc = (cacheControl ?? "").toLowerCase();
        if (/\bno-store\b/.test(cc) || /\bno-cache\b/.test(cc)) return 0;
        const shared = /(?:^|[, ])s-maxage=(\d+)/.exec(cc);
        const maxAge = shared ?? /(?:^|[, ])max-age=(\d+)/.exec(cc);
        if (maxAge) {
                const seconds = Number(maxAge[1]);
                if (Number.isFinite(seconds)) return Math.min(seconds * 1000, FETCH_TTL_ORIGIN_CAP_MS);
        }
        if (expiresEpochMs !== null && expiresEpochMs !== undefined && expiresEpochMs > now) {
                return Math.min(expiresEpochMs - now, FETCH_TTL_ORIGIN_CAP_MS);
        }
        return fetchCacheTtlMs();
}

// ---------------------------------------------------------------------------
// Store — content-addressed entries, atomic writes, fail-open everywhere
// ---------------------------------------------------------------------------

function entryPath(root: string, key: string): string {
        return join(root, "entries", key.slice(0, 2), `${key}.json`);
}

function eventsPath(root: string): string {
        return join(root, "events.jsonl");
}

/** Wrap a store operation so filesystem trouble (unreachable $HOME in a
 * sandbox, disk full, permissions) degrades to a bypass — never fails a
 * web call. The optional event lets observability see the degradation. */
function failOpen<T>(op: () => T, fallback: T, onBypass?: () => void): T {
        try {
                return op();
        } catch {
                onBypass?.();
                return fallback;
        }
}

export function webCacheGet<T = any>(key: string): WebCacheEntry<T> | null {
        if (!webCacheEnabled()) return null;
        return failOpen(
                () => {
                        const root = webCacheRoot();
                        const file = entryPath(root, key);
                        if (!existsSync(file)) return null;
                        let entry: WebCacheEntry<T> | null = null;
                        try {
                                entry = JSON.parse(readFileSync(file, "utf8")) as WebCacheEntry<T>;
                        } catch {
                                entry = null; // torn/corrupt file → self-heal below
                        }
                        // Shape gate: unknown schema, key mismatch or unparseable JSON →
                        // self-heal to a miss (delete + fall through).
                        if (!entry || entry.schema !== 1 || entry.key !== key) {
                                rmSync(file, { force: true });
                                return null;
                        }
                        // Integrity: entries are immutable, so a checksum mismatch means
                        // corruption (torn write that survived rename, bit rot, tampering).
                        const expected = sha256(JSON.stringify(entry.payload));
                        if (entry.payloadSha256 !== expected) {
                                rmSync(file, { force: true });
                                webCacheLogEvent({ ts: Date.now(), kind: "error", tool: "engine", detail: `integrity mismatch on ${key.slice(0, 12)}` });
                                return null;
                        }
                        return entry;
                },
                null,
        );
}

export function webCachePut(entry: Omit<WebCacheEntry, "payloadSha256" | "bytes">): void {
        if (!webCacheEnabled()) return;
        failOpen(
                () => {
                        const root = webCacheRoot();
                        mkdirSync(join(root, "entries"), { recursive: true, mode: 0o700 });
                        const payloadSha256 = sha256(JSON.stringify(entry.payload));
                        const full: WebCacheEntry = { ...entry, payloadSha256, bytes: 0 };
                        // Self-referential size: serialize twice so the stored `bytes`
                        // matches the stored file (converges on the second pass).
                        full.bytes = Buffer.byteLength(JSON.stringify(full), "utf8");
                        atomicWriteFileSync(entryPath(root, entry.key), JSON.stringify(full));
                        maybeEvict(root);
                },
                undefined,
                () => webCacheLogEvent({ ts: Date.now(), kind: "bypass", tool: "engine", detail: "store write failed" }),
        );
}

/** LRU touch — bump the entry file's mtime without rewriting content.
 * utimes is atomic and cross-platform; 1 s mtime granularity is plenty. */
export function webCacheTouch(key: string): void {
        if (!webCacheEnabled()) return;
        failOpen(
                () => {
                        const file = entryPath(webCacheRoot(), key);
                        const now = new Date();
                        utimesSync(file, now, now);
                },
                undefined,
        );
}

// ---------------------------------------------------------------------------
// Policy — pure functions (the only logic the tests need to pin precisely)
// ---------------------------------------------------------------------------

export function isFresh(entry: WebCacheEntry, now = Date.now()): boolean {
        return now - entry.storedAt < entry.ttlMs;
}

/** A stale entry is still servable when the upstream world failed — within
 * the bounded stale-if-error window. Always flagged to the caller. */
export function withinStaleWindow(entry: WebCacheEntry, now = Date.now()): boolean {
        return now - entry.storedAt < entry.ttlMs + entry.staleIfErrorMs;
}

/** Freshness lookup for the happy path. Touches the LRU signal on hit. */
export function lookupFresh<T = any>(key: string, now = Date.now()): WebCacheHit<T> | null {
        const entry = webCacheGet<T>(key);
        if (!entry) return null;
        if (!isFresh(entry, now)) return null;
        webCacheTouch(key);
        const ageMs = now - entry.storedAt;
        return { value: entry.payload, entry, provenance: "hit", ageMs };
}

/** Stale-if-error lookup — only called after every upstream attempt has
 * failed. Beyond the window the store has nothing to say. */
export function lookupStale<T = any>(key: string, now = Date.now()): WebCacheHit<T> | null {
        const entry = webCacheGet<T>(key);
        if (!entry || !withinStaleWindow(entry, now)) return null;
        const ageMs = now - entry.storedAt;
        return { value: entry.payload, entry, provenance: "stale", ageMs };
}

/** Refresh a revalidated entry (304): the body is unchanged, so only the
 * freshness clock moves. Also the path 304 headers use to update
 * validators when an origin rotates its ETag. */
export function webCacheRefresh(key: string, validators?: WebCacheValidators, now = Date.now()): void {
        if (!webCacheEnabled()) return;
        failOpen(
                () => {
                        const root = webCacheRoot();
                        const file = entryPath(root, key);
                        const entry = JSON.parse(readFileSync(file, "utf8")) as WebCacheEntry;
                        entry.storedAt = now;
                        if (validators) entry.validators = validators;
                        atomicWriteFileSync(file, JSON.stringify(entry));
                },
                undefined,
        );
}

// ---------------------------------------------------------------------------
// Events — append-only feed, rotated, scanned on demand for stats
// ---------------------------------------------------------------------------

export function webCacheLogEvent(event: WebCacheEvent): void {
        if (!webCacheEnabled() && event.kind !== "clear") return;
        failOpen(
                () => {
                        const root = webCacheRoot();
                        mkdirSync(root, { recursive: true, mode: 0o700 });
                        const file = eventsPath(root);
                        appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
                        rotateEventsIfLarge(root, file);
                },
                undefined,
        );
}

function rotateEventsIfLarge(root: string, file: string): void {
        const stat = statSync(file);
        if (stat.size < EVENTS_ROTATE_BYTES) return;
        const lines = readFileSync(file, "utf8").split("\n").filter((line) => line.trim().length > 0);
        const keep = lines.slice(-EVENTS_ROTATE_KEEP);
        // atomicWriteFileSync (pid-tagged temp + rename): two processes rotating
        // concurrently each write their own temp; last rename wins and both
        // keep-sets are derived from the same pre-rotation file — benign.
        atomicWriteFileSync(file, `${keep.join("\n")}\n`);
}

// ---------------------------------------------------------------------------
// Eviction — byte-capped, LRU by mtime, opportunistic
// ---------------------------------------------------------------------------

interface EntryFileStat {
        file: string;
        key: string;
        mtimeMs: number;
        bytes: number;
}

function scanEntries(root: string): EntryFileStat[] {
        const out: EntryFileStat[] = [];
        const shards = readdirSync(join(root, "entries"), { withFileTypes: true }).filter((d) => d.isDirectory());
        for (const shard of shards) {
                const dir = join(root, "entries", shard.name);
                for (const name of readdirSync(dir)) {
                        if (!name.endsWith(".json")) continue;
                        const file = join(dir, name);
                        const stat = statSync(file);
                        out.push({ file, key: name.replace(/\.json$/, ""), mtimeMs: stat.mtimeMs, bytes: stat.size });
                }
        }
        return out;
}

function maybeEvict(root: string): void {
        if (Math.random() > EVICT_SWEEP_PROBABILITY) return;
        webCacheSweep(root);
}

/** Deterministic LRU sweep — public so `unown webcache` (and tests) can run
 * it on demand instead of waiting on the amortized write-path probability.
 * Returns what it evicted. */
export function webCacheSweep(rootArg?: string): { evicted: number; freedBytes: number; totalBytes: number } {
        const root = rootArg ?? webCacheRoot();
        const cap = webCacheMaxBytes();
        const entries = failOpen(() => scanEntries(root), [] as EntryFileStat[]);
        const total = entries.reduce((sum, e) => sum + e.bytes, 0);
        if (!entries.length || total <= cap) return { evicted: 0, freedBytes: 0, totalBytes: total };
        const target = Math.floor(cap * EVICT_TARGET_RATIO);
        const byLru = [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs);
        let freed = 0;
        let evicted = 0;
        for (const e of byLru) {
                if (total - freed <= target) break;
                if (failOpen(() => (rmSync(e.file, { force: true }), true), false)) {
                        freed += e.bytes;
                        evicted++;
                }
        }
        if (evicted > 0) {
                webCacheLogEvent({
                        ts: Date.now(),
                        kind: "evict",
                        tool: "engine",
                        detail: `${evicted} entries (${(freed / 1024 / 1024).toFixed(1)} MiB) — LRU sweep`,
                });
        }
        return { evicted, freedBytes: freed, totalBytes: total };
}

// ---------------------------------------------------------------------------
// Stats + clear (engine API + `unown webcache`)
// ---------------------------------------------------------------------------

export interface WebCacheStats {
        enabled: boolean;
        root: string;
        entries: number;
        bytes: number;
        maxBytes: number;
        ttl: { searchMs: number; fetchMs: number; searchStaleMs: number; fetchStaleMs: number };
        totals: { hit: number; revalidated: number; miss: number; stale: number; bypass: number; evict: number; clear: number; error: number };
        savedRequests: number; // hits + revalidations that skipped a full upstream call
        byTool: Record<string, number>;
        byProvider: Record<string, number>;
        recentEvents: WebCacheEvent[];
}

export function webCacheStats(): WebCacheStats {
        const enabled = webCacheEnabled();
        const root = webCacheRoot();
        const entries = failOpen(() => scanEntries(root), [] as EntryFileStat[]);
        const events = failOpen(
                () => {
                        const file = eventsPath(root);
                        if (!existsSync(file)) return [] as WebCacheEvent[];
                        const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
                        return lines.slice(-500).flatMap((line) => {
                                try {
                                        return [JSON.parse(line) as WebCacheEvent];
                                } catch {
                                        return [];
                                }
                        });
                },
                [] as WebCacheEvent[],
        );
        const totals: WebCacheStats["totals"] = { hit: 0, revalidated: 0, miss: 0, stale: 0, bypass: 0, evict: 0, clear: 0, error: 0 };
        const byTool: Record<string, number> = {};
        const byProvider: Record<string, number> = {};
        for (const event of events) {
                if (event.kind in totals) totals[event.kind as keyof WebCacheStats["totals"]]++;
                byTool[event.tool] = (byTool[event.tool] ?? 0) + 1;
                if (event.provider) byProvider[event.provider] = (byProvider[event.provider] ?? 0) + 1;
        }
        return {
                enabled,
                root,
                entries: entries.length,
                bytes: entries.reduce((sum, e) => sum + e.bytes, 0),
                maxBytes: webCacheMaxBytes(),
                ttl: {
                        searchMs: searchCacheTtlMs(),
                        fetchMs: fetchCacheTtlMs(),
                        searchStaleMs: searchStaleMs(),
                        fetchStaleMs: fetchStaleMs(),
                },
                totals,
                savedRequests: totals.hit + totals.revalidated,
                byTool,
                byProvider,
                recentEvents: events.slice(-50).reverse(),
        };
}

export function webCacheClear(): { removed: number; bytes: number } {
        const root = webCacheRoot();
        const entries = failOpen(() => scanEntries(root), [] as EntryFileStat[]);
        let removed = 0;
        let bytes = 0;
        for (const e of entries) {
                if (failOpen(() => (rmSync(e.file, { force: true }), true), false)) {
                        removed++;
                        bytes += e.bytes;
                }
        }
        // Drop empty shard dirs so a cleared store looks like a fresh one.
        failOpen(() => {
                const entriesRoot = join(root, "entries");
                if (existsSync(entriesRoot)) {
                        for (const d of readdirSync(entriesRoot, { withFileTypes: true })) {
                                if (d.isDirectory()) rmSync(join(entriesRoot, d.name), { recursive: true, force: true });
                        }
                }
        }, undefined);
        webCacheLogEvent({ ts: Date.now(), kind: "clear", tool: "engine", detail: `${removed} entries (${(bytes / 1024 / 1024).toFixed(1)} MiB)` });
        return { removed, bytes };
}

// ---------------------------------------------------------------------------
// Single-flight — concurrent identical calls coalesce in-process
// ---------------------------------------------------------------------------

const pending = new Map<string, Promise<any>>();

/** Parallel subagents asking the same thing should cost one upstream call:
 * while a key is in flight, joiners await the same promise. Cross-process
 * duplicates are inherently rarer and benign (identical immutable writes). */
export async function coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
        const existing = pending.get(key);
        if (existing) return existing as Promise<T>;
        const promise = fn().finally(() => {
                pending.delete(key);
        });
        pending.set(key, promise);
        return promise;
}

/** Test hook: drop the in-flight table between tests. */
export function resetCoalesce(): void {
        pending.clear();
}
