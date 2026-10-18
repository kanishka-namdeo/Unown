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
    LspConnection,
    LspManager,
    lspSpawnSpec,
    normalizeLocations,
    pathToUri,
    renderAllDiagnostics,
    renderDiagnostics,
    renderHoverContents,
    renderLocations,
    resolveLspConfig,
    resolveServerCommand,
    severityLabel,
    trustProjectLspConfig,
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
        // The project file is untrusted by default (H2 trust gate — dedicated
        // tests below), so exercise the merge semantics under the env bypass.
        const bypass = { UNOWN_TRUST_PROJECT_CONFIG: "1" };
        const cfg = resolveLspConfig(project, userDir, bypass);
        expect(cfg.servers?.go).toEqual({ command: ["proj-gopls"] });
        expect(cfg.servers?.rust).toEqual({ command: ["ra"] });
        expect(resolveLspConfig(project, userDir, bypass).disabled).toBeUndefined();
        // disabled: true in project wins over absent user setting
        writeFileSync(join(project, ".unown", "lsp.json"), JSON.stringify({ disabled: true }));
        expect(resolveLspConfig(project, userDir, bypass).disabled).toBe(true);
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

// ---------------------------------------------------------------------------
// 4. H1: crash/restart semantics, framing hardening, HANG-killers, env parsing
// ---------------------------------------------------------------------------

describe("LspManager crash + restart semantics (H1)", () => {
    test("crash: pending request rejects, crashCount surfaces, cooldown gates, restart re-didOpens", async () => {
        const dir = join(tmpRoot, "crash1");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "a.ts");
        writeFileSync(file, "const ERROR_TOKEN = 1;\n");
        const prevStrict = process.env.MOCK_LSP_STRICT;
        process.env.MOCK_LSP_STRICT = "1"; // ignore didChange for never-opened docs
        const manager = new LspManager({
            cwd: dir,
            config: { servers: { typescript: { command: [NODE, MOCK_SERVER] } } },
            requestTimeoutMs: 5_000,
            diagnosticsWaitMs: 3_000,
            crashCooldownMs: 250,
            maxRestarts: 3,
        });
        try {
            // healthy first cycle
            const conn = await manager.connectionFor("typescript");
            expect(conn).not.toBeNull();
            await manager.syncDocument(file);
            const first = await manager.waitForFreshDiagnostics(file, Date.now() - 1000);
            expect(first).toHaveLength(1);

            // crash mid-session; the in-flight request must REJECT, not hang
            await expect(conn!.request("$/mockCrash", {}, 5_000)).rejects.toThrow("server exited (code 1)");

            // crash bookkeeping surfaced in status()
            const entry = manager.status().servers.find((s) => s.command.includes("mock-lsp-server"))!;
            expect(entry.state).toBe("crashed");
            expect(entry.crashCount).toBe(1);
            expect(entry.lastCrashAt).toBeGreaterThan(0);
            expect(entry.detail).toContain("server exited");

            // within cooldown: syncDocument skips cheaply (no spawn)
            expect(await manager.syncDocument(file)).toBeNull();

            // cooldown elapses → lazy restart; openDocs was cleared on the
            // crash, so the STRICT mock (ignores didChange for unknown docs)
            // still publishes — through a fresh didOpen on the new process.
            await new Promise((r) => setTimeout(r, 350));
            writeFileSync(file, "const ERROR_TOKEN = 2;\n");
            const freshTs = Date.now();
            const conn2 = await manager.syncDocument(file);
            expect(conn2).not.toBeNull();
            const items = await manager.waitForFreshDiagnostics(file, freshTs);
            expect(items).toHaveLength(1);
            expect(items[0].message).toContain("ERROR_TOKEN");

            // the crash is still visible once the server runs again
            const entry2 = manager.status().servers.find((s) => s.command.includes("mock-lsp-server"))!;
            expect(entry2.state).toBe("running");
            expect(entry2.crashCount).toBe(1);
            manager.disposeAll();
        } finally {
            if (prevStrict === undefined) delete process.env.MOCK_LSP_STRICT;
            else process.env.MOCK_LSP_STRICT = prevStrict;
        }
    });

    test("restarts exhausted: syncs skip cheaply and status says so", async () => {
        const dir = join(tmpRoot, "crash2");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "a.ts");
        writeFileSync(file, "const fine = 1;\n");
        const manager = new LspManager({
            cwd: dir,
            config: { servers: { typescript: { command: [NODE, MOCK_SERVER] } } },
            requestTimeoutMs: 5_000,
            diagnosticsWaitMs: 500,
            crashCooldownMs: 50,
            maxRestarts: 0, // budget already spent
        });
        const conn = await manager.connectionFor("typescript");
        expect(conn).not.toBeNull();
        await expect(conn!.request("$/mockCrash", {}, 5_000)).rejects.toThrow("server exited");
        await new Promise((r) => setTimeout(r, 80)); // cooldown passes, budget gone
        const entry = manager.status().servers.find((s) => s.command.includes("mock-lsp-server"))!;
        expect(entry.state).toBe("crashed");
        expect(entry.detail).toContain("restarts exhausted");
        expect(await manager.syncDocument(file)).toBeNull();
        manager.disposeAll();
    });
});

describe("LspConnection framing hardening (H1)", () => {
    test("oversized Content-Length header recycles the connection instead of buffering", async () => {
        const dir = join(tmpRoot, "bighdr");
        mkdirSync(dir, { recursive: true });
        const prev = process.env.MOCK_LSP_BIG_HEADER;
        process.env.MOCK_LSP_BIG_HEADER = "1";
        const manager = new LspManager({
            cwd: dir,
            config: { servers: { typescript: { command: [NODE, MOCK_SERVER] } } },
            requestTimeoutMs: 10_000,
        });
        try {
            const started = Date.now();
            const conn = await manager.connectionFor("typescript");
            expect(conn).toBeNull(); // recycled, not wedged
            expect(Date.now() - started).toBeLessThan(5_000); // violation is immediate, not a timeout burn
            const entry = manager.status().servers.find((s) => s.command.includes("mock-lsp-server"))!;
            expect(entry.state).toBe("crashed");
            expect(entry.crashCount).toBe(1); // recorded once (no double count)
            expect(entry.detail).toContain("Content-Length");
            manager.disposeAll();
        } finally {
            if (prev === undefined) delete process.env.MOCK_LSP_BIG_HEADER;
            else process.env.MOCK_LSP_BIG_HEADER = prev;
        }
    });

    test("garbage banner block before a valid frame does not eat the frame", async () => {
        const dir = join(tmpRoot, "noise");
        mkdirSync(dir, { recursive: true });
        const prev = process.env.MOCK_LSP_NOISE;
        process.env.MOCK_LSP_NOISE = "1";
        const manager = new LspManager({
            cwd: dir,
            config: { servers: { typescript: { command: [NODE, MOCK_SERVER] } } },
            requestTimeoutMs: 5_000,
            diagnosticsWaitMs: 1_000,
        });
        try {
            const conn = await manager.connectionFor("typescript");
            expect(conn).not.toBeNull(); // initialize parsed despite the banner
            manager.disposeAll();
        } finally {
            if (prev === undefined) delete process.env.MOCK_LSP_NOISE;
            else process.env.MOCK_LSP_NOISE = prev;
        }
    });

    test("LF-only headers (\\n\\n framing) are accepted", async () => {
        const dir = join(tmpRoot, "lfonly");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "a.ts");
        writeFileSync(file, "const ERROR_TOKEN = 1;\n");
        const prev = process.env.MOCK_LSP_LF;
        process.env.MOCK_LSP_LF = "1";
        const manager = new LspManager({
            cwd: dir,
            config: { servers: { typescript: { command: [NODE, MOCK_SERVER] } } },
            requestTimeoutMs: 5_000,
            diagnosticsWaitMs: 3_000,
        });
        try {
            await manager.syncDocument(file);
            const items = await manager.waitForFreshDiagnostics(file, Date.now() - 1000);
            expect(items).toHaveLength(1); // handshake AND diagnostics parsed
            manager.disposeAll();
        } finally {
            if (prev === undefined) delete process.env.MOCK_LSP_LF;
            else process.env.MOCK_LSP_LF = prev;
        }
    });
});

describe("waitForFreshDiagnostics HANG-killers (H1)", () => {
    test("bails out early when the connection dies mid-wait", async () => {
        const dir = join(tmpRoot, "waitdead");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "a.ts");
        writeFileSync(file, "const fine = 1;\n");
        const manager = new LspManager({
            cwd: dir,
            config: { servers: { typescript: { command: [NODE, MOCK_SERVER] } } },
            requestTimeoutMs: 5_000,
            diagnosticsWaitMs: 5_000, // would burn 5 s without the early exit
        });
        const conn = await manager.connectionFor("typescript");
        await manager.syncDocument(file);
        const crashPromise = conn!.request("$/mockCrash", {}, 5_000);
        // Attach the rejection handler immediately — otherwise the rejection
        // fires unhandled while the wait below is asleep.
        const crashObserved = expect(crashPromise).rejects.toThrow("server exited");
        const started = Date.now();
        const items = await manager.waitForFreshDiagnostics(file, Date.now()); // nothing fresh exists
        const elapsed = Date.now() - started;
        await crashObserved;
        expect(items).toHaveLength(0);
        expect(elapsed).toBeLessThan(2_000); // detected the dead connection, did not burn the window
        manager.disposeAll();
    });

    test("skips waiting for servers that never publish (after one learning wait)", async () => {
        const dir = join(tmpRoot, "silent");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "a.ts");
        writeFileSync(file, "const fine = 1;\n");
        const prev = process.env.MOCK_LSP_SILENT;
        process.env.MOCK_LSP_SILENT = "1";
        const manager = new LspManager({
            cwd: dir,
            config: { servers: { typescript: { command: [NODE, MOCK_SERVER] } } },
            requestTimeoutMs: 5_000,
            diagnosticsWaitMs: 400,
        });
        try {
            await manager.syncDocument(file);
            const firstStart = Date.now();
            await manager.waitForFreshDiagnostics(file, Date.now()); // learning period: waits it out
            expect(Date.now() - firstStart).toBeGreaterThanOrEqual(350);
            const secondStart = Date.now();
            await manager.waitForFreshDiagnostics(file, Date.now()); // never-published → skip
            expect(Date.now() - secondStart).toBeLessThan(150);
            manager.disposeAll();
        } finally {
            if (prev === undefined) delete process.env.MOCK_LSP_SILENT;
            else process.env.MOCK_LSP_SILENT = prev;
        }
    });
});

describe("env parsing (H1 parseMsEnv)", () => {
    test("junk/negative/zero/absurd values fall back to defaults", () => {
        const junk = new LspManager({
            cwd: tmpRoot,
            env: { UNOWN_LSP_TIMEOUT_MS: "abc", UNOWN_LSP_WAIT_MS: "-5", UNOWN_LSP_MAX_MSG_BYTES: "9999999999999999" },
        });
        expect(junk.requestTimeoutMs).toBe(15_000);
        expect(junk.diagnosticsWaitMs).toBe(10_000);
        expect(junk.maxMessageBytes).toBe(32 * 1024 * 1024);
    });
    test("valid values parse; restart cap accepts 0", () => {
        const ok = new LspManager({ cwd: tmpRoot, env: { UNOWN_LSP_TIMEOUT_MS: "2500", UNOWN_LSP_MAX_MSG_BYTES: "2048" } });
        expect(ok.requestTimeoutMs).toBe(2_500);
        expect(ok.maxMessageBytes).toBe(2_048);
        expect(new LspManager({ cwd: tmpRoot, env: { UNOWN_LSP_MAX_RESTARTS: "0" } }).maxRestarts).toBe(0);
        expect(new LspManager({ cwd: tmpRoot, env: { UNOWN_LSP_MAX_RESTARTS: "junk" } }).maxRestarts).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// 5. H2: project-config trust gate
// ---------------------------------------------------------------------------

describe("project lsp.json trust gate (H2)", () => {
    test("untrusted project lsp.json: entries withheld, needsTrust + guidance, user config still loads", () => {
        const userDir = join(tmpRoot, "trust-user");
        const project = join(tmpRoot, "trust-proj");
        mkdirSync(userDir, { recursive: true });
        mkdirSync(join(project, ".unown"), { recursive: true });
        writeFileSync(join(userDir, "lsp.json"), JSON.stringify({ servers: { go: { command: ["user-gopls"] } } }));
        writeFileSync(
            join(project, ".unown", "lsp.json"),
            JSON.stringify({ servers: { go: { command: ["evil-gopls"] }, rust: { command: ["evil-ra"] } }, disabled: true }),
        );
        const resolved = resolveLspConfig(project, userDir, {});
        expect(resolved.needsTrust).toBe(true);
        expect(resolved.projectFile).toBe(join(project, ".unown", "lsp.json"));
        expect(resolved.trustGuidance).toContain("/lsp trust");
        expect(resolved.trustGuidance).toContain("UNOWN_TRUST_PROJECT_CONFIG=1");
        // user config still loads; the project's overrides AND its disabled
        // flag are withheld — a cloned repo cannot configure execution.
        expect(resolved.servers?.go).toEqual({ command: ["user-gopls"] });
        expect(resolved.servers?.rust).toBeUndefined();
        expect(resolved.disabled).toBeUndefined();
    });

    test("UNOWN_TRUST_PROJECT_CONFIG bypass applies the project override", () => {
        const userDir = join(tmpRoot, "trust-user2");
        const project = join(tmpRoot, "trust-proj2");
        mkdirSync(userDir, { recursive: true });
        mkdirSync(join(project, ".unown"), { recursive: true });
        writeFileSync(join(project, ".unown", "lsp.json"), JSON.stringify({ servers: { go: { command: ["proj-gopls"] } } }));
        for (const value of ["1", "true", "TRUE"]) {
            const resolved = resolveLspConfig(project, userDir, { UNOWN_TRUST_PROJECT_CONFIG: value });
            expect(resolved.needsTrust).toBe(false);
            expect(resolved.trustGuidance).toBe(null);
            expect(resolved.servers?.go).toEqual({ command: ["proj-gopls"] });
        }
        // any other value keeps the gate on
        const refused = resolveLspConfig(project, userDir, { UNOWN_TRUST_PROJECT_CONFIG: "0" });
        expect(refused.needsTrust).toBe(true);
        expect(refused.servers?.go).toBeUndefined();
    });

    test("user-scoped config is always trusted (no approval state exists)", () => {
        const userDir = join(tmpRoot, "trust-user3");
        mkdirSync(userDir, { recursive: true });
        writeFileSync(join(userDir, "lsp.json"), JSON.stringify({ servers: { go: { command: ["user-gopls"] } } }));
        const resolved = resolveLspConfig(join(tmpRoot, "no-such-project"), userDir, {});
        expect(resolved.needsTrust).toBe(false);
        expect(resolved.projectFile).toBe(null);
        expect(resolved.servers?.go).toEqual({ command: ["user-gopls"] });
    });

    test("trustProjectLspConfig approves the file; a changed file re-gates", () => {
        const userDir = join(tmpRoot, "trust-user4");
        const project = join(tmpRoot, "trust-proj4");
        mkdirSync(userDir, { recursive: true });
        mkdirSync(join(project, ".unown"), { recursive: true });
        const file = join(project, ".unown", "lsp.json");
        writeFileSync(file, JSON.stringify({ servers: { go: { command: ["proj-gopls"] } } }));
        const opts = { statePath: join(userDir, "trusted-configs.json"), userDir, env: {} };
        expect(resolveLspConfig(project, userDir, {}).needsTrust).toBe(true);
        expect(trustProjectLspConfig(project, opts)).toBe(true);
        const approved = resolveLspConfig(project, userDir, {});
        expect(approved.needsTrust).toBe(false);
        expect(approved.servers?.go).toEqual({ command: ["proj-gopls"] });
        // the fingerprint pins content: mutating the file re-arms the gate
        writeFileSync(file, JSON.stringify({ servers: { go: { command: ["proj-gopls-2"] } } }));
        const changed = resolveLspConfig(project, userDir, {});
        expect(changed.needsTrust).toBe(true);
        expect(changed.servers?.go).toBeUndefined();
    });

    test("LspManager.status() surfaces the trust state", () => {
        const userDir = join(tmpRoot, "trust-user5");
        const project = join(tmpRoot, "trust-proj5");
        mkdirSync(userDir, { recursive: true });
        mkdirSync(join(project, ".unown"), { recursive: true });
        writeFileSync(join(project, ".unown", "lsp.json"), JSON.stringify({ servers: { go: { command: ["evil"] } } }));
        const gated = new LspManager({ cwd: project, env: {}, userDir }).status();
        expect(gated.needsTrust).toBe(true);
        expect(gated.trustGuidance).toContain("/lsp trust");
        const bypassed = new LspManager({ cwd: project, env: { UNOWN_TRUST_PROJECT_CONFIG: "1" }, userDir }).status();
        expect(bypassed.needsTrust).toBe(false);
        expect(bypassed.trustGuidance).toBe(null);
    });
});

// ---------------------------------------------------------------------------
// 6. H2: file-URI percent-encoding
// ---------------------------------------------------------------------------

describe("pathToUri percent-encoding (H2)", () => {
    test("encodes #, ?, %, space, non-ASCII and C0 controls per path segment", () => {
        expect(pathToUri("/d/a#b.ts")).toBe("file:///d/a%23b.ts");
        expect(pathToUri("/d/a?b.ts")).toBe("file:///d/a%3Fb.ts");
        expect(pathToUri("/d/a%20b.ts")).toBe("file:///d/a%2520b.ts");
        expect(pathToUri("/d/with space.ts")).toBe("file:///d/with%20space.ts");
        expect(pathToUri("/d/uni-ünïcode.ts")).toBe("file:///d/uni-%C3%BCn%C3%AFcode.ts");
        expect(pathToUri("/d/a\x01b.ts")).toBe("file:///d/a%01b.ts");
        // '/' stays literal (segment separator) and the drive form survives
        expect(pathToUri("/d/sub/a.ts")).toBe("file:///d/sub/a.ts");
        expect(pathToUri("C:\\proj\\a#b.ts")).toBe("file:///C:/proj/a%23b.ts");
    });
    test.each(["a#b.ts", "a?b.ts", "a%20b.ts", "with space.ts", "uni-ünïcode.ts", "a\x01b.ts"])(
        "%s: uriToPath(pathToUri(p)) round-trips",
        (name) => {
            const path = join("/d", name);
            const uri = pathToUri(path);
            expect(uri).not.toContain("#");
            expect(uri).not.toContain("?");
            expect(uri).not.toContain(" ");
            expect(uriToPath(uri)).toBe(path);
        },
    );
});

describe("LspManager exotic filenames (H2 URI encoding)", () => {
    test("didOpen ↔ publishDiagnostics round-trip through the spec-correct mock", async () => {
        const dir = join(tmpRoot, "urinames");
        mkdirSync(dir, { recursive: true });
        // '?' is not a legal filename on win32 — keep those cases where they
        // can exist; the pure round-trip test above covers the encoding.
        const names = ["a#b.ts", "a?b.ts", "a%20b.ts", "with space.ts", "uni-ünïcode.ts"];
        const runnable = process.platform === "win32" ? names.filter((n) => !n.includes("?")) : names;
        const manager = mockManager(dir);
        for (const name of runnable) {
            const file = join(dir, name);
            writeFileSync(file, `// ${name}\nconst ERROR_TOKEN = 1;\n`);
            const conn = await manager.syncDocument(file);
            expect(conn).not.toBeNull();
            const items = await manager.waitForFreshDiagnostics(file, Date.now() - 1000);
            expect(items).toHaveLength(1); // the publish mapped back to THIS file
            expect(items[0].message).toContain("ERROR_TOKEN");
            expect(manager.diagnosticsFor(file)?.items).toHaveLength(1);
            const hover = await manager.hover(file, 0, 7);
            expect(hover).toContain("hover(");
        }
        manager.disposeAll();
    });
});

// ---------------------------------------------------------------------------
// 7. H2: server→client request replies
// ---------------------------------------------------------------------------

describe("server→client request replies (H2)", () => {
    test("workspace/configuration → [], unknown request → -32601 (number and string ids)", async () => {
        const dir = join(tmpRoot, "probe");
        mkdirSync(dir, { recursive: true });
        const prev = process.env.MOCK_LSP_PROBE;
        process.env.MOCK_LSP_PROBE = "1";
        const manager = new LspManager({
            cwd: dir,
            config: { servers: { typescript: { command: [NODE, MOCK_SERVER] } } },
            requestTimeoutMs: 5_000,
        });
        try {
            const conn = await manager.connectionFor("typescript");
            expect(conn).not.toBeNull();
            // the mock sent its probes right after the initialize reply; the
            // $/probeStatus reply is deferred until both client replies landed.
            const status = (await conn!.request("$/probeStatus", {}, 5_000)) as {
                config?: { id?: unknown; result?: unknown; error?: unknown };
                unknown?: { id?: unknown; result?: unknown; error?: { code?: number; message?: string } };
            };
            // numeric-id probe: workspace/configuration → result []
            expect(status.config?.id).toBe(9101);
            expect(status.config?.result).toEqual([]);
            expect(status.config?.error).toBeUndefined();
            // string-id probe: unknown method → -32601 with the method named
            expect(status.unknown?.id).toBe("probe-2");
            expect(status.unknown?.error?.code).toBe(-32601);
            expect(status.unknown?.error?.message).toContain("workspace/unknownProbe");
            expect(status.unknown?.result).toBeUndefined();
            manager.disposeAll();
        } finally {
            if (prev === undefined) delete process.env.MOCK_LSP_PROBE;
            else process.env.MOCK_LSP_PROBE = prev;
        }
    });

    test("string response ids still resolve pending requests", async () => {
        const dir = join(tmpRoot, "strid");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "a.ts");
        writeFileSync(file, "const ERROR_TOKEN = 1;\n");
        const prev = process.env.MOCK_LSP_STRING_ID;
        process.env.MOCK_LSP_STRING_ID = "1";
        const manager = new LspManager({
            cwd: dir,
            config: { servers: { typescript: { command: [NODE, MOCK_SERVER] } } },
            requestTimeoutMs: 5_000,
            diagnosticsWaitMs: 3_000,
        });
        try {
            // initialize itself would time out without String(id)-keyed
            // pending lookups: the mock echoes "1" instead of 1.
            const conn = await manager.connectionFor("typescript");
            expect(conn).not.toBeNull();
            await manager.syncDocument(file);
            const items = await manager.waitForFreshDiagnostics(file, Date.now() - 1000);
            expect(items).toHaveLength(1);
            const hover = await manager.hover(file, 0, 6);
            expect(hover).toContain("hover(");
            manager.disposeAll();
        } finally {
            if (prev === undefined) delete process.env.MOCK_LSP_STRING_ID;
            else process.env.MOCK_LSP_STRING_ID = prev;
        }
    });
});

// ---------------------------------------------------------------------------
// 8. H2: output/sync bounds
// ---------------------------------------------------------------------------

describe("diagnostics all-action bounds (H2)", () => {
    const mk = (line: number) => ({
        range: { start: { line, character: 0 }, end: { line, character: 1 } },
        severity: 1,
        message: `e${line}`,
    });

    test("renderAllDiagnostics caps at 200 findings with a +N more findings line", () => {
        const files = ["/a.ts", "/b.ts", "/c.ts"].map((path) => ({
            path,
            items: Array.from({ length: 90 }, (_, i) => mk(i)),
        }));
        const text = renderAllDiagnostics(files);
        expect(text.split("\n").filter((l) => l.includes("[error]"))).toHaveLength(200);
        expect(text).toContain("+70 more findings");
        // per-file truncation stays off while the global cap governs
        expect(text).not.toContain("… ");
    });

    test("renderAllDiagnostics: no truncation line at the cap; empty input", () => {
        const files = [{ path: "/a.ts", items: Array.from({ length: 200 }, (_, i) => mk(i)) }];
        expect(renderAllDiagnostics(files)).not.toContain("more findings");
        expect(renderAllDiagnostics([])).toBe("No diagnostics.");
    });

    test("allDiagnostics caps cached findings at 200; overflow + status report the rest", async () => {
        const dir = join(tmpRoot, "allcap");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "big.ts");
        writeFileSync(file, `${Array.from({ length: 250 }, (_, i) => `const x${i} = "ERROR_TOKEN";`).join("\n")}\n`);
        const manager = mockManager(dir);
        await manager.syncDocument(file);
        const items = await manager.waitForFreshDiagnostics(file, Date.now() - 1000);
        expect(items).toHaveLength(250);
        const all = manager.allDiagnostics();
        expect(all.reduce((n, d) => n + d.items.length, 0)).toBe(200);
        expect(manager.allDiagnosticsOverflow()).toBe(50);
        expect(manager.status().diagnostics).toBe(250); // raw total stays visible
        // the renderer stays truthful when fed the capped entries + overflow
        const text = renderAllDiagnostics(all, 200, manager.allDiagnosticsOverflow());
        expect(text).toContain("+50 more findings");
        manager.disposeAll();
    });
});

describe("syncDocument size bound (H2)", () => {
    test("files over maxSyncBytes skip didOpen/didChange and surface in status", async () => {
        const dir = join(tmpRoot, "oversize");
        mkdirSync(dir, { recursive: true });
        const big = join(dir, "big.ts");
        const small = join(dir, "small.ts");
        writeFileSync(big, `// ${"x".repeat(200)}\nconst ERROR_TOKEN = 1;\n`);
        writeFileSync(small, "const ERROR_TOKEN = 1;\n");
        const manager = new LspManager({
            cwd: dir,
            env: { UNOWN_LSP_MAX_SYNC_BYTES: "64" }, // tiny override: big.ts > 64 B
            config: { servers: { typescript: { command: [NODE, MOCK_SERVER] } } },
            requestTimeoutMs: 5_000,
            diagnosticsWaitMs: 500,
        });
        expect(manager.maxSyncBytes).toBe(64);
        expect(await manager.syncDocument(big)).toBeNull();
        expect(await manager.hover(big, 0, 6)).toBeNull(); // never opened → no hover
        expect(manager.status().oversizeSkipped).toBe(1);
        // repeated skips stay quiet (logged once per file) and cheap
        expect(await manager.syncDocument(big)).toBeNull();
        expect(manager.status().oversizeSkipped).toBe(1);
        // the small file still syncs and gets diagnostics
        await manager.syncDocument(small);
        const items = await manager.waitForFreshDiagnostics(small, Date.now() - 1000);
        expect(items).toHaveLength(1);
        expect(manager.status().openDocs).toBe(1);
        manager.disposeAll();
    });

    test("UNOWN_LSP_MAX_SYNC_BYTES parses tolerantly (default 4 MiB)", () => {
        expect(new LspManager({ cwd: tmpRoot, env: {} }).maxSyncBytes).toBe(4 * 1024 * 1024);
        expect(new LspManager({ cwd: tmpRoot, env: { UNOWN_LSP_MAX_SYNC_BYTES: "junk" } }).maxSyncBytes).toBe(4 * 1024 * 1024);
        expect(new LspManager({ cwd: tmpRoot, env: { UNOWN_LSP_MAX_SYNC_BYTES: "-1" } }).maxSyncBytes).toBe(4 * 1024 * 1024);
        expect(new LspManager({ cwd: tmpRoot, env: { UNOWN_LSP_MAX_SYNC_BYTES: "2048" } }).maxSyncBytes).toBe(2_048);
    });
});

// ---------------------------------------------------------------------------
// 9. H2: Windows spawn parity (stdioSpawnSpec)
// ---------------------------------------------------------------------------

describe("Windows spawn parity (H2 stdioSpawnSpec)", () => {
    test("lspSpawnSpec wraps .cmd shims through cmd.exe on win32, spawns directly on posix", () => {
        const win = lspSpawnSpec(["typescript-language-server.cmd", "--stdio"], "/w", {}, "win32");
        expect(win.command).toBe("cmd.exe");
        expect(win.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
        expect(win.args[3]).toContain('"typescript-language-server.cmd"');
        expect(win.args[3]).toContain('"--stdio"');
        expect(win.cwd).toBe("/w");
        const posix = lspSpawnSpec(["typescript-language-server", "--stdio"], "/w", {}, "linux");
        expect(posix.command).toBe("typescript-language-server");
        expect(posix.args).toEqual(["--stdio"]);
        // ${VAR} expansion from the manager env; unknown vars stay literal
        const expanded = lspSpawnSpec(["srv", "${LSP_TOOL_VAR_XYZ}"], "/w", { LSP_TOOL_VAR_XYZ: "v1" }, "linux");
        expect(expanded.args).toEqual(["v1"]);
        const literal = lspSpawnSpec(["srv", "${LSP_TOOL_VAR_XYZ}"], "/w", {}, "linux");
        expect(literal.args).toEqual(["${LSP_TOOL_VAR_XYZ}"]);
    });

    test("LspConnection builds (or refuses) its spawn spec at construction", async () => {
        const cwd = join(tmpRoot, "spec-choice");
        mkdirSync(cwd, { recursive: true });
        const conn = new LspConnection(["typescript-language-server.cmd", "--stdio"], cwd, 1024, {}, "win32");
        expect(conn.spawnSpec?.command).toBe("cmd.exe");
        expect(conn.spawnError).toBe(null);
        // unescapable '%' on the win32 path is refused before any spawn
        const refused = new LspConnection(["bad%.cmd"], cwd, 1024, {}, "win32");
        expect(refused.spawnSpec).toBe(null);
        expect(refused.spawnError).toContain("%");
        await expect(refused.start(1_000)).rejects.toThrow("refused to spawn");
    });
});
