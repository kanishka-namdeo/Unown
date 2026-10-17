/** Stats rollups (counts and totals; author keying is pinned in author.test.ts). */
import { beforeEach, describe, expect, test } from "bun:test";
import { resetIds } from "../src/ids.ts";
import { authorStats, totalWords } from "../src/stats.ts";
import { DEFAULT_AUTHOR, mkNote, OTHER_AUTHOR } from "./helpers.ts";

beforeEach(() => resetIds());

describe("stats", () => {
	test("authorStats counts notes per author", () => {
		const rows = authorStats([mkNote(), mkNote(), mkNote({ createdBy: OTHER_AUTHOR })]);
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.count).sort((a, b) => b - a)).toEqual([2, 1]);
	});

	test("authorStats sums body words per author", () => {
		const rows = authorStats([mkNote({ body: "one two three" }), mkNote({ body: "four" })]);
		expect(rows).toHaveLength(1);
		expect(rows[0].words).toBe(4);
	});

	test("authorStats sorts by count descending", () => {
		const rows = authorStats([
			mkNote({ createdBy: OTHER_AUTHOR }),
			mkNote(),
			mkNote({ createdBy: OTHER_AUTHOR }),
			mkNote({ createdBy: OTHER_AUTHOR }),
		]);
		expect(rows[0].count).toBe(3);
	});

	test("totalWords sums across all notes", () => {
		expect(totalWords([mkNote({ body: "a b" }), mkNote({ body: "c d e" })])).toBe(5);
		expect(totalWords([])).toBe(0);
	});
});
