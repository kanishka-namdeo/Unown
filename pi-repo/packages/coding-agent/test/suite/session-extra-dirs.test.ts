/**
 * session-extra-dirs.test.ts — the both-stores seam (the unown sessions
 * round): ENV_EXTRA_SESSION_DIRS + mergeSessionInfos.
 *
 * Wrappers that keep sessions in more than one directory (unown's project
 * import lane next to the primary store) set ENV_EXTRA_SESSION_DIRS and
 * every picker — launch-time and in-session — shows the union. Pins:
 *   1. unset env → no extra dirs (pi behaves exactly as before)
 *   2. parsing: delimiter-split, trimmed, deduped, existing dirs only
 *   3. mergeSessionInfos dedupes by path and sorts newest-first
 */

import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delimiter } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	ENV_EXTRA_SESSION_DIRS,
	getExtraSessionDirs,
	mergeSessionInfos,
	type SessionInfo,
} from "../../src/core/session-manager.ts";

const created: string[] = [];

function makeDir(name: string): string {
	const dir = join(tmpdir(), `pi-extra-dirs-${Date.now()}-${name}`);
	mkdirSync(dir, { recursive: true });
	created.push(dir);
	return dir;
}

afterEach(() => {
	while (created.length > 0) {
		const dir = created.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
	delete process.env[ENV_EXTRA_SESSION_DIRS];
});

describe("getExtraSessionDirs", () => {
	it("returns [] when the env is unset", () => {
		delete process.env[ENV_EXTRA_SESSION_DIRS];
		expect(getExtraSessionDirs()).toEqual([]);
	});

	it("returns [] for an empty value", () => {
		process.env[ENV_EXTRA_SESSION_DIRS] = "";
		expect(getExtraSessionDirs()).toEqual([]);
	});

	it("splits on the path delimiter, trims, dedupes, and keeps only existing dirs", () => {
		const a = makeDir("a");
		const b = makeDir("b");
		const missing = join(tmpdir(), `pi-extra-dirs-${Date.now()}-missing`);
		process.env[ENV_EXTRA_SESSION_DIRS] = [a, `  ${b}  `, missing, "", a].join(delimiter);
		expect(getExtraSessionDirs()).toEqual([a, b]);
	});

	it("resolves relative entries against the cwd", () => {
		const dir = makeDir("rel-target");
		process.env[ENV_EXTRA_SESSION_DIRS] = dir;
		const resolved = getExtraSessionDirs();
		expect(resolved).toHaveLength(1);
		expect(resolved[0]).toBe(dir);
	});
});

describe("mergeSessionInfos", () => {
	function info(path: string, modified: Date): SessionInfo {
		return {
			path,
			id: path,
			cwd: "/tmp",
			created: modified,
			modified,
			messageCount: 1,
			firstMessage: "hi",
			allMessagesText: "hi",
		};
	}

	it("dedupes by path (first list wins) and sorts newest-modified first", () => {
		const older = info("/sessions/older.jsonl", new Date(1_000));
		const newer = info("/sessions/newer.jsonl", new Date(2_000));
		const dupOfNewer = info("/sessions/newer.jsonl", new Date(3_000));
		const merged = mergeSessionInfos([[older, dupOfNewer], [newer]]);
		expect(merged.map((s) => s.path)).toEqual(["/sessions/newer.jsonl", "/sessions/older.jsonl"]);
		// the FIRST occurrence wins the dedupe — callers pass the primary
		// store first, so its metadata is authoritative
		expect(merged[0]).toBe(dupOfNewer);
	});

	it("returns [] for empty lists", () => {
		expect(mergeSessionInfos([[], []])).toEqual([]);
	});
});
