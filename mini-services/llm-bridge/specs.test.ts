// Serving-layer SPEC tests for mini-services/llm-bridge/index.ts (the
// model-specs round).
//
// Same harness pattern as failover.test.ts: the REAL bridge spawns as a
// subprocess (BRIDGE_PORT=0) against in-process mock upstreams on the
// loopback — hermetic, offline, CI-safe.
//
// Scenario matrix:
//   1. an upstream /models with spec fields (vLLM max_model_len shape) →
//      /v1/models passes them through per entry; /health reports modelSpecs
//   2. a context-overflow 400 on a pass-through request → learned into
//      model-specs-learned.json (once, not per retry) and surfaced in /health
//   3. a 400 on a ROUTED request (unknown id → route default) teaches
//      NOTHING — the error describes the default model's limits, not the id
//   4. an id-only upstream catalog → /v1/models stays id-only, /health
//      reports no modelSpecs
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface MockUpstreamState {
	requests: Array<{ path: string; model?: string }>;
	chatStatus: number;
	chatBody: any;
	modelsBody: any;
}

function startMockUpstream(modelsBody: any): { url: string; state: MockUpstreamState; stop: () => void } {
	const state: MockUpstreamState = { requests: [], chatStatus: 200, chatBody: {}, modelsBody };
	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			// both spellings: the bridge points BRIDGE_UPSTREAM_URL at …/v1,
			// so its probes hit /v1/models — accept the root form too
			if (req.method === "GET" && (url.pathname === "/models" || url.pathname === "/v1/models")) {
				state.requests.push({ path: "/models" });
				return Response.json(state.modelsBody);
			}
			if (req.method === "POST" && (url.pathname === "/chat/completions" || url.pathname === "/v1/chat/completions")) {
				const body = await req.json().catch(() => ({}));
				state.requests.push({ path: "/chat/completions", model: String(body.model ?? "?") });
				if (state.chatStatus !== 200) return Response.json(state.chatBody, { status: state.chatStatus });
				return Response.json({
					id: "chatcmpl-ok",
					model: body.model,
					choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
					usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
				});
			}
			return Response.json({ error: { message: "not found" } }, { status: 404 });
		},
	});
	return { url: `http://127.0.0.1:${server.port}`, state, stop: () => server.stop(true) };
}

interface BridgeProc {
	proc: Bun.Subprocess<"ignore", "pipe", "inherit">;
	url: string;
	stdoutText: () => string;
	stateDir: string;
}

function spawnBridge(extraEnv: Record<string, string>): BridgeProc {
	const clean: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (v === undefined) continue;
		if (/^(BRIDGE_|UNOWN_|PI_)/.test(k)) continue;
		clean[k] = v;
	}
	const stateDir = mkdtempSync(join(tmpdir(), "bridge-specs-"));
	const proc = Bun.spawn(["bun", "index.ts"], {
		cwd: import.meta.dir,
		env: {
			...clean,
			BRIDGE_PORT: "0",
			BRIDGE_MODEL: "agnes-3.0-flash",
			BRIDGE_ROUTE_DEFAULT: "agnes-3.0-flash",
			BRIDGE_KNOWN_MODELS: "agnes-3.0-flash",
			BRIDGE_UPSTREAM_TIMEOUT_MS: "8000",
			BRIDGE_MIN_SPACING_MS: "1",
			BRIDGE_MAX_ATTEMPTS: "1",
			UNOWN_BRIDGE_STATE_DIR: stateDir,
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
	return { proc, url: "", stdoutText: () => chunks.join(""), stateDir };
}

async function waitForReady(b: BridgeProc, timeoutMs = 30_000): Promise<string> {
	const re = /listening on http:\/\/127\.0\.0\.1:(\d+)/;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const m = b.stdoutText().match(re);
		if (m) return `http://127.0.0.1:${m[1]}`;
		await Bun.sleep(50);
	}
	throw new Error(`bridge subprocess did not print its listening line; stdout: ${b.stdoutText().slice(0, 600)}`);
}

async function waitUntil(cond: () => boolean, timeoutMs = 10_000, what = "condition"): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (cond()) return;
		await Bun.sleep(50);
	}
	throw new Error(`timed out waiting for ${what}`);
}

const OVERFLOW_400 = {
	error: {
		message: "This model's maximum context length is 32768 tokens. However, your messages resulted in 40000 tokens. Please reduce the length of the messages.",
		type: "invalid_request_error",
		code: "context_length_exceeded",
	},
};

describe("llm-bridge — the model-specs round (serving)", () => {
	let upstream: ReturnType<typeof startMockUpstream>;
	let bridge: BridgeProc;

	beforeAll(async () => {
			upstream = startMockUpstream({
				object: "list",
				data: [
					{ id: "agnes-3.0-flash", object: "model", max_model_len: 524288, max_completion_tokens: 65536, pricing: { prompt: "0.001" }, description: "noise" },
				{ id: "agnes-2.5-flash", object: "model", max_model_len: 524288 },
			],
	
	}, 60_000);
		bridge = spawnBridge({
			BRIDGE_UPSTREAM_URL: `${upstream.url}/v1`,
			BRIDGE_UPSTREAM_KEY: "test-key",
		});
		bridge.url = await waitForReady(bridge);
		// the boot-time catalog probe is async — wait for it to land
		await waitUntil(() => bridge.stdoutText().includes("upstream catalog"), 15_000, "the boot catalog probe");
	});

	afterAll(() => {
		bridge?.proc.kill();
		upstream?.stop();
		rmSync(bridge?.stateDir ?? "/tmp/none", { recursive: true, force: true });
	});

	test("/v1/models passes the upstream's spec fields through per entry (the DeepInfra precedent)", async () => {
		const res = await fetch(`${bridge.url}/v1/models`);
		expect(res.ok).toBe(true);
		const body = (await res.json()) as { data: Array<Record<string, any>> };
		const agnes30 = body.data.find((m) => m.id === "agnes-3.0-flash");
		expect(agnes30).toBeDefined();
		expect(agnes30.max_model_len).toBe(524288);
		expect(agnes30.max_completion_tokens).toBe(65536);
		// catalog noise never rides the passthrough
		expect(agnes30.pricing).toBeUndefined();
		expect(agnes30.description).toBeUndefined();
		const agnes25 = body.data.find((m) => m.id === "agnes-2.5-flash");
		expect(agnes25.max_model_len).toBe(524288);
		expect(agnes25.max_completion_tokens).toBeUndefined();
	});

	test("/health reports modelSpecs (by id) once the catalog probe landed", async () => {
		const res = await fetch(`${bridge.url}/health`);
		const body = (await res.json()) as { modelSpecs?: Record<string, any>; learnedSpecs?: Record<string, any> };
		expect(body.modelSpecs?.["agnes-3.0-flash"]).toEqual({ contextWindow: 524288, maxTokens: 65536 });
		expect(body.modelSpecs?.["agnes-2.5-flash"]).toEqual({ contextWindow: 524288 });
		expect(body.learnedSpecs).toEqual({});
	});

	test("a context-overflow 400 on a PASS-THROUGH request is learned once and surfaced in /health", async () => {
		upstream.state.chatStatus = 400;
		upstream.state.chatBody = OVERFLOW_400;
		const res = await fetch(`${bridge.url}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: "agnes-3.0-flash", messages: [{ role: "user", content: "hi" }] }),
		});
		expect(res.status).toBe(400);
		const learnedFile = join(bridge.stateDir, "model-specs-learned.json");
		await waitUntil(() => existsSync(learnedFile), 10_000, "the learned-specs file");
		const learned = JSON.parse(readFileSync(learnedFile, "utf8"));
		expect(learned["agnes-3.0-flash"].contextWindow).toBe(32768);
		expect(learned["agnes-3.0-flash"].fromError).toContain("maximum context length");
		// a SECOND identical 400 must not rewrite the store
		const before = readFileSync(learnedFile, "utf8");
		await fetch(`${bridge.url}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: "agnes-3.0-flash", messages: [{ role: "user", content: "hi" }] }),
		});
		await Bun.sleep(300);
		expect(readFileSync(learnedFile, "utf8")).toBe(before);
		// /health surfaces it
		const health = (await (await fetch(`${bridge.url}/health`)).json()) as { learnedSpecs?: Record<string, any> };
		expect(health.learnedSpecs?.["agnes-3.0-flash"]?.contextWindow).toBe(32768);
		upstream.state.chatStatus = 200;
	});

	test("a 400 on a ROUTED request teaches nothing (the error describes the default model, not the asked id)", async () => {
		upstream.state.chatStatus = 400;
		upstream.state.chatBody = OVERFLOW_400;
		const res = await fetch(`${bridge.url}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: "not-in-the-allowlist", messages: [{ role: "user", content: "hi" }] }),
		});
		expect(res.status).toBe(400);
		await Bun.sleep(300);
		const learned = JSON.parse(readFileSync(join(bridge.stateDir, "model-specs-learned.json"), "utf8"));
		expect(learned["not-in-the-allowlist"]).toBeUndefined();
		upstream.state.chatStatus = 200;
	});
});

describe("llm-bridge — an id-only upstream catalog stays id-only", () => {
	let upstream: ReturnType<typeof startMockUpstream>;
	let bridge: BridgeProc;

	beforeAll(async () => {
		upstream = startMockUpstream({ object: "list", data: [{ id: "agnes-3.0-flash", object: "model" }] });
		bridge = spawnBridge({
			BRIDGE_UPSTREAM_URL: `${upstream.url}/v1`,
			BRIDGE_UPSTREAM_KEY: "test-key",
		});
		bridge.url = await waitForReady(bridge);
		await waitUntil(() => bridge.stdoutText().includes("upstream catalog"), 15_000, "the boot catalog probe");
	}, 60_000);

	afterAll(() => {
		bridge?.proc.kill();
		upstream?.stop();
		rmSync(bridge?.stateDir ?? "/tmp/none", { recursive: true, force: true });
	});

	test("/v1/models carries no spec fields; /health reports no modelSpecs", async () => {
		const models = (await (await fetch(`${bridge.url}/v1/models`)).json()) as { data: Array<Record<string, any>> };
		expect(models.data[0]).toEqual({
			id: "agnes-3.0-flash",
			object: "model",
			created: models.data[0].created,
			owned_by: "llm-bridge",
		});
		const health = (await (await fetch(`${bridge.url}/health`)).json()) as { modelSpecs?: Record<string, any> };
		expect(health.modelSpecs).toEqual({});
	});
});
