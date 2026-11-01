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
        // ---- Plan Mode V3 (the 2026-11-01 capability-orchestrator round,
        // docs/plan-mode-v3.md): four planning sections + the post-execution
        // retrospective. OPTIONAL — a V2 doc (and every V2 constructor) stays
        // type-valid and renders byte-identically; the V3 scorer is the only
        // consumer that demands them.
        /** The pre-design capability audit (priority order, one row per capability). */
        capabilityAudit?: PlanCapabilityRow[];
        /** Specialist verdicts from the planning bench (or justified skips). */
        specialistReview?: PlanSpecialistVerdict[];
        /** The synthesis of the specialist reviews. */
        synthesis?: PlanSynthesis | null;
        /** What this run should learn or validate (the learning objective). */
        learningPlan?: PlanLearningCandidate[];
        /** Filled after execution by plan_retrospective — never by plan_write. */
        retrospective?: PlanRetrospective | null;
}

export const EMPTY_PLAN_DOC: PlanDoc = {
        objective: "",
        context: "",
        approach: "",
        steps: [],
        risks: [],
        verification: "",
        openQuestions: [],
        capabilityAudit: [],
        specialistReview: [],
        synthesis: null,
        learningPlan: [],
        retrospective: null,
};

// ---------------------------------------------------------------------------
// Plan Mode V3 — the capability orchestrator's vocabulary
// (docs/plan-mode-v3.md — the 2026-11-01 round)
// ---------------------------------------------------------------------------

/** The auditable capabilities, in the priority order the orchestrator must
 *  evaluate them: reuse first, new-solution-creation last. Each id names a
 *  concrete surface the planning agent can actually consult in-session. */
export const CAPABILITY_IDS = [
        "tiered-memory", // .unown/memory/ (injected) + /memory search
        "existing-skills", // .unown/skills/**/SKILL.md
        "workflows", // repeatable execution patterns (docs + prior plans)
        "standing-orders", // ## Program: sections (durable authority)
        "routines", // scheduled recurring runs (unown routines)
        "repo-map", // the graph-ranked symbol map (unown repomap)
        "project-context", // AGENTS.md chain + README + docs
        "prior-learnings", // session notes / dream journals / receipts
        "benchmarks", // benchmarks/** + their committed receipts
        "agent-patterns", // delegation structures that worked before
        "subagent-delegation", // the specialist bench itself
] as const;

/** The planning-phase specialist bench (product → architecture → delivery →
 *  QA → challenge; the last three serve the retrospective lane). Same ids as
 *  the PLANNING_BUILTIN_AGENTS roster in subagent-builtins.ts. */
export const SPECIALIST_IDS = [
        "product-strategist",
        "solution-architect",
        "delivery-manager",
        "qa-architect",
        "devils-advocate",
        "learning-analyst",
        "memory-auditor",
        "skill-architect",
] as const;

/** Where a learning candidate lands — every lane is a real Unown surface. */
export const LEARNING_KINDS = [
        "memory",
        "skill",
        "workflow",
        "routine",
        "standing-order",
        "benchmark",
        "agent-pattern",
] as const;

/** The failure taxonomy (the retrospective's classification lane). */
export const FAILURE_CATEGORIES = [
        "plan", // the plan was incomplete
        "memory", // relevant knowledge was not available or retrieved
        "skill", // existing capabilities were insufficient
        "delegation", // incorrect agent selection
        "context", // insufficient context supplied
        "execution", // plan was correct but implementation failed
        "review", // issue should have been detected earlier
        "external", // outside system control
] as const;

export interface PlanCapabilityRow {
        /** A CAPABILITY_IDS member (tolerant: unknown ids parse, flagged by the scorer). */
        capability: string;
        /** USED = leveraged in this plan; SKIPPED = evaluated and not used. */
        decision: "used" | "skipped";
        /** Why that decision — one line, specific to THIS task. */
        reason: string;
        /** low | medium | high (free text tolerated by the parser). */
        relevance?: string;
        /** The expected benefit when used. */
        benefit?: string;
        /** 0-100. */
        confidence?: number | null;
}

export interface PlanSpecialistVerdict {
        /** A SPECIALIST_IDS member (tolerant parse). */
        specialist: string;
        /** The headline verdict ("ALIGNED", "CONCERNS", "SKIPPED: trivial scope", …). */
        verdict: string;
        /** The key findings that back the verdict. */
        points: string[];
        /** True when the verdict is a justified skip (starts with SKIPPED). */
        skipped: boolean;
}

export interface PlanSynthesis {
        /** Where the reviews agree. */
        consensus: string;
        /** Disagreements + the orchestrator's ruling. */
        conflicts: string;
        /** Considerations the reviews surfaced that the draft missed. */
        missing: string;
        /** 0-100 — the orchestrator's confidence AFTER synthesis. */
        confidence: number | null;
}

export interface PlanLearningCandidate {
        /** A LEARNING_KINDS member. */
        kind: string;
        /** What to remember / validate / measure — concrete, one line. */
        what: string;
}

export interface PlanRetrospective {
        /** delivered | partial | failed. */
        outcome: "delivered" | "partial" | "failed";
        /** A FAILURE_CATEGORIES member, or "none" when outcome === "delivered". */
        failureClass: string;
        /** The root cause (required when the outcome is not "delivered"). */
        rootCause: string;
        /** How it was resolved. */
        resolution: string;
        /** The preventative action — what future runs change. */
        prevention: string;
        /** Learning candidates promoted out of this run. */
        learnings: PlanLearningCandidate[];
        /** Improvement lines (plan mode / memory / skills / workflows / agents / …). */
        improvements: string[];
}

/** True when the doc carries any V3 planning section (selects the V3 scorer). */
export function hasV3Sections(doc: PlanDoc): boolean {
        return (
                (doc.capabilityAudit?.length ?? 0) > 0 ||
                (doc.specialistReview?.length ?? 0) > 0 ||
                (doc.learningPlan?.length ?? 0) > 0 ||
                doc.synthesis != null
        );
}

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
// ---- Plan Mode V3 section headers (the 2026-11-01 round). Same tolerant
// grammar as the V2 headers: emphasis-stripped, optional colons.
const CAPABILITY_HEADER = /^#{0,3}\s*(?:\*\*)?capability\s+audit(?:\*\*)?\s*[::]?$/i;
const SPECIALIST_HEADER = /^#{0,3}\s*(?:\*\*)?specialist\s+review(?:\*\*)?\s*[::]?$/i;
const SYNTHESIS_HEADER = /^#{0,3}\s*(?:\*\*)?synthesis(?:\*\*)?\s*[::]?$/i;
const LEARNING_HEADER = /^#{0,3}\s*(?:\*\*)?learning\s+plan(?:\*\*)?\s*[::]?$/i;
const RETROSPECTIVE_HEADER = /^#{0,3}\s*(?:\*\*)?retrospective(?:\*\*)?\s*[::]?$/i;

/** V3 capability-row grammar: `- tiered-memory — USED: reason (relevance:
 *  high; benefit: …; confidence: 80)`. The em-dash family and a bare hyphen
 *  both parse; the parenthesised meta block is optional (fields default). */
const CAPABILITY_ROW = /^-\s*([a-z0-9][a-z0-9-]*)\s*(?:\u2014|--|-)\s*(USED|SKIPPED)\s*:\s*(.+)$/i;
const CAPABILITY_META = /\(([^()]*)\)\s*$/;
/** V3 specialist-verdict grammar: `### product-strategist — ALIGNED`. */
const SPECIALIST_ROW = /^#{2,4}\s+([a-z0-9][a-z0-9-]*)\s*(?:\u2014|--|-)\s+(.+)$/i;
/** V3 synthesis / retrospective key lines: `- consensus: …`. */
const KEY_LINE = /^-\s*([a-z][a-z\s-]*?)\s*:\s*(.+)$/i;

type ParagraphSection = "context" | "approach" | "verification";
type ListSection = "risks" | "openQuestions";
type V3Section = "capabilityAudit" | "specialistReview" | "synthesis" | "learningPlan" | "retrospective";
type Section = ParagraphSection | "steps" | ListSection | V3Section | "none";

const STEP_LINE = /^\s*(\d+)[.)]\s+(.+)$/;

/** Parse one V3 capability row's trailing meta block:
 *  `(relevance: high; benefit: …; confidence: 80)` — every field optional. */
function parseCapabilityRow(capability: string, decision: string, rest: string): PlanCapabilityRow {
        let reason = rest.trim();
        let relevance: string | undefined;
        let benefit: string | undefined;
        let confidence: number | null | undefined;
        const metaMatch = reason.match(CAPABILITY_META);
        if (metaMatch) {
                reason = reason.slice(0, metaMatch.index).trim();
                for (const field of metaMatch[1].split(/;/)) {
                        const pair = field.match(/^\s*([a-z]+)\s*:\s*(.+?)\s*$/i);
                        if (!pair) continue;
                        const key = pair[1].toLowerCase();
                        const value = pair[2].trim();
                        if (key === "relevance") relevance = value.toLowerCase();
                        else if (key === "benefit") benefit = value;
                        else if (key === "confidence") {
                                const n = Number(value.replace(/[^0-9]/g, ""));
                                confidence = Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
                        }
                }
        }
        return {
                capability: capability.toLowerCase(),
                decision: decision.toUpperCase() === "USED" ? "used" : "skipped",
                reason: cleanLine(reason),
                relevance,
                benefit,
                confidence,
        };
}

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
                capabilityAudit: [],
                specialistReview: [],
                synthesis: null,
                learningPlan: [],
                retrospective: null,
        };
        const lines = markdown.split(/\r?\n/);
        let section: Section = "none";
        const paragraphs = new Map<ParagraphSection, string[]>();
        // V3 parsing state — one entry per V3 section, flushed like the rest.
        let currentSpecialist: PlanSpecialistVerdict | null = null;
        let retrospectiveLearnings = false;
        let retrospectiveImprovements = false;

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
                if (currentSpecialist) {
                        if (!doc.specialistReview) doc.specialistReview = [];
                        doc.specialistReview.push(currentSpecialist);
                        currentSpecialist = null;
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
                // ---- V3 headers (the capability-orchestrator round). A header
                // also closes the in-flight specialist verdict.
                if (CAPABILITY_HEADER.test(plain)) {
                        flush();
                        section = "capabilityAudit";
                        continue;
                }
                if (SPECIALIST_HEADER.test(plain)) {
                        flush();
                        section = "specialistReview";
                        continue;
                }
                if (SYNTHESIS_HEADER.test(plain)) {
                        flush();
                        section = "synthesis";
                        continue;
                }
                if (LEARNING_HEADER.test(plain)) {
                        flush();
                        section = "learningPlan";
                        continue;
                }
                if (RETROSPECTIVE_HEADER.test(plain)) {
                        flush();
                        section = "retrospective";
                        retrospectiveLearnings = false;
                        retrospectiveImprovements = false;
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
                } else if (section === "capabilityAudit") {
                        const m = plain.match(CAPABILITY_ROW);
                        if (m) {
                                const row = parseCapabilityRow(m[1], m[2], m[3]);
                                if (!doc.capabilityAudit) doc.capabilityAudit = [];
                                doc.capabilityAudit.push(row);
                        }
                } else if (section === "specialistReview") {
                        const m = stripped.match(SPECIALIST_ROW);
                        if (m) {
                                // A new verdict header closes the previous verdict.
                                if (currentSpecialist) {
                                        if (!doc.specialistReview) doc.specialistReview = [];
                                        doc.specialistReview.push(currentSpecialist);
                                }
                                const verdict = cleanLine(m[2]);
                                currentSpecialist = {
                                        specialist: m[1].toLowerCase(),
                                        verdict,
                                        points: [],
                                        skipped: /^skipped/i.test(verdict),
                                };
                        } else if (currentSpecialist) {
                                const bullet = stripped.replace(/^[-*+]\s+/, "");
                                if (bullet.length > 3) currentSpecialist.points.push(cleanLine(bullet));
                        }
                } else if (section === "synthesis") {
                        const m = plain.match(KEY_LINE);
                        if (m) {
                                const key = m[1].trim().toLowerCase();
                                const value = cleanLine(m[2]);
                                const syn = doc.synthesis ?? { consensus: "", conflicts: "", missing: "", confidence: null };
                                if (key === "consensus") syn.consensus = value;
                                else if (key === "conflicts") syn.conflicts = value;
                                else if (key === "missing") syn.missing = value;
                                else if (key === "confidence") {
                                        const n = Number(value.replace(/[^0-9]/g, ""));
                                        syn.confidence = Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
                                }
                                doc.synthesis = syn;
                        }
                } else if (section === "learningPlan") {
                        const m = plain.match(KEY_LINE);
                        if (m) {
                                const kind = m[1].trim().toLowerCase().replace(/\s+/g, "-");
                                const what = cleanLine(m[2]);
                                if (what.length > 3) {
                                        if (!doc.learningPlan) doc.learningPlan = [];
                                        doc.learningPlan.push({ kind, what });
                                }
                        }
                } else if (section === "retrospective") {
                        const retro = doc.retrospective ?? {
                                outcome: "delivered",
                                failureClass: "",
                                rootCause: "",
                                resolution: "",
                                prevention: "",
                                learnings: [],
                                improvements: [],
                        };
                        const blockKey = plain.match(/^-\s*(learnings|improvements)\s*:\s*(.*)$/i);
                        if (blockKey) {
                                // The block headers switch the sub-list mode. An inline
                                // value after the colon is the first row of the block.
                                retrospectiveLearnings = blockKey[1].toLowerCase() === "learnings";
                                retrospectiveImprovements = !retrospectiveLearnings;
                                const inline = cleanLine(blockKey[2]);
                                if (inline) {
                                        if (retrospectiveLearnings) {
                                                const m = inline.match(/^([a-z][a-z\s-]*?)\s*:\s*(.+)$/i);
                                                if (m) retro.learnings.push({ kind: m[1].trim().toLowerCase().replace(/\s+/g, "-"), what: cleanLine(m[2]) });
                                        } else {
                                                retro.improvements.push(inline);
                                        }
                                }
                        } else if (retrospectiveImprovements) {
                                // Improvement rows are FREE TEXT — a colon inside one
                                // ("plan mode: …") is part of the sentence, not a key.
                                const bullet = stripped.replace(/^[-*+]\s+/, "");
                                if (bullet.length > 3) retro.improvements.push(cleanLine(bullet));
                        } else if (retrospectiveLearnings) {
                                // Learning rows carry their landing lane: `- memory: what`.
                                const m = plain.match(KEY_LINE);
                                if (m) retro.learnings.push({ kind: m[1].trim().toLowerCase().replace(/\s+/g, "-"), what: cleanLine(m[2]) });
                        } else {
                                const keyMatch = plain.match(KEY_LINE);
                                if (keyMatch) {
                                        const key = keyMatch[1].trim().toLowerCase().replace(/\s+/g, "-");
                                        const value = cleanLine(keyMatch[2]);
                                        if (key === "outcome") {
                                                const v = value.toLowerCase();
                                                retro.outcome = v === "partial" || v === "failed" ? (v as "partial" | "failed") : "delivered";
                                        } else if (key === "failure-class" || key === "failureclass" || key === "failure-classification") {
                                                retro.failureClass = value.toLowerCase().replace(/\s+/g, "-");
                                        } else if (key === "root-cause" || key === "rootcause") {
                                                retro.rootCause = value;
                                        } else if (key === "resolution") {
                                                retro.resolution = value;
                                        } else if (key === "prevention") {
                                                retro.prevention = value;
                                        }
                                }
                        }
                        doc.retrospective = retro;
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
        // ---- V3 sections render only when present: a V2 doc renders
        // byte-identically (the pinned round-trip contract holds).
        if (doc.capabilityAudit && doc.capabilityAudit.length > 0) {
                const rows = doc.capabilityAudit.map((row) => renderCapabilityRow(row)).join("\n");
                parts.push(`\n## Capability audit\n\n${rows}`);
        }
        if (doc.approach) parts.push(`\n## Approach\n\n${doc.approach}`);
        if (doc.specialistReview && doc.specialistReview.length > 0) {
                const verdicts = doc.specialistReview
                        .map((v) => {
                                const points = v.points.map((p) => `- ${p}`).join("\n");
                                return points ? `### ${v.specialist} — ${v.verdict}\n${points}` : `### ${v.specialist} — ${v.verdict}`;
                        })
                        .join("\n\n");
                parts.push(`\n## Specialist review\n\n${verdicts}`);
        }
        if (doc.synthesis) {
                const syn = doc.synthesis;
                const lines = [
                        syn.consensus ? `- consensus: ${syn.consensus}` : "",
                        syn.conflicts ? `- conflicts: ${syn.conflicts}` : "",
                        syn.missing ? `- missing: ${syn.missing}` : "",
                        syn.confidence != null ? `- confidence: ${syn.confidence}` : "",
                ].filter((l) => l.length > 0);
                if (lines.length > 0) parts.push(`\n## Synthesis\n\n${lines.join("\n")}`);
        }
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
        if (doc.learningPlan && doc.learningPlan.length > 0) {
                const rows = doc.learningPlan.map((c) => `- ${c.kind}: ${c.what}`).join("\n");
                parts.push(`\n## Learning plan\n\n${rows}`);
        }
        if (doc.verification) parts.push(`\n## Verification\n\n${doc.verification}`);
        if (doc.openQuestions.length > 0) {
                parts.push(`\n## Open questions\n\n${doc.openQuestions.map((q) => `- ${q}`).join("\n")}`);
        }
        if (doc.retrospective) parts.push(`\n${renderRetrospectiveSection(doc.retrospective)}`);
        return `${parts.join("\n")}\n`;
}

/** The deterministic V3 capability-row render (mirrors CAPABILITY_ROW). */
function renderCapabilityRow(row: PlanCapabilityRow): string {
        const meta: string[] = [];
        if (row.relevance) meta.push(`relevance: ${row.relevance}`);
        if (row.benefit) meta.push(`benefit: ${row.benefit}`);
        if (row.confidence != null) meta.push(`confidence: ${row.confidence}`);
        const metaText = meta.length > 0 ? ` (${meta.join("; ")})` : "";
        return `- ${row.capability} — ${row.decision === "used" ? "USED" : "SKIPPED"}: ${row.reason}${metaText}`;
}

/** The deterministic `## Retrospective` render (the plan_retrospective lane). */
export function renderRetrospectiveSection(r: PlanRetrospective): string {
        const lines: string[] = [];
        lines.push(`- outcome: ${r.outcome}`);
        lines.push(`- failure class: ${r.failureClass || "none"}`);
        if (r.rootCause) lines.push(`- root cause: ${r.rootCause}`);
        if (r.resolution) lines.push(`- resolution: ${r.resolution}`);
        if (r.prevention) lines.push(`- prevention: ${r.prevention}`);
        if (r.learnings.length > 0) {
                lines.push("- learnings:");
                for (const c of r.learnings) lines.push(`  - ${c.kind}: ${c.what}`);
        }
        if (r.improvements.length > 0) {
                lines.push("- improvements:");
                for (const i of r.improvements) lines.push(`  - ${i}`);
        }
        return `## Retrospective\n\n${lines.join("\n")}`;
}

/** Surgical retrospective merge: strips any existing `## Retrospective`
 *  section (to the next `## ` header or EOF) and appends the rendered one.
 *  The model's original plan bytes elsewhere stay untouched — plan_retrospective
 *  never reflows a plan it did not write. */
export function mergeRetrospectiveIntoMarkdown(markdown: string, r: PlanRetrospective): string {
        const lines = markdown.split(/\r?\n/);
        const kept: string[] = []
        let inRetro = false;
        for (const line of lines) {
                if (/^#{1,3}\s*retrospective\s*$/i.test(line.trim())) {
                        inRetro = true;
                        continue;
                }
                if (inRetro && /^##\s+/.test(line)) inRetro = false;
                if (!inRetro) kept.push(line);
        }
        const base = kept.join("\n").replace(/\n{3,}$/g, "\n\n").replace(/\s+$/g, "");
        return `${base}\n\n${renderRetrospectiveSection(r)}\n`;
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

// ---------------------------------------------------------------------------
// The V3 quality rubric (the 2026-11-01 capability-orchestrator round,
// docs/plan-mode-v3.md) — scorePlanDocV3
// ---------------------------------------------------------------------------

/** The minimum audited capability rows for full V3 credit: 8 of the 11 —
 *  the four memory/skill/context lanes plus any four others. A full 11-row
 *  audit is the prompt's instruction; 8 keeps the gate fair for trivial
 *  plans that legitimately skip whole lanes with one-line reasons. */
export const V3_MIN_AUDIT_ROWS = 8;

/**
 * The deterministic V3 rubric: the seven V2 dimensions re-weighted to 80
 * points + three orchestrator dimensions (capability audit 8, specialist
 * review 8, learning plan 4) = 100. Same threshold gate, same PlanScore
 * shape, so the approval dialog, planCritiqueAdvice and the benchmark lane
 * are all V3-compatible without branching.
 *
 * Weights: objective 8, context 8, approach 8, steps 24, risks 12,
 * verification 12, clarity 8, capability-audit 8, specialist-review 8,
 * learning-plan 4. Pure: same doc in, same score out.
 */
export function scorePlanDocV3(doc: PlanDoc, threshold: number = PLAN_SCORE_THRESHOLD_DEFAULT): PlanScore {
        const dimensions: PlanScoreDimension[] = [];

        // Objective — 8: present (5) + concise one-liner <= 120 chars (3).
        {
                const missing: string[] = [];
                let points = 0;
                const obj = doc.objective.trim();
                const real = obj.length > 0 && obj !== "Untitled plan";
                if (real) points += 5;
                else missing.push("a one-line objective after '# Plan:'");
                if (real && obj.length <= 120) points += 3;
                else if (real) missing.push("objective trimmed to one line (<= 120 chars)");
                dimensions.push({ id: "objective", label: "Objective", points, weight: 8, missing });
        }

        // Context — 8: present (4) + substantive >= 15 words (4).
        {
                const missing: string[] = [];
                let points = 0;
                const ctx = doc.context.trim();
                if (ctx.length > 0) points += 4;
                else missing.push("a Context section (why this change)");
                if (wordCount(ctx) >= 15) points += 4;
                else if (ctx.length > 0) missing.push("context expanded (>= 15 words)");
                dimensions.push({ id: "context", label: "Context", points, weight: 8, missing });
        }

        // Approach — 8: present (4) + >= 10 words (4).
        {
                const missing: string[] = [];
                let points = 0;
                const approach = doc.approach.trim();
                if (approach.length > 0) points += 4;
                else missing.push("an Approach section (the recommended design)");
                if (wordCount(approach) >= 10) points += 4;
                else if (approach.length > 0) missing.push("approach expanded (>= 10 words)");
                dimensions.push({ id: "approach", label: "Approach", points, weight: 8, missing });
        }

        // Steps — 24: count 3..12 (10) + every step >= 4 words (7) + >= half name files (7).
        {
                const missing: string[] = [];
                let points = 0;
                const n = doc.steps.length;
                if (n >= 3 && n <= 12) points += 10;
                else if (n > 0) missing.push(n < 3 ? "at least 3 steps" : "at most 12 steps (split the plan)");
                else missing.push("3-12 numbered steps under '## Steps'");
                const shortSteps = doc.steps.filter((s) => wordCount(s.text) < 4).length;
                if (n > 0 && shortSteps === 0) points += 7;
                else if (n > 0) missing.push(`every step expanded to >= 4 words (${shortSteps} too short)`);
                const withFiles = doc.steps.filter((s) => stepNamesFiles(s)).length;
                if (n > 0 && withFiles >= Math.ceil(n / 2)) points += 7;
                else if (n > 0)
                        missing.push(`at least half the steps naming their files — '(files: src/a.ts)' (${withFiles}/${n} do)`);
                dimensions.push({ id: "steps", label: "Steps", points, weight: 24, missing });
        }

        // Risks — 12: >= 1 (5) + >= 2 (7).
        {
                const missing: string[] = [];
                let points = 0;
                const n = doc.risks.filter((r) => r.trim().length > 3).length;
                if (n >= 1) points += 5;
                else missing.push("at least one risk with its mitigation under '## Risks'");
                if (n >= 2) points += 7;
                else if (n === 1) missing.push("a second risk (edge cases, migration, perf)");
                dimensions.push({ id: "risks", label: "Risks", points, weight: 12, missing });
        }

        // Verification — 12: present (5) + a runnable command (7).
        {
                const missing: string[] = [];
                let points = 0;
                const v = doc.verification.trim();
                if (v.length > 0) points += 5;
                else missing.push("a Verification section (how to prove it works)");
                if (COMMAND_HINT.test(v)) points += 7;
                else if (v.length > 0) missing.push("the exact verification command(s) (e.g. `bun test test/plan.test.ts`)");
                dimensions.push({ id: "verification", label: "Verification", points, weight: 12, missing });
        }

        // Clarity — 8: no placeholders (4) + no vague step openers (4).
        {
                const missing: string[] = [];
                let points = doc.steps.length > 0 ? 8 : 0;
                const all = [
                        doc.objective,
                        doc.context,
                        doc.approach,
                        doc.verification,
                        ...doc.risks,
                        ...doc.steps.map((s) => s.text),
                ].join("\n");
                if (doc.steps.length === 0) missing.push("at least one step before clarity can be judged");
                if (PLACEHOLDER.test(all)) {
                        points -= 4;
                        missing.push("placeholder text removed (TODO/TBD/…)");
                }
                const vague = doc.steps.filter((s) => VAGUE_STEP.test(s.text.trim())).length;
                if (vague > 0) {
                        points -= 4;
                        missing.push(`vague step openers made concrete (${vague} steps start with 'handle/fix/improve/…')`);
                }
                dimensions.push({ id: "clarity", label: "Clarity", points: Math.max(0, points), weight: 8, missing });
        }

        // Capability audit — 8: >= V3_MIN_AUDIT_ROWS rows (3) + every row has a
        // decision AND a real reason (3) + at least one USED row (2). An
        // all-SKIPPED audit on a non-trivial plan is the anti-pattern the
        // directive targets (generate-first, reuse-never) — hence the USED row.
        {
                const missing: string[] = [];
                let points = 0;
                const rows = doc.capabilityAudit ?? [];
                if (rows.length >= V3_MIN_AUDIT_ROWS) points += 3;
                else missing.push(`at least ${V3_MIN_AUDIT_ROWS} of ${CAPABILITY_IDS.length} capability rows under '## Capability audit' (one per capability: tiered-memory, existing-skills, …)`);
                const thinRows = rows.filter((r) => r.reason.trim().length < 5).length;
                if (rows.length > 0 && thinRows === 0) points += 3;
                else if (rows.length > 0) missing.push(`every audit row carrying a specific reason (${thinRows} too thin)`);
                if (rows.some((r) => r.decision === "used")) points += 2;
                else if (rows.length > 0)
                        missing.push("at least one capability marked USED (leverage over generation) — or justify in Context why nothing applies");
                dimensions.push({ id: "capability-audit", label: "Capability audit", points, weight: 8, missing });
        }

        // Specialist review — 8: >= 1 verdict or justified skip (3) + review
        // depth scales with plan size — >= 2 verdicts once the plan carries 6+
        // steps (3) + the synthesis block (consensus + conflicts + confidence)
        // (2). Skipped specialists count only with their reason (the parser
        // marks SKIPPED verdicts; a skip without a reason is a thin verdict).
        {
                const missing: string[] = [];
                let points = 0;
                const verdicts = doc.specialistReview ?? [];
                const counted = verdicts.filter((v) => v.verdict.trim().length > 2);
                if (counted.length >= 1) points += 3;
                else missing.push("at least one specialist verdict under '## Specialist review' (or '### <name> — SKIPPED: <why>' rows when the plan is trivial)");
                const needed = doc.steps.length >= 6 ? 2 : 1;
                if (counted.length >= needed) points += 3;
                else if (counted.length >= 1)
                        missing.push(`a second specialist verdict (plans with 6+ steps need ${needed} reviews — product-strategist / solution-architect / delivery-manager / qa-architect / devils-advocate)`);
                const syn = doc.synthesis;
                const synthesisComplete =
                        !!syn && syn.consensus.trim().length > 0 && syn.conflicts.trim().length > 0 && syn.confidence != null;
                if (synthesisComplete) points += 2;
                else
                        missing.push(
                                "the '## Synthesis' block — consensus / conflicts (+ your ruling) / missing / confidence: 0-100",
                        );
                dimensions.push({ id: "specialist-review", label: "Specialist review", points, weight: 8, missing });
        }

        // Learning plan — 4: >= 1 candidate (2) + every candidate carries a
        // valid landing lane and a concrete what (2). "Software delivery is
        // evidence, learning is the objective" — a plan with no learning
        // objective is task-completion mode, the exact failure V3 exists to fix.
        {
                const missing: string[] = [];
                let points = 0;
                const rows = doc.learningPlan ?? [];
                if (rows.length >= 1) points += 2;
                else missing.push("at least one '## Learning plan' row — what this run should remember or validate (`- memory: …`, `- benchmark: …`)");
                const kinds = new Set<string>(LEARNING_KINDS);
                const badRows = rows.filter((c) => !kinds.has(c.kind) || c.what.trim().length < 5).length;
                if (rows.length > 0 && badRows === 0) points += 2;
                else if (rows.length > 0)
                        missing.push(`every learning row using a real lane (memory/skill/workflow/routine/standing-order/benchmark/agent-pattern) with a concrete what (${badRows} bad)`);
                dimensions.push({ id: "learning-plan", label: "Learning plan", points, weight: 4, missing });
        }

        const score = dimensions.reduce((sum, d) => sum + d.points, 0);
        const summaryBits: string[] = [`${doc.steps.length} steps`];
        const audit = doc.capabilityAudit ?? [];
        if (audit.length > 0) {
                const used = audit.filter((r) => r.decision === "used").length;
                summaryBits.push(`audit ${used}/${audit.length} used`);
        }
        const verdicts = doc.specialistReview ?? [];
        if (verdicts.length > 0) summaryBits.push(`${verdicts.length} specialist verdicts`);
        if (doc.learningPlan?.length) summaryBits.push(`${doc.learningPlan.length} learning rows`);
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
// The retrospective contract (plan_retrospective's validation lane)
// ---------------------------------------------------------------------------

/**
 * Validate a parsed retrospective. Empty result = valid. The rules implement
 * the directive's hard parts: every failure is classified (no failure may be
 * discarded), and every milestone extracts at least one learning or one
 * improvement (software delivery is evidence, learning is the objective).
 */
export function validateRetrospective(r: PlanRetrospective | null): string[] {
        if (!r) return ["no retrospective content parsed — expected '- outcome: …' key lines under '## Retrospective'"];
        const problems: string[] = [];
        if (r.outcome !== "delivered" && r.outcome !== "partial" && r.outcome !== "failed") {
                problems.push("outcome must be one of: delivered | partial | failed");
        }
        const categories = new Set<string>(FAILURE_CATEGORIES);
        if (r.outcome === "delivered") {
                if (r.failureClass && r.failureClass !== "none" && !categories.has(r.failureClass)) {
                        problems.push(`failure class '${r.failureClass}' is not one of: ${FAILURE_CATEGORIES.join(" | ")} (or 'none')`);
                }
        } else {
                if (!categories.has(r.failureClass)) {
                        problems.push(`outcome '${r.outcome}' requires a failure class from: ${FAILURE_CATEGORIES.join(" | ")}`);
                }
                if (r.rootCause.trim().length < 5) problems.push("a root cause (>= 5 chars) for a non-delivered outcome");
                if (r.prevention.trim().length < 5) problems.push("a preventative action (>= 5 chars) — no failure is discarded");
        }
        const kinds = new Set<string>(LEARNING_KINDS);
        const badLearnings = r.learnings.filter((c) => !kinds.has(c.kind) || c.what.trim().length < 5).length;
        if (badLearnings > 0) {
                problems.push(`every learning candidate needs a real lane (${LEARNING_KINDS.join("/")}) and a concrete what (${badLearnings} bad)`);
        }
        if (r.learnings.length === 0 && r.improvements.length === 0) {
                problems.push("at least one learning candidate or one improvement — a milestone with nothing to extract is a missed retrospective");
        }
        return problems;
}

