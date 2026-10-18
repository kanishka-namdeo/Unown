import { emit } from "./bus.ts";
import { chatJson, modelFor } from "./llm.ts";
import { type RunResult, runAgent } from "./runner.ts";
import { createSandbox, seedFiles, verifyInSandbox } from "./sandbox.ts";
import { store } from "./store.ts";
import { buildVerify, type TaskDef } from "./tasks.ts";

const MAX_ACTIVE_MINTED = Math.max(0, Number(process.env.UNOWN_MAX_MINTED_TASKS ?? 8));
const MAX_FILES = 6;
const MAX_FILE_CHARS = 12_000;
const MAX_TOTAL_CHARS = 40_000;

// ---------------------------------------------------------------------------
// Suite statistics (drives the minting gate + the dashboard KPI)
// ---------------------------------------------------------------------------

export interface SuiteStats {
	total: number; // active tasks
	passing: number; // tasks whose last baseline/candidate run passed
	capability: number; // active minted tasks not yet passing
	regression: number; // active tasks in the regression suite
	minted: number; // active tasks with origin 'minted'
	graduated: number; // minted tasks that earned regression-suite status
	saturated: boolean; // every active task currently passing
}

function lastRunStatus(taskId: string): string | null {
	const row = store.get<{ status: string }>(
		`SELECT status FROM runs WHERE task_id = ? AND kind IN ('baseline','candidate') ORDER BY started_at DESC LIMIT 1`,
		[taskId],
	);
	return row?.status ?? null;
}

export function suiteStats(): SuiteStats {
	const tasks = store.query<{ id: string; origin: string | null; status: string | null }>(
		`SELECT id, origin, status FROM tasks WHERE active = 1`,
	);
	let passing = 0;
	for (const t of tasks) {
		if (lastRunStatus(t.id) === "passed") passing++;
	}
	const minted = tasks.filter((t) => (t.origin ?? "seed") === "minted").length;
	const capability = tasks.filter((t) => (t.status ?? "regression") === "capability").length;
	const regression = tasks.filter((t) => (t.status ?? "regression") === "regression").length;
	// minted tasks are born 'capability'; they only reach 'regression' by graduating
	const graduated = tasks.filter(
		(t) => (t.origin ?? "seed") === "minted" && (t.status ?? "regression") === "regression",
	).length;
	return {
		total: tasks.length,
		passing,
		capability,
		regression,
		minted,
		graduated,
		saturated: tasks.length > 0 && passing === tasks.length,
	};
}

// ---------------------------------------------------------------------------
// Draft authoring + validation
// ---------------------------------------------------------------------------

interface TaskDraft {
	id?: unknown;
	name?: unknown;
	description?: unknown;
	category?: unknown;
	difficulty?: unknown;
	prompt?: unknown;
	files?: unknown;
	verifyTestFile?: unknown;
}

const MINT_SYSTEM = `You are the task minter of a self-improving coding-agent harness. You author NEW benchmark tasks that the agent may plausibly FAIL today. Each task is a tiny, self-contained code exercise that runs fully offline under bun.

Task contract:
- files: 1-4 source files (a deliberately broken or unimplemented exercise) plus exactly ONE test file matching /\\.test\\.mjs$/ that imports the source files with relative ESM imports
- the seeded source files must be syntactically valid and must FAIL the tests for a MEANINGFUL reason (wrong behavior / not implemented) — never because an import is missing or a file is broken
- tests use node:assert/strict, are deterministic (no real clocks beyond short setTimeout, no network, no filesystem access outside the sandbox dir), and take under 10 seconds
- prompt: one short paragraph telling the agent what to fix/implement; it must NOT leak the solution and must not describe individual test cases (say "the test file describes the expected behavior")
- difficulty 1-5 honest; category one of bugfix | implementation | algorithm | refactor

Return STRICT JSON only:
{"id":"kebab-case-slug","name":"...","description":"...","category":"bugfix","difficulty":3,"prompt":"...","files":{"src.js":"...","src.test.mjs":"..."},"verifyTestFile":"src.test.mjs"}`;

function slugifyId(raw: string): string {
	const slug =
		raw
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.replace(/^mint-+/, "")
			.slice(0, 40) || "task";
	return `mint-${slug}`;
}

const FILE_KEY_RE = /^[\w][\w.\-/ ]*$/;

function validateDraft(draft: TaskDraft): { ok: true; def: TaskDef } | { ok: false; error: string } {
	const id = slugifyId(String(draft.id ?? ""));
	const name = String(draft.name ?? "").trim();
	const description = String(draft.description ?? "").trim();
	const prompt = String(draft.prompt ?? "").trim();
	const category = String(draft.category ?? "minted").trim() || "minted";
	const difficulty = Math.min(5, Math.max(1, Math.round(Number(draft.difficulty ?? 3) || 3)));
	if (!id || !name || !description || !prompt)
		return { ok: false, error: "id/name/description/prompt must be non-empty" };
	if (name.length > 80 || description.length > 300 || prompt.length > 2000)
		return { ok: false, error: "name/description/prompt exceed size caps" };
	const existing = store.get(`SELECT id FROM tasks WHERE id = ?`, [id]);
	if (existing) return { ok: false, error: `task id already exists: ${id}` };

	const files = draft.files;
	if (typeof files !== "object" || files === null || Array.isArray(files))
		return { ok: false, error: "files must be an object" };
	const entries = Object.entries(files as Record<string, unknown>);
	if (entries.length < 1 || entries.length > MAX_FILES)
		return { ok: false, error: `files must contain 1..${MAX_FILES} entries` };
	const clean: Record<string, string> = {};
	let total = 0;
	for (const [path, content] of entries) {
		if (!FILE_KEY_RE.test(path) || path.includes("..") || path.startsWith("/"))
			return { ok: false, error: `unsafe file path: ${path}` };
		if (typeof content !== "string") return { ok: false, error: `file content must be a string: ${path}` };
		if (content.length > MAX_FILE_CHARS) return { ok: false, error: `file exceeds ${MAX_FILE_CHARS} chars: ${path}` };
		total += content.length;
		clean[path] = content;
	}
	if (total > MAX_TOTAL_CHARS) return { ok: false, error: `files exceed ${MAX_TOTAL_CHARS} total chars` };

	const verifyTestFile = String(draft.verifyTestFile ?? "");
	if (!(verifyTestFile in clean)) return { ok: false, error: `verifyTestFile not in files: ${verifyTestFile}` };
	if (!/\.test\.mjs$/.test(verifyTestFile)) return { ok: false, error: "verifyTestFile must be a *.test.mjs file" };
	if (!/node:assert/.test(clean[verifyTestFile])) return { ok: false, error: "test file must use node:assert" };

	return { ok: true, def: { id, name, description, category, difficulty, prompt, files: clean, verifyTestFile } };
}

/**
 * Self-check: run the verify script against the SEEDED files in a fresh
 * sandbox WITHOUT the agent. The seeded state must fail the tests cleanly
 * (assertion / behavior failure) — a crashing verify script means the draft
 * itself is broken and would poison the suite.
 */
async function selfCheckDraft(def: TaskDef): Promise<{ ok: boolean; reason: string }> {
	const sandbox = createSandbox(`${def.id}-selfcheck`);
	seedFiles(sandbox, def.files);
	const result = await verifyInSandbox(sandbox, buildVerify(def));
	if (result.passed)
		return {
			ok: false,
			reason: "seeded files already pass their own tests — the exercise has no failure to learn from",
		};
	const log = result.log ?? "";
	if (
		/SyntaxError|ReferenceError|Cannot find module|ERR_MODULE_NOT_FOUND|does not provide an export|ERR_UNSUPPORTED/i.test(
			log,
		)
	) {
		return { ok: false, reason: `verify script crashes on the seeded files (broken draft): ${log.slice(0, 300)}` };
	}
	return { ok: true, reason: `seeded files fail the tests as designed (${result.summary || "assertion failure"})` };
}

// ---------------------------------------------------------------------------
// Mint sources
// ---------------------------------------------------------------------------

interface MintOutcome {
	status: "minted" | "discarded" | "skipped" | "error";
	taskId?: string;
	reason: string;
	validationRunId?: string;
}

function transcriptRowToText(transcriptJson: string, maxChars = 10_000): string {
	let entries: Array<Record<string, unknown>> = [];
	try {
		entries = JSON.parse(transcriptJson);
	} catch {
		return "(unreadable transcript)";
	}
	const parts: string[] = [];
	for (const e of entries) {
		if (e.type === "text") parts.push(`ASSISTANT: ${String(e.text)}`);
		else if (e.type === "tool_start") parts.push(`TOOL ${String(e.tool)} <- ${String(e.input)}`);
		else if (e.type === "tool_end")
			parts.push(`TOOL ${String(e.tool)} ->${e.isError ? " (ERROR)" : ""} ${String(e.output ?? "").slice(0, 600)}`);
	}
	let text = parts.join("\n");
	if (text.length > maxChars) text = `${text.slice(0, maxChars / 2)}\n...[truncated]...\n${text.slice(-maxChars / 2)}`;
	return text;
}

/** The most recent FAILED baseline/candidate run that has not spawned a minted task yet. */
function unminedFailedRun(): { id: string; task_id: string; transcript: string; verify_output: string } | undefined {
	return store.get(
		`SELECT r.id, r.task_id, r.transcript, r.verify_output
		 FROM runs r
		 WHERE r.status = 'failed' AND r.kind IN ('baseline','candidate') AND r.transcript IS NOT NULL
		   AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.source_run_id = r.id)
		 ORDER BY r.started_at DESC LIMIT 1`,
	);
}

async function authorDraft(userContent: string): Promise<{ ok: true; def: TaskDef } | { ok: false; error: string }> {
	const draft = await chatJson<TaskDraft>(
		[
			{ role: "system", content: MINT_SYSTEM },
			{ role: "user", content: userContent },
		],
		{ maxTokens: 3000, model: modelFor("mint") },
	);
	return validateDraft(draft);
}

/** Shared pipeline: validate → selfcheck → insert (inactive) → agent validation run → activate/discard. */
async function runMintPipeline(
	draft: TaskDraft,
	source: { runId?: string; noteId?: string; kind: "failure" | "curriculum" },
): Promise<MintOutcome> {
	const validated = validateDraft(draft);
	if (!validated.ok) return { status: "discarded", reason: `invalid draft: ${validated.error}` };
	const def = validated.def;

	const selfCheck = await selfCheckDraft(def);
	if (!selfCheck.ok) return { status: "discarded", reason: `self-check failed: ${selfCheck.reason}` };

	// Insert inactive while the validation run decides the task's fate.
	store.run(
		`INSERT INTO tasks (id, name, description, category, difficulty, prompt, files, verify, created_at, active, origin, status, source_run_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'minted', 'validating', ?)`,
		[
			def.id,
			def.name,
			def.description,
			def.category,
			def.difficulty,
			def.prompt,
			JSON.stringify(def.files),
			buildVerify(def),
			Date.now(),
			source.runId ?? null,
		],
	);

	let validation: RunResult;
	try {
		validation = await runAgent({
			taskId: def.id,
			kind: "baseline", // integrates with pickNextTask's failing-first selection
			prompt: def.prompt,
			files: def.files,
			verify: buildVerify(def),
			label: `${def.id}-mintval`,
		});
	} catch (err: any) {
		store.run(`UPDATE tasks SET status = 'discarded' WHERE id = ?`, [def.id]);
		return { status: "error", taskId: def.id, reason: `validation run threw: ${err?.message ?? String(err)}` };
	}

	if (validation.status === "failed") {
		// The agent genuinely fails the new task: ship it as a capability eval.
		store.run(`UPDATE tasks SET active = 1, status = 'capability' WHERE id = ?`, [def.id]);
		store.run(`UPDATE tasks SET fail_count = fail_count + 1 WHERE id = ?`, [def.id]);
		emit("task:minted", {
			id: def.id,
			name: def.name,
			source: source.kind,
			sourceRunId: source.runId ?? null,
			validationRunId: validation.id,
		});
		console.log(
			`[mint] task ${def.id} minted from ${source.kind} (agent failed validation run ${validation.id.slice(0, 8)}) — now a capability eval`,
		);
		return {
			status: "minted",
			taskId: def.id,
			reason: `agent failed the validation run — capability eval activated`,
			validationRunId: validation.id,
		};
	}

	if (validation.status === "passed") {
		store.run(`UPDATE tasks SET status = 'discarded', pass_count = pass_count + 1 WHERE id = ?`, [def.id]);
		emit("task:mint-discarded", { id: def.id, reason: "agent already solves it" });
		return {
			status: "discarded",
			taskId: def.id,
			reason: "the agent already solves this task — discarded (honest outcome)",
			validationRunId: validation.id,
		};
	}

	// Infra error — keep provenance so the source is not re-mined, mark discarded.
	store.run(`UPDATE tasks SET status = 'discarded' WHERE id = ?`, [def.id]);
	return {
		status: "error",
		taskId: def.id,
		reason: `validation run died on infrastructure (${validation.error ?? "unknown"})`,
		validationRunId: validation.id,
	};
}

/** Mint a new task from a specific failed run (the Anthropic "real failures" recipe). */
export async function mintTaskFromRun(runId: string): Promise<MintOutcome> {
	const run = store.get<{ id: string; task_id: string; transcript: string; verify_output: string }>(
		`SELECT id, task_id, transcript, verify_output FROM runs WHERE id = ?`,
		[runId],
	);
	if (!run) return { status: "skipped", reason: `no such run: ${runId}` };
	const already = store.get(`SELECT id FROM tasks WHERE source_run_id = ?`, [runId]);
	if (already) return { status: "skipped", reason: "run already minted" };
	const sourceTask = store.get<{ id: string; name: string; prompt: string }>(
		`SELECT id, name, prompt FROM tasks WHERE id = ?`,
		[run.task_id],
	);
	if (!sourceTask) return { status: "skipped", reason: "source task of the run no longer exists" };

	let verifyLog = "";
	try {
		const parsed = JSON.parse(run.verify_output ?? "{}");
		verifyLog = String(parsed.log ?? "").slice(0, 3000);
	} catch {
		verifyLog = (run.verify_output ?? "").slice(0, 3000);
	}

	const draft =
		await authorDraft(`A coding agent FAILED the following task. Mine this REAL failure into a NEW, different benchmark task (new id) that captures the same class of weakness as a fresh self-contained exercise. Do not copy the files verbatim — re-design the exercise.

ORIGINAL TASK ${sourceTask.id} — ${sourceTask.name}:
${sourceTask.prompt}

FAILED RUN TRANSCRIPT:
${transcriptRowToText(run.transcript ?? "[]")}

VERIFICATION OUTPUT:
${verifyLog || "(none)"}`);

	if (!("def" in draft) || !draft.ok)
		return {
			status: "discarded",
			reason: `authoring failed: ${("error" in draft && draft.error) || "invalid draft"}`,
		};
	return runMintPipeline(draft.def as TaskDraft, { runId, kind: "failure" });
}

/** Mint a harder variant of a passing task (SEAgent-style curriculum, used when the suite is saturated). */
export async function mintCurriculumVariant(sourceTaskId: string): Promise<MintOutcome> {
	const task = store.query<{ id: string; name: string; prompt: string; files: string; difficulty: number }>(
		`SELECT id, name, prompt, files, difficulty FROM tasks WHERE id = ? AND active = 1`,
		[sourceTaskId],
	)[0];
	if (!task) return { status: "skipped", reason: `no such task: ${sourceTaskId}` };

	const draft =
		await authorDraft(`The suite is SATURATED: the agent passes every task, so the self-improving harness has nothing to learn from. Design a STRICTLY HARDER variant of the following PASSING task (new id, same style, same constraints): add mechanics, edge cases or interactions that a competent agent may still plausibly get wrong. Keep it deterministic and offline.

SOURCE TASK ${task.id} — ${task.name} (difficulty ${task.difficulty}):
${task.prompt}

SOURCE FILES (tests included — the variant's tests must be at least as strict):
${task.files}`);

	if (!("def" in draft) || !draft.ok)
		return {
			status: "discarded",
			reason: `authoring failed: ${("error" in draft && draft.error) || "invalid draft"}`,
		};
	return runMintPipeline(draft.def as TaskDraft, { kind: "curriculum" });
}

// ---------------------------------------------------------------------------
// The router job
// ---------------------------------------------------------------------------

/** One minting decision per invocation (cost-controlled). */
export async function runMintJob(): Promise<MintOutcome & { source: "failure" | "curriculum" | "none" }> {
	const stats = suiteStats();
	const activeMinted =
		store.get<{ c: number }>(`SELECT COUNT(*) AS c FROM tasks WHERE active = 1 AND origin = 'minted'`)?.c ?? 0;
	if (activeMinted >= MAX_ACTIVE_MINTED) {
		return {
			status: "skipped",
			source: "none",
			reason: `active minted-task cap reached (${activeMinted}/${MAX_ACTIVE_MINTED})`,
		};
	}

	const failed = unminedFailedRun();
	if (failed) {
		const outcome = await mintTaskFromRun(failed.id);
		return { ...outcome, source: "failure" };
	}

	if (stats.saturated) {
		// pick a random currently-passing task as the curriculum source
		const tasks = store.query<{ id: string }>(`SELECT id FROM tasks WHERE active = 1`);
		const passingTasks = tasks.filter((t) => lastRunStatus(t.id) === "passed");
		if (passingTasks.length > 0) {
			const source = passingTasks[Math.floor(Math.random() * passingTasks.length)];
			const outcome = await mintCurriculumVariant(source.id);
			return { ...outcome, source: "curriculum" };
		}
	}

	return {
		status: "skipped",
		source: "none",
		reason: "no unmined failed runs and the suite is not saturated — nothing to mint",
	};
}

/** Graduate a capability task into the regression suite (called by the harness when it starts passing). */
export function graduateTask(taskId: string): boolean {
	const row = store.get<{ origin: string | null; status: string | null }>(
		`SELECT origin, status FROM tasks WHERE id = ?`,
		[taskId],
	);
	if (!row) return false;
	if ((row.origin ?? "seed") !== "minted" || (row.status ?? "regression") !== "capability") return false;
	store.run(`UPDATE tasks SET status = 'regression' WHERE id = ?`, [taskId]);
	emit("task:graduated", { id: taskId });
	console.log(`[mint] task ${taskId} GRADUATED — mastered the capability eval, now part of the regression suite`);
	return true;
}
