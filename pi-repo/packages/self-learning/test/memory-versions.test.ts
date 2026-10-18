// Regression test for the memory_versions uniqueness constraint (MEDIUM-3).
//
// memory_versions(tier, version) had NO unique constraint and
// runProjectDream allocated versions outside a transaction — two concurrent
// project dreams could insert the same (tier, version) with different
// content, making latestVersionRow/history/rollback ambiguous. Allocation is
// now serialized by BEGIN IMMEDIATE in BOTH writers, and the index makes the
// invariant structural.
import "./_env.ts";
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { store } from "../src/store.ts";

describe("memory_versions uniqueness (MEDIUM-3)", () => {
	test("the unique index exists (legacy duplicates were deduped at migration)", () => {
		const indexes = store.query<any>(`PRAGMA index_list(memory_versions)`).map((r: any) => r.name);
		expect(indexes).toContain("idx_memory_versions_tier_version");
		// And the invariant holds on the live table: no (tier, version) pairs.
		const dupes = store.query<any>(
			`SELECT tier, version, COUNT(*) AS n FROM memory_versions GROUP BY tier, version HAVING n > 1`,
		);
		expect(dupes).toEqual([]);
	});

	test("inserting a duplicate (tier, version) is REJECTED by the index", () => {
		const tier = "project";
		const max = store.get<{ version: number }>(`SELECT MAX(version) AS version FROM memory_versions WHERE tier = ?`, [tier]);
		const version = (max?.version ?? 0) + 1;
		store.run(
			`INSERT INTO memory_versions (tier, version, content, changed_by, note, created_at) VALUES (?, ?, 'c1', 'test', 'first', ?)`,
			[tier, version, Date.now()],
		);
		expect(() =>
			store.run(
				`INSERT INTO memory_versions (tier, version, content, changed_by, note, created_at) VALUES (?, ?, 'c2-conflicting', 'test', 'second writer', ?)`,
				[tier, version, Date.now()],
			),
		).toThrow();
		// cleanup the probe row so later suites see a clean table
		store.run(`DELETE FROM memory_versions WHERE tier = ? AND version = ? AND note = 'first'`, [tier, version]);
	});

	test("distinct versions for the same tier still insert freely", () => {
		const tier = "project";
		const max = store.get<{ version: number }>(`SELECT MAX(version) AS version FROM memory_versions WHERE tier = ?`, [tier]);
		const base = (max?.version ?? 0) + 1;
		const id1 = randomUUID();
		store.run(
			`INSERT INTO memory_versions (tier, version, content, changed_by, note, created_at) VALUES (?, ?, 'a', 'test', 'probe-a', ?)`,
			[tier, base, Date.now()],
		);
		store.run(
			`INSERT INTO memory_versions (tier, version, content, changed_by, note, created_at) VALUES (?, ?, 'b', 'test', 'probe-b', ?)`,
			[tier, base + 1, Date.now()],
		);
		const rows = store.query<any>(`SELECT version FROM memory_versions WHERE tier = ? AND note IN ('probe-a','probe-b')`, [tier]);
		expect(rows.map((r: any) => r.version).sort()).toEqual([base, base + 1]);
		store.run(`DELETE FROM memory_versions WHERE tier = ? AND note IN ('probe-a','probe-b')`, [tier]);
	});
});
