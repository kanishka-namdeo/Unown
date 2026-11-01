#!/usr/bin/env node
/**
 * issue30_watcher.mjs — the armed /proc watcher for issue #30 (unown -p exit hang).
 *
 * What it does: runs `unown -p "Reply with exactly: UNOWN_OK"` in a bounded
 * loop. Every run is guarded by --timeout-ms; a normal run finishes in ~1-4 s.
 * If a run outlives the guard (the hang signature: answer flushed, process
 * still alive), the watcher captures /proc-level evidence for the process and
 * its threads BEFORE SIGKILL — exactly what issue #30 asks for:
 *   (a) a /proc-level capture the next time it happens live, watcher armed.
 *
 * Lanes:
 *   --churn idle   (default) plain loop against whatever the engine is doing
 *   --churn dream  trigger POST /api/dreams/run before (and halfway through)
 *                  the loop — the issue's correlation window is active engine
 *                  harness/dream activity, and all prior clean probes ran
 *                  against an idle engine.
 *
 * Evidence per hang lands in <out>/hang-<run>-<ts>/ (never environ — no
 * secrets are captured; cmdline only carries the -p prompt).
 *
 * Exit codes: 0 = no hang (non-repro receipt), 1 = hang captured, 2 = usage.
 * Zero dependencies (node >= 20 or bun). Node builtins only.
 *
 * Usage:
 *   node scripts/issue30_watcher.mjs --runs 8 --timeout-ms 45000 \
 *        --churn idle --out /tmp/issue30/idle
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const PROMPT = "Reply with exactly: UNOWN_OK";
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const RUNS = Number(opt("runs", "8"));
const TIMEOUT_MS = Number(opt("timeout-ms", "45000"));
const CHURN = opt("churn", "idle");
const OUT = path.resolve(opt("out", "/tmp/issue30/watch"));
const UNOWN_BIN = opt("bin", process.env.UNOWN_BIN || path.join(process.env.HOME || "/home/z", ".local/bin/unown"));
const REPO = path.resolve(opt("repo", process.cwd()));
const UNOWN_HOME = process.env.UNOWN_HOME || "/home/z/my-project/unown-home";

const usage = () => { console.error("usage: issue30_watcher.mjs --runs N --timeout-ms MS --churn idle|dream --out DIR"); process.exit(2); };
if (!Number.isFinite(RUNS) || RUNS < 1 || !Number.isFinite(TIMEOUT_MS) || TIMEOUT_MS < 5000 || !["idle", "dream"].includes(CHURN)) usage();
fs.mkdirSync(OUT, { recursive: true });

const token = (() => {
  for (const p of [path.join(UNOWN_HOME, "engine.token"), path.join(REPO, "data/self-learning/engine.token")]) {
    try { return fs.readFileSync(p, "utf8").trim(); } catch {}
  }
  return "";
})();

function apiCall(method, urlPath, body) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: 3030, method, path: urlPath, headers: token ? { authorization: `Bearer ${token}` } : {}, timeout: 8000 }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data.slice(0, 400) }));
    });
    req.on("error", () => resolve({ status: 0, body: "unreachable" }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "timeout" }); });
    if (body) req.write(body);
    req.end();
  });
}

async function bridgeHealth() {
  return new Promise((resolve) => {
    http.get({ host: "127.0.0.1", port: 3031, path: "/health", timeout: 8000 }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => { try { const j = JSON.parse(d); resolve({ ok: j.ok, requests: j.requests, inFlight: j.lanes?.inFlight, queued: j.lanes?.queued }); } catch { resolve({ ok: null }); } });
    }).on("error", () => resolve({ ok: null }));
  });
}

/** Capture /proc evidence for a pid — the issue-requested snapshot, pre-kill. */
function captureProc(pid, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const safe = (file, src) => { try { fs.writeFileSync(path.join(dir, file), fs.readFileSync(src)); } catch (e) { try { fs.writeFileSync(path.join(dir, file), `READ-ERROR ${e.code || e.message}`); } catch {} } };
  safe("proc-status.txt", `/proc/${pid}/status`);
  safe("proc-stat.txt", `/proc/${pid}/stat`);
  safe("proc-wchan.txt", `/proc/${pid}/wchan`);
  safe("proc-syscall.txt", `/proc/${pid}/syscall`);
  safe("proc-sched.txt", `/proc/${pid}/sched`);
  safe("proc-cmdline.txt", `/proc/${pid}/cmdline`);
  safe("proc-cgroup.txt", `/proc/${pid}/cgroup`);
  safe("smaps-rollup.txt", `/proc/${pid}/smaps_rollup`);
  safe("net-tcp.txt", "/proc/net/tcp");
  safe("net-tcp6.txt", "/proc/net/tcp6");
  try {
    const fds = fs.readdirSync(`/proc/${pid}/fd`).map((f) => {
      let tgt = "?";
      try { tgt = fs.readlinkSync(`/proc/${pid}/fd/${f}`); } catch (e) { tgt = `ERR:${e.code}`; }
      return `${f} -> ${tgt}`;
    });
    fs.writeFileSync(path.join(dir, "proc-fds.txt"), fds.join("\n") + "\n");
  } catch (e) { try { fs.writeFileSync(path.join(dir, "proc-fds.txt"), `READ-ERROR ${e.code || e.message}`); } catch {} }
  try {
    const tasks = fs.readdirSync(`/proc/${pid}/task`);
    const lines = tasks.map((t) => {
      let sc = "?", wc = "?";
      try { sc = fs.readFileSync(`/proc/${pid}/task/${t}/syscall`, "utf8").trim(); } catch (e) { sc = `ERR:${e.code}`; }
      try { wc = fs.readFileSync(`/proc/${pid}/task/${t}/wchan`, "utf8").trim(); } catch (e) { wc = `ERR:${e.code}`; }
      return `task ${t}: syscall=${sc} wchan=${wc}`;
    });
    fs.writeFileSync(path.join(dir, "proc-tasks.txt"), lines.join("\n") + "\n");
  } catch (e) { try { fs.writeFileSync(path.join(dir, "proc-tasks.txt"), `READ-ERROR ${e.code || e.message}`); } catch {} }
  // service state at capture time
  fs.writeFileSync(path.join(dir, "service-state.json"), JSON.stringify({ capturedAt: new Date().toISOString(), engine: engineHealthCache, bridge: bridgeHealthCache }, null, 2));
  try {
    const usage = fs.readFileSync(path.join(REPO, ".run/usage-log.jsonl"), "utf8").trim().split("\n").slice(-5).join("\n");
    fs.writeFileSync(path.join(dir, "usage-tail.txt"), usage + "\n");
  } catch {}
}

let engineHealthCache = null, bridgeHealthCache = null;

async function runOnce(i) {
  const t0 = Date.now();
  let stdout = "";
  const child = spawn(UNOWN_BIN, ["-p", PROMPT], { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (c) => (stdout += c));
  let stderr = "";
  child.stderr.on("data", (c) => (stderr += c));
  let hung = false;
  let evidenceDir = null;
  const guard = setTimeout(async () => {
    hung = true;
    engineHealthCache = await apiCall("GET", "/api/health");
    bridgeHealthCache = await bridgeHealth();
    evidenceDir = path.join(OUT, `hang-run${i + 1}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    captureProc(child.pid, evidenceDir);
    child.kill("SIGKILL");
  }, TIMEOUT_MS);
  const rc = await new Promise((resolve) => child.on("close", resolve));
  clearTimeout(guard);
  const ms = Date.now() - t0;
  const answer = stdout.trim().split("\n")[0]?.slice(0, 40) ?? "";
  return { run: i + 1, exit: rc, ms, answer, hung, evidenceDir };
}

async function churn(label) {
  if (CHURN !== "dream") return;
  const r = await apiCall("POST", "/api/dreams/run", "{}");
  console.log(`[churn:${label}] POST /api/dreams/run -> ${r.status} ${r.body.slice(0, 120)}`);
}

const results = [];
console.log(`issue30 watcher — runs=${RUNS} timeoutMs=${TIMEOUT_MS} churn=${CHURN} out=${OUT}`);
console.log(`repo=${REPO} bin=${UNOWN_BIN} engineToken=${token ? "yes" : "NO"}`);
await churn("pre");
for (let i = 0; i < RUNS; i++) {
  if (i === Math.floor(RUNS / 2)) await churn("mid");
  const r = await runOnce(i);
  results.push(r);
  console.log(`run${r.run}: exit=${r.exit} ${r.ms}ms answer='${r.answer}'${r.hung ? "  <-- HANG, evidence: " + r.evidenceDir : ""}`);
  await new Promise((res) => setTimeout(res, 1500));
}
const overview = await apiCall("GET", "/api/overview");
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify({ startedAt: new Date().toISOString(), runs: RUNS, timeoutMs: TIMEOUT_MS, churn: CHURN, engineOverview: { status: overview.status, body: overview.body.slice(0, 300) }, results }, null, 2));
const hangs = results.filter((r) => r.hung);
console.log(`---\n${hangs.length ? `HANGS: ${hangs.length}/${RUNS} — evidence under ${OUT}` : `no hang in ${RUNS} runs (non-repro receipt) — summary.json written`}`);
process.exit(hangs.length ? 1 : 0);
