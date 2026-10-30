#!/usr/bin/env bun
/**
 * run-plan-bench.mjs — the plan-mode benchmark runner (benchmarks/plan-mode/).
 *
 * Runs the fixed planning task set through the REAL unown CLI in plan mode
 * and records the envelope's structured `plan` report as the receipt. The
 * scorer is the product's own (src/plan.ts scorePlanDoc) riding the
 * envelope — this runner never judges, it only captures.
 *
 * Usage:
 *   bun benchmarks/plan-mode/run-plan-bench.mjs [--cap 25] [--tasks pt-1,pt-2]
 *        [--out results/run-<label>] [--unown <bin/unown path>] [--repo <fixture repo>]
 *
 * Defaults: all tasks in tasks/, cap 25, out results/run-<timestamp>, the
 * repo's own bin/unown planning against a scratch checkout of this repo
 * (planning tasks reference the Unown codebase — the same substrate the
 * baseline ran on).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");

const args = process.argv.slice(2);
const flag = (name, dflt) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const cap = Number(flag("cap", "25"));
const tasksArg = flag("tasks", "");
const outDir = resolve(HERE, flag("out", `results/run-${new Date().toISOString().replace(/[:.]/g, "-")}`));
const unownBin = resolve(REPO_ROOT, flag("unown", "bin/unown"));

const PROMPTS = {
	"pt-1": "Add a /theme slash command that lists the available TUI color themes, applies one at runtime, and persists the choice so the next session starts with it. Produce the implementation plan.",
	"pt-2": "Add a --quiet flag that suppresses all non-essential status output (footers, chips, notification banners) for screen-reader users, keeping the transcript itself intact. Produce the implementation plan.",
	"pt-3": "Sessions with very long transcripts take multiple seconds to resume; plan the investigation and the fix. Produce the implementation plan.",
};

const tasks = tasksArg ? tasksArg.split(",").map((t) => t.trim()) : Object.keys(PROMPTS);

mkdirSync(outDir, { recursive: true });
console.log(`plan-mode bench: ${tasks.length} task(s), cap ${cap}, out ${outDir}`);

// Scratch fixture: a copy of this repo (the planning substrate — identical to
// the baseline runs, so before/after receipts are comparable).
const scratch = mkdtempSync(join(tmpdir(), "plan-bench-"));
const fixture = join(scratch, "Unown");
try {
	console.log("staging fixture repo (this checkout, minus runtime state)…");
	cpSync(REPO_ROOT, fixture, {
		dereference: false,
		recursive: true,
		filter: (src) => {
			const rel = src.slice(REPO_ROOT.length);
			return !/[\\/]node_modules[\\/]|[\\/]\.next[\\/]|[\\/]data[\\/]|[\\/]\.run[\\/]|[\\/]\.unown[\\/]|[\\/]dist[\\/]/.test(rel);
		},
	});

	const receipts = [];
	for (const task of tasks) {
		const prompt = PROMPTS[task];
		if (!prompt) {
			console.error(`unknown task: ${task}`);
			process.exit(2);
		}
		console.log(`\n=== ${task} (cap ${cap}) ===`);
		const started = Date.now();
		const run = spawnSync(unownBin, ["--plan", "--max-turns", String(cap), "--output-format", "json", "-p", prompt], {
			cwd: fixture,
			input: "",
			encoding: "utf-8",
			timeout: 15 * 60_000,
			env: { ...process.env, UNOWN_NO_ENGINE_SPAWN: "1" },
		});
		const durationMs = Date.now() - started;
		const stdout = (run.stdout ?? "").trim();
		let envelope = null;
		try {
			envelope = JSON.parse(stdout.split("\n").filter(Boolean).pop() ?? "");
		} catch {
			envelope = null;
		}
		const receipt = {
			task,
			promptFile: `tasks/${task}.md`,
			model: envelope?.model ?? "agnes-3.0-flash",
			cap,
			exitCode: run.status,
			subtype: envelope?.subtype ?? "unparsed",
			turns: envelope?.num_turns ?? null,
			durationMs,
			plan: envelope?.plan ?? null,
			stderrTail: (run.stderr ?? "").split("\n").filter(Boolean).slice(-3).join("\n"),
		};
		receipts.push(receipt);
		writeFileSync(join(outDir, `receipt-${task}.json`), `${JSON.stringify(receipt, null, "\t")}\n`);
		const plan = receipt.plan;
		console.log(
			`exit ${receipt.exitCode} · ${receipt.subtype} · turns ${receipt.turns ?? "?"} · ${plan ? `score ${plan.score}/100 (${plan.steps} steps, ${plan.stepsWithFiles} with files)` : "NO PLAN PRODUCED"}`,
		);
	}

	const produced = receipts.filter((r) => r.plan !== null);
	const passing = produced.filter((r) => r.plan.passes);
	const summary = {
		ranAt: new Date().toISOString(),
		tasks: receipts.length,
		cap,
		plansProduced: produced.length,
		plansPassing: passing.length,
		meanScore: produced.length > 0 ? Math.round(produced.reduce((s, r) => s + r.plan.score, 0) / produced.length) : null,
		meanTurns:
			receipts.filter((r) => typeof r.turns === "number").length > 0
				? Math.round(
						receipts.filter((r) => typeof r.turns === "number").reduce((s, r) => s + r.turns, 0) /
							receipts.filter((r) => typeof r.turns === "number").length,
					)
				: null,
		receipts: receipts.map((r) => ({ task: r.task, score: r.plan?.score ?? null, turns: r.turns, produced: r.plan !== null })),
	};
	writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, "\t")}\n`);
	console.log(`\nsummary: ${summary.plansProduced}/${summary.tasks} plans produced · mean score ${summary.meanScore ?? "-"}`);
	console.log(`receipts → ${outDir}`);
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
