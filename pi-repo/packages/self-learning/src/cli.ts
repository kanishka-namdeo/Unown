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
 *   unown init            scaffold .unown/ memory scaffold in this project
 *   unown memory          print the effective 4-tier memory stack
 *   unown doctor          diagnose configuration, bridge, engine and memory
 *   unown note "text"     hand a note to the engine (for AutoDream)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
        createAgentSessionServices,
        createAgentSessionRuntime,
        createAgentSessionFromServices,
        InteractiveMode,
        runPrintMode,
        SessionManager,
        SettingsManager,
        type CreateAgentSessionRuntimeFactory,
} from "../../coding-agent/dist/index.js";
import {
        UNOWN_HOME,
        UNOWN_AGENT_DIR,
        ENGINE_URL,
        STRICT_HOOKS,
        ensureUnownAgentDir,
        initProjectMemory,
        resolveTerminalMemory,
        projectMemoryPath,
        deliverTerminalNote,
} from "./term.ts";
import { createTerminalExtension } from "./termhooks.ts";

const HELP = `unown — a self-improving terminal coding agent

Usage:
  unown                    interactive session in the current directory
  unown "do something"     interactive session starting with a prompt
  unown -p "prompt"        one-shot headless run (print mode)
  unown init               scaffold .unown/ project memory
  unown memory             print the effective memory stack
  unown doctor             run configuration diagnostics
  unown note "text"        deliver a session note to the engine
  unown --help             this help

Environment:
  UNOWN_HOME               state dir (default ~/.unown)
  UNOWN_ENGINE_URL         self-learning engine (default http://127.0.0.1:3030)
  UNOWN_STRICT_HOOKS=1     sandbox-grade hooks (blocks network, git push, sudo)
  PI_BRIDGE_URL/PI_MODEL_ID/PI_PROVIDER   LLM endpoint for ~/.unown/agent/models.json
`;

// ---------------------------------------------------------------------------
// Simple argument parsing
// ---------------------------------------------------------------------------
interface CliArgs {
        command: "tui" | "print" | "init" | "memory" | "doctor" | "note" | "help";
        prompt?: string;
        verbose: boolean;
}

function parseArgs(argv: string[]): CliArgs {
        const rest: string[] = [];
        let print = false;
        let verbose = false;
        for (let i = 0; i < argv.length; i++) {
                const a = argv[i];
                if (a === "--help" || a === "-h") return { command: "help", verbose };
                if (a === "--print" || a === "-p") {
                        print = true;
                        continue;
                }
                if (a === "--verbose" || a === "-v") {
                        verbose = true;
                        continue;
                }
                rest.push(a);
        }
        const first = rest[0];
        if (first === "init" || first === "memory" || first === "doctor" || first === "note") {
                const prompt = rest.slice(1).join(" ");
                return { command: first, prompt, verbose };
        }
        const prompt = rest.join(" ");
        // Non-TTY stdio forces print mode (same behaviour as pi itself).
        if (print || !process.stdin.isTTY || !process.stdout.isTTY) return { command: "print", prompt, verbose };
        return { command: "tui", prompt, verbose };
}

// ---------------------------------------------------------------------------
// Agent boot (shared by TUI and print mode)
// ---------------------------------------------------------------------------
async function bootRuntime(cwd: string, verbose: boolean) {
        const agentDir = ensureUnownAgentDir();
        const memoryFiles = resolveTerminalMemory(cwd).map((f) => ({ path: f.path, content: f.content }));
        const extension = createTerminalExtension({ cwd, engineUrl: ENGINE_URL, strict: STRICT_HOOKS, verbose });

        const settingsManager = SettingsManager.create(cwd, agentDir);

        const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd: sessionCwd, sessionManager, sessionStartEvent }) => {
                const services = await createAgentSessionServices({
                        cwd: sessionCwd,
                        agentDir,
                        settingsManager,
                        resourceLoaderOptions: {
                                extensionFactories: [extension as any],
                                agentsFilesOverride: (base: any) => ({
                                        // Supplement (not replace) the user's own AGENTS.md/CLAUDE.md chain.
                                        agentsFiles: [...base.agentsFiles, ...memoryFiles],
                                }),
                        },
                });
                const created = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent });
                return { ...created, services, diagnostics: services.diagnostics };
        };

        const sessionManager = SessionManager.create(cwd, join(UNOWN_AGENT_DIR, "sessions"));
        const runtime = await createAgentSessionRuntime(createRuntime, { cwd, agentDir, sessionManager });
        return { runtime, memoryFiles };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
function cmdInit() {
        const cwd = process.cwd();
        const dir = initProjectMemory(cwd);
        console.log(`✓ initialized ${dir.replace(cwd, ".")}`);
        console.log(`  ${projectMemoryPath(cwd).replace(cwd, ".")}   project memory (commit this — AutoDream maintains it)`);
        console.log(`  ./.unown/memory/local.md            local overrides (gitignored)`);
        console.log(`  ./.unown/.gitignore                 ignores local overrides`);
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

async function cmdDoctor() {
        const cwd = process.cwd();
        let ok = true;
        const check = (label: string, pass: boolean, detail: string) => {
                console.log(`${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
                if (!pass) ok = false;
        };

        // 1. agent dir & models
        const agentDir = ensureUnownAgentDir();
        const modelsExists = existsSync(join(agentDir, "models.json"));
        check("agent dir", modelsExists, agentDir);
        if (modelsExists) {
                try {
                        const models = JSON.parse(readFileSync(join(agentDir, "models.json"), "utf8"));
                        const providers = Object.keys(models.providers ?? {});
                        check("model provider configured", providers.length > 0, providers.join(", ") || "none");
                } catch {
                        check("models.json parses", false, "invalid JSON");
                }
        }

        // 2. memory stack
        initProjectMemory(cwd);
        check("project memory", existsSync(projectMemoryPath(cwd)), projectMemoryPath(cwd).replace(cwd, "."));
        check("user memory", true, `${UNOWN_HOME}/memory/user.md`);

        // 3. bridge health
        try {
                const res = await fetch(`${process.env.PI_BRIDGE_URL ?? "http://127.0.0.1:3031"}/health`, { signal: AbortSignal.timeout(3000) });
                const body: any = await res.json();
                check("LLM bridge", res.ok && body.ok, `${body.requests ?? 0} requests, ${body.errors ?? 0} errors`);
        } catch (err: any) {
                check("LLM bridge", false, `unreachable (${err?.message ?? err}) — start it with: bun run agent:start`);
        }

        // 4. engine health (notes + dreams + dashboard)
        try {
                const res = await fetch(`${ENGINE_URL}/api/overview`, { signal: AbortSignal.timeout(3000) });
                const body: any = await res.json();
                check("self-learning engine", res.ok && body.ok, `${body?.kpis?.totalRuns ?? "?"} runs, ${body?.kpis?.dreams ?? "?"} dreams`);
        } catch (err: any) {
                check("self-learning engine", false, `unreachable (${err?.message ?? err}) — notes will queue in ${UNOWN_HOME}/notes/outbox`);
        }

        console.log(ok ? `\n✓ unown is ready in ${cwd}` : `\n✗ unown has configuration problems (see above)`);
        process.exit(ok ? 0 : 1);
}

async function cmdNote(text: string) {
        if (!text.trim()) {
                console.error("usage: unown note \"something worth remembering\"");
                process.exit(1);
        }
        const result = await deliverTerminalNote({ content: text, projectPath: process.cwd(), ts: Date.now() });
        console.log(result.delivered ? `✓ note delivered to the engine` : `· engine unreachable — note queued in outbox (${result.detail ?? ""})`);
        process.exit(0);
}

async function cmdPrint(prompt: string | undefined, verbose: boolean) {
        const cwd = process.cwd();
        // Piped stdin (e.g. `cat error.log | unown -p "fix this"`) joins the prompt.
        let piped = "";
        if (!process.stdin.isTTY) {
                piped = await new Promise<string>((resolveStdin) => {
                        let data = "";
                        process.stdin.setEncoding("utf8");
                        process.stdin.on("data", (c) => (data += c));
                        process.stdin.on("end", () => resolveStdin(data));
                        setTimeout(() => resolveStdin(data), 500); // short pipe timeout
                });
        }
        const message = [prompt, piped.trim()].filter(Boolean).join("\n\n");
        if (!message) {
                console.error("unown: no prompt given (pass one or pipe stdin)");
                process.exit(1);
        }
        const { runtime } = await bootRuntime(cwd, verbose);
        const code = await runPrintMode(runtime as any, { mode: "text", messages: [message] });
        process.exit(code);
}

async function cmdTui(prompt: string | undefined, verbose: boolean) {
        const cwd = process.cwd();
        const { runtime } = await bootRuntime(cwd, verbose);
        const mode = new InteractiveMode(runtime as any, prompt ? { initialMessage: prompt } : {});
        await mode.run(); // blocks until exit; normal exit path is process.exit(0)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export async function runCli(argv: string[]) {
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
                case "doctor":
                        await cmdDoctor();
                        break;
                case "note":
                        await cmdNote(args.prompt ?? "");
                        break;
                case "print":
                        await cmdPrint(args.prompt, args.verbose);
                        break;
                case "tui":
                        await cmdTui(args.prompt, args.verbose);
                        break;
        }
}
