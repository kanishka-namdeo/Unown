#!/usr/bin/env node
/**
 * runner-v3.mjs — Unown v3 "project continuity" memory benchmark.
 *
 * The real-life memory question the v2 repeat-task benchmark could not ask:
 * a user does NOT re-solve the same task. They keep working in the SAME repo
 * on NEW tasks while memory accumulates session over session. This runner
 * simulates exactly that trajectory and measures what memory buys.
 *
 * Protocol (per model, default kimi-k2.5):
 *   Three copies of the same evolving 6-task repo (v3-fixture):
 *     acc  — REAL product behavior: every session's notes are consolidated by
 *            a real AutoDream dream (triggered after each session, memory
 *            snapshot per task); the next session starts with the learned
 *            .unown/memory/project.md.
 *     ctl  — no-memory control: identical sessions, but the session's notes
 *            are deleted from the engine and project.md reset to the seed
 *            template after every session (a memoryless agent in the same
 *            repo trajectory).
 *     unrel — unrelated-memory control: project.md is pre-seeded with the v2
 *            PYTHON Exercism dreamed memory (a real, learned, WRONG-domain
 *            memory) and stays that way; notes are deleted like ctl. This
 *            isolates "irrelevant memory present" from "no memory".
 *   Each session = one `unown -p` run in the repo dir (the terminal agent,
 *   4-tier memory injected via agentsFilesOverride, notes filed via the note
 *   tool, delivered to the live engine on :3030).
 *   Scoring mirrors the v2/polyglot anti-tamper rules: tests read-only during
 *   the session, pristine restore before scoring, cumulative suite (task N
 *   passes only if ALL tests dropped so far are green).
 *
 * Resume-safe: records append to results/<model>.jsonl keyed (arm, taskIdx);
 * re-running skips done pairs. Chunked execution: each invocation works until
 * CHUNK_MS (default 9 minutes) elapses, then exits 0 — call repeatedly.
 *
 * Usage:
 *   bun runner-v3.mjs --phase setup|run|report [--arm acc|ctl|unrel] [--model kimi-k2.5]
 */
import {
        appendFileSync,
        chmodSync,
        copyFileSync,
        cpSync,
        existsSync,
        mkdirSync,
        readFileSync,
        readdirSync,
        rmSync,
        statSync,
        writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

const ROOT = process.env.BENCH_ROOT ?? "/home/z/bench-runs/memv3";
const FIXTURE = join(import.meta.dir, "v3-fixture");
const UNOWN_BIN = process.env.UNOWN_BIN ?? join(homedir(), ".local", "bin", "unown");
const ENGINE = process.env.UNOWN_ENGINE_URL ?? "http://127.0.0.1:3030";
const ENGINE_DB = process.env.UNOWN_ENGINE_DB ?? "/home/z/my-project/Unown/db/selflearning.db";
const PYTHON_MEMORY = join(import.meta.dir, "results", "v2-notes", "memory-cold-task-02-book-store.md");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODEL = process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1] : "kimi-k2.5";
const PHASE = process.argv.includes("--phase") ? process.argv[process.argv.indexOf("--phase") + 1] : "run";
const ARM = process.argv.includes("--arm") ? process.argv[process.argv.indexOf("--arm") + 1] : null;
const CHUNK_MS = Number(process.env.BENCH_CHUNK_MS ?? 540_000);
const HOME = homedir();

const TOOL_PATH = [join(HOME, ".local", "bin"), join(HOME, ".npm-global", "bin"), process.env.PATH].join(":");
const RESULTS = join(ROOT, "results");
const UNOWN_HOME = join(ROOT, "unown-home");
const ARMS = ["acc", "ctl", "unrel"];
const repoDir = (arm) => join(ROOT, `membench-${arm}`);
const memoryPath = (arm) => join(repoDir(arm), ".unown", "memory", "project.md");

const TASKS = JSON.parse(readFileSync(join(FIXTURE, "tasks.json"), "utf8")).tasks;
const PROJECT_TEMPLATE = `# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
(empty — AutoDream fills this from session notes)

## Known pitfalls
(empty)
`;

function run(cmd, args, opts = {}) {
        return new Promise((resolveRun) => {
                const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
                let out = "";
                let err = "";
                const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;
                child.stdout.on("data", (d) => (out += d.toString()));
                child.stderr.on("data", (d) => (err += d.toString()));
                child.on("error", (e) => resolveRun({ code: -1, out, err: String(e), timedOut: false }));
                child.on("close", (code, signal) => {
                        if (timer) clearTimeout(timer);
                        resolveRun({ code: code ?? -1, out, err, timedOut: signal === "SIGKILL" });
                });
        });
}

function runAgentSession(prompt, cwd, logBase, timeoutMs) {
        return new Promise((resolveRun) => {
                const child = spawn(UNOWN_BIN, ["-p", prompt], {
                        cwd,
                        env: { ...process.env, PATH: TOOL_PATH, UNOWN_HOME },
                        stdio: ["ignore", "pipe", "pipe"],
                        detached: true,
                });
                let out = "";
                let err = "";
                const sweepGroup = () => {
                        try {
                                process.kill(-child.pid, "SIGKILL");
                        } catch {}
                };
                const timer = setTimeout(sweepGroup, timeoutMs);
                child.stdout.on("data", (d) => (out += d.toString()));
                child.stderr.on("data", (d) => (err += d.toString()));
                const finish = (code, signal) => {
                        clearTimeout(timer);
                        writeFileSync(`${logBase}.stdout.log`, out);
                        writeFileSync(`${logBase}.stderr.log`, err);
                        setTimeout(sweepGroup, 500);
                        resolveRun({ code: code ?? -1, timedOut: signal === "SIGKILL" });
                };
                child.on("error", (e) => {
                        err += `\n${String(e)}`;
                        finish(-1, null);
                });
                child.on("close", finish);
        });
}

/** Token usage for sessions opened in `cwd` since `startMs` (v2 convention). */
function sessionUsage(cwd, startMs) {
        const sessDir = join(UNOWN_HOME, "agent", "sessions");
        if (!existsSync(sessDir)) return { input: 0, output: 0, cacheRead: 0, sessions: 0 };
        const usage = { input: 0, output: 0, cacheRead: 0, sessions: 0 };
        for (const f of readdirSync(sessDir)) {
                if (!f.endsWith(".jsonl")) continue;
                const p = join(sessDir, f);
                if (statSync(p).mtimeMs < startMs - 5_000) continue;
                const text = readFileSync(p, "utf8");
                try {
                        if (JSON.parse(text.split("\n", 1)[0])?.cwd !== cwd) continue;
                } catch {
                        continue;
                }
                usage.sessions++;
                for (const line of text.split("\n")) {
                        if (!line.includes('"usage"')) continue;
                        try {
                                const u = JSON.parse(line)?.message?.usage;
                                if (u) {
                                        usage.input += u.input ?? 0;
                                        usage.output += u.output ?? 0;
                                        usage.cacheRead += u.cacheRead ?? 0;
                                }
                        } catch {}
                }
        }
        return usage;
}

async function api(method, path, body) {
        const res = await fetch(`${ENGINE}${path}`, {
                method,
                headers: body !== undefined ? { "content-type": "application/json" } : undefined,
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(300_000),
        });
        const json = await res.json().catch(() => ({}));
        return { status: res.status, json };
}

/** Remove this arm's undreamed terminal notes so no dream can consolidate them (ctl/unrel). */
function deleteArmNotes(arm) {
        try {
                const { Database } = require("bun:sqlite");
                const db = new Database(ENGINE_DB);
                try {
                        db.exec("PRAGMA busy_timeout=5000");
                        db.run(`DELETE FROM notes WHERE project_slug = ? AND dream_id IS NULL`, [`membench-${arm}`]);
                } finally {
                        db.close();
                }
                return true;
        } catch (err) {
                console.error(`[note-delete] failed: ${err?.message ?? err}`);
                return false;
        }
}

function dropTestFile(task) {
        if (!task.dropTest) return;
        const dst = join(repoDir(ARM_NOW), task.dropTest);
        copyFileSync(join(FIXTURE, "tests", task.dropTest), dst);
        chmodSync(dst, 0o444);
}

function restoreAllTests() {
        for (const f of readdirSync(join(FIXTURE, "tests"))) {
                const dst = join(repoDir(ARM_NOW), f);
                if (existsSync(dst)) {
                        chmodSync(dst, 0o644);
                        copyFileSync(join(FIXTURE, "tests", f), dst);
                        chmodSync(dst, 0o444);
                }
        }
}

async function scoreCumulative(taskIdx) {
        const dir = repoDir(ARM_NOW);
        const testFiles = readdirSync(dir).filter((f) => f.endsWith(".test.mjs"));
        let ok = true;
        const tails = [];
        for (const f of testFiles) {
                const r = await run("node", [f], {
                        cwd: dir,
                        timeoutMs: 60_000,
                        env: { ...process.env, PATH: TOOL_PATH },
                });
                if (r.code !== 0) ok = false;
                tails.push(`${f}: ${r.code === 0 ? "ok" : "FAIL"}`);
        }
        return { ok, tails, testFiles };
}

function buildPrompt(task, taskIdx, arm) {
        const dir = repoDir(arm);
        const files = readdirSync(dir).filter((f) => f !== ".unown");
        const tests = files.filter((f) => /_test\.py$|\.test\.mjs$/.test(f));
        return `You are working on the "membench" library repo (task ${taskIdx + 1}/6: ${task.title}).

<task spec>
${task.promptSpec}
</task spec>

Files in this directory:
${files.map((f) => `- ${f}`).join("\n")}

Rules:
- Implement or fix exactly what the task asks; keep the repo layout and existing modules working.
- Never modify the test files (${tests.join(", ")}) — they are read-only and restored before scoring.
- Verify your work by running each test file with node (e.g. \`node ${tests[0] ?? "calc.test.mjs"}\`); everything dropped so far must stay green.
- You may run the tests as many times as you like and iterate on failures.
- Before finishing, use the note tool to record 1-3 concise lessons a future session in this project would benefit from (conventions you discovered, gotchas, test-command quirks).
- When every test passes — or you cannot improve further — reply with exactly: DONE`;
}

/** Trigger the auto-dream job and wait for THIS arm's project memory to change. */
async function dreamAndAwait(arm, taskIdx) {
        const memPath = memoryPath(arm);
        const before = existsSync(memPath) ? readFileSync(memPath, "utf8") : "";
        let trigger = null;
        for (let i = 0; i < 6; i++) {
                trigger = await api("POST", "/api/jobs/auto-dream/trigger", {});
                if (trigger.status === 200) break;
                console.log(`  [dream] engine busy (${trigger.status}), retrying in 10s...`);
                await sleep(10_000);
        }
        if (trigger.status !== 200) return { changed: false, reason: `trigger failed: ${trigger.status}` };
        // The trigger awaits the full job; give the file write a moment + poll.
        const deadline = Date.now() + 90_000;
        let after = before;
        while (Date.now() < deadline) {
                after = existsSync(memPath) ? readFileSync(memPath, "utf8") : "";
                if (after !== before && after.trim().length > 0) break;
                await sleep(3_000);
        }
        const changed = after !== before;
        if (changed) {
                // snapshot labeled by the 1-based session index that just finished
                writeFileSync(join(RESULTS, `memory-${arm}-after-session-${taskIdx}.md`), after);
        }
        return {
                changed,
                reason: changed ? "dream consolidated" : "memory unchanged (dream may have skipped)",
                projects: trigger.json?.result?.projects?.map((p) => [p.slug, p.status]) ?? null,
        };
}

function resetMemoryToTemplate(arm) {
        const memPath = memoryPath(arm);
        mkdirSync(join(repoDir(arm), ".unown", "memory"), { recursive: true });
        writeFileSync(memPath, PROJECT_TEMPLATE, "utf8");
}

async function phaseSetup() {
        mkdirSync(RESULTS, { recursive: true });
        if (!existsSync(join(UNOWN_HOME, "agent", "models.json"))) {
                const r = await run(UNOWN_BIN, ["setup", "--provider", "bridge", "--model", MODEL, "--force"], {
                        cwd: ROOT,
                        env: { ...process.env, PATH: TOOL_PATH, UNOWN_HOME },
                        timeoutMs: 120_000,
                });
                if (r.code !== 0) throw new Error(`unown setup failed: ${r.out}${r.err}`);
        }
        for (const arm of ARMS) {
                const dir = repoDir(arm);
                rmSync(dir, { recursive: true, force: true });
                mkdirSync(dir, { recursive: true });
                cpSync(join(FIXTURE, "template"), dir, { recursive: true });
                if (arm === "unrel") {
                        // Seed the UNRELATED (python-exercism v2) learned memory.
                        mkdirSync(join(dir, ".unown", "memory"), { recursive: true });
                        const src = existsSync(PYTHON_MEMORY) ? readFileSync(PYTHON_MEMORY, "utf8") : PROJECT_TEMPLATE;
                        writeFileSync(memoryPath(arm), src, "utf8");
                        writeFileSync(join(dir, ".unown", ".gitignore"), "local.md\n*.local.md\n", "utf8");
                } else {
                        const init = await run(UNOWN_BIN, ["init"], {
                                cwd: dir,
                                env: { ...process.env, PATH: TOOL_PATH, UNOWN_HOME },
                                timeoutMs: 60_000,
                        });
                        console.log(`[setup:${arm}] unown init exit ${init.code}`);
                }
        }
        writeFileSync(join(RESULTS, "unrel-memory-source.md"), existsSync(PYTHON_MEMORY) ? readFileSync(PYTHON_MEMORY, "utf8") : "(missing)", "utf8");
        console.log(`[setup] three arms ready under ${ROOT} (model ${MODEL})`);
}

function doneKeys() {
        const f = join(RESULTS, `${MODEL}.jsonl`);
        if (!existsSync(f)) return new Set();
        return new Set(
                readFileSync(f, "utf8")
                        .split("\n")
                        .filter(Boolean)
                        .map((l) => JSON.parse(l))
                        .map((r) => `${r.arm}:${r.taskIdx}`),
        );
}

let ARM_NOW = "acc";

async function runOne(arm, taskIdx) {
        ARM_NOW = arm;
        const task = TASKS[taskIdx];
        const dir = repoDir(arm);
        // Task prep: drop the new test file, apply the seeded regression mutation.
        dropTestFile(task);
        if (task.mutate) {
                const target = join(dir, task.mutate.file);
                const src = readFileSync(target, "utf8");
                if (src.includes(task.mutate.find)) {
                        writeFileSync(target, src.replace(task.mutate.find, task.mutate.replaceWith), "utf8");
                } else {
                        console.log(`  [mutate] pattern not found in ${task.mutate.file} — skipping mutation (agent may have restructured)`);
                }
        }
        const startMs = Date.now();
        const agent = await runAgentSession(buildPrompt(task, taskIdx, arm), dir, join(ROOT, "logs", `${arm}-t${taskIdx + 1}-${task.id}`), 7 * 60_000);
        restoreAllTests();
        const score = await scoreCumulative(taskIdx);
        const usage = sessionUsage(dir, startMs);

        // Post-session arm logic.
        let memoryNote = "";
        if (arm === "acc") {
                const dream = await dreamAndAwait(arm, taskIdx + 1);
                memoryNote = dream.changed ? "dream consolidated" : `dream: ${dream.reason}`;
        } else {
                const deleted = deleteArmNotes(arm);
                if (arm === "ctl") resetMemoryToTemplate(arm);
                memoryNote = deleted ? "notes deleted (no memory)" : "note deletion FAILED — check control purity";
        }

        const record = {
                ts: new Date().toISOString(),
                model: MODEL,
                arm,
                taskIdx,
                taskId: task.id,
                passed: score.ok,
                agentTimedOut: agent.timedOut,
                durationS: Math.round((Date.now() - startMs) / 1000),
                tokens: usage,
                testsGreen: score.tails,
                memoryNote,
        };
        appendFileSync(join(RESULTS, `${MODEL}.jsonl`), JSON.stringify(record) + "\n");
        console.log(
                `${record.passed ? "✓" : "✗"} ${arm}/t${taskIdx + 1} ${task.id} (${record.durationS}s, in=${usage.input} out=${usage.output}; ${memoryNote})`,
        );
}

async function phaseRun() {
        mkdirSync(join(ROOT, "logs"), { recursive: true });
        mkdirSync(RESULTS, { recursive: true });
        const done = doneKeys();
        const order = [];
        for (const arm of ARM ? [ARM] : ARMS) for (let i = 0; i < TASKS.length; i++) order.push([arm, i]);
        const pending = order.filter(([a, i]) => !done.has(`${a}:${i}`));
        console.log(`[run] ${pending.length}/${order.length} sessions remaining (chunk budget ${Math.round(CHUNK_MS / 1000)}s)`);
        const chunkStart = Date.now();
        for (const [arm, i] of pending) {
                if (Date.now() - chunkStart > CHUNK_MS) {
                        console.log("[run] chunk budget reached — exiting (re-run to continue)");
                        return;
                }
                await runOne(arm, i);
        }
        console.log("[run] all sessions complete");
}

function phaseReport() {
        const f = join(RESULTS, `${MODEL}.jsonl`);
        const records = readFileSync(f, "utf8")
                .split("\n")
                .filter(Boolean)
                .map((l) => JSON.parse(l));
        const agg = (arm) => {
                const list = records.filter((r) => r.arm === arm);
                return {
                        tasks: list.length,
                        passed: list.filter((r) => r.passed).length,
                        input: list.reduce((a, r) => a + r.tokens.input, 0),
                        output: list.reduce((a, r) => a + r.tokens.output, 0),
                        cacheRead: list.reduce((a, r) => a + r.tokens.cacheRead, 0),
                        avgDurationS: Math.round(list.reduce((a, r) => a + r.durationS, 0) / Math.max(1, list.length)),
                        fails: list.filter((r) => !r.passed).map((r) => `t${r.taskIdx + 1}:${r.taskId}`),
                };
        };
        const summary = {
                model: MODEL,
                label: "project-continuity: 6 sequential tasks in one repo — accumulate (real dreams) vs control (no memory) vs unrelated (python memory), n=1 trajectory per arm",
                acc: agg("acc"),
                ctl: agg("ctl"),
                unrel: agg("unrel"),
                generatedAt: new Date().toISOString(),
        };
        summary.accVsCtl = {
                passDeltaPp: Math.round((100 * summary.acc.passed - 100 * summary.ctl.passed) / 6),
                inputTokenDeltaPct: summary.ctl.input ? Math.round((100 * (summary.acc.input - summary.ctl.input)) / summary.ctl.input) : null,
                durationDeltaPct: summary.ctl.avgDurationS ? Math.round((100 * (summary.acc.avgDurationS - summary.ctl.avgDurationS)) / summary.ctl.avgDurationS) : null,
        };
        summary.unrelVsCtl = {
                passDeltaPp: Math.round((100 * summary.unrel.passed - 100 * summary.ctl.passed) / 6),
                inputTokenDeltaPct: summary.ctl.input ? Math.round((100 * (summary.unrel.input - summary.ctl.input)) / summary.ctl.input) : null,
        };
        writeFileSync(join(RESULTS, `summary-v3.json`), JSON.stringify(summary, null, 2) + "\n");
        console.log(JSON.stringify(summary, null, 2));
}

switch (PHASE) {
        case "setup":
                await phaseSetup();
                break;
        case "run":
                await phaseRun();
                break;
        case "report":
                phaseReport();
                break;
        default:
                console.error("unknown phase; use --phase setup|run|report");
                process.exit(2);
}
