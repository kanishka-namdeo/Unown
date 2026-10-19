/**
 * packaging.ts — the one module that knows unown runs in two shapes.
 *
 *   1. from the checkout (`bun bin/unown`) — the clone-to-install path;
 *   2. as a Bun-compiled standalone binary from a GitHub Release
 *      (`scripts/build-artifacts.ts` builds one per OS/arch).
 *
 * Why this exists: inside a compiled binary `import.meta.dir` is Bun's virtual
 * filesystem, not a directory. Every repo-root escape —
 * `join(import.meta.dir, "..", "..", "..", "..")` — therefore resolves to a
 * nonsense path. `store.ts` runs `mkdirSync(dirname(DB_PATH))` while the module
 * is still evaluating, so a compiled `unown` died with `EPERM: mkdir '\'`
 * before it could print a single line.
 *
 * Measured on bun 1.4.2, each spelling on the platform that produces it:
 *   POSIX compiled    import.meta.dir = `/$bunfs/root`         (url `file:///$bunfs/root/…`)
 *   Windows compiled  import.meta.dir = `B:\~BUN\root`         (url `file:///B:/%7EBUN/root/…`)
 *   source, both OSes import.meta.dir = the real module directory
 *
 * `process.execPath` is a real path in BOTH shapes — the bun binary when run
 * from source, the executable itself when compiled — so it is the only safe
 * anchor for anything shipped beside a standalone binary.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Set by `bun build --define __UNOWN_VERSION__="X.Y.Z"` in the artifact build.
 *  Absent (source runs, and any compile that forgot to pass it) reads as
 *  undefined through `typeof` without throwing. */
declare const __UNOWN_VERSION__: string | undefined;

/** True when `p` is one of Bun's virtual compiled-binary path spellings. Pure
 *  so the detection itself is testable without producing a binary. Covers the
 *  POSIX `$bunfs/root` form (either separator) and both Windows `~BUN` forms
 *  — the raw one `import.meta.dir` reports and the percent-encoded one that
 *  appears in `import.meta.url`. */
export function isBunVirtualPath(p: string | undefined | null): boolean {
    if (!p) return false;
    const s = p.toLowerCase().replace(/\\/g, "/");
    return s.includes("/$bunfs/root/") || s.includes("~bun/root/") || s.includes("%7ebun/root/");
}

/** True when this process is a compiled standalone binary rather than a script
 *  run by bun from the checkout. */
export const IS_COMPILED_BINARY: boolean = isBunVirtualPath(import.meta.url);

/** UNOWN_HOME — mirrors term.ts/update.ts/crash.ts (`||` not `??`: bun
 *  auto-loads `.env`, where .env.example ships this key EMPTY, and an empty
 *  value means "unset", not a cwd-relative state dir). */
export function unownHome(env: NodeJS.ProcessEnv = process.env): string {
    return env.UNOWN_HOME || join(homedir(), ".unown");
}

/**
 * The directory that holds engine state when nothing is configured explicitly.
 * A checkout keeps `<repo>/data` + `<repo>/db`; a standalone binary has no
 * checkout, so it uses UNOWN_HOME — the same tree its memory, agent dir and
 * crash records already live in. `compiled` is a test seam; callers use the
 * measured default.
 */
export function stateRoot(
    repoRoot: string,
    env: NodeJS.ProcessEnv = process.env,
    compiled: boolean = IS_COMPILED_BINARY,
): string {
    return compiled ? unownHome(env) : repoRoot;
}

/**
 * unown's version, in the order that stays truthful in both shapes: the value
 * the artifact build injected, else the ROOT package.json (the source of truth
 * CI asserts `unown --version` against), else "unknown". Never a literal —
 * a hardcoded fallback is how the MCP handshake once claimed 0.1.0 while the
 * shipped package was 2.1.x.
 */
export function unownVersion(repoPackageJson: string): string {
    const injected = typeof __UNOWN_VERSION__ === "string" ? __UNOWN_VERSION__ : undefined;
    if (injected) return injected;
    try {
        const pkg = JSON.parse(readFileSync(repoPackageJson, "utf8")) as { version?: unknown };
        return String(pkg.version ?? "unknown");
    } catch {
        return "unknown";
    }
}
