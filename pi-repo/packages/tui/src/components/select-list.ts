import { getKeybindings } from "../keybindings.ts";
import type { Component } from "../tui.ts";
import { sliceByColumn, truncateToWidth, visibleWidth } from "../utils.ts";

const DEFAULT_PRIMARY_COLUMN_WIDTH = 32;
const PRIMARY_COLUMN_GAP = 2;
const MIN_DESCRIPTION_WIDTH = 10;

const normalizeToSingleLine = (text: string): string => text.replace(/[\r\n]+/g, " ").trim();
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

export interface SelectItem {
	value: string;
	label: string;
	description?: string;
}

export interface SelectListTheme {
	selectedPrefix: (text: string) => string;
	selectedText: (text: string) => string;
	description: (text: string) => string;
	scrollInfo: (text: string) => string;
	noMatch: (text: string) => string;
	// === Beauty move 8: overlay choreography surface hooks (optional) ===
	/** Row background applied to every non-selected body row (the overlayBg surface). */
	background?: (line: string) => string;
	/** Full-width row background applied instead of background to the selected row. */
	selectedRowStyle?: (line: string) => string;
	/**
	 * Number-keys hint line, dimmed one step below the list body. SelectList
	 * itself renders no hint line today; this hook exists for the richer
	 * selectors that render one on the same surface.
	 */
	hintStyle?: (text: string) => string;
}

export interface SelectListTruncatePrimaryContext {
	text: string;
	maxWidth: number;
	columnWidth: number;
	item: SelectItem;
	isSelected: boolean;
}

export interface SelectListLayoutOptions {
	minPrimaryColumnWidth?: number;
	maxPrimaryColumnWidth?: number;
	truncatePrimary?: (context: SelectListTruncatePrimaryContext) => string;
}

export class SelectList implements Component {
	private items: SelectItem[] = [];
	private filteredItems: SelectItem[] = [];
	private selectedIndex: number = 0;
	private maxVisible: number = 5;
	private theme: SelectListTheme;
	private layout: SelectListLayoutOptions;

	public onSelect?: (item: SelectItem) => void;
	public onCancel?: () => void;
	public onSelectionChange?: (item: SelectItem) => void;

	constructor(items: SelectItem[], maxVisible: number, theme: SelectListTheme, layout: SelectListLayoutOptions = {}) {
		this.items = items;
		this.filteredItems = items;
		this.maxVisible = maxVisible;
		this.theme = theme;
		this.layout = layout;
	}

	setFilter(filter: string): void {
		this.filteredItems = this.items.filter((item) => item.value.toLowerCase().startsWith(filter.toLowerCase()));
		// Reset selection when filter changes
		this.selectedIndex = 0;
	}

	setSelectedIndex(index: number): void {
		this.selectedIndex = Math.max(0, Math.min(index, this.filteredItems.length - 1));
	}

	invalidate(): void {
		// No cached state to invalidate currently
	}

	render(width: number): string[] {
		const lines: string[] = [];

		// If no items match filter, show message
		if (this.filteredItems.length === 0) {
			lines.push(this.theme.noMatch("  No matching commands"));
			return lines;
		}

		const primaryColumnWidth = this.getPrimaryColumnWidth();

		// Calculate visible range with scrolling
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredItems.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredItems.length);

		// Render visible items
		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredItems[i];
			if (!item) continue;

			const isSelected = i === this.selectedIndex;
			const descriptionSingleLine = item.description ? normalizeToSingleLine(item.description) : undefined;
			lines.push(this.renderItem(item, isSelected, width, descriptionSingleLine, primaryColumnWidth));
		}

		// Add scroll indicators if needed
		if (startIndex > 0 || endIndex < this.filteredItems.length) {
			const scrollText = `  (${this.selectedIndex + 1}/${this.filteredItems.length})`;
			// Truncate if too long for terminal
			lines.push(this.theme.scrollInfo(truncateToWidth(scrollText, width - 2, "")));
		}

		return lines;
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		// Up arrow - wrap to bottom when at top
		if (kb.matches(keyData, "tui.select.up")) {
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredItems.length - 1 : this.selectedIndex - 1;
			this.notifySelectionChange();
		}
		// Down arrow - wrap to top when at bottom
		else if (kb.matches(keyData, "tui.select.down")) {
			this.selectedIndex = this.selectedIndex === this.filteredItems.length - 1 ? 0 : this.selectedIndex + 1;
			this.notifySelectionChange();
		}
		// Page up - jump by one viewport, clamping at the top
		else if (kb.matches(keyData, "tui.select.pageUp")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - this.maxVisible);
			this.notifySelectionChange();
		}
		// Page down - jump by one viewport, clamping at the bottom
		else if (kb.matches(keyData, "tui.select.pageDown")) {
			this.selectedIndex = Math.min(this.filteredItems.length - 1, this.selectedIndex + this.maxVisible);
			this.notifySelectionChange();
		}
		// Home - jump to the first item
		else if (kb.matches(keyData, "tui.select.first")) {
			this.selectedIndex = 0;
			this.notifySelectionChange();
		}
		// End - jump to the last item
		else if (kb.matches(keyData, "tui.select.last")) {
			this.selectedIndex = this.filteredItems.length - 1;
			this.notifySelectionChange();
		}
		// Enter
		else if (kb.matches(keyData, "tui.select.confirm")) {
			const selectedItem = this.filteredItems[this.selectedIndex];
			if (selectedItem && this.onSelect) {
				this.onSelect(selectedItem);
			}
		}
		// Escape or Ctrl+C
		else if (kb.matches(keyData, "tui.select.cancel")) {
			if (this.onCancel) {
				this.onCancel();
			}
		}
	}

	private renderItem(
		item: SelectItem,
		isSelected: boolean,
		width: number,
		descriptionSingleLine: string | undefined,
		primaryColumnWidth: number,
	): string {
		// Beauty move 8: when the theme provides a selectedRowStyle, the selected
		// row becomes a full-width surface bar and the marker swaps to a 1-cell
		// accent rail ("▌") plus a space — the same 2-cell lead as the legacy
		// "→ " marker, so primary columns stay aligned across body rows.
		const raisedSelectedRow = isSelected && this.theme.selectedRowStyle !== undefined;
		let prefix: string;
		if (raisedSelectedRow) {
			prefix = `${this.theme.selectedPrefix("▌")} `;
		} else {
			prefix = isSelected ? "→ " : "  ";
		}
		const prefixWidth = visibleWidth(prefix);

		if (descriptionSingleLine && width > 40) {
			const effectivePrimaryColumnWidth = Math.max(1, Math.min(primaryColumnWidth, width - prefixWidth - 4));
			const maxPrimaryWidth = Math.max(1, effectivePrimaryColumnWidth - PRIMARY_COLUMN_GAP);
			const truncatedValue = this.truncatePrimary(item, isSelected, maxPrimaryWidth, effectivePrimaryColumnWidth);
			const truncatedValueWidth = visibleWidth(truncatedValue);
			const spacing = " ".repeat(Math.max(1, effectivePrimaryColumnWidth - truncatedValueWidth));
			const descriptionStart = prefixWidth + truncatedValueWidth + spacing.length;
			const remainingWidth = width - descriptionStart - 2; // -2 for safety

			if (remainingWidth > MIN_DESCRIPTION_WIDTH) {
				const truncatedDesc = truncateToWidth(descriptionSingleLine, remainingWidth, "");
				if (isSelected) {
					return this.finishSelectedRow(prefix, `${truncatedValue}${spacing}${truncatedDesc}`, width);
				}

				const descText = this.theme.description(spacing + truncatedDesc);
				return this.finishRow(prefix + truncatedValue + descText, width);
			}
		}

		const maxWidth = width - prefixWidth - 2;
		const truncatedValue = this.truncatePrimary(item, isSelected, maxWidth, maxWidth);
		if (isSelected) {
			return this.finishSelectedRow(prefix, truncatedValue, width);
		}

		return this.finishRow(prefix + truncatedValue, width);
	}

	/**
	 * Compose the selected row (beauty move 8). Without selectedRowStyle the
	 * historical bytes are kept: selectedText wrapping marker plus content.
	 * With selectedRowStyle the marker is the accent rail, content keeps
	 * selectedText, and the whole row is padded to the component width and
	 * wrapped in the surface style so the bar spans edge-to-edge.
	 */
	private finishSelectedRow(prefix: string, content: string, width: number): string {
		const rowStyle = this.theme.selectedRowStyle;
		if (rowStyle === undefined) {
			return this.theme.selectedText(`${prefix}${content}`);
		}
		return this.applyRowSurface(`${prefix}${this.theme.selectedText(content)}`, width, rowStyle);
	}

	/**
	 * Compose a non-selected body row (beauty move 8). A theme-provided
	 * background surface wraps the row padded to the component width
	 * (pad-then-style, so the surface spans edge-to-edge); without the hook
	 * the historical unpadded bytes are kept and legacy themes render
	 * exactly as before.
	 */
	private finishRow(content: string, width: number): string {
		const background = this.theme.background;
		if (background === undefined) {
			return content;
		}
		return this.applyRowSurface(content, width, background);
	}

	/** Pad a row to exactly `width` visible cells (slicing overflow), then style. */
	private applyRowSurface(content: string, width: number, style: (line: string) => string): string {
		const lineWidth = visibleWidth(content);
		const padded =
			lineWidth > width ? sliceByColumn(content, 0, width, true) : content + " ".repeat(width - lineWidth);
		return style(padded);
	}

	private getPrimaryColumnWidth(): number {
		const { min, max } = this.getPrimaryColumnBounds();
		const widestPrimary = this.filteredItems.reduce((widest, item) => {
			return Math.max(widest, visibleWidth(this.getDisplayValue(item)) + PRIMARY_COLUMN_GAP);
		}, 0);

		return clamp(widestPrimary, min, max);
	}

	private getPrimaryColumnBounds(): { min: number; max: number } {
		const rawMin =
			this.layout.minPrimaryColumnWidth ?? this.layout.maxPrimaryColumnWidth ?? DEFAULT_PRIMARY_COLUMN_WIDTH;
		const rawMax =
			this.layout.maxPrimaryColumnWidth ?? this.layout.minPrimaryColumnWidth ?? DEFAULT_PRIMARY_COLUMN_WIDTH;

		return {
			min: Math.max(1, Math.min(rawMin, rawMax)),
			max: Math.max(1, Math.max(rawMin, rawMax)),
		};
	}

	private truncatePrimary(item: SelectItem, isSelected: boolean, maxWidth: number, columnWidth: number): string {
		const displayValue = this.getDisplayValue(item);
		const truncatedValue = this.layout.truncatePrimary
			? this.layout.truncatePrimary({
					text: displayValue,
					maxWidth,
					columnWidth,
					item,
					isSelected,
				})
			: truncateToWidth(displayValue, maxWidth, "");

		return truncateToWidth(truncatedValue, maxWidth, "");
	}

	private getDisplayValue(item: SelectItem): string {
		return item.label || item.value;
	}

	private notifySelectionChange(): void {
		const selectedItem = this.filteredItems[this.selectedIndex];
		if (selectedItem && this.onSelectionChange) {
			this.onSelectionChange(selectedItem);
		}
	}

	getSelectedItem(): SelectItem | null {
		const item = this.filteredItems[this.selectedIndex];
		return item || null;
	}
}
