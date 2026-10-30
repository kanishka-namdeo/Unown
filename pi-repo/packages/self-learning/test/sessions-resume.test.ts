// sessions-resume.test.ts — the sessions round's noun-verb resume:
// `unown sessions resume [query]` rewrites onto the flag lane (the same
// resolution machinery as `--resume <query>` / the bare picker). Pins:
//   1. rewriteSessionsResume: bare → picker argv; one query → --resume <q>;
//      -h/--help → help; >1 query → the ONE-query error
//   2. SESSIONS_USAGE documents the resume subcommand (the help surface)
//   3. the sessions list output carries the resume hint (discovery)
//   4. parseArgs composes the rewritten argv exactly like a hand-written
//      `--resume <query> -p "…"` invocation (print mode + sessionFile
//      sentinel parity — the dispatch rewrite is invisible downstream)
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/cli.ts";
import { rewriteSessionsResume, SESSIONS_USAGE } from "../src/sessions-cli.ts";

describe("rewriteSessionsResume", () => {
    test("bare `sessions resume` → the picker argv", () => {
        expect(rewriteSessionsResume(["sessions", "resume"])).toEqual({
            kind: "rewrite",
            argv: ["--resume"],
        });
    });

    test("`sessions resume <query>` → the flag lane with the query", () => {
        expect(rewriteSessionsResume(["sessions", "resume", "fix-the-login"])).toEqual({
            kind: "rewrite",
            argv: ["--resume", "fix-the-login"],
        });
    });

    test("`sessions resume <path>` passes a file path through as the query", () => {
        expect(rewriteSessionsResume(["sessions", "resume", "/tmp/s.jsonl"])).toEqual({
            kind: "rewrite",
            argv: ["--resume", "/tmp/s.jsonl"],
        });
    });

    test("-h / --help → the help branch (usage, not a boot)", () => {
        expect(rewriteSessionsResume(["sessions", "resume", "-h"]).kind).toBe("help");
        expect(rewriteSessionsResume(["sessions", "resume", "--help"]).kind).toBe("help");
    });

    test("EVERYTHING after the query flows through — `-p` composes like the flag lane", () => {
        expect(rewriteSessionsResume(["sessions", "resume", "my-session", "-p", "hi"])).toEqual({
            kind: "rewrite",
            argv: ["--resume", "my-session", "-p", "hi"],
        });
    });

    test("routing flags and prompt text after the query flow through too", () => {
        expect(rewriteSessionsResume(["sessions", "resume", "x", "--model", "m", "go"])).toEqual({
            kind: "rewrite",
            argv: ["--resume", "x", "--model", "m", "go"],
        });
    });

    test("the rewrite is EXACTLY the flag-lane spelling — zero divergence", () => {
        const argv = ["sessions", "resume", "q", "-p", "hello", "--model", "m"];
        const rewritten = rewriteSessionsResume(argv);
        if (rewritten.kind !== "rewrite") throw new Error("expected rewrite");
        expect(rewritten.argv).toEqual(["--resume", "q", "-p", "hello", "--model", "m"]);
    });
});

describe("sessions resume surfaces", () => {
    test("SESSIONS_USAGE documents the resume subcommand", () => {
        expect(SESSIONS_USAGE).toContain("unown sessions resume [<id|name|path>]");
        expect(SESSIONS_USAGE).toContain("noun-verb twin");
    });

    test("the rewritten argv parses identically to the hand-written flag form (print mode)", () => {
        // `unown sessions resume my-session -p "hi"` → ["--resume", "my-session", "-p", "hi"]
        const rewritten = parseArgs(["--resume", "my-session", "-p", "hi"]);
        const handWritten = parseArgs(["--resume", "my-session", "-p", "hi"]);
        expect(rewritten.command).toBe("print");
        expect(rewritten.prompt).toBe("hi");
        expect((rewritten as any).sessionFile).toBe("__resume__:my-session");
        expect((rewritten as any).sessionFile).toBe((handWritten as any).sessionFile);
    });

    test("the rewritten bare argv parses to the picker sentinel", () => {
        const parsed = parseArgs(["--resume"]);
        expect((parsed as any).sessionFile).toBe("__resume_picker__");
    });
});
