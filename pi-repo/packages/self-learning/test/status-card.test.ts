// status-card.test.ts — /status + /diff (the 2026-10-25 visibility pair,
// src/status-card.ts). The sweep's assembly gap: every FACT existed (version,
// model, thinking, permissions, engine, worktree, git, memory) but no
// one-glance view; /commit existed with no way to SEE the tree first.
//
// Pins:
//   1. renderStatusCard — the pure renderer: every section line, every
//      fallback, the absence of sections when their inputs are missing
//   2. collectGitFacts — branch + modified/untracked split, null off-repo
//   3. detectSessionWorktree — inside .unown/worktrees/<name> vs the shared
//      checkout vs off-repo
//   4. registerStatusCommands — /status and /diff against a fake pi + ctx:
//      the card renders end to end, /diff reports a clean tree, lists
//      changes with a cap, --stat mode, off-repo and unavailable-git lanes
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	collectGitFacts,
	detectSessionWorktree,
	registerStatusCommands,
	renderStatusCard,
} from "../src/status-card.ts";
import { TEST_TMP } from "./_env.ts";

const LOADED: string[] = [];
function freshDir(prefix = "sc-status-"): string {
	const d = mkdtempSync(join(TEST_TMP, prefix));
	LOADED.push(d);
	return d;
}
afterAll(() => {
	for (const d of LOADED) rmSync(d, { recursive: true, force: true });
});

function gitAvailable(): boolean {
	try {
		execFileSync("git", ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}
const HAS_GIT = gitAvailable();

/** Minimal pi + ctx that record commands and notify payloads. */
function fakePi() {
	const commands = new Map<
		string,
		{ description: string; handler: (args: string | undefined, ctx: unknown) => Promise<void> }
	>();
	const notifications: Array<{ text: string; level: string }> = [];
	return {
		commands,
		notifications,
		registerCommand(
			name: string,
			def: { description: string; handler: (args: string | undefined, ctx: unknown) => Promise<void> },
		) {
			commands.set(name, def);
		},
		ctx(level = "info") {
			return {
				ui: {
					notify: (text: string, lvl: string) => {
						notifications.push({ text, level: lvl ?? level });
					},
				},
				sessionManager: {
					getSessionId: () => "01234567-89ab-4cde-8f01-234567890abc",
					getSessionName: () => "the-status-test-session",
					getEntries: () => [
						{ type: "message", message: { role: "user", content: "hi" } },
						{
							type: "message",
							message: { role: "assistant", content: [], model: "agnes-3.0-flash", provider: "zai-bridge" },
						},
					],
				},
				getModel: () => ({ id: "agnes-3.0-flash", provider: "zai-bridge" }),
				getThinkingLevel: () => "medium",
			};
		},
	};
}

// ---------------------------------------------------------------------------
// 1. renderStatusCard (pure)
// ---------------------------------------------------------------------------

describe("renderStatusCard", () => {
	test("the full card renders every section line", () => {
		const card = renderStatusCard({
			version: "0.0.16",
			gitSha: "abcdef1234567890",
			sessionId: "01234567-89ab-4cde-8f01-234567890abc",
			sessionName: "demo",
			messageCount: 12,
			model: { provider: "zai-bridge", model: "agnes-3.0-flash" },
			thinkingLevel: "medium",
			permissionMode: "default",
			permissionModeSource: "config",
			engineState: "up",
			engineVersion: "0.0.16",
			worktree: "feature-x",
			git: { branch: "main", modified: 2, untracked: 1 },
			memory: { tiers: ["policy", "project", "user"], chars: 1234 },
			addDirs: 2,
		});
		expect(card).toContain("unown v0.0.16 (abcdef12)");
		expect(card).toContain('"demo" · id 01234567 · 12 message(s)');
		expect(card).toContain("model agnes-3.0-flash via zai-bridge · thinking medium");
		expect(card).toContain("permissions default");
		expect(card).toContain("memory policy + project + user · ~1,234 chars injected");
		expect(card).toContain("engine up (v0.0.16)");
		expect(card).toContain("worktree feature-x");
		expect(card).toContain("git main · 2 modified, 1 untracked (/diff to view)");
		expect(card).toContain("2 add-dir(s)");
	});

	test("a session override marks the permission line; down engine names the outbox", () => {
		const card = renderStatusCard({
			version: "0.0.16",
			permissionMode: "acceptEdits",
			permissionModeSource: "session",
			engineState: "down",
		});
		expect(card).toContain("permissions acceptEdits (session override)");
		expect(card).toContain("engine down (terminal mode — notes queue in the outbox)");
	});

	test("missing sections drop cleanly; off-repo git says so", () => {
		const card = renderStatusCard({ version: "0.0.16", git: null });
		expect(card).toContain("session (in-memory)");
		expect(card).toContain("engine unknown (no probe yet this session)");
		expect(card).toContain("git — not inside a repository");
		expect(card).not.toContain("model ");
	});

	test("an unset model renders the /model pointer; a clean tree says clean", () => {
		const card = renderStatusCard({
			version: "0.0.16",
			model: { model: null },
			git: { branch: "main", modified: 0, untracked: 0 },
		});
		expect(card).toContain("model (unset — see /model)");
		expect(card).toContain("git main · clean");
	});
});

// ---------------------------------------------------------------------------
// 2 + 3. collectors (real git)
// ---------------------------------------------------------------------------

describe("collectGitFacts + detectSessionWorktree", () => {
	test.skipIf(!HAS_GIT)("branch + modified/untracked split; null off-repo", async () => {
		const repo = freshDir("sc-status-repo-");
		const run = (args: string[]) =>
			execFileSync("git", args, {
				cwd: repo,
				env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
			});
		run(["init", "--initial-branch=main"]);
		run(["config", "user.email", "t@t.t"]);
		run(["config", "user.name", "T"]);
		writeFileSync(join(repo, "a.txt"), "one\n");
		run(["add", "."]);
		run(["commit", "-m", "init"]);
		writeFileSync(join(repo, "a.txt"), "one\ntwo\n"); // modified
		writeFileSync(join(repo, "b.txt"), "new\n"); // untracked
		const facts = await collectGitFacts(repo);
		expect(facts).not.toBeNull();
		expect(facts!.branch).toBe("main");
		expect(facts!.modified).toBe(1);
		expect(facts!.untracked).toBe(1);

		const nowhere = freshDir("sc-status-nowhere-");
		expect(await collectGitFacts(nowhere)).toBeNull();
		expect(await detectSessionWorktree(nowhere)).toBeNull();
		// The shared checkout (the repo root itself) is NOT a session worktree.
		expect(await detectSessionWorktree(repo)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 4. registerStatusCommands (fake pi + ctx)
// ---------------------------------------------------------------------------

describe("registerStatusCommands (/status + /diff)", () => {
	test("registers both commands; /status renders the card end to end", async () => {
		const pi = fakePi();
		registerStatusCommands(pi, { cwd: TEST_TMP, version: "9.9.9", verbose: false });
		expect(pi.commands.has("status")).toBeTrue();
		expect(pi.commands.has("diff")).toBeTrue();
		await pi.commands.get("status")!.handler("", pi.ctx());
		const last = pi.notifications[pi.notifications.length - 1];
		expect(last.level).toBe("info");
		expect(last.text).toContain("unown v9.9.9");
		expect(last.text).toContain("session");
	});

	test.skipIf(!HAS_GIT)("/diff: clean tree, then changes with the cap and --stat", async () => {
		const repo = freshDir("sc-diff-repo-");
		const run = (args: string[]) =>
			execFileSync("git", args, {
				cwd: repo,
				env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
			});
		run(["init", "--initial-branch=main"]);
		run(["config", "user.email", "t@t.t"]);
		run(["config", "user.name", "T"]);
		writeFileSync(join(repo, "a.txt"), "one\n");
		run(["add", "."]);
		run(["commit", "-m", "init"]);

		const pi = fakePi();
		registerStatusCommands(pi, { cwd: repo });
		const diff = pi.commands.get("diff")!;
		const ctx = pi.ctx();

		await diff.handler("", ctx);
		expect(pi.notifications[pi.notifications.length - 1].text).toContain("clean");

		writeFileSync(join(repo, "a.txt"), "one\nchanged\n");
		writeFileSync(join(repo, "untracked.txt"), "u\n");
		await diff.handler("", ctx);
		const body = pi.notifications[pi.notifications.length - 1].text;
		expect(body).toContain("2 change(s)");
		expect(body).toContain("untracked: untracked.txt");
		expect(body).toContain("+changed"); // "one" is unchanged context, not a - line

		await diff.handler("--stat", ctx);
		expect(pi.notifications[pi.notifications.length - 1].text).toContain("1 file changed");
	});

	test("/diff off-repo names it; --add-dir-less /status omits the permissions line", async () => {
		const nowhere = freshDir("sc-diff-nowhere-");
		const pi = fakePi();
		registerStatusCommands(pi, { cwd: nowhere });
		await pi.commands.get("diff")!.handler("", pi.ctx());
		expect(pi.notifications[pi.notifications.length - 1].text).toContain("Not inside a git repository");
		await pi.commands.get("status")!.handler("", pi.ctx());
		expect(pi.notifications[pi.notifications.length - 1].text).not.toContain("permissions");
	});
});
