/**
 * cli.ts — the `unown` terminal coding agent.
 *
 * Boots the pi coding agent's full TUI (or one-shot print mode) in the user's
 * REAL project directory with the self-learning layer attached:
 *
 *   - tiered memory injected (policy → project → user → local) on every
 *     session, including /new, /resume and /fork
 *   - terminal guardrail hooks (PreToolUse deny-list, write-path jail,
 *     PostToolUse syntax gate)
 *   - session notes captured on exit and delivered to the self-learning
 *     engine, where AutoDream consolidates them into this project's memory
 *
 * Commands:
 *   unown [prompt]        interactive TUI session in the current directory
 *   unown -p "prompt"     one-shot headless run (like `claude -p`)
 *   unown setup           connect a model provider (wizard or flags)
 *   unown models          list configured models (+ live bridge list)
 *   unown init            scaffold .unown/ memory scaffold in this project
 *   unown memory          print the effective 4-tier memory stack
 *   unown doctor          diagnose configuration, bridge, engine and memory
 *   unown mcp <sub>        manage MCP server configs (add/list/get/remove/test)
 *   unown note "text"     hand a note to the engine (for AutoDream)
 */
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
        type CreateAgentSessionRuntimeFactory,
        createAgentSessionFromServices,
        createAgentSessionRuntime,
        createAgentSessionServices,
        InteractiveMode,
        resolveCliModel,
        runPrintMode,
        SessionManager,
        SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { netBlocked, osSandboxAvailable, resolveBwrapPath, resolveSandboxExecPath } from "./bwrap.ts";
import { cmdCompletions, COMPLETIONS_HELP } from "./completions.ts";
import { cmdInfo } from "./info.ts";
import { generateAgentsMd, shouldOverwriteAgentsMd } from "./init-agents.ts";
import { auditInstructionSet, renderInstructionAudit, summarizeInstructionAudit } from "./doctor-instructions.ts";
import { MIGRATIONS, readMigrationState } from "./migrations.ts";
import { isLoopbackProvider, probeOpenAiEndpoint, readAgentModelsFile, resolveActiveProvider } from "./probe.ts";
import { printModelsOverview, runSetupCommand, SETUP_USAGE } from "./setup.ts";
import {
        deliverTerminalNote,
        ENGINE_URL,
        ensureUnownAgentDir,
        ensureUnownAgentDirInfo,
        initProjectMemory,
        projectMemoryPath,
        resolveTerminalMemory,
        STRICT_HOOKS,
        terminalMemoryForAgent,
        UNOWN_AGENT_DIR,
        UNOWN_HOME,
        unownAgentDirInit,
} from "./term.ts";
import { CheckpointStore, checkpointsDir, createCheckpointsExtension, receiptsDir } from "./checkpoints.ts";
import { createMcpExtension, formatConfigProblem, resolveMcpConfig } from "./mcp.ts";
import { MCP_HELP, runMcpCommand } from "./mcp-cli.ts";
import { runAutomationsCommand, AUTOMATIONS_USAGE } from "./automations-cli.ts";
import { runUsageCommand, USAGE_HELP } from "./usage-cli.ts";
import { runSessionsCommand, SESSIONS_USAGE } from "./sessions-cli.ts";
import { runRecipesCommand, RECIPES_USAGE } from "./recipes-cli.ts";
import { runWikiCommand, WIKI_USAGE } from "./wiki-cli.ts";
import { commandExists, DEFAULT_SERVERS } from "./lsp.ts";
import { installChildReaper } from "./child-reaper.ts";
import { createPermissionsExtension, createPermissionGate, permissionsDoctorSummary } from "./permissions.ts";
import { assembleResultJson, captureStdout, createOutputCapture, createOutputCaptureExtension } from "./output-format.ts";
import { ACP_HELP, runAcpServer } from "./acp.ts";
import { createTerminalExtension } from "./termhooks.ts";
import { createUnownToolsExtension } from "./tools.ts";
import { unownVersion } from "./packaging.ts";
import {
        applyEffortToEnv,
        parseSubagentFlags,
        SUBAGENT_MCP_SERVERS_ENV,
        SUBAGENT_MODEL_ENV,
        SUBAGENT_NO_AGENTS_MD_ENV,
        type SubagentEffort,
} from "./subagent-routing.ts";
import { cmdUninstall, findShims, parseUninstallFlags, UNINSTALL_HELP } from "./uninstall.ts";
import {
        cmdChangelog,
        cmdUpdate,
        compareSemver,
        describeAge,
        gitShortSha,
        maybeShowUpdateNotice,
        parseUpdateFlags,
        readUpdateCheckCache,
        realGit,
        resolveRepoRoot,
        UPDATE_HELP,
} from "./update.ts";

/** Unown's version — the value the release-artifact build injected, else the
 *  ROOT package.json (the source of truth CI asserts against). "unknown" when
 *  neither is available (a compiled binary built without --define). */
const VERSION: string = unownVersion(join(import.meta.dir, "..", "..", "..", "..", "package.json"));

const HELP = `unown — a self-improving terminal coding agent

Usage:
  unown                    interactive session in the current directory
  unown "do something"     interactive session starting with a prompt
  unown -p "prompt"        one-shot headless run (print mode)
  unown --plan [...]       start (print or TUI) in plan mode: read-only exploration,
                           numbered plan, then execution after approval (also /plan, Ctrl+Alt+P)
  unown --goal "objective"  start with a durable goal: evidence-verified completion,
                           unfinished todos block it (also /goal <objective>)
  unown setup              connect a model provider — interactive wizard
                           presets: bridge (bundled), openai, openrouter, anthropic,
                           dashscope, deepseek, custom (any OpenAI-compatible)
  unown setup --provider openai --api-key sk-... --model gpt-4o
                           non-interactive (--force overwrites, --list shows presets)
  unown models             list configured models (+ what a local bridge serves)
  unown init               scaffold .unown/ project memory
  unown init-agents        generate or update AGENTS.md (Milestone 3.1)
                           (--overwrite, --print, --json; reverse-engineered
                           from opencode /init + Claude Code /init)
  unown memory             print the effective memory stack
  unown doctor             run configuration diagnostics (--json: machine-readable)
  unown doctor-instructions  run ONLY the instruction-set audit
                           (AGENTS.md freshness, skills, MCP, hooks, adversary,
                           injection scanner — Milestone 3.2; --json)
  unown mcp <sub>         manage MCP servers: add | add-http | add-json |
                           list | get | remove | test (see 'unown help mcp')
  unown automations <sub> scheduled agent runs (zcode Automations port):
                           list | create | edit | pause | resume | run |
                           history | delete — needs the engine running;
                           cron is LOCAL timezone, default mode read-only
  unown usage            token & cost report for the LLM bridge
                           (--days N, --model M, --json; estimates unless
                           UNOWN_PRICE_* pins exact prices)
  unown sessions <sub>  session export / import / list (Milestone 3.5):
                           export <id> [--out <file>] | import <file> | list
  unown recipes <sub>    declarative agent instruction bundles (Milestone 4.1,
                           the goose Recipes port): list | run <name> [--k v] |
                           create <name> | validate <file>; discovered from
                           .unown/recipes/*.md (project) + $UNOWN_HOME/recipes/*.md
  unown wiki <sub>      auto-generated repo documentation with file:line
                           cross-links (Milestone 4.2, the zcode Repo Wiki
                           port): generate [--force] | search <q> | list |
                           show <page>; written to .unown/wiki/*.md
  unown acp               run the ACP editor server on stdio (JSON-RPC 2.0,
                           newline-delimited) — point Zed or any ACP client at
                           it: agent program 'unown', args 'acp' (see
                           'unown help acp' and docs/acp.md)
  unown info               print the support bundle (--json: machine-readable)
  unown note "text"        deliver a session note to the engine
  unown update            check for a newer release and self-update
                           --check (report only; exit 2 when available),
                           --json, --allow-dirty, --rollback, or a version:
                           unown update 2.1.0 (also pins/rolls back)
  unown changelog [n]     print the latest CHANGELOG.md sections (default 1)
  unown completions <sh>  bash | zsh | fish | powershell completion script
  unown uninstall         remove the PATH shims (--dry-run, --purge-data,
                           --purge-checkout)
  unown --help             this help
  unown --version          print the version (matches package.json)

Session tools (registered in every session):
  todo / note / task / fetch_url / web_search /
  webfetch / lsp                         visible task tracking, mid-session learning notes,
                                         subagents with a fresh context (output_schema
                                         structured replies, worktree_isolation), HTTP reads,
                                         live web search + page reads (keyless out of the
                                         box; provider keys optional), language-server code
                                         intelligence
  automation_list (+create/update/delete outside automation runs)
                                         scheduled runs managed by the engine
  /plan /todos /note /agents /learning /lsp /checkpoint /undo /redo
  /restore /checkpoints /receipts /mcp /goal /review   session commands
  /init-agents            preview the generated AGENTS.md (no file write —
                          run \`unown init-agents --print\` for the full text)
  /doctor-instructions    audit the instruction set inline (AGENTS.md, skills,
                          MCP, hooks, adversary mode, injection scanner)
  /blame <file>           show which receipts touched a file (write/edit/bash);
                          no arg = summary; flags: --session <id> --since <ts> --json
  /sessions <sub>         export|import|list — the in-session alias for the
                          \`unown sessions\` CLI (Milestone 3.5); \`/sessions export\`
                          writes to .unown/sessions/export-<id>.json
  /recipe <name> [args]  run a declarative agent instruction bundle (Milestone
                          4.1, the goose Recipes port): \`/recipe list\` prints
                          available recipes; \`/recipe <name> --key value\` runs
                          one with parameters interpolated into the body
  /wiki <sub>           auto-generated repo documentation with file:line
                          cross-links (Milestone 4.2, the zcode Repo Wiki
                          port): \`/wiki generate\` writes the wiki to
                          .unown/wiki/ (parallel subagents per module);
                          \`/wiki search <q>\` / \`list\` / \`show <page>\`
                          read from the existing wiki
  /edit-resend <n> <msg>  edit the Nth user message + revert files to the
                          pre-message checkpoint, then resend (all-or-nothing
                          file reset; aborts if any file was edited out-of-band —
                          Milestone 3.6)
  /permissions            granular permissions status (mode, rules, trust;
                           /permissions trust approves a project config)
  /<name> [args]          custom slash commands: .unown/commands/*.md in the
                           project, ~/.unown/agent/commands/*.md global — markdown
                           + frontmatter (description, argument-hint), body with
                           $ARGUMENTS / $1..$N / \${N:-default} substitution

One-shot run flags (print mode; several also used by the task tool):
  --mode json              stream JSON events instead of text (print mode)
  --output-format json     print ONE final JSON object (result + session id +
                           model + usage + cost + duration + turns; exit codes
                           unchanged) — CI/wrapper contract, composes with jq
  --no-session             do not persist the session
  --tools a,b,c            restrict the active tool set
  --append-system-prompt F append the file's contents to the system prompt
  --model <id>            override PI_MODEL_ID for this run (per-subagent
                           routing; see UNOWN_SUBAGENT_MODEL below)
  --effort low|medium|high  reasoning effort (low → BRIDGE_QWEN_THINKING=0,
                           high → =1, medium/unset = bridge default)
  --mcp-servers a,b       whitelist of MCP servers to load (empty CSV = load
                           none; absent = load all)
  --no-agents-md          skip AGENTS.md / per-tier memory injection

Environment:
  UNOWN_HOME               state dir (default ~/.unown)
  UNOWN_ENGINE_URL         self-learning engine (default http://127.0.0.1:3030)
  UNOWN_STRICT_HOOKS=1     sandbox-grade hooks (blocks network, git push, sudo)
  UNOWN_NO_PREFLIGHT=1     skip the endpoint reachability check before sessions
  UNOWN_LSP=0              disable the lsp tool + after-edit diagnostics loop
                           (waits/timeouts: UNOWN_LSP_WAIT_MS / UNOWN_LSP_TIMEOUT_MS)
  UNOWN_MCP=0              disable the MCP client (no mcp__* tools register)
                           (timeouts: UNOWN_MCP_TIMEOUT_MS / UNOWN_MCP_CONNECT_TIMEOUT_MS)
  UNOWN_PERMISSIONS=0      disable the granular permissions layer (the
                           hard-coded bash deny-list + write jail stay on)
  UNOWN_PERMISSIONS_LEARN=1  append allow rules for passed bash commands
                           to ~/.unown/agent/permissions.json (opt-in)
  NO_UPDATE_NOTIFIER=1     silence the startup update notice
  UNOWN_DISABLE_UPDATES=1  disable all update paths (org/CI switch)
  PI_BRIDGE_URL/PI_MODEL_ID/PI_PROVIDER   LLM endpoint for ~/.unown/agent/models.json
  UNOWN_SUBAGENT_MODEL     override PI_MODEL_ID for EVERY subagent (per-agent
                           model still wins; useful for routing all subagents
                           to a local model)
`;

// ---------------------------------------------------------------------------
// Simple argument parsing
// ---------------------------------------------------------------------------
interface CliArgs {
        command: "tui" | "print" | "init" | "memory" | "doctor" | "note" | "help";
        prompt?: string;
        verbose: boolean;
        jsonMode: boolean;
        noSession: boolean;
        tools?: string[];
        appendSystemPromptPath?: string;
        plan: boolean;
        goal?: string;
        outputFormat?: "text" | "json";
        // Milestone 2.1 + 2.2 — per-subagent routing fields. Set by the new
        // --model / --effort / --mcp-servers / --no-agents-md flags; consumed by
        // bootRuntime to set PI_MODEL_ID / BRIDGE_QWEN_THINKING /
        // UNOWN_MCP_SERVERS / UNOWN_NO_AGENTS_MD before the session starts.
        model?: string;
        effort?: SubagentEffort;
        mcpServers?: string[];
        noAgentsMd?: boolean;
}

// Exported for tests: the parse contract (routing flags, --output-format
// pairing, print/TUI selection) is asserted by test/cli/parse-args.test.ts.
export function parseArgs(argv: string[]): CliArgs {
        // Milestone 2.1 + 2.2 — strip the four new subagent-routing flags out
        // first so the main loop does not treat their values as prompt text.
        // The pure helper parseSubagentFlags (in subagent-routing.ts) is the
        // canonical parser for these flags; it is hermetically testable.
        const subagentFlags = parseSubagentFlags(argv);
        const argvRest = subagentFlags.rest;
        const rest: string[] = [];
        let print = false;
        let verbose = false;
        let jsonMode = false;
        let noSession = false;
        let tools: string[] | undefined;
        let appendSystemPromptPath: string | undefined;
        let plan = false;
        let goal: string | undefined;
        let outputFormat: "text" | "json" | undefined;
        for (let i = 0; i < argvRest.length; i++) {
                const a = argvRest[i];
                if (a === "--help" || a === "-h") return { command: "help", verbose, jsonMode, noSession, plan, goal, outputFormat };
                if (a === "--print" || a === "-p") {
                        print = true;
                        continue;
                }
                if (a === "--verbose" || a === "-v") {
                        verbose = true;
                        continue;
                }
                if (a === "--mode") {
                        const next = argvRest[i + 1];
                        if (next === "json") jsonMode = true;
                        else if (next !== "text") rest.push(a); // unknown mode value: treat as prompt text
                        i++;
                        continue;
                }
                if (a === "--no-session") {
                        noSession = true;
                        continue;
                }
                if (a === "--output-format") {
                        const next = argvRest[i + 1];
                        if (next === "json" || next === "text") {
                                outputFormat = next;
                                i++;
                        } else {
                                console.error("unown: --output-format expects json or text");
                                process.exit(2);
                        }
                        continue;
                }
                if (a === "--plan") {
                        plan = true;
                        continue;
                }
                if (a === "--goal") {
                        const next = argvRest[i + 1];
                        if (next !== undefined && !next.startsWith("--")) {
                                goal = next;
                                i++;
                        }
                        continue;
                }
                if (a === "--tools") {
                        const next = argvRest[i + 1];
                        if (next !== undefined) {
                                tools = next
                                        .split(",")
                                        .map((t) => t.trim())
                                        .filter(Boolean);
                                i++;
                        }
                        continue;
                }
                if (a === "--append-system-prompt") {
                        const next = argvRest[i + 1];
                        if (next !== undefined) {
                                appendSystemPromptPath = next;
                                i++;
                        }
                        continue;
                }
                rest.push(a);
        }
        const first = rest[0];
        if (first === "init" || first === "memory" || first === "doctor" || first === "note") {
                const prompt = rest.slice(1).join(" ");
                return { command: first, prompt, verbose, jsonMode, noSession, plan, outputFormat };
        }
        const prompt = rest.join(" ");
        // Milestone 2.1 + 2.2 — surface the parsed routing fields (set by
        // parseSubagentFlags above) on every exit path so bootRuntime's
        // applySubagentEnvOverrides honors --model / --effort /
        // --mcp-servers / --no-agents-md (and the task tool's subagent
        // spawns inherit the same contract).
        //
        // Non-TTY stdio forces print mode (same behaviour as pi itself).
        if (print || !process.stdin.isTTY || !process.stdout.isTTY)
                return {
                        command: "print",
                        prompt,
                        verbose,
                        jsonMode,
                        noSession,
                        tools,
                        appendSystemPromptPath,
                        plan,
                        goal,
                        outputFormat,
                        model: subagentFlags.model,
                        effort: subagentFlags.effort,
                        mcpServers: subagentFlags.mcpServers,
                        noAgentsMd: subagentFlags.noAgentsMd,
                };
        return {
                command: "tui",
                prompt,
                verbose,
                jsonMode,
                noSession,
                tools,
                appendSystemPromptPath,
                plan,
                goal,
                outputFormat,
                model: subagentFlags.model,
                effort: subagentFlags.effort,
                mcpServers: subagentFlags.mcpServers,
                noAgentsMd: subagentFlags.noAgentsMd,
        };
}

// ---------------------------------------------------------------------------
// Agent boot (shared by TUI, print mode and the ACP server)
// ---------------------------------------------------------------------------
interface BootOptions {
        jsonMode?: boolean;
        noSession?: boolean;
        tools?: string[];
        appendSystemPromptPath?: string;
        plan?: boolean;
        goal?: string;
        extraExtensions?: Array<{ name: string; hidden: boolean; factory: (pi: any) => void | Promise<void> }>;
        /** Pre-opened session manager (ACP session/load resumes a persisted
         * session instead of creating a fresh one). */
        sessionManager?: SessionManager;
        // Milestone 2.1 + 2.2 — per-subagent routing fields. Set by parseArgs
        // (from the new --model / --effort / --mcp-servers / --no-agents-md
        // flags); consumed by bootRuntime to set PI_MODEL_ID /
        // BRIDGE_QWEN_THINKING / UNOWN_MCP_SERVERS / UNOWN_NO_AGENTS_MD before
        // the session starts. Undefined values leave the inherited env alone
        // (legacy behavior).
        model?: string;
        effort?: SubagentEffort;
        mcpServers?: string[];
        noAgentsMd?: boolean;
}

/**
 * Apply the Milestone 2.1 + 2.2 routing fields to `process.env` BEFORE the
 * session is created. Each field is optional; an unset field leaves the
 * inherited env alone (so the parent's env still applies — subagents that
 * don't opt into routing behave exactly as before).
 *
 * The env writes happen here (not in bootRuntime) so the call site stays
 * explicit: cmdPrint and cmdTui both invoke this once, before bootRuntime.
 * Idempotent: re-running with the same opts is a no-op.
 *
 * NOTE on `--max-tokens`: pi-coding-agent has no `--max-tokens` flag at this
 * writing, so `effort: low` only sets BRIDGE_QWEN_THINKING=0. If pi ever
 * adds `--max-tokens`, the low branch should also pass it (2048) to bound
 * the reply length — for now only the env var is set.
 */
function applySubagentEnvOverrides(opts: BootOptions): void {
        if (opts.model) {
                // term.ts:writeModelsJson reads PI_MODEL_ID at call time (inside
                // ensureUnownAgentDirInfo, called by bootRuntime) — so setting it
                // here propagates to the spawned session's models.json + bridge.
                process.env.PI_MODEL_ID = opts.model;
        }
        if (opts.effort) {
                // applyEffortToEnv returns the BRIDGE_QWEN_THINKING mapping; merge
                // it into process.env (the bridge reads it lazily per request).
                const effortEnv = applyEffortToEnv(opts.effort);
                for (const [k, v] of Object.entries(effortEnv)) process.env[k] = v;
        }
        if (opts.mcpServers !== undefined) {
                // Even an empty array is meaningful: empty CSV = "load no MCP
                // servers" (the background-explore shape). mcp.ts:getManager reads
                // UNOWN_MCP_SERVERS and filters the merged config accordingly.
                process.env[SUBAGENT_MCP_SERVERS_ENV] = opts.mcpServers.join(",");
        }
        if (opts.noAgentsMd) {
                // Read by the agentsFilesOverride callback in bootRuntime to skip
                // the per-tier memory files (AGENTS.md injection).
                process.env[SUBAGENT_NO_AGENTS_MD_ENV] = "1";
        }
}

async function bootRuntime(cwd: string, verbose: boolean, bootOpts: BootOptions = {}) {
        // Milestone 2.1 + 2.2 — apply the per-subagent routing overrides to
        // process.env BEFORE the session is created, so term.ts:writeModelsJson
        // (reads PI_MODEL_ID), the bridge (reads BRIDGE_QWEN_THINKING), the
        // MCP extension (reads UNOWN_MCP_SERVERS) and the agentsFilesOverride
        // callback (reads UNOWN_NO_AGENTS_MD) all observe the routed values.
        applySubagentEnvOverrides(bootOpts);
        const agentDir = ensureUnownAgentDir();
        // Last-resort child hygiene (child-reaper.ts): LSP/MCP server children get
        // SIGTERM→SIGKILL on process exit and SIGINT/SIGTERM — idempotent, so every
        // bootRuntime call (TUI, print, subagents) re-installs it harmlessly.
        installChildReaper();
        const checkpointsExtension = createCheckpointsExtension({ cwd, verbose });
        const mcpExtension = createMcpExtension({ cwd, verbose });
        // One permission gate shared by the terminal hook seam (tool_call)
        // and the /permissions command, so session-scoped always-allow rules
        // and trust notices span both surfaces (docs/permissions.md).
        const permissionsGate = createPermissionGate({ cwd, strict: STRICT_HOOKS, verbose });
        const extension = createTerminalExtension({
                cwd,
                engineUrl: ENGINE_URL,
                strict: STRICT_HOOKS,
                verbose,
                permissions: permissionsGate,
        });
        const permissionsExtension = createPermissionsExtension({ cwd, verbose, gate: permissionsGate });
        const toolsExtension = createUnownToolsExtension({ cwd, engineUrl: ENGINE_URL, verbose });

        const settingsManager = SettingsManager.create(cwd, agentDir);

        // Per-project unown skills (.unown/skills/) ride alongside pi's own skill dirs.
        const projectSkillsDir = join(cwd, ".unown", "skills");
        const additionalSkillPaths = existsSync(projectSkillsDir) ? [projectSkillsDir] : undefined;

        // Custom slash commands (Claude Code / opencode command port): markdown
        // files with frontmatter (description, argument-hint) + $ARGUMENTS /
        // $1..$N substitution, discovered from the project and the agent dir.
        // pi's prompt-template loader gives us autocomplete, the /commands listing
        // and the argument grammar for free (same mechanism as .pi/prompts).
        // Not trust-gated: a command only expands when the user types its name
        // (user-initiated, like pasting text - the Claude Code .claude/commands
        // contract); the injection shield still scans anything the command
        // fetches at runtime.
        const projectCommandsDir = join(cwd, ".unown", "commands");
        const userCommandsDir = join(agentDir, "commands");
        const additionalPromptTemplatePaths = [
                ...(existsSync(projectCommandsDir) ? [projectCommandsDir] : []),
                ...(existsSync(userCommandsDir) ? [userCommandsDir] : []),
        ];

        const createRuntime: CreateAgentSessionRuntimeFactory = async ({
                cwd: sessionCwd,
                sessionManager,
                sessionStartEvent,
        }) => {
                const services = await createAgentSessionServices({
                        cwd: sessionCwd,
                        agentDir,
                        settingsManager,
                        extensionFlagValues:
                                bootOpts.plan || bootOpts.goal
                                        ? new Map<string, boolean | string>([
                                                  ...(bootOpts.plan ? ([["plan", true]] as Array<[string, boolean | string]>) : []),
                                                  ...(bootOpts.goal ? ([["goal", bootOpts.goal]] as Array<[string, boolean | string]>) : []),
                                          ])
                                        : undefined,
                        resourceLoaderOptions: {
                                extensionFactories: [
                                        checkpointsExtension as any,
                                        extension as any,
                                        toolsExtension as any,
                                        mcpExtension as any,
                                        permissionsExtension as any,
                                        ...((bootOpts.extraExtensions ?? []) as any[]),
                                ],
                                additionalSkillPaths,
                                additionalPromptTemplatePaths,
                                appendSystemPrompt: bootOpts.appendSystemPromptPath ? [bootOpts.appendSystemPromptPath] : undefined,
                                agentsFilesOverride: (base: any) => {
                                        // Milestone 2.2 — skip the per-tier AGENTS.md/memory
                                        // injection when UNOWN_NO_AGENTS_MD=1 (e.g. the
                                        // background-explore subagent, which wants minimal context
                                        // overhead). The base chain (the user's own AGENTS.md /
                                        // CLAUDE.md) is still appended.
                                        const skipInjection = process.env[SUBAGENT_NO_AGENTS_MD_ENV] === "1";
                                        const injected = skipInjection
                                                ? []
                                                : terminalMemoryForAgent(cwd).map((f) => ({ path: f.path, content: f.content }));
                                        return {
                                                // Supplement (not replace) the user's own AGENTS.md/CLAUDE.md chain.
                                                // Re-resolved per session (re)new so AutoDream's concurrent memory
                                                // updates become visible without restarting the CLI.
                                                agentsFiles: [...base.agentsFiles, ...injected],
                                        };
                                },
                        },
                });
                const created = await createAgentSessionFromServices({
                        services,
                        sessionManager,
                        sessionStartEvent,
                        tools: bootOpts.tools,
                        // Milestone 2.1 — per-session model routing. writeModelsJson
                        // never clobbers an existing models.json (setup owns it),
                        // so applySubagentEnvOverrides' PI_MODEL_ID write only
                        // matters on a FIRST-RUN seed. The --model flag's real
                        // effect is HERE: resolve the id against the same
                        // resolver pi's own CLI uses and hand the session the
                        // resolved Model. --effort maps 1:1 onto pi's
                        // ThinkingLevel (low/medium/high) on top of the
                        // BRIDGE_QWEN_THINKING env write (applySubagentEnvOverrides).
                        model: (() => {
                                if (!bootOpts.model) return undefined;
                                const resolved = resolveCliModel({
                                        cliModel: bootOpts.model,
                                        modelRuntime: services.modelRuntime,
                                });
                                if (resolved.error) {
                                        console.error(`unown: --model ${bootOpts.model}: ${resolved.error}`);
                                        return undefined;
                                }
                                return resolved.model;
                        })(),
                        thinkingLevel: bootOpts.effort,
                });
                return { ...created, services, diagnostics: services.diagnostics };
        };

        const sessionManager =
                bootOpts.sessionManager ??
                (bootOpts.noSession
                        ? SessionManager.inMemory(cwd)
                        : SessionManager.create(cwd, join(UNOWN_AGENT_DIR, "sessions")));
        const runtime = await createAgentSessionRuntime(createRuntime, { cwd, agentDir, sessionManager });
        return { runtime };
}

// ---------------------------------------------------------------------------
// Pre-flight: probe the configured model endpoint before a session starts,
// so failures come with instructions instead of a raw "Connection error."
// ---------------------------------------------------------------------------
interface PreflightProblem {
        message: string;
        hint: string;
}

async function runPreflight(): Promise<PreflightProblem | null> {
        if (process.env.UNOWN_NO_PREFLIGHT) return null;
        if (process.env.UNOWN_SUBAGENT) return null; // subagents inherit the parent's validated path
        const agentDir = ensureUnownAgentDir();
        const provider = resolveActiveProvider(agentDir);
        if (!provider || !provider.baseUrl) return null; // built-in/unknown endpoint — nothing to probe
        const probe = await probeOpenAiEndpoint(provider.baseUrl, provider.apiKey ?? undefined, 4000);
        if (probe.ok) return null;
        if (probe.problem === "auth") {
                return {
                        message: `the model endpoint rejected the credentials (${provider.baseUrl}, HTTP ${probe.status}).`,
                        hint: "check the API key in ~/.unown/agent/auth.json (or models.json) — or re-run: unown setup",
                };
        }
        return {
                message: `cannot reach the model endpoint at ${provider.baseUrl}.`,
                hint: isLoopbackProvider(provider)
                        ? "start the stack (bun run agent:start in the Unown repo) — or connect a different provider: unown setup"
                        : "check the endpoint URL — or re-run: unown setup",
        };
}

function printFirstRunBanner(): void {
        const init = unownAgentDirInit();
        if (!init?.created) return;
        console.error(`unown: first run — using the bundled llm-bridge (${init.provider}/${init.modelId}).`);
        console.error("  connect any provider (OpenAI, OpenRouter, Anthropic, Dashscope, local): unown setup");
        console.error();
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Best-effort yes/no prompt on stdin (the unown CLI is interactive only when
 * stdin is a TTY). Non-TTY defaults to `false` — `unown init` must NEVER
 * clobber an existing AGENTS.md in CI / scripted runs without an explicit
 * `--yes` flag. Mirrors clig.dev's "default to the safe action" guidance.
 */
function promptYesNo(question: string, defaultYes: boolean): boolean {
        if (!process.stdin.isTTY) return false;
        process.stdout.write(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `);
        try {
                const fd = process.stdin.fd;
                // 1-byte read; the readSync returns the count actually read.
                const buf = Buffer.alloc(1);
                const n = require("node:fs").readSync(fd, buf, 0, 1, null);
                if (n <= 0) return defaultYes;
                const answer = buf.toString("utf8").trim().toLowerCase();
                if (answer === "") return defaultYes;
                return answer === "y" || answer === "yes";
        } catch {
                return defaultYes;
        }
}

/**
 * Write an `AGENTS.md` at `<cwd>/AGENTS.md` from repo forensics. Used by
 * `unown init` (interactive, prompts before overwriting) and `unown
 * init-agents` (writes by default unless an existing file is found).
 *
 * Returns a short status line describing the outcome. Never throws —
 * generation + write failures come back as `[error] …` strings.
 */
function writeAgentsMd(cwd: string, opts: { overwrite?: boolean; prompt?: boolean } = {}): string {
        const path = join(cwd, "AGENTS.md");
        const exists = existsSync(path);
        const overwriteOk = opts.overwrite ?? false;
        if (exists && !overwriteOk) {
                if (!opts.prompt) {
                        return `${path.replace(cwd, ".")}  exists — pass --overwrite to replace, or run \`unown init\` for the interactive prompt`;
                }
                const yes = promptYesNo(`AGENTS.md already exists at ${path.replace(cwd, ".")}. Overwrite?`, false);
                if (!yes) {
                        return `${path.replace(cwd, ".")}  kept (you declined the overwrite)`;
                }
        }
        if (!shouldOverwriteAgentsMd(path)) {
                return `${path.replace(cwd, ".")}  is a directory — refusing to overwrite`;
        }
        let md: string;
        try {
                md = generateAgentsMd(cwd);
        } catch (err: any) {
                return `[error] AGENTS.md generation failed: ${err?.message ?? err}`;
        }
        try {
                writeFileSync(path, md + "\n", { encoding: "utf8" });
        } catch (err: any) {
                return `[error] AGENTS.md write failed: ${err?.message ?? err}`;
        }
        return `${path.replace(cwd, ".")}  ${exists ? "updated (was overwritten)" : "generated"}`;
}

function cmdInit() {
        const cwd = process.cwd();
        const dir = initProjectMemory(cwd);
        console.log(`✓ initialized ${dir.replace(cwd, ".")}`);
        console.log(`  ${projectMemoryPath(cwd).replace(cwd, ".")}   project memory (commit this — AutoDream maintains it)`);
        console.log(`  ./.unown/memory/local.md            local overrides (gitignored)`);
        console.log(`  ./.unown/.gitignore                 ignores local overrides`);
        // Milestone 3.1 — also generate AGENTS.md at the project root (interactive
        // prompt before overwriting; `unown init-agents --overwrite` skips it).
        const agentsStatus = writeAgentsMd(cwd, { prompt: true });
        console.log(`✓ ${agentsStatus}`);
}

/** `unown init-agents` — generate or update AGENTS.md (Milestone 3.1). */
function cmdInitAgents(args: string[]): number {
        const cwd = process.cwd();
        const overwrite = args.includes("--overwrite") || args.includes("-f") || args.includes("--force");
        const printOnly = args.includes("--print") || args.includes("--stdout");
        const jsonOut = args.includes("--json");
        const help = args.includes("-h") || args.includes("--help");
        if (help) {
                console.log(INIT_AGENTS_HELP);
                return 0;
        }
        if (printOnly) {
                // --print: just emit the generated markdown on stdout, no file write.
                // Composes with `unown init-agents | less` or `> AGENTS.md`.
                process.stdout.write(generateAgentsMd(cwd) + "\n");
                return 0;
        }
        if (jsonOut) {
                // --json: emit the structured RepoForensics JSON for tooling.
                // Lazy import avoids pulling the type into cli.ts's surface.
                const { scanRepoForensics } = require("./init-agents.ts");
                process.stdout.write(JSON.stringify(scanRepoForensics(cwd), null, 2) + "\n");
                return 0;
        }
        const status = writeAgentsMd(cwd, { overwrite });
        const isError = status.startsWith("[error]");
        console.log(`${isError ? "✗" : "✓"} ${status}`);
        return isError ? 1 : 0;
}

/** `unown doctor-instructions` — run ONLY the instruction-set audit (Milestone 3.2). */
function cmdDoctorInstructions(args: string[]): number {
        const cwd = process.cwd();
        const json = args.includes("--json");
        const report = auditInstructionSet(cwd);
        if (json) {
                console.log(JSON.stringify(report, null, 2));
                return 0;
        }
        console.log("unown doctor-instructions — instruction-set audit");
        console.log(renderInstructionAudit(report));
        const sum = summarizeInstructionAudit(report);
        console.log(`\n  summary: ${sum.errors} error(s), ${sum.warnings} warning(s), ${sum.infos} info`);
        return sum.errors > 0 ? 1 : 0;
}

function cmdMemory() {
        const cwd = process.cwd();
        const files = resolveTerminalMemory(cwd);
        for (const f of files) {
                console.log(`──────────────────────────────────────────────────────────`);
                console.log(`【${f.tier.toUpperCase()}】 ${f.path}`);
                console.log(`──────────────────────────────────────────────────────────`);
                console.log(f.content.trimEnd());
                console.log();
        }
}

/** One doctor check in structured form — the `--json` schema (see docs/usage.md). */
interface DoctorCheck {
        id: string;
        status: "pass" | "warn" | "fail";
        detail: string;
}

async function cmdDoctor(jsonMode: boolean): Promise<number> {
        const cwd = process.cwd();
        const checks: DoctorCheck[] = [];
        let hardFail = false;
        let warnings = 0;
        const check = (label: string, pass: boolean, detail: string, level: "fail" | "warn" = "fail") => {
                const icon = pass ? "✓" : level === "warn" ? "⚠" : "✗";
                if (!jsonMode) console.log(`${icon} ${label}${detail ? ` — ${detail}` : ""}`);
                const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                checks.push({ id, status: pass ? "pass" : level, detail });
                if (!pass) {
                        if (level === "fail") hardFail = true;
                        else warnings++;
                }
        };

        // 0. version + update state (from the notifier cache — no network here;
        // refresh with `unown update --check`)
        {
                const root = resolveRepoRoot(realGit);
                const short = root ? gitShortSha(root, realGit) : null;
                check("unown version", true, `${VERSION}${short ? ` · ${short}` : ""} · ${root ?? "(not a git checkout)"}`);
                const cache = readUpdateCheckCache(UNOWN_HOME);
                if (cache?.latest && compareSemver(cache.latest, VERSION) > 0) {
                        check(
                                "update available",
                                false,
                                `v${cache.latest} — run \`unown update\` (checked ${cache.checkedAt ? describeAge(cache.checkedAt) : "?"})`,
                                "warn",
                        );
                } else {
                        check(
                                "update available",
                                true,
                                cache?.checkedAt
                                        ? `up to date as of ${describeAge(cache.checkedAt)}${cache.error ? ` (${cache.error})` : ""}`
                                        : "no check yet — run `unown update --check`",
                        );
                }
                // 0b. user-state migrations (schema version + pending count)
                {
                        const mig = readMigrationState(UNOWN_HOME);
                        const pending = MIGRATIONS.filter((m) => m.from >= mig.version).length;
                        check(
                                "user state schema",
                                true,
                                `v${mig.version}${pending ? ` — ${pending} pending (applied by the next \`unown update\`)` : ""}`,
                        );
                }
        }

        // 1. agent dir & models
        const agentDir = ensureUnownAgentDir();
        const modelsExists = existsSync(join(agentDir, "models.json"));
        check("agent dir", modelsExists, agentDir);
        const active = resolveActiveProvider(agentDir);
        if (modelsExists) {
                const file = readAgentModelsFile(agentDir);
                if (file.error) check("models.json parses", false, file.error);
                else
                        check(
                                "model provider configured",
                                file.providers.length > 0,
                                active ? `${active.id} · ${active.modelIds.join(", ") || "no models"}` : "none",
                        );
        }

        // 2. memory stack
        initProjectMemory(cwd);
        check("project memory", existsSync(projectMemoryPath(cwd)), projectMemoryPath(cwd).replace(cwd, "."));
        check("user memory", true, `${UNOWN_HOME}/memory/user.md`);

        // 3. model endpoint (the chat path — failures here break sessions)
        if (active?.baseUrl) {
                const probe = await probeOpenAiEndpoint(active.baseUrl, active.apiKey ?? undefined, 4000);
                const serving =
                        probe.models && probe.models.length > 0
                                ? ` · serves ${probe.models.slice(0, 4).join(", ")}${probe.models.length > 4 ? " …" : ""}`
                                : "";
                if (probe.ok) {
                        check("model endpoint reachable", true, `${active.baseUrl}${serving}`);
                } else if (probe.problem === "auth") {
                        check(
                                "model endpoint reachable",
                                false,
                                `credentials rejected (HTTP ${probe.status}) — check the key in ~/.unown/agent/auth.json or run: unown setup`,
                        );
                } else {
                        check(
                                "model endpoint reachable",
                                false,
                                `${active.baseUrl} unreachable — ${
                                        isLoopbackProvider(active)
                                                ? "start the stack (bun run agent:start) or run: unown setup"
                                                : "check the URL or run: unown setup"
                                }`,
                        );
                }
                // 3b. bridge specifics: upstream key, upstream health, routable model
                if (isLoopbackProvider(active)) {
                        try {
                                const res = await fetch(`${active.baseUrl.replace(/\/v1\/?$/, "")}/health`, {
                                        signal: AbortSignal.timeout(4000),
                                });
                                if (res.ok) {
                                        const body = (await res.json()) as {
                                                requests?: number;
                                                errors?: number;
                                                upstream?: { ok?: boolean; status?: number };
                                                upstreamKeyIsSet?: boolean;
                                                defaultModel?: string;
                                                models?: string[];
                                        };
                                        check(
                                                "bridge upstream key",
                                                body.upstreamKeyIsSet !== false,
                                                body.upstreamKeyIsSet === false
                                                        ? "BRIDGE_UPSTREAM_KEY is not set in the repo's .env — chats will fail with 401"
                                                        : "BRIDGE_UPSTREAM_KEY set",
                                        );
                                        check(
                                                "bridge upstream health",
                                                body.upstream?.ok !== false,
                                                body.upstream?.ok === false
                                                        ? `upstream unhealthy (${body.upstream.status ?? "no answer"}) — check BRIDGE_UPSTREAM_URL`
                                                        : `${body.requests ?? 0} requests, ${body.errors ?? 0} errors`,
                                        );
                                        const model = active.modelIds[0];
                                        if (model && Array.isArray(body.models) && body.models.length > 0 && !body.models.includes(model)) {
                                                check(
                                                        "default model routable",
                                                        false,
                                                        `"${model}" is not in the bridge allow-list (BRIDGE_KNOWN_MODELS) — requests route to ${
                                                                body.defaultModel ?? "the default"
                                                        }`,
                                                        "warn",
                                                );
                                        }
                                }
                        } catch {
                                // the endpoint probe above already reported reachability
                        }
                }
        } else if (modelsExists) {
                check(
                        "model endpoint reachable",
                        false,
                        "the configured provider declares no baseUrl — fix ~/.unown/agent/models.json or run: unown setup",
                );
        }

        // 4. OS sandbox — fs + network isolation for engine runs. Platform-aware:
        // Linux checks bubblewrap, macOS checks seatbelt (sandbox-exec), and
        // Windows reports the native-Windows story (path-jail fallback there —
        // the same degradation Claude Code ships on native Windows). Always a
        // non-fatal warning.
        {
                const osb = await osSandboxAvailable();
                const name =
                        process.platform === "darwin"
                                ? "OS sandbox (seatbelt)"
                                : process.platform === "win32"
                                        ? "OS sandbox (Windows)"
                                        : "OS sandbox (bubblewrap)";
                const unavailable =
                        process.platform === "darwin"
                                ? "sandbox-exec unavailable — engine runs use the path jail"
                                : process.platform === "win32"
                                        ? "not available on native Windows — engine runs use the path jail (same as Claude Code's Windows story)"
                                        : "unavailable — engine runs fall back to the path jail";
                const detail =
                        process.platform === "darwin"
                                ? `${resolveSandboxExecPath()} — fs isolation active (seatbelt profile${netBlocked() ? "; network denied" : "; network shared"})`
                                : `${resolveBwrapPath()} — fs+net isolation active`;
                check(name, osb, osb ? detail : unavailable, "warn");
        }

        // 5. engine health (notes + dreams + dashboard) — chat works without it;
        // session notes just queue in the outbox until it returns.
        try {
                const res = await fetch(`${ENGINE_URL}/api/overview`, { signal: AbortSignal.timeout(3000) });
                const body: any = await res.json();
                check(
                        "self-learning engine",
                        res.ok && body.ok,
                        `${body?.kpis?.totalRuns ?? "?"} runs, ${body?.kpis?.dreams ?? "?"} dreams`,
                );
        } catch {
                check(
                        "self-learning engine",
                        false,
                        `unreachable — learning paused, chat unaffected; notes queue in ${UNOWN_HOME}/notes/outbox`,
                        "warn",
                );
        }

        // 6. SDLC surfaces (P1 productization — research R-c §2): LSP servers,
        //    MCP config health (incl. the project trust gate) and .unown disk
        //    usage. ALL warn-level by doctor's contract: the chat path is the
        //    only hard-fail, every optional feature degrades to a warning.
        {
                // 6a. LSP servers — the DEFAULT_SERVERS registry probed on PATH
                // (commandExists is a pure fs probe — no spawning here).
                const detected: string[] = [];
                for (const spec of DEFAULT_SERVERS) {
                        if (spec.candidates.some((candidate) => commandExists(candidate[0]))) detected.push(spec.label);
                }
                check(
                        "LSP servers",
                        detected.length > 0,
                        detected.length > 0
                                ? `${detected.join(", ")} on PATH`
                                : "none detected — LSP diagnostics inactive (optional; install a server or configure .unown/lsp.json)",
                        "warn",
                );

                // 6b. MCP config — the merged user+project config with its
                // validation problems and trust gate surfaced actionably.
                const mcp = resolveMcpConfig(cwd);
                const mcpNames = Object.keys(mcp.config.servers);
                const gated = Object.keys(mcp.gatedServers).length;
                const serverDetail = `${mcpNames.length} server(s)${
                        mcpNames.length > 0 ? `: ${mcpNames.slice(0, 5).join(", ")}${mcpNames.length > 5 ? " …" : ""}` : ""
                }${gated > 0 ? ` · ${gated} withheld (untrusted project config)` : ""}`;
                if (mcp.needsTrust) {
                        // Surface a validation problem too when one exists (the
                        // gate problem itself is the message; formatConfigProblem
                        // on it would be redundant).
                        const validationProblem = mcp.problems.find((p) => !p.message.startsWith("project mcp.json is untrusted"));
                        check(
                                "MCP config",
                                false,
                                `project .unown/mcp.json untrusted — run /mcp trust in a session (${serverDetail})${
                                        validationProblem ? ` · also: ${formatConfigProblem(validationProblem)}` : ""
                                }`,
                                "warn",
                        );
                } else if (mcp.problems.length > 0) {
                        check(
                                "MCP config",
                                false,
                                `${formatConfigProblem(mcp.problems[0])}${mcp.problems.length > 1 ? ` (+${mcp.problems.length - 1} more)` : ""} · ${serverDetail}`,
                                "warn",
                        );
                } else {
                        check("MCP config", true, mcpNames.length > 0 ? serverDetail : "no servers configured (optional — unown mcp add)");
                }

                // 6c. unown state — checkpoint blob store size + receipts +
                // reviews counts under <cwd>/.unown/. Warns past
                // UNOWN_STATE_WARN_BYTES (default 512 MiB; tolerant parse —
                // same pattern as UNOWN_CHECKPOINT_MAX_BLOB_BYTES, tests pin
                // it without re-importing the module).
                const store = new CheckpointStore(checkpointsDir(cwd));
                const blobs = store.sizeBytes();
                const manifests = store.list().length;
                const countFiles = (dir: string): number => {
                        try {
                                return readdirSync(dir).length;
                        } catch {
                                return 0; // missing/unreadable — no state there yet
                        }
                };
                const receipts = countFiles(receiptsDir(cwd));
                const reviews = countFiles(join(cwd, ".unown", "reviews"));
                const rawWarn = Number.parseInt(process.env.UNOWN_STATE_WARN_BYTES ?? "", 10);
                const warnBytes = Number.isFinite(rawWarn) && rawWarn > 0 ? rawWarn : 512 * 1024 * 1024;
                const formatBytes = (n: number): string =>
                        n >= 1024 ** 3
                                ? `${(n / 1024 ** 3).toFixed(1)} GiB`
                                : n >= 1024 ** 2
                                          ? `${(n / 1024 ** 2).toFixed(1)} MiB`
                                          : n >= 1024
                                                    ? `${Math.max(1, Math.round(n / 1024))} KiB`
                                                    : `${n} B`;
                const hasState = blobs > 0 || manifests > 0 || receipts > 0 || reviews > 0;
                const stateDetail = hasState
                        ? `${manifests} checkpoint(s), ${formatBytes(blobs)} blobs · ${receipts} receipt file(s) · ${reviews} review(s)`
                        : "no .unown state yet (checkpoints/receipts/reviews appear as sessions run)";
                check(
                        "unown state",
                        blobs <= warnBytes,
                        blobs <= warnBytes
                                ? stateDetail
                                : `${stateDetail} — over ${formatBytes(warnBytes)}: consider pruning old checkpoints (/undo consumes turn checkpoints; retention caps apply; UNOWN_STATE_WARN_BYTES adjusts this threshold)`,
                        "warn",
                );
                // 6d. granular permissions (Claude Code/Cline port) — config
                //     files, mode, trust gate and learn state. Warn-level by
                //     doctor's contract: a missing config is the documented
                //     default (hard-coded guardrails alone), never a failure.
                {
                        const pd = permissionsDoctorSummary(cwd, agentDir);
                        check("permissions config", pd.ok, pd.detail, "warn");
                }
        }

        // 7. PATH shim shadowing — a foreign `unown` earlier on PATH is this
        // repo's OWN observed failure mode (the E2E suite once re-pointed the
        // shim at a throwaway clone and "unown" kept silently being that one).
        // findShims orders by PATH precedence; the FIRST hit is what you get.
        {
                const root = resolveRepoRoot(realGit);
                if (root) {
                        const shims = findShims(root);
                        const first = shims[0];
                        if (!first) {
                                check("PATH shim", true, "no shim on PATH — running from the repo checkout directly", "warn");
                        } else if (first.ours) {
                                check("PATH shim", true, first.path);
                        } else {
                                check(
                                        "PATH shim",
                                        false,
                                        `shadowed: ${first.path} runs ${first.target ?? "another install"} — this checkout's unown is NOT first on PATH; fix the PATH order or remove the foreign shim`,
                                        "warn",
                                );
                        }
                }
        }

        // 8. Instruction-set audit (Milestone 3.2 — Claude Code's `/doctor`
        //    prompt-audit port). Extends doctor with an audit of the
        //    human-authored artifacts that steer the agent: AGENTS.md freshness,
        //    skills coverage, MCP orphan servers, hooks schema, adversary mode,
        //    injection scanner, and cross-file references. Always warn-class —
        //    broken hooks/skills don't break chat (the existing contract).
        const instructionReport = auditInstructionSet(cwd);
        const instructionSummary = summarizeInstructionAudit(instructionReport);
        const instructionClean = instructionSummary.errors === 0 && instructionSummary.warnings === 0;
        if (jsonMode) {
                // surfaced in the JSON envelope below under `instructionAudit`
        } else {
                // Render the 7 sections inline; errors use ⚠/✗ so the existing
                // "ready to chat" summary's icon vocabulary stays consistent.
                if (!instructionClean || instructionSummary.infos > 0) {
                        console.log(renderInstructionAudit(instructionReport));
                }
        }
        check(
                "instruction-set audit",
                instructionSummary.errors === 0,
                instructionSummary.errors > 0
                        ? `${instructionSummary.errors} error(s), ${instructionSummary.warnings} warning(s) — run \`unown doctor-instructions\` for the full report`
                        : instructionSummary.warnings > 0
                                ? `${instructionSummary.warnings} warning(s), ${instructionSummary.infos} info — run \`unown doctor-instructions\` for the full report`
                                : instructionSummary.infos > 0
                                        ? `${instructionSummary.infos} info note(s) — run \`unown doctor-instructions\` for the full report`
                                        : "clean (AGENTS.md, skills, MCP, hooks, adversary, injection scanner)",
                "warn",
        );

        if (jsonMode) {
                console.log(
                        JSON.stringify(
                                {
                                        ok: !hardFail,
                                        version: VERSION,
                                        cwd,
                                        agentDir,
                                        engineUrl: ENGINE_URL,
                                        strictHooks: STRICT_HOOKS,
                                        checks,
                                        instructionAudit: instructionReport,
                                        summary: {
                                                hardFail,
                                                warnings,
                                                instructionErrors: instructionSummary.errors,
                                                instructionWarnings: instructionSummary.warnings,
                                        },
                                },
                                null,
                                2,
                        ),
                );
                process.exit(hardFail ? 1 : 0);
        }
        if (hardFail)
                console.log(
                        `\n✗ unown cannot chat yet — fix the ✗ items above (unown setup, unown --help, docs/troubleshooting.md)`,
                );
        else if (warnings > 0) console.log(`\n✓ unown is ready to chat in ${cwd} (⚠ items affect learning features only)`);
        else console.log(`\n✓ unown is ready in ${cwd}`);
        process.exit(hardFail ? 1 : 0);
}

async function cmdNote(text: string) {
        if (!text.trim()) {
                console.error('usage: unown note "something worth remembering"');
                process.exit(1);
        }
        const result = await deliverTerminalNote({ content: text, projectPath: process.cwd(), ts: Date.now() });
        console.log(
                result.delivered
                        ? `✓ note delivered to the engine`
                        : `· engine unreachable — note queued in outbox (${result.detail ?? ""})`,
        );
        process.exit(0);
}

async function cmdPrint(prompt: string | undefined, args: CliArgs, verbose: boolean) {
        const cwd = process.cwd();
        // Pre-flight: fail fast with instructions when the model endpoint is
        // unreachable or rejects credentials (stderr — stdout may carry the
        // JSON event stream in --mode json).
        ensureUnownAgentDirInfo();
        maybeShowUpdateNotice();
        const pre = await runPreflight();
        printFirstRunBanner();
        if (pre) {
                console.error(`unown: ${pre.message}`);
                console.error(`  → ${pre.hint}`);
                console.error("  (set UNOWN_NO_PREFLIGHT=1 to skip this check)");
                process.exit(1);
        }
        // Piped stdin (e.g. `cat error.log | unown -p "fix this"`) joins the prompt.
        let piped = "";
        if (!process.stdin.isTTY) {
                piped = await new Promise<string>((resolveStdin) => {
                        let data = "";
                        process.stdin.setEncoding("utf8");
                        process.stdin.on("data", (c) => {
                                data += c;
                        });
                        process.stdin.on("end", () => resolveStdin(data));
                        setTimeout(() => resolveStdin(data), 500); // short pipe timeout
                });
        }
        const message = [prompt, piped.trim()].filter(Boolean).join("\n\n");
        if (!message) {
                console.error("unown: no prompt given (pass one or pipe stdin)");
                process.exit(1);
        }
        // --output-format json (Claude Code port): one final JSON object with
        // the result AND the accounting. The text channel is captured, not
        // printed; preflight errors stay on stderr (exit 1) exactly as before.
        // Mutually exclusive with --mode json (the JSONL event stream) — Claude
        // Code errors on the same combination rather than silently picking one.
        if (args.outputFormat === "json" && args.jsonMode) {
                console.error("unown: --output-format json cannot be combined with --mode json (the event stream)");
                process.exit(2);
        }
        const wantResultJson = args.outputFormat === "json" && !args.jsonMode;
        const capture = wantResultJson ? createOutputCapture() : undefined;
        const startedAt = wantResultJson ? Date.now() : 0;
        const { runtime } = await bootRuntime(cwd, verbose, {
                jsonMode: args.jsonMode,
                noSession: args.noSession,
                tools: args.tools,
                appendSystemPromptPath: args.appendSystemPromptPath,
                plan: args.plan,
                goal: args.goal,
                extraExtensions: capture ? [createOutputCaptureExtension(capture)] : undefined,
                // Milestone 2.1 + 2.2 — surface the routing fields (set by
                // parseSubagentFlags inside parseArgs). bootRuntime applies
                // them to process.env via applySubagentEnvOverrides BEFORE
                // the session is created.
                model: args.model,
                effort: args.effort,
                mcpServers: args.mcpServers,
                noAgentsMd: args.noAgentsMd,
        });
        if (wantResultJson && capture) {
                const wrap = captureStdout();
                let code = 0;
                try {
                        code = await runPrintMode(runtime as any, { mode: "text", messages: [message] });
                } finally {
                        const text = wrap.unwrap().trim();
                        // --no-session: the id names an ephemeral in-memory
                        // session — nothing to resume, so the contract says null.
                        if (args.noSession) capture.sessionId = null;
                        const result = assembleResultJson({
                                capture,
                                text,
                                subtype: code === 0 ? "success" : "error_during_execution",
                                durationMs: Date.now() - startedAt,
                                version: VERSION,
                        });
                        process.stdout.write(JSON.stringify(result) + "\n");
                }
                process.exit(code);
        }
        const code = await runPrintMode(runtime as any, { mode: args.jsonMode ? "json" : "text", messages: [message] });
        process.exit(code);
}

async function cmdTui(prompt: string | undefined, verbose: boolean, bootOpts: BootOptions = {}) {
        const cwd = process.cwd();
        ensureUnownAgentDirInfo();
        maybeShowUpdateNotice();
        const pre = await runPreflight();
        printFirstRunBanner();
        if (pre) {
                // Warn and continue: the user may start the stack in another
                // terminal — pi's built-in retries cover that window.
                console.log(`⚠ pre-flight: ${pre.message}`);
                console.log(`  → ${pre.hint}`);
                console.log();
        }
        const { runtime } = await bootRuntime(cwd, verbose, bootOpts);
        const mode = new InteractiveMode(runtime as any, prompt ? { initialMessage: prompt } : {});
        await mode.run(); // blocks until exit; normal exit path is process.exit(0)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
const DOCTOR_HELP = `unown doctor — diagnose configuration, bridge, engine and memory

Checks the agent-home layout, model configuration, the chat path (the only
hard-fail: a broken chat path), engine health, memory materialization, the
PATH shims, and the SDLC surfaces (LSP servers on PATH, MCP config health
incl. the project trust gate, .unown disk usage — all warn-level: chat works
without them). Every failure carries an actionable hint.

usage: unown doctor [--json]
  --json   machine-readable DoctorCheck[] (schema: docs/usage.md)
`;

const INFO_HELP = `unown info — print the support bundle

Environment, versions, configuration and health endpoints, redacted for
sharing (secrets never printed; auth.json never read).

usage: unown info [--json]
  --json   machine-readable support bundle
`;

const INIT_AGENTS_HELP = `unown init-agents — generate or update AGENTS.md (Milestone 3.1)

Reverse-engineered from opencode's /init plugin and Claude Code's /init skill.
Scans the repo for package.json / pyproject.toml / Cargo.toml / go.mod /
biome.json / .eslintrc / vitest / pytest / etc., then writes an AGENTS.md at
the project root following https://agents.md/ — the file other coding agents
(Cursor, Claude Code, opencode, cline) read.

usage: unown init-agents [--overwrite] [--print] [--json] [-h]
  --overwrite   replace an existing AGENTS.md (default: refuse to clobber)
  -f, --force   alias for --overwrite
  --print       write the generated markdown to stdout (no file write)
  --stdout      alias for --print
  --json        emit the structured RepoForensics JSON to stdout (no file write)
  -h, --help    this help

Other coding agents consume the result. \`unown init\` runs the same generator
interactively (prompts before overwriting).
`;

const DOCTOR_INSTRUCTIONS_HELP = `unown doctor-instructions — instruction-set audit (Milestone 3.2)

Audits the human-authored artifacts that steer the agent: AGENTS.md freshness
(references that no longer resolve), skills coverage (\`.unown/skills/<name>/SKILL.md\`
frontmatter + overlap), MCP config (parseability + orphaned server binaries),
hooks schema (\`.unown/hooks.json\` + \`~/.unown/agent/hooks.json\`), adversary mode
gate file, injection scanner config, and cross-file references. Always warn-class
— broken hooks/skills don't break chat.

usage: unown doctor-instructions [--json] [-h]
  --json   machine-readable InstructionAuditReport
  -h, --help   this help

\`unown doctor\` runs this audit too (and prints it inline) along with the rest
of its checks. This command runs ONLY the instruction audit.
`;

/** clig.dev: `help` is a command too — the word used to fall through to the
 * generic parser and start a TUI with "help" as the prompt. */
function cmdHelp(topics: string[]): number {
        if (topics.length === 0) {
                console.log(HELP);
                return 0;
        }
        const topic = topics[0];
        const pages: Record<string, string> = {
                doctor: DOCTOR_HELP,
                mcp: MCP_HELP,
                info: INFO_HELP,
                update: UPDATE_HELP,
                uninstall: UNINSTALL_HELP,
                completions: COMPLETIONS_HELP,
                setup: SETUP_USAGE,
                acp: ACP_HELP,
                "init-agents": INIT_AGENTS_HELP,
                "doctor-instructions": DOCTOR_INSTRUCTIONS_HELP,
                automations: AUTOMATIONS_USAGE,
                usage: USAGE_HELP,
                sessions: SESSIONS_USAGE,
                recipes: RECIPES_USAGE,
                wiki: WIKI_USAGE,
        };
        const page = pages[topic];
        if (!page) {
                console.error(`unown help: unknown command "${topic}"`);
                console.error("Run `unown --help` for the command list.");
                return 1;
        }
        console.log(page);
        return 0;
}

export async function runCli(argv: string[]) {
        // `setup`, `models`, `update`, `changelog`, `info`, `completions`,
        // `uninstall`, `doctor` and `mcp` own their own flag grammar — dispatch
        // before the generic parser would eat their flags as prompt text.
        const first = argv[0];
        // `unown help [command]` — clig.dev: help is a command, not a TUI prompt.
        if (first === "help") process.exit(cmdHelp(argv.slice(1)));
        if (first === "setup") process.exit(await runSetupCommand(argv.slice(1)));
        if (first === "models") {
                await printModelsOverview();
                process.exit(0);
        }
        if (first === "doctor") {
                const rest = argv.slice(1);
                const unknown = rest.filter((a) => a !== "--json" && a !== "-h" && a !== "--help");
                if (unknown.length) {
                        console.error(`unown doctor: unknown argument(s): ${unknown.join(" ")}`);
                        process.exit(1);
                }
                // clig.dev: --help never RUNS the command (diagnostics used to execute
                // instead of helping).
                if (rest.includes("-h") || rest.includes("--help")) {
                        console.log(DOCTOR_HELP);
                        process.exit(0);
                }
                process.exit(await cmdDoctor(rest.includes("--json")));
        }
        if (first === "info") {
                const rest = argv.slice(1);
                const unknown = rest.filter((a) => a !== "--json" && a !== "-h" && a !== "--help");
                if (unknown.length) {
                        console.error(`unown info: unknown argument(s): ${unknown.join(" ")}`);
                        process.exit(1);
                }
                if (rest.includes("-h") || rest.includes("--help")) {
                        console.log(INFO_HELP);
                        process.exit(0);
                }
                process.exit(cmdInfo(rest.includes("--json")));
        }
        if (first === "init-agents") {
                // Milestone 3.1 — `unown init-agents` owns its own flag grammar
                // (--overwrite / --print / --json); dispatch before the generic
                // parser would eat the flags as prompt text.
                process.exit(cmdInitAgents(argv.slice(1)));
        }
        if (first === "doctor-instructions") {
                // Milestone 3.2 — `unown doctor-instructions` owns its own flag
                // grammar (--json); dispatch before the generic parser.
                const rest = argv.slice(1);
                const unknown = rest.filter((a) => a !== "--json" && a !== "-h" && a !== "--help");
                if (unknown.length) {
                        console.error(`unown doctor-instructions: unknown argument(s): ${unknown.join(" ")}`);
                        process.exit(1);
                }
                if (rest.includes("-h") || rest.includes("--help")) {
                        console.log(DOCTOR_INSTRUCTIONS_HELP);
                        process.exit(0);
                }
                process.exit(cmdDoctorInstructions(rest));
        }
        if (first === "mcp") {
                // P1 (R-c): Claude Code-style MCP config management — see mcp-cli.ts.
                // -h/--help inside the subcommand grammar is handled there too.
                const result = await runMcpCommand(argv.slice(1), { cwd: process.cwd(), userDir: UNOWN_AGENT_DIR });
                if (result.stdout) process.stdout.write(result.stdout);
                if (result.stderr) process.stderr.write(result.stderr);
                process.exit(result.exitCode);
        }
        if (first === "automations") {
                // zcode port: scheduled recurring agent runs — see automations-cli.ts.
                const result = await runAutomationsCommand(argv.slice(1), { cwd: process.cwd() });
                if (result.stdout) process.stdout.write(result.stdout);
                if (result.stderr) process.stderr.write(result.stderr);
                process.exit(result.exitCode);
        }
        if (first === "usage") {
                // opencode/Cursor-style usage & cost report — see usage-cli.ts.
                const result = await runUsageCommand(argv.slice(1));
                if (result.stdout) process.stdout.write(result.stdout);
                if (result.stderr) process.stderr.write(result.stderr);
                process.exit(result.exitCode);
        }
        if (first === "sessions") {
                // Milestone 3.5 — `unown sessions export|import|list` (the
                // opencode session/transfer.ts port). Dispatch before the
                // generic parser would eat subcommand tokens as prompt text.
                const code = await runSessionsCommand(argv.slice(1));
                process.exit(code);
        }
        if (first === "recipes") {
                // Milestone 4.1 — `unown recipes list|run|create|validate` (the
                // goose Recipes port). Dispatch before the generic parser would
                // eat subcommand tokens as prompt text.
                const code = await runRecipesCommand(argv.slice(1));
                process.exit(code);
        }
        if (first === "wiki") {
                // Milestone 4.2 — `unown wiki generate|search|list|show` (the
                // zcode Repo Wiki port). Dispatch before the generic parser would
                // eat subcommand tokens as prompt text.
                const code = await runWikiCommand(argv.slice(1));
                process.exit(code);
        }
        if (first === "completions") process.exit(cmdCompletions(argv.slice(1)));
        if (first === "acp") {
                // The ACP editor server (Zed et al.): stdio JSON-RPC. Own flag
                // grammar like mcp/automations — dispatch before the generic
                // parser would eat flags as prompt text.
                const rest = argv.slice(1);
                const verbose = rest.includes("--verbose") || rest.includes("-v");
                if (rest.includes("-h") || rest.includes("--help")) {
                        console.log(ACP_HELP);
                        process.exit(0);
                }
                const unknown = rest.filter((a) => a !== "--verbose" && a !== "-v");
                if (unknown.length) {
                        console.error(`unown acp: unknown argument(s): ${unknown.join(" ")}`);
                        console.error("usage: unown acp [--verbose]");
                        process.exit(1);
                }
                ensureUnownAgentDir(); // silent scaffold — no banners: stdout is protocol
                await runAcpServer({
                        boot: (cwd, v, bootOpts) => bootRuntime(cwd, v, bootOpts as BootOptions),
                        agentName: "unown",
                        agentVersion: VERSION,
                        verbose,
                });
                process.exit(0); // unreachable — runAcpServer exits on stdin EOF/signals
        }
        if (first === "uninstall") {
                const { flags, error } = parseUninstallFlags(argv.slice(1));
                if (error) {
                        console.error(`unown uninstall: ${error}`);
                        console.error("usage: unown uninstall [--dry-run] [--purge-data] [--purge-checkout]");
                        process.exit(1);
                }
                if (flags.help) {
                        console.log(UNINSTALL_HELP);
                        process.exit(0);
                }
                process.exit(cmdUninstall(flags));
        }
        // `update` and `changelog` likewise (update owns --check/--json/etc).
        if (first === "update") {
                const { flags, error } = parseUpdateFlags(argv.slice(1));
                if (error) {
                        console.error(`unown update: ${error}`);
                        console.error("usage: unown update [--check] [--json] [--allow-dirty] [--rollback] [version]");
                        process.exit(1);
                }
                if (flags.help) {
                        console.log(UPDATE_HELP);
                        process.exit(0);
                }
                process.exit(await cmdUpdate(flags));
        }
        if (first === "changelog") process.exit(cmdChangelog(argv.slice(1)));
        // Version surface: the ROOT package.json is the single source of
        // truth (the self-learning package carries its own 0.x number); CI
        // asserts `unown --version` === package.json.version on every run.
        if (argv.includes("--version") || argv.includes("-V")) {
                console.log(VERSION);
                process.exit(0);
        }
        const args = parseArgs(argv);
        switch (args.command) {
                case "help":
                        console.log(HELP);
                        process.exit(0);
                        break;
                case "init":
                        cmdInit();
                        process.exit(0);
                        break;
                case "memory":
                        cmdMemory();
                        process.exit(0);
                        break;
                case "note":
                        await cmdNote(args.prompt ?? "");
                        break;
                case "print":
                        await cmdPrint(args.prompt, args, args.verbose);
                        break;
                case "tui":
                        // Claude Code parity: --output-format is a print-mode
                        // contract; in the TUI there is no final object to emit.
                        if (args.outputFormat === "json") {
                                console.error("unown: --output-format json requires print mode (-p)");
                                process.exit(2);
                        }
                        await cmdTui(args.prompt, args.verbose, {
                                tools: args.tools,
                                appendSystemPromptPath: args.appendSystemPromptPath,
                                plan: args.plan,
                                goal: args.goal,
                                // Milestone 2.1 + 2.2 — surface the routing fields
                                // (set by parseSubagentFlags inside parseArgs) into
                                // the TUI boot path so applySubagentEnvOverrides
                                // (called inside bootRuntime) honors them.
                                model: args.model,
                                effort: args.effort,
                                mcpServers: args.mcpServers,
                                noAgentsMd: args.noAgentsMd,
                        });
                        break;
        }
}
