// Unit tests for scripts/release-manifest.ts — the release-stage signer and
// the two gates (local payload, live feed).
//
// Hermetic: generated Ed25519 test keypair, temp payloads, a local HTTP server.
// No production key, no network. Run: node --test scripts/release-manifest.test.mjs
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
    if (!("UNOWN_RELEASE_SIGNING_KEY" in env)) delete childEnv.UNOWN_RELEASE_SIGNING_KEY;
    const r = spawnSync(bunBin(), [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: "utf8", shell: false, env: childEnv });
    return { code: r.status, out: (r.stdout || "").replace(/\r/g, ""), err: (r.stderr || "").replace(/\r/g, "") };
}

/** Async variant: a local HTTP server lives in this process, so a spawnSync
 *  would block the server's event loop and make the child time out. */
function buildCliAsync(args, env = {}) {
    const childEnv = { ...process.env, ...env };
    if (!("UNOWN_RELEASE_SIGNING_KEY" in env)) delete childEnv.UNOWN_RELEASE_SIGNING_KEY;
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

function makeKeyPair(keyId = "test-key") {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicDer = publicKey.export({ format: "der", type: "spki" });
    const seedDer = privateKey.export({ format: "der", type: "pkcs8" });
    return {
        keyId,
        publicKeyBase64: publicDer.subarray(-32).toString("base64"),
        seedBase64: seedDer.subarray(-32).toString("base64"),
    };
}

function writeKeyFile(path, key) {
    writeFileSync(path, `${JSON.stringify({ current: { keyId: key.keyId, publicKeyBase64: key.publicKeyBase64 } }, null, 2)}\n`);
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

function generate(dir, keyFile, key, extra = []) {
    return buildCli(
        ["--out", dir, "--key-file", keyFile, "--released-at", "2026-10-21T14:41:06.000Z", "--severity", "normal", ...extra],
        { UNOWN_RELEASE_SIGNING_KEY: key.seedBase64 },
    );
}

function manifestOf(dir) {
    return JSON.parse(readFileSync(join(dir, "release.json"), "utf8"));
}

describe("release manifest generation", () => {
    test("signs a six-asset payload and the local check verifies it", () => {
        const key = makeKeyPair();
        const keyFile = join(TMP_ROOT, "key.json");
        writeKeyFile(keyFile, key);
        const dir = makePayload();
        const r = generate(dir, keyFile, key);
        assert.equal(r.code, 0, r.err);
        assert.ok(r.out.includes("6 platform assets"), r.out);
        const manifest = manifestOf(dir);
        assert.equal(manifest.version, "0.0.2");
        assert.equal(manifest.keyId, "test-key");
        assert.equal(manifest.assets.length, 6);
        assert.match(readFileSync(join(dir, "release.json.sig"), "utf8").trim(), /^[A-Za-z0-9+/]+=*$/);

        const check = buildCli(["--check", "--require-all", "--out", dir, "--key-file", keyFile]);
        assert.equal(check.code, 0, check.err);
        assert.match(check.out, /release payload verified/);
    });

    test("refuses to run without the signing secret", () => {
        const key = makeKeyPair();
        const keyFile = join(TMP_ROOT, "key-nosecret.json");
        writeKeyFile(keyFile, key);
        const dir = makePayload();
        const r = buildCli(["--out", dir, "--key-file", keyFile, "--severity", "normal"]);
        assert.notEqual(r.code, 0);
        assert.match(r.err, /UNOWN_RELEASE_SIGNING_KEY is not set/);
    });

    test("refuses a secret that does not match the tracked public key", () => {
        const key = makeKeyPair();
        const other = makeKeyPair();
        const keyFile = join(TMP_ROOT, "key-mismatch.json");
        writeKeyFile(keyFile, key);
        const dir = makePayload();
        const r = generate(dir, keyFile, other);
        assert.notEqual(r.code, 0);
        assert.match(r.err, /does not match the public key/);
    });

    test("--allow-partial signs only the archives present", () => {
        const key = makeKeyPair();
        const keyFile = join(TMP_ROOT, "key-partial.json");
        writeKeyFile(keyFile, key);
        const dir = makePayload(["linux-x64"]);
        const r = generate(dir, keyFile, key, ["--allow-partial"]);
        assert.equal(r.code, 0, r.err);
        assert.equal(manifestOf(dir).assets.length, 1);
    });
});

describe("release manifest --check", () => {
    test("rejects a tampered manifest", () => {
        const key = makeKeyPair();
        const keyFile = join(TMP_ROOT, "key-tamper.json");
        writeKeyFile(keyFile, key);
        const dir = makePayload();
        assert.equal(generate(dir, keyFile, key).code, 0);
        writeFileSync(join(dir, "release.json"), `${readFileSync(join(dir, "release.json"), "utf8")} `);
        const r = buildCli(["--check", "--require-all", "--out", dir, "--key-file", keyFile]);
        assert.notEqual(r.code, 0);
        assert.match(r.err, /signature verification failed/);
    });

    test("rejects a missing archive named by the manifest", () => {
        const key = makeKeyPair();
        const keyFile = join(TMP_ROOT, "key-missing.json");
        writeKeyFile(keyFile, key);
        const dir = makePayload();
        assert.equal(generate(dir, keyFile, key).code, 0);
        rmSync(join(dir, archiveName("linux-x64")));
        const r = buildCli(["--check", "--require-all", "--out", dir, "--key-file", keyFile]);
        assert.notEqual(r.code, 0);
        assert.match(r.err, /manifest names unown-linux-x64\.tar\.gz/);
    });

    test("rejects a version.txt that disagrees with the manifest", () => {
        const key = makeKeyPair();
        const keyFile = join(TMP_ROOT, "key-version.json");
        writeKeyFile(keyFile, key);
        const dir = makePayload();
        assert.equal(generate(dir, keyFile, key).code, 0);
        writeFileSync(join(dir, "version.txt"), "0.0.3\n");
        const r = buildCli(["--check", "--require-all", "--out", dir, "--key-file", keyFile]);
        assert.notEqual(r.code, 0);
        assert.match(r.err, /version\.txt says 0\.0\.3/);
    });

    test("rejects a manifest signed by a key the verifier does not know", () => {
        const key = makeKeyPair();
        const other = makeKeyPair("other-key");
        const keyFile = join(TMP_ROOT, "key-unknown.json");
        const otherFile = join(TMP_ROOT, "key-other.json");
        writeKeyFile(keyFile, key);
        writeKeyFile(otherFile, other);
        const dir = makePayload();
        assert.equal(generate(dir, keyFile, key).code, 0);
        const r = buildCli(["--check", "--require-all", "--out", dir, "--key-file", otherFile]);
        assert.notEqual(r.code, 0);
        assert.match(r.err, /unknown release signing key/);
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
    test("verifies a local live feed, then fails on tampering", async () => {
        const key = makeKeyPair();
        const keyFile = join(TMP_ROOT, "key-feed.json");
        writeKeyFile(keyFile, key);
        const dir = makePayload();
        assert.equal(generate(dir, keyFile, key).code, 0);

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
            if (req.method === "HEAD") res.end();
            else res.end(body);
        });
        await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
        const port = server.address().port;
        const base = `http://127.0.0.1:${port}`;
        try {
            const ok = await buildCliAsync(["--feed", base, "--key-file", keyFile, "--version", "0.0.2"]);
            assert.equal(ok.code, 0, ok.err);
            assert.match(ok.out, /live release feed verified/);

            writeFileSync(join(dir, "release.json"), `${readFileSync(join(dir, "release.json"), "utf8")} `);
            const bad = await buildCliAsync(["--feed", base, "--key-file", keyFile, "--version", "0.0.2"]);
            assert.notEqual(bad.code, 0);
            assert.match(bad.err, /signature verification failed/);
        } finally {
            await new Promise((resolvePromise) => server.close(resolvePromise));
        }
    });
});
