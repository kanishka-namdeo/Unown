/**
 * settings/history.ts — the settings change ledger + Recently changed.
 *
 * Every hub-mediated write lands in `$UNOWN_HOME/agent/settings-history.jsonl`
 * (append-only JSONL, capped at prefs.historyCap entries, oldest trimmed on
 * append). This is the audit trail the trust framework demands
 * (docs/settings_trust_recovery_framework.md §1 "Settings changes"): who
 * changed what, when, from what, to what, via which surface.
 *
 * Revert is FIRST-CLASS: every entry can be re-applied backwards through the
 * owning item's setter (the registry supplies itemById), so "recently
 * changed" doubles as an undo lane for configuration drift — the pattern no
 * competitor ships (settings_competitor_review.md §"recently changed").
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveUnownHome } from "../unown-home.ts";
import { loadHubPrefs } from "./prefs.ts";
import type { ChangeActor, ChangeEntry, SettingsSectionId, SettingsValue } from "./types.ts";

const LEDGER_MAX = 500;

export function historyPath(): string {
        return join(resolveUnownHome(), "agent", "settings-history.jsonl");
}

let seq = 0;
function nextId(ts: number): string {
        seq = (seq + 1) % 1000;
        return `${ts.toString(36)}-${seq.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Read the whole ledger, newest last. Malformed lines are skipped (never crash). */
export function readLedger(): ChangeEntry[] {
        const path = historyPath();
        if (!existsSync(path)) return [];
        const out: ChangeEntry[] = [];
        for (const line of readFileSync(path, "utf8").split("\n")) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                        const parsed = JSON.parse(trimmed) as ChangeEntry;
                        if (
                                typeof parsed?.id === "string" &&
                                typeof parsed?.ts === "number" &&
                                typeof parsed?.itemId === "string" &&
                                typeof parsed?.itemName === "string" &&
                                typeof parsed?.section === "string" &&
                                typeof parsed?.via === "string"
                        ) {
                                out.push(parsed);
                        }
                } catch {
                        /* skip malformed line */
                }
        }
        return out;
}

/** Newest-first slice for the Recently changed view. */
export function recentChanges(n = 10): ChangeEntry[] {
        const all = readLedger();
        return all.slice(-n).reverse();
}

/** Append an entry (then trim to the cap). Fire-and-forget safe: throws are
 *  the caller's choice (the UI notifies, never crashes, on failure). */
export function recordChange(entry: {
        actor: ChangeActor;
        itemId: string;
        itemName: string;
        section: SettingsSectionId;
        before: SettingsValue;
        after: SettingsValue;
        via: string;
}): ChangeEntry {
        const ts = Date.now();
        const full: ChangeEntry = { id: nextId(ts), ts, ...entry };
        const path = historyPath();
        mkdirSync(dirname(path), { recursive: true });
        const cap = Math.max(50, loadHubPrefs().historyCap || LEDGER_MAX);
        const existing = readLedger();
        const kept = existing.length >= cap ? existing.slice(existing.length - cap + 1) : existing;
        const tmp = `${path}.tmp-${process.pid}-${ts}`;
        writeFileSync(tmp, `${[...kept, full].map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
        renameSync(tmp, path);
        return full;
}

/**
 * Revert an entry by re-applying its `before` value through the item's
 * setter. Returns a human result; never throws past the caller's notify.
 */
export async function revertChange(
        entryId: string,
        itemSetter: (itemId: string) => {
                set?: (value: SettingsValue) => void | Promise<void>;
                get?: () => SettingsValue | Promise<SettingsValue>;
        } | undefined,
): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
        const entry = readLedger().find((e) => e.id === entryId);
        if (!entry) return { ok: false, error: "entry not found in the ledger" };
        const item = itemSetter(entry.itemId);
        if (!item?.set) return { ok: false, error: "this setting can no longer be written from the hub" };
        const current = item.get ? await item.get() : undefined;
        await item.set(entry.before);
        recordChange({
                actor: "revert",
                itemId: entry.itemId,
                itemName: entry.itemName,
                section: entry.section,
                before: current,
                after: entry.before,
                via: `revert of ${entry.id}`,
        });
        return { ok: true, detail: `${entry.itemName} reverted to ${JSON.stringify(entry.before)}` };
}

/** Prune entries older than `days` (retention hygiene for the ledger itself). */
export function pruneLedger(days: number): number {
        const entries = readLedger();
        if (entries.length === 0 || !(days > 0)) return 0;
        const cutoff = Date.now() - days * 86400_000;
        const kept = entries.filter((e) => e.ts >= cutoff);
        if (kept.length === entries.length) return 0;
        const path = historyPath();
        const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
        writeFileSync(tmp, `${kept.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
        renameSync(tmp, path);
        return entries.length - kept.length;
}
