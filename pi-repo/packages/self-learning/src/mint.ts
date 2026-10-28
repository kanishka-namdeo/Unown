import { emit } from "./bus.ts";
import { chatJson, modelFor, type ChatMsg } from "./llm.ts";
import { type RunResult, runAgent } from "./runner.ts";
import { createSandbox, seedFiles, verifyInSandbox } from "./sandbox.ts";
import { store } from "./store.ts";
import { buildVerify, type TaskDef } from "./tasks.ts";

// `||` not `??`: UNOWN_MAX_MINTED_TASKS ships EMPTY in .env.example, and
// Number("") is 0 — `??` silently disabled task minting on a fresh clone.
const MAX_ACTIVE_MINTED = Math.max(0, Number(process.env.UNOWN_MAX_MINTED_TASKS || 8));
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
        quarantined: number; // DEACTIVATED capability evals the circuit breaker caught
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
        // Quarantined tasks are active=0 (excluded from every count above) —
        // counted separately so the dashboard can say the breaker fired.
        const quarantined = store.query<{ n: number }>(
                `SELECT COUNT(*) AS n FROM tasks WHERE active = 0 AND status = 'quarantined'`,
        )[0]?.n ?? 0;
        return {
                total: tasks.length,
                passing,
                capability,
                regression,
                minted,
                graduated,
                quarantined,
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
        /** The SOLVED form of the non-test source files — the solvability gate's ground truth. */
        reference?: unknown;
}

// Exported for the F3 prompt-visibility pin (test/mint-caps.test.ts): the
// authoring prompt must state the size caps validateDraft enforces.
export const MINT_SYSTEM = `You are the task minter of a self-improving coding-agent harness. You author NEW benchmark tasks that the agent may plausibly FAIL today. Each task is a tiny, self-contained code exercise that runs fully offline under bun.

Task contract:
- files: 1-4 source files (a deliberately broken or unimplemented exercise) plus exactly ONE test file matching /\\.test\\.mjs$/ that imports the source files with relative ESM imports
- the seeded source files must be syntactically valid and must FAIL the tests for a MEANINGFUL reason (wrong behavior / not implemented) — never because an import is missing or a file is broken
- tests use node:assert/strict, are deterministic (no real clocks beyond short setTimeout, no network, no filesystem access outside the sandbox dir), and take under 10 seconds
- prompt: one short paragraph telling the agent what to fix/implement; it must NOT leak the solution and must not describe individual test cases (say "the test file describes the expected behavior")
- difficulty 1-5 honest; category one of bugfix | implementation | algorithm | refactor
- reference: the SOLVED content of every NON-TEST source file (the same keys as files, minus the test file). It proves the exercise is solvable — it is executed against the untouched test file before the task can enter the suite. The tests must be written so your reference passes them; if you cannot write a passing reference, the tests are inconsistent — fix the tests, not the reference.
- SIZE CAPS (the harness REJECTS drafts over these, measured on the trimmed strings): name at most 80 characters, description at most 300 characters, prompt at most 2000 characters. Write tight: a one-line name, a two-sentence description, a single focused paragraph for the prompt. The prompt must NOT pad with test-case narration to reach quality — the caps are part of the exercise.

Return STRICT JSON only:
{"id":"kebab-case-slug","name":"...","description":"...","category":"bugfix","difficulty":3,"prompt":"...","files":{"src.js":"...","src.test.mjs":"..."},"reference":{"src.js":"..."},"verifyTestFile":"src.test.mjs"}`;

/**
 * json_schema for the mint draft — the grammar that constrains the LOCAL
 * draft call of the cascade (llama.cpp enforces json_schema structurally,
 * maxLength included — E3; the remote upstream does NOT enforce schema
 * keywords — E7/H9, which is why the repair call sends no schema).
 * Copied verbatim from the testbench's MINT_SCHEMA
 * (benchmarks/local-llm/lib/experiments.mjs, the E4/E8 schema — keep the two
 * in sync; same convention as the testbench's byte-faithful prompt copies,
 * in reverse).
 */
const MINT_SCHEMA = {
        type: "object",
        properties: {
                id: { type: "string" },
                name: { type: "string" },
                description: { type: "string" },
                category: { type: "string", enum: ["bugfix", "implementation", "algorithm", "refactor"] },
                difficulty: { type: "integer" },
                prompt: { type: "string" },
                files: { type: "object", additionalProperties: { type: "string" } },
                reference: { type: "object", additionalProperties: { type: "string" } },
                verifyTestFile: { type: "string" },
        },
        required: ["id", "name", "description", "category", "difficulty", "prompt", "files", "verifyTestFile"],
};

/**
 * Cascade config, read at CALL time (not module-load) — the same pattern as
 * llm.ts bridgeUrl(): tests and embedders may set the env after this module
 * first loaded, and the engine evaluates it per mint job. Default (unset) =
 * cascade OFF, the all-remote authoring path byte-identical to before.
 */
function mintCascadeEnabled(): boolean {
        return process.env.PI_MINT_CASCADE === "1";
}

/** The local-lane model that authors the first draft (bridge `local-*` id convention). */
function mintDraftModel(): string {
        return process.env.PI_MINT_DRAFT_MODEL_ID || "local-qwen3-0.6b";
}

/** Record a cascade outcome on the bus + engine log (the same channels task:minted uses). */
function cascadeOutcome(
        outcome: "local_valid" | "repaired" | "discarded_after_repair",
        defId: string | null,
        draftModel: string,
        repairModel: string | null,
        error: string | null = null,
): void {
        emit("mint:cascade", { outcome, taskId: defId, draftModel, repairModel, error });
        console.log(
                `[mint] cascade ${outcome}${defId ? ` (${defId})` : ""} — draft ${draftModel}` +
                        `${repairModel ? `, repair ${repairModel}` : ""}${error ? `: ${error}` : ""}`,
        );
}

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

        // Reference solution (the solvability gate's ground truth): OPTIONAL at
        // the draft level — a draft without one gets a single authored
        // reference later (authorReferenceSolution) — but WHEN PRESENT it must
        // be a subset of the seeded file keys, never a test file (the verify
        // hashes those — a reference touching one is always a rewrite attempt),
        // and inside the same caps as files.
        let reference: Record<string, string> | undefined;
        if (draft.reference !== undefined && draft.reference !== null) {
                if (typeof draft.reference !== "object" || Array.isArray(draft.reference))
                        return { ok: false, error: "reference must be an object" };
                const refEntries = Object.entries(draft.reference as Record<string, unknown>);
                if (refEntries.length === 0) return { ok: false, error: "reference must not be empty when present" };
                reference = {};
                for (const [path, content] of refEntries) {
                        if (!(path in clean)) return { ok: false, error: `reference key not in files: ${path}` };
                        if (path === verifyTestFile || /\.test\.mjs$/.test(path))
                                return { ok: false, error: `reference must not touch test files: ${path}` };
                        if (typeof content !== "string") return { ok: false, error: `reference content must be a string: ${path}` };
                        if (content.length > MAX_FILE_CHARS) return { ok: false, error: `reference file exceeds ${MAX_FILE_CHARS} chars: ${path}` };
                        reference[path] = content;
                }
        }

        return { ok: true, def: { id, name, description, category, difficulty, prompt, files: clean, verifyTestFile, reference } };
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
// Solvability gate (2026-10-25 live finding)
// ---------------------------------------------------------------------------

/**
 * The live finding that motivated the gate: a minted task whose test file is
 * INTERNALLY CONTRADICTORY (one assertion no implementation can satisfy
 * alongside the others — measured: mint-fix-drop-right-while, dropRightWhile
 * line 14) sailed through selfCheckDraft ("seeded files fail as designed")
 * and the agent validation run ("agent fails it"), because BOTH checks prove
 * the task is HARD, neither proves it is SOLVABLE. The activation branch then
 * shipped an impossible task as a "capability eval" — and since
 * pickNextTask() selects failing tasks FIRST, one full agent run was burned
 * on it every single cycle, forever, starving every real learning target.
 *
 * The gate: before a failed-validation task can be activated, a REFERENCE
 * SOLUTION (the solved form of the non-test source files) must PASS the
 * task's own verify in a sandbox. Hard-but-solvable tasks pass the gate and
 * keep the capability-eval semantics; impossible tasks are discarded with
 * the failing reference log as the reason.
 */
async function referenceCheck(def: TaskDef): Promise<{ ok: boolean; reason: string }> {
        if (!def.reference || Object.keys(def.reference).length === 0)
                return { ok: false, reason: "no reference solution to check" };
        const sandbox = createSandbox(`${def.id}-refcheck`);
        // Overlay: seeded files with the reference replacing the solved sources.
        // The test files come from def.files verbatim — buildVerify(def) hashes
        // those, and validateDraft already refused references touching them.
        const solved: Record<string, string> = { ...def.files, ...def.reference };
        seedFiles(sandbox, solved);
        const result = await verifyInSandbox(sandbox, buildVerify(def));
        if (result.passed) return { ok: true, reason: "reference solution passes the task's own tests" };
        const log = (result.log ?? "").slice(0, 300);
        return {
                ok: false,
                reason: `reference solution fails the task's own tests — unsolvable as drafted (${result.summary || log || "assertion failure"})`,
        };
}

const REFERENCE_SYSTEM = `You are the reference solver for a benchmark task. Given the task's files (a deliberately broken exercise plus its test file), return the SOLVED content of every NON-TEST source file so the tests pass. Do not modify test files. Return STRICT JSON only: {"reference":{"src.js":"...the full solved file..."}} with one key per non-test source file.`;

/**
 * The fallback when a draft ships without a reference: ONE bounded call asking
 * the mint model for the solved files. Same shape guarantee as the draft lane
 * (chatJson + hand validation) — no schema enforcement remotely (E7/H9).
 */
async function authorReferenceSolution(def: TaskDef): Promise<Record<string, string> | null> {
        const nonTestFiles = Object.keys(def.files).filter((f) => f !== def.verifyTestFile && !/\.test\.mjs$/.test(f));
        if (nonTestFiles.length === 0) return null;
        let reply: unknown;
        try {
                reply = await chatJson(
                        [
                                { role: "system", content: REFERENCE_SYSTEM },
                                {
                                        role: "user",
                                        content: `TASK PROMPT:\n${def.prompt}\n\nFILES:\n${JSON.stringify(def.files, null, 2)}\n\nReturn the reference solution for these non-test files: ${nonTestFiles.join(", ")}`,
                                },
                        ],
                        { maxTokens: 3000, model: modelFor("mint") },
                );
        } catch {
                return null;
        }
        if (typeof reply !== "object" || reply === null || Array.isArray(reply)) return null;
        const raw = (reply as Record<string, unknown>).reference;
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
        const reference: Record<string, string> = {};
        for (const [path, content] of Object.entries(raw as Record<string, unknown>)) {
                if (!nonTestFiles.includes(path) || typeof content !== "string" || content.length > MAX_FILE_CHARS) return null;
                reference[path] = content;
        }
        return Object.keys(reference).length > 0 ? reference : null;
}

/**
 * The activation gate's decision: PROVE the task is solvable before it may
 * enter the suite as a capability eval. Preference order: the draft's own
 * reference (cheap, already-authored), then one authored reference call.
 * Either way the reference must PASS the task's verify in a sandbox.
 */
export async function proveSolvability(
        def: TaskDef,
): Promise<{ ok: true; via: "draft" | "authored" } | { ok: false; reason: string }> {
        if (def.reference && Object.keys(def.reference).length > 0) {
                const check = await referenceCheck(def);
                if (check.ok) return { ok: true, via: "draft" };
                return { ok: false, reason: check.reason };
        }
        const authored = await authorReferenceSolution(def);
        if (!authored) return { ok: false, reason: "no reference solution obtainable — solvability unprovable, task refused" };
        const check = await referenceCheck({ ...def, reference: authored });
        if (check.ok) return { ok: true, via: "authored" };
        return { ok: false, reason: check.reason };
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

/**
 * The draft-authoring step shared by mintTaskFromRun and mintCurriculumVariant
 * (both callers route through here, so the opt-in cascade covers both).
 * Exported for tests — with PI_MINT_CASCADE unset the call this makes is
 * byte-identical to the pre-cascade authoring call.
 */
export async function authorDraft(
        userContent: string,
): Promise<{ ok: true; def: TaskDef } | { ok: false; error: string }> {
        const messages: ChatMsg[] = [
                { role: "system", content: MINT_SYSTEM },
                { role: "user", content: userContent },
        ];
        if (!mintCascadeEnabled()) {
                const draft = await chatJson<TaskDraft>(messages, { maxTokens: 3000, model: modelFor("mint") });
                const verdict = validateDraft(draft);
                if (verdict.ok) return verdict;
                // F3b — the bounded repair retry (2026-10-29 validation round):
                // a verbose remote model authors drafts that fail validateDraft
                // at the shape seams (over-cap fields, empty id/name, wrapped
                // JSON) — measured live twice in this round (size caps, then
                // empty fields). ONE repair call carrying the invalid draft +
                // the validator's exact error, then re-validate; still invalid
                // keeps the existing discarded path with a repair-aware reason
                // so the receipt says which pass failed. Same shape as the
                // cascade's stage-3 repair, without the local-draft stage.
                const repair = await chatJson<TaskDraft>(
                        [
                                ...messages,
                                { role: "assistant", content: JSON.stringify(draft) },
                                {
                                        role: "user",
                                        content: `That draft was REJECTED by the harness validator: ${verdict.error}. Return the corrected draft as STRICT JSON with every required field (id, name, description, category, difficulty, prompt, files, reference, verifyTestFile), respecting the size caps from the system prompt. Output ONLY the JSON object.`,
                                },
                        ],
                        { maxTokens: 3000, model: modelFor("mint") },
                );
                const retry = validateDraft(repair);
                return retry.ok ? retry : { ok: false, error: `authoring failed: ${verdict.error} (repair pass: ${retry.error})` };
        }
        return authorDraftCascade(messages);
}

/**
 * H10 cascade (opt-in via PI_MINT_CASCADE=1) — the VERIFIED E8 topology
 * (benchmarks/local-llm/lib/e8.mjs, results/e8-mint-cascade/e8-cascade.json:
 * accept 6/6 vs 5/6 pure-remote, $0.00065 vs $0.0069 remote cost per
 * accepted, blind judge 2W/3T/0L):
 *
 *      1. LOCAL DRAFT — a small local model (PI_MINT_DRAFT_MODEL_ID, bridge
 *              local lane) authors the draft on the UNCHANGED authoring prompt,
 *              grammar-constrained by MINT_SCHEMA.
 *      2. validateDraft() (the existing gate) — valid ⇒ proceed with NO remote
 *              call at all.
 *      3. invalid ⇒ ONE remote repair call (the existing mint model — the remote
 *              upstream doesn't enforce json_schema keywords, so no responseSchema):
 *              the authoring transcript + the invalid draft + the validator error.
 *              Re-validate — valid ⇒ proceed; still invalid ⇒ the existing discarded
 *              path with a cascade-aware reason.
 *
 * Everything downstream (selfcheck → inactive insert → agent validation run →
 * activate) is UNCHANGED — the cascade only changes how the draft is authored.
 */
async function authorDraftCascade(
        messages: ChatMsg[],
): Promise<{ ok: true; def: TaskDef } | { ok: false; error: string }> {
        // stage 1 — LOCAL DRAFT (E8 cascadeArm stage 1: grammar on, same prompt)
        const draftModel = mintDraftModel();
        let draft: TaskDraft | null = null;
        let draftFailure: string | null = null;
        try {
                draft = await chatJson<TaskDraft>(messages, {
                        maxTokens: 3000,
                        model: draftModel,
                        responseSchema: MINT_SCHEMA,
                });
        } catch (err: any) {
                // Transport/parse failure (local server down, unparseable draft): E8
                // still escalates — the repair call re-authors from the prompt.
                draftFailure = err instanceof Error ? err.message : String(err);
        }
        const first =
                draft === null
                        ? { ok: false as const, error: draftFailure ?? "local draft call failed" }
                        : validateDraft(draft);
        if (first.ok) {
                cascadeOutcome("local_valid", first.def.id, draftModel, null);
                return first;
        }

        // stage 2 — ONE remote repair (E8 cascadeArm stage 3). The remote model
        // gets the full authoring transcript, the invalid draft and the validator
        // error — a far smaller job than authoring from scratch. Repair text
        // copied verbatim from benchmarks/local-llm/lib/e8.mjs (cascadeArm stage
        // 3 — E8 joins the testbench validator's failReasons with "; "; the
        // production validator reports a single error string. Keep in sync.)
        const repairModel = modelFor("mint");
        const repairMessages: ChatMsg[] = [
                ...messages,
                {
                        role: "assistant",
                        // E8 placeholder when the local call yielded no draft — verbatim.
                        content: draft === null ? "(the local model returned an empty draft)" : JSON.stringify(draft),
                },
                {
                        role: "user",
                        content: `That draft failed validation with: ${first.error}. Return the complete corrected JSON draft only.`,
                },
        ];
        const repaired = await chatJson<TaskDraft>(repairMessages, { maxTokens: 3000, model: repairModel });
        const second = validateDraft(repaired);
        if (second.ok) {
                cascadeOutcome("repaired", second.def.id, draftModel, repairModel);
                return second;
        }
        const error = `cascade repair failed: ${second.error} (local draft failed validation with: ${first.error})`;
        cascadeOutcome("discarded_after_repair", null, draftModel, repairModel, error);
        return { ok: false, error };
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
                return { status: "error", taskId: def.id, reason: `validation run threw: ${err instanceof Error ? err.message : String(err)}` };
        }

        if (validation.status === "failed") {
                // The agent genuinely fails the new task — but "the agent fails
                // it" alone does not prove the task is a fair capability eval:
                // it may be IMPOSSIBLE (the 2026-10-25 live finding — a
                // contradictory test file activated as a capability eval and
                // burned one agent run per cycle forever, because
                // pickNextTask() picks failing tasks first). Prove solvability
                // with a reference solution BEFORE activation.
                const solvability = await proveSolvability(def);
                if (!solvability.ok) {
                        store.run(`UPDATE tasks SET status = 'discarded', fail_count = fail_count + 1 WHERE id = ?`, [def.id]);
                        emit("task:mint-unsolvable", { id: def.id, reason: solvability.reason, validationRunId: validation.id });
                        console.log(`[mint] task ${def.id} DISCARDED — unsolvable: ${solvability.reason}`);
                        return {
                                status: "discarded",
                                taskId: def.id,
                                reason: `unsolvable task refused: ${solvability.reason}`,
                                validationRunId: validation.id,
                        };
                }
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
