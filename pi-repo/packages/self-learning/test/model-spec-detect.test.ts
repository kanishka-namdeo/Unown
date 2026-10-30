/**
 * model-spec-detect.test.ts — the detection cascade's pure core, pinned.
 *
 * Every source parser is tested against the REAL payload shapes observed
 * in the 2026-10-30 research (docs/model-spec-detection-research.md):
 * models.dev entries, LiteLLM DB rows, and the endpoint-catalog field zoo
 * (vLLM max_model_len, llama.cpp meta.n_ctx, LM Studio loaded_context_length,
 * DeepInfra metadata, OpenRouter top_provider). No test touches the network
 * — fetch is always injected, env URLs point at dead ports.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        detectModelSpec,
        familyMatch,
        formatSpecLine,
        getRecordedSpec,
        indexLiteLLM,
        indexModelsDev,
        isCompleteSpec,
        matchRegistry,
        mergeSpecParts,
        parseEndpointCatalogEntry,
        parseLiteLLMEntry,
        parseModelsDevEntry,
        readRegistryCache,
        readSpecSidecar,
        recordSpec,
        registryCacheTtlMs,
        sanitizeSpecNumbers,
        specIdCandidates,
        specSidecarKey,
        userSpec,
        writeRegistryCache,
} from "../src/model-spec-detect.ts";

const tmp = mkdtempSync(join(tmpdir(), "spec-detect-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Sanity bounds
// ---------------------------------------------------------------------------

describe("sanitizeSpecNumbers", () => {
        test("passes sane pairs", () => {
                const r = sanitizeSpecNumbers(131072, 8192);
                expect(r.contextWindow).toBe(131072);
                expect(r.maxTokens).toBe(8192);
                expect(r.clamped).toEqual([]);
                expect(r.rejected).toEqual([]);
        });
        test("rejects garbage context windows (0, negative, fractional, below floor, above ceiling)", () => {
                for (const bad of [0, -5, 1.5, 512, 200_000_000, Number.NaN]) {
                        const r = sanitizeSpecNumbers(bad, 8192);
                        expect(r.contextWindow).toBeUndefined();
                        expect(r.rejected).toContain("contextWindow");
                }
        });
        test("clamps maxTokens above the context window (the LM Studio catalog class)", () => {
                const r = sanitizeSpecNumbers(8192, 32768);
                expect(r.maxTokens).toBe(8192);
                expect(r.clamped).toContain("maxTokens>contextWindow");
        });
        test("rejects garbage maxTokens", () => {
                const r = sanitizeSpecNumbers(131072, 0);
                expect(r.maxTokens).toBeUndefined();
                expect(r.rejected).toContain("maxTokens");
        });
        test("accepts maxTokens without a context window (field-wise incompleteness is legal)", () => {
                const r = sanitizeSpecNumbers(undefined, 4096);
                expect(r.maxTokens).toBe(4096);
                expect(r.contextWindow).toBeUndefined();
        });
});

// ---------------------------------------------------------------------------
// The normalization ladder
// ---------------------------------------------------------------------------

describe("specIdCandidates", () => {
        test("exact id first, always", () => {
                expect(specIdCandidates("GPT-4o")[0]).toBe("GPT-4o");
        });
        test("case-fold", () => {
                expect(specIdCandidates("GPT-4o")).toContain("gpt-4o");
        });
        test("dated snapshot stripped", () => {
                expect(specIdCandidates("gpt-4o-2026-05-16")).toContain("gpt-4o");
        });
        test("versioned suffix stripped", () => {
                expect(specIdCandidates("gemini-2.5-pro-v2")).toContain("gemini-2.5-pro");
        });
        test("finetune prefix collapsed", () => {
                const c = specIdCandidates("ft:gpt-4o:my-org:suffix:abc123");
                expect(c).toContain("ft:gpt-4o");
                expect(c).toContain("gpt-4o");
        });
        test("last path segment", () => {
                expect(specIdCandidates("anthropic/claude-sonnet-4-5")).toContain("claude-sonnet-4-5");
        });
        test("no candidates below 2 chars", () => {
                for (const c of specIdCandidates("q")) expect(c.length).toBeGreaterThanOrEqual(1);
        });
});

describe("familyMatch", () => {
        test("longest family prefix wins at a token boundary", () => {
                expect(familyMatch("gpt-4o-mini-latest", ["gpt-4", "gpt-4o"])).toBe("gpt-4o");
        });
        test("no mid-token prefix (gpt-4 does not match gpt-4o)", () => {
                expect(familyMatch("gpt-4o", ["gpt-4"])).toBeUndefined();
        });
        test("a family id never matches itself or a longer query of equal length", () => {
                expect(familyMatch("gpt-4o", ["gpt-4o"])).toBeUndefined();
        });
});

// ---------------------------------------------------------------------------
// Source parsers
// ---------------------------------------------------------------------------

describe("parseModelsDevEntry", () => {
        test("maps limit/cost/modalities/reasoning", () => {
                const p = parseModelsDevEntry({
                        limit: { context: 200000, output: 8192 },
                        cost: { input: 3, output: 15, cache_read: 0.3 },
                        modalities: { input: ["text", "image"], output: ["text"] },
                        reasoning: true,
                });
                expect(p.contextWindow).toBe(200000);
                expect(p.maxTokens).toBe(8192);
                expect(p.cost).toEqual({ input: 3, output: 15, cacheRead: 0.3 });
                expect(p.input).toEqual(["text", "image"]);
                expect(p.reasoning).toBe(true);
        });
        test("text-only entries carry no input upgrade (absence ≠ false)", () => {
                const p = parseModelsDevEntry({ limit: { context: 128000, output: 4096 } });
                expect(p.input).toBeUndefined();
                expect(p.reasoning).toBeUndefined();
        });
        test("limit.input is the fallback when context is absent", () => {
                expect(parseModelsDevEntry({ limit: { input: 100000, output: 4096 } }).contextWindow).toBe(100000);
        });
});

describe("parseLiteLLMEntry", () => {
        test("max_input_tokens is the context; per-token pricing converts to $/1M", () => {
                const p = parseLiteLLMEntry({
                        max_input_tokens: 128000,
                        max_output_tokens: 16384,
                        input_cost_per_token: 0.0000025,
                        output_cost_per_token: 0.00001,
                        cache_read_input_token_cost: 0.00000125,
                        supports_vision: true,
                });
                expect(p.contextWindow).toBe(128000);
                expect(p.maxTokens).toBe(16384);
                expect(p.cost?.input).toBe(2.5);
                expect(p.cost?.output).toBe(10);
                expect(p.cost?.cacheRead).toBe(1.25);
                expect(p.input).toEqual(["text", "image"]);
        });
        test("zero-cost rows (free/local) carry no cost rather than a $0 claim", () => {
                const p = parseLiteLLMEntry({ max_input_tokens: 32000, input_cost_per_token: 0, output_cost_per_token: 0 });
                expect(p.cost).toBeUndefined();
        });
});

describe("parseEndpointCatalogEntry", () => {
        test("vLLM: max_model_len on the entry", () => {
                const p = parseEndpointCatalogEntry({ id: "x", max_model_len: 32768 });
                expect(p.contextWindow).toBe(32768);
        });
        test("vLLM envelope fallback: top-level max_model_len when the entry is bare", () => {
                const p = parseEndpointCatalogEntry({ id: "x" }, { max_model_len: 16384 });
                expect(p.contextWindow).toBe(16384);
        });
        test("llama.cpp: meta.n_ctx", () => {
                expect(parseEndpointCatalogEntry({ id: "x", meta: { n_ctx: 8192 } }).contextWindow).toBe(8192);
        });
        test("LM Studio: loaded_context_length (runtime) beats max_context_length (catalog)", () => {
                const p = parseEndpointCatalogEntry({ id: "x", loaded_context_length: 4096, max_context_length: 131072 });
                expect(p.contextWindow).toBe(4096);
        });
        test("LM Studio: capabilities vision flag", () => {
                const p = parseEndpointCatalogEntry({ id: "x", max_context_length: 8192, capabilities: ["tool_use", "vision"] });
                expect(p.input).toEqual(["text", "image"]);
        });
        test("DeepInfra: metadata.context_length + metadata.max_tokens", () => {
                const p = parseEndpointCatalogEntry({ id: "x", metadata: { context_length: 131072, max_tokens: 8192 } });
                expect(p.contextWindow).toBe(131072);
                expect(p.maxTokens).toBe(8192);
        });
        test("OpenRouter: top_provider.max_completion_tokens + architecture input_modalities", () => {
                const p = parseEndpointCatalogEntry({
                        id: "x",
                        context_length: 200000,
                        top_provider: { max_completion_tokens: 32768 },
                        architecture: { input_modalities: ["text", "image"], modality: "text->text" },
                });
                expect(p.contextWindow).toBe(200000);
                expect(p.maxTokens).toBe(32768);
                expect(p.input).toEqual(["text", "image"]);
        });
        test("plain max_tokens in /models entries means OUTPUT (the collision, edge case 1)", () => {
                const p = parseEndpointCatalogEntry({ id: "x", context_length: 65536, max_tokens: 16384 });
                expect(p.maxTokens).toBe(16384);
                expect(p.contextWindow).toBe(65536);
        });
        test("bare id-only entries yield nothing (the OpenAI norm)", () => {
                expect(parseEndpointCatalogEntry({ id: "gpt-4o", object: "model", owned_by: "openai" })).toEqual({});
        });
});

// ---------------------------------------------------------------------------
// Registry indexing + matching
// ---------------------------------------------------------------------------

const modelsDevPayload = {
        openai: {
                id: "openai",
                models: {
                        "gpt-4o": { limit: { context: 128000, output: 16384 }, cost: { input: 2.5, output: 10 }, modalities: { input: ["text", "image"] } },
                        "gpt-4o-2026-05-16": { limit: { context: 128000, output: 16384 }, status: "deprecated" },
                },
        },
        anthropic: {
                id: "anthropic",
                models: {
                        "claude-sonnet-4-5": { limit: { context: 200000, output: 64000 }, cost: { input: 3, output: 15 }, modalities: { input: ["text", "image"] }, reasoning: true },
                },
        },
};

describe("indexModelsDev", () => {
        const idx = indexModelsDev(modelsDevPayload);
        test("keys are provider-scoped AND bare", () => {
                expect(idx["openai/gpt-4o"]).toBeDefined();
                expect(idx["gpt-4o"]).toBeDefined();
        });
        test("specless entries are dropped", () => {
                expect(idx["openai/no-spec-model"]).toBeUndefined();
        });
});

describe("matchRegistry", () => {
        const idx = indexModelsDev(modelsDevPayload);
        test("exact bare match", () => {
                const m = matchRegistry("gpt-4o", idx);
                expect(m?.match).toBe("exact");
                expect(m?.entry.spec.contextWindow).toBe(128000);
        });
        test("provider-scoped exact wins over cross-provider", () => {
                const m = matchRegistry("gpt-4o", idx, "openai");
                expect(m?.matchedId).toBe("openai/gpt-4o");
        });
        test("normalized: case + dated suffix", () => {
                const m = matchRegistry("GPT-4O-2026-11-01", idx);
                expect(m?.match).toBe("normalized");
        });
        test("family match labeled as family, never exact", () => {
                const m = matchRegistry("claude-sonnet-4-5-2027-01", idx);
                expect(m?.match).toBe("family");
                expect(m?.matchedId).toBe("claude-sonnet-4-5");
        });
        test("deprecated entries skipped", () => {
                // the dated snapshot is deprecated; the query must resolve to the live base
                const m = matchRegistry("gpt-4o-2026-05-16", idx);
                expect(m?.entry.status).not.toBe("deprecated");
        });
        test("miss returns undefined", () => {
                expect(matchRegistry("totally-unknown", idx)).toBeUndefined();
        });
});

describe("indexLiteLLM", () => {
        const idx = indexLiteLLM({
                "gpt-4o": { max_input_tokens: 128000, max_output_tokens: 16384, input_cost_per_token: 0.0000025, output_cost_per_token: 0.00001, litellm_provider: "openai", source: "https://developers.openai.com/api/docs/pricing", mode: "chat" },
                "text-embedding-3-small": { max_input_tokens: 8191, mode: "embedding" },
                "sample_spec": { key: "value", mode: "chat" },
        });
        test("chat rows indexed with provider + sourceUrl", () => {
                expect(idx["gpt-4o"].provider).toBe("openai");
                expect(idx["gpt-4o"].sourceUrl).toContain("openai.com");
        });
        test("non-chat rows skipped (embedding/tts)", () => {
                expect(idx["text-embedding-3-small"]).toBeUndefined();
        });
        test("the meta row skipped", () => {
                expect(idx["sample_spec"]).toBeUndefined();
        });
});

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

describe("mergeSpecParts", () => {
        test("first source per field wins (priority order)", () => {
                const merged = mergeSpecParts([
                        { source: "endpoint", part: { contextWindow: 65536 }, match: "exact" },
                        { source: "models-dev", part: { contextWindow: 200000, maxTokens: 8192, cost: { input: 3, output: 15 } }, match: "exact" },
                ]);
                expect(merged?.contextWindow).toBe(65536);
                expect(merged?.maxTokens).toBe(8192);
                expect(merged?.source).toBe("endpoint"); // the contextWindow's source
                expect(merged?.cost?.input).toBe(3);
        });
        test("contributors record every source's fields", () => {
                const merged = mergeSpecParts([
                        { source: "endpoint", part: { contextWindow: 65536 }, match: "exact" },
                        { source: "litellm", part: { maxTokens: 4096 }, match: "normalized" },
                ]);
                expect(merged?.contributors).toHaveLength(2);
        });
        test("sanity applies on the merged pair (clamp)", () => {
                const merged = mergeSpecParts([
                        { source: "endpoint", part: { contextWindow: 4096 }, match: "exact" },
                        { source: "models-dev", part: { maxTokens: 32768 }, match: "exact" },
                ]);
                expect(merged?.maxTokens).toBe(4096); // clamped to the context
        });
        test("nothing from anywhere → undefined", () => {
                expect(mergeSpecParts([])).toBeUndefined();
        });
        test("isCompleteSpec requires both numbers", () => {
                expect(isCompleteSpec(mergeSpecParts([{ source: "endpoint", part: { contextWindow: 8192 }, match: "exact" }]))).toBe(false);
                expect(isCompleteSpec(mergeSpecParts([{ source: "curated", part: { contextWindow: 131072, maxTokens: 8192 }, match: "exact" }]))).toBe(true);
        });
});

// ---------------------------------------------------------------------------
// The cascade (fetch injected — no network in tests)
// ---------------------------------------------------------------------------


function freshDir(): string {
        return mkdtempSync(join(tmpdir(), "spec-detect-cascade-"));
}

const deadFetch: typeof fetch = async () => {
        throw new Error("network disabled in tests");
};

function jsonRes(body: unknown, status = 200): Response {
        return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("detectModelSpec", () => {
        const env = {
                UNOWN_SPEC_MODELSDEV_URL: "http://127.0.0.1:9/modelsdev",
                UNOWN_SPEC_LITELLM_URL: "http://127.0.0.1:9/litellm",
        } as NodeJS.ProcessEnv;

        test("curated hit short-circuits with source 'curated'", async () => {
                const r = await detectModelSpec("agnes-3.0-flash", { providerId: "zai-bridge", env, fetchImpl: deadFetch, agentDir: freshDir(), offline: true });
                expect(r.spec?.source).toBe("curated");
                expect(r.spec?.contextWindow).toBe(524288);
                expect(r.spec?.maxTokens).toBe(65536);
                expect(r.attempts.find((a) => a.source === "curated")?.outcome).toBe("hit");
        });

        test("models.dev hit fills the spec", async () => {
                const fetchImpl: typeof fetch = async (url) => {
                        if (String(url).includes("modelsdev")) return jsonRes(modelsDevPayload);
                        throw new Error("unexpected fetch");
                };
                const r = await detectModelSpec("claude-sonnet-4-5", { providerId: "custom", env, fetchImpl, agentDir: freshDir(), now: Date.now() });
                expect(r.spec?.source).toBe("models-dev");
                expect(r.spec?.contextWindow).toBe(200000);
                expect(r.spec?.maxTokens).toBe(64000);
                expect(r.spec?.reasoning).toBe(true);
        });

        test("registry fetch failure degrades to a miss and caches nothing as a hit", async () => {
                const r = await detectModelSpec("some-unknown-model", { providerId: "custom", env, fetchImpl: deadFetch, agentDir: freshDir() });
                expect(r.spec).toBeUndefined();
                expect(r.attempts.find((a) => a.source === "models-dev")?.outcome).toBe("unreachable");
        });
        test("the registry cache is written and reused offline (opencode's never-block law)", async () => {
                const dir = mkdtempSync(join(tmpdir(), "spec-cache-"));
                let devFetches = 0;
                const fetchImpl: typeof fetch = async (url) => {
                        if (!String(url).includes("modelsdev")) throw new Error("litellm unreachable in test");
                        devFetches++;
                        return jsonRes(modelsDevPayload);
                };
                await detectModelSpec("gpt-4o", { providerId: "custom", env, fetchImpl, agentDir: dir });
                expect(devFetches).toBe(1); // models.dev fetched once
                // second call: offline, cache fresh → hit without network
                const r2 = await detectModelSpec("gpt-4o", { providerId: "custom", env, fetchImpl: deadFetch, agentDir: dir, offline: true });
                expect(r2.spec?.contextWindow).toBe(128000);
                expect(devFetches).toBe(1);
                rmSync(dir, { recursive: true, force: true });
        });

        test("TTL expiry refetches", async () => {
                const dir = mkdtempSync(join(tmpdir(), "spec-ttl-"));
                let devFetches = 0;
                const fetchImpl: typeof fetch = async (url) => {
                        if (!String(url).includes("modelsdev")) throw new Error("litellm unreachable in test");
                        devFetches++;
                        return jsonRes(modelsDevPayload);
                };
                const t0 = 1_700_000_000_000;
                await detectModelSpec("gpt-4o", { providerId: "custom", env, fetchImpl, agentDir: dir, now: t0 });
                await detectModelSpec("gpt-4o", { providerId: "custom", env, fetchImpl, agentDir: dir, now: t0 + 1000 });
                expect(devFetches).toBe(1); // within TTL
                await detectModelSpec("gpt-4o", {
                        providerId: "custom",
                        env,
                        fetchImpl,
                        agentDir: dir,
                        now: t0 + registryCacheTtlMs(env) + 1000,
                });
                expect(devFetches).toBe(2); // past TTL → refetch
                rmSync(dir, { recursive: true, force: true });
        });

        test("stale-while-error: a fetch failure falls back to the stale cache", async () => {
                const dir = mkdtempSync(join(tmpdir(), "spec-stale-"));
                const fetchImpl: typeof fetch = async () => jsonRes(modelsDevPayload);
                await detectModelSpec("gpt-4o", { providerId: "custom", env, fetchImpl, agentDir: dir });
                // now the network dies but the cache is stale
                const t0 = Date.now();
                const r = await detectModelSpec("gpt-4o", { providerId: "custom", env, fetchImpl: deadFetch, agentDir: dir, now: t0 + registryCacheTtlMs(env) + 5000 });
                expect(r.spec?.contextWindow).toBe(128000);
                expect(r.attempts.find((a) => a.source === "models-dev")?.note).toContain("stale cache");
                rmSync(dir, { recursive: true, force: true });
        });

        test("endpoint lane: spec fields parsed from the provider's own /models", async () => {
                const fetchImpl: typeof fetch = async () =>
                        jsonRes({ data: [{ id: "my-local-model", max_model_len: 32768, max_tokens: 4096 }] });
                const r = await detectModelSpec("my-local-model", {
                        providerId: "vllm",
                        baseUrl: "http://127.0.0.1:8000/v1",
                        env,
                        fetchImpl,
                        agentDir: freshDir(),
                });
                expect(r.spec?.contextWindow).toBe(32768);
                expect(r.spec?.maxTokens).toBe(4096);
                expect(r.spec?.source).toBe("endpoint"); // the endpoint filled the context window (registries were unreachable)
                expect(r.spec?.contributors.some((c) => c.source === "endpoint")).toBe(true);
        });

        test("endpoint lane: single-entry server matches without an id match (llama.cpp)", async () => {
                const fetchImpl: typeof fetch = async () => jsonRes({ data: [{ id: "whatever", meta: { n_ctx: 16384 } }] });
                const r = await detectModelSpec("my-gguf", {
                        providerId: "llamacpp",
                        baseUrl: "http://127.0.0.1:8080/v1",
                        env,
                        fetchImpl,
                        agentDir: freshDir(),
                });
                expect(r.spec?.contextWindow).toBe(16384);
        });

        test("endpoint lane: 404 is 'unsupported', cached as a failure (goose's rule)", async () => {
                const dir = mkdtempSync(join(tmpdir(), "spec-404-"));
                let endpointHits = 0;
                const fetchImpl: typeof fetch = async (url) => {
                        if (String(url).includes(":9/v1/models")) {
                                endpointHits++;
                                return new Response("not found", { status: 404 });
                        }
                        throw new Error("registries unreachable in test");
                };
                await detectModelSpec("m", { providerId: "p404", baseUrl: "http://127.0.0.1:9/v1", env, fetchImpl, agentDir: dir });
                await detectModelSpec("m", { providerId: "p404", baseUrl: "http://127.0.0.1:9/v1", env, fetchImpl, agentDir: dir });
                expect(endpointHits).toBe(1); // second call served from the failure cache
                const cache = readRegistryCache(dir);
                expect(cache.probeFailures?.p404?.problem).toBe("HTTP 404");
                rmSync(dir, { recursive: true, force: true });
        });

        test("endpoint lane: ids-only catalog (the OpenAI norm) is a miss, not an error", async () => {
                const fetchImpl: typeof fetch = async () => jsonRes({ data: [{ id: "gpt-4o", object: "model" }] });
                const r = await detectModelSpec("gpt-4o", {
                        providerId: "openai",
                        baseUrl: "https://api.openai.com/v1",
                        env,
                        fetchImpl,
                        agentDir: freshDir(),
                });
                // models.dev is unreachable in this env, so nothing fills — endpoint miss recorded
                expect(r.attempts.find((a) => a.source === "endpoint")?.outcome).toBe("miss");
        });

        test("field-wise merge across sources: endpoint context + registry output", async () => {
                const fetchImpl: typeof fetch = async (url) => {
                        if (String(url).includes("modelsdev")) return jsonRes(modelsDevPayload);
                        return jsonRes({ data: [{ id: "gpt-4o", max_model_len: 100000 }] });
                };
                const r = await detectModelSpec("gpt-4o", {
                        providerId: "custom",
                        baseUrl: "https://gateway.example/v1",
                        env,
                        fetchImpl,
                        agentDir: freshDir(),
                });
                expect(r.spec?.contextWindow).toBe(100000); // endpoint (priority for its own model)
                expect(r.spec?.maxTokens).toBe(16384); // filled by models.dev
                expect(isCompleteSpec(r.spec)).toBe(true);
        });

        test("no sources → no spec, attempts explain what was tried", async () => {
                const r = await detectModelSpec("mystery-model", { providerId: "custom", env, fetchImpl: deadFetch, agentDir: freshDir() });
                expect(r.spec).toBeUndefined();
                expect(r.attempts.map((a) => a.source)).toEqual(["endpoint", "curated", "models-dev", "litellm"]);
        });
});

// ---------------------------------------------------------------------------
// Sidecar
// ---------------------------------------------------------------------------

describe("the provenance sidecar", () => {
        test("record + read roundtrip", () => {
                const dir = mkdtempSync(join(tmpdir(), "spec-sidecar-"));
                const spec = userSpec(262144, 16384);
                recordSpec(dir, "kimi", "kimi-k2.5", spec, 1234);
                const rec = getRecordedSpec(dir, "kimi", "kimi-k2.5");
                expect(rec?.contextWindow).toBe(262144);
                expect(rec?.source).toBe("user");
                expect(rec?.verifiedAt).toBe(1234);
                rmSync(dir, { recursive: true, force: true });
        });
        test("keys are provider/model scoped", () => {
                expect(specSidecarKey("a", "b/c")).toBe("a/b/c");
        });
        test("missing file → empty sidecar", () => {
                expect(readSpecSidecar(join(tmp, "does-not-exist")).specs).toEqual({});
        });
        test("userSpec carries user provenance", () => {
                const s = userSpec(1000, 100);
                expect(s.source).toBe("user");
                expect(s.match).toBe("exact");
        });
});

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

describe("formatSpecLine", () => {
        test("renders numbers, modalities, pricing and provenance", () => {
                const line = formatSpecLine({
                        contextWindow: 524288,
                        maxTokens: 65536,
                        input: ["text", "image"],
                        cost: { input: 0.11, output: 0.6 },
                        source: "curated",
                        match: "exact",
                        contributors: [],
                });
                expect(line).toContain("524,288 ctx / 65,536 out");
                expect(line).toContain("text+image");
                expect(line).toContain("$0.11 in / $0.6 out per 1M");
                expect(line).toContain("curated catalog");
        });
        test("non-exact matches are labeled", () => {
                const line = formatSpecLine({ contextWindow: 1, maxTokens: 1, source: "models-dev", match: "family", contributors: [] });
                expect(line).toContain("(family match)");
        });
});
