// migrations.test.ts — forward-only user-state migration runner.
import "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CURRENT_STATE_VERSION,
	MIGRATIONS,
	type Migration,
	migrationsPath,
	readMigrationState,
	runMigrations,
} from "../src/migrations.ts";

let TMP: string;
function fresh(): string {
	TMP ??= mkdtempSync(join(tmpdir(), "unown-mig-"));
	const d = join(TMP, `c-${Math.random().toString(36).slice(2)}`);
	mkdirSync(d, { recursive: true });
	return d;
}

describe("migrations", () => {
	test("shipped registry is empty at v1 — the runner is the mechanism, not a pending change", () => {
		expect(CURRENT_STATE_VERSION).toBe(1);
		expect(MIGRATIONS).toEqual([]);
	});

	test("empty registry: version stays 1, state file materialized", async () => {
		const home = fresh();
		const result = await runMigrations(home);
		expect(result.version).toBe(CURRENT_STATE_VERSION);
		expect(result.applied).toEqual([]);
		expect(readMigrationState(home).version).toBe(1);
		expect(existsSync(migrationsPath(home))).toBe(true);
	});

	test("chained migrations apply in order and bump the recorded version", async () => {
		const home = fresh();
		const calls: string[] = [];
		const registry: Migration[] = [
			{
				from: 1,
				name: "v1-to-v2",
				run: () => {
					calls.push("v1-to-v2");
					return true;
				},
			},
			{
				from: 2,
				name: "v2-to-v3",
				run: () => {
					calls.push("v2-to-v3");
					return true;
				},
			},
		];
		const result = await runMigrations(home, registry);
		expect(calls).toEqual(["v1-to-v2", "v2-to-v3"]);
		expect(result.version).toBe(3);
		expect(readMigrationState(home).version).toBe(3);
		const again = await runMigrations(home, registry);
		expect(again.applied).toEqual([]); // idempotent by recorded version
	});

	test("a failing migration is recorded and non-fatal; the version never advances past it", async () => {
		const home = fresh();
		const registry: Migration[] = [
			{
				from: 1,
				name: "boom",
				run: () => {
					throw new Error("kaboom");
				},
			},
		];
		const result = await runMigrations(home, registry);
		expect(result.failed.length).toBe(1);
		expect(result.failed[0].error).toContain("kaboom");
		expect(readMigrationState(home).version).toBe(1);
		expect(readMigrationState(home).history?.some((h) => !h.ok)).toBe(true);
	});

	test("a migration returning false is a soft failure (same contract as throwing)", async () => {
		const home = fresh();
		const registry: Migration[] = [{ from: 1, name: "nope", run: () => false }];
		const result = await runMigrations(home, registry);
		expect(result.failed[0].error).toBe("returned false");
		expect(readMigrationState(home).version).toBe(1);
	});

	test("a newer state file (downgrade case) is not walked back", async () => {
		const home = fresh();
		writeFileSync(migrationsPath(home), JSON.stringify({ version: 5 }));
		const result = await runMigrations(home, []);
		expect(result.version).toBe(5);
	});

	test("history is capped (last 20 entries survive, older ones roll off)", async () => {
		const home = fresh();
		writeFileSync(
			migrationsPath(home),
			JSON.stringify({
				version: 1,
				history: Array.from({ length: 30 }, (_, i) => ({ name: `old-${i}`, at: "2020-01-01T00:00:00Z", ok: true })),
			}),
		);
		const registry: Migration[] = [
			{
				from: 1,
				name: "one-more",
				run: () => true,
			},
		];
		await runMigrations(home, registry);
		const state = readMigrationState(home);
		expect((state.history ?? []).length).toBe(20);
		expect((state.history ?? []).some((h) => h.name === "one-more")).toBe(true);
	});
});

afterAll(() => {
	if (TMP) rmSync(TMP, { recursive: true, force: true });
});
