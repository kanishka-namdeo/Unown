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
 * updater applies), and a --purge-checkout that actually deletes the checkout
 * also clears the ~/.unown/install.json record naming it, because mode
 * detection falls back to that file and must not resolve a deleted root.
 * PATH registry entries the installer added on Windows
 * are left in place (removing PATH entries from the registry for a dir that
 * may host other tools is riskier than the residue); the summary prints the
 * one-line manual cleanup instead.
 *
 * `--dry-run` lists everything and changes nothing. Exit 0 on success,
 * 1 when nothing removable was found or a guard refused.
 *
 * Windows self-delete: a binary install's shim execs
 * `<root>/versions/<v>/unown.exe`, so the uninstall process IS the install —
 * and Windows refuses to delete a running image (EPERM, measured 2026-10-23 on
 * Windows 10.0.29683). The root therefore goes through
 * `scheduleWindowsRootRemoval` (a detached `cmd` helper that retries until the
 * process is gone) instead of `rmSync`. POSIX unlinks a running image happily
 * (measured on Linux 6.x, 2026-10-23: the mapped image's root directory was
 * removed while the process ran), so its removal stays synchronous.
 *
 * Failure contract, every platform and both modes: the install root (binary
 * root or `--purge-checkout`) is removed BEFORE the shims, so a failure leaves
 * a runnable command; every removal is attempted and reported per path, never
 * thrown, so a lock cannot abort an uninstall halfway through and the exit code
 * is 1 whenever anything was left behind.
 *
 * Patterns: rustup `self uninstall` (confirmation + PATH cleanup + summary),
 * opencode `uninstall --keep-config/--keep-data`, Claude Code's
 * per-method uninstall docs. Flags are explicit and non-interactive on
 * purpose — no prompts in pipes.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, posix, win32 } from "node:path";
import { runGitSync } from "./gittools.ts";
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
left alone. With --purge-checkout the ~/.unown/install.json record that names
this checkout goes with it, so no install is recorded at a deleted path.

Binary install (standalone release download): removes the versioned root
(<root>/versions/<version>..., including the rollback copies) and the shims
that point into it. No git checks run. On Windows the running unown.exe
locks its own folder, so the root is deleted by a short-lived background
helper the moment this command exits — the shims and the install record go
right away. Cd out of the install root before running it.

Kept by default in both modes: ~/.unown (your memories and notes — pass
--purge-data) and a checkout (pass --purge-checkout; refuses when it has
uncommitted changes or a dirty git tree, and when the current directory is
inside it, so no work is ever discarded).

A removal that fails (a running session holding its state open, permissions)
is reported per path and the command exits 1; whatever could be removed stays
removed, and the install stays runnable until its own root is gone.

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

/** Removal failures are reported per path, never thrown: a locked file must not
 *  abort an uninstall that has already deleted other things. */
function errMessage(err: unknown): string {
        return err instanceof Error ? err.message : String(err);
}

/** Is `child` at or below `parent`? Windows comparisons are case-insensitive,
 *  and both sides are normalized with the PLATFORM's own rules so the check is
 *  testable off-platform. A sibling whose name merely shares a prefix
 *  (`...\unown-old` vs `...\unown`) is not inside. */
export function pathInside(child: string, parent: string, platform: NodeJS.Platform = process.platform): boolean {
        const norm = (p: string): string => {
                const n = (platform === "win32" ? win32.normalize(p) : posix.normalize(p))
                        .replace(/\\/g, "/")
                        .replace(/\/+$/, "");
                return platform === "win32" ? n.toLowerCase() : n;
        };
        const c = norm(child);
        const p = norm(parent);
        return c === p || c.startsWith(`${p}/`);
}

/** The batch script a binary uninstall leaves behind to delete its own install
 *  root. Windows refuses to delete a running image, and for a binary install
 *  the running image IS the install — so the removal has to outlive the
 *  process. `%` is doubled because batch expands it inside `set ""` too; the
 *  value is re-quoted at every use, so `&`, `^`, `|` and friends stay literal. */
export function renderWindowsRemovalScript(root: string, maxTries = 30): string {
        const target = root.replace(/%/g, "%%");
        return [
                "@echo off",
                "setlocal",
                `set "UNOWN_TARGET=${target}"`,
                "set /a UNOWN_TRIES=0",
                ":unown_retry",
                'if not exist "%UNOWN_TARGET%" goto unown_done',
                'rmdir /s /q "%UNOWN_TARGET%" >nul 2>&1',
                'if not exist "%UNOWN_TARGET%" goto unown_done',
                "set /a UNOWN_TRIES+=1",
                `if %UNOWN_TRIES% geq ${maxTries} goto unown_stuck`,
                "rem ping is the portable one-second sleep; timeout refuses a redirected stdin",
                "ping -n 2 127.0.0.1 >nul",
                "goto unown_retry",
                ":unown_stuck",
                '(goto) 2>nul & del /f /q "%~f0"',
                ":unown_done",
                '(goto) 2>nul & del /f /q "%~f0"',
                "",
        ].join("\r\n");
}

export interface RemovalSchedule {
        scriptPath: string;
}

/** Spawn the detached helper that deletes `root` once this process is gone.
 *  Writing the script under a random name in the temp dir (exclusive create),
 *  and running `cmd` with that directory as cwd and a RELATIVE script name,
 *  keeps every path out of `cmd`'s command line — no quoting or metacharacter
 *  surface at all. */
export function scheduleWindowsRootRemoval(
        root: string,
        opts: { tmpDir?: string; maxTries?: number; spawnImpl?: typeof spawn } = {},
): RemovalSchedule {
        const dir = opts.tmpDir ?? tmpdir();
        const scriptPath = join(dir, `unown-uninstall-${randomBytes(8).toString("hex")}.cmd`);
        writeFileSync(scriptPath, renderWindowsRemovalScript(root, opts.maxTries ?? 30), {
                encoding: "utf8",
                flag: "wx",
        });
        const child = (opts.spawnImpl ?? spawn)(
                process.env.ComSpec || "cmd.exe",
                ["/d", "/s", "/c", basename(scriptPath)],
                { cwd: dir, detached: true, stdio: "ignore", windowsHide: true },
        );
        // Fire-and-forget: if the helper cannot start, the root is left for a
        // later manual delete — still better than having deleted the shims for
        // an install that is about to fail.
        child.on("error", () => {});
        child.unref();
        return { scriptPath };
}

/** The checkout has uncommitted work? (untracked-or-modified, like the updater guard)
 *
 *  Runs in the UNOWN CHECKOUT (trusted cwd — never a user project dir), but
 *  hardened anyway via the shared read-only helper: `git status` is the exact
 *  verb the GitSpawn disclosure (September 2026,
 *  https://shattered.io/gitspawn-ai-coding-agent-vulnerability-2026/) used to
 *  execute a repo-local `core.fsmonitor` binary outside any sandbox, and a
 *  `--purge-checkout` decision made on fsmonitor-poisoned output is not a
 *  decision we want to make on attacker-controlled state. */
export function checkoutHasUncommittedWork(repoRoot: string): boolean {
        const r = runGitSync(repoRoot, ["status", "--porcelain", "--untracked-files=normal"], { readOnly: true, timeoutMs: 30_000 });
        if (r.code !== 0) return true; // not a git repo / git broken — treat as "careful"
        return r.stdout.trim() !== "";
}

export interface UninstallCtx {
        repoRoot?: string;
        home?: string;
        env?: NodeJS.ProcessEnv;
        log?: (line: string) => void;
        removeFile?: (p: string) => void; // injected for tests
        removeDir?: (p: string) => void; // injected for tests
        /** Windows self-delete seam: schedule the root's removal (default: the real helper). */
        scheduleRemoval?: (root: string) => RemovalSchedule;
        cwd?: () => string;
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
        const cwd = ctx.cwd ?? (() => {
                try {
                        return process.cwd();
                } catch {
                        return ""; // the cwd can itself be gone; that is not a refused purge
                }
        });
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
                        execPath: ctx.execPath ?? process.execPath,
                        cwd,
                        scheduleRemoval: ctx.scheduleRemoval ?? ((r) => scheduleWindowsRootRemoval(r)),
                        shimHint: meta?.mode === "binary" ? meta.shim : undefined,
                });
        }

        const repoRoot = ctx.repoRoot ?? (info?.mode === "checkout" ? info.root : null) ?? resolveRepoRootBestEffort();

        if (flags.dryRun) log("· dry run — nothing will be changed");
        const version = repoRoot ? readRootVersion(repoRoot) : "unknown";
        log(`unown ${version} uninstall${repoRoot ? ` — checkout: ${repoRoot}` : " (checkout not found)"}`);
        log("");

        // Guards run before ANY removal. A refusal must leave the install
        // runnable — that is the whole contract the 2026-10-23 Windows report
        // broke by deleting the shims first and failing afterwards.
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
                if (pathInside(cwd(), repoRoot)) {
                        log(`✗ the current directory (${cwd()}) is inside the checkout`);
                        log("  cd out of it first — Windows cannot delete a folder a shell sits in, and a POSIX shell left in a deleted tree loses its cwd");
                        return 1;
                }
        }

        const shims = repoRoot ? findShims(repoRoot, env) : [];
        const failures: string[] = [];
        let didRemove = false;

        // 1. the checkout goes FIRST, mirroring the binary root: deleting the
        //    shims before a purge that then fails leaves no command to re-run.
        if (flags.purgeCheckout && repoRoot) {
                const record = readInstallMetadata(home);
                const metaFile = installMetadataPath(home);
                if (flags.dryRun) {
                        log(`would remove  ${repoRoot} (the checkout)`);
                } else {
                        try {
                                removeDir(repoRoot);
                                log(`removed  ${repoRoot} (the checkout)`);
                                didRemove = true;
                        } catch (err) {
                                log(`✗ could not remove ${repoRoot} — ${errMessage(err)}`);
                                log("  nothing else was removed; close any process using it and re-run unown uninstall");
                                return 1;
                        }
                }

                // A deleted checkout must not stay recorded as the ACTIVE install —
                // `~/.unown/install.json` is the last fallback of mode detection, so a
                // surviving record makes every later run resolve a root that is gone.
                // Only a record naming THIS root goes; another install's is left alone,
                // exactly like a foreign shim. (--purge-data takes the home dir below,
                // and the refusal paths above returned before reaching here.)
                if (record && samePath(record.root, repoRoot)) {
                        log(`${flags.dryRun ? "would remove" : "removed"}  ${metaFile} — it named this checkout`);
                        if (!flags.dryRun) {
                                if (existsSync(metaFile)) {
                                        try {
                                                removeFile(metaFile);
                                        } catch (err) {
                                                failures.push(metaFile);
                                                log(`✗ could not remove ${metaFile} — ${errMessage(err)}`);
                                        }
                                }
                        }
                }
        } else if (repoRoot) {
                log(`kept      ${repoRoot} — the checkout (pass --purge-checkout to delete)`);
        }

        // 2. shims — a locked shim is reported, never a crash mid-uninstall
        for (const s of shims) {
                if (!s.ours) {
                        log(
                                `skipped   ${s.path} — points at ${s.target ? redactPath(s.target) : "an unknown install"} (not this checkout)`,
                        );
                        continue;
                }
                if (flags.dryRun) {
                        log(`would remove  ${s.path}`);
                        continue;
                }
                try {
                        removeFile(s.path);
                        log(`removed  ${s.path}`);
                        didRemove = true;
                } catch (err) {
                        failures.push(s.path);
                        log(`✗ could not remove ${s.path} — ${errMessage(err)}`);
                }
        }
        if (!shims.length) log("no unown shims found in the standard bin dirs");

        // 3. user data
        if (flags.purgeData) {
                if (existsSync(home)) {
                        if (flags.dryRun) {
                                log(`would remove  ${home} (agent config, memories, notes)`);
                        } else {
                                try {
                                        removeDir(home);
                                        log(`removed  ${home} (agent config, memories, notes)`);
                                        didRemove = true;
                                } catch (err) {
                                        failures.push(home);
                                        log(`✗ could not remove ${home} — ${errMessage(err)}`);
                                        log("  a running unown session can hold state here open — close it and re-run");
                                }
                        }
                } else {
                        log(`· ${home} does not exist — nothing to purge`);
                }
        } else {
                log(`kept      ${home} — your memories/notes (pass --purge-data to delete)`);
        }

        log("");
        if (!flags.dryRun) {
                if (failures.length) {
                        log(`✗ uninstall incomplete — ${failures.length} item(s) could not be removed (listed above)`);
                        log("  fix the cause, then re-run unown uninstall");
                        return 1;
                }
                log(
                        didRemove
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
        execPath: string;
        cwd: () => string;
        scheduleRemoval: (root: string) => RemovalSchedule;
        shimHint?: string;
}

/** Binary uninstall: shims that point into THIS root, then the versioned root.
 *  No git is consulted — a binary install has no checkout to protect.
 *
 *  Order matters as much as the operations: the root goes FIRST, so a failure
 *  leaves the shims in place and `unown uninstall` still runnable. When the
 *  running image is itself inside the root (always true on Windows, where the
 *  shim execs `<root>/versions/<v>/unown.exe`), Windows refuses the delete, and
 *  the root's removal is scheduled for a detached helper instead. */
function cmdUninstallBinary(flags: UninstallFlags, opts: BinaryUninstallOptions): number {
        const { log, root, home, env, platform } = opts;
        if (flags.dryRun) log("· dry run — nothing will be changed");
        log(`unown ${opts.version} uninstall — binary install: ${root}`);
        log("");

        const extraDirs = opts.shimHint ? [join(opts.shimHint, "..")] : [];
        const shims = findInstallShims(root, env, platform, extraDirs);
        const ours = shims.filter((s) => s.ours);
        const selfDelete = platform === "win32" && pathInside(opts.execPath, root, platform);

        if (selfDelete && existsSync(root) && pathInside(opts.cwd(), root, platform)) {
                log(`✗ the current directory (${opts.cwd()}) is inside ${root}`);
                log("  Windows cannot delete a folder a shell is sitting in — cd out of the install root, then re-run");
                return 1;
        }

        let removedRoot = false;
        let scheduledRoot = false;
        if (!existsSync(root)) {
                log(`· ${root} does not exist — no versioned binaries to remove`);
        } else if (flags.dryRun) {
                log(`would remove  ${root} (versioned binaries, including rollback copies)`);
                if (selfDelete) log("  (Windows: by a background helper, after this process exits — the running .exe is locked)");
        } else if (selfDelete) {
                try {
                        opts.scheduleRemoval(root);
                } catch (err) {
                        log(`✗ could not schedule the removal of ${root} — ${err instanceof Error ? err.message : String(err)}`);
                        log("  nothing was removed; close any unown process using this root and re-run unown uninstall");
                        return 1;
                }
                log(`scheduled  ${root} — deleted in the background once this unown process exits (Windows locks the running .exe)`);
                scheduledRoot = true;
        } else {
                try {
                        opts.removeDir(root);
                        log(`removed  ${root} (versioned binaries, including rollback copies)`);
                        removedRoot = true;
                } catch (err) {
                        log(`✗ could not remove ${root} — ${err instanceof Error ? err.message : String(err)}`);
                        log("  nothing was removed; close any unown process using this root and re-run unown uninstall");
                        return 1;
                }
        }

        const failures: string[] = [];
        for (const s of ours) {
                if (flags.dryRun) {
                        log(`would remove  ${s.path}`);
                        continue;
                }
                try {
                        opts.removeFile(s.path);
                        log(`removed  ${s.path}`);
                } catch (err) {
                        failures.push(s.path);
                        log(`✗ could not remove ${s.path} — ${errMessage(err)}`);
                }
        }
        for (const s of shims) {
                if (!s.ours) log(`skipped   ${s.path} — points at a different unown install`);
        }
        if (!shims.length) log("no unown shims found in the standard bin dirs");

        // Metadata records the ACTIVE install; once the root is gone (or on its
        // way out) the record must not survive to claim a binary that is not there.
        const metaPath = installMetadataPath(home);
        if (flags.purgeData) {
                if (existsSync(home)) {
                        if (flags.dryRun) {
                                log(`would remove  ${home} (agent config, memories, notes, install.json)`);
                        } else {
                                try {
                                        opts.removeDir(home);
                                        log(`removed  ${home} (agent config, memories, notes, install.json)`);
                                } catch (err) {
                                        failures.push(home);
                                        log(`✗ could not remove ${home} — ${errMessage(err)}`);
                                        log("  a running unown session can hold its state here open — close it and re-run");
                                }
                        }
                } else {
                        log(`· ${home} does not exist — nothing to purge`);
                }
        } else {
                if (existsSync(metaPath)) {
                        if (flags.dryRun) {
                                log(`would remove  ${metaPath} (install record)`);
                        } else {
                                try {
                                        opts.removeFile(metaPath);
                                        log(`removed  ${metaPath} (install record)`);
                                } catch (err) {
                                        failures.push(metaPath);
                                        log(`✗ could not remove ${metaPath} — ${errMessage(err)}`);
                                }
                        }
                }
                log(`kept      ${home} — your memories/notes (pass --purge-data to delete)`);
        }

        if (flags.purgeCheckout) {
                log("· --purge-checkout: a binary install has no checkout; the versioned root is handled above");
        }

        log("");
        if (!flags.dryRun) {
                const touched = removedRoot || scheduledRoot || ours.length > 0 || flags.purgeData;
                if (failures.length) {
                        log(`✗ uninstall incomplete — ${failures.length} item(s) could not be removed (listed above)`);
                        if (scheduledRoot) log(`  ${root} is still scheduled for background deletion`);
                        log("  fix the cause, then re-run unown uninstall");
                        return 1;
                }
                log(
                        touched
                                ? "✓ unown uninstalled (any running sessions keep using memory until they exit)"
                                : "· nothing was removed",
                );
                if (scheduledRoot) log(`  ${root} disappears seconds from now; nothing else is needed`);
                log("  PATH residue: the bin dir may remain on PATH — remove its line from your shell profile if desired.");
        }
        return 0;
}

function resolveRepoRootBestEffort(): string | null {
        const guess = join(import.meta.dir, "..", "..", "..", "..");
        if (!existsSync(guess)) return null;
        // Read-only probe of the unown checkout — same shared hardening as
        // checkoutHasUncommittedWork above (GitSpawn: `git rev-parse` in a
        // repo whose .git/config carries an exec sink must not run it).
        const r = runGitSync(guess, ["rev-parse", "--show-toplevel"], { readOnly: true, timeoutMs: 30_000 });
        return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : guess;
}

/** Home paths may contain the username; shims may contain anything — keep output lean. */
function redactPath(p: string): string {
        return redactUrl(p); // credential-shaped substrings only; paths pass through
}
