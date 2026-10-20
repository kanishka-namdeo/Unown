#!/usr/bin/env bun
// webcache-bench.mjs — performance benchmark harness for unown's web results
// store (pi-repo/packages/self-learning/src/webcache.ts).
//
// Measures the store the way production uses it — through its public API and
// (for the end-to-end scenario) through the real runWebSearch/fetchPageContent
// call paths against local mock providers — and writes a JSON receipt under
// benchmarks/webcache/results/.
//
// Usage:
//   bun scripts/webcache-bench.mjs                     # full suite
//   bun scripts/webcache-bench.mjs --quick             # reduced sample counts
//   bun scripts/webcache-bench.mjs --only e2e,coalesce # scenario subset
//   bun scripts/webcache-bench.mjs --label after       # receipt suffix
//   bun scripts/webcache-bench.mjs --out <path>        # custom receipt path
//
// Methodology (see benchmarks/webcache/README.md for the full rationale):
//   - percentiles, never just means: p50/p95/p99/max per latency cell
//     (the tail is the story — RocksDB db_bench reports p50/p95/p99/p99.9;
//     means hide the sweep hiccups this harness exists to expose)
//   - warmup discarded (first 20% of samples) — JIT/page-cache warmup is
//     measurement noise, not signal
//   - every latency number is WARM page cache (drop_caches needs root; the
//     receipt says so; cold numbers are strictly worse)
//   - provider-call COUNTING for coalescing/e2e (counting origin hits, not
//     just wall time — the coordinated-omission-safe way to measure request
//     collapsing: the origin counter cannot lie about herd size)
//   - zipf s=1.0 key distribution for the workload-realism scenario (the
//     standard web-workload shape)
//   - assertions ship inside the receipt and gate the exit code, so CI can
//     run the harness as a correctness+perf check in one pass
//
// Population note: bulk store population writes entry files DIRECTLY in the
// module's exact on-disk format (same sha256 payload checksum, same two-pass
// bytes accounting, same atomic rename) instead of calling webCachePut —
// webCachePut's amortized-eviction fires a full directory scan on ~1/8 of
// writes, which would turn a 20k-entry population into an O(N^2) minute-scale
// wait. The measured put cells still go through the real webCachePut.

import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir, cpus } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const SELF_LEARNING = join(repoRoot, "pi-repo/packages/self-learning/src");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const QUICK = argv.includes("--quick");
const LABEL = argv.includes("--label") ? argv[argv.indexOf("--label") + 1] : "";
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : null;
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1].split(",").map((s) => s.trim()) : null;

// Sample-count scale: quick mode is for smoke/CI; full mode is for receipts.
const SCALE = QUICK ? 0.2 : 1;
const N_PRIM = Math.max(60, Math.floor(2000 * SCALE)); // primitives per cell
const N_SCAN_POINTS = [1000, 5000, 20000];
const ZIPF_KEYS = QUICK ? 200 : 1000;
const ZIPF_REQS = QUICK ? 1200 : 6000;

// ---------------------------------------------------------------------------
// The store under test. webCacheRoot re-reads env at call time, so each
// scenario re-points UNOWN_WEB_CACHE_DIR at its own temp store.
// ---------------------------------------------------------------------------
process.env.UNOWN_WEB_CACHE_DIR = mkdtempSync(join(tmpdir(), "webcache-bench-"));
const webcache = await import(join(SELF_LEARNING, "webcache.ts"));
const websearch = await import(join(SELF_LEARNING, "websearch.ts"));
const { atomicWriteFileSync } = await import(join(SELF_LEARNING, "atomic.ts"));

const {
        webCacheGet,
        webCachePut,
        webCacheStats,
        webCacheSweep,
        webCacheTouch,
        webCacheRefresh,
        webCacheLogEvent,
        searchCacheKey,
        lookupFresh,
        resetWebCacheInternals,
} = webcache;

// ---------------------------------------------------------------------------
// Receipt scaffolding
// ---------------------------------------------------------------------------
const receipt = {
        ts: new Date().toISOString(),
        meta: {
                runtime: process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`,
                nodeCompat: process.versions.node,
                platform: `${process.platform} ${process.arch}`,
                cpus: cpus().length,
                sampleScale: QUICK ? "quick (0.2x)" : "full",
                cacheNote: "all latency numbers are WARM OS page cache (drop_caches needs root; cold is strictly worse)",
                gitCommit: gitSha(),
        },
        scenarios: {},
        asserts: {},
};

function gitSha() {
        try {
                return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
        } catch {
                return "unknown";
        }
}

/** assert(name, expectedLabel, actualValue, passBool) — recorded + exit-gating. */
function assert(name, expected, actual, pass) {
        receipt.asserts[name] = { expected, actual, pass };
        if (!pass) receipt.asserts[name].note = "ASSERTION FAILED";
}

/** Percentile of an ascending-sorted array. */
function pct(sorted, p) {
        if (!sorted.length) return null;
        const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
        return sorted[Math.max(0, idx)];
}

/** Time fn() N times: first 20% discarded as warmup, rest reported. */
function bench(n, fn) {
        const all = [];
        for (let i = 0; i < n; i++) {
                const t0 = performance.now();
                fn();
                all.push(performance.now() - t0);
        }
        const kept = all.slice(Math.floor(all.length * 0.2));
        const sorted = [...kept].sort((a, b) => a - b);
        return {
                n: kept.length,
                p50: +pct(sorted, 50).toFixed(3),
                p95: +pct(sorted, 95).toFixed(3),
                p99: +pct(sorted, 99).toFixed(3),
                mean: +(kept.reduce((a, b) => a + b, 0) / kept.length).toFixed(3),
                max: +sorted[sorted.length - 1].toFixed(3),
                unit: "ms",
                raw: kept.map((v) => +v.toFixed(3)),
        };
}

function newCacheDir(scenario) {
        const dir = mkdtempSync(join(tmpdir(), `webcache-bench-${scenario}-`));
        process.env.UNOWN_WEB_CACHE_DIR = dir;
        return dir;
}
function dropCacheDir(dir) {
        process.env.UNOWN_WEB_CACHE_DIR = "";
        rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Synthetic payloads — realistic shapes/sizes (not lorem ipsum noise)
// ---------------------------------------------------------------------------
const WORDS = "bun runtime typescript cache latency percentile shard eviction revalidation provenance stale fresh provider cascade search engine results page fetch html markdown etag validators sweep coalesce thundering herd zipfian workload".split(" ");
const AVG_WORD = 7; // measured average of WORDS — size the buffer, join ONCE
/** Deterministic filler at an exact length — linear (a join-per-iteration
 * shape here was the harness's own 330ms/payload bug, not the store's). */
function loremish(len) {
        const n = Math.ceil(len / AVG_WORD) + 8;
        let seed = 42;
        const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        const parts = [];
        for (let i = 0; i < n; i++) parts.push(WORDS[Math.floor(rnd() * WORDS.length)]);
        return parts.join(" ").slice(0, len);
}

/** A realistic WebSearchOutcome payload ~2.5KB: 8 results with title/url/content. */
function searchPayload(i) {
        const results = [];
        for (let r = 0; r < 8; r++) {
                results.push({
                        url: `https://example${(i + r) % 40}.com/docs/page-${i}-${r}`,
                        title: `Result ${r} for query ${i} — ${loremish(60)}`,
                        content: loremish(160),
                });
        }
        return { provider: "searxng", query: `bench query ${i}`, results, attempted: [{ provider: "searxng", ok: true, note: "mock" }] };
}

/** A realistic fetched-page payload with text sized to an exact total. */
function pagePayload(i, size) {
        return { method: "direct", url: `https://example.com/page-${i}`, text: `GET direct\n\n${loremish(size)}`, truncated: false };
}

// ---------------------------------------------------------------------------
// Direct-format population: byte-compatible with webCachePut's on-disk entry
// (same payloadSha256, same two-pass bytes accounting, same atomic rename),
// without the amortized-eviction scan — see the header note.
// ---------------------------------------------------------------------------
function putDirect(entry) {
        const root = process.env.UNOWN_WEB_CACHE_DIR;
        const dir = join(root, "entries", entry.key.slice(0, 2));
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const payloadSha256 = createHash("sha256").update(JSON.stringify(entry.payload)).digest("hex");
        const full = { ...entry, payloadSha256, bytes: 0 };
        full.bytes = Buffer.byteLength(JSON.stringify(full));
        atomicWriteFileSync(join(dir, `${entry.key}.json`), JSON.stringify(full));
}

// ---------------------------------------------------------------------------
// Scenario: primitives — the store's per-op latency anatomy
// ---------------------------------------------------------------------------
async function scenarioPrimitives() {
        const out = { cells: {}, payloads: {} };

        // Payload classes (payload JSON bytes):
        //   S = search-like ~2.5KB · M = page ~48KB · L = page ~192KB (the cap)
        const S = (i) => searchPayload(i);
        const M = (i) => pagePayload(i, 48 * 1024);
        const L = (i) => pagePayload(i, 192 * 1024);
        out.payloads = {
                S: Buffer.byteLength(JSON.stringify(S(0))),
                M: Buffer.byteLength(JSON.stringify(M(0))),
                L: Buffer.byteLength(JSON.stringify(L(0))),
        };

        function populate(mk, count, kind) {
                const keys = [];
                for (let i = 0; i < count; i++) {
                        const key = `${kind}-${String(i).padStart(10, "0")}-${"k".repeat(40)}`.slice(0, 64);
                        putDirect({ schema: 1, kind, key, keyMaterial: JSON.stringify({ kind, i }), payload: mk(i), provider: "bench", storedAt: Date.now(), ttlMs: 3600_000, staleIfErrorMs: 86_400_000 });
                        keys.push(key);
                }
                return keys;
        }

        // --- hit latency (lookupFresh = get + freshness + touch) by payload size
        //     and store size. S at 200/2000/20000 isolates the N axis; S/M/L at
        //     200 entries isolates the payload axis.
        for (const [name, mk, n, count] of [
                ["hit_S@200", S, N_PRIM, 200],
                ["hit_M@200", M, Math.max(60, Math.floor(N_PRIM / 4)), 200],
                ["hit_L@200", L, Math.max(60, Math.floor(N_PRIM / 4)), 200],
                ["hit_S@2000", S, N_PRIM, 2000],
                ["hit_S@20000", S, N_PRIM, 20000],
        ]) {
                const d = newCacheDir(`primitives-${name.replace(/@.*/, "")}`);
                const keys = populate(mk, count, "search");
                const probe = keys[Math.floor(count / 2)];
                out.cells[name] = bench(n, () => lookupFresh(probe));
                dropCacheDir(d);
        }

        // --- read/touch/refresh split on an M payload (the anatomy inside a hit)
        {
                const d = newCacheDir("primitives-split");
                const keys = populate(M, 200, "fetch-text");
                const probe = keys[100];
                out.cells["read_M@200"] = bench(N_PRIM, () => webCacheGet(probe));
                out.cells["touch_M@200"] = bench(N_PRIM, () => webCacheTouch(probe));
                out.cells["refresh_M@200"] = bench(Math.max(60, Math.floor(N_PRIM / 4)), () => webCacheRefresh(probe, { etag: `"v${Math.random().toString(16).slice(2, 8)}"` }));
                dropCacheDir(d);
        }

        // --- miss cost: empty store, and absent key at 20k entries
        const ABSENT = "no-such-key-00000000000000000000000000000000000000000000000000000000000000";
        {
                const d = newCacheDir("primitives-miss-empty");
                out.cells.miss_empty = bench(N_PRIM, () => webCacheGet(ABSENT));
                dropCacheDir(d);
        }
        {
                const d = newCacheDir("primitives-miss-20k");
                populate(S, 20000, "search");
                out.cells["miss_absent@20k"] = bench(N_PRIM, () => webCacheGet(ABSENT));
                dropCacheDir(d);
        }

        // --- put cost, two ways: clean (cap 1TB — a sweep scan finds nothing to
        //     evict but may still fire) and amortized (default 256MiB cap — the
        //     real write path; 1/8 of writes pay the full-directory scan) over a
        //     5k store so the sweep tax lands in the tail.
        {
                const d = newCacheDir("primitives-put");
                out.cells.put_M_clean = (() => {
                        process.env.UNOWN_WEB_CACHE_MAX_BYTES = String(1024 ** 4);
                        const cell = bench(Math.max(60, Math.floor(N_PRIM / 4)), () => {
                                const k = `putclean-${Math.random().toString(16).slice(2).padEnd(64, "0")}`;
                                webCachePut({ schema: 1, kind: "fetch-text", key: k, keyMaterial: "{}", payload: M(0), provider: "bench", storedAt: Date.now(), ttlMs: 3600_000, staleIfErrorMs: 86_400_000 });
                        });
                        process.env.UNOWN_WEB_CACHE_MAX_BYTES = "";
                        return cell;
                })();
                populate(S, 5000, "search");
                out.cells["put_S_amortized@5k"] = bench(N_PRIM, () => {
                        const k = `putamort-${Math.random().toString(16).slice(2).padEnd(64, "0")}`;
                        webCachePut({ schema: 1, kind: "search", key: k, keyMaterial: "{}", payload: S(0), provider: "bench", storedAt: Date.now(), ttlMs: 3600_000, staleIfErrorMs: 86_400_000 });
                });
                dropCacheDir(d);
        }

        // --- memo on/off anatomy on an M payload: the default path is memo-first
        //     (hot key: no disk, no parse, no sha256); the memo-off cell is the
        //     baseline-comparable disk path (read + parse + re-verify).
        {
                const d = newCacheDir("primitives-memo");
                const keys = populate(M, 200, "fetch-text");
                const probe = keys[100];
                lookupFresh(probe); // warm the memo
                out.cells["hit_M_memo(default)"] = bench(N_PRIM, () => lookupFresh(probe));
                process.env.UNOWN_WEB_CACHE_MEMO = "0";
                out.cells["hit_M_memo_off"] = bench(N_PRIM, () => lookupFresh(probe));
                delete process.env.UNOWN_WEB_CACHE_MEMO;
                dropCacheDir(d);
        }

        // --- disabled store: the off-switch must be a single env read
        {
                const d = newCacheDir("primitives-disabled");
                populate(S, 200, "search");
                const key = searchCacheKey("bench disabled probe").key;
                process.env.UNOWN_WEB_CACHE = "0";
                out.cells.disabled_lookupFresh = bench(N_PRIM, () => lookupFresh(key));
                out.cells.disabled_get = bench(N_PRIM, () => webCacheGet(key));
                process.env.UNOWN_WEB_CACHE = "1";
                dropCacheDir(d);
        }

        // --- event append (one JSONL line per store decision — rides every
        //     hit/miss/revalidate call in the wired paths)
        {
                const d = newCacheDir("primitives-events");
                out.cells.event_append = bench(N_PRIM, () => webCacheLogEvent({ ts: Date.now(), kind: "hit", tool: "web_search", provider: "searxng", detail: "bench event", ageMs: 1234 }));
                dropCacheDir(d);
        }

        // --- CPU anatomy per payload class: JSON round-trip vs sha256 cost share
        for (const [name, mk] of [["S", S], ["M", M], ["L", L]]) {
                const payload = mk(0);
                out.cells[`cpu_json_${name}`] = bench(N_PRIM, () => JSON.parse(JSON.stringify(payload)));
                out.cells[`cpu_sha256_${name}`] = bench(N_PRIM, () => createHash("sha256").update(JSON.stringify(payload)).digest("hex"));
        }

        receipt.scenarios.primitives = out;
}

// ---------------------------------------------------------------------------
// Scenario: scan — the O(N) paths (stats/sweep) that the dashboard's 8s poll
// and the write-path amortized sweep both pay, plus a poll-loop simulation.
// ---------------------------------------------------------------------------
async function scenarioScan() {
        const out = { points: [] };
        for (const n of N_SCAN_POINTS) {
                const d = newCacheDir(`scan-${n}`);
                for (let i = 0; i < n; i++) {
                        const key = `scan-${String(i).padStart(10, "0")}-${"k".repeat(40)}`.slice(0, 64);
                        putDirect({ schema: 1, kind: "search", key, keyMaterial: "{}", payload: searchPayload(i), provider: "bench", storedAt: Date.now(), ttlMs: 3600_000, staleIfErrorMs: 86_400_000 });
                }

                const statsCell = bench(QUICK ? 6 : 21, () => webCacheStats());
                const { raw: _s, ...statsSummary } = statsCell;

                // index-rebuild cost (what a root switch, a 60s reconcile, or
                // UNOWN_WEB_CACHE_INDEX_MS=0 pays): 3 cold builds, timed one-shot
                const rebuilds = [];
                for (let i = 0; i < 3; i++) {
                        resetWebCacheInternals();
                        const t0 = performance.now();
                        webCacheStats();
                        rebuilds.push(performance.now() - t0);
                }
                const rebuildSummary = {
                        n: 3,
                        p50: +rebuilds.slice().sort((a, b) => a - b)[1].toFixed(3),
                        max: +Math.max(...rebuilds).toFixed(3),
                        unit: "ms",
                        raw: rebuilds.map((v) => +v.toFixed(3)),
                };

                // sweep with a cap above usage — now index-driven between rebuilds
                const sweepIdle = bench(QUICK ? 4 : 11, () => webCacheSweep());
                const { raw: _w, ...sweepIdleSummary } = sweepIdle;

                // one real evicting sweep: cap pinned to 90% of current usage
                let evicted = null;
                {
                        const before = webCacheStats();
                        process.env.UNOWN_WEB_CACHE_MAX_BYTES = String(Math.max(1024, Math.floor(before.bytes * 0.9)));
                        evicted = webCacheSweep();
                        process.env.UNOWN_WEB_CACHE_MAX_BYTES = "";
                }

                out.points.push({ entries: n, statsMs: statsSummary, statsRebuildMs: rebuildSummary, sweepIdleMs: sweepIdleSummary, evictingSweepOnce: evicted });
                dropCacheDir(d);
        }

        // dashboard-poll simulation: 30 consecutive stats calls over 5k entries —
        // what the engine event loop pays each time the Web Cache tab polls (8s)
        {
                const d = newCacheDir("scan-poll");
                for (let i = 0; i < 5000; i++) {
                        const key = `poll-${String(i).padStart(10, "0")}-${"k".repeat(40)}`.slice(0, 64);
                        putDirect({ schema: 1, kind: "search", key, keyMaterial: "{}", payload: searchPayload(i), provider: "bench", storedAt: Date.now(), ttlMs: 3600_000, staleIfErrorMs: 86_400_000 });
                }
                const calls = [];
                for (let i = 0; i < 30; i++) {
                        const t0 = performance.now();
                        webCacheStats();
                        calls.push(performance.now() - t0);
                }
                const sorted = [...calls].sort((a, b) => a - b);
                out.dashboardPoll = {
                        calls: 30,
                        entries: 5000,
                        totalMs: +calls.reduce((a, b) => a + b, 0).toFixed(1),
                        p50Ms: +pct(sorted, 50).toFixed(2),
                        maxMs: +sorted[sorted.length - 1].toFixed(2),
                        note: "each call is event-loop BLOCKING (sync fs) inside the engine serving /api/webcache",
                };
                dropCacheDir(d);
        }
        receipt.scenarios.scan = out;
}

// ---------------------------------------------------------------------------
// Mock providers (the repo's own integration-test pattern): searxng-shaped
// search + an ETag/Cache-Control HTTP page — both with injectable delay.
// ---------------------------------------------------------------------------
function startMockServer() {
        return new Promise((resolve) => {
                let searchDelayMs = 0;
                let fetchDelayMs = 0;
                let searchHits = 0;
                let page304s = 0;
                let pageRequests = 0;
                const ETAG = '"bench-v1"';
                const PAGE = `<html><body>${loremish(4096)}</body></html>`;
                const server = createServer((req, res) => {
                        const url = req.url ?? "";
                        req.on("end", () => {
                                if (url.startsWith("/robots.txt")) {
                                        res.writeHead(200, { "content-type": "text/plain" });
                                        res.end("User-agent: *\nAllow: /\n");
                                } else if (url.startsWith("/search")) {
                                        searchHits++;
                                        setTimeout(() => {
                                                res.writeHead(200, { "content-type": "application/json" });
                                                res.end(JSON.stringify({
                                                        results: [1, 2, 3, 4, 5, 6, 7, 8].map((r) => ({
                                                                url: `https://example${r}.com/bench`,
                                                                title: `Bench result ${r} ${loremish(40)}`,
                                                                content: loremish(140),
                                                                engine: "bench",
                                                        })),
                                                }));
                                        }, searchDelayMs);
                                } else if (url.startsWith("/page")) {
                                        pageRequests++;
                                        if (req.headers["if-none-match"] === ETAG) {
                                                page304s++;
                                                setTimeout(() => { res.writeHead(304); res.end(); }, fetchDelayMs);
                                        } else {
                                                setTimeout(() => {
                                                        res.writeHead(200, {
                                                                "content-type": "text/html",
                                                                etag: ETAG,
                                                                "cache-control": "public, max-age=1", // stale immediately → later fetches revalidate
                                                        });
                                                        res.end(PAGE);
                                                }, fetchDelayMs);
                                        }
                                } else if (url.startsWith("/swrpage")) {
                                        pageRequests++;
                                        // No Cache-Control, no ETag: TTL comes from the env knob (the
                                        // validator-less stale-while-revalidate shape).
                                        setTimeout(() => {
                                                res.writeHead(200, { "content-type": "text/plain" });
                                                res.end(`swr page body ${pageRequests}`);
                                        }, fetchDelayMs);
                                } else {
                                        res.writeHead(404);
                                        res.end("not found");
                                }
                        });
                        req.resume();
                });
                server.listen(0, "127.0.0.1", () => {
                        resolve({
                                base: `http://127.0.0.1:${server.address().port}`,
                                setSearchDelay: (ms) => (searchDelayMs = ms),
                                setFetchDelay: (ms) => (fetchDelayMs = ms),
                                counts: () => ({ searchHits, pageRequests, page304s }),
                                close: () => server.close(),
                        });
                });
        });
}

// ---------------------------------------------------------------------------
// Scenario: e2e — the full call path (runWebSearch / fetchPageContent)
// ---------------------------------------------------------------------------
async function scenarioE2E() {
        const d = newCacheDir("e2e");
        const mock = await startMockServer();
        process.env.UNOWN_SEARXNG_URL = mock.base;
        process.env.UNOWN_WEBFETCH_ALLOW_PRIVATE = "1";
        mock.setSearchDelay(120); // a fast real provider is ~0.5–3s; 120ms keeps
        mock.setFetchDelay(60); // the receipt quick while still showing the ratio
        const out = { delays: { searchMs: 120, fetchMs: 60 } };

        async function timedSearch(q) {
                const t0 = performance.now();
                const outcome = await websearch.runWebSearch(q, { provider: "searxng", maxResults: 5 });
                return { ms: performance.now() - t0, outcome };
        }
        async function timedFetch(u) {
                const t0 = performance.now();
                const text = await websearch.fetchPageContent(u, { noCache: false });
                return { ms: performance.now() - t0, text };
        }

        // search: cold (miss) then warm (hit) — identical query
        const cold = await timedSearch("e2e bench query cold");
        const warms = [];
        for (let i = 0; i < (QUICK ? 20 : 100); i++) warms.push((await timedSearch("e2e bench query cold")).ms);
        const sortedW = [...warms].sort((a, b) => a - b);
        const warmProbe = await timedSearch("e2e bench query cold");
        out.search = {
                coldMs: +cold.ms.toFixed(2),
                warmP50Ms: +pct(sortedW, 50).toFixed(3),
                warmP95Ms: +pct(sortedW, 95).toFixed(3),
                speedupP50: +(cold.ms / pct(sortedW, 50)).toFixed(0),
                coldProvenance: cold.outcome.cache?.provenance ?? "miss (expected on cold)",
                warmProvenance: warmProbe.outcome.cache?.provenance ?? null,
        };

        // fetch: cold → revalidated (304) — max-age=1 makes every later fetch a
        // conditional GET the store answers from the 304 without a full body
        const pageUrl = `${mock.base}/page`;
        const fcold = await timedFetch(pageUrl);
        await new Promise((r) => setTimeout(r, 1100)); // let max-age=1 lapse
        const revalids = [];
        for (let i = 0; i < (QUICK ? 20 : 100); i++) revalids.push((await timedFetch(pageUrl)).ms);
        const sortedR = [...revalids].sort((a, b) => a - b);
        out.fetch = {
                coldMs: +fcold.ms.toFixed(2),
                revalidatedP50Ms: +pct(sortedR, 50).toFixed(3),
                revalidatedP95Ms: +pct(sortedR, 95).toFixed(3),
                speedupVsColdP50: +(fcold.ms / pct(sortedR, 50)).toFixed(1),
                bodySample: fcold.text.slice(0, 60),
        };

        // provider counters + assertions
        const counts = mock.counts();
        out.providerCounts = counts;
        // 1 cold search + N warm (0 upstream) + 1 warmProbe (0) = exactly 1
        assert("e2e_search_exactly_1_origin_call", "1 search upstream call", counts.searchHits, counts.searchHits === 1);
        assert("e2e_fetch_revalidated_with_304", "page304s > 0", counts.page304s, counts.page304s > 0);
        assert("e2e_warm_is_hit_provenance", "hit", warmProbe.outcome.cache?.provenance, warmProbe.outcome.cache?.provenance === "hit");

        // stats sanity: the events feed recorded the whole story
        const stats = webCacheStats();
        out.statsTotals = stats.totals;

        mock.close();
        delete process.env.UNOWN_SEARXNG_URL;
        delete process.env.UNOWN_WEBFETCH_ALLOW_PRIVATE;
        dropCacheDir(d);
        receipt.scenarios.e2e = out;
}

// ---------------------------------------------------------------------------
// Scenario: coalesce — thundering herd through the real call path
// ---------------------------------------------------------------------------
async function scenarioCoalesce() {
        const d = newCacheDir("coalesce");
        const mock = await startMockServer();
        process.env.UNOWN_SEARXNG_URL = mock.base;
        process.env.UNOWN_WEBFETCH_ALLOW_PRIVATE = "1";
        mock.setSearchDelay(200);
        const out = { herd: 64, providerDelayMs: 200 };

        // 64 concurrent IDENTICAL searches (fresh key): single-flight must make
        // this exactly 1 provider call; all 64 await the same promise.
        const herdKey = `coalesce herd probe ${Date.now()}`;
        const t0 = performance.now();
        const herd = await Promise.all(Array.from({ length: 64 }, () => websearch.runWebSearch(herdKey, { provider: "searxng", maxResults: 5 }).catch((e) => ({ error: String(e) }))));
        const herdMs = performance.now() - t0;
        out.identical = {
                wallMs: +herdMs.toFixed(1),
                providerHits: mock.counts().searchHits,
                allOk: herd.every((r) => !r.error),
        };

        // 64 concurrent DISTINCT searches: 64 provider calls
        const t1 = performance.now();
        await Promise.all(Array.from({ length: 64 }, (_, i) => websearch.runWebSearch(`distinct probe ${i} ${Date.now()}`, { provider: "searxng", maxResults: 5 }).catch(() => {})));
        const distinctMs = performance.now() - t1;
        out.distinct = { wallMs: +distinctMs.toFixed(1), providerHits: mock.counts().searchHits - out.identical.providerHits };

        // 64 concurrent identical with noCache: store AND coalescing bypassed
        const before = mock.counts().searchHits;
        const t2 = performance.now();
        await Promise.all(Array.from({ length: 64 }, () => websearch.runWebSearch(`nocache probe ${Date.now()}`, { provider: "searxng", maxResults: 5, noCache: true }).catch(() => {})));
        const nocacheMs = performance.now() - t2;
        out.nocacheIdentical = { wallMs: +nocacheMs.toFixed(1), providerHits: mock.counts().searchHits - before };

        assert("coalesce_identical_1_origin_call", "1 upstream call for 64 identical", out.identical.providerHits, out.identical.providerHits === 1);
        assert("coalesce_distinct_64_origin_calls", "64 upstream calls", out.distinct.providerHits, out.distinct.providerHits === 64);
        assert("coalesce_nocache_64_origin_calls", "64 upstream calls", out.nocacheIdentical.providerHits, out.nocacheIdentical.providerHits === 64);

        mock.close();
        delete process.env.UNOWN_SEARXNG_URL;
        delete process.env.UNOWN_WEBFETCH_ALLOW_PRIVATE;
        dropCacheDir(d);
        receipt.scenarios.coalesce = out;
}

// ---------------------------------------------------------------------------
// Scenario: zipf — workload realism (s=1.0 over N keys) + hit/miss split
// ---------------------------------------------------------------------------
async function scenarioZipf() {
        const d = newCacheDir("zipf");
        const mock = await startMockServer();
        process.env.UNOWN_SEARXNG_URL = mock.base;
        process.env.UNOWN_WEBFETCH_ALLOW_PRIVATE = "1";
        mock.setSearchDelay(5); // small: we want the cache effect, not provider time

        const keys = Array.from({ length: ZIPF_KEYS }, (_, i) => `zipf query ${i}`);
        // Zipf s=1.0 CDF over ranks; binary-search a uniform draw against it.
        const cdf = [];
        let acc = 0;
        for (let i = 1; i <= ZIPF_KEYS; i++) {
                acc += 1 / i;
                cdf.push(acc);
        }
        const totalW = acc;
        function zipfDraw() {
                const r = Math.random() * totalW;
                let lo = 0, hi = cdf.length - 1;
                while (lo < hi) {
                        const mid = (lo + hi) >> 1;
                        if (cdf[mid] < r) lo = mid + 1;
                        else hi = mid;
                }
                return lo;
        }
        const requests = Array.from({ length: ZIPF_REQS }, () => keys[zipfDraw()]);

        const CONC = 8;
        const hits = [];
        const misses = [];
        let i = 0;
        async function worker() {
                while (i < requests.length) {
                        const q = requests[i++];
                        const t0 = performance.now();
                        const outcome = await websearch.runWebSearch(q, { provider: "searxng", maxResults: 5 }).catch(() => null);
                        const ms = performance.now() - t0;
                        if (outcome?.cache?.provenance === "hit") hits.push(ms);
                        else misses.push(ms);
                }
        }
        const t0 = performance.now();
        await Promise.all(Array.from({ length: CONC }, worker));
        const wallMs = performance.now() - t0;

        // control: uncached mean provider latency (200-request sample)
        const control = [];
        for (let c = 0; c < 200; c++) {
                const t = performance.now();
                await websearch.runWebSearch(`control ${c}`, { provider: "searxng", maxResults: 5, noCache: true }).catch(() => {});
                control.push(performance.now() - t);
        }
        const controlMean = control.reduce((a, b) => a + b, 0) / control.length;

        const sortedH = [...hits].sort((a, b) => a - b);
        const sortedM = [...misses].sort((a, b) => a - b);
        const hitRate = hits.length / (hits.length + misses.length);
        receipt.scenarios.zipf = {
                keys: ZIPF_KEYS,
                requests: ZIPF_REQS,
                distribution: "zipf s=1.0",
                concurrency: CONC,
                hitRate: +hitRate.toFixed(4),
                hits: hits.length,
                misses: misses.length,
                hitP50Ms: +pct(sortedH, 50).toFixed(3),
                hitP99Ms: +pct(sortedH, 99).toFixed(3),
                missP50Ms: +pct(sortedM, 50).toFixed(3),
                wallMs: +wallMs.toFixed(0),
                uncachedControlMeanMs: +controlMean.toFixed(2),
                estimatedSavedMs: +(hits.length * controlMean).toFixed(0),
        };
        assert("zipf_hit_rate_above_60pct", ">0.60 (zipf s=1 over 6x keys)", +hitRate.toFixed(4), hitRate > 0.6);

        mock.close();
        delete process.env.UNOWN_SEARXNG_URL;
        delete process.env.UNOWN_WEBFETCH_ALLOW_PRIVATE;
        dropCacheDir(d);
}

// ---------------------------------------------------------------------------
// Scenario: swr — stale-while-revalidate end to end (RFC 5861 semantics)
// ---------------------------------------------------------------------------
async function scenarioSwr() {
        const d = newCacheDir("swr");
        const mock = await startMockServer();
        process.env.UNOWN_SEARXNG_URL = mock.base;
        process.env.UNOWN_WEBFETCH_ALLOW_PRIVATE = "1";
        mock.setSearchDelay(100);
        mock.setFetchDelay(100);
        const out = { providerDelayMs: 100 };

        // search: store COLD at TTL 1ms, then serve stale with TTL=60s in
        // effect (the kick stores fresh at the TTL read at serve time) → the
        // next identical call is a fresh hit.
        {
                process.env.UNOWN_WEB_SEARCH_CACHE_TTL_MS = "1";
                const cold0 = performance.now();
                const cold = await websearch.runWebSearch("swr bench search", { provider: "searxng", maxResults: 5 });
                const coldMs = performance.now() - cold0;
                await new Promise((r) => setTimeout(r, 25)); // TTL lapses → stale
                process.env.UNOWN_WEB_SEARCH_CACHE_TTL_MS = "60000";
                const t1 = performance.now();
                const served = await websearch.runWebSearch("swr bench search", { provider: "searxng", maxResults: 5 });
                const serveMs = performance.now() - t1;
                await new Promise((r) => setTimeout(r, 250)); // detached refresh lands (stored fresh, 60s TTL)
                const after = await websearch.runWebSearch("swr bench search", { provider: "searxng", maxResults: 5 });
                delete process.env.UNOWN_WEB_SEARCH_CACHE_TTL_MS;
                out.search = {
                        coldMs: +coldMs.toFixed(1),
                        swrServeMs: +serveMs.toFixed(3),
                        coldProvenance: cold.cache?.provenance ?? "miss",
                        swrProvenance: served.cache?.provenance,
                        afterProvenance: after.cache?.provenance,
                        providerCalls: mock.counts().searchHits,
                };
                assert("swr_search_served_instantly", "< 30ms (provider is 100ms)", out.search.swrServeMs, serveMs < 30);
                assert("swr_search_provenance_refreshing", "refreshing", out.search.swrProvenance, out.search.swrProvenance === "refreshing");
                assert("swr_search_exactly_2_provider_calls", "cold + 1 background refresh", out.search.providerCalls, out.search.providerCalls === 2);
                assert("swr_search_next_call_fresh", "hit", out.search.afterProvenance, out.search.afterProvenance === "hit");
        }

        // fetch (no validators): same shape through fetchPageContent — store
        // cold at TTL 1ms, serve stale at TTL 60s, next call is a fresh hit
        {
                process.env.UNOWN_WEBFETCH_CACHE_TTL_MS = "1";
                const base = mock.base;
                const cold0 = performance.now();
                await websearch.fetchPageContent(`${base}/swrpage`, { noCache: false });
                const coldMs = performance.now() - cold0;
                await new Promise((r) => setTimeout(r, 25));
                process.env.UNOWN_WEBFETCH_CACHE_TTL_MS = "60000";
                const t1 = performance.now();
                const served = await websearch.fetchPageContent(`${base}/swrpage`, { noCache: false });
                const serveMs = performance.now() - t1;
                await new Promise((r) => setTimeout(r, 250));
                const after = await websearch.fetchPageContent(`${base}/swrpage`, { noCache: false });
                delete process.env.UNOWN_WEBFETCH_CACHE_TTL_MS;
                const pageCalls = mock.counts().pageRequests;
                out.fetch = {
                        coldMs: +coldMs.toFixed(1),
                        swrServeMs: +serveMs.toFixed(3),
                        servedHeader: served.split("\n")[0].slice(0, 160),
                        afterHeader: after.split("\n")[0].slice(0, 160),
                        pageCalls,
                };
                assert("swr_fetch_served_instantly", "< 30ms (provider is 100ms)", out.fetch.swrServeMs, serveMs < 30);
                assert("swr_fetch_marker_visible", "stale — refreshing in background", out.fetch.servedHeader, out.fetch.servedHeader.includes("stale — refreshing in background"));
                assert("swr_fetch_next_call_fresh", "· cached (", out.fetch.afterHeader, out.fetch.afterHeader.includes("· cached ("));
        }

        // settle before teardown: detached SWR kicks must never outlive the
        // scenario's cache dir (a late kick after dropCacheDir would log its
        // event into the DEFAULT store — call-time env is by design, so the
        // harness owns the discipline).
        await new Promise((r) => setTimeout(r, 150));

        mock.close();
        delete process.env.UNOWN_SEARXNG_URL;
        delete process.env.UNOWN_WEBFETCH_ALLOW_PRIVATE;
        dropCacheDir(d);
        receipt.scenarios.swr = out;
}

// ---------------------------------------------------------------------------
// Scenario: xproc — cross-process persistence (the reason the store exists)
// ---------------------------------------------------------------------------
async function scenarioXproc() {
        const d = newCacheDir("xproc");
        const key = searchCacheKey("cross process probe").key;
        putDirect({ schema: 1, kind: "search", key, keyMaterial: "{}", payload: searchPayload(1), provider: "bench", storedAt: Date.now(), ttlMs: 3600_000, staleIfErrorMs: 86_400_000 });

        const childScript = `
(async () => {
  process.env.UNOWN_WEB_CACHE_DIR = ${JSON.stringify(d)};
  const wc = await import(${JSON.stringify(join(SELF_LEARNING, "webcache.ts"))});
  const key = ${JSON.stringify(key)};
  const t0 = performance.now();
  const hit = wc.lookupFresh(key);
  const t1 = performance.now();
  const hit2 = wc.lookupFresh(key);
  const t2 = performance.now();
  const miss = wc.webCacheGet("no-such-key-00000000000000000000000000000000000000000000000000000000000000");
  const t3 = performance.now();
  console.log(JSON.stringify({ found: !!hit, firstMs: t1 - t0, secondMs: t2 - t1, missMs: t3 - t2, provenance: hit?.provenance ?? null, payloadOk: hit?.value?.results?.length > 0 }));
})();
`;
        const childOut = execFileSync(process.execPath, ["-e", childScript], { encoding: "utf8" });
        const parsed = JSON.parse(childOut.trim().split("\n").pop());
        receipt.scenarios.xproc = {
                ...parsed,
                note: "child = fresh bun process; measures cross-process store visibility + first/second lookup",
        };
        assert("xproc_child_reads_parent_entry", "found=true", parsed.found, parsed.found === true);
        assert("xproc_payload_intact", "payloadOk=true", parsed.payloadOk, parsed.payloadOk === true);
        dropCacheDir(d);
}

// ---------------------------------------------------------------------------
// Scenario: memory — bounded growth across a large populate + hit sweep
// ---------------------------------------------------------------------------
async function scenarioMemory() {
        const d = newCacheDir("memory");
        const rss0 = process.memoryUsage().rss;
        const keys = [];
        for (let i = 0; i < 5000; i++) {
                const key = `mem-${String(i).padStart(10, "0")}-${"k".repeat(40)}`.slice(0, 64);
                putDirect({ schema: 1, kind: "fetch-text", key, keyMaterial: "{}", payload: pagePayload(i, 48 * 1024), provider: "bench", storedAt: Date.now(), ttlMs: 3600_000, staleIfErrorMs: 86_400_000 });
                keys.push(key);
        }
        const rssMid = process.memoryUsage().rss;
        for (let r = 0; r < 3; r++) for (const k of keys) webCacheGet(k);
        const rss1 = process.memoryUsage().rss;
        const mb = (v) => +(v / 1024 / 1024).toFixed(1);
        receipt.scenarios.memory = {
                entries: 5000,
                entryPayloadBytes: Buffer.byteLength(JSON.stringify(pagePayload(0, 48 * 1024))),
                rssBeforeMb: mb(rss0),
                rssAfterPutsMb: mb(rssMid),
                rssAfterHitSweepMb: mb(rss1),
                putsDeltaMb: mb(rssMid - rss0),
                hitSweepDeltaMb: mb(rss1 - rssMid),
        };
        assert("memory_hit_sweep_no_leak", "< 200MB delta across 15k reads", mb(rss1 - rssMid), rss1 - rssMid < 200 * 1024 * 1024);
        dropCacheDir(d);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const SCENARIOS = {
        primitives: scenarioPrimitives,
        scan: scenarioScan,
        e2e: scenarioE2E,
        coalesce: scenarioCoalesce,
        swr: scenarioSwr,
        zipf: scenarioZipf,
        xproc: scenarioXproc,
        memory: scenarioMemory,
};

const wanted = only ? only.filter((s) => SCENARIOS[s]) : Object.keys(SCENARIOS);
const skipped = only ? Object.keys(SCENARIOS).filter((s) => !wanted.includes(s)) : [];
if (skipped.length) receipt.meta.skipped = skipped;

process.env.UNOWN_WEB_CACHE_MAX_BYTES = ""; // default cap for measured paths
const failedAsserts = [];
for (const name of wanted) {
        const t0 = performance.now();
        try {
                await SCENARIOS[name]();
        } catch (err) {
                receipt.scenarios[name] = { error: String(err?.stack ?? err) };
                console.error(`[webcache-bench] ${name} ERRORED: ${err?.message ?? err}`);
        }
        console.error(`[webcache-bench] ${name} done in ${(performance.now() - t0).toFixed(0)}ms`);
}
for (const [name, a] of Object.entries(receipt.asserts)) if (!a.pass) failedAsserts.push(name);

// Receipt write
const { mkdirSync: mkdir, writeFileSync: writeFile } = await import("node:fs");
const resultsDir = join(repoRoot, "benchmarks/webcache/results");
mkdir(resultsDir, { recursive: true });
const stamp = Date.now();
const outPath = OUT || join(resultsDir, `webcache-bench-${stamp}${LABEL ? `-${LABEL}` : ""}.json`);
writeFile(outPath, JSON.stringify(receipt, null, 1) + "\n");

// Console summary (human-readable; the receipt is the record)
console.log(`\n=== webcache-bench ${QUICK ? "(quick) " : ""}→ ${outPath.replace(repoRoot + "/", "")} ===`);
if (receipt.scenarios.primitives?.cells) {
        for (const [name, cell] of Object.entries(receipt.scenarios.primitives.cells)) {
                if (cell?.p50 !== undefined) console.log(`  ${name.padEnd(22)} p50=${String(cell.p50).padStart(9)}ms  p99=${String(cell.p99).padStart(9)}ms  max=${String(cell.max).padStart(9)}ms`);
        }
}
if (receipt.scenarios.scan?.points) {
        for (const p of receipt.scenarios.scan.points) {
                console.log(`  stats@${String(p.entries).padStart(5)}       p50=${p.statsMs.p50}ms  max=${p.statsMs.max}ms   sweepIdle p50=${p.sweepIdleMs.p50}ms`);
        }
        console.log(`  poll-loop(5k)          total=${receipt.scenarios.scan.dashboardPoll.totalMs}ms / 30 calls  max=${receipt.scenarios.scan.dashboardPoll.maxMs}ms`);
}
if (receipt.scenarios.e2e) {
        console.log(`  e2e search: cold=${receipt.scenarios.e2e.search.coldMs}ms → warm p50=${receipt.scenarios.e2e.search.warmP50Ms}ms (${receipt.scenarios.e2e.search.speedupP50}x)`);
        console.log(`  e2e fetch:  cold=${receipt.scenarios.e2e.fetch.coldMs}ms → 304-revalidated p50=${receipt.scenarios.e2e.fetch.revalidatedP50Ms}ms`);
}
if (receipt.scenarios.coalesce) {
        console.log(`  coalesce: 64 identical = ${receipt.scenarios.coalesce.identical.providerHits} origin call(s) wall=${receipt.scenarios.coalesce.identical.wallMs}ms · distinct=${receipt.scenarios.coalesce.distinct.providerHits} wall=${receipt.scenarios.coalesce.distinct.wallMs}ms · noCache=${receipt.scenarios.coalesce.nocacheIdentical.providerHits}`);
}
if (receipt.scenarios.swr) {
        console.log(`  swr search: cold=${receipt.scenarios.swr.search.coldMs}ms → stale-serve=${receipt.scenarios.swr.search.swrServeMs}ms (${receipt.scenarios.swr.search.swrProvenance}), provider calls=${receipt.scenarios.swr.search.providerCalls}, next=${receipt.scenarios.swr.search.afterProvenance}`);
        console.log(`  swr fetch:  cold=${receipt.scenarios.swr.fetch.coldMs}ms → stale-serve=${receipt.scenarios.swr.fetch.swrServeMs}ms`);
}
if (receipt.scenarios.zipf) {
        const z = receipt.scenarios.zipf;
        console.log(`  zipf: hitRate=${(z.hitRate * 100).toFixed(1)}% hitP50=${z.hitP50Ms}ms missP50=${z.missP50Ms}ms est.saved=${z.estimatedSavedMs}ms`);
}
if (receipt.scenarios.xproc) {
        const x = receipt.scenarios.xproc;
        console.log(`  xproc: child found=${x.found} first=${(+x.firstMs).toFixed(3)}ms second=${(+x.secondMs).toFixed(3)}ms miss=${(+x.missMs).toFixed(3)}ms`);
}
if (receipt.scenarios.memory) {
        console.log(`  memory: puts Δ=${receipt.scenarios.memory.putsDeltaMb}MB, hit-sweep Δ=${receipt.scenarios.memory.hitSweepDeltaMb}MB`);
}
if (failedAsserts.length) {
        console.error(`\nASSERTION FAILURES: ${failedAsserts.join(", ")}`);
        process.exitCode = 1;
} else if (Object.keys(receipt.asserts).length) {
        console.log(`\nall ${Object.keys(receipt.asserts).length} assertions passed`);
}
