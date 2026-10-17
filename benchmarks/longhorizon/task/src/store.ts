import { readFileSync, writeFileSync } from "node:fs";
import { createNote } from "./note.ts";
import type { Note } from "./types.ts";

export class StoreError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StoreError";
	}
}

/** Envelope written to disk. `parseStore` is lenient about note payloads; */
/** strict per-note validation lives in `parseNote` (used by `loadNotes`). */
export interface StoreData {
	version: 1;
	notes: Note[];
}

/** Serialize notes to the on-disk JSON text. */
export function serializeNotes(notes: Note[]): string {
	return `${JSON.stringify({ version: 1, notes }, null, 2)}\n`;
}

/** Strictly validate ONE raw parsed note object. */
export function parseNote(raw: unknown): Note {
	if (typeof raw !== "object" || raw === null) throw new StoreError("note must be an object");
	const r = raw as Record<string, unknown>;
	if (typeof r.id !== "string") throw new StoreError("note.id must be a string");
	if (typeof r.title !== "string") throw new StoreError("note.title must be a string");
	if (typeof r.body !== "string") throw new StoreError("note.body must be a string");
	if (typeof r.createdAt !== "number") throw new StoreError("note.createdAt must be a number");
	if (typeof r.createdBy !== "string") throw new StoreError("note.createdBy must be a string");
	if (!Array.isArray(r.tags) || r.tags.some((t) => typeof t !== "string")) {
		throw new StoreError("note.tags must be string[]");
	}
	return createNote({
		id: r.id,
		title: r.title,
		body: r.body,
		createdAt: r.createdAt,
		createdBy: r.createdBy,
		tags: r.tags as string[],
	});
}

/** Parse store text. Envelope is validated; note payloads are passed through. */
export function parseStore(text: string): Note[] {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new StoreError("invalid JSON");
	}
	if (typeof data !== "object" || data === null) throw new StoreError("store must be an object");
	const envelope = data as Record<string, unknown>;
	if (envelope.version !== 1) throw new StoreError("unsupported store version");
	if (!Array.isArray(envelope.notes)) throw new StoreError("store.notes must be an array");
	return envelope.notes as Note[];
}

/** Persist notes to a JSON file (strict format). */
export function saveNotes(path: string, notes: Note[]): void {
	writeFileSync(path, serializeNotes(notes), "utf8");
}

/** Load notes from a JSON file: strict per-note validation applies. */
export function loadNotes(path: string): Note[] {
	const text = readFileSync(path, "utf8");
	return parseStore(text).map(parseNote);
}
