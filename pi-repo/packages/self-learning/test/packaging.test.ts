// Unit tests for src/packaging.ts — the two-shapes module (source checkout vs
// Bun-compiled standalone binary). Why each case is here:
//
//   - isBunVirtualPath: every accepted spelling was MEASURED by running a real
//     compiled probe on the platform that produces it (bun 1.4.2). POSIX prints
//     `/$bunfs/root`; Windows prints `B:\~BUN\root` in import.meta.dir and
//     percent-encodes the tilde in import.meta.url. The Windows `~BUN` form is
//     the regression this replaces: the guard tools.ts wrote first matched only
//     `$bunfs` and never saw `~BUN`, so a compiled Windows binary was
//     mis-classified as a source run (silently, because nothing shipped one).
//   - The negatives matter as much as the positives: a real checkout path that
//     merely contains "$bunfs" or "~BUN" in a directory name must NOT be
//     treated as virtual, or the binary/state routing flips on a normal install.
//   - stateRoot: the crash this module exists for is store.ts's module-scope
//     `mkdirSync(dirname(DB_PATH))` resolving a repo root of
//     `B:\~BUN\root\..\..\..\..` → `C:\` → EPERM before unown prints a line.
//   - unownVersion: injected-define mode cannot be exercised from a test (it
//     requires an actual compile); that leg is covered by the release workflow's
//     per-OS artifact smoke, which asserts `--version` equals the tag.
import "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isBunVirtualPath, stateRoot, unownHome, unownVersion } from "../src/packaging.ts";

const scratch = mkdtempSync(join(tmpdir(), "unown-packaging-"));

describe("isBunVirtualPath — the measured compiled-binary spellings", () => {
        test.each([
                ["/$bunfs/root/probe-linux", "posix import.meta.path"],
                ["file:///$bunfs/root/probe-linux", "posix import.meta.url"],
                ["B:\\~BUN\\root\\probe.exe", "windows import.meta.dir"],
                ["B:/~BUN/root/probe.exe", "windows forward-slash form"],
                ["file:///B:/%7EBUN/root/probe.exe", "windows import.meta.url (encoded tilde)"],
                ["C:\\$bunfs\\root\\src\\cli.ts", "windows legacy $bunfs spelling"],
        ])("%s is virtual (%s)", (p: string) => {
                expect(isBunVirtualPath(p)).toBe(true);
        });

        test.each([
                ["D:\\test_agent\\Unown\\bin\\unown", "a real windows checkout path"],
                ["/home/u/src/Unown/pi-repo/packages/self-learning/src/cli.ts", "a real posix path"],
                ["/$bunfs", "the prefix without /root/"],
                ["C:\\$bunfs\\other\\x", "$bunfs but not the root dir"],
                ["/home/u/projects/~bunwork/x", "a real dir whose name contains ~bun"],
                ["/tmp/$bunfs/rootkit/tool", "$bunfs/root is a prefix of a real name, not the root dir"],
                ["", "empty string"],
                [undefined, "undefined"],
        ])("%s is NOT virtual (%s)", (p: string | undefined) => {
                expect(isBunVirtualPath(p)).toBe(false);
        });

        test("the real executable path is never classified as virtual", () => {
                // process.execPath is the one anchor that is a genuine file in BOTH
                // shapes; misclassifying it would strand the binary's own assets.
                expect(isBunVirtualPath(process.execPath)).toBe(false);
        });
});

describe("unownHome — `||` not `??`", () => {
        test("an empty UNOWN_HOME means unset", () => {
                // bun auto-loads .env, and .env.example ships UNOWN_HOME= empty. A
                // `??` would make the state dir "" and resolve everything relative
                // to cwd.
                expect(unownHome({ UNOWN_HOME: "" })).not.toBe("");
                expect(unownHome({ UNOWN_HOME: "" }).endsWith(".unown")).toBe(true);
        });

        test("a set UNOWN_HOME wins verbatim", () => {
                expect(unownHome({ UNOWN_HOME: "/srv/unown-state" })).toBe("/srv/unown-state");
        });
});

describe("stateRoot — where engine state lives per shape", () => {
        test("a source run keeps the checkout root", () => {
                expect(stateRoot("/home/u/Unown", {}, false)).toBe("/home/u/Unown");
        });

        test("a compiled binary uses UNOWN_HOME, never the virtual root", () => {
                const virtual = "B:\\~BUN\\root\\..\\..\\..\\..";
                const root = stateRoot(virtual, { UNOWN_HOME: join(scratch, "home") }, true);
                expect(root).toBe(join(scratch, "home"));
                expect(isBunVirtualPath(root)).toBe(false);
        });

        test("an explicit env path still outranks both shapes", () => {
                // store.ts applies PI_SELFLEARNING_DATA/DB before reaching here, so a
                // configured path must survive whichever shape is running.
                expect(stateRoot("/home/u/Unown", { UNOWN_HOME: join(scratch, "home") }, true)).toBe(
                        join(scratch, "home"),
                );
        });
});

describe("unownVersion — the checkout fallback chain", () => {
        test("reads the version out of the package.json it is given", () => {
                const dir = mkdtempSync(join(scratch, "versioned-"));
                const file = join(dir, "package.json");
                writeFileSync(file, JSON.stringify({ version: "9.9.9" }));
                expect(unownVersion(file)).toBe("9.9.9");
        });

        test("degrades to unknown instead of throwing when the file is gone", () => {
                // This is the compiled-binary path: the repo-relative guess does not
                // exist, and a crash here would take the CLI down at import time.
                expect(unownVersion(join(scratch, "does-not-exist", "package.json"))).toBe("unknown");
        });

        test("a package.json without a version is unknown, not the string undefined", () => {
                const dir = mkdtempSync(join(scratch, "noversion-"));
                const file = join(dir, "package.json");
                writeFileSync(file, JSON.stringify({ name: "x" }));
                expect(unownVersion(file)).toBe("unknown");
        });
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));
