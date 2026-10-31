/**
 * Generic selector component for extensions.
 * Displays a list of string options with keyboard navigation.
 */

import { Container, decodePrintableKey, getKeybindings, Spacer, Text, type TUI } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";
import { CountdownTimer } from "./countdown-timer.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { SelectorHints } from "./selector-hints.ts";

export interface ExtensionSelectorOptions {
        tui?: TUI;
        timeout?: number;
        onToggleToolsExpanded?: () => void;
}

export class ExtensionSelectorComponent extends Container {
        private options: string[];
        private selectedIndex = 0;
        private listContainer: Container;
        private onSelectCallback: (option: string) => void;
        private onCancelCallback: () => void;
        private titleText: Text;
        private baseTitle: string;
        private countdown: CountdownTimer | undefined;
        private onToggleToolsExpanded: (() => void) | undefined;
        /** Numbered quick-select (the Claude Code approval lane): options are
         * numbered and 1-9 select directly when the list is short enough for
         * every number to be reachable. Display-only — the callback still
         * receives the raw option string. */
        private readonly numberedQuickSelect: boolean;

        constructor(
                title: string,
                options: string[],
                onSelect: (option: string) => void,
                onCancel: () => void,
                opts?: ExtensionSelectorOptions,
        ) {
                super();

                this.options = options;
                this.onSelectCallback = onSelect;
                this.onCancelCallback = onCancel;
                this.onToggleToolsExpanded = opts?.onToggleToolsExpanded;
                this.baseTitle = title;
                this.numberedQuickSelect = options.length > 0 && options.length <= 9;

                this.addChild(new DynamicBorder());
                this.addChild(new Spacer(1));

                this.titleText = new Text(theme.fg("accent", theme.bold(title)), 1, 0);
                this.addChild(this.titleText);
                this.addChild(new Spacer(1));

                if (opts?.timeout && opts.timeout > 0 && opts.tui) {
                        this.countdown = new CountdownTimer(
                                opts.timeout,
                                opts.tui,
                                (s) => this.titleText.setText(theme.fg("accent", theme.bold(`${this.baseTitle} (${s}s)`))),
                                () => this.onCancelCallback(),
                        );
                }

                this.listContainer = new Container();
                this.addChild(this.listContainer);
                this.addChild(new Spacer(1));
                // U1 (hint unification): the shared priority-degrading hint strip — the
                // same component the model/thinking selectors and the palette use, so
                // hint lines degrade by dropping whole segments at narrow widths instead
                // of each dialog improvising its own join style.
                const hints = ["↑↓ navigate", "Enter to select", "Esc to cancel"];
                if (this.numberedQuickSelect) {
                        hints.push(`1-${options.length} quick select`);
                }
                this.addChild(new SelectorHints(hints));
                this.addChild(new Spacer(1));
                this.addChild(new DynamicBorder());

                this.updateList();
        }

        private updateList(): void {
                this.listContainer.clear();
                for (let i = 0; i < this.options.length; i++) {
                        const isSelected = i === this.selectedIndex;
                        const label = this.numberedQuickSelect ? `${i + 1}. ${this.options[i]}` : this.options[i];
                        const text = isSelected
                                ? theme.fg("accent", "→ ") + theme.fg("accent", label)
                                : `  ${theme.fg("text", label)}`;
                        this.listContainer.addChild(new Text(text, 1, 0));
                }
        }

        /** A 1-9 digit in any encoding the input stack produces: plain ASCII,
         * Kitty CSI-u or xterm modifyOtherKeys (decodePrintableKey covers the
         * last two; plain bytes are checked directly). */
        private quickSelectDigit(keyData: string): string | undefined {
                if (/^[1-9]$/.test(keyData)) return keyData;
                const printable = decodePrintableKey(keyData);
                return printable && /^[1-9]$/.test(printable) ? printable : undefined;
        }

        handleInput(keyData: string): void {
                const kb = getKeybindings();
                if (kb.matches(keyData, "app.tools.expand")) {
                        this.onToggleToolsExpanded?.();
                } else if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
                        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
                        this.updateList();
                } else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
                        this.selectedIndex = Math.min(this.options.length - 1, this.selectedIndex + 1);
                        this.updateList();
                } else if (kb.matches(keyData, "tui.select.pageUp")) {
                        // The list renders in full (no viewport cap), so a page is
                        // the whole list — first row, SelectList's clamp semantics.
                        this.selectedIndex = 0;
                        this.updateList();
                } else if (kb.matches(keyData, "tui.select.pageDown")) {
                        this.selectedIndex = this.options.length - 1;
                        this.updateList();
                } else if (kb.matches(keyData, "tui.select.first")) {
                        this.selectedIndex = 0;
                        this.updateList();
                } else if (kb.matches(keyData, "tui.select.last")) {
                        this.selectedIndex = this.options.length - 1;
                        this.updateList();
                } else if (this.numberedQuickSelect) {
                        const digit = this.quickSelectDigit(keyData);
                        if (digit !== undefined) {
                                const selected = this.options[Number(digit) - 1];
                                if (selected) this.onSelectCallback(selected);
                                return;
                        }
                        this.confirmOrCancel(keyData, kb);
                } else {
                        this.confirmOrCancel(keyData, kb);
                }
        }

        private confirmOrCancel(keyData: string, kb: ReturnType<typeof getKeybindings>): void {
                if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
                        const selected = this.options[this.selectedIndex];
                        if (selected) this.onSelectCallback(selected);
                } else if (kb.matches(keyData, "tui.select.cancel")) {
                        this.onCancelCallback();
                }
        }

        dispose(): void {
                this.countdown?.dispose();
        }
}
