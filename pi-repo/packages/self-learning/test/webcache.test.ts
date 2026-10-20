// Unit tests for src/webcache.ts — the web results store.
//
// Everything here is filesystem-scoped against a temp dir
// (UNOWN_WEB_CACHE_DIR), no network. Covers:
//   - key building: query/URL normalization, domain-filter + maxResults
//     key components, raw/text fetch key separation
//   - policy: freshness windows, stale-if-error windows, TTL env knobs
//   - store: put/get round-trip, integrity self-heal, shape-gate self-heal,
//     disabled-mode bypass (no dir created), clear + stats
//   - events: append + provider/tool aggregation, rotation at the line cap
//   - eviction: byte-capped LRU sweep (deterministic via a tiny cap)
//   - origin TTL parsing: Cache-Control max-age/s-maxage/no-store/no-cache,
//     Expires fallback, 24 h cap, heuristic default
//   - coalesce: concurrent identical calls run the producer once
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
        coalesce,
        computeFetchTtlMs,
        eligibleForSwr,
        fetchCacheKey,
        isFresh,
        lookupFresh,
        lookupStale,
        normalizeFetchUrl,
        normalizeSearchQuery,
        resetCoalesce,
        resetWebCacheInternals,
        searchCacheKey,
        webCacheClear,
        webCacheEnabled,
        webCacheGet,
        webCacheLogEvent,
        webCachePut,
        webCacheRoot,
        webCacheStats,
        webCacheSweep,
        withinStaleWindow,
        type WebCacheEntry,
} from "../src/webcache.ts";

// Env save/restore (the websearch.test.ts pattern) — these tests point the
// store at a temp dir and pin the TTL knobs so windows are deterministic.
const SAVED: Record<string, string | undefined> = {};
const PINNED: Array<[string, string]> = [
        ["UNOWN_WEB_CACHE", "1"],
        ["UNOWN_WEB_CACHE_DIR", ""],
        ["UNOWN_WEB_SEARCH_CACHE_TTL_MS", "1000"],
        ["UNOWN_WEBFETCH_CACHE_TTL_MS", "1000"],
        ["UNOWN_WEB_SEARCH_STALE_MS", "5000"],
        ["UNOWN_WEBFETCH_STALE_MS", "5000"],
        ["UNOWN_WEB_CACHE_MAX_BYTES", ""],
];
let tmpRoot = "";

beforeAll(() => {
        for (const [k, v] of PINNED) {
                SAVED[k] = process.env[k];
                if (v === "") delete process.env[k];
                else process.env[k] = v;
        }
        tmpRoot = mkdtempSync(join(tmpdir(), "unown-webcache-"));
        process.env.UNOWN_WEB_CACHE_DIR = tmpRoot;
});

afterAll(() => {
        for (const [k] of PINNED) {
                const saved = SAVED[k];
                if (saved === undefined) delete process.env[k];
                else process.env[k] = saved;
        }
        rmSync(tmpRoot, { recursive: true, force: true });
});

// The index + memo are per-process state; tests share one process, so every
// test starts from a clean slate (a test that pinned an old dir would
// otherwise answer from the memo of the previous test's root).
beforeEach(() => {
        resetWebCacheInternals();
});

/** Fresh entry fixture with a controllable clock. */
function putSearchEntry(key: string, storedAt: number, payload: any = { results: [], provider: "duckduckgo", attempted: [], query: "q" }): void {
        webCachePut({
                schema: 1,
                kind: "search",
                key,
                keyMaterial: "{}",
                payload,
                provider: "duckduckgo",
                storedAt,
                ttlMs: 1000,
                staleIfErrorMs: 5000,
        });
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

describe("normalizeSearchQuery", () => {
        test("trims, collapses whitespace, casefolds", () => {
                expect(normalizeSearchQuery("  What   is  Bun? ")).toBe("what is bun?");
        });

        test("empty stays empty", () => {
                expect(normalizeSearchQuery("   ")).toBe("");
        });
});

describe("normalizeFetchUrl", () => {
        test("strips the fragment", () => {
                expect(normalizeFetchUrl("https://example.com/a?b=1#section")).toBe("https://example.com/a?b=1");
        });

        test("strips default ports", () => {
                expect(normalizeFetchUrl("https://example.com:443/a")).toBe("https://example.com/a");
                expect(normalizeFetchUrl("http://example.com:80/a")).toBe("http://example.com/a");
        });

        test("keeps non-default ports and query order", () => {
                expect(normalizeFetchUrl("https://example.com:8443/a?x=1&y=2")).toBe("https://example.com:8443/a?x=1&y=2");
        });

        test("lowercases the host", () => {
                expect(normalizeFetchUrl("https://EXAMPLE.com/A")).toBe("https://example.com/A");
        });

        test("unparseable URLs pass through verbatim (no throw)", () => {
                expect(normalizeFetchUrl("not a url")).toBe("not a url");
        });
});

describe("searchCacheKey", () => {
        test("whitespace/case variants of the same query share a key", () => {
                expect(searchCacheKey("Bun  install").key).toBe(searchCacheKey("bun install").key);
        });

        test("maxResults is part of the key", () => {
                expect(searchCacheKey("q", { maxResults: 5 }).key).not.toBe(searchCacheKey("q", { maxResults: 10 }).key);
        });

        test("domain filters are part of the key (order-insensitive)", () => {
                const a = searchCacheKey("q", { allowedDomains: ["a.com", "b.com"] });
                const b = searchCacheKey("q", { allowedDomains: ["b.com", "a.com"] });
                expect(a.key).toBe(b.key);
                expect(searchCacheKey("q", { blockedDomains: ["x.com"] }).key).not.toBe(searchCacheKey("q").key);
        });

        test("carries the TTL knobs", () => {
                const k = searchCacheKey("q");
                expect(k.ttlMs).toBe(1000);
                expect(k.staleIfErrorMs).toBe(5000);
        });
});

describe("fetchCacheKey", () => {
        test("raw and text fetches never collide", () => {
                expect(fetchCacheKey("https://example.com", true).key).not.toBe(fetchCacheKey("https://example.com", false).key);
        });

        test("normalized variants share a key", () => {
                expect(fetchCacheKey(normalizeFetchUrl("https://EXAMPLE.com:443/a#frag"), false).key).toBe(
                        fetchCacheKey("https://example.com/a", false).key,
                );
        });
});

// ---------------------------------------------------------------------------
// Policy windows
// ---------------------------------------------------------------------------

describe("isFresh / withinStaleWindow", () => {
        const entry = { storedAt: 1_000_000, ttlMs: 1000, staleIfErrorMs: 5000 } as WebCacheEntry;

        test("fresh inside the TTL", () => {
                expect(isFresh(entry, 1_000_000 + 999)).toBe(true);
        });

        test("stale at/after the TTL", () => {
                expect(isFresh(entry, 1_000_000 + 1000)).toBe(false);
        });

        test("stale-if-error window covers ttl + stale", () => {
                expect(withinStaleWindow(entry, 1_000_000 + 5_999)).toBe(true);
                expect(withinStaleWindow(entry, 1_000_000 + 6000)).toBe(false);
        });

        test("TTL 0 means never fresh but still stale-servable", () => {
                const ttl0 = { ...entry, ttlMs: 0 };
                expect(isFresh(ttl0, entry.storedAt)).toBe(false);
                expect(withinStaleWindow(ttl0, entry.storedAt + 4999)).toBe(true);
        });
});

// ---------------------------------------------------------------------------
// Store: round-trip, integrity, self-heal, disabled mode
// ---------------------------------------------------------------------------

describe("webCachePut / webCacheGet", () => {
        test("round-trips a payload with computed integrity", () => {
                const { key } = searchCacheKey("round trip");
                putSearchEntry(key, Date.now(), { results: [{ url: "https://a", title: "A", snippet: "s" }], provider: "duckduckgo", attempted: [], query: "round trip" });
                const got = webCacheGet(key);
                expect(got).not.toBeNull();
                expect(got!.payload.results[0].url).toBe("https://a");
                expect(got!.bytes).toBeGreaterThan(0);
        });

        test("missing key → null", () => {
                expect(webCacheGet("deadbeef".repeat(8))).toBeNull();
        });

        test("tampered payload self-heals to a miss and logs an error event", () => {
                const { key } = searchCacheKey("tamper test");
                putSearchEntry(key, Date.now());
                const file = join(tmpRoot, "entries", key.slice(0, 2), `${key}.json`);
                const entry = JSON.parse(readFileSync(file, "utf8"));
                entry.payload.query = "tampered";
                writeFileSync(file, JSON.stringify(entry));
                expect(webCacheGet(key)).toBeNull();
                expect(existsSync(file)).toBe(false); // self-healed away
                const stats = webCacheStats();
                expect(stats.totals.error).toBeGreaterThan(0);
        });

        test("unknown schema version self-heals to a miss", () => {
                const { key } = searchCacheKey("future schema");
                putSearchEntry(key, Date.now());
                const file = join(tmpRoot, "entries", key.slice(0, 2), `${key}.json`);
                const entry = JSON.parse(readFileSync(file, "utf8"));
                entry.schema = 99;
                writeFileSync(file, JSON.stringify(entry));
                expect(webCacheGet(key)).toBeNull();
                expect(existsSync(file)).toBe(false);
        });

        test("corrupt JSON self-heals to a miss", () => {
                const { key } = searchCacheKey("corrupt json");
                putSearchEntry(key, Date.now());
                const file = join(tmpRoot, "entries", key.slice(0, 2), `${key}.json`);
                writeFileSync(file, "{not json");
                expect(webCacheGet(key)).toBeNull();
                expect(existsSync(file)).toBe(false);
        });
});

describe("disabled mode (UNOWN_WEB_CACHE=0)", () => {
        test("get/put/log are no-ops and no dir is created", () => {
                const fresh = mkdtempSync(join(tmpdir(), "unown-webcache-disabled-"));
                process.env.UNOWN_WEB_CACHE_DIR = fresh;
                process.env.UNOWN_WEB_CACHE = "0";
                expect(webCacheEnabled()).toBe(false);
                const { key } = searchCacheKey("disabled test");
                putSearchEntry(key, Date.now());
                expect(webCacheGet(key)).toBeNull();
                expect(existsSync(join(fresh, "entries"))).toBe(false);
                process.env.UNOWN_WEB_CACHE = "1";
                rmSync(fresh, { recursive: true, force: true });
                process.env.UNOWN_WEB_CACHE_DIR = tmpRoot;
        });
});

// ---------------------------------------------------------------------------
// lookupFresh / lookupStale
// ---------------------------------------------------------------------------

describe("lookupFresh / lookupStale", () => {
        test("fresh hit returns payload + provenance", () => {
                const { key } = searchCacheKey("fresh hit");
                putSearchEntry(key, Date.now() - 100);
                const hit = lookupFresh(key);
                expect(hit).not.toBeNull();
                expect(hit!.provenance).toBe("hit");
                expect(hit!.ageMs).toBeGreaterThanOrEqual(100);
        });

        test("expired entry is not fresh but is stale-servable", () => {
                const { key } = searchCacheKey("stale hit");
                putSearchEntry(key, Date.now() - 2000); // TTL 1000 expired, stale window 5000 still open
                expect(lookupFresh(key)).toBeNull();
                const stale = lookupStale(key);
                expect(stale).not.toBeNull();
                expect(stale!.provenance).toBe("stale");
        });

        test("beyond the stale window there is nothing to serve", () => {
                const { key } = searchCacheKey("too old");
                putSearchEntry(key, Date.now() - 10_000);
                expect(lookupFresh(key)).toBeNull();
                expect(lookupStale(key)).toBeNull();
        });
});

// ---------------------------------------------------------------------------
// Events + stats
// ---------------------------------------------------------------------------

describe("events + stats aggregation", () => {
        test("events aggregate into totals, byTool and byProvider", () => {
                webCacheLogEvent({ ts: Date.now(), kind: "hit", tool: "web_search", provider: "duckduckgo", detail: "bun install", ageMs: 100 });
                webCacheLogEvent({ ts: Date.now(), kind: "hit", tool: "web_search", provider: "duckduckgo" });
                webCacheLogEvent({ ts: Date.now(), kind: "miss", tool: "webfetch", provider: "direct" });
                const stats = webCacheStats();
                expect(stats.byProvider["duckduckgo"]).toBeGreaterThanOrEqual(2);
                expect(stats.byProvider["direct"]).toBeGreaterThanOrEqual(1);
                expect(stats.byTool["web_search"]).toBeGreaterThanOrEqual(2);
                expect(stats.totals.hit).toBeGreaterThanOrEqual(2);
                expect(stats.enabled).toBe(true);
                expect(stats.root).toBe(tmpRoot);
                expect(stats.recentEvents.length).toBeGreaterThan(0);
        });

        test("recent events are newest-first", () => {
                webCacheLogEvent({ ts: Date.now() + 123_456, kind: "bypass", tool: "engine", detail: "marker-event" });
                const stats = webCacheStats();
                expect(stats.recentEvents[0].detail).toBe("marker-event");
        });
});

// ---------------------------------------------------------------------------
// Eviction
// ---------------------------------------------------------------------------

describe("eviction — byte-capped LRU sweep", () => {
        test("oldest entries are evicted down to the cap (deterministic sweep)", () => {
                const fresh = mkdtempSync(join(tmpdir(), "unown-webcache-evict-"));
                process.env.UNOWN_WEB_CACHE_DIR = fresh;
                process.env.UNOWN_WEB_CACHE_MAX_BYTES = "4096"; // tiny cap
                // Exact mode: the sweep honors mtimes crafted below, not a RAM
                // index seeded at put time (the memory index is the default; the
                // deterministic test opts into the documented always-scan mode).
                process.env.UNOWN_WEB_CACHE_INDEX_MS = "0";
                try {
                        // Three ~2 KB entries (~6 KB total > 4096 cap). Distinct,
                        // spaced mtimes decide LRU order deterministically even on
                        // 1 s-granularity filesystems.
                        const base = Date.now() / 1000 - 3600;
                        const keys: string[] = [];
                        for (const [i, ageSec] of [3000, 2000, 1000].entries()) {
                                const { key } = searchCacheKey(`evict probe ${i} ${Math.random()}`);
                                putSearchEntry(key, Date.now(), { big: "x".repeat(2048) });
                                const file = join(fresh, "entries", key.slice(0, 2), `${key}.json`);
                                const stamp = new Date((base - ageSec) * 1000);
                                utimesSync(file, stamp, stamp);
                                keys.push(key);
                        }
                        // The write-path sweep is probabilistic (1/8 per put), so probes
                        // may already have been evicted before the deterministic sweep —
                        // assert the invariants that hold regardless of which sweep ran:
                        // the cap is respected, the oldest probe is gone, the newest
                        // survives, and at least one evict event was recorded.
                        webCacheSweep();
                        const stats = webCacheStats();
                        expect(stats.bytes).toBeLessThanOrEqual(Math.floor(4096 * 0.9));
                        // The 3000 s-old probe must be gone; the 1000 s-old one survives.
                        expect(webCacheGet(keys[0])).toBeNull();
                        expect(webCacheGet(keys[2])).not.toBeNull();
                        expect(stats.totals.evict).toBeGreaterThanOrEqual(1);
                } finally {
                        delete process.env.UNOWN_WEB_CACHE_MAX_BYTES;
                        delete process.env.UNOWN_WEB_CACHE_INDEX_MS;
                        process.env.UNOWN_WEB_CACHE_DIR = tmpRoot;
                        rmSync(fresh, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe("webCacheClear", () => {
        test("removes entries + shard dirs and reports counts", () => {
                const fresh = mkdtempSync(join(tmpdir(), "unown-webcache-clear-"));
                process.env.UNOWN_WEB_CACHE_DIR = fresh;
                try {
                        for (let i = 0; i < 3; i++) {
                                const { key } = searchCacheKey(`clear probe ${i} ${Math.random()}`);
                                putSearchEntry(key, Date.now());
                        }
                        const before = webCacheStats();
                        expect(before.entries).toBe(3);
                        const result = webCacheClear();
                        expect(result.removed).toBe(3);
                        expect(result.bytes).toBeGreaterThan(0);
                        const after = webCacheStats();
                        expect(after.entries).toBe(0);
                        expect(after.totals.clear).toBeGreaterThanOrEqual(1);
                } finally {
                        process.env.UNOWN_WEB_CACHE_DIR = tmpRoot;
                        rmSync(fresh, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// Origin TTL parsing (RFC 9111)
// ---------------------------------------------------------------------------

describe("computeFetchTtlMs", () => {
        const now = 1_000_000_000;

        test("max-age is honored", () => {
                expect(computeFetchTtlMs("max-age=120", undefined, now)).toBe(120_000);
        });

        test("s-maxage beats max-age", () => {
                expect(computeFetchTtlMs("max-age=10, s-maxage=300", undefined, now)).toBe(300_000);
        });

        test("no-store means not storable", () => {
                expect(computeFetchTtlMs("no-store", undefined, now)).toBe(0);
        });

        test("no-cache means not storable", () => {
                expect(computeFetchTtlMs("no-cache", undefined, now)).toBe(0);
        });

        test("origin TTL is capped at 24 h", () => {
                expect(computeFetchTtlMs("max-age=604800", undefined, now)).toBe(24 * 60 * 60_000);
        });

        test("Expires in the future is honored (and capped)", () => {
                expect(computeFetchTtlMs(null, now + 30_000, now)).toBe(30_000);
                expect(computeFetchTtlMs(null, now + 10 * 24 * 60 * 60_000, now)).toBe(24 * 60 * 60_000);
        });

        test("expired Expires / nothing sent → heuristic default", () => {
                expect(computeFetchTtlMs(null, now - 1000, now)).toBe(1000); // pinned UNOWN_WEBFETCH_CACHE_TTL_MS
                expect(computeFetchTtlMs("public", undefined, now)).toBe(1000);
        });
});

// ---------------------------------------------------------------------------
// Single-flight
// ---------------------------------------------------------------------------

describe("coalesce", () => {
        test("concurrent identical calls run the producer once", async () => {
                resetCoalesce();
                let runs = 0;
                const producer = async () => {
                        runs++;
                        await new Promise((r) => setTimeout(r, 25));
                        return { value: runs };
                };
                const results = await Promise.all([coalesce("k1", producer), coalesce("k1", producer), coalesce("k1", producer)]);
                expect(runs).toBe(1);
                expect(results.map((r) => r.value)).toEqual([1, 1, 1]);
        });

        test("different keys run independently", async () => {
                resetCoalesce();
                let runs = 0;
                const producer = async () => {
                        runs++;
                        return runs;
                };
                await Promise.all([coalesce("a", producer), coalesce("b", producer)]);
                expect(runs).toBe(2);
        });

        test("a failed producer releases the slot for a retry", async () => {
                resetCoalesce();
                let attempts = 0;
                const failer = async () => {
                        attempts++;
                        if (attempts === 1) throw new Error("transient");
                        return "ok";
                };
                await expect(coalesce("f", failer)).rejects.toThrow("transient");
                await expect(coalesce("f", failer)).resolves.toBe("ok");
                expect(attempts).toBe(2);
        });
});

// ---------------------------------------------------------------------------
// Env knob semantics (the `||` convention: empty string means unset)
// ---------------------------------------------------------------------------

describe("env knob parsing", () => {
        test("unset knobs fall back to defaults — never Number('') === 0", () => {
                const savedTtl = process.env.UNOWN_WEB_SEARCH_CACHE_TTL_MS;
                const savedBytes = process.env.UNOWN_WEB_CACHE_MAX_BYTES;
                delete process.env.UNOWN_WEB_SEARCH_CACHE_TTL_MS;
                delete process.env.UNOWN_WEB_CACHE_MAX_BYTES;
                try {
                        // Regression guard: Number("") === 0 silently turned the default
                        // TTL into 0 and the byte cap into the 1024 floor.
                        const { ttlMs } = searchCacheKey("env defaults");
                        expect(ttlMs).toBe(60 * 60_000);
                        const stats = webCacheStats();
                        expect(stats.maxBytes).toBe(256 * 1024 * 1024);
                        expect(stats.ttl.searchMs).toBe(60 * 60_000);
                } finally {
                        if (savedTtl === undefined) delete process.env.UNOWN_WEB_SEARCH_CACHE_TTL_MS;
                        else process.env.UNOWN_WEB_SEARCH_CACHE_TTL_MS = savedTtl;
                        if (savedBytes === undefined) delete process.env.UNOWN_WEB_CACHE_MAX_BYTES;
                        else process.env.UNOWN_WEB_CACHE_MAX_BYTES = savedBytes;
                }
        });

        test("explicit 0 stays a legal TTL (always revalidate)", () => {
                const saved = process.env.UNOWN_WEB_SEARCH_CACHE_TTL_MS;
                process.env.UNOWN_WEB_SEARCH_CACHE_TTL_MS = "0";
                try {
                        expect(searchCacheKey("ttl zero").ttlMs).toBe(0);
                } finally {
                        if (saved === undefined) delete process.env.UNOWN_WEB_SEARCH_CACHE_TTL_MS;
                        else process.env.UNOWN_WEB_SEARCH_CACHE_TTL_MS = saved;
                }
        });

        test("garbage values fall back to defaults", () => {
                const saved = process.env.UNOWN_WEB_SEARCH_CACHE_TTL_MS;
                process.env.UNOWN_WEB_SEARCH_CACHE_TTL_MS = "not-a-number";
                try {
                        expect(searchCacheKey("garbage").ttlMs).toBe(60 * 60_000);
                } finally {
                        if (saved === undefined) delete process.env.UNOWN_WEB_SEARCH_CACHE_TTL_MS;
                        else process.env.UNOWN_WEB_SEARCH_CACHE_TTL_MS = saved;
                }
        });
});

// ---------------------------------------------------------------------------
// Root resolution
// ---------------------------------------------------------------------------

describe("webCacheRoot", () => {
        test("UNOWN_WEB_CACHE_DIR wins", () => {
                expect(webCacheRoot()).toBe(tmpRoot);
        });

        test("falls back to UNOWN_HOME/cache/web, then ~/.unown/cache/web", () => {
                const savedDir = process.env.UNOWN_WEB_CACHE_DIR;
                const savedHome = process.env.UNOWN_HOME;
                delete process.env.UNOWN_WEB_CACHE_DIR;
                process.env.UNOWN_HOME = "/tmp/unown-home-probe";
                expect(webCacheRoot()).toBe(join("/tmp/unown-home-probe", "cache", "web"));
                delete process.env.UNOWN_HOME;
                expect(webCacheRoot()).toBe(join(homedir(), ".unown", "cache", "web"));
                process.env.UNOWN_HOME = savedHome;
                if (savedDir === undefined) delete process.env.UNOWN_WEB_CACHE_DIR;
                else process.env.UNOWN_WEB_CACHE_DIR = savedDir;
        });
});

// ---------------------------------------------------------------------------
// In-memory index — stats/eviction answer from RAM (the perf layer)
// ---------------------------------------------------------------------------

describe("in-memory index", () => {
        test("stats answers from the index and tracks puts without rescanning", () => {
                const fresh = mkdtempSync(join(tmpdir(), "unown-webcache-idx-"));
                process.env.UNOWN_WEB_CACHE_DIR = fresh;
                try {
                        putSearchEntry(searchCacheKey("index probe a").key, Date.now());
                        putSearchEntry(searchCacheKey("index probe b").key, Date.now());
                        const first = webCacheStats(); // builds the index
                        expect(first.entries).toBe(2);
                        expect(first.bytes).toBeGreaterThan(0);
                        expect(first.index.mode).toBe("memory");
                        expect(first.index.approximate).toBe(true);
                        // A put AFTER the index exists is tracked in RAM — the next
                        // stats call sees 3 without a rescan (ageMs stays tiny).
                        putSearchEntry(searchCacheKey("index probe c").key, Date.now());
                        const second = webCacheStats();
                        expect(second.entries).toBe(3);
                        expect(second.index.ageMs).toBeLessThan(60_000);
                } finally {
                        process.env.UNOWN_WEB_CACHE_DIR = tmpRoot;
                        rmSync(fresh, { recursive: true, force: true });
                }
        });

        test("exact mode (UNOWN_WEB_CACHE_INDEX_MS=0) rescans per call", () => {
                const fresh = mkdtempSync(join(tmpdir(), "unown-webcache-idxexact-"));
                const saved = process.env.UNOWN_WEB_CACHE_INDEX_MS;
                process.env.UNOWN_WEB_CACHE_DIR = fresh;
                process.env.UNOWN_WEB_CACHE_INDEX_MS = "0";
                try {
                        putSearchEntry(searchCacheKey("exact mode probe").key, Date.now());
                        const stats = webCacheStats();
                        expect(stats.entries).toBe(1);
                        expect(stats.index.mode).toBe("scan");
                        expect(stats.index.approximate).toBe(false);
                } finally {
                        if (saved === undefined) delete process.env.UNOWN_WEB_CACHE_INDEX_MS;
                        else process.env.UNOWN_WEB_CACHE_INDEX_MS = saved;
                        process.env.UNOWN_WEB_CACHE_DIR = tmpRoot;
                        rmSync(fresh, { recursive: true, force: true });
                }
        });

        test("clear drops the index: the next stats rebuilds from the emptied disk", () => {
                const fresh = mkdtempSync(join(tmpdir(), "unown-webcache-idxclear-"));
                process.env.UNOWN_WEB_CACHE_DIR = fresh;
                try {
                        putSearchEntry(searchCacheKey("clear index probe").key, Date.now());
                        expect(webCacheStats().entries).toBe(1);
                        webCacheClear();
                        expect(webCacheStats().entries).toBe(0);
                } finally {
                        process.env.UNOWN_WEB_CACHE_DIR = tmpRoot;
                        rmSync(fresh, { recursive: true, force: true });
                }
        });

        test("sweep evicts via the RAM index and forgets evicted keys", () => {
                const fresh = mkdtempSync(join(tmpdir(), "unown-webcache-idxsweep-"));
                process.env.UNOWN_WEB_CACHE_DIR = fresh;
                try {
                        // Two ~2 KB entries under a 3 KB cap → the sweep must evict.
                        putSearchEntry(searchCacheKey("idx sweep a").key, Date.now(), { big: "x".repeat(2048) });
                        putSearchEntry(searchCacheKey("idx sweep b").key, Date.now(), { big: "y".repeat(2048) });
                        const built = webCacheStats(); // index now exists and tracks this root
                        expect(built.entries).toBe(2);
                        process.env.UNOWN_WEB_CACHE_MAX_BYTES = "3072";
                        const result = webCacheSweep();
                        delete process.env.UNOWN_WEB_CACHE_MAX_BYTES;
                        expect(result.evicted).toBeGreaterThanOrEqual(1);
                        expect(webCacheStats().entries).toBe(2 - result.evicted);
                } finally {
                        delete process.env.UNOWN_WEB_CACHE_MAX_BYTES;
                        process.env.UNOWN_WEB_CACHE_DIR = tmpRoot;
                        rmSync(fresh, { recursive: true, force: true });
                }
        });

        test("memo is root-scoped: switching cache dirs never serves the other root", () => {
                const { key } = searchCacheKey("root swap probe");
                putSearchEntry(key, Date.now());
                expect(lookupFresh(key)).not.toBeNull(); // memoized under tmpRoot
                const other = mkdtempSync(join(tmpdir(), "unown-webcache-rootswap-"));
                process.env.UNOWN_WEB_CACHE_DIR = other;
                try {
                        expect(lookupFresh(key)).toBeNull(); // different root: no memo, no disk entry
                } finally {
                        process.env.UNOWN_WEB_CACHE_DIR = tmpRoot;
                        rmSync(other, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// Hot-entry memo — hot keys skip disk + parse + sha256 (cacache's memo layer)
// ---------------------------------------------------------------------------

describe("hot-entry memo", () => {
        test("a hot key answers from the memo even when the disk file is corrupted after memoization", () => {
                const { key } = searchCacheKey("memo probe");
                putSearchEntry(key, Date.now(), { results: [{ url: "https://memo.example", title: "t", content: "c" }], provider: "duckduckgo", attempted: [], query: "memo probe" });
                expect(lookupFresh(key)?.value.results[0]?.url).toBe("https://memo.example"); // disk hit → memoized
                // Corrupt the on-disk file: the memoized entry must still serve
                // (this is the memo's entire value proposition — zero fs work).
                const file = join(tmpRoot, "entries", key.slice(0, 2), `${key}.json`);
                writeFileSync(file, "{corrupt", "utf8");
                const memoHit = lookupFresh(key);
                expect(memoHit?.provenance).toBe("hit");
                expect(memoHit?.value.results[0]?.url).toBe("https://memo.example");
                // UNOWN_WEB_CACHE_MEMO=0: the disk corruption is now visible —
                // the raw get self-heals to a miss.
                const saved = process.env.UNOWN_WEB_CACHE_MEMO;
                process.env.UNOWN_WEB_CACHE_MEMO = "0";
                try {
                        expect(lookupFresh(key)).toBeNull();
                        expect(webCacheGet(key)).toBeNull();
                        expect(existsSync(file)).toBe(false); // self-healed (deleted)
                } finally {
                        if (saved === undefined) delete process.env.UNOWN_WEB_CACHE_MEMO;
                        else process.env.UNOWN_WEB_CACHE_MEMO = saved;
                }
        });

        test("the memo honors the entry's own TTL (never fresher than the disk contract)", () => {
                const { key } = searchCacheKey("memo ttl probe");
                const t0 = Date.now();
                putSearchEntry(key, t0); // TTL 1000 (pinned), stale window 5000
                expect(lookupFresh(key, t0 + 500)).not.toBeNull(); // memoized + fresh
                expect(lookupFresh(key, t0 + 1500)).toBeNull(); // memo honors TTL → disk not fresh either
        });

        test("memo clock expiry falls back to the disk (UNOWN_WEB_CACHE_MEMO_MS)", () => {
                const { key } = searchCacheKey("memo clock probe");
                putSearchEntry(key, Date.now());
                expect(lookupFresh(key)).not.toBeNull(); // memoized
                const saved = process.env.UNOWN_WEB_CACHE_MEMO_MS;
                process.env.UNOWN_WEB_CACHE_MEMO_MS = "1"; // 1 ms memo clock
                try {
                        const before = Date.now();
                        while (Date.now() - before < 5) {} // let the clock lapse
                        // Memo expired → disk path re-verifies and re-memoizes.
                        expect(lookupFresh(key)?.provenance).toBe("hit");
                } finally {
                        if (saved === undefined) delete process.env.UNOWN_WEB_CACHE_MEMO_MS;
                        else process.env.UNOWN_WEB_CACHE_MEMO_MS = saved;
                }
        });

        test("entry cap: the oldest memoized key falls out first", () => {
                const saved = process.env.UNOWN_WEB_CACHE_MEMO_ENTRIES;
                process.env.UNOWN_WEB_CACHE_MEMO_ENTRIES = "2";
                try {
                        const k1 = searchCacheKey("memo cap 1").key;
                        const k2 = searchCacheKey("memo cap 2").key;
                        const k3 = searchCacheKey("memo cap 3").key;
                        putSearchEntry(k1, Date.now());
                        putSearchEntry(k2, Date.now());
                        putSearchEntry(k3, Date.now()); // evicts k1 from the memo
                        expect(lookupFresh(k1)?.provenance).toBe("hit"); // disk hit, re-memoized (evicts k2)
                        // Corrupt k2's file: it must NOT be memoized anymore.
                        writeFileSync(join(tmpRoot, "entries", k2.slice(0, 2), `${k2}.json`), "{corrupt", "utf8");
                        expect(lookupFresh(k2)).toBeNull();
                } finally {
                        if (saved === undefined) delete process.env.UNOWN_WEB_CACHE_MEMO_ENTRIES;
                        else process.env.UNOWN_WEB_CACHE_MEMO_ENTRIES = saved;
                }
        });
});

// ---------------------------------------------------------------------------
// Stale-while-revalidate policy (RFC 5861 eligibility)
// ---------------------------------------------------------------------------

describe("eligibleForSwr", () => {
        const entry = (ageMs: number, ttlMs = 1000, staleIfErrorMs = 5000): WebCacheEntry =>
                ({ schema: 1, kind: "search", key: "k", keyMaterial: "{}", payload: {}, provider: "t", storedAt: Date.now() - ageMs, ttlMs, staleIfErrorMs, payloadSha256: "x", bytes: 1 }) as WebCacheEntry;

        test("fresh entries are not SWR-eligible (they are plain hits)", () => {
                expect(eligibleForSwr(entry(500))).toBe(false);
        });

        test("stale-but-within-window entries are eligible", () => {
                expect(eligibleForSwr(entry(2000))).toBe(true);
        });

        test("beyond the stale window there is nothing to serve", () => {
                expect(eligibleForSwr(entry(10_000))).toBe(false);
        });

        test("UNOWN_WEB_CACHE_SWR=0 disables eligibility", () => {
                const saved = process.env.UNOWN_WEB_CACHE_SWR;
                process.env.UNOWN_WEB_CACHE_SWR = "0";
                try {
                        expect(eligibleForSwr(entry(2000))).toBe(false);
                } finally {
                        if (saved === undefined) delete process.env.UNOWN_WEB_CACHE_SWR;
                        else process.env.UNOWN_WEB_CACHE_SWR = saved;
                }
        });

        test("UNOWN_WEB_CACHE_SWR_MS bounds the window below the stale window", () => {
                const saved = process.env.UNOWN_WEB_CACHE_SWR_MS;
                process.env.UNOWN_WEB_CACHE_SWR_MS = "2500"; // TTL 1000 + SWR 2500 → eligible until 3500ms old
                try {
                        expect(eligibleForSwr(entry(2000))).toBe(true); // 2000 < 3500
                        expect(eligibleForSwr(entry(4000))).toBe(false); // beyond the SWR bound, though still in the 6000 stale window
                } finally {
                        if (saved === undefined) delete process.env.UNOWN_WEB_CACHE_SWR_MS;
                        else process.env.UNOWN_WEB_CACHE_SWR_MS = saved;
                }
        });
});

// ---------------------------------------------------------------------------
// Cache-write durability (the cacache tmp+rename default, fsync opt-in)
// ---------------------------------------------------------------------------

describe("write durability", () => {
        test("default writes leave no .tmp orphans and round-trip", () => {
                const { key } = searchCacheKey("durability default probe");
                putSearchEntry(key, Date.now());
                expect(webCacheGet(key)).not.toBeNull();
                const shard = join(tmpRoot, "entries", key.slice(0, 2));
                const files = readdirSync(shard).filter((f) => f.includes(".tmp-"));
                expect(files).toHaveLength(0); // rename consumed the temp file
        });

        test("UNOWN_WEB_CACHE_DURABLE=1 (atomicWriteFileSync path) round-trips too", () => {
                const saved = process.env.UNOWN_WEB_CACHE_DURABLE;
                process.env.UNOWN_WEB_CACHE_DURABLE = "1";
                try {
                        const { key } = searchCacheKey("durability on probe");
                        putSearchEntry(key, Date.now());
                        expect(webCacheGet(key)).not.toBeNull();
                        const shard = join(tmpRoot, "entries", key.slice(0, 2));
                        expect(readdirSync(shard).filter((f) => f.includes(".tmp-"))).toHaveLength(0);
                } finally {
                        if (saved === undefined) delete process.env.UNOWN_WEB_CACHE_DURABLE;
                        else process.env.UNOWN_WEB_CACHE_DURABLE = saved;
                }
        });
});

// ---------------------------------------------------------------------------
// Events tail read — stats reads the newest slice, not the whole feed
// ---------------------------------------------------------------------------

describe("events tail read", () => {
        test("recentEvents carries the newest events past the 128 KiB tail bound", () => {
                // ~600 B per event × 400 events ≈ 240 KiB > the 128 KiB tail.
                const bigDetail = "x".repeat(600);
                for (let i = 0; i < 400; i++) {
                        webCacheLogEvent({ ts: Date.now(), kind: "hit", tool: "web_search", provider: "searxng", detail: `tail probe ${i} ${bigDetail}` });
                }
                webCacheLogEvent({ ts: Date.now(), kind: "miss", tool: "web_search", provider: "searxng", detail: "THE NEWEST EVENT" });
                const stats = webCacheStats();
                expect(stats.recentEvents.length).toBeGreaterThan(0);
                expect(stats.recentEvents[0]?.detail).toBe("THE NEWEST EVENT"); // newest first
                expect(stats.recentEvents.length).toBeLessThanOrEqual(50); // capped by the engine
        });
});
