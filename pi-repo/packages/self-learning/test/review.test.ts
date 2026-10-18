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

    // ---- H2 git-plumbing hardening (R-b G1–G6)

    test("non-repo dir aborts with an actionable message, git's stderr surfaced (G1/G2)", async () => {
        const dir = join(tmpRoot, "not-a-repo");
        mkdirSync(dir, { recursive: true });
        let err: any;
        try {
            await captureReviewTarget(dir);
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toContain("not a git repository");
        expect(err.message).toContain("git history");
    });

    test("git binary missing aborts distinctly (G2, ENOENT branch)", async () => {
        const dir = join(tmpRoot, "repo-missing-git");
        gitInit(dir);
        writeFileSync(join(dir, "a.txt"), "1\n");
        gitRun(dir, ["add", "."]);
        gitRun(dir, ["commit", "-q", "-m", "one"]);
        // PATH manipulation is unreliable under bun's spawnSync (the default
        // env is snapshotted), so the helper's UNOWN_GIT_BIN seam injects a
        // binary name that cannot exist — the ENOENT branch, end-to-end.
        const prevBin = process.env.UNOWN_GIT_BIN;
        process.env.UNOWN_GIT_BIN = "unown-git-definitely-missing-xyz";
        try {
            let err: any;
            try {
                await captureReviewTarget(dir);
            } catch (e) {
                err = e;
            }
            expect(err).toBeInstanceOf(Error);
            expect(err.message).toContain("git executable not found on PATH");
            // NOT the old misleading behavior: git's fatal stderr as "the diff"
            // or a "nothing to review" success
            expect(err.message).not.toContain("not a git repository");
        } finally {
            if (prevBin === undefined) delete process.env.UNOWN_GIT_BIN;
            else process.env.UNOWN_GIT_BIN = prevBin;
        }
    });

    test("weird filenames (spaces/quotes/newline) ride the untracked listing byte-faithfully (G3, -z + core.quotepath=false)", async () => {
        if (process.platform === "win32") return; // NTFS cannot represent this test's
        // fixtures: `"` is forbidden in filenames, control chars (\n) are
        // forbidden, and leading/trailing spaces get path-normalized away —
        // the byte-fidelity concern is POSIX-only by construction.
        const dir = join(tmpRoot, "repo-weird");
        gitInit(dir);
        writeFileSync(join(dir, "committed.txt"), "base\n");
        gitRun(dir, ["add", "."]);
        gitRun(dir, ["commit", "-q", "-m", "base"]);
        const quoted = `weird name's "quoted".ts`;
        const newline = "a\nb.ts";
        const spaced = " leading and trailing ";
        writeFileSync(join(dir, quoted), "export const q = 1;\n");
        writeFileSync(join(dir, newline), "export const n = 2;\n");
        writeFileSync(join(dir, spaced), "content\n");
        const target = await captureReviewTarget(dir);
        expect(target.untracked).toContain(quoted);
        expect(target.untracked).toContain(newline); // embedded \n survives — no line-splitting
        expect(target.untracked).toContain(spaced); // no .trim() eating significant spaces
    });

    test("merge-base failure on an unknown base surfaces 'is it a valid branch?' instead of an error-text diff (G4)", async () => {
        const dir = join(tmpRoot, "repo-mb");
        gitInit(dir);
        writeFileSync(join(dir, "a.txt"), "1\n");
        gitRun(dir, ["add", "."]);
        gitRun(dir, ["commit", "-q", "-m", "one"]);
        let err: any;
        try {
            await captureReviewTarget(dir, "no-such-branch");
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toContain("no merge-base with no-such-branch");
        expect(err.message).toContain("is it a valid branch?");
        expect(err.message).toContain("git said:"); // exit-code/stderr surfacing
    });

    test("40k cap: truncation marker line rides the frozen artifact (G-cap)", async () => {
        const dir = join(tmpRoot, "repo-big");
        gitInit(dir);
        // ~50 k of committed content, then modified — the diff alone blows the cap
        writeFileSync(join(dir, "big.txt"), `${"a\n".repeat(25_000)}${"b\n".repeat(25_000)}`);
        gitRun(dir, ["add", "."]);
        gitRun(dir, ["commit", "-q", "-m", "big"]);
        writeFileSync(join(dir, "big.txt"), `${"c\n".repeat(50_000)}`);
        const target = await captureReviewTarget(dir);
        expect(target.truncated).toBe(true);
        expect(target.diff).toContain("(diff truncated at 40000 chars)");
        expect(target.diff.length).toBeLessThanOrEqual(40_100); // cap + marker, nothing unbounded
    });

    test("untracked listing counts against the 40k budget (cap AFTER concatenating)", async () => {
        const dir = join(tmpRoot, "repo-many-untracked");
        gitInit(dir);
        writeFileSync(join(dir, "tracked.txt"), "base\n");
        gitRun(dir, ["add", "."]);
        gitRun(dir, ["commit", "-q", "-m", "base"]);
        writeFileSync(join(dir, "tracked.txt"), "base + change\n");
        // 500 untracked files with long names — the listing alone is ~9 k chars
        mkdirSync(join(dir, "u"), { recursive: true });
        for (let i = 0; i < 500; i++) {
            writeFileSync(join(dir, "u", `file-with-a-deliberately-long-name-${String(i).padStart(3, "0")}.ts`), "x\n");
        }
        const target = await captureReviewTarget(dir);
        expect(target.truncated).toBe(true);
        expect(target.diff).toContain("(untracked list truncated at 400 entries)");
        // the 400 listed entries (what the artifact carries) still arrive
        expect(target.untracked.length).toBe(50); // the task-prompt slice
        expect(target.untracked[0]).toContain("file-with-a-deliberately-long-name");
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
        // S2 confinement: NO bash — a review is judgment on the frozen diff,
        // not a process that could mutate the tree under review.
        expect(agent.tools).not.toContain("bash");
        expect(agent.tools).toEqual(["read", "grep", "find", "ls"]);
        expect(agent.systemPrompt).toContain("VERDICT: SHIP or DO-NOT-SHIP");
        expect(agent.systemPrompt).toContain("[P0]");
        expect(agent.systemPrompt).toContain("no bash");
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

// ---------------------------------------------------------------------------
// 6. Reviewer honesty (S1/S3) — failed/truncated reviewers never render clean
// ---------------------------------------------------------------------------

describe("reviewer honesty (S1/S3)", () => {
    test("all reviewers failed → forced UNKNOWN verdict, never a clean review", () => {
        const outputs = [
            parseReviewOutput("", "correctness", { failed: true }),
            parseReviewOutput("", "security", { failed: true }),
            parseReviewOutput("", "quality", { failed: true }),
        ];
        const merged = mergeReviews(outputs);
        const text = renderReview("uncommitted work", outputs, merged.findings);
        expect(text).toContain("3/3 reviewer(s) failed (timeout/crash)");
        expect(text).toContain("VERDICT: UNKNOWN (reviewers failed — re-run /review)");
        expect(text).not.toContain("the diff looked clean");
        expect(text).toContain("NOT a clean review");
    });

    test("partial failure → N/M line; a failed reviewer's silence never becomes SHIP", () => {
        const outputs = [
            parseReviewOutput("clean\nVERDICT: SHIP", "correctness"),
            parseReviewOutput("", "security", { failed: true }),
        ];
        const merged = mergeReviews(outputs);
        const text = renderReview("uncommitted work", outputs, merged.findings);
        expect(text).toContain("1/2 reviewer(s) failed (timeout/crash)");
        expect(text).toContain('"clean" is not guaranteed');
        expect(merged.verdict).toBe("unknown"); // 1 ship + 1 failed → unknown, not ship
    });

    test("failed/truncated flags ride parseReviewOutput and surface in the render", () => {
        const out = parseReviewOutput("- [P1] Thing", "quality", { failed: true, truncated: true });
        expect(out.failed).toBe(true);
        expect(out.truncated).toBe(true);
        const text = renderReview("label", [out], out.findings);
        expect(text).toContain("1/1 reviewer(s) failed (timeout/crash)");
        expect(text).toContain("1 reviewer output(s) truncated");
        expect(text).toContain("[P1] Thing"); // findings from the failed reviewer still shown
    });

    test("no failures → the classic clean rendering is untouched", () => {
        const outputs = [parseReviewOutput("clean\nVERDICT: SHIP", "correctness")];
        const text = renderReview("diff vs main", outputs, []);
        expect(text).toContain("No findings — the diff looked clean to every reviewer.");
        expect(text).not.toContain("reviewer(s) failed");
    });
});
