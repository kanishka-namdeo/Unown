/**
 * memory-review-ship.ts — the approve-and-ship lane (Memory Divertimento
 * round, 2026-11-14).
 *
 * The review queue's write side. `approveAndShipMemoryReview(id)` is the
 * ONE action every surface (engine API, `unown memory review approve`,
 * `/memory review approve`) funnels into:
 *
 *   1. load the candidate (must exist and be pending — a decided candidate
 *      is never re-shipped; a re-observation after a verdict parks under a
 *      new id instead);
 *   2. RE-VERIFY at decision time — the tiers may have moved since the
 *      park: re-dedupe against BOTH user tiers (a rule that already landed
 *      by another path is skipped, reported, never duplicated) and re-run
 *      the deterministic guard on the block (a "gate" verdict refuses the
 *      ship; "sanitize" drops the flagged lines and ships the survivors);
 *   3. write BOTH user tiers exactly as the old auto-hoist did — engine
 *      tier first (versioned, transactional: a throw leaves NOTHING
 *      written), then the terminal tier (atomic tmp+rename). Because step
 *      2 re-dedupes, a retry after a mid-flight failure converges instead
 *      of duplicating (the engine tier's copy reads as a dupe on retry and
 *      only the terminal side lands);
 *   4. stamp the candidate approved — only AFTER the ship succeeds, with
 *      `shippedVersion` recorded — so a failed ship leaves it pending and
 *      retryable, never "approved but never written".
 *
 * Idempotence contract: the whole operation is safe to re-run. The changedBy
 * domain stays `autodream-hoist` (the same writer the tiers already render);
 * the provenance note names the observing projects AND the review decision,
 * so the tier's attribution line answers "who decided this, on what
 * evidence" in one line.
 */
import { decideGuardAction, type GuardDecision } from "./guard.ts";
import {
        approveMemoryReviewCandidate,
        getMemoryReviewCandidate,
        type MemoryReviewCandidate,
} from "./memory-review.ts";
import { appendRules, currentVersion, readTier, type Tier } from "./memory.ts";
import { appendTerminalUserRules, isPristineTerminalUserTier, readTerminalUserTier } from "./term.ts";

/** The happy-path ship result. */
export interface MemoryReviewShipOk {
        ok: true;
        id: string;
        /** The rules written to both user tiers. */
        shipped: string[];
        /** Rules already present in a tier at ship time (skipped, reported). */
        skippedDupes: string[];
        /** Rules the re-guard dropped under "sanitize" at ship time. */
        droppedByGuard: string[];
        /** The engine user-tier version AFTER the append. */
        tierVersion: number;
        /** The candidate as stamped (approved + shippedVersion). */
        candidate: MemoryReviewCandidate;
}

/** The refusal/failure shapes. `guard-gate` carries the flags so the human
 *  can see WHY the re-guard refused (they may discard instead). */
export interface MemoryReviewShipErr {
        ok: false;
        id: string;
        code: "not-found" | "already-decided" | "guard-gate" | "write-failed";
        error: string;
        flags?: unknown[];
}

export type MemoryReviewShipResult = MemoryReviewShipOk | MemoryReviewShipErr;

/** The guard block for a set of rules — the same shape the hoist writes. */
function guardBlock(rules: string[]): string {
        return rules.map((r) => `- ${r}`).join("\n");
}

export async function approveAndShipMemoryReview(id: string, home?: string): Promise<MemoryReviewShipResult> {
        const candidate = getMemoryReviewCandidate(id, home);
        if (!candidate) {
                return { ok: false, id, code: "not-found", error: `no memory review candidate "${id}"` };
        }
        if (candidate.status !== "pending") {
                return {
                        ok: false,
                        id,
                        code: "already-decided",
                        error: `candidate "${id}" is already ${candidate.status} (decided ${candidate.decidedAt ? new Date(candidate.decidedAt).toISOString() : "?"}) — re-observations park under a new id`,
                };
        }
        const rules = [candidate.rule];

        // ---- 1. re-dedupe against BOTH user tiers (the park-time dedupe is
        // stale by definition: the human may have hand-written the rule into
        // either tier while the candidate sat in the queue).
        const terminalUser = readTerminalUserTier();
        const engineUser = readTier("user" as Tier);
        const present = new Set(
                [...terminalUser.split("\n"), ...engineUser.split("\n")]
                        .map((l) => l.trim().replace(/^[-*]\s+/, ""))
                        .filter(Boolean)
                        .map((l) => l.toLowerCase().replace(/\s+/g, " ").trim()),
        );
        const skippedDupes = rules.filter((r) => present.has(String(r).toLowerCase().replace(/\s+/g, " ").trim()));
        const candidates = rules.filter((r) => !skippedDupes.includes(r));
        if (!candidates.length) {
                // nothing left to ship — the human's approve is a no-op write; stamp
                // it approved (the decision is real) with no version bump.
                const stamped = approveMemoryReviewCandidate(id, undefined, home);
                return {
                        ok: true,
                        id,
                        shipped: [],
                        skippedDupes,
                        droppedByGuard: [],
                        tierVersion: currentVersion("user" as Tier),
                        candidate: stamped!,
                };
        }

        // ---- 2. re-run the deterministic guard at decision time (the tiers
        // moved; the block must be re-judged against TODAY's content). The
        // firstMint expression mirrors the hoist's: a still-pristine tier gets
        // first-mint semantics, an established tier gets line quarantine.
        const guard: GuardDecision = decideGuardAction(guardBlock(candidates), terminalUser, {
                firstMint: currentVersion("user" as Tier) <= 1 && isPristineTerminalUserTier(terminalUser),
        });
        let survivors: string[] = candidates;
        const droppedByGuard: string[] = [];
        if (guard.action === "gate") {
                return {
                        ok: false,
                        id,
                        code: "guard-gate",
                        error: `the guard re-check at decision time refuses this block (verdict: gate) — discard the candidate, or fix what the flags name`,
                        flags: guard.flags,
                };
        } else if (guard.action === "sanitize") {
                const dropLines = new Set(guard.flags.map((f) => f.line));
                survivors = candidates.filter((_, i) => !dropLines.has(i + 1));
                droppedByGuard.push(...candidates.filter((_, i) => dropLines.has(i + 1)));
                if (!survivors.length) {
                        return {
                                ok: false,
                                id,
                                code: "guard-gate",
                                error: `the guard re-check dropped every rule (sanitize found flags on all lines) — nothing to ship`,
                                flags: guard.flags,
                        };
                }
        }

        // ---- 3. dual-target write, engine tier first (a throw leaves nothing).
        const projects = [...new Set(candidate.projects)];
        const stamp = new Date().toISOString().slice(0, 10);
        const provenance = `hoisted from ${projects.length} project(s): ${projects.join(", ")} (${stamp}) — approved via memory review ${id}`;
        let tierVersion: number;
        try {
                tierVersion = await appendRules("user" as Tier, survivors, "autodream-hoist", provenance);
                appendTerminalUserRules(survivors, "autodream-hoist", provenance);
        } catch (err: unknown) {
                return {
                        ok: false,
                        id,
                        code: "write-failed",
                        error: `tier write failed (${err instanceof Error ? err.message : String(err)}) — the candidate stays pending; re-running approve is safe (the re-dedupe makes it converge instead of duplicating)`,
                };
        }

        // ---- 4. stamp approved only after the ship landed.
        const stamped = approveMemoryReviewCandidate(id, { version: tierVersion }, home);
        return {
                ok: true,
                id,
                shipped: survivors,
                skippedDupes,
                droppedByGuard,
                tierVersion,
                candidate: stamped!,
        };
}
