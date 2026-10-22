// Unit tests for src/project-identity.ts — the stable cross-session project
// identity that keys the shared memory scopes.
//
// Covers the two real failure modes the composite key exists to fix:
//   1. SAME-BASENAME COLLISION — ~/work/api and ~/personal/api must NOT share
//      a memory scope (they did, under the basename-only key).
//   2. CHECKOUT-RENAME SPLIT — the same repository cloned into two
//      differently-named directories (or renamed) must SHARE a scope.
// Plus the worktree hop (Claude Code #81833: worktree sessions get no shared
// memory when identity is path-keyed) and the no-git path fallback.
//
// This file imports ./_env.ts FIRST like every store-touching suite, though
// project-identity.ts itself is import-light (fs+crypto+path only) — kept for
// consistency and because the tmp fixtures it creates live under the same
// redirect.

import "./_env.ts";
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        basenameSlug,
        normalizeGitRemote,
        parseGitConfigRemote,
        projectKey,
        projectSlug,
        readGitRemoteUrl,
        resolveProjectIdentity,
} from "../src/project-identity.ts";

function tmpDir(name: string): string {
        const d = join(tmpdir(), `unown-identity-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        mkdirSync(d, { recursive: true });
        return d;
}

/** Materialize a fake git repo: .git/config with the given remote URL. */
function fakeGitRepo(name: string, remoteUrl: string | null): string {
        const dir = tmpDir(name);
        if (remoteUrl !== null) writeGitRemote(dir, remoteUrl);
        return dir;
}

/** Write (or replace) a .git/config with the given origin URL in a directory. */
function writeGitRemote(dir: string, remoteUrl: string): void {
        mkdirSync(join(dir, ".git"), { recursive: true });
        writeFileSync(
                join(dir, ".git", "config"),
                `[core]\n\trepositoryformatversion = 0\n` +
                        `[remote "origin"]\n\turl = ${remoteUrl}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
                "utf8",
        );
}

// ---------------------------------------------------------------- normalizing

describe("normalizeGitRemote", () => {
        test("https with .git suffix and credentials", () => {
                expect(normalizeGitRemote("https://user:token@github.com/Owner/Repo.git")).toBe("github.com/owner/repo");
        });
        test("plain https, trailing slash", () => {
                expect(normalizeGitRemote("https://github.com/owner/repo/")).toBe("github.com/owner/repo");
        });
        test("scp-like ssh form", () => {
                expect(normalizeGitRemote("git@github.com:owner/repo.git")).toBe("github.com/owner/repo");
        });
        test("ssh:// URL form", () => {
                expect(normalizeGitRemote("ssh://git@github.com/owner/repo.git")).toBe("github.com/owner/repo");
        });
        test("git:// protocol", () => {
                expect(normalizeGitRemote("git://github.com/owner/repo.git")).toBe("github.com/owner/repo");
        });
        test("file:// local remote", () => {
                expect(normalizeGitRemote("file:///srv/repos/repo.git")).toBe("/srv/repos/repo");
        });
        test("bare local path remote", () => {
                expect(normalizeGitRemote("/srv/repos/repo")).toBe("/srv/repos/repo");
        });
        test("case-insensitive canonicalization", () => {
                expect(normalizeGitRemote("https://GitHub.com/Owner/Repo")).toBe("github.com/owner/repo");
        });
        test("empty input", () => {
                expect(normalizeGitRemote("")).toBe("");
        });
});

// ---------------------------------------------------------------- config parse

describe("parseGitConfigRemote", () => {
        test("origin preferred over other remotes", () => {
                const cfg = `[remote "upstream"]\n\turl = https://example.com/up/repo.git\n[remote "origin"]\n\turl = https://github.com/o/r.git\n`;
                expect(parseGitConfigRemote(cfg)).toBe("https://github.com/o/r.git");
        });
        test("first non-origin remote as fallback", () => {
                const cfg = `[remote "a"]\n\turl = https://example.com/a.git\n[remote "b"]\n\turl = https://example.com/b.git\n`;
                expect(parseGitConfigRemote(cfg)).toBe("https://example.com/a.git");
        });
        test("bare (unquoted) section header", () => {
                expect(parseGitConfigRemote("[remote origin]\n\turl = git@github.com:o/r.git\n")).toBe("git@github.com:o/r.git");
        });
        test("inline comments and CRLF tolerated", () => {
                expect(parseGitConfigRemote('[remote "origin"] # main\r\nurl = https://github.com/o/r.git # repo\r\n')).toBe(
                        "https://github.com/o/r.git",
                );
        });
        test("no remotes → null", () => {
                expect(parseGitConfigRemote("[core]\n\tbare = true\n")).toBeNull();
        });
        test("empty config → null", () => {
                expect(parseGitConfigRemote("")).toBeNull();
        });
});

// ---------------------------------------------------------------- remote read

describe("readGitRemoteUrl", () => {
        test("reads origin from a normal .git directory", () => {
                const dir = fakeGitRepo("normal", "https://github.com/owner/repo.git");
                expect(readGitRemoteUrl(dir)).toBe("https://github.com/owner/repo.git");
                rmSync(dir, { recursive: true, force: true });
        });
        test("follows .git file (worktree) + commondir to the main repo config", () => {
                // main repo with origin
                const main = fakeGitRepo("wt-main", "https://github.com/owner/repo.git");
                // worktree admin dir with commondir pointing back at main/.git
                const admin = join(main, ".git", "worktrees", "feature");
                mkdirSync(admin, { recursive: true });
                writeFileSync(join(admin, "commondir"), "../..\n", "utf8"); // relative to the admin dir → <main>/.git
                // the worktree itself: a directory whose .git is a FILE
                const wt = tmpDir("wt-checkout");
                writeFileSync(join(wt, ".git"), `gitdir: ${admin}\n`, "utf8");
                expect(readGitRemoteUrl(wt)).toBe("https://github.com/owner/repo.git");
                rmSync(main, { recursive: true, force: true });
                rmSync(wt, { recursive: true, force: true });
        });
        test("absolute gitdir pointer (submodule-style .git file)", () => {
                const main = fakeGitRepo("submodule", "https://github.com/owner/repo.git");
                const sub = tmpDir("submodule-checkout");
                writeFileSync(join(sub, ".git"), `gitdir: ${join(main, ".git")}\n`, "utf8");
                expect(readGitRemoteUrl(sub)).toBe("https://github.com/owner/repo.git");
                rmSync(main, { recursive: true, force: true });
                rmSync(sub, { recursive: true, force: true });
        });
        test("no .git → null (path fallback territory)", () => {
                const dir = tmpDir("plain");
                expect(readGitRemoteUrl(dir)).toBeNull();
                rmSync(dir, { recursive: true, force: true });
        });
        test(".git without remotes → null", () => {
                const dir = fakeGitRepo("bare-noremote", null);
                expect(readGitRemoteUrl(dir)).toBeNull();
                rmSync(dir, { recursive: true, force: true });
        });
});

// ---------------------------------------------------------------- identity

describe("resolveProjectIdentity", () => {
        test("git remote wins: same identity from differently-named clones", () => {
                const a = fakeGitRepo("clone-a", "https://github.com/owner/repo.git");
                const b = fakeGitRepo("totally-different-name", "git@github.com:owner/repo.git");
                expect(resolveProjectIdentity(a)).toBe(resolveProjectIdentity(b));
                rmSync(a, { recursive: true, force: true });
                rmSync(b, { recursive: true, force: true });
        });
        test("different remotes → different identities", () => {
                const a = fakeGitRepo("r1", "https://github.com/owner/repo.git");
                const b = fakeGitRepo("r2", "https://github.com/other/other-repo.git");
                expect(resolveProjectIdentity(a)).not.toBe(resolveProjectIdentity(b));
                rmSync(a, { recursive: true, force: true });
                rmSync(b, { recursive: true, force: true });
        });
        test("no-git fallback is the resolved path (prefix-marked)", () => {
                const dir = tmpDir("nogit");
                expect(resolveProjectIdentity(dir).startsWith("path:")).toBe(true);
                rmSync(dir, { recursive: true, force: true });
        });
});

// ---------------------------------------------------------------- the slug

describe("projectSlug — the composite scope key", () => {
        test("REGRESSION: same basename in two locations → DIFFERENT slugs (no shared memory)", () => {
                // two directories BOTH literally named "api", under different parents,
                // with different remotes — the exact collision the legacy key had.
                const parentA = tmpDir("parent-a");
                const parentB = tmpDir("parent-b");
                const a = join(parentA, "api");
                const b = join(parentB, "api");
                for (const d of [a, b]) mkdirSync(d, { recursive: true });
                writeGitRemote(a, "https://github.com/work/api.git");
                writeGitRemote(b, "https://github.com/personal/api.git");
                expect(basenameSlug(a)).toBe(basenameSlug(b)); // legacy key collided here
                expect(projectSlug(a)).not.toBe(projectSlug(b)); // composite key does not
                rmSync(parentA, { recursive: true, force: true });
                rmSync(parentB, { recursive: true, force: true });
        });
        test("REGRESSION: same repo cloned under two names → SAME slug (memory follows the repo)", () => {
                const a = fakeGitRepo("unown", "https://github.com/kanishka-namdeo/Unown.git");
                const b = fakeGitRepo("unown-main", "https://github.com/kanishka-namdeo/Unown.git");
                expect(projectSlug(a)).toBe(projectSlug(b));
                rmSync(a, { recursive: true, force: true });
                rmSync(b, { recursive: true, force: true });
        });
        test("worktree shares the main checkout's slug", () => {
                const main = fakeGitRepo("wt-slug-main", "https://github.com/owner/repo.git");
                const admin = join(main, ".git", "worktrees", "feature");
                mkdirSync(admin, { recursive: true });
                writeFileSync(join(admin, "commondir"), "../..\n", "utf8"); // admin → <main>/.git
                const wt = tmpDir("wt-slug-checkout");
                writeFileSync(join(wt, ".git"), `gitdir: ${admin}\n`, "utf8");
                expect(projectSlug(wt)).toBe(projectSlug(main));
                rmSync(main, { recursive: true, force: true });
                rmSync(wt, { recursive: true, force: true });
        });
        test("deterministic for the same input", () => {
                const a = fakeGitRepo("det", "https://github.com/o/r.git");
                const b = fakeGitRepo("det", "https://github.com/o/r.git");
                expect(projectSlug(a)).toBe(projectSlug(b));
                rmSync(a, { recursive: true, force: true });
                rmSync(b, { recursive: true, force: true });
        });
        test("shape: <basename>-<6hex>, 6-hex key", () => {
                const dir = fakeGitRepo("shape", "https://github.com/o/r.git");
                const slug = projectSlug(dir);
                expect(slug).toMatch(/^[a-z0-9-]+-[0-9a-f]{6}$/);
                expect(projectKey(dir)).toMatch(/^[0-9a-f]{6}$/);
                rmSync(dir, { recursive: true, force: true });
        });
        test("long basenames are capped but keep the key", () => {
                const long = "a".repeat(50);
                const dir = fakeGitRepo(long, "https://github.com/o/r.git");
                expect(projectSlug(dir).length).toBeLessThanOrEqual(26 + 1 + 6);
                rmSync(dir, { recursive: true, force: true });
        });
        test("slugifyProject (notes.ts re-export) matches projectSlug", async () => {
                const { slugifyProject } = await import("../src/notes.ts");
                const dir = fakeGitRepo("compat", "https://github.com/o/r.git");
                expect(slugifyProject(dir)).toBe(projectSlug(dir));
                rmSync(dir, { recursive: true, force: true });
        });
});

describe("basenameSlug — the legacy display slug", () => {
        test("cleaning rules match the old slugifyProject contract", () => {
                expect(basenameSlug("/home/x/My-Project!")).toBe("my-project");
                expect(basenameSlug("/home/x/UPPER")).toBe("upper");
                expect(basenameSlug("/")).toBe("project");
        });
});
