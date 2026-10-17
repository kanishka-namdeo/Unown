#!/usr/bin/env node
/**
 * Unown long-horizon benchmark — "one deliberately hard, multi-file refactor
 * under a time limit" (docs/testing-strategy.md §7 item J).
 *
 * Design:
 *   fixture   — benchmarks/longhorizon/task/: "clippad", a small TypeScript
 *               note app (11 src modules + 7 test files + 2 docs) whose
 *               `createdBy: string` must become `createdBy: {id, name}`
 *               everywhere at once: types, factory, user directory, notebook,
 *               search, both formatters, strict store validation, stats, CLI,
 *               test helpers/pins and both docs.
 *   reference — benchmarks/longhorizon/reference/: the same tree after a
 *               correct hand-written refactor (committed; never copied into
 *               the agent workspace).
 *   run       — per model: fresh UNOWN_HOME, pristine workspace copy, the
 *               unown CLI in print mode with a HARD 15-minute wall-clock cap
 *               (process-group SIGKILL), then score the FILE DIFF — not just
 *               tests:
 *                 (a) non-triviality: files changed / insertions / deletions
 *                 (b) the project's own suite, scored BOTH ways:
 *                     testsAsIs     — as the agent left it (tests may be
 *                                     legitimately updated by the refactor)
 *                     testsPristine — pristine test files restored first
 *                                     (anti-tamper + old-contract probe; the
 *                                     REFERENCE itself fails 12/39 here —
 *                                     see results/calibration.json)
 *                     agentEditedTests is recorded alongside.
 *                 (c) diff quality vs the reference — honest heuristics:
 *                     fileSetJaccard      — overlap of changed-file sets
 *                     finalStateCloseness — 1 - churn(workspace, reference) /
 *                       churn(pristine, reference), where churn is a per-file
 *                       line diff (git diff --no-index --numstat, walked
 *                       file-by-file). 1.0 == files identical to the
 *                       reference, 0.0 == untouched pristine, negative =
 *                       moved further away than doing nothing. Formatting
 *                       differences count; exact match is NOT required.
 *                 (d) tokens, duration, tool calls and compaction/context
 *                     events read from the session JSONL receipts.
 *
 * Usage:
 *   node runner.mjs --phase run --model qwen3.7-plus
 *   node runner.mjs --phase calibrate
 *   node runner.mjs --phase report
 *   node runner.mjs                 # all models, sequentially, then report
 */
import {
        appendFileSync,
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

const HERE = new URL(".", import.meta.url).pathname; // .../benchmarks/longhorizon/
const TASK_DIR = join(HERE, "task");
const REF_DIR = join(HERE, "reference");
const RESULTS_DIR = join(HERE, "results");
const ROOT = process.env.BENCH_ROOT ?? "/home/z/bench-runs/longhorizon";
const UNOWN_BIN = process.env.UNOWN_BIN ?? join(homedir(), ".local", "bin", "unown");
const HOME = homedir();
const MODEL = process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1] : "";
const PHASE = process.argv.includes("--phase") ? process.argv[process.argv.indexOf("--phase") + 1] : "all";
// §7J "say 15 min" hard cap. Overridable via LONGHORIZON_TIME_LIMIT_MIN for
// orchestration environments that cap single commands (e.g. a 10-minute
// command limit needs 7 here to leave room for scoring); the value used is
// recorded in every receipt's timeLimitMin, and the agent prompt states the
// same number the timer enforces.
const TIME_LIMIT_MIN = Math.max(1, Number(process.env.LONGHORIZON_TIME_LIMIT_MIN ?? 15));
const TIME_LIMIT_MS = TIME_LIMIT_MIN * 60_000; // the hard cap, in ms
const MODELS = ["qwen3.7-plus", "kimi-k2.5", "qwen3.6-plus"];

const TOOL_PATH = [
        join(HOME, ".bun", "bin"),
        "/usr/local/bin",
        join(HOME, ".local", "bin"),
        join(HOME, ".npm-global", "bin"),
        "/home/z/.venv/bin",
        process.env.PATH,
].join(":");

// Files/dirs that must never count toward the agent diff.
const EXCLUDE = [".unown", "node_modules", ".git", ".DS_Store"];

// ── shared helpers (mirrors benchmarks/selfimprove/runner.mjs) ───────────────

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

function runAgent(prompt, cwd, logBase, timeoutMs, unownHome) {
        return new Promise((resolveRun) => {
                const child = spawn(UNOWN_BIN, ["-p", prompt], {
                        cwd,
                        env: { ...process.env, PATH: TOOL_PATH, UNOWN_HOME: unownHome },
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

async function ensureHome(unownHome, model) {
        if (!existsSync(join(unownHome, "agent", "models.json"))) {
                const r = await run(UNOWN_BIN, ["setup", "--provider", "bridge", "--model", model, "--force"], {
                        cwd: ROOT,
                        env: { ...process.env, PATH: TOOL_PATH, UNOWN_HOME: unownHome },
                        timeoutMs: 120_000,
                });
                if (r.code !== 0) throw new Error(`unown setup failed: ${r.out}${r.err}`);
        }
}

// ── session receipt parsing (v3 and v4 JSONL shapes, best effort) ───────────

function parseSessionStats(unownHome, workspace, startMs) {
        const sessDir = join(unownHome, "agent", "sessions");
        const stats = {
                sessions: 0,
                format: null,
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                toolCalls: 0,
                toolCallsByTool: {},
                toolResults: 0,
                compactionEntries: 0,
                compactionTokensBefore: [],
                compactionRuns: [],
                branchSummaries: 0,
                assistantMessages: 0,
        };
        if (!existsSync(sessDir)) return { ...stats, note: "no sessions dir" };
        for (const f of readdirSync(sessDir)) {
                if (!f.endsWith(".jsonl")) continue;
                const p = join(sessDir, f);
                if (statSync(p).mtimeMs < startMs - 5_000) continue;
                const text = readFileSync(p, "utf8");
                const lines = text.split("\n").filter(Boolean);
                let header;
                try {
                        header = JSON.parse(lines[0] ?? "{}");
                } catch {
                        continue;
                }
                if (header?.cwd !== workspace) continue;
                stats.sessions++;
                const version = typeof header.version === "number" ? header.version : null;
                stats.format = `v${version}`;
                for (const line of lines.slice(1)) {
                        let d;
                        try {
                                d = JSON.parse(line);
                        } catch {
                                continue;
                        }
                        switch (d.type) {
                                case "message": {
                                        const m = d.message ?? {};
                                        if (m.role === "assistant") stats.assistantMessages++;
                                        if (version !== 4 && Array.isArray(m.content)) {
                                                for (const c of m.content) {
                                                        if (c?.type === "toolCall" && c.name) {
                                                                stats.toolCalls++;
                                                                stats.toolCallsByTool[c.name] = (stats.toolCallsByTool[c.name] ?? 0) + 1;
                                                        }
                                                }
                                        }
                                        if (m.role === "toolResult" && m.toolName) stats.toolResults++;
                                        if (version !== 4 && m.usage) {
                                                stats.input += m.usage.input ?? 0;
                                                stats.output += m.usage.output ?? 0;
                                                stats.cacheRead += m.usage.cacheRead ?? 0;
                                                stats.cacheWrite += m.usage.cacheWrite ?? 0;
                                        }
                                        break;
                                }
                                // v4 record kinds (flat `type` after the record spread)
                                case "usage": {
                                        if (version === 4 && d.usage) {
                                                stats.input += d.usage.input ?? 0;
                                                stats.output += d.usage.output ?? 0;
                                                stats.cacheRead += d.usage.cacheRead ?? 0;
                                                stats.cacheWrite += d.usage.cacheWrite ?? 0;
                                        }
                                        break;
                                }
                                case "tool_started": {
                                        if (version === 4 && d.toolName) {
                                                stats.toolCalls++;
                                                stats.toolCallsByTool[d.toolName] = (stats.toolCallsByTool[d.toolName] ?? 0) + 1;
                                        }
                                        break;
                                }
                                case "compaction": {
                                        stats.compactionEntries++;
                                        if (typeof d.tokensBefore === "number") stats.compactionTokensBefore.push(d.tokensBefore);
                                        break;
                                }
                                case "step_attempt": {
                                        if (d.step === "compaction") stats.compactionRuns.push(d.compactionReason ?? "unknown");
                                        break;
                                }
                                case "branch_summary": {
                                        stats.branchSummaries++;
                                        break;
                                }
                        }
                }
        }
        return stats;
}

// ── diff helpers (walk the trees ourselves; git diff --no-index per file) ───

function listFiles(dir, base = "") {
        const out = [];
        for (const name of readdirSync(dir)) {
                if (EXCLUDE.includes(name)) continue;
                const abs = join(dir, name);
                const rel = base ? `${base}/${name}` : name;
                if (statSync(abs).isDirectory()) out.push(...listFiles(abs, rel));
                else out.push(rel);
        }
        return out.sort();
}

function lineCount(file) {
        return readFileSync(file, "utf8").split("\n").length;
}

/** Per-file numstat {ins, del} walked file-by-file (no path-label parsing). */
async function fileNumstat(fileA, fileB) {
        if (fileA === fileB) return { ins: 0, del: 0 };
        const r = await run("git", ["diff", "--no-index", "--numstat", "--", fileA, fileB], { timeoutMs: 30_000 });
        const m = r.out.match(/^(\d+|-)\t(\d+|-)\t/m);
        if (!m) return { ins: 0, del: 0 };
        return { ins: m[1] === "-" ? 0 : Number(m[1]), del: m[2] === "-" ? 0 : Number(m[2]) };
}

/** numstat between two trees: Map(relpath -> {ins, del}). */
async function dirNumstat(dirA, dirB) {
        const filesA = new Set(listFiles(dirA));
        const filesB = new Set(listFiles(dirB));
        const union = [...new Set([...filesA, ...filesB])];
        const map = new Map();
        for (const rel of union) {
                const a = join(dirA, rel);
                const b = join(dirB, rel);
                if (filesA.has(rel) && filesB.has(rel)) {
                        const st = await fileNumstat(a, b);
                        if (st.ins || st.del) map.set(rel, st);
                } else if (filesA.has(rel)) {
                        map.set(rel, { ins: 0, del: lineCount(a) });
                } else {
                        map.set(rel, { ins: lineCount(b), del: 0 });
                }
        }
        return map;
}

function churn(numstat) {
        let ins = 0;
        let del = 0;
        for (const v of numstat.values()) {
                ins += v.ins;
                del += v.del;
        }
        return { ins, del, total: ins + del };
}

function copyTreeFiltered(src, dest) {
        cpSync(src, dest, {
                recursive: true,
                filter: (p) => !EXCLUDE.some((x) => p.split("/").includes(x)),
        });
}

// ── bun test scoring ────────────────────────────────────────────────────────

function parseBunTestOutput(text) {
        const passes = [...text.matchAll(/(\d+)\s+pass/g)].map((m) => Number(m[1]));
        const fails = [...text.matchAll(/(\d+)\s+fail/g)].map((m) => Number(m[1]));
        const ran = [...text.matchAll(/Ran (\d+) tests/g)].map((m) => Number(m[1]));
        let pass = passes.length ? passes[passes.length - 1] : (text.match(/\(pass\)/g) ?? []).length;
        let fail = fails.length ? fails[fails.length - 1] : (text.match(/\(fail\)/g) ?? []).length;
        if (!passes.length && !fails.length && !ran.length && pass === 0 && fail === 0) {
                return { pass: 0, fail: 0, ran: 0, parseFailed: true, tail: text.trimEnd().split("\n").slice(-6).join("\n") };
        }
        return { pass, fail, ran: ran.length ? ran[ran.length - 1] : pass + fail, parseFailed: false };
}

async function runBunTest(cwd) {
        const r = await run("bun", ["test"], {
                cwd,
                env: { ...process.env, PATH: TOOL_PATH },
                timeoutMs: 180_000,
        });
        return { code: r.code, timedOut: r.timedOut, ...parseBunTestOutput(r.out + r.err) };
}

// ── the task prompt ─────────────────────────────────────────────────────────

function buildPrompt() {
        return `You are refactoring "clippad", a small TypeScript note-taking app in the current directory.

THE REFACTOR (one sweeping, mechanical change):
Every note today stores its creator as a plain string: \`createdBy: string\` (an author NAME like "ada").
Change the whole codebase so a note stores a STRUCTURED author instead:

    createdBy: { id: string, name: string }        // e.g. { id: "u-001", name: "ada" }

Thread it through EVERYWHERE the old string flowed:
 1. src/types.ts — an Author interface; Note.createdBy and NoteInput.createdBy become Author.
 2. src/note.ts — createNote carries the object through.
 3. src/users.ts — register(name) now RETURNS the full Author {id, name}; add an ensure(name) lookup-or-register helper.
 4. src/notebook.ts — byAuthor() now matches on the author ID (note.createdBy.id).
 5. src/search.ts — author matching checks BOTH createdBy.name and createdBy.id.
 6. src/format.ts — formatNote renders "(by <name> [<id>])", e.g. "(by ada [u-001])".
 7. src/format-table.ts — the CREATED-BY column renders "<name> (<id>)", e.g. "ada (u-001)".
 8. src/store.ts — parseNote validates createdBy is {id: string, name: string} and throws StoreError otherwise (store envelope version stays 1).
 9. src/stats.ts — authorStats rows become { id, name, count, words } keyed by author id.
10. src/cli.ts — "add --author <name>" resolves the name through a UserDirectory to a full Author; "stats" lines render "<name> (<id>): <count> notes, <words> words"; "author <id>" matches by id.
11. tests — update tests/helpers.ts, tests/author.test.ts and anything else that pinned the old string shape. Updating tests is PART of this refactor; do not delete or weaken them.
12. docs — update README.md and docs/API.md to the new field shape and output examples.

Rules:
- Work ONLY inside the current directory.
- Keep the project's own test suite green: run \`bun test\` and iterate until it passes.
- The store round-trip must keep working: serializeNotes -> parseStore must reproduce notes exactly.
- You have a HARD ${TIME_LIMIT_MIN}-minute wall-clock budget for the whole job. Plan the sweep first, then edit; a complete, compiling, test-green refactor beats a perfect one you never finish.
- When finished (or when you cannot improve further), reply with exactly: DONE`;
}

// ── per-model run ───────────────────────────────────────────────────────────

async function phaseRun(model) {
        mkdirSync(join(ROOT, "logs"), { recursive: true });
        mkdirSync(RESULTS_DIR, { recursive: true });
        const runRoot = join(ROOT, `run-${model}`);
        const workspace = join(runRoot, "workspace");
        const unownHome = join(runRoot, "unown-home");
        const diffRoot = join(runRoot, "diff"); // base/task + stage, for clean patch labels

        rmSync(runRoot, { recursive: true, force: true });
        mkdirSync(workspace, { recursive: true });
        copyTreeFiltered(TASK_DIR, workspace);
        await ensureHome(unownHome, model);

        const startMs = Date.now();
        console.log(`[${model}] spawning unown (${TIME_LIMIT_MIN}-min hard cap) in ${workspace}`);
        const agent = await runAgent(buildPrompt(), workspace, join(ROOT, "logs", `${model}-agent`), TIME_LIMIT_MS, unownHome);
        const durationS = Math.round((Date.now() - startMs) / 1000);
        const stdout = readFileSync(join(ROOT, "logs", `${model}-agent.stdout.log`), "utf8");
        const stderr = readFileSync(join(ROOT, "logs", `${model}-agent.stderr.log`), "utf8");

        // (d) session receipts: tokens, tool calls, compaction/context events
        const session = parseSessionStats(unownHome, workspace, startMs);

        // (a) non-triviality: diff pristine -> agent workspace (.unown excluded)
        mkdirSync(diffRoot, { recursive: true });
        copyTreeFiltered(TASK_DIR, join(diffRoot, "task"));
        copyTreeFiltered(workspace, join(diffRoot, "stage"));
        const patch = await run("git", ["diff", "--no-index", "task", "stage"], { cwd: diffRoot, timeoutMs: 60_000 });
        const modelDir = join(RESULTS_DIR, model);
        mkdirSync(modelDir, { recursive: true });
        writeFileSync(join(modelDir, "workspace.patch"), patch.out);
        const agentNumstat = await dirNumstat(TASK_DIR, workspace);
        const filesChanged = [...agentNumstat.keys()].sort();
        const agentChurn = churn(agentNumstat);

        // agent-edited tests (recorded BEFORE restoring pristine tests)
        const editedTests = [];
        for (const rel of listFiles(join(TASK_DIR, "tests"))) {
                const a = join(TASK_DIR, "tests", rel);
                const b = join(workspace, "tests", rel);
                if (!existsSync(b) || readFileSync(a, "utf8") !== readFileSync(b, "utf8")) editedTests.push(rel);
        }
        const newTests = listFiles(workspace).filter((rel) => rel.startsWith("tests/") && !listFiles(join(TASK_DIR, "tests")).includes(rel.slice("tests/".length)));

        // (b) tests BOTH ways: as-is, then with pristine test files restored
        const testsAsIs = await runBunTest(workspace);
        rmSync(join(workspace, "tests"), { recursive: true, force: true });
        cpSync(join(TASK_DIR, "tests"), join(workspace, "tests"), { recursive: true });
        const testsPristine = await runBunTest(workspace);

        // (c) diff quality vs reference — heuristics, honestly labelled
        const refNumstat = await dirNumstat(TASK_DIR, REF_DIR);
        const refChurn = churn(refNumstat);
        const refFiles = new Set(refNumstat.keys());
        const agentFiles = new Set(filesChanged);
        const inter = [...agentFiles].filter((f) => refFiles.has(f));
        const uni = new Set([...agentFiles, ...refFiles]);
        const fileSetJaccard = uni.size ? inter.length / uni.size : 0;
        const workspaceToRef = await dirNumstat(workspace, REF_DIR);
        const distAgent = churn(workspaceToRef).total;
        const distPristine = refChurn.total;
        const finalStateCloseness = distPristine > 0 ? 1 - distAgent / distPristine : 0;

        const record = {
                ts: new Date().toISOString(),
                model,
                task: "clippad createdBy: string -> {id, name} sweep (benchmarks/longhorizon)",
                timeLimitMin: TIME_LIMIT_MIN,
                outcome: {
                        exitCode: agent.code,
                        timedOut: agent.timedOut,
                        saidDone: /\bDONE\b/.test(stdout.trim().split("\n").pop() ?? ""),
                },
                durationS,
                diff: {
                        filesChanged: filesChanged.length,
                        filesChangedList: filesChanged,
                        insertions: agentChurn.ins,
                        deletions: agentChurn.del,
                },
                tests: {
                        asIs: { pass: testsAsIs.pass, fail: testsAsIs.fail, exitCode: testsAsIs.code, parseFailed: testsAsIs.parseFailed ?? false, ...(testsAsIs.parseFailed ? { tail: testsAsIs.tail } : {}) },
                        pristineRestored: { pass: testsPristine.pass, fail: testsPristine.fail, exitCode: testsPristine.code, parseFailed: testsPristine.parseFailed ?? false, ...(testsPristine.parseFailed ? { tail: testsPristine.tail } : {}) },
                        agentEditedTests: editedTests,
                        agentAddedTests: newTests,
                },
                similarity: {
                        fileSetJaccard: Math.round(fileSetJaccard * 1000) / 1000,
                        finalStateCloseness: Math.round(finalStateCloseness * 1000) / 1000,
                        churnToReference: distAgent,
                        churnPristineToReference: distPristine,
                        note: "heuristic: jaccard over changed-file sets; closeness = 1 - lineChurn(workspace,reference)/lineChurn(pristine,reference). Formatting differences count; exact match not required.",
                },
                session,
                agentStdoutTail: stdout.trimEnd().split("\n").slice(-8).join("\n").slice(0, 2000),
                agentStderrTail: stderr.trimEnd().split("\n").slice(-8).join("\n").slice(0, 2000),
        };
        writeFileSync(join(modelDir, "receipt.json"), `${JSON.stringify(record, null, "\t")}\n`);
        appendFileSync(join(RESULTS_DIR, `${model}.jsonl`), `${JSON.stringify(record)}\n`);
        console.log(
                `[${model}] ${record.outcome.timedOut ? "TIMEOUT" : "finished"} in ${durationS}s | files ${filesChanged.length} (+${agentChurn.ins}/-${agentChurn.del}) | ` +
                        `tests asIs ${testsAsIs.pass}pass/${testsAsIs.fail}fail, pristine ${testsPristine.pass}pass/${testsPristine.fail}fail | ` +
                        `jaccard ${fileSetJaccard.toFixed(2)} closeness ${record.similarity.finalStateCloseness} | ` +
                        `tokens in/out ${session.input}/${session.output} | tools ${session.toolCalls} | compaction ${session.compactionEntries + session.compactionRuns.length}`,
        );
        // keep scratch small: receipts (patch, logs, json) live in results/
        rmSync(runRoot, { recursive: true, force: true });
        return record;
}

// ── calibration: score the reference the same way we score agents ───────────

async function phaseCalibrate() {
        mkdirSync(RESULTS_DIR, { recursive: true });
        const calibRoot = join(ROOT, "calibrate");
        rmSync(calibRoot, { recursive: true, force: true });
        mkdirSync(calibRoot, { recursive: true });

        const asIs = await runBunTest(REF_DIR);
        const withPristine = join(calibRoot, "reference-with-pristine-tests");
        copyTreeFiltered(REF_DIR, withPristine);
        rmSync(join(withPristine, "tests"), { recursive: true, force: true });
        cpSync(join(TASK_DIR, "tests"), join(withPristine, "tests"), { recursive: true });
        const pristine = await runBunTest(withPristine);

        const refNumstat = await dirNumstat(TASK_DIR, REF_DIR);
        const refChurn = churn(refNumstat);

        const calib = {
                ts: new Date().toISOString(),
                label: "reference calibration — the same metrics applied to the hand-written correct refactor",
                referenceTestsAsIs: { pass: asIs.pass, fail: asIs.fail, exitCode: asIs.code },
                referenceWithPristineTests: { pass: pristine.pass, fail: pristine.fail, exitCode: pristine.code },
                referenceDiff: { filesChanged: refNumstat.size, files: [...refNumstat.keys()].sort(), insertions: refChurn.ins, deletions: refChurn.del, churn: refChurn.total },
                note: "A PERFECT agent (files identical to the reference) scores: testsAsIs == referenceTestsAsIs, testsPristine == referenceWithPristineTests (the old-contract pins FAIL by design), fileSetJaccard 1.0, finalStateCloseness 1.0. A no-op agent scores 0.0 closeness, 0 files changed, testsAsIs 39/39 (pristine suite on pristine source) — which is why the diff metrics, not tests alone, carry the signal.",
        };
        writeFileSync(join(RESULTS_DIR, "calibration.json"), `${JSON.stringify(calib, null, "\t")}\n`);
        console.log(JSON.stringify(calib, null, 2));
        rmSync(calibRoot, { recursive: true, force: true });
        return calib;
}

// ── report ──────────────────────────────────────────────────────────────────

async function phaseReport() {
        mkdirSync(RESULTS_DIR, { recursive: true });
        const summary = { generatedAt: new Date().toISOString(), track: "longhorizon", models: {} };
        for (const model of MODELS) {
                const p = join(RESULTS_DIR, model, "receipt.json");
                if (!existsSync(p)) continue;
                summary.models[model] = JSON.parse(readFileSync(p, "utf8"));
        }
        const calibPath = join(RESULTS_DIR, "calibration.json");
        summary.calibration = existsSync(calibPath) ? JSON.parse(readFileSync(calibPath, "utf8")) : null;
        writeFileSync(join(RESULTS_DIR, "summary.json"), `${JSON.stringify(summary, null, "\t")}\n`);
        console.log(`wrote ${join(RESULTS_DIR, "summary.json")} (${Object.keys(summary.models).length} models)`);
}

// ── main ────────────────────────────────────────────────────────────────────

switch (PHASE) {
        case "run":
                if (!MODELS.includes(MODEL)) {
                        console.error(`--model required (one of ${MODELS.join(", ")})`);
                        process.exit(2);
                }
                await phaseRun(MODEL);
                break;
        case "calibrate":
                await phaseCalibrate();
                break;
        case "report":
                await phaseReport();
                break;
        case "all":
        default: {
                for (const model of MODELS) await phaseRun(model);
                await phaseCalibrate();
                await phaseReport();
                break;
        }
}
process.exit(0);
