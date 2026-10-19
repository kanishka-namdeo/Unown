/**
 * server.ts — REST + SSE API for the dashboard (mini-service on port 3030).
 */

import { emit, subscribe } from "./bus.ts";
import {
        AutomationsScheduler,
        createAutomation,
        deleteAutomation,
        getAutomation,
        listAutomations,
        listRuns as listAutomationRuns,
        updateAutomation,
} from "./automations.ts";
import { describeCron } from "./cron.ts";
import { dreamNotes, listDreams, runDream } from "./dream.ts";
import { getImprovement, listCycles, listImprovements, runCycle } from "./harness.ts";
import { bridgeHealth, bridgeLog } from "./llm.ts";
import { history, resolveMemory, rollback, seedMemoryIfEmpty, snapshot, type Tier } from "./memory.ts";
import { runMintJob, suiteStats } from "./mint.ts";
import { ingestTerminalNote } from "./notes.ts";
import { syncNoteOutbox } from "./outbox.ts";
import { listJobs, router, setJobEnabled } from "./router.ts";
import { ensureAgentDir, getRun, listRuns, MODEL_ID, PROVIDER, runAgent } from "./runner.ts";
import { listSandboxes } from "./sandbox.ts";
import { getSkill, listSkills, retireSkill, rollbackSkill, skillVersions } from "./skills.ts";
import { store } from "./store.ts";
import { getTask, listTasks, seedTasks } from "./tasks.ts";

const PORT = Number(process.env.PI_AGENT_PORT || 3030); // `||`: Number("") is 0, not the default

export interface ApiRequest {
        method: string;
        path: string;
        query: URLSearchParams;
        body: any;
}

/**
 * Parse an API request's JSON body — the HTTP layer's single body gate.
 *
 * Must accept a body for EVERY method that can carry one: handleApi routes
 * exist for POST and PATCH both (automations create / edit / pause / resume,
 * memory rollback, job toggles). A POST-only gate starved the whole PATCH
 * family (body = null -> "nothing to update"), a class of bug the unit
 * suite could not catch — those tests call handleApi() directly with the
 * body already parsed. Found by live E2E (CLI `automations pause` -> 400);
 * pinned by test/automations.test.ts ("apiRequestBody"). GET/HEAD/OPTIONS/
 * DELETE never parse (null), and a body that is not valid JSON parses as
 * null rather than throwing into the 500 handler.
 */
export async function apiRequestBody(req: Request): Promise<any> {
        if (["GET", "HEAD", "OPTIONS", "DELETE"].includes(req.method)) return null;
        try {
                return await req.json();
        } catch {
                return null;
        }
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
                // Automations (the zcode port — scheduled recurring agent runs)
                // ------------------------------------------------------------------
                if (path === "/api/automations") {
                        if (method === "GET") {
                                const rows = listAutomations().map((a) => ({
                                        ...a,
                                        schedule: a.cron_expr ? describeCron(a.cron_expr) : `one-shot at ${new Date(a.delay_ms ?? 0).toISOString()}`,
                                        lastRun: listAutomationRuns(a.id, 1)[0] ?? null,
                                }));
                                return json({ automations: rows });
                        }
                        if (method === "POST") {
                                const created = createAutomation({
                                        title: String(body?.title ?? ""),
                                        prompt: String(body?.prompt ?? ""),
                                        workspace: String(body?.workspace ?? process.cwd()),
                                        schedule: {
                                                cron: body?.cron !== undefined ? String(body.cron) : undefined,
                                                delayMinutes: body?.delayMinutes !== undefined ? Number(body.delayMinutes) : undefined,
                                        },
                                        mode: body?.mode === "standard" ? "standard" : "read-only",
                                        model: body?.model ? String(body.model) : null,
                                        maxRuns: body?.maxRuns !== undefined && body?.maxRuns !== null ? Number(body.maxRuns) : null,
                                });
                                if (!created.ok) return json({ error: created.error }, created.status ?? 400);
                                return json({ automation: { ...created.automation, schedule: created.automation.cron_expr ? describeCron(created.automation.cron_expr) : "one-shot" } });
                        }
                }
                const automationMatch = path.match(/^\/api\/automations\/([^/]+)(?:\/(run|runs))?$/);
                if (automationMatch) {
                        const id = decodeURIComponent(automationMatch[1]);
                        const sub = automationMatch[2];
                        if (sub === "run" && method === "POST") {
                                const triggered = await automationsScheduler.runNow(id);
                                if (!triggered.ok) return json({ error: triggered.error }, triggered.status ?? 400);
                                return json({ ok: true });
                        }
                        if (sub === "runs" && method === "GET") {
                                const limit = Number(query?.get("limit") ?? 20);
                                return json({ runs: listAutomationRuns(id, Number.isFinite(limit) ? limit : 20) });
                        }
                        if (method === "GET") {
                                const automation = getAutomation(id);
                                if (!automation) return json({ error: "unknown automation" }, 404);
                                return json({ automation: { ...automation, schedule: automation.cron_expr ? describeCron(automation.cron_expr) : "one-shot" } });
                        }
                        if (method === "PATCH") {
                                const patch: any = {};
                                for (const key of ["title", "prompt", "mode", "model", "lifecycle", "cron"]) {
                                        if (body?.[key] !== undefined) patch[key] = body[key];
                                }
                                if (body?.maxRuns !== undefined) patch.max_runs = body.maxRuns; // REST camelCase → the row's snake_case
                                const updated = updateAutomation(id, patch);
                                if (!updated.ok) return json({ error: updated.error }, updated.status ?? 400);
                                return json({ automation: updated.automation });
                        }
                        if (method === "DELETE") {
                                const deleted = deleteAutomation(id);
                                return deleted ? json({ ok: true }) : json({ error: "unknown automation" }, 404);
                        }
                }

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
                                        suite: suiteStats(),
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
                if (method === "GET" && path === "/api/skills") {
                        const url = new URL(req.url, "http://localhost");
                        const project = url.searchParams.get("project");
                        return json({ skills: listSkills(project ?? undefined) });
                }
                if (method === "GET" && /^\/api\/skills\/[^/]+$/.test(path)) {
                        const skill = getSkill(decodeURIComponent(path.split("/")[3] ?? ""));
                        if (!skill) return json({ error: "unknown skill" }, 404);
                        return json({ skill, versions: skillVersions(skill.id) });
                }
                if (method === "POST" && /^\/api\/skills\/[^/]+\/rollback$/.test(path)) {
                        const id = decodeURIComponent(path.split("/")[3] ?? "");
                        const target = Number(body?.version);
                        if (!Number.isInteger(target)) return json({ error: "version (integer) required" }, 400);
                        const result = rollbackSkill(id, target);
                        return result.ok ? json({ ok: true }) : json({ error: result.error }, 400);
                }
                if (method === "POST" && /^\/api\/skills\/[^/]+\/retire$/.test(path)) {
                        const result = retireSkill(decodeURIComponent(path.split("/")[3] ?? ""));
                        return result.ok ? json({ ok: true }) : json({ error: result.error }, 400);
                }
                if (method === "POST" && path === "/api/tasks/mint") {
                        if (router.isBusy()) return json({ error: "engine is busy with another job" }, 409);
                        try {
                                const outcome = await router.withBusy(() => runMintJob());
                                return json({ ok: true, outcome });
                        } catch (err) {
                                return json({ error: err?.message ?? String(err) }, 500);
                        }
                }
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
                                // F8 fix: the ACTUAL resolved block (header +
                                // wrappers + provenance), not the raw tier sum.
                                resolvedChars: resolveMemory().totalChars,
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
/** Crash recovery: mark rows left 'running' by a previous process as errored. Exported for tests. */
export function recoverOrphans() {
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
        // LOW-2: dreams stuck 'running' showed a phantom in-flight dream on the
        // dashboard forever; tasks stuck 'validating' stayed invisible (active=0)
        // with source_run_id set, so the lesson was silently lost. A task that
        // never finished validating is discarded (same as a failed validation).
        const orphDreams = store.run(
                `UPDATE dreams SET status = 'error', ended_at = ?, note = COALESCE(note, '') || ' [orphaned by service restart]' WHERE status = 'running'`,
                [now],
        );
        const orphTasks = store.run(`UPDATE tasks SET status = 'discarded' WHERE status = 'validating'`);
        if (orphRuns.changes > 0 || orphCycles.changes > 0 || orphDreams.changes > 0 || orphTasks.changes > 0) {
                console.log(`[agent-service] recovered ${orphRuns.changes} orphaned runs, ${orphCycles.changes} orphaned cycles, ${orphDreams.changes} orphaned dreams, ${orphTasks.changes} unvalidated minted tasks`);
        }
}

/** Automations scheduler — one engine-wide instance (zcode's utility-process
 *  equivalent; ours is an in-process poll loop). Created at module scope so
 *  REST handlers (POST .../run) can reach it. */
export const automationsScheduler = new AutomationsScheduler();

export function startServer(port: number = PORT) {
        ensureAgentDir();
        seedMemoryIfEmpty();
        seedTasks();
        recoverOrphans();
        const synced = syncNoteOutbox();
        if (synced > 0) console.log(`[agent-service] ingested ${synced} outbox note(s) from terminal sessions`);
        router.start().catch((e) => console.error("[router] failed to start:", e));
        automationsScheduler.start();

        const server = Bun.serve({
                port,
                // Loopback by default (MEDIUM-6): the engine API is unauthenticated —
                // notes ingestion, memory rollback, sandboxed agent runs — so binding
                // all interfaces would expose the whole learning surface to the LAN.
                // Opt in deliberately (LAN/dashboard-from-another-device) via
                // UNOWN_ENGINE_HOST=0.0.0.0.
                hostname: process.env.UNOWN_ENGINE_HOST || "127.0.0.1", // `||`: empty means unset
                idleTimeout: 255, // SSE streams + long-lived API connections
                async fetch(req) {
                        const url = new URL(req.url);

                        // SSE live event stream
                        if (req.method === "GET" && url.pathname === "/api/events") {
                                let unsub = () => {};
                                let ping: ReturnType<typeof setInterval> | null = null;
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
                                                // keepalive ping — CLEARED on cancel (MEDIUM-4): each abandoned SSE
                                                // connection used to leak its 20s interval + retained closures for
                                                // the life of the engine (cancel only unsubscribed the bus listener).
                                                ping = setInterval(() => send({ event: "ping", ts: Date.now() }), 20_000);
                                        },
                                        cancel() {
                                                unsub();
                                                if (ping) clearInterval(ping);
                                        },
                                });
                                return new Response(stream, {
                                        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
                                });
                        }

                        if (url.pathname.startsWith("/api/")) {
                                return handleApi({ method: req.method, path: url.pathname, query: url.searchParams, body: await apiRequestBody(req) });
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
