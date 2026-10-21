/**
 * release-manifest.ts — the release feed manifest (`release.json`) that the
 * binary updater checks for per-OS availability, size and SHA-256.
 *
 * Trust model: the manifest is served over TLS from the release host (or a
 * configured mirror). It is NOT signed. The client validates its shape and
 * asset names, then verifies the downloaded archive against the manifest's
 * exact size and SHA-256 (and the same-release `sha256sums.txt`). A compromised
 * release host or mirror can serve a different manifest plus a matching
 * archive, so an update is only as trustworthy as that host. GitHub build
 * provenance attestations remain available for manual verification, but the
 * client does not check them.
 */
import { archiveName, RELEASE_PLATFORMS, type ReleasePlatform } from "./install-layout.ts";
import { parseSemver } from "./semver.ts";

export const RELEASE_MANIFEST_SCHEMA = 1;
export const RELEASE_MANIFEST_FILE = "release.json";

export type ReleaseSeverity = "normal" | "security";

export interface ReleaseAsset {
	platform: ReleasePlatform;
	name: string;
	sha256: string;
	size: number;
}

export interface ReleaseManifest {
	schema: typeof RELEASE_MANIFEST_SCHEMA;
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

/** Parse and validate a manifest. Unknown top-level fields are ignored, so a
 *  hand-written or future manifest remains readable; every field the updater
 *  uses is checked below. */
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

export function selectReleaseAsset(manifest: ReleaseManifest, platform: ReleasePlatform): ReleaseAsset | null {
	return manifest.assets.find((asset) => asset.platform === platform) ?? null;
}
