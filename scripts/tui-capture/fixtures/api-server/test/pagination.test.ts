import { describe, expect, test } from "bun:test";
import { paginate } from "../src/pagination.ts";

describe("paginate", () => {
	test("first page returns exactly perPage items", () => {
		const items = Array.from({ length: 10 }, (_, i) => i);
		expect(paginate(items, 1, 3)).toHaveLength(3);
	});

	test("page 2 continues where page 1 ended", () => {
		const items = Array.from({ length: 10 }, (_, i) => i);
		expect(paginate(items, 2, 3)).toEqual([3, 4, 5]);
	});

	test("last page returns only the remaining items", () => {
		const items = Array.from({ length: 10 }, (_, i) => i);
		expect(paginate(items, 4, 3)).toEqual([9]);
	});
});
