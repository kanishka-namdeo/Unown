// Changed-line coverage gate for `src/`.
// Usage (from the repo root):
//   node scripts/check_coverage.mjs --run [<git-base>]     # runs the suite itself
//   node scripts/check_coverage.mjs <report.txt> [<git-base>]
//
// The script runs `bun test src --coverage` itself rather than relying on shell
// redirection: bun's shell has no `>` or `tee` on Windows, PowerShell's `>`
// writes UTF-16, and PowerShell's `Select-Object` masks exit codes. One spawn,
// byte-safe capture, no shell.
//
// What it enforces, and why it is shaped this way:
//   - docs/testing-strategy.md §6 gate 9 promises "changed src lines >= 80%
//     covered". File-level coverage cannot express "changed code", and a global
//     percentage cannot either, so this measures the intersection: of the lines
//     a commit touched under src/, what share did the dashboard suite execute?
//   - Bun's `--coverage` table is parsed, so no new dependency is needed. The
//     parser failing is a hard error, never a silent pass: a gate that quietly
//     stops gating is worse than no gate, which is the failure mode this
//     repository's own docs-drift taxonomy exists to catch.
//   - A file with no row in the table was never imported by any test, so it
//     counts as 0% covered, not as 100%. Escape hatch: list the path in
//     scripts/coverage-exempt.txt with a justification on the same line; the
//     exemption is printed in the log so it cannot rot unnoticed.
//
// Base ref: defaults to $GITHUB_BASE_REF, then HEAD~1, so a local run works too.
// When no base can be resolved the script reports loudly and exits 0 rather than
// failing an unrelated push.

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

const THRESHOLD = 80;
const runSuite = process.argv[2] === "--run";
const args = process.argv.slice(2).filter((a) => a !== "--run");
const reportFile = args[0] ?? "coverage.txt";
const baseArg = (runSuite ? args[0] : args[1]) ?? process.env.GITHUB_BASE_REF ?? "HEAD~1";

const fail = (msg) => {
	console.log(`::error::${msg}`);
	process.exit(1);
};

let report;
if (runSuite) {
	const proc = spawnSync("bun", ["test", "src", "--coverage"], { encoding: "utf8" });
	report = `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
	writeFileSync(reportFile, report, "utf8");
	if (proc.status !== 0) {
		console.log(report);
		fail(`bun test src --coverage exited ${proc.status}; the coverage gate does not run on a red suite`);
	}
} else {
	if (!existsSync(reportFile)) fail(`no coverage report at ${reportFile} (run: node scripts/check_coverage.mjs --run)`);
	report = readFileSync(reportFile, "utf8");
}

// The gate is only meaningful if the run it summarises actually passed.
const summary = /(\d+)\s+pass\s*\r?\n\s*(\d+)\s+fail/.exec(report);
if (!summary) fail(`could not find the test summary in ${reportFile}; run \`bun test src --coverage > ${reportFile}\``);
const failed = Number(summary[2]);
if (failed > 0) fail(`dashboard suite reported ${failed} failing tests; the coverage gate does not run on a red suite`);

// Parse: " <path> |  86.34 |  91.08 | 26-41,83-98"  (funcs | lines | uncovered)
const uncovered = new Map();
for (const raw of report.split(/\r?\n/)) {
	const line = raw.trim();
	if (!line.includes("|")) continue;
	const cells = line.split("|").map((c) => c.trim());
	if (cells.length < 3) continue;
	const path = cells[0].replace(/\\/g, "/").replace(/^\.\//, "");
	if (!path.startsWith("src/")) continue;
	if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) continue;
	const list = cells[3] ?? "";
	const lines = new Set();
	for (const part of list.split(",")) {
		const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
		if (!m) continue;
		const from = Number(m[1]);
		const to = Number(m[2] ?? m[1]);
		for (let n = from; n <= to; n++) lines.add(n);
	}
	uncovered.set(path, lines);
}

const tableStart = report.indexOf("File ");
if (tableStart >= 0) console.log(report.slice(tableStart).trimEnd());

// Exemptions, one path per line, `#` starts a justification comment.
const exempt = new Set();
const exemptFile = "scripts/coverage-exempt.txt";
if (existsSync(exemptFile)) {
	for (const raw of readFileSync(exemptFile, "utf8").split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		exempt.add(line.split(/\s+/)[0]);
	}
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const isSrcTest = (p) => p.endsWith(".test.ts") || p.endsWith(".test.tsx") || p.includes("/__tests__/");

let diff;
let base = baseArg;
try {
	git("rev-parse", "--verify", `${base}^{commit}`);
} catch {
	base = "HEAD~1";
	try {
		git("rev-parse", "--verify", `${base}^{commit}`);
	} catch {
		console.log(
			`::warning::no resolvable git base (tried ${baseArg}); changed-line coverage not evaluated. Pass a base sha to check it locally.`,
		);
		process.exit(0);
	}
}

try {
	diff = git("diff", "--unified=0", base, "--", "src");
} catch (e) {
	fail(`git diff against ${base} failed: ${e.message.split("\n")[0]}`);
}

// @@@ -old,count +new,count @@@ -> the changed line numbers on the new side.
const changed = new Map();
let current = null;
for (const line of diff.split(/\r?\n/)) {
	const file = /^\+\+\+ b\/(.+)$/.exec(line);
	if (file) {
		current = file[1].replace(/\\/g, "/");
		if (!changed.has(current)) changed.set(current, new Set());
		continue;
	}
	const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
	if (hunk && current) {
		const start = Number(hunk[1]);
		const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
		for (let n = start; n < start + count; n++) changed.get(current).add(n);
	}
}

const targets = [...changed.entries()].filter(([p]) => !isSrcTest(p));
if (targets.length === 0) {
	console.log(`ok  no changed src/ code lines against ${base}; coverage gate has nothing to assert`);
	process.exit(0);
}

let failedPaths = 0;
console.log(`\nchanged-line coverage (threshold ${THRESHOLD}%), base ${base}:`);
for (const [path, lines] of targets) {
	if (exempt.has(path)) {
		console.log(`  exempt  ${path}`);
		continue;
	}
	// A file with no row in the table was never loaded by any test. That is 0%
	// coverage information, not 100%: reading the missing row as "nothing
	// uncovered" is precisely the silent-pass this script exists to prevent.
	const known = uncovered.has(path);
	const missed = known ? uncovered.get(path) : new Set(lines);
	let untested = 0;
	for (const n of lines) if (missed.has(n)) untested++;
	const pct = lines.size === 0 ? 100 : Math.round(((lines.size - untested) / lines.size) * 100);
	const status = pct >= THRESHOLD ? "ok  " : "FAIL";
	const note = known ? "" : "  (no coverage row: never imported by a test)";
	console.log(`  ${status}  ${String(pct).padStart(3)}%  ${path}  (${lines.size - untested}/${lines.size} changed lines)${note}`);
	if (pct < THRESHOLD) failedPaths++;
}

if (failedPaths > 0) {
	console.log(
		`\n${failedPaths} file(s) below ${THRESHOLD}% changed-line coverage. Add a test, or record a justified exemption in ${exemptFile}.`,
	);
	process.exit(1);
}
console.log("coverage gate passed");
