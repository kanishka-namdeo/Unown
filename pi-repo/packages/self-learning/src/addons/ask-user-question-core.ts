/**
 * addons/ask-user-question-core.ts — pure questionnaire logic (no TUI imports).
 *
 * A faithful port of @juicesharp/rpiv-ask-user-question v2.13.9 (MIT) onto
 * unown's extension surface. This module holds everything that must be
 * unit-testable without a terminal: the parameter schema, the runtime
 * validation ladder, the questionnaire state machine (a pure reducer + a
 * declarative key-routing cascade), and the LLM-facing response envelope.
 * The interactive view and tool registration live in ask-user-question.ts.
 *
 * Behavior contract (pinned by test/addons/ask-user-question.test.ts):
 *   - Up to 4 questions, each 2-4 authored options; the "Type something."
 *     row is appended automatically and must never be authored by the model
 *     (reserved labels: "Other", "Type something.", "Next").
 *   - Navigation: ↑/↓ wrap, Tab/Shift+Tab/←/→ switch tabs (multi-question
 *     only), Enter confirms, Space toggles (multiSelect), 'n' opens the
 *     notes side-band, Esc cancels, the submit tab reviews every answer.
 *   - Confirming a question auto-advances to the next tab.
 *   - Drafts, notes and multi-selection persist per tab while navigating.
 *   - Partial submission is allowed; unanswered questions are reported in
 *     the envelope, never recorded as answers.
 */

import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";
export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_HEADER_LENGTH = 16;
export const MAX_LABEL_LENGTH = 60;

/** Labels the model must never author — appended/managed by the UI itself. */
export const RESERVED_LABELS = ["Other", "Type something.", "Next"] as const;
export const OTHER_ROW_LABEL = "Type something.";
export const NEXT_ROW_LABEL = "Next";
export const SUBMIT_ROW_LABEL = "Submit";

// ---------------------------------------------------------------------------
// Parameter schema (LLM-facing, verbatim port)
// ---------------------------------------------------------------------------

export const OptionSchema = Type.Object({
	label: Type.String({
		maxLength: MAX_LABEL_LENGTH,
		description:
			"MAX 60 CHARACTERS — hard limit, requests over the limit are rejected. The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice.",
	}),
	description: Type.String({
		description:
			"Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications.",
	}),
	preview: Type.Optional(
		Type.String({
			description:
				"Optional preview content rendered when this option is focused. Use for mockups, code snippets, or visual comparisons that help users compare options. See the tool description for the expected content format.",
		}),
	),
});

export const QuestionSchema = Type.Object({
	question: Type.String({
		description:
			'The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: "Which library should we use for date formatting?" If multiSelect is true, phrase it accordingly, e.g. "Which features do you want to enable?"',
	}),
	header: Type.String({
		maxLength: MAX_HEADER_LENGTH,
		description:
			'MAX 16 CHARACTERS — hard limit, requests over the limit are rejected. Very short chip/tag shown next to the question. Examples: "Auth method", "Library", "Approach".',
	}),
	options: Type.Array(OptionSchema, {
		minItems: MIN_OPTIONS,
		maxItems: MAX_OPTIONS,
		description:
			"The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). The 'Type something.' row is appended automatically — do NOT author it.",
	}),
	multiSelect: Type.Optional(
		Type.Boolean({
			default: false,
			description:
				"Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive.",
		}),
	),
});

export const QuestionsSchema = Type.Array(QuestionSchema, {
	minItems: 1,
	maxItems: MAX_QUESTIONS,
	description: "Questions to ask the user (1-4 questions)",
});

export const QuestionParamsSchema = Type.Object({ questions: QuestionsSchema });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuestionOption {
	label: string;
	description: string;
	preview?: string;
}

export interface QuestionSpec {
	question: string;
	header: string;
	options: QuestionOption[];
	multiSelect?: boolean;
}

export interface QuestionParams {
	questions: QuestionSpec[];
}

export type QuestionError =
	| "no_questions"
	| "too_many_questions"
	| "duplicate_question"
	| "empty_options"
	| "reserved_label"
	| "duplicate_option_label";

export interface ValidationResult {
	ok: boolean;
	error?: QuestionError;
	message: string;
}

export interface QuestionAnswer {
	questionIndex: number;
	question: string;
	kind: "option" | "custom" | "multi";
	/** Option label (option kind), first line of custom text, or joined labels (multi). */
	label: string;
	/** Free-typed text (custom kind, or appended to a multi selection). */
	text?: string;
	/** Selected option labels (multi kind). */
	selected?: string[];
	/** Indexes of the selected options (multi kind). */
	selectedIndexes?: number[];
	/** The preview markdown of the chosen option, when one was authored. */
	preview?: string;
	/** Per-question note merged in at confirm time. */
	notes?: string;
}

export interface QuestionnaireResult {
	answers: QuestionAnswer[];
	cancelled: boolean;
	globalNote?: string;
	unanswered?: number[];
	/** Validation failure code (present only on rejected calls). */
	error?: QuestionError;
}

// ---------------------------------------------------------------------------
// Normalization + validation
// ---------------------------------------------------------------------------

/**
 * Normalize user-facing strings: \r\n → \n, lone \r deleted. Reserved-label
 * and duplicate guards must compare the text users actually see, so a
 * "Other\r" label must not slip past the reserved-label check.
 */
export function normalizeQuestionParams(params: QuestionParams): QuestionParams {
	const normalizeString = (value: string): string => value.replace(/\r\n/g, "\n").replace(/\r/g, "");
	return {
		questions: params.questions.map((question) => ({
			question: normalizeString(question.question),
			header: normalizeString(question.header),
			multiSelect: question.multiSelect,
			options: question.options.map((option) => ({
				label: normalizeString(option.label),
				description: normalizeString(option.description),
				preview: option.preview === undefined ? undefined : normalizeString(option.preview),
			})),
		})),
	};
}

/**
 * Some models emit nested objects (questions / options) as JSON *strings*.
 * Only a string at an array/object position is decoded, and only when it
 * parses to the expected shape; everything else passes through untouched so
 * schema validation reports the real problem.
 */
export function prepareQuestionArguments(args: unknown): QuestionParams {
	if (typeof args !== "object" || args === null) return args as QuestionParams;
	const record = args as Record<string, unknown>;
	const decode = (value: unknown): unknown => {
		if (typeof value !== "string") return value;
		try {
			const parsed: unknown = JSON.parse(value);
			return typeof parsed === "object" && parsed !== null ? parsed : value;
		} catch {
			return value;
		}
	};
	const questions = decode(record.questions);
	if (!Array.isArray(questions)) return args as QuestionParams;
	const decoded = questions.map((entry) => {
		const question = decode(entry);
		if (typeof question !== "object" || question === null) return question;
		const questionRecord = question as Record<string, unknown>;
		const options = decode(questionRecord.options);
		if (!Array.isArray(options)) return question;
		return { ...questionRecord, options: options.map(decode) };
	});
	return { ...record, questions: decoded } as unknown as QuestionParams;
}

/** Runtime validation ladder (order pinned by tests). */
export function validateQuestionnaire(params: QuestionParams): ValidationResult {
	const { questions } = params;
	if (!Array.isArray(questions) || questions.length === 0) {
		return { ok: false, error: "no_questions", message: "Error: no questions provided" };
	}
	if (questions.length > MAX_QUESTIONS) {
		return {
			ok: false,
			error: "too_many_questions",
			message: `Error: too many questions (${questions.length}; max ${MAX_QUESTIONS})`,
		};
	}
	const seenQuestions = new Set<string>();
	for (const question of questions) {
		if (seenQuestions.has(question.question)) {
			return {
				ok: false,
				error: "duplicate_question",
				message: `Error: duplicate question "${question.question}"`,
			};
		}
		seenQuestions.add(question.question);
	}
	for (const question of questions) {
		if (!Array.isArray(question.options) || question.options.length < MIN_OPTIONS) {
			return {
				ok: false,
				error: "empty_options",
				message: `Error: question "${question.question}" needs at least ${MIN_OPTIONS} options`,
			};
		}
		const seenLabels = new Set<string>();
		for (const option of question.options) {
			// Reserved-label check short-circuits before duplicate-label so the
			// model gets the actionable message first.
			if (RESERVED_LABELS.includes(option.label as (typeof RESERVED_LABELS)[number])) {
				return {
					ok: false,
					error: "reserved_label",
					message: `Error: option label "${option.label}" is reserved (auto-appended by the UI); do not author it`,
				};
			}
			if (seenLabels.has(option.label)) {
				return {
					ok: false,
					error: "duplicate_option_label",
					message: `Error: duplicate option label "${option.label}" on question "${question.question}"`,
				};
			}
			seenLabels.add(option.label);
		}
	}
	return { ok: true, message: "" };
}

// ---------------------------------------------------------------------------
// Questionnaire state machine
// ---------------------------------------------------------------------------

export interface QuestionnaireState {
	/** 0..questions.length-1; questions.length is the submit tab (multi only). */
	currentTab: number;
	/** Focused row: 0..options.length-1 are options; options.length is the "Type something." row; options.length+1 is Next (multi). */
	optionIndex: number;
	/** Typing into the "Type something." row. */
	inputMode: boolean;
	notesVisible: boolean;
	answers: Map<number, QuestionAnswer>;
	multiSelectChecked: Set<number>;
	customDraftsByTab: Map<number, string>;
	notesByTab: Map<number, string>;
	/** 0 = Submit, 1 = Cancel (submit tab only). */
	submitChoiceIndex: number;
	collapsed: boolean;
}

export function initialQuestionnaireState(params: QuestionParams): QuestionnaireState {
	const state: QuestionnaireState = {
		currentTab: 0,
		optionIndex: 0,
		inputMode: false,
		notesVisible: false,
		answers: new Map(),
		multiSelectChecked: new Set(),
		customDraftsByTab: new Map(),
		notesByTab: new Map(),
		submitChoiceIndex: 0,
		collapsed: false,
	};
	// Re-seed multi-selection checkboxes from any saved answer (session
	// restore of in-flight drafts is not persisted, but the reducer is pure
	// so tests can construct mid-flight states).
	syncCheckedFromAnswer(state, params);
	return state;
}

function syncCheckedFromAnswer(state: QuestionnaireState, params: QuestionParams): void {
	const question = params.questions[state.currentTab];
	if (!question?.multiSelect) return;
	state.multiSelectChecked.clear();
	const answer = state.answers.get(state.currentTab);
	if (answer?.kind === "multi") {
		for (let index = 0; index < question.options.length; index++) {
			if (answer.selectedIndexes?.includes(index)) state.multiSelectChecked.add(index);
		}
	}
}

export type QuestionnaireAction =
	| { kind: "nav"; direction: 1 | -1 }
	| { kind: "tab_switch"; delta: 1 | -1 }
	| { kind: "toggle" }
	| { kind: "confirm" }
	| { kind: "multi_confirm" }
	| { kind: "cancel" }
	| { kind: "notes_enter" }
	| { kind: "notes_exit"; commit: boolean }
	| { kind: "notes_forward"; data: string }
	| { kind: "input_replace"; text: string }
	| { kind: "input_clear" }
	| { kind: "submit_nav"; direction: 1 | -1 }
	| { kind: "submit" }
	| { kind: "toggle_collapsed" }
	| { kind: "ignore" };

/** Tab the confirm on a question should auto-advance to. */
export function computeAutoAdvanceTab(state: QuestionnaireState, params: QuestionParams): number {
	const tabCount = params.questions.length;
	if (tabCount <= 1) return 0;
	return Math.min(state.currentTab + 1, tabCount);
}

/**
 * The pure reducer. Returns the next state (input maps are copied — never
 * mutated in place — so React-style equality checks stay sound in tests).
 */
export function reduceQuestionnaire(
	state: QuestionnaireState,
	action: QuestionnaireAction,
	params: QuestionParams,
): QuestionnaireState {
	const next: QuestionnaireState = {
		...state,
		answers: new Map(state.answers),
		multiSelectChecked: new Set(state.multiSelectChecked),
		customDraftsByTab: new Map(state.customDraftsByTab),
		notesByTab: new Map(state.notesByTab),
	};
	const question = params.questions[next.currentTab];
	const totalTabs = params.questions.length + 1; // + submit tab
	const rowCount = (question?.options.length ?? 0) + 1; // + "Type something."

	switch (action.kind) {
		case "toggle_collapsed": {
			next.collapsed = !state.collapsed;
			return next;
		}
		case "nav": {
			next.optionIndex = (state.optionIndex + action.direction + rowCount) % rowCount;
			// Landing on the "Type something." row enters input mode (with the
			// tab's draft preloaded by the view layer).
			next.inputMode = next.optionIndex === rowCount - 1;
			return next;
		}
		case "tab_switch": {
			const total = params.questions.length > 1 ? totalTabs : 1;
			next.currentTab = (state.currentTab + action.delta + total) % total;
			// Entering the submit tab keeps choices; entering a question tab
			// resets transient row state.
			if (next.currentTab < params.questions.length) {
				next.optionIndex = 0;
				next.inputMode = false;
				next.notesVisible = false;
				next.submitChoiceIndex = 0;
				syncCheckedFromAnswer(next, params);
			}
			return next;
		}
		case "toggle": {
			if (!question?.multiSelect) return state;
			// Space on the "Type something." row is suppressed; toggling an
			// option updates the incremental answer so the submit review
			// stays live.
			if (next.optionIndex >= question.options.length) return state;
			if (next.multiSelectChecked.has(next.optionIndex)) {
				next.multiSelectChecked.delete(next.optionIndex);
			} else {
				next.multiSelectChecked.add(next.optionIndex);
			}
			writeMultiAnswer(next, params, question);
			return next;
		}
		case "confirm": {
			if (!question) return state;
			if (next.optionIndex < question.options.length) {
				const option = question.options[next.optionIndex];
				const notes = trimmedNotesFor(state, params, next.currentTab);
				next.answers.set(next.currentTab, {
					questionIndex: next.currentTab,
					question: question.question,
					kind: "option",
					label: option.label,
					preview: option.preview,
					...(notes ? { notes } : {}),
				});
				return advanceAfterConfirm(next, params);
			}
			// Enter on the "Type something." row with a blank draft is a no-op.
			return state;
		}
		case "multi_confirm": {
			if (!question?.multiSelect) return state;
			const hasSelection = next.multiSelectChecked.size > 0;
			const draft = state.customDraftsByTab.get(next.currentTab)?.trim() ?? "";
			if (!hasSelection && !draft) {
				// Empty selection + no custom: drop any stale answer.
				next.answers.delete(next.currentTab);
				return state;
			}
			writeMultiAnswer(next, params, question);
			return advanceAfterConfirm(next, params);
		}
		case "cancel": {
			return state; // the view resolves done() with the cancelled result
		}
		case "notes_enter": {
			next.notesVisible = true;
			return next;
		}
		case "notes_exit": {
			next.notesVisible = false;
			return next;
		}
		case "notes_forward":
		case "input_replace":
		case "input_clear":
		case "ignore": {
			return state; // handled by the view's headless editors
		}
		case "submit_nav": {
			next.submitChoiceIndex = state.submitChoiceIndex === 0 ? 1 : 0;
			return next;
		}
		case "submit": {
			return state; // the view resolves done()
		}
	}
	return state;
}

function trimmedNotesFor(state: QuestionnaireState, _params: QuestionParams, tab: number): string | undefined {
	const note = state.notesByTab.get(tab)?.trim();
	return note && note !== "" ? note : undefined;
}

function advanceAfterConfirm(next: QuestionnaireState, params: QuestionParams): QuestionnaireState {
	const auto = computeAutoAdvanceTab(next, params);
	if (auto !== next.currentTab && params.questions.length > 1) {
		next.currentTab = auto;
		next.optionIndex = 0;
		next.inputMode = false;
		next.notesVisible = false;
		next.submitChoiceIndex = 0;
		syncCheckedFromAnswer(next, params);
	}
	return next;
}

/**
 * Persist a multi answer incrementally: checked options plus any custom
 * draft merge into one answer; an empty selection + empty draft deletes it.
 */
export function writeMultiAnswer(state: QuestionnaireState, params: QuestionParams, question: QuestionSpec): void {
	const checked = [...state.multiSelectChecked].sort((a, b) => a - b);
	const draft = state.customDraftsByTab.get(state.currentTab)?.trim() ?? "";
	const notes = trimmedNotesFor(state, params, state.currentTab);
	if (checked.length === 0 && !draft) {
		state.answers.delete(state.currentTab);
		return;
	}
	const labels = checked.map((index) => question.options[index].label);
	const answer: QuestionAnswer = {
		questionIndex: state.currentTab,
		question: question.question,
		kind: "multi",
		label: draft ? `${labels.join(", ")}${labels.length ? " + custom" : "custom"}` : labels.join(", "),
		selected: labels,
		selectedIndexes: checked,
		...(draft ? { text: draft } : {}),
		...(notes ? { notes } : {}),
	};
	state.answers.set(state.currentTab, answer);
}

// ---------------------------------------------------------------------------
// Key routing (the cascade, in pinned order)
// ---------------------------------------------------------------------------

export interface KeyRouterRuntime {
	collapseKey: string;
}

/** Detect raw Tab / Shift+Tab / ← / → presses. */
export function tabSwitchAction(
	data: string,
	_state: QuestionnaireState,
	params: QuestionParams,
): QuestionnaireAction | undefined {
	if (params.questions.length <= 1) return undefined;
	if (data === "\t") return { kind: "tab_switch", delta: 1 };
	if (data === "\x1b[Z") return { kind: "tab_switch", delta: -1 };
	if (data === "\x1b[D" || data === "\x1bOC") return { kind: "tab_switch", delta: -1 };
	if (data === "\x1b[C" || data === "\x1bOC") return { kind: "tab_switch", delta: 1 };
	return undefined;
}

/**
 * Route a raw terminal keypress to an action. Pure — the caller supplies the
 * key matcher so tests can run without pi-tui.
 */
export function routeQuestionnaireKey(
	data: string,
	state: QuestionnaireState,
	params: QuestionParams,
	runtime: KeyRouterRuntime,
	matches: (data: string, keyId: string) => boolean,
): QuestionnaireAction {
	const onSubmitTab = params.questions.length > 1 && state.currentTab === params.questions.length;
	const question = params.questions[onSubmitTab ? state.currentTab - 1 : state.currentTab];

	// 1. Collapse toggle — top intercept, works from every inner state.
	if (runtime.collapseKey !== "off" && matches(data, runtime.collapseKey)) {
		return { kind: "toggle_collapsed" };
	}
	// 2. Collapsed lockout: only cancel passes through.
	if (state.collapsed) {
		if (matches(data, "escape") || matches(data, "esc")) return { kind: "cancel" };
		return { kind: "ignore" };
	}
	// 3. Notes editor open: Esc/Enter close it; everything else forwards.
	if (state.notesVisible) {
		if (matches(data, "escape") || matches(data, "esc")) return { kind: "notes_exit", commit: false };
		if (matches(data, "enter") || matches(data, "return")) return { kind: "notes_exit", commit: true };
		return { kind: "notes_forward", data };
	}
	// 4. inputMode: Enter confirms the custom answer; Esc cancels back to
	//    the options; a blank draft makes Enter a no-op.
	if (state.inputMode) {
		if (matches(data, "enter") || matches(data, "return")) {
			const draft = state.customDraftsByTab.get(state.currentTab)?.trim() ?? "";
			if (draft === "") return { kind: "ignore" };
			return { kind: "confirm" };
		}
		if (matches(data, "escape") || matches(data, "esc")) return { kind: "cancel" };
		return { kind: "ignore" };
	}
	// 5. Submit tab.
	if (onSubmitTab) {
		if (matches(data, "escape") || matches(data, "esc")) return { kind: "cancel" };
		const tab = tabSwitchAction(data, state, params);
		if (tab) return tab;
		if (matches(data, "up")) return { kind: "submit_nav", direction: -1 };
		if (matches(data, "down")) return { kind: "submit_nav", direction: 1 };
		if (matches(data, "enter") || matches(data, "return")) {
			return state.submitChoiceIndex === 0 ? { kind: "submit" } : { kind: "cancel" };
		}
		if (data === "n") return { kind: "notes_enter" };
		return { kind: "ignore" };
	}
	// 6. Tab switch keys (multi-question only).
	const tab = tabSwitchAction(data, state, params);
	if (tab) return tab;
	// 7. Universal 'n' → notes.
	if (data === "n") return { kind: "notes_enter" };
	// 8. ↑/↓ wrap-around navigation.
	if (matches(data, "up")) return { kind: "nav", direction: -1 };
	if (matches(data, "down")) return { kind: "nav", direction: 1 };
	// 9. Tab body: multi toggles via Space / Enter-on-option and confirms on
	//    Next; single confirms via Enter on an option row.
	if (question?.multiSelect) {
		const rowCount = question.options.length + 2; // options + "Type something." + Next
		if (data === " ") {
			// Space suppressed on the Next row and the "Type something." row.
			if (state.optionIndex === question.options.length || state.optionIndex === question.options.length + 1) {
				return { kind: "ignore" };
			}
			return { kind: "toggle" };
		}
		if (matches(data, "enter") || matches(data, "return")) {
			if (state.optionIndex === rowCount - 1) return { kind: "multi_confirm" };
			if (state.optionIndex === question.options.length) return { kind: "ignore" };
			return { kind: "toggle" };
		}
		return { kind: "ignore" };
	}
	if (matches(data, "enter") || matches(data, "return")) {
		// Enter on the "Type something." row enters inputMode (handled by the
		// view); on an option it confirms.
		if (state.optionIndex === question.options.length) return { kind: "ignore" };
		return { kind: "confirm" };
	}
	return { kind: "ignore" };
}

// ---------------------------------------------------------------------------
// Result assembly + response envelope
// ---------------------------------------------------------------------------

export const DECLINE_MESSAGE = "User declined to answer questions";
export const ENVELOPE_PREFIX = "User has answered your questions:";
export const ENVELOPE_SUFFIX = "You can now continue with the user's answers in mind.";

/**
 * Assemble the final result from reducer state: answers ordered by question
 * index; the global note (kept at the pseudo-index slot no question can
 * occupy) lifts onto the result on submit AND cancel, so a note survives an
 * abandoned questionnaire.
 */
export function assembleQuestionnaireResult(
	state: QuestionnaireState,
	params: QuestionParams,
	cancelled: boolean,
): QuestionnaireResult {
	const answers: QuestionAnswer[] = [];
	for (let index = 0; index < params.questions.length; index++) {
		const answer = state.answers.get(index);
		if (answer) answers.push(answer);
	}
	const globalNote = state.notesByTab.get(params.questions.length)?.trim();
	const result: QuestionnaireResult = {
		answers,
		cancelled,
		...(globalNote ? { globalNote } : {}),
	};
	if (!cancelled) {
		const unanswered: number[] = [];
		for (let index = 0; index < params.questions.length; index++) {
			if (!state.answers.has(index)) unanswered.push(index);
		}
		if (unanswered.length > 0) result.unanswered = unanswered;
	}
	return result;
}

/** The custom-answer view calls this when a draft commits. */
export function commitCustomAnswer(
	state: QuestionnaireState,
	params: QuestionParams,
	text: string,
): QuestionnaireState {
	const next: QuestionnaireState = {
		...state,
		answers: new Map(state.answers),
		multiSelectChecked: new Set(state.multiSelectChecked),
		customDraftsByTab: new Map(state.customDraftsByTab),
		notesByTab: new Map(state.notesByTab),
	};
	const question = params.questions[next.currentTab];
	if (!question) return next;
	const trimmed = text.trim();
	next.customDraftsByTab.set(next.currentTab, trimmed);
	if (trimmed === "") return next;
	if (question.multiSelect) {
		// A custom answer on a multi question merges with the checked set.
		writeMultiAnswer(next, params, question);
		return advanceAfterConfirm(next, params);
	}
	const notes = trimmedNotesFor(state, params, next.currentTab);
	next.answers.set(next.currentTab, {
		questionIndex: next.currentTab,
		question: question.question,
		kind: "custom",
		label: trimmed.split("\n")[0] ?? trimmed,
		text: trimmed,
		...(notes ? { notes } : {}),
	});
	return advanceAfterConfirm(next, params);
}

function formatAnswerScalar(answer: QuestionAnswer): string {
	if (answer.kind === "multi") {
		const parts = answer.selected ?? [];
		if (answer.text) parts.push(answer.text);
		return parts.join(", ") || "(no input)";
	}
	if (answer.kind === "custom") return answer.text && answer.text !== "" ? answer.text : "(no input)";
	return answer.label;
}

function buildAnswerSegment(answer: QuestionAnswer): string {
	const parts: string[] = [`"${answer.question}"="${formatAnswerScalar(answer)}"`];
	if (answer.preview && answer.preview.length > 0) parts.push(`selected preview: ${answer.preview}`);
	if (answer.notes && answer.notes.length > 0) parts.push(`user notes: ${answer.notes}`);
	return `${parts.join(". ")}.`;
}

function buildUnansweredSegment(unanswered: number[], params: QuestionParams): string {
	const quoted = unanswered.map((index) => `"${params.questions[index]?.question ?? `q${index + 1}`}"`);
	return `unanswered: ${quoted.join(", ")}.`;
}

/**
 * Build the LLM-facing tool result text. A cancelled questionnaire is a
 * decline (with any answers and the global note still reported in details);
 * a submitted one enumerates each answer, the unanswered set and the note.
 */
export function buildQuestionnaireResponse(
	result: QuestionnaireResult | undefined,
	params: QuestionParams,
): { text: string; details: QuestionnaireResult } {
	if (!result || result.cancelled) {
		const details: QuestionnaireResult = {
			answers: result?.answers ?? [],
			cancelled: true,
			...(result?.globalNote && result.globalNote.length > 0 ? { globalNote: result.globalNote } : {}),
		};
		return { text: DECLINE_MESSAGE, details };
	}
	const segments: string[] = [];
	const unanswered: number[] = [];
	for (let index = 0; index < params.questions.length; index++) {
		const answer = result.answers.find((entry) => entry.questionIndex === index);
		if (answer) segments.push(buildAnswerSegment(answer));
		else unanswered.push(index);
	}
	const hasGlobalNote = result.globalNote !== undefined && result.globalNote.length > 0;
	if (segments.length === 0 && !hasGlobalNote) {
		const details: QuestionnaireResult = { answers: result.answers, cancelled: true };
		return { text: DECLINE_MESSAGE, details };
	}
	if (unanswered.length > 0) segments.push(buildUnansweredSegment(unanswered, params));
	if (hasGlobalNote) segments.push(`global note: ${result.globalNote}.`);
	const details: QuestionnaireResult = unanswered.length > 0 ? { ...result, unanswered } : result;
	return { text: `${ENVELOPE_PREFIX} ${segments.join(" ")} ${ENVELOPE_SUFFIX}`, details };
}

/** Terminal bell: only when stdout is a TTY (keeps piped RPC clean). */
export function emitTerminalAttention(): void {
	if (!process.stdout.isTTY) return;
	try {
		process.stdout.write("\x07");
	} catch {
		/* best-effort */
	}
}
