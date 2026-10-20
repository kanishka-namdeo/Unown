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
 *   UNOWN_WEB_CACHE_INDEX_MS               in-memory index max age (default 60000;
 *                                           0 = always rescan, the exact mode)
 *   UNOWN_WEB_CACHE_MEMO=0                 disable the hot-entry memo layer
 *   UNOWN_WEB_CACHE_MEMO_ENTRIES           memo entry cap (default 500)
 *   UNOWN_WEB_CACHE_MEMO_BYTES             memo byte cap (default 52428800 = 50 MiB)
 *   UNOWN_WEB_CACHE_MEMO_MS                memo freshness clock (default 180000)
 *   UNOWN_WEB_CACHE_DURABLE=1              fsync cache writes (default off — see below)
 *   UNOWN_WEB_CACHE_SWR=0                  disable stale-while-revalidate serving
 *   UNOWN_WEB_CACHE_SWR_MS                 bound the SWR window (default: the
 *                                           entry's own stale-if-error window)
 *
 * Perf layer (shaped by the measured baseline in benchmarks/webcache/ and
 * the prior-art record in docs/web-results-store.md):
 *   - in-memory index {key -> bytes, lastUsed}: stats and eviction answer
 *     from RAM instead of rescanning the disk — the Chromium SimpleCache
 *     model (8 bytes of metadata per entry, recency in RAM only, rebuilt by
 *     one scan on first use / every INDEX_MS / after a crash). Counters are
 *     approximate across processes (WebKit ships the same trade) and
 *     labeled as such in stats.
 *   - hot-entry memo (cacache's own answer to verify-on-read cost): a
 *     bounded, TTL'd LRU of parsed entries so repeat hits skip the disk
 *     read, JSON parse and sha256 entirely. A memoized answer still honors
 *     its entry's own TTL, so it is never FRESHER than the disk contract.
 *   - cache writes are tmp+rename WITHOUT fsync (the cacache/npm write
 *     model): a cache entry is re-fetchable, so process-crash safety is
 *     enough — a power-loss-torn entry is caught by the payload checksum
 *     and re-fetched (self-heal). The memory tiers keep their fsyncing
 *     atomicWriteFileSync because a lost learning note is gone forever;
 *     UNOWN_WEB_CACHE_DURABLE=1 restores it for this cache too.
 *   - stale-while-revalidate (RFC 5861, the half we lacked): a stale entry
 *     inside its window answers immediately — marked — while a background
 *     refresh restores freshness through the same single-flight machinery
 *     (nginx `proxy_cache_use_stale updating` / Varnish grace precedent).
 * No child processes, no native modules, no process.platform branches —
 * the same portability contract the websearch module keeps. Keys are
 * sha256 hex so filenames are legal and collision-free on every OS
 * (Windows reserved characters, MAX_PATH, case-insensitive filesystems).
 */
import { createHash } from "node:crypto";
import {
        appendFileSync,
        closeSync,
        existsSync,
        mkdirSync,
        openSync,
        readFileSync,
        readSync,
        readdirSync,
        renameSync,
        rmSync,
        statSync,
        writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { atomicWriteFileSync } from "./atomic.ts";

// ---------------------------------------------------------------------------
// Env knobs
// ---------------------------------------------------------------------------

const DEFAULT_SEARCH_TTL_MS = 60 * 60_000; // 60 min
const DEFAULT_FETCH_TTL_MS = 30 * 60_000; // 30 min heuristic (origin headers may override)
const DEFAULT_SEARCH_STALE_MS = 24 * 60 * 60_000; // 24 h stale-if-error window
const DEFAULT_FETCH_STALE_MS = 7 * 24 * 60 * 60_000; // 7 d stale-if-error window
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024; // 256 MiB
const DEFAULT_INDEX_MAX_AGE_MS = 60_000; // RAM index staleness bound
const DEFAULT_MEMO_ENTRIES = 500; // cacache's own memo shape
const DEFAULT_MEMO_BYTES = 50 * 1024 * 1024;
const DEFAULT_MEMO_TTL_MS = 3 * 60_000;
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
export function webCacheIndexMaxAgeMs(): number {
        return envNumber("UNOWN_WEB_CACHE_INDEX_MS", DEFAULT_INDEX_MAX_AGE_MS);
}
export function swrEnabled(): boolean {
        return (process.env.UNOWN_WEB_CACHE_SWR || "1") !== "0";
}
export function swrWindowMs(): number {
        return envNumber("UNOWN_WEB_CACHE_SWR_MS", Number.MAX_SAFE_INTEGER);
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

/** Cache-write durability: the cacache write model (tmp + rename, no fsync)
 * by default. Rationale: a cache entry is re-fetchable, so process-crash
 * safety is the right durability point — a power-loss-torn entry is caught
 * by the payload checksum on the next read and re-fetched (self-heal),
 * while fsync-per-write costs ~150x a buffered write on real disks
 * (LevelDB's own db_bench: fillseq 1.7us vs fillsync 268us) and npm's
 * history has 3-8x install regressions from fsync-heavy phases on
 * Docker/network mounts. UNOWN_WEB_CACHE_DURABLE=1 opts back in for users
 * who want it; the memory tiers keep their fsyncing writer regardless —
 * a lost learning note is gone forever, a lost cache entry is a refetch. */
function writeEntryFile(file: string, content: string): void {
        if (process.env.UNOWN_WEB_CACHE_DURABLE === "1") {
                atomicWriteFileSync(file, content);
                return;
        }
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 }); // first write into a shard creates it (atomic.ts did this implicitly)
        const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
        writeFileSync(tmp, content, "utf8");
        renameSync(tmp, file);
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
                        let raw: string;
                        try {
                                raw = readFileSync(file, "utf8"); // ENOENT = plain miss
                        } catch {
                                return null;
                        }
                        let entry: WebCacheEntry<T> | null = null;
                        try {
                                entry = JSON.parse(raw) as WebCacheEntry<T>;
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
                        writeEntryFile(entryPath(root, entry.key), JSON.stringify(full));
                        indexTrackPut(root, entry.key, full.bytes);
                        memoPut(root, entry.key, full);
                        maybeEvict(root);
                },
                undefined,
                () => webCacheLogEvent({ ts: Date.now(), kind: "bypass", tool: "engine", detail: "store write failed" }),
        );
}

/** Recency signal for the LRU: RAM-only (the Chromium SimpleCache rule —
 * `UseIfExists` updates recency in memory, never on disk). The file mtime
 * stays the write time and seeds `lastUsed` when the index is rebuilt; a
 * restart therefore degrades LRU to write-order, which for a TTL-bounded
 * cache is a benign approximation. This deliberately drops the old
 * per-hit utimes metadata write — the same write-amplification the Linux
 * kernel engineered `lazytime`/`relatime` to avoid, and hopeless to read
 * back on NTFS (1h access-time delay) or FAT (1-day resolution). */
export function webCacheTouch(key: string): void {
        if (!webCacheEnabled()) return;
        const root = webCacheRoot();
        if (storeIndex?.root !== root) return; // nothing tracked for this root yet
        const meta = storeIndex.entries.get(key);
        if (meta) meta.lastUsed = Date.now();
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

/** Freshness lookup for the happy path. Memo-first (a hot key skips the
 * disk read, the JSON parse and the sha256 re-verify entirely — cacache's
 * memoization design), then disk; a disk hit is memoized for next time.
 * Touches the RAM LRU on every hit. */
export function lookupFresh<T = any>(key: string, now = Date.now()): WebCacheHit<T> | null {
        const memoHit = memoLookupFresh<T>(key, now);
        if (memoHit) {
                webCacheTouch(key);
                return memoHit;
        }
        const entry = webCacheGet<T>(key);
        if (!entry) return null;
        if (!isFresh(entry, now)) return null;
        memoPut(webCacheRoot(), key, entry);
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
                        writeEntryFile(file, JSON.stringify(entry));
                        if (storeIndex?.root === root) {
                                const meta = storeIndex.entries.get(key);
                                if (meta) meta.lastUsed = now; // a revalidation is a use
                        }
                        memoRefresh(root, key, now, validators);
                },
                undefined,
        );
}

/** Stale-while-revalidate eligibility (RFC 5861): a stale entry inside its
 * stale-if-error window answers immediately — marked — while the caller
 * refreshes in the background. The SWR window is independently bound by
 * UNOWN_WEB_CACHE_SWR_MS (default: the entry's own window). */
export function eligibleForSwr(entry: WebCacheEntry, now = Date.now()): boolean {
        if (!swrEnabled()) return false;
        if (isFresh(entry, now)) return false;
        if (!withinStaleWindow(entry, now)) return false;
        return now - entry.storedAt < entry.ttlMs + Math.min(entry.staleIfErrorMs, swrWindowMs());
}

// ---------------------------------------------------------------------------
// In-memory index — {key -> bytes, lastUsed} so stats/eviction stop
// rescanning the disk (the Chromium SimpleCache model; count/size are
// approximate across processes and labeled so — WebKit ships the same
// trade with `m_approximateSize`).
// ---------------------------------------------------------------------------

interface StoreIndex {
        root: string;
        entries: Map<string, { bytes: number; lastUsed: number }>;
        totalBytes: number;
        builtAt: number;
}

let storeIndex: StoreIndex | null = null;

function buildIndex(root: string): StoreIndex {
        const scanned = failOpen(() => scanEntries(root), [] as EntryFileStat[]);
        const entries = new Map<string, { bytes: number; lastUsed: number }>();
        let totalBytes = 0;
        for (const e of scanned) {
                entries.set(e.key, { bytes: e.bytes, lastUsed: e.mtimeMs });
                totalBytes += e.bytes;
        }
        return { root, entries, totalBytes, builtAt: Date.now() };
}

/** The active index, rebuilt when absent, root-switched, or older than
 * UNOWN_WEB_CACHE_INDEX_MS (0 = the always-rescan exact mode). */
function indexFor(root: string): StoreIndex {
        const maxAge = webCacheIndexMaxAgeMs();
        const stale = !storeIndex || storeIndex.root !== root || (maxAge <= 0 ? true : Date.now() - storeIndex.builtAt > maxAge);
        if (stale) storeIndex = buildIndex(root);
        return storeIndex;
}

/** Track this process's writes into an existing index (never creates one —
 * a store nobody has listed yet stays unlisted until first need). */
function indexTrackPut(root: string, key: string, bytes: number): void {
        if (storeIndex?.root !== root) return;
        const prev = storeIndex.entries.get(key);
        if (prev) storeIndex.totalBytes -= prev.bytes;
        storeIndex.entries.set(key, { bytes, lastUsed: Date.now() });
        storeIndex.totalBytes += bytes;
}

function indexForget(root: string, keys: string[]): void {
        if (storeIndex?.root !== root) return;
        for (const key of keys) {
                const meta = storeIndex.entries.get(key);
                if (meta) {
                        storeIndex.totalBytes -= meta.bytes;
                        storeIndex.entries.delete(key);
                }
        }
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
// Eviction — byte-capped, LRU by RAM recency, opportunistic
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
 * Answers from the in-memory index (no per-entry stat storm — the baseline
 * measured 48ms of event-loop block per 20k-entry sweep); a root argument
 * (CLI sweeping a foreign store) builds a throwaway index for that root.
 * Returns what it evicted. */
export function webCacheSweep(rootArg?: string): { evicted: number; freedBytes: number; totalBytes: number } {
        const root = rootArg ?? webCacheRoot();
        const cap = webCacheMaxBytes();
        const foreign = rootArg !== undefined && storeIndex?.root !== rootArg;
        const idx = foreign ? buildIndex(root) : indexFor(root);
        const total = idx.totalBytes;
        if (!idx.entries.size || total <= cap) return { evicted: 0, freedBytes: 0, totalBytes: total };
        const target = Math.floor(cap * EVICT_TARGET_RATIO);
        const byLru = [...idx.entries.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
        let freed = 0;
        let evicted = 0;
        const evictedKeys: string[] = [];
        for (const [key, meta] of byLru) {
                if (total - freed <= target) break;
                if (failOpen(() => (rmSync(entryPath(root, key), { force: true }), true), false)) {
                        freed += meta.bytes;
                        evicted++;
                        evictedKeys.push(key);
                }
        }
        indexForget(root, evictedKeys);
        for (const key of evictedKeys) memoDelete(key);
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
        /** How entries/bytes were answered: "memory" = the in-process index
         * (O(1) between rebuilds, approximate across processes, ageMs old);
         * "scan" = UNOWN_WEB_CACHE_INDEX_MS=0 exact mode (a disk rescan
         * per call). Always stated so the dashboard/CLI never present an
         * approximation as a count. */
        index: { mode: "memory" | "scan"; ageMs: number; approximate: boolean };
        ttl: { searchMs: number; fetchMs: number; searchStaleMs: number; fetchStaleMs: number };
        totals: { hit: number; revalidated: number; miss: number; stale: number; bypass: number; evict: number; clear: number; error: number };
        savedRequests: number; // hits + revalidations that skipped a full upstream call
        byTool: Record<string, number>;
        byProvider: Record<string, number>;
        recentEvents: WebCacheEvent[];
}

/** Read only the tail of the events feed: stats needs the newest ≤500
 * events, and the feed rotates at 2 MiB / 10k lines, so a bounded tail
 * read (128 KiB ≫ 500 events × ~150 B) replaces reading the whole file
 * on every dashboard poll. */
const EVENTS_TAIL_BYTES = 128 * 1024;

function readEventsTailLines(file: string): string[] {
        let size: number;
        try {
                size = statSync(file).size;
        } catch {
                return []; // absent feed = no events yet
        }
        if (size === 0) return [];
        const start = Math.max(0, size - EVENTS_TAIL_BYTES);
        const fd = openSync(file, "r");
        try {
                const buf = Buffer.alloc(size - start);
                readSync(fd, buf, 0, buf.length, start);
                let text = buf.toString("utf8");
                if (start > 0) {
                        // the first line is likely cut mid-record — drop it
                        const nl = text.indexOf("\n");
                        text = nl >= 0 ? text.slice(nl + 1) : "";
                }
                return text.split("\n").filter((l) => l.trim());
        } finally {
                closeSync(fd);
        }
}

export function webCacheStats(): WebCacheStats {
        const enabled = webCacheEnabled();
        const root = webCacheRoot();
        const idx = indexFor(root);
        const lines = failOpen(() => readEventsTailLines(eventsPath(root)), [] as string[]);
        const events = lines.slice(-500).flatMap((line) => {
                try {
                        return [JSON.parse(line) as WebCacheEvent];
                } catch {
                        return [];
                }
        });
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
                entries: idx.entries.size,
                bytes: idx.totalBytes,
                maxBytes: webCacheMaxBytes(),
                index: {
                        mode: webCacheIndexMaxAgeMs() <= 0 ? "scan" : "memory",
                        ageMs: Date.now() - idx.builtAt,
                        approximate: webCacheIndexMaxAgeMs() > 0,
                },
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
        const entries = failOpen(() => scanEntries(root), [] as EntryFileStat[]); // exact: a user-invoked clear reports truth
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
        if (storeIndex?.root === root) storeIndex = null; // next stats rebuilds from the emptied disk
        memoClear(root);
        webCacheLogEvent({ ts: Date.now(), kind: "clear", tool: "engine", detail: `${removed} entries (${(bytes / 1024 / 1024).toFixed(1)} MiB)` });
        return { removed, bytes };
}

// ---------------------------------------------------------------------------
// Hot-entry memo — a bounded, TTL'd LRU of parsed entries (cacache's own
// answer to verify-on-read cost: its memo layer is 500 entries / 50 MiB /
// 3 min, and a memo hit "bypasses any filesystem checks for that key",
// including the integrity hash). A memoized answer still honors its own
// entry TTL, so it is never fresher than the disk contract; a body
// replaced by another process is at worst served until its own TTL or the
// memo clock lapses — the same freshness bound the disk path enforces.
// ---------------------------------------------------------------------------

const memo = new Map<string, { root: string; entry: WebCacheEntry; at: number }>();
let memoBytes = 0;

function memoEnabled(): boolean {
        return (process.env.UNOWN_WEB_CACHE_MEMO || "1") !== "0" && webCacheEnabled();
}
function memoMaxEntries(): number {
        return envNumber("UNOWN_WEB_CACHE_MEMO_ENTRIES", DEFAULT_MEMO_ENTRIES, { min: 1 });
}
function memoMaxBytes(): number {
        return envNumber("UNOWN_WEB_CACHE_MEMO_BYTES", DEFAULT_MEMO_BYTES, { min: 1024 });
}
function memoTtlMs(): number {
        return envNumber("UNOWN_WEB_CACHE_MEMO_MS", DEFAULT_MEMO_TTL_MS, { min: 1 });
}

function memoPut(root: string, key: string, entry: WebCacheEntry): void {
        if (!memoEnabled()) return;
        // The memo is single-root: switching cache dirs (tests, UNOWN_WEB_CACHE_DIR
        // flips) invalidates everything — content hashes are not unique across roots.
        if (memo.size > 0) {
                const anyRoot = memo.values().next().value!.root;
                if (anyRoot !== root) memoClear(anyRoot);
        }
        const bytes = entry.bytes || Buffer.byteLength(JSON.stringify(entry.payload));
        if (bytes > memoMaxBytes()) return; // one entry bigger than the whole budget: never memoize
        const prev = memo.get(key);
        if (prev) memoBytes -= prev.entry.bytes;
        memo.set(key, { root, entry, at: Date.now() });
        memoBytes += bytes;
        while (memo.size > memoMaxEntries() || memoBytes > memoMaxBytes()) {
                const oldest = memo.keys().next().value;
                if (oldest === undefined) break;
                memoBytes -= memo.get(oldest)!.entry.bytes;
                memo.delete(oldest);
        }
}

function memoLookupFresh<T = any>(key: string, now: number): WebCacheHit<T> | null {
        if (!memoEnabled()) return null;
        const m = memo.get(key);
        if (!m || m.root !== webCacheRoot()) return null;
        if (now - m.at >= memoTtlMs()) {
                memoBytes -= m.entry.bytes;
                memo.delete(key);
                return null;
        }
        if (!isFresh(m.entry, now)) return null; // honor the entry's own TTL
        memo.delete(key); // LRU bump: re-insert at the MRU end
        memo.set(key, m);
        return { value: m.entry.payload as T, entry: m.entry as WebCacheEntry<T>, provenance: "hit", ageMs: now - m.entry.storedAt };
}

function memoRefresh(root: string, key: string, now: number, validators?: WebCacheValidators): void {
        const m = memo.get(key);
        if (!m || m.root !== root) return;
        m.entry.storedAt = now;
        if (validators) m.entry.validators = validators;
        m.at = now;
}

function memoDelete(key: string): void {
        const m = memo.get(key);
        if (m) {
                memoBytes -= m.entry.bytes;
                memo.delete(key);
        }
}

function memoClear(root: string): void {
        if (memo.size > 0 && memo.values().next().value?.root === root) {
                memo.clear();
                memoBytes = 0;
        }
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

/** Test hook: drop the in-memory index + memo between tests (they are
 * per-process state that would otherwise leak across test cases that
 * switch UNOWN_WEB_CACHE_DIR). */
export function resetWebCacheInternals(): void {
        storeIndex = null;
        memo.clear();
        memoBytes = 0;
}
