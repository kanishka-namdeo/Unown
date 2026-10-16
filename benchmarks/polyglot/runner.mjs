#!/usr/bin/env node
/**
 * Unown polyglot benchmark runner.
 *
 * Runs the pinned Aider-polyglot exercise subset (see subset.json / gen-subset.mjs)
 * with the full Unown agent (`unown -p` headless sessions through the local
 * llm-bridge), mirroring Aider's protocol: 2 attempts per exercise, attempt 2
 * receives the attempt-1 test-failure output. An exercise passes when the
 * canonical per-language test command exits 0 after the agent run, with test
 * files restored to their pristine state before scoring.
 *
 * Fairness properties (see ../README.md for the full methodology):
 *  - .meta/ reference solutions are never copied into the agent workspace
 *  - test files are read-only during the session AND restored before scoring
 *  - each model gets an isolated UNOWN_HOME (fresh global memory) and fresh
 *    scratch dirs per attempt (no project memory leakage between attempts)
 *  - deterministic subset, pinned source commit, canonical test commands
 *
 * Usage:
 *   node runner.mjs --model kimi-k2.5 [--workers 3] [--langs python,java]
 *                   [--only <exercise-name>] [--list]
 *
 * Env:
 *   BENCH_ROOT     working dir (default /home/z/bench-runs/polyglot)
 *   POLYGLOT_REPO  exercise sources (default /home/z/my-project/bench-data/polyglot-benchmark)
 *   UNOWN_BIN      unown CLI (default ~/.local/bin/unown)
 *
 * Results append to $BENCH_ROOT/results/<model>.jsonl (resumable: exercises
 * with a recorded final outcome are skipped on re-run).
 */
import {
        appendFileSync,
        chmodSync,
        closeSync,
        copyFileSync,
        cpSync,
        existsSync,
        mkdirSync,
        openSync,
        readFileSync,
        readdirSync,
        readSync,
        renameSync,
        rmSync,
        statSync,
        writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

const ROOT = process.env.BENCH_ROOT ?? "/home/z/bench-runs/polyglot";
const POLYGLOT_REPO = process.env.POLYGLOT_REPO ?? "/home/z/my-project/bench-data/polyglot-benchmark";
const UNOWN_BIN = process.env.UNOWN_BIN ?? join(homedir(), ".local", "bin", "unown");
const HOME = homedir();

// Toolchain PATH prefixes the agent and the scorer both need.
const TOOL_PATH = [
        join(HOME, ".local", "bin"),
        join(HOME, ".npm-global", "bin"),
        "/home/z/.venv/bin",
        join(HOME, ".local", "go", "bin"),
        join(HOME, ".local", "jdk-21", "bin"),
        join(HOME, ".cargo", "bin"),
        process.env.PATH,
].join(":");

// ── per-language configuration ────────────────────────────────────────────────

const LANGS = {
        python: {
                sourceDir: "python",
                testFilePatterns: [/(_test|_cases)\.py$/],
                agentTimeoutMs: 8 * 60_000,
                score: scorePython,
                testHint: "pytest -q",
        },
        javascript: {
                sourceDir: "javascript",
                testFilePatterns: [/\.spec\.js$/],
                agentTimeoutMs: 8 * 60_000,
                prep: prepJavascript,
                score: scoreJavascript,
                testHint: "npm test",
        },
        cpp: {
                sourceDir: "cpp",
                testFilePatterns: [/_test\.cpp$/, /^CMakeLists\.txt$/],
                agentTimeoutMs: 8 * 60_000,
                score: scoreCpp,
                testHint: "cmake -B build -DEXERCISM_RUN_ALL_TESTS=1 && cmake --build build && run the test binary produced in build/",
        },
        go: {
                sourceDir: "go",
                testFilePatterns: [/_test\.go$/],
                agentTimeoutMs: 8 * 60_000,
                score: scoreGo,
                testHint: "go test ./...",
        },
        java: {
                sourceDir: "java",
                testFilePatterns: [/^src\/test\//],
                agentTimeoutMs: 12 * 60_000,
                score: scoreJava,
                testHint: "./gradlew test",
        },
        rust: {
                sourceDir: "rust",
                testFilePatterns: [/^tests\//, /^Cargo\.toml$/],
                agentTimeoutMs: 8 * 60_000,
                score: scoreRust,
                testHint: "cargo test -- --include-ignored",
        },
};

// ── helpers ──────────────────────────────────────────────────────────────────

function run(cmd, args, opts = {}) {
        return new Promise((resolveRun) => {
                const child = spawn(cmd, args, {
                        stdio: ["ignore", "pipe", "pipe"],
                        ...opts,
                });
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

function tail(text, lines = 120) {
        const parts = text.trimEnd().split("\n");
        return parts.slice(-lines).join("\n");
}

function listFiles(dir, prefix = "") {
        const entries = [];
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === ".docs") continue;
                const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
                if (entry.isDirectory()) entries.push(...listFiles(join(dir, entry.name), rel));
                else entries.push(rel);
        }
        return entries;
}

function isTestFile(lang, relPath) {
        return LANGS[lang].testFilePatterns.some((re) => re.test(relPath));
}

// Copy the exercise into a fresh scratch dir WITHOUT .meta (reference solution).
function freshScratch(lang, name, attemptDir) {
        const src = join(POLYGLOT_REPO, LANGS[lang].sourceDir, "exercises", "practice", name);
        rmSync(attemptDir, { recursive: true, force: true });
        mkdirSync(attemptDir, { recursive: true });
        cpSync(src, attemptDir, {
                recursive: true,
                filter: (p) => !p.split("/").includes(".meta"),
        });
}

// Free scratch space after scoring: keep the agent logs at baseDir level, drop the
// workspace copies (result JSONL + session JSONLs in UNOWN_HOME are the receipts;
// JS workspaces alone are ~100-200MB each and would fill the disk across 150 runs).
function cleanupAttempts(baseDir) {
        for (const d of [join(baseDir, "a1"), join(baseDir, "a2")]) {
                rmSync(d, { recursive: true, force: true });
        }
}

// Make test files read-only (soft guard; pristine restore below is the hard guard).
function lockTestFiles(lang, dir) {
        for (const rel of listFiles(dir)) {
                if (isTestFile(lang, rel)) {
                        try {
                                chmodSync(join(dir, rel), 0o444);
                        } catch {}
                }
        }
}

// Restore pristine test files over whatever the agent left (hard anti-tamper).
function restoreTestFiles(lang, name, dir) {
        const src = join(POLYGLOT_REPO, LANGS[lang].sourceDir, "exercises", "practice", name);
        const walk = (d, prefix = "") => {
                for (const entry of readdirSync(d, { withFileTypes: true })) {
                        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
                        if (entry.isDirectory()) walk(join(d, entry.name), rel);
                        else if (isTestFile(lang, rel)) {
                                try {
                                        chmodSync(join(dir, rel), 0o644);
                                        copyFileSync(join(d, rel), join(dir, rel));
                                        chmodSync(join(dir, rel), 0o444);
                                } catch {}
                        }
                }
        };
        walk(src);
}

// JS: enable skipped tests exactly like Aider's npm-test.sh, provision node_modules.
async function prepJavascript(dir, name) {
        const specs = readdirSync(dir).filter((f) => f.endsWith(".spec.js"));
        const sed = await run("sed", ["-i", "s/\\bxtest(/test(/g", ...specs.map((s) => join(dir, s))], { timeoutMs: 30_000 });
        if (sed.code !== 0) throw new Error(`js sed failed: ${sed.err}`);
        const cacheBase = join(ROOT, "js-node-modules");
        const cacheDir = join(cacheBase, name);
        if (!existsSync(join(cacheDir, "node_modules"))) {
                // A cache dir without node_modules is a relic of an aborted build — remove it,
                // then build in a private temp dir and move it into place with an atomic rename
                // so concurrent runners can never see or corrupt a half-built cache.
                rmSync(cacheDir, { recursive: true, force: true });
                const tmp = join(cacheBase, `.tmp-${name}-${process.pid}`);
                rmSync(tmp, { recursive: true, force: true });
                mkdirSync(tmp, { recursive: true });
                copyFileSync(join(dir, "package.json"), join(tmp, "package.json"));
                const lockSrc = join(dir, "package-lock.json");
                if (existsSync(lockSrc)) copyFileSync(lockSrc, join(tmp, "package-lock.json"));
                console.log(`[js-cache] npm install for ${name} (one-time)`);
                const install = await run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], {
                        cwd: tmp,
                        timeoutMs: 6 * 60_000,
                        env: { ...process.env, PATH: TOOL_PATH },
                });
                if (install.code !== 0) {
                        rmSync(tmp, { recursive: true, force: true });
                        throw new Error(`npm install failed for ${name}: ${tail(install.out + install.err, 20)}`);
                }
                try {
                        renameSync(tmp, cacheDir);
                } catch {
                        // Another runner won the race — its cache is complete and atomic.
                        rmSync(tmp, { recursive: true, force: true });
                }
        }
        cpSync(join(cacheDir, "node_modules"), join(dir, "node_modules"), { recursive: true });
}

// ── scoring (canonical test commands, run by the harness) ─────────────────────

async function scorePython(dir) {
        const r = await run("/home/z/.venv/bin/pytest", ["-q"], { cwd: dir, timeoutMs: 180_000, env: { ...process.env, PATH: TOOL_PATH } });
        return { passed: r.code === 0, output: r.out + r.err };
}

async function scoreJavascript(dir) {
        const r = await run("npm", ["test", "--silent"], { cwd: dir, timeoutMs: 240_000, env: { ...process.env, PATH: TOOL_PATH } });
        return { passed: r.code === 0, output: r.out + r.err };
}

async function scoreCpp(dir) {
        rmSync(join(dir, "build"), { recursive: true, force: true });
        const build = await run(
                "bash",
                ["-c", "cmake -B build -DEXERCISM_RUN_ALL_TESTS=1 >build-cmake.log 2>&1 && cmake --build build >>build-cmake.log 2>&1"],
                { cwd: dir, timeoutMs: 300_000, env: { ...process.env, PATH: TOOL_PATH } },
        );
        if (build.code !== 0) {
                // Surface the REAL compiler/cmake errors — they live in the log,
                // and attempt-2 feedback without them is useless.
                let logTail = "";
                try {
                        logTail = readFileSync(join(dir, "build-cmake.log"), "utf8").trimEnd().split("\n").slice(-40).join("\n");
                } catch {}
                return { passed: false, output: `build failed:\n${logTail || build.out + build.err}` };
        }
        const buildDir = join(dir, "build");
        // Only actual test binaries: cmake litters build/ with CMakeCache.txt,
        // Makefile, *.cmake — plain files that chmod +x happily accepts, and
        // spawning them makes the kernel fall back to /bin/sh (ENOEXEC path),
        // "running" the cache as a shell script (exit 127, garbage output)
        // before the real test binary ever executes. ELF-magic check only.
        const binaries = readdirSync(buildDir, { withFileTypes: true })
                .filter((e) => e.isFile())
                .map((e) => e.name)
                .filter((n) => {
                        try {
                                const fd = openSync(join(buildDir, n), "r");
                                const magic = Buffer.alloc(4);
                                readSync(fd, magic, 0, 4, 0);
                                closeSync(fd);
                                return magic[0] === 0x7f && magic[1] === 0x45 && magic[2] === 0x4c && magic[3] === 0x46;
                        } catch {
                                return false;
                        }
                })
                .sort();
        if (binaries.length === 0) return { passed: false, output: "no test binary produced" };
        let output = "";
        for (const bin of binaries) {
                const r = await run(join(".", "build", bin), [], { cwd: dir, timeoutMs: 120_000, env: { ...process.env, PATH: TOOL_PATH } });
                output += `$ build/${bin}\n${r.out}${r.err}\n(exit ${r.code})\n`;
                if (r.code !== 0) return { passed: false, output };
        }
        return { passed: true, output };
}

async function scoreGo(dir) {
        const r = await run("go", ["test", "./..."], {
                cwd: dir,
                timeoutMs: 240_000,
                env: { ...process.env, PATH: TOOL_PATH, GOTOOLCHAIN: "local" },
        });
        return { passed: r.code === 0, output: r.out + r.err };
}

async function scoreJava(dir) {
        try {
                chmodSync(join(dir, "gradlew"), 0o755);
        } catch {}
        const r = await run("./gradlew", ["test", "--no-daemon", "-q"], {
                cwd: dir,
                timeoutMs: 480_000,
                env: { ...process.env, PATH: TOOL_PATH, JAVA_HOME: join(HOME, ".local", "jdk-21") },
        });
        return { passed: r.code === 0, output: r.out + r.err };
}

async function scoreRust(dir) {
        const r = await run("cargo", ["test", "--", "--include-ignored"], {
                cwd: dir,
                timeoutMs: 300_000,
                env: { ...process.env, PATH: TOOL_PATH },
        });
        return { passed: r.code === 0, output: r.out + r.err };
}

// ── agent session + token accounting ─────────────────────────────────────────

function agentEnv(unownHome) {
        return {
                ...process.env,
                PATH: TOOL_PATH,
                UNOWN_HOME: unownHome,
                UNOWN_NO_PREFLIGHT: "",
        };
}

function runAgent(model, unownHome, prompt, cwd, logBase, timeoutMs) {
        return new Promise((resolveRun) => {
                const child = spawn(UNOWN_BIN, ["-p", prompt], {
                        cwd,
                        env: agentEnv(unownHome),
                        stdio: ["ignore", "pipe", "pipe"],
                        detached: true, // own process group so we can reap the whole tree
                });
                let out = "";
                let err = "";
                const sweepGroup = () => {
                        try {
                                process.kill(-child.pid, "SIGKILL"); // kill orphans holding pipes
                        } catch {}
                };
                const timer = setTimeout(() => {
                        sweepGroup();
                }, timeoutMs);
                child.stdout.on("data", (d) => (out += d.toString()));
                child.stderr.on("data", (d) => (err += d.toString()));
                const finish = (code, signal) => {
                        clearTimeout(timer);
                        writeFileSync(`${logBase}.stdout.log`, out);
                        writeFileSync(`${logBase}.stderr.log`, err);
                        setTimeout(sweepGroup, 500); // sweep stragglers after the pipes settle
                        resolveRun({ code: code ?? -1, timedOut: signal === "SIGKILL", out, err });
                };
                child.on("error", (e) => {
                        err += `\n${String(e)}`;
                        finish(-1, null);
                });
                child.on("close", finish);
        });
}

// Sum token usage from the session JSONL(s) whose cwd matches the scratch dir.
function sessionUsage(unownHome, scratchDir, startMs) {
        const sessDir = join(unownHome, "agent", "sessions");
        if (!existsSync(sessDir)) return { input: 0, output: 0, cacheRead: 0, sessions: 0 };
        const usage = { input: 0, output: 0, cacheRead: 0, sessions: 0 };
        for (const f of readdirSync(sessDir)) {
                if (!f.endsWith(".jsonl")) continue;
                const p = join(sessDir, f);
                if (statSync(p).mtimeMs < startMs - 5_000) continue;
                let text;
                try {
                        text = readFileSync(p, "utf8");
                } catch {
                        continue;
                }
                let cwd = null;
                const first = text.split("\n", 1)[0];
                try {
                        cwd = JSON.parse(first)?.cwd;
                } catch {}
                if (cwd !== scratchDir) continue;
                usage.sessions++;
                for (const line of text.split("\n")) {
                        if (!line.includes('"usage"')) continue;
                        try {
                                const o = JSON.parse(line);
                                const u = o?.message?.usage ?? o?.usage;
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

// ── model home provisioning ───────────────────────────────────────────────────

function ensureModelHome(model) {
        const home = join(ROOT, "unown-home", model);
        const modelsJson = join(home, "agent", "models.json");
        if (!existsSync(modelsJson)) {
                console.log(`[setup] provisioning UNOWN_HOME for ${model}`);
                const r = spawnSync(UNOWN_BIN, ["setup", "--provider", "bridge", "--model", model, "--force"], {
                        cwd: ROOT,
                        env: { ...process.env, PATH: TOOL_PATH, UNOWN_HOME: home },
                        encoding: "utf8",
                        timeout: 120_000,
                });
                if (r.status !== 0) throw new Error(`unown setup failed for ${model}: ${r.stdout}\n${r.stderr}`);
        }
        const cfg = JSON.parse(readFileSync(modelsJson, "utf8"));
        const ids = Object.values(cfg.providers ?? {}).flatMap((p) => (p.models ?? []).map((m) => m.id));
        if (!ids.includes(model)) throw new Error(`model ${model} missing from ${modelsJson} (found: ${ids.join(", ")})`);
        return home;
}

// ── prompts ──────────────────────────────────────────────────────────────────

function buildPrompt(lang, name, dir, extra) {
        const instructions = readFileSync(join(dir, ".docs", "instructions.md"), "utf8");
        const files = listFiles(dir);
        const testFiles = files.filter((f) => isTestFile(lang, f));
        const base = `You are solving the Exercism practice exercise "${name}" (${lang}). Work only inside the current directory.

<exercise instructions>
${instructions.trim()}
</exercise instructions>

Files in this directory:
${files.map((f) => `- ${f}`).join("\n")}

Rules:
- Implement the solution in the existing stub source files (keep the project layout).
- Never modify the test files (${testFiles.join(", ")}) — they are read-only and restored before scoring.
- Verify your work by running: ${LANGS[lang].testHint}
- You may run the tests as many times as you like and iterate on failures.
- When every test passes — or you cannot improve further — reply with exactly: DONE`;
        const full = extra ? `${extra}\n\n${base}` : base;
        // Linux caps a single argv entry at 128KB (E2BIG) — stay well under it.
        return full.length > 100_000 ? `${full.slice(0, 100_000)}\n\n[output truncated]` : full;
}

const ATTEMPT2_PREFIX = (testOutput) => `Your previous attempt at this exercise failed. The test output was:

<test output>
${tail(testOutput, 120).slice(0, 60_000)}
</test output>

Fix the implementation so the all tests pass.`;

// ── main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function arg(name, fallback) {
        const i = args.indexOf(`--${name}`);
        return i !== -1 ? args[i + 1] : fallback;
}
const model = arg("model");
if (!model && !args.includes("--list")) {
        console.error("usage: node runner.mjs --model <id> [--workers 3] [--langs a,b] [--only name] [--list]");
        process.exit(2);
}
const workers = Math.max(1, Number(arg("workers", "3")));
const langFilter = arg("langs", "") ? arg("langs", "").split(",") : null;
const only = arg("only", null);

const subset = JSON.parse(readFileSync(join(import.meta.dirname, "subset.json"), "utf8"));
if (args.includes("--list")) {
        for (const e of subset.exercises) console.log(`${e.lang}\t${e.name}`);
        process.exit(0);
}

mkdirSync(join(ROOT, "results"), { recursive: true });
mkdirSync(join(ROOT, "scratch"), { recursive: true });
const resultsFile = join(ROOT, "results", `${model}.jsonl`);

// Resume: skip exercises with a final outcome (attempt-1 pass, or attempt-2 recorded).
const done = new Set();
if (existsSync(resultsFile)) {
        for (const line of readFileSync(resultsFile, "utf8").split("\n")) {
                if (!line.trim()) continue;
                try {
                        const r = JSON.parse(line);
                        if (r.passed || r.attempt >= 2) done.add(`${r.lang}/${r.exercise}`);
                } catch {}
        }
}

// Interleave languages in the queue so concurrent workers hit different toolchains.
const queue = [];
const byLang = new Map();
for (const e of subset.exercises) {
        if (langFilter && !langFilter.includes(e.lang)) continue;
        if (only && e.name !== only) continue;
        if (!byLang.has(e.lang)) byLang.set(e.lang, []);
        byLang.get(e.lang).push(e);
}
let more = true;
while (more) {
        more = false;
        for (const list of byLang.values()) {
                const e = list.shift();
                if (e) {
                        more = true;
                        if (!done.has(`${e.lang}/${e.name}`)) queue.push(e);
                }
        }
}

const unownHome = ensureModelHome(model);
console.log(`[runner] model=${model} workers=${workers} queued=${queue.length} skipped(done)=${done.size} home=${unownHome}`);

let active = 0;
let completed = 0;
const started = Date.now();

function record(entry) {
        appendFileSync(resultsFile, JSON.stringify(entry) + "\n");
}

async function runAttempt(attemptDir, logBase, prompt, timeoutMs) {
        const startMs = Date.now();
        const agent = await runAgent(model, unownHome, prompt, attemptDir, logBase, timeoutMs);
        return { agent, usage: sessionUsage(unownHome, attemptDir, startMs), durationS: (Date.now() - startMs) / 1000 };
}

async function processExercise(e) {
        const { lang, name } = e;
        const cfg = LANGS[lang];
        // Attempt workspaces are nested one level deeper and NAMED AFTER THE
        // EXERCISE: exercism's C++ CMakeLists derives target and source filenames
        // from the directory basename, so the directory the agent works in must be
        // called exactly <exercise> or every cmake build fails.
        const baseDir = join(ROOT, "scratch", model, lang, name);
        const a1Dir = join(baseDir, "a1", name);
        const a2Dir = join(baseDir, "a2", name);

        // Attempt 1
        freshScratch(lang, name, a1Dir);
        if (cfg.prep) await cfg.prep(a1Dir, name);
        lockTestFiles(lang, a1Dir);
        const prompt1 = buildPrompt(lang, name, a1Dir);
        const r1 = await runAttempt(a1Dir, join(baseDir, "agent-a1"), prompt1, cfg.agentTimeoutMs);
        restoreTestFiles(lang, name, a1Dir);
        const s1 = await cfg.score(a1Dir);
        record({
                ts: new Date().toISOString(), model, lang, exercise: name, attempt: 1,
                passed: s1.passed, agentTimedOut: r1.agent.timedOut, agentExit: r1.agent.code,
                testOutputTail: tail(s1.output, 12), durationS: Math.round(r1.durationS),
                tokens: r1.usage, sessions: r1.usage.sessions,
        });
        if (s1.passed) {
                console.log(`✓ ${lang}/${name} (attempt 1, ${Math.round(r1.durationS)}s)`);
                cleanupAttempts(baseDir);
                return;
        }

        // Attempt 2 — same task, failure feedback from attempt 1.
        freshScratch(lang, name, a2Dir);
        if (cfg.prep) await cfg.prep(a2Dir, name);
        lockTestFiles(lang, a2Dir);
        const prompt2 = buildPrompt(lang, name, a2Dir, ATTEMPT2_PREFIX(s1.output));
        const r2 = await runAttempt(a2Dir, join(baseDir, "agent-a2"), prompt2, cfg.agentTimeoutMs);
        restoreTestFiles(lang, name, a2Dir);
        const s2 = await cfg.score(a2Dir);
        record({
                ts: new Date().toISOString(), model, lang, exercise: name, attempt: 2,
                passed: s2.passed, agentTimedOut: r2.agent.timedOut, agentExit: r2.agent.code,
                testOutputTail: tail(s2.output, 12), durationS: Math.round(r2.durationS),
                tokens: r2.usage, sessions: r2.usage.sessions,
        });
        console.log(`${s2.passed ? "✓" : "✗"} ${lang}/${name} (attempt 2, ${Math.round(r2.durationS)}s)`);
        cleanupAttempts(baseDir);
}

async function main() {
        let idx = 0;
        async function worker() {
                while (idx < queue.length) {
                        const e = queue[idx++];
                        try {
                                await processExercise(e);
                        } catch (err) {
                                console.error(`! ${e.lang}/${e.name} harness error: ${err.message}`);
                                cleanupAttempts(join(ROOT, "scratch", model, e.lang, e.name));
                                record({
                                        ts: new Date().toISOString(), model, lang: e.lang, exercise: e.name, attempt: 2,
                                        passed: false, harnessError: String(err.message).slice(0, 300),
                                });
                        }
                        completed++;
                }
        }
        await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, worker));

        // Summary
        const results = readFileSync(resultsFile, "utf8")
                .split("\n")
                .filter(Boolean)
                .map((l) => JSON.parse(l));
        const mine = new Map();
        for (const r of results) mine.set(`${r.lang}/${r.exercise}`, r.passed || mine.get(`${r.lang}/${r.exercise}`));
        const pass1 = results.filter((r) => r.attempt === 1 && r.passed).length;
        const passAny = [...mine.values()].filter(Boolean).length;
        const total = mine.size;
        const tokens = results.reduce(
                (acc, r) => ({ input: acc.input + (r.tokens?.input ?? 0), output: acc.output + (r.tokens?.output ?? 0) }),
                { input: 0, output: 0 },
        );
        const perLang = {};
        for (const [k, v] of mine) {
                const [l] = k.split("/");
                perLang[l] = perLang[l] || { total: 0, passed: 0 };
                perLang[l].total++;
                if (v) perLang[l].passed++;
        }
        console.log("\n==== SUMMARY", model, "====");
        console.log(`pass@1: ${pass1}/${total} (${((100 * pass1) / Math.max(1, total)).toFixed(1)}%)`);
        console.log(`pass@2: ${passAny}/${total} (${((100 * passAny) / Math.max(1, total)).toFixed(1)}%)`);
        for (const [l, s] of Object.entries(perLang)) console.log(`  ${l}: ${s.passed}/${s.total}`);
        console.log(`tokens: input=${tokens.input} output=${tokens.output}`);
        console.log(`wall: ${Math.round((Date.now() - started) / 1000)}s (this invocation)`);
}

main().catch((e) => {
        console.error(e);
        process.exit(1);
});
