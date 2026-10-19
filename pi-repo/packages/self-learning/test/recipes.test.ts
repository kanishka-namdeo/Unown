// recipes.test.ts — Milestone 4.1: declarative agent instruction bundles
// (the goose Recipes port).
//
// Covers the full surface contract of src/recipes.ts + src/recipes-cli.ts:
//   - parseRecipe: frontmatter + body, missing frontmatter, malformed YAML,
//     all frontmatter fields (snake_case + camelCase), templates, allowed_tools,
//     model + effort overrides
//   - interpolateRecipeBody: param substitution, missing params → "",
//     nested-object JSON.stringify, sub-recipe {{> name}} tokens preserved
//   - validateRecipeArgs: required fields, types, valid args, errors array
//   - loadRecipes: discovery from project + user dirs, project wins on collision,
//     missing dirs handled gracefully
//   - runRecipe: arg validation, body interpolation, subagent invocation,
//     response-schema validation (with retries), template instantiation,
//     allowedTools/model/effort pass-through, error paths
//   - runRecipesCommand: list / run / create / validate
//
// The subagent runner is mocked (no real pi spawn). Recipe discovery uses
// mkdtempSync fixture dirs. bun:test is the runner — zero new deps.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        interpolateRecipeBody,
        loadRecipes,
        parseRecipe,
        projectRecipesDir,
        runRecipe,
        type Recipe,
        type RecipeRunContext,
        userRecipesDir,
        validateRecipeArgs,
} from "../src/recipes.ts";
import { runRecipesCommand } from "../src/recipes-cli.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TMP_ROOT = mkdtempSync(join(tmpdir(), "unown-recipes-"));

afterAll(() => {
        try {
                rmSync(TMP_ROOT, { recursive: true, force: true });
        } catch {
                /* best effort */
        }
});

/** A fixture project dir for one test (mkdtemp under TMP_ROOT). */
function freshProject(name: string): string {
        const dir = join(TMP_ROOT, name);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        return dir;
}

/** A fixture user dir for one test (mkdtemp under TMP_ROOT). */
function freshUserDir(name: string): string {
        const dir = join(TMP_ROOT, "user-" + name);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        return dir;
}

const FULL_RECIPE_MD = `---
name: add-test-for
description: Generate a unit test for a given function
parameters:
  type: object
  properties:
    function:
      type: string
      description: The function name to test
    file:
      type: string
      description: The file containing the function
  required: [function, file]
sub_recipes:
  - name: find-related-tests
    description: Find existing tests for the same module
response_schema:
  type: object
  properties:
    test_file:
      type: string
    test_names:
      type: array
      items: { type: string }
  required: [test_file, test_names]
templates:
  - path: "test-{{function}}.test.ts"
    content: |
      import { {{function}} } from "./{{file}}";
      test("{{function}} works", () => {});
allowed_tools: [read, write, edit, bash, grep]
model: kimi-k2.5
effort: medium
---

# Add a test for \`{{function}}\` in \`{{file}}\`

Read the function \`{{function}}\` from \`{{file}}\`. Understand its behavior.
Generate a unit test that covers its main paths. Run \`bun test\` to verify.

Sub-tasks:
- {{> find-related-tests file={{file}} }}
`;

// ---------------------------------------------------------------------------
// parseRecipe
// ---------------------------------------------------------------------------

describe("parseRecipe", () => {
        test("parses YAML frontmatter + markdown body correctly", () => {
                const recipe = parseRecipe(FULL_RECIPE_MD, "project");
                expect(recipe).not.toBeNull();
                expect(recipe!.name).toBe("add-test-for");
                expect(recipe!.description).toBe("Generate a unit test for a given function");
                expect(recipe!.body).toContain("# Add a test for");
                expect(recipe!.body).toContain("{{function}}");
                expect(recipe!.body).toContain("{{> find-related-tests file={{file}} }}");
        });

        test("handles missing frontmatter (returns null)", () => {
                const noFrontmatter = "# Just a markdown file\n\nNo frontmatter here.";
                expect(parseRecipe(noFrontmatter, "user")).toBeNull();
        });

        test("handles malformed YAML (returns null)", () => {
                // Malformed YAML: the yaml parser will throw on this (unclosed bracket).
                const malformed = `---
name: broken
description: a recipe
parameters: { this is not valid yaml
---

# Body
`;
                expect(parseRecipe(malformed, "user")).toBeNull();
        });

        test("extracts all frontmatter fields (snake_case)", () => {
                const recipe = parseRecipe(FULL_RECIPE_MD, "project");
                expect(recipe).not.toBeNull();
                expect(recipe!.name).toBe("add-test-for");
                expect(recipe!.description).toBe("Generate a unit test for a given function");
                expect(recipe!.parameters).toBeDefined();
                expect(recipe!.subRecipes).toEqual([{ name: "find-related-tests", description: "Find existing tests for the same module" }]);
                expect(recipe!.responseSchema).toBeDefined();
                expect(recipe!.templates).toEqual([
                        {
                                path: "test-{{function}}.test.ts",
                                content: 'import { {{function}} } from "./{{file}}";\ntest("{{function}} works", () => {});\n',
                        },
                ]);
                expect(recipe!.allowedTools).toEqual(["read", "write", "edit", "bash", "grep"]);
                expect(recipe!.model).toBe("kimi-k2.5");
                expect(recipe!.effort).toBe("medium");
                expect(recipe!.source).toBe("project");
        });

        test("accepts camelCase frontmatter keys too", () => {
                const camelCase = `---
name: camel-recipe
description: A recipe using camelCase frontmatter
subRecipes:
  - name: sub-one
    description: First
responseSchema:
  type: object
  properties:
    result: { type: string }
allowedTools: [read, write]
model: gpt-4o
effort: high
---

# Body
`;
                const recipe = parseRecipe(camelCase, "user");
                expect(recipe).not.toBeNull();
                expect(recipe!.subRecipes).toEqual([{ name: "sub-one", description: "First" }]);
                expect(recipe!.responseSchema).toBeDefined();
                expect(recipe!.allowedTools).toEqual(["read", "write"]);
                expect(recipe!.model).toBe("gpt-4o");
                expect(recipe!.effort).toBe("high");
        });
});

// ---------------------------------------------------------------------------
// interpolateRecipeBody
// ---------------------------------------------------------------------------

describe("interpolateRecipeBody", () => {
        test("replaces {{param}} with provided values", () => {
                const recipe = parseRecipe(FULL_RECIPE_MD, "project")!;
                const out = interpolateRecipeBody(recipe, { function: "computeTotal", file: "src/cart.ts" });
                expect(out).toContain("# Add a test for `computeTotal` in `src/cart.ts`");
                expect(out).toContain("Read the function `computeTotal` from `src/cart.ts`");
                // Sub-recipe tokens are emitted verbatim into the body (the recipe
                // layer does NOT execute them; the agent invokes them via the task
                // tool). The `{{file}}` INSIDE the sub-recipe token is interpolated
                // (it's a normal {{param}}), but the `{{> ... }}` structure is left
                // intact for the agent to dispatch later.
                expect(out).toContain("{{> find-related-tests file=src/cart.ts }}");
                expect(out).not.toContain("{{function}}");
                expect(out).not.toContain("{{file}}");
        });

        test("leaves missing params as empty string", () => {
                const recipe = parseRecipe(FULL_RECIPE_MD, "project")!;
                const out = interpolateRecipeBody(recipe, { function: "foo" });
                // {{file}} was missing — should be replaced with empty string
                expect(out).toContain("`foo` in ``");
                expect(out).not.toContain("{{file}}");
                expect(out).not.toContain("{{function}}");
        });

        test("handles nested objects in args (JSON.stringify)", () => {
                const recipe: Recipe = {
                        name: "echo",
                        description: "echo",
                        body: "items = {{items}}\nuser = {{user.name}}",
                        source: "user",
                };
                const out = interpolateRecipeBody(recipe, {
                        items: [{ id: 1 }, { id: 2 }],
                        user: { name: "alice" },
                });
                expect(out).toContain('items = [{"id":1},{"id":2}]');
                expect(out).toContain("user = alice");
        });

        test("handles arrays via bracket index", () => {
                const recipe: Recipe = {
                        name: "indexed",
                        description: "indexed",
                        body: "first = {{items[0]}}",
                        source: "user",
                };
                const out = interpolateRecipeBody(recipe, { items: ["a", "b", "c"] });
                expect(out).toContain("first = a");
        });

        test("never throws on weird args", () => {
                const recipe: Recipe = {
                        name: "weird",
                        description: "weird",
                        body: "value = {{nonexistent.deeply.nested.path}}",
                        source: "user",
                };
                expect(() => interpolateRecipeBody(recipe, {})).not.toThrow();
                expect(interpolateRecipeBody(recipe, {})).toContain("value = ");
        });
});

// ---------------------------------------------------------------------------
// validateRecipeArgs
// ---------------------------------------------------------------------------

describe("validateRecipeArgs", () => {
        test("validates required fields", () => {
                const recipe = parseRecipe(FULL_RECIPE_MD, "project")!;
                const result = validateRecipeArgs(recipe, { function: "foo" });
                expect(result.ok).toBe(false);
                expect(result.errors.length).toBeGreaterThan(0);
                expect(result.errors.some((e) => e.includes("file"))).toBe(true);
        });

        test("validates types (string, number, boolean)", () => {
                const recipe: Recipe = {
                        name: "types",
                        description: "types",
                        parameters: {
                                type: "object",
                                properties: {
                                        name: { type: "string" },
                                        count: { type: "number" },
                                        flag: { type: "boolean" },
                                },
                                required: ["name", "count", "flag"],
                        },
                        body: "",
                        source: "user",
                };
                const ok = validateRecipeArgs(recipe, { name: "x", count: 5, flag: true });
                expect(ok.ok).toBe(true);
                const bad = validateRecipeArgs(recipe, { name: 42, count: "five", flag: "yes" });
                expect(bad.ok).toBe(false);
                expect(bad.errors.some((e) => e.includes("name"))).toBe(true);
                expect(bad.errors.some((e) => e.includes("count"))).toBe(true);
                expect(bad.errors.some((e) => e.includes("flag"))).toBe(true);
        });

        test("returns ok when args satisfy schema", () => {
                const recipe = parseRecipe(FULL_RECIPE_MD, "project")!;
                const result = validateRecipeArgs(recipe, { function: "computeTotal", file: "src/cart.ts" });
                expect(result.ok).toBe(true);
                expect(result.errors).toEqual([]);
        });

        test("returns ok when no parameters schema is declared", () => {
                const recipe: Recipe = { name: "n", description: "d", body: "", source: "user" };
                const result = validateRecipeArgs(recipe, { anything: "goes" });
                expect(result.ok).toBe(true);
        });

        test("returns errors array when args are invalid", () => {
                const recipe = parseRecipe(FULL_RECIPE_MD, "project")!;
                const result = validateRecipeArgs(recipe, {});
                expect(result.ok).toBe(false);
                expect(Array.isArray(result.errors)).toBe(true);
                expect(result.errors.length).toBeGreaterThanOrEqual(2);
        });
});

// ---------------------------------------------------------------------------
// loadRecipes
// ---------------------------------------------------------------------------

describe("loadRecipes", () => {
        test("discovers recipes from .unown/recipes/*.md", () => {
                const proj = freshProject("load-project");
                mkdirSync(join(proj, ".unown", "recipes"), { recursive: true });
                writeFileSync(
                        join(proj, ".unown", "recipes", "say-hi.md"),
                        `---
name: say-hi
description: Print a greeting
---

# Body
`,
                );
                const { recipes, sources } = loadRecipes(proj, freshUserDir("empty-load-project"));
                expect(recipes.map((r) => r.name)).toContain("say-hi");
                expect(sources.project.length).toBe(1);
                expect(sources.user.length).toBe(0);
        });

        test("discovers recipes from $UNOWN_HOME/recipes/*.md", () => {
                const proj = freshProject("load-user");
                const userDir = freshUserDir("with-recipes");
                mkdirSync(join(userDir, "recipes"), { recursive: true });
                writeFileSync(
                        join(userDir, "recipes", "global-recipe.md"),
                        `---
name: global-recipe
description: A user-scoped recipe
---

# Body
`,
                );
                const { recipes, sources } = loadRecipes(proj, userDir);
                expect(recipes.map((r) => r.name)).toContain("global-recipe");
                expect(sources.user.length).toBe(1);
                expect(sources.project.length).toBe(0);
        });

        test("project wins on name collision", () => {
                const proj = freshProject("collision");
                const userDir = freshUserDir("collision");
                mkdirSync(join(proj, ".unown", "recipes"), { recursive: true });
                mkdirSync(join(userDir, "recipes"), { recursive: true });
                writeFileSync(
                        join(userDir, "recipes", "shared.md"),
                        `---
name: shared
description: user-scoped version
---

# user body
`,
                );
                writeFileSync(
                        join(proj, ".unown", "recipes", "shared.md"),
                        `---
name: shared
description: project-scoped version
---

# project body
`,
                );
                const { recipes } = loadRecipes(proj, userDir);
                const shared = recipes.find((r) => r.name === "shared");
                expect(shared).toBeDefined();
                expect(shared!.source).toBe("project");
                expect(shared!.description).toBe("project-scoped version");
        });

        test("handles missing dirs gracefully", () => {
                const proj = freshProject("missing-dirs");
                const userDir = freshUserDir("missing-dirs");
                // No recipes dirs created.
                const { recipes, sources } = loadRecipes(proj, userDir);
                expect(recipes).toEqual([]);
                expect(sources.project).toEqual([]);
                expect(sources.user).toEqual([]);
        });

        test("skips malformed recipe files (does not crash on a bad file)", () => {
                const proj = freshProject("mixed");
                mkdirSync(join(proj, ".unown", "recipes"), { recursive: true });
                writeFileSync(
                        join(proj, ".unown", "recipes", "good.md"),
                        `---
name: good
description: A good recipe
---

# Body
`,
                );
                writeFileSync(join(proj, ".unown", "recipes", "bad.md"), "not valid yaml frontmatter");
                const { recipes } = loadRecipes(proj, freshUserDir("mixed"));
                expect(recipes.map((r) => r.name)).toContain("good");
                expect(recipes.map((r) => r.name)).not.toContain("bad");
        });

        test("also discovers .yaml and .yml files", () => {
                const proj = freshProject("yaml-ext");
                mkdirSync(join(proj, ".unown", "recipes"), { recursive: true });
                writeFileSync(
                        join(proj, ".unown", "recipes", "yml-recipe.yml"),
                        `---
name: yml-recipe
description: A yml-ext recipe
---

# Body
`,
                );
                writeFileSync(
                        join(proj, ".unown", "recipes", "yaml-recipe.yaml"),
                        `---
name: yaml-recipe
description: A yaml-ext recipe
---

# Body
`,
                );
                const { recipes } = loadRecipes(proj, freshUserDir("yaml-ext"));
                expect(recipes.map((r) => r.name)).toContain("yml-recipe");
                expect(recipes.map((r) => r.name)).toContain("yaml-recipe");
        });
});

// ---------------------------------------------------------------------------
// runRecipe
// ---------------------------------------------------------------------------

/** Build a RecipeRunContext whose callSubagent is fully controllable. Tracks
 *  every call so tests can assert what was passed (model, effort, tools,
 *  outputSchema) and what task text was sent. */
function mockContext(cwd: string, replies: string[]): { ctx: RecipeRunContext; calls: { task: string; opts: any }[] } {
        const calls: { task: string; opts: any }[] = [];
        let callIdx = 0;
        const ctx: RecipeRunContext = {
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

describe("runRecipe", () => {
        test("validates args before spawning subagent", async () => {
                const proj = freshProject("run-validate-args");
                const recipe = parseRecipe(FULL_RECIPE_MD, "project")!;
                const { ctx, calls } = mockContext(proj, ["should not be called"]);
                const result = await runRecipe(recipe, { function: "foo" /* missing file */ }, ctx);
                expect(result.success).toBe(false);
                expect(result.error).toContain("parameter validation failed");
                expect(calls.length).toBe(0);
        });

        test("interpolates body and passes to callSubagent", async () => {
                const proj = freshProject("run-interpolate");
                // Use a recipe WITHOUT a response_schema so the "done" reply is
                // accepted verbatim — this test is about body interpolation, not
                // response validation.
                const recipe: Recipe = {
                        name: "interpolate-test",
                        description: "test interpolation",
                        body: FULL_RECIPE_MD.split("---\n")[2],
                        source: "user",
                };
                const { ctx, calls } = mockContext(proj, ["done"]);
                const result = await runRecipe(recipe, { function: "computeTotal", file: "src/cart.ts" }, ctx);
                expect(result.success).toBe(true);
                expect(calls.length).toBe(1);
                expect(calls[0].task).toContain("# Add a test for `computeTotal` in `src/cart.ts`");
                expect(calls[0].task).toContain("Read the function `computeTotal` from `src/cart.ts`");
                // The body should NOT still contain {{function}} after interpolation.
                expect(calls[0].task).not.toContain("{{function}}");
                expect(calls[0].task).not.toContain("{{file}}");
                // Sub-recipe token structure preserved.
                expect(calls[0].task).toContain("{{> find-related-tests file=src/cart.ts }}");
        });

        test("validates subagent reply against responseSchema (with retry)", async () => {
                const proj = freshProject("run-validate-reply");
                const recipe = parseRecipe(FULL_RECIPE_MD, "project")!;
                // First reply: valid JSON matching the response_schema.
                const validReply = JSON.stringify({
                        test_file: "src/cart.test.ts",
                        test_names: ["compute total of empty cart", "compute total with items"],
                });
                const { ctx, calls } = mockContext(proj, [validReply]);
                const result = await runRecipe(recipe, { function: "computeTotal", file: "src/cart.ts" }, ctx);
                expect(result.success).toBe(true);
                expect(result.structuredOutput).toEqual(JSON.parse(validReply));
                // Should only have called the subagent ONCE (no retry needed).
                expect(calls.length).toBe(1);
        });

        test("retries on invalid reply, then succeeds", async () => {
                const proj = freshProject("run-retry-then-succeed");
                const recipe = parseRecipe(FULL_RECIPE_MD, "project")!;
                // First reply: invalid (missing required field test_file).
                const invalidReply = JSON.stringify({ test_names: ["x"] });
                // Second reply: valid.
                const validReply = JSON.stringify({ test_file: "x.test.ts", test_names: ["a"] });
                const { ctx, calls } = mockContext(proj, [invalidReply, validReply]);
                const result = await runRecipe(recipe, { function: "f", file: "f.ts" }, ctx);
                expect(result.success).toBe(true);
                expect(result.structuredOutput).toEqual(JSON.parse(validReply));
                expect(calls.length).toBe(2);
                // The retry task should contain the schema + the defect quoted back.
                expect(calls[1].task).toContain("STRUCTURED OUTPUT REQUIRED");
        });

        test("instantiates templates (writes files)", async () => {
                const proj = freshProject("run-templates");
                // A simple recipe WITHOUT a response_schema so the "done" reply is
                // accepted — this test is about template instantiation, not
                // response validation.
                const recipe: Recipe = {
                        name: "tpl-test",
                        description: "test templates",
                        parameters: {
                                type: "object",
                                properties: {
                                        function: { type: "string" },
                                        file: { type: "string" },
                                },
                                required: ["function", "file"],
                        },
                        templates: [
                                {
                                        path: "test-{{function}}.test.ts",
                                        content: 'import { {{function}} } from "./{{file}}";\ntest("{{function}} works", () => {});\n',
                                },
                        ],
                        body: "# Body\nCreate a test for {{function}}.",
                        source: "user",
                };
                const { ctx } = mockContext(proj, ["done"]);
                const result = await runRecipe(recipe, { function: "foo", file: "lib.ts" }, ctx);
                expect(result.success).toBe(true);
                expect(result.templateFiles).toEqual(["test-foo.test.ts"]);
                const expectedPath = join(proj, "test-foo.test.ts");
                expect(existsSync(expectedPath)).toBe(true);
                const content = readFileSync(expectedPath, "utf8");
                expect(content).toContain('import { foo } from "./lib.ts"');
                expect(content).toContain('test("foo works"');
        });

        test("returns structured output when responseSchema is satisfied", async () => {
                const proj = freshProject("run-structured");
                const recipe = parseRecipe(FULL_RECIPE_MD, "project")!;
                const reply = JSON.stringify({ test_file: "x.ts", test_names: ["a", "b"] });
                const { ctx } = mockContext(proj, [reply]);
                const result = await runRecipe(recipe, { function: "f", file: "f.ts" }, ctx);
                expect(result.success).toBe(true);
                expect(result.structuredOutput).toEqual({ test_file: "x.ts", test_names: ["a", "b"] });
        });

        test("returns error when responseSchema validation fails after retries", async () => {
                const proj = freshProject("run-fail-after-retries");
                const recipe = parseRecipe(FULL_RECIPE_MD, "project")!;
                // Always returns invalid JSON.
                const { ctx, calls } = mockContext(proj, ["not json at all", "still not json", "nope"]);
                const result = await runRecipe(recipe, { function: "f", file: "f.ts" }, ctx);
                expect(result.success).toBe(false);
                // The error mentions either the JSON-extraction failure or the
                // schema-validation failure — both are response-validation
                // failures from the recipe's perspective.
                expect(result.error).toMatch(/response (schema validation failed|was not valid JSON)/);
                expect(result.error).toContain("3 attempt");
                // 1 original + 2 retries = 3 calls.
                expect(calls.length).toBe(3);
        });

        test("respects allowedTools (passes to callSubagent)", async () => {
                const proj = freshProject("run-tools");
                const recipe = parseRecipe(FULL_RECIPE_MD, "project")!;
                const { ctx, calls } = mockContext(proj, ["done"]);
                await runRecipe(recipe, { function: "f", file: "f.ts" }, ctx);
                expect(calls[0].opts.tools).toEqual(["read", "write", "edit", "bash", "grep"]);
        });

        test("respects model + effort overrides", async () => {
                const proj = freshProject("run-model-effort");
                const recipe = parseRecipe(FULL_RECIPE_MD, "project")!;
                const { ctx, calls } = mockContext(proj, ["done"]);
                await runRecipe(recipe, { function: "f", file: "f.ts" }, ctx);
                expect(calls[0].opts.model).toBe("kimi-k2.5");
                expect(calls[0].opts.effort).toBe("medium");
        });

        test("without responseSchema, returns subagent reply verbatim", async () => {
                const proj = freshProject("run-no-schema");
                const recipe: Recipe = {
                        name: "no-schema",
                        description: "no schema",
                        body: "Hello {{name}}",
                        source: "user",
                };
                const { ctx, calls } = mockContext(proj, ["The agent's reply text."]);
                const result = await runRecipe(recipe, { name: "world" }, ctx);
                expect(result.success).toBe(true);
                expect(result.output).toBe("The agent's reply text.");
                expect(result.structuredOutput).toBeUndefined();
                expect(calls[0].task).toBe("Hello world");
                expect(calls[0].opts.outputSchema).toBeUndefined();
        });

        test("template instantiation errors are reported but do not fail the run", async () => {
                const proj = freshProject("run-template-error");
                const recipe: Recipe = {
                        name: "tpl-err",
                        description: "tpl error",
                        body: "Body",
                        templates: [{ path: "/nonexistent/deep/path/{{name}}.txt", content: "hi {{name}}" }],
                        source: "user",
                };
                // The path is absolute and starts with /nonexistent — atomicWriteFileSync
                // creates the parent dir with mkdirSync recursive, so this MIGHT succeed
                // depending on permissions. To force an error, use an UNINTERPOLATABLE path
                // (missing param) so the path resolves to "" — but the code already skips
                // empty paths. So instead, test the case where the path resolves but the
                // write fails because the file would be a directory.
                const recipeWithDirConflict: Recipe = {
                        name: "tpl-dir-conflict",
                        description: "dir conflict",
                        body: "Body",
                        templates: [
                                { path: "conflict", content: "first" },
                                { path: "conflict/nested.txt", content: "second" },
                        ],
                        source: "user",
                };
                // First write creates a FILE named "conflict"; the second tries to
                // mkdir "conflict/" as a directory — writeFileSync will fail because
                // "conflict" already exists as a non-directory.
                const { ctx } = mockContext(proj, ["ok"]);
                const result = await runRecipe(recipeWithDirConflict, {}, ctx);
                // The run itself succeeds — only the second template's write fails.
                expect(result.success).toBe(true);
                expect(result.error).toContain("template errors");
        });
});

// ---------------------------------------------------------------------------
// runRecipesCommand (CLI)
// ---------------------------------------------------------------------------

describe("runRecipesCommand", () => {
        test("list prints all recipes", async () => {
                const proj = freshProject("cli-list");
                mkdirSync(join(proj, ".unown", "recipes"), { recursive: true });
                writeFileSync(
                        join(proj, ".unown", "recipes", "a.md"),
                        `---
name: recipe-a
description: First recipe
---

# A
`,
                );
                writeFileSync(
                        join(proj, ".unown", "recipes", "b.md"),
                        `---
name: recipe-b
description: Second recipe
---

# B
`,
                );
                const cwd = process.cwd();
                process.chdir(proj);
                try {
                        const origStdout = process.stdout.write.bind(process.stdout);
                        let captured = "";
                        process.stdout.write = ((chunk: any) => {
                                captured += chunk.toString();
                                return true;
                        }) as any;
                        try {
                                const code = await runRecipesCommand(["list"]);
                                expect(code).toBe(0);
                        } finally {
                                process.stdout.write = origStdout;
                        }
                        expect(captured).toContain("recipe-a");
                        expect(captured).toContain("recipe-b");
                        expect(captured).toContain("First recipe");
                        expect(captured).toContain("Second recipe");
                } finally {
                        process.chdir(cwd);
                }
        });

        test("run <name> --param value runs the recipe", async () => {
                const proj = freshProject("cli-run");
                mkdirSync(join(proj, ".unown", "recipes"), { recursive: true });
                writeFileSync(
                        join(proj, ".unown", "recipes", "echo.md"),
                        `---
name: echo
description: Echo a value
parameters:
  type: object
  properties:
    message:
      type: string
  required: [message]
---

# Echo {{message}}
`,
                );
                // The CLI's callSubagent spawns `unown --mode json` — in the test
                // sandbox this typically fails (the spawn produces no usable
                // assistant text). The recipe layer still validates args +
                // interpolates the body + attempts the spawn. We assert that
                // the CLI:
                //   1. found the recipe (no "no recipe named" error in stderr)
                //   2. validated args (no "parameter validation failed" error)
                //   3. dispatched (either stdout or stderr produced output)
                const cwd = process.cwd();
                process.chdir(proj);
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
                                await runRecipesCommand(["run", "echo", "--message", "hello"]);
                        } finally {
                                process.stdout.write = origStdout;
                                process.stderr.write = origStderr;
                        }
                        // The recipe WAS found + args WERE validated — neither
                        // of these error messages should appear in stderr.
                        expect(err).not.toContain("no recipe named");
                        expect(err).not.toContain("parameter validation failed");
                        // Something was produced — either a real reply (stdout)
                        // or a failure surface. The CLI dispatched correctly.
                        expect(out.length + err.length).toBeGreaterThan(0);
                } finally {
                        process.chdir(cwd);
                }
        });

        test("create <name> scaffolds a new recipe", async () => {
                const proj = freshProject("cli-create");
                const cwd = process.cwd();
                process.chdir(proj);
                try {
                        const origStdout = process.stdout.write.bind(process.stdout);
                        let out = "";
                        process.stdout.write = ((chunk: any) => {
                                out += chunk.toString();
                                return true;
                        }) as any;
                        try {
                                const code = await runRecipesCommand(["create", "my-new-recipe"]);
                                expect(code).toBe(0);
                        } finally {
                                process.stdout.write = origStdout;
                        }
                        const expectedPath = join(proj, ".unown", "recipes", "my-new-recipe.md");
                        expect(existsSync(expectedPath)).toBe(true);
                        const content = readFileSync(expectedPath, "utf8");
                        expect(content).toContain("name: my-new-recipe");
                        expect(content).toContain("description:");
                        expect(content).toContain("parameters:");
                        expect(content).toContain("# my-new-recipe");
                        expect(out).toContain("Created recipe");
                } finally {
                        process.chdir(cwd);
                }
        });

        test("validate <file> validates a recipe file", async () => {
                const proj = freshProject("cli-validate");
                mkdirSync(join(proj, ".unown", "recipes"), { recursive: true });
                const filePath = join(proj, ".unown", "recipes", "valid.md");
                writeFileSync(filePath, FULL_RECIPE_MD);
                const cwd = process.cwd();
                process.chdir(proj);
                try {
                        const origStdout = process.stdout.write.bind(process.stdout);
                        let out = "";
                        process.stdout.write = ((chunk: any) => {
                                out += chunk.toString();
                                return true;
                        }) as any;
                        try {
                                const code = await runRecipesCommand(["validate", filePath]);
                                expect(code).toBe(0);
                        } finally {
                                process.stdout.write = origStdout;
                        }
                        expect(out).toContain("Valid recipe");
                        expect(out).toContain("add-test-for");
                        expect(out).toContain("parameters: yes");
                        expect(out).toContain("response_schema: yes");
                        expect(out).toContain("allowed_tools: read, write, edit, bash, grep");
                        expect(out).toContain("model: kimi-k2.5");
                } finally {
                        process.chdir(cwd);
                }
        });

        test("validate returns nonzero on a malformed recipe", async () => {
                const proj = freshProject("cli-validate-bad");
                const filePath = join(proj, "bad.md");
                writeFileSync(filePath, "# no frontmatter\n\njust a body");
                const cwd = process.cwd();
                process.chdir(proj);
                try {
                        const origStderr = process.stderr.write.bind(process.stderr);
                        let err = "";
                        process.stderr.write = ((chunk: any) => {
                                err += chunk.toString();
                                return true;
                        }) as any;
                        try {
                                const code = await runRecipesCommand(["validate", filePath]);
                                expect(code).toBe(1);
                        } finally {
                                process.stderr.write = origStderr;
                        }
                        expect(err).toContain("Not a valid recipe");
                } finally {
                        process.chdir(cwd);
                }
        });

        test("list with no recipes prints a helpful message", async () => {
                const proj = freshProject("cli-list-empty");
                const cwd = process.cwd();
                process.chdir(proj);
                try {
                        const origStdout = process.stdout.write.bind(process.stdout);
                        let out = "";
                        process.stdout.write = ((chunk: any) => {
                                out += chunk.toString();
                                return true;
                        }) as any;
                        try {
                                const code = await runRecipesCommand(["list"]);
                                expect(code).toBe(0);
                        } finally {
                                process.stdout.write = origStdout;
                        }
                        expect(out).toContain("No recipes found");
                } finally {
                        process.chdir(cwd);
                }
        });

        test("unknown subcommand prints usage and exits nonzero", async () => {
                const proj = freshProject("cli-unknown");
                const cwd = process.cwd();
                process.chdir(proj);
                try {
                        const origStderr = process.stderr.write.bind(process.stderr);
                        let err = "";
                        process.stderr.write = ((chunk: any) => {
                                err += chunk.toString();
                                return true;
                        }) as any;
                        try {
                                const code = await runRecipesCommand(["bogus"]);
                                expect(code).toBe(1);
                        } finally {
                                process.stderr.write = origStderr;
                        }
                        expect(err).toContain("unknown subcommand");
                        expect(err).toContain("Usage");
                } finally {
                        process.chdir(cwd);
                }
        });
});

// ---------------------------------------------------------------------------
// Exported path helpers
// ---------------------------------------------------------------------------

describe("path helpers", () => {
        test("projectRecipesDir returns <cwd>/.unown/recipes", () => {
                expect(projectRecipesDir("/foo/bar")).toBe(join("/foo/bar", ".unown", "recipes"));
        });

        test("userRecipesDir returns <agentDir>/recipes", () => {
                expect(userRecipesDir("/home/user/.unown")).toBe(join("/home/user/.unown", "recipes"));
        });
});

// ---------------------------------------------------------------------------
// extractFinalAssistantText — the print-mode event-stream contract
// ---------------------------------------------------------------------------
// Regression pin for the recipes/wiki bug: print mode emits finalized
// assistant messages as `message_end` events (agent-session.ts:1505 — the
// same contract the task tool's collector keys on in tools.ts), NOT `message`
// events. The CLI extractor used to key on the wrong type and every
// `unown recipes run` resolved an empty string.
import { extractFinalAssistantText } from "../src/recipes-cli.ts";

describe("recipes-cli extractFinalAssistantText (print-mode event stream)", () => {
        const stream = [
                JSON.stringify({ type: "session_start", cwd: "/tmp/x" }),
                JSON.stringify({ type: "message_start", message: { role: "assistant" } }),
                JSON.stringify({
                        type: "message_end",
                        message: {
                                role: "assistant",
                                content: [{ type: "text", text: "first turn: exploring the repo" }],
                                usage: { input: 100, output: 20 },
                        },
                }),
                JSON.stringify({ type: "message_end", message: { role: "user", content: "next prompt" } }),
                JSON.stringify({
                        type: "message_end",
                        message: {
                                role: "assistant",
                                content: [{ type: "text", text: "recipe output: all steps done" }],
                        },
                }),
        ].join("\n");

        test("extracts the LAST assistant message_end text (the subagent reply)", () => {
                expect(extractFinalAssistantText(stream)).toBe("recipe output: all steps done");
        });

        test("handles a string content field (content-array and string both occur upstream)", () => {
                const s = [JSON.stringify({ type: "message_end", message: { role: "assistant", content: "plain reply" } })].join("\n");
                expect(extractFinalAssistantText(s)).toBe("plain reply");
        });

        test("empty string when the stream has no assistant message_end (the old failure shape)", () => {
                const oldShape = [JSON.stringify({ type: "message", message: { role: "assistant", content: "old-type reply" } })].join("\n");
                expect(extractFinalAssistantText(oldShape)).toBe("");
        });

        test("non-JSON lines are skipped, not fatal", () => {
                expect(extractFinalAssistantText("noise\n" + stream)).toBe("recipe output: all steps done");
        });
});
