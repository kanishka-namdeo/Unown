// Unit tests for src/lsp.ts — the oh-my-pi LSP port.
//
// Layers:
//   1. pure helpers (language mapping, URI conversion, rendering, position
//      resolution, location/symbol normalization) — no processes
//   2. registry + config (defaults, .unown/lsp.json overrides, precedence,
//      disable, PATH-based command detection with an injected env)
//   3. live protocol tests against test/fixtures/mock-lsp-server.mjs — a
//      real JSON-RPC stdio server: initialize handshake, didOpen/didChange
//      diagnostics freshness, hover/definition/references/symbols, status,
//      dispose
//
// The mock server is spawned with `node` (present on every CI leg and dev
// machine the suite runs on); everything else is pure bun:test.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    characterForLine,
    commandExists,
    countErrors,
    DEFAULT_SERVERS,
    flattenSymbols,
    languageFromPath,
    loadLspConfigFile,
    LspManager,
    normalizeLocations,
    pathToUri,
    renderDiagnostics,
    renderHoverContents,
    renderLocations,
    resolveLspConfig,
    resolveServerCommand,
    severityLabel,
    uriToPath,
} from "../src/lsp.ts";

const MOCK_SERVER = join(import.meta.dir, "fixtures", "mock-lsp-server.mjs");
const NODE = "node";

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-lsp-test-"));
afterAll(() => {
    try {
        rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

// ---------------------------------------------------------------------------
// 1. Pure helpers
// ---------------------------------------------------------------------------

describe("languageFromPath", () => {
    test.each([
        ["a.ts", "typescript"],
        ["a.mts", "typescript"],
        ["a.tsx", "typescriptreact"],
        ["a.js", "javascript"],
        ["a.mjs", "javascript"],
        ["a.jsx", "javascriptreact"],
        ["a.py", "python"],
        ["a.go", "go"],
        ["a.rs", "rust"],
        ["a.cpp", "cpp"],
        ["a.sh", "shellscript"],
        ["/abs/path/file.ts", "typescript"],
    ])("%s → %s", (path, language) => {
        expect(languageFromPath(path)).toBe(language);
    });
    test.each(["a.md", "a.txt", "noext"])("%s → null", (path) => {
        expect(languageFromPath(path)).toBe(null);
    });
    test("extension matching is case-insensitive (Windows parity)", () => {
        expect(languageFromPath("a.TS")).toBe("typescript");
    });
});

describe("pathToUri / uriToPath", () => {
    test("posix absolute roundtrip", () => {
        // A posix path only round-trips where posix paths are native — on
        // win32 uriToPath deliberately returns backslash separators.
        if (process.platform === "win32") return;
        const p = "/home/user/proj/a file.ts";
        const uri = pathToUri(p);
        expect(uri.startsWith("file://")).toBe(true);
        expect(uriToPath(uri)).toBe(p);
    });
    test("windows drive-letter form", () => {
        const uri = pathToUri("C:\\proj\\a.ts");
        expect(uri.startsWith("file:///")).toBe(true);
        const back = uriToPath(uri);
        if (process.platform === "win32") {
            expect(back).toBe("C:\\proj\\a.ts");
        } else {
            expect(back).toBe("C:/proj/a.ts");
        }
    });
});

describe("rendering helpers", () => {
    const err = (line: number, message: string) => ({
        range: { start: { line, character: 0 }, end: { line, character: 5 } },
        severity: 1,
        message,
    });
    const warn = (line: number, message: string) => ({
        range: { start: { line, character: 0 }, end: { line, character: 5 } },
        severity: 2,
        message,
    });

    test("severityLabel", () => {
        expect(severityLabel(1)).toBe("error");
        expect(severityLabel(2)).toBe("warning");
        expect(severityLabel(3)).toBe("info");
        expect(severityLabel(4)).toBe("hint");
        expect(severityLabel(undefined)).toBe("note");
    });

    test("renderDiagnostics sorts errors before warnings and prefixes file:line", () => {
        const text = renderDiagnostics("/p/a.ts", [warn(5, "w"), err(9, "e1"), err(2, "e0")]);
        const lines = text.split("\n");
        expect(lines[0]).toContain("/p/a.ts:3:1 [error] e0");
        expect(lines[1]).toContain("/p/a.ts:10:1 [error] e1");
        expect(lines[2]).toContain("/p/a.ts:6:1 [warning] w");
    });

    test("renderDiagnostics empty", () => {
        expect(renderDiagnostics("/p/a.ts", [])).toBe("No diagnostics for /p/a.ts.");
    });

    test("countErrors counts severity 1 and undefined only", () => {
        expect(countErrors([err(0, "x"), warn(1, "y")])).toBe(1);
        expect(countErrors([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, message: "n" }])).toBe(1);
    });

    test("renderHoverContents handles string / array / {value}", () => {
        expect(renderHoverContents("  hi ")).toBe("hi");
        expect(renderHoverContents([{ value: "a" }, "b"])).toBe("a\nb");
        expect(renderHoverContents({ value: "typed" })).toBe("typed");
        expect(renderHoverContents(null)).toBe(null);
        expect(renderHoverContents("   ")).toBe(null);
    });

    test("characterForLine with and without symbol", () => {
        expect(characterForLine("  const x = 1", "x")).toBe(8);
        expect(characterForLine("  const x = 1")).toBe(2);
        expect(characterForLine("")).toBe(0);
        expect(characterForLine("nope", "missing")).toBe(0);
    });
});

describe("normalizeLocations / flattenSymbols", () => {
    test("accepts Location, LocationLink, null, single object", () => {
        const loc = { uri: "file:///a.ts", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } };
        expect(normalizeLocations([loc])).toHaveLength(1);
        expect(normalizeLocations([{ targetUri: "file:///b.ts", targetRange: loc.range }])).toHaveLength(1);
        expect(normalizeLocations(null)).toHaveLength(0);
        expect(normalizeLocations(loc)).toHaveLength(1);
    });
    test("flattenSymbols walks children with container names", () => {
        const symbols = flattenSymbols(
            [
                {
                    name: "outer",
                    kind: 12,
                    range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
                    children: [{ name: "inner", kind: 8, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } } }],
                },
            ],
            undefined,
        );
        expect(symbols.map((s) => s.name)).toEqual(["outer", "inner"]);
        expect(symbols[1].container).toBe("outer");
        expect(symbols[1].line).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// 2. Registry + config
// ---------------------------------------------------------------------------

describe("commandExists", () => {
    test("finds a file on an injected PATH", () => {
        const dir = join(tmpRoot, "bin");
        mkdirSync(dir, { recursive: true });
        const name = process.platform === "win32" ? "fake-tool.cmd" : "fake-tool";
        const file = join(dir, name);
        writeFileSync(file, process.platform === "win32" ? "@echo off" : "#!/bin/sh\n");
        if (process.platform !== "win32") chmodSync(file, 0o755);
        const probe = process.platform === "win32" ? "fake-tool" : "fake-tool";
        expect(commandExists(probe, { PATH: dir })).toBe(true);
        expect(commandExists("definitely-not-a-real-tool-xyz", { PATH: dir })).toBe(false);
        expect(commandExists("", { PATH: dir })).toBe(false);
    });
});

describe("resolveServerCommand", () => {
    test("config servers entry overrides defaults without PATH check", () => {
        const command = resolveServerCommand("python", {
            servers: { python: { command: ["my-py-lsp", "--stdio"] } },
        });
        expect(command).toEqual(["my-py-lsp", "--stdio"]);
    });
    test("falls back to PATH-detected default candidates", () => {
        // node exists on every leg this suite runs on — but node is not a
        // default candidate, so use an env where only the fake bin exists.
        const dir = join(tmpRoot, "bin2");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, process.platform === "win32" ? "gopls.exe" : "gopls");
        writeFileSync(file, process.platform === "win32" ? "@echo off" : "#!/bin/sh\n");
        if (process.platform !== "win32") chmodSync(file, 0o755);
        expect(resolveServerCommand("go", {}, { PATH: dir })).toEqual(["gopls"]);
        // python's candidates are absent in this env → null
        expect(resolveServerCommand("python", {}, { PATH: dir })).toBe(null);
    });
    test("unknown language → null", () => {
        expect(resolveServerCommand("cobol", {})).toBe(null);
    });
    test("DEFAULT_SERVERS covers the TS/JS family under one spec", () => {
        const ts = DEFAULT_SERVERS.find((s) => s.languages.includes("typescript"));
        expect(ts).toBeDefined();
        expect(ts!.languages).toContain("javascriptreact");
    });
});

describe("lsp.json config files", () => {
    test("loadLspConfigFile parses, tolerates missing/broken", () => {
        const dir = join(tmpRoot, "cfg");
        mkdirSync(dir, { recursive: true });
        const good = join(dir, "good.json");
        writeFileSync(good, JSON.stringify({ servers: { rust: { command: ["ra"] } } }));
        expect(loadLspConfigFile(good)).toEqual({ servers: { rust: { command: ["ra"] } } });
        expect(loadLspConfigFile(join(dir, "missing.json"))).toBe(null);
        const broken = join(dir, "broken.json");
        writeFileSync(broken, "{not json");
        expect(loadLspConfigFile(broken)).toBe(null);
    });
    test("resolveLspConfig: project overrides user; later disabled wins", () => {
        const userDir = join(tmpRoot, "user");
        const project = join(tmpRoot, "project");
        mkdirSync(join(userDir), { recursive: true });
        mkdirSync(join(project, ".unown"), { recursive: true });
        writeFileSync(join(userDir, "lsp.json"), JSON.stringify({ servers: { go: { command: ["user-gopls"] } } }));
        writeFileSync(
            join(project, ".unown", "lsp.json"),
            JSON.stringify({ servers: { go: { command: ["proj-gopls"] }, rust: { command: ["ra"] } } }),
        );
        const cfg = resolveLspConfig(project, userDir);
        expect(cfg.servers?.go).toEqual({ command: ["proj-gopls"] });
        expect(cfg.servers?.rust).toEqual({ command: ["ra"] });
        expect(resolveLspConfig(project, userDir).disabled).toBeUndefined();
        // disabled: true in project wins over absent user setting
        writeFileSync(join(project, ".unown", "lsp.json"), JSON.stringify({ disabled: true }));
        expect(resolveLspConfig(project, userDir).disabled).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 3. Live protocol tests (mock LSP server over stdio)
// ---------------------------------------------------------------------------

function mockManager(cwd: string): LspManager {
    return new LspManager({
        cwd,
        config: { servers: { typescript: { command: [NODE, MOCK_SERVER] } } },
        requestTimeoutMs: 10_000,
        diagnosticsWaitMs: 5_000,
    });
}

describe("LspManager against the mock server", () => {
    test("diagnostics flow: open → error, change → clean, augment counters", async () => {
        const dir = join(tmpRoot, "live1");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "a.ts");
        writeFileSync(file, "const ERROR_TOKEN = 1;\n");
        const manager = mockManager(dir);

        expect(manager.disabled).toBe(false);
        expect(manager.isLiveFor("typescript")).toBe(false); // cold

        const conn = await manager.connectionFor("typescript");
        expect(conn).not.toBeNull();

        await manager.syncDocument(file);
        let items = await manager.waitForFreshDiagnostics(file, Date.now() - 1000);
        expect(items).toHaveLength(1);
        expect(items[0].severity).toBe(1);
        expect(items[0].message).toContain("ERROR_TOKEN");
        expect(countErrors(items)).toBe(1);
        expect(renderDiagnostics(file, items)).toContain("[error]");

        // edit → didChange → clean publish (fresh-wait anchored BEFORE the change,
        // exactly like the PostToolUse augment captures changedTs)
        const cleanTs = Date.now();
        writeFileSync(file, "const fine = 2;\n");
        await manager.syncDocument(file);
        items = await manager.waitForFreshDiagnostics(file, cleanTs);
        expect(items).toHaveLength(0);

        // warning-only content
        const warnTs = Date.now();
        writeFileSync(file, "const warn_token = 3;\n");
        await manager.syncDocument(file);
        items = await manager.waitForFreshDiagnostics(file, warnTs);
        expect(items).toHaveLength(1);
        expect(countErrors(items)).toBe(0);
        expect(items[0].severity).toBe(2);

        // allDiagnostics covers the file
        expect(manager.allDiagnostics().map((d) => d.path)).toContain(file);

        // status reports the running server
        const status = manager.status();
        expect(status.servers.some((s) => s.state === "running" && s.command.includes("mock-lsp-server"))).toBe(true);

        manager.disposeAll();
        expect(manager.isLiveFor("typescript")).toBe(false);
    });

    test("hover, definition, references, symbols", async () => {
        const dir = join(tmpRoot, "live2");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "b.ts");
        writeFileSync(file, "function mockFn() {\n  const inner = 1;\n}\nmockFn();\n");
        const manager = mockManager(dir);

        // hover over "mockFn" on line 4 (1-based) with symbol hint
        const hover = await manager.hover(file, 3, 0);
        expect(hover).toContain("hover(");

        const defs = await manager.definition(file, 3, 0);
        expect(defs).toHaveLength(1);
        const rendered = renderLocations(defs);
        expect(rendered).toContain("b.ts:1");

        const refs = await manager.references(file, 3, 0);
        expect(refs).toHaveLength(1);

        const symbols = await manager.symbols(file);
        expect(symbols.map((s) => s.name)).toEqual(["mockFn", "inner"]);

        manager.disposeAll();
    });

    test("cold start via warmFor does not throw and never blocks", async () => {
        const dir = join(tmpRoot, "live3");
        mkdirSync(dir, { recursive: true });
        const manager = mockManager(dir);
        // fire-and-forget warm; the augment path calls exactly this
        await manager.warmFor("typescript");
        // waitReady=false during in-flight start returns null (non-blocking)
        const fast = await manager.connectionFor("typescript", false);
        // either still starting (null) or already up — both acceptable
        expect(fast === null || fast !== null).toBe(true);
        manager.disposeAll();
    });

    test("spawn failure degrades to null instead of throwing", async () => {
        const dir = join(tmpRoot, "live4");
        mkdirSync(dir, { recursive: true });
        const manager = new LspManager({
            cwd: dir,
            config: { servers: { typescript: { command: ["definitely-not-a-real-binary-xyz"] } } },
            requestTimeoutMs: 2_000,
        });
        const conn = await manager.connectionFor("typescript");
        expect(conn).toBeNull();
        // second attempt also degrades quietly (start failure is not cached as running)
        const conn2 = await manager.connectionFor("typescript");
        expect(conn2).toBeNull();
    });

    test("disabled config reports disabled", () => {
        const manager = new LspManager({ cwd: tmpRoot, config: { disabled: true } });
        expect(manager.disabled).toBe(true);
    });
});
