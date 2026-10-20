/**
 * addons/ask-user-question.ts — the interactive questionnaire addon.
 *
 * Registers the `ask_user_question` tool (a faithful port of
 * @juicesharp/rpiv-ask-user-question, MIT): the model asks up to four
 * structured questions; the user answers in a bottom-of-screen dialog with
 * tabs, arrow-key navigation, an always-appended "Type something." row,
 * per-question notes ('n'), markdown previews and a submit-review tab.
 *
 * Presentation tiers:
 *   - TUI (mode "tui"): the full dialog, mounted inline via ctx.ui.custom.
 *   - RPC/ACP (mode "rpc", dialog primitives present): a sequential walker
 *     over the host's native select/input dialogs.
 *   - Headless (no UI): a typed error telling the model to ask as plain
 *     chat text instead — never a silent decline.
 *
 * The tool description, snippet and guidelines are user-overridable via
 * ~/.unown/agent/addons.json (guidance.*); the collapse key likewise.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	matchesKey,
	type TUI,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
	ASK_USER_QUESTION_TOOL_NAME,
	assembleQuestionnaireResult,
	buildQuestionnaireResponse,
	commitCustomAnswer,
	emitTerminalAttention,
	MAX_OPTIONS,
	normalizeQuestionParams,
	prepareQuestionArguments,
	type QuestionAnswer,
	type QuestionnaireAction,
	type QuestionnaireResult,
	type QuestionnaireState,
	type QuestionParams,
	QuestionParamsSchema,
	reduceQuestionnaire as reduce,
	routeQuestionnaireKey,
	validateQuestionnaire,
} from "./ask-user-question-core.ts";
import type { AddonGuidance, AskUserQuestionAddonConfig } from "./config.ts";
import { formatKeyForDisplay } from "./config.ts";

// ---------------------------------------------------------------------------
// LLM-facing copy (verbatim port; overridable via config.guidance)
// ---------------------------------------------------------------------------

export const DEFAULT_TOOL_DESCRIPTION = `Ask the user one or more structured questions during execution. Use when you need to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take

Usage notes:
- Users can type a custom answer via the automatically appended "Type something." row on every question or press Esc to abandon the questionnaire. Do NOT author "Other" or "Type something." labels yourself — reserved labels are rejected at runtime.
- Use multiSelect: true when multiple answers are valid. The "Type something." row is available on every question, including when options carry a preview; in preview mode it expands to the full pane width while typing so the custom answer is not cramped into the narrow options column.
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label.

Preview feature:
Use the optional preview field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

Preview content is rendered as markdown in a monospace box. Multi-line text with newlines is supported. When any option has a preview, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).`;

export const DEFAULT_PROMPT_SNIPPET =
	"Ask the user up to 4 structured questions (2-4 options each) when requirements are ambiguous";

export const DEFAULT_PROMPT_GUIDELINES: string[] = [
	"Use ask_user_question whenever the user's request is underspecified and you cannot proceed without concrete decisions — you can ask up to 4 questions per invocation.",
	'Each question MUST have 2-4 options. Every option requires a concise label (1-5 words) and a description explaining what the choice means or its trade-offs. The user can additionally type a custom answer via the automatically appended "Type something." row on every question, or press Esc to abandon the questionnaire. Do NOT author "Other" or "Type something." labels yourself — reserved labels are rejected at runtime.',
	'Set multiSelect: true when multiple answers are valid. Provide an options[].preview markdown string when an option benefits from richer side-by-side context (mockups, code snippets, diagrams, configs) — single-select only. The "Type something." row is appended to every question; in preview mode it expands to the full pane width while typing so the custom answer is not cramped into the narrow options column. If you recommend a specific option, make that the first option and append "(Recommended)" to its label.',
	"Do not stack multiple ask_user_question calls back-to-back — group all clarifying questions into one invocation.",
];

function guidanceOr(guidance: AddonGuidance): {
	description: string;
	promptSnippet: string;
	promptGuidelines: string[];
} {
	return {
		description: guidance.description ?? DEFAULT_TOOL_DESCRIPTION,
		promptSnippet: guidance.promptSnippet ?? DEFAULT_PROMPT_SNIPPET,
		promptGuidelines: guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES,
	};
}

// ---------------------------------------------------------------------------
// The dialog component
// ---------------------------------------------------------------------------

interface QuestionnaireViewOptions {
	params: QuestionParams;
	theme: Theme;
	collapseKey: string;
	done: (result: QuestionnaireResult) => void;
}

/**
 * The full questionnaire dialog. Renders as a manually bordered box (the
 * box-drawing border is theme-tinted and width-fit); all state changes flow
 * through the pure reducer in ask-user-question-core.ts. Two headless
 * Editors (custom answer, notes) are rendered inline while active.
 */
class QuestionnaireComponent {
	private state: QuestionnaireState;
	private readonly params: QuestionParams;
	private readonly theme: Theme;
	private readonly collapseKey: string;
	private readonly done: (result: QuestionnaireResult) => void;
	private readonly inputEditor: Editor;
	private readonly notesEditor: Editor;
	private settled = false;

	constructor(tui: TUI, options: QuestionnaireViewOptions) {
		this.params = options.params;
		this.theme = options.theme;
		this.collapseKey = options.collapseKey;
		this.done = options.done;
		this.state = {
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
		const editorTheme: EditorTheme = {
			borderColor: (text: string) => this.theme.fg("accent", text),
			selectList: {
				selectedPrefix: (text: string) => this.theme.fg("accent", text),
				selectedText: (text: string) => this.theme.fg("accent", text),
				description: (text: string) => this.theme.fg("muted", text),
				scrollInfo: (text: string) => this.theme.fg("dim", text),
				noMatch: (text: string) => this.theme.fg("warning", text),
			},
		};
		this.inputEditor = new Editor(tui, editorTheme);
		this.inputEditor.disableSubmit = true;
		this.notesEditor = new Editor(tui, editorTheme);
		this.notesEditor.disableSubmit = true;
	}

	// -- Component contract ------------------------------------------------

	render(width: number): string[] {
		const contentWidth = Math.max(width - 4, 20);
		if (this.state.collapsed) {
			const key = formatKeyForDisplay(this.collapseKey);
			const hint = key === "off" ? "Esc to cancel" : `${key} to expand · Esc to cancel`;
			return ["", ` ${this.theme.fg("dim", "Questionnaire collapsed")}  ${this.theme.fg("dim", `· ${hint}`)}`];
		}
		const inner = this.renderInner(contentWidth);
		const lines: string[] = [];
		const top = `┌${"─".repeat(Math.max(contentWidth, 1))}┐`;
		const bottom = `└${"─".repeat(Math.max(contentWidth, 1))}┘`;
		lines.push(this.theme.fg("accent", top));
		for (const line of inner) {
			lines.push(`${this.theme.fg("accent", "│")}${line}${this.theme.fg("accent", "│")}`);
		}
		lines.push(this.theme.fg("accent", bottom));
		lines.push("");
		return lines;
	}

	invalidate(): void {
		/* stateless render — nothing cached */
	}

	handleInput(data: string): void {
		if (this.settled) return;
		const matcher = (raw: string, keyId: string): boolean =>
			matchesKey(raw, keyId as Parameters<typeof matchesKey>[1]);
		const action = routeQuestionnaireKey(data, this.state, this.params, { collapseKey: this.collapseKey }, matcher);
		this.apply(action, data);
	}

	// -- Action application -------------------------------------------------

	private apply(action: QuestionnaireAction, rawData?: string): void {
		switch (action.kind) {
			case "ignore": {
				// Keystrokes while the custom-answer row is focused feed the
				// headless editor; the draft is mirrored into the tab map.
				if (this.state.inputMode && rawData !== undefined) {
					this.inputEditor.handleInput(rawData);
					this.state = {
						...this.state,
						customDraftsByTab: new Map(this.state.customDraftsByTab).set(
							this.state.currentTab,
							this.inputEditor.getText(),
						),
					};
				} else if (this.state.notesVisible && rawData !== undefined) {
					this.notesEditor.handleInput(rawData);
					this.state = {
						...this.state,
						notesByTab: new Map(this.state.notesByTab).set(this.notesTargetTab(), this.notesEditor.getText()),
					};
				}
				return;
			}
			case "notes_enter": {
				const tab = this.notesTargetTab();
				this.notesEditor.setText(this.state.notesByTab.get(tab) ?? "");
				this.state = { ...this.state, notesVisible: true };
				return;
			}
			case "notes_exit": {
				const tab = this.notesTargetTab();
				const trimmed = this.notesEditor.getText().trim();
				const notes = new Map(this.state.notesByTab);
				if (trimmed === "") notes.delete(tab);
				else notes.set(tab, trimmed);
				this.state = { ...this.state, notesVisible: false, notesByTab: notes };
				return;
			}
			case "confirm": {
				// The custom row's draft commits through commitCustomAnswer so
				// multi/custom merging and auto-advance stay in the pure core.
				if (this.state.inputMode) {
					const draft = this.inputEditor.getText();
					this.state = commitCustomAnswer(this.state, this.params, draft);
					this.inputEditor.setText("");
					this.syncEditorFromState();
					return;
				}
				this.state = reduce(this.state, action, this.params);
				return;
			}
			case "multi_confirm": {
				const draft = this.inputEditor.getText().trim();
				if (draft !== "") {
					this.state = commitCustomAnswer(this.state, this.params, draft);
					this.inputEditor.setText("");
				} else {
					this.state = reduce(this.state, action, this.params);
				}
				this.syncEditorFromState();
				return;
			}
			case "cancel": {
				this.finish(true);
				return;
			}
			case "submit": {
				this.finish(false);
				return;
			}
			default: {
				this.state = reduce(this.state, action, this.params);
				this.syncEditorFromState();
				return;
			}
		}
	}

	/** Notes slot: the submit tab hosts the GLOBAL note (pseudo-index). */
	private notesTargetTab(): number {
		const onSubmitTab = this.params.questions.length > 1 && this.state.currentTab === this.params.questions.length;
		return onSubmitTab ? this.params.questions.length : this.state.currentTab;
	}

	/** Entering inputMode preloads the tab's surviving draft. */
	private syncEditorFromState(): void {
		if (this.state.inputMode) {
			this.inputEditor.setText(this.state.customDraftsByTab.get(this.state.currentTab) ?? "");
		}
	}

	private finish(cancelled: boolean): void {
		if (this.settled) return;
		this.settled = true;
		this.done(assembleQuestionnaireResult(this.state, this.params, cancelled));
	}

	// -- Rendering -----------------------------------------------------------

	private renderInner(width: number): string[] {
		const multiQuestion = this.params.questions.length > 1;
		const lines: string[] = [];
		const onSubmitTab = multiQuestion && this.state.currentTab === this.params.questions.length;

		if (multiQuestion) lines.push(...this.renderTabBar(width));
		lines.push("");

		if (onSubmitTab) {
			lines.push(...this.renderSubmitTab(width));
		} else {
			const question = this.params.questions[this.state.currentTab];
			if (question) lines.push(...this.renderQuestion(width, question));
		}

		if (this.state.notesVisible) {
			lines.push(...this.renderNotesEditor(width));
		} else {
			const note = this.state.notesByTab.get(this.notesTargetTab())?.trim();
			if (note) {
				const first = note.split("\n")[0] ?? "";
				lines.push(`  ${this.theme.fg("dim", `Note: ${first}${note.includes("\n") ? " …" : ""}`)}`);
			}
		}
		lines.push(...this.renderFooter(width));
		return lines.map((line) => (line.length > 0 ? line : ""));
	}

	private renderTabBar(width: number): string[] {
		const parts: string[] = [" ← "];
		this.params.questions.forEach((question, index) => {
			const active = index === this.state.currentTab;
			const answered = this.state.answers.has(index);
			const marker = answered ? "■" : "□";
			const label = ` ${marker} ${question.header} `;
			parts.push(
				active
					? this.theme.bg("selectedBg", this.theme.fg("accent", label))
					: answered
						? this.theme.fg("success", label)
						: this.theme.fg("dim", label),
			);
		});
		const allAnswered = this.params.questions.every((_, index) => this.state.answers.has(index));
		const submitLabel = ` ✓ Submit `;
		parts.push(allAnswered ? this.theme.fg("success", submitLabel) : this.theme.fg("dim", submitLabel));
		parts.push(" → ");
		return [truncateToWidth(parts.join(""), width), ""];
	}

	private renderQuestion(width: number, question: (typeof this.params.questions)[number]): string[] {
		const lines: string[] = [];
		if (this.params.questions.length === 1) {
			lines.push(`  ${this.theme.bg("selectedBg", this.theme.fg("accent", ` ${question.header} `))}`);
			lines.push("");
		}
		for (const line of wrapTextWithAnsi(this.theme.bold(question.question), Math.max(width - 4, 10))) {
			lines.push(`  ${line}`);
		}
		lines.push("");
		if (question.multiSelect) {
			lines.push(...this.renderMultiOptions(width, question));
		} else {
			lines.push(...this.renderSingleOptions(width, question));
		}
		return lines;
	}

	private renderSingleOptions(width: number, question: (typeof this.params.questions)[number]): string[] {
		const lines: string[] = [];
		const numberWidth = String(Math.max(question.options.length, MAX_OPTIONS)).length;
		const answer = this.state.answers.get(this.state.currentTab);
		question.options.forEach((option, index) => {
			const active = index === this.state.optionIndex && !this.state.inputMode;
			const prefix = active ? this.theme.fg("accent", "❯ ") : "  ";
			const number = `${String(index + 1).padStart(numberWidth)}. `;
			const chosen = answer?.kind === "option" && answer.label === option.label;
			const label = `${prefix}${number}${this.theme.bold(option.label)}${chosen ? this.theme.fg("success", " ✔") : ""}`;
			const styled = active ? this.theme.fg("accent", label) : this.theme.fg("muted", label);
			for (const line of wrapTextWithAnsi(styled, Math.max(width - 4, 10))) lines.push(`  ${line}`);
			if (option.description && (active || chosen)) {
				for (const line of wrapTextWithAnsi(this.theme.fg("dim", option.description), Math.max(width - 8, 10))) {
					lines.push(`      ${line}`);
				}
			}
			if (active && option.preview) {
				lines.push(...this.renderPreviewBox(width, option.preview));
			}
		});
		// The auto-appended "Type something." row.
		const otherIndex = question.options.length;
		const active = this.state.optionIndex === otherIndex;
		const draft = this.state.customDraftsByTab.get(this.state.currentTab) ?? "";
		if (this.state.inputMode) {
			const heading = this.theme.fg(
				"accent",
				`❯ ${String(question.options.length + 1).padStart(numberWidth)}. Type something.`,
			);
			lines.push(`  ${heading}`);
			for (const line of this.inputEditor.render(Math.max(width - 6, 10))) lines.push(`    ${line}`);
		} else {
			const suffix =
				draft !== ""
					? ` ${this.theme.fg("muted", draft.split("\n")[0] ?? "")}${this.theme.fg("success", " ✔")}`
					: "";
			const row = `${active ? this.theme.fg("accent", "❯ ") : "  "}${String(question.options.length + 1).padStart(numberWidth)}. ${this.theme.fg("muted", "Type something.")}${suffix}`;
			lines.push(`  ${truncateToWidth(active ? this.theme.fg("accent", row) : row, width)}`);
		}
		return lines;
	}

	private renderMultiOptions(width: number, question: (typeof this.params.questions)[number]): string[] {
		const lines: string[] = [];
		const numberWidth = String(Math.max(question.options.length, MAX_OPTIONS)).length;
		question.options.forEach((option, index) => {
			const active = index === this.state.optionIndex;
			const checked = this.state.multiSelectChecked.has(index);
			const box = checked ? this.theme.fg("accent", "[✔]") : this.theme.fg("dim", "[ ]");
			const prefix = active ? this.theme.fg("accent", "❯ ") : "  ";
			const number = `${String(index + 1).padStart(numberWidth)}. `;
			const label = checked ? this.theme.fg("accent", option.label) : this.theme.fg("muted", option.label);
			lines.push(`  ${prefix}${number}${box} ${truncateToWidth(`${label}`, Math.max(width - 8, 10))}`);
			if (option.description && active) {
				for (const line of wrapTextWithAnsi(this.theme.fg("dim", option.description), Math.max(width - 8, 10))) {
					lines.push(`      ${line}`);
				}
			}
		});
		// "Type something." row (checkbox reflects a non-empty draft).
		const otherIndex = question.options.length;
		const draft = this.state.customDraftsByTab.get(this.state.currentTab) ?? "";
		const otherActive = this.state.optionIndex === otherIndex;
		const otherBox = draft.trim() !== "" ? this.theme.fg("accent", "[✔]") : this.theme.fg("dim", "[ ]");
		if (this.state.inputMode) {
			lines.push(
				`  ${this.theme.fg("accent", `❯ ${String(question.options.length + 1).padStart(numberWidth)}. Type something.`)}`,
			);
			for (const line of this.inputEditor.render(Math.max(width - 6, 10))) lines.push(`    ${line}`);
		} else {
			lines.push(
				`  ${otherActive ? this.theme.fg("accent", "❯ ") : "  "}${String(question.options.length + 1).padStart(numberWidth)}. ${otherBox} ${this.theme.fg("muted", "Type something.")}`,
			);
		}
		// Next / Submit row.
		const isLast = this.state.currentTab === this.params.questions.length - 1;
		const nextLabel = isLast ? "Submit" : "Next";
		const nextActive = this.state.optionIndex === otherIndex + 1;
		lines.push("");
		lines.push(
			`  ${nextActive ? this.theme.fg("accent", this.theme.bold(`❯ ${nextLabel}`)) : this.theme.fg("dim", `  ${nextLabel}`)}`,
		);
		return lines;
	}

	private renderPreviewBox(width: number, preview: string): string[] {
		// Fenced-code markers are stripped; content is wrapped in a manual
		// monospace box, capped at 12 rows.
		const stripped = preview
			.split("\n")
			.filter((line) => !line.trimStart().startsWith("```"))
			.join("\n");
		const maxRows = 12;
		const rows = stripped.split("\n");
		const clipped = rows.length > maxRows;
		const shown = rows.slice(0, maxRows);
		const boxWidth = Math.min(Math.max(...shown.map((line) => line.length), 20) + 4, Math.max(width - 6, 12));
		const lines: string[] = [];
		const horizontal = "─".repeat(Math.max(boxWidth - 2, 1));
		lines.push(`      ${this.theme.fg("accent", `┌${horizontal}┐`)}`);
		for (const row of shown) {
			const padded = row.length > boxWidth - 4 ? row.slice(0, boxWidth - 4) : row.padEnd(boxWidth - 4);
			lines.push(
				`      ${this.theme.fg("accent", "│")} ${this.theme.fg("muted", padded)} ${this.theme.fg("accent", "│")}`,
			);
		}
		const footer = clipped ? `└── ✂ ── ${rows.length - maxRows} lines hidden ──┘` : `└${horizontal}┘`;
		lines.push(`      ${this.theme.fg("accent", footer)}`);
		return lines;
	}

	private renderSubmitTab(_width: number): string[] {
		const lines: string[] = [];
		lines.push(`  ${this.theme.fg("accent", this.theme.bold("Review your answers"))}`);
		lines.push("");
		let any = false;
		for (let index = 0; index < this.params.questions.length; index++) {
			const answer = this.state.answers.get(index);
			const question = this.params.questions[index];
			if (!question) continue;
			const head = answer ? ` ● ${question.header}` : ` ○ ${question.header}`;
			lines.push(`  ${answer ? this.theme.fg("accent", head) : this.theme.fg("dim", head)}`);
			if (answer) {
				any = true;
				lines.push(`     ${this.theme.fg("muted", `→ ${answerSummary(answer)}`)}`);
				const note = this.state.notesByTab.get(index)?.trim();
				if (note) lines.push(`     ${this.theme.fg("dim", `Note: ${note.split("\n")[0] ?? ""}`)}`);
			}
		}
		if (!any) lines.push(`  ${this.theme.fg("dim", "(no answers yet)")}`);
		const globalNote = this.state.notesByTab.get(this.params.questions.length)?.trim();
		if (globalNote)
			lines.push(
				`  ${this.theme.fg("accent", " ● Note")} ${this.theme.fg("muted", `→ ${globalNote.split("\n")[0] ?? ""}`)}`,
			);
		lines.push("");
		const unansweredCount = this.params.questions.length - this.state.answers.size;
		if (unansweredCount > 0) {
			lines.push(
				`  ${this.theme.fg("warning", `⚠ ${unansweredCount} question${unansweredCount > 1 ? "s" : ""} unanswered (submitting is still allowed)`)}`,
			);
		} else {
			lines.push(`  ${this.theme.fg("success", "Ready to submit your answers?")}`);
		}
		const submit = this.state.submitChoiceIndex === 0;
		lines.push(
			`  ${submit ? this.theme.fg("accent", this.theme.bold("❯ 1. Submit answers")) : this.theme.fg("muted", "  1. Submit answers")}`,
		);
		lines.push(
			`  ${!submit ? this.theme.fg("accent", this.theme.bold("❯ 2. Cancel")) : this.theme.fg("muted", "  2. Cancel")}`,
		);
		return lines;
	}

	private renderNotesEditor(width: number): string[] {
		const lines: string[] = [];
		const onSubmitTab = this.params.questions.length > 1 && this.state.currentTab === this.params.questions.length;
		const heading = onSubmitTab ? "Global note (applies to all answers)" : "Notes";
		lines.push(`  ${this.theme.fg("dim", `${heading} (Enter to save, Esc to discard):`)}`);
		for (const line of this.notesEditor.render(Math.max(width - 6, 10))) lines.push(`    ${line}`);
		return lines;
	}

	private renderFooter(width: number): string[] {
		const question = this.params.questions[this.state.currentTab];
		const parts: string[] = ["Enter to select", "↑/↓ to navigate"];
		if (question?.multiSelect) parts.push("Space to toggle");
		if (!this.state.inputMode) parts.push("n to add notes");
		if (this.params.questions.length > 1) parts.push("Tab to switch questions");
		parts.push("Esc to cancel");
		const key = formatKeyForDisplay(this.collapseKey);
		if (key !== "off") parts.push(`${key} to collapse`);
		if (this.state.inputMode) {
			parts.push("Shift+Enter for newline");
			parts.push("Ctrl+U to clear");
		}
		return ["", `  ${this.theme.fg("dim", truncateToWidth(parts.join(" · "), Math.max(width - 4, 10)))}`];
	}
}

function answerSummary(answer: QuestionAnswer): string {
	if (answer.kind === "multi") {
		const parts = [...(answer.selected ?? [])];
		if (answer.text) parts.push(answer.text);
		return parts.join(", ");
	}
	if (answer.kind === "custom") return answer.text && answer.text !== "" ? answer.text : "(no input)";
	return answer.label;
}

// ---------------------------------------------------------------------------
// Execution paths
// ---------------------------------------------------------------------------

async function runTuiQuestionnaire(
	ctx: ExtensionContext,
	params: QuestionParams,
	collapseKey: string,
): Promise<QuestionnaireResult | undefined> {
	emitTerminalAttention();
	const result = await ctx.ui.custom<QuestionnaireResult | undefined>(
		(tui: TUI, theme: Theme, _keybindings, done) =>
			new QuestionnaireComponent(tui, { params, theme, collapseKey, done }),
		{ overlay: false },
	);
	return result ?? undefined;
}

interface DialogUI {
	select: (
		title: string,
		options: string[],
		opts?: { signal?: AbortSignal; timeout?: number },
	) => Promise<string | undefined>;
	input: (
		title: string,
		placeholder?: string,
		opts?: { signal?: AbortSignal; timeout?: number },
	) => Promise<string | undefined>;
}

/**
 * RPC/ACP walker: questions asked sequentially over the host's native
 * dialogs. Dismissing any dialog cancels the whole questionnaire; any other
 * free-typed reply to a select is honored as a custom answer.
 */
async function runRpcQuestionnaire(ctx: ExtensionContext, params: QuestionParams): Promise<QuestionnaireResult> {
	const ui = ctx.ui as unknown as DialogUI;
	const answers: QuestionAnswer[] = [];
	for (let index = 0; index < params.questions.length; index++) {
		const question = params.questions[index];
		const lines = question.options.map(
			(option, optionIndex) => `${optionIndex + 1}. ${option.label} — ${option.description ?? ""}`,
		);
		if (question.options.some((option) => option.preview)) {
			lines.push("--- previews ---");
			question.options.forEach((option, optionIndex) => {
				if (option.preview) lines.push(`--- ${optionIndex + 1}. ${option.label} preview ---`);
				if (option.preview) lines.push(option.preview.slice(0, 600));
			});
		}
		lines.push(`${question.options.length + 1}. Type something.`);
		if (question.multiSelect) {
			const reply = await ui.input(question.question, "1,3; custom answer");
			if (reply === undefined) return { answers, cancelled: true };
			const checked = new Set<number>();
			let custom: string | undefined;
			const [numbersPart, ...customParts] = reply.split(";");
			const customText = customParts.join(";").trim();
			for (const token of numbersPart.split(",")) {
				const trimmed = token.trim();
				const parsed = Number(trimmed);
				if (trimmed !== "" && Number.isInteger(parsed) && parsed >= 1 && parsed <= question.options.length) {
					checked.add(parsed - 1);
				}
			}
			if (customText !== "") custom = customText;
			if (checked.size === 0 && !custom) continue;
			const labels = [...checked].sort((a, b) => a - b).map((optionIndex) => question.options[optionIndex].label);
			answers.push({
				questionIndex: index,
				question: question.question,
				kind: "multi",
				label: custom ? `${labels.join(", ")}${labels.length ? " + custom" : "custom"}` : labels.join(", "),
				selected: labels,
				selectedIndexes: [...checked].sort((a, b) => a - b),
				...(custom ? { text: custom } : {}),
			});
		} else {
			const reply = await ui.select(question.question, lines);
			if (reply === undefined) return { answers, cancelled: true };
			const match = /^(?<number>\d+)\.\s/.exec(reply);
			if (match) {
				const optionIndex = Number(match.groups?.number) - 1;
				if (optionIndex >= 0 && optionIndex < question.options.length) {
					const option = question.options[optionIndex];
					answers.push({
						questionIndex: index,
						question: question.question,
						kind: "option",
						label: option.label,
						preview: option.preview,
					});
					continue;
				}
			}
			const authored = question.options.find((option) => reply === option.label);
			if (authored) {
				answers.push({
					questionIndex: index,
					question: question.question,
					kind: "option",
					label: authored.label,
					preview: authored.preview,
				});
				continue;
			}
			const typed = await ui.input(`${question.question} — type your answer:`);
			if (typed === undefined || typed.trim() === "") return { answers, cancelled: true };
			answers.push({
				questionIndex: index,
				question: question.question,
				kind: "custom",
				label: typed.trim().split("\n")[0] ?? typed.trim(),
				text: typed.trim(),
			});
		}
	}
	return { answers, cancelled: false };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerAskUserQuestionTool(pi: ExtensionAPI, config: AskUserQuestionAddonConfig): void {
	const guidance = guidanceOr(config.guidance);
	pi.registerTool({
		name: "ask_user_question",
		label: "Ask User Question",
		description: guidance.description,
		promptSnippet: guidance.promptSnippet,
		promptGuidelines: guidance.promptGuidelines,
		parameters: QuestionParamsSchema,
		prepareArguments: (args: unknown) => prepareQuestionArguments(args),
		async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
			const params = normalizeQuestionParams(rawParams as QuestionParams);
			if (!ctx.hasUI) {
				const response = buildQuestionnaireResponse(undefined, params);
				return { content: [{ type: "text", text: response.text }], details: response.details };
			}
			const validation = validateQuestionnaire(params);
			if (!validation.ok) {
				const response = buildQuestionnaireResponse({ answers: [], cancelled: true }, params);
				return {
					content: [{ type: "text", text: `${validation.message}\n${response.text}` }],
					details: { ...response.details, error: validation.error },
				};
			}
			if (ctx.mode === "tui") {
				const result = await runTuiQuestionnaire(ctx, params, config.collapseKey);
				if (result) {
					const response = buildQuestionnaireResponse(result, params);
					return { content: [{ type: "text", text: response.text }], details: response.details };
				}
				// Host could not mount the custom component.
				return {
					content: [
						{
							type: "text",
							text: "Error: this host cannot render the questionnaire dialog. Ask the user in plain chat text instead.",
						},
					],
					details: { answers: [], cancelled: true },
				};
			}
			// RPC / ACP walker.
			const result = await runRpcQuestionnaire(ctx, params);
			const response = buildQuestionnaireResponse(result, params);
			return { content: [{ type: "text", text: response.text }], details: response.details };
		},
	});

	// Headless reconciliation (rpiv behavior): a session with no UI (print /
	// json subagents) never advertises the tool, so the model doesn't burn a
	// turn on a question nobody can answer. Idempotent: only this tool's own
	// membership in the active set is touched, sibling tools pass through.
	let stripped = false;
	pi.on("before_agent_start", async (_event, ctx) => {
		try {
			const active = pi.getActiveTools();
			const present = active.includes(ASK_USER_QUESTION_TOOL_NAME);
			if (!ctx.hasUI && present) {
				pi.setActiveTools(active.filter((name) => name !== ASK_USER_QUESTION_TOOL_NAME));
				stripped = true;
				return;
			}
			if (ctx.hasUI && stripped && !present) {
				pi.setActiveTools([...active, ASK_USER_QUESTION_TOOL_NAME]);
				stripped = false;
			}
		} catch {
			/* active-tool management is best-effort */
		}
	});
}
