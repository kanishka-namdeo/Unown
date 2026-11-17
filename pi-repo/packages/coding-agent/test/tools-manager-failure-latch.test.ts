import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Calando Q3 — the managed-tool download failure latch.
 *
 * First failure: the full actionable notice ("Failed to download fd: ..."),
 * which the interactive renderer rewrites into the long form with the
 * recovery path. Repeat failures (a user behind a proxy / rate-limited
 * GitHub sees one every boot): ONE dim line naming the tool, the attempt
 * count and the manual way out — recurring identical notices train
 * scan-past. Success (or the tool appearing locally) clears the counter.
 *
 * The latch file lives in the agent bin dir, so the test points
 * PI_CODING_AGENT_DIR at a temp home BEFORE importing the module (the bin
 * dir is resolved at import time) and stubs global fetch so the download
 * fails deterministically with no network.
 *
 * Every case is SELF-SUFFICIENT (seeds exactly the state it asserts on)
 * and a beforeEach scrubs the bin dir: the runner's scheduling of cases
 * within a file is not a contract this pin is willing to lean on.
 */

const agentDir = join(tmpdir(), `pi-tools-latch-${process.pid}-${Date.now()}`);
const binDir = join(agentDir, "bin");
mkdirSync(binDir, { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.PI_OFFLINE;

const realFetch = globalThis.fetch;
// Every HTTP attempt fails with a 503 — deterministic, no network.
globalThis.fetch = (async () => new Response("stubbed unavailable", { status: 503 })) as typeof fetch;

const { ensureTool } = await import("../src/utils/tools-manager.ts");

const countsPath = join(binDir, ".download-failures.json");
const fakeFd = join(binDir, "fd");
const readCounts = (): Record<string, number> =>
	existsSync(countsPath) ? (JSON.parse(readFileSync(countsPath, "utf8")) as Record<string, number>) : {};
const writeCounts = (counts: Record<string, number>): void => writeFileSync(countsPath, JSON.stringify(counts), "utf8");

beforeEach(() => {
	rmSync(fakeFd, { force: true });
	rmSync(countsPath, { force: true });
});

afterAll(() => {
	rmSync(agentDir, { recursive: true, force: true });
	globalThis.fetch = realFetch;
});

describe("tools-manager failure latch — Calando Q3", () => {
	test("first failure: full notice, counter at 1", async () => {
		const messages: string[] = [];
		const path = await ensureTool("fd", (s) => messages.push(s.message));
		expect(path).toBeUndefined();
		expect(messages.some((m) => /^Failed to download fd: /.test(m))).toBe(true);
		expect(readCounts().fd).toBe(1);
	});

	test("second failure: ONE short line with the attempt count", async () => {
		writeCounts({ fd: 1 }); // the prior boot already failed once
		const messages: string[] = [];
		const path = await ensureTool("fd", (s) => messages.push(s.message));
		expect(path).toBeUndefined();
		expect(messages.some((m) => /still not installed — download failed again \(attempt 2\)/.test(m))).toBe(true);
		expect(messages.some((m) => /^Failed to download fd: /.test(m))).toBe(false);
		expect(readCounts().fd).toBe(2);
	});

	test("recovery: a local binary clears the counter", async () => {
		writeCounts({ fd: 4 }); // a beaten path of failures
		writeFileSync(fakeFd, "#!/bin/sh\nexit 0\n", "utf8");
		chmodSync(fakeFd, 0o755);
		const path = await ensureTool("fd");
		expect(path).toBe(fakeFd);
		expect(readCounts().fd).toBeUndefined();
	});
});
