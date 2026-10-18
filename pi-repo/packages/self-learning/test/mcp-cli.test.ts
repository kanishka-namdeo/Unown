// Unit tests for src/mcp-cli.ts — `unown mcp` subcommands (P1 productization,
// research R-c §2/§4): Claude Code-style MCP config management.
//
// Layers:
//   1. add (stdio) — user-scope write, arg/env/cwd flags, `--` passthrough,
//      never-clobber (duplicate name, garbage file, other keys preserved)
//   2. add-http — url + repeatable headers, validation through mcp.ts's
//      normalizer (non-http urls refused with the session's message)
//   3. add-json — valid paste + invalid shapes rejected with the exact
//      loadMcpConfigFile messages
//   4. project scope — writes .unown/mcp.json and AUTO-TRUSTS it (explicit
//      interactive intent); remove from a trusted project file re-trusts the
//      new content, an untrusted one stays untrusted
//   5. remove — single scope, both-scopes ambiguity, missing name
//   6. list / get — table + trust annotations, stored entry JSON + source file
//   7. test — live probe against test/fixtures/mock-mcp-server.mjs, error
//      paths (missing server, gated project server, dead binary)
//   8. surface — no-args usage, unknown subcommand, --help, name validation
import "./_env.ts"; // MUST be first by convention (see AGENTS.md suite-ordering note)
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMcpCommand, type McpCliResult } from "../src/mcp-cli.ts";
import { loadTrust, trustApprovalNeeded, trustConfig, trustStatePath } from "../src/config-trust.ts";
import { loadMcpConfigFile } from "../src/mcp.ts";

const MOCK_SERVER = join(import.meta.dir, "fixtures", "mock-mcp-server.mjs");
const NODE = "node";

const root = mkdtempSync(join(tmpdir(), "unown-mcp-cli-"));
afterAll(() => {
    try {
        rmSync(root, { recursive: true, force: true });
    } catch {
        /* best effort — /tmp is janitor-swept */
    }
});

/** A fresh cwd + userDir pair (both exist; user mcp.json optionally seeded). */
function dirs(seedUser?: Record<string, unknown>): { cwd: string; userDir: string } {
    const n = Math.random().toString(36).slice(2, 8);
    const cwd = join(root, `proj-${n}`);
    const userDir = join(root, `user-${n}`);
    mkdirSync(cwd, { recursive: true });
    mkdirSync(userDir, { recursive: true });
    if (seedUser) writeFileSync(join(userDir, "mcp.json"), JSON.stringify(seedUser, null, 2));
    return { cwd, userDir };
}

/** Clean env (no trust bypass) so the gate behaves like a fresh machine. */
function cleanEnv(): Record<string, string | undefined> {
    const env = { ...process.env };
    delete env.UNOWN_TRUST_PROJECT_CONFIG;
    return env;
}

async function run(argv: string[], cwd: string, userDir: string): Promise<McpCliResult> {
    return runMcpCommand(argv, { cwd, userDir, env: cleanEnv() });
}

const userFileOf = (userDir: string) => join(userDir, "mcp.json");
const projectFileOf = (cwd: string) => join(cwd, ".unown", "mcp.json");
const trustOptsFor = (userDir: string) => ({ statePath: trustStatePath(userDir), userDir, env: cleanEnv() });
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

// ---------------------------------------------------------------------------
// 1. add (stdio)
// ---------------------------------------------------------------------------

describe("unown mcp add (stdio)", () => {
    test("writes a user-scope entry (args preserved) without clobbering other content", async () => {
        const { cwd, userDir } = dirs({ mcpServers: { existing: { command: "echo" } }, note: "keep-me" });
        const r = await run(["add", "srv", "node", MOCK_SERVER, "--flagged"], cwd, userDir);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("✓ added srv (stdio)");
        expect(r.stdout).toContain(userFileOf(userDir));
        const file = readJson(userFileOf(userDir));
        expect(file.mcpServers.existing).toEqual({ command: "echo" });
        expect(file.mcpServers.srv).toEqual({ command: "node", args: [MOCK_SERVER, "--flagged"] });
        expect(file.note).toBe("keep-me"); // unknown top-level keys preserved
    });

    test("--env (repeatable, ${VAR} literal) and --cwd are stored", async () => {
        const { cwd, userDir } = dirs();
        const r = await run(
            ["add", "srv", "--env", "A=1", "--env", "TOKEN=${MY_SECRET}", "--cwd", "/tmp", "node", MOCK_SERVER],
            cwd,
            userDir,
        );
        expect(r.exitCode).toBe(0);
        expect(readJson(userFileOf(userDir)).mcpServers.srv).toEqual({
            command: "node",
            args: [MOCK_SERVER],
            env: { A: "1", TOKEN: "${MY_SECRET}" },
            cwd: "/tmp",
        });
    });

    test("`--` passthrough keeps flag-like server args literal; post-command --flags are args", async () => {
        const { cwd, userDir } = dirs();
        const withSeparator = await run(["add", "a", "--scope", "user", "--", "node", MOCK_SERVER, "--port", "3000"], cwd, userDir);
        expect(withSeparator.exitCode).toBe(0);
        expect(readJson(userFileOf(userDir)).mcpServers.a).toEqual({
            command: "node",
            args: [MOCK_SERVER, "--port", "3000"],
        });
        const withoutSeparator = await run(["add", "b", "node", MOCK_SERVER, "--port", "3000"], cwd, userDir);
        expect(withoutSeparator.exitCode).toBe(0);
        expect(readJson(userFileOf(userDir)).mcpServers.b).toEqual({
            command: "node",
            args: [MOCK_SERVER, "--port", "3000"],
        });
    });

    test("refuses a duplicate name, a garbage config file, and unknown flags before the command", async () => {
        const { cwd, userDir } = dirs({ mcpServers: { dup: { command: "echo" } } });
        const dup = await run(["add", "dup", "node"], cwd, userDir);
        expect(dup.exitCode).toBe(1);
        expect(dup.stderr).toContain("already exists");

        writeFileSync(userFileOf(userDir), "{ not json");
        const garbage = await run(["add", "fresh", "node"], cwd, userDir);
        expect(garbage.exitCode).toBe(1);
        expect(garbage.stderr).toContain("not valid JSON");
        expect(readFileSync(userFileOf(userDir), "utf8")).toBe("{ not json"); // untouched

        const { cwd: c2, userDir: u2 } = dirs();
        const unknown = await run(["add", "x", "--bogus", "node"], c2, u2);
        expect(unknown.exitCode).toBe(1);
        expect(unknown.stderr).toContain("unknown flag --bogus");
    });
});

// ---------------------------------------------------------------------------
// 2. add-http
// ---------------------------------------------------------------------------

describe("unown mcp add-http", () => {
    test("writes url + repeatable headers", async () => {
        const { cwd, userDir } = dirs();
        const r = await run(
            ["add-http", "web", "https://example.com/mcp", "--header", "Authorization: Bearer tok", "--header", "X-Custom: v"],
            cwd,
            userDir,
        );
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("✓ added web (http)");
        expect(readJson(userFileOf(userDir)).mcpServers.web).toEqual({
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer tok", "X-Custom": "v" },
        });
    });

    test("non-http urls are refused with the session validator's message", async () => {
        const { cwd, userDir } = dirs();
        const r = await run(["add-http", "web", "ftp://files.example.com/x"], cwd, userDir);
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain("url scheme must be http or https");
        expect(existsSync(userFileOf(userDir))).toBe(false); // nothing written
    });
});

// ---------------------------------------------------------------------------
// 3. add-json
// ---------------------------------------------------------------------------

describe("unown mcp add-json", () => {
    test("pastes a full stdio entry verbatim", async () => {
        const { cwd, userDir } = dirs();
        const r = await run(["add-json", "pasted", JSON.stringify({ command: "npx", args: ["-y", "pkg"], env: { K: "v" } })], cwd, userDir);
        expect(r.exitCode).toBe(0);
        expect(readJson(userFileOf(userDir)).mcpServers.pasted).toEqual({ command: "npx", args: ["-y", "pkg"], env: { K: "v" } });
    });

    test("invalid shapes are rejected with the exact loadMcpConfigFile messages", async () => {
        const { cwd, userDir } = dirs();
        const noShape = await run(["add-json", "bad", JSON.stringify({ nope: true })], cwd, userDir);
        expect(noShape.exitCode).toBe(1);
        expect(noShape.stderr).toContain("needs either 'command' (stdio) or 'url' (http)");

        const notJson = await run(["add-json", "bad2", "{ oops"], cwd, userDir);
        expect(notJson.exitCode).toBe(1);
        expect(notJson.stderr).toContain("did not parse");

        const array = await run(["add-json", "bad3", "[1,2]"], cwd, userDir);
        expect(array.exitCode).toBe(1);
        expect(array.stderr).toContain("must be one server object");

        // Header validation rides the same path (CRLF → dropped + problem).
        const splitting = await run(
            ["add-json", "bad4", JSON.stringify({ url: "https://x.example/mcp", headers: { Authorization: "Bearer a\r\nX-Evil: 1" } })],
            cwd,
            userDir,
        );
        expect(splitting.exitCode).toBe(1);
        expect(splitting.stderr).toContain("line break");
        expect(existsSync(userFileOf(userDir))).toBe(false); // nothing written on any failure
    });
});

// ---------------------------------------------------------------------------
// 4. project scope + the trust gate
// ---------------------------------------------------------------------------

describe("unown mcp — project scope auto-trust", () => {
    test("add --scope project writes .unown/mcp.json and trusts the content it just wrote", async () => {
        const { cwd, userDir } = dirs();
        const r = await run(["add", "local", "--scope", "project", "node", MOCK_SERVER], cwd, userDir);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("→ " + projectFileOf(cwd));
        expect(r.stdout).toContain("trusted");
        expect(readJson(projectFileOf(cwd)).mcpServers.local).toEqual({ command: "node", args: [MOCK_SERVER] });
        expect(trustApprovalNeeded(projectFileOf(cwd), trustOptsFor(userDir))).toBe(false);
        // …and the session loader now sees the server (not gated):
        const listed = await run(["list"], cwd, userDir);
        expect(listed.stdout).toContain("local");
        expect(listed.stdout).not.toContain("untrusted");
    });

    test("remove from a trusted project file keeps the new content trusted", async () => {
        const { cwd, userDir } = dirs();
        await run(["add", "one", "--scope", "project", "node", MOCK_SERVER], cwd, userDir);
        await run(["add", "two", "--scope", "project", "node", MOCK_SERVER], cwd, userDir);
        const r = await run(["remove", "one", "--scope", "project"], cwd, userDir);
        expect(r.exitCode).toBe(0);
        expect(readJson(projectFileOf(cwd)).mcpServers).toEqual({ two: { command: "node", args: [MOCK_SERVER] } });
        expect(trustApprovalNeeded(projectFileOf(cwd), trustOptsFor(userDir))).toBe(false);
    });

    test("removing from an UNTRUSTED project file leaves it untrusted (no silent blessing)", async () => {
        const { cwd, userDir } = dirs();
        mkdirSync(join(cwd, ".unown"), { recursive: true });
        writeFileSync(projectFileOf(cwd), JSON.stringify({ mcpServers: { foreign: { command: "runme" } } }));
        expect(trustApprovalNeeded(projectFileOf(cwd), trustOptsFor(userDir))).toBe(true);
        const r = await run(["remove", "foreign"], cwd, userDir);
        expect(r.exitCode).toBe(0);
        expect(readJson(projectFileOf(cwd)).mcpServers).toEqual({});
        expect(trustApprovalNeeded(projectFileOf(cwd), trustOptsFor(userDir))).toBe(true);
    });

    test("a hand-edited (re-written) trusted file re-arms the gate — fingerprints pin content", async () => {
        const { cwd, userDir } = dirs();
        await run(["add", "mine", "--scope", "project", "node", MOCK_SERVER], cwd, userDir);
        const before = readJson(projectFileOf(cwd));
        before.mcpServers.attacker = { command: "curl evil.example" };
        writeFileSync(projectFileOf(cwd), JSON.stringify(before, null, 2));
        expect(trustApprovalNeeded(projectFileOf(cwd), trustOptsFor(userDir))).toBe(true);
        // The in-session approval API still works on it (what /mcp trust calls):
        expect(trustConfig(projectFileOf(cwd), trustOptsFor(userDir))).toBe(true);
        expect(loadTrust(trustStatePath(userDir)).trusted.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 5. remove
// ---------------------------------------------------------------------------

describe("unown mcp remove", () => {
    test("round-trip: add → remove → gone, file + other servers kept", async () => {
        const { cwd, userDir } = dirs();
        await run(["add", "one", "node"], cwd, userDir);
        await run(["add", "two", "node"], cwd, userDir);
        const r = await run(["remove", "one"], cwd, userDir);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain(`✓ removed one from ${userFileOf(userDir)}`);
        expect(readJson(userFileOf(userDir)).mcpServers).toEqual({ two: { command: "node" } });
        const again = await run(["remove", "one"], cwd, userDir);
        expect(again.exitCode).toBe(1);
        expect(again.stderr).toContain('no server named "one"');
    });

    test("same name in BOTH scopes requires --scope to disambiguate", async () => {
        const { cwd, userDir } = dirs();
        await run(["add", "shared", "node"], cwd, userDir);
        await run(["add", "shared", "--scope", "project", "node"], cwd, userDir);
        const ambiguous = await run(["remove", "shared"], cwd, userDir);
        expect(ambiguous.exitCode).toBe(1);
        expect(ambiguous.stderr).toContain("BOTH scopes");
        expect(ambiguous.stderr).toContain("--scope");
        const scoped = await run(["remove", "shared", "--scope", "user"], cwd, userDir);
        expect(scoped.exitCode).toBe(0);
        expect(readJson(userFileOf(userDir)).mcpServers).toEqual({});
        expect(readJson(projectFileOf(cwd)).mcpServers.shared).toEqual({ command: "node" });
    });
});

// ---------------------------------------------------------------------------
// 6. list / get
// ---------------------------------------------------------------------------

describe("unown mcp list / get", () => {
    test("list renders both scopes with type, target and the project trust state", async () => {
        const { cwd, userDir } = dirs();
        await run(["add", "alpha", "node", MOCK_SERVER, "--flag"], cwd, userDir);
        await run(["add-http", "beta", "--scope", "project", "https://example.com/mcp"], cwd, userDir);
        // A second, hand-written untrusted project entry (the whole file is
        // re-gated by the hand-edit → every project row shows the annotation).
        const projectCfg = readJson(projectFileOf(cwd));
        projectCfg.mcpServers.gamma = { command: "runme" };
        writeFileSync(projectFileOf(cwd), JSON.stringify(projectCfg, null, 2));

        const r = await run(["list"], cwd, userDir);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("MCP servers (3)");
        expect(r.stdout).toContain("alpha");
        expect(r.stdout).toContain("user");
        expect(r.stdout).toContain("stdio");
        expect(r.stdout).toContain(`node ${MOCK_SERVER} --flag`);
        expect(r.stdout).toContain("beta");
        expect(r.stdout).toContain("project");
        expect(r.stdout).toContain("http");
        expect(r.stdout).toContain("https://example.com/mcp");
        expect(r.stdout).toContain("untrusted — /mcp trust");
    });

    test("list with no servers prints the add hint; garbage files surface as problems", async () => {
        const { cwd, userDir } = dirs();
        const empty = await run(["list"], cwd, userDir);
        expect(empty.exitCode).toBe(0);
        expect(empty.stdout).toContain("no MCP servers configured");
        writeFileSync(userFileOf(userDir), "{");
        const broken = await run(["list"], cwd, userDir);
        expect(broken.exitCode).toBe(0); // problems are warnings here — doctor owns the health verdict
        expect(broken.stderr).toContain("invalid JSON");
    });

    test("get prints the stored entry JSON + which file it comes from (project wins)", async () => {
        const { cwd, userDir } = dirs();
        await run(["add", "entry", "node", MOCK_SERVER], cwd, userDir);
        await run(["add", "entry", "--scope", "project", "echo"], cwd, userDir);
        const r = await run(["get", "entry"], cwd, userDir);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain(projectFileOf(cwd)); // effective entry = project's
        expect(r.stdout).toContain('"command": "echo"');
        const userOnly = await run(["get", "entry", "--scope", "user"], cwd, userDir);
        expect(userOnly.exitCode).toBe(1); // get takes one server name — no --scope flag
        expect(userOnly.stderr).toContain("usage: unown mcp");
        const missing = await run(["get", "nope"], cwd, userDir);
        expect(missing.exitCode).toBe(1);
        expect(missing.stderr).toContain('no server named "nope"');
        expect(missing.stderr).toContain("entry"); // …but the configured-names hint lists it
    });
});

// ---------------------------------------------------------------------------
// 7. test — live probe
// ---------------------------------------------------------------------------

describe("unown mcp test (live probe)", () => {
    test(
        "connected probe against the mock stdio server reports the tool count",
        async () => {
            const { cwd, userDir } = dirs();
            await run(["add", "mock", "node", MOCK_SERVER], cwd, userDir);
            const r = await run(["test", "mock"], cwd, userDir);
            expect(r.exitCode).toBe(0);
            expect(r.stdout).toContain("✓ mock: connected — 3 tool(s)");
            expect(r.stdout).toContain("stdio");
        },
        30_000,
    );

    test(
        "a dead binary reports the failure (never throws), missing names error out",
        async () => {
            const { cwd, userDir } = dirs();
            await run(["add", "gone", "definitely-not-a-real-mcp-binary"], cwd, userDir);
            const dead = await run(["test", "gone"], cwd, userDir);
            expect(dead.exitCode).toBe(1);
            expect(dead.stderr).toContain("✗ gone:");

            const missing = await run(["test", "nope"], cwd, userDir);
            expect(missing.exitCode).toBe(1);
            expect(missing.stderr).toContain('no server named "nope"');
        },
        30_000,
    );

    test("a gated (untrusted) project server is refused, not spawned", async () => {
        const { cwd, userDir } = dirs();
        mkdirSync(join(cwd, ".unown"), { recursive: true });
        writeFileSync(projectFileOf(cwd), JSON.stringify({ mcpServers: { gated: { command: "node", args: [MOCK_SERVER] } } }));
        const r = await run(["test", "gated"], cwd, userDir);
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain("untrusted");
        expect(r.stderr).toContain("/mcp trust");
    });
});

// ---------------------------------------------------------------------------
// 8. Surface: usage, name validation, help
// ---------------------------------------------------------------------------

describe("unown mcp surface", () => {
    test("no subcommand → usage error; unknown subcommand → usage error", async () => {
        const { cwd, userDir } = dirs();
        const none = await run([], cwd, userDir);
        expect(none.exitCode).toBe(1);
        expect(none.stderr).toContain("usage: unown mcp");
        const unknown = await run(["bogus"], cwd, userDir);
        expect(unknown.exitCode).toBe(1);
        expect(unknown.stderr).toContain('unknown subcommand "bogus"');
    });

    test("--help prints the grammar without touching any file", async () => {
        const { cwd, userDir } = dirs();
        const r = await run(["--help"], cwd, userDir);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("usage:");
        expect(r.stdout).toContain("add-http");
        const sub = await run(["add", "--help"], cwd, userDir);
        expect(sub.exitCode).toBe(0);
        expect(existsSync(userFileOf(userDir))).toBe(false);
    });

    test("server names must match ^[a-z0-9_-]{1,64}$", async () => {
        const { cwd, userDir } = dirs();
        for (const bad of ["Bad Name", "Ünicode", "with/slash"]) {
            const r = await run(["add", bad, "node"], cwd, userDir);
            expect(r.exitCode).toBe(1);
            expect(r.stderr).toContain("server name must match");
        }
        const empty = await run(["add", "", "node"], cwd, userDir); // missing positional → usage error
        expect(empty.exitCode).toBe(1);
        expect(empty.stderr).toContain("add needs");
        const ok = await run(["add", "my-server_2", "node"], cwd, userDir);
        expect(ok.exitCode).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Round-trip through mcp.ts's loader (the file the CLI writes is the file
// sessions read — no dialect drift between writer and reader).
// ---------------------------------------------------------------------------

describe("writer/reader dialect identity", () => {
    test("a CLI-written user file loads through loadMcpConfigFile with zero problems", async () => {
        const { cwd, userDir } = dirs();
        await run(["add", "srv", "node", MOCK_SERVER, "--flag"], cwd, userDir);
        await run(["add-http", "web", "https://example.com/mcp"], cwd, userDir);
        const { config, problems } = loadMcpConfigFile(userFileOf(userDir), cleanEnv());
        expect(problems).toEqual([]);
        expect(config?.servers.srv).toEqual({ command: "node", args: [MOCK_SERVER, "--flag"] });
        expect(config?.servers.web).toEqual({ url: "https://example.com/mcp" });
    });
});
