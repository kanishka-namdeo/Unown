/**
 * init-agents.test.ts — `/init` AGENTS.md generator (Milestone 3.1).
 *
 * Pins the 10 spec cases:
 *   1.  generateAgentsMd detects a Next.js TypeScript project (package.json)
 *   2.  generateAgentsMd detects a Python project (pyproject.toml + pytest)
 *   3.  generateAgentsMd detects a Rust project (Cargo.toml)
 *   4.  generateAgentsMd detects a Go project (go.mod)
 *   5.  generateAgentsMd handles missing package.json gracefully
 *   6.  generateAgentsMd includes test runner section when present
 *   7.  generateAgentsMd includes lint config section when present
 *   8.  generateAgentsMd includes build commands when present
 *   9.  generateAgentsMd includes file structure summary (top dirs)
 *   10. generateAgentsMd doesn't crash on corrupt JSON (package.json syntax error)
 *
 * The generator module is pure (fs + path only, no pi imports, no store,
 * no bus), so these tests run hermetically — every fixture is written under
 * a per-test `mkdtempSync` directory and torn down in `finally`.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateAgentsMd, renderAgentsMd, scanRepoForensics } from "../src/init-agents.ts";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Fresh temp dir for one test — swept in `finally`. */
function freshDir(prefix: string): string {
        return mkdtempSync(join(tmpdir(), `unown-init-agents-${prefix}-`));
}

/** Write a UTF-8 file at `<dir>/<relPath>`; creates intermediate directories. */
function writeRel(dir: string, relPath: string, contents: string): void {
        const abs = join(dir, relPath);
        const parent = abs.split(/[\\/]/).slice(0, -1).join("/");
        mkdirSync(parent, { recursive: true });
        writeFileSync(abs, contents);
}

// ---------------------------------------------------------------------------
// 1. Next.js TypeScript project
// ---------------------------------------------------------------------------

describe("generateAgentsMd — Next.js TypeScript detection", () => {
        test("detects TypeScript + Next.js from package.json + tsconfig.json", () => {
                const dir = freshDir("nextjs");
                try {
                        writeRel(
                                dir,
                                "package.json",
                                JSON.stringify({
                                        name: "demo-nextjs",
                                        description: "A demo Next.js TypeScript app",
                                        type: "module",
                                        scripts: { build: "next build", dev: "next dev", test: "vitest run", lint: "next lint" },
                                        dependencies: { next: "^14.0.0", react: "^18.0.0", "react-dom": "^18.0.0" },
                                        devDependencies: { typescript: "^5.0.0", vitest: "^1.0.0" },
                                        // Next.js's convention: an inline ESLint config in package.json.
                                        eslintConfig: { extends: "next/core-web-vitals" },
                                }),
                        );
                        writeRel(dir, "tsconfig.json", "{}");
                        writeRel(dir, "README.md", "# Demo Next.js App\n\nA demo.");
                        const md = generateAgentsMd(dir);
                        // Project name + description surface at the top.
                        expect(md).toContain("demo-nextjs");
                        expect(md).toContain("A demo Next.js TypeScript app");
                        // Language: TypeScript wins over JavaScript (more specific).
                        expect(md).toMatch(/TypeScript.*tsconfig\.json/);
                        expect(md).not.toMatch(/^\s*-\s*\*\*JavaScript\*\*/m);
                        // Framework: Next.js (and React, since react is in deps too).
                        expect(md).toContain("Next.js");
                        expect(md).toContain("React");
                        // Test runner + lint + build commands surfaced.
                        expect(md).toContain("vitest");
                        expect(md).toContain("ESLint");
                        // Build command surfaced via the detected package manager
                        // (npm by default — no bun.lockb in this fixture).
                        expect(md).toMatch(/(?:npm|bun|pnpm|yarn) run build/);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 2. Python project (pyproject.toml + pytest)
// ---------------------------------------------------------------------------

describe("generateAgentsMd — Python detection", () => {
        test("detects Python + pytest from pyproject.toml", () => {
                const dir = freshDir("python");
                try {
                        writeRel(
                                dir,
                                "pyproject.toml",
                                [
                                        "[project]",
                                        'name = "demo-py"',
                                        'description = "A demo Python project"',
                                        "dependencies = [\"fastapi\", \"sqlalchemy\"]",
                                        "",
                                        "[tool.pytest.ini_options]",
                                        "testpaths = [\"tests\"]",
                                        "",
                                        "[tool.ruff]",
                                        "line-length = 100",
                                        "",
                                ].join("\n"),
                        );
                        writeRel(dir, "README.md", "# demo-py\n\nA demo Python project.");
                        const md = generateAgentsMd(dir);
                        expect(md).toContain("demo-py");
                        expect(md).toContain("Python");
                        expect(md).toContain("pytest");
                        expect(md).toContain("FastAPI");
                        expect(md).toContain("Ruff");
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 3. Rust project (Cargo.toml)
// ---------------------------------------------------------------------------

describe("generateAgentsMd — Rust detection", () => {
        test("detects Rust + cargo build from Cargo.toml", () => {
                const dir = freshDir("rust");
                try {
                        writeRel(
                                dir,
                                "Cargo.toml",
                                [
                                        "[package]",
                                        'name = "demo-rs"',
                                        'version = "0.1.0"',
                                        'description = "A demo Rust project"',
                                        "",
                                        "[dependencies]",
                                        'tokio = { version = "1.0", features = ["full"] }',
                                        'serde = { version = "1.0", features = ["derive"] }',
                                        "",
                                ].join("\n"),
                        );
                        writeRel(dir, "src/main.rs", "fn main() { println!(\"hello\"); }\n");
                        const md = generateAgentsMd(dir);
                        expect(md).toContain("demo-rs");
                        expect(md).toContain("Rust");
                        expect(md).toContain("cargo test");
                        expect(md).toContain("cargo build --release");
                        expect(md).toContain("Clippy");
                        expect(md).toContain("Tokio");
                        expect(md).toContain("serde");
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 4. Go project (go.mod)
// ---------------------------------------------------------------------------

describe("generateAgentsMd — Go detection", () => {
        test("detects Go + go test from go.mod (with Gin framework)", () => {
                const dir = freshDir("go");
                try {
                        writeRel(
                                dir,
                                "go.mod",
                                [
                                        "module github.com/example/demo-go",
                                        "",
                                        "go 1.22",
                                        "",
                                        "require (",
                                        "\tgithub.com/gin-gonic/gin v1.9.0",
                                        ")",
                                        "",
                                ].join("\n"),
                        );
                        writeRel(dir, "main.go", "package main\n\nfunc main() {}\n");
                        const md = generateAgentsMd(dir);
                        expect(md).toContain("github.com/example/demo-go");
                        expect(md).toContain("Go");
                        expect(md).toContain("go test");
                        expect(md).toContain("go build ./...");
                        expect(md).toContain("Gin");
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 5. Missing package.json — graceful fallback
// ---------------------------------------------------------------------------

describe("generateAgentsMd — missing manifests", () => {
        test("handles missing package.json with a generic markdown response", () => {
                const dir = freshDir("empty");
                try {
                        writeRel(dir, "README.md", "# empty-project\n\nNo language manifests here.");
                        const md = generateAgentsMd(dir);
                        // Generic structure still emitted — header, project name fallback.
                        expect(md).toContain("# AGENTS.md");
                        expect(md).toContain("AGENTS.md");
                        // The directory name is used as the project name fallback.
                        expect(md.toLowerCase()).toContain(dir.split(/[\\/]/).pop()!.toLowerCase());
                        // Language section explicitly notes no manifest was detected.
                        expect(md).toMatch(/Language\(s\)/);
                        expect(md).toContain("no language manifest detected");
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 6. Test runner section
// ---------------------------------------------------------------------------

describe("generateAgentsMd — test runner section", () => {
        test("includes the test runner when a JS devDependency pins it", () => {
                const dir = freshDir("js-test");
                try {
                        writeRel(
                                dir,
                                "package.json",
                                JSON.stringify({
                                        name: "demo-js-test",
                                        devDependencies: { vitest: "^1.0.0" },
                                        scripts: { test: "vitest run" },
                                }),
                        );
                        const md = generateAgentsMd(dir);
                        expect(md).toContain("### Tests");
                        expect(md).toContain("vitest");
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        test("includes the test runner when Python pins pytest in requirements.txt", () => {
                const dir = freshDir("py-test");
                try {
                        writeRel(dir, "requirements.txt", "fastapi\npytest>=7.0\n");
                        const md = generateAgentsMd(dir);
                        expect(md).toContain("### Tests");
                        expect(md).toContain("pytest");
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 7. Lint config section
// ---------------------------------------------------------------------------

describe("generateAgentsMd — lint config section", () => {
        test("includes the lint config when an .eslintrc.json exists", () => {
                const dir = freshDir("eslint");
                try {
                        writeRel(dir, "package.json", JSON.stringify({ name: "demo-eslint" }));
                        writeRel(dir, ".eslintrc.json", JSON.stringify({ root: true }));
                        const md = generateAgentsMd(dir);
                        expect(md).toContain("### Lint / Format");
                        expect(md).toContain("ESLint");
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        test("includes Biome when biome.json is present", () => {
                const dir = freshDir("biome");
                try {
                        writeRel(dir, "package.json", JSON.stringify({ name: "demo-biome" }));
                        writeRel(dir, "biome.json", JSON.stringify({}));
                        const md = generateAgentsMd(dir);
                        expect(md).toContain("Biome");
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 8. Build commands section
// ---------------------------------------------------------------------------

describe("generateAgentsMd — build commands section", () => {
        test("includes package.json build + test scripts via the package manager", () => {
                const dir = freshDir("build-pm");
                try {
                        writeRel(
                                dir,
                                "package.json",
                                JSON.stringify({
                                        name: "demo-build",
                                        scripts: { build: "tsc", test: "vitest run", lint: "eslint ." },
                                }),
                        );
                        writeRel(dir, "bun.lockb", ""); // bun is the package manager
                        const md = generateAgentsMd(dir);
                        expect(md).toContain("### Build");
                        expect(md).toContain("bun run build");
                        expect(md).toContain("bun test");
                        expect(md).toContain("bun run lint");
                        // Package manager row also surfaces.
                        expect(md).toContain("### Package manager");
                        expect(md).toContain("`bun`");
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        test("includes `make` when a Makefile is present", () => {
                const dir = freshDir("makefile");
                try {
                        writeRel(dir, "Makefile", "build:\n\techo building\n");
                        const md = generateAgentsMd(dir);
                        expect(md).toContain("`make`");
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 9. File structure summary
// ---------------------------------------------------------------------------

describe("generateAgentsMd — file structure summary", () => {
        test("includes a markdown table of top-level directories", () => {
                const dir = freshDir("structure");
                try {
                        writeRel(dir, "package.json", JSON.stringify({ name: "demo-structure" }));
                        writeRel(dir, "src/index.ts", "export {};\n");
                        writeRel(dir, "tests/index.test.ts", "test('x', () => {});\n");
                        writeRel(dir, "docs/README.md", "# docs\n");
                        writeRel(dir, "scripts/build.sh", "#!/bin/sh\n");
                        const md = generateAgentsMd(dir);
                        expect(md).toContain("### File structure");
                        expect(md).toContain("| Path | Role |");
                        expect(md).toContain("`src/`");
                        expect(md).toContain("`tests/`");
                        expect(md).toContain("`docs/`");
                        expect(md).toContain("`scripts/`");
                        // Each row carries an inferred role.
                        expect(md).toMatch(/`src\/` \| source code/);
                        expect(md).toMatch(/`tests\/` \| tests/);
                        expect(md).toMatch(/`docs\/` \| documentation/);
                        expect(md).toMatch(/`scripts\/` \| build\/dev\/release scripts/);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 10. Corrupt package.json — never crashes
// ---------------------------------------------------------------------------

describe("generateAgentsMd — corrupt JSON resilience", () => {
        test("does not crash when package.json has a syntax error", () => {
                const dir = freshDir("corrupt");
                try {
                        writeRel(dir, "package.json", "{ this is not json");
                        writeRel(dir, "README.md", "# corrupt\n");
                        // Must NOT throw — should record a note + return generic markdown.
                        const md = generateAgentsMd(dir);
                        expect(md).toContain("# AGENTS.md");
                        // Detection notes surface the parse failure.
                        expect(md).toContain("Detection notes");
                        expect(md.toLowerCase()).toContain("package.json");
                        expect(md.toLowerCase()).toContain("not valid json");
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        test("does not crash when biome.json has a syntax error", () => {
                const dir = freshDir("corrupt-biome");
                try {
                        writeRel(dir, "package.json", JSON.stringify({ name: "demo-corrupt-biome" }));
                        writeRel(dir, "biome.json", "{ broken");
                        // Should not throw; lint detection should just not pick it up.
                        const md = generateAgentsMd(dir);
                        expect(md).toContain("# AGENTS.md");
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// Bonus — scanRepoForensics + renderAgentsMd split (pinned for the slash
// command's inline preview, which renders without writing).
// ---------------------------------------------------------------------------

describe("scanRepoForensics + renderAgentsMd split", () => {
        test("scanRepoForensics returns structured forensics renderAgentsMd can consume", () => {
                const dir = freshDir("split");
                try {
                        writeRel(
                                dir,
                                "package.json",
                                JSON.stringify({
                                        name: "demo-split",
                                        description: "split test",
                                        devDependencies: { vitest: "^1.0.0", typescript: "^5.0.0" },
                                        scripts: { build: "tsc", test: "vitest run" },
                                }),
                        );
                        writeRel(dir, "tsconfig.json", "{}");
                        const forensics = scanRepoForensics(dir);
                        expect(forensics.projectName).toBe("demo-split");
                        expect(forensics.projectDescription).toBe("split test");
                        expect(forensics.languages.map((l) => l.name)).toContain("TypeScript");
                        expect(forensics.testRunner).toBe("vitest");
                        expect(forensics.buildCommands.length).toBeGreaterThan(0);
                        const md = renderAgentsMd(forensics);
                        expect(md).toContain("demo-split");
                        expect(md).toContain("TypeScript");
                        expect(md).toContain("vitest");
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});
