/**
 * server.ts — REST + SSE API for the dashboard (mini-service on port 3030).
 */

import { emit, subscribe } from "./bus.ts";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
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
// M8: the version-skew handshake — /api/version + overview.version expose the
// engine's build (version, boot sha, bootedAt); agentVersion() replaces the
// hardcoded layer literal with the same source of truth.
import { agentVersion, engineVersionInfo } from "./engine-version.ts";
import {
        engineTokenPath,
        generateEngineToken,
        hostHeaderAllowed,
        originAllowed,
        removeEngineTokenFile,
        requestToken,
        resolveAuthPolicy,
        tokenExempt,
        tokenMatches,
        writeEngineTokenFile,
} from "./engine-auth.ts";
import { dreamNotes, listDreams, runDream } from "./dream.ts";
import { getImprovement, listCycles, listImprovements, runCycle } from "./harness.ts";
import { bridgeHealth, bridgeLog } from "./llm.ts";
import { history, projectTiers, resolveMemory, rollback, seedMemoryIfEmpty, snapshot, type Tier } from "./memory.ts";
import { runMintJob, suiteStats } from "./mint.ts";
import { ingestTerminalNote } from "./notes.ts";
import { syncNoteOutbox } from "./outbox.ts";
import { jobTimeoutMs, listJobs, router, setJobEnabled } from "./router.ts";
import { breakerStatus, budgetStatus, markEngineProcess, pruneLedger } from "./governor.ts";
import { ensureAgentDir, getRun, listRuns, MODEL_ID, PROVIDER, runAgent } from "./runner.ts";
import { listSandboxes } from "./sandbox.ts";
import { getSkill, listSkills, retireSkill, rollbackSkill, skillVersions } from "./skills.ts";
import { store, DATA_DIR, DB_PATH } from "./store.ts";
import { getTask, listTasks, seedTasks } from "./tasks.ts";
import { webCacheClear, webCacheStats, webCacheSweep } from "./webcache.ts";

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

/** On-disk size of the engine DB + its WAL sidecar, bytes (0 per missing
 *  file) — the retention observability number (M9) surfaced in
 *  /api/overview and `unown engine status`. */
function engineDbBytes(): number {
        let bytes = 0;
        for (const p of [DB_PATH, `${DB_PATH}-wal`]) {
                try {
                        bytes += statSync(p).size;
                } catch {
                        /* missing file — contributes 0 */
                }
        }
        return bytes;
}

// ---------------------------------------------------------------------------
// CORS — browser access for the dashboard (M0 of the multi-provider plan)
// ---------------------------------------------------------------------------
/**
 * Which Origin may talk to the engine API from a browser, or null for none.
 *
 * The engine is unauthenticated and loopback-bound by default; reflecting any
 * Origin would let any website the user visits drive the learning surface
 * through their own browser (CSRF over fetch). The default allow-list is
 * therefore loopback-only (any port — the dashboard runs on :3000, the e2e
 * build on :3210, sandbox gateways on 127.0.0.1…). Widen deliberately for
 * remote dashboards with UNOWN_ENGINE_CORS:
 *
 *   UNOWN_ENGINE_CORS=https://dash.example.com,https://other.example.com
 *       explicit origin allow-list (comma-separated)
 *   UNOWN_ENGINE_CORS=*        any origin — only sane next to UNOWN_ENGINE_HOST
 *                               plus an authenticating reverse proxy
 *   UNOWN_ENGINE_CORS=off      no CORS headers at all (pre-2.3 behaviour)
 *
 * Non-browser clients (curl, the CLI, the bridge) send no Origin and are
 * unaffected. Exported for tests.
 */
export function allowedCorsOrigin(req: Request): string | null {
        const mode = (process.env.UNOWN_ENGINE_CORS ?? "").trim();
        if (mode === "off") return null;
        const origin = req.headers.get("origin");
        if (!origin) return null; // same-origin / non-browser — no CORS headers needed
        if (mode === "*") return "*";
        const explicit = mode
                .split(",")
                .map((s) => s.trim().replace(/\/+$/, ""))
                .filter(Boolean);
        if (explicit.length > 0) {
                const o = origin.replace(/\/+$/, "");
                return explicit.includes(o) ? origin : null;
        }
        // default allow-list: loopback origins, any port, http(s) only
        try {
                const u = new URL(origin);
                const host = u.hostname.replace(/^\[|\]$/g, ""); // bare ::1
                const isLoopback =
                        host === "localhost" ||
                        host === "::1" ||
                        /^127(\.\d{1,3}){3}$/.test(host) ||
                        /^0\.0\.0\.0$/.test(host);
                const isHttp = u.protocol === "http:" || u.protocol === "https:";
                return isLoopback && isHttp ? origin : null;
        } catch {
                return null;
        }
}

/** The CORS headers for an allowed origin (empty object = no CORS). */
export function corsHeadersFor(origin: string | null): Record<string, string> {
        if (!origin) return {};
        return {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "Access-Control-Max-Age": "86400",
                Vary: "Origin",
        };
}

/** Re-wrap a Response with CORS headers (streaming bodies pass through). */
export function withCors(res: Response, origin: string | null): Response {
        const headers = corsHeadersFor(origin);
        if (Object.keys(headers).length === 0) return res;
        const h = new Headers(res.headers);
        for (const [k, v] of Object.entries(headers)) h.set(k, v);
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

/** The posture the RUNNING server was booted with (null until startServer;
 *  direct-handleApi unit calls fall back to resolving from the env).
 *  Mirrored into /api/overview so clients can always tell what the API
 *  required of them (M7). */
let activeAuthPosture: { mode: "token" | "off"; bind: "loopback" | "network" } | null = null;

function currentAuthPosture(): { mode: "token" | "off"; bind: "loopback" | "network" } {
        if (activeAuthPosture) return activeAuthPosture;
        const p = resolveAuthPolicy(process.env);
        return { mode: p.mode, bind: p.widenedBind ? "network" : "loopback" };
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
                // Version (M8) — the version-skew handshake block. GET and HEAD both
                // answer (ollama's /api/version accepts both; a bare liveness poll
                // should not need a body). Cheaper than /api/overview for version
                // probes: no run scan, no bridge fetch.
                // ------------------------------------------------------------------
                if ((method === "GET" || method === "HEAD") && path === "/api/version") {
                        return json({ ok: true, ...engineVersionInfo() });
                }

                // ------------------------------------------------------------------
                // Overview
                // ------------------------------------------------------------------
                if (method === "GET" && path === "/api/overview") {
                        // pid + uptime: the supervisor (engine-supervisor.ts) and
                        // `unown engine status` report these; the pid doubles as
                        // the graceful-stop handle for `unown engine stop`.
                        const bootedAt = (globalThis as any).__unown_engine_booted_at ?? Date.now();
                        (globalThis as any).__unown_engine_booted_at = bootedAt;
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
                                pid: process.pid,
                                bootedAt,
                                uptimeMs: Date.now() - bootedAt,
                                agent: {
                                        name: "pi (badlogic/pi-mono)",
                                        // NEVER a literal: the MCP handshake once claimed 0.1.0 while the
                                        // shipped package was 2.1.x (packaging.ts's founding anti-pattern).
                                        // agentVersion() is the same chain `unown --version` asserts in CI.
                                        layer: `self-learning v${agentVersion()}`,
                                        provider: `${PROVIDER}/${MODEL_ID}`,
                                        bridge,
                                },
                                // Version-skew handshake (M8): the same block /api/version serves,
                                // inline so existing probes need zero extra round trips.
                                version: engineVersionInfo(),
                                // Retention observability (M9): on-disk size of the engine DB + WAL —
                                // the number the retention job's high-water mark plateaus at.
                                retention: { dbBytes: engineDbBytes() },
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
                                // Auth posture (M7): what the API requires — "none" (token
                                // off) or "token" (bearer, validated by the fetch wrapper) —
                                // plus the bind scope. The footer, doctor and
                                // `unown engine status` surface this so a user can always
                                // tell which posture their engine is in.
                                auth: currentAuthPosture(),
                                // Detachment observability (docs/detached-engine-architecture.md F4/F5/F7):
                                // how long the mutex has been held, by which job, and the
                                // governor's budget/breaker state — `unown doctor` warns when
                                // busyMs exceeds 2x the job timeout (wedged-but-alive engine).
                                router: {
                                        busy: router.isBusy(),
                                        busyMs: router.busyMs(),
                                        activeJob: router.activeJob(),
                                        jobTimeoutMs: jobTimeoutMs(),
                                },
                                governor: {
                                        budget: budgetStatus(),
                                        breaker: breakerStatus(),
                                },
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
if (method === "GET" && path === "/api/memory/projects") {
        // Terminal project memories as first-class objects (TUI dashboard plan §5.6).
        return json({ projects: projectTiers() });
}
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
                if (method === "POST" && path === "/api/shutdown") {
                        // Cross-platform graceful drain (M3): SIGTERM cannot reach JS
                        // handlers on Windows (TerminateProcess skips them), so
                        // `unown engine stop` asks over HTTP first and falls back to
                        // signals. Same loopback-only threat model as the rest of the
                        // API surface (UNOWN_ENGINE_HOST, docs/configuration.md).
                        if (!activeShutdown) return json({ error: "shutdown not armed" }, 503);
                        const draining = activeShutdown;
                        setTimeout(() => draining(), 250).unref?.(); // let the response flush
                        return json({ ok: true, draining: true });
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

                // ------------------------------------------------------------------
                // Web results store (webcache) — stats/clear/sweep for the
                // dashboard. The store root honors UNOWN_WEB_CACHE_DIR /
                // UNOWN_HOME exactly like every other process, so these
                // endpoints report THIS machine's store (where the engine runs).
                // ------------------------------------------------------------------
                if (method === "GET" && path === "/api/webcache") {
                        return json(webCacheStats());
                }
                if (method === "POST" && path === "/api/webcache/clear") {
                        const { removed, bytes } = webCacheClear();
                        // Mutations announce themselves on the bus (the job-trigger
                        // pattern) so every open dashboard refetches, not just the
                        // caller — providers.tsx maps this to the webcache query.
                        emit("webcache:cleared", { removed, bytes });
                        return json({ ok: true, removed, bytes });
                }
                if (method === "POST" && path === "/api/webcache/sweep") {
                        const { evicted, freedBytes, totalBytes } = webCacheSweep();
                        return json({ ok: true, evicted, freedBytes, totalBytes });
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
        // Engine-process scope: the governor's ledger/breaker track THIS process's
        // unattended LLM spend; the shared llm.ts client is inert in CLI processes
        // without this flag (governor.ts, the M2 detachment contract).
        markEngineProcess();
        // ---------------------------------------------------------- authentication (M7)
        // Resolve BEFORE binding: a non-loopback bind with auth disabled must
        // refuse to boot (an Ollama-style accidental 0.0.0.0-with-no-auth must
        // never exist), and the token file must be on disk before the port
        // answers its first request (no torn reads for auto-discovering
        // clients). See engine-auth.ts for the full design + threat model.
        const authPolicy = resolveAuthPolicy(process.env);
        if (authPolicy.refuse) {
                console.error(`[agent-service] refusing to start: ${authPolicy.refuseReason}`);
                return null;
        }
        const engineToken = authPolicy.mode === "token" ? (authPolicy.token ?? generateEngineToken()) : null;
        // NOTE: the token file is written ONLY AFTER this process wins the
        // single-instance lock below. Writing it earlier let a racing loser
        // engine (auto-start during a kill/recovery window) clobber the
        // WINNER's token and exit — every same-user client then presented
        // the dead loser's token and 401'd until a manual restart. The lock
        // is the mutex that guarantees exactly one token writer; the write
        // still happens before Bun.serve binds (no torn reads).
        // ---------------------------------------------------------- single instance
        // The engine lock (M3, docs/detached-engine-architecture.md F9): the
        // port bind is a mutex, but only for THIS port — a second engine with
        // a different PI_AGENT_PORT would still open the same SQLite data.
        // The lockfile is created exclusively (O_EXCL "wx"), carries the pid,
        // and is stolen only when that pid is provably dead (or, on Linux,
        // alive but not an engine — pid-reuse after a crash must not brick
        // boot). The loser exits 0 with a clear line in the log.
        const lock = acquireEngineLock();
        if (!lock.ok) {
                console.log(`[agent-service] ${lock.reason} — this instance exits`);
                return null;
        }
        // Token + posture are now committed: this process IS the engine.
        if (engineToken) writeEngineTokenFile(engineTokenPath(), engineToken);
        activeAuthPosture = { mode: authPolicy.mode, bind: authPolicy.widenedBind ? "network" : "loopback" };
        // M6 boot-time integrity gate: PRAGMA quick_check is the fast O(N)
        // pass (docs/resilience.md). A damaged DB must fail HERE, with the
        // repair hint — not mid-dream, corrupting writes. The outbox + the
        // on-disk memory files make `unown engine repair` loss-bounded.
        const qc = store.quickCheck();
        if (qc !== "ok") {
                console.error(`[agent-service] database integrity check failed: ${qc}`);
                console.error("  quarantine it and boot fresh with: unown engine repair");
                lock.release();
                return null;
        }
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
                        const corsOrigin = allowedCorsOrigin(req);

                        // -------------------------------------------------- auth gate (M7)
                        // Three checks, all ABOVE handleApi (the unit suite calls
                        // handleApi directly; HTTP-level concerns live here):
                        //   1. Host validation — same-port DNS rebinding kills CORS
                        //      entirely (page origin == target origin), so a DNS name
                        //      in the Host header must be explicitly allow-listed
                        //      (UNOWN_ENGINE_HOSTS). Vite allowedHosts / CVE-2025-24010.
                        //   2. Origin enforcement — CORS only gates what a browser
                        //      can READ; a text/plain POST is preflight-free and
                        //      apiRequestBody() parses any content-type, so any
                        //      website could drive POST /api/* blind. A request that
                        //      CARRIES an Origin must be on the allow-list.
                        //   3. Bearer token — per-boot random token in
                        //      DATA_DIR/engine.token (Jupyter-style); same-user
                        //      clients auto-discover it via engineFetch. Exempt:
                        //      preflights (carry no credentials) and GET / liveness.
                        // See engine-auth.ts + docs/detached-engine-architecture.md.
                        if (!hostHeaderAllowed(req, authPolicy)) {
                                return new Response(JSON.stringify({ error: "host header not allowed" }), {
                                        status: 403,
                                        headers: { "Content-Type": "application/json" },
                                });
                        }
                        if (!originAllowed(req, corsOrigin)) {
                                return new Response(JSON.stringify({ error: "origin not allowed" }), {
                                        status: 403,
                                        headers: { "Content-Type": "application/json" },
                                });
                        }

                        // CORS preflight — answered before any routing (the engine API is
                        // consumed cross-origin by the local dashboard once CORS is on).
                        if (req.method === "OPTIONS") {
                                return new Response(null, { status: 204, headers: corsHeadersFor(corsOrigin) });
                        }
                        if (engineToken && !tokenExempt(req.method, url.pathname)) {
                                if (!tokenMatches(requestToken(req, url), engineToken)) {
                                        return new Response(
                                                JSON.stringify({ error: "missing or invalid engine token" }),
                                                {
                                                        status: 401,
                                                        headers: {
                                                                "Content-Type": "application/json",
                                                                "WWW-Authenticate": "Bearer",
                                                        },
                                                },
                                        );
                                }
                        }

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
                                return withCors(
                                        new Response(stream, {
                                                headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
                                        }),
                                        corsOrigin,
                                );
                        }

                        if (url.pathname.startsWith("/api/")) {
                                return withCors(
                                        await handleApi({ method: req.method, path: url.pathname, query: url.searchParams, body: await apiRequestBody(req) }),
                                        corsOrigin,
                                );
                        }

                        return withCors(
                                new Response("pi self-learning agent service\n", {
                                        status: 200,
                                        headers: { "Content-Type": "text/plain" },
                                }),
                                corsOrigin,
                        );
                },
        });

        console.log(
                `[agent-service] REST+SSE API on http://${process.env.UNOWN_ENGINE_HOST || "127.0.0.1"}:${server.port}` +
                        (engineToken ? ` — auth: bearer token (${engineTokenPath()})` : " — auth: disabled"),
        );
        installGracefulShutdown(server, lock.release, engineToken ? () => removeEngineTokenFile(engineTokenPath()) : undefined);
        startMaintenance();
        return server;
}

// ---------------------------------------------------------------------------
// Supervision (M3): single-instance lock, graceful shutdown, maintenance
// ---------------------------------------------------------------------------

/** The engine's lockfile path — inside its own data dir, which tests redirect per-suite. */
function engineLockPath(): string {
        return join(DATA_DIR, "engine.lock");
}

/** Is `pid` alive AND (on Linux) actually an engine process? Defends lock-steal against pid reuse. */
function lockHolderLooksLikeEngine(pid: number): boolean {
        try {
                process.kill(pid, 0);
        } catch (err: any) {
                // EPERM = the process exists but belongs to another user: ALIVE.
                // ESRCH = no such process: dead. Anything else: assume dead.
                return err?.code === "EPERM";
        }
        if (process.platform === "linux") {
                try {
                        const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
                        return /agent-service|engine[\s\/]serve|self-learning/.test(cmdline);
                } catch {
                        return false; // can't read → can't prove → don't steal lightly
                }
        }
        return true; // non-Linux: pid alive is the best portable signal
}

function acquireEngineLock(): { ok: true; release: () => void } | { ok: false; reason: string } {
        mkdirSync(DATA_DIR, { recursive: true });
        const lockPath = engineLockPath();
        if (existsSync(lockPath)) {
                try {
                        const pid = Number(readFileSync(lockPath, "utf8").trim());
                        // Same-pid re-entrancy: a test (or an in-process restart)
                        // calling startServer again owns the lock already.
                        if (pid === process.pid) {
                                return {
                                        ok: true,
                                        release: () => {
                                                try {
                                                        rmSync(lockPath);
                                                } catch {
                                                        /* best effort */
                                                }
                                        },
                                };
                        }
                        if (Number.isFinite(pid) && pid > 0 && lockHolderLooksLikeEngine(pid)) {
                                return { ok: false, reason: `another engine is running (pid ${pid}, lock ${lockPath})` };
                        }
                } catch {
                        /* unreadable lock — steal */
                }
                try {
                        rmSync(lockPath);
                } catch {
                        /* best effort */
                }
        }
        try {
                const fd = openSync(lockPath, "wx");
                writeSync(fd, String(process.pid));
                closeSync(fd);
        } catch (err: any) {
                return { ok: false, reason: `cannot create engine lock ${lockPath}: ${err?.message ?? err}` };
        }
        return {
                ok: true,
                release: () => {
                        try {
                                rmSync(lockPath);
                        } catch {
                                /* best effort */
                        }
                },
        };
}

let shutdownInstalled = false;
let activeShutdown: (() => void) | null = null;

/**
 * Graceful drain (M3): stop accepting, let in-flight requests finish (Bun's
 * server.stop() waits for them), stop the router and the automations
 * scheduler, checkpoint + close the WAL store, release the lock, exit 0.
 * Shared by the SIGTERM/SIGINT handlers and the cross-platform
 * POST /api/shutdown endpoint (signals cannot drain on Windows — TerminateProcess
 * skips JS handlers — so the HTTP path is the portable drain).
 */
function installGracefulShutdown(server: any, releaseLock: () => void, removeToken?: () => void): void {
        if (shutdownInstalled) return;
        shutdownInstalled = true;
        const shutdown = async (signal: string) => {
                console.log(`[agent-service] ${signal} — draining…`);
                try {
                        await server.stop(); // drain in-flight requests
                } catch {
                        /* ignore */
                }
                try {
                        router.stop();
                        automationsScheduler.stop();
                } catch {
                        /* ignore */
                }
                // M7: remove the per-boot token file when the engine leaves
                // deliberately (drain/stop) — mirrors Jupyter's runtime-file
                // lifecycle. Crash paths leave it; the next boot rewrites it.
                if (removeToken) {
                        try {
                                removeToken();
                        } catch {
                                /* ignore */
                        }
                }
                try {
                        store.run("PRAGMA wal_checkpoint(TRUNCATE)");
                } catch {
                        /* ignore */
                }
                try {
                        store.close();
                } catch {
                        /* ignore */
                }
                releaseLock();
                process.exit(0);
        };
        activeShutdown = () => void shutdown("api/shutdown");
        process.on("SIGTERM", () => void shutdown("SIGTERM"));
        process.on("SIGINT", () => void shutdown("SIGINT"));
}

let maintenanceTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Periodic maintenance (M3): TRUNCATE-checkpoint the WAL (bounded growth — a
 * long-lived reader can otherwise grow it without bound) and prune the
 * governor's spend ledger past its 24h window. Unref'd: never blocks exit.
 */
function startMaintenance(): void {
        if (maintenanceTimer) return;
        let ticks = 0;
        maintenanceTimer = setInterval(() => {
                ticks++;
                try {
                        store.run("PRAGMA wal_checkpoint(TRUNCATE)");
                } catch {
                        /* ignore — a busy reader can make TRUNCATE a no-op */
                }
                if (ticks % 10 === 0) {
                        try {
                                pruneLedger();
                        } catch {
                                /* ignore */
                        }
                }
        }, 60_000);
        maintenanceTimer.unref?.();
}
