import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, dirname, join, resolve, sep } from "path";
import { CONFIG_DIR_NAME } from "../config.ts";
import { parseFrontmatter } from "../utils/frontmatter.ts";
import { resolvePath } from "../utils/paths.ts";
import { createSyntheticSourceInfo, type SourceInfo } from "./source-info.ts";

/**
 * Represents a prompt template loaded from a markdown file
 */
export interface PromptTemplate {
        name: string;
        description: string;
        argumentHint?: string;
        content: string;
        sourceInfo: SourceInfo;
        filePath: string; // Absolute path to the template file
}

/**
 * Parse command arguments respecting quoted strings (bash-style)
 * Returns array of arguments
 */
export function parseCommandArgs(argsString: string): string[] {
        const args: string[] = [];
        let current = "";
        let inQuote: string | null = null;

        for (let i = 0; i < argsString.length; i++) {
                const char = argsString[i];

                if (inQuote) {
                        if (char === inQuote) {
                                inQuote = null;
                        } else {
                                current += char;
                        }
                } else if (char === '"' || char === "'") {
                        inQuote = char;
                } else if (/\s/.test(char)) {
                        if (current) {
                                args.push(current);
                                current = "";
                        }
                } else {
                        current += char;
                }
        }

        if (current) {
                args.push(current);
        }

        return args;
}

/**
 * Substitute argument placeholders in template content
 * Supports:
 * - $1, $2, ... for positional args
 * - $@ and $ARGUMENTS for all args
 * - ${N:-default} for positional arg N with default when missing/empty
 * - ${@:-default} and ${ARGUMENTS:-default} for all args with a default when empty
 * - ${@:N} for args from Nth onwards (bash-style slicing)
 * - ${@:N:L} for L args starting from Nth
 *
 * Note: Replacement happens on the template string only. Argument and default values
 * containing patterns like $1, $@, or $ARGUMENTS are NOT recursively substituted.
 */
export function substituteArgs(content: string, args: string[]): string {
        const allArgs = args.join(" ");

        // (ReDoS fix) The first alternative used to be \$\{(\d+|ARGUMENTS|@):-… —
        // the alternation inside the group overlaps with what follows it, and
        // the backtracking across "${{@:-" runs was polynomial. Splitting it
        // into one alternative per literal target keeps the matched language
        // identical (the targets are mutually exclusive after "${") while
        // giving every alternative a literal, unambiguous prefix.
        return content.replace(
                /\$\{ARGUMENTS:-([^}]*)\}|\$\{@:-([^}]*)\}|\$\{(\d+):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
                (_match, argumentsDefault, atDefault, numberTarget, numberDefault, sliceStart, sliceLength, simple) => {
                        if (argumentsDefault !== undefined) {
                                return allArgs ? allArgs : argumentsDefault;
                        }

                        if (atDefault !== undefined) {
                                return allArgs ? allArgs : atDefault;
                        }

                        if (numberTarget !== undefined) {
                                const value = args[parseInt(numberTarget, 10) - 1];
                                return value ? value : numberDefault;
                        }

                        if (sliceStart) {
                                let start = parseInt(sliceStart, 10) - 1; // Convert to 0-indexed (user provides 1-indexed)
                                // Treat 0 as 1 (bash convention: args start at 1)
                                if (start < 0) start = 0;

                                if (sliceLength) {
                                        const length = parseInt(sliceLength, 10);
                                        return args.slice(start, start + length).join(" ");
                                }
                                return args.slice(start).join(" ");
                        }

                        if (simple === "ARGUMENTS" || simple === "@") {
                                return allArgs;
                        }

                        const index = parseInt(simple, 10) - 1;
                        return args[index] ?? "";
                },
        );
}

function loadTemplateFromFile(filePath: string, sourceInfo: SourceInfo): PromptTemplate | null {
        try {
                const rawContent = readFileSync(filePath, "utf-8");

                // Graceful degradation: malformed frontmatter YAML must not kill the
                // whole template. The canonical trap is Claude Code-style unquoted
                // `argument-hint: [name] [greeting]` — two YAML flow sequences, a
                // parse error. Fall back to "no frontmatter" so the command still
                // loads; only its description/hint metadata is lost.
                let frontmatter: Record<string, unknown> = {};
                let body = rawContent;
                try {
                        const parsed = parseFrontmatter<Record<string, unknown>>(rawContent);
                        frontmatter = parsed.frontmatter ?? {};
                        body = parsed.body;
                } catch {
                        frontmatter = {};
                        // Best-effort strip of the (unparseable) frontmatter block:
                        // same --- ... --- boundaries extractFrontmatter splits on,
                        // minus the YAML parse. No closing marker → keep raw content.
                        body = rawContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
                }

                const name = basename(filePath).replace(/\.md$/, "");

                // YAML scalars can come back as arrays/numbers; normalize to strings.
                const scalarToString = (value: unknown): string | undefined => {
                        if (Array.isArray(value)) {
                                const joined = value.map((v) => (typeof v === "string" ? v : String(v))).join(" ");
                                return joined.trim() ? joined : undefined;
                        }
                        if (typeof value === "string") return value.trim() ? value : undefined;
                        if (typeof value === "number" || typeof value === "boolean") return String(value);
                        return undefined;
                };

                // Get description from frontmatter or first non-empty line
                let description = scalarToString(frontmatter.description) ?? "";
                if (!description) {
                        const firstLine = body.split("\n").find((line) => line.trim());
                        if (firstLine) {
                                // Truncate if too long
                                description = firstLine.slice(0, 60);
                                if (firstLine.length > 60) description += "...";
                        }
                }

                const argumentHint = scalarToString(frontmatter["argument-hint"]);

                return {
                        name,
                        description,
                        ...(argumentHint && { argumentHint }),
                        content: body,
                        sourceInfo,
                        filePath,
                };
        } catch {
                return null;
        }
}

/**
 * Scan a directory for .md files (non-recursive) and load them as prompt templates.
 */
function loadTemplatesFromDir(dir: string, getSourceInfo: (filePath: string) => SourceInfo): PromptTemplate[] {
        const templates: PromptTemplate[] = [];

        if (!existsSync(dir)) {
                return templates;
        }

        try {
                const entries = readdirSync(dir, { withFileTypes: true });

                for (const entry of entries) {
                        const fullPath = join(dir, entry.name);

                        // For symlinks, check if they point to a file
                        let isFile = entry.isFile();
                        if (entry.isSymbolicLink()) {
                                try {
                                        const stats = statSync(fullPath);
                                        isFile = stats.isFile();
                                } catch {
                                        // Broken symlink, skip it
                                        continue;
                                }
                        }

                        if (isFile && entry.name.endsWith(".md")) {
                                const template = loadTemplateFromFile(fullPath, getSourceInfo(fullPath));
                                if (template) {
                                        templates.push(template);
                                }
                        }
                }
        } catch {
                return templates;
        }

        return templates;
}

export interface LoadPromptTemplatesOptions {
        /** Working directory for project-local templates. */
        cwd: string;
        /** Agent config directory for global templates. */
        agentDir: string;
        /** Explicit prompt template paths (files or directories). */
        promptPaths: string[];
        /** Include default prompt directories. */
        includeDefaults: boolean;
}

/**
 * Load all prompt templates from:
 * 1. Global: agentDir/prompts/
 * 2. Project: cwd/{CONFIG_DIR_NAME}/prompts/
 * 3. Explicit prompt paths
 */
export function loadPromptTemplates(options: LoadPromptTemplatesOptions): PromptTemplate[] {
        const resolvedCwd = resolvePath(options.cwd);
        const resolvedAgentDir = resolvePath(options.agentDir);
        const promptPaths = options.promptPaths;
        const includeDefaults = options.includeDefaults;

        const templates: PromptTemplate[] = [];

        const globalPromptsDir = join(resolvedAgentDir, "prompts");
        const projectPromptsDir = resolve(resolvedCwd, CONFIG_DIR_NAME, "prompts");

        const isUnderPath = (target: string, root: string): boolean => {
                const normalizedRoot = resolve(root);
                if (target === normalizedRoot) {
                        return true;
                }
                const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
                return target.startsWith(prefix);
        };

        const getSourceInfo = (resolvedPath: string): SourceInfo => {
                if (isUnderPath(resolvedPath, globalPromptsDir)) {
                        return createSyntheticSourceInfo(resolvedPath, {
                                source: "local",
                                scope: "user",
                                baseDir: globalPromptsDir,
                        });
                }
                if (isUnderPath(resolvedPath, projectPromptsDir)) {
                        return createSyntheticSourceInfo(resolvedPath, {
                                source: "local",
                                scope: "project",
                                baseDir: projectPromptsDir,
                        });
                }
                return createSyntheticSourceInfo(resolvedPath, {
                        source: "local",
                        baseDir: statSync(resolvedPath).isDirectory() ? resolvedPath : dirname(resolvedPath),
                });
        };

        if (includeDefaults) {
                templates.push(...loadTemplatesFromDir(globalPromptsDir, getSourceInfo));
                templates.push(...loadTemplatesFromDir(projectPromptsDir, getSourceInfo));
        }

        // 3. Load explicit prompt paths
        for (const rawPath of promptPaths) {
                const resolvedPath = resolvePath(rawPath, resolvedCwd, { trim: true });
                if (!existsSync(resolvedPath)) {
                        continue;
                }

                try {
                        const stats = statSync(resolvedPath);
                        if (stats.isDirectory()) {
                                templates.push(...loadTemplatesFromDir(resolvedPath, getSourceInfo));
                        } else if (stats.isFile() && resolvedPath.endsWith(".md")) {
                                const template = loadTemplateFromFile(resolvedPath, getSourceInfo(resolvedPath));
                                if (template) {
                                        templates.push(template);
                                }
                        }
                } catch {
                        // Ignore read failures
                }
        }

        return templates;
}

/**
 * Expand a prompt template if it matches a template name.
 * Returns the expanded content or the original text if not a template.
 */
export function expandPromptTemplate(text: string, templates: PromptTemplate[]): string {
        if (!text.startsWith("/")) return text;

        const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
        if (!match) return text;

        const templateName = match[1];
        const argsString = match[2] ?? "";

        const template = templates.find((t) => t.name === templateName);
        if (template) {
                const args = parseCommandArgs(argsString);
                return substituteArgs(template.content, args);
        }

        return text;
}
