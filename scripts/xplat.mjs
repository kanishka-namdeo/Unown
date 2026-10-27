#!/usr/bin/env node
// scripts/xplat.mjs — the cross-platform test driver.
//
// The agent-facing steering wheel over the XPlat workflow
// (.github/workflows/xplat.yml): dispatch a scenario on any ref, correlate
// the run back to this invocation, watch it to a verdict, and pull the
// evidence (failed-job logs, junit/artifact receipts) back to this machine.
// Everything a mid-session agent needs to answer "is this green on all three
// OSes?" without pushing a commit to find out.
//
// Usage (repo root; plain node >= 20 or bun — zero dependencies either way):
//   node scripts/xplat.mjs scenarios
//   node scripts/xplat.mjs local [--scenario smoke|core|full|release-verify] [--keep-going]
//   node scripts/xplat.mjs dispatch --scenario core [--os all|ubuntu-latest|macos-latest|macos-intel|windows-latest]
//                                   [--ref main] [--watch] [--interval 15] [--timeout 2700]
//   node scripts/xplat.mjs status  [<runId|latest>] [--json]
//   node scripts/xplat.mjs watch   [<runId|latest>] [--interval 15] [--timeout 2700] [--json]
//   node scripts/xplat.mjs logs    [<runId|latest>] [--job <name-substring>] [--failed-only]
//   node scripts/xplat.mjs artifacts [<runId|latest>] [--download] [--out <dir>]
//   node scripts/xplat.mjs cancel  <runId>
//   node scripts/xplat.mjs rerun   <runId> [--failed]
//   node scripts/xplat.mjs runs    [-L 10]
//
// AUTH (in priority order):
//   1. $XPLAT_GITHUB_TOKEN  — dedicated driver token if you keep one
//   2. $GITHUB_TOKEN        — the same var the agent stack already uses
//   3. the git remote URL    — this repo's convention: the PAT lives only in
//      the remote (https://x-access-token:<pat>@github.com/owner/repo.git),
//      so a fresh clone can drive CI with zero configuration. NEVER printed,
//      never written anywhere; only the Authorization header sees it.
//
// EXIT CODES (the contract the driving agent scripts against):
//   0  green (run succeeded / local steps passed)
//   1  red (run failed / a local step failed / HTTP error after retries)
//   2  the run was cancelled or no longer exists
//   3  startup_failure / timed_out
//   4  usage error (bad flags, unknown command)
//   5  auth error (401/403 — the token cannot dispatch or read this repo)
//
// RATE LIMITS. The REST API allows 5000 req/h per PAT; watch polls every 15s
// by default (~240 req/h) and honors Retry-After / x-ratelimit-reset on the
// rare 403/429. GitHub discards a dispatched run that stays unclaimed too
// long, so the watch timeout default (45 min) sits above the slowest
// scenario (release-verify ~40 min) and below the queue ceiling.
//
// The pure functions below (parseRemote, osMatrix, conclusionExit,
// isCorrelatedRun, newRunId, scenarioCatalog, LOCAL_SCENARIOS) are exported
// and pinned by scripts/xplat.test.mjs — run `node --test scripts/xplat.test.mjs`.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

// Run the CLI only when invoked as the main module — the pinning suite
// (scripts/xplat.test.mjs) imports the pure functions above this guard.
// (fileURLToPath(import.meta.url), not import.meta.dir: the driver must run
// identically under node and bun, and .dir is a Bun-only extension.)
const invokedAsMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const WORKFLOW_FILE = "xplat.yml";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// The scenario catalog — the single source of truth for both the docs page and
// the tests. Levels escalate: every level runs everything below it.
// ---------------------------------------------------------------------------

export const SCENARIOS = {
  smoke: {
    level: 1,
    summary: "fast confidence: installer + engine suite + CLI smokes, per selected OS",
    remote: "~6-9 min",
    local: "~3-4 min",
    when: "after any engine/pi-repo change; the default post-edit check",
  },
  core: {
    level: 2,
    summary: "+ integration suite + full-stack lifecycle gate (all OSes)",
    remote: "~9-13 min",
    local: "~4-6 min",
    when: "engine plumbing, start/stop, sandbox, hooks — anything cross-cutting",
  },
  full: {
    level: 3,
    summary: "+ every CI gate: lint/typecheck/unit/coverage/docs/claims, security, sandbox, build, E2E, mermaid",
    remote: "~15-25 min",
    local: "~8-12 min (e2e/mermaid/security lanes are dispatch-only — see notes)",
    when: "before a release tag; after landing-page or generator changes",
  },
  "release-verify": {
    level: 4,
    summary: "the release path minus publish: six binaries built + booted on six runners (incl. windows-11-arm)",
    remote: "~25-40 min",
    local: "~2-4 min (plan + suites only — the builds happen in CI)",
    when: "right before tagging a release; after any change to build-artifacts/manifest/installers",
  },
};

export const OS_CHOICES = {
  all: ["ubuntu-latest", "macos-latest", "windows-latest"],
  "ubuntu-latest": ["ubuntu-latest"],
  "macos-latest": ["macos-latest"],
  // the darwin-x64 gap leg: ci.yml's macos-latest is arm64-only, but a
  // darwin-x64 archive ships in every release.
  "macos-intel": ["macos-15-intel"],
  "windows-latest": ["windows-latest"],
};

export function osMatrix(os) {
  const m = OS_CHOICES[os];
  if (!m) {
    throw new Error(
      `unknown os "${os}" — choices: ${Object.keys(OS_CHOICES).join(", ")}`,
    );
  }
  return m;
}

// The exit code for a completed run's conclusion (the contract above).
export function conclusionExit(conclusion) {
  switch (conclusion) {
    case "success":
      return 0;
    case "failure":
      return 1;
    case "cancelled":
      return 2;
    case "startup_failure":
    case "timed_out":
      return 3;
    default:
      return 1;
  }
}

// A short, slug-safe correlation key: lands in run-name + artifact names.
export function newRunId(now = Date.now()) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `x${now.toString(36)}${rand}`;
}

// Does this workflow run belong to the dispatch we just fired?
// - event must be workflow_dispatch
// - created at/after our dispatch timestamp (2s clock tolerance)
// - on the ref we dispatched (head_branch; refs/tags dispatch is not used)
// - if we minted a run_id, the run-name must carry it (exact word match on
//   the " · " separators — "xplat smoke · all · x123abc")
export function isCorrelatedRun(run, { t0, branch, runId }) {
  if (!run || run.event !== "workflow_dispatch") return false;
  if (branch && run.head_branch !== branch) return false;
  if (t0 && Date.parse(run.created_at) < t0 - 2000) return false;
  if (runId) {
    const parts = String(run.name || "").split(" · ");
    if (!parts.includes(runId)) return false;
  }
  return true;
}

// Parse a git remote URL into owner/repo (+ PAT when embedded).
// Handles: https://x-access-token:PAT@github.com/o/r.git
//          https://USER:PAT@github.com/o/r.git   (git credential stores)
//          https://PAT@github.com/o/r.git
//          https://github.com/o/r.git
//          git@github.com:o/r.git
export function parseRemote(url) {
  const u = String(url || "").trim();
  // Greedy (.+) up to the LAST @github.com: the host separator, not the
  // token, is the only trustworthy boundary. The userinfo, when present,
  // is either a bare PAT or a credential PAIR (x-access-token:PAT from
  // checkout actions, USER:PAT from git credential stores — found live
  // 2026-10-27: the USER:PAT form fed "USER:PAT" whole into the
  // Authorization header and every driver dispatch 401'd). GitHub never
  // issues PATs containing ':', so a colon in the userinfo splits user
  // from token at the FIRST colon; a bare colon-less PAT passes through
  // unchanged.
  let m = u.match(/^https:\/\/(.+)@github\.com\/([^\/]+)\/([^\/#?]+?)(?:\.git)?$/);
  if (m) {
    const userinfo = m[1];
    const token = userinfo.includes(":") ? userinfo.slice(userinfo.indexOf(":") + 1) : userinfo;
    return { token, owner: m[2], repo: m[3] };
  }
  m = u.match(/^https:\/\/github\.com\/([^\/]+)\/([^\/#?]+?)(?:\.git)?$/);
  if (m) return { token: null, owner: m[1], repo: m[2] };
  m = u.match(/^git@github\.com:([^\/]+)\/([^\/#?]+?)(?:\.git)?$/);
  if (m) return { token: null, owner: m[1], repo: m[2] };
  throw new Error(`cannot parse a github remote out of: ${u}`);
}

// ---------------------------------------------------------------------------
// Local scenario steps — the fast inner loop before any dispatch. Each step
// is { name, cwd, cmd, env? } run from the repo root with bun resolved the
// same way scripts/lib.ts resolves it (PATH, then ~/.bun/bin).
// ---------------------------------------------------------------------------

export const LOCAL_SCENARIOS = {
  smoke: [
    { name: "engine unit suite", cwd: "pi-repo/packages/self-learning", cmd: ["bun", "test", "test/"] },
    { name: "version consistency", cmd: null }, // special-cased in runLocal
    { name: "CLI boot (--help)", cmd: ["bun", "bin/unown", "--help"] },
    { name: "doctor table", cmd: null },
  ],
  core: [
    { name: "engine unit suite", cwd: "pi-repo/packages/self-learning", cmd: ["bun", "test", "test/"] },
    { name: "engine integration suite", cwd: "pi-repo/packages/self-learning", cmd: ["bun", "test", "test/integration/"], env: { PI_TEST_SCOPE: "integration" } },
    { name: "bridge suite", cwd: "mini-services/llm-bridge", cmd: ["bun", "test"] },
    { name: "version consistency", cmd: null },
    { name: "CLI boot (--help)", cmd: ["bun", "bin/unown", "--help"] },
    { name: "doctor table", cmd: null },
  ],
  full: [
    { name: "engine unit suite", cwd: "pi-repo/packages/self-learning", cmd: ["bun", "test", "test/"] },
    { name: "engine integration suite", cwd: "pi-repo/packages/self-learning", cmd: ["bun", "test", "test/integration/"], env: { PI_TEST_SCOPE: "integration" } },
    { name: "bridge suite", cwd: "mini-services/llm-bridge", cmd: ["bun", "test"] },
    { name: "version consistency", cmd: null },
    { name: "CLI boot (--help)", cmd: ["bun", "bin/unown", "--help"] },
    { name: "doctor table", cmd: null },
    { name: "lint (landing)", cmd: ["bunx", "eslint", "src"] },
    { name: "typecheck (landing)", cmd: ["bun", "run", "typecheck"] },
    { name: "unit (landing)", cmd: ["bun", "test", "src"] },
    { name: "changed-line coverage", cmd: null },
    { name: "docs links and anchors", cmd: null },
    { name: "theme contract", cmd: ["bun", "scripts/check_theme.mjs"] },
    { name: "landing generated-data contracts", cmd: null },
    { name: "production build (landing)", cmd: ["bun", "run", "build"] },
  ],
  "release-verify": [
    { name: "engine unit suite", cwd: "pi-repo/packages/self-learning", cmd: ["bun", "test", "test/"] },
    { name: "bridge suite", cwd: "mini-services/llm-bridge", cmd: ["bun", "test"] },
    { name: "version consistency", cmd: null },
    { name: "artifact builder plan (dry-run)", cmd: ["bun", "scripts/build-artifacts.ts", "--dry-run"] },
    { name: "artifact builder suite", cmd: ["node", "--test", "scripts/build-artifacts.test.mjs"] },
    { name: "release manifest suite", cmd: ["node", "--test", "scripts/release-manifest.test.mjs"] },
  ],
};

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

function resolveToken() {
  if (process.env.XPLAT_GITHUB_TOKEN) return process.env.XPLAT_GITHUB_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const origin = captureGit(["git", "remote", "get-url", "origin"]);
  if (origin) {
    try {
      const r = parseRemote(origin.stdout);
      if (r.token) return r.token;
    } catch {
      /* not a github https remote with a token — fall through */
    }
  }
  return null;
}

function resolveRepo(explicit) {
  if (explicit) {
    const [owner, repo] = explicit.split("/");
    if (!owner || !repo) die(4, `--repo must look like owner/name, got "${explicit}"`);
    return { owner, repo };
  }
  const origin = captureGit(["git", "remote", "get-url", "origin"]);
  if (!origin) die(1, "no git remote 'origin' — pass --repo owner/name");
  try {
    return parseRemote(origin.stdout);
  } catch (e) {
    die(1, e.message);
  }
}

function captureGit(cmd) {
  const p = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", cwd: REPO_ROOT });
  return p.status === 0 ? { stdout: p.stdout.trim() } : null;
}

async function api(token, url, opts = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "unown-xplat-driver",
    ...(opts.body ? { "Content-Type": "application/json" } : {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(url.startsWith("http") ? url : API + url, {
        method: opts.method || (opts.body ? "POST" : "GET"),
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        redirect: opts.redirect || "follow",
      });
    } catch (e) {
      if (attempt === 0) continue;
      die(1, `network error talking to ${url}: ${e.message}`);
    }
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      const retry = Number(res.headers.get("retry-after") || 0);
      const remaining = Number(res.headers.get("x-ratelimit-remaining") || "1");
      if ((retry > 0 || remaining === 0) && attempt === 0) {
        const reset = Number(res.headers.get("x-ratelimit-reset") || 0) * 1000;
        const waitMs = retry > 0 ? retry * 1000 : Math.max(1000, Math.min(reset - Date.now(), 60_000));
        console.log(`  rate limited — waiting ${Math.round(waitMs / 1000)}s`);
        await sleep(waitMs);
        continue;
      }
      if (res.status === 401) die(5, "401 Unauthorized — the token cannot authenticate to the GitHub API");
      // 403 can be permissions OR rate limit; surface both possibilities.
      const body = await res.text().catch(() => "");
      die(5, `${res.status} from ${url} — token lacks permission or is throttled: ${body.slice(0, 300)}`);
    }
    break;
  }
  return res;
}

async function apiJson(token, url, opts = {}) {
  const res = await api(token, url, opts);
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) die(1, `${res.status} from ${url}: ${text.slice(0, 400)}`);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    die(1, `unparseable JSON from ${url}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function die(code, msg) {
  console.error(`xplat: ${msg}`);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdDispatch(args) {
  const a = parseArgs(args, { scenario: "smoke", os: "all", ref: null, repo: null, watch: false, interval: 15, timeout: 2700 });
  const scenario = a.scenario;
  if (!SCENARIOS[scenario]) die(4, `unknown scenario "${scenario}" — choices: ${Object.keys(SCENARIOS).join(", ")}`);
  try {
    osMatrix(a.os);
  } catch (e) {
    die(4, e.message);
  }

  const token = resolveToken();
  if (!token) {
    die(5, "no token: set XPLAT_GITHUB_TOKEN/GITHUB_TOKEN or clone with the PAT in the remote URL");
  }
  const { owner, repo } = resolveRepo(a.repo);
  const ref = a.ref || captureGit(["git", "rev-parse", "--abbrev-ref", "HEAD"])?.stdout || "main";
  const runId = newRunId();
  const t0 = Date.now();

  console.log(`dispatching ${scenario} · ${a.os} · ${runId} on ${owner}/${repo}@${ref}`);
  // Opportunistic: the dispatch endpoint may return 200 + run details when
  // asked; the classic contract is 204 + no body, handled by correlation.
  let res = await api(token, `/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
    body: { ref, inputs: { scenario, os: a.os, run_id: runId }, return_run_details: true },
  });
  if (res.status === 400 || res.status === 422) {
    res = await api(token, `/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      body: { ref, inputs: { scenario, os: a.os, run_id: runId } },
    });
  }
  if (res.status !== 204 && res.status !== 200) {
    const text = await res.text().catch(() => "");
    die(1, `dispatch failed (${res.status}): ${text.slice(0, 400)}`);
  }
  let direct = null;
  if (res.status === 200) {
    try {
      direct = JSON.parse(await res.text());
    } catch { /* fall back to correlation */ }
  }

  let run = null;
  if (direct?.workflow_run_id) {
    run = await apiJson(token, `/repos/${owner}/${repo}/actions/runs/${direct.workflow_run_id}`);
  }
  if (!run) {
    // Correlate: poll the workflow's dispatch runs until ours appears.
    console.log("correlating the run (polling the dispatch list)…");
    for (let i = 0; i < 30 && !run; i++) {
      await sleep(2000);
      const list = await apiJson(
        token,
        `/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=10`,
      );
      const candidates = (list.workflow_runs || []).filter((r) =>
        isCorrelatedRun(r, { t0, branch: ref === "HEAD" ? null : ref, runId }),
      );
      run = candidates.sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at))[0];
    }
  }
  if (!run) die(1, "dispatch accepted but the run never appeared in the list (30s) — check the Actions tab");

  console.log(`run ${run.id}  ${run.html_url}`);
  console.log(`watch: node scripts/xplat.mjs watch ${run.id}`);
  if (a.watch) {
    await watchRun(token, { owner, repo }, run.id, a.interval, a.timeout);
  }
  return run.id;
}

async function findRun(token, ctx, idOrLatest) {
  if (idOrLatest && idOrLatest !== "latest" && /^\d+$/.test(idOrLatest)) {
    return apiJson(token, `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${idOrLatest}`);
  }
  const list = await apiJson(
    token,
    `/repos/${ctx.owner}/${ctx.repo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1`,
  );
  const r = list.workflow_runs?.[0];
  if (!r) die(1, "no XPlat runs yet — dispatch one first");
  return r;
}

function printRun(run) {
  console.log(`run ${run.id} · ${run.name}`);
  console.log(`  status: ${run.status}${run.conclusion ? ` (${run.conclusion})` : ""}`);
  console.log(`  ref: ${run.head_branch} @ ${run.head_sha?.slice(0, 8)} · ${run.event}`);
  console.log(`  url: ${run.html_url}`);
}

async function cmdStatus(args) {
  const a = parseArgs(args, { json: false, repo: null });
  const token = resolveToken() || die(5, "no token");
  const ctx = resolveRepo(a.repo);
  const run = await findRun(token, ctx, a.positional[0]);
  const jobs = await apiJson(token, `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${run.id}/jobs?filter=latest`);
  if (a.json) {
    console.log(JSON.stringify({ run, jobs: jobs.jobs }, null, 2));
    return;
  }
  printRun(run);
  for (const j of jobs.jobs || []) {
    const mark = j.status === "completed" ? (j.conclusion === "success" ? "✓" : j.conclusion === "skipped" ? "-" : "✗") : "…";
    console.log(`  ${mark} ${j.name} [${j.status}${j.conclusion ? "/" + j.conclusion : ""}]`);
    if (j.conclusion === "failure") {
      for (const s of j.steps || []) {
        if (s.conclusion === "failure") console.log(`      ✗ step: ${s.name}`);
      }
    }
  }
}

async function watchRun(token, ctx, runId, intervalS, timeoutS) {
  const t0 = Date.now();
  let lastStatus = "";
  while (true) {
    const run = await apiJson(token, `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${runId}`);
    if (!run) die(2, `run ${runId} no longer exists`);
    if (run.status !== lastStatus) {
      console.log(`[${new Date().toISOString().slice(11, 19)}] ${run.status}`);
      lastStatus = run.status;
    }
    if (run.status === "completed") {
      const jobs = await apiJson(token, `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${run.id}/jobs?filter=latest`);
      for (const j of jobs.jobs || []) {
        const mark = j.conclusion === "success" ? "✓" : j.conclusion === "skipped" ? "-" : "✗";
        console.log(`  ${mark} ${j.name}`);
        if (j.conclusion === "failure") {
          for (const s of j.steps || []) {
            if (s.conclusion === "failure") console.log(`      ✗ step: ${s.name}`);
          }
        }
      }
      console.log(`conclusion: ${run.conclusion}`);
      if (run.conclusion !== "success") {
        console.log(`failed logs: node scripts/xplat.mjs logs ${run.id} --failed-only`);
      }
      process.exit(conclusionExit(run.conclusion));
    }
    if (Date.now() - t0 > timeoutS * 1000) {
      console.error(`xplat: watch timeout (${timeoutS}s) — run ${runId} is still ${run.status}`);
      process.exit(1);
    }
    await sleep(intervalS * 1000);
  }
}

async function cmdWatch(args) {
  const a = parseArgs(args, { interval: 15, timeout: 2700, json: false, repo: null });
  const token = resolveToken() || die(5, "no token");
  const ctx = resolveRepo(a.repo);
  const run = await findRun(token, ctx, a.positional[0]);
  printRun(run);
  await watchRun(token, ctx, run.id, a.interval, a.timeout);
}

async function cmdLogs(args) {
  const a = parseArgs(args, { job: null, failedOnly: false, out: null, repo: null });
  const token = resolveToken() || die(5, "no token");
  const ctx = resolveRepo(a.repo);
  const run = await findRun(token, ctx, a.positional[0]);
  const jobs = await apiJson(token, `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${run.id}/jobs?filter=latest`);
  const outDir = path.join(REPO_ROOT, ".run", "xplat", "logs", String(run.id));
  mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const j of jobs.jobs || []) {
    if (a.job && !j.name.toLowerCase().includes(a.job.toLowerCase())) continue;
    if (a.failedOnly && j.conclusion !== "failure") continue;
    const res = await api(token, `/repos/${ctx.owner}/${ctx.repo}/actions/jobs/${j.id}/logs`, { redirect: "follow" });
    if (!res.ok) {
      console.log(`  (no logs for ${j.name}: ${res.status})`);
      continue;
    }
    const text = await res.text();
    const slug = j.name.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
    const file = path.join(outDir, `${String(++n).padStart(2, "0")}-${slug}.log`);
    writeFileSync(file, text, "utf8");
    console.log(`${file}  (${(text.length / 1024).toFixed(0)} KiB)`);
  }
  if (n === 0) console.log("no matching jobs with logs");
}

async function cmdArtifacts(args) {
  const a = parseArgs(args, { download: false, out: null, repo: null });
  const token = resolveToken() || die(5, "no token");
  const ctx = resolveRepo(a.repo);
  const run = await findRun(token, ctx, a.positional[0]);
  const list = await apiJson(token, `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${run.id}/artifacts`);
  const outDir = path.resolve(a.out || path.join(REPO_ROOT, ".run", "xplat", "artifacts", String(run.id)));
  for (const art of list.artifacts || []) {
    const expired = art.expired ? " (EXPIRED)" : "";
    console.log(`${art.name}  ${(art.size_in_bytes / 1024).toFixed(0)} KiB${expired}`);
    if (a.download && !art.expired) {
      const res = await api(token, `/repos/${ctx.owner}/${ctx.repo}/actions/artifacts/${art.id}/zip`);
      if (!res.ok) {
        console.log(`  (download failed: ${res.status})`);
        continue;
      }
      mkdirSync(outDir, { recursive: true });
      const buf = Buffer.from(await res.arrayBuffer());
      const file = path.join(outDir, `${art.name}.zip`);
      writeFileSync(file, buf);
      console.log(`  → ${file}`);
    }
  }
  if (!list.artifacts?.length) console.log("no artifacts on this run");
}

async function cmdCancel(args) {
  const a = parseArgs(args, { repo: null });
  const token = resolveToken() || die(5, "no token");
  const ctx = resolveRepo(a.repo);
  const runId = a.positional[0];
  if (!runId) die(4, "cancel needs a run id");
  const res = await api(token, `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${runId}/cancel`, { method: "POST" });
  if (res.status === 202) console.log(`cancel accepted for run ${runId}`);
  else if (res.status === 409) console.log(`run ${runId} already completed`);
  else die(1, `cancel failed (${res.status})`);
}

async function cmdRerun(args) {
  const a = parseArgs(args, { failed: false, repo: null });
  const token = resolveToken() || die(5, "no token");
  const ctx = resolveRepo(a.repo);
  const runId = a.positional[0];
  if (!runId) die(4, "rerun needs a run id");
  const url = a.failed
    ? `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${runId}/rerun-failed-jobs`
    : `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${runId}/rerun`;
  const res = await api(token, url, { method: "POST" });
  if (res.status === 201) console.log(`rerun ${a.failed ? "(failed jobs) " : ""}accepted for run ${runId}`);
  else die(1, `rerun failed (${res.status})`);
}

async function cmdRuns(args) {
  const a = parseArgs(args, { L: 10, repo: null });
  const token = resolveToken() || die(5, "no token");
  const ctx = resolveRepo(a.repo);
  const list = await apiJson(
    token,
    `/repos/${ctx.owner}/${ctx.repo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=${a.L}`,
  );
  for (const r of list.workflow_runs || []) {
    const when = r.created_at?.replace("T", " ").slice(0, 16);
    const mark = r.status === "completed" ? (r.conclusion === "success" ? "✓" : "✗") : "…";
    console.log(`${mark} ${r.id}  ${when}  ${r.name}  [${r.status}${r.conclusion ? "/" + r.conclusion : ""}]`);
  }
  if (!list.workflow_runs?.length) console.log("no XPlat runs yet");
}

// ---------------------------------------------------------------------------
// local — the fast inner loop (no GitHub involved)
// ---------------------------------------------------------------------------

function resolveBun() {
  if (process.env.XPLAT_BUN) return process.env.XPLAT_BUN;
  const which = spawnSync("bun", ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
  if (which.status === 0) return "bun";
  const home = path.join(process.env.HOME || process.env.USERPROFILE || "~", ".bun", "bin", process.platform === "win32" ? "bun.exe" : "bun");
  if (existsSync(home)) return home;
  die(4, "bun not found — install it (https://bun.sh) or point XPLAT_BUN at the binary");
}

function pkgVersion() {
  const pkg = JSON.parse(spawnSync("node", ["-p", "JSON.stringify(require('./package.json'))"], { encoding: "utf8", cwd: REPO_ROOT }).stdout || "{}");
  return pkg.version;
}

function runLocalSteps(steps, keepGoing) {
  const bun = resolveBun();
  let failed = 0;
  for (const step of steps) {
    const t0 = Date.now();
    process.stdout.write(`· ${step.name} … `);
    let p;
    if (step.name === "version consistency") {
      const expected = pkgVersion();
      const out = spawnSync(bun, ["bin/unown", "--version"], { encoding: "utf8", cwd: REPO_ROOT });
      const actual = out.stdout.trim();
      p = { status: expected === actual && out.status === 0 ? 0 : 1, stdout: `package.json: ${expected} / unown: ${actual}\n` };
    } else if (step.name === "doctor table") {
      const out = spawnSync(bun, ["bin/unown", "doctor"], { encoding: "utf8", cwd: REPO_ROOT });
      const text = out.stdout + out.stderr;
      const ok = out.status <= 1 && ["agent dir", "model endpoint reachable", "OS sandbox", "self-learning engine"].every((r) => text.includes(r));
      p = { status: ok ? 0 : 1, stdout: text.slice(0, 2000) };
    } else if (step.name === "changed-line coverage") {
      p = spawnSync("node", ["scripts/check_coverage.mjs", "--run"], { encoding: "utf8", cwd: REPO_ROOT });
    } else if (step.name === "docs links and anchors") {
      // Expand docs/*.md here: spawnSync does no globbing, and Windows cmd
      // wouldn't either (the CI job relies on bash doing it).
      const glob = spawnSync("node", ["-e", "console.log(require('fs').readdirSync('docs').filter(f=>f.endsWith('.md')).map(f=>'docs/'+f).join(' '))"], { encoding: "utf8", cwd: REPO_ROOT });
      const files = glob.stdout.trim().split(/\s+/).filter(Boolean);
      p = spawnSync("node", ["scripts/check_docs.mjs", ...files], { encoding: "utf8", cwd: REPO_ROOT });
    } else if (step.name === "landing generated-data contracts") {
      const cmds = [
        ["bun", "scripts/gba_palette_check.mjs"],
        ["node", "--test", "scripts/landing_changelog.test.mjs"],
        ["bun", "scripts/landing_changelog.mjs", "--check"],
        ["node", "--test", "scripts/landing_blog.test.mjs"],
        ["node", "scripts/landing_blog.mjs", "--check"],
        ["node", "--test", "scripts/landing_benchmarks.test.mjs"],
        ["bun", "scripts/landing_benchmarks.mjs", "--check"],
        ["node", "--test", "scripts/landing_claims.test.mjs"],
        ["bun", "scripts/landing_claims.mjs", "--check"],
      ];
      let allOk = true;
      const out = [];
      for (const c of cmds) {
        const cmd = c[0] === "bun" ? [bun, ...c.slice(1)] : c;
        const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", cwd: REPO_ROOT });
        if (r.status !== 0) allOk = false;
        out.push(`$ ${c.join(" ")}\n${(r.stdout || "") + (r.stderr || "")}`.slice(0, 4000));
      }
      p = { status: allOk ? 0 : 1, stdout: out.join("\n") };
    } else {
      const cmd = [...step.cmd];
      if (cmd[0] === "bun") cmd[0] = bun;
      p = spawnSync(cmd[0], cmd.slice(1), {
        encoding: "utf8",
        cwd: path.join(REPO_ROOT, step.cwd || "."),
        env: { ...process.env, ...step.env },
      });
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (p.status === 0) {
      console.log(`ok (${secs}s)`);
    } else {
      console.log(`FAILED (${secs}s)`);
      const tail = ((p.stdout || "") + (p.stderr || "")).trimEnd().split("\n");
      console.log(tail.slice(-25).map((l) => `    ${l}`).join("\n"));
      failed++;
      if (!keepGoing) die(1, `step "${step.name}" failed — fix and re-run (use --keep-going to see all failures)`);
    }
  }
  if (failed > 0) die(1, `${failed} local step(s) failed`);
  console.log("local scenario green");
}

function cmdLocal(args) {
  const a = parseArgs(args, { scenario: "smoke", keepGoing: false });
  if (!LOCAL_SCENARIOS[a.scenario]) {
    die(4, `unknown scenario "${a.scenario}" — choices: ${Object.keys(LOCAL_SCENARIOS).join(", ")}`);
  }
  console.log(`local ${a.scenario} (${LOCAL_SCENARIOS[a.scenario].length} steps)`);
  runLocalSteps(LOCAL_SCENARIOS[a.scenario], a.keepGoing);
}

function cmdScenarios() {
  console.log("XPlat scenarios (levels escalate — each runs everything below it):");
  console.log("");
  for (const [id, s] of Object.entries(SCENARIOS)) {
    console.log(`  L${s.level}  ${id}`);
    console.log(`      what:  ${s.summary}`);
    console.log(`      when:  ${s.when}`);
    console.log(`      remote ${s.remote} · local ${s.local}`);
    console.log(`      dispatch: node scripts/xplat.mjs dispatch --scenario ${id}`);
    console.log("");
  }
  console.log("  drive it:   node scripts/xplat.mjs dispatch --scenario core --watch");
  console.log("  fast loop: node scripts/xplat.mjs local --scenario core");
  console.log("  playbook:  docs/xplat-testing.md");
}

// ---------------------------------------------------------------------------
// arg parsing (hand-rolled — zero deps)
// ---------------------------------------------------------------------------

function parseArgs(argv, defaults) {
  const out = { positional: [], ...defaults };
  const bools = new Set(["watch", "json", "download", "failedOnly", "keepGoing", "failed"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      return out;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (bools.has(arg.slice(2))) {
        out[key] = true;
      } else {
        out[key] = argv[++i];
      }
    } else {
      out.positional.push(arg);
    }
  }
  return out;
}

const HELP = `xplat — the cross-platform test driver (docs/xplat-testing.md)

  scenarios                          print the scenario catalog
  local    [--scenario s] [--keep-going]     run the scenario on THIS machine
  dispatch --scenario s [--os o] [--ref r] [--watch]   trigger the XPlat workflow
  status   [runId|latest] [--json]   run + per-job breakdown
  watch    [runId|latest] [--interval s] [--timeout s]  poll to a verdict (exit code = verdict)
  logs     [runId|latest] [--job substr] [--failed-only]  download logs to .run/xplat/
  artifacts [runId|latest] [--download] [--out dir]       list/fetch receipts
  cancel   <runId>                   cancel a run
  rerun    <runId> [--failed]        re-run (failed jobs only with --failed)
  runs     [-L 10]                   recent XPlat runs

scenarios: ${Object.keys(SCENARIOS).join(", ")}
os choices: ${Object.keys(OS_CHOICES).join(", ")}`;

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

if (invokedAsMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "dispatch": await cmdDispatch(rest); break;
    case "status": await cmdStatus(rest); break;
    case "watch": await cmdWatch(rest); break;
    case "logs": await cmdLogs(rest); break;
    case "artifacts": await cmdArtifacts(rest); break;
    case "cancel": await cmdCancel(rest); break;
    case "rerun": await cmdRerun(rest); break;
    case "runs": await cmdRuns(rest); break;
    case "local": cmdLocal(rest); break;
    case "scenarios": case "help": case "--help": cmdScenarios(); break;
    default:
      console.log(HELP);
      process.exit(cmd ? 4 : 0);
  }
}
