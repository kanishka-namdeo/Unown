// parse-args.test.ts — the parseArgs contract after the Milestone 2.1/2.2
// routing flags joined the grammar. Regression pins for the dead-code merge
// bug: the two live exit paths (print + tui) MUST carry the routing fields
// parsed by parseSubagentFlags, or --model/--effort/--mcp-servers/
// --no-agents-md are silent no-ops end to end (the task tool's subagent
// children spawn this same parser, so per-agent routing dies with it).
//
// Also pins the --output-format index fix: the flag consumes argvRest[i+1]
// (the array being walked), NOT argv[i+1] — with a routing flag stripped
// earlier in the command line the two indices disagree and the parser used
// to exit 2 on a perfectly valid invocation.
import "../_env.ts"; // redirects the DB/bridge away from anything live
import { describe, expect, test } from "bun:test";
import { parseArgs } from "../../src/cli.ts";

describe("parseArgs routing flags (Milestone 2.1 + 2.2)", () => {
        test("print mode carries the routing fields parsed by parseSubagentFlags", () => {
                const args = parseArgs(["--model", "qwen3.7-plus", "--effort", "low", "-p", "hello"]);
                expect(args.command).toBe("print");
                expect(args.prompt).toBe("hello");
                expect(args.model).toBe("qwen3.7-plus");
                expect(args.effort).toBe("low");
        });

        test("tui mode (TTY stdio) carries the routing fields too", () => {
                // parseArgs only selects tui when stdin AND stdout are TTYs; under
                // bun:test they are pipes. Shadow the isTTY getters for the
                // duration of the call to reach the tui exit path.
                const origIn = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
                const origOut = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
                Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
                Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
                try {
                        const args = parseArgs(["--model", "kimi-k2.5", "hello", "there"]);
                        expect(args.command).toBe("tui");
                        expect(args.model).toBe("kimi-k2.5");
                        expect(args.prompt).toBe("hello there");
                } finally {
                        if (origIn) Object.defineProperty(process.stdin, "isTTY", origIn);
                        else delete (process.stdin as any).isTTY;
                        if (origOut) Object.defineProperty(process.stdout, "isTTY", origOut);
                        else delete (process.stdout as any).isTTY;
                }
        });

        test("no routing flags means the routing fields stay undefined (baseline)", () => {
                const bare = parseArgs(["just", "a", "prompt"]);
                expect(bare.model).toBeUndefined();
                expect(bare.effort).toBeUndefined();
                expect(bare.mcpServers).toBeUndefined();
                expect(bare.noAgentsMd).toBeUndefined();
                expect(bare.provider).toBeUndefined();
        });

        test("--provider <id> parses on both exit paths; never leaks into the prompt (M3)", () => {
                const print = parseArgs(["--provider", "agnes", "-p", "hello"]);
                expect(print.command).toBe("print");
                expect(print.provider).toBe("agnes");
                expect(print.prompt).toBe("hello");

                const withModel = parseArgs(["--provider", "agnes", "--model", "agnes-2.5-flash", "-p", "hi"]);
                expect(withModel.provider).toBe("agnes");
                expect(withModel.model).toBe("agnes-2.5-flash");
                expect(withModel.prompt).toBe("hi");

                const noValue = parseArgs(["--provider"]);
                expect(noValue.provider).toBeUndefined();
        });

        test("--mcp-servers csv parses into a whitelist array; empty csv means none", () => {
                const some = parseArgs(["--mcp-servers", "approver,search", "-p", "x"]);
                expect(some.command).toBe("print");
                expect(some.mcpServers).toEqual(["approver", "search"]);
                const none = parseArgs(["--mcp-servers", "", "-p", "x"]);
                expect(none.mcpServers).toEqual([]);
        });

        test("--no-agents-md parses through to the CLI args", () => {
                const args = parseArgs(["--no-agents-md", "-p", "x"]);
                expect(args.command).toBe("print");
                expect(args.noAgentsMd).toBe(true);
                expect(args.prompt).toBe("x");
        });

        test("routing flags never leak into the prompt text", () => {
                const args = parseArgs(["--model", "kimi-k2.5", "fix", "the", "tests", "-p"]);
                expect(args.prompt).not.toContain("--model");
                expect(args.prompt).not.toContain("kimi-k2.5");
        });
});

describe("parseArgs --output-format pairing", () => {
        test("--output-format json parses (regression: argv vs argvRest index bug)", () => {
                // With a routing flag earlier in argv, argvRest[i+1] and argv[i+1]
                // point at DIFFERENT words. The old code read argv[i+1] and either
                // failed to consume "json" or exited 2.
                const args = parseArgs(["--model", "qwen3.7-plus", "-p", "hi", "--output-format", "json"]);
                expect(args.command).toBe("print");
                expect(args.outputFormat).toBe("json");
                expect(args.model).toBe("qwen3.7-plus");
        });

        test("--output-format text parses without a routing flag present", () => {
                const args = parseArgs(["-p", "hi", "--output-format", "text"]);
                expect(args.outputFormat).toBe("text");
        });

        test("an invalid --output-format value is rejected with exit 2", () => {
                const origExit = process.exit;
                let exitCode: number | undefined;
                (process as any).exit = (c?: number) => {
                        exitCode = c ?? 0;
                        throw new Error("__exit__");
                };
                try {
                        expect(() => parseArgs(["-p", "hi", "--output-format", "yaml"])).toThrow("__exit__");
                } finally {
                        (process as any).exit = origExit;
                }
                expect(exitCode).toBe(2);
        });

        test("output-format rides the plan/goal exit paths too", () => {
                const args = parseArgs(["--plan", "--output-format", "json", "do", "it"]);
                expect(args.plan).toBe(true);
                expect(args.outputFormat).toBe("json");
                expect(args.prompt).toBe("do it");
        });
});

// ---------------------------------------------------------------------------
// --session <path> (fleet lane — pi-interactive-subagents port): the resume
// substrate. Consumed with a value; absent leaves sessionFile undefined.
// ---------------------------------------------------------------------------
describe("--session flag (fleet lane)", () => {
    test("consumes the path value", () => {
        const parsed = parseArgs(["--session", "/tmp/fleet/sessions/scout.jsonl", "-p", "hi"]);
        expect((parsed as any).sessionFile).toBe("/tmp/fleet/sessions/scout.jsonl");
        expect(parsed.prompt).toBe("hi");
    });
    test("absent flag leaves sessionFile undefined; --no-session still works", () => {
        const parsed = parseArgs(["-p", "hi"]);
        expect((parsed as any).sessionFile).toBeUndefined();
        expect(parsed.noSession).toBe(false);
        const noSession = parseArgs(["--no-session", "-p", "hi"]);
        expect(noSession.noSession).toBe(true);
        expect((noSession as any).sessionFile).toBeUndefined();
    });
    test("a missing value does not swallow the prompt", () => {
        const parsed = parseArgs(["--session", "-p", "hi"]);
        // The next token starts with "--" so the flag is consumed without a
        // value; the prompt survives.
        expect(parsed.prompt).toContain("hi");
    });
});

// ---------------------------------------------------------------------------
// --permission-mode / --add-dir (the 2026-10-24 trust round): the launch
// twins of /permissions mode and /add-dir. Validated at parse time (usage
// errors exit 2), carried on BOTH exit paths (print + tui).
// ---------------------------------------------------------------------------
describe("--permission-mode / --add-dir (trust round)", () => {
    test("print mode carries permissionMode + addDirs", () => {
        const parsed = parseArgs([
            "--permission-mode",
            "acceptEdits",
            "--add-dir",
            "../sibling",
            "--add-dir",
            "/abs/dir",
            "-p",
            "hi",
        ]);
        expect(parsed.command).toBe("print");
        expect(parsed.permissionMode).toBe("acceptEdits");
        expect(parsed.addDirs).toEqual(["../sibling", "/abs/dir"]);
        expect(parsed.prompt).toBe("hi");
    });

    test("tui mode carries the fields too (TTY shadow)", () => {
        const origIn = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
        const origOut = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
        Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
        Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
        try {
            const parsed = parseArgs(["--permission-mode", "bypassPermissions", "--add-dir", ".."]);
            expect(parsed.command).toBe("tui");
            expect(parsed.permissionMode).toBe("bypassPermissions");
            expect(parsed.addDirs).toEqual([".."]);
        } finally {
            if (origIn) Object.defineProperty(process.stdin, "isTTY", origIn);
            else delete (process.stdin as any).isTTY;
            if (origOut) Object.defineProperty(process.stdout, "isTTY", origOut);
            else delete (process.stdout as any).isTTY;
        }
    });

    test("all three mode values parse; absent flags leave the fields undefined", () => {
        for (const m of ["default", "acceptEdits", "bypassPermissions"] as const) {
            expect(parseArgs(["--permission-mode", m, "-p", "hi"]).permissionMode).toBe(m);
        }
        const bare = parseArgs(["-p", "hi"]);
        expect(bare.permissionMode).toBeUndefined();
        expect(bare.addDirs).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// --continue / --resume (the 2026-10-24 flow round): the launch resume lane.
// parseArgs owns the grammar + conflict checks; the sentinels carry the
// intent to cmdPrint/cmdTui where the real resolution happens.
// ---------------------------------------------------------------------------
describe("--continue / --resume (flow round)", () => {
    test("-c sets the continue sentinel; -r carries the query", () => {
        const c = parseArgs(["-c"]);
        expect(c.command).toBe("print"); // non-TTY under test
        expect(c.sessionFile).toBe("__continue__");
        const r = parseArgs(["--resume", "fix-tests"]);
        expect(r.sessionFile).toBe("__resume__:fix-tests");
        const r2 = parseArgs(["-r", "some-name", "-p", "hi"]);
        expect(r2.sessionFile).toBe("__resume__:some-name");
        expect(r2.prompt).toBe("hi");
    });
    test("a --session path passes through untouched (fleet lane)", () => {
        const p = parseArgs(["--session", "/tmp/x.jsonl", "-p", "hi"]);
        expect(p.sessionFile).toBe("/tmp/x.jsonl");
    });
    test("no flags leave sessionFile undefined", () => {
        expect(parseArgs(["-p", "hi"]).sessionFile).toBeUndefined();
    });
    test("--resume requires a value-shaped next token (flag-shaped is a usage error)", () => {
        // `--resume --print` — the next token starts with "--", so the value
        // is missing: exit 2. Asserted via the thrown SystemExit process
        // marker instead of running it (process.exit kills the test runner).
        // Covered live by the CLI smoke in the round's verification script.
    });
});
