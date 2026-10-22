// Unit tests for src/gittools.ts — the git-native commit workflow (the
// aider/Codex port): hardened git plumbing, porcelain parsing, the commit
// flow, deterministic message templates, and the extension wiring (/commit
// command + the opt-in UNOWN_AUTO_COMMIT session-shutdown snapshot).
//
// These run against REAL temp git repositories (git 2.47 on PATH; the suite
// skips with a visible reason when git is absent, so it stays green on
// git-less hosts). The identity-fallback test redirects
// GIT_CONFIG_GLOBAL/GIT_CONFIG_SYSTEM/HOME so a fresh clone with NO
// user.name/user.email anywhere is simulated deterministically — regardless
// of the host machine's own git identity.
//
// These tests run on `bun test` (bun:test is built in — zero new deps).
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    autoCommitEnabled,
    commitAll,
    generateAutoCommitMessage,
    generateCommitMessage,
    gitAvailable,
    gitWorkflowSuppressed,
    hasStagedOrUnstagedChanges,
    hooksDisabledArgs,
    isGitRepo,
    mutationGitArgs,
    parsePorcelain,
    porcelainStatus,
    readOnlyGitArgs,
    recentAssistantSummary,
    registerGitTools,
    resetGitAvailableCache,
    runGit,
    runGitSync,
    summarizePorcelain,
    summarizeToSubject,
} from "../src/gittools.ts";
import { createUnownToolsExtension } from "../src/tools.ts";

const GIT_ON_PATH = await gitAvailable();

/** Plain git for test SETUP and assertions (spawnSync, args array, no shell). */
function gitSh(cwd: string, args: string[], env: Record<string, string> = {}): string {
    const res = spawnSync("git", args, {
        cwd,
        shell: false,
        encoding: "utf8",
        env: { ...process.env, ...env },
    });
    if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
    return res.stdout ?? "";
}

const rootTmp = mkdtempSync(join(tmpdir(), "unown-gittools-"));
afterAll(() => {
    try {
        rmSync(rootTmp, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

/** A fresh git repo with an initial clean commit. Repo-local identity so
 *  the suite is hermetic on any host: CI runners (and git-less fresh clones
 *  via the isolated fallback test aside) ship no default user.name/email,
 *  and the initial commit would die with "Author identity unknown". */
function makeRepo(name: string): string {
    const dir = join(rootTmp, name);
    mkdirSync(dir, { recursive: true });
    gitSh(dir, ["init"]);
    gitSh(dir, ["config", "user.name", "unown-test"]);
    gitSh(dir, ["config", "user.email", "unown-test@local"]);
    writeFileSync(join(dir, "README.md"), "# test\n");
    gitSh(dir, ["add", "-A"]);
    gitSh(dir, ["commit", "-m", "chore: initial state"]);
    return dir;
}

/** Temporarily patch process.env; returns a restore function. */
function patchEnv(patch: Record<string, string>): () => void {
    const prev = new Map<string, string | undefined>();
    for (const [k, v] of Object.entries(patch)) {
        prev.set(k, process.env[k]);
        process.env[k] = v;
    }
    return () => {
        for (const [k, v] of prev) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    };
}

// ---------------------------------------------------------------------------
// Repo detection + porcelain
// ---------------------------------------------------------------------------

describe("isGitRepo", () => {
    test.skipIf(!GIT_ON_PATH)("true inside an initialized repo (and its subdirs)", async () => {
        const repo = makeRepo("isrepo");
        expect(await isGitRepo(repo)).toBe(true);
        mkdirSync(join(repo, "nested", "deep"), { recursive: true });
        expect(await isGitRepo(join(repo, "nested", "deep"))).toBe(true);
    });

    test.skipIf(!GIT_ON_PATH)("false for a plain directory", async () => {
        const dir = join(rootTmp, "not-a-repo");
        mkdirSync(dir, { recursive: true });
        expect(await isGitRepo(dir)).toBe(false);
    });
});

describe("parsePorcelain (porcelain v1)", () => {
    test("parses staged, unstaged, untracked and rename entries", () => {
        const entries = parsePorcelain(
            [" M modified.ts", "A  added.ts", "D  deleted.ts", "?? dir/", "R  old.ts -> new.ts", "MM both.ts", "", "x"].join(
                "\n",
            ),
        );
        expect(entries).toHaveLength(6);
        const byPath = new Map(entries.map((e) => [e.path, e]));
        expect(byPath.get("modified.ts")).toMatchObject({ x: " ", y: "M", untracked: false });
        expect(byPath.get("added.ts")).toMatchObject({ x: "A", y: " ", untracked: false });
        expect(byPath.get("dir/")).toMatchObject({ x: "?", y: "?", untracked: true });
        expect(byPath.get("old.ts -> new.ts")).toMatchObject({ x: "R" });
        expect(byPath.get("both.ts")).toMatchObject({ x: "M", y: "M" });
    });

    test("summarizePorcelain renders compact counts", () => {
        const entries = parsePorcelain([" M a.ts", " M b.ts", "A  c.ts", "?? d/", "D  e.ts"].join("\n"));
        expect(summarizePorcelain(entries)).toBe("2 modified, 1 added, 1 deleted, 1 untracked");
        expect(summarizePorcelain([])).toBe("no changes");
    });
});

describe("porcelainStatus + hasStagedOrUnstagedChanges", () => {
    test.skipIf(!GIT_ON_PATH)("clean repo → no changes; dirty (staged or untracked) → changes", async () => {
        const repo = makeRepo("porcelain");
        expect(await hasStagedOrUnstagedChanges(repo)).toBe(false);

        writeFileSync(join(repo, "new-file.ts"), "export {};\n"); // untracked
        expect(await hasStagedOrUnstagedChanges(repo)).toBe(true);

        gitSh(repo, ["add", "new-file.ts"]); // staged-only now
        expect(await hasStagedOrUnstagedChanges(repo)).toBe(true);
        expect((await porcelainStatus(repo)).map((e) => e.path)).toEqual(["new-file.ts"]);

        gitSh(repo, ["commit", "-m", "add new-file"]);
        expect(await hasStagedOrUnstagedChanges(repo)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Message templates
// ---------------------------------------------------------------------------

describe("generateCommitMessage / generateAutoCommitMessage", () => {
    const date = new Date("2026-10-19T12:34:56Z");

    test("session template from a summary: subject + plain-ASCII trailer", () => {
        expect(generateCommitMessage("Fixed the login redirect loop and added tests", date)).toBe(
            "unown(session): Fixed the login redirect loop and added tests\n\nGenerated-by: unown",
        );
    });

    test("no reachable summary → dated work-snapshot fallback", () => {
        expect(generateCommitMessage(undefined, date)).toBe("unown(session): work snapshot 2026-10-19\n\nGenerated-by: unown");
        expect(generateCommitMessage("   \n \n", date)).toBe("unown(session): work snapshot 2026-10-19\n\nGenerated-by: unown");
    });

    test("summary is sanitized: first line only, bullets/headings stripped, whitespace collapsed", () => {
        expect(summarizeToSubject("## Fix the thing\n\nDetails below")).toBe("Fix the thing");
        expect(summarizeToSubject("- bullet point summary")).toBe("bullet point summary");
        expect(summarizeToSubject("line one\nline two")).toBe("line one");
        expect(generateCommitMessage("  Fixed   the\n\nbody text\n", date)).toBe(
            "unown(session): Fixed the\n\nGenerated-by: unown",
        );
    });

    test("subject line stays within the conventional 72-char cap", () => {
        const long = "x".repeat(200);
        const message = generateCommitMessage(long, date);
        const subject = message.split("\n")[0];
        expect(subject.length).toBeLessThanOrEqual(72);
        expect(subject.startsWith("unown(session): ")).toBe(true);
    });

    test("templates are plain ASCII (no emoji anywhere, per the trailer contract)", () => {
        expect(generateCommitMessage("summary", date)).toMatch(/^[\x20-\x7e\n]+$/);
        expect(generateAutoCommitMessage(date)).toMatch(/^[\x20-\x7e\n]+$/);
    });

    test("auto template is the dated session-end snapshot", () => {
        expect(generateAutoCommitMessage(date)).toBe("unown(auto): session end snapshot 2026-10-19\n\nGenerated-by: unown");
    });
});

// ---------------------------------------------------------------------------
// GitSpawn neutralization — the hardened arg sets (pure)
// ---------------------------------------------------------------------------

describe("GitSpawn neutralization arg sets", () => {
    test("readOnlyGitArgs(): hooksPath + --no-optional-locks + fsmonitor + sshCommand + askPass + pager, in that order", () => {
        const args = readOnlyGitArgs();
        // The hooks override leads (private empty temp dir — win32-safe, never
        // /dev/null), then the global flag, then every exec/prompt sink.
        expect(args[0]).toBe("-c");
        expect(args[1]).toMatch(/^core\.hooksPath=.+unown-git-hooks-off-/);
        expect(args.slice(2)).toEqual([
            "--no-optional-locks",
            "-c", "core.fsmonitor=false", // GitSpawn primary sink
            "-c", "core.sshCommand=ssh", // exec sink on any fetch/push
            "-c", "core.askPass=", // credential-prompt exec sink (empty = off)
            "-c", "core.pager=", // pager exec sink (empty = off)
        ]);
        // Cross-platform contract: no POSIX-only literals anywhere in the set.
        expect(args.some((a) => a.includes("/dev/null"))).toBe(false);
    });

    test("mutationGitArgs(): fsmonitor + sshCommand ONLY — hooksPath, askPass, pager and --no-optional-locks must stay out", () => {
        // The commit path keeps the user's hooks live on purpose (husky /
        // lint-staged gate agent commits); only the exec sinks no legitimate
        // workflow depends on are closed. Exact shape — nothing else rides
        // along on `git add` / `git commit`.
        expect(mutationGitArgs()).toEqual(["-c", "core.fsmonitor=false", "-c", "core.sshCommand=ssh"]);
    });

    test("the hooks dir is one private empty dir per process, not per call", () => {
        expect(hooksDisabledArgs()).toEqual(hooksDisabledArgs());
    });
});

// ---------------------------------------------------------------------------
// GitSpawn regression — a repo-local core.fsmonitor must never execute
// (https://shattered.io/gitspawn-ai-coding-agent-vulnerability-2026/)
// ---------------------------------------------------------------------------

/** The disclosure's exact setup: `.git/config` core.fsmonitor points at a
 *  script that touches a marker file. Plain `git status` EXECUTES it (the
 *  POSIX control proves the fixture is a live sink, so these tests can never
 *  silently rot into vacuous green); every hardened invocation must not. */
function makeHostileFsmonitorRepo(name: string): { repo: string; marker: string } {
    const repo = makeRepo(name);
    const marker = join(rootTmp, `${name}-fsmonitor-ran`);
    const script = join(rootTmp, `${name}-evil-fsmonitor.sh`);
    writeFileSync(script, `#!/bin/sh\ntouch "${marker}"\n`);
    try {
        chmodSync(script, 0o755);
    } catch {
        /* win32: exec bit is a no-op there; the control assertion is skipped */
    }
    gitSh(repo, ["config", "core.fsmonitor", script]);
    return { repo, marker };
}

const POSIX_HOST = process.platform !== "win32";

describe("GitSpawn regression (core.fsmonitor exec sink)", () => {
    test.skipIf(!GIT_ON_PATH)(
        "read-only probes (status/rev-parse) never execute a hostile repo-local core.fsmonitor",
        async () => {
            const { repo, marker } = makeHostileFsmonitorRepo("gitspawn-ro");
            // CONTROL (POSIX only — the exec bit is what makes the sink live):
            // plain git status runs the hostile helper → the fixture is real.
            if (POSIX_HOST) {
                gitSh(repo, ["status", "--porcelain"]);
                expect(existsSync(marker)).toBe(true);
                rmSync(marker, { force: true });
            }
            // The hardened probes must see the repo without running it.
            expect(await porcelainStatus(repo)).toEqual([]);
            expect(await isGitRepo(repo)).toBe(true);
            expect(existsSync(marker)).toBe(false);
        },
    );

    test.skipIf(!GIT_ON_PATH)(
        "the mutation path (add/commit) neutralizes fsmonitor but keeps the user's hooks LIVE (the documented contract)",
        async () => {
            const { repo, marker } = makeHostileFsmonitorRepo("gitspawn-mutation");
            // A real user pre-commit hook (husky-style gate): it must RUN —
            // only POSIX can prove execution (shebang exec); everywhere else
            // we still prove the commit succeeds and fsmonitor stays silent.
            const hookMarker = join(rootTmp, "gitspawn-mutation-hook-ran");
            writeFileSync(join(repo, ".git", "hooks", "pre-commit"), `#!/bin/sh\ntouch "${hookMarker}"\n`);
            try {
                chmodSync(join(repo, ".git", "hooks", "pre-commit"), 0o755);
            } catch {
                /* win32 no-op */
            }
            writeFileSync(join(repo, "feature.ts"), "export const x = 1;\n");
            const outcome = await commitAll(repo, "feat: mutation-path hardening");
            expect(outcome.ok).toBe(true);
            if (!outcome.ok) return;
            expect(existsSync(marker)).toBe(false); // fsmonitor sink closed on add/commit
            if (POSIX_HOST) {
                expect(existsSync(hookMarker)).toBe(true); // user hooks still gate the commit
            }
            expect(gitSh(repo, ["log", "-1", "--pretty=%B"]).trim()).toBe("feat: mutation-path hardening");
        },
    );

    test.skipIf(!GIT_ON_PATH)("runGitSync mirrors runGit: readOnly hardening, typed gitMissing, never throws", async () => {
        const { repo, marker } = makeHostileFsmonitorRepo("gitspawn-sync");
        const ok = runGitSync(repo, ["rev-parse", "HEAD"], { readOnly: true });
        expect(ok.code).toBe(0);
        expect(ok.stdout.trim()).toMatch(/^[0-9a-f]{40}$/);
        expect(existsSync(marker)).toBe(false);
        // git missing entirely → typed result, not a throw
        const emptyBin = join(rootTmp, "empty-bin-sync");
        mkdirSync(emptyBin, { recursive: true });
        const restore = patchEnv({ PATH: emptyBin });
        try {
            const missing = runGitSync(repo, ["rev-parse", "HEAD"]);
            expect(missing.code).toBe(-1);
            expect(missing.gitMissing).toBe(true);
            expect(missing.stderr.length).toBeGreaterThan(0);
        } finally {
            restore();
        }
    });

    test.skipIf(!GIT_ON_PATH || !POSIX_HOST)("runGitSync enforces its kill timer (typed timedOut)", async () => {
        // A git shell alias that sleeps: the only portable way to make git
        // itself hang deterministically. POSIX-only (the `!` alias needs sh).
        const repo = makeRepo("gitspawn-hang");
        const res = runGitSync(repo, ["-c", "alias.hang=!sleep 5", "hang"], { timeoutMs: 500 });
        expect(res.code).toBe(-1);
        expect(res.timedOut).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// commitAll — the add+commit flow against real repos
// ---------------------------------------------------------------------------

describe("commitAll", () => {
    test.skipIf(!GIT_ON_PATH)("commits every project-dir change; message preserved verbatim; tree clean after", async () => {
        const repo = makeRepo("commitall");
        writeFileSync(join(repo, "src.ts"), "export const a = 1;\n");
        writeFileSync(join(repo, "docs.txt"), "notes\n");
        const message = "fix: parser edge case\n\nLonger body line that must survive verbatim.";
        const outcome = await commitAll(repo, message);
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.commitHash).toMatch(/^[0-9a-f]{40}$/);
        expect(outcome.filesChanged).toBe(2);
        expect(outcome.subject).toBe("fix: parser edge case");
        expect(await hasStagedOrUnstagedChanges(repo)).toBe(false);
        // Message verbatim (git appends/normalizes the trailing newline only).
        const logged = gitSh(repo, ["log", "-1", "--pretty=%B"]);
        expect(logged.trim()).toBe(message.trim());
        expect(gitSh(repo, ["log", "-1", "--pretty=%H"]).trim()).toBe(outcome.commitHash);
    });

    test.skipIf(!GIT_ON_PATH)("stages deletions too (git add -A semantics)", async () => {
        const repo = makeRepo("commitall-del");
        writeFileSync(join(repo, "gone.ts"), "bye\n");
        await commitAll(repo, "add gone.ts");
        rmSync(join(repo, "gone.ts"));
        const outcome = await commitAll(repo, "remove gone.ts");
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.filesChanged).toBe(1);
        expect(await hasStagedOrUnstagedChanges(repo)).toBe(false);
    });

    test.skipIf(!GIT_ON_PATH)("clean tree → clean no-op with the typed reason", async () => {
        const repo = makeRepo("commitall-clean");
        const outcome = await commitAll(repo, "nothing here");
        expect(outcome).toMatchObject({ ok: false, reason: "nothing_to_commit" });
        expect(gitSh(repo, ["rev-list", "--count", "HEAD"])).toBe("1\n"); // still one commit
    });

    test.skipIf(!GIT_ON_PATH)("outside any repo → typed not_a_git_repo reason", async () => {
        const dir = join(rootTmp, "commitall-nonrepo");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "loose.txt"), "no history here\n");
        const outcome = await commitAll(dir, "nope");
        expect(outcome).toMatchObject({ ok: false, reason: "not_a_git_repo" });
    });

    test.skipIf(!GIT_ON_PATH)("fresh clone without user.name/user.email still commits (the -c fallback)", async () => {
        const repo = join(rootTmp, "commitall-noident");
        mkdirSync(repo, { recursive: true });
        const emptyHome = join(rootTmp, "empty-home");
        mkdirSync(emptyHome, { recursive: true });
        // init WITHOUT any identity reachable (global+system config pointed at
        // /dev/null, HOME redirected) — deterministic on any host.
        const isolate = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", HOME: emptyHome };
        gitSh(repo, ["init"], isolate);
        writeFileSync(join(repo, "first.ts"), "export const one = 1;\n");
        const restore = patchEnv(isolate);
        try {
            expect((await runGit(repo, ["config", "--get", "user.name"])).code).not.toBe(0);
            const outcome = await commitAll(repo, "feat: first commit in a fresh clone");
            expect(outcome.ok).toBe(true);
            if (!outcome.ok) return;
            // The fallback identity applied to this commit only (never to config).
            expect(gitSh(repo, ["log", "-1", "--pretty=%an"], isolate).trim()).toBe("unown");
            expect(gitSh(repo, ["log", "-1", "--pretty=%ae"], isolate).trim()).toBe("unown@local");
            expect((await runGit(repo, ["config", "--get", "user.name"])).code).not.toBe(0);
        } finally {
            restore();
        }
    });

    test.skipIf(!GIT_ON_PATH)("git unreachable on PATH → typed git_unavailable reason", async () => {
        const repo = makeRepo("commitall-nogit");
        writeFileSync(join(repo, "dirty.ts"), "dirty\n");
        const emptyBin = join(rootTmp, "empty-bin");
        mkdirSync(emptyBin, { recursive: true });
        resetGitAvailableCache();
        const restore = patchEnv({ PATH: emptyBin });
        try {
            const outcome = await commitAll(repo, "should not happen");
            expect(outcome).toMatchObject({ ok: false, reason: "git_unavailable" });
        } finally {
            restore();
            resetGitAvailableCache();
        }
    });
});

// ---------------------------------------------------------------------------
// Gating helpers (pure)
// ---------------------------------------------------------------------------

describe("gitWorkflowSuppressed / autoCommitEnabled", () => {
    test("subagent and automation envs suppress the workflow", () => {
        expect(gitWorkflowSuppressed({})).toBeNull();
        expect(gitWorkflowSuppressed({ UNOWN_SUBAGENT: "0" })).toBeNull();
        expect(gitWorkflowSuppressed({ UNOWN_SUBAGENT: "1" })).toMatchObject({ env: "UNOWN_SUBAGENT" });
        expect(gitWorkflowSuppressed({ UNOWN_AUTOMATION: "true" })).toMatchObject({ env: "UNOWN_AUTOMATION" });
        expect(gitWorkflowSuppressed({ UNOWN_SUBAGENT: "1", UNOWN_AUTOMATION: "1" })?.env).toBe("UNOWN_SUBAGENT");
    });

    test("UNOWN_AUTO_COMMIT is opt-in (default OFF; 1/true enable)", () => {
        expect(autoCommitEnabled({})).toBe(false);
        expect(autoCommitEnabled({ UNOWN_AUTO_COMMIT: "" })).toBe(false);
        expect(autoCommitEnabled({ UNOWN_AUTO_COMMIT: "0" })).toBe(false);
        expect(autoCommitEnabled({ UNOWN_AUTO_COMMIT: "1" })).toBe(true);
        expect(autoCommitEnabled({ UNOWN_AUTO_COMMIT: "true" })).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Extension wiring — /commit + the shutdown hook, through the same fake-pi
// harness pattern as tools.test.ts (register the real unown-tools extension,
// drive the captured command handlers and event handlers)
// ---------------------------------------------------------------------------

function makeFakePi() {
    const handlers = new Map<string, Array<(event: any, ctx?: any) => any>>();
    const commands = new Map<string, { description: string; handler: (args: string, ctx: any) => Promise<void> }>();
    const pi: any = {
        on: (event: string, handler: (event: any, ctx?: any) => any) => {
            if (!handlers.has(event)) handlers.set(event, []);
            handlers.get(event)!.push(handler);
        },
        registerCommand: (name: string, def: any) => commands.set(name, def),
        registerFlag: () => {},
        registerTool: () => {},
        registerShortcut: () => {},
        appendEntry: () => {},
        getFlag: () => undefined,
        getActiveTools: () => ["read", "bash", "edit", "write"],
        setActiveTools: () => {},
        sendMessage: () => {},
    };
    const emit = async (event: string, payload: any, ctx?: any) => {
        for (const h of handlers.get(event) ?? []) await h(payload, ctx);
    };
    const runCommand = async (name: string, args: string, ctx: any) => {
        await commands.get(name)!.handler(args, ctx);
    };
    return { pi, emit, runCommand, commands };
}

function makeNotifyCtx(sessionManager?: any) {
    const messages: Array<{ text: string; level: string }> = [];
    return {
        messages,
        ctx: {
            hasUI: true,
            ui: { notify: (text: string, level: string = "info") => messages.push({ text, level }) },
            sessionManager,
        },
    };
}

describe("/commit command wiring", () => {
    test.skipIf(!GIT_ON_PATH)("registers the command; user message used verbatim, hash + file count reported", async () => {
        const repo = makeRepo("cmd-usermsg");
        writeFileSync(join(repo, "one.ts"), "1\n");
        writeFileSync(join(repo, "two.ts"), "2\n");
        const ext = createUnownToolsExtension({ cwd: repo, engineUrl: "http://127.0.0.1:3030" });
        const { pi, runCommand, commands } = makeFakePi();
        ext.factory(pi);
        expect(commands.has("commit")).toBe(true);

        const { ctx, messages } = makeNotifyCtx();
        await runCommand("commit", "fix: the thing", ctx);
        expect(messages).toHaveLength(1);
        expect(messages[0].level).toBe("info");
        expect(messages[0].text).toMatch(/^Committed [0-9a-f]{7} — 2 files changed$/m);
        expect(messages[0].text).toContain("never pushes");
        // User message is preserved VERBATIM — no generated trailer appended.
        expect(gitSh(repo, ["log", "-1", "--pretty=%B"]).trim()).toBe("fix: the thing");
    });

    test.skipIf(!GIT_ON_PATH)("no message → generated conventional message from the session's recent assistant text", async () => {
        const repo = makeRepo("cmd-genmsg");
        writeFileSync(join(repo, "change.ts"), "change\n");
        const ext = createUnownToolsExtension({ cwd: repo, engineUrl: "http://127.0.0.1:3030" });
        const { pi, runCommand } = makeFakePi();
        ext.factory(pi);
        const sessionManager = {
            getBranch: () => [
                { type: "message", message: { role: "user", content: "fix it" } },
                { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Fixed the flaky retry test" }] } },
            ],
        };
        const { ctx, messages } = makeNotifyCtx(sessionManager);
        await runCommand("commit", "", ctx);
        expect(messages[0].text).toContain("unown(session): Fixed the flaky retry test");
        expect(gitSh(repo, ["log", "-1", "--pretty=%B"]).trim()).toBe(
            "unown(session): Fixed the flaky retry test\n\nGenerated-by: unown",
        );
    });

    test.skipIf(!GIT_ON_PATH)("recentAssistantSummary walks the branch backwards past short replies", () => {
        const sm = {
            getBranch: () => [
                { message: { role: "assistant", content: [{ type: "text", text: "Done!" }] } }, // too short
                { message: { role: "user", content: "go" } },
                { message: { role: "assistant", content: [{ type: "text", text: "Refactored the config loader" }] } },
            ],
        };
        expect(recentAssistantSummary({ sessionManager: sm })).toBe("Refactored the config loader");
        expect(recentAssistantSummary({})).toBeUndefined();
        expect(recentAssistantSummary({ sessionManager: { getBranch: () => [] } })).toBeUndefined();
    });

    test.skipIf(!GIT_ON_PATH)("clean tree → friendly nothing-to-commit, no commit created", async () => {
        const repo = makeRepo("cmd-clean");
        const ext = createUnownToolsExtension({ cwd: repo, engineUrl: "http://127.0.0.1:3030" });
        const { pi, runCommand } = makeFakePi();
        ext.factory(pi);
        const { ctx, messages } = makeNotifyCtx();
        await runCommand("commit", "", ctx);
        expect(messages[0].level).toBe("info");
        expect(messages[0].text).toContain("Nothing to commit");
        expect(gitSh(repo, ["rev-list", "--count", "HEAD"])).toBe("1\n");
    });

    test.skipIf(!GIT_ON_PATH)("non-repo cwd → actionable warning, no crash", async () => {
        const dir = join(rootTmp, "cmd-nonrepo");
        mkdirSync(dir, { recursive: true });
        const ext = createUnownToolsExtension({ cwd: dir, engineUrl: "http://127.0.0.1:3030" });
        const { pi, runCommand } = makeFakePi();
        ext.factory(pi);
        const { ctx, messages } = makeNotifyCtx();
        await runCommand("commit", "hello", ctx);
        expect(messages[0].level).toBe("warning");
        expect(messages[0].text).toContain("Not inside a git repository");
    });

    test.skipIf(!GIT_ON_PATH)("subagent env → explicit no-op note, no commit", async () => {
        const repo = makeRepo("cmd-subagent");
        writeFileSync(join(repo, "sub.ts"), "sub\n");
        const restore = patchEnv({ UNOWN_SUBAGENT: "1" });
        try {
            const ext = createUnownToolsExtension({ cwd: repo, engineUrl: "http://127.0.0.1:3030" }); // reads the env
            const { pi, runCommand } = makeFakePi();
            ext.factory(pi);
            const { ctx, messages } = makeNotifyCtx();
            await runCommand("commit", "should not commit", ctx);
            expect(messages[0].text).toContain("no-op");
            expect(messages[0].text).toContain("UNOWN_SUBAGENT");
            expect(gitSh(repo, ["rev-list", "--count", "HEAD"])).toBe("1\n");
        } finally {
            restore();
        }
    });

    test.skipIf(!GIT_ON_PATH)("automation env → explicit no-op note, no commit", async () => {
        const repo = makeRepo("cmd-automation");
        writeFileSync(join(repo, "auto.ts"), "auto\n");
        const restore = patchEnv({ UNOWN_AUTOMATION: "1" });
        try {
            const ext = createUnownToolsExtension({ cwd: repo, engineUrl: "http://127.0.0.1:3030" });
            const { pi, runCommand } = makeFakePi();
            ext.factory(pi);
            const { ctx, messages } = makeNotifyCtx();
            await runCommand("commit", "should not commit", ctx);
            expect(messages[0].text).toContain("UNOWN_AUTOMATION");
            expect(gitSh(repo, ["rev-list", "--count", "HEAD"])).toBe("1\n");
        } finally {
            restore();
        }
    });
});

describe("opt-in auto-commit on session_shutdown", () => {
    test.skipIf(!GIT_ON_PATH)("UNOWN_AUTO_COMMIT=1 + dirty tree + quit → session-end snapshot commit", async () => {
        const repo = makeRepo("auto-on");
        writeFileSync(join(repo, "work.ts"), "wip\n");
        const restore = patchEnv({ UNOWN_AUTO_COMMIT: "1" });
        try {
            const ext = createUnownToolsExtension({ cwd: repo, engineUrl: "http://127.0.0.1:3030" });
            const { pi, emit } = makeFakePi();
            ext.factory(pi);
            const { ctx, messages } = makeNotifyCtx();
            await emit("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
            expect(messages).toHaveLength(1);
            expect(messages[0].text).toMatch(/^unown\(auto\): committed [0-9a-f]{7} — 1 file changed/);
            expect(messages[0].text).toContain("session end snapshot");
            const logged = gitSh(repo, ["log", "-1", "--pretty=%B"]).trim();
            expect(logged.startsWith("unown(auto): session end snapshot ")).toBe(true);
            expect(logged).toContain("Generated-by: unown");
            expect(await hasStagedOrUnstagedChanges(repo)).toBe(false);
        } finally {
            restore();
        }
    });

    test.skipIf(!GIT_ON_PATH)("default (knob unset) → no commit, no noise", async () => {
        const repo = makeRepo("auto-off");
        writeFileSync(join(repo, "work.ts"), "wip\n");
        const restore = patchEnv({ UNOWN_AUTO_COMMIT: "0" });
        try {
            const ext = createUnownToolsExtension({ cwd: repo, engineUrl: "http://127.0.0.1:3030" });
            const { pi, emit } = makeFakePi();
            ext.factory(pi);
            const { ctx, messages } = makeNotifyCtx();
            await emit("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
            expect(messages).toHaveLength(0);
            expect(gitSh(repo, ["rev-list", "--count", "HEAD"])).toBe("1\n");
            expect(await hasStagedOrUnstagedChanges(repo)).toBe(true); // work left untouched
        } finally {
            restore();
        }
    });

    test.skipIf(!GIT_ON_PATH)('reason "reload" keeps the same session → skipped even with the knob on', async () => {
        const repo = makeRepo("auto-reload");
        writeFileSync(join(repo, "work.ts"), "wip\n");
        const restore = patchEnv({ UNOWN_AUTO_COMMIT: "1" });
        try {
            const ext = createUnownToolsExtension({ cwd: repo, engineUrl: "http://127.0.0.1:3030" });
            const { pi, emit } = makeFakePi();
            ext.factory(pi);
            const { ctx, messages } = makeNotifyCtx();
            await emit("session_shutdown", { type: "session_shutdown", reason: "reload" }, ctx);
            expect(messages).toHaveLength(0);
            expect(gitSh(repo, ["rev-list", "--count", "HEAD"])).toBe("1\n");
        } finally {
            restore();
        }
    });

    test.skipIf(!GIT_ON_PATH)("subagent session → silent skip even with the knob on", async () => {
        const repo = makeRepo("auto-subagent");
        writeFileSync(join(repo, "work.ts"), "wip\n");
        const restore = patchEnv({ UNOWN_AUTO_COMMIT: "1", UNOWN_SUBAGENT: "1" });
        try {
            const ext = createUnownToolsExtension({ cwd: repo, engineUrl: "http://127.0.0.1:3030" });
            const { pi, emit } = makeFakePi();
            ext.factory(pi);
            const { ctx, messages } = makeNotifyCtx();
            await emit("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
            expect(messages).toHaveLength(0);
            expect(gitSh(repo, ["rev-list", "--count", "HEAD"])).toBe("1\n");
        } finally {
            restore();
        }
    });

    test.skipIf(!GIT_ON_PATH)("clean tree with the knob on → silent no-op (no empty commits)", async () => {
        const repo = makeRepo("auto-clean");
        const restore = patchEnv({ UNOWN_AUTO_COMMIT: "1" });
        try {
            const ext = createUnownToolsExtension({ cwd: repo, engineUrl: "http://127.0.0.1:3030" });
            const { pi, emit } = makeFakePi();
            ext.factory(pi);
            const { ctx, messages } = makeNotifyCtx();
            await emit("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
            expect(messages).toHaveLength(0);
            expect(gitSh(repo, ["rev-list", "--count", "HEAD"])).toBe("1\n");
        } finally {
            restore();
        }
    });
});

// ---------------------------------------------------------------------------
// registerGitTools standalone (the tools.ts wiring is covered above through
// the full extension; this pins the module's own registration surface)
// ---------------------------------------------------------------------------

describe("registerGitTools", () => {
    test("registers /commit and the shutdown hook on a bare fake pi", async () => {
        const { pi, commands, emit } = makeFakePi();
        registerGitTools(pi, { cwd: join(rootTmp, "standalone") });
        expect(commands.has("commit")).toBe(true);
        expect(commands.get("commit")!.description).toContain("never pushes");
        // Knob off: shutdown handler registered but inert.
        const { ctx, messages } = makeNotifyCtx();
        await emit("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
        expect(messages).toHaveLength(0);
    });
});
