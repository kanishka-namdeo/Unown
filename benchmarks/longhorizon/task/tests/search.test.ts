/** Search behavior (content queries; author queries are pinned in author.test.ts). */
import { beforeEach, describe, expect, test } from "bun:test";
import { resetIds } from "../src/ids.ts";
import { findByTitle, findMatches } from "../src/search.ts";
import { DEFAULT_AUTHOR, mkNote } from "./helpers.ts";

beforeEach(() => resetIds());

describe("search", () => {
	test("findMatches matches title substrings case-insensitively", () => {
		const notes = [mkNote({ title: "Alpha note" }), mkNote({ title: "beta" })];
		expect(findMatches(notes, "alpha").map((n) => n.title)).toEqual(["Alpha note"]);
	});

	test("findMatches matches body substrings", () => {
		const notes = [mkNote({ body: "the deploy failed" }), mkNote({ body: "all green" })];
		expect(findMatches(notes, "deploy").map((n) => n.title)).toEqual(["note title"]);
	});

	test("findMatches matches tags", () => {
		const notes = [mkNote({ tags: ["urgent"] }), mkNote({ tags: ["later"] })];
		expect(findMatches(notes, "urgent")).toHaveLength(1);
	});

	test("findMatches returns [] for empty or blank queries", () => {
		expect(findMatches([mkNote()], "")).toEqual([]);
		expect(findMatches([mkNote()], "   ")).toEqual([]);
	});

	test("findByTitle matches exactly (case-insensitive)", () => {
		const notes = [mkNote({ title: "Ship it" })];
		expect(findByTitle(notes, "ship it")).toHaveLength(1);
		expect(findByTitle(notes, "ship")).toHaveLength(0);
	});
});
