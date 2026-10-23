// uninstall-self-delete.test.ts — `unown uninstall` run FROM the installed
// binary must delete the install it is running out of, on every supported OS.
//
// A binary install's PATH shim execs `<root>/versions/<v>/unown[.exe]`, so the
// uninstall process is itself the install. The platforms differ:
//   - Windows refuses to delete a running image (EPERM, measured 2026-10-23 on
//     10.0.29683), and the shipped order deleted the shims first — leaving the
//     install half-removed, `install.json` claiming it, and no command to
//     re-run. The root is now scheduled to a detached helper instead.
//   - POSIX (macOS/Linux) unlinks a running image happily, so removal stays
//     synchronous and must be complete by the time the command returns.
//   - windows-arm64 shares the win32 code path; it has no GitHub arm64 Windows
//     runner, so that archive ships un-smoked (see the release AGENTS note).
// The injected `removeDir` seam in uninstall.test.ts cannot see any of this —
// it is the exact blind spot that shipped the bug. This test compiles a real
// standalone binary into a scratch root and runs `uninstall` from it.
import "./_env.ts";
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        binaryPath,
        installMetadataPath,
        readInstallMetadata,
        writeBinaryShims,
        writeInstallMetadata,
        type ReleasePlatform,
} from "../src/install-layout.ts";

/** The release id this host's own compile target maps to. */
function hostReleasePlatform(): ReleasePlatform {
        if (process.platform === "win32") return process.arch === "arm64" ? "windows-arm64" : "windows-x64";
        if (process.platform === "darwin") return process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
        return process.arch === "arm64" ? "linux-arm64" : "linux-x64";
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
                if (predicate()) return true;
                await Bun.sleep(100);
        }
        return predicate();
}

test(
        "uninstall deletes its own install root from the installed binary",
        async () => {
                const base = mkdtempSync(join(tmpdir(), "unown-uninstall-live-"));
                const root = join(base, "root");
                const home = join(base, "home");
                const bin = join(base, "bin");
                const version = "0.0.1";
                const platform = hostReleasePlatform();
                const exe = binaryPath(root, version, platform);
                try {
                        mkdirSync(join(root, "versions", version), { recursive: true });
                        // A previous version kept for `update --rollback` must go too.
                        mkdirSync(join(root, "versions", "0.0.0"), { recursive: true });
                        writeFileSync(join(root, "versions", "0.0.0", "unown.exe"), "rollback copy");
                        mkdirSync(join(home, "agent"), { recursive: true });
                        writeFileSync(join(home, "agent", "keep.txt"), "memories");

                        const entry = join(import.meta.dir, "fixtures", "uninstall-entry.ts");
                        const build = spawnSync(process.execPath, ["build", "--compile", entry, "--outfile", exe], {
                                encoding: "utf8",
                                timeout: 180_000,
                        });
                        if (build.status !== 0) throw new Error(`compile failed: ${build.stderr || build.stdout}`);
                        writeFileSync(join(root, "versions", version, "VERSION"), version);

                        const shims = writeBinaryShims({ root, version, platform: process.platform, env: { UNOWN_BIN_DIR: bin } });
                        writeInstallMetadata(home, {
                                schema: 1,
                                mode: "binary",
                                version,
                                platform,
                                root,
                                bin: exe,
                                shim: shims.primary,
                                installedAt: new Date().toISOString(),
                        });

                        const run = spawnSync(exe, ["uninstall"], {
                                encoding: "utf8",
                                timeout: 60_000,
                                env: { ...process.env, UNOWN_HOME: home, UNOWN_BIN_DIR: bin },
                        });
                        expect(run.stderr).not.toContain("EPERM");
                        expect(run.status).toBe(0);
                        expect(run.stdout).toContain("uninstalled");

                        if (process.platform === "win32") {
                                // The root is on a background clock: this process still holds its own .exe.
                                expect(run.stdout).toContain("scheduled");
                        } else {
                                // POSIX unlinks a running image — the contract is synchronous completeness.
                                // (Path spelling is not the contract: macOS resolves /var to /private/var.)
                                expect(run.stdout).toContain("removed  ");
                                expect(existsSync(root)).toBe(false);
                        }

                        // Shims and the install record leave immediately in both shapes.
                        expect(existsSync(shims.primary)).toBe(false);
                        expect(existsSync(installMetadataPath(home))).toBe(false);
                        expect(readInstallMetadata(home)).toBeNull();
                        // ~/.unown is kept by default.
                        expect(existsSync(join(home, "agent", "keep.txt"))).toBe(true);

                        expect(await waitFor(() => !existsSync(root), 20_000)).toBe(true);
                } finally {
                        rmSync(base, { recursive: true, force: true });
                }
        },
        240_000,
);
