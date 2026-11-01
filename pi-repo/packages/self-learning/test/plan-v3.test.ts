// plan-v3.test.ts — the Plan Mode V3 data model's unit pins (the 2026-11-01
// capability-orchestrator round, docs/plan-mode-v3.md).
//
// Pins:
//   1. the V3 sections parse: capability audit rows (with and without the
//      meta block), specialist verdicts (incl. justified skips), the synthesis
//      block, learning-plan rows, and the retrospective section
//   2. V2 back-compat: a V2 doc parses and renders byte-identically; a V2
//      doc constructed without the V3 fields is still a valid PlanDoc
//   3. render ∘ parse round-trips for a full V3 doc
//   4. scorePlanDocV3: a full-credit doc hits 100 and passes; each new
//      dimension's weak variants lose exactly their points
//   5. the retrospective contract: parse + render + merge + validate rules
//      (failure classification mandatory on non-delivered outcomes; at least
//      one learning or improvement overall)
//   6. hasV3Sections / the vocabulary constants (priority order is contract)
import { describe, expect, test } from "bun:test";
import {
    CAPABILITY_IDS,
    EMPTY_PLAN_DOC,
    FAILURE_CATEGORIES,
    LEARNING_KINDS,
    SPECIALIST_IDS,
    hasV3Sections,
    mergeRetrospectiveIntoMarkdown,
    parsePlanMarkdown,
    renderPlanMarkdown,
    renderRetrospectiveSection,
    scorePlanDoc,
    scorePlanDocV3,
    validateRetrospective,
    V3_MIN_AUDIT_ROWS,
} from "../src/plan.ts";

const AUDIT_ROWS = CAPABILITY_IDS.map(
    (id, i) =>
        `- ${id} — ${i < 3 ? "USED" : "SKIPPED"}: ${i < 3 ? `reuses the ${id} surface for this task` : `no ${id} surface applies here`}` +
        (i < 3 ? ` (relevance: high; benefit: avoids regenerating known context; confidence: ${70 + i})` : ""),
).join("\n");

const FULL_V3_DOC = `# Plan: Add the usage summary command

## Context
Users need a quick token-and-cost rollup without leaving the session. The
/usage report exists but nothing summarizes just this conversation cheaply.

## Capability audit
${AUDIT_ROWS}

## Approach
Reuse the bridge's usage log through a read-only rollup; no new storage.

## Specialist review
### product-strategist — ALIGNED
- The need is real: session-scoped cost is the top request.
### solution-architect — SOUND
- Reading the usage log is cheaper than a new telemetry lane.
### delivery-manager — SKIPPED: single-step delivery, no sequencing risk.

## Synthesis
- consensus: reuse the existing usage log
- conflicts: none — the architect and the strategist agree
- missing: a cap on the rollup window for huge sessions
- confidence: 85

## Steps
1. Add the rollup command reading the usage log (files: src/cli.ts)
2. Wire the session-scoped filter with a window cap (files: src/usage.ts)
3. Cover the cap edge case with a unit test (files: test/usage.test.ts)

## Risks
- A corrupt usage log line crashes the rollup — skip-and-count instead.
- Huge sessions make the rollup slow — cap the window.

## Learning plan
- memory: whether the usage-log skip-and-count pattern recurs elsewhere
- benchmark: rollup latency on a 10k-line usage log

## Verification
bun test test/usage.test.ts
`;

const WEAK_V3_DOC = `# Plan: Untitled plan

## Context
Short.

## Approach

## Steps
1. Do the thing

## Risks

## Verification
Maybe check it later.
`;

function fullDoc() {
    return parsePlanMarkdown(FULL_V3_DOC);
}

describe("plan V3 — vocabulary", () => {
    test("the capability priority order is the contract (memory first, new-solution-creation last)", () => {
        expect(CAPABILITY_IDS[0]).toBe("tiered-memory");
        expect(CAPABILITY_IDS).toHaveLength(11);
        expect(new Set(CAPABILITY_IDS).size).toBe(CAPABILITY_IDS.length);
    });
    test("the specialist bench ids match the built-in roster names", () => {
        expect(SPECIALIST_IDS).toEqual([
            "product-strategist",
            "solution-architect",
            "delivery-manager",
            "qa-architect",
            "devils-advocate",
            "learning-analyst",
            "memory-auditor",
            "skill-architect",
        ]);
    });
    test("the learning lanes and failure categories are closed sets", () => {
        expect(LEARNING_KINDS).toHaveLength(7);
        expect(FAILURE_CATEGORIES).toHaveLength(8);
    });
});

describe("plan V3 — parser", () => {
    test("parses the capability audit: decisions, reasons, meta block", () => {
        const doc = fullDoc();
        expect(doc.capabilityAudit).toHaveLength(11);
        const first = doc.capabilityAudit![0];
        expect(first.capability).toBe("tiered-memory");
        expect(first.decision).toBe("used");
        expect(first.relevance).toBe("high");
        expect(first.benefit).toBe("avoids regenerating known context");
        expect(first.confidence).toBe(70);
        const skipped = doc.capabilityAudit![4];
        expect(skipped.capability).toBe("routines");
        expect(skipped.decision).toBe("skipped");
        expect(skipped.reason).toContain("no routines surface applies");
        expect(skipped.relevance).toBeUndefined();
    });
    test("parses specialist verdicts with points and justified skips", () => {
        const doc = fullDoc();
        expect(doc.specialistReview).toHaveLength(3);
        const [strategist, architect, delivery] = doc.specialistReview!;
        expect(strategist.specialist).toBe("product-strategist");
        expect(strategist.verdict).toBe("ALIGNED");
        expect(strategist.skipped).toBe(false);
        expect(strategist.points).toHaveLength(1);
        expect(architect.verdict).toBe("SOUND");
        expect(delivery.skipped).toBe(true);
        expect(delivery.verdict).toContain("SKIPPED: single-step delivery");
    });
    test("parses the synthesis block incl. the 0-100 confidence", () => {
        const doc = fullDoc();
        expect(doc.synthesis).not.toBeNull();
        expect(doc.synthesis!.consensus).toContain("reuse the existing usage log");
        expect(doc.synthesis!.conflicts).toContain("none");
        expect(doc.synthesis!.missing).toContain("cap on the rollup window");
        expect(doc.synthesis!.confidence).toBe(85);
    });
    test("parses learning-plan rows into lane/what pairs", () => {
        const doc = fullDoc();
        expect(doc.learningPlan).toHaveLength(2);
        expect(doc.learningPlan![0]).toEqual({
            kind: "memory",
            what: "whether the usage-log skip-and-count pattern recurs elsewhere",
        });
        expect(doc.learningPlan![1].kind).toBe("benchmark");
    });
    test("V2 sections still parse alongside the V3 sections", () => {
        const doc = fullDoc();
        expect(doc.objective).toBe("Add the usage summary command");
        expect(doc.steps).toHaveLength(3);
        expect(doc.steps[0].files).toContain("src/cli.ts");
        expect(doc.risks).toHaveLength(2);
        expect(doc.verification).toContain("bun test");
    });
    test("a bare hyphen and a missing meta block still parse (tolerant grammar)", () => {
        const doc = parsePlanMarkdown(
            ["# Plan: X", "", "## Capability audit", "", "- tiered-memory - USED: it has the convention", "- repo-map — SKIPPED: trivial scope", ""].join("\n"),
        );
        expect(doc.capabilityAudit).toHaveLength(2);
        expect(doc.capabilityAudit![0].decision).toBe("used");
        expect(doc.capabilityAudit![0].confidence).toBeUndefined();
        expect(doc.capabilityAudit![1].decision).toBe("skipped");
    });
});

const V2_DOC = `# Plan: Add the export button

## Context

The dashboard needs an export button next to the filter bar.

## Approach

Add a button component wired to the existing export API endpoint.

## Steps

1. Add the button component (files: \`src/button.tsx\`)
2. Wire the click handler to the export API (files: \`src/dashboard.tsx\`)

## Risks

- API rate limits under large exports.

## Verification

- bun test src
`;

describe("plan V3 — V2 back-compat", () => {
    test("a V2 doc parses and renders byte-identically (no V3 noise)", () => {
        const doc = parsePlanMarkdown(V2_DOC);
        expect(hasV3Sections(doc)).toBe(false);
        expect(renderPlanMarkdown(doc)).toBe(V2_DOC);
    });
    test("a V2-shaped PlanDoc literal (no V3 fields) stays type- and score-valid", () => {
        const legacy = { ...EMPTY_PLAN_DOC, capabilityAudit: undefined, specialistReview: undefined };
        expect(scorePlanDoc(legacy).score).toBeGreaterThanOrEqual(0);
        expect(scorePlanDocV3(legacy).score).toBeLessThan(30);
    });
});

describe("plan V3 — round-trip", () => {
    test("parse ∘ render is stable for a full V3 doc (minus the retrospective)", () => {
        const doc = fullDoc();
        const rendered = renderPlanMarkdown(doc);
        const reparsed = parsePlanMarkdown(rendered);
        expect(reparsed.capabilityAudit).toHaveLength(doc.capabilityAudit!.length);
        expect(reparsed.specialistReview!.map((v) => v.verdict)).toEqual(
            doc.specialistReview!.map((v) => v.verdict),
        );
        expect(reparsed.synthesis?.confidence).toBe(85);
        expect(reparsed.learningPlan).toHaveLength(2);
        expect(renderPlanMarkdown(reparsed)).toBe(rendered);
    });
});

describe("plan V3 — scorePlanDocV3", () => {
    test("the full-credit doc scores 100/100 and passes", () => {
        const score = scorePlanDocV3(fullDoc());
        expect(score.score).toBe(100);
        expect(score.passes).toBe(true);
        expect(score.dimensions).toHaveLength(10);
        expect(score.dimensions.reduce((s, d) => s + d.weight, 0)).toBe(100);
        expect(score.summary).toContain("audit 3/11 used");
        expect(score.summary).toContain("3 specialist verdicts");
    });
    test("the weak doc fails with every new dimension flagged", () => {
        const score = scorePlanDocV3(parsePlanMarkdown(WEAK_V3_DOC));
        expect(score.passes).toBe(false);
        const flagged = new Set(score.dimensions.filter((d) => d.missing.length > 0).map((d) => d.id));
        expect(flagged.has("capability-audit")).toBe(true);
        expect(flagged.has("specialist-review")).toBe(true);
        expect(flagged.has("learning-plan")).toBe(true);
    });
    test("an audit below the row floor loses the row points; all-skipped loses the USED points", () => {
        const doc = fullDoc();
        const short = { ...doc, capabilityAudit: doc.capabilityAudit!.slice(0, 4) };
        const shortScore = scorePlanDocV3(short);
        const auditDim = shortScore.dimensions.find((d) => d.id === "capability-audit")!;
        expect(auditDim.points).toBe(5); // reasons ok (3) + USED row (2), rows short
        expect(auditDim.missing.some((m) => m.includes("capability rows"))).toBe(true);

        const allSkipped = {
            ...doc,
            capabilityAudit: doc.capabilityAudit!.map((r) => ({ ...r, decision: "skipped" as const })),
        };
        const noUsed = scorePlanDocV3(allSkipped).dimensions.find((d) => d.id === "capability-audit")!;
        expect(noUsed.points).toBe(6); // rows (3) + reasons (3)
    });
    test("specialist depth scales with plan size (6+ steps need 2 verdicts)", () => {
        const doc = fullDoc(); // 3 steps → 1 verdict is enough
        const threeStepsOneVerdict = { ...doc, specialistReview: doc.specialistReview!.slice(0, 1) };
        const s1 = scorePlanDocV3(threeStepsOneVerdict).dimensions.find((d) => d.id === "specialist-review")!;
        expect(s1.points).toBe(8);

        const sixSteps = {
                ...doc,
                steps: [...doc.steps, ...doc.steps.map((s) => ({ ...s, text: `Again: ${s.text}` }))].map((s, i) => ({ ...s, step: i + 1 })),
        };
        expect(sixSteps.steps).toHaveLength(6);
        const s2 = scorePlanDocV3({ ...sixSteps, specialistReview: doc.specialistReview!.slice(0, 1) }).dimensions.find(
            (d) => d.id === "specialist-review",
        )!;
        expect(s2.points).toBe(5); // first verdict (3) + synthesis (2), depth missing
        expect(s2.missing.some((m) => m.includes("second specialist verdict"))).toBe(true);
    });
    test("a bad learning lane loses the lane points", () => {
        const doc = fullDoc();
        const bad = { ...doc, learningPlan: [{ kind: "vibes", what: "something vague" }, ...doc.learningPlan!] };
        const dim = scorePlanDocV3(bad).dimensions.find((d) => d.id === "learning-plan")!;
        expect(dim.points).toBe(2);
    });
    test("V3_MIN_AUDIT_ROWS is the documented floor (8 of 11)", () => {
        expect(V3_MIN_AUDIT_ROWS).toBe(8);
    });
});

describe("plan V3 — the retrospective contract", () => {
    const RETRO = {
        outcome: "partial" as const,
        failureClass: "execution",
        rootCause: "the usage-log reader assumed a stable column count",
        resolution: "switched to tolerant parsing with skip-and-count",
        prevention: "pin the tolerant parser with a unit test before merging",
        learnings: [
            { kind: "memory", what: "usage-log lines vary in column count — always parse tolerantly" },
            { kind: "benchmark", what: "rollup over a deliberately malformed log fixture" },
        ],
        improvements: ["plan mode: surface a log-format check in the capability audit"],
    };

    test("renders and re-parses through the plan doc", () => {
        const md = renderRetrospectiveSection(RETRO);
        expect(md).toContain("- outcome: partial");
        expect(md).toContain("- failure class: execution");
        const doc = parsePlanMarkdown(`${FULL_V3_DOC}\n${md}\n`);
        expect(doc.retrospective).not.toBeNull();
        expect(doc.retrospective!.outcome).toBe("partial");
        expect(doc.retrospective!.failureClass).toBe("execution");
        expect(doc.retrospective!.learnings).toHaveLength(2);
        expect(doc.retrospective!.improvements).toHaveLength(1);
        expect(renderRetrospectiveSection(doc.retrospective!)).toBe(md);
    });
    test("merge is surgical: replaces an existing section, keeps the plan bytes", () => {
        const planWithOldRetro = `${FULL_V3_DOC}\n## Retrospective\n\n- outcome: failed\n`;
        const merged = mergeRetrospectiveIntoMarkdown(planWithOldRetro, RETRO);
        expect(merged).toContain("- outcome: partial");
        expect(merged).not.toContain("- outcome: failed");
        expect(merged.indexOf("## Retrospective")).toBeGreaterThan(merged.indexOf("## Verification"));
        expect(merged).toContain("# Plan: Add the usage summary command");
        // the original sections survive untouched
        expect(merged).toContain("### solution-architect — SOUND");
        expect(merged).toContain("bun test test/usage.test.ts");
        // and a re-merge is idempotent
        expect(mergeRetrospectiveIntoMarkdown(merged, RETRO)).toBe(merged);
    });
    test("validate: a delivered outcome needs no failure class; a partial one needs class + root cause + prevention", () => {
        expect(validateRetrospective({ ...RETRO, outcome: "delivered", failureClass: "none" })).toEqual([]);
        const problems = validateRetrospective({ ...RETRO, failureClass: "mystery" });
        expect(problems.some((p) => p.includes("failure class"))).toBe(true);
        const noRoot = validateRetrospective({ ...RETRO, rootCause: "" });
        expect(noRoot.some((p) => p.includes("root cause"))).toBe(true);
        const noPrevention = validateRetrospective({ ...RETRO, prevention: "" });
        expect(noPrevention.some((p) => p.includes("preventative action"))).toBe(true);
    });
    test("validate: nothing extracted is a failed retrospective (learning is the objective)", () => {
        const problems = validateRetrospective({ ...RETRO, learnings: [], improvements: [] });
        expect(problems.some((p) => p.includes("at least one learning candidate or one improvement"))).toBe(true);
    });
    test("validate: bad learning lanes are rejected", () => {
        const problems = validateRetrospective({ ...RETRO, learnings: [{ kind: "notes", what: "remember things" }] });
        expect(problems.some((p) => p.includes("real lane"))).toBe(true);
    });
    test("validate: null retrospectives report the parse failure", () => {
        expect(validateRetrospective(null)[0]).toContain("no retrospective content parsed");
    });
});
