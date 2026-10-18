// Regression test for outbox idempotency (audit MEDIUM-5).
//
// The note row used to be inserted BEFORE the archive rename, and a failed
// rename was swallowed inside archiveOutboxNote — the file stayed in
// outbox/ and every later pass (note-sync job, next boot) re-ingested it:
// duplicate note corpus, dreams consolidating the same session twice.
//
// The archive failure is forced NATURALLY: notes/done is occupied by a
// plain file, so both mkdirSync and renameSync inside archiveOutboxNote
// fail (the exact class of swallowed real-world failures: read-only dir,
// Windows EBUSY from a held handle).
import "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { UNOWN_NOTES_DIR, UNOWN_NOTES_DONE_DIR, UNOWN_OUTBOX_DIR, writeOutboxNote } from "../src/term.ts";
import { syncNoteOutbox } from "../src/outbox.ts";
import { store } from "../src/store.ts";

const MARKER = `outbox-dedup-${Date.now().toString(36)}`;
const PROJECT = join("/tmp", MARKER);

const terminalNotes = () =>
	store.query<{ id: string; content: string }>(
		`SELECT id, content FROM notes WHERE kind = 'terminal' AND project_path = ? ORDER BY created_at`,
		[PROJECT],
	);

afterAll(() => {
	// restore a sane archive dir for later suites
	rmSync(UNOWN_NOTES_DONE_DIR, { recursive: true, force: true });
	try {
		mkdirSync(UNOWN_NOTES_DONE_DIR, { recursive: true });
	} catch {
		/* best effort */
	}
	// remove this suite's notes so counts never leak across runs
	for (const n of terminalNotes()) store.run(`DELETE FROM notes WHERE id = ?`, [n.id]);
});

describe("syncNoteOutbox idempotency (MEDIUM-5)", () => {
	test("a file whose archive rename keeps failing is ingested exactly ONCE, and archives on a later healthy pass", () => {
		// clean slate for this project's notes
		for (const n of terminalNotes()) store.run(`DELETE FROM notes WHERE id = ?`, [n.id]);

		// 1. an offline note lands in the outbox
		const file = writeOutboxNote({ content: `terminal session note for ${MARKER}`, projectPath: PROJECT, ts: Date.now() });
		expect(existsSync(file)).toBe(true);

		// 2. force the archive failure: notes/done occupied by a FILE
		rmSync(UNOWN_NOTES_DONE_DIR, { recursive: true, force: true });
		writeFileSync(UNOWN_NOTES_DONE_DIR, "not a directory");

		// 3. first sync: ingests the note, archive silently fails
		const first = syncNoteOutbox();
		expect(first).toBeGreaterThanOrEqual(1);
		expect(terminalNotes()).toHaveLength(1);

		// 4. second sync (the bug): same file, still unarchived — must NOT duplicate
		const second = syncNoteOutbox();
		expect(second).toBe(0);
		expect(terminalNotes()).toHaveLength(1);
		expect(existsSync(file)).toBe(true); // still pending archive

		// 5. heal the archive dir: the pending file archives without re-ingesting
		rmSync(UNOWN_NOTES_DONE_DIR, { recursive: true, force: true });
		mkdirSync(UNOWN_NOTES_DONE_DIR, { recursive: true });
		const third = syncNoteOutbox();
		expect(third).toBe(0); // deduped, but the archive retry happens
		expect(terminalNotes()).toHaveLength(1);
		expect(existsSync(file)).toBe(false); // archived now
		expect(existsSync(join(UNOWN_NOTES_DONE_DIR, basename(file)))).toBe(true); // basename: POSIX split("/") breaks on Windows paths
	});

	test("distinct sessions with different content are both ingested (dedup does not over-block)", () => {
		for (const n of terminalNotes()) store.run(`DELETE FROM notes WHERE id = ?`, [n.id]);
		rmSync(UNOWN_NOTES_DONE_DIR, { recursive: true, force: true });
		mkdirSync(UNOWN_NOTES_DONE_DIR, { recursive: true });

		writeOutboxNote({ content: `session A for ${MARKER}: edited two files, tests green`, projectPath: PROJECT, ts: Date.now() });
		writeOutboxNote({ content: `session B for ${MARKER}: different outcome entirely`, projectPath: PROJECT, ts: Date.now() + 5 });
		const ingested = syncNoteOutbox();
		expect(ingested).toBe(2);
		expect(terminalNotes()).toHaveLength(2);
	});
});

// keep tree tidy (outbox files of this run are archived; nothing else ours)
test("suite hygiene: no leftover outbox files from this suite", () => {
	const leftovers = readdirSync(UNOWN_OUTBOX_DIR).filter((f) => f.includes(MARKER));
	expect(leftovers).toEqual([]);
	expect(statSync(UNOWN_NOTES_DONE_DIR).isDirectory()).toBe(true);
});
