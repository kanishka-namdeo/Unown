/**
 * input-history.test.ts — the persisted per-cwd input history store
 * (the Toccata round, 2026-11-15).
 *
 * Claude Code's history contract, as pinned by
 * docs/tui-claude-code-parity-research.md: per-working-directory storage,
 * cross-session recall, consecutive-duplicate suppression, scope loading
 * (this project / all projects), and failure tolerance (a history write
 * must never break a submission).
 */
import "./_env.ts";
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	appendInputHistory,
	createInputHistoryStore,
	inputHistoryEnabled,
	inputHistoryPaths,
	INPUT_HISTORY_ENV,
	loadAllProjectsNewestFirst,
	loadFileNewestFirst,
	parseInputHistoryLine,
	readInputHistoryFile,
} from "../src/input-history.ts";

function tempEnv(): { env: NodeJS.ProcessEnv; home: string } {
	const home = mkdtempSync(join(tmpdir(), "unown-input-history-"));
	const env: NodeJS.ProcessEnv = { ...process.env, UNOWN_HOME: home };
	return { env, home };
}

function cleanup(home: string): void {
	rmSync(home, { recursive: true, force: true });
}

describe("input-history paths", () => {
	test("per-cwd files hash the working directory", () => {
		const { env, home } = tempEnv();
		const a = inputHistoryPaths("/repo/alpha", env);
		const b = inputHistoryPaths("/repo/beta", env);
		expect(a.dir).toBe(join(home, "input-history"));
		expect(a.file).not.toBe(b.file);
		expect(a.file.endsWith(".jsonl")).toBe(true);
		cleanup(home);
	});

	test("the same cwd resolves to the same file", () => {
		const { env, home } = tempEnv();
		expect(inputHistoryPaths("/repo/alpha", env)).toEqual(inputHistoryPaths("/repo/alpha", env));
		cleanup(home);
	});
});

describe("input-history line parsing", () => {
	test("parses well-formed lines", () => {
		expect(parseInputHistoryLine('{"t":1000,"c":"hello"}')).toEqual({ t: 1000, c: "hello" });
	});

	test("rejects corrupt lines without throwing", () => {
		expect(parseInputHistoryLine("not json")).toBeUndefined();
		expect(parseInputHistoryLine("")).toBeUndefined();
		expect(parseInputHistoryLine('{"t":"x","c":"hello"}')).toBeUndefined();
		expect(parseInputHistoryLine('{"t":1}')).toBeUndefined();
		expect(parseInputHistoryLine('{"t":Infinity,"c":"x"}')).toBeUndefined();
	});
});

describe("input-history append + load (the Claude Code contract)", () => {
	test("appends land newest-last and load newest-first", () => {
		const { env, home } = tempEnv();
		appendInputHistory("/repo", "first prompt", env, 1000);
		appendInputHistory("/repo", "second prompt", env, 2000);
		const { file } = inputHistoryPaths("/repo", env);
		expect(loadFileNewestFirst(file)).toEqual(["second prompt", "first prompt"]);
		cleanup(home);
	});

	test("consecutive duplicates record one entry", () => {
		const { env, home } = tempEnv();
		appendInputHistory("/repo", "same prompt", env, 1000);
		appendInputHistory("/repo", "same prompt", env, 2000);
		const { file } = inputHistoryPaths("/repo", env);
		expect(loadFileNewestFirst(file)).toEqual(["same prompt"]);
		cleanup(home);
	});

	test("blank and whitespace-only prompts never persist", () => {
		const { env, home } = tempEnv();
		appendInputHistory("/repo", "   ", env, 1000);
		const { file } = inputHistoryPaths("/repo", env);
		expect(loadFileNewestFirst(file)).toEqual([]);
		cleanup(home);
	});

	test("whitespace is trimmed on persist", () => {
		const { env, home } = tempEnv();
		appendInputHistory("/repo", "  padded prompt  ", env, 1000);
		const { file } = inputHistoryPaths("/repo", env);
		expect(loadFileNewestFirst(file)).toEqual(["padded prompt"]);
		cleanup(home);
	});

	test("corrupt lines in an existing file are skipped, not fatal", () => {
		const { env, home } = tempEnv();
		const { dir, file } = inputHistoryPaths("/repo", env);
		mkdirSync(dir, { recursive: true });
		writeFileSync(file, 'garbage line\n{"t":1,"c":"good entry"}\n{"bad":true}\n', "utf8");
		expect(loadFileNewestFirst(file)).toEqual(["good entry"]);
		cleanup(home);
	});

	test("an unwritable directory never throws on append", () => {
		const { env, home } = tempEnv();
		// Point UNOWN_HOME at a path that cannot be created as a directory:
		// a file occupying the directory name.
		const blocker = join(home, "blocker");
		writeFileSync(blocker, "x", "utf8");
		const blockedEnv = { ...env, UNOWN_HOME: join(blocker, "sub", "dir") };
		expect(() => appendInputHistory("/repo", "prompt", blockedEnv, 1000)).not.toThrow();
		cleanup(home);
	});
});

describe("input-history all-projects scope", () => {
	test("merges every per-cwd file by timestamp, newest first, deduped", () => {
		const { env, home } = tempEnv();
		appendInputHistory("/repo/a", "from a (old)", env, 1000);
		appendInputHistory("/repo/b", "from b (new)", env, 3000);
		appendInputHistory("/repo/a", "from a (new)", env, 2000);
		appendInputHistory("/repo/b", "from b (new)", env, 4000); // same text, later — dedup keeps first sight (newest)
		const { dir } = inputHistoryPaths("/repo/a", env);
		const merged = loadAllProjectsNewestFirst(dir);
		expect(merged[0]).toBe("from b (new)");
		expect(merged).toContain("from a (new)");
		expect(merged).toContain("from a (old)");
		expect(new Set(merged).size).toBe(merged.length);
		cleanup(home);
	});

	test("a missing directory reads as empty", () => {
		expect(loadAllProjectsNewestFirst(join(tmpdir(), "unown-input-history-missing-dir"))).toEqual([]);
	});
});

describe("input-history store facade", () => {
	test("scopes are project + all", () => {
		const { env, home } = tempEnv();
		const store = createInputHistoryStore({ cwd: "/repo", env });
		expect(store.scopes().map((s) => s.id)).toEqual(["project", "all"]);
		cleanup(home);
	});

	test("the store round-trips through the Claude Code lane", () => {
		const { env, home } = tempEnv();
		const store = createInputHistoryStore({ cwd: "/repo", env, now: () => 1234 });
		store.append("fix the login bug");
		store.append("fix the login bug"); // consecutive dup — one record
		store.append("run the tests");
		expect(store.load("project")).toEqual(["run the tests", "fix the login bug"]);
		expect(store.load("all").slice(0, 2)).toEqual(["run the tests", "fix the login bug"]);
		expect(store.load("unknown-scope")).toEqual([]);
		cleanup(home);
	});

	test("UNOWN_INPUT_HISTORY=0 detaches persistence but keeps reads honest", () => {
		const { env, home } = tempEnv();
		const storeOn = createInputHistoryStore({ cwd: "/repo", env });
		storeOn.append("recorded");
		const envOff = { ...env, [INPUT_HISTORY_ENV]: "0" };
		expect(inputHistoryEnabled(envOff)).toBe(false);
		const storeOff = createInputHistoryStore({ cwd: "/repo", env: envOff });
		storeOff.append("never recorded");
		expect(storeOff.load("project")).toEqual(["recorded"]);
		expect(storeOn.load("project")).toEqual(["recorded"]);
		cleanup(home);
	});

	test("the file cap trims the oldest entries", async () => {
		const { env, home } = tempEnv();
		const { file } = inputHistoryPaths("/repo", env);
		mkdirSync(join(home, "input-history"), { recursive: true });
		const lines: string[] = [];
		for (let i = 0; i < 650; i++) {
			lines.push(JSON.stringify({ t: i, c: `prompt ${i}` }));
		}
		writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
		const loaded = loadFileNewestFirst(file);
		expect(loaded.length).toBe(500);
		expect(loaded[0]).toBe("prompt 649");
		expect(loaded[loaded.length - 1]).toBe("prompt 150");
		cleanup(home);
	});
});
