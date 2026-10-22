/**
 * Unit tests for the M3 dream-news lane — the data path behind the
 * "✦ AutoDream learned N new rules" toast, end to end minus the UI:
 *
 *   dream.ts latestDreamNews  — the dreams-store scan: status/added/age
 *                               filters, the project-dream note grammar, the
 *                               engine-dream shadowing rule, the bounded
 *                               8-row walk, and the fail-soft store hiccup;
 *   server.ts /api/overview   — the dreamNews response key: present with the
 *                               parsed five fields when there is news, and
 *                               OMITTED ENTIRELY when there is none (pre-M3
 *                               consumers must never meet a field they never
 *                               learned — the dashboard's mock engine serves
 *                               no such key either).
 *
 * The zero-spam decision (shouldToastDreamNews), the toast copy and the
 * session latch are pinned in test/engine-status.test.ts next to the loop
 * that fires them; the wire-block decoder (parseDreamNews) in
 * test/engine-supervisor.test.ts next to engineHealth's other payload pins.
 *
 * Store: the suite's redirected DB (./_env.ts). The dreams table is emptied
 * before every scenario and again in afterAll (the dream-guard.test.ts
 * precedent): bun runs test files sequentially in one process, every other
 * dreams-writing suite clears the same table, and an empty table is what
 * makes every scan below see only rows this file wrote. /api/overview is
 * driven through the REAL
 * handleApi() — the exact composition the fetch handler uses for /api/*
 * routes — whose bridgeHealth() call fails fast against _env.ts's dead port
 * and only feeds the response's bridge block.
 */
import "./_env.ts"; // MUST be the first import
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { latestDreamNews } from "../src/dream.ts";
import { handleApi } from "../src/server.ts";
import { store } from "../src/store.ts";

/** Insert one dreams row with the columns latestDreamNews reads (the same
 *  shape runDream/runProjectDream INSERT — every other column NULLs over). */
function insertDream(r: {
	id: string;
	endedAt: number | null;
	status?: string;
	entriesAdded?: number | null;
	note?: string;
}): void {
	store.run(
		`INSERT INTO dreams (id, started_at, ended_at, status, notes_in, entries_added, output, note)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[r.id, (r.endedAt ?? 0) - 1000, r.endedAt, r.status ?? "done", 1, r.entriesAdded ?? 0, "# out", r.note ?? ""],
	);
}

/** GET /api/overview through the real routing layer (status pinned 200). */
async function overview(): Promise<Record<string, any>> {
	const res = await handleApi({ method: "GET", path: "/api/overview", query: new URLSearchParams(), body: null });
	expect(res.status).toBe(200);
	return (await res.json()) as Record<string, any>;
}

afterAll(() => {
	// Leave the shared redirected DB exactly as this file found it: empty
	// of dreams (beforeEach already clears between scenarios; this is the
	// failed-mid-test backstop — the dream-guard.test.ts convention).
	store.run(`DELETE FROM dreams`);
});

describe("latestDreamNews — the dreams-store scan", () => {
	beforeEach(() => {
		store.run(`DELETE FROM dreams`);
	});

	test("the newest additive project dream is the news (slug + version parsed from the note)", () => {
		const endedAt = Date.now() - 60_000;
		insertDream({
			id: "project-1",
			endedAt,
			entriesAdded: 3,
			note: "project dream: acme memory -> v18 (/scratch/acme)",
		});
		expect(latestDreamNews()).toEqual({ id: "project-1", project: "acme", added: 3, version: 18, at: endedAt });
	});

	test("an engine-scope dream on top does not shadow it (note grammar differs)", () => {
		const endedAt = Date.now() - 60_000;
		insertDream({
			id: "project-1",
			endedAt,
			entriesAdded: 3,
			note: "project dream: acme memory -> v18 (/scratch/acme)",
		});
		// The engine path shares the table AND populates entries_added, but its
		// note is the engine-memories shape ("project memory -> v… · canaries…")
		// — parsed as no project dream, so the scan walks past it.
		insertDream({
			id: "engine-1",
			endedAt: Date.now() - 10_000,
			entriesAdded: 2,
			note: "project memory -> v20 · canaries: fix-csv-parser: passed (runners: bun)",
		});
		expect(latestDreamNews()).toEqual({ id: "project-1", project: "acme", added: 3, version: 18, at: endedAt });
	});

	test("no-change dreams are never news: added=0, gated, in-flight (NULL ended_at), legacy NULL added", () => {
		const t = Date.now() - 30_000;
		// honest no-change render (the common project-dream outcome)
		insertDream({
			id: "p-zero",
			endedAt: t,
			entriesAdded: 0,
			note: "project dream: acme memory -> v2 (/scratch/acme)",
		});
		// gated dreams added nothing that shipped
		insertDream({
			id: "p-gated",
			endedAt: t,
			status: "gated",
			entriesAdded: 3,
			note: "project dream: acme memory -> v18 (/scratch/acme)",
		});
		// a dream still running has no end time
		insertDream({
			id: "p-running",
			endedAt: null,
			entriesAdded: 3,
			note: "project dream: acme memory -> v18 (/scratch/acme)",
		});
		// pre-M3 rows never populated entries_added (NULL fails the > 0 test)
		insertDream({
			id: "p-legacy",
			endedAt: t,
			entriesAdded: null,
			note: "project dream: acme memory -> v4 (/scratch/acme)",
		});
		expect(latestDreamNews()).toBeNull();
	});

	test("the 1h window: stale news is no news, and the scan trims the exact edge the toast decision still accepts", () => {
		insertDream({
			id: "p-old",
			endedAt: Date.now() - 2 * 3_600_000,
			entriesAdded: 5,
			note: "project dream: acme memory -> v9 (/scratch/acme)",
		});
		expect(latestDreamNews()).toBeNull();
		// The scan's WHERE is strictly greater-than: a dream exactly maxAge old
		// is already out (shouldToastDreamNews's inclusive ≤1h boundary never
		// even sees it — the store is one tick stricter than the decision, by
		// construction, so the wire can never carry news the latch would
		// reject).
		const edge = Date.now() - 3_600_000;
		insertDream({
			id: "p-edge",
			endedAt: edge,
			entriesAdded: 5,
			note: "project dream: acme memory -> v9 (/scratch/acme)",
		});
		expect(latestDreamNews()).toBeNull();
	});

	test("the bounded walk: seven newer engine dreams do not shadow the news; eight age it out (the documented trade)", () => {
		const endedAt = Date.now() - 60_000;
		insertDream({
			id: "project-1",
			endedAt,
			entriesAdded: 2,
			note: "project dream: acme memory -> v6 (/scratch/acme)",
		});
		// 7 additive engine dreams newer than the project dream: the scan
		// walks past them and still finds the news.
		for (let i = 0; i < 7; i++) {
			insertDream({
				id: `engine-${i}`,
				endedAt: Date.now() - 50_000 + i * 1000,
				entriesAdded: 1,
				note: `project memory -> v${20 + i} · canaries: passed`,
			});
		}
		expect(latestDreamNews()?.id).toBe("project-1");
		// the 8th pushes the project dream out of the newest-8 window: null.
		// Bounded on purpose — the scan is a cheap indexed top-8, and a project
		// dream buried under 8+ engine dreams is a minute from aging out of the
		// 1h window anyway; the footer bar still narrates the memory itself.
		insertDream({
			id: "engine-8",
			endedAt: Date.now() - 49_000,
			entriesAdded: 1,
			note: "project memory -> v28 · canaries: passed",
		});
		expect(latestDreamNews()).toBeNull();
	});

	test("a store hiccup is contained: the scan degrades to no news, never throws", () => {
		// Hide the table the way a mid-migration boot would see it gone; the
		// try/catch in latestDreamNews turns the query error into null (the
		// overview probe must never 500 over a toast's data source).
		store.run(`ALTER TABLE dreams RENAME TO dreams_missing_m3`);
		try {
			expect(latestDreamNews()).toBeNull();
		} finally {
			store.run(`ALTER TABLE dreams_missing_m3 RENAME TO dreams`);
		}
	});
});

describe("/api/overview — the dreamNews response key", () => {
	beforeEach(() => {
		store.run(`DELETE FROM dreams`);
	});

	test("no fresh additive project dream → the key is OMITTED (not null — pre-M3 consumers never learn it)", async () => {
		const body = await overview();
		expect("dreamNews" in body).toBe(false);
	});

	test("a fresh additive project dream ships the parsed block, engine dreams on top notwithstanding", async () => {
		const endedAt = Date.now() - 60_000;
		insertDream({
			id: "project-9",
			endedAt,
			entriesAdded: 4,
			note: "project dream: acme memory -> v18 (/scratch/acme)",
		});
		insertDream({
			id: "engine-9",
			endedAt: Date.now() - 10_000,
			entriesAdded: 2,
			note: "project memory -> v21 · canaries: passed",
		});
		const body = await overview();
		expect(body.dreamNews).toEqual({ id: "project-9", project: "acme", added: 4, version: 18, at: endedAt });
	});
});
