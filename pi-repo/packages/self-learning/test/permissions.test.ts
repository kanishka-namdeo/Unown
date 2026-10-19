// permissions.test.ts — the granular permissions layer (src/permissions.ts)
// plus its termhooks integration and the /permissions command.
//
// Coverage contract (task 2-d): config load/merge precedence, the pattern
// matcher (globs, `**`, URLs, bash first-token semantics), validation
// (unknown tools warn, malformed JSON → safe defaults, version field),
// evaluation (deny/allow/ask, modes, the fail-closed degrade path when no
// UI exists, the strict-hook refusal of bypassPermissions), the project
// trust gate, learn mode, the termhooks seam (a deny rule blocks what the
// hard-coded list allows; an allow-all rule can NOT weaken the hard
// deny-list), and the /permissions command rendering.
//
// Runs on `bun test` (bun:test is built in — zero new deps). Fixtures live
// under the shared redirected TEST_TMP root; every permissions scope gets
// its own private agent dir so trust state and learned rules never leak
// between tests (or into the developer's real ~/.unown).
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { TEST_TMP } from "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
        bashLearnPattern,
        createPermissionGate,
        createPermissionsExtension,
        evaluatePermissions,
        extractSubject,
        globMatch,
        loadPermissions,
        normalizePathSubject,
        normalizeUrlSubject,
        mcpSubject,
        parsePersistedRules,
        persistLearnedAllow,
        permissionsDoctorSummary,
        renderPermissionsStatus,
} from "../src/permissions.ts";
import { trustConfig } from "../src/config-trust.ts";
import { createTerminalExtension } from "../src/termhooks.ts";
import { collectInfo } from "../src/info.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ROOT = mkdtempSync(join(TEST_TMP, "permissions-"));

interface Scope {
        cwd: string;
        agentDir: string;
        statePath: string;
}

/** A fresh project dir + private agent dir (trust state + user config). */
function freshScope(): Scope {
        const dir = mkdtempSync(join(ROOT, "s-"));
        const cwd = join(dir, "proj");
        const agentDir = join(dir, "agent");
        mkdirSync(join(cwd, ".unown"), { recursive: true });
        mkdirSync(agentDir, { recursive: true });
        return { cwd, agentDir, statePath: join(agentDir, "trusted-configs.json") };
}

function writeProject(scope: Scope, doc: unknown): string {
        const file = join(scope.cwd, ".unown", "permissions.json");
        writeFileSync(file, typeof doc === "string" ? doc : `${JSON.stringify(doc, null, 2)}\n`);
        return file;
}

function writeUser(scope: Scope, doc: unknown): string {
        const file = join(scope.agentDir, "permissions.json");
        writeFileSync(file, typeof doc === "string" ? doc : `${JSON.stringify(doc, null, 2)}\n`);
        return file;
}

/** Trust the project permissions file (same action as /permissions trust). */
function trustProject(scope: Scope): void {
        trustConfig(join(scope.cwd, ".unown", "permissions.json"), {
                statePath: scope.statePath,
                userDir: scope.agentDir,
        });
}

/** Env without any permissions knobs set (tests add what they need). */
const CLEAN_ENV: Record<string, string | undefined> = {};

afterAll(() => {
        rmSync(ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Pattern matcher
// ---------------------------------------------------------------------------
describe("pattern matcher (globMatch / patternToRegex)", () => {
        test.each([
                // [pattern, value, expected] — path-aware (paths, URLs, mcp names)
                ["src/**", "src/a.ts", true],
                ["src/**", "src/a/b/c.ts", true],
                ["src/**", "src", false], // `**` needs the boundary slash
                ["src/**", "srcx/a.ts", false],
                ["*.ts", "a.ts", true],
                ["*.ts", "src/a.ts", false], // `*` never crosses a segment
                ["**/*.env*", ".env", true], // `**/` may match zero segments
                ["**/*.env*", "a.env", true],
                ["**/*.env*", "x/y/z.env.local", true],
                ["**/*.env*", "a.ts", false],
                ["src/**/test/*.ts", "src/a/b/test/x.ts", true],
                ["src/**/test/*.ts", "src/test/x.ts", true], // zero middle segments
                ["**", "anything/at/all", true],
                ["exact", "exact", true],
                ["exact", "exactly", false],
                ["a.b", "a.b", true], // regex specials are escaped
                ["a.b", "axb", false],
                [".git/**", ".git/config", true],
                [".git/**", ".git/hooks/pre-commit", true],
                [".git/**", "github/config", false],
        ])("path-aware %j vs %j → %s", (pattern: string, value: string, expected: boolean) => {
                expect(globMatch(pattern, value)).toBe(expected);
        });

        test.each([
                // bash mode: `*` matches any characters (incl. spaces) — prefix globs
                ["bun test*", "bun test src/foo.ts", true],
                ["bun test*", "bun test", true],
                ["bun test*", "bunx test", false], // first-token aware
                ["git push*", "git push origin main", true],
                ["git push*", "git status", false],
                ["cargo publish*", "cargo publish --dry-run", true],
                ["ls*", "ls -la", true],
                ["ls", "ls -la", false], // no wildcard → exact match only
        ])("bash-mode %j vs %j → %s", (pattern: string, value: string, expected: boolean) => {
                expect(globMatch(pattern, value, { pathAware: false })).toBe(expected);
        });

        test("URL patterns: segment-local `*`, deep `**`, case-insensitive host", () => {
                expect(globMatch("https://github.com/*", "https://github.com/owner")).toBe(true);
                expect(globMatch("https://github.com/*", "https://github.com/owner/repo")).toBe(false); // one segment
                expect(globMatch("https://github.com/**", "https://github.com/owner/repo/issues")).toBe(true);
                // host case-insensitivity comes from subject normalization:
                expect(globMatch("https://github.com/*", normalizeUrlSubject("https://GITHUB.COM/owner"))).toBe(true);
                expect(globMatch("https://github.com/*", normalizeUrlSubject("https://gitlab.com/owner"))).toBe(false);
                // the path stays case-sensitive
                expect(globMatch("https://github.com/Owner", normalizeUrlSubject("https://github.com/owner"))).toBe(false);
        });

        test("normalizeUrlSubject lowercases scheme+host only", () => {
                expect(normalizeUrlSubject("HTTPS://Example.COM/Path/File?Q=1")).toBe("https://example.com/Path/File?Q=1");
                expect(normalizeUrlSubject("not a url")).toBe("not a url");
                expect(normalizeUrlSubject("")).toBe("");
        });
});

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------
describe("subjects (what a rule's pattern matches)", () => {
        test("normalizePathSubject relativizes in-project absolutes, keeps escapes absolute", () => {
                const cwd = join(ROOT, "subj", "proj");
                mkdirSync(cwd, { recursive: true });
                expect(normalizePathSubject(cwd, join(cwd, "src", "a.ts"))).toBe("src/a.ts");
                const escaped = normalizePathSubject(cwd, join(ROOT, "subj", "other", "x.ts"));
                expect(escaped).toBe(
                        normalizePathSubject(cwd, join(ROOT, "subj", "other", "x.ts")), // stable (absolute form)
                );
                // Escapes stay absolute — on the platform's own spelling: a
                // drive letter on win32 (D:/…), a leading slash on POSIX, so
                // the assertion asks node:path, not the string's first char.
                expect(isAbsolute(escaped)).toBe(true);
                expect(escaped).not.toContain("proj"); // and it was not relativized into the project
                expect(normalizePathSubject(cwd, "./src/x.ts")).toBe("src/x.ts");
                expect(normalizePathSubject(cwd, "src\\x.ts")).toBe("src/x.ts"); // windows spelling
                expect(normalizePathSubject(cwd, "")).toBe("");
        });

        test("mcpSubject derives server/tool from mcp__server__tool names", () => {
                expect(mcpSubject("mcp__github__create_issue")).toBe("github/create_issue");
                expect(mcpSubject("mcp__github")).toBe("github"); // malformed but matchable
                expect(mcpSubject("bash")).toBeNull();
        });

        test("extractSubject picks the right field per tool family", () => {
                const cwd = join(ROOT, "subj2", "proj");
                mkdirSync(cwd, { recursive: true });
                expect(extractSubject("bash", { command: "ls -la" }, cwd)).toBe("ls -la");
                expect(extractSubject("powershell", { command: "Get-ChildItem" }, cwd)).toBe("Get-ChildItem");
                expect(extractSubject("edit", { path: join(cwd, "src", "a.ts") }, cwd)).toBe("src/a.ts");
                expect(extractSubject("write", { file_path: "src/a.ts" }, cwd)).toBe("src/a.ts");
                expect(extractSubject("webfetch", { url: "HTTPS://GitHub.COM/x" }, cwd)).toBe("https://github.com/x");
                expect(extractSubject("mcp__github__create_issue", {}, cwd)).toBe("github/create_issue");
                expect(extractSubject("web_search", { query: "bun test" }, cwd)).toBe("bun test");
                expect(extractSubject("note", { text: "remember this" }, cwd)).toBe("remember this");
                expect(extractSubject("task", { task: "explore the repo" }, cwd)).toBe("explore the repo");
                expect(extractSubject("todo", {}, cwd)).toBe("");
        });

        test("bashLearnPattern: leading command (+ non-flag subcommand) with a trailing *", () => {
                expect(bashLearnPattern("bun test src/foo.ts")).toBe("bun test*");
                expect(bashLearnPattern("cargo publish --dry-run")).toBe("cargo publish*");
                expect(bashLearnPattern("ls -la")).toBe("ls*");
                expect(bashLearnPattern("   ")).toBe("");
        });
});

// ---------------------------------------------------------------------------
// Config load / merge / validation
// ---------------------------------------------------------------------------
describe("loadPermissions — merge + precedence", () => {
        test("user rules win for the same tool+pattern; project rules fill the gaps", () => {
                const s = freshScope();
                writeProject(s, {
                        version: 1,
                        mode: "default",
                        rules: [
                                { tool: "bash", effect: "allow", pattern: "bun test*" },
                                { tool: "bash", effect: "allow", pattern: "git status" },
                        ],
                });
                writeUser(s, { version: 1, mode: "default", rules: [{ tool: "bash", effect: "deny", pattern: "bun test*" }] });
                trustProject(s);
                const loaded = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(loaded.rules).toHaveLength(2);
                const overridden = loaded.rules.find((r) => r.pattern === "bun test*");
                expect(overridden?.effect).toBe("deny");
                expect(overridden?.source).toBe("user");
                const gap = loaded.rules.find((r) => r.pattern === "git status");
                expect(gap?.source).toBe("project");
        });

        test("deny wins over allow at equal specificity (different patterns, same literal length)", () => {
                const s = freshScope();
                // "git push*" and "git push" both have 8 literal chars — deny wins the tie.
                writeUser(s, {
                        version: 1,
                        rules: [
                                { tool: "bash", effect: "deny", pattern: "git push*" },
                                { tool: "bash", effect: "allow", pattern: "git push" },
                        ],
                });
                const loaded = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(evaluatePermissions(loaded, "bash", "git push").action).toBe("deny");
                expect(evaluatePermissions(loaded, "bash", "git push origin main").action).toBe("deny");
        });

        test("a MORE SPECIFIC allow overrides a broader deny", () => {
                const s = freshScope();
                writeProject(s, {
                        version: 1,
                        rules: [{ tool: "bash", effect: "deny", pattern: "git push*" }],
                });
                writeUser(s, {
                        version: 1,
                        rules: [{ tool: "bash", effect: "allow", pattern: "git push --force-with-lease origin main" }],
                });
                trustProject(s);
                const loaded = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(evaluatePermissions(loaded, "bash", "git push --force-with-lease origin main").action).toBe("allow");
                expect(evaluatePermissions(loaded, "bash", "git push origin main").action).toBe("deny");
        });

        test("a session always-allow rule beats a file ask rule of the same pattern", () => {
                const s = freshScope();
                writeUser(s, { version: 1, rules: [{ tool: "bash", effect: "ask", pattern: "cargo publish*" }] });
                const loaded = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                const session = [{ tool: "bash", effect: "allow" as const, pattern: "cargo publish*", source: "session" as const }];
                expect(evaluatePermissions(loaded, "bash", "cargo publish", session).action).toBe("allow");
                // …but never a deny of the same pattern:
                const sessionDeny = [{ tool: "bash", effect: "deny" as const, pattern: "cargo publish*", source: "session" as const }];
                expect(evaluatePermissions(loaded, "bash", "cargo publish", sessionDeny).action).toBe("deny");
        });

        test("mode: the user file's declaration wins; absent user mode lets the project's apply", () => {
                const s = freshScope();
                writeProject(s, { version: 1, mode: "acceptEdits", rules: [] });
                const projectMode = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                trustProject(s);
                const loadedProjectMode = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(loadedProjectMode.mode).toBe("acceptEdits");
                writeUser(s, { version: 1, rules: [] }); // valid user file, no mode field
                expect(loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath }).mode).toBe("acceptEdits");
                writeUser(s, { version: 1, mode: "default", rules: [] });
                expect(loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath }).mode).toBe("default");
                expect(projectMode.mode).toBe("default"); // untrusted project file → its mode is ignored too
        });

        test("UNOWN_PERMISSIONS=0 disables the whole layer (rules inert)", () => {
                const s = freshScope();
                writeUser(s, { version: 1, rules: [{ tool: "bash", effect: "deny", pattern: "*" }] });
                const loaded = loadPermissions(s.cwd, s.agentDir, { UNOWN_PERMISSIONS: "0" }, { statePath: s.statePath });
                expect(loaded.disabled).toBe(true);
                expect(loaded.rules).toEqual([]);
                expect(evaluatePermissions(loaded, "bash", "ls -la").action).toBe("none");
        });
});

describe("loadPermissions — validation", () => {
        test("unknown tool names warn but are kept (not fatal)", () => {
                const s = freshScope();
                writeUser(s, { version: 1, rules: [{ tool: "teleport", effect: "deny", pattern: "*" }] });
                const loaded = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(loaded.warnings.some((w) => w.includes('unknown tool name "teleport"'))).toBe(true);
                expect(loaded.rules).toHaveLength(1); // kept — matches if such a tool ever registers
        });

        test("malformed JSON → safe defaults + warning", () => {
                const s = freshScope();
                writeUser(s, "{ not json");
                const loaded = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(loaded.user.valid).toBe(false);
                expect(loaded.rules).toEqual([]);
                expect(loaded.mode).toBe("default");
                expect(loaded.warnings.some((w) => w.includes("invalid JSON"))).toBe(true);
        });

        test("unsupported version → file ignored + warning; absent version is fine", () => {
                const s = freshScope();
                writeUser(s, { version: 2, rules: [{ tool: "bash", effect: "deny", pattern: "*" }] });
                const v2 = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(v2.rules).toEqual([]);
                expect(v2.warnings.some((w) => w.includes("unsupported version 2"))).toBe(true);
                writeUser(s, { rules: [{ tool: "bash", effect: "deny", pattern: "rm *" }] });
                const noVersion = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(noVersion.rules).toHaveLength(1);
                expect(noVersion.warnings).toEqual([]);
        });

        test("invalid effect / non-string pattern / rules-not-array are skipped with warnings", () => {
                const s = freshScope();
                writeUser(s, {
                        version: 1,
                        rules: [
                                { tool: "bash", effect: "maybe", pattern: "*" },
                                { tool: "bash", effect: "deny", pattern: 42 },
                                { tool: "", effect: "deny" },
                                { tool: "edit", effect: "deny", pattern: "**/*.env*" }, // the good one
                        ],
                });
                const loaded = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(loaded.rules).toHaveLength(1);
                expect(loaded.warnings.some((w) => w.includes("effect must be allow|deny|ask"))).toBe(true);
                expect(loaded.warnings.some((w) => w.includes("pattern must be a string"))).toBe(true);
                expect(loaded.warnings.some((w) => w.includes('missing/empty "tool"'))).toBe(true);
        });

        test("unknown mode → default + warning", () => {
                const s = freshScope();
                writeUser(s, { version: 1, mode: "yolo", rules: [] });
                const loaded = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(loaded.mode).toBe("default");
                expect(loaded.warnings.some((w) => w.includes('unknown mode "yolo"'))).toBe(true);
        });

        test("empty-string pattern behaves like no pattern (matches every call)", () => {
                const s = freshScope();
                writeUser(s, { version: 1, rules: [{ tool: "task", effect: "ask", pattern: "" }] });
                const loaded = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(evaluatePermissions(loaded, "task", "").action).toBe("ask");
        });
});

// ---------------------------------------------------------------------------
// Evaluation — effects and modes
// ---------------------------------------------------------------------------
describe("evaluatePermissions — effects + modes", () => {
        test("deny blocks with the [unown-permissions] reason naming the rule", () => {
                const s = freshScope();
                writeUser(s, { version: 1, rules: [{ tool: "bash", effect: "deny", pattern: "cargo publish*" }] });
                const loaded = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                const d = evaluatePermissions(loaded, "bash", "cargo publish --dry-run");
                expect(d.action).toBe("deny");
                expect(d.reason).toContain("[unown-permissions]");
                expect(d.reason).toContain('denied by rule "cargo publish*"');
                expect(d.reason).toContain("docs/permissions.md");
        });

        test("pattern-less rules match every call of the tool; allow is inert-but-reported", () => {
                const s = freshScope();
                writeUser(s, { version: 1, rules: [{ tool: "task", effect: "allow" }] });
                const loaded = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(evaluatePermissions(loaded, "task", "").action).toBe("allow");
                expect(evaluatePermissions(loaded, "bash", "ls").action).toBe("none");
        });

        test("ask in default mode; bypassPermissions skips the ask (but not deny)", () => {
                const s = freshScope();
                writeUser(s, {
                        version: 1,
                        mode: "default",
                        rules: [
                                { tool: "bash", effect: "ask", pattern: "cargo *" },
                                { tool: "bash", effect: "deny", pattern: "cargo publish*" },
                        ],
                });
                const def = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(evaluatePermissions(def, "bash", "cargo build").action).toBe("ask");
                expect(evaluatePermissions(def, "bash", "cargo publish").action).toBe("deny");
                writeUser(s, {
                        version: 1,
                        mode: "bypassPermissions",
                        rules: [
                                { tool: "bash", effect: "ask", pattern: "cargo *" },
                                { tool: "bash", effect: "deny", pattern: "cargo publish*" },
                        ],
                });
                const bypass = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(bypass.mode).toBe("bypassPermissions");
                expect(evaluatePermissions(bypass, "bash", "cargo build").action).toBe("allow"); // ask skipped
                expect(evaluatePermissions(bypass, "bash", "cargo publish").action).toBe("deny"); // deny survives
        });

        test("bypassPermissions refuses to load under UNOWN_STRICT_HOOKS=1", () => {
                const s = freshScope();
                writeUser(s, { version: 1, mode: "bypassPermissions", rules: [] });
                const loaded = loadPermissions(s.cwd, s.agentDir, { UNOWN_STRICT_HOOKS: "1" }, { statePath: s.statePath });
                expect(loaded.requestedMode).toBe("bypassPermissions");
                expect(loaded.mode).toBe("default");
                expect(loaded.warnings.some((w) => w.includes("bypassPermissions") && w.includes("UNOWN_STRICT_HOOKS"))).toBe(true);
                expect(evaluatePermissions(loaded, "bash", "cargo build").action).toBe("none");
        });

        test("acceptEdits auto-approves ask on in-project edit/write only", () => {
                const s = freshScope();
                writeUser(s, {
                        version: 1,
                        mode: "acceptEdits",
                        rules: [
                                { tool: "edit", effect: "ask" }, // pattern-less: every edit asks
                                { tool: "bash", effect: "ask", pattern: "cargo *" },
                        ],
                });
                const loaded = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(evaluatePermissions(loaded, "edit", "src/a.ts").action).toBe("allow"); // in-project write
                expect(evaluatePermissions(loaded, "edit", "../outside/a.ts").action).toBe("ask"); // out-of-project
                expect(evaluatePermissions(loaded, "edit", "/etc/passwd").action).toBe("ask");
                expect(evaluatePermissions(loaded, "bash", "cargo build").action).toBe("ask"); // not a write tool
        });

        test("mcp rules match server/tool against mcp__server__tool calls", () => {
                const s = freshScope();
                writeUser(s, {
                        version: 1,
                        rules: [
                                { tool: "mcp", effect: "allow", pattern: "github/*" },
                                { tool: "mcp", effect: "deny", pattern: "evil/*" },
                        ],
                });
                const loaded = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(evaluatePermissions(loaded, "mcp__github__create_issue", "github/create_issue").action).toBe("allow");
                expect(evaluatePermissions(loaded, "mcp__evil__run", "evil/run").action).toBe("deny");
        });

        test("bash rules govern the powershell spelling too (deny symmetry)", () => {
                const s = freshScope();
                writeUser(s, { version: 1, rules: [{ tool: "bash", effect: "deny", pattern: "Remove-Item*" }] });
                const loaded = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(evaluatePermissions(loaded, "powershell", "Remove-Item -Recurse ./build").action).toBe("deny");
        });
});

// ---------------------------------------------------------------------------
// Trust gate
// ---------------------------------------------------------------------------
describe("project-config trust gate", () => {
        test("an untrusted project file is ignored (rules + mode) with a warning", () => {
                const s = freshScope();
                writeProject(s, { version: 1, mode: "acceptEdits", rules: [{ tool: "bash", effect: "deny", pattern: "*" }] });
                const loaded = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(loaded.project.ignored).toBe(true);
                expect(loaded.project.trusted).toBe(false);
                expect(loaded.rules).toEqual([]);
                expect(loaded.mode).toBe("default");
                expect(loaded.warnings.some((w) => w.includes("untrusted") && w.includes("/permissions trust"))).toBe(true);
        });

        test("after trustConfig (the /permissions trust action) the file loads", () => {
                const s = freshScope();
                writeProject(s, { version: 1, rules: [{ tool: "bash", effect: "deny", pattern: "cargo publish*" }] });
                trustProject(s);
                const loaded = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(loaded.project.trusted).toBe(true);
                expect(loaded.project.ignored).toBe(false);
                expect(loaded.rules).toHaveLength(1);
        });

        test("a later edit to the trusted file re-arms the gate (fingerprint pins content)", () => {
                const s = freshScope();
                const file = writeProject(s, { version: 1, rules: [{ tool: "bash", effect: "deny", pattern: "a*" }] });
                trustProject(s);
                expect(loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath }).project.trusted).toBe(true);
                writeFileSync(file, `${JSON.stringify({ version: 1, rules: [{ tool: "bash", effect: "deny", pattern: "b*" }] })}\n`);
                const reArmed = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(reArmed.project.ignored).toBe(true);
        });

        test("UNOWN_TRUST_PROJECT_CONFIG=1 bypasses the gate (CI/headless)", () => {
                const s = freshScope();
                writeProject(s, { version: 1, rules: [{ tool: "bash", effect: "deny", pattern: "cargo publish*" }] });
                const loaded = loadPermissions(s.cwd, s.agentDir, { UNOWN_TRUST_PROJECT_CONFIG: "1" }, { statePath: s.statePath });
                expect(loaded.project.ignored).toBe(false);
                expect(loaded.rules).toHaveLength(1);
        });

        test("the user file is always trusted (user-owned dir)", () => {
                const s = freshScope();
                writeUser(s, { version: 1, rules: [{ tool: "bash", effect: "deny", pattern: "cargo publish*" }] });
                const loaded = loadPermissions(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(loaded.user.trusted).toBe(true);
                expect(loaded.rules).toHaveLength(1);
        });

        test("the gate surfaces a one-shot untrusted notice", () => {
                const s = freshScope();
                writeProject(s, { version: 1, rules: [] });
                const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
                const first = gate.consumeUntrustedNotice();
                expect(first).toContain("untrusted");
                expect(gate.consumeUntrustedNotice()).toBeNull(); // once
        });
});

// ---------------------------------------------------------------------------
// Learn mode
// ---------------------------------------------------------------------------
describe("learn mode (UNOWN_PERMISSIONS_LEARN=1)", () => {
        test("a passed bash command with no matching rule appends an allow rule to the USER config", () => {
                const s = freshScope();
                const gate = createPermissionGate({
                        cwd: s.cwd,
                        agentDir: s.agentDir,
                        env: { UNOWN_PERMISSIONS_LEARN: "1" },
                        statePath: s.statePath,
                });
                expect(gate.check("bash", { command: "cargo build --release" })).toEqual({ blocked: false });
                const rules = parsePersistedRules(join(s.agentDir, "permissions.json"));
                expect(rules).toContainEqual({ tool: "bash", effect: "allow", pattern: "cargo build*" });
                // idempotent — the second pass does not duplicate the rule
                expect(gate.check("bash", { command: "cargo build" })).toEqual({ blocked: false });
                expect(parsePersistedRules(join(s.agentDir, "permissions.json"))).toHaveLength(1);
        });

        test("no learning without the env knob, for non-bash tools, or when a rule matched", () => {
                const s = freshScope();
                writeUser(s, { version: 1, rules: [{ tool: "bash", effect: "deny", pattern: "cargo publish*" }] });
                const off = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
                off.check("bash", { command: "bun test x" });
                expect(parsePersistedRules(join(s.agentDir, "permissions.json"))).toHaveLength(1); // only the deny rule

                const on = createPermissionGate({
                        cwd: s.cwd,
                        agentDir: s.agentDir,
                        env: { UNOWN_PERMISSIONS_LEARN: "1" },
                        statePath: s.statePath,
                });
                on.check("read", { path: "src/a.ts" }); // not a bash tool
                const blockedByRule = on.check("bash", { command: "cargo publish" });
                expect(blockedByRule.blocked).toBe(true); // matched the deny rule
                expect(parsePersistedRules(join(s.agentDir, "permissions.json"))).toHaveLength(1); // nothing learned
        });

        test("learning is skipped in non-default modes and never touches a malformed user file", () => {
                const s = freshScope();
                writeUser(s, "{ broken");
                const gate = createPermissionGate({
                        cwd: s.cwd,
                        agentDir: s.agentDir,
                        env: { UNOWN_PERMISSIONS_LEARN: "1" },
                        statePath: s.statePath,
                });
                gate.check("bash", { command: "bun test x" });
                expect(readFileSync(join(s.agentDir, "permissions.json"), "utf8")).toBe("{ broken"); // untouched

                const s2 = freshScope();
                writeUser(s2, { version: 1, mode: "acceptEdits", rules: [] });
                const gate2 = createPermissionGate({
                        cwd: s2.cwd,
                        agentDir: s2.agentDir,
                        env: { UNOWN_PERMISSIONS_LEARN: "1" },
                        statePath: s2.statePath,
                });
                gate2.check("bash", { command: "bun test x" });
                expect(parsePersistedRules(join(s2.agentDir, "permissions.json"))).toEqual([]);
        });

        test("persistLearnedAllow flips a same-pattern ask rule, never a deny; preserves other keys", () => {
                const s = freshScope();
                const file = writeUser(s, {
                        version: 1,
                        mode: "default",
                        customTopLevel: { keep: true },
                        rules: [
                                { tool: "bash", effect: "ask", pattern: "cargo build*" },
                                { tool: "bash", effect: "deny", pattern: "cargo publish*" },
                        ],
                });
                expect(persistLearnedAllow(file, "bash", "cargo build*").ok).toBe(true);
                const doc = JSON.parse(readFileSync(file, "utf8"));
                expect(doc.customTopLevel).toEqual({ keep: true }); // unknown keys preserved
                expect(doc.rules).toContainEqual({ tool: "bash", effect: "allow", pattern: "cargo build*" }); // ask flipped
                expect(doc.rules).toContainEqual({ tool: "bash", effect: "deny", pattern: "cargo publish*" }); // deny kept
                expect(persistLearnedAllow(file, "bash", "cargo publish*").ok).toBe(false); // deny not overridden
        });
});

// ---------------------------------------------------------------------------
// The ask flow — UI present, UI absent, and the fail-closed degrade path
// ---------------------------------------------------------------------------
describe("gate.handleAsk — the documented degrade path", () => {
        function askGate(scope?: Scope) {
                const s = scope ?? freshScope();
                writeUser(s, { version: 1, rules: [{ tool: "bash", effect: "ask", pattern: "cargo *" }] });
                const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
                return { gate, scope: s };
        }

        test("NO UI (print/json mode, missing ctx) → fail-closed block with add-an-allow-rule guidance", async () => {
                const { gate } = askGate();
                const decision = gate.check("bash", { command: "cargo build" });
                expect(decision.needsAsk).toBe(true);
                const out = await gate.handleAsk("bash", { command: "cargo build" }, decision.evaluation!, undefined);
                expect(out?.block).toBe(true);
                expect(out?.reason).toContain("[unown-permissions]");
                expect(out?.reason).toContain("interactive confirmation is unavailable");
                expect(out?.reason).toContain("allow rule");
                // hasUI:false behaves the same (print mode shape)
                const out2 = await gate.handleAsk("bash", { command: "cargo build" }, decision.evaluation!, { hasUI: false, ui: {} });
                expect(out2?.block).toBe(true);
                expect(out2?.reason).toContain("fail-closed");
        });

        test("UI present: Allow once proceeds; Deny blocks at the prompt; timeout fails closed", async () => {
                const { gate } = askGate();
                const decision = gate.check("bash", { command: "cargo build" });
                const ctx = (picked: string | undefined) => ({
                        hasUI: true,
                        ui: { select: async () => picked },
                });
                expect(await gate.handleAsk("bash", { command: "cargo build" }, decision.evaluation!, ctx("Allow once"))).toBeUndefined();
                const denied = await gate.handleAsk("bash", { command: "cargo build" }, decision.evaluation!, ctx("Deny"));
                expect(denied?.block).toBe(true);
                expect(denied?.reason).toContain("denied at the confirmation prompt");
                const timedOut = await gate.handleAsk("bash", { command: "cargo build" }, decision.evaluation!, ctx(undefined));
                expect(timedOut?.block).toBe(true); // dialog dismissed/timed out → fail closed
        });

        test("UI present: Always-allow is session-scoped — the next identical call skips the ask", async () => {
                const { gate } = askGate();
                const ctx = { hasUI: true, ui: { select: async () => "Always allow (this session)" } };
                const first = gate.check("bash", { command: "cargo build --release" });
                expect(first.needsAsk).toBe(true);
                expect(await gate.handleAsk("bash", { command: "cargo build --release" }, first.evaluation!, ctx)).toBeUndefined();
                const second = gate.check("bash", { command: "cargo build --release" });
                expect(second.needsAsk).toBeUndefined(); // session allow rule matched
                expect(second.blocked).toBe(false);
                expect(gate.status().sessionRuleCount).toBe(1);
                const other = gate.check("bash", { command: "cargo publish" });
                expect(other.needsAsk).toBe(true); // different command → still asks
        });

        test("a throwing UI degrades fail-closed (never crashes the tool call)", async () => {
                const { gate } = askGate();
                const decision = gate.check("bash", { command: "cargo build" });
                const ctx = { hasUI: true, ui: { select: async () => { throw new Error("tui exploded"); } } };
                const out = await gate.handleAsk("bash", { command: "cargo build" }, decision.evaluation!, ctx);
                expect(out?.block).toBe(true);
                expect(out?.reason).toContain("fail-closed");
        });
});

// ---------------------------------------------------------------------------
// termhooks integration — the layer augments, never weakens
// ---------------------------------------------------------------------------
type HookHandler = (event: Record<string, unknown>, ctx?: unknown) => unknown;
interface Decision {
        block: boolean;
        reason?: string;
        terminate?: boolean;
}

function attachPerms(scope: Scope, opts: { strict?: boolean; env?: Record<string, string | undefined>; trust?: boolean } = {}) {
        if (opts.trust) trustProject(scope); // BEFORE the gate — it loads configs at creation
        const gate = createPermissionGate({
                cwd: scope.cwd,
                agentDir: scope.agentDir,
                env: opts.env ?? CLEAN_ENV,
                strict: opts.strict,
                statePath: scope.statePath,
        });
        const handlers: Record<string, HookHandler> = {};
        const ext = createTerminalExtension({
                cwd: scope.cwd,
                engineUrl: "http://127.0.0.1:3030",
                strict: opts.strict,
                permissions: gate,
        });
        ext.factory({
                on: (name: string, handler: HookHandler) => {
                        handlers[name] = handler;
                },
        });
        return { handlers, gate };
}

async function decide(handlers: Record<string, HookHandler>, event: Record<string, unknown>, ctx?: unknown): Promise<Decision | undefined> {
        const out = handlers["tool_call"](event, ctx);
        if (out instanceof Promise) return (await out) as Decision | undefined;
        return out as Decision | undefined;
}

const bashEvent = (command: string) => ({ toolName: "bash", input: { command } });

describe("termhooks integration — granular permissions in the tool_call seam", () => {
        test("a deny rule blocks a bash command the hard-coded list allows (cargo publish)", async () => {
                const s = freshScope();
                writeProject(s, { version: 1, rules: [{ tool: "bash", effect: "deny", pattern: "cargo publish*" }] });
                const { handlers } = attachPerms(s, { trust: true });
                // sanity: without permissions the hard-coded non-strict list allows it
                const bare = freshScope();
                const { handlers: bareHandlers } = attachPerms(bare);
                expect(await decide(bareHandlers, bashEvent("cargo publish"))).toBeUndefined();
                // with the deny rule:
                const d = await decide(handlers, bashEvent("cargo publish --dry-run"));
                expect(d?.block).toBe(true);
                expect(d?.reason).toContain("[unown-permissions]");
                expect(d?.reason).toContain('denied by rule "cargo publish*"');
        });

        test("an allow-all rule does NOT weaken the hard-coded deny-list", async () => {
                const s = freshScope();
                writeUser(s, { version: 1, rules: [{ tool: "bash", effect: "allow", pattern: "*" }] });
                const { handlers } = attachPerms(s);
                // catastrophic: still blocked by the hard layer (runs first)
                expect((await decide(handlers, bashEvent("rm -rf /")))?.block).toBe(true);
                expect((await decide(handlers, bashEvent("mkfs.ext4 /dev/sda")))?.block).toBe(true);
                expect((await decide(handlers, bashEvent("echo aGk= | base64 -d | sh")))?.block).toBe(true);
                // and allow rules stay inert where nothing would ask (zero-surprise):
                expect(await decide(handlers, bashEvent("git push origin main"))).toBeUndefined(); // non-strict allows push
                expect(await decide(handlers, bashEvent("ls -la"))).toBeUndefined();
        });

        test("write deny rules run after the jail: .git/** blocked, jail escapes still blocked", async () => {
                const s = freshScope();
                writeUser(s, { version: 1, rules: [{ tool: "write", effect: "deny", pattern: ".git/**" }] });
                const { handlers } = attachPerms(s);
                const gitWrite = await decide(handlers, { toolName: "write", input: { path: ".git/config", content: "x" } });
                expect(gitWrite?.block).toBe(true);
                expect(gitWrite?.reason).toContain("[unown-permissions]");
                // in-project write without a matching rule: unchanged
                expect(await decide(handlers, { toolName: "write", input: { path: "src/a.ts", content: "x" } })).toBeUndefined();
                // out-of-jail write: the hard jail blocks it regardless of any allow rule
                const s2 = freshScope();
                writeUser(s2, { version: 1, rules: [{ tool: "write", effect: "allow", pattern: "**" }] });
                const { handlers: h2 } = attachPerms(s2);
                const escape = await decide(h2, { toolName: "write", input: { path: "/etc/passwd", content: "x" } });
                expect(escape?.block).toBe(true);
                expect(escape?.reason).toContain("escapes the project directory");
        });

        test("deny rules AUGMENT read (reads are otherwise unrestricted)", async () => {
                const s = freshScope();
                writeUser(s, { version: 1, rules: [{ tool: "read", effect: "deny", pattern: "**/*.env*" }] });
                const { handlers } = attachPerms(s);
                const d = await decide(handlers, { toolName: "read", input: { path: ".env.local" } });
                expect(d?.block).toBe(true);
                expect(d?.reason).toContain("[unown-permissions]");
                expect(await decide(handlers, { toolName: "read", input: { path: "src/a.ts" } })).toBeUndefined();
        });

        test("webfetch deny rules match the URL subject", async () => {
                const s = freshScope();
                writeUser(s, { version: 1, rules: [{ tool: "webfetch", effect: "deny", pattern: "https://internal.example.com/**" }] });
                const { handlers } = attachPerms(s);
                const d = await decide(handlers, { toolName: "webfetch", input: { url: "https://INTERNAL.example.com/docs/x" } });
                expect(d?.block).toBe(true);
                expect(d?.reason).toContain("webfetch");
                expect(await decide(handlers, { toolName: "webfetch", input: { url: "https://github.com/owner/repo" } })).toBeUndefined();
        });

        test("an ask rule without a UI degrades fail-closed through the seam (async path)", async () => {
                const s = freshScope();
                writeUser(s, { version: 1, rules: [{ tool: "bash", effect: "ask", pattern: "cargo *" }] });
                const { handlers } = attachPerms(s);
                const out = handlers["tool_call"](bashEvent("cargo build")); // no ctx — print-mode shape
                expect(out instanceof Promise).toBe(true);
                const d = (await out) as Decision;
                expect(d.block).toBe(true);
                expect(d.reason).toContain("interactive confirmation is unavailable");
                expect(d.terminate).toBe(false);
        });

        test("no permissions config → the seam's DECISIONS are byte-for-byte unchanged (always-async contract)", async () => {
                // Milestone 1 (user-configurable hooks) made the tool_call seam
                // async in all cases — pi's emitToolCall awaits its handlers, so
                // a thenable is the sanctioned return shape (see the ask-flow
                // comment in termhooks.ts). The seam contract that must never
                // drift is the DECISION: with no permissions config the layer is
                // inert — allows stay allows (undefined), the hard-coded deny
                // list still returns its exact block shape.
                const s = freshScope();
                const { handlers } = attachPerms(s);
                const out = handlers["tool_call"](bashEvent("ls -la"));
                expect(out instanceof Promise).toBe(true); // always-async since M1
                expect(await out).toBeUndefined();
                expect(await decide(handlers, bashEvent("rm -rf /"))).toEqual({ block: true, reason: expect.any(String), terminate: false });
        });

        test("session_start surfaces the untrusted-project notice exactly once", async () => {
                const s = freshScope();
                writeProject(s, { version: 1, rules: [] });
                const { handlers } = attachPerms(s);
                const notes: Array<[string, string]> = [];
                const ctx = { ui: { notify: (msg: string, type: string) => notes.push([msg, type]) } };
                await handlers["session_start"]({}, ctx);
                await handlers["session_start"]({}, ctx);
                expect(notes).toHaveLength(1);
                expect(notes[0][0]).toContain("untrusted");
                expect(notes[0][1]).toBe("warning");
        });

        test("UNOWN_PERMISSIONS=0 turns the layer off inside the extension too", async () => {
                const s = freshScope();
                writeUser(s, { version: 1, rules: [{ tool: "bash", effect: "deny", pattern: "*" }] });
                const { handlers } = attachPerms(s, { env: { UNOWN_PERMISSIONS: "0" } });
                expect(await decide(handlers, bashEvent("ls -la"))).toBeUndefined();
        });
});

// ---------------------------------------------------------------------------
// /permissions command
// ---------------------------------------------------------------------------
describe("/permissions session command", () => {
        function attachCommand(scope: Scope, opts: { env?: Record<string, string | undefined>; trust?: boolean } = {}) {
                const gate = createPermissionGate({
                        cwd: scope.cwd,
                        agentDir: scope.agentDir,
                        env: opts.env ?? CLEAN_ENV,
                        statePath: scope.statePath,
                });
                if (opts.trust) trustProject(scope);
                const commands: Record<string, { description?: string; handler: (args: string, ctx: any) => Promise<void> }> = {};
                const ext = createPermissionsExtension({ cwd: scope.cwd, agentDir: scope.agentDir, statePath: scope.statePath, gate });
                ext.factory({
                        registerCommand: (name: string, def: any) => {
                                commands[name] = def;
                        },
                });
                const notes: string[] = [];
                const ctx = { ui: { notify: (msg: string) => notes.push(msg) } };
                return { commands, ctx, notes, gate };
        }

        test("renders mode, rule table (tool/effect/pattern/source) and trust state", async () => {
                const s = freshScope();
                writeProject(s, {
                        version: 1,
                        rules: [{ tool: "bash", effect: "deny", pattern: "git push*" }],
                });
                writeUser(s, { version: 1, rules: [{ tool: "bash", effect: "allow", pattern: "bun test*" }] });
                const { commands, ctx, notes } = attachCommand(s, { trust: true });
                expect(commands["permissions"]).toBeDefined();
                expect(commands["permissions"].description).toContain("/permissions trust");
                await commands["permissions"].handler("", ctx);
                const text = notes.join("\n");
                expect(text).toContain("mode: default");
                expect(text).toContain("bun test*");
                expect(text).toContain("git push*");
                expect(text).toContain("user");
                expect(text).toContain("project");
                expect(text).toContain("learn: off");
        });

        test("an untrusted project file renders UNTRUSTED; /permissions trust approves it live", async () => {
                const s = freshScope();
                writeProject(s, { version: 1, rules: [{ tool: "bash", effect: "deny", pattern: "cargo publish*" }] });
                const { commands, ctx, notes } = attachCommand(s);
                await commands["permissions"].handler("", ctx);
                expect(notes.join("\n")).toContain("UNTRUSTED");
                await commands["permissions"].handler("trust", ctx);
                const trusted = notes.join("\n");
                expect(trusted).toContain("Trusted");
                expect(trusted).toContain("1 project rule(s) now active");
                // …and the approval is real: the doctor summary now sees the file
                expect(permissionsDoctorSummary(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath }).ok).toBe(true);
        });

        test("unknown argument → usage; /permissions renders the disabled state too", async () => {
                const s = freshScope();
                const { commands, ctx, notes } = attachCommand(s, { env: { UNOWN_PERMISSIONS: "0" } });
                await commands["permissions"].handler("frobnicate", ctx);
                expect(notes[0]).toContain("Unknown /permissions argument");
                await commands["permissions"].handler("", ctx);
                expect(notes[1]).toContain("DISABLED");
        });

        test("renderPermissionsStatus: no config at all", () => {
                const s = freshScope();
                const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
                const text = renderPermissionsStatus(gate.status());
                expect(text).toContain("mode: default");
                expect(text).toContain("(none — the hard-coded guardrails alone are active)");
        });
});

// ---------------------------------------------------------------------------
// Doctor summary
// ---------------------------------------------------------------------------
describe("permissionsDoctorSummary (unown doctor's permissions check)", () => {
        test("no config → pass with defaults-active detail", () => {
                const s = freshScope();
                const d = permissionsDoctorSummary(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(d.ok).toBe(true);
                expect(d.detail).toContain("no permissions config");
        });

        test("untrusted project file → warn naming /permissions trust", () => {
                const s = freshScope();
                writeProject(s, { version: 1, rules: [] });
                const d = permissionsDoctorSummary(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(d.ok).toBe(false);
                expect(d.detail).toContain("/permissions trust");
        });

        test("valid config → pass with mode + rule counts + learn state", () => {
                const s = freshScope();
                writeProject(s, { version: 1, rules: [{ tool: "bash", effect: "deny", pattern: "git push*" }] });
                writeUser(s, { version: 1, rules: [{ tool: "bash", effect: "allow", pattern: "bun test*" }] });
                trustProject(s);
                const d = permissionsDoctorSummary(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(d.ok).toBe(true);
                expect(d.detail).toContain("mode default");
                expect(d.detail).toContain("2 rule(s) (project 1, user 1)");
                expect(d.detail).toContain("learn off");
        });

        test("disabled layer → pass, explicitly reported", () => {
                const s = freshScope();
                const d = permissionsDoctorSummary(s.cwd, s.agentDir, { UNOWN_PERMISSIONS: "0" }, { statePath: s.statePath });
                expect(d.ok).toBe(true);
                expect(d.detail).toContain("disabled (UNOWN_PERMISSIONS=0)");
        });

        test("malformed file → warn with the problem", () => {
                const s = freshScope();
                writeUser(s, "{ nope");
                const d = permissionsDoctorSummary(s.cwd, s.agentDir, CLEAN_ENV, { statePath: s.statePath });
                expect(d.ok).toBe(false);
                expect(d.detail).toContain("invalid JSON");
        });
});

// ---------------------------------------------------------------------------
// unown info — the two env knobs surface as opt-outs (paste-safe bundles)
// ---------------------------------------------------------------------------
describe("unown info — permissions opt-outs", () => {
        test("UNOWN_PERMISSIONS=0 and UNOWN_PERMISSIONS_LEARN=1 are reported", () => {
                const home = mkdtempSync(join(ROOT, "info-home-"));
                const info = collectInfo({
                        home,
                        env: { UNOWN_PERMISSIONS: "0", UNOWN_PERMISSIONS_LEARN: "1" },
                        repoRoot: "/nonexistent-repo",
                });
                expect(info.optOuts).toContain("UNOWN_PERMISSIONS=0");
                expect(info.optOuts).toContain("UNOWN_PERMISSIONS_LEARN");
        });
});
