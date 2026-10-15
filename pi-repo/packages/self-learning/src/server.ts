/**
 * server.ts — REST + SSE API for the dashboard (mini-service on port 3030).
 */

import { emit, subscribe } from "./bus.ts";
import { dreamNotes, listDreams, runDream } from "./dream.ts";
import { getImprovement, listCycles, listImprovements, runCycle } from "./harness.ts";
import { bridgeHealth, bridgeLog } from "./llm.ts";
import { history, readTier, rollback, seedMemoryIfEmpty, snapshot, type Tier } from "./memory.ts";
import { ingestTerminalNote } from "./notes.ts";
import { syncNoteOutbox } from "./outbox.ts";
import { listJobs, router, setJobEnabled } from "./router.ts";
import { ensureAgentDir, getRun, listRuns, MODEL_ID, PROVIDER, runAgent } from "./runner.ts";
import { listSandboxes } from "./sandbox.ts";
import { store } from "./store.ts";
import { getTask, listTasks, seedTasks } from "./tasks.ts";

const PORT = Number(process.env.PI_AGENT_PORT ?? 3030);

export interface ApiRequest {
	method: string;
	path: string;
	query: URLSearchParams;
	body: any;
}

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
	});
}

export async function handleApi(req: ApiRequest): Promise<Response> {
	const { method, path, query, body } = req;

	try {
		// ------------------------------------------------------------------
		// Overview
		// ------------------------------------------------------------------
		if (method === "GET" && path === "/api/overview") {
			const runs = store.query<any>(
				`SELECT status, kind, tokens_in, tokens_out, tool_calls, started_at FROM runs ORDER BY started_at DESC LIMIT 500`,
			);
			const total = runs.length;
			const passed = runs.filter((r) => r.status === "passed").length;
			const failed = runs.filter((r) => r.status === "failed").length;
			const errors = runs.filter((r) => r.status === "error").length;
			const tasks = store.get<any>(`SELECT COUNT(*) AS c FROM tasks WHERE active = 1`);
			const shipped = store.get<any>(`SELECT COUNT(*) AS c FROM improvements WHERE status = 'shipped'`);
			const dreamsDone = store.get<any>(`SELECT COUNT(*) AS c FROM dreams WHERE status = 'done'`);
			const notesTotal = store.get<any>(`SELECT COUNT(*) AS c FROM notes`);
			const notesPending = store.get<any>(`SELECT COUNT(*) AS c FROM notes WHERE dream_id IS NULL`);
			const hookDenies = store.get<any>(`SELECT COUNT(*) AS c FROM hook_log WHERE decision = 'deny'`);
			const hookTotal = store.get<any>(`SELECT COUNT(*) AS c FROM hook_log`);
			const tokensIn = runs.reduce((a: number, r: any) => a + (r.tokens_in ?? 0), 0);
			const tokensOut = runs.reduce((a: number, r: any) => a + (r.tokens_out ?? 0), 0);
			const mem = snapshot();
			const bridge = await bridgeHealth();
			// pass-rate trend (last 20 task runs chronologically)
			const trendRuns = store
				.query<any>(
					`SELECT status, started_at FROM runs WHERE kind IN ('baseline','candidate','regression') ORDER BY started_at DESC LIMIT 20`,
				)
				.reverse();
			let acc = 0;
			const trend = trendRuns.map((r: any) => {
				acc += r.status === "passed" ? 1 : 0;
				return { ts: r.started_at, cumulativePass: acc };
			});
			return json({
				ok: true,
				agent: {
					name: "pi (badlogic/pi-mono)",
					layer: "self-learning v0.1",
					provider: `${PROVIDER}/${MODEL_ID}`,
					bridge,
				},
				kpis: {
					totalRuns: total,
					passed,
					failed,
					errors,
					passRate: total ? Math.round((passed / total) * 100) : 0,
					tasks: tasks?.c ?? 0,
					improvementsShipped: shipped?.c ?? 0,
					dreams: dreamsDone?.c ?? 0,
					notes: { total: notesTotal?.c ?? 0, pending: notesPending?.c ?? 0 },
					hooks: { total: hookTotal?.c ?? 0, denies: hookDenies?.c ?? 0 },
					tokens: { in: tokensIn, out: tokensOut },
				},
				memoryVersions: Object.fromEntries(mem.map((m) => [m.tier, m.version])),
				trend,
				routerBusy: router.isBusy(),
			});
		}

		// ------------------------------------------------------------------
		// Tasks
		// ------------------------------------------------------------------
		if (method === "GET" && path === "/api/tasks") return json({ tasks: listTasks() });
		if (method === "GET" && /^\/api\/tasks\/[^/]+$/.test(path)) {
			const id = decodeURIComponent(path.split("/")[3]);
			const task = getTask(id);
			if (!task) return json({ error: "not found" }, 404);
			return json({ task });
		}
		if (method === "POST" && /^\/api\/tasks\/[^/]+\/run$/.test(path)) {
			const id = decodeURIComponent(path.split("/")[3]);
			if (!getTask(id)) return json({ error: "not found" }, 404);
			if (router.isBusy()) return json({ error: "engine busy — try again in a moment" }, 409);
			// fire and forget under the busy mutex — poll cycles/runs for progress
			router.withBusy(() => runCycle(id)).catch((e) => emit("router:error", { error: e?.message }));
			return json({ started: true, taskId: id });
		}

		// ------------------------------------------------------------------
		// Runs
		// ------------------------------------------------------------------
		if (method === "GET" && path === "/api/runs") {
			const limit = Math.min(Number(query.get("limit") ?? 50), 200);
			const taskId = query.get("task") ?? undefined;
			const kind = query.get("kind") ?? undefined;
			return json({ runs: listRuns(limit, taskId, kind) });
		}
		if (method === "GET" && /^\/api\/runs\/[^/]+$/.test(path)) {
			const id = path.split("/")[3];
			const run = getRun(id);
			if (!run) return json({ error: "not found" }, 404);
			return json({ run });
		}

		// ------------------------------------------------------------------
		// Interactive console
		// ------------------------------------------------------------------
		if (method === "POST" && path === "/api/agent/prompt") {
			const prompt = String(body?.prompt ?? "").trim();
			if (!prompt) return json({ error: "prompt required" }, 400);
			if (router.isBusy()) return json({ error: "engine busy with a background job — try again in a moment" }, 409);
			// fire and forget; the client polls /api/runs?kind=interactive
			router
				.withBusy(() =>
					runAgent({
						kind: "interactive",
						prompt,
						timeoutMs: 240_000,
						label: "console",
					}),
				)
				.catch((e) => emit("router:error", { error: e?.message }));
			return json({ started: true });
		}

		// ------------------------------------------------------------------
		// Memory
		// ------------------------------------------------------------------
		if (method === "GET" && path === "/api/memory") {
			return json({
				tiers: snapshot(),
				resolvedChars:
					readTier("policy").length +
					readTier("project").length +
					readTier("user").length +
					readTier("local").length,
			});
		}
		if (method === "GET" && /^\/api\/memory\/[^/]+\/history$/.test(path)) {
			const tier = decodeURIComponent(path.split("/")[3]) as Tier;
			return json({ history: history(tier, 40) });
		}
		if (method === "POST" && /^\/api\/memory\/[^/]+\/rollback$/.test(path)) {
			const tier = decodeURIComponent(path.split("/")[3]) as Tier;
			const version = Number(body?.version);
			if (!version) return json({ error: "version required" }, 400);
			rollback(tier, version, `dashboard rollback to v${version}`);
			return json({ ok: true });
		}

		// ------------------------------------------------------------------
		// Cycles & improvements
		// ------------------------------------------------------------------
		if (method === "GET" && path === "/api/cycles") return json({ cycles: listCycles(40) });
		if (method === "GET" && path === "/api/improvements") return json({ improvements: listImprovements(80) });
		if (method === "GET" && /^\/api\/improvements\/[^/]+$/.test(path)) {
			const id = path.split("/")[3];
			const imp = getImprovement(id);
			if (!imp) return json({ error: "not found" }, 404);
			return json({ improvement: imp });
		}

		// ------------------------------------------------------------------
		// Dreams
		// ------------------------------------------------------------------
		if (method === "GET" && path === "/api/dreams") return json({ dreams: listDreams(30) });
		if (method === "GET" && /^\/api\/dreams\/[^/]+\/notes$/.test(path)) {
			const id = path.split("/")[3];
			return json({ notes: dreamNotes(id) });
		}
		if (method === "POST" && path === "/api/dreams/run") {
			const pending = store.get<any>(`SELECT COUNT(*) AS c FROM notes WHERE dream_id IS NULL`)?.c ?? 0;
			if (pending < 1) return json({ skipped: "no undreamed notes" });
			if (router.isBusy()) return json({ error: "engine busy — try again in a moment" }, 409);
			router.withBusy(() => runDream()).catch((e) => emit("router:error", { error: e?.message }));
			return json({ started: true, pendingNotes: pending });
		}

		// ------------------------------------------------------------------
		// Hooks
		// ------------------------------------------------------------------
		if (method === "GET" && path === "/api/hooks") {
			const limit = Math.min(Number(query.get("limit") ?? 100), 500);
			const hooks = store.query<any>(`SELECT * FROM hook_log ORDER BY ts DESC LIMIT ?`, [limit]);
			return json({ hooks });
		}

		// ------------------------------------------------------------------
		// Notes
		// ------------------------------------------------------------------
		if (method === "GET" && path === "/api/notes") {
			const limit = Math.min(Number(query.get("limit") ?? 40), 200);
			const notes = store.query<any>(`SELECT * FROM notes ORDER BY created_at DESC LIMIT ?`, [limit]);
			return json({ notes });
		}
		if (method === "POST" && path === "/api/notes") {
			// Terminal-session note ingestion (called by the `unown` CLI).
			const content = typeof body?.content === "string" ? body.content.trim() : "";
			const projectPath = typeof body?.project_path === "string" ? body.project_path.trim() : "";
			if (!content || !projectPath) return json({ error: "content and project_path are required" }, 400);
			if (content.length > 20000) return json({ error: "note too large" }, 413);
			const id = ingestTerminalNote(content.slice(0, 20000), projectPath);
			return json({ ok: true, id });
		}
		if (method === "POST" && path === "/api/notes/sync") {
			const synced = syncNoteOutbox();
			return json({ ok: true, synced });
		}

		// ------------------------------------------------------------------
		// Routing jobs
		// ------------------------------------------------------------------
		if (method === "GET" && path === "/api/jobs") return json({ jobs: listJobs() });
		if (method === "POST" && /^\/api\/jobs\/[^/]+\/trigger$/.test(path)) {
			const id = path.split("/")[3];
			try {
				const result = await router.execute(id);
				return json({ ok: true, result });
			} catch (e: any) {
				return json({ error: e?.message ?? String(e) }, 409);
			}
		}
		if (method === "POST" && /^\/api\/jobs\/[^/]+\/toggle$/.test(path)) {
			const id = path.split("/")[3];
			const job = store.get<any>(`SELECT enabled FROM jobs WHERE id = ?`, [id]);
			if (!job) return json({ error: "not found" }, 404);
			const updated = setJobEnabled(id, !job.enabled);
			return json({ job: updated });
		}

		// ------------------------------------------------------------------
		// Sandboxes
		// ------------------------------------------------------------------
		if (method === "GET" && path === "/api/sandboxes") return json({ sandboxes: listSandboxes(60) });

		// ------------------------------------------------------------------
		// Bridge (llm gateway)
		// ------------------------------------------------------------------
		if (method === "GET" && path === "/api/bridge") {
			const stats = await bridgeLog();
			return json({ ...stats, url: "port 3031" });
		}

		return json({ error: `not found: ${method} ${path}` }, 404);
	} catch (err: any) {
		return json({ error: err?.message ?? String(err) }, 500);
	}
}

// ---------------------------------------------------------------------------
// Bun server with SSE event stream
// ---------------------------------------------------------------------------
/** Crash recovery: mark rows left 'running' by a previous process as errored. */
function recoverOrphans() {
	const now = Date.now();
	const orphRuns = store.run(
		`UPDATE runs SET status = 'error', ended_at = ?, error = 'orphaned by service restart' WHERE status = 'running'`,
		[now],
	);
	const orphCycles = store.run(
		`UPDATE cycles SET status = 'no-fix', ended_at = ?, summary = COALESCE(summary, '') || ' [aborted by service restart]' WHERE status = 'running'`,
		[now],
	);
	store.run(`UPDATE jobs SET status = 'idle' WHERE status = 'running'`);
	if (orphRuns.changes > 0 || orphCycles.changes > 0) {
		console.log(`[agent-service] recovered ${orphRuns.changes} orphaned runs, ${orphCycles.changes} orphaned cycles`);
	}
}

export function startServer(port: number = PORT) {
	ensureAgentDir();
	seedMemoryIfEmpty();
	seedTasks();
	recoverOrphans();
	const synced = syncNoteOutbox();
	if (synced > 0) console.log(`[agent-service] ingested ${synced} outbox note(s) from terminal sessions`);
	router.start().catch((e) => console.error("[router] failed to start:", e));

	const server = Bun.serve({
		port,
		idleTimeout: 255, // SSE streams + long-lived API connections
		async fetch(req) {
			const url = new URL(req.url);

			// SSE live event stream
			if (req.method === "GET" && url.pathname === "/api/events") {
				let unsub = () => {};
				const stream = new ReadableStream({
					start(controller) {
						const encoder = new TextEncoder();
						const send = (data: unknown) => {
							try {
								controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
							} catch {
								/* closed */
							}
						};
						send({ event: "hello", ts: Date.now() });
						unsub = subscribe(send);
						// keepalive ping
						const ping = setInterval(() => send({ event: "ping", ts: Date.now() }), 20_000);
						// @ts-expect-error cleanup on cancel
						this.ping = ping;
					},
					cancel() {
						unsub();
					},
				});
				return new Response(stream, {
					headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
				});
			}

			if (url.pathname.startsWith("/api/")) {
				let body: any = null;
				if (method_is(req.method, "POST")) {
					try {
						body = await req.json();
					} catch {
						body = null;
					}
				}
				return handleApi({ method: req.method, path: url.pathname, query: url.searchParams, body });
			}

			return new Response("pi self-learning agent service\n", {
				status: 200,
				headers: { "Content-Type": "text/plain" },
			});
		},
	});

	console.log(`[agent-service] REST+SSE API on http://127.0.0.1:${server.port}`);
	return server;
}

function method_is(m: string, want: string) {
	return m === want;
}
