#!/usr/bin/env bun
/**
 * dashboard_fixture_engine.ts — capture-time fixture engine for TUI dashboard
 * stills (the PTY lane's data source; docs/tui-capture-workflow.md).
 *
 * Boots the repo's own dashboard test double
 * (pi-repo/packages/self-learning/test/dashboard-mock-engine.ts — the same
 * deterministic REST+SSE surface the D6 render suite runs against) and fronts
 * it with a capture-safe adapter on a FIXED port:
 *
 *   - every JSON body is scrubbed of test-double markers ("unown (mock)",
 *     "mock rule", "(mock)", "mock-kimi", "auto-mock-", "note-mock-") and
 *     re-branded to what a real deployment reports — the agent block becomes
 *     the live engine's own default shape (provider "zai-bridge/kimi-k2.5",
 *     the string src/runner.ts reports with default env);
 *   - a few list endpoints are enriched with additional plausible rows so the
 *     stills show a lived-in system (tasks, runs, cycles, improvements,
 *     dreams, skills, hooks, bridge log, automations, sandboxes), with
 *     internally consistent ids and now-relative timestamps;
 *   - time-ordered lists are returned NEWEST-FIRST, matching the live
 *     engine's wire behavior (runs/hooks/notes/dreams/cycles/improvements
 *     come back ORDER BY <time> DESC from src/server.ts);
 *   - /api/overview KPIs are reconciled with the enriched lists;
 *   - /api/events is a streaming SSE fan-out: the test double's own frames
 *     are piped through verbatim (hello + the per-connection burst), plus a
 *     scripted timeline of plausible envelope events keeps the dashboard's
 *     activity rail alive with fresh entries.
 *
 * The fixture is deterministic per boot (all timestamps are now-relative) and
 * hermetic: loopback only, no DB, no LLM calls, no .env needed. Captures made
 * against it never depend on credentials being present.
 *
 * Usage:   bun scripts/tui-capture/dashboard_fixture_engine.ts
 * Env:     FIXTURE_PORT (default 3930)
 * Prints:  "fixture engine listening on http://127.0.0.1:<port>" when ready.
 * Stop:    SIGTERM / SIGINT (drains the adapter, the test double, the SSE
 *          upstream and the timeline).
 *
 * Point the dashboard at it with UNOWN_ENGINE_URL=http://127.0.0.1:<port>.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { startMockEngine } from "../../pi-repo/packages/self-learning/test/dashboard-mock-engine.ts";

const PORT = Number(process.env.FIXTURE_PORT || 3930);
const HOST = "127.0.0.1";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = (): number => Date.now();
const T0 = now(); // fixture epoch — every appended row is T0-relative

// ---------------------------------------------------------------------------
// The test double underneath
// ---------------------------------------------------------------------------

const mock = await startMockEngine();
const UP = mock.url; // ephemeral 127.0.0.1 port — never leaves loopback

// ---------------------------------------------------------------------------
// String scrub — no test-double vocabulary reaches a shipped still
// ---------------------------------------------------------------------------

const SCRUB: [RegExp, string][] = [
        [/unown \(mock\)/g, "unown (self-learning)"],
        [/mock-kimi/g, "zai-bridge/kimi-k2.5"],
        [/\(mock\)/g, ""],
        [/mock rule/g, "rule"],
        [/auto-mock-/g, "auto-"],
        [/note-mock-/g, "note-"],
];

function scrubValue(v: unknown): unknown {
        if (typeof v === "string") {
                let s = v;
                for (const [re, rep] of SCRUB) s = s.replace(re, rep);
                return s;
        }
        if (Array.isArray(v)) return v.map(scrubValue);
        if (v !== null && typeof v === "object") {
                const out: Record<string, unknown> = {};
                for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = scrubValue(val);
                return out;
        }
        return v;
}

// ---------------------------------------------------------------------------
// Enrichment rows — plausible, internally consistent, now-relative
// (shapes cloned 1:1 from the test double's own fixtures)
// ---------------------------------------------------------------------------

const extraTasks = [
        {
                id: "task-e2e-5",
                name: "stale-lock-recovery",
                description: "Recover when the engine DB is left locked by a crashed process.",
                category: "reliability",
                difficulty: 3,
                created_at: T0 - 6 * HOUR,
                passes: 7,
                fails: 2,
                improvements: 1,
                origin: "seed",
                status: "regression",
        },
        {
                id: "task-e2e-6",
                name: "stream-parse-edge-cases",
                description: "Handle truncated and fenced JSON in streaming model output.",
                category: "parsing",
                difficulty: 4,
                created_at: T0 - 95 * MIN,
                passes: 5,
                fails: 1,
                improvements: 1,
                origin: "minted",
                status: "capability",
        },
        {
                id: "task-e2e-7",
                name: "wiki-drift-detector",
                description: "Flag wiki pages whose code fences no longer match the source.",
                category: "docs",
                difficulty: 2,
                created_at: T0 - 50 * MIN,
                passes: 2,
                fails: 1,
                improvements: 0,
                origin: "seed",
                status: "regression",
        },
];

const extraRuns = [
        {
                id: "run-e2e-14",
                task_id: "task-e2e-4",
                kind: "candidate",
                status: "passed",
                started_at: T0 - 9 * MIN,
                ended_at: T0 - 8 * MIN,
                sandbox_id: "sbx-e2e-5",
                cycle_id: "cyc-e2e-4",
                improvement_id: "imp-e2e-4",
                tokens_in: 9100,
                tokens_out: 2400,
                tool_calls: 15,
                turns: 6,
                error: null,
        },
        {
                id: "run-e2e-15",
                task_id: "task-e2e-2",
                kind: "regression",
                status: "passed",
                started_at: T0 - 2 * HOUR,
                ended_at: T0 - 2 * HOUR + 90_000,
                sandbox_id: "sbx-e2e-6",
                cycle_id: null,
                improvement_id: null,
                tokens_in: 3900,
                tokens_out: 800,
                tool_calls: 6,
                turns: 3,
                error: null,
        },
        {
                id: "run-e2e-16",
                task_id: "task-e2e-5",
                kind: "baseline",
                status: "failed",
                started_at: T0 - 3 * HOUR,
                ended_at: T0 - 3 * HOUR + 4 * MIN,
                sandbox_id: "sbx-e2e-6",
                cycle_id: "cyc-e2e-5",
                improvement_id: null,
                tokens_in: 7600,
                tokens_out: 1800,
                tool_calls: 11,
                turns: 5,
                error: null,
        },
        {
                id: "run-e2e-17",
                task_id: "task-e2e-6",
                kind: "candidate",
                status: "passed",
                started_at: T0 - 75 * MIN,
                ended_at: T0 - 74 * MIN,
                sandbox_id: "sbx-e2e-5",
                cycle_id: "cyc-e2e-4",
                improvement_id: "imp-e2e-4",
                tokens_in: 8800,
                tokens_out: 2000,
                tool_calls: 13,
                turns: 5,
                error: null,
        },
];

const extraCycles = [
        {
                id: "cyc-e2e-4",
                task_id: "task-e2e-4",
                task_name: "curriculum-variant-hard",
                status: "improved",
                iteration: 3,
                created_at: T0 - 10 * MIN,
                ended_at: T0 - 8 * MIN,
                summary: "planned multi-step edits before touching code; candidate verified twice",
                shipped: 1,
        },
        {
                id: "cyc-e2e-5",
                task_id: "task-e2e-5",
                task_name: "stale-lock-recovery",
                status: "running",
                iteration: 1,
                created_at: T0 - 16 * MIN,
                ended_at: null,
                summary: null,
                shipped: 0,
        },
        {
                id: "cyc-e2e-6",
                task_id: "task-e2e-5",
                task_name: "stale-lock-recovery",
                status: "no-fix",
                iteration: 2,
                created_at: T0 - 3 * HOUR,
                ended_at: T0 - 3 * HOUR + 6 * MIN,
                summary: "mining found no rule worth shipping on the first pass",
                shipped: 0,
        },
        {
                id: "cyc-e2e-7",
                task_id: "task-e2e-3",
                task_name: "sandbox-escape-guard",
                status: "improved",
                iteration: 1,
                created_at: T0 - 6 * HOUR,
                ended_at: T0 - 6 * HOUR + 4 * MIN,
                summary: "deny-list extended to process substitution forms",
                shipped: 1,
        },
        {
                id: "cyc-e2e-8",
                task_id: "task-e2e-7",
                task_name: "wiki-drift-detector",
                status: "already-passing",
                iteration: 0,
                created_at: T0 - 26 * HOUR,
                ended_at: T0 - 26 * HOUR + 2 * MIN,
                summary: null,
                shipped: 0,
        },
];

const extraImprovements = [
        {
                id: "imp-e2e-4",
                cycle_id: "cyc-e2e-4",
                task_id: "task-e2e-4",
                iteration: 3,
                diagnosis: "the variant was attempted edit-first without a plan",
                proposal: "rule: plan multi-step edits when difficulty >= 5",
                patch: "- Emit a numbered plan before the first edit on difficulty-5 tasks.",
                target_tier: "user",
                status: "validated",
                baseline_run_id: "run-e2e-13",
                candidate_run_id: "run-e2e-14",
                score_before: "0/1",
                score_after: "1/1",
                created_at: T0 - 74 * MIN,
                decided_at: T0 - 65 * MIN,
        },
        {
                id: "imp-e2e-5",
                cycle_id: "cyc-e2e-5",
                task_id: "task-e2e-5",
                iteration: 1,
                diagnosis: "lock recovery retried before the stale pidfile was cleared",
                proposal: "rule: clear the stale lock before retrying",
                patch: "- Remove the lockfile when the holding pid is dead.",
                target_tier: "project",
                status: "proposed",
                baseline_run_id: "run-e2e-16",
                candidate_run_id: null,
                score_before: "0/1",
                score_after: null,
                created_at: T0 - 15 * MIN,
                decided_at: null,
        },
];

const extraDreams = [
        {
                id: "drm-e2e-3",
                started_at: T0 - 160 * MIN,
                ended_at: T0 - 158 * MIN,
                status: "done" as const,
                notes_in: 2,
                entries_merged: 1,
                entries_pruned: 2,
                entries_added: 1,
                output: "merged duplicate sandbox notes; pruned stale retry entries",
                note: null,
        },
        {
                id: "drm-e2e-4",
                started_at: T0 - 7 * HOUR,
                ended_at: T0 - 7 * HOUR + 2 * MIN,
                status: "done" as const,
                notes_in: 5,
                entries_merged: 3,
                entries_pruned: 4,
                entries_added: 2,
                output: "consolidated sandbox-denial playbooks into project memory",
                note: "canary kept the regression suite green",
        },
        {
                id: "drm-e2e-5",
                started_at: T0 - 2 * DAY + 3 * HOUR,
                ended_at: T0 - 2 * DAY + 3 * HOUR + 90_000,
                status: "gated" as const,
                notes_in: 1,
                entries_merged: 0,
                entries_pruned: 0,
                entries_added: 0,
                output: null,
                note: "canary failed on the sandbox-escape guard; nothing merged",
        },
];

const extraSkills = [
        {
                id: "skl-e2e-2",
                project_slug: "unown",
                project_path: "/home/dev/unown",
                name: "triage-flaky-tests",
                description: "Quarantine a flaky test and file the follow-up in one pass.",
                body: "# triage-flaky-tests\n\n1. Run the test five times.\n2. If it flakes, quarantine with a skip marker.\n3. Open a tracking issue.",
                status: "shipped",
                version: 3,
                dream_id: "drm-e2e-3",
                created_at: T0 - 150 * MIN,
                updated_at: T0 - 45 * MIN,
        },
        {
                id: "skl-e2e-3",
                project_slug: "dash-demo",
                project_path: "/tmp/dash-demo",
                name: "sqlite-migration-guard",
                description: "Check foreign keys before running a sqlite migration.",
                body: "# sqlite-migration-guard\n\n1. PRAGMA foreign_key_check.\n2. Fail the migration on violations.",
                status: "shipped",
                version: 1,
                dream_id: "drm-e2e-3",
                created_at: T0 - 44 * MIN,
                updated_at: T0 - 44 * MIN,
        },
        {
                id: "skl-e2e-4",
                project_slug: "unown",
                project_path: "/home/dev/unown",
                name: "weekend-triage-checklist",
                description: "Weekly review loop for quarantined tests and stale tasks.",
                body: "# weekend-triage-checklist\n\n1. List quarantined tests.\n2. Re-run each once.\n3. Un-quarantine the green ones.",
                status: "shipped",
                version: 2,
                dream_id: "drm-e2e-2",
                created_at: T0 - 9 * HOUR,
                updated_at: T0 - 5 * HOUR,
        },
        {
                id: "skl-e2e-5",
                project_slug: "unown",
                project_path: "/home/dev/unown",
                name: "engine-restart-runbook",
                description: "Restart a wedged engine without losing queued jobs.",
                body: "# engine-restart-runbook\n\n1. Drain the job queue.\n2. Stop the engine.\n3. Re-arm jobs on boot.",
                status: "shipped",
                version: 1,
                dream_id: "drm-e2e-4",
                created_at: T0 - 6 * HOUR,
                updated_at: T0 - 6 * HOUR,
        },
        {
                id: "skl-e2e-6",
                project_slug: "dash-demo",
                project_path: "/tmp/dash-demo",
                name: "pr-review-checklist",
                description: "Read the diff twice before requesting review; cite line numbers.",
                body: "# pr-review-checklist\n\n1. Read the full diff.\n2. Comment with file:line refs.",
                status: "shipped",
                version: 2,
                dream_id: "drm-e2e-4",
                created_at: T0 - 6 * HOUR + 60_000,
                updated_at: T0 - 90 * MIN,
        },
];

const extraNotes = [
        {
                id: "nte-e2e-6",
                run_id: "run-e2e-17",
                kind: "benchmark",
                project_slug: "unown",
                project_path: "/home/dev/unown",
                content: "Stream parser failed on fenced output; the closing-fence scan rule held after the patch.",
                created_at: T0 - 70 * MIN,
                dream_id: "drm-e2e-3",
        },
        {
                id: "nte-e2e-7",
                run_id: null,
                kind: "terminal",
                project_slug: "pi-mono",
                project_path: "/home/dev/pi-mono",
                content: "Engine restart after the wedge: queue drained first, no jobs lost — runbook worked.",
                created_at: T0 - 6 * HOUR,
                dream_id: "drm-e2e-4",
        },
];

const extraHooks = [
        { ts: T0 - 6 * MIN, run_id: "run-e2e-14", hook: "Stop", tool: null, decision: "log", reason: "candidate run closed clean", details: null },
        { ts: T0 - 15 * MIN, run_id: "run-e2e-17", hook: "PreToolUse", tool: "edit", decision: "allow", reason: "workspace write inside sandbox", details: null },
        { ts: T0 - 34 * MIN, run_id: "run-e2e-12", hook: "PostToolUse", tool: "edit", decision: "warn", reason: "large diff (11 files) in one turn", details: "diff: +412 -96" },
        { ts: T0 - 58 * MIN, run_id: "run-e2e-15", hook: "UserPromptSubmit", tool: null, decision: "augment", reason: "tiered memory injected (4 tiers, 517 chars)", details: null },
];

const extraBridgeLog = [
        { ts: T0 - 4 * MIN, model: "glm-4.6", stream: true, messages: 14, tools: 6, finishReason: "stop", contentChars: 2210, toolCalls: 4, promptTokens: 9400, completionTokens: 2300, durationMs: 5210 },
        { ts: T0 - 21 * MIN, model: "deepseek-v3.2", stream: true, messages: 9, tools: 5, finishReason: "tool_calls", contentChars: 640, toolCalls: 5, promptTokens: 7800, completionTokens: 1400, durationMs: 6480 },
        { ts: T0 - 47 * MIN, model: "qwen3-coder-plus", stream: false, messages: 6, tools: 0, finishReason: "stop", contentChars: 1180, toolCalls: 0, promptTokens: 5200, completionTokens: 900, durationMs: 2970 },
];

const extraAutomations = [
        {
                id: "auto-e2e-2",
                title: "weekly changelog digest",
                prompt: "Summarize the merged PRs since the last digest and draft the changelog.",
                cron_expr: "0 6 * * 1",
                delay_ms: null,
                workspace: "/home/dev/unown",
                mode: "read-only",
                model: null,
                max_runs: null,
                run_count: 2,
                scheduled_run_count: 2,
                lifecycle: "active",
                next_run_at: T0 + 3 * DAY,
                last_run_at: T0 - 4 * DAY,
                created_at: T0 - 16 * DAY,
                updated_at: T0 - 4 * DAY,
                schedule: "at 06:00 on Monday",
                lastRun: {
                        id: "arun-e2e-2",
                        automation_id: "auto-e2e-2",
                        trigger_kind: "schedule",
                        scheduled_at: T0 - 4 * DAY,
                        status: "succeeded",
                        started_at: T0 - 4 * DAY,
                        ended_at: T0 - 4 * DAY + 80_000,
                        exit_code: 0,
                        output: "## Weekly Changelog\n\n14 PRs merged; 3 memory rules shipped.",
                        error: null,
                        turns: 7,
                        tokens_in: 28_000,
                        tokens_out: 1200,
                },
        },
        {
                id: "auto-e2e-3",
                title: "nightly dependency sweep",
                prompt: "Check for vulnerable or yanked dependencies and open an issue per finding.",
                cron_expr: "30 2 * * *",
                delay_ms: null,
                workspace: "/home/dev/unown",
                mode: "read-only",
                model: null,
                max_runs: null,
                run_count: 9,
                scheduled_run_count: 9,
                lifecycle: "paused",
                next_run_at: null,
                last_run_at: T0 - 26 * HOUR,
                created_at: T0 - 12 * DAY,
                updated_at: T0 - 26 * HOUR,
                schedule: "at 02:30",
                lastRun: {
                        id: "arun-e2e-3",
                        automation_id: "auto-e2e-3",
                        trigger_kind: "schedule",
                        scheduled_at: T0 - 26 * HOUR,
                        status: "failed",
                        started_at: T0 - 26 * HOUR,
                        ended_at: T0 - 26 * HOUR + 40_000,
                        exit_code: 1,
                        output: null,
                        error: "registry rate-limited (429); retry scheduled",
                        turns: 2,
                        tokens_in: 6100,
                        tokens_out: 300,
                },
        },
        {
                id: "auto-e2e-4",
                title: "docs link checker",
                prompt: "Re-crawl the docs site and list broken or redirected links.",
                cron_expr: "0 */6 * * *",
                delay_ms: null,
                workspace: "/home/dev/unown",
                mode: "read-only",
                model: null,
                max_runs: null,
                run_count: 31,
                scheduled_run_count: 31,
                lifecycle: "active",
                next_run_at: T0 + 2 * HOUR,
                last_run_at: T0 - 4 * HOUR,
                created_at: T0 - 9 * DAY,
                updated_at: T0 - 4 * HOUR,
                schedule: "every 6h",
                lastRun: {
                        id: "arun-e2e-4",
                        automation_id: "auto-e2e-4",
                        trigger_kind: "schedule",
                        scheduled_at: T0 - 4 * HOUR,
                        status: "succeeded",
                        started_at: T0 - 4 * HOUR,
                        ended_at: T0 - 4 * HOUR + 55_000,
                        exit_code: 0,
                        output: "## Docs Link Check\n\n142 links crawled · 2 redirects updated · 0 broken.",
                        error: null,
                        turns: 4,
                        tokens_in: 15_400,
                        tokens_out: 700,
                },
        },
        {
                id: "auto-e2e-5",
                title: "release notes draft",
                prompt: "Draft release notes from the commits since the last tag.",
                cron_expr: "0 5 * * 1",
                delay_ms: null,
                workspace: "/home/dev/unown",
                mode: "read-only",
                model: null,
                max_runs: 4,
                run_count: 4,
                scheduled_run_count: 4,
                lifecycle: "completed",
                next_run_at: null,
                last_run_at: T0 - 6 * DAY,
                created_at: T0 - 34 * DAY,
                updated_at: T0 - 6 * DAY,
                schedule: "at 05:00 on Monday",
                lastRun: {
                        id: "arun-e2e-5",
                        automation_id: "auto-e2e-5",
                        trigger_kind: "schedule",
                        scheduled_at: T0 - 6 * DAY,
                        status: "succeeded",
                        started_at: T0 - 6 * DAY,
                        ended_at: T0 - 6 * DAY + 120_000,
                        exit_code: 0,
                        output: "## v2.2.0 draft\n\nHighlights: TUI dashboard, memory tiers, automations.",
                        error: null,
                        turns: 11,
                        tokens_in: 52_000,
                        tokens_out: 2600,
                },
        },
];

const extraSandboxes = [
        { id: "sbx-e2e-6", createdAt: T0 - 10 * MIN, label: "harness-cycle/task-e2e-4", files: 38 },
        { id: "sbx-e2e-7", createdAt: T0 - 33 * MIN, label: "harness-cycle/task-e2e-6", files: 44 },
        { id: "sbx-e2e-8", createdAt: T0 - 3 * HOUR, label: "interactive/session", files: 17 },
];

// ---------------------------------------------------------------------------
// Response enrichment — per-endpoint, applied after the generic scrub
// ---------------------------------------------------------------------------

const byTimeDesc = (key: string) => (a: Record<string, unknown>, b: Record<string, unknown>) =>
        Number(b[key] ?? 0) - Number(a[key] ?? 0);

function enrich(pathname: string, body: Record<string, unknown>): Record<string, unknown> {
        switch (pathname) {
                case "/api/overview": {
                        const kpis = { ...((body.kpis ?? {}) as Record<string, unknown>) };
                        kpis.tasks = 7;
                        kpis.improvementsShipped = 2;
                        kpis.dreams = 5;
                        kpis.notes = { total: 7, pending: 2 };
                        kpis.suite = { total: 7, passing: 5, capability: 2, regression: 4, minted: 3, graduated: 1, saturated: false };
                        return {
                                ...body,
                                agent: {
                                        name: "unown (self-learning)",
                                        layer: "self-learning v0.1",
                                        provider: "zai-bridge/kimi-k2.5", // the live engine's default provider string (src/runner.ts)
                                        bridge: (body.agent as Record<string, unknown> | undefined)?.bridge ?? { ok: true, port: 3031, requests: 927, errors: 3 },
                                },
                                kpis,
                        };
                }
                case "/api/memory/projects":
                        return {
                                ...body,
                                projects: [
                                        ...((body.projects ?? []) as unknown[]),
                                        { slug: "pi-mono", tier: "project:pi-mono", version: 5, chars: 637, updatedAt: T0 - 2 * HOUR },
                                        { slug: "docs-site", tier: "project:docs-site", version: 2, chars: 214, updatedAt: T0 - 5 * HOUR },
                                        { slug: "data-pipeline", tier: "project:data-pipeline", version: 7, chars: 891, updatedAt: T0 - 26 * HOUR },
                                ],
                        };
                case "/api/tasks":
                        return { ...body, tasks: [...(body.tasks as unknown[]), ...extraTasks] };
                case "/api/runs":
                        return { ...body, runs: [...(body.runs as unknown[]), ...extraRuns].sort(byTimeDesc("started_at")) };
                case "/api/notes":
                        return { ...body, notes: [...(body.notes as unknown[]), ...extraNotes].sort(byTimeDesc("created_at")) };
                case "/api/cycles":
                        return { ...body, cycles: [...(body.cycles as unknown[]), ...extraCycles].sort(byTimeDesc("created_at")) };
                case "/api/improvements":
                        return { ...body, improvements: [...(body.improvements as unknown[]), ...extraImprovements].sort(byTimeDesc("created_at")) };
                case "/api/dreams":
                        return { ...body, dreams: [...(body.dreams as unknown[]), ...extraDreams].sort(byTimeDesc("started_at")) };
                case "/api/skills":
                        return { ...body, skills: [...(body.skills as unknown[]), ...extraSkills] };
                case "/api/hooks":
                        return { ...body, hooks: [...(body.hooks as unknown[]), ...extraHooks].sort(byTimeDesc("ts")) };
                case "/api/sandboxes":
                        return { ...body, sandboxes: [...(body.sandboxes as unknown[]), ...extraSandboxes].sort(byTimeDesc("createdAt")) };
                case "/api/bridge": {
                        const bridge = { ...(body as Record<string, unknown>) };
                        bridge.log = [...((bridge.log ?? []) as unknown[]), ...extraBridgeLog].sort(byTimeDesc("ts"));
                        bridge.requests = 1204;
                        return bridge;
                }
                case "/api/automations":
                        return { ...body, automations: [...(body.automations as unknown[]), ...extraAutomations] };
                default:
                        return body;
        }
}

// ---------------------------------------------------------------------------
// SSE fan-out — one upstream subscription, N dashboard clients, live timeline
// ---------------------------------------------------------------------------

const sseClients = new Set<ServerResponse>();
let shuttingDown = false;

function broadcast(frame: string): void {
        for (const res of sseClients) {
                try {
                        res.write(frame);
                } catch {
                        sseClients.delete(res);
                }
        }
}

/** Envelope frame — the live engine's wire format (src/server.ts /api/events). */
function emitEvent(event: string, payload: Record<string, unknown>): void {
        broadcast(`data: ${JSON.stringify({ event, payload, ts: now() })}\n\n`);
}

let upstreamAbort: AbortController | null = null;

async function subscribeUpstream(): Promise<void> {
        if (shuttingDown) return;
        upstreamAbort = new AbortController();
        try {
                const resp = await fetch(`${UP}/api/events`, {
                        signal: upstreamAbort.signal,
                        headers: { Accept: "text/event-stream" },
                });
                if (!resp.ok || !resp.body) throw new Error(`upstream events ${resp.status}`);
                const reader = resp.body.getReader();
                const decoder = new TextDecoder();
                let buf = "";
                for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buf += decoder.decode(value, { stream: true });
                        let sep: number;
                        while ((sep = buf.indexOf("\n\n")) !== -1) {
                                broadcast(buf.slice(0, sep) + "\n\n");
                                buf = buf.slice(sep + 2);
                        }
                }
        } catch {
                /* aborted or closed — reconnect below */
        }
        if (!shuttingDown) setTimeout(subscribeUpstream, 2000);
}

/** A plausible live-engine event stream (loop): keeps the activity rail fresh. */
const TIMELINE: [string, Record<string, unknown>][] = [
        ["job:finished", { name: "note-sync" }],
        ["run:started", { taskId: "task-e2e-1", kind: "candidate" }],
        ["run:finished", { taskId: "task-e2e-1", status: "passed", durationMs: 61_000 }],
        ["hook", { hook: "PreToolUse", tool: "bash", decision: "deny" }],
        ["notes:synced", { count: 3 }],
        ["improvement:proposed", { taskId: "task-e2e-5", iteration: 1 }],
        ["memory:budget", { prunedBlocks: 1 }],
        ["run:started", { taskId: "task-e2e-4", kind: "baseline" }],
        ["dream:started", { notesIn: 3 }],
        ["cycle:finished", { taskId: "task-e2e-4", status: "improved" }],
        ["run:finished", { taskId: "task-e2e-4", status: "failed", durationMs: 94_000 }],
        ["dream:finished", { status: "done", version: 6 }],
        ["job:finished", { name: "auto-dream" }],
        ["skill:minted", { name: "triage-flaky-tests", project: "unown" }],
        ["task:graduated", { id: "task-e2e-2" }],
        ["memory:changed", { tier: "user", version: 7, changedBy: "autodream" }],
];

let timelineTimer: ReturnType<typeof setTimeout> | null = null;
function startTimeline(): void {
        let i = 0;
        const step = (): void => {
                if (shuttingDown) return;
                const [event, payload] = TIMELINE[i % TIMELINE.length]!;
                emitEvent(event, payload);
                i++;
                // Front-load the first lap (1.5s apart) so a freshly connected
                // dashboard fills its activity rail within the first capture beats,
                // then settle to a calm 4s cadence.
                const gap = i < TIMELINE.length ? 1500 : 4000;
                timelineTimer = setTimeout(step, gap);
        };
        timelineTimer = setTimeout(step, 2500);
}

function sseHandler(req: IncomingMessage, res: ServerResponse): void {
        res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "X-Accel-Buffering": "no",
        });
        res.write("retry: 2000\n\n");
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
}

// ---------------------------------------------------------------------------
// REST proxy — forward, scrub, enrich
// ---------------------------------------------------------------------------

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function proxyRest(req: IncomingMessage, res: ServerResponse): Promise<void> {
        try {
                const body = await readBody(req);
                const headers: Record<string, string> = {};
                const ct = req.headers["content-type"];
                if (ct) headers["Content-Type"] = ct;
                if (req.headers.accept) headers.Accept = req.headers.accept;
                const upstream = await fetch(UP + req.url, {
                        method: req.method,
                        headers,
                        body: body && body.length ? body : undefined,
                        signal: AbortSignal.timeout(5000),
                });
                const upCt = upstream.headers.get("content-type") ?? "application/json; charset=utf-8";
                const cors = {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
                        "Access-Control-Allow-Headers": "Content-Type",
                };
                if (upCt.includes("json")) {
                        const text = await upstream.text();
                        let out: unknown = JSON.parse(text);
                        out = scrubValue(out);
                        const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
                        out = enrich(url.pathname, out as Record<string, unknown>);
                        res.writeHead(upstream.status, { "Content-Type": "application/json; charset=utf-8", ...cors });
                        res.end(JSON.stringify(out));
                } else {
                        const buf = Buffer.from(await upstream.arrayBuffer());
                        res.writeHead(upstream.status, { "Content-Type": upCt, ...cors });
                        res.end(buf);
                }
        } catch (e) {
                res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ error: `fixture upstream failed: ${(e as Error).message}` }));
        }
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
        if (req.method === "OPTIONS") {
                res.writeHead(204, {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
                        "Access-Control-Allow-Headers": "Content-Type",
                });
                res.end();
                return;
        }
        if (req.method === "GET" && url.pathname === "/api/events") {
                sseHandler(req, res);
                return;
        }
        void proxyRest(req, res);
});

await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(PORT, HOST, resolve);
});

void subscribeUpstream();
startTimeline();

console.log(`fixture engine listening on http://${HOST}:${PORT} (test double at ${UP})`);

function drain(): void {
        if (shuttingDown) return;
        shuttingDown = true;
        if (timelineTimer) clearTimeout(timelineTimer);
        upstreamAbort?.abort();
        for (const res of sseClients) {
                try {
                        res.end();
                } catch {
                        /* already closed */
                }
        }
        sseClients.clear();
        server.close();
        void mock.close().finally(() => process.exit(0));
        // Never hang the drain on a straggler socket.
        setTimeout(() => process.exit(0), 1500).unref?.();
}

process.on("SIGTERM", drain);
process.on("SIGINT", drain);
