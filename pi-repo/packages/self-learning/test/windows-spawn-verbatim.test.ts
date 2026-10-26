/**
 * windows-spawn-verbatim.test.ts — the win32 cmd.exe spawn contracts, pinned
 * as DATA after the v0.0.16 release bug: every binary-install engine
 * auto-start on Windows popped "Windows cannot find
 * '\C:\Users\…\unown\versions\0.0.16\unown.exe\'" and setup (which pings the
 * engine) triggered it on first contact.
 *
 * Root cause (both builders under test): an argv that is ALREADY quoted for
 * cmd.exe (`start "" "C:\…\unown.exe"`) was spawned WITHOUT
 * windowsVerbatimArguments, so Node/Bun's default Windows arg escaping
 * re-escaped the embedded quotes into `\"C:\…\unown.exe\"` — a form cmd.exe
 * does not understand (it has no backslash escaping). `start` then read the
 * token `\C:\…\unown.exe\` and ShellExecute failed with the dialog. The
 * builders now carry verbatim:true; these pins hold it there. The
 * node-default-escaping simulation below reproduces the mangling that made
 * the flag load-bearing.
 *
 * v0.0.27 — the same surface, the second half of the fix, and the reason the
 * v0.0.17 pins were not enough: every `unown engine start` of a Windows
 * binary install popped "B:/~BUN/root/unown.exe — The system cannot find the
 * drive specified." Two independent faults composed into it:
 *   (a) `spawnEngineProcess` asked ARGV whether it was running a compiled
 *       binary. It never can tell: every compiled platform reports
 *       `process.argv` as `["bun", "<virtual entry path>", …args]` (measured
 *       on bun 1.4.2, Windows `B:\~BUN\root\…` and Linux `/$bunfs/root/…`),
 *       so the guess missed on every platform and the child was handed Bun's
 *       virtual path as its first argument.
 *   (b) the empty-string title slot never reaches cmd. A verbatim spawn gives
 *       an empty argv entry no token, so `start` took the quoted executable
 *       as its window TITLE and ShellExecuted the next token — which (a) had
 *       just made be the virtual path, hence "cannot find the drive".
 * The argv pins above could not see either fault: they assert a list, not the
 * command line the spawner emits or what a child receives. So the suite at
 * the bottom compiles a real standalone binary, feeds ITS OWN measured
 * execPath/argv through the production builders, spawns it for real and
 * asserts the argv the child recorded.
 */
import "./_env.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEngineServeArgv, buildWindowsEngineSpawnSpec } from "../src/engine-supervisor.ts";
import { windowsMonitorSpawnSpec } from "../src/monitor.ts";
import { isBunVirtualPath } from "../src/packaging.ts";

/** Node's default Windows argument escaping for spawn (what runs when
 * windowsVerbatimArguments is NOT set): embedded quotes become `\"`, and an
 * arg containing whitespace is wrapped after doubling its trailing
 * backslashes. This transform is why a pre-quoted-for-cmd argv must be
 * spawned verbatim. */
function nodeDefaultEscape(arg: string): string {
        let escaped = arg.replace(/(\\*)"/g, '$1$1\\"');
        if (/\s/.test(arg)) {
                escaped = `"${escaped.replace(/(\\*)$/, "$1$1")}"`;
        }
        return escaped;
}

/** What `start`'s tokenizer leaves of a token when the quote characters are
 * consumed as delimiters: the escaped-backslash residue. This is the exact
 * producer of the v0.0.16 dialog path. */
function startResidue(token: string): string {
        return token.replace(/"/g, "");
}

describe("buildWindowsEngineSpawnSpec (the v0.0.17 fix)", () => {
        const exe = "C:\\Users\\kanis\\AppData\\Local\\unown\\versions\\0.0.16\\unown.exe";

        test("the argv is the SS64-correct start form: empty title slot, quoted executable, serve args", () => {
                const spec = buildWindowsEngineSpawnSpec(exe, ["engine", "serve"]);
                expect(spec.command).toBe("cmd");
                expect(spec.args).toEqual(["/c", "start", "/b", '""', `"${exe}"`, "engine", "serve"]);
                // The title slot is the literal two-quote token, NOT an empty string:
                // a verbatim spawn gives an empty argv entry no token at all, `start`
                // then consumes the quoted executable as its TITLE and ShellExecutes
                // whatever follows — the v0.0.27 dialog. The runtime suite below is
                // the authority on that; this pin only holds the shape.
                expect(spec.args[3]).toBe('""');
                // The executable is quoted exactly once — the pre-quoted form `start` needs.
                expect(spec.args[4]).toBe(`"${exe}"`);
        });

        test("verbatim: true — the load-bearing flag of the fix", () => {
                // Without it, Node's default escaping mangles the pre-quoted argv
                // (pinned below) and `start` launches the residue, not the engine.
                expect(buildWindowsEngineSpawnSpec(exe, ["engine", "serve"]).verbatim).toBe(true);
        });

        test("REGRESSION PROOF: Node's default escaping produced the exact dialog path", () => {
                // The v0.0.16 spawn passed `"${command}"` (pre-quoted) through the
                // default escaper. For the user's space-free install path the result
                // is the bare mangled token…
                const mangled = nodeDefaultEscape(`"${exe}"`);
                expect(mangled.startsWith('\\"')).toBe(true);
                expect(mangled.endsWith('\\"')).toBe(true);
                // …and `start` consuming the quotes as delimiters leaves the exact
                // path from the dialog: leading + trailing stray backslashes where
                // the quotes used to be.
                expect(startResidue(mangled)).toBe(`\\${exe}\\`);
        });

        test("the spec spawns NO residue: the executable token is the plain quoted path", () => {
                const spec = buildWindowsEngineSpawnSpec(exe, ["engine", "serve"]);
                expect(spec.args[4]).not.toContain('\\"');
                // And the default escaper would change it — verbatim is what keeps it intact.
                expect(nodeDefaultEscape(spec.args[4])).not.toBe(spec.args[4]);
        });
});

describe("windowsMonitorSpawnSpec (the same class, hardened)", () => {
        test("cmd /d /s /c with the command outer-quoted, verbatim on", () => {
                const spec = windowsMonitorSpawnSpec('type "C:\\Program Files\\x.log"');
                expect(spec.command).toBe("cmd");
                expect(spec.args).toEqual(["/d", "/s", "/c", '"type "C:\\Program Files\\x.log""']);
                expect(spec.verbatim).toBe(true);
        });

        test("plain commands keep their shape under the same outer wrap", () => {
                const spec = windowsMonitorSpawnSpec("ping -n 2 127.0.0.1");
                expect(spec.args).toEqual(["/d", "/s", "/c", '"ping -n 2 127.0.0.1"']);
                expect(spec.verbatim).toBe(true);
        });

        test("REGRESSION PROOF: default escaping of a quoted Windows command breaks it the same way", () => {
                const cmd = 'type "C:\\Program Files\\x.log"';
                const mangled = nodeDefaultEscape(cmd);
                // cmd.exe has no backslash escaping: the \" sequences are garbage
                // on its command line — the monitor would run the wrong thing.
                expect(mangled).not.toBe(cmd);
                expect(mangled).toContain('\\"');
        });
});

// ---------------------------------------------------------------------------
// The runtime leg. Everything above asserts an argv LIST — but neither shipped
// bug was a wrong list. Both were a right list that the spawner or cmd re-read
// into something else. This compiles a real standalone binary, feeds ITS OWN
// measured execPath/argv into the production builders, spawns it for real and
// asserts what the child receives.
// ---------------------------------------------------------------------------

interface ProbeRecord {
        argv: string[];
        execPath: string;
        metaUrl: string;
}

const probeDir = mkdtempSync(join(tmpdir(), "unown-spawn-probe-"));
const probeExe = join(probeDir, process.platform === "win32" ? "spawn-probe.exe" : "spawn-probe");
let probe: ProbeRecord | null = null;

function records(file: string): ProbeRecord[] {
        return readFileSync(file, "utf8")
                .split(/\r?\n/)
                .filter((line) => line.trim())
                .map((line) => JSON.parse(line) as ProbeRecord);
}

async function waitForProbe(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
                if (predicate()) return true;
                await Bun.sleep(100);
        }
        return predicate();
}

/** What a verbatim spawn hands CreateProcess: the argv joined by single
 *  spaces, an empty entry contributing no token at all (measured against
 *  `cmd /c echo`). Convenience for the data pin below — the spawn test is the
 *  authority; this only lets the fault fail fast and legibly. */
function verbatimCommandLine(command: string, args: string[]): string {
        return [command, ...args].join(" ");
}

beforeAll(() => {
        const entry = join(import.meta.dir, "fixtures", "spawn-argv-entry.ts");
        const build = spawnSync(process.execPath, ["build", "--compile", entry, "--outfile", probeExe], {
                encoding: "utf8",
                timeout: 180_000,
        });
        if (build.status !== 0) throw new Error(`probe compile failed: ${build.stderr || build.stdout}`);
        const selfRecord = join(probeDir, "self.jsonl");
        const run = spawnSync(probeExe, ["engine", "serve"], {
                encoding: "utf8",
                timeout: 30_000,
                env: { ...process.env, UNOWN_SPAWN_PROBE_RECORD: selfRecord },
        });
        if (run.status !== 0) throw new Error(`probe run failed: ${run.stderr || run.stdout}`);
        probe = records(selfRecord).at(-1) ?? null;
        if (!probe) throw new Error("probe recorded nothing");
}, 240_000);

afterAll(async () => {
        // A win32 child that outlived its assertion still holds the scratch dir
        // (rmSync answers EBUSY — measured on the red run). It lives under the OS
        // temp dir, so a cleanup that never lands is left to the OS rather than
        // turned into a suite failure.
        for (let attempt = 0; attempt < 10; attempt++) {
                try {
                        rmSync(probeDir, { recursive: true, force: true });
                        return;
                } catch {
                        await Bun.sleep(200);
                }
        }
});

describe("runtime: a real standalone binary through the production spawn path", () => {
        test("argv cannot tell compiled from source — the v0.0.27 fault (a)", () => {
                const measured = probe as ProbeRecord;
                // execPath is the real file on disk (packaging.ts's claim, re-measured).
                expect(isBunVirtualPath(measured.execPath)).toBe(false);
                expect(existsSync(measured.execPath)).toBe(true);
                // The virtual path is what argv carries instead — on EVERY platform.
                expect(isBunVirtualPath(measured.metaUrl)).toBe(true);
                expect(isBunVirtualPath(measured.argv[1])).toBe(true);
                expect(measured.argv[0]).toBe("bun");
                // The guess that shipped, evaluated against the real thing: it
                // answers "source run" here, which is how the virtual path — and on
                // win32 the ShellExecute dialog — reached the child.
                expect(!measured.argv[1] || measured.argv[1] === measured.argv[0]).toBe(false);
                // The builder is told by import.meta.url, not by argv.
                expect(buildEngineServeArgv(measured.argv, true)).toEqual(["engine", "serve"]);
        });

        test("a source run still names its script", () => {
                expect(buildEngineServeArgv([process.execPath, join("repo", "bin", "unown"), "engine"], false)).toEqual([
                        join("repo", "bin", "unown"),
                        "engine",
                        "serve",
                ]);
        });

        test("the emitted command line keeps a title token — the v0.0.27 fault (b)", () => {
                const exe = "C:\\Users\\kanis\\AppData\\Local\\unown\\versions\\0.0.26\\unown.exe";
                const line = verbatimCommandLine("cmd", buildWindowsEngineSpawnSpec(exe, ["engine", "serve"]).args);
                // `start` takes the FIRST quoted token as the window title, so the
                // slot has to still be occupied once the spawner is done with it.
                expect(line).toContain('start /b "" "');
                // The pre-fix shape: the empty entry leaves a gap, and `start` then
                // titles its window with the executable and runs what follows.
                expect(verbatimCommandLine("cmd", ["/c", "start", "/b", "", `"${exe}"`, "engine", "serve"])).not.toContain(
                        'start /b "" ',
                );
        });

        test("the spawn reaches the binary as `engine serve`", async () => {
                const measured = probe as ProbeRecord;
                const args = buildEngineServeArgv(measured.argv, true);
                const childRecord = join(probeDir, "child.jsonl");
                const env = { ...process.env, UNOWN_SPAWN_PROBE_RECORD: childRecord };
                const child =
                        process.platform === "win32"
                                ? (() => {
                                        const spec = buildWindowsEngineSpawnSpec(measured.execPath, args);
                                        return spawn(spec.command, spec.args, {
                                                cwd: probeDir,
                                                windowsHide: true,
                                                windowsVerbatimArguments: spec.verbatim,
                                                stdio: "ignore",
                                                env,
                                        });
                                })()
                                : spawn(measured.execPath, args, { cwd: probeDir, detached: true, stdio: "ignore", env });
                child.on("error", () => {});
                child.unref();
                const launched = await waitForProbe(() => existsSync(childRecord), 25_000);
                if (!launched) {
                        throw new Error(
                                "the standalone child never recorded. On win32 that means cmd's `start` swallowed " +
                                        "the executable as its window title: the title slot must be the literal " +
                                        "'\"\"' token, because a verbatim spawn gives an empty argv entry no token.",
                        );
                }
                const received = records(childRecord).at(-1) as ProbeRecord;
                // The whole point: the child's user argv is the subcommand, with no
                // virtual path spliced in front of it.
                expect(received.argv.slice(2)).toEqual(["engine", "serve"]);
        }, 60_000);
});
