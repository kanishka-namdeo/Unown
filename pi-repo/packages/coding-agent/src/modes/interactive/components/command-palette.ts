import {
        type Component,
        Container,
        fuzzyFilter,
        getKeybindings,
        Input,
        type SelectItem,
        SelectList,
        type SelectListLayoutOptions,
        Spacer,
        Text,
} from "@earendil-works/pi-tui";
import { getSelectListTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { SelectorHints } from "./selector-hints.ts";

const PALETTE_LAYOUT: SelectListLayoutOptions = {
        minPrimaryColumnWidth: 14,
        maxPrimaryColumnWidth: 34,
};

/** One dispatchable row of the command palette. */
export interface PaletteEntry {
        /** Unique id (also the fuzzy-search text base). */
        id: string;
        /** Row label — the thing to type to find it. */
        label: string;
        /** Right-column description. */
        description?: string;
        /** Invoked on Enter. */
        run: () => void;
}

/**
 * CommandPalette (round 5, I2) — the fuzzy action surface on ctrl+k.
 *
 * One component serves two callers:
 *  - the command palette: slash commands + direct actions, Enter dispatches;
 *  - the `?` keybinding reference: live registry values, Enter closes.
 *
 * It mounts in the editor slot (the selectors' vocabulary: arrow keys,
 * Enter, Esc — zero new keybindings), types to filter with fuzzy matching,
 * and degrades its hint line by width like every other selector (R4).
 */
export class CommandPalette implements Component {
        private readonly container = new Container();
        private readonly searchInput: Input;
        private selectList: SelectList;
        private readonly listChildIndex: number;
        private readonly entries: PaletteEntry[];
        private readonly onSelectEntry: (entry: PaletteEntry) => void;
        private readonly onCancelCb: () => void;

        constructor(options: {
                title: string;
                subtitle?: string;
                entries: PaletteEntry[];
                initialQuery?: string;
                /** Called with the selected entry on Enter. */
                onSelect: (entry: PaletteEntry) => void;
                /** Called on Esc / ctrl+c. */
                onCancel: () => void;
        }) {
                this.entries = options.entries;
                this.onSelectEntry = options.onSelect;
                this.onCancelCb = options.onCancel;

                this.container.addChild(new DynamicBorder());
                this.container.addChild(new Spacer(1));
                this.container.addChild(new Text(theme.bold(theme.fg("accent", options.title)), 0, 0));
                if (options.subtitle) {
                        this.container.addChild(new Text(theme.fg("muted", options.subtitle), 0, 0));
                }
                this.container.addChild(new Spacer(1));

                this.searchInput = new Input();
                if (options.initialQuery) this.searchInput.setValue(options.initialQuery);
                this.searchInput.onSubmit = () => this.selectList.handleInput("\r");
                this.container.addChild(this.searchInput);
                this.container.addChild(new Spacer(1));

                this.selectList = this.buildList(this.filter(options.initialQuery ?? ""));
                this.listChildIndex = this.container.children.length - 1;
                this.container.addChild(this.selectList);
                this.container.addChild(new Spacer(1));
                this.container.addChild(new SelectorHints(["Type to filter", "Enter to run", "Esc to close"]));
                this.container.addChild(new DynamicBorder());
        }

        private filter(query: string): PaletteEntry[] {
                if (!query) return this.entries;
                return fuzzyFilter(this.entries, query, (entry) => `${entry.label} ${entry.description ?? ""}`);
        }

        private buildList(entries: PaletteEntry[]): SelectList {
                const items: SelectItem[] = entries.map((entry) => ({
                        value: entry.id,
                        label: entry.label,
                        description: entry.description,
                }));
                const list = new SelectList(items, Math.min(items.length, 12), getSelectListTheme(), PALETTE_LAYOUT);
                list.onSelect = (item) => {
                        const entry = entries.find((e) => e.id === item.value);
                        if (entry) this.onSelectEntry(entry);
                };
                list.onCancel = () => this.onCancelCb();
                return list;
        }

        handleInput(data: string): void {
                // The selectors' routing: navigation/confirm/cancel flow to the
                // list, everything else types into the filter box.
                const kb = getKeybindings();
                const isNav =
                        kb.matches(data, "tui.select.up") ||
                        kb.matches(data, "tui.select.down") ||
                        kb.matches(data, "tui.select.pageUp") ||
                        kb.matches(data, "tui.select.pageDown") ||
                        kb.matches(data, "tui.select.confirm") ||
                        kb.matches(data, "tui.select.cancel");
                if (isNav) {
                        this.selectList.handleInput(data);
                        return;
                }
                const previous = this.searchInput.getValue();
                this.searchInput.handleInput(data);
                if (this.searchInput.getValue() !== previous) {
                        const newList = this.buildList(this.filter(this.searchInput.getValue()));
                        this.container.children[this.listChildIndex] = newList;
                        this.selectList = newList;
                }
        }

        invalidate(): void {
                this.container.invalidate();
        }

        render(width: number): string[] {
                return this.container.render(width);
        }
}
