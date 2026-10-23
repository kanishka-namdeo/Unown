/**
 * subagent-routing.test.ts — Milestone 2.1 + 2.2 unit tests for the pure
 * routing helpers in src/subagent-routing.ts.
 *
 * The 12 spec cases:
 *   1.  SubagentConfig accepts model + effort + mcpServers + injectAgentsMd
 *   2.  Frontmatter parser extracts these fields from markdown frontmatter
 *   3.  BUILTIN_AGENTS includes the new background-explore agent with the
 *       right config
 *   4.  runSubagentOnce passes --model and --effort args when agent has them
 *   5.  runSubagentOnce passes --mcp-servers when agent.mcpServers is set
 *   6.  runSubagentOnce passes --no-agents-md when agent.injectAgentsMd is false
 *   7.  UNOWN_SUBAGENT_MODEL env var overrides default model
 *   8.  parseArgs parses --model and --effort flags correctly
 *   9.  parseArgs parses --mcp-servers flag
 *   10. parseArgs parses --no-agents-md flag (boolean, no value)
 *   11. Effort mapping: low → BRIDGE_QWEN_THINKING=0; high → BRIDGE_QWEN_THINKING=1
 *   12. When no model/effort/mcpServers set, the args array is unchanged
 *       (backward compat)
 *
 * Hermeticity: this file imports ONLY from `../src/subagent-routing.ts` —
 * no pi modules, no fs, no network. The pure helpers are exercised directly;
 * the args-array builder (buildSubagentArgs) is the extracted form of the
 * args-construction logic that runSubagentOnce (in tools.ts) now calls.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
        applyEffortToEnv,
        BACKGROUND_EXPLORE_AGENT,
        buildSubagentArgs,
        parseAgentFrontmatterExtras,
        parseSubagentFlags,
        resolveSubagentModel,
        SUBAGENT_MCP_SERVERS_ENV,
        SUBAGENT_MODEL_ENV,
        SUBAGENT_NO_AGENTS_MD_ENV,
        SUBAGENT_QWEN_THINKING_ENV,
        type SubagentEffort,
        type SubagentRoutingFields,
} from "../src/subagent-routing.ts";

/**
 * Capture the relevant env vars BEFORE each test so we can restore them
 * AFTER — the helpers read process.env lazily, and a parallel suite (or a
 * developer's shell) may have UNOWN_SUBAGENT_MODEL set. Each test sets its
 * own values; the restore guarantees no cross-test pollution.
 */
const ENV_KEYS = [SUBAGENT_MODEL_ENV, SUBAGENT_MCP_SERVERS_ENV, SUBAGENT_NO_AGENTS_MD_ENV, SUBAGENT_QWEN_THINKING_ENV];
const envSnapshots: Record<string, string | undefined> = {};

beforeEach(() => {
        for (const k of ENV_KEYS) envSnapshots[k] = process.env[k];
});

afterEach(() => {
        for (const k of ENV_KEYS) {
                if (envSnapshots[k] === undefined) delete process.env[k];
                else process.env[k] = envSnapshots[k];
        }
});

// ---------------------------------------------------------------------------
// 1. SubagentConfig accepts the new fields (the type contract)
// ---------------------------------------------------------------------------

describe("SubagentConfig / SubagentRoutingFields", () => {
        test("accepts model + effort + mcpServers + injectAgentsMd (the type contract)", () => {
                // This is a compile-time + runtime check. tools.ts's SubagentConfig
                // extends SubagentRoutingFields; the object literal below satisfies
                // the routing-fields shape (and the canonical SubagentConfig shape
                // when name/description/tools/systemPrompt/source are added).
                const agent: { name: string; description: string; tools?: string[]; systemPrompt: string; source: "built-in" } & SubagentRoutingFields = {
                        name: "routed",
                        description: "routed subagent",
                        tools: ["read"],
                        systemPrompt: "you are routed",
                        source: "built-in",
                        model: "kimi-k2.5",
                        effort: "low",
                        mcpServers: ["server-a", "server-b"],
                        injectAgentsMd: false,
                };
                expect(agent.model).toBe("kimi-k2.5");
                expect(agent.effort).toBe("low");
                expect(agent.mcpServers).toEqual(["server-a", "server-b"]);
                expect(agent.injectAgentsMd).toBe(false);
        });

        test("all four routing fields are optional (the no-routing agent)", () => {
                // Backward compatibility: an agent with none of the new fields still
                // satisfies the type (and the args array is unchanged — see case 12).
                const agent: { name: string; description: string; systemPrompt: string; source: "built-in" } & SubagentRoutingFields = {
                        name: "general",
                        description: "general",
                        systemPrompt: "you are general",
                        source: "built-in",
                };
                expect(agent.model).toBeUndefined();
                expect(agent.effort).toBeUndefined();
                expect(agent.mcpServers).toBeUndefined();
                expect(agent.injectAgentsMd).toBeUndefined();
        });
});

// ---------------------------------------------------------------------------
// 2. Frontmatter parser extracts the new fields from a parsed frontmatter
// ---------------------------------------------------------------------------

describe("parseAgentFrontmatterExtras", () => {
        test("extracts all four fields (camelCase)", () => {
                // pi's parseFrontmatter returns the parsed JS object; this helper
                // plucks + validates the four new keys.
                const extras = parseAgentFrontmatterExtras({
                        name: "routed",
                        description: "routed subagent",
                        tools: "read,grep",
                        model: "kimi-k2.5",
                        effort: "low",
                        mcpServers: "server-a,server-b",
                        injectAgentsMd: false,
                });
                expect(extras).toEqual({
                        model: "kimi-k2.5",
                        effort: "low",
                        mcpServers: ["server-a", "server-b"],
                        injectAgentsMd: false,
                });
        });

        test("accepts snake_case aliases (zcode parity)", () => {
                const extras = parseAgentFrontmatterExtras({
                        mcp_servers: "server-a,server-b",
                        inject_agents_md: true,
                });
                expect(extras.mcpServers).toEqual(["server-a", "server-b"]);
                expect(extras.injectAgentsMd).toBe(true);
        });

        test("accepts mcpServers as an array", () => {
                const extras = parseAgentFrontmatterExtras({
                        mcpServers: ["server-a", "server-b"],
                });
                expect(extras.mcpServers).toEqual(["server-a", "server-b"]);
        });

        test("accepts injectAgentsMd as a string ('true'/'1' → true; 'false'/'0' → false)", () => {
                expect(parseAgentFrontmatterExtras({ injectAgentsMd: "true" }).injectAgentsMd).toBe(true);
                expect(parseAgentFrontmatterExtras({ injectAgentsMd: "1" }).injectAgentsMd).toBe(true);
                expect(parseAgentFrontmatterExtras({ injectAgentsMd: "false" }).injectAgentsMd).toBe(false);
                expect(parseAgentFrontmatterExtras({ injectAgentsMd: "0" }).injectAgentsMd).toBe(false);
        });

        test("drops invalid effort values silently (tolerant posture)", () => {
                const extras = parseAgentFrontmatterExtras({ effort: "extreme" });
                expect(extras.effort).toBeUndefined();
        });

        test("case-insensitive effort ('LOW' → 'low')", () => {
                expect(parseAgentFrontmatterExtras({ effort: "LOW" }).effort).toBe("low");
                expect(parseAgentFrontmatterExtras({ effort: "Medium" }).effort).toBe("medium");
                expect(parseAgentFrontmatterExtras({ effort: "HIGH" }).effort).toBe("high");
        });

        test("returns {} on null/undefined/non-object input", () => {
                expect(parseAgentFrontmatterExtras(null)).toEqual({});
                expect(parseAgentFrontmatterExtras(undefined)).toEqual({});
                expect(parseAgentFrontmatterExtras("string")).toEqual({});
                expect(parseAgentFrontmatterExtras([])).toEqual({});
        });

        test("omits mcpServers when the list parses empty (matches parseToolList)", () => {
                // An empty array IS the signal for "load none"; that lives on the
                // agent field, not the frontmatter — a missing/empty mcpServers in
                // frontmatter means "no whitelist declared", so undefined (load all).
                expect(parseAgentFrontmatterExtras({ mcpServers: "" })).toEqual({});
                expect(parseAgentFrontmatterExtras({ mcpServers: [] })).toEqual({});
        });
});

// ---------------------------------------------------------------------------
// 3. BUILTIN_AGENTS includes the new background-explore agent
// ---------------------------------------------------------------------------

describe("BACKGROUND_EXPLORE_AGENT (the new built-in)", () => {
        test("has the canonical built-in agent shape", () => {
                expect(BACKGROUND_EXPLORE_AGENT.name).toBe("background-explore");
                expect(typeof BACKGROUND_EXPLORE_AGENT.description).toBe("string");
                expect(BACKGROUND_EXPLORE_AGENT.description.length).toBeGreaterThan(20);
                expect(BACKGROUND_EXPLORE_AGENT.source).toBe("built-in");
                expect(typeof BACKGROUND_EXPLORE_AGENT.systemPrompt).toBe("string");
                expect(BACKGROUND_EXPLORE_AGENT.systemPrompt.length).toBeGreaterThan(20);
        });

        test("is read-only (read/grep/find/ls)", () => {
                expect(BACKGROUND_EXPLORE_AGENT.tools).toEqual(["read", "grep", "find", "ls"]);
        });

        test("carries no model override (resolves the session default — the qwen hardcode only existed via bridge routing)", () => {
                expect(BACKGROUND_EXPLORE_AGENT.model).toBeUndefined();
        });

        test("uses low reasoning effort", () => {
                expect(BACKGROUND_EXPLORE_AGENT.effort).toBe("low");
        });

        test("loads NO MCP servers (empty whitelist)", () => {
                expect(Array.isArray(BACKGROUND_EXPLORE_AGENT.mcpServers)).toBe(true);
                expect(BACKGROUND_EXPLORE_AGENT.mcpServers).toEqual([]);
        });

        test("disables AGENTS.md injection (minimal-overhead)", () => {
                expect(BACKGROUND_EXPLORE_AGENT.injectAgentsMd).toBe(false);
        });

        test("satisfies the SubagentConfig shape (no missing required fields)", () => {
                // Type-level check: if this compiles, BACKGROUND_EXPLORE_AGENT
                // satisfies the agent shape that tools.ts's BUILTIN_AGENTS expects.
                const asConfig: { name: string; description: string; tools: string[]; systemPrompt: string; source: "built-in" } & SubagentRoutingFields =
                        BACKGROUND_EXPLORE_AGENT;
                expect(asConfig.name).toBe("background-explore");
        });
});

// ---------------------------------------------------------------------------
// 4-6, 12. buildSubagentArgs (extracted from runSubagentOnce)
// ---------------------------------------------------------------------------

describe("buildSubagentArgs", () => {
        test("case 12: no routing fields → unchanged args (backward compat)", () => {
                // The legacy shape: --mode json -p --no-session (+ optional --tools).
                // buildSubagentArgs only consumes {name, tools?, + routing fields};
                // other SubagentConfig fields (description, systemPrompt, source)
                // are passed through in real usage but not used by the builder.
                const args = buildSubagentArgs({
                        name: "general",
                });
                expect(args).toEqual(["--mode", "json", "-p", "--no-session"]);
        });

        test("case 12b: no routing fields but with tools → --tools appended", () => {
                const args = buildSubagentArgs({
                        name: "explore",
                        tools: ["read", "grep", "find", "ls"],
                });
                expect(args).toEqual(["--mode", "json", "-p", "--no-session", "--tools", "read,grep,find,ls"]);
        });

        test("case 4: agent.model + agent.effort → --model and --effort passed", () => {
                const args = buildSubagentArgs({
                        name: "routed",
                        model: "kimi-k2.5",
                        effort: "low",
                });
                expect(args).toEqual(["--mode", "json", "-p", "--no-session", "--model", "kimi-k2.5", "--effort", "low"]);
        });

        test("case 4b: all three effort levels produce valid --effort flags", () => {
                for (const effort of ["low", "medium", "high"] as SubagentEffort[]) {
                        const args = buildSubagentArgs({ name: "routed", effort });
                        expect(args).toContain("--effort");
                        expect(args[args.indexOf("--effort") + 1]).toBe(effort);
                }
        });

        test("case 5: agent.mcpServers set → --mcp-servers <csv> passed", () => {
                const args = buildSubagentArgs({
                        name: "routed",
                        mcpServers: ["server-a", "server-b"],
                });
                expect(args).toEqual([
                        "--mode",
                        "json",
                        "-p",
                        "--no-session",
                        "--mcp-servers",
                        "server-a,server-b",
                ]);
        });

        test("case 5b: empty mcpServers array → --mcp-servers with empty CSV (load none)", () => {
                // background-explore shape: empty whitelist = "load no MCP servers".
                const args = buildSubagentArgs({
                        name: "background-explore",
                        mcpServers: [],
                });
                expect(args).toEqual(["--mode", "json", "-p", "--no-session", "--mcp-servers", ""]);
        });

        test("case 6: agent.injectAgentsMd === false → --no-agents-md passed", () => {
                const args = buildSubagentArgs({
                        name: "background-explore",
                        injectAgentsMd: false,
                });
                expect(args).toContain("--no-agents-md");
        });

        test("case 6b: agent.injectAgentsMd === true → --no-agents-md NOT passed (default)", () => {
                const args = buildSubagentArgs({
                        name: "explicit-true",
                        injectAgentsMd: true,
                });
                expect(args).not.toContain("--no-agents-md");
        });

        test("case 6c: agent.injectAgentsMd undefined → --no-agents-md NOT passed (legacy)", () => {
                const args = buildSubagentArgs({ name: "legacy" });
                expect(args).not.toContain("--no-agents-md");
        });

        test("all four routing fields combine in order (model, effort, mcp-servers, no-agents-md)", () => {
                // The order matters for readability (NOT for the parser, which
                // treats them as a set). Pin it so future refactors don't drift.
                const args = buildSubagentArgs({
                        name: "all-four",
                        tools: ["read"],
                        model: "kimi-k2.5",
                        effort: "high",
                        mcpServers: ["srv-a"],
                        injectAgentsMd: false,
                });
                expect(args).toEqual([
                        "--mode",
                        "json",
                        "-p",
                        "--no-session",
                        "--tools",
                        "read",
                        "--model",
                        "kimi-k2.5",
                        "--effort",
                        "high",
                        "--mcp-servers",
                        "srv-a",
                        "--no-agents-md",
                ]);
        });
});

// ---------------------------------------------------------------------------
// 7. UNOWN_SUBAGENT_MODEL env var overrides default model
// ---------------------------------------------------------------------------

describe("resolveSubagentModel", () => {
        test("agent.model takes precedence over UNOWN_SUBAGENT_MODEL env var", () => {
                process.env[SUBAGENT_MODEL_ENV] = "qwen3.6-plus";
                const model = resolveSubagentModel({ model: "kimi-k2.5" });
                expect(model).toBe("kimi-k2.5");
        });

        test("UNOWN_SUBAGENT_MODEL env var overrides the default when agent.model is unset", () => {
                process.env[SUBAGENT_MODEL_ENV] = "qwen3.6-plus";
                const model = resolveSubagentModel({});
                expect(model).toBe("qwen3.6-plus");
        });

        test("returns undefined when both agent.model and env are unset (use the runtime default)", () => {
                delete process.env[SUBAGENT_MODEL_ENV];
                const model = resolveSubagentModel({});
                expect(model).toBeUndefined();
        });

        test("empty agent.model falls back to the env var (defensive against whitespace frontmatter)", () => {
                process.env[SUBAGENT_MODEL_ENV] = "qwen3.6-plus";
                const model = resolveSubagentModel({ model: "" });
                expect(model).toBe("qwen3.6-plus");
        });

        test("empty env var falls back to undefined (treat empty as unset)", () => {
                // term.ts:resolveUnownHome documents the same `||` vs `??` trap for
                // bun auto-loaded .env files; this matches that posture.
                process.env[SUBAGENT_MODEL_ENV] = "";
                const model = resolveSubagentModel({});
                expect(model).toBeUndefined();
        });

        test("explicit env param overrides process.env (test-injected env)", () => {
                // The third arg lets tests inject a clean env without mutating
                // process.env. Verifies the helper does NOT read process.env when
                // an explicit env is passed.
                process.env[SUBAGENT_MODEL_ENV] = "from-process-env";
                const model = resolveSubagentModel({}, { [SUBAGENT_MODEL_ENV]: "from-injected-env" });
                expect(model).toBe("from-injected-env");
        });
});

// ---------------------------------------------------------------------------
// 8-10. parseSubagentFlags (the parseArgs flag-parser helper)
// ---------------------------------------------------------------------------

describe("parseSubagentFlags", () => {
        test("case 8: parses --model and --effort flags correctly", () => {
                const result = parseSubagentFlags(["--model", "kimi-k2.5", "--effort", "low", "the", "prompt"]);
                expect(result.model).toBe("kimi-k2.5");
                expect(result.effort).toBe("low");
                // The prompt text is preserved in `rest` (in order).
                expect(result.rest).toEqual(["the", "prompt"]);
        });

        test("case 8b: invalid effort value is dropped (the flag is still consumed)", () => {
                const result = parseSubagentFlags(["--effort", "extreme", "prompt"]);
                expect(result.effort).toBeUndefined();
                // The invalid value is NOT treated as prompt text — the flag was consumed.
                expect(result.rest).toEqual(["prompt"]);
        });

        test("case 8c: effort value is case-insensitive", () => {
                expect(parseSubagentFlags(["--effort", "LOW"]).effort).toBe("low");
                expect(parseSubagentFlags(["--effort", "Medium"]).effort).toBe("medium");
                expect(parseSubagentFlags(["--effort", "HIGH"]).effort).toBe("high");
        });

        test("case 9: parses --mcp-servers flag (CSV)", () => {
                const result = parseSubagentFlags(["--mcp-servers", "server-a,server-b,server-c", "prompt"]);
                expect(result.mcpServers).toEqual(["server-a", "server-b", "server-c"]);
                expect(result.rest).toEqual(["prompt"]);
        });

        test("case 9b: empty CSV → empty array (signal for 'load none')", () => {
                // An empty CSV is meaningful: it means "load no MCP servers" (the
                // background-explore shape). parseSubagentFlags still parses it as
                // an empty array so applySubagentEnvOverrides sets UNOWN_MCP_SERVERS="".
                const result = parseSubagentFlags(["--mcp-servers", "", "prompt"]);
                expect(result.mcpServers).toEqual([]);
                expect(result.rest).toEqual(["prompt"]);
        });

        test("case 9c: --mcp-servers not present → mcpServers undefined (load all)", () => {
                const result = parseSubagentFlags(["prompt"]);
                expect(result.mcpServers).toBeUndefined();
        });

        test("case 10: parses --no-agents-md flag (boolean, no value)", () => {
                const result = parseSubagentFlags(["--no-agents-md", "prompt"]);
                expect(result.noAgentsMd).toBe(true);
                expect(result.rest).toEqual(["prompt"]);
        });

        test("case 10b: --no-agents-md absent → noAgentsMd undefined", () => {
                const result = parseSubagentFlags(["prompt"]);
                expect(result.noAgentsMd).toBeUndefined();
        });

        test("case 10c: --no-agents-md does NOT consume the next token (it's a boolean flag)", () => {
                // A common parser bug: a boolean flag consuming the next prompt word.
                // --no-agents-md is a switch, NOT a value flag.
                const result = parseSubagentFlags(["--no-agents-md", "do", "something"]);
                expect(result.noAgentsMd).toBe(true);
                expect(result.rest).toEqual(["do", "something"]);
        });

        test("rest preserves the original argv order (no flag re-ordering)", () => {
                const result = parseSubagentFlags(["alpha", "--model", "m", "beta", "--no-agents-md", "gamma"]);
                expect(result.rest).toEqual(["alpha", "beta", "gamma"]);
                expect(result.model).toBe("m");
                expect(result.noAgentsMd).toBe(true);
        });

        test("all four flags consumed together (full subagent routing invocation)", () => {
                const result = parseSubagentFlags([
                        "--mode",
                        "json",
                        "-p",
                        "--no-session",
                        "--tools",
                        "read",
                        "--model",
                        "kimi-k2.5",
                        "--effort",
                        "low",
                        "--mcp-servers",
                        "srv-a,srv-b",
                        "--no-agents-md",
                        "--append-system-prompt",
                        "/tmp/x.md",
                        "Task: do the thing",
                ]);
                expect(result.model).toBe("kimi-k2.5");
                expect(result.effort).toBe("low");
                expect(result.mcpServers).toEqual(["srv-a", "srv-b"]);
                expect(result.noAgentsMd).toBe(true);
                // Legacy flags + the prompt are preserved in `rest`.
                expect(result.rest).toEqual([
                        "--mode",
                        "json",
                        "-p",
                        "--no-session",
                        "--tools",
                        "read",
                        "--append-system-prompt",
                        "/tmp/x.md",
                        "Task: do the thing",
                ]);
        });

        test("a value starting with -- is NOT consumed (matches --tools / --append-system-prompt posture)", () => {
                // `--model --effort low` would be ambiguous; the parser treats the
                // `--effort` after `--model` as a missing-value, drops the --model,
                // and parses --effort normally. This matches the legacy `--tools`
                // posture in cli.ts:parseArgs.
                const result = parseSubagentFlags(["--model", "--effort", "low"]);
                expect(result.model).toBeUndefined();
                expect(result.effort).toBe("low");
        });
});

// ---------------------------------------------------------------------------
// 11. Effort → env-var mapping (the BRIDGE_QWEN_THINKING contract)
// ---------------------------------------------------------------------------

describe("applyEffortToEnv", () => {
        test("low → BRIDGE_QWEN_THINKING=0", () => {
                const env = applyEffortToEnv("low");
                expect(env[SUBAGENT_QWEN_THINKING_ENV]).toBe("0");
        });

        test("high → BRIDGE_QWEN_THINKING=1", () => {
                const env = applyEffortToEnv("high");
                expect(env[SUBAGENT_QWEN_THINKING_ENV]).toBe("1");
        });

        test("medium → empty record (leave the bridge default alone)", () => {
                const env = applyEffortToEnv("medium");
                expect(env).toEqual({});
                expect(env[SUBAGENT_QWEN_THINKING_ENV]).toBeUndefined();
        });

        test("undefined → empty record (legacy behavior)", () => {
                const env = applyEffortToEnv(undefined);
                expect(env).toEqual({});
        });

        test("the env record only contains the documented var (no extras)", () => {
                // The keys of the returned record are exactly the documented env
                // vars (no leakage of internal state). Pinning the surface.
                const lowEnv = applyEffortToEnv("low");
                expect(Object.keys(lowEnv)).toEqual([SUBAGENT_QWEN_THINKING_ENV]);
                const highEnv = applyEffortToEnv("high");
                expect(Object.keys(highEnv)).toEqual([SUBAGENT_QWEN_THINKING_ENV]);
        });

        test("the env var name is exactly 'BRIDGE_QWEN_THINKING'", () => {
                // Pin the literal — this is the contract the llm-bridge reads.
                expect(SUBAGENT_QWEN_THINKING_ENV).toBe("BRIDGE_QWEN_THINKING");
        });
});

// ---------------------------------------------------------------------------
// Env-var name constants — pin the literal strings (no drift)
// ---------------------------------------------------------------------------

describe("env-var name constants", () => {
        test("SUBAGENT_MODEL_ENV is 'UNOWN_SUBAGENT_MODEL'", () => {
                expect(SUBAGENT_MODEL_ENV).toBe("UNOWN_SUBAGENT_MODEL");
        });

        test("SUBAGENT_MCP_SERVERS_ENV is 'UNOWN_MCP_SERVERS'", () => {
                expect(SUBAGENT_MCP_SERVERS_ENV).toBe("UNOWN_MCP_SERVERS");
        });

        test("SUBAGENT_NO_AGENTS_MD_ENV is 'UNOWN_NO_AGENTS_MD'", () => {
                expect(SUBAGENT_NO_AGENTS_MD_ENV).toBe("UNOWN_NO_AGENTS_MD");
        });
});
