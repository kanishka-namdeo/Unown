/**
 * install-layout.ts — where an unown install lives, in both supported shapes.
 *
 *   checkout: a git clone plus a PATH shim that runs `bun <repo>/bin/unown`.
 *   binary:   a standalone CLI under <root>/versions/<version>/unown[.exe],
 *             with a shim that sets UNOWN_INSTALL_ROOT and execs that file.
 *
 * This module is deliberately dependency-free (node: builtins only) and free
 * of process-wide side effects: everything takes its platform/env/paths as
 * arguments so the updater, the uninstaller, scripts/link.ts and the tests
 * all agree on one layout without duplicating it.
 *
 * Layout contract (shared with the installers):
 *   release base   https://github.com/kanishka-namdeo/Unown/releases
 *                  (UNOWN_RELEASES_BASE_URL overrides for mirrors/tests)
 *   latest version <base>/latest/download/version.txt
 *   pinned asset   <base>/download/v<version>/unown-<platform>.<ext>
 *   binary root    POSIX: ${UNOWN_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/unown}
 *                  Windows: %UNOWN_INSTALL_ROOT% else %LOCALAPPDATA%\unown
 *   version dir    <root>/versions/<version>/unown[.exe]
 *   shims          POSIX: ${UNOWN_BIN_DIR:-$HOME/.local/bin}/unown
 *                  Windows: %UNOWN_BIN_DIR% else %USERPROFILE%\.local\bin\unown.cmd + unown.ps1
 *   metadata       <UNOWN_HOME>/install.json (schema 1)
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
        chmodSync,
        closeSync,
        existsSync,
        mkdirSync,
        openSync,
        readFileSync,
        readSync,
        realpathSync,
        renameSync,
        rmSync,
        writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, posix, win32 } from "node:path";
import { parseSemver } from "./semver.ts";

/** Path joining for the TARGET platform, not the host: a POSIX layout
 *  computed on Windows must still read `/data/unown`, not `\data\unown`. */
function joinFor(platform: NodeJS.Platform): (...parts: string[]) => string {
        return platform === "win32" ? win32.join : posix.join;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type InstallMode = "checkout" | "binary";

export const RELEASE_PLATFORMS = [
        "darwin-arm64",
        "darwin-x64",
        "linux-arm64",
        "linux-x64",
        "windows-arm64",
        "windows-x64",
] as const;
export type ReleasePlatform = (typeof RELEASE_PLATFORMS)[number];

export interface InstallMetadata {
        schema: 1;
        mode: InstallMode;
        /** Plain semver (no `v`). */
        version: string;
        platform?: string;
        root: string;
        bin: string;
        shim: string;
        previousVersion?: string;
        installedAt: string;
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------
export interface PlatformProbe {
        platform?: NodeJS.Platform;
        arch?: string;
        /** Rosetta translation flag; probed via sysctl when omitted. */
        procTranslated?: boolean;
        /** Injectable for tests; used by detectMusl. */
        fileExists?: (p: string) => boolean;
}

/** macOS on an Apple Silicon machine reports `x64` under Rosetta; prefer the
 *  native archive when the kernel says the process is translated. */
function detectProcTranslated(): boolean {
        const r = spawnSync("sysctl", ["-in", "sysctl.proc_translated"], { encoding: "utf8", timeout: 5_000 });
        return r.status === 0 && (r.stdout ?? "").trim() === "1";
}

export function detectPlatform(probe: PlatformProbe = {}): ReleasePlatform | null {
        const os = probe.platform ?? process.platform;
        let arch = probe.arch ?? process.arch;
        if (os === "darwin" && arch === "x64") {
                const translated = probe.procTranslated ?? detectProcTranslated();
                if (translated) arch = "arm64";
        }
        if (os === "win32" && (arch === "x64" || arch === "arm64")) return `windows-${arch}` as ReleasePlatform;
        if (os === "darwin" && (arch === "x64" || arch === "arm64")) return `darwin-${arch}` as ReleasePlatform;
        if (os === "linux" && (arch === "x64" || arch === "arm64")) return `linux-${arch}` as ReleasePlatform;
        return null;
}

/** Linux releases are glibc-only. Alpine/musl is detectable without running
 *  the binary by the loader name it installs (plus Alpine's release file). */
export function detectMusl(probe: PlatformProbe = {}): boolean {
        const os = probe.platform ?? process.platform;
        if (os !== "linux") return false;
        const exists = probe.fileExists ?? existsSync;
        const arch = probe.arch ?? process.arch;
        const loaders =
                arch === "arm64" ? ["/lib/ld-musl-aarch64.so.1"] : ["/lib/ld-musl-x86_64.so.1", "/lib/ld-musl-x86.so.1"];
        return loaders.some((p) => exists(p)) || exists("/etc/alpine-release");
}

/** Null when the platform may install the release archive, else the message
 *  the CLI prints. windows-arm64 ships un-smoked, so it is opt-in only. */
export function platformGate(input: {
        platform: ReleasePlatform | null;
        env?: NodeJS.ProcessEnv;
        metadataPlatform?: string;
        musl?: boolean;
}): string | null {
        const env = input.env ?? process.env;
        const { platform, metadataPlatform } = input;
        if (!platform) {
                return `this OS/arch is not a published release target (${process.platform}-${process.arch})`;
        }
        if (
                platform === "windows-arm64" &&
                metadataPlatform !== "windows-arm64" &&
                !/^(1|true|yes)$/i.test(env.UNOWN_ALLOW_EXPERIMENTAL ?? "")
        ) {
                return (
                        "windows-arm64 releases are experimental and un-smoked - " +
                        "set UNOWN_ALLOW_EXPERIMENTAL=1 to install one anyway"
                );
        }
        if (platform.startsWith("linux-") && input.musl) {
                return "the Linux release binaries require glibc; musl (Alpine) is not supported - build from source instead";
        }
        return null;
}

// ---------------------------------------------------------------------------
// Filesystem layout
// ---------------------------------------------------------------------------
function homeDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
        if (platform === "win32") return env.USERPROFILE || homedir();
        return env.HOME || homedir();
}

export function defaultInstallRoot(
        env: NodeJS.ProcessEnv = process.env,
        platform: NodeJS.Platform = process.platform,
): string {
        if (env.UNOWN_INSTALL_ROOT) return env.UNOWN_INSTALL_ROOT;
        const j = joinFor(platform);
        const home = homeDir(env, platform);
        if (platform === "win32") {
                const local = env.LOCALAPPDATA || j(home, "AppData", "Local");
                return j(local, "unown");
        }
        const dataHome = env.XDG_DATA_HOME || j(home, ".local", "share");
        return j(dataHome, "unown");
}

export function versionsDir(root: string): string {
        return join(root, "versions");
}

export function versionDir(root: string, version: string): string {
        return join(versionsDir(root), version.replace(/^v/, ""));
}

export function binaryName(platform: string): string {
        return platform === "win32" || platform.startsWith("windows") ? "unown.exe" : "unown";
}

export function binaryPath(root: string, version: string, platform: string): string {
        return join(versionDir(root, version), binaryName(platform));
}

/** `<root>/versions/<semver>/unown[.exe]` -> {root, version}; null otherwise.
 *  This is the strongest "we are the installed binary" signal: it comes from
 *  process.execPath, which is real in both runtime shapes. */
export function inferBinaryLayout(
        execPath: string,
        platform: NodeJS.Platform = process.platform,
): { root: string; version: string } | null {
        const name = basename(execPath);
        if (!/^unown(\.exe)?$/i.test(name)) return null;
        const vdir = dirname(execPath);
        const version = basename(vdir);
        if (!parseSemver(version)) return null;
        const parent = dirname(vdir);
        if (basename(parent).toLowerCase() !== "versions") return null;
        return { root: dirname(parent), version };
}

// ---------------------------------------------------------------------------
// Metadata (~/.unown/install.json — a record of the ACTIVE install)
// ---------------------------------------------------------------------------
export function installMetadataPath(home: string): string {
        return join(home, "install.json");
}

function isString(v: unknown): v is string {
        return typeof v === "string" && v.length > 0;
}

/** Validate shape and schema; null for corrupt/missing/foreign versions.
 *  Acceptance rule shared with the two installer readers: schema must be 1 and
 *  the mode must name a known channel. `source` is the pre-release spelling of
 *  `checkout` — install.sh and install.ps1 already fold it, and a record that
 *  old installer wrote has to resolve here too, or `unown update` reports it
 *  cannot determine the install mode on a machine that installs fine. */
export function validateInstallMetadata(raw: unknown): InstallMetadata | null {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
        const o = raw as Record<string, unknown>;
        if (o.schema !== 1) return null;
        if (o.mode !== "checkout" && o.mode !== "binary" && o.mode !== "source") return null;
        const mode: InstallMode = o.mode === "source" ? "checkout" : o.mode;
        if (!isString(o.version) || !parseSemver(o.version) || !isString(o.root) || !isString(o.bin) || !isString(o.shim))
                return null;
        if (!isString(o.installedAt)) return null;
        if (o.platform !== undefined && o.platform !== null && !isString(o.platform)) return null;
        if (o.previousVersion !== undefined && o.previousVersion !== null && !isString(o.previousVersion)) return null;
        if (isString(o.previousVersion) && !parseSemver(o.previousVersion)) return null;
        return {
                schema: 1,
                mode,
                version: o.version,
                ...(o.platform ? { platform: o.platform } : {}),
                root: o.root,
                bin: o.bin,
                shim: o.shim,
                ...(o.previousVersion ? { previousVersion: o.previousVersion } : {}),
                installedAt: o.installedAt,
        };
}

export function readInstallMetadata(home: string): InstallMetadata | null {
        try {
                return validateInstallMetadata(JSON.parse(readFileSync(installMetadataPath(home), "utf8")));
        } catch {
                return null;
        }
}

/** Atomic (temp file in the same directory + rename); never leaves a partial
 *  install.json behind a failed write. */
export function writeInstallMetadata(home: string, meta: InstallMetadata): void {
        mkdirSync(home, { recursive: true });
        const target = installMetadataPath(home);
        const tmp = join(home, `.install.json.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
        writeFileSync(tmp, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
        try {
                renameSync(tmp, target);
        } catch (err) {
                // Windows can briefly refuse to replace a file another process
                // has open; one remove+retry is the whole fallback.
                try {
                        rmSync(target, { force: true });
                        renameSync(tmp, target);
                } catch {
                        rmSync(tmp, { force: true });
                        throw err;
                }
        }
}

// ---------------------------------------------------------------------------
// Shims
// ---------------------------------------------------------------------------
export interface ShimPaths {
        dir: string;
        primary: string;
        all: string[];
}

export function shimPaths(
        env: NodeJS.ProcessEnv = process.env,
        platform: NodeJS.Platform = process.platform,
): ShimPaths {
        const j = joinFor(platform);
        const dir = env.UNOWN_BIN_DIR || j(homeDir(env, platform), ".local", "bin");
        if (platform === "win32") {
                const all = [j(dir, "unown.cmd"), j(dir, "unown.ps1")];
                return { dir, primary: all[0], all };
        }
        const primary = j(dir, "unown");
        return { dir, primary, all: [primary] };
}

/** POSIX shell double-quote escaping for embedded paths. */
function posixQuote(s: string): string {
        return s.replace(/(["\\$`])/g, "\\$1");
}

function cmdQuote(s: string): string {
        // `%` expands inside quotes in cmd.exe; `%%` is its literal form.
        return s.replace(/%/g, "%%");
}

function psQuote(s: string): string {
        return s.replace(/'/g, "''");
}

export function renderPosixShim(opts: {
        command: string;
        args?: string[];
        env?: Record<string, string>;
        header?: string[];
}): string {
        const lines = ["#!/bin/sh"];
        if (opts.header?.length) for (const line of opts.header) lines.push(`# ${line}`);
        for (const [k, v] of Object.entries(opts.env ?? {})) lines.push(`export ${k}="${posixQuote(v)}"`);
        const argv = [opts.command, ...(opts.args ?? [])].map((a) => `"${posixQuote(a)}"`).join(" ");
        lines.push(`exec ${argv} "$@"`);
        return `${lines.join("\n")}\n`;
}

export function renderWindowsCmdShim(opts: { command: string; args?: string[]; env?: Record<string, string> }): string {
        const lines: string[] = [];
        for (const [k, v] of Object.entries(opts.env ?? {})) lines.push(`@set "${k}=${cmdQuote(v)}"`);
        const argv = [opts.command, ...(opts.args ?? [])].map((a) => `"${cmdQuote(a)}"`).join(" ");
        lines.push(`@${argv} %*`);
        return `${lines.join("\n")}\n`;
}

export function renderWindowsPs1Shim(opts: { command: string; args?: string[]; env?: Record<string, string> }): string {
        const lines: string[] = [];
        for (const [k, v] of Object.entries(opts.env ?? {})) lines.push(`$env:${k} = '${psQuote(v)}'`);
        const argv = [opts.command, ...(opts.args ?? [])].map((a) => `'${psQuote(a)}'`).join(" ");
        lines.push(`& ${argv} @args; exit $LASTEXITCODE`);
        return `${lines.join("\n")}\n`;
}

/** Write a file via a same-directory temp + rename, so a crash or a failed
 *  write never leaves a half-written shim on PATH. */
function writeFileAtomic(file: string, content: string, mode?: number): void {
        const tmp = `${file}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
        writeFileSync(tmp, content, mode === undefined ? undefined : { mode });
        try {
                renameSync(tmp, file);
        } catch (err) {
                // Windows refuses a rename over an existing file; one remove+retry
                // is the whole fallback (the on-disk shim is replaced, not appended).
                try {
                        rmSync(file, { force: true });
                        renameSync(tmp, file);
                } catch {
                        rmSync(tmp, { force: true });
                        throw err;
                }
        }
}

/** Write the platform-appropriate shim set into `dir`. Returns the paths; the
 *  caller decides what to log. POSIX shims get mode 0755. */
export function writeShimSet(opts: {
        dir: string;
        platform?: NodeJS.Platform;
        command: string;
        args?: string[];
        env?: Record<string, string>;
        header?: string[];
}): { primary: string; all: string[] } {
        const platform = opts.platform ?? process.platform;
        mkdirSync(opts.dir, { recursive: true });
        if (platform === "win32") {
                const cmd = join(opts.dir, "unown.cmd");
                const ps1 = join(opts.dir, "unown.ps1");
                writeFileAtomic(cmd, renderWindowsCmdShim(opts));
                writeFileAtomic(ps1, renderWindowsPs1Shim(opts));
                return { primary: cmd, all: [cmd, ps1] };
        }
        const shim = join(opts.dir, "unown");
        writeFileAtomic(shim, renderPosixShim(opts), 0o755);
        try {
                chmodSync(shim, 0o755);
        } catch {
                // filesystem without POSIX modes — best effort
        }
        return { primary: shim, all: [shim] };
}

/** Rewrite the shims for a binary install to point at one versioned binary. */
export function writeBinaryShims(opts: {
        root: string;
        version: string;
        platform?: NodeJS.Platform;
        env?: NodeJS.ProcessEnv;
}): { primary: string; all: string[]; binary: string } {
        const platform = opts.platform ?? process.platform;
        const env = opts.env ?? process.env;
        const paths = shimPaths(env, platform);
        const binary = binaryPath(opts.root, opts.version, platform);
        const written = writeShimSet({
                dir: paths.dir,
                platform,
                command: binary,
                env: { UNOWN_INSTALL_ROOT: opts.root },
                header: [
                        "unown shim - created by unown (binary install); rewritten by `unown update`.",
                        "It execs the active version under UNOWN_INSTALL_ROOT/versions/.",
                ],
        });
        return { ...written, binary };
}

/** The filesystem's own spelling of a path, for IDENTITY comparisons only.
 *  One directory has several spellings — macOS `/var` is `/private/var`,
 *  Windows 8.3 short names (`RUNNER~1`) and junctions resolve to the long
 *  target — and a shim written with one spelling must still be recognized when
 *  uninstall resolves the other from `process.execPath` (measured on the macOS
 *  CI leg, 2026-10-23: the shim was called foreign and left on PATH). A path
 *  that does not exist falls back to its parent's canonical form + basename,
 *  then to the spelling given, so a broken shim target never matches by luck. */
export function canonicalPath(p: string): string {
        try {
                return realpathSync.native(p);
        } catch {
                try {
                        return join(realpathSync.native(dirname(p)), basename(p));
                } catch {
                        return p;
                }
        }
}

function normalizePathForCompare(p: string, platform: NodeJS.Platform): string {
        // Only the running OS can resolve its own spellings; a layout or fixture
        // computed for another platform stays a string comparison.
        const s = (platform === process.platform ? canonicalPath(p) : p)
                .replace(/\\/g, "/")
                .replace(/\/+$/, "");
        return platform === "win32" ? s.toLowerCase() : s;
}

/** True when a shim's embedded executable path (or its UNOWN_INSTALL_ROOT)
 *  points into `root`. Foreign shims are never removed by an uninstall. */
export function shimTargetsRoot(content: string, root: string, platform: NodeJS.Platform = process.platform): boolean {
        const target = normalizePathForCompare(root, platform);
        const candidates: string[] = [];
        for (const m of content.matchAll(/["']([^"']+)["']/g)) candidates.push(m[1]);
        // PowerShell/UNOWN_INSTALL_ROOT assignments without quotes are rare, but
        // `export UNOWN_INSTALL_ROOT=$HOME/.local/share/unown` is legal sh.
        for (const m of content.matchAll(/UNOWN_INSTALL_ROOT\s*[=:]\s*([^\s"';]+)/g)) candidates.push(m[1]);
        return candidates.some((c) => {
                // The absoluteness gate must answer for the SHIM's platform, not the
                // host's: `C:\repos\Unown\bin\unown` is absolute on Windows and
                // relative-shaped on a POSIX host — node:path's isAbsolute is bound to
                // the RUNNING platform, so the Linux/macOS CI legs (and every
                // platform-injected win32 test) rejected the install's own shim as a
                // foreign non-absolute path before normalization ever ran. (The same
                // class as the 2efb970 realpath fix: compare by the target platform's
                // semantics.)
                const abs = platform === "win32" ? win32.isAbsolute(c) : posix.isAbsolute(c);
                if (!abs) return false;
                const n = normalizePathForCompare(c, platform);
                return n === target || n.startsWith(`${target}/`);
        });
}

// ---------------------------------------------------------------------------
// Release feed
// ---------------------------------------------------------------------------
export const DEFAULT_RELEASES_BASE = "https://github.com/kanishka-namdeo/Unown/releases";

export function releasesBase(env: NodeJS.ProcessEnv = process.env): string {
        return (env.UNOWN_RELEASES_BASE_URL || DEFAULT_RELEASES_BASE).replace(/\/+$/, "");
}

/** Strip credentials from a remote/base URL before it is printed or cached
 *  (`https://user:token@host/path` → `https://host/path`). A mirror may carry
 *  credentials; the state file and console must never. */
export function redactUrl(url: string): string {
        return url.replace(/^(https?:\/\/|ssh:\/\/)[^@/\s]+@/, "$1");
}

export function normalizeVersion(version: string): string {
        return version.trim().replace(/^v/, "");
}

export function versionTxtUrl(base: string): string {
        return `${base}/latest/download/version.txt`;
}

export function archiveName(platform: ReleasePlatform): string {
        return `unown-${platform}${platform.startsWith("windows") ? ".zip" : ".tar.gz"}`;
}

export function assetUrl(base: string, platform: ReleasePlatform, version?: string): string {
        const name = archiveName(platform);
        if (version) return `${base}/download/v${normalizeVersion(version)}/${name}`;
        return `${base}/latest/download/${name}`;
}

export function checksumsUrl(base: string, version?: string): string {
        if (version) return `${base}/download/v${normalizeVersion(version)}/sha256sums.txt`;
        return `${base}/latest/download/sha256sums.txt`;
}

/** The release manifest URL. The filename literal also lives in
 *  release-manifest.ts; a test pins them. */
export function releaseManifestUrl(base: string, version?: string): string {
        if (version) return `${base}/download/v${normalizeVersion(version)}/release.json`;
        return `${base}/latest/download/release.json`;
}


// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------
/** SHA-256 of a file, streamed in 1 MiB chunks (release archives are ~90 MiB). */
export function sha256File(path: string): string {
        const hash = createHash("sha256");
        const fd = openSync(path, "r");
        try {
                const buf = Buffer.allocUnsafe(1024 * 1024);
                for (;;) {
                        const n = readSync(fd, buf, 0, buf.length, null);
                        if (n <= 0) break;
                        hash.update(buf.subarray(0, n));
                }
        } finally {
                closeSync(fd);
        }
        return hash.digest("hex");
}

/** Find the checksum line for `fileName` in a sha256sums.txt body
 *  (`<64 hex>  <name>`, optionally ` *name`). */
export function parseChecksumFor(text: string, fileName: string): string | null {
        const want = fileName.split(/[\\/]/).pop();
        for (const line of text.split(/\r?\n/)) {
                const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
                if (!m) continue;
                if (m[2].split(/[\\/]/).pop() === want) return m[1].toLowerCase();
        }
        return null;
}

// ---------------------------------------------------------------------------
// Cheap mode signal (no git): used by the notifier and the uninstaller
// ---------------------------------------------------------------------------
export function cheapInstallMode(opts: {
        env?: NodeJS.ProcessEnv;
        execPath?: string;
        platform?: NodeJS.Platform;
        metadata?: InstallMetadata | null;
}): InstallMode | null {
        const env = opts.env ?? process.env;
        const platform = opts.platform ?? process.platform;
        if (inferBinaryLayout(opts.execPath ?? process.execPath, platform)) return "binary";
        if (env.UNOWN_INSTALL_ROOT) return "binary";
        if (opts.metadata) return opts.metadata.mode;
        return null;
}
