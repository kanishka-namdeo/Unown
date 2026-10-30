/**
 * settings/diff.ts — configuration diff vs defaults (the hub's Diff view).
 *
 * Shows which hub-visible settings differ from their defaults — the drift
 * view Claude Code approximates with its settings-error dialog and Roo with
 * export-before-reset advice. Here it is first-class: every drifted row
 * names its owning item and can be reset through the item editor.
 */

import { itemById, SETTINGS_REGISTRY } from "./registry.ts";
import type { SettingsItem } from "./types.ts";

export interface DiffRow {
	itemId: string;
	name: string;
	section: string;
	current: string;
	default: string;
	risk: string;
}

function render(value: unknown): string {
	if (value === undefined) return "(unset)";
	if (typeof value === "boolean") return value ? "on" : "off";
	return String(value);
}

/** Collect items whose current value differs from their declared default. */
export async function diffAgainstDefaults(): Promise<DiffRow[]> {
	const rows: DiffRow[] = [];
	for (const item of SETTINGS_REGISTRY) {
		if (item.default === undefined || !item.get) continue;
		try {
			const current = await item.get();
			if (current === undefined) continue;
			if (current === item.default) continue;
			rows.push({
				itemId: item.id,
				name: item.name,
				section: item.section,
				current: item.format ? item.format(current) : render(current),
				default: render(item.default),
				risk: item.risk,
			});
		} catch {
			/* a failing getter never breaks the diff view */
		}
	}
	return rows;
}

export function formatDiffRows(rows: DiffRow[]): string {
	if (rows.length === 0) return "No settings differ from their defaults.";
	return rows
		.map((r) => `${r.section} → ${r.name}: ${r.current}  (default: ${r.default})${r.risk === "high" ? "  ○ HIGH RISK" : ""}`)
		.join("\n");
}

/** Reset one drifted item to its declared default (through its setter). */
export async function resetItemToDefault(itemId: string): Promise<{ ok: boolean; detail: string }> {
	const item: SettingsItem | undefined = itemById(itemId);
	if (!item) return { ok: false, detail: `unknown item ${itemId}` };
	if (!item.set || item.default === undefined) {
		return { ok: false, detail: `${item.name} has no hub write path — ${item.persistedIn ?? "edit its owning file"}` };
	}
	const before = item.get ? await item.get() : undefined;
	await item.set(item.default);
	return { ok: true, detail: `${item.name}: ${String(before)} → ${String(item.default)}` };
}
