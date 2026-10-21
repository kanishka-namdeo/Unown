#!/usr/bin/env node
/**
 * transfer-bench/runner.mjs — the cross-task memory-transfer benchmark
 * (2026-10-22 campaign, iteration 2; docs/testing-strategy.md §10 items A/B).
 *
 * THE QUESTION the existing suites cannot answer: does memory LEARNED on a
 * complex task A measurably help a RELATED-but-DIFFERENT complex task B —
 * and does CONSOLIDATED memory beat raw context at similar token volume?
 * (selfimprove v3 measured same-repo continuity; recall-qa measures Q&A;
 * nothing measures induce-on-A → test-on-B on real app-building work.)
 *
 * Protocol (per model, default via bridge = agnes-3.0-flash):
 *   induce   — N_A (default 3) COLD sessions on task A ("exprq": a JSON query
 *             language CLI — 54 hidden-test cases, byte-exact error contracts)
 *             in ONE repo. Sessions are memory-TEMPLATE (seed project.md
 *             only) so failures are honest cold failures; each session is
 *             asked to file notes (the production `note` tool) on the
 *             workflow lessons it hit.
 *   dream    — the production project dream consolidates A's notes into
 *             A's .unown/memory/project.md (engine :3030, real AutoDream,
 *             real guard). Snapshot kept.
 *   transfer — N_B (default 3) sessions per arm on task B ("csvrow": a CSV
 *             row filter CLI — 44 hidden-test cases, DIFFERENT error
 *             conventions so only workflow-level learning transfers):
 *               cold  — template user.md, no A knowledge.
 *               warm  — A's dreamed project.md HOISTED verbatim into the
 *                       user tier (the cross-project vehicle the docs
 *                       record as the natural home: ~/.unown/memory/user.md
 *                       under the arm's UNOWN_HOME). Simulates the
 *                       user-tier-dream path the review records as the fix
 *                       direction for cross-project carry-forward.
 *               notes — A's RAW session notes dropped as a context file in
 *                       B's repo, same prompt pointer. The matched-context
 *                       control (§10 A): separates "consolidation adds
 *                       value" from "more context adds value".
 *   score    — hidden tests restored PRISTINE, run per repo: fraction of
 *             individual cases passing (not just all-green) + allgreen flag.
 *   report   — per-arm: casePassRate mean, allGreen rate, input/output tokens,
 *             duration; dream audit snapshot; the transfer deltas.
 *
 * Anti-tamper (polyglot/v3 discipline): tests are read-only (0444) during
 * sessions, restored pristine before scoring.
 *
 * Resume-safe: results append to results/<model>.jsonl keyed (phase,arm,idx).
 *
 * Usage:
 *   bun runner.mjs --phase setup
 *   bun runner.mjs --phase induce
 *   bun runner.mjs --phase dream
 *   bun runner.mjs --phase transfer
 *   bun runner.mjs --phase report
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
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const HERE = dirname(new URL(import.meta.url).pathname);
const ROOT = process.env.BENCH_ROOT ?? "/home/z/my-project/scratch-mem/transfer-bench";
const RESULTS = join(ROOT, "results");
const UNOWN_BIN = process.env.UNOWN_BIN ?? join(homedir(), ".local", "bin", "unown");
const ENGINE = process.env.UNOWN_ENGINE_URL ?? "http://127.0.0.1:3030";
const ENGINE_TOKEN = readFileSync(
        process.env.UNOWN_ENGINE_TOKEN_FILE ?? "/home/z/my-project/repos/Unown/data/self-learning/engine.token",
        "utf8",
).trim();
const MODEL = process.argv.includes("--model")
        ? process.argv[process.argv.indexOf("--model") + 1]
        : process.env.PI_MODEL_ID ?? "agnes-3.0-flash";
const PHASE = process.argv.includes("--phase") ? process.argv[process.argv.indexOf("--phase") + 1] : "run";
const N_A = Number(process.env.INDUCE_RUNS ?? 3);
const N_B = Number(process.env.TRANSFER_RUNS ?? 3);
const SESSION_TIMEOUT_MS = Number(process.env.SESSION_TIMEOUT_MS ?? 7 * 60_000);
const HOME = homedir();
const TOOL_PATH = [join(HOME, ".local", "bin"), process.env.PATH].join(":");

const FIXTURE_A = join(HERE, "fixtures", "task-a");
const FIXTURE_B = join(HERE, "fixtures", "task-b");

// One benchmark instance per ROOT: two concurrent phases clobbered repos and
// interleaved notes once already (the 2026-10-22 induce race). A live-pid
// lockfile refuses the second instance.
import { writeFileSync as _wf } from "node:fs";
const LOCK = join(ROOT, ".bench.lock");
mkdirSync(ROOT, { recursive: true });
if (existsSync(LOCK)) {
        const holder = Number(readFileSync(LOCK, "utf8").trim());
        let alive = false;
        try {
                process.kill(holder, 0);
                alive = true;
        } catch {}
        if (alive) {
                console.error(`[lock] another transfer-bench instance (pid ${holder}) owns ${ROOT} — refusing to start`);
                process.exit(3);
        }
}
_wf(LOCK, String(process.pid));
process.on("exit", () => {
        try {
                rmSync(LOCK, { force: true });
        } catch {}
});

const repoA = () => join(ROOT, "repoA");
const repoB = (arm, i) => join(ROOT, `repoB-${arm}-${i}`);
const unownHomeOf = (arm, i) => join(ROOT, `unown-home-${arm}-${i}`);
const aHome = (i) => join(ROOT, `unown-home-A-${i}`);

const MEMORY_TEMPLATE = `# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
(empty — AutoDream fills this from session notes)

## Known pitfalls
(empty)
`;

const USER_TEMPLATE = `# Tier 2 — User Memory

## Preferences
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

function runAgentSession(prompt, cwd, unownHome, logBase, timeoutMs = SESSION_TIMEOUT_MS) {
        return new Promise((resolveRun) => {
                const child = spawn(UNOWN_BIN, ["-p", "--model", `bridge/${MODEL}`, prompt], {
                        cwd,
                        env: { ...process.env, PATH: TOOL_PATH, UNOWN_HOME: unownHome, UNOWN_ENGINE_TOKEN: ENGINE_TOKEN },
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
                        resolveRun({ code: code ?? -1, out, err, timedOut: signal === "SIGKILL" });
                };
                child.on("error", (e) => {
                        err += `\n${String(e)}`;
                        finish(-1, null);
                });
                child.on("close", finish);
        });
}

/** Token usage of sessions opened in `cwd` since startMs, from the arm's UNOWN_HOME session store. */
function sessionUsage(unownHome, cwd, startMs) {
        const sessDir = join(unownHome, "agent", "sessions");
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
                headers: {
                        ...(body !== undefined ? { "content-type": "application/json" } : {}),
                        authorization: `Bearer ${ENGINE_TOKEN}`,
                },
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(300_000),
        });
        const json = await res.json().catch(() => ({}));
        return { status: res.status, json };
}

/** The engine's slug for a project path (mirrors src/term.ts slugifyPath). */
function slugify(p) {
        return p.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "root";
}

// ---------------------------------------------------------------------------
// Fixtures -> repos
// ---------------------------------------------------------------------------

function prepTaskA() {
        const dir = repoA();
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(join(dir, "src"), { recursive: true });
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "exprq", private: true }, null, 2));
        const test = readFileSync(join(FIXTURE_A, "tests", "exprq.test.mjs"));
        writeFileSync(join(dir, "exprq.test.mjs"), test);
        chmodSync(join(dir, "exprq.test.mjs"), 0o444);
        mkdirSync(join(dir, ".unown", "memory"), { recursive: true });
        writeFileSync(join(dir, ".unown", "memory", "project.md"), MEMORY_TEMPLATE);
        return dir;
}

function prepTaskB(arm, i) {
        const dir = repoB(arm, i);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(join(dir, "src"), { recursive: true });
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "csvrow", private: true }, null, 2));
        const test = readFileSync(join(FIXTURE_B, "tests", "csvrow.test.mjs"));
        writeFileSync(join(dir, "csvrow.test.mjs"), test);
        chmodSync(join(dir, "csvrow.test.mjs"), 0o444);
        mkdirSync(join(dir, ".unown", "memory"), { recursive: true });
        writeFileSync(join(dir, ".unown", "memory", "project.md"), MEMORY_TEMPLATE);
        if (arm === "notes") {
                // raw A notes as a context file (the matched-context control)
                const notesFile = join(ROOT, "results", "a-notes-raw.md");
                if (existsSync(notesFile)) cpSync(notesFile, join(dir, "related-project-notes.md"));
        }
        return dir;
}

function setupHome(unownHome) {
        rmSync(unownHome, { recursive: true, force: true });
        mkdirSync(unownHome, { recursive: true });
        mkdirSync(join(unownHome, "memory"), { recursive: true });
        writeFileSync(join(unownHome, "memory", "user.md"), USER_TEMPLATE);
        return unownHome;
}

function hoistDreamToUser(unownHome) {
        const dreamed = readFileSync(join(repoA(), ".unown", "memory", "project.md"), "utf8");
        mkdirSync(join(unownHome, "memory"), { recursive: true });
        writeFileSync(join(unownHome, "memory", "user.md"), dreamed);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

async function scoreRepo(dir, testFile) {
        // restore pristine before scoring (anti-tamper)
        const pristine = readFileSync(join(dirname(testFile), testFile.split("/").pop()));
        chmodSync(join(dir, testFile.split("/").pop()), 0o644);
        writeFileSync(join(dir, testFile.split("/").pop()), pristine);
        chmodSync(join(dir, testFile.split("/").pop()), 0o444);
        const r = await run("node", [testFile.split("/").pop()], { cwd: dir, timeoutMs: 90_000, env: { ...process.env, PATH: TOOL_PATH } });
        const okLines = (r.out.match(/case \d+: ok/g) ?? []).length;
        const failLines = (r.out.match(/case \d+: FAIL/g) ?? []).length;
        const total = okLines + failLines;
        return {
                allGreen: r.code === 0 && failLines === 0 && total > 0,
                casesPass: okLines,
                casesTotal: total,
                casePassRate: total ? Number((okLines / total).toFixed(3)) : 0,
                tail: r.out.split("\n").slice(-3).join("\n").slice(0, 200),
        };
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function specOf(fixture) {
        return readFileSync(join(fixture, "spec.md"), "utf8");
}

function inducePrompt() {
        const spec = specOf(FIXTURE_A);
        return `You are building a real utility called exprq from its spec, in this repo.

<spec>
${spec}
</spec>

Files here: package.json, src/ (empty — you create the modules), and the
read-only test file exprq.test.mjs (the ground truth; run it with
\`node exprq.test.mjs\`).

Work loop: read the spec carefully, implement, run the tests, fix, repeat.
Tests are READ-ONLY — never edit them. Iterate until green or until you
cannot improve; every byte of output and error text matters.

Before finishing, use the note tool to file 2-4 concise lessons a future
session in a RELATED project would benefit from (workflow gotchas,
byte-exactness lessons, spec-reading discipline) — durable engineering
lessons, not exprq trivia.

When done (or stuck), reply exactly: DONE`;
}

function transferPrompt() {
        const spec = specOf(FIXTURE_B);
        return `You are building a real utility called csvrow from its spec, in this repo.

<spec>
${spec}
</spec>

Files here: package.json, src/ (empty — you create the modules), and the
read-only test file csvrow.test.mjs (the ground truth; run it with
\`node csvrow.test.mjs\`).

Work loop: read the spec carefully, implement, run the tests, fix, repeat.
Tests are READ-ONLY — never edit them. Iterate until green or until you
cannot improve; every byte of output and error text matters.

NOTE: this project's error-message convention is DIFFERENT from anything you
remember from other projects — the spec and the tests define it; follow them
exactly.

When done (or stuck), reply exactly: DONE`;
}

function transferPromptNotes() {
        return (
                transferPrompt() +
                `\n\nA context file \`related-project-notes.md\` sits in this repo: raw
session notes from a DIFFERENT but related project another agent worked on.
It is provided as reference material only.`
        );
}

// ---------------------------------------------------------------------------
// Results record
// ---------------------------------------------------------------------------

function recordPath() {
        return join(RESULTS, `${MODEL}.jsonl`);
}
function doneKeys() {
        const f = recordPath();
        if (!existsSync(f)) return new Set();
        return new Set(
                readFileSync(f, "utf8")
                        .split("\n")
                        .filter(Boolean)
                        .map((l) => JSON.parse(l))
                        .map((r) => `${r.phase}:${r.arm ?? "a"}:${r.idx}`),
        );
}
function appendRecord(rec) {
        mkdirSync(RESULTS, { recursive: true });
        appendFileSync(recordPath(), JSON.stringify(rec) + "\n");
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

async function phaseSetup() {
        mkdirSync(ROOT, { recursive: true });
        mkdirSync(join(ROOT, "logs"), { recursive: true });
        mkdirSync(RESULTS, { recursive: true });
        // provider config for every UNOWN_HOME the benchmark uses
        const homes = [aHome(0)];
        for (let i = 0; i < N_B; i++) for (const arm of ["cold", "warm", "notes"]) homes.push(unownHomeOf(arm, i));
        for (const h of homes) {
                setupHome(h);
                if (!existsSync(join(h, "agent", "models.json"))) {
                        const r = await run(UNOWN_BIN, ["setup", "--provider", "bridge", "--model", MODEL, "--force"], {
                                cwd: ROOT,
                                env: { ...process.env, PATH: TOOL_PATH, UNOWN_HOME: h, UNOWN_ENGINE_TOKEN: ENGINE_TOKEN },
                                timeoutMs: 120_000,
                        });
                        if (r.code !== 0) throw new Error(`unown setup failed for ${h}: ${r.out}${r.err}`);
                }
        }
        prepTaskA();
        for (let i = 0; i < N_B; i++) for (const arm of ["cold", "warm", "notes"]) prepTaskB(arm, i);
        console.log(`[setup] ${ROOT} ready (model ${MODEL}, ${N_A} induce runs, ${N_B} runs per transfer arm)`);
}

async function phaseInduce() {
        const done = doneKeys();
        for (let i = 0; i < N_A; i++) {
                if (done.has(`induce:a:${i}`)) {
                        console.log(`[skip] induce a:${i}`);
                        continue;
                }
                const dir = repoA();
                const home = aHome(i);
                // reset project memory to template so each induce run is cold
                writeFileSync(join(dir, ".unown", "memory", "project.md"), MEMORY_TEMPLATE);
                const startMs = Date.now();
                const agent = await runAgentSession(inducePrompt(), dir, home, join(ROOT, "logs", `induce-a${i}`));
                const score = await scoreRepo(dir, join(FIXTURE_A, "tests", "exprq.test.mjs"));
                const usage = sessionUsage(home, dir, startMs);
                appendRecord({
                        ts: new Date().toISOString(),
                        phase: "induce",
                        arm: "a",
                        idx: i,
                        model: MODEL,
                        ...score,
                        agentTimedOut: agent.timedOut,
                        durationS: Math.round((Date.now() - startMs) / 1000),
                        tokens: usage,
                });
                console.log(
                        `  ${score.allGreen ? "✓" : "✗"} induce a:${i} — cases ${score.casesPass}/${score.casesTotal} (${score.casePassRate}), ${Math.round((Date.now() - startMs) / 1000)}s, in=${usage.input}`,
                );
        }
}

async function phaseDream() {
        // A's notes are in the engine with project_path=<abs repoA>; trigger the
        // auto-dream job and await THIS project's memory change (v3 pattern).
        const memPath = join(repoA(), ".unown", "memory", "project.md");
        const before = existsSync(memPath) ? readFileSync(memPath, "utf8") : "";
        let trigger = null;
        for (let k = 0; k < 6; k++) {
                trigger = await api("POST", "/api/jobs/auto-dream/trigger", {});
                if (trigger.status === 200) break;
                console.log(`  [dream] engine busy (${trigger.status}), retrying in 10s...`);
                await new Promise((r) => setTimeout(r, 10_000));
        }
        if (trigger.status !== 200) throw new Error(`dream trigger failed: ${trigger.status}`);
        const deadline = Date.now() + 120_000;
        let after = before;
        while (Date.now() < deadline) {
                after = existsSync(memPath) ? readFileSync(memPath, "utf8") : "";
                if (after !== before && after.trim().length > 0) break;
                await new Promise((r) => setTimeout(r, 3_000));
        }
        const changed = after !== before;
        mkdirSync(RESULTS, { recursive: true });
        writeFileSync(join(RESULTS, "a-dream-memory.md"), after);
        if (changed) console.log("[dream] A's project memory updated (snapshot in results/a-dream-memory.md)");
        else console.log("[dream] memory unchanged — check engine logs; the notes may have been consumed earlier");
        // Also snapshot the raw notes this benchmark fed the dream (audit + notes arm).
        try {
                const { Database } = await import("bun:sqlite");
                const { resolveEngineDb } = await import("./engine-db.mjs");
                const db = new Database(resolveEngineDb(ROOT));
                try {
                        const rows = db
                                .query(`SELECT content, created_at FROM notes WHERE project_slug = ? AND kind = 'terminal' ORDER BY created_at`)
                                .all(slugify(repoA()));
                        const raw = rows.map((r) => `--- note (${new Date(r.created_at).toISOString()}) ---\n${r.content}`).join("\n\n");
                        writeFileSync(join(RESULTS, "a-notes-raw.md"), raw);
                        console.log(`[dream] ${rows.length} terminal note(s) snapshotted for the notes arm`);
                } finally {
                        db.close();
                }
        } catch (err) {
                console.log(`[dream] notes snapshot unavailable: ${err?.message ?? err}`);
        }
        return changed;
}

async function phaseTransfer() {
        // the warm arm needs the dream; the notes arm needs the notes snapshot
        const dreamed = existsSync(join(RESULTS, "a-dream-memory.md"));
        const rawNotes = existsSync(join(RESULTS, "a-notes-raw.md"));
        if (!dreamed) console.log("[transfer] WARNING: no dream snapshot — warm arms run with template memory");
        if (!rawNotes) console.log("[transfer] WARNING: no notes snapshot — notes arms get no context file");
        const done = doneKeys();
        const order = [];
        for (const arm of ["cold", "warm", "notes"]) for (let i = 0; i < N_B; i++) order.push([arm, i]);
        for (const [arm, i] of order) {
                if (done.has(`transfer:${arm}:${i}`)) {
                        console.log(`[skip] transfer ${arm}:${i}`);
                        continue;
                }
                const dir = repoB(arm, i);
                const home = unownHomeOf(arm, i);
                // reset repoB state: fresh fixture + template project memory
                prepTaskB(arm, i);
                // arm memory injection
                setupHome(home);
                if (arm === "warm" && dreamed) hoistDreamToUser(home);
                const prompt = arm === "notes" ? transferPromptNotes() : transferPrompt();
                const startMs = Date.now();
                const agent = await runAgentSession(prompt, dir, home, join(ROOT, "logs", `transfer-${arm}${i}`));
                const score = await scoreRepo(dir, join(FIXTURE_B, "tests", "csvrow.test.mjs"));
                const usage = sessionUsage(home, dir, startMs);
                appendRecord({
                        ts: new Date().toISOString(),
                        phase: "transfer",
                        arm,
                        idx: i,
                        model: MODEL,
                        ...score,
                        agentTimedOut: agent.timedOut,
                        durationS: Math.round((Date.now() - startMs) / 1000),
                        tokens: usage,
                });
                console.log(
                        `  ${score.allGreen ? "✓" : "✗"} transfer ${arm}:${i} — cases ${score.casesPass}/${score.casesTotal} (${score.casePassRate}), ${Math.round((Date.now() - startMs) / 1000)}s, in=${usage.input}`,
                );
        }
}

function phaseReport() {
        const f = recordPath();
        if (!existsSync(f)) throw new Error("no records — run the phases first");
        const records = readFileSync(f, "utf8")
                .split("\n")
                .filter(Boolean)
                .map((l) => JSON.parse(l));
        const induce = records.filter((r) => r.phase === "induce");
        const agg = (list) => {
                if (!list.length) return null;
                const mean = (fn) => Number((list.reduce((a, r) => a + fn(r), 0) / list.length).toFixed(3));
                return {
                        n: list.length,
                        allGreenRate: mean((r) => (r.allGreen ? 1 : 0)),
                        casePassRateMean: mean((r) => r.casePassRate),
                        inputTokensMean: Math.round(list.reduce((a, r) => a + r.tokens.input, 0) / list.length),
                        outputTokensMean: Math.round(list.reduce((a, r) => a + r.tokens.output, 0) / list.length),
                        durationSMean: Math.round(list.reduce((a, r) => a + r.durationS, 0) / list.length),
                        timeouts: list.filter((r) => r.agentTimedOut).length,
                };
        };
        const summary = {
                model: MODEL,
                label: `cross-task transfer: ${N_A} cold induce sessions on task A (exprq) -> production dream -> ${N_B} sessions per arm on task B (csvrow): cold vs warm (A's dreamed memory in the user tier) vs notes (A's raw notes as context)`,
                generatedAt: new Date().toISOString(),
                induce: agg(induce),
                arms: {
                        cold: agg(records.filter((r) => r.phase === "transfer" && r.arm === "cold")),
                        warm: agg(records.filter((r) => r.phase === "transfer" && r.arm === "warm")),
                        notes: agg(records.filter((r) => r.phase === "transfer" && r.arm === "notes")),
                },
        };
        const d = (a, b, key) => (a && b ? Number((a[key] - b[key]).toFixed(3)) : null);
        summary.deltas = {
                warmVsCold: {
                        casePassRate: d(summary.arms.warm, summary.arms.cold, "casePassRateMean"),
                        allGreenRate: d(summary.arms.warm, summary.arms.cold, "allGreenRate"),
                        inputTokens: d(summary.arms.warm, summary.arms.cold, "inputTokensMean"),
                },
                warmVsNotes: {
                        casePassRate: d(summary.arms.warm, summary.arms.notes, "casePassRateMean"),
                        allGreenRate: d(summary.arms.warm, summary.arms.notes, "allGreenRate"),
                },
                notesVsCold: {
                        casePassRate: d(summary.arms.notes, summary.arms.cold, "casePassRateMean"),
                        allGreenRate: d(summary.arms.notes, summary.arms.cold, "allGreenRate"),
                },
        };
        mkdirSync(RESULTS, { recursive: true });
        writeFileSync(join(RESULTS, "summary.json"), JSON.stringify(summary, null, 2));
        console.log(JSON.stringify(summary, null, 2));
}

switch (PHASE) {
        case "setup":
                await phaseSetup();
                break;
        case "induce":
                await phaseInduce();
                break;
        case "dream":
                await phaseDream();
                break;
        case "transfer":
                await phaseTransfer();
                break;
        case "report":
                phaseReport();
                break;
        default:
                console.error("unknown phase; use --phase setup|induce|dream|transfer|report");
                process.exit(2);
}
