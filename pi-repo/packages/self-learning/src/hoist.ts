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
 * the tier the architecture injects into every project's session.
 *
 * THE 2026-10-22 SHARED-MEMORY CONSISTENCY REWORK — two real defects fixed:
 *
 *   1. WRONG TARGET: the hoist appended to the ENGINE's user tier
 *      (DATA_DIR/memory/user.md — injected into engine sandbox runs only).
 *      Terminal sessions read ~/.unown/memory/user.md, so a "hoisted" rule
 *      NEVER reached the user's actual projects. The ship now writes BOTH
 *      targets — the terminal user tier (term.ts appendTerminalUserRules,
 *      atomic + attribution-stamped) AND the engine user tier (appendRules,
 *      versioned + rollback-able) — but only at APPROVE time.
 *
 *   2. NO CROSS-PROJECT EVIDENCE: one project's dream promoted rules into
 *      EVERY future project on a single observation. The multi-repo gate
 *      (amnesia's PROMOTE pattern; the same shape the community converged
 *      on for preference transfer): a rule is OBSERVED into the
 *      hoist_candidates ledger (rule hash + observing project set) and
 *      PROMOTES only after PI_HOIST_MIN_PROJECTS distinct projects (default
 *      2) have abstracted it. A rule one project derives is
 *      project-suspicious; the same rule from two projects is a user-level
 *      habit. PI_HOIST_MIN_PROJECTS=1 restores single-observation behavior.
 *
 * THE DIVERTIMENTO REWIRE (2026-11-14): a promoted rule no longer auto-writes.
 * It parks into the human MEMORY REVIEW QUEUE (~/.unown/memory/review-queue/,
 * memory-review.ts) and ships only when the human approves — the Memory v2
 * round's CP3 contract, which shipped as an orphan module, finally wired.
 * The ship (memory-review-ship.ts) re-dedupes against BOTH user tiers and
 * re-runs the deterministic guard at decision time, then performs the exact
 * dual-target write the auto-hoist used to do.
 *
 * The user tier is the user's file (memory.md: "you — seeded once,
 * hand-edited"). An automated writer is a contract change, so the feature
 * remains OPT-IN (PI_USER_TIER_HOIST=1) — and now gated by a HUMAN: every
 * promotion is additive-only at ship time (existing content is never
 * rewritten), versioned and rollback-able on the engine side,
 * provenance-stamped per rule (naming the observing projects AND the review
 * decision), capped at 3 candidate rules per dream, guarded by the same
 * deterministic layer as dreams (re-run at decision time), and deduped
 * against BOTH user tiers (at park time AND at ship time). "Hoist NOTHING"
 * is a fully correct outcome — most project memories are project-bound.
 *
 * Purity note: like skills.ts, this module is engine-side (store + llm + bus
 * + the term.ts file seam). The deterministic specificity filter is
 * deliberately simple: the abstraction contract lives in the prompt; the
 * filter is the model-independent backstop, not the primary mechanism.
 */
import { createHash } from "node:crypto";
import { currentVersion, readTier, type Tier } from "./memory.ts";
import { modelFor, chatJson } from "./llm.ts";
import { decideGuardAction } from "./guard.ts";
import { emit } from "./bus.ts";
import { readTerminalUserTier, isPristineTerminalUserTier } from "./term.ts";
import { store } from "./store.ts";
import { parkMemoryReviewCandidate } from "./memory-review.ts";
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
        reason: "project-specific" | "too-long" | "duplicate" | "guard" | "awaiting-second-project";
}

export interface HoistResult {
        /** How many rules crossed the promotion gate this dream — parked into
         *  the memory review queue, NOT written (0 is success; the tiers change
         *  only at approve time). */
        hoisted: number;
        /** The promoted rule texts (queued for review). */
        rules: string[];
        /** The review-queue ids the promoted rules parked under. */
        review: Array<{ id: string; rule: string }>;
        /** Rules observed this dream but still below the multi-project gate (parked). */
        parked: string[];
        /** Rules the deterministic filters or the guard rejected (the audit trail). */
        skipped: HoistSkipped[];
        /** The guard verdict on the promotion block. */
        guardAction: "ship" | "sanitize" | "gate" | "off";
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

/** The multi-project promotion gate (see module doc). 1 restores the old
 *  single-observation behavior; values below 1 floor to 1 (0 would disable
 *  hoisting entirely — use PI_USER_TIER_HOIST=0 for that). */
export function hoistMinProjects(): number {
        const raw = process.env.PI_HOIST_MIN_PROJECTS ?? "";
        if (raw === "") return 2;
        const n = Number(raw);
        if (!Number.isFinite(n)) return 2;
        return Math.max(1, Math.floor(n));
}

/** Observation-hash normalization: collapse whitespace, strip trailing
 *  punctuation, lowercase — two phrasings that differ only in casing/spacing
 *  are the same observation. (Deliberately NOT a fuzzy/semantic match: a
 *  missed near-dup only parks a rule longer — safe; a false match is the
 *  dangerous direction and exact-normalize never produces one.) */
export function normalizeHoistRule(rule: string): string {
        return String(rule ?? "")
                .toLowerCase()
                .replace(/\s+/g, " ")
                .trim()
                .replace(/[.!]+$/, "");
}

export function hoistRuleHash(rule: string): string {
        return createHash("sha256").update(normalizeHoistRule(rule), "utf8").digest("hex").slice(0, 16);
}

/** Bounded candidate ledger: keep the newest CAP rows by last_seen_at. */
const HOIST_CANDIDATES_CAP = 500;

interface CandidateRow {
        rule_hash: string;
        rule_text: string;
        projects: string;
        first_seen_at: number;
        last_seen_at: number;
}

/** Record one (rule, project) observation. Returns the rule's observing
 *  project set AFTER the update (an old row's set + this project). */
function recordObservation(rule: string, project: string): string[] {
        const hash = hoistRuleHash(rule);
        const now = Date.now();
        const existing = store.get<CandidateRow>(`SELECT * FROM hoist_candidates WHERE rule_hash = ?`, [hash]);
        let projects: string[];
        if (existing) {
                let list: string[] = [];
                try {
                        list = JSON.parse(existing.projects);
                } catch {
                        list = [];
                }
                if (!Array.isArray(list)) list = [];
                if (!list.includes(project)) list.push(project);
                projects = list;
                store.run(
                        `UPDATE hoist_candidates SET rule_text = ?, projects = ?, last_seen_at = ? WHERE rule_hash = ?`,
                        [rule, JSON.stringify(projects), now, hash],
                );
        } else {
                projects = [project];
                store.run(
                        `INSERT INTO hoist_candidates (rule_hash, rule_text, projects, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`,
                        [hash, rule, JSON.stringify(projects), now, now],
                );
                // LRU cap — oldest last_seen_at first
                const count = store.get<{ n: number }>(`SELECT COUNT(*) AS n FROM hoist_candidates`)!.n;
                if (count > HOIST_CANDIDATES_CAP) {
                        store.run(
                                `DELETE FROM hoist_candidates WHERE rule_hash IN (
                                        SELECT rule_hash FROM hoist_candidates ORDER BY last_seen_at ASC LIMIT ?
                                )`,
                                [count - HOIST_CANDIDATES_CAP],
                        );
                }
        }
        return projects;
}

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
                const out: HoistResult = { hoisted: 0, rules: [], parked: [], skipped, guardAction: "off" };
                emit("hoist:finished", { ...out, slug: opts.slug, project: opts.slug });
                return out;
        }

        // Dedupe against BOTH user tiers — the terminal file is now a write
        // target, so a rule already in EITHER tier is a duplicate everywhere.
        const terminalUser = readTerminalUserTier();
        const engineUser = readTier("user" as Tier);
        const bulletSet = new Set(
                [...terminalUser.split("\n"), ...engineUser.split("\n")]
                        .map((l) => l.trim().replace(/^[-*]\s+/, ""))
                        .filter(Boolean)
                        .map((l) => normalizeHoistRule(l)),
        );
        const deduped = kept.filter((r) => {
                if (bulletSet.has(normalizeHoistRule(r))) {
                        skipped.push({ rule: r, reason: "duplicate" });
                        return false;
                }
                return true;
        });
        if (!deduped.length) {
                const out: HoistResult = { hoisted: 0, rules: [], parked: [], skipped, guardAction: "off" };
                emit("hoist:finished", { ...out, slug: opts.slug, project: opts.slug });
                return out;
        }

        // Guard: the user tier is the highest-leverage write (injected
        // everywhere) — first-mint semantics (any flag gates the whole hoist),
        // established tiers get line quarantine. The context is the TERMINAL
        // tier (the surface real sessions inject).
        const block = deduped.map((r) => `- ${r}`).join("\n");
        const guard = decideGuardAction(block, terminalUser, {
                firstMint: currentVersion("user" as Tier) <= 1 && isPristineTerminalUserTier(terminalUser),
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
                const out: HoistResult = { hoisted: 0, rules: [], parked: [], skipped, guardAction: guard.action };
                emit("hoist:finished", { ...out, slug: opts.slug, project: opts.slug });
                return out;
        }

        // ---- The multi-project promotion gate: record observations, promote
        // only what enough DISTINCT projects have abstracted — every promoted
        // rule now lands in the human REVIEW QUEUE (the Memory Divertimento
        // rewire, 2026-11-14: the v2 round's CP3 contract, finally wired).
        // Nothing auto-writes: the dual-target tier write happens only at
        // approve time (memory-review-ship.ts), re-deduped and re-guarded
        // against the tiers AS THEY ARE at decision time.
        const minProjects = hoistMinProjects();
        const review: Array<{ id: string; rule: string }> = [];
        const parkedWaiting: string[] = [];
        for (const r of guardSurvivors) {
                const projects = recordObservation(r, opts.slug);
                if (new Set(projects).size >= minProjects) {
                        const id = parkMemoryReviewCandidate({
                                rule: r,
                                projects: [...new Set(projects)],
                                evidence: `observed in ${new Set(projects).size} project(s): ${[...new Set(projects)].join(", ")} — cross-project hoist candidate`,
                                source: "hoist",
                        });
                        review.push({ id, rule: r });
                } else {
                        parkedWaiting.push(r);
                        skipped.push({ rule: r, reason: "awaiting-second-project" });
                }
        }

        if (!review.length) {
                const out: HoistResult = { hoisted: 0, rules: [], review: [], parked: parkedWaiting, skipped, guardAction: guard.action };
                emit("hoist:finished", { ...out, slug: opts.slug, project: opts.slug });
                return out;
        }

        // Promoted rules leave the candidate ledger at PARK time (they live in
        // the review queue now); the ship-time re-dedupe catches future
        // re-observations, and a discard re-parks under a new id with more
        // evidence behind it — "more projects, re-ask" is the honest behavior.
        for (const rv of review) {
                store.run(`DELETE FROM hoist_candidates WHERE rule_hash = ?`, [hoistRuleHash(rv.rule)]);
        }

        const out: HoistResult = {
                hoisted: review.length,
                rules: review.map((rv) => rv.rule),
                review,
                parked: parkedWaiting,
                skipped,
                guardAction: guard.action,
        };
        emit("hoist:finished", { ...out, slug: opts.slug, project: opts.slug });
        return out;
}
