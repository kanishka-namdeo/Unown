// Unit tests for scripts/build-artifacts.ts — the per-OS release artifact
// builder. Run with: node --test scripts/build-artifacts.test.mjs
//
// These pin the PLAN the builder publishes, because that plan is what the
// release workflow asserts its asset names against, and what makes a release
// honest to a reader:
//
//   - the six platform ids, in order — a seventh target without a CI smoke leg
//     would be a shipped-but-never-run artifact;
//   - the x64-only `-baseline` rule (arm64 must NOT get it; that target does not
//     exist in bun's runtime set, so a wrong mapping fails the compile);
//   - archive naming: windows ships .zip, everything else .tar.gz;
//   - the version the binary will be stamped with equals package.json's — the
//     release's version-consistency assertion depends on that identity;
//   - the rejection paths exit NON-ZERO. A builder that shrugs at a bad
//     --platform and exits 0 is how a release silently loses three targets.
//
// What these tests deliberately do NOT cover: the built archives themselves.
// Compiling six runtimes is minutes and needs network; the proof that an
// artifact runs is `smoke-artifacts` in .github/workflows/release.yml, which
// extracts each platform's archive ON ITS OWN OS and executes it. A plan test
// cannot tell a working binary from a 1 MiB no-op stub.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join("scripts", "build-artifacts.ts");

/** bun's own path, so the test does not depend on `bun` being on PATH. */
function bunBin() {
    const found = process.env.BUN ?? process.env.BUN_PATH;
    if (found) return found;
    const which = spawnSync(process.platform === "win32" ? "where" : "which", ["bun"], { encoding: "utf8" });
    const first = (which.stdout || "").split(/\r?\n/)[0];
    assert.ok(first, "bun not found on PATH — cannot run the artifact builder");
    return first.trim();
}

function buildCli(args) {
    const r = spawnSync(bunBin(), [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: "utf8", shell: false });
    return { code: r.status, out: (r.stdout || "").replace(/\r/g, ""), err: (r.stderr || "").replace(/\r/g, "") };
}

/** Run a tiny module body under bun (the builder is TypeScript; node cannot
 *  import it). Used for the pure metadata functions, never for a build. */
function runBunModule(body) {
    const r = spawnSync(bunBin(), ["-e", body], { cwd: REPO_ROOT, encoding: "utf8", shell: false });
    assert.equal(r.status, 0, r.stderr);
    return (r.stdout || "").replace(/\r/g, "");
}

function installNotesFor(platform, version = "9.9.9") {
    return runBunModule(
        `import { installNotes } from "./scripts/build-artifacts.ts";` +
            `process.stdout.write(installNotes(${JSON.stringify(platform)}, ${JSON.stringify(version)}));`,
    );
}

function sha256(text) {
    return createHash("sha256").update(text).digest("hex");
}

const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "windows-arm64", "windows-x64"];

describe("build-artifacts --list-platforms", () => {
    test("publishes exactly the six supported targets, in order", () => {
        const r = buildCli(["--list-platforms"]);
        assert.equal(r.code, 0, r.err);
        assert.deepEqual(r.out.trim().split(/\r?\n/), PLATFORMS);
    });
});

describe("build-artifacts --dry-run plan", () => {
    const r = buildCli(["--dry-run"]);
    const rows = r.out
        .trim()
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.split("\t"));

    test("exits 0 and plans all six platforms without building", () => {
        assert.equal(r.code, 0, r.err);
        assert.equal(rows.length, 6);
        assert.match(r.out, /plan only, nothing built/);
    });

    test("every platform maps to a real bun compile target", () => {
        for (const [platform, target] of rows) {
            assert.ok(
                target === `bun-${platform}` || target === `bun-${platform}-baseline`,
                `${platform} mapped to ${target}, which is not a bun runtime name`,
            );
        }
    });

    test("x64 gets the baseline runtime and arm64 does not", () => {
        const byPlatform = Object.fromEntries(rows.map(([p, t]) => [p, t]));
        assert.equal(byPlatform["linux-x64"], "bun-linux-x64-baseline");
        assert.equal(byPlatform["windows-x64"], "bun-windows-x64-baseline");
        assert.equal(byPlatform["darwin-x64"], "bun-darwin-x64-baseline");
        // bun publishes no arm64 baseline runtime: asking for one fails the build.
        for (const p of ["darwin-arm64", "linux-arm64", "windows-arm64"]) {
            assert.ok(!byPlatform[p].endsWith("-baseline"), `${p} must not request a baseline runtime`);
        }
    });

    test("windows archives are .zip, everything else .tar.gz", () => {
        for (const [platform, , binary, archive] of rows) {
            const isWin = platform.startsWith("windows");
            assert.equal(binary, isWin ? "unown.exe" : "unown", `${platform} binary name`);
            assert.equal(archive, `unown-${platform}${isWin ? ".zip" : ".tar.gz"}`, `${platform} archive name`);
        }
    });

    test("the stamped version is package.json's version", () => {
        // This is the identity the release workflow asserts (tag === package.json
        // === `unown --version`). A binary stamped with anything else breaks it.
        const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
        assert.match(r.out, new RegExp(`version ${String(pkg.version).replace(/\./g, "\\.")} —`));
    });
});

describe("build-artifacts rejects a bad plan", () => {
    test("an unknown platform exits non-zero and names the valid set", () => {
        const r = buildCli(["--platform", "solaris-riscv", "--dry-run"]);
        assert.notEqual(r.code, 0);
        assert.match(r.err, /--platform needs one of/);
        assert.match(r.err, /windows-arm64/);
    });

    test("--platform with no value exits non-zero", () => {
        const r = buildCli(["--platform"]);
        assert.notEqual(r.code, 0);
        assert.match(r.err, /--platform needs one of/);
    });

    test("an unknown flag exits non-zero with the usage line", () => {
        const r = buildCli(["--ship-it"]);
        assert.notEqual(r.code, 0);
        assert.match(r.err, /unknown argument: --ship-it/);
    });

    test("a restricted --platform list plans only that platform", () => {
        const r = buildCli(["--platform", "linux-arm64", "--dry-run"]);
        assert.equal(r.code, 0, r.err);
        assert.equal(r.out.trim().split(/\r?\n/).length, 2);
        assert.match(r.out, /^linux-arm64\tbun-linux-arm64\tunown\tunown-linux-arm64\.tar\.gz$/m);
    });
});

describe("archive contents and versioned INSTALL.txt", () => {
    for (const platform of PLATFORMS) {
        test(`${platform}: notes carry the version, platform and self-describing contents`, () => {
            const text = installNotesFor(platform);
            assert.equal(text.split(/\r?\n/)[0], `unown 9.9.9 (${platform})`);
            assert.match(text, /Contents: unown(\.exe)?, VERSION \(9\.9\.9\), LICENSE, INSTALL\.txt\./);
            // Both install modes are named: update/uninstall work in each.
            assert.match(text, /Update and uninstall \(both install modes\)/);
            assert.match(text, /unown update\s+# checkout: git fast-forward; binary install: verified release download/);
            assert.match(text, /unown uninstall \[--dry-run\] \[--purge-data\]/);
        });
    }

    test("macOS verification uses shasum and the Gatekeeper unblock", () => {
        const text = installNotesFor("darwin-arm64");
        assert.match(text, /shasum -a 256 -c/);
        assert.match(text, /com\.apple\.quarantine/);
    });

    test("Linux verification uses sha256sum --ignore-missing", () => {
        const text = installNotesFor("linux-x64");
        assert.match(text, /sha256sum -c --ignore-missing sha256sums\.txt/);
        assert.match(text, /manifest also covers version\.txt/);
    });

    test("Windows verification uses Get-FileHash and the SmartScreen unblock", () => {
        const text = installNotesFor("windows-x64");
        assert.match(text, /Get-FileHash \.\\unown-windows-x64\.zip -Algorithm SHA256/);
        assert.match(text, /Unblock-File unown\.exe/);
    });
});

describe("version.txt is part of the payload", () => {
    test("the dry-run plan announces version.txt and still lists exactly six targets", () => {
        const r = buildCli(["--dry-run"]);
        assert.equal(r.code, 0, r.err);
        assert.match(r.out, /version\.txt/);
        assert.equal(r.out.trim().split(/\r?\n/).length, 7);
    });

    test("writePayloadManifest writes version.txt and checksums it with the archives", () => {
        const out = mkdtempSync(join(tmpdir(), "unown-artifacts-"));
        try {
            const archives = ["unown-linux-x64.tar.gz", "unown-windows-x64.zip"].map((name) => {
                const file = join(out, name);
                writeFileSync(file, `payload:${name}`);
                return file;
            });
            runBunModule(
                `import { writePayloadManifest } from "./scripts/build-artifacts.ts";` +
                    `writePayloadManifest(${JSON.stringify(out)}, "9.9.9", ${JSON.stringify(archives)});`,
            );
            assert.equal(readFileSync(join(out, "version.txt"), "utf8"), "9.9.9\n");
            const lines = readFileSync(join(out, "sha256sums.txt"), "utf8").trim().split(/\r?\n/);
            assert.equal(lines.length, 3);
            const names = lines.map((line) => line.split("  ")[1]);
            assert.deepEqual(names, ["unown-linux-x64.tar.gz", "unown-windows-x64.zip", "version.txt"]);
            assert.equal(lines[0], `${sha256("payload:unown-linux-x64.tar.gz")}  unown-linux-x64.tar.gz`);
            assert.equal(lines[2], `${sha256("9.9.9\n")}  version.txt`);
        } finally {
            rmSync(out, { recursive: true, force: true });
        }
    });
});
