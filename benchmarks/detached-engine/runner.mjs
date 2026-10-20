#!/usr/bin/env node
/**
 * benchmarks/detached-engine/runner.mjs — the before/after + stability
 * harness for the detached self-learning engine
 * (docs/detached-engine-architecture.md, M4).
 *
 * Scenarios (default: all; --only a,b,c to filter):
 *
 *   arch       architectural detachment metrics: does the CLI open the
 *              engine DB (fds), CLI cold/warm start, engine idle RSS/CPU
 *   crash      crash-injection matrix: SIGKILL the engine idle / mid-cycle →
 *              restart → orphan rows healed, API healthy, lock stolen
 *   autostart  engine down → CLI session → engine auto-starts, outbox drains
 *   soak       N minutes of unattended auto mode (jobs enabled): dream
 *              cadence bounded, ledger bounded, RSS flat, WAL bounded, no
 *              stuck jobs, engine responsive throughout
 *
 * Receipts land in results/<phase>-<ts>.json + a printed summary.
 * The BEFORE numbers (pre-detachment baseline, 2026-10-20) live in
 * results/before-baseline.json; run with --phase after for the comparison.
 *
 * Usage:
 *   node benchmarks/detached-engine/runner.mjs [--only arch,crash] [--soak-minutes 8]
 *   node benchmarks/detached-engine/runner.mjs --phase after
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const RESULTS = join(HERE, "results");
mkdirSync(RESULTS, { recursive: true });

const args = process.argv.slice(2);
const only = (args.includes("--only") ? args[args.indexOf("--only") + 1] : "").split(",").filter(Boolean);
const soakMinutes = Number(args.includes("--soak-minutes") ? args[args.indexOf("--soak-minutes") + 1] : 8);
const phase = args.includes("--phase") ? args[args.indexOf("--phase") + 1] : "";

const ENGINE_URL = process.env.UNOWN_ENGINE_URL || "http://127.0.0.1:3030";
// The runner may execute under node OR bun; `bin/unown` needs bun itself.
const BUN = process.execPath.includes("bun")
        ? process.execPath
        : ((spawnSync("which", ["bun"], { encoding: "utf8" }).stdout || "/usr/local/bin/bun").trim() || "bun");
const UNOWN = ["bin/unown"];

const log = (s) => console.log(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jfetch(url, ms = 4000) {
        try {
                const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
                return await res.json();
        } catch {
                return null;
        }
}

async function engineUp() {
        const o = await jfetch(`${ENGINE_URL}/api/overview`, 2000);
        return o?.ok === true ? o : null;
}

/** Run `bun bin/unown <args>`; returns { code, stdout, ms }. */
function unown(args, timeoutMs = 120_000) {
        const t0 = Date.now();
        const r = spawnSync(BUN, [...UNOWN, ...args], { cwd: REPO, encoding: "utf8", timeout: timeoutMs });
        return { code: r.status ?? -1, stdout: (r.stdout || "") + (r.stderr || ""), ms: Date.now() - t0 };
}

/** Count fds of `pid` matching a substring (e.g. selflearning). */
function fdCount(pid, match) {
        try {
                const out = spawnSync("ls", ["-la", `/proc/${pid}/fd`], { encoding: "utf8" });
                return (out.stdout || "").split("\n").filter((l) => l.includes(match)).length;
        } catch {
                return -1;
        }
}

function procStats(pid) {
        try {
                const out = spawnSync("ps", ["-o", "rss=,%cpu=", "-p", String(pid)], { encoding: "utf8" });
                const [rss, cpu] = (out.stdout || "").trim().split(/\s+/);
                return { rssKb: Number(rss) || -1, cpuPct: Number(cpu) || -1 };
        } catch {
                return { rssKb: -1, cpuPct: -1 };
        }
}

const receipts = {};
const summary = [];

// ---------------------------------------------------------------------------
async function scenarioArch() {
        const r = {};
        log("· arch: CLI session DB-fd probe (sampled DURING the session)…");
        const child = spawn(BUN, [...UNOWN, "-p", "Reply exactly: OK"], { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        let dbFds = -1;
        let sawProcess = false;
        await new Promise((resolve) => {
                const sampler = setInterval(() => {
                        try {
                                const ps = spawnSync("ps", ["-eo", "pid,args"], { encoding: "utf8" });
                                for (const line of (ps.stdout || "").split("\n")) {
                                        if (line.includes("bin/unown") && line.includes(" -p ") && !line.includes("engine")) {
                                                const pid = Number(line.trim().split(/\s+/)[0]);
                                                if (Number.isFinite(pid)) {
                                                        sawProcess = true;
                                                        dbFds = Math.max(dbFds, fdCount(pid, "selflearning"));
                                                }
                                        }
                                }
                        } catch {
                                /* ps failed */
                        }
                }, 250);
                const t = setTimeout(resolve, 60_000);
                child.on("close", () => {
                        clearTimeout(t);
                        clearInterval(sampler);
                        resolve();
                });
        });
        r.cli_engine_db_fds = sawProcess ? dbFds : "no live process captured (session too fast)";
        r.cli_session_echoed = out.includes("OK");

        log("· arch: CLI start timings (3 runs)…");
        r.cli_start_ms = [];
        for (let i = 0; i < 3; i++) {
                const res = unown(["-p", "Reply exactly: OK"], 120_000);
                r.cli_start_ms.push(res.ms);
        }

        const o = await engineUp();
        if (o?.pid) {
                r.engine_idle = procStats(o.pid);
                r.engine_pid = o.pid;
                r.engine_router = o.router;
                r.governor = o.governor;
        } else {
                r.engine_idle = "engine down";
        }
        receipts.arch = r;
        summary.push(`arch: cli_db_fds=${r.cli_engine_db_fds} start=[${r.cli_start_ms}]ms idle=${JSON.stringify(r.engine_idle)}`);
}

// ---------------------------------------------------------------------------
async function scenarioCrash() {
        const r = { cases: [] };
        log("· crash: SIGKILL idle engine → restart → heal…");
        let o = await engineUp();
        if (!o) {
                unown(["engine", "start"], 60_000);
                o = await engineUp();
        }
        if (!o) {
                receipts.crash = { error: "engine would not start" };
                summary.push("crash: ERROR engine would not start");
                return;
        }
        let t0 = Date.now();
        process.kill(o.pid, "SIGKILL");
        await sleep(1500);
        const down = (await engineUp()) === null;
        const start = unown(["engine", "start"], 60_000);
        const up = await engineUp();
        const recoveryMs = Date.now() - t0;
        const stuckRunning = up ? ((await jfetch(`${ENGINE_URL}/api/runs`))?.runs ?? []).filter((x) => x.status === "running").length : -1;
        r.cases.push({
                case: "idle-sigkill",
                detectedDown: down,
                restartExit: start.code,
                recoveryMs,
                stuckRunningRowsAfter: stuckRunning,
                lockStolen: Boolean(up),
        });

        log("· crash: SIGKILL mid-cycle → restart → orphan rows healed…");
        await fetch(`${ENGINE_URL}/api/jobs/harness-cycle/trigger`, { method: "POST" }).catch(() => null);
        await sleep(2500);
        const mid = await engineUp();
        if (mid?.pid) {
                const runsBefore = ((await jfetch(`${ENGINE_URL}/api/runs`))?.runs ?? []).filter((x) => x.status === "running").length;
                t0 = Date.now();
                process.kill(mid.pid, "SIGKILL");
                await sleep(1500);
                unown(["engine", "start"], 60_000);
                const up2 = await engineUp();
                const runsAfter = up2 ? ((await jfetch(`${ENGINE_URL}/api/runs`))?.runs ?? []).filter((x) => x.status === "running").length : -1;
                r.cases.push({
                        case: "midcycle-sigkill",
                        runningRowsBefore: runsBefore,
                        runningRowsAfterHeal: runsAfter,
                        healed: runsBefore > 0 ? runsAfter === 0 : "no run was in flight",
                        recoveryMs: Date.now() - t0,
                });
        } else {
                r.cases.push({ case: "midcycle-sigkill", skipped: "engine not reachable mid-cycle" });
        }
        receipts.crash = r;
        summary.push(`crash: ${r.cases.map((c) => `${c.case}→${c.healed ?? c.lockStolen ? "OK" : "FAIL"}`).join(" ")}`);
}

// ---------------------------------------------------------------------------
async function scenarioAutostart() {
        const r = {};
        log("· autostart: stop engine, run CLI session, expect auto-start…");
        const stop = unown(["engine", "stop"], 60_000);
        r.stopExit = stop.code;
        await sleep(1000);
        r.engineDownConfirmed = (await engineUp()) === null;
        const t0 = Date.now();
        const session = unown(["-p", "Reply exactly: AUTOSTART"], 120_000);
        r.sessionMs = session.ms;
        r.sessionEchoed = session.stdout.includes("AUTOSTART");
        let up = null;
        for (let i = 0; i < 30 && !up; i++) {
                await sleep(1000);
                up = await engineUp();
        }
        r.autostartMs = up ? Date.now() - t0 : -1;
        r.engineUpAfter = Boolean(up);
        r.enginePid = up?.pid ?? null;
        receipts.autostart = r;
        summary.push(`autostart: session=${r.sessionMs}ms engine_up=${r.engineUpAfter} in ${r.autostartMs}ms`);
}

// ---------------------------------------------------------------------------
async function scenarioSoak() {
        const minutes = soakMinutes;
        const r = { minutes, samples: [], events: [] };
        log(`· soak: ${minutes} minutes of unattended auto mode (sampling every 30s)…`);
        const jobs = (await jfetch(`${ENGINE_URL}/api/jobs`))?.jobs ?? [];
        for (const j of jobs) {
                if (!j.enabled && ["dream-check", "auto-dream", "harness-cycle", "task-mint"].includes(j.id)) {
                        await fetch(`${ENGINE_URL}/api/jobs/${j.id}/toggle`, { method: "POST" });
                        r.events.push(`enabled ${j.id}`);
                }
        }
        const t0 = Date.now();
        const end = t0 + minutes * 60_000;
        let lastDreams = null;
        while (Date.now() < end) {
                const o = await engineUp();
                if (!o) {
                        r.samples.push({ ts: Date.now(), down: true });
                } else {
                        const s = {
                                ts: Date.now(),
                                down: false,
                                dreams: o.kpis.dreams,
                                runs: o.kpis.totalRuns,
                                busyMs: o.router?.busyMs ?? 0,
                                activeJob: o.router?.activeJob ?? "",
                                callsHour: o.governor?.budget?.callsHour ?? 0,
                                tokensHour: o.governor?.budget?.tokensHour ?? 0,
                                overBudget: o.governor?.budget?.overBudget ?? false,
                                breakerOpen: o.governor?.breaker?.open ?? false,
                                enginePid: o.pid,
                        };
                        if (o.pid) s.proc = procStats(o.pid);
                        r.samples.push(s);
                        if (lastDreams !== null && s.dreams > lastDreams + 1) {
                                r.events.push(`DREAM_BURST at +${Math.round((Date.now() - t0) / 1000)}s: ${lastDreams}→${s.dreams}`);
                        }
                        lastDreams = s.dreams;
                }
                await sleep(30_000);
        }
        try {
                r.walBytes = existsSync(join(REPO, "db", "selflearning.db-wal")) ? statSync(join(REPO, "db", "selflearning.db-wal")).size : 0;
        } catch {
                r.walBytes = -1;
        }
        const first = r.samples.find((s) => !s.down);
        const last = [...r.samples].reverse().find((s) => !s.down);
        r.verdict = {
                engineUpThroughout: r.samples.every((s) => !s.down),
                dreamsInWindow: (last?.dreams ?? 0) - (first?.dreams ?? 0),
                runsInWindow: (last?.runs ?? 0) - (first?.runs ?? 0),
                maxCallsHour: Math.max(0, ...r.samples.map((s) => s.callsHour || 0)),
                budgetTripped: r.samples.some((s) => s.overBudget),
                breakerTripped: r.samples.some((s) => s.breakerOpen),
                rssGrowthKb: first && last && first.proc && last.proc ? last.proc.rssKb - first.proc.rssKb : null,
                dreamBursts: r.events.filter((e) => e.startsWith("DREAM_BURST")).length,
                walBytes: r.walBytes,
        };
        receipts.soak = r;
        summary.push(
                `soak(${minutes}m): up=${r.verdict.engineUpThroughout} dreams=${r.verdict.dreamsInWindow} runs=${r.verdict.runsInWindow} calls/h peak=${r.verdict.maxCallsHour} bursts=${r.verdict.dreamBursts} rssDelta=${r.verdict.rssGrowthKb}KB wal=${r.verdict.walBytes}B`,
        );
}

// ---------------------------------------------------------------------------

const scenarios = {
        arch: scenarioArch,
        crash: scenarioCrash,
        autostart: scenarioAutostart,
        soak: scenarioSoak,
};
const selected = only.length ? only : Object.keys(scenarios);

log(`detached-engine benchmark — scenarios: ${selected.join(", ")}`);
for (const name of selected) {
        if (!scenarios[name]) {
                log(`unknown scenario '${name}' — skipping`);
                continue;
        }
        try {
                await scenarios[name]();
        } catch (err) {
                receipts[name] = { error: String(err?.message ?? err) };
                summary.push(`${name}: ERROR ${err?.message ?? err}`);
        }
}

const receipt = {
        phase: phase || "run",
        ts: new Date().toISOString(),
        git: spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout?.trim(),
        scenarios: receipts,
        summary,
};
const file = join(RESULTS, `${(phase || "run")}-${Date.now()}.json`);
writeFileSync(file, JSON.stringify(receipt, null, 2));
log("");
for (const s of summary) log(s);
log(`\nreceipt: ${file}`);
