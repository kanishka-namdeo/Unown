// Unit tests for src/pr-review.ts — `/review` PR URL/number support (Milestone 3.3).
//
// Layers:
//   1. parseReviewTarget — pure classifier (no fs, no spawn)
//   2. isGhAvailable — boolean (injectable `which`)
//   3. fetchPrMetadata / fetchPrDiff — shell out to `gh pr view` / `gh pr diff`
//      (injectable `spawn` captures args; mock `which` returns a fake path)
//   4. GhUnavailableError — actionable message when `gh` is missing
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    defaultWhich,
    fetchPrDiff,
    fetchPrMetadata,
    GH_MISSING_MESSAGE,
    GhUnavailableError,
    isGhAvailable,
    parseReviewTarget,
    postPrComment,
    PR_VIEW_FIELDS,
    type SpawnFn,
    type SpawnResult,
    type WhichFn,
} from "../src/pr-review.ts";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-pr-review-test-"));
try {
    // Best-effort cleanup — never throw on suite teardown.
} catch {
    /* ignore */
}
process.on("beforeExit", () => {
    try {
        rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
});

/** A `which` that always finds `gh` at a fake path. */
const fakeGhWhich: WhichFn = (cmd) => (cmd === "gh" ? "/usr/local/bin/gh" : null);

/** A `which` that never finds anything. */
const missingWhich: WhichFn = () => null;

/** Capture spawn args + return a canned stdout. */
function capturingSpawn(stdout: string, stderr = "", ok = true): SpawnFn & { calls: Array<{ cmd: string; args: string[] }> } {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const fn: SpawnFn = (cmd, args) => {
        calls.push({ cmd, args });
        const res: SpawnResult = { ok, code: ok ? 0 : 1, stdout, stderr };
        return res;
    };
    return Object.assign(fn, { calls });
}

// ---------------------------------------------------------------------------
// 1-6. parseReviewTarget — pure classifier
// ---------------------------------------------------------------------------

describe("parseReviewTarget", () => {
    test("1. classifies a bare branch name as 'branch'", () => {
        const r = parseReviewTarget("main");
        expect(r).toEqual({ kind: "branch", value: "main" });
    });

    test("2. classifies 'feature..main' as 'commit-range' (named refs)", () => {
        const r = parseReviewTarget("feature..main");
        expect(r).toEqual({ kind: "commit-range", value: "feature..main" });
    });

    test("3. classifies a GitHub PR URL as 'pr-url'", () => {
        const url = "https://github.com/owner/repo/pull/123";
        const r = parseReviewTarget(url);
        expect(r).toEqual({ kind: "pr-url", value: url });
    });

    test("4. classifies '#123' as 'pr-number' (current repo)", () => {
        const r = parseReviewTarget("#123");
        expect(r).toEqual({ kind: "pr-number", value: "#123" });
    });

    test("5. classifies 'owner/repo#123' as 'pr-number' (explicit repo)", () => {
        const r = parseReviewTarget("owner/repo#123");
        expect(r).toEqual({ kind: "pr-number", value: "owner/repo#123" });
    });

    test("6. classifies 'abc1234..def5678' as 'commit-range' (hash refs)", () => {
        const r = parseReviewTarget("abc1234..def5678");
        expect(r).toEqual({ kind: "commit-range", value: "abc1234..def5678" });
    });

    test("trims whitespace + treats empty input as branch (empty value)", () => {
        expect(parseReviewTarget("  main  ")).toEqual({ kind: "branch", value: "main" });
        expect(parseReviewTarget("   ")).toEqual({ kind: "branch", value: "" });
    });

    test("PR URL with query/anchor still classifies as pr-url", () => {
        const url = "https://github.com/owner/repo/pull/123/files#diff-abc";
        const r = parseReviewTarget(url);
        expect(r.kind).toBe("pr-url");
        expect(r.value).toBe(url);
    });

    test("subagent prefix never matched as pr-number (just a branch)", () => {
        // `sub-`-prefixed bootIds would never be confused with PR refs because
        // they don't match the URL/#N/owner/repo#N/range patterns.
        expect(parseReviewTarget("sub-20261019-120000-ab12")).toEqual({
            kind: "branch",
            value: "sub-20261019-120000-ab12",
        });
    });
});

// ---------------------------------------------------------------------------
// 7. isGhAvailable — boolean, injectable which
// ---------------------------------------------------------------------------

describe("isGhAvailable", () => {
    test("7. returns a boolean; true when which finds 'gh', false otherwise", () => {
        expect(typeof isGhAvailable(fakeGhWhich)).toBe("boolean");
        expect(isGhAvailable(fakeGhWhich)).toBe(true);
        expect(isGhAvailable(missingWhich)).toBe(false);
    });

    test("default which: real PATH lookup finds OR misses gh (no spawn, no throw)", () => {
        // The default does a pure fs scan (mirrors lsp.ts:commandExists). On a
        // dev machine `gh` is typically installed; in CI it typically isn't —
        // the test asserts the contract: returns a boolean, never throws.
        const result = isGhAvailable();
        expect(typeof result).toBe("boolean");
        // Cross-check against the defaultWhich directly so we're testing the
        // same code path the real callers exercise.
        expect(result).toBe(defaultWhich("gh") !== null);
    });

    test("default which: a fixture dir on PATH is found", () => {
        // Drop a fake `gh` (no exec bit needed — defaultWhich uses existsSync)
        // into a temp dir, prepend it to PATH via env, and verify lookup.
        const fakeBinDir = mkdtempSync(join(tmpRoot, "fake-bin-"));
        // win32 executables carry PATHEXT extensions (defaultWhich only
        // probes those — a bare extensionless file is not runnable there);
        // POSIX keeps the bare name.
        const fakeGhPath = join(fakeBinDir, process.platform === "win32" ? "gh.exe" : "gh");
        writeFileSync(fakeGhPath, "#!/bin/sh\necho fake-gh\n");
        const env = { ...process.env, PATH: `${fakeBinDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}` };
        expect(defaultWhich("gh", env)).toBe(fakeGhPath);
        expect(defaultWhich("no-such-binary-xyz", env)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 8-9. fetchPrMetadata / fetchPrDiff — shell out to gh with the right args
// ---------------------------------------------------------------------------

describe("fetchPrMetadata", () => {
    test("8. shells out to `gh pr view <PR> --json <fields>` with the right args", async () => {
        const meta = {
            title: "Add feature X",
            body: "Implements X by doing Y.",
            baseRefName: "main",
            headRefName: "feature/x",
            files: [{ path: "src/x.ts" }, { path: "tests/x.test.ts" }],
            additions: 42,
            deletions: 7,
        };
        const spawn = capturingSpawn(JSON.stringify(meta));
        const result = await fetchPrMetadata("https://github.com/o/r/pull/1", {
            spawn,
            which: fakeGhWhich,
            cwd: tmpRoot,
        });
        // Exactly one spawn call, with the expected cmd + args.
        expect(spawn.calls).toHaveLength(1);
        expect(spawn.calls[0].cmd).toBe("gh");
        expect(spawn.calls[0].args).toEqual(["pr", "view", "https://github.com/o/r/pull/1", "--json", PR_VIEW_FIELDS]);
        expect(spawn.calls[0].args[4]).toBe("title,body,baseRefName,headRefName,files,additions,deletions");
        // The cwd rides the spawn opts (we passed it through).
        // Parsed metadata shape:
        expect(result).toEqual({
            title: "Add feature X",
            body: "Implements X by doing Y.",
            baseRef: "main",
            headRef: "feature/x",
            files: ["src/x.ts", "tests/x.test.ts"],
            additions: 42,
            deletions: 7,
        });
    });

    test("throws on non-zero exit, surfacing the stderr snippet", async () => {
        const spawn = capturingSpawn("", "no PR found", false);
        let err: any;
        try {
            await fetchPrMetadata("#999", { spawn, which: fakeGhWhich });
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toContain("gh pr view #999 failed");
        expect(err.message).toContain("no PR found");
        // NOT the GhUnavailableError — that's a separate path (next describe block).
        expect(err).not.toBeInstanceOf(GhUnavailableError);
    });

    test("throws on non-JSON stdout", async () => {
        const spawn = capturingSpawn("not json at all");
        let err: any;
        try {
            await fetchPrMetadata("#1", { spawn, which: fakeGhWhich });
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toContain("non-JSON");
    });
});

describe("fetchPrDiff", () => {
    test("9. shells out to `gh pr diff <PR>` with the right args", async () => {
        const diffText = "diff --git a/x.ts b/x.ts\n+const x = 1;\n";
        const spawn = capturingSpawn(diffText);
        const result = await fetchPrDiff("owner/repo#42", { spawn, which: fakeGhWhich, cwd: tmpRoot });
        expect(spawn.calls).toHaveLength(1);
        expect(spawn.calls[0].cmd).toBe("gh");
        expect(spawn.calls[0].args).toEqual(["pr", "diff", "owner/repo#42"]);
        expect(result).toBe(diffText);
    });

    test("throws on non-zero exit, surfacing the stderr snippet", async () => {
        const spawn = capturingSpawn("", "network unreachable", false);
        let err: any;
        try {
            await fetchPrDiff("#1", { spawn, which: fakeGhWhich });
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toContain("gh pr diff #1 failed");
        expect(err.message).toContain("network unreachable");
    });
});

describe("postPrComment", () => {
    test("posts via `gh pr comment <PR> --body <comment>`", async () => {
        const spawn = capturingSpawn("");
        await postPrComment("#1", "Verdict: SHIP", { spawn, which: fakeGhWhich });
        expect(spawn.calls).toHaveLength(1);
        expect(spawn.calls[0].cmd).toBe("gh");
        expect(spawn.calls[0].args).toEqual(["pr", "comment", "#1", "--body", "Verdict: SHIP"]);
    });
});

// ---------------------------------------------------------------------------
// 10. gh missing → actionable error message
// ---------------------------------------------------------------------------

describe("gh missing → actionable error", () => {
    test("10. fetchPrMetadata throws GhUnavailableError with the spec message when gh is missing", async () => {
        // No `gh` on PATH — the spawn never even fires.
        const spawn = capturingSpawn(JSON.stringify({ title: "x" }));
        let err: any;
        try {
            await fetchPrMetadata("#1", { spawn, which: missingWhich });
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(GhUnavailableError);
        expect(err.message).toBe(GH_MISSING_MESSAGE);
        expect(err.message).toContain("https://cli.github.com/");
        // And the spawn was NEVER called — the `which` check short-circuits.
        expect(spawn.calls).toHaveLength(0);
    });

    test("fetchPrDiff throws GhUnavailableError with the spec message when gh is missing", async () => {
        const spawn = capturingSpawn("diff");
        let err: any;
        try {
            await fetchPrDiff("#1", { spawn, which: missingWhich });
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(GhUnavailableError);
        expect(err.message).toBe(GH_MISSING_MESSAGE);
        expect(spawn.calls).toHaveLength(0);
    });

    test("postPrComment throws GhUnavailableError when gh is missing", async () => {
        const spawn = capturingSpawn("");
        let err: any;
        try {
            await postPrComment("#1", "x", { spawn, which: missingWhich });
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(GhUnavailableError);
        expect(spawn.calls).toHaveLength(0);
    });

    test("GhUnavailableError's message is exactly the spec text", () => {
        const e = new GhUnavailableError();
        expect(e.message).toBe("GitHub CLI (gh) is required for PR review. Install from https://cli.github.com/.");
        expect(e.name).toBe("GhUnavailableError");
    });
});
