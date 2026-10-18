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
 *   - reviewers = read-only unown subagents (`reviewer` config: read/bash/ls
 *     with a review system prompt), 1 for small diffs, 2–3 in parallel with
 *     split focuses (correctness · security · tests/maintainability) for
 *     larger ones — the omp reviewer-count heuristic.
 *   - `parseReviewOutput` extracts findings tagged [P0]–[P3] with optional
 *     confidence and a VERDICT line; `mergeReviews` dedupes by normalized
 *     title and orders by severity; the merged verdict is the strictest.
 *
 * Honest limits: the review is only as good as the reviewing model; severity
 * and confidence are the reviewer's self-reported judgment, not verified
 * facts. The command lives in the unown-tools extension (TUI `/review`); the
 * merge artifact is written to `.unown/reviews/` (gitignored runtime state).
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { slugify } from "./checkpoints.ts";
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

function git(cwd: string, args: string[]): Promise<{ code: number; out: string }> {
    return new Promise((resolve) => {
        const proc = spawn("git", args, { cwd, windowsHide: true });
        let out = "";
        proc.stdout?.on("data", (c: Buffer) => (out += c.toString("utf8")));
        proc.stderr?.on("data", (c: Buffer) => (out += c.toString("utf8")));
        proc.on("error", () => resolve({ code: 1, out: "" }));
        proc.on("close", (code) => resolve({ code: code ?? 1, out }));
    });
}

/**
 * Freeze the review target. `base` empty = uncommitted work (diff vs HEAD +
 * untracked files); otherwise the diff of HEAD..base is NOT what we want —
 * we want base...HEAD (what changed on this branch since diverging).
 */
export async function captureReviewTarget(cwd: string, base?: string): Promise<ReviewTarget> {
    if (base && base.trim()) {
        const trimmed = base.trim();
        const mergeBase = await git(cwd, ["merge-base", trimmed, "HEAD"]);
        const ref = mergeBase.code === 0 ? mergeBase.out.trim() || trimmed : trimmed;
        const diff = await git(cwd, ["diff", `${ref}...HEAD`, "--no-color"]);
        return {
            label: `diff vs ${trimmed} (since ${ref.slice(0, 8)})`,
            diff: cap(diff.out),
            untracked: [],
            truncated: diff.out.length > DIFF_CAP,
        };
    }
    const status = await git(cwd, ["status", "--porcelain", "-uall"]);
    const untracked = status.out
        .split("\n")
        .filter((l) => l.startsWith("??"))
        .map((l) => l.slice(3).trim())
        .filter(Boolean);
    const diff = await git(cwd, ["diff", "HEAD", "--no-color"]);
    const stat = await git(cwd, ["diff", "HEAD", "--stat", "--no-color"]);
    const combined = `${stat.out}\n${diff.out}`.trim();
    return {
        label: "uncommitted work (diff vs HEAD + untracked files)",
        diff: cap(combined),
        untracked,
        truncated: combined.length > DIFF_CAP,
    };
}

function cap(text: string): string {
    if (text.length <= DIFF_CAP) return text;
    return text.slice(0, DIFF_CAP) + `\n… (diff truncated at ${DIFF_CAP} chars)`;
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
        description: "Read-only code-review subagent.",
        tools: ["read", "grep", "find", "ls", "bash"],
        systemPrompt: `You are unown's code-review subagent — read-only. You cannot write or edit anything; bash is limited to read-only inspection (git diff/log/show, cat, grep).

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
}

const SEVERITIES = ["P0", "P1", "P2", "P3"] as const;

/** Parse one reviewer's output into findings + verdict (tolerant). */
export function parseReviewOutput(output: string, from: string): ReviewOutput {
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
    return { findings, verdict, verdictRationale };
}

const severityRank = (s: ReviewFinding["severity"]) => SEVERITIES.indexOf(s);

/** Merge reviews: dedupe by normalized title (keep the most severe), strictest verdict wins. */
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

/** The merged review as text (notify + artifact share it). */
export function renderReview(label: string, reviews: ReviewOutput[], findings: ReviewFinding[]): string {
    const counts = SEVERITIES.map((sev) => {
        const n = findings.filter((f) => f.severity === sev).length;
        return n > 0 ? `${sev}×${n}` : null;
    }).filter(Boolean);
    const merged = mergeReviews(reviews);
    const verdictLine =
        merged.verdict === "ship"
            ? "VERDICT: SHIP"
            : merged.verdict === "block"
              ? "VERDICT: DO-NOT-SHIP"
              : "VERDICT: unclear (reviewers did not commit)";
    const lines: string[] = [];
    lines.push(`Review — ${label} (${reviews.length} reviewer(s)${counts.length ? `, ${counts.join(", ")}` : ", no findings"})`);
    lines.push("");
    if (findings.length === 0) {
        lines.push("No findings — the diff looked clean to every reviewer.");
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
