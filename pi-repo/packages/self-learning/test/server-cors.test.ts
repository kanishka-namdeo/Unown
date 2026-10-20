// Unit tests for the engine's CORS layer (src/server.ts): allowedCorsOrigin
// policy + the full fetch-handler composition (preflight, /api/* JSON, SSE
// stream, root banner) against a Bun.serve listener on an ephemeral port.
//
// Pattern: fetch-against-listener (same as server-webcache.test.ts) — the
// listener mirrors src/server.ts's real fetch handler *including the CORS
// wiring*, so the tests exercise exactly what the engine serves: OPTIONS
// short-circuit, withCors re-wrapping of JSON/plain/SSE responses, and the
// Vary: Origin header. Direct allowedCorsOrigin() unit tests cover every
// UNOWN_ENGINE_CORS mode (default loopback allow-list, explicit list, *,
// off) with the env save/restore pattern from test/webcache.test.ts.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { allowedCorsOrigin, apiRequestBody, corsHeadersFor, handleApi, withCors } from "../src/server.ts";

// ---------------------------------------------------------------------------
// Env save/restore — UNOWN_ENGINE_CORS is read at request time
// ---------------------------------------------------------------------------
const SAVED_CORS = process.env.UNOWN_ENGINE_CORS;
afterAll(() => {
        if (SAVED_CORS === undefined) delete process.env.UNOWN_ENGINE_CORS;
        else process.env.UNOWN_ENGINE_CORS = SAVED_CORS;
});

function reqWithOrigin(origin: string | null): Request {
        return new Request("http://127.0.0.1:3030/api/overview", origin ? { headers: { origin } } : {});
}

// ---------------------------------------------------------------------------
// allowedCorsOrigin — the policy table
// ---------------------------------------------------------------------------
describe("allowedCorsOrigin (UNOWN_ENGINE_CORS policy)", () => {
        test("no Origin header (curl/CLI/bridge) → null, no CORS headers anywhere", () => {
                delete process.env.UNOWN_ENGINE_CORS;
                expect(allowedCorsOrigin(reqWithOrigin(null))).toBe(null);
                expect(corsHeadersFor(null)).toEqual({});
        });

        test("default: loopback origins allowed on any port", () => {
                delete process.env.UNOWN_ENGINE_CORS;
                expect(allowedCorsOrigin(reqWithOrigin("http://localhost:3000"))).toBe("http://localhost:3000");
                expect(allowedCorsOrigin(reqWithOrigin("http://127.0.0.1:3210"))).toBe("http://127.0.0.1:3210");
                expect(allowedCorsOrigin(reqWithOrigin("http://localhost:5173"))).toBe("http://localhost:5173");
        });

        test("default: non-loopback origins are refused (no CSRF from arbitrary websites)", () => {
                delete process.env.UNOWN_ENGINE_CORS;
                expect(allowedCorsOrigin(reqWithOrigin("https://evil.example.com"))).toBe(null);
                expect(allowedCorsOrigin(reqWithOrigin("http://192.168.1.5:3000"))).toBe(null);
                expect(allowedCorsOrigin(reqWithOrigin("https://localhost.evil.com"))).toBe(null);
        });

        test("default: non-http schemes and garbage origins are refused", () => {
                delete process.env.UNOWN_ENGINE_CORS;
                expect(allowedCorsOrigin(reqWithOrigin("chrome-extension://abc"))).toBe(null);
                expect(allowedCorsOrigin(reqWithOrigin("null"))).toBe(null);
                expect(allowedCorsOrigin(reqWithOrigin("not a url"))).toBe(null);
        });

        test("explicit allow-list: matching origin reflected, others refused", () => {
                process.env.UNOWN_ENGINE_CORS = "https://dash.example.com, https://other.example.com";
                expect(allowedCorsOrigin(reqWithOrigin("https://dash.example.com"))).toBe("https://dash.example.com");
                expect(allowedCorsOrigin(reqWithOrigin("https://other.example.com/"))).toBe("https://other.example.com/");
                expect(allowedCorsOrigin(reqWithOrigin("https://evil.example.com"))).toBe(null);
                expect(allowedCorsOrigin(reqWithOrigin("http://localhost:3000"))).toBe(null); // explicit list replaces the default
        });

        test("wildcard mode reflects * (deliberate, next to UNOWN_ENGINE_HOST)", () => {
                process.env.UNOWN_ENGINE_CORS = "*";
                expect(allowedCorsOrigin(reqWithOrigin("https://anything.example.net"))).toBe("*");
        });

        test("off mode disables CORS entirely (pre-2.3 behaviour)", () => {
                process.env.UNOWN_ENGINE_CORS = "off";
                expect(allowedCorsOrigin(reqWithOrigin("http://localhost:3000"))).toBe(null);
                delete process.env.UNOWN_ENGINE_CORS; // restore for the composition suite below
        });
});

// ---------------------------------------------------------------------------
// withCors — response re-wrapping
// ---------------------------------------------------------------------------
describe("withCors (response re-wrap)", () => {
        test("adds the header set for an allowed origin, preserves body + status + content-type", async () => {
                const inner = new Response('{"ok":true}', {
                        status: 200,
                        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
                });
                const res = withCors(inner, "http://localhost:3000");
                expect(res.status).toBe(200);
                expect(res.headers.get("content-type")).toBe("application/json");
                expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
                expect(res.headers.get("vary")).toBe("Origin");
                expect(await res.text()).toBe('{"ok":true}');
        });

        test("no origin → same response object back", () => {
                const inner = new Response("x");
                expect(withCors(inner, null)).toBe(inner);
        });
});

// ---------------------------------------------------------------------------
// Fetch-handler composition — what the engine actually serves
// ---------------------------------------------------------------------------
let server: { port: number; stop: (stopActiveConnections?: boolean) => void };

beforeAll(() => {
        delete process.env.UNOWN_ENGINE_CORS;
        // Mirrors src/server.ts's fetch handler composition (CORS wiring included)
        server = Bun.serve({
                port: 0,
                async fetch(req) {
                        const url = new URL(req.url);
                        const corsOrigin = allowedCorsOrigin(req);
                        if (req.method === "OPTIONS") {
                                return new Response(null, { status: 204, headers: corsHeadersFor(corsOrigin) });
                        }
                        if (req.method === "GET" && url.pathname === "/api/events") {
                                // like the real stream: hello first, then open
                                const stream = new ReadableStream({
                                        start(controller) {
                                                controller.enqueue(new TextEncoder().encode(`data: {"event":"hello"}\n\n`));
                                        },
                                });
                                return withCors(
                                        new Response(stream, {
                                                headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
                                        }),
                                        corsOrigin,
                                );
                        }
                        if (url.pathname.startsWith("/api/")) {
                                return withCors(
                                        await handleApi({ method: req.method, path: url.pathname, query: url.searchParams, body: await apiRequestBody(req) }),
                                        corsOrigin,
                                );
                        }
                        return withCors(new Response("pi self-learning agent service\n", { status: 200, headers: { "Content-Type": "text/plain" } }), corsOrigin);
                },
        });
});

afterAll(() => {
        server?.stop(true);
});

describe("engine fetch handler CORS composition", () => {
        test("OPTIONS preflight from an allowed origin → 204 with allow headers", async () => {
                const res = await fetch(`http://127.0.0.1:${server.port}/api/overview`, {
                        method: "OPTIONS",
                        headers: { origin: "http://localhost:3000", "access-control-request-method": "GET" },
                });
                expect(res.status).toBe(204);
                expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
                expect(res.headers.get("access-control-allow-methods")).toContain("GET");
        });

        test("OPTIONS preflight from a foreign origin → 204 but NO allow-origin header", async () => {
                const res = await fetch(`http://127.0.0.1:${server.port}/api/overview`, {
                        method: "OPTIONS",
                        headers: { origin: "https://evil.example.com" },
                });
                expect(res.status).toBe(204);
                expect(res.headers.get("access-control-allow-origin")).toBe(null);
        });

        test("GET /api/* with allowed Origin → JSON body + CORS headers", async () => {
                const res = await fetch(`http://127.0.0.1:${server.port}/api/overview`, { headers: { origin: "http://localhost:3000" } });
                expect(res.status).toBe(200);
                expect(res.headers.get("content-type")).toContain("application/json");
                expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
                const body = (await res.json()) as Record<string, any>;
                expect(body.ok).toBe(true);
        });

        test("GET /api/* with foreign Origin → body still served (curl-equivalent) but no CORS grant", async () => {
                const res = await fetch(`http://127.0.0.1:${server.port}/api/overview`, { headers: { origin: "https://evil.example.com" } });
                expect(res.status).toBe(200);
                expect(res.headers.get("access-control-allow-origin")).toBe(null);
        });

        test("GET /api/events with allowed Origin → SSE content-type + CORS (stream passes through)", async () => {
                const res = await fetch(`http://127.0.0.1:${server.port}/api/events`, { headers: { origin: "http://127.0.0.1:3210" } });
                expect(res.status).toBe(200);
                expect(res.headers.get("content-type")).toBe("text/event-stream");
                expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:3210");
                const reader = res.body!.getReader();
                const { value } = await reader.read();
                expect(new TextDecoder().decode(value)).toContain("hello");
                reader.cancel(); // release the stream
        });

        test("root banner with allowed Origin → CORS on the plain-text response", async () => {
                const res = await fetch(`http://127.0.0.1:${server.port}/`, { headers: { origin: "http://localhost:3000" } });
                expect(res.status).toBe(200);
                expect(res.headers.get("content-type")).toBe("text/plain");
                expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
        });

        test("UNOWN_ENGINE_CORS=off → no CORS headers even for localhost", async () => {
                process.env.UNOWN_ENGINE_CORS = "off";
                try {
                        const res = await fetch(`http://127.0.0.1:${server.port}/api/overview`, { headers: { origin: "http://localhost:3000" } });
                        expect(res.status).toBe(200);
                        expect(res.headers.get("access-control-allow-origin")).toBe(null);
                } finally {
                        delete process.env.UNOWN_ENGINE_CORS; // restore for afterAll
                }
        });
});
