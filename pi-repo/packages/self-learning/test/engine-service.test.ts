/**
 * Unit tests for engine-service.ts — the OS service layer that keeps the
 * engine ALWAYS ON (`unown engine install` / `uninstall`, the P0 gap).
 *
 * Everything here is PURE: the builders are total functions of a ServiceSpec,
 * the platform routing is a total function of the platform, and the compiled
 * refusal is a total function of the flag. The imperative install paths
 * (systemctl/launchctl/powershell) are covered by the E2E lane on machines
 * that have the managers — here we pin the CONTRACTS:
 *   - restart-on-crash but NEVER over a clean exit (the lock loser / a
 *     graceful stop exit 0 — restarting over either would fight the
 *     single-instance lock or undo `unown engine stop`);
 *   - every generated path survives spaces (quoted where the manager's
 *     parser needs it, argv-array where it does not);
 *   - binary installs refuse with the documented reason (the engine stack
 *     is a source-install feature);
 *   - the same identity (unown-engine / ai.unown.engine) is used by install,
 *     status and uninstall on every platform.
 */
import "./_env.ts"; // MUST be the first import
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        ENGINE_SERVICE_NAME,
        LAUNCHD_LABEL,
        autoServiceEnv,
        buildLaunchdPlist,
        buildSystemdUnit,
        buildWindowsLauncherVbs,
        buildWindowsRegisterPs,
        decideAutoServiceInstall,
        describeServiceAutoSkip,
        detectServiceManager,
        installEngineService,
        resolveServiceSpec,
        serviceDisabledMarker,
        windowsLauncherPath,
        windowsStartupDir,
        type ServiceSpec,
} from "../src/engine-service.ts";

const SPEC: ServiceSpec = {
        bunPath: "/opt/bun 1.4/bin/bun", // spaces on purpose — the quoting contract
        entryPath: "/home/u/my projects/Unown/bin/unown",
        workDir: "/home/u/my projects/Unown",
        envFile: "/home/u/my projects/Unown/.env",
        logFile: "/home/u/my projects/Unown/.run/engine.log",
        serveArgs: ["engine", "serve"],
};

describe("detectServiceManager", () => {
        test("darwin → launchd, win32 → schtasks, linux → systemd-user, other → none", () => {
                expect(detectServiceManager("darwin")).toBe("launchd");
                expect(detectServiceManager("win32")).toBe("schtasks");
                expect(detectServiceManager("linux")).toBe("systemd-user");
                expect(detectServiceManager("freebsd")).toBe("none");
        });
});

describe("resolveServiceSpec", () => {
        test("source checkout: bun = execPath, entry = <repo>/bin/unown, cwd = repo", () => {
                const spec = resolveServiceSpec("/repo/unown", false);
                expect(spec.bunPath).toBe(process.execPath);
                expect(spec.entryPath).toBe(join("/repo/unown", "bin", "unown"));
                expect(spec.workDir).toBe("/repo/unown");
                expect(spec.envFile).toBe(join("/repo/unown", ".env"));
                expect(spec.serveArgs).toEqual(["engine", "serve"]);
        });
        test("compiled binary: refuses (the engine stack is a source feature) with the fix in the message", () => {
                expect(() => resolveServiceSpec("/x", true)).toThrow(/source-install/);
                expect(() => resolveServiceSpec("/x", true)).toThrow(/--source/);
        });
});

describe("buildSystemdUnit", () => {
        const unit = buildSystemdUnit(SPEC);

        test("runs the serve entry with the bun runtime", () => {
                expect(unit).toContain(`ExecStart="/opt/bun 1.4/bin/bun" "/home/u/my projects/Unown/bin/unown" engine serve`);
        });
        test("works from the checkout (where .env lives)", () => {
                expect(unit).toContain("WorkingDirectory=/home/u/my projects/Unown");
        });
        test("restarts on crash but NEVER over a clean exit (lock loser / graceful stop)", () => {
                expect(unit).toContain("Restart=on-failure");
                expect(unit).toContain("RestartPreventExitStatus=0");
        });
        test("bounded restart storm (StartLimit) and a drain-friendly stop timeout", () => {
                expect(unit).toContain("StartLimitBurst=5");
                expect(unit).toContain("TimeoutStopSec=30");
        });
        test("enabled at login for the USER session", () => {
                expect(unit).toContain("WantedBy=default.target");
        });
});

describe("buildLaunchdPlist", () => {
        const plist = buildLaunchdPlist(SPEC);

        test("label is the one identity uninstall/status query", () => {
                expect(plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
        });
        test("ProgramArguments: one argv slot per element (no quoting needed, spaces safe)", () => {
                expect(plist).toContain("<string>/opt/bun 1.4/bin/bun</string>");
                expect(plist).toContain("<string>/home/u/my projects/Unown/bin/unown</string>");
                expect(plist).toContain("<string>engine</string>");
                expect(plist).toContain("<string>serve</string>");
        });
        test("runs at load, restarts on crash, stays down after a clean exit", () => {
                expect(plist).toContain("<key>RunAtLoad</key>");
                expect(plist).toMatch(/<key>KeepAlive<\/key>[\s\S]*<key>Crashed<\/key>\s*<true\/>/);
                expect(plist).toMatch(/<key>KeepAlive<\/key>[\s\S]*<key>SuccessfulExit<\/key>\s*<false\/>/);
        });
        test("works from the checkout directory", () => {
                expect(plist).toContain("<string>/home/u/my projects/Unown</string>");
        });
        test("XML-escapes hostile paths", () => {
                const hostile = buildLaunchdPlist({ ...SPEC, workDir: "/a<b>&c" });
                expect(hostile).toContain("/a&lt;b&gt;&amp;c");
                expect(hostile).not.toContain("/a<b>&c");
        });
});

describe("buildWindowsRegisterPs", () => {
        const ps = buildWindowsRegisterPs(SPEC);

        test("registers the one identity as a per-user logon task", () => {
                expect(ps).toContain(`'${ENGINE_SERVICE_NAME}'`);
                expect(ps).toContain("New-ScheduledTaskTrigger -AtLogOn");
        });
        test("single-quote-escapes paths with embedded quotes (PowerShell doubling)", () => {
                const hostile = buildWindowsRegisterPs({ ...SPEC, bunPath: "C:\\o'brien\\bun.exe" });
                expect(hostile).toContain("'C:\\o''brien\\bun.exe'");
        });
        test("no default 3-day execution kill (long-lived daemon)", () => {
                expect(ps).toContain("ExecutionTimeLimit = 'PT0S'");
        });
        test("bounded restart on failure (not an infinite crash loop)", () => {
                expect(ps).toContain("-RestartCount 3");
                expect(ps).toContain("-RestartInterval (New-TimeSpan -Minutes 1)");
                // Direct assignment serialises `00:01:00`, which Task Scheduler rejects.
                expect(ps).not.toContain("$settings.RestartInterval =");
        });
        test("one statement per line — PowerShell has no implicit line continuation", () => {
                for (const line of ps.split("\n")) expect(line.trimStart().startsWith("-")).toBe(false);
                expect(ps).toContain(`New-ScheduledTaskAction -Execute '${SPEC.bunPath}' -Argument '`);
        });
        test("quote-wraps the entry path — CreateProcess splits an unquoted -Argument at the first space", () => {
                expect(ps).toContain(`'"${SPEC.entryPath}" engine serve'`);
        });
});

describe("buildWindowsLauncherVbs (the no-admin logon lane)", () => {
        const vbs = buildWindowsLauncherVbs(SPEC);

        test("runs engine serve hidden and waits, with every path quote-wrapped", () => {
                expect(vbs).toContain(
                        `shell.Run("""/opt/bun 1.4/bin/bun"" ""/home/u/my projects/Unown/bin/unown"" engine serve", 0, True)`,
                );
                expect(vbs).toContain('Set shell = CreateObject("WScript.Shell")');
                expect(vbs).toContain(`shell.CurrentDirectory = "/home/u/my projects/Unown"`);
        });
        test("restarts on failure and stops on a clean exit (systemd/launchd semantics)", () => {
                expect(vbs).toContain("If code = 0 Then Exit Do");
                expect(vbs).toContain("WScript.Sleep 3000");
                expect(vbs).toContain("Do");
                expect(vbs).toContain("Loop");
        });
        test("lives in the per-user Startup folder, keyed off APPDATA", () => {
                const env = { APPDATA: join("C:", "Users", "u", "AppData", "Roaming") } as NodeJS.ProcessEnv;
                expect(windowsStartupDir(env)).toBe(
                        join(env.APPDATA!, "Microsoft", "Windows", "Start Menu", "Programs", "Startup"),
                );
                expect(windowsLauncherPath(env)).toBe(join(windowsStartupDir(env), "unown-engine.vbs"));
        });
});

// ---------------------------------------------------------------------------
// The install/update lane (`--auto`): the service is the DEFAULT on a source
// install, and every skip is an explicit, reported decision.
// ---------------------------------------------------------------------------

const CLEAN_ENV = { UNOWN_ENGINE_AUTOSTART: "", UNOWN_NO_ENGINE_SERVICE: "", CI: "" } as NodeJS.ProcessEnv;
const BASE_INPUT = { env: CLEAN_ENV, platform: "linux" as NodeJS.Platform, compiled: false, uninstalled: false };

describe("decideAutoServiceInstall", () => {
        test("default: installs on every supported platform", () => {
                for (const platform of ["linux", "darwin", "win32"] as NodeJS.Platform[]) {
                        expect(decideAutoServiceInstall({ ...BASE_INPUT, platform })).toEqual({ install: true });
                }
        });
        test("compiled binary → skip (the engine stack is a source-install feature)", () => {
                expect(decideAutoServiceInstall({ ...BASE_INPUT, compiled: true })).toEqual({
                        install: false,
                        reason: "compiled",
                });
        });
        test("no service manager → skip", () => {
                expect(decideAutoServiceInstall({ ...BASE_INPUT, platform: "freebsd" })).toEqual({
                        install: false,
                        reason: "no-manager",
                });
        });
        test("CI → skip (no login session; a build step must not register a logon task)", () => {
                for (const ci of ["1", "true", "TRUE", "yes", "on"]) {
                        expect(decideAutoServiceInstall({ ...BASE_INPUT, env: { ...CLEAN_ENV, CI: ci } })).toEqual({
                                install: false,
                                reason: "ci",
                        });
                }
                expect(decideAutoServiceInstall({ ...BASE_INPUT, env: { ...CLEAN_ENV, CI: "0" } })).toEqual({
                        install: true,
                });
        });
        test("UNOWN_NO_ENGINE_SERVICE=1 → skip", () => {
                for (const v of ["1", "true", "yes", "on"]) {
                        expect(
                                decideAutoServiceInstall({ ...BASE_INPUT, env: { ...CLEAN_ENV, UNOWN_NO_ENGINE_SERVICE: v } }),
                        ).toEqual({ install: false, reason: "opt-out" });
                }
                expect(decideAutoServiceInstall({ ...BASE_INPUT, env: { ...CLEAN_ENV, UNOWN_NO_ENGINE_SERVICE: "" } })).toEqual({
                        install: true,
                });
        });
        test("the engine-off kill switch (UNOWN_ENGINE_AUTOSTART=0) also skips the service", () => {
                for (const v of ["0", "false", "off", "no"]) {
                        expect(
                                decideAutoServiceInstall({ ...BASE_INPUT, env: { ...CLEAN_ENV, UNOWN_ENGINE_AUTOSTART: v } }),
                        ).toEqual({ install: false, reason: "autostart-off" });
                }
        });
        test("a recorded `unown engine uninstall` → skip (never silently re-add what the user removed)", () => {
                expect(decideAutoServiceInstall({ ...BASE_INPUT, uninstalled: true })).toEqual({
                        install: false,
                        reason: "uninstalled",
                });
        });
        test("specific reasons win over the generic CI skip (the actionable line is the one printed)", () => {
                expect(
                        decideAutoServiceInstall({
                                ...BASE_INPUT,
                                env: { ...CLEAN_ENV, CI: "1", UNOWN_NO_ENGINE_SERVICE: "1" },
                        }).reason,
                ).toBe("opt-out");
                expect(
                        decideAutoServiceInstall({ ...BASE_INPUT, env: { ...CLEAN_ENV, CI: "1" }, uninstalled: true }).reason,
                ).toBe("uninstalled");
        });
        test("every skip reason has an actionable line", () => {
                for (const reason of [
                        "compiled",
                        "no-manager",
                        "ci",
                        "opt-out",
                        "autostart-off",
                        "uninstalled",
                ] as const) {
                        expect(describeServiceAutoSkip(reason)).toMatch(/^engine service: skipped \(/);
                }
                expect(describeServiceAutoSkip("opt-out")).toContain("UNOWN_NO_ENGINE_SERVICE=1");
                expect(describeServiceAutoSkip("autostart-off")).toContain("UNOWN_ENGINE_AUTOSTART=0");
                expect(describeServiceAutoSkip("uninstalled")).toContain("unown engine install");
        });
        test("the skip marker lives in UNOWN_HOME, outside the checkout", () => {
                expect(serviceDisabledMarker({ UNOWN_HOME: join(tmpdir(), "u-home") })).toBe(
                        join(tmpdir(), "u-home", "engine-service.disabled"),
                );
        });
});

describe("autoServiceEnv", () => {
        test("reads the two auto-lane knobs from .env (empty = unset), file wins, unrelated keys ignored", () => {
                const dir = mkdtempSync(join(tmpdir(), "unown-svc-env-"));
                try {
                        const file = join(dir, ".env");
                        writeFileSync(file, "UNOWN_ENGINE_AUTOSTART=0\nUNOWN_NO_ENGINE_SERVICE=\nCI=1\n");
                        const merged = autoServiceEnv({ UNOWN_ENGINE_AUTOSTART: "1", CI: "" }, file);
                        expect(merged.UNOWN_ENGINE_AUTOSTART).toBe("0");
                        expect(merged.UNOWN_NO_ENGINE_SERVICE).toBeUndefined();
                        expect(merged.CI).toBe(""); // .env never overrides CI
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

describe("installEngineService --auto", () => {
        test("an opt-out returns 0 with the reason and touches no service manager", async () => {
                const lines: string[] = [];
                const code = await installEngineService("/nonexistent-repo", (s) => lines.push(s), {
                        auto: true,
                        env: { ...CLEAN_ENV, UNOWN_NO_ENGINE_SERVICE: "1" },
                });
                expect(code).toBe(0);
                expect(lines.join("\n")).toContain("engine service: skipped (UNOWN_NO_ENGINE_SERVICE=1)");
        });
});

describe("identities", () => {
        test("service name and launchd label stay stable (status/uninstall match install)", () => {
                expect(ENGINE_SERVICE_NAME).toBe("unown-engine");
                expect(LAUNCHD_LABEL).toBe("ai.unown.engine");
        });
});

describe("temp-home isolation sanity", () => {
        // Guards the shape serviceStatus/uninstall rely on (homedir-based
        // paths): the imperative paths are E2E-tested; here we only pin that
        // a temp HOME is usable so future tests can redirect them safely.
        test("a temp HOME can be created and removed", () => {
                const dir = mkdtempSync(join(tmpdir(), "unown-svc-test-"));
                expect(dir.length).toBeGreaterThan(0);
                rmSync(dir, { recursive: true, force: true });
        });
});
