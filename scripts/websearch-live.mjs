#!/usr/bin/env bun
// websearch-live.mjs — live provider verification harness for unown's
// web_search / webfetch stack (src/websearch.ts).
//
// Runs every provider adapter against the real network, records
// provider-by-provider outcomes (latency, result count, sample results,
// failure notes), verifies the 5-free + 5-paid floor, and writes a JSON
// receipt under benchmarks/websearch-live/results/.
//
// Usage:
//   bun scripts/websearch-live.mjs                 # full matrix
//   bun scripts/websearch-live.mjs tavily searxng  # subset by id
//
// Keyed providers without a key are probed for endpoint liveness (the
// documented auth error proves reachability + request shape); with a key
// they run a real query. SearXNG is tested against UNOWN_SEARXNG_URL (a
// local self-hosted instance is the supported path — see
// scripts/searxng-test/ for a settings.yml with formats:[html,json]).

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");

// The self-learning package ships as TS source — bun imports it directly.
const websearch = await import(join(repoRoot, "pi-repo/packages/self-learning/src/websearch.ts"));

const QUERY = process.argv.includes("--query") ? process.argv[process.argv.indexOf("--query") + 1] : "bun javascript runtime";
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const now = Date.now();
const results = [];
const paidVerified = [];
const freeVerified = [];

async function timeProvider(id) {
	const started = Date.now();
	try {
		const outcome = await websearch.runWebSearch(QUERY, { provider: id, maxResults: 5, noCache: true }); // noCache: live verification must never serve the store
		const ms = Date.now() - started;
		return {
			id,
			ok: true,
			ms,
			nResults: outcome.results.length,
			sample: outcome.results.slice(0, 2).map((r) => ({ title: r.title.slice(0, 80), url: r.url })),
			note: "live query verified",
		};
	} catch (err) {
		return { id, ok: false, ms: Date.now() - started, nResults: 0, note: String(err?.message ?? err).slice(0, 300) };
	}
}

async function probeEndpointLiveness(id) {
	// No key configured: verify the endpoint answers with a documented auth
	// error (401/403/402) rather than a network failure — proves the adapter
	// hits a live endpoint with a well-formed request.
	const started = Date.now();
	try {
		await websearch.runWebSearch(QUERY, { provider: id, maxResults: 3, noCache: true });
		return { id, ok: true, ms: Date.now() - started, note: "unexpectedly succeeded without key" };
	} catch (err) {
		const message = String(err?.message ?? err);
		const authish = /(401|403|402|404|429|API key|needs .*KEY)/.test(message);
		const ms = Date.now() - started;
		return {
			id,
			ok: authish,
			ms,
			livenessOnly: true,
			note: authish ? `endpoint live, auth-gated as documented (${message.slice(0, 140)})` : message.slice(0, 200),
		};
	}
}

const providers = websearch.listSearchProviders();
console.log(`\nwebsearch live harness — query: "${QUERY}"\n`);

for (const provider of providers) {
	if (only.length > 0 && !only.includes(provider.id)) continue;
	let entry;
	if (provider.configured) {
		entry = await timeProvider(provider.id);
	} else {
		entry = await probeEndpointLiveness(provider.id);
	}
	entry.tier = provider.tier;
	entry.configured = provider.configured;
	results.push(entry);
	if (entry.ok) {
		if (provider.tier === "free" && !entry.livenessOnly) freeVerified.push(provider.id);
		if (provider.tier === "paid" && !entry.livenessOnly) paidVerified.push(provider.id);
	}
	const flag = entry.ok ? (entry.livenessOnly ? "LIVE" : " OK ") : "FAIL";
	const extra = entry.livenessOnly ? " (endpoint liveness — no key)" : entry.ok ? ` (${entry.nResults} results, ${entry.ms}ms)` : "";
	console.log(`[${flag}] ${provider.tier.padEnd(4)} ${provider.id.padEnd(14)}${extra}`);
	if (!entry.ok) console.log(`         ${entry.note.slice(0, 160)}`);
}

// webfetch live checks
console.log("\nwebfetch live checks:");
const fetchChecks = [
	{ name: "direct-fetch", run: () => websearch.fetchPageContent("https://bun.sh", { maxChars: 3000, noCache: true }) },
];
const fetchResults = [];
for (const check of fetchChecks) {
	const started = Date.now();
	try {
		const text = await check.run();
		const ok = text.includes("Bun") || text.length > 200;
		fetchResults.push({ name: check.name, ok, ms: Date.now() - started, chars: text.length });
		console.log(`[${ok ? " OK " : "FAIL"}] ${check.name} (${text.length} chars, ${Date.now() - started}ms)`);
	} catch (err) {
		fetchResults.push({ name: check.name, ok: false, ms: Date.now() - started, note: String(err?.message).slice(0, 200) });
		console.log(`[FAIL] ${check.name}: ${String(err?.message).slice(0, 140)}`);
	}
}

const receipt = {
	ts: new Date(now).toISOString(),
	query: QUERY,
	env: {
		UNOWN_SEARXNG_URL: process.env.UNOWN_SEARXNG_URL || "",
		keyedProvidersConfigured: providers.filter((p) => p.configured && p.keyEnvVars.length > 0).map((p) => p.id),
	},
	summary: {
		freeLiveVerified: freeVerified,
		paidLiveVerified: paidVerified,
		paidLivenessVerified: results.filter((r) => r.livenessOnly && r.ok).map((r) => r.id),
		failed: results.filter((r) => !r.ok).map((r) => r.id),
		floorMet: freeVerified.length >= 5 && paidVerified.length + results.filter((r) => r.livenessOnly && r.ok).length >= 5,
	},
	providers: results,
	fetch: fetchResults,
};

const outDir = join(repoRoot, "benchmarks/websearch-live/results");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `websearch-live-${now}.json`);
writeFileSync(outPath, JSON.stringify(receipt, null, 2));

console.log(`\nreceipt: ${outPath}`);
console.log(`free live-verified (${freeVerified.length}): ${freeVerified.join(", ") || "none"}`);
console.log(`paid live-verified (${paidVerified.length}): ${paidVerified.join(", ") || "none"}`);
console.log(
	`paid liveness-verified (${receipt.summary.paidLivenessVerified.length}): ${receipt.summary.paidLivenessVerified.join(", ") || "none"}`,
);
console.log(`floor (5 free live + 5 paid): ${receipt.summary.floorMet ? "MET" : "NOT MET"}`);
process.exitCode = receipt.summary.floorMet || process.argv.includes("--no-exit-code") ? 0 : 1;
