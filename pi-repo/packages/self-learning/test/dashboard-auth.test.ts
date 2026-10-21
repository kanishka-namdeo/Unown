// dashboard-auth.test.ts — the M7 gap, pinned: the TUI dashboard's own
// EngineClient must authenticate against a token-gated engine.
//
// M7 wired every in-tree engine client through engineFetch EXCEPT this one —
// the TUI dashboard (the flagship D1-D6 surface) 401'd against every
// default-posture engine, and neither dashboard suite could see it: the D6
// mock engine serves no token file (engineFetch then sends no Authorization
// header and everything stays green by design), and engine-auth.test.ts
// tests the shared helper, not this client's wiring. These tests boot
// token-GATING servers (the fetch-wrapper contract of server.ts:712) and
// prove the dashboard's REST and SSE lanes present the bearer token and
// heal across a rotation.
//
// Conventions follow engine-auth.test.ts (token-file lifecycle via
// writeEngineTokenFile/removeEngineTokenFile + invalidateEngineToken around
// every case — the token cache is process-global and other suites' mock
// engines share this process) and dashboard-store.test.ts (the store's
// lifecycle + until() polling for the async SSE lane).
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
        engineTokenPath,
        invalidateEngineToken,
        removeEngineTokenFile,
        writeEngineTokenFile,
} from "../src/engine-auth.ts";
import { DashboardStore, EngineClient } from "../src/dashboard/dashboard-data.ts";
import type { MemoryResponse } from "../src/dashboard/dashboard-types.ts";

/** Poll until fn() is truthy or the budget expires (deterministic waits). */
async function until(fn: () => boolean, ms: number): Promise<boolean> {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
                if (fn()) return true;
                await Bun.sleep(20);
        }
        return fn();
}

const TOK = "d".repeat(64);
const TOK2 = "e".repeat(64);

interface GateServer {
        url: string;
        seen: Array<{ path: string; auth: string | null }>;
        /** When set, the NEXT request with the wrong token gets the file rewritten
         * server-side (the "engine rebooted and wrote a fresh boot token" shape)
         * and a single 401 — mirroring engine-auth.test.ts's rewriteTo. */
        rewriteOnReject: string | null;
        stop: () => void;
}

/** A REST engine that enforces the M7 bearer gate on /api/* (server.ts:712). */
function startGateServer(): GateServer {
        const seen: GateServer["seen"] = [];
        const gate: GateServer = {
                url: "",
                seen,
                rewriteOnReject: null,
                stop: () => {},
        };
        let required = TOK;
        const server = Bun.serve({
                port: 0,
                fetch(r) {
                        const url = new URL(r.url);
                        seen.push({ path: url.pathname, auth: r.headers.get("authorization") });
                        if (url.pathname === "/") return new Response("ok");
                        if (gate.rewriteOnReject || r.headers.get("authorization") !== `Bearer ${required}`) {
                                // The reboot shape: the new engine already wrote its token BEFORE
                                // answering 401 to our (possibly still-valid) one — engineFetch's
                                // re-read then sees the fresh token and its retry succeeds. Armed
                                // rejections model the reboot landing between our discovery and
                                // our request (engine-auth.test.ts's rejectFirst).
                                if (gate.rewriteOnReject) {
                                        writeEngineTokenFile(engineTokenPath(), gate.rewriteOnReject);
                                        required = gate.rewriteOnReject;
                                        gate.rewriteOnReject = null;
                                }
                                return Response.json({ error: "missing or invalid engine token" }, { status: 401 });
                        }
                        return Response.json({ version: 1, tiers: [] });
                },
        });
        gate.url = `http://127.0.0.1:${server.port}`;
        gate.stop = () => server.stop(true);
        return gate;
}

/** An /api/events SSE endpoint that records the Authorization header. */
function startSseServer(): { url: string; auths: Array<string | null>; stop: () => void } {
        const auths: Array<string | null> = [];
        const server = Bun.serve({
                port: 0,
                async fetch(r) {
                        const url = new URL(r.url);
                        if (url.pathname === "/api/events") {
                                auths.push(r.headers.get("authorization"));
                                if (r.headers.get("authorization") !== `Bearer ${TOK}`) {
                                        return new Response("no", { status: 401 });
                                }
                                // hello frame, then keep the stream open (the real engine's shape).
                                const stream = new ReadableStream({
                                        start(ctrl) {
                                                const enc = new TextEncoder();
                                                ctrl.enqueue(enc.encode(`event: hello\ndata: {}\n\n`));
                                                // Hold the stream open; the store's abort closes its reader.
                                        },
                                });
                                return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
                        }
                        return Response.json({ version: 1, tiers: [] });
                },
        });
        return { url: `http://127.0.0.1:${server.port}`, auths, stop: () => server.stop(true) };
}

describe("TUI dashboard client authentication (M7 gap)", () => {
        let gate: GateServer;

        beforeEach(() => {
                removeEngineTokenFile(engineTokenPath());
                delete process.env.UNOWN_ENGINE_TOKEN;
                invalidateEngineToken();
                gate = startGateServer();
        });

        afterEach(() => {
                gate.stop();
                removeEngineTokenFile(engineTokenPath());
                delete process.env.UNOWN_ENGINE_TOKEN;
                invalidateEngineToken();
        });

        afterAll(() => {
                // Belt and braces: the token cache is process-global and the mock-engine
                // suites that share this process must never see our token file.
                removeEngineTokenFile(engineTokenPath());
                invalidateEngineToken();
        });

        test("REST: EngineClient presents the discovered bearer token (no more blanket 401s)", async () => {
                writeEngineTokenFile(engineTokenPath(), TOK);
                invalidateEngineToken();
                const client = new EngineClient(gate.url, 3000);
                // THE regression: before the engineFetch wiring this threw
                // "engine 401: missing or invalid engine token" on every call.
                const data = await client.get<MemoryResponse>("/api/memory");
                expect(data).not.toBeNull();
                expect(gate.seen.at(-1)?.auth).toBe(`Bearer ${TOK}`);
        });

        test("REST: 401 + engine reboot (rotated token) → one re-read, one retry, success", async () => {
                writeEngineTokenFile(engineTokenPath(), TOK);
                invalidateEngineToken();
                // The engine "rebooted": it now requires TOK2 and — the real reboot
                // shape — has already written TOK2 to the token file by the time it
                // 401s our stale TOK. engineFetch re-reads once, retries once, heals.
                gate.rewriteOnReject = TOK2;
                const client = new EngineClient(gate.url, 3000);
                const data = await client.get<MemoryResponse>("/api/memory");
                expect(data).not.toBeNull();
                expect(gate.seen.length).toBe(2);
                expect(gate.seen[0].auth).toBe(`Bearer ${TOK}`);
                expect(gate.seen[1].auth).toBe(`Bearer ${TOK2}`);
        }, 10_000);

        test("no token discoverable → plain fetch shape (the D6 mock lane stays green)", async () => {
                const client = new EngineClient(gate.url, 3000);
                // The gate 401s — but the point is the SHAPE: no Authorization header
                // was synthesized (engineFetch degrades to a plain fetch when no
                // token exists, so the mock-engine suites never see a stale header).
                await expect(client.get<MemoryResponse>("/api/memory")).rejects.toThrow(/401/);
                expect(gate.seen[0].auth).toBeNull();
        });

        test("SSE: the events lane carries the bearer token and connects", async () => {
                const sse = startSseServer();
                writeEngineTokenFile(engineTokenPath(), TOK);
                invalidateEngineToken();
                try {
                        const store = new DashboardStore(new EngineClient(sse.url, 3000));
                        try {
                                // start() (not the constructor) dials /api/events + begins polling;
                                // the connection only reports "up" after the hello frame is read.
                                store.start();
                                const up = await until(() => store.connection === "up", 8000);
                                expect(up, `connection state was ${store.connection}`).toBe(true);
                                expect(sse.auths[0]).toBe(`Bearer ${TOK}`);
                        } finally {
                                store.stop();
                        }
                } finally {
                        sse.stop();
                }
        }, 15_000);

        test("typed 401 surfaces as the EngineHttpError contract (degraded UX, not a crash)", async () => {
                process.env.UNOWN_ENGINE_TOKEN = "wrong-pinned-token";
                invalidateEngineToken();
                const client = new EngineClient(gate.url, 3000);
                try {
                        await client.get<MemoryResponse>("/api/memory");
                        expect.unreachable();
                } catch (e) {
                        // The store's M6 contract: typed errors with status, so screens can
                        // render the engine-down banner instead of dying.
                        expect((e as { status?: number }).status).toBe(401);
                        expect((e as Error).message).toContain("401");
                }
        });
});
