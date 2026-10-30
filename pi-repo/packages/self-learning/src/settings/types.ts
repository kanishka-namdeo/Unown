/**
 * settings/types.ts — the settings hub's data model (the Settings Evolution
 * round, docs/settings_ia_redesign.md).
 *
 * The hub catalogs every configurable capability as a registry item: a
 * named decision with a risk badge, a summary, contextual help, an optional
 * live value getter/setter, and optional launch actions. Sections are
 * ordered by USER INTENT (Agent, Memory, Learning, Automation, Safety,
 * Models & Cost, Tools & Integrations, Observability, Recovery, Advanced) —
 * never by implementation file.
 *
 * Contract:
 *   - Every item id is stable and section-qualified ("safety.strict-hooks").
 *   - Getters are pure reads of existing config surfaces; setters write
 *     through the OWNING surface (addons.json, pi settings.json via
 *     SettingsManager, hub prefs) — the hub invents no second source of
 *     truth for existing data.
 *   - Actions never mutate config directly; they launch the owning flow
 *     (a command, a dialog) so every write rides its existing audit lane.
 *   - Risk badges are binding UI metadata (docs/settings_trust_recovery_
 *     framework.md §3): low ● / med ◐ / high ○ — high-risk writes require
 *     typed confirmation in the UI layer.
 */

export const SETTINGS_SECTIONS = [
	"agent",
	"memory",
	"learning",
	"automation",
	"safety",
	"models",
	"tools",
	"observability",
	"recovery",
	"advanced",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];

export interface SettingsSectionMeta {
	id: SettingsSectionId;
	title: string;
	/** One-line answer to "why would I open this?" */
	purpose: string;
}

export const SECTION_META: readonly SettingsSectionMeta[] = [
	{ id: "agent", title: "Agent", purpose: "What this agent is, and how a session behaves" },
	{ id: "memory", title: "Memory", purpose: "What Unown remembers — inspect, edit, forget" },
	{ id: "learning", title: "Learning", purpose: "What it learned, and what it may learn automatically" },
	{ id: "automation", title: "Automation", purpose: "What runs unattended — and how to stop it" },
	{ id: "safety", title: "Safety", purpose: "What Unown is allowed to do, and who decides" },
	{ id: "models", title: "Models & Cost", purpose: "Which model, at what price ceiling" },
	{ id: "tools", title: "Tools & Integrations", purpose: "What capabilities are connected" },
	{ id: "observability", title: "Observability", purpose: "See what happened, and why" },
	{ id: "recovery", title: "Recovery", purpose: "Undo, restore, reset — one surface" },
	{ id: "advanced", title: "Advanced", purpose: "Power knobs — env vars, network, retention" },
];

export type SettingsRisk = "low" | "med" | "high";

export const RISK_BADGE: Record<SettingsRisk, string> = { low: "●", med: "◐", high: "○" };

export type SettingsItemKind =
	| "toggle"
	| "select"
	| "number"
	| "text"
	| "readonly"
	| "action"
	| "group";

export type SettingsValue = string | number | boolean | undefined;

export interface SettingsChoice {
	label: string;
	value: string;
}

export interface SettingsItem {
	/** Stable section-qualified id. */
	id: string;
	section: SettingsSectionId;
	/** Display name (short). */
	name: string;
	kind: SettingsItemKind;
	risk: SettingsRisk;
	/** One-line purpose — the decision the user is making. */
	summary: string;
	/** Contextual help: what it does, where it persists, how to revert. */
	help: string;
	/** Where the value persists (display path or file name). */
	persistedIn?: string;
	/** Related commands/files surfaced in the item view. */
	related?: string[];
	/** Search keywords beyond name/summary/help. */
	tags?: string[];
	/** Hidden behind the Advanced gate. */
	advanced?: boolean;
	/** Effective value, or a short human string for readonly rows. */
	get?: () => SettingsValue | Promise<SettingsValue>;
	/** Human rendering of the value for menus (defaults to String(value)). */
	format?: (value: SettingsValue) => string;
	/** Write path. Throws with a user-facing message on refusal. */
	set?: (value: SettingsValue) => void | Promise<void>;
	/** Default value for diff/revert-to-default (when known). */
	default?: SettingsValue;
	choices?: SettingsChoice[];
	min?: number;
	max?: number;
	/** Integer-only for number items. */
	integer?: boolean;
	/** The command/flow this action launches (displayed as "runs …"). */
	actionLabel?: string;
	/** Whether changing this needs /reload or a restart to bind. */
	reloadNote?: string;
	/** Env var name the item mirrors (for the env-var browser). */
	env?: string;
}

/** A page of items rendered together inside one section submenu. */
export interface SettingsGroup {
	id: string;
	title: string;
	items: SettingsItem[];
}

// ---------------------------------------------------------------------------
// Change ledger (settings-history.jsonl) — append-only, append-then-cap
// ---------------------------------------------------------------------------

export type ChangeActor = "user" | "import" | "reset" | "revert" | "system";

export interface ChangeEntry {
	id: string;
	ts: number;
	actor: ChangeActor;
	itemId: string;
	itemName: string;
	section: SettingsSectionId;
	before: SettingsValue;
	after: SettingsValue;
	/** Where the change came from: "hub", "/settings reset", "import <file>" … */
	via: string;
}

// ---------------------------------------------------------------------------
// Health checks (doctor-lite inside the hub)
// ---------------------------------------------------------------------------

export type HealthStatus = "ok" | "warn" | "fail" | "info";

export interface HealthCheck {
	id: string;
	status: HealthStatus;
	label: string;
	detail: string;
	/** Item id whose editor fixes this (deep-link from the health view). */
	fixItemId?: string;
}

// ---------------------------------------------------------------------------
// Hub preferences (settings-hub.json) — hub-OWNED settings only
// ---------------------------------------------------------------------------

export interface HubPrefs {
	/** Dream review mode: pending diffs require approval before applying. */
	learningReviewMode: boolean;
	/** Max turns per active goal before auto-pause (0 = off). */
	goalBudgetTurns: number;
	/** Max hook execution depth (loop breaker). */
	hookMaxDepth: number;
	/** Hide advanced rows by default in section menus. */
	showAdvanced: boolean;
	/** Ledger length cap (entries kept, oldest trimmed). */
	historyCap: number;
}

export const DEFAULT_HUB_PREFS: HubPrefs = {
	learningReviewMode: false,
	goalBudgetTurns: 0,
	hookMaxDepth: 3,
	showAdvanced: false,
	historyCap: 500,
};

// ---------------------------------------------------------------------------
// Transfer bundles (export / import / reset backups)
// ---------------------------------------------------------------------------

export const SETTINGS_BUNDLE_SCHEMA = 1;

export interface SettingsBundle {
	schema: 1;
	kind: "export" | "backup";
	createdAt: number;
	unownVersion?: string;
	/** Addons config (user-owned, no secrets). */
	addons?: unknown;
	/** pi user-scope settings.json (subset written back via merge). */
	piSettings?: Record<string, unknown>;
	/** Startup split-view layout. */
	uiPanels?: unknown;
	/** Active output-style pointer. */
	outputStyle?: unknown;
	/** Hub-owned preferences. */
	hubPrefs?: HubPrefs;
	/** User-scope permission rules (rule list only — never secrets). */
	permissionsRules?: unknown;
	/** Theme selection (the pi settings key, kept separate for clarity). */
	theme?: string;
}
