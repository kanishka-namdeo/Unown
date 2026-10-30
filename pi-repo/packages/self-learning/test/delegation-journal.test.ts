/**
 * delegation-journal.test.ts — the delegation round's journal enrichment pins
 * (checkpoint 2): the audit fields (why / taskPreview / usage / outcome)
 * round-trip through the fleet journal, and the reader tolerates both the
 * enriched entries and pre-0.0.46 entries without them.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type FleetJournalEntry,
	fleetJournalPath,
	readFleetJournal,
	recordFleetChildFinish,
	recordFleetChildSpawn,
	recordSyncSubagentSpawn,
} from "../src/fleet-reaper.ts";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "delegation-journal-"));
});

afterEach(() => {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {
		/* best effort */
	}
});

describe("the delegation round's journal enrichment", () => {
	test("a sync spawn carries why + taskPreview; the finished entry carries the audit payload", () => {
		recordSyncSubagentSpawn(dir, {
			id: "sync-1",
			name: "scout",
			agent: "scout",
			pid: 123,
			parentPid: 100,
			promptFile: "/tmp/unown-subagent-X/system-prompt.md",
			ts: 1_000,
			why: "context pressure — a broad grep would flood this window",
			taskPreview: "Find every caller of parseConfig()",
		});
		recordFleetChildFinish(dir, "sync-1", "done", {
			turns: 6,
			tokensIn: 45_000,
			tokensOut: 3_000,
			toolCalls: 14,
			elapsedMs: 42_000,
			why: "context pressure — a broad grep would flood this window",
			taskPreview: "Find every caller of parseConfig()",
		});
		const entries = readFleetJournal(dir);
		expect(entries).toHaveLength(2);
		const spawned = entries[0] as FleetJournalEntry & { why?: string; taskPreview?: string; lane?: string };
		expect(spawned.op).toBe("spawned");
		expect(spawned.lane).toBe("sync");
		expect(spawned.why).toBe("context pressure — a broad grep would flood this window");
		expect(spawned.taskPreview).toBe("Find every caller of parseConfig()");
		const finished = entries[1] as FleetJournalEntry & { turns?: number; tokensIn?: number; blocked?: boolean };
		expect(finished.op).toBe("finished");
		expect(finished.status).toBe("done");
		expect(finished.turns).toBe(6);
		expect(finished.tokensIn).toBe(45_000);
		expect(finished.tokensOut).toBe(3_000);
		expect(finished.toolCalls).toBe(14);
		expect(finished.elapsedMs).toBe(42_000);
	});

	test("a fleet spawn carries the audit fields too (both lanes, one journal)", () => {
		recordFleetChildSpawn(dir, {
			id: "fleet-1",
			name: "counter",
			agent: "general",
			pid: 200,
			parentPid: 100,
			sessionFile: "/x/session.jsonl",
			controlFile: "/x/control.json",
			askFile: "/x/ask.json",
			ts: 1_000,
			why: "parallelism — keep answering while it counts",
			taskPreview: "Count the TypeScript lines under test/",
		});
		recordFleetChildFinish(dir, "fleet-1", "blocked", {
			turns: 1,
			tokensIn: 800,
			tokensOut: 60,
			toolCalls: 1,
			elapsedMs: 2_000,
			blocked: true,
		});
		const entries = readFleetJournal(dir);
		expect(entries).toHaveLength(2);
		const spawned = entries[0] as FleetJournalEntry & { why?: string; lane?: string };
		expect(spawned.op).toBe("spawned");
		expect(spawned.lane).toBeUndefined(); // fleet lane stays the default spelling
		expect(spawned.why).toBe("parallelism — keep answering while it counts");
		const finished = entries[1] as FleetJournalEntry & { blocked?: boolean };
		expect(finished.status).toBe("blocked");
		expect(finished.blocked).toBe(true);
	});

	test("entries WITHOUT the audit fields still parse (pre-0.0.46 journals stay readable)", () => {
		// The exact 0.0.45 spelling, copied from a live journal line.
		const legacy =
			'{"op":"spawned","lane":"sync","id":"sync-mvunv699-dq4ina","name":"scout","agent":"scout","pid":7872,"parentPid":7851,"promptFile":"/tmp/unown-subagent-nhgBPN/system-prompt.md","ts":1793345933428}\n';
		const { writeFileSync } = require("node:fs") as typeof import("node:fs");
		writeFileSync(fleetJournalPath(dir), legacy, { flag: "a" });
		const entries = readFleetJournal(dir);
		expect(entries).toHaveLength(1);
		expect((entries[0] as { why?: string }).why).toBeUndefined();
	});

	test("the finished entry without extras keeps its historical shape (callers that skip extras)", () => {
		recordFleetChildFinish(dir, "x", "abandoned-lane-sweep");
		const entries = readFleetJournal(dir);
		expect(entries[0]).toMatchObject({ op: "finished", id: "x", status: "abandoned-lane-sweep" });
	});
});

describe("the delegations store schema (the F34 boot pin)", () => {
	test("a FRESH database constructs and carries both delegations objects (statement order is a contract)", () => {
		const { Store } = require("../src/store.ts") as {
			Store: new (path: string) => { query<T = any>(sql: string): T[] };
		};
		const fresh = mkdtempSync(join(tmpdir(), "f34-boot-"));
		try {
			const store = new Store(join(fresh, "fresh.db"));
			const objs = store.query<{ name: string; type: string }>(
				"SELECT name, type FROM sqlite_master WHERE name LIKE '%delegations%'",
			);
			const table = objs.find((o) => o.name === "delegations");
			const index = objs.find((o) => o.name === "idx_delegations_ts");
			expect(table?.type).toBe("table");
			expect(index?.type).toBe("index");
		} finally {
			// Best-effort cleanup: on Windows the sqlite handle can still be
			// open when rmSync runs (EBUSY, caught live on the CI runner) —
			// the assertions all ran BEFORE this point, so a leftover tempdir
			// never fails the pin.
			try {
				rmSync(fresh, { recursive: true, force: true });
			} catch {
				/* the OS temp cleaner owns it now */
			}
		}
	});
});
