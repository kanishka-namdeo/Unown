// update.test.ts — `unown update` + startup-notification unit and
// integration tests (docs/testing-strategy.md hermetic pattern).
//
// Everything runs against THROWAWAY local git repositories created under the
// test tmpdir: the "remote" is a local directory, so `git ls-remote` /
// `git fetch` never touch the network — the suite is offline-safe and
// deterministic on all three CI operating systems. The real installer spawn
// is injected away (`runInstall` stub), so no bun install/build ever runs.
//
// Conventions: `import "./_env.ts"` first (suite preload contract), explicit
// per-test timeouts (git spawn chains take seconds), no `any`.
import "./_env.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	changelogSlice,
	checkForUpdate,
	cmdChangelog,
	cmdUpdate,
	compareSemver,
	type GitRunner,
	maybeShowUpdateNotice,
	noticeSuppressed,
	parseLsRemoteTags,
	parseSemver,
	parseUpdateFlags,
	pickLatestTag,
	readUpdateCheckCache,
	redactUrl,
	type UpdateCheckCache,
	type UpdateFlags,
	unownHome,
	updateCheckPath,
	updateNoticeLines,
	updateStatePath,
	updatesHardDisabled,
} from "../src/update.ts";

// ---------------------------------------------------------------------------
// Local git plumbing for fixtures (separate from the module under test)
// ---------------------------------------------------------------------------
function git(args: string[], cwd: string): { code: number; out: string; err: string } {
	const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 60_000 });
	return { code: r.status ?? 1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}
const IDENTITY = ["-c", "user.name=unown-test", "-c", "user.email=unown-test@example.com"];

/** Write a repo-shaped package.json + CHANGELOG.md into a git repo. */
function commitVersion(repo: string, version: string, changelogEntry?: string): void {
	writeFileSync(join(repo, "package.json"), `${JSON.stringify({ name: "unown", version }, null, 2)}\n`);
	writeFileSync(
		join(repo, "CHANGELOG.md"),
		"# Changelog\n\n" +
			(changelogEntry ? `## [${version}] - 2026-01-01\n\n${changelogEntry}\n\n` : "") +
			"## [0.0.1] - 2025-01-01\n\ninitial\n",
	);
	const add = git([...IDENTITY, "add", "."], repo);
	if (add.code !== 0) throw new Error(`git add failed: ${add.err}`);
	const commit = git([...IDENTITY, "commit", "-m", `release ${version}`], repo);
	if (commit.code !== 0) throw new Error(`git commit failed: ${commit.err}`);
}

let TMP: string;
let ORIGIN: string;
let WORK: string;
let fixtureSeq = 0;

function makeWorkRepo(): void {
	fixtureSeq++;
	ORIGIN = join(TMP, `origin-${fixtureSeq}`);
	WORK = join(TMP, `work-${fixtureSeq}`);
	mkdirSync(ORIGIN, { recursive: true });
	git(["init", "-b", "main"], ORIGIN);
	commitVersion(ORIGIN, "0.1.0", "first release");
	git(["tag", "v0.1.0"], ORIGIN);
	const clone = git(["clone", ORIGIN, WORK], TMP);
	if (clone.code !== 0) throw new Error(`git clone failed: ${clone.err}`);
}

/** Push a new release into the origin fixture and (by default) leave the
 *  work clone behind: the canonical "update available" state. */
function releaseOnOrigin(version: string, tag = `v${version}`, fileVersion = version): void {
	commitVersion(ORIGIN, fileVersion, `changes for ${version}`);
	git(["tag", tag], ORIGIN);
}

const loggingGit: GitRunner = (args, cwd) => git(args, cwd ?? WORK);

function capturedLog(): { lines: string[]; log: (l: string) => void } {
	const lines: string[] = [];
	return { lines, log: (l: string) => lines.push(l) };
}

async function run(
	flags: UpdateFlags,
	extra: { runInstall?: (root: string) => number } = {},
): Promise<{ code: number; lines: string[] }> {
	const { lines, log } = capturedLog();
	const code = await cmdUpdate(flags, {
		root: WORK,
		home: TMP,
		env: {},
		git: loggingGit,
		runInstall: extra.runInstall ?? (() => 0),
		log,
	});
	return { code, lines };
}

beforeAll(() => {
	TMP = mkdtempSync(join(tmpdir(), "unown-update-"));
	try {
		TMP = realpathSync(TMP); // darwin /var → /private/var symlink chain
	} catch {
		// keep the literal spelling
	}
});

afterAll(() => {
	if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// semver
// ---------------------------------------------------------------------------
describe("compareSemver", () => {
	test("major/minor/patch ordering", () => {
		expect(compareSemver("2.1.0", "2.0.0")).toBe(1);
		expect(compareSemver("2.0.1", "2.0.0")).toBe(1);
		expect(compareSemver("2.0.0", "2.0.0")).toBe(0);
		expect(compareSemver("10.0.0", "9.9.9")).toBe(1);
		expect(compareSemver("v2.0.0", "2.0.0")).toBe(0);
	});
	test("prerelease precedence", () => {
		expect(compareSemver("2.1.0", "2.1.0-rc1")).toBe(1);
		expect(compareSemver("2.1.0-rc1", "2.1.0-rc2")).toBe(-1);
		expect(compareSemver("2.1.0-1", "2.1.0-alpha")).toBe(-1); // numeric < alphanumeric (semver spec)
		expect(compareSemver("2.1.0-rc2", "2.1.0-rc10")).toBe(1); // LEXICAL compare ("rc10" < "rc2") — the known semver gotcha
		expect(compareSemver("2.1.0-2", "2.1.0-10")).toBe(-1); // numeric identifiers compare numerically
	});
	test("unparseable sorts below", () => {
		expect(compareSemver("unknown", "0.0.1")).toBe(-1);
		expect(compareSemver("unknown", "unknown")).toBe(0);
	});
});

test("parseSemver accepts v-prefixed and prerelease", () => {
	expect(parseSemver("v1.2.3")?.minor).toBe(2);
	expect(parseSemver("1.2.3-rc.1")?.pre).toEqual(["rc", "1"]);
	expect(parseSemver("banana")).toBeNull();
});

// ---------------------------------------------------------------------------
// git output parsing
// ---------------------------------------------------------------------------
test("parseLsRemoteTags extracts v-tags only, sha-prefixed lines", () => {
	const out = [
		"0123456789abcdef0123456789abcdef01234567\trefs/tags/v1.0.0",
		"fedcba9876543210fedcba9876543210fedcba98\trefs/tags/v1.1.0",
		"0123456789abcdef0123456789abcdef01234567\trefs/heads/main",
		"0123456789abcdef0123456789abcdef01234567\trefs/tags/vX", // malformed — dropped
	].join("\n");
	expect(parseLsRemoteTags(out).sort()).toEqual(["1.0.0", "1.1.0"]);
});

test("pickLatestTag", () => {
	expect(pickLatestTag(["1.9.0", "1.10.0", "0.9.9"])).toBe("1.10.0");
	expect(pickLatestTag([])).toBeNull();
	expect(pickLatestTag(["a", "b"])).toBeNull();
});

test("redactUrl strips embedded credentials, keeps clean URLs (PAT leak guard)", () => {
	expect(redactUrl("https://kanishka-namdeo:github_pat_SECRET@github.com/x/y.git")).toBe("https://github.com/x/y.git");
	expect(redactUrl("https://token@github.com/x/y.git")).toBe("https://github.com/x/y.git");
	expect(redactUrl("ssh://user:pass@host/x.git")).toBe("ssh://host/x.git");
	expect(redactUrl("https://github.com/x/y.git")).toBe("https://github.com/x/y.git");
	expect(redactUrl("git@github.com:x/y.git")).toBe("git@github.com:x/y.git"); // SCP form: no password
});

// ---------------------------------------------------------------------------
// flag parsing + kill switches
// ---------------------------------------------------------------------------
describe("parseUpdateFlags", () => {
	test("flags and explicit version", () => {
		expect(parseUpdateFlags(["--check", "--json"])).toEqual({ flags: { check: true, json: true } });
		expect(parseUpdateFlags(["2.1.0"]).flags.version).toBe("2.1.0");
		expect(parseUpdateFlags(["v2.1.0"]).flags.version).toBe("v2.1.0");
		expect(parseUpdateFlags(["--allow-dirty", "--rollback"]).flags).toEqual({ allowDirty: true, rollback: true });
	});
	test("unknown flag errors", () => {
		expect(parseUpdateFlags(["--wat"]).error).toBeDefined();
		expect(parseUpdateFlags(["--check", "2.1.0", "3.0.0"]).error).toBeDefined(); // second bare token
	});
});

describe("kill switches", () => {
	test("hard disable", () => {
		expect(updatesHardDisabled({ UNOWN_DISABLE_UPDATES: "1" })).toBe(true);
		expect(updatesHardDisabled({ UNOWN_DISABLE_UPDATES: "false" })).toBe(false);
		expect(updatesHardDisabled({})).toBe(false);
	});
	test("notice suppression — ecosystem + unown envs + DO_NOT_TRACK", () => {
		expect(noticeSuppressed({ NO_UPDATE_NOTIFIER: "any" })).toBe(true);
		expect(noticeSuppressed({ NO_UPDATE_NOTIFIER: "" })).toBe(true); // defined-but-empty counts (npm convention)
		expect(noticeSuppressed({ UNOWN_DISABLE_AUTOUPDATE: "1" })).toBe(true);
		expect(noticeSuppressed({ DO_NOT_TRACK: "1" })).toBe(true);
		expect(noticeSuppressed({ UNOWN_DISABLE_UPDATES: "1" })).toBe(true);
		expect(noticeSuppressed({})).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// startup notice decision
// ---------------------------------------------------------------------------
describe("updateNoticeLines", () => {
	const cache: UpdateCheckCache = {
		checkedAt: new Date().toISOString(),
		latest: "2.1.0",
		remoteUrl: "https://github.com/kanishka-namdeo/Unown.git",
	};
	test("shows when a newer version is cached", () => {
		const lines = updateNoticeLines({ cache, current: "2.0.0", env: {}, stdoutIsTty: true });
		expect(lines).not.toBeNull();
		expect(lines?.[0]).toContain("2.0.0");
		expect(lines?.[0]).toContain("2.1.0");
		expect(lines?.[1]).toContain("unown update");
		expect(lines?.[1]).toContain("releases/tag/v2.1.0");
	});
	test("silent when current, non-tty, CI, opted out, or errored", () => {
		expect(updateNoticeLines({ cache, current: "2.1.0", env: {}, stdoutIsTty: true })).toBeNull();
		expect(updateNoticeLines({ cache, current: "2.0.0", env: {}, stdoutIsTty: false })).toBeNull();
		expect(updateNoticeLines({ cache, current: "2.0.0", env: { CI: "true" }, stdoutIsTty: true })).toBeNull();
		expect(
			updateNoticeLines({ cache, current: "2.0.0", env: { NO_UPDATE_NOTIFIER: "1" }, stdoutIsTty: true }),
		).toBeNull();
		expect(
			updateNoticeLines({ cache: { ...cache, error: "offline" }, current: "2.0.0", env: {}, stdoutIsTty: true }),
		).toBeNull();
		expect(updateNoticeLines({ cache: null, current: "2.0.0", env: {}, stdoutIsTty: true })).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// changelog
// ---------------------------------------------------------------------------
test("changelogSlice returns sections in (from, to]", () => {
	const fixture = join(TMP, "changelog-fixture");
	mkdirSync(fixture, { recursive: true });
	writeFileSync(
		join(fixture, "CHANGELOG.md"),
		"# Changelog\n\n## [0.3.0] - 2026-03-03\n\n- third\n\n## [0.2.0] - 2026-02-02\n\n- second\n\n## [0.1.0] - 2026-01-01\n\n- first\n",
	);
	const slice = changelogSlice(fixture, "0.1.0", "0.3.0");
	expect(slice.join("\n")).toContain("[0.3.0]");
	expect(slice.join("\n")).toContain("[0.2.0]");
	expect(slice.join("\n")).not.toContain("[0.1.0]");
	expect(slice.join("\n")).toContain("- third");
	expect(changelogSlice(join(TMP, "no-such-dir"), "0.1.0", "0.2.0")).toEqual([]);
});

// ---------------------------------------------------------------------------
// integration: real git, local remote, injected installer
// ---------------------------------------------------------------------------
describe("cmdUpdate against a local git remote", () => {
	test("up to date when the remote has no newer tag", async () => {
		makeWorkRepo();
		const r = await run({});
		expect(r.code).toBe(0);
		expect(r.lines.join("\n")).toContain("up to date");
		expect(readRootVersionFile(WORK)).toBe("0.1.0");
	}, 60_000);

	test("applies the newest ready tag and records rollback state", async () => {
		makeWorkRepo();
		releaseOnOrigin("0.2.0");
		const r = await run({});
		expect(r.code).toBe(0);
		expect(r.lines.join("\n")).toContain("unown updated: 0.1.0 → 0.2.0");
		expect(readRootVersionFile(WORK)).toBe("0.2.0");
		const state = JSON.parse(readFileSync(updateStatePath(TMP), "utf8"));
		expect(state.from).toBe("0.1.0");
		expect(state.to).toBe("0.2.0");
		expect(state.ok).toBe(true);
		expect(state.fromSha).toMatch(/^[0-9a-f]{40}$/);
	}, 60_000);

	test("--check reports availability without mutating (exit 2)", async () => {
		makeWorkRepo();
		releaseOnOrigin("0.3.0");
		const headBefore = git(["rev-parse", "HEAD"], WORK).out;
		const r = await run({ check: true });
		expect(r.code).toBe(2);
		expect(r.lines.join("\n")).toContain("0.3.0");
		expect(git(["rev-parse", "HEAD"], WORK).out).toBe(headBefore);
	}, 60_000);

	test("--check --json is machine-readable", async () => {
		makeWorkRepo();
		releaseOnOrigin("0.4.0");
		const r = await run({ check: true, json: true });
		const parsed = JSON.parse(r.lines.join("\n"));
		expect(parsed.current).toBe("0.1.0");
		expect(parsed.latest).toBe("0.4.0");
		expect(parsed.available).toBe(true);
		expect(r.code).toBe(2);
	}, 60_000);

	test("refuses a dirty tree without --allow-dirty", async () => {
		makeWorkRepo();
		releaseOnOrigin("0.5.0");
		writeFileSync(join(WORK, "local-notes.txt"), "wip");
		const r = await run({});
		expect(r.code).toBe(1);
		expect(r.lines.join("\n")).toContain("uncommitted changes");
		expect(readRootVersionFile(WORK)).toBe("0.1.0");
	}, 60_000);

	test("--allow-dirty autostashes and restores local edits", async () => {
		makeWorkRepo();
		releaseOnOrigin("0.6.0");
		writeFileSync(join(WORK, "local-notes.txt"), "wip");
		const r = await run({ allowDirty: true });
		expect(r.code).toBe(0);
		expect(readRootVersionFile(WORK)).toBe("0.6.0");
		expect(readFileSync(join(WORK, "local-notes.txt"), "utf8")).toBe("wip");
	}, 60_000);

	test("refuses a pinned (detached) install without an explicit version", async () => {
		makeWorkRepo();
		releaseOnOrigin("0.7.0");
		git(["checkout", "--detach", "v0.1.0"], WORK);
		const r = await run({});
		expect(r.code).toBe(1);
		expect(r.lines.join("\n")).toContain("pinned");
	}, 60_000);

	test("explicit version moves a pinned install (checkout path)", async () => {
		makeWorkRepo();
		releaseOnOrigin("0.8.0");
		git(["fetch", "origin", "--tags"], WORK);
		git(["checkout", "--detach", "v0.1.0"], WORK);
		const r = await run({ version: "0.8.0" });
		expect(r.code).toBe(0);
		expect(readRootVersionFile(WORK)).toBe("0.8.0");
		const described = git(["describe", "--tags", "--exact-match", "HEAD"], WORK);
		expect(described.out).toBe("v0.8.0");
	}, 60_000);

	test("refuses when local commits are ahead of the remote", async () => {
		makeWorkRepo();
		releaseOnOrigin("0.9.0");
		writeFileSync(join(WORK, "extra.txt"), "local work");
		git([...IDENTITY, "add", "."], WORK);
		git([...IDENTITY, "commit", "-m", "local ahead"], WORK);
		const r = await run({});
		expect(r.code).toBe(1);
		expect(r.lines.join("\n")).toContain("local commit");
	}, 60_000);

	test("a half-pushed tag (package.json disagrees) is never offered", async () => {
		makeWorkRepo();
		releaseOnOrigin("1.0.0", "v1.0.0", "0.1.0"); // tag says 1.0.0, file says 0.1.0
		releaseOnOrigin("0.9.5");
		const r = await run({});
		expect(r.code).toBe(0);
		expect(readRootVersionFile(WORK)).toBe("0.9.5"); // skipped the broken 1.0.0 tag
		expect(r.lines.join("\n")).toContain("0.9.5");
	}, 60_000);

	test("explicit version targeting a broken tag is refused", async () => {
		makeWorkRepo();
		releaseOnOrigin("1.0.0", "v1.0.0", "0.1.0");
		const r = await run({ version: "1.0.0" });
		expect(r.code).toBe(1);
		expect(r.lines.join("\n")).toContain("broken release");
	}, 60_000);

	test("unknown explicit version lists available releases", async () => {
		makeWorkRepo();
		releaseOnOrigin("0.2.5");
		const r = await run({ version: "9.9.9" });
		expect(r.code).toBe(1);
		expect(r.lines.join("\n")).toContain("not found");
		expect(r.lines.join("\n")).toContain("0.2.5");
	}, 60_000);

	test("install failure triggers automatic rollback", async () => {
		makeWorkRepo();
		releaseOnOrigin("0.3.0");
		const headBefore = git(["rev-parse", "HEAD"], WORK).out;
		const r = await run({}, { runInstall: () => 1 });
		expect(r.code).toBe(1);
		expect(r.lines.join("\n")).toContain("rolling back");
		expect(git(["rev-parse", "HEAD"], WORK).out).toBe(headBefore);
		expect(readRootVersionFile(WORK)).toBe("0.1.0");
		const state = JSON.parse(readFileSync(updateStatePath(TMP), "utf8"));
		expect(state.rolledBack).toBe(true);
	}, 60_000);

	test("version-verify failure (install corrupted the file) also rolls back", async () => {
		makeWorkRepo();
		releaseOnOrigin("0.4.0");
		const headBefore = git(["rev-parse", "HEAD"], WORK).out;
		// an install step that "succeeds" but writes a wrong version ONCE —
		// the anti-shadowing verify must catch it and roll back
		let corrupted = false;
		const r = await run(
			{},
			{
				runInstall: () => {
					if (corrupted) return 0; // the post-rollback rebuild behaves
					corrupted = true;
					writeFileSync(join(WORK, "package.json"), `${JSON.stringify({ name: "unown", version: "0.0.0" })}\n`);
					return 0;
				},
			},
		);
		expect(r.code).toBe(1);
		expect(r.lines.join("\n")).toContain("version verify failed");
		expect(git(["rev-parse", "HEAD"], WORK).out).toBe(headBefore);
		expect(readRootVersionFile(WORK)).toBe("0.1.0");
	}, 60_000);

	test("--rollback restores the recorded pre-update state", async () => {
		makeWorkRepo();
		releaseOnOrigin("0.5.0");
		expect((await run({})).code).toBe(0);
		expect(readRootVersionFile(WORK)).toBe("0.5.0");
		const r = await run({ rollback: true });
		expect(r.code).toBe(0);
		expect(readRootVersionFile(WORK)).toBe("0.1.0");
		expect(r.lines.join("\n")).toContain("rolled back");
	}, 60_000);

	test("--check against an unreachable remote exits 1 (offline-safe)", async () => {
		makeWorkRepo();
		releaseOnOrigin("0.6.0");
		// repoint origin at a nonexistent local path
		git(["remote", "set-url", "origin", join(TMP, "no-such-remote")], WORK);
		const r = await run({ check: true });
		expect(r.code).toBe(1);
		expect(r.lines.join("\n")).toContain("update check failed");
	}, 60_000);

	test("--background writes the notifier cache silently", async () => {
		makeWorkRepo();
		releaseOnOrigin("0.7.0");
		const r = await run({ background: true });
		expect(r.code).toBe(0);
		expect(r.lines.length).toBe(0);
		const cache = readUpdateCheckCache(TMP);
		expect(cache?.latest).toBe("0.7.0");
		expect(cache?.remoteUrl).toContain("origin");
		expect(cache?.checkedAt).toBeDefined();
	}, 60_000);

	test("UNOWN_DISABLE_UPDATES hard-blocks every path", async () => {
		makeWorkRepo();
		releaseOnOrigin("0.8.0");
		const { lines, log } = capturedLog();
		const code = await cmdUpdate(
			{},
			{ root: WORK, home: TMP, env: { UNOWN_DISABLE_UPDATES: "1" }, git: loggingGit, runInstall: () => 0, log },
		);
		expect(code).toBe(0);
		expect(lines.join("\n")).toContain("updates disabled");
		expect(readRootVersionFile(WORK)).toBe("0.1.0"); // nothing ran
	}, 60_000);

	test("checkForUpdate reads the real remote read-only", () => {
		makeWorkRepo();
		releaseOnOrigin("0.9.0");
		const res = checkForUpdate(WORK, loggingGit);
		expect(res.ok).toBe(true);
		expect(res.current).toBe("0.1.0");
		expect(res.latest).toBe("0.9.0");
		expect(res.available).toBe(true);
	}, 60_000);

	test("a PAT embedded in the remote URL never reaches the result (leak guard)", async () => {
		makeWorkRepo();
		releaseOnOrigin("0.9.5");
		// credential-bearing remote; ls-remote to the unreachable host fails —
		// the remoteUrl in the result AND the notifier cache must still be redacted
		git(
			["remote", "set-url", "origin", "https://kanishka-namdeo:github_pat_LEAK@github.example.invalid/x/y.git"],
			WORK,
		);
		const r = await run({ background: true });
		expect(r.code).toBe(0);
		const raw = readFileSync(updateCheckPath(TMP), "utf8");
		expect(raw).not.toContain("LEAK");
		expect(raw).not.toContain("github_pat");
		const cache = readUpdateCheckCache(TMP);
		expect(cache?.remoteUrl).toBe("https://github.example.invalid/x/y.git");
		const res = checkForUpdate(WORK, loggingGit);
		expect(res.remoteUrl).not.toContain("LEAK");
	}, 60_000);
});

// ---------------------------------------------------------------------------
// changelog command + notice boot hook
// ---------------------------------------------------------------------------
describe("cmdChangelog", () => {
	test("prints the latest section and footer", () => {
		makeWorkRepo();
		const { lines, log } = capturedLog();
		const code = cmdChangelog([], { root: WORK, log });
		expect(code).toBe(0);
		const text = lines.join("\n");
		expect(text).toContain("[0.1.0]");
		expect(text).toContain("first release");
		expect(text).toContain("full changelog");
	});
	test("n sections and missing-changelog error", () => {
		makeWorkRepo();
		releaseOnOrigin("0.2.0", "v0.2.0");
		git(["fetch", "origin", "--tags"], WORK);
		git(["merge", "--ff-only", "v0.2.0"], WORK); // move the work tree to the release
		const { lines, log } = capturedLog();
		const code = cmdChangelog(["2"], { root: WORK, log });
		expect(code).toBe(0);
		expect(lines.join("\n")).toContain("[0.2.0");
		const missing = cmdChangelog([], { root: TMP, log: () => {} });
		expect(missing).toBe(1);
	});
});

test("maybeShowUpdateNotice prints nothing when suppressed (smoke: no throw)", () => {
	const prevHome = process.env.UNOWN_HOME;
	process.env.UNOWN_HOME = TMP;
	process.env.NO_UPDATE_NOTIFIER = "1";
	expect(() => maybeShowUpdateNotice()).not.toThrow();
	delete process.env.NO_UPDATE_NOTIFIER;
	process.env.UNOWN_HOME = prevHome;
});

test("unownHome mirrors term.ts resolution", () => {
	expect(unownHome({})).toBe(join(process.env.HOME ?? "", ".unown"));
	expect(unownHome({ UNOWN_HOME: "/custom" })).toBe("/custom");
});

test("state paths live under the given home, never the repo", () => {
	expect(updateCheckPath("/home/x").startsWith("/home/x")).toBe(true);
	expect(updateStatePath("/home/x").startsWith("/home/x")).toBe(true);
});

function readRootVersionFile(root: string): string {
	return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
}
