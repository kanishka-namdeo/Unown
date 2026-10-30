/**
 * settings/search.ts — fuzzy search over the settings catalog.
 *
 * The competitor review's finding: NO terminal tool ships settings search
 * (settings_competitor_review.md §"settings search") — this is the
 * differentiation surface. Matches run over name + summary + help + tags +
 * section title + env var + current value, scored subsequence-style with
 * word-boundary and prefix boosts; results carry the section for context.
 */

import { itemsBySection, SETTINGS_REGISTRY } from "./registry.ts";
import { SECTION_META } from "./types.ts";
import type { SettingsItem } from "./types.ts";

export interface SearchHit {
	item: SettingsItem;
	score: number;
	/** Which field matched best (displayed in results). */
	matchedOn: string;
}

function sectionTitle(itemId: string): string {
	const section = itemId.split(".")[0];
	return SECTION_META.find((s) => s.id === section)?.title ?? section;
}

/** Subsequence score: 0 = no match; higher = better. Prefix/word-start boosts. */
function subsequenceScore(query: string, target: string): number {
	if (!query) return 0;
	if (!target) return 0;
	const q = query.toLowerCase();
	const t = target.toLowerCase();
	if (t === q) return 1000;
	if (t.startsWith(q)) return 800 - Math.max(0, t.length - q.length);
	const wordStart = ` ${q}`;
	if (t.includes(wordStart)) return 700 - Math.max(0, t.length - q.length);
	// subsequence walk
	let ti = 0;
	let hits = 0;
	let streak = 0;
	let best = 0;
	for (let qi = 0; qi < q.length; qi++) {
		const ch = q[qi];
		let found = -1;
		for (let i = ti; i < t.length; i++) {
			if (t[i] === ch) {
				found = i;
				break;
			}
		}
		if (found === -1) return 0;
		streak = found === ti ? streak + 1 : 1;
		best = Math.max(best, streak);
		hits++;
		ti = found + 1;
	}
	if (hits < q.length) return 0;
	// Contiguous runs score high; scattered subsequence still passes.
	return 200 + best * 40 + (q.length / Math.max(1, t.length)) * 100;
}

export function searchSettings(query: string, limit = 12): SearchHit[] {
	const trimmed = (query ?? "").trim();
	if (!trimmed) return [];
	const hits: SearchHit[] = [];
	for (const item of SETTINGS_REGISTRY) {
		const candidates: Array<[field: string, text: string, weight: number]> = [
			["name", item.name, 3],
			["summary", item.summary, 2],
			["tags", (item.tags ?? []).join(" "), 2],
			["env", item.env ?? "", 2],
			["section", sectionTitle(item.id), 1.5],
			["help", item.help, 1],
		];
		let best = 0;
		let matchedOn = "";
		for (const [field, text, weight] of candidates) {
			const score = subsequenceScore(trimmed, text) * weight;
			if (score > best) {
				best = score;
				matchedOn = field;
			}
		}
		if (best > 0) hits.push({ item, score: Math.round(best), matchedOn });
	}
	hits.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
	return hits.slice(0, limit);
}

/** Text form for the headless lane (/settings search q). */
export function formatSearchResults(hits: SearchHit[]): string {
	if (hits.length === 0) return "No settings matched.";
	return hits
		.map((h) => {
			const section = sectionTitle(h.item.id);
			return `${section} → ${h.item.name}  (${h.item.kind}${h.item.risk === "high" ? ", HIGH RISK" : ""})\n  ${h.item.summary}`;
		})
		.join("\n");
}

/** Section browse helper: sections matching a query (for "jump to section"). */
export function searchSections(query: string): string[] {
	const trimmed = (query ?? "").trim().toLowerCase();
	if (!trimmed) return [];
	return SECTION_META.filter((s) => s.title.toLowerCase().includes(trimmed) || s.purpose.toLowerCase().includes(trimmed)).map(
		(s) => s.id,
	);
}

export { itemsBySection };
