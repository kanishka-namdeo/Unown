// uninstall.test.ts — `unown uninstall` unit tests (hermetic: temp dirs,
// injected removers, no git/network unless a fixture repo is created).
import "./_env.ts";
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
        cmdUninstall,
        findInstallShims,
        findShims,
        parseUninstallFlags,
        shimCandidateDirs,
        shimTarget,
        type UninstallFlags,
} from "../src/uninstall.ts";
import {
        binaryPath,
        installMetadataPath,
        readInstallMetadata,
        writeBinaryShims,
        writeInstallMetadata,
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
        expect(shimTarget(`#!/usr/bin/env bash\nexec "/home/u/.bun/bin/bun" "/repo/Unown/bin/unown" "$@"\n`)).toBe(
                "/repo/Unown/bin/unown",
        );
        expect(shimTarget('@"C:\\bun.exe" "C:\\repos\\Unown\\bin\\unown" %*\n')).toBe("C:\\repos\\Unown\\bin\\unown");
        expect(shimTarget('& "C:\\bun.exe" "C:\\repos\\Unown\\bin\\unown" $args; exit $LASTEXITCODE\n')).toBe(
                "C:\\repos\\Unown\\bin\\unown",
        );
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
        const shim = writePlatformShim(bin, repo);
        const ours = findShims(repo, { UNOWN_BIN_DIR: bin });
        expect(ours.length).toBe(1);
        expect(ours[0].ours).toBe(true);
        // from the OTHER checkout's perspective, the same file is foreign
        const foreign = findShims(other, { UNOWN_BIN_DIR: bin });
        expect(foreign[0].ours).toBe(false);
        expect(foreign[0].path).toBe(shim);
});

/** Write the shim dialect the CURRENT platform's link.ts would write. */
function writePlatformShim(bin: string, repo: string): string {
        const target = join(repo, "bin", "unown");
        if (process.platform === "win32") {
                const p = join(bin, "unown.cmd");
                writeFileSync(p, `@"C:\\bun.exe" "${target}" %*\n`);
                return p;
        }
        const p = join(bin, "unown");
        writeFileSync(p, `#!/usr/bin/env bash\nexec "/b/bun" "${target}" "$@"\n`);
        return p;
}

describe("cmdUninstall", () => {
        function setup(): {
                repo: string;
                home: string;
                bin: string;
                shim: string;
                removed: string[];
                removedDirs: string[];
                lines: string[];
        } {
                const base = fresh();
                const repo = join(base, "Unown");
                const home = join(base, "unown-home");
                const bin = join(base, "bin");
                for (const d of [join(repo, "bin"), join(home, "agent"), bin]) mkdirSync(d, { recursive: true });
                const shim = writePlatformShim(bin, repo);
                writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "unown", version: "9.9.9" }));
                const removed: string[] = [];
                const removedDirs: string[] = [];
                const lines: string[] = [];
                return { repo, home, bin, shim, removed, removedDirs, lines };
        }

        function run(flags: UninstallFlags, s: ReturnType<typeof setup>): number {
                return cmdUninstall(flags, {
                        repoRoot: s.repo,
                        home: s.home,
                        env: { UNOWN_BIN_DIR: s.bin },
                        log: (l) => s.lines.push(l),
                        removeFile: (p) => {
                                s.removed.push(p);
                                rmSync(p, { force: true });
                        },
                        removeDir: (p) => {
                                s.removedDirs.push(p);
                                rmSync(p, { recursive: true, force: true });
                        },
                        hasUncommitted: () => false,
                });
        }

        test("default removes the shim, keeps home + checkout", () => {
                const s = setup();
                const code = run({}, s);
                expect(code).toBe(0);
                expect(s.removed).toEqual([s.shim]);
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
});

// ---------------------------------------------------------------------------
// Binary install: shims pointing into THIS root, then the versioned root.
// No git check runs.
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

        function setupBinary(version = "0.0.1", platform: ReleasePlatform = "linux-x64"): BinaryFixture {
                const base = fresh();
                const root = join(base, "data", "unown");
                const home = join(base, "unown-home");
                const bin = join(base, "bin");
                mkdirSync(join(home, "agent"), { recursive: true });
                writeFileSync(join(home, "agent", "keep.txt"), "memories");
                const file = binaryPath(root, version, platform);
                mkdirSync(join(file, ".."), { recursive: true });
                writeFileSync(file, version);
                const shims = writeBinaryShims({ root, version, env: { UNOWN_BIN_DIR: bin } });
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

        function runBinary(flags: UninstallFlags, s: BinaryFixture, platform: NodeJS.Platform = process.platform): number {
                return cmdUninstall(flags, {
                        install: { mode: "binary", root: s.root, version: s.version, platform: s.platform },
                        home: s.home,
                        env: { UNOWN_BIN_DIR: s.bin },
                        platform,
                        log: (l) => s.lines.push(l),
                        removeFile: (p) => {
                                s.removed.push(p);
                                rmSync(p, { force: true });
                        },
                        removeDir: (p) => {
                                s.removedDirs.push(p);
                                rmSync(p, { recursive: true, force: true });
                        },
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
});

// cleanup
import { afterAll } from "bun:test";

afterAll(() => {
        if (TMP) rmSync(TMP, { recursive: true, force: true });
});
