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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        ENGINE_SERVICE_NAME,
        LAUNCHD_LABEL,
        buildLaunchdPlist,
        buildSystemdUnit,
        buildWindowsRegisterPs,
        detectServiceManager,
        resolveServiceSpec,
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
                expect(ps).toContain("RestartCount = 3");
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
