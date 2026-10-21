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
        installMetadataPath,
        normalizeVersion,
        parseChecksumFor,
        readInstallMetadata,
        redactUrl,
        releasesBase,
        sha256File,
        versionDir,
        versionsDir,
        shimPaths,
        versionTxtUrl,
        writeBinaryShims,
        writeInstallMetadata,
        type InstallMetadata,
        type ReleasePlatform,
} from "./install-layout.ts";
import { compareSemver, parseSemver } from "./semver.ts";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type ExtractArchive = (archivePath: string, destDir: string, platform: ReleasePlatform) => void;
export type VerifyBinary = (binaryPath: string, version: string) => boolean;

const DEFAULT_TIMEOUT_MS = 30_000;
const ARCHIVE_TIMEOUT_MS = 120_000;

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

async function fetchOk(url: string, fetchImpl: FetchLike, timeoutMs: number): Promise<Response> {
        let res: Response;
        try {
                res = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
        } catch (err) {
                throw new Error(describeFetchError(err, redactUrl(url), timeoutMs));
        }
        if (!res.ok) {
                throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""} from ${redactUrl(url)}`);
        }
        return res;
}

async function fetchText(url: string, fetchImpl: FetchLike, timeoutMs: number): Promise<string> {
        const res = await fetchOk(url, fetchImpl, timeoutMs);
        return res.text();
}

async function downloadFile(url: string, destPath: string, fetchImpl: FetchLike, timeoutMs: number): Promise<number> {
        const res = await fetchOk(url, fetchImpl, timeoutMs);
        if (!res.body) throw new Error(`download returned no body: ${url}`);
        // Stream to disk: a release archive is ~30-90 MiB, and buffering it whole
        // is avoidable memory pressure on the machines that install binaries.
        const fd = openSync(destPath, "w");
        let bytes = 0;
        try {
                const reader = res.body.getReader();
                for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (value && value.byteLength) {
                                writeSync(fd, value);
                                bytes += value.byteLength;
                        }
                }
        } finally {
                closeSync(fd);
        }
        if (bytes === 0) throw new Error(`download was empty: ${url}`);
        return bytes;
}

// ---------------------------------------------------------------------------
// Non-mutating check (`version.txt` — works without git)
// ---------------------------------------------------------------------------
export interface LatestVersionResult {
        ok: boolean;
        latest: string | null;
        baseUrl: string;
        error?: string;
}

export async function checkLatestVersion(opts: {
        env?: NodeJS.ProcessEnv;
        baseUrl?: string;
        fetch?: FetchLike;
        timeoutMs?: number;
} = {}): Promise<LatestVersionResult> {
        const baseUrl = (opts.baseUrl ?? releasesBase(opts.env ?? process.env)).replace(/\/+$/, "");
        const publicBaseUrl = redactUrl(baseUrl);
        const fetchImpl = opts.fetch ?? fetch;
        const url = versionTxtUrl(baseUrl);
        try {
                const text = await fetchText(url, fetchImpl, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
                const latest = normalizeVersion(text.trim());
                if (!parseSemver(latest)) {
                        return { ok: false, latest: null, baseUrl: publicBaseUrl, error: `version.txt did not contain a version (got "${text.trim().slice(0, 40)}")` };
                }
                return { ok: true, latest, baseUrl: publicBaseUrl };
        } catch (err) {
                return { ok: false, latest: null, baseUrl: publicBaseUrl, error: err instanceof Error ? err.message : String(err) };
        }
}

export interface BinaryCheckResult {
        ok: boolean;
        current: string;
        latest: string | null;
        available: boolean;
        remoteUrl: string | null;
        error?: string;
}

/** Compare the running version against the release feed. Exit-code mapping
 *  stays in update.ts (0 current, 2 available, 1 error). */
export async function checkBinaryUpdate(opts: {
        current: string;
        env?: NodeJS.ProcessEnv;
        fetch?: FetchLike;
        baseUrl?: string;
        timeoutMs?: number;
}): Promise<BinaryCheckResult> {
        const res = await checkLatestVersion({
                env: opts.env,
                fetch: opts.fetch,
                baseUrl: opts.baseUrl,
                timeoutMs: opts.timeoutMs,
        });
        if (!res.ok || !res.latest) {
                return { ok: false, current: opts.current, latest: null, available: false, remoteUrl: res.baseUrl, error: res.error };
        }
        return {
                ok: true,
                current: opts.current,
                latest: res.latest,
                // "unknown" is a binary adopted from a raw archive before any
                // install metadata existed; any published version is newer than it.
                available: !parseSemver(opts.current) || compareSemver(res.latest, opts.current) > 0,
                remoteUrl: res.baseUrl,
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
        const tarBin = isWindows
                ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
                : "tar";
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
        log?: (line: string) => void;
}

export type DownloadStageResult =
        | { ok: true; stagedDir: string; binary: string; tempDir: string }
        | { ok: false; error: string };

export async function downloadAndStage(opts: DownloadStageOptions): Promise<DownloadStageResult> {
        const env = opts.env ?? process.env;
        const baseUrl = (opts.baseUrl ?? releasesBase(env)).replace(/\/+$/, "");
        const version = normalizeVersion(opts.version);
        const fetchImpl = opts.fetch ?? fetch;
        const extract = opts.extract ?? extractArchive;
        const verify = opts.verifyBinary ?? verifyBinaryVersion;
        const log = opts.log ?? (() => {});

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
        const archivePath = join(tempDir, archiveName(opts.platform));
        try {
                const url = assetUrl(baseUrl, opts.platform, version);
                log(`· downloading ${archiveName(opts.platform)} (v${version})…`);
                const size = await downloadFile(url, archivePath, fetchImpl, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
                log(`· downloaded ${(size / (1024 * 1024)).toFixed(1)} MiB`);

                const sumsUrl = checksumsUrl(baseUrl, version);
                const sums = await fetchText(sumsUrl, fetchImpl, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
                const expected = parseChecksumFor(sums, archiveName(opts.platform));
                if (!expected) {
                        throw new Error(`sha256sums.txt has no entry for ${archiveName(opts.platform)}`);
                }
                const actual = sha256File(archivePath);
                if (actual !== expected) {
                        throw new Error(`checksum mismatch for ${archiveName(opts.platform)}: expected ${expected}, got ${actual}`);
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
