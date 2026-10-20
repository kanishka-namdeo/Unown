/**
 * addons/index.ts — the unown addons extension.
 *
 * One inline extension (`unown-addons`) that bundles the three TUI addons
 * and their shared user-configuration surface:
 *
 *   - ask_user_question  structured mid-run questionnaires
 *                        (port of @juicesharp/rpiv-ask-user-question)
 *   - todo               live task-graph panel above the editor
 *                        (port of @juicesharp/rpiv-todo; replaces the
 *                        first-generation todo tool)
 *   - advisor            a second model watching the session and sending
 *                        mid-run advice (port of oh-my-pi's advisor)
 *
 * `/addons` opens an interactive configurator: enable/disable each addon and
 * edit its settings live where possible; changes persist to
 * ~/.unown/agent/addons.json immediately. Registration-time fields
 * (guidance, collapse keys, advisor model) need a `/reload` to rebind.
 *
 * Subagent sessions (UNOWN_SUBAGENT=1) register ask_user_question + todo (a
 * subagent's todo list rides its own session entries; the questionnaire is
 * stripped from the active tool set when no UI can answer it) but never the
 * advisor — it would double-spend on every subagent turn.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { advisorStatusLine, registerAdvisorAddon } from "./advisor.ts";
import { registerAskUserQuestionTool } from "./ask-user-question.ts";
import { type AddonsConfig, formatKeyForDisplay, loadAddonsConfig, saveAddonsConfig } from "./config.ts";
import { registerTodoAddon } from "./todo.ts";

export interface UnownAddonsOptions {
	cwd: string;
	verbose?: boolean;
	/** Subagent suppression (defaults to the UNOWN_SUBAGENT env). */
	isSubagent?: boolean;
}

/**
 * Create the bundled addons extension. Configuration is read once at
 * registration (mirroring the guidance/shortcut contract documented in
 * config.ts); hot-reloadable fields are re-read through the accessors.
 */
export function createUnownAddonsExtension(opts: UnownAddonsOptions) {
	const verbose = opts.verbose ?? false;
	const isSubagent = opts.isSubagent ?? process.env.UNOWN_SUBAGENT === "1";
	const log = (message: string): void => {
		if (verbose) console.error(`[unown-addons] ${message}`);
	};

	const factory = (pi: ExtensionAPI): void => {
		const config: AddonsConfig = loadAddonsConfig();

		// ask_user_question + todo register in EVERY enabled session
		// (subagents included): the questionnaire degrades to a typed decline
		// when no user can answer (and is stripped from the active set
		// headlessly — see registerAskUserQuestionTool's before_agent_start
		// reconciler), and a subagent's todo list rides its own session
		// entries. The overlay panel simply never mounts without a UI.
		if (config.askUserQuestion.enabled) {
			registerAskUserQuestionTool(pi, config.askUserQuestion);
			log("ask_user_question addon registered");
		}
		if (config.todo.enabled) {
			registerTodoAddon(pi, config.todo, () => loadAddonsConfig().todo.maxWidgetLines, verbose);
			log("todo addon registered");
		}
		// The advisor is foreground-only: a subagent advisor would double-spend
		// on every subagent turn and review a transcript nobody reads.
		if (config.advisor.enabled && !isSubagent) {
			registerAdvisorAddon(pi, config.advisor, { cwd: opts.cwd, verbose });
			log("advisor addon registered");
		}

		registerAddonsCommand(pi, () => loadAddonsConfig());
	};

	return { name: "unown-addons", factory, hidden: true } as const;
}

/**
 * `/addons` — the fully TUI user-configurable surface. A select-driven menu
 * (works in every terminal; degrades to a typed error in headless mode).
 * Every toggle persists immediately; registration-bound settings note the
 * /reload requirement in their change message.
 */
function registerAddonsCommand(pi: ExtensionAPI, reloadConfig: () => AddonsConfig): void {
	pi.registerCommand("addons", {
		description: "Configure the TUI addons (ask_user_question, todo, advisor)",
		handler: async (args: string | undefined, ctx: ExtensionContext) => {
			if (!ctx.hasUI || ctx.mode !== "tui") {
				ctx.ui.notify("/addons requires interactive mode — edit ~/.unown/agent/addons.json instead", "error");
				return;
			}
			const subcommand = (args ?? "").trim().split(/\s+/)[0] ?? "";
			if (subcommand === "status") {
				ctx.ui.notify(addonsStatusText(reloadConfig()), "info");
				return;
			}
			// Main menu.
			let running = true;
			while (running) {
				const config = reloadConfig();
				const choice = await ctx.ui.select("unown addons — pick an addon to configure (Esc to exit)", [
					`ask_user_question  [${config.askUserQuestion.enabled ? "on" : "off"}]`,
					`todo               [${config.todo.enabled ? "on" : "off"}]`,
					`advisor            [${config.advisor.enabled ? "on" : "off"}]`,
					"status — show the effective configuration",
				]);
				if (choice === undefined) return;
				if (matchAddon(choice, "status")) {
					ctx.ui.notify(addonsStatusText(reloadConfig()), "info");
					continue;
				}
				if (matchAddon(choice, "ask_user_question")) {
					await configureAskUserQuestion(ctx, reloadConfig);
					continue;
				}
				if (matchAddon(choice, "todo")) {
					await configureTodo(ctx, reloadConfig);
					continue;
				}
				if (matchAddon(choice, "advisor")) {
					await configureAdvisor(ctx, reloadConfig);
					continue;
				}
				running = false;
			}
		},
	});
}

function matchAddon(choice: string | undefined, word: string): boolean {
	return choice?.trim().startsWith(word) === true;
}

async function configureAskUserQuestion(ctx: ExtensionContext, reloadConfig: () => AddonsConfig): Promise<void> {
	const config = reloadConfig();
	const choice = await ctx.ui.select("ask_user_question addon", [
		config.askUserQuestion.enabled ? "Disable (until /reload)" : "Enable (takes effect after /reload)",
		`Collapse key: ${formatKeyForDisplay(config.askUserQuestion.collapseKey)}`,
		"Back",
	]);
	if (choice === undefined || choice === "Back") return;
	if (choice.startsWith("Collapse key:")) {
		const next = await ctx.ui.input(
			"New collapse key (pi grammar like ctrl+], alt+o; 'off' disables; empty keeps current)",
		);
		if (next === undefined || next.trim() === "") return;
		config.askUserQuestion.collapseKey = next.trim().toLowerCase();
		saveAddonsConfig(config);
		ctx.ui.notify(
			`Saved — rebinds after /reload (now ${formatKeyForDisplay(config.askUserQuestion.collapseKey)})`,
			"info",
		);
		return;
	}
	config.askUserQuestion.enabled = !config.askUserQuestion.enabled;
	saveAddonsConfig(config);
	ctx.ui.notify(
		`ask_user_question ${config.askUserQuestion.enabled ? "enabled" : "disabled"} — /reload applies it`,
		"info",
	);
}

async function configureTodo(ctx: ExtensionContext, reloadConfig: () => AddonsConfig): Promise<void> {
	const config = reloadConfig();
	const choice = await ctx.ui.select("todo addon", [
		config.todo.enabled ? "Disable (until /reload)" : "Enable (takes effect after /reload)",
		`Widget lines: ${config.todo.maxWidgetLines}`,
		`Collapse key: ${formatKeyForDisplay(config.todo.collapseKey)}`,
		"Back",
	]);
	if (choice === undefined || choice === "Back") return;
	if (choice.startsWith("Widget lines:")) {
		const next = await ctx.ui.input("New max widget lines (3-64)");
		if (next === undefined || next.trim() === "") return;
		const parsed = Number(next);
		if (!Number.isFinite(parsed)) {
			ctx.ui.notify("Not a number — unchanged", "warning");
			return;
		}
		config.todo.maxWidgetLines = Math.min(Math.max(Math.trunc(parsed), 3), 64);
		saveAddonsConfig(config);
		ctx.ui.notify(`Saved — the panel re-reads this on every render (now ${config.todo.maxWidgetLines})`, "info");
		return;
	}
	if (choice.startsWith("Collapse key:")) {
		const next = await ctx.ui.input(
			"New collapse key (pi grammar like ctrl+shift+t; 'off' disables; empty keeps current)",
		);
		if (next === undefined || next.trim() === "") return;
		config.todo.collapseKey = next.trim().toLowerCase();
		saveAddonsConfig(config);
		ctx.ui.notify(`Saved — rebinds after /reload (now ${formatKeyForDisplay(config.todo.collapseKey)})`, "info");
		return;
	}
	config.todo.enabled = !config.todo.enabled;
	saveAddonsConfig(config);
	ctx.ui.notify(`todo ${config.todo.enabled ? "enabled" : "disabled"} — /reload applies it`, "info");
}

async function configureAdvisor(ctx: ExtensionContext, reloadConfig: () => AddonsConfig): Promise<void> {
	const config = reloadConfig();
	const choice = await ctx.ui.select("advisor addon", [
		config.advisor.enabled ? "Disable (until /reload)" : "Enable (takes effect after /reload)",
		`Model: ${config.advisor.model ?? "(session model)"}`,
		`Review cadence: ${config.advisor.reviewMode}${config.advisor.reviewMode === "turn" ? ` (every ${config.advisor.reviewInterval})` : ""}`,
		`Notes per review: ${config.advisor.maxNotesPerUpdate}`,
		`Thinking: ${config.advisor.thinkingLevel}`,
		"Back",
	]);
	if (choice === undefined || choice === "Back") return;
	if (choice.startsWith("Model:")) {
		const next = await ctx.ui.input('Advisor model (e.g. "qwen3.7-plus", "kimi-k2.5"; empty = session model)');
		if (next === undefined) return;
		config.advisor.model = next.trim() === "" ? undefined : next.trim();
		saveAddonsConfig(config);
		ctx.ui.notify(`Saved — /advisor reloads the runtime on the next review`, "info");
		return;
	}
	if (choice.startsWith("Review cadence:")) {
		const next = await ctx.ui.select("Review cadence", [
			"turn — every turn (or every Nth)",
			"agent-end — only when the agent finishes",
		]);
		if (next === undefined) return;
		config.advisor.reviewMode = next.startsWith("turn") ? "turn" : "agent-end";
		if (config.advisor.reviewMode === "turn") {
			const interval = await ctx.ui.input("Review every Nth turn (1-64)");
			if (interval !== undefined && interval.trim() !== "" && Number.isFinite(Number(interval))) {
				config.advisor.reviewInterval = Math.min(Math.max(Math.trunc(Number(interval)), 1), 64);
			}
		}
		saveAddonsConfig(config);
		ctx.ui.notify("Saved — /reload applies it", "info");
		return;
	}
	if (choice.startsWith("Notes per review:")) {
		const next = await ctx.ui.input("Max non-blocker notes per review (1-32)");
		if (next === undefined || next.trim() === "" || !Number.isFinite(Number(next))) return;
		config.advisor.maxNotesPerUpdate = Math.min(Math.max(Math.trunc(Number(next)), 1), 32);
		saveAddonsConfig(config);
		ctx.ui.notify("Saved — applies from the next review", "info");
		return;
	}
	if (choice.startsWith("Thinking:")) {
		const next = await ctx.ui.select("Advisor thinking level", ["off", "low", "medium", "high"]);
		if (next === undefined) return;
		config.advisor.thinkingLevel = next as "off" | "low" | "medium" | "high";
		saveAddonsConfig(config);
		ctx.ui.notify("Saved — /reload applies it", "info");
		return;
	}
	config.advisor.enabled = !config.advisor.enabled;
	saveAddonsConfig(config);
	ctx.ui.notify(`advisor ${config.advisor.enabled ? "enabled" : "disabled"} — /reload applies it`, "info");
}

function addonsStatusText(config: AddonsConfig): string {
	return [
		"unown addons (~/.unown/agent/addons.json):",
		`  ask_user_question  ${config.askUserQuestion.enabled ? "on " : "off"}  collapseKey=${formatKeyForDisplay(config.askUserQuestion.collapseKey)}`,
		`  todo               ${config.todo.enabled ? "on " : "off"}  lines=${config.todo.maxWidgetLines}  collapseKey=${formatKeyForDisplay(config.todo.collapseKey)}`,
		`  advisor            ${config.advisor.enabled ? "on " : "off"}  model=${config.advisor.model ?? "(session model)"}  cadence=${config.advisor.reviewMode}${config.advisor.reviewMode === "turn" ? `/${config.advisor.reviewInterval}` : ""}  notes=${config.advisor.maxNotesPerUpdate}  thinking=${config.advisor.thinkingLevel}`,
		advisorStatusLine(),
	].join("\n");
}

export { matchAddon };
