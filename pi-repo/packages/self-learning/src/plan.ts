/**
 * plan.ts — the Plan Mode V2 data model, parser, renderer and quality scorer.
 *
 * One source of truth shared by four consumers:
 *   1. the `plan_write` tool (self-critique: the score rides the tool result),
 *   2. the `exit_plan_mode` tool (the approval gate shows score + steps),
 *   3. the `/plan show` command (the status surface),
 *   4. the planning benchmark (`benchmarks/plan-mode/` imports the scorer
 *      through this package so product and measurement can never drift).
 *
 * Design lineage (2026-10-31 planning round, benchmarks/plan-mode/GAP-REGISTER.md):
 *   - sectioned plan documents: OpenHands PLAN.md structure (OBJECTIVE / CONTEXT
 *     SUMMARY / APPROACH OVERVIEW / IMPLEMENTATION STEPS / TESTING AND VALIDATION)
 *     and Claude Code's plan-file requirements (Context, recommended approach,
 *     file paths, Verification) — gap P-02;
 *   - a deterministic 7-dimension rubric (gap P-05): objective, context, approach,
 *     steps, risks, verification, clarity. No LLM judge — the same plan always
 *     scores the same, receipts are reproducible.
 *
 * Everything in here is pure: no fs, no ctx, no clocks.
 */

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export interface PlanStep {
	/** 1-based position in the plan. */
	step: number;
	/** The step text (normalized: single spaces, no markdown emphasis). */
	text: string;
	/** Files the step touches, when annotated ("(files: `a.ts`, `b.ts`)"). */
	files: string[];
	/** Progress marker — [DONE:n] tags during execution. */
	completed: boolean;
}

export interface PlanDoc {
	/** One line: what this plan changes. */
	objective: string;
	/** Why: the problem or need that prompted it. */
	context: string;
	/** The recommended approach and its rationale (not an alternatives essay). */
	approach: string;
	/** Ordered implementation steps. */
	steps: PlanStep[];
	/** What could break, and the mitigation for each. */
	risks: string[];
	/** How to verify the change end-to-end (commands expected). */
	verification: string;
	/** Questions that remain for the user (usually empty at approval). */
	openQuestions: string[];
}

export const EMPTY_PLAN_DOC: PlanDoc = {
	objective: "",
	context: "",
	approach: "",
	steps: [],
	risks: [],
	verification: "",
	openQuestions: [],
};

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/** Collapse whitespace and strip markdown emphasis from a single line. */
function cleanLine(line: string): string {
	return line
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
		.replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

const FILE_ANNOTATION = /\((?:files?|touches|in):\s*([^)]+)\)\s*$/i;

/** Extract `(files: a.ts, b.ts)` trailing annotations from a step line. */
function splitStepFiles(text: string): { text: string; files: string[] } {
	const match = text.match(FILE_ANNOTATION);
	if (!match) return { text, files: [] };
	const files = match[1]
		.split(/[,;]/)
		.map((f) =>
			f
				.trim()
				.replace(/^`+|`+$/g, "")
				.trim(),
		)
		.filter((f) => f.length > 0);
	return { text: text.slice(0, match.index).trim(), files };
}

const PATH_TOKEN =
	/(?:[\w.-]+\/)+[\w.-]+\.\w+|\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|rb|php|c|cc|cpp|h|hpp|cs|swift|kt|scala|sh|json|ya?ml|toml|md|css|scss|html|sql|prisma)\b/;

/** True when a step names a file path or a path-like symbol reference. */
export function stepNamesFiles(step: PlanStep): boolean {
	if (step.files.length > 0) return true;
	return PATH_TOKEN.test(step.text);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const OBJECTIVE_HEADERS = [
	/^#{0,3}\s*(?:\*\*)?plan(?:\*\*)?\s*[::]\s*(.+)$/i,
	/^#{0,3}\s*(?:\*\*)?objective(?:\*\*)?\s*[::]\s*(.+)$/i,
];
const CONTEXT_HEADER = /^#{0,3}\s*(?:\*\*)?context(?:\s+summary)?(?:\*\*)?\s*[::]?$/i;
const APPROACH_HEADER = /^#{0,3}\s*(?:\*\*)?approach(?:\s+overview)?(?:\*\*)?\s*[::]?$/i;
const STEPS_HEADER = /^#{0,3}\s*(?:\*\*)?(?:implementation\s+)?steps?(?:\*\*)?\s*[::]?$/i;
const RISKS_HEADER = /^#{0,3}\s*(?:\*\*)?risks?(?:\s+and\s+mitigations?)?(?:\*\*)?\s*[::]?$/i;
const VERIFICATION_HEADER = /^#{0,3}\s*(?:\*\*)?verification(?:\*\*)?\s*[::]?$/i;
const TESTING_HEADER = /^#{0,3}\s*(?:\*\*)?testing(?:\s+and\s+validation)?(?:\*\*)?\s*[::]?$/i;
const OPEN_QUESTIONS_HEADER = /^#{0,3}\s*(?:\*\*)?open\s+questions?(?:\*\*)?\s*[::]?$/i;
const LEGACY_PLAN_HEADER = /^\*{0,2}plan:?\*{0,2}\s*$/i;

type ParagraphSection = "context" | "approach" | "verification";
type Section = ParagraphSection | "steps" | "risks" | "openQuestions" | "none";

const STEP_LINE = /^\s*(\d+)[.)]\s+(.+)$/;

/**
 * Parse a plan document from markdown. Tolerant of the legacy format (a bare
 * numbered list under a "Plan:" header) and of sections arriving in any order;
 * the first `# Plan: <objective>` / `Objective:` line wins for the objective.
 */
export function parsePlanMarkdown(markdown: string): PlanDoc {
	const doc: PlanDoc = {
		objective: "",
		context: "",
		approach: "",
		steps: [],
		risks: [],
		verification: "",
		openQuestions: [],
	};
	const lines = markdown.split(/\r?\n/);
	let section: Section = "none";
	const paragraphs = new Map<ParagraphSection, string[]>();

	const pushParagraph = (key: ParagraphSection, line: string): void => {
		let chunks = paragraphs.get(key);
		if (!chunks) {
			chunks = [];
			paragraphs.set(key, chunks);
		}
		chunks.push(line);
	};
	const flush = () => {
		for (const [key, chunks] of paragraphs) {
			const text = chunks
				.map((c) => c.trim())
				.filter((c) => c.length > 0)
				.join("\n");
			if (text) doc[key] = text;
		}
	};

	let inFence = false;
	for (const raw of lines) {
		const stripped = raw.trim();
		// Headers are matched against the emphasis-stripped line so **Objective:**,
		// **Context** and friends parse regardless of where the bold markers sit
		// relative to the colon (gap P-02: tolerance is part of the contract).
		const plain = cleanLine(stripped);
		// Fenced code blocks: the fence itself never reaches any section; its
		// content skips header/step parsing but still flows into paragraph
		// sections — a Verification section legitimately shows its commands in
		// a fence, while a fenced example inside Steps must not parse as steps.
		if (stripped.startsWith("```")) {
			inFence = !inFence;
			continue;
		}
		if (inFence) {
			if (section === "context" || section === "approach" || section === "verification") {
				pushParagraph(section, stripped);
			}
			continue;
		}
		if (plain.length === 0) {
			if (section === "context" || section === "approach" || section === "verification") {
				pushParagraph(section, "");
			}
			continue;
		}
		// Objective may be a one-liner with the value on the header line.
		if (doc.objective === "") {
			let matched = false;
			for (const pattern of OBJECTIVE_HEADERS) {
				const m = plain.match(pattern);
				if (m?.[1]) {
					doc.objective = m[1].trim();
					matched = true;
					break;
				}
			}
			if (matched) continue;
		}
		// Section headers switch the current section.
		if (CONTEXT_HEADER.test(plain)) {
			section = "context";
			continue;
		}
		if (APPROACH_HEADER.test(plain)) {
			section = "approach";
			continue;
		}
		if (STEPS_HEADER.test(plain) || LEGACY_PLAN_HEADER.test(plain)) {
			section = "steps";
			continue;
		}
		if (RISKS_HEADER.test(plain)) {
			section = "risks";
			continue;
		}
		if (VERIFICATION_HEADER.test(plain) || TESTING_HEADER.test(plain)) {
			section = "verification";
			continue;
		}
		if (OPEN_QUESTIONS_HEADER.test(plain)) {
			section = "openQuestions";
			continue;
		}
		if (section === "none") continue;
		if (section === "steps") {
			const m = stripped.match(STEP_LINE);
			if (m) {
				const { text, files } = splitStepFiles(cleanLine(m[2]));
				if (text.length > 3 && !text.startsWith("/") && !text.startsWith("`")) {
					doc.steps.push({ step: doc.steps.length + 1, text, files, completed: false });
				}
			}
		} else if (section === "risks" || section === "openQuestions") {
			const bullet = stripped.replace(/^[-*+]\s+/, "");
			if (bullet.length > 3) {
				const cleaned = cleanLine(bullet);
				if (section === "risks") doc.risks.push(cleaned);
				else doc.openQuestions.push(cleaned);
			}
		} else {
			pushParagraph(section, stripped);
		}
	}
	flush();
	// Legacy plans (pre-V2) are a header + numbered list only: keep working.
	if (doc.objective === "" && doc.steps.length > 0) {
		doc.objective = "Untitled plan";
	}
	return doc;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/** Deterministic markdown render (parse ∘ render is stable for well-formed docs). */
export function renderPlanMarkdown(doc: PlanDoc): string {
	const parts: string[] = [];
	parts.push(`# Plan: ${doc.objective || "Untitled plan"}`);
	if (doc.context) parts.push(`\n## Context\n\n${doc.context}`);
	if (doc.approach) parts.push(`\n## Approach\n\n${doc.approach}`);
	if (doc.steps.length > 0) {
		const steps = doc.steps
			.map((s) => {
				const files = s.files.length > 0 ? ` (files: ${s.files.map((f) => `\`${f}\``).join(", ")})` : "";
				return `${s.step}. ${s.text}${files}`;
			})
			.join("\n");
		parts.push(`\n## Steps\n\n${steps}`);
	}
	if (doc.risks.length > 0) parts.push(`\n## Risks\n\n${doc.risks.map((r) => `- ${r}`).join("\n")}`);
	if (doc.verification) parts.push(`\n## Verification\n\n${doc.verification}`);
	if (doc.openQuestions.length > 0) {
		parts.push(`\n## Open questions\n\n${doc.openQuestions.map((q) => `- ${q}`).join("\n")}`);
	}
	return `${parts.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Tolerant extraction from an assistant message (the legacy lane, kept alive)
// ---------------------------------------------------------------------------

/**
 * Extract a PlanDoc from free-form assistant text: the sectioned format wins;
 * the legacy "Plan:" + numbered-list format still parses. Returns null when no
 * plan-shaped content is found (fewer than MIN_STEPS steps).
 */
export const MIN_STEPS = 2;

export function extractPlanDoc(message: string): PlanDoc | null {
	const doc = parsePlanMarkdown(message);
	if (doc.steps.length >= MIN_STEPS) return doc;
	// Legacy: numbered list anywhere under a "Plan:" header (the pre-V2 contract).
	const legacy = extractPlanSteps(message);
	if (legacy.length >= MIN_STEPS) {
		return { ...EMPTY_PLAN_DOC, objective: "Untitled plan", steps: legacy };
	}
	return null;
}

/**
 * Legacy step extraction (pre-V2 compatibility, the original pi-example port).
 * Kept because session transcripts from older versions still hold this shape.
 */
export function extractPlanSteps(message: string): PlanStep[] {
	const items: PlanStep[] = [];
	const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i);
	if (!headerMatch) return items;
	const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
	const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;
	for (const match of planSection.matchAll(numberedPattern)) {
		const text = match[2]
			.trim()
			.replace(/\*{1,2}$/, "")
			.trim();
		if (text.length > 5 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
			const cleaned = text
				.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
				.replace(/\s+/g, " ")
				.trim();
			if (cleaned.length > 3) {
				const { text: stepText, files } = splitStepFiles(cleaned);
				items.push({ step: items.length + 1, text: stepText, files, completed: false });
			}
		}
	}
	return items;
}

/** Mark steps completed from [DONE:n] tags in execution-time text. Mutates + returns the count newly marked. */
export function markCompletedSteps(text: string, items: PlanStep[]): number {
	let marked = 0;
	for (const match of text.matchAll(/\[DONE:(\d+)\]/gi)) {
		const step = Number(match[1]);
		const item = items.find((t) => t.step === step);
		if (item && !item.completed) {
			item.completed = true;
			marked++;
		}
	}
	return marked;
}

/**
 * Re-scan completed steps from a transcript's assistant messages (the crash-tail
 * recovery the pi example had and the original port dropped — gap P-10). Only
 * messages AFTER the last plan-execute marker count.
 */
export function rescanCompletedSteps(
	messages: Array<{ role: string; text: string }>,
	items: PlanStep[],
	executeMarker = "unown-plan-execute",
): number {
	const texts = messages.map((m) => m.text);
	let lastExecute = -1;
	for (let i = 0; i < texts.length; i++) {
		if (texts[i].includes(executeMarker)) lastExecute = i;
	}
	let marked = 0;
	for (let i = lastExecute + 1; i < texts.length; i++) {
		marked += markCompletedSteps(texts[i], items);
	}
	return marked;
}

// ---------------------------------------------------------------------------
// The deterministic quality rubric (gap P-05)
// ---------------------------------------------------------------------------

export interface PlanScoreDimension {
	/** Dimension id (objective, context, …). */
	id: string;
	/** Human label for UI + receipts. */
	label: string;
	/** Points earned (0..weight). */
	points: number;
	/** Maximum points. */
	weight: number;
	/** Which sub-checks failed — the self-critique loop's to-fix list. */
	missing: string[];
}

export interface PlanScore {
	score: number;
	dimensions: PlanScoreDimension[];
	/** The threshold this score was judged against. */
	threshold: number;
	/** True when score meets the threshold (default 70). */
	passes: boolean;
	/** One-line human summary for dialogs and envelopes. */
	summary: string;
}

export const PLAN_SCORE_THRESHOLD_DEFAULT = 70;

const VAGUE_STEP = /^(?:handle|etc|misc|various|stuff|things|miscellaneous)\b/i;
const PLACEHOLDER = /\b(?:TODO|TBD|XXX|FIXME|placeholder|to be determined|待补充)\b/i;
const COMMAND_HINT =
	/(?:^|\n)\s*(?:[-*+>]\s*)?(?:\$|>|`)?\s*(?:bun|npm|npx|node|pnpm|yarn|python|pytest|cargo|go|make|git|curl|bash|sh|deno|cd)\b/i;

function wordCount(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

/** The deterministic plan-quality rubric. Pure: same doc in, same score out. */
export function scorePlanDoc(doc: PlanDoc, threshold: number = PLAN_SCORE_THRESHOLD_DEFAULT): PlanScore {
	const dimensions: PlanScoreDimension[] = [];

	// Objective — 10: present (6) + concise one-liner ≤ 120 chars (4). The
	// "Untitled plan" placeholder (legacy docs) earns nothing.
	{
		const missing: string[] = [];
		let points = 0;
		const obj = doc.objective.trim();
		const real = obj.length > 0 && obj !== "Untitled plan";
		if (real) points += 6;
		else missing.push("a one-line objective after '# Plan:'");
		if (real && obj.length <= 120) points += 4;
		else if (real) missing.push("objective trimmed to one line (<= 120 chars)");
		dimensions.push({ id: "objective", label: "Objective", points, weight: 10, missing });
	}

	// Context — 10: present (5) + substantive ≥ 15 words (5).
	{
		const missing: string[] = [];
		let points = 0;
		const ctx = doc.context.trim();
		if (ctx.length > 0) points += 5;
		else missing.push("a Context section (why this change)");
		if (wordCount(ctx) >= 15) points += 5;
		else if (ctx.length > 0) missing.push("context expanded (>= 15 words)");
		dimensions.push({ id: "context", label: "Context", points, weight: 10, missing });
	}

	// Approach — 10: present (5) + ≥ 10 words (5).
	{
		const missing: string[] = [];
		let points = 0;
		const approach = doc.approach.trim();
		if (approach.length > 0) points += 5;
		else missing.push("an Approach section (the recommended design)");
		if (wordCount(approach) >= 10) points += 5;
		else if (approach.length > 0) missing.push("approach expanded (>= 10 words)");
		dimensions.push({ id: "approach", label: "Approach", points, weight: 10, missing });
	}

	// Steps — 30: count 3..12 (12) + every step ≥ 4 words (9) + ≥ half name files (9).
	{
		const missing: string[] = [];
		let points = 0;
		const n = doc.steps.length;
		if (n >= 3 && n <= 12) points += 12;
		else if (n > 0) missing.push(n < 3 ? "at least 3 steps" : "at most 12 steps (split the plan)");
		else missing.push("3-12 numbered steps under '## Steps'");
		const shortSteps = doc.steps.filter((s) => wordCount(s.text) < 4).length;
		if (n > 0 && shortSteps === 0) points += 9;
		else if (n > 0) missing.push(`every step expanded to >= 4 words (${shortSteps} too short)`);
		const withFiles = doc.steps.filter((s) => stepNamesFiles(s)).length;
		if (n > 0 && withFiles >= Math.ceil(n / 2)) points += 9;
		else if (n > 0)
			missing.push(`at least half the steps naming their files — '(files: src/a.ts)' (${withFiles}/${n} do)`);
		dimensions.push({ id: "steps", label: "Steps", points, weight: 30, missing });
	}

	// Risks — 15: ≥ 1 (7) + ≥ 2 (8).
	{
		const missing: string[] = [];
		let points = 0;
		const n = doc.risks.filter((r) => r.trim().length > 3).length;
		if (n >= 1) points += 7;
		else missing.push("at least one risk with its mitigation under '## Risks'");
		if (n >= 2) points += 8;
		else if (n === 1) missing.push("a second risk (edge cases, migration, perf)");
		dimensions.push({ id: "risks", label: "Risks", points, weight: 15, missing });
	}

	// Verification — 15: present (7) + a runnable command (8).
	{
		const missing: string[] = [];
		let points = 0;
		const v = doc.verification.trim();
		if (v.length > 0) points += 7;
		else missing.push("a Verification section (how to prove it works)");
		if (COMMAND_HINT.test(v)) points += 8;
		else if (v.length > 0) missing.push("the exact verification command(s) (e.g. `bun test test/plan.test.ts`)");
		dimensions.push({ id: "verification", label: "Verification", points, weight: 15, missing });
	}

	// Clarity — 10: no placeholders (5) + no vague step openers (5). An empty
	// plan earns nothing here: clarity is judged on real steps.
	{
		const missing: string[] = [];
		let points = doc.steps.length > 0 ? 10 : 0;
		const all = [
			doc.objective,
			doc.context,
			doc.approach,
			doc.verification,
			...doc.risks,
			...doc.steps.map((s) => s.text),
		].join("\n");
		if (doc.steps.length === 0) {
			missing.push("at least one step before clarity can be judged");
		}
		if (PLACEHOLDER.test(all)) {
			points -= 5;
			missing.push("placeholder text removed (TODO/TBD/…)");
		}
		const vague = doc.steps.filter((s) => VAGUE_STEP.test(s.text.trim())).length;
		if (vague > 0) {
			points -= 5;
			missing.push(`vague step openers made concrete (${vague} steps start with 'handle/fix/improve/…')`);
		}
		dimensions.push({ id: "clarity", label: "Clarity", points: Math.max(0, points), weight: 10, missing });
	}

	const score = dimensions.reduce((sum, d) => sum + d.points, 0);
	const summaryBits: string[] = [`${doc.steps.length} steps`];
	const withFiles = doc.steps.filter((s) => stepNamesFiles(s)).length;
	if (doc.steps.length > 0) summaryBits.push(`${withFiles}/${doc.steps.length} with files`);
	summaryBits.push(`risks ${doc.risks.length}`, `verification ${doc.verification.trim() ? "yes" : "no"}`);
	return {
		score,
		dimensions,
		passes: score >= threshold,
		threshold,
		summary: `${score}/100 — ${summaryBits.join(" · ")}`,
	};
}

// ---------------------------------------------------------------------------
// Plan-file identity (gap P-03)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set(["the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "with", "add"]);

/** Derive a filesystem-safe slug from an objective or seed prompt. */
export function planSlug(seed: string): string {
	const base = seed
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 1 && !STOP_WORDS.has(w))
		.slice(0, 6)
		.join("-");
	const safe = base.replace(/^-+|-+$/g, "").slice(0, 48);
	return safe.length >= 3 ? safe : "plan";
}

/** The per-project plan directory (relative to the project root). */
export const PLANS_DIR = ".unown/plans";

/** Resolve the plan file for a seed: <plansDir>/<slug>.md */
export function planFilePath(plansDir: string, seed: string): string {
	const sep = plansDir.endsWith("/") || plansDir.endsWith("\\") ? "" : "/";
	return `${plansDir}${sep}${planSlug(seed)}.md`;
}

// ---------------------------------------------------------------------------
// The self-critique loop's coaching text (gap P-01 + P-05)
// ---------------------------------------------------------------------------

/** The tool-result coaching: pass → call exit_plan_mode; fail → fix list. */
export function planCritiqueAdvice(score: PlanScore): string {
	if (score.passes) {
		return `Plan scores ${score.score}/100 (>= ${score.threshold}). Call exit_plan_mode to request approval.`;
	}
	const fixes = score.dimensions
		.filter((d) => d.missing.length > 0)
		.map((d) => d.missing.map((m) => `  - [${d.label}] ${m}`).join("\n"))
		.join("\n");
	return `Plan scores ${score.score}/100 (below ${score.threshold}). Fix these dimensions and write the plan again:\n${fixes}`;
}

// ---------------------------------------------------------------------------
// Print-mode report (the JSON envelope's plan block — gap P-04, print lane)
// ---------------------------------------------------------------------------

export interface PlanReport {
	objective: string;
	steps: number;
	stepsWithFiles: number;
	risks: number;
	hasVerification: boolean;
	score: number;
	threshold: number;
	passes: boolean;
	file: string | null;
}

/** Build the envelope/benchmark report row from a scored doc. */
export function planReport(doc: PlanDoc, score: PlanScore, file: string | null): PlanReport {
	return {
		objective: doc.objective,
		steps: doc.steps.length,
		stepsWithFiles: doc.steps.filter((s) => stepNamesFiles(s)).length,
		risks: doc.risks.length,
		hasVerification: doc.verification.trim().length > 0,
		score: score.score,
		threshold: score.threshold,
		passes: score.passes,
		file,
	};
}
