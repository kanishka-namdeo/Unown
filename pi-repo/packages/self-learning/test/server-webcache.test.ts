// Endpoint tests for the web results store API surface in src/server.ts:
// GET /api/webcache, POST /api/webcache/clear, POST /api/webcache/sweep.
//
// Pattern: fetch-against-listener. The real startServer() boots the router,
// the automations scheduler and the shared store singleton — side effects the
// unit suite must not grow — so this file wires the REAL routing layer
// (handleApi + apiRequestBody, the exact composition src/server.ts's fetch
// handler uses for /api/* routes) into a Bun.serve listener on an ephemeral
// port, the same trick test/integration/helpers.ts uses for the full engine.
// The bus emission (what the SSE /api/events stream fans out to dashboards)
// is asserted through the same subscribe() the stream listens on.
//
// The store is pointed at a per-run temp dir via UNOWN_WEB_CACHE_DIR with the
// env save/restore pattern from test/webcache.test.ts (all knobs are call-time
// reads); no network, no engine DB writes.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { subscribe } from "../src/bus.ts";
import { apiRequestBody, handleApi } from "../src/server.ts";
import { webCacheClear, webCacheLogEvent, webCachePut } from "../src/webcache.ts";

// Env save/restore — pin the store on a temp dir with deterministic knobs.
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
let server: { port: number; stop: (stopActiveConnections?: boolean) => void };

/** Deterministic 64-hex cache key (the store's shard/name scheme). */
const key = (n: number) => n.toString(16).padStart(64, "0");

function putEntry(n: number, payloadPad = 1): void {
        webCachePut({
                schema: 1,
                kind: "search",
                key: key(n),
                keyMaterial: JSON.stringify({ kind: "search", q: `query ${n}` }),
                payload: { results: [], provider: "duckduckgo", attempted: [], query: `query ${n}`, pad: "x".repeat(64 * payloadPad) },
                provider: "duckduckgo",
                storedAt: Date.now(),
                ttlMs: 1000,
                staleIfErrorMs: 5000,
        });
}

beforeAll(() => {
        for (const [k, v] of PINNED) {
                SAVED[k] = process.env[k];
                if (v === "") delete process.env[k];
                else process.env[k] = v;
        }
        tmpRoot = mkdtempSync(join(tmpdir(), "unown-webcache-api-"));
        process.env.UNOWN_WEB_CACHE_DIR = tmpRoot;
        // The listener mirrors src/server.ts's own fetch handler for /api/* routes:
        // the real body gate + the real router, over real HTTP.
        server = Bun.serve({
                port: 0,
                async fetch(req) {
                        const url = new URL(req.url);
                        if (url.pathname.startsWith("/api/")) {
                                return handleApi({ method: req.method, path: url.pathname, query: url.searchParams, body: await apiRequestBody(req) });
                        }
                        return new Response("not found", { status: 404 });
                },
        });
});

afterAll(() => {
        for (const [k] of PINNED) {
                const saved = SAVED[k];
                if (saved === undefined) delete process.env[k];
                else process.env[k] = saved;
        }
        server?.stop(true);
        rmSync(tmpRoot, { recursive: true, force: true });
});

/** POST helper (the mutations carry no body). */
async function post(path: string): Promise<Response> {
        return fetch(`http://127.0.0.1:${server.port}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
}

/** Wipe entries + the events feed so every test starts from a fresh store. */
function resetStore(): void {
        webCacheClear();
        rmSync(join(tmpRoot, "events.jsonl"), { force: true });
}

describe("webcache API endpoints", () => {
        test("GET /api/webcache returns the full stats shape", async () => {
                resetStore();
                putEntry(1);
                putEntry(2);
                webCacheLogEvent({ ts: Date.now(), kind: "hit", tool: "web_search", provider: "duckduckgo", detail: "query 1" });
                webCacheLogEvent({ ts: Date.now(), kind: "miss", tool: "webfetch", provider: "direct", detail: "example.com" });

                const res = await fetch(`http://127.0.0.1:${server.port}/api/webcache`);
                expect(res.status).toBe(200);
                expect(res.headers.get("content-type")).toContain("application/json");
                const stats = (await res.json()) as Record<string, any>;

                expect(stats.enabled).toBe(true);
                expect(stats.root).toBe(tmpRoot);
                expect(stats.entries).toBe(2);
                expect(stats.bytes).toBeGreaterThan(0);
                expect(stats.maxBytes).toBeGreaterThan(0); // unpinned knob → the 256 MiB default
                expect(stats.ttl).toEqual({ searchMs: 1000, fetchMs: 1000, searchStaleMs: 5000, fetchStaleMs: 5000 });
                expect(Object.keys(stats.totals).sort()).toEqual(
                        ["bypass", "clear", "error", "evict", "hit", "miss", "revalidated", "stale"],
                );
                expect(stats.totals.hit).toBe(1);
                expect(stats.totals.miss).toBe(1);
                expect(stats.savedRequests).toBe(1); // hits + revalidations
                expect(stats.byTool).toEqual({ web_search: 1, webfetch: 1 });
                expect(stats.byProvider).toEqual({ duckduckgo: 1, direct: 1 });
                expect(Array.isArray(stats.recentEvents)).toBe(true);
                expect(stats.recentEvents.length).toBe(2); // newest first
                expect(stats.recentEvents[0].kind).toBe("miss");
        });

        test("POST /api/webcache/clear removes every entry, returns counts, and emits webcache:cleared", async () => {
                resetStore();
                putEntry(11);
                putEntry(12);
                putEntry(13);

                // The bus is what the SSE /api/events stream fans out — subscribe like
                // the dashboard does and assert the invalidation event fires.
                const seen: Array<{ event: string; payload: any }> = [];
                const unsub = subscribe((e) => seen.push(e));

                try {
                        const res = await post("/api/webcache/clear");
                        expect(res.status).toBe(200);
                        const body = (await res.json()) as Record<string, any>;
                        expect(body.ok).toBe(true);
                        expect(body.removed).toBe(3);
                        expect(body.bytes).toBeGreaterThan(0);

                        // The store is actually empty now…
                        const after = (await (await fetch(`http://127.0.0.1:${server.port}/api/webcache`)).json()) as Record<string, any>;
                        expect(after.entries).toBe(0);
                        expect(after.bytes).toBe(0);
                        // …and the clear left its mark on the observability feed.
                        expect(after.totals.clear).toBeGreaterThanOrEqual(1);
                        expect(after.recentEvents[0].kind).toBe("clear");

                        // The mutation announced itself for live dashboards.
                        const cleared = seen.filter((e) => e.event === "webcache:cleared");
                        expect(cleared).toHaveLength(1);
                        expect(cleared[0].payload.removed).toBe(3);
                        expect(cleared[0].payload.bytes).toBe(body.bytes);
                } finally {
                        unsub();
                }
        });

        test("POST /api/webcache/sweep evicts down to the byte cap and reports it", async () => {
                resetStore();
                // Seed while the cap is still the 256 MiB default (the write path's
                // amortized eviction must not race the fixture), then shrink the cap so
                // every entry is over it and sweep deterministically evicts all three.
                putEntry(21, 40); // ~2.7 KB each — comfortably above the 1 KiB floor
                putEntry(22, 40);
                putEntry(23, 40);
                const savedCap = process.env.UNOWN_WEB_CACHE_MAX_BYTES;
                process.env.UNOWN_WEB_CACHE_MAX_BYTES = "1024";
                try {
                        const res = await post("/api/webcache/sweep");
                        expect(res.status).toBe(200);
                        const body = (await res.json()) as Record<string, any>;
                        expect(body.ok).toBe(true);
                        expect(body.evicted).toBe(3);
                        expect(body.freedBytes).toBeGreaterThan(0);
                        expect(body.totalBytes).toBeGreaterThan(0);

                        const after = (await (await fetch(`http://127.0.0.1:${server.port}/api/webcache`)).json()) as Record<string, any>;
                        expect(after.entries).toBe(0);
                        expect(after.totals.evict).toBeGreaterThanOrEqual(1);

                        // A second sweep under the cap is a no-op, not an error.
                        const again = (await (await post("/api/webcache/sweep")).json()) as Record<string, any>;
                        expect(again.ok).toBe(true);
                        expect(again.evicted).toBe(0);
                        expect(again.freedBytes).toBe(0);
                } finally {
                        if (savedCap === undefined) delete process.env.UNOWN_WEB_CACHE_MAX_BYTES;
                        else process.env.UNOWN_WEB_CACHE_MAX_BYTES = savedCap;
                }
        });

        test("unknown webcache methods/paths keep the generic envelope", async () => {
                const wrongMethod = await fetch(`http://127.0.0.1:${server.port}/api/webcache/clear`); // GET on a POST route
                expect(wrongMethod.status).toBe(404);
                const missing = (await wrongMethod.json()) as Record<string, any>;
                expect(String(missing.error)).toContain("not found");
        });
});
