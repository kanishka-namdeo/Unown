import { describe, expect, test } from "bun:test";
import { resetStore, allTasks, findTask } from "../src/store.ts";

describe("store", () => {
	test("seeds ten tasks", () => {
		resetStore();
		expect(allTasks()).toHaveLength(10);
	});

	test("finds a task by id", () => {
		resetStore();
		expect(findTask("t-01")?.title).toBe("Sketch the dashboard layout");
	});
});
