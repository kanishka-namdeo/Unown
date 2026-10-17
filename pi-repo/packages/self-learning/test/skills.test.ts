// Unit tests for src/skills.ts — skill minting validation boundaries.
//
// Backlog reference: docs/testing-strategy.md §4.2 (self-learning engine).
// validateProposal / validateSkillName / existingSkillNames are module-private
// (needs extraction — noted, src NOT modified); their boundaries are pinned
// here through the exported surface instead:
//   - renderSkillMd / projectSkillsDir (pure)
//   - mintSkillsForProject, with the LLM (chatJson -> fetch) mocked via
//     globalThis.fetch. The context-budget ceiling (24 skills) is observable
//     without any LLM call because it short-circuits before chatJson.
//
// These tests run on `bun test` (bun:test is built in — zero new deps).
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSkills, mintSkillsForProject, projectSkillsDir, renderSkillMd, skillVersions } from "../src/skills.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ROOT = join(tmpdir(), "engine-tests-b", "skills");
// Run-unique suffix: the redirected SQLite DB persists across bun test
// invocations, so slugs must never collide between runs.
const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

mkdirSync(ROOT, { recursive: true });
afterAll(() => {
        rmSync(ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// LLM mock (chatJson -> chat -> fetch -> bridge)
// ---------------------------------------------------------------------------
let fetchCalls = 0;
const realFetch = globalThis.fetch;

function mockLlmResponse(skills: unknown[]) {
        fetchCalls = 0;
        globalThis.fetch = (async () => {
                fetchCalls++;
                const content = JSON.stringify({ skills });
                return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
                        headers: { "content-type": "application/json" },
                });
        }) as typeof fetch;
}

function failFetch() {
        fetchCalls = 0;
        globalThis.fetch = (async () => {
                fetchCalls++;
                // Message deliberately does NOT match llm.ts's retry regex, so this
                // fails fast instead of retrying 3x with backoff sleeps.
                throw new Error("no-llm-in-tests");
        }) as typeof fetch;
}

afterEach(() => {
        globalThis.fetch = realFetch;
});

interface Proposal {
        name?: unknown;
        description?: unknown;
        markdown?: unknown;
}

function proposal(over: { name?: unknown; description?: unknown; markdown?: unknown } = {}): Proposal {
        return {
                name: over.name ?? "run-tests",
                description: over.description ?? "Use when the project test suite must be run or debugged.",
                markdown: over.markdown ?? "x".repeat(120),
        };
}

function newProject(): { projectPath: string; slug: string } {
        const dir = mkdtempSync(join(ROOT, "proj-"));
        return { projectPath: dir, slug: `${RUN}-${dir.slice(-6)}` };
}

async function mint(projectPath: string, slug: string, skills: Proposal[]) {
        mockLlmResponse(skills);
        return mintSkillsForProject({
                projectPath,
                slug,
                consolidatedMemory: "consolidated memory",
                notesText: "session notes",
                dreamId: "dream-1",
        });
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
describe("renderSkillMd", () => {
        test("golden frontmatter + body", () => {
                expect(renderSkillMd("run-tests", "Use when tests must run", "# Steps\n\n1. npm test")).toBe(
                        "---\nname: run-tests\ndescription: Use when tests must run\n---\n\n# Steps\n\n1. npm test\n",
                );
        });

        test("description newlines are flattened to spaces and trimmed", () => {
                expect(renderSkillMd("n", " line one\nline two  ", "body")).toContain("description: line one line two\n");
        });

        test("markdown body is trimmed", () => {
                expect(renderSkillMd("n", "d", "  body  ")).toBe("---\nname: n\ndescription: d\n---\n\nbody\n");
        });
});

describe("projectSkillsDir", () => {
        test("is <project>/.unown/skills (terminal sessions discover it)", () => {
                expect(projectSkillsDir("/p")).toBe(join("/p", ".unown", "skills"));
        });
});

// ---------------------------------------------------------------------------
// Minting: happy path
// ---------------------------------------------------------------------------
describe("mintSkillsForProject — happy path", () => {
        test("ships a valid proposal: file + DB row + version 1 + dream provenance", async () => {
                const { projectPath, slug } = newProject();
                const shipped = await mint(projectPath, slug, [proposal()]);
                expect(shipped).toHaveLength(1);
                expect(shipped[0]).toEqual({
                        name: "run-tests",
                        description: "Use when the project test suite must be run or debugged.",
                        path: join(projectPath, ".unown", "skills", "run-tests", "SKILL.md"),
                });
                const content = readFileSync(shipped[0].path, "utf8");
                expect(content).toBe(renderSkillMd("run-tests", "Use when the project test suite must be run or debugged.", "x".repeat(120)));

                const rows = listSkills(slug);
                expect(rows).toHaveLength(1);
                expect(rows[0].name).toBe("run-tests");
                expect(rows[0].status).toBe("shipped");
                expect(rows[0].version).toBe(1);
                expect(rows[0].dream_id).toBe("dream-1");

                const versions = skillVersions(rows[0].id);
                expect(versions).toHaveLength(1);
                expect(versions[0].version).toBe(1);
                expect(versions[0].changed_by).toBe("autodream");
        });

        test("QUIRK: names are silently normalized (trim + lowercase) instead of rejected", async () => {
                const { projectPath, slug } = newProject();
                const shipped = await mint(projectPath, slug, [proposal({ name: "  Run-Tests  " })]);
                expect(shipped.map((s) => s.name)).toEqual(["run-tests"]);
        });

        test("QUIRK: an ALL-uppercase name is lowercased into a valid name, not rejected", async () => {
                const { projectPath, slug } = newProject();
                const shipped = await mint(projectPath, slug, [proposal({ name: "RunTests" })]);
                expect(shipped.map((s) => s.name)).toEqual(["runtests"]);
        });

        test("caps at 2 skills per dream (first two of the response win)", async () => {
                const { projectPath, slug } = newProject();
                const shipped = await mint(projectPath, slug, [
                        proposal({ name: "skill-a" }),
                        proposal({ name: "skill-b" }),
                        proposal({ name: "skill-c" }),
                ]);
                expect(shipped.map((s) => s.name)).toEqual(["skill-a", "skill-b"]);
        });
});

// ---------------------------------------------------------------------------
// Minting: proposal validation boundaries (validateProposal is module-private
// — needs extraction; boundaries pinned through the observable result)
// ---------------------------------------------------------------------------
describe("mintSkillsForProject — proposal validation boundaries", () => {
        test.each([
                ["empty name", proposal({ name: "" })],
                ["name with a space", proposal({ name: "has space" })],
                ["name with an underscore", proposal({ name: "run_tests" })],
                ["65-char name (limit 64)", proposal({ name: "a".repeat(65) })],
                ["reserved starter-skill name", proposal({ name: "unown-self-learning" })],
                ["empty description", proposal({ description: "" })],
                ["1025-char description (limit 1024)", proposal({ description: "d".repeat(1025) })],
                ["79-char body (min 80)", proposal({ markdown: "x".repeat(79) })],
                ["8001-char body (limit 8000)", proposal({ markdown: "x".repeat(8001) })],
                ["121-line body (limit 120)", proposal({ markdown: Array<string>(121).fill("line").join("\n") })],
                ["name missing entirely", { description: "d".repeat(80), markdown: "x".repeat(120) }],
        ])("rejects %s", async (_label: string, bad: Proposal) => {
                const { projectPath, slug } = newProject();
                const shipped = await mint(projectPath, slug, [bad]);
                expect(shipped).toEqual([]);
        });

        test.each([
                ["64-char name (limit 64)", { name: "a".repeat(64) }],
                ["1024-char description (limit 1024)", { description: "d".repeat(1024) }],
                ["80-char body (min 80)", { markdown: "x".repeat(80) }],
                ["120-line body (limit 120)", { markdown: Array<string>(120).fill("line").join("\n") }],
        ])("ships the %s", async (_label: string, over: { name?: unknown; description?: unknown; markdown?: unknown }) => {
                const { projectPath, slug } = newProject();
                const shipped = await mint(projectPath, slug, [proposal(over)]);
                expect(shipped).toHaveLength(1);
        });

        test("rejects a name already on disk for the project (dedup)", async () => {
                const { projectPath, slug } = newProject();
                const dir = join(projectSkillsDir(projectPath), "dup-name");
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, "SKILL.md"), "existing");
                const shipped = await mint(projectPath, slug, [proposal({ name: "dup-name" })]);
                expect(shipped).toEqual([]);
        });

        test("rejects a name already shipped in the DB for the project", async () => {
                const { projectPath, slug } = newProject();
                await mint(projectPath, slug, [proposal()]); // ships run-tests
                const second = await mint(projectPath, slug, [proposal()]);
                expect(second).toEqual([]);
        });
});

// ---------------------------------------------------------------------------
// Context-budget ceiling (24 skills per project) — observable without any LLM
// ---------------------------------------------------------------------------
describe("mintSkillsForProject — context-budget ceiling (24 per project)", () => {
        test("at 24 existing skills minting short-circuits BEFORE any LLM call", async () => {
                const { projectPath, slug } = newProject();
                const dir = projectSkillsDir(projectPath);
                for (let i = 0; i < 24; i++) mkdirSync(join(dir, `s${String(i).padStart(2, "0")}`), { recursive: true });
                failFetch();
                const shipped = await mintSkillsForProject({
                        projectPath,
                        slug,
                        consolidatedMemory: "m",
                        notesText: "n",
                        dreamId: "d",
                });
                expect(shipped).toEqual([]);
                expect(fetchCalls).toBe(0); // the ceiling path never consults the LLM
        });

        test("at 23 existing skills the LLM IS consulted (boundary is exactly 24)", async () => {
                const { projectPath, slug } = newProject();
                const dir = projectSkillsDir(projectPath);
                for (let i = 0; i < 23; i++) mkdirSync(join(dir, `s${String(i).padStart(2, "0")}`), { recursive: true });
                failFetch();
                const shipped = await mintSkillsForProject({
                        projectPath,
                        slug,
                        consolidatedMemory: "m",
                        notesText: "n",
                        dreamId: "d",
                });
                expect(shipped).toEqual([]); // LLM failure is swallowed — minting never throws
                expect(fetchCalls).toBe(1);
        });
});
