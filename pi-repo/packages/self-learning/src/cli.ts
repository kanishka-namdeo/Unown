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
import { ACP_HELP, runAcpServer } from "./acp.ts";
import { createUnownAddonsExtension } from "./addons/index.ts";
import { AUTOMATIONS_USAGE, runAutomationsCommand } from "./automations-cli.ts";
import { blameFile, blameSummary, formatBlameJson, formatBlameReport } from "./blame.ts";
import { netBlocked, osSandboxAvailable, resolveBwrapPath, resolveSandboxExecPath } from "./bwrap.ts";
import { CheckpointStore, checkpointsDir, createCheckpointsExtension, receiptsDir } from "./checkpoints.ts";
import { installChildReaper } from "./child-reaper.ts";
import { COMPLETIONS_HELP, cmdCompletions } from "./completions.ts";
import { DASHBOARD_HELP, runDashboardCommand } from "./dashboard/dashboard-boot.ts";
import { auditInstructionSet, renderInstructionAudit, summarizeInstructionAudit } from "./doctor-instructions.ts";
import { engineFetch } from "./engine-auth.ts";
import { runEngineCommand } from "./engine-cli.ts";
import { readSpawnState } from "./engine-supervisor.ts";
import { agentGitSha, codeMtimeMs, compareEngineBuild } from "./engine-version.ts";
import { createFleetChildExtension } from "./fleet-child.ts";
import { FLEET_DRAIN_SENTINEL } from "./fleet-runtime.ts";
import { createFirstFlightsExtension } from "./flights.ts";
import { cmdInfo } from "./info.ts";
import { generateAgentsMd, shouldOverwriteAgentsMd } from "./init-agents.ts";
import { bridgeHealth } from "./llm.ts";
import { commandExists, DEFAULT_SERVERS } from "./lsp.ts";
import { createMcpExtension, formatConfigProblem, resolveMcpConfig } from "./mcp.ts";
import { MCP_HELP, runMcpCommand } from "./mcp-cli.ts";
import { assistantTextOf } from "./messages.ts";
import { MIGRATIONS, readMigrationState } from "./migrations.ts";
import { emitOsc9, notifyGated, notifyThresholdMs, shouldNotifyOnAnswer, truncateForNotify } from "./notify.ts";
import {
        assembleResultJson,
        captureStdout,
        createOutputCapture,
        createOutputCaptureExtension,
} from "./output-format.ts";
import { unownVersion } from "./packaging.ts";
import { createPermissionGate, createPermissionsExtension, permissionsDoctorSummary } from "./permissions.ts";
import { isLoopbackProvider, probeOpenAiEndpoint, readAgentModelsFile, resolveActiveProvider } from "./probe.ts";
import { keyStatusLabel, listProviders, resolveProviderKey } from "./providers.ts";
import { PROVIDERS_HELP, runProvidersCommand } from "./providers-cli.ts";
import { RECIPES_USAGE, runRecipesCommand } from "./recipes-cli.ts";
import { defaultSessionTools } from "./session-tools.ts";
import { runSessionsCommand, SESSIONS_USAGE } from "./sessions-cli.ts";
import { printModelsOverview, runSetupCommand, SETUP_USAGE } from "./setup.ts";
import { createSplitViewExtension } from "./splitview.ts";
import {
        applyEffortToEnv,
        parseSubagentFlags,
        SUBAGENT_MCP_SERVERS_ENV,
        SUBAGENT_MODEL_ENV,
        SUBAGENT_NO_AGENTS_MD_ENV,
        type SubagentEffort,
} from "./subagent-routing.ts";
import {
        deliverTerminalNote,
        ENGINE_URL,
        ensureUnownAgentDirAsync,
        ensureUnownAgentDirInfoAsync,
        initProjectMemory,
        outboxStats,
        projectMemoryPath,
        resolveTerminalMemory,
        STRICT_HOOKS,
        terminalMemoryForAgent,
        UNOWN_AGENT_DIR,
        UNOWN_HOME,
        unownAgentDirInit,
} from "./term.ts";
import { createTerminalExtension } from "./termhooks.ts";
import { createUnownToolsExtension } from "./tools.ts";
import { cmdUninstall, findShims, parseUninstallFlags, UNINSTALL_HELP } from "./uninstall.ts";
import {
        cmdChangelog,
        cmdUpdate,
        compareSemver,
        describeAge,
        formatUpdateSize,
        gitShortSha,
        maybeShowUpdateNotice,
        parseUpdateFlags,
        readUpdateCheckCache,
        readUpdatePrefs,
        realGit,
        resolveInstallInfo,
        resolveRepoRoot,
        UPDATE_HELP,
} from "./update.ts";
import { runUsageCommand, USAGE_HELP } from "./usage-cli.ts";
import { WATCH_USAGE, runWatchCommand } from "./watch-cli.ts";
import { runRepomapCliCommand } from "./repomap/repomap-cli.ts";
import { RALPH_USAGE, runRalphCommand } from "./ralph-cli.ts";
import { webCacheClear, webCacheStats, webCacheSweep } from "./webcache.ts";
import { runWikiCommand, WIKI_USAGE } from "./wiki-cli.ts";

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
                           dashscope, deepseek, agnes, custom (any OpenAI-compatible)
  unown setup --provider openai --api-key sk-... --model gpt-4o
                           non-interactive (--force resets, --list shows presets)
  unown providers <sub>   manage the multi-provider registry (M1):
                           list | add | remove | key | default | test |
                           refresh — adding a provider KEEPS the existing ones
  unown models             list configured models (+ what a local bridge serves)
  unown init               scaffold .unown/ project memory
  unown init-agents        generate or update AGENTS.md (Milestone 3.1)
                           (--overwrite, --print, --json; reverse-engineered
                           from opencode /init + Claude Code /init)
  unown memory             print the effective memory stack
  unown dashboard [screen] the TUI mission control for the learning memory
                           system (alias: dash) — screens: overview, memory,
                           dreams, notes, skills, lab, hooks, router,
                           gateway, routines, webcache (providers live
                           in "unown providers" + /providers);
                           live SSE feed, rollbacks, dream runs (see
                           docs/tui-dashboard-plan.md)
  unown doctor             run configuration diagnostics (--json: machine-readable)
  unown doctor-instructions  run ONLY the instruction-set audit
                           (AGENTS.md freshness, skills, MCP, hooks, adversary,
                           injection scanner — Milestone 3.2; --json)
  unown mcp <sub>         manage MCP servers: add | add-http | add-json |
                           list | get | remove | test | elicitation
                           (see 'unown help mcp')
  unown routines <sub>   scheduled recurring agent runs — list | create |
                           edit | pause | resume | run | skip | snooze |
                           history | delete — schedules: cron, "every 2d at
                           09:00", "after 3d" (from completion), one-shot;
                           per-routine timezone + misfire policy; needs the
                           engine; default mode read-only
                           (alias: unown automations)
  unown watch <sub>      AI comments in code, resolved by the always-on
                           engine (aider's --watch-files semantics): list |
                           run | roots — markers # AI: · # AI! · # AI? (also
                           //, --, ; per language); projects opt in via
                           .unown/watch.json; default mode report (read-only)
                           (see docs/watch.md)
  unown repomap [path]   the graph-ranked repo map (aider's repomap, on
                           tree-sitter): symbols + reference ranking in a
                           token budget — fresh subagents get one
                           automatically; --tokens N, --refresh, clear, --json
                           (also /repomap; see docs/repomap.md)
  unown ralph "<task>"    the worker→reviewer loop (goose's Ralph pattern):
                           fresh-context iterations, file handoff, VERDICT:
                           SHIP/REVISE; --iterations (default 5),
                           --reviewer-model (use a different model)
                           (see docs/ralph.md)
  unown engine <sub>      the detached self-learning engine (M3+M6+M8):
                           status | start | stop | restart | repair | serve —
                           ping, spawn, graceful drain, the version-skew
                           restart, corrupt-DB recovery, or run in-process
                           (supervisor entry)
  unown usage            token & cost report for the LLM bridge
                           (--days N, --model M, --json; estimates unless
                           UNOWN_PRICE_* pins exact prices)
  unown webcache <sub>   inspect the web results store (stats [--json] |
                           clear | sweep) shared by web_search + webfetch
  unown sessions <sub>  session export / import / list (Milestone 3.5):
                           export <id> [--out <file>] | import <file> | list
  unown blame [file]     receipts-backed blame: which sessions and tool calls
                           touched <file>; no arg = whole-ledger summary
                           (flags: --session <id> --since <ts> --json —
                           the CLI twin of the /blame session command)
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
                           --json, --allow-dirty, --rollback, --dry-run,
                           --skip/--unskip/--snooze, or a version:
                           unown update 2.1.0 (also pins/rolls back)
  unown changelog [n]     print the latest CHANGELOG.md sections (default 1)
  unown completions <sh>  bash | zsh | fish | powershell completion script
  unown uninstall         remove the install: PATH shims, plus the versioned
                           root for a binary install (--dry-run, --purge-data,
                           --purge-checkout)
  unown --help             this help
  unown --version          print the version (matches package.json)

Session tools (registered in every session):
  todo / ask_user_question / note / task / fetch_url / web_search /
  webfetch / lsp                         visible task tracking, structured
                                         mid-run questions (the run blocks
                                         until you answer), mid-session
                                         learning notes, subagents with a fresh
                                         context (output_schema structured
                                         replies, worktree_isolation, and the
                                         async fleet: async:true fire-and-forget
                                         spawns steered via task_control), HTTP
                                         reads, live web search + page reads
                                         (keyless out of the box; provider keys
                                         optional), language-server code
                                         intelligence
  task_control / ask_question            fleet control surface (steer/stop/status/list
                                         + the child's ask-the-orchestrator channel;
                                         registered with the fleet lane)
  routine_list (+create/update/run/delete outside routine runs)
                                         scheduled recurring runs managed by the
                                         engine (cron, every, after, one-shot)
  /plan /todos /note /agents /learning /engine /lsp /checkpoint /undo /redo
  /restore /checkpoints /receipts /mcp /goal /review   session commands
  /commit /hooks          git-native commit (message optional, never pushes)
                          + the user-hook layer's status/trust surface
  /tasks                  the async subagent fleet: running children + the
                          resume registry (task_control steer <name> resumes)
  /addons                configure the TUI addons (ask_user_question, todo,
                         advisor) — every change persists to
                         ~/.unown/agent/addons.json (docs/addons.md)
  /advisor status|on|off  advisor status and control — /advisor on enables the
                         second-model watcher (off by default; /reload applies)
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
  /providers              the in-chat provider manager (R2): bare opens the
                          interactive list/add/key/test/refresh/defaults flow;
                          /providers list | test <id> | refresh <id> work
                          headless — the TUI twin of \`unown providers\`
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
  --model <id>            the model for this run — bare id or provider/model
                           (multi-provider routing, e.g. agnes/agnes-3.0-flash;
                           also per-subagent routing, see UNOWN_SUBAGENT_MODEL)
  --provider <id>         pin the provider for this run (its default model is
                           used unless --model also names one) — e.g. --provider
                           agnes. Registry: unown providers list
  --effort low|medium|high  reasoning effort (low → BRIDGE_QWEN_THINKING=0,
                           high → =1, medium/unset = bridge default)
  --mcp-servers a,b       whitelist of MCP servers to load (empty CSV = load
                           none; absent = load all)
  --no-agents-md          skip AGENTS.md / per-tier memory injection
  --no-split              start the TUI bare: no split-view panels (thinking/
                          tools band, files dock) even if /split-save left
                          startup defaults behind
  --session <path>        continue that exact session file (TUI + print mode;
                          the fleet's resume substrate — children run with it)

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
  UNOWN_FLEET_TIMEOUT_MS   hard cap on one async fleet child in ms (default
                           900000; values < 1000 fall back to the default)
  UNOWN_WORKTREE_ISOLATION=0  disable the task tool's worktree-isolation lane
                           (fleet spawns compose with it)
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
        /** Fleet lane (pi-interactive-subagents port): resume/continue a
         *  specific session FILE instead of creating a fresh one. Set by the
         *  new --session <path> flag; consumed by bootRuntime via
         *  SessionManager.open. */
        sessionFile?: string;
        // Milestone 2.1 + 2.2 — per-subagent routing fields. Set by the new
        // --model / --effort / --mcp-servers / --no-agents-md flags; consumed by
        // bootRuntime to set PI_MODEL_ID / BRIDGE_QWEN_THINKING /
        // UNOWN_MCP_SERVERS / UNOWN_NO_AGENTS_MD before the session starts.
        model?: string;
        effort?: SubagentEffort;
        mcpServers?: string[];
        noAgentsMd?: boolean;
        /** --provider <id>: pin the session's provider (its default model is
         * used unless --model also names one). Multi-provider parity with pi's
         * own CLI and the Cline provider dropdown. */
        provider?: string;
        /** --no-split: start bare, ignoring saved split-view startup defaults. */
        noSplit?: boolean;
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
        let sessionFile: string | undefined;
        let tools: string[] | undefined;
        let appendSystemPromptPath: string | undefined;
        let plan = false;
        let noSplit = false;
        let goal: string | undefined;
        let outputFormat: "text" | "json" | undefined;
        let provider: string | undefined;
        for (let i = 0; i < argvRest.length; i++) {
                const a = argvRest[i];
                if (a === "--help" || a === "-h")
                        return { command: "help", verbose, jsonMode, noSession, plan, noSplit, goal, outputFormat };
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
                if (a === "--session") {
                        // Fleet lane: an explicit session FILE to continue
                        // (pi-interactive-subagents' resume substrate).
                        const next = argvRest[i + 1];
                        if (next !== undefined && !next.startsWith("--")) {
                                sessionFile = next;
                                i++;
                        }
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
                if (a === "--no-split") {
                        noSplit = true;
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
                if (a === "--provider") {
                        const next = argvRest[i + 1];
                        if (next !== undefined && !next.startsWith("--")) {
                                provider = next;
                                i++;
                        }
                        continue;
                }
                rest.push(a);
        }
        const first = rest[0];
        if (first === "init" || first === "memory" || first === "doctor" || first === "note") {
                const prompt = rest.slice(1).join(" ");
                return { command: first, prompt, verbose, jsonMode, noSession, plan, noSplit, outputFormat };
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
                        sessionFile,
                        tools,
                        appendSystemPromptPath,
                        plan,
                        noSplit,
                        goal,
                        outputFormat,
                        model: subagentFlags.model,
                        effort: subagentFlags.effort,
                        mcpServers: subagentFlags.mcpServers,
                        noAgentsMd: subagentFlags.noAgentsMd,
                        provider,
                };
        return {
                command: "tui",
                prompt,
                verbose,
                jsonMode,
                noSession,
                sessionFile,
                tools,
                appendSystemPromptPath,
                plan,
                noSplit,
                goal,
                outputFormat,
                model: subagentFlags.model,
                effort: subagentFlags.effort,
                mcpServers: subagentFlags.mcpServers,
                noAgentsMd: subagentFlags.noAgentsMd,
                provider,
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
        /** --no-split: seed the split-view extension's flag so the session starts bare. */
        noSplit?: boolean;
        extraExtensions?: Array<{ name: string; hidden: boolean; factory: (pi: any) => void | Promise<void> }>;
        /** Pre-opened session manager (ACP session/load resumes a persisted
         * session instead of creating a fresh one). */
        sessionManager?: SessionManager;
        /** Fleet lane (pi-interactive-subagents port): an explicit session
         *  FILE to open — the resume substrate for async subagents. */
        sessionFile?: string;
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
        /** --provider pin (M3): resolved against the multi-provider registry
         * together with --model by resolveCliModel. */
        provider?: string;
        /** The TUI lane's positional prompt (becomes InteractiveMode's
         * initialMessage). Onboarding 2.1 "First flights": an immediate
         * first message must suppress the startup catalog — the user already
         * told us what they want to do. */
        initialMessage?: string;
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
        // Async variant: on a FIRST run the bridge /health is probed before
        // models.json is seeded, so the default model is the bridge's own
        // route default instead of the hard-coded kimi-k2.5 fallback that
        // 404s on non-Dashscope upstreams (audit M4-a D1).
        const agentDir = await ensureUnownAgentDirAsync();
        // M3: point pi's own agent-dir resolution at unown's dir. The session
        // gets agentDir passed explicitly, but pi code that calls getAgentDir()/
        // getAuthPath()/getSettingsPath() DIRECTLY (the /login status line,
        // AuthStorage defaults) resolved ~/.pi/agent — the wrong dir under
        // unown, producing messages (and, for /login, key writes) that point
        // at a config location unown never reads back. PI_CODING_AGENT_DIR is
        // pi's sanctioned override (config.ts:504); project-level .pi/ paths
        // are cwd-based and unaffected.
        process.env.PI_CODING_AGENT_DIR = agentDir;
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
        // Split-view TUI display mode (thinking/tool band, files dock, response-only): a built-in
        // port of pi-split-view, persisted via <agentDir>/ui-panels.json (/split-save).
        const splitviewExtension = createSplitViewExtension({ agentDir, verbose });
        const toolsExtension = createUnownToolsExtension({ cwd, engineUrl: ENGINE_URL, verbose });
        // The TUI addons (ask_user_question, todo, advisor + /addons): bundled
        // inline extensions with their own user config (~/.unown/agent/addons.json).
        // ask_user_question + todo register in subagent sessions too (the
        // questionnaire is stripped from the active tool set when !ctx.hasUI and
        // a subagent's todo list rides its own session entries); the advisor is
        // foreground-only — see addons/index.ts.
        const addonsExtension = createUnownAddonsExtension({ cwd, verbose });
        // Onboarding 2.1 "First flights": the guided first-task catalog that
        // replaces the editor slot on a fresh TUI boot (see src/flights.ts).
        // autoShow is off when the TUI lane carries an initialMessage — that
        // message is the user's first task and fires the firstTaskAt latch
        // anyway.
        const firstFlightsExtension = createFirstFlightsExtension({ cwd, autoShow: !bootOpts.initialMessage });

        const settingsManager = SettingsManager.create(cwd, agentDir);

        // Verify-first defaults (2026-10): when the user has NOT configured a
        // default tool set in settings, unown sessions start with pi's base four
        // PLUS the dedicated search tools (grep/find/ls) when their binaries
        // answer on PATH — the agent-survey default every major coding agent
        // ships (Claude Code, Gemini CLI, OpenCode, Cursor, Cline). Passed as
        // `defaultTools` (NOT `tools`): a default set, not an allowlist —
        // extension tools still register. An explicit --tools list and a
        // configured settings defaultTools both win unchanged (sdk.ts order).
        const unownDefaultTools = defaultSessionTools();

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
                                bootOpts.plan || bootOpts.goal || bootOpts.noSplit
                                        ? new Map<string, boolean | string>([
                                                        ...(bootOpts.plan ? ([["plan", true]] as Array<[string, boolean | string]>) : []),
                                                        ...(bootOpts.goal ? ([["goal", bootOpts.goal]] as Array<[string, boolean | string]>) : []),
                                                        ...(bootOpts.noSplit ? ([["no-split", true]] as Array<[string, boolean | string]>) : []),
                                                ])
                                        : undefined,
                        resourceLoaderOptions: {
                                extensionFactories: [
                                        checkpointsExtension as any,
                                        extension as any,
                                        toolsExtension as any,
                                        addonsExtension as any,
                                        firstFlightsExtension as any,
                                        mcpExtension as any,
                                        permissionsExtension as any,
                                        splitviewExtension as any,
                                        // Fleet lane (pi-interactive-subagents port): the
                                        // child-side extension — control-inbox steering +
                                        // ask_question — injected ONLY when the parent set
                                        // UNOWN_FLEET_CONTROL on this spawn.
                                        ...(fleetChildExtension ? [fleetChildExtension as any] : []),
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
                        defaultTools: unownDefaultTools,
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
                                // --provider without --model: pin the provider's default
                                // model (settings defaultModel when it belongs to that
                                // provider, else the provider's first registered model) —
                                // the Cline-dropdown contract. With both flags, the pair
                                // resolves exactly like pi's own CLI.
                                let cliModel = bootOpts.model;
                                if (!cliModel && bootOpts.provider) {
                                        const list = listProviders(UNOWN_AGENT_DIR);
                                        const p = list.providers.find((x) => x.id.toLowerCase() === bootOpts.provider!.toLowerCase());
                                        if (!p) {
                                                console.error(
                                                        `unown: --provider ${bootOpts.provider}: unknown provider — configured: ${
                                                                list.providers.map((x) => x.id).join(", ") || "(none)"
                                                        }`,
                                                );
                                                return undefined;
                                        }
                                        cliModel = list.defaultProvider === p.id ? list.defaultModel : p.modelIds[0];
                                        if (!cliModel) {
                                                console.error(`unown: --provider ${bootOpts.provider}: the provider has no models — add one first`);
                                                return undefined;
                                        }
                                }
                                if (!cliModel) return undefined;
                                const resolved = resolveCliModel({
                                        cliModel,
                                        cliProvider: bootOpts.provider,
                                        modelRuntime: services.modelRuntime,
                                });
                                if (resolved.error) {
                                        console.error(
                                                `unown: ${[bootOpts.provider && `--provider ${bootOpts.provider}`, bootOpts.model && `--model ${bootOpts.model}`].filter(Boolean).join(" ")}: ${resolved.error}`,
                                        );
                                        return undefined;
                                }
                                if (resolved.warning) console.error(`unown: ${resolved.warning}`);
                                return resolved.model;
                        })(),
                        thinkingLevel: bootOpts.effort,
                });
                return { ...created, services, diagnostics: services.diagnostics };
        };

        // Fleet lane (pi-interactive-subagents port): children spawned by the
        // fleet manager carry UNOWN_FLEET_CONTROL; their session gets the
        // child-side extension (steer delivery + ask_question). Ordinary
        // sessions and sync-lane subagents get nothing.
        const fleetChildExtension = createFleetChildExtension();

        const sessionManager =
                bootOpts.sessionManager ??
                (bootOpts.sessionFile
                        ? SessionManager.open(bootOpts.sessionFile, join(UNOWN_AGENT_DIR, "sessions"))
                        : bootOpts.noSession
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

async function runPreflight(pinnedProvider?: string): Promise<PreflightProblem | null> {
        if (process.env.UNOWN_NO_PREFLIGHT) return null;
        if (process.env.UNOWN_SUBAGENT) return null; // subagents inherit the parent's validated path
        const agentDir = await ensureUnownAgentDirAsync();
        // The CLI pin wins: --provider X / --model provider/model probe THAT
        // provider's endpoint (the registry's default may be a different one —
        // probing it would report the wrong outage for this session).
        const provider = resolveActiveProvider(agentDir, pinnedProvider);
        if (!provider || !provider.baseUrl) return null; // built-in/unknown endpoint — nothing to probe
        // resolveProviderKey is the single key source: auth.json > models.json
        // literal > $ENV resolved at call time. NEVER provider.apiKey directly —
        // for env-ref providers that field is the literal "$VAR" string, which
        // would be sent as the bearer token and 401 against the real endpoint.
        const effectiveKey = resolveProviderKey(agentDir, provider.id).key;
        const probe = await probeOpenAiEndpoint(provider.baseUrl, effectiveKey ?? undefined, 4000);
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

/**
 * First-run gate copy. `bridgeUp` matters because the standalone binary is the
 * default install and ships no llm-bridge: offering "keep the bundled bridge"
 * there would promise an endpoint that does not exist. Pure so the copy is
 * unit-tested without a TTY.
 */
export function firstRunGateLines(bridgeUp: boolean): {
        question: string;
        declined: string[];
        wizardFailed: string;
} {
        const decline = bridgeUp ? "n = keep the bundled bridge for now" : "n = skip for now (no provider connected)";
        return {
                question: `\nFirst run — no provider connected yet.\nConnect one now? (Agnes, OpenAI, OpenRouter, Anthropic, Dashscope, DeepSeek, local…)\n  Enter = guided setup · ${decline}`,
                declined: [
                        bridgeUp ? "  Skipped — the bundled bridge is wired for now." : "  Skipped — no provider is connected yet.",
                        "  (anytime: unown setup · unown providers add · unown providers list)",
                ],
                wizardFailed: bridgeUp
                        ? "Continuing with the bundled bridge (re-run `unown setup` anytime)…"
                        : "No provider connected (re-run `unown setup` anytime)…",
        };
}

/** First-run banner lines. Pure so "never claim a bridge that is not
 *  answering" is testable; the binary default is the case that motivated it. */
export function firstRunBannerLines(opts: {
        pid: string;
        mid: string;
        loopback: boolean;
        bridgeUp: boolean;
}): string[] {
        const connect = "  connect any provider (OpenAI, OpenRouter, Anthropic, Dashscope, local): unown setup";
        if (!opts.loopback) {
                return [`unown: first run — using ${opts.pid} (${opts.pid}/${opts.mid}).`, connect, ""];
        }
        if (opts.bridgeUp) {
                return [`unown: first run — using the bundled llm-bridge (${opts.pid}/${opts.mid}).`, connect, ""];
        }
        return [
                "unown: first run — no model endpoint is answering. The bundled bridge is part of the source install (bun run agent:start).",
                "  connect any provider instead: unown setup",
                "",
        ];
}

async function printFirstRunBanner(knownBridgeUp?: boolean): Promise<void> {
        const init = unownAgentDirInit();
        if (!init?.created) return;
        // Read the LIVE default, not the seed-time snapshot: a wizard that ran
        // in this same process (the first-run gate) may have already connected
        // a real provider — the banner must not name the stale seeded bridge.
        const active = resolveActiveProvider(UNOWN_AGENT_DIR);
        const pid = active?.id ?? init.provider;
        const mid = active?.modelIds?.[0] ?? init.modelId;
        const loopback = !!active && isLoopbackProvider(active);
        const bridgeUp = loopback ? (knownBridgeUp ?? (await bridgeHealth(1000))?.ok === true) : false;
        for (const line of firstRunBannerLines({ pid, mid, loopback, bridgeUp })) console.error(line);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Human-readable byte count (1.2 MiB style) — shared by doctor's
 *  unown-state check, the doctor web results store line and
 *  `unown webcache stats`. */
function formatBytes(n: number): string {
        return n >= 1024 ** 3
                ? `${(n / 1024 ** 3).toFixed(1)} GiB`
                : n >= 1024 ** 2
                        ? `${(n / 1024 ** 2).toFixed(1)} MiB`
                        : n >= 1024
                                ? `${Math.max(1, Math.round(n / 1024))} KiB`
                                : `${n} B`;
}

/** Human-readable duration for the store's TTL / stale-if-error windows
 *  (60m, 24h, 7d …). */
function formatMs(ms: number): string {
        if (ms >= 86_400_000 && ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
        if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
        if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000}m`;
        if (ms >= 1_000 && ms % 1_000 === 0) return `${ms / 1_000}s`;
        return `${ms}ms`;
}

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

/** `unown webcache` — inspect and manage the web results store (webcache.ts,
 *  the persistent cache behind web_search + webfetch + fetch_url):
 *  `stats [--json] | clear | sweep`, with stats as the default subcommand. */
function cmdWebcache(args: string[]): number {
        const subs = ["stats", "clear", "sweep"];
        const first = args[0];
        if (first !== undefined && !first.startsWith("-") && !subs.includes(first)) {
                console.error(`unown webcache: unknown subcommand "${first}" (stats | clear | sweep)`);
                console.error("usage: unown webcache [stats] [--json] | clear | sweep  (see 'unown help webcache')");
                return 1;
        }
        const sub = first !== undefined && subs.includes(first) ? first : "stats";
        const rest = sub === first ? args.slice(1) : args; // flags-only tail
        if (rest.includes("-h") || rest.includes("--help")) {
                console.log(WEBCACHE_HELP);
                return 0;
        }
        const json = rest.includes("--json");
        const unknown = rest.filter((a) => a !== "--json");
        if (unknown.length > 0) {
                console.error(`unown webcache: unknown argument(s): ${unknown.join(" ")}`);
                console.error("usage: unown webcache [stats] [--json] | clear | sweep  (see 'unown help webcache')");
                return 1;
        }
        if (sub === "clear") {
                const { removed, bytes } = webCacheClear();
                if (json) console.log(JSON.stringify({ removed, bytes }, null, 2));
                else console.log(`✓ removed ${removed} ${removed === 1 ? "entry" : "entries"} (${formatBytes(bytes)})`);
                return 0;
        }
        if (sub === "sweep") {
                const { evicted, freedBytes, totalBytes } = webCacheSweep();
                if (json) console.log(JSON.stringify({ evicted, freedBytes, totalBytes }, null, 2));
                else
                        console.log(
                                `✓ sweep — evicted ${evicted} ${evicted === 1 ? "entry" : "entries"} (freed ${formatBytes(
                                        freedBytes,
                                )}), ${formatBytes(totalBytes - freedBytes)} of ${formatBytes(webCacheStats().maxBytes)} cap in use`,
                        );
                return 0;
        }
        // stats (the default)
        const s = webCacheStats();
        if (json) {
                console.log(JSON.stringify(s, null, 2));
                return 0;
        }
        const lookups = s.totals.hit + s.totals.revalidated + s.totals.miss;
        const hitPct = lookups > 0 ? Math.round(((s.totals.hit + s.totals.revalidated) / lookups) * 100) : null;
        console.log("unown webcache — the web results store");
        console.log();
        console.log(`${s.enabled ? "✓ enabled" : "· disabled (UNOWN_WEB_CACHE=0)"} — ${s.root}`);
        console.log(
                `  entries     ${s.entries}${s.index.approximate ? " (approx — in-memory index)" : ""} (${formatBytes(s.bytes)} of ${formatBytes(s.maxBytes)} cap)`,
        );
        console.log(
                `  ttl         search ${formatMs(s.ttl.searchMs)} · fetch ${formatMs(s.ttl.fetchMs)} (origin Cache-Control honored, capped 24h)` +
                        ` · stale-if-error ${formatMs(s.ttl.searchStaleMs)} search / ${formatMs(s.ttl.fetchStaleMs)} fetch`,
        );
        console.log(
                `  hit rate    ${hitPct === null ? "— (no lookups yet)" : `${hitPct}%`} — ${s.totals.hit} hits, ${s.totals.revalidated} revalidated, ${s.totals.miss} ${
                        s.totals.miss === 1 ? "miss" : "misses"
                }`,
        );
        console.log(`  saved       ${s.savedRequests} upstream ${s.savedRequests === 1 ? "request" : "requests"}`);
        const kinds: Array<[string, number]> = [
                ["hit", s.totals.hit],
                ["revalidated", s.totals.revalidated],
                ["miss", s.totals.miss],
                ["stale", s.totals.stale],
                ["bypass", s.totals.bypass],
                ["evict", s.totals.evict],
                ["clear", s.totals.clear],
                ["error", s.totals.error],
        ];
        console.log(`  totals      ${kinds.map(([k, n]) => `${k} ${n}`).join(" · ")}`);
        const tools = Object.entries(s.byTool).sort((a, b) => b[1] - a[1]);
        if (tools.length > 0) console.log(`  tools       ${tools.map(([k, n]) => `${k} ${n}`).join(" · ")}`);
        const providers = Object.entries(s.byProvider)
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .slice(0, 8);
        if (providers.length > 0) console.log(`  providers   ${providers.map(([k, n]) => `${k} ${n}`).join(" · ")}`);
        return 0;
}

/** One doctor check in structured form — the `--json` schema (see docs/usage.md). */
interface DoctorCheck {
        id: string;
        status: "pass" | "warn" | "fail";
        detail: string;
}

/** Doctor's web results store summary — the JSON-mode shape. Counts and
 *  paths only (the shareable subset of WebCacheStats): the events feed's
 *  detail lines carry query text, which belongs to `unown webcache --json`,
 *  not to a support bundle. */
interface DoctorWebCacheSummary {
        enabled: boolean;
        root: string;
        entries: number;
        bytes: number;
        maxBytes: number;
        hitRate: number | null;
        savedRequests: number;
}

async function cmdDoctor(jsonMode: boolean): Promise<number> {
        const cwd = process.cwd();
        const checks: DoctorCheck[] = [];
        let hardFail = false;
        let warnings = 0;
        // M3 — the web results store summary for the JSON envelope, filled by
        // check 6e below.
        let webCacheSummary: DoctorWebCacheSummary | undefined;
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
                const install = resolveInstallInfo({ home: UNOWN_HOME });
                const root = install?.mode === "checkout" ? install.root : null;
                const shown = VERSION !== "unknown" ? VERSION : (install?.version ?? "unknown");
                const short = root ? gitShortSha(root, realGit) : null;
                check(
                        "unown version",
                        true,
                        install?.mode === "binary"
                                ? `${shown} · binary install · ${install.root}`
                                : `${shown}${short ? ` · ${short}` : ""} · ${root ?? "(not a git checkout)"}`,
                );
                const cache = readUpdateCheckCache(UNOWN_HOME);
                const prefs = readUpdatePrefs(UNOWN_HOME);
                const snoozedUntil = prefs.snoozeUntil && Date.parse(prefs.snoozeUntil) > Date.now() ? prefs.snoozeUntil : null;
                const skipped = Boolean(cache?.latest && prefs.skippedVersion === cache.latest);
                const staleCache = Boolean(
                        cache &&
                                (cache.legacy === true ||
                                        cache.current !== shown ||
                                        (install && cache.mode !== install.mode) ||
                                        (cache.platform !== undefined &&
                                                install?.platform !== undefined &&
                                                cache.platform !== install.platform)),
                );
                if (cache?.error) {
                        check(
                                "update available",
                                false,
                                `check failed — ${cache.error} (checked ${cache.checkedAt ? describeAge(cache.checkedAt) : "?"})`,
                                "warn",
                        );
                } else if (staleCache) {
                        check(
                                "update available",
                                true,
                                `${cache?.legacy ? "legacy" : "stale"} cache (checked ${cache?.checkedAt ? describeAge(cache.checkedAt) : "?"}) — run \`unown update --check\``,
                        );
                } else if (skipped) {
                        check("update available", true, `v${cache?.latest} skipped (\`unown update --unskip\`)`);
                } else if (snoozedUntil) {
                        check("update available", true, `notices snoozed until ${snoozedUntil}`);
                } else if (cache?.latest && cache.applicable === false) {
                        check(
                                "update available",
                                true,
                                `latest v${cache.latest} is not installable here${cache.reason ? ` (${cache.reason})` : ""}`,
                        );
                } else if (cache?.latest && compareSemver(cache.latest, shown) > 0) {
                        const scope = cache.mode === "checkout" ? " · source checkout" : cache.platform ? ` · ${cache.platform}` : "";
                        const size = cache.asset ? ` · ${formatUpdateSize(cache.asset.size)}` : "";
                        check(
                                "update available",
                                false,
                                `v${cache.latest}${scope}${size} — run \`unown update\` (checked ${cache.checkedAt ? describeAge(cache.checkedAt) : "?"})`,
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

        // 1. agent dir & models (async ensure: a first run triggered via
        // `unown doctor` seeds the coherent bridge default too — audit M4-a D1)
        const agentDir = await ensureUnownAgentDirAsync();
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
                // resolveProviderKey is the single key source (auth.json > models.json
                // literal > $ENV) — the active provider usually keeps its key in
                // auth.json (setup writes it there, mode 0600), so probing with
                // models.json's apiKey field alone sent NO Authorization header and
                // misreported healthy Agnes endpoints as "credentials rejected".
                const probe = await probeOpenAiEndpoint(active.baseUrl, resolveProviderKey(agentDir, active.id).key, 4000);
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
                                                fallback?: { ok?: boolean; status?: number; url?: string; model?: string | null } | null;
                                                failovers?: number;
                                                upstreamKeyIsSet?: boolean;
                                                defaultModel?: string;
                                                models?: string[];
                                                staleKnownModels?: string[];
                                        };
                                        check(
                                                "bridge upstream key",
                                                body.upstreamKeyIsSet !== false,
                                                body.upstreamKeyIsSet === false
                                                        ? "BRIDGE_UPSTREAM_KEY is not set in the repo's .env — chats will fail with 401"
                                                        : "BRIDGE_UPSTREAM_KEY set",
                                        );
                                        // Failover-aware health: an unhealthy primary only fails this
                                        // check when no fallback is serving. With a healthy fallback
                                        // lane the chat path works — report it as such, with the
                                        // FAILOVER ACTIVE detail naming the lane that took over.
                                        const fbServing = body.upstream?.ok === false && body.fallback?.ok === true;
                                        const fbNote =
                                                typeof body.failovers === "number" && body.failovers > 0
                                                        ? `, ${body.failovers} failover${body.failovers === 1 ? "" : "s"} served`
                                                        : "";
                                        check(
                                                "bridge upstream health",
                                                body.upstream?.ok !== false || fbServing,
                                                body.upstream?.ok === false
                                                        ? fbServing
                                                                ? `upstream unhealthy (${body.upstream.status ?? "no answer"}) — FAILOVER ACTIVE: ${
                                                                                body.fallback?.model ?? "the fallback model"
                                                                        } via ${body.fallback?.url ?? "the fallback"} is serving`
                                                                : `upstream unhealthy (${body.upstream.status ?? "no answer"}) — check BRIDGE_UPSTREAM_URL`
                                                        : `${body.requests ?? 0} requests, ${body.errors ?? 0} errors${fbNote}`,
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
                                        // Route-default coherence: unknown model ids route onto
                                        // BRIDGE_ROUTE_DEFAULT; if that id is NOT in the allow-list
                                        // either, every routed request 404s at the upstream with no
                                        // local hint. Classic trigger: BRIDGE_UPSTREAM_URL switched to
                                        // a new provider while a stale BRIDGE_ROUTE_DEFAULT stayed
                                        // hard-coded in .env (it overrides BRIDGE_MODEL).
                                        if (
                                                typeof body.defaultModel === "string" &&
                                                body.defaultModel.length > 0 &&
                                                Array.isArray(body.models) &&
                                                body.models.length > 0 &&
                                                !body.models.includes(body.defaultModel)
                                        ) {
                                                check(
                                                        "bridge route default coherent",
                                                        false,
                                                        `route default "${body.defaultModel}" is not in the allow-list (BRIDGE_KNOWN_MODELS) — unknown model ids will 404 at the upstream; align BRIDGE_ROUTE_DEFAULT/BRIDGE_MODEL with the upstream catalog`,
                                                        "warn",
                                                );
                                        }
                                        // Stale allow-list ids (audit M4-a D1): the bridge's
                                        // upstream /models catalog (when reachable) names ids in
                                        // BRIDGE_KNOWN_MODELS it does NOT serve — requests naming
                                        // them pass through and 404. Classic trigger: switching
                                        // BRIDGE_UPSTREAM_URL to Agnes while the Dashscope
                                        // allow-list stayed in .env, and a fresh install seeded
                                        // kimi-k2.5 as its default.
                                        const staleKnown = Array.isArray(body.staleKnownModels)
                                                ? (body.staleKnownModels as unknown[]).filter(
                                                                (m): m is string => typeof m === "string" && m.length > 0,
                                                        )
                                                : [];
                                        if (staleKnown.length > 0) {
                                                check(
                                                        "bridge allow-list served by upstream",
                                                        false,
                                                        `BRIDGE_KNOWN_MODELS lists ${staleKnown.join(", ")} but the upstream catalog does not serve ${staleKnown.length === 1 ? "it" : "them"} — requests naming ${staleKnown.length === 1 ? "it" : "them"} will 404; remove ${staleKnown.length === 1 ? "it" : "them"} so they re-route to ${body.defaultModel ?? "the default"} instead`,
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

        // 3c. the OTHER providers (M2) — every non-default provider gets its own
        // verdict line, warn-class: a broken secondary must never turn doctor's
        // exit non-zero while the default chat path works (the doctor contract),
        // but silence would hide a stale secondary until you switch to it.
        {
                const file = readAgentModelsFile(agentDir);
                const others = file.providers.filter((p) => p.id !== active?.id);
                if (others.length > 0) {
                        const list = listProviders(agentDir);
                        const lines: string[] = [];
                        let anyDown = false;
                        for (const p of others) {
                                if (!p.baseUrl) {
                                        lines.push(`${p.id}: no baseUrl`);
                                        anyDown = true;
                                        continue;
                                }
                                const { key } = resolveProviderKey(agentDir, p.id);
                                const probe = await probeOpenAiEndpoint(p.baseUrl, key, 3000);
                                if (probe.ok) {
                                        const summary = list.providers.find((x) => x.id === p.id);
                                        const keyNote = summary ? ` (${keyStatusLabel(summary)})` : "";
                                        lines.push(`${p.id}: reachable${keyNote}`);
                                } else if (probe.problem === "auth") {
                                        lines.push(`${p.id}: key rejected (HTTP ${probe.status}) — unown providers key ${p.id}`);
                                        anyDown = true;
                                } else {
                                        lines.push(`${p.id}: unreachable — unown providers test ${p.id}`);
                                        anyDown = true;
                                }
                        }
                        check("secondary providers", !anyDown, lines.join(" · "), "warn");
                }
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
                const res = await engineFetch(`${ENGINE_URL}/api/overview`, { signal: AbortSignal.timeout(3000) });
                const body: any = await res.json();
                check(
                        "self-learning engine",
                        res.ok && body.ok,
                        `${body?.kpis?.totalRuns ?? "?"} runs, ${body?.kpis?.dreams ?? "?"} dreams`,
                );
                // 5b. wedged-but-alive engine (F4, docs/detached-engine-architecture.md):
                // the router reports how long its busy mutex has been held; past 2x
                // the job timeout the watchdog should have cut the job off — if it
                // hasn't, the engine is wedged at a level the watchdog cannot reach
                // and the operator should restart it (`bun run agent:stop && agent:start`).
                const routerInfo = body?.router;
                if (routerInfo && typeof routerInfo.busyMs === "number" && typeof routerInfo.jobTimeoutMs === "number") {
                        const limit = 2 * routerInfo.jobTimeoutMs;
                        if (routerInfo.busyMs > limit) {
                                check(
                                        "engine router",
                                        false,
                                        `busy mutex held ${Math.round(routerInfo.busyMs / 1000)}s on '${routerInfo.activeJob}' — past 2x the job timeout; restart the engine`,
                                        "warn",
                                );
                        }
                }
                // 5c. engine version skew (M8): the engine reports its build in
                // /api/overview; warn when it predates the current one — the fix
                // is `unown engine restart`, never a broken state (chat and
                // notes work regardless; new learning simply runs on the old
                // build until restarted). A missing version block is a pre-M8
                // engine: an info-pass with the same fix (the restart brings
                // version reporting along).
                {
                        const engineVer = body?.version;
                        const cmp = compareEngineBuild(
                                { version: VERSION, gitSha: agentGitSha(), codeMtimeMs: codeMtimeMs() },
                                engineVer,
                                Date.now(),
                        );
                        if (cmp.verdict === "fresh") {
                                check(
                                        "engine version",
                                        true,
                                        `v${engineVer?.version ?? "?"}${engineVer?.gitSha ? ` (${engineVer.gitSha})` : ""}`,
                                );
                        } else if (cmp.verdict === "unknown") {
                                check(
                                        "engine version",
                                        true,
                                        "engine predates version reporting — restart to update: unown engine restart",
                                );
                        } else if (cmp.verdict === "ahead") {
                                check(
                                        "engine version",
                                        false,
                                        `engine v${engineVer?.version ?? "?"} is newer than agent v${VERSION} — run: unown update`,
                                        "warn",
                                );
                        } else {
                                check(
                                        "engine version",
                                        false,
                                        `engine is an older build (v${engineVer?.version ?? "?"} vs agent v${VERSION}) — unown engine restart`,
                                        "warn",
                                );
                        }
                }
        } catch {
                const stats = outboxStats();
                check(
                        "self-learning engine",
                        false,
                        `unreachable — learning paused, chat unaffected; notes queue in ${UNOWN_HOME}/notes/outbox (${stats.queued} pending; start it: unown engine start)`,
                        "warn",
                );
                // M6: the crash-loop circuit explains WHY auto-start isn't fixing
                // this — surfaced here because doctor is the first place users look.
                const circuit = readSpawnState();
                if (circuit.gaveUp) {
                        check(
                                "engine auto-start",
                                false,
                                `gave up after ${circuit.attempts} failed start(s) — inspect .run/engine.log; then: unown engine repair (corrupt DB?) or unown engine start (resets the circuit)`,
                                "warn",
                        );
                } else if (circuit.attempts > 0) {
                        check(
                                "engine auto-start",
                                true,
                                `${circuit.attempts} recent attempt(s) — backing off between tries (normal after failures)`,
                        );
                }
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
                        check(
                                "MCP config",
                                true,
                                mcpNames.length > 0 ? serverDetail : "no servers configured (optional — unown mcp add)",
                        );
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

                // 6e. web results store (the persistent web_search/webfetch
                //     cache under $UNOWN_HOME/cache/web — webcache.ts).
                //     Informational: an empty store is the fresh-install
                //     default, and UNOWN_WEB_CACHE=0 is a deliberate user
                //     choice — both stay warn-class at most, never a failure.
                {
                        const wc = webCacheStats();
                        const lookups = wc.totals.hit + wc.totals.revalidated + wc.totals.miss;
                        const hitRate = lookups > 0 ? Math.round(((wc.totals.hit + wc.totals.revalidated) / lookups) * 100) : null;
                        webCacheSummary = {
                                enabled: wc.enabled,
                                root: wc.root,
                                entries: wc.entries,
                                bytes: wc.bytes,
                                maxBytes: wc.maxBytes,
                                hitRate,
                                savedRequests: wc.savedRequests,
                        };
                        check(
                                "web results store",
                                wc.enabled,
                                wc.enabled
                                        ? `${wc.entries} entries, ${formatBytes(wc.bytes)}, ${
                                                        hitRate === null ? "no lookups yet" : `${hitRate}% hit rate`
                                                } (saved ${wc.savedRequests} requests)`
                                        : "disabled (UNOWN_WEB_CACHE=0)",
                                "warn",
                        );
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
                                        webCache: webCacheSummary,
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

/** `unown blame [file]` — the CLI twin of the /blame session command (audit
 * 2-b F2: `unown blame` used to be swallowed as a one-word LLM prompt). Same
 * ledger (.unown/receipts/), same flags: --session <id> --since <ts> --json. */
function cmdBlame(argv: string[]): number {
        const tokens = argv.filter((t) => t.length > 0);
        if (tokens.includes("-h") || tokens.includes("--help")) {
                console.log(
                        `unown blame — receipts-backed blame: which sessions and tool calls touched a file

usage: unown blame [file] [--session <id>] [--since <ts>] [--json]
  file        a project-relative path; without it, a whole-ledger summary
              (counts by tool, files written) is printed
  --session   only entries from that session id
  --since     epoch-ms, ISO 8601, or relative seconds (e.g. 300s)
  --json      machine-readable output

The ledger lives at .unown/receipts/ (one JSONL per session; /receipts prints
it in-session). This is the CLI twin of the /blame slash command.`,
                );
                return 0;
        }
        const json = tokens.includes("--json");
        let sessionId: string | undefined;
        let since: number | undefined;
        let filePath: string | undefined;
        for (let i = 0; i < tokens.length; i++) {
                const t = tokens[i];
                if (t === "--json") continue;
                if (t === "--session") {
                        sessionId = tokens[i + 1];
                        i++;
                        continue;
                }
                if (t === "--since") {
                        const raw = tokens[i + 1];
                        const asNum = Number(raw);
                        if (!Number.isNaN(asNum)) {
                                since = raw.length >= 10 && /^\d+$/.test(raw) ? asNum : Date.now() - asNum * 1000;
                        } else {
                                const parsed = Date.parse(raw);
                                if (!Number.isNaN(parsed)) since = parsed;
                        }
                        i++;
                        continue;
                }
                if (!t.startsWith("--")) filePath = t;
        }
        const dir = receiptsDir(process.cwd());
        if (!filePath) {
                const summary = blameSummary(dir, { sessionId, since });
                if (json) {
                        console.log(JSON.stringify(summary, null, 2));
                        return 0;
                }
                const toolLines = Object.entries(summary.byTool)
                        .sort((a, b) => b[1] - a[1])
                        .map(([tool, n]) => `- ${tool}: ${n}`)
                        .join("\n");
                const files = summary.filesTouched.slice(0, 40);
                const filesLines =
                        files.length > 0
                                ? files.map((f) => `- ${f}`).join("\n") +
                                        (summary.filesTouched.length > 40 ? `\n- …and ${summary.filesTouched.length - 40} more` : "")
                                : "(no files written yet)";
                console.log(
                        `Blame summary — ${summary.totalEntries} tool call(s) across receipts.\n\nBy tool:\n${toolLines || "(none)"}\n\nFiles written/edited:\n${filesLines}`,
                );
                return 0;
        }
        const entries = blameFile(dir, filePath, { sessionId, since }, process.cwd());
        console.log(json ? formatBlameJson(entries) : formatBlameReport(entries, filePath));
        return 0;
}

/** F10 silence budget for print mode (ms). Floor 10s; default 3 min — above the worst measured upstream round (Agnes direct 2–12 s + bridge queueing), below any acceptable hang. */
function printStallMs(): number {
        const raw = Number(process.env.PI_PRINT_STALL_MS);
        return Number.isFinite(raw) && raw >= 10_000 ? raw : 180_000;
}

/** Hard-exit grace AFTER the agent finishes (ms). Nothing re-arms this. */
function printExitGraceMs(): number {
        const raw = Number(process.env.PI_PRINT_EXIT_GRACE_MS);
        return Number.isFinite(raw) && raw >= 2_000 ? raw : 15_000;
}

/**
 * F10 (docs/detached-engine-architecture.md): print mode must always be
 * bounded — measured root cause: Bun's fetch leaves KEEP-ALIVE SOCKETS open
 * (note delivery to the engine, bridge traffic), and an idle pooled socket
 * holds the event loop alive after the answer is written. The process then
 * "completes" but never exits (caught live: 2 open sockets, 8 threads, answer
 * flushed — intermittent because the sockets sometimes close in time).
 *
 * Two nets, one milestone each:
 *   1. STALL watchdog (re-armed by every session event): catches a session
 *      wedged BEFORE/BEHIND its work (stuck fetch, wedged dispose).
 *   2. HARD-EXIT timer (armed ONLY at a final agent_end — an assistant turn
 *      that will not retry — and by NOTHING else): the work is done, the
 *      answer is written; after the grace, LEAVE. This is the production-CLI
 *      contract for unattended callers (engine automations, CI) that cannot
 *      press Ctrl-C.
 *
 * 2026-10-22 (M2): all three timers are now REF'd. The unref rationale
 * ("never delay a clean exit") was exactly backwards on a parked loop: when
 * the only remaining ref'd handles are idle keep-alive sockets, Bun parks in
 * epoll with no timeout and an unref'd timer never wakes it — the 2026-10-22
 * benchtest caught a finished session (answer written, note delivered)
 * surviving 6+ minutes with the hard-exit grace armed at +15s and never
 * firing, and the unref'd 1s poll meant the session subscription (which
 * arms the hard exit at all) might never attach. Ref'd is safe here because
 * cmdPrint terminates through process.exit(code) on EVERY path — a ref'd
 * timer cannot outlive a one-shot process that always hard-exits; it can
 * only guarantee the nets actually fire. Best-effort semantics unchanged
 * (never break the run they guard). A hard exit skips --output-format
 * json's envelope in the pathological case — the streamed text is already
 * flushed; hanging forever is the worse trade.
 */
function installPrintStallWatchdog(runtime: any): void {
        try {
                let timer: any = null;
                const arm = () => {
                        if (timer) clearTimeout(timer);
                        timer = setTimeout(() => {
                                console.error(
                                        `unown: print mode stalled — no session events for ${Math.round(printStallMs() / 1000)}s; forcing exit (tune with PI_PRINT_STALL_MS)`,
                                );
                                process.exit(1);
                        }, printStallMs());
                };
                arm();
                let hardExit: any = null;
                const armHardExit = () => {
                        if (hardExit) clearTimeout(hardExit);
                        hardExit = setTimeout(() => {
                                // The agent finished; dispose had its grace. Leave quietly.
                                process.exit(0);
                        }, printExitGraceMs());
                };
                let lastSession: unknown = null;
                let off: (() => void) | null = null;
                const poll = setInterval(() => {
                        const s = runtime?.session;
                        if (s && s !== lastSession) {
                                lastSession = s;
                                try {
                                        off?.();
                                } catch {
                                        /* best effort */
                                }
                                off =
                                        typeof s.subscribe === "function"
                                                ? s.subscribe((event: any) => {
                                                                arm();
                                                                // Final completion: an agent_end that will not retry.
                                                                // The answer is written; only teardown remains.
                                                                if (event?.type === "agent_end" && !event?.willRetry) armHardExit();
                                                        })
                                                : null;
                        }
                }, 1_000);
        } catch {
                /* best effort only */
        }
}

/** M3 answer-watch accumulator for cmdPrint's OSC-9 ping (notify.ts): a
 *  hidden inline extension (the output-format.ts pattern — documented seams
 *  only) records the FINAL assistant message of the run plus the moment it
 *  settled, so the emission site after runPrintMode can decide "did a real
 *  answer land, and how long did the session wait for it". agent_end carries
 *  the run's messages; the LAST one is the final assistant on success and a
 *  synthetic failure message (stopReason error/aborted, empty text) on a
 *  failed run — both shapes are exactly what shouldNotifyOnAnswer gates on.
 *  Last run wins: a fleet steer-back follow-up replaces an earlier capture,
 *  which matches what print-mode itself prints last. */
function createAnswerWatch(): {
        get answer(): { text: string; stopReason?: string; at: number } | null;
        extension: { name: string; hidden: boolean; factory(pi: any): void };
} {
        const watch = {
                answer: null as { text: string; stopReason?: string; at: number } | null,
        };
        return {
                // A getter, not a copied value: the extension mutates `watch.answer`
                // AFTER cmdPrint has already received this handle.
                get answer() {
                        return watch.answer;
                },
                extension: {
                        name: "unown-answer-watch",
                        hidden: true,
                        factory(pi: any) {
                                pi.on("agent_end", ((event: any) => {
                                        try {
                                                const messages = Array.isArray(event?.messages) ? event.messages : [];
                                                const last = messages[messages.length - 1];
                                                if (last?.role !== "assistant") return;
                                                watch.answer = {
                                                        text: assistantTextOf(last),
                                                        stopReason: typeof last.stopReason === "string" ? last.stopReason : undefined,
                                                        at: Date.now(),
                                                };
                                        } catch {
                                                /* best effort — the ping is cosmetic */
                                        }
                                }) as any);
                        },
                },
        };
}

async function cmdPrint(prompt: string | undefined, args: CliArgs, verbose: boolean) {
        const cwd = process.cwd();
        // Pre-flight: fail fast with instructions when the model endpoint is
        // unreachable or rejects credentials (stderr — stdout may carry the
        // JSON event stream in --mode json).
        await ensureUnownAgentDirInfoAsync();
        maybeShowUpdateNotice({ mode: "print" });
        // The pin for pre-flight: --provider wins; else the --model string's
        // provider prefix; else the registry default (inside runPreflight).
        const pre = await runPreflight(args.provider ?? args.model);
        await printFirstRunBanner();
        if (pre) {
                console.error(`unown: ${pre.message}`);
                console.error(`  → ${pre.hint}`);
                console.error("  (set UNOWN_NO_PREFLIGHT=1 to skip this check)");
                process.exit(1);
        }
        // Piped stdin (e.g. `cat error.log | unown -p "fix this"`) joins the prompt.
        //
        // Three hazards the naive "attach a data listener + 500 ms timeout"
        // reader carried (audited live), all fixed here:
        //   1. Late-byte consumption — after the timeout resolved, the listener
        //      STAYED attached, so an open idle stdin (an agent harness, an
        //      editor, a supervisor) kept being drained: bytes belonging to the
        //      CALLER's protocol were silently eaten.
        //   2. Loop-hold — that lingering listener on an open pipe holds the
        //      event loop (measured: bare bun + open pipe + data listener never
        //      exits), so any path that does not hard-exit would hang.
        //   3. Unbounded read — an infinite/stdout-heavy pipe (`yes | unown -p`)
        //      was read forever because only a total-time cap existed.
        // Reader contract now: read while data actively flows (idle window
        // re-armed per chunk), settle on EOF, cap total bytes; once settled,
        // every listener is detached and the stream paused so nothing further
        // is ever consumed.
        let piped = "";
        if (!process.stdin.isTTY) {
                const rawIdle = Number(process.env.PI_PRINT_STDIN_IDLE_MS);
                const idleMs = Number.isFinite(rawIdle) && rawIdle >= 0 ? rawIdle : 500;
                const rawMax = Number(process.env.PI_PRINT_STDIN_MAX_BYTES);
                const maxBytes = Number.isFinite(rawMax) && rawMax >= 0 ? rawMax : 1_048_576;
                piped = await new Promise<string>((resolveStdin) => {
                        let data = "";
                        let settled = false;
                        let idleTimer: ReturnType<typeof setTimeout> | null = null;
                        const settle = () => {
                                if (settled) return;
                                settled = true;
                                if (idleTimer) clearTimeout(idleTimer);
                                try {
                                        process.stdin.removeAllListeners("data");
                                        process.stdin.removeAllListeners("end");
                                        process.stdin.pause();
                                } catch {
                                        /* already destroyed — nothing to do */
                                }
                                resolveStdin(data);
                        };
                        process.stdin.setEncoding("utf8");
                        process.stdin.on("data", (c: string) => {
                                data += c;
                                if (data.length >= maxBytes) {
                                        settle(); // byte cap: stop draining an endless pipe
                                        return;
                                }
                                if (idleTimer) clearTimeout(idleTimer);
                                // Re-arm: keep reading while the pipe delivers. REF'd on
                                // purpose — the F10 lesson (print-mode timers, 2026-10-22):
                                // an unref'd timer never wakes a Bun event loop parked on
                                // an idle-but-open pipe's poll. Measured live (2026-10-23):
                                // `unown -p` with a silent open stdin (a supervisor's
                                // control pipe) hung >110s with the 500ms idle timer armed
                                // but unref'd — the loop had nothing ref'd left to wake it.
                                // Ref'd is safe: settle() clears it, and the byte cap +
                                // idle window bound the read either way.
                                idleTimer = setTimeout(settle, idleMs);
                        });
                        process.stdin.on("end", settle);
                        // Same F10 mirror for the initial arm (see comment above).
                        idleTimer = setTimeout(settle, idleMs);
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
        // M3 answer ping (notify.ts): a SEPARATE clock from the json lane's
        // startedAt — the ping's wall time starts at cmdPrint entry (preflight,
        // stdin drain and boot are all part of the session the user waited
        // through), while the json envelope's clock only runs when it is built.
        const answerStartedAt = Date.now();
        const answerWatch = createAnswerWatch();
        const { runtime } = await bootRuntime(cwd, verbose, {
                jsonMode: args.jsonMode,
                noSession: args.noSession,
                sessionFile: args.sessionFile,
                tools: args.tools,
                appendSystemPromptPath: args.appendSystemPromptPath,
                plan: args.plan,
                noSplit: args.noSplit,
                goal: args.goal,
                // M3 answer ping (notify.ts): the wall clock starts at cmdPrint entry
                // (preflight, stdin drain and boot are all part of the session the user
                // waited through) and the arrival timestamp comes from the final
                // agent_end — see the answer-watch extension below.
                extraExtensions: [...(capture ? [createOutputCaptureExtension(capture)] : []), answerWatch.extension],
                // Milestone 2.1 + 2.2 — surface the routing fields (set by
                // parseSubagentFlags inside parseArgs). bootRuntime applies
                // them to process.env via applySubagentEnvOverrides BEFORE
                // the session is created.
                model: args.model,
                effort: args.effort,
                mcpServers: args.mcpServers,
                noAgentsMd: args.noAgentsMd,
                provider: args.provider,
        });
        installPrintStallWatchdog(runtime);
        // The fleet drain sentinel rides as the final message in orchestrator
        // runs: the fleet's input handler intercepts it (never model-visible)
        // and waits for async subagents so their steer-back results land while
        // the process is alive. Subagent runs carry no fleet — the sentinel
        // would leak to the model — so it is omitted there.
        const drainTail = process.env.UNOWN_SUBAGENT === "1" ? [] : [FLEET_DRAIN_SENTINEL];
        if (wantResultJson && capture) {
                const wrap = captureStdout();
                let code = 0;
                try {
                        code = await runPrintMode(runtime as any, { mode: "text", messages: [message, ...drainTail] });
                } finally {
                        const text = wrap.unwrap().trim();
                        // --no-session: the id names an ephemeral in-memory
                        // session — nothing to resume, so the contract says null.
                        if (args.noSession) capture.sessionId = null;
                        // F11 empty-answer guard (2026-10-23): never report success on an
                        // empty result — a silent empty 200 from the upstream (see the
                        // bridge/pi-ai guards) must not reach automation callers as
                        // subtype "success" + exit 0.
                        const emptyAnswer = code === 0 && text.length === 0;
                        const result = assembleResultJson({
                                capture,
                                text,
                                subtype: code === 0 && !emptyAnswer ? "success" : "error_during_execution",
                                durationMs: Date.now() - startedAt,
                                version: VERSION,
                        });
                        process.stdout.write(JSON.stringify(result) + "\n");
                        if (emptyAnswer) {
                                console.error("unown: the run ended without an answer (empty completion) — reported as error, not success");
                                process.exit(1);
                        }
                }
                process.exit(code);
        }
        const code = await runPrintMode(runtime as any, {
                mode: args.jsonMode ? "json" : "text",
                messages: [message, ...drainTail],
        });
        // F11 empty-answer guard (2026-10-23, text lane): a completed run whose
        // final assistant message carries no text is NOT success. Measured live:
        // an Agnes flash upstream under concurrent load answers 200 streams with
        // zero content — pre-fix, print mode wrote an empty stdout and exited 0,
        // poison for every unattended caller (CI, engine automations, scripts).
        // The bridge retry + pi-ai's empty-completion throw are the first two
        // layers; this is the last net: a loud stderr line + exit 1. The
        // --mode json event stream is exempt (its consumer sees the raw events);
        // --output-format json is guarded in its own branch above.
        if (!args.jsonMode && code === 0 && (answerWatch.answer?.text ?? "").trim().length === 0) {
                console.error(
                        "unown: the model returned an empty answer (no text content) — likely an upstream fault; retry the run (the bridge and the provider layer already retried once each)",
                );
                process.exit(1);
        }
        // M3 answer ping (notify.ts) — TEXT LANE ONLY: `--mode json` streams
        // JSONL events and `--output-format json` returned above, so neither
        // framed channel can ever see these bytes. runPrintMode has already
        // printed AND flushed the answer by the time it resolves (its finally
        // awaits flushRawStdout), so the escape lands on a quiet stream right
        // after the answer it announces. The TUI never runs this code — see
        // notify.ts for why that lane is skipped (user present; frame loop).
        if (
                !args.jsonMode &&
                shouldNotifyOnAnswer({
                        elapsedMs: (answerWatch.answer?.at ?? Date.now()) - answerStartedAt,
                        thresholdMs: notifyThresholdMs(),
                        gated: notifyGated(process.stdout.isTTY === true),
                        answer: answerWatch.answer,
                })
        ) {
                emitOsc9("unown", truncateForNotify(answerWatch.answer?.text ?? ""));
        }
        process.exit(code);
}

async function cmdTui(prompt: string | undefined, verbose: boolean, bootOpts: BootOptions = {}) {
        const cwd = process.cwd();
        await ensureUnownAgentDirInfoAsync();
        maybeShowUpdateNotice();
        // M3 first-run onboarding (W1): a FRESH seed on an interactive TTY gets
        // the offer to connect a provider BEFORE the TUI boots — the guided
        // wizard (presets + live verification) instead of discovering the
        // bundled-bridge default by trial. Declining keeps today's behaviour:
        // the seeded bridge + the first-run banner.
        // Hermes-posture (the reverse-engineered onboarding): state the
        // situation plainly, make the offer ONE yes/no, name the recovery
        // command on decline, and never re-ask (the `created` gate). The wizard
        // itself is the SAME flow `unown setup` runs — one source of truth.
        const init = unownAgentDirInit();
        let wizardSucceeded = false;
        let gateBridgeUp: boolean | undefined;
        if (init?.created && process.stdin.isTTY && process.stdout.isTTY && !bootOpts.provider && !bootOpts.model) {
                gateBridgeUp = (await bridgeHealth(1000))?.ok === true;
                const gate = firstRunGateLines(gateBridgeUp);
                if (promptYesNo(gate.question, true)) {
                        const code = await runSetupCommand([]);
                        wizardSucceeded = code === 0;
                        if (code === 0) console.log("\nStarting the session with your provider…\n");
                        else console.log(`\n${gate.wizardFailed}\n`);
                } else {
                        for (const line of gate.declined) console.log(line);
                }
        }
        // Pre-flight honors the CLI pin: --provider / --model provider/… probe
        // THAT provider (warn-and-continue here, unlike print mode's exit 1).
        const pre = await runPreflight(bootOpts.provider ?? bootOpts.model);
        // The first-run banner is redundant after a completed wizard — its setup
        // summary already said everything. Keep it for the decline/no-wizard path
        // (and print mode, which never runs a wizard).
        if (!wizardSucceeded) await printFirstRunBanner(gateBridgeUp);
        if (pre) {
                // Warn and continue: the user may start the stack in another
                // terminal — pi's built-in retries cover that window.
                console.log(`⚠ pre-flight: ${pre.message}`);
                console.log(`  → ${pre.hint}`);
                console.log();
        }
        const { runtime } = await bootRuntime(cwd, verbose, {
                ...bootOpts,
                // First flights: the positional prompt becomes the TUI's
                // initialMessage — surface it to bootRuntime so the flights
                // extension can suppress the startup catalog.
                initialMessage: prompt,
        });
        const mode = new InteractiveMode(runtime as any, {
                // Brand the interactive TUI as unown (header, terminal title); suppress pi's own update check.
                appName: "unown",
                appVersion: VERSION,
                ...(prompt ? { initialMessage: prompt } : {}),
        });
        await mode.run(); // blocks until exit; normal exit path is process.exit(0)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
const DOCTOR_HELP = `unown doctor — diagnose configuration, bridge, engine and memory

Checks the agent-home layout, model configuration, the chat path (the only
hard-fail: a broken chat path), engine health + version skew (M8: an engine
older than the agent warns with the restart fix), memory materialization, the
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

const WEBCACHE_HELP = `unown webcache — inspect the web results store

The web results store is the persistent cache behind web_search + webfetch
(and the fetch_url alias): one user-scoped on-disk store shared by every
surface that touches the web — terminal sessions, parallel subagents, engine
runs, automations. Search results are TTL-fresh (default 60 min); fetched
pages honor origin Cache-Control (heuristic default 30 min, capped 24 h) and
revalidate via ETag/Last-Modified — a 304 re-serves the stored body without
paying for a full fetch. When every upstream attempt fails, the last good
answer serves within a bounded stale-if-error window (24 h search / 7 d
fetch), always flagged as stale. \`unown doctor\` reports the same summary.

usage: unown webcache [stats] [--json]
       unown webcache clear
       unown webcache sweep
  stats    the summary: enabled state, store root, entries + size vs the
           byte cap, TTLs, hit rate (hits + revalidations / lookups), saved
           upstream requests, event totals, top providers. Default when no
           subcommand is given. --json prints the raw WebCacheStats object.
  clear    remove every entry (the events feed is kept, so history stays)
  sweep    run the byte-capped LRU eviction pass on demand (normally
           amortized across writes)

Env: UNOWN_WEB_CACHE=0 disables the store entirely; the TTL / stale-window /
byte-cap / store-dir knobs are documented in docs/configuration.md.`;

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
                providers: PROVIDERS_HELP,
                acp: ACP_HELP,
                "init-agents": INIT_AGENTS_HELP,
                "doctor-instructions": DOCTOR_INSTRUCTIONS_HELP,
                routines: AUTOMATIONS_USAGE,
                automations: AUTOMATIONS_USAGE,
                usage: USAGE_HELP,
                sessions: SESSIONS_USAGE,
                recipes: RECIPES_USAGE,
                wiki: WIKI_USAGE,
                webcache: WEBCACHE_HELP,
                watch: WATCH_USAGE,
                ralph: RALPH_USAGE,
                dashboard: DASHBOARD_HELP,
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
        if (first === "providers") process.exit(await runProvidersCommand(argv.slice(1)));
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
        if (first === "engine") {
                // M3 — `unown engine status|start|stop|serve`: supervision for the
                // detached self-learning engine (engine-cli.ts). Owns its own flag
                // grammar; dispatch before the generic parser would eat the
                // subcommand tokens as prompt text.
                const code = await runEngineCommand(argv.slice(1));
                process.exit(code);
        }
        if (first === "dashboard" || first === "dash") {
                // The TUI mission control (docs/tui-dashboard-plan.md): a
                // standalone fullscreen dashboard over the engine REST+SSE
                // surface — the Next.js dashboard's terminal-native successor.
                process.exit(await runDashboardCommand(argv.slice(1)));
        }
        if (first === "routines" || first === "automations") {
                // Routines — scheduled recurring agent runs (the zcode Automations
                // port, grown the v2 recurrence semantics); see automations-cli.ts.
                // "automations" stays as the historical alias.
                const result = await runAutomationsCommand(argv.slice(1), { cwd: process.cwd() });
                if (result.stdout) process.stdout.write(result.stdout);
                if (result.stderr) process.stderr.write(result.stderr);
                process.exit(result.exitCode);
        }
        if (first === "watch") {
                // M3 — `unown watch list|run|roots`: the AI-comment watch (aider's
                // --watch-files semantics on the always-on engine). Owns its own flag
                // grammar; dispatch before the generic parser would eat the
                // subcommand tokens as prompt text.
                const result = await runWatchCommand(argv.slice(1), { cwd: process.cwd() });
                if (result.stdout) process.stdout.write(result.stdout);
                if (result.stderr) process.stderr.write(result.stderr);
                process.exit(result.exitCode);
        }
        if (first === "repomap") {
                // M6 — `unown repomap`: the graph-ranked tree-sitter symbol map
                // (aider's repomap). Owns its flag grammar; dispatched before the
                // generic parser for the same reason as watch.
                const result = await runRepomapCliCommand(argv.slice(1), { cwd: process.cwd() });
                if (result.stdout) process.stdout.write(result.stdout);
                if (result.stderr) process.stderr.write(result.stderr);
                process.exit(result.exitCode);
        }
        if (first === "ralph") {
                // M4 — `unown ralph "<task>"`: the worker→reviewer loop (goose's
                // Ralph pattern). Owns its own flag grammar (a quoted free-text
                // task + flags); dispatched before the generic parser for the
                // same reason as watch.
                const result = await runRalphCommand(argv.slice(1), { cwd: process.cwd() });
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
        if (first === "webcache") {
                // M3 — `unown webcache stats|clear|sweep` manages the web
                // results store (webcache.ts). Owns its own flag grammar;
                // dispatch before the generic parser would eat the
                // subcommand tokens as prompt text.
                process.exit(cmdWebcache(argv.slice(1)));
        }
        if (first === "blame") {
                // Audit 2-b F2 — `unown blame` used to be swallowed as a one-word
                // LLM prompt; it is a real command now (the CLI twin of /blame).
                process.exit(cmdBlame(argv.slice(1)));
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
                await ensureUnownAgentDirAsync(); // silent scaffold — no banners: stdout is protocol
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
                        console.error(
                                "usage: unown update [--check] [--json] [--allow-dirty] [--rollback] [--dry-run] " +
                                        "[--skip [version]] [--unskip] [--snooze <duration>] [version]",
                        );
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
        // Unknown-command guard (audit 2-b F1 / 2-a-1 F1): a LONE command-like
        // first word that matches no subcommand is almost certainly a typo —
        // and the failure mode it used to hit was the worst kind: the word was
        // silently folded into a full LLM session (a 19k-token system prompt
        // and a model turn burned on "badcommand"). Error out instead, with
        // the nearest commands as suggestions. Multi-word prompts and
        // non-command-like words still start a session, exactly as before.
        {
                const KNOWN_COMMANDS = new Set([
                        "help",
                        "setup",
                        "providers",
                        "models",
                        "doctor",
                        "info",
                        "init-agents",
                        "doctor-instructions",
                        "mcp",
                        "engine",
                        "routines",
                        "automations",
                        "watch",
                        "usage",
                        "webcache",
                        "blame",
                        "sessions",
                        "recipes",
                        "wiki",
                        "completions",
                        "acp",
                        "uninstall",
                        "update",
                        "changelog",
                        "init",
                        "memory",
                        "note",
                ]);
                const VALUE_FLAGS = new Set([
                        "--mode",
                        "--session",
                        "--output-format",
                        "--goal",
                        "--tools",
                        "--append-system-prompt",
                        "--model",
                        "--effort",
                        "--mcp-servers",
                        "--provider",
                ]);
                const positionals: string[] = [];
                let sawFlag = false;
                for (let i = 0; i < argv.length; i++) {
                        const a = argv[i];
                        if (a === "--") break; // everything after -- is prompt text
                        if (a.startsWith("-")) {
                                sawFlag = true; // explicit intent (-p, --plan, --model …): never a typo guard
                                if (VALUE_FLAGS.has(a)) i++; // skip the flag's value
                                continue;
                        }
                        positionals.push(a);
                }
                const firstWord = positionals[0];
                if (
                        !sawFlag &&
                        positionals.length === 1 &&
                        firstWord &&
                        /^[a-z][a-z0-9_-]*$/i.test(firstWord) &&
                        !KNOWN_COMMANDS.has(firstWord.toLowerCase())
                ) {
                        const lower = firstWord.toLowerCase();
                        const near = [...KNOWN_COMMANDS]
                                .filter((c) => c.startsWith(lower.slice(0, 2)) || lower.startsWith(c.slice(0, 2)))
                                .sort()
                                .slice(0, 4);
                        console.error(`unown: unknown command "${firstWord}"`);
                        if (near.length) console.error(`  did you mean: ${near.map((c) => `unown ${c}`).join(", ")}?`);
                        console.error(`  run \`unown --help\` for the command list.`);
                        console.error(
                                `  to run a one-word prompt instead, use -p: unown -p "${firstWord}"\n` +
                                        `  (or add more words: unown ${firstWord} the failing tests)`,
                        );
                        process.exit(2);
                }
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
                                noSplit: args.noSplit,
                                goal: args.goal,
                                // Fleet lane: --session <path> continues a specific
                                // session file (the resume substrate).
                                sessionFile: args.sessionFile,
                                // Milestone 2.1 + 2.2 — surface the routing fields
                                // (set by parseSubagentFlags inside parseArgs) into
                                // the TUI boot path so applySubagentEnvOverrides
                                // (called inside bootRuntime) honors them.
                                model: args.model,
                                effort: args.effort,
                                mcpServers: args.mcpServers,
                                noAgentsMd: args.noAgentsMd,
                                provider: args.provider,
                        });
                        break;
        }
}
