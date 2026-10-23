/**
 * subagent-routing.ts — Milestone 2.1 + 2.2 helpers for per-subagent routing.
 *
 * Reverse-engineered from Claude Code's `sub-agents.txt` documentation
 * (per-subagent `model` + `effort: low | medium | high`) and zcode's
 * per-subagent isolation surface (per-subagent `mcpServers` whitelist +
 * `injectAgentsMd` toggle, per /home/z/my-project/research/2-b2-report.md
 * proposal #4).
 *
 * WHY THIS FILE EXISTS
 *
 * The routing logic itself is pure: given a `SubagentConfig`, build the args
 * array for the spawned unown subprocess; given a parsed frontmatter object,
 * pluck the new optional fields; given an `effort` value, map it to the env
 * var the bridge reads. tools.ts lives inside the pi extension runtime, so
 * unit-testing the routing logic by importing tools.ts would load every pi
 * module — these helpers are extracted to a pure module so they can be tested
 * hermetically (test/subagent-routing.test.ts imports ONLY from this file).
 *
 * tools.ts imports these helpers and wires them into:
 *   - `SubagentConfig` (extended with `SubagentRoutingFields`)
 *   - `loadAgentsFromDir` (frontmatter → SubagentRoutingFields via
 *     `parseAgentFrontmatterExtras`)
 *   - `BUILTIN_AGENTS` (spread `BACKGROUND_EXPLORE_AGENT`)
 *   - `runSubagentOnce` (args built by `buildSubagentArgs`; env mutated via
 *     `applyEffortToEnv` for the effort field)
 *
 * cli.ts imports `parseSubagentFlags` and uses it inside its `parseArgs` to
 * strip + parse the four new flags (`--model`, `--effort`, `--mcp-servers`,
 * `--no-agents-md`). It then sets the corresponding env vars before
 * `bootRuntime` so the spawned session's `term.ts` + `mcp.ts` consume them.
 *
 * Public surface (all pure: no pi imports, no fs, no network):
 *   - SubagentEffort                  — "low" | "medium" | "high"
 *   - SubagentRoutingFields           — the new optional fields on SubagentConfig
 *   - SUBAGENT_MODEL_ENV              — "UNOWN_SUBAGENT_MODEL"
 *   - SUBAGENT_MCP_SERVERS_ENV        — "UNOWN_MCP_SERVERS"
 *   - SUBAGENT_NO_AGENTS_MD_ENV       — "UNOWN_NO_AGENTS_MD"
 *   - SUBAGENT_QWEN_THINKING_ENV      — "BRIDGE_QWEN_THINKING"
 *   - parseSubagentFlags(argv)        — the CLI flag parser for the 4 new flags
 *   - parseAgentFrontmatterExtras(fm) — pluck the 4 new fields from parsed frontmatter
 *   - applyEffortToEnv(effort)        — effort → BRIDGE_QWEN_THINKING env record
 *   - resolveSubagentModel(agent, env) — agent.model || UNOWN_SUBAGENT_MODEL || undefined
 *   - buildSubagentArgs(agent)        — args-array builder (extracted from runSubagentOnce)
 *   - BACKGROUND_EXPLORE_AGENT        — the new built-in agent config
 *
 * Standing invariant: no fork of the pi substrate; no pi imports; lands on
 * the documented SubagentConfig seam (tools.ts:82) and the parseArgs seam
 * (cli.ts:189).
 */

/** The reasoning-effort levels a subagent may request. */
export type SubagentEffort = "low" | "medium" | "high";

/** The new optional fields added to SubagentConfig (Milestone 2.1 + 2.2).
 *  Kept as a separate interface so SubagentConfig can extend it without
 *  dragging the test runtime into pi. */
export interface SubagentRoutingFields {
        /** Override `PI_MODEL_ID` for this subagent's run only. Per-agent value
         *  takes precedence over the `UNOWN_SUBAGENT_MODEL` env var. */
        model?: string;
        /** Reasoning effort. `low` → BRIDGE_QWEN_THINKING=0; `high` → =1;
         *  `medium` (or unset) → leave the bridge default alone. */
        effort?: SubagentEffort;
        /** Whitelist of MCP server names to load for this subagent. An EMPTY
         *  array means "load NO MCP servers" (the background-explore shape);
         *  undefined means "load all" (the legacy behavior). */
        mcpServers?: string[];
        /** Whether to inject the per-tier AGENTS.md / memory files into the
         *  subagent's system prompt. Default `true` (legacy). `false` skips
         *  injection (lighter context, lower cost). */
        injectAgentsMd?: boolean;
}

// ---------------------------------------------------------------------------
// Env-var names — exported as constants so cli.ts / mcp.ts / term.ts reference
// the same identifier (no string drift). Read lazily (per call, not at module
// load) so tests + long-running processes can mutate process.env between calls.
// ---------------------------------------------------------------------------

/** When set, overrides `PI_MODEL_ID` for EVERY subagent (per-agent `model`
 *  still wins). Useful for routing all subagents to a local model. */
export const SUBAGENT_MODEL_ENV = "UNOWN_SUBAGENT_MODEL";

/** When set, the MCP extension filters the merged config to only the listed
 *  server names. Empty string means "load none" (e.g. background-explore);
 *  unset means "load all" (legacy). Comma-separated. */
export const SUBAGENT_MCP_SERVERS_ENV = "UNOWN_MCP_SERVERS";

/** When "1", the AGENTS.md / per-tier memory injection layer skips appending
 *  the memory files to the subagent's system prompt. */
export const SUBAGENT_NO_AGENTS_MD_ENV = "UNOWN_NO_AGENTS_MD";

/** The env var the qwen-family bridge reads to toggle thinking mode.
 *  "1" = thinking enabled (high effort); "0" = disabled (low effort). */
export const SUBAGENT_QWEN_THINKING_ENV = "BRIDGE_QWEN_THINKING";

// ---------------------------------------------------------------------------
// CLI flag parser (extracted from cli.ts:parseArgs so it is hermetically
// testable without importing the pi-coding-agent runtime)
// ---------------------------------------------------------------------------

/** Result of parsing the four new subagent-routing flags out of an argv
 *  array. `rest` is the argv with the consumed flags removed (so the
 *  existing parseArgs loop does not treat them as prompt text). */
export interface ParsedSubagentFlags {
        rest: string[];
        model?: string;
        effort?: SubagentEffort;
        mcpServers?: string[];
        noAgentsMd?: boolean;
}

/**
 * Scan argv once and pluck out the four Milestone-2 subagent-routing flags:
 *
 *   --model <id>              → model: string
 *   --effort <low|medium|high> → effort: SubagentEffort (invalid → dropped)
 *   --mcp-servers <csv>       → mcpServers: string[] (empty CSV → empty array,
 *                               signaling "load none"; absent → undefined)
 *   --no-agents-md            → noAgentsMd: true (boolean, no value)
 *
 * Each consumed flag is REMOVED from the returned `rest` array so the caller
 * (parseArgs) does not see it as prompt text. Pure: no I/O, no env. Mirrors
 * cli.ts's existing parsing style (next-token consumption, `--`-prefix guard
 * on the next token to allow the value to start with `--` would NOT be a
 * value — same shape as `--tools` and `--append-system-prompt`).
 */
export function parseSubagentFlags(argv: string[]): ParsedSubagentFlags {
        const rest: string[] = [];
        let model: string | undefined;
        let effort: SubagentEffort | undefined;
        let mcpServers: string[] | undefined;
        let noAgentsMd: boolean | undefined;
        for (let i = 0; i < argv.length; i++) {
                const a = argv[i];
                if (a === "--model") {
                        const next = argv[i + 1];
                        if (next !== undefined && !next.startsWith("--")) {
                                model = next;
                                i++;
                        }
                        continue;
                }
                if (a === "--effort") {
                        const next = argv[i + 1];
                        if (next !== undefined && !next.startsWith("--")) {
                                const e = next.trim().toLowerCase();
                                if (e === "low" || e === "medium" || e === "high") effort = e;
                                // invalid effort values are silently dropped (the flag is
                                // still consumed — same posture as parseToolList on bad input)
                                i++;
                        }
                        continue;
                }
                if (a === "--mcp-servers") {
                        const next = argv[i + 1];
                        if (next !== undefined && !next.startsWith("--")) {
                                mcpServers = next
                                        .split(",")
                                        .map((s) => s.trim())
                                        .filter(Boolean);
                                i++;
                        }
                        continue;
                }
                if (a === "--no-agents-md") {
                        noAgentsMd = true;
                        continue;
                }
                rest.push(a);
        }
        return { rest, model, effort, mcpServers, noAgentsMd };
}

// ---------------------------------------------------------------------------
// Frontmatter parser — extracts the new fields from a parsed frontmatter
// object. The YAML parser itself is pi's parseFrontmatter; this helper just
// plucks + validates the four new keys (mirroring parseToolList's tolerant
// posture: invalid values are dropped, never thrown).
// ---------------------------------------------------------------------------

/**
 * Pluck the four new routing fields out of a parsed frontmatter object
 * (the JS object pi's parseFrontmatter returns). Accepts both camelCase and
 * snake_case keys for mcpServers / injectAgentsMd (frontmatter convention
 * varies by tool — Claude Code uses camelCase, zcode's docs use snake_case).
 *
 * Pure: no I/O, no env. Invalid values are dropped silently.
 */
export function parseAgentFrontmatterExtras(frontmatter: unknown): SubagentRoutingFields {
        if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) return {};
        const fm = frontmatter as Record<string, unknown>;
        const out: SubagentRoutingFields = {};

        if (typeof fm.model === "string" && fm.model.trim()) {
                out.model = fm.model.trim();
        }

        if (typeof fm.effort === "string") {
                const e = fm.effort.trim().toLowerCase();
                if (e === "low" || e === "medium" || e === "high") out.effort = e;
        }

        // mcpServers accepts a comma-separated string OR an array (matching
        // parseToolList's permissiveness). snake_case fallback for zcode parity.
        const mcpRaw = fm.mcpServers ?? fm.mcp_servers;
        if (typeof mcpRaw === "string") {
                const list = mcpRaw
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean);
                if (list.length > 0) out.mcpServers = list;
        } else if (Array.isArray(mcpRaw)) {
                const list = mcpRaw
                        .filter((s): s is string => typeof s === "string")
                        .map((s) => s.trim())
                        .filter(Boolean);
                if (list.length > 0) out.mcpServers = list;
        }

        // injectAgentsMd accepts a boolean OR a string ("true"/"1" → true,
        // "false"/"0" → false). snake_case fallback for zcode parity.
        const injRaw = fm.injectAgentsMd ?? fm.inject_agents_md;
        if (typeof injRaw === "boolean") {
                out.injectAgentsMd = injRaw;
        } else if (typeof injRaw === "string") {
                const v = injRaw.trim().toLowerCase();
                if (v === "true" || v === "1") out.injectAgentsMd = true;
                else if (v === "false" || v === "0") out.injectAgentsMd = false;
        }

        return out;
}

// ---------------------------------------------------------------------------
// Effort → env-var mapping (extracted so the test pins the exact mapping)
// ---------------------------------------------------------------------------

/**
 * Map a subagent effort level to the env-var overrides the spawned child
 * should receive. `medium` (and `undefined`) return an empty record — leave
 * the bridge default alone, since touching BRIDGE_QWEN_THINKING for the
 * medium case would override an explicit bridge-side config.
 *
 * The returned record is merged into the spawn env by runSubagentOnce
 * (alongside UNOWN_SUBAGENT=1). Pure + idempotent.
 *
 * NOTE: pi-coding-agent has no `--max-tokens` flag at this writing; if it
 * ever does, `low` should also pass `--max-tokens 2048` to bound the reply
 * length. For now only the env var is set.
 */
export function applyEffortToEnv(effort: SubagentEffort | undefined): Record<string, string> {
        if (effort === "low") return { [SUBAGENT_QWEN_THINKING_ENV]: "0" };
        if (effort === "high") return { [SUBAGENT_QWEN_THINKING_ENV]: "1" };
        return {};
}

// ---------------------------------------------------------------------------
// Model resolution (per-agent beats env beats default)
// ---------------------------------------------------------------------------

/**
 * Resolve the effective model for a subagent run. Precedence:
 *   1. `agent.model` (per-subagent override)
 *   2. `env.UNOWN_SUBAGENT_MODEL` (global override, useful for routing all
 *      subagents to a local model)
 *   3. undefined → the spawned child uses whatever PI_MODEL_ID / models.json
 *      resolves to (the legacy default)
 *
 * Pure: reads `env` (defaults to `process.env`) but never mutates it.
 */
export function resolveSubagentModel(
        agent: Pick<SubagentRoutingFields, "model">,
        env: Record<string, string | undefined> = process.env,
): string | undefined {
        if (typeof agent.model === "string" && agent.model.length > 0) return agent.model;
        const global = env[SUBAGENT_MODEL_ENV];
        return typeof global === "string" && global.length > 0 ? global : undefined;
}

// ---------------------------------------------------------------------------
// Args-array builder — extracted from runSubagentOnce so it is hermetically
// testable. Backward-compatible: an agent with no new routing fields returns
// the same args array as before.
// ---------------------------------------------------------------------------

/** The minimum shape buildSubagentArgs needs from an agent. tools.ts's
 *  SubagentConfig satisfies this (it has `name`, `tools?`, plus the four
 *  routing fields when extended with SubagentRoutingFields). */
export interface BuildSubagentArgsAgent extends SubagentRoutingFields {
        name: string;
        tools?: string[];
}

/**
 * Build the args array for a `unown --mode json -p --no-session` subagent
 * spawn. Always includes the four legacy flags (`--mode json -p --no-session`
 * + optional `--tools`); adds the four Milestone-2 flags conditionally:
 *
 *   --model <id>              when resolveSubagentModel returns a value
 *   --effort <low|medium|high> when agent.effort is set
 *   --mcp-servers <csv>       when agent.mcpServers is set (even empty CSV —
 *                             empty means "load none", which is meaningful)
 *   --no-agents-md            when agent.injectAgentsMd === false
 *
 * The trailing prompt (the task text) is NOT appended here — the caller
 * pushes it after the system-prompt file is set up. Pure: no I/O, no env
 * reads beyond `resolveSubagentModel` (which is itself pure).
 */
export function buildSubagentArgs(agent: BuildSubagentArgsAgent): string[] {
        const args: string[] = ["--mode", "json", "-p", "--no-session"];

        if (agent.tools && agent.tools.length > 0) {
                args.push("--tools", agent.tools.join(","));
        }

        const model = resolveSubagentModel(agent);
        if (model) {
                args.push("--model", model);
        }

        if (agent.effort === "low" || agent.effort === "medium" || agent.effort === "high") {
                args.push("--effort", agent.effort);
        }

        if (Array.isArray(agent.mcpServers)) {
                // Even an empty whitelist is meaningful: it means "load NO MCP
                // servers" (the background-explore shape). So we always pass the
                // flag when the field is set; the consumer side (parseSubagentFlags
                // → cli.ts → mcp.ts) treats an empty CSV as "load none".
                args.push("--mcp-servers", agent.mcpServers.join(","));
        }

        if (agent.injectAgentsMd === false) {
                // Default is `true` (legacy injection). Only `=== false` opts out.
                args.push("--no-agents-md");
        }

        return args;
}

// ---------------------------------------------------------------------------
// The new built-in agent — background-explore. Read-only, minimal-overhead:
// cheaper qwen3.7-plus model, low reasoning effort, no MCP servers, no
// AGENTS.md injection. tools.ts spreads this into BUILTIN_AGENTS alongside
// `general` and `explore`.
// ---------------------------------------------------------------------------

/** The read-only, minimal-overhead exploration subagent (Milestone 2.2).
 *  tools.ts imports this const and adds it to BUILTIN_AGENTS so the
 *  discovery + override semantics (built-in < user < project) apply. */
export const BACKGROUND_EXPLORE_AGENT: {
        name: string;
        description: string;
        tools: string[];
        systemPrompt: string;
        source: "built-in";
} & SubagentRoutingFields = {
        name: "background-explore",
        description:
                "Read-only exploration subagent for low-cost background sweeps. Maps where things live in the repo and returns file:line evidence. Runs at lower reasoning effort than `explore`, loads no MCP servers, and skips AGENTS.md injection — the minimal-overhead choice for parallel fact-finding where the parent agent does not need a full unown context.",
        tools: ["read", "grep", "find", "ls"],
        systemPrompt: `You are unown's background exploration subagent — read-only, minimal overhead.

You receive ONE self-contained question about the codebase. Answer concisely with evidence:
- cite file:line for every claim
- end with a short direct answer first, details after

Do not propose changes; do not edit anything. If the answer is not in the repo, say so.`,
        source: "built-in",
        effort: "low",
        mcpServers: [],
        injectAgentsMd: false,
};
