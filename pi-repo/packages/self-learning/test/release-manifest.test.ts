// release-manifest.test.ts — the unsigned feed contract: strict manifest
// validation, platform/asset selection and the latest/pinned URL shapes.
import "./_env.ts";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
        parseReleaseManifest,
        selectReleaseAsset,
        type ReleaseAsset,
        type ReleaseManifest,
} from "../src/release-manifest.ts";
import { releaseManifestUrl } from "../src/install-layout.ts";

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
                ];
                for (const [label, override] of cases) {
                        const res = parseReleaseManifest(JSON.stringify({ ...manifest(), ...override }));
                        expect(res.ok).toBe(false);
                        if (res.ok) throw new Error(`expected ${label} to fail`);
                }
        });

        test("rejects asset name, hash, size and duplicate entries", () => {
                expect(parseReleaseManifest(JSON.stringify(manifest({ assets: [asset({ name: "unown.exe" })] }))).ok).toBe(false);
                expect(parseReleaseManifest(JSON.stringify(manifest({ assets: [asset({ sha256: "xyz" })] }))).ok).toBe(false);
                expect(parseReleaseManifest(JSON.stringify(manifest({ assets: [asset({ size: 0 })] }))).ok).toBe(false);
                expect(parseReleaseManifest(JSON.stringify(manifest({ assets: [asset(), asset()] }))).ok).toBe(false);
        });

        test("rejects an unknown platform and a non-https notes URL", () => {
                const unknown = manifest({ assets: [asset({ platform: "plan9-x64" as never })] });
                expect(parseReleaseManifest(JSON.stringify(unknown)).ok).toBe(false);
                expect(parseReleaseManifest(JSON.stringify(manifest({ notesUrl: "http://example.test/notes" }))).ok).toBe(false);
        });

        test("rejects malformed optional versions", () => {
                expect(parseReleaseManifest(JSON.stringify(manifest({ minimumVersion: "one" }))).ok).toBe(false);
                expect(parseReleaseManifest(JSON.stringify(manifest({ requiredMinimumVersion: "v1.2.3" }))).ok).toBe(false);
                expect(
                        parseReleaseManifest(JSON.stringify(manifest({ minimumVersion: "0.0.1", requiredMinimumVersion: "0.0.2" }))).ok,
                ).toBe(true);
        });

        test("ignores unknown top-level fields, including a legacy keyId", () => {
                const raw = JSON.stringify({ ...manifest(), keyId: "legacy-key" });
                const res = parseReleaseManifest(raw);
                expect(res.ok).toBe(true);
                if (!res.ok) throw new Error(res.error);
                expect("keyId" in res.manifest).toBe(false);
        });
});

describe("release manifest URLs", () => {
        test("the manifest URL sits beside the checksum/version URLs", () => {
                const base = "https://example.test/releases";
                expect(releaseManifestUrl(base)).toBe(`${base}/latest/download/release.json`);
                expect(releaseManifestUrl(base, "0.0.2")).toBe(`${base}/download/v0.0.2/release.json`);
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
