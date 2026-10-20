// server-providers.test.ts — the engine's /api/providers surface (M4).
//
// Pattern: fetch-against-listener (server-webcache.test.ts) — the REAL
// handleApi + apiRequestBody + the real CORS composition, over real HTTP,
// with the user agent dir redirected to a per-test temp UNOWN_HOME via the
// env save/restore convention. Every mutation goes through the SAME
// providers.ts code the CLI uses, so this suite pins the dashboard contract
// (status codes, shapes, health, presets) without booting the engine.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowedCorsOrigin, apiRequestBody, corsHeadersFor, handleApi, withCors } from "../src/server.ts";

const SAVED_UNOWN_HOME = process.env.UNOWN_HOME;
let HOME = "";
let server: { port: number; stop: (stopActiveConnections?: boolean) => void };

beforeAll(() => {
        HOME = mkdtempSync(join(tmpdir(), "unown-providers-api-"));
        process.env.UNOWN_HOME = HOME;
        server = Bun.serve({
                port: 0,
                async fetch(req) {
                        const url = new URL(req.url);
                        const corsOrigin = allowedCorsOrigin(req);
                        if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeadersFor(corsOrigin) });
                        if (url.pathname.startsWith("/api/")) {
                                return withCors(
                                        await handleApi({ method: req.method, path: url.pathname, query: url.searchParams, body: await apiRequestBody(req) }),
                                        corsOrigin,
                                );
                        }
                        return new Response("not found", { status: 404 });
                },
        });
});

afterAll(() => {
        server?.stop(true);
        rmSync(HOME, { recursive: true, force: true });
        if (SAVED_UNOWN_HOME === undefined) delete process.env.UNOWN_HOME;
        else process.env.UNOWN_HOME = SAVED_UNOWN_HOME;
});

const base = () => `http://127.0.0.1:${server.port}`;

/** Mock provider endpoint for add/test verification (OpenAI-compatible /models). */
function mockProvider(models: string[]): { url: string; stop: () => void } {
        const s = Bun.serve({
                port: 0,
                fetch() {
                        return Response.json({ data: models.map((id) => ({ id })) });
                },
        });
        return { url: `http://127.0.0.1:${s.port}/v1`, stop: () => s.stop(true) };
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
        const res = await fetch(`${base()}${path}`, {
                method,
                headers: body !== undefined ? { "content-type": "application/json" } : undefined,
                body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, json: await res.json().catch(() => null) };
}

describe("GET /api/providers — the registry view", () => {
        test("empty registry: ok, empty list, presets + engine block present", async () => {
                const { status, json } = await call("GET", "/api/providers");
                expect(status).toBe(200);
                expect(json.ok).toBe(true);
                expect(json.providers).toEqual([]);
                expect(json.engine).toMatchObject({ provider: expect.any(String), model: expect.any(String) });
                const presetIds = json.presets.map((p: any) => p.id);
                expect(presetIds).toContain("openai");
                expect(presetIds).toContain("agnes");
                expect(presetIds).toContain("custom");
        });

        test("populated registry: providers with keyLabel + health + default flags", async () => {
                const mock = mockProvider(["m-1", "m-2"]);
                try {
                        const add = await call("POST", "/api/providers", { preset: "openai", baseUrl: mock.url, apiKey: "sk-1", model: "m-1" });
                        expect(add.status).toBe(200);

                        const { json } = await call("GET", "/api/providers");
                        expect(json.providers).toHaveLength(1);
                        const p = json.providers[0];
                        expect(p.id).toBe("openai");
                        expect(p.baseUrl).toBe(mock.url);
                        expect(p.keyLabel).toBe("key: auth.json");
                        expect(p.isDefault).toBe(true);
                        expect(p.health.ok).toBe(true);
                        expect(json.defaultProvider).toBe("openai");
                        expect(json.defaultModel).toBe("m-1");
                } finally {
                        mock.stop();
                }
        });
});

describe("POST /api/providers — add over HTTP", () => {
        test("unknown preset → 400; bad id → 400; apiKey+keyEnv conflict → 400", async () => {
                const unknown = await call("POST", "/api/providers", { preset: "nope", model: "m" });
                expect(unknown.status).toBe(400);
                expect(unknown.json.error).toContain("unknown preset");

                const badId = await call("POST", "/api/providers", { preset: "openai", id: "Bad_Id", model: "m" });
                expect(badId.status).toBe(400);

                const conflict = await call("POST", "/api/providers", { preset: "openai", apiKey: "k", keyEnv: "V", model: "m" });
                expect(conflict.status).toBe(400);
        });

        test("add writes the registry (accumulate) and returns the live probe", async () => {
                const mock = mockProvider(["m-1"]);
                try {
                        const add = await call("POST", "/api/providers", { preset: "openai", baseUrl: mock.url, apiKey: "sk-1", model: "m-1" });
                        expect(add.status).toBe(200);
                        expect(add.json.ok).toBe(true);
                        expect(add.json.provider).toBe("openai");
                        expect(add.json.probe.ok).toBe(true);

                        // A SECOND provider accumulates (the registry contract).
                        const second = await call("POST", "/api/providers", { preset: "deepseek", baseUrl: mock.url, apiKey: "sk-2", model: "d-1" });
                        expect(second.status).toBe(200);
                        const { json } = await call("GET", "/api/providers");
                        expect(json.providers.map((p: any) => p.id).sort()).toEqual(["deepseek", "openai"]);
                } finally {
                        mock.stop();
                }
        });

        test("allModels: true imports the endpoint's served catalog", async () => {
                const mock = mockProvider(["m-1", "m-2", "m-3"]);
                try {
                        const add = await call("POST", "/api/providers", { preset: "openai", baseUrl: mock.url, apiKey: "sk-1", model: "m-1", allModels: true });
                        expect(add.status).toBe(200);
                        const { json } = await call("GET", "/api/providers");
                        const ids = json.providers[0].modelIds;
                        expect(ids.sort()).toEqual(["m-1", "m-2", "m-3"]);
                } finally {
                        mock.stop();
                }
        });
});

describe("provider subresources — key / default / test / refresh / remove", () => {
        test("full management lifecycle over HTTP", async () => {
                const mock = mockProvider(["m-1", "m-2"]);
                try {
                        await call("POST", "/api/providers", { preset: "openai", baseUrl: mock.url, apiKey: "sk-1", model: "m-1" });
                        await call("POST", "/api/providers", { preset: "deepseek", baseUrl: mock.url, apiKey: "sk-2", model: "d-1" });

                        // key rotation with live verification
                        const key = await call("POST", "/api/providers/openai/key", { apiKey: "sk-rotated" });
                        expect(key.status).toBe(200);
                        expect(key.json.probe.ok).toBe(true);

                        // key without apiKey → 400
                        const noKey = await call("POST", "/api/providers/openai/key", {});
                        expect(noKey.status).toBe(400);

                        // default switch (validated)
                        const badDefault = await call("POST", "/api/providers/openai/default", { model: "no-such" });
                        expect(badDefault.status).toBe(400);
                        const goodDefault = await call("POST", "/api/providers/deepseek/default", { model: "d-1" });
                        expect(goodDefault.status).toBe(200);
                        const { json } = await call("GET", "/api/providers");
                        expect(json.defaultProvider).toBe("deepseek");

                        // test endpoint
                        const test = await call("GET", "/api/providers/openai/test");
                        expect(test.status).toBe(200);
                        expect(test.json.probe.ok).toBe(true);
                        expect(test.json.keySource).toBe("auth-json");

                        // refresh imports the newly-served m-2
                        const refresh = await call("POST", "/api/providers/openai/refresh", {});
                        expect(refresh.status).toBe(200);
                        expect(refresh.json.added).toEqual(["m-2"]);

                        // remove → 404 on the second attempt; default falls back
                        const remove = await call("DELETE", "/api/providers/deepseek");
                        expect(remove.status).toBe(200);
                        expect(remove.json.defaultFellBack).toBe(true);
                        const removedAgain = await call("DELETE", "/api/providers/deepseek");
                        expect(removedAgain.status).toBe(404);
                        const after = await call("GET", "/api/providers/openai/test");
                        expect(after.status).toBe(200);
                } finally {
                        mock.stop();
                }
        });

        test("unknown provider subresources → 404 with the error shape", async () => {
                const key = await call("POST", "/api/providers/ghost/key", { apiKey: "k" });
                expect(key.status).toBe(404);
                const test = await call("GET", "/api/providers/ghost/test");
                expect(test.status).toBe(404);
                const remove = await call("DELETE", "/api/providers/ghost");
                expect(remove.status).toBe(404);
                const refresh = await call("POST", "/api/providers/ghost/refresh", {});
                expect(refresh.status).toBe(404);
        });

        test("unknown subresource action → 404", async () => {
                const res = await call("POST", "/api/providers/openai/frobnicate", {});
                expect(res.status).toBe(404);
                expect(res.json.error).toContain("unknown providers route");
        });
});
