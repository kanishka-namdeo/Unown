/**
 * hoist.ts — the cross-project rule hoist: the user-tier dream path.
 *
 * WHY THIS EXISTS (2026-10-22, transfer-bench iteration 2): the transfer
 * benchmark measured that carrying a project's consolidated memory VERBATIM
 * into a related-but-different project is neutral-to-harmful — the dream's
 * output is half workflow-discipline (transferable) and half project-bound
 * grammar detail (poisonous elsewhere), and the carried arms scored −0.35
 * case-pass-rate vs cold, with a systematic column-convention transplant
 * error pattern (the specificity-interference signature). The literature
 * agrees (ExpeL insights, AWM induced workflows, RSPM's promotion ladder,
 * Hippo's accumulation-without-abstraction negative result): what transfers
 * is the ABSTRACTED rule, not the copied memory. This pass performs the
 * abstraction: after a project dream ships, it selects the few rules that
 * are true for ANY coding project and hoists them into the USER tier —
 * the tier the architecture already injects into every project's session.
 *
 * The user tier is the user's file (memory.md: "you — seeded once,
 * hand-edited"). An automated writer is a contract change, so the feature
 * is OPT-IN (PI_USER_TIER_HOIST=1), additive-only (appendRules — existing
 * content is never rewritten), versioned and rollback-able like every other
 * write, provenance-stamped per rule, capped at 3 rules per dream, guarded
 * by the same deterministic layer as dreams (first-mint semantics: any flag
 * on a pristine user tier gates the whole hoist), and deduped against what
 * the tier already says. "Hoist NOTHING" is a fully correct outcome — most
 * project memories are project-bound.
 *
 * Purity note: like skills.ts, this module is engine-side (store + llm + bus).
 * The deterministic specificity filter is deliberately simple: the
 * abstraction contract lives in the prompt; the filter is the
 * model-independent backstop, not the primary mechanism.
 */
import { appendRules, currentVersion, readTier, type Tier } from "./memory.ts";
import { modelFor, chatJson } from "./llm.ts";
import { decideGuardAction } from "./guard.ts";
import { emit } from "./bus.ts";
import { basename } from "node:path";

export const HOIST_SYSTEM = `You are the Hoist, the cross-project generalization sub-agent of a self-learning coding agent.
You receive ONE project's consolidated memory — rules learned in that project — and select
the few that are TRUE FOR ANY CODING PROJECT, rewriting them as project-independent
user-tier rules that will be injected into EVERY future project the agent works on.

Selection contract:
1. ONLY rules a competent engineer would endorse in a COMPLETELY DIFFERENT project:
   workflow discipline, spec-reading habits, testing strategy, debugging method,
   tooling etiquette. NO project name, no file paths, no grammar or format details,
   no column formulas, no version numbers, no library or CLI names specific to the
   source project, no task specifics.
2. If nothing qualifies, hoist NOTHING — {"rules": []} is the correct and common
   answer; most project memory is project-bound.
3. Rewrite each selected rule as a short imperative bullet (second person, <= 160
   characters, self-contained, no provenance tags — the caller stamps provenance).
4. At most 3 rules: the user tier reaches every future project, so noise costs
   more than silence.

Return STRICT JSON: {"rules": ["...", ...]}`;

export interface HoistSkipped {
        rule: string;
        reason: "project-specific" | "too-long" | "duplicate" | "guard";
}

export interface HoistResult {
        /** How many rules were hoisted into the user tier (0 is success). */
        hoisted: number;
        /** The hoisted rule texts (post filter, guard, dedupe). */
        rules: string[];
        /** Rules the deterministic filters or the guard rejected (the audit trail). */
        skipped: HoistSkipped[];
        /** The guard verdict on the hoist block. */
        guardAction: "ship" | "sanitize" | "gate" | "off";
        /** The user-tier version AFTER the append (absent when nothing hoisted). */
        version?: number;
}

/** Generic path segments that must never trigger name matching (a rule that
 *  merely says "project" is not project-specific). */
const GENERIC_SEGMENTS = new Set([
        "project", "projects", "repo", "repos", "app", "apps", "service", "services",
        "api", "server", "client", "test", "tests", "src", "web", "site", "main",
        "core", "tool", "tools", "work", "code", "dev", "workspace", "package",
]);

/** Deterministic specificity backstop (the prompt is the primary mechanism).
 *  The project's name may appear in rules in shorter forms than the full
 *  basename ("exprq" for a dir named "exprq-project"), so match the basename
 *  AND its meaningful segments (the 2026-10-22 test round caught the
 *  basename-only version letting "In exprq, columns are 1-based..." through). */
function isProjectSpecific(rule: string, projectPath: string): boolean {
        const name = (basename(projectPath) || "").toLowerCase();
        const lower = rule.toLowerCase();
        if (name.length >= 3 && lower.includes(name)) return true;
        const segs = name
                .split(/[-_.\s]+/)
                .filter((s) => s.length >= 4 && !GENERIC_SEGMENTS.has(s));
        if (segs.some((s) => lower.includes(s))) return true;
        if (/(?:^|\s|["'`])[\w.-]+\/[\w.-]+/i.test(rule)) return true; // paths
        if (lower.includes("~/") || lower.includes("./") || lower.includes("../")) return true;
        return false;
}

const MAX_RULE_CHARS = 200;

export async function hoistCrossProjectRules(opts: {
        consolidatedMemory: string;
        projectPath: string;
        slug: string;
}): Promise<HoistResult | null> {
        if (process.env.PI_USER_TIER_HOIST !== "1") return null; // opt-in (see module doc)
        const memory = String(opts.consolidatedMemory ?? "");
        if (!memory || memory.trim().length < 60) return null; // nothing substantive to abstract

        const result = await chatJson<{ rules?: unknown }>(
                [
                        { role: "system", content: HOIST_SYSTEM },
                        {
                                role: "user",
                                content: `PROJECT MEMORY (project: ${opts.slug}):\n\n${memory}`,
                        },
                ],
                { maxTokens: 800, model: modelFor("dream") },
        );

        const raw: string[] = Array.isArray(result?.rules)
                ? result.rules.map((r) => String(r ?? "").trim()).filter(Boolean)
                : [];
        const skipped: HoistSkipped[] = [];
        const kept: string[] = [];
        for (const r of raw) {
                if (r.length > MAX_RULE_CHARS) {
                        skipped.push({ rule: r, reason: "too-long" });
                        continue;
                }
                if (isProjectSpecific(r, opts.projectPath)) {
                        skipped.push({ rule: r, reason: "project-specific" });
                        continue;
                }
                if (kept.length >= 3) continue; // cap applies to SURVIVORS: a
                // specificity-skipped rule must not consume another's slot
                kept.push(r);
        }

        if (!kept.length) {
                const out: HoistResult = { hoisted: 0, rules: [], skipped, guardAction: "off" };
                emit("hoist:finished", { ...out, slug: opts.slug, project: opts.slug });
                return out;
        }

        // Dedupe against the current user tier (additive-only contract).
        const current = readTier("user" as Tier);
        const currentBullets = new Set(
                current
                        .split("\n")
                        .map((l) => l.trim().replace(/^[-*]\s+/, ""))
                        .filter(Boolean),
        );
        const deduped = kept.filter((r) => {
                if (currentBullets.has(r)) {
                        skipped.push({ rule: r, reason: "duplicate" });
                        return false;
                }
                return true;
        });
        if (!deduped.length) {
                const out: HoistResult = { hoisted: 0, rules: [], skipped, guardAction: "off" };
                emit("hoist:finished", { ...out, slug: opts.slug, project: opts.slug });
                return out;
        }

        // Guard: the user tier is the highest-leverage write (injected
        // everywhere) — first-mint semantics (any flag gates the whole hoist),
        // established tiers get line quarantine.
        const block = deduped.map((r) => `- ${r}`).join("\n");
        const guard = decideGuardAction(block, current, {
                firstMint: currentVersion("user" as Tier) <= 1,
        });
        const guardSurvivors: string[] = [];
        if (guard.action === "ship") {
                guardSurvivors.push(...deduped);
        } else if (guard.action === "sanitize") {
                const dropLines = new Set(guard.flags.map((f) => f.line));
                deduped.forEach((r, i) => {
                        if (dropLines.has(i + 1)) skipped.push({ rule: r, reason: "guard" });
                        else guardSurvivors.push(r);
                });
        } else {
                for (const r of deduped) skipped.push({ rule: r, reason: "guard" });
        }
        if (!guardSurvivors.length) {
                const out: HoistResult = { hoisted: 0, rules: [], skipped, guardAction: guard.action };
                emit("hoist:finished", { ...out, slug: opts.slug, project: opts.slug });
                return out;
        }

        const stamp = new Date().toISOString().slice(0, 10);
        const version = appendRules(
                "user" as Tier,
                guardSurvivors,
                "autodream-hoist",
                `hoisted from ${opts.slug} dream (${stamp})`,
        );
        const out: HoistResult = {
                hoisted: guardSurvivors.length,
                rules: guardSurvivors,
                skipped,
                guardAction: guard.action,
                version,
        };
        emit("hoist:finished", { ...out, slug: opts.slug, project: opts.slug });
        return out;
}
