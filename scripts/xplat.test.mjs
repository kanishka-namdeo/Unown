// Pinning suite for the xplat driver's pure logic (node --test, zero deps).
// Run: node --test scripts/xplat.test.mjs
//
// What each test pins, and why it matters:
//   - parseRemote: token resolution from the git remote is the zero-config
//     auth path — a regression here silently breaks every driver command
//     with a 401 instead of a clear message.
//   - osMatrix: the os input is a PUBLIC workflow input; a value the workflow
//     cannot resolve must fail here first with a list of legal choices.
//   - conclusionExit: the exit-code contract is what driving agents branch on
//     (0 green / 1 red / 2 cancelled / 3 infra) — it is an interface.
//   - isCorrelatedRun: dispatch returns 204 with no body; correlating the
//     fired dispatch to its run is the only way to watch the right thing.
//     A regression watches someone else's run and reports the wrong verdict.
//   - LOCAL_SCENARIOS: the local lane must stay a faithful subset of the
//     remote lane per level (smoke < core < full), or the fast loop lies.
//   - SCENARIOS/OS_CHOICES invariants: ids are slug-safe (they land in
//     artifact names), levels strictly escalate, the catalog stays in
//     workflow order — docs and driver both render from this table.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCENARIOS,
  OS_CHOICES,
  osMatrix,
  conclusionExit,
  newRunId,
  isCorrelatedRun,
  parseRemote,
  LOCAL_SCENARIOS,
} from "./xplat.mjs";

// --- parseRemote ----------------------------------------------------------

test("parseRemote: x-access-token form (this repo's convention)", () => {
  const r = parseRemote("https://x-access-token:ghp_abc123@github.com/kanishka-namdeo/Unown.git");
  assert.equal(r.token, "ghp_abc123");
  assert.equal(r.owner, "kanishka-namdeo");
  assert.equal(r.repo, "Unown");
});

test("parseRemote: bare PAT form", () => {
  const r = parseRemote("https://github_pat_abc@github.com/o/r.git");
  assert.equal(r.token, "github_pat_abc");
  assert.equal(r.owner, "o");
  assert.equal(r.repo, "r");
});

test("parseRemote: anonymous https and ssh forms carry no token", () => {
  assert.equal(parseRemote("https://github.com/owner/repo.git").token, null);
  const ssh = parseRemote("git@github.com:owner/repo.git");
  assert.equal(ssh.token, null);
  assert.equal(ssh.owner, "owner");
  assert.equal(ssh.repo, "repo");
});

test("parseRemote: .git suffix is optional, not required", () => {
  const a = parseRemote("https://github.com/o/r.git");
  const b = parseRemote("https://github.com/o/r");
  assert.deepEqual({ owner: a.owner, repo: a.repo }, { owner: b.owner, repo: b.repo });
});

test("parseRemote: a non-github or malformed remote throws (never silently misroutes)", () => {
  assert.throws(() => parseRemote("https://gitlab.com/o/r.git"));
  assert.throws(() => parseRemote(""));
  assert.throws(() => parseRemote("not a url at all"));
});

test("parseRemote: tokens with slashes or colons still parse (PATs are opaque)", () => {
  const r = parseRemote("https://x-access-token:tok:en/with@chars@github.com/o/r.git");
  assert.equal(r.token, "tok:en/with@chars");
  assert.equal(r.repo, "r");
});

// --- osMatrix --------------------------------------------------------------

test("osMatrix: all = the three primary runners (matches ci.yml's matrix)", () => {
  assert.deepEqual(osMatrix("all"), ["ubuntu-latest", "macos-latest", "windows-latest"]);
});

test("osMatrix: macos-intel = the darwin-x64 gap leg, not macos-latest", () => {
  assert.deepEqual(osMatrix("macos-intel"), ["macos-15-intel"]);
});

test("osMatrix: single runners pass through unchanged", () => {
  for (const os of ["ubuntu-latest", "macos-latest", "windows-latest"]) {
    assert.deepEqual(osMatrix(os), [os]);
  }
});

test("osMatrix: an unknown os throws with the legal choices in the message", () => {
  assert.throws(() => osMatrix("temple-os"), /choices:.*all/);
});

test("osMatrix: every choice value is a real runner label (no empty/whitespace)", () => {
  for (const labels of Object.values(OS_CHOICES)) {
    for (const label of labels) {
      assert.match(label, /^[a-z0-9.-]+-[a-z0-9.]+$/);
    }
  }
});

// --- conclusionExit ---------------------------------------------------------

test("conclusionExit: the contract (0 green, 1 red, 2 cancelled, 3 infra)", () => {
  assert.equal(conclusionExit("success"), 0);
  assert.equal(conclusionExit("failure"), 1);
  assert.equal(conclusionExit("cancelled"), 2);
  assert.equal(conclusionExit("startup_failure"), 3);
  assert.equal(conclusionExit("timed_out"), 3);
});

test("conclusionExit: unknown conclusions read as red, never green", () => {
  assert.equal(conclusionExit("something_new"), 1);
  assert.equal(conclusionExit(null), 1);
});

// --- newRunId ---------------------------------------------------------------

test("newRunId: slug-safe (artifact names must accept it) and unique-ish", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const id = newRunId();
    assert.match(id, /^x[0-9a-z]{6,}$/);
    seen.add(id);
  }
  assert.ok(seen.size >= 195, `expected near-unique ids, got ${seen.size}/200`);
});

// --- isCorrelatedRun ---------------------------------------------------------

const BASE_RUN = {
  event: "workflow_dispatch",
  head_branch: "main",
  created_at: "2026-10-25T12:00:00.000Z",
  name: "xplat core · all · xabc123def",
};

test("isCorrelatedRun: matches a fresh dispatch on the same branch", () => {
  const t0 = Date.parse(BASE_RUN.created_at);
  assert.equal(isCorrelatedRun(BASE_RUN, { t0, branch: "main", runId: "xabc123def" }), true);
});

test("isCorrelatedRun: rejects push runs, other branches, stale runs, other agents", () => {
  const t0 = Date.parse(BASE_RUN.created_at);
  assert.equal(isCorrelatedRun({ ...BASE_RUN, event: "push" }, { t0, branch: "main", runId: "xabc123def" }), false);
  assert.equal(isCorrelatedRun({ ...BASE_RUN, head_branch: "feature" }, { t0, branch: "main", runId: "xabc123def" }), false);
  // created 60s before our dispatch => someone else's run
  assert.equal(
    isCorrelatedRun({ ...BASE_RUN, created_at: "2026-10-25T11:59:00.000Z" }, { t0, branch: "main", runId: "xabc123def" }),
    false,
  );
  assert.equal(isCorrelatedRun({ ...BASE_RUN, name: "xplat core · all · xother999" }, { t0, branch: "main", runId: "xabc123def" }), false);
});

test("isCorrelatedRun: 2s clock tolerance — a run created just before dispatch still matches", () => {
  const t0 = Date.parse(BASE_RUN.created_at) + 1500;
  assert.equal(isCorrelatedRun(BASE_RUN, { t0, branch: "main", runId: "xabc123def" }), true);
});

test("isCorrelatedRun: the run id must be a whole ·-separated segment, not a substring", () => {
  const t0 = Date.parse(BASE_RUN.created_at);
  // "xabc123de" is a substring of "xabc123def" but must NOT match
  assert.equal(isCorrelatedRun(BASE_RUN, { t0, branch: "main", runId: "xabc123de" }), false);
});

test("isCorrelatedRun: with no runId minted, branch+time alone correlate", () => {
  const t0 = Date.parse(BASE_RUN.created_at);
  assert.equal(isCorrelatedRun(BASE_RUN, { t0, branch: "main", runId: null }), true);
});

// --- catalog invariants -------------------------------------------------------

test("SCENARIOS: levels strictly escalate 1..4 in catalog order", () => {
  const ids = Object.keys(SCENARIOS);
  assert.deepEqual(ids, ["smoke", "core", "full", "release-verify"]);
  assert.deepEqual(ids.map((id) => SCENARIOS[id].level), [1, 2, 3, 4]);
});

test("SCENARIOS: every entry documents summary, when, remote and local cost", () => {
  for (const [id, s] of Object.entries(SCENARIOS)) {
    assert.ok(s.summary.length > 10, `${id} summary too thin`);
    assert.ok(s.when.length > 10, `${id} when too thin`);
    assert.match(s.remote, /min/, `${id} remote cost must name minutes`);
    assert.match(s.local, /min/, `${id} local cost must name minutes`);
  }
});

test("SCENARIOS: ids are slug-safe (they land in artifact names)", () => {
  for (const id of Object.keys(SCENARIOS)) assert.match(id, /^[a-z0-9-]+$/);
});

test("LOCAL_SCENARIOS: same ids as the remote catalog, levels only escalate", () => {
  assert.deepEqual(Object.keys(LOCAL_SCENARIOS), Object.keys(SCENARIOS));
  // smoke's steps are a prefix of core's, core's of full's (release-verify is
  // its own lane: the release checks, not a superset)
  const coreNames = LOCAL_SCENARIOS.core.map((s) => s.name);
  for (const s of LOCAL_SCENARIOS.smoke) assert.ok(coreNames.includes(s.name), `smoke step "${s.name}" missing from core`);
  const fullNames = LOCAL_SCENARIOS.full.map((s) => s.name);
  for (const s of LOCAL_SCENARIOS.core) assert.ok(fullNames.includes(s.name), `core step "${s.name}" missing from full`);
});

test("LOCAL_SCENARIOS: every step is runnable — has a name and either a cmd or a named special case", () => {
  const specials = new Set(["version consistency", "doctor table", "changed-line coverage", "docs links and anchors", "landing generated-data contracts"]);
  for (const steps of Object.values(LOCAL_SCENARIOS)) {
    for (const s of steps) {
      assert.ok(s.name && s.name.length > 2, "unnamed step");
      assert.ok(s.cmd || specials.has(s.name), `step "${s.name}" has no command and is not a special case`);
      if (s.cmd) {
        assert.ok(Array.isArray(s.cmd) && s.cmd.length >= 2);
        assert.ok(!s.cwd || !s.cmd[0].includes("/"), "cwd + relative cmd is the contract");
      }
    }
  }
});
