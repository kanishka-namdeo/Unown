#!/usr/bin/env node
/**
 * generate-release-key.mjs — one-time Ed25519 key for the signed release feed.
 *
 * The public half is committed (scripts/release-keys/release-key.json); the
 * private 32-byte seed is written OUTSIDE the repository and is never printed.
 * Set it once as the UNOWN_RELEASE_SIGNING_KEY GitHub Actions secret:
 *
 *   gh secret set UNOWN_RELEASE_SIGNING_KEY --repo <owner>/<repo> < <seed-path>
 *
 * This script refuses to overwrite an existing key file unless --force is
 * explicit, because rotating the key silently would strand every installed
 * client on a key the release no longer signs with. Rotation is a two-release
 * procedure: add the next public key to the client, ship it, then switch the
 * secret.
 *
 * Usage:
 *   node scripts/generate-release-key.mjs [--key-id <id>] [--out <seed>]
 *        [--public-key <json>] [--force]
 */
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_KEY_ID = "unown-release-2026";

function usage() {
    console.log(`Usage: node scripts/generate-release-key.mjs [options]

  --key-id <id>       key id written into the manifest (default ${DEFAULT_KEY_ID})
  --out <path>        private seed file, outside the repo
                      (default ~/.unown-release-keys/<key-id>.seed)
  --public-key <path> tracked public-key JSON
                      (default scripts/release-keys/release-key.json)
  --force             replace an existing key (only for a deliberate rotation)
  -h, --help          this help`);
}

function parseArgs(argv) {
    const opts = {
        keyId: DEFAULT_KEY_ID,
        out: "",
        publicKey: join(REPO_ROOT, "scripts", "release-keys", "release-key.json"),
        force: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--key-id") {
            opts.keyId = argv[++i] ?? "";
            if (!/^[A-Za-z0-9._-]{1,64}$/.test(opts.keyId)) throw new Error("--key-id must be 1-64 chars of [A-Za-z0-9._-]");
        } else if (a === "--out") {
            opts.out = argv[++i] ?? "";
            if (!opts.out) throw new Error("--out needs a path");
        } else if (a === "--public-key") {
            opts.publicKey = argv[++i] ?? "";
            if (!opts.publicKey) throw new Error("--public-key needs a path");
        } else if (a === "--force") {
            opts.force = true;
        } else if (a === "-h" || a === "--help") {
            usage();
            process.exit(0);
        } else {
            throw new Error(`unknown argument: ${a}`);
        }
    }
    opts.out ||= join(homedir(), ".unown-release-keys", `${opts.keyId}.seed`);
    return opts;
}

function main() {
    let opts;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
        usage();
        process.exit(1);
    }
    const seedPath = resolve(opts.out);
    const publicPath = resolve(opts.publicKey);
    if (existsSync(publicPath) && !opts.force) {
        console.error(`refusing to overwrite ${publicPath} (pass --force only for a deliberate rotation)`);
        process.exit(1);
    }
    if (existsSync(seedPath) && !opts.force) {
        console.error(`refusing to overwrite ${seedPath} (pass --force only for a deliberate rotation)`);
        process.exit(1);
    }

    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const seedDer = privateKey.export({ format: "der", type: "pkcs8" });
    const publicDer = publicKey.export({ format: "der", type: "spki" });
    // Ed25519 PKCS8 = 16-byte prefix + 32-byte seed; SPKI = 12-byte prefix + 32-byte key.
    const seed = seedDer.subarray(seedDer.length - 32);
    const rawPublic = publicDer.subarray(publicDer.length - 32);
    if (seed.length !== 32 || rawPublic.length !== 32) {
        console.error("generated key did not have the expected Ed25519 DER shape");
        process.exit(1);
    }
    // Prove the pair before writing anything.
    const derived = createPublicKey(privateKey).export({ format: "der", type: "spki" });
    if (!derived.subarray(derived.length - 32).equals(rawPublic)) {
        console.error("generated public key does not match the private key");
        process.exit(1);
    }

    mkdirSync(dirname(seedPath), { recursive: true });
    writeFileSync(seedPath, `${seed.toString("base64")}\n`, { mode: 0o600 });
    mkdirSync(dirname(publicPath), { recursive: true });
    let previousNext;
    if (existsSync(publicPath)) {
        try {
            previousNext = JSON.parse(readFileSync(publicPath, "utf8")).next;
        } catch {
            previousNext = undefined;
        }
    }
    const keyFile = {
        current: { keyId: opts.keyId, publicKeyBase64: rawPublic.toString("base64") },
        ...(previousNext ? { next: previousNext } : {}),
    };
    writeFileSync(publicPath, `${JSON.stringify(keyFile, null, 2)}\n`);

    console.log(`key id:      ${opts.keyId}`);
    console.log(`public key:  ${rawPublic.toString("base64")}`);
    console.log(`public file: ${publicPath}`);
    console.log(`private seed: ${seedPath} (NOT printed; set it as a GitHub secret)`);
    console.log("");
    console.log("Set the signing secret from that file without printing it:");
    console.log(`  gh secret set UNOWN_RELEASE_SIGNING_KEY --repo <owner>/<repo> < "${seedPath}"`);
}

main();
