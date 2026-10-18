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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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

/** UNOWN_HOME — mirrors term.ts exactly (kept local so tests can point it). */
export function unownHome(env: NodeJS.ProcessEnv = process.env): string {
	return env.UNOWN_HOME ?? join(homedir(), ".unown");
}

// ---------------------------------------------------------------------------
// Semver (core + prerelease; the repo tags are strict `vX.Y.Z`)
// ---------------------------------------------------------------------------
export function parseSemver(v: string): { major: number; minor: number; patch: number; pre: string[] } | null {
	const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v.trim());
	if (!m) return null;
	return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split(".") : [] };
}

/** >0 when a is newer, <0 older, 0 equal. Unparseable versions compare as 0-equal-but-last. */
export function compareSemver(a: string, b: string): number {
	const pa = parseSemver(a);
	const pb = parseSemver(b);
	if (!pa || !pb) {
		// unknown sorts below everything known
		if (!pa && !pb) return 0;
		return !pa ? -1 : 1;
	}
	for (const k of ["major", "minor", "patch"] as const) {
		if (pa[k] !== pb[k]) return pa[k] > pb[k] ? 1 : -1;
	}
	// release > prerelease; identifiers compare numerically when both numeric
	if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
	if (pa.pre.length === 0) return 1;
	if (pb.pre.length === 0) return -1;
	const n = Math.max(pa.pre.length, pb.pre.length);
	for (let i = 0; i < n; i++) {
		const x = pa.pre[i];
		const y = pb.pre[i];
		if (x === undefined) return -1; // fewer fields = lower precedence
		if (y === undefined) return 1;
		const xn = /^\d+$/.test(x);
		const yn = /^\d+$/.test(y);
		if (xn && yn) {
			if (Number(x) !== Number(y)) return Number(x) > Number(y) ? 1 : -1;
		} else if (xn !== yn) {
			return xn ? -1 : 1; // numeric identifiers < alphanumeric
		} else if (x !== y) {
			return x > y ? 1 : -1;
		}
	}
	return 0;
}

// ---------------------------------------------------------------------------
// Git plumbing (injectable for tests)
// ---------------------------------------------------------------------------
export interface GitResult {
	code: number;
	out: string;
	err: string;
}
export type GitRunner = (args: string[], cwd?: string) => GitResult;

export const realGit: GitRunner = (args, cwd) => {
	const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 60_000 });
	return { code: r.status ?? 1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
};

/** Authoritative repo root: `git rev-parse --show-toplevel` from the guess. */
export function resolveRepoRoot(git: GitRunner): string | null {
	const r = git(["rev-parse", "--show-toplevel"], REPO_GUESS);
	return r.code === 0 && r.out ? r.out : null;
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
export interface UpdateCheckCache {
	checkedAt: string;
	latest: string;
	remoteUrl?: string;
	error?: string;
}
export interface UpdateState {
	from: string;
	to: string;
	fromSha: string;
	startedAt: string;
	ok?: boolean;
	rolledBack?: boolean;
	completedAt?: string;
}

export function updateCheckPath(home: string): string {
	return join(home, "update-check.json");
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
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Kill switches
// ---------------------------------------------------------------------------
export function updatesHardDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return /^(1|true|yes)$/i.test(env.UNOWN_DISABLE_UPDATES ?? "");
}
/** Banner + background check opt-outs (manual `unown update` still works). */
export function noticeSuppressed(env: NodeJS.ProcessEnv = process.env): boolean {
	return (
		updatesHardDisabled(env) ||
		/^(1|true|yes)$/i.test(env.UNOWN_DISABLE_AUTOUPDATE ?? "") ||
		env.NO_UPDATE_NOTIFIER !== undefined ||
		/^(1|true|yes)$/i.test(env.DO_NOT_TRACK ?? "")
	);
}

/** Strip credentials from a git remote URL before it is ever printed or
 *  cached on disk (`https://user:token@host/path` → `https://host/path`).
 *  The PAT embedded in this repo's remote URL must never reach output or a
 *  state file — same secrets policy as the root AGENTS.md. */
export function redactUrl(url: string): string {
	// https://user@…, https://user:token@… and ssh://user:token@… → scheme://host/…
	// (git@host:path SCP form carries no password and is left untouched)
	return url.replace(/^(https?:\/\/|ssh:\/\/)[^@/\s]+@/, "$1");
}

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
}
export interface UpdateCtx {
	root?: string; // resolved via git when absent
	home?: string;
	env?: NodeJS.ProcessEnv;
	git?: GitRunner;
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

	const root = ctx.root ?? resolveRepoRoot(git);
	if (!root) {
		log("unown: this install is not a git checkout — cannot self-update.");
		log("  manual update: re-clone the repo and re-run `bun run agent:install`");
		return 1;
	}

	// ---------------------------------------------------------------- check
	if (flags.check) return cmdCheck(root, git, log, flags);

	// ------------------------------------------------------------ background
	if (flags.background) {
		// Detached refresh child: write the cache, say nothing, exit 0.
		const res = checkForUpdate(root, git);
		const cache: UpdateCheckCache = {
			checkedAt: new Date().toISOString(),
			latest: res.latest ?? "",
			remoteUrl: res.remoteUrl ?? undefined,
			...(res.ok ? {} : { error: res.error ?? "check failed" }),
		};
		writeJsonFile(updateCheckPath(home), cache);
		return 0;
	}

	// -------------------------------------------------------------- rollback
	if (flags.rollback) return cmdRollback(root, home, git, ctx, log);

	// ----------------------------------------------------------------- apply
	const current = readRootVersion(root);

	if (isDirty(root, git) && !flags.allowDirty) {
		log(`unown: the checkout has uncommitted changes — refusing to update over them.`);
		log(`  commit or stash them, or pass --allow-dirty (git merge --autostash)`);
		return 1;
	}

	const branch = branchOf(root, git);
	const headTag = tagAtHead(root, git);
	const targetVersion = flags.version?.replace(/^v/, "");

	// Pinned (detached) installs only move with an explicit version.
	if (!branch && !targetVersion) {
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

	// Fast-forward sanity: the target must contain HEAD.
	const headSha = git(["rev-parse", "HEAD"], root).out;
	const descendant = git(["merge-base", "--is-ancestor", "HEAD", targetTag], root);
	if (descendant.code !== 0) {
		log(`unown: cannot fast-forward HEAD to ${targetTag} — the checkout diverged from release history.`);
		log(`  resolve manually (rebase/merge), or roll back with: unown update <older-version>`);
		return 1;
	}

	// Record the rollback point BEFORE anything moves.
	const state: UpdateState = {
		from: current,
		to: targetTag.replace(/^v/, ""),
		fromSha: headSha,
		startedAt: new Date().toISOString(),
	};
	writeJsonFile(updateStatePath(home), state);

	// Apply.
	const apply = branch
		? git(["merge", "--ff-only", ...(flags.allowDirty ? ["--autostash"] : []), targetTag], root)
		: git(["checkout", "--detach", targetTag], root);
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

	// Report.
	log(`✓ unown updated: ${current} → ${targetTag.replace(/^v/, "")}`);
	const slice = changelogSlice(root, current, targetTag.replace(/^v/, ""));
	if (slice.length) {
		log("");
		log(slice.join("\n"));
	}
	log("");
	log(`  release notes: https://github.com/kanishka-namdeo/Unown/releases/tag/${targetTag}`);
	log(`  restart any running unown sessions / \`bun run agent:start\` to pick up the new build`);
	log(`  rollback anytime: unown update --rollback   (or: unown update ${current})`);
	return 0;
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
function cmdCheck(root: string, git: GitRunner, log: (l: string) => void, flags: UpdateFlags): number {
	const res = checkForUpdate(root, git);
	if (flags.json) {
		log(
			JSON.stringify(
				{
					current: res.current,
					latest: res.latest,
					available: res.available,
					remoteUrl: res.remoteUrl,
					checkedAt: new Date().toISOString(),
					error: res.error ?? null,
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
export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;

export interface NoticeInput {
	cache: UpdateCheckCache | null;
	current: string;
	env?: NodeJS.ProcessEnv;
	stdoutIsTty: boolean;
}
/** Pure decision — returns the notice lines to print, or null. */
export function updateNoticeLines(input: NoticeInput): string[] | null {
	const env = input.env ?? process.env;
	if (noticeSuppressed(env) || env.CI !== undefined || !input.stdoutIsTty) return null;
	if (!input.cache?.latest || !parseSemver(input.cache.latest)) return null;
	if (input.cache.error) return null;
	if (compareSemver(input.cache.latest, input.current) <= 0) return null;
	const remote = input.cache.remoteUrl ?? "https://github.com/kanishka-namdeo/Unown";
	const tag = `v${input.cache.latest}`;
	const notes = /github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/.exec(remote);
	const url = notes
		? `https://github.com/${notes[1]}/${notes[2]}/releases/tag/${tag}`
		: `https://github.com/kanishka-namdeo/Unown/releases/tag/${tag}`;
	return [
		`⚠ update available: unown ${input.current} → ${input.cache.latest}`,
		`  run \`unown update\` · notes: ${url} · silence: export NO_UPDATE_NOTIFIER=1`,
	];
}

/** Boot hook: print the cached notice + refresh it in the background (detached). */
export function maybeShowUpdateNotice(): void {
	try {
		const home = unownHome();
		const cache = readJsonFile<UpdateCheckCache>(updateCheckPath(home));
		const current = readRootVersion(REPO_GUESS);
		if (current === "unknown") return; // detached from the repo layout — no version to compare
		const lines = updateNoticeLines({ cache, current, stdoutIsTty: Boolean(process.stdout.isTTY) });
		if (lines) for (const l of lines) console.error(l);
		const age = cache?.checkedAt ? Date.now() - Date.parse(cache.checkedAt) : Number.POSITIVE_INFINITY;
		if (age > UPDATE_CHECK_TTL_MS) spawnBackgroundCheck(home);
	} catch {
		// never let the notifier break a session boot
	}
}

/** Detached, unref'd child running `bin/unown update --check --background`. */
function spawnBackgroundCheck(home: string): void {
	try {
		const bin = join(REPO_GUESS, "bin", "unown");
		if (!existsSync(bin)) return;
		const child = spawn(process.execPath, [bin, "update", "--check", "--background"], {
			stdio: "ignore",
			detached: true,
			env: { ...process.env, UNOWN_HOME: home },
		});
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
  unown update                update to the newest release tag (fast-forward only)
  unown update --check        report only — exit 0 up-to-date, 2 available, 1 error
  unown update --check --json machine-readable result on stdout
  unown update <version>      install a specific version, e.g. unown update 2.1.0
                              (also the manual rollback path / pinned-install moves)
  unown update --allow-dirty  stash-and-restore local changes while updating
  unown update --rollback     undo the last update (restore the recorded commit)

What it does: fetch release tags from origin, fast-forward the checkout to the
newest ready tag, then re-run the installer (dependencies, engine build, PATH
shim). A half-pushed tag (package.json inside it disagreeing with the tag name)
is never offered. If the post-update rebuild fails, the checkout is rolled
back to the pre-update commit automatically.

Refuses when: the tree is dirty (unless --allow-dirty), HEAD is detached on a
tag without an explicit version, or local commits exist that the remote lacks.
Never rebases, merges, or discards your work.

Kill switches:
  UNOWN_DISABLE_UPDATES=1     disable all update paths (org/CI)
  UNOWN_DISABLE_AUTOUPDATE=1  silence the startup notice only
  NO_UPDATE_NOTIFIER=1        same, ecosystem-standard name
  DO_NOT_TRACK=1              also suppresses the background update check

The startup notice is TTY-only, CI-suppressed, cached for 24h in ~/.unown
(outside the repo), and refreshed by a detached background process. It only
talks to your own git remote (git ls-remote); no telemetry of any kind.`;

/** Parse `unown update` flags; the first bare token is an explicit version. */
export function parseUpdateFlags(argv: string[]): { flags: UpdateFlags; error?: string } {
	const flags: UpdateFlags = {};
	let version: string | undefined;
	for (const a of argv) {
		if (a === "--check") flags.check = true;
		else if (a === "--json") flags.json = true;
		else if (a === "--background") flags.background = true;
		else if (a === "--allow-dirty") flags.allowDirty = true;
		else if (a === "--rollback") flags.rollback = true;
		else if (a === "--help" || a === "-h") flags.help = true;
		else if (!a.startsWith("-") && version === undefined && /^[0-9]/.test(a.replace(/^v/, ""))) version = a;
		else return { flags, error: `unknown argument: ${a}` };
	}
	flags.version = version;
	return { flags };
}

// ---------------------------------------------------------------------------
// Doctor helpers (no network — the notifier cache only)
// ---------------------------------------------------------------------------
export function readUpdateCheckCache(home: string): UpdateCheckCache | null {
	return readJsonFile<UpdateCheckCache>(updateCheckPath(home));
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" for an ISO timestamp. */
export function describeAge(iso: string): string {
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return "unknown";
	const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}

/** Short HEAD sha for doctor display; null when git is unavailable. */
export function gitShortSha(root: string, git: GitRunner): string | null {
	const r = git(["rev-parse", "--short", "HEAD"], root);
	return r.code === 0 && r.out ? r.out : null;
}
