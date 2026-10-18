// task-structured.test.ts — spawn-level golden tests for the task tool's
// two 2026-10-19 SDLC upgrades (feature-parity round 2):
//
//   1. STRUCTURED OUTPUTS (oh-my-pi task outputSchema port): a task call with
//      output_schema makes the spawned subagent's final reply parse as JSON
//      and validate; an invalid reply triggers the corrective retry loop
//      (child re-spawned with the exact defects quoted); after retries the
//      verdict is a permissive warning (default) — and the validated JSON of
//      a valid reply reaches the parent verbatim.
//   2. WORKTREE ISOLATION (muse worktree fan-out port): worktree_isolation:
//      true in a git-repo project runs the child in .unown/worktrees/<id>;
//      a child that leaves work behind produces a KEPT worktree whose path
//      is reported for merge (nothing merges automatically); outside a git
//      repo the spawn is a typed FAILURE (never a silent shared run).
//
// Spawn-level like golden.test.ts: the REAL bin/unown, a private UNOWN_HOME,
// the local mock bridge. The bridge's JSONREPLY / TOOLCALL conventions
// (helpers.ts) script the child subagent's behavior.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJsonl, startMockBridge, unown, type MockBridge } from "./helpers.ts";

const LONG = { timeout: 180_000 } as const;

let bridge: MockBridge;

beforeAll(() => {
        bridge = startMockBridge();
});

afterAll(() => {
        bridge?.close();
});

const FINDINGS_SCHEMA = {
        type: "object",
        properties: {
                findings: {
                        type: "array",
                        items: {
                                type: "object",
                                properties: { title: { type: "string" }, severity: { enum: ["low", "medium", "high"] } },
                                required: ["title", "severity"],
                                additionalProperties: false,
                        },
                        minItems: 1,
                },
        },
        required: ["findings"],
        additionalProperties: false,
};

/** Child subagent requests at the bridge: their toolset has NO `task` tool
 *  (UNOWN_SUBAGENT=1 disables nesting) — parent turns carry it. */
const childRequests = () => bridge.requests.filter((r) => !r.tools.includes("task"));

describe("task tool — structured outputs (end-to-end, real CLI)", () => {
        test(
                "schema-valid reply returns as validated JSON",
                async () => {
                        const taskText = 'Audit the code. JSONREPLY {"findings": [{"title": "unhandled error", "severity": "high"}]}';
                        const prompt = `TOOLCALL task ${JSON.stringify({ task: taskText, output_schema: FINDINGS_SCHEMA })}`;
                        const run = await unown(["--mode", "json", "-p", prompt], { bridge, env: { UNOWN_NO_PREFLIGHT: "1" } });
                        expect(run.exitCode).toBe(0);
                        // The task TOOL RESULT carries the validated JSON as a ```json
                        // block (the parent asked for structured data; that IS the report).
                        const events = parseJsonl(run.stdout);
                        const taskResult = events.find(
                                (e) => e?.type === "tool_execution_end" && e.toolName === "task",
                        );
                        const text = String(taskResult?.result?.content?.[0]?.text ?? "");
                        expect(text).toContain("```json");
                        expect(text).toContain("unhandled error");
                        expect(text).not.toContain("structured output invalid");
                        run.release();
                },
                LONG,
        );

        test(
                "schema-invalid reply retries with defects quoted, then permissive warning",
                async () => {
                        const before = childRequests().length;
                        const taskText = 'Audit the code. JSONREPLY {"note": "wrong shape entirely"}';
                        const prompt = `TOOLCALL task ${JSON.stringify({ task: taskText, output_schema: FINDINGS_SCHEMA })}`;
                        const run = await unown(["--mode", "json", "-p", prompt], { bridge, env: { UNOWN_NO_PREFLIGHT: "1" } });
                        expect(run.exitCode).toBe(0);
                        // The parent's final transcript carries the permissive warning with
                        // the path-annotated defect (the reply object lacks "findings").
                        expect(run.stdout).toContain("structured output invalid");
                        // The retry loop re-spawned the child exactly STRUCTURED_RETRIES
                        // extra times (1 original + 2 corrective = 3 child turns here).
                        expect(childRequests().length - before).toBe(3);
                        run.release();
                },
                LONG,
        );

        test(
                "strict mode surfaces the failure, not the raw reply",
                async () => {
                        const taskText = 'Check types. JSONREPLY {"nope": 1}';
                        const prompt = `TOOLCALL task ${JSON.stringify({ task: taskText, output_schema: FINDINGS_SCHEMA, schema_mode: "strict" })}`;
                        const run = await unown(["--mode", "json", "-p", prompt], { bridge, env: { UNOWN_NO_PREFLIGHT: "1" } });
                        expect(run.exitCode).toBe(0);
                        expect(run.stdout).toContain("STRUCTURED OUTPUT FAILED");
                        run.release();
                },
                LONG,
        );
});

describe("task tool — worktree isolation (end-to-end, real CLI + real git)", () => {
        /** A run root whose proj dir is a REAL git repo with one committed file. */
        function gitRepoRoot(): string {
                const root = mkdtempSync(join(tmpdir(), "unown-wtree-cli-"));
                const proj = join(root, "proj");
                mkdirSync(proj, { recursive: true });
                const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
                const git = (args: string[]) => execFileSync("git", args, { cwd: proj, env, stdio: "ignore" });
                git(["init", "--initial-branch=main"]);
                git(["config", "user.email", "test@unown"]);
                git(["config", "user.name", "unown test"]);
                writeFileSync(join(proj, "seed.txt"), "seed\n");
                git(["add", "."]);
                git(["commit", "-m", "seed"]);
                return root;
        }

        test(
                "isolated child that writes a file leaves a KEPT worktree reported for merge",
                async () => {
                        const root = gitRepoRoot();
                        try {
                                // The child writes report.txt INSIDE its worktree (its cwd),
                                // then replies — scripted through the child's own task text.
                                const taskText =
                                        'Create the report file. TOOLCALL write {"path": "report.txt", "content": "subagent work"}';
                                const prompt = `TOOLCALL task ${JSON.stringify({ task: taskText, worktree_isolation: true })}`;
                                const run = await unown(["--mode", "json", "-p", prompt], { bridge, root, env: { UNOWN_NO_PREFLIGHT: "1" } });
                                expect(run.exitCode).toBe(0);
                                // The parent's transcript reports the KEPT tree + its path.
                                expect(run.stdout).toContain("worktree kept");
                                // The worktree directory exists with the child's file, and the
                                // journal records spawn + keep.
                                const wtDir = join(root, "proj", ".unown", "worktrees");
                                const keptEntry = readFileSync(join(wtDir, "registry.jsonl"), "utf8")
                                        .split("\n")
                                        .filter((l) => l.trim())
                                        .map((l) => JSON.parse(l))
                                        .find((r) => r.op === "kept");
                                expect(keptEntry).toBeDefined();
                                expect(existsSync(join(keptEntry.path, "report.txt"))).toBe(true);
                                // The parent repo itself stays untouched.
                                expect(existsSync(join(root, "proj", "report.txt"))).toBe(false);
                                // Clean the kept tree (this test owns it).
                                try {
                                        execFileSync("git", ["worktree", "remove", "--force", keptEntry.path], {
                                                cwd: join(root, "proj"),
                                                stdio: "ignore",
                                        });
                                } catch {
                                        /* best effort */
                                }
                        } finally {
                                try {
                                        rmSync(root, { recursive: true, force: true });
                                } catch {
                                        /* best effort */
                                }
                        }
                },
                LONG,
        );

        test(
                "outside a git repo the spawn is a typed failure — never a shared run",
                async () => {
                        const taskText = 'Do work in a tree. JSONREPLY {"ok": true}';
                        const prompt = `TOOLCALL task ${JSON.stringify({ task: taskText, worktree_isolation: true })}`;
                        const run = await unown(["--mode", "json", "-p", prompt], { bridge, env: { UNOWN_NO_PREFLIGHT: "1" } });
                        expect(run.exitCode).toBe(0);
                        expect(run.stdout).toContain("worktree isolation REJECTED");
                        expect(run.stdout).toContain("the subagent was NOT run in the shared tree");
                        run.release();
                },
                LONG,
        );
});
