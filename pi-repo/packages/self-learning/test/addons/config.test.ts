// Unit tests for the addon configuration module (src/addons/config.ts)
// and the ask-user-question core state machine
// (src/addons/ask-user-question-core.ts).
//
// Everything here is pure logic — no terminal, no TUI — per the testing
// strategy: reducers, validators and envelope builders must be verifiable
// headlessly. The interactive dialog is exercised by the TUI-capture
// scenarios (scripts/tui-capture/) instead.
import { describe, expect, test } from "bun:test";
import { matchesKey } from "@earendil-works/pi-tui";
import {
	assembleQuestionnaireResult,
	buildQuestionnaireResponse,
	commitCustomAnswer,
	initialQuestionnaireState,
	normalizeQuestionParams,
	prepareQuestionArguments,
	type QuestionnaireState,
	type QuestionParams,
	reduceQuestionnaire,
	routeQuestionnaireKey,
	validateQuestionnaire,
} from "../../src/addons/ask-user-question-core.ts";
import {
	addonsConfigPath,
	DEFAULT_ADDONS_CONFIG,
	formatKeyForDisplay,
	isValidKeySpec,
	parseAddonsConfig,
	resolveCollapseKey,
} from "../../src/addons/config.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe("addons config", () => {
	test("defaults are fully populated", () => {
		expect(DEFAULT_ADDONS_CONFIG.askUserQuestion.enabled).toBe(true);
		expect(DEFAULT_ADDONS_CONFIG.todo.enabled).toBe(true);
		expect(DEFAULT_ADDONS_CONFIG.todo.maxWidgetLines).toBe(12);
		// Faithful to oh-my-pi: the advisor ships off by default.
		expect(DEFAULT_ADDONS_CONFIG.advisor.enabled).toBe(false);
		expect(DEFAULT_ADDONS_CONFIG.advisor.maxNotesPerUpdate).toBe(4);
		expect(DEFAULT_ADDONS_CONFIG.advisor.reviewMode).toBe("turn");
	});

	test("non-object input yields defaults", () => {
		for (const raw of [null, undefined, "x", 42, [], [{}]]) {
			expect(parseAddonsConfig(raw)).toEqual(DEFAULT_ADDONS_CONFIG);
		}
	});

	test("valid overrides survive, unknown keys drop", () => {
		const config = parseAddonsConfig({
			askUserQuestion: { enabled: false, collapseKey: "alt+o" },
			todo: { maxWidgetLines: 2, collapseKey: "off" },
			advisor: { model: "qwen3.7-plus", maxNotesPerUpdate: 99, reviewMode: "agent-end" },
			bogus: { nope: true },
		});
		expect(config.askUserQuestion.enabled).toBe(false);
		expect(config.askUserQuestion.collapseKey).toBe("alt+o");
		// maxWidgetLines clamps at the documented floor of 3.
		expect(config.todo.maxWidgetLines).toBe(3);
		expect(config.todo.collapseKey).toBe("off");
		expect(config.advisor.model).toBe("qwen3.7-plus");
		// maxNotesPerUpdate clamps at 32.
		expect(config.advisor.maxNotesPerUpdate).toBe(32);
		expect(config.advisor.reviewMode).toBe("agent-end");
	});

	test("malformed values degrade to defaults", () => {
		const config = parseAddonsConfig({
			askUserQuestion: { collapseKey: "ctr+]", guidance: { promptGuidelines: ["ok", "", 5] } },
			todo: { maxWidgetLines: "banana" },
			advisor: { thinkingLevel: "ultra", continueSeverity: "fatal" },
		});
		// The typo'd key spec falls back to the default — a stray `]` must
		// never be captured as a bare keypress.
		expect(config.askUserQuestion.collapseKey).toBe("ctrl+]");
		expect(config.askUserQuestion.guidance.promptGuidelines).toEqual(["ok"]);
		expect(config.todo.maxWidgetLines).toBe(12);
		expect(config.advisor.thinkingLevel).toBe("medium");
		expect(config.advisor.continueSeverity).toBe("concern");
	});

	test("key spec grammar accepts valid specs, rejects look-alikes", () => {
		expect(isValidKeySpec("ctrl+]")).toBe(true);
		expect(isValidKeySpec("ctrl+shift+t")).toBe(true);
		expect(isValidKeySpec("alt+t")).toBe(true);
		expect(isValidKeySpec("pageup")).toBe(true);
		expect(isValidKeySpec("f12")).toBe(true);
		expect(isValidKeySpec("ctr+]")).toBe(false);
		expect(isValidKeySpec("ctrl+ctrl+t")).toBe(false);
		expect(isValidKeySpec("ctrl+")).toBe(false);
		expect(isValidKeySpec("")).toBe(false);
		expect(isValidKeySpec("notakey")).toBe(false);
	});

	test("resolveCollapseKey handles off and blank", () => {
		expect(resolveCollapseKey(" off ", "ctrl+]")).toBe("off");
		expect(resolveCollapseKey(undefined, "ctrl+]")).toBe("ctrl+]");
		expect(resolveCollapseKey("", "ctrl+]")).toBe("ctrl+]");
		expect(resolveCollapseKey(7, "ctrl+]")).toBe("ctrl+]");
	});

	test("formatKeyForDisplay pretty-prints", () => {
		expect(formatKeyForDisplay("ctrl+]")).toBe("Ctrl+]");
		expect(formatKeyForDisplay("ctrl+shift+t")).toBe("Ctrl+Shift+T");
		expect(formatKeyForDisplay("pageup")).toBe("PageUp");
		expect(formatKeyForDisplay("escape")).toBe("Esc");
		expect(formatKeyForDisplay("off")).toBe("off");
	});

	test("addonsConfigPath lives under the unown agent dir", () => {
		const path = addonsConfigPath();
		expect(path.includes("addons.json")).toBe(true);
		expect(path.replace(/\\/g, "/").endsWith("/agent/addons.json")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Questionnaire fixtures
// ---------------------------------------------------------------------------

const twoQuestions: QuestionParams = {
	questions: [
		{
			question: "Which library?",
			header: "Library",
			options: [
				{ label: "Date-fns", description: "Functional date utilities" },
				{ label: "Day.js", description: "Moment-compatible API" },
			],
		},
		{
			question: "Which features?",
			header: "Features",
			multiSelect: true,
			options: [
				{ label: "Parsing", description: "parse input" },
				{ label: "Formatting", description: "format output" },
				{ label: "Timezones", description: "tz support" },
			],
		},
	],
};

const singleQuestion: QuestionParams = {
	questions: [
		{
			question: "Deploy now?",
			header: "Deploy",
			options: [
				{ label: "Yes", description: "ship it" },
				{ label: "No", description: "hold" },
			],
		},
	],
};

/** A matcher that understands the raw-escape subset the router needs —
 * tab/shift+tab/left/right included so the tab-switch lane is exercised in
 * every encoding family the real pi-tui matcher normalizes (CSI, SS3/DECCKM). */
function fakeMatcher(data: string, keyId: string): boolean {
	const raw: Record<string, string> = {
		escape: "\x1b",
		esc: "\x1b",
		enter: "\r",
		return: "\r",
		up: "\x1b[A",
		down: "\x1b[B",
		tab: "\t",
		"shift+tab": "\x1b[Z",
		left: "\x1b[D",
		right: "\x1b[C",
	};
	return raw[keyId] === data;
}

/** The same subset in SS3 (DECCKM application-cursor) encoding — the regression
 * family for the pre-fix bug where \x1bOC sat in both the left and the right
 * branch and \x1bOD was missing entirely. */
function fakeMatcherSS3(data: string, keyId: string): boolean {
	const raw: Record<string, string> = {
		escape: "\x1b",
		esc: "\x1b",
		enter: "\r",
		return: "\r",
		up: "\x1bOA",
		down: "\x1bOB",
		tab: "\t",
		"shift+tab": "\x1b[Z",
		left: "\x1bOD",
		right: "\x1bOC",
	};
	return raw[keyId] === data;
}

describe("ask_user_question validation", () => {
	test("accepts a well-formed questionnaire", () => {
		expect(validateQuestionnaire(twoQuestions).ok).toBe(true);
	});

	test("rejects empty and oversized question sets", () => {
		expect(validateQuestionnaire({ questions: [] }).error).toBe("no_questions");
		const tooMany: QuestionParams = {
			questions: Array.from({ length: 5 }, (_, index) => ({
				question: `q${index}`,
				header: `h${index}`,
				description: "",
				options: [
					{ label: "a", description: "" },
					{ label: "b", description: "" },
				],
			})),
		};
		expect(validateQuestionnaire(tooMany).error).toBe("too_many_questions");
	});

	test("rejects duplicate questions and options", () => {
		const duplicateQuestion: QuestionParams = {
			questions: [singleQuestion.questions[0]!, { ...singleQuestion.questions[0]! }],
		};
		expect(validateQuestionnaire(duplicateQuestion).error).toBe("duplicate_question");
		const duplicateOption: QuestionParams = {
			questions: [
				{
					question: "q",
					header: "h",
					options: [
						{ label: "same", description: "" },
						{ label: "same", description: "" },
					],
				},
			],
		};
		expect(validateQuestionnaire(duplicateOption).error).toBe("duplicate_option_label");
	});

	test("reserved labels are rejected before duplicate detection", () => {
		const reserved: QuestionParams = {
			questions: [
				{
					question: "q",
					header: "h",
					options: [
						{ label: "Other", description: "" },
						{ label: "Type something.", description: "" },
					],
				},
			],
		};
		expect(validateQuestionnaire(reserved).error).toBe("reserved_label");
	});

	test("line terminators are normalized before validation", () => {
		const crlf: QuestionParams = {
			questions: [
				{
					question: "q\r\n",
					header: "h",
					options: [
						{ label: "Other\r", description: "" },
						{ label: "b", description: "" },
					],
				},
			],
		};
		const normalized = normalizeQuestionParams(crlf);
		expect(normalized.questions[0]?.question).toBe("q\n");
		expect(normalized.questions[0]?.options[0]?.label).toBe("Other");
		expect(validateQuestionnaire(normalized).error).toBe("reserved_label");
	});

	test("double-encoded JSON args are decoded", () => {
		const encoded = {
			questions: JSON.stringify(twoQuestions.questions),
		};
		const prepared = prepareQuestionArguments(encoded);
		expect(prepared.questions.length).toBe(2);
		expect(prepared.questions[0]?.options[0]?.label).toBe("Date-fns");
		// Non-string garbage passes through untouched.
		const untouched = prepareQuestionArguments({ questions: 42 });
		expect((untouched as unknown as { questions: number }).questions).toBe(42);
	});
});

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

describe("questionnaire reducer", () => {
	test("confirm on a single question records the option answer", () => {
		let state = initialQuestionnaireState(singleQuestion);
		// Two downs lands on the "Type something." row (options 0,1 + other).
		state = reduceQuestionnaire(state, { kind: "nav", direction: 1 }, singleQuestion);
		state = reduceQuestionnaire(state, { kind: "nav", direction: 1 }, singleQuestion);
		expect(state.optionIndex).toBe(2);
		expect(state.inputMode).toBe(true);
		// Confirm with a blank draft is a no-op.
		state = reduceQuestionnaire(state, { kind: "confirm" }, singleQuestion);
		expect(state.answers.size).toBe(0);
		// Back up to an authored option and confirm it.
		state = reduceQuestionnaire(state, { kind: "nav", direction: -1 }, singleQuestion);
		expect(state.inputMode).toBe(false);
		state = reduceQuestionnaire(state, { kind: "confirm" }, singleQuestion);
		const answer = state.answers.get(0);
		expect(answer?.kind).toBe("option");
		expect(answer?.label).toBe("No");
	});

	test("multi toggles update the answer incrementally", () => {
		let state = initialQuestionnaireState(twoQuestions);
		state = { ...state, currentTab: 1, optionIndex: 0 };
		state = reduceQuestionnaire(state, { kind: "toggle" }, twoQuestions);
		state = reduceQuestionnaire(state, { kind: "nav", direction: 1 }, twoQuestions);
		state = reduceQuestionnaire(state, { kind: "toggle" }, twoQuestions);
		const answer = state.answers.get(1);
		expect(answer?.kind).toBe("multi");
		expect(answer?.selected).toEqual(["Parsing", "Formatting"]);
		expect(answer?.selectedIndexes).toEqual([0, 1]);
	});

	test("confirm auto-advances to the next tab", () => {
		let state = initialQuestionnaireState(twoQuestions);
		state = reduceQuestionnaire(state, { kind: "confirm" }, twoQuestions);
		expect(state.currentTab).toBe(1);
	});

	test("custom answers merge into multi selections", () => {
		let state = initialQuestionnaireState(twoQuestions);
		state = { ...state, currentTab: 1, optionIndex: 0 };
		state = reduceQuestionnaire(state, { kind: "toggle" }, twoQuestions);
		state = commitCustomAnswer(state, twoQuestions, "duration support");
		const answer = state.answers.get(1);
		expect(answer?.kind).toBe("multi");
		expect(answer?.text).toBe("duration support");
		expect(answer?.selected).toEqual(["Parsing"]);
	});

	test("tab switching wraps and resets transient row state", () => {
		let state = initialQuestionnaireState(twoQuestions);
		state = reduceQuestionnaire(state, { kind: "confirm" }, twoQuestions);
		expect(state.currentTab).toBe(1);
		state = reduceQuestionnaire(state, { kind: "tab_switch", delta: 1 }, twoQuestions);
		// Tab 2 is the submit tab.
		expect(state.currentTab).toBe(2);
		state = reduceQuestionnaire(state, { kind: "tab_switch", delta: 1 }, twoQuestions);
		expect(state.currentTab).toBe(0);
		expect(state.optionIndex).toBe(0);
		expect(state.inputMode).toBe(false);
	});

	test("navigation wraps around the option list", () => {
		let state = initialQuestionnaireState(twoQuestions);
		state = reduceQuestionnaire(state, { kind: "nav", direction: -1 }, twoQuestions);
		// Three rows: option, option, "Type something."
		expect(state.optionIndex).toBe(2);
		expect(state.inputMode).toBe(true);
		state = reduceQuestionnaire(state, { kind: "nav", direction: 1 }, twoQuestions);
		expect(state.optionIndex).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Key routing
// ---------------------------------------------------------------------------

describe("questionnaire key routing", () => {
	test("collapse key intercepts from every state", () => {
		const state = initialQuestionnaireState(twoQuestions);
		const action = routeQuestionnaireKey("\x1d", state, twoQuestions, { collapseKey: "ctrl+]" }, fakeMatcher);
		expect(action.kind).toBe("ignore"); // ctrl+] raw is \x1d — not matched by fakeMatcher
	});

	test("collapsed lockout passes only Esc", () => {
		const state: QuestionnaireState = {
			...initialQuestionnaireState(twoQuestions),
			collapsed: true,
		};
		expect(routeQuestionnaireKey("\x1b", state, twoQuestions, { collapseKey: "ctrl+]" }, fakeMatcher).kind).toBe(
			"cancel",
		);
		expect(routeQuestionnaireKey("\r", state, twoQuestions, { collapseKey: "ctrl+]" }, fakeMatcher).kind).toBe(
			"ignore",
		);
	});

	test("notes editor routing: Esc exits, keystrokes forward", () => {
		const state: QuestionnaireState = {
			...initialQuestionnaireState(twoQuestions),
			notesVisible: true,
		};
		expect(routeQuestionnaireKey("\x1b", state, twoQuestions, { collapseKey: "off" }, fakeMatcher).kind).toBe(
			"notes_exit",
		);
		expect(routeQuestionnaireKey("x", state, twoQuestions, { collapseKey: "off" }, fakeMatcher).kind).toBe(
			"notes_forward",
		);
	});

	test("inputMode: Enter with blank draft is a no-op", () => {
		const state: QuestionnaireState = {
			...initialQuestionnaireState(singleQuestion),
			optionIndex: 2,
			inputMode: true,
		};
		expect(routeQuestionnaireKey("\r", state, singleQuestion, { collapseKey: "off" }, fakeMatcher).kind).toBe(
			"ignore",
		);
	});

	test("inputMode: Enter with a draft confirms", () => {
		const state: QuestionnaireState = {
			...initialQuestionnaireState(singleQuestion),
			optionIndex: 2,
			inputMode: true,
			customDraftsByTab: new Map([[0, "luxon"]]),
		};
		expect(routeQuestionnaireKey("\r", state, singleQuestion, { collapseKey: "off" }, fakeMatcher).kind).toBe(
			"confirm",
		);
	});

	test("'n' opens notes; Tab switches tabs on multi-question only", () => {
		const state = initialQuestionnaireState(twoQuestions);
		expect(routeQuestionnaireKey("n", state, twoQuestions, { collapseKey: "off" }, fakeMatcher).kind).toBe(
			"notes_enter",
		);
		expect(routeQuestionnaireKey("\t", state, twoQuestions, { collapseKey: "off" }, fakeMatcher).kind).toBe(
			"tab_switch",
		);
		const single = initialQuestionnaireState(singleQuestion);
		expect(routeQuestionnaireKey("\t", single, singleQuestion, { collapseKey: "off" }, fakeMatcher).kind).toBe(
			"ignore",
		);
	});

	test("tab switching: every arrow encoding family routes to the right delta", () => {
		const state = initialQuestionnaireState(twoQuestions);
		const run = (data: string, matches = fakeMatcher) =>
			routeQuestionnaireKey(data, state, twoQuestions, { collapseKey: "off" }, matches);
		// CSI arrows (default cursor mode).
		expect(run("\x1b[D")).toEqual({ kind: "tab_switch", delta: -1 });
		expect(run("\x1b[C")).toEqual({ kind: "tab_switch", delta: 1 });
		// SS3 arrows (DECCKM application-cursor mode) — the pre-fix bug:
		// Right moved tabs backward and Left did nothing.
		expect(run("\x1bOD", fakeMatcherSS3)).toEqual({ kind: "tab_switch", delta: -1 });
		expect(run("\x1bOC", fakeMatcherSS3)).toEqual({ kind: "tab_switch", delta: 1 });
		// Shift+Tab moves backward, Tab forward.
		expect(run("\x1b[Z")).toEqual({ kind: "tab_switch", delta: -1 });
		expect(run("\t")).toEqual({ kind: "tab_switch", delta: 1 });
	});

	test("composition: the real pi-tui matcher drives the SS3 lane (no fake drift)", () => {
		// The component wires matchesKey directly; pin the composition so a
		// fake-matcher drift can never mask a real-matcher regression.
		expect(matchesKey("\x1bOD", "left")).toBe(true);
		expect(matchesKey("\x1bOC", "right")).toBe(true);
		expect(matchesKey("\x1b[D", "left")).toBe(true);
		expect(matchesKey("\x1b[C", "right")).toBe(true);
		expect(matchesKey("\t", "tab")).toBe(true);
		expect(matchesKey("\x1b[Z", "shift+tab")).toBe(true);
		const state = initialQuestionnaireState(twoQuestions);
		const route = (data: string) =>
			routeQuestionnaireKey(data, state, twoQuestions, { collapseKey: "off" }, matchesKey);
		expect(route("\x1bOD")).toEqual({ kind: "tab_switch", delta: -1 });
		expect(route("\x1bOC")).toEqual({ kind: "tab_switch", delta: 1 });
		expect(route("\x1b[Z")).toEqual({ kind: "tab_switch", delta: -1 });
	});

	test("submit tab: Enter submits or cancels per the picker", () => {
		const state: QuestionnaireState = {
			...initialQuestionnaireState(twoQuestions),
			currentTab: 2,
			submitChoiceIndex: 0,
		};
		expect(routeQuestionnaireKey("\r", state, twoQuestions, { collapseKey: "off" }, fakeMatcher).kind).toBe("submit");
		const cancelled: QuestionnaireState = { ...state, submitChoiceIndex: 1 };
		expect(routeQuestionnaireKey("\r", cancelled, twoQuestions, { collapseKey: "off" }, fakeMatcher).kind).toBe(
			"cancel",
		);
	});

	test("multiSelect tab: Space toggles options, suppressed on other/next rows", () => {
		const state: QuestionnaireState = { ...initialQuestionnaireState(twoQuestions), currentTab: 1, optionIndex: 0 };
		expect(routeQuestionnaireKey(" ", state, twoQuestions, { collapseKey: "off" }, fakeMatcher).kind).toBe("toggle");
		const onOther: QuestionnaireState = { ...state, optionIndex: 3 };
		expect(routeQuestionnaireKey(" ", onOther, twoQuestions, { collapseKey: "off" }, fakeMatcher).kind).toBe(
			"ignore",
		);
		const onNext: QuestionnaireState = { ...state, optionIndex: 4 };
		expect(routeQuestionnaireKey(" ", onNext, twoQuestions, { collapseKey: "off" }, fakeMatcher).kind).toBe("ignore");
		// Enter on the Next row multi-confirms.
		expect(routeQuestionnaireKey("\r", onNext, twoQuestions, { collapseKey: "off" }, fakeMatcher).kind).toBe(
			"multi_confirm",
		);
	});
});

// ---------------------------------------------------------------------------
// Result + envelope
// ---------------------------------------------------------------------------

describe("questionnaire envelope", () => {
	test("cancelled questionnaires decline", () => {
		const result = assembleQuestionnaireResult(initialQuestionnaireState(twoQuestions), twoQuestions, true);
		const response = buildQuestionnaireResponse(result, twoQuestions);
		expect(response.text).toBe("User declined to answer questions");
		expect(response.details.cancelled).toBe(true);
	});

	test("answered questionnaires enumerate segments", () => {
		let state = initialQuestionnaireState(twoQuestions);
		state = reduceQuestionnaire(state, { kind: "confirm" }, twoQuestions);
		state = { ...state, currentTab: 1, optionIndex: 0 };
		state = reduceQuestionnaire(state, { kind: "toggle" }, twoQuestions);
		state = commitCustomAnswer(state, twoQuestions, "duration support");
		const result = assembleQuestionnaireResult(state, twoQuestions, false);
		const response = buildQuestionnaireResponse(result, twoQuestions);
		expect(response.text).toContain('User has answered your questions: "Which library?"="Date-fns".');
		expect(response.text).toContain("You can now continue with the user's answers in mind.");
		expect(response.text).toContain("duration support");
		expect(response.details.cancelled).toBe(false);
	});

	test("unanswered questions are named in the envelope", () => {
		let state = initialQuestionnaireState(twoQuestions);
		state = reduceQuestionnaire(state, { kind: "confirm" }, twoQuestions);
		const result = assembleQuestionnaireResult(state, twoQuestions, false);
		const response = buildQuestionnaireResponse(result, twoQuestions);
		expect(response.text).toContain('unanswered: "Which features?".');
		expect(response.details.unanswered).toEqual([1]);
	});

	test("the global note lifts onto submit and cancel", () => {
		let state = initialQuestionnaireState(twoQuestions);
		state = { ...state, notesByTab: new Map([[2, "prefer tree-shaking"]]) };
		const result = assembleQuestionnaireResult(state, twoQuestions, true);
		expect(result.globalNote).toBe("prefer tree-shaking");
		const response = buildQuestionnaireResponse(result, twoQuestions);
		expect(response.text).toBe("User declined to answer questions");
		expect(response.details.globalNote).toBe("prefer tree-shaking");
	});

	test("per-question notes ride with their answers", () => {
		let state = initialQuestionnaireState(twoQuestions);
		state = { ...state, notesByTab: new Map([[0, "avoid moment"]]) };
		state = reduceQuestionnaire(state, { kind: "confirm" }, twoQuestions);
		const result = assembleQuestionnaireResult(state, twoQuestions, false);
		const response = buildQuestionnaireResponse(result, twoQuestions);
		expect(response.text).toContain("user notes: avoid moment");
	});
});
