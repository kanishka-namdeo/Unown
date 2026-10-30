/**
 * settings/prefs.ts — hub-owned preferences (settings-hub.json).
 *
 * ONLY hub-created settings live here (review mode, goal budget, hook depth,
 * display preferences). Everything else is read/written through its owning
 * surface (addons.json, pi settings.json, permissions.json …) — the hub
 * never becomes a second source of truth for existing data.
 *
 * Persistence contract (mirrors addons/config.ts):
 *   - atomic writes (tmp + rename in the same directory)
 *   - unknown keys dropped, malformed values fall back to defaults — a bad
 *     file must degrade, never crash the hub
 *   - seeding writes only when absent (user edits always survive)
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveUnownHome } from "../unown-home.ts";
import { DEFAULT_HUB_PREFS, type HubPrefs } from "./types.ts";

export function hubPrefsPath(): string {
        // Call-time home resolution (the unown-home.ts contract): tests and
        // long-lived processes can repoint UNOWN_HOME without a re-import.
        return join(resolveUnownHome(), "agent", "settings-hub.json");
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
        const value = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(value)) return fallback;
        return Math.min(Math.max(Math.trunc(value), min), max);
}

/** Parse a raw JSON object into a fully-populated HubPrefs. Exported for tests. */
export function parseHubPrefs(raw: unknown): HubPrefs {
        const prefs: HubPrefs = structuredClone(DEFAULT_HUB_PREFS);
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return prefs;
        const record = raw as Record<string, unknown>;
        if (typeof record.learningReviewMode === "boolean") prefs.learningReviewMode = record.learningReviewMode;
        prefs.goalBudgetTurns = clampInt(record.goalBudgetTurns, DEFAULT_HUB_PREFS.goalBudgetTurns, 0, 10000);
        prefs.hookMaxDepth = clampInt(record.hookMaxDepth, DEFAULT_HUB_PREFS.hookMaxDepth, 1, 10);
        if (typeof record.showAdvanced === "boolean") prefs.showAdvanced = record.showAdvanced;
        prefs.historyCap = clampInt(record.historyCap, DEFAULT_HUB_PREFS.historyCap, 50, 5000);
        return prefs;
}

export function loadHubPrefs(): HubPrefs {
        const path = hubPrefsPath();
        if (!existsSync(path)) return structuredClone(DEFAULT_HUB_PREFS);
        try {
                return parseHubPrefs(JSON.parse(readFileSync(path, "utf8")));
        } catch {
                return structuredClone(DEFAULT_HUB_PREFS);
        }
}

/** Atomic write: temp file in the same directory, then rename over. */
export function saveHubPrefs(prefs: HubPrefs): void {
        const path = hubPrefsPath();
        mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
        writeFileSync(tmp, `${JSON.stringify(prefs, null, 2)}\n`, "utf8");
        renameSync(tmp, path);
}

/** Seed defaults next to the other agent configs — only when absent. */
export function seedHubPrefs(): void {
        const path = hubPrefsPath();
        if (existsSync(path)) return;
        try {
                saveHubPrefs(structuredClone(DEFAULT_HUB_PREFS));
        } catch {
                /* non-fatal: loadHubPrefs falls back to in-memory defaults */
        }
}
