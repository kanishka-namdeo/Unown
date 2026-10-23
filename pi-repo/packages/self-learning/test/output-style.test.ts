// Unit tests for src/output-style.ts — output styles / personas
// (Claude Code /output-style parity, v0.0.7).
//
// Pins:
//   - the four built-ins: presence, order, sources, the EMPTY directive on
//     default (selecting default = no system-prompt appendix), real 25-60
//     word directives on the others (a stub directive would ship);
//   - parseStyleFile: frontmatter + body, fallback name when frontmatter is
//     missing, empty body → undefined, name sanitization (lowercase kebab,
//     1-32 chars) and all-punctuation names rejected, broken YAML → skip;
//   - discoverCustomStyles: project dir then user dir, PROJECT wins the
//     name collision, unreadable entries skipped silently (a directory
//     named *.md — deterministic on every platform, unlike chmod tricks),
//     sorted output, missing dirs → [];
//   - listStyles / resolveStyle: customs replace built-ins by name,
//     case-insensitive resolution, "" → default;
//   - styleSystemPromptAppendix: exact pinned wrapper, "" for default;
//   - activeStyleName precedence chain: UNOWN_OUTPUT_STYLE env (empty =
//     unset) > project .unown/output-style.json > user
//     ${UNOWN_HOME}/agent/output-style.json > "default";
//   - saveActiveStyle: atomic write into the PROJECT file, canonical name,
//     round-trip through activeStyleName, Error("unknown output style").
//
// Every env-taking call passes an explicit env object whose UNOWN_HOME is a
// per-test temp dir — the developer's real ~/.unown is never read or
// written (the 2026-10-22 writeAgentConfig incident's rule). _env.ts stays
// the first import (store.ts SQLite bootstrap).
import "./_env.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    BUILTIN_OUTPUT_STYLES,
    activeStyleName,
    describeStyles,
    discoverCustomStyles,
    listStyles,
    outputStyleFile,
    parseStyleFile,
    resolveStyle,
    saveActiveStyle,
    sanitizeStyleName,
    styleSystemPromptAppendix,
    userStylesDir,
    type OutputStyle,
} from "../src/output-style.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

function makeTmp(): string {
    const dir = mkdtempSync(join(tmpdir(), "unown-output-style-"));
    tmpDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tmpDirs.length > 0) {
        const dir = tmpDirs.pop();
        if (dir !== undefined) {
            try {
                rmSync(dir, { recursive: true, force: true });
            } catch {
                /* best-effort cleanup */
            }
        }
    }
});

/** A project checkout + an isolated UNOWN_HOME, with the env object that ties them together. */
function setupProject(): { cwd: string; home: string; env: NodeJS.ProcessEnv } {
    const cwd = makeTmp();
    const home = makeTmp();
    return { cwd, home, env: { UNOWN_HOME: home } };
}

function writeStyleFile(dir: string, file: string, content: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), content, "utf8");
}

function writeJson(path: string, content: string): void {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
}

function styleFile(name: string, description: string, directive: string): string {
    return `---\nname: ${name}\ndescription: ${description}\n---\n${directive}\n`;
}

// ---------------------------------------------------------------------------
// Built-ins
// ---------------------------------------------------------------------------

describe("BUILTIN_OUTPUT_STYLES", () => {
    test("four built-ins, shipped order, all source built-in", () => {
        expect(BUILTIN_OUTPUT_STYLES.map((s) => s.name)).toEqual(["default", "concise", "explanatory", "proactive"]);
        for (const style of BUILTIN_OUTPUT_STYLES) {
            expect(style.source).toBe("built-in");
            expect(style.description.trim().length).toBeGreaterThan(0);
        }
    });

    test("default carries an EMPTY directive — selecting it appends nothing", () => {
        const byName = new Map(BUILTIN_OUTPUT_STYLES.map((s) => [s.name, s]));
        expect(byName.get("default")!.directive).toBe("");
        expect(styleSystemPromptAppendix(byName.get("default")!)).toBe("");
    });

    test("non-default built-ins carry real 25-60 word directives (no emoji, no stubs)", () => {
        for (const style of BUILTIN_OUTPUT_STYLES) {
            if (style.name === "default") continue;
            const words = style.directive.trim().split(/\s+/).filter((w) => w.length > 0).length;
            expect(words).toBeGreaterThanOrEqual(25);
            expect(words).toBeLessThanOrEqual(60);
        }
    });
});

// ---------------------------------------------------------------------------
// sanitizeStyleName
// ---------------------------------------------------------------------------

describe("sanitizeStyleName", () => {
    test("lowercase kebab, punctuation collapsed, edges trimmed", () => {
        expect(sanitizeStyleName("My Cool Style!")).toBe("my-cool-style");
        expect(sanitizeStyleName("  Extra   Spaces  ")).toBe("extra-spaces");
        expect(sanitizeStyleName("UPPER")).toBe("upper");
    });

    test("capped at 32 chars; all-punctuation names sanitized to empty", () => {
        expect(sanitizeStyleName("a".repeat(40))).toBe("a".repeat(32));
        expect(sanitizeStyleName("###")).toBe("");
        expect(sanitizeStyleName("---")).toBe("");
        expect(sanitizeStyleName("Wèird Name")).toBe("w-ird-name");
    });
});

// ---------------------------------------------------------------------------
// parseStyleFile
// ---------------------------------------------------------------------------

describe("parseStyleFile", () => {
    test("frontmatter name/description + body directive, name sanitized", () => {
        const style = parseStyleFile(styleFile("My Style", "terse mode", "Be terse always."), "fallback");
        expect(style).toEqual({
            name: "my-style",
            description: "terse mode",
            directive: "Be terse always.",
            source: "project",
        });
    });

    test("missing frontmatter → fallback name used, no description", () => {
        const style = parseStyleFile("Just say less. Every time.", "fallback");
        expect(style).toEqual({
            name: "fallback",
            description: "",
            directive: "Just say less. Every time.",
            source: "project",
        });
    });

    test("empty or whitespace-only body → undefined (a style with no directive is not a style)", () => {
        expect(parseStyleFile("---\nname: x\n---\n", "fallback")).toBeUndefined();
        expect(parseStyleFile("---\nname: x\n---\n   \n\t\n", "fallback")).toBeUndefined();
        expect(parseStyleFile("", "fallback")).toBeUndefined();
    });

    test("bad name chars: sanitized when salvageable, rejected when not", () => {
        expect(parseStyleFile(styleFile("My Cool Style!", "d", "Body."), "fallback")!.name).toBe("my-cool-style");
        // YAML quirk worth pinning: an UNQUOTED '###' value is a comment, so the
        // name is absent and the fallback legitimately wins.
        expect(parseStyleFile(styleFile("###", "d", "Body."), "fallback")!.name).toBe("fallback");
        // A QUOTED all-punctuation name survives YAML but sanitizes to nothing → rejected.
        expect(parseStyleFile("---\nname: '###'\ndescription: d\n---\nBody.", "fallback")).toBeUndefined();
        expect(parseStyleFile("Body only.", "###")).toBeUndefined(); // fallback unsalvageable too
    });

    test("over-long names are capped at 32 chars", () => {
        expect(parseStyleFile(styleFile("n".repeat(40), "d", "Body."), "fallback")!.name).toBe("n".repeat(32));
    });

    test("non-string frontmatter name falls back to the file name", () => {
        expect(parseStyleFile("---\nname: 42\ndescription: d\n---\nBody.", "fb")!.name).toBe("fb");
    });

    test("broken YAML frontmatter → undefined (file skipped whole, not half-loaded)", () => {
        expect(parseStyleFile("---\nname: [unclosed\n---\nBody.", "fallback")).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// discoverCustomStyles
// ---------------------------------------------------------------------------

describe("discoverCustomStyles", () => {
    test("project + user styles, sorted by name, correct sources", () => {
        const { cwd, home, env } = setupProject();
        writeStyleFile(join(cwd, ".unown", "styles"), "alpha.md", styleFile("alpha", "project style", "Project body."));
        writeStyleFile(join(home, "agent", "styles"), "zulu.md", styleFile("zulu", "user style", "User body."));

        const styles = discoverCustomStyles(cwd, env);
        expect(styles.map((s) => s.name)).toEqual(["alpha", "zulu"]);
        expect(styles.find((s) => s.name === "alpha")!.source).toBe("project");
        expect(styles.find((s) => s.name === "zulu")!.source).toBe("user");
    });

    test("name collision: project wins, the user entry is filtered out", () => {
        const { cwd, home, env } = setupProject();
        writeStyleFile(join(cwd, ".unown", "styles"), "dup.md", styleFile("dup", "d", "Project directive."));
        writeStyleFile(join(home, "agent", "styles"), "dup.md", styleFile("dup", "d", "User directive."));

        const styles = discoverCustomStyles(cwd, env);
        expect(styles.length).toBe(1);
        expect(styles[0].source).toBe("project");
        expect(styles[0].directive).toBe("Project directive.");
    });

    test("unreadable entries are skipped silently (a directory named *.md)", () => {
        const { cwd, home, env } = setupProject();
        mkdirSync(join(cwd, ".unown", "styles"), { recursive: true });
        mkdirSync(join(cwd, ".unown", "styles", "unreadable.md"), { recursive: true }); // EISDIR on read
        writeStyleFile(join(cwd, ".unown", "styles"), "ok.md", styleFile("ok", "d", "Ok body."));

        const styles = discoverCustomStyles(cwd, env);
        expect(styles.map((s) => s.name)).toEqual(["ok"]);
    });

    test("unparsable and empty-body files are skipped", () => {
        const { cwd, env } = setupProject();
        const dir = join(cwd, ".unown", "styles");
        writeStyleFile(dir, "broken.md", "---\nname: [unclosed\n---\nBody.");
        writeStyleFile(dir, "empty.md", "---\nname: empty\n---\n\n");
        writeStyleFile(dir, "good.md", styleFile("good", "d", "Good body."));

        expect(discoverCustomStyles(cwd, env).map((s) => s.name)).toEqual(["good"]);
    });

    test("file without frontmatter uses the file name (sans .md) as the style name", () => {
        const { cwd, env } = setupProject();
        writeStyleFile(join(cwd, ".unown", "styles"), "from-filename.md", "Directive only, no frontmatter.");
        const styles = discoverCustomStyles(cwd, env);
        expect(styles.length).toBe(1);
        expect(styles[0].name).toBe("from-filename");
        expect(styles[0].directive).toBe("Directive only, no frontmatter.");
    });

    test("missing dirs → []", () => {
        const { cwd, home, env } = setupProject();
        expect(discoverCustomStyles(cwd, env)).toEqual([]);
        expect(existsSync(join(home, "agent", "styles"))).toBe(false);
        expect(userStylesDir(env)).toBe(join(home, "agent", "styles"));
    });
});

// ---------------------------------------------------------------------------
// listStyles + resolveStyle
// ---------------------------------------------------------------------------

describe("listStyles", () => {
    test("built-ins first; a custom replaces the same-named built-in in place; extras appended", () => {
        const { cwd, env } = setupProject();
        const dir = join(cwd, ".unown", "styles");
        writeStyleFile(dir, "concise.md", styleFile("concise", "team terse", "Team terse directive."));
        writeStyleFile(dir, "extra.md", styleFile("extra", "an extra", "Extra directive."));

        const styles = listStyles(cwd, env);
        expect(styles.map((s) => s.name)).toEqual(["default", "concise", "explanatory", "proactive", "extra"]);
        const concise = styles.find((s) => s.name === "concise")!;
        expect(concise.source).toBe("project");
        expect(concise.directive).toBe("Team terse directive.");
        expect(styles.find((s) => s.name === "extra")!.source).toBe("project");
        expect(styles.find((s) => s.name === "default")!.source).toBe("built-in");
    });

    test("no custom styles → exactly the built-ins", () => {
        const { cwd, env } = setupProject();
        expect(listStyles(cwd, env)).toEqual(BUILTIN_OUTPUT_STYLES);
    });
});

describe("resolveStyle", () => {
    test('"default" and "" resolve to the default built-in', () => {
        const { cwd, env } = setupProject();
        const expected = BUILTIN_OUTPUT_STYLES.find((s) => s.name === "default")!;
        expect(resolveStyle("default", cwd, env)).toEqual(expected);
        expect(resolveStyle("", cwd, env)).toEqual(expected);
    });

    test("case-insensitive, whitespace-tolerant", () => {
        const { cwd, env } = setupProject();
        expect(resolveStyle("CONCISE", cwd, env)!.name).toBe("concise");
        expect(resolveStyle("  Concise ", cwd, env)!.name).toBe("concise");
    });

    test("customs shadow built-ins of the same name", () => {
        const { cwd, env } = setupProject();
        writeStyleFile(join(cwd, ".unown", "styles"), "concise.md", styleFile("concise", "team terse", "Team terse directive."));
        const resolved = resolveStyle("concise", cwd, env);
        expect(resolved!.source).toBe("project");
        expect(resolved!.directive).toBe("Team terse directive.");
    });

    test("unknown names → undefined", () => {
        const { cwd, env } = setupProject();
        expect(resolveStyle("nope", cwd, env)).toBeUndefined();
        expect(resolveStyle("  ", cwd, env)!.name).toBe("default"); // blank means default, not unknown
    });
});

// ---------------------------------------------------------------------------
// styleSystemPromptAppendix
// ---------------------------------------------------------------------------

describe("styleSystemPromptAppendix", () => {
    test("default (empty directive) → empty string", () => {
        expect(styleSystemPromptAppendix(BUILTIN_OUTPUT_STYLES[0])).toBe("");
    });

    test("pinned fenced wrapper for a non-default style", () => {
        const concise = BUILTIN_OUTPUT_STYLES.find((s) => s.name === "concise")!;
        expect(styleSystemPromptAppendix(concise)).toBe(`\n\n## Output style: concise\n\n${concise.directive.trim()}\n`);
    });

    test("custom style gets its own name in the wrapper", () => {
        const custom: OutputStyle = {
            name: "alpha",
            description: "d",
            directive: "Do the thing.",
            source: "project",
        };
        expect(styleSystemPromptAppendix(custom)).toBe("\n\n## Output style: alpha\n\nDo the thing.\n");
    });
});

// ---------------------------------------------------------------------------
// activeStyleName + saveActiveStyle
// ---------------------------------------------------------------------------

describe("activeStyleName precedence", () => {
    test("UNOWN_OUTPUT_STYLE env wins over both files; empty env value counts as unset", () => {
        const { cwd, home, env } = setupProject();
        writeJson(outputStyleFile(cwd), '{"name":"concise"}');
        writeJson(join(home, "agent", "output-style.json"), '{"name":"explanatory"}');

        expect(activeStyleName(cwd, { ...env, UNOWN_OUTPUT_STYLE: "proactive" })).toBe("proactive");
        expect(activeStyleName(cwd, { ...env, UNOWN_OUTPUT_STYLE: "" })).toBe("concise");
    });

    test("project file beats user file; user file beats default", () => {
        const { cwd, home, env } = setupProject();
        writeJson(join(home, "agent", "output-style.json"), '{"name":"explanatory"}');
        expect(activeStyleName(cwd, env)).toBe("explanatory"); // user only

        writeJson(outputStyleFile(cwd), '{"name":"concise"}');
        expect(activeStyleName(cwd, env)).toBe("concise"); // project wins
    });

    test("nothing set → default", () => {
        const { cwd, env } = setupProject();
        expect(activeStyleName(cwd, env)).toBe("default");
    });

    test("malformed or empty-named files are skipped, not fatal", () => {
        const { cwd, home, env } = setupProject();
        writeJson(outputStyleFile(cwd), "not json at all");
        writeJson(join(home, "agent", "output-style.json"), '{"name":""}');
        expect(activeStyleName(cwd, env)).toBe("default");

        writeJson(join(home, "agent", "output-style.json"), '{"name":"explanatory"}');
        expect(activeStyleName(cwd, env)).toBe("explanatory"); // broken project file falls through
    });
});

describe("saveActiveStyle", () => {
    test("writes the PROJECT file, canonicalizes the name, round-trips through activeStyleName", () => {
        const { cwd, home, env } = setupProject();
        saveActiveStyle(cwd, "CONCISE", env);
        const file = outputStyleFile(cwd);
        expect(existsSync(file)).toBe(true);
        expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ name: "concise" });
        expect(activeStyleName(cwd, { UNOWN_HOME: home })).toBe("concise");
        expect(existsSync(join(home, "agent", "output-style.json"))).toBe(false); // user file never touched
    });

    test("saves custom (project) styles too", () => {
        const { cwd, env } = setupProject();
        writeStyleFile(join(cwd, ".unown", "styles"), "alpha.md", styleFile("alpha", "d", "Alpha directive."));
        saveActiveStyle(cwd, "Alpha", env);
        expect(activeStyleName(cwd, env)).toBe("alpha");
        expect(resolveStyle("alpha", cwd, env)!.directive).toBe("Alpha directive.");
    });

    test("unknown style throws Error('unknown output style') and writes nothing", () => {
        const { cwd, env } = setupProject();
        expect(() => saveActiveStyle(cwd, "bogus", env)).toThrow("unknown output style");
        expect(existsSync(outputStyleFile(cwd))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// describeStyles
// ---------------------------------------------------------------------------

describe("describeStyles", () => {
    test("one line per style: name (source) — description, built-ins first", () => {
        const { cwd, env } = setupProject();
        writeStyleFile(join(cwd, ".unown", "styles"), "alpha.md", styleFile("alpha", "an extra style", "Alpha directive."));

        const text = describeStyles(cwd, env);
        const lines = text.split("\n");
        expect(lines.length).toBe(5);
        expect(lines[0]).toBe(`default (built-in) — ${BUILTIN_OUTPUT_STYLES[0].description}`);
        expect(lines[1]).toBe(`concise (built-in) — ${BUILTIN_OUTPUT_STYLES.find((s) => s.name === "concise")!.description}`);
        expect(lines[4]).toBe("alpha (project) — an extra style");
    });
});
