/**
 * bin-update.ts — updating a standalone (compiled) unown from GitHub Releases.
 *
 * The checkout updater is git-based (fetch tags, fast-forward, rebuild). A
 * binary install has no checkout: the release archive is the artifact, so the
 * update is a verified download and an atomic swap of a versioned directory:
 *
 *   version.txt ──> compare ──> download unown-<platform>.tar.gz|.zip
 *                              + sha256sums.txt (MANDATORY)
 *                              -> verify the exact checksum
 *                              -> extract -> run `<binary> --version`
 *                              -> rename into <root>/versions/<version>
 *                              -> rewrite shim + install.json (last)
 *
 * Everything is injected (fetch, extract, verifyBinary) so the suite runs
 * offline on all three operating systems. Nothing here touches git, and
 * nothing runs `bun scripts/install.ts`.
 */
import { spawnSync } from "node:child_process";
import {
        chmodSync,
        closeSync,
        existsSync,
        mkdirSync,
        mkdtempSync,
        openSync,
        readFileSync,
        renameSync,
        rmSync,
        writeFileSync,
        writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
        archiveName,
        assetUrl,
        binaryName,
        binaryPath,
        checksumsUrl,
        detectMusl,
        detectPlatform,
        type InstallMetadata,
        installMetadataPath,
        normalizeVersion,
        parseChecksumFor,
        platformGate,
        type ReleasePlatform,
        readInstallMetadata,
        redactUrl,
        releaseManifestUrl,
        releaseSignatureUrl,
        releasesBase,
        sha256File,
        shimPaths,
        versionDir,
        versionsDir,
        versionTxtUrl,
        writeBinaryShims,
        writeInstallMetadata,
} from "./install-layout.ts";
import {
        type ReleaseAsset,
        type ReleaseManifest,
        selectReleaseAsset,
        verifyReleaseManifest,
} from "./release-manifest.ts";
import { compareSemver, parseSemver } from "./semver.ts";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type ExtractArchive = (archivePath: string, destDir: string, platform: ReleasePlatform) => void;
export type VerifyBinary = (binaryPath: string, version: string) => boolean;

const DEFAULT_TIMEOUT_MS = 30_000;
/** Archive downloads and extraction can legitimately take minutes on a slow
 *  link; metadata fetches keep the short timeout. */
export const ARCHIVE_TIMEOUT_MS = 10 * 60_000;
const MAX_METADATA_BYTES = 256 * 1024;
const FETCH_ATTEMPTS = 3;
const FETCH_RETRY_MS = 500;

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------
function describeFetchError(err: unknown, url: string, timeoutMs: number): string {
        const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
        if (name === "TimeoutError" || name === "AbortError") {
                return `request timed out after ${timeoutMs}ms: ${url}`;
        }
        const message = err instanceof Error ? err.message : String(err);
        return `could not reach ${url} (${message})`;
}

interface FetchOptions {
        timeoutMs?: number;
        attempts?: number;
        userAgent?: string;
        method?: string;
        headers?: Record<string, string>;
}

async function sleep(ms: number): Promise<void> {
        await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** One response for every non-5xx status (404 is a decision, not an error);
 *  transient network errors and 5xx retry twice with backoff. */
async function fetchResponse(url: string, fetchImpl: FetchLike, opts: FetchOptions = {}): Promise<Response> {
        const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const attempts = opts.attempts ?? FETCH_ATTEMPTS;
        let lastError: unknown;
        for (let attempt = 0; attempt < attempts; attempt++) {
                try {
                        const headers = new Headers(opts.headers);
                        headers.set("user-agent", opts.userAgent ?? "unown");
                        const res = await fetchImpl(url, {
                                redirect: "follow",
                                method: opts.method,
                                headers,
                                signal: AbortSignal.timeout(timeoutMs),
                        });
                        if (res.status >= 500 && attempt < attempts - 1) {
                                try {
                                        await res.body?.cancel();
                                } catch {
                                        /* retry regardless */
                                }
                                lastError = new Error(
                                        `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""} from ${redactUrl(url)}`,
                                );
                                await sleep(FETCH_RETRY_MS * 2 ** attempt);
                                continue;
                        }
                        return res;
                } catch (err) {
                        lastError = err;
                        if (attempt < attempts - 1) {
                                await sleep(FETCH_RETRY_MS * 2 ** attempt);
                        }
                }
        }
        throw new Error(describeFetchError(lastError, redactUrl(url), timeoutMs));
}

async function fetchOk(url: string, fetchImpl: FetchLike, timeoutMs: number, userAgent?: string): Promise<Response> {
        const res = await fetchResponse(url, fetchImpl, { timeoutMs, userAgent });
        if (!res.ok) {
                throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""} from ${redactUrl(url)}`);
        }
        return res;
}

/** Small bodies only (manifest/signature/version.txt/sums). A hostile or
 *  broken mirror cannot make the updater buffer an unbounded response. */
async function readBodyCapped(res: Response, maxBytes = MAX_METADATA_BYTES): Promise<string> {
        if (!res.body) return "";
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value?.byteLength) {
                        total += value.byteLength;
                        if (total > maxBytes) {
                                try {
                                        await reader.cancel();
                                } catch {
                                        /* the error below is what matters */
                                }
                                throw new Error(`response exceeded ${maxBytes} bytes`);
                        }
                        chunks.push(value);
                }
        }
        return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

async function fetchText(url: string, fetchImpl: FetchLike, timeoutMs: number, userAgent?: string): Promise<string> {
        const res = await fetchOk(url, fetchImpl, timeoutMs, userAgent);
        return readBodyCapped(res);
}

async function downloadFile(
        url: string,
        destPath: string,
        fetchImpl: FetchLike,
        timeoutMs: number,
        userAgent?: string,
        maxBytes?: number,
): Promise<number> {
        const res = await fetchOk(url, fetchImpl, timeoutMs, userAgent);
        if (!res.body) throw new Error(`download returned no body: ${redactUrl(url)}`);
        // Stream to disk: a release archive is ~30-90 MiB, and buffering it whole
        // is avoidable memory pressure on the machines that install binaries.
        const fd = openSync(destPath, "w");
        let bytes = 0;
        try {
                const reader = res.body.getReader();
                for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (value?.byteLength) {
                                if (maxBytes !== undefined && bytes + value.byteLength > maxBytes) {
                                        throw new Error(`download exceeded the expected ${maxBytes} bytes`);
                                }
                                writeSync(fd, value);
                                bytes += value.byteLength;
                        }
                }
        } finally {
                closeSync(fd);
        }
        if (bytes === 0) throw new Error(`download was empty: ${redactUrl(url)}`);
        return bytes;
}

// ---------------------------------------------------------------------------
// Non-mutating check (`release.json` first, legacy `version.txt` fallback)
// ---------------------------------------------------------------------------
export interface LatestVersionResult {
        ok: boolean;
        latest: string | null;
        baseUrl: string;
        error?: string;
}

export async function checkLatestVersion(
        opts: { env?: NodeJS.ProcessEnv; baseUrl?: string; fetch?: FetchLike; timeoutMs?: number; userAgent?: string } = {},
): Promise<LatestVersionResult> {
        const baseUrl = (opts.baseUrl ?? releasesBase(opts.env ?? process.env)).replace(/\/+$/, "");
        const publicBaseUrl = redactUrl(baseUrl);
        const fetchImpl = opts.fetch ?? fetch;
        const url = versionTxtUrl(baseUrl);
        try {
                const text = await fetchText(url, fetchImpl, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.userAgent);
                const latest = normalizeVersion(text.trim());
                if (!parseSemver(latest)) {
                        return {
                                ok: false,
                                latest: null,
                                baseUrl: publicBaseUrl,
                                error: `version.txt did not contain a version (got "${text.trim().slice(0, 40)}")`,
                        };
                }
                return { ok: true, latest, baseUrl: publicBaseUrl };
        } catch (err) {
                return {
                        ok: false,
                        latest: null,
                        baseUrl: publicBaseUrl,
                        error: err instanceof Error ? err.message : String(err),
                };
        }
}

export interface ReleaseFeedOptions {
        env?: NodeJS.ProcessEnv;
        baseUrl?: string;
        version?: string;
        fetch?: FetchLike;
        timeoutMs?: number;
        userAgent?: string;
        keys?: Readonly<Record<string, string>>;
}

export type ReleaseFeedResult =
        | { kind: "manifest"; manifest: ReleaseManifest; raw: string }
        | { kind: "legacy"; reason: string }
        | { kind: "error"; error: string };

/** Fetch the signed manifest for `version` (or latest). A 404/410 is the only
 *  legacy fallback; a present-but-unauthorized manifest is an error. */
export async function fetchReleaseFeed(opts: ReleaseFeedOptions = {}): Promise<ReleaseFeedResult> {
        const env = opts.env ?? process.env;
        const baseUrl = (opts.baseUrl ?? releasesBase(env)).replace(/\/+$/, "");
        const fetchImpl = opts.fetch ?? fetch;
        const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        try {
                const manifestRes = await fetchResponse(releaseManifestUrl(baseUrl, opts.version), fetchImpl, {
                        timeoutMs,
                        userAgent: opts.userAgent,
                });
                if (manifestRes.status === 404 || manifestRes.status === 410) {
                        return { kind: "legacy", reason: "release manifest is not published" };
                }
                if (!manifestRes.ok) {
                        return {
                                kind: "error",
                                error: `HTTP ${manifestRes.status}${manifestRes.statusText ? ` ${manifestRes.statusText}` : ""} from ${redactUrl(releaseManifestUrl(baseUrl, opts.version))}`,
                        };
                }
                const raw = await readBodyCapped(manifestRes);
                const sigRes = await fetchResponse(releaseSignatureUrl(baseUrl, opts.version), fetchImpl, {
                        timeoutMs,
                        userAgent: opts.userAgent,
                });
                if (sigRes.status === 404 || sigRes.status === 410) {
                        return { kind: "error", error: "release manifest is unsigned (signature file is missing)" };
                }
                if (!sigRes.ok) {
                        return {
                                kind: "error",
                                error: `HTTP ${sigRes.status}${sigRes.statusText ? ` ${sigRes.statusText}` : ""} from ${redactUrl(releaseSignatureUrl(baseUrl, opts.version))}`,
                        };
                }
                const signature = (await readBodyCapped(sigRes)).trim();
                const checked = verifyReleaseManifest(raw, signature, opts.keys);
                if (!checked.ok) return { kind: "error", error: checked.error };
                return { kind: "manifest", manifest: checked.manifest, raw };
        } catch (err) {
                return { kind: "error", error: err instanceof Error ? err.message : String(err) };
        }
}

export interface BinaryCheckResult {
        ok: boolean;
        current: string;
        latest: string | null;
        /** Newer AND installable on this OS/arch. */
        available: boolean;
        /** Newer release exists and this platform has an asset (platform gate). */
        applicable: boolean;
        reason?: string;
        platform: ReleasePlatform | null;
        asset?: ReleaseAsset;
        source: "manifest" | "legacy" | "none";
        signature: "verified" | "legacy" | null;
        keyId?: string;
        severity?: "normal" | "security";
        releasedAt?: string;
        requiredMinimumVersion?: string | null;
        notesUrl?: string | null;
        remoteUrl: string | null;
        error?: string;
}

/** Compare the running version against the signed release feed. Exit-code
 *  mapping stays in update.ts (0 current/no applicable asset, 2 available,
 *  1 error). A platform miss is `applicable:false`, not an error. */
export async function checkBinaryUpdate(opts: {
        current: string;
        env?: NodeJS.ProcessEnv;
        fetch?: FetchLike;
        baseUrl?: string;
        timeoutMs?: number;
        platform?: ReleasePlatform;
        metadataPlatform?: string;
        musl?: boolean;
        keys?: Readonly<Record<string, string>>;
        cachedLatest?: string;
}): Promise<BinaryCheckResult> {
        const env = opts.env ?? process.env;
        const baseUrl = (opts.baseUrl ?? releasesBase(env)).replace(/\/+$/, "");
        const remoteUrl = redactUrl(baseUrl);
        const detected = opts.platform ?? detectPlatform();
        const gate = detected
                ? platformGate({
                                platform: detected,
                                env,
                                metadataPlatform: opts.metadataPlatform,
                                musl: opts.musl ?? detectMusl({ platform: process.platform }),
                        })
                : "this OS/arch is not a published release target";
        const userAgent = `unown/${opts.current}`;
        const feed = await fetchReleaseFeed({
                env,
                baseUrl,
                fetch: opts.fetch,
                timeoutMs: opts.timeoutMs,
                userAgent,
                keys: opts.keys,
        });
        if (feed.kind === "error") {
                return {
                        ok: false,
                        current: opts.current,
                        latest: null,
                        available: false,
                        applicable: false,
                        reason: "feed-error",
                        platform: detected,
                        source: "none",
                        signature: null,
                        remoteUrl,
                        error: feed.error,
                };
        }
        if (feed.kind === "legacy") {
                const latestRes = await checkLatestVersion({
                        env,
                        fetch: opts.fetch,
                        baseUrl,
                        timeoutMs: opts.timeoutMs,
                        userAgent,
                });
                if (!latestRes.ok || !latestRes.latest) {
                        return {
                                ok: false,
                                current: opts.current,
                                latest: null,
                                available: false,
                                applicable: false,
                                reason: "feed-error",
                                platform: detected,
                                source: "none",
                                signature: null,
                                remoteUrl,
                                error: latestRes.error ?? "no version published",
                        };
                }
                let asset: ReleaseAsset | undefined;
                if (detected && !gate) {
                        try {
                                const sums = await fetchText(
                                        checksumsUrl(baseUrl),
                                        opts.fetch ?? fetch,
                                        opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
                                        userAgent,
                                );
                                const name = archiveName(detected);
                                const hash = parseChecksumFor(sums, name);
                                if (hash) asset = { platform: detected, name, sha256: hash, size: 0 };
                        } catch (err) {
                                return {
                                        ok: false,
                                        current: opts.current,
                                        latest: latestRes.latest,
                                        available: false,
                                        applicable: false,
                                        reason: "feed-error",
                                        platform: detected,
                                        source: "legacy",
                                        signature: "legacy",
                                        remoteUrl,
                                        error: err instanceof Error ? err.message : String(err),
                                };
                        }
                }
                const newer = !parseSemver(opts.current) || compareSemver(latestRes.latest, opts.current) > 0;
                const applicable = Boolean(detected && !gate && asset);
                return {
                        ok: true,
                        current: opts.current,
                        latest: latestRes.latest,
                        available: applicable && newer,
                        applicable,
                        reason: !detected ? "no-platform" : gate ? gate : !asset ? "no-asset (legacy checksum manifest)" : "ok",
                        platform: detected,
                        ...(asset ? { asset } : {}),
                        source: "legacy",
                        signature: "legacy",
                        remoteUrl,
                };
        }

        const manifest = feed.manifest;
        const latest = manifest.version;
        const asset = detected ? selectReleaseAsset(manifest, detected) : null;
        const newer = !parseSemver(opts.current) || compareSemver(latest, opts.current) > 0;
        const replayed = Boolean(
                opts.cachedLatest &&
                        parseSemver(opts.current) &&
                        compareSemver(latest, opts.cachedLatest) < 0 &&
                        compareSemver(latest, opts.current) <= 0,
        );
        const applicable = Boolean(detected && !gate && asset);
        return {
                ok: true,
                current: opts.current,
                latest,
                available: applicable && newer && !replayed,
                applicable,
                reason: !detected ? "no-platform" : gate ? gate : !asset ? "no-asset" : replayed ? "replayed" : "ok",
                platform: detected,
                ...(asset ? { asset } : {}),
                source: "manifest",
                signature: "verified",
                keyId: manifest.keyId,
                severity: manifest.severity,
                releasedAt: manifest.releasedAt,
                requiredMinimumVersion: manifest.requiredMinimumVersion,
                notesUrl: manifest.notesUrl,
                remoteUrl,
        };
}

// ---------------------------------------------------------------------------
// Checksums (mandatory)
// ---------------------------------------------------------------------------
export function verifyChecksum(filePath: string, expectedHex: string): boolean {
        return sha256File(filePath) === expectedHex.toLowerCase();
}

// ---------------------------------------------------------------------------
// Extraction / binary verification defaults
// ---------------------------------------------------------------------------
export function extractArchive(archivePath: string, destDir: string, platform: ReleasePlatform): void {
        mkdirSync(destDir, { recursive: true });
        const isWindows = platform.startsWith("windows");
        const isTarGz = archivePath.toLowerCase().endsWith(".tar.gz") || archivePath.toLowerCase().endsWith(".tgz");
        // On Windows, a bare `tar` under Git Bash resolves to GNU tar, which
        // treats `C:\...` as a remote host ("Cannot connect to C:"). Use the
        // System32 bsdtar (which also reads zip) by absolute path.
        const tarBin = isWindows ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
        const attempts: string[][] = isWindows
                ? [["-xf", archivePath, "-C", destDir]]
                : isTarGz
                        ? [
                                        ["-xzf", archivePath, "-C", destDir],
                                        ["-xf", archivePath, "-C", destDir],
                                ]
                        : [
                                        ["-xf", archivePath, "-C", destDir],
                                        ["-xzf", archivePath, "-C", destDir],
                                ];
        const failures: string[] = [];
        for (const args of attempts) {
                const r = spawnSync(tarBin, args, { encoding: "utf8", timeout: ARCHIVE_TIMEOUT_MS });
                if (r.status === 0) return;
                failures.push((r.stderr || r.stdout || `exit ${r.status ?? "?"}`).trim());
        }
        throw new Error(`could not extract ${archivePath}: ${failures.filter(Boolean).join(" | ") || "tar unavailable"}`);
}

export function verifyBinaryVersion(binaryPath: string, version: string): boolean {
        try {
                const r = spawnSync(binaryPath, ["--version"], { encoding: "utf8", timeout: 20_000 });
                if (r.status !== 0) return false;
                return (r.stdout ?? "").trim() === normalizeVersion(version);
        } catch {
                return false;
        }
}

// ---------------------------------------------------------------------------
// Download + stage
// ---------------------------------------------------------------------------
export interface DownloadStageOptions {
        root: string;
        platform: ReleasePlatform;
        version: string;
        env?: NodeJS.ProcessEnv;
        baseUrl?: string;
        fetch?: FetchLike;
        extract?: ExtractArchive;
        verifyBinary?: VerifyBinary;
        timeoutMs?: number;
        archiveTimeoutMs?: number;
        userAgent?: string;
        /** The signed manifest entry; when present, size and sha256 are the
         *  expected values and sha256sums.txt must agree with it. */
        manifestAsset?: ReleaseAsset;
        quarantine?: (binary: string, platform: ReleasePlatform) => void;
        log?: (line: string) => void;
}

export type DownloadStageResult =
        | { ok: true; stagedDir: string; binary: string; tempDir: string }
        | { ok: false; error: string };

const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;

/** macOS marks Node-downloaded files? Not observed; the archive is extracted
 *  by tar, but the installer clears quarantine defensively and the updater
 *  should behave the same way. Windows MOTW is not set by Node fetch (no
 *  Unblock-File call until that is measured). */
export function clearQuarantine(binary: string, platform: ReleasePlatform): void {
        if (!platform.startsWith("darwin")) return;
        try {
                spawnSync("xattr", ["-d", "com.apple.quarantine", binary], { encoding: "utf8", timeout: 10_000 });
        } catch {
                /* best effort — the binary still runs if the attribute was absent */
        }
}

export async function downloadAndStage(opts: DownloadStageOptions): Promise<DownloadStageResult> {
        const env = opts.env ?? process.env;
        const baseUrl = (opts.baseUrl ?? releasesBase(env)).replace(/\/+$/, "");
        const version = normalizeVersion(opts.version);
        const fetchImpl = opts.fetch ?? fetch;
        const extract = opts.extract ?? extractArchive;
        const verify = opts.verifyBinary ?? verifyBinaryVersion;
        const quarantine = opts.quarantine ?? clearQuarantine;
        const mediaTimeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const archiveTimeout = opts.archiveTimeoutMs ?? ARCHIVE_TIMEOUT_MS;
        const log = opts.log ?? (() => {});
        const name = archiveName(opts.platform);
        if (opts.manifestAsset && opts.manifestAsset.name !== name) {
                return { ok: false, error: `manifest asset ${opts.manifestAsset.name} does not match ${name}` };
        }
        // A legacy checksum-manifest asset carries only a hash (size 0).
        const expectedSize = opts.manifestAsset && opts.manifestAsset.size > 0 ? opts.manifestAsset.size : undefined;

        mkdirSync(opts.root, { recursive: true });
        let tempDir: string;
        try {
                tempDir = mkdtempSync(join(opts.root, ".update-"));
        } catch (err) {
                return {
                        ok: false,
                        error: `could not create a staging directory under ${opts.root} (${err instanceof Error ? err.message : String(err)})`,
                };
        }
        const archivePath = join(tempDir, name);
        try {
                const url = assetUrl(baseUrl, opts.platform, version);
                log(`· downloading ${name} (v${version})…`);
                const maxBytes = expectedSize ? expectedSize + 1 : MAX_ARCHIVE_BYTES;
                const size = await downloadFile(url, archivePath, fetchImpl, archiveTimeout, opts.userAgent, maxBytes);
                log(`· downloaded ${(size / (1024 * 1024)).toFixed(1)} MiB`);
                if (expectedSize && size !== expectedSize) {
                        throw new Error(`${name} is ${size} bytes, the signed manifest says ${expectedSize}`);
                }

                const sumsUrl = checksumsUrl(baseUrl, version);
                const sums = await fetchText(sumsUrl, fetchImpl, mediaTimeout, opts.userAgent);
                const published = parseChecksumFor(sums, name);
                if (!published) {
                        throw new Error(`sha256sums.txt has no entry for ${name}`);
                }
                const expected = opts.manifestAsset?.sha256 ?? published;
                if (opts.manifestAsset && published !== opts.manifestAsset.sha256) {
                        throw new Error(`sha256sums.txt disagrees with the signed release manifest for ${name}`);
                }
                const actual = sha256File(archivePath);
                if (actual !== expected) {
                        throw new Error(`checksum mismatch for ${name}: expected ${expected}, got ${actual}`);
                }
                log("· checksum verified");

                const extractDir = join(tempDir, "extract");
                mkdirSync(extractDir, { recursive: true });
                extract(archivePath, extractDir, opts.platform);
                const wrapper = join(extractDir, `unown-${opts.platform}`);
                const candidates = [join(wrapper, binaryName(opts.platform)), join(extractDir, binaryName(opts.platform))];
                const binary = candidates.find((p) => existsSync(p));
                if (!binary) {
                        throw new Error(`archive did not contain unown-${opts.platform}/${binaryName(opts.platform)}`);
                }
                // Zip extraction (and a tar built on NTFS) may not carry the exec
                // bit; the installer already chmods, the updater must too.
                try {
                        chmodSync(binary, 0o755);
                } catch {
                        // Windows / filesystems without POSIX modes
                }
                quarantine(binary, opts.platform);
                if (!verify(binary, version)) {
                        throw new Error(`downloaded binary did not report version ${version}`);
                }
                log(`· verified unown --version = ${version}`);
                return { ok: true, stagedDir: dirname(binary), binary, tempDir };
        } catch (err) {
                rmSync(tempDir, { recursive: true, force: true });
                return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
}

// ---------------------------------------------------------------------------
// Install staged (atomic move + shim/metadata rewrite)
// ---------------------------------------------------------------------------
/** Snapshot the active shims + metadata so a failed activation can put the
 *  previous install back exactly as it was. The versioned tree is additive. */
function snapshotActive(env: NodeJS.ProcessEnv, home: string): { restore: () => void } {
        const paths = shimPaths(env, process.platform);
        const shims = new Map<string, string | null>();
        for (const p of paths.all) {
                try {
                        shims.set(p, existsSync(p) ? readFileSync(p, "utf8") : null);
                } catch {
                        shims.set(p, null);
                }
        }
        const metaPath = installMetadataPath(home);
        let meta: string | null = null;
        try {
                meta = existsSync(metaPath) ? readFileSync(metaPath, "utf8") : null;
        } catch {
                meta = null;
        }
        return {
                restore: () => {
                        for (const [p, content] of shims) {
                                try {
                                        if (content === null) rmSync(p, { force: true });
                                        else writeFileSync(p, content);
                                } catch {
                                        // best effort: the caller reports the original failure
                                }
                        }
                        try {
                                if (meta === null) rmSync(metaPath, { force: true });
                                else writeFileSync(metaPath, meta);
                        } catch {
                                // best effort
                        }
                },
        };
}

export interface InstallStagedOptions {
        stagedDir: string;
        tempDir: string;
        root: string;
        version: string;
        platform: ReleasePlatform;
        home: string;
        env?: NodeJS.ProcessEnv;
        previousVersion?: string;
        verifyBinary?: VerifyBinary;
        log?: (line: string) => void;
}

export type InstallStagedResult =
        | { ok: true; binary: string; shim: string; versionDir: string; reused: boolean }
        | { ok: false; error: string };

export function installStaged(opts: InstallStagedOptions): InstallStagedResult {
        const env = opts.env ?? process.env;
        const log = opts.log ?? (() => {});
        const version = normalizeVersion(opts.version);
        const targetDir = versionDir(opts.root, version);
        const targetBin = binaryPath(opts.root, version, opts.platform);
        const verify = opts.verifyBinary ?? verifyBinaryVersion;
        const snapshot = snapshotActive(env, opts.home);
        let reused = false;
        try {
                if (existsSync(targetDir)) {
                        // Re-running an update for the version already on disk (or
                        // rolling back to one kept for exactly this purpose).
                        if (!verify(targetBin, version)) {
                                throw new Error(`${targetDir} already exists but its binary does not report ${version}`);
                        }
                        reused = true;
                        log(`· v${version} is already installed - reusing it`);
                } else {
                        mkdirSync(versionsDir(opts.root), { recursive: true });
                        renameSync(opts.stagedDir, targetDir);
                }
                const shims = writeBinaryShims({
                        root: opts.root,
                        version,
                        // Shims are host-specific (cmd.exe/PowerShell vs sh); the
                        // release platform only selects the archive/binary name.
                        platform: process.platform,
                        env,
                });
                const previous = opts.previousVersion ? normalizeVersion(opts.previousVersion) : undefined;
                // A repair/reinstall of the version already active must not drop
                // the rollback target recorded by the update that installed it.
                const existing = readInstallMetadata(opts.home);
                const keepPrevious =
                        previous && previous !== version
                                ? previous
                                : existing?.mode === "binary" && existing.version === version
                                        ? existing.previousVersion
                                        : undefined;
                const meta: InstallMetadata = {
                        schema: 1,
                        mode: "binary",
                        version,
                        platform: opts.platform,
                        root: opts.root,
                        bin: targetBin,
                        shim: shims.primary,
                        ...(keepPrevious ? { previousVersion: keepPrevious } : {}),
                        installedAt: new Date().toISOString(),
                };
                // Metadata last: it is the record of an install that is already live.
                writeInstallMetadata(opts.home, meta);
                return { ok: true, binary: targetBin, shim: shims.primary, versionDir: targetDir, reused };
        } catch (err) {
                snapshot.restore();
                return { ok: false, error: err instanceof Error ? err.message : String(err) };
        } finally {
                rmSync(opts.tempDir, { recursive: true, force: true });
        }
}

// ---------------------------------------------------------------------------
// Rollback (previousVersion in install.json; versions stay on disk)
// ---------------------------------------------------------------------------
export interface BinaryRollbackOptions {
        home: string;
        env?: NodeJS.ProcessEnv;
        platform?: NodeJS.Platform;
        verifyBinary?: VerifyBinary;
        log?: (line: string) => void;
}

export interface BinaryRollbackResult {
        code: number;
        from?: string;
        to?: string;
        error?: string;
}

export function rollbackBinaryInstall(opts: BinaryRollbackOptions): BinaryRollbackResult {
        const env = opts.env ?? process.env;
        const log = opts.log ?? (() => {});
        const meta = readInstallMetadata(opts.home);
        if (!meta || meta.mode !== "binary") {
                log(`unown: no binary install recorded in ${installMetadataPath(opts.home)} - nothing to roll back`);
                return { code: 1, error: "no binary install metadata" };
        }
        if (!meta.previousVersion) {
                log("unown: no previous version recorded - run `unown update` first");
                return { code: 1, error: "no previous version" };
        }
        const platform = opts.platform ?? process.platform;
        const previous = normalizeVersion(meta.previousVersion);
        const previousBin = binaryPath(meta.root, previous, meta.platform ?? platform);
        if (!existsSync(previousBin)) {
                log(`unown: version ${previous} is no longer on disk (${previousBin}) - cannot roll back`);
                return { code: 1, error: "previous version missing" };
        }
        const verify = opts.verifyBinary ?? verifyBinaryVersion;
        if (!verify(previousBin, previous)) {
                log(`unown: ${previousBin} does not report version ${previous} - refusing to switch to it`);
                return { code: 1, error: "previous binary failed verification" };
        }
        const snapshot = snapshotActive(env, opts.home);
        try {
                const shims = writeBinaryShims({
                        root: meta.root,
                        version: previous,
                        platform,
                        env,
                });
                writeInstallMetadata(opts.home, {
                        ...meta,
                        version: previous,
                        bin: previousBin,
                        shim: shims.primary,
                        // toggle: a second --rollback returns to the version we left
                        previousVersion: meta.version,
                        installedAt: new Date().toISOString(),
                });
        } catch (err) {
                snapshot.restore();
                const message = err instanceof Error ? err.message : String(err);
                log(`unown: rollback failed - ${message} (the active install is unchanged)`);
                return { code: 1, error: message };
        }
        log(`✓ unown rolled back: ${meta.version} → ${previous}`);
        return { code: 0, from: meta.version, to: previous };
}
