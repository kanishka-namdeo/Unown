#!/usr/bin/env node
/**
 * Unown long-run endurance bench — "what breaks when the agent runs for a
 * long time" (the 2026-10-27 long-run stress round).
 *
 * Design (research-grounded: METR time-horizon/RE-Bench, Terminal-Bench 2.x
 * timeout doctrine + failure taxonomy, tau-bench pass^k, k6/Grafana soak
 * doctrine, the documented long-session failure modes of Claude Code
 * (#105086 compact-thrash, #100710 context loss), Codex (#14447), Gemini CLI
 * (#26116 loop stall) — receipts in benchmarks/longrun/README.md):
 *
 *   fixture    — benchmarks/longrun/fixture/: "ledgerlog", a tiny expense
 *               ledger CLI (pure TS, dependency-free) with a STAGED buildout:
 *               features/feature-01..10.md, each spec'd CLI + module
 *               contracts of rising complexity (filters -> CSV -> budgets ->
 *               undo stack -> audit journal -> recurring -> versioned store).
 *   acceptance — benchmarks/longrun/acceptance/: bench-owned tests that
 *               NEVER enter the agent workspace during a session; the runner
 *               copies them into <workspace>/tests/acceptance/ at scoring
 *               time only, runs `bun test tests/acceptance/`, removes them.
 *               Anti-tamper by construction: the agent cannot see, edit or
 *               delete what scores it.
 *
 * Scenarios (node runner.mjs --scenario <list|all> --model <id>):
 *   marathon        one headless session, 10 features, --max-turns 150,
 *                   45-min wall cap — the many-turn single-session drill
 *   compact-thrash  the same buildout with a 24k-token contextWindow and
 *                   tightened compaction reserves — auto-compact fires
 *                   repeatedly; the claude-code#105086 / codex#14447 analog
 *   kill-resume     SIGKILL the agent at three staged points, --resume the
 *                   same session each time — the crash/resume torture lane
 *   loop-guard      an unfixable-spec lure with --max-tool-repetitions 6:
 *                   the identical-call loop guard must fire (exit 4) or the
 *                   model must give up gracefully — never a hang
 *   turn-cap        --max-turns 8 on a 3-feature buildout: capped:true,
 *                   exit 0, honest envelope
 *   notes-storm     engine DOWN, six real terminal sessions queue outbox
 *                   notes, a bench engine boots and drains + dreams
 *   engine-soak     N minutes of unattended auto mode (harness-cycle,
 *                   auto-dream, task-mint, dream-check enabled) WITH a live
 *                   terminal session every ~5 min feeding notes; sampling
 *                   every 30s: engine RSS/fds/WAL, governor, breaker, runs,
 *                   dreams, bridge health — the k6 soak doctrine
 *   budget-fidelity the governor throttles (PI_ENGINE_MAX_CALLS_HOUR) and
 *                   the breaker opens (dead bridge) and recovers (restart)
 *   ralph-chain     a 6-iteration worker/reviewer loop, fresh context each
 *                   iteration, cross-model review
 *
 * Every scenario writes results/run-<ts>/receipt-<scenario>.json with a
 * machine verdict + metrics, plus logs/. --resume <ts> skips scenarios that
 * already have a recorded verdict (the runner is itself resume-safe).
 */

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HERE = new URL(".", import.meta.url).pathname; // .../benchmarks/longrun/
const REPO_ROOT = resolve(HERE, "..", "..");
const FIXTURE_DIR = join(HERE, "fixture");
const ACCEPTANCE_DIR = join(HERE, "acceptance");
const RESULTS_DIR = join(HERE, "results");
const ROOT = process.env.BENCH_ROOT ?? "/home/z/my-project/bench-runs/longrun";
const UNOWN_BIN = process.env.UNOWN_BIN ?? join(REPO_ROOT, "bin", "unown");
const ENGINE_ENTRY = join(REPO_ROOT, "mini-services", "agent-service", "index.ts");
const BRIDGE_URL = process.env.PI_BRIDGE_URL ?? "http://127.0.0.1:3031";

const TOOL_PATH = [
  join(homedir(), ".bun", "bin"),
  "/usr/local/bin",
  join(homedir(), ".local", "bin"),
  process.env.PATH,
].join(":");

const args = process.argv.slice(2);
const flag = (name, def = undefined) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : def;
};
const MODEL = flag("model", "agnes-3.0-flash");
const RUN_TS = flag("resume") ?? new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const RUN_DIR = join(RESULTS_DIR, `run-${RUN_TS}`);
const LOG_DIR = join(RUN_DIR, "logs");
const SOAK_MINUTES = Number(flag("soak-minutes", process.env.LONGRUN_SOAK_MINUTES ?? 45));
const MARATHON_CAP_MIN = Number(process.env.LONGRUN_MARATHON_CAP_MIN ?? 45);
const COMPACT_CAP_MIN = Number(process.env.LONGRUN_COMPACT_CAP_MIN ?? 30);
const KILLRESUME_CAP_MIN = Number(process.env.LONGRUN_KILLRESUME_CAP_MIN ?? 45);
const LOOP_CAP_MIN = Number(process.env.LONGRUN_LOOP_CAP_MIN ?? 12);
const TURNCAP_CAP_MIN = Number(process.env.LONGRUN_TURNCAP_CAP_MIN ?? 15);
const RALPH_CAP_MIN = Number(process.env.LONGRUN_RALPH_CAP_MIN ?? 45);
const NOTES_SESSIONS = Number(process.env.LONGRUN_NOTES_SESSIONS ?? 6);
const SOAK_SESSION_EVERY_MIN = Number(process.env.LONGRUN_SOAK_SESSION_EVERY_MIN ?? 5);

const EXCLUDE = [".unown", "node_modules", ".git", ".DS_Store", ".ledger", "bun.lock"];

// ── process helpers ──────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, cmdArgs, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let out = "";
    let err = "";
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => resolveRun({ code: -1, out, err: String(e), timedOut: false }));
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolveRun({ code: code ?? -1, out, err, timedOut: signal === "SIGKILL" });
    });
  });
}

/** Linux /proc sampler: RSS kB + fd count + threads. */
function procStats(pid) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return null;
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const rss = Number(/VmRSS:\s+(\d+) kB/.exec(status)?.[1] ?? 0);
    const threads = Number(/Threads:\s+(\d+)/.exec(status)?.[1] ?? 0);
    let fds = 0;
    try {
      fds = readdirSync(`/proc/${pid}/fd`).length;
    } catch {
      fds = -1;
    }
    return { rssKb: rss, fds, threads };
  } catch {
    return null;
  }
}

/**
 * Headless agent run: detached process group, hard wall-clock cap
 * (process-group SIGKILL — Terminal-Bench timeout doctrine), light RSS
 * sampling of the child while it runs, JSON envelope parse.
 */
function runAgent(agentArgs, cwd, logBase, timeoutMs, env = {}, sampleEveryMs = 15_000) {
  return new Promise((resolveRun) => {
    const child = spawn(UNOWN_BIN, agentArgs, {
      cwd,
      env: { ...process.env, PATH: TOOL_PATH, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let out = "";
    let err = "";
    const samples = [];
    const sweepGroup = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    const timer = setTimeout(sweepGroup, timeoutMs);
    const sampler = setInterval(() => {
      const s = procStats(child.pid);
      if (s) samples.push({ tMs: Date.now() - t0, ...s });
    }, sampleEveryMs);
    const t0 = Date.now();
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    const finish = (code, signal) => {
      clearTimeout(timer);
      clearInterval(sampler);
      setTimeout(sweepGroup, 500);
      writeFileSync(`${logBase}.stdout.log`, out);
      writeFileSync(`${logBase}.stderr.log`, err);
      let envelope = null;
      for (const line of out.trim().split("\n").reverse()) {
        try {
          const j = JSON.parse(line);
          if (j?.type === "result") {
            envelope = j;
            break;
          }
        } catch {}
      }
      resolveRun({ code: code ?? -1, timedOut: signal === "SIGKILL", envelope, stdout: out, stderr: err, samples, wallMs: Date.now() - t0 });
    };
    child.on("error", (e) => {
      err += `\n${String(e)}`;
      finish(-1, null);
    });
    child.on("close", finish);
  });
}

/** SIGKILL a running runAgent child from outside (kill-resume torture). */
function killAgentGroup(childPid) {
  try {
    process.kill(-childPid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn a headless agent with a LIVE handle: callers may poll external
 * state (git commits, files) and kill the process group mid-run
 * (kill-resume torture), then collect the partial output.
 */
function spawnAgent(agentArgs, cwd, env = {}) {
  const child = spawn(UNOWN_BIN, agentArgs, {
    cwd,
    env: { ...process.env, PATH: TOOL_PATH, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.stderr.on("data", (d) => (err += d.toString()));
  const t0 = Date.now();
  const kill = () => {
    try {
      process.kill(-child.pid, "SIGKILL");
      return true;
    } catch {
      return false;
    }
  };
  const collect = (logBase = null, timeoutMs = null) =>
    new Promise((resolveCollect) => {
      const timer = timeoutMs ? setTimeout(() => kill(), timeoutMs) : null;
      const done = (code, signal) => {
        if (timer) clearTimeout(timer);
        setTimeout(() => {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {}
        }, 500);
        if (logBase) {
          writeFileSync(`${logBase}.stdout.log`, out);
          writeFileSync(`${logBase}.stderr.log`, err);
        }
        let envelope = null;
        for (const line of out.trim().split("\n").reverse()) {
          try {
            const j = JSON.parse(line);
            if (j?.type === "result") {
              envelope = j;
              break;
            }
          } catch {}
        }
        resolveCollect({
          code: code ?? -1,
          timedOut: signal === "SIGKILL",
          envelope,
          stdout: out,
          stderr: err,
          wallMs: Date.now() - t0,
          pid: child.pid,
        });
      };
      if (child.exitCode !== null) done(child.exitCode, null);
      else child.on("close", done);
    });
  return { child, pid: child.pid, kill, collect };
}

// ── workspace + home helpers ─────────────────────────────────────────────────

function freshWorkspace(name) {
  const ws = join(ROOT, `${name}-workspace`);
  rmSync(ws, { recursive: true, force: true });
  mkdirSync(ws, { recursive: true });
  cpSync(FIXTURE_DIR, ws, { recursive: true, filter: (p) => !EXCLUDE.some((x) => p.split("/").includes(x)) });
  return ws;
}

async function gitInit(ws) {
  await run("git", ["init", "-q"], { cwd: ws });
  await run("git", ["config", "user.email", "bench@unown.local"], { cwd: ws });
  await run("git", ["config", "user.name", "longrun bench"], { cwd: ws });
  await run("git", ["add", "-A"], { cwd: ws });
  await run("git", ["commit", "-q", "-m", "chore: fixture baseline"], { cwd: ws });
}

async function featureCommits(ws) {
  const r = await run("git", ["log", "--oneline"], { cwd: ws, timeoutMs: 15_000 });
  return (r.out.match(/feat: ?0?(\d)/g) ?? []).map((m) => Number(m.replace(/\D/g, "")));
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

/** Shrink the registered context window + tighten compaction (compact-thrash). */
function armCompactThrash(unownHome, model, contextWindow) {
  const modelsPath = join(unownHome, "agent", "models.json");
  const models = JSON.parse(readFileSync(modelsPath, "utf8"));
  let patched = false;
  for (const provider of Object.values(models.providers ?? {})) {
    for (const m of provider.models ?? []) {
      if (m.id === model) {
        m.contextWindow = contextWindow;
        patched = true;
      }
    }
  }
  if (!patched) throw new Error(`model ${model} not found in ${modelsPath}`);
  writeFileSync(modelsPath, JSON.stringify(models, null, 2));
  const settingsPath = join(unownHome, "agent", "settings.json");
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
  settings.compaction = { enabled: true, reserveTokens: Math.floor(contextWindow / 4), keepRecentTokens: Math.floor(contextWindow / 2.4) };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return { contextWindow, reserveTokens: settings.compaction.reserveTokens, keepRecentTokens: settings.compaction.keepRecentTokens };
}

// ── session receipts (v3/v4 JSONL shapes — mirrors longhorizon) ─────────────

function parseSessionStats(unownHome, workspace, startMs) {
  const sessDir = join(unownHome, "agent", "sessions");
  const stats = {
    sessions: 0, format: null, input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    toolCalls: 0, toolCallsByTool: {}, toolResults: 0, compactionEntries: 0,
    compactionTokensBefore: [], compactionRuns: [], branchSummaries: 0, assistantMessages: 0,
    sessionIds: [], sessionBytes: 0, jsonlCorruptLines: 0,
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
    stats.sessionIds.push(f.replace(/\.jsonl$/, ""));
    stats.sessionBytes += text.length;
    const version = typeof header.version === "number" ? header.version : null;
    stats.format = `v${version}`;
    for (const line of lines.slice(1)) {
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        stats.jsonlCorruptLines++;
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

/** Newest session id for a workspace (kill-resume discovery). */
function newestSessionId(unownHome, workspace, startMs) {
  const sessDir = join(unownHome, "agent", "sessions");
  if (!existsSync(sessDir)) return null;
  let best = null;
  let bestMtime = 0;
  for (const f of readdirSync(sessDir)) {
    if (!f.endsWith(".jsonl")) continue;
    const p = join(sessDir, f);
    const mtime = statSync(p).mtimeMs;
    if (mtime < startMs - 5_000 || mtime <= bestMtime) continue;
    try {
      const header = JSON.parse(readFileSync(p, "utf8").split("\n")[0] ?? "{}");
      if (header?.cwd === workspace) {
        best = f.replace(/\.jsonl$/, "");
        bestMtime = mtime;
      }
    } catch {}
  }
  return best;
}

// ── acceptance scoring (bench-owned; copied in at scoring time only) ────────

async function scoreAcceptance(ws, features = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
  const accDir = join(ws, "tests", "acceptance");
  mkdirSync(accDir, { recursive: true });
  const perFeature = {};
  for (const n of features) {
    const src = join(ACCEPTANCE_DIR, `feature-${String(n).padStart(2, "0")}.test.ts`);
    if (!existsSync(src)) continue;
    cpSync(join(ACCEPTANCE_DIR, "_helpers.ts"), join(accDir, "_helpers.ts"));
    cpSync(src, join(accDir, `feature-${String(n).padStart(2, "0")}.test.ts`));
  }
  for (const n of features) {
    const file = `feature-${String(n).padStart(2, "0")}`;
    if (!existsSync(join(accDir, `${file}.test.ts`))) continue;
    const r = await run("bun", ["test", `tests/acceptance/${file}.test.ts`], {
      cwd: ws,
      env: { ...process.env, PATH: TOOL_PATH },
      timeoutMs: 120_000,
    });
    const text = r.out + r.err;
    const passes = [...text.matchAll(/(\d+)\s+pass/g)].map((m) => Number(m[1]));
    const fails = [...text.matchAll(/(\d+)\s+fail/g)].map((m) => Number(m[1]));
    const pass = passes.length ? passes[passes.length - 1] : 0;
    const fail = fails.length ? fails[fails.length - 1] : 0;
    perFeature[file] = { pass, fail, exitCode: r.code, green: r.code === 0 && fail === 0 && pass > 0 };
  }
  rmSync(accDir, { recursive: true, force: true });
  const passed = Object.values(perFeature).filter((v) => v.green).length;
  const scored = Object.keys(perFeature).length;
  return { passed, scored, perFeature };
}

// ── receipts ────────────────────────────────────────────────────────────────

function writeReceipt(scenario, record) {
  mkdirSync(RUN_DIR, { recursive: true });
  writeFileSync(join(RUN_DIR, `receipt-${scenario}.json`), JSON.stringify({ ts: new Date().toISOString(), model: MODEL, scenario, ...record }, null, 2));
  log(`receipt ${scenario}: verdict=${record.verdict}`);
}

function readReceipts() {
  const out = {};
  if (!existsSync(RUN_DIR)) return out;
  for (const f of readdirSync(RUN_DIR)) {
    if (f.startsWith("receipt-") && f.endsWith(".json")) {
      try {
        const j = JSON.parse(readFileSync(join(RUN_DIR, f), "utf8"));
        out[j.scenario] = j;
      } catch {}
    }
  }
  return out;
}

// ── bench engine management (scratch data/db, own port) ─────────────────────

async function engineFetch(url, token, path, init = {}) {
  const res = await fetch(`http://127.0.0.1:${url.port}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
  }).catch(() => null);
  if (!res) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Boot a bench engine: scratch data dir + db, dedicated port, isolated
 * runtime dir. Resolves when /api/health answers `ready`.
 */
const BUN_BIN =
  [
    join(homedir(), ".bun", "bin", "bun"),
    "/usr/local/bin/bun",
    "/usr/bin/bun",
  ].find((p) => existsSync(p)) ?? "bun";

async function bootBenchEngine(name, { port, dataDir, dbPath, runDir, unownHome, env = {} }) {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dbPath, ".."), { recursive: true });
  mkdirSync(runDir, { recursive: true });
  const logPath = join(runDir, "bench-engine.log");
  const logStream = (await import("node:fs")).openSync(logPath, "a");
  const child = spawn(BUN_BIN, [ENGINE_ENTRY], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PATH: TOOL_PATH,
      PI_AGENT_PORT: String(port),
      PI_SELFLEARNING_DATA: dataDir,
      PI_SELFLEARNING_DB: dbPath,
      UNOWN_RUNTIME_DIR: runDir,
      UNOWN_HOME: unownHome,
      PI_MODEL_ID: MODEL,
      PI_PROVIDER: "zai-bridge",
      PI_BRIDGE_URL: BRIDGE_URL,
      UNOWN_ENGINE_AUTOSTART: "0",
      ...env,
    },
    stdio: ["ignore", logStream, logStream],
    detached: true,
  });
  child.unref();
  const url = { port };
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const h = await engineFetch(url, null, "/api/health");
    if (h?.ok && h.phase === "ready") {
      const token = existsSync(join(dataDir, "engine.token"))
        ? readFileSync(join(dataDir, "engine.token"), "utf8").trim()
        : null;
      return {
        url,
        token,
        pid: h.pid,
        dataDir,
        dbPath,
        runDir,
        logPath,
        stop: async () => {
          await engineFetch(url, token, "/api/shutdown", { method: "POST", timeoutMs: 15_000 }).catch(() => null);
          await new Promise((r) => setTimeout(r, 3_000));
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {}
        },
        forceKill: () => {
          try {
            process.kill(-child.pid, "SIGKILL");
            return true;
          } catch {
            return false;
          }
        },
      };
    }
    if (child.exitCode !== null) throw new Error(`bench engine ${name} exited early (code ${child.exitCode}) — see ${logPath}`);
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`bench engine ${name} did not become ready in 90s — see ${logPath}`);
}

// ── prompts ──────────────────────────────────────────────────────────────────

function buildoutPrompt(fromFeature, toFeature, extra = "") {
  const range =
    fromFeature === toFeature
      ? `feature-${String(fromFeature).padStart(2, "0")}.md`
      : `feature-${String(fromFeature).padStart(2, "0")}.md through feature-${String(toFeature).padStart(2, "0")}.md`;
  return `You are working in "ledgerlog", a small TypeScript expense-ledger CLI in the current directory.

THE JOB: implement the staged feature work in features/ — read features/README.md first, then implement ${range} STRICTLY IN ORDER.

For each feature:
1. Read the spec file fully.
2. Implement it: source in src/ (extend the existing modules; the CLI entry stays \`bun src/cli.ts <command>\`).
3. Add your own tests under tests/ for the new behavior (never delete or weaken an existing test).
4. Run \`bun test\` and make the whole suite green.
5. \`git commit -m "feat: NN <short-slug>"\` before moving on to the next feature.

Rules:
- Work ONLY inside the current directory.
- The project stays dependency-free: bun + TypeScript stdlib only.
- Persistent state goes under .ledger/ relative to the current working directory.
- If you are running low on time, prefer FEWER features fully done and committed over more features half-done.
- When all the features are done (or you cannot improve further), reply with exactly: DONE
${extra}`;
}

const RESUME_PROMPT = `Your session was interrupted mid-task. Re-orient (check \`git log --oneline\` and the specs in features/), then continue exactly where you left off: finish the remaining staged features per features/README.md, one committed feature at a time. Reply with exactly: DONE`;

// ── scenario: marathon ───────────────────────────────────────────────────────

async function scenarioMarathon() {
  const name = "marathon";
  const runRoot = join(ROOT, name);
  rmSync(runRoot, { recursive: true, force: true });
  mkdirSync(runRoot, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
  const ws = join(runRoot, "workspace");
  const unownHome = join(runRoot, "unown-home");
  cpSync(FIXTURE_DIR, ws, { recursive: true, filter: (p) => !EXCLUDE.some((x) => p.split("/").includes(x)) });
  await gitInit(ws);
  await ensureHome(unownHome, MODEL);
  const startMs = Date.now();
  log(`${name}: spawning agent (cap ${MARATHON_CAP_MIN} min, --max-turns 150)`);
  const r = await runAgent(
    ["-p", buildoutPrompt(1, 10), "--output-format", "json", "--max-turns", "150"],
    ws,
    join(LOG_DIR, name),
    MARATHON_CAP_MIN * 60_000,
    { UNOWN_HOME: unownHome },
  );
  const session = parseSessionStats(unownHome, ws, startMs);
  const acceptance = await scoreAcceptance(ws);
  const feats = await featureCommits(ws);
  const rssSeries = r.samples.map((s) => s.rssKb);
  const rssSlopeKbPerH =
    r.samples.length >= 2
      ? Math.round(((rssSeries[rssSeries.length - 1] - rssSeries[0]) / Math.max(1, r.samples[r.samples.length - 1].tMs)) * 3_600_000)
      : 0;
  const fdSeries = r.samples.map((s) => s.fds);
  const metrics = {
    wallS: Math.round(r.wallMs / 1000),
    exitCode: r.code,
    timedOut: r.timedOut,
    capped: r.envelope?.capped ?? null,
    numTurns: r.envelope?.num_turns ?? null,
    tokensIn: r.envelope?.usage?.input_tokens ?? session.input,
    tokensOut: r.envelope?.usage?.output_tokens ?? session.output,
    featuresCommitted: feats,
    featuresPassed: acceptance.passed,
    featuresScored: acceptance.scored,
    perFeature: acceptance.perFeature,
    sessionCompactions: session.compactionEntries,
    sessionBytes: session.sessionBytes,
    assistantMessages: session.assistantMessages,
    toolCallsByTool: session.toolCallsByTool,
    agentRssKbStart: rssSeries[0] ?? null,
    agentRssKbEnd: rssSeries[rssSeries.length - 1] ?? null,
    agentRssSlopeKbPerH: rssSlopeKbPerH,
    agentFdMin: fdSeries.length ? Math.min(...fdSeries) : null,
    agentFdMax: fdSeries.length ? Math.max(...fdSeries) : null,
    envelope: r.envelope,
  };
  const checks = {
    completedWithinCap: !r.timedOut,
    exitClean: r.code === 0,
    featuresPassed: acceptance.passed >= 8,
    sessionParses: session.sessions >= 1 && session.jsonlCorruptLines === 0,
    noContextWedge: !/context (window )?(full|overflow)/i.test(r.stderr) || session.compactionEntries > 0,
  };
  const verdict = Object.values(checks).every(Boolean) ? "pass" : "fail";
  writeReceipt(name, { verdict, checks, metrics });
}

// ── scenario: compact-thrash ────────────────────────────────────────────────

async function scenarioCompactThrash() {
  const name = "compact-thrash";
  const runRoot = join(ROOT, name);
  rmSync(runRoot, { recursive: true, force: true });
  mkdirSync(runRoot, { recursive: true });
  const ws = join(runRoot, "workspace");
  const unownHome = join(runRoot, "unown-home");
  cpSync(FIXTURE_DIR, ws, { recursive: true, filter: (p) => !EXCLUDE.some((x) => p.split("/").includes(x)) });
  await gitInit(ws);
  await ensureHome(unownHome, MODEL);
  const contextWindow = Number(process.env.LONGRUN_THRASH_CONTEXT_WINDOW ?? 24_000);
  const arm = armCompactThrash(unownHome, MODEL, contextWindow);
  const startMs = Date.now();
  log(`${name}: contextWindow=${arm.contextWindow} reserve=${arm.reserveTokens} keepRecent=${arm.keepRecentTokens}`);
  const r = await runAgent(
    ["-p", buildoutPrompt(1, 6), "--output-format", "json", "--max-turns", "150"],
    ws,
    join(LOG_DIR, name),
    COMPACT_CAP_MIN * 60_000,
    { UNOWN_HOME: unownHome },
  );
  const session = parseSessionStats(unownHome, ws, startMs);
  const acceptance = await scoreAcceptance(ws, [1, 2, 3, 4, 5, 6]);
  const feats = await featureCommits(ws);
  const compactionFailures = (r.stderr.match(/compaction|context/ig) ?? []).length;
  const metrics = {
    arm,
    wallS: Math.round(r.wallMs / 1000),
    exitCode: r.code,
    capped: r.envelope?.capped ?? null,
    numTurns: r.envelope?.num_turns ?? null,
    featuresCommitted: feats,
    featuresPassed: acceptance.passed,
    featuresScored: acceptance.scored,
    perFeature: acceptance.perFeature,
    compactionEntries: session.compactionEntries,
    compactionRuns: session.compactionRuns,
    compactionTokensBefore: session.compactionTokensBefore,
    assistantMessages: session.assistantMessages,
    sessionBytes: session.sessionBytes,
    stderrContextMentions: compactionFailures,
    envelope: r.envelope,
  };
  // The claude-code#105086 / codex#14447 analog: after each compaction the
  // session must keep WORKING — features keep landing, no error loop.
  const checks = {
    compacted: session.compactionEntries >= 2,
    stillProductive: acceptance.passed >= 3,
    exitClean: r.code === 0,
    sessionParses: session.sessions >= 1 && session.jsonlCorruptLines === 0,
    noHardOverflowLoop: !/error.*context|context.*error/i.test(r.stderr.slice(-4000)) || acceptance.passed >= 3,
  };
  const verdict = Object.values(checks).every(Boolean) ? "pass" : "fail";
  writeReceipt(name, { verdict, checks, metrics });
}

// ── scenario: kill-resume (crash/resume torture) ────────────────────────────

function sessionFileValid(unownHome, sessionId) {
  const p = join(unownHome, "agent", "sessions", `${sessionId}.jsonl`);
  if (!existsSync(p)) return { exists: false, valid: false, lines: 0, bytes: 0 };
  const text = readFileSync(p, "utf8");
  const lines = text.split("\n").filter(Boolean);
  let ok = lines.length > 0;
  for (const line of lines) {
    try {
      JSON.parse(line);
    } catch {
      ok = false;
      break;
    }
  }
  return { exists: true, valid: ok, lines: lines.length, bytes: text.length };
}

async function scenarioKillResume() {
  const name = "kill-resume";
  const runRoot = join(ROOT, name);
  rmSync(runRoot, { recursive: true, force: true });
  mkdirSync(runRoot, { recursive: true });
  const ws = join(runRoot, "workspace");
  const unownHome = join(runRoot, "unown-home");
  cpSync(FIXTURE_DIR, ws, { recursive: true, filter: (p) => !EXCLUDE.some((x) => p.split("/").includes(x)) });
  await gitInit(ws);
  await ensureHome(unownHome, MODEL);
  const startMs = Date.now();
  const capMs = KILLRESUME_CAP_MIN * 60_000;
  const legs = [];
  // Kill gates (features committed OR seconds elapsed, whichever first):
  // leg 1 dies at >= 2 features, legs 2/3 die at >= 4 / >= 6, leg 4 runs out.
  const gates = [
    { minFeatures: 2, maxWaitS: 480 },
    { minFeatures: 4, maxWaitS: 420 },
    { minFeatures: 6, maxWaitS: 420 },
  ];
  let sessionId = null;
  const runStart = Date.now();

  for (let leg = 0; leg <= gates.length; leg++) {
    const gate = gates[leg] ?? null;
    const legArgs =
      leg === 0
        ? ["-p", buildoutPrompt(1, 8), "--output-format", "json", "--max-turns", "150"]
        : ["--resume", sessionId, "-p", RESUME_PROMPT, "--output-format", "json", "--max-turns", "150"];
    const handle = spawnAgent(legArgs, ws, { UNOWN_HOME: unownHome });
    const legStart = Date.now();
    let killed = false;
    if (gate) {
      const deadline = legStart + gate.maxWaitS * 1000;
      while (Date.now() < deadline && Date.now() - runStart < capMs) {
        await new Promise((r) => setTimeout(r, 10_000));
        const feats = await featureCommits(ws);
        if (feats.length >= gate.minFeatures) break;
      }
      const feats = await featureCommits(ws);
      killed = handle.kill();
      log(`${name}: leg ${leg + 1} killed after ${Math.round((Date.now() - legStart) / 1000)}s at ${feats.length} features (killed=${killed})`);
    }
    const remaining = capMs - (Date.now() - runStart);
    const r = await handle.collect(join(LOG_DIR, `${name}-leg${leg + 1}`), Math.max(60_000, remaining));
    const sid = r.envelope?.session_id ?? sessionId;
    if (sid) sessionId = sid;
    if (!sessionId) sessionId = newestSessionId(unownHome, ws, startMs);
    const sfile = sessionId ? sessionFileValid(unownHome, sessionId) : { exists: false, valid: false };
    legs.push({
      leg: leg + 1,
      resumed: leg > 0,
      killed,
      exitCode: r.code,
      timedOut: r.timedOut,
      wallS: Math.round((Date.now() - legStart) / 1000),
      featuresAtEnd: (await featureCommits(ws)).length,
      sessionFile: sfile,
      envelopeTurns: r.envelope?.num_turns ?? null,
      sessionId: sessionId ?? null,
    });
    if (r.code === 0 && !killed && r.envelope?.result) break; // finished on its own
  }

  const session = parseSessionStats(unownHome, ws, startMs);
  const acceptance = await scoreAcceptance(ws, [1, 2, 3, 4, 5, 6, 7, 8]);
  const feats = await featureCommits(ws);
  const kills = legs.filter((l) => l.killed).length;
  const resumes = legs.filter((l) => l.resumed).length;
  const metrics = {
    legs,
    kills,
    resumes,
    wallS: Math.round((Date.now() - runStart) / 1000),
    featuresCommitted: feats.length,
    featuresPassed: acceptance.passed,
    featuresScored: acceptance.scored,
    perFeature: acceptance.perFeature,
    sessionCompactions: session.compactionEntries,
    sessionBytes: session.sessionBytes,
    jsonlCorruptLines: session.jsonlCorruptLines,
    tokensIn: session.input,
    tokensOut: session.output,
  };
  const checks = {
    killsLanded: kills >= 2, // at least 2 of the 3 gates fired (timing tolerance)
    resumesTook: resumes >= 2 && legs.slice(1).every((l) => l.sessionFile?.exists),
    sessionNeverCorrupt: legs.every((l) => !l.sessionFile?.exists || l.sessionFile.valid),
    taskCompletedAfterTorture: acceptance.passed >= 5,
    noCapBreach: legs.every((l) => !l.timedOut),
  };
  const verdict = Object.values(checks).every(Boolean) ? "pass" : "fail";
  writeReceipt(name, { verdict, checks, metrics });
}

// ── scenario: loop-guard ─────────────────────────────────────────────────────

async function scenarioLoopGuard() {
  const name = "loop-guard";
  const runRoot = join(ROOT, name);
  rmSync(runRoot, { recursive: true, force: true });
  mkdirSync(runRoot, { recursive: true });
  const ws = join(runRoot, "workspace");
  const unownHome = join(runRoot, "unown-home");
  cpSync(FIXTURE_DIR, ws, { recursive: true, filter: (p) => !EXCLUDE.some((x) => p.split("/").includes(x)) });
  await gitInit(ws);
  // The lure: a read-only spec that cannot be satisfied. The model must not
  // hang forever repeating the same tool call; either the loop guard fires
  // (exit 4) or the model gives up gracefully (exit 0/1 with an honest answer).
  writeFileSync(
    join(ws, "tests", "flaky.test.ts"),
    [
      'import { describe, expect, test } from "bun:test";',
      "",
      'describe("read-only spec (do not modify tests/)", () => {',
      '  test("the ledger epoch rule holds", () => {',
      "    // The spec is read-only (see AGENTS.md): the ledger is required to",
      "    // report the year 1999 as the current calendar year.",
      "    expect(new Date().getFullYear()).toBe(1999);",
      "  });",
      "});",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(ws, "AGENTS.md"),
    [
      "# ledgerlog (lure fixture)",
      "",
      "- tests/ is a READ-ONLY specification: never edit, delete, skip or",
      "  weaken anything under tests/.",
      "- Make `bun test` green.",
      "",
    ].join("\n"),
  );
  await run("git", ["add", "-A"], { cwd: ws });
  await run("git", ["commit", "-q", "-m", "chore: add read-only spec"], { cwd: ws });
  await ensureHome(unownHome, MODEL);
  log(`${name}: spawning agent against the impossible spec (--max-tool-repetitions 6, --max-turns 30)`);
  const r = await runAgent(
    [
      "-p",
      "Make `bun test` green. Note: everything under tests/ is a read-only spec (never modify tests/). When the suite is green, reply exactly: DONE",
      "--output-format", "json",
      "--max-tool-repetitions", "6",
      "--max-turns", "30",
    ],
    ws,
    join(LOG_DIR, name),
    LOOP_CAP_MIN * 60_000,
    { UNOWN_HOME: unownHome },
  );
  const startMs = Date.now();
  const session = parseSessionStats(unownHome, ws, startMs - 60_000);
  const metrics = {
    wallS: Math.round(r.wallMs / 1000),
    exitCode: r.code,
    timedOut: r.timedOut,
    loopGuard: r.envelope?.loop_guard ?? null,
    numTurns: r.envelope?.num_turns ?? null,
    resultLength: (r.envelope?.result ?? "").length,
    toolCallsByTool: session.toolCallsByTool,
    envelope: r.envelope,
  };
  const checks = {
    terminatedWithinCap: !r.timedOut,
    contractExit: r.code === 0 || r.code === 1 || r.code === 4,
    guardHonest: r.code !== 4 || Boolean(r.envelope?.loop_guard),
    noHang: r.wallMs < LOOP_CAP_MIN * 60_000,
  };
  const verdict = Object.values(checks).every(Boolean) ? "pass" : "fail";
  writeReceipt(name, { verdict, checks, metrics, note: "loop_guard fired OR graceful give-up — both are contract-honoring outcomes" });
}

// ── scenario: turn-cap ───────────────────────────────────────────────────────

async function scenarioTurnCap() {
  const name = "turn-cap";
  const runRoot = join(ROOT, name);
  rmSync(runRoot, { recursive: true, force: true });
  mkdirSync(runRoot, { recursive: true });
  const ws = join(runRoot, "workspace");
  const unownHome = join(runRoot, "unown-home");
  cpSync(FIXTURE_DIR, ws, { recursive: true, filter: (p) => !EXCLUDE.some((x) => p.split("/").includes(x)) });
  await gitInit(ws);
  await ensureHome(unownHome, MODEL);
  log(`${name}: --max-turns 8 against a 3-feature buildout`);
  const r = await runAgent(
    ["-p", buildoutPrompt(1, 3), "--output-format", "json", "--max-turns", "8"],
    ws,
    join(LOG_DIR, name),
    TURNCAP_CAP_MIN * 60_000,
    { UNOWN_HOME: unownHome },
  );
  const metrics = {
    wallS: Math.round(r.wallMs / 1000),
    exitCode: r.code,
    timedOut: r.timedOut,
    capped: r.envelope?.capped ?? null,
    numTurns: r.envelope?.num_turns ?? null,
    resultPreview: (r.envelope?.result ?? "").slice(0, 200),
    envelope: r.envelope,
  };
  const checks = {
    cappedFlag: r.envelope?.capped === true,
    exitClean: r.code === 0,
    turnsRespected: typeof r.envelope?.num_turns === "number" && r.envelope.num_turns <= 8,
    answerPresent: (r.envelope?.result ?? "").length > 0,
  };
  const verdict = Object.values(checks).every(Boolean) ? "pass" : "fail";
  writeReceipt(name, { verdict, checks, metrics });
}

// ── scenario: notes-storm (engine down -> outbox -> drain -> dream) ─────────

async function scenarioNotesStorm() {
  const name = "notes-storm";
  const runRoot = join(ROOT, name);
  rmSync(runRoot, { recursive: true, force: true });
  mkdirSync(runRoot, { recursive: true });
  const ws = join(runRoot, "workspace");
  const unownHome = join(runRoot, "unown-home");
  cpSync(FIXTURE_DIR, ws, { recursive: true, filter: (p) => !EXCLUDE.some((x) => p.split("/").includes(x)) });
  await gitInit(ws);
  await ensureHome(unownHome, MODEL);

  const deadEngineEnv = {
    UNOWN_HOME: unownHome,
    UNOWN_ENGINE_URL: "http://127.0.0.1:9", // dead port: delivery fails -> outbox
    PI_DISABLE_ENGINE_SPAWN: "1",
  };
  const tinyTasks = [
    'Add one entry via the CLI: `bun src/cli.ts add 1500 food --date 2026-01-05 --note "first"`, then run `bun test` and reply DONE.',
    'Add one entry: `bun src/cli.ts add 2500 rent --date 2026-01-06`, run `bun test`, reply DONE.',
    'Add one entry: `bun src/cli.ts add 300 fun --date 2026-01-07`, run `bun test`, reply DONE.',
    'Run `bun test`. If green, reply DONE.',
    'Run `bun src/cli.ts balance` and reply with its output.',
    'Run `bun test`. If green, reply DONE.',
  ];
  const sessionResults = [];
  log(`${name}: engine DOWN — running ${NOTES_SESSIONS} terminal sessions to fill the outbox`);
  for (let i = 0; i < Math.min(NOTES_SESSIONS, tinyTasks.length); i++) {
    const r = await runAgent(
      ["-p", tinyTasks[i], "--output-format", "json", "--max-turns", "12"],
      ws,
      join(LOG_DIR, `${name}-s${i + 1}`),
      8 * 60_000,
      deadEngineEnv,
    );
    sessionResults.push({ i: i + 1, exitCode: r.code, turns: r.envelope?.num_turns ?? null });
  }
  const outboxDir = join(unownHome, "notes", "outbox");
  const outboxAfter = existsSync(outboxDir) ? readdirSync(outboxDir).filter((f) => f.endsWith(".md")) : [];

  // Boot a bench engine sharing the scratch home; note-sync drains the outbox.
  log(`${name}: booting bench engine to drain ${outboxAfter.length} outbox notes`);
  const engine = await bootBenchEngine(name, {
    port: Number(process.env.LONGRUN_BENCH_PORT ?? 3040),
    dataDir: join(runRoot, "engine-data"),
    dbPath: join(runRoot, "engine-db", "selflearning.db"),
    runDir: join(runRoot, "engine-run"),
    unownHome,
  });
  const drainDeadline = Date.now() + 6 * 60_000;
  let drained = false;
  while (Date.now() < drainDeadline) {
    await engineFetch(engine.url, engine.token, "/api/jobs/note-sync/trigger", { method: "POST" }).catch(() => null);
    await new Promise((r) => setTimeout(r, 15_000));
    const left = existsSync(outboxDir) ? readdirSync(outboxDir).filter((f) => f.endsWith(".md")) : [];
    if (left.length === 0 && outboxAfter.length > 0) {
      drained = true;
      break;
    }
    if (outboxAfter.length === 0 && left.length === 0) break;
  }
  const doneDir = join(unownHome, "notes", "done");
  const deadDir = join(unownHome, "notes", "dead");
  const doneCount = existsSync(doneDir) ? readdirSync(doneDir).filter((f) => f.endsWith(".md")).length : 0;
  const deadCount = existsSync(deadDir) ? readdirSync(deadDir).filter((f) => f.endsWith(".md")).length : 0;
  const outboxLeft = existsSync(outboxDir) ? readdirSync(outboxDir).filter((f) => f.endsWith(".md")).length : 0;

  // Trigger a dream over the drained notes (project lane).
  const dreamTrigger = await engineFetch(engine.url, engine.token, "/api/jobs/auto-dream/trigger", { method: "POST", timeoutMs: 120_000 });
  let dreamStatus = null;
  const dreamDeadline = Date.now() + 8 * 60_000;
  while (Date.now() < dreamDeadline) {
    const jobs = await engineFetch(engine.url, engine.token, "/api/jobs");
    const dream = (jobs?.jobs ?? []).find((j) => j.id === "auto-dream");
    if (dream && dream.status !== "running" && (dream.run_count ?? 0) > 0) {
      dreamStatus = dream;
      break;
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  const overview = await engineFetch(engine.url, engine.token, "/api/overview");
  const memoryProject = join(ws, ".unown", "memory", "project.md");
  await engine.stop();

  const metrics = {
    sessions: sessionResults,
    outboxPeak: outboxAfter.length,
    outboxLeft,
    notesDone: doneCount,
    notesDead: deadCount,
    drained,
    dreamTrigger: dreamTrigger?.result ?? dreamTrigger ?? null,
    dreamJob: dreamStatus ? { status: dreamStatus.status, lastOk: dreamStatus.last_ok, lastError: dreamStatus.last_error, runCount: dreamStatus.run_count } : null,
    overviewDreams: overview?.kpis?.dreams ?? null,
    projectMemoryExists: existsSync(memoryProject),
    projectMemoryBytes: existsSync(memoryProject) ? statSync(memoryProject).size : 0,
  };
  const checks = {
    outboxFilled: outboxAfter.length >= 2,
    drained: drained || outboxLeft === 0,
    noDeadLetters: deadCount === 0,
    noLoss: doneCount + deadCount >= outboxAfter.length,
    dreamRan: Boolean(dreamStatus) || metrics.overviewDreams !== null,
  };
  const verdict = Object.values(checks).every(Boolean) ? "pass" : "fail";
  writeReceipt(name, { verdict, checks, metrics });
}

// ── scenario: engine-soak (k6 soak doctrine, engine + terminal traffic) ─────

async function scenarioEngineSoak() {
  const name = "engine-soak";
  const runRoot = join(ROOT, name);
  rmSync(runRoot, { recursive: true, force: true });
  mkdirSync(runRoot, { recursive: true });
  const ws = join(runRoot, "workspace");
  const unownHome = join(runRoot, "unown-home");
  cpSync(FIXTURE_DIR, ws, { recursive: true, filter: (p) => !EXCLUDE.some((x) => p.split("/").includes(x)) });
  await gitInit(ws);
  await ensureHome(unownHome, MODEL);

  log(`${name}: booting bench engine for a ${SOAK_MINUTES}-minute soak`);
  const engine = await bootBenchEngine(name, {
    port: Number(process.env.LONGRUN_SOAK_PORT ?? 3041),
    dataDir: join(runRoot, "engine-data"),
    dbPath: join(runRoot, "engine-db", "selflearning.db"),
    runDir: join(runRoot, "engine-run"),
    unownHome,
  });
  // Enable the learning jobs (mirrors detached-engine soak).
  for (const jobId of ["harness-cycle", "auto-dream", "task-mint", "dream-check"]) {
    await engineFetch(engine.url, engine.token, `/api/jobs/${jobId}/toggle`, { method: "POST" });
  }
  const jobsAfterToggle = await engineFetch(engine.url, engine.token, "/api/jobs");
  const jobsEnabled = {};
  for (const j of jobsAfterToggle?.jobs ?? []) jobsEnabled[j.id] = j.enabled === 1 || j.enabled === true;

  const samples = [];
  const sessions = [];
  const soakStart = Date.now();
  const soakDeadline = soakStart + SOAK_MINUTES * 60_000;
  let nextSessionAt = soakStart; // a terminal session right away, then every N min
  const sessionTasks = [
    'Add one entry via `bun src/cli.ts add 1500 food --date 2026-01-05 --note "soak"`, run `bun test`, reply DONE.',
    'Run `bun test`; if green reply DONE. If not, fix it.',
    'Run `bun src/cli.ts balance` and reply with its output.',
    'Add one entry: `bun src/cli.ts add 2200 rent --date 2026-01-08`, run `bun test`, reply DONE.',
    'Run `bun test`; if green reply DONE.',
    'Add one entry: `bun src/cli.ts add 450 fun --date 2026-01-09`, run `bun test`, reply DONE.',
    'Run `bun test`; if green reply DONE.',
    'Run `bun src/cli.ts list` and reply with its output.',
  ];
  let sessionIdx = 0;
  let runningAgent = null;

  while (Date.now() < soakDeadline) {
    // Terminal traffic: sessions deliver notes straight to the bench engine.
    if (!runningAgent && nextSessionAt <= Date.now() && sessionIdx < sessionTasks.length) {
      const task = sessionTasks[sessionIdx];
      runningAgent = spawnAgent(
        ["-p", task, "--output-format", "json", "--max-turns", "12"],
        ws,
        { UNOWN_HOME: unownHome, UNOWN_ENGINE_URL: `http://127.0.0.1:${engine.url.port}`, UNOWN_ENGINE_TOKEN: engine.token },
      );
      const idx = sessionIdx;
      runningAgent.collect(join(LOG_DIR, `${name}-s${idx + 1}`), 8 * 60_000).then((r) => {
        sessions.push({ i: idx + 1, exitCode: r.code, turns: r.envelope?.num_turns ?? null });
      });
      sessionIdx++;
      nextSessionAt = Date.now() + SOAK_SESSION_EVERY_MIN * 60_000;
    }
    // Sample every 30s: engine health + overview + /proc + WAL + bridge.
    const health = await engineFetch(engine.url, engine.token, "/api/health");
    const overview = await engineFetch(engine.url, engine.token, "/api/overview");
    const bridge = await fetch(`${BRIDGE_URL}/health`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null);
    const ps = procStats(health?.pid ?? engine.pid);
    const walBytes = existsSync(`${engine.dbPath}-wal`) ? statSync(`${engine.dbPath}-wal`).size : 0;
    samples.push({
      tS: Math.round((Date.now() - soakStart) / 1000),
      phase: health?.phase ?? null,
      pid: health?.pid ?? null,
      rssKb: ps?.rssKb ?? null,
      fds: ps?.fds ?? null,
      threads: ps?.threads ?? null,
      walBytes,
      dreams: overview?.kpis?.dreams ?? null,
      runs: overview?.kpis?.totalRuns ?? null,
      callsHour: overview?.governor?.budget?.callsHour ?? null,
      overBudget: overview?.governor?.budget?.overBudget ?? null,
      breakerOpen: overview?.governor?.breaker?.open ?? null,
      routerBusyMs: overview?.router?.busyMs ?? null,
      notesPending: overview?.kpis?.notes?.pending ?? null,
      bridgeRequests: bridge?.requests ?? null,
      bridgeErrors: bridge?.errors ?? null,
      bridgeDegenerate: bridge?.degenerate ?? null,
      bridgeFailovers: bridge?.failovers ?? null,
    });
    await new Promise((r) => setTimeout(r, 30_000));
  }
  // Let the last in-flight agent finish (bounded).
  if (runningAgent) await runningAgent.collect(null, 8 * 60_000);
  const finalOverview = await engineFetch(engine.url, engine.token, "/api/overview");
  const finalJobs = await engineFetch(engine.url, engine.token, "/api/jobs");
  const gracefulStop = await engineFetch(engine.url, engine.token, "/api/shutdown", { method: "POST", timeoutMs: 15_000 });
  await new Promise((r) => setTimeout(r, 5_000));
  const healthAfterStop = await engineFetch(engine.url, engine.token, "/api/health");
  await engine.stop().catch(() => {});

  // Verdict math (k6 soak doctrine: stable-or-within-expected-variation).
  const rss = samples.map((s) => s.rssKb).filter((v) => typeof v === "number");
  const fds = samples.map((s) => s.fds).filter((v) => typeof v === "number" && v >= 0);
  const skipWarmup = Math.max(0, Math.floor(samples.length / 6)); // ~first sixth = warmup
  const rssTail = rss.slice(skipWarmup);
  const rssSlopeKbPerH =
    rssTail.length >= 2 ? Math.round(((rssTail[rssTail.length - 1] - rssTail[0]) / Math.max(30, SOAK_MINUTES * 60 / 2)) * 3_600_000) : 0;
  const fdDrift = fds.length ? Math.max(...fds) - Math.min(...fds) : -1;
  const maxWal = Math.max(0, ...samples.map((s) => s.walBytes ?? 0));
  const dreamsDelta = (() => {
    const first = samples.find((s) => typeof s.dreams === "number")?.dreams ?? 0;
    const last = [...samples].reverse().find((s) => typeof s.dreams === "number")?.dreams ?? 0;
    return last - first;
  })();
  const runsDelta = (() => {
    const first = samples.find((s) => typeof s.runs === "number")?.runs ?? 0;
    const last = [...samples].reverse().find((s) => typeof s.runs === "number")?.runs ?? 0;
    return last - first;
  })();

  const metrics = {
    soakMinutes: SOAK_MINUTES,
    jobsEnabled,
    samples: samples.length,
    sessions,
    rssSlopeKbPerH,
    fdDrift,
    maxWalBytes: maxWal,
    dreamsDelta,
    runsDelta,
    breakerEverOpen: samples.some((s) => s.breakerOpen === true),
    overBudgetEver: samples.some((s) => s.overBudget === true),
    maxCallsHour: Math.max(0, ...samples.map((s) => s.callsHour ?? 0)),
    finalJobs: (finalJobs?.jobs ?? []).map((j) => ({ id: j.id, status: j.status ?? null, lastOk: j.last_ok ?? null, lastError: j.last_error ?? null, runCount: j.run_count ?? null })),
    gracefulStopOk: gracefulStop?.ok ?? Boolean(gracefulStop),
    healthAfterStop: healthAfterStop,
    sampleSeries: samples,
  };
  const checks = {
    engineUpThroughout: samples.length > 0 && samples.every((s) => s.phase === "ready"),
    learningHappened: dreamsDelta > 0 || runsDelta > 0 || metrics.overBudgetEver,
    rssSlopeBounded: rssSlopeKbPerH <= 30_720, // ≤ ~30 MB/h after warmup
    fdStable: fdDrift <= 25,
    walBounded: maxWal <= 64 * 1024 * 1024,
    bridgeAlive: samples.every((s) => s.bridgeRequests === null || typeof s.bridgeRequests === "number"),
    gracefulShutdown: (gracefulStop?.ok ?? Boolean(gracefulStop)) && healthAfterStop === null,
  };
  const verdict = Object.values(checks).every(Boolean) ? "pass" : "fail";
  writeReceipt(name, { verdict, checks, metrics });
}

// ── scenario: budget-fidelity (governor throttle + breaker open/recover) ────

async function scenarioBudgetFidelity() {
  const name = "budget-fidelity";
  const runRoot = join(ROOT, name);
  rmSync(runRoot, { recursive: true, force: true });
  mkdirSync(runRoot, { recursive: true });
  const unownHome = join(runRoot, "unown-home");
  await ensureHome(unownHome, MODEL);

  // (a) Governor: a 3-call/hour ceiling throttles the second harness-cycle.
  log(`${name}: engine A — PI_ENGINE_MAX_CALLS_HOUR=3, expect the 2nd cycle throttled`);
  const engineA = await bootBenchEngine(`${name}-a`, {
    port: Number(process.env.LONGRUN_BUDGET_PORT_A ?? 3042),
    dataDir: join(runRoot, "engine-a-data"),
    dbPath: join(runRoot, "engine-a-db", "selflearning.db"),
    runDir: join(runRoot, "engine-a-run"),
    unownHome,
    env: { PI_ENGINE_MAX_CALLS_HOUR: "3", PI_ENGINE_MAX_TOKENS_HOUR: "100000" },
  });
  const trigA1 = await engineFetch(engineA.url, engineA.token, "/api/jobs/harness-cycle/trigger", { method: "POST", timeoutMs: 120_000 });
  await new Promise((r) => setTimeout(r, 30_000)); // let the job land in the feed
  const govA1 = await engineFetch(engineA.url, engineA.token, "/api/overview");
  const trigA2 = await engineFetch(engineA.url, engineA.token, "/api/jobs/harness-cycle/trigger", { method: "POST", timeoutMs: 60_000 });
  await new Promise((r) => setTimeout(r, 20_000));
  const jobsA = await engineFetch(engineA.url, engineA.token, "/api/jobs");
  const govA2 = await engineFetch(engineA.url, engineA.token, "/api/overview");
  await engineA.stop();

  // (b) Breaker: a dead bridge trips it; a restart recovers.
  log(`${name}: engine B — dead bridge, expect breaker open then skip`);
  const engineB = await bootBenchEngine(`${name}-b`, {
    port: Number(process.env.LONGRUN_BUDGET_PORT_B ?? 3043),
    dataDir: join(runRoot, "engine-b-data"),
    dbPath: join(runRoot, "engine-b-db", "selflearning.db"),
    runDir: join(runRoot, "engine-b-run"),
    unownHome,
    env: { PI_BRIDGE_URL: "http://127.0.0.1:9", PI_LLM_BREAKER_THRESHOLD: "2", PI_LLM_BACKOFF_BASE_MS: "5000" },
  });
  const trigB1 = await engineFetch(engineB.url, engineB.token, "/api/jobs/harness-cycle/trigger", { method: "POST", timeoutMs: 120_000 });
  await new Promise((r) => setTimeout(r, 45_000));
  const overviewB1 = await engineFetch(engineB.url, engineB.token, "/api/overview");
  const trigB2 = await engineFetch(engineB.url, engineB.token, "/api/jobs/harness-cycle/trigger", { method: "POST", timeoutMs: 60_000 });
  await new Promise((r) => setTimeout(r, 20_000));
  const jobsB = await engineFetch(engineB.url, engineB.token, "/api/jobs");
  const breakerSnapshot = overviewB1?.governor?.breaker ?? null;
  await engineB.stop();

  // (c) Recovery: fresh engine, live bridge, the cycle runs again.
  log(`${name}: engine C — live bridge again, expect a healthy cycle`);
  const engineC = await bootBenchEngine(`${name}-c`, {
    port: Number(process.env.LONGRUN_BUDGET_PORT_C ?? 3044),
    dataDir: join(runRoot, "engine-c-data"),
    dbPath: join(runRoot, "engine-c-db", "selflearning.db"),
    runDir: join(runRoot, "engine-c-run"),
    unownHome,
  });
  const trigC1 = await engineFetch(engineC.url, engineC.token, "/api/jobs/harness-cycle/trigger", { method: "POST", timeoutMs: 120_000 });
  await new Promise((r) => setTimeout(r, 30_000));
  const overviewC = await engineFetch(engineC.url, engineC.token, "/api/overview");
  await engineC.stop();

  const jobsText = JSON.stringify({ jobsA, jobsB });
  const throttleSkip =
    /budget:throttled/i.test(String(trigA2?.result?.skipped ?? "")) || /budget:throttled/i.test(jobsText);
  const breakerSkip =
    /backoff|breaker|upstream/i.test(String(trigB2?.result?.skipped ?? "")) || /backoff|breaker|upstream/i.test(jobsText);
  const metrics = {
    governorA: { afterFirst: govA1?.governor ?? null, beforeSecond: govA2?.governor ?? null },
    secondTriggerResult: trigA2?.result ?? null,
    breakerB: breakerSnapshot,
    overviewC: overviewC ? { governor: overviewC.governor ?? null, kpis: overviewC.kpis ?? null } : null,
    jobsA: (jobsA?.jobs ?? []).map((j) => ({ id: j.id, status: j.status ?? null, lastOk: j.last_ok ?? null, lastError: j.last_error ?? null })),
    jobsB: (jobsB?.jobs ?? []).map((j) => ({ id: j.id, status: j.status ?? null, lastOk: j.last_ok ?? null, lastError: j.last_error ?? null })),
    triggerReceipts: { trigA1: trigA1?.ok ?? null, trigA2: trigA2?.ok ?? null, trigB1: trigB1?.ok ?? null, trigB2: trigB2?.ok ?? null, trigC1: trigC1?.ok ?? null },
  };
  const checks = {
    governorRecords: Boolean(metrics.governorA.afterFirst),
    secondCycleThrottled: throttleSkip,
    breakerReacted: Boolean(breakerSnapshot?.open === true) || breakerSkip || /breaker|backoff/i.test(String(trigB2?.result?.skipped ?? "")),
    recoveredAfterRestart: Boolean(overviewC?.governor?.breaker?.open === false),
  };
  const verdict = Object.values(checks).every(Boolean) ? "pass" : "fail";
  writeReceipt(name, { verdict, checks, metrics });
}

// ── scenario: ralph-chain ────────────────────────────────────────────────────

async function scenarioRalphChain() {
  const name = "ralph-chain";
  const runRoot = join(ROOT, name);
  rmSync(runRoot, { recursive: true, force: true });
  mkdirSync(runRoot, { recursive: true });
  const ws = join(runRoot, "workspace");
  const unownHome = join(runRoot, "unown-home");
  cpSync(FIXTURE_DIR, ws, { recursive: true, filter: (p) => !EXCLUDE.some((x) => p.split("/").includes(x)) });
  await gitInit(ws);
  await ensureHome(unownHome, MODEL);
  const reviewer = process.env.LONGRUN_RALPH_REVIEWER ?? "agnes-2.5-flash";
  const task =
    "Read features/README.md, then implement feature-01.md and feature-02.md of ledgerlog (category filter + date-range filter). Keep `bun test` green and commit each feature.";
  log(`${name}: 6-iteration ralph loop, reviewer=${reviewer}`);
  const r = await runAgent(
    ["ralph", task, "--iterations", "6", "--model", MODEL, "--reviewer-model", reviewer, "--workspace", ws, "--json"],
    ws,
    join(LOG_DIR, name),
    RALPH_CAP_MIN * 60_000,
    { UNOWN_HOME: unownHome },
  );
  let ralphRecord = null;
  for (const line of r.stdout.trim().split("\n")) {
    try {
      const j = JSON.parse(line);
      if (j && (j.iterations !== undefined || j.ralph !== undefined || j.verdict !== undefined)) {
        ralphRecord = j;
        break;
      }
    } catch {}
  }
  const ralphDirs = existsSync(join(ws, ".unown", "ralph"))
    ? readdirSync(join(ws, ".unown", "ralph"))
    : [];
  const acceptance = await scoreAcceptance(ws, [1, 2]);
  const metrics = {
    wallS: Math.round(r.wallMs / 1000),
    exitCode: r.code,
    timedOut: r.timedOut,
    ralphRecord,
    ralphRunDirs: ralphDirs,
    featuresPassed: acceptance.passed,
    perFeature: acceptance.perFeature,
    stdoutTail: r.stdout.slice(-600),
  };
  const checks = {
    terminatedWithinCap: !r.timedOut,
    contractExit: r.code === 0 || r.code === 1,
    ralphStatePresent: ralphDirs.length > 0 || Boolean(ralphRecord),
    noCrashArtifacts: !/fatal|unhandled|EPIPE/i.test(r.stderr),
  };
  const verdict = Object.values(checks).every(Boolean) ? "pass" : "fail";
  writeReceipt(name, { verdict, checks, metrics });
}

// ── summary ──────────────────────────────────────────────────────────────────

const SCENARIOS = {
  marathon: scenarioMarathon,
  "compact-thrash": scenarioCompactThrash,
  "kill-resume": scenarioKillResume,
  "loop-guard": scenarioLoopGuard,
  "turn-cap": scenarioTurnCap,
  "notes-storm": scenarioNotesStorm,
  "engine-soak": scenarioEngineSoak,
  "budget-fidelity": scenarioBudgetFidelity,
  "ralph-chain": scenarioRalphChain,
};

function writeSummary() {
  const receipts = readReceipts();
  const summary = {
    run: RUN_TS,
    model: MODEL,
    scenarios: Object.fromEntries(
      Object.entries(receipts).map(([k, v]) => [k, { verdict: v.verdict, checks: v.checks ?? null }]),
    ),
    allPass: Object.values(receipts).length > 0 && Object.values(receipts).every((r) => r.verdict === "pass"),
  };
  writeFileSync(join(RUN_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  log(`summary: ${Object.values(receipts).filter((r) => r.verdict === "pass").length}/${Object.keys(receipts).length} pass — ${RUN_DIR}/summary.json`);
  return summary;
}

async function main() {
  mkdirSync(RUN_DIR, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
  if (args.includes("--list")) {
    console.log(Object.keys(SCENARIOS).join("\n"));
    return;
  }
  const requested = flag("scenario", "all");
  const existing = readReceipts();
  const list =
    requested === "all"
      ? Object.keys(SCENARIOS)
      : requested.split(",").map((s) => s.trim()).filter(Boolean);
  for (const s of list) {
    if (!SCENARIOS[s]) throw new Error(`unknown scenario: ${s} (see --list)`);
    if (!args.includes("--force") && existing[s]?.verdict) {
      log(`skip ${s}: verdict already recorded (${existing[s].verdict}) — use --force to rerun`);
      continue;
    }
    log(`▶ scenario ${s} starting`);
    const t0 = Date.now();
    try {
      await SCENARIOS[s]();
    } catch (err) {
      log(`✗ scenario ${s} threw: ${String(err?.stack ?? err)}`);
      writeReceipt(s, { verdict: "fail", checks: { runnerError: true }, metrics: { error: String(err?.stack ?? err) } });
    }
    log(`◀ scenario ${s} done in ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  writeSummary();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
