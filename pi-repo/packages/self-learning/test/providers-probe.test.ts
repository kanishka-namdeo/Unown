/**
 * providers-probe.test.ts — the 2026-10-30 provider-workflow hardening round:
 *
 *   - wire-aware probing: anthropic-messages providers authenticate with
 *     `x-api-key` + `anthropic-version` and list {root}/v1/models; the old
 *     Bearer-only probe false-401'd a perfectly good Anthropic key
 *   - rate-limit classification: a 429 is NOT "unreachable" — the endpoint is
 *     up, the key passed auth, only the throttle is in the way (the Claude
 *     Code "temporarily limiting requests, not your usage limit" distinction)
 *   - probe latency: every answered probe carries `ms` for the doctor/test
 *     latency chip
 *   - sanitizeApiKey: paste hygiene (trim, strip line breaks) + rejection with
 *     a diagnosis that never echoes the value
 *   - removeProvider: a survivor with no models leaves defaultModel UNSET
 *     (never the bogus "" the old fallback wrote)
 *   - turn-meter TTFT: the first-token chip renders only when observed
 */
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeLatencyNote, probeProviderEndpoint, rateLimitNote } from "../src/probe.ts";
import { type ProviderEntry, removeProvider, sanitizeApiKey, upsertProvider } from "../src/providers.ts";
import { formatTurnMeter } from "../src/turn-meter.ts";

let DIR = "";
beforeEach(() => {
	DIR = mkdtempSync(join(tmpdir(), "unown-probe-test-"));
});
afterAll(() => {
	rmSync(DIR, { recursive: true, force: true });
});

/** The agnes-shaped entry the other provider tests use. */
function agnes(over: Partial<ProviderEntry> = {}): ProviderEntry {
	return {
		id: "agnes",
		name: "Agnes AI",
		baseUrl: "https://apihub.agnes-ai.com/v1",
		api: "openai-completions",
		modelId: "agnes-3.0-flash",
		input: ["text", "image"],
		...over,
	};
}

// ---------------------------------------------------------------------------
// Wire-aware probing
// ---------------------------------------------------------------------------

describe("probeProviderEndpoint — wire-aware auth", () => {
	let server: ReturnType<typeof Bun.serve> | null = null;
	const seen: {
		authorization: string | null;
		xApiKey: string | null;
		anthropicVersion: string | null;
		path: string;
	}[] = [];
	afterAll(() => {
		server?.stop(true);
	});

	test("anthropic-messages wire: x-api-key + anthropic-version, {root}/v1/models, NO Bearer", async () => {
		server = Bun.serve({
			port: 0,
			fetch(req) {
				const url = new URL(req.url);
				seen.push({
					authorization: req.headers.get("authorization"),
					xApiKey: req.headers.get("x-api-key"),
					anthropicVersion: req.headers.get("anthropic-version"),
					path: url.pathname,
				});
				return Response.json({ data: [{ id: "claude-sonnet-4-5" }] });
			},
		});
		const probe = await probeProviderEndpoint(`http://127.0.0.1:${server.port}`, "sk-ant-valid", {
			api: "anthropic-messages",
		});
		expect(probe.ok).toBe(true);
		expect(probe.models).toEqual(["claude-sonnet-4-5"]);
		const last = seen[seen.length - 1];
		expect(last.path).toBe("/v1/models");
		expect(last.xApiKey).toBe("sk-ant-valid");
		expect(last.anthropicVersion).toBe("2023-06-01");
		expect(last.authorization).toBeNull();
	});

	test("openai-completions wire: Authorization Bearer, {base}/models", async () => {
		const probe = await probeProviderEndpoint(`http://127.0.0.1:${(server as { port: number }).port}/v1`, "cpk-key", {
			api: "openai-completions",
		});
		expect(probe.ok).toBe(true);
		const last = seen[seen.length - 1];
		expect(last.path).toBe("/v1/models");
		expect(last.authorization).toBe("Bearer cpk-key");
		expect(last.xApiKey).toBeNull();
	});

	test("a 429 is rate-limit, never unreachable — and carries latency", async () => {
		let hit = false;
		const throttled = Bun.serve({
			port: 0,
			fetch() {
				hit = true;
				return new Response(JSON.stringify({ error: "slow down" }), { status: 429 });
			},
		});
		try {
			const probe = await probeProviderEndpoint(`http://127.0.0.1:${throttled.port}/v1`, "k", {});
			expect(hit).toBe(true);
			expect(probe.ok).toBe(false);
			expect(probe.problem).toBe("rate-limit");
			expect(probe.status).toBe(429);
			expect(typeof probe.ms).toBe("number");
			expect(rateLimitNote(probe)).toContain("rate-limited (HTTP 429)");
			expect(rateLimitNote(probe)).toContain("up and throttling");
			expect(probeLatencyNote(probe)).toMatch(/^ · \d+ ms$/);
		} finally {
			throttled.stop(true);
		}
	});

	test("nothing answered → unreachable without ms", async () => {
		const probe = await probeProviderEndpoint("http://127.0.0.1:9/v1", "k", { timeoutMs: 500 });
		expect(probe.ok).toBe(false);
		expect(probe.problem).toBe("unreachable");
		expect(probe.ms).toBeUndefined();
		expect(probeLatencyNote(probe)).toBe("");
	});
});

// ---------------------------------------------------------------------------
// Key paste hygiene
// ---------------------------------------------------------------------------

describe("sanitizeApiKey", () => {
	test("trims surrounding whitespace (the classic paste)", () => {
		expect(sanitizeApiKey("  cpk-abc123  \n").key).toBe("cpk-abc123");
	});
	test("strips stray CR/LF line breaks inside an otherwise clean key", () => {
		expect(sanitizeApiKey("cpk-abc\r\n").key).toBe("cpk-abc");
	});
	test("rejects inner whitespace with a diagnosis that never echoes the value", () => {
		const res = sanitizeApiKey("cpk-abc def");
		expect(res.key).toBe("");
		expect(res.problem).toContain("whitespace");
		expect(res.problem).not.toContain("cpk-abc");
	});
	test("rejects control characters", () => {
		const res = sanitizeApiKey("cpk-abc\u0000def");
		expect(res.key).toBe("");
		expect(res.problem).toContain("control characters");
	});
	test("bridge placeholders pass through", () => {
		expect(sanitizeApiKey("bridge-local").key).toBe("bridge-local");
		expect(sanitizeApiKey("bridge-background").key).toBe("bridge-background");
	});
	test("empty stays empty (keyless is a valid choice)", () => {
		expect(sanitizeApiKey("   ").key).toBe("");
	});
});

// ---------------------------------------------------------------------------
// removeProvider: survivor without models leaves defaultModel unset
// ---------------------------------------------------------------------------

describe("removeProvider — the empty-defaultModel guard", () => {
	test('a survivor with no models keeps defaultProvider but drops defaultModel (never "")', () => {
		upsertProvider(DIR, agnes());
		upsertProvider(DIR, {
			id: "empty-guy",
			name: "No models yet",
			baseUrl: "https://example.invalid/v1",
			api: "openai-completions",
			modelId: "placeholder",
			input: ["text"],
		});
		// hand-strip the survivor's models, as a hand-edit would
		const modelsPath = join(DIR, "models.json");
		const raw = JSON.parse(readFileSync(modelsPath, "utf8")) as { providers: Record<string, { models?: unknown[] }> };
		raw.providers["empty-guy"].models = [];
		writeFileSync(modelsPath, JSON.stringify(raw, null, 2));
		// make the empty one the default, then remove it → survivor = agnes… no:
		// remove agnes (the default) → survivor = empty-guy (no models)
		const res = removeProvider(DIR, "agnes");
		expect(res.removed).toBe(true);
		expect(res.wasDefault).toBe(true); // agnes was the default (first provider)
		const settings = JSON.parse(readFileSync(join(DIR, "settings.json"), "utf8")) as {
			defaultProvider?: string;
			defaultModel?: string;
		};
		expect(settings.defaultProvider).toBe("empty-guy");
		expect(settings.defaultModel === "").toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Turn meter TTFT chip
// ---------------------------------------------------------------------------

describe("formatTurnMeter — the TTFT chip", () => {
	const base = {
		usage: { tokensIn: 1000, tokensOut: 100, cacheRead: 0, model: "agnes-3.0-flash" },
		durationMs: 3400,
		env: {},
	} as const;

	test("renders ttft between turn and ctx when observed", () => {
		const res = formatTurnMeter({ ...base, firstTokenMs: 830, context: { tokens: 10, contextWindow: 100 } });
		expect(res.text).toContain("turn 3.4s");
		expect(res.text).toContain("ttft <1s");
		expect(res.text.indexOf("ttft")).toBeGreaterThan(res.text.indexOf("turn"));
		expect(res.text.indexOf("ttft")).toBeLessThan(res.text.indexOf("ctx"));
	});
	test("omits ttft when the host could not observe it", () => {
		const res = formatTurnMeter({ ...base });
		expect(res.text).not.toContain("ttft");
	});
	test("omits ttft for a non-finite value", () => {
		const res = formatTurnMeter({ ...base, firstTokenMs: Number.NaN });
		expect(res.text).not.toContain("ttft");
	});
});
