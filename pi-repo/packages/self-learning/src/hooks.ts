/**
 * hooks.ts — Hooks (pattern 5/5).
 *
 * A pi inline-extension implementing Claude-Code-style hook semantics on top
 * of pi's native extension events:
 *
 *   SessionStart      -> pi `session_start`
 *   UserPromptSubmit  -> pi `input`
 *   PreToolUse        -> pi `tool_call`        (allow / deny / mutate)
 *   PostToolUse       -> pi `tool_result`      (augment result, auto-checks)
 *   Stop              -> pi `agent_end`
 *   SubagentStop      -> emitted by the harness when a sub-run finishes
 *
 * Every decision is logged to the hook_log table and pushed to the live bus.
 */
import { resolve as resolvePath } from "node:path";
import { store } from "./store.ts";
import { emit } from "./bus.ts";

export interface RunHookContext {
	runId: string;
	sandboxRoot: string; // absolute path the run is jailed to
	memoryVersion: number;
}

export type HookName = "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "Stop" | "SubagentStop";

export function logHook(runId: string | null, hook: HookName, tool: string | null, decision: string, reason: string, details?: unknown) {
	store.run(
		`INSERT INTO hook_log (ts, run_id, hook, tool, decision, reason, details) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[Date.now(), runId, hook, tool, decision, reason, details ? JSON.stringify(details).slice(0, 4000) : null],
	);
	emit("hook", { runId, hook, tool, decision, reason, ts: Date.now() });
}

// ---------------------------------------------------------------------------
// PreToolUse policies
// ---------------------------------------------------------------------------
const BASH_DENY: { pattern: RegExp; reason: string }[] = [
	{ pattern: /rm\s+(-[a-z]*\s+)*\/(\s|$)/, reason: "refusing rm on filesystem root" },
	{ pattern: /rm\s+-[a-z]*r[a-z]*f?\s+(~|\$HOME|\/home)(\/|\s|$)/, reason: "refusing recursive delete of home directories" },
	{ pattern: /\bsudo\b/, reason: "sudo is not permitted in the sandbox" },
	{ pattern: /:\(\)\s*\{\s*:\s*\|\s*:&\s*\}\s*;/, reason: "refusing fork bomb" },
	{ pattern: /\b(curl|wget|nc|netcat)\b[^|;&]*\b(?!127\.0\.0\.1|localhost)[a-z0-9-]+\.[a-z]{2,}/i, reason: "network access to external hosts is denied in the sandbox" },
	{ pattern: /\bgit\s+push\b/, reason: "git push is denied in the sandbox" },
	{ pattern: />\s*\/(etc|usr|var|bin|home|root)\//, reason: "redirecting writes to system paths is denied" },
];

export interface PreToolDecision {
	block: boolean;
	reason?: string;
}

export function decideBash(command: string): PreToolDecision {
	for (const rule of BASH_DENY) {
		if (rule.pattern.test(command)) return { block: true, reason: rule.reason };
	}
	return { block: false };
}

export function jailPath(sandboxRoot: string, p: string): { ok: boolean; resolved: string } {
	const resolved = resolvePath(sandboxRoot, p ?? ".");
	const ok = resolved === sandboxRoot || resolved.startsWith(sandboxRoot + "/") || resolved.startsWith(sandboxRoot + "\\");
	return { ok, resolved };
}

// ---------------------------------------------------------------------------
// PostToolUse: syntax gate for JS/TS files (the "auto-format / lint" analog)
// ---------------------------------------------------------------------------
const CHECKABLE = /\.(js|mjs|cjs|ts|mts|cts|jsx|tsx)$/;

export interface PostToolAugment {
	isError: boolean;
	appended: string;
}

export function syntaxCheck(fileName: string | undefined, content: string | undefined | null): PostToolAugment | null {
	if (!fileName || !CHECKABLE.test(fileName) || typeof content !== "string") return null;
	try {
		const transpiler = new Bun.Transpiler({ loader: CHECKABLE.test(".ts") && /\.(ts|mts|cts|tsx)$/.test(fileName) ? "ts" : "js" });
		transpiler.transformSync(content);
		return null;
	} catch (err: any) {
		const msg = String(err?.message ?? err).slice(0, 600);
		return {
			isError: true,
			appended: `\n\n[PostToolUse:hooks] Syntax check FAILED for ${fileName}:\n${msg}\nFix the syntax error before continuing.`,
		};
	}
}

// ---------------------------------------------------------------------------
// The pi inline extension
// ---------------------------------------------------------------------------
export function createHooksExtension(ctx: RunHookContext) {
	const factory = (pi: any) => {
		// --- SessionStart ---------------------------------------------------
		pi.on("session_start", (_event: any, _ectx: any) => {
			logHook(ctx.runId, "SessionStart", null, "log", `session started (memory v${ctx.memoryVersion})`);
		});

		// --- UserPromptSubmit -----------------------------------------------
		pi.on("input", (event: any, _ectx: any) => {
			const text = typeof event?.text === "string" ? event.text.slice(0, 300) : "";
			logHook(ctx.runId, "UserPromptSubmit", null, "log", `prompt submitted: "${text}"`);
		});

		// --- PreToolUse -----------------------------------------------------
		pi.on("tool_call", (event: any, _ectx: any) => {
			const tool = event?.toolName as string;
			const input = event?.input ?? {};
			let decision: PreToolDecision = { block: false };

			if (tool === "bash" || tool === "powershell") {
				const command = String(input.command ?? "");
				decision = decideBash(command);
			} else if (tool === "write" || tool === "edit" || tool === "read") {
				const p = String(input.path ?? input.file_path ?? "");
				if (p) {
					const jail = jailPath(ctx.sandboxRoot, p);
					if (!jail.ok) {
						decision = { block: true, reason: `path escapes the sandbox: ${p} (resolved ${jail.resolved})` };
					}
				}
			}

			const details = {
				tool,
				input:
					tool === "bash" || tool === "powershell"
						? String(input.command ?? "").slice(0, 500)
						: tool === "write"
							? { path: input.path, bytes: String(input.content ?? "").length }
							: tool === "edit"
								? { path: input.path }
								: input,
			};
			logHook(
				ctx.runId,
				"PreToolUse",
				tool,
				decision.block ? "deny" : "allow",
				decision.block ? (decision.reason ?? "denied by policy") : "allowed",
				details,
			);
			return decision.block ? { block: true, reason: decision.reason, terminate: false } : undefined;
		});

		// --- PostToolUse ----------------------------------------------------
		pi.on("tool_result", (event: any, _ectx: any) => {
			const tool = event?.toolName as string;
			const input = event?.input ?? {};
			let result: any = undefined;

			if (tool === "write" || tool === "edit") {
				const fileName = String(input.path ?? "");
				const content = tool === "write" ? input.content : null;
				const augment = syntaxCheck(fileName, content);
				if (augment) {
					result = {
						content: [...(event.content ?? []), { type: "text", text: augment.appended }],
						isError: true,
					};
					logHook(ctx.runId, "PostToolUse", tool, "augment", `syntax gate flagged ${fileName}`, { fileName });
				}
			}
			if (!result) {
				const isError = Boolean(event?.isError);
				logHook(ctx.runId, "PostToolUse", tool, isError ? "log-error" : "log", `tool finished (isError=${isError})`);
			}
			return result;
		});

		// --- Stop -----------------------------------------------------------
		pi.on("agent_end", (event: any, _ectx: any) => {
			const messages = Array.isArray(event?.messages) ? event.messages.length : 0;
			logHook(ctx.runId, "Stop", null, "log", `agent loop ended after ${messages} messages`);
		});
	};
	return { name: "self-learning-hooks", factory, hidden: true } as const;
}
