/**
 * render.ts — repo-map rendering + token-budget fitting (pure).
 *
 * Format (aider's tree shape, simplified where TreeContext's full gutter
 * machinery buys nothing for an agent consumer):
 *
 *     src/foo.ts:
 *     │export function greet(name: string): string {
 *     │⋮...
 *     │  bar(name);
 *     src/util.ts:
 *     │function bar(…
 *     README.md
 *
 * — `file:` header, the def's actual source line (trimmed to 100 chars,
 * the minified-js guard), `⋮...` elision between non-adjacent lines, bare
 * filenames for files with no tags (aider's floor). Important files
 * (README/LICENSE/manifests) are prepended bare, like aider's
 * filter_important_files.
 *
 * Budget fitting is aider's binary search over TAG COUNT: seed budget//25
 * (~25 tokens per rendered tag prior), accept within 15% of the budget,
 * keep the best tree that fits. Token counting is the chars/4 estimate —
 * the cheap universal proxy (aider samples tokenizer lines for exactness;
 * a 4x multiplier on chars is the standard heuristic and needs no model).
 */

import type { RankedDef, RefGraph } from "./graph.ts";
import type { Tag } from "./tags.ts";

/** Aider's line truncation guard (minified JS in vendor/ dirs). */
export const MAX_LINE_CHARS = 100;

/** Files always worth a bare line even with no tags (aider's
 * filter_important_files set, extended with the modern manifest set). */
const IMPORTANT_FILE = /^(readme|license|contributing|security|notice|authors)(\.|$)|^package\.json$|^cargo\.toml$|^pyproject\.toml$|^go\.mod$|^deno\.json$|^bun\.lockb?$|^tsconfig\.json$|^\.github\/workflows\/.*\.ya?ml$/i;

/** Estimate tokens for the map (chars/4 — the standard cheap proxy). Pure. */
export function estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
}

/** One renderable entry: a def site with its file's tags for context
 * grouping. `bare` entries render as just the filename. */
export interface RenderEntry {
        file: string;
        bare: boolean;
        tags: Tag[];
}

/** Flatten ranked defs + leftover files into render entries:
 *   1. bare important files (top of the map — always visible),
 *   2. ranked def groups (highest rank first), skipping chat files' own
 *      defs (they're already in context — aider's rule),
 *   3. remaining no-tag files, bare (top-ranked first, then the rest).
 * Pure. */
export function buildRenderEntries(
        ranked: RankedDef[],
        graph: RefGraph,
        allFiles: string[],
        chatFiles: Set<string>,
): RenderEntry[] {
        const seenFiles = new Set<string>();
        const entries: RenderEntry[] = [];
        const tagsByFile = new Map<string, Tag[]>();

        for (const rd of ranked) {
                if (chatFiles.has(rd.file)) continue; // defs already in context stay out
                const key = `${rd.file}\0${rd.ident}`;
                const tags = graph.definitions.get(key);
                if (!tags || tags.length === 0) continue;
                const existing = tagsByFile.get(rd.file);
                if (existing) {
                        for (const t of tags) existing.push(t);
                } else {
                        tagsByFile.set(rd.file, [...tags]);
                }
        }
        for (const list of tagsByFile.values()) list.sort((a, b) => a.line - b.line);

        // 1. Important files, bare, in ranked order (aider prepends them).
        const important = allFiles.filter((f) => IMPORTANT_FILE.test(f));
        for (const f of important) {
                if (chatFiles.has(f)) continue;
                entries.push({ file: f, bare: true, tags: [] });
                seenFiles.add(f);
        }

        // 2. Ranked def groups.
        for (const [file, tags] of tagsByFile) {
                seenFiles.add(file);
                entries.push({ file, bare: false, tags });
        }

        // 3. Remaining no-tag files, bare.
        for (const f of allFiles) {
                if (seenFiles.has(f) || chatFiles.has(f)) continue;
                entries.push({ file: f, bare: true, tags: [] });
        }
        return entries;
}

/** Render ONE file entry (aider's per-file block). `readFile` returns the
 * file's lines (0-indexed array) or null (unreadable → the tag name +
 * line fallback). Pure. */
export function renderEntry(entry: RenderEntry, readLines: (file: string) => string[] | null): string[] {
        if (entry.bare || entry.tags.length === 0) return [entry.file];
        const lines = readLines(entry.file);
        const out: string[] = [`${entry.file}:`];
        let prevRow = -1;
        for (const tag of entry.tags) {
                if (prevRow !== -1 && tag.line - prevRow > 1) out.push("│⋮...");
                const src = lines?.[tag.line]?.trim();
                const body = src ? (src.length > MAX_LINE_CHARS ? `${src.slice(0, MAX_LINE_CHARS)}…` : src) : `${tag.name} (line ${tag.line + 1})`;
                out.push(`│${body}`);
                prevRow = tag.line;
        }
        return out;
}

/** Render the first `tagBudget` tags' worth of entries (the binary-search
 * probe). Pure. */
function renderUpTo(entries: RenderEntry[], tagBudget: number, readLines: (file: string) => string[] | null): string {
        const out: string[] = [];
        let used = 0;
        for (const entry of entries) {
                if (entry.bare || entry.tags.length === 0) {
                        out.push(entry.file);
                        continue;
                }
                const take = Math.min(entry.tags.length, Math.max(0, tagBudget - used));
                if (take <= 0) break;
                out.push(...renderEntry({ ...entry, tags: entry.tags.slice(0, take) }, readLines));
                used += take;
        }
        return out.join("\n");
}

export interface FittedMap {
        text: string;
        tokens: number;
        /** How many tags made it in (diagnostics). */
        tagsIncluded: number;
        /** Render probes executed (the binary search's cost — pinned by tests). */
        probes: number;
}

/** Aider's budget fit: binary search over tag count, seeded at budget//25
 * (~25 tokens per rendered tag prior), accept-and-stop when within 15% of
 * the budget (either side — pct_err is absolute), classic lower/upper
 * updates otherwise, best ≤-budget tree kept as the fallback. Deterministic.
 * Pure. */
export function fitToBudget(
        entries: RenderEntry[],
        budgetTokens: number,
        readLines: (file: string) => string[] | null,
): FittedMap {
        const totalTags = entries.reduce((n, e) => n + (e.bare ? 0 : e.tags.length), 0);
        if (totalTags === 0) {
                const text = entries.map((e) => e.file).join("\n");
                return { text, tokens: estimateTokens(text), tagsIncluded: 0, probes: 0 };
        }
        let lo = 1;
        let hi = totalTags;
        let middle = Math.min(Math.max(1, Math.floor(budgetTokens / 25)), totalTags);
        let best: FittedMap | null = null;
        let probes = 0;
        while (lo <= hi) {
                probes++;
                const text = renderUpTo(entries, middle, readLines);
                const tokens = estimateTokens(text);
                const tagsIn = Math.min(middle, totalTags);
                const pctErr = Math.abs(tokens - budgetTokens) / budgetTokens;
                if (pctErr < 0.15) {
                        // Within aider's 15% tolerance: accept and stop.
                        return { text, tokens, tagsIncluded: tagsIn, probes };
                }
                if (tokens < budgetTokens) {
                        if (!best || tagsIn > best.tagsIncluded) best = { text, tokens, tagsIncluded: tagsIn, probes };
                        lo = middle + 1;
                } else {
                        hi = middle - 1;
                }
                middle = Math.floor((lo + hi) / 2);
        }
        if (best) return best;
        // Even the smallest probe overflows: the bare file list is the floor.
        const text = entries.map((e) => e.file).join("\n");
        return { text, tokens: estimateTokens(text), tagsIncluded: 0, probes };
}
