/**
 * outbox.ts — terminal-note outbox synchronization (engine side).
 *
 * `unown` terminal sessions deliver their session notes to the engine via
 * POST /api/notes when the engine is reachable. When it is not (offline work,
 * engine down), the note is written to $UNOWN_HOME/notes/outbox/ instead.
 * The engine ingests those files on boot and on the note-sync router job,
 * then archives them to notes/done/.
 */

import { emit } from "./bus.ts";
import { ingestTerminalNote } from "./notes.ts";
import { store } from "./store.ts";
import { archiveOutboxNote, readOutboxNotes } from "./term.ts";

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
 */
export function syncNoteOutbox(): number {
	let count = 0;
	for (const { file, note } of readOutboxNotes()) {
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
			archiveOutboxNote(file);
		} catch {
			/* leave the file for the next pass */
		}
	}
	if (count > 0) emit("notes:synced", { count });
	return count;
}
