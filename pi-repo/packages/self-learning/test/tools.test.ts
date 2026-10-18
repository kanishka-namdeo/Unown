// Unit tests for src/tools.ts — the plan-mode vocabulary (isSafeCommand) and
// the subagent invocation helpers introduced for cross-platform support:
//
//   - isSafeCommand: plan mode is read-only. A command runs only when it
//     matches a SAFE pattern (anchored at the start) AND contains no
//     DESTRUCTIVE pattern (the chained-command backstop). The Windows additions
//     extend both sides: PowerShell read-only verbs are SAFE; any
//     Remove-Item / format / reg-family / taskkill sighting is DESTRUCTIVE.
//     PowerShell verbs and flags are case-insensitive, so the Windows entries
//     are /i.
//   - isBunVirtualScriptPath: the compiled-binary guard now accepts both
//     bunfs spellings (POSIX /$bunfs/root/ and the win32 drive-letter form).
//   - resolveUnownCliScript: the win32 fallback that resolves bin/unown by
//     walking up from the module (no PATH / unown.cmd resolution involved).
//
// These tests run on `bun test` (bun:test is built in — zero new deps).
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUnownToolsExtension, isBunVirtualScriptPath, isSafeCommand, resolveUnownCliScript } from "../src/tools.ts";

// ---------------------------------------------------------------------------
// isSafeCommand — plan-mode vocabulary
// ---------------------------------------------------------------------------
describe("isSafeCommand — accepts read-only commands (POSIX + PowerShell)", () => {
        test.each([
                "Get-ChildItem",
                "Get-ChildItem -Recurse .\\src",
                "Get-Content package.json",
                "Get-Item package.json",
                "Get-Location",
                "Get-Command git",
                "Get-Process",
                "Get-Date",
                "Test-Path src/main.ts",
                "Measure-Object",
                "Select-String foo *.ts",
                "get-childitem .\\src", // PowerShell verbs are case-insensitive
                "dir C:\\projects",
                "where.exe bun",
                "git status",
                "git log --oneline",
                "git --version",
                "npm --version",
                "bun --version",
                "node --version",
                "echo hi",
                "cat README.md",
                "ls -la",
        ])("%s", (command: string) => {
                expect(isSafeCommand(command)).toBe(true);
        });
});

describe("isSafeCommand — rejects mutating/catastrophic commands", () => {
        test.each([
                "Remove-Item -Recurse C:\\", // any Remove-Item: plan mode is read-only
                "Remove-Item -Force $env:TEMP\\x",
                "remove-item -recurse .\\build", // case-insensitive
                "reg delete", // any reg.exe use (query included) — plan mode never touches the registry
                "reg query HKLM\\X",
                "format D:",
                "del /s /q C:\\Users",
                "rd /s C:\\Windows",
                "rmdir /s /q C:\\PerfLogs",
                "bcdedit /set x y",
                "diskpart /s script.txt",
                "vssadmin delete shadows /all",
                "vssadmin list shadows", // POLICY: any vssadmin in plan mode is out of scope
                "wbadmin delete catalog",
                "Set-ExecutionPolicy Bypass",
                "set-executionpolicy unrestricted",
                "Stop-Process -Name notepad", // any Stop-Process
                "taskkill /f /im node",
                "Get-ChildItem | Remove-Item", // chained backstop: safe start, destructive tail
                "cat x; del /s y", // chained backstop, POSIX verb
                "cat x; rm -rf /", // chained backstop (pre-existing rm rule)
        ])("%s", (command: string) => {
                expect(isSafeCommand(command)).toBe(false);
        });
});

// ---------------------------------------------------------------------------
// isBunVirtualScriptPath — the compiled-binary guard, both platform spellings
// ---------------------------------------------------------------------------
describe("isBunVirtualScriptPath", () => {
        test.each([
                "/$bunfs/root/src/cli.ts",
                "/$bunfs/root/bin/unown",
                "C:\\$bunfs\\root\\src\\cli.ts",
                "c:\\$bunfs\\root\\pi.js", // case-insensitive
                "B:\\$bunfs/root/src/cli.ts", // either separator after the drive
        ])("true for the bunfs path %s", (script: string) => {
                expect(isBunVirtualScriptPath(script)).toBe(true);
        });

        test.each([
                "/home/z/repo/bin/unown",
                "C:\\repo\\bin\\unown",
                "/$bunfs", // prefix without the /root/ segment
                "C:\\$bunfs\\other\\x", // bunfs but not the root dir
                undefined,
                "",
        ])("false for %s", (script: string | undefined) => {
                expect(isBunVirtualScriptPath(script)).toBe(false);
        });
});

// ---------------------------------------------------------------------------
// resolveUnownCliScript — the win32 fallback resolves bin/unown by walking up
// ---------------------------------------------------------------------------
describe("resolveUnownCliScript", () => {
        test("finds the repo's bin/unown (exists on disk, no PATH involved)", () => {
                const cli = resolveUnownCliScript();
                expect(cli).not.toBeNull();
                expect(cli!.endsWith(join("bin", "unown"))).toBe(true);
                expect(existsSync(cli!)).toBe(true);
        });
});

// ---------------------------------------------------------------------------
// /review wiring — the git-plumbing abort path (H2, R-b G1/G2): a non-repo
// renders an actionable command result, never a crash and never reviewers
// receiving git's fatal stderr as "the diff". (Reviewer-failure rendering is
// covered in review.test.ts through the exported parse/merge/render layer.)
// ---------------------------------------------------------------------------
const reviewTmp = mkdtempSync(join(tmpdir(), "unown-tools-review-"));
afterAll(() => {
    try {
        rmSync(reviewTmp, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

describe("/review wiring", () => {
    test("non-repo cwd aborts with an actionable warning, no reviewer spawn", async () => {
        const dir = join(reviewTmp, "not-a-repo");
        mkdirSync(dir, { recursive: true });
        const ext = createUnownToolsExtension({ cwd: dir, engineUrl: "http://127.0.0.1:3030" });
        const commands = new Map<string, { description: string; handler: (args: string, ctx: any) => Promise<void> }>();
        const pi: any = {
            on: () => {},
            registerCommand: (name: string, def: any) => commands.set(name, def),
            registerFlag: () => {},
            registerTool: () => {},
            registerShortcut: () => {},
            appendEntry: () => {},
            getFlag: () => undefined,
            getActiveTools: () => ["read", "bash", "edit", "write"],
            setActiveTools: () => {},
            sendMessage: () => {},
        };
        ext.factory(pi);
        expect(commands.has("review")).toBe(true);
        const messages: Array<{ text: string; level: string }> = [];
        const ctx = { hasUI: true, ui: { notify: (text: string, level: string = "info") => messages.push({ text, level }) } };
        await commands.get("review")!.handler("", ctx);
        const last = messages[messages.length - 1];
        expect(last.level).toBe("warning");
        expect(last.text).toContain("Review aborted");
        expect(last.text).toContain("not a git repository");
        // the old bug fed git's fatal stderr to reviewers as "the diff"; the
        // pre-fix no-repo path said "Nothing to review" — both must be gone
        expect(last.text).not.toContain("Nothing to review");
        expect(messages.filter((m) => m.text.includes("reviewer(s) over"))).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// /lsp wiring (P1-b): the H2 trust gate's approval command + the footer
// status lines (pi's ctx.ui.setStatus — the seam the interactive footer
// renders). Driven through a fake pi that records commands AND event
// handlers, with the real config-resolution path (the suite's _env.ts
// preload redirects UNOWN_HOME, so trust state is isolated).
// ---------------------------------------------------------------------------
const MOCK_LSP_SERVER = join(import.meta.dir, "fixtures", "mock-lsp-server.mjs");
const NODE = "node";

const lspTmp = mkdtempSync(join(tmpdir(), "unown-tools-lsp-"));
afterAll(() => {
    try {
        rmSync(lspTmp, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

/** Fake pi with event-handler capture (mcp.test.ts's makeFakePi shape). */
function makeToolsFakePi() {
    const handlers = new Map<string, Array<(event: any, ctx?: any) => any>>();
    const commands = new Map<string, { description: string; handler: (args: string, ctx: any) => Promise<void> }>();
    const pi: any = {
        on: (event: string, handler: (event: any, ctx?: any) => any) => {
            if (!handlers.has(event)) handlers.set(event, []);
            handlers.get(event)!.push(handler);
        },
        registerCommand: (name: string, def: any) => commands.set(name, def),
        registerFlag: () => {},
        registerTool: () => {},
        registerShortcut: () => {},
        appendEntry: () => {},
        getFlag: () => undefined,
        getActiveTools: () => ["read", "bash", "edit", "write"],
        setActiveTools: () => {},
        sendMessage: () => {},
    };
    const emit = async (event: string, payload: any, ctx?: any) => {
        for (const h of handlers.get(event) ?? []) await h(payload, ctx);
    };
    const runCommand = async (name: string, args: string, ctx: any) => {
        await commands.get(name)!.handler(args, ctx);
    };
    return { pi, emit, runCommand, commands };
}

/** ctx whose ui records notify AND setStatus (the footer seam). */
function makeStatusCtx() {
    const messages: Array<{ text: string; level: string }> = [];
    const statuses: Array<[string, string | undefined]> = [];
    return {
        messages,
        statuses,
        ctx: {
            hasUI: true,
            ui: {
                notify: (text: string, level: string = "info") => messages.push({ text, level }),
                setStatus: (key: string, text: string | undefined) => statuses.push([key, text]),
            },
        },
    };
}

describe("/lsp trust (P1-b)", () => {
    test("untrusted project lsp.json: /lsp shows guidance, /lsp trust approves it, overrides then apply", async () => {
        const dir = join(lspTmp, "trust");
        mkdirSync(join(dir, ".unown"), { recursive: true });
        writeFileSync(
            join(dir, ".unown", "lsp.json"),
            JSON.stringify({ servers: { typescript: { command: [NODE, MOCK_LSP_SERVER] } } }),
        );
        const ext = createUnownToolsExtension({ cwd: dir, engineUrl: "http://127.0.0.1:3030" });
        const { pi, runCommand } = makeToolsFakePi();
        ext.factory(pi);

        // Before: the H2 gate withholds the project overrides and /lsp says so.
        const before = makeStatusCtx();
        await runCommand("lsp", "", before.ctx);
        expect(before.messages.some((m) => m.text.includes("untrusted"))).toBe(true);
        expect(before.messages.some((m) => m.text.includes("/lsp trust"))).toBe(true);
        expect(before.messages.some((m) => m.text.includes("mock-lsp-server.mjs"))).toBe(false); // withheld

        // Trust: approves the file, rebuilds the manager, re-renders clean.
        const trust = makeStatusCtx();
        await runCommand("lsp", "trust", trust.ctx);
        expect(trust.messages.some((m) => m.text.includes("Trusted"))).toBe(true);
        expect(trust.messages.some((m) => m.text.includes("untrusted"))).toBe(false);

        // After: the project overrides are live (the mock server is listed).
        const after = makeStatusCtx();
        await runCommand("lsp", "", after.ctx);
        expect(after.messages.some((m) => m.text.includes("untrusted"))).toBe(false);
        expect(after.messages.some((m) => m.text.includes("mock-lsp-server.mjs"))).toBe(true);
    });

    test("no project lsp.json: /lsp trust reports nothing to trust", async () => {
        const dir = join(lspTmp, "no-file");
        mkdirSync(dir, { recursive: true });
        const ext = createUnownToolsExtension({ cwd: dir, engineUrl: "http://127.0.0.1:3030" });
        const { pi, runCommand } = makeToolsFakePi();
        ext.factory(pi);
        const { ctx, messages } = makeStatusCtx();
        await runCommand("lsp", "trust", ctx);
        expect(messages.some((m) => m.text.includes("nothing to trust"))).toBe(true);
    });

    test("UNOWN_TRUST_PROJECT_CONFIG set: /lsp trust reports the bypass instead", async () => {
        const dir = join(lspTmp, "bypass");
        mkdirSync(join(dir, ".unown"), { recursive: true });
        writeFileSync(join(dir, ".unown", "lsp.json"), JSON.stringify({ servers: {} }));
        const ext = createUnownToolsExtension({ cwd: dir, engineUrl: "http://127.0.0.1:3030" });
        const { pi, runCommand } = makeToolsFakePi();
        ext.factory(pi);
        const prev = process.env.UNOWN_TRUST_PROJECT_CONFIG;
        process.env.UNOWN_TRUST_PROJECT_CONFIG = "1";
        try {
            const { ctx, messages } = makeStatusCtx();
            await runCommand("lsp", "trust", ctx);
            expect(messages.some((m) => m.text.includes("already bypassed"))).toBe(true);
        } finally {
            if (prev === undefined) delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
            else process.env.UNOWN_TRUST_PROJECT_CONFIG = prev;
        }
    });

    test("unknown /lsp argument surfaces usage, not silence", async () => {
        const dir = join(lspTmp, "usage");
        mkdirSync(dir, { recursive: true });
        const ext = createUnownToolsExtension({ cwd: dir, engineUrl: "http://127.0.0.1:3030" });
        const { pi, runCommand } = makeToolsFakePi();
        ext.factory(pi);
        const { ctx, messages } = makeStatusCtx();
        await runCommand("lsp", "frobnicate", ctx);
        expect(messages.some((m) => m.text.includes("Unknown /lsp argument"))).toBe(true);
    });
});

describe("footer status lines (P1-b)", () => {
    test("lsp line appears once a warmed server runs, and only on transitions", async () => {
        const dir = join(lspTmp, "footer");
        mkdirSync(join(dir, ".unown"), { recursive: true });
        // A REAL server command the warm can bring up: the mock LSP server,
        // reached through the project override (bypassed gate for focus).
        writeFileSync(
            join(dir, ".unown", "lsp.json"),
            JSON.stringify({ servers: { typescript: { command: [NODE, MOCK_LSP_SERVER] } } }),
        );
        writeFileSync(join(dir, "a.ts"), "const x: number = 1;\n");
        const prev = process.env.UNOWN_TRUST_PROJECT_CONFIG;
        process.env.UNOWN_TRUST_PROJECT_CONFIG = "1";
        try {
            const ext = createUnownToolsExtension({ cwd: dir, engineUrl: "http://127.0.0.1:3030" });
            const { pi, emit } = makeToolsFakePi();
            ext.factory(pi);
            const { ctx, statuses } = makeStatusCtx();

            // First edit: cold start — the warm kicks the server off and the
            // footer line lands when it is running.
            await emit("tool_result", { toolName: "write", input: { path: join(dir, "a.ts") } }, ctx);
            const deadline = Date.now() + 8000;
            while (!statuses.some(([k, t]) => k === "lsp" && t === "lsp: typescript ready") && Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 100));
            }
            expect(statuses.some(([k, t]) => k === "lsp" && t === "lsp: typescript ready")).toBe(true);

            // Transition discipline: a second edit (server already live → the
            // sync path) must NOT repaint the unchanged line.
            const paints = statuses.filter(([k]) => k === "lsp").length;
            await emit("tool_result", { toolName: "write", input: { path: join(dir, "a.ts") } }, ctx);
            expect(statuses.filter(([k]) => k === "lsp").length).toBe(paints);

            await emit("session_shutdown", {}); // disposes the mock server
        } finally {
            if (prev === undefined) delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
            else process.env.UNOWN_TRUST_PROJECT_CONFIG = prev;
        }
    });

    test("/goal sets, updates and clears its footer line", async () => {
        const dir = join(lspTmp, "goal");
        mkdirSync(dir, { recursive: true });
        const ext = createUnownToolsExtension({ cwd: dir, engineUrl: "http://127.0.0.1:3030" });
        const { pi, runCommand } = makeToolsFakePi();
        ext.factory(pi);
        const { ctx, statuses } = makeStatusCtx();
        await runCommand("goal", "ship the status bar", ctx);
        expect(statuses.some(([k, t]) => k === "goal" && t === "goal: active")).toBe(true);
        await runCommand("goal", "pause", ctx);
        expect(statuses.some(([k, t]) => k === "goal" && t === "goal: paused")).toBe(true);
        await runCommand("goal", "resume", ctx);
        expect(statuses.filter(([k, t]) => k === "goal" && t === "goal: active").length).toBe(2);
        await runCommand("goal", "clear", ctx);
        expect(statuses.some(([k, t]) => k === "goal" && t === undefined)).toBe(true);
    });
});
