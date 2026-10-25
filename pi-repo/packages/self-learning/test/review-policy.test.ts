/**
 * review-policy.test.ts — the team review policy layer (Goose v1.40 parity,
 * the 2026-10 convergence round): check discovery across the project + user
 * lanes, frontmatter parsing, flag surface, severity filtering, the plan
 * renderer, and the check-driven reviewer prompts.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        buildCheckReviewerTask,
        checkReviewerAgent,
        discoverReviewPolicy,
        filterFindingsBySeverity,
        parseReviewFlags,
        renderReviewPlan,
        REVIEWER_FOCUSES,
        reviewChecksDir,
        userReviewChecksDir,
        type ReviewCheck,
        type ReviewFinding,
} from "../src/review.ts";

function scratch(): { cwd: string; agentDir: string; cleanup: () => void } {
        const root = mkdtempSync(join(tmpdir(), "unown-review-policy-"));
        const cwd = join(root, "project");
        const agentDir = join(root, "agent");
        mkdirSync(reviewChecksDir(cwd), { recursive: true });
        mkdirSync(userReviewChecksDir(agentDir), { recursive: true });
        return { cwd, agentDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeCheck(dir: string, name: string, body: string, frontmatter?: string): void {
        writeFileSync(join(dir, `${name}.md`), frontmatter ? `---\n${frontmatter}\n---\n${body}` : body);
}

describe("discoverReviewPolicy — the two lanes", () => {
        test("project + user checks both discovered; project wins name collisions", () => {
                const { cwd, agentDir, cleanup } = scratch();
                try {
                        writeCheck(userReviewChecksDir(agentDir), "personal", "My own global check.");
                        writeCheck(reviewChecksDir(cwd), "migrations", "Every migration needs a down path.", "title: Migrations must be reversible\nseverity: P1");
                        writeCheck(reviewChecksDir(cwd), "personal", "The project's own version shadows the user one.");
                        writeCheck(reviewChecksDir(cwd), "empty", "   ");
                        const policy = discoverReviewPolicy(cwd, agentDir);
                        expect(policy.checks.map((c) => c.name).sort()).toEqual(["migrations", "personal"]);
                        const personal = policy.checks.find((c) => c.name === "personal");
                        expect(personal?.source).toBe("project");
                        expect(policy.errors.some((e) => e.includes("shadowed"))).toBe(true);
                        expect(policy.errors.some((e) => e.includes("empty check body"))).toBe(true);
                } finally {
                        cleanup();
                }
        });

        test("frontmatter: title, severity, model; defaults otherwise", () => {
                const { cwd, agentDir, cleanup } = scratch();
                try {
                        writeCheck(
                                reviewChecksDir(cwd),
                                "security-extra",
                                "Check for secret leakage in build logs.",
                                "title: No secrets in logs\nseverity: P0\nmodel: zai-bridge/agnes-2.5-flash",
                        );
                        writeCheck(reviewChecksDir(cwd), "plain", "Just a plain body check.");
                        const policy = discoverReviewPolicy(cwd, agentDir);
                        const extra = policy.checks.find((c) => c.name === "security-extra")!;
                        expect(extra.title).toBe("No secrets in logs");
                        expect(extra.severity).toBe("P0");
                        expect(extra.model).toBe("zai-bridge/agnes-2.5-flash");
                        const plain = policy.checks.find((c) => c.name === "plain")!;
                        expect(plain.severity).toBe("P2"); // default floor
                        expect(plain.model).toBeUndefined();
                        expect(plain.source).toBe("project");
                } finally {
                        cleanup();
                }
        });

        test("scope files: user + project concatenated, absent tolerated", () => {
                const { cwd, agentDir, cleanup } = scratch();
                try {
                        mkdirSync(join(agentDir, "review"), { recursive: true });
                        writeFileSync(join(agentDir, "review", "scope.md"), "User-wide: care about accessibility.");
                        writeFileSync(join(cwd, ".unown", "review", "scope.md"), "Project: this is a banking app.");
                        const policy = discoverReviewPolicy(cwd, agentDir);
                        expect(policy.scope).toContain("accessibility");
                        expect(policy.scope).toContain("banking app");
                } finally {
                        cleanup();
                }
        });

        test("empty policy is the normal case, never an error", () => {
                const { cwd, agentDir, cleanup } = scratch();
                try {
                        const policy = discoverReviewPolicy(cwd, agentDir);
                        expect(policy.checks).toEqual([]);
                        expect(policy.scope).toBe("");
                        expect(policy.errors).toEqual([]);
                } finally {
                        cleanup();
                }
        });
});

describe("parseReviewFlags — the Goose v1.40 surface", () => {
        test("bare target (the legacy base-branch form)", () => {
                const flags = parseReviewFlags("main");
                expect(flags).toMatchObject({ base: "main", wantComment: false, dryRun: false, listChecks: false });
        });
        test("--comment survives with a PR target", () => {
                const flags = parseReviewFlags("https://github.com/o/r/pull/12 --comment");
                expect(flags.wantComment).toBe(true);
                expect(flags.base).toContain("pull/12");
        });
        test("--severity P1 sets the floor", () => {
                const flags = parseReviewFlags("--severity=P1 main");
                expect(flags.minSeverity).toBe("P1");
                expect(flags.base).toBe("main");
        });
        test("--checks a,b filters; unknown names surface to the handler", () => {
                const flags = parseReviewFlags("--checks security-extra,plain");
                expect(flags.checksFilter).toEqual(["security-extra", "plain"]);
                expect(flags.base).toBeUndefined();
        });
        test("--dry-run and --list-checks are plan modes", () => {
                expect(parseReviewFlags("--dry-run").dryRun).toBe(true);
                expect(parseReviewFlags("--list-checks").listChecks).toBe(true);
                expect(parseReviewFlags("--dry-run").listChecks).toBe(false);
        });
});

describe("check-driven reviewers", () => {
        test("the check's model overrides the reviewer's (Goose per-check model parity)", () => {
                const base = {
                        name: "reviewer",
                        description: "d",
                        tools: ["read"],
                        systemPrompt: "s",
                        source: "built-in" as const,
                };
                const withModel = checkReviewerAgent(base, {
                        name: "x",
                        title: "t",
                        severity: "P0",
                        model: "zai-bridge/agnes-2.5-flash",
                        body: "b",
                        source: "project",
                        path: "x.md",
                });
                expect(withModel.model).toBe("zai-bridge/agnes-2.5-flash");
                const withoutModel = checkReviewerAgent(base, {
                        name: "x",
                        title: "t",
                        severity: "P1",
                        body: "b",
                        source: "user",
                        path: "x.md",
                });
                expect(withoutModel.model).toBeUndefined();
        });

        test("the task prompt carries the check title, body, severity floor and scope", () => {
                const check: ReviewCheck = {
                        name: "migrations",
                        title: "Migrations must be reversible",
                        severity: "P1",
                        body: "Every migration needs a down path.",
                        source: "project",
                        path: "migrations.md",
                };
                const task = buildCheckReviewerTask({
                        check,
                        label: "uncommitted work",
                        diff: "+ one line",
                        untracked: ["new.ts"],
                        scope: "This is a banking app.",
                        cwd: "/repo",
                });
                expect(task).toContain("TEAM CHECK: Migrations must be reversible");
                expect(task).toContain("Every migration needs a down path.");
                expect(task).toContain("severity P1 or stricter");
                expect(task).toContain("This is a banking app.");
                expect(task).toContain("new.ts");
        });
});

describe("filterFindingsBySeverity — the display floor", () => {
        const findings: ReviewFinding[] = [
                { severity: "P0", title: "a", detail: "d", confidence: "high", from: "security" },
                { severity: "P1", title: "b", detail: "d", confidence: "medium", from: "security" },
                { severity: "P2", title: "c", detail: "d", confidence: "low", from: "quality" },
        ];
        test("no floor → all", () => {
                expect(filterFindingsBySeverity(findings)).toHaveLength(3);
        });
        test("P1 floor keeps P0+P1; P0 keeps only P0", () => {
                expect(filterFindingsBySeverity(findings, "P1")).toHaveLength(2);
                expect(filterFindingsBySeverity(findings, "P0")).toHaveLength(1);
                expect(filterFindingsBySeverity(findings, "P3")).toHaveLength(3);
        });
});

describe("renderReviewPlan — the dry-run plan", () => {
        test("built-ins + checks + scope + errors, honest when empty", () => {
                const { cwd, agentDir, cleanup } = scratch();
                try {
                        const empty = discoverReviewPolicy(cwd, agentDir);
                        const plan = renderReviewPlan(REVIEWER_FOCUSES, [], empty);
                        expect(plan).toContain("3 built-in reviewer(s)");
                        expect(plan).toContain("no team checks discovered");

                        writeCheck(reviewChecksDir(cwd), "perf", "Check the hot path allocs.", "title: Perf floor\nseverity: P2");
                        const policy = discoverReviewPolicy(cwd, agentDir);
                        const plan2 = renderReviewPlan(REVIEWER_FOCUSES, policy.checks, policy);
                        expect(plan2).toContain("1 team check(s)");
                        expect(plan2).toContain("perf (floor P2) — Perf floor");
                } finally {
                        cleanup();
                }
        });
});
