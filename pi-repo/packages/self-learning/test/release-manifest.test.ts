// release-manifest.test.ts — the signed feed contract: key parity with the
// tracked public key, verify-before-parse, fail-closed signature handling and
// strict manifest validation.
import "./_env.ts";
import { describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { releaseManifestUrl, releaseSignatureUrl } from "../src/install-layout.ts";
import {
	decodeEd25519PublicKey,
	parseReleaseManifest,
	RELEASE_SIGNING_KEYS,
	type ReleaseAsset,
	type ReleaseManifest,
	releaseManifestKeyId,
	selectReleaseAsset,
	verifyReleaseManifest,
	verifyReleaseSignature,
} from "../src/release-manifest.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const KEY_FILE = join(REPO_ROOT, "scripts", "release-keys", "release-key.json");

function rawPublic(publicKey: KeyObject): string {
	const der = publicKey.export({ format: "der", type: "spki" });
	return der.subarray(der.length - 32).toString("base64");
}

function testKeyPair() {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	return { privateKey, publicKeyBase64: rawPublic(publicKey) };
}

function asset(overrides: Partial<ReleaseAsset> = {}): ReleaseAsset {
	return {
		platform: "linux-x64",
		name: "unown-linux-x64.tar.gz",
		sha256: "a".repeat(64),
		size: 1024,
		...overrides,
	};
}

function manifest(overrides: Partial<ReleaseManifest> = {}): ReleaseManifest {
	return {
		schema: 1,
		keyId: "test-key",
		version: "0.0.2",
		releasedAt: "2026-10-21T14:41:06.000Z",
		channel: "stable",
		severity: "normal",
		minimumVersion: null,
		requiredMinimumVersion: null,
		notesUrl: "https://github.com/kanishka-namdeo/Unown/releases/tag/v0.0.2",
		assets: [asset()],
		...overrides,
	};
}

function signRaw(raw: string, privateKey: KeyObject): string {
	return sign(null, Buffer.from(raw, "utf8"), privateKey).toString("base64");
}

describe("pinned release keys", () => {
	test("the client map and scripts/release-keys/release-key.json agree", () => {
		const file = JSON.parse(readFileSync(KEY_FILE, "utf8")) as {
			current: { keyId: string; publicKeyBase64: string };
		};
		expect(RELEASE_SIGNING_KEYS[file.current.keyId]).toBe(file.current.publicKeyBase64);
		expect(decodeEd25519PublicKey(file.current.publicKeyBase64)?.length).toBe(32);
	});

	test("decodeEd25519PublicKey rejects junk and the wrong length", () => {
		expect(decodeEd25519PublicKey("not base64!!")).toBeNull();
		expect(decodeEd25519PublicKey(Buffer.alloc(31).toString("base64"))).toBeNull();
		expect(decodeEd25519PublicKey(Buffer.alloc(32).toString("base64"))?.length).toBe(32);
	});
});

describe("verifyReleaseManifest", () => {
	test("accepts a valid signature and returns the parsed manifest", () => {
		const key = testKeyPair();
		const raw = `${JSON.stringify(manifest(), null, 2)}\n`;
		const sig = signRaw(raw, key.privateKey);
		const res = verifyReleaseManifest(raw, sig, { "test-key": key.publicKeyBase64 });
		expect(res.ok).toBe(true);
		if (!res.ok) throw new Error(res.error);
		expect(res.manifest.version).toBe("0.0.2");
		expect(res.manifest.assets[0].platform).toBe("linux-x64");
	});

	test("rejects a tampered manifest before parsing any field", () => {
		const key = testKeyPair();
		const raw = `${JSON.stringify(manifest(), null, 2)}\n`;
		const sig = signRaw(raw, key.privateKey);
		const tampered = raw.replace("0.0.2", "0.0.3");
		expect(verifyReleaseManifest(tampered, sig, { "test-key": key.publicKeyBase64 })).toMatchObject({
			ok: false,
			error: expect.stringContaining("signature verification failed"),
		});
	});

	test("rejects a missing, malformed, or wrong-length signature", () => {
		const key = testKeyPair();
		const raw = `${JSON.stringify(manifest(), null, 2)}\n`;
		for (const sig of ["", "not-base64", Buffer.alloc(63).toString("base64")]) {
			expect(verifyReleaseManifest(raw, sig, { "test-key": key.publicKeyBase64 }).ok).toBe(false);
		}
	});

	test("an unknown keyId fails closed and a rotation key can verify", () => {
		const first = testKeyPair();
		const second = testKeyPair();
		const unknownRaw = `${JSON.stringify(manifest({ keyId: "retired-key" }), null, 2)}\n`;
		const unknownSig = signRaw(unknownRaw, first.privateKey);
		expect(verifyReleaseManifest(unknownRaw, unknownSig, { "test-key": first.publicKeyBase64 })).toMatchObject({
			ok: false,
			error: expect.stringContaining("unknown release signing key"),
		});

		const rotatedRaw = `${JSON.stringify(manifest({ keyId: "next-key" }), null, 2)}\n`;
		const rotatedSig = signRaw(rotatedRaw, second.privateKey);
		const res = verifyReleaseManifest(rotatedRaw, rotatedSig, {
			"test-key": first.publicKeyBase64,
			"next-key": second.publicKeyBase64,
		});
		expect(res.ok).toBe(true);
	});

	test("releaseManifestKeyId reads only a bounded string keyId", () => {
		expect(releaseManifestKeyId('{"keyId":"k"}')).toBe("k");
		expect(releaseManifestKeyId('{"keyId":1}')).toBeNull();
		expect(releaseManifestKeyId("not json")).toBeNull();
		expect(releaseManifestKeyId(`{"keyId":"${"x".repeat(129)}"}`)).toBeNull();
	});

	test("verifyReleaseSignature reports a bad pinned key", () => {
		const raw = `${JSON.stringify(manifest(), null, 2)}\n`;
		expect(verifyReleaseSignature(raw, "A".repeat(88), "test-key", { "test-key": "bad" })).toMatchObject({
			ok: false,
			error: expect.stringContaining("not a valid Ed25519 public key"),
		});
	});
});

describe("parseReleaseManifest", () => {
	test("accepts a valid manifest and selects the platform asset", () => {
		const res = parseReleaseManifest(JSON.stringify(manifest()));
		expect(res.ok).toBe(true);
		if (!res.ok) throw new Error(res.error);
		expect(selectReleaseAsset(res.manifest, "linux-x64")?.name).toBe("unown-linux-x64.tar.gz");
		expect(selectReleaseAsset(res.manifest, "windows-x64")).toBeNull();
	});

	test("rejects unsupported schema, channel, severity, version and date", () => {
		const cases: Array<[string, Record<string, unknown>]> = [
			["schema", { schema: 2 }],
			["channel", { channel: "nightly" }],
			["severity", { severity: "urgent" }],
			["version", { version: "v0.0.2" }],
			["releasedAt", { releasedAt: "not-a-date" }],
			["keyId", { keyId: "" }],
		];
		for (const [label, override] of cases) {
			const raw = JSON.stringify({ ...manifest(), ...override });
			const res = parseReleaseManifest(raw);
			expect(res.ok).toBe(false);
			if (res.ok) throw new Error(`expected ${label} to fail`);
		}
	});

	test("rejects asset name, hash, size and duplicate entries", () => {
		const badName = manifest({ assets: [asset({ name: "unown.exe" })] });
		expect(parseReleaseManifest(JSON.stringify(badName)).ok).toBe(false);

		const badHash = manifest({ assets: [asset({ sha256: "xyz" })] });
		expect(parseReleaseManifest(JSON.stringify(badHash)).ok).toBe(false);

		const badSize = manifest({ assets: [asset({ size: 0 })] });
		expect(parseReleaseManifest(JSON.stringify(badSize)).ok).toBe(false);

		const duplicate = manifest({ assets: [asset(), asset()] });
		expect(parseReleaseManifest(JSON.stringify(duplicate)).ok).toBe(false);
	});

	test("rejects an unknown platform and a non-https notes URL", () => {
		const unknown = manifest({ assets: [asset({ platform: "plan9-x64" as never })] });
		expect(parseReleaseManifest(JSON.stringify(unknown)).ok).toBe(false);

		const notes = manifest({ notesUrl: "http://example.test/notes" });
		expect(parseReleaseManifest(JSON.stringify(notes)).ok).toBe(false);
	});

	test("rejects malformed optional versions", () => {
		expect(parseReleaseManifest(JSON.stringify(manifest({ minimumVersion: "one" }))).ok).toBe(false);
		expect(parseReleaseManifest(JSON.stringify(manifest({ requiredMinimumVersion: "v1.2.3" }))).ok).toBe(false);
		expect(
			parseReleaseManifest(JSON.stringify(manifest({ minimumVersion: "0.0.1", requiredMinimumVersion: "0.0.2" })))
				.ok,
		).toBe(true);
	});
});

describe("release manifest URLs", () => {
	test("latest and pinned URLs sit beside the checksum URLs", () => {
		const base = "https://example.test/releases";
		expect(releaseManifestUrl(base)).toBe(`${base}/latest/download/release.json`);
		expect(releaseSignatureUrl(base)).toBe(`${base}/latest/download/release.json.sig`);
		expect(releaseManifestUrl(base, "0.0.2")).toBe(`${base}/download/v0.0.2/release.json`);
		expect(releaseSignatureUrl(base, "v0.0.2")).toBe(`${base}/download/v0.0.2/release.json.sig`);
	});

	test("a manifest hash is lowercase-normalized", () => {
		const upper = manifest({
			assets: [asset({ sha256: createHash("sha256").update("x").digest("hex").toUpperCase() })],
		});
		const res = parseReleaseManifest(JSON.stringify(upper));
		expect(res.ok).toBe(true);
		if (!res.ok) throw new Error(res.error);
		expect(res.manifest.assets[0].sha256).toBe(res.manifest.assets[0].sha256.toLowerCase());
	});
});
