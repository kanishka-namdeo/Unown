/**
 * project-identity.ts — stable cross-session project identity.
 *
 * WHY THIS EXISTS (2026-10-22, shared-memory consistency work): the project
 * memory scope used to be keyed by `slugifyProject(projectPath)` — the
 * BASENAME of the project directory, lowercased. Two real failure modes
 * shipped with that key:
 *
 *   1. SAME-BASENAME COLLISION — `~/work/api` and `~/personal/api` are two
 *      unrelated projects that both slug to `api`: their terminal notes
 *      grouped together, their dreams consolidated into ONE mem0 scope
 *      (`project:api`), and one project's conventions silently polluted the
 *      other's memory. (The cross-scope leak class the Mem0 entity-partition
 *      playbook calls "When Memories Leak".)
 *   2. CHECKOUT-RENAME SPLIT — the same repository cloned as `Unown/` and as
 *      `unown-main/` produced two scopes; everything the agent learned in one
 *      checkout was invisible in the other, and a directory rename stranded
 *      the memory entirely.
 *
 * The fix follows the pattern the community converged on (Claude Code
 * issue #81391's git-remote identity, Letta's shared-memory repos, the
 * Hindsight bank model): project identity = the git REMOTE (stable across
 * clones, renames, worktrees and machines), falling back to the resolved
 * absolute path when the directory is not a git repository (a stable
 * per-checkout identity — better than a basename, which is neither).
 *
 * The derived key is a 6-hex sha256 prefix of the normalized identity,
 * appended to the legacy basename slug so tier keys stay readable
 * (`project:api-3f9c21d`) while gaining uniqueness. Legacy scopes
 * (`project:api`) are migrated verbatim at the next dream (dream.ts) — no
 * user action, nothing lost.
 *
 * Purity note: engine-side module (used by notes.ts / dream.ts / skills.ts);
 * reads project dirs the engine already reads/writes for dreams. Import-light
 * (node:fs + node:crypto + node:path only) so tests need no store.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

/** The composite slug: legacy basename slug + 6-hex identity key. */
const KEY_LEN = 6;

/** Normalize any git remote URL spelling to one canonical identity string.
 *
 *  git@github.com:owner/repo.git        → github.com/owner/repo
 *  https://user:token@github.com/o/r/   → github.com/o/r
 *  ssh://git@github.com/owner/repo.git  → github.com/owner/repo
 *  git://github.com/owner/repo.git      → github.com/owner/repo
 *  file:///srv/repos/repo.git           → /srv/repos/repo
 *  /srv/repos/repo (local remote)       → /srv/repos/repo
 *
 * Credentials are stripped BEFORE hashing (they must never influence — or
 * leak into — the identity), the `.git` suffix and trailing slashes drop,
 * and the whole string lowercases (hosts are case-insensitive; GitHub repo
 * paths are too; for self-hosted case-sensitive git servers the lowercase is
 * still a stable identity — it just means two casings of one repo share
 * memory, which is the desired sharing semantics).
 */
export function normalizeGitRemote(url: string): string {
        let u = String(url ?? "").trim();
        if (!u) return "";
        // strip credentials from URL forms: proto://user:pass@host/path
        u = u.replace(/^([a-z][a-z0-9+.-]*:\/\/)([^@/@\s]+@)+/i, "$1");
        // scp-like ssh syntax: git@host:owner/repo → host/owner/repo
        const scp = u.match(/^([^@/\s]+@)([^:/\s]+):(.+)$/);
        if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
                u = `${scp[2]}/${scp[3]}`;
        }
        // strip protocol
        u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
        // strip a second user@ if ssh:// kept one
        u = u.replace(/^([^@/\s]+)@/, "");
        // file:// already lost its proto above → /path
        u = u.replace(/\.git$/, "").replace(/\/+$/, "");
        return u.toLowerCase();
}

/** Read the git remote (origin preferred, first remote otherwise) without
 *  spawning git — cross-platform, no subprocess cost, no git binary needed.
 *
 *  Worktree-aware: a linked worktree's `.git` is a FILE (`gitdir: …`); the
 *  remotes live in the COMMON dir (`.git/worktrees/<name>/commondir` points
 *  back at the main `.git`). Following both hops means a worktree session
 *  shares the main repository's memory scope — the exact behavior Claude
 *  Code users asked for in #81833 (parallel agents in worktrees currently
 *  get NO shared memory there).
 */
export function readGitRemoteUrl(projectDir: string): string | null {
        try {
                let gitPath = join(projectDir, ".git");
                if (!existsSync(gitPath)) return null;
                // A directory's .git/config reads directly; a linked worktree's
                // (or submodule's) .git is a FILE ("gitdir: <path>") pointing at
                // the worktree admin dir, whose commondir file points back at the
                // main .git. Following both hops means worktree sessions share the
                // main repository's memory scope — the behavior Claude Code users
                // asked for in #81833 (worktree sessions today get NO shared memory).
                let gitdir: string | null = null;
                try {
                        const asText = readFileSync(gitPath, "utf8");
                        const m = asText.match(/^\s*gitdir:\s*(\S+)/);
                        if (m) {
                                gitdir = !isAbsolute(m[1]) ? resolve(projectDir, m[1]) : m[1];
                        }
                } catch {
                        // .git is a directory (readFileSync on a dir throws) — normal repo
                }
                if (gitdir) {
                        const commonFile = join(gitdir, "commondir");
                        if (existsSync(commonFile)) {
                                try {
                                        const common = readFileSync(commonFile, "utf8").trim();
                                        gitdir = isAbsolute(common) ? common : resolve(gitdir, common);
                                } catch {
                                        /* keep gitdir */
                                }
                        }
                        gitPath = gitdir;
                }
                const configPath = join(gitPath, "config");
                if (!existsSync(configPath)) return null;
                const config = readFileSync(configPath, "utf8");
                return parseGitConfigRemote(config);
        } catch {
                return null;
        }
}

/** Minimal `[remote "..."] url = ...` parser (handles both quoted and bare
 *  section headers, inline comments after `#`, CRLF). Origin wins; the first
 *  other remote is the fallback. */
export function parseGitConfigRemote(config: string): string | null {
        let section = "";
        let origin: string | null = null;
        let first: string | null = null;
        for (const rawLine of config.split(/\r?\n/)) {
                const line = rawLine.replace(/\s#.*$/, "").trim();
                if (!line) continue;
                const sec = line.match(/^\[\s*remote\s+"?([^"\]\s]+)"?\s*\]$/i);
                if (sec) {
                        section = `remote:${sec[1].toLowerCase()}`;
                        continue;
                }
                if (section.startsWith("remote:")) {
                        const kv = line.match(/^url\s*=\s*(.+)$/i);
                        if (kv) {
                                const url = kv[1].trim();
                                if (section === "remote:origin" && !origin) origin = url;
                                else if (!first && section !== "remote:origin") first = url;
                        }
                }
        }
        return origin ?? first;
}

/** The stable identity string for a project directory: the normalized git
 *  remote when one exists, else the resolved (realpath) absolute path —
 *  lowercased on Windows where the filesystem is case-insensitive. */
export function resolveProjectIdentity(projectDir: string): string {
        const remote = readGitRemoteUrl(projectDir);
        if (remote) {
                const normalized = normalizeGitRemote(remote);
                if (normalized) return normalized;
        }
        let abs = "";
        try {
                abs = realpathSync(projectDir);
        } catch {
                abs = resolve(projectDir);
        }
        if (process.platform === "win32") abs = abs.toLowerCase();
        return `path:${abs}`;
}

/** 6-hex sha256 prefix of the identity — the disambiguating key. */
export function projectKey(projectDir: string): string {
        return createHash("sha256").update(resolveProjectIdentity(projectDir), "utf8").digest("hex").slice(0, KEY_LEN);
}

/** The legacy basename-only slug (basename of the LOCAL directory) — kept for
 *  legacy-scope migration lookups (dream.ts) and tests pinning the old key's
 *  collision behavior. */
export function basenameSlug(projectDir: string): string {
        const base = basename(projectDir) || "project";
        return (
                base
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-+|-+$/g, "")
                        .slice(0, 32) || "project"
        );
}

/** The display base for the composite slug: the REPOSITORY's own name when a
 *  remote exists (stable across local clone names — `unown/` and
 *  `unown-main/` are both "the Unown repo"), else the directory basename
 *  (the no-git fallback keeps the legacy shape). */
function identityBase(projectDir: string, identity: string): string {
        if (!identity.startsWith("path:")) {
                const parts = identity.split("/");
                const remoteBase = parts[parts.length - 1] || parts[parts.length - 2] || "";
                const cleaned = remoteBase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
                if (cleaned) return cleaned;
        }
        return basenameSlug(projectDir);
}

/** The composite project slug — the unique, stable scope key:
 *  `<repo-name>-<identity6>` (e.g. `api-3f9c21d`).
 *
 *  One repository → one slug everywhere it is cloned (regardless of the local
 *  directory name, across worktrees, machines and renames); two unrelated
 *  projects → different slugs even when their directories share a name. */
export function projectSlug(projectDir: string): string {
        const identity = resolveProjectIdentity(projectDir);
        const base = identityBase(projectDir, identity);
        const capped = base.length > 26 ? base.slice(0, 26) : base;
        const key = createHash("sha256").update(identity, "utf8").digest("hex").slice(0, KEY_LEN);
        return `${capped}-${key}`;
}
