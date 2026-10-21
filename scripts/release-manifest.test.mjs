// Unit tests for scripts/release-manifest.ts — the unsigned release manifest
// and the two gates (local payload, live feed).
//
// Hermetic: temp payloads, a local HTTP server, no network. Run:
//   node --test scripts/release-manifest.test.mjs
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join("scripts", "release-manifest.ts");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "windows-arm64", "windows-x64"];

const TMP_ROOT = mkdtempSync(join(tmpdir(), "unown-release-manifest-"));
after(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

function bunBin() {
    const found = process.env.BUN ?? process.env.BUN_PATH;
    if (found) return found;
    const which = spawnSync(process.platform === "win32" ? "where" : "which", ["bun"], { encoding: "utf8" });
    const first = (which.stdout || "").split(/\r?\n/)[0];
    assert.ok(first, "bun not found on PATH — cannot run the release manifest tool");
    return first.trim();
}

function buildCli(args, env = {}) {
    const childEnv = { ...process.env, ...env };
    const r = spawnSync(bunBin(), [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: "utf8", shell: false, env: childEnv });
    return { code: r.status, out: (r.stdout || "").replace(/\r/g, ""), err: (r.stderr || "").replace(/\r/g, "") };
}

/** Async variant: a local HTTP server lives in this process, so a spawnSync
 *  would block the server's event loop and make the child time out. */
function buildCliAsync(args, env = {}) {
    const childEnv = { ...process.env, ...env };
    return new Promise((resolvePromise) => {
        const child = spawn(bunBin(), [SCRIPT, ...args], { cwd: REPO_ROOT, shell: false, env: childEnv });
        let out = "";
        let err = "";
        child.stdout.on("data", (chunk) => {
            out += chunk;
        });
        child.stderr.on("data", (chunk) => {
            err += chunk;
        });
        child.on("close", (code) => resolvePromise({ code, out: out.replace(/\r/g, ""), err: err.replace(/\r/g, "") }));
    });
}

function runBunModule(body) {
    const r = spawnSync(bunBin(), ["-e", body], { cwd: REPO_ROOT, encoding: "utf8", shell: false });
    assert.equal(r.status, 0, r.stderr);
    return (r.stdout || "").replace(/\r/g, "");
}

function archiveName(platform) {
    return `unown-${platform}${platform.startsWith("windows") ? ".zip" : ".tar.gz"}`;
}

function makePayload(platforms = PLATFORMS, version = "0.0.2") {
    const dir = mkdtempSync(join(TMP_ROOT, "payload-"));
    for (const platform of platforms) {
        writeFileSync(join(dir, archiveName(platform)), `fake archive ${platform}\n`);
    }
    writeFileSync(join(dir, "version.txt"), `${version}\n`);
    writeFileSync(join(dir, "install.sh"), "#!/bin/sh\n");
    writeFileSync(join(dir, "install.ps1"), "# installer\n");
    return dir;
}

function generate(dir, extra = []) {
    return buildCli([
        "--out",
        dir,
        "--released-at",
        "2026-10-21T14:41:06.000Z",
        "--severity",
        "normal",
        ...extra,
    ]);
}

describe("release manifest generation", () => {
    test("writes an unsigned six-asset manifest and the local check verifies it", () => {
        const dir = makePayload();
        const r = generate(dir);
        assert.equal(r.code, 0, r.err);
        assert.ok(r.out.includes("unsigned release.json"), r.out);
        const manifest = JSON.parse(readFileSync(join(dir, "release.json"), "utf8"));
        assert.equal(manifest.version, "0.0.2");
        assert.equal(manifest.assets.length, 6);
        assert.equal(manifest.keyId, undefined);
        assert.equal(existsSync(join(dir, "release.json.sig")), false);

        const check = buildCli(["--check", "--require-all", "--out", dir]);
        assert.equal(check.code, 0, check.err);
        assert.match(check.out, /release payload verified/);
    });

    test("refuses a missing archive unless --allow-partial is explicit", () => {
        const dir = makePayload(PLATFORMS.slice(0, 5));
        const r = generate(dir);
        assert.notEqual(r.code, 0);
        assert.match(r.err, /missing release archive/);
    });

    test("--allow-partial writes only the archives present", () => {
        const dir = makePayload(["linux-x64"]);
        const r = generate(dir, ["--allow-partial"]);
        assert.equal(r.code, 0, r.err);
        assert.equal(JSON.parse(readFileSync(join(dir, "release.json"), "utf8")).assets.length, 1);
    });
});

describe("release manifest --check", () => {
    test("rejects an asset hash that disagrees with the file", () => {
        const dir = makePayload();
        assert.equal(generate(dir).code, 0);
        const manifest = JSON.parse(readFileSync(join(dir, "release.json"), "utf8"));
        manifest.assets[0].sha256 = "0".repeat(64);
        writeFileSync(join(dir, "release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
        const r = buildCli(["--check", "--require-all", "--out", dir]);
        assert.notEqual(r.code, 0);
        assert.match(r.err, /sha256 is/);
    });

    test("rejects a missing archive named by the manifest", () => {
        const dir = makePayload();
        assert.equal(generate(dir).code, 0);
        rmSync(join(dir, archiveName("linux-x64")));
        const r = buildCli(["--check", "--require-all", "--out", dir]);
        assert.notEqual(r.code, 0);
        assert.match(r.err, /manifest names unown-linux-x64\.tar\.gz/);
    });

    test("rejects a version.txt that disagrees with the manifest", () => {
        const dir = makePayload();
        assert.equal(generate(dir).code, 0);
        writeFileSync(join(dir, "version.txt"), "0.0.3\n");
        const r = buildCli(["--check", "--require-all", "--out", dir]);
        assert.notEqual(r.code, 0);
        assert.match(r.err, /version\.txt says 0\.0\.3/);
    });

    test("rejects a malformed manifest", () => {
        const dir = makePayload();
        assert.equal(generate(dir).code, 0);
        writeFileSync(join(dir, "release.json"), "{not json");
        const r = buildCli(["--check", "--require-all", "--out", dir]);
        assert.notEqual(r.code, 0);
        assert.match(r.err, /not valid JSON/);
    });
});

describe("releaseSeverity", () => {
    test("reads the versioned section and falls back to Unreleased", () => {
        const changelog = [
            "# Changelog",
            "## [Unreleased]",
            "### Added",
            "- item",
            "## [0.0.2] - 2026-10-21",
            "### Security",
            "- fix",
            "## [0.0.1] - 2026-10-20",
            "### Added",
            "- old",
        ].join("\n");
        const result = runBunModule(
            `import { releaseSeverity } from "./scripts/release-manifest.ts";` +
                `process.stdout.write(JSON.stringify([` +
                `releaseSeverity("0.0.2", ${JSON.stringify(changelog)}),` +
                `releaseSeverity("0.0.3", ${JSON.stringify(changelog)})]));`,
        );
        assert.deepEqual(JSON.parse(result), ["security", "normal"]);
    });
});

describe("release manifest --feed", () => {
    test("downloads and verifies every archive, then fails on tampered bytes", async () => {
        const dir = makePayload();
        assert.equal(generate(dir).code, 0);

        const server = createServer((req, res) => {
            const url = new URL(req.url ?? "/", "http://127.0.0.1");
            const name = url.pathname.split("/").pop() ?? "";
            const candidates = [join(dir, name), join(dir, "latest", "download", name)];
            const file = candidates.find((p) => {
                try {
                    return statSync(p).isFile();
                } catch {
                    return false;
                }
            });
            if (!file) {
                res.writeHead(404);
                res.end("not found");
                return;
            }
            const body = readFileSync(file);
            res.writeHead(200, { "content-length": String(body.length), "content-type": "application/octet-stream" });
            res.end(body);
        });
        await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
        const port = server.address().port;
        const base = `http://127.0.0.1:${port}`;
        try {
            const ok = await buildCliAsync(["--feed", base, "--version", "0.0.2"]);
            assert.equal(ok.code, 0, ok.err);
            assert.match(ok.out, /live release feed verified/);

            const archive = join(dir, archiveName("linux-x64"));
            const bytes = readFileSync(archive);
            bytes[0] = bytes[0] === 0x66 ? 0x67 : 0x66;
            writeFileSync(archive, bytes);
            const bad = await buildCliAsync(["--feed", base, "--version", "0.0.2"]);
            assert.notEqual(bad.code, 0);
            assert.match(bad.err, /sha256 is/);
        } finally {
            await new Promise((resolvePromise) => server.close(resolvePromise));
        }
    });
});
