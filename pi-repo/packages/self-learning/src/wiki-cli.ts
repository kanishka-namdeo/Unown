/**
 * wiki-cli.ts — `unown wiki <sub>` (Milestone 4.2).
 *
 * Subcommands:
 *   unown wiki generate [--force] [--cwd <path>]    generate the wiki to <cwd>/.unown/wiki
 *   unown wiki search <query>                       search the wiki for <query>
 *   unown wiki list                                  list all wiki pages
 *   unown wiki show <page>                           print a specific page
 *
 * Pattern matches `recipes-cli.ts` / `sessions-cli.ts` / `automations-cli.ts`:
 * returns an exit code, writes to stdout/stderr directly, no pi imports. The
 * `generate` subcommand uses a Node-side `callSubagent` that spawns
 * `unown --mode json` (the same shape the `task` tool + recipes use), so
 * the wiki layer stays pure in `repo-wiki.ts`.
 *
 * The wiki is written to `<cwd>/.unown/wiki/` (project-scoped, gitignored).
 * Pages contain `file:line` cross-links to the actual source code — every
 * claim a subagent makes cites a file path + line number, so the wiki is a
 * navigable map of the codebase, not a free-form summary.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { generateWiki, searchWiki, type WikiManifest, type WikiRunContext } from "./repo-wiki.ts";
import { isBunVirtualScriptPath, resolveUnownCliScript } from "./tools.ts";

export const WIKI_USAGE = `unown wiki — auto-generated repo documentation (Milestone 4.2)

Usage:
  unown wiki generate [--force] [--cwd <path>]
  unown wiki search <query>
  unown wiki list
  unown wiki show <page>

The wiki is written to .unown/wiki/ (project-scoped, gitignored) and contains:
  - index.md          — top-level overview (project, languages, modules)
  - modules/<name>.md — one page per module (responsibilities, public API,
                         key files with file:line cross-links)
  - architecture.md   — dependency graph (DOT + markdown list)
  - changes.md        — recent changes (extracted from CHANGELOG.md)
  - wiki.json         — manifest (page paths + dependencies)

Every claim in a module page cites a file:line. Run \`unown wiki generate\`
to (re)generate; \`unown wiki search <query>\` to find a topic; \`unown wiki
show <page>\` to print a specific page.

Docs: docs/repo-wiki.md.`;

function flagValue(argv: string[], name: string): string | undefined {
        const i = argv.indexOf(name);
        return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function hasFlag(argv: string[], name: string): boolean {
        return argv.includes(name);
}

/** Spawn a `unown --mode json -p --no-session <task>` subprocess and return
 *  the final assistant text from its JSON event stream. Mirrors
 *  `recipes-cli.ts:spawnRecipeSubagent` (the same shape the `task` tool
 *  uses). The wiki generator always passes an `outputSchema` so the
 *  subagent's reply is validated by the existing structured-output lane
 *  (oh-my-pi task outputSchema port — same shape as `recipes.ts`). */
function spawnWikiSubagent(
        cwd: string,
        task: string,
        opts: { outputSchema?: object; tools?: string[]; model?: string; effort?: string },
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
 *  text content is the subagent's reply. Mirrors `recipes-cli.ts`'s helper
 *  (kept private — only the CLI's callSubagent needs it). Print mode emits
 *  finalized messages as `message_end` events (agent-session.ts:1505) — the
 *  same contract the task tool's subagent collector keys on (tools.ts).
 *  Exported for tests (test/repo-wiki.test.ts pins the message_end contract). */
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
                        if (typeof content === "string") {
                                lastAssistant = content;
                        } else if (Array.isArray(content)) {
                                lastAssistant = content
                                        .filter((b: any) => b?.type === "text" && typeof b.text === "string")
                                        .map((b: any) => b.text)
                                        .join("\n");
                        }
                }
        }
        return lastAssistant;
}

/** The default wiki directory: <cwd>/.unown/wiki/. */
export function wikiDir(cwd: string): string {
        return join(cwd, ".unown", "wiki");
}

/** Exit-code-returning entry point. `argv` is everything AFTER `unown wiki`. */
export async function runWikiCommand(argv: string[]): Promise<number> {
        const sub = argv[0] ?? "help";

        if (hasFlag(argv, "-h") || hasFlag(argv, "--help") || sub === "help") {
                process.stdout.write(WIKI_USAGE + "\n");
                return 0;
        }

        const cwd = flagValue(argv, "--cwd") ?? process.cwd();
        const dir = wikiDir(cwd);

        if (sub === "generate") {
                const force = hasFlag(argv, "--force");
                process.stdout.write(`Generating wiki for ${cwd}…\n`);
                process.stdout.write(`  (writing to ${dir}${force ? " [force]" : ""})\n`);
                const ctx: WikiRunContext = {
                        cwd,
                        callSubagent: (task, opts) => spawnWikiSubagent(cwd, task, opts ?? {}),
                };
                try {
                        const result = await generateWiki(cwd, dir, ctx, { force });
                        process.stdout.write(`✓ Wiki written to ${dir}\n`);
                        process.stdout.write(`  Pages: ${result.pages.length}\n`);
                        process.stdout.write(`  Generated at: ${new Date(result.manifest.generatedAt).toISOString()}\n`);
                        if (result.errors.length > 0) {
                                process.stderr.write(
                                        `Warnings (${result.errors.length} module${result.errors.length === 1 ? "" : "s"} failed to generate cleanly):\n`,
                                );
                                for (const e of result.errors) {
                                        process.stderr.write(`  - ${e}\n`);
                                }
                        }
                        return 0;
                } catch (err: any) {
                        process.stderr.write(`✗ Wiki generation failed: ${err?.message ?? err}\n`);
                        return 1;
                }
        }

        if (sub === "search") {
                const query = argv.slice(1).filter((a) => !a.startsWith("--")).join(" ").trim();
                if (!query) {
                        process.stderr.write("usage: unown wiki search <query>\n");
                        return 1;
                }
                if (!existsSync(dir)) {
                        process.stderr.write(`No wiki found at ${dir}. Run \`unown wiki generate\` first.\n`);
                        return 1;
                }
                const results = await searchWiki(dir, query);
                if (results.length === 0) {
                        process.stdout.write(`No matches for "${query}".\n`);
                        return 0;
                }
                process.stdout.write(
                        `Search results for "${query}" (${results.length} match${results.length === 1 ? "" : "es"}):\n\n`,
                );
                for (const r of results) {
                        process.stdout.write(`  [score ${r.score}] ${r.page} — ${r.title}\n`);
                        process.stdout.write(`    ${r.snippet}\n\n`);
                }
                return 0;
        }

        if (sub === "list") {
                if (!existsSync(dir)) {
                        process.stderr.write(`No wiki found at ${dir}. Run \`unown wiki generate\` first.\n`);
                        return 1;
                }
                const manifestPath = join(dir, "wiki.json");
                if (!existsSync(manifestPath)) {
                        process.stderr.write(`No manifest found at ${manifestPath}.\n`);
                        return 1;
                }
                let manifest: WikiManifest;
                try {
                        manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
                } catch (err: any) {
                        process.stderr.write(`Could not parse manifest: ${err?.message ?? err}\n`);
                        return 1;
                }
                process.stdout.write(`Wiki at ${dir} (generated ${new Date(manifest.generatedAt).toISOString()}):\n\n`);
                for (const p of manifest.pages) {
                        process.stdout.write(`  ${p.path}  —  ${p.title}\n`);
                }
                process.stdout.write(`\n${manifest.pages.length} page(s) total.\n`);
                return 0;
        }

        if (sub === "show") {
                const page = argv[1];
                if (!page || page.startsWith("--")) {
                        process.stderr.write("usage: unown wiki show <page>\n");
                        return 1;
                }
                if (!existsSync(dir)) {
                        process.stderr.write(`No wiki found at ${dir}. Run \`unown wiki generate\` first.\n`);
                        return 1;
                }
                // Resolve the page path: allow "index" → "index.md",
                // "modules/foo" → "modules/foo.md", bare "foo" → "modules/foo.md".
                const candidates = [
                        join(dir, page),
                        join(dir, `${page}.md`),
                        join(dir, "modules", `${page}.md`),
                        join(dir, "modules", page),
                ];
                let resolved = "";
                for (const c of candidates) {
                        if (existsSync(c)) {
                                resolved = c;
                                break;
                        }
                }
                if (!resolved) {
                        process.stderr.write(`Page "${page}" not found in ${dir}.\n`);
                        return 1;
                }
                try {
                        const content = readFileSync(resolved, "utf8");
                        process.stdout.write(content);
                        if (!content.endsWith("\n")) process.stdout.write("\n");
                        return 0;
                } catch (err: any) {
                        process.stderr.write(`Could not read ${resolved}: ${err?.message ?? err}\n`);
                        return 1;
                }
        }

        process.stderr.write(`unown wiki: unknown subcommand "${sub}"\n\n${WIKI_USAGE}\n`);
        return 1;
}
