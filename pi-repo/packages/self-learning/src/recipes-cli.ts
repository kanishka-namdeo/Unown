/**
 * recipes-cli.ts — `unown recipes <sub>` (Milestone 4.1).
 *
 * Subcommands:
 *   unown recipes list                                   print all available recipes
 *   unown recipes run <name> [--param value]...          run a recipe with the given args
 *   unown recipes create <name>                          scaffold a new recipe file with template frontmatter
 *   unown recipes validate <file>                        validate a recipe file's schema (without running it)
 *
 * Pattern matches `sessions-cli.ts` / `automations-cli.ts`: returns an exit
 * code, writes to stdout/stderr directly, no pi imports. The `run` subcommand
 * uses a Node-side `callSubagent` that spawns `unown --mode json` (the same
 * shape the `task` tool uses), so the recipe layer stays pure in `recipes.ts`.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { loadRecipes, parseRecipe, projectRecipesDir, runRecipe, userRecipesDir } from "./recipes.ts";
import { isBunVirtualScriptPath, resolveUnownCliScript } from "./tools.ts";

export interface CliResult {
        stdout?: string;
        stderr?: string;
        exitCode: number;
}

export const RECIPES_USAGE = `unown recipes — declarative agent instruction bundles (Milestone 4.1)

Usage:
  unown recipes list
  unown recipes run <name> [--param value]... [--user-dir <path>]
  unown recipes create <name> [--project | --user] [--path <path>]
  unown recipes validate <file>

Recipes are markdown files with YAML frontmatter, discovered from:
  - project: <cwd>/.unown/recipes/*.md
  - user:    $UNOWN_HOME/recipes/*.md   (UNOWN_HOME-respecting; default ~/.unown/recipes)

Project recipes win on name collision. Frontmatter keys may use snake_case
or camelCase (sub_recipes/subRecipes, response_schema/responseSchema,
allowed_tools/allowedTools).

The run subcommand spawns a real unown subagent (unown --mode json); pass
--param value pairs to fill the recipe's declared parameters.

Docs: docs/recipes.md.`;

function flagValue(argv: string[], name: string): string | undefined {
        const i = argv.indexOf(name);
        return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function hasFlag(argv: string[], name: string): boolean {
        return argv.includes(name);
}

/** Parse `--key value` pairs into a record. Keys are normalized to kebab-free
 *  — `--function-name foo` becomes `functionName` (lowerCamelCase). This is
 *  the same shape `interpolateRecipeBody` and `validateRecipeArgs` consume.
 *  Bare `--flag` (no value) becomes `true`. */
function parseRecipeArgs(argv: string[]): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (let i = 0; i < argv.length; i++) {
                const a = argv[i];
                if (!a.startsWith("--")) continue;
                // Reserved flags that are NOT recipe params.
                if (a === "--user-dir") {
                        i++; // skip its value
                        continue;
                }
                const key = normalizeKey(a.replace(/^--/, ""));
                const val = argv[i + 1];
                if (val === undefined || val.startsWith("--")) {
                        out[key] = true;
                } else {
                        out[key] = val;
                        i++;
                }
        }
        return out;
}

/** `function-name` / `function_name` / `functionName` → `functionName`. */
function normalizeKey(k: string): string {
        return k.replace(/[-_]([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/** `unown --mode json -p --no-session <task>` invocation — matches the
 *  `task` tool's runSubagentOnce shape. The recipe body becomes the task
 *  prompt. Optional `--tools`, `--model`, `--effort` are forwarded. */
function spawnRecipeSubagent(
        cwd: string,
        task: string,
        opts: { model?: string; effort?: string; tools?: string[]; outputSchema?: object },
): Promise<string> {
        return new Promise((resolve) => {
                const args = ["--mode", "json", "-p", "--no-session"];
                if (opts.tools && opts.tools.length > 0) args.push("--tools", opts.tools.join(","));
                if (opts.model) args.push("--model", opts.model);
                if (opts.effort) args.push("--effort", opts.effort);
                args.push(task);
                const { command, args: cmdArgs } = resolveUnownInvocation(args);
                const child = spawn(command, cmdArgs, {
                        cwd,
                        env: process.env,
                        windowsHide: true,
                        stdio: ["ignore", "pipe", "pipe"],
                });
                let stdout = "";
                let stderr = "";
                child.stdout?.on("data", (d) => (stdout += d.toString()));
                child.stderr?.on("data", (d) => (stderr += d.toString()));
                child.on("close", () => {
                        // The JSON event stream's final assistant text is the recipe output.
                        resolve(extractFinalAssistantText(stdout));
                });
                child.on("error", () => {
                        resolve(stderr || "(subagent failed to start)");
                });
        });
}

function resolveUnownInvocation(args: string[]): { command: string; args: string[] } {
        const currentScript = process.argv[1];
        if (currentScript && !isBunVirtualScriptPath(currentScript) && existsSync(currentScript)) {
                return { command: process.execPath, args: [currentScript, ...args] };
        }
        if (process.platform === "win32") {
                const cli = resolveUnownCliScript();
                if (cli) return { command: process.execPath, args: [cli, ...args] };
        }
        return { command: "unown", args };
}

/** Pull the final assistant text out of the `unown --mode json` event stream.
 *  The stream is newline-delimited JSON objects; the last assistant message's
 *  text content is the subagent's reply. Print mode emits finalized messages
 *  as `message_end` events (agent-session.ts:1505) — the same contract the
 *  task tool's subagent collector keys on (tools.ts processLine). Exported for
 *  tests (test/recipes.test.ts pins the message_end contract). */
export function extractFinalAssistantText(stream: string): string {
        const lines = stream.split("\n").filter((l) => l.trim().length > 0);
        let lastAssistant = "";
        for (const line of lines) {
                let evt: any;
                try {
                        evt = JSON.parse(line);
                } catch {
                        continue;
                }
                if (evt?.type === "message_end" && evt?.message?.role === "assistant") {
                        const content = evt.message.content;
                        if (typeof content === "string") lastAssistant = content;
                        else if (Array.isArray(content)) {
                                lastAssistant = content
                                        .filter((b: any) => b?.type === "text" && typeof b.text === "string")
                                        .map((b: any) => b.text)
                                        .join("\n");
                        }
                }
        }
        return lastAssistant;
}

/** The default in-CLI recipe template used by `unown recipes create`. */
const CREATE_TEMPLATE = `---
name: {{NAME}}
description: A short description of what this recipe does
# Parameters: a JSON Schema describing what the recipe accepts.
parameters:
  type: object
  properties:
    example_param:
      type: string
      description: An example parameter
  required: [example_param]
# Sub-recipes: reference other recipes by name. They run as sub-tasks.
# sub_recipes:
#   - name: find-related-tests
#     description: Find existing tests for the same module
# Response schema: the recipe's final reply must satisfy this JSON Schema.
# response_schema:
#   type: object
#   properties:
#     result:
#       type: string
#   required: [result]
# Templates: files the recipe can instantiate (placeholders in the template
# content are interpolated with parameters).
# templates:
#   - path: "example-{{example_param}}.txt"
#     content: |
#       Hello, {{example_param}}!
# Tool restrictions: only these tools are active when the recipe runs.
# allowed_tools: [read, write, edit, bash, grep]
# Model + effort overrides (per Milestone 2.1).
# model: kimi-k2.5
# effort: medium
---

# {{NAME}}

Describe the task for the agent here. Use \`{{example_param}}\` to interpolate parameters.

Sub-tasks (optional):
- Reference sub-recipes with \`{{> sub-recipe-name arg=value }}\`.
`;

/** Exit-code-returning entry point. `argv` is everything AFTER `unown recipes`. */
export async function runRecipesCommand(argv: string[]): Promise<number> {
        const sub = argv[0] ?? "list";

        if (hasFlag(argv, "-h") || hasFlag(argv, "--help") || sub === "help") {
                process.stdout.write(RECIPES_USAGE + "\n");
                return 0;
        }

        const cwd = process.cwd();

        if (sub === "list") {
                const { recipes, sources } = loadRecipes(cwd);
                if (recipes.length === 0) {
                        process.stdout.write(
                                "No recipes found. Create one with `unown recipes create <name>` or add .md files to " +
                                        projectRecipesDir(cwd) +
                                        " / " +
                                        userRecipesDir() +
                                        ".\n",
                        );
                        return 0;
                }
                const lines = recipes.map((r) => {
                        const srcTag = r.source === "project" ? "project" : r.source === "user" ? "user" : "builtin";
                        const tools = r.allowedTools ? ` [tools: ${r.allowedTools.join(",")}]` : "";
                        const model = r.model ? ` [model: ${r.model}]` : "";
                        const effort = r.effort ? ` [effort: ${r.effort}]` : "";
                        const params = r.parameters ? " [has parameters]" : "";
                        const resp = r.responseSchema ? " [has response_schema]" : "";
                        return `${r.name}  (${srcTag})${params}${resp}${tools}${model}${effort}\n    ${r.description}`;
                });
                process.stdout.write(lines.join("\n") + "\n");
                process.stdout.write(
                        `\nSources: ${sources.project.length} project file(s), ${sources.user.length} user file(s).\n`,
                );
                return 0;
        }

        if (sub === "run") {
                const name = argv[1];
                if (!name || name.startsWith("--")) {
                        process.stderr.write("usage: unown recipes run <name> [--param value]...\n");
                        return 1;
                }
                const userDir = flagValue(argv, "--user-dir");
                const { recipes } = loadRecipes(cwd, userDir);
                const recipe = recipes.find((r) => r.name === name);
                if (!recipe) {
                        process.stderr.write(`unown recipes run: no recipe named "${name}"\n`);
                        process.stderr.write(`Available: ${recipes.map((r) => r.name).join(", ") || "(none)"}\n`);
                        return 1;
                }
                const args = parseRecipeArgs(argv.slice(2));
                try {
                        const result = await runRecipe(recipe, args, {
                                cwd,
                                callSubagent: (task, opts) => spawnRecipeSubagent(cwd, task, opts ?? {}),
                        });
                        if (result.success) {
                                if (result.structuredOutput !== undefined) {
                                        process.stdout.write(JSON.stringify(result.structuredOutput, null, 2) + "\n");
                                } else {
                                        process.stdout.write(result.output + "\n");
                                }
                                if (result.templateFiles && result.templateFiles.length > 0) {
                                        process.stderr.write(`Templates written: ${result.templateFiles.join(", ")}\n`);
                                }
                                if (result.error) process.stderr.write(`Warnings: ${result.error}\n`);
                                return 0;
                        }
                        process.stderr.write(`✗ Recipe failed: ${result.error ?? "unknown error"}\n`);
                        if (result.output) process.stderr.write(`Output:\n${result.output}\n`);
                        return 1;
                } catch (err: any) {
                        process.stderr.write(`unown recipes run: ${err?.message ?? err}\n`);
                        return 1;
                }
        }

        if (sub === "create") {
                const name = argv[1];
                if (!name || name.startsWith("--")) {
                        process.stderr.write("usage: unown recipes create <name> [--project | --user] [--path <path>]\n");
                        return 1;
                }
                const target = hasFlag(argv, "--user") ? "user" : "project";
                let dir: string;
                if (target === "user") {
                        dir = userRecipesDir();
                } else {
                        dir = projectRecipesDir(cwd);
                }
                const customPath = flagValue(argv, "--path");
                if (customPath) dir = customPath;
                const file = join(dir, `${name}.md`);
                try {
                        mkdirSync(dirname(file), { recursive: true });
                        writeFileSync(file, CREATE_TEMPLATE.replace(/\{\{NAME\}\}/g, name), { encoding: "utf8" });
                        process.stdout.write(`✓ Created recipe at ${file}\n`);
                        process.stdout.write("Edit it to add parameters, response_schema, templates, etc.\n");
                        return 0;
                } catch (err: any) {
                        process.stderr.write(`unown recipes create: ${err?.message ?? err}\n`);
                        return 1;
                }
        }

        if (sub === "validate") {
                const file = argv[1];
                if (!file || file.startsWith("--")) {
                        process.stderr.write("usage: unown recipes validate <file>\n");
                        return 1;
                }
                if (!existsSync(file)) {
                        process.stderr.write(`unown recipes validate: file not found: ${file}\n`);
                        return 1;
                }
                let content: string;
                try {
                        content = readFileSync(file, "utf8");
                } catch (err: any) {
                        process.stderr.write(`unown recipes validate: cannot read ${file}: ${err?.message ?? err}\n`);
                        return 1;
                }
                const recipe = parseRecipe(content, "user");
                if (!recipe) {
                        process.stderr.write(`✗ Not a valid recipe: ${file}\n`);
                        process.stderr.write("(Missing frontmatter, malformed YAML, or missing name/description.)\n");
                        return 1;
                }
                process.stdout.write(`✓ Valid recipe: ${recipe.name}\n`);
                process.stdout.write(`  description: ${recipe.description}\n`);
                process.stdout.write(`  parameters: ${recipe.parameters ? "yes" : "no"}\n`);
                process.stdout.write(`  sub_recipes: ${recipe.subRecipes ? recipe.subRecipes.map((s) => s.name).join(", ") : "none"}\n`);
                process.stdout.write(`  response_schema: ${recipe.responseSchema ? "yes" : "no"}\n`);
                process.stdout.write(`  templates: ${recipe.templates ? recipe.templates.map((t) => t.path).join(", ") : "none"}\n`);
                process.stdout.write(`  allowed_tools: ${recipe.allowedTools ? recipe.allowedTools.join(", ") : "none"}\n`);
                process.stdout.write(`  model: ${recipe.model ?? "default"}\n`);
                process.stdout.write(`  effort: ${recipe.effort ?? "default"}\n`);
                process.stdout.write(`  body: ${recipe.body.length} chars\n`);
                return 0;
        }

        process.stderr.write(`unown recipes: unknown subcommand "${sub}"\n\n${RECIPES_USAGE}\n`);
        return 1;
}
