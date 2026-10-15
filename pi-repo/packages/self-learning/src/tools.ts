/**
 * tools.ts — Claude Code-grade session tools for the unown terminal agent.
 *
 * One bundled inline extension (`unown-tools`, wired in cli.ts) that gives a
 * plain pi session the capabilities a 2026 coding agent is expected to have:
 *
 *   - `todo` tool + /todos      visible task tracking (state rides session
 *                               entries, so branching keeps correct todos)
 *   - `task` tool + /agents     subagents with a FRESH context window — they
 *                               are full unown agents (memory + guardrails +
 *                               note capture), spawned as `unown --mode json`
 *                               subprocesses; agent definitions live in
 *                               .unown/agents/*.md (project) and
 *                               ~/.unown/agent/agents/*.md (user)
 *   - `note` tool + /note       record durable learning notes MID-session
 *                               (delivered to the engine immediately; AutoDream
 *                               consolidates them into project memory)
 *   - `fetch_url` tool          read-only HTTP GET, HTML stripped, capped
 *   - /plan + --plan flag       plan mode: read-only toolset, bash allowlist,
 *                               numbered "Plan:" extraction, approve-to-execute
 *                               flow with [DONE:n] progress tracking
 *   - /learning                 re-print the effective 4-tier memory stack
 *
 * Subagents never nest (UNOWN_SUBAGENT=1 disables the `task` tool inside a
 * subagent) and every subagent session writes its own note — subagents learn
 * too.
 */
import { spawn } from "node:child_process";
import { type Dirent, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { type ExtensionAPI, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Key, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { deliverTerminalNote, resolveTerminalMemory, UNOWN_AGENT_DIR } from "./term.ts";

// ---------------------------------------------------------------------------
// Subagent registry: built-ins + .unown/agents/*.md + ~/.unown/agent/agents/*.md
// ---------------------------------------------------------------------------

export interface SubagentConfig {
	name: string;
	description: string;
	tools?: string[];
	systemPrompt: string;
	source: "built-in" | "user" | "project";
}

const BUILTIN_AGENTS: SubagentConfig[] = [
	{
		name: "general",
		description:
			"General-purpose coding subagent with the full unown toolset (read/write/edit/bash + todo/note/fetch_url) and the same tiered memory. Use for self-contained implementation or investigation tasks that deserve a fresh context.",
		systemPrompt: `You are unown's general-purpose coding subagent. You run inside the user's project with unown's tiered memory injected and guardrail hooks active.

You receive ONE self-contained task; you do not see the parent conversation. Do the task completely, then report back concisely:
- what you did (files touched, commands run)
- the result / answer, with evidence (command output, file:line references)
- anything the parent agent should know (blockers, follow-ups)

Use the todo tool to track multi-step work. Record durable project pitfalls you discover with the note tool. Be direct and factual; no filler.`,
		source: "built-in",
	},
	{
		name: "explore",
		description:
			"Read-only exploration subagent (read/grep/find/ls only). Maps where things live in the repo and returns file:line evidence. Use whenever the parent context would be polluted by broad code search.",
		tools: ["read", "grep", "find", "ls"],
		systemPrompt: `You are unown's exploration subagent — read-only. You cannot write, edit, or run state-changing commands; bash is limited to read-only inspection.

You receive ONE self-contained question about the codebase. Answer it with evidence:
- enumerate the relevant files with their roles
- cite file:line for every claim
- end with a short direct answer first, details after

Do not propose changes; do not edit anything. If the answer is not in the repo, say so.`,
		source: "built-in",
	},
];

type AgentFrontmatter = {
	name?: unknown;
	description?: unknown;
	tools?: unknown;
};

function parseToolList(value: unknown): string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const tools = raw
		.filter((t): t is string => typeof t === "string")
		.map((t) => t.trim())
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): SubagentConfig[] {
	const agents: SubagentConfig[] = [];
	if (!existsSync(dir)) return agents;
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}
	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		const filePath = join(dir, entry.name);
		let content: string;
		try {
			content = readFileSync(filePath, "utf8");
		} catch {
			continue;
		}
		let frontmatter: AgentFrontmatter | undefined;
		try {
			({ frontmatter } = parseFrontmatter<AgentFrontmatter>(content));
		} catch {
			continue;
		}
		const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
		if (!frontmatter) continue;
		if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") continue;
		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: parseToolList(frontmatter.tools),
			systemPrompt: body.trim(),
			source,
		});
	}
	return agents;
}

/** Built-ins first; project-level .unown/agents/*.md overrides user-level by name. */
export function discoverSubagents(cwd: string): SubagentConfig[] {
	const user = loadAgentsFromDir(join(UNOWN_AGENT_DIR, "agents"), "user");
	const project = loadAgentsFromDir(join(cwd, ".unown", "agents"), "project");
	const byName = new Map<string, SubagentConfig>();
	for (const a of BUILTIN_AGENTS) byName.set(a.name, a);
	for (const a of user) byName.set(a.name, a);
	for (const a of project) byName.set(a.name, a);
	return [...byName.values()];
}

// ---------------------------------------------------------------------------
// Subagent process runner — spawns `unown --mode json -p --no-session`
// ---------------------------------------------------------------------------

const SUBAGENT_TIMEOUT_MS = 300_000;
const SUBAGENT_OUTPUT_CAP = 16_000;
const SUBAGENT_STDERR_CAP = 2_000;

export interface SubagentRunResult {
	agent: string;
	task: string;
	exitCode: number;
	output: string;
	stderr: string;
	toolResults: number;
	usage: { input: number; output: number; turns: number };
}

function getUnownInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	return { command: "unown", args };
}

function assistantText(message: any): string {
	if (!message || message.role !== "assistant") return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((b: any) => b?.type === "text" && typeof b.text === "string")
		.map((b: any) => b.text)
		.join("\n");
}

function formatTokens(count: number): string {
	if (count < 1000) return String(count);
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

/** Spawn one unown subagent and collect its JSON event stream. */
export async function runSubagent(
	agent: SubagentConfig,
	task: string,
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<SubagentRunResult> {
	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

	let promptDir: string | null = null;
	const result: SubagentRunResult = {
		agent: agent.name,
		task,
		exitCode: 0,
		output: "",
		stderr: "",
		toolResults: 0,
		usage: { input: 0, output: 0, turns: 0 },
	};

	try {
		if (agent.systemPrompt.trim()) {
			promptDir = mkdtempSync(join(tmpdir(), "unown-subagent-"));
			const promptFile = join(promptDir, "system-prompt.md");
			writeFileSync(promptFile, agent.systemPrompt, { encoding: "utf8", mode: 0o600 });
			args.push("--append-system-prompt", promptFile);
		}
		args.push(`Task: ${task}`);

		await new Promise<void>((resolve) => {
			const invocation = getUnownInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, UNOWN_SUBAGENT: "1" },
			});
			let buffer = "";
			let stderrBuffer = "";
			let lastText = "";
			let settled = false;

			const finish = () => {
				if (settled) return;
				settled = true;
				clearTimeout(watchdog);
				result.output = lastText.slice(0, SUBAGENT_OUTPUT_CAP);
				result.stderr = stderrBuffer.slice(0, SUBAGENT_STDERR_CAP);
				resolve();
			};

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: any;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}
				if (event?.type === "message_end" && event.message) {
					const msg = event.message;
					if (msg.role === "assistant") {
						result.usage.turns++;
						const usage = msg.usage;
						if (usage) {
							result.usage.input += usage.input || 0;
							result.usage.output += usage.output || 0;
						}
						const text = assistantText(msg);
						if (text.trim()) lastText = text;
					}
				} else if (event?.type === "tool_result_end") {
					result.toolResults++;
				}
			};

			proc.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});
			proc.stderr.on("data", (data) => {
				stderrBuffer += data.toString();
			});
			proc.on("close", (code) => {
				if (buffer.trim()) processLine(buffer);
				result.exitCode = code ?? 0;
				finish();
			});
			proc.on("error", () => {
				result.exitCode = 1;
				stderrBuffer += "failed to spawn subagent process";
				finish();
			});

			const watchdog = setTimeout(() => {
				stderrBuffer += `\n(subagent timed out after ${SUBAGENT_TIMEOUT_MS / 1000}s and was killed)`;
				proc.kill("SIGTERM");
				setTimeout(() => {
					try {
						proc.kill("SIGKILL");
					} catch {
						/* already gone */
					}
				}, 5000);
			}, SUBAGENT_TIMEOUT_MS);

			const killProc = () => {
				stderrBuffer += "\n(subagent aborted)";
				proc.kill("SIGTERM");
			};
			if (signal) {
				if (signal.aborted) killProc();
				else signal.addEventListener("abort", killProc, { once: true });
			}
		});
	} finally {
		if (promptDir) {
			try {
				rmSync(promptDir, { recursive: true, force: true });
			} catch {
				/* best effort */
			}
		}
	}
	return result;
}

// ---------------------------------------------------------------------------
// fetch_url helpers
// ---------------------------------------------------------------------------

function htmlToText(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|blockquote|pre|ul|ol|dl)>/gi, "\n")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

async function fetchUrlText(url: string, maxChars: number): Promise<string> {
	const parsed = new URL(url);
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`only http(s) URLs are supported (got ${parsed.protocol})`);
	}
	const res = await fetch(parsed, {
		redirect: "follow",
		signal: AbortSignal.timeout(20_000),
		headers: { "user-agent": "unown-fetch-url/1.0" },
	});
	const contentType = res.headers.get("content-type") ?? "";
	const declaredLength = Number(res.headers.get("content-length") ?? "0");
	if (declaredLength && declaredLength > 2_000_000) {
		throw new Error(
			`refusing to fetch ${url}: body too large (${(declaredLength / 1_000_000).toFixed(1)} MB > 2 MB cap)`,
		);
	}
	const raw = await res.text();
	if (raw.length > 4_000_000) throw new Error(`body too large (${raw.length} chars > cap)`);
	const looksHtml = /text\/html/i.test(contentType) || /^\s*(<!doctype html|<html)/i.test(raw);
	const text = looksHtml ? htmlToText(raw) : raw;
	const statusLine = `GET ${url} → ${res.status}${contentType ? ` (${contentType.split(";")[0]})` : ""}`;
	if (!res.ok) {
		return `${statusLine}\n\n${text.slice(0, maxChars) || "(empty body)"}`;
	}
	if (text.length <= maxChars) return `${statusLine}\n\n${text}`;
	return `${statusLine}\n\n${text.slice(0, maxChars)}\n\n… (truncated at ${maxChars} chars; full body was ${text.length} chars)`;
}

// ---------------------------------------------------------------------------
// Plan-mode helpers (adapted from pi's plan-mode example extension)
// ---------------------------------------------------------------------------

const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

const SAFE_PATTERNS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+--version/i,
	/^\s*python\s+--version/i,
	/^\s*curl\s/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*bat\b/,
];

export function isSafeCommand(command: string): boolean {
	const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
	const isSafe = SAFE_PATTERNS.some((p) => p.test(command));
	return !isDestructive && isSafe;
}

export interface PlanStep {
	step: number;
	text: string;
	completed: boolean;
}

export function extractPlanSteps(message: string): PlanStep[] {
	const items: PlanStep[] = [];
	const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i);
	if (!headerMatch) return items;
	const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
	const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;
	for (const match of planSection.matchAll(numberedPattern)) {
		const text = match[2]
			.trim()
			.replace(/\*{1,2}$/, "")
			.trim();
		if (text.length > 5 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
			const cleaned = text
				.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
				.replace(/\s+/g, " ")
				.trim();
			if (cleaned.length > 3) items.push({ step: items.length + 1, text: cleaned, completed: false });
		}
	}
	return items;
}

export function markCompletedSteps(text: string, items: PlanStep[]): number {
	let marked = 0;
	for (const match of text.matchAll(/\[DONE:(\d+)\]/gi)) {
		const step = Number(match[1]);
		const item = items.find((t) => t.step === step);
		if (item && !item.completed) {
			item.completed = true;
			marked++;
		}
	}
	return marked;
}

// ---------------------------------------------------------------------------
// The extension
// ---------------------------------------------------------------------------

export interface UnownToolsOptions {
	cwd: string; // the user's real project directory
	engineUrl: string;
	isSubagent?: boolean; // inside a spawned subagent: disable the task tool (no nesting)
	verbose?: boolean;
}

const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "todo", "note", "fetch_url"];
const PLAN_MODE_DISABLED_TOOLS = new Set(["edit", "write", "task"]);
const PLAN_MANAGED_TOOLS = new Set([...PLAN_MODE_TOOLS, ...PLAN_MODE_DISABLED_TOOLS, "edit", "write"]);

interface Todo {
	id: number;
	text: string;
	done: boolean;
}

interface TodoDetails {
	action: "list" | "add" | "toggle" | "clear";
	todos: Todo[];
	nextId: number;
	error?: string;
}

interface TaskRunDetails {
	runs: Array<{ agent: string; task: string; exitCode: number; turns: number; toolResults: number }>;
}

const TodoParams = Type.Object({
	action: StringEnum(["list", "add", "toggle", "clear"] as const),
	text: Type.Optional(Type.String({ description: "Todo text (for add)" })),
	id: Type.Optional(Type.Number({ description: "Todo ID (for toggle)" })),
});

const NoteParams = Type.Object({
	text: Type.String({
		description:
			"Durable learning note, delivered to the self-learning engine immediately. Concise imperative rule ('When X, do Y') covering a pitfall, convention, or decision worth remembering across sessions.",
	}),
});

const TaskParams = Type.Object({
	agent: Type.Optional(
		Type.String({ description: 'Subagent name (default "general"; run /agents to list). "explore" is read-only.' }),
	),
	task: Type.Optional(
		Type.String({
			description:
				"Self-contained task for the subagent. It does NOT see this conversation — include all needed detail.",
		}),
	),
	tasks: Type.Optional(
		Type.Array(
			Type.Object({
				agent: Type.Optional(Type.String({ description: "Subagent name (default general)" })),
				task: Type.String({ description: "Self-contained task" }),
			}),
			{ description: "Parallel mode: run several subagents at once (max 4)" },
		),
	),
});

const FetchParams = Type.Object({
	url: Type.String({ description: "http(s) URL to fetch (GET)" }),
	max_chars: Type.Optional(Type.Number({ description: "Cap on returned characters (default 12000)" })),
});

export function createUnownToolsExtension(opts: UnownToolsOptions) {
	const verbose = opts.verbose ?? false;
	const isSubagent = opts.isSubagent ?? process.env.UNOWN_SUBAGENT === "1";
	const log = (msg: string) => {
		if (verbose) console.error(`[unown-tools] ${msg}`);
	};

	const factory = (pi: ExtensionAPI) => {
		// ---- todo state (reconstructed from session entries so branching stays correct)
		let todos: Todo[] = [];
		let nextId = 1;

		const reconstructTodos = (ctx: any) => {
			todos = [];
			nextId = 1;
			try {
				for (const entry of ctx.sessionManager.getBranch()) {
					if (entry?.type !== "message") continue;
					const msg = entry.message;
					if (msg?.role !== "toolResult" || msg.toolName !== "todo") continue;
					const details = msg.details as TodoDetails | undefined;
					if (details) {
						todos = details.todos;
						nextId = details.nextId;
					}
				}
			} catch {
				/* session access is best-effort */
			}
		};

		// ---- plan-mode state
		let planModeEnabled = false;
		let executionMode = false;
		let planItems: PlanStep[] = [];
		let toolsBeforePlanMode: string[] | undefined;

		const uniqueTools = (names: string[]) => [...new Set(names)];
		const planModeTools = (active: string[]) =>
			uniqueTools([...active.filter((n) => !PLAN_MODE_DISABLED_TOOLS.has(n)), ...PLAN_MODE_TOOLS]);
		const normalTools = (active: string[]) =>
			uniqueTools([...active.filter((n) => !PLAN_MANAGED_TOOLS.has(n)), "read", "bash", "edit", "write"]);

		const enablePlanTools = () => {
			if (toolsBeforePlanMode === undefined) toolsBeforePlanMode = pi.getActiveTools();
			pi.setActiveTools(planModeTools(toolsBeforePlanMode));
		};
		const restoreNormalTools = () => {
			pi.setActiveTools(toolsBeforePlanMode ?? normalTools(pi.getActiveTools()));
			toolsBeforePlanMode = undefined;
		};

		const updateStatus = (ctx: any) => {
			if (!ctx?.hasUI) return;
			if (executionMode && planItems.length > 0) {
				const completed = planItems.filter((t) => t.completed).length;
				ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `plan ${completed}/${planItems.length}`));
				ctx.ui.setWidget(
					"plan-steps",
					planItems.map((item) =>
						item.completed
							? ctx.ui.theme.fg("success", "[x] ") + ctx.ui.theme.fg("muted", item.text)
							: ctx.ui.theme.fg("muted", `[ ] ${item.text}`),
					),
				);
			} else if (planModeEnabled) {
				ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "PLAN"));
				ctx.ui.setWidget("plan-steps", undefined);
			} else {
				ctx.ui.setStatus("plan-mode", undefined);
				ctx.ui.setWidget("plan-steps", undefined);
			}
		};

		const persistPlanState = () => {
			try {
				pi.appendEntry("unown-plan-mode", {
					enabled: planModeEnabled,
					steps: planItems,
					executing: executionMode,
					toolsBeforePlanMode,
				});
			} catch {
				/* persistence is best-effort */
			}
		};

		const togglePlanMode = (ctx: any) => {
			planModeEnabled = !planModeEnabled;
			executionMode = false;
			planItems = [];
			if (planModeEnabled) {
				enablePlanTools();
				ctx.ui.notify(
					"Plan mode ON — write tools disabled, bash allowlisted. Explore, then produce a numbered Plan.",
				);
			} else {
				restoreNormalTools();
				ctx.ui.notify("Plan mode OFF — full tool access restored.");
			}
			updateStatus(ctx);
			persistPlanState();
		};

		// -------------------------------------------------------------------
		// Tools
		// -------------------------------------------------------------------

		pi.registerTool({
			name: "todo",
			label: "Todo",
			description:
				"Manage a visible todo list so multi-step work stays on track. Actions: list, add (text), toggle (id), clear. Update the list as you go; the user sees it live.",
			parameters: TodoParams,
			async execute(_toolCallId, params) {
				let details: TodoDetails;
				let text: string;
				switch (params.action) {
					case "list":
						text = todos.length
							? todos.map((t) => `[${t.done ? "x" : " "}] #${t.id}: ${t.text}`).join("\n")
							: "No todos";
						details = { action: "list", todos: [...todos], nextId };
						break;
					case "add": {
						if (!params.text) {
							text = "Error: text required for add";
							details = { action: "add", todos: [...todos], nextId, error: "text required" };
							break;
						}
						const todo: Todo = { id: nextId++, text: params.text, done: false };
						todos.push(todo);
						text = `Added todo #${todo.id}: ${todo.text}`;
						details = { action: "add", todos: [...todos], nextId };
						break;
					}
					case "toggle": {
						const todo = todos.find((t) => t.id === params.id);
						if (!todo) {
							text = `Todo #${params.id} not found`;
							details = { action: "toggle", todos: [...todos], nextId, error: `#${params.id} not found` };
							break;
						}
						todo.done = !todo.done;
						text = `Todo #${todo.id} ${todo.done ? "completed" : "reopened"}`;
						details = { action: "toggle", todos: [...todos], nextId };
						break;
					}
					case "clear": {
						const count = todos.length;
						todos = [];
						nextId = 1;
						text = `Cleared ${count} todos`;
						details = { action: "clear", todos: [], nextId: 1 };
						break;
					}
				}
				return { content: [{ type: "text", text }], details };
			},
			renderCall(args: any, theme: any) {
				let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", args.action);
				if (args.text) text += ` ${theme.fg("dim", `"${args.text}"`)}`;
				if (args.id !== undefined) text += ` ${theme.fg("accent", `#${args.id}`)}`;
				return new Text(text, 0, 0);
			},
			renderResult(result: any, { expanded }: any, theme: any) {
				const details = result.details as TodoDetails | undefined;
				if (!details) return new Text("", 0, 0);
				if (details.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
				if (details.todos.length === 0) return new Text(theme.fg("dim", "No todos"), 0, 0);
				const display = expanded ? details.todos : details.todos.slice(0, 5);
				let listText = theme.fg(
					"muted",
					`${details.todos.filter((t) => t.done).length}/${details.todos.length} done:`,
				);
				for (const t of display) {
					const check = t.done ? theme.fg("success", "✓") : theme.fg("dim", "○");
					listText += `\n${check} ${theme.fg("accent", `#${t.id}`)} ${t.done ? theme.fg("dim", t.text) : theme.fg("muted", t.text)}`;
				}
				if (!expanded && details.todos.length > 5) {
					listText += `\n${theme.fg("dim", `... ${details.todos.length - 5} more`)}`;
				}
				return new Text(listText, 0, 0);
			},
		});

		pi.registerTool({
			name: "note",
			label: "Note",
			description:
				"Record a durable learning note mid-session. Delivered to the self-learning engine now (or queued in the outbox if it is down); AutoDream consolidates notes into this project's memory. Use the moment you learn a pitfall, convention, or decision worth remembering — do not wait for session end.",
			parameters: NoteParams,
			async execute(_toolCallId, params) {
				const noteText = params.text.trim();
				if (!noteText) return { content: [{ type: "text", text: "Error: empty note" }] };
				const result = await deliverTerminalNote({ content: noteText, projectPath: opts.cwd, ts: Date.now() });
				const text = result.delivered
					? "Note delivered to the self-learning engine."
					: `Engine unreachable — note queued in the outbox (${result.detail ?? "offline"}) and will sync later.`;
				log(`note ${result.delivered ? "delivered" : "queued"}: ${noteText.slice(0, 80)}`);
				return { content: [{ type: "text", text }] };
			},
			renderCall(args: any, theme: any) {
				return new Text(
					theme.fg("toolTitle", theme.bold("note ")) +
						theme.fg("dim", `"${String(args.text ?? "").slice(0, 60)}"`),
					0,
					0,
				);
			},
			renderResult(result: any, _opts: any, theme: any) {
				const block = result.content?.[0];
				return new Text(
					theme.fg("success", "✓ ") + theme.fg("muted", block?.type === "text" ? block.text : ""),
					0,
					0,
				);
			},
		});

		if (!isSubagent) {
			pi.registerTool({
				name: "task",
				label: "Task",
				description:
					"Launch a unown subagent with a FRESH context window to work on a self-contained task (research, exploration, or implementation). The subagent does not see this conversation and cannot spawn further subagents; it returns a concise report. Agents: 'general' (full tools, default) and 'explore' (read-only) plus any defined in .unown/agents/*.md. Pass {tasks: [...]} to run up to 4 in parallel. Prefer this whenever a focused investigation would pollute this session's context.",
				parameters: TaskParams,
				async execute(_toolCallId, params, signal) {
					const agents = discoverSubagents(opts.cwd);
					const jobs: Array<{ agent: string; task: string }> = params.tasks
						? params.tasks
								.slice(0, 4)
								.map((t: { agent?: string; task: string }) => ({ agent: t.agent ?? "general", task: t.task }))
						: [{ agent: params.agent ?? "general", task: params.task ?? "" }];
					if (jobs.length === 0 || jobs.some((j) => !j.task.trim())) {
						return {
							content: [
								{ type: "text", text: "Error: provide task (or tasks[]) — each needs a non-empty task string" },
							],
						};
					}
					const sections: string[] = new Array(jobs.length).fill("");
					const runs: TaskRunDetails["runs"] = [];
					const maxConcurrency = 2;
					const queue = jobs.map((job, index) => ({ job, index }));
					const workers = Array.from({ length: Math.min(maxConcurrency, queue.length) }, async () => {
						while (queue.length > 0) {
							const next = queue.shift();
							if (!next) break;
							const { job, index } = next;
							const agent = agents.find((a) => a.name === job.agent);
							if (!agent) {
								const available = agents.map((a) => `"${a.name}"`).join(", ");
								sections[index] =
									`## ${job.agent}: FAILED\nUnknown agent "${job.agent}". Available: ${available}.`;
								runs.push({ agent: job.agent, task: job.task, exitCode: 1, turns: 0, toolResults: 0 });
								continue;
							}
							log(`spawning subagent ${agent.name}`);
							const result = await runSubagent(agent, job.task, opts.cwd, signal);
							runs.push({
								agent: agent.name,
								task: job.task,
								exitCode: result.exitCode,
								turns: result.usage.turns,
								toolResults: result.toolResults,
							});
							const header =
								`## ${agent.name} (${result.exitCode === 0 ? "ok" : `exit ${result.exitCode}`}; ` +
								`${result.usage.turns} turns, ${formatTokens(result.usage.input)} in / ${formatTokens(result.usage.output)} out, ` +
								`${result.toolResults} tool calls)`;
							const body =
								result.output.trim() ||
								(result.stderr.trim()
									? `(no output; stderr: ${result.stderr.trim().slice(0, 500)})`
									: "(no output)");
							sections[index] = `${header}\n\n${body}`;
						}
					});
					await Promise.all(workers);
					const details: TaskRunDetails = { runs };
					return { content: [{ type: "text", text: sections.filter(Boolean).join("\n\n---\n\n") }], details };
				},
				renderCall(args: any, theme: any) {
					if (args.tasks) {
						return new Text(
							theme.fg("toolTitle", theme.bold("task ")) +
								theme.fg("muted", `${args.tasks.length} subagents in parallel`),
							0,
							0,
						);
					}
					return new Text(
						theme.fg("toolTitle", theme.bold("task → ")) +
							theme.fg("accent", String(args.agent ?? "general")) +
							theme.fg("dim", ` "${String(args.task ?? "").slice(0, 50)}"`),
						0,
						0,
					);
				},
				renderResult(result: any, _o: any, theme: any) {
					const details = result.details as TaskRunDetails | undefined;
					if (!details) return new Text(theme.fg("dim", "subagent finished"), 0, 0);
					const summary = details.runs
						.map((r) => `${r.agent}: ${r.exitCode === 0 ? "✓" : "✗"} ${r.turns} turns, ${r.toolResults} tools`)
						.join("\n");
					return new Text(theme.fg("muted", summary), 0, 0);
				},
			});
		}

		pi.registerTool({
			name: "fetch_url",
			label: "Fetch",
			description:
				"Fetch an http(s) URL with GET and return the page/document as text (HTML stripped, capped). Use for reading docs, APIs, and raw files over HTTP. For search, prefer your own reasoning plus this tool on known URLs.",
			parameters: FetchParams,
			async execute(_toolCallId, params) {
				const maxChars = Math.min(Math.max(params.max_chars ?? 12_000, 500), 60_000);
				try {
					const text = await fetchUrlText(params.url, maxChars);
					return { content: [{ type: "text", text }] };
				} catch (err: any) {
					return {
						content: [{ type: "text", text: `fetch_url failed: ${err?.message ?? String(err)}` }],
						isError: true,
					};
				}
			},
			renderCall(args: any, theme: any) {
				return new Text(
					theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("dim", String(args.url ?? "").slice(0, 70)),
					0,
					0,
				);
			},
		});

		// -------------------------------------------------------------------
		// Commands
		// -------------------------------------------------------------------

		pi.registerCommand("plan", {
			description: "Toggle plan mode (read-only exploration → numbered plan → execute)",
			handler: async (_args, ctx) => togglePlanMode(ctx),
		});

		pi.registerShortcut(Key.ctrlAlt("p"), {
			description: "Toggle plan mode",
			handler: async (ctx) => togglePlanMode(ctx),
		});

		pi.registerCommand("todos", {
			description: "Show the session todo list",
			handler: async (_args, ctx) => {
				if (todos.length === 0) {
					ctx.ui.notify("No todos yet — ask the agent to track its work with the todo tool.", "info");
					return;
				}
				const list = todos.map((t) => `${t.done ? "✓" : "○"} #${t.id} ${t.text}`).join("\n");
				const done = todos.filter((t) => t.done).length;
				ctx.ui.notify(`Todos (${done}/${todos.length} done):\n${list}`, "info");
			},
		});

		pi.registerCommand("note", {
			description: "Deliver a learning note to the self-learning engine: /note <text>",
			handler: async (args, ctx) => {
				const text = (args ?? "").trim();
				if (!text) {
					ctx.ui.notify("Usage: /note <something worth remembering>", "info");
					return;
				}
				const result = await deliverTerminalNote({ content: text, projectPath: opts.cwd, ts: Date.now() });
				ctx.ui.notify(
					result.delivered
						? "Note delivered to the engine."
						: `Note queued in outbox (${result.detail ?? "engine offline"}).`,
					result.delivered ? "info" : "warning",
				);
			},
		});

		pi.registerCommand("agents", {
			description: "List available subagents (built-ins + .unown/agents/*.md)",
			handler: async (_args, ctx) => {
				const agents = discoverSubagents(opts.cwd);
				const list = agents
					.map((a) => `${a.name} (${a.source})${a.tools ? ` [${a.tools.join(",")}]` : ""}: ${a.description}`)
					.join("\n");
				ctx.ui.notify(list, "info");
			},
		});

		pi.registerCommand("learning", {
			description: "Show the effective 4-tier memory stack (fresh read from disk)",
			handler: async (_args, ctx) => {
				const files = resolveTerminalMemory(opts.cwd);
				const parts = files.map((f) => {
					const lines = f.content.trimEnd().split("\n");
					const shown =
						lines.slice(0, 60).join("\n") + (lines.length > 60 ? `\n… (${lines.length - 60} more lines)` : "");
					return `── ${f.tier.toUpperCase()} · ${f.path} ──\n${shown}`;
				});
				ctx.ui.notify(parts.join("\n\n"), "info");
			},
		});

		// -------------------------------------------------------------------
		// Plan-mode wiring
		// -------------------------------------------------------------------

		pi.registerFlag("plan", {
			description: "Start in plan mode (read-only exploration)",
			type: "boolean",
			default: false,
		});

		pi.on("tool_call", async (event: any) => {
			if (!planModeEnabled || event?.toolName !== "bash") return undefined;
			const command = String(event?.input?.command ?? "");
			if (!isSafeCommand(command)) {
				return {
					block: true,
					reason: `Plan mode: command not on the read-only allowlist. Use /plan to leave plan mode first.\nCommand: ${command}`,
				};
			}
			return undefined;
		});

		pi.on("context", async (event: any) => {
			if (planModeEnabled || executionMode) return undefined;
			return {
				messages: (event?.messages ?? []).filter((m: any) => {
					if (m?.customType === "unown-plan-context") return false;
					const content = m?.content;
					if (typeof content === "string") return !content.includes("[PLAN MODE ACTIVE]");
					if (Array.isArray(content)) {
						return !content.some(
							(c: any) => c?.type === "text" && String(c.text ?? "").includes("[PLAN MODE ACTIVE]"),
						);
					}
					return true;
				}),
			};
		});

		pi.on("before_agent_start", async () => {
			if (planModeEnabled) {
				return {
					message: {
						customType: "unown-plan-context",
						content: `[PLAN MODE ACTIVE]
You are in plan mode — a read-only exploration mode for safe code analysis.

Restrictions:
- edit, write and the task tool are disabled
- bash is restricted to an allowlist of read-only commands (cat/grep/find/ls/git log etc.)
- fetch_url, todo and note remain available

Explore the codebase first (read/grep/find/ls). Ask the user clarifying questions in plain text when requirements are ambiguous.

Then produce a detailed numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes — just describe what you would do and why.`,
						display: false,
					},
				};
			}
			if (executionMode && planItems.length > 0) {
				const remaining = planItems.filter((t) => !t.completed);
				const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
				return {
					message: {
						customType: "unown-plan-context",
						content: `[EXECUTING PLAN — full tool access enabled]

Remaining steps:
${todoList}

Execute the steps in order. After completing a step, include a [DONE:n] tag in your response. Track progress with the todo tool.`,
						display: false,
					},
				};
			}
			return undefined;
		});

		pi.on("turn_end", async (event: any, ctx: any) => {
			if (!executionMode || planItems.length === 0) return;
			const msg = event?.message;
			if (msg?.role !== "assistant" || !Array.isArray(msg.content)) return;
			const text = msg.content
				.filter((b: any) => b?.type === "text")
				.map((b: any) => b.text)
				.join("\n");
			if (markCompletedSteps(text, planItems) > 0) {
				updateStatus(ctx);
				persistPlanState();
			}
		});

		pi.on("agent_end", async (event: any, ctx: any) => {
			if (executionMode && planItems.length > 0) {
				if (planItems.every((t) => t.completed)) {
					executionMode = false;
					planItems = [];
					updateStatus(ctx);
					persistPlanState();
					if (ctx?.hasUI) {
						ctx.ui.notify("Plan complete — all steps done.", "info");
					}
				}
				return;
			}

			if (!planModeEnabled || !ctx?.hasUI) return;

			const messages = Array.isArray(event?.messages) ? event.messages : [];
			const lastAssistant = [...messages]
				.reverse()
				.find((m: any) => m?.role === "assistant" && Array.isArray(m.content));
			if (lastAssistant) {
				const text = lastAssistant.content
					.filter((b: any) => b?.type === "text")
					.map((b: any) => b.text)
					.join("\n");
				const extracted = extractPlanSteps(text);
				if (extracted.length > 0) planItems = extracted;
			}
			if (planItems.length === 0) return;
			persistPlanState();

			const planText = planItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
			const choice = await ctx.ui.select(`Plan ready (${planItems.length} steps). What next?`, [
				"Execute the plan (track progress)",
				"Stay in plan mode",
				"Refine the plan",
			]);
			if (choice?.startsWith("Execute")) {
				planModeEnabled = false;
				executionMode = true;
				restoreNormalTools();
				updateStatus(ctx);
				persistPlanState();
				const remainingList = planItems.map((t) => `${t.step}. ${t.text}`).join("\n");
				pi.sendMessage(
					{
						customType: "unown-plan-echo",
						content: `**Plan (${planItems.length} steps):**\n\n${planText}`,
						display: true,
					},
					{ deliverAs: "followUp" },
				);
				pi.sendMessage(
					{
						customType: "unown-plan-execute",
						content: `Execute the plan.\n\nRemaining steps:\n${remainingList}\n\nStart with: ${planItems[0]?.text ?? ""}\nAfter completing a step, include a [DONE:n] tag in your response.`,
						display: true,
					},
					{ triggerTurn: true, deliverAs: "followUp" },
				);
			} else if (choice === "Refine the plan") {
				const refinement = await ctx.ui.editor("Refine the plan:", "");
				if (refinement?.trim()) {
					pi.sendMessage(
						{
							customType: "unown-plan-echo",
							content: `**Plan (${planItems.length} steps):**\n\n${planText}`,
							display: true,
						},
						{ deliverAs: "followUp" },
					);
					pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
				}
			}
		});

		// ---- restore state on session (re)start
		pi.on("session_start", async (_event: any, ctx: any) => {
			if (pi.getFlag("plan") === true) planModeEnabled = true;
			reconstructTodos(ctx);
			try {
				const entries = ctx.sessionManager.getEntries();
				const planEntry = [...entries]
					.reverse()
					.find((e: any) => e?.type === "custom" && e?.customType === "unown-plan-mode") as
					| {
							data?: {
								enabled?: boolean;
								steps?: PlanStep[];
								executing?: boolean;
								toolsBeforePlanMode?: string[];
							};
					  }
					| undefined;
				if (planEntry?.data) {
					planModeEnabled = planEntry.data.enabled ?? planModeEnabled;
					planItems = planEntry.data.steps ?? planItems;
					executionMode = planEntry.data.executing ?? executionMode;
					toolsBeforePlanMode = planEntry.data.toolsBeforePlanMode ?? toolsBeforePlanMode;
				}
			} catch {
				/* best effort */
			}
			if (planModeEnabled) enablePlanTools();
			updateStatus(ctx);
		});

		pi.on("session_tree", async (_event: any, ctx: any) => {
			reconstructTodos(ctx);
		});
	};

	return { name: "unown-tools", factory, hidden: true } as const;
}
