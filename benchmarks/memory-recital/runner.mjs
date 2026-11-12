#!/usr/bin/env bun
/**
 * memory-recital/runner.mjs — the REAL-USER memory benchtest (the Recital
 * round's permanent lane, 2026-11-11): drive the agent like a real user on
 * complex tasks in a scratch project, let the note pipeline capture what it
 * captures, dream through the engine, and score fresh-session recall —
 * warm (memory injected) vs cold (a fresh clone with no `.unown/`).
 *
 * The distinguishing contract vs benchmarks/memory-eval/recall-qa: the
 * sessions here are REAL `unown -p` runs doing real work (the fixture's
 * planted CSV-parser defect is actually fixed, the knowledge updates are
 * actually applied), so the whole loop is measured as the user experiences
 * it — exit-note capture, the mid-session `note` tool, dream consolidation,
 * next-session injection, fresh-session recall — not just the dream-side
 * plumbing.
 *
 * Scenario battery (LongMemEval's five abilities, driven live):
 *   S1 complex debugging   — fix the planted quoted-CSV defect (+3 tests)
 *   S2 knowledge update    — strict ISO date validation + render auto-sizing
 *   S3 reversal+pref+temporal — drop the strict rule (contradiction), state
 *                            the comment-style convention (preference),
 *                            record the dated switch (temporal)
 *   QA battery             — T1 temporal, T2 multi-hop history,
 *                            T3 knowledge-update, T4 preference,
 *                            T5 abstention — asked in FRESH memory-only
 *                            sessions, warm + cold arms
 *   Edge probes (--edge)  — concurrent sessions both land; engine-down →
 *                            outbox → restart → drain; the contamination
 *                            probe (dreaming the QA notes must add nothing
 *                            false)
 *
 * Scoring (judge-free, recall-qa's matcher semantics — copied, never
 * imported from sibling benchmarks): content-word overlap ≥ 0.6 of the
 * expected answer in the response, or a 4-word phrase hit. T5 abstention
 * scores HONESTY: pass iff the response does not fabricate (no fabricated
 * benchmark/library claim) and contains an abstention marker. The
 * headline is warm pass − cold pass (memory must beat no-memory) with the
 * cold arm's hallucinations counted as cold failures (the live baseline
 * showed cold T3/T4 hallucinate confidently — memory is what prevents
 * that).
 *
 * Resume-safe: probes with an existing receipt are skipped. The scratch
 * project lives in the OS tmpdir (per-run tag) and is git-clean per phase
 * so a resume re-uses the exact on-disk state.
 * Usage: bun runner.mjs [--fresh] [--dry] [--edge] [--limit N]
 *   --dry  : no-LLM smoke lane — fixture materialization, the engine/bridge
 *            health checks, the scoring matcher self-test, receipt-shape
 *            checks over any existing receipts. Zero sessions, zero dreams,
 *            exits non-zero on plumbing errors.
 *   --edge : additionally run the concurrency/outbox/contamination probes
 *            (the outbox probe restarts the engine).
 * Requires: the engine on :3030 + the llm-bridge on :3031 live (checked
 * before any session), `unown` on PATH (the repo's bin/), git.
 * Receipts: results/<model>/per-probe/*.json + results/<model>/summary.json
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const HERE = dirname(new URL(import.meta.url).pathname);
const ROOT = join(HERE, "..", "..");
const FIXTURE = join(HERE, "fixture");
const MODEL = process.env.PI_MODEL_ID ?? "agnes-3.0-flash";
const RESULTS = join(HERE, "results", MODEL);
const PER_PROBE = join(RESULTS, "per-probe");
const TAG = process.env.RECITAL_TAG ?? "live";
const SCRATCH = join(tmpdir(), `memory-recital-${TAG}`);

const ENGINE_URL = process.env.UNOWN_ENGINE_URL ?? "http://127.0.0.1:3030";
const BRIDGE_URL = process.env.PI_BRIDGE_URL ?? "http://127.0.0.1:3031";
const UNOWN = process.env.UNOWN_BIN ?? join(ROOT, "bin", "unown");
const SESSION_TIMEOUT_MS = Number(process.env.RECITAL_SESSION_TIMEOUT_MS ?? 540_000);
const DREAM_WAIT_MS = Number(process.env.RECITAL_DREAM_WAIT_MS ?? 75_000);

const log = (msg) => console.log(`[recital] ${msg}`);
const now = () => new Date().toISOString();

// ---------------------------------------------------------------- the corpus

/** The five probes: LongMemEval's abilities, one expected answer each. */
const PROBES = [
        {
                id: "T1-temporal",
                ability: "temporal reasoning",
                question:
                        "Answer from the project memory/context ONLY (do not read source files, do not run tools): When did the render lane of this project switch from fixed column widths to auto-sizing? One line.",
                expected: "2026-11-05",
        },
        {
                id: "T2-history",
                ability: "multi-session reasoning (history)",
                question:
                        "Answer from the project memory/context ONLY (do not read source files, do not run tools): Why was the CSV parser rewritten, and what was the original defect? One line.",
                expected: "naive comma splitting broke quoted fields",
        },
        {
                id: "T3-knowledge-update",
                ability: "knowledge update (current contract)",
                question:
                        "Answer from the project memory/context ONLY (do not read source files, do not run tools): What is the CURRENT date-validation contract in validateRows, and what was it before? One line.",
                expected: "empty dates accepted any parseable date strict ISO removed",
        },
        {
                id: "T4-preference",
                ability: "preference (stated convention)",
                question:
                        "Answer from the project memory/context ONLY (do not read source files, do not run tools): What comment style do I require in this repo? One line.",
                expected: "sentence case no trailing periods",
        },
        {
                id: "T5-abstention",
                ability: "abstention (knowing what memory does not know)",
                question:
                        "Answer from the project memory/context ONLY (do not read source files, do not run tools): Which library did we benchmark keel against last week? One line.",
                expected: null, // scored on honesty: an abstention marker, no fabrication
        },
];

const SESSIONS = [
        {
                id: "S1-debug",
                prompt:
                        "Run the test suite for this repo. The 'quoted commas survive' test is failing — investigate why, fix the parser properly (quoted CSV fields must survive, including escaped quotes and quoted fields containing newlines), add tests for: a quoted field with a comma, a quoted field with an escaped double-quote, and a quoted field spanning a newline. Make all tests pass.",
        },
        {
                id: "S2-knowledge-update",
                prompt:
                        "Two tasks: (1) Business decision: validateRows must now also check the date column — dates must be strict ISO YYYY-MM-DD and rejected otherwise, with the row error 'row N: date must be YYYY-MM-DD'. Add tests for a valid date, a missing date, and 'Jan 5 2026' being rejected. (2) Also update renderTable to use column auto-sizing (width = max cell length per column, minimum 4) instead of the fixed widths array. Make all tests pass.",
        },
        {
                id: "S3-reversal-pref-temporal",
                prompt:
                        "Three things. (1) REVERSAL: the strict ISO date validation we added earlier is being dropped — it was too aggressive for the ledger import lane. Dates may now be empty (treated as unspecified) and any parseable date is accepted; remove the strict date rejection from validateRows and update tests accordingly (keep the 3-column and numeric-amount checks). (2) PREFERENCE: from now on in this repo, I want all code comments written in sentence case with no trailing periods — apply that style to the existing comments now. (3) RECORD: for the record, note that on 2026-11-05 the team switched the render lane from fixed column widths to auto-sizing. Make all tests pass.",
        },
];

// ------------------------------------------------------------ the plumbing

function engineToken() {
        for (const p of [join(ROOT, "data", "self-learning", "engine.token"), join(process.env.UNOWN_HOME ?? join(process.env.HOME ?? "~", ".unown"), "engine.token")]) {
                try {
                        return readFileSync(p, "utf8").trim();
                } catch {}
        }
        return null;
}

async function api(path, init) {
        const token = engineToken();
        const res = await fetch(`${ENGINE_URL}${path}`, {
                ...init,
                headers: { ...(init?.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        const body = await res.text();
        let json = null;
        try {
                json = JSON.parse(body);
        } catch {}
        return { ok: res.ok, status: res.status, json, body };
}

async function checkServices() {
        const bridge = await fetch(`${BRIDGE_URL}/health`).then((r) => r.json()).catch(() => null);
        if (!bridge?.ok) throw new Error(`llm-bridge not healthy on ${BRIDGE_URL} (run: bun run agent:start)`);
        const engine = await api("/api/health").catch(() => null);
        if (!engine?.ok || engine?.json?.phase !== "ready")
                throw new Error(`engine not ready on ${ENGINE_URL} (run: bun run agent:start)`);
        // The Memory Encore round's live re-runs found the hard way that a
        // budget-throttled governor stretches a dream past any sane wait: the
        // engine lane's extraction calls sit in breaker backoff while the
        // runner polls for a project row that is queued behind the mutex. A
        // suite needs ~10-25 engine LLM calls of headroom under the default
        // 60/hour cap; fail FAST with the actionable cure instead of hanging
        // ten minutes into the sessions.
        const overview = await api("/api/overview").catch(() => null);
        const budget = overview?.json?.budget;
        if (budget?.overBudget) {
                throw new Error(
                        `engine governor is throttled (${budget.reason}) — wait for the rolling hour to cool down, or raise PI_ENGINE_MAX_CALLS_HOUR for the bench lane and restart the stack`,
                );
        }
        if (budget && typeof budget.limits?.callsHour === "number" && budget.callsHour > budget.limits.callsHour - 10) {
                console.error(`[recital] warning: only ${budget.limits.callsHour - budget.callsHour} engine call(s) of hourly headroom left — the suite may throttle mid-flight`);
        }
        return { bridge, engine: engine.json };
}

/** Run one REAL unown print-mode session in cwd (the V-1 stdin law: /dev/null). */
function runSession(cwd, prompt) {
        return new Promise((resolve) => {
                const child = spawn(UNOWN, ["-p", prompt], { cwd, stdio: ["ignore", "pipe", "pipe"] });
                let out = "";
                child.stdout.on("data", (d) => (out += d.toString()));
                child.stderr.on("data", (d) => (out += d.toString()));
                const timer = setTimeout(() => child.kill("SIGKILL"), SESSION_TIMEOUT_MS);
                child.on("close", (code, signal) => {
                        clearTimeout(timer);
                        resolve({ code, signal, out });
                });
        });
}

/** Materialize the fixture into a fresh scratch project (git-init'd). */
function materialize(dir) {
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(join(dir, "src"), { recursive: true });
        mkdirSync(join(dir, "test"), { recursive: true });
        cpSync(join(FIXTURE, "package.json"), join(dir, "package.json"));
        cpSync(join(FIXTURE, "src-parse.ts"), join(dir, "src", "parse.ts"));
        cpSync(join(FIXTURE, "src-validate.ts"), join(dir, "src", "validate.ts"));
        cpSync(join(FIXTURE, "src-render.ts"), join(dir, "src", "render.ts"));
        cpSync(join(FIXTURE, "test-parse.ts"), join(dir, "test", "parse.test.ts"));
        cpSync(join(FIXTURE, "test-validate.ts"), join(dir, "test", "validate.test.ts"));
        execFileSync("git", ["init", "-q"], { cwd: dir });
        execFileSync("git", ["add", "-A"], { cwd: dir });
        execFileSync("git", ["commit", "-qm", "keel v0.1.0 (memory-recital fixture)"], { cwd: dir });
        return dir;
}

/** Trigger a dream and wait for OUR project's dream receipt; returns its row.
 *
 * The Memory Encore round's live re-run (2026-11-11) caught the race this
 * guard closes: the manual trigger is fire-and-forget and runs the ENGINE
 * dream first, whose row is inserted AT START (status running) — but a
 * PROJECT dream's row is inserted only AT ITS END (dream.ts writes the
 * receipt row on completion, started_at backdated). Polling "newest row is
 * done" therefore returns in the window BETWEEN the engine dream finishing
 * and the project dream's row existing: the S3 → T1 sequence probed v1 of
 * the project memory while v2 was still rendering (T1 warm-answered "no
 * memory of a render lane change" against a file that had it 54 s later).
 *
 * The guard: wait until a project row whose note names OUR project path has
 * ENDED after the newest of OUR notes (every project-dream outcome — done/
 * gated/pending/error/no-substantive — inserts one, and the note carries the
 * path). The other rows do not matter: another project's dream running after
 * ours does not un-render our file. The budget (600 s) covers a dirty engine
 * whose single mutex serializes other projects' backlogs and the engine
 * lane's canaries ahead of our row.
 *
 * The Encore round's SECOND live re-run (2026-11-12) caught the sibling
 * race: the auto dream-check (event: run:finished) can consume our notes
 * BEFORE the manual trigger fires — its project row then ends BEFORE the
 * trigger, the "ended after this call" anchor never matches, and the wait
 * starves its full 600 s budget against a queue that has nothing left for
 * us (the follow-on E2 wait then starves the same way: every note of ours
 * is dreamt, the floor sits at the consuming row's own end, and a
 * governor-throttled engine lands no new row at all). Two exits close the
 * class. (1) The row anchor is re-based on the NOTES: a row counts iff it
 * ended after the newest note of ours it could have consumed, re-read
 * every poll — a pre-trigger consumer counts, and a note still in flight
 * at trigger time keeps raising the bar until the row that consumes IT
 * lands (the S3→T1 shape stays guarded: the probe cannot run against a
 * render that predates the note it must reflect). (2) The SETTLE exit:
 * when every note of ours is dreamt by a project dream that ENDED after
 * our newest note, the consolidation this wait exists for has provably
 * happened — dream rows are written after the render they receipt, so the
 * file the next phase reads already reflects the dream; the exit requires
 * two consecutive stable polls so an in-flight note landing mid-check
 * re-anchors through the row path instead. */
async function dreamAndWait(cwd) {
        const snapshotBefore = await api("/api/dreams?limit=100");
        const beforeEnd = Math.max(
                0,
                ...(snapshotBefore.json?.dreams ?? []).map((r) => r.ended_at ?? 0),
        );
        const noteFloorOf = (notes) =>
                Math.max(
                        0,
                        ...(notes ?? [])
                                .filter((n) => n.project_path === cwd)
                                .map((n) => n.created_at ?? 0),
                );
        const started = await api("/api/dreams/run", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        if (started.json?.skipped) return started.json; // no undreamed notes — nothing will land; the honest fast path (E2's second call)
        if (!started.ok) {
                // engine-busy: an auto-dream is already running — wait it out.
                await Bun.sleep(DREAM_WAIT_MS);
        }
        let settledOnce = false;
        for (let i = 0; i < 120; i++) {
                await Bun.sleep(5_000);
                const [d, n] = await Promise.all([api("/api/dreams?limit=100"), api("/api/notes?limit=100")]);
                const rows = d.json?.dreams ?? [];
                const ourNotes = (n.json?.notes ?? []).filter((x) => x.project_path === cwd);
                // The floor: whichever is later — a row ending after the call
                // started, or a row ending after the newest note of ours a
                // dream could have consumed (the pre-trigger consumer counts;
                // an in-flight note re-raises the bar until consumed).
                const floor = Math.max(beforeEnd, noteFloorOf(ourNotes));
                const ours = rows.find(
                        (r) =>
                                String(r.id ?? "").startsWith("project-") &&
                                (r.ended_at ?? 0) > floor &&
                                String(r.note ?? "").includes(cwd),
                );
                if (ours && ours.status !== "running" && ours.ended_at) return ours;
                // The settle exit: every note of ours was consumed by a project
                // dream that ended after our newest note — the render is on disk
                // (rows are written after the render they receipt); nothing this
                // wait exists for remains pending. Two consecutive stable polls
                // guard the in-flight-note window.
                const newestNote = ourNotes.reduce((m, x) => Math.max(m, x.created_at ?? 0), 0);
                const projectDreamEnds = ourNotes
                        .filter((x) => String(x.dream_id ?? "").startsWith("project-"))
                        .map((x) => rows.find((r) => r.id === x.dream_id)?.ended_at ?? 0);
                const settled =
                        ourNotes.length > 0 &&
                        projectDreamEnds.length === ourNotes.length &&
                        Math.max(...projectDreamEnds) > newestNote;
                if (settled && settledOnce)
                        return { settled: true, note: `consolidation already complete for ${cwd} (every note dreamt)` };
                settledOnce = settled;
        }
        const lastNotes = await api("/api/notes?limit=100");
        throw new Error(
                `dream for ${cwd} never finished (waited 600s) — ` +
                        `last note floor ${new Date(noteFloorOf(lastNotes.json?.notes)).toISOString()}; ` +
                        `if the engine governor throttled mid-suite, wait for the rolling hour and re-run (receipts resume)`,
        );
}

// ------------------------------------------------------------- the scorer

function contentWords(s) {
        return String(s ?? "")
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, " ")
                .split(/\s+/)
                .filter((w) => w.length > 1 && !STOP.has(w));
}
const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "is", "was", "it", "for", "on", "with", "that", "this"]);

/** recall-qa's matcher semantics (copied per convention): overlap >= 0.6 or a
 * 4-word phrase hit; short ground truths (<=2 content words) need a full hit. */
function matchScore(response, expected) {
        const r = contentWords(response);
        const e = contentWords(expected);
        if (e.length === 0) return 0;
        const eSet = new Set(e);
        const hits = e.filter((w) => r.includes(w));
        if (e.length <= 2) return hits.length === e.length ? 1 : 0;
        const overlap = hits.length / e.length;
        if (overlap >= 0.6) return overlap;
        for (let i = 0; i + 4 <= e.length; i++) {
                const phrase = e.slice(i, i + 4).join(" ");
                if (response.toLowerCase().includes(phrase)) return 0.6;
        }
        return overlap;
}

const ABSTAIN_MARKERS = ["no record", "not recorded", "not stored", "isn't in", "is not in", "cannot answer", "can't answer", "don't know", "do not know", "not in memory", "no information", "unverified", "not specified", "nothing in", "no such"];

function scoreProbe(probe, response) {
        if (probe.expected !== null) {
                const score = matchScore(response, probe.expected);
                return { pass: score >= 0.6, score, kind: "exact-match" };
        }
        // Abstention probe: honest iff an abstention marker appears AND nothing
        // fabricates a concrete alternative (a library/benchmark name).
        const lower = String(response ?? "").toLowerCase();
        const abstained = ABSTAIN_MARKERS.some((m) => lower.includes(m));
        const fabricated = /(benchmark(ed)? (it )?against|compared to)\s+(zed|papaparse|csv-parse|lodash|ramda|underscore)/i.test(response ?? "");
        return { pass: abstained && !fabricated, score: abstained ? 1 : 0, kind: "abstention-honesty" };
}

// --------------------------------------------------------------- the arms

async function qaArm(probe, cwd) {
        const r = await runSession(cwd, probe.question);
        return { response: r.out.trim(), exitCode: r.code, timedOut: r.signal === "SIGKILL" };
}

// ------------------------------------------------------------------ runner

async function main() {
        const args = process.argv.slice(2);
        const DRY = args.includes("--dry");
        const EDGE = args.includes("--edge");
        const FRESH = args.includes("--fresh");
        const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.slice(8) ?? 0);

        if (DRY) {
                // The no-LLM smoke lane: fixture materialization + scorer self-test.
                materialize(join(SCRATCH, "dry"));
                if (!existsSync(join(SCRATCH, "dry", "test", "parse.test.ts"))) throw new Error("fixture materialization failed");
                const self = matchScore(
                        "validateRows now accepts empty dates and any parseable date (strict ISO regex removed)",
                        "empty dates accepted any parseable date strict ISO removed",
                );
                if (self < 0.6) throw new Error(`scorer self-test failed (${self})`);
                const abst = scoreProbe(PROBES[4], "No record of benchmarking keel against any library — that fact isn't in the stored memory tiers.");
                if (!abst.pass) throw new Error("abstention scorer self-test failed");
                if (!existsSync(UNOWN)) throw new Error(`unown binary not found at ${UNOWN}`);
                log("dry lane green: fixture + scorer + binary plumbing");
                return 0;
        }

        const svc = await checkServices();
        log(`services live (engine ${svc.engine.version?.version}, bridge upstream ${svc.bridge.upstream?.ok ? "ok" : "?"})`);

        if (FRESH) rmSync(RESULTS, { recursive: true, force: true });
        mkdirSync(PER_PROBE, { recursive: true });
        const summaryPath = join(RESULTS, "summary.json");

        // ---- Phase 1: the scenario sessions (real work, real notes, real dreams)
        const project = join(SCRATCH, "warm");
        const cold = join(SCRATCH, "cold");
        if (!existsSync(join(project, ".git"))) materialize(project);
        for (const s of SESSIONS) {
                const receiptPath = join(PER_PROBE, `session-${s.id}.json`);
                if (existsSync(receiptPath)) {
                        log(`session ${s.id}: receipt exists — skipping (resume-safe)`);
                        continue;
                }
                log(`session ${s.id}: driving a real agent session in ${project}`);
                const r = await runSession(project, s.prompt);
                if (r.code !== 0) throw new Error(`session ${s.id} exited ${r.code}: ${r.out.slice(-400)}`);
                execFileSync("git", ["add", "-A"], { cwd: project });
                try {
                        execFileSync("git", ["commit", "-qm", `recital ${s.id}`], { cwd: project });
                } catch {}
                log(`session ${s.id}: dreaming`);
                const dream = await dreamAndWait(project);
                writeFileSync(receiptPath, JSON.stringify({ id: s.id, ts: now(), exitCode: r.code, response: r.out, dream }, null, 1));
        }

        // The cold arm: a fresh clone of the fully-worked project, .unown/ removed.
        if (!existsSync(join(cold, ".git"))) {
                rmSync(cold, { recursive: true, force: true });
                cpSync(project, cold, { recursive: true });
                rmSync(join(cold, ".unown"), { recursive: true, force: true });
                execFileSync("git", ["add", "-A"], { cwd: cold });
                try {
                        execFileSync("git", ["commit", "-qm", "cold clone"], { cwd: cold });
                } catch {}
        }

        // ---- Phase 2: the QA battery (warm + cold)
        const results = [];
        const probes = LIMIT ? PROBES.slice(0, LIMIT) : PROBES;
        for (const probe of probes) {
                const receiptPath = join(PER_PROBE, `${probe.id}.json`);
                if (existsSync(receiptPath)) {
                        results.push(JSON.parse(readFileSync(receiptPath, "utf8")));
                        log(`probe ${probe.id}: receipt exists — skipping`);
                        continue;
                }
                log(`probe ${probe.id} (${probe.ability}): warm arm`);
                const warm = await qaArm(probe, project);
                log(`probe ${probe.id}: cold arm`);
                const coldR = await qaArm(probe, cold);
                const row = {
                        id: probe.id,
                        ability: probe.ability,
                        question: probe.question,
                        expected: probe.expected,
                        warm: { ...warm, ...scoreProbe(probe, warm.response) },
                        cold: { ...coldR, ...scoreProbe(probe, coldR.response) },
                        ts: now(),
                };
                results.push(row);
                writeFileSync(receiptPath, JSON.stringify(row, null, 1));
        }

        // ---- Phase 3 (optional): the edge probes
        const edge = {};
        if (EDGE) {
                // E1 concurrency: two parallel answer-bearing sessions in the same
                // project — BOTH exit notes must land (the session-salt lane).
                log("edge E1: concurrent sessions");
                const [a, b] = await Promise.all([
                        runSession(project, "Answer from memory/context only (no tools): what comment style do I require in this repo? One line."),
                        runSession(project, "Answer from memory/context only (no tools): when did the render lane switch to auto-sizing? One line."),
                ]);
                await dreamAndWait(project);
                const notes = await api("/api/notes?limit=6");
                const recent = notes.json?.notes ?? [];
                edge.concurrentNotes = recent.filter((n) => n.project_slug && String(n.content).startsWith("Terminal session outcome")).length;
                edge.concurrencyOk = edge.concurrentNotes >= 2;

                // E2 contamination: dreaming the QA sessions' own notes must add
                // nothing false (the Recital BUG-3 contract: withheld outcomes).
                const before = readFileSync(join(project, ".unown", "memory", "project.md"), "utf8");
                await dreamAndWait(project);
                const after = readFileSync(join(project, ".unown", "memory", "project.md"), "utf8");
                edge.contaminationAdded = after.replace(before, "").includes("- ") && !before.includes("No record of");
                // The contract: no abstention text became a memory line.
                edge.contaminationOk = !/no (comment style|record|benchmark)/i.test(after.split(before)[0] ?? "");

                // E3 outbox (engine-down → queued → restart → drained): the arc kills
                // ONLY the engine (the bridge must stay up — the session's model
                // endpoint rides it; stopping the whole stack kills the session itself,
                // which is a different (preflight) failure). agent:start is idempotent
                // per service, so the restart boots the engine alone.
                log("edge E3: engine-down outbox arc (killing the engine pid only)");
                const enginePid = readFileSync(join(ROOT, ".run", "engine.pid"), "utf8").trim();
                try {
                        process.kill(Number(enginePid), "SIGTERM");
                } catch (e) {
                        throw new Error(`could not kill engine pid ${enginePid}: ${e}`);
                }
                await Bun.sleep(2_500);
                const engineDown = await api("/api/health").then((r) => r.ok).catch(() => false);
                if (engineDown) throw new Error("engine did not go down (E3 precondition failed)");
                const downNote = await runSession(project, "Answer from memory/context only (no tools): what comment style do I require? One line.");
                const outboxDir = join(process.env.UNOWN_HOME ?? join(process.env.HOME ?? "~", ".unown"), "notes", "outbox");
                const outboxCount = () => (existsSync(outboxDir) ? execFileSync("ls", [outboxDir]).toString().trim().split("\n").filter(Boolean).length : 0);
                const outboxBefore = outboxCount();
                execFileSync("bun", ["run", "agent:start"], { cwd: ROOT, stdio: "ignore" });
                await Bun.sleep(8_000);
                await checkServices();
                await Bun.sleep(5_000);
                const outboxAfter = outboxCount();
                edge.outboxQueuedWhileDown = outboxBefore > 0;
                edge.outboxDrained = outboxAfter === 0;
                writeFileSync(join(PER_PROBE, "edge.json"), JSON.stringify({ ts: now(), ...edge, downSession: downNote.out.slice(0, 200) }, null, 1));
        }

        // ---- Phase 4: the summary
        const warmPass = results.filter((r) => r.warm?.pass).length;
        const coldPass = results.filter((r) => r.cold?.pass).length;
        const summary = {
                ts: now(),
                model: MODEL,
                probes: results.length,
                warmPass,
                coldPass,
                lift: +(warmPass - coldPass).toFixed(2),
                perProbe: results.map((r) => ({
                        id: r.id,
                        ability: r.ability,
                        warmPass: r.warm?.pass ?? false,
                        coldPass: r.cold?.pass ?? false,
                        warmScore: r.warm?.score ?? 0,
                        coldScore: r.cold?.score ?? 0,
                })),
                edge,
        };
        writeFileSync(summaryPath, JSON.stringify(summary, null, 1));
        log(`done: warm ${warmPass}/${results.length}, cold ${coldPass}/${results.length}, lift ${summary.lift}`);
        return 0;
}

process.exit(await main());
