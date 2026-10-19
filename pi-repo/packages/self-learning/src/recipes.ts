/**
 * recipes.ts — declarative YAML/JSON agent instruction bundles (Milestone 4.1).
 *
 * Reverse-engineered from goose's Recipes feature (the signature goose feature,
 * per /home/z/my-project/research/2-b1-report.md proposal #1, "Recipes —
 * declarative agent instruction bundles"). A recipe is a markdown file with
 * YAML frontmatter that bundles:
 *
 *   - a markdown body (the agent's task instructions)
 *   - parameters (a JSON Schema describing what the recipe accepts)
 *   - sub_recipes (referenced by name; they run as sub-tasks)
 *   - response_schema (a JSON Schema the recipe's final reply must satisfy)
 *   - templates (file templates the recipe can instantiate)
 *   - allowed_tools (restrict the active tool set)
 *   - model + effort overrides (per Milestone 2.1)
 *
 * Storage:
 *   - project-scoped: <cwd>/.unown/recipes/*.md
 *   - user-scoped:    $UNOWN_HOME/recipes/*.md   (UNOWN_HOME-respecting; default ~/.unown/recipes)
 *   - project wins on name collision (mirrors `.unown/agents/*.md` precedence)
 *
 * Template interpolation: `{{param}}` tokens in the body and in template file
 * paths/contents are replaced with the corresponding values from `args`.
 * Missing params render as empty strings — interpolation NEVER throws (mirrors
 * hooks-config.ts's `interpolateTemplate` invariant). Nested object/array args
 * are JSON-stringified (so a recipe can ask for `{{items}}` and pass an array).
 *
 * Sub-recipe tokens `{{> name arg=val }}` are intentionally NOT executed here —
 * they are emitted verbatim into the body and left for the subagent to invoke
 * via the existing `task` tool (goose's `summon`-platform-tool equivalent, per
 * the 2-b1 report's recommended Unown port). The recipe layer only owns the
 * surface contract; execution remains the agent's job.
 *
 * Purity: fs + path + the JSON Schema validator only. No pi imports — `runRecipe`
 * takes a `callSubagent` injection so the module is hermetically testable.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { atomicWriteFileSync } from "./atomic.ts";
import { UNOWN_HOME } from "./term.ts";
import { validateJsonSchema } from "./jsonschema.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A sub-recipe reference — name + an optional description of what it does. */
export interface SubRecipe {
        name: string;
        description?: string;
}

/** A file template the recipe can instantiate. The `path` and `content`
 *  support `{{param}}` interpolation against the recipe args. */
export interface RecipeTemplate {
        path: string;
        content: string;
}

/** The parsed shape of a recipe. Frontmatter keys are normalized to camelCase
 *  on load (the YAML may use snake_case — the goose convention — and we accept
 *  either spelling for every field). */
export interface Recipe {
        name: string;
        description: string;
        parameters?: object;
        subRecipes?: SubRecipe[];
        responseSchema?: object;
        templates?: RecipeTemplate[];
        allowedTools?: string[];
        model?: string;
        effort?: string;
        body: string;
        source: "project" | "user" | "built-in";
        /** Path of the file this recipe was loaded from (for `/recipe list` provenance). */
        filePath?: string;
}

/** Where recipes were discovered from — used by `unown recipes list` and `/recipe list`. */
export interface RecipeSources {
        user: string[];
        project: string[];
}

export interface RecipeLoadResult {
        recipes: Recipe[];
        sources: RecipeSources;
}

/** A caller-injected subagent runner. The recipe layer never spawns pi
 *  directly — the caller (tools.ts in-session, recipes-cli.ts out-of-session)
 *  wires the actual `unown --mode json` subprocess through this callback.
 *  Options mirror what the recipe can override: model, effort, the tool
 *  allowlist, and the response_schema for structured-output validation. */
export interface RecipeRunContext {
        cwd: string;
        callSubagent: (
                task: string,
                opts?: {
                        model?: string;
                        effort?: string;
                        tools?: string[];
                        outputSchema?: object;
                },
        ) => Promise<string>;
}

/** The outcome of running a recipe. `structuredOutput` is the parsed,
 *  schema-validated JSON the subagent emitted (only present when the recipe
 *  declared `response_schema` AND validation succeeded). `templateFiles` lists
 *  any files written by template instantiation, relative to `cwd`. */
export interface RecipeRunResult {
        success: boolean;
        output: string;
        structuredOutput?: unknown;
        templateFiles?: string[];
        error?: string;
}

// ---------------------------------------------------------------------------
// parseRecipe — YAML frontmatter + markdown body
// ---------------------------------------------------------------------------

type RawFrontmatter = {
        name?: unknown;
        description?: unknown;
        parameters?: unknown;
        sub_recipes?: unknown;
        subRecipes?: unknown;
        response_schema?: unknown;
        responseSchema?: unknown;
        templates?: unknown;
        allowed_tools?: unknown;
        allowedTools?: unknown;
        model?: unknown;
        effort?: unknown;
};

function asString(v: unknown): string | undefined {
        return typeof v === "string" ? v : undefined;
}

function asObject(v: unknown): object | undefined {
        return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as object) : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
        if (!Array.isArray(v)) return undefined;
        const out: string[] = [];
        for (const item of v) {
                if (typeof item === "string") out.push(item);
        }
        return out.length > 0 ? out : undefined;
}

function asSubRecipes(v: unknown): SubRecipe[] | undefined {
        if (!Array.isArray(v)) return undefined;
        const out: SubRecipe[] = [];
        for (const item of v) {
                if (item !== null && typeof item === "object" && !Array.isArray(item)) {
                        const obj = item as Record<string, unknown>;
                        const name = typeof obj.name === "string" ? obj.name : undefined;
                        if (!name) continue;
                        const description = typeof obj.description === "string" ? obj.description : undefined;
                        out.push({ name, description });
                } else if (typeof item === "string") {
                        out.push({ name: item });
                }
        }
        return out.length > 0 ? out : undefined;
}

function asTemplates(v: unknown): RecipeTemplate[] | undefined {
        if (!Array.isArray(v)) return undefined;
        const out: RecipeTemplate[] = [];
        for (const item of v) {
                if (item !== null && typeof item === "object" && !Array.isArray(item)) {
                        const obj = item as Record<string, unknown>;
                        const path = typeof obj.path === "string" ? obj.path : undefined;
                        const content = typeof obj.content === "string" ? obj.content : "";
                        if (!path) continue;
                        out.push({ path, content });
                }
        }
        return out.length > 0 ? out : undefined;
}

/** Parse a markdown file with YAML frontmatter into a Recipe. Returns null
 *  on parse failure (missing name/description, malformed YAML, or no
 *  frontmatter block at all). Tolerates both snake_case (goose) and camelCase
 *  frontmatter keys — every field accepts either spelling. */
export function parseRecipe(content: string, source: "project" | "user" | "built-in" = "user"): Recipe | null {
        let frontmatter: Record<string, unknown>;
        let body: string;
        try {
                ({ frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content));
        } catch {
                return null;
        }
        // `parseFrontmatter` returns an empty object when no frontmatter block
        // is present — distinguish "no frontmatter at all" from "frontmatter
        // with only a body" by inspecting the raw content for the opening
        // `---\n` sentinel. A recipe without a name is not a recipe.
        const hasFrontmatter = /^---\s*\n/.test(content.replace(/^\uFEFF/, ""));
        if (!hasFrontmatter) return null;
        const raw = frontmatter as RawFrontmatter;
        const name = asString(raw.name);
        const description = asString(raw.description);
        if (!name || !description) return null;
        const recipe: Recipe = {
                name,
                description,
                body: body ?? "",
                source,
        };
        const parameters = asObject(raw.parameters);
        if (parameters) recipe.parameters = parameters;
        const subRecipes = asSubRecipes(raw.sub_recipes ?? raw.subRecipes);
        if (subRecipes) recipe.subRecipes = subRecipes;
        const responseSchema = asObject(raw.response_schema ?? raw.responseSchema);
        if (responseSchema) recipe.responseSchema = responseSchema;
        const templates = asTemplates(raw.templates);
        if (templates) recipe.templates = templates;
        const allowedTools = asStringArray(raw.allowed_tools ?? raw.allowedTools);
        if (allowedTools) recipe.allowedTools = allowedTools;
        const model = asString(raw.model);
        if (model) recipe.model = model;
        const effort = asString(raw.effort);
        if (effort) recipe.effort = effort;
        return recipe;
}

// ---------------------------------------------------------------------------
// interpolateRecipeBody — {{param}} token replacement
// ---------------------------------------------------------------------------

/** Same token shape as hooks-config.ts's `interpolateTemplate` — supports
 *  dotted/bracketed paths into nested args (`{{user.name}}`, `{{items[0]}}`).
 *  Diverges by NOT special-casing `tool`/`prompt`/etc (those are HookEvent
 *  fields, not recipe args). */
const TEMPLATE_RE = /\{\{\s*([a-zA-Z0-9_.[\]]+)\s*\}\}/g;

function lookupPath(args: Record<string, unknown>, path: string): unknown {
        // Fast path: the whole key matches a top-level arg.
        if (Object.prototype.hasOwnProperty.call(args, path)) return args[path];
        // Dotted path: a.b.c
        if (path.includes(".")) {
                const parts = path.split(".");
                let node: unknown = args;
                for (const part of parts) {
                        if (node === null || typeof node !== "object") return undefined;
                        node = (node as Record<string, unknown>)[part];
                        if (node === undefined) return undefined;
                }
                return node;
        }
        // Bracket path: items[0]
        const bracketMatch = path.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\[(\d+)\]$/);
        if (bracketMatch) {
                const arr = args[bracketMatch[1]];
                if (Array.isArray(arr)) return arr[Number(bracketMatch[2])];
        }
        return undefined;
}

/** Replace `{{param}}` tokens with values from `args`. Missing params render
 *  as empty strings — NEVER throws. Strings/numbers/booleans substitute
 *  verbatim; objects/arrays are JSON-stringified (so a recipe can ask for
 *  `{{items}}` and pass an array). */
export function interpolateRecipeBody(recipe: Recipe, args: Record<string, unknown>): string {
        return interpolateString(recipe.body, args);
}

/** The shared interpolation primitive. Also used for template file paths and
 *  template contents (Milestone 1 hook template interpolation pattern). */
export function interpolateString(template: string, args: Record<string, unknown>): string {
        return template.replace(TEMPLATE_RE, (_m, key: string) => {
                const v = lookupPath(args, key);
                if (v === null || v === undefined) return "";
                if (typeof v === "string") return v;
                if (typeof v === "number" || typeof v === "boolean") return String(v);
                try {
                        return JSON.stringify(v);
                } catch {
                        return String(v);
                }
        });
}

// ---------------------------------------------------------------------------
// validateRecipeArgs — JSON Schema validation against `recipe.parameters`
// ---------------------------------------------------------------------------

/** Validate `args` against the recipe's `parameters` JSON Schema (if any).
 *  Reuses `validateJsonSchema` from `./jsonschema.ts` — the same validator
 *  the `task` tool uses for structured outputs. Returns `{ ok: true }` when
 *  no schema is declared, so callers don't need to branch. */
export function validateRecipeArgs(
        recipe: Recipe,
        args: Record<string, unknown>,
): { ok: boolean; errors: string[] } {
        if (!recipe.parameters) return { ok: true, errors: [] };
        try {
                const result = validateJsonSchema(args, recipe.parameters);
                if (result.valid) return { ok: true, errors: [] };
                return { ok: false, errors: result.issues.map((i) => `${i.path}: ${i.message}`) };
        } catch (err) {
                // SchemaError — the SCHEMA itself is malformed. Surface it
                // as a validation failure with the schema's defect (the caller
                // will not be able to "fix" args to make this pass; the recipe
                // file is the bug).
                return { ok: false, errors: [`schema error: ${err instanceof Error ? err.message : String(err)}`] };
        }
}

// ---------------------------------------------------------------------------
// loadRecipes — discover from project + user recipe directories
// ---------------------------------------------------------------------------

/** The project-scoped recipes dir: <cwd>/.unown/recipes/. */
export function projectRecipesDir(cwd: string): string {
        return join(cwd, ".unown", "recipes");
}

/** The user-scoped recipes dir: $UNOWN_HOME/recipes (UNOWN_HOME-respecting). */
export function userRecipesDir(agentDir: string = UNOWN_HOME): string {
        return join(agentDir, "recipes");
}

function loadRecipesFromDir(dir: string, source: "project" | "user"): { recipes: Recipe[]; loaded: string[] } {
        const recipes: Recipe[] = [];
        const loaded: string[] = [];
        if (!existsSync(dir)) return { recipes, loaded };
        let entries: ReturnType<typeof readdirSync>;
        try {
                entries = readdirSync(dir, { withFileTypes: true });
        } catch {
                return { recipes, loaded };
        }
        for (const entry of entries) {
                if (!entry.isFile()) continue;
                if (!entry.name.endsWith(".md") && !entry.name.endsWith(".yaml") && !entry.name.endsWith(".yml")) continue;
                const filePath = join(dir, entry.name);
                let content: string;
                try {
                        content = readFileSync(filePath, "utf8");
                } catch {
                        continue;
                }
                const recipe = parseRecipe(content, source);
                if (!recipe) continue;
                recipe.filePath = filePath;
                recipes.push(recipe);
                loaded.push(filePath);
        }
        return { recipes, loaded };
}

/** Discover all recipes for a project. Project recipes win on name collision
 *  with user recipes (mirrors `.unown/agents/*.md` precedence: built-in < user
 *  < project). */
export function loadRecipes(cwd: string, agentDir: string = UNOWN_HOME): RecipeLoadResult {
        const user = loadRecipesFromDir(userRecipesDir(agentDir), "user");
        const project = loadRecipesFromDir(projectRecipesDir(cwd), "project");
        const byName = new Map<string, Recipe>();
        for (const r of user.recipes) byName.set(r.name, r);
        for (const r of project.recipes) byName.set(r.name, r);
        return {
                recipes: [...byName.values()],
                sources: {
                        user: user.loaded,
                        project: project.loaded,
                },
        };
}

// ---------------------------------------------------------------------------
// runRecipe — the main entry point
// ---------------------------------------------------------------------------

/** Schema-validation retries before giving up (mirrors `STRUCTURED_RETRIES`
 *  in tools.ts: one original run + 2 corrective re-runs). */
const RECIPE_RESPONSE_RETRIES = 2;

/** Extract the JSON a model emitted: handles bare JSON, fenced ```json blocks,
 *  and leading/trailing prose around ONE balanced object/array. Mirrors
 *  `extractJsonReply` in tools.ts (kept here so recipes.ts has zero pi imports
 *  while still using the same defensive extraction). */
function extractJsonReply(text: string): { ok: true; data: unknown } | { ok: false; error: string } {
        const trimmed = text.trim();
        if (!trimmed) return { ok: false, error: "empty reply" };
        const fence = trimmed.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/);
        const candidates: string[] = [];
        if (fence?.[1]) candidates.push(fence[1].trim());
        candidates.push(trimmed);
        const scan = scanBalancedJson(trimmed);
        if (scan !== null) candidates.push(scan);
        for (const candidate of candidates) {
                try {
                        return { ok: true, data: JSON.parse(candidate) };
                } catch {
                        /* try the next candidate shape */
                }
        }
        return { ok: false, error: "reply is not valid JSON (no parseable object or array found)" };
}

function scanBalancedJson(text: string): string | null {
        const start = text.search(/[{[]/);
        if (start === -1) return null;
        const open = text[start];
        const close = open === "{" ? "}" : "]";
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = start; i < text.length; i++) {
                const ch = text[i];
                if (inString) {
                        if (escaped) escaped = false;
                        else if (ch === "\\") escaped = true;
                        else if (ch === '"') inString = false;
                        continue;
                }
                if (ch === '"') inString = true;
                else if (ch === open) depth++;
                else if (ch === close) {
                        depth--;
                        if (depth === 0) return text.slice(start, i + 1);
                }
        }
        return null;
}

function formatIssues(issues: string[], cap = 8): string {
        const shown = issues.slice(0, cap);
        const more = issues.length > cap ? ` (+${issues.length - cap} more)` : "";
        return shown.join("; ") + more;
}

/** Instantiate the recipe's templates: writes each template file (with its
 *  `{{param}}` tokens interpolated against `args`) into `cwd`. Returns the
 *  list of files written (relative paths). Best-effort: a write failure is
 *  reported in the result but does NOT abort the subagent run (templates are
 *  often best-effort scaffolding the agent will overwrite anyway). */
export function instantiateTemplates(
        recipe: Recipe,
        args: Record<string, unknown>,
        cwd: string,
): { files: string[]; errors: string[] } {
        const files: string[] = [];
        const errors: string[] = [];
        if (!recipe.templates) return { files, errors };
        for (const tpl of recipe.templates) {
                const relPath = interpolateString(tpl.path, args);
                if (!relPath) {
                        errors.push("template path resolved to empty string (skipped)");
                        continue;
                }
                const content = interpolateString(tpl.content, args);
                const absPath = join(cwd, relPath);
                try {
                        atomicWriteFileSync(absPath, content);
                        files.push(relPath);
                } catch (err) {
                        errors.push(`${relPath}: ${err instanceof Error ? err.message : String(err)}`);
                }
        }
        return { files, errors };
}

/** Run a recipe: validate args, interpolate the body, optionally instantiate
 *  templates, then spawn a subagent with the body as its task. If
 *  `responseSchema` is set, validates the subagent's reply against it with up
 *  to RECIPE_RESPONSE_RETRIES corrective re-runs (same shape as the existing
 *  `task` tool's structured-output lane). */
export async function runRecipe(
        recipe: Recipe,
        args: Record<string, unknown>,
        ctx: RecipeRunContext,
): Promise<RecipeRunResult> {
        // 1. Validate args against the parameters schema.
        const validation = validateRecipeArgs(recipe, args);
        if (!validation.ok) {
                return {
                        success: false,
                        output: "",
                        error: `parameter validation failed: ${formatIssues(validation.errors)}`,
                };
        }

        // 2. Interpolate the body.
        const body = interpolateRecipeBody(recipe, args);

        // 3. Instantiate templates (best-effort; failures recorded but non-fatal).
        const templateResult = instantiateTemplates(recipe, args, ctx.cwd);

        // 4. Build the subagent options from the recipe's overrides.
        const subOpts: {
                model?: string;
                effort?: string;
                tools?: string[];
                outputSchema?: object;
        } = {};
        if (recipe.model) subOpts.model = recipe.model;
        if (recipe.effort) subOpts.effort = recipe.effort;
        if (recipe.allowedTools) subOpts.tools = recipe.allowedTools;
        if (recipe.responseSchema) subOpts.outputSchema = recipe.responseSchema;

        // 5. If no response schema, the subagent's reply is the recipe output.
        if (!recipe.responseSchema) {
                const output = await ctx.callSubagent(body, subOpts);
                return {
                        success: true,
                        output,
                        templateFiles: templateResult.files.length > 0 ? templateResult.files : undefined,
                        error: templateResult.errors.length > 0 ? `template errors: ${templateResult.errors.join("; ")}` : undefined,
                };
        }

        // 6. With a response schema: validate the reply (with corrective retries).
        let attempts = 0;
        let currentTask = body;
        let lastOutput = "";
        for (;;) {
                attempts++;
                const output = await ctx.callSubagent(currentTask, subOpts);
                lastOutput = output;
                const extracted = extractJsonReply(output);
                if (extracted.ok) {
                        try {
                                const result = validateJsonSchema(extracted.data, recipe.responseSchema);
                                if (result.valid) {
                                        return {
                                                success: true,
                                                output,
                                                structuredOutput: extracted.data,
                                                templateFiles: templateResult.files.length > 0 ? templateResult.files : undefined,
                                                error: templateResult.errors.length > 0
                                                        ? `template errors: ${templateResult.errors.join("; ")}`
                                                        : undefined,
                                        };
                                }
                                // Schema validation failed — quote the defects back.
                                const problems = formatIssues(result.issues.map((i) => `${i.path}: ${i.message}`));
                                if (attempts > RECIPE_RESPONSE_RETRIES) {
                                        return {
                                                success: false,
                                                output,
                                                error: `response schema validation failed after ${attempts} attempt(s): ${problems}`,
                                                templateFiles: templateResult.files.length > 0 ? templateResult.files : undefined,
                                        };
                                }
                                currentTask = buildSchemaRetryTask(currentTask, recipe.responseSchema, problems);
                                continue;
                        } catch (err) {
                                // SchemaError — the SCHEMA is malformed.
                                return {
                                        success: false,
                                        output,
                                        error: `schema error: ${err instanceof Error ? err.message : String(err)}`,
                                        templateFiles: templateResult.files.length > 0 ? templateResult.files : undefined,
                                };
                        }
                }
                // Not JSON — corrective re-run.
                if (attempts > RECIPE_RESPONSE_RETRIES) {
                        return {
                                success: false,
                                output,
                                error: `response was not valid JSON after ${attempts} attempt(s): ${extracted.error}`,
                                templateFiles: templateResult.files.length > 0 ? templateResult.files : undefined,
                        };
                }
                currentTask = buildSchemaRetryTask(currentTask, recipe.responseSchema, extracted.error);
        }
}

/** The corrective re-run task: same body + the schema + the exact defects.
 *  Mirrors `buildSchemaRetryTask` in tools.ts (kept private — only the retry
 *  loop needs it). */
function buildSchemaRetryTask(task: string, schema: unknown, problems: string): string {
        return (
                `${task}\n\n` +
                `STRUCTURED OUTPUT REQUIRED: your previous reply failed validation — ${problems}.\n` +
                `Reply with ONLY the corrected JSON value (no prose, no markdown fences) that validates against this JSON Schema:\n` +
                `${JSON.stringify(schema, null, 2)}`
        );
}
