/**
 * PINS the current createdBy representation: a structured author record
 * { id, name }. These tests document the author contract end to end.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { resetIds } from "../src/ids.ts";
import { formatNote } from "../src/format.ts";
import { runCli, freshDeps } from "../src/cli.ts";
import { Notebook } from "../src/notebook.ts";
import { authorStats } from "../src/stats.ts";
import { parseNote, StoreError } from "../src/store.ts";
import { DEFAULT_AUTHOR, mkNote, OTHER_AUTHOR } from "./helpers.ts";

beforeEach(() => resetIds());

describe("author representation", () => {
	test("note.createdBy is the structured {id, name} author", () => {
		expect(mkNote().createdBy).toEqual({ id: "u-001", name: "ada" });
		expect(typeof mkNote().createdBy).toBe("object");
	});

	test("notebook.byAuthor matches on the author id", () => {
		const book = new Notebook();
		book.add({ title: "a", body: "b", createdBy: DEFAULT_AUTHOR });
		book.add({ title: "c", body: "d", createdBy: OTHER_AUTHOR });
		expect(book.byAuthor("u-001").map((n) => n.title)).toEqual(["a"]);
	});

	test("formatNote renders '(by <name> [<id>])'", () => {
		const line = formatNote(mkNote());
		expect(line).toContain("(by ada [u-001])");
	});

	test("stats rows are keyed by author id and carry the name", () => {
		const rows = authorStats([mkNote(), mkNote(), mkNote({ createdBy: OTHER_AUTHOR })]);
		expect(rows.map((r) => r.id)).toEqual(["u-001", "u-002"]);
		expect(rows[0]).toEqual({ id: "u-001", name: "ada", count: 2, words: 6 });
	});

	test("store rejects a note whose createdBy is a plain string", () => {
		const bad = { ...mkNote(), createdBy: "ada" };
		expect(() => parseNote(bad)).toThrow(StoreError);
	});

	test("cli stats lines render '<name> (<id>): <count> notes, <words> words'", () => {
		const deps = freshDeps();
		runCli(["add", "one", "--body", "hello world", "--author", "ada"], deps);
		runCli(["add", "two", "--body", "hi", "--author", "ada"], deps);
		expect(runCli(["stats"], deps)).toBe("ada (u-001): 2 notes, 3 words");
	});
});
