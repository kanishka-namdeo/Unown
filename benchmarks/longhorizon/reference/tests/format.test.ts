/** Formatter behavior (stable substrings; author rendering is pinned in author.test.ts). */
import { beforeEach, describe, expect, test } from "bun:test";
import { formatHeader, formatNote } from "../src/format.ts";
import { formatNoteTable } from "../src/format-table.ts";
import { summaryLine } from "../src/note.ts";
import { resetIds } from "../src/ids.ts";
import { DEFAULT_AUTHOR, mkNote } from "./helpers.ts";

beforeEach(() => resetIds());

describe("format", () => {
        test("formatNote includes id, title and word count", () => {
                const line = formatNote(mkNote({ title: "Ship it", body: "one two three four" }));
                expect(line).toContain("Ship it");
                expect(line).toContain("4 words");
                expect(line).toMatch(/^• \[n-\d{3}\] /);
        });

        test("formatHeader renders label and count", () => {
                expect(formatHeader("All notes", 3)).toBe("== All notes (3) ==");
        });

        test("summaryLine carries id, title and words", () => {
                const line = summaryLine(mkNote({ title: "alpha", body: "a b c" }));
                expect(line).toContain("alpha");
                expect(line).toContain("3 words");
        });
});

describe("format-table", () => {
        test("table has a header row, separator and one row per note", () => {
                const table = formatNoteTable([mkNote({ title: "alpha" }), mkNote({ title: "beta" })]);
                const lines = table.split("\n");
                expect(lines[0]).toContain("ID");
                expect(lines[0]).toContain("TITLE");
                expect(lines[0]).toContain("CREATED-BY");
                expect(lines[0]).toContain("WORDS");
                expect(lines[1]).toMatch(/^-+$/);
                expect(lines).toHaveLength(4);
        });

        test("table rows contain titles and authors", () => {
                const table = formatNoteTable([mkNote({ title: "alpha", createdBy: DEFAULT_AUTHOR })]);
                expect(table).toContain("alpha");
                expect(table).toContain("ada");
        });
});
