/**
 * model-spec-wiring.test.ts — the model-specs round's wiring additions:
 *
 *   - upsertProvider with ProviderEntry.modelSpecs stamps DETECTED numbers on
 *     newly-registered records (per-model specs beat the entry-level values
 *     beat the curated catalog), and now also carries COST (pi's four-field
 *     ModelCostSchema, unknown cache rates 0) and the image-modality UPGRADE
 *   - applyModelSpecs (the self-heal write) patches cost + input alongside
 *     the two limits, and only counts genuinely-changed records
 *   - the TRIMMED probe: catalog entries arrive as id + the spec fields the
 *     parsers read — never the provider's catalog noise (descriptions,
 *     pricing, logos), never nested-container extras, capped at 256, absent
 *     for id-only catalogs
 *   - refreshProviderModels detects each new id's specs through the SAME
 *     probe response (the endpointCatalog injection) and records provenance
 */
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSpecSidecar } from "../src/model-spec-detect.ts";
import { probeProviderEndpoint } from "../src/probe.ts";
import { applyModelSpecs, type ProviderEntry, refreshProviderModels, upsertProvider } from "../src/providers.ts";

let DIR = "";
beforeEach(() => {
	DIR = mkdtempSync(join(tmpdir(), "unown-spec-wiring-"));
});
afterAll(() => {
	rmSync(DIR, { recursive: true, force: true });
});

/** A local-server-shaped entry (the endpoint lane's home turf). */
function local(over: Partial<ProviderEntry> = {}): ProviderEntry {
	return {
		id: "vllm",
		name: "local vLLM",
		baseUrl: "http://127.0.0.1:9/v1",
		api: "openai-completions",
		modelId: "qwen-custom-72b",
		input: ["text"],
		...over,
	};
}

function readModels(agentDir: string): Record<string, any> {
	return JSON.parse(readFileSync(join(agentDir, "models.json"), "utf8")) as Record<string, any>;
}

// ---------------------------------------------------------------------------
// upsertProvider + modelSpecs (cost + modality additions)
// ---------------------------------------------------------------------------

describe("upsertProvider — modelSpecs carry cost and the image upgrade", () => {
	test("detected specs stamp NEW records ahead of the entry-level values and the catalog", () => {
		upsertProvider(DIR, local({ modelSpecs: { "qwen-custom-72b": { contextWindow: 32768, maxTokens: 4096 } } }));
		const m = readModels(DIR).providers.vllm.models[0];
		expect(m.contextWindow).toBe(32768);
		expect(m.maxTokens).toBe(4096);
	});

	test("detected cost is written with all four ModelCostSchema fields (cache rates default to 0)", () => {
		upsertProvider(
			DIR,
			local({
				modelSpecs: {
					"qwen-custom-72b": {
						contextWindow: 32768,
						maxTokens: 4096,
						cost: { input: 0.5, output: 2, cacheRead: 0.1 },
					},
				},
			}),
		);
		const m = readModels(DIR).providers.vllm.models[0];
		expect(m.cost).toEqual({ input: 0.5, output: 2, cacheRead: 0.1, cacheWrite: 0 });
	});

	test("detected imageInput UPGRADES the entry's modalities (never strips, never duplicates)", () => {
		upsertProvider(
			DIR,
			local({ modelSpecs: { "qwen-custom-72b": { contextWindow: 32768, maxTokens: 4096, imageInput: true } } }),
		);
		const m = readModels(DIR).providers.vllm.models[0];
		expect(m.input).toEqual(["text", "image"]);
		// an entry that already carries image is not duplicated
		upsertProvider(
			DIR,
			local({ modelSpecs: { "qwen-custom-72b": { imageInput: true } }, input: ["text", "image"] }),
			{ reset: true },
		);
		const m2 = readModels(DIR).providers.vllm.models[0];
		expect(m2.input).toEqual(["text", "image"]);
	});

	test("EXTRA ids get their own detected specs (bulk detection without per-id requests)", () => {
		upsertProvider(
			DIR,
			local({
				extraModelIds: ["second-model", "third-model"],
				modelSpecs: {
					"qwen-custom-72b": { contextWindow: 32768, maxTokens: 4096 },
					"third-model": { contextWindow: 8192, maxTokens: 1024 },
				},
			}),
		);
		const models = readModels(DIR).providers.vllm.models;
		const third = models.find((m: any) => m.id === "third-model");
		expect(third.contextWindow).toBe(8192);
		expect(third.maxTokens).toBe(1024);
		const second = models.find((m: any) => m.id === "second-model");
		expect(second.contextWindow).toBe(131072); // the conservative fallback — nothing detected
	});

	test("existing records are NEVER rewritten by a later upsert with different specs (accumulate law)", () => {
		upsertProvider(DIR, local({ modelSpecs: { "qwen-custom-72b": { contextWindow: 32768, maxTokens: 4096 } } }));
		const before = JSON.stringify(readModels(DIR).providers.vllm.models[0]);
		upsertProvider(DIR, local({ modelSpecs: { "qwen-custom-72b": { contextWindow: 1000000, maxTokens: 65536 } } }));
		const after = JSON.stringify(readModels(DIR).providers.vllm.models[0]);
		expect(after).toBe(before);
	});
});

// ---------------------------------------------------------------------------
// applyModelSpecs — the self-heal write with cost + modality
// ---------------------------------------------------------------------------

describe("applyModelSpecs — cost and the image upgrade ride the self-heal write", () => {
	test("patches the limits AND writes cost AND upgrades input; unchanged records are not counted", () => {
		upsertProvider(DIR, local());
		const applied = applyModelSpecs(DIR, "vllm", {
			"qwen-custom-72b": {
				contextWindow: 65536,
				maxTokens: 8192,
				cost: { input: 0.3, output: 1.2 },
				imageInput: true,
			},
		});
		expect(applied).toEqual(["qwen-custom-72b"]);
		const m = readModels(DIR).providers.vllm.models[0];
		expect(m.contextWindow).toBe(65536);
		expect(m.maxTokens).toBe(8192);
		expect(m.cost).toEqual({ input: 0.3, output: 1.2, cacheRead: 0, cacheWrite: 0 });
		expect(m.input).toEqual(["text", "image"]);
		// a second identical apply is a no-op (nothing counted, nothing rewritten)
		const again = applyModelSpecs(DIR, "vllm", {
			"qwen-custom-72b": {
				contextWindow: 65536,
				maxTokens: 8192,
				cost: { input: 0.3, output: 1.2 },
				imageInput: true,
			},
		});
		expect(again).toEqual([]);
	});

	test("a spec without cost leaves an existing cost untouched (never erases pricing)", () => {
		upsertProvider(
			DIR,
			local({
				modelSpecs: {
					"qwen-custom-72b": { contextWindow: 32768, maxTokens: 4096, cost: { input: 0.5, output: 2 } },
				},
			}),
		);
		applyModelSpecs(DIR, "vllm", { "qwen-custom-72b": { contextWindow: 65536, maxTokens: 8192 } });
		const m = readModels(DIR).providers.vllm.models[0];
		expect(m.contextWindow).toBe(65536);
		expect(m.cost).toEqual({ input: 0.5, output: 2, cacheRead: 0, cacheWrite: 0 });
	});
});

// ---------------------------------------------------------------------------
// The trimmed probe
// ---------------------------------------------------------------------------

describe("probeProviderEndpoint — the TRIMMED spec-carrying catalog", () => {
	let server: ReturnType<typeof Bun.serve> | null = null;
	afterAll(() => {
		server?.stop(true);
	});

	test("vLLM-shaped entries: max_model_len survives the probe, catalog noise does not", async () => {
		server = Bun.serve({
			port: 0,
			fetch() {
				return Response.json({
					data: [
						{
							id: "qwen-custom-72b",
							object: "model",
							max_model_len: 32768,
							description: "a long description",
							owned_by: "vllm",
							pricing: { prompt: "0.001" },
						},
						{ id: "plain-model", object: "model" },
					],
				});
			},
		});
		const probe = await probeProviderEndpoint(`http://127.0.0.1:${server.port}/v1`);
		expect(probe.ok).toBe(true);
		expect(probe.models).toEqual(["qwen-custom-72b", "plain-model"]);
		// Only the spec-bearing entry is worth carrying; the id-only one is dropped.
		expect(probe.modelEntries).toEqual([{ id: "qwen-custom-72b", max_model_len: 32768 }]);
	});

	test("LM Studio / llama.cpp shapes: loaded_context_length and meta.n_ctx survive, nested containers trimmed", async () => {
		server = Bun.serve({
			port: 0,
			fetch() {
				return Response.json({
					data: [
						{ id: "lm-studio-model", loaded_context_length: 8192, max_tokens: 4096, stats: { visits: 5 } },
						{ id: "llama-model", meta: { n_ctx: 4096, vocabulary_size: 32000 } },
					],
				});
			},
		});
		const probe = await probeProviderEndpoint(`http://127.0.0.1:${server!.port}/v1`);
		expect(probe.modelEntries).toEqual([
			{ id: "lm-studio-model", loaded_context_length: 8192, max_tokens: 4096 },
			{ id: "llama-model", meta: { n_ctx: 4096 } },
		]);
	});

	test("OpenRouter shape: top_provider + architecture trimmed to the parsed fields", async () => {
		server = Bun.serve({
			port: 0,
			fetch() {
				return Response.json({
					data: [
						{
							id: "openrouter/model",
							name: "Some Model",
							top_provider: { max_completion_tokens: 8192, context_length: 200000, is_moderated: true },
							architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
							description: "long text",
						},
					],
				});
			},
		});
		const probe = await probeProviderEndpoint(`http://127.0.0.1:${server!.port}/v1`);
		expect(probe.modelEntries).toEqual([
			{
				id: "openrouter/model",
				top_provider: { max_completion_tokens: 8192 },
				architecture: { input_modalities: ["text", "image"] },
			},
		]);
	});

	test("an id-only catalog (the OpenAI wire's own /models) carries NO modelEntries", async () => {
		server = Bun.serve({
			port: 0,
			fetch() {
				return Response.json({ data: [{ id: "gpt-x", object: "model", created: 1, owned_by: "openai" }] });
			},
		});
		const probe = await probeProviderEndpoint(`http://127.0.0.1:${server!.port}/v1`);
		expect(probe.models).toEqual(["gpt-x"]);
		expect(probe.modelEntries).toBeUndefined();
	});

	test("a huge catalog is capped at 256 entries", async () => {
		server = Bun.serve({
			port: 0,
			fetch() {
				const data = Array.from({ length: 1000 }, (_, i) => ({ id: `model-${i}`, max_model_len: 4096 }));
				return Response.json({ data });
			},
		});
		const probe = await probeProviderEndpoint(`http://127.0.0.1:${server!.port}/v1`);
		expect(probe.models?.length).toBe(1000);
		expect(probe.modelEntries?.length).toBe(256);
	});
});

// ---------------------------------------------------------------------------
// refreshProviderModels — detection through the same probe response
// ---------------------------------------------------------------------------

describe("refreshProviderModels — endpoint specs stamp new ids + record provenance", () => {
	let server: ReturnType<typeof Bun.serve> | null = null;
	afterAll(() => {
		server?.stop(true);
	});

	test("a spec-bearing served entry stamps the new record AND writes the sidecar with endpoint provenance", async () => {
		upsertProvider(DIR, local());
		server = Bun.serve({
			port: 0,
			fetch() {
				return Response.json({
					data: [
						{ id: "qwen-custom-72b", max_model_len: 32768, max_tokens: 4096 },
						{ id: "brand-new-model", max_model_len: 65536, max_tokens: 8192 },
					],
				});
			},
		});
		// Point the entry at the live server.
		const models = readModels(DIR);
		models.providers.vllm.baseUrl = `http://127.0.0.1:${server.port}/v1`;
		require("node:fs").writeFileSync(join(DIR, "models.json"), JSON.stringify(models, null, 2));

		const result = await refreshProviderModels(DIR, "vllm");
		expect(result.found).toBe(true);
		expect(result.added).toEqual(["brand-new-model"]);

		const after = readModels(DIR);
		const fresh = after.providers.vllm.models.find((m: any) => m.id === "brand-new-model");
		expect(fresh.contextWindow).toBe(65536);
		expect(fresh.maxTokens).toBe(8192);

		const sidecar = readSpecSidecar(DIR);
		const record = sidecar.specs["vllm/brand-new-model"];
		expect(record).toBeDefined();
		expect(record.source).toBe("endpoint");
		expect(record.match).toBe("exact");
		expect(record.contextWindow).toBe(65536);
		// The pre-existing model keeps its record byte-for-byte (no re-stamp).
		const existing = after.providers.vllm.models.find((m: any) => m.id === "qwen-custom-72b");
		expect(existing.contextWindow).toBe(131072); // the seeded fallback, untouched by refresh
		expect(sidecar.specs["vllm/qwen-custom-72b"]).toBeUndefined();
	});

	test("a PARTIAL catalog (context only, vLLM/llama.cpp shape) stamps nothing — the gate asks at session start instead", async () => {
		// The deliberate semantic: a partial stamp would write a guessed
		// maxTokens next to a verified contextWindow, and the hand-edit rule
		// would then pass the gate on what is half a guess. Complete-only
		// stamping keeps the ask honest; production registries fill the gap.
		upsertProvider(DIR, local());
		server = Bun.serve({
			port: 0,
			fetch() {
				return Response.json({ data: [{ id: "nctx-only-model", max_model_len: 65536 }] });
			},
		});
		const models = readModels(DIR);
		models.providers.vllm.baseUrl = `http://127.0.0.1:${server.port}/v1`;
		require("node:fs").writeFileSync(join(DIR, "models.json"), JSON.stringify(models, null, 2));
		await refreshProviderModels(DIR, "vllm");
		const after = readModels(DIR);
		const m = after.providers.vllm.models.find((x: any) => x.id === "nctx-only-model");
		expect(m.contextWindow).toBe(131072); // the guess — the partial detection is not stamped
		expect(readSpecSidecar(DIR).specs["vllm/nctx-only-model"]).toBeUndefined();
	});
});
