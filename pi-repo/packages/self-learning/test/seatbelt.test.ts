// Unit tests for the macOS seatbelt (sandbox-exec) backend in src/bwrap.ts.
//
// The seatbelt code paths cannot execute on non-darwin hosts, so this suite
// splits in two:
//   - PURE logic (always runs everywhere): buildSeatbeltProfile goldens, the
//     deterministic profile-path convention, the SBPL path escaping, the
//     workspace realpath resolution, and the platform-gate structure of the
//     dispatcher (resolveSandboxExecPath nulls off-darwin even with the env
//     override set; resolveOsSandboxBackend yields "bwrap" on Linux per
//     binary presence).
//   - LIVE sandbox-exec assertions (skipIf process.platform !== "darwin"):
//     they run on the macOS CI leg and cover binary resolution, the smoke
//     probe, wrapCommand argv, the generated shell wrapper and one real
//     confined execution. On Linux they report as skipped — same pattern as
//     the win32-only tests in termhooks.windows.test.ts.
//
// The WHOLE FILE additionally skips on win32 (first 3-OS CI run): the
// seatbeltWorkspacePath fixtures need POSIX symlinks and the profile-path
// parity check spawns POSIX sh (shasum|cut) — neither exists on native
// Windows. The pure-profile half keeps running on the linux + darwin legs.
//
// The wrapper's shell logic (WS derivation, shasum path convention, heredoc
// profile regeneration, SBPL escaping) was additionally verified end-to-end
// on Linux with a fake sandbox-exec shim during development (see worklog M3);
// those checks are folded into the darwin-gated block below.
import "./_env.ts";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        buildSeatbeltProfile,
        netBlocked,
        osSandboxAvailable,
        resolveOsSandboxBackend,
        resolveSandboxExecPath,
        seatbeltProfilePath,
        seatbeltWorkspacePath,
        wrapCommand,
        writeSandboxShell,
} from "../src/bwrap.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ROOT = join(tmpdir(), "engine-tests-b", "seatbelt");
const WORKSPACE = join(ROOT, "ws");
const AGENT_DIR = join(ROOT, "agent-dir");

mkdirSync(ROOT, { recursive: true });
mkdirSync(WORKSPACE, { recursive: true });

afterAll(() => {
        rmSync(ROOT, { recursive: true, force: true });
});

// The env knobs are read at CALL time by bwrap.ts, so per-test save/restore
// gives full control (same contract as bwrap.test.ts).
const ENV_KEYS = ["UNOWN_OS_SANDBOX", "UNOWN_SANDBOX_NET", "UNOWN_SANDBOX_EXEC"] as const;
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

const DARWIN = process.platform === "darwin";

// ---------------------------------------------------------------------------
// buildSeatbeltProfile — the generated profile text (pure)
// ---------------------------------------------------------------------------
describe.skipIf(process.platform === "win32")("buildSeatbeltProfile — golden text", () => {
        test("golden profile (network blocked, the default)", () => {
                const golden = `(version 1)
(deny default)
(allow file-read*)
(allow process-exec*)
(allow process-fork)
(allow sysctl*)
(allow mach-lookup)
(allow signal (target self))
(allow file-write* (literal "/dev/null"))
(allow file-write* (subpath "/private/tmp"))
(allow file-write* (subpath "/var/folders"))
(allow file-write* (subpath "/tmp/unown-ws"))
(deny file-write* (subpath "/System"))
(deny network*)
`;
                expect(buildSeatbeltProfile("/tmp/unown-ws", { net: false })).toBe(golden);
        });

        test("UNOWN_SANDBOX_NET=1 semantics: net:true flips to (allow network*)", () => {
                const shared = buildSeatbeltProfile("/tmp/unown-ws", { net: true });
                expect(shared).toContain("(allow network*)");
                expect(shared).not.toContain("(deny network*)");
                // and the rest of the profile is byte-identical
                expect(shared.replace("(allow network*)", "(deny network*)")).toBe(buildSeatbeltProfile("/tmp/unown-ws", { net: false }));
        });

        test("writable tmp areas: /private/tmp (sandbox-exec resolves /tmp) and /var/folders (os.tmpdir() on darwin)", () => {
                const p = buildSeatbeltProfile("/tmp/unown-ws", { net: false });
                expect(p).toContain('(allow file-write* (subpath "/private/tmp"))');
                expect(p).toContain('(allow file-write* (subpath "/var/folders"))');
        });

        test("bwrap parity: /dev/null stays writable (fresh /dev in bwrap has device nodes)", () => {
                expect(buildSeatbeltProfile("/tmp/unown-ws", { net: false })).toContain('(allow file-write* (literal "/dev/null"))');
        });

        test("belt-and-braces /System deny comes AFTER the workspace allow (last rule wins in SBPL)", () => {
                const p = buildSeatbeltProfile("/tmp/unown-ws", { net: false });
                const allowWs = p.indexOf(`(allow file-write* (subpath "/tmp/unown-ws"))`);
                const denySystem = p.indexOf('(deny file-write* (subpath "/System"))');
                expect(allowWs).toBeGreaterThan(-1);
                expect(denySystem).toBeGreaterThan(allowWs);
        });

        test("workspace paths are escaped for the SBPL string literal", () => {
                const weird = '/tmp/we"ird\\ws';
                const p = buildSeatbeltProfile(weird, { net: false });
                expect(p).toContain(`(allow file-write* (subpath "/tmp/we\\"ird\\\\ws"))`);
        });

        test("LF only — no CRLF anywhere, trailing newline exactly one", () => {
                const p = buildSeatbeltProfile("/tmp/unown-ws", { net: false });
                expect(p).not.toContain("\r");
                expect(p.endsWith("(deny network*)\n")).toBe(true);
                expect(p.endsWith("\n\n")).toBe(false);
        });

        test("deterministic: identical input -> identical output", () => {
                expect(buildSeatbeltProfile("/tmp/unown-ws", { net: false })).toBe(buildSeatbeltProfile("/tmp/unown-ws", { net: false }));
        });
});

// ---------------------------------------------------------------------------
// seatbeltWorkspacePath / seatbeltProfilePath — resolution + conventions (pure)
// ---------------------------------------------------------------------------
describe.skipIf(process.platform === "win32")("seatbeltWorkspacePath", () => {
        test("resolves symlinks to the physical path (darwin: /tmp -> /private/tmp class of aliases)", () => {
                const real = mkdtempSync(join(tmpdir(), "unown-sb-real-"));
                const link = join(ROOT, "ws-link");
                try {
                        symlinkSync(real, link);
                        expect(seatbeltWorkspacePath(link)).toBe(realpathSync(real));
                } finally {
                        rmSync(real, { recursive: true, force: true });
                }
        });

        test("missing paths fall back to resolve() instead of throwing", () => {
                expect(seatbeltWorkspacePath(join(ROOT, "not-created-yet"))).toBe(join(ROOT, "not-created-yet"));
        });
});

describe.skipIf(process.platform === "win32")("seatbeltProfilePath — deterministic <tmp>/unown-seatbelt-<sha256-16>.sb", () => {
        test("matches the documented convention (first 16 hex of sha256 of the PHYSICAL workspace)", () => {
                const expected = join(
                        tmpdir(),
                        `unown-seatbelt-${createHash("sha256").update(realpathSync(WORKSPACE)).digest("hex").slice(0, 16)}.sb`,
                );
                expect(seatbeltProfilePath(WORKSPACE)).toBe(expected);
        });

        test("the shell wrapper derives the same name via shasum|cut (parity documented in bwrap.ts)", () => {
                const viaShasum = spawnSync("sh", ["-c", `printf '%s' "${realpathSync(WORKSPACE)}" | shasum -a 256 | cut -c 1-16`]);
                // shasum ships on macOS; skip the parity assertion where absent (CI hosts without perl)
                if (viaShasum.status === 0) {
                        const hash = viaShasum.stdout.toString().trim();
                        expect(seatbeltProfilePath(WORKSPACE)).toBe(join(tmpdir(), `unown-seatbelt-${hash}.sb`));
                }
        });

        test("stable per workspace, distinct across workspaces", () => {
                expect(seatbeltProfilePath(WORKSPACE)).toBe(seatbeltProfilePath(WORKSPACE));
                expect(seatbeltProfilePath(WORKSPACE)).not.toBe(seatbeltProfilePath(join(ROOT, "other-ws")));
        });
});

// ---------------------------------------------------------------------------
// Dispatcher structure (runs on every host)
// ---------------------------------------------------------------------------
describe.skipIf(process.platform === "win32")("resolveOsSandboxBackend / resolveSandboxExecPath — platform gates", () => {
        test("resolveSandboxExecPath: non-darwin hosts resolve null — the env override cannot bypass the gate", () => {
                process.env.UNOWN_SANDBOX_EXEC = "/usr/bin/true";
                if (!DARWIN) expect(resolveSandboxExecPath()).toBeNull();
        });

        test.skipIf(!DARWIN)("resolveSandboxExecPath: darwin resolves /usr/bin/sandbox-exec", () => {
                expect(resolveSandboxExecPath()).toBe("/usr/bin/sandbox-exec");
        });

        test.skipIf(!DARWIN)("resolveSandboxExecPath: UNOWN_SANDBOX_EXEC overrides on darwin", () => {
                const fake = join(ROOT, "fake-sandbox-exec");
                writeFileSync(fake, "#!/bin/sh\nexit 0\n", "utf8");
                chmodSync(fake, 0o755);
                process.env.UNOWN_SANDBOX_EXEC = fake;
                expect(resolveSandboxExecPath()).toBe(fake);
        });

        test.skipIf(process.platform !== "linux")("resolveOsSandboxBackend: linux yields bwrap per binary presence (vendored)", () => {
                expect(resolveOsSandboxBackend()).toBe("bwrap");
        });

        test.skipIf(!DARWIN)("resolveOsSandboxBackend: darwin yields seatbelt when sandbox-exec is present", () => {
                expect(resolveOsSandboxBackend()).toBe("seatbelt");
        });
});

// ---------------------------------------------------------------------------
// LIVE sandbox-exec execution — darwin only, skipped (counted) elsewhere
// ---------------------------------------------------------------------------
describe.skipIf(!DARWIN)("seatbelt live execution (darwin only)", () => {
        test("osSandboxAvailable: the smoke probe passes (sandbox-exec can execute)", async () => {
                expect(await osSandboxAvailable()).toBe(true);
        });

        test("wrapCommand: [sandbox-exec, -f, <deterministic profile>, --, command]", () => {
                const wrapped = wrapCommand(["/bin/sh", "-c", "exit 0"], WORKSPACE);
                expect(wrapped).not.toBeNull();
                expect(wrapped![0]).toBe("/usr/bin/sandbox-exec");
                expect(wrapped![1]).toBe("-f");
                expect(wrapped![2]).toBe(seatbeltProfilePath(WORKSPACE));
                expect(existsSync(wrapped![2])).toBe(true);
                // the materialized profile is exactly the pure generator's output
                expect(readFileSync(wrapped![2], "utf8")).toBe(buildSeatbeltProfile(seatbeltWorkspacePath(WORKSPACE), { net: !netBlocked() }));
                expect(wrapped!.slice(3)).toEqual(["--", "/bin/sh", "-c", "exit 0"]);
        });

        test("writeSandboxShell: executable wrapper with WS derivation + deterministic profile", () => {
                const path = writeSandboxShell(AGENT_DIR);
                expect(path).toBe(join(AGENT_DIR, "unown-sandbox-shell"));
                expect(existsSync(path ?? "")).toBe(true);
                const script = readFileSync(path!, "utf8");
                expect(script).toContain("WS=$(pwd -P)");
                expect(script).toContain(`exec '/usr/bin/sandbox-exec' -f "$PROFILE" -- /bin/bash "$@"`);
                expect(script).toContain('unown-seatbelt-$(printf \'%s\' "$WS" | shasum -a 256 | cut -c 1-16).sb');
        });

        test("the wrapper actually confines: tmp writable, $HOME writes denied, network denied", async () => {
                const path = writeSandboxShell(AGENT_DIR)!;
                const probe = `p=/private/tmp/unown-sb-probe-$$; touch "$p" && rm -f "$p" || { echo TMP-DENIED; exit 1; }
if echo x > "$HOME/.unown-sb-probe" 2>/dev/null; then rm -f "$HOME/.unown-sb-probe"; echo HOME-WRITTEN; exit 1; else echo HOME-DENIED; fi
if nc -z -w 1 127.0.0.1 9 2>/dev/null; then echo NET-OPEN; exit 1; else echo NET-DENIED; fi`;
                const proc = Bun.spawn([path, "-c", probe], { cwd: WORKSPACE, stdout: "pipe", stderr: "pipe" });
                const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
                const code = await proc.exited;
                expect(code).toBe(0);
                expect(out).toContain("HOME-DENIED");
                expect(out).toContain("NET-DENIED");
                expect(err).not.toContain("TMP-DENIED");
        });
});
