// Unit tests for the todo addon's pure core (src/addons/todo-core.ts):
// the 4-state task machine, blockedBy dependency validation with cycle
// rejection, sanitization, the overlay row-budget layout and branch replay.
// The interactive overlay/tool wiring is exercised by the TUI-capture
// scenarios; these tests pin the data contracts.
import { describe, expect, test } from "bun:test";
import {
	applyTaskMutation,
	changesState,
	deriveBlocks,
	detectCycle,
	EMPTY_STATE,
	isLegalTransition,
	isTaskDetails,
	replayFromBranch,
	STATE_ENTRY_TYPE,
	sanitizeTerminalText,
	selectOverlayLayout,
	selectOverlayTasks,
	selectShowTaskIds,
	selectTodoCounts,
	type Task,
	type TaskMutationParams,
	type TaskState,
} from "../../src/addons/todo-core.ts";

function createTasks(count: number, status: Task["status"] = "pending"): TaskState {
	return {
		tasks: Array.from({ length: count }, (_, index) => ({
			id: index + 1,
			subject: `task ${index + 1}`,
			status,
		})),
		nextId: count + 1,
	};
}

const create = (subject: string, extra: Partial<TaskMutationParams> = {}): TaskMutationParams => ({
	action: "create",
	subject,
	...extra,
});

describe("todo status machine", () => {
	test("legal transitions", () => {
		expect(isLegalTransition("pending", "in_progress")).toBe(true);
		expect(isLegalTransition("pending", "completed")).toBe(true);
		expect(isLegalTransition("in_progress", "pending")).toBe(true);
		expect(isLegalTransition("in_progress", "completed")).toBe(true);
		expect(isLegalTransition("completed", "deleted")).toBe(true);
		// completed never reopens; deleted is terminal; same→same always valid.
		expect(isLegalTransition("completed", "pending")).toBe(false);
		expect(isLegalTransition("completed", "in_progress")).toBe(false);
		expect(isLegalTransition("deleted", "pending")).toBe(false);
		expect(isLegalTransition("pending", "pending")).toBe(true);
	});

	test("update rejects illegal transitions and keeps state untouched", () => {
		const state = createTasks(1, "completed");
		const result = applyTaskMutation(state, "update", { action: "update", id: 1, status: "pending" });
		expect(result.op.kind).toBe("error");
		expect(result.state.tasks[0]!.status).toBe("completed");
		expect(result.state).not.toBe(state); // rejected calls still return a clone
	});
});

describe("todo reducer", () => {
	test("create assigns sequential ids and defaults to pending", () => {
		const result = applyTaskMutation(EMPTY_STATE, "create", create("Research existing tool"));
		expect(result.op.kind).toBe("create");
		expect(result.state.tasks[0]).toMatchObject({ id: 1, subject: "Research existing tool", status: "pending" });
		expect(result.state.nextId).toBe(2);
	});

	test("create requires a subject", () => {
		const result = applyTaskMutation(EMPTY_STATE, "create", create("  "));
		expect(result.op.kind).toBe("error");
		expect(result.state.tasks.length).toBe(0);
	});

	test("update requires a mutable field", () => {
		const state = createTasks(1);
		const result = applyTaskMutation(state, "update", { action: "update", id: 1 });
		expect(result.op.kind).toBe("error");
	});

	test("no-op updates report changed=false and append nothing", () => {
		const state = createTasks(1, "in_progress");
		const result = applyTaskMutation(state, "update", { action: "update", id: 1, status: "in_progress" });
		expect(result.op.kind).toBe("update");
		expect(result.op.changed).toBe(false);
		expect(changesState(result.op)).toBe(false);
	});

	test("delete tombstones instead of removing", () => {
		const state = createTasks(2);
		const result = applyTaskMutation(state, "delete", { action: "delete", id: 1 });
		expect(result.state.tasks[0]!.status).toBe("deleted");
		expect(result.state.tasks.length).toBe(2);
		// Double delete is rejected.
		const again = applyTaskMutation(result.state, "delete", { action: "delete", id: 1 });
		expect(again.op.kind).toBe("error");
	});

	test("clear resets ids", () => {
		const state = createTasks(3);
		const result = applyTaskMutation(state, "clear", { action: "clear" });
		expect(result.state).toEqual({ tasks: [], nextId: 1 });
	});

	test("metadata null values delete keys; empty records drop the field", () => {
		const withMeta = applyTaskMutation(EMPTY_STATE, "create", create("t", { metadata: { a: 1, b: 2 } }));
		const removed = applyTaskMutation(withMeta.state, "update", {
			action: "update",
			id: 1,
			metadata: { b: null },
		});
		expect(removed.state.tasks[0]!.metadata).toEqual({ a: 1 });
		const emptied = applyTaskMutation(removed.state, "update", {
			action: "update",
			id: 1,
			metadata: { a: null },
		});
		expect(emptied.state.tasks[0]!.metadata).toBeUndefined();
	});
});

describe("blockedBy dependencies", () => {
	test("create validates blockedBy exists and is live", () => {
		const state = createTasks(1);
		expect(applyTaskMutation(state, "create", create("x", { blockedBy: [9] })).op.kind).toBe("error");
		const deleted = applyTaskMutation(state, "delete", { action: "delete", id: 1 }).state;
		expect(applyTaskMutation(deleted, "create", create("x", { blockedBy: [1] })).op.kind).toBe("error");
	});

	test("update addBlockedBy is additive; self-block and cycles rejected", () => {
		const state = createTasks(2);
		const added = applyTaskMutation(state, "update", {
			action: "update",
			id: 1,
			addBlockedBy: [2],
		});
		expect(added.state.tasks[0]!.blockedBy).toEqual([2]);
		// Self-block:
		expect(applyTaskMutation(added.state, "update", { action: "update", id: 1, addBlockedBy: [1] }).op.kind).toBe(
			"error",
		);
		// Cycle: 2 blocked by 1 (proposed) while 1 is blocked by 2:
		expect(applyTaskMutation(added.state, "update", { action: "update", id: 2, addBlockedBy: [1] }).op.kind).toBe(
			"error",
		);
		// removeBlockedBy filters without validation:
		const removed = applyTaskMutation(added.state, "update", {
			action: "update",
			id: 1,
			removeBlockedBy: [2],
		});
		expect(removed.state.tasks[0]!.blockedBy).toBeUndefined();
	});

	test("detectCycle finds a 3-node cycle and passes a chain", () => {
		const chain: Task[] = [
			{ id: 1, subject: "a", status: "pending", blockedBy: [2] },
			{ id: 2, subject: "b", status: "pending", blockedBy: [3] },
			{ id: 3, subject: "c", status: "pending" },
		];
		expect(detectCycle(chain)).toBeNull();
		const cycle: Task[] = [
			{ id: 1, subject: "a", status: "pending", blockedBy: [2] },
			{ id: 2, subject: "b", status: "pending", blockedBy: [3] },
			{ id: 3, subject: "c", status: "pending", blockedBy: [1] },
		];
		expect(detectCycle(cycle)).not.toBeNull();
	});

	test("deriveBlocks computes reverse edges", () => {
		const tasks: Task[] = [
			{ id: 1, subject: "a", status: "pending" },
			{ id: 2, subject: "b", status: "pending", blockedBy: [1] },
			{ id: 3, subject: "c", status: "pending", blockedBy: [1] },
		];
		expect(deriveBlocks(tasks, 1)).toEqual([2, 3]);
		expect(deriveBlocks(tasks, 2)).toEqual([]);
	});
});

describe("sanitizeTerminalText", () => {
	test("strips CSI, OSC, stray escapes and control characters", () => {
		expect(sanitizeTerminalText("\x1b[31mred\x1b[0m")).toBe("red");
		expect(sanitizeTerminalText("\x1b]0;title\x07after")).toBe("after");
		expect(sanitizeTerminalText("ok\x1bQnext")).toBe("oknext");
		expect(sanitizeTerminalText("a\x00b\x07c")).toBe("a b c");
		expect(sanitizeTerminalText("line1\nline2\ttab")).toBe("line1\nline2\ttab");
	});
	test("neutralizes bidi controls and line separators", () => {
		expect(sanitizeTerminalText("a‎b")).toBe("ab");
		expect(sanitizeTerminalText("a b")).toBe("a b");
	});
});

describe("overlay layout", () => {
	test("fits within budget with no summary row", () => {
		const tasks = createTasks(11);
		const layout = selectOverlayLayout(tasks.tasks, 11);
		expect(layout.visible.length).toBe(11);
		expect(layout.hiddenCompleted).toBe(0);
		expect(layout.truncatedTail).toBe(0);
	});

	test("12 tasks with body budget 11 (maxWidgetLines 12): 10 rows + 2 hidden completed", () => {
		const tasks = createTasks(8);
		tasks.tasks.push(
			{ id: 9, subject: "c1", status: "completed" },
			{ id: 10, subject: "c2", status: "completed" },
			{ id: 11, subject: "c3", status: "completed" },
			{ id: 12, subject: "c4", status: "completed" },
		);
		// The overlay passes bodyBudget = maxWidgetLines - 1 (the heading
		// consumes one row); 12 tasks > 11 → innerBudget 10 → 8 pending + 2
		// completed visible, "+2 more (2 completed)" (pinned by the rpiv spec).
		const layout = selectOverlayLayout(tasks.tasks, 11);
		expect(layout.visible.length).toBe(10);
		expect(layout.hiddenCompleted).toBe(2);
		expect(layout.truncatedTail).toBe(0);
		// Completed tasks dropped first — all 8 pending visible.
		expect(layout.visible.filter((task) => task.status === "pending").length).toBe(8);
	});

	test("unfinished overflow truncates the tail, completed all hidden", () => {
		const tasks = createTasks(14);
		tasks.tasks.push({ id: 15, subject: "c", status: "completed" });
		const layout = selectOverlayLayout(tasks.tasks, 12);
		expect(layout.visible.length).toBe(11);
		expect(layout.truncatedTail).toBe(3);
		expect(layout.hiddenCompleted).toBe(1);
	});

	test("selectOverlayTasks hides tombstones and drained completed", () => {
		const tasks = createTasks(3, "completed");
		tasks.tasks[2]!.status = "deleted";
		const visible = selectOverlayTasks(tasks, new Set([1]));
		expect(visible.map((task) => task.id)).toEqual([2]);
	});

	test("counts and id-visibility selectors", () => {
		const mixed: Task[] = [
			{ id: 1, subject: "a", status: "completed" },
			{ id: 2, subject: "b", status: "in_progress" },
			{ id: 3, subject: "c", status: "pending", blockedBy: [2] },
		];
		expect(selectTodoCounts(mixed)).toEqual({ completed: 1, total: 3 });
		expect(selectShowTaskIds(mixed)).toBe(true);
		expect(selectShowTaskIds(mixed.slice(0, 2))).toBe(false);
	});
});

describe("branch replay", () => {
	test("entries win over toolResults; corrupt snapshots are skipped", () => {
		const branch = {
			getBranch: () => [
				{
					type: "message",
					message: {
						role: "toolResult",
						toolName: "todo",
						details: {
							action: "list",
							params: {},
							tasks: [{ id: 1, subject: "old", status: "pending" }],
							nextId: 2,
						},
					},
				},
				{ type: "custom", customType: STATE_ENTRY_TYPE, data: { tasks: "not an array", nextId: 3 } },
				{
					type: "custom",
					customType: STATE_ENTRY_TYPE,
					data: {
						action: "create",
						params: {},
						tasks: [{ id: 1, subject: "new", status: "completed" }],
						nextId: 2,
					},
				},
			],
		};
		const state = replayFromBranch(branch);
		expect(state.tasks[0]!.subject).toBe("new");
		expect(isTaskDetails({ tasks: [] })).toBe(false);
		expect(isTaskDetails({ tasks: [], nextId: 1 })).toBe(true);
	});

	test("missing branch yields the empty state", () => {
		expect(replayFromBranch(undefined).tasks.length).toBe(0);
		expect(replayFromBranch({ getBranch: () => [] }).tasks.length).toBe(0);
	});
});
