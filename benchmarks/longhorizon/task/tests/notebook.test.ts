/** Notebook container behavior (representation-independent). */
import { beforeEach, describe, expect, test } from "bun:test";
import { resetIds } from "../src/ids.ts";
import { Notebook } from "../src/notebook.ts";
import { DEFAULT_AUTHOR, mkNote, OTHER_AUTHOR } from "./helpers.ts";

beforeEach(() => resetIds());

describe("notebook", () => {
	test("add returns the stored note and all() round-trips it", () => {
		const book = new Notebook();
		const note = mkNote({ title: "Ship it" });
		const stored = book.add({ ...note, id: undefined as unknown as string });
		expect(book.all()).toEqual([stored]);
		expect(book.get(stored.id)?.title).toBe("Ship it");
	});

	test("remove deletes by id and reports success", () => {
		const book = new Notebook();
		const a = book.add({ title: "a", body: "b", createdBy: DEFAULT_AUTHOR });
		expect(book.remove(a.id)).toBe(true);
		expect(book.size()).toBe(0);
		expect(book.remove("n-999")).toBe(false);
	});

	test("byTag filters on tags", () => {
		const book = new Notebook();
		book.add({ title: "a", body: "b", createdBy: DEFAULT_AUTHOR, tags: ["work"] });
		book.add({ title: "c", body: "d", createdBy: DEFAULT_AUTHOR, tags: ["home"] });
		expect(book.byTag("work").map((n) => n.title)).toEqual(["a"]);
	});

	test("sortedByTitle sorts alphabetically without mutating", () => {
		const book = new Notebook();
		book.add({ title: "zeta", body: "b", createdBy: DEFAULT_AUTHOR });
		book.add({ title: "alpha", body: "b", createdBy: DEFAULT_AUTHOR });
		expect(book.sortedByTitle().map((n) => n.title)).toEqual(["alpha", "zeta"]);
		expect(book.all()[0].title).toBe("zeta");
	});

	test("two authors coexist without interference", () => {
		const book = new Notebook();
		book.add({ title: "a", body: "b", createdBy: DEFAULT_AUTHOR });
		book.add({ title: "c", body: "d", createdBy: OTHER_AUTHOR });
		expect(book.size()).toBe(2);
	});
});
