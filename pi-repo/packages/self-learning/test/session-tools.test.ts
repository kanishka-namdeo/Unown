// Unit tests for src/session-tools.ts — the default ACTIVE tool set for
// unown sessions (the 2026-10 verify-first milestone's "dedicated search
// tools by default" change).
//
// Pins:
//   1.  the base four (pi's own default) are always present, in order
//   2.  ls is always enabled (pure JS — no binary dependency)
//   3.  grep is enabled exactly when a ripgrep binary resolves on PATH
//   4.  find is enabled when fd OR fdfind resolves (Debian's spelling)
//   5.  whichBinary honors a fake PATH and Windows PATHEXT probing
//
// Hermeticity: PATH is driven through explicit env objects pointing at
// throwaway dirs with fake binaries — the host's real PATH never decides a
// test outcome, and nothing spawns.
import "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_SESSION_TOOLS, defaultSessionTools, whichBinary } from "../src/session-tools.ts";

const cleanups: string[] = [];
afterAll(() => {
        // maxRetries: windows can hold a handle briefly after a just-killed spawn
for (const d of cleanups) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** A fake PATH dir containing the given binary names (all regular files).
 *  Windows-correct since 2026-10-22: whichBinary() probes PATHEXT extensions
 *  there (rg -> rg.com/.exe/.bat/.cmd), so an extensionless file named `rg`
 *  resolves to NOTHING — the fake dir must also carry `<name>.exe` twins or
 *  every "binary present" assertion fails on the windows CI leg (the
 *  2026-10-22 red; posix legs never noticed). */
function fakeBinDir(names: string[]): { dir: string; env: NodeJS.ProcessEnv } {
        const dir = mkdtempSync(join(tmpdir(), "unown-bins-"));
        cleanups.push(dir);
        for (const name of names) {
                const p = join(dir, name);
                writeFileSync(p, "#!/bin/sh\nexit 0\n", "utf8");
                if (process.platform === "win32") {
                        writeFileSync(join(dir, `${name}.exe`), "", "utf8");
                }
                try {
                        chmodSync(p, 0o755);
                } catch {
                        /* Windows chmod is a no-op for this purpose */
                }
        }
        const env: NodeJS.ProcessEnv = { PATH: dir };
        if (process.platform === "win32") env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
        return { dir, env };
}

describe("whichBinary", () => {
        test("resolves a binary present on the fake PATH", () => {
                const { env } = fakeBinDir(["rg"]);
                expect(whichBinary("rg", env)).toContain("rg");
                expect(whichBinary("fd", env)).toBeNull();
        });

        test("an empty or missing PATH resolves nothing", () => {
                expect(whichBinary("rg", {})).toBeNull();
                expect(whichBinary("rg", { PATH: "" })).toBeNull();
                expect(whichBinary("", { PATH: "/usr/bin" })).toBeNull();
        });

        test("Windows: PATHEXT extensions are probed", () => {
                const dir = mkdtempSync(join(tmpdir(), "unown-bins-"));
                cleanups.push(dir);
                writeFileSync(join(dir, "rg.exe"), "", "utf8");
                const env: NodeJS.ProcessEnv = { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
                expect(whichBinary("rg", env, "win32")?.toLowerCase()).toContain("rg.exe");
        });
});

describe("defaultSessionTools", () => {
        test("the base four are always present, in pi's order, and ls always rides along", () => {
                const { env } = fakeBinDir([]);
                const tools = defaultSessionTools(env);
                expect(tools.slice(0, 4)).toEqual(BASE_SESSION_TOOLS);
                expect(tools).toEqual(["read", "bash", "edit", "write", "ls"]);
        });

        test("rg on PATH enables grep; fd or fdfind enables find", () => {
                const { env } = fakeBinDir(["rg", "fdfind"]);
                expect(defaultSessionTools(env)).toEqual(["read", "bash", "edit", "write", "grep", "find", "ls"]);
        });

        test("rg alone enables grep but not find", () => {
                const { env } = fakeBinDir(["rg"]);
                expect(defaultSessionTools(env)).toEqual(["read", "bash", "edit", "write", "grep", "ls"]);
        });
});
