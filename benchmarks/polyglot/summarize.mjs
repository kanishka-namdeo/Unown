#!/usr/bin/env node
/**
 * Aggregate polyglot marathon results into summary.json + RESULTS.md.
 *
 * Usage: node summarize.mjs [--results-dir /home/z/bench-runs/polyglot/results]
 *                           [--out /home/z/my-project/Unown/benchmarks/polyglot/results]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
function arg(name, fallback) {
	const i = args.indexOf(`--${name}`);
	return i !== -1 ? args[i + 1] : fallback;
}
const resultsDir = arg("results-dir", "/home/z/bench-runs/polyglot/results");
const outDir = arg("out", join(import.meta.dirname, "results"));
const subset = JSON.parse(readFileSync(join(import.meta.dirname, "subset.json"), "utf8"));

const models = readdirSync(resultsDir)
	.filter((f) => f.endsWith(".jsonl"))
	.map((f) => f.replace(/\.jsonl$/, ""));

const summary = { generatedAt: new Date().toISOString(), subset: subset.source, models: {} };

for (const model of models) {
	const records = readFileSync(join(resultsDir, `${model}.jsonl`), "utf8")
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l));
	const exercises = new Map(); // key -> {passedA1, passedA2, harnessError, tokens, durations}
	for (const r of records) {
		const key = `${r.lang}/${r.exercise}`;
		const e = exercises.get(key) ?? { lang: r.lang, exercise: r.exercise };
		if (r.harnessError) e.harnessError = r.harnessError;
		if (r.attempt === 1) {
			e.passedA1 = r.passed;
			e.tokensA1 = r.tokens;
			e.durationA1 = r.durationS;
		} else {
			e.passedA2 = r.passed;
			e.tokensA2 = r.tokens;
			e.durationA2 = r.durationS;
		}
		exercises.set(key, e);
	}
	const all = [...exercises.values()];
	const harnessErrors = all.filter((e) => e.harnessError);
	const scored = all.filter((e) => !e.harnessError);
	const pass1 = scored.filter((e) => e.passedA1).length;
	const pass2 = scored.filter((e) => e.passedA1 || e.passedA2).length;
	const perLang = {};
	for (const lang of Object.keys(subset.subsetCounts)) {
		const langEx = scored.filter((e) => e.lang === lang);
		perLang[lang] = {
			attempted: langEx.length,
			pass1: langEx.filter((e) => e.passedA1).length,
			pass2: langEx.filter((e) => e.passedA1 || e.passedA2).length,
		};
	}
	const tokenTotals = scored.reduce(
		(acc, e) => {
			for (const [k, t] of [["a1", e.tokensA1], ["a2", e.tokensA2]]) {
				if (t) {
					acc.input += t.input ?? 0;
					acc.output += t.output ?? 0;
					acc.cacheRead += t.cacheRead ?? 0;
				}
			}
			return acc;
		},
		{ input: 0, output: 0, cacheRead: 0 },
	);
	const durations = scored.map((e) => (e.durationA1 ?? 0) + (e.passedA1 ? 0 : e.durationA2 ?? 0));
	summary.models[model] = {
		exercisesRecorded: all.length,
		expected: subset.total,
		harnessErrors: harnessErrors.map((e) => `${e.lang}/${e.exercise}: ${e.harnessError}`),
		scored: scored.length,
		pass1,
		pass2,
		pass1Pct: +(100 * (pass1 / Math.max(1, scored.length))).toFixed(1),
		pass2Pct: +(100 * (pass2 / Math.max(1, scored.length))).toFixed(1),
		perLang,
		tokens: tokenTotals,
		avgDurationS: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
		totalAgentS: durations.reduce((a, b) => a + b, 0),
	};
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, "\t") + "\n");
for (const model of models) {
	cpSync(join(resultsDir, `${model}.jsonl`), join(outDir, `${model}.jsonl`));
}

// Markdown table
const lines = [];
lines.push(`# Unown on the Aider polyglot benchmark (50-exercise subset)`);
lines.push("");
lines.push(`- Harness: Unown agent headless (\`unown -p\`) via the bundled llm-bridge, 2 attempts with test-failure feedback (Aider protocol)`);
lines.push(`- Subset: ${subset.total} exercises, stratified proportionally to the official 225 mix, alphabetical evenly-spaced (deterministic) — pinned at ${subset.source.commit.slice(0, 10)}`);
lines.push(`- Scoring: canonical per-language test commands, pristine test files restored before scoring; \`.meta/\` reference solutions never shown to the agent`);
lines.push(`- Models via Dashscope (coding-intl), agent default settings (qwen thinking disabled by the bridge for snappy turns)`);
lines.push(`- Captured: ${summary.generatedAt}`);
lines.push("");
lines.push(`| Model | pass@1 | pass@2 | tokens in/out | avg s/exercise |`);
lines.push(`|---|---|---|---|---|`);
for (const [model, s] of Object.entries(summary.models)) {
	lines.push(
		`| ${model} | ${s.pass1}/${s.scored} (${s.pass1Pct}%) | ${s.pass2}/${s.scored} (${s.pass2Pct}%) | ${s.tokens.input.toLocaleString()} / ${s.tokens.output.toLocaleString()} | ${s.avgDurationS}s |`,
	);
}
lines.push("");
lines.push(`## Per-language pass rates (pass@1 → pass@2)`);
lines.push("");
lines.push(`| Model | ${Object.keys(subset.subsetCounts).join(" | ")} |`);
lines.push(`|---|${Object.keys(subset.subsetCounts).map(() => "---").join("|")}|`);
for (const [model, s] of Object.entries(summary.models)) {
	lines.push(`| ${model} | ${Object.keys(subset.subsetCounts).map((l) => `${s.perLang[l]?.pass1 ?? 0}→${s.perLang[l]?.pass2 ?? 0}/${s.perLang[l]?.attempted ?? 0}`).join(" | ")} |`);
}
if (Object.values(summary.models).some((s) => s.harnessErrors.length)) {
	lines.push("");
	lines.push(`## Harness errors (excluded from scoring)`);
	for (const [model, s] of Object.entries(summary.models)) {
		for (const e of s.harnessErrors) lines.push(`- ${model}: ${e}`);
	}
}
lines.push("");
lines.push(`Context (official Aider leaderboard, full 225 exercises, Aider's own harness — NOT comparable rows, same benchmark family): gpt-5 88.0%, claude-opus-4 72.0%, Kimi K2 59.1%, Qwen3 32B 40.0%. No kimi-k2.5 / qwen3.7-plus / qwen3.6-plus polyglot rows existed when this was captured.`);
writeFileSync(join(outDir, "RESULTS.md"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
