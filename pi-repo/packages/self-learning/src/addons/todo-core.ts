/**
 * addons/todo-core.ts — pure todo-list logic (no TUI imports).
 *
 * A faithful port of @juicesharp/rpiv-todo v2.13.9 (MIT) onto unown's
 * extension surface: a 4-state task machine (pending → in_progress →
 * completed, plus a deleted tombstone), blockedBy dependency validation with
 * cycle detection, a per-session state store replayed from session-branch
 * entries, and the overlay's row-budget layout algorithm.
 *
 * The interactive widget, tool registration and /todos command live in
 * todo.ts; everything here is unit-testable headlessly
 * (test/addons/todo-core.test.ts).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export interface Task {
	id: number;
	subject: string;
	description?: string;
	activeForm?: string;
	status: TaskStatus;
	blockedBy?: number[];
	owner?: string;
	metadata?: Record<string, unknown>;
}

export interface TaskState {
	tasks: Task[];
	nextId: number;
}

export const EMPTY_STATE: TaskState = { tasks: [], nextId: 1 };

export const STATE_ENTRY_TYPE = "unown-todo-state";

/** Shape persisted into session entries and toolResult details. */
export interface TaskDetails {
	action: string;
	params: Record<string, unknown>;
	tasks: Task[];
	nextId: number;
	error?: string;
}

export interface TaskMutationResult {
	state: TaskState;
	op: { kind: string; changed: boolean; task?: Task };
}

// ---------------------------------------------------------------------------
// Status machine
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<TaskStatus, Set<TaskStatus>> = {
	pending: new Set(["in_progress", "completed", "deleted"]),
	in_progress: new Set(["pending", "completed", "deleted"]),
	completed: new Set(["deleted"]),
	deleted: new Set(),
};

export function isLegalTransition(from: TaskStatus, to: TaskStatus): boolean {
	if (from === to) return true;
	return TRANSITIONS[from].has(to);
}

// ---------------------------------------------------------------------------
// Dependency graph
// ---------------------------------------------------------------------------

/** DFS cycle detection over a proposed merged edge set. */
export function detectCycle(tasks: Task[], extraEdges?: Map<number, number[]>): string | null {
	const adjacency = new Map<number, number[]>();
	for (const task of tasks) {
		if (task.status === "deleted") continue;
		adjacency.set(
			task.id,
			(task.blockedBy ?? []).filter((id) => {
				const dependency = tasks.find((candidate) => candidate.id === id);
				return dependency !== undefined && dependency.status !== "deleted";
			}),
		);
	}
	if (extraEdges) {
		for (const [id, deps] of extraEdges) adjacency.set(id, [...(adjacency.get(id) ?? []), ...deps]);
	}
	const visited = new Set<number>();
	// Iterative DFS with per-start path tracking. A back-edge onto the
	// current path (onPath) is a cycle.
	for (const start of adjacency.keys()) {
		if (visited.has(start)) continue;
		const onPath = new Set<number>([start]);
		const stack: Array<{ node: number; iter: number }> = [{ node: start, iter: 0 }];
		while (stack.length > 0) {
			const top = stack[stack.length - 1]!;
			const edges = adjacency.get(top.node) ?? [];
			if (top.iter < edges.length) {
				const next = edges[top.iter++]!;
				if (onPath.has(next)) return `#${next}`; // back-edge → cycle
				if (!visited.has(next)) {
					onPath.add(next);
					stack.push({ node: next, iter: 0 });
				}
				continue;
			}
			onPath.delete(top.node);
			visited.add(top.node);
			stack.pop();
		}
	}
	return null;
}

/** Reverse edges: which tasks are blocked by the given task. */
export function deriveBlocks(tasks: Task[], id: number): number[] {
	return tasks.filter((task) => (task.blockedBy ?? []).includes(id)).map((task) => task.id);
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export interface TaskMutationParams {
	action: "create" | "update" | "list" | "get" | "delete" | "clear";
	subject?: string;
	description?: string;
	activeForm?: string;
	status?: TaskStatus;
	blockedBy?: number[];
	addBlockedBy?: number[];
	removeBlockedBy?: number[];
	owner?: string;
	metadata?: Record<string, unknown>;
	id?: number;
	includeDeleted?: boolean;
}

function cloneState(state: TaskState): TaskState {
	return { tasks: state.tasks.map((task) => ({ ...task })), nextId: state.nextId };
}

function findLiveTask(state: TaskState, id: number): Task | undefined {
	return state.tasks.find((task) => task.id === id && task.status !== "deleted");
}

function taskChanged(before: Task, after: Task): boolean {
	if (before.subject !== after.subject) return true;
	if (before.description !== after.description) return true;
	if (before.activeForm !== after.activeForm) return true;
	if (before.status !== after.status) return true;
	if (before.owner !== after.owner) return true;
	if (JSON.stringify(before.metadata ?? null) !== JSON.stringify(after.metadata ?? null)) return true;
	if ((before.blockedBy ?? []).join(",") !== (after.blockedBy ?? []).join(",")) return true;
	return false;
}

/** A rejected mutation: state is returned unchanged (as a clone) with the
 * rejection reason on `state.error`, so the tool layer renders the exact
 * message the reducer produced — never a re-derived approximation. */
function errorResult(state: TaskState, message: string): TaskMutationResult {
	const clone = cloneState(state);
	clone.error = message;
	return { state: clone, op: { kind: "error", changed: false } };
}

/**
 * The pure mutation reducer. A rejected call leaves state untouched (the
 * returned state is a clone, never the caller's reference).
 */
export function applyTaskMutation(
	state: TaskState,
	action: TaskMutationParams["action"],
	params: TaskMutationParams,
): TaskMutationResult {
	switch (action) {
		case "create": {
			const subject = params.subject?.trim() ?? "";
			if (subject === "") return errorResult(state, "subject required for create");
			for (const id of params.blockedBy ?? []) {
				const dependency = findLiveTask(state, id);
				if (!dependency) return errorResult(state, `blockedBy: #${id} not found`);
			}
			const task: Task = {
				id: state.nextId,
				subject,
				status: "pending",
				...(params.description?.trim() ? { description: params.description.trim() } : {}),
				...(params.activeForm?.trim() ? { activeForm: params.activeForm.trim() } : {}),
				...(params.blockedBy && params.blockedBy.length > 0 ? { blockedBy: [...params.blockedBy] } : {}),
				...(params.owner?.trim() ? { owner: params.owner.trim() } : {}),
				...(params.metadata && Object.keys(params.metadata).length > 0 ? { metadata: { ...params.metadata } } : {}),
			};
			const next: TaskState = { tasks: [...state.tasks, task], nextId: state.nextId + 1 };
			return { state: next, op: { kind: "create", changed: true, task } };
		}
		case "update": {
			if (params.id === undefined) return errorResult(state, "id required for update");
			const task = state.tasks.find((candidate) => candidate.id === params.id);
			if (!task) return errorResult(state, `#${params.id} not found`);
			if (task.status === "deleted") {
				return errorResult(state, `#${params.id} is already deleted`);
			}
			const hasMutable =
				params.subject !== undefined ||
				params.description !== undefined ||
				params.activeForm !== undefined ||
				params.status !== undefined ||
				params.owner !== undefined ||
				params.metadata !== undefined ||
				params.addBlockedBy !== undefined ||
				params.removeBlockedBy !== undefined;
			if (!hasMutable) {
				return errorResult(
					state,
					"update requires at least one mutable field: subject, description, activeForm, status, owner, metadata, addBlockedBy, or removeBlockedBy",
				);
			}
			if (params.status !== undefined && !isLegalTransition(task.status, params.status)) {
				return errorResult(state, `illegal transition ${task.status} → ${params.status}`);
			}
			// Merge blockedBy: remove first, then validate additions.
			let blockedBy = [...(task.blockedBy ?? [])];
			if (params.removeBlockedBy) {
				const remove = new Set(params.removeBlockedBy);
				blockedBy = blockedBy.filter((id) => !remove.has(id));
			}
			if (params.addBlockedBy) {
				for (const id of params.addBlockedBy) {
					if (id === task.id) {
						return errorResult(state, `cannot block #${id} on itself`);
					}
					const dependency = findLiveTask(state, id);
					if (!dependency) return errorResult(state, `addBlockedBy: #${id} not found`);
					if (blockedBy.includes(id)) continue;
					const proposed = new Map<number, number[]>([[task.id, [...blockedBy, id]]]);
					if (detectCycle(state.tasks, proposed)) {
						return errorResult(state, "addBlockedBy would create a cycle in the blockedBy graph");
					}
					blockedBy.push(id);
				}
			}
			const updated: Task = { ...task };
			if (params.subject !== undefined) updated.subject = params.subject;
			if (params.description !== undefined) {
				updated.description = params.description.trim() === "" ? undefined : params.description;
			}
			if (params.activeForm !== undefined) {
				updated.activeForm = params.activeForm.trim() === "" ? undefined : params.activeForm;
			}
			if (params.status !== undefined) updated.status = params.status;
			if (params.owner !== undefined) {
				updated.owner = params.owner.trim() === "" ? undefined : params.owner;
			}
			if (params.metadata !== undefined) {
				const metadata: Record<string, unknown> = { ...(task.metadata ?? {}) };
				for (const [key, value] of Object.entries(params.metadata)) {
					if (value === null) delete metadata[key];
					else metadata[key] = value;
				}
				updated.metadata = Object.keys(metadata).length > 0 ? metadata : undefined;
			}
			updated.blockedBy = blockedBy.length > 0 ? blockedBy : undefined;
			const changed = taskChanged(task, updated);
			const next: TaskState = {
				tasks: state.tasks.map((candidate) => (candidate.id === task.id ? updated : candidate)),
				nextId: state.nextId,
			};
			return { state: next, op: { kind: "update", changed, task: updated } };
		}
		case "list": {
			return { state: cloneState(state), op: { kind: "list", changed: false } };
		}
		case "get": {
			if (params.id === undefined) return errorResult(state, "id required for get");
			return { state: cloneState(state), op: { kind: "get", changed: false } };
		}
		case "delete": {
			if (params.id === undefined) return errorResult(state, "id required for delete");
			const task = state.tasks.find((candidate) => candidate.id === params.id);
			if (!task) return errorResult(state, `#${params.id} not found`);
			if (task.status === "deleted") {
				return errorResult(state, `#${params.id} is already deleted`);
			}
			const next: TaskState = {
				tasks: state.tasks.map((candidate) =>
					candidate.id === params.id ? { ...candidate, status: "deleted" as TaskStatus } : candidate,
				),
				nextId: state.nextId,
			};
			return { state: next, op: { kind: "delete", changed: true, task } };
		}
		case "clear": {
			return { state: { tasks: [], nextId: 1 }, op: { kind: "clear", changed: state.tasks.length > 0 } };
		}
	}
}

/** Which mutations append a session entry (reads and no-ops do not). */
export function changesState(op: { kind: string; changed: boolean }): boolean {
	if (op.kind === "create" || op.kind === "delete" || op.kind === "clear") return true;
	if (op.kind === "update") return op.changed;
	return false;
}

// ---------------------------------------------------------------------------
// Sanitization (terminal-control stripping for model-controlled text)
// ---------------------------------------------------------------------------

/**
 * Strip CSI/OSC sequences, stray escapes, bidi controls and non-printable
 * C0/C1 characters from text that will be echoed into the terminal.
 */
export function sanitizeTerminalText(text: string): string {
	let out = text;
	// CSI sequences: ESC [ params? intermediates? final-byte, plus the C1 CSI.
	out = out.replace(/\x1b\[[0-9;:?]*[ -/]*[@-~]/g, "");
	out = out.replace(/\x9b/g, "");
	// OSC sequences: ESC ] ... (BEL | ESC \) — an unterminated one swallows the rest.
	out = out.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)?/g, "");
	// Remaining 2-char ESC sequences.
	out = out.replace(/\x1b./g, "");
	// Line/paragraph separators become spaces.
	out = out.replace(/\u2028|\u2029/g, " ");
	// Bidi controls (LRM/RLM, directional embedding/overrides, isolates).
	out = out.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
	// Other C0/C1 controls → space (newline/carriage-return/tab survive).
	out = out.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x80-\x9f]/g, " ");
	return out;
}

// ---------------------------------------------------------------------------
// Overlay layout (the row-budget algorithm)
// ---------------------------------------------------------------------------

export interface OverlayLayout {
	visible: Task[];
	hiddenCompleted: number;
	truncatedTail: number;
}

export interface OverlayCounts {
	completed: number;
	total: number;
}

export function selectOverlayTasks(state: TaskState, hiddenCompleted: Set<number>): Task[] {
	return state.tasks.filter(
		(task) => task.status !== "deleted" && !(task.status === "completed" && hiddenCompleted.has(task.id)),
	);
}

export function selectTodoCounts(tasks: Task[]): OverlayCounts {
	return { completed: tasks.filter((task) => task.status === "completed").length, total: tasks.length };
}

export function selectHasActive(tasks: Task[]): boolean {
	return tasks.some((task) => task.status === "pending" || task.status === "in_progress");
}

/** Show #id prefixes only when at least one visible task carries blockedBy. */
export function selectShowTaskIds(tasks: Task[]): boolean {
	return tasks.some((task) => (task.blockedBy ?? []).length > 0);
}

/**
 * Fit tasks into the row budget. Completed tasks drop first; when unfinished
 * tasks alone overflow, the tail truncates; one row is reserved for the
 * "+N more" summary whenever anything is hidden.
 */
export function selectOverlayLayout(tasks: Task[], budget: number): OverlayLayout {
	if (tasks.length <= budget) {
		return { visible: tasks, hiddenCompleted: 0, truncatedTail: 0 };
	}
	const innerBudget = budget - 1; // reserve the summary row
	const nonCompleted = tasks.filter((task) => task.status !== "completed");
	const completed = tasks.filter((task) => task.status === "completed");
	if (nonCompleted.length <= innerBudget) {
		const remaining = innerBudget - nonCompleted.length;
		const visible = [...nonCompleted, ...completed.slice(0, Math.max(remaining, 0))];
		return {
			visible,
			hiddenCompleted: Math.max(completed.length - Math.max(remaining, 0), 0),
			truncatedTail: 0,
		};
	}
	return {
		visible: nonCompleted.slice(0, innerBudget),
		hiddenCompleted: completed.length,
		truncatedTail: nonCompleted.length - innerBudget,
	};
}

// ---------------------------------------------------------------------------
// Replay (branch-derived state restore)
// ---------------------------------------------------------------------------

/** Guard for foreign/corrupt entries: must look like a TaskDetails snapshot. */
export function isTaskDetails(value: unknown): value is TaskDetails {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return Array.isArray(record.tasks) && typeof record.nextId === "number";
}

/** Shape of session-branch entries as exposed by ctx.sessionManager. */
export interface BranchEntry {
	type: string;
	customType?: string;
	data?: unknown;
	message?: {
		role?: string;
		toolName?: string;
		details?: unknown;
	};
}

export interface BranchLike {
	getBranch(): BranchEntry[];
}

function snapshotFrom(details: TaskDetails): TaskState {
	return { tasks: details.tasks.map((task) => ({ ...task })), nextId: details.nextId };
}

/**
 * Rebuild the todo state from a session branch: custom entries win over
 * toolResult details (entries are appended for every state-changing call,
 * including calls routed through other tools); last valid snapshot wins.
 */
export function replayFromBranch(branch: BranchLike | undefined): TaskState {
	if (!branch || typeof branch.getBranch !== "function")
		return snapshotFrom({ action: "", params: {}, ...EMPTY_STATE });
	let fromEntries: TaskState | undefined;
	let fromToolResults: TaskState | undefined;
	try {
		for (const entry of branch.getBranch()) {
			if (entry?.type === "custom" && entry.customType === STATE_ENTRY_TYPE) {
				if (isTaskDetails(entry.data)) fromEntries = snapshotFrom(entry.data);
			} else if (entry?.type === "message") {
				const message = entry.message;
				if (message?.role === "toolResult" && message.toolName === "todo" && isTaskDetails(message.details)) {
					fromToolResults = snapshotFrom(message.details);
				}
			}
		}
	} catch {
		/* best-effort: corrupt branches replay as empty */
	}
	const resolved = fromEntries ?? fromToolResults;
	return resolved ?? { tasks: [], nextId: EMPTY_STATE.nextId };
}
