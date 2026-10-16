#!/usr/bin/env node
/**
 * Generate the pinned, stratified exercise subset for the Unown polyglot run.
 *
 * Mirrors the Aider polyglot benchmark's composition (225 hardest Exercism
 * exercises: Python 34, JS 49, C++ 26, Go 39, Java 47, Rust 30) at ~1/4.5
 * scale: 50 exercises, per-language counts proportional to the official mix.
 *
 * Selection is deterministic: exercises are sorted alphabetically per language
 * and picked at evenly spaced indices, so the subset is reproducible from the
 * pinned source commit without any random seed or cherry-picking.
 *
 * Usage: node gen-subset.mjs [--repo /path/to/polyglot-benchmark] [--out subset.json]
 */
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

// Per-language counts proportional to the official 225 mix (34/49/26/39/47/30).
const TARGETS = {
	python: 8,
	javascript: 11,
	cpp: 6,
	go: 9,
	java: 10,
	rust: 6,
};

const args = process.argv.slice(2);
function argValue(name, fallback) {
	const i = args.indexOf(`--${name}`);
	return i !== -1 && args[i + 1] ? resolve(args[i + 1]) : fallback;
}
const repo = argValue("repo", "/home/z/my-project/bench-data/polyglot-benchmark");
const out = argValue("out", join(import.meta.dirname, "subset.json"));

function langDir(lang) {
	return join(repo, lang, "exercises", "practice");
}

function hasReference(lang, name) {
	const meta = join(langDir(lang), name, ".meta");
	if (!existsSync(meta)) return false;
	return readdirSync(meta).some((f) => f.startsWith("example") || f === "src" || f.startsWith("proof"));
}

function hasInstructions(lang, name) {
	return existsSync(join(langDir(lang), name, ".docs", "instructions.md"));
}

function evenlySpaced(sorted, n) {
	if (n <= 0) return [];
	if (n === 1) return [sorted[Math.floor((sorted.length - 1) / 2)]];
	if (n >= sorted.length) return [...sorted];
	const picked = [];
	for (let i = 0; i < n; i++) {
		const idx = Math.round((i * (sorted.length - 1)) / (n - 1));
		picked.push(sorted[idx]);
	}
	return [...new Set(picked)];
}

let commit = "unknown";
try {
	commit = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim();
} catch {
	console.warn("warning: could not read source commit (is it a git checkout?)");
}

const exercises = [];
const summary = {};
for (const [lang, n] of Object.entries(TARGETS)) {
	const all = readdirSync(langDir(lang)).filter((name) => hasReference(lang, name) && hasInstructions(lang, name));
	all.sort();
	const picked = evenlySpaced(all, n);
	summary[lang] = { available: all.length, selected: picked.length };
	for (const name of picked) exercises.push({ lang, name });
}

const subset = {
	source: {
		repo: "https://github.com/Aider-AI/polyglot-benchmark",
		commit,
	},
	selection: "alphabetical, evenly spaced indices per language (deterministic, no seed)",
	stratification: "per-language counts proportional to the official 225-exercise mix",
	officialMix: { python: 34, javascript: 49, cpp: 26, go: 39, java: 47, rust: 30 },
	subsetCounts: TARGETS,
	total: exercises.length,
	generatedAt: new Date().toISOString(),
	summary,
	exercises,
};

writeFileSync(out, JSON.stringify(subset, null, "\t") + "\n");
console.log(`wrote ${out}: ${exercises.length} exercises @ ${commit.slice(0, 10)}`);
for (const [lang, s] of Object.entries(summary)) console.log(`  ${lang}: ${s.selected}/${s.available}`);
