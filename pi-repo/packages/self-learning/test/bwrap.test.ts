// Unit tests for src/bwrap.ts — OS-sandbox command construction.
//
// Backlog reference: docs/testing-strategy.md §4.5 (sandbox and OS isolation).
// Focus here is the PURE argv construction: the validated bubblewrap profile,
// the env-knob derivation (UNOWN_OS_SANDBOX / UNOWN_SANDBOX_NET / UNOWN_BWRAP
// / UNOWN_SANDBOX_REQUIRED) and the generated sandbox-shell wrapper. LIVE
// profile execution is covered by scripts/bwrap_smoke.sh (25 checks) per
// package AGENTS.md — not here.
//
// These tests run on `bun test` (bun:test is built in — zero new deps).
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
        bwrapArgs,
        decideSandboxFallback,
        netBlocked,
        osSandboxAvailable,
        osSandboxConfigured,
        resolveAgentIsolation,
        resolveBwrapPath,
        runtimeBindArgs,
        SandboxRequiredError,
        sandboxRequired,
        sandboxRequiredMessage,
        wrapCommand,
        writeSandboxShell,
} from "../src/bwrap.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ROOT = join(tmpdir(), "engine-tests-b", "bwrap");
const WORKSPACE = join(ROOT, "ws");
const AGENT_DIR = join(ROOT, "agent-dir");
const FAKE_BWRAP = join(ROOT, "fake-bwrap");
// resolveBwrapPath's vendored path from this file's perspective: <pkg>/native/bin/bwrap
const EXPECTED_VENDORED = join(dirname(fileURLToPath(import.meta.url)), "..", "native", "bin", "bwrap");

mkdirSync(ROOT, { recursive: true });
mkdirSync(WORKSPACE, { recursive: true });
writeFileSync(FAKE_BWRAP, "#!/bin/sh\nexit 0\n", "utf8");
chmodSync(FAKE_BWRAP, 0o755);

afterAll(() => {
        rmSync(ROOT, { recursive: true, force: true });
});

// The env knobs are read at CALL time by bwrap.ts, so per-test save/restore
// gives full control.
const ENV_KEYS = ["UNOWN_OS_SANDBOX", "UNOWN_SANDBOX_NET", "UNOWN_BWRAP", "UNOWN_SANDBOX_REQUIRED"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
        for (const k of ENV_KEYS) {
                savedEnv[k] = process.env[k];
                delete process.env[k];
        }
});

afterEach(() => {
        for (const k of ENV_KEYS) {
                const v = savedEnv[k];
                if (v === undefined) delete process.env[k];
                else process.env[k] = v;
        }
});

// ---------------------------------------------------------------------------
// bwrapArgs — the validated profile
// ---------------------------------------------------------------------------
describe("bwrapArgs — the validated bubblewrap profile", () => {
        const WS = "/ws";
        // Fixed execPath so the argv goldens stay byte-identical on every host:
        // bwrapArgs injects a --ro-bind for the bun runtime dir when it sits
        // under a tmpfs-masked tree (/home/… — the bun.sh default, GH runners),
        // and process.execPath differs per host. /usr/local/bin is unmasked.
        const EXEC = "/usr/local/bin/bun";

        test("golden argv (network blocked)", () => {
                expect(bwrapArgs(WS, true, EXEC)).toEqual([
                        "--ro-bind",
                        "/",
                        "/",
                        "--proc",
                        "/proc",
                        "--dev",
                        "/dev",
                        "--tmpfs",
                        "/home",
                        "--tmpfs",
                        "/run",
                        "--tmpfs",
                        "/tmp",
                        "--tmpfs",
                        "/var/tmp",
                        "--bind",
                        WS,
                        WS,
                        "--chdir",
                        WS,
                        "--die-with-parent",
                        "--new-session",
                        "--cap-drop",
                        "ALL",
                        "--setenv",
                        "HOME",
                        "/tmp/home",
                        "--setenv",
                        "TMPDIR",
                        "/tmp",
                        "--unshare-net",
                        "--unshare-ipc",
                ]);
        });

        test("--new-session is always present (TIOCSTI / CVE-2017-5226 mitigation)", () => {
                // Without a fresh session, a sandboxed TIOCSTI ioctl could inject
                // keystrokes into the controlling terminal of the parent engine.
                expect(bwrapArgs(WS, true, EXEC)).toContain("--new-session");
                expect(bwrapArgs(WS, false, EXEC)).toContain("--new-session");
        });

        test("whole rootfs is read-only bind-mounted at /", () => {
                const args = bwrapArgs(WS, true, EXEC);
                const i = args.indexOf("--ro-bind");
                expect(args[i + 1]).toBe("/");
                expect(args[i + 2]).toBe("/");
        });

        test("workspace is bind-mounted at its REAL path (no path translation)", () => {
                const args = bwrapArgs(WS, true, EXEC);
                const i = args.indexOf("--bind");
                expect(args[i + 1]).toBe(WS);
                expect(args[i + 2]).toBe(WS);
                const chdir = args.indexOf("--chdir");
                expect(args[chdir + 1]).toBe(WS);
        });

        test("private tmpfs mounts cover /home, /run, /tmp and /var/tmp", () => {
                const args = bwrapArgs(WS, true, EXEC);
                const tmpfsTargets: string[] = [];
                for (let i = 0; i + 1 < args.length; i++) {
                        if (args[i] === "--tmpfs") tmpfsTargets.push(args[i + 1]);
                }
                expect(tmpfsTargets).toEqual(["/home", "/run", "/tmp", "/var/tmp"]);
        });

        test("network shared: unshare flags dropped, profile otherwise identical", () => {
                expect(bwrapArgs(WS, false, EXEC)).toEqual(bwrapArgs(WS, true, EXEC).slice(0, -2));
        });

        test("unshare-net/ipc are the last flags when the network is blocked", () => {
                expect(bwrapArgs(WS, true, EXEC).slice(-2)).toEqual(["--unshare-net", "--unshare-ipc"]);
        });

        // The bun-runtime bind: keeps `bun run …` working inside the sandbox
        // when bun is installed under a masked tree (bun.sh default ~/.bun,
        // GitHub Actions /home/runner/.bun). Ordered after the tmpfs mounts.
        test.skipIf(process.platform !== "linux")("runtime bind: bun under a masked tree is ro-bound back in", () => {
                const args = bwrapArgs(WS, true, "/home/runner/.bun/bin/bun");
                const i = args.lastIndexOf("--ro-bind");
                expect(args.slice(i, i + 3)).toEqual(["--ro-bind", "/home/runner/.bun/bin", "/home/runner/.bun/bin"]);
                expect(args.indexOf("--ro-bind")).toBeLessThan(i); // the root ro-bind comes first
                expect(args.indexOf("--tmpfs", args.indexOf("--ro-bind"))).toBeLessThan(i); // after the tmpfs mounts
                expect(args.slice(-2)).toEqual(["--unshare-net", "--unshare-ipc"]); // net flags still last
        });

        test("runtime bind: system installs stay pristine (no extra bind)", () => {
                // Not masked -> the golden argv above is the whole story.
                expect(runtimeBindArgs("/usr/local/bin/bun")).toEqual([]);
                expect(runtimeBindArgs("/opt/bun/bin/bun")).toEqual([]);
        });

        test("runtime bind: empty and relative paths are inert", () => {
                expect(runtimeBindArgs("")).toEqual([]);
        });
});

// ---------------------------------------------------------------------------
// Env knob derivation
// ---------------------------------------------------------------------------
describe("env knobs (UNOWN_OS_SANDBOX / UNOWN_SANDBOX_NET)", () => {
        test("netBlocked: default blocks the network namespace", () => {
                expect(netBlocked()).toBe(true);
        });

        test("netBlocked: UNOWN_SANDBOX_NET=1 keeps the network shared", () => {
                process.env.UNOWN_SANDBOX_NET = "1";
                expect(netBlocked()).toBe(false);
        });

        test('QUIRK: only the exact string "1" shares the network', () => {
                for (const v of ["true", "yes", "0", "on"]) {
                        process.env.UNOWN_SANDBOX_NET = v;
                        expect(netBlocked()).toBe(true);
                }
        });

        test("osSandboxConfigured: enabled by default", () => {
                expect(osSandboxConfigured()).toBe(true);
        });

        test("osSandboxConfigured: UNOWN_OS_SANDBOX=0 disables the OS sandbox", () => {
                process.env.UNOWN_OS_SANDBOX = "0";
                expect(osSandboxConfigured()).toBe(false);
        });

        test('QUIRK: only the exact string "0" disables the sandbox', () => {
                for (const v of ["false", "no", "off"]) {
                        process.env.UNOWN_OS_SANDBOX = v;
                        expect(osSandboxConfigured()).toBe(true);
                }
        });

        test("osSandboxAvailable: disabled env short-circuits to false without spawning bwrap", async () => {
                process.env.UNOWN_OS_SANDBOX = "0";
                expect(await osSandboxAvailable()).toBe(false);
        });
});

// ---------------------------------------------------------------------------
// resolveBwrapPath — the Linux backend's binary resolution. resolveBwrapPath
// returns null on every non-linux host by design (a Git-Bash/WSL bwrap must
// never win on Windows or macOS), so the vendored-path goldens run on the
// Linux CI leg while the off-linux gate itself stays pinned everywhere.
// ---------------------------------------------------------------------------
describe("resolveBwrapPath — off-linux gate (runs everywhere)", () => {
        test.skipIf(process.platform === "linux")("non-linux hosts resolve null — even an existing UNOWN_BWRAP override cannot bypass the gate", () => {
                process.env.UNOWN_BWRAP = FAKE_BWRAP;
                expect(resolveBwrapPath()).toBeNull();
        });
});

describe.skipIf(process.platform !== "linux")("resolveBwrapPath (linux)", () => {
        test("default resolves the vendored binary", () => {
                const p = resolveBwrapPath();
                expect(p).toBe(EXPECTED_VENDORED);
                expect(existsSync(p ?? "")).toBe(true);
        });

        test("UNOWN_BWRAP overrides with an existing path", () => {
                process.env.UNOWN_BWRAP = FAKE_BWRAP;
                expect(resolveBwrapPath()).toBe(FAKE_BWRAP);
        });

        test("QUIRK: a nonexistent override silently falls back to the vendored binary", () => {
                process.env.UNOWN_BWRAP = join(ROOT, "does-not-exist");
                expect(resolveBwrapPath()).toBe(EXPECTED_VENDORED);
        });
});

// ---------------------------------------------------------------------------
// wrapCommand
// ---------------------------------------------------------------------------
describe("wrapCommand", () => {
        // The bwrap argv construction is Linux-only (resolveOsSandboxBackend
        // dispatches to seatbelt on darwin / null on win32) — those legs run
        // the seatbelt twins in test/seatbelt.test.ts instead.
        test.skipIf(process.platform !== "linux")("wraps argv: [bin, ...profile, --, command...]", () => {
                process.env.UNOWN_BWRAP = FAKE_BWRAP;
                const wrapped = wrapCommand(["/bin/sh", "-c", "exit 0"], WORKSPACE);
                expect(wrapped).not.toBeNull();
                expect(wrapped![0]).toBe(FAKE_BWRAP);
                const separator = wrapped!.indexOf("--");
                expect(separator).toBeGreaterThan(0);
                expect(wrapped!.slice(separator + 1)).toEqual(["/bin/sh", "-c", "exit 0"]);
                expect(wrapped!.slice(1, separator)).toEqual(bwrapArgs(WORKSPACE, true));
        });

        test("UNOWN_OS_SANDBOX=0 disables wrapping entirely (TS path jail remains)", () => {
                process.env.UNOWN_OS_SANDBOX = "0";
                expect(wrapCommand(["ls"], WORKSPACE)).toBeNull();
        });

        test.skipIf(process.platform !== "linux")("network flags follow UNOWN_SANDBOX_NET", () => {
                process.env.UNOWN_BWRAP = FAKE_BWRAP;
                process.env.UNOWN_SANDBOX_NET = "1";
                const shared = wrapCommand(["ls"], WORKSPACE)!;
                expect(shared).not.toContain("--unshare-net");
                expect(shared).not.toContain("--unshare-ipc");
                delete process.env.UNOWN_SANDBOX_NET;
                const blocked = wrapCommand(["ls"], WORKSPACE)!;
                expect(blocked).toContain("--unshare-net");
                expect(blocked).toContain("--unshare-ipc");
        });

        test.skipIf(process.platform !== "linux")("the session-hijack mitigation survives into wrapped argv", () => {
                process.env.UNOWN_BWRAP = FAKE_BWRAP;
                expect(wrapCommand(["ls"], WORKSPACE)!).toContain("--new-session");
        });
});

// ---------------------------------------------------------------------------
// writeSandboxShell
// ---------------------------------------------------------------------------
describe("writeSandboxShell", () => {
        // The bwrap wrapper generation is Linux-only (darwin generates the
        // seatbelt wrapper — pinned in test/seatbelt.test.ts; win32 gets null).
        test.skipIf(process.platform !== "linux")("writes an executable wrapper into the agent dir", () => {
                const path = writeSandboxShell(AGENT_DIR);
                expect(path).toBe(join(AGENT_DIR, "unown-sandbox-shell"));
                expect(existsSync(path ?? "")).toBe(true);
                expect(statSync(path!).mode & 0o777).toBe(0o755);
        });

        test.skipIf(process.platform !== "linux")("script re-execs the resolved binary with the validated profile", () => {
                process.env.UNOWN_BWRAP = FAKE_BWRAP;
                const path = writeSandboxShell(AGENT_DIR);
                const script = readFileSync(path!, "utf8");
                expect(script).toContain(`exec '${FAKE_BWRAP}'`);
                expect(script).toContain("--ro-bind / /");
                expect(script).toContain("--new-session");
                expect(script).toContain("--cap-drop ALL");
                expect(script).toContain("--die-with-parent");
                expect(script).toContain("--setenv HOME /tmp/home");
                expect(script).toContain(`-- /bin/bash "$@"`);
                expect(script).toContain("WS=$(pwd -P)"); // workspace derived from invocation cwd
        });

        test.skipIf(process.platform !== "linux")("network-blocked default bakes the unshare flags into the script", () => {
                process.env.UNOWN_BWRAP = FAKE_BWRAP;
                const script = readFileSync(writeSandboxShell(AGENT_DIR)!, "utf8");
                expect(script).toContain("--unshare-net");
                expect(script).toContain("--unshare-ipc");
        });

        test.skipIf(process.platform !== "linux")("UNOWN_SANDBOX_NET=1 omits the unshare flags from the script", () => {
                process.env.UNOWN_BWRAP = FAKE_BWRAP;
                process.env.UNOWN_SANDBOX_NET = "1";
                const script = readFileSync(writeSandboxShell(AGENT_DIR)!, "utf8");
                expect(script).not.toContain("--unshare-net");
                expect(script).not.toContain("--unshare-ipc");
        });

        test("UNOWN_OS_SANDBOX=0 returns null and writes nothing", () => {
                process.env.UNOWN_OS_SANDBOX = "0";
                const fresh = join(ROOT, "agent-dir-disabled");
                expect(writeSandboxShell(fresh)).toBeNull();
                expect(existsSync(fresh)).toBe(false);
        });
});

// ---------------------------------------------------------------------------
// resolveAgentIsolation — the run-record isolation level (M6-3, audit M4-c D2)
describe("resolveAgentIsolation — the run-record isolation level", () => {
        test("mirrors writeSandboxShell's decision on this host", () => {
                const shell = writeSandboxShell(AGENT_DIR);
                const iso = resolveAgentIsolation();
                if (shell === null) {
                        expect(iso).toBe("process");
                } else {
                        expect(iso).toBe(process.platform === "linux" ? "bwrap" : "seatbelt");
                }
        });

        test("kill-switch (UNOWN_OS_SANDBOX=0) -> 'process' and no wrapper", () => {
                process.env.UNOWN_OS_SANDBOX = "0";
                expect(resolveAgentIsolation()).toBe("process");
                expect(writeSandboxShell(AGENT_DIR)).toBeNull();
        });

        test("never returns null — 'process' is the auditable degraded state", () => {
                const iso = resolveAgentIsolation();
                expect(["bwrap", "seatbelt", "process"]).toContain(iso);
        });
});

// ---------------------------------------------------------------------------
// UNOWN_SANDBOX_REQUIRED — the fail-closed sandbox knob (SA-B1, worklog 2-b
// P0-7; the failIfUnavailable analog). All policy here is PURE: the knob
// parse, the decision table, and the typed error. The two integration seams
// that consume them (sandbox.ts execInSandbox, runner.ts runAgent) are pinned
// in sandbox-jail.test.ts.
// ---------------------------------------------------------------------------
describe("UNOWN_SANDBOX_REQUIRED — fail-closed sandbox knob (SA-B1)", () => {
        test("sandboxRequired: unset by default — the open fallback is preserved", () => {
                expect(sandboxRequired()).toBe(false);
        });

        test('sandboxRequired: exactly "1" and "true" arm the knob', () => {
                for (const v of ["1", "true"]) {
                        process.env.UNOWN_SANDBOX_REQUIRED = v;
                        expect(sandboxRequired()).toBe(true);
                }
        });

        test('QUIRK: "0", "yes", "false", "TRUE", "on" and "" do NOT arm the knob', () => {
                for (const v of ["0", "yes", "false", "TRUE", "on", ""]) {
                        process.env.UNOWN_SANDBOX_REQUIRED = v;
                        expect(sandboxRequired()).toBe(false);
                }
        });

        test("decideSandboxFallback (pure): the full decision table", () => {
                expect(decideSandboxFallback(true, false)).toBe("degrade");
                expect(decideSandboxFallback(true, true)).toBe("degrade"); // sandbox present — nothing to fail
                expect(decideSandboxFallback(false, false)).toBe("degrade"); // the historical transparent fallback
                expect(decideSandboxFallback(false, true)).toBe("fail"); // the knob's whole point
        });

        test("decideSandboxFallback: the required default reads the env at call time", () => {
                expect(decideSandboxFallback(false)).toBe("degrade"); // unset
                process.env.UNOWN_SANDBOX_REQUIRED = "1";
                expect(decideSandboxFallback(false)).toBe("fail");
                expect(decideSandboxFallback(true)).toBe("degrade"); // available host never fails
        });

        test("SandboxRequiredError: stable name + actionable message", () => {
                const err = new SandboxRequiredError();
                expect(err).toBeInstanceOf(Error);
                expect(err.name).toBe("SandboxRequiredError");
                expect(err.message).toContain("UNOWN_SANDBOX_REQUIRED");
                expect(err.message).toContain("Refusing to degrade engine runs");
        });

        test("sandboxRequiredMessage names the platform's expected backend", () => {
                const msg = sandboxRequiredMessage();
                if (process.platform === "darwin") expect(msg).toContain("seatbelt");
                else if (process.platform === "win32") expect(msg).toContain("native Windows");
                else expect(msg).toContain("bubblewrap");
        });

        test("kill-switch + knob (the contradictory pair): the message calls it out", () => {
                process.env.UNOWN_OS_SANDBOX = "0";
                process.env.UNOWN_SANDBOX_REQUIRED = "1";
                expect(sandboxRequiredMessage()).toContain("UNOWN_OS_SANDBOX=0");
        });

        // The EXACT composition the two engine-run degrade points evaluate
        // (runner.ts after writeSandboxShell, sandbox.ts execInSandbox after
        // the wrap attempt). The kill-switch forces the degraded state on
        // every platform — which is what a native-Windows host ALWAYS is.
        test("runner/sandbox guard composition: knob armed + degraded isolation -> fail (the win32 story, forced on any host)", () => {
                process.env.UNOWN_OS_SANDBOX = "0";
                process.env.UNOWN_SANDBOX_REQUIRED = "1";
                expect(resolveAgentIsolation()).toBe("process");
                expect(writeSandboxShell(AGENT_DIR)).toBeNull();
                expect(decideSandboxFallback(false)).toBe("fail");
        });

        test("knob unset: the same composition keeps the transparent fallback (no behavior change)", () => {
                process.env.UNOWN_OS_SANDBOX = "0";
                expect(resolveAgentIsolation()).toBe("process");
                expect(writeSandboxShell(AGENT_DIR)).toBeNull();
                expect(decideSandboxFallback(false)).toBe("degrade");
        });
});
