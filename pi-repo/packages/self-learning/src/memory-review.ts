/**
 * memory-review.ts — the memory review queue (Memory v2 round, 2026-11-12;
 * wired by the Memory Divertimento round, 2026-11-14).
 *
 * The frontier has moved past "trust the dream" for inferred memories —
 * Supermemory's approve/decline/undo review queue for `derives` memories,
 * Letta's "Agent reviews before applying" second pass, and Mem0 PR #4719's
 * HITL overrides all gate model-inferred patterns behind a human.
 *
 * THE DIVERTIMENTO REWIRE (2026-11-14): the v2 round shipped this module
 * with ZERO callers — the hoist lane still auto-wrote both user tiers,
 * which is exactly the behavior CP3 was meant to gate. It is now wired:
 *
 *   - The queue is USER-LEVEL (`~/.unown/memory/review-queue/`, riding the
 *     terminal user tier's home): a hoisted rule is a USER-tier rule — it
 *     affects every project — so the inbox must be visible from ANY
 *     project, not scattered per-project. One inbox, one depth, every
 *     surface. (The v2 round's project-local design never shipped, so
 *     there is no migration: no queue exists in any install yet.)
 *   - `hoist.ts` parks every promoted rule here instead of writing; the
 *     ship happens ONLY at approve time (`memory-review-ship.ts`), which
 *     performs the exact dual-target write the old auto-hoist did —
 *     re-deduped and re-guarded at decision time.
 *   - The queue is served by the engine (`GET/POST /api/memory/review`),
 *     rendered in the TUI (`/memory review`), the CLI (`unown memory
 *     review`), and the dashboard Memory screen; the health card carries
 *     `reviewQueueDepth` with a live `review-pending` warning.
 *
 * The candidate carries the observing projects as provenance (the
 * `PI_HOIST_MIN_PROJECTS=2` evidence) so the human can see WHY the model
 * inferred this was a user-tier rule. Approve ships it (the caller
 * performs the user-tier write); discard records the verdict and keeps
 * the candidate for audit — the decision is retained, not deleted (the
 * same shape as the bi-temporal supersede).
 *
 * Modeled on dream-review.ts (the pending-dream lane) and skills.ts (the
 * staged-skills lane). Atomic writes throughout; unreadable candidates are
 * skipped, never a crash of the inbox.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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
        /** The source lane that parked this candidate (hoist / salvage / import). */
        source: string;
        /** When the approve shipped the rule to the tiers, the engine user-tier
         *  version it landed at (audit; absent while pending or on discard). */
        shippedVersion?: number;
        /** ts the approve actually shipped (audit; absent while pending). */
        shippedAt?: number;
}

/**
 * Resolve the unown home. Same env contract as term.ts's `resolveUnownHome`
 * (`UNOWN_HOME` with `||` semantics — an EMPTY value means "unset, use the
 * default"), resolved at CALL time (not import time) so tests can redirect
 * per-case. Keep in sync with term.ts.
 */
export function resolveReviewHome(): string {
        return process.env.UNOWN_HOME || homedir() + "/.unown";
}

/** The review queue directory: `<unown home>/memory/review-queue/` — the
 *  same home as the terminal user tier (`~/.unown/memory/user.md`), so the
 *  inbox is visible from any project. `home` overrides for tests. */
export function memoryReviewDir(home?: string): string {
        return join(home ?? resolveReviewHome(), "memory", "review-queue");
}

function candidatePath(home: string, id: string): string {
        return join(memoryReviewDir(home), `${id}.json`);
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
export function parkMemoryReviewCandidate(
        candidate: Omit<MemoryReviewCandidate, "id" | "createdAt" | "status"> & { id?: string; createdAt?: number },
        home?: string,
): string {
        const id = candidate.id ?? memoryReviewId(candidate.rule, candidate.projects);
        const h = home ?? resolveReviewHome();
        const dir = memoryReviewDir(h);
        mkdirSync(dir, { recursive: true });
        const path = candidatePath(h, id);
        // dedup: if the candidate already exists and is pending, don't overwrite
        if (existsSync(path)) {
                try {
                        const existing = JSON.parse(readFileSync(path, "utf8")) as MemoryReviewCandidate;
                        if (existing?.status === "pending") return id;
                        // An APPROVED/DISCARDED candidate with the same id is a RE-observation
                        // after a verdict (usually with more projects behind it): park as a
                        // NEW id (`-r1`, `-r2`, …) — the earlier verdict stays auditable and
                        // is never overwritten (the same shape as the bi-temporal supersede).
                        if (existing?.status === "approved" || existing?.status === "discarded") {
                                let n = 1;
                                while (existsSync(candidatePath(h, `${id}-r${n}`))) n++;
                                return parkMemoryReviewCandidate({ ...candidate, id: `${id}-r${n}` }, h);
                        }
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
export function listMemoryReviewCandidates(home?: string): MemoryReviewCandidate[] {
        const dir = memoryReviewDir(home);
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
export function listPendingMemoryReviewCandidates(home?: string): MemoryReviewCandidate[] {
        return listMemoryReviewCandidates(home).filter((c) => c.status === "pending");
}

/** The pending queue depth (the health card's reviewQueueDepth source). */
export function memoryReviewQueueDepth(home?: string): number {
        return listPendingMemoryReviewCandidates(home).length;
}

export function getMemoryReviewCandidate(id: string, home?: string): MemoryReviewCandidate | undefined {
        return listMemoryReviewCandidates(home).find((c) => c.id === id);
}

/** Approve a candidate: stamp it approved. The CALLER performs the actual
 *  user-tier write (memory-review-ship.ts) — stamp only after the ship
 *  succeeds, so a failed write leaves the candidate pending and retryable.
 *  `shippedVersion`/`shippedAt` record the audit trail. Returns the updated
 *  candidate, or undefined when the candidate doesn't exist. */
export function approveMemoryReviewCandidate(
        id: string,
        shipped?: { version: number },
        home?: string,
): MemoryReviewCandidate | undefined {
        const candidate = getMemoryReviewCandidate(id, home);
        if (!candidate) return undefined;
        const decidedAt = Date.now();
        const updated: MemoryReviewCandidate = {
                ...candidate,
                status: "approved",
                decidedAt,
                shippedAt: decidedAt,
                ...(shipped ? { shippedVersion: shipped.version } : {}),
        };
        writeCandidate(home, updated);
        return updated;
}

/** Discard a candidate: stamp it discarded with an optional reason. The
 *  candidate stays in the queue for audit (the same shape as the bi-temporal
 *  supersede — the decision is retained, not deleted). Returns the updated
 *  candidate, or undefined when the candidate doesn't exist. */
export function discardMemoryReviewCandidate(id: string, reason?: string, home?: string): MemoryReviewCandidate | undefined {
        const candidate = getMemoryReviewCandidate(id, home);
        if (!candidate) return undefined;
        const updated: MemoryReviewCandidate = { ...candidate, status: "discarded", decidedAt: Date.now(), discardReason: reason };
        writeCandidate(home, updated);
        return updated;
}

/** Remove a candidate entirely (the cleanup path — an approved candidate
 *  that shipped, or a discarded one past its audit window). */
export function removeMemoryReviewCandidate(id: string, home?: string): void {
        rmSync(candidatePath(home ?? resolveReviewHome(), id), { force: true });
}

function writeCandidate(home: string | undefined, candidate: MemoryReviewCandidate): void {
        const path = candidatePath(home ?? resolveReviewHome(), candidate.id);
        const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
        writeFileSync(tmp, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
        renameSync(tmp, path);
}
