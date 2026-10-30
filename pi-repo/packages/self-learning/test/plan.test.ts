// Unit tests for src/plan.ts — the Plan Mode V2 data model (the 2026-10-31
// planning round, benchmarks/plan-mode/GAP-REGISTER.md):
//
//   - parsePlanMarkdown: the sectioned format (Objective/Context/Approach/
//     Steps/Risks/Verification/Open questions), the legacy "Plan:" + numbered
//     list format, code-fence immunity, file annotations (gap P-02)
//   - renderPlanMarkdown: deterministic round-trip
//   - extractPlanDoc: tolerant extraction with the MIN_STEPS floor
//   - markCompletedSteps / rescanCompletedSteps: [DONE:n] tracking + the
//     crash-tail re-scan the pi example had (gap P-10)
//   - scorePlanDoc: the deterministic 7-dimension rubric — a good plan passes,
//     the documented weak plans fail their exact dimensions (gap P-05)
//   - planSlug / planFilePath: plan-file identity (gap P-03)
//   - planCritiqueAdvice: the self-critique loop's coaching text (gap P-01)
//
// These tests run on `bun test` (bun:test is built in — zero new deps).
import { describe, expect, test } from "bun:test";
import {
	EMPTY_PLAN_DOC,
	extractPlanDoc,
	extractPlanSteps,
	MIN_STEPS,
	markCompletedSteps,
	PLAN_SCORE_THRESHOLD_DEFAULT,
	parsePlanMarkdown,
	planCritiqueAdvice,
	planFilePath,
	planReport,
	planSlug,
	renderPlanMarkdown,
	rescanCompletedSteps,
	scorePlanDoc,
	stepNamesFiles,
} from "../src/plan.ts";

const GOOD_PLAN = `# Plan: Add a /theme slash command

## Context

The TUI ships several color themes but switching one requires hand-editing
settings.json. A /theme command would list, apply, and persist the choice so
the next session starts with the selected theme.

## Approach

Register a new slash command through the extension API that reads the theme
directory, applies the selection via the theme manager, and writes the user
settings file. Reuse the existing settings writer rather than adding a new
persistence path.

## Steps

1. Add the /theme command registration in the extension entry (files: src/tools.ts)
2. Implement theme listing by scanning the theme directory for json files
3. Apply the selected theme through the theme manager and refresh the footer
4. Persist the choice into the user settings file (files: ~/.pi/settings.json)
5. Add tests for list, apply, and persist behaviors (files: test/theme.test.ts)

## Risks

- An invalid theme name must fall back to the current theme instead of crashing the TUI
- Settings write races with a concurrent /reload — write atomically (tmp + rename)

## Verification

\`\`\`
bun test test/theme.test.ts
bun bin/unown --help
\`\`\`
`;

const LEGACY_PLAN = `Here is what I would do.

Plan:
1. First add the command handler in tools.ts
2. Then wire the persistence layer into settings.json
3. Finally add unit tests for the new command
`;

describe("parsePlanMarkdown — the sectioned format", () => {
	test("parses every section of a well-formed plan", () => {
		const doc = parsePlanMarkdown(GOOD_PLAN);
		expect(doc.objective).toBe("Add a /theme slash command");
		expect(doc.context.length).toBeGreaterThan(30);
		expect(doc.approach.length).toBeGreaterThan(30);
		expect(doc.steps.length).toBe(5);
		expect(doc.steps[0].text).toContain("/theme command registration");
		expect(doc.steps[0].files).toEqual(["src/tools.ts"]);
		expect(doc.steps[1].files).toEqual([]);
		expect(doc.risks.length).toBe(2);
		expect(doc.verification).toContain("bun test test/theme.test.ts");
		expect(doc.openQuestions).toEqual([]);
	});

	test("accepts bold headers, ## Testing and validation, and Objective:", () => {
		const md = [
			"**Objective:** Support bold headers",
			"**Context**",
			"A long enough context paragraph for the parse.",
			"**Approach**",
			"An approach paragraph that is also long enough.",
			"**Implementation Steps**",
			"1. One first step that is descriptive",
			"2. A second step that is descriptive",
			"3. A third step that is descriptive",
			"**Risks and Mitigations**",
			"- The risk of something breaking badly",
			"**Testing and Validation**",
			"run `bun test` and check output",
		].join("\n");
		const doc = parsePlanMarkdown(md);
		expect(doc.objective).toBe("Support bold headers");
		expect(doc.steps.length).toBe(3);
		expect(doc.risks).toEqual(["The risk of something breaking badly"]);
		expect(doc.verification).toContain("bun test");
	});

	test("code fences never leak into sections", () => {
		const md = [
			"# Plan: Fence immunity",
			"## Verification",
			"```",
			"1. this numbered line is inside a fence",
			"## Steps",
			"```",
			"real verification: bun test",
		].join("\n");
		const doc = parsePlanMarkdown(md);
		expect(doc.steps).toEqual([]);
		expect(doc.verification).toContain("real verification");
	});

	test("legacy Plan: header + numbered list still parses (pre-V2 transcripts)", () => {
		const doc = parsePlanMarkdown(LEGACY_PLAN);
		expect(doc.steps.length).toBe(3);
		expect(doc.objective).toBe("Untitled plan");
	});

	test("empty input parses to an empty doc", () => {
		const doc = parsePlanMarkdown("");
		expect(doc).toEqual(EMPTY_PLAN_DOC);
	});
});

describe("renderPlanMarkdown — deterministic round-trip", () => {
	test("parse(render(doc)) is stable for a well-formed doc", () => {
		const parsed = parsePlanMarkdown(GOOD_PLAN);
		const rendered = renderPlanMarkdown(parsed);
		const reparsed = parsePlanMarkdown(rendered);
		expect(reparsed.objective).toBe(parsed.objective);
		expect(reparsed.steps.map((s) => s.text)).toEqual(parsed.steps.map((s) => s.text));
		expect(reparsed.steps.map((s) => s.files)).toEqual(parsed.steps.map((s) => s.files));
		expect(reparsed.risks).toEqual(parsed.risks);
		expect(reparsed.verification).toContain("bun test");
	});

	test("renders file annotations in the canonical (files: a, b) form", () => {
		const md = renderPlanMarkdown({
			...EMPTY_PLAN_DOC,
			objective: "x",
			steps: [{ step: 1, text: "Do the thing", files: ["a.ts", "b/c.ts"], completed: false }],
		});
		expect(md).toContain("1. Do the thing (files: `a.ts`, `b/c.ts`)");
	});
});

describe("extractPlanDoc — tolerant extraction", () => {
	test("extracts a sectioned plan from surrounding chatter", () => {
		const doc = extractPlanDoc(`Some intro text.\n\n${GOOD_PLAN}\n\nSome outro text.`);
		expect(doc?.steps.length).toBe(5);
		expect(doc?.objective).toBe("Add a /theme slash command");
	});

	test("returns null below the MIN_STEPS floor", () => {
		expect(extractPlanDoc("no plan here at all")).toBeNull();
		expect(MIN_STEPS).toBe(2);
		const oneStep = "Plan:\n1. Only one lonely step that exists";
		expect(extractPlanDoc(oneStep)).toBeNull();
	});

	test("legacy extractor still powers old transcripts", () => {
		const steps = extractPlanSteps(LEGACY_PLAN);
		expect(steps.length).toBe(3);
		expect(steps[0].text).toContain("command handler");
	});
});

describe("markCompletedSteps / rescanCompletedSteps — progress tracking", () => {
	const items = () => [
		{ step: 1, text: "First", files: [], completed: false },
		{ step: 2, text: "Second", files: [], completed: false },
	];

	test("marks [DONE:n] tags once each", () => {
		const list = items();
		expect(markCompletedSteps("did it [DONE:1]", list)).toBe(1);
		expect(markCompletedSteps("again [DONE:1] [done:2]", list)).toBe(1);
		expect(list[0].completed).toBe(true);
		expect(list[1].completed).toBe(true);
	});

	test("re-scan only counts messages after the LAST execute marker (gap P-10)", () => {
		const list = items();
		const transcript = [
			{ role: "user", text: "unown-plan-execute — go" },
			{ role: "assistant", text: "step one done [DONE:1] — before the re-send" },
			{ role: "user", text: "unown-plan-execute re-sent" },
			{ role: "assistant", text: "planning again, nothing completed yet" },
		];
		// The [DONE:1] sits BEFORE the last execute marker — it must not count.
		expect(rescanCompletedSteps(transcript, list)).toBe(0);
		expect(list[0].completed).toBe(false);
	});

	test("re-scan marks crash-tail completions the persisted entry missed", () => {
		const list = items();
		const transcript = [
			{ role: "user", text: "unown-plan-execute — go" },
			{ role: "assistant", text: "step one done [DONE:1]" },
			{ role: "assistant", text: "step two done too [DONE:2]" },
		];
		expect(rescanCompletedSteps(transcript, list)).toBe(2);
		expect(list.every((i) => i.completed)).toBe(true);
	});
});

describe("scorePlanDoc — the deterministic rubric (gap P-05)", () => {
	test("a good plan passes the threshold", () => {
		const score = scorePlanDoc(parsePlanMarkdown(GOOD_PLAN));
		expect(score.score).toBeGreaterThanOrEqual(PLAN_SCORE_THRESHOLD_DEFAULT);
		expect(score.passes).toBe(true);
		expect(score.threshold).toBe(PLAN_SCORE_THRESHOLD_DEFAULT);
		// Exact dimension weights: 10+10+10+30+15+15+10 = 100.
		expect(score.dimensions.reduce((sum, d) => sum + d.weight, 0)).toBe(100);
	});

	test("an empty plan scores zero with every dimension's fix listed", () => {
		const score = scorePlanDoc(EMPTY_PLAN_DOC);
		expect(score.score).toBe(0);
		expect(score.passes).toBe(false);
		expect(score.dimensions.every((d) => d.points === 0)).toBe(true);
		expect(score.summary).toContain("0/100");
	});

	test("the legacy numbered list alone fails the exact expected dimensions", () => {
		const doc = parsePlanMarkdown(LEGACY_PLAN);
		const score = scorePlanDoc(doc);
		// Steps (30) earned; objective ("Untitled plan", 0/10), context 0/10,
		// approach 0/10, risks 0/15, verification 0/15, clarity 10/10 → 40.
		expect(score.score).toBe(40);
		const byId = Object.fromEntries(score.dimensions.map((d) => [d.id, d]));
		expect(byId.objective.points).toBe(0);
		expect(byId.steps.points).toBe(30);
		expect(byId.clarity.points).toBe(10);
	});

	test("placeholder text and vague openers cost clarity points", () => {
		const doc = parsePlanMarkdown(
			[
				"# Plan: Vague work",
				"## Context",
				"some context words here to reach the count needed for full points surely",
				"## Approach",
				"some approach words here to reach the count needed for full points",
				"## Steps",
				"1. Handle the TODO items in the parser (files: src/a.ts)",
				"2. Fix the remaining things in the writer (files: src/b.ts)",
				"3. Improve the tests overall (files: test/a.test.ts)",
				"## Risks",
				"- risk one that is real",
				"- risk two that is real",
				"## Verification",
				"run `bun test` now",
			].join("\n"),
		);
		const score = scorePlanDoc(doc);
		const clarity = score.dimensions.find((d) => d.id === "clarity");
		expect(clarity?.points).toBe(0);
		expect(clarity?.missing.join(" ")).toContain("placeholder");
		expect(clarity?.missing.join(" ")).toContain("vague");
	});

	test("verification without a runnable command loses the command points", () => {
		const doc = parsePlanMarkdown(
			[
				"# Plan: Verify me",
				"## Context",
				"some context words here to reach the count needed for full points surely",
				"## Approach",
				"some approach words here to reach the count needed for full points",
				"## Steps",
				"1. One real step that is descriptive enough",
				"2. Another real step that is descriptive enough",
				"3. A third real step that is descriptive enough",
				"## Risks",
				"- one real risk with a mitigation plan",
				"- another real risk with a mitigation",
				"## Verification",
				"check that it all looks correct manually",
			].join("\n"),
		);
		const score = scorePlanDoc(doc);
		const verification = score.dimensions.find((d) => d.id === "verification");
		expect(verification?.points).toBe(7);
		expect(verification?.missing[0]).toContain("command");
	});
});

describe("planSlug / planFilePath — plan-file identity (gap P-03)", () => {
	test("slugs are filesystem-safe and stop-word filtered", () => {
		expect(planSlug("Add a /theme slash command for the TUI")).toBe("theme-slash-command-tui");
		expect(planSlug("Fix: the crash!!")).toBe("fix-crash");
		expect(planSlug("")).toBe("plan");
	});

	test("planFilePath joins the plans dir and slug", () => {
		expect(planFilePath(".unown/plans", "Add a /theme slash command")).toBe(".unown/plans/theme-slash-command.md");
		expect(planFilePath(".unown/plans/", "x")).toBe(".unown/plans/plan.md");
	});
});

describe("planCritiqueAdvice — the self-critique loop (gap P-01)", () => {
	test("a passing score tells the model to exit plan mode", () => {
		const score = scorePlanDoc(parsePlanMarkdown(GOOD_PLAN));
		expect(planCritiqueAdvice(score)).toContain("exit_plan_mode");
	});

	test("a failing score lists the dimensions to fix", () => {
		const score = scorePlanDoc(EMPTY_PLAN_DOC);
		const advice = planCritiqueAdvice(score);
		expect(advice).toContain("below");
		expect(advice).toContain("[Objective]");
		expect(advice).toContain("[Verification]");
	});
});

describe("stepNamesFiles / planReport — shared helpers", () => {
	test("file annotations, inline paths and bare filenames all count", () => {
		expect(stepNamesFiles({ step: 1, text: "Edit the entry", files: ["a.ts"], completed: false })).toBe(true);
		expect(stepNamesFiles({ step: 1, text: "Edit src/tools.ts directly", files: [], completed: false })).toBe(true);
		expect(stepNamesFiles({ step: 1, text: "Rename the variable", files: [], completed: false })).toBe(false);
	});

	test("planReport carries the receipt fields", () => {
		const doc = parsePlanMarkdown(GOOD_PLAN);
		const score = scorePlanDoc(doc);
		const report = planReport(doc, score, ".unown/plans/theme-slash-command.md");
		expect(report.objective).toBe("Add a /theme slash command");
		expect(report.steps).toBe(5);
		expect(report.stepsWithFiles).toBe(3);
		expect(report.risks).toBe(2);
		expect(report.hasVerification).toBe(true);
		expect(report.passes).toBe(true);
		expect(report.file).toBe(".unown/plans/theme-slash-command.md");
	});
});
