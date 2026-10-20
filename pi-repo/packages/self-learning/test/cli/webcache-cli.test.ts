// CLI tests for `unown webcache` (M3 — the web results store surface).
//
// Same hermetic harness as help.test.ts: the real bin, private UNOWN_HOME,
// dead engine URL, mock bridge. The store is pointed at a per-test temp dir
// via UNOWN_WEB_CACHE_DIR (the same knob the unit suite pins) and SEEDED
// directly on disk — the store's layout (entries/<xx>/<sha256>.json +
// events.jsonl) is its contract, so writing the files from the test is the
// honest way to control exactly what stats counts (webcache.test.ts covers
// the store logic itself).
import "../_env.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockBridge, sweepTestRoots, type UnownRunOptions, unown } from "./helpers.ts";

let bridge: ReturnType<typeof startMockBridge>;
const base = (extra: Partial<UnownRunOptions> = {}): UnownRunOptions => ({ bridge, ...extra });

const storeRoots: string[] = [];

/** A private seeded store dir (swept in afterAll). */
function freshStore(): string {
	const root = mkdtempSync(join(tmpdir(), "unown-webcache-cli-"));
	storeRoots.push(root);
	return root;
}

/** Seed: two entry files (4 B total) + an events feed with 2 hits, 1
 *  revalidation, 1 miss (75% hit rate, 3 saved requests, providers
 *  tavily 2 / duckduckgo 2, tools web_search 2 / webfetch 2). */
function seedStore(root: string): void {
	mkdirSync(join(root, "entries", "ab"), { recursive: true });
	mkdirSync(join(root, "entries", "cd"), { recursive: true });
	writeFileSync(join(root, "entries", "ab", `${"ab".padEnd(64, "0")}.json`), "{}");
	writeFileSync(join(root, "entries", "cd", `${"cd".padEnd(64, "1")}.json`), "{}");
	const events = [
		{ ts: 1, kind: "hit", tool: "web_search", provider: "tavily" },
		{ ts: 2, kind: "hit", tool: "webfetch", provider: "duckduckgo" },
		{ ts: 3, kind: "revalidated", tool: "webfetch", provider: "duckduckgo" },
		{ ts: 4, kind: "miss", tool: "web_search", provider: "tavily" },
	];
	writeFileSync(join(root, "events.jsonl"), `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
}

beforeAll(() => {
	bridge = startMockBridge({ label: "cli-webcache" });
});
afterAll(() => {
	bridge?.close();
	sweepTestRoots();
	for (const root of storeRoots) {
		try {
			rmSync(root, { recursive: true, force: true });
		} catch {
			/* best effort — /tmp is janitor-swept */
		}
	}
});

describe("unown webcache stats", () => {
	test("prints the store root, entries, TTLs, hit rate and top providers", async () => {
		const store = freshStore();
		seedStore(store);
		const run = await unown(["webcache", "stats"], base({ env: { UNOWN_WEB_CACHE_DIR: store } }));
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain(store); // the store root
		expect(run.stdout).toContain("enabled");
		expect(run.stdout).toContain("entries     2 ("); // seeded entry count + size
		// (2 hits + 1 revalidation) / (2 + 1 + 1 miss) = 75%
		expect(run.stdout).toContain("75%");
		expect(run.stdout).toContain("3 upstream requests"); // savedRequests
		expect(run.stdout).toContain("tavily 2");
		expect(run.stdout).toContain("duckduckgo 2");
		// TTL defaults: search 60 min fresh, fetch 30 min heuristic, 24h/7d stale windows
		expect(run.stdout).toContain("search 1h");
		expect(run.stdout).toContain("fetch 30m");
		expect(run.stdout).toContain("stale-if-error 1d search / 7d fetch");
	}, 30_000);

	test("`unown webcache` with no subcommand is stats", async () => {
		const store = freshStore();
		seedStore(store);
		const run = await unown(["webcache"], base({ env: { UNOWN_WEB_CACHE_DIR: store } }));
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain(store);
		expect(run.stdout).toContain("75%");
	}, 30_000);

	test("--json parses as the raw WebCacheStats object", async () => {
		const store = freshStore();
		seedStore(store);
		const run = await unown(["webcache", "stats", "--json"], base({ env: { UNOWN_WEB_CACHE_DIR: store } }));
		expect(run.exitCode).toBe(0);
		const parsed = JSON.parse(run.stdout);
		expect(parsed.enabled).toBe(true);
		expect(parsed.root).toBe(store);
		expect(parsed.entries).toBe(2);
		expect(parsed.maxBytes).toBe(268435456); // the 256 MiB default cap
		expect(parsed.ttl).toEqual({
			searchMs: 3600000,
			fetchMs: 1800000,
			searchStaleMs: 86400000,
			fetchStaleMs: 604800000,
		});
		expect(parsed.totals.hit).toBe(2);
		expect(parsed.totals.revalidated).toBe(1);
		expect(parsed.totals.miss).toBe(1);
		expect(parsed.savedRequests).toBe(3);
		expect(parsed.byProvider).toEqual({ tavily: 2, duckduckgo: 2 });
		expect(Array.isArray(parsed.recentEvents)).toBe(true);
	}, 30_000);

	test("a disabled store (UNOWN_WEB_CACHE=0) says so instead of failing", async () => {
		const store = freshStore();
		seedStore(store);
		const run = await unown(
			["webcache", "stats"],
			base({ env: { UNOWN_WEB_CACHE_DIR: store, UNOWN_WEB_CACHE: "0" } }),
		);
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("disabled");
		expect(run.stdout).toContain("UNOWN_WEB_CACHE=0");
	}, 30_000);
});

describe("unown webcache clear / sweep", () => {
	test("clear removes the seeded entries and reports them", async () => {
		const store = freshStore();
		seedStore(store);
		const run = await unown(["webcache", "clear"], base({ env: { UNOWN_WEB_CACHE_DIR: store } }));
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("removed 2 entries");
		// the follow-up stats run sees an empty store (the events feed survives
		// by design — history is not state)
		const after = await unown(["webcache", "stats", "--json"], base({ env: { UNOWN_WEB_CACHE_DIR: store } }));
		expect(after.exitCode).toBe(0);
		const parsed = JSON.parse(after.stdout);
		expect(parsed.entries).toBe(0);
		expect(parsed.totals.clear).toBe(1); // the clear event itself
	}, 30_000);

	test("sweep reports an honest zero under the default cap", async () => {
		const store = freshStore();
		seedStore(store);
		const run = await unown(["webcache", "sweep"], base({ env: { UNOWN_WEB_CACHE_DIR: store } }));
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("evicted 0 entries"); // 4 B ≪ 256 MiB cap
	}, 30_000);

	test("sweep evicts down to the byte cap when the store exceeds it", async () => {
		const store = freshStore();
		mkdirSync(join(store, "entries", "ab"), { recursive: true });
		writeFileSync(join(store, "entries", "ab", `${"ab".padEnd(64, "0")}.json`), "x".repeat(2048));
		const run = await unown(
			["webcache", "sweep"],
			base({ env: { UNOWN_WEB_CACHE_DIR: store, UNOWN_WEB_CACHE_MAX_BYTES: "1024" } }),
		);
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("evicted 1 entry");
	}, 30_000);
});

describe("unown webcache — clig.dev surface", () => {
	test("`unown webcache --help` prints the page, stats never run", async () => {
		const run = await unown(["webcache", "--help"], base());
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("usage: unown webcache");
		// a stats-run marker — the page describes the fields, the run prints them
		expect(run.stdout).not.toContain("ttl         search");
	}, 30_000);

	test("`unown help webcache` prints the same page", async () => {
		const run = await unown(["help", "webcache"], base());
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("usage: unown webcache");
	}, 30_000);

	test("`unown help` lists the webcache command (drift guard)", async () => {
		const run = await unown(["help"], base());
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("unown webcache");
	}, 30_000);

	test("an unknown subcommand is an error with usage, never a TUI prompt", async () => {
		const run = await unown(["webcache", "definitely-not-a-subcommand"], base());
		expect(run.exitCode).toBe(1);
		expect(run.stderr).toContain('unknown subcommand "definitely-not-a-subcommand"');
		expect(run.stderr).toContain("usage: unown webcache");
	}, 30_000);

	test("an unknown flag is an error with usage", async () => {
		const run = await unown(["webcache", "stats", "--bogus"], base());
		expect(run.exitCode).toBe(1);
		expect(run.stderr).toContain("unknown argument");
	}, 30_000);
});

describe("unown doctor — the web results store line", () => {
	test("the enabled store reports entries, size, hit rate and saved requests", async () => {
		const store = freshStore();
		seedStore(store);
		const run = await unown(["doctor"], base({ env: { UNOWN_WEB_CACHE_DIR: store } }));
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("web results store");
		expect(run.stdout).toContain("2 entries");
		expect(run.stdout).toContain("75% hit rate");
		expect(run.stdout).toContain("saved 3 requests");
	}, 60_000);

	test("a disabled store is the warn line, not a failure", async () => {
		const run = await unown(["doctor"], base({ env: { UNOWN_WEB_CACHE: "0" } }));
		expect(run.exitCode).toBe(0); // warn-level by doctor's contract
		expect(run.stdout).toContain("web results store");
		expect(run.stdout).toContain("disabled (UNOWN_WEB_CACHE=0)");
	}, 60_000);

	test("`unown doctor --json` carries the check and the summary object", async () => {
		const store = freshStore();
		seedStore(store);
		const run = await unown(["doctor", "--json"], base({ env: { UNOWN_WEB_CACHE_DIR: store } }));
		expect(run.exitCode).toBe(0);
		const parsed = JSON.parse(run.stdout);
		const check = (parsed.checks ?? []).find((c: any) => c.id === "web-results-store");
		expect(check?.status).toBe("pass");
		expect(check?.detail).toContain("75% hit rate");
		expect(parsed.webCache).toEqual({
			enabled: true,
			root: store,
			entries: 2,
			bytes: 4,
			maxBytes: 268435456,
			hitRate: 75,
			savedRequests: 3,
		});
	}, 60_000);
});
