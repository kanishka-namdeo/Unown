/**
 * memory-review.test.ts — the memory review queue (Memory v2 round, 2026-11-12).
 *
 * The review queue gates model-inferred memories (cross-project hoist
 * candidates, salvage-lane inferred patterns) behind a human approve/discard.
 * Modeled on dream-review.ts (the pending-dream lane) and skills.ts (the
 * staged-skills lane). This suite pins the contract: park creates a
 * candidate, list sorts oldest-first, approve/discard stamp the verdict
 * (retained for audit, not deleted), dedup is id-based, and the queue depth
 * is queryable for the health card.
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        approveMemoryReviewCandidate,
        discardMemoryReviewCandidate,
        getMemoryReviewCandidate,
        listMemoryReviewCandidates,
        listPendingMemoryReviewCandidates,
        memoryReviewDir,
        memoryReviewId,
        memoryReviewQueueDepth,
        parkMemoryReviewCandidate,
        removeMemoryReviewCandidate,
} from "../src/memory-review.ts";

let projectPath: string;

beforeEach(() => {
        projectPath = mkdtempSync(join(tmpdir(), "unown-review-test-"));
});

afterEach(() => {
        rmSync(projectPath, { recursive: true, force: true });
});

test("parkMemoryReviewCandidate creates a candidate file in the review queue dir", () => {
        const id = parkMemoryReviewCandidate(projectPath, {
                rule: "comments in sentence case, no trailing periods",
                type: "preference",
                projects: ["project-a", "project-b"],
                evidence: "observed in 2 distinct projects via the hoist gate",
                source: "hoist",
        });
        expect(id).toMatch(/^rv-[0-9a-f]+$/);
        const candidates = listMemoryReviewCandidates(projectPath);
        expect(candidates.length).toBe(1);
        expect(candidates[0].rule).toBe("comments in sentence case, no trailing periods");
        expect(candidates[0].status).toBe("pending");
        expect(candidates[0].type).toBe("preference");
        expect(candidates[0].projects).toEqual(["project-a", "project-b"]);
});

test("listMemoryReviewCandidates sorts oldest-first", async () => {
        parkMemoryReviewCandidate(projectPath, {
                rule: "rule-a",
                projects: ["p1"],
                evidence: "ev",
                source: "hoist",
        });
        await new Promise((r) => setTimeout(r, 10));
        parkMemoryReviewCandidate(projectPath, {
                rule: "rule-b",
                projects: ["p2"],
                evidence: "ev",
                source: "hoist",
        });
        const candidates = listMemoryReviewCandidates(projectPath);
        expect(candidates.length).toBe(2);
        expect(candidates[0].rule).toBe("rule-a"); // oldest first
        expect(candidates[1].rule).toBe("rule-b");
});

test("listPendingMemoryReviewCandidates filters to pending only", () => {
        const id1 = parkMemoryReviewCandidate(projectPath, {
                rule: "rule-a",
                projects: ["p1"],
                evidence: "ev",
                source: "hoist",
        });
        parkMemoryReviewCandidate(projectPath, {
                rule: "rule-b",
                projects: ["p2"],
                evidence: "ev",
                source: "hoist",
        });
        approveMemoryReviewCandidate(projectPath, id1);
        const pending = listPendingMemoryReviewCandidates(projectPath);
        expect(pending.length).toBe(1);
        expect(pending[0].rule).toBe("rule-b"); // only the pending one
});

test("memoryReviewQueueDepth counts pending candidates", () => {
        expect(memoryReviewQueueDepth(projectPath)).toBe(0);
        parkMemoryReviewCandidate(projectPath, { rule: "r1", projects: ["p"], evidence: "e", source: "hoist" });
        parkMemoryReviewCandidate(projectPath, { rule: "r2", projects: ["p"], evidence: "e", source: "hoist" });
        expect(memoryReviewQueueDepth(projectPath)).toBe(2);
});

test("getMemoryReviewCandidate returns by id", () => {
        const id = parkMemoryReviewCandidate(projectPath, {
                rule: "use bun for all builds",
                projects: ["p1"],
                evidence: "ev",
                source: "hoist",
        });
        const c = getMemoryReviewCandidate(projectPath, id);
        expect(c).toBeDefined();
        expect(c!.id).toBe(id);
        expect(c!.rule).toBe("use bun for all builds");
});

test("approveMemoryReviewCandidate stamps approved + decidedAt", () => {
        const id = parkMemoryReviewCandidate(projectPath, {
                rule: "rule-x",
                projects: ["p"],
                evidence: "e",
                source: "hoist",
        });
        const approved = approveMemoryReviewCandidate(projectPath, id);
        expect(approved).toBeDefined();
        expect(approved!.status).toBe("approved");
        expect(approved!.decidedAt).toBeDefined();
        // the candidate stays in the queue for audit
        const c = getMemoryReviewCandidate(projectPath, id);
        expect(c).toBeDefined();
        expect(c!.status).toBe("approved");
});

test("discardMemoryReviewCandidate stamps discarded + reason", () => {
        const id = parkMemoryReviewCandidate(projectPath, {
                rule: "rule-y",
                projects: ["p"],
                evidence: "e",
                source: "hoist",
        });
        const discarded = discardMemoryReviewCandidate(projectPath, id, "too project-specific for user tier");
        expect(discarded).toBeDefined();
        expect(discarded!.status).toBe("discarded");
        expect(discarded!.discardReason).toBe("too project-specific for user tier");
        expect(discarded!.decidedAt).toBeDefined();
        // the candidate stays in the queue for audit
        const c = getMemoryReviewCandidate(projectPath, id);
        expect(c).toBeDefined();
        expect(c!.status).toBe("discarded");
});

test("parkMemoryReviewCandidate deduplicates: same id (same rule+projects) is a no-op when pending", () => {
        const id1 = parkMemoryReviewCandidate(projectPath, {
                rule: "same rule",
                projects: ["p1", "p2"],
                evidence: "ev1",
                source: "hoist",
        });
        const first = getMemoryReviewCandidate(projectPath, id1);
        // park the same rule+projects again — should be a no-op
        const id2 = parkMemoryReviewCandidate(projectPath, {
                rule: "same rule",
                projects: ["p1", "p2"],
                evidence: "ev2 (different evidence, same id)",
                source: "hoist",
        });
        expect(id1).toBe(id2); // same id
        const second = getMemoryReviewCandidate(projectPath, id1);
        expect(second!.evidence).toBe("ev1"); // original evidence preserved
        expect(second!.createdAt).toBe(first!.createdAt); // original createdAt preserved
});

test("memoryReviewId is deterministic: same rule+projects = same id", () => {
        const id1 = memoryReviewId("rule-x", ["p1", "p2"]);
        const id2 = memoryReviewId("rule-x", ["p2", "p1"]); // order-insensitive
        expect(id1).toBe(id2);
        const id3 = memoryReviewId("rule-y", ["p1", "p2"]); // different rule
        expect(id1).not.toBe(id3);
});

test("removeMemoryReviewCandidate removes the file", () => {
        const id = parkMemoryReviewCandidate(projectPath, {
                rule: "to-remove",
                projects: ["p"],
                evidence: "e",
                source: "hoist",
        });
        expect(getMemoryReviewCandidate(projectPath, id)).toBeDefined();
        removeMemoryReviewCandidate(projectPath, id);
        expect(getMemoryReviewCandidate(projectPath, id)).toBeUndefined();
});

test("memoryReviewDir is under .unown/memory/review-queue", () => {
        const dir = memoryReviewDir("/some/project");
        expect(dir).toBe("/some/project/.unown/memory/review-queue");
});

// ------------------------------------------------------- edge cases

test("listMemoryReviewCandidates on a non-existent dir returns []", () => {
        expect(listMemoryReviewCandidates("/nonexistent/project/path")).toEqual([]);
});

test("memoryReviewQueueDepth on a non-existent dir is 0", () => {
        expect(memoryReviewQueueDepth("/nonexistent/project/path")).toBe(0);
});

test("approveMemoryReviewCandidate on a non-existent id returns undefined", () => {
        expect(approveMemoryReviewCandidate(projectPath, "rv-nonexistent")).toBeUndefined();
});

test("discardMemoryReviewCandidate on a non-existent id returns undefined", () => {
        expect(discardMemoryReviewCandidate(projectPath, "rv-nonexistent", "reason")).toBeUndefined();
});

test("the review queue survives a corrupt candidate file (skip, never crash)", () => {
        // park a valid candidate
        parkMemoryReviewCandidate(projectPath, { rule: "good", projects: ["p"], evidence: "e", source: "hoist" });
        // write a corrupt candidate alongside it
        const dir = memoryReviewDir(projectPath);
        const { writeFileSync } = require("node:fs");
        writeFileSync(join(dir, "rv-corrupt.json"), "{ not valid json");
        // the list skips the corrupt file and returns the valid one
        const candidates = listMemoryReviewCandidates(projectPath);
        expect(candidates.length).toBe(1);
        expect(candidates[0].rule).toBe("good");
});
