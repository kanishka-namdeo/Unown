/**
 * spinner-verbs.ts — the thinking-time verb pool (Toccata A15).
 *
 * Claude Code's loading line shows rotating "spinner verbs" — Pondering,
 * Percolating, Booping — while the model thinks; tool runs show honest
 * contextual labels instead. The verb catalog is a product surface
 * (Anthropic ships a `spinnerVerbs` settings key; the community catalog
 * `awesome-claude-spinners` documents 46 themed packs), and the default
 * list below is a curated subset of the 187-verb catalog Claude Code
 * itself ships (public leak, wesbos/2038958747200962952, cross-checked
 * against the awesome-claude-spinners ecosystem) — Unown's curation drops
 * the Claude-branded entries and keeps one alphabetical sweep of
 * crowd-pleasers.
 *
 * Contract (decision record docs/tui-claude-code-parity-research.md A15):
 *   - Verbs flavor MODEL-THINKING time only. An extension-set working
 *     message and a live tool label always win (honest labels keep
 *     priority); when neither applies, the working line carries one verb
 *     at a time, rotating on the elapsed chip's existing 1 s tick (every
 *     SPINNER_VERB_ROTATE_TICKS ticks) — no new timers.
 *   - One verb is held per rotation window, never per keystroke, and a
 *     fresh pick never repeats the verb it replaces (when the pool has
 *     more than one entry).
 *   - Configuration precedence: UNOWN_SPINNER_VERBS env > `spinnerVerbs`
 *     setting (comma-separated list, replaces the default pool) > the
 *     built-in pool. The env lane accepts a comma list, an explicit
 *     enable ("1"/"true"/"on"/"yes" — the default pool), or a kill
 *     switch ("0"/"false"/"off"/"no" — the static "Working..." label).
 *   - Pure module: no imports, no TUI, no fs — importable from the
 *     indicator, the settings registry and tests alike.
 */

/** How many 1 s elapsed-tick beats a verb is held before the next pick. */
export const SPINNER_VERB_ROTATE_TICKS = 3;

/**
 * The built-in verb pool — a curated subset of Claude Code's leaked
 * 187-verb catalog (alphabetical; the fork drops the Claude-branded and
 * filler entries). Rendered with an ellipsis: "Pondering...".
 */
export const DEFAULT_SPINNER_VERBS: readonly string[] = [
	"Accomplishing",
	"Architecting",
	"Baking",
	"Beaming",
	"Bootstrapping",
	"Brewing",
	"Bunning",
	"Calculating",
	"Cerebrating",
	"Channelling",
	"Churning",
	"Cogitating",
	"Combobulating",
	"Composing",
	"Concocting",
	"Considering",
	"Contemplating",
	"Cooking",
	"Crafting",
	"Crunching",
	"Deciphering",
	"Deliberating",
	"Determining",
	"Doodling",
	"Fermenting",
	"Finagling",
	"Flowing",
	"Frolicking",
	"Generating",
	"Grinding",
	"Herding",
	"Ideating",
	"Improvising",
	"Inferring",
	"Manifesting",
	"Marinating",
	"Moseying",
	"Mulling",
	"Musing",
	"Noodling",
	"Orchestrating",
	"Percolating",
	"Pondering",
	"Puttering",
	"Puzzling",
	"Reticulating",
	"Ruminating",
	"Schlepping",
	"Simmering",
	"Sketching",
	"Spelunking",
	"Spinning",
	"Stewing",
	"Synthesizing",
	"Thinking",
	"Tinkering",
	"Transmuting",
	"Unfurling",
	"Vibing",
	"Whisking",
	"Wibbling",
	"Working",
	"Wrangling",
	"Zigzagging",
];

/** Env values that disable the verb lane entirely (the static label stays). */
const DISABLE_VALUES = new Set(["0", "false", "off", "no"]);
/** Env values that explicitly enable the default pool without listing verbs. */
const ENABLE_VALUES = new Set(["1", "true", "on", "yes"]);

/**
 * Parse a comma-separated verb list: split on commas, trim each entry,
 * drop empties, and dedupe case-insensitively (first spelling wins).
 * "Pondering, percolating,,PONDERING" → ["Pondering", "percolating"].
 */
export function parseSpinnerVerbs(raw: string | undefined): string[] {
	if (typeof raw !== "string") return [];
	const seen = new Set<string>();
	const verbs: string[] = [];
	for (const part of raw.split(",")) {
		const verb = part.trim();
		if (!verb) continue;
		const key = verb.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		verbs.push(verb);
	}
	return verbs;
}

/**
 * Resolve the effective verb pool. Precedence: env > setting > default.
 *
 *   env "0"/"false"/"off"/"no"   → null  (disabled — static "Working...")
 *   env "1"/"true"/"on"/"yes"    → the default pool (explicit enable)
 *   env "Pondering,Brewing"      → that list (a degenerate parse that
 *                                  yields no verbs falls through)
 *   setting "Pondering,Brewing"  → that list (same fall-through rule)
 *   anything else                → DEFAULT_SPINNER_VERBS
 */
export function resolveSpinnerVerbPool(
	envValue: string | undefined,
	settingValue: string | undefined,
): string[] | null {
	if (typeof envValue === "string" && envValue.trim() !== "") {
		const key = envValue.trim().toLowerCase();
		if (DISABLE_VALUES.has(key)) return null;
		if (ENABLE_VALUES.has(key)) return [...DEFAULT_SPINNER_VERBS];
		const fromEnv = parseSpinnerVerbs(envValue);
		if (fromEnv.length > 0) return fromEnv;
	}
	if (typeof settingValue === "string" && settingValue.trim() !== "") {
		const fromSetting = parseSpinnerVerbs(settingValue);
		if (fromSetting.length > 0) return fromSetting;
	}
	return [...DEFAULT_SPINNER_VERBS];
}

/**
 * Pick a verb index at random, never repeating `lastIndex` when the pool
 * holds more than one verb. The rng is injectable so tests stay
 * deterministic; a mocked rng that refuses to move on is unblocked by a
 * bounded fallback (the next index after lastIndex) rather than a loop.
 */
export function pickSpinnerVerbIndex(count: number, lastIndex: number, rng: () => number = Math.random): number {
	if (count <= 0) return -1;
	if (count === 1) return 0;
	for (let attempt = 0; attempt < count; attempt++) {
		const index = Math.floor(rng() * count);
		if (index >= 0 && index < count && index !== lastIndex) return index;
	}
	return (lastIndex + 1) % count;
}
