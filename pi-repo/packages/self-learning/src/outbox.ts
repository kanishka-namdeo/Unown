/**
 * outbox.ts — terminal-note outbox synchronization (engine side).
 *
 * `unown` terminal sessions deliver their session notes to the engine via
 * POST /api/notes when the engine is reachable. When it is not (offline work,
 * engine down), the note is written to $UNOWN_HOME/notes/outbox/ instead.
 * The engine ingests those files on boot and on the note-sync router job,
 * then archives them to notes/done/.
 */
import { ingestTerminalNote } from "./notes.ts";
import { readOutboxNotes, archiveOutboxNote } from "./term.ts";
import { emit } from "./bus.ts";

/** Ingest all pending outbox notes. Returns the number ingested. */
export function syncNoteOutbox(): number {
	let count = 0;
	for (const { file, note } of readOutboxNotes()) {
		try {
			ingestTerminalNote(note.content, note.projectPath);
			archiveOutboxNote(file);
			count++;
		} catch {
			/* leave the file for the next pass */
		}
	}
	if (count > 0) emit("notes:synced", { count });
	return count;
}
