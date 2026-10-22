/**
 * doctor-instructions.test.ts — `/doctor` instruction-set audit (Milestone 3.2).
 *
 * Pins the 10 spec cases:
 *   1.  auditInstructionSet returns a structured report with all 7 sections
 *   2.  AGENTS.md missing → "info" finding suggesting generation
 *   3.  AGENTS.md present but references missing files → "warn" finding
 *   4.  Skills directory with invalid frontmatter → "error" finding
 *   5.  MCP config with orphaned server entry → "warn" finding
 *   6.  Hooks config with invalid schema → "error" finding
 *   7.  Adversary mode file present → "info" finding confirming it's active
 *   8.  Adversary mode file with bad markdown → "warn" finding
 *   9.  Injection scanner config with invalid JSON → "error" finding
 *   10. Clean repo (no issues) → all sections return empty findings arrays
 *
 * The audit module is pure (fs + os + path only, no pi imports, no store,
 * no bus), so these tests run hermetically — every fixture is written under
 * a per-test `mkdtempSync` directory. The `AuditOptions.configDir` +
 * `agentDir` overrides let each test point at its own temp root.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        _resetGitIgnoreMemoForTests,
        auditInstructionSet,
        renderInstructionAudit,
        summarizeInstructionAudit,
        type AuditOptions,
        type Finding,
        type InstructionAuditReport,
} from "../src/doctor-instructions.ts";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Fresh temp dir for one test — swept in `finally`. */
function freshDir(prefix: string): string {
        return mkdtempSync(join(tmpdir(), `unown-doctor-instr-${prefix}-`));
}

/** Write a UTF-8 file at `<dir>/<relPath>`; creates intermediate directories. */
function writeRel(dir: string, relPath: string, contents: string): void {
        const abs = join(dir, relPath);
        const parent = abs.split(/[\\/]/).slice(0, -1).join("/");
        mkdirSync(parent, { recursive: true });
        writeFileSync(abs, contents);
}

/** Build AuditOptions pointing at a per-test config dir + agent dir. */
function optsFor(configDir: string): AuditOptions {
        return {
                configDir,
                agentDir: join(configDir, "agent"),
                // Tests run hermetically: never consult the real PATH. By returning
                // `false` unconditionally, the orphan check fires deterministically
                // when the test writes a server entry whose command it does NOT
                // place on the fake PATH. Tests that DON'T want the orphan check
                // to fire use a server entry with `url:` (no command).
                commandExists: () => false,
        };
}

/** Helper: count findings of a given severity across one section. */
function countBySeverity(findings: Finding[], severity: Finding["severity"]): number {
        return findings.filter((f) => f.severity === severity).length;
}

// ---------------------------------------------------------------------------
// 1. Structured report with all 7 sections
// ---------------------------------------------------------------------------

describe("auditInstructionSet — report shape", () => {
        test("returns a report with all 7 sections, each a Finding[] array", () => {
                const dir = freshDir("shape");
                try {
                        const report = auditInstructionSet(dir, optsFor(dir));
                        expect(report).toBeDefined();
                        expect(typeof report).toBe("object");
                        const expectedKeys: Array<keyof InstructionAuditReport> = [
                                "agentsMd",
                                "skills",
                                "mcpConfig",
                                "hooksConfig",
                                "adversaryMode",
                                "injectionScanner",
                                "staleConfig",
                        ];
                        for (const key of expectedKeys) {
                                expect(Array.isArray(report[key])).toBe(true);
                                for (const f of report[key]) {
                                        expect(["info", "warn", "error"]).toContain(f.severity);
                                        expect(typeof f.message).toBe("string");
                                        expect(f.message.length).toBeGreaterThan(0);
                                        if (f.fix !== undefined) expect(typeof f.fix).toBe("string");
                                }
                        }
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        test("renderInstructionAudit + summarizeInstructionAudit work on the empty report", () => {
                const dir = freshDir("shape-render");
                try {
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const text = renderInstructionAudit(report);
                        expect(text).toContain("Instruction-set audit:");
                        const sum = summarizeInstructionAudit(report);
                        expect(typeof sum.errors).toBe("number");
                        expect(typeof sum.warnings).toBe("number");
                        expect(typeof sum.infos).toBe("number");
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 2. AGENTS.md missing → info finding
// ---------------------------------------------------------------------------

describe("auditInstructionSet — AGENTS.md missing", () => {
        test("emits an info finding suggesting generation", () => {
                const dir = freshDir("agents-missing");
                try {
                        const report = auditInstructionSet(dir, optsFor(dir));
                        // AGENTS.md missing → at least one info finding with `fix`
                        const infos = report.agentsMd.filter((f) => f.severity === "info");
                        expect(infos.length).toBeGreaterThan(0);
                        expect(infos.some((f) => /AGENTS\.md/i.test(f.message))).toBe(true);
                        expect(infos.some((f) => f.fix && /init-agents|unown init/.test(f.fix))).toBe(true);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 3. AGENTS.md present but references missing files → warn finding
// ---------------------------------------------------------------------------

describe("auditInstructionSet — AGENTS.md stale references", () => {
        test("warns when AGENTS.md references a path that does not exist", () => {
                const dir = freshDir("agents-stale");
                try {
                        writeRel(dir, "src/index.ts", "export {};\n"); // anchor for src/missing-file.ts
                        writeRel(
                                dir,
                                "AGENTS.md",
                                [
                                        "# AGENTS.md",
                                        "",
                                        "See [the source](src/index.ts) and [the docs](docs/guide.md).",
                                        "Also a backtick path: `src/missing-file.ts`.",
                                        "",
                                ].join("\n"),
                        );
                        const report = auditInstructionSet(dir, optsFor(dir));
                        // The link to src/index.ts resolves; the link to docs/guide.md
                        // does not (links stay STRICT — no anchor rule); the backtick
                        // src/missing-file.ts has an existing src/ anchor, so the
                        // non-resolving tail is confident staleness. Each warns.
                        const warns = report.agentsMd.filter((f) => f.severity === "warn");
                        expect(warns.length).toBeGreaterThan(0);
                        expect(warns.some((f) => f.message.includes("docs/guide.md"))).toBe(true);
                        expect(warns.some((f) => f.message.includes("src/missing-file.ts"))).toBe(true);
                        expect(warns.some((f) => f.message.includes("src/index.ts"))).toBe(false);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        test("does NOT warn when AGENTS.md references files that DO exist", () => {
                const dir = freshDir("agents-fresh");
                try {
                        writeRel(dir, "src/index.ts", "export {};\n");
                        writeRel(
                                dir,
                                "AGENTS.md",
                                ["# AGENTS.md", "", "See [the source](src/index.ts).", "", "Also `src/index.ts` in backticks.", ""].join("\n"),
                        );
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const warns = report.agentsMd.filter((f) => f.severity === "warn");
                        expect(warns.length).toBe(0);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        // Confidence ladder for backtick tokens: prose legitimately backticks
        // package-relative shorthand, git refs, bare filenames, URL paths and
        // absolute paths — none resolve from the project root, none are
        // staleness. Only anchored project-relative paths warn. (Measured on
        // this repo's own AGENTS.md: 31 warns, 0 true positives before this
        // rule.) Markdown links keep the strict check in both directions.
        test("backtick confidence ladder: unanchored/bare/absolute prose is not flagged", () => {
                const dir = freshDir("agents-ladder");
                try {
                        writeRel(dir, "src/index.ts", "export {};\n");
                        writeRel(
                                dir,
                                "AGENTS.md",
                                [
                                        "# AGENTS.md",
                                        "",
                                        "Shorthand from another package's base: `src/elsewhere.ts` (src/ exists here, so this one IS flagged).",
                                        "Git ref: `origin/main`.",
                                        "Bare filename: `changelog-data.ts`.",
                                        "URL path: `/api/overview`.",
                                        "Absolute path: `/usr/local/bin/bun`.",
                                        "Anchor the project does not have: `memory/local.md` and `test/_env.ts`.",
                                        "",
                                ].join("\n"),
                        );
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const warns = report.agentsMd.filter((f) => f.severity === "warn");
                        const messages = warns.map((f) => f.message).join("\n");
                        // The anchored shorthand IS confident staleness (src/ exists,
                        // the tail does not) — that is the ladder's true positive.
                        expect(warns.some((f) => f.message.includes("src/elsewhere.ts"))).toBe(true);
                        // Everything else is prose, not staleness.
                        expect(messages.includes("origin/main")).toBe(false);
                        expect(messages.includes("changelog-data.ts")).toBe(false);
                        expect(messages.includes("/api/overview")).toBe(false);
                        expect(messages.includes("/usr/local/bin/bun")).toBe(false);
                        expect(messages.includes("memory/local.md")).toBe(false);
                        expect(messages.includes("test/_env.ts")).toBe(false);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        test("markdown links stay strict: an absolute link path is not a project file, but a broken relative link still warns", () => {
                const dir = freshDir("agents-links-strict");
                try {
                        writeRel(
                                dir,
                                "AGENTS.md",
                                [
                                        "# AGENTS.md",
                                        "",
                                        "Site link [API](/api/overview) — a URL path, not a file.",
                                        "Broken file link [docs](docs/guide.md).",
                                        "",
                                ].join("\n"),
                        );
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const warns = report.agentsMd.filter((f) => f.severity === "warn");
                        expect(warns.some((f) => f.message.includes("docs/guide.md"))).toBe(true);
                        expect(warns.some((f) => f.message.includes("/api/overview"))).toBe(false);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        // Gitignore awareness (M0): generated artifacts are EXPECTED to be absent
        // on a fresh clone — referencing them from AGENTS.md is documentation, not
        // staleness. Only a real git repo can exercise this (check-ignore needs
        // .git); the plain temp dirs above are not repos, so they keep the old
        // behaviour.
        test("gitignored generated paths (absent on fresh clone) are not flagged", () => {
                const dir = freshDir("agents-gitignored");
                const git = Bun.which("git");
                if (!git) return; // no git on PATH — behaviour degrades to the old rule
                try {
                        _resetGitIgnoreMemoForTests();
                        writeRel(dir, "src/index.ts", "export {};\n"); // anchor for src/generated/prisma
                        writeFileSync(join(dir, ".gitignore"), "src/generated/\n");
                        Bun.spawnSync({ cmd: [git, "-C", dir, "init", "-q"], stdout: "ignore", stderr: "ignore" });
                        writeRel(
                                dir,
                                "AGENTS.md",
                                [
                                        "# AGENTS.md",
                                        "",
                                        "Generated client (gitignored until `prisma generate`): `src/generated/prisma`.",
                                        "Genuinely missing: `src/missing-file.ts`.",
                                        "",
                                ].join("\n"),
                        );
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const warns = report.agentsMd.filter((f) => f.severity === "warn");
                        expect(warns.some((f) => f.message.includes("src/generated/prisma"))).toBe(false);
                        expect(warns.some((f) => f.message.includes("src/missing-file.ts"))).toBe(true);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 4. Skills directory with invalid frontmatter → error finding
// ---------------------------------------------------------------------------

describe("auditInstructionSet — skills frontmatter", () => {
        test("emits an error finding when a SKILL.md lacks valid frontmatter", () => {
                const dir = freshDir("skill-bad");
                try {
                        writeRel(dir, ".unown/skills/bad-skill/SKILL.md", "# Bad Skill\n\nNo frontmatter here.\n");
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const errors = report.skills.filter((f) => f.severity === "error");
                        expect(errors.length).toBeGreaterThan(0);
                        expect(errors.some((f) => f.message.includes("bad-skill") && /frontmatter/i.test(f.message))).toBe(true);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        test("does NOT error when a SKILL.md has valid frontmatter", () => {
                const dir = freshDir("skill-good");
                try {
                        writeRel(
                                dir,
                                ".unown/skills/good-skill/SKILL.md",
                                ["---", "name: good-skill", "description: A good skill.", "---", "", "# Good Skill", ""].join("\n"),
                        );
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const errors = report.skills.filter((f) => f.severity === "error");
                        expect(errors.length).toBe(0);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 5. MCP config with orphaned server entry → warn finding
// ---------------------------------------------------------------------------

describe("auditInstructionSet — MCP orphaned servers", () => {
        test("warns when an MCP server's command binary is not on PATH", () => {
                const dir = freshDir("mcp-orphan");
                try {
                        writeRel(
                                dir,
                                ".unown/mcp.json",
                                JSON.stringify({
                                        mcpServers: {
                                                ghost: { command: "this-binary-does-not-exist-anywhere-12345", args: ["--stdio"] },
                                        },
                                }),
                        );
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const warns = report.mcpConfig.filter((f) => f.severity === "warn");
                        expect(warns.length).toBeGreaterThan(0);
                        expect(warns.some((f) => f.message.includes("ghost") && /not on PATH/.test(f.message))).toBe(true);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        test("does NOT warn when an MCP server uses `url:` (HTTP, no binary check)", () => {
                const dir = freshDir("mcp-http");
                try {
                        writeRel(
                                dir,
                                ".unown/mcp.json",
                                JSON.stringify({
                                        mcpServers: {
                                                remote: { url: "https://example.invalid/mcp" },
                                        },
                                }),
                        );
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const warns = report.mcpConfig.filter((f) => f.severity === "warn");
                        expect(warns.length).toBe(0);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 6. Hooks config with invalid schema → error finding
// ---------------------------------------------------------------------------

describe("auditInstructionSet — hooks schema", () => {
        test("emits an error finding when hooks.json is not valid JSON", () => {
                const dir = freshDir("hooks-badjson");
                try {
                        writeRel(dir, ".unown/hooks.json", "{ this is not json");
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const errors = report.hooksConfig.filter((f) => f.severity === "error");
                        expect(errors.length).toBeGreaterThan(0);
                        expect(errors.some((f) => /not valid JSON/i.test(f.message))).toBe(true);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        test("emits an error finding when hooks.json has a bad version", () => {
                const dir = freshDir("hooks-badver");
                try {
                        writeRel(dir, ".unown/hooks.json", JSON.stringify({ version: 99, hooks: {} }));
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const errors = report.hooksConfig.filter((f) => f.severity === "error");
                        expect(errors.some((f) => /version/i.test(f.message))).toBe(true);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        test("emits an error finding when a handler has an invalid type", () => {
                const dir = freshDir("hooks-badtype");
                try {
                        writeRel(
                                dir,
                                ".unown/hooks.json",
                                JSON.stringify({
                                        version: 1,
                                        hooks: {
                                                PreToolUse: [{ type: "bogus", command: "echo hi" }],
                                        },
                                }),
                        );
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const errors = report.hooksConfig.filter((f) => f.severity === "error");
                        expect(errors.some((f) => /invalid.*type|type.*bogus/i.test(f.message))).toBe(true);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        test("does NOT error on a well-formed hooks.json", () => {
                const dir = freshDir("hooks-good");
                try {
                        writeRel(
                                dir,
                                ".unown/hooks.json",
                                JSON.stringify({
                                        version: 1,
                                        hooks: {
                                                PreToolUse: [{ type: "command", command: "echo hi" }],
                                        },
                                }),
                        );
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const errors = report.hooksConfig.filter((f) => f.severity === "error");
                        expect(errors.length).toBe(0);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 7. Adversary mode file present → info finding (active)
// ---------------------------------------------------------------------------

describe("auditInstructionSet — adversary mode active", () => {
        test("emits an info finding confirming the gate file is active", () => {
                const dir = freshDir("adversary-on");
                try {
                        writeRel(
                                dir,
                                "adversary.md",
                                ["# Adversary Policy", "", "Block destructive ops outside the test sandbox.", ""].join("\n"),
                        );
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const infos = report.adversaryMode.filter((f) => f.severity === "info");
                        expect(infos.length).toBeGreaterThan(0);
                        expect(infos.some((f) => /active/i.test(f.message))).toBe(true);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 8. Adversary mode file with bad markdown → warn finding
// ---------------------------------------------------------------------------

describe("auditInstructionSet — adversary mode malformed", () => {
        test("emits a warn finding when the gate file is empty / malformed", () => {
                const dir = freshDir("adversary-bad");
                try {
                        writeRel(dir, "adversary.md", "");
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const warns = report.adversaryMode.filter((f) => f.severity === "warn");
                        expect(warns.length).toBeGreaterThan(0);
                        expect(warns.some((f) => /malformed|empty|short/i.test(f.message))).toBe(true);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        test("emits a warn finding when the gate file is a single short word", () => {
                const dir = freshDir("adversary-short");
                try {
                        writeRel(dir, "adversary.md", "ok");
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const warns = report.adversaryMode.filter((f) => f.severity === "warn");
                        expect(warns.length).toBeGreaterThan(0);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 9. Injection scanner config with invalid JSON → error finding
// ---------------------------------------------------------------------------

describe("auditInstructionSet — injection scanner", () => {
        test("emits an error finding when the config JSON is broken", () => {
                const dir = freshDir("inj-badjson");
                try {
                        writeRel(dir, "injection-scanner.json", "{ not json");
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const errors = report.injectionScanner.filter((f) => f.severity === "error");
                        expect(errors.length).toBeGreaterThan(0);
                        expect(errors.some((f) => /not valid JSON/i.test(f.message))).toBe(true);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        test("emits an info finding when the config parses cleanly", () => {
                const dir = freshDir("inj-good");
                try {
                        writeRel(dir, "injection-scanner.json", JSON.stringify({ enabled: true, blockOn: ["high", "critical"] }));
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const infos = report.injectionScanner.filter((f) => f.severity === "info");
                        expect(infos.length).toBeGreaterThan(0);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 10. Clean repo — all sections return empty findings arrays
// ---------------------------------------------------------------------------

describe("auditInstructionSet — clean repo", () => {
        test("all 7 sections return empty findings arrays when everything is healthy", () => {
                const dir = freshDir("clean");
                try {
                        // AGENTS.md present + references resolve. Make it long enough to
                        // dodge the "very short skeleton" freshness nudge (200-byte floor).
                        writeRel(dir, "src/index.ts", "export {};\n");
                        writeRel(
                                dir,
                                "AGENTS.md",
                                [
                                        "# AGENTS.md",
                                        "",
                                        "> Project guide for coding agents (Cursor, Claude Code, opencode, cline).",
                                        "",
                                        "## Project layout",
                                        "",
                                        "See [src](src/index.ts) for the entrypoint.",
                                        "",
                                        "## Conventions",
                                        "",
                                        "- Use TypeScript. Use ES modules. Run `npm test` before committing.",
                                        "- Keep functions small and pure where possible. Add JSDoc to public APIs.",
                                        "",
                                ].join("\n"),
                        );
                        // No `.unown/skills/`, no `.unown/mcp.json`, no `.unown/hooks.json`,
                        // no `adversary.md`, no `injection-scanner.json` — all opt-in
                        // features are off, so no findings fire.
                        const report = auditInstructionSet(dir, optsFor(dir));
                        expect(report.agentsMd.length).toBe(0);
                        expect(report.skills.length).toBe(0);
                        expect(report.mcpConfig.length).toBe(0);
                        expect(report.hooksConfig.length).toBe(0);
                        expect(report.adversaryMode.length).toBe(0);
                        expect(report.injectionScanner.length).toBe(0);
                        expect(report.staleConfig.length).toBe(0);
                        // Summarize — zero errors, zero warnings.
                        const sum = summarizeInstructionAudit(report);
                        expect(sum.errors).toBe(0);
                        expect(sum.warnings).toBe(0);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// Bonus — staleConfig cross-file references
// ---------------------------------------------------------------------------

describe("auditInstructionSet — staleConfig cross-file refs", () => {
        test("warns when a hooks.json mcp handler references a server not in mcp.json", () => {
                const dir = freshDir("stale-mcp-ref");
                try {
                        writeRel(
                                dir,
                                ".unown/hooks.json",
                                JSON.stringify({
                                        version: 1,
                                        hooks: {
                                                PreToolUse: [{ type: "mcp", mcpServer: "ghost", mcpTool: "review" }],
                                        },
                                }),
                        );
                        // mcp.json has a DIFFERENT server name — `ghost` is orphaned.
                        writeRel(
                                dir,
                                ".unown/mcp.json",
                                JSON.stringify({
                                        mcpServers: { real: { url: "https://example.invalid/mcp" } },
                                }),
                        );
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const warns = report.staleConfig.filter((f) => f.severity === "warn");
                        expect(warns.some((f) => f.message.includes("ghost"))).toBe(true);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        test("does NOT warn when a hooks.json mcp handler resolves to an entry in mcp.json", () => {
                const dir = freshDir("stale-mcp-resolved");
                try {
                        writeRel(
                                dir,
                                ".unown/hooks.json",
                                JSON.stringify({
                                        version: 1,
                                        hooks: {
                                                PreToolUse: [{ type: "mcp", mcpServer: "real", mcpTool: "review" }],
                                        },
                                }),
                        );
                        writeRel(
                                dir,
                                ".unown/mcp.json",
                                JSON.stringify({
                                        mcpServers: { real: { url: "https://example.invalid/mcp" } },
                                }),
                        );
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const warns = report.staleConfig.filter((f) => f.severity === "warn");
                        expect(warns.length).toBe(0);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 9b. Unicode integrity — the injected memory tier is instruction surface
// ---------------------------------------------------------------------------

describe("auditInstructionSet — unicodeIntegrity covers the memory tier", () => {
        test("an invisible char in .unown/memory/project.md is an ERROR finding (2026-10-22 scope extension)", () => {
                const dir = freshDir("uni-mem");
                try {
                        // Tier-1 memory rides every future session's system prompt — a
                        // smuggled zero-width char there is the same backdoor class as
                        // one in AGENTS.md. The scope used to stop at skills/agents/hooks.
                        writeRel(dir, ".unown/memory/project.md", `# Tier 1 — Project Memory\n\n## Manual notes\n- hide \u200B inside the lane\n`);
                        const report = auditInstructionSet(dir, optsFor(dir));
                        const errors = report.unicodeIntegrity.filter(
                                (f) => f.severity === "error" && f.message.includes(".unown/memory/project.md"),
                        );
                        expect(errors.length).toBeGreaterThan(0);
                        expect(errors.some((f) => /zero-width/.test(f.message))).toBe(true);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        test("the provenance sidecar (engine-written JSON) is scanned too — a forged sidecar is inspectable", () => {
                const dir = freshDir("uni-prov");
                try {
                        writeRel(dir, ".unown/memory/project.provenance.json", `{ "sha256": "x", "note": "hide \u200B" }\n`);
                        const report = auditInstructionSet(dir, optsFor(dir));
                        expect(
                                report.unicodeIntegrity.some(
                                        (f) => f.severity === "error" && f.message.includes("project.provenance.json"),
                                ),
                        ).toBe(true);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        test("runtime state dirs under .unown/ stay out of the scan scope", () => {
                const dir = freshDir("uni-rt");
                try {
                        writeRel(dir, ".unown/receipts/log.md", `payload \u200B here\n`);
                        const report = auditInstructionSet(dir, optsFor(dir));
                        expect(report.unicodeIntegrity.length).toBe(0);
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});
