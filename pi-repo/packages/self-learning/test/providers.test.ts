// providers.test.ts — the multi-provider registry contract (M1).
//
// Everything here drives src/providers.ts against an ISOLATED temp agent dir
// (every function takes agentDir explicitly — no UNOWN_HOME redirect needed,
// no state leaks). The contract under test is the accumulate-never-rewrite
// promise plus the key-storage rules:
//
//   - adding a provider NEVER drops the others (the old setup rewrote
//     models.json with exactly one provider — the #1 multi-provider bug)
//   - re-adding updates IN PLACE: unknown fields (headers, compat…) and
//     per-model metadata the user curated survive
//   - reset:true restores the pre-M1 single-provider rewrite (setup --force)
//   - real secrets → auth.json (0600 on POSIX); $ENV refs stay in models.json
//     so the file can be shared/committed without leaking keys
//   - remove drops the provider + its stored key + re-points the default
//   - back-compat: a pre-M1 single-provider models.json reads identically
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	keyStatusLabel,
	listProviders,
	looksLikeChatModel,
	type ProviderEntry,
	refreshProviderModels,
	removeProvider,
	resolveProviderKey,
	secureFilePermissions,
	setDefaultModel,
	setProviderKey,
	testProvider,
	upsertProvider,
} from "../src/providers.ts";

let DIR = "";
beforeEach(() => {
	DIR = mkdtempSync(join(tmpdir(), "unown-providers-test-"));
});
afterAll(() => {
	rmSync(DIR, { recursive: true, force: true });
});

/** Read the raw models.json record for assertions on unknown fields. */
function rawModels(): Record<string, any> {
	return JSON.parse(readFileSync(join(DIR, "models.json"), "utf8"));
}
function rawAuth(): Record<string, any> {
	return JSON.parse(readFileSync(join(DIR, "auth.json"), "utf8"));
}
function rawSettings(): Record<string, any> {
	return JSON.parse(readFileSync(join(DIR, "settings.json"), "utf8"));
}

const agnes = (over: Partial<ProviderEntry> = {}): ProviderEntry => ({
	id: "agnes",
	name: "Agnes AI",
	baseUrl: "https://apihub.agnes-ai.com/v1",
	api: "openai-completions",
	modelId: "agnes-3.0-flash",
	input: ["text", "image"],
	apiKeyInAuthJson: "cpk-test-1",
	...over,
});

// ---------------------------------------------------------------------------
// upsert — accumulate, never rewrite
// ---------------------------------------------------------------------------

describe("upsertProvider — accumulate (the M1 contract)", () => {
	test("adding a second provider KEEPS the first (the old setup dropped it)", () => {
		upsertProvider(DIR, agnes());
		upsertProvider(DIR, {
			id: "openai",
			name: "OpenAI",
			baseUrl: "https://api.openai.com/v1",
			api: "openai-completions",
			modelId: "gpt-4o",
			input: ["text", "image"],
			apiKeyInAuthJson: "sk-test",
		});
		expect(Object.keys(rawModels().providers).sort()).toEqual(["agnes", "openai"]);
	});

	test("re-adding the SAME provider updates it in place; siblings untouched", () => {
		upsertProvider(DIR, agnes());
		upsertProvider(DIR, {
			id: "openai",
			name: "OpenAI",
			baseUrl: "https://api.openai.com/v1",
			api: "openai-completions",
			modelId: "gpt-4o",
			input: ["text"],
			apiKeyInAuthJson: "sk-1",
		});
		upsertProvider(DIR, agnes({ baseUrl: "https://apihub.agnes-ai.com/v2", modelId: "agnes-2.5-flash" }));
		expect(Object.keys(rawModels().providers).sort()).toEqual(["agnes", "openai"]);
		expect(rawModels().providers.agnes.baseUrl).toBe("https://apihub.agnes-ai.com/v2");
		// The 2026-10-30 union merge: a re-add naming ONE model KEEPS the
		// registered extras — an update never truncates the catalog
		// (`--force` is the reset path; refresh's "removal is a
		// deliberate act" rule, now enforced in upsert too).
		expect(rawModels().providers.agnes.models.map((m: any) => m.id)).toEqual(["agnes-2.5-flash", "agnes-3.0-flash"]);
	});

	test("re-adding with FEWER models keeps the discovered catalog (the F.1 truncation regression)", () => {
		// The real-world damage: the bridge seeded its full allow-list
		// (say 9 models); a later `setup --provider bridge --model X`
		// rebuilt the array from the incoming ids only — the other 8
		// silently vanished from /model and --model routing.
		upsertProvider(
			DIR,
			agnes({ modelId: "agnes-3.0-flash", extraModelIds: ["agnes-2.5-flash", "m-three", "m-four"] }),
		);
		upsertProvider(DIR, agnes({ modelId: "m-three" }));
		const ids = rawModels().providers.agnes.models.map((m: any) => m.id);
		expect(ids[0]).toBe("m-three"); // the incoming id leads
		expect(ids.slice(1).sort()).toEqual(["agnes-2.5-flash", "agnes-3.0-flash", "m-four"]);
		expect(ids).toHaveLength(4);
	});

	test("reset:true rewrites models.json with EXACTLY this provider (setup --force)", () => {
		upsertProvider(DIR, agnes());
		upsertProvider(DIR, {
			id: "openai",
			name: "OpenAI",
			baseUrl: "https://api.openai.com/v1",
			api: "openai-completions",
			modelId: "gpt-4o",
			input: ["text"],
		});
		upsertProvider(DIR, agnes(), { reset: true });
		expect(Object.keys(rawModels().providers)).toEqual(["agnes"]);
	});

	test("unknown provider-level fields (headers, compat) survive an in-place update", () => {
		upsertProvider(DIR, agnes());
		// hand-edit like a power user would
		const models = rawModels();
		models.providers.agnes.headers = { "X-Custom": "yes" };
		models.providers.agnes.compat = { supportsDeveloperRole: false };
		writeFileSync(join(DIR, "models.json"), JSON.stringify(models, null, 2));
		// re-add: managed fields update, unmanaged survive
		upsertProvider(DIR, agnes({ baseUrl: "https://apihub.agnes-ai.com/v3" }));
		const after = rawModels().providers.agnes;
		expect(after.baseUrl).toBe("https://apihub.agnes-ai.com/v3");
		expect(after.headers).toEqual({ "X-Custom": "yes" });
		expect(after.compat).toEqual({ supportsDeveloperRole: false });
	});

	test("curated per-model metadata survives a re-add naming the same model", () => {
		upsertProvider(DIR, agnes());
		const models = rawModels();
		models.providers.agnes.models[0].contextWindow = 200000; // user-tuned
		writeFileSync(join(DIR, "models.json"), JSON.stringify(models, null, 2));
		upsertProvider(DIR, agnes({ extraModelIds: ["agnes-2.5-flash", "mystery-7b"] }));
		const after = rawModels().providers.agnes.models;
		expect(after.find((m: any) => m.id === "agnes-3.0-flash").contextWindow).toBe(200000);
		expect(after.find((m: any) => m.id === "agnes-2.5-flash")).toMatchObject({
			contextWindow: 524288,
			maxTokens: 65536,
		}); // known model: published spec
		expect(after.find((m: any) => m.id === "mystery-7b")).toMatchObject({ contextWindow: 131072, maxTokens: 8192 }); // unknown id: conservative defaults
	});

	test("a literal models.json key is cleared when the secret moves to auth.json", () => {
		upsertProvider(DIR, agnes({ apiKeyInAuthJson: undefined, apiKeyInModelsJson: "old-literal" }));
		expect(rawModels().providers.agnes.apiKey).toBe("old-literal");
		upsertProvider(DIR, agnes()); // now with apiKeyInAuthJson
		expect(rawModels().providers.agnes.apiKey).toBeUndefined();
		expect(rawAuth().agnes.key).toBe("cpk-test-1");
	});
});

// ---------------------------------------------------------------------------
// key storage rules
// ---------------------------------------------------------------------------

describe("upsertProvider — key storage", () => {
	test("real secrets land in auth.json as pi's AuthStorage shape, 0600 on POSIX", () => {
		upsertProvider(DIR, agnes());
		expect(rawAuth().agnes).toEqual({ type: "api_key", key: "cpk-test-1" });
		if (process.platform !== "win32") {
			// eslint-disable-next-line no-bitwise
			expect(statSync(join(DIR, "auth.json")).mode & 0o777).toBe(0o600);
		}
	});

	test("an env ref stores $VAR in models.json — NO secret anywhere in the file", () => {
		upsertProvider(DIR, agnes({ apiKeyInAuthJson: undefined, apiKeyEnvRef: "AGNES_API_KEY" }));
		expect(rawModels().providers.agnes.apiKey).toBe("$AGNES_API_KEY");
		expect(JSON.stringify(rawModels())).not.toContain("cpk-");
		expect(existsSync(join(DIR, "auth.json"))).toBe(false);
	});

	test("auth.json merges across providers (both keys coexist)", () => {
		upsertProvider(DIR, agnes());
		upsertProvider(DIR, {
			id: "openai",
			name: "OpenAI",
			baseUrl: "https://api.openai.com/v1",
			api: "openai-completions",
			modelId: "gpt-4o",
			input: ["text"],
			apiKeyInAuthJson: "sk-2",
		});
		expect(Object.keys(rawAuth()).sort()).toEqual(["agnes", "openai"]);
	});
});

// ---------------------------------------------------------------------------
// default semantics
// ---------------------------------------------------------------------------

describe("upsertProvider — default semantics", () => {
	test("the FIRST provider becomes the default even without setDefault", () => {
		upsertProvider(DIR, agnes(), {});
		expect(rawSettings().defaultProvider).toBe("agnes");
		expect(rawSettings().defaultModel).toBe("agnes-3.0-flash");
	});

	test("a later add does NOT steal the default without setDefault", () => {
		upsertProvider(DIR, agnes());
		upsertProvider(DIR, {
			id: "openai",
			name: "OpenAI",
			baseUrl: "https://api.openai.com/v1",
			api: "openai-completions",
			modelId: "gpt-4o",
			input: ["text"],
		});
		expect(rawSettings().defaultProvider).toBe("agnes");
	});

	test("setDefault steals it explicitly (setup semantics)", () => {
		upsertProvider(DIR, agnes());
		upsertProvider(DIR, agnes({ id: "openai", modelId: "gpt-4o", apiKeyInAuthJson: undefined }), {
			setDefault: true,
		});
		expect(rawSettings().defaultProvider).toBe("openai");
		expect(rawSettings().defaultModel).toBe("gpt-4o");
	});

	test("settings.json merges — unrelated user settings survive", () => {
		writeFileSync(join(DIR, "settings.json"), JSON.stringify({ theme: "dark", tuiMode: "fullscreen" }));
		upsertProvider(DIR, agnes());
		expect(rawSettings().theme).toBe("dark");
		expect(rawSettings().defaultProvider).toBe("agnes");
	});
});

// ---------------------------------------------------------------------------
// list / key resolution
// ---------------------------------------------------------------------------

describe("listProviders — the read side", () => {
	test("keyStatus detection: auth-json / models-json / env-ref / none", () => {
		upsertProvider(DIR, agnes());
		upsertProvider(
			DIR,
			agnes({ id: "bridge", name: "bridge", apiKeyInAuthJson: undefined, apiKeyInModelsJson: "bridge-local" }),
		);
		upsertProvider(DIR, agnes({ id: "envref", name: "envref", apiKeyInAuthJson: undefined, apiKeyEnvRef: "MY_KEY" }));
		upsertProvider(DIR, agnes({ id: "keyless", name: "keyless", apiKeyInAuthJson: undefined }));
		const byId = Object.fromEntries(listProviders(DIR).providers.map((p) => [p.id, p]));
		expect(byId.agnes.keyStatus).toBe("auth-json");
		expect(byId.bridge.keyStatus).toBe("models-json");
		expect(byId.envref.keyStatus).toBe("env-ref");
		expect(byId.envref.keyEnv).toBe("MY_KEY");
		expect(byId.keyless.keyStatus).toBe("none");
		expect(byId.agnes.isDefault).toBe(true);
		expect(byId.bridge.isDefault).toBe(false);
	});

	test("back-compat: a pre-M1 single-provider models.json reads identically", () => {
		// The exact shape setup.ts wrote before M1 (and the shape the
		// edit-bench fixtures freeze) — must keep working untouched.
		const legacy = {
			providers: {
				"zai-bridge": {
					name: "unown llm-bridge",
					baseUrl: "http://127.0.0.1:3031/v1",
					api: "openai-completions",
					apiKey: "dummy-bridge-key",
					models: [
						{
							id: "kimi-k2.5",
							name: "kimi-k2.5 (via unown)",
							contextWindow: 131072,
							maxTokens: 8192,
							input: ["text", "image"],
						},
					],
				},
			},
		};
		writeFileSync(join(DIR, "models.json"), JSON.stringify(legacy));
		writeFileSync(
			join(DIR, "settings.json"),
			JSON.stringify({ defaultProvider: "zai-bridge", defaultModel: "kimi-k2.5" }),
		);
		const list = listProviders(DIR);
		expect(list.error).toBeUndefined();
		expect(list.providers).toHaveLength(1);
		expect(list.providers[0]).toMatchObject({
			id: "zai-bridge",
			baseUrl: "http://127.0.0.1:3031/v1",
			keyStatus: "models-json",
			isDefault: true,
		});
		expect(list.providers[0].modelIds).toEqual(["kimi-k2.5"]);
	});

	test("resolveProviderKey: auth.json wins; env-ref reads the live env", () => {
		upsertProvider(DIR, agnes());
		upsertProvider(
			DIR,
			agnes({ id: "envref", name: "envref", apiKeyInAuthJson: undefined, apiKeyEnvRef: "PROV_TEST_KEY" }),
		);
		expect(resolveProviderKey(DIR, "agnes")).toEqual({ key: "cpk-test-1", source: "auth-json" });
		process.env.PROV_TEST_KEY = "from-env";
		try {
			expect(resolveProviderKey(DIR, "envref")).toEqual({
				key: "from-env",
				source: "env-ref",
				envVar: "PROV_TEST_KEY",
			});
		} finally {
			delete process.env.PROV_TEST_KEY;
		}
		// unset env → no key, but the source is still reported
		const noKey = resolveProviderKey(DIR, "envref");
		expect(noKey.key).toBeUndefined();
		expect(noKey.source).toBe("env-ref");
	});
});

// ---------------------------------------------------------------------------
// remove / key / default
// ---------------------------------------------------------------------------

describe("removeProvider", () => {
	test("removes provider + its auth key; siblings untouched", () => {
		upsertProvider(DIR, agnes());
		upsertProvider(DIR, agnes({ id: "openai", modelId: "gpt-4o", apiKeyInAuthJson: "sk-2" }));
		const result = removeProvider(DIR, "agnes");
		expect(result).toEqual({ removed: true, wasDefault: true, remaining: 1 });
		expect(Object.keys(rawModels().providers)).toEqual(["openai"]);
		expect(rawAuth()).toEqual({ openai: { type: "api_key", key: "sk-2" } });
	});

	test("default falls back to the first remaining provider (model = its first)", () => {
		upsertProvider(DIR, agnes());
		upsertProvider(DIR, agnes({ id: "openai", modelId: "gpt-4o" }));
		removeProvider(DIR, "agnes");
		expect(rawSettings().defaultProvider).toBe("openai");
		expect(rawSettings().defaultModel).toBe("gpt-4o");
	});

	test("removing the LAST provider clears the default", () => {
		upsertProvider(DIR, agnes());
		removeProvider(DIR, "agnes");
		expect(Object.keys(rawModels().providers)).toHaveLength(0);
		expect(rawSettings().defaultProvider).toBe("");
	});

	test("unknown provider → removed:false, nothing written", () => {
		upsertProvider(DIR, agnes());
		const before = readFileSync(join(DIR, "models.json"), "utf8");
		const result = removeProvider(DIR, "ghost");
		expect(result.removed).toBe(false);
		expect(readFileSync(join(DIR, "models.json"), "utf8")).toBe(before);
	});
});

describe("setProviderKey / setDefaultModel", () => {
	test("rotation rewrites the auth.json entry and keeps 0600", () => {
		upsertProvider(DIR, agnes());
		expect(setProviderKey(DIR, "agnes", "cpk-rotated")).toBe(true);
		expect(rawAuth().agnes.key).toBe("cpk-rotated");
		if (process.platform !== "win32") {
			// eslint-disable-next-line no-bitwise
			expect(statSync(join(DIR, "auth.json")).mode & 0o777).toBe(0o600);
		}
	});

	test("rotation on an unknown provider → false, no file written", () => {
		expect(setProviderKey(DIR, "ghost", "x")).toBe(false);
		expect(existsSync(join(DIR, "auth.json"))).toBe(false);
	});

	test("default validation: unknown provider / unknown model / no model → errors", () => {
		upsertProvider(DIR, agnes());
		expect(setDefaultModel(DIR, "ghost").ok).toBe(false);
		expect(setDefaultModel(DIR, "agnes", "not-a-model").ok).toBe(false);
		expect(setDefaultModel(DIR, "agnes", "agnes-3.0-flash").ok).toBe(true);
		expect(rawSettings()).toMatchObject({ defaultProvider: "agnes", defaultModel: "agnes-3.0-flash" });
	});
});

// ---------------------------------------------------------------------------
// testProvider (live probe against a local mock endpoint)
// ---------------------------------------------------------------------------

describe("testProvider — live probe", () => {
	test("found:false for unknown; probes with the stored auth.json key", async () => {
		const missing = await testProvider(DIR, "ghost");
		expect(missing.found).toBe(false);

		const server = Bun.serve({
			port: 0,
			fetch(req) {
				if (req.headers.get("authorization") === "Bearer cpk-test-1") {
					return Response.json({ data: [{ id: "agnes-3.0-flash" }] });
				}
				return new Response("nope", { status: 401 });
			},
		});
		try {
			upsertProvider(DIR, agnes({ baseUrl: `http://127.0.0.1:${server.port}/v1` }));
			const ok = await testProvider(DIR, "agnes");
			expect(ok.found).toBe(true);
			expect(ok.probe?.ok).toBe(true);
			expect(ok.probe?.models).toEqual(["agnes-3.0-flash"]);
			expect(ok.keySource).toBe("auth-json");

			// rejected key surfaces as problem:auth
			await setProviderKey(DIR, "agnes", "cpk-wrong");
			const bad = await testProvider(DIR, "agnes");
			expect(bad.probe?.ok).toBe(false);
			expect(bad.probe?.problem).toBe("auth");
		} finally {
			server.stop(true);
		}
	});
});

// ---------------------------------------------------------------------------
// refreshProviderModels — live model discovery (M2)
// ---------------------------------------------------------------------------

describe("refreshProviderModels — model discovery", () => {
	function discoveryServer(ids: string[], key = "cpk-test-1"): { port: number; stop: () => void } {
		const server = Bun.serve({
			port: 0,
			fetch(req) {
				if (req.headers.get("authorization") !== `Bearer ${key}`) {
					return new Response("nope", { status: 401 });
				}
				return Response.json({ data: ids.map((id) => ({ id })) });
			},
		});
		return { port: server.port, stop: () => server.stop(true) };
	}

	test("imports NEW chat-model ids; keeps existing records byte-identical", async () => {
		const srv = discoveryServer(["m-a", "m-b", "m-new-1", "m-new-2"]);
		try {
			upsertProvider(
				DIR,
				agnes({ baseUrl: `http://127.0.0.1:${srv.port}/v1`, modelId: "m-a", extraModelIds: ["m-b"] }),
			);
			// curate m-b's metadata by hand
			const raw = rawModels();
			raw.providers.agnes.models.find((m: any) => m.id === "m-b").contextWindow = 999999;
			writeFileSync(join(DIR, "models.json"), JSON.stringify(raw, null, 2));

			const result = await refreshProviderModels(DIR, "agnes");
			expect(result.found).toBe(true);
			expect(result.added).toEqual(["m-new-1", "m-new-2"]);
			expect(result.missing).toEqual([]);
			const after = rawModels().providers.agnes.models;
			expect(after.map((m: any) => m.id)).toEqual(["m-a", "m-b", "m-new-1", "m-new-2"]);
			expect(after.find((m: any) => m.id === "m-b").contextWindow).toBe(999999); // curated survives
			expect(after.find((m: any) => m.id === "m-new-1")).toMatchObject({ contextWindow: 131072, maxTokens: 8192 });
		} finally {
			srv.stop();
		}
	});

	test("non-chat ids (embeddings, image/video/audio gen, moderation) are filtered out", async () => {
		const srv = discoveryServer([
			"chat-1",
			"text-embedding-3-small",
			"bge-small-en",
			"whisper-1",
			"tts-1",
			"gpt-image-1",
			"video-gen",
			"omni-moderation-latest",
		]);
		try {
			upsertProvider(DIR, agnes({ baseUrl: `http://127.0.0.1:${srv.port}/v1`, modelId: "chat-1" }));
			const result = await refreshProviderModels(DIR, "agnes");
			expect(result.added).toEqual([]); // chat-1 already registered; everything else filtered
			expect(result.served).toEqual(["chat-1"]); // the filtered view of what counts
		} finally {
			srv.stop();
		}
	});

	test("looksLikeChatModel — the filter table", () => {
		for (const id of [
			"gpt-4o",
			"claude-sonnet-4-5",
			"agnes-3.0-flash",
			"qwen3.7-plus",
			"deepseek-chat",
			"pixtral-12b",
			"llava-1.5",
		]) {
			expect(looksLikeChatModel(id)).toBe(true);
		}
		for (const id of [
			"text-embedding-ada-002",
			"bge-base-en",
			"whisper-large-v3",
			"tts-1-hd",
			"dall-e-3",
			"gpt-image-1",
			"flux-pro",
			"stable-diffusion-xl",
			"omni-moderation-latest",
			"agnes-video-2.5-flash",
			"agnes-image-2.5-flash",
			"bge-reranker-v2",
		]) {
			expect(looksLikeChatModel(id)).toBe(false);
		}
	});

	test("ids the endpoint stopped serving are REPORTED, not removed", async () => {
		const srv = discoveryServer(["m-a"]);
		try {
			upsertProvider(
				DIR,
				agnes({ baseUrl: `http://127.0.0.1:${srv.port}/v1`, modelId: "m-a", extraModelIds: ["m-gone"] }),
			);
			const result = await refreshProviderModels(DIR, "agnes");
			expect(result.added).toEqual([]);
			expect(result.missing).toEqual(["m-gone"]);
			expect(rawModels().providers.agnes.models.map((m: any) => m.id)).toEqual(["m-a", "m-gone"]); // kept
		} finally {
			srv.stop();
		}
	});

	test("a rejected credential reports problem:auth; unreachable reports it too", async () => {
		const srv = discoveryServer(["m-a"], "right-key");
		try {
			upsertProvider(
				DIR,
				agnes({ baseUrl: `http://127.0.0.1:${srv.port}/v1`, modelId: "m-a", apiKeyInAuthJson: "wrong-key" }),
			);
			const rejected = await refreshProviderModels(DIR, "agnes");
			expect(rejected.problem).toContain("rejected");
			expect(rejected.probe?.problem).toBe("auth");
		} finally {
			srv.stop();
		}
		upsertProvider(DIR, agnes({ baseUrl: "http://127.0.0.1:9/v1", modelId: "m-a" }));
		const unreachable = await refreshProviderModels(DIR, "agnes");
		expect(unreachable.problem).toContain("unreachable");
	});

	test("a vision-capable provider's new models inherit image input", async () => {
		// provider registered with image input (like the agnes preset)
		const vision = discoveryServer(["m-a", "m-vision-new"]);
		try {
			upsertProvider(DIR, agnes({ baseUrl: `http://127.0.0.1:${vision.port}/v1`, modelId: "m-a" }));
			await refreshProviderModels(DIR, "agnes");
			expect(rawModels().providers.agnes.models.find((m: any) => m.id === "m-vision-new").input).toEqual([
				"text",
				"image",
			]);
		} finally {
			vision.stop();
		}
	});

	test("a text-only provider's new models stay text-only", async () => {
		const textOnly = discoveryServer(["t-a", "t-new"]);
		try {
			upsertProvider(
				DIR,
				agnes({ baseUrl: `http://127.0.0.1:${textOnly.port}/v1`, modelId: "t-a", input: ["text"] }),
			);
			await refreshProviderModels(DIR, "agnes");
			expect(rawModels().providers.agnes.models.find((m: any) => m.id === "t-new").input).toEqual(["text"]);
		} finally {
			textOnly.stop();
		}
	});

	test("unknown provider → found:false; in-sync → no writes", async () => {
		const missing = await refreshProviderModels(DIR, "ghost");
		expect(missing.found).toBe(false);

		const srv = discoveryServer(["m-a"]);
		try {
			upsertProvider(DIR, agnes({ baseUrl: `http://127.0.0.1:${srv.port}/v1`, modelId: "m-a" }));
			const before = readFileSync(join(DIR, "models.json"), "utf8");
			const inSync = await refreshProviderModels(DIR, "agnes");
			expect(inSync.added).toEqual([]);
			expect(inSync.missing).toEqual([]);
			expect(readFileSync(join(DIR, "models.json"), "utf8")).toBe(before); // byte-identical
		} finally {
			srv.stop();
		}
	});
});

// ---------------------------------------------------------------------------
// keyStatusLabel
// ---------------------------------------------------------------------------

describe("keyStatusLabel", () => {
	test("labels for every key source", () => {
		expect(keyStatusLabel({ id: "x", modelIds: [], keyStatus: "auth-json", isDefault: false })).toBe(
			"key: auth.json",
		);
		expect(keyStatusLabel({ id: "x", modelIds: [], keyStatus: "models-json", isDefault: false })).toBe(
			"key: in models.json",
		);
		expect(keyStatusLabel({ id: "x", modelIds: [], keyStatus: "env-ref", keyEnv: "MY_KEY", isDefault: false })).toBe(
			"key: $MY_KEY",
		);
		expect(keyStatusLabel({ id: "x", modelIds: [], keyStatus: "none", isDefault: false })).toBe("key: none");
	});
});

// ---------------------------------------------------------------------------
// secureFilePermissions
// ---------------------------------------------------------------------------

describe("secureFilePermissions", () => {
	test("POSIX: chmod 0600 (no-op safe on any platform)", () => {
		const f = join(DIR, "secret.json");
		writeFileSync(f, "{}");
		secureFilePermissions(f);
		if (process.platform !== "win32") {
			// eslint-disable-next-line no-bitwise
			expect(statSync(f).mode & 0o777).toBe(0o600);
		}
		// Windows: the icacls branch is exercised by the win32 CI leg;
		// here we only pin that the call never throws.
	});
});
