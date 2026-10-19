// Tests for the landing rail's extractor (scripts/landing_changelog.mjs).
//
//   node --test scripts/landing_changelog.test.mjs
//
// Why these exist: `--check` compares the generated file against what the same
// parser produces, so it cannot catch a parser bug — a rule that quietly
// mislabels an entry changes BOTH sides and the gate stays green while the page
// lies. These pin the extraction rules the landing copy depends on, and one of
// them spawns the CLI to prove the gate still says something out loud (a
// self-invocation guard that never matches would make `--check` exit 0 having
// done nothing).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { balanceCuts, build, firstClause, parseChangelog, titleOf, TITLE_MAX } from "./landing_changelog.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const iso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");
const fill = (n) => Array.from({ length: n }, (_, i) => `- **filler ${i}** — detail`).join("\n");
const added = (n) => `### Added\n${fill(n)}`;
const bucket = (stop, name) => stop.groups.get(name)?.items ?? [];

test("two `### Fixed` blocks in one stop merge into one bucket", () => {
  const [stop] = parseChangelog([
    "## [9.9.9] - 2026-01-02",
    "### Fixed",
    "- **first** — detail",
    "### Fixed",
    "- **second** — detail",
  ].join("\n"));
  assert.deepEqual(bucket(stop, "Fixed").map((i) => i.title), ["first", "second"]);
});

test("an `Added (Agent Behavior)` heading does not flag the sibling plain Added block", () => {
  const [stop] = parseChangelog([
    "## [Unreleased]",
    "### Added (Agent Behavior)",
    "- **the lane** — detail",
    "### Added",
    "- **the bench (not yet a behavior change)** — detail",
  ].join("\n"));
  const added = bucket(stop, "Added");
  assert.equal(added.length, 2);
  assert.equal(added[0].behavior, true);
  assert.equal(added[1].behavior, false);
});

test("a milestone-suffixed `Agent Behavior (…)` heading is the Behavior bucket (M1–M4 shape)", () => {
  const [stop] = parseChangelog([
    "## [Unreleased]",
    "### Agent Behavior (Milestone 4 — 2026-10-19)",
    "- **recipes** — detail",
    "### Agent Behavior (Milestone 3 — 2026-10-19)",
    "- **blame** — detail",
    "### Agent Behavior",
    "- **plain block merges in** — detail",
  ].join("\n"));
  const behavior = bucket(stop, "Behavior");
  assert.equal(behavior.length, 3);
  assert.ok(behavior.every((i) => i.behavior === true));
});

test("`Agent Behavioral` (a different word) still fails, not silently swallowed", () => {
  assert.throws(
    () => parseChangelog(["## [9.9.9] - 2026-01-02", "### Agent Behavioral", "- **thing** — detail"].join("\n")),
    /unknown bucket heading "### Agent Behavioral"/,
  );
});

test("an unrecognised bucket heading fails the run instead of dropping entries", () => {
  assert.throws(
    () => parseChangelog(["## [9.9.9] - 2026-01-02", "### Improvements", "- **thing** — detail"].join("\n")),
    /unknown bucket heading "### Improvements"/,
  );
});

test("a bullet before any bucket heading fails instead of being orphaned", () => {
  assert.throws(
    () => parseChangelog(["## [9.9.9] - 2026-01-02", "- **orphan** — detail"].join("\n")),
    /before any ### heading/,
  );
});

test("titles: the bold lead is authored, a bare label takes its clause, no unclosed bracket", () => {
  assert.equal(titleOf("**session checkpoints + receipts audit ledger** — every session records").title,
    "session checkpoints + receipts audit ledger");
  assert.equal(titleOf("**Agent Behavior** — `security-bypass` guard rule: both orders").title,
    "security-bypass guard rule");
  assert.equal(titleOf("**Agent Behavior: `/review` — code review** — freezes a diff").title,
    "/review — code review");
  assert.equal(titleOf("CI: the mermaid gate (README-extracted sources, vendored mermaid) and more").title,
    "CI: the mermaid gate");
  assert.equal(titleOf("Cross-platform stack: bun TS scripts (`install.ts`, `link.ts`)").title,
    "Cross-platform stack");
  assert.equal(titleOf("a bullet with **bold** inside").title, "a bullet with bold inside");
  assert.equal(balanceCuts("README: a diagram (assets/diagram.png"), "README: a diagram");
  assert.equal(firstClause("no separator here at all"), "no separator here at all");
  assert.ok(titleOf(`**${"x".repeat(200)}** — tail`).title.length <= TITLE_MAX);
});

test("build refuses a rail that cannot be dated, or that has gone empty", () => {
  assert.throws(() => build(parseChangelog(["## [Unreleased]", added(12)].join("\n"))),
    /no dated release stop/);
  assert.throws(() => build(parseChangelog(["## [Unreleased] - 2026-01-02", added(12)].join("\n"))),
    /\[Unreleased\] must not have a date/);
  assert.throws(() => build(parseChangelog(["## [1.0.0] - 2026-01-02", "### Added", "- **one** — d"].join("\n"))),
    /entries parsed/);
});

test("the real CHANGELOG.md parses into the rail the page renders", () => {
  const data = build(parseChangelog(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8")));
  assert.ok(data.stops.length >= 2, "at least one cut release plus the in-flight stop");
  assert.equal(data.stops[0].label, "Unreleased");
  assert.equal(data.stops[0].date, null, "the in-flight stop must stay undated");
  assert.ok(data.stops.slice(1).every((s) => iso(s.date)), "every cut release carries an ISO date");
  const items = data.stops.flatMap((s) => s.groups.flatMap((g) => g.items));
  assert.equal(items.length, data.total);
  assert.ok(items.every((i) => i.title.length > 0 && i.title.length <= TITLE_MAX));
  assert.ok(items.every((i) => !i.title.includes("**") && !i.title.includes("`")),
    "markdown emphasis and code spans must not reach the page");
  // The honesty case this extractor was caught on: an entry whose own text says
  // it is not a behavior change must not arrive flagged as one.
  const notBehavior = items.find((i) => i.title.startsWith("local-llm testbench"));
  assert.equal(notBehavior?.behavior, false);
  assert.ok(data.stops.some((s) => s.counts.Added > 0));
});

test("the CLI always speaks — a silent --check is a decorative gate", () => {
  // This asserts LOUDNESS, not repo hygiene. Requiring `--check` to pass here
  // would fail the parser suite for a drift reason (an entry added without a
  // regeneration), which is a different gate's job and a confusing diagnosis.
  // What must never happen is exit 0 with nothing said.
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "landing_changelog.mjs"), "--check"], {
    encoding: "utf8",
    cwd: ROOT,
  });
  const said = `${r.stdout}${r.stderr}`;
  assert.ok(r.status === 0 || r.status === 1, `unexpected exit ${r.status}: ${said}`);
  if (r.status === 0) {
    assert.match(r.stdout, /^ok {2}rail matches CHANGELOG\.md: \d+ stops, \d+ entries/);
  } else {
    assert.match(said, /no longer matches CHANGELOG\.md/);
    assert.match(said, /bun scripts\/landing_changelog\.mjs/);
  }
});
