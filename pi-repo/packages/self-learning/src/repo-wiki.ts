/**
 * repo-wiki.ts — automatic repo documentation with file:line cross-links
 * (Milestone 4.2, the zcode Repo Wiki port).
 *
 * Reverse-engineered from zcode's Repo Wiki feature (per
 * /home/z/my-project/research/2-b2-report.md proposal #1, "Repo Wiki"):
 * a set of markdown pages auto-generated from the repo, each documenting
 * a module/area, with `file:line` cross-links to the actual code. The
 * wiki is regenerated on-demand (CLI / slash command) or on a schedule
 * (via the existing automations substrate — Round 3).
 *
 * Wiki structure (zcode's "JSON-of-Markdown-pages" shape):
 *   - index.md          — top-level overview (project, languages, frameworks,
 *                          entry points, main modules)
 *   - modules/<name>.md — one page per module: responsibilities, public API,
 *                          internal structure, key files (with file:line refs)
 *   - architecture.md   — high-level dependency graph (DOT + markdown list)
 *   - changes.md        — recent changes (extracted from CHANGELOG.md)
 *   - wiki.json         — manifest: { version, generatedAt, pages: [...] }
 *
 * Generation strategy (mirrors zcode's "parallel subagents" pattern):
 *   1. Index the repo: walk source files, group by directory → modules.
 *   2. For each module: spawn a parallel read-only `task` subagent (via
 *      `ctx.callSubagent`) with an `output_schema` that enforces the page
 *      structure (title, summary, public_api, key_files, depends_on).
 *   3. After all module pages are generated, synthesize index + architecture
 *      pages from the structured module metadata.
 *   4. Atomic write (tmp + rename) the whole wiki tree + manifest.
 *
 * Purity contract (mirrors `recipes.ts` / `blame.ts`):
 *   - `node:fs` + `node:path` only. NO pi imports, NO bus, NO store, NO spawn.
 *     The subagent runner is injected via `WikiRunContext.callSubagent` so
 *     the module is hermetically testable (mock `callSubagent` in tests).
 *   - `validateJsonSchema` is reused from `./jsonschema.ts` (the same
 *     validator the `task` tool's structured-output lane uses) so the wiki's
 *     output_schema validation is consistent with the rest of the system.
 *   - JSON extraction is duplicated locally (a small `extractJson` helper)
 *     rather than imported from `tools.ts` — `tools.ts` lives inside the pi
 *     runtime and importing it would pull in spawn/process dependencies.
 *     Same shape as `recipes.ts:extractJsonReply`.
 *   - Tolerant: missing wiki dir → empty search; a corrupt manifest is
 *     surfaced as an error, not a crash; partial module-page failures
 *     degrade gracefully (the rest are written; failures become "error pages").
 *
 * Composition:
 *   - `/wiki <sub>` slash command (registered in `tools.ts`) calls
 *     `generateWiki` / `searchWiki` against `.unown/wiki/` (project-scoped).
 *   - `unown wiki <sub>` CLI (in `wiki-cli.ts`) calls the same functions but
 *     uses a real subprocess-based `callSubagent` (spawns `unown --mode json`).
 *   - A scheduled automation can run `unown wiki generate` on cron — the
 *     automations substrate (Round 3) owns the scheduling.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep as pathSep } from "node:path";
import { atomicWriteFileSync } from "./atomic.ts";
import { validateJsonSchema } from "./jsonschema.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One entry in a module page's `publicApi` list. Mirrors the
 *  `output_schema.public_api` items the subagent emits. */
export interface PublicApiEntry {
	name: string;
	signature: string;
	file: string;
	line: number;
}

/** One entry in a module page's `keyFiles` list. */
export interface KeyFileEntry {
	path: string;
	role: string;
}

/** A complete wiki page. `content` is the rendered markdown (with file:line
 *  cross-links). The structured fields (publicApi, keyFiles, dependsOn) are
 *  kept so `generateIndexPage` / `generateArchitecturePage` can synthesize
 *  higher-level pages without re-parsing the markdown. */
export interface WikiPage {
	path: string;
	title: string;
	summary: string;
	publicApi?: PublicApiEntry[];
	keyFiles?: KeyFileEntry[];
	dependsOn?: string[];
	content: string;
}

/** The wiki manifest — written to `wiki.json`. Lists every page + its
 *  dependencies so the dashboard (or any renderer) can build a navigation
 *  graph without parsing markdown. `version: 1` pins the format. */
export interface WikiManifest {
	version: 1;
	generatedAt: number;
	pages: { path: string; title: string; dependsOn: string[] }[];
}

/** A discovered module — the directory it lives in + its source files
 *  (relative to the repo root). `name` is the slug used in the page path
 *  (`modules/<name>.md`); `displayName` is the human label. */
export interface ModuleInfo {
	name: string;
	displayName: string;
	relativePath: string;
	absolutePath: string;
	files: string[];
}

/** High-level project info — synthesized into the index page. */
export interface ProjectInfo {
	name: string | null;
	description: string | null;
	languages: string[];
	frameworks: string[];
	entryPoints: string[];
	dependencies: string[];
}

/** The injected subagent runner. `callSubagent` is the SAME shape as
 *  `RecipeRunContext.callSubagent` (recipes.ts) — options mirror what a
 *  subagent can override (model, effort, tools, response_schema). The wiki
 *  generator always passes `outputSchema: MODULE_PAGE_SCHEMA` so the
 *  subagent's reply is validated by the existing structured-output lane. */
export interface WikiRunContext {
	cwd: string;
	callSubagent: (
		task: string,
		opts?: {
			outputSchema?: object;
			tools?: string[];
			model?: string;
			effort?: string;
		},
	) => Promise<string>;
}

/** One search hit — `page` is the path relative to the wiki dir,
 *  `snippet` is a small excerpt around the first match. */
export interface SearchResult {
	page: string;
	title: string;
	snippet: string;
	score: number;
	matches: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default excluded top-level dirs — zcode's privacy filter (proposal Z31
 *  in 2-b2-report.md): `.git`, deps, build outputs, caches, local state. */
export const DEFAULT_EXCLUDES = [
	"node_modules",
	".git",
	"dist",
	"build",
	".unown",
	".cache",
	"coverage",
	"out",
	"target",
	".next",
	".vscode",
	".idea",
	".DS_Store",
	"__pycache__",
	".pytest_cache",
	".mypy_cache",
	".tox",
	".venv",
	"venv",
	"env",
];

export const DEFAULT_MAX_DEPTH = 4;

/** Source-file extensions we'll let a subagent read. Keeps the wiki focused
 *  on code (not config/markdown/assets). Mirrors the language coverage of
 *  `init-agents.ts`'s `detectLanguages`. */
const SOURCE_FILE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".vue",
	".svelte",
	".astro",
	".py",
	".rb",
	".go",
	".rs",
	".java",
	".kt",
	".swift",
	".c",
	".h",
	".cc",
	".cpp",
	".hpp",
	".cs",
	".php",
	".scala",
	".clj",
	".ex",
	".exs",
	".erl",
	".hs",
	".ml",
	".lua",
	".pl",
	".sh",
	".bash",
	".zsh",
	".fish",
	".ps1",
]);

/** The JSON Schema the subagent's reply must satisfy. Enforces the wiki
 *  page structure (title, summary, public_api[], key_files[], depends_on[])
 *  — this is the contract that lets `generateIndexPage` synthesize a
 *  cross-linked index without re-parsing markdown. */
export const MODULE_PAGE_SCHEMA = {
	type: "object",
	properties: {
		title: { type: "string" },
		summary: { type: "string" },
		public_api: {
			type: "array",
			items: {
				type: "object",
				properties: {
					name: { type: "string" },
					signature: { type: "string" },
					file: { type: "string" },
					line: { type: "number" },
				},
				required: ["name", "signature", "file", "line"],
			},
		},
		key_files: {
			type: "array",
			items: {
				type: "object",
				properties: {
					path: { type: "string" },
					role: { type: "string" },
				},
				required: ["path", "role"],
			},
		},
		depends_on: {
			type: "array",
			items: { type: "string" },
		},
	},
	required: ["title", "summary"],
} as const;

// ---------------------------------------------------------------------------
// discoverModules — walk the repo, group source files by directory
// ---------------------------------------------------------------------------

export interface DiscoverOptions {
	/** Additional directory names to exclude (merged with DEFAULT_EXCLUDES). */
	exclude?: string[];
	/** Max directory depth to walk (root is depth 0). */
	maxDepth?: number;
}

/** Walk the repo at `cwd` and group source files by directory. Each
 *  directory containing at least one source file becomes a ModuleInfo.
 *  Excludes DEFAULT_EXCLUDES + opts.exclude; respects opts.maxDepth.
 *  Pure: no side effects beyond fs reads. Returns [] for an empty repo or
 *  a missing path. */
export function discoverModules(cwd: string, opts: DiscoverOptions = {}): ModuleInfo[] {
	if (!existsSync(cwd)) return [];
	const exclude = new Set([...DEFAULT_EXCLUDES, ...(opts.exclude ?? [])]);
	const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;

	const modules = new Map<string, ModuleInfo>();

	function walk(dir: string, depth: number): void {
		if (depth > maxDepth) return;
		let entries: ReturnType<typeof readdirSync>;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		// Files at THIS directory level (don't recurse + claim files in
		// sub-dirs — those become their own modules).
		const filesHere: string[] = [];
		for (const e of entries) {
			if (!e.isFile()) continue;
			if (SOURCE_FILE_EXTENSIONS.has(extOf(e.name))) {
				filesHere.push(e.name);
			}
		}

		const isRoot = dir === cwd;
		if (!isRoot && filesHere.length > 0) {
			const rel = relative(cwd, dir).split(pathSep).join("/");
			const name = slugifyModule(rel);
			if (!modules.has(rel)) {
				modules.set(rel, {
					name,
					displayName: basename(rel),
					relativePath: rel,
					absolutePath: dir,
					files: filesHere.map((f) => `${rel}/${f}`),
				});
			}
		}

		// Recurse into sub-directories.
		for (const e of entries) {
			if (!e.isDirectory()) continue;
			if (exclude.has(e.name)) continue;
			// Skip hidden directories (starting with '.') — they are
			// config/build-output by convention; the user can pass
			// `exclude: []` to override.
			if (e.name.startsWith(".")) continue;
			walk(join(dir, e.name), depth + 1);
		}
	}

	walk(cwd, 0);

	// Sort by relative path for deterministic output.
	return [...modules.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function extOf(name: string): string {
	const i = name.lastIndexOf(".");
	return i === -1 ? "" : name.slice(i);
}

/** Convert a relative path (e.g. "src/auth") into a wiki page slug
 *  ("src--auth"). Slugs are filesystem-safe across platforms and don't
 *  collide with the manifest's `path` field. */
export function slugifyModule(rel: string): string {
	return rel.split("/").join("--").split(pathSep).join("--");
}

// ---------------------------------------------------------------------------
// generateModulePage — call a parallel read-only subagent for one module
// ---------------------------------------------------------------------------

/** Generate one module's wiki page by calling `ctx.callSubagent` with a
 *  prompt that asks for the structured page. The subagent's reply is
 *  validated against `MODULE_PAGE_SCHEMA`; on failure, an "error page"
 *  is returned (so a single bad module doesn't abort the whole wiki). */
export async function generateModulePage(module: ModuleInfo, ctx: WikiRunContext): Promise<WikiPage> {
	const pagePath = `modules/${module.name}.md`;
	const prompt = buildModulePrompt(module);

	try {
		const reply = await ctx.callSubagent(prompt, {
			outputSchema: MODULE_PAGE_SCHEMA as object,
			tools: ["read", "grep", "find", "ls"],
		});

		const extracted = extractJson(reply);
		if (!extracted.ok) {
			return errorPage(pagePath, module, `subagent did not return valid JSON: ${extracted.error}`);
		}

		// Validate the reply against the schema.
		try {
			const result = validateJsonSchema(extracted.data, MODULE_PAGE_SCHEMA);
			if (!result.valid) {
				const issues = result.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
				return errorPage(pagePath, module, `subagent reply failed schema validation: ${issues}`);
			}
		} catch (err: any) {
			// SchemaError — the SCHEMA is malformed (should never happen here).
			return errorPage(pagePath, module, `schema error: ${err?.message ?? String(err)}`);
		}

		const data = extracted.data as {
			title: string;
			summary: string;
			public_api?: Array<{ name: string; signature: string; file: string; line: number }>;
			key_files?: Array<{ path: string; role: string }>;
			depends_on?: string[];
		};

		const publicApi: PublicApiEntry[] | undefined = data.public_api?.map((p) => ({
			name: p.name,
			signature: p.signature,
			file: p.file,
			line: p.line,
		}));

		const keyFiles: KeyFileEntry[] | undefined = data.key_files?.map((k) => ({
			path: k.path,
			role: k.role,
		}));

		const dependsOn: string[] | undefined = data.depends_on;

		const content = renderModuleMarkdown(module, data);

		return {
			path: pagePath,
			title: data.title,
			summary: data.summary,
			publicApi,
			keyFiles,
			dependsOn,
			content,
		};
	} catch (err: any) {
		return errorPage(pagePath, module, `subagent call failed: ${err?.message ?? String(err)}`);
	}
}

function buildModulePrompt(module: ModuleInfo): string {
	const fileList = module.files.map((f) => `- ${f}`).join("\n");
	return (
		`You are generating a Wiki page for one code module.\n\n` +
		`Module directory: ${module.relativePath}\n` +
		`Files in this module (paths relative to the repo root):\n${fileList}\n\n` +
		`Read these files and write a wiki page that documents:\n` +
		`1. What the module is responsible for (its "responsibilities" — a one-paragraph summary).\n` +
		`2. Its public API — exported functions/classes/types with their signature and a file:line citation.\n` +
		`3. The key files in the module and their role.\n` +
		`4. What other modules this module depends on (by module path; e.g. "src/auth", "src/utils").\n\n` +
		`Every claim MUST cite a file:line (e.g. "src/auth/login.ts:42").\n\n` +
		`Reply with ONLY a JSON object matching this schema (no prose, no markdown fences):\n\n` +
		`${JSON.stringify(MODULE_PAGE_SCHEMA, null, 2)}\n\n` +
		`The JSON MUST contain "title" and "summary"; "public_api", "key_files", "depends_on" are optional but recommended.`
	);
}

/** Build an error page for a module whose subagent call failed. The page is
 *  still written so the wiki is complete — the human can re-run or fix
 *  manually. Mirrors zcode's "one generation task per repo at a time; partial
 *  failures don't abort the wiki" semantics (Z33). */
function errorPage(pagePath: string, module: ModuleInfo, error: string): WikiPage {
	return {
		path: pagePath,
		title: module.displayName,
		summary: `(wiki page generation failed: ${error})`,
		content:
			`# ${module.displayName}\n\n` +
			`> ⚠️ Wiki page generation failed: ${error}\n\n` +
			`**Module**: \`${module.relativePath}\`\n\n` +
			`## Files\n\n${module.files.map((f) => `- ${f}`).join("\n")}\n`,
	};
}

/** Render the structured module-page data into markdown. Every public API
 *  entry is rendered with a `file:line` citation (clickable in any editor
 *  that understands the `path:line` convention). Cross-module links use
 *  relative paths so the wiki is portable. */
function renderModuleMarkdown(
	module: ModuleInfo,
	data: {
		title: string;
		summary: string;
		public_api?: Array<{ name: string; signature: string; file: string; line: number }>;
		key_files?: Array<{ path: string; role: string }>;
		depends_on?: string[];
	},
): string {
	const lines: string[] = [];
	lines.push(`# ${data.title}`);
	lines.push("");
	lines.push("> Auto-generated by `unown wiki generate` — every claim cites `file:line`.");
	lines.push("");
	lines.push(`**Module**: \`${module.relativePath}\``);
	lines.push("");
	lines.push("## Summary");
	lines.push("");
	lines.push(data.summary);
	lines.push("");

	if (data.public_api && data.public_api.length > 0) {
		lines.push("## Public API");
		lines.push("");
		for (const api of data.public_api) {
			lines.push(`### \`${api.name}\``);
			lines.push("");
			lines.push("```");
			lines.push(api.signature);
			lines.push("```");
			lines.push("");
			lines.push(`Defined at \`${api.file}:${api.line}\`.`);
			lines.push("");
		}
	}

	if (data.key_files && data.key_files.length > 0) {
		lines.push("## Key Files");
		lines.push("");
		for (const kf of data.key_files) {
			lines.push(`- \`${kf.path}\` — ${kf.role}`);
		}
		lines.push("");
	}

	if (data.depends_on && data.depends_on.length > 0) {
		lines.push("## Depends On");
		lines.push("");
		for (const dep of data.depends_on) {
			const slug = slugifyModule(dep);
			lines.push(`- [\`${dep}\`](./${slug}.md)`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// generateIndexPage — pure synthesizer
// ---------------------------------------------------------------------------

/** Synthesize the top-level index page from module pages + project info.
 *  Pure: no I/O. Links to every module page + the architecture/changes
 *  pages. */
export function generateIndexPage(pages: WikiPage[], projectInfo: ProjectInfo): WikiPage {
	const modulePages = pages.filter((p) => p.path.startsWith("modules/"));

	const lines: string[] = [];
	lines.push(`# ${projectInfo.name ?? "Project"} — Repo Wiki`);
	lines.push("");
	lines.push("> Auto-generated by `unown wiki generate`. Click any module name to navigate.");
	lines.push("");

	if (projectInfo.description) {
		lines.push(projectInfo.description);
		lines.push("");
	}

	lines.push("## Project");
	lines.push("");
	lines.push(`- **Name**: ${projectInfo.name ?? "(unknown)"}`);
	if (projectInfo.languages.length > 0) {
		lines.push(`- **Languages**: ${projectInfo.languages.join(", ")}`);
	}
	if (projectInfo.frameworks.length > 0) {
		lines.push(`- **Frameworks**: ${projectInfo.frameworks.join(", ")}`);
	}
	if (projectInfo.dependencies.length > 0) {
		lines.push(`- **Top dependencies**: ${projectInfo.dependencies.slice(0, 12).join(", ")}`);
	}
	if (projectInfo.entryPoints.length > 0) {
		lines.push(`- **Entry points**: ${projectInfo.entryPoints.map((e) => `\`${e}\``).join(", ")}`);
	}
	lines.push("");

	lines.push("## Modules");
	lines.push("");
	if (modulePages.length === 0) {
		lines.push("_(no modules discovered — see `unown wiki generate --help` for discovery options)_");
	} else {
		for (const page of modulePages) {
			const slug = page.path.replace(/^modules\//, "").replace(/\.md$/, "");
			lines.push(`- [${page.title}](./modules/${slug}.md) — ${page.summary}`);
		}
	}
	lines.push("");

	lines.push("## Architecture");
	lines.push("");
	lines.push("See [architecture.md](./architecture.md) for the dependency graph.");
	lines.push("");

	lines.push("## Recent Changes");
	lines.push("");
	lines.push("See [changes.md](./changes.md) for the recent change log.");
	lines.push("");

	return {
		path: "index.md",
		title: `${projectInfo.name ?? "Project"} — Repo Wiki`,
		summary: "Top-level wiki index.",
		content: lines.join("\n"),
	};
}

// ---------------------------------------------------------------------------
// generateArchitecturePage — pure synthesizer + cycle detection
// ---------------------------------------------------------------------------

/** Build the architecture page: a DOT graph + a markdown dependency list,
 *  plus a "Cycles Detected" section if the graph has any cycles.
 *  Pure: no I/O. */
export function generateArchitecturePage(pages: WikiPage[], projectInfo: ProjectInfo): WikiPage {
	const modulePages = pages.filter((p) => p.path.startsWith("modules/"));

	// Build edges: a page depends on another when its `dependsOn` list
	// contains a string that resolves to another module (by title, slug,
	// or path component). The edge direction is "page → dependency".
	const edges: { from: string; to: string }[] = [];
	for (const p of modulePages) {
		if (!p.dependsOn) continue;
		for (const dep of p.dependsOn) {
			const target = findDepPage(dep, modulePages);
			if (target) {
				edges.push({ from: p.title, to: target.title });
			}
		}
	}

	const cycles = detectCycles(
		modulePages.map((p) => p.title),
		edges,
	);

	// DOT graph (Graphviz).
	const dotLines: string[] = ["digraph Architecture {"];
	dotLines.push("  rankdir=LR;");
	for (const p of modulePages) {
		const id = dotId(p.title);
		dotLines.push(`  ${id} [label="${escapeDot(p.title)}"];`);
	}
	for (const e of edges) {
		dotLines.push(`  ${dotId(e.from)} -> ${dotId(e.to)};`);
	}
	dotLines.push("}");

	const lines: string[] = [];
	lines.push(`# Architecture — ${projectInfo.name ?? "Project"}`);
	lines.push("");
	lines.push("> Auto-generated by `unown wiki generate`.");
	lines.push("");
	lines.push("## Dependency Graph (DOT)");
	lines.push("");
	lines.push("```dot");
	lines.push(dotLines.join("\n"));
	lines.push("```");
	lines.push("");
	lines.push("## Dependency List");
	lines.push("");
	if (modulePages.length === 0) {
		lines.push("_(no modules discovered)_");
	} else {
		for (const p of modulePages) {
			const deps = (p.dependsOn ?? [])
				.map((d) => findDepPage(d, modulePages))
				.filter((x): x is WikiPage => x !== undefined);
			if (deps.length > 0) {
				lines.push(`- **${p.title}** → ${deps.map((d) => d.title).join(", ")}`);
			} else {
				lines.push(`- **${p.title}** — (no module-local dependencies)`);
			}
		}
	}
	lines.push("");

	if (cycles.length > 0) {
		lines.push("## Cycles Detected");
		lines.push("");
		lines.push("> ⚠️ The dependency graph contains cycles. They are listed below — investigate before merging.");
		lines.push("");
		for (const c of cycles) {
			lines.push(`- ${c.join(" → ")}`);
		}
		lines.push("");
	}

	return {
		path: "architecture.md",
		title: `Architecture — ${projectInfo.name ?? "Project"}`,
		summary: "Dependency graph + module relationships.",
		content: lines.join("\n"),
	};
}

/** Find the page a `dependsOn` string refers to. Tries exact title match,
 *  slug match, and a case-insensitive contains match (in that order). */
function findDepPage(dep: string, pages: WikiPage[]): WikiPage | undefined {
	// 1. exact title.
	let found = pages.find((p) => p.title === dep);
	if (found) return found;
	// 2. slug match — the dependsOn string is a module path; slugify both.
	const slug = slugifyModule(dep);
	found = pages.find((p) => slugifyModule(p.title) === slug);
	if (found) return found;
	// 3. page-path match — `modules/<slug>.md`.
	found = pages.find((p) => p.path === `modules/${slug}.md`);
	if (found) return found;
	// 4. case-insensitive contains — last resort.
	found = pages.find((p) => p.title.toLowerCase().includes(dep.toLowerCase()) || dep.toLowerCase().includes(p.title.toLowerCase()));
	return found;
}

function dotId(name: string): string {
	return "m_" + name.replace(/[^a-zA-Z0-9_]/g, "_");
}

function escapeDot(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Detect cycles in a directed graph via DFS. Returns each cycle as the
 *  list of node titles in the cycle (with the first node repeated at the
 *  end to make the cycle explicit). Dedupes by sorted-node-set so the same
 *  cycle discovered from different starting points is reported once. */
function detectCycles(nodes: string[], edges: { from: string; to: string }[]): string[][] {
	const adj = new Map<string, string[]>();
	for (const n of nodes) adj.set(n, []);
	for (const e of edges) {
		if (!adj.has(e.from)) adj.set(e.from, []);
		if (!adj.has(e.to)) adj.set(e.to, []);
		adj.get(e.from)!.push(e.to);
	}

	const WHITE = 0;
	const GRAY = 1;
	const BLACK = 2;
	const color = new Map<string, number>();
	for (const n of nodes) color.set(n, WHITE);
	const cycles: string[][] = [];
	const stack: string[] = [];

	function visit(u: string): void {
		color.set(u, GRAY);
		stack.push(u);
		for (const v of adj.get(u) ?? []) {
			const c = color.get(v) ?? WHITE;
			if (c === GRAY) {
				const start = stack.indexOf(v);
				if (start >= 0) {
					cycles.push([...stack.slice(start), v]);
				}
			} else if (c === WHITE) {
				visit(v);
			}
		}
		stack.pop();
		color.set(u, BLACK);
	}

	for (const n of nodes) {
		if (color.get(n) === WHITE) visit(n);
	}

	// Dedupe cycles by sorted node set.
	const seen = new Set<string>();
	const unique: string[][] = [];
	for (const c of cycles) {
		const key = [...c].sort().join("|");
		if (!seen.has(key)) {
			seen.add(key);
			unique.push(c);
		}
	}
	return unique;
}

// ---------------------------------------------------------------------------
// writeWiki — atomic write (tmp + rename per file + manifest)
// ---------------------------------------------------------------------------

export interface WriteWikiOptions {
	/** Overwrite an existing wiki dir without confirmation. Mirrors
	 *  zcode's "regenerate" button. */
	force?: boolean;
}

/** Atomically write the whole wiki tree to `wikiDir`. Each page is written
 *  via `atomicWriteFileSync` (tmp + rename + fsync); the manifest is written
 *  last so a crash mid-write never leaves a manifest pointing at missing
 *  pages. Refuses to overwrite an existing wiki unless `opts.force` is set
 *  (the same "regenerate" semantics zcode exposes — Z33). */
export async function writeWiki(
	wikiDir: string,
	pages: WikiPage[],
	manifest: WikiManifest,
	opts: WriteWikiOptions = {},
): Promise<void> {
	// Refuse to overwrite an existing wiki unless --force is set.
	if (existsSync(wikiDir)) {
		const existingManifest = join(wikiDir, "wiki.json");
		if (existsSync(existingManifest) && !opts.force) {
			throw new Error(
				`wiki already exists at ${wikiDir} — pass --force (or remove the dir) to regenerate`,
			);
		}
	}

	mkdirSync(wikiDir, { recursive: true });

	// Write each page (atomic — tmp + rename).
	for (const page of pages) {
		const fullPath = join(wikiDir, page.path);
		atomicWriteFileSync(fullPath, page.content);
	}

	// Write the manifest last (atomic).
	atomicWriteFileSync(join(wikiDir, "wiki.json"), JSON.stringify(manifest, null, 2));
}

// ---------------------------------------------------------------------------
// gatherProjectInfo — cheap repo forensics (no subagent)
// ---------------------------------------------------------------------------

/** Gather high-level project info from manifest files. Pure: no spawn, no
 *  subagent — just reads `package.json`, `Cargo.toml`, `go.mod`,
 *  `pyproject.toml`, `requirements.txt`. The index page uses this to print
 *  the project name + language/framework summary. */
export function gatherProjectInfo(cwd: string): ProjectInfo {
	const info: ProjectInfo = {
		name: null,
		description: null,
		languages: [],
		frameworks: [],
		entryPoints: [],
		dependencies: [],
	};

	const pkgPath = join(cwd, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
			info.name = typeof pkg.name === "string" ? pkg.name : null;
			info.description = typeof pkg.description === "string" ? pkg.description : null;
			const deps = (pkg.dependencies ?? {}) as Record<string, string>;
			const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
			info.dependencies = [...Object.keys(deps), ...Object.keys(devDeps)];
			// Entry points: main, module, bin entries.
			const entries: string[] = [];
			if (typeof pkg.main === "string") entries.push(pkg.main);
			if (typeof pkg.module === "string") entries.push(pkg.module);
			if (typeof pkg.bin === "string") entries.push(pkg.bin);
			else if (pkg.bin && typeof pkg.bin === "object") {
				for (const v of Object.values(pkg.bin)) {
					if (typeof v === "string") entries.push(v);
				}
			}
			info.entryPoints = entries;
			// Languages
			const hasTsconfig = existsSync(join(cwd, "tsconfig.json"));
			if (devDeps.typescript || deps.typescript || hasTsconfig) {
				info.languages.push("TypeScript");
			} else {
				info.languages.push("JavaScript");
			}
			// Frameworks — quick scan (a subset of init-agents.ts).
			const all = { ...deps, ...devDeps };
			const fwMap: Record<string, string> = {
				next: "Next.js",
				nuxt: "Nuxt",
				"@remix-run/react": "Remix",
				"@nestjs/core": "NestJS",
				"@angular/core": "Angular",
				react: "React",
				"react-dom": "React",
				vue: "Vue",
				svelte: "Svelte",
				astro: "Astro",
				express: "Express",
				fastify: "Fastify",
				hono: "Hono",
				koa: "Koa",
				electron: "Electron",
			};
			for (const [k, label] of Object.entries(fwMap)) {
				if (k in all) info.frameworks.push(label);
			}
		} catch {
			/* tolerant */
		}
	} else {
		// Non-JS projects — manifest-driven language detection only.
		if (existsSync(join(cwd, "Cargo.toml"))) info.languages.push("Rust");
		if (existsSync(join(cwd, "go.mod"))) info.languages.push("Go");
		if (
			existsSync(join(cwd, "pyproject.toml")) ||
			existsSync(join(cwd, "requirements.txt")) ||
			existsSync(join(cwd, "setup.py"))
		) {
			info.languages.push("Python");
		}
		if (existsSync(join(cwd, "Gemfile"))) info.languages.push("Ruby");
		if (existsSync(join(cwd, "mix.exs"))) info.languages.push("Elixir");
	}

	// Project name fallback to directory basename.
	if (!info.name) info.name = basename(cwd);

	return info;
}

// ---------------------------------------------------------------------------
// generateChangesPage — extract from CHANGELOG.md (best-effort)
// ---------------------------------------------------------------------------

/** Build the `changes.md` page from CHANGELOG.md (if present). Pure read. */
export function generateChangesPage(cwd: string): WikiPage {
	const changelogPath = join(cwd, "CHANGELOG.md");
	let body = "";
	if (existsSync(changelogPath)) {
		try {
			const raw = readFileSync(changelogPath, "utf8");
			// Cap at 6 KB so a huge changelog doesn't bloat the wiki.
			body = raw.length > 6 * 1024 ? raw.slice(0, 6 * 1024) + "\n\n…[truncated — see CHANGELOG.md for the full history]" : raw;
		} catch {
			body = "_(could not read CHANGELOG.md)_";
		}
	} else {
		body = "_(no CHANGELOG.md found — add one to populate this page)_";
	}

	return {
		path: "changes.md",
		title: "Recent Changes",
		summary: "Auto-extracted from CHANGELOG.md.",
		content: `# Recent Changes\n\n> Auto-extracted by \`unown wiki generate\`.\n\n${body}\n`,
	};
}

// ---------------------------------------------------------------------------
// generateWiki — top-level orchestrator
// ---------------------------------------------------------------------------

export interface GenerateWikiOptions {
	/** Overwrite an existing wiki without confirmation. */
	force?: boolean;
	/** Extra exclude dirs (merged with DEFAULT_EXCLUDES). */
	exclude?: string[];
	/** Max directory depth for module discovery. */
	maxDepth?: number;
}

/**
 * Bounded-concurrency map: runs `fn` over `items` with at most `limit`
 * workers. Used for the module-page subagent fan-out so memory-scarce
 * machines don't spawn one process per module at once.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
		while (true) {
			const i = next++;
			if (i >= items.length) break;
			results[i] = await fn(items[i]);
		}
	});
	await Promise.all(workers);
	return results;
}

/** Max concurrent module-page subagents (UNOWN_WIKI_CONCURRENCY, default 3, clamped 1..8). */
export function wikiConcurrency(): number {
	const raw = Number.parseInt(process.env.UNOWN_WIKI_CONCURRENCY ?? "", 10);
	return Number.isFinite(raw) && raw >= 1 && raw <= 8 ? raw : 3;
}

/** The top-level orchestrator: discovers modules, runs the per-module
 *  subagents in parallel (Promise.all), generates the index + architecture
 *  pages, and writes the whole wiki atomically. Partial failures are
 *  tolerated — failed module pages become "error pages" but the rest of
 *  the wiki is still written. Returns the pages + manifest + a list of
 *  module-relative error messages. */
export async function generateWiki(
	cwd: string,
	wikiDir: string,
	ctx: WikiRunContext,
	opts: GenerateWikiOptions = {},
): Promise<{ pages: WikiPage[]; manifest: WikiManifest; errors: string[] }> {
	const errors: string[] = [];

	// 1. Discover modules.
	const modules = discoverModules(cwd, { exclude: opts.exclude, maxDepth: opts.maxDepth });

	// 2. Spawn parallel subagents — bounded concurrency so memory-scarce
	//    machines don't OOM (UNOWN_WIKI_CONCURRENCY, default 3).
	const modulePages = await mapLimit(modules, wikiConcurrency(), (m) => generateModulePage(m, ctx));

	// Track partial failures (subagent returned an error page).
	for (let i = 0; i < modulePages.length; i++) {
		const page = modulePages[i];
		if (page.summary.startsWith("(wiki page generation failed")) {
			errors.push(`${modules[i].relativePath}: ${page.summary}`);
		}
	}

	// 3. Gather project info (cheap — no subagent).
	const projectInfo = gatherProjectInfo(cwd);

	// 4. Synthesize index + architecture + changes pages.
	const indexPage = generateIndexPage(modulePages, projectInfo);
	const architecturePage = generateArchitecturePage(modulePages, projectInfo);
	const changesPage = generateChangesPage(cwd);

	const allPages: WikiPage[] = [indexPage, architecturePage, changesPage, ...modulePages];

	// 5. Build manifest.
	const manifest: WikiManifest = {
		version: 1,
		generatedAt: Date.now(),
		pages: allPages.map((p) => ({
			path: p.path,
			title: p.title,
			dependsOn: p.dependsOn ?? [],
		})),
	};

	// 6. Write atomically. `force: true` because the orchestrator owns the
	//    regenerate decision (the caller can opt out via opts.force = false
	//    by handling the throw themselves — but the default CLI passes
	//    --force on `generate`).
	await writeWiki(wikiDir, allPages, manifest, { force: opts.force ?? true });

	return { pages: allPages, manifest, errors };
}

// ---------------------------------------------------------------------------
// searchWiki — simple text search over the wiki pages
// ---------------------------------------------------------------------------

/** Simple text search over the wiki pages. Returns ranked results (best
 *  first). Each query term is matched case-insensitively; the score is
 *  2 × (term occurrences) + 5 if the title contains the whole query.
 *  Handles a missing wiki dir gracefully (returns []). */
export async function searchWiki(wikiDir: string, query: string): Promise<SearchResult[]> {
	if (!existsSync(wikiDir)) return [];
	const q = query.trim();
	if (!q) return [];

	const lower = q.toLowerCase();
	const terms = lower.split(/\s+/).filter((t) => t.length > 0);

	// Walk the wiki dir, read each .md file, score it.
	const files: string[] = [];
	function walk(dir: string): void {
		let entries: ReturnType<typeof readdirSync>;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const full = join(dir, e.name);
			if (e.isDirectory()) walk(full);
			else if (e.isFile() && e.name.endsWith(".md")) files.push(full);
		}
	}
	walk(wikiDir);

	const results: SearchResult[] = [];
	for (const file of files) {
		let content = "";
		try {
			content = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		const lowerContent = content.toLowerCase();

		// Score: count term occurrences (each occurrence adds 2 to the
		// score). Title-line bonus: +5 if the whole query appears in the
		// H1 title.
		let score = 0;
		let matches = 0;
		for (const term of terms) {
			const occurrences = countOccurrences(lowerContent, term);
			matches += occurrences;
			score += occurrences * 2;
		}

		const titleLine = content.split("\n")[0] ?? "";
		const lowerTitle = titleLine.toLowerCase();
		if (lowerTitle.includes(lower)) score += 5;

		if (matches > 0) {
			const relPath = relative(wikiDir, file).split(pathSep).join("/");
			const title = titleLine.replace(/^#\s*/, "") || relPath;
			const snippet = makeSnippet(content, terms[0]);
			results.push({ page: relPath, title, snippet, score, matches });
		}
	}

	results.sort((a, b) => b.score - a.score || b.matches - a.matches);
	return results;
}

function countOccurrences(haystack: string, needle: string): number {
	if (!needle) return 0;
	let n = 0;
	let i = 0;
	while ((i = haystack.indexOf(needle, i)) !== -1) {
		n++;
		i += needle.length;
	}
	return n;
}

function makeSnippet(content: string, term: string, radius = 80): string {
	if (!term) {
		return content.split("\n").slice(0, 3).join(" ").slice(0, 200);
	}
	const lower = content.toLowerCase();
	const idx = lower.indexOf(term);
	if (idx === -1) {
		return content.split("\n").slice(0, 3).join(" ").slice(0, 200);
	}
	const start = Math.max(0, idx - radius);
	const end = Math.min(content.length, idx + term.length + radius);
	const prefix = start > 0 ? "…" : "";
	const suffix = end < content.length ? "…" : "";
	return prefix + content.slice(start, end).replace(/\s+/g, " ").trim() + suffix;
}

// ---------------------------------------------------------------------------
// JSON extraction — mirrors tools.ts:extractJsonReply but kept local so
// repo-wiki.ts has zero pi imports (same posture as recipes.ts).
// ---------------------------------------------------------------------------

function extractJson(text: string): { ok: true; data: unknown } | { ok: false; error: string } {
	const trimmed = text.trim();
	if (!trimmed) return { ok: false, error: "empty reply" };

	// 1. fenced block (```json … ``` or ``` … ```).
	const fence = trimmed.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/);
	const candidates: string[] = [];
	if (fence?.[1]) candidates.push(fence[1].trim());

	// 2. the whole reply.
	candidates.push(trimmed);

	// 3. first balanced {...} or [...] inside the reply.
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
