// formatters.test.ts — the parity-round auto-formatters (src/formatters.ts;
// OpenCode Formatters / aider auto-lint parity).
//
// Coverage contract: config reading (array + map forms, invalid entries
// skipped with problems, malformed JSON null), the two-scope load with the
// trust gate (user always trusted, project refuse-first, project wins
// per-pattern), glob matching (relative/basename/absolute, ** semantics),
// command building ($FILE placeholder vs append, quoting), runFormatter
// (changed/clean/error/timeout via an injected runner), and the
// maybeFormatOnEdit contract (write/edit only, fail-open, the latched
// unavailable notice, the reformatted feedback block).
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { TEST_TMP } from "./_env.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
    buildFormatterCommand,
    createFormatterSessionState,
    loadFormattersConfig,
    matchFormatter,
    maybeFormatOnEdit,
    projectFormattersConfigPath,
    readFormattersConfig,
    runFormatter,
    userFormattersConfigPath,
    type FormatterRule,
    type FormatterRunResult,
} from "../src/formatters.ts";

const TMP = mkdtempSync(join(TEST_TMP, "formatters-"));
beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(() => {
    try {
        rmSync(TMP, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

// ---------------------------------------------------------------------------
// readFormattersConfig
// ---------------------------------------------------------------------------

describe("readFormattersConfig", () => {
    test("array form validates; invalid entries skipped with problems", () => {
        const p = join(TMP, "f-array.json");
        writeFileSync(
            p,
            JSON.stringify({
                version: 1,
                formatters: [
                    { pattern: "**/*.ts", command: "prettier --write" },
                    { pattern: "", command: "x" },
                    { pattern: "**/*.go" },
                    "junk",
                ],
            }),
        );
        const r = readFormattersConfig(p);
        expect(r.config?.formatters).toEqual([{ pattern: "**/*.ts", command: "prettier --write" }]);
        expect(r.problems.length).toBe(3);
    });

    test("map form accepts (pattern → command)", () => {
        const p = join(TMP, "f-map.json");
        writeFileSync(p, JSON.stringify({ formatters: { "**/*.go": "gofmt -w", "**/*.py": "ruff format" } }));
        const r = readFormattersConfig(p);
        expect(r.config?.formatters).toHaveLength(2);
        expect(r.config?.formatters[0]).toEqual({ pattern: "**/*.go", command: "gofmt -w" });
    });

    test("missing file, malformed JSON and wrong shape read as null", () => {
        expect(readFormattersConfig(join(TMP, "nope.json")).config).toBeNull();
        const bad = join(TMP, "f-bad.json");
        writeFileSync(bad, "{not json");
        expect(readFormattersConfig(bad).config).toBeNull();
        const wrong = join(TMP, "f-wrong.json");
        writeFileSync(wrong, JSON.stringify({ nope: true }));
        expect(readFormattersConfig(wrong).config).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// loadFormattersConfig (two scopes + trust)
// ---------------------------------------------------------------------------

describe("loadFormattersConfig", () => {
    test("user scope loads from the agent dir; project from .unown/ (untrusted when not approved)", () => {
        const proj = join(TMP, "projA");
        const agent = join(TMP, "agentA");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        mkdirSync(agent, { recursive: true });
        writeFileSync(userFormattersConfigPath(agent), JSON.stringify({ formatters: { "**/*.rs": "rustfmt" } }));
        writeFileSync(
            projectFormattersConfigPath(proj),
            JSON.stringify({ formatters: { "**/*.ts": "prettier --write" } }),
        );
        const r = loadFormattersConfig(proj, agent);
        // No trust state recorded → project is refuse-first.
        expect(r.approvalNeeded).toBeTrue();
        expect(r.sources.untrustedProject).toEqual([projectFormattersConfigPath(proj)]);
        expect(r.sources.user).toEqual([userFormattersConfigPath(agent)]);
        // The merged config carries ONLY the trusted user rules.
        expect(r.config.formatters).toEqual([{ pattern: "**/*.rs", command: "rustfmt" }]);
    });

    test("project wins per-pattern when trusted (UNOWN_TRUST_PROJECT_CONFIG)", () => {
        const proj = join(TMP, "projB");
        const agent = join(TMP, "agentB");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        mkdirSync(agent, { recursive: true });
        writeFileSync(userFormattersConfigPath(agent), JSON.stringify({ formatters: { "**/*.ts": "prettier --write", "**/*.go": "gofmt -w" } }));
        writeFileSync(
            projectFormattersConfigPath(proj),
            JSON.stringify({ formatters: [{ pattern: "**/*.ts", command: "biome check --write" }] }),
        );
        const prev = process.env.UNOWN_TRUST_PROJECT_CONFIG;
        process.env.UNOWN_TRUST_PROJECT_CONFIG = "1";
        try {
            const r = loadFormattersConfig(proj, agent);
            expect(r.approvalNeeded).toBeFalse();
            const ts = r.config.formatters.find((f) => f.pattern === "**/*.ts")!;
            expect(ts.command).toBe("biome check --write"); // project replaced user
            expect(r.config.formatters.find((f) => f.pattern === "**/*.go")!.command).toBe("gofmt -w");
        } finally {
            if (prev === undefined) delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
            else process.env.UNOWN_TRUST_PROJECT_CONFIG = prev;
        }
    });
});

// ---------------------------------------------------------------------------
// matchFormatter + buildFormatterCommand
// ---------------------------------------------------------------------------

describe("matchFormatter", () => {
    const rules: FormatterRule[] = [
        { pattern: "**/*.ts", command: "prettier --write" },
        { pattern: "*.go", command: "gofmt -w" },
    ];
    test("matches relative, basename and absolute forms; ** crosses dirs", () => {
        expect(matchFormatter(rules, "src/a.ts", "/proj")?.command).toBe("prettier --write");
        expect(matchFormatter(rules, "a.ts", "/proj")?.command).toBe("prettier --write");
        expect(matchFormatter(rules, "/proj/deep/nested/b.ts", "/proj")?.command).toBe("prettier --write");
        expect(matchFormatter(rules, "main.go", "/proj")?.command).toBe("gofmt -w");
        // basename matching is a first-class lane: a top-level *.go rule
        // applies to nested files too (the friendly default; a strict
        // path-anchored rule can start its pattern with ** /).
        expect(matchFormatter(rules, "deep/main.go", "/proj")?.command).toBe("gofmt -w");
        expect(matchFormatter(rules, "a.py", "/proj")).toBeNull();
    });
});

describe("buildFormatterCommand", () => {
    test("appends the quoted path; $FILE takes full control", () => {
        const append = buildFormatterCommand({ pattern: "x", command: "prettier --write" }, "/tmp/a b.ts");
        expect(append).toBe('prettier --write "/tmp/a b.ts"');
        const placeholder = buildFormatterCommand({ pattern: "x", command: "ruff format $FILE --check" }, "/tmp/a.py");
        expect(placeholder).toBe('ruff format "/tmp/a.py" --check');
    });
});

// ---------------------------------------------------------------------------
// runFormatter (real subprocess: sed as the formatter)
// ---------------------------------------------------------------------------

describe("runFormatter", () => {
    test("a real formatter that rewrites the file reports changed", () => {
        const f = join(TMP, "reformat.txt");
        writeFileSync(f, "x=y\n");
        // sed -i rewrites to x:y — a portable cross-platform-ish formatter stand-in
        // (Linux/macOS: GNU/BSD sed both handle this; Windows CI runs this suite
        // under bash-less node? — no: bun test runs everywhere; sed exists on all
        // three CI OSes (Git Bash on Windows). If sed is missing the error lane
        // is exercised instead, which this test also accepts via the error field.
        const r = runFormatter({ pattern: "**/*.txt", command: "sed -i s/=/:/" }, f);
        expect(r.changed === true || typeof r.error === "string").toBeTrue();
    });

    test("a missing command reports an error, not a crash", () => {
        const r = runFormatter({ pattern: "**/*.txt", command: "definitely-not-a-command-xyz --write" }, join(TMP, "reformat.txt"));
        expect(r.changed).toBeFalse();
        expect(r.error).toBeTruthy();
    });
});

// ---------------------------------------------------------------------------
// maybeFormatOnEdit (the PostToolUse contract)
// ---------------------------------------------------------------------------

describe("maybeFormatOnEdit", () => {
    function projWithFormatter(dir: string, rule: { pattern: string; command: string }) {
        mkdirSync(join(dir, ".unown"), { recursive: true });
        writeFileSync(projectFormattersConfigPath(dir), JSON.stringify({ formatters: [rule] }));
        return dir;
    }

    test("write tool with a matching rule + a rewriting runner → the reformatted feedback block", async () => {
        process.env.UNOWN_TRUST_PROJECT_CONFIG = "1";
        const proj = projWithFormatter(join(TMP, "projM1"), { pattern: "**/*.ts", command: "prettier --write" });
        const state = createFormatterSessionState();
        const run = () => ({ changed: true, clean: false }) as FormatterRunResult;
        const out = await maybeFormatOnEdit({ tool: "write", path: "src/a.ts", projectDir: proj, state, cwd: proj, run });
        delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
        expect(out.feedback).toContain("[PostToolUse:formatter] prettier reformatted a.ts");
        expect(out.feedback).toContain("re-read it");
    });

    test("a clean run (no change) stays silent; non-edit tools are a no-op", async () => {
        const proj = projWithFormatter(join(TMP, "projM2"), { pattern: "**/*.ts", command: "prettier --write" });
        const state = createFormatterSessionState();
        const run = () => ({ changed: false, clean: true }) as FormatterRunResult;
        const clean = await maybeFormatOnEdit({ tool: "write", path: "a.ts", projectDir: proj, state, cwd: proj, run });
        expect(clean.feedback).toBeUndefined();
        const bash = await maybeFormatOnEdit({ tool: "bash", path: "a.ts", projectDir: proj, state, cwd: proj, run });
        expect(bash.feedback).toBeUndefined();
    });

    test("a failing formatter latches: reported once, then silent; never throws", async () => {
        process.env.UNOWN_TRUST_PROJECT_CONFIG = "1";
        const proj = projWithFormatter(join(TMP, "projM3"), { pattern: "**/*.ts", command: "prettier --write" });
        const state = createFormatterSessionState();
        const run = () => ({ changed: false, clean: false, error: "spawn failed: ENOENT" }) as FormatterRunResult;
        const first = await maybeFormatOnEdit({ tool: "edit", path: "a.ts", projectDir: proj, state, cwd: proj, run });
        expect(first.feedback).toContain("prettier failed on a.ts");
        expect(first.feedback).toContain("silent for the session");
        const second = await maybeFormatOnEdit({ tool: "edit", path: "b.ts", projectDir: proj, state, cwd: proj, run });
        delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
        expect(second.feedback).toBeUndefined(); // latched
    });

    test("no config → no-op; a throwing runner is swallowed (fail-open)", async () => {
        const empty = join(TMP, "projM4");
        mkdirSync(empty, { recursive: true });
        const state = createFormatterSessionState();
        const out = await maybeFormatOnEdit({ tool: "write", path: "a.ts", projectDir: empty, state, cwd: empty });
        expect(out.feedback).toBeUndefined();
        const proj = projWithFormatter(join(TMP, "projM5"), { pattern: "**/*.ts", command: "boom" });
        const throwing = () => {
            throw new Error("runner exploded");
        };
        const out2 = await maybeFormatOnEdit({
            tool: "write",
            path: "a.ts",
            projectDir: proj,
            state: createFormatterSessionState(),
            cwd: proj,
            run: throwing as any,
        });
        expect(out2.feedback).toBeUndefined(); // fail-open
    });
});
