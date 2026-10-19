// repo-wiki.test.ts — Milestone 4.2: automatic repo documentation with
// file:line cross-links (the zcode Repo Wiki port).
//
// Covers the full surface contract of src/repo-wiki.ts + src/wiki-cli.ts:
//   - discoverModules: top-level dirs, excludes, maxDepth, empty repos,
//     hidden-dir skip, source-extension filter
//   - generateModulePage: prompt construction, structured-reply parsing,
//     subagent failure → error page, schema-validation failure
//   - generateIndexPage: synthesizes an index linking all module pages,
//     includes project info (name, languages, frameworks)
//   - generateArchitecturePage: dependency graph (DOT + markdown list),
//     cycle detection
//   - writeWiki: atomic writes (tmp + rename), manifest update, --force
//     semantics, refuses overwrite without --force
//   - generateWiki: orchestrates discover → parallel module pages → index +
//     architecture → write; handles partial failures
//   - searchWiki: ranked results, empty results, missing wiki dir
//   - runWikiCommand: generate / search / list / show subcommands
//
// The subagent runner is mocked (no real pi spawn). Wiki generation uses
// mkdtempSync fixture repos. bun:test is the runner — zero new deps.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        discoverModules,
        generateArchitecturePage,
        generateIndexPage,
        generateModulePage,
        generateWiki,
        type ModuleInfo,
        type ProjectInfo,
        type WikiPage,
        type WikiRunContext,
        searchWiki,
        writeWiki,
        type WikiManifest,
        mapLimit,
        wikiConcurrency,
} from "../src/repo-wiki.ts";
import { runWikiCommand } from "../src/wiki-cli.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TMP_ROOT = mkdtempSync(join(tmpdir(), "unown-repo-wiki-"));

afterAll(() => {
        try {
                rmSync(TMP_ROOT, { recursive: true, force: true });
        } catch {
                /* best effort */
        }
});

/** A fixture repo for one test (mkdtemp under TMP_ROOT). */
function freshRepo(name: string): string {
        const dir = join(TMP_ROOT, name);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        return dir;
}

/** Write a file (creating parent dirs as needed). */
function write(rel: string, content: string, root: string): string {
        const full = join(root, rel);
        mkdirSync(join(full, ".."), { recursive: true });
        writeFileSync(full, content, "utf8");
        return full;
}

/** A mock WikiRunContext that records every callSubagent call. */
function mockContext(
        cwd: string,
        replies: string[],
): { ctx: WikiRunContext; calls: { task: string; opts: any }[] } {
        const calls: { task: string; opts: any }[] = [];
        let callIdx = 0;
        const ctx: WikiRunContext = {
                cwd,
                callSubagent: async (task: string, opts?: any) => {
                        calls.push({ task, opts });
                        const reply = replies[Math.min(callIdx, replies.length - 1)];
                        callIdx++;
                        return reply;
                },
        };
        return { ctx, calls };
}

/** A valid module-page reply from a (mocked) subagent. */
const VALID_MODULE_REPLY = JSON.stringify({
        title: "Auth Module",
        summary: "Handles user login, logout, and session management.",
        public_api: [
                {
                        name: "login",
                        signature: "function login(email: string, password: string): Promise<Session>",
                        file: "src/auth/login.ts",
                        line: 42,
                },
        ],
        key_files: [
                { path: "src/auth/login.ts", role: "Login flow" },
                { path: "src/auth/session.ts", role: "Session token management" },
        ],
        depends_on: ["src/utils"],
});

// ---------------------------------------------------------------------------
// discoverModules
// ---------------------------------------------------------------------------

describe("discoverModules", () => {
        test("identifies top-level directories as modules", () => {
                const repo = freshRepo("discover-toplevel");
                write("src/auth/login.ts", "export function login() {}\n", repo);
                write("src/db/connection.ts", "export function connect() {}\n", repo);
                write("src/utils/helpers.ts", "export function helper() {}\n", repo);
                const modules = discoverModules(repo);
                const rels = modules.map((m) => m.relativePath);
                expect(rels).toContain("src/auth");
                expect(rels).toContain("src/db");
                expect(rels).toContain("src/utils");
        });

        test("excludes node_modules, .git, dist, build, .unown", () => {
                const repo = freshRepo("discover-excludes");
                write("src/app.ts", "export const x = 1;\n", repo);
                write("node_modules/pkg/index.js", "module.exports = 1;\n", repo);
                write(".git/HEAD", "ref: refs/heads/main\n", repo);
                write("dist/bundle.js", "console.log('built');\n", repo);
                write("build/output.js", "console.log('built');\n", repo);
                write(".unown/config.json", "{}\n", repo);
                const modules = discoverModules(repo);
                const rels = modules.map((m) => m.relativePath);
                expect(rels).toContain("src");
                expect(rels).not.toContain("node_modules/pkg");
                expect(rels).not.toContain(".git");
                expect(rels).not.toContain("dist");
                expect(rels).not.toContain("build");
                expect(rels).not.toContain(".unown");
        });

        test("respects maxDepth", () => {
                const repo = freshRepo("discover-maxdepth");
                // Depth 1: src/ (no files at this level — just a dir).
                // Depth 2: src/auth/ (has files at depth 2 from root).
                // Depth 3: src/auth/internal/ (has files at depth 3).
                write("src/auth/login.ts", "export function login() {}\n", repo);
                write("src/auth/internal/token.ts", "export function token() {}\n", repo);
                // With maxDepth=2, the internal/ subdir is NOT walked.
                const modules = discoverModules(repo, { maxDepth: 2 });
                const rels = modules.map((m) => m.relativePath);
                expect(rels).toContain("src/auth");
                expect(rels).not.toContain("src/auth/internal");
                // With maxDepth=3, internal/ IS walked.
                const modules3 = discoverModules(repo, { maxDepth: 3 });
                const rels3 = modules3.map((m) => m.relativePath);
                expect(rels3).toContain("src/auth");
                expect(rels3).toContain("src/auth/internal");
        });

        test("handles empty repos gracefully", () => {
                const repo = freshRepo("discover-empty");
                const modules = discoverModules(repo);
                expect(modules).toEqual([]);
        });

        test("skips non-source files (config, markdown, assets)", () => {
                const repo = freshRepo("discover-nonsource");
                write("src/auth/login.ts", "export function login() {}\n", repo);
                write("src/auth/README.md", "# Auth\n", repo);
                write("src/auth/.eslintrc.json", "{}\n", repo);
                const modules = discoverModules(repo);
                const auth = modules.find((m) => m.relativePath === "src/auth");
                expect(auth).toBeDefined();
                // README.md and .eslintrc.json are filtered out — only the .ts file
                // is in the module's file list.
                expect(auth!.files).toEqual(["src/auth/login.ts"]);
        });

        test("respects custom exclude list", () => {
                const repo = freshRepo("discover-custom-exclude");
                write("src/auth/login.ts", "export function login() {}\n", repo);
                write("vendor/lib.ts", "export const x = 1;\n", repo);
                // Default excludes don't include 'vendor'.
                const modulesDefault = discoverModules(repo);
                expect(modulesDefault.map((m) => m.relativePath)).toContain("vendor");
                // Custom exclude 'vendor' removes it.
                const modules = discoverModules(repo, { exclude: ["vendor"] });
                expect(modules.map((m) => m.relativePath)).not.toContain("vendor");
                expect(modules.map((m) => m.relativePath)).toContain("src/auth");
        });

        test("returns ModuleInfo with slug + absolute + files", () => {
                const repo = freshRepo("discover-shape");
                write("src/auth/login.ts", "export function login() {}\n", repo);
                const modules = discoverModules(repo);
                const auth = modules[0];
                expect(auth.name).toBe("src--auth");
                expect(auth.displayName).toBe("auth");
                expect(auth.relativePath).toBe("src/auth");
                expect(auth.absolutePath).toBe(join(repo, "src", "auth"));
                expect(auth.files).toEqual(["src/auth/login.ts"]);
        });
});

// ---------------------------------------------------------------------------
// generateModulePage
// ---------------------------------------------------------------------------

describe("generateModulePage", () => {
        test("calls callSubagent with a prompt that mentions the module + files", async () => {
                const repo = freshRepo("modpage-prompt");
                write("src/auth/login.ts", "export function login() {}\n", repo);
                const module: ModuleInfo = {
                        name: "src--auth",
                        displayName: "auth",
                        relativePath: "src/auth",
                        absolutePath: join(repo, "src", "auth"),
                        files: ["src/auth/login.ts"],
                };
                const { ctx, calls } = mockContext(repo, [VALID_MODULE_REPLY]);
                await generateModulePage(module, ctx);
                expect(calls.length).toBe(1);
                expect(calls[0].task).toContain("src/auth");
                expect(calls[0].task).toContain("src/auth/login.ts");
                // The prompt asks for file:line citations.
                expect(calls[0].task.toLowerCase()).toContain("file:line");
                // The prompt asks for a JSON reply matching the schema.
                expect(calls[0].task).toContain("JSON");
                // outputSchema is passed so the subagent's reply is validated.
                expect(calls[0].opts.outputSchema).toBeDefined();
                // Read-only tools are pinned.
                expect(calls[0].opts.tools).toEqual(["read", "grep", "find", "ls"]);
        });

        test("parses the subagent's structured reply into a WikiPage", async () => {
                const repo = freshRepo("modpage-parse");
                const module: ModuleInfo = {
                        name: "src--auth",
                        displayName: "auth",
                        relativePath: "src/auth",
                        absolutePath: join(repo, "src", "auth"),
                        files: ["src/auth/login.ts"],
                };
                const { ctx } = mockContext(repo, [VALID_MODULE_REPLY]);
                const page = await generateModulePage(module, ctx);
                expect(page.path).toBe("modules/src--auth.md");
                expect(page.title).toBe("Auth Module");
                expect(page.summary).toContain("Handles user login");
                expect(page.publicApi).toBeDefined();
                expect(page.publicApi![0]).toEqual({
                        name: "login",
                        signature: "function login(email: string, password: string): Promise<Session>",
                        file: "src/auth/login.ts",
                        line: 42,
                });
                expect(page.keyFiles).toBeDefined();
                expect(page.keyFiles!.length).toBe(2);
                expect(page.dependsOn).toEqual(["src/utils"]);
                // The rendered markdown should cite file:line.
                expect(page.content).toContain("src/auth/login.ts:42");
        });

        test("handles subagent failure (returns error page)", async () => {
                const repo = freshRepo("modpage-failure");
                const module: ModuleInfo = {
                        name: "src--auth",
                        displayName: "auth",
                        relativePath: "src/auth",
                        absolutePath: join(repo, "src", "auth"),
                        files: ["src/auth/login.ts"],
                };
                // Subagent throws.
                const ctx: WikiRunContext = {
                        cwd: repo,
                        callSubagent: async () => {
                                throw new Error("subagent crashed");
                        },
                };
                const page = await generateModulePage(module, ctx);
                expect(page.path).toBe("modules/src--auth.md");
                expect(page.summary).toContain("wiki page generation failed");
                expect(page.summary).toContain("subagent call failed");
                expect(page.summary).toContain("subagent crashed");
                // The page is still written — with the module's files listed.
                expect(page.content).toContain("src/auth/login.ts");
        });

        test("handles non-JSON subagent reply (returns error page)", async () => {
                const repo = freshRepo("modpage-notjson");
                const module: ModuleInfo = {
                        name: "src--auth",
                        displayName: "auth",
                        relativePath: "src/auth",
                        absolutePath: join(repo, "src", "auth"),
                        files: ["src/auth/login.ts"],
                };
                const { ctx } = mockContext(repo, ["this is not JSON at all"]);
                const page = await generateModulePage(module, ctx);
                expect(page.summary).toContain("wiki page generation failed");
                expect(page.summary).toContain("did not return valid JSON");
        });

        test("handles schema-validation failure (returns error page)", async () => {
                const repo = freshRepo("modpage-schema-fail");
                const module: ModuleInfo = {
                        name: "src--auth",
                        displayName: "auth",
                        relativePath: "src/auth",
                        absolutePath: join(repo, "src", "auth"),
                        files: ["src/auth/login.ts"],
                };
                // Reply is valid JSON but missing required "title".
                const badReply = JSON.stringify({ summary: "no title" });
                const { ctx } = mockContext(repo, [badReply]);
                const page = await generateModulePage(module, ctx);
                expect(page.summary).toContain("wiki page generation failed");
                expect(page.summary).toContain("schema validation");
        });
});

// ---------------------------------------------------------------------------
// generateIndexPage
// ---------------------------------------------------------------------------

describe("generateIndexPage", () => {
        test("synthesizes an index linking all module pages", () => {
                const pages: WikiPage[] = [
                        {
                                path: "modules/src--auth.md",
                                title: "Auth",
                                summary: "Authentication module.",
                                content: "# Auth\n",
                        },
                        {
                                path: "modules/src--db.md",
                                title: "DB",
                                summary: "Database layer.",
                                content: "# DB\n",
                        },
                ];
                const projectInfo: ProjectInfo = {
                        name: "test-app",
                        description: null,
                        languages: [],
                        frameworks: [],
                        entryPoints: [],
                        dependencies: [],
                };
                const idx = generateIndexPage(pages, projectInfo);
                expect(idx.path).toBe("index.md");
                expect(idx.content).toContain("[Auth](./modules/src--auth.md)");
                expect(idx.content).toContain("[DB](./modules/src--db.md)");
                // Each module's summary appears in the index.
                expect(idx.content).toContain("Authentication module.");
                expect(idx.content).toContain("Database layer.");
                // Architecture + changes are linked too.
                expect(idx.content).toContain("architecture.md");
                expect(idx.content).toContain("changes.md");
        });

        test("includes project info (name, language, frameworks)", () => {
                const projectInfo: ProjectInfo = {
                        name: "demo-project",
                        description: "A test project.",
                        languages: ["TypeScript", "JavaScript"],
                        frameworks: ["Next.js", "React"],
                        entryPoints: ["src/index.ts"],
                        dependencies: ["react", "next", "typescript"],
                };
                const idx = generateIndexPage([], projectInfo);
                expect(idx.content).toContain("demo-project");
                expect(idx.content).toContain("TypeScript");
                expect(idx.content).toContain("Next.js");
                expect(idx.content).toContain("A test project.");
                expect(idx.content).toContain("src/index.ts");
                expect(idx.content).toContain("react");
        });

        test("handles empty pages (no modules discovered)", () => {
                const projectInfo: ProjectInfo = {
                        name: "empty",
                        description: null,
                        languages: [],
                        frameworks: [],
                        entryPoints: [],
                        dependencies: [],
                };
                const idx = generateIndexPage([], projectInfo);
                expect(idx.content).toContain("no modules discovered");
        });
});

// ---------------------------------------------------------------------------
// generateArchitecturePage
// ---------------------------------------------------------------------------

describe("generateArchitecturePage", () => {
        test("builds the dependency graph (DOT + markdown list)", () => {
                const pages: WikiPage[] = [
                        {
                                path: "modules/src--auth.md",
                                title: "Auth",
                                summary: "auth",
                                dependsOn: ["src/db"],
                                content: "",
                        },
                        {
                                path: "modules/src--db.md",
                                title: "DB",
                                summary: "db",
                                dependsOn: [],
                                content: "",
                        },
                ];
                const projectInfo: ProjectInfo = {
                        name: "demo",
                        description: null,
                        languages: [],
                        frameworks: [],
                        entryPoints: [],
                        dependencies: [],
                };
                const arch = generateArchitecturePage(pages, projectInfo);
                expect(arch.path).toBe("architecture.md");
                // DOT graph section.
                expect(arch.content).toContain("digraph Architecture");
                // Each module becomes a node label.
                expect(arch.content).toContain('label="Auth"');
                expect(arch.content).toContain('label="DB"');
                // Edge: Auth → DB.
                expect(arch.content).toContain("m_Auth -> m_DB");
                // Markdown list section.
                expect(arch.content).toContain("**Auth** → DB");
                expect(arch.content).toContain("**DB** — (no module-local dependencies)");
        });

        test("handles cycles (notes them in the page)", () => {
                // A → B → A is a cycle.
                const pages: WikiPage[] = [
                        {
                                path: "modules/a.md",
                                title: "A",
                                summary: "a",
                                dependsOn: ["b"],
                                content: "",
                        },
                        {
                                path: "modules/b.md",
                                title: "B",
                                summary: "b",
                                dependsOn: ["a"],
                                content: "",
                        },
                ];
                const arch = generateArchitecturePage(pages, {
                        name: "demo",
                        description: null,
                        languages: [],
                        frameworks: [],
                        entryPoints: [],
                        dependencies: [],
                });
                expect(arch.content).toContain("Cycles Detected");
                // The cycle is reported (A → B → A or B → A → B).
                expect(arch.content).toMatch(/(A → B → A|B → A → B)/);
        });

        test("handles modules with no dependencies (no cycle)", () => {
                const pages: WikiPage[] = [
                        {
                                path: "modules/a.md",
                                title: "A",
                                summary: "a",
                                dependsOn: [],
                                content: "",
                        },
                ];
                const arch = generateArchitecturePage(pages, {
                        name: "demo",
                        description: null,
                        languages: [],
                        frameworks: [],
                        entryPoints: [],
                        dependencies: [],
                });
                expect(arch.content).not.toContain("Cycles Detected");
        });
});

// ---------------------------------------------------------------------------
// writeWiki
// ---------------------------------------------------------------------------

describe("writeWiki", () => {
        test("writes pages atomically (tmp + rename — final file exists)", async () => {
                const dir = join(TMP_ROOT, "write-atomic");
                rmSync(dir, { recursive: true, force: true });
                const pages: WikiPage[] = [
                        {
                                path: "index.md",
                                title: "Index",
                                summary: "idx",
                                content: "# Index\n",
                        },
                        {
                                path: "modules/a.md",
                                title: "A",
                                summary: "a",
                                content: "# A\n",
                        },
                ];
                const manifest: WikiManifest = {
                        version: 1,
                        generatedAt: 1234567890,
                        pages: [
                                { path: "index.md", title: "Index", dependsOn: [] },
                                { path: "modules/a.md", title: "A", dependsOn: [] },
                        ],
                };
                await writeWiki(dir, pages, manifest, { force: true });
                expect(existsSync(join(dir, "index.md"))).toBe(true);
                expect(existsSync(join(dir, "modules", "a.md"))).toBe(true);
                // The content should match.
                expect(readFileSync(join(dir, "index.md"), "utf8")).toBe("# Index\n");
        });

        test("updates the manifest", async () => {
                const dir = join(TMP_ROOT, "write-manifest");
                rmSync(dir, { recursive: true, force: true });
                const pages: WikiPage[] = [];
                const manifest: WikiManifest = {
                        version: 1,
                        generatedAt: 9999999999999,
                        pages: [{ path: "index.md", title: "Index", dependsOn: ["a"] }],
                };
                await writeWiki(dir, pages, manifest, { force: true });
                expect(existsSync(join(dir, "wiki.json"))).toBe(true);
                const written = JSON.parse(readFileSync(join(dir, "wiki.json"), "utf8"));
                expect(written.version).toBe(1);
                expect(written.generatedAt).toBe(9999999999999);
                expect(written.pages).toEqual([{ path: "index.md", title: "Index", dependsOn: ["a"] }]);
        });

        test("refuses to overwrite an existing wiki without --force", async () => {
                const dir = join(TMP_ROOT, "write-refuse");
                rmSync(dir, { recursive: true, force: true });
                // First write succeeds.
                const manifest: WikiManifest = {
                        version: 1,
                        generatedAt: 1,
                        pages: [{ path: "index.md", title: "I", dependsOn: [] }],
                };
                await writeWiki(dir, [], manifest, { force: true });
                // Second write without force throws.
                await expect(writeWiki(dir, [], manifest, { force: false })).rejects.toThrow(/already exists/);
                // With force, it succeeds.
                await expect(writeWiki(dir, [], manifest, { force: true })).resolves.toBeUndefined();
        });
});

// ---------------------------------------------------------------------------
// generateWiki — top-level orchestrator
// ---------------------------------------------------------------------------

describe("generateWiki", () => {
        test("orchestrates the full flow: discover → generate modules in parallel → generate index + architecture → write", async () => {
                const repo = freshRepo("orch-full");
                write("src/auth/login.ts", "export function login() {}\n", repo);
                write("src/db/connection.ts", "export function connect() {}\n", repo);
                write("src/utils/helpers.ts", "export function helper() {}\n", repo);
                write("package.json", JSON.stringify({ name: "demo-app", description: "A demo.", main: "src/index.ts" }), repo);

                // Both module subagents get a valid structured reply.
                const replies = [VALID_MODULE_REPLY, VALID_MODULE_REPLY, VALID_MODULE_REPLY];
                const { ctx, calls } = mockContext(repo, replies);

                const wikiDir = join(TMP_ROOT, "orch-full-wiki");
                rmSync(wikiDir, { recursive: true, force: true });

                const result = await generateWiki(repo, wikiDir, ctx);

                // All 3 modules had a subagent spawned.
                expect(calls.length).toBe(3);

                // Pages: 1 index + 1 architecture + 1 changes + 3 module pages = 6.
                expect(result.pages.length).toBe(6);
                expect(result.manifest.version).toBe(1);
                expect(result.manifest.pages.length).toBe(6);

                // The wiki was written to disk.
                expect(existsSync(join(wikiDir, "index.md"))).toBe(true);
                expect(existsSync(join(wikiDir, "architecture.md"))).toBe(true);
                expect(existsSync(join(wikiDir, "changes.md"))).toBe(true);
                expect(existsSync(join(wikiDir, "wiki.json"))).toBe(true);
                expect(existsSync(join(wikiDir, "modules", "src--auth.md"))).toBe(true);

                // The manifest lists every page.
                const manifest = JSON.parse(readFileSync(join(wikiDir, "wiki.json"), "utf8"));
                expect(manifest.pages.length).toBe(6);

                // The index page links to all module pages.
                const indexContent = readFileSync(join(wikiDir, "index.md"), "utf8");
                expect(indexContent).toContain("demo-app");
                expect(indexContent).toContain("src--auth");
        });

        test("handles partial failures (some module pages fail but the rest are written)", async () => {
                const repo = freshRepo("orch-partial");
                write("src/auth/login.ts", "export function login() {}\n", repo);
                write("src/db/connection.ts", "export function connect() {}\n", repo);
                write("src/utils/helpers.ts", "export function helper() {}\n", repo);

                // Auth + utils succeed; db returns invalid JSON.
                const replies = [VALID_MODULE_REPLY, "not json", VALID_MODULE_REPLY];
                const { ctx } = mockContext(repo, replies);

                const wikiDir = join(TMP_ROOT, "orch-partial-wiki");
                rmSync(wikiDir, { recursive: true, force: true });

                const result = await generateWiki(repo, wikiDir, ctx);

                // All 3 module pages exist (the failed one is an error page).
                expect(existsSync(join(wikiDir, "modules", "src--auth.md"))).toBe(true);
                expect(existsSync(join(wikiDir, "modules", "src--db.md"))).toBe(true);
                expect(existsSync(join(wikiDir, "modules", "src--utils.md"))).toBe(true);

                // The error is reported in the result.
                expect(result.errors.length).toBe(1);
                expect(result.errors[0]).toContain("src/db");

                // The db page is an error page.
                const dbContent = readFileSync(join(wikiDir, "modules", "src--db.md"), "utf8");
                expect(dbContent).toContain("Wiki page generation failed");

                // The auth + utils pages are real.
                const authContent = readFileSync(join(wikiDir, "modules", "src--auth.md"), "utf8");
                expect(authContent).toContain("Auth Module");
        });
});

// ---------------------------------------------------------------------------
// searchWiki
// ---------------------------------------------------------------------------

describe("searchWiki", () => {
        test("returns ranked results by relevance", async () => {
                const wikiDir = join(TMP_ROOT, "search-ranked");
                rmSync(wikiDir, { recursive: true, force: true });
                mkdirSync(join(wikiDir, "modules"), { recursive: true });
                // File A: 1 occurrence.
                writeFileSync(
                        join(wikiDir, "modules", "a.md"),
                        "# Module A\n\nThis module handles authentication and login.\n",
                        "utf8",
                );
                // File B: 3 occurrences.
                writeFileSync(
                        join(wikiDir, "modules", "b.md"),
                        "# Module B\n\nauthentication authentication authentication.\n",
                        "utf8",
                );
                // File C: 0 occurrences — should NOT be in results.
                writeFileSync(
                        join(wikiDir, "modules", "c.md"),
                        "# Module C\n\nThis module is unrelated.\n",
                        "utf8",
                );

                const results = await searchWiki(wikiDir, "authentication");
                expect(results.length).toBe(2);
                // B should rank first (more occurrences).
                expect(results[0].page).toBe("modules/b.md");
                expect(results[0].matches).toBe(3);
                expect(results[1].page).toBe("modules/a.md");
                expect(results[1].matches).toBe(1);
                expect(results[1].snippet).toContain("authentication");
        });

        test("returns empty array for no matches", async () => {
                const wikiDir = join(TMP_ROOT, "search-nomatch");
                rmSync(wikiDir, { recursive: true, force: true });
                mkdirSync(join(wikiDir, "modules"), { recursive: true });
                writeFileSync(join(wikiDir, "modules", "a.md"), "# A\n\nUnrelated content.\n", "utf8");
                const results = await searchWiki(wikiDir, "nonexistent-term");
                expect(results).toEqual([]);
        });

        test("handles missing wiki dir gracefully", async () => {
                const results = await searchWiki(join(TMP_ROOT, "search-missing-xyz"), "anything");
                expect(results).toEqual([]);
        });

        test("handles empty query gracefully", async () => {
                const wikiDir = join(TMP_ROOT, "search-empty-q");
                rmSync(wikiDir, { recursive: true, force: true });
                mkdirSync(wikiDir, { recursive: true });
                writeFileSync(join(wikiDir, "a.md"), "# A\n\ncontent\n", "utf8");
                const results = await searchWiki(wikiDir, "");
                expect(results).toEqual([]);
        });
});

// ---------------------------------------------------------------------------
// runWikiCommand (CLI)
// ---------------------------------------------------------------------------

describe("runWikiCommand", () => {
        test("generate runs the full flow", async () => {
                const repo = freshRepo("cli-generate");
                write("src/auth/login.ts", "export function login() {}\n", repo);
                write("package.json", JSON.stringify({ name: "demo" }), repo);

                // The CLI spawns `unown --mode json` — in the sandbox this typically
                // fails (no live model). The wiki generator still discovers modules
                // and writes error pages for the failed subagent calls. We assert
                // the CLI:
                //   1. returned exit 0 (the orchestrator never throws on partial
                //      failures — they become error pages)
                //   2. wrote the wiki dir + manifest
                //   3. produced output mentioning the wiki path
                const cwd = process.cwd();
                process.chdir(repo);
                try {
                        const origStdout = process.stdout.write.bind(process.stdout);
                        const origStderr = process.stderr.write.bind(process.stderr);
                        let out = "";
                        let err = "";
                        process.stdout.write = ((chunk: any) => {
                                out += chunk.toString();
                                return true;
                        }) as any;
                        process.stderr.write = ((chunk: any) => {
                                err += chunk.toString();
                                return true;
                        }) as any;
                        try {
                                const code = await runWikiCommand(["generate", "--force"]);
                                expect(code).toBe(0);
                        } finally {
                                process.stdout.write = origStdout;
                                process.stderr.write = origStderr;
                        }
                        expect(out).toContain("Wiki written to");
                        const wikiDir = join(repo, ".unown", "wiki");
                        expect(existsSync(join(wikiDir, "index.md"))).toBe(true);
                        expect(existsSync(join(wikiDir, "wiki.json"))).toBe(true);
                        // The manifest exists + lists pages.
                        const manifest = JSON.parse(readFileSync(join(wikiDir, "wiki.json"), "utf8"));
                        expect(manifest.pages.length).toBeGreaterThan(0);
                } finally {
                        process.chdir(cwd);
                }
        });

        test("search <query> returns matching pages", async () => {
                const repo = freshRepo("cli-search");
                const wikiDir = join(repo, ".unown", "wiki");
                mkdirSync(join(wikiDir, "modules"), { recursive: true });
                writeFileSync(join(wikiDir, "modules", "auth.md"), "# Auth\n\nauthentication flow.\n", "utf8");
                writeFileSync(join(wikiDir, "index.md"), "# Index\n\nproject overview.\n", "utf8");
                writeFileSync(
                        join(wikiDir, "wiki.json"),
                        JSON.stringify({ version: 1, generatedAt: 1, pages: [] }),
                        "utf8",
                );
                const cwd = process.cwd();
                process.chdir(repo);
                try {
                        const origStdout = process.stdout.write.bind(process.stdout);
                        let out = "";
                        process.stdout.write = ((chunk: any) => {
                                out += chunk.toString();
                                return true;
                        }) as any;
                        try {
                                const code = await runWikiCommand(["search", "authentication"]);
                                expect(code).toBe(0);
                        } finally {
                                process.stdout.write = origStdout;
                        }
                        expect(out).toContain("Search results");
                        expect(out).toContain("modules/auth.md");
                        expect(out).toContain("authentication");
                } finally {
                        process.chdir(cwd);
                }
        });

        test("list lists all pages", async () => {
                const repo = freshRepo("cli-list");
                const wikiDir = join(repo, ".unown", "wiki");
                mkdirSync(wikiDir, { recursive: true });
                writeFileSync(join(wikiDir, "index.md"), "# Index\n", "utf8");
                writeFileSync(join(wikiDir, "architecture.md"), "# Architecture\n", "utf8");
                writeFileSync(
                        join(wikiDir, "wiki.json"),
                        JSON.stringify({
                                version: 1,
                                generatedAt: 1234567890,
                                pages: [
                                        { path: "index.md", title: "Index", dependsOn: [] },
                                        { path: "architecture.md", title: "Architecture", dependsOn: [] },
                                ],
                        }),
                        "utf8",
                );
                const cwd = process.cwd();
                process.chdir(repo);
                try {
                        const origStdout = process.stdout.write.bind(process.stdout);
                        let out = "";
                        process.stdout.write = ((chunk: any) => {
                                out += chunk.toString();
                                return true;
                        }) as any;
                        try {
                                const code = await runWikiCommand(["list"]);
                                expect(code).toBe(0);
                        } finally {
                                process.stdout.write = origStdout;
                        }
                        expect(out).toContain("index.md");
                        expect(out).toContain("architecture.md");
                        expect(out).toContain("2 page(s)");
                } finally {
                        process.chdir(cwd);
                }
        });

        test("show <page> prints the page", async () => {
                const repo = freshRepo("cli-show");
                const wikiDir = join(repo, ".unown", "wiki");
                mkdirSync(join(wikiDir, "modules"), { recursive: true });
                const pageContent = "# Auth Module\n\nThis module handles authentication.\n";
                writeFileSync(join(wikiDir, "modules", "auth.md"), pageContent, "utf8");
                const cwd = process.cwd();
                process.chdir(repo);
                try {
                        const origStdout = process.stdout.write.bind(process.stdout);
                        let out = "";
                        process.stdout.write = ((chunk: any) => {
                                out += chunk.toString();
                                return true;
                        }) as any;
                        try {
                                const code = await runWikiCommand(["show", "auth"]);
                                expect(code).toBe(0);
                        } finally {
                                process.stdout.write = origStdout;
                        }
                        expect(out).toContain("Auth Module");
                        expect(out).toContain("authentication");
                } finally {
                        process.chdir(cwd);
                }
        });

        test("show with a missing page exits nonzero", async () => {
                const repo = freshRepo("cli-show-missing");
                const wikiDir = join(repo, ".unown", "wiki");
                mkdirSync(wikiDir, { recursive: true });
                const cwd = process.cwd();
                process.chdir(repo);
                try {
                        const origStderr = process.stderr.write.bind(process.stderr);
                        let err = "";
                        process.stderr.write = ((chunk: any) => {
                                err += chunk.toString();
                                return true;
                        }) as any;
                        try {
                                const code = await runWikiCommand(["show", "does-not-exist"]);
                                expect(code).toBe(1);
                        } finally {
                                process.stderr.write = origStderr;
                        }
                        expect(err).toContain("not found");
                } finally {
                        process.chdir(cwd);
                }
        });

        test("unknown subcommand prints usage and exits nonzero", async () => {
                const repo = freshRepo("cli-unknown");
                const cwd = process.cwd();
                process.chdir(repo);
                try {
                        const origStderr = process.stderr.write.bind(process.stderr);
                        let err = "";
                        process.stderr.write = ((chunk: any) => {
                                err += chunk.toString();
                                return true;
                        }) as any;
                        try {
                                const code = await runWikiCommand(["bogus-subcommand"]);
                                expect(code).toBe(1);
                        } finally {
                                process.stderr.write = origStderr;
                        }
                        expect(err).toContain("unknown subcommand");
                } finally {
                        process.chdir(cwd);
                }
        });

        test("--help prints usage and exits 0", async () => {
                const cwd = process.cwd();
                process.chdir(freshRepo("cli-help"));
                try {
                        const origStdout = process.stdout.write.bind(process.stdout);
                        let out = "";
                        process.stdout.write = ((chunk: any) => {
                                out += chunk.toString();
                                return true;
                        }) as any;
                        try {
                                const code = await runWikiCommand(["--help"]);
                                expect(code).toBe(0);
                        } finally {
                                process.stdout.write = origStdout;
                        }
                        expect(out).toContain("Usage");
                        expect(out).toContain("unown wiki");
                } finally {
                        process.chdir(cwd);
                }
        });
});

// ---------------------------------------------------------------------------
// extractFinalAssistantText — the print-mode event-stream contract
// ---------------------------------------------------------------------------
// Same regression pin as recipes.test.ts: `unown wiki generate` parses the
// `--mode json` stream of its spawned subagent, which emits finalized
// assistant messages as `message_end` (agent-session.ts:1505) — the wiki
// extractor used to key on `message` and every generate resolved "".
import { extractFinalAssistantText } from "../src/wiki-cli.ts";

describe("wiki-cli extractFinalAssistantText (print-mode event stream)", () => {
        test("extracts the last assistant message_end text", () => {
                const stream = [
                        JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "module page draft" }] } }),
                        JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "final module page" }] } }),
                ].join("\n");
                expect(extractFinalAssistantText(stream)).toBe("final module page");
        });

        test("empty on a stream with no assistant message_end", () => {
                expect(extractFinalAssistantText(JSON.stringify({ type: "message", message: { role: "assistant", content: "old shape" } }))).toBe("");
        });
});

// ---------------------------------------------------------------------------
// mapLimit / wikiConcurrency — the bounded fan-out (OOM hardening)
// ---------------------------------------------------------------------------

describe("mapLimit", () => {
    test("runs every item exactly once, preserving order", async () => {
        const seen: number[] = [];
        const out = await mapLimit([10, 20, 30, 40], 2, async (n) => {
            seen.push(n);
            await new Promise((r) => setTimeout(r, n % 7));
            return n * 2;
        });
        expect(out).toEqual([20, 40, 60, 80]);
        expect(seen.sort((a, b) => a - b)).toEqual([10, 20, 30, 40]);
    });

    test("never exceeds the limit of concurrent fns", async () => {
        let live = 0;
        let peak = 0;
        await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
            live++;
            peak = Math.max(peak, live);
            await new Promise((r) => setTimeout(r, 10));
            live--;
            return n;
        });
        expect(peak).toBeLessThanOrEqual(3);
        expect(peak).toBeGreaterThan(1);
    });

    test("handles empty input", async () => {
        expect(await mapLimit([], 3, async (n) => n)).toEqual([]);
    });
});

describe("wikiConcurrency", () => {
    test("defaults to 3 and clamps to 1..8", () => {
        const orig = process.env.UNOWN_WIKI_CONCURRENCY;
        try {
            delete process.env.UNOWN_WIKI_CONCURRENCY;
            expect(wikiConcurrency()).toBe(3);
            process.env.UNOWN_WIKI_CONCURRENCY = "1";
            expect(wikiConcurrency()).toBe(1);
            process.env.UNOWN_WIKI_CONCURRENCY = "8";
            expect(wikiConcurrency()).toBe(8);
            process.env.UNOWN_WIKI_CONCURRENCY = "99";
            expect(wikiConcurrency()).toBe(3);
            process.env.UNOWN_WIKI_CONCURRENCY = "junk";
            expect(wikiConcurrency()).toBe(3);
        } finally {
            if (orig === undefined) delete process.env.UNOWN_WIKI_CONCURRENCY;
            else process.env.UNOWN_WIKI_CONCURRENCY = orig;
        }
    });
});
