export interface Task {
	id: string;
	title: string;
	done: boolean;
}

const SEED: Task[] = [
	{ id: "t-01", title: "Sketch the dashboard layout", done: true },
	{ id: "t-02", title: "Seed the in-memory store", done: true },
	{ id: "t-03", title: "Wire GET /api/tasks", done: true },
	{ id: "t-04", title: "Add pagination to the list route", done: false },
	{ id: "t-05", title: "Add GET /api/tasks/:id", done: true },
	{ id: "t-06", title: "Write the pagination tests", done: true },
	{ id: "t-07", title: "Review the error responses", done: false },
	{ id: "t-08", title: "Ship the demo to staging", done: false },
	{ id: "t-09", title: "Cache the hot list route", done: false },
	{ id: "t-10", title: "Write the README", done: true },
];

let tasks: Task[] = [...SEED];

export function allTasks(): Task[] {
	return tasks;
}

export function findTask(id: string): Task | undefined {
	return tasks.find((t) => t.id === id);
}

/** Test-only: reset the store between suites. */
export function resetStore(): void {
	tasks = [...SEED];
}
