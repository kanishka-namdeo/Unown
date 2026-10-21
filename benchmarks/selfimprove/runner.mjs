#!/usr/bin/env node
/**
 * Unown self-improvement benchmark — "does memory actually help?"
 *
 * The differentiator experiment, labelled honestly: this measures REPEAT-TASK
 * efficiency (memory doing exactly what it exists for), not general skill.
 *
 * Design:
 *   cold pass  — 10 Python Exercism tasks solved in a fresh project with a
 *                fresh UNOWN_HOME; every session files notes to the engine.
 *   dream wait — poll the engine until AutoDream consolidates the notes into
 *                the project memory (.unown/memory/project.md changes).
 *   warm pass  — the SAME 10 tasks in a NEW project directory that carries
 *                only the learned memory (the .unown/ tree is copied, nothing
 *                else — no source files leak between passes).
 *   report     — pass-rate and token deltas, cold vs warm, with memory
 *                snapshots as receipts.
 *
 * Tasks are non-overlapping with the polyglot subset (no contamination), and
 * the harness itself mirrors the polyglot runner's anti-tamper scoring.
 *
 * Usage:
 *   node runner.mjs --phase cold|wait-dream|warm|report [--model kimi-k2.5]
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

const ROOT = process.env.BENCH_ROOT ?? "/home/z/bench-runs/selfimprove";
const POLYGLOT_REPO = process.env.POLYGLOT_REPO ?? "/home/z/my-project/bench-data/polyglot-benchmark";
const UNOWN_BIN = process.env.UNOWN_BIN ?? join(homedir(), ".local", "bin", "unown");
const ENGINE = process.env.UNOWN_ENGINE_URL ?? "http://127.0.0.1:3030";
const HOME = homedir();
const MODEL = process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1] : "kimi-k2.5";
const PHASE = process.argv.includes("--phase") ? process.argv[process.argv.indexOf("--phase") + 1] : "cold";

const TOOL_PATH = [
        join(HOME, ".local", "bin"),
        join(HOME, ".npm-global", "bin"),
        "/home/z/.venv/bin",
        process.env.PATH,
].join(":");

// Python-only task set; disjoint from benchmarks/polyglot/subset.json
// (picked from the polyglot repo's 34 python exercises, skipping the 8 in the subset).
const TASKS = [
        "beer-song",
        "book-store",
        "bottle-song",
        "dominoes",
        "food-chain",
        "grade-school",
        "phone-number",
        "pig-latin",
        "proverb",
        "transpose",
];

const PROJECT_A = join(ROOT, "projectA");
const PROJECT_B = join(ROOT, "projectB");
const UNOWN_HOME = join(ROOT, "unown-home");
const RESULTS = join(ROOT, "results");
const memoryPath = (project) => join(project, ".unown", "memory", "project.md");

// ── shared helpers (mirrors the polyglot runner) ──────────────────────────────

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

function runAgent(prompt, cwd, logBase, timeoutMs) {
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

function sessionUsage(scratchDir, startMs) {
        const sessDir = join(UNOWN_HOME, "agent", "sessions");
        if (!existsSync(sessDir)) return { input: 0, output: 0, cacheRead: 0, sessions: 0 };
        const usage = { input: 0, output: 0, cacheRead: 0, sessions: 0 };
        for (const f of readdirSync(sessDir)) {
                if (!f.endsWith(".jsonl")) continue;
                const p = join(sessDir, f);
                if (statSync(p).mtimeMs < startMs - 5_000) continue;
                const text = readFileSync(p, "utf8");
                try {
                        if (JSON.parse(text.split("\n", 1)[0])?.cwd !== scratchDir) continue;
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

function taskDir(task) {
        return join(POLYGLOT_REPO, "python", "exercises", "practice", task);
}

function setupScratch(task, dir) {
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        cpSync(taskDir(task), dir, { recursive: true, filter: (p) => !p.split("/").includes(".meta") });
        // read-only tests (soft guard; restored before scoring)
        for (const f of readdirSync(dir)) {
                if (/_test\.py$/.test(f)) chmodSync(join(dir, f), 0o444);
        }
}

function restoreTests(task, dir) {
        for (const f of readdirSync(taskDir(task))) {
                if (/_test\.py$/.test(f)) {
                        try {
                                chmodSync(join(dir, f), 0o644);
                                copyFileSync(join(taskDir(task), f), join(dir, f));
                                chmodSync(join(dir, f), 0o444);
                        } catch {}
                }
        }
}

function buildPrompt(task, dir) {
        const instructions = readFileSync(join(dir, ".docs", "instructions.md"), "utf8");
        const files = readdirSync(dir).filter((f) => f !== ".docs");
        const tests = files.filter((f) => /_test\.py$/.test(f));
        return `You are solving the Exercism practice exercise "${task}" (python). Work only inside the current directory.

<exercise instructions>
${instructions.trim()}
</exercise instructions>

Files in this directory:
${files.map((f) => `- ${f}`).join("\n")}

Rules:
- Implement the solution in the existing stub source files (keep the project layout).
- Never modify the test files (${tests.join(", ")}) — they are read-only and restored before scoring.
- Verify your work by running: pytest -q
- You may run the tests as many times as you like and iterate on failures.
- Before finishing, use the note tool to record 1-3 concise lessons a future session in this project would benefit from (conventions you discovered, gotchas, test-command quirks).
- When every test passes — or you cannot improve further — reply with exactly: DONE`;
}

async function solveTask(task, project, tag, carryMemory = false) {
        const dir = join(project, tag);
        setupScratch(task, dir);
        if (carryMemory) {
                // Carry ONLY the dreamed memory from this task's cold pass into the fresh
                // workspace — no source files leak; the warm session starts from the same
                // stubs but with the lessons AutoDream distilled from the cold session.
                const coldTag = tag.replace(/^warm-/, "cold-");
                const srcUnown = join(PROJECT_A, coldTag, ".unown");
                if (existsSync(srcUnown)) {
                        cpSync(srcUnown, join(dir, ".unown"), { recursive: true });
                }
        }
        const startMs = Date.now();
        const agent = await runAgent(buildPrompt(task, dir), dir, join(ROOT, "logs", `${tag}-agent`), 6 * 60_000);
        restoreTests(task, dir);
        const score = await run("/home/z/.venv/bin/pytest", ["-q"], {
                cwd: dir,
                timeoutMs: 120_000,
                env: { ...process.env, PATH: TOOL_PATH },
        });
        const usage = sessionUsage(dir, startMs);
        rmSync(dir, { recursive: true, force: true }); // keep receipts, free scratch
        return {
                ts: new Date().toISOString(), model: MODEL, task, phase: tag.startsWith("warm") ? "warm" : "cold",
                passed: score.code === 0, agentTimedOut: agent.timedOut,
                durationS: Math.round((Date.now() - startMs) / 1000), tokens: usage,
                testTail: (score.out + score.err).trimEnd().split("\n").slice(-2).join("\n"),
        };
}

async function passTasks(project, phasePrefix, carryMemory = false) {
        mkdirSync(join(ROOT, "logs"), { recursive: true });
        // Resume support (added 2026-10-21): a phase interrupted mid-run (tool
        // window caps, reboots) can be re-invoked — tasks whose (phase, task)
        // pair already has a record in the model's jsonl are skipped, so the
        // phase continues instead of restarting from zero. A record is only
        // appended after a task completes (pass or fail), so "has a record"
        // is exactly "has a final outcome" — the same rule the polyglot
        // runner uses. Duplicate records (from pre-resume partial windows)
        // are tolerated by the report's last-record-wins dedupe.
        const resultsPath = join(RESULTS, `${MODEL}.jsonl`);
        const done = new Set();
        if (existsSync(resultsPath)) {
                for (const line of readFileSync(resultsPath, "utf8").split("\n")) {
                        if (!line.trim()) continue;
                        try {
                                const r = JSON.parse(line);
                                if (r.phase === (phasePrefix.startsWith("warm") ? "warm" : "cold")) done.add(r.task);
                        } catch { /* tolerate */ }
                }
        }
        const out = [];
        for (let i = 0; i < TASKS.length; i++) {
                const task = TASKS[i];
                if (done.has(task)) {
                        console.log(`… ${phasePrefix}/${task} (resume: already recorded)`);
                        continue;
                }
                const tag = `${phasePrefix}-${String(i + 1).padStart(2, "0")}-${task}`;
                const record = await solveTask(task, project, tag, carryMemory);
                appendFileSync(resultsPath, JSON.stringify(record) + "\n");
                console.log(`${record.passed ? "✓" : "✗"} ${phasePrefix}/${task} (${record.durationS}s, in=${record.tokens.input} out=${record.tokens.output})`);
                out.push(record);
        }
        return out;
}

function snapshotMemory(label) {
        const p = memoryPath(PROJECT_A);
        if (!existsSync(p)) return { label, exists: false };
        writeFileSync(join(RESULTS, `memory-${label}.md`), readFileSync(p, "utf8"));
        return { label, exists: true, size: statSync(p).size, mtime: statSync(p).mtimeMs };
}

async function engineDreams() {
        try {
                const r = await run("curl", ["-s", "-m", "5", `${ENGINE}/api/dreams`], { timeoutMs: 10_000 });
                return JSON.parse(r.out).dreams ?? [];
        } catch {
                return [];
        }
}

// ── phases ───────────────────────────────────────────────────────────────────

async function ensureHome() {
        if (!existsSync(join(UNOWN_HOME, "agent", "models.json"))) {
                const r = await run(UNOWN_BIN, ["setup", "--provider", "bridge", "--model", MODEL, "--force"], {
                        cwd: ROOT,
                        env: { ...process.env, PATH: TOOL_PATH, UNOWN_HOME },
                        timeoutMs: 120_000,
                });
                if (r.code !== 0) throw new Error(`unown setup failed: ${r.out}${r.err}`);
        }
}

async function phaseCold() {
        mkdirSync(RESULTS, { recursive: true });
        await ensureHome();
        // Fresh start ONLY when no cold records exist: an interrupted cold
        // phase keeps PROJECT_A (its .unown carries the dreamed memory the
        // phase is accumulating) and resumes the un-recorded tasks. The
        // pre-resume behavior wiped PROJECT_A on every invocation, so any
        // interruption restarted the whole phase from zero (caught live in
        // the 2026-10-21 agnes windowed run).
        const resultsPath = join(RESULTS, `${MODEL}.jsonl`);
        const hasColdRecords = existsSync(resultsPath)
                ? readFileSync(resultsPath, "utf8").split("\n").some((l) => {
                          if (!l.trim()) return false;
                          try { return JSON.parse(l).phase === "cold"; } catch { return false; }
                  })
                : false;
        if (!hasColdRecords) {
                rmSync(PROJECT_A, { recursive: true, force: true });
                mkdirSync(PROJECT_A, { recursive: true });
                const init = await run(UNOWN_BIN, ["init"], { cwd: PROJECT_A, env: { ...process.env, PATH: TOOL_PATH, UNOWN_HOME }, timeoutMs: 60_000 });
                console.log(`[init] exit ${init.code}: ${(init.out + init.err).trim().split("\n").slice(-2).join(" / ")}`);
                snapshotMemory("cold-before");
        } else {
                console.log("[cold] resuming — PROJECT_A and its dreamed memory preserved");
        }
        await passTasks(PROJECT_A, "cold");
        snapshotMemory("cold-after");
        const notes = await run("curl", ["-s", "-m", "5", `${ENGINE}/api/notes`], { timeoutMs: 10_000 });
        console.log(`[engine] notes: ${notes.out.slice(0, 200)}`);
}

async function phaseWaitDream() {
        const dreamsBefore = (await engineDreams()).length;
        const memPath = memoryPath(PROJECT_A);
        const memBefore = existsSync(memPath) ? readFileSync(memPath, "utf8") : "";
        console.log(`waiting for AutoDream to change THIS project's memory (dreams so far: ${dreamsBefore})...`);
        const deadline = Date.now() + 15 * 60_000;
        let changed = false;
        while (Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 30_000));
                const memNow = existsSync(memPath) ? readFileSync(memPath, "utf8") : "";
                if (memNow !== memBefore && memNow.trim().length > 0) {
                        changed = true;
                        console.log(`project memory changed (${memBefore.length} -> ${memNow.length} chars)`);
                        break;
                }
                process.stdout.write(".");
        }
        if (!changed) console.log("\n[dream-wait] TIMEOUT: project memory never changed (dream did not extract entries from notes)");
        else console.log("\n[dream-wait] done");
        snapshotMemory("warm-before");
}

async function phaseWarm() {
        await ensureHome();
        // Same resume rule as phaseCold (PROJECT_B + warm records).
        const resultsPath = join(RESULTS, `${MODEL}.jsonl`);
        const hasWarmRecords = existsSync(resultsPath)
                ? readFileSync(resultsPath, "utf8").split("\n").some((l) => {
                          if (!l.trim()) return false;
                          try { return JSON.parse(l).phase === "warm"; } catch { return false; }
                  })
                : false;
        if (!hasWarmRecords) {
                rmSync(PROJECT_B, { recursive: true, force: true });
                mkdirSync(PROJECT_B, { recursive: true });
        } else {
                console.log("[warm] resuming — PROJECT_B preserved");
        }
        // Each task re-runs in a FRESH workspace that carries only the dreamed
        // per-task memory from the cold pass (see solveTask) — the clean isolation
        // of "what does Unown memory actually buy you on a repeat task".
        await passTasks(PROJECT_B, "warm", true);
        snapshotMemory("warm-after");
}

function phaseReport() {
        const records = readFileSync(join(RESULTS, `${MODEL}.jsonl`), "utf8")
                .split("\n")
                .filter(Boolean)
                .map((l) => JSON.parse(l));
        // Last-record-wins dedupe by (phase, task): partial pre-resume windows
        // could append a second record for an already-scored task; the final
        // invocation's outcome is the one the phase finished with.
        const deduped = new Map();
        for (const r of records) deduped.set(`${r.phase}::${r.task}`, r);
        const final = [...deduped.values()];
        const cold = final.filter((r) => r.phase === "cold");
        const warm = final.filter((r) => r.phase === "warm");
        const agg = (list) => ({
                tasks: list.length,
                passed: list.filter((r) => r.passed).length,
                input: list.reduce((a, r) => a + r.tokens.input, 0),
                output: list.reduce((a, r) => a + r.tokens.output, 0),
                cacheRead: list.reduce((a, r) => a + r.tokens.cacheRead, 0),
                avgDurationS: Math.round(list.reduce((a, r) => a + r.durationS, 0) / Math.max(1, list.length)),
        });
        const summary = {
                model: MODEL,
                label: "repeat-task efficiency (memory doing its job) — n=10, single run, honest numbers",
                cold: agg(cold),
                warm: agg(warm),
                generatedAt: new Date().toISOString(),
        };
        if (summary.cold.tasks && summary.warm.tasks) {
                summary.passRateLiftPp = (100 * summary.warm.passed) / summary.warm.tasks - (100 * summary.cold.passed) / summary.cold.tasks;
                summary.inputTokenDelta = summary.warm.input - summary.cold.input;
                summary.outputTokenDelta = summary.warm.output - summary.cold.output;
        }
        writeFileSync(join(RESULTS, "summary.json"), JSON.stringify(summary, null, "\t") + "\n");
        console.log(JSON.stringify(summary, null, 2));
}

switch (PHASE) {
        case "cold":
                await phaseCold();
                break;
        case "wait-dream":
                await phaseWaitDream();
                break;
        case "warm":
                await phaseWarm();
                break;
        case "report":
                phaseReport();
                break;
        default:
                console.error("unknown phase; use --phase cold|wait-dream|warm|report");
                process.exit(2);
}
