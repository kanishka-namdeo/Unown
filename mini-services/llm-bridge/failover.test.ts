// Serving-layer FAILOVER tests for mini-services/llm-bridge/index.ts.
//
// The bridge Bun.serve()s at module scope, so it cannot be imported
// in-process more than once — this suite spawns the REAL index.ts as a
// subprocess (BRIDGE_PORT=0 → OS-assigned ephemeral port, parsed from the
// startup line on stdout) against two in-process mock upstreams (real
// Bun.serve on port 0 — the repo's house pattern, cf. test/cli/helpers.ts
// startMockBridge; never fetch monkey-patching). Everything stays on the
// loopback: hermetic, offline, CI-safe.
//
// Scenario matrix (each maps to a production failure class):
//   1. primary 429 quota-throttle (Dashscope's live shape)  → failover, model rewritten
//   2. primary plain 400 schema error                        → NO failover (fallback would fail too)
//   3. primary 401 rejected key                              → failover (a dead key IS "primary down")
//   3b. primary unreachable (connection refused)             → failover (network class)
//   4. streaming: primary 429                                 → fallback SSE pipes through verbatim
//   5. fallback down too (400)                                → the fallback's error surfaces honestly
//   6. NO fallback configured                                 → primary failures propagate as before
//   7. /health exposes the fallback lane + failover counter
//   8. /v1/log marks failover-served requests with the fb: prefix

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock upstreams
// ---------------------------------------------------------------------------

interface MockChatRequest {
        path: string;
        model?: string;
        auth: string | null;
        stream?: boolean;
}

interface MockUpstreamState {
        requests: MockChatRequest[];
        chatStatus: number;
        chatBody: any;
        modelsStatus: number;
        sse: boolean;
}

function startMockUpstream(): { url: string; state: MockUpstreamState; stop: () => void } {
        const state: MockUpstreamState = { requests: [], chatStatus: 200, chatBody: {}, modelsStatus: 200, sse: false };
        const server = Bun.serve({
                port: 0, // OS-assigned ephemeral port — never the live bridge's 3031
                async fetch(req) {
                        const url = new URL(req.url);
                        if (req.method === "GET" && url.pathname === "/models") {
                                state.requests.push({ path: "/models", auth: req.headers.get("authorization") });
                                return Response.json({ object: "list", data: [] }, { status: state.modelsStatus });
                        }
                        if (req.method === "POST" && url.pathname === "/chat/completions") {
                                const body = await req.json().catch(() => ({}));
                                state.requests.push({
                                        path: "/chat/completions",
                                        model: String(body.model ?? "?"),
                                        auth: req.headers.get("authorization"),
                                        stream: body.stream === true,
                                });
                                if (state.chatStatus !== 200) {
                                        return Response.json(state.chatBody, { status: state.chatStatus });
                                }
                                if (state.sse) {
                                        const enc = new TextEncoder();
                                        const frame = (obj: any) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);
                                        const stream = new ReadableStream({
                                                start(c) {
                                                        c.enqueue(frame({ id: "fb-chatcmpl-1", model: body.model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
                                                        c.enqueue(frame({ id: "fb-chatcmpl-1", model: body.model, choices: [{ index: 0, delta: { content: "FALLBACK-STREAM-OK" }, finish_reason: null }] }));
                                                        c.enqueue(frame({ id: "fb-chatcmpl-1", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }));
                                                        c.enqueue(enc.encode("data: [DONE]\n\n"));
                                                        c.close();
                                                },
                                        });
                                        return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
                                }
                                return Response.json({
                                        id: "fb-chatcmpl-1",
                                        object: "chat.completion",
                                        model: body.model,
                                        choices: [{ index: 0, message: { role: "assistant", content: "FALLBACK-SAYS-OK" }, finish_reason: "stop" }],
                                        usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
                                });
                        }
                        return Response.json({ error: { message: `Not found: ${req.method} ${url.pathname}` } }, { status: 404 });
                },
        });
        return { url: `http://127.0.0.1:${server.port}`, state, stop: () => server.stop(true) };
}

// ---------------------------------------------------------------------------
// Real bridge as a subprocess
// ---------------------------------------------------------------------------

interface BridgeProc {
        proc: Bun.Subprocess<"ignore", "pipe", "inherit">;
        url: string;
        stdoutText: () => string;
}

function spawnBridge(extraEnv: Record<string, string>): BridgeProc {
        // Hermetic env: strip everything bridge-related from the parent (the
        // repo's helpers.ts runUnown pattern) so the ONLY configuration the
        // spawned bridge sees is what this test passes explicitly.
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
                if (v === undefined) continue;
                if (/^(BRIDGE_|UNOWN_|PI_)/.test(k)) continue;
                clean[k] = v;
        }
        const proc = Bun.spawn(["bun", "index.ts"], {
                cwd: import.meta.dir,
                env: {
                        ...clean,
                        BRIDGE_PORT: "0", // OS-assigned ephemeral port
                        BRIDGE_MODEL: "kimi-k2.5",
                        BRIDGE_ROUTE_DEFAULT: "kimi-k2.5",
                        BRIDGE_KNOWN_MODELS: "kimi-k2.5,qwen3.7-plus,qwen3.6-plus",
                        BRIDGE_UPSTREAM_TIMEOUT_MS: "8000",
                        BRIDGE_MIN_SPACING_MS: "1", // tests must not wait on the serialized throttle
                        ...extraEnv,
                },
                stdout: "pipe",
                stderr: "inherit",
        });
        const chunks: string[] = [];
        const decoder = new TextDecoder();
        (async () => {
                // @ts-ignore - Bun exposes stdout as an async iterable of chunks
                for await (const chunk of proc.stdout) {
                        chunks.push(decoder.decode(chunk, { stream: true }));
                }
        })().catch(() => {});
        return {
                proc,
                url: "", // filled by waitForReady
                stdoutText: () => chunks.join(""),
        };
}

async function waitForReady(b: BridgeProc, timeoutMs = 30_000): Promise<string> {
        const re = /listening on http:\/\/127\.0\.0\.1:(\d+)/;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
                const m = b.stdoutText().match(re);
                if (m) return `http://127.0.0.1:${m[1]}`;
                await Bun.sleep(50);
        }
        throw new Error(`bridge subprocess did not print its listening line within ${timeoutMs}ms; stdout so far: ${b.stdoutText().slice(0, 800)}`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let primary: ReturnType<typeof startMockUpstream>;
let fallback: ReturnType<typeof startMockUpstream>;
let bridge: BridgeProc; // primary + fallback configured
let noFallback: BridgeProc; // fallback OFF — backward compatibility
let deadPrimary: BridgeProc; // unreachable primary + fallback — network class

const CHAT = (url: string, body: any) =>
        fetch(`${url}/v1/chat/completions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
        });

const chatRequests = (u: ReturnType<typeof startMockUpstream>) => u.state.requests.filter((r) => r.path === "/chat/completions");

beforeAll(async () => {
        const stateDir = mkdtempSync(join(tmpdir(), "unown-bridge-failover-"));

        primary = startMockUpstream();
        // Dashscope's live quota-throttle shape (measured 2026-10-20):
        // HTTP 429, {"error":{"code":"throttling","message":"hour allocated quota exceeded."}}
        primary.state.chatStatus = 429;
        primary.state.chatBody = { error: { code: "throttling", message: "hour allocated quota exceeded.", type: "invalid_request_error" } };

        fallback = startMockUpstream();

        const b = spawnBridge({
                BRIDGE_UPSTREAM_URL: primary.url,
                BRIDGE_UPSTREAM_KEY: "test-primary-key",
                BRIDGE_FALLBACK_URL: fallback.url,
                BRIDGE_FALLBACK_KEY: "test-fallback-key",
                BRIDGE_FALLBACK_MODEL: "agnes-3.0-flash",
                UNOWN_BRIDGE_STATE_DIR: stateDir,
        });
        bridge = b;
        bridge.url = await waitForReady(b);

        const nf = spawnBridge({
                BRIDGE_UPSTREAM_URL: primary.url,
                BRIDGE_UPSTREAM_KEY: "test-primary-key",
                UNOWN_BRIDGE_STATE_DIR: stateDir,
        });
        noFallback = nf;
        noFallback.url = await waitForReady(nf);

        const dp = spawnBridge({
                BRIDGE_UPSTREAM_URL: "http://127.0.0.1:1", // nothing listens on port 1 — connection refused
                BRIDGE_UPSTREAM_KEY: "test-primary-key",
                BRIDGE_FALLBACK_URL: fallback.url,
                BRIDGE_FALLBACK_KEY: "test-fallback-key",
                BRIDGE_FALLBACK_MODEL: "agnes-3.0-flash",
                UNOWN_BRIDGE_STATE_DIR: stateDir,
        });
        deadPrimary = dp;
        deadPrimary.url = await waitForReady(dp);
});

afterAll(() => {
        for (const b of [bridge, noFallback, deadPrimary]) {
                try {
                        b.proc.kill();
                } catch {
                        /* already gone */
                }
        }
        primary.stop();
        fallback.stop();
});

// ---------------------------------------------------------------------------
// The failover contract
// ---------------------------------------------------------------------------

describe("llm-bridge failover (serving layer)", () => {
        test("primary 429 quota-throttle: request is served by the fallback, model rewritten, keys swapped", async () => {
                const res = await CHAT(bridge.url, { model: "kimi-k2.5", messages: [{ role: "user", content: "Reply with exactly: OK" }] });
                expect(res.status).toBe(200);
                const completion = await res.json();
                expect(completion.choices[0].message.content).toBe("FALLBACK-SAYS-OK");
                // The PRIMARY saw the original model id + the primary key…
                const lastPrimary = chatRequests(primary).at(-1);
                expect(lastPrimary?.model).toBe("kimi-k2.5");
                expect(lastPrimary?.auth).toBe("Bearer test-primary-key");
                // …the FALLBACK saw the rewritten model id + ITS OWN key.
                const lastFallback = chatRequests(fallback).at(-1);
                expect(lastFallback?.model).toBe("agnes-3.0-flash");
                expect(lastFallback?.auth).toBe("Bearer test-fallback-key");
                // Exactly one primary attempt (the short-circuit: no 6x backoff burn).
                const primaryAttempts = chatRequests(primary).length;
                await CHAT(bridge.url, { model: "kimi-k2.5", messages: [{ role: "user", content: "again" }] });
                expect(chatRequests(primary).length).toBe(primaryAttempts + 1);
        });

        test("primary plain 400 (schema error): NO failover — the fallback would fail the same way", async () => {
                primary.state.chatStatus = 400;
                primary.state.chatBody = { error: { message: "invalid parameter: temperature must be a number", type: "invalid_request_error" } };
                const fallbackBefore = chatRequests(fallback).length;
                const res = await CHAT(bridge.url, { model: "kimi-k2.5", messages: [{ role: "user", content: "boom" }] });
                expect(res.status).toBe(400);
                const err = await res.json();
                expect(String(err.error?.message)).toContain("llm-bridge:");
                expect(chatRequests(fallback).length).toBe(fallbackBefore); // fallback untouched
                // restore the throttle shape for later tests
                primary.state.chatStatus = 429;
                primary.state.chatBody = { error: { code: "throttling", message: "hour allocated quota exceeded.", type: "invalid_request_error" } };
        });

        test("primary 401 (rejected key): failover — a dead key IS 'primary not working'", async () => {
                primary.state.chatStatus = 401;
                primary.state.chatBody = { error: { message: "Invalid API key provided", type: "authentication_error" } };
                const res = await CHAT(bridge.url, { model: "qwen3.7-plus", messages: [{ role: "user", content: "hi" }] });
                expect(res.status).toBe(200);
                const completion = await res.json();
                expect(completion.choices[0].message.content).toBe("FALLBACK-SAYS-OK");
                expect(chatRequests(fallback).at(-1)?.model).toBe("agnes-3.0-flash");
                primary.state.chatStatus = 429;
                primary.state.chatBody = { error: { code: "throttling", message: "hour allocated quota exceeded.", type: "invalid_request_error" } };
        });

        test("primary unreachable (connection refused): failover on the network class", async () => {
                const res = await CHAT(deadPrimary.url, { model: "kimi-k2.5", messages: [{ role: "user", content: "anyone there?" }] });
                expect(res.status).toBe(200);
                const completion = await res.json();
                expect(completion.choices[0].message.content).toBe("FALLBACK-SAYS-OK");
        });

        test("streaming: primary 429 → the fallback's SSE stream pipes through verbatim", async () => {
                fallback.state.sse = true;
                const res = await CHAT(bridge.url, { model: "kimi-k2.5", stream: true, messages: [{ role: "user", content: "stream me" }] });
                expect(res.status).toBe(200);
                expect(res.headers.get("content-type")).toContain("text/event-stream");
                const text = await res.text();
                expect(text).toContain("FALLBACK-STREAM-OK");
                expect(text).toContain("data: [DONE]");
                expect(chatRequests(fallback).at(-1)?.stream).toBe(true);
                fallback.state.sse = false;
        });

        test("fallback down too: its error surfaces honestly (no silent success)", async () => {
                fallback.state.chatStatus = 400;
                fallback.state.chatBody = { error: { message: "fallback is also broken", type: "invalid_request_error" } };
                const res = await CHAT(bridge.url, { model: "kimi-k2.5", messages: [{ role: "user", content: "double trouble" }] });
                expect(res.status).toBe(400);
                const err = await res.json();
                expect(String(err.error?.message)).toContain("fallback is also broken");
                fallback.state.chatStatus = 200;
        });

        test("NO fallback configured: primary failures propagate exactly as before (backward compat)", async () => {
                primary.state.chatStatus = 401; // non-retryable: propagates immediately (429 would burn the retry backoff)
                primary.state.chatBody = { error: { message: "Invalid API key provided", type: "authentication_error" } };
                const res = await CHAT(noFallback.url, { model: "kimi-k2.5", messages: [{ role: "user", content: "legacy" }] });
                expect(res.status).toBe(401);
                const err = await res.json();
                expect(String(err.error?.message)).toContain("Invalid API key");
                primary.state.chatStatus = 429;
                primary.state.chatBody = { error: { code: "throttling", message: "hour allocated quota exceeded.", type: "invalid_request_error" } };
        });

        test("/health exposes the fallback lane + the failover counter", async () => {
                // Primary's /models answers 200 by default — the chat lane is
                // throttled but the probe is about reachability. Flip it to
                // prove the health story: primary DOWN, fallback UP, serving.
                primary.state.modelsStatus = 503;
                try {
                        const res = await fetch(`${bridge.url}/health`);
                        expect(res.status).toBe(200);
                        const h = await res.json();
                        expect(h.upstream?.ok).toBe(false);
                        expect(h.fallback?.ok).toBe(true);
                        expect(h.fallback?.url).toBe(fallback.url);
                        expect(h.fallback?.model).toBe("agnes-3.0-flash");
                        expect(typeof h.failovers).toBe("number");
                        expect(h.failovers).toBeGreaterThanOrEqual(2); // 429 + 401 + network + streaming cases
                } finally {
                        primary.state.modelsStatus = 200;
                }
        });

        test("/v1/log marks failover-served requests with the fb: upstream prefix", async () => {
                const res = await fetch(`${bridge.url}/v1/log`);
                expect(res.status).toBe(200);
                const body = await res.json();
                const fbEntries = body.log.filter((e: any) => String(e.upstreamModel ?? "").startsWith("fb:"));
                expect(fbEntries.length).toBeGreaterThanOrEqual(1);
                expect(fbEntries.some((e: any) => e.upstreamModel === "fb:agnes-3.0-flash")).toBe(true);
                // And at least one of them settled with real stats from the fallback.
                expect(fbEntries.some((e: any) => e.contentChars > 0)).toBe(true);
        });
});
