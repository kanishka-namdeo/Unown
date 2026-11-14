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
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
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
        parseMemoryReviewDiscard,
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

// ---------------------------------------------------------------------------
// parseMemoryReviewDiscard — the linear `discard <id> [--reason <text>]`
// parser (CodeQL js/polynomial-redos alert #91: the original
// /^discard\s+(\S+)(?:\s+--reason\s+(.+))?$/i was polynomial on adversarial
// input; this battery was run against BOTH implementations before the swap
// and pins their behavioral identity — the #90 linear-pass precedent).
// ---------------------------------------------------------------------------
describe("parseMemoryReviewDiscard — the linear discard parser (alert #91)", () => {
        const CASES: Array<[string, string, { id: string; reason?: string } | undefined]> = [
                // the two shapes the surfaces actually receive
                ["bare id", "discard abc", { id: "abc" }],
                ["id + reason", "discard abc --reason too specific", { id: "abc", reason: "too specific" }],
                // case-insensitivity of BOTH the command and the flag (/i)
                ["upper command + flag", "DISCARD ABC --REASON why", { id: "ABC", reason: "why" }],
                ["mixed case", "Discard abc --Reason r", { id: "abc", reason: "r" }],
                // the flag boundary: the regex's literal match
                ["flag-prefix word is not the flag", "discard abc --reasonx y", undefined],
                ["id alone cannot be the flag", "discard --reason x", undefined],
                ["the reason may itself be the flag word", "discard abc --reason --reason", { id: "abc", reason: "--reason" }],
                // the `$` anchor's rejections
                ["flag with no text", "discard abc --reason", undefined],
                ["flag with only a trailing space", "discard abc --reason ", undefined],
                ["second token is not the flag", "discard abc def", undefined],
                ["trailing separator after the id", "discard abc ", undefined],
                // the `.` semantics: a reason containing a line terminator can
                // never reach `$` — the whole match fails
                ["newline inside the reason", "discard abc --reason r1\nr2", undefined],
                ["CR inside the reason", "discard abc --reason r\r", undefined],
                ["newline after the id", "discard abc\ndef", undefined],
                // degenerate shapes
                ["bare command", "discard", undefined],
                ["command + space only", "discard ", undefined],
                ["empty input", "", undefined],
                ["not the discard command", "approve abc", undefined],
                ["prefix word", "discardabc", undefined],
                // whitespace runs the regex's \s+ accepts
                ["tab separators", "discard\tabc\t--reason\tr", { id: "abc", reason: "r" }],
                ["double spaces everywhere", "discard  abc   --reason   keep  spaces ", { id: "abc", reason: "keep  spaces " }],
                ["one-char reason", "discard abc --reason x", { id: "abc", reason: "x" }],
                // realistic ids
                ["hash-shaped id", "discard rv-1a2b3c4d --reason dup of shipped", { id: "rv-1a2b3c4d", reason: "dup of shipped" }],
                ["unicode id and reason", "discard ünïcödé-id --reason sïgns", { id: "ünïcödé-id", reason: "sïgns" }],
        ];

        for (const [name, input, expected] of CASES) {
                test(`equivalence: ${name}`, () => {
                        expect(parseMemoryReviewDiscard(input)).toEqual(expected);
                });
        }

        test("the battery itself is exhaustive against the regex it replaced (the guard rail)", () => {
                // The regex is re-declared HERE, not imported, so this pin
                // fails loudly if someone "simplifies" the parser and the
                // battery no longer represents the contract it replaced.
                const REGEX = /^discard\s+(\S+)(?:\s+--reason\s+(.+))?$/i;
                for (const [name, input] of CASES) {
                        const m = REGEX.exec(input);
                        const regexOut = m ? (m[2] !== undefined ? { id: m[1]!, reason: m[2] } : { id: m[1]! }) : undefined;
                        expect(parseMemoryReviewDiscard(input)).toEqual(regexOut);
                }
        });

        test("linear on pathological input: 200k characters parse in bounded time (no backtracking)", () => {
                const adversarial = [
                        "discard " + "a".repeat(200_000),
                        "discard " + "a ".repeat(100_000) + "--reason",
                        "discard " + "a".repeat(100_000) + " --reason " + "b".repeat(100_000),
                ];
                const t0 = performance.now();
                for (const s of adversarial) parseMemoryReviewDiscard(s);
                const elapsed = performance.now() - t0;
                // generous CI ceiling (local ~5 ms): the point is O(n), not the constant
                expect(elapsed).toBeLessThan(1000);
                // and the semantics hold on the huge shapes too
                expect(parseMemoryReviewDiscard(adversarial[2])).toBeDefined();
                expect(parseMemoryReviewDiscard(adversarial[2])!.reason!.length).toBe(100_000);
        });
});
