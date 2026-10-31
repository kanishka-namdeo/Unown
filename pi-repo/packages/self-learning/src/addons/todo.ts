/**
 * addons/todo.ts — the live todo-list addon.
 *
 * A faithful port of @juicesharp/rpiv-todo v2.13.9 (MIT) onto unown's
 * extension surface, replacing the minimal list/add/toggle todo that shipped
 * first (tools.ts): a full task graph (subject/description/activeForm,
 * pending → in_progress → completed + deleted tombstones, blockedBy
 * dependencies with cycle rejection) with a live panel above the editor,
 * a `/todos` command, session-branch persistence (state rides
 * "unown-todo-state" entries so /reload, /resume, compaction and tree
 * navigation all keep the right list) and turn-scoped completed-row fading.
 *
 * User configuration (~/.unown/agent/addons.json → todo):
 *   - maxWidgetLines: content-row budget (heading included), min 3, default 12
 *     — hot-reloaded on every render.
 *   - collapseKey: pi keybinding grammar, default ctrl+shift+t; "off" removes
 *     the shortcut. Registration-time (needs /reload to rebind).
 *   - guidance.{description,promptSnippet,promptGuidelines}: LLM-facing copy.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { type KeyId, Text, type TUI, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { AddonGuidance, TodoAddonConfig } from "./config.ts";
import { formatKeyForDisplay } from "./config.ts";
import {
	applyTaskMutation,
	type BranchLike,
	changesState,
	EMPTY_STATE,
	replayFromBranch,
	STATE_ENTRY_TYPE,
	sanitizeTerminalText,
	selectHasActive,
	selectOverlayLayout,
	selectOverlayTasks,
	selectShowTaskIds,
	selectTodoCounts,
	type Task,
	type TaskDetails,
	type TaskMutationParams,
	type TaskState,
	type TaskStatus,
} from "./todo-core.ts";

// ---------------------------------------------------------------------------
// LLM-facing copy (verbatim port; overridable via config.guidance)
// ---------------------------------------------------------------------------

export const TODO_TOOL_NAME = "todo";

export const DEFAULT_TODO_DESCRIPTION =
	"Manage a task list for tracking multi-step progress. Actions: create (new task), update (change status/fields/dependencies), list (all tasks, optionally filtered by status), get (single task details), delete (tombstone), clear (reset all). Status: pending → in_progress → completed, plus deleted tombstone. Use this to plan and track multi-step work like research, design, and implementation.";

export const DEFAULT_TODO_PROMPT_SNIPPET = "Manage a task list to track multi-step progress";

export const DEFAULT_TODO_GUIDELINES: string[] = [
	"Use `todo` for complex work with 3+ steps, when the user gives you a list of tasks, or immediately after receiving new instructions to capture requirements. Skip it for single trivial tasks and purely conversational requests.",
	"When starting a task from the todo list, mark it in_progress BEFORE beginning work. Mark it completed IMMEDIATELY when done — never batch completions. Exactly one task in_progress at a time.",
	"Never mark a task completed if tests are failing, the implementation is partial, or you hit unresolved errors — keep it in_progress and create a new task for the blocker instead.",
	"Task status is a 4-state machine: pending → in_progress → completed, plus deleted as a tombstone. Pass activeForm (present-continuous label, e.g. 'researching existing tool') when marking in_progress.",
	'To change a task\'s status, call update with the task id and the target status, e.g. {"action":"update","id":3,"status":"completed"} or {"action":"update","id":3,"status":"in_progress","activeForm":"writing tests"}. status is the field that changes the task; an update without a mutable field (status or another) is rejected.',
	"Use blockedBy to express dependencies (A is blocked by B). On create, pass blockedBy as the initial set. On update, use addBlockedBy / removeBlockedBy (additive merge — do not resend the full array). Cycles are rejected.",
	"list hides tombstoned (deleted) tasks by default; pass includeDeleted:true to see them. Pass status to filter by a single status.",
	"Subject must be short and imperative (e.g. 'Research existing tool'); description is for long-form detail. activeForm is a present-continuous label shown while in_progress.",
];

// ---------------------------------------------------------------------------
// Parameter schema
// ---------------------------------------------------------------------------

export const TodoParamsSchema = Type.Object({
	action: StringEnum(["create", "update", "list", "get", "delete", "clear"] as const),
	subject: Type.Optional(Type.String({ description: "Task subject line (required for create)" })),
	description: Type.Optional(Type.String({ description: "Long-form task description" })),
	activeForm: Type.Optional(
		Type.String({
			description: "Present-continuous spinner label shown while status is in_progress (e.g. 'writing tests')",
		}),
	),
	status: Type.Optional(
		StringEnum(["pending", "in_progress", "completed", "deleted"] as const, {
			description:
				"Set this task's status (update): one of pending, in_progress, completed, deleted. When action is list, filters returned tasks by this status.",
		}),
	),
	blockedBy: Type.Optional(Type.Array(Type.Number(), { description: "Initial blockedBy ids (create only)" })),
	addBlockedBy: Type.Optional(
		Type.Array(Type.Number(), { description: "Task ids to add to blockedBy (update only, additive merge)" }),
	),
	removeBlockedBy: Type.Optional(
		Type.Array(Type.Number(), { description: "Task ids to remove from blockedBy (update only, additive merge)" }),
	),
	owner: Type.Optional(Type.String({ description: "Agent/owner assigned to this task" })),
	metadata: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description: "Arbitrary metadata; pass null value for a key to delete that key on update",
		}),
	),
	id: Type.Optional(Type.Number({ description: "Task id (required for update, get, delete)" })),
	includeDeleted: Type.Optional(
		Type.Boolean({ description: "If true, list action returns deleted (tombstoned) tasks as well. Default: false." }),
	),
});

// ---------------------------------------------------------------------------
// Response envelope
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<TaskStatus, string> = {
	pending: "pending",
	in_progress: "in_progress",
	completed: "completed",
	deleted: "deleted",
};

function taskLine(task: Task, showChains: boolean): string {
	const chain = showChains && (task.blockedBy ?? []).length > 0 ? ` ⛓ ${task.blockedBy!.join(",")}` : "";
	const active = task.activeForm ? ` (${task.activeForm})` : "";
	return `[${STATUS_LABELS[task.status]}] #${task.id} ${sanitizeTerminalText(task.subject)}${active}${chain}`;
}

function errorText(message: string): string {
	return `Error: ${message}`;
}

export function formatTodoContent(
	_action: string,
	params: TaskMutationParams,
	state: TaskState,
	op: { kind: string; changed: boolean; task?: Task },
): string {
	switch (op.kind) {
		case "create": {
			const task = op.task!;
			return `Created #${task.id}: ${sanitizeTerminalText(task.subject)} (pending)`;
		}
		case "update": {
			const task = op.task;
			if (!task) return errorText("task missing");
			if (params.status !== undefined && op.changed) {
				return `Updated #${task.id} (previous → ${STATUS_LABELS[task.status]})`;
			}
			return op.changed
				? `Updated #${task.id}`
				: `No change: #${task.id} already matches the requested values (status: ${STATUS_LABELS[task.status]})`;
		}
		case "delete": {
			const task = op.task!;
			return `Deleted #${task.id}: ${sanitizeTerminalText(task.subject)}`;
		}
		case "clear": {
			return `Cleared ${state.tasks.length} tasks`;
		}
		case "list": {
			const filtered = state.tasks.filter((task) => {
				if (task.status === "deleted" && !params.includeDeleted) return false;
				if (params.status !== undefined && task.status !== params.status) return false;
				return true;
			});
			if (filtered.length === 0) return "No tasks";
			return filtered.map((task) => taskLine(task, true)).join("\n");
		}
		case "get": {
			const task = state.tasks.find((candidate) => candidate.id === params.id);
			if (!task) return errorText(`#${params.id} not found`);
			const lines = [`#${task.id} [${STATUS_LABELS[task.status]}] ${sanitizeTerminalText(task.subject)}`];
			if (task.description) lines.push(`  description: ${sanitizeTerminalText(task.description)}`);
			if (task.activeForm) lines.push(`  activeForm: ${task.activeForm}`);
			if ((task.blockedBy ?? []).length > 0)
				lines.push(`  blockedBy: ${task.blockedBy!.map((id) => `#${id}`).join(", ")}`);
			const blocks = state.tasks.filter((candidate) => (candidate.blockedBy ?? []).includes(task.id));
			if (blocks.length > 0) lines.push(`  blocks: ${blocks.map((candidate) => `#${candidate.id}`).join(", ")}`);
			if (task.owner) lines.push(`  owner: ${task.owner}`);
			return lines.join("\n");
		}
		case "error": {
			// Error message lives in details.error; content mirrors it.
			return "";
		}
	}
	return "";
}

// ---------------------------------------------------------------------------
// Per-session store
// ---------------------------------------------------------------------------

/**
 * Live state slots keyed by session id. The FOREGROUND pointer names the
 * session whose state the overlay and renderCall draw (per-session ids
 * restart at 1, so searching sibling slots could surface the wrong task).
 */
class TodoStore {
	private slots = new Map<string, TaskState>();
	private foregroundSession = "";

	get(sessionId: string): TaskState {
		return this.slots.get(sessionId) ?? { tasks: [], nextId: EMPTY_STATE.nextId };
	}

	commit(sessionId: string, state: TaskState): void {
		this.slots.set(sessionId, state);
	}

	replace(sessionId: string, state: TaskState): void {
		this.slots.set(sessionId, state);
	}

	evict(sessionId: string): void {
		this.slots.delete(sessionId);
	}

	/** First UI-bearing session claims the foreground; children cannot steal it. */
	claimForeground(sessionId: string): boolean {
		if (this.foregroundSession === "") {
			this.foregroundSession = sessionId;
			return true;
		}
		return this.foregroundSession === sessionId;
	}

	/** The foreground session id (plan seeding writes here). */
	foregroundId(): string {
		return this.foregroundSession;
	}

	isForeground(sessionId: string): boolean {
		return this.foregroundSession === sessionId;
	}

	clearForeground(sessionId: string): void {
		if (this.foregroundSession === sessionId || this.foregroundSession === "") {
			this.foregroundSession = "";
		}
	}

	renderState(): TaskState {
		return this.get(this.foregroundSession);
	}

	reset(): void {
		this.slots.clear();
		this.foregroundSession = "";
	}
}

function sessionIdOf(ctx: ExtensionContext): string {
	try {
		return ctx.sessionManager.getSessionId() ?? "";
	} catch {
		return "";
	}
}

// ---------------------------------------------------------------------------
// The overlay widget
// ---------------------------------------------------------------------------

const WIDGET_KEY = "unown-todos";

/** Glyphs + colors for the overlay rows. */
function overlayTaskLine(task: Task, theme: Theme, showIds: boolean): string {
	const glyph =
		task.status === "pending"
			? theme.fg("dim", "○")
			: task.status === "in_progress"
				? theme.fg("warning", "◐")
				: task.status === "completed"
					? theme.fg("success", "✓")
					: theme.fg("error", "✗");
	const id = showIds ? `${theme.fg("dim", `#${task.id} `)}` : "";
	const subject =
		task.status === "in_progress"
			? theme.fg("accent", sanitizeTerminalText(task.subject))
			: task.status === "completed" || task.status === "deleted"
				? theme.fg("muted", sanitizeTerminalText(task.subject))
				: sanitizeTerminalText(task.subject);
	const active = task.activeForm ? theme.fg("muted", ` (${sanitizeTerminalText(task.activeForm)})`) : "";
	const chain =
		(task.blockedBy ?? []).length > 0
			? theme.fg("muted", ` ⛓ ${task.blockedBy!.map((id) => `#${id}`).join(",")}`)
			: "";
	return `${glyph} ${id}${subject}${active}${chain}`;
}

class TodoOverlay {
	private uiCtx: ExtensionUIContext | undefined;
	private tui: TUI | undefined;
	private registered = false;
	private collapsed = false;
	private completedPendingHide = new Set<number>();
	private hiddenCompleted = new Set<number>();
	private lastNextId = 1;
	private readMaxWidgetLines: () => number;
	/** The todo unification round: while the session PLANS (plan mode on,
	 * not executing) the overlay stands down — the plan file + approval
	 * dialog are the one progress surface, and a stale/leftover list must
	 * never sit next to them (the reported two-lists bug's planning half).
	 * Data is untouched; the caller re-evaluates on un-suspend. */
	private suspended = false;

	constructor(readMaxWidgetLines: () => number) {
		this.readMaxWidgetLines = readMaxWidgetLines;
	}

	setUICtx(ui: ExtensionUIContext | undefined): void {
		if (ui === this.uiCtx) return;
		this.uiCtx = ui;
		this.registered = false;
		this.tui = undefined;
	}

	setSuspended(suspended: boolean): void {
		this.suspended = suspended;
	}

	isSuspended(): boolean {
		return this.suspended;
	}

	isRegistered(): boolean {
		return this.registered;
	}

	/** Rendered-completed tracking: ids displayed this turn queue for hiding. */
	private trackDisplayed(tasks: Task[]): void {
		for (const task of tasks) {
			if (
				task.status === "completed" &&
				!this.completedPendingHide.has(task.id) &&
				!this.hiddenCompleted.has(task.id)
			) {
				this.completedPendingHide.add(task.id);
			}
		}
		// Self-heal: ids that are no longer completed drop out of both sets.
		for (const id of [...this.completedPendingHide]) {
			const task = tasks.find((candidate) => candidate.id === id);
			if (!task || task.status !== "completed") this.completedPendingHide.delete(id);
		}
		for (const id of [...this.hiddenCompleted]) {
			const task = tasks.find((candidate) => candidate.id === id);
			if (!task || task.status !== "completed") this.hiddenCompleted.delete(id);
		}
	}

	hideCompletedTasksFromPreviousTurn(_store: TodoStore): void {
		for (const id of this.completedPendingHide) this.hiddenCompleted.add(id);
		this.completedPendingHide.clear();
		this.requestRender();
	}

	resetCompletedDisplayState(): void {
		this.completedPendingHide.clear();
		this.hiddenCompleted.clear();
		this.lastNextId = 1;
	}

	private requestRender(): void {
		try {
			this.tui?.requestRender();
		} catch {
			/* best-effort */
		}
	}

	update(store: TodoStore): void {
		if (!this.uiCtx) return;
		if (this.suspended) {
			if (this.registered) {
				this.uiCtx.setWidget(WIDGET_KEY, undefined, { placement: "aboveEditor" });
				this.registered = false;
				this.collapsed = false;
			}
			return;
		}
		const state = store.renderState();
		const overlayTasks = selectOverlayTasks(state, this.hiddenCompleted);
		if (overlayTasks.length === 0) {
			if (this.registered) {
				this.uiCtx.setWidget(WIDGET_KEY, undefined, { placement: "aboveEditor" });
				this.registered = false;
				this.collapsed = false;
			}
			return;
		}
		if (this.registered) {
			this.requestRender();
			return;
		}
		const factory = (tui: TUI, factoryTheme: Theme) => {
			this.tui = tui;
			return {
				render: (width: number): string[] => this.renderWidget(store, this.uiCtx?.theme ?? factoryTheme, width),
				invalidate: (): void => {
					/* strings are not cached; theme is re-read per render */
				},
			};
		};
		this.uiCtx.setWidget(WIDGET_KEY, factory, { placement: "aboveEditor" });
		this.registered = true;
	}

	toggleCollapse(): void {
		this.collapsed = !this.collapsed;
		try {
			this.tui?.requestRender(true);
		} catch {
			/* best-effort */
		}
	}

	dispose(): void {
		try {
			this.uiCtx?.setWidget(WIDGET_KEY, undefined, { placement: "aboveEditor" });
		} catch {
			/* best-effort */
		}
		this.uiCtx = undefined;
		this.tui = undefined;
		this.registered = false;
		this.collapsed = false;
	}

	private renderWidget(store: TodoStore, theme: Theme, width: number): string[] {
		const state = store.renderState();
		// A state reset (clear) rewinds nextId — drop stale tracking.
		if (state.nextId < this.lastNextId) this.resetCompletedDisplayState();
		this.lastNextId = state.nextId;
		const overlayTasks = selectOverlayTasks(state, this.hiddenCompleted);
		if (overlayTasks.length === 0) return [];

		const truncate = (line: string): string => truncateToWidth(line, width, "…");
		const counts = selectTodoCounts(overlayTasks);
		const hasActive = selectHasActive(overlayTasks);
		const showIds = selectShowTaskIds(overlayTasks);

		const headingColor = hasActive ? "accent" : "dim";
		const headingIcon = hasActive ? "●" : "○";
		const heading = truncate(
			`${theme.fg(headingColor, headingIcon)} ${theme.fg(headingColor, `Todos (${counts.completed}/${counts.total})`)}`,
		);

		if (this.collapsed) {
			const key = formatKeyForDisplay(this.readCollapseKey());
			const hint = key === "off" ? "collapsed" : `${key} to expand`;
			return [heading, truncate(`${theme.fg("dim", "└─")} ${theme.fg("dim", hint)}`), ""];
		}

		const bodyBudget = this.readMaxWidgetLines() - 1;
		const layout = selectOverlayLayout(overlayTasks, bodyBudget);
		const lines: string[] = [heading];
		for (const task of layout.visible) {
			lines.push(truncate(`${theme.fg("dim", "├─")} ${overlayTaskLine(task, theme, showIds)}`));
		}
		// Completed-display tracking must not run while collapsed (short-circuit
		// above), and only for rows actually displayed.
		this.trackDisplayed(overlayTasks);

		if (layout.hiddenCompleted === 0 && layout.truncatedTail === 0) {
			const last = lines.length - 1;
			lines[last] = lines[last]!.replace("├─", "└─");
			return [...lines, ""];
		}
		const totalHidden = layout.hiddenCompleted + layout.truncatedTail;
		const parts: string[] = [];
		if (layout.hiddenCompleted > 0) parts.push(`${layout.hiddenCompleted} completed`);
		if (layout.truncatedTail > 0) parts.push(`${layout.truncatedTail} pending`);
		const summary = parts.length > 0 ? `+${totalHidden} more (${parts.join(", ")})` : `+${totalHidden} more`;
		lines.push(truncate(`${theme.fg("dim", "└─")} ${theme.fg("dim", summary)}`));
		return [...lines, ""];
	}

	private readCollapseKey(): string {
		return this.collapseKeyReader();
	}

	private collapseKeyReader: () => string = () => "ctrl+shift+t";

	setCollapseKeyReader(reader: () => string): void {
		this.collapseKeyReader = reader;
	}
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Goal-gate bridge: tools.ts's agent_end goal-completion gate needs the
 * current todo trail (`Array<{done}>`). One process hosts one terminal
 * session, so a module-level reader set at registration time is sound.
 */
let readForegroundTodos: () => Array<{ done: boolean }> = () => [];

/**
 * The observability round's detailed bridge: the mission panel and the
 * brief need subjects + statuses ("what remains" is the open todo texts,
 * not a count). Same registration-time-reader pattern as above; the
 * foreground filter is identical (the live session's tasks, deletions
 * dropped).
 */
let readForegroundTodoDetails: () => Array<{ id: number; subject: string; status: string }> = () => [];

/**
 * Plan Mode V2 write-bridge (the 2026-10-31 planning round, gap P-06):
 * plan approval converts the approved steps into pending todos — the plan
 * checklist and the todo tracker are ONE list, not parallel universes. Same
 * registration-time pattern as the readers above.
 */
let seedForegroundTodosImpl: ((subjects: string[]) => number) | null = null;

/** Create pending todo tasks for the foreground session (plan → todo handoff).
 * Returns the number created; 0 when the todo addon is not registered. */
export function seedForegroundTodos(subjects: string[]): number {
	if (seedForegroundTodosImpl) return seedForegroundTodosImpl(subjects);
	return 0;
}

/** True when the todo addon registered its bridges — the seeded overlay is
 * the live checklist. When false (addon disabled via /addons), tools.ts keeps
 * its legacy widget fallback so execution progress never loses its surface. */
export function isTodoOverlayAvailable(): boolean {
	return seedForegroundTodosImpl !== null;
}

/** The todo unification round: suspend/restore the foreground overlay for
 * planning. Suspending hides the panel (data kept); restoring re-evaluates
 * and remounts whatever the store holds. No-op when the addon is off. */
let setForegroundTodoSuspendedImpl: ((suspended: boolean) => void) | null = null;

export function setForegroundTodoSuspended(suspended: boolean): void {
	if (setForegroundTodoSuspendedImpl) setForegroundTodoSuspendedImpl(suspended);
}

/** The [DONE:n] tag lane's write into the one visible list: flip matching
 * PENDING foreground todos to completed. Returns how many flipped (0 when
 * the addon is off or nothing matched). */
let completeForegroundTodosBySubjectsImpl: ((subjects: string[]) => number) | null = null;

export function completeForegroundTodosBySubjects(subjects: string[]): number {
	return completeForegroundTodosBySubjectsImpl ? completeForegroundTodosBySubjectsImpl(subjects) : 0;
}

/** tools.ts's todo→plan bridge: the model completing a seeded todo (by hand)
 * must complete the matching plan step so the footer chip, mission panel and
 * completion note agree — one list, two input paths. */
export type ForegroundTodoCompletedListener = (subject: string, ctx: unknown) => void;
let foregroundTodoCompletedListener: ForegroundTodoCompletedListener | null = null;

export function setForegroundTodoCompletedListener(listener: ForegroundTodoCompletedListener | null): void {
	foregroundTodoCompletedListener = listener;
}

/** The resume reconcile's reader side: tools.ts publishes the restored plan
 * state (planning/executing + steps). unown-tools registers BEFORE this
 * addon and restores plan state in its own session_start, so this addon's
 * session_start — running after — is the one point where BOTH sides are
 * loaded and the replayed seeded list can be synced against the plan. */
export interface PlanTodoSyncState {
	/** Plan mode enabled and NOT executing — the overlay suspends. */
	planning: boolean;
	/** Execution mode with steps — the seeded list is live. */
	executing: boolean;
	steps: Array<{ text: string; completed: boolean }>;
}

let readPlanTodoSyncState: (() => PlanTodoSyncState | null) | null = null;

export function setPlanTodoSyncReader(reader: (() => PlanTodoSyncState | null) | null): void {
	readPlanTodoSyncState = reader;
}

export function foregroundTodosForGoalGate(): Array<{ done: boolean }> {
	return readForegroundTodos();
}

/** Live foreground tasks with subjects (mission panel progress + brief remains). */
export function foregroundTodoDetails(): Array<{ id: number; subject: string; status: string }> {
	return readForegroundTodoDetails();
}

export interface TodoAddonRegistration {
	extension: (pi: ExtensionAPI) => void;
}

/**
 * Build the todo addon as an inline-extension factory body. The caller
 * (addons/index.ts) wraps this in createUnownAddonsExtension.
 */
export function registerTodoAddon(
	pi: ExtensionAPI,
	config: TodoAddonConfig,
	getMaxWidgetLines: () => number,
	verbose = false,
): void {
	const log = (message: string): void => {
		if (verbose) console.error(`[unown-addons/todo] ${message}`);
	};
	const guidance: Required<Pick<AddonGuidance, "description" | "promptSnippet" | "promptGuidelines">> = {
		description: config.guidance.description ?? DEFAULT_TODO_DESCRIPTION,
		promptSnippet: config.guidance.promptSnippet ?? DEFAULT_TODO_PROMPT_SNIPPET,
		promptGuidelines: config.guidance.promptGuidelines ?? DEFAULT_TODO_GUIDELINES,
	};
	const store = new TodoStore();
	const overlay = new TodoOverlay(getMaxWidgetLines);
	overlay.setCollapseKeyReader(() => config.collapseKey);
	readForegroundTodos = () =>
		store
			.renderState()
			.tasks.filter((task) => task.status !== "deleted")
			.map((task) => ({ done: task.status === "completed" }));
	readForegroundTodoDetails = () =>
		store
			.renderState()
			.tasks.filter((task) => task.status !== "deleted")
			.map((task) => ({ id: task.id, subject: task.subject, status: task.status }));
	seedForegroundTodosImpl = (subjects: string[]): number => {
		// Empty subjects would replay as a wipe — refuse instead.
		const list = subjects.map((s) => s.trim()).filter((s) => s.length > 0);
		if (list.length === 0) return 0;
		const sessionId = store.foregroundId();
		// Replace, never append (the todo unification round): approval means
		// "these steps ARE the list" — an earlier plan's tasks or hand-created
		// todos must not survive into the new execution episode (the stacked
		// two-plans-in-one-panel defect). `clear` also rewinds nextId, so the
		// seeded ids start at 1 again.
		let state = applyTaskMutation(store.get(sessionId), "clear", { action: "clear" }).state;
		let created = 0;
		for (const subject of list) {
			const result = applyTaskMutation(state, "create", { action: "create", subject });
			if (result.op.kind !== "error") {
				state = result.state;
				created++;
			} else {
				log(`plan seed rejected '${subject.slice(0, 40)}': ${result.state.error ?? "unknown"}`);
			}
		}
		// Commit the replaced list even when every create was rejected — the
		// wipe itself is the approved semantics.
		store.commit(sessionId, state);
		try {
			// The replay lane's shape: the LAST state entry with valid
			// TaskDetails wins, so ONE seeded snapshot restores on resume exactly
			// like a hand-driven todo run — no per-step create entries to stack.
			pi.appendEntry(STATE_ENTRY_TYPE, {
				action: "seed",
				params: { action: "seed", subjects: list },
				tasks: state.tasks,
				nextId: state.nextId,
			} satisfies TaskDetails);
		} catch {
			/* persistence is best-effort */
		}
		if (created > 0) log(`plan seeded ${created} todo task(s) — replaced the foreground list`);
		// Mount the panel NOW, at approval — not after the model's first todo
		// call (the "pops in late" defect). The caller lifts the planning
		// suspension before seeding, so this update registers the widget.
		overlay.update(store);
		return created;
	};

	setForegroundTodoSuspendedImpl = (suspended: boolean): void => {
		overlay.setSuspended(suspended);
		// Both directions re-evaluate NOW: update()'s guard unmounts on suspend
		// (a stale list must not linger through planning) and remounts whatever
		// the store holds on restore.
		overlay.update(store);
	};

	completeForegroundTodosBySubjectsImpl = (subjects: string[]): number => {
		// Count-aware: duplicate step texts (pathological, but the reducer
		// allows them) must flip exactly as many rows as there are completed
		// steps with that text — never more.
		const wanted = new Map<string, number>();
		for (const subject of subjects) wanted.set(subject, (wanted.get(subject) ?? 0) + 1);
		const sessionId = store.foregroundId();
		let state = store.get(sessionId);
		let flipped = 0;
		for (const task of state.tasks) {
			if (task.status !== "pending") continue;
			const remaining = wanted.get(task.subject) ?? 0;
			if (remaining <= 0) continue;
			const result = applyTaskMutation(state, "update", {
				action: "update",
				id: task.id,
				status: "completed",
			});
			if (result.op.kind !== "error") {
				state = result.state;
				flipped++;
				wanted.set(task.subject, remaining - 1);
			}
		}
		if (flipped > 0) {
			store.commit(sessionId, state);
			try {
				pi.appendEntry(STATE_ENTRY_TYPE, {
					action: "sync",
					params: { action: "sync", source: "done-tag" },
					tasks: state.tasks,
					nextId: state.nextId,
				} satisfies TaskDetails);
			} catch {
				/* persistence is best-effort */
			}
			overlay.update(store);
			log(`[DONE:n] sync flipped ${flipped} seeded todo(s) to completed`);
		}
		return flipped;
	};

	// ---- tool ---------------------------------------------------------------

	pi.registerTool({
		name: TODO_TOOL_NAME,
		label: "Todo",
		description: guidance.description,
		promptSnippet: guidance.promptSnippet,
		promptGuidelines: guidance.promptGuidelines,
		parameters: TodoParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const sessionId = sessionIdOf(ctx);
			const current = store.get(sessionId);
			const result = applyTaskMutation(current, params.action, params as TaskMutationParams);
			let text: string;
			let details: TaskDetails;
			if (result.op.kind === "error") {
				// State unchanged; the reducer's exact rejection reason rides both surfaces.
				const message = result.state.error ?? "task mutation rejected";
				text = errorText(message);
				details = {
					action: params.action,
					params: params as unknown as Record<string, unknown>,
					tasks: current.tasks,
					nextId: current.nextId,
					error: message,
				};
			} else {
				if (changesState(result.op)) store.commit(sessionId, result.state);
				else store.replace(sessionId, result.state);
				text = formatTodoContent(params.action, params as TaskMutationParams, result.state, result.op);
				details = {
					action: params.action,
					params: params as unknown as Record<string, unknown>,
					tasks: result.state.tasks,
					nextId: result.state.nextId,
				};
				// The todo unification round: a hand-driven completion of a seeded
				// plan step completes the plan side too — one list, two input paths,
				// always in agreement. The listener guards execution mode itself.
				if (
					params.action === "update" &&
					params.status === "completed" &&
					result.op.kind === "update" &&
					result.op.changed &&
					result.op.task
				) {
					try {
						foregroundTodoCompletedListener?.(result.op.task.subject, ctx);
					} catch {
						/* the sync bridge is best-effort — never break the tool */
					}
				}
			}
			if (changesState(result.op)) {
				try {
					pi.appendEntry(STATE_ENTRY_TYPE, details);
				} catch {
					/* persistence is best-effort */
				}
			}
			return { content: [{ type: "text", text }], details };
		},
		renderCall(args: TaskMutationParams, theme: Theme) {
			const glyphs: Record<string, string> = {
				create: "+",
				update: "→",
				delete: "×",
				get: "›",
				list: "☰",
				clear: "∅",
			};
			let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", glyphs[args.action] ?? "");
			if (args.action === "create" && args.subject) text += ` ${theme.fg("dim", `"${args.subject}"`)}`;
			if ((args.action === "update" || args.action === "get" || args.action === "delete") && args.id !== undefined) {
				const task = store.renderState().tasks.find((candidate) => candidate.id === args.id);
				text += ` ${theme.fg("accent", task ? sanitizeTerminalText(task.subject) : `#${args.id}`)}`;
			}
			if (args.action === "list" && args.status) text += ` ${theme.fg("muted", args.status)}`;
			return new Text(text, 0, 0);
		},
		renderResult(
			result: { details?: TaskDetails; content?: Array<{ type: string; text?: string }> },
			_options: unknown,
			theme: Theme,
		) {
			const details = result.details;
			if (!details) return new Text("", 0, 0);
			if (details.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			if (details.action === "create" || details.action === "update" || details.action === "delete") {
				const params = details.params as unknown as TaskMutationParams;
				const task = details.tasks.find(
					(candidate) => candidate.id === (params.id ?? details.tasks[details.tasks.length - 1]?.id),
				);
				const status = params.status ?? task?.status;
				if (status) {
					const glyphs: Record<TaskStatus, string> = {
						pending: "○",
						in_progress: "◐",
						completed: "●",
						deleted: "⊘",
					};
					const colors: Record<TaskStatus, "dim" | "warning" | "success" | "muted"> = {
						pending: "dim",
						in_progress: "warning",
						completed: "success",
						deleted: "muted",
					};
					return new Text(theme.fg(colors[status], `${glyphs[status]} ${STATUS_LABELS[status]}`), 0, 0);
				}
			}
			if (details.tasks.length === 0) return new Text(theme.fg("dim", "No tasks"), 0, 0);
			const display = details.tasks.slice(0, 5);
			let listText = theme.fg(
				"muted",
				`${details.tasks.filter((task) => task.status === "completed").length}/${details.tasks.length} done:`,
			);
			for (const task of display) {
				const check = task.status === "completed" ? theme.fg("success", "✓") : theme.fg("dim", "○");
				listText += `\n${check} ${theme.fg("accent", `#${task.id}`)} ${theme.fg("muted", sanitizeTerminalText(task.subject))}`;
			}
			if (details.tasks.length > 5) {
				listText += `\n${theme.fg("dim", `... ${details.tasks.length - 5} more`)}`;
			}
			return new Text(listText, 0, 0);
		},
	});

	// ---- /todos command ------------------------------------------------------

	pi.registerCommand("todos", {
		description: "Show all todos on the current branch, grouped by status",
		handler: async (_args: string | undefined, ctx: ExtensionContext) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/todos requires interactive mode", "error");
				return;
			}
			const state = store.get(sessionIdOf(ctx));
			const visible = state.tasks.filter((task) => task.status !== "deleted");
			if (visible.length === 0) {
				ctx.ui.notify("No todos yet. Ask the agent to track its work with the todo tool.", "info");
				return;
			}
			const completed = visible.filter((task) => task.status === "completed").length;
			const inProgress = visible.filter((task) => task.status === "in_progress").length;
			const pending = visible.filter((task) => task.status === "pending").length;
			const header = [
				`${completed}/${visible.length} completed`,
				inProgress > 0 ? `${inProgress} in progress` : "",
				pending > 0 ? `${pending} pending` : "",
			]
				.filter((part) => part !== "")
				.join(" · ");
			const sections: string[] = [`Todos (${header}):`];
			const groups: Array<[string, Task[]]> = [
				["── Pending ──", visible.filter((task) => task.status === "pending")],
				["── In Progress ──", visible.filter((task) => task.status === "in_progress")],
				["── Completed ──", visible.filter((task) => task.status === "completed")],
			];
			for (const [title, tasks] of groups) {
				if (tasks.length === 0) continue;
				sections.push(title);
				for (const task of tasks) {
					const glyph = task.status === "pending" ? "○" : task.status === "in_progress" ? "◐" : "✓";
					const line = `  ${glyph} #${task.id} ${sanitizeTerminalText(task.subject)}`;
					const withActive = task.activeForm ? `${line} (${sanitizeTerminalText(task.activeForm)})` : line;
					sections.push(withActive);
					if ((task.blockedBy ?? []).length > 0) {
						sections.push(`    ⛓ ${task.blockedBy!.map((id) => `#${id}`).join(",")}`);
					}
				}
			}
			ctx.ui.notify(sections.join("\n"), "info");
		},
	});

	// ---- collapse shortcut ----------------------------------------------------

	if (config.collapseKey !== "off") {
		try {
			pi.registerShortcut(config.collapseKey as KeyId, {
				description: "Collapse or expand the todo overlay",
				handler: (ctx: ExtensionContext) => {
					if (!ctx.hasUI || !overlay.isRegistered()) return;
					overlay.toggleCollapse();
				},
			});
		} catch (error) {
			log(`shortcut registration failed for "${config.collapseKey}": ${String(error)}`);
		}
	}

	// ---- lifecycle ------------------------------------------------------------

	/** The todo unification round's bidirectional resume reconcile. Plan
	 * steps may be completed ([DONE:n] tags) while the replayed todos are
	 * pending, and vice versa when the model flipped todos only — one visible
	 * list means they must agree before the first paint. Returns how many
	 * todo rows were flipped (the plan side rides the completed-listener). */
	const syncSeededTodosWithPlan = (plan: PlanTodoSyncState, ctx: ExtensionContext): number => {
		const sessionId = store.foregroundId();
		let state = store.get(sessionId);
		let flipped = 0;
		for (const step of plan.steps) {
			if (!step.completed) continue;
			const task = state.tasks.find(
				(candidate) =>
					candidate.subject === step.text && candidate.status !== "completed" && candidate.status !== "deleted",
			);
			if (!task) continue;
			const result = applyTaskMutation(state, "update", { action: "update", id: task.id, status: "completed" });
			if (result.op.kind !== "error") {
				state = result.state;
				flipped++;
			}
		}
		if (flipped > 0) {
			store.commit(sessionId, state);
			try {
				pi.appendEntry(STATE_ENTRY_TYPE, {
					action: "sync",
					params: { action: "sync", source: "plan-resume" },
					tasks: state.tasks,
					nextId: state.nextId,
				} satisfies TaskDetails);
			} catch {
				/* persistence is best-effort */
			}
			log(`resume sync flipped ${flipped} seeded todo(s) to completed`);
		}
		// The reverse direction rides the same completed-listener the live
		// lane uses — it marks the matching plan step, refreshes the footer
		// chip and persists the plan state.
		for (const task of state.tasks) {
			if (task.status !== "completed") continue;
			if (!plan.steps.some((step) => step.text === task.subject && !step.completed)) continue;
			try {
				foregroundTodoCompletedListener?.(task.subject, ctx);
			} catch {
				/* best-effort */
			}
		}
		return flipped;
	};

	const replayAndRefresh = (ctx: ExtensionContext, resetDisplay: boolean): void => {
		const sessionId = sessionIdOf(ctx);
		try {
			store.replace(sessionId, replayFromBranch(ctx.sessionManager as BranchLike));
		} catch (error) {
			log(`replay failed: ${String(error)}`);
		}
		if (ctx.hasUI && store.isForeground(sessionId)) {
			if (resetDisplay) overlay.resetCompletedDisplayState();
			overlay.update(store);
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		const sessionId = sessionIdOf(ctx);
		try {
			store.replace(sessionId, replayFromBranch(ctx.sessionManager as BranchLike));
		} catch (error) {
			log(`session_start replay failed: ${String(error)}`);
		}
		if (ctx.hasUI) {
			store.claimForeground(sessionId);
			overlay.setUICtx(ctx.ui);
			overlay.resetCompletedDisplayState();
			// The todo unification round's resume lane: unown-tools restored the
			// plan state first (it registers before the addons), so this is the
			// one point where BOTH sides are loaded — sync the replayed seeded
			// list with the restored plan steps, then apply the planning
			// suspension before the first paint.
			const plan = readPlanTodoSyncState?.() ?? null;
			if (plan?.executing && plan.steps.length > 0) syncSeededTodosWithPlan(plan, ctx);
			overlay.setSuspended(plan?.planning === true);
			overlay.update(store);
		}
	});

	pi.on("session_compact", async (_event, ctx) => replayAndRefresh(ctx, true));
	pi.on("session_tree", async (_event, ctx) => replayAndRefresh(ctx, true));

	pi.on("session_shutdown", async (_event, ctx) => {
		const sessionId = sessionIdOf(ctx);
		store.evict(sessionId);
		if (store.isForeground(sessionId) || sessionId === "") {
			store.clearForeground(sessionId);
			overlay.dispose();
		}
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		const typed = event as { toolName?: string; isError?: boolean };
		if (typed.toolName !== TODO_TOOL_NAME || typed.isError) return;
		if (ctx.hasUI && store.isForeground(sessionIdOf(ctx))) overlay.update(store);
	});

	pi.on("agent_start", async () => {
		// Turn boundary: completed rows from the previous turn drop now.
		overlay.hideCompletedTasksFromPreviousTurn(store);
	});
}
