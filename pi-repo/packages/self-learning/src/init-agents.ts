/**
 * init-agents.ts — `/init` AGENTS.md generator (Milestone 3.1).
 *
 * Reverse-engineered from opencode's `plugin/command/initialize.txt` and
 * Claude Code's `/init` skill. When run, the agent scans the repo and produces
 * an `AGENTS.md` markdown file (or extends the existing one) following the
 * agents.md spec (https://agents.md/).
 *
 * The generator is PURE: `generateAgentsMd(cwd)` returns a markdown string
 * and never writes a file. The caller (cli.ts `cmdInit`, the `/init-agents`
 * slash command, or a test) decides whether to write, print, or diff.
 *
 * Purity contract:
 *   - `node:fs` + `node:path` only (no pi imports, no bus, no store).
 *   - Tolerant: missing files, corrupt JSON, broken TOML — never throws. Each
 *     parse failure is recorded as a `detectionNote` and the generator keeps
 *     going with whatever it could read.
 *
 * Detection surface:
 *   - Project name + description (package.json, README.md, pyproject.toml,
 *     Cargo.toml, go.mod)
 *   - Language detection (TypeScript/JavaScript/Python/Go/Rust/Java/etc.)
 *   - Framework detection (Next.js/Express/React/Django/FastAPI/etc.)
 *   - Test runner (vitest/jest/playwright/pytest/go test/cargo test)
 *   - Lint config (eslint/biome/ruff/golangci)
 *   - Build commands (npm/bun/cargo/make/etc.)
 *   - Dependency graph summary (top-level packages)
 *   - File structure summary (top directories + their roles)
 *   - Suggested conventions (file naming, import style, etc.)
 *
 * Composition: `unown init` invokes the generator AND prompts before
 * overwriting an existing AGENTS.md. `/init-agents` (slash command) runs the
 * same generator and shows the result inline (no file write).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Detected language — ordered most-specific first (TS before JS, etc.). */
export interface DetectedLanguage {
        name: string;
        source: string;
}

/** Detected framework — `name` is the framework, `source` is the file/key. */
export interface DetectedFramework {
        name: string;
        source: string;
}

/** One top-level directory + an inferred role. */
export interface DirectoryRole {
        dir: string;
        role: string;
}

/** Structured forensics — the intermediate result between scan + render. */
export interface RepoForensics {
        projectName: string | null;
        projectDescription: string | null;
        languages: DetectedLanguage[];
        frameworks: DetectedFramework[];
        testRunner: string | null;
        lintConfig: string | null;
        packageManager: string | null;
        buildCommands: string[];
        topDependencies: string[];
        fileStructure: DirectoryRole[];
        conventions: string[];
        /** Tolerant-parse notes — surfaced in the markdown so the human can fix. */
        detectionNotes: string[];
}

export interface GenerateAgentsMdOptions {
        /** Override the repo root (default: cwd). */
        cwd?: string;
}

// ---------------------------------------------------------------------------
// Small tolerant readers
// ---------------------------------------------------------------------------

/**
 * Read `path` as UTF-8 text. Returns null when missing or unreadable so the
 * caller can fall back gracefully without try/catch noise at every site.
 */
function readText(p: string): string | null {
        if (!existsSync(p)) return null;
        try {
                return readFileSync(p, "utf8");
        } catch {
                return null;
        }
}

/**
 * Parse JSON tolerantly. Returns null on syntax error (never throws). Used for
 * package.json, biome.json, deno.json — these are attacker-readable but not
 * attacker-controlled in the trust sense, and a syntax error must not break
 * the generator (the file is just skipped with a note).
 */
function readJson(p: string): unknown | null {
        const txt = readText(p);
        if (txt === null) return null;
        try {
                return JSON.parse(txt);
        } catch {
                return { __parseError: true as const };
        }
}

/**
 * Parse TOML tolerantly. Uses Bun.TOML when available (every modern Bun
 * ships it); falls back to a regex parse for the rare older runtime. Never
 * throws — a parse failure returns `null` and the caller surfaces a note.
 */
function readToml(p: string): Record<string, unknown> | null {
        const txt = readText(p);
        if (txt === null) return null;
        try {
                // @ts-expect-error — Bun.TOML is a runtime global on Bun, not in the type defs.
                const parser = globalThis.Bun?.TOML;
                if (parser && typeof parser.parse === "function") {
                        const out = parser.parse(txt);
                        if (out && typeof out === "object") return out as Record<string, unknown>;
                }
        } catch {
                // fall through to manual parse
        }
        return manualTomlParse(txt);
}

/**
 * Hand-rolled TOML reader for the structures we care about: `[section]`
 * headers and `key = "value"` / `key = ["a","b"]` / `key = 1.2` lines. Good
 * enough for pyproject.toml, Cargo.toml, go.mod-ish files; not a spec
 * implementation. Returns null on any anomaly.
 */
function manualTomlParse(txt: string): Record<string, unknown> | null {
        const root: Record<string, unknown> = {};
        let current: Record<string, unknown> = root;
        try {
                for (const rawLine of txt.split(/\r?\n/)) {
                        const line = rawLine.trim();
                        if (!line || line.startsWith("#")) continue;
                        const section = line.match(/^\[([^\]]+)\]$/);
                        if (section) {
                                const path = section[1].split(".").map((s) => s.trim());
                                let node: Record<string, unknown> = root;
                                for (const part of path) {
                                        if (typeof node[part] !== "object" || node[part] === null || Array.isArray(node[part])) {
                                                node[part] = {};
                                        }
                                        node = node[part] as Record<string, unknown>;
                                }
                                current = node;
                                continue;
                        }
                        const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
                        if (!kv) continue;
                        const [, key, rawVal] = kv;
                        current[key] = parseTomlValue(rawVal);
                }
                return root;
        } catch {
                return null;
        }
}

function parseTomlValue(rawVal: string): unknown {
        const v = rawVal.trim();
        // strip trailing inline comment
        const str = v.match(/^"((?:[^"\\]|\\.)*)"$/);
        if (str) return str[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        if (v.startsWith("[") && v.endsWith("]")) {
                const inner = v.slice(1, -1).trim();
                if (!inner) return [];
                return inner
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                        .map((s) => {
                                const m = s.match(/^"((?:[^"\\]|\\.)*)"$/);
                                return m ? m[1] : s.replace(/^"|"$/g, "");
                        });
        }
        if (v === "true") return true;
        if (v === "false") return false;
        const num = Number(v);
        if (!Number.isNaN(num) && v !== "") return num;
        return v.replace(/^"|"$/g, "");
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Known top-level dir → role mapping. Order: source dirs first. */
const DIR_ROLES: Record<string, string> = {
        src: "source code",
        lib: "library code",
        app: "application entry (frontend or backend)",
        apps: "monorepo application workspaces",
        packages: "monorepo package workspaces",
        test: "tests",
        tests: "tests",
        __tests__: "tests (Jest convention)",
        spec: "spec tests",
        e2e: "end-to-end tests",
        docs: "documentation",
        doc: "documentation",
        scripts: "build/dev/release scripts",
        bin: "executable entrypoints",
        cli: "CLI source",
        server: "server source",
        web: "web frontend",
        client: "client code",
        api: "API definitions",
        config: "configuration",
        configs: "configuration",
        public: "static public assets",
        static: "static assets",
        assets: "static assets",
        templates: "template files",
        views: "view templates",
        components: "UI components",
        pages: "page entrypoints (Next.js/Nuxt/etc.)",
        migrations: "database migrations",
        migration: "database migrations",
        db: "database schemas/seeds",
        prisma: "Prisma schema",
        schema: "schema definitions",
        schemas: "schema definitions",
        vendor: "vendored dependencies",
        examples: "example code",
        benchmarks: "benchmarks",
        bench: "benchmarks",
        build: "build output (generated — gitignored)",
        dist: "build output (generated — gitignored)",
        out: "build output (generated — gitignored)",
        target: "Rust build output (generated — gitignored)",
        "node_modules": "npm dependencies (generated)",
        "coverage": "test coverage reports (generated)",
        ".unown": "unown memory scaffold + skills + receipts",
        ".github": "GitHub Actions workflows",
        ".gitlab": "GitLab CI configuration",
        ".vscode": "VSCode workspace settings",
        ".idea": "JetBrains project files",
};

/** Directories the generator never reports (noise / VCS metadata). */
const HIDDEN_IGNORED = new Set([".git", ".hg", ".svn", ".DS_Store"]);

/** JS frameworks keyed by the dependency name (presence implies the framework). */
const JS_FRAMEWORKS: Record<string, string> = {
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
        "solid-js": "SolidJS",
        preact: "Preact",
        express: "Express",
        fastify: "Fastify",
        hono: "Hono",
        koa: "Koa",
        "@hono/node-server": "Hono",
        electron: "Electron",
        "@tauri-apps/api": "Tauri",
        "vite-plugin-react": "Vite + React",
        "@vitejs/plugin-vue": "Vite + Vue",
        "@sveltejs/kit": "SvelteKit",
        "gatsby": "Gatsby",
        "remix": "Remix",
        "@trpc/server": "tRPC",
        "drizzle-orm": "Drizzle ORM",
        "@prisma/client": "Prisma",
};

/** Python frameworks keyed by the dep name (presence implies the framework). */
const PY_FRAMEWORKS: Record<string, string> = {
        django: "Django",
        fastapi: "FastAPI",
        flask: "Flask",
        starlette: "Starlette",
        sanic: "Sanic",
        tornado: "Tornado",
        aiohttp: "aiohttp",
        "pydantic": "Pydantic",
        "sqlalchemy": "SQLAlchemy",
        "torch": "PyTorch",
        "tensorflow": "TensorFlow",
        "transformers": "HuggingFace Transformers",
        "scikit-learn": "scikit-learn",
        "pandas": "pandas",
        "numpy": "NumPy",
        celery: "Celery",
        rq: "Redis Queue (rq)",
};

/** Rust frameworks keyed by the dep name. */
const RS_FRAMEWORKS: Record<string, string> = {
        "actix-web": "Actix Web",
        axum: "Axum",
        rocket: "Rocket",
        warp: "Warp",
        tokio: "Tokio (async runtime)",
        serde: "serde (serialization)",
        "sqlx": "SQLx",
        "diesel": "Diesel ORM",
        "sea-orm": "SeaORM",
        tauri: "Tauri",
};

/** Go frameworks keyed by the import path prefix. */
const GO_FRAMEWORKS: Array<{ re: RegExp; name: string }> = [
        { re: /github\.com\/gin-gonic\/gin/, name: "Gin" },
        { re: /github\.com\/labstack\/echo/, name: "Echo" },
        { re: /github\.com\/gofiber\/fiber/, name: "Fiber" },
        { re: /github\.com\/go-chi\/chi/, name: "Chi" },
        { re: /github\.com\/gorilla\/mux/, name: "Gorilla Mux" },
        { re: /gorm\.io\/gorm/, name: "GORM" },
        { re: /github\.com\/spf13\/cobra/, name: "Cobra (CLI)" },
        { re: /github\.com\/spf13\/viper/, name: "Viper (config)" },
];

/** JS test runners keyed by dep name. */
const JS_TEST_RUNNERS: Record<string, string> = {
        vitest: "vitest",
        jest: "jest",
        mocha: "mocha",
        "@playwright/test": "Playwright",
        cypress: "Cypress",
        "@testing-library/react": "Testing Library",
        "vitest-github-actions-reporter": "vitest",
};

/**
 * Detect languages from the manifest presence + content. Order matters:
 * TypeScript (when tsconfig.json + package.json with `typescript` dep) is
 * reported BEFORE plain JavaScript so the more specific detection wins.
 */
function detectLanguages(cwd: string, notes: string[]): DetectedLanguage[] {
        const out: DetectedLanguage[] = [];
        const hasPkg = existsSync(join(cwd, "package.json"));
        const hasTsconfig = existsSync(join(cwd, "tsconfig.json"));
        const hasDeno = existsSync(join(cwd, "deno.json")) || existsSync(join(cwd, "deno.jsonc"));
        const hasPy = existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "requirements.txt")) || existsSync(join(cwd, "setup.py"));
        const hasCargo = existsSync(join(cwd, "Cargo.toml"));
        const hasGoMod = existsSync(join(cwd, "go.mod"));
        const hasGradle = existsSync(join(cwd, "build.gradle")) || existsSync(join(cwd, "build.gradle.kts"));
        const hasMaven = existsSync(join(cwd, "pom.xml"));
        const hasGemfile = existsSync(join(cwd, "Gemfile"));
        const hasMix = existsSync(join(cwd, "mix.exs"));

        // TypeScript detection: tsconfig.json OR a `typescript` devDependency.
        let ts = hasTsconfig;
        if (hasPkg) {
                const pkg = readJson(join(cwd, "package.json")) as Record<string, unknown> | { __parseError: true } | null;
                if (pkg && !("__parseError" in pkg)) {
                        const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
                        const deps = (pkg.dependencies ?? {}) as Record<string, string>;
                        if (devDeps.typescript || deps.typescript) ts = true;
                } else if (pkg && "__parseError" in pkg) {
                        notes.push(`package.json exists but is not valid JSON — TypeScript detection skipped`);
                }
        }
        if (ts) out.push({ name: "TypeScript", source: hasTsconfig ? "tsconfig.json" : "package.json devDependencies.typescript" });

        if (hasPkg && !ts) {
                const pkg = readJson(join(cwd, "package.json")) as Record<string, unknown> | null;
                if (pkg && !("__parseError" in (pkg as any))) {
                        out.push({ name: "JavaScript", source: "package.json" });
                } else {
                        notes.push(`package.json exists but is not valid JSON — language detection skipped`);
                }
        }

        if (hasDeno) {
                out.push({ name: ts ? "TypeScript (Deno)" : "JavaScript (Deno)", source: "deno.json" });
        }

        if (hasPy) {
                let pySource = "pyproject.toml";
                if (!existsSync(join(cwd, "pyproject.toml"))) {
                        pySource = existsSync(join(cwd, "requirements.txt")) ? "requirements.txt" : "setup.py";
                }
                out.push({ name: "Python", source: pySource });
        }
        if (hasCargo) out.push({ name: "Rust", source: "Cargo.toml" });
        if (hasGoMod) out.push({ name: "Go", source: "go.mod" });
        if (hasGradle) {
                const isKotlin = existsSync(join(cwd, "build.gradle.kts"));
                out.push({ name: isKotlin ? "Kotlin (Gradle)" : "Java/Groovy (Gradle)", source: "build.gradle" + (isKotlin ? ".kts" : "") });
        }
        if (hasMaven) out.push({ name: "Java (Maven)", source: "pom.xml" });
        if (hasGemfile) out.push({ name: "Ruby", source: "Gemfile" });
        if (hasMix) out.push({ name: "Elixir", source: "mix.exs" });

        return out;
}

/** Detect frameworks from the JS/Python/Rust/Go dependency manifests. */
function detectFrameworks(cwd: string, notes: string[]): DetectedFramework[] {
        const out: DetectedFramework[] = [];
        const seen = new Set<string>();

        const addUnique = (name: string, source: string) => {
                if (seen.has(name)) return;
                seen.add(name);
                out.push({ name, source });
        };

        // JS / TS — package.json deps + devDeps.
        const pkg = readJson(join(cwd, "package.json")) as Record<string, unknown> | { __parseError: true } | null;
        if (pkg && !("__parseError" in pkg)) {
                const deps = (pkg.dependencies ?? {}) as Record<string, string>;
                const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
                const all = { ...deps, ...devDeps };
                for (const [dep, label] of Object.entries(JS_FRAMEWORKS)) {
                        if (dep in all) addUnique(label, `package.json dependencies.${dep}`);
                }
        } else if (pkg && "__parseError" in pkg) {
                notes.push(`package.json parse error — JS framework detection skipped`);
        }

        // Python — pyproject.toml [project.dependencies] / [tool.poetry.dependencies].
        const py = readToml(join(cwd, "pyproject.toml"));
        if (py) {
                const proj = (py.project ?? {}) as Record<string, unknown> | undefined;
                const depLists: unknown[] = [];
                if (Array.isArray(proj?.dependencies)) depLists.push(...proj.dependencies);
                const poetry = (py.tool as Record<string, unknown> | undefined)?.poetry as Record<string, unknown> | undefined;
                if (poetry && typeof poetry.dependencies === "object" && poetry.dependencies) {
                        depLists.push(...Object.keys(poetry.dependencies as Record<string, unknown>));
                }
                for (const d of depLists) {
                        if (typeof d !== "string") continue;
                        const name = d.split(/[<>=\[!~ ]/)[0].trim().toLowerCase();
                        if (PY_FRAMEWORKS[name]) addUnique(PY_FRAMEWORKS[name], `pyproject.toml dependencies.${name}`);
                }
        }

        // requirements.txt — best-effort line-by-line.
        const req = readText(join(cwd, "requirements.txt"));
        if (req) {
                for (const line of req.split(/\r?\n/)) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith("#")) continue;
                        const name = trimmed.split(/[<>=\[!~ ]/)[0].trim().toLowerCase();
                        if (PY_FRAMEWORKS[name]) addUnique(PY_FRAMEWORKS[name], `requirements.txt:${trimmed}`);
                }
        }

        // Rust — Cargo.toml [dependencies].
        const cargo = readToml(join(cwd, "Cargo.toml"));
        if (cargo) {
                const deps = cargo.dependencies as Record<string, unknown> | undefined;
                if (deps && typeof deps === "object") {
                        for (const dep of Object.keys(deps)) {
                                if (RS_FRAMEWORKS[dep]) addUnique(RS_FRAMEWORKS[dep], `Cargo.toml dependencies.${dep}`);
                        }
                }
        }

        // Go — go.mod imports.
        const go = readText(join(cwd, "go.mod"));
        if (go) {
                for (const { re, name } of GO_FRAMEWORKS) {
                        if (re.test(go)) addUnique(name, `go.mod import ${re.source}`);
                }
        }

        return out;
}

/** Detect the test runner from manifests + script entries. */
function detectTestRunner(cwd: string): string | null {
        // JS — explicit devDep.
        const pkg = readJson(join(cwd, "package.json")) as Record<string, unknown> | { __parseError: true } | null;
        if (pkg && !("__parseError" in pkg)) {
                const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
                const deps = (pkg.dependencies ?? {}) as Record<string, string>;
                const all = { ...deps, ...devDeps };
                for (const [dep, label] of Object.entries(JS_TEST_RUNNERS)) {
                        if (dep in all) return label;
                }
                // package.json scripts.test convention: `vitest run`, `jest`, `mocha`, etc.
                const scripts = (pkg.scripts ?? {}) as Record<string, string>;
                const testScript = scripts.test;
                if (typeof testScript === "string" && !testScript.startsWith("echo")) {
                        if (/\bvitest\b/.test(testScript)) return "vitest";
                        if (/\bjest\b/.test(testScript)) return "jest";
                        if (/\bmocha\b/.test(testScript)) return "mocha";
                        if (/\bplaywright\b/.test(testScript)) return "Playwright";
                        if (/\bcypress\b/.test(testScript)) return "Cypress";
                }
        }

        // Python — pytest in pyproject.toml or requirements.txt.
        const py = readToml(join(cwd, "pyproject.toml"));
        if (py) {
                const proj = (py.project ?? {}) as Record<string, unknown> | undefined;
                if (Array.isArray(proj?.dependencies)) {
                        for (const d of proj.dependencies as unknown[]) {
                                if (typeof d === "string" && /^pytest([<>=\[!~ ]|$)/i.test(d)) return "pytest";
                        }
                }
                const poetry = (py.tool as Record<string, unknown> | undefined)?.poetry as Record<string, unknown> | undefined;
                if (poetry && typeof poetry.dependencies === "object" && poetry.dependencies) {
                        for (const k of Object.keys(poetry.dependencies as Record<string, unknown>)) {
                                if (k.toLowerCase() === "pytest") return "pytest";
                        }
                }
                const optional = (poetry as Record<string, unknown> | undefined)?.group as Record<string, unknown> | undefined;
                if (optional && typeof optional === "object") {
                        for (const group of Object.values(optional)) {
                                const g = group as Record<string, unknown>;
                                if (g && typeof g.dependencies === "object" && g.dependencies) {
                                        for (const k of Object.keys(g.dependencies as Record<string, unknown>)) {
                                                if (k.toLowerCase() === "pytest") return "pytest";
                                        }
                                }
                        }
                }
                // `[tool.pytest.ini_options]` (or `[tool.pytest]`) is itself the strongest
                // signal pytest is the configured runner — even when the dep is in a
                // dev group we didn't enumerate above.
                const toolSection = py.tool as Record<string, unknown> | undefined;
                if (toolSection && typeof toolSection === "object") {
                        if ("pytest" in toolSection || "pytest.ini_options" in toolSection) return "pytest";
                }
        }
        const req = readText(join(cwd, "requirements.txt"));
        if (req) {
                for (const line of req.split(/\r?\n/)) {
                        const trimmed = line.trim();
                        if (/^pytest([<>=\[!~ ]|$)/i.test(trimmed)) return "pytest";
                        if (/^unittest2?([<>=\[!~ ]|$)/i.test(trimmed)) return "unittest";
                }
        }

        // Rust — `cargo test` is implicit.
        if (existsSync(join(cwd, "Cargo.toml"))) return "cargo test";
        // Go — `go test` is implicit.
        if (existsSync(join(cwd, "go.mod"))) return "go test";
        // Java — JUnit is implicit; check for the dep.
        if (existsSync(join(cwd, "pom.xml"))) {
                const pom = readText(join(cwd, "pom.xml"));
                if (pom && /<artifactId>junit<\/artifactId>/.test(pom)) return "JUnit (Maven Surefire)";
        }
        if (existsSync(join(cwd, "build.gradle")) || existsSync(join(cwd, "build.gradle.kts"))) {
                return "JUnit (Gradle)";
        }
        return null;
}

/** Detect the lint config (eslint / biome / ruff / golangci / etc.). */
function detectLintConfig(cwd: string): string | null {
        // ESLint — flat or legacy config files first.
        for (const f of ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts"]) {
                if (existsSync(join(cwd, f))) return `ESLint (${f})`;
        }
        for (const f of [".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.yml", ".eslintrc.yaml"]) {
                if (existsSync(join(cwd, f))) return `ESLint (${f})`;
        }
        // ESLint — package.json `eslintConfig` key (Next.js convention).
        const pkg = readJson(join(cwd, "package.json")) as Record<string, unknown> | { __parseError: true } | null;
        if (pkg && !("__parseError" in pkg) && typeof pkg.eslintConfig === "object" && pkg.eslintConfig !== null) {
                return "ESLint (package.json eslintConfig)";
        }
        if (existsSync(join(cwd, "biome.json")) || existsSync(join(cwd, "biome.jsonc"))) return "Biome";
        if (existsSync(join(cwd, ".prettierrc")) || existsSync(join(cwd, ".prettierrc.json")) || existsSync(join(cwd, "prettier.config.js"))) {
                // Prettier is a formatter; mention it but keep looking for a real linter.
                // (fall through; not returned as the lint config on its own)
        }
        // Python — Ruff / Pylint / Black.
        if (existsSync(join(cwd, "ruff.toml")) || existsSync(join(cwd, ".ruff.toml"))) return "Ruff";
        const py = readToml(join(cwd, "pyproject.toml"));
        if (py) {
                const tool = py.tool as Record<string, unknown> | undefined;
                if (tool && typeof tool === "object") {
                        if ("ruff" in tool) return "Ruff (pyproject.toml [tool.ruff])";
                        if ("pylint" in tool) return "Pylint (pyproject.toml [tool.pylint])";
                }
        }
        if (existsSync(join(cwd, ".pylintrc"))) return "Pylint (.pylintrc)";
        if (existsSync(join(cwd, ".flake8"))) return "Flake8";
        // Rust — Clippy is implicit; just note it.
        if (existsSync(join(cwd, "Cargo.toml"))) return "Clippy (cargo clippy)";
        // Go — golangci-lint config.
        for (const f of [".golangci.yml", ".golangci.yaml", ".golangci.toml", ".golangci.json"]) {
                if (existsSync(join(cwd, f))) return `golangci-lint (${f})`;
        }
        // Ruby — RuboCop.
        if (existsSync(join(cwd, ".rubocop.yml")) || existsSync(join(cwd, ".rubocop.yaml"))) return "RuboCop";
        // Deno — deno lint is built-in.
        if (existsSync(join(cwd, "deno.json")) || existsSync(join(cwd, "deno.jsonc"))) return "deno lint (built-in)";
        return null;
}

/** Detect the package manager from lockfiles. */
function detectPackageManager(cwd: string): string | null {
        if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) return "bun";
        if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
        if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
        if (existsSync(join(cwd, "package-lock.json"))) return "npm";
        if (existsSync(join(cwd, "deno.lock"))) return "deno";
        if (existsSync(join(cwd, "uv.lock"))) return "uv";
        if (existsSync(join(cwd, "poetry.lock"))) return "poetry";
        if (existsSync(join(cwd, "Pipfile.lock"))) return "pipenv";
        if (existsSync(join(cwd, "Cargo.lock"))) return "cargo";
        if (existsSync(join(cwd, "go.sum"))) return "go";
        if (existsSync(join(cwd, "Gemfile.lock"))) return "bundler";
        if (existsSync(join(cwd, "mix.lock"))) return "mix";
        if (existsSync(join(cwd, "gradle.lockfile"))) return "gradle";
        return null;
}

/** Detect build commands — package.json scripts + language-implicit builds. */
function detectBuildCommands(cwd: string, packageManager: string | null): string[] {
        const cmds: string[] = [];
        const pkg = readJson(join(cwd, "package.json")) as Record<string, unknown> | { __parseError: true } | null;
        if (pkg && !("__parseError" in pkg)) {
                const scripts = (pkg.scripts ?? {}) as Record<string, string>;
                const pm = packageManager ?? "npm";
                if (typeof scripts.build === "string") cmds.push(`${pm} run build`);
                if (typeof scripts.test === "string" && !scripts.test.startsWith("echo")) cmds.push(`${pm} test`);
                if (typeof scripts.lint === "string") cmds.push(`${pm} run lint`);
                if (typeof scripts.dev === "string") cmds.push(`${pm} run dev`);
        }
        if (existsSync(join(cwd, "Cargo.toml"))) {
                cmds.push("cargo build --release");
        }
        if (existsSync(join(cwd, "go.mod"))) {
                cmds.push("go build ./...");
        }
        if (existsSync(join(cwd, "Makefile")) || existsSync(join(cwd, "makefile")) || existsSync(join(cwd, "GNUmakefile"))) {
                cmds.push("make");
        }
        if (existsSync(join(cwd, "pom.xml"))) cmds.push("mvn package");
        if (existsSync(join(cwd, "build.gradle")) || existsSync(join(cwd, "build.gradle.kts"))) {
                cmds.push("./gradlew build");
        }
        if (existsSync(join(cwd, "mix.exs"))) cmds.push("mix compile");
        return Array.from(new Set(cmds));
}

/** Top dependencies from package.json (deps + devDeps, top 12 by name). */
function detectTopDependencies(cwd: string): string[] {
        const pkg = readJson(join(cwd, "package.json")) as Record<string, unknown> | { __parseError: true } | null;
        if (!pkg || "__parseError" in pkg) return [];
        const deps = (pkg.dependencies ?? {}) as Record<string, string>;
        const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
        const all = Object.keys({ ...deps, ...devDeps });
        // Filter out workspace + scope-only noise.
        return all.filter((d) => !d.startsWith("file:")).slice(0, 12);
}

/** Top-level directory structure summary (maxdepth = 1, max 12 entries). */
function detectFileStructure(cwd: string): DirectoryRole[] {
        const out: DirectoryRole[] = [];
        let entries: string[] = [];
        try {
                entries = readdirSync(cwd, { withFileTypes: true })
                        .filter((d) => d.isDirectory())
                        .map((d) => d.name);
        } catch {
                return out;
        }
        // Skip noise / VCS / build-output dirs in the report.
        const skip = new Set([
                ...Object.keys(DIR_ROLES).filter((d) => ["build", "dist", "out", "target", "node_modules", "coverage"].includes(d)),
                ...Array.from(HIDDEN_IGNORED),
        ]);
        for (const dir of entries) {
                if (HIDDEN_IGNORED.has(dir)) continue;
                const role = DIR_ROLES[dir] ?? (dir.startsWith(".") ? "tooling configuration" : "project directory");
                out.push({ dir, role });
                if (out.length >= 12) break;
        }
        return out;
}

/** Suggested conventions inferred from the detected stack. */
function detectConventions(
        cwd: string,
        langs: DetectedLanguage[],
        lint: string | null,
        pkgManager: string | null,
): string[] {
        const out: string[] = [];
        const names = new Set(langs.map((l) => l.name));

        if (names.has("TypeScript")) {
                out.push("Use TypeScript for all new code; prefer types over `any`.");
                const pkg = readJson(join(cwd, "package.json")) as Record<string, unknown> | { __parseError: true } | null;
                if (pkg && !("__parseError" in pkg)) {
                        if (pkg.type === "module") out.push("Use ES modules (`import`/`export`); `package.json` declares `\"type\": \"module\"`.");
                        else out.push("Use CommonJS (`require`/`module.exports`) unless `package.json` declares `\"type\": \"module\"`.");
                }
        } else if (names.has("JavaScript")) {
                out.push("Use modern JavaScript (ES2022+); document any CommonJS-only deps.");
        }
        if (names.has("Python")) {
                out.push("Follow PEP 8; add type hints to public functions.");
        }
        if (names.has("Rust")) {
                out.push("Run `cargo fmt` before committing; address all `cargo clippy` warnings.");
        }
        if (names.has("Go")) {
                out.push("Run `gofmt`/`goimports` before committing; pass `golangci-lint`.");
        }
        if (names.has("Ruby")) {
                out.push("Follow the RuboCop config; prefer `bundle exec` for project scripts.");
        }
        if (names.has("Elixir")) {
                out.push("Follow `mix format`; run `mix credo` for static analysis.");
        }

        if (lint) {
                out.push(`Lint config: ${lint}. Run it before every commit.`);
        }
        if (pkgManager) {
                out.push(`Package manager: ${pkgManager}. Lockfile is the source of truth — do not edit by hand.`);
        }

        // EditorConfig present → honor it.
        if (existsSync(join(cwd, ".editorconfig"))) {
                out.push("Honor `.editorconfig` for indentation + line endings.");
        }

        // CONTRIBUTING.md → cite it.
        if (existsSync(join(cwd, "CONTRIBUTING.md"))) {
                out.push("Read `CONTRIBUTING.md` before opening a PR.");
        }

        return out;
}

/** Infer the project name from any of the manifests, in priority order. */
function detectProjectName(cwd: string): string | null {
        const pkg = readJson(join(cwd, "package.json")) as Record<string, unknown> | { __parseError: true } | null;
        if (pkg && !("__parseError" in pkg) && typeof pkg.name === "string" && pkg.name) {
                return pkg.name;
        }
        const py = readToml(join(cwd, "pyproject.toml"));
        if (py) {
                const proj = (py.project ?? {}) as Record<string, unknown> | undefined;
                if (typeof proj?.name === "string" && proj.name) return proj.name;
                const poetry = (py.tool as Record<string, unknown> | undefined)?.poetry as Record<string, unknown> | undefined;
                if (typeof poetry?.name === "string" && poetry.name) return poetry.name;
        }
        const cargo = readToml(join(cwd, "Cargo.toml"));
        if (cargo) {
                const p = cargo.package as Record<string, unknown> | undefined;
                if (typeof p?.name === "string" && p.name) return p.name;
        }
        const go = readText(join(cwd, "go.mod"));
        if (go) {
                const m = go.match(/^module\s+(\S+)/m);
                if (m) return m[1];
        }
        const mix = readToml(join(cwd, "mix.exs"));
        if (mix) {
                const p = mix.project as Record<string, unknown> | undefined;
                if (p) {
                        const app = (p.app ?? p.name) as unknown;
                        if (typeof app === "string" && app) return app;
                }
        }
        const gem = readText(join(cwd, "Gemfile"));
        if (gem) {
                const m = gem.match(/^name\s+["']([^"']+)["']/m);
                if (m) return m[1];
        }
        // Fallback to the directory name.
        const base = cwd.split(/[\\/]/).pop();
        return base || null;
}

/** Infer the project description from README.md or the manifests. */
function detectProjectDescription(cwd: string): string | null {
        const pkg = readJson(join(cwd, "package.json")) as Record<string, unknown> | { __parseError: true } | null;
        if (pkg && !("__parseError" in pkg) && typeof pkg.description === "string" && pkg.description) {
                return pkg.description;
        }
        const py = readToml(join(cwd, "pyproject.toml"));
        if (py) {
                const proj = (py.project ?? {}) as Record<string, unknown> | undefined;
                if (typeof proj?.description === "string" && proj.description) return proj.description;
        }
        const cargo = readToml(join(cwd, "Cargo.toml"));
        if (cargo) {
                const p = cargo.package as Record<string, unknown> | undefined;
                if (typeof p?.description === "string" && p.description) return p.description;
        }
        const readme = readText(join(cwd, "README.md")) ?? readText(join(cwd, "README.rst")) ?? readText(join(cwd, "README.txt"));
        if (readme) {
                // First non-empty, non-heading line is the canonical description.
                for (const line of readme.split(/\r?\n/)) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;
                        if (/^#+\s/.test(trimmed)) continue;
                        return trimmed.slice(0, 200);
                }
        }
        return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan the repo at `cwd` and return structured forensics. NEVER throws —
 * each detector reports its own parse failures into `detectionNotes`.
 */
export function scanRepoForensics(cwd: string): RepoForensics {
        const notes: string[] = [];
        const languages = detectLanguages(cwd, notes);
        const frameworks = detectFrameworks(cwd, notes);
        const testRunner = detectTestRunner(cwd);
        const lintConfig = detectLintConfig(cwd);
        const packageManager = detectPackageManager(cwd);
        const buildCommands = detectBuildCommands(cwd, packageManager);
        const topDependencies = detectTopDependencies(cwd);
        const fileStructure = detectFileStructure(cwd);
        const conventions = detectConventions(cwd, languages, lintConfig, packageManager);
        const projectName = detectProjectName(cwd);
        const projectDescription = detectProjectDescription(cwd);

        return {
                projectName,
                projectDescription,
                languages,
                frameworks,
                testRunner,
                lintConfig,
                packageManager,
                buildCommands,
                topDependencies,
                fileStructure,
                conventions,
                detectionNotes: notes,
        };
}

/**
 * Render `RepoForensics` into an AGENTS.md markdown string following the
 * agents.md spec (https://agents.md/). Pure — no I/O.
 */
export function renderAgentsMd(f: RepoForensics): string {
        const lines: string[] = [];
        lines.push(`# AGENTS.md`);
        lines.push(``);
        lines.push(`> Generated by \`unown init\` / \`/init-agents\` — edit freely.`);
        lines.push(`> Other coding agents (Cursor, Claude Code, opencode, cline) read this file.`);
        lines.push(``);

        const name = f.projectName ?? "(unknown project)";
        lines.push(`## Project: ${name}`);
        if (f.projectDescription) {
                lines.push(``);
                lines.push(f.projectDescription);
        }
        lines.push(``);

        // Languages
        if (f.languages.length > 0) {
                lines.push(`### Language(s)`);
                for (const l of f.languages) {
                        lines.push(`- **${l.name}** — detected from \`${l.source}\``);
                }
                lines.push(``);
        } else {
                lines.push(`### Language(s)`);
                lines.push(``);
                lines.push(`_(no language manifest detected — add a \`package.json\`, \`pyproject.toml\`, \`Cargo.toml\`, \`go.mod\` etc.)_`);
                lines.push(``);
        }

        // Frameworks
        if (f.frameworks.length > 0) {
                lines.push(`### Framework(s)`);
                for (const fw of f.frameworks) {
                        lines.push(`- **${fw.name}** — from \`${fw.source}\``);
                }
                lines.push(``);
        }

        // Test runner
        lines.push(`### Tests`);
        if (f.testRunner) {
                lines.push(`- Test runner: \`${f.testRunner}\``);
        } else {
                lines.push(`- _(no test runner detected)_`);
        }
        lines.push(``);

        // Lint config
        lines.push(`### Lint / Format`);
        lines.push(`- ${f.lintConfig ?? "_(no lint config detected)_"}`);
        lines.push(``);

        // Build commands
        lines.push(`### Build`);
        if (f.buildCommands.length > 0) {
                for (const c of f.buildCommands) lines.push(`- \`${c}\``);
        } else {
                lines.push(`- _(no build command detected)_`);
        }
        lines.push(``);

        // Package manager
        if (f.packageManager) {
                lines.push(`### Package manager`);
                lines.push(`- \`${f.packageManager}\``);
                lines.push(``);
        }

        // Dependencies
        if (f.topDependencies.length > 0) {
                lines.push(`### Top dependencies`);
                lines.push(`- ${f.topDependencies.map((d) => `\`${d}\``).join(", ")}`);
                lines.push(``);
        }

        // File structure
        if (f.fileStructure.length > 0) {
                lines.push(`### File structure`);
                lines.push(`| Path | Role |`);
                lines.push(`| --- | --- |`);
                for (const d of f.fileStructure) {
                        lines.push(`| \`${d.dir}/\` | ${d.role} |`);
                }
                lines.push(``);
        }

        // Conventions
        if (f.conventions.length > 0) {
                lines.push(`### Conventions`);
                for (const c of f.conventions) {
                        lines.push(`- ${c}`);
                }
                lines.push(``);
        }

        // Detection notes (parse failures, etc.) — surfaced so the human can fix.
        if (f.detectionNotes.length > 0) {
                lines.push(`### Detection notes`);
                for (const n of f.detectionNotes) {
                        lines.push(`- ⚠ ${n}`);
                }
                lines.push(``);
        }

        lines.push(`---`);
        lines.push(``);
        lines.push(`Regenerate this file: \`unown init\` (interactive) or \`/init-agents\` (inline).`);
        return lines.join("\n");
}

/**
 * Scan + render in one call. PURE — no file writes. Returns the AGENTS.md
 * markdown content. The caller (cli.ts, the slash command, or a test)
 * decides whether to write the file, print it, or diff it.
 */
export function generateAgentsMd(cwdOrOpts?: string | GenerateAgentsMdOptions): string {
        const cwd = typeof cwdOrOpts === "string" ? cwdOrOpts : (cwdOrOpts?.cwd ?? process.cwd());
        return renderAgentsMd(scanRepoForensics(cwd));
}

/**
 * Check whether an existing AGENTS.md at `path` should be overwritten. Used
 * by cli.ts to gate the write — the caller confirms before calling
 * `writeFileSync`. Pure (no write).
 */
export function shouldOverwriteAgentsMd(path: string): boolean {
        if (!existsSync(path)) return true;
        try {
                const st = statSync(path);
                // Skip if it's a directory — never clobber directories silently.
                return !st.isDirectory();
        } catch {
                return false;
        }
}
