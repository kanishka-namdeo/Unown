// completions.test.ts — every completion script mentions every command word.
import "./_env.ts";
import { describe, expect, test } from "bun:test";
import {
        bashCompletion,
        cmdCompletions,
        fishCompletion,
        powershellCompletion,
        zshCompletion,
} from "../src/completions.ts";

// Mirrors the runCli dispatch surface (audit 2-b: the scripts used to omit
// providers/engine/blame + their subcommands and several session flags).
const ALL_COMMANDS = [
        "setup",
        "providers",
        "models",
        "init",
        "init-agents",
        "memory",
        "doctor",
        "doctor-instructions",
        "mcp",
        "automations",
        "engine",
        "usage",
        "webcache",
        "sessions",
        "blame",
        "recipes",
        "wiki",
        "acp",
        "note",
        "update",
        "changelog",
        "info",
        "completions",
        "uninstall",
        "help",
];

const MCP_SUBCOMMANDS = ["add", "add-http", "add-json", "list", "get", "remove", "test", "elicitation"];
const PROVIDERS_SUBCOMMANDS = ["list", "add", "remove", "key", "default", "test", "refresh"];
const ENGINE_SUBCOMMANDS = ["status", "start", "stop", "repair", "serve"];

describe("unown completions", () => {
        test("every shell script mentions every command + the update flags (drift guard)", () => {
                const scripts = {
                        bash: bashCompletion(),
                        zsh: zshCompletion(),
                        fish: fishCompletion(),
                        powershell: powershellCompletion(),
                };
                for (const [shell, script] of Object.entries(scripts)) {
                        for (const cmd of ALL_COMMANDS) expect(script).toContain(cmd);
                        for (const flag of ["--check", "--rollback", "--allow-dirty"]) expect(script).toContain(flag);
                        // ASCII only — the powershell script must survive the ISE codepage,
                        // and the repo keeps launchers ASCII on Windows by contract.
                        expect(script).not.toMatch(/[^\x00-\x7F]/);
                        expect(shell.length).toBeGreaterThan(0);
                }
        });

        test("bash/zsh/fish offer the mcp + providers + engine subcommands (drift guard)", () => {
                for (const script of [bashCompletion(), zshCompletion(), fishCompletion()]) {
                        for (const sub of MCP_SUBCOMMANDS) expect(script).toContain(sub);
                        for (const sub of PROVIDERS_SUBCOMMANDS) expect(script).toContain(sub);
                        for (const sub of ENGINE_SUBCOMMANDS) expect(script).toContain(sub);
                }
        });

        test("session flags complete (incl. --session/--provider/--no-split)", () => {
                for (const script of [bashCompletion(), zshCompletion(), fishCompletion(), powershellCompletion()]) {
                        for (const flag of ["--session", "--provider", "--no-split", "--output-format"]) {
                                expect(script).toContain(flag);
                        }
                }
        });

        test("fish emits -p as a short flag (-s), not a long flag (-l p)", () => {
                const fish = fishCompletion();
                expect(fish).toContain("-s p ");
                expect(fish).not.toContain("-l p ");
        });

        test("cmdCompletions dispatch, usage, --help, and unknown shell", () => {
                const lines: string[] = [];
                const log = (l: string) => lines.push(l);
                expect(cmdCompletions(["bash"], { log })).toBe(0);
                expect(cmdCompletions(["zsh"], { log })).toBe(0);
                expect(cmdCompletions(["fish"], { log })).toBe(0);
                expect(cmdCompletions(["powershell"], { log })).toBe(0);
                expect(cmdCompletions([], { log })).toBe(1);
                expect(cmdCompletions(["tcsh"], { log })).toBe(1);
                // clig.dev: --help prints help and exits 0 (audit 2-b F3).
                expect(cmdCompletions(["--help"], { log })).toBe(0);
                expect(cmdCompletions(["-h"], { log })).toBe(0);
                expect(lines.join("\n")).toContain("usage: unown completions");
                expect(lines.join("\n")).toContain("Install (bash):");
        });
});
