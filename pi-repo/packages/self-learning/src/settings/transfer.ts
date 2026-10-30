/**
 * settings/transfer.ts — export / import / reset for the hub (Phase 8).
 *
 * Design (trust framework §4 "No reset without backup"):
 *   - Export bundles are schema-versioned JSON, USER-OWNED settings only —
 *     never auth.json, models.json (provider keys), or .env.
 *   - Import validates the schema, writes a timestamped BACKUP of current
 *     state first, then merges per-surface (never clobbers unknown keys).
 *   - Reset is SCOPED (hub prefs / addons / pi settings / all), always
 *     writes a backup bundle first; backups keep the last 5.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { DEFAULT_ADDONS_CONFIG, loadAddonsConfig, parseAddonsConfig, saveAddonsConfig } from "../addons/config.ts";
import { resolveUnownHome } from "../unown-home.ts";
import { recordChange } from "./history.ts";
import { loadHubPrefs, parseHubPrefs, saveHubPrefs } from "./prefs.ts";
import { resetPiManagerCache } from "./registry.ts";
import {
        DEFAULT_HUB_PREFS,
        SETTINGS_BUNDLE_SCHEMA,
        type HubPrefs,
        type SettingsBundle,
        type SettingsSectionId,
} from "./types.ts";

/** Call-time home + agent-dir (the unown-home.ts contract — see prefs.ts). */
function unownAgentDir(): string {
        return join(resolveUnownHome(), "agent");
}

const BACKUPS_DIR = () => join(resolveUnownHome(), "agent", "settings-backups");
const BACKUP_KEEP = 5;

function readJson(path: string): unknown | undefined {
        try {
                if (!existsSync(path)) return undefined;
                return JSON.parse(readFileSync(path, "utf8"));
        } catch {
                return undefined;
        }
}

function writeJsonAtomic(path: string, value: unknown): void {
        mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
        writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
        renameSync(tmp, path);
}

function stamp(ts: number): string {
        return new Date(ts).toISOString().replace(/[:.]/g, "-");
}

/** Monotonic suffix — same-millisecond backups must never collide. */
let backupSeq = 0;
function nextBackupName(kind: "reset" | "import"): string {
        backupSeq = (backupSeq + 1) % 10_000;
        return `${kind}-${stamp(Date.now())}-${backupSeq}.json`;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function buildExportBundle(unownVersion?: string): SettingsBundle {
        const bundle: SettingsBundle = {
                schema: SETTINGS_BUNDLE_SCHEMA,
                kind: "export",
                createdAt: Date.now(),
        };
        if (unownVersion) bundle.unownVersion = unownVersion;
        const addons = readJson(join(unownAgentDir(), "addons.json"));
        if (addons !== undefined) bundle.addons = addons;
        const uiPanels = readJson(join(unownAgentDir(), "ui-panels.json"));
        if (uiPanels !== undefined) bundle.uiPanels = uiPanels;
        const outputStyle = readJson(join(unownAgentDir(), "output-style.json"));
        if (outputStyle !== undefined) bundle.outputStyle = outputStyle;
        bundle.hubPrefs = loadHubPrefs();
        const piSettings = readJson(join(unownAgentDir(), "settings.json")) as Record<string, unknown> | undefined;
        if (piSettings && typeof piSettings === "object") {
                // User-scope pi settings contain no secrets (keys live in auth.json).
                // Strip internal bookkeeping keys; keep the rest verbatim.
                const { lastChangelogVersion: _drop, ...rest } = piSettings;
                void _drop;
                bundle.piSettings = rest;
                if (typeof piSettings.theme === "string") bundle.theme = piSettings.theme;
        }
        const permissions = readJson(join(unownAgentDir(), "permissions.json")) as { rules?: unknown } | undefined;
        if (permissions && Array.isArray(permissions.rules)) bundle.permissionsRules = permissions.rules;
        return bundle;
}

export function exportSettings(outPath: string, unownVersion?: string): { ok: boolean; path?: string; error?: string } {
        const bundle = buildExportBundle(unownVersion);
        writeJsonAtomic(outPath, bundle);
        return { ok: true, path: outPath };
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

export function writeBackup(kind: "reset" | "import"): string {
        const bundle = buildExportBundle();
        bundle.kind = "backup";
        const path = join(BACKUPS_DIR(), nextBackupName(kind));
        writeJsonAtomic(path, bundle);
        pruneBackups();
        return path;
}

export function pruneBackups(): number {
        if (!existsSync(BACKUPS_DIR())) return 0;
        const files = readdirSync(BACKUPS_DIR())
                .filter((f) => f.endsWith(".json"))
                .sort();
        let removed = 0;
        while (files.length > BACKUP_KEEP) {
                const victim = files.shift();
                if (victim) {
                        rmSync(join(BACKUPS_DIR(), victim), { force: true });
                        removed++;
                }
        }
        return removed;
}

export function listBackups(): string[] {
        if (!existsSync(BACKUPS_DIR())) return [];
        return readdirSync(BACKUPS_DIR())
                .filter((f) => f.endsWith(".json"))
                .sort()
                .reverse();
}

// ---------------------------------------------------------------------------
// Import (merge semantics — never clobbers unknown keys)
// ---------------------------------------------------------------------------

export interface ImportResult {
        ok: boolean;
        applied: string[];
        skipped: string[];
        backupPath?: string;
        error?: string;
}

export function validateBundle(raw: unknown): { ok: boolean; bundle?: SettingsBundle; error?: string } {
        if (typeof raw !== "object" || raw === null) return { ok: false, error: "not a JSON object" };
        const record = raw as Record<string, unknown>;
        if (record.schema !== SETTINGS_BUNDLE_SCHEMA) {
                return { ok: false, error: `unsupported schema (expected ${SETTINGS_BUNDLE_SCHEMA})` };
        }
        if (record.kind !== "export" && record.kind !== "backup") {
                return { ok: false, error: "kind must be 'export' or 'backup'" };
        }
        if (typeof record.createdAt !== "number") return { ok: false, error: "createdAt missing" };
        return { ok: true, bundle: record as SettingsBundle };
}

export function importSettings(inPath: string, via: string): ImportResult {
        const raw = readJson(inPath);
        if (raw === undefined) return { ok: false, applied: [], skipped: [], error: `cannot read ${inPath}` };
        const validated = validateBundle(raw);
        if (!validated.ok || !validated.bundle) {
                return { ok: false, applied: [], skipped: [], error: validated.error ?? "invalid bundle" };
        }
        const bundle = validated.bundle;
        const backupPath = writeBackup("import");
        const applied: string[] = [];
        const skipped: string[] = [];

        if (bundle.hubPrefs) {
                const prefs = parseHubPrefs(bundle.hubPrefs);
                saveHubPrefs(prefs);
                recordChange({
                        actor: "import",
                        itemId: "hub.prefs",
                        itemName: "Hub preferences",
                        section: "advanced" as SettingsSectionId,
                        before: JSON.stringify(loadHubPrefs()),
                        after: JSON.stringify(prefs),
                        via,
                });
                applied.push("hub preferences");
        }

        if (bundle.addons) {
                const parsed = parseAddonsConfig(bundle.addons);
                saveAddonsConfig(parsed);
                applied.push("addons.json");
        }

        if (bundle.uiPanels) {
                writeJsonAtomic(join(unownAgentDir(), "ui-panels.json"), bundle.uiPanels);
                applied.push("ui-panels.json");
        }

        if (bundle.outputStyle) {
                writeJsonAtomic(join(unownAgentDir(), "output-style.json"), bundle.outputStyle);
                applied.push("output-style.json");
        }

        if (bundle.permissionsRules && Array.isArray(bundle.permissionsRules)) {
                const current = (readJson(join(unownAgentDir(), "permissions.json")) ?? {}) as { rules?: unknown[] };
                const currentRules = Array.isArray(current.rules) ? current.rules : [];
                const seen = new Set(currentRules.map((r) => JSON.stringify(r)));
                const merged = [...currentRules];
                for (const rule of bundle.permissionsRules) {
                        const key = JSON.stringify(rule);
                        if (!seen.has(key)) {
                                merged.push(rule);
                                seen.add(key);
                        }
                }
                writeJsonAtomic(join(unownAgentDir(), "permissions.json"), { ...(current as object), rules: merged });
                applied.push("permission rules (merged, deduped)");
        }

        if (bundle.piSettings && typeof bundle.piSettings === "object") {
                // Pi settings apply through the SettingsManager's locked field-merge —
                // only the keys with hub setters are applied; the rest are reported.
                const manager = SettingsManager.create(process.cwd(), unownAgentDir());
                const incoming = bundle.piSettings as Record<string, unknown>;
                const handled = new Set([
                        "theme",
                        "quietStartup",
                        "steeringMode",
                        "followUpMode",
                        "defaultProjectTrust",
                        "autoCompact",
                        "hideThinkingBlock",
                        "showCacheMissNotices",
                        "enableInstallTelemetry",
                ]);
                try {
                        if (typeof incoming.theme === "string") manager.setTheme(incoming.theme);
                        if (typeof incoming.quietStartup === "boolean") manager.setQuietStartup(incoming.quietStartup);
                        if (incoming.steeringMode === "all" || incoming.steeringMode === "one-at-a-time") {
                                manager.setSteeringMode(incoming.steeringMode);
                        }
                        if (incoming.followUpMode === "all" || incoming.followUpMode === "one-at-a-time") {
                                manager.setFollowUpMode(incoming.followUpMode);
                        }
                        if (incoming.defaultProjectTrust === "ask" || incoming.defaultProjectTrust === "always" || incoming.defaultProjectTrust === "never") {
                                manager.setDefaultProjectTrust(incoming.defaultProjectTrust);
                        }
                        if (typeof incoming.autoCompact === "boolean") manager.setCompactionEnabled(incoming.autoCompact);
                        if (typeof incoming.hideThinkingBlock === "boolean") manager.setHideThinkingBlock(incoming.hideThinkingBlock);
                        if (typeof incoming.showCacheMissNotices === "boolean") manager.setShowCacheMissNotices(incoming.showCacheMissNotices);
                        resetPiManagerCache();
                        applied.push("pi settings (known keys)");
                        for (const key of Object.keys(incoming)) {
                                if (!handled.has(key)) skipped.push(`pi settings key '${key}' (no hub setter — edit settings.json)`);
                        }
                } catch (error) {
                        skipped.push(`pi settings (${String(error)})`);
                }
        }

        return { ok: true, applied, skipped, backupPath };
}

// ---------------------------------------------------------------------------
// Reset (scoped, backed up)
// ---------------------------------------------------------------------------

export type ResetScope = "hub" | "addons" | "pi" | "all";

export interface ResetResult {
        ok: boolean;
        scope: ResetScope;
        backupPath: string;
        reset: string[];
}

export function resetSettings(scope: ResetScope, via: string): ResetResult {
        const backupPath = writeBackup("reset");
        const reset: string[] = [];
        if (scope === "hub" || scope === "all") {
                const before: HubPrefs = loadHubPrefs();
                saveHubPrefs(structuredClone(DEFAULT_HUB_PREFS));
                recordChange({
                        actor: "reset",
                        itemId: "hub.prefs",
                        itemName: "Hub preferences",
                        section: "advanced",
                        before: JSON.stringify(before),
                        after: JSON.stringify(DEFAULT_HUB_PREFS),
                        via,
                });
                reset.push("hub preferences → defaults");
        }
        if (scope === "addons" || scope === "all") {
                const before = loadAddonsConfig();
                saveAddonsConfig(structuredClone(DEFAULT_ADDONS_CONFIG));
                recordChange({
                        actor: "reset",
                        itemId: "agent.addons",
                        itemName: "Addons config",
                        section: "agent",
                        before: JSON.stringify(before),
                        after: JSON.stringify(DEFAULT_ADDONS_CONFIG),
                        via,
                });
                reset.push("addons.json → defaults");
        }
        if (scope === "pi" || scope === "all") {
                // Reset the hub-managed pi keys to defaults through the manager (each
                // key rides its setter so the merge-lock and diagnostics hold). The
                // raw file is never deleted — unknown/user keys survive.
                const manager = SettingsManager.create(process.cwd(), unownAgentDir());
                try {
                        manager.setTheme("dark");
                        manager.setQuietStartup(false);
                        manager.setSteeringMode("all");
                        manager.setFollowUpMode("all");
                        manager.setDefaultProjectTrust("ask");
                        manager.setCompactionEnabled(true);
                        manager.setHideThinkingBlock(false);
                        manager.setShowCacheMissNotices(true);
                        resetPiManagerCache();
                        reset.push("pi settings (hub-managed keys) → defaults");
                } catch (error) {
                        reset.push(`pi settings partially reset (${String(error)})`);
                }
        }
        return { ok: true, scope, backupPath, reset };
}
