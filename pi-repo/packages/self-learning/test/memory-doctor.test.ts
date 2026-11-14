/**
 * memory-doctor.test.ts — the memory audit pass (Memory Divertimento round
 * CP5, 2026-11-14): the deferred gap #4 from the comparative research,
 * closed. `unown memory doctor` audits what IS in the tiers (budgets,
 * placement, derivable content) and what the engine says about the store
 * (health, the review queue), and PROVES the recall loop with a live
 * search probe (the memU doctor law) — a superseded row must never answer
 * a default recall bare.
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditProjectMemory, renderMemoryDoctorReport, type MemoryDoctorEngine, type MemoryDoctorReport } from "../src/memory-doctor.ts";

let dir: string;

beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "unown-memdoctor-"));
});
afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
});

/** A full fake engine: healthy store, sealed recall, an empty queue. */
function fakeEngine(over: Partial<MemoryDoctorEngine> = {}): MemoryDoctorEngine {
        return {
                async health() {
                        return {
                                duplicateCount: 2,
                                conflictCount: 0,
                                supersededCount: 5,
                                dormantCount: 1,
                                sroTaggedCount: 9,
                                memoryCount: 40,
                        };
                },
                async reviewDepth() {
                        return 3;
                },
                async searchProbe() {
                        return [{ id: "live-1", metadata: {} }, { id: "live-2", metadata: { supersededBy: undefined } }];
                },
                ...over,
        };
}

function scaffoldProject() {
        // a minimal .unown surface the terminal resolution can read
        mkdirSync(join(dir, ".unown", "memory"), { recursive: true });
        writeFileSync(
                join(dir, ".unown", "memory", "project.md"),
                [
                        "# Project Memory",
                        "",
                        "## Workflow",
                        "- run the workspace tests with bun directly · 2026-11-13",
                        "- run test to verify everything · 2026-11-12",
                        "- prefer reading the spec before writing code",
                        "",
                        "## Known pitfalls",
                        "- the flaky suite needs --runInBand under parallel runners · 2026-11-01 · stale",
                        "",
                        "## Manual notes",
                        "- user rule that stays (the hand-edit lane)",
                ].join("\n") + "\n",
                "utf8",
        );
        writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "bun test", build: "next build" } }, null, 2), "utf8");
}

test("the tiers + injection + store + queue + seal: a healthy project with a sealed probe", async () => {
        scaffoldProject();
        const report = await auditProjectMemory(dir, fakeEngine());
        // the four tiers resolved from disk
        expect(report.tiers.map((t) => t.tier)).toEqual(["policy", "project", "user", "local"]);
        const project = report.tiers.find((t) => t.tier === "project")!;
        expect(project.rules).toBe(5); // 3 workflow + 1 pitfall + 1 manual bullet (countProjectRules counts every section bullet)
        expect(project.stale).toBe(1); // the --runInBand pitfall carries the stale stamp
        expect(report.engine).toBe("up");
        expect(report.store).toMatchObject({ duplicates: 2, superseded: 5, dormant: 1, sroTagged: 9, memoryCount: 40 });
        expect(report.reviewQueue).toBe(3);
        expect(report.recallSeal).toBe("sealed");
        // the findings carry the tier rows, the injection row, the store row,
        // the review row, and the seal row
        const classes = report.findings.map((f) => f.class);
        expect(classes).toContain("tier project");
        expect(classes).toContain("injection budget");
        expect(classes).toContain("store health");
        expect(classes).toContain("review queue");
        expect(classes).toContain("recall seal");
});

test("the recall seal: a superseded row answering a default recall bare is a LEAK finding", async () => {
        scaffoldProject();
        const engine = fakeEngine({
                async searchProbe() {
                        // the leak class the CP1 seal exists to prevent — the doctor
                        // proves it per-run (the memU law: prove the loop)
                        return [{ id: "dead-1", metadata: { supersededBy: "live-1", invalidAt: "2026-11-10T00:00:00Z" } }];
                },
        });
        const report = await auditProjectMemory(dir, engine);
        expect(report.recallSeal).toBe("leak");
        const seal = report.findings.find((f) => f.class === "recall seal")!;
        expect(seal.severity).toBe("warn");
        expect(seal.detail).toContain("LEAK");
        expect(seal.remedy).toBeDefined();
});

test("the recall seal: zero probe hits is UNVERIFIED (honest), never a fake sealed", async () => {
        scaffoldProject();
        const engine = fakeEngine({ async searchProbe() { return []; } });
        const report = await auditProjectMemory(dir, engine);
        expect(report.recallSeal).toBe("unverified");
});

test("engine-down: the store/queue/seal degrade to absent, the tier audit still runs (engine-down safe)", async () => {
        scaffoldProject();
        const down: MemoryDoctorEngine = {
                async health() { return null; },
                async reviewDepth() { return null; },
                async searchProbe() { return null; },
        };
        const report = await auditProjectMemory(dir, down);
        expect(report.engine).toBe("down");
        expect(report.store).toBeNull();
        expect(report.reviewQueue).toBeNull();
        expect(report.recallSeal).toBe("unverified");
        expect(report.tiers.length).toBe(4); // the disk audit stood
        const classes = report.findings.map((f) => f.class);
        expect(classes).toContain("tier project");
        // engine-down renders the honest info row (never silently skipped)
        expect(classes).toContain("store health");
        expect(report.findings.find((f) => f.class === "store health")!.severity).toBe("info");
});

test("placement: user-tier bullets with paths are flagged; project-tier pure-workflow bullets are hoist candidates", async () => {
        scaffoldProject();
        // the user-tier test seam (term.ts resolves UNOWN_HOME at module load —
        // a per-test redirect cannot reach it; pass the content directly)
        const userTierText = ["# user", "", "## rules", "- run the app from ~/work/api with npm start", "- a clean rule about verifying before asserting", "- the config lives in src/config/settings.ts"].join("\n") + "\n";
        const report = await auditProjectMemory(dir, fakeEngine(), { userTierText });
        expect(report.placement.misplacedUserTier.length).toBeGreaterThanOrEqual(2); // the ~/ rule + the src/... rule
        expect(report.placement.misplacedUserTier.some((b) => b.includes("~/work/api"))).toBe(true);
        // the project tier's pure-workflow bullets (run/prefer, no path, no version)
        expect(report.placement.hoistCandidates.some((b) => b.includes("workspace tests"))).toBe(true);
        expect(report.placement.hoistCandidates.some((b) => b.includes("reading the spec"))).toBe(true);
        // the derivable class: "run test …" where test is a package.json script
        expect(report.derivable).toEqual(["run test to verify everything"]);
});

test("the renderer: ✓/✗/· marks, the remedy lines, and the summary", () => {
        const report: MemoryDoctorReport = {
                project: "/x",
                engine: "up",
                tiers: [],
                injection: null,
                store: null,
                reviewQueue: 0,
                recallSeal: "sealed",
                placement: { misplacedUserTier: [], hoistCandidates: [] },
                derivable: [],
                findings: [
                        { class: "tier project", severity: "ok", detail: "1,000/48,000 chars (2%)" },
                        { class: "recall seal", severity: "warn", detail: "LEAK — 1 superseded row(s)", remedy: "file it" },
                        { class: "store health", severity: "info", detail: "engine unreachable" },
                ],
        };
        const text = renderMemoryDoctorReport(report);
        expect(text).toContain("memory doctor — /x");
        expect(text).toContain("engine up (store audited)");
        expect(text).toContain("✓ tier project: 1,000/48,000 chars (2%)");
        expect(text).toContain("✗ recall seal: LEAK");
        expect(text).toContain("    → file it");
        expect(text).toContain("· store health");
        expect(text).toContain("1 item(s) need attention");
});
