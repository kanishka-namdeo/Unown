/**
 * outbox.ts — terminal-note outbox synchronization (engine side).
 *
 * `unown` terminal sessions deliver their session notes to the engine via
 * POST /api/notes when the engine is reachable. When it is not (offline work,
 * engine down), the note is written to $UNOWN_HOME/notes/outbox/ instead.
 * The engine ingests those files on boot and on the note-sync router job,
 * then archives them to notes/done/.
 *
 * H1 (2026-10-26 hardening round) — the dead-letter lane: a note file that
 * cannot be ingested is retried a BOUNDED number of times
 * (UNOWN_OUTBOX_MAX_ATTEMPTS, default 5), then moved to notes/dead/ with a
 * .reason.txt sidecar and counted in outboxStats().dead. Pre-hardening, a
 * file whose ingest kept throwing (or whose frontmatter never parsed) was
 * retried every drain pass forever, silently — no counter, no record, no way
 * to notice. The dead files are preserved (never deleted): manual recovery
 * is reading the reason, fixing the note, and `mv`-ing it back into outbox/.
 * The MemOS AutoDroppingQueue dead-letter-quarantine lane and Graphiti's
 * acknowledged-then-dropped queue loss (#1707) are the published precedents:
 * every dropped/failed job must leave a queryable record.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { emit } from "./bus.ts";
import { ingestTerminalNote } from "./notes.ts";
import { store } from "./store.ts";
import {
	archiveOutboxNote,
	clearOutboxAttempts,
	deadLetterOutboxNote,
	OUTBOX_MAX_ATTEMPTS,
	readOutboxNotes,
	recordOutboxAttempt,
	UNOWN_OUTBOX_DIR,
} from "./term.ts";

/**
 * Ingest all pending outbox notes. Returns the number NEWLY ingested.
 *
 * MEDIUM-5: the note row used to be inserted BEFORE the archive rename,
 * and a failed rename was swallowed inside archiveOutboxNote — the file
 * stayed in outbox/ and every later pass re-ingested it (duplicate note
 * corpus; dreams consolidated the same session twice). Ingestion is now
 * idempotent on exact (content, projectPath): a re-read of the same file
 * is byte-identical, while distinct sessions carry distinct timestamps
 * and counters. Deduped passes still retry the archive.
 *
 * H1: the failure lane is now bounded and visible. Per file:
 *   - unparseable frontmatter → dead-letter immediately (retries cannot fix
 *     a malformed file);
 *   - ingest throw → attempt recorded (attempts[filename].n++ with the last
 *     error); at OUTBOX_MAX_ATTEMPTS the file is dead-lettered with the reason;
 *   - successful ingest (fresh OR deduped) → attempts cleared + archive.
 */
export function syncNoteOutbox(): number {
	let count = 0;
	for (const { file, note } of outboxWorklist()) {
		if (!note) {
			// Unparseable: the frontmatter contract is broken — retries cannot
			// fix a malformed file, so it goes straight to the dead lane.
			deadLetterOutboxNote(file, "unparseable outbox file (missing/invalid `project:`/`ts:` frontmatter)");
			continue;
		}
		try {
			const duplicate = Boolean(
				store.get(`SELECT 1 FROM notes WHERE kind = 'terminal' AND content = ? AND project_path = ? LIMIT 1`, [
					note.content,
					note.projectPath,
				]),
			);
			if (!duplicate) {
				ingestTerminalNote(note.content, note.projectPath);
				count++;
			}
			clearOutboxAttempts(file);
			archiveOutboxNote(file);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			const attempt = recordOutboxAttempt(file, reason);
			if (attempt >= OUTBOX_MAX_ATTEMPTS) {
				deadLetterOutboxNote(file, `ingest failed ${attempt}x: ${reason}`);
			}
			/* else: leave the file for the next pass (bounded retries) */
		}
	}
	if (count > 0) emit("notes:synced", { count });
	return count;
}

/** The drain's true worklist: every .md file in the outbox, parseable or not.
 *  readOutboxNotes() silently SKIPS unparseable entries (its contract is
 *  parsed notes only); the H1 drain must SEE them to dead-letter them, so
 *  this unions the parsed set with the raw directory listing. */
function outboxWorklist(): Array<{ file: string; note: any | null }> {
	const parsedMap = new Map(readOutboxNotes().map((r) => [r.file, r.note]));
	const out: Array<{ file: string; note: any | null }> = [];
	try {
		for (const name of readdirSync(UNOWN_OUTBOX_DIR).sort()) {
			if (!name.endsWith(".md")) continue;
			const file = join(UNOWN_OUTBOX_DIR, name);
			out.push({ file, note: parsedMap.get(file) ?? null });
		}
	} catch {
		/* no outbox dir yet */
	}
	return out;
}
