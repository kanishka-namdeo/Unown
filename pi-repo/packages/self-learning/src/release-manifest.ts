/**
 * release-manifest.ts — the signed release feed manifest (`release.json` +
 * `release.json.sig`) that the binary updater trusts.
 *
 * The signature covers the exact manifest bytes, so `verifyReleaseManifest`
 * checks the signature BEFORE any field is used. The only value read before
 * verification is `keyId`, which selects the pinned public key; an unknown
 * keyId is a hard failure, never an unsigned fallback.
 *
 * Trust model: the public keys are compiled into the client
 * (`RELEASE_SIGNING_KEYS`). The matching private seed lives only in the
 * `UNOWN_RELEASE_SIGNING_KEY` GitHub Actions secret. A mirror can replay an
 * older signed manifest (the signature is not a freshness proof), which is why
 * the updater also compares the manifest version against the running version
 * and the cached latest. A mirror cannot forge a new one.
 *
 * Source of truth for the keys: `scripts/release-keys/release-key.json`. The
 * package test asserts this map and that file agree, so rotation cannot drift.
 */
import { createPublicKey, verify as verifySignature } from "node:crypto";
import { archiveName, RELEASE_PLATFORMS, type ReleasePlatform } from "./install-layout.ts";
import { parseSemver } from "./semver.ts";

export const RELEASE_MANIFEST_SCHEMA = 1;
export const RELEASE_MANIFEST_FILE = "release.json";
export const RELEASE_SIGNATURE_FILE = "release.json.sig";

/** keyId -> base64 raw 32-byte Ed25519 public key. Holds the current key and
 *  the next one during a rotation (the manifest's keyId selects). */
export const RELEASE_SIGNING_KEYS: Readonly<Record<string, string>> = {
	"unown-release-2026": "DtqHKJ3/Fdb8eYqiYYhj9JshAi2d3sBVD5o3Jhf4bZE=",
};

export type ReleaseSeverity = "normal" | "security";

export interface ReleaseAsset {
	platform: ReleasePlatform;
	name: string;
	sha256: string;
	size: number;
}

export interface ReleaseManifest {
	schema: typeof RELEASE_MANIFEST_SCHEMA;
	keyId: string;
	version: string;
	releasedAt: string;
	channel: "stable";
	severity: ReleaseSeverity;
	minimumVersion: string | null;
	requiredMinimumVersion: string | null;
	notesUrl: string | null;
	assets: ReleaseAsset[];
}

export type ManifestResult = { ok: true; manifest: ReleaseManifest } | { ok: false; error: string };

const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStableVersion(value: unknown): value is string {
	return typeof value === "string" && STABLE_VERSION.test(value) && parseSemver(value) !== null;
}

type OptionalText = { ok: true; value: string | null } | { ok: false; error: string };

function optionalVersion(value: unknown, field: string): OptionalText {
	if (value === undefined || value === null) return { ok: true, value: null };
	if (!isStableVersion(value)) return { ok: false, error: `${field} must be a stable X.Y.Z version or null` };
	return { ok: true, value };
}

function optionalHttpsUrl(value: unknown): OptionalText {
	if (value === undefined || value === null) return { ok: true, value: null };
	if (typeof value !== "string" || !/^https:\/\//i.test(value))
		return { ok: false, error: "notesUrl must be an https:// URL or null" };
	if (value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) {
		return { ok: false, error: "notesUrl contains control characters or is too long" };
	}
	return { ok: true, value };
}

/** Read only the keyId needed to select a key. This parse is deliberately
 *  separate: the rest of the object is untrusted until the signature passes. */
export function releaseManifestKeyId(raw: string | Uint8Array): string | null {
	try {
		const value = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8")) as unknown;
		if (!isRecord(value) || typeof value.keyId !== "string" || value.keyId.length === 0 || value.keyId.length > 128) {
			return null;
		}
		return value.keyId;
	} catch {
		return null;
	}
}

/** Decode a raw 32-byte Ed25519 public key from base64. Strict: a lenient
 *  `Buffer.from` accepts junk, which would make a key silently wrong. */
export function decodeEd25519PublicKey(base64: string): Buffer | null {
	const compact = base64.trim().replace(/=+$/, "");
	if (!/^[A-Za-z0-9+/]+$/.test(compact)) return null;
	const bytes = Buffer.from(compact, "base64");
	if (bytes.length !== 32) return null;
	if (bytes.toString("base64").replace(/=+$/, "") !== compact) return null;
	return bytes;
}

function decodeEd25519Signature(base64: string): Buffer | null {
	const compact = base64.trim().replace(/=+$/, "");
	if (!/^[A-Za-z0-9+/]+$/.test(compact)) return null;
	const bytes = Buffer.from(compact, "base64");
	if (bytes.length !== 64) return null;
	if (bytes.toString("base64").replace(/=+$/, "") !== compact) return null;
	return bytes;
}

/** Ed25519 SPKI prefix for a raw 32-byte key (RFC 8410). */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyReleaseSignature(
	raw: string | Uint8Array,
	signatureBase64: string,
	keyId: string,
	keys: Readonly<Record<string, string>> = RELEASE_SIGNING_KEYS,
): { ok: true } | { ok: false; error: string } {
	const publicKeyBase64 = keys[keyId];
	if (!publicKeyBase64) return { ok: false, error: `unknown release signing key "${keyId}"` };
	const publicKey = decodeEd25519PublicKey(publicKeyBase64);
	if (!publicKey) return { ok: false, error: `release signing key "${keyId}" is not a valid Ed25519 public key` };
	const signature = decodeEd25519Signature(signatureBase64);
	if (!signature) return { ok: false, error: "release signature is not valid base64 for a 64-byte Ed25519 signature" };
	const data = typeof raw === "string" ? Buffer.from(raw, "utf8") : Buffer.from(raw);
	if (data.length === 0 || data.length > MAX_MANIFEST_BYTES) {
		return { ok: false, error: "release manifest is empty or too large" };
	}
	try {
		const key = createPublicKey({
			key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]),
			format: "der",
			type: "spki",
		});
		if (!verifySignature(null, data, key, signature)) {
			return { ok: false, error: "release manifest signature verification failed" };
		}
		return { ok: true };
	} catch (err) {
		return {
			ok: false,
			error: `release manifest signature could not be checked: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

/** Parse and validate a manifest. Call this after the signature check. */
export function parseReleaseManifest(raw: string | Uint8Array): ManifestResult {
	const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
	if (Buffer.byteLength(text, "utf8") > MAX_MANIFEST_BYTES)
		return { ok: false, error: "release manifest is too large" };
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (err) {
		return {
			ok: false,
			error: `release manifest is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
	if (!isRecord(value)) return { ok: false, error: "release manifest must be a JSON object" };
	if (value.schema !== RELEASE_MANIFEST_SCHEMA)
		return { ok: false, error: `unsupported release manifest schema "${String(value.schema)}"` };
	const keyId = value.keyId;
	if (typeof keyId !== "string" || keyId.length === 0 || keyId.length > 128) {
		return { ok: false, error: "release manifest keyId is missing or invalid" };
	}
	const version = value.version;
	if (!isStableVersion(version))
		return { ok: false, error: "release manifest version must be a stable X.Y.Z version" };
	const releasedAt = value.releasedAt;
	if (typeof releasedAt !== "string" || Number.isNaN(Date.parse(releasedAt))) {
		return { ok: false, error: "release manifest releasedAt is not an ISO date" };
	}
	if (value.channel !== "stable")
		return { ok: false, error: `release channel "${String(value.channel)}" is not stable` };
	if (value.severity !== "normal" && value.severity !== "security") {
		return { ok: false, error: "release manifest severity must be normal or security" };
	}
	const minimumVersion = optionalVersion(value.minimumVersion, "minimumVersion");
	if (!minimumVersion.ok) return { ok: false, error: minimumVersion.error };
	const requiredMinimumVersion = optionalVersion(value.requiredMinimumVersion, "requiredMinimumVersion");
	if (!requiredMinimumVersion.ok) return { ok: false, error: requiredMinimumVersion.error };
	const notesUrl = optionalHttpsUrl(value.notesUrl);
	if (!notesUrl.ok) return { ok: false, error: notesUrl.error };
	if (!Array.isArray(value.assets) || value.assets.length === 0) {
		return { ok: false, error: "release manifest assets must be a non-empty array" };
	}
	const platforms = new Set<string>();
	const names = new Set<string>();
	const assets: ReleaseAsset[] = [];
	for (const entry of value.assets) {
		if (!isRecord(entry)) return { ok: false, error: "release manifest asset entries must be objects" };
		const platform = entry.platform;
		if (typeof platform !== "string" || !(RELEASE_PLATFORMS as readonly string[]).includes(platform)) {
			return { ok: false, error: `release manifest has an unknown platform "${String(platform)}"` };
		}
		if (typeof entry.name !== "string" || entry.name !== archiveName(platform as ReleasePlatform)) {
			return {
				ok: false,
				error: `release asset for ${platform} must be named ${archiveName(platform as ReleasePlatform)}`,
			};
		}
		if (typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256.toLowerCase())) {
			return { ok: false, error: `release asset for ${platform} has an invalid sha256` };
		}
		if (
			typeof entry.size !== "number" ||
			!Number.isSafeInteger(entry.size) ||
			entry.size <= 0 ||
			entry.size > MAX_ASSET_BYTES
		) {
			return { ok: false, error: `release asset for ${platform} has an invalid size` };
		}
		if (platforms.has(platform)) return { ok: false, error: `release manifest repeats platform ${platform}` };
		if (names.has(entry.name)) return { ok: false, error: `release manifest repeats asset ${entry.name}` };
		platforms.add(platform);
		names.add(entry.name);
		assets.push({
			platform: platform as ReleasePlatform,
			name: entry.name,
			sha256: entry.sha256.toLowerCase(),
			size: entry.size,
		});
	}
	return {
		ok: true,
		manifest: {
			schema: RELEASE_MANIFEST_SCHEMA,
			keyId,
			version,
			releasedAt,
			channel: "stable",
			severity: value.severity === "security" ? "security" : "normal",
			minimumVersion: minimumVersion.value,
			requiredMinimumVersion: requiredMinimumVersion.value,
			notesUrl: notesUrl.value,
			assets,
		},
	};
}

/** Verify the detached signature, then parse. Fail closed: a manifest whose
 *  signature is missing or invalid never falls back to the legacy feed. */
export function verifyReleaseManifest(
	raw: string | Uint8Array,
	signatureBase64: string,
	keys: Readonly<Record<string, string>> = RELEASE_SIGNING_KEYS,
): ManifestResult {
	const keyId = releaseManifestKeyId(raw);
	if (!keyId) return { ok: false, error: "release manifest has no keyId" };
	const verified = verifyReleaseSignature(raw, signatureBase64, keyId, keys);
	if (!verified.ok) return verified;
	return parseReleaseManifest(raw);
}

export function selectReleaseAsset(manifest: ReleaseManifest, platform: ReleasePlatform): ReleaseAsset | null {
	return manifest.assets.find((asset) => asset.platform === platform) ?? null;
}
