#!/usr/bin/env bun
/**
 * scripts/release-manifest.ts — build and verify the release feed manifest
 * (`release.json`).
 *
 * The manifest is NOT signed. It gives the updater the version, per-platform
 * asset names, exact sizes and SHA-256 values, severity and minimum versions.
 * The release host is trusted over TLS; the feed gate verifies the published
 * assets by downloading them and recomputing their hashes, so a manifest that
 * disagrees with the bytes it names fails the release.
 *
 * This runs AFTER the six archives, version.txt, installers, SBOM and
 * checklist are staged, so the manifest describes the exact bytes that ship.
 *
 * Modes:
 *   (default)          generate + local-verify release-assets/
 *   --check            verify a local payload
 *   --feed <base>      download and verify the published feed
 *
 * Usage:
 *   bun scripts/release-manifest.ts [--out <dir>] [--version <v>]
 *       [--released-at <iso>] [--severity normal|security]
 *       [--minimum-version <v>] [--required-minimum-version <v>]
 *       [--notes-url <url>] [--allow-partial]
 *   bun scripts/release-manifest.ts --check [--out <dir>] [--require-all]
 *   bun scripts/release-manifest.ts --feed <base>
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, sym } from "./lib";
import { parseReleaseManifest, type ReleaseAsset, type ReleaseManifest } from "../pi-repo/packages/self-learning/src/release-manifest.ts";
import {
        archiveName,
        assetUrl,
        releaseManifestUrl,
        RELEASE_PLATFORMS,
        versionTxtUrl,
} from "../pi-repo/packages/self-learning/src/install-layout.ts";

export const MANIFEST_FILE = "release.json";
const DEFAULT_REPOSITORY = "kanishka-namdeo/Unown";
const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
const ARCHIVE_TIMEOUT_MS = 10 * 60_000;

export interface ManifestOptions {
        outDir?: string;
        version?: string;
        releasedAt?: string;
        severity?: "normal" | "security";
        minimumVersion?: string | null;
        requiredMinimumVersion?: string | null;
        notesUrl?: string;
        repository?: string;
        allowPartial?: boolean;
}

export interface GeneratedManifest {
        manifest: ReleaseManifest;
        raw: string;
}

function die(message: string, code = 1): never {
        console.error(`${sym.fail} ${message}`);
        process.exit(code);
}

function sha256File(path: string): string {
        return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function stable(value: string | undefined, field: string): string {
        if (!value || !STABLE_VERSION.test(value)) die(`${field} must be a stable X.Y.Z version (got "${value ?? ""}")`);
        return value;
}

export function releaseSeverity(version: string, changelog: string): "normal" | "security" {
        const lines = changelog.split(/\r?\n/);
        const headings: number[] = [];
        for (let i = 0; i < lines.length; i++) {
                if (/^##\s+\[/.test(lines[i])) headings.push(i);
        }
        const sectionFor = (predicate: (line: string) => boolean): string | null => {
                for (let i = 0; i < headings.length; i++) {
                        if (predicate(lines[headings[i]])) {
                                return lines.slice(headings[i], headings[i + 1] ?? lines.length).join("\n");
                        }
                }
                return null;
        };
        // A release built before the changelog was cut still gets a manifest;
        // the Unreleased section is the best available signal.
        const section =
                sectionFor((line) => line.includes(`[${version}]`)) ?? sectionFor((line) => /^##\s+\[Unreleased\]/.test(line));
        if (!section) return "normal";
        return /^###\s+Security\b/m.test(section) ? "security" : "normal";
}

function resolveReleasedAt(explicit?: string): string {
        if (explicit) {
                const date = new Date(explicit);
                if (Number.isNaN(date.getTime())) die(`--released-at is not a date: ${explicit}`);
                return date.toISOString();
        }
        const epoch = process.env.SOURCE_DATE_EPOCH;
        if (epoch !== undefined && epoch !== "") {
                const n = Number(epoch);
                if (!Number.isFinite(n)) die(`SOURCE_DATE_EPOCH is not a number: ${epoch}`);
                return new Date(n * 1000).toISOString();
        }
        const git = spawnSync("git", ["log", "-1", "--format=%ct"], { cwd: REPO_ROOT, encoding: "utf8" });
        const n = Number((git.stdout ?? "").trim());
        if (Number.isFinite(n) && n > 0) return new Date(n * 1000).toISOString();
        return new Date().toISOString();
}

export function buildManifest(opts: ManifestOptions = {}): GeneratedManifest {
        const outDir = resolve(opts.outDir ?? join(REPO_ROOT, "release-assets"));
        const versionFile = join(outDir, "version.txt");
        let version = opts.version;
        if (!version) {
                try {
                        version = readFileSync(versionFile, "utf8").trim();
                } catch {
                        die(`no --version and no ${versionFile}`);
                }
        }
        version = stable(version, "version");
        if (existsSync(versionFile) && readFileSync(versionFile, "utf8").trim() !== version) {
                die(`${versionFile} says ${readFileSync(versionFile, "utf8").trim()}, but the manifest version is ${version}`);
        }

        const assets: ReleaseAsset[] = [];
        for (const platform of RELEASE_PLATFORMS) {
                const name = archiveName(platform);
                const file = join(outDir, name);
                if (!existsSync(file)) {
                        if (opts.allowPartial) continue;
                        die(`missing release archive ${name} in ${outDir}`);
                }
                const size = statSync(file).size;
                if (size <= 0) die(`${name} is empty`);
                assets.push({ platform, name, sha256: sha256File(file), size });
        }
        if (assets.length === 0) die(`no release archives found in ${outDir}`);

        const repository = opts.repository ?? process.env.GITHUB_REPOSITORY ?? DEFAULT_REPOSITORY;
        const notesUrl = opts.notesUrl ?? `https://github.com/${repository}/releases/tag/v${version}`;
        if (!/^https:\/\//i.test(notesUrl) || /[\u0000-\u001f\u007f]/.test(notesUrl) || notesUrl.length > 2048) {
                die("notesUrl must be an https:// URL without control characters");
        }
        let changelog = "";
        try {
                changelog = readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8");
        } catch {
                changelog = "";
        }
        const severity = opts.severity ?? releaseSeverity(version, changelog);
        const minimumVersion = opts.minimumVersion ?? process.env.UNOWN_MINIMUM_VERSION ?? null;
        const requiredMinimumVersion = opts.requiredMinimumVersion ?? process.env.UNOWN_REQUIRED_MINIMUM_VERSION ?? null;
        for (const [field, value] of [
                ["minimumVersion", minimumVersion],
                ["requiredMinimumVersion", requiredMinimumVersion],
        ] as const) {
                if (value !== null && !STABLE_VERSION.test(value)) die(`${field} must be a stable X.Y.Z version or unset`);
        }

        const manifest: ReleaseManifest = {
                schema: 1,
                version,
                releasedAt: resolveReleasedAt(opts.releasedAt),
                channel: "stable",
                severity,
                minimumVersion,
                requiredMinimumVersion,
                notesUrl,
                assets,
        };
        const raw = `${JSON.stringify(manifest, null, 2)}\n`;
        const checked = parseReleaseManifest(raw);
        if (!checked.ok) die(`generated manifest failed its own validation: ${checked.error}`);
        writeFileSync(join(outDir, MANIFEST_FILE), raw);
        return { manifest, raw };
}

export interface VerifyOptions {
        outDir?: string;
        version?: string;
        requireAll?: boolean;
}

/** Verify a staged payload without the release host. */
export function verifyLocalPayload(opts: VerifyOptions = {}): ReleaseManifest {
        const outDir = resolve(opts.outDir ?? join(REPO_ROOT, "release-assets"));
        let raw: string;
        try {
                raw = readFileSync(join(outDir, MANIFEST_FILE), "utf8");
        } catch (err) {
                die(`missing ${MANIFEST_FILE} in ${outDir}: ${err instanceof Error ? err.message : String(err)}`);
        }
        const checked = parseReleaseManifest(raw);
        if (!checked.ok) die(`release manifest verification failed: ${checked.error}`);
        const manifest = checked.manifest;
        if (opts.version && manifest.version !== opts.version) {
                die(`manifest version ${manifest.version} does not equal ${opts.version}`);
        }
        let versionTxt: string;
        try {
                versionTxt = readFileSync(join(outDir, "version.txt"), "utf8").trim();
        } catch {
                die(`missing version.txt in ${outDir}`);
        }
        if (versionTxt !== manifest.version) die(`version.txt says ${versionTxt}, manifest says ${manifest.version}`);
        if (opts.requireAll) {
                const missing = RELEASE_PLATFORMS.filter((p) => !manifest.assets.some((a) => a.platform === p));
                if (missing.length) die(`manifest is missing platforms: ${missing.join(", ")}`);
        }
        for (const platform of RELEASE_PLATFORMS) {
                const asset = manifest.assets.find((a) => a.platform === platform);
                if (!asset) continue;
                const file = join(outDir, asset.name);
                if (!existsSync(file)) die(`manifest names ${asset.name}, but the file is missing`);
                const size = statSync(file).size;
                if (size !== asset.size) die(`${asset.name} is ${size} bytes, manifest says ${asset.size}`);
                const hash = sha256File(file);
                if (hash !== asset.sha256) die(`${asset.name} sha256 is ${hash}, manifest says ${asset.sha256}`);
        }
        for (const installer of ["install.sh", "install.ps1"]) {
                const file = join(outDir, installer);
                if (!existsSync(file) || statSync(file).size === 0) die(`missing or empty ${installer} in ${outDir}`);
        }
        return manifest;
}

async function fetchOk(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
        const headers = new Headers(init.headers);
        headers.set("user-agent", "unown-release-check");
        let res: Response;
        try {
                res = await fetch(url, {
                        redirect: "follow",
                        ...init,
                        signal: AbortSignal.timeout(timeoutMs),
                        headers,
                });
        } catch (err) {
                die(`could not reach ${url}: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!res.ok) die(`HTTP ${res.status} from ${url}`);
        return res;
}

async function fetchAndHash(url: string, expectedSize: number, expectedSha256: string): Promise<void> {
        const res = await fetchOk(url, {}, ARCHIVE_TIMEOUT_MS);
        if (!res.body) die(`download returned no body: ${url}`);
        const hash = createHash("sha256");
        const reader = res.body.getReader();
        let bytes = 0;
        for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value?.byteLength) {
                        bytes += value.byteLength;
                        if (bytes > expectedSize) {
                                try {
                                        await reader.cancel();
                                } catch {
                                        /* the error below is what matters */
                                }
                                die(`${url} is larger than the manifest size ${expectedSize}`);
                        }
                        hash.update(value);
                }
        }
        if (bytes !== expectedSize) die(`${url} is ${bytes} bytes, manifest says ${expectedSize}`);
        const actual = hash.digest("hex");
        if (actual !== expectedSha256) die(`${url} sha256 is ${actual}, manifest says ${expectedSha256}`);
}

/** Download and verify the published feed after the release is live. */
export async function verifyFeed(baseArg: string, opts: { version?: string } = {}): Promise<ReleaseManifest> {
        const base = baseArg.replace(/\/+$/, "");
        const raw = await (await fetchOk(releaseManifestUrl(base))).text();
        const checked = parseReleaseManifest(raw);
        if (!checked.ok) die(`live release manifest verification failed: ${checked.error}`);
        const manifest = checked.manifest;
        if (opts.version && manifest.version !== opts.version) {
                die(`live manifest version ${manifest.version} does not equal ${opts.version}`);
        }
        const versionTxt = (await (await fetchOk(versionTxtUrl(base))).text()).trim();
        if (versionTxt !== manifest.version) die(`live version.txt says ${versionTxt}, manifest says ${manifest.version}`);
        const missing = RELEASE_PLATFORMS.filter((p) => !manifest.assets.some((a) => a.platform === p));
        if (missing.length) die(`live manifest is missing platforms: ${missing.join(", ")}`);
        for (const asset of manifest.assets) {
                await fetchAndHash(assetUrl(base, asset.platform, manifest.version), asset.size, asset.sha256);
        }
        for (const installer of ["install.sh", "install.ps1"]) {
                const res = await fetchOk(`${base}/latest/download/${installer}`);
                const body = await res.text();
                if (body.length === 0) die(`live ${installer} is empty`);
        }
        return manifest;
}

type CliOptions = ManifestOptions & {
        check?: boolean;
        feed?: string;
        requireAll?: boolean;
        help?: boolean;
};

function parseCli(argv: string[]): CliOptions {
        const opts: CliOptions = {};
        for (let i = 0; i < argv.length; i++) {
                const a = argv[i];
                const next = (): string => {
                        const v = argv[++i];
                        if (!v) die(`${a} needs a value`);
                        return v;
                };
                if (a === "--out") opts.outDir = next();
                else if (a === "--version") opts.version = next();
                else if (a === "--released-at") opts.releasedAt = next();
                else if (a === "--severity") {
                        const v = next();
                        if (v !== "normal" && v !== "security") die("--severity must be normal or security");
                        opts.severity = v;
                } else if (a === "--minimum-version") opts.minimumVersion = next();
                else if (a === "--required-minimum-version") opts.requiredMinimumVersion = next();
                else if (a === "--notes-url") opts.notesUrl = next();
                else if (a === "--repository") opts.repository = next();
                else if (a === "--check") opts.check = true;
                else if (a === "--require-all") opts.requireAll = true;
                else if (a === "--allow-partial") opts.allowPartial = true;
                else if (a === "--feed") opts.feed = next();
                else if (a === "-h" || a === "--help") opts.help = true;
                else die(`unknown argument: ${a}`);
        }
        if (opts.check && opts.feed) die("--check and --feed are mutually exclusive");
        return opts;
}

function usage(): void {
        console.log(`Usage: bun scripts/release-manifest.ts [options]

Generate and locally verify the unsigned release manifest:
  --out <dir>                       payload dir (default release-assets)
  --version <X.Y.Z>                 override version.txt
  --released-at <iso>               override the commit timestamp
  --severity normal|security        override the CHANGELOG-derived severity
  --minimum-version <X.Y.Z>         optional manifest floor
  --required-minimum-version <X.Y.Z> optional required floor
  --notes-url <https-url>           override the release-notes URL
  --repository <owner/repo>         default for the notes URL
  --allow-partial                   allow a payload with fewer than six archives

Verify a staged payload:
  --check [--require-all] [--out <dir>]

Verify the published feed (downloads every archive and checks its SHA-256):
  --feed <release-base> [--version <X.Y.Z>]

The manifest is unsigned. The updater verifies each archive's exact size and
SHA-256 against it, and the release feed gate re-downloads the live assets.`);
}

async function main(): Promise<void> {
        const opts = parseCli(process.argv.slice(2));
        if (opts.help) {
                usage();
                return;
        }
        if (opts.feed) {
                const manifest = await verifyFeed(opts.feed, { version: opts.version });
                console.log(
                        `${sym.ok} live release feed verified: unown ${manifest.version} (${manifest.assets.length} platform assets, hashes matched)`,
                );
                return;
        }
        if (opts.check) {
                const manifest = verifyLocalPayload({
                        outDir: opts.outDir,
                        version: opts.version,
                        requireAll: opts.requireAll,
                });
                console.log(`${sym.ok} release payload verified: unown ${manifest.version} (${manifest.assets.length} platform assets)`);
                return;
        }
        const generated = buildManifest(opts);
        const manifest = verifyLocalPayload({
                outDir: opts.outDir,
                version: generated.manifest.version,
                requireAll: !opts.allowPartial,
        });
        console.log(`${sym.ok} wrote unsigned ${MANIFEST_FILE} for unown ${manifest.version} (${manifest.assets.length} platform assets)`);
        console.log(
                `  next: sha256sums.txt must cover ${manifest.assets.length + 6} assets ` +
                        `(archives + version.txt + installers + SBOM + checklist + manifest)`,
        );
}

if (import.meta.main) {
        await main();
}
