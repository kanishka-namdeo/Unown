/**
 * HistorySearch — the input-history search dialog (Claude Code's Ctrl+R lane).
 *
 * The Claude Code contract (fetched 2026-11-15, code.claude.com/docs/en/
 * interactive-mode): reverse history search opens with Ctrl+R, typing filters
 * previous prompts, Ctrl+R again cycles to older matches, Enter accepts and
 * executes, Tab accepts and continues editing, Esc cancels, and Ctrl+S cycles
 * the scope through this session / this project / all projects. Unown's form
 * is the dialog variant (Claude Code's fullscreen renderer uses the same
 * shape): a query input, a fuzzy-filtered match list, and a scope chip row.
 *
 * The dialog is generic — scopes and their entries arrive from the caller;
 * the app layer provides the session scope from the live editor and any
 * persisted scopes from an injected history store.
 */

import {
        type Component,
        type Focusable,
        Container,
        getKeybindings,
        Input,
        matchesKey,
        Spacer,
        Text,
        truncateToWidth,
} from "@earendil-works/pi-tui";
import type { EditorHistoryEntry } from "../../../core/extensions/index.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { SelectorHints } from "./selector-hints.ts";

export interface HistorySearchScope {
        id: string;
        label: string;
        /** Entries, newest first. */
        load: () => string[];
        /**
         * Dual-form entries, newest first (Da capo R6 — Claude Code v2.1.314:
         * "Ctrl+R now matches text inside collapsed [Pasted text] pills").
         * When present the dialog matches against each entry's expansion
         * while displaying the marker form; absent, `load()` strings match
         * and display as themselves.
         */
        loadEntries?: () => EditorHistoryEntry[];
}

export interface HistorySearchOptions {
        scopes: HistorySearchScope[];
        initialScopeId?: string;
        terminalHeight: number;
        /** Accept a match. `submit` follows Claude Code: Enter executes, Tab edits. */
        onAccept: (text: string, mode: "submit" | "edit") => void;
        onCancel: () => void;
}

interface HistoryEntry {
        /** The display form (paste markers intact). */
        text: string;
        /** The form search matches (the expansion when one exists). */
        searchText: string;
        /** The form accept inserts (the expansion when one exists — marker ids die on setText). */
        acceptText: string;
        firstLine: string;
        continuationCount: number;
        charCount: number;
        /** True when the entry carries a paste expansion (the ⧉ meta chip). */
        hasExpansion: boolean;
}

const MAX_VISIBLE_MATCHES = 8;

function buildEntries(entries: (string | EditorHistoryEntry)[]): HistoryEntry[] {
        const seen = new Set<string>();
        const result: HistoryEntry[] = [];
        for (const raw of entries) {
                const text = typeof raw === "string" ? raw.trim() : (raw.text ?? "").trim();
                if (!text || seen.has(text)) continue;
                seen.add(text);
                const expanded = typeof raw === "string" ? undefined : raw.expanded?.trim();
                const searchText = expanded || text;
                const lines = text.split("\n");
                result.push({
                        text,
                        searchText,
                        acceptText: expanded || text,
                        firstLine: lines[0] ?? "",
                        continuationCount: Math.max(0, searchText.split("\n").length - 1),
                        charCount: searchText.length,
                        hasExpansion: Boolean(expanded && expanded !== text),
                });
        }
        return result;
}

export class HistorySearchComponent extends Container implements Component, Focusable {
        private readonly options: HistorySearchOptions;
        private readonly input: Input;
        private scopeIndex: number;
        private scopeEntries: HistoryEntry[];
        private filtered: HistoryEntry[] = [];
        private selectedIndex = 0;
        private windowStart = 0;
        private ctrlRPressed = false;

        // Focusable — propagate to the query input for IME cursor positioning.
        private _focused = false;
        get focused(): boolean {
                return this._focused;
        }
        set focused(value: boolean) {
                this._focused = value;
                this.input.focused = value;
        }

        constructor(options: HistorySearchOptions) {
                super();

                this.options = options;
                this.scopeIndex = Math.max(
                        0,
                        options.scopes.findIndex((scope) => scope.id === options.initialScopeId),
                );
                this.scopeEntries = buildEntries(this.loadCurrentScopeEntries());
                this.input = new Input();
                this.input.onEscape = () => this.options.onCancel();
                this.refilter();
        }

        /** Dual-form entries when the scope provides them (R6), else its strings. */
        private loadCurrentScopeEntries(): (string | EditorHistoryEntry)[] {
                const scope = this.currentScope();
                if (scope.loadEntries) {
                        try {
                                return scope.loadEntries();
                        } catch {
                                // A scope read must never break the dialog.
                        }
                }
                return scope.load();
        }

        /** True once Ctrl+R has been pressed inside the dialog — used for the next-match hint. */
        get cycledWithCtrlR(): boolean {
                return this.ctrlRPressed;
        }

        private currentScope(): HistorySearchScope {
                return this.options.scopes[this.scopeIndex] ?? this.options.scopes[0];
        }

        private scopeKeys(): string {
                return this.options.scopes.map((scope, index) => (index === this.scopeIndex ? `● ${scope.label}` : `○ ${scope.label}`)).join("  ");
        }

        private refilter(): void {
                const query = this.input.getValue().trim();
                if (!query) {
                        this.filtered = this.scopeEntries;
                } else {
                        this.filtered = this.scopeEntries.filter((entry) => {
                                // Match against the search form — inside paste
                                // content when the entry carries an expansion (R6).
                                const lower = entry.searchText.toLowerCase();
                                const queryLower = query.toLowerCase();
                                if (lower.includes(queryLower)) return true;
                                // Subsequence fuzzy match as fallback (matches characters in order).
                                let qi = 0;
                                for (let i = 0; i < lower.length && qi < queryLower.length; i++) {
                                        if (lower[i] === queryLower[qi]) qi++;
                                }
                                return qi === queryLower.length;
                        });
                }
                this.selectedIndex = 0;
                this.windowStart = 0;
        }

        private cycleScope(): void {
                if (this.options.scopes.length === 0) return;
                this.scopeIndex = (this.scopeIndex + 1) % this.options.scopes.length;
                this.scopeEntries = buildEntries(this.loadCurrentScopeEntries());
                this.refilter();
        }

        private moveSelection(delta: number): void {
                if (this.filtered.length === 0) return;
                this.selectedIndex = Math.min(this.filtered.length - 1, Math.max(0, this.selectedIndex + delta));
                // Keep the selection inside the visible window.
                if (this.selectedIndex < this.windowStart) {
                        this.windowStart = this.selectedIndex;
                } else if (this.selectedIndex >= this.windowStart + MAX_VISIBLE_MATCHES) {
                        this.windowStart = this.selectedIndex - MAX_VISIBLE_MATCHES + 1;
                }
        }

        private accept(mode: "submit" | "edit"): void {
                const entry = this.filtered[this.selectedIndex];
                if (!entry) return;
                // The expansion when one exists: setText clears the editor's
                // paste store, so marker forms must not travel through accept.
                this.options.onAccept(entry.acceptText, mode);
        }

        handleInput(keyData: string): void {
                const kb = getKeybindings();

                if (kb.matches(keyData, "tui.select.confirm")) {
                        this.accept("submit");
                        return;
                }
                if (matchesKey(keyData, "tab")) {
                        this.accept("edit");
                        return;
                }
                if (kb.matches(keyData, "tui.select.cancel")) {
                        this.options.onCancel();
                        return;
                }
                if (kb.matches(keyData, "tui.select.up")) {
                        this.moveSelection(-1);
                        return;
                }
                if (kb.matches(keyData, "tui.select.down")) {
                        this.moveSelection(1);
                        return;
                }
                // Ctrl+R inside the dialog cycles to the next (older) match — the
                // classic reverse-search rhythm, per the app-level binding.
                if (kb.matches(keyData, "app.history.search")) {
                        this.ctrlRPressed = true;
                        this.moveSelection(1);
                        return;
                }
                // Ctrl+S cycles the scope (session → project → all …).
                if (kb.matches(keyData, "app.editor.stash")) {
                        this.cycleScope();
                        return;
                }
                this.input.handleInput(keyData);
                this.refilter();
        }

        render(width: number): string[] {
                const lines: string[] = [];
                const indent = "  ";

                lines.push(truncateToWidth(`${indent}${theme.bold("Search input history")}`, width));
                lines.push(truncateToWidth(`${indent}${theme.fg("muted", this.scopeKeys())}`, width));
                lines.push(
                        truncateToWidth(
                                `${indent}${theme.fg("muted", "query:")} ${theme.fg("accent", this.input.getValue() || "")}${theme.fg("dim", "▏")}`,
                                width,
                        ),
                );

                if (this.filtered.length === 0) {
                        lines.push(truncateToWidth(`${indent}${theme.fg("dim", "no matches")}`, width));
                } else {
                        const visible = this.filtered.slice(this.windowStart, this.windowStart + MAX_VISIBLE_MATCHES);
                        for (let i = 0; i < visible.length; i++) {
                                const entry = visible[i];
                                const isSelected = this.windowStart + i === this.selectedIndex;
                                const meta: string[] = [];
                                if (entry.continuationCount > 0) meta.push(`+${entry.continuationCount} ln`);
                                meta.push(`${entry.charCount} ch`);
                                if (entry.hasExpansion) meta.push("⧉ in paste");
                                const metaText = theme.fg("dim", `  (${meta.join(", ")})`);
                                const row = `  ${isSelected ? theme.fg("accent", "❯") : " "} ${entry.firstLine}${metaText}`;
                                lines.push(truncateToWidth(isSelected ? theme.fg("accent", row) : theme.fg("muted", row), width));
                        }
                        const hidden = this.filtered.length - (this.windowStart + MAX_VISIBLE_MATCHES);
                        if (hidden > 0) {
                                lines.push(truncateToWidth(`${indent}${theme.fg("dim", `⋯ ${hidden} more matches`)}`, width));
                        }
                }

                return lines;
        }
}

/**
 * Compose the full search overlay: border, title, search component, hints.
 * Returns the component plus its keybinding hint segments for tests.
 */
export function historySearchHintSegments(): string[] {
        return [
                "Enter run · Tab edit",
                "↑↓ move",
                "Ctrl+R next match",
                "Ctrl+S scope",
                "Esc cancel",
        ];
}

export function createHistorySearchOverlay(options: HistorySearchOptions): {
        component: Component;
        focus: Component;
        dispose?: () => void;
} {
        const container = new Container();
        const search = new HistorySearchComponent(options);
        container.addChild(new Spacer(1));
        container.addChild(new DynamicBorder());
        container.addChild(new Text(theme.bold("  Input history"), 1, 0));
        container.addChild(search);
        container.addChild(new SelectorHints(historySearchHintSegments()));
        container.addChild(new Spacer(1));
        container.addChild(new DynamicBorder());
        return { component: container, focus: search };
}

/** Exposed for tests. */
export { buildEntries as buildHistoryEntriesForTest };
