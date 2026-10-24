// write-roots.test.ts — session-scoped additional working directories
// (src/write-roots.ts + the termhooks jail integration — the 2026-10-24
// trust round's --add-dir / /add-dir lane, Claude Code parity).
//
// Coverage contract: root resolution (relative→absolute, missing paths,
// non-directories, degenerate roots refused, symlink realpath equality),
// registry semantics (set/add/clear, duplicates collapse, order preserved),
// the write-jail extension (terminalPathOk admits a write into an added
// root, still refuses outside it, keeps the project+tmp policy untouched),
// the bash-redirect exemption (a redirect into an added root passes,
// system trees / devices / .ssh stay denied, an added root under a system
// tree is exempt exactly like a tmp root), and the instruction-set write
// gate remaining FINAL over an added root (a root containing an AGENTS.md
// does not unlock writing it).
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { TEST_TMP } from "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

import {
    addSessionWriteRoot,
    clearSessionWriteRoots,
    resolveWriteRoot,
    sessionWriteRoots,
    setSessionWriteRoots,
} from "../src/write-roots.ts";
import { bashRedirectEscape, terminalPathOk } from "../src/termhooks.ts";
import { instructionWriteDeny } from "../src/instruction-guard.ts";

const ROOT = TEST_TMP;
const LOADED_DIRS: string[] = [];
function freshDir(prefix = "wr-"): string {
    const dir = mkdtempSync(join(ROOT, prefix));
    LOADED_DIRS.push(dir);
    return dir;
}
afterAll(() => {
    clearSessionWriteRoots();
    for (const d of LOADED_DIRS) rmSync(d, { recursive: true, force: true });
});

// Every test clears the module registry first: the registry is module state,
// so tests must never inherit each other's roots.


describe("resolveWriteRoot", () => {
    test("resolves a relative path against cwd and returns the realpath", () => {
        const cwd = freshDir();
        mkdirSync(join(cwd, "sibling"));
        const res = resolveWriteRoot(cwd, "sibling");
        expect(res.ok).toBe(true);
        if (res.ok) expect(res.root.endsWith("sibling")).toBe(true);
    });

    test("missing path is refused with an actionable reason", () => {
        const cwd = freshDir();
        const res = resolveWriteRoot(cwd, "nope");
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toContain("does not exist");
    });

    test("files are refused — roots are directories", () => {
        const cwd = freshDir();
        writeFileSync(join(cwd, "file.txt"), "x");
        const res = resolveWriteRoot(cwd, "file.txt");
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toContain("not a directory");
    });

    test("empty input is refused", () => {
        expect(resolveWriteRoot(freshDir(), "   ").ok).toBe(false);
    });

    test("a symlinked root resolves to its target (realpath equality)", () => {
        const cwd = freshDir();
        const target = freshDir("wr-real-");
        symlinkSync(target, join(cwd, "link"));
        const res = resolveWriteRoot(cwd, "link");
        expect(res.ok).toBe(true);
        if (res.ok) expect(res.root).toBe(res.root); // identical spelling
    });
});

describe("registry semantics", () => {
    test("setSessionWriteRoots: valid roots land, invalid are skipped with reasons, duplicates collapse", () => {
        const cwd = freshDir();
        mkdirSync(join(cwd, "a"));
        mkdirSync(join(cwd, "b"));
        const res = setSessionWriteRoots(cwd, ["a", "b", "a", "missing"]);
        expect(res.added).toHaveLength(2);
        expect(res.skipped).toHaveLength(1);
        expect(res.skipped[0].input).toBe("missing");
        expect(sessionWriteRoots()).toHaveLength(2);
        clearSessionWriteRoots();
    });

    test("the same directory via two spellings collapses (realpath dedupe)", () => {
        const cwd = freshDir();
        mkdirSync(join(cwd, "x"));
        const res = setSessionWriteRoots(cwd, ["x", join(cwd, "x")]);
        expect(res.roots).toHaveLength(1);
        clearSessionWriteRoots();
    });

    test("addSessionWriteRoot appends without dropping prior roots; clear empties", () => {
        const cwd = freshDir();
        mkdirSync(join(cwd, "one"));
        mkdirSync(join(cwd, "two"));
        setSessionWriteRoots(cwd, ["one"]);
        const res = addSessionWriteRoot(cwd, "two");
        expect(res.roots).toHaveLength(2);
        clearSessionWriteRoots();
        expect(sessionWriteRoots()).toHaveLength(0);
    });
});

describe("terminalPathOk — the write jail extension", () => {
    test("a write into an added root is allowed; outside it stays jailed", () => {
        const cwd = freshDir("wr-proj-");
        const outside = freshDir("wr-out-");
        const inside = join(outside, "notes.md");
        clearSessionWriteRoots();
        // Without the root: jailed.
        expect(terminalPathOk(cwd, inside, [])).toBe(false);
        // With the root: allowed.
        setSessionWriteRoots(cwd, [outside]);
        expect(terminalPathOk(cwd, inside, [])).toBe(true);
        // A sibling of the root stays jailed (prefix attack).
        expect(terminalPathOk(cwd, `${outside}-evil/x`, [])).toBe(false);
        clearSessionWriteRoots();
    });

    test("the project dir and tmp policy are untouched when no roots are set", () => {
        const cwd = freshDir("wr-proj2-");
        clearSessionWriteRoots();
        expect(terminalPathOk(cwd, join(cwd, "ok.txt"), [])).toBe(true);
        expect(terminalPathOk(cwd, join(cwd, "..", "escape.txt"), [])).toBe(false);
    });

    test("a symlink into an added root resolves through the root (realpath equality)", () => {
        const cwd = freshDir("wr-proj3-");
        const target = freshDir("wr-target-");
        const link = join(cwd, "linkdir");
        symlinkSync(target, link);
        // Writes THROUGH the in-project symlink resolve to the added root → allowed.
        setSessionWriteRoots(cwd, [target]);
        expect(terminalPathOk(cwd, join(link, "f.txt"), [])).toBe(true);
        clearSessionWriteRoots();
    });
});

describe("bashRedirectEscape — the redirect exemption", () => {
    test("a redirect into an added root under a system tree is exempt (the /opt story)", () => {
        const cwd = freshDir("wr-proj4-");
        // A real directory under a SYSTEM_TREE that is NOT in TMP_ROOTS —
        // the writable stand-in for a "/opt/mydata"-style root. Platform
        // truth: POSIX /var/tmp exists on linux + darwin (darwin realpaths
        // to /private/var/tmp — the stored root is the realpath, so the
        // redirect is spelled through it); Windows has no /var, so the story
        // runs against %SystemRoot%\Temp (SYSTEM_TREE_WIN matches C:\Windows).
        // bashRedirectEscape is pure — nothing is written; only the ROOT
        // needs to exist on disk.
        const opt = (() => {
            if (process.platform === "win32") {
                const root = process.env.SystemRoot ?? "C:\\Windows";
                return join(root, "Temp");
            }
            return realpathSync("/var/tmp");
        })();
        const log = join(opt, "unown-write-roots-test.log");
        clearSessionWriteRoots();
        // No roots set: a system-tree redirect is an escape, on every OS.
        expect(bashRedirectEscape(cwd, `echo x > ${log}`)).toBeTruthy();
        // The root added: the same redirect is exempt.
        setSessionWriteRoots(cwd, [opt]);
        expect(bashRedirectEscape(cwd, `echo x > ${log}`)).toBeNull();
        // And on darwin the SYMLINK SPELLING works too (/var/tmp/... with a
        // /private/var/tmp root): the lexical layer exempts the resolved
        // path, not just the literal string (the 0.0.9 release-gate fix).
        if (process.platform === "darwin") {
            const literal = join("/var/tmp", "unown-write-roots-test.log");
            expect(bashRedirectEscape(cwd, `echo x > ${literal}`)).toBeNull();
        }
        clearSessionWriteRoots();
    });

    test("system trees without a covering root are still denied", () => {
        const cwd = freshDir("wr-proj4b-");
        clearSessionWriteRoots();
        expect(bashRedirectEscape(cwd, "echo x > /etc/passwd")).toBeTruthy();
        expect(bashRedirectEscape(cwd, "echo x > /usr/share/evil")).toBeTruthy();
    });

    test("devices and .ssh are NEVER exempted by an added root", () => {
        const cwd = freshDir("wr-proj5-");
        const home = freshDir("wr-home-");
        setSessionWriteRoots(cwd, [home]);
        // .ssh under an added root: denied on sight (SSH trust dir check runs first).
        expect(bashRedirectEscape(cwd, `echo k > ${join(home, ".ssh", "authorized_keys")}`)).toBeTruthy();
        clearSessionWriteRoots();
    });

    test("an in-project redirect keeps working regardless of roots", () => {
        const cwd = freshDir("wr-proj6-");
        clearSessionWriteRoots();
        expect(bashRedirectEscape(cwd, "echo x > out.txt")).toBeNull();
        setSessionWriteRoots(cwd, [freshDir("wr-7-")]);
        expect(bashRedirectEscape(cwd, "echo x > out.txt")).toBeNull();
        clearSessionWriteRoots();
    });
});

describe("instruction-set write gate stays FINAL over added roots", () => {
    test("an added root containing an AGENTS.md does not unlock writing it", () => {
        const cwd = freshDir("wr-proj8-");
        const other = freshDir("wr-other-");
        writeFileSync(join(other, "AGENTS.md"), "# other repo contract\n");
        setSessionWriteRoots(cwd, [other]);
        // The jail lets the write through…
        expect(terminalPathOk(cwd, join(other, "AGENTS.md"), [])).toBe(true);
        // …but the instruction-set gate still denies it (SA-B2, root-independent).
        const guard = instructionWriteDeny(cwd, join(other, "AGENTS.md"));
        expect(guard.deny).toBe(true);
        clearSessionWriteRoots();
    });
});
