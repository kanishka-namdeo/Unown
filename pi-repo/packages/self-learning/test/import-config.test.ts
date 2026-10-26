// import-config.test.ts — `unown import` (the 2026-10-24 parity round):
// one-command config migration from the other agents (src/import-config.ts).
//
// Coverage contract: per-source discovery (claude-code instructions/commands/
// skills/agents/mcp incl. ~/.claude.json; codex AGENTS.md/prompts/config.toml
// MCP tables; gemini GEMINI.md/TOML-command conversion/settings.json mcp;
// cursor .mdc rules → instruction sections; opencode command/agent), the
// codex TOML parser, the gemini TOML→markdown conversion, mcp normalization
// (gemini httpUrl → url), executeImport's never-overwrite contract, the
// AGENTS.md marked-section append + idempotence, mcp merging with unown
// winning, dry-run writing nothing, and the CLI wrapper (--list, --dry-run,
// unknown source/lane exit 1).
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runImportCommand } from "../src/import-cli.ts";

import {
	convertGeminiCommandToml,
	detectAvailableSources,
	executeImport,
	normalizeMcpServer,
	parseCodexMcpServers,
	planImport,
} from "../src/import-config.ts";
import { TEST_TMP } from "./_env.ts";

const TMP = mkdtempSync(join(TEST_TMP, "import-config-"));
beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(() => {
	try {
		rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* best effort */
	}
});

function makeHome(name: string): { home: string; proj: string } {
	const base = join(TMP, name);
	const home = join(base, "home");
	const proj = join(base, "proj");
	mkdirSync(join(home, ".claude"), { recursive: true });
	mkdirSync(proj, { recursive: true });
	return { home, proj };
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

describe("parseCodexMcpServers", () => {
	test("stdio tables with args + env; non-mcp tables and empty commands dropped", () => {
		const toml = `
# a comment
[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
env = { GITHUB_TOKEN = "ghp_x" }

[mcp_servers.broken]
args = ["x"]

[profiles.fast]
model = "gpt-5"

[mcp_servers.filesystem]
command = 'npx'
args = ['-y', 'server-fs']
`;
		const servers = parseCodexMcpServers(toml);
		expect(Object.keys(servers).sort()).toEqual(["filesystem", "github"]);
		expect(servers.github).toEqual({
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-github"],
			env: { GITHUB_TOKEN: "ghp_x" },
		});
		expect(servers.filesystem.command).toBe("npx");
		expect(servers.filesystem.args).toEqual(["-y", "server-fs"]);
	});
});

describe("convertGeminiCommandToml", () => {
	test("description + prompt; {{args}} → $ARGUMENTS; multiline prompts", () => {
		const simple = convertGeminiCommandToml(`description = "Explain a file"\nprompt = "Explain {{args}} in depth"`);
		expect(simple).toContain("description: Explain a file");
		expect(simple).toContain("Explain $ARGUMENTS in depth");
		const multi = convertGeminiCommandToml(`description = "Big"\nprompt = """line one\nline two {{args}}"""`);
		expect(multi).toContain("line one\nline two $ARGUMENTS");
		expect(convertGeminiCommandToml(`description = "no prompt"`)).toBeNull();
	});

	// Pins the js/identity-replacement fix: Gemini's TOML contract defines
	// only {{args}} — a literal $1 in a prompt is the user's text and must
	// survive the conversion verbatim (the old `.replaceAll("$1", "$1")`
	// was an identity no-op and is now simply gone).
	test("a literal $1 in the prompt survives conversion untouched", () => {
		const out = convertGeminiCommandToml('description = "Refs"\nprompt = "expand $1 placeholders"');
		expect(out).toContain("expand $1 placeholders");
	});
});

describe("normalizeMcpServer", () => {
	test("gemini httpUrl → url; stdio passes command/args/env; unknown shapes verbatim", () => {
		expect(normalizeMcpServer({ httpUrl: "https://x.test/mcp", headers: { a: "b" } })).toEqual({
			url: "https://x.test/mcp",
			headers: { a: "b" },
		});
		expect(normalizeMcpServer({ command: "npx", args: ["x"], env: { K: "V" }, junk: true })).toEqual({
			command: "npx",
			args: ["x"],
			env: { K: "V" },
		});
		const weird = { something: "else" };
		expect(normalizeMcpServer(weird)).toBe(weird);
	});
});

// ---------------------------------------------------------------------------
// Discovery + execute: claude-code (the richest lane)
// ---------------------------------------------------------------------------

describe("import: claude-code", () => {
	test("discovers + lands every lane; never overwrites; idempotent instructions", () => {
		const { home, proj } = makeHome("cc1");
		const claude = join(home, ".claude");
		mkdirSync(join(claude, "commands"), { recursive: true });
		mkdirSync(join(claude, "skills", "pdf"), { recursive: true });
		mkdirSync(join(claude, "agents"), { recursive: true });
		writeFileSync(join(claude, "CLAUDE.md"), "# Claude rules\nAlways use bun.\n");
		writeFileSync(join(claude, "commands", "review.md"), "---\ndescription: review\n---\nReview $ARGUMENTS\n");
		writeFileSync(
			join(claude, "skills", "pdf", "SKILL.md"),
			"---\nname: pdf\ndescription: PDF work\n---\nDo PDF things.\n",
		);
		writeFileSync(join(claude, "agents", "triage.md"), "---\nname: triage\ndescription: triage\n---\nTriage it.\n");
		writeFileSync(
			join(home, ".claude.json"),
			JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "gh"] } } }),
		);

		const plan = planImport("claude-code", { projectDir: proj, homeDir: home });
		expect(plan.artifacts.filter((a) => a.lane === "instructions")).toHaveLength(1);
		expect(plan.artifacts.filter((a) => a.lane === "commands")).toHaveLength(1);
		expect(plan.artifacts.filter((a) => a.lane === "skills")).toHaveLength(1);
		expect(plan.artifacts.filter((a) => a.lane === "agents")).toHaveLength(1);
		expect(plan.artifacts.filter((a) => a.lane === "mcp")).toHaveLength(1);

		const result = executeImport(plan, { projectDir: proj, homeDir: home });
		expect(result.done).toHaveLength(5);
		// files landed
		expect(existsSync(join(proj, ".unown", "commands", "review.md"))).toBeTrue();
		expect(existsSync(join(proj, ".unown", "skills", "pdf", "SKILL.md"))).toBeTrue();
		expect(existsSync(join(proj, ".unown", "agents", "triage.md"))).toBeTrue();
		// AGENTS.md: created with the marked section
		const agents = readFileSync(join(proj, "AGENTS.md"), "utf8");
		expect(agents).toContain("imported from claude-code");
		expect(agents).toContain("Always use bun.");
		// mcp.json: server landed + normalized
		const mcp = JSON.parse(readFileSync(join(proj, ".unown", "mcp.json"), "utf8"));
		expect(mcp.mcpServers.github).toEqual({ command: "npx", args: ["-y", "gh"] });
		expect(result.notes.some((n) => n.includes("/mcp trust"))).toBeTrue();

		// Re-run: everything skipped (idempotent, never overwritten).
		const plan2 = planImport("claude-code", { projectDir: proj, homeDir: home });
		const result2 = executeImport(plan2, { projectDir: proj, homeDir: home });
		expect(result2.done).toHaveLength(0);
		expect(result2.skipped.length).toBeGreaterThanOrEqual(4);
		const agents2 = readFileSync(join(proj, "AGENTS.md"), "utf8");
		expect(agents2).toBe(agents); // untouched on re-run
	});

	test("project-scope .claude + .mcp.json are picked up too", () => {
		const { home, proj } = makeHome("cc2");
		mkdirSync(join(proj, ".claude", "commands"), { recursive: true });
		writeFileSync(join(proj, "CLAUDE.md"), "project rules\n");
		writeFileSync(join(proj, ".claude", "commands", "ship.md"), "ship it\n");
		writeFileSync(join(proj, ".mcp.json"), JSON.stringify({ mcpServers: { fs: { command: "npxfs" } } }));

		const plan = planImport("claude-code", { projectDir: proj, homeDir: home });
		expect(plan.artifacts.filter((a) => a.lane === "instructions")).toHaveLength(1);
		expect(plan.artifacts.filter((a) => a.lane === "commands")).toHaveLength(1);
		expect(plan.artifacts.filter((a) => a.lane === "mcp")).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Codex / Gemini / Cursor / OpenCode
// ---------------------------------------------------------------------------

describe("import: codex", () => {
	test("AGENTS.md + prompts + config.toml mcp_servers", () => {
		const { home, proj } = makeHome("codex1");
		const codex = join(home, ".codex");
		mkdirSync(join(codex, "prompts"), { recursive: true });
		writeFileSync(join(codex, "AGENTS.md"), "codex rules\n");
		writeFileSync(join(codex, "prompts", "fix.md"), "fix the thing\n");
		writeFileSync(join(codex, "config.toml"), '[mcp_servers.github]\ncommand = "npx"\nargs = ["-y", "gh"]\n');
		const plan = planImport("codex", { projectDir: proj, homeDir: home });
		expect(plan.artifacts.filter((a) => a.lane === "instructions")).toHaveLength(1);
		expect(plan.artifacts.filter((a) => a.lane === "commands")).toHaveLength(1);
		expect(plan.artifacts.filter((a) => a.lane === "mcp")).toHaveLength(1);
		const result = executeImport(plan, { projectDir: proj, homeDir: home });
		expect(result.done).toHaveLength(3);
		expect(existsSync(join(proj, ".unown", "commands", "fix.md"))).toBeTrue();
	});
});

describe("import: gemini", () => {
	test("GEMINI.md + TOML command conversion + settings.json mcp (httpUrl)", () => {
		const { home, proj } = makeHome("gem1");
		const gemini = join(home, ".gemini");
		mkdirSync(join(gemini, "commands"), { recursive: true });
		writeFileSync(join(gemini, "GEMINI.md"), "gemini rules\n");
		writeFileSync(join(gemini, "commands", "explain.toml"), 'description = "Explain"\nprompt = "Explain {{args}}"\n');
		writeFileSync(
			join(gemini, "settings.json"),
			JSON.stringify({ mcpServers: { remote: { httpUrl: "https://mcp.test/sse" } } }),
		);

		const plan = planImport("gemini", { projectDir: proj, homeDir: home });
		expect(plan.artifacts.filter((a) => a.lane === "instructions")).toHaveLength(1);
		expect(plan.artifacts.filter((a) => a.lane === "commands")).toHaveLength(1);
		expect(plan.artifacts.filter((a) => a.lane === "mcp")).toHaveLength(1);
		const result = executeImport(plan, { projectDir: proj, homeDir: home });
		expect(result.done).toHaveLength(3);
		const converted = readFileSync(join(proj, ".unown", "commands", "explain.md"), "utf8");
		expect(converted).toContain("Explain $ARGUMENTS");
		const mcp = JSON.parse(readFileSync(join(proj, ".unown", "mcp.json"), "utf8"));
		expect(mcp.mcpServers.remote).toEqual({ url: "https://mcp.test/sse" });
	});
});

describe("import: cursor", () => {
	test(".cursor rules concatenate as instruction sections (globs noted)", () => {
		const { home, proj } = makeHome("cur1");
		mkdirSync(join(proj, ".cursor", "rules"), { recursive: true });
		writeFileSync(
			join(proj, ".cursor", "rules", "python.mdc"),
			"---\ndescription: python rules\nglobs: **/*.py\n---\nUse ruff for Python.\n",
		);
		const plan = planImport("cursor", { projectDir: proj, homeDir: home });
		expect(plan.artifacts).toHaveLength(1);
		expect(plan.artifacts[0].lane).toBe("instructions");
		const result = executeImport(plan, { projectDir: proj, homeDir: home });
		expect(result.done).toHaveLength(1);
		const agents = readFileSync(join(proj, "AGENTS.md"), "utf8");
		expect(agents).toContain("Rule: python");
		expect(agents).toContain("(applies to: **/*.py)");
		expect(agents).toContain("Use ruff for Python.");
	});
});

describe("import: opencode", () => {
	test("user AGENTS.md + command/agent markdown; project AGENTS.md noted, not imported", () => {
		const { home, proj } = makeHome("oc1");
		const oc = join(home, ".config", "opencode");
		mkdirSync(join(oc, "command"), { recursive: true });
		mkdirSync(join(oc, "agent"), { recursive: true });
		writeFileSync(join(oc, "AGENTS.md"), "user global rules\n");
		writeFileSync(join(oc, "command", "commit.md"), "commit well\n");
		writeFileSync(join(oc, "agent", "build.md"), "---\nname: build\ndescription: b\n---\nbuild it\n");
		writeFileSync(join(proj, "AGENTS.md"), "the project's own AGENTS.md\n"); // NOT an import source

		const plan = planImport("opencode", { projectDir: proj, homeDir: home });
		expect(plan.artifacts.filter((a) => a.lane === "instructions")).toHaveLength(1); // user only
		expect(plan.artifacts.filter((a) => a.lane === "commands")).toHaveLength(1);
		expect(plan.artifacts.filter((a) => a.lane === "agents")).toHaveLength(1);
		expect(plan.notes.some((n) => n.includes("already unown's instruction file"))).toBeTrue();
		const result = executeImport(plan, { projectDir: proj, homeDir: home });
		expect(result.done).toHaveLength(3);
		// The project's own AGENTS.md content is preserved, import appended.
		const agents = readFileSync(join(proj, "AGENTS.md"), "utf8");
		expect(agents.startsWith("the project's own AGENTS.md")).toBeTrue();
		expect(agents).toContain("user global rules");
	});
});

// ---------------------------------------------------------------------------
// Cross-cutting execute contract
// ---------------------------------------------------------------------------

describe("executeImport contract", () => {
	test("existing mcp server wins (import never replaces an explicit unown config)", () => {
		const { home, proj } = makeHome("mcp1");
		mkdirSync(join(proj, ".unown"), { recursive: true });
		writeFileSync(
			join(proj, ".unown", "mcp.json"),
			JSON.stringify({ mcpServers: { github: { command: "MY-own" } } }),
		);
		writeFileSync(
			join(home, ".claude.json"),
			JSON.stringify({ mcpServers: { github: { command: "npx-theirs" }, fresh: { command: "npx-new" } } }),
		);
		const plan = planImport("claude-code", { projectDir: proj, homeDir: home });
		const result = executeImport(plan, { projectDir: proj, homeDir: home });
		const mcp = JSON.parse(readFileSync(join(proj, ".unown", "mcp.json"), "utf8"));
		expect(mcp.mcpServers.github).toEqual({ command: "MY-own" }); // unown wins
		expect(mcp.mcpServers.fresh).toEqual({ command: "npx-new" }); // new one added
		expect(result.skipped.some((s) => s.reason.includes("already configured"))).toBeTrue();
	});

	test("dry-run writes nothing", () => {
		const { home, proj } = makeHome("dry1");
		const claude = join(home, ".claude");
		mkdirSync(join(claude, "commands"), { recursive: true });
		writeFileSync(join(claude, "commands", "a.md"), "a\n");
		const plan = planImport("claude-code", { projectDir: proj, homeDir: home });
		const result = executeImport(plan, { projectDir: proj, homeDir: home, dryRun: true });
		expect(result.done.length).toBeGreaterThan(0);
		expect(existsSync(join(proj, ".unown", "commands", "a.md"))).toBeFalse();
		expect(existsSync(join(proj, "AGENTS.md"))).toBeFalse();
	});

	test("lane restriction: --lane mcp only imports servers", () => {
		const { home, proj } = makeHome("lane1");
		const claude = join(home, ".claude");
		mkdirSync(join(claude, "commands"), { recursive: true });
		writeFileSync(join(claude, "CLAUDE.md"), "rules\n");
		writeFileSync(join(claude, "commands", "a.md"), "a\n");
		const plan = planImport("claude-code", { projectDir: proj, homeDir: home, lanes: ["mcp"] });
		expect(plan.artifacts).toHaveLength(0); // no mcp configured in this fixture
		const planCmds = planImport("claude-code", { projectDir: proj, homeDir: home, lanes: ["commands"] });
		expect(planCmds.artifacts).toHaveLength(1);
		expect(planCmds.artifacts[0].lane).toBe("commands");
	});
});

// ---------------------------------------------------------------------------
// CLI wrapper
// ---------------------------------------------------------------------------

describe("runImportCommand", () => {
	test("--list surveys sources; unknown source/lane exit 1; --dry-run writes nothing", async () => {
		const { home, proj } = makeHome("cli1");
		const claude = join(home, ".claude");
		mkdirSync(join(claude, "commands"), { recursive: true });
		writeFileSync(join(claude, "commands", "hello.md"), "hello\n");
		const prevCwd = process.cwd();
		// os.homedir() is process-start-cached in bun, so the CLI takes an
		// explicit --home (the backup/migration support flag) — the test path.
		const homeArgs = ["--home", home];
		process.chdir(proj);
		try {
			const list = await runImportCommand(["--list", ...homeArgs]);
			expect(list).toBe(0);
			const badSource = await runImportCommand(["--from", "warp"]);
			expect(badSource).toBe(1);
			const badLane = await runImportCommand(["--lane", "nope"]);
			expect(badLane).toBe(1);
			const dry = await runImportCommand(["--from", "claude-code", "--dry-run", ...homeArgs]);
			expect(dry).toBe(0);
			expect(existsSync(join(proj, ".unown", "commands", "hello.md"))).toBeFalse();
			const real = await runImportCommand(["--from", "claude-code", ...homeArgs]);
			expect(real).toBe(0);
			expect(existsSync(join(proj, ".unown", "commands", "hello.md"))).toBeTrue();
		} finally {
			process.chdir(prevCwd);
		}
	});

	test("detectAvailableSources counts artifacts per source", () => {
		const { home, proj } = makeHome("det1");
		mkdirSync(join(home, ".claude", "commands"), { recursive: true });
		writeFileSync(join(home, ".claude", "commands", "x.md"), "x\n");
		const available = detectAvailableSources({ projectDir: proj, homeDir: home });
		const cc = available.find((a) => a.source === "claude-code")!;
		expect(cc.count).toBe(1);
		const gem = available.find((a) => a.source === "gemini")!;
		expect(gem.count).toBe(0);
	});
});
