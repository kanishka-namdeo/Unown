/**
 * addons/config.ts — user configuration for the unown TUI addons.
 *
 * One JSON file, `~/.unown/agent/addons.json` (UNOWN_HOME-respecting), holds
 * every addon's user-tunable settings:
 *
 *   - askUserQuestion: enabled, collapseKey, guidance overrides
 *   - todo:            enabled, maxWidgetLines, collapseKey, guidance
 *   - advisor:         enabled, model routing, review cadence, budgets,
 *                      delivery policy, per-user instructions
 *
 * Design contract (mirrors the settings-seeding rules in term.ts):
 *   - NEVER clobber user edits: seeding writes the file only when absent.
 *   - Unknown keys are dropped, malformed values fall back to defaults —
 *     a bad config must degrade, never crash the session boot.
 *   - Writes are atomic (tmp file + rename) so a torn write can never leave
 *     a half-written config behind.
 *   - Hot-reloadable fields are re-read at use time (todo reads
 *     maxWidgetLines per render); registration-time fields (guidance,
 *     collapse shortcuts) need a `/reload` — documented in docs/addons.md.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { UNOWN_HOME } from "../term.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** LLM-facing copy overrides shared by the tool-registering addons. */
export interface AddonGuidance {
        /** Full replacement for the built-in tool description (no merging). */
        description?: string;
        /** One-line snippet for the "Available tools" system-prompt section. */
        promptSnippet?: string;
        /** Usage-guideline bullets appended to the system prompt. */
        promptGuidelines?: string[];
}

export interface AskUserQuestionAddonConfig {
        enabled: boolean;
        /** pi keybinding grammar ("ctrl+]"); "off" disables the shortcut. */
        collapseKey: string;
        guidance: AddonGuidance;
}

export interface TodoAddonConfig {
        enabled: boolean;
        /** Content rows the overlay may use (heading included). Minimum 3. */
        maxWidgetLines: number;
        collapseKey: string;
        guidance: AddonGuidance;
}

export interface AdvisorAddonConfig {
        enabled: boolean;
        /** Advisor model routing: "provider/model" or bare model id. */
        model?: string;
        /** Thinking level for the advisor ("off" | "low" | "medium" | "high"). */
        thinkingLevel: "off" | "low" | "medium" | "high";
        /** When a review batch is dispatched: every turn, or only at agent end. */
        reviewMode: "turn" | "agent-end";
        /** With reviewMode "turn": review every Nth eligible turn (>= 1). */
        reviewInterval: number;
        /** Max non-blocker advises per review (1..32; blockers exempt). */
        maxNotesPerUpdate: number;
        /** Turns after a steering advise where further concerns degrade to asides. */
        immuneTurns: number;
        /** Minimum severity that may wake a finished agent ("concern" default). */
        continueSeverity: "nit" | "concern" | "blocker";
        /** Free-form per-user instructions appended to the advisor system prompt. */
        instructions?: string;
        /** Show the advisor status segment in the footer while active. */
        showStatus: boolean;
}

export interface AddonsConfig {
        askUserQuestion: AskUserQuestionAddonConfig;
        todo: TodoAddonConfig;
        advisor: AdvisorAddonConfig;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_WIDGET_LINES = 12;
export const DEFAULT_ASK_COLLAPSE_KEY = "ctrl+]";
export const DEFAULT_TODO_COLLAPSE_KEY = "ctrl+shift+t";

export const DEFAULT_ADDONS_CONFIG: AddonsConfig = {
        askUserQuestion: {
                enabled: true,
                collapseKey: DEFAULT_ASK_COLLAPSE_KEY,
                guidance: {},
        },
        todo: {
                enabled: true,
                maxWidgetLines: DEFAULT_MAX_WIDGET_LINES,
                collapseKey: DEFAULT_TODO_COLLAPSE_KEY,
                guidance: {},
        },
        advisor: {
                // Faithful to oh-my-pi: the advisor ships OFF by default (a second
                // model doubles token traffic per turn); enable with `/advisor on`, the
                // /addons configurator, or by editing this file. Flat-rate coding-plan
                // deployments are the topology where flipping it on is cheap.
                enabled: false,
                thinkingLevel: "medium",
                reviewMode: "turn",
                reviewInterval: 1,
                maxNotesPerUpdate: 4,
                immuneTurns: 3,
                continueSeverity: "concern",
                showStatus: true,
        },
};

// ---------------------------------------------------------------------------
// Key-spec grammar (strict mirror of pi-tui's KeyId spelling)
// ---------------------------------------------------------------------------

const MODIFIERS = new Set(["ctrl", "shift", "alt", "super"]);
const NAMED_KEYS = new Set([
        "escape",
        "esc",
        "enter",
        "return",
        "tab",
        "space",
        "backspace",
        "delete",
        "insert",
        "clear",
        "home",
        "end",
        "pageup",
        "pagedown",
        "up",
        "down",
        "left",
        "right",
]);
const PRINTABLE_BASE = /^[a-z0-9_\-!@#$%^&*()|~`'":;,./<>?[\]{}=\\]$/;
const FUNCTION_KEYS = /^f([1-9]|1[0-2])$/;

/**
 * Strict validation of a collapse-key spec. Typos must NOT fall through to a
 * bare-key match: pi-tui's parser takes the last `+`-segment as the base key,
 * so `ctr+]` would capture every bare `]` press globally. Invalid specs
 * resolve to the caller's default at load time.
 */
export function isValidKeySpec(spec: string): boolean {
        const parts = spec.split("+");
        if (parts.length === 0) return false;
        const base = parts[parts.length - 1];
        if (!base) return false;
        if (!(PRINTABLE_BASE.test(base) || NAMED_KEYS.has(base) || FUNCTION_KEYS.test(base))) return false;
        const modifiers = parts.slice(0, -1);
        const seen = new Set<string>();
        for (const modifier of modifiers) {
                if (!MODIFIERS.has(modifier) || seen.has(modifier)) return false;
                seen.add(modifier);
        }
        return true;
}

/** Resolve a raw config value into a validated key spec (or "off"). */
export function resolveCollapseKey(raw: unknown, defaultKey: string): string {
        if (typeof raw !== "string") return defaultKey;
        const trimmed = raw.trim().toLowerCase();
        if (trimmed === "") return defaultKey;
        if (trimmed === "off") return "off";
        return isValidKeySpec(trimmed) ? trimmed : defaultKey;
}

/** Pretty-print a key spec for UI copy ("ctrl+]" → "Ctrl+]"). */
export function formatKeyForDisplay(spec: string): string {
        if (spec === "off") return "off";
        return spec
                .split("+")
                .map((part) => {
                        if (FUNCTION_KEYS.test(part)) return part.toUpperCase();
                        if (part.length <= 1) return /[a-z]/.test(part) ? part.toUpperCase() : part;
                        if (NAMED_KEYS.has(part)) {
                                if (part === "escape" || part === "esc") return "Esc";
                                if (part === "enter" || part === "return") return "Enter";
                                if (part === "pageup") return "PageUp";
                                if (part === "pagedown") return "PageDown";
                                return part.charAt(0).toUpperCase() + part.slice(1);
                        }
                        return part.charAt(0).toUpperCase() + part.slice(1);
                })
                .join("+");
}

// ---------------------------------------------------------------------------
// Guidance validation
// ---------------------------------------------------------------------------

function sanitizeGuidance(raw: unknown): AddonGuidance {
        const guidance: AddonGuidance = {};
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return guidance;
        const record = raw as Record<string, unknown>;
        if (typeof record.description === "string" && record.description.trim() !== "") {
                guidance.description = record.description;
        }
        if (typeof record.promptSnippet === "string" && record.promptSnippet.trim() !== "") {
                guidance.promptSnippet = record.promptSnippet;
        }
        if (Array.isArray(record.promptGuidelines)) {
                const bullets = record.promptGuidelines.filter(
                        (line): line is string => typeof line === "string" && line.trim() !== "",
                );
                if (bullets.length > 0) guidance.promptGuidelines = bullets;
        }
        return guidance;
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

export function addonsConfigPath(): string {
        return join(UNOWN_HOME, "agent", "addons.json");
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
        const value = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(value)) return fallback;
        return Math.min(Math.max(Math.trunc(value), min), max);
}

/**
 * Parse a raw JSON object into a fully-populated AddonsConfig. Unknown keys
 * and malformed values degrade to defaults; a non-object yields the default
 * config wholesale. Exported for tests.
 */
export function parseAddonsConfig(raw: unknown): AddonsConfig {
        const config: AddonsConfig = structuredClone(DEFAULT_ADDONS_CONFIG);
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return config;
        const record = raw as Record<string, unknown>;

        const ask = typeof record.askUserQuestion === "object" && record.askUserQuestion !== null
                ? (record.askUserQuestion as Record<string, unknown>)
                : {};
        if (typeof ask.enabled === "boolean") config.askUserQuestion.enabled = ask.enabled;
        config.askUserQuestion.collapseKey = resolveCollapseKey(ask.collapseKey, DEFAULT_ASK_COLLAPSE_KEY);
        config.askUserQuestion.guidance = sanitizeGuidance(ask.guidance);

        const todo = typeof record.todo === "object" && record.todo !== null
                ? (record.todo as Record<string, unknown>)
                : {};
        if (typeof todo.enabled === "boolean") config.todo.enabled = todo.enabled;
        config.todo.maxWidgetLines = clampInt(todo.maxWidgetLines, DEFAULT_MAX_WIDGET_LINES, 3, 64);
        config.todo.collapseKey = resolveCollapseKey(todo.collapseKey, DEFAULT_TODO_COLLAPSE_KEY);
        config.todo.guidance = sanitizeGuidance(todo.guidance);

        const advisor = typeof record.advisor === "object" && record.advisor !== null
                ? (record.advisor as Record<string, unknown>)
                : {};
        if (typeof advisor.enabled === "boolean") config.advisor.enabled = advisor.enabled;
        if (typeof advisor.model === "string" && advisor.model.trim() !== "") {
                config.advisor.model = advisor.model.trim();
        }
        if (
                advisor.thinkingLevel === "off" ||
                advisor.thinkingLevel === "low" ||
                advisor.thinkingLevel === "medium" ||
                advisor.thinkingLevel === "high"
        ) {
                config.advisor.thinkingLevel = advisor.thinkingLevel;
        }
        if (advisor.reviewMode === "turn" || advisor.reviewMode === "agent-end") {
                config.advisor.reviewMode = advisor.reviewMode;
        }
        config.advisor.reviewInterval = clampInt(advisor.reviewInterval, 1, 1, 64);
        config.advisor.maxNotesPerUpdate = clampInt(advisor.maxNotesPerUpdate, 4, 1, 32);
        config.advisor.immuneTurns = clampInt(advisor.immuneTurns, 3, 0, 32);
        if (
                advisor.continueSeverity === "nit" ||
                advisor.continueSeverity === "concern" ||
                advisor.continueSeverity === "blocker"
        ) {
                config.advisor.continueSeverity = advisor.continueSeverity;
        }
        if (typeof advisor.instructions === "string" && advisor.instructions.trim() !== "") {
                config.advisor.instructions = advisor.instructions;
        }
        if (typeof advisor.showStatus === "boolean") config.advisor.showStatus = advisor.showStatus;
        return config;
}

/** Load the addon config; a missing or malformed file yields defaults. */
export function loadAddonsConfig(): AddonsConfig {
        const path = addonsConfigPath();
        if (!existsSync(path)) return structuredClone(DEFAULT_ADDONS_CONFIG);
        try {
                const text = readFileSync(path, "utf8");
                return parseAddonsConfig(JSON.parse(text));
        } catch (error) {
                console.warn(`[unown-addons] invalid JSON at ${path}, using defaults: ${String(error)}`);
                return structuredClone(DEFAULT_ADDONS_CONFIG);
        }
}

/** Atomic write: temp file in the same directory, then rename over. */
export function saveAddonsConfig(config: AddonsConfig): void {
        const path = addonsConfigPath();
        mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
        writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
        renameSync(tmp, path);
}

/**
 * Seed the default addon config next to settings.json — only when absent, so
 * a user's hand edits always survive. Called from term.ts's
 * ensureUnownAgentDirInfo.
 */
export function seedAddonsConfig(): void {
        const path = addonsConfigPath();
        if (existsSync(path)) return;
        try {
                saveAddonsConfig(structuredClone(DEFAULT_ADDONS_CONFIG));
        } catch {
                // Non-fatal: loadAddonsConfig falls back to in-memory defaults.
        }
}
