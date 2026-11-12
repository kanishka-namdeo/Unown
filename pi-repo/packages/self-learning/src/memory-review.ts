/**
 * memory-review.ts — the memory review queue (Memory v2 round, 2026-11-12).
 *
 * The frontier has moved past "trust the dream" for inferred memories —
 * Supermemory's approve/decline/undo review queue for `derives` memories,
 * Letta's "Agent reviews before applying" second pass, and Mem0 PR #4719's
 * HITL overrides all gate model-inferred patterns behind a human. Unown's
 * staged-skills lane (`.unown/skills-staged/` awaiting human `mv`) is the
 * precedent for skills but not yet for memories — cross-project hoists
 * auto-ship to the user tier today.
 *
 * This module is the memory equivalent: model-inferred memories that would
 * today auto-ship (cross-project hoist candidates, salvage-lane inferred
 * patterns) land in a review queue at `<project>/.unown/memory/review-queue/`
 * instead. The user approves (the candidate ships to the user tier exactly
 * as the hoist lane does today) or discards (the candidate is removed and
 * the discard is recorded for audit).
 *
 * Modeled on dream-review.ts (the pending-dream lane) and skills.ts (the
 * staged-skills lane). The queue is project-local, gitignored with the rest
 * of .unown runtime state, and self-contained — each candidate carries the
 * observing projects as provenance (the `PI_HOIST_MIN_PROJECTS=2` evidence)
 * so the human can see WHY the model inferred this was a user-tier rule.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The status of a review candidate. */
export type MemoryReviewStatus = "pending" | "approved" | "discarded";

/** A memory the model inferred should ship to the user tier, awaiting human
 *  review. The candidate carries the observing projects as provenance (the
 *  `PI_HOIST_MIN_PROJECTS` evidence) so the human can see WHY the model
 *  inferred this was a user-tier rule. */
export interface MemoryReviewCandidate {
        /** Stable id (hash of the rule text + projects). */
        id: string;
        /** The memory text the model inferred (a user-tier rule candidate). */
        rule: string;
        /** The memory type (fact/episode/procedure/preference — Memory v2 CP2). */
        type?: string;
        /** The projects that observed this rule (the hoist evidence). */
        projects: string[];
        /** The human-readable evidence summary (why the model inferred this). */
        evidence: string;
        /** ts the candidate was parked. */
        createdAt: number;
        /** The candidate's status (pending = awaiting review; approved/discarded
         *  = the human's verdict, recorded for audit). */
        status: MemoryReviewStatus;
        /** ts the human approved or discarded (null while pending). */
        decidedAt?: number;
        /** The discard reason (when the human discarded with a note). */
        discardReason?: string;
        /** The source lane that parked this candidate (hoist / salvage / synthesis). */
        source: string;
}

/** The review queue directory: `<project>/.unown/memory/review-queue/`. */
export function memoryReviewDir(projectPath: string): string {
        return join(projectPath, ".unown", "memory", "review-queue");
}

function candidatePath(projectPath: string, id: string): string {
        return join(memoryReviewDir(projectPath), `${id}.json`);
}

/** A stable id for a candidate (hash of the rule + projects, so the same
 *  inference from the same evidence deduplicates). */
export function memoryReviewId(rule: string, projects: string[]): string {
        const key = `${rule}|${[...projects].sort().join(",")}`;
        // FNV-1a hash (deterministic, no deps) — same shape as the lexical embedder
        let h = 2166136261;
        for (let i = 0; i < key.length; i++) {
                h ^= key.charCodeAt(i);
                h = Math.imul(h, 16777619);
        }
        return `rv-${(h >>> 0).toString(16)}`;
}

/** Park a review candidate (atomic write). If a candidate with the same id
 *  already exists (same rule + projects), the park is a no-op — the
 *  candidate keeps its original createdAt and stays pending. */
export function parkMemoryReviewCandidate(projectPath: string, candidate: Omit<MemoryReviewCandidate, "id" | "createdAt" | "status"> & { id?: string; createdAt?: number }): string {
        const id = candidate.id ?? memoryReviewId(candidate.rule, candidate.projects);
        const dir = memoryReviewDir(projectPath);
        mkdirSync(dir, { recursive: true });
        const path = candidatePath(projectPath, id);
        // dedup: if the candidate already exists and is pending, don't overwrite
        if (existsSync(path)) {
                try {
                        const existing = JSON.parse(readFileSync(path, "utf8")) as MemoryReviewCandidate;
                        if (existing?.status === "pending") return id;
                } catch {
                        /* corrupt file — overwrite */
                }
        }
        const full: MemoryReviewCandidate = {
                id,
                rule: candidate.rule,
                type: candidate.type,
                projects: candidate.projects,
                evidence: candidate.evidence,
                createdAt: candidate.createdAt ?? Date.now(),
                status: "pending",
                source: candidate.source,
        };
        const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
        writeFileSync(tmp, `${JSON.stringify(full, null, 2)}\n`, "utf8");
        renameSync(tmp, path);
        return id;
}

/** List all review candidates (pending + decided), sorted oldest-first. */
export function listMemoryReviewCandidates(projectPath: string): MemoryReviewCandidate[] {
        const dir = memoryReviewDir(projectPath);
        if (!existsSync(dir)) return [];
        const out: MemoryReviewCandidate[] = [];
        for (const file of readdirSync(dir)) {
                if (!file.endsWith(".json")) continue;
                try {
                        const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as MemoryReviewCandidate;
                        if (typeof parsed?.id === "string" && typeof parsed?.rule === "string") {
                                out.push(parsed);
                        }
                } catch {
                        /* unreadable candidate — skip, never crash the inbox */
                }
        }
        return out.sort((a, b) => a.createdAt - b.createdAt);
}

/** List only pending candidates (the inbox). */
export function listPendingMemoryReviewCandidates(projectPath: string): MemoryReviewCandidate[] {
        return listMemoryReviewCandidates(projectPath).filter((c) => c.status === "pending");
}

/** The pending queue depth (the health card's reviewQueueDepth source). */
export function memoryReviewQueueDepth(projectPath: string): number {
        return listPendingMemoryReviewCandidates(projectPath).length;
}

export function getMemoryReviewCandidate(projectPath: string, id: string): MemoryReviewCandidate | undefined {
        return listMemoryReviewCandidates(projectPath).find((c) => c.id === id);
}

/** Approve a candidate: stamp it approved (the caller performs the actual
 *  user-tier write — the hoist lane's dual-target write). Returns the
 *  updated candidate, or undefined when the candidate doesn't exist. */
export function approveMemoryReviewCandidate(projectPath: string, id: string): MemoryReviewCandidate | undefined {
        const candidate = getMemoryReviewCandidate(projectPath, id);
        if (!candidate) return undefined;
        writeCandidate(projectPath, { ...candidate, status: "approved", decidedAt: Date.now() });
        return { ...candidate, status: "approved", decidedAt: Date.now() };
}

/** Discard a candidate: stamp it discarded with an optional reason. The
 *  candidate stays in the queue for audit (the same shape as the bi-temporal
 *  supersede — the decision is retained, not deleted). Returns the updated
 *  candidate, or undefined when the candidate doesn't exist. */
export function discardMemoryReviewCandidate(projectPath: string, id: string, reason?: string): MemoryReviewCandidate | undefined {
        const candidate = getMemoryReviewCandidate(projectPath, id);
        if (!candidate) return undefined;
        writeCandidate(projectPath, { ...candidate, status: "discarded", decidedAt: Date.now(), discardReason: reason });
        return { ...candidate, status: "discarded", decidedAt: Date.now(), discardReason: reason };
}

/** Remove a candidate entirely (the cleanup path — an approved candidate
 *  that shipped, or a discarded one past its audit window). */
export function removeMemoryReviewCandidate(projectPath: string, id: string): void {
        rmSync(candidatePath(projectPath, id), { force: true });
}

function writeCandidate(projectPath: string, candidate: MemoryReviewCandidate): void {
        const path = candidatePath(projectPath, candidate.id);
        const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
        writeFileSync(tmp, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
        renameSync(tmp, path);
}
