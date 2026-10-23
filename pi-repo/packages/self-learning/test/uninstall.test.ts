// uninstall.test.ts — `unown uninstall` unit tests (hermetic: temp dirs,
// injected removers, no git/network unless a fixture repo is created).
import "./_env.ts";
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
        checkoutHasUncommittedWork,
        cmdUninstall,
        findInstallShims,
        findShims,
        parseUninstallFlags,
        pathInside,
        renderWindowsRemovalScript,
        scheduleWindowsRootRemoval,
        shimCandidateDirs,
        shimTarget,
        type UninstallFlags,
} from "../src/uninstall.ts";
import {
        binaryPath,
        installMetadataPath,
        readInstallMetadata,
        renderPosixShim,
        renderWindowsCmdShim,
        renderWindowsPs1Shim,
        writeBinaryShims,
        writeInstallMetadata,
        writeShimSet,
        type ReleasePlatform,
} from "../src/install-layout.ts";

let TMP: string;
function fresh(): string {
        TMP ??= mkdtempSync(join(tmpdir(), "unown-uninstall-"));
        const d = join(TMP, `case-${Math.random().toString(36).slice(2)}`);
        mkdirSync(d, { recursive: true });
        return d;
}

test("parseUninstallFlags", () => {
        expect(parseUninstallFlags(["--dry-run"]).flags.dryRun).toBe(true);
        expect(parseUninstallFlags(["--purge-all"]).flags).toEqual({ purgeData: true, purgeCheckout: true });
        expect(parseUninstallFlags(["--purge-data"]).flags.purgeData).toBe(true);
        expect(parseUninstallFlags(["--wat"]).error).toBeDefined();
        expect(parseUninstallFlags(["--help"]).flags.help).toBe(true);
});

test("shimTarget extracts the checkout path from every shim dialect", () => {
        // Each string comes from the renderer that WRITES it, so a quoting change
        // in install-layout moves this test. Hand-written dialects are what let
        // the single-quoted .ps1 shape go unparser'd while uninstall skipped it.
        expect(
                shimTarget(renderPosixShim({ command: "/home/u/.bun/bin/bun", args: ["/repo/Unown/bin/unown"] })),
        ).toBe("/repo/Unown/bin/unown");
        expect(
                shimTarget(renderWindowsCmdShim({ command: "C:\\bun.exe", args: ["C:\\repos\\Unown\\bin\\unown"] })),
        ).toBe("C:\\repos\\Unown\\bin\\unown");
        expect(
                shimTarget(renderWindowsPs1Shim({ command: "C:\\bun.exe", args: ["C:\\repos\\Unown\\bin\\unown"] })),
        ).toBe("C:\\repos\\Unown\\bin\\unown");
        expect(shimTarget("nothing here")).toBeNull();
});

test("shimCandidateDirs honors UNOWN_BIN_DIR then the platform defaults", () => {
        expect(shimCandidateDirs({ UNOWN_BIN_DIR: "/x/y" })).toEqual(["/x/y"]);
        // os.homedir(), not $HOME — on Windows HOME is usually unset (homedir
        // resolves USERPROFILE); the same class the unownHome test caught.
        if (process.platform === "win32") {
                expect(shimCandidateDirs({})).toEqual([join(homedir(), ".local", "bin")]);
        } else {
                expect(shimCandidateDirs({})).toContain(join(homedir(), ".local", "bin"));
        }
});

test("findShims marks ours vs foreign (no cross-install deletion)", () => {
        const home = fresh();
        const repo = join(home, "repo");
        const other = join(home, "other-repo");
        const bin = join(home, "bin");
        for (const d of [join(repo, "bin"), join(other, "bin"), bin]) mkdirSync(d, { recursive: true });
        const shims = writePlatformShims(bin, repo);
        const ours = findShims(repo, { UNOWN_BIN_DIR: bin });
        expect(ours.map((h) => h.path).sort()).toEqual([...shims].sort());
        expect(ours.every((h) => h.ours)).toBe(true);
        // from the OTHER checkout's perspective, the same files are foreign
        const foreign = findShims(other, { UNOWN_BIN_DIR: bin });
        expect(foreign.map((h) => h.ours)).toEqual(shims.map(() => false));
});

// ---------------------------------------------------------------------------
// checkoutHasUncommittedWork — the purge guard's git probe, now routed
// through the shared hardened helper (GitSpawn: `git status` must not execute
// a repo-local core.fsmonitor binary —
// https://shattered.io/gitspawn-ai-coding-agent-vulnerability-2026/).
// ---------------------------------------------------------------------------
describe("checkoutHasUncommittedWork (hardened probe)", () => {
        const gitHere = (): boolean => {
                const r = spawnSync("git", ["--version"], { stdio: "ignore" });
                return !r.error && r.status === 0;
        };
        const HAS_GIT = gitHere();
        const g = (cwd: string, args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });

        function makeGuardRepo(): { repo: string; marker: string } {
                const base = fresh();
                const repo = join(base, "checkout");
                mkdirSync(repo, { recursive: true });
                g(repo, ["init", "-b", "main"]);
                g(repo, ["config", "user.email", "t@unown"]);
                g(repo, ["config", "user.name", "unown test"]);
                writeFileSync(join(repo, "f.txt"), "hello\n");
                g(repo, ["add", "."]);
                g(repo, ["commit", "-m", "initial"]);
                // Hostile core.fsmonitor OUTSIDE the repo (marker + script) so the
                // repo's own cleanliness stays deterministic.
                const marker = join(base, "fsmonitor-ran");
                const script = join(base, "evil-fsmonitor.sh");
                writeFileSync(script, `#!/bin/sh\ntouch "${marker}"\n`);
                try {
                        chmodSync(script, 0o755);
                } catch {
                        /* win32 no-op; the control below is skipped there */
                }
                g(repo, ["config", "core.fsmonitor", script]);
                return { repo, marker };
        }

        test.skipIf(!HAS_GIT)("clean → false, dirty → true, non-repo → careful (true)", () => {
                const { repo } = makeGuardRepo();
                expect(checkoutHasUncommittedWork(repo)).toBe(false);
                writeFileSync(join(repo, "uncommitted.txt"), "wip\n");
                expect(checkoutHasUncommittedWork(repo)).toBe(true);
                expect(checkoutHasUncommittedWork(join(repo, ".."))).toBe(true); // outside any repo
        });

        test.skipIf(!HAS_GIT)("a hostile repo-local core.fsmonitor never executes — and does not skew the verdict (GitSpawn)", () => {
                const { repo, marker } = makeGuardRepo();
                // CONTROL (POSIX only): plain git status runs the hostile helper →
                // the fixture is a live sink.
                if (process.platform !== "win32") {
                        g(repo, ["status", "--porcelain"]);
                        expect(existsSync(marker)).toBe(true);
                        rmSync(marker, { force: true });
                }
                writeFileSync(join(repo, "uncommitted.txt"), "wip\n");
                expect(checkoutHasUncommittedWork(repo)).toBe(true); // still refuses the purge — correct verdict, no exec
                expect(existsSync(marker)).toBe(false);
        });
});

test("the Windows shim set is fully owned by the checkout it points into", () => {
        // Platform-injected so the `.ps1` leg runs on the Linux and macOS CI
        // runners too — the ones that shipped the skipped-shim bug.
        const bin = join(fresh(), "bin");
        const repo = "C:\\repos\\Unown";
        const written = writeShimSet({
                dir: bin,
                platform: "win32",
                command: "C:\\bun.exe",
                args: [`${repo}\\bin\\unown`],
        });
        expect(written.all.length).toBe(2);
        const hits = findShims(repo, { UNOWN_BIN_DIR: bin }, "win32");
        expect(hits.map((h) => h.path)).toEqual(written.all);
        expect(hits.map((h) => h.ours)).toEqual([true, true]);
        // the lenient parser must still refuse another checkout's shims
        expect(findShims("C:\\repos\\OTHER", { UNOWN_BIN_DIR: bin }, "win32").map((h) => h.ours)).toEqual([
                false,
                false,
        ]);
});

/** Write the shim set the CURRENT platform's installer writes. */
function writePlatformShims(bin: string, repo: string): string[] {
        return writeShimSet({
                dir: bin,
                command: process.platform === "win32" ? "C:\\bun.exe" : "/b/bun",
                args: [join(repo, "bin", "unown")],
        }).all;
}

describe("cmdUninstall", () => {
        function setup(): {
                repo: string;
                home: string;
                bin: string;
                shims: string[];
                removed: string[];
                removedDirs: string[];
                lines: string[];
        } {
                const base = fresh();
                const repo = join(base, "Unown");
                const home = join(base, "unown-home");
                const bin = join(base, "bin");
                for (const d of [join(repo, "bin"), join(home, "agent"), bin]) mkdirSync(d, { recursive: true });
                const shims = writePlatformShims(bin, repo);
                writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "unown", version: "9.9.9" }));
                const removed: string[] = [];
                const removedDirs: string[] = [];
                const lines: string[] = [];
                return { repo, home, bin, shims, removed, removedDirs, lines };
        }

        interface RunSeams {
                cwd?: () => string;
                removeFile?: (p: string) => void;
                removeDir?: (p: string) => void;
        }

        function run(flags: UninstallFlags, s: ReturnType<typeof setup>, seams: RunSeams = {}): number {
                return cmdUninstall(flags, {
                        repoRoot: s.repo,
                        home: s.home,
                        env: { UNOWN_BIN_DIR: s.bin },
                        cwd: seams.cwd,
                        log: (l) => s.lines.push(l),
                        removeFile:
                                seams.removeFile ??
                                ((p) => {
                                        s.removed.push(p);
                                        rmSync(p, { force: true });
                                }),
                        removeDir:
                                seams.removeDir ??
                                ((p) => {
                                        s.removedDirs.push(p);
                                        rmSync(p, { recursive: true, force: true });
                                }),
                        hasUncommitted: () => false,
                });
        }

        test("default removes every shim of the set, keeps home + checkout", () => {
                const s = setup();
                const code = run({}, s);
                expect(code).toBe(0);
                expect(s.removed).toEqual(s.shims);
                expect(s.removedDirs).toEqual([]);
                expect(s.lines.join("\n")).toContain("kept");
                expect(s.lines.join("\n")).toContain("uninstalled");
        });

        test("--dry-run changes nothing", () => {
                const s = setup();
                const code = run({ dryRun: true }, s);
                expect(code).toBe(0);
                expect(s.removed).toEqual([]);
                expect(s.removedDirs).toEqual([]);
                expect(s.lines.join("\n")).toContain("would remove");
        });

        test("--purge-data removes the home dir; --purge-checkout the repo", () => {
                const s = setup();
                expect(run({ purgeData: true, purgeCheckout: true }, s)).toBe(0);
                expect(s.removedDirs).toContain(s.home);
                expect(s.removedDirs).toContain(s.repo);
        });

        test("--purge-checkout refuses when the checkout has uncommitted work", () => {
                const s = setup();
                const code = cmdUninstall(
                        { purgeCheckout: true },
                        {
                                repoRoot: s.repo,
                                home: s.home,
                                env: { UNOWN_BIN_DIR: s.bin },
                                log: (l) => s.lines.push(l),
                                removeFile: () => {},
                                removeDir: () => {},
                                hasUncommitted: () => true,
                        },
                );
                expect(code).toBe(1);
                expect(s.lines.join("\n")).toContain("uncommitted work");
        });

        function writeCheckoutRecord(s: ReturnType<typeof setup>, root = s.repo): string {
                writeInstallMetadata(s.home, {
                        schema: 1,
                        mode: "checkout",
                        version: "9.9.9",
                        root,
                        bin: join(root, "bin", "unown"),
                        shim: s.shims[0],
                        installedAt: "2026-01-01T00:00:00.000Z",
                });
                return installMetadataPath(s.home);
        }

        test("--purge-checkout clears the install record that names the deleted root", () => {
                const s = setup();
                const record = writeCheckoutRecord(s);
                expect(run({ purgeCheckout: true }, s)).toBe(0);
                expect(existsSync(record)).toBe(false);
                // only the record: the kept home and its memories are untouched
                expect(existsSync(join(s.home, "agent"))).toBe(true);
        });

        test("a dry run announces the record it would clear and leaves it", () => {
                const s = setup();
                const record = writeCheckoutRecord(s);
                expect(run({ dryRun: true, purgeCheckout: true }, s)).toBe(0);
                expect(existsSync(record)).toBe(true);
                expect(s.lines.join("\n")).toContain("install.json");
        });

        test("a refused purge, and another checkout's record, both keep the record", () => {
                const s = setup();
                const foreign = writeCheckoutRecord(s, join(s.home, "..", "elsewhere"));
                expect(run({ purgeCheckout: true }, s)).toBe(0);
                expect(existsSync(foreign)).toBe(true); // the multi-install rule: report, never delete

                const mine = writeCheckoutRecord(s);
                const code = cmdUninstall(
                        { purgeCheckout: true },
                        {
                                repoRoot: s.repo,
                                home: s.home,
                                env: { UNOWN_BIN_DIR: s.bin },
                                log: (l) => s.lines.push(l),
                                removeFile: () => {},
                                removeDir: () => {},
                                hasUncommitted: () => true,
                        },
                );
                expect(code).toBe(1);
                expect(existsSync(mine)).toBe(true); // nothing was deleted, so the record stays true
        });

        // Same defect class as the 2026-10-23 Windows binary report, in the
        // checkout lane: the purge must go first, and a failure must not throw.
        test("--purge-checkout removes the checkout first, so a failed purge leaves the shims and record", () => {
                const s = setup();
                const record = writeCheckoutRecord(s);
                const code = run({ purgeCheckout: true }, s, {
                        removeDir: () => {
                                throw new Error("EBUSY: resource busy or locked, rmdir");
                        },
                });
                expect(code).toBe(1);
                expect(s.removed).toEqual([]); // no shim was touched
                expect(existsSync(s.shims[0])).toBe(true);
                expect(existsSync(record)).toBe(true);
                expect(s.lines.join("\n")).toContain("nothing else was removed");
        });

        test("--purge-checkout refuses when the shell's cwd is inside the checkout", () => {
                const s = setup();
                const code = run({ purgeCheckout: true }, s, { cwd: () => join(s.repo, "bin") });
                expect(code).toBe(1);
                expect(s.removed).toEqual([]);
                expect(s.removedDirs).toEqual([]);
                expect(existsSync(s.repo)).toBe(true);
                expect(s.lines.join("\n")).toContain("cd out of it");
        });

        test("a purge-data removal failure is reported, not thrown, and exits 1", () => {
                const s = setup();
                const code = run({ purgeData: true }, s, {
                        removeDir: (p) => {
                                s.removedDirs.push(p);
                                throw new Error("EPERM: operation not permitted, rmdir");
                        },
                });
                expect(code).toBe(1);
                expect(existsSync(s.home)).toBe(true);
                const out = s.lines.join("\n");
                expect(out).toContain("uninstall incomplete");
                expect(out).toContain("could not remove");
        });

        test("a locked shim is reported and the rest of the uninstall still runs", () => {
                const s = setup();
                const code = run({ purgeData: true }, s, {
                        removeFile: () => {
                                throw new Error("EPERM: operation not permitted, unlink");
                        },
                });
                expect(code).toBe(1);
                expect(s.removedDirs).toContain(s.home); // the later step still ran
                expect(s.lines.join("\n")).toContain("uninstall incomplete");
        });
});

test("pathInside is segment-aware and case-blind on Windows", () => {
        expect(pathInside("C:\\Apps\\unown\\versions\\0.0.1\\unown.exe", "C:\\Apps\\unown", "win32")).toBe(true);
        expect(pathInside("c:\\apps\\UNOWN", "C:\\Apps\\unown", "win32")).toBe(true);
        // A sibling whose name merely shares the prefix is NOT inside.
        expect(pathInside("C:\\Apps\\unown-old\\x.exe", "C:\\Apps\\unown", "win32")).toBe(false);
        expect(pathInside("C:\\Apps\\unown\\..\\other\\x.exe", "C:\\Apps\\unown", "win32")).toBe(false);
        expect(pathInside("/home/u/.local/share/unown/versions/x", "/home/u/.local/share/unown", "linux")).toBe(true);
        expect(pathInside("/home/u/.local/share/unown-old", "/home/u/.local/share/unown", "linux")).toBe(false);
});

test("the Windows removal script retries, escapes the path, and deletes itself", () => {
        const script = renderWindowsRemovalScript("C:\\Users\\a b\\100% apps\\unown", 7);
        expect(script.startsWith("@echo off\r\n")).toBe(true);
        // % is doubled for batch; the path only ever appears inside quoted expansions.
        expect(script).toContain('set "UNOWN_TARGET=C:\\Users\\a b\\100%% apps\\unown"');
        expect(script).toContain('rmdir /s /q "%UNOWN_TARGET%"');
        expect(script).toContain("if %UNOWN_TRIES% geq 7");
        expect(script).toContain("ping -n 2 127.0.0.1 >nul");
        // Both terminal paths clean the script up — a give-up must not leave one behind.
        expect(script.match(/del \/f \/q "%~f0"/g)).toHaveLength(2);
});

test("scheduleWindowsRootRemoval spawns a detached cmd with a relative script name", () => {
        const dir = mkdtempSync(join(tmpdir(), "unown-sched-"));
        const calls: { cmd: string; args: string[]; opts: Record<string, unknown> }[] = [];
        const fakeSpawn = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
                calls.push({ cmd, args, opts });
                return { on: () => {}, unref: () => {} };
        }) as unknown as typeof import("node:child_process").spawn;
        try {
                const { scriptPath } = scheduleWindowsRootRemoval(join(dir, "root"), { tmpDir: dir, spawnImpl: fakeSpawn });
                expect(dirname(scriptPath)).toBe(dir);
                expect(existsSync(scriptPath)).toBe(true);
                expect(readFileSync(scriptPath, "utf8")).toContain("rmdir /s /q");
                expect(calls).toHaveLength(1);
                // Relative name + cwd: no path ever reaches cmd's command line, so
                // spaces and metacharacters in %TEMP% cannot break or inject it.
                expect(calls[0].args).toEqual(["/d", "/s", "/c", basename(scriptPath)]);
                expect(calls[0].opts).toMatchObject({ cwd: dir, detached: true, stdio: "ignore", windowsHide: true });
        } finally {
                rmSync(dir, { recursive: true, force: true });
        }
});

// ---------------------------------------------------------------------------
// Binary install: the versioned root goes first, then the shims pointing into
// it. No git check runs.
// ---------------------------------------------------------------------------
describe("cmdUninstall (binary install)", () => {
        interface BinaryFixture {
                root: string;
                home: string;
                bin: string;
                version: string;
                platform: ReleasePlatform;
                shim: string;
                shims: string[];
                removed: string[];
                removedDirs: string[];
                lines: string[];
        }

        function setupBinary(
                version = "0.0.1",
                platform: ReleasePlatform = "linux-x64",
                shimPlatform: NodeJS.Platform = process.platform,
        ): BinaryFixture {
                const base = fresh();
                const root = join(base, "data", "unown");
                const home = join(base, "unown-home");
                const bin = join(base, "bin");
                mkdirSync(join(home, "agent"), { recursive: true });
                writeFileSync(join(home, "agent", "keep.txt"), "memories");
                const file = binaryPath(root, version, platform);
                mkdirSync(join(file, ".."), { recursive: true });
                writeFileSync(file, version);
                const shims = writeBinaryShims({ root, version, platform: shimPlatform, env: { UNOWN_BIN_DIR: bin } });
                writeInstallMetadata(home, {
                        schema: 1,
                        mode: "binary",
                        version,
                        platform,
                        root,
                        bin: file,
                        shim: shims.primary,
                        installedAt: "2026-01-01T00:00:00.000Z",
                });
                return {
                        root,
                        home,
                        bin,
                        version,
                        platform,
                        shim: shims.primary,
                        shims: shims.all,
                        removed: [],
                        removedDirs: [],
                        lines: [],
                };
        }

        interface RunSeams {
                platform?: NodeJS.Platform;
                execPath?: string;
                cwd?: () => string;
                scheduleRemoval?: (root: string) => { scriptPath: string };
                removeFile?: (p: string) => void;
                removeDir?: (p: string) => void;
        }

        function runBinary(flags: UninstallFlags, s: BinaryFixture, seams: RunSeams = {}): number {
                return cmdUninstall(flags, {
                        install: { mode: "binary", root: s.root, version: s.version, platform: s.platform },
                        home: s.home,
                        env: { UNOWN_BIN_DIR: s.bin },
                        platform: seams.platform ?? process.platform,
                        execPath: seams.execPath,
                        cwd: seams.cwd,
                        scheduleRemoval: seams.scheduleRemoval,
                        log: (l) => s.lines.push(l),
                        removeFile:
                                seams.removeFile ??
                                ((p) => {
                                        s.removed.push(p);
                                        rmSync(p, { force: true });
                                }),
                        removeDir:
                                seams.removeDir ??
                                ((p) => {
                                        s.removedDirs.push(p);
                                        rmSync(p, { recursive: true, force: true });
                                }),
                        hasUncommitted: () => {
                                throw new Error("binary uninstall must not run git checks");
                        },
                });
        }

        test("removes this root's shims, the versioned root and install.json; keeps ~/.unown", () => {
                const s = setupBinary();
                const code = runBinary({}, s);
                expect(code).toBe(0);
                expect(s.removed).toEqual(expect.arrayContaining(s.shims));
                expect(s.removedDirs).toContain(s.root);
                expect(existsSync(s.root)).toBe(false);
                expect(existsSync(installMetadataPath(s.home))).toBe(false);
                expect(existsSync(join(s.home, "agent", "keep.txt"))).toBe(true);
                expect(s.lines.join("\n")).toContain("binary install");
                expect(s.lines.join("\n")).toContain("uninstalled");
        });

        test("--dry-run lists everything and changes nothing", () => {
                const s = setupBinary();
                const code = runBinary({ dryRun: true }, s);
                expect(code).toBe(0);
                expect(s.removed).toEqual([]);
                expect(s.removedDirs).toEqual([]);
                expect(existsSync(s.root)).toBe(true);
                expect(existsSync(s.shim)).toBe(true);
                expect(readInstallMetadata(s.home)?.version).toBe("0.0.1");
                expect(s.lines.join("\n")).toContain("would remove");
        });

        test("a shim pointing into a different install root is skipped, never deleted", () => {
                const s = setupBinary();
                const otherRoot = join(s.root, "..", "other-unown");
                writeBinaryShims({ root: otherRoot, version: "9.9.9", env: { UNOWN_BIN_DIR: s.bin } });
                expect(findInstallShims(s.root, { UNOWN_BIN_DIR: s.bin })[0].ours).toBe(false);
                const code = runBinary({}, s);
                expect(code).toBe(0);
                expect(s.removed.filter((p) => s.shims.includes(p))).toEqual([]); // foreign shim untouched
                expect(existsSync(s.shim)).toBe(true);
                expect(existsSync(s.root)).toBe(false); // the root itself still goes
                expect(s.lines.join("\n")).toContain("different unown install");
        });

        test("--purge-data also removes ~/.unown", () => {
                const s = setupBinary();
                expect(runBinary({ purgeData: true }, s)).toBe(0);
                expect(s.removedDirs).toContain(s.home);
                expect(existsSync(s.home)).toBe(false);
        });

        // The 2026-10-23 Windows report: the shipped order deleted the shims
        // first, then failed on the locked root — leaving no `unown` to re-run.
        test("the root goes first, so a failed removal leaves the shims and the record", () => {
                const s = setupBinary();
                const code = runBinary({}, s, {
                        removeDir: () => {
                                throw new Error("EPERM: operation not permitted, rm");
                        },
                });
                expect(code).toBe(1);
                expect(s.removed).toEqual([]); // no shim was touched
                expect(existsSync(s.shim)).toBe(true);
                expect(readInstallMetadata(s.home)?.mode).toBe("binary");
                const out = s.lines.join("\n");
                expect(out).toContain("could not remove");
                expect(out).toContain("nothing was removed");
        });

        test("a Windows self-delete schedules the root instead of removing it", () => {
                const s = setupBinary("0.0.1", "windows-x64", "win32");
                const scheduled: string[] = [];
                const code = runBinary({}, s, {
                        platform: "win32",
                        execPath: binaryPath(s.root, s.version, "windows-x64"),
                        scheduleRemoval: (root) => {
                                scheduled.push(root);
                                return { scriptPath: join(s.root, "..", "cleanup.cmd") };
                        },
                });
                expect(code).toBe(0);
                expect(scheduled).toEqual([s.root]);
                expect(s.removedDirs).toEqual([]); // rmSync never runs against the running install
                expect(s.removed).toEqual(expect.arrayContaining(s.shims));
                expect(existsSync(s.shim)).toBe(false);
                expect(existsSync(installMetadataPath(s.home))).toBe(false);
                expect(s.lines.join("\n")).toContain("scheduled");
        });

        test("a failed schedule still leaves the shims and the record", () => {
                const s = setupBinary("0.0.1", "windows-x64", "win32");
                const code = runBinary({}, s, {
                        platform: "win32",
                        execPath: binaryPath(s.root, s.version, "windows-x64"),
                        scheduleRemoval: () => {
                                throw new Error("ENOENT: temp dir unavailable");
                        },
                });
                expect(code).toBe(1);
                expect(existsSync(s.shim)).toBe(true);
                expect(existsSync(installMetadataPath(s.home))).toBe(true);
                expect(s.lines.join("\n")).toContain("nothing was removed");
        });

        test("a shell sitting inside the root is refused before anything is touched", () => {
                const s = setupBinary("0.0.1", "windows-x64", "win32");
                const scheduled: string[] = [];
                const code = runBinary({}, s, {
                        platform: "win32",
                        execPath: binaryPath(s.root, s.version, "windows-x64"),
                        cwd: () => join(s.root, "versions"),
                        scheduleRemoval: (root) => {
                                scheduled.push(root);
                                return { scriptPath: "" };
                        },
                });
                expect(code).toBe(1);
                expect(scheduled).toEqual([]);
                expect(s.removed).toEqual([]);
                expect(s.removedDirs).toEqual([]);
                expect(existsSync(s.shim)).toBe(true);
                expect(existsSync(s.root)).toBe(true);
                expect(s.lines.join("\n")).toContain("cd out of the install root");
        });

        test("POSIX still removes synchronously even when running from inside the root", () => {
                const s = setupBinary();
                const scheduled: string[] = [];
                const code = runBinary({}, s, {
                        platform: "linux",
                        execPath: binaryPath(s.root, s.version, "linux-x64"),
                        scheduleRemoval: (root) => {
                                scheduled.push(root);
                                return { scriptPath: "" };
                        },
                });
                expect(code).toBe(0);
                expect(scheduled).toEqual([]); // unlink of a running image is legal on POSIX
                expect(s.removedDirs).toContain(s.root);
                expect(existsSync(s.root)).toBe(false);
        });

        test("--dry-run announces the Windows background removal and does not schedule", () => {
                const s = setupBinary("0.0.1", "windows-x64", "win32");
                const scheduled: string[] = [];
                const code = runBinary({ dryRun: true }, s, {
                        platform: "win32",
                        execPath: binaryPath(s.root, s.version, "windows-x64"),
                        scheduleRemoval: (root) => {
                                scheduled.push(root);
                                return { scriptPath: "" };
                        },
                });
                expect(code).toBe(0);
                expect(scheduled).toEqual([]);
                expect(existsSync(s.root)).toBe(true);
                expect(s.lines.join("\n")).toContain("background helper");
        });

        test("a locked install record is reported, not thrown; the root still goes", () => {
                const s = setupBinary();
                const code = runBinary({}, s, {
                        removeFile: () => {
                                throw new Error("EPERM: operation not permitted, unlink");
                        },
                });
                expect(code).toBe(1);
                expect(s.removedDirs).toContain(s.root);
                expect(existsSync(s.root)).toBe(false);
                expect(existsSync(installMetadataPath(s.home))).toBe(true);
                expect(s.lines.join("\n")).toContain("uninstall incomplete");
        });

        test("--purge-data under a locked home reports and exits 1 (a session holds it open)", () => {
                const s = setupBinary();
                const code = runBinary({ purgeData: true }, s, {
                        removeDir: (p) => {
                                s.removedDirs.push(p);
                                if (p === s.home) throw new Error("EPERM: operation not permitted, rmdir");
                                rmSync(p, { recursive: true, force: true });
                        },
                });
                expect(code).toBe(1);
                expect(existsSync(s.home)).toBe(true);
                expect(s.lines.join("\n")).toContain("close it and re-run");
        });
});

// cleanup
import { afterAll } from "bun:test";

afterAll(() => {
        if (TMP) rmSync(TMP, { recursive: true, force: true });
});
