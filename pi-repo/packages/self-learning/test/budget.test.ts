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
//     the stored tiers stay untouched (injection-time degradation only); the
//     mem0-backed project tier's cap is mem0MaxRendered at render time —
//     stored platform memories are never pruned.
//   - term.ts: terminalMemoryForAgent carries the same budget.
//   - F8: resolveMemory().totalChars counts the actual block (header +
//     wrappers), not the raw tier sum.
import "./_env.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maxTotalChars, pruneToBudget, type BudgetFile } from "../src/budget.ts";
import { mem0MaxRendered, renderProjectMemoryMarkdown, type PlatformMemory } from "../src/memzero.ts";
import { appendRules, readTier, resolveMemory, resolveMemoryForAgentDetailed, writeTier, MEMORY_DIR } from "../src/memory.ts";
import { terminalMemoryForAgent, terminalMemoryForAgentDetailed } from "../src/term.ts";
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

        test("multi-block drop in ONE tier: surviving content is exactly pristine minus the dropped blocks (string equality)", () => {
                // 3 dated blocks; the cap equals the total after dropping the 2 OLDEST
                // (one drop alone leaves the total above it by the middle block's
                // length). Pre-fix, the second drop re-applied the accumulated
                // original-coordinate ranges to the ALREADY-CUT string and ate the
                // newest block entirely while prunedBlocks claimed only 2 old drops.
                const base = `# base knowledge\n- keep me\n\n`;
                const oldest = `<!-- agent @ 2024-01-01 10:00 — oldest -->\n- old rule A\n${"a".repeat(300)}\n\n`;
                const middle = `<!-- agent @ 2025-06-01 10:00 — middle -->\n- mid rule M\n${"m".repeat(300)}\n\n`;
                const newest = `<!-- agent @ 2026-06-01 10:00 — newest -->\n- new rule B\n${"n".repeat(300)}\n`;
                const files: BudgetFile[] = [GUIDE, POLICY, { path: "p", content: base + oldest + middle + newest, tier: "project" }];
                const cap = files.reduce((s, f) => s + f.path.length + f.content.length, 0) - oldest.length - middle.length;
                const { files: out, report } = pruneToBudget(files, { cap });
                // EXACT surviving content — string equality, not just length: the tier's
                // content minus the dropped blocks (oldest-first), NO collateral cuts.
                expect(out.find((f) => f.tier === "project")!.content).toBe(base + newest);
                // prunedBlocks stays truthful: exactly the 2 blocks actually dropped.
                expect(report.prunedBlocks).toEqual([
                        { tier: "project", note: "agent — oldest", date: "2024-01-01 10:00", chars: oldest.length },
                        { tier: "project", note: "agent — middle", date: "2025-06-01 10:00", chars: middle.length },
                ]);
                expect(report.truncatedTiers).toEqual([]); // blocks sufficed — no head-truncation
                expect(report.overflow).toBe(false);
                expect(report.totalAfter).toBeLessThanOrEqual(cap);
        });

        test("multi-block drop across TWO tiers: each tier drops 2 (4 total), both survivors exact", () => {
                // Dates interleave so the global oldest-first order is user, project,
                // user, project — 2 drops per tier, cross-tier, in one pass.
                const uOld1 = `<!-- agent @ 2024-01-01 09:00 — u-old1 -->\n- user old one\n${"u".repeat(300)}\n\n`;
                const pOld1 = `<!-- agent @ 2024-02-02 09:00 — p-old1 -->\n- proj old one\n${"p".repeat(300)}\n\n`;
                const uOld2 = `<!-- agent @ 2025-01-01 09:00 — u-old2 -->\n- user old two\n${"v".repeat(300)}\n\n`;
                const pOld2 = `<!-- agent @ 2025-02-02 09:00 — p-old2 -->\n- proj old two\n${"q".repeat(300)}\n\n`;
                const uNew = `<!-- agent @ 2026-06-01 09:00 — u-new -->\n- user new\n${"U".repeat(300)}\n`;
                const pNew = `<!-- agent @ 2026-07-07 09:00 — p-new -->\n- proj new\n${"P".repeat(300)}\n`;
                const files: BudgetFile[] = [
                        GUIDE,
                        POLICY,
                        { path: "user", content: `# user\n\n${uOld1}${uOld2}${uNew}`, tier: "user" },
                        { path: "proj", content: `# proj\n\n${pOld1}${pOld2}${pNew}`, tier: "project" },
                ];
                const cap = files.reduce((s, f) => s + f.path.length + f.content.length, 0) - uOld1.length - uOld2.length - pOld1.length - pOld2.length;
                const { files: out, report } = pruneToBudget(files, { cap });
                expect(out.find((f) => f.tier === "user")!.content).toBe(`# user\n\n${uNew}`);
                expect(out.find((f) => f.tier === "project")!.content).toBe(`# proj\n\n${pNew}`);
                expect(report.prunedBlocks).toHaveLength(4);
                expect(report.prunedBlocks.map((b) => `${b.tier}@${b.date}`)).toEqual([
                        "user@2024-01-01 09:00",
                        "project@2024-02-02 09:00",
                        "user@2025-01-01 09:00",
                        "project@2025-02-02 09:00",
                ]);
                expect(report.truncatedTiers).toEqual([]);
                expect(report.overflow).toBe(false);
                expect(report.totalAfter).toBeLessThanOrEqual(cap);
        });

        test("multi-block drop does not re-apply ranges at shifted coordinates (mid-tier block between dropped ones survives byte-identical)", () => {
                // The failure mode this name cites: with ≥2 drops in ONE tier, every
                // loop iteration re-applied ALL accumulated original-coordinate cut
                // ranges to the ALREADY-CUT string. The first range re-landed at
                // SHIFTED coordinates over the survivor's head (its provenance marker
                // + rule text silently eaten) and later ranges removed shifted text —
                // a chunk of a block the report claimed was PRUNED leaked back into
                // the injection. Verified empirically pre-fix: the survivor came out
                // as a bare pad tail and the "dropped" 2025 marker was resurrected.
                const base = `# base knowledge\n- keep me\n\n`;
                const drop1 = `<!-- agent @ 2024-01-01 10:00 — drop1 -->\n- old rule one\n${"1".repeat(300)}\n\n`; // oldest date
                const survivor = `<!-- agent @ 2026-06-01 10:00 — survivor -->\n- mid-tier rule that must survive byte-identical\n${"S".repeat(300)}\n\n`; // newest date, FILE position between the two drops
                const drop2 = `<!-- agent @ 2025-01-01 10:00 — drop2 -->\n- old rule two\n${"2".repeat(300)}\n`; // middle date
                const files: BudgetFile[] = [GUIDE, POLICY, { path: "p", content: base + drop1 + survivor + drop2, tier: "project" }];
                const cap = files.reduce((s, f) => s + f.path.length + f.content.length, 0) - drop1.length - drop2.length;
                const { files: out, report } = pruneToBudget(files, { cap });
                const shipped = out.find((f) => f.tier === "project")!.content;
                // The survivor sits BETWEEN the two dropped blocks positionally and
                // must come through byte-identical; the dropped content stays dropped.
                expect(shipped).toBe(base + survivor);
                expect(shipped).toContain("<!-- agent @ 2026-06-01 10:00 — survivor -->"); // provenance intact
                expect(shipped).not.toContain("drop2"); // no resurrected "pruned" content
                expect(report.prunedBlocks.map((b) => b.date)).toEqual(["2024-01-01 10:00", "2025-01-01 10:00"]);
                expect(report.overflow).toBe(false);
                expect(report.totalAfter).toBeLessThanOrEqual(cap);
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
        test("fat tiers + dated blocks: injection ≤ cap, oldest block out, stored tier untouched", async () => {
                // Post-swap note: appendRules' dated droppable blocks are pinned on the
                // USER tier (the project tier is the mem0-backed surface — its cap is the
                // render cap, pinned in the next test). The injection-budget contract is
                // tier-agnostic: pruneToBudget runs over the whole resolved block.
                const pad = (n: number) => `${"k".repeat(n)}`;
                writeTier("project", `# project base\n${pad(30_000)}`, "test", "fat base");
                writeTier("user", `# user\n${pad(30_000)}`, "test", "fat user");
                await appendRules("user", ["old appended rule one"], "harness", "old block");
                await appendRules("user", ["new appended rule two"], "harness", "new block");
                writeTier("local", `# local\n${pad(25_000)}`, "test", "fat local");

                const { files, report } = resolveMemoryForAgentDetailed();
                const injected = files.reduce((s, f) => s + f.content.length, 0);
                expect(injected).toBeLessThanOrEqual(maxTotalChars());
                expect(report.totalBefore).toBeGreaterThan(maxTotalChars()); // it genuinely needed degradation
                expect(report.prunedBlocks.length).toBeGreaterThan(0);

                const injectedUser = files.find((f) => f.path.includes("tier2-user"))!.content;
                // Oldest dropped (the newest block may fall to head-truncation — the
                // undated pad is the bulk of the tier).
                expect(injectedUser).not.toContain("old appended rule one");
                // Guide + policy fully intact.
                expect(files.find((f) => f.path.includes("how-to-use"))!.content).toContain("Four memory tiers");
                expect(files.find((f) => f.path.includes("tier0-policy"))!.content).toContain("guardrail");

                // Stored memory untouched: both blocks are still on disk/DB.
                const stored = readTier("user");
                expect(stored).toContain("old appended rule one");
                expect(stored).toContain("new appended rule two");

                store.run(`DELETE FROM memory_versions`);
                rmSync(MEMORY_DIR, { recursive: true, force: true });
        });

        test("mem0 shape: the rendered project tier honors mem0MaxRendered, stored platform memories are never pruned", () => {
                // The project tier's size contract moved INTO the platform render: the
                // deterministic render keeps the newest `cap` bullets (hard-won
                // harness/seed rules immune), while every stored platform memory stays
                // — nothing is lost at rest, the injection still fits the total budget.
                const saved = process.env.PI_MEM0_MAX_RENDERED;
                try {
                        process.env.PI_MEM0_MAX_RENDERED = "6";
                        expect(mem0MaxRendered()).toBe(6);
                        const stamp = (i: number) => new Date(2024, 0, 1 + i).toISOString();
                        const memories: PlatformMemory[] = [];
                        for (let i = 0; i < 8; i++) {
                                memories.push({
                                        id: `note-${i}`,
                                        text: `ordinary lesson number ${i} about the parser loop`,
                                        createdAt: stamp(i),
                                        updatedAt: stamp(i),
                                        metadata: { kind: "note" },
                                });
                        }
                        memories.push({ id: "seed-1", text: "run the workspace tests with bun directly", createdAt: stamp(0), updatedAt: stamp(0), metadata: { kind: "seed" } });
                        memories.push({ id: "fix-1", text: "quote the CSV fields before splitting rows", createdAt: stamp(1), updatedAt: stamp(1), metadata: { kind: "harness" } });

                        const rendered = renderProjectMemoryMarkdown(memories);
                        const bullets = rendered.split("\n").filter((l) => l.startsWith("- "));
                        expect(bullets).toHaveLength(8); // 6 newest notes + the 2 immune hard-won rules
                        expect(rendered).toContain("ordinary lesson number 7");
                        expect(rendered).toContain("ordinary lesson number 2");
                        expect(rendered).not.toContain("ordinary lesson number 1");
                        expect(rendered).not.toContain("ordinary lesson number 0");
                        expect(rendered).toContain("run the workspace tests with bun directly");
                        expect(rendered).toContain("quote the CSV fields before splitting rows");
                        // the render footer is honest about the degradation
                        expect(rendered).toContain("2 oldest pruned at render (cap 6; hard-won rules immune)");

                        // STORED-NOT-PRUNED: the platform keeps every memory (the cap is
                        // render-time only — injection hygiene, never data loss).
                        expect(memories).toHaveLength(10);

                        // And the capped tier still feeds the total-budget injection path.
                        writeTier("project", rendered, "test", "rendered view");
                        const { files, report } = resolveMemoryForAgentDetailed();
                        const injected = files.reduce((s, f) => s + f.content.length, 0);
                        expect(injected).toBeLessThanOrEqual(maxTotalChars());
                        expect(report.totalAfter).toBeLessThanOrEqual(maxTotalChars());
                } finally {
                        if (saved === undefined) delete process.env.PI_MEM0_MAX_RENDERED;
                        else process.env.PI_MEM0_MAX_RENDERED = saved;
                        store.run(`DELETE FROM memory_versions`);
                        rmSync(MEMORY_DIR, { recursive: true, force: true });
                }
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
                        // policy ≈ 555 + local/user seeds ≈ 470) plus the project memory
                        // MINUS the oldest block fits under 2400 — so one block drop
                        // is exactly the degradation needed. (M10 raised the floor:
                        // the honest repo-supplied provenance comment is ~70 chars
                        // longer than the old "maintained by AutoDream" one; the
                        // 2026-10 verify-first defaults grew the policy seed by two
                        // guardrails, so the cap grew with it; the payload lines carry
                        // spaces so the injection scan's opaque-blob rule — correctly
                        // — does not fire on them.)
                        process.env.PI_MEMORY_TOTAL_CHARS = "2400";
                        mkdirSync(join(project, ".unown", "memory"), { recursive: true });
                        writeFileSync(
                                join(project, ".unown", "memory", "project.md"),
                                `# base\n- keep\n\n<!-- agent @ 2024-01-01 10:00 — old -->\n- ${"old line ".repeat(44)}\n\n<!-- agent @ 2026-01-01 10:00 — new -->\n- ${"new line ".repeat(12)}\n`,
                                "utf8",
                        );
                        mkdirSync(UNOWN_MEMORY_DIR, { recursive: true });
                        writeFileSync(join(UNOWN_MEMORY_DIR, "user.md"), "# user\n- preference\n", "utf8");

                        const files = terminalMemoryForAgent(project);
                        const total = files.reduce((s, f) => s + f.path.length + f.content.length, 0);
                        expect(total).toBeLessThanOrEqual(2400);
                        const paths = files.map((f) => f.path).join("\n");
                        expect(paths).toContain("how-to-use"); // guide kept
                        expect(paths).toContain("tier0-policy"); // policy kept
                        const projectFile = files.find((f) => f.tier === "project")!;
                        expect(projectFile.content).toContain("# base");
                        expect(projectFile.content).toContain("new line new line"); // newest block kept
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

// ---------------------------------------------------------------------------
// terminalMemoryForAgentDetailed — the injection-budget report surface
// (/learning shows truncation instead of silently acting on partial memory)
// ---------------------------------------------------------------------------
describe("terminalMemoryForAgentDetailed — budget report visibility", () => {
        test("returns the files AND the report; a small stack fits whole", () => {
                const dir = mkdtempSync(join(tmpdir(), "budget-detailed-"));
                const { files, report } = terminalMemoryForAgentDetailed(dir);
                expect(files.length).toBeGreaterThan(0);
                expect(report.cap).toBeGreaterThan(0);
                expect(report.totalAfter).toBeLessThanOrEqual(report.cap);
                expect(report.prunedBlocks).toHaveLength(0);
                expect(report.overflow).toBe(false);
                rmSync(dir, { recursive: true, force: true });
        });

        test("an oversized project tier is honestly reported as truncated", () => {
                const dir = mkdtempSync(join(tmpdir(), "budget-trunc-"));
                // scaffold .unown/memory first (initProjectMemory runs on first resolve)
                terminalMemoryForAgentDetailed(dir);
                // blow past the per-tier + total caps with a giant local tier
                const giant = "- " + "x".repeat(200_000);
                writeFileSync(join(dir, ".unown", "memory", "local.md"), `# Tier 3\n\n${giant}\n`);
                const { report } = terminalMemoryForAgentDetailed(dir);
                expect(report.overflow === true || report.prunedBlocks.length > 0 || report.truncatedTiers.length > 0).toBe(true);
                rmSync(dir, { recursive: true, force: true });
        });
});
