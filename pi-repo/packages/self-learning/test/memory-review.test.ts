/**
 * memory-review.test.ts — the memory review queue (Memory v2 round, 2026-11-12;
 * rewired user-level by the Memory Divertimento round, 2026-11-14).
 *
 * The review queue gates model-inferred user-tier memories (cross-project
 * hoist candidates) behind a human approve/discard. This suite pins the
 * contract: park creates a candidate, list sorts oldest-first, approve/
 * discard stamp the verdict (retained for audit, not deleted), dedup is
 * id-based, a decided candidate is NEVER overwritten (a re-observation
 * parks under a -r<N> id), and the queue depth is queryable for the health
 * card. The queue is USER-LEVEL (`<home>/memory/review-queue/`) — one
 * inbox across projects — so every case injects a temp home the way the
 * real call sites rely on the default home resolution.
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
        resolveReviewHome,
} from "../src/memory-review.ts";

let home: string;

beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), "unown-review-test-"));
});

afterEach(() => {
        rmSync(home, { recursive: true, force: true });
});

test("parkMemoryReviewCandidate creates a candidate file in the review queue dir", () => {
        const id = parkMemoryReviewCandidate(
                {
                        rule: "comments in sentence case, no trailing periods",
                        type: "preference",
                        projects: ["project-a", "project-b"],
                        evidence: "observed in 2 distinct projects via the hoist gate",
                        source: "hoist",
                },
                home,
        );
        expect(id).toMatch(/^rv-[0-9a-f]+(-r\d+)?$/);
        const candidates = listMemoryReviewCandidates(home);
        expect(candidates.length).toBe(1);
        expect(candidates[0].rule).toBe("comments in sentence case, no trailing periods");
        expect(candidates[0].status).toBe("pending");
        expect(candidates[0].type).toBe("preference");
        expect(candidates[0].projects).toEqual(["project-a", "project-b"]);
});

test("listMemoryReviewCandidates sorts oldest-first", async () => {
        parkMemoryReviewCandidate({ rule: "rule-a", projects: ["p1"], evidence: "ev", source: "hoist" }, home);
        await new Promise((r) => setTimeout(r, 10));
        parkMemoryReviewCandidate({ rule: "rule-b", projects: ["p2"], evidence: "ev", source: "hoist" }, home);
        const candidates = listMemoryReviewCandidates(home);
        expect(candidates.length).toBe(2);
        expect(candidates[0].rule).toBe("rule-a"); // oldest first
        expect(candidates[1].rule).toBe("rule-b");
});

test("listPendingMemoryReviewCandidates filters to pending only", () => {
        const id1 = parkMemoryReviewCandidate({ rule: "rule-a", projects: ["p1"], evidence: "ev", source: "hoist" }, home);
        parkMemoryReviewCandidate({ rule: "rule-b", projects: ["p2"], evidence: "ev", source: "hoist" }, home);
        approveMemoryReviewCandidate(id1, { version: 7 }, home);
        const pending = listPendingMemoryReviewCandidates(home);
        expect(pending.length).toBe(1);
        expect(pending[0].rule).toBe("rule-b"); // only the pending one
});

test("memoryReviewQueueDepth counts pending candidates", () => {
        expect(memoryReviewQueueDepth(home)).toBe(0);
        parkMemoryReviewCandidate({ rule: "r1", projects: ["p"], evidence: "e", source: "hoist" }, home);
        parkMemoryReviewCandidate({ rule: "r2", projects: ["p"], evidence: "e", source: "hoist" }, home);
        expect(memoryReviewQueueDepth(home)).toBe(2);
});

test("getMemoryReviewCandidate returns by id", () => {
        const id = parkMemoryReviewCandidate(
                { rule: "use bun for all builds", projects: ["p1"], evidence: "ev", source: "hoist" },
                home,
        );
        const c = getMemoryReviewCandidate(id, home);
        expect(c).toBeDefined();
        expect(c!.id).toBe(id);
        expect(c!.rule).toBe("use bun for all builds");
});

test("approveMemoryReviewCandidate stamps approved + decidedAt + shippedVersion", () => {
        const id = parkMemoryReviewCandidate({ rule: "rule-x", projects: ["p"], evidence: "e", source: "hoist" }, home);
        const approved = approveMemoryReviewCandidate(id, { version: 12 }, home);
        expect(approved).toBeDefined();
        expect(approved!.status).toBe("approved");
        expect(approved!.decidedAt).toBeDefined();
        expect(approved!.shippedAt).toBeDefined();
        expect(approved!.shippedVersion).toBe(12);
        // the candidate stays in the queue for audit
        const c = getMemoryReviewCandidate(id, home);
        expect(c).toBeDefined();
        expect(c!.status).toBe("approved");
        expect(c!.shippedVersion).toBe(12);
});

test("discardMemoryReviewCandidate stamps discarded + reason", () => {
        const id = parkMemoryReviewCandidate({ rule: "rule-y", projects: ["p"], evidence: "e", source: "hoist" }, home);
        const discarded = discardMemoryReviewCandidate(id, "too project-specific for user tier", home);
        expect(discarded).toBeDefined();
        expect(discarded!.status).toBe("discarded");
        expect(discarded!.discardReason).toBe("too project-specific for user tier");
        expect(discarded!.decidedAt).toBeDefined();
        // the candidate stays in the queue for audit
        const c = getMemoryReviewCandidate(id, home);
        expect(c).toBeDefined();
        expect(c!.status).toBe("discarded");
});

test("parkMemoryReviewCandidate deduplicates: same id (same rule+projects) is a no-op when pending", () => {
        const id1 = parkMemoryReviewCandidate(
                { rule: "same rule", projects: ["p1", "p2"], evidence: "ev1", source: "hoist" },
                home,
        );
        const first = getMemoryReviewCandidate(id1, home);
        // park the same rule+projects again — should be a no-op
        const id2 = parkMemoryReviewCandidate(
                { rule: "same rule", projects: ["p1", "p2"], evidence: "ev2 (different evidence, same id)", source: "hoist" },
                home,
        );
        expect(id1).toBe(id2); // same id
        const second = getMemoryReviewCandidate(id1, home);
        expect(second!.evidence).toBe("ev1"); // original evidence preserved
        expect(second!.createdAt).toBe(first!.createdAt); // original createdAt preserved
});

test("a decided candidate is never overwritten: a same-id re-observation parks under a -r<N> id", () => {
        const id1 = parkMemoryReviewCandidate(
                { rule: "re-observed rule", projects: ["p1", "p2"], evidence: "first evidence", source: "hoist" },
                home,
        );
        discardMemoryReviewCandidate(id1, "not this time", home);
        // the same rule observed again with the SAME evidence set (same id):
        // the earlier verdict must survive — the re-park takes a NEW id
        const id2 = parkMemoryReviewCandidate(
                { rule: "re-observed rule", projects: ["p1", "p2"], evidence: "second evidence", source: "hoist" },
                home,
        );
        expect(id2).toMatch(/^rv-[0-9a-f]+-r1$/);
        expect(id2).not.toBe(id1);
        // the earlier verdict stays auditable, untouched
        const first = getMemoryReviewCandidate(id1, home);
        expect(first!.status).toBe("discarded");
        expect(first!.evidence).toBe("first evidence");
        // and the new candidate is pending with the newer evidence
        const second = getMemoryReviewCandidate(id2, home);
        expect(second!.status).toBe("pending");
        expect(second!.evidence).toBe("second evidence");
        // a third same-id observation parks as -r2 (the -r counter keeps climbing)
        discardMemoryReviewCandidate(id2, "still no", home);
        const id3 = parkMemoryReviewCandidate(
                { rule: "re-observed rule", projects: ["p1", "p2"], evidence: "third", source: "hoist" },
                home,
        );
        expect(id3).toMatch(/^rv-[0-9a-f]+-r2$/);
        // a re-observation with MORE projects is a DIFFERENT identity in the id
        // scheme (hash covers the project set) — it parks under its own base id,
        // a fresh candidate, no -r suffix
        const id4 = parkMemoryReviewCandidate(
                { rule: "re-observed rule", projects: ["p1", "p2", "p3"], evidence: "broader evidence", source: "hoist" },
                home,
        );
        expect(id4).toMatch(/^rv-[0-9a-f]+$/);
        expect(id4).not.toBe(id1);
        expect(getMemoryReviewCandidate(id4, home)!.status).toBe("pending");
});

test("memoryReviewId is deterministic: same rule+projects = same id", () => {
        const id1 = memoryReviewId("rule-x", ["p1", "p2"]);
        const id2 = memoryReviewId("rule-x", ["p2", "p1"]); // order-insensitive
        expect(id1).toBe(id2);
        const id3 = memoryReviewId("rule-y", ["p1", "p2"]); // different rule
        expect(id1).not.toBe(id3);
});

test("removeMemoryReviewCandidate removes the file", () => {
        const id = parkMemoryReviewCandidate({ rule: "to-remove", projects: ["p"], evidence: "e", source: "hoist" }, home);
        expect(getMemoryReviewCandidate(id, home)).toBeDefined();
        removeMemoryReviewCandidate(id, home);
        expect(getMemoryReviewCandidate(id, home)).toBeUndefined();
});

test("memoryReviewDir is the user-level review queue under the home's memory dir", () => {
        // join()-based assertion — the Windows engine-test lane caught the
        // POSIX-only form expecting forward separators while join() produces
        // backslashes there. The queue is USER-LEVEL: <home>/memory/
        // review-queue (riding the terminal user tier's home), so it answers
        // from ANY project — one inbox, not one per project.
        const dir = memoryReviewDir("/some/home");
        expect(dir).toBe(join("/some/home", "memory", "review-queue"));
        // and the tail is the expected relative shape on every platform
        const parts = dir.split(/[\\/]/).filter(Boolean);
        expect(parts.slice(-2)).toEqual(["memory", "review-queue"]);
});

test("resolveReviewHome honors UNOWN_HOME (empty means unset)", () => {
        const prev = process.env.UNOWN_HOME;
        try {
                process.env.UNOWN_HOME = "/some/unown/home";
                expect(memoryReviewDir()).toBe(join("/some/unown/home", "memory", "review-queue"));
                // empty = unset: the default ~/.unown applies (never an empty path)
                process.env.UNOWN_HOME = "";
                expect(memoryReviewDir()).toBe(join(join(require("node:os").homedir(), ".unown"), "memory", "review-queue"));
        } finally {
                if (prev === undefined) delete process.env.UNOWN_HOME;
                else process.env.UNOWN_HOME = prev;
        }
        expect(typeof resolveReviewHome()).toBe("string");
        expect(resolveReviewHome().length).toBeGreaterThan(0);
});

// ------------------------------------------------------- edge cases

test("listMemoryReviewCandidates on a non-existent dir returns []", () => {
        expect(listMemoryReviewCandidates("/nonexistent/home/path")).toEqual([]);
});

test("memoryReviewQueueDepth on a non-existent dir is 0", () => {
        expect(memoryReviewQueueDepth("/nonexistent/home/path")).toBe(0);
});

test("approveMemoryReviewCandidate on a non-existent id returns undefined", () => {
        expect(approveMemoryReviewCandidate("rv-nonexistent", undefined, home)).toBeUndefined();
});

test("discardMemoryReviewCandidate on a non-existent id returns undefined", () => {
        expect(discardMemoryReviewCandidate("rv-nonexistent", "reason", home)).toBeUndefined();
});

test("the review queue survives a corrupt candidate file (skip, never crash)", () => {
        // park a valid candidate
        parkMemoryReviewCandidate({ rule: "good", projects: ["p"], evidence: "e", source: "hoist" }, home);
        // write a corrupt candidate alongside it
        const dir = memoryReviewDir(home);
        writeFileSync(join(dir, "rv-corrupt.json"), "{ not valid json");
        // the list skips the corrupt file and returns the valid one
        const candidates = listMemoryReviewCandidates(home);
        expect(candidates.length).toBe(1);
        expect(candidates[0].rule).toBe("good");
});
