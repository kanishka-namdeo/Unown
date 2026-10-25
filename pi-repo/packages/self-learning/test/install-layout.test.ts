// install-layout.test.ts — the install-mode contract shared by the updater,
// the uninstaller, scripts/link.ts and the binary installer.
//
// Hermetic: every path is built under the test tmpdir; no git, no network.
import "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import {
        archiveName,
        assetUrl,
        binaryPath,
        cheapInstallMode,
        checksumsUrl,
        defaultInstallRoot,
        detectMusl,
        detectPlatform,
        inferBinaryLayout,
        installMetadataPath,
        parseChecksumFor,
        platformGate,
        readInstallMetadata,
        renderPosixShim,
        sha256File,
        shimPaths,
        shimTargetsRoot,
        validateInstallMetadata,
        versionDir,
        versionTxtUrl,
        writeBinaryShims,
        writeInstallMetadata,
        type InstallMetadata,
} from "../src/install-layout.ts";

let TMP = "";
function fresh(): string {
        TMP ||= mkdtempSync(join(tmpdir(), "unown-layout-"));
        const d = join(TMP, `c-${Math.random().toString(36).slice(2)}`);
        mkdirSync(d, { recursive: true });
        return d;
}

afterAll(() => {
        if (TMP) rmSync(TMP, { recursive: true, force: true });
});

function sample(overrides: Partial<InstallMetadata> = {}): InstallMetadata {
        return {
                schema: 1,
                mode: "binary",
                version: "0.0.2",
                platform: "linux-x64",
                root: "/opt/unown",
                bin: "/opt/unown/versions/0.0.2/unown",
                shim: "/home/u/.local/bin/unown",
                previousVersion: "0.0.1",
                installedAt: "2026-01-01T00:00:00.000Z",
                ...overrides,
        };
}

describe("install metadata", () => {
        test("round-trips and validates", () => {
                const home = fresh();
                writeInstallMetadata(home, sample());
                expect(readInstallMetadata(home)).toEqual(sample());
                expect(JSON.parse(readFileSync(installMetadataPath(home), "utf8")).schema).toBe(1);
        });

        test("corrupt / foreign / incomplete metadata reads as null (never throws)", () => {
                const home = fresh();
                expect(readInstallMetadata(home)).toBeNull(); // missing
                writeFileSync(installMetadataPath(home), "{not json");
                expect(readInstallMetadata(home)).toBeNull();
                writeFileSync(installMetadataPath(home), JSON.stringify({ ...sample(), schema: 2 }));
                expect(readInstallMetadata(home)).toBeNull();
                writeFileSync(installMetadataPath(home), JSON.stringify({ ...sample(), shim: undefined }));
                expect(readInstallMetadata(home)).toBeNull();
                expect(validateInstallMetadata(null)).toBeNull();
                expect(validateInstallMetadata([])).toBeNull();
                expect(validateInstallMetadata({ ...sample(), mode: "portable" })).toBeNull();
                expect(validateInstallMetadata({ ...sample(), version: "../../evil" })).toBeNull();
        });

        test("the pre-release `source` spelling resolves as checkout", () => {
                // install.sh and install.ps1 have always folded this spelling;
                // the runtime reader used to reject it, which left a machine with
                // an old record and no mode for `unown update` to act on.
                expect(validateInstallMetadata({ ...sample(), mode: "source" })?.mode).toBe("checkout");
                const home = fresh();
                writeFileSync(installMetadataPath(home), JSON.stringify({ ...sample(), mode: "source" }));
                expect(readInstallMetadata(home)?.mode).toBe("checkout");
                // Folding must not become accepting: an unknown channel is still null.
                expect(validateInstallMetadata({ ...sample(), mode: "portable" })).toBeNull();
        });

        test("one record, three readers: a minified file parses like a pretty one", () => {
                // The POSIX and PowerShell installers write the pretty shape and
                // the runtime writes the same fields; a reader that only answers
                // for one layout is how the mode-change guard starts disagreeing
                // with the updater. Pin the runtime side of the parity that
                // install-meta-readers.test.ts proves across all three.
                const home = fresh();
                writeFileSync(installMetadataPath(home), JSON.stringify(sample()));
                expect(readInstallMetadata(home)).toEqual(sample());
        });

        test("writes atomically: repeated writes replace the file and leave no temp files", () => {
                const home = fresh();
                writeInstallMetadata(home, sample({ version: "0.0.2" }));
                writeInstallMetadata(home, sample({ version: "0.0.3" }));
                expect(readInstallMetadata(home)?.version).toBe("0.0.3");
                expect(readdirSync(home).filter((f) => f.endsWith(".tmp"))).toEqual([]);
        });
});

describe("layout", () => {
        test("defaultInstallRoot honors overrides, XDG_DATA_HOME and LOCALAPPDATA", () => {
                expect(defaultInstallRoot({ UNOWN_INSTALL_ROOT: "/custom" }, "linux")).toBe("/custom");
                expect(defaultInstallRoot({ HOME: "/home/u", XDG_DATA_HOME: "/data" }, "linux")).toBe("/data/unown");
                expect(defaultInstallRoot({ HOME: "/home/u" }, "linux")).toBe(posix.join("/home/u", ".local", "share", "unown"));
                expect(defaultInstallRoot({ USERPROFILE: "C:\\Users\\u", LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "win32")).toBe(
                        win32.join("C:\\Users\\u\\AppData\\Local", "unown"),
                );
        });

        test("versioned paths and platform binary names", () => {
                expect(versionDir("/root", "v0.0.2")).toBe(join("/root", "versions", "0.0.2"));
                expect(binaryPath("/root", "0.0.2", "linux-x64")).toBe(join("/root", "versions", "0.0.2", "unown"));
                expect(binaryPath("/root", "0.0.2", "windows-x64")).toBe(join("/root", "versions", "0.0.2", "unown.exe"));
        });

        test("inferBinaryLayout recognizes only <root>/versions/<semver>/unown[.exe]", () => {
                const p = join("C:\\tools", "unown", "versions", "1.2.3", "unown.exe");
                expect(inferBinaryLayout(p)).toEqual({ root: join("C:\\tools", "unown"), version: "1.2.3" });
                expect(inferBinaryLayout(join("/r", "versions", "1.2.3", "other"))).toBeNull();
                expect(inferBinaryLayout(join("/r", "versions", "not-a-version", "unown"))).toBeNull();
                expect(inferBinaryLayout(join("/r", "bin", "unown"))).toBeNull();
        });

        test("shim paths follow UNOWN_BIN_DIR then the OS defaults", () => {
                const posix = shimPaths({ UNOWN_BIN_DIR: "/x/bin", HOME: "/home/u" }, "linux");
                expect(posix.primary).toBe("/x/bin/unown");
                const win = shimPaths({ UNOWN_BIN_DIR: "C:\\x\\bin", USERPROFILE: "C:\\u" }, "win32");
                expect(win.all).toEqual([win32.join("C:\\x\\bin", "unown.cmd"), win32.join("C:\\x\\bin", "unown.ps1")]);
        });
});

describe("platform", () => {
        test("maps os/arch and prefers arm64 under Rosetta", () => {
                expect(detectPlatform({ platform: "win32", arch: "x64" })).toBe("windows-x64");
                expect(detectPlatform({ platform: "win32", arch: "arm64" })).toBe("windows-arm64");
                expect(detectPlatform({ platform: "linux", arch: "arm64" })).toBe("linux-arm64");
                expect(detectPlatform({ platform: "darwin", arch: "x64", procTranslated: false })).toBe("darwin-x64");
                expect(detectPlatform({ platform: "darwin", arch: "x64", procTranslated: true })).toBe("darwin-arm64");
                expect(detectPlatform({ platform: "linux", arch: "ia32" })).toBeNull();
        });

        test("musl and platform gates", () => {
                expect(detectMusl({ platform: "win32", fileExists: () => true })).toBe(false);
                expect(detectMusl({ platform: "linux", arch: "x64", fileExists: (p) => p.includes("ld-musl-x86_64") })).toBe(true);
                expect(detectMusl({ platform: "linux", arch: "x64", fileExists: (p) => p === "/etc/alpine-release" })).toBe(true);
                expect(detectMusl({ platform: "linux", arch: "x64", fileExists: () => false })).toBe(false);

                expect(platformGate({ platform: "linux-x64", musl: true })).toContain("glibc");
                expect(platformGate({ platform: "linux-x64", musl: false })).toBeNull();
                expect(platformGate({ platform: "windows-arm64", env: {} })).toContain("experimental");
                expect(platformGate({ platform: "windows-arm64", env: { UNOWN_ALLOW_EXPERIMENTAL: "1" } })).toBeNull();
                expect(platformGate({ platform: "windows-arm64", env: {}, metadataPlatform: "windows-arm64" })).toBeNull();
        });

        test("cheapInstallMode does not need git", () => {
                expect(cheapInstallMode({ env: {}, execPath: join("/r", "versions", "1.0.0", "unown") })).toBe("binary");
                expect(cheapInstallMode({ env: { UNOWN_INSTALL_ROOT: "/r" }, execPath: "/usr/bin/bun" })).toBe("binary");
                expect(cheapInstallMode({ env: {}, execPath: "/usr/bin/bun", metadata: sample() })).toBe("binary");
                expect(cheapInstallMode({ env: {}, execPath: "/usr/bin/bun" })).toBeNull();
        });
});

describe("release feed", () => {
        test("archive names, latest and pinned URLs", () => {
                const base = "https://example.test/releases";
                expect(archiveName("linux-x64")).toBe("unown-linux-x64.tar.gz");
                expect(archiveName("windows-x64")).toBe("unown-windows-x64.zip");
                expect(versionTxtUrl(base)).toBe(`${base}/latest/download/version.txt`);
                expect(assetUrl(base, "linux-x64")).toBe(`${base}/latest/download/unown-linux-x64.tar.gz`);
                expect(assetUrl(base, "linux-x64", "v0.0.2")).toBe(`${base}/download/v0.0.2/unown-linux-x64.tar.gz`);
                expect(checksumsUrl(base, "0.0.2")).toBe(`${base}/download/v0.0.2/sha256sums.txt`);
        });

        test("sha256 + checksum line parsing", () => {
                const dir = fresh();
                const p = join(dir, "a.bin");
                writeFileSync(p, "abc");
                expect(sha256File(p)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
                const sums = "0000000000000000000000000000000000000000000000000000000000000000  other.bin\n" + `${sha256File(p)}  a.bin\n`;
                expect(parseChecksumFor(sums, "a.bin")).toBe(sha256File(p));
                expect(parseChecksumFor(sums, "missing.bin")).toBeNull();
        });
});

describe("shims", () => {
        test("binary shims carry UNOWN_INSTALL_ROOT and the versioned binary path", () => {
                const dir = fresh();
                const root = join(dir, "data", "unown");
                const bin = join(dir, "bins");
                const written = writeBinaryShims({ root, version: "1.2.3", env: { UNOWN_BIN_DIR: bin } });
                const content = readFileSync(written.primary, "utf8");
                expect(content).toContain(root);
                expect(content).toContain(binaryPath(root, "1.2.3", process.platform === "win32" ? "windows-x64" : "linux-x64"));
                expect(shimTargetsRoot(content, root)).toBe(true);
                expect(shimTargetsRoot(content, join(dir, "other-root"))).toBe(false);
                expect(written.binary).toBe(binaryPath(root, "1.2.3", process.platform === "win32" ? "windows-x64" : "linux-x64"));
        });

        test("POSIX renderer quotes and exports", () => {
                const text = renderPosixShim({
                        command: "/opt/u nown/versions/1.0.0/unown",
                        env: { UNOWN_INSTALL_ROOT: "/opt/u nown" },
                        header: ["test shim"],
                });
                expect(text.split("\n")[0]).toBe("#!/bin/sh");
                expect(text).toContain('export UNOWN_INSTALL_ROOT="/opt/u nown"');
                expect(text).toContain('exec "/opt/u nown/versions/1.0.0/unown" "$@"');
        });
});

test("writeInstallMetadata does not leave a temp file after a failed rename target", () => {
        const home = fresh();
        // A directory at install.json is the pathological case: the write must
        // fail loudly (not silently half-write) and clean its temp file.
        mkdirSync(installMetadataPath(home));
        expect(() => writeInstallMetadata(home, sample())).toThrow();
        expect(readdirSync(home).filter((f) => f.endsWith(".tmp"))).toEqual([]);
        expect(existsSync(installMetadataPath(home))).toBe(true);
});
