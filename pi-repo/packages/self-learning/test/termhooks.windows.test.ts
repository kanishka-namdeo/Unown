// Windows / cross-platform coverage for the hook deny lists and the terminal
// write-path policy (M2: make the self-learning engine layer cross-platform).
//
//   - the Windows catastrophic family added to hooks.ts BASH_DENY and
//     termhooks.ts TERMINAL_BASH_DENY. Matched on ALL platforms by design:
//     Git Bash, WSL and the powershell tool (whose commands reach the same
//     decide* deny path as bash) make every Windows spelling reachable from
//     any host.
//   - benign Windows-native commands must keep passing (no over-blocking):
//     dir / Get-* / reg query / vssadmin list stay allowed.
//   - terminalPathOk: the system temp dir (os.tmpdir(), realpath-resolved) is
//     an allowed write root next to the project dir — exercised through the
//     injectable tmpRoots parameter (the production default derives from
//     os.tmpdir() + POSIX /tmp).
//   - bashRedirectEscape: the win32 SYSTEM_TREE / RAW_DEVICE twins. Those
//     resolve through node:path, which only yields backslash absolute paths
//     on win32 — the pair runs on the Windows CI leg and skipIf elsewhere;
//     the deny-LIST half (lexical regex) works everywhere and is pinned here.
//
// Same conventions as termhooks.test.ts; the fixture root sits under $HOME
// (outside every allowed temp root) so temp-dir allowances cannot mask jail
// escapes.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { bashRedirectEscape, createTerminalExtension, terminalPathOk } from "../src/termhooks.ts";
import { decideBash } from "../src/hooks.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const VT_ROOT = mkdtempSync(join(homedir(), ".unown-win-test-"));
const PROJ = join(VT_ROOT, "proj");
mkdirSync(PROJ, { recursive: true });
// Real temp-dir fixture used as the INJECTED tmp root. It must NOT be the
// project cwd — a project inside tmpdir() would mask jail escapes.
const TMP_ROOT = mkdtempSync(join(tmpdir(), "unown-win-tmp-"));

afterAll(() => {
        rmSync(VT_ROOT, { recursive: true, force: true });
        rmSync(TMP_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fake pi extension host (same shape as termhooks.test.ts)
// ---------------------------------------------------------------------------
type HookHandler = (event: Record<string, unknown>, ctx?: unknown) => unknown;

interface Decision {
        block: boolean;
        reason?: string;
        terminate?: boolean;
}

function attach(opts: { strict?: boolean }): Record<string, HookHandler> {
        const handlers: Record<string, HookHandler> = {};
        const ext = createTerminalExtension({
                cwd: PROJ,
                engineUrl: "http://127.0.0.1:3030",
                strict: opts.strict,
        });
        ext.factory({
                on: (name: string, handler: HookHandler) => {
                        handlers[name] = handler;
                },
        });
        return handlers;
}

function bashDecision(handlers: Record<string, HookHandler>, command: string): Decision | undefined {
        return handlers["tool_call"]({ toolName: "bash", input: { command } }) as Decision | undefined;
}

const nonStrict = attach({});
const strict = attach({ strict: true });

// ---------------------------------------------------------------------------
// The Windows catastrophic family — denied across all three policies
// ---------------------------------------------------------------------------
describe("windows catastrophic family — denied across all three policies", () => {
        test.each([
                // drive format
                "format C:",
                "format D: /fs:ntfs",
                "cmd /c format C:",
                // cmd tree deletes on drive roots / Windows system trees (incl. Users)
                "del /s /q C:\\Users",
                "del /f /q C:\\",
                "del C:\\*",
                "del /s C:\\Windows\\System32\\junk",
                "rmdir /s /q C:\\Windows",
                "rd /s C:\\",
                "erase /s C:\\PerfLogs",
                "rd /s /q C:\\Users\\me",
                // registry / boot / disk / backup
                "reg add HKLM\\Software\\Unown /v x /d y",
                "reg delete HKLM\\Software\\Unown /f",
                "reg import evil.reg",
                "bcdedit /set {bootmgr} timeout 0",
                "diskpart /s script.txt",
                "vssadmin delete shadows /all /quiet",
                "wbadmin delete catalog",
                "takeown /f C:\\Windows\\system32\\cmd.exe",
                "cipher /w:C:",
                // PowerShell
                "Set-ExecutionPolicy Unrestricted",
                "set-executionpolicy -Scope Process Bypass",
                "powershell -EncodedCommand AAAA",
                "powershell.exe -encodedCommand AAAA",
                "pwsh -EncodedCommand AAAA",
                "Remove-Item -Recurse C:\\Windows",
                "Remove-Item -Recurse -Force C:\\",
                "Remove-Item -recurse C:\\Users\\me\\old",
                "Stop-Process -Name csrss",
                "stop-process -name wininit",
                "taskkill /f /im svchost.exe",
                "taskkill /im lsass",
                // raw device namespace writes
                "echo x > \\\\.\\PhysicalDrive1",
                "echo x > \\\\.\\C:",
                "echo x > //./PhysicalDrive2",
        ])("%s", (command: string) => {
                expect(decideBash(command).block).toBe(true);
                expect(typeof decideBash(command).reason).toBe("string");
                expect(Boolean(bashDecision(nonStrict, command)?.block)).toBe(true);
                expect(Boolean(bashDecision(strict, command)?.block)).toBe(true);
        });

        test("reason strings identify the matched rule", () => {
                expect(decideBash("format C:").reason).toContain("format");
                expect(decideBash("del /s /q C:\\Users").reason).toContain("Windows system trees");
                expect(decideBash("reg add HKLM\\X").reason).toContain("registry");
                expect(decideBash("Remove-Item -Recurse C:\\Windows").reason).toContain("recursive delete");
        });
});

// ---------------------------------------------------------------------------
// Benign Windows-native commands stay allowed (no over-blocking)
// ---------------------------------------------------------------------------
describe("windows family — benign commands stay allowed", () => {
        test.each([
                "dir C:\\projects",
                "Get-Content package.json",
                "Get-ChildItem -Recurse .\\src",
                "echo hi",
                "reg query HKLM\\Software\\Unown", // POLICY: only add/delete/import are denied
                "vssadmin list shadows", // POLICY: only delete is denied
                "taskkill /f /im node.exe", // POLICY: only critical system processes are denied
                "del notes.txt", // single-file delete, no drive letter
                "del /q notes.txt", // /q alone (no /s) is not recursive
                "rd emptydir", // rmdir without /s only removes empty dirs
                "Remove-Item -Recurse .\\build", // in-project recursive delete stays legal work
                "Remove-Item tmp\\junk -Recurse",
                "format output.txt", // no drive letter — not the format verb
                "ls -la",
                "git status",
        ])("%s", (command: string) => {
                expect(decideBash(command).block).toBe(false);
                expect(bashDecision(nonStrict, command)).toBeUndefined();
        });
});

// ---------------------------------------------------------------------------
// terminalPathOk — the system temp dir is an allowed write root
// ---------------------------------------------------------------------------
describe("terminalPathOk — the system temp dir is an allowed write root", () => {
        test("writes inside the injected tmp root are allowed", () => {
                expect(terminalPathOk(PROJ, join(TMP_ROOT, "x.md"), [TMP_ROOT])).toBe(true);
                expect(terminalPathOk(PROJ, join(TMP_ROOT, "sub", "y.md"), [TMP_ROOT])).toBe(true);
        });

        test("traversal out of the injected tmp root is NOT allowed", () => {
                expect(terminalPathOk(PROJ, join(TMP_ROOT, "..", "etc", "passwd"), [TMP_ROOT])).toBe(false);
        });

        test("the default policy allows os.tmpdir() and POSIX /tmp, but not /var/tmp or system paths", () => {
                expect(terminalPathOk(PROJ, join(tmpdir(), "notes.md"))).toBe(true);
                expect(terminalPathOk(PROJ, "/tmp/session-notes.md")).toBe(true);
                expect(terminalPathOk(PROJ, "/tmp/sub/dir/x.md")).toBe(true);
                expect(terminalPathOk(PROJ, "/var/tmp/x")).toBe(false);
                expect(terminalPathOk(PROJ, "/etc/passwd")).toBe(false);
                expect(terminalPathOk(PROJ, "../../etc/passwd")).toBe(false);
        });

        test("the project jail still wins first (in-project writes stay allowed)", () => {
                expect(terminalPathOk(PROJ, "src/main.ts")).toBe(true);
                expect(terminalPathOk(PROJ, join(PROJ, "notes.md"))).toBe(true);
        });
});

// ---------------------------------------------------------------------------
// bashRedirectEscape — the win32 twins
// ---------------------------------------------------------------------------
describe("bashRedirectEscape — win32 twins (drive-letter system trees, \\\\.\\ devices)", () => {
        // The deny-LIST half is lexical and works on every platform:
        test("the device-namespace redirect is denied by the regex list on every platform", () => {
                expect(decideBash("echo x > \\\\.\\PhysicalDrive1").block).toBe(true);
                expect(Boolean(bashDecision(nonStrict, "echo x > \\\\.\\PhysicalDrive1")?.block)).toBe(true);
        });

        // The resolved-path half (SYSTEM_TREE_WIN / RAW_DEVICE_WIN / SSH_TRUST_DIR)
        // compares node:path-resolved strings — backslash absolute paths only
        // exist on win32, so these run on the Windows CI leg and skip elsewhere.
        test.skipIf(process.platform !== "win32")("raw device and system-tree redirects are flagged", () => {
                expect(bashRedirectEscape(PROJ, "echo x > \\\\.\\PhysicalDrive1")).toContain("PhysicalDrive1");
                expect(bashRedirectEscape(PROJ, "echo x > \\\\.\\CdRom0")).toContain("CdRom0");
                expect(bashRedirectEscape(PROJ, "echo x > C:\\Windows\\hack.txt")).toContain("Windows");
                expect(bashRedirectEscape(PROJ, "echo key > C:\\Users\\me\\.ssh\\authorized_keys")).toContain(".ssh");
        });

        test.skipIf(process.platform !== "win32")("in-project redirects stay allowed (no over-jailing)", () => {
                expect(bashRedirectEscape(PROJ, "echo x > out.txt")).toBeNull();
                expect(bashRedirectEscape(PROJ, "echo x > C:\\projects\\build.log")).toBeNull();
        });
});
