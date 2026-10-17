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
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isBunVirtualScriptPath, isSafeCommand, resolveUnownCliScript } from "../src/tools.ts";

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
