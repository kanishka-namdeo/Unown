/** Store envelope behavior: round-trips and envelope validation (lenient parse). */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "bun:test";
import { resetIds } from "../src/ids.ts";
import { loadNotes, parseStore, saveNotes, serializeNotes, StoreError } from "../src/store.ts";
import { mkNote } from "./helpers.ts";

beforeEach(() => resetIds());

function scratchDir(): string {
	return mkdtempSync(join(tmpdir(), "clippad-"));
}

describe("store", () => {
	test("serializeNotes → parseStore round-trips notes exactly", () => {
		const notes = [mkNote(), mkNote({ title: "two" })];
		const restored = parseStore(serializeNotes(notes));
		expect(restored).toEqual(notes);
	});

	test("parseStore rejects invalid JSON", () => {
		expect(() => parseStore("not json")).toThrow(StoreError);
	});

	test("parseStore rejects non-object payloads", () => {
		expect(() => parseStore("42")).toThrow(StoreError);
	});

	test("parseStore rejects unknown envelope versions", () => {
		expect(() => parseStore('{"version":2,"notes":[]}')).toThrow(StoreError);
	});

	test("parseStore rejects envelopes without a notes array", () => {
		expect(() => parseStore('{"version":1}')).toThrow(StoreError);
	});

	test("saveNotes → loadNotes round-trips through the filesystem", () => {
		const path = join(scratchDir(), "notes.json");
		const notes = [mkNote()];
		saveNotes(path, notes);
		expect(loadNotes(path)).toEqual(notes);
	});
});
