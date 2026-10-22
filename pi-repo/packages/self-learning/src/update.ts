/**
 * update.ts — `unown update` and the startup update notification.
 *
 * Unown is installed as a git checkout (clone + `bun run agent:install`) with
 * a PATH shim pointing INTO that checkout, so updating is a git operation:
 *
 *   check:   `git ls-remote --tags --refs origin "v*"`   (read-only — no
 *            local refs are touched, so the check is safe to run while the
 *            agent itself is using git in the checkout)
 *   apply:   `git fetch --tags origin` → `git merge --ff-only <tag>` (or
 *            `git checkout <tag>` for pinned/detached installs) → re-run
 *            `scripts/install.ts` (idempotent: deps, build, .env, shim)
 *
 * The design follows the converged patterns of the tools users know
 * (researched 2026-10: Claude Code `claude update`, ohmyzsh `omz update`,
 * Codex/Gemini update-notifier, rustup, brew):
 *   - explicit `unown update` subcommand (the #1 requested gap in peers)
 *   - non-mutating `unown update --check` with stable exit codes
 *     (0 = up to date, 2 = update available, 1 = error/offline)
 *   - startup notification is TTY-gated, CI-suppressed, 24h-cached in
 *     ~/.unown (OUTSIDE the repo — never dirties the user's tree), and
 *     refreshed by a detached background child so it never blocks boot
 *   - dirty tree: refuse unless `--allow-dirty` (git's merge --autostash)
 *   - pinned/detached installs: refuse without an explicit version
 *   - local commits not on the remote: refuse (never rebase for the user)
 *   - the pre-update SHA is recorded before anything moves, so
 *     `unown update --rollback` is one command
 *   - a half-pushed tag (package.json inside the tag disagrees with the
 *     tag name) is never offered — the "ensure version ready" rule
 *   - after applying, the install pipeline re-runs; if it FAILS, the
 *     checkout is rolled back to the recorded SHA automatically
 *
 * Kill switches (env):
 *   UNOWN_DISABLE_UPDATES=1      blocks ALL update paths (check included)
 *                                — the org/CI switch (Claude's DISABLE_UPDATES)
 *   UNOWN_DISABLE_AUTOUPDATE=1   suppresses only the background check/banner
 *   NO_UPDATE_NOTIFIER=1         same, ecosystem-standard name
 *   DO_NOT_TRACK=1               also counts as nonessential-traffic opt-out
 *
 * State (both under UNOWN_HOME, never inside the repo):
 *   update-check.json  { checkedAt, latest, remoteUrl }   — notifier cache
 *   update-state.json  { from, to, fromSha, startedAt, ok, rolledBack } — last update
 *
 * Note on `git reset --hard` in the rollback paths: the root AGENTS.md
 * "never reset --hard" rule protects THIS development checkout's parallel
 * agent sessions. The rollback paths here only ever run inside a user's
 * install AFTER cmdUpdate itself verified the tree was clean (or autostashed
 * and restored it), recorded the pre-update SHA, and had the post-update
 * build fail — that is exactly the rustup/ohmyzsh product pattern. The dev
 * checkout can never hit them: its tree is dirty during work, so
 * `unown update` refuses at the guard.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "./atomic.ts";
import {
        type BinaryCheckResult,
        checkBinaryUpdate,
        downloadAndStage,
        type ExtractArchive,
        type FetchLike,
        fetchReleaseFeed,
        installStaged,
        rollbackBinaryInstall,
        type VerifyBinary,
} from "./bin-update.ts";
import { fsmonitorNeutralizerArgs, promptSinkNeutralizerArgs, readOnlyGitArgs } from "./gittools.ts";
// M8: the post-update engine hint needs a liveness probe. engine-supervisor
// is side-effect-free at module scope (the detachment contract) — importing
// it here does NOT open the engine DB from a `unown update` run.
import { engineHealth } from "./engine-supervisor.ts";
import {
        archiveName,
        binaryPath,
        defaultInstallRoot,
        detectMusl,
        detectPlatform,
        type InstallMetadata,
        type InstallMode,
        inferBinaryLayout,
        platformGate,
        RELEASE_PLATFORMS,
        type ReleasePlatform,
        readInstallMetadata,
        redactUrl,
        releasesBase,
} from "./install-layout.ts";
import { runMigrations } from "./migrations.ts";
import { IS_COMPILED_BINARY } from "./packaging.ts";
import { type ReleaseAsset, selectReleaseAsset } from "./release-manifest.ts";
import { compareSemver, parseSemver } from "./semver.ts";
import {
        acquireUpdateLock,
        deriveUpdateStatus,
        describeAge,
        formatUpdateSize,
        isUpdateLocked,
        noticeSuppressed,
        parseSnoozeDuration,
        readUpdateCheckCache,
        readUpdatePrefs,
        recordNotice,
        shouldRefresh,
        UPDATE_CHECK_TTL_MS,
        type UpdateCheckCache,
        type UpdatePrefs,
        unownHome,
        updateCheckPath,
        updateNoticeLines,
        updatePrefsPath,
        updatesHardDisabled,
        writeUpdateCheckCache,
        writeUpdatePrefs,
} from "./update-status.ts";

export { compareSemver, parseSemver };
export {
        UPDATE_CHECK_TTL_MS,
        describeAge,
        formatUpdateSize,
        noticeSuppressed,
        readUpdateCheckCache,
        readUpdatePrefs,
        unownHome,
        updateCheckPath,
        updateNoticeLines,
        updatePrefsPath,
        updatesHardDisabled,
};
export type { UpdateCheckCache, UpdatePrefs };

// ---------------------------------------------------------------------------
// Repo/home resolution (mirrors cli.ts VERSION — the ROOT package.json is the
// version source of truth; four levels up from this src/ dir is the repo root)
// ---------------------------------------------------------------------------
const REPO_GUESS = join(import.meta.dir, "..", "..", "..", "..");

/** Root package.json version, "unknown" when detached from the repo layout. */
export function readRootVersion(root: string): string {
        try {
                const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
                return String(pkg.version ?? "unknown");
        } catch {
                return "unknown";
        }
}

// ---------------------------------------------------------------------------
// Semver (core + prerelease; the repo tags are strict `vX.Y.Z`) — implemented
// in semver.ts so the release-feed updater can reuse it without a cycle; the
// functions are re-exported above for every existing importer.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Git plumbing (injectable for tests)
// ---------------------------------------------------------------------------
export interface GitResult {
        code: number;
        out: string;
        err: string;
}
export type GitRunner = (args: string[], cwd?: string) => GitResult;

/** Git verbs update.ts uses that only ever read LOCAL state (never touch a
 *  remote, never write): the full hardened read-only probe set applies —
 *  hooks disabled, `--no-optional-locks`, and the GitSpawn exec/prompt sink
 *  neutralizers (fsmonitor/sshCommand/askPass/pager). The sshCommand override
 *  is a no-op for these verbs (they never exec ssh) — pure belt-and-braces. */
const LOCAL_READ_ONLY_GIT_VERBS = new Set([
        "rev-parse",
        "symbolic-ref",
        "describe",
        "status",
        "rev-list",
        "tag", // only ever `tag --list` here
        "show",
        "merge-base",
        "remote", // only ever `remote get-url` here
]);

/** The real git runner. Everything update.ts does to git funnels through this
 *  one seam (tests inject their own GitRunner), so the GitSpawn hardening
 *  lives HERE, classified by verb:
 *
 *   - local read-only verbs (above) → the FULL shared read-only set from
 *     gittools.ts (hooksPath override + --no-optional-locks + fsmonitor +
 *     sshCommand + askPass + pager). `git status` is the exact verb the
 *     September 2026 GitSpawn disclosure
 *     (https://shattered.io/gitspawn-ai-coding-agent-vulnerability-2026/)
 *     used to execute a repo-local `core.fsmonitor` binary OUTSIDE any
 *     sandbox; these probes run against the unown checkout (semi-trusted),
 *     and a stale/hostile fsmonitor daemon also lies about dirtiness —
 *     neutralizing it is a correctness fix, not just hardening.
 *
 *   - everything else (ls-remote / fetch / checkout / merge / reset, and any
 *     unknown verb — fail-closed to the mutation bucket) → fsmonitor + the
 *     prompt sinks (askPass/pager) ONLY, with two deliberate carve-outs:
 *
 *     · core.sshCommand is NOT overridden on the network/mutation bucket:
 *       `ls-remote`/`fetch` genuinely exec it, and the unown checkout is the
 *       user's OWN semi-trusted clone — a core.sshCommand they configured
 *       there (1Password `op ssh --`, Windows plink, ProxyJump wrappers) is
 *       legitimate auth for their own remote, and stomping it to bare `ssh`
 *       would break the documented update flow (docs/updating.md: fetch
 *       release tags from origin). The untrusted-repo GitSpawn context is
 *       handled by the local read-only bucket + gittools/worktree probes.
 *     · hooks stay LIVE on checkout/merge/reset (the same documented
 *       distinction as gittools' commit path: user hooks are a deliberate
 *       reviewed gate — e.g. a post-checkout hook — while fsmonitor is an
 *       unreviewed exec sink no legitimate workflow depends on).
 *
 *     fsmonitor IS neutralized here too: verified on git 2.47, `git
 *     checkout`, `git merge --ff-only` and `git reset --hard` all spawn a
 *     hostile `core.fsmonitor` value. askPass= closes the credential-prompt
 *     exec sink while preserving the terminal fallback (background
 *     `--check` children fail fast instead of hanging on a prompt). */
export const realGit: GitRunner = (args, cwd) => {
        const verb = args.find((a) => !a.startsWith("-"));
        const hardened =
                verb !== undefined && LOCAL_READ_ONLY_GIT_VERBS.has(verb)
                        ? readOnlyGitArgs()
                        : [...fsmonitorNeutralizerArgs(), ...promptSinkNeutralizerArgs()];
        const r = spawnSync("git", [...hardened, ...args], { cwd, encoding: "utf8", timeout: 60_000 });
        return { code: r.status ?? 1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
};

/** Authoritative repo root: `git rev-parse --show-toplevel` from the guess. */
export function resolveRepoRoot(git: GitRunner): string | null {
        const r = git(["rev-parse", "--show-toplevel"], REPO_GUESS);
        return r.code === 0 && r.out ? r.out : null;
}

// ---------------------------------------------------------------------------
// Install mode (checkout vs standalone binary)
// ---------------------------------------------------------------------------
export interface InstallInfo {
        mode: InstallMode;
        /** Checkout root, or the binary install root (<root>/versions/<v>/…). */
        root: string;
        version: string;
        platform?: ReleasePlatform;
        /** Absolute path of the active binary (binary mode only). */
        binary?: string;
        shim?: string;
        metadata?: InstallMetadata;
}

export interface ResolveInstallOptions {
        env?: NodeJS.ProcessEnv;
        execPath?: string;
        platform?: NodeJS.Platform;
        git?: GitRunner;
        home?: string;
        /** Force a checkout root (tests, and callers that already resolved one). */
        root?: string;
        isCompiled?: boolean;
        checkGit?: boolean;
}

function asReleasePlatform(v: string | undefined): ReleasePlatform | undefined {
        return v && (RELEASE_PLATFORMS as readonly string[]).includes(v) ? (v as ReleasePlatform) : undefined;
}

/**
 * The mode-detection rule, in order:
 *   1. process.execPath inside `<root>/versions/<semver>/unown[.exe]` -> binary
 *   2. UNOWN_INSTALL_ROOT set (the shim's marker) or a compiled binary -> binary
 *      (root = the env var, else install.json's binary root, else the default)
 *   3. `git rev-parse --show-toplevel` from this module -> checkout
 *   4. ~/.unown/install.json (a stale record after the shim moved) -> its mode
 *   5. null: no checkout, no shim marker, no metadata — the caller prints a
 *      clear "cannot determine how this was installed" error.
 */
export function resolveInstallInfo(opts: ResolveInstallOptions = {}): InstallInfo | null {
        const env = opts.env ?? process.env;
        const home = opts.home ?? unownHome(env);
        const platform = opts.platform ?? process.platform;
        if (opts.root) return { mode: "checkout", root: opts.root, version: readRootVersion(opts.root) };

        const meta = readInstallMetadata(home);
        const execPath = opts.execPath ?? process.execPath;
        const inferred = inferBinaryLayout(execPath, platform);
        if (inferred) {
                return {
                        mode: "binary",
                        root: inferred.root,
                        version: inferred.version,
                        platform: asReleasePlatform(meta?.platform) ?? detectPlatform({ platform }) ?? undefined,
                        binary: execPath,
                        shim: meta?.mode === "binary" ? meta.shim : undefined,
                        metadata: meta?.mode === "binary" ? meta : undefined,
                };
        }

        const compiled = opts.isCompiled ?? IS_COMPILED_BINARY;
        if (compiled || env.UNOWN_INSTALL_ROOT) {
                const root = env.UNOWN_INSTALL_ROOT || (meta?.mode === "binary" ? meta.root : defaultInstallRoot(env, platform));
                const version = meta?.mode === "binary" ? meta.version : "unknown";
                const releasePlatform = asReleasePlatform(meta?.platform) ?? detectPlatform({ platform }) ?? undefined;
                return {
                        mode: "binary",
                        root,
                        version,
                        platform: releasePlatform,
                        binary: version !== "unknown" && releasePlatform ? binaryPath(root, version, releasePlatform) : undefined,
                        shim: meta?.mode === "binary" ? meta.shim : undefined,
                        metadata: meta?.mode === "binary" ? meta : undefined,
                };
        }

        if (opts.checkGit !== false) {
                const repo = resolveRepoRoot(opts.git ?? realGit);
                if (repo) {
                        return { mode: "checkout", root: repo, version: readRootVersion(repo), metadata: meta ?? undefined };
                }
        }

        if (meta) {
                if (meta.mode === "binary") {
                        return {
                                mode: "binary",
                                root: meta.root,
                                version: meta.version,
                                platform: asReleasePlatform(meta.platform),
                                binary: meta.bin,
                                shim: meta.shim,
                                metadata: meta,
                        };
                }
                return {
                        mode: "checkout",
                        root: meta.root,
                        version: existsSync(meta.root) ? readRootVersion(meta.root) : meta.version,
                        shim: meta.shim,
                        metadata: meta,
                };
        }
        return null;
}

/** Parse `git ls-remote --tags --refs` output ("<sha>\t<ref>" lines) into
 *  bare version strings; peeled `^{}` lines never appear under --refs. */
export function parseLsRemoteTags(out: string): string[] {
        const tags: string[] = [];
        for (const line of out.split("\n")) {
                const m = /^[0-9a-f]{40,64}\trefs\/tags\/(v[0-9][^\t^{}]*)$/.exec(line.trim());
                if (m) tags.push(m[1].replace(/^v/, ""));
        }
        return tags.filter((t) => parseSemver(t) !== null);
}

/** Highest semver among tags. */
export function pickLatestTag(versions: string[]): string | null {
        let best: string | null = null;
        for (const v of versions) {
                if (parseSemver(v) && (best === null || compareSemver(v, best) > 0)) best = v;
        }
        return best;
}

// ---------------------------------------------------------------------------
// State files (UNOWN_HOME — outside the repo, never dirties the user tree)
// ---------------------------------------------------------------------------
export interface UpdateState {
        from: string;
        to: string;
        fromSha: string;
        startedAt: string;
        ok?: boolean;
        rolledBack?: boolean;
        completedAt?: string;
        /** A binary update/rollback records its shape and keeps the original
         *  update record instead of overwriting it with the rollback. */
        mode?: InstallMode;
        platform?: ReleasePlatform;
        rollbackFrom?: string;
        rollbackTo?: string;
        rollbackAt?: string;
}

export function updateStatePath(home: string): string {
        return join(home, "update-state.json");
}
function readJsonFile<T>(p: string): T | null {
        try {
                return JSON.parse(readFileSync(p, "utf8")) as T;
        } catch {
                return null;
        }
}
function writeJsonFile(p: string, data: unknown): void {
        atomicWriteFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
}

/** Credential redaction lives in install-layout.ts so the checkout and binary
 *  paths share it; re-exported here for the existing callers/tests. */
export { redactUrl };

// ---------------------------------------------------------------------------
// Non-mutating check (`git ls-remote` — nothing local is touched)
// ---------------------------------------------------------------------------
export interface UpdateCheckResult {
        ok: boolean; // false: not a repo / no remote / git failed (offline)
        current: string;
        latest: string | null;
        available: boolean;
        remoteUrl: string | null;
        error?: string;
}

export function checkForUpdate(root: string, git: GitRunner): UpdateCheckResult {
        const current = readRootVersion(root);
        const remote = git(["remote", "get-url", "origin"], root);
        if (remote.code !== 0) {
                return { ok: false, current, latest: null, available: false, remoteUrl: null, error: "no `origin` remote" };
        }
        // REDACTED at the source: everything downstream (JSON output, the
        // notifier cache on disk, doctor) only ever sees the credential-free URL.
        const remoteUrl = redactUrl(remote.out);
        const ls = git(["ls-remote", "--tags", "--refs", "origin", "v*"], root);
        if (ls.code !== 0) {
                return { ok: false, current, latest: null, available: false, remoteUrl, error: ls.err || "git ls-remote failed" };
        }
        const latest = pickLatestTag(parseLsRemoteTags(ls.out));
        if (!latest) {
                return {
                        ok: false,
                        current,
                        latest: null,
                        available: false,
                        remoteUrl,
                        error: "no v* release tags on the remote",
                };
        }
        return { ok: true, current, latest, available: compareSemver(latest, current) > 0, remoteUrl };
}

/** Local checkout state recorded by the background check, so the startup
 *  notice never has to run git itself. */
export interface CheckoutState {
        headBranch: string | null;
        headTag: string | null;
        dirty: boolean;
        ahead: number | null;
}

export function checkoutState(root: string, git: GitRunner): CheckoutState {
        return {
                headBranch: branchOf(root, git),
                headTag: tagAtHead(root, git),
                dirty: isDirty(root, git),
                ahead: localCommitsAhead(root, git),
        };
}

// ---------------------------------------------------------------------------
// Foreground update
// ---------------------------------------------------------------------------
export interface UpdateFlags {
        check?: boolean;
        json?: boolean;
        background?: boolean;
        allowDirty?: boolean;
        rollback?: boolean;
        help?: boolean;
        version?: string; // explicit target (v-prefix optional)
        skip?: boolean;
        skipVersion?: string;
        unskip?: boolean;
        snooze?: string;
        dryRun?: boolean;
}
export interface UpdateCtx {
        root?: string; // resolved via git when absent
        home?: string;
        env?: NodeJS.ProcessEnv;
        git?: GitRunner;
        /** Force an already-resolved install (tests / callers that probed). */
        install?: InstallInfo;
        /** Test seams for binary mode. */
        platform?: NodeJS.Platform;
        execPath?: string;
        isCompiled?: boolean;
        binary?: {
                fetch?: FetchLike;
                extract?: ExtractArchive;
                verifyBinary?: VerifyBinary;
                baseUrl?: string;
                platform?: ReleasePlatform;
                musl?: boolean;
                metadataPlatform?: string;
                timeoutMs?: number;
                archiveTimeoutMs?: number;
                quarantine?: (binary: string, platform: ReleasePlatform) => void;
        };
        /** Post-update pipeline. Real one spawns `bun scripts/install.ts`. Returns exit code. */
        runInstall?: (root: string) => number;
        log?: (line: string) => void;
}

/** local `v*` tags, semver-descending, AFTER a fetch. */
function localTagsDesc(root: string, git: GitRunner): string[] {
        const r = git(["tag", "--list", "v*"], root);
        if (r.code !== 0) return [];
        return r.out
                .split("\n")
                .map((t) => t.trim().replace(/^v/, ""))
                .filter((t) => parseSemver(t) !== null)
                .sort(compareSemverDesc);
}
function compareSemverDesc(a: string, b: string): number {
        return compareSemver(b, a);
}

/** The "ensure version ready" gate: a tag only counts when the package.json
 *  inside it carries the tag's version (Codex's half-pushed-release guard). */
function tagReady(root: string, git: GitRunner, tag: string): boolean {
        const r = git(["show", `${tag}:package.json`], root);
        if (r.code !== 0) return false;
        try {
                return String(JSON.parse(r.out).version ?? "") === tag.replace(/^v/, "");
        } catch {
                return false;
        }
}

function isDirty(root: string, git: GitRunner): boolean {
        return git(["status", "--porcelain", "--untracked-files=normal"], root).out !== "";
}

function branchOf(root: string, git: GitRunner): string | null {
        const r = git(["symbolic-ref", "--quiet", "--short", "HEAD"], root);
        return r.code === 0 && r.out ? r.out : null; // null = detached
}

function tagAtHead(root: string, git: GitRunner): string | null {
        const r = git(["describe", "--tags", "--exact-match", "HEAD"], root);
        return r.code === 0 && r.out ? r.out : null;
}

function localCommitsAhead(root: string, git: GitRunner): number | null {
        const up = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], root);
        if (up.code !== 0) return null; // no upstream configured
        const n = git(["rev-list", "--count", `${up.out}..HEAD`], root);
        return n.code === 0 ? Number(n.out) : null;
}

/** CHANGELOG.md sections for versions in (from, to], Keep a Changelog shape. */
export function changelogSlice(root: string, from: string, to: string, maxLines = 40): string[] {
        try {
                const text = readFileSync(join(root, "CHANGELOG.md"), "utf8");
                const lines = text.split("\n");
                const sections: { version: string; lines: string[] }[] = [];
                let current: { version: string; lines: string[] } | null = null;
                for (const line of lines) {
                        const m = /^##\s*\[([^\]]+)\]/.exec(line);
                        if (m) {
                                current = { version: m[1], lines: [] };
                                sections.push(current);
                        } else if (current) {
                                current.lines.push(line);
                        }
                }
                return sections
                        .filter(
                                (s) => parseSemver(s.version) && compareSemver(s.version, from) > 0 && compareSemver(s.version, to) <= 0,
                        )
                        .flatMap((s) => [`## [${s.version}]`, ...s.lines.slice(0, maxLines).map((l) => l.replace(/\s+$/, ""))])
                        .filter((l, i, arr) => !(l === "" && arr[i - 1] === "")) // collapse blank runs
                        .slice(0, maxLines * 2);
        } catch {
                return [];
        }
}

/** The `unown update` command. Returns the process exit code. */
export async function cmdUpdate(flags: UpdateFlags, ctx: UpdateCtx = {}): Promise<number> {
        const env = ctx.env ?? process.env;
        const git = ctx.git ?? realGit;
        const log = ctx.log ?? ((line: string) => console.log(line));
        const home = ctx.home ?? unownHome(env);

        if (updatesHardDisabled(env)) {
                log("unown: updates disabled (UNOWN_DISABLE_UPDATES=1)");
                return 0;
        }

        // Preference-only operations run before mode resolution and never touch
        // the network: they are how a user dismisses the notice/chip.
        if (flags.skip || flags.unskip || flags.snooze) {
                const prefs = readUpdatePrefs(home);
                if (flags.unskip) {
                        delete prefs.skippedVersion;
                        delete prefs.snoozeUntil;
                        writeUpdatePrefs(home, prefs);
                        log("unown: update skips and snoozes cleared");
                }
                if (flags.snooze) {
                        const parsed = parseSnoozeDuration(flags.snooze);
                        if (!parsed.ok) {
                                log(`unown: ${parsed.error}`);
                                return 1;
                        }
                        prefs.snoozeUntil = parsed.until;
                        writeUpdatePrefs(home, prefs);
                        log(`unown: update notices snoozed until ${parsed.until}`);
                }
                if (flags.skip) {
                        const cached = readUpdateCheckCache(home)?.latest;
                        const selected = (flags.skipVersion ?? cached ?? "").replace(/^v/, "");
                        if (!parseSemver(selected)) {
                                log("unown: no cached update to skip — run `unown update --check` first, or pass a version");
                                return 1;
                        }
                        prefs.skippedVersion = selected;
                        writeUpdatePrefs(home, prefs);
                        log(`unown: skipping v${selected} (undo: unown update --unskip)`);
                }
                return 0;
        }

        const install =
                ctx.install ??
                resolveInstallInfo({
                        env,
                        home,
                        git,
                        root: ctx.root,
                        execPath: ctx.execPath,
                        platform: ctx.platform,
                        isCompiled: ctx.isCompiled,
                });
        if (!install) {
                log("unown: cannot determine how this unown was installed — no git checkout,");
                log("  no UNOWN_INSTALL_ROOT (set by the install shim), and no ~/.unown/install.json.");
                log("  reinstall with the install script, then re-run `unown update`.");
                return 1;
        }
        if (install.mode === "binary") {
                return cmdUpdateBinary(flags, install, ctx, env, home, log);
        }
        const root = install.root;

        // ------------------------------------------------------------ background
        // BEFORE --check: the detached child is spawned as `update --check
        // --background`, and its contract is "write the cache, say nothing".
        if (flags.background) {
                // Detached refresh child: one writer only, cache only, exit 0.
                const lock = acquireUpdateLock(home, "check");
                if (!lock.ok) return 0;
                try {
                        const res = checkForUpdate(root, git);
                        const state = checkoutState(root, git);
                        const cache: UpdateCheckCache = {
                                schema: 2,
                                checkedAt: new Date().toISOString(),
                                current: res.current,
                                mode: "checkout",
                                latest: res.latest ?? "",
                                applicable: res.ok && res.available,
                                reason: res.ok ? (res.available ? "ok" : "up-to-date") : "check-error",
                                ...(res.remoteUrl ? { remoteUrl: res.remoteUrl } : {}),
                                ...(res.ok ? {} : { error: res.error ?? "check failed" }),
                                ...state,
                        };
                        writeUpdateCheckCache(home, cache);
                } finally {
                        lock.release();
                }
                return 0;
        }

        // ---------------------------------------------------------------- check
        if (flags.check) return cmdCheck(root, home, git, log, flags);

        // -------------------------------------------------------------- rollback
        if (flags.rollback) {
                const lock = acquireUpdateLock(home, "apply");
                if (!lock.ok) {
                        log(`unown: ${lock.error}`);
                        return 1;
                }
                try {
                        return cmdRollback(root, home, git, ctx, log);
                } finally {
                        lock.release();
                }
        }

        // ----------------------------------------------------------------- apply
        const current = readRootVersion(root);

        if (flags.dryRun) {
                const check = checkForUpdate(root, git);
                if (!check.ok) {
                        log(`unown: update check failed — ${check.error ?? "unknown error"}`);
                        return 1;
                }
                const target = flags.version?.replace(/^v/, "") ?? check.latest;
                if (!target) {
                        log("unown: no release tag to update to");
                        return 1;
                }
                log(`unown: would update checkout ${current} → ${target}`);
                log(
                        `  dirty tree: ${isDirty(root, git) ? "yes (use --allow-dirty)" : "no"} · mode: ${branchOf(root, git) ?? "detached"}`,
                );
                log("  dry run: nothing was changed");
                return 0;
        }

        const applyLock = acquireUpdateLock(home, "apply");
        if (!applyLock.ok) {
                log(`unown: ${applyLock.error}`);
                return 1;
        }
        try {
                if (isDirty(root, git) && !flags.allowDirty) {
                        log(`unown: the checkout has uncommitted changes — refusing to update over them.`);
                        log(`  commit or stash them, or pass --allow-dirty (git merge --autostash)`);
                        return 1;
                }

                const branch = branchOf(root, git);
                const headTag = tagAtHead(root, git);
                const targetVersion = flags.version?.replace(/^v/, "");
                // A detached HEAD that IS a ready release tag is a normal tag install:
                // `git checkout vX.Y.Z` is documented, and it may auto-advance to the
                // newest ready tag. Only a detached HEAD on a non-release commit is a
                // deliberate pin that needs an explicit version.
                const detachedAtRelease = !branch && headTag !== null && tagReady(root, git, headTag);

                if (!branch && !targetVersion && !detachedAtRelease) {
                        log(`unown: HEAD is detached${headTag ? ` at ${headTag}` : ""} — a pinned install.`);
                        log(`  update explicitly with:  unown update <version>`);
                        return 1;
                }

                // Fetch release tags (foreground only — the background check never fetches).
                const fetch = git(["fetch", "origin", "--tags", "--prune", "--quiet"], root);
                if (fetch.code !== 0) {
                        log(`unown: could not fetch from origin — ${fetch.err || "network error"}`);
                        log(`  (offline? try again later; nothing was changed)`);
                        return 1;
                }

                // Resolve the target tag.
                let targetTag: string | null = null;
                if (targetVersion) {
                        const want = `v${targetVersion}`;
                        const exists = git(["rev-parse", "--verify", "--quiet", `refs/tags/${want}`], root);
                        if (exists.code !== 0) {
                                const avail = localTagsDesc(root, git)
                                        .filter((t) => tagReady(root, git, `v${t}`))
                                        .slice(0, 8);
                                log(`unown: version ${targetVersion} not found${avail.length ? ` — available: ${avail.join(", ")}` : ""}`);
                                return 1;
                        }
                        if (!tagReady(root, git, want)) {
                                log(
                                        `unown: tag ${want} exists but its package.json does not declare ${targetVersion} — refusing a broken release`,
                                );
                                return 1;
                        }
                        targetTag = want;
                        if (compareSemver(targetVersion, current) <= 0) {
                                log(`unown: downgrading ${current} → ${targetVersion} (explicit request)`);
                        }
                } else {
                        for (const v of localTagsDesc(root, git)) {
                                if (compareSemver(v, current) <= 0) break;
                                if (tagReady(root, git, `v${v}`)) {
                                        targetTag = `v${v}`;
                                        break;
                                }
                        }
                        if (!targetTag) {
                                log(`unown is up to date (${current})`);
                                return 0;
                        }
                }

                // Local-commits guard (never rebase for the user).
                const ahead = localCommitsAhead(root, git);
                if (ahead && ahead > 0) {
                        log(`unown: this checkout has ${ahead} local commit(s) not on the remote —`);
                        log(`  push or rebase them onto origin first, then re-run unown update`);
                        return 1;
                }

                // Fast-forward sanity: for an AUTOMATIC move the target must contain
                // HEAD. An explicit version is allowed to pin/roll back (including to
                // an ancestor or a sibling release), so it uses a detached checkout.
                const headSha = git(["rev-parse", "HEAD"], root).out;
                const descendant = git(["merge-base", "--is-ancestor", "HEAD", targetTag], root);
                const explicit = Boolean(targetVersion);
                if (descendant.code !== 0 && !explicit) {
                        log(`unown: cannot fast-forward HEAD to ${targetTag} — the checkout diverged from release history.`);
                        log(`  resolve manually (rebase/merge), or roll back with: unown update <older-version>`);
                        return 1;
                }
                const applyByCheckout = !branch || (explicit && descendant.code !== 0);

                // Record the rollback point BEFORE anything moves.
                const state: UpdateState = {
                        from: current,
                        to: targetTag.replace(/^v/, ""),
                        fromSha: headSha,
                        startedAt: new Date().toISOString(),
                        mode: "checkout",
                };
                writeJsonFile(updateStatePath(home), state);

                // Apply.
                const apply = applyByCheckout
                        ? git(["checkout", "--detach", targetTag], root)
                        : git(["merge", "--ff-only", ...(flags.allowDirty ? ["--autostash"] : []), targetTag], root);
                if (apply.code !== 0) {
                        log(`unown: git refused the update — ${apply.err || apply.out}`);
                        log(`  nothing else was changed; see \`git help merge\` for fast-forward requirements`);
                        return 1;
                }

                // Post-update pipeline (deps + build + .env + shim) — auto-rollback on failure.
                const runInstall = ctx.runInstall ?? ((r: string) => spawnInstall(r, env));
                log(`· rebuilding (${targetTag}) — dependencies, engine, PATH shim…`);
                const installCode = runInstall(root);
                const got = readRootVersion(root);
                if (installCode !== 0 || got !== targetTag.replace(/^v/, "")) {
                        log(
                                `unown: ${installCode !== 0 ? "install/build failed" : `version verify failed (expected ${targetTag}, found ${got})`} — rolling back to ${state.from}`,
                        );
                        rollbackTo(root, git, state.fromSha);
                        const back = runInstall(root);
                        writeJsonFile(updateStatePath(home), {
                                ...state,
                                ok: false,
                                rolledBack: true,
                                completedAt: new Date().toISOString(),
                        });
                        log(
                                back === 0
                                        ? `· restored ${current} (${headSha.slice(0, 12)})`
                                        : `✗ rollback restored the git tree, but the rebuild failed — re-run: bun run agent:install`,
                        );
                        return 1;
                }

                writeJsonFile(updateStatePath(home), { ...state, ok: true, completedAt: new Date().toISOString() });

                // User-state migrations (forward-only, non-fatal — a failed cosmetic
                // migration must never brick the CLI; doctor reports the residue).
                const mig = await runMigrations(home);
                if (mig.applied.length) log(`· user state migrated: ${mig.applied.join(", ")} (schema v${mig.version})`);
                for (const f of mig.failed) log(`⚠ migration "${f.name}" failed: ${f.error} — non-fatal; see unown doctor`);

                // Report.
                log(`✓ unown updated: ${current} → ${targetTag.replace(/^v/, "")}`);
                const slice = changelogSlice(root, current, targetTag.replace(/^v/, ""));
                if (slice.length) {
                        log("");
                        log(slice.join("\n"));
                }
                log("");
                log(`  release notes: https://github.com/kanishka-namdeo/Unown/releases/tag/${targetTag}`);
                log(`  restart any running unown sessions to pick up the new build`);
                // M8: the engine is a LONG-LIVED process — updating the checkout does
                // not (and must not) restart it under the user. If one is running, it
                // is now the OLD build by construction; say so with the one-command
                // fix instead of letting the skew surface later as a mystery.
                const engineUp = (await engineHealth(1500)).up;
                if (engineUp) log(`  engine: still running the OLD build until restarted — unown engine restart`);
                log(`  rollback anytime: unown update --rollback   (or: unown update ${current})`);
                return 0;
        } finally {
                applyLock.release();
        }
}

// ---------------------------------------------------------------------------
// Binary install: check / background / apply / rollback (no git, no installer)
// ---------------------------------------------------------------------------
async function cmdUpdateBinary(
        flags: UpdateFlags,
        install: InstallInfo,
        ctx: UpdateCtx,
        env: NodeJS.ProcessEnv,
        home: string,
        log: (line: string) => void,
): Promise<number> {
        const deps = ctx.binary ?? {};
        const host = ctx.platform ?? process.platform;
        const platform = deps.platform ?? install.platform ?? detectPlatform({ platform: host });
        const meta = readInstallMetadata(home);
        const metadataPlatform = deps.metadataPlatform ?? (meta?.mode === "binary" ? meta.platform : undefined);
        const musl = deps.musl ?? detectMusl({ platform: host });
        const gate = platform ? platformGate({ platform, env, metadataPlatform, musl }) : null;
        const cached = readUpdateCheckCache(home);

        if (flags.background) {
                // Same silent contract as the checkout path: cache only, exit 0.
                // Checked before --check because the detached child passes both.
                const lock = acquireUpdateLock(home, "check");
                if (!lock.ok) return 0;
                try {
                        const res = await checkBinaryUpdate({
                                current: install.version,
                                env,
                                fetch: deps.fetch,
                                baseUrl: deps.baseUrl,
                                timeoutMs: deps.timeoutMs,
                                platform: platform ?? undefined,
                                metadataPlatform,
                                musl,
                                ...(cached?.latest ? { cachedLatest: cached.latest } : {}),
                        });
                        writeUpdateCheckCache(home, binaryCache(res));
                } finally {
                        lock.release();
                }
                return 0;
        }

        if (flags.check) return cmdCheckBinary(install, ctx, env, home, log, flags);

        if (flags.rollback) {
                const lock = acquireUpdateLock(home, "apply");
                if (!lock.ok) {
                        log(`unown: ${lock.error}`);
                        return 1;
                }
                try {
                        return cmdRollbackBinary(ctx, env, home, log);
                } finally {
                        lock.release();
                }
        }

        const current = install.version;
        if (!platform) {
                log(`unown: no release archive for this OS/arch (${host}-${process.arch}).`);
                return 1;
        }
        if (gate) {
                log(`unown: ${gate}`);
                return 1;
        }

        let target: string | null = null;
        let manifestAsset: ReleaseAsset | undefined;
        let notesUrl: string | undefined;
        if (flags.version) {
                target = flags.version.replace(/^v/, "");
                if (!parseSemver(target)) {
                        log(`unown: "${flags.version}" is not a version (expected X.Y.Z)`);
                        return 1;
                }
                const feed = await fetchReleaseFeed({
                        env,
                        baseUrl: deps.baseUrl,
                        fetch: deps.fetch,
                        version: target,
                        timeoutMs: deps.timeoutMs,
                        userAgent: `unown/${current}`,
                });
                if (feed.kind === "error") {
                        log(`unown: update feed failed — ${feed.error}`);
                        log(`  (offline or unreachable release feed; nothing was changed)`);
                        return 1;
                }
                if (feed.kind === "manifest") {
                        manifestAsset = selectReleaseAsset(feed.manifest, platform) ?? undefined;
                        if (!manifestAsset) {
                                log(`unown: v${target} has no release archive for ${platform}`);
                                return 1;
                        }
                        notesUrl = feed.manifest.notesUrl ?? undefined;
                }
        } else {
                const res = await checkBinaryUpdate({
                        current,
                        env,
                        fetch: deps.fetch,
                        baseUrl: deps.baseUrl,
                        timeoutMs: deps.timeoutMs,
                        platform,
                        metadataPlatform,
                        musl,
                        ...(cached?.latest ? { cachedLatest: cached.latest } : {}),
                });
                if (!res.ok || !res.latest) {
                        log(`unown: update check failed — ${res.error ?? "no version published"}`);
                        log(`  (offline or unreachable release feed; nothing was changed)`);
                        return 1;
                }
                if (!res.applicable) {
                        log(`unown: v${res.latest} is not installable on ${platform}${res.reason ? ` — ${res.reason}` : ""}`);
                        return 1;
                }
                if (!res.available) {
                        log(`unown is up to date (${current})`);
                        return 0;
                }
                target = res.latest;
                manifestAsset = res.asset;
                notesUrl = res.notesUrl ?? undefined;
        }
        if (current !== "unknown" && compareSemver(target, current) < 0) {
                log(`unown: downgrading ${current} → ${target} (explicit request)`);
        }

        if (flags.dryRun) {
                log(`unown: would install v${target} (binary, ${platform})`);
                log(
                        manifestAsset
                                ? `  archive: ${manifestAsset.name} · ${formatUpdateSize(manifestAsset.size)} · sha256 ${manifestAsset.sha256}`
                                : `  archive: ${archiveName(platform)} (legacy checksum feed)`,
                );
                log("  dry run: nothing was downloaded or changed");
                return 0;
        }

        const lock = acquireUpdateLock(home, "apply");
        if (!lock.ok) {
                log(`unown: ${lock.error}`);
                return 1;
        }
        try {
                const startedAt = new Date().toISOString();
                log(`· installing unown v${target} (binary, ${platform})…`);
                const staged = await downloadAndStage({
                        root: install.root,
                        platform,
                        version: target,
                        env,
                        baseUrl: deps.baseUrl,
                        fetch: deps.fetch,
                        extract: deps.extract,
                        verifyBinary: deps.verifyBinary,
                        timeoutMs: deps.timeoutMs,
                        archiveTimeoutMs: deps.archiveTimeoutMs,
                        userAgent: `unown/${current}`,
                        ...(manifestAsset ? { manifestAsset } : {}),
                        ...(deps.quarantine ? { quarantine: deps.quarantine } : {}),
                        log,
                });
                if (!staged.ok) {
                        log(`unown: binary update failed — ${staged.error}`);
                        log(`  the existing install was not changed`);
                        return 1;
                }
                const applied = installStaged({
                        stagedDir: staged.stagedDir,
                        tempDir: staged.tempDir,
                        root: install.root,
                        version: target,
                        platform,
                        home,
                        env,
                        previousVersion: current !== "unknown" ? current : undefined,
                        verifyBinary: deps.verifyBinary,
                        log,
                });
                if (!applied.ok) {
                        log(`unown: could not activate v${target} — ${applied.error}`);
                        log(`  the existing shim and metadata were left in place`);
                        return 1;
                }

                writeJsonFile(updateStatePath(home), {
                        from: current,
                        to: target,
                        fromSha: "",
                        startedAt,
                        ok: true,
                        completedAt: new Date().toISOString(),
                        mode: "binary",
                        platform,
                } satisfies UpdateState);

                const mig = await runMigrations(home);
                if (mig.applied.length) log(`· user state migrated: ${mig.applied.join(", ")} (schema v${mig.version})`);
                for (const f of mig.failed) log(`⚠ migration "${f.name}" failed: ${f.error} — non-fatal; see unown doctor`);

                log(`✓ unown updated: ${current} → ${target}`);
                log("");
                log(`  release notes: ${notesUrl ?? `${redactUrl(releasesBase(env))}/tag/v${target}`}`);
                log(`  restart any running unown sessions to pick up the new binary`);
                log(`  rollback anytime: unown update --rollback`);
                return 0;
        } finally {
                lock.release();
        }
}

function binaryCache(res: BinaryCheckResult, checkedAt = new Date().toISOString()): UpdateCheckCache {
        return {
                schema: 2,
                checkedAt,
                current: res.current,
                mode: "binary",
                ...(res.platform ? { platform: res.platform } : {}),
                latest: res.latest ?? "",
                applicable: res.applicable,
                ...(res.reason ? { reason: res.reason } : {}),
                ...(res.severity ? { severity: res.severity } : {}),
                ...(res.releasedAt ? { releasedAt: res.releasedAt } : {}),
                ...(res.requiredMinimumVersion !== undefined ? { requiredMinimumVersion: res.requiredMinimumVersion } : {}),
                ...(res.notesUrl ? { notesUrl: res.notesUrl } : {}),
                ...(res.asset && res.asset.size > 0 ? { asset: res.asset } : {}),
                ...(res.signature ? { signature: res.signature } : {}),
                ...(res.latest ? { manifestVersion: res.latest } : {}),
                ...(res.remoteUrl ? { remoteUrl: res.remoteUrl } : {}),
                ...(res.error ? { error: res.error } : {}),
        };
}

async function cmdCheckBinary(
        install: InstallInfo,
        ctx: UpdateCtx,
        env: NodeJS.ProcessEnv,
        home: string,
        log: (line: string) => void,
        flags: UpdateFlags,
): Promise<number> {
        const deps = ctx.binary ?? {};
        const host = ctx.platform ?? process.platform;
        const platform = deps.platform ?? install.platform ?? detectPlatform({ platform: host });
        const meta = readInstallMetadata(home);
        const metadataPlatform = deps.metadataPlatform ?? (meta?.mode === "binary" ? meta.platform : undefined);
        const musl = deps.musl ?? detectMusl({ platform: host });
        const cached = readUpdateCheckCache(home);
        const res = await checkBinaryUpdate({
                current: install.version,
                env,
                fetch: deps.fetch,
                baseUrl: deps.baseUrl,
                timeoutMs: deps.timeoutMs,
                platform: platform ?? undefined,
                metadataPlatform,
                musl,
                ...(cached?.latest ? { cachedLatest: cached.latest } : {}),
        });
        const checkedAt = new Date().toISOString();
        writeUpdateCheckCache(home, binaryCache(res, checkedAt));
        const now = Date.now();
        const prefs = readUpdatePrefs(home);
        const snoozedUntil = prefs.snoozeUntil && Date.parse(prefs.snoozeUntil) > now ? prefs.snoozeUntil : null;
        if (flags.json) {
                log(
                        JSON.stringify(
                                {
                                        schema: 2,
                                        current: res.current,
                                        latest: res.latest,
                                        available: res.available,
                                        applicable: res.applicable,
                                        reason: res.reason ?? null,
                                        mode: "binary",
                                        platform: res.platform,
                                        asset: res.asset ?? null,
                                        signature: res.signature,
                                        severity: res.severity ?? null,
                                        releasedAt: res.releasedAt ?? null,
                                        requiredMinimumVersion: res.requiredMinimumVersion ?? null,
                                        notesUrl: res.notesUrl ?? null,
                                        remoteUrl: res.remoteUrl,
                                        checkedAt,
                                        error: res.error ?? null,
                                        skipped: prefs.skippedVersion === res.latest,
                                        snoozedUntil,
                                },
                                null,
                                2,
                        ),
                );
                return res.ok ? (res.available ? 2 : 0) : 1;
        }
        if (!res.ok) {
                log(`unown: update check failed — ${res.error ?? "unknown error"}`);
                log(`  (offline or unreachable release feed; nothing was changed)`);
                return 1;
        }
        if (!res.applicable) {
                log(
                        `unown ${res.current} — v${res.latest} is not installable on ${res.platform ?? platform ?? "this platform"}` +
                                `${res.reason ? ` (${res.reason})` : ""}`,
                );
                return 0;
        }
        if (res.available) {
                log(
                        `unown ${res.current} — update available: ${res.latest} (${res.platform ?? platform}` +
                                `${res.asset ? `, ${formatUpdateSize(res.asset.size)}` : ""})`,
                );
                log(`  run: unown update`);
                return 2;
        }
        log(`unown ${res.current} — up to date (latest release: v${res.latest})`);
        return 0;
}

function cmdRollbackBinary(ctx: UpdateCtx, env: NodeJS.ProcessEnv, home: string, log: (line: string) => void): number {
        const deps = ctx.binary ?? {};
        const res = rollbackBinaryInstall({
                home,
                env,
                platform: ctx.platform ?? process.platform,
                verifyBinary: deps.verifyBinary,
                log,
        });
        if (res.code === 0) {
                const previous = readJsonFile<UpdateState>(updateStatePath(home));
                const now = new Date().toISOString();
                writeJsonFile(updateStatePath(home), {
                        ...(previous ?? {
                                from: res.from ?? "",
                                to: res.to ?? "",
                                fromSha: "",
                                startedAt: now,
                        }),
                        ok: true,
                        rolledBack: true,
                        completedAt: now,
                        mode: "binary",
                        rollbackFrom: res.from,
                        rollbackTo: res.to,
                        rollbackAt: now,
                } satisfies UpdateState);
        }
        return res.code;
}

/** Spawn the real installer (bun scripts/install.ts) — the idempotent path.
 *  Synchronous by design: `unown update` is a foreground command and the
 *  auto-rollback decision needs the exit code. */
function spawnInstall(root: string, env: NodeJS.ProcessEnv): number {
        const r = spawnSync(process.execPath, [join(root, "scripts", "install.ts")], {
                cwd: root,
                stdio: "inherit",
                timeout: 20 * 60_000,
                env: { ...env, UNOWN_INSTALL_CONTEXT: "update" },
        });
        return r.status ?? (r.error ? 1 : 0);
}

/** `unown update --check` (+ --json). Exit 0 up-to-date, 2 available, 1 error. */
function cmdCheck(root: string, home: string, git: GitRunner, log: (l: string) => void, flags: UpdateFlags): number {
        const res = checkForUpdate(root, git);
        const state = checkoutState(root, git);
        const checkedAt = new Date().toISOString();
        const cache: UpdateCheckCache = {
                schema: 2,
                checkedAt,
                current: res.current,
                mode: "checkout",
                latest: res.latest ?? "",
                applicable: res.ok && res.available,
                reason: res.ok ? (res.available ? "ok" : "up-to-date") : "check-error",
                ...(res.remoteUrl ? { remoteUrl: res.remoteUrl } : {}),
                ...(res.ok ? {} : { error: res.error ?? "check failed" }),
                ...state,
        };
        writeUpdateCheckCache(home, cache);
        if (flags.json) {
                log(
                        JSON.stringify(
                                {
                                        schema: 2,
                                        current: res.current,
                                        latest: res.latest,
                                        available: res.ok && res.available,
                                        applicable: res.ok && res.available,
                                        reason: cache.reason ?? null,
                                        mode: "checkout",
                                        platform: null,
                                        asset: null,
                                        signature: null,
                                        severity: null,
                                        releasedAt: null,
                                        requiredMinimumVersion: null,
                                        remoteUrl: res.remoteUrl,
                                        checkedAt,
                                        error: res.error ?? null,
                                        headBranch: state.headBranch,
                                        headTag: state.headTag,
                                        dirty: state.dirty,
                                        ahead: state.ahead,
                                },
                                null,
                                2,
                        ),
                );
                return res.ok ? (res.available ? 2 : 0) : 1;
        }
        if (!res.ok) {
                log(`unown: update check failed — ${res.error ?? "unknown error"}`);
                log(`  (offline or unreachable remote; nothing was changed)`);
                return 1;
        }
        if (res.available) {
                log(`unown ${res.current} — update available: ${res.latest}`);
                log(`  run: unown update`);
                return 2;
        }
        log(`unown ${res.current} — up to date (latest release: v${res.latest})`);
        return 0;
}

/** `unown update --rollback` — restore the recorded pre-update SHA + rebuild. */
function cmdRollback(root: string, home: string, git: GitRunner, ctx: UpdateCtx, log: (l: string) => void): number {
        const state = readJsonFile<UpdateState>(updateStatePath(home));
        if (!state || !state.fromSha) {
                log(`unown: no recorded update to roll back (run unown update first)`);
                return 1;
        }
        if (isDirty(root, git)) {
                log(`unown: the checkout has uncommitted changes — commit or stash them before rolling back`);
                return 1;
        }
        const head = git(["rev-parse", "HEAD"], root).out;
        if (head === state.fromSha) {
                log(`unown: already at ${state.fromSha.slice(0, 12)} (${state.from}) — nothing to roll back`);
                return 0;
        }
        log(`· rolling back ${state.to} → ${state.from} (${state.fromSha.slice(0, 12)})…`);
        rollbackTo(root, git, state.fromSha);
        const runInstall = ctx.runInstall ?? ((r: string) => spawnInstall(r, ctx.env ?? process.env));
        const code = runInstall(root);
        const got = readRootVersion(root);
        if (code !== 0 || got !== state.from) {
                log(
                        `✗ rollback moved the git tree to ${state.fromSha.slice(0, 12)}, but the rebuild failed — re-run: bun run agent:install`,
                );
                return 1;
        }
        writeJsonFile(updateStatePath(home), {
                ...state,
                ok: true,
                rolledBack: true,
                completedAt: new Date().toISOString(),
        });
        log(`✓ unown rolled back to ${state.from} — restart sessions to pick it up`);
        return 0;
}

function rollbackTo(root: string, git: GitRunner, sha: string): void {
        // Valid because every apply path verified a clean (or autostashed+restored)
        // tree before moving HEAD; the SHA is the recorded pre-update state.
        git(["reset", "--hard", sha], root);
}

// ---------------------------------------------------------------------------
// Startup notification (TTY-gated, cached, background-refreshed)
// ---------------------------------------------------------------------------
export interface NoticeOptions {
        mode?: "tui" | "print";
        env?: NodeJS.ProcessEnv;
        home?: string;
        now?: number;
        install?: InstallInfo | null;
        outputIsTty?: boolean;
}

/** The install the notifier is looking at, without spawning git: the binary
 *  layout/compiled flag first, then the checkout's package.json. */
function noticeInstall(env: NodeJS.ProcessEnv): InstallInfo | null {
        const home = unownHome(env);
        const meta = readInstallMetadata(home);
        const inferred = inferBinaryLayout(process.execPath);
        if (inferred || IS_COMPILED_BINARY || env.UNOWN_INSTALL_ROOT || meta?.mode === "binary") {
                const platform =
                        meta?.mode === "binary" && meta.platform && (RELEASE_PLATFORMS as readonly string[]).includes(meta.platform)
                                ? (meta.platform as ReleasePlatform)
                                : (detectPlatform() ?? undefined);
                return {
                        mode: "binary",
                        root:
                                inferred?.root ?? env.UNOWN_INSTALL_ROOT ?? (meta?.mode === "binary" ? meta.root : defaultInstallRoot(env)),
                        version: inferred?.version ?? (meta?.mode === "binary" ? meta.version : "unknown"),
                        ...(platform ? { platform } : {}),
                };
        }
        const current = readRootVersion(REPO_GUESS);
        if (current !== "unknown") return { mode: "checkout", root: REPO_GUESS, version: current };
        if (meta?.mode === "checkout") return { mode: "checkout", root: meta.root, version: meta.version };
        return null;
}

/** Boot hook: print the cached notice + refresh it in the background (detached).
 *  The suppression gate applies to BOTH the notice and the spawn — a piped/CI/
 *  test run must never spawn the network child (it also holds the cwd, which
 *  broke Windows rmSync in the golden suite: EBUSY on the temp project dir).
 *  Print mode never prints, but an interactive `-p` run may still warm the
 *  cache for the next TUI. */
export function maybeShowUpdateNotice(opts: NoticeOptions = {}): void {
        try {
                const env = opts.env ?? process.env;
                const home = opts.home ?? unownHome(env);
                const now = opts.now ?? Date.now();
                const outputIsTty = opts.outputIsTty ?? Boolean(process.stderr.isTTY);
                if (noticeSuppressed(env) || env.CI !== undefined || env.UNOWN_SUBAGENT === "1" || !outputIsTty) return;
                const install = opts.install === undefined ? noticeInstall(env) : opts.install;
                if (!install || install.version === "unknown") return; // no version to compare
                const cache = readUpdateCheckCache(home);
                const prefs = readUpdatePrefs(home);
                const status = deriveUpdateStatus({ cache, prefs, install, now });
                if (opts.mode !== "print") {
                        const lines = updateNoticeLines({ status, env, outputIsTty, mode: "tui", now });
                        if (lines) {
                                for (const line of lines) console.error(line);
                                writeUpdatePrefs(home, recordNotice(prefs, status, now));
                        }
                }
                if (shouldRefresh(cache, install, now) && !isUpdateLocked(home, "check", now)) {
                        spawnBackgroundCheck(home, install.mode);
                }
        } catch {
                // never let the notifier break a session boot
        }
}

/** Detached, unref'd child running `unown update --check --background`
 *  (the checkout script, or the running binary itself). The child also takes
 *  the check lock, so concurrent terminals collapse to one network check. */
function spawnBackgroundCheck(home: string, mode: InstallMode): void {
        try {
                if (isUpdateLocked(home, "check")) return;
                if (mode === "checkout" && !existsSync(join(REPO_GUESS, "bin", "unown"))) return;
                const env = { ...process.env, UNOWN_HOME: home };
                const args = [join(REPO_GUESS, "bin", "unown"), "update", "--check", "--background"];
                const child =
                        mode === "binary"
                                ? spawn(process.execPath, ["update", "--check", "--background"], {
                                                stdio: "ignore",
                                                detached: true,
                                                env,
                                        })
                                : spawn(process.execPath, args, { stdio: "ignore", detached: true, env });
                child.unref();
        } catch {
                // best effort only
        }
}

// ---------------------------------------------------------------------------
// `unown changelog [n]` — print the latest CHANGELOG.md sections
// ---------------------------------------------------------------------------
export function cmdChangelog(argv: string[], ctx: UpdateCtx = {}): number {
        const log = ctx.log ?? ((line: string) => console.log(line));
        const root = ctx.root ?? REPO_GUESS;
        const n = Math.max(1, Math.min(10, Number(argv[0] ?? 1) || 1));
        try {
                const text = readFileSync(join(root, "CHANGELOG.md"), "utf8");
                const sections = text.split(/^##\s+/m).filter((s) => s.trim().length > 0);
                // The preamble (before the first ##) is dropped; keep [version] sections only.
                const versioned = sections.filter((s) => /^\[/.test(s.trim()));
                if (!versioned.length) {
                        log(`unown: no changelog sections found in ${join(root, "CHANGELOG.md")}`);
                        return 1;
                }
                for (const s of versioned.slice(0, n)) {
                        log(s.trim().split("\n").slice(0, 40).join("\n"));
                        log("");
                }
                log(
                        `full changelog: ${join(root, "CHANGELOG.md")} · releases: https://github.com/kanishka-namdeo/Unown/releases`,
                );
                return 0;
        } catch {
                log(`unown: CHANGELOG.md not found at ${join(root, "CHANGELOG.md")}`);
                return 1;
        }
}

// ---------------------------------------------------------------------------
// CLI surface helpers (dispatched from cli.ts before the generic parser)
// ---------------------------------------------------------------------------
export const UPDATE_HELP = `unown update — check for a newer release and self-update

Usage:
  unown update                update to the newest release
  unown update --check        report only — exit 0 up-to-date or not applicable,
                              2 available, 1 error
  unown update --check --json machine-readable result on stdout
  unown update <version>      install a specific version, e.g. unown update 2.1.0
                              (also the manual rollback path / pinned-install moves)
  unown update --allow-dirty  stash-and-restore local changes while updating
                              (checkout installs only)
  unown update --rollback     undo the last update (checkout: recorded commit;
                              binary: the previous version kept on disk)
  unown update --dry-run      resolve and print the target, change nothing
  unown update --skip [v]     stop showing this version (default: cached latest)
  unown update --unskip       clear the skip and snooze state
  unown update --snooze <d>   silence notices for a while (30m, 12h, 7d)

How the update works depends on how this unown was installed:

  checkout (git clone + agent:install)
    fetch release tags from origin, fast-forward to the newest ready tag, then
    re-run the installer (dependencies, engine build, PATH shim). A half-pushed
    tag (package.json inside it disagreeing with the tag name) is never offered.
    If the post-update rebuild fails, the checkout rolls back automatically.
    A detached HEAD that is exactly a release tag is a normal tag install and
    may advance; any other detached HEAD is pinned until you pass a version.

  binary (standalone release download)
    verify the release.json manifest, select the unown-<platform> asset, verify
    its size and SHA-256 and \`unown --version\`, then atomically activate
    <root>/versions/<version> and rewrite the shim.
    No git and no build step; the previous version stays on disk for rollback.
    Releases without a manifest fall back to version.txt + sha256sums.txt.

Refuses when: the checkout tree is dirty (unless --allow-dirty), a non-release
detached HEAD has no explicit version, local commits exist that the remote
lacks, the manifest is malformed, the platform has no release asset, or a
binary checksum/version verify fails. Never rebases, merges, or
discards your work; a failed binary update leaves the old shim and metadata.

Kill switches:
  UNOWN_DISABLE_UPDATES=1     disable all update paths (org/CI)
  UNOWN_DISABLE_AUTOUPDATE=1  silence the startup notice + background check
  NO_UPDATE_NOTIFIER=1        same, ecosystem-standard name
  DO_NOT_TRACK=1              also suppresses the background update check

Binary installs:
  UNOWN_RELEASES_BASE_URL     release feed base (default
                              https://github.com/kanishka-namdeo/Unown/releases)
  UNOWN_ALLOW_EXPERIMENTAL=1  allow the un-smoked windows-arm64 archive

The startup notice is stderr-TTY-only, CI/subagent-suppressed, cached for 24h
in ~/.unown (outside the repo), and refreshed by a detached background process.
The binary check verifies the manifest and the archive's size and SHA-256
before trusting a download. It only talks to your git remote (checkout) or the
release feed (binary); no telemetry of any kind.`;

/** Parse `unown update` flags; the first bare token is an explicit version.
 *  `--skip <version>` consumes that token as the skipped version, not a target. */
export function parseUpdateFlags(argv: string[]): { flags: UpdateFlags; error?: string } {
        const flags: UpdateFlags = {};
        let version: string | undefined;
        let skipPending = false;
        for (let i = 0; i < argv.length; i++) {
                const a = argv[i];
                if (a === "--check") flags.check = true;
                else if (a === "--json") flags.json = true;
                else if (a === "--background") flags.background = true;
                else if (a === "--allow-dirty") flags.allowDirty = true;
                else if (a === "--rollback") flags.rollback = true;
                else if (a === "--dry-run") flags.dryRun = true;
                else if (a === "--skip") {
                        flags.skip = true;
                        skipPending = true;
                } else if (a === "--unskip") flags.unskip = true;
                else if (a === "--snooze") {
                        const value = argv[++i];
                        if (!value || value.startsWith("-")) return { flags, error: "--snooze needs a duration like 30m, 12h or 7d" };
                        flags.snooze = value;
                } else if (a.startsWith("--snooze=")) {
                        const value = a.slice("--snooze=".length);
                        if (!value) return { flags, error: "--snooze needs a duration like 30m, 12h or 7d" };
                        flags.snooze = value;
                } else if (a === "--help" || a === "-h") flags.help = true;
                else if (!a.startsWith("-")) {
                        const normalized = a.replace(/^v/, "");
                        if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)) {
                                return { flags, error: `unknown argument: ${a}` };
                        }
                        if (skipPending) {
                                flags.skipVersion = normalized;
                                skipPending = false;
                        } else if (version === undefined) {
                                version = a;
                        } else {
                                return { flags, error: `unknown argument: ${a}` };
                        }
                } else return { flags, error: `unknown argument: ${a}` };
        }
        flags.version = version;
        const prefActions = Number(Boolean(flags.skip)) + Number(Boolean(flags.unskip)) + Number(flags.snooze !== undefined);
        if (prefActions > 1) return { flags, error: "choose one of --skip, --unskip or --snooze" };
        if (prefActions > 0 && (flags.check || flags.background || flags.rollback || flags.version || flags.dryRun)) {
                return {
                        flags,
                        error: "--skip/--unskip/--snooze cannot be combined with --check, --background, --rollback, --dry-run or a target version",
                };
        }
        return { flags };
}

// ---------------------------------------------------------------------------
// Doctor helpers (no network — the notifier cache only)
// ---------------------------------------------------------------------------
/** Short HEAD sha for doctor display; null when git is unavailable. */
export function gitShortSha(root: string, git: GitRunner): string | null {
        const r = git(["rev-parse", "--short", "HEAD"], root);
        return r.code === 0 && r.out ? r.out : null;
}
