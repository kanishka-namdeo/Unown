/**
 * review.ts — parallel-subagent code review (/review).
 *
 * Reverse-engineered from oh-my-pi's `/review` (frozen diff snapshot,
 * reviewer count adapted to diff size, P0–P3 findings + confidence + a
 * verdict on whether the change ships) and Codex CLI's `/review` presets
 * (base-branch / uncommitted / commit targets), reduced to orchestration
 * over the existing `task`-tool subagent machinery:
 *
 *   - `captureReviewTarget` freezes the diff (uncommitted work by default,
 *     or a base branch, or an explicit commit range) plus the untracked-file
 *     list, capped at 40 k chars — reviewers see the SAME snapshot even if
 *     the tree changes mid-review.
 *   - reviewers = read-only unown subagents (`reviewer` config: read/grep/
 *     find/ls — NO bash, no execution: a review is judgment on the frozen
 *     diff, not a process that gets to mutate the tree under review), 1 for
 *     small diffs, 2–3 in parallel with split focuses (correctness ·
 *     security · tests/maintainability) for larger ones — the omp
 *     reviewer-count heuristic.
 *   - `parseReviewOutput` extracts findings tagged [P0]–[P3] with optional
 *     confidence and a VERDICT line; `mergeReviews` dedupes by normalized
 *     title and orders by severity; the merged verdict is the strictest.
 *
 * Git plumbing hardening (R-b workflows audit, Milestone H2): every git call
 * goes through one `git()` helper — spawnSync with array args (no shell), a
 * 30 s timeout, bounded buffering, stdout and stderr kept APART, exit codes
 * consulted at every call site. A non-repo or a missing git binary aborts
 * with an actionable message instead of feeding git's fatal stderr to the
 * reviewers as "the diff"; merge-base failures surface as "is it a valid
 * branch?"; untracked files come from `status --porcelain -z` with
 * `core.quotepath=false` so filenames with spaces, quotes or newlines ride
 * the capture byte-faithfully; the 40 k cap applies to the CONCATENATED
 * artifact (diff + untracked listing) and the cut is a visible marker line.
 *
 * Reviewer honesty (R-b S1–S3): a reviewer that crashed, timed out or
 * produced no output is tracked as `failed` — the render says "N/M
 * reviewer(s) failed", and when ALL reviewers failed the verdict is forced
 * to UNKNOWN (never "clean"). Truncated reviewer output is marked too.
 *
 * Honest limits: the review is only as good as the reviewing model; severity
 * and confidence are the reviewer's self-reported judgment, not verified
 * facts. The command lives in the unown-tools extension (TUI `/review`); the
 * merge artifact is written to `.unown/reviews/` (gitignored runtime state).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { slugify } from "./checkpoints.ts";
import {
    fetchPrDiff,
    fetchPrMetadata,
    GhUnavailableError,
    isGhAvailable,
    parseReviewTarget,
} from "./pr-review.ts";
import type { SubagentConfig } from "./tools.ts";

// ---------------------------------------------------------------------------
// Diff capture
// ---------------------------------------------------------------------------

export interface ReviewTarget {
    /** What was reviewed (human phrase, e.g. "uncommitted work" or "diff vs main"). */
    label: string;
    diff: string;
    untracked: string[];
    truncated: boolean;
}

const DIFF_CAP = 40_000;
/** Untracked entries listed in the frozen artifact (the task prompt shows 50). */
const UNTRACKED_LISTED = 400;
const GIT_TIMEOUT_MS = 30_000;
/** Bounded git buffering (R-b G5): the old stream accumulation was unbounded
 *  (a 100 MB minified diff was fully buffered before the 40 k cap sliced
 *  it). 2 MB is ~25× the diff cap — room for status on pathological repos,
 *  hard ceiling on memory. A diff bigger than this arrives as a partial
 *  stdout + MAXBUFFER error and is still reviewed (truncated), never
 *  buffered whole. */
const GIT_MAX_BUFFER = 2 * 1024 * 1024;
/** stderr snippet cap surfaced in abort messages (~500 chars per R-b G1). */
const GIT_STDERR_SNIPPET = 500;

interface GitResult {
    ok: boolean;
    /** Process exit code; -1 for spawn-level failures. */
    code: number;
    stdout: string;
    stderr: string;
    /** Spawn-level failure kind: ENOENT (git missing), ETIMEDOUT (hung git),
     *  MAXBUFFER (output over the cap — stdout carries the partial data). */
    spawnError?: "ENOENT" | "ETIMEDOUT" | "MAXBUFFER" | "SPAWN_FAILED";
}

/** Git binary to run: `git` from PATH, overridable via UNOWN_GIT_BIN
 *  (primarily a test seam that exercises the ENOENT branch deterministically;
 *  also an escape hatch for unusual installs — Nix store paths etc.). Read
 *  per call so tests can pin it without re-importing the module. */
function gitBinary(): string {
    const bin = process.env.UNOWN_GIT_BIN;
    return typeof bin === "string" && bin.trim() ? bin.trim() : "git";
}

/**
 * The ONE git runner review.ts uses (R-b G1–G6). spawnSync with array args
 * (no shell), cwd, a 30 s timeout and bounded buffering; stdout and stderr
 * are captured SEPARATELY and each decoded exactly once from the whole
 * accumulated Buffer (per-chunk toString would split multi-byte UTF-8 across
 * pipe boundaries and mojibake diffs with non-ASCII paths/content).
 */
function git(cwd: string, args: string[]): GitResult {
    let res: ReturnType<typeof spawnSync>;
    try {
        res = spawnSync(gitBinary(), args, {
            cwd,
            timeout: GIT_TIMEOUT_MS,
            maxBuffer: GIT_MAX_BUFFER,
            shell: false,
            windowsHide: true,
            encoding: "buffer",
        });
    } catch (err) {
        return { ok: false, code: -1, stdout: "", stderr: err instanceof Error ? err.message : String(err), spawnError: "SPAWN_FAILED" };
    }
    // One whole-buffer utf8 decode per stream, never per chunk.
    const stdout = Buffer.from(res.stdout ?? []).toString("utf8");
    const stderr = Buffer.from(res.stderr ?? []).toString("utf8");
    if (res.error) {
        const code = (res.error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return { ok: false, code: -1, stdout, stderr, spawnError: "ENOENT" };
        if (code === "ETIMEDOUT") return { ok: false, code: -1, stdout, stderr, spawnError: "ETIMEDOUT" };
        if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return { ok: false, code: -1, stdout, stderr, spawnError: "MAXBUFFER" };
        return { ok: false, code: -1, stdout, stderr, spawnError: "SPAWN_FAILED" };
    }
    const code = res.status ?? -1;
    return { ok: res.status === 0, code, stdout, stderr };
}

/** `<what> (git said: <stderr>)` — stderr surfaced, truncated to ~500 chars. */
function gitFailure(what: string, res: GitResult): Error {
    const why = res.stderr.trim().replace(/\s+/g, " ").slice(0, GIT_STDERR_SNIPPET);
    return new Error(why ? `${what} (git said: ${why})` : what);
}

/** Abort-message helpers for the spawn-level failure kinds. */
function gitSpawnFailure(res: GitResult): Error | null {
    if (res.spawnError === "ENOENT")
        return new Error("git executable not found on PATH — /review needs git to freeze a diff");
    if (res.spawnError === "ETIMEDOUT")
        return new Error(`git timed out after ${GIT_TIMEOUT_MS / 1000}s while reading the diff — /review aborted`);
    return null;
}

/** Every git call site consults exit codes (R-b G1): failure aborts with
 *  stderr in the message instead of silently becoming "the diff". */
function requireOk(res: GitResult, what: string): void {
    const spawnFailure = gitSpawnFailure(res);
    if (spawnFailure) throw spawnFailure;
    if (res.spawnError === "MAXBUFFER")
        throw new Error(`${what} produced more than ${GIT_MAX_BUFFER} bytes of output — refusing to buffer it whole`);
    if (!res.ok) throw gitFailure(what, res);
}

/**
 * Cap the CONCATENATED frozen artifact — diff text + untracked listing —
 * at DIFF_CAP (R-b G-cap + S3 kin): the listing counts against the same
 * budget (a 30 k listing used to ride on top of a 40 k diff uncapped), and
 * the cut is VISIBLE — the artifact itself carries a truncation marker
 * line so reviewers know they are seeing a slice, not the whole diff.
 */
function capArtifact(diff: string, untracked: string[]): { diff: string; untracked: string[]; truncated: boolean } {
    const listed = untracked.slice(0, UNTRACKED_LISTED);
    const listingLen = listed.length > 0 ? `Untracked files:\n${listed.join("\n")}`.length + 2 : 0;
    if (diff.length + listingLen <= DIFF_CAP && untracked.length <= listed.length) {
        return { diff, untracked: listed, truncated: false };
    }
    const room = Math.max(2_000, DIFF_CAP - listingLen);
    const markers: string[] = [];
    if (diff.length > room) markers.push(`(diff truncated at ${DIFF_CAP} chars)`);
    if (untracked.length > listed.length) markers.push(`(untracked list truncated at ${UNTRACKED_LISTED} entries)`);
    return {
        diff: diff.slice(0, room) + (markers.length > 0 ? `\n${markers.join("\n")}` : ""),
        untracked: listed.slice(0, 50),
        truncated: true,
    };
}

/**
 * Freeze the review target. `base` empty = uncommitted work (diff vs HEAD +
 * untracked files); otherwise the diff of HEAD..base is NOT what we want —
 * we want base...HEAD (what changed on this branch since diverging).
 *
 * Throws actionable errors (rendered as command results by the caller):
 * non-repo, git binary missing, merge-base failure, failed/timed-out git
 * calls — never a frozen "diff" that is actually git's stderr.
 */
export async function captureReviewTarget(cwd: string, base?: string): Promise<ReviewTarget> {
    // Milestone 3.3: PR-shaped input (URL/#N/owner/repo#N) delegates to `gh`
    // before any git preflight — a PR URL is not git-shaped, it's GitHub-
    // shaped. The `gh`-unavailable branch throws the actionable spec message.
    if (base && base.trim()) {
        const parsed = parseReviewTarget(base);
        if (parsed.kind === "pr-url" || parsed.kind === "pr-number") {
            return capturePrReviewTarget(cwd, parsed.value);
        }
        // commit-range + branch + diff-path fall through to the git-based
        // flow below (commit-range gets a direct `git diff <range>` call).
    }
    // Repo + binary preflight (R-b G1/G2): in a non-repo, status/diff exit
    // 128 with git's fatal message — the old code concatenated that stderr
    // into `out` and the reviewers received it (×3) as "the diff".
    const inside = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    const spawnFailure = gitSpawnFailure(inside);
    if (spawnFailure) throw spawnFailure;
    if (inside.spawnError === "MAXBUFFER" || !inside.ok) {
        if (inside.code === 128 && /not a git repository/i.test(inside.stderr)) {
            throw new Error("not a git repository — /review needs git history to freeze a diff");
        }
        throw gitFailure("not a git repository — /review needs git history to freeze a diff", inside);
    }
    if (base && base.trim()) {
        const trimmed = base.trim();
        const parsed = parseReviewTarget(trimmed);
        // Milestone 3.3: commit-range gets a direct `git diff <range>` —
        // `git diff a..b` IS the diff between two refs, no merge-base needed.
        if (parsed.kind === "commit-range") {
            const diff = git(cwd, ["-c", "core.quotepath=false", "diff", trimmed, "--no-color"]);
            const spawnFail = gitSpawnFailure(diff);
            if (spawnFail) throw spawnFail;
            if (!diff.ok && diff.spawnError !== "MAXBUFFER")
                throw gitFailure(`git diff ${trimmed} failed while freezing the review snapshot`, diff);
            const capped = capArtifact(diff.stdout, []);
            return {
                label: `commit range ${trimmed}`,
                diff: capped.diff,
                untracked: [],
                truncated: capped.truncated,
            };
        }
        const mergeBase = git(cwd, ["merge-base", trimmed, "HEAD"]);
        requireOk(mergeBase, `no merge-base with ${trimmed} — is it a valid branch?`);
        const ref = mergeBase.stdout.trim() || trimmed;
        const diff = git(cwd, ["-c", "core.quotepath=false", "diff", `${ref}...HEAD`, "--no-color"]);
        // MAXBUFFER is honest truncation, not a failure — review the partial
        // diff (capArtifact marks it); everything else aborts.
        const spawnFail = gitSpawnFailure(diff);
        if (spawnFail) throw spawnFail;
        if (!diff.ok && diff.spawnError !== "MAXBUFFER")
            throw gitFailure(`git diff ${ref}...HEAD failed while freezing the review snapshot`, diff);
        const capped = capArtifact(diff.stdout, []);
        return {
            label: `diff vs ${trimmed} (since ${ref.slice(0, 8)})`,
            diff: capped.diff,
            untracked: [],
            truncated: capped.truncated,
        };
    }
    // -z + core.quotepath=false (R-b G3): NUL-separated records keep
    // filenames with spaces, quotes or embedded newlines byte-faithful —
    // no line-splitting (a filename may contain \n), no trim (leading /
    // trailing spaces in a name are significant), no quote-unescaping.
    const status = git(cwd, ["-c", "core.quotepath=false", "status", "--porcelain", "-z", "-uall"]);
    requireOk(status, "git status failed while freezing the review snapshot");
    const untracked: string[] = [];
    for (const record of status.stdout.split("\0")) {
        // Each record is "XY <path>" (untracked = "?? <path>"); rename
        // records carry the old path as a trailing NUL record that never
        // starts with "??" and is ignored here.
        if (record.startsWith("?? ")) untracked.push(record.slice(3));
    }
    const diff = git(cwd, ["-c", "core.quotepath=false", "diff", "HEAD", "--no-color"]);
    const diffFail = gitSpawnFailure(diff);
    if (diffFail) throw diffFail;
    if (!diff.ok && diff.spawnError !== "MAXBUFFER")
        throw gitFailure("git diff HEAD failed while freezing the review snapshot", diff);
    const stat = git(cwd, ["-c", "core.quotepath=false", "diff", "HEAD", "--stat", "--no-color"]);
    requireOk(stat, "git diff --stat HEAD failed while freezing the review snapshot");
    const combined = `${stat.stdout}\n${diff.stdout}`.trim();
    const capped = capArtifact(combined, untracked);
    return {
        label: "uncommitted work (diff vs HEAD + untracked files)",
        diff: capped.diff,
        untracked: capped.untracked,
        truncated: capped.truncated,
    };
}

/**
 * PR-shaped review target — Milestone 3.3. Fetches the PR metadata + diff
 * via `gh pr view` / `gh pr diff` (delegated to `pr-review.ts`) and freezes
 * them into the same `ReviewTarget` shape the git-based path produces, so
 * the rest of the review pipeline (reviewer count, parseReviewOutput, etc.)
 * is unchanged.
 *
 * Throws `GhUnavailableError` (actionable spec message) when `gh` isn't on
 * PATH; throws a plain `Error` with `gh`'s stderr when `gh pr view` or
 * `gh pr diff` fail.
 */
async function capturePrReviewTarget(cwd: string, prRef: string): Promise<ReviewTarget> {
    if (!isGhAvailable()) {
        throw new GhUnavailableError();
    }
    const meta = await fetchPrMetadata(prRef, { cwd });
    const diff = await fetchPrDiff(prRef, { cwd });
    const capped = capArtifact(diff, []);
    const label =
        `PR ${prRef}: ${meta.title}` +
        ` (${meta.headRef || "?"} → ${meta.baseRef || "?"},` +
        ` +${meta.additions}/-${meta.deletions}, ${meta.files.length} file(s))`;
    return {
        label,
        diff: capped.diff,
        untracked: [],
        truncated: capped.truncated,
    };
}

// ---------------------------------------------------------------------------
// Reviewer prompts + config
// ---------------------------------------------------------------------------

export const REVIEWER_FOCUSES = [
    {
        key: "correctness",
        brief: "Focus: correctness and edge cases — logic errors, unhandled paths, off-by-ones, broken invariants, error handling, concurrency.",
    },
    {
        key: "security",
        brief: "Focus: security — injection, path traversal, secret handling, unsafe deserialization, privilege issues, destructive operations.",
    },
    {
        key: "quality",
        brief: "Focus: tests and maintainability — missing test coverage, API misuse, dead code, naming, documentation drift, complexity.",
    },
] as const;

export function reviewerAgent(diff: string): SubagentConfig {
    return {
        name: "reviewer",
        description: "Read-only code-review subagent (no bash, no execution — judgment on the frozen diff only).",
        tools: ["read", "grep", "find", "ls"],
        systemPrompt: `You are unown's code-review subagent — strictly read-only judgment, no execution. You have no bash and no write tools: only read/grep/find/ls to verify claims against the repository. You cannot run anything, change anything, or commit anything — the review IS the deliverable.

You receive ONE frozen diff snapshot plus the repository. Review it and answer in this exact format:

FINDINGS:
- [P0] <title> — <detail with file:line references> (confidence: high|medium|low)
- [P1] ...
(findings only; omit levels with nothing to say)

VERDICT: SHIP or DO-NOT-SHIP — <one-line rationale>

Severity scale: P0 = must fix before merge (bug, security hole, data loss). P1 = should fix (likely bug, missing test for critical path). P2 = worth a follow-up. P3 = nit. Cite file:line for every finding. If the diff is clean, say so and verdict SHIP. Be direct; no filler.`,
        source: "built-in",
    };
}

/** The task prompt one reviewer gets. */
export function buildReviewerTask(opts: {
    label: string;
    diff: string;
    untracked: string[];
    focusBrief: string;
    cwd: string;
}): string {
    const untrackedNote =
        opts.untracked.length > 0
            ? `\n\nUntracked files (new, not in the diff — read them if relevant):\n${opts.untracked.slice(0, 50).join("\n")}`
            : "";
    return `Review ${opts.label} in the repository at ${opts.cwd}.

${opts.focusBrief}

Frozen diff snapshot:
\`\`\`diff
${opts.diff}
\`\`\`${untrackedNote}

Rules: verify claims against the actual files (read them — the diff alone can lie); report only real findings; cite file:line; follow the FINDINGS/VERDICT format exactly.`;
}

// ---------------------------------------------------------------------------
// Output parsing + merging
// ---------------------------------------------------------------------------

export interface ReviewFinding {
    severity: "P0" | "P1" | "P2" | "P3";
    title: string;
    detail: string;
    confidence: "high" | "medium" | "low";
    from: string; // reviewer focus key
}

export interface ReviewOutput {
    findings: ReviewFinding[];
    verdict: "ship" | "block" | "unknown";
    verdictRationale: string;
    /** True when the reviewer itself failed — non-zero exit, timeout, crash
     *  or empty output (R-b S1). A failed reviewer's silence must never
     *  render as "the diff looked clean". */
    failed?: boolean;
    /** True when the reviewer's stdout was cut at the subagent output cap —
     *  the finding set may be incomplete (R-b S3). */
    truncated?: boolean;
}

/** Reviewer labels in spawn order — focus reviewers first, then checks.
 *
 * The /review wiring once computed this array AFTER first using it inside
 * `results.map(...)` (a TDZ ReferenceError — "Cannot access 'labels' before
 * initialization" — that ate every completed review's verdict at the merge
 * step; found live in the cadence round, 2026-10-28). Extracting it here
 * makes the order structural: labels exist before any use, and the pairing
 * with `results` (the Promise.all spawn order) is pinned by tests. */
export function reviewerLabels(
    focuses: ReadonlyArray<{ key: string }>,
    selectedChecks: ReadonlyArray<{ name: string }>,
): string[] {
    return [...focuses.map((f) => f.key), ...selectedChecks.map((c) => `check:${c.name}`)];
}

/** Map raw reviewer results to parsed outputs. `labels[i]` pairs with
 * `results[i]` — the CALLER MUST pass results in spawn order (focuses first,
 * then checks); this function only pairs by index and has no way to recover
 * a wrong order. When `results` is longer than `labels` (a truncated spawn
 * or a miscounted focus list), out-of-range indices fall back to
 * `reviewer-${i}` so `from` is never undefined. Failed reviewers are
 * marked (R-b S1) and truncated outputs get the marker line appended
 * (R-b S3). */
export function parseReviewerOutputs(
    results: ReadonlyArray<{ output: string; exitCode: number; outputTruncated?: boolean }>,
    focuses: ReadonlyArray<{ key: string }>,
    selectedChecks: ReadonlyArray<{ name: string }>,
): ReviewOutput[] {
    const labels = reviewerLabels(focuses, selectedChecks);
    return results.map((r, i) =>
        parseReviewOutput(r.output + (r.outputTruncated ? "\n(reviewer output truncated)" : ""), i < labels.length ? labels[i] : `reviewer-${i}`, {
            failed: r.exitCode !== 0 || !r.output.trim(),
            truncated: r.outputTruncated,
        }),
    );
}

const SEVERITIES = ["P0", "P1", "P2", "P3"] as const;

/** Parse one reviewer's output into findings + verdict (tolerant). The
 *  optional failure flags ride the parsed output so merge/render can be
 *  honest about crashed/timed-out/truncated reviewers (R-b S1/S3). */
export function parseReviewOutput(
    output: string,
    from: string,
    opts?: { failed?: boolean; truncated?: boolean },
): ReviewOutput {
    const findings: ReviewFinding[] = [];
    let verdict: ReviewOutput["verdict"] = "unknown";
    let verdictRationale = "";
    for (const rawLine of output.split("\n")) {
        const line = rawLine.trim();
        const match = new RegExp(`^[-*]?\\s*\\[(P[0-3])\\]\\s*(.+)$`, "i").exec(line);
        if (match) {
            const severity = match[1].toUpperCase() as ReviewFinding["severity"];
            const rest = match[2];
            const confidence = /\(confidence:\s*(high|medium|low)\)/i.exec(rest)?.[1]?.toLowerCase() as
                | ReviewFinding["confidence"]
                | undefined;
            let body = rest.replace(/\(confidence:\s*(high|medium|low)\)/i, "").trim();
            const dash = body.indexOf(" — ");
            const title = dash > 0 ? body.slice(0, dash).trim() : body.split(".")[0].trim() || body;
            const detail = dash > 0 ? body.slice(dash + 3).trim() : body;
            findings.push({
                severity,
                title: title.slice(0, 160),
                detail: detail.slice(0, 800),
                confidence: confidence ?? "medium",
                from,
            });
            continue;
        }
        const verdictMatch = /^VERDICT:\s*(SHIP|DO-NOT-SHIP)\s*[-—]?\s*(.*)$/i.exec(line);
        if (verdictMatch) {
            verdict = verdictMatch[1].toUpperCase() === "SHIP" ? "ship" : "block";
            verdictRationale = verdictMatch[2].trim();
        }
    }
    return {
        findings,
        verdict,
        verdictRationale,
        failed: opts?.failed,
        truncated: opts?.truncated,
    };
}

const severityRank = (s: ReviewFinding["severity"]) => SEVERITIES.indexOf(s);

/** Merge reviews: dedupe by normalized title (keep the most severe), strictest verdict wins.
 *  Failed reviewers keep their conservative "unknown" verdict in the merge —
 *  a crash must never soften a strict result — and renderReview adds the
 *  honest N/M failure line on top (R-b S1). */
export function mergeReviews(reviews: ReviewOutput[]): ReviewOutput {
    const byTitle = new Map<string, ReviewFinding>();
    for (const review of reviews) {
        for (const finding of review.findings) {
            const key = normalizeTitle(finding.title);
            const existing = byTitle.get(key);
            if (!existing || severityRank(finding.severity) < severityRank(existing.severity)) {
                byTitle.set(key, finding);
            }
        }
    }
    const findings = [...byTitle.values()].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    const verdicts = reviews.map((r) => r.verdict);
    const verdict: ReviewOutput["verdict"] = verdicts.includes("block")
        ? "block"
        : verdicts.every((v) => v === "ship")
          ? "ship"
          : "unknown";
    const blockRationale = reviews.find((r) => r.verdict === "block")?.verdictRationale ?? "";
    const shipRationale = reviews.find((r) => r.verdict === "ship")?.verdictRationale ?? "";
    return { findings, verdict, verdictRationale: blockRationale || shipRationale };
}

function normalizeTitle(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).slice(0, 8).join(" ");
}

/** The merged review as text (notify + artifact share it). Reviewer
 *  honesty (R-b S1/S3): any failed reviewer gains a prominent N/M line;
 *  when ALL reviewers failed the verdict is forced to UNKNOWN — never
 *  "clean" — and truncated outputs are called out. */
export function renderReview(label: string, reviews: ReviewOutput[], findings: ReviewFinding[]): string {
    const counts = SEVERITIES.map((sev) => {
        const n = findings.filter((f) => f.severity === sev).length;
        return n > 0 ? `${sev}×${n}` : null;
    }).filter(Boolean);
    const merged = mergeReviews(reviews);
    const failedCount = reviews.filter((r) => r.failed).length;
    const truncatedCount = reviews.filter((r) => r.truncated).length;
    const allFailed = reviews.length > 0 && failedCount === reviews.length;
    const verdictLine = allFailed
        ? "VERDICT: UNKNOWN (reviewers failed — re-run /review)"
        : merged.verdict === "ship"
          ? "VERDICT: SHIP"
          : merged.verdict === "block"
            ? "VERDICT: DO-NOT-SHIP"
            : "VERDICT: unclear (reviewers did not commit)";
    const lines: string[] = [];
    lines.push(`Review — ${label} (${reviews.length} reviewer(s)${counts.length ? `, ${counts.join(", ")}` : ", no findings"})`);
    lines.push("");
    if (failedCount > 0) {
        lines.push(
            `${failedCount}/${reviews.length} reviewer(s) failed (timeout/crash)` +
                (allFailed ? " — NO reviewer produced a review" : " — findings may be incomplete"),
        );
    }
    if (truncatedCount > 0) {
        lines.push(`${truncatedCount} reviewer output(s) truncated — the finding list may be incomplete`);
    }
    if (findings.length === 0) {
        if (allFailed) {
            lines.push("No findings recorded — every reviewer failed; this is NOT a clean review. Re-run /review.");
        } else if (failedCount > 0) {
            lines.push(`No findings from the reviewer(s) that completed — ${failedCount}/${reviews.length} failed, so "clean" is not guaranteed.`);
        } else {
            lines.push("No findings — the diff looked clean to every reviewer.");
        }
    } else {
        for (const f of findings) {
            lines.push(`[${f.severity}] ${f.title} (confidence: ${f.confidence})`);
            if (f.detail && f.detail !== f.title) lines.push(`    ${f.detail}`);
        }
    }
    lines.push("");
    lines.push(verdictLine + (merged.verdictRationale ? ` — ${merged.verdictRationale}` : ""));
    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Review artifact
// ---------------------------------------------------------------------------

export function reviewsDir(cwd: string): string {
    return join(cwd, ".unown", "reviews");
}

/** Persist the rendered review; returns the path (best-effort, never throws). */
export function saveReviewArtifact(cwd: string, label: string, text: string, now = Date.now()): string | null {
    try {
        const dir = reviewsDir(cwd);
        mkdirSync(dir, { recursive: true });
        const slug = slugify(label).slice(0, 30) || "review";
        const file = join(dir, `${new Date(now).toISOString().slice(0, 19).replace(/[:T]/g, "")}-${slug}.md`);
        writeFileSync(file, text + "\n");
        return file;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Team review policy (the 2026-10 convergence round) — Goose v1.40 parity:
// versioned check files + a project scope file, discoverable like agents.
// ---------------------------------------------------------------------------

/**
 * A team review check — a markdown file with frontmatter:
 *
 *     ---
 *     title: DB migrations must be reversible
 *     severity: P1          # the floor for findings this check reports (P0–P3)
 *     model: zai-bridge/agnes-2.5-flash   # optional per-check reviewer model
 *     ---
 *     <body: what this check looks for, in plain instructions to the reviewer>
 *
 * Discovery mirrors the subagent/commands/skills convention (Goose reads
 * `.agents/checks/*.md`; Unown's own lanes are `.unown/` for project scope and
 * `~/.unown/agent/` for user scope):
 *   - `.unown/review/checks/*.md`     (this project — rides with the repo)
 *   - `<agentDir>/review/checks/*.md`  (your personal checks, every project)
 * plus the shared context files `.unown/review/scope.md` and
 * `<agentDir>/review/scope.md`, prepended to every reviewer's task.
 */
export interface ReviewCheck {
    /** File stem — the stable id used by --checks. */
    name: string;
    title: string;
    /** The minimum severity findings from this check are reported at (P0–P3). */
    severity: "P0" | "P1" | "P2" | "P3";
    /** Optional per-check reviewer model ("provider/model"). */
    model?: string;
    /** The check body — instructions to the reviewer subagent. */
    body: string;
    source: "project" | "user";
    path: string;
}

export interface ReviewPolicy {
    checks: ReviewCheck[];
    /** Concatenated scope files (user first, then project — most specific last). */
    scope: string;
    /** Unreadable/malformed files, surfaced to the user (never fatal). */
    errors: string[];
}

// SEVERITIES is shared with the output-parsing section above (one table).

function parseCheckFile(file: string, source: "project" | "user", text: string): ReviewCheck | string {
    const name = file.replace(/\.md$/i, "");
    let title = name;
    let severity: ReviewCheck["severity"] = "P2";
    let model: string | undefined;
    let body = text;
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
    if (fm) {
        body = fm[2];
        for (const line of fm[1].split(/\r?\n/)) {
            const m = /^([a-zA-Z_-]+)\s*:\s*(.*)$/.exec(line.trim());
            if (!m) continue;
            const key = m[1].toLowerCase();
            const value = m[2].trim();
            if (key === "title" && value) title = value.slice(0, 100);
            if (key === "severity" && SEVERITIES.includes(value.toUpperCase() as any)) {
                severity = value.toUpperCase() as ReviewCheck["severity"];
            }
            if (key === "model" && value) model = value.slice(0, 100);
        }
    }
    body = body.trim();
    if (!body) return `${file}: empty check body — nothing to instruct the reviewer with`;
    return {
        name,
        title,
        severity,
        model,
        body: body.slice(0, 4_000),
        source,
        path: file,
    };
}

/** Read one checks lane (a directory of *.md). Errors are collected, never thrown. */
function readChecksLane(dir: string, source: "project" | "user", errors: string[]): ReviewCheck[] {
    const checks: ReviewCheck[] = [];
    let entries: string[];
    try {
        entries = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".md")).sort();
    } catch {
        return checks; // absent lane — the normal case
    }
    for (const entry of entries.slice(0, 20)) {
        try {
            const parsed = parseCheckFile(entry, source, readFileSync(join(dir, entry), "utf8"));
            if (typeof parsed === "string") {
                errors.push(parsed);
            } else {
                checks.push(parsed);
            }
        } catch (err: any) {
            errors.push(`${entry}: unreadable (${err instanceof Error ? err.message : String(err)})`);
        }
    }
    return checks;
}

/** Read one scope file (absent = empty string, never an error). */
function readScopeFile(file: string): string {
    try {
        const text = readFileSync(file, "utf8").trim();
        return text ? text.slice(0, 8_000) : "";
    } catch {
        return "";
    }
}

/** Project checks lane: `.unown/review/checks/`. */
export function reviewChecksDir(cwd: string): string {
    return join(cwd, ".unown", "review", "checks");
}

/** User checks lane: `<agentDir>/review/checks/`. */
export function userReviewChecksDir(agentDir: string): string {
    return join(agentDir, "review", "checks");
}

/** Discover both lanes + the scope files. Pure-ish (fs reads, never throws). */
export function discoverReviewPolicy(cwd: string, agentDir: string): ReviewPolicy {
    const errors: string[] = [];
    const userChecks = readChecksLane(userReviewChecksDir(agentDir), "user", errors);
    const projectChecks = readChecksLane(reviewChecksDir(cwd), "project", errors);
    const names = new Set<string>();
    const checks: ReviewCheck[] = [];
    // Project wins on name collisions (the repo's own rules are the rules) —
    // project checks iterate FIRST, later same-named lanes are the shadowed ones.
    for (const check of [...projectChecks, ...userChecks]) {
        if (names.has(check.name)) {
            errors.push(`${check.name}: shadowed by a ${check.source === "user" ? "project" : "user"} check with the same name`);
            continue;
        }
        names.add(check.name);
        checks.push(check);
    }
    const scope = [readScopeFile(join(agentDir, "review", "scope.md")), readScopeFile(join(cwd, ".unown", "review", "scope.md"))]
        .filter(Boolean)
        .join("\n\n");
    return { checks, scope, errors };
}

// ---------------------------------------------------------------------------
// /review flags (the Goose v1.40 surface: --severity / --checks / --dry-run
// / --list-checks, alongside the existing base/PR/commit-range + --comment)
// ---------------------------------------------------------------------------

export interface ReviewCommandFlags {
    base?: string;
    wantComment: boolean;
    /** Findings at this severity or stricter are shown (default: all). */
    minSeverity?: "P0" | "P1" | "P2" | "P3";
    /** Run only these checks (comma-separated names). */
    checksFilter?: string[];
    dryRun: boolean;
    listChecks: boolean;
    /** The remaining positional target (base branch / PR / commit range). */
}

export function parseReviewFlags(raw: string): ReviewCommandFlags {
    let text = ` ${(raw ?? "").trim()} `;
    const wantComment = /\s--comment\b/.test(text);
    text = text.replace(/\s--comment\b/g, " ");
    const dryRun = /\s--dry-run\b/.test(text);
    text = text.replace(/\s--dry-run\b/g, " ");
    const listChecks = /\s--list-checks\b/.test(text);
    text = text.replace(/\s--list-checks\b/g, " ");
    let minSeverity: ReviewCommandFlags["minSeverity"];
    const sevMatch = /\s--severity[ =](P[0-3])\b/i.exec(text);
    if (sevMatch) {
        minSeverity = sevMatch[1].toUpperCase() as ReviewCommandFlags["minSeverity"];
        text = text.replace(/\s--severity[ =]P[0-3]\b/ig, " ");
    }
    let checksFilter: string[] | undefined;
    const checksMatch = /\s--checks[ =]([^\s]+)/.exec(text);
    if (checksMatch) {
        checksFilter = checksMatch[1]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        text = text.replace(/\s--checks[ =][^\s]+/g, " ");
    }
    const base = text.replace(/\s+/g, " ").trim() || undefined;
    return { base, wantComment, minSeverity, checksFilter, dryRun, listChecks };
}

// ---------------------------------------------------------------------------
// Check-driven reviewers
// ---------------------------------------------------------------------------

/** A check's reviewer agent: the read-only reviewer with an optional model override. */
export function checkReviewerAgent(base: SubagentConfig, check: ReviewCheck): SubagentConfig {
    return check.model ? { ...base, name: "reviewer", model: check.model } : { ...base, name: "reviewer" };
}

/** The task prompt a check-driven reviewer gets (the check body + the frozen diff). */
export function buildCheckReviewerTask(opts: {
    check: ReviewCheck;
    label: string;
    diff: string;
    untracked: string[];
    scope: string;
    cwd: string;
}): string {
    const untrackedNote =
        opts.untracked.length > 0
            ? `\n\nUntracked files (new, not in the diff — read them if relevant):\n${opts.untracked.slice(0, 50).join("\n")}`
            : "";
    const scopeNote = opts.scope ? `\n\nProject review scope (team context):\n${opts.scope}` : "";
    return `Review ${opts.label} in the repository at ${opts.cwd}.

TEAM CHECK: ${opts.check.title}
(This check reports findings at severity ${opts.check.severity} or stricter.)

${opts.check.body}
${scopeNote}

Frozen diff snapshot:
\`\`\`diff
${opts.diff}
\`\`\`${untrackedNote}

Rules: verify claims against the actual files (read them — the diff alone can lie); report only real findings; cite file:line; follow the FINDINGS/VERDICT format exactly.`;
}

/** Severity floor filter: keep findings at `min` or stricter (P0 strictest). */
export function filterFindingsBySeverity(findings: ReviewFinding[], min?: "P0" | "P1" | "P2" | "P3"): ReviewFinding[] {
    if (!min) return findings;
    const order = SEVERITIES;
    const floor = order.indexOf(min);
    return findings.filter((f) => order.indexOf(f.severity) <= floor);
}

/** The --dry-run / --list-checks plan text. */
export function renderReviewPlan(
    focuses: readonly { key: string; brief: string }[],
    checks: ReviewCheck[],
    policy: ReviewPolicy,
): string {
    const lines: string[] = [];
    lines.push(`Review plan: ${focuses.length} built-in reviewer(s)`);
    for (const f of focuses) lines.push(`  - ${f.key}`);
    lines.push(checks.length ? `${checks.length} team check(s)` : "no team checks discovered (.unown/review/checks/*.md — see docs/usage.md)");
    for (const c of checks) {
        lines.push(`  - ${c.name}${c.model ? ` [model: ${c.model}]` : ""} (floor ${c.severity}) — ${c.title}`);
    }
    if (policy.scope) lines.push("scope file: active");
    if (policy.errors.length) for (const e of policy.errors) lines.push(`! ${e}`);
    return lines.join("\n");
}
