/**
 * dashboard-data.ts — the TUI dashboard's data layer: engine REST client +
 * SSE subscription + a versioned snapshot store (the web dashboard's
 * react-query invalidation discipline, minus the framework).
 *
 * Contract (docs/tui-dashboard-plan.md §5.2):
 *   EngineClient  — fetch with short timeouts; throws typed errors only.
 *   DashboardStore — per-endpoint {data, age, fetching} triples, adaptive
 *                    polling (active screen fast, background slow), SSE-driven
 *                    dirty flags via the invalidation table, activity ring,
 *                   connection state machine (up/reconnecting/down) with the
 *                   M6 degraded-mode guarantee: the last snapshot is kept and
 *                   stamped, never dropped.
 *
 * UI-free by design: screens import this module; this module imports nothing
 * from dashboard/screens. Both mounts (standalone boot, embedded /dashboard)
 * share one store instance per dashboard session.
 */

import { engineFetch } from "../engine-auth.ts";
import type {
        ActivityItem,
        AgentEvent,
        Automation,
        AutomationRunsResponse,
        AutomationsResponse,
        BridgeResponse,
        CyclesResponse,
        DreamNotesResponse,
        DreamsResponse,
        HooksResponse,
        ImprovementsResponse,
        JobsResponse,
        LiveRun,
        LiveRunsResponse,
        MemoryHistoryResponse,
        MemoryResponse,
        MintResponse,
        NoteCreateResponse,
        NotesResponse,
        NotesSyncResponse,
        OverviewResponse,
        ProjectMemoryResponse,
        RunDetailResponse,
        RunsResponse,
        SandboxesResponse,
        SkillDetailResponse,
        SkillsResponse,
        TaskDetailResponse,
        TasksResponse,
        WebCacheClearResponse,
        WebCacheSweepResponse,
} from "./dashboard-types.ts";

/** Engine base URL (same env var the CLI uses; loopback by default). */
export function engineBaseUrl(): string {
        return (process.env.UNOWN_ENGINE_URL || "http://127.0.0.1:3030").replace(/\/+$/, "");
}

export interface EngineHttpError extends Error {
        status: number;
        body: string;
}

export class EngineClient {
        readonly base: string;
        private timeoutMs: number;

        constructor(base?: string, timeoutMs = 6000) {
                this.base = base ?? engineBaseUrl();
                this.timeoutMs = timeoutMs;
        }

        async get<T>(path: string): Promise<T> {
                return this.request<T>("GET", path);
        }

        async post<T>(path: string, body?: unknown): Promise<T> {
                return this.request<T>("POST", path, body);
        }

        async patch<T>(path: string, body?: unknown): Promise<T> {
                return this.request<T>("PATCH", path, body);
        }

        async del<T>(path: string): Promise<T> {
                return this.request<T>("DELETE", path);
        }

        private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
                let resp: Response;
                try {
                        // engineFetch (M7): attaches the per-boot bearer token when one is
                        // discoverable and heals once across an engine reboot (the token
                        // rotates each boot — a 401 re-reads and retries once). M7 wired
                        // every in-tree client through engineFetch except this one — the
                        // TUI dashboard 401'd against every default-posture engine, and
                        // the D6 render suite could not see it (the mock engine serves
                        // no token file, so engineFetch sends no Authorization header
                        // and the suite stays green by design).
                        resp = await engineFetch(this.base + path, {
                                method,
                                headers: body === undefined ? undefined : { "Content-Type": "application/json" },
                                body: body === undefined ? undefined : JSON.stringify(body),
                                signal: AbortSignal.timeout(this.timeoutMs),
                        });
                } catch (e) {
                        const err = new Error(`engine unreachable (${(e as Error).message})`) as EngineHttpError;
                        err.status = 0;
                        throw err;
                }
                const text = await resp.text();
                if (!resp.ok) {
                        const err = new Error(`engine ${resp.status}: ${text.slice(0, 200)}`) as EngineHttpError;
                        err.status = resp.status;
                        err.body = text;
                        throw err;
                }
                try {
                        return JSON.parse(text) as T;
                } catch {
                        const err = new Error(`engine sent invalid JSON for ${path}`) as EngineHttpError;
                        err.status = resp.status;
                        err.body = text;
                        throw err;
                }
        }
}

// ---------------------------------------------------------------------------
// The endpoint table — every resource the dashboard can hold a snapshot of.
// ---------------------------------------------------------------------------

export type ResourceId =
        | "overview"
        | "tasks"
        | "runs"
        | "liveRuns"
        | "memory"
        | "memoryProjects"
        | "cycles"
        | "improvements"
        | "dreams"
        | "notes"
        | "skills"
        | "hooks"
        | "jobs"
        | "sandboxes"
        | "bridge"
        | "automations"
        | "webcache";

/** Typed loader per resource. Detail fetches (run/task/skill/dream notes,
 * automation runs, memory history) are imperative helpers below — they are
 * fetched on drill-in, not polled. */
const LOADERS: Record<ResourceId, (c: EngineClient) => Promise<unknown>> = {
        overview: (c) => c.get<OverviewResponse>("/api/overview"),
        tasks: (c) => c.get<TasksResponse>("/api/tasks"),
        runs: (c) => c.get<RunsResponse>("/api/runs?limit=100"),
        // M6-2 live progress of in-flight runs (engine-side run-progress.ts).
        // A tiny payload — one entry per RUNNING run, empty when the engine is idle.
        liveRuns: (c) => c.get<LiveRunsResponse>("/api/runs/live"),
        memory: (c) => c.get<MemoryResponse>("/api/memory"),
        memoryProjects: (c) => c.get<ProjectMemoryResponse>("/api/memory/projects"),
        cycles: (c) => c.get<CyclesResponse>("/api/cycles"),
        improvements: (c) => c.get<ImprovementsResponse>("/api/improvements"),
        dreams: (c) => c.get<DreamsResponse>("/api/dreams"),
        notes: (c) => c.get<NotesResponse>("/api/notes?limit=200"),
        skills: (c) => c.get<SkillsResponse>("/api/skills"),
        hooks: (c) => c.get<HooksResponse>("/api/hooks?limit=300"),
        jobs: (c) => c.get<JobsResponse>("/api/jobs"),
        sandboxes: (c) => c.get<SandboxesResponse>("/api/sandboxes"),
        bridge: (c) => c.get<BridgeResponse>("/api/bridge"),
        automations: (c) => c.get<AutomationsResponse>("/api/automations"),
        webcache: (c) => c.get<import("./dashboard-types.ts").WebCacheStats>("/api/webcache"),
};

/** SSE event → resources that must refetch (ported 1:1 from the web dashboard). */
const INVALIDATIONS: Record<string, ResourceId[]> = {
        "run:started": ["runs", "liveRuns", "overview", "tasks", "cycles", "sandboxes"],
        "run:finished": ["runs", "liveRuns", "overview", "tasks", "cycles", "sandboxes", "bridge"],
        "cycle:started": ["cycles", "overview"],
        "cycle:finished": ["cycles", "overview"],
        "improvement:proposed": ["improvements", "cycles", "overview"],
        "improvement:shipped": ["improvements", "cycles", "overview"],
        "improvement:regressed": ["improvements", "cycles", "memory", "overview"],
        "dream:started": ["dreams", "notes", "memory", "overview"],
        "dream:finished": ["dreams", "notes", "memory", "overview", "skills", "memoryProjects"],
        "memory:changed": ["memory", "overview", "memoryProjects"],
        "memory:budget": ["memory"],
        hook: ["hooks", "overview"],
        "note:created": ["notes", "overview"],
        "notes:synced": ["notes", "overview"],
        "skill:minted": ["skills", "overview"],
        "skill:rejected": ["skills", "overview"],
        "skill:rolled-back": ["skills", "overview"],
        "skill:retired": ["skills", "overview"],
        "task:minted": ["tasks", "overview"],
        "task:mint-discarded": ["tasks", "overview"],
        "task:graduated": ["tasks", "overview"],
        "mint:cascade": ["tasks", "overview"],
        "automation:created": ["automations", "overview"],
        "automation:updated": ["automations", "overview"],
        "automation:deleted": ["automations", "overview"],
        "automation:completed": ["automations", "overview"],
        "automation:run-started": ["automations", "overview"],
        "automation:skipped": ["automations", "overview"],
        // M6: chained-routine bus events — a dispatched listener (or a refused
        // hop) moves the chain state the routines list renders.
        "automation:chained": ["automations"],
        "automation:event-triggered": ["automations"],
        // The terminal transitions previously leaned on the 4s fast-lane poll —
        // the SSE stream should invalidate the list the moment they land.
        "automation:run-succeeded": ["automations", "overview"],
        "automation:run-failed": ["automations", "overview"],
        "automation:recovered": ["automations", "overview"],
        "automation:dispatch-retry": ["automations"],
        "automation:dispatch-exhausted": ["automations", "overview"],
        "automations:started": ["automations"],
        "job:started": ["jobs", "overview"],
        "job:finished": ["jobs", "overview"],
        "job:error": ["jobs", "overview"],
        "router:error": ["overview"],
        "webcache:cleared": ["webcache"],
        "lane:dream": [],
};

/** Translate an SSE event into an activity line (ported from the web
 * dashboard's describe(); tones map to theme tokens). */
export function describeEvent(ev: AgentEvent): { text: string; tone: ActivityItem["tone"] } | null {
        const p = ev.payload ?? {};
        const str = (k: string, d = "?"): string => {
                const v = p[k];
                if (typeof v === "string") return v;
                if (typeof v === "number") return String(v);
                return d;
        };
        const num = (k: string): number | undefined => (typeof p[k] === "number" ? (p[k] as number) : undefined);
        switch (ev.event) {
                case "hello":
                        return { text: "connected to engine event stream", tone: "emerald" };
                case "ping":
                        return null;
                case "run:started":
                        return {
                                text: `run started · ${str("taskId")} · ${str("kind")}${str("isolation") ? ` · ${str("isolation")}` : ""}`,
                                tone: "amber",
                        };
                case "run:finished": {
                        const status = str("status");
                        const dur = num("durationMs");
                        const durTxt = dur !== undefined ? ` · ${Math.round(dur / 1000)}s` : "";
                        return {
                                text: `run finished · ${str("taskId")} · ${status}${durTxt}`,
                                tone: status === "passed" ? "emerald" : status === "running" ? "amber" : "rose",
                        };
                }
                case "run:tool":
                case "run:text":
                        return null;
                case "cycle:started":
                        return { text: `cycle started · ${str("taskId")}`, tone: "amber" };
                case "cycle:finished":
                        return {
                                text: `cycle finished · ${str("taskId")} · ${str("status")}`,
                                tone: str("status") === "improved" ? "emerald" : "rose",
                        };
                case "improvement:proposed":
                        return { text: `improvement proposed · ${str("taskId")} · iter ${str("iteration")}`, tone: "amber" };
                case "improvement:shipped":
                        return { text: `improvement shipped · ${str("taskId")} → ${str("tier")} memory`, tone: "emerald" };
                case "improvement:regressed":
                        return { text: `improvement regressed · memory rolled back to v${str("rolledBackTo")}`, tone: "rose" };
                case "dream:started":
                        return { text: `autodream started · ${str("notesIn")} notes in`, tone: "amber" };
                case "dream:finished": {
                        const status = str("status");
                        return {
                                text: `dream finished · ${status}${p.version !== undefined ? ` · memory v${str("version")}` : ""}`,
                                tone: status === "done" ? "emerald" : status === "gated" ? "amber" : "rose",
                        };
                }
                case "memory:changed":
                        return { text: `${str("tier")} memory → v${str("version")} · by ${str("changedBy")}`, tone: "emerald" };
                case "memory:budget": {
                        const pruned = num("prunedBlocks") ?? 0;
                        return {
                                text: `memory budget · ${pruned} block${pruned === 1 ? "" : "s"} pruned to fit the injection cap`,
                                tone: pruned > 0 ? "amber" : "zinc",
                        };
                }
                case "hook": {
                        const decision = str("decision");
                        const tool = p.tool ? ` · ${str("tool")}` : "";
                        return {
                                text: `hook ${str("hook")}${tool} · ${decision}`,
                                tone:
                                        decision === "deny" || decision === "log-error"
                                                ? "rose"
                                                : decision === "augment" || decision === "warn"
                                                        ? "amber"
                                                        : "zinc",
                        };
                }
                case "note:created":
                        return { text: "session note captured", tone: "zinc" };
                case "notes:synced":
                        return { text: `${str("count", "0")} terminal notes synced from the outbox`, tone: "zinc" };
                case "skill:minted":
                        return { text: `skill minted · ${str("name")} → ${str("project")}`, tone: "emerald" };
                case "skill:rejected":
                        return { text: `skill rejected · ${str("name")} · guard rules matched`, tone: "amber" };
                case "skill:rolled-back":
                        return { text: `skill rolled back · ${str("name")} → v${str("version")}`, tone: "zinc" };
                case "skill:retired":
                        return { text: `skill retired · ${str("name")}`, tone: "zinc" };
                case "task:minted":
                        return { text: `task minted · ${str("name")} (${str("source")})`, tone: "emerald" };
                case "task:mint-discarded":
                        return { text: `minted draft discarded · ${str("reason")}`, tone: "amber" };
                case "task:graduated":
                        return { text: `task graduated · ${str("id")} — promoted to regression guard`, tone: "emerald" };
                case "mint:cascade":
                        return { text: `mint cascade · ${str("outcome")}`, tone: "zinc" };
                case "automation:created":
                        return { text: `automation created · ${str("title")}`, tone: "emerald" };
                case "automation:updated":
                        return { text: `automation updated · ${str("id")}`, tone: "zinc" };
                case "automation:deleted":
                        return { text: `automation deleted · ${str("id")}`, tone: "zinc" };
                case "automation:run-started":
                        return { text: `automation run started · ${str("id")} · ${str("trigger")}`, tone: "amber" };
                case "automation:skipped":
                        return { text: `automation skipped · ${str("reason")}`, tone: "amber" };
                case "automation:completed":
                        return { text: "automation completed · max runs reached (lifecycle terminal)", tone: "emerald" };
                case "automation:recovered":
                        return { text: `automation recovered · ${str("id")} — run marked failed at boot`, tone: "rose" };
                case "automation:dispatch-retry":
                        return { text: `automation dispatch retry · attempt ${str("attempts")}`, tone: "amber" };
                case "automation:dispatch-exhausted":
                        return { text: `automation dispatch gave up after ${str("attempts")} attempts`, tone: "rose" };
                case "automations:started":
                        return { text: `automations scheduler online · poll ${str("pollMs")}ms`, tone: "zinc" };
                case "webcache:cleared": {
                        const removed = num("removed") ?? 0;
                        return {
                                text: `web cache cleared · ${removed} ${removed === 1 ? "entry" : "entries"} dropped`,
                                tone: "zinc",
                        };
                }
                case "job:started":
                        return { text: `job started · ${str("name")}`, tone: "amber" };
                case "job:finished":
                        return { text: `job finished · ${str("name")}`, tone: "emerald" };
                case "job:error":
                        return { text: `job error · ${str("error", "unknown").slice(0, 80)}`, tone: "rose" };
                case "router:started":
                        return { text: `router started · ${str("jobs")} jobs scheduled`, tone: "zinc" };
                case "router:error":
                        return { text: `router error · ${str("error", "unknown").slice(0, 80)}`, tone: "rose" };
                default:
                        return { text: ev.event, tone: "zinc" };
        }
}

// ---------------------------------------------------------------------------
// DashboardStore
// ---------------------------------------------------------------------------

export type ConnectionState = "connecting" | "up" | "reconnecting" | "down";

interface ResourceState<T> {
        data: T | null;
        fetchedAt: number | null;
        fetching: boolean;
        error: string | null;
        /** Set when an SSE event invalidated it; the next poll prioritizes it. */
        dirty: boolean;
}

const ACTIVE_POLL_MS = 4000;
const BACKGROUND_POLL_MS = 20000;
const ACTIVITY_RING_MAX = 80;

export class DashboardStore {
        readonly client: EngineClient;
        /** Resources the active screen declared — polled fast; the rest slow. */
        activeResources: Set<ResourceId> = new Set();
        connection: ConnectionState = "connecting";
        /** Milliseconds since epoch of the last successful SSE or REST contact. */
        lastContact = 0;
        private states = new Map<ResourceId, ResourceState<unknown>>();
        private activity: ActivityItem[] = [];
        private activitySeq = 0;
        private listeners = new Set<() => void>();
        private pollTimer: ReturnType<typeof setInterval> | null = null;
        private sseAbort: AbortController | null = null;
        private stopped = false;
        /** Detail caches (drill-in fetches) keyed by "resource:id". */
        private details = new Map<string, { data: unknown; fetchedAt: number }>();

        constructor(client?: EngineClient) {
                this.client = client ?? new EngineClient();
                for (const id of Object.keys(LOADERS) as ResourceId[]) {
                        this.states.set(id, { data: null, fetchedAt: null, fetching: false, error: null, dirty: false });
                }
        }

        // ---- lifecycle ----

        start(): void {
                this.stopped = false;
                void this.refreshAll();
                this.connectEvents();
                this.pollTimer = setInterval(() => void this.poll(), ACTIVE_POLL_MS);
        }

        stop(): void {
                this.stopped = true;
                if (this.pollTimer) clearInterval(this.pollTimer);
                this.pollTimer = null;
                this.sseAbort?.abort();
                this.sseAbort = null;
                this.listeners.clear();
        }

        /** Re-declare which resources the visible screen needs (fast lane). */
        setActiveResources(ids: ResourceId[]): void {
                this.activeResources = new Set(ids);
                // Fetch anything the active screen needs that we've never loaded.
                for (const id of ids) {
                        const st = this.states.get(id);
                        if (st && !st.data && !st.fetching) void this.refresh(id);
                }
        }

        subscribe(fn: () => void): () => void {
                this.listeners.add(fn);
                return () => this.listeners.delete(fn);
        }

        private notify(): void {
                for (const fn of this.listeners) {
                        try {
                                fn();
                        } catch {
                                /* a broken listener never breaks the store */
                        }
                }
        }

        // ---- reads ----

        snapshot<T>(id: ResourceId): { data: T | null; ageMs: number | null; fetching: boolean; error: string | null } {
                const st = this.states.get(id) as ResourceState<T> | undefined;
                if (!st) return { data: null, ageMs: null, fetching: false, error: "unknown resource" };
                return {
                        data: st.data,
                        ageMs: st.fetchedAt ? Date.now() - st.fetchedAt : null,
                        fetching: st.fetching,
                        error: st.error,
                };
        }

        activityRing(): readonly ActivityItem[] {
                return this.activity;
        }

        /**
         * M6-2: live progress of one in-flight run, read from the polled liveRuns
         * snapshot — no extra request, because the Learning Lab's fast lane already
         * refreshes that resource while the screen is visible. Returns null for a
         * finalized run: the engine drops its live entry at finalize, and the DB row
         * (with the persisted counters and the full transcript) becomes authoritative.
         */
        liveRun(id: string): LiveRun | null {
                const runs = this.snapshot<LiveRunsResponse>("liveRuns").data?.runs ?? [];
                return runs.find((r) => r.id === id) ?? null;
        }

        /** All in-flight runs (empty when the engine is idle or predates M6-2). */
        liveRuns(): LiveRun[] {
                return this.snapshot<LiveRunsResponse>("liveRuns").data?.runs ?? [];
        }

        // ---- detail fetches (drill-in; cached with the resource id) ----

        async runDetail(id: string): Promise<import("./dashboard-types.ts").RunDetail> {
                const r = await this.cachedDetail(`run:${id}`, () =>
                        this.client.get<RunDetailResponse>(`/api/runs/${encodeURIComponent(id)}`),
                );
                return r.run;
        }

        async taskDetail(id: string): Promise<import("./dashboard-types.ts").TaskDetail> {
                const r = await this.cachedDetail(`task:${id}`, () =>
                        this.client.get<TaskDetailResponse>(`/api/tasks/${encodeURIComponent(id)}`),
                );
                return r.task;
        }

        async memoryHistory(tier: string): Promise<import("./dashboard-types.ts").MemoryHistoryEntry[]> {
                const r = await this.cachedDetail(`memhist:${tier}`, () =>
                        this.client.get<MemoryHistoryResponse>(`/api/memory/${encodeURIComponent(tier)}/history`),
                );
                return r.history;
        }

        async dreamNotes(id: string): Promise<import("./dashboard-types.ts").DreamNote[]> {
                const r = await this.cachedDetail(`dreamnotes:${id}`, () =>
                        this.client.get<DreamNotesResponse>(`/api/dreams/${encodeURIComponent(id)}/notes`),
                );
                return r.notes;
        }

        async skillDetail(id: string): Promise<import("./dashboard-types.ts").SkillDetailResponse> {
                return this.cachedDetail(`skill:${id}`, () =>
                        this.client.get<SkillDetailResponse>(`/api/skills/${encodeURIComponent(id)}`),
                );
        }

        async automationRuns(id: string): Promise<import("./dashboard-types.ts").AutomationRun[]> {
                const r = await this.cachedDetail(`automationruns:${id}`, () =>
                        this.client.get<AutomationRunsResponse>(`/api/automations/${encodeURIComponent(id)}/runs`),
                );
                return r.runs;
        }

        private async cachedDetail<T>(key: string, load: () => Promise<T>): Promise<T> {
                const hit = this.details.get(key);
                // Detail cache TTL: 15s — enough for drill-in render + a re-open, short
                // enough that a rollback elsewhere shows on the next visit.
                if (hit && Date.now() - hit.fetchedAt < 15_000) return hit.data as T;
                const data = await load();
                this.details.set(key, { data, fetchedAt: Date.now() });
                return data;
        }

        // ---- actions (mutations; each invalidates what the event stream would
        //      also invalidate, so a down SSE link still heals) ----

        async runTaskCycle(taskId: string): Promise<{ started: boolean; error?: string }> {
                try {
                        return await this.client.post<{ started: boolean; error?: string }>(
                                `/api/tasks/${encodeURIComponent(taskId)}/run`,
                        );
                } finally {
                        void this.refresh("overview");
                }
        }

        async mintTask(): Promise<MintResponse> {
                try {
                        return await this.client.post<MintResponse>("/api/tasks/mint");
                } finally {
                        void this.refresh("overview");
                }
        }

        async runDream(): Promise<{ started?: boolean; skipped?: string; error?: string }> {
                try {
                        return await this.client.post<{ started?: boolean; skipped?: string; error?: string }>("/api/dreams/run");
                } finally {
                        void this.refresh("overview");
                }
        }

        async rollbackMemory(tier: string, version: number): Promise<{ ok: boolean }> {
                const r = await this.client.post<{ ok: boolean }>(`/api/memory/${encodeURIComponent(tier)}/rollback`, {
                        version,
                });
                void this.refresh("memory");
                void this.refresh("memoryProjects");
                void this.refresh("overview");
                this.clearDetailCache(`memhist:${tier}`);
                return r;
        }

        async createNote(content: string, projectPath: string): Promise<NoteCreateResponse> {
                const r = await this.client.post<NoteCreateResponse>("/api/notes", { content, project_path: projectPath });
                void this.refresh("notes");
                void this.refresh("overview");
                return r;
        }

        async syncNotes(): Promise<NotesSyncResponse> {
                const r = await this.client.post<NotesSyncResponse>("/api/notes/sync");
                void this.refresh("notes");
                void this.refresh("overview");
                return r;
        }

        async rollbackSkill(id: string, version: number): Promise<{ ok: boolean }> {
                const r = await this.client.post<{ ok: boolean }>(`/api/skills/${encodeURIComponent(id)}/rollback`, {
                        version,
                });
                void this.refresh("skills");
                this.clearDetailCache(`skill:${id}`);
                return r;
        }

        async retireSkill(id: string): Promise<{ ok: boolean }> {
                const r = await this.client.post<{ ok: boolean }>(`/api/skills/${encodeURIComponent(id)}/retire`);
                void this.refresh("skills");
                this.clearDetailCache(`skill:${id}`);
                return r;
        }

        async triggerJob(id: string): Promise<{ ok: boolean; result?: unknown; error?: string }> {
                try {
                        return await this.client.post(`/api/jobs/${encodeURIComponent(id)}/trigger`);
                } finally {
                        void this.refresh("jobs");
                }
        }

        async toggleJob(id: string): Promise<{ ok: boolean; error?: string }> {
                try {
                        return await this.client.post(`/api/jobs/${encodeURIComponent(id)}/toggle`);
                } finally {
                        void this.refresh("jobs");
                }
        }

        async clearWebCache(): Promise<WebCacheClearResponse> {
                const r = await this.client.post<WebCacheClearResponse>("/api/webcache/clear");
                void this.refresh("webcache");
                return r;
        }

        async sweepWebCache(): Promise<WebCacheSweepResponse> {
                const r = await this.client.post<WebCacheSweepResponse>("/api/webcache/sweep");
                void this.refresh("webcache");
                return r;
        }

        /** Drop cached drill-in fetches (all, or only keys starting with the
         * prefix, e.g. "memhist:project"). Mutations call this so a rollback is
         * visible on the very next open instead of after the 15s TTL. */
        clearDetailCache(prefix?: string): void {
                if (prefix === undefined) {
                        this.details.clear();
                        return;
                }
                for (const key of [...this.details.keys()]) {
                        if (key.startsWith(prefix)) this.details.delete(key);
                }
        }

        async createAutomation(body: Record<string, unknown>): Promise<import("./dashboard-types.ts").Automation> {
                const r = await this.client.post<{ automation: import("./dashboard-types.ts").Automation }>(
                        "/api/automations",
                        body,
                );
                void this.refresh("automations");
                return r.automation;
        }

        async patchAutomation(id: string, body: Record<string, unknown>): Promise<Automation> {
                const r = await this.client.patch<{ automation: Automation }>(`/api/automations/${encodeURIComponent(id)}`, body);
                void this.refresh("automations");
                this.clearDetailCache(`automationruns:${id}`);
                return r.automation;
        }

        async deleteAutomation(id: string): Promise<{ ok: boolean }> {
                const r = await this.client.del<{ ok: boolean }>(`/api/automations/${encodeURIComponent(id)}`);
                void this.refresh("automations");
                return r;
        }

        async runAutomation(id: string): Promise<{ ok: boolean; error?: string }> {
                try {
                        return await this.client.post(`/api/automations/${encodeURIComponent(id)}/run`);
                } finally {
                        void this.refresh("automations");
                }
        }

        async skipAutomation(id: string): Promise<Automation> {
                const r = await this.client.post<{ automation: Automation }>(`/api/automations/${encodeURIComponent(id)}/skip`);
                void this.refresh("automations");
                this.clearDetailCache(`automationruns:${id}`);
                return r.automation;
        }

        async snoozeAutomation(id: string, minutes: number): Promise<Automation> {
                const r = await this.client.post<{ automation: Automation }>(
                        `/api/automations/${encodeURIComponent(id)}/snooze`,
                        { minutes },
                );
                void this.refresh("automations");
                return r.automation;
        }

        // ---- internals ----

        async refresh(id: ResourceId): Promise<void> {
                const st = this.states.get(id);
                if (!st || st.fetching) return;
                st.fetching = true;
                st.error = null;
                this.notify();
                try {
                        const data = await LOADERS[id](this.client);
                        st.data = data;
                        st.fetchedAt = Date.now();
                        st.dirty = false;
                        this.lastContact = Date.now();
                        if (this.connection !== "up") {
                                this.connection = "up";
                        }
                } catch (e) {
                        st.error = (e as Error).message;
                        // 0-status = unreachable → degraded mode; keep the old snapshot.
                        if ((e as EngineHttpError).status === 0) this.connection = "down";
                } finally {
                        st.fetching = false;
                        this.notify();
                }
        }

        private async refreshAll(): Promise<void> {
                await Promise.all((Object.keys(LOADERS) as ResourceId[]).map((id) => this.refresh(id)));
        }

        private async poll(): Promise<void> {
                if (this.stopped) return;
                const now = Date.now();
                // Fast lane: active resources (or dirty ones); slow lane: the rest,
                // but only if they were ever fetched (background screens refresh on
                // switch anyway — no wasted traffic for screens never visited).
                const jobs: Promise<void>[] = [];
                for (const [id, st] of this.states) {
                        const fast = this.activeResources.has(id) || st.dirty;
                        const interval = fast ? ACTIVE_POLL_MS : BACKGROUND_POLL_MS;
                        const last = st.fetchedAt ?? 0;
                        if (now - last >= interval && !st.fetching) jobs.push(this.refresh(id));
                }
                // Connection healing: if REST says up but SSE died, reconnect SSE.
                if (this.connection === "up" && !this.sseAbort) this.connectEvents();
                await Promise.all(jobs);
        }

        private connectEvents(): void {
                if (this.stopped) return;
                this.sseAbort?.abort();
                const ctrl = new AbortController();
                this.sseAbort = ctrl;
                const url = `${this.client.base}/api/events`;
                // Node/bun fetch streaming read of SSE — no EventSource in bun.
                void (async () => {
                        try {
                                // engineFetch for the SSE lane too: a raw fetch CAN set headers
                                // (the ?token= query escape exists for browser EventSource, which
                                // we do not use), and the 401-heal keeps a live dashboard across
                                // an engine reboot — the 5s reconnect below re-dials and
                                // engineFetch re-reads the rotated token.
                                const resp = await engineFetch(url, { signal: ctrl.signal, headers: { Accept: "text/event-stream" } });
                                if (!resp.ok || !resp.body) throw new Error(`events ${resp.status}`);
                                this.connection = "up";
                                this.lastContact = Date.now();
                                this.notify();
                                const reader = resp.body.getReader();
                                const decoder = new TextDecoder();
                                let buf = "";
                                for (;;) {
                                        const { done, value } = await reader.read();
                                        if (done) break;
                                        buf += decoder.decode(value, { stream: true });
                                        // SSE frames are separated by a blank line.
                                        let sep = buf.indexOf("\n\n");
                                        while (sep !== -1) {
                                                const frame = buf.slice(0, sep);
                                                buf = buf.slice(sep + 2);
                                                this.handleFrame(frame);
                                                sep = buf.indexOf("\n\n");
                                        }
                                }
                                throw new Error("event stream closed");
                        } catch {
                                if (ctrl.signal.aborted || this.stopped) return;
                                // Down or dropped: degrade, then retry with backoff.
                                this.connection = this.lastContact && Date.now() - this.lastContact > 30_000 ? "down" : "reconnecting";
                                this.notify();
                                setTimeout(() => {
                                        if (!this.stopped && this.sseAbort === ctrl) this.connectEvents();
                                }, 5000);
                        }
                })();
        }

        private handleFrame(frame: string): void {
                // The engine writes ENVELOPE-ONLY frames (server.ts /api/events):
                //   data: {"event":"memory:changed","payload":{…},"ts":…}
                // Named-event frames ("event: x" + "data: {…}", the browser
                // EventSource idiom) are also accepted so the mock engine and any
                // future relay keep working unchanged.
                let namedEvent: string | null = null;
                let data = "";
                for (const line of frame.split("\n")) {
                        if (line.startsWith("event:")) namedEvent = line.slice(6).trim();
                        else if (line.startsWith("data:")) data += line.slice(5).trim();
                }
                if (!data) return;
                let parsed: unknown;
                try {
                        parsed = JSON.parse(data);
                } catch {
                        return;
                }
                let event: string;
                let payload: Record<string, unknown>;
                let ts: number;
                if (
                        parsed !== null &&
                        typeof parsed === "object" &&
                        "event" in parsed &&
                        typeof (parsed as Record<string, unknown>).event === "string"
                ) {
                        const env = parsed as { event: string; payload?: unknown; ts?: unknown };
                        event = env.event;
                        payload =
                                env.payload !== null && typeof env.payload === "object" ? (env.payload as Record<string, unknown>) : {};
                        ts = typeof env.ts === "number" ? env.ts : Date.now();
                } else if (namedEvent !== null) {
                        event = namedEvent;
                        payload = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
                        ts = typeof payload.ts === "number" ? payload.ts : Date.now();
                } else {
                        return;
                }
                if (event === "ping") return;
                const ev: AgentEvent = { event, payload, ts };
                this.lastContact = Date.now();
                // Activity ring.
                const desc = describeEvent(ev);
                if (desc && event !== "hello") {
                        this.activity.unshift({ key: `${this.activitySeq++}`, ts: ev.ts, event, ...desc });
                        if (this.activity.length > ACTIVITY_RING_MAX) this.activity.length = ACTIVITY_RING_MAX;
                } else if (desc && event === "hello" && this.activity.length === 0) {
                        this.activity.unshift({ key: `${this.activitySeq++}`, ts: ev.ts, event, ...desc });
                }
                // Invalidations.
                const resources = INVALIDATIONS[event];
                if (resources) {
                        for (const id of resources) {
                                const st = this.states.get(id);
                                if (st) {
                                        st.dirty = true;
                                        // Dirty + active (or cheap) → immediate refetch.
                                        if (this.activeResources.has(id)) void this.refresh(id);
                                }
                        }
                }
                // M6: run transitions also invalidate the OPEN detail pane's run
                // history — the drill-in fetch is cached for 15s, so without this
                // a run finishing under an open pane never appears until Esc+re-open
                // past the TTL. The SSE payload carries the routine's id; a missing
                // payload clears every cached automationruns:* key (<=20 routines).
                if (event.startsWith("automation:run-") || event === "automation:skipped" || event === "automation:chained") {
                        const rid = typeof (ev.payload as any)?.id === "string" ? (ev.payload as any).id : null;
                        if (rid !== null) {
                                this.clearDetailCache(`automationruns:${rid}`);
                        } else {
                                this.clearDetailCache("automationruns:");
                        }
                }
                this.notify();
        }
}
