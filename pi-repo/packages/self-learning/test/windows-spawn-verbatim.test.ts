/**
 * windows-spawn-verbatim.test.ts — the win32 cmd.exe spawn contracts, pinned
 * as DATA after the v0.0.16 release bug: every binary-install engine
 * auto-start on Windows popped "Windows cannot find
 * '\C:\Users\…\unown\versions\0.0.16\unown.exe\'" and setup (which pings the
 * engine) triggered it on first contact.
 *
 * Root cause (both builders under test): an argv that is ALREADY quoted for
 * cmd.exe (`start "" "C:\…\unown.exe"`) was spawned WITHOUT
 * windowsVerbatimArguments, so Node/Bun's default Windows arg escaping
 * re-escaped the embedded quotes into `\"C:\…\unown.exe\"` — a form cmd.exe
 * does not understand (it has no backslash escaping). `start` then read the
 * token `\C:\…\unown.exe\` and ShellExecute failed with the dialog. The
 * builders now carry verbatim:true; these pins hold it there. The
 * node-default-escaping simulation below reproduces the mangling that made
 * the flag load-bearing.
 */
import { describe, expect, test } from "bun:test";
import { buildWindowsEngineSpawnSpec } from "../src/engine-supervisor.ts";
import { windowsMonitorSpawnSpec } from "../src/monitor.ts";

/** Node's default Windows argument escaping for spawn (what runs when
 * windowsVerbatimArguments is NOT set): embedded quotes become `\"`, and an
 * arg containing whitespace is wrapped after doubling its trailing
 * backslashes. This transform is why a pre-quoted-for-cmd argv must be
 * spawned verbatim. */
function nodeDefaultEscape(arg: string): string {
        let escaped = arg.replace(/(\\*)"/g, '$1$1\\"');
        if (/\s/.test(arg)) {
                escaped = `"${escaped.replace(/(\\*)$/, "$1$1")}"`;
        }
        return escaped;
}

/** What `start`'s tokenizer leaves of a token when the quote characters are
 * consumed as delimiters: the escaped-backslash residue. This is the exact
 * producer of the v0.0.16 dialog path. */
function startResidue(token: string): string {
        return token.replace(/"/g, "");
}

describe("buildWindowsEngineSpawnSpec (the v0.0.17 fix)", () => {
        const exe = "C:\\Users\\kanis\\AppData\\Local\\unown\\versions\\0.0.16\\unown.exe";

        test("the argv is the SS64-correct start form: empty title slot, quoted executable, serve args", () => {
                const spec = buildWindowsEngineSpawnSpec(exe, ["engine", "serve"]);
                expect(spec.command).toBe("cmd");
                expect(spec.args).toEqual(["/c", "start", "/b", "", `"${exe}"`, "engine", "serve"]);
                // The title slot is exactly the empty string — without it `start`
                // consumes a quoted executable path as the TITLE (SS64-documented trap).
                expect(spec.args[3]).toBe("");
                // The executable is quoted exactly once — the pre-quoted form `start` needs.
                expect(spec.args[4]).toBe(`"${exe}"`);
        });

        test("verbatim: true — the load-bearing flag of the fix", () => {
                // Without it, Node's default escaping mangles the pre-quoted argv
                // (pinned below) and `start` launches the residue, not the engine.
                expect(buildWindowsEngineSpawnSpec(exe, ["engine", "serve"]).verbatim).toBe(true);
        });

        test("REGRESSION PROOF: Node's default escaping produced the exact dialog path", () => {
                // The v0.0.16 spawn passed `"${command}"` (pre-quoted) through the
                // default escaper. For the user's space-free install path the result
                // is the bare mangled token…
                const mangled = nodeDefaultEscape(`"${exe}"`);
                expect(mangled.startsWith('\\"')).toBe(true);
                expect(mangled.endsWith('\\"')).toBe(true);
                // …and `start` consuming the quotes as delimiters leaves the exact
                // path from the dialog: leading + trailing stray backslashes where
                // the quotes used to be.
                expect(startResidue(mangled)).toBe(`\\${exe}\\`);
        });

        test("the spec spawns NO residue: the executable token is the plain quoted path", () => {
                const spec = buildWindowsEngineSpawnSpec(exe, ["engine", "serve"]);
                expect(spec.args[4]).not.toContain('\\"');
                // And the default escaper would change it — verbatim is what keeps it intact.
                expect(nodeDefaultEscape(spec.args[4])).not.toBe(spec.args[4]);
        });
});

describe("windowsMonitorSpawnSpec (the same class, hardened)", () => {
        test("cmd /d /s /c with the command outer-quoted, verbatim on", () => {
                const spec = windowsMonitorSpawnSpec('type "C:\\Program Files\\x.log"');
                expect(spec.command).toBe("cmd");
                expect(spec.args).toEqual(["/d", "/s", "/c", '"type "C:\\Program Files\\x.log""']);
                expect(spec.verbatim).toBe(true);
        });

        test("plain commands keep their shape under the same outer wrap", () => {
                const spec = windowsMonitorSpawnSpec("ping -n 2 127.0.0.1");
                expect(spec.args).toEqual(["/d", "/s", "/c", '"ping -n 2 127.0.0.1"']);
                expect(spec.verbatim).toBe(true);
        });

        test("REGRESSION PROOF: default escaping of a quoted Windows command breaks it the same way", () => {
                const cmd = 'type "C:\\Program Files\\x.log"';
                const mangled = nodeDefaultEscape(cmd);
                // cmd.exe has no backslash escaping: the \" sequences are garbage
                // on its command line — the monitor would run the wrong thing.
                expect(mangled).not.toBe(cmd);
                expect(mangled).toContain('\\"');
        });
});
