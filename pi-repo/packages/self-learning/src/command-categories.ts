/**
 * command-categories.ts — the Semplice W10/W11 category map.
 *
 * The round's top overwhelm finding was the command surface: ~100 slash
 * commands in ONE flat, ungrouped list (the `/` popup read "(1/99)"), with
 * docs undercounting them. Hick's law does NOT argue for deleting commands
 * (fuzzy search neutralizes choice cost — the ctrl+k palette and the `/`
 * filter answer that), but SCANNING an ungrouped wall is a chunking failure
 * (Cowan 4±1; Gestalt common region): the popup and the palette now chunk
 * the catalog under section headers (vendored SelectList `selectable:false`
 * rows), and `/help` prints the same groups as a compact catalog.
 *
 * The map is name-keyed (NOT source-keyed): a user does not care whether
 * `/model` comes from pi or `/plan` from unown — the category answers "what
 * is this for". Un-mapped commands (user-authored markdown commands, custom
 * skills) sort last, ungrouped.
 *
 * Categories are ordered alphabetically everywhere they render (sort by
 * name, then label) so the grouping is stable across surfaces.
 */

/** The category for a command name, or undefined (renders ungrouped, last). */
export function commandCategory(name: string): string | undefined {
	return COMMAND_CATEGORIES[name];
}

const COMMAND_CATEGORIES: Record<string, string> = {
	// ── Session ── the conversation and its history
	new: "Session",
	session: "Session",
	name: "Session",
	resume: "Session",
	sessions: "Session",
	fork: "Session",
	clone: "Session",
	tree: "Session",
	export: "Session",
	import: "Session",
	share: "Session",
	compact: "Session",
	reload: "Session",
	quit: "Session",
	"edit-resend": "Session",
	// checkpoints / undo lane
	checkpoint: "Session",
	checkpoints: "Session",
	receipts: "Session",
	undo: "Session",
	redo: "Session",
	rewind: "Session",
	restore: "Session",

	// ── Plan & review ── planning mode and code review
	plan: "Plan & review",
	review: "Plan & review",
	blame: "Plan & review",
	goal: "Plan & review",
	promote: "Plan & review",
	"output-style": "Plan & review",

	// ── Memory & learning ── the self-learning stack
	memory: "Memory & learning",
	learning: "Memory & learning",
	note: "Memory & learning",
	insights: "Memory & learning",
	recap: "Memory & learning",
	feed: "Memory & learning",
	btw: "Memory & learning",
	recipe: "Memory & learning",
	wiki: "Memory & learning",

	// ── Models & providers ──
	model: "Models & providers",
	thinking: "Models & providers",
	"scoped-models": "Models & providers",
	providers: "Models & providers",
	login: "Models & providers",
	logout: "Models & providers",

	// ── Display ── how the TUI looks and renders
	settings: "Display",
	theme: "Display",
	color: "Display",
	tui: "Display",
	redraw: "Display",
	keybindings: "Display",
	hotkeys: "Display",
	"terminal-setup": "Display",
	statusline: "Display",
	split: "Display",
	"split-thinking": "Display",
	"split-tools": "Display",
	"split-tools-view": "Display",
	"split-diff": "Display",
	"split-height": "Display",
	"split-tools-width": "Display",
	"split-divider": "Display",
	"split-trim-response": "Display",
	"split-save": "Display",
	files: "Display",

	// ── Tools & data ── tool configuration and project data
	mcp: "Tools & data",
	lsp: "Tools & data",
	repomap: "Tools & data",
	context: "Tools & data",
	copy: "Tools & data",
	commit: "Tools & data",

	// ── Safety & permissions ── the trust surface
	permissions: "Safety & permissions",
	"add-dir": "Safety & permissions",
	trust: "Safety & permissions",
	"project-settings": "Safety & permissions",

	// ── Engine & ops ── the self-learning engine and the fleet
	engine: "Engine & ops",
	dashboard: "Engine & ops",
	dash: "Engine & ops",
	routines: "Engine & ops",
	hooks: "Engine & ops",
	tasks: "Engine & ops",
	delegation: "Engine & ops",
	status: "Engine & ops",
	diff: "Engine & ops",
	usage: "Engine & ops",
	cost: "Engine & ops",
	recovery: "Engine & ops",
	abort: "Engine & ops",
	"doctor-instructions": "Engine & ops",
	brief: "Engine & ops",
	mission: "Engine & ops",
	agents: "Engine & ops",

	// ── Add-ons ──
	addons: "Add-ons",
	todos: "Add-ons",
	advisor: "Add-ons",

	// ── Help & onboarding ──
	help: "Help & onboarding",
	flights: "Help & onboarding",
	changelog: "Help & onboarding",
	"init-agents": "Help & onboarding",
};

/** All names the map knows (tests pin coverage against the registrations). */
export const CATEGORIZED_COMMAND_NAMES: readonly string[] = Object.keys(COMMAND_CATEGORIES);

/** The grouped /help card (Semplice W11) — one compact catalog, the same
 * categories the / popup and the ctrl+k palette chunk under. Pure so the
 * copy is unit-pinned. */
export function helpCardLines(): string[] {
	const byCategory = new Map<string, string[]>();
	for (const [name, category] of Object.entries(COMMAND_CATEGORIES)) {
		const list = byCategory.get(category) ?? [];
		list.push(name);
		byCategory.set(category, list);
	}
	const total = Object.keys(COMMAND_CATEGORIES).length;
	const lines: string[] = [];
	lines.push(`unown commands — ${total} in the catalog · ctrl+k searches them · / opens the grouped list`);
	lines.push("");
	for (const category of [...byCategory.keys()].sort((a, b) => a.localeCompare(b))) {
		const names = (byCategory.get(category) ?? []).sort((a, b) => a.localeCompare(b));
		lines.push(`── ${category} ──`);
		// Wrap name rows at a terminal-friendly width (pane-truth: 128
		// cols, 2-space indent, no trailing comma).
		let row = "  ";
		for (const name of names) {
			const token = row.trim() === "" ? name : `, ${name}`;
			if (row.length + token.length > 100 && row.trim() !== "") {
				lines.push(row);
				row = `  ${name}`;
			} else {
				row += token;
			}
		}
		if (row.trim() !== "") lines.push(row);
	}
	lines.push("");
	lines.push("? keyboard shortcuts · /hotkeys the full key map · /flights starter tasks · docs/usage.md");
	return lines;
}
