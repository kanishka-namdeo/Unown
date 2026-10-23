// dreams-run-projects.test.ts — regression: POST /api/dreams/run (the
// dashboard Dreams screen's "D — run autodream now" key) must run the PROJECT
// dream lane for pending TERMINAL notes, not just the engine dream lane.
//
// The pre-fix endpoint counted ALL undreamed notes for its {started:true,
// pendingNotes:N} answer but only invoked runDream() — the benchmark-note
// lane, which needs >= 3 benchmark notes and otherwise inserts a junk
// no-notes row. A real user's most common note (a terminal session note)
// therefore reported "started" and silently consolidated nothing: dream-now
// was a no-op exactly where it matters most.
//
// Pinned here, against the redirected store (dead-bridge env from _env.ts —
// extraction fails fast, which is the honest 'error' dream row):
//   1. a pending TERMINAL note alone gets {started:true, pendingNotes:1};
//   2. the fire-and-forget takes the PROJECT lane: a `project-*` dream row
//      appears with notes_in = 1 (status 'error' — the dead test bridge, not
//      a skip; the lane RAN);
//   3. no junk engine 'no-notes' row is fabricated along the way;
//   4. the terminal note stays pending on a pre-consolidate failure (the
//      lossless-retry contract from runProjectDream's error handling).
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleApi } from "../src/server.ts";
import { ingestTerminalNote } from "../src/notes.ts";
import { store } from "../src/store.ts";

const REQ = {
	method: "POST",
	query: new URLSearchParams(),
	body: null as any,
};

const SCRATCH = join(tmpdir(), "dreams-run-projects");
const PROJECT = join(SCRATCH, "victim");

async function pollUntil(desc: string, timeoutMs: number, check: () => boolean | Promise<boolean>) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await check()) return;
		await new Promise((r) => setTimeout(r, 150));
	}
	throw new Error(`pollUntil timeout (${desc}) after ${timeoutMs}ms`);
}

beforeAll(() => {
	mkdirSync(PROJECT, { recursive: true });
	store.run(`DELETE FROM notes`);
	store.run(`DELETE FROM dreams`);
});

afterAll(() => {
	store.run(`DELETE FROM notes`);
	store.run(`DELETE FROM dreams`);
	rmSync(SCRATCH, { recursive: true, force: true });
});

describe("POST /api/dreams/run — the terminal-note lane (dashboard dream-now)", () => {
	test("a pending terminal note alone triggers a project dream (previously: silent no-op)", async () => {
		ingestTerminalNote(
			"Terminal session outcome: pinned the flaky parser test by forcing column offsets in the CSV reader.",
			PROJECT,
		);
		const pending = store.get<any>(`SELECT COUNT(*) AS c FROM notes WHERE dream_id IS NULL`)?.c ?? 0;
		expect(pending).toBe(1);

		const res = await handleApi({ ...REQ, path: "/api/dreams/run" });
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, any>;
		expect(body.started).toBe(true);
		expect(body.pendingNotes).toBe(1);

		// The fire-and-forget must take the PROJECT lane: a `project-*`
		// dream row appears. Status 'error' is the honest outcome against
		// the dead test bridge (port 9) — what is pinned is that the lane
		// RAN with the note, instead of fabricating a no-op.
		let row: any = null;
		await pollUntil("project dream row", 30_000, () => {
			row = store.get<any>(`SELECT * FROM dreams WHERE id LIKE 'project-%' ORDER BY started_at DESC LIMIT 1`);
			return Boolean(row && row.ended_at);
		});
		expect(row.notes_in).toBe(1);
		expect(row.status).toBe("error");

		// No junk engine 'no-notes' row alongside the real project row.
		const junk = store.get<any>(`SELECT COUNT(*) AS c FROM dreams WHERE status = 'no-notes'`)?.c ?? 0;
		expect(junk).toBe(0);

		// Pre-consolidate failure keeps the note pending (lossless retry —
		// nothing diverged, the next dream re-claims the same note).
		const stillPending = store.get<any>(
			`SELECT COUNT(*) AS c FROM notes WHERE dream_id IS NULL`,
		)?.c ?? 0;
		expect(stillPending).toBe(1);
	}, 45_000);
});
