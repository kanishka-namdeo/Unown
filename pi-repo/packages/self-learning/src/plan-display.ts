/**
 * plan-display.ts — the plan-visibility lane (the 2026-11-14 round).
 *
 * The reported defect: "user cannot see plan mode's created plan by
 * default." The plan existed in three places (the `.unown/plans/<slug>.md`
 * file, the plan_write tool result, the exit_plan_mode tool result) and the
 * TUI rendered none of them — both plan renderers truncated to one capped
 * line and ignored the `expanded` render option, and the approval dialog
 * showed only a score summary.
 *
 * The field's law (seven products surveyed, every claim sourced in
 * docs/plan-visibility-round-session.md): the plan is shown, in full, at
 * the moment it is ready — Codex's ProposedPlanCell renders the whole
 * markdown in the transcript; Claude Code "presents it and asks how to
 * proceed"; Cursor auto-opens the plan as a virtual file; Copilot shows the
 * Review Plan card immediately. Progressive disclosure (compact preview +
 * expand key) applies only AFTER first presentation.
 *
 * This module is the PURE half of the fix: plain-text line builders with no
 * TUI dependency, unit-testable like plan.ts. The renderers in tools.ts
 * apply theme colors; the caps below keep every surface inside the
 * narrow-terminal budget (the 60x20 PTY matrix lane).
 */

import { type PlanDoc, type PlanScore, renderPlanMarkdown } from "./plan.ts";

/** The UI-only payload every plan tool result carries. `details` is never
 * serialized to the provider (the AI layer sends only `content` blocks), so
 * the plan rides the result to the renderer without polluting model context
 * — the same channel the vendored read tool uses for truncation metadata. */
export interface PlanResultDetails {
        /** The plan's outcome at the moment this result was produced. */
        outcome: "written" | "approved" | "rejected" | "stayed" | "print" | "retrospective";
        /** The full rendered plan markdown (renderPlanMarkdown). */
        plan: string;
        /** The one-line objective. */
        objective: string;
        /** The steps, in order (text only — the checklist glyphs are added here). */
        steps: { step: number; text: string; completed: boolean }[];
        /** The plan file the doc is persisted to. */
        file: string;
        /** The 0-100 score at write/approval time. */
        score: number;
        /** The user's feedback on the rejected lane, when present. */
        feedback?: string;
}

/** Collapsed (default) preview: how many steps the compact block shows
 * before the `⋯ N more` chip. Codex previews 3 checklist lines; Claude
 * Code's task list shows 5 — 3 keeps the default block inside the
 * 10-line fallback-preview budget the other tools already trained users
 * on. */
export const PLAN_PREVIEW_STEPS_COLLAPSED = 3;

/** The approval dialog's title preview: how many steps ride the dialog
 * before the `⋯ N more` line. The dialog renders in the editor container
 * (shrink: 1, minSize: 3 in the fullscreen VStack) — a title taller than
 * the viewport would clip the OPTIONS below it, so this cap is a layout
 * contract, not a taste choice. 4 steps ≈ 9-10 title lines worst case. */
export const PLAN_DIALOG_PREVIEW_STEPS = 4;

/** Step-text truncation for the two capped surfaces (compact block + dialog
 * preview). Long steps word-wrap naturally in the transcript, but the
 * dialog title must stay single-line-per-step at 60 cols. */
export const PLAN_STEP_TRUNCATE = 68;
export const PLAN_DIALOG_STEP_TRUNCATE = 56;

/** Objective truncation for the dialog title (same budget rationale). */
export const PLAN_DIALOG_OBJECTIVE_TRUNCATE = 56;

function truncate(text: string, max: number): string {
        const clean = text.replace(/\s+/g, " ").trim();
        if (clean.length <= max) return clean;
        return `${clean.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** The compact collapsed block for a plan_write result: score line,
 * objective, first steps, the `⋯ N more` chip tail (the caller appends the
 * expand-key hint — it owns the keybinding machinery). */
export function planWritePreviewLines(details: PlanResultDetails): string[] {
        const lines: string[] = [];
        lines.push(`Plan: ${details.objective}`);
        const parts = [`${details.score}/100`, `${details.steps.length} step${details.steps.length === 1 ? "" : "s"}`];
        lines.push(parts.join(" · "));
        const cap = Math.min(PLAN_PREVIEW_STEPS_COLLAPSED, details.steps.length);
        for (const s of details.steps.slice(0, cap)) {
                lines.push(`${s.step}. ☐ ${truncate(s.text, PLAN_STEP_TRUNCATE)}`);
        }
        if (details.steps.length > cap) {
                lines.push(`⋯ ${details.steps.length - cap} more step${details.steps.length - cap === 1 ? "" : "s"}`);
        }
        // The file line is honest when known: the legacy-recovery lane (a result
        // text replayed from a pre-round transcript) has no file identity.
        if (details.file) lines.push(details.file);
        return lines;
}

/** The compact collapsed block for an APPROVED plan: the approval headline
 * (the first sentence of the model-facing text — kept verbatim so the PTY
 * anchors like "User has approved your plan" survive), the objective, then
 * the step checklist in the fallback-echo glyph format (`n. ☐ text` —
 * the format the todo-unification round pinned for the approved-plan
 * echo), capped like every collapsed surface, then the file. */
export function planApprovedLines(details: PlanResultDetails, headline: string): string[] {
        const lines: string[] = [];
        if (headline) lines.push(truncate(headline, 90));
        lines.push(`Plan: ${details.objective}`);
        const cap = Math.min(PLAN_PREVIEW_STEPS_COLLAPSED, details.steps.length);
        for (const s of details.steps.slice(0, cap)) {
                lines.push(`${s.step}. ${s.completed ? "☒" : "☐"} ${truncate(s.text, PLAN_STEP_TRUNCATE)}`);
        }
        if (details.steps.length > cap) {
                lines.push(`⋯ ${details.steps.length - cap} more step${details.steps.length - cap === 1 ? "" : "s"}`);
        }
        if (details.file) lines.push(details.file);
        return lines;
}

/** The compact collapsed block for a REJECTED plan: the rejection headline,
 * the user's feedback, the plan it rejected. */
export function planRejectedLines(details: PlanResultDetails, headline: string): string[] {
        const lines: string[] = [];
        if (headline) lines.push(truncate(headline, 90));
        if (details.feedback) lines.push(`Feedback: ${truncate(details.feedback, PLAN_STEP_TRUNCATE)}`);
        lines.push(`Plan: ${details.objective}`);
        return lines;
}

/** The compact collapsed block for a retrospective: the outcome headline
 * plus the plan it closes (the full merged section is the expanded
 * payload). */
export function planRetrospectiveLines(details: PlanResultDetails, headline: string): string[] {
        const lines: string[] = [];
        if (headline) lines.push(truncate(headline, 90));
        lines.push(`Plan: ${details.objective}`);
        lines.push(details.file);
        return lines;
}

/** The approval dialog's multi-line title. The FIRST line is the unchanged
 * `Plan ready — <score.summary>` (the PTY matrix's GATE_TITLE anchor and
 * the keyboard round's stable-contract surface); the lines under it carry
 * the objective and the first steps — the Codex compact-checklist pattern
 * (its `update_plan` row previews 3 steps) applied to the proposal itself.
 * The dialog still ends with the byte-identical four options and their
 * pinned keyboard contract. */
export function planDialogPreviewTitle(doc: PlanDoc, score: PlanScore): string {
        const lines: string[] = [];
        lines.push(`Plan ready — ${score.summary}`);
        lines.push("");
        lines.push(truncate(doc.objective || "Untitled plan", PLAN_DIALOG_OBJECTIVE_TRUNCATE));
        const cap = Math.min(PLAN_DIALOG_PREVIEW_STEPS, doc.steps.length);
        for (const s of doc.steps.slice(0, cap)) {
                lines.push(`${s.step}. ${truncate(s.text, PLAN_DIALOG_STEP_TRUNCATE)}`);
        }
        if (doc.steps.length > cap) {
                lines.push(
                        `⋯ ${doc.steps.length - cap} more step${doc.steps.length - cap === 1 ? "" : "s"} — Edit the plan shows the full markdown`,
                );
        }
        return lines.join("\n");
}

/** The expand-hint suffix: empty when the live keybinding machinery cannot
 * resolve the expand key (an honest no-hint — never a hardcoded "ctrl+o"),
 * else the `· <key> to expand` chip in the vendored fallback-preview
 * format (`⋯ N earlier hidden · <key>`). */
export function planExpandHintSuffix(key: string): string {
        return key ? ` · ${key} to expand` : "";
}

/** Build the UI-only details payload shared by every plan tool result. */
export function planResultDetails(
        outcome: PlanResultDetails["outcome"],
        doc: PlanDoc,
        score: PlanScore,
        file: string,
        extra?: { feedback?: string },
): PlanResultDetails {
        return {
                outcome,
                plan: renderPlanMarkdown(doc),
                objective: doc.objective || "Untitled plan",
                steps: doc.steps.map((s) => ({ step: s.step, text: s.text, completed: s.completed })),
                file,
                score: score.score,
                feedback: extra?.feedback,
        };
}
