// Unit tests for src/budget.ts + its wiring into memory.ts / term.ts — the
// §5.5 hard-sum budget on the resolved memory block (strategy §4.8) and the
// F8 fix (resolvedChars = the actual resolved block).
//
// Layers:
//   - maxTotalChars / pruneToBudget (pure): no-op under budget; oldest dated
//     rule blocks dropped first (date order, position tie-break, across
//     tiers); guide/policy NEVER pruned; undated base kept while blocks
//     remain; head-truncation with a visible marker when no blocks remain;
//     degenerate caps reported as overflow instead of dropping guardrails.
//   - memory.ts: resolveMemoryForAgentDetailed caps the INJECTED block while
//     the stored tiers stay untouched (injection-time degradation only).
//   - term.ts: terminalMemoryForAgent carries the same budget.
//   - F8: resolveMemory().totalChars counts the actual block (header +
//     wrappers), not the raw tier sum.
import "./_env.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maxTotalChars, pruneToBudget, type BudgetFile } from "../src/budget.ts";
import { appendRules, readTier, resolveMemory, resolveMemoryForAgentDetailed, writeTier, MEMORY_DIR } from "../src/memory.ts";
import { terminalMemoryForAgent } from "../src/term.ts";
import { UNOWN_MEMORY_DIR, UNOWN_HOME } from "../src/term.ts";
import { store } from "../src/store.ts";

beforeAll(() => {
        store.run(`DELETE FROM memory_versions`);
        rmSync(MEMORY_DIR, { recursive: true, force: true });
});

afterAll(() => {
        store.run(`DELETE FROM memory_versions`);
        rmSync(MEMORY_DIR, { recursive: true, force: true });
});

const GUIDE: BudgetFile = { path: "memory/how-to-use.md (guide)", content: "# guide\n- semantics\n", tier: "guide" };
const POLICY: BudgetFile = { path: "memory/tier0-policy.md", content: "# policy\n- guardrail one\n- guardrail two\n", tier: "policy" };

function fat(n: number, tag: string): string {
        return `${tag}\n` + "- ".padEnd(2) + "x".repeat(72) + "\n".repeat(1) + `rule line ${tag}\n` + "y".repeat(n) + "\n";
}

describe("maxTotalChars — the env knob", () => {
        test("default 80k; numeric override; garbage falls back", () => {
                const saved = process.env.PI_MEMORY_TOTAL_CHARS;
                try {
                        delete process.env.PI_MEMORY_TOTAL_CHARS;
                        expect(maxTotalChars()).toBe(80_000);
                        process.env.PI_MEMORY_TOTAL_CHARS = "5000";
                        expect(maxTotalChars()).toBe(5000);
                        process.env.PI_MEMORY_TOTAL_CHARS = "nan";
                        expect(maxTotalChars()).toBe(80_000);
                } finally {
                        if (saved === undefined) delete process.env.PI_MEMORY_TOTAL_CHARS;
                        else process.env.PI_MEMORY_TOTAL_CHARS = saved;
                }
        });
});

describe("pruneToBudget — pure degradation policy", () => {
        test("under budget: no-op, files identical, empty report", () => {
                const files = [GUIDE, POLICY, { path: "p", content: "small", tier: "project" }];
                const { files: out, report } = pruneToBudget(files, { cap: 1000 });
                expect(out).toEqual(files);
                expect(report.prunedBlocks).toEqual([]);
                expect(report.truncatedTiers).toEqual([]);
                expect(report.overflow).toBe(false);
        });

        test("oldest dated block dropped first; newest + undated base + protected kept", () => {
                const project = `# base knowledge\n- keep me\n\n<!-- agent @ 2024-01-01 10:00 — oldest -->\n- old rule A\n\n<!-- agent @ 2026-06-01 10:00 — newest -->\n- new rule B\n`;
                const files: BudgetFile[] = [GUIDE, POLICY, { path: "p", content: project, tier: "project" }];
                const { files: out, report } = pruneToBudget(files, { cap: files.reduce((s, f) => s + f.path.length + f.content.length, 0) - 10 });
                const shipped = out.find((f) => f.tier === "project")!.content;
                expect(shipped).toContain("# base knowledge");
                expect(shipped).toContain("new rule B");
                expect(report.prunedBlocks.map((b) => b.date)).toEqual(["2024-01-01 10:00"]);
                expect(out.find((f) => f.tier === "guide")).toEqual(GUIDE);
                expect(out.find((f) => f.tier === "policy")).toEqual(POLICY);
        });

        test("cross-tier ordering: a 2024 user block drops before a 2025 project block", () => {
                const files: BudgetFile[] = [
                        GUIDE,
                        POLICY,
                        { path: "proj", content: "<!-- a @ 2025-03-03 09:00 — newer -->\n- proj rule\n", tier: "project" },
                        { path: "user", content: "<!-- a @ 2024-02-02 08:00 — older -->\n- user rule\n", tier: "user" },
                ];
                const cap = files.reduce((s, f) => s + f.path.length + f.content.length, 0) - 5;
                const { files: out, report } = pruneToBudget(files, { cap });
                expect(report.prunedBlocks.map((b) => b.tier)).toEqual(["user"]);
                expect(out.find((f) => f.tier === "user")!.content).not.toContain("user rule");
                expect(out.find((f) => f.tier === "project")!.content).toContain("proj rule");
        });

        test("same-date blocks: earlier position (older append) drops first", () => {
                const content = `<!-- a @ 2026-01-01 10:00 — first -->\n- first\n\n<!-- a @ 2026-01-01 10:00 — second -->\n- second\n`;
                const files: BudgetFile[] = [GUIDE, POLICY, { path: "p", content, tier: "project" }];
                const cap = files.reduce((s, f) => s + f.path.length + f.content.length, 0) - 5;
                const { files: out } = pruneToBudget(files, { cap });
                const shipped = out.find((f) => f.tier === "project")!.content;
                expect(shipped).toContain("second");
                expect(shipped).not.toContain("- first");
        });

        test("no droppable blocks: head-truncation with a visible marker, cap honored", () => {
                const big = "z".repeat(5000);
                const files: BudgetFile[] = [GUIDE, POLICY, { path: "p", content: big, tier: "project" }];
                const { files: out, report } = pruneToBudget(files, { cap: 1000 });
                expect(report.truncatedTiers).toEqual(["project"]);
                const shipped = out.find((f) => f.tier === "project")!.content;
                expect(shipped).toContain("<!-- budget: pruned ");
                expect(report.totalAfter).toBeLessThanOrEqual(1000);
                // guide/policy untouched
                expect(out.find((f) => f.tier === "guide")).toEqual(GUIDE);
                expect(out.find((f) => f.tier === "policy")).toEqual(POLICY);
        });

        test("degenerate cap (protected content alone exceeds it): honest overflow, guardrails intact", () => {
                const files: BudgetFile[] = [GUIDE, POLICY, { path: "p", content: "z".repeat(5000), tier: "project" }];
                const { files: out, report } = pruneToBudget(files, { cap: 10 });
                expect(report.overflow).toBe(true);
                expect(report.totalAfter).toBeGreaterThan(10);
                expect(out.find((f) => f.tier === "policy")).toEqual(POLICY); // never dropped
                expect(report.truncatedTiers).toEqual(["project"]);
        });
});

describe("memory.ts — the injected block is capped, the stored memory is not", () => {
        test("fat tiers + dated blocks: injection ≤ cap, oldest block out, stored tier untouched", () => {
                const pad = (n: number) => `${"k".repeat(n)}`;
                writeTier("project", `# project base\n${pad(30_000)}`, "test", "fat base");
                appendRules("project", ["old appended rule one"], "harness", "old block");
                appendRules("project", ["new appended rule two"], "harness", "new block");
                writeTier("user", `# user\n${pad(30_000)}`, "test", "fat user");
                writeTier("local", `# local\n${pad(25_000)}`, "test", "fat local");

                const { files, report } = resolveMemoryForAgentDetailed();
                const injected = files.reduce((s, f) => s + f.content.length, 0);
                expect(injected).toBeLessThanOrEqual(maxTotalChars());
                expect(report.totalBefore).toBeGreaterThan(maxTotalChars()); // it genuinely needed degradation
                expect(report.prunedBlocks.length).toBeGreaterThan(0);

                const injectedProject = files.find((f) => f.path.includes("tier1-project"))!.content;
                // Oldest dropped, newest kept, base kept (truncation may cut the pad).
                expect(injectedProject).not.toContain("old appended rule one");
                // Guide + policy fully intact.
                expect(files.find((f) => f.path.includes("how-to-use"))!.content).toContain("Four memory tiers");
                expect(files.find((f) => f.path.includes("tier0-policy"))!.content).toContain("guardrail");

                // Stored memory untouched: the block is still on disk/DB.
                const stored = readTier("project");
                expect(stored).toContain("old appended rule one");
                expect(stored).toContain("new appended rule two");

                store.run(`DELETE FROM memory_versions`);
                rmSync(MEMORY_DIR, { recursive: true, force: true });
        });

        test("overlay candidates are budgeted too (candidate memory never bypasses the cap)", () => {
                writeTier("project", "small base", "test", "base");
                const { files } = resolveMemoryForAgentDetailed({ user: "u".repeat(90_000) });
                const injected = files.reduce((s, f) => s + f.content.length, 0);
                expect(injected).toBeLessThanOrEqual(maxTotalChars());
                store.run(`DELETE FROM memory_versions`);
                rmSync(MEMORY_DIR, { recursive: true, force: true });
        });
});

describe("term.ts — the terminal injection carries the same budget", () => {
        test("terminalMemoryForAgent drops the oldest block to fit; guide/policy spared", () => {
                const saved = process.env.PI_MEMORY_TOTAL_CHARS;
                const project = join(tmpdir(), "engine-tests-budget", "project");
                try {
                        // Achievable cap: the protected stack (guide ≈ 660 +
                        // policy ≈ 400 + local/user seeds ≈ 470) plus the project memory
                        // MINUS the oldest block fits under 2000 — so one block drop
                        // is exactly the degradation needed.
                        process.env.PI_MEMORY_TOTAL_CHARS = "2000";
                        mkdirSync(join(project, ".unown", "memory"), { recursive: true });
                        writeFileSync(
                                join(project, ".unown", "memory", "project.md"),
                                `# base\n- keep\n\n<!-- agent @ 2024-01-01 10:00 — old -->\n${"o".repeat(400)}\n\n<!-- agent @ 2026-01-01 10:00 — new -->\n${"n".repeat(100)}\n`,
                                "utf8",
                        );
                        mkdirSync(UNOWN_MEMORY_DIR, { recursive: true });
                        writeFileSync(join(UNOWN_MEMORY_DIR, "user.md"), "# user\n- preference\n", "utf8");

                        const files = terminalMemoryForAgent(project);
                        const total = files.reduce((s, f) => s + f.path.length + f.content.length, 0);
                        expect(total).toBeLessThanOrEqual(2000);
                        const paths = files.map((f) => f.path).join("\n");
                        expect(paths).toContain("how-to-use"); // guide kept
                        expect(paths).toContain("tier0-policy"); // policy kept
                        const projectFile = files.find((f) => f.tier === "project")!;
                        expect(projectFile.content).toContain("# base");
                        expect(projectFile.content).toContain("n".repeat(20)); // newest block kept
                        expect(projectFile.content).not.toContain("o".repeat(20)); // oldest block dropped
                } finally {
                        if (saved === undefined) delete process.env.PI_MEMORY_TOTAL_CHARS;
                        else process.env.PI_MEMORY_TOTAL_CHARS = saved;
                        rmSync(join(tmpdir(), "engine-tests-budget"), { recursive: true, force: true });
                        rmSync(join(UNOWN_HOME, "memory"), { recursive: true, force: true });
                }
        });
});

describe("F8 — resolveMemory().totalChars is the actual block", () => {
        test("counts header + wrappers + provenance, greater than the raw tier sum", () => {
                writeTier("project", "# p\n- one\n", "test", "v");
                writeTier("user", "# u\n- two\n", "test", "v");
                const resolved = resolveMemory();
                const rawSum = ["policy", "project", "user", "local"].reduce((s, t) => s + readTier(t).length, 0);
                expect(resolved.totalChars).toBeGreaterThan(rawSum);
                expect(resolved.block).toContain("# Agent Memory");
                expect(resolved.block).toContain("<project_instructions");
                store.run(`DELETE FROM memory_versions`);
                rmSync(MEMORY_DIR, { recursive: true, force: true });
        });
});
