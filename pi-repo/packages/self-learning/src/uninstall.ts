/**
 * uninstall.ts — `unown uninstall`: reverse of the install path.
 *
 * What the installer did (scripts/link.ts + scripts/install.ts):
 *   1. wrote a PATH shim (~/.local/bin/unown on POSIX; %USERPROFILE%\.local\bin
 *      unown.cmd + unown.ps1 on Windows) pointing INTO this checkout
 *   2. created ~/.unown state (agent config, memory, notes)
 *   3. node_modules + builds inside the checkout
 *
 * Uninstall removes (1) by default — only shims that point into THIS
 * checkout; a shim belonging to another checkout is reported, never touched
 * (the multi-install shadowing case). ~/.unown (user memories!) is kept
 * unless --purge-data. The checkout itself is kept unless --purge-checkout
 * (it may contain uncommitted work — the same never-discard rule the
 * updater applies). PATH registry entries the installer added on Windows
 * are left in place (removing PATH entries from the registry for a dir that
 * may host other tools is riskier than the residue); the summary prints the
 * one-line manual cleanup instead.
 *
 * `--dry-run` lists everything and changes nothing. Exit 0 on success,
 * 1 when nothing removable was found or a guard refused.
 *
 * Patterns: rustup `self uninstall` (confirmation + PATH cleanup + summary),
 * opencode `uninstall --keep-config/--keep-data`, Claude Code's
 * per-method uninstall docs. Flags are explicit and non-interactive on
 * purpose — no prompts in pipes.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { installMetadataPath, readInstallMetadata, shimTargetsRoot, type InstallMode } from "./install-layout.ts";
import { readRootVersion, redactUrl, resolveInstallInfo, type InstallInfo, unownHome } from "./update.ts";

export interface UninstallFlags {
        dryRun?: boolean;
        purgeData?: boolean;
        purgeCheckout?: boolean;
        help?: boolean;
}

export const UNINSTALL_HELP = `unown uninstall — remove the unown CLI from this machine

Usage:
  unown uninstall                remove the shims (and, for a binary install,
                                 the versioned root under UNOWN_INSTALL_ROOT)
  unown uninstall --dry-run      list what would be removed; change nothing
  unown uninstall --purge-data   also delete ~/.unown (agent config, memories, notes)
  unown uninstall --purge-checkout   also delete the repo checkout itself
  unown uninstall --purge-all   both

Checkout install (git clone + agent:install): removes ONLY the shims
(macOS/Linux: ~/.local/bin/unown or the dir UNOWN_BIN_DIR points at;
Windows: %USERPROFILE%\\.local\\bin\\unown.cmd + unown.ps1) — and only when
they point into THIS checkout; shims of other installs are reported and
left alone.

Binary install (standalone release download): removes the shims that point
into this install root, then the versioned root itself
(<root>/versions/<version>...). The previous versions kept for rollback go
too. No git checks run.

Kept by default in both modes: ~/.unown (your memories and notes — pass
--purge-data) and a checkout (pass --purge-checkout; refuses when it has
uncommitted changes or a dirty git tree, so no work is ever discarded).

Manual leftovers: the bin directory may remain on your PATH (harmless);
remove the line from your shell profile if you want it gone.`;

/** Parse `unown uninstall` flags (dispatched before the generic parser). */
export function parseUninstallFlags(argv: string[]): { flags: UninstallFlags; error?: string } {
        const flags: UninstallFlags = {};
        for (const a of argv) {
                if (a === "--dry-run") flags.dryRun = true;
                else if (a === "--purge-data") flags.purgeData = true;
                else if (a === "--purge-checkout") flags.purgeCheckout = true;
                else if (a === "--purge-all") {
                        flags.purgeData = true;
                        flags.purgeCheckout = true;
                } else if (a === "--help" || a === "-h") flags.help = true;
                else return { flags, error: `unknown argument: ${a}` };
        }
        return { flags };
}

/** Candidate bin dirs searched for shims (mirrors scripts/link.ts). */
export function shimCandidateDirs(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
        const home = homedir();
        if (env.UNOWN_BIN_DIR) return [env.UNOWN_BIN_DIR];
        if (platform === "win32") return [join(home, ".local", "bin")];
        return [join(home, ".local", "bin"), join(home, "bin"), "/usr/local/bin"];
}

export interface BinaryShimHit {
        path: string;
        ours: boolean; // execs a binary inside this install root
}

/** Binary-install shims: ours iff the shim's embedded path is under `root`.
 *  A shim belonging to another install root is reported, never deleted. */
export function findInstallShims(
        root: string,
        env: NodeJS.ProcessEnv = process.env,
        platform: NodeJS.Platform = process.platform,
        extraDirs: string[] = [],
): BinaryShimHit[] {
        const dirs = [...shimCandidateDirs(env, platform)];
        for (const d of extraDirs) if (!dirs.includes(d)) dirs.push(d);
        const names = platform === "win32" ? ["unown.cmd", "unown.ps1"] : ["unown"];
        const hits: BinaryShimHit[] = [];
        for (const dir of dirs) {
                for (const name of names) {
                        const p = join(dir, name);
                        if (!existsSync(p)) continue;
                        try {
                                if (!statSync(p).isFile()) continue;
                        } catch {
                                continue;
                        }
                        try {
                                const content = readFileSync(p, "utf8");
                                hits.push({ path: p, ours: shimTargetsRoot(content, root, platform) });
                        } catch {
                                hits.push({ path: p, ours: false });
                        }
                }
        }
        return hits;
}

export interface ShimHit {
        path: string;
        ours: boolean; // points into this checkout
        target?: string; // the checkout bin/unown the shim execs
}

/** Read a shim file and extract the repo path it points at, if any.
 *  Windows shims (backslash separators) match FIRST so they are not
 *  captured and forward-slash-normalized by the POSIX pattern.
 *  Both quote styles are accepted because that is what the producer writes:
 *  `install-layout.ts` renders `.cmd` with double quotes and `.ps1` with
 *  single quotes (PowerShell's call-operator idiom). A double-quote-only
 *  parser made `unown uninstall` report its own `.ps1` shim as foreign and
 *  leave an orphan `unown` on PATH. */
export function shimTarget(content: string): string | null {
        // unown.cmd: @"bun" "<repo>\bin\unown" %*   /  unown.ps1: & 'bun' '<repo>\bin\unown' @args
        const win = /(["'])([^"']*bin\\unown)\1/.exec(content);
        if (win) return win[2];
        // POSIX shim: exec "<bun>" "<repo>/bin/unown" "$@"
        const posix = /(["'])([^"']*bin\/unown)\1/.exec(content);
        if (posix) return posix[2];
        return null;
}

/** Find every unown shim on the candidate dirs. Ours = target resolves into `repoRoot`. */
export function findShims(
        repoRoot: string,
        env: NodeJS.ProcessEnv = process.env,
        platform: NodeJS.Platform = process.platform,
): ShimHit[] {
        const hits: ShimHit[] = [];
        const names = platform === "win32" ? ["unown.cmd", "unown.ps1"] : ["unown"];
        for (const dir of shimCandidateDirs(env, platform)) {
                for (const name of names) {
                        const p = join(dir, name);
                        if (!existsSync(p)) continue;
                        try {
                                if (!statSync(p).isFile()) continue;
                        } catch {
                                continue;
                        }
                        let content = "";
                        try {
                                content = readFileSync(p, "utf8");
                        } catch {
                                hits.push({ path: p, ours: false });
                                continue;
                        }
                        const target = shimTarget(content);
                        const ours = target !== null && samePath(target, join(repoRoot, "bin", "unown"));
                        hits.push({ path: p, ours, target: target ?? undefined });
                }
        }
        return hits;
}

function samePath(a: string, b: string): boolean {
        const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
        return norm(a) === norm(b);
}

/** The checkout has uncommitted work? (untracked-or-modified, like the updater guard) */
export function checkoutHasUncommittedWork(repoRoot: string): boolean {
        const r = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
                cwd: repoRoot,
                encoding: "utf8",
                timeout: 30_000,
        });
        if (r.status !== 0) return true; // not a git repo / git broken — treat as "careful"
        return (r.stdout ?? "").trim() !== "";
}

export interface UninstallCtx {
        repoRoot?: string;
        home?: string;
        env?: NodeJS.ProcessEnv;
        log?: (line: string) => void;
        removeFile?: (p: string) => void; // injected for tests
        removeDir?: (p: string) => void; // injected for tests
        hasUncommitted?: (repoRoot: string) => boolean;
        /** Force the mode / binary root (tests and callers that already probed). */
        install?: InstallInfo;
        mode?: InstallMode;
        installRoot?: string;
        version?: string;
        platform?: NodeJS.Platform;
        execPath?: string;
}

/** Run the uninstall. Returns the process exit code. */
export function cmdUninstall(flags: UninstallFlags, ctx: UninstallCtx = {}): number {
        const log = ctx.log ?? ((l: string) => console.log(l));
        const env = ctx.env ?? process.env;
        const home = ctx.home ?? unownHome(env);
        const platform = ctx.platform ?? process.platform;
        const removeFile = ctx.removeFile ?? ((p: string) => rmSync(p, { force: true }));
        const removeDir = ctx.removeDir ?? ((p: string) => rmSync(p, { recursive: true, force: true }));
        const hasUncommitted = ctx.hasUncommitted ?? checkoutHasUncommittedWork;

        const info =
                ctx.install ??
                (ctx.mode === "binary"
                        ? {
                                  mode: "binary" as const,
                                  root: ctx.installRoot ?? env.UNOWN_INSTALL_ROOT ?? "",
                                  version: ctx.version ?? readInstallMetadata(home)?.version ?? "unknown",
                          }
                        : resolveInstallInfo({ env, home, root: ctx.repoRoot, execPath: ctx.execPath, platform }));
        const mode: InstallMode = ctx.mode ?? info?.mode ?? readInstallMetadata(home)?.mode ?? "checkout";
        if (mode === "binary") {
                const meta = readInstallMetadata(home);
                const root = ctx.installRoot || info?.root || (meta?.mode === "binary" ? meta.root : "") || env.UNOWN_INSTALL_ROOT;
                if (!root) {
                        log("unown: no binary install root found — nothing to uninstall");
                        return 1;
                }
                return cmdUninstallBinary(flags, {
                        root,
                        version: ctx.version ?? info?.version ?? meta?.version ?? "unknown",
                        home,
                        env,
                        platform,
                        log,
                        removeFile,
                        removeDir,
                        shimHint: meta?.mode === "binary" ? meta.shim : undefined,
                });
        }

        const repoRoot = ctx.repoRoot ?? (info?.mode === "checkout" ? info.root : null) ?? resolveRepoRootBestEffort();

        if (flags.dryRun) log("· dry run — nothing will be changed");
        const version = repoRoot ? readRootVersion(repoRoot) : "unknown";
        log(`unown ${version} uninstall${repoRoot ? ` — checkout: ${repoRoot}` : " (checkout not found)"}`);
        log("");

        // 1. shims
        const shims = repoRoot ? findShims(repoRoot, env) : [];
        let removed = 0;
        for (const s of shims) {
                if (s.ours) {
                        log(`${flags.dryRun ? "would remove" : "removed"}  ${s.path}`);
                        if (!flags.dryRun) removeFile(s.path);
                        removed++;
                } else {
                        log(
                                `skipped   ${s.path} — points at ${s.target ? redactPath(s.target) : "an unknown install"} (not this checkout)`,
                        );
                }
        }
        if (!shims.length) log("no unown shims found in the standard bin dirs");

        // 2. user data
        if (flags.purgeData) {
                if (existsSync(home)) {
                        log(`${flags.dryRun ? "would remove" : "removed"}  ${home} (agent config, memories, notes)`);
                        if (!flags.dryRun) removeDir(home);
                } else {
                        log(`· ${home} does not exist — nothing to purge`);
                }
        } else {
                log(`kept      ${home} — your memories/notes (pass --purge-data to delete)`);
        }

        // 3. the checkout
        if (flags.purgeCheckout) {
                if (!repoRoot) {
                        log("✗ no checkout found — cannot purge what is not there");
                        return 1;
                }
                if (hasUncommitted(repoRoot)) {
                        log(`✗ refusing --purge-checkout: ${repoRoot} has uncommitted work`);
                        log("  commit or stash it, delete the folder by hand, then re-run for the leftovers");
                        return 1;
                }
                log(`${flags.dryRun ? "would remove" : "removed"}  ${repoRoot} (the checkout)`);
                if (!flags.dryRun) removeDir(repoRoot);
        } else if (repoRoot) {
                log(`kept      ${repoRoot} — the checkout (pass --purge-checkout to delete)`);
        }

        log("");
        if (!flags.dryRun) {
                log(
                        removed > 0
                                ? "✓ unown uninstalled (any running sessions keep using memory until they exit)"
                                : "· nothing was removed",
                );
                log("  PATH residue: the bin dir may remain on PATH — remove its line from your shell profile if desired.");
        }
        return 0;
}

interface BinaryUninstallOptions {
        root: string;
        version: string;
        home: string;
        env: NodeJS.ProcessEnv;
        platform: NodeJS.Platform;
        log: (line: string) => void;
        removeFile: (p: string) => void;
        removeDir: (p: string) => void;
        shimHint?: string;
}

/** Binary uninstall: shims that point into THIS root, then the versioned root.
 *  No git is consulted — a binary install has no checkout to protect. */
function cmdUninstallBinary(flags: UninstallFlags, opts: BinaryUninstallOptions): number {
        const { log, root, home, env, platform } = opts;
        if (flags.dryRun) log("· dry run — nothing will be changed");
        log(`unown ${opts.version} uninstall — binary install: ${root}`);
        log("");

        const extraDirs = opts.shimHint ? [join(opts.shimHint, "..")] : [];
        const shims = findInstallShims(root, env, platform, extraDirs);
        let removed = 0;
        for (const s of shims) {
                if (s.ours) {
                        log(`${flags.dryRun ? "would remove" : "removed"}  ${s.path}`);
                        if (!flags.dryRun) opts.removeFile(s.path);
                        removed++;
                } else {
                        log(`skipped   ${s.path} — points at a different unown install`);
                }
        }
        if (!shims.length) log("no unown shims found in the standard bin dirs");

        // The versioned root is the install: remove it by default. A running
        // .exe on Windows refuses deletion, which is reported instead of hidden.
        if (existsSync(root)) {
                log(`${flags.dryRun ? "would remove" : "removed"}  ${root} (versioned binaries, including rollback copies)`);
                if (!flags.dryRun) {
                        try {
                                opts.removeDir(root);
                                removed++;
                        } catch (err) {
                                log(`✗ could not remove ${root} — ${err instanceof Error ? err.message : String(err)}`);
                                log("  close any running unown processes, then re-run unown uninstall");
                                return 1;
                        }
                } else {
                        removed++;
                }
        } else {
                log(`· ${root} does not exist — no versioned binaries to remove`);
        }

        // Metadata records the ACTIVE install; once the root is gone it must not
        // survive to claim a binary that no longer exists.
        const metaPath = installMetadataPath(home);
        if (flags.purgeData) {
                if (existsSync(home)) {
                        log(`${flags.dryRun ? "would remove" : "removed"}  ${home} (agent config, memories, notes, install.json)`);
                        if (!flags.dryRun) opts.removeDir(home);
                } else {
                        log(`· ${home} does not exist — nothing to purge`);
                }
        } else {
                if (existsSync(metaPath)) {
                        log(`${flags.dryRun ? "would remove" : "removed"}  ${metaPath} (install record)`);
                        if (!flags.dryRun) opts.removeFile(metaPath);
                }
                log(`kept      ${home} — your memories/notes (pass --purge-data to delete)`);
        }

        if (flags.purgeCheckout) {
                log("· --purge-checkout: a binary install has no checkout; the versioned root was removed above");
        }

        log("");
        if (!flags.dryRun) {
                log(
                        removed > 0
                                ? "✓ unown uninstalled (any running sessions keep using memory until they exit)"
                                : "· nothing was removed",
                );
                log("  PATH residue: the bin dir may remain on PATH — remove its line from your shell profile if desired.");
        }
        return 0;
}

function resolveRepoRootBestEffort(): string | null {
        const guess = join(import.meta.dir, "..", "..", "..", "..");
        if (!existsSync(guess)) return null;
        const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: guess, encoding: "utf8", timeout: 30_000 });
        return r.status === 0 && (r.stdout ?? "").trim() ? (r.stdout ?? "").trim() : guess;
}

/** Home paths may contain the username; shims may contain anything — keep output lean. */
function redactPath(p: string): string {
        return redactUrl(p); // credential-shaped substrings only; paths pass through
}
