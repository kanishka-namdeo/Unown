// Unit tests for src/review.ts — the /review orchestration (oh-my-pi /review
// + Codex /review presets port).
//
// Layers:
//   1. parsing — findings lines with [P0]-[P3], confidence, VERDICT lines
//   2. merging — dedupe by normalized title (most severe wins), strictest
//      verdict, ordering
//   3. rendering + artifact persistence
//   4. captureReviewTarget against a throwaway git repo — uncommitted mode
//      (diff + untracked) and base-branch mode (merge-base range)
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
    buildReviewerTask,
    captureReviewTarget,
    mergeReviews,
    parseReviewOutput,
    renderReview,
    reviewerAgent,
    REVIEWER_FOCUSES,
    saveReviewArtifact,
} from "../src/review.ts";

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-review-test-"));
afterAll(() => {
    try {
        rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

function gitRun(dir: string, args: string[]): void {
    // spawnSync without a shell: execSync would need /bin/sh, which is not
    // guaranteed on every host this suite runs on.
    const res = spawnSync("git", args, { cwd: dir });
    if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: status=${res.status} error=${String(res.error)} stderr=${String(res.stderr).slice(0, 200)}`);
}


function gitInit(dir: string): void {
    mkdirSync(dir, { recursive: true });
    gitRun(dir, ["init", "-q", "-b", "main"]);
    gitRun(dir, ["config", "user.email", "t@t"]);
    gitRun(dir, ["config", "user.name", "t"]);
}

// ---------------------------------------------------------------------------
// 1. Parsing
// ---------------------------------------------------------------------------

describe("parseReviewOutput", () => {
    test("extracts findings with severity, title, detail, confidence + the verdict", () => {
        const output = [
            "FINDINGS:",
            "- [P0] SQL injection in query builder — user input concatenated at src/db.ts:42 (confidence: high)",
            "- [P1] Missing test for the retry path — src/retry.ts has no coverage (confidence: medium)",
            "* [P3] Typo in error message",
            "",
            "VERDICT: DO-NOT-SHIP — the P0 must be fixed first",
        ].join("\n");
        const parsed = parseReviewOutput(output, "security");
        expect(parsed.findings).toHaveLength(3);
        expect(parsed.findings[0]).toMatchObject({
            severity: "P0",
            confidence: "high",
            from: "security",
        });
        expect(parsed.findings[0].title).toContain("SQL injection");
        expect(parsed.findings[0].detail).toContain("src/db.ts:42");
        expect(parsed.findings[2].confidence).toBe("medium");
        expect(parsed.verdict).toBe("block");
        expect(parsed.verdictRationale).toContain("P0 must be fixed");
    });
    test("SHIP verdict with no findings; unknown when absent", () => {
        const clean = parseReviewOutput("No findings — looks good.\n\nVERDICT: SHIP", "correctness");
        expect(clean.findings).toHaveLength(0);
        expect(clean.verdict).toBe("ship");
        expect(parseReviewOutput("unstructured text", "quality").verdict).toBe("unknown");
    });
});

// ---------------------------------------------------------------------------
// 2. Merging
// ---------------------------------------------------------------------------

describe("mergeReviews", () => {
    test("dedupes by normalized title keeping the most severe; block beats ship", () => {
        const a = parseReviewOutput(
            "- [P1] Missing test for retry path — no coverage\nVERDICT: SHIP",
            "correctness",
        );
        const b = parseReviewOutput(
            "- [P0] Missing test for retry path — critical path untested\nVERDICT: DO-NOT-SHIP — P0",
            "quality",
        );
        const c = parseReviewOutput(
            "- [P2] Naming consistency in helpers\nVERDICT: SHIP",
            "security",
        );
        const merged = mergeReviews([a, b, c]);
        expect(merged.findings).toHaveLength(2);
        expect(merged.findings[0].severity).toBe("P0");
        expect(merged.findings[0].title).toContain("Missing test for retry path");
        expect(merged.verdict).toBe("block");
        expect(merged.verdictRationale).toContain("P0");
    });
    test("all-ship → ship; any-unknown without block → unknown", () => {
        const ship = parseReviewOutput("VERDICT: SHIP", "a");
        expect(mergeReviews([ship, parseReviewOutput("nothing", "b")]).verdict).toBe("unknown");
        expect(mergeReviews([ship, ship]).verdict).toBe("ship");
    });
});

// ---------------------------------------------------------------------------
// 3. Rendering + artifacts
// ---------------------------------------------------------------------------

describe("renderReview + saveReviewArtifact", () => {
    test("renders counts, findings, verdict", () => {
        const reviews = [
            parseReviewOutput("- [P0] Bad thing — src/a.ts:1 (confidence: high)\nVERDICT: DO-NOT-SHIP — fix first", "security"),
            parseReviewOutput("- [P3] Nit — style", "quality"),
        ];
        const merged = mergeReviews(reviews);
        const text = renderReview("uncommitted work", reviews, merged.findings);
        expect(text).toContain("uncommitted work");
        expect(text).toContain("P0×1");
        expect(text).toContain("P3×1");
        expect(text).toContain("[P0] Bad thing");
        expect(text).toContain("VERDICT: DO-NOT-SHIP");
    });
    test("clean review renders the no-findings line", () => {
        const reviews = [parseReviewOutput("clean\nVERDICT: SHIP", "correctness")];
        const text = renderReview("diff vs main", reviews, []);
        expect(text).toContain("No findings");
        expect(text).toContain("VERDICT: SHIP");
    });
    test("artifact lands under .unown/reviews and returns the path", () => {
        const dir = join(tmpRoot, "artifact");
        const path = saveReviewArtifact(dir, "uncommitted work (diff vs HEAD)", "review text");
        expect(path).not.toBeNull();
        expect(existsSync(path!)).toBe(true);
        expect(path!.startsWith(join(dir, ".unown", "reviews"))).toBe(true);
        expect(readFileSync(path!, "utf8")).toContain("review text");
    });
});

// ---------------------------------------------------------------------------
// 4. captureReviewTarget (throwaway git repos)
// ---------------------------------------------------------------------------

describe("captureReviewTarget", () => {
    test("uncommitted mode: diff + untracked files", async () => {
        const dir = join(tmpRoot, "repo1");
        gitInit(dir);
        writeFileSync(join(dir, "committed.txt"), "base\n");
        gitRun(dir, ["add", "."]);
        gitRun(dir, ["commit", "-q", "-m", "base"]);
        // uncommitted modification
        writeFileSync(join(dir, "committed.txt"), "base + change\n");
        // untracked file
        writeFileSync(join(dir, "new-file.ts"), "export const x = 1;\n");
        const target = await captureReviewTarget(dir);
        expect(target.label).toContain("uncommitted work");
        expect(target.diff).toContain("committed.txt");
        expect(target.diff).toContain("+base + change");
        expect(target.untracked).toContain("new-file.ts");
        expect(target.truncated).toBe(false);
    });
    test("base-branch mode: merge-base range, excludes uncommitted", async () => {
        const dir = join(tmpRoot, "repo2");
        gitInit(dir);
        writeFileSync(join(dir, "a.txt"), "1\n");
        gitRun(dir, ["add", "."]);
        gitRun(dir, ["commit", "-q", "-m", "one"]);
        gitRun(dir, ["checkout", "-q", "-b", "feature"]);
        writeFileSync(join(dir, "b.txt"), "2\n");
        gitRun(dir, ["add", "."]);
        gitRun(dir, ["commit", "-q", "-m", "two"]);
        gitRun(dir, ["checkout", "-q", "main"]);
        writeFileSync(join(dir, "main-side.txt"), "3\n");
        gitRun(dir, ["add", "."]);
        gitRun(dir, ["commit", "-q", "-m", "three"]);
        gitRun(dir, ["checkout", "-q", "feature"]);
        const target = await captureReviewTarget(dir, "main");
        expect(target.label).toContain("diff vs main");
        expect(target.diff).toContain("b.txt");
        expect(target.diff).not.toContain("main-side.txt");
    });
    test("clean repo → empty diff, no untracked", async () => {
        const dir = join(tmpRoot, "repo3");
        gitInit(dir);
        writeFileSync(join(dir, "a.txt"), "1\n");
        gitRun(dir, ["add", "."]);
        gitRun(dir, ["commit", "-q", "-m", "one"]);
        const target = await captureReviewTarget(dir);
        expect(target.diff.trim()).toBe("");
        expect(target.untracked).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// 5. Reviewer config + task prompt
// ---------------------------------------------------------------------------

describe("reviewerAgent + buildReviewerTask", () => {
    test("read-only tools, output-format contract, focus brief + diff ride the task", () => {
        const agent = reviewerAgent("diff...");
        expect(agent.name).toBe("reviewer");
        expect(agent.tools).toContain("read");
        expect(agent.tools).not.toContain("write");
        expect(agent.systemPrompt).toContain("VERDICT: SHIP or DO-NOT-SHIP");
        expect(agent.systemPrompt).toContain("[P0]");
        const task = buildReviewerTask({
            label: "uncommitted work",
            diff: "+const x = 1;",
            untracked: ["new.ts"],
            focusBrief: REVIEWER_FOCUSES[0].brief,
            cwd: "/repo",
        });
        expect(task).toContain("/repo");
        expect(task).toContain("+const x = 1;");
        expect(task).toContain("new.ts");
        expect(task).toContain(REVIEWER_FOCUSES[0].brief);
    });
});
