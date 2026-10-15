/**
 * termhooks.ts — hooks + note capture for `unown` terminal sessions.
 *
 * Same hook semantics as hooks.ts (the engine's sandbox variant) but tuned for
 * a real interactive coding session in the user's project directory:
 *
 *   PreToolUse  — catastrophic-command deny-list (rm -rf /, fork bombs, sudo
 *                 unless allowed, writes to system paths); write-path jail to
 *                 the project dir + /tmp (reads stay unrestricted). Network
 *                 and git push are ALLOWED — real work needs them. Set
 *                 UNOWN_STRICT_HOOKS=1 to get the sandbox-grade deny-list.
 *   PostToolUse — syntax gate: broken JS/TS gets the transpiler error fed
 *                 back to the agent instead of compounding.
 *   Stop        — captures the last assistant message for the session note.
 *   SessionEnd  — on session_shutdown the accumulated session note is
 *                 delivered to the engine (POST /api/notes) or written to the
 *                 outbox for later sync; AutoDream then consolidates it into
 *                 the project's .unown/memory/project.md.
 */
import { decideBash, jailPath, syntaxCheck } from "./hooks.ts";
import { deliverTerminalNote } from "./term.ts";

export interface TerminalHookOptions {
	cwd: string; // the user's real project directory
	engineUrl: string;
	strict?: boolean; // sandbox-grade deny-list (no network, no git push)
	verbose?: boolean; // print hook decisions to stderr
}

/** Terminal deny-list: catastrophic only. Network + git push allowed. */
const TERMINAL_BASH_DENY: { pattern: RegExp; reason: string }[] = [
	{ pattern: /rm\s+(-[a-z]*\s+)*\/(\s|$)/, reason: "refusing rm on filesystem root" },
	{
		pattern: /rm\s+-[a-z]*r[a-z]*f?\s+(~|\$HOME|\/home)(\/|\s|$)/,
		reason: "refusing recursive delete of home directories",
	},
	{ pattern: /:\(\)\s*\{\s*:\s*\|\s*:&\s*\}\s*;/, reason: "refusing fork bomb" },
	{ pattern: /mkfs(\.|\s)/, reason: "refusing filesystem format" },
	{ pattern: /dd\s+[^\n]*of=\/dev\/(sd|nvme|hd)/, reason: "refusing raw writes to disk devices" },
	{ pattern: />\s*\/(etc|usr|var|bin|root)\//, reason: "refusing writes to system paths" },
	{ pattern: /chmod\s+-R\s+777\s+\//, reason: "refusing world-writable chmod on root" },
];

const STRICT_EXTRA_DENY: { pattern: RegExp; reason: string }[] = [
	{ pattern: /\bsudo\b/, reason: "sudo is not permitted" },
	{
		pattern: /\b(curl|wget|nc|netcat)\b[^|;&]*\b(?!127\.0\.0\.1|localhost)[a-z0-9-]+\.[a-z]{2,}/i,
		reason: "network access to external hosts is denied (strict hooks)",
	},
	{ pattern: /\bgit\s+push\b/, reason: "git push is denied (strict hooks)" },
];

function decideTerminalBash(command: string, strict: boolean) {
	for (const rule of strict ? [...TERMINAL_BASH_DENY, ...STRICT_EXTRA_DENY] : TERMINAL_BASH_DENY) {
		if (rule.pattern.test(command)) return { block: true, reason: rule.reason };
	}
	if (strict) {
		const sandboxDecision = decideBash(command);
		if (sandboxDecision.block) return sandboxDecision;
	}
	return { block: false };
}

/** Path policy for terminal sessions: writes confined to project + /tmp. */
function terminalPathOk(cwd: string, p: string): boolean {
	const jail = jailPath(cwd, p);
	if (jail.ok) return true;
	const resolved = jail.resolved;
	if (resolved.startsWith("/tmp/") || resolved === "/tmp") return true;
	return false;
}

export function createTerminalExtension(opts: TerminalHookOptions) {
	const strict = opts.strict ?? false;
	const verbose = opts.verbose ?? false;
	const log = (msg: string) => {
		if (verbose) console.error(`[unown] ${msg}`);
	};

	// Session state accumulated for the exit note
	let prompts = 0;
	let toolCalls = 0;
	const toolNames = new Set<string>();
	let lastAssistantText = "";
	let sessionStartTs = Date.now();

	const factory = (pi: any) => {
		pi.on("session_start", () => {
			sessionStartTs = Date.now();
			log(`session started in ${opts.cwd}`);
		});

		pi.on("input", (event: any) => {
			if (typeof event?.text === "string" && event.text.trim()) prompts++;
		});

		pi.on("tool_call", (event: any) => {
			const tool = event?.toolName as string;
			const input = event?.input ?? {};
			let decision: { block: boolean; reason?: string } = { block: false };

			if (tool === "bash" || tool === "powershell") {
				const command = String(input.command ?? "");
				decision = decideTerminalBash(command, strict);
			} else if (tool === "write" || tool === "edit") {
				const p = String(input.path ?? input.file_path ?? "");
				if (p && !terminalPathOk(opts.cwd, p)) {
					decision = {
						block: true,
						reason: `write path escapes the project directory: ${p} (use the project dir or /tmp)`,
					};
				}
			}

			if (decision.block) {
				log(`PreToolUse DENY ${tool}: ${decision.reason}`);
				return { block: true, reason: decision.reason, terminate: false };
			}
			toolCalls++;
			if (tool) toolNames.add(tool);
			return undefined;
		});

		pi.on("tool_result", (event: any) => {
			const tool = event?.toolName as string;
			const input = event?.input ?? {};
			if (tool === "write" || tool === "edit") {
				const fileName = String(input.path ?? "");
				const content = tool === "write" ? input.content : null;
				const augment = syntaxCheck(fileName, content);
				if (augment) {
					log(`PostToolUse syntax gate flagged ${fileName}`);
					return {
						content: [...(event.content ?? []), { type: "text", text: augment.appended }],
						isError: true,
					};
				}
			}
			return undefined;
		});

		pi.on("agent_end", (event: any) => {
			// Capture the final assistant message of each turn for the note.
			try {
				const messages = Array.isArray(event?.messages) ? event.messages : [];
				for (let i = messages.length - 1; i >= 0; i--) {
					const m = messages[i];
					if (m?.role === "assistant" && typeof m.content === "string" && m.content.trim()) {
						lastAssistantText = m.content.trim();
						break;
					}
				}
			} catch {
				/* best effort */
			}
		});

		pi.on("session_shutdown", async (event: any, _ctx: any) => {
			if (event?.reason !== "quit") return; // new/resume/fork reloads keep the session alive
			if (prompts === 0 && toolCalls === 0) return; // nothing happened — no note
			try {
				const note = buildTerminalNote({
					cwd: opts.cwd,
					prompts,
					toolCalls,
					toolNames: [...toolNames],
					lastAssistantText,
					sessionStartTs,
				});
				const result = await deliverTerminalNote({ content: note, projectPath: opts.cwd, ts: Date.now() });
				log(`session note ${result.delivered ? "delivered to engine" : "queued in outbox"} (${result.via})`);
			} catch (err: any) {
				log(`failed to deliver session note: ${err?.message ?? err}`);
			}
		});
	};

	return { name: "unown-terminal", factory, hidden: true } as const;
}

export function buildTerminalNote(info: {
	cwd: string;
	prompts: number;
	toolCalls: number;
	toolNames: string[];
	lastAssistantText: string;
	sessionStartTs: number;
}): string {
	const durMin = Math.max(1, Math.round((Date.now() - info.sessionStartTs) / 60000));
	const subagentTag = process.env.UNOWN_SUBAGENT === "1" ? " [subagent]" : "";
	const lines: string[] = [];
	lines.push(
		`Terminal session${subagentTag} in ${info.cwd} (${durMin} min): ${info.prompts} prompt(s), ${info.toolCalls} tool call(s)${info.toolNames.length ? ` (${info.toolNames.join(", ")})` : ""}.`,
	);
	if (info.lastAssistantText) lines.push(`Final outcome: ${info.lastAssistantText.slice(0, 400)}`);
	lines.push(
		`If the session hit failures or discovered project-specific pitfalls, record them as concise imperative rules; otherwise record any durable project conventions worth remembering.`,
	);
	return lines.join("\n");
}
