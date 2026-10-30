// test/dashboard-mock-engine.ts — the D6 dashboard test double: a typed mock
// of the self-learning engine's REST + SSE surface, ported from
// e2e/mock-engine.mjs (the retired web dashboard's stand-in) and extended
// with everything the TUI dashboard added on top: GET /api/memory/projects,
// GET /api/tasks/:id, GET /api/automations/:id, POST /api/tasks/mint,
// POST /api/notes{,/sync}, skill rollback/retire, automations create/patch/
// delete/run and the webcache sweep pair.
//
// Hermetic by construction (the test/_env.ts + bunfig.toml preload contract):
// pure node:http + node:url on 127.0.0.1:0 — it never touches the redirected
// store/DB, the live engine (:3030) or the llm-bridge (:3031), and has zero
// dependencies so it runs under plain `bun test` on every CI OS leg. The
// dashboard-types import below is type-only (erased at runtime).
//
// SSE frame format — the LIVE engine's envelope form (src/server.ts
// /api/events): one data line whose JSON carries {event, payload, ts}:
//     data: {"event":"memory:changed","payload":{"tier":"project",…},"ts":…}
// DashboardStore.handleFrame unwraps the envelope (and still accepts the
// named-event EventSource idiom "event: x" + "data: {…}" for robustness).
// The envelope bug this harness caught (handleFrame originally parsed only
// named frames, so live events arrived as "message" and invalidation never
// fired) is fixed in the store; the mock now speaks the live format so the
// REAL wire path is what the tests exercise.
//
// Stateful where the suites need it: the `calls` mutation counters, a
// per-path request hit map (all methods — dirty-refetch assertions),
// setOverviewToken() for a visible overview mutation, and POST /api/notes
// recording bodies and answering 413 over 20k chars.

import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { URL } from "node:url";
import type {
	Automation,
	AutomationRun,
	BridgeResponse,
	ChangedBy,
	Cycle,
	DelegationsResponse,
	Dream,
	HookEntry,
	Improvement,
	Job,
	LiveRun,
	MemoryHistoryEntry,
	MemoryTierInfo,
	Note,
	OverviewResponse,
	ProjectMemoryTier,
	Run,
	RunDetail,
	Sandbox,
	Skill,
	SkillVersion,
	Task,
	TaskDetail,
	WebCacheStats,
} from "../src/dashboard/dashboard-types.ts";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface MockEngine {
	port: number;
	url: string;
	close(): Promise<void>;
	/** Push an SSE event to all connected clients (for invalidation tests). */
	emit(event: string, payload: Record<string, unknown>): void;
	/** Mutation counters the tests assert on. */
	calls: MockEngineCalls;
	/** Replace a resource's payload: overview.kpis.totalRuns (a visible mutation). */
	setOverviewToken(v: number): void;
}

export interface MockEngineCalls {
	/** POST /api/memory/:tier/rollback — recorded tier ids. */
	rollbacks: string[];
	/** POST /api/dreams/run count. */
	dreams: number;
	/** POST /api/notes — bodies (content + project_path). */
	notesCreated: { content: string; projectPath: string }[];
	/** POST /api/notes/sync count. */
	syncs: number;
	/** POST /api/jobs/:id/trigger — job ids. */
	jobsTriggered: string[];
	/** POST /api/jobs/:id/toggle — job ids. */
	jobsToggled: string[];
	/** POST /api/skills/:id/rollback. */
	skillsRolledBack: { id: string; version: number }[];
	/** POST /api/skills/:id/retire — skill ids. */
	skillsRetired: string[];
	/** POST /api/automations count. */
	automationsCreated: number;
	/** POST /api/automations — the raw bodies (assert policy fields arrive). */
	automationsCreateBodies: Array<Record<string, unknown>>;
	/** POST /api/automations/:id/skip — ids. */
	automationsSkipped: string[];
	/** POST /api/automations/:id/snooze — {id, minutes}. */
	automationsSnoozed: Array<{ id: string; minutes: number }>;
	/** PATCH /api/automations/:id — {id, body} pairs (assert retry patches). */
	automationsPatched: Array<{ id: string; body?: Record<string, unknown> }>;
	/** DELETE /api/automations/:id — ids. */
	automationsDeleted: string[];
	/** POST /api/webcache/clear count. */
	webcacheCleared: number;
	/** POST /api/webcache/sweep count. */
	webcacheSwept: number;
	/** POST /api/tasks/mint count (the overview confirm-y flow). */
	mints: number;
	/** Per-path request hit map (every method; for dirty-refetch assertions). */
	hits: Map<string, number>;
}

// ---------------------------------------------------------------------------
// The mock engine
// ---------------------------------------------------------------------------

/** Boot a fresh, isolated mock engine on an OS-assigned ephemeral port. */
export async function startMockEngine(): Promise<MockEngine> {
	const now = (): number => Date.now();
	const T0 = now();
	const MIN = 60_000;

	// ---- fixtures (ported from e2e/mock-engine.mjs, shapes per
	// src/dashboard/dashboard-types.ts) ----

	const tiers: MemoryTierInfo[] = ["policy", "project", "user", "local"].map((tier, i) => ({
		tier,
		version: 4 + i,
		content: `# ${tier} memory (mock)\n\n- mock rule ${i + 1}: prefer standard library functions\n- mock rule ${i + 2}: run tests before pushing\n`,
		chars: 96 + i * 11,
		updatedAt: T0 - (i + 1) * 3 * MIN,
	}));

	const projectTiers: ProjectMemoryTier[] = [
		{ slug: "unown", tier: "project:unown", version: 3, chars: 412, updatedAt: T0 - 36 * MIN },
		{ slug: "dash-demo", tier: "project:dash-demo", version: 2, chars: 158, updatedAt: T0 - 8 * MIN },
	];

	const tasks: Task[] = [
		{
			id: "task-e2e-1",
			name: "fix-failing-test",
			description: "Make `bun test` pass after a regression.",
			category: "testing",
			difficulty: 2,
			created_at: T0 - 900 * MIN,
			passes: 12,
			fails: 3,
			improvements: 2,
			origin: "seed",
			status: "regression",
		},
		{
			id: "task-e2e-2",
			name: "parse-json-robustly",
			description: "Extract JSON from noisy model output.",
			category: "parsing",
			difficulty: 3,
			created_at: T0 - 500 * MIN,
			passes: 9,
			fails: 1,
			improvements: 1,
			origin: "seed",
			status: "regression",
		},
		{
			id: "task-e2e-3",
			name: "sandbox-escape-guard",
			description: "Deny bash redirect escapes in PreToolUse.",
			category: "security",
			difficulty: 4,
			created_at: T0 - 90 * MIN,
			passes: 4,
			fails: 2,
			improvements: 1,
			origin: "minted",
			status: "capability",
		},
		{
			id: "task-e2e-4",
			name: "curriculum-variant-hard",
			description: "Minted harder variant of parse-json-robustly.",
			category: "parsing",
			difficulty: 5,
			created_at: T0 - 30 * MIN,
			passes: 0,
			fails: 1,
			improvements: 0,
			origin: "minted",
			status: "capability",
		},
	];

	const taskDetails = new Map<string, TaskDetail>(
		tasks.map((t) => [
			t.id,
			{
				...t,
				files: {
					"task.md": `# ${t.name}\n\n${t.description}`,
					"verify.sh": "bun test test/",
				},
				verify: "bun test test/",
				prompt: `Complete task ${t.id}. ${t.description}`,
				source_run_id: t.origin === "minted" ? "run-e2e-13" : null,
			},
		]),
	);

	const runs: Run[] = [
		{
			id: "run-e2e-10",
			task_id: "task-e2e-1",
			kind: "baseline",
			status: "failed",
			started_at: T0 - 42 * MIN,
			ended_at: T0 - 41 * MIN,
			sandbox_id: "sbx-e2e-1",
			cycle_id: "cyc-e2e-3",
			improvement_id: null,
			tokens_in: 8100,
			tokens_out: 2100,
			tool_calls: 14,
			turns: 6,
			error: null,
		},
		{
			id: "run-e2e-11",
			task_id: "task-e2e-1",
			kind: "candidate",
			status: "passed",
			started_at: T0 - 38 * MIN,
			ended_at: T0 - 37 * MIN,
			sandbox_id: "sbx-e2e-2",
			cycle_id: "cyc-e2e-3",
			improvement_id: "imp-e2e-2",
			tokens_in: 8300,
			tokens_out: 1900,
			tool_calls: 12,
			turns: 5,
			error: null,
		},
		{
			id: "run-e2e-12",
			task_id: "task-e2e-3",
			kind: "regression",
			status: "passed",
			started_at: T0 - 25 * MIN,
			ended_at: T0 - 24 * MIN,
			sandbox_id: "sbx-e2e-3",
			cycle_id: null,
			improvement_id: null,
			tokens_in: 4200,
			tokens_out: 900,
			tool_calls: 8,
			turns: 4,
			error: null,
		},
		{
			id: "run-e2e-13",
			task_id: "task-e2e-4",
			kind: "baseline",
			status: "error",
			started_at: T0 - 12 * MIN,
			ended_at: T0 - 12 * MIN,
			sandbox_id: "sbx-e2e-4",
			cycle_id: null,
			improvement_id: null,
			tokens_in: 300,
			tokens_out: 0,
			tool_calls: 0,
			turns: 1,
			error: "bridge 504: upstream timeout",
		},
		{
			// An in-flight run, shaped like the real DB row MID-RUN: the
			// counters are written at finalize, so the row is all zeros and
			// ended_at is null. Everything moving about this row must come
			// from liveRuns below — that is the M6-2 contract the Lab renders.
			id: "run-e2e-14",
			task_id: "task-e2e-2",
			kind: "candidate",
			status: "running",
			started_at: T0 - 3 * MIN,
			ended_at: null,
			sandbox_id: "sbx-e2e-5",
			cycle_id: "cyc-e2e-4",
			improvement_id: null,
			tokens_in: 0,
			tokens_out: 0,
			tool_calls: 0,
			turns: 0,
			error: null,
		},
	];

	/**
	 * GET /api/runs/live — the live mirror of src/run-progress.ts's LiveRunView
	 * for the in-flight run above (same counters the SSE events carry).
	 */
	const liveRuns: LiveRun[] = [
		{
			id: "run-e2e-14",
			taskId: "task-e2e-2",
			kind: "candidate",
			cycleId: "cyc-e2e-4",
			improvementId: null,
			label: null,
			startedAt: T0 - 3 * MIN,
			turns: 4,
			tokensIn: 61_000,
			tokensOut: 2_400,
			toolCalls: 7,
			toolsUsed: ["read", "bash", "edit"],
			lastTool: { tool: "bash", phase: "start", at: T0 - 20_000 },
			lastTextPreview: "Running the suite once more before I touch the parser again.",
			contextTokens: 63_400,
			updatedAt: T0 - 5_000,
			elapsedMs: 3 * MIN,
		},
	];

	const runDetails = new Map<string, RunDetail>(
		runs.map((r, i) => [
			r.id,
			{
				...r,
				prompt: `Complete task ${r.task_id}.`,
				// runner.ts writes the transcript and the verify block at
				// FINALIZE, so a run that is still going has NEITHER — that is
				// why the Lab reads mid-run numbers from /api/runs/live instead.
				transcript:
					r.status === "running"
						? []
						: [
								{ type: "text", ts: r.started_at + 900, text: "Reading the task files first." },
								{ type: "tool_start", ts: r.started_at + 1500, tool: "read", input: "src/main.ts" },
								{ type: "tool_end", ts: r.started_at + 1700, tool: "read", output: "84 lines", isError: false },
								{ type: "tool_start", ts: r.started_at + 3000, tool: "bash", input: "bun test" },
								{
									type: "tool_end",
									ts: r.started_at + 9000,
									tool: "bash",
									output: i === 0 ? "1 fail" : "all green",
									isError: i === 0,
								},
								{ type: "text", ts: r.started_at + 12000, text: "Done — summary written." },
							],
				verify_output:
					r.status === "running"
						? null
						: {
								passed: r.status === "passed",
								summary: r.status === "passed" ? "tests green" : "1 failing test",
								log: "ran 12 tests in 3.1s",
							},
			},
		]),
	);

	const cycles: Cycle[] = [
		{
			id: "cyc-e2e-3",
			task_id: "task-e2e-1",
			task_name: "fix-failing-test",
			status: "improved",
			iteration: 2,
			created_at: T0 - 40 * MIN,
			ended_at: T0 - 35 * MIN,
			summary: "patched project memory rule; candidate verified twice",
			shipped: 1,
		},
		{
			id: "cyc-e2e-2",
			task_id: "task-e2e-2",
			task_name: "parse-json-robustly",
			status: "no-fix",
			iteration: 1,
			created_at: T0 - 300 * MIN,
			ended_at: T0 - 295 * MIN,
			summary: "mining produced no viable rule",
			shipped: 0,
		},
		{
			id: "cyc-e2e-1",
			task_id: "task-e2e-1",
			task_name: "fix-failing-test",
			status: "already-passing",
			iteration: 0,
			created_at: T0 - 800 * MIN,
			ended_at: T0 - 798 * MIN,
			summary: null,
			shipped: 0,
		},
	];

	const improvements: Improvement[] = [
		{
			id: "imp-e2e-2",
			cycle_id: "cyc-e2e-3",
			task_id: "task-e2e-1",
			iteration: 2,
			diagnosis: "agent retried the same failing command without reading the assertion",
			proposal: "rule: read the failing assertion before retrying",
			patch: "- Before re-running a failing test, read the assertion output.",
			target_tier: "project",
			status: "shipped",
			baseline_run_id: "run-e2e-10",
			candidate_run_id: "run-e2e-11",
			score_before: "0/1",
			score_after: "1/1",
			created_at: T0 - 37 * MIN,
			decided_at: T0 - 35 * MIN,
		},
		{
			id: "imp-e2e-1",
			cycle_id: "cyc-e2e-2",
			task_id: "task-e2e-2",
			iteration: 1,
			diagnosis: "json extraction broke on reasoning prefixes",
			proposal: "rule: balanced-brace scan before JSON.parse",
			patch: "- Scan for the first balanced {...} block.",
			target_tier: "policy",
			status: "rejected",
			baseline_run_id: "run-e2e-1",
			candidate_run_id: "run-e2e-2",
			score_before: "1/1",
			score_after: "1/1",
			created_at: T0 - 299 * MIN,
			decided_at: T0 - 296 * MIN,
		},
		{
			id: "imp-e2e-3",
			cycle_id: "cyc-e2e-2",
			task_id: "task-e2e-4",
			iteration: 1,
			diagnosis: "harder variant needs multi-step planning",
			proposal: "rule: plan before editing when difficulty >= 5",
			patch: "- Emit a plan for difficulty-5 tasks.",
			target_tier: "user",
			status: "proposed",
			baseline_run_id: "run-e2e-13",
			candidate_run_id: "run-e2e-14",
			score_before: "0/1",
			score_after: "0/1",
			created_at: T0 - 11 * MIN,
			decided_at: null,
		},
	];

	const dreams: Dream[] = [
		{
			id: "drm-e2e-2",
			started_at: T0 - 36 * MIN,
			ended_at: T0 - 35 * MIN,
			status: "done",
			notes_in: 3,
			entries_merged: 2,
			entries_pruned: 1,
			entries_added: 1,
			output: "consolidated retry discipline into project memory",
			note: "canary kept the last-passing task green",
		},
		{
			id: "drm-e2e-1",
			started_at: T0 - 600 * MIN,
			ended_at: T0 - 599 * MIN,
			status: "no-notes",
			notes_in: 0,
			entries_merged: 0,
			entries_pruned: 0,
			entries_added: 0,
			output: null,
			note: null,
		},
	];

	const dreamNotes: Note[] = [
		{
			id: "nte-e2e-1",
			run_id: "run-e2e-10",
			kind: "benchmark",
			project_slug: "unown",
			project_path: "/home/dev/unown",
			content: "The agent retried the same failing command; the fix was to read the assertion first.",
			created_at: T0 - 41 * MIN,
			dream_id: "drm-e2e-2",
		},
		{
			id: "nte-e2e-2",
			run_id: "run-e2e-12",
			kind: "terminal",
			project_slug: "unown",
			project_path: "/home/dev/unown",
			content: "Redirect-escape guard fired correctly on the bash deny-list test.",
			created_at: T0 - 24 * MIN,
			dream_id: "drm-e2e-2",
		},
	];

	// The notes inbox: a benchmark/terminal mix with two pending (dream_id null).
	const notes: Note[] = [
		...dreamNotes,
		{
			id: "nte-e2e-3",
			run_id: "run-e2e-13",
			kind: "benchmark",
			project_slug: "dash-demo",
			project_path: "/tmp/dash-demo",
			content: "Upstream timeout on the harder variant; plan multi-step edits before touching code.",
			created_at: T0 - 12 * MIN,
			dream_id: null,
		},
		{
			id: "nte-e2e-4",
			run_id: "run-e2e-12",
			kind: "terminal",
			project_slug: "dash-demo",
			project_path: "/tmp/dash-demo",
			content: "Sandbox session opened clean; no policy hits this run.",
			created_at: T0 - 9 * MIN,
			dream_id: null,
		},
		{
			id: "nte-e2e-5",
			run_id: "run-e2e-11",
			kind: "terminal",
			project_slug: "unown",
			project_path: "/home/dev/unown",
			content: "Candidate patch verified twice — the assertion-first rule holds.",
			created_at: T0 - 20 * MIN,
			dream_id: "drm-e2e-2",
		},
	];

	const hooks: HookEntry[] = [
		{
			ts: T0 - 23 * MIN,
			run_id: "run-e2e-12",
			hook: "PreToolUse",
			tool: "bash",
			decision: "deny",
			reason: "bash redirect escape",
			details: "cmd: cat /etc/passwd > out",
		},
		{
			ts: T0 - 24 * MIN,
			run_id: "run-e2e-12",
			hook: "SessionStart",
			tool: null,
			decision: "log",
			reason: "sandbox session opened",
			details: null,
		},
		{
			ts: T0 - 38 * MIN,
			run_id: "run-e2e-11",
			hook: "PostToolUse",
			tool: "bash",
			decision: "log-error",
			reason: "syntax gate: 1 failing test fed back",
			details: "exit 1",
		},
		{
			ts: T0 - 41 * MIN,
			run_id: "run-e2e-10",
			hook: "UserPromptSubmit",
			tool: null,
			decision: "augment",
			reason: "tiered memory injected (4 tiers, 402 chars)",
			details: null,
		},
	];

	// M11 outcome fields: the fixture covers all three verdict states on one
	// screen — passed (last_ok 1), FAILED (auto-dream, so the Router screen's
	// failure banner renders) and never-run-since-the-columns-landed (null,
	// which the row shows with NO glyph rather than a false checkmark).
	const jobs: Job[] = [
		{
			id: "job-harness-cycle",
			name: "harness-cycle",
			kind: "interval",
			schedule_ms: 900_000,
			event: null,
			enabled: 1,
			last_run: T0 - 9 * MIN,
			next_run: T0 + 6 * MIN,
			run_count: 132,
			status: "idle",
			description: "Pick a task, run it in a fresh sandbox, mine failures.",
			last_ok: 1,
			last_error: null,
			last_duration_ms: 412_000,
		},
		{
			id: "job-task-mint",
			name: "task-mint",
			kind: "interval",
			schedule_ms: 3_600_000,
			event: null,
			enabled: 1,
			last_run: T0 - 55 * MIN,
			next_run: T0 + 5 * MIN,
			run_count: 18,
			status: "idle",
			description: "Convert failures and curriculum variants into new tasks.",
			last_ok: null,
			last_error: null,
			last_duration_ms: null,
		},
		{
			id: "job-auto-dream",
			name: "auto-dream",
			kind: "interval",
			schedule_ms: 1_800_000,
			event: null,
			enabled: 1,
			last_run: T0 - 36 * MIN,
			next_run: T0 + 24 * MIN,
			run_count: 47,
			status: "idle",
			description: "Consolidate session notes into tiered memory.",
			last_ok: 0,
			last_error: "watchdog: job auto-dream exceeded 1200s",
			last_duration_ms: 1_200_000,
		},
		{
			id: "job-note-sync",
			name: "note-sync",
			kind: "interval",
			schedule_ms: 60_000,
			event: null,
			enabled: 1,
			last_run: T0 - 1 * MIN,
			next_run: T0 + MIN / 2,
			run_count: 921,
			status: "running",
			description: "Pull terminal session notes into the engine.",
			last_ok: 1,
			last_error: null,
			last_duration_ms: 640,
		},
		{
			id: "job-sandbox-gc",
			name: "sandbox-gc",
			kind: "interval",
			schedule_ms: 600_000,
			event: null,
			enabled: 1,
			last_run: T0 - 7 * MIN,
			next_run: T0 + 3 * MIN,
			run_count: 88,
			status: "idle",
			description: "Reap sandboxes older than the retention window.",
			last_ok: 1,
			last_error: null,
			last_duration_ms: 2_900,
		},
		{
			id: "job-improvement-shipped",
			name: "improvement-shipped",
			kind: "event",
			schedule_ms: null,
			event: "improvement:shipped",
			enabled: 1,
			last_run: T0 - 35 * MIN,
			next_run: null,
			run_count: 12,
			status: "idle",
			description: "Sweep regressions right after a memory patch ships.",
			last_ok: 1,
			last_error: null,
			last_duration_ms: 88_400,
		},
		{
			id: "job-run-finished",
			name: "run-finished",
			kind: "event",
			schedule_ms: null,
			event: "run:finished",
			enabled: 1,
			last_run: T0 - 24 * MIN,
			next_run: null,
			run_count: 304,
			status: "idle",
			description: "Record the run note for the next dream.",
			last_ok: 1,
			last_error: null,
			last_duration_ms: 1_150,
		},
	];

	const sandboxes: Sandbox[] = [
		{ id: "sbx-e2e-4", createdAt: T0 - 12 * MIN, label: "task-e2e-4/baseline", files: 41 },
		{ id: "sbx-e2e-5", createdAt: T0 - 2 * MIN, label: "interactive/session", files: 12 },
	];

	const skills: Skill[] = [
		{
			id: "skl-e2e-1",
			project_slug: "unown",
			project_path: "/home/dev/unown",
			name: "recover-failed-cycle",
			description: "Recover a failed harness cycle without restarting the engine.",
			body: "# recover-failed-cycle\n\n1. Read the cycle summary.\n2. Re-arm the job.",
			status: "shipped",
			version: 2,
			dream_id: "drm-e2e-2",
			created_at: T0 - 34 * MIN,
			updated_at: T0 - 34 * MIN,
		},
	];

	const skillVersions: SkillVersion[] = [
		{ version: 2, changed_by: "autodream", note: "consolidated retry discipline", created_at: T0 - 34 * MIN },
		{ version: 1, changed_by: "harness", note: null, created_at: T0 - 35 * MIN },
	];

	const bridge: BridgeResponse = {
		log: [
			{
				ts: T0 - 9 * MIN,
				model: "qwen3.7-plus",
				stream: true,
				messages: 12,
				tools: 6,
				finishReason: "stop",
				contentChars: 1840,
				toolCalls: 3,
				promptTokens: 8100,
				completionTokens: 1900,
				durationMs: 4120,
			},
			{
				ts: T0 - 37 * MIN,
				model: "kimi-k2.5",
				stream: true,
				messages: 10,
				tools: 6,
				finishReason: "stop",
				contentChars: 990,
				toolCalls: 2,
				promptTokens: 8300,
				completionTokens: 900,
				durationMs: 3890,
			},
		],
		requests: 927,
		errors: 3,
		url: "http://127.0.0.1:3031/v1",
	};

	// The delegation round's audit ledger fixture: one healthy sync spawn,
	// one async spawn with its why, and the F26 runaway (timeout, 596k tok)
	// so the screen's receipts-only verdict rows are all exercised.
	const delegations: DelegationsResponse = {
		delegations: [
			{
				id: 3,
				lane: "sync",
				agent: "scout",
				name: null,
				task: "Find every caller of parseConfig()",
				why: null,
				status: "timeout",
				turns: 104,
				tokens_in: 596_000,
				tokens_out: 5_000,
				tool_calls: 111,
				elapsed_ms: 300_000,
				blocked: 0,
				project_path: "/home/dev/repo",
				ts: T0 - 3 * MIN,
			},
			{
				id: 2,
				lane: "fleet",
				agent: "general",
				name: "counter",
				task: "Count the TypeScript lines under test/",
				why: "parallelism — keep answering while it counts",
				status: "done",
				turns: 2,
				tokens_in: 8_915,
				tokens_out: 74,
				tool_calls: 1,
				elapsed_ms: 4_200,
				blocked: 0,
				project_path: "/home/dev/repo",
				ts: T0 - 12 * MIN,
			},
			{
				id: 1,
				lane: "sync",
				agent: "reviewer",
				name: null,
				task: "Review atomic.ts for correctness issues",
				why: "specialization — a second pair of eyes on the diff",
				status: "done",
				turns: 6,
				tokens_in: 45_000,
				tokens_out: 3_000,
				tool_calls: 14,
				elapsed_ms: 42_000,
				blocked: 0,
				project_path: "/home/dev/repo",
				ts: T0 - 40 * MIN,
			},
		],
		tallies: [
			{ agent: "reviewer", status: "done", count: 1, tokens: 48_000, avg_turns: 6 },
			{ agent: "general", status: "done", count: 1, tokens: 8_989, avg_turns: 2 },
			{ agent: "scout", status: "timeout", count: 1, tokens: 601_000, avg_turns: 104 },
		],
		totals: {
			total: 3,
			ok: 2,
			blocked: 0,
			failed: 0,
			tokens_in: 649_915,
			tokens_out: 8_074,
			turns: 112,
			tool_calls: 126,
			with_why: 2,
		},
	};

	const webcache: WebCacheStats = {
		enabled: true,
		root: "/home/dev/.unown/cache/web",
		entries: 214,
		bytes: 41_234_567,
		maxBytes: 268_435_456,
		index: { mode: "memory", ageMs: 1200, approximate: false },
		ttl: { searchMs: 3_600_000, fetchMs: 1_800_000, searchStaleMs: 86_400_000, fetchStaleMs: 604_800_000 },
		totals: { hit: 118, revalidated: 34, miss: 67, stale: 5, bypass: 2, evict: 8, clear: 1, error: 0 },
		savedRequests: 152,
		byTool: { web_search: 96, webfetch: 71, fetch_url: 19 },
		byProvider: { duckduckgo: 74, direct: 62, tavily: 29, searxng: 21 },
		recentEvents: [
			{
				ts: T0 - 2 * MIN,
				kind: "hit",
				tool: "web_search",
				provider: "duckduckgo",
				detail: "bun sqlite tutorial",
				ageMs: 12 * MIN,
			},
			{
				ts: T0 - 6 * MIN,
				kind: "revalidated",
				tool: "webfetch",
				provider: "direct",
				detail: "bun.sh/docs",
				ageMs: 2 * 60 * MIN,
			},
			{ ts: T0 - 11 * MIN, kind: "miss", tool: "web_search", provider: "tavily", detail: "react 19 release notes" },
			{
				ts: T0 - 23 * MIN,
				kind: "stale",
				tool: "webfetch",
				provider: "direct",
				detail: "example.com",
				ageMs: 25 * MIN,
			},
			{ ts: T0 - 41 * MIN, kind: "evict", tool: "engine", detail: "2 entries (0.4 MiB) — LRU sweep" },
		],
	};

	const lastRun: AutomationRun = {
		id: "arun-e2e-1",
		automation_id: "auto-e2e-1",
		trigger_kind: "schedule",
		scheduled_at: T0 - 18 * MIN,
		status: "succeeded",
		started_at: T0 - 18 * MIN,
		ended_at: T0 - 17 * MIN,
		exit_code: 0,
		output: "## Nightly Repo Health Check\n\nAll gates green.",
		error: null,
		turns: 9,
		tokens_in: 41_000,
		tokens_out: 1500,
	};

	const automations: Automation[] = [
		{
			id: "auto-e2e-1",
			title: "nightly repo health check",
			prompt: "Review the repo health and report anomalies.",
			cron_expr: "0 3 * * *",
			delay_ms: null,
			schedule_kind: "cron",
			interval_n: null,
			interval_unit: null,
			interval_at: null,
			timezone: "America/New_York",
			until_ms: null,
			misfire: "catch-up",
			// M6: the failed-run retry policy, mid-chain — attempt 2
			// (the "arun-e2e-0r" run below) failed, attempt 3 is armed.
			retry_max: 3,
			retry_backoff_secs: 600,
			retry_next_at: T0 + 4 * MIN,
			retry_attempt: 3,
			retry_of_run: "arun-e2e-0r",
			workspace: "/home/dev/unown",
			mode: "read-only",
			model: null,
			max_runs: null,
			run_count: 4,
			scheduled_run_count: 4,
			lifecycle: "active",
			next_run_at: T0 + 6 * 60 * MIN,
			last_run_at: T0 - 18 * MIN,
			created_at: T0 - 3 * 24 * 60 * MIN,
			updated_at: T0 - 18 * MIN,
			schedule: "cron 0 3 * * * — at 03:00 (America/New_York)",
			lastRun,
		},
	];

	const automationRuns: Record<string, AutomationRun[]> = {
		"auto-e2e-1": [
			lastRun,
			{
				id: "arun-e2e-0r",
				automation_id: "auto-e2e-1",
				trigger_kind: "retry",
				scheduled_at: null,
				status: "failed",
				started_at: T0 - 20 * MIN,
				ended_at: T0 - 19 * MIN,
				exit_code: 1,
				output: null,
				error: "retry #2: still timing out",
				turns: 4,
				tokens_in: 11_000,
				tokens_out: 300,
				attempt: 2,
				retry_of: "arun-e2e-0",
			},
			{
				id: "arun-e2e-0",
				automation_id: "auto-e2e-1",
				trigger_kind: "manual",
				scheduled_at: null,
				status: "failed",
				started_at: T0 - 27 * MIN,
				ended_at: T0 - 26 * MIN,
				exit_code: 1,
				output: null,
				error: "session timed out",
				turns: 3,
				tokens_in: 9000,
				tokens_out: 200,
			},
		],
	};

	// Version history: three versions per tier; changed_by rotates through
	// seed/harness/autodream/rollback per tier so every author appears.
	const CHANGED_BY: readonly ChangedBy[] = ["seed", "harness", "autodream", "rollback"];
	const TIER_ORDER = ["policy", "project", "user", "local"];
	const historyFor = (tier: string): MemoryHistoryEntry[] => {
		const base = TIER_ORDER.indexOf(tier);
		const offset = base >= 0 ? base : 1; // project:<slug> tiers share the "project" rotation
		return [0, 1, 2].map((i) => ({
			id: 3 - i,
			tier,
			version: 5 - i,
			content: `# ${tier} memory v${5 - i}\n\n- earlier revision ${i}`,
			changed_by: CHANGED_BY[(offset + i) % CHANGED_BY.length] ?? "seed",
			note: i === 0 ? "canary-verified consolidation" : null,
			created_at: T0 - (i + 1) * 100 * MIN,
		}));
	};

	// The per-connection scripted burst every SSE client sees ~300ms after
	// connect (deterministic offsets — a server-start burst would race client
	// connections and is not a testable contract; ported from e2e).
	const cannedBurst: [string, Record<string, unknown>][] = [
		["memory:changed", { tier: "project", version: 5, changedBy: "autodream" }],
		["run:finished", { taskId: "task-e2e-3", status: "passed", durationMs: 61_000 }],
	];

	// ---- mutable test state ----

	const calls: MockEngineCalls = {
		rollbacks: [],
		dreams: 0,
		notesCreated: [],
		syncs: 0,
		jobsTriggered: [],
		jobsToggled: [],
		skillsRolledBack: [],
		skillsRetired: [],
		automationsCreated: 0,
		automationsCreateBodies: [],
		automationsSkipped: [],
		automationsSnoozed: [],
		automationsPatched: [],
		automationsDeleted: [],
		webcacheCleared: 0,
		webcacheSwept: 0,
		mints: 0,
		hits: new Map<string, number>(),
	};
	let overviewToken = 132;
	let noteSeq = 0;
	let automationSeq = 0;

	const overview = (): OverviewResponse => ({
		ok: true,
		agent: {
			name: "unown (mock)",
			layer: "mock",
			provider: "mock-kimi",
			bridge: { ok: true, port: 3031, requests: bridge.requests, errors: bridge.errors },
		},
		kpis: {
			totalRuns: overviewToken,
			passed: 118,
			failed: 11,
			errors: 3,
			passRate: 89,
			tasks: tasks.length,
			improvementsShipped: 1,
			dreams: dreams.length,
			notes: { total: notes.length, pending: notes.filter((n) => n.dream_id === null).length },
			hooks: { total: 304, denies: 27 },
			tokens: { in: 1_240_000, out: 340_000 },
			suite: {
				total: tasks.length,
				passing: 3,
				capability: 2,
				regression: 2,
				minted: 2,
				graduated: 1,
				saturated: false,
			},
		},
		memoryVersions: { policy: 4, project: 5, user: 6, local: 7 },
		trend: Array.from({ length: 12 }, (_, i) => ({ ts: T0 - (12 - i) * 60 * MIN, cumulativePass: 20 + i * 9 })),
		routerBusy: false,
	});

	// ---- helpers ----

	const json = (res: ServerResponse, body: unknown, status = 200): void => {
		res.writeHead(status, {
			"Content-Type": "application/json; charset=utf-8",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		});
		res.end(JSON.stringify(body));
	};

	/** Envelope SSE frame — the live engine's wire format (server.ts /api/events). */
	const writeEvent = (res: ServerResponse, event: string, payload: Record<string, unknown>): void => {
		res.write(`data: ${JSON.stringify({ event, payload, ts: Date.now() })}\n\n`);
	};

	const emit = (event: string, payload: Record<string, unknown>): void => {
		for (const res of sseClients) writeEvent(res, event, payload);
	};

	// ---- routing ----

	function getRoute(url: URL, res: ServerResponse): void {
		const p = url.pathname;
		if (p === "/api/overview") {
			json(res, overview());
			return;
		}
		if (p === "/api/tasks") {
			json(res, { tasks });
			return;
		}
		const taskMatch = p.match(/^\/api\/tasks\/([^/]+)$/);
		if (taskMatch) {
			const t = taskDetails.get(decodeURIComponent(taskMatch[1] ?? ""));
			if (t) json(res, { task: t });
			else json(res, { error: "task not found" }, 404);
			return;
		}
		if (p === "/api/runs") {
			let list = runs;
			const task = url.searchParams.get("task");
			const kind = url.searchParams.get("kind");
			const limit = Number(url.searchParams.get("limit") ?? "0");
			if (task) list = list.filter((r) => r.task_id === task);
			if (kind) list = list.filter((r) => r.kind === kind);
			json(res, { runs: limit > 0 ? list.slice(-limit) : list });
			return;
		}
		// M6-2: MUST be matched before the /api/runs/:id regex below — "live"
		// is a path segment that the id pattern would otherwise swallow and 404.
		// (The real server orders the same way: server.ts checks the literal
		// path before the regex.)
		if (p === "/api/runs/live") {
			json(res, { runs: liveRuns });
			return;
		}
		const runMatch = p.match(/^\/api\/runs\/([^/]+)$/);
		if (runMatch) {
			const id = decodeURIComponent(runMatch[1] ?? "");
			const d = runDetails.get(id);
			// The engine pairs the row with its live block on the same endpoint
			// (server.ts: { run, live }) — mirror it, do not invent a shorter shape.
			if (d) json(res, { run: d, live: liveRuns.find((l) => l.id === id) ?? null });
			else json(res, { error: "run not found" }, 404);
			return;
		}
		if (p === "/api/memory") {
			json(res, { tiers, resolvedChars: 402 });
			return;
		}
		if (p === "/api/memory/projects") {
			json(res, { projects: projectTiers });
			return;
		}
		const histMatch = p.match(/^\/api\/memory\/([^/]+)\/history$/);
		if (histMatch) {
			json(res, { history: historyFor(decodeURIComponent(histMatch[1] ?? "")) });
			return;
		}
		if (p === "/api/cycles") {
			json(res, { cycles });
			return;
		}
		if (p === "/api/improvements") {
			json(res, { improvements });
			return;
		}
		if (p === "/api/dreams") {
			json(res, { dreams });
			return;
		}
		const dreamNotesMatch = p.match(/^\/api\/dreams\/([^/]+)\/notes$/);
		if (dreamNotesMatch) {
			json(res, { notes: dreamNotes });
			return;
		}
		if (p === "/api/notes") {
			const limit = Number(url.searchParams.get("limit") ?? "0");
			json(res, { notes: limit > 0 ? notes.slice(-limit) : notes });
			return;
		}
		if (p === "/api/skills") {
			json(res, { skills });
			return;
		}
		const skillMatch = p.match(/^\/api\/skills\/([^/]+)$/);
		if (skillMatch) {
			const s = skills.find((x) => x.id === decodeURIComponent(skillMatch[1] ?? ""));
			if (s) json(res, { skill: s, versions: skillVersions });
			else json(res, { error: "skill not found" }, 404);
			return;
		}
		if (p === "/api/hooks") {
			const limit = Number(url.searchParams.get("limit") ?? "0");
			json(res, { hooks: limit > 0 ? hooks.slice(-limit) : hooks });
			return;
		}
		if (p === "/api/jobs") {
			json(res, { jobs });
			return;
		}
		if (p === "/api/sandboxes") {
			json(res, { sandboxes });
			return;
		}
		if (p === "/api/bridge") {
			json(res, bridge);
			return;
		}
		if (p === "/api/webcache") {
			json(res, webcache);
			return;
		}
		if (p === "/api/delegations") {
			json(res, delegations);
			return;
		}
		if (p === "/api/automations") {
			json(res, { automations });
			return;
		}
		const autoRunsMatch = p.match(/^\/api\/automations\/([^/]+)\/runs$/);
		if (autoRunsMatch) {
			const id = decodeURIComponent(autoRunsMatch[1] ?? "");
			json(res, { runs: automations.some((a) => a.id === id) ? (automationRuns[id] ?? []) : [] });
			return;
		}
		const autoMatch = p.match(/^\/api\/automations\/([^/]+)$/);
		if (autoMatch) {
			const a = automations.find((x) => x.id === decodeURIComponent(autoMatch[1] ?? ""));
			if (a) json(res, { automation: a });
			else json(res, { error: "automation not found" }, 404);
			return;
		}
		json(res, { error: "not found" }, 404);
	}

	function postRoute(url: URL, body: Record<string, unknown>, res: ServerResponse): void {
		const p = url.pathname;
		if (p === "/api/dreams/run") {
			calls.dreams++;
			json(res, { started: true });
			return;
		}
		const rollbackMatch = p.match(/^\/api\/memory\/([^/]+)\/rollback$/);
		if (rollbackMatch) {
			const tier = decodeURIComponent(rollbackMatch[1] ?? "");
			calls.rollbacks.push(tier);
			emit("memory:changed", { tier, version: body.version ?? 1, changedBy: "rollback" });
			json(res, { ok: true });
			return;
		}
		if (p === "/api/notes") {
			const content = typeof body.content === "string" ? body.content : "";
			const projectPath = typeof body.project_path === "string" ? body.project_path : "";
			if (content.length > 20_000) {
				json(res, { error: "note too large" }, 413);
				return;
			}
			noteSeq++;
			calls.notesCreated.push({ content, projectPath });
			emit("note:created", { runId: null });
			json(res, { ok: true, id: `note-mock-${noteSeq}` });
			return;
		}
		if (p === "/api/notes/sync") {
			calls.syncs++;
			json(res, { ok: true, synced: 2 });
			return;
		}
		const skillRb = p.match(/^\/api\/skills\/([^/]+)\/rollback$/);
		if (skillRb) {
			calls.skillsRolledBack.push({
				id: decodeURIComponent(skillRb[1] ?? ""),
				version: typeof body.version === "number" ? body.version : 1,
			});
			json(res, { ok: true });
			return;
		}
		const skillRetire = p.match(/^\/api\/skills\/([^/]+)\/retire$/);
		if (skillRetire) {
			calls.skillsRetired.push(decodeURIComponent(skillRetire[1] ?? ""));
			json(res, { ok: true });
			return;
		}
		const jobAction = p.match(/^\/api\/jobs\/([^/]+)\/(trigger|toggle)$/);
		if (jobAction) {
			const id = decodeURIComponent(jobAction[1] ?? "");
			if (jobAction[2] === "toggle") {
				calls.jobsToggled.push(id);
				const j = jobs.find((x) => x.id === id);
				if (j) j.enabled = j.enabled > 0 ? 0 : 1;
				json(res, { ok: true });
				return;
			}
			calls.jobsTriggered.push(id);
			json(res, { ok: true, result: "triggered" });
			return;
		}
		if (p === "/api/webcache/clear") {
			calls.webcacheCleared++;
			emit("webcache:cleared", { removed: 214, bytes: 0 });
			json(res, { ok: true, removed: 214, bytes: 0 });
			return;
		}
		if (p === "/api/webcache/sweep") {
			calls.webcacheSwept++;
			json(res, { ok: true, evicted: 8, freedBytes: 1_048_576, totalBytes: 40_189_383 });
			return;
		}
		if (p === "/api/tasks/mint") {
			calls.mints++;
			json(res, {
				ok: true,
				outcome: { status: "minted", taskId: "task-mint-1", reason: "mined from run-e2e-10" },
			});
			return;
		}
		const taskRun = p.match(/^\/api\/tasks\/([^/]+)\/run$/);
		if (taskRun) {
			emit("cycle:started", { taskId: decodeURIComponent(taskRun[1] ?? "") });
			json(res, { started: true });
			return;
		}
		if (p === "/api/automations") {
			calls.automationsCreated++;
			calls.automationsCreateBodies.push({ ...body });
			automationSeq++;
			const every = typeof body.every === "string" && body.every ? body.every : null;
			const after = typeof body.after === "string" && body.after ? body.after : null;
			const interval = every ?? after;
			const m = interval ? interval.match(/^(\d+)\s*(m|h|d|w)(?:\s*(?:at|@)\s*([0-2]?\d:[0-5]\d))?$/i) : null;
			const created: Automation = {
				id: `auto-mock-${automationSeq}`,
				title: typeof body.title === "string" && body.title ? body.title : "untitled routine",
				prompt: typeof body.prompt === "string" ? body.prompt : "",
				cron_expr: typeof body.cron === "string" && body.cron ? body.cron : null,
				delay_ms: typeof body.delayMinutes === "number" ? Date.now() + body.delayMinutes * 60_000 : null,
				schedule_kind: every
					? "every"
					: after
						? "after"
						: typeof body.cron === "string" && body.cron
							? "cron"
							: "once",
				interval_n: m ? Number(m[1]) : null,
				interval_unit: m ? m[2].toLowerCase() : null,
				interval_at: m?.[3] ? m[3].padStart(5, "0") : null,
				timezone: typeof body.timezone === "string" && body.timezone ? body.timezone : null,
				until_ms: typeof body.until === "number" ? body.until : null,
				misfire: body.misfire === "catch-up" ? "catch-up" : body.misfire === "skip" ? "skip" : null,
				workspace: typeof body.workspace === "string" ? body.workspace : "/tmp",
				mode: body.mode === "standard" ? "standard" : "read-only",
				model: typeof body.model === "string" && body.model ? body.model : null,
				max_runs: null,
				// M6: echo the retry policy the client sent.
				retry_max: typeof body.retryMax === "number" ? body.retryMax : null,
				retry_backoff_secs: typeof body.retryBackoffSecs === "number" ? body.retryBackoffSecs : null,
				retry_next_at: null,
				retry_attempt: null,
				retry_of_run: null,
				run_count: 0,
				scheduled_run_count: 0,
				lifecycle: "active",
				next_run_at: Date.now() + 60 * MIN,
				last_run_at: null,
				created_at: Date.now(),
				updated_at: Date.now(),
				schedule: every ? `every ${every}` : after ? `after ${after} (from completion)` : "at :00",
				lastRun: null,
			};
			automations.push(created);
			json(res, { automation: created });
			return;
		}
		const autoRun = p.match(/^\/api\/automations\/([^/]+)\/(run|skip|snooze)$/);
		if (autoRun) {
			const id = decodeURIComponent(autoRun[1] ?? "");
			const a = automations.find((x) => x.id === id);
			if (!a) {
				json(res, { error: "automation not found" }, 404);
				return;
			}
			if (autoRun[2] === "run") {
				json(res, { ok: true });
				return;
			}
			if (autoRun[2] === "skip") {
				calls.automationsSkipped.push(id);
				a.next_run_at = Date.now() + 24 * 60 * MIN;
				emit("automation:skipped", { id, reason: "skipped_by_user" });
				json(res, { automation: a });
				return;
			}
			const minutes = typeof body.minutes === "number" ? body.minutes : 0;
			calls.automationsSnoozed.push({ id, minutes });
			if (minutes > 0 && a.next_run_at) a.next_run_at += minutes * 60_000;
			emit("automation:updated", { id, snoozedTo: a.next_run_at });
			json(res, { automation: a });
			return;
		}
		json(res, { error: "not found" }, 404);
	}

	function patchRoute(url: URL, body: Record<string, unknown>, res: ServerResponse): void {
		const m = url.pathname.match(/^\/api\/automations\/([^/]+)$/);
		if (m) {
			const id = decodeURIComponent(m[1] ?? "");
			calls.automationsPatched.push({ id, body: { ...body } });
			const a = automations.find((x) => x.id === id);
			if (!a) {
				json(res, { error: "automation not found" }, 404);
				return;
			}
			if (typeof body.title === "string") a.title = body.title;
			if (typeof body.prompt === "string") a.prompt = body.prompt;
			if (body.lifecycle === "paused" || body.lifecycle === "active") a.lifecycle = body.lifecycle;
			if (typeof body.paused === "boolean") a.lifecycle = body.paused ? "paused" : "active";
			if (body.misfire === "catch-up" || body.misfire === "skip" || body.misfire === null) {
				a.misfire = body.misfire === null ? null : (body.misfire as string);
			}
			if (typeof body.timezone === "string" || body.timezone === null) a.timezone = body.timezone as string | null;
			if (typeof body.until === "number" || body.until === null) a.until_ms = body.until as number | null;
			if (typeof body.maxRuns === "number" || body.maxRuns === null) a.max_runs = body.maxRuns as number | null;
			// M6: the retry policy (null clears + disarms).
			if (body.retryMax === null) {
				a.retry_max = null;
				a.retry_backoff_secs = null;
				a.retry_next_at = null;
				a.retry_attempt = null;
				a.retry_of_run = null;
			} else {
				if (typeof body.retryMax === "number") a.retry_max = body.retryMax;
				if (typeof body.retryBackoffSecs === "number") a.retry_backoff_secs = body.retryBackoffSecs;
			}
			a.updated_at = Date.now();
			json(res, { automation: a });
			return;
		}
		json(res, { error: "not found" }, 404);
	}

	function deleteRoute(url: URL, res: ServerResponse): void {
		const m = url.pathname.match(/^\/api\/automations\/([^/]+)$/);
		if (m) {
			const id = decodeURIComponent(m[1] ?? "");
			calls.automationsDeleted.push(id);
			const idx = automations.findIndex((x) => x.id === id);
			if (idx >= 0) automations.splice(idx, 1);
			json(res, { ok: true });
			return;
		}
		json(res, { error: "not found" }, 404);
	}

	/** Read + JSON-parse a request body; malformed bodies answer 400. */
	function withBody(req: IncomingMessage, res: ServerResponse, route: (body: Record<string, unknown>) => void): void {
		let raw = "";
		req.on("data", (chunk: Buffer) => {
			raw += chunk.toString("utf8");
		});
		req.on("error", () => {
			try {
				res.destroy();
			} catch {
				/* already closed */
			}
		});
		req.on("end", () => {
			if (raw === "") {
				route({});
				return;
			}
			try {
				const parsed = JSON.parse(raw) as unknown;
				route(typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {});
			} catch {
				json(res, { error: "invalid JSON body" }, 400);
			}
		});
	}

	// ---- SSE fan-out (ported from e2e/mock-engine.mjs) ----

	const sseClients = new Set<ServerResponse>();
	const pendingTimers = new Set<ReturnType<typeof setTimeout>[]>();
	const heartbeat = setInterval(() => {
		for (const res of sseClients) writeEvent(res, "ping", { ts: now() });
	}, 2000);
	heartbeat.unref?.();

	function sseHandler(req: IncomingMessage, res: ServerResponse): void {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"Access-Control-Allow-Origin": "*",
			"X-Accel-Buffering": "no",
		});
		res.write("retry: 2000\n\n");
		// Join the broadcast set BEFORE the greeting (the e2e ordering bug).
		sseClients.add(res);
		writeEvent(res, "hello", { engine: "mock" });
		// Per-connection scripted burst at fixed offsets.
		const timers = cannedBurst.map(([event, payload], i) =>
			setTimeout(
				() => {
					if (sseClients.has(res)) writeEvent(res, event, payload);
				},
				300 + i * 250,
			),
		);
		pendingTimers.add(timers);
		req.on("close", () => {
			for (const t of timers) clearTimeout(t);
			pendingTimers.delete(timers);
			sseClients.delete(res);
		});
	}

	// ---- server ----

	const sockets = new Set<{ destroy(): void }>();
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		calls.hits.set(url.pathname, (calls.hits.get(url.pathname) ?? 0) + 1);

		if (req.method === "OPTIONS") {
			json(res, {}, 204);
			return;
		}
		if (req.method === "GET" && url.pathname === "/api/events") {
			sseHandler(req, res);
			return;
		}
		if (req.method === "GET") {
			getRoute(url, res);
			return;
		}
		if (req.method === "POST") {
			withBody(req, res, (body) => postRoute(url, body, res));
			return;
		}
		if (req.method === "PATCH") {
			withBody(req, res, (body) => patchRoute(url, body, res));
			return;
		}
		if (req.method === "DELETE") {
			deleteRoute(url, res);
			return;
		}
		json(res, { error: "method not allowed" }, 405);
	});
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const addr = server.address();
	if (!addr || typeof addr !== "object") throw new Error("mock engine failed to bind an ephemeral port");

	const close = (): Promise<void> =>
		new Promise((resolve) => {
			for (const timers of pendingTimers) for (const t of timers) clearTimeout(t);
			pendingTimers.clear();
			clearInterval(heartbeat);
			for (const res of sseClients) {
				try {
					res.end();
				} catch {
					/* already closed */
				}
			}
			sseClients.clear();
			for (const socket of sockets) {
				try {
					socket.destroy();
				} catch {
					/* already closed */
				}
			}
			sockets.clear();
			server.close(() => resolve());
			// Belt and braces: teardown must never hang the suite on a straggler.
			const guard = setTimeout(resolve, 500);
			(guard as unknown as { unref?: () => void }).unref?.();
		});

	return {
		port: addr.port,
		url: `http://127.0.0.1:${addr.port}`,
		calls,
		emit,
		setOverviewToken: (v: number) => {
			overviewToken = v;
		},
		close,
	};
}
