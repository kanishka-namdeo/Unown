// Integration-test harness for the self-learning engine (Phase 2 layer).
//
// Boots the REAL engine server (src/server.ts startServer) in-process on an
// ephemeral port with throwaway DATA_DIR / DB_PATH / UNOWN_HOME, pointed at a
// MOCK OpenAI-compatible llm-bridge — docs/testing-strategy.md §4.2
// "Integration (real server, temp DB/data, mocked bridge)". The live stack
// (engine :3030, bridge :3031, serving the benchmark queue) is never touched:
// both servers here bind port 0 (OS-assigned ephemeral) and all state lives
// under /tmp/selflearning-it-<rand>/.
//
// Scope guard — WHY this suite only runs under `bun run test:integration`:
// bun test executes every test file in ONE process with a shared module
// registry, and src/store.ts opens its SQLite database (from env) at module
// scope. The unit suite (test/*.test.ts) claims PI_SELFLEARNING_* via
// test/_env.ts as soon as its first file loads; test/integration/ sorts
// between them, so an unguarded harness could not tell "standalone" from
// "combined" and would either run against the unit fixtures or shadow
// test/_env.ts and trip the unit suite's isolation tripwires. The package
// script therefore sets PI_TEST_SCOPE=integration for the dedicated run;
// without it every test below skips (visible as one skipped sentinel test).
// After startEngine() claims the env it hard-verifies that src/store.ts
// resolved to OUR temp paths, so this suite can never silently hit the live
// engine database no matter how it was invoked.
//
// Env knobs the code already reads (src is NOT modified for tests):
//   PI_SELFLEARNING_DATA / PI_SELFLEARNING_DB / PI_BRIDGE_URL  (store.ts)
//   PI_PROVIDER / PI_MODEL_ID                                  (runner.ts)
//   UNOWN_HOME                                                  (term.ts)
//   UNOWN_OS_SANDBOX=0  — engine sandbox commands use the TS path-jail
//   fallback; the bwrap profile itself is covered by scripts/bwrap_smoke.sh
//   + scripts/verify_sandbox.mjs (package AGENTS.md), not by this suite.
//
// Bridge contract served by the mock (mirrors mini-services/llm-bridge):
//   GET  /health       → same JSON shape as the real bridge /health
//   GET  /v1/log       → { log, requests, errors }
//   GET  /v1/models    → { object: "list", data: [...] }
//   POST /v1/chat/completions:
//     · stream:false (llm.ts — mining/dream/mint)  → JSON completion whose
//       content embeds a valid MiningResult JSON object.
//     · stream:true  (pi agent loop, openai-completions api) → SSE chunks
//       with content + finish_reason "stop" + usage, then `data: [DONE]`.
//   All requests are recorded for assertions.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** True only under the dedicated script (`PI_TEST_SCOPE=integration`). */
export const INTEGRATION_ACTIVE = process.env.PI_TEST_SCOPE === "integration";

// ---------------------------------------------------------------------------
// Mock bridge
// ---------------------------------------------------------------------------

/** One recorded POST /v1/chat/completions request. */
export interface MockChatRequest {
	ts: number;
	model: string;
	stream: boolean;
	messages: number;
	tools: number;
}

export interface MockBridge {
	port: number;
	url: string;
	requests: MockChatRequest[];
	/** Artificial per-request latency (ms) — kept 0; available for determinism. */
	delayMs: number;
	close(): void;
}

/** Agent-loop reply (requests carry tools → this is the pi agent turn). */
const AGENT_TEXT =
	"Integration mock model: I cannot modify the implementation file in this controlled run, so the task stays unfixed.";

/**
 * Learning-layer reply (no tools → llm.ts chatJson callers: failure mining,
 * dream consolidation, task minting). Must contain a JSON object because
 * llm.ts extractJson() slices from first { to last }.
 */
const MINER_JSON = JSON.stringify({
	diagnosis: "integration mock diagnosis",
	proposal: "integration mock proposal",
	patchLines: ["- Always run the verify tests before declaring success."],
	targetTier: "project",
});

export function startMockBridge(): MockBridge {
	let chatCount = 0;
	const requests: MockChatRequest[] = [];
	const state: MockBridge = {
		port: 0,
		url: "",
		requests,
		delayMs: 0,
		close: () => {},
	};
	let seq = 0;

	const server = Bun.serve({
		port: 0, // OS-assigned ephemeral port — never the live bridge's 3031
		async fetch(req) {
			const url = new URL(req.url);

			if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
				// Exact shape of the real llm-bridge /health (mini-services/llm-bridge/index.ts).
				return Response.json({
					ok: true,
					port: state.port,
					requests: chatCount,
					errors: 0,
					upstream: { ok: true, status: 200 },
					upstreamKeyIsSet: true,
					authRequired: false,
					upstreamUrl: `${state.url}/v1`,
					defaultModel: "mock-kimi",
					models: ["mock-kimi"],
				});
			}

			if (req.method === "GET" && url.pathname === "/v1/log") {
				return Response.json({ log: requests.slice(-200), requests: chatCount, errors: 0 });
			}

			if (req.method === "GET" && url.pathname === "/v1/models") {
				return Response.json({
					object: "list",
					data: [
						{
							id: "mock-kimi",
							object: "model",
							created: Math.floor(Date.now() / 1000),
							owned_by: "llm-bridge",
						},
					],
				});
			}

			if (
				req.method === "POST" &&
				(url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")
			) {
				chatCount++;
				const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
				const wantsStream = body.stream === true;
				requests.push({
					ts: Date.now(),
					model: String(body.model ?? "?"),
					stream: wantsStream,
					messages: Array.isArray(body.messages) ? body.messages.length : 0,
					tools: Array.isArray(body.tools) ? body.tools.length : 0,
				});
				if (state.delayMs > 0) await Bun.sleep(state.delayMs);
				const model = String(body.model ?? "mock-kimi");
				// The pi agent loop always registers tools; the learning-layer
				// chatJson calls (miner/dream/mint) never do.
				const content = Array.isArray(body.tools) && body.tools.length > 0 ? AGENT_TEXT : MINER_JSON;
				return wantsStream ? streamCompletion(model, content) : jsonCompletion(model, content);
			}

			return Response.json({ error: { message: `Not found: ${req.method} ${url.pathname}` } }, { status: 404 });
		},
	});

	function jsonCompletion(model: string, content: string): Response {
		return Response.json({
			id: `chatcmpl-mock-${++seq}`,
			object: "chat.completion",
			created: Math.floor(Date.now() / 1000),
			model,
			choices: [
				{
					index: 0,
					message: { role: "assistant", content },
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 17, completion_tokens: 13, total_tokens: 30 },
		});
	}

	function streamCompletion(model: string, content: string): Response {
		const id = `chatcmpl-mock-${++seq}`;
		const created = Math.floor(Date.now() / 1000);
		const frame = (choices: unknown[], usage?: unknown) =>
			new TextEncoder().encode(
				`data: ${JSON.stringify({
					id,
					object: "chat.completion.chunk",
					created,
					model,
					choices,
					...(usage ? { usage } : {}),
				})}\n\n`,
			);
		const done = new TextEncoder().encode("data: [DONE]\n\n");
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(frame([{ index: 0, delta: { role: "assistant" }, finish_reason: null }]));
				controller.enqueue(frame([{ index: 0, delta: { content }, finish_reason: null }]));
				controller.enqueue(
					frame([{ index: 0, delta: {}, finish_reason: "stop" }], {
						prompt_tokens: 17,
						completion_tokens: 13,
						total_tokens: 30,
					}),
				);
				controller.enqueue(done);
				controller.close();
			},
		});
		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	}

	state.port = server.port;
	state.url = `http://127.0.0.1:${server.port}`;
	state.close = () => server.stop(true);
	return state;
}

// ---------------------------------------------------------------------------
// Engine (real startServer, temp state, ephemeral port)
// ---------------------------------------------------------------------------

export interface EngineHandle {
	/** The Bun server returned by the real startServer(). */
	server: { port: number; stop: (stopActiveConnections?: boolean) => void };
	port: number;
	baseUrl: string;
	dataDir: string;
	dbPath: string;
	unownHome: string;
	bridge: MockBridge;
	close(): Promise<void>;
}

/**
 * Start the real engine. Claims the env FIRST and only then imports
 * src/server.ts (dynamic import — static imports would hoist above any env
 * assignment and re-open the live database). startServer() itself is called
 * with port 0: an OS-assigned ephemeral port that can never collide with the
 * live engine (:3030) or bridge (:3031).
 */
export async function startEngine(bridge: MockBridge): Promise<EngineHandle> {
	const root = mkdtempSync(join(tmpdir(), "selflearning-it-"));
	const dataDir = join(root, "data");
	const dbPath = join(root, "db", "selflearning.db");
	const unownHome = join(root, "unown-home");

	process.env.PI_SELFLEARNING_DATA = dataDir;
	process.env.PI_SELFLEARNING_DB = dbPath;
	process.env.PI_BRIDGE_URL = bridge.url;
	process.env.PI_MODEL_ID = "mock-kimi";
	process.env.PI_PROVIDER = "mock-bridge";
	process.env.UNOWN_HOME = unownHome;
	process.env.UNOWN_OS_SANDBOX = "0";

	const store = await import("../../src/store.ts");
	// Hard isolation guard: if anything imported src/ before us the singletons
	// point somewhere else — refuse to run rather than touch foreign state.
	if (store.DATA_DIR !== dataDir || store.DB_PATH !== dbPath || store.BRIDGE_URL !== bridge.url) {
		throw new Error(
			`engine is not isolated (DATA_DIR=${store.DATA_DIR}, DB_PATH=${store.DB_PATH}, BRIDGE_URL=${store.BRIDGE_URL}) — refusing to test`,
		);
	}

	const { startServer } = await import("../../src/server.ts");
	const server = startServer(0);
	if (server.port === 3030 || server.port === 3031) {
		server.stop(true);
		throw new Error(`engine bound a live-service port (${server.port}) — aborting`);
	}

	const handle: EngineHandle = {
		server,
		port: server.port,
		baseUrl: `http://127.0.0.1:${server.port}`,
		dataDir,
		dbPath,
		unownHome,
		bridge,
		close: async () => {
			// Stop the HTTP server and the router scheduler (setInterval in
			// router.start) so nothing outlives the suite.
			try {
				server.stop(true);
			} catch {
				/* already stopped */
			}
			try {
				const { router } = await import("../../src/router.ts");
				router.stop();
			} catch {
				/* ignore */
			}
			try {
				rmSync(root, { recursive: true, force: true });
			} catch {
				/* WAL files can race teardown on slow disks — /tmp is janitor-swept */
			}
		},
	};
	return handle;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Poll cond() until it returns non-nullish; throws on timeout. */
export async function waitFor<T>(
	cond: () => Promise<T | null | undefined>,
	opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
	const timeoutMs = opts.timeoutMs ?? 30_000;
	const intervalMs = opts.intervalMs ?? 500;
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await cond();
		if (value !== null && value !== undefined) return value;
		if (Date.now() >= deadline) {
			throw new Error(`waitFor timed out after ${timeoutMs}ms${opts.label ? `: ${opts.label}` : ""}`);
		}
		await Bun.sleep(intervalMs);
	}
}

export interface SseEvent {
	event: string;
	payload: Record<string, unknown>;
	ts: number;
}

/** Minimal SSE reader for GET /api/events frames (`data: {json}\n\n`). */
export class SseClient {
	private reader: ReadableStreamDefaultReader<Uint8Array>;
	private decoder = new TextDecoder();
	private buffer = "";

	constructor(res: Response) {
		this.reader = res.body!.getReader();
	}

	async next(timeoutMs = 15_000): Promise<SseEvent> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const idx = this.buffer.indexOf("\n\n");
			if (idx !== -1) {
				const frame = this.buffer.slice(0, idx);
				this.buffer = this.buffer.slice(idx + 2);
				const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
				if (dataLine) return JSON.parse(dataLine.slice(6)) as SseEvent;
				continue;
			}
			const remaining = deadline - Date.now();
			if (remaining <= 0) throw new Error(`SseClient.next timed out after ${timeoutMs}ms`);
			const chunk = await this.withTimeout(this.reader.read(), remaining);
			if (chunk.done) throw new Error("SSE stream closed before the next event");
			this.buffer += this.decoder.decode(chunk.value, { stream: true });
		}
	}

	/** Client disconnect — cancels the stream (server must survive this). */
	abort(): void {
		try {
			void this.reader.cancel();
		} catch {
			/* already closed */
		}
	}

	private async withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const guard = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error("timeout")), ms);
		});
		try {
			return await Promise.race([p, guard]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}
}

/** JSON POST helper. */
export async function postJson(url: string, body: unknown): Promise<Response> {
	return fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}
