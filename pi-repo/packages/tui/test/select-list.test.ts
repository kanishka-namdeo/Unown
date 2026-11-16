import assert from "node:assert";
import { describe, it } from "node:test";
import { SelectList } from "../src/components/select-list.ts";
import { visibleWidth } from "../src/utils.ts";

const testTheme = {
	selectedPrefix: (text: string) => text,
	selectedText: (text: string) => text,
	description: (text: string) => text,
	scrollInfo: (text: string) => text,
	noMatch: (text: string) => text,
};

const visibleIndexOf = (line: string, text: string): number => {
	const index = line.indexOf(text);
	assert.notEqual(index, -1);
	return visibleWidth(line.slice(0, index));
};

describe("SelectList", () => {
	it("home/end jump to the first and last item (tui.select.first / last)", () => {
		const items = Array.from({ length: 12 }, (_, index) => ({ value: `item-${index}`, label: `item-${index}` }));
		const list = new SelectList(items, 5, testTheme);
		let selected = "";
		list.onSelectionChange = (item) => {
			selected = item.value;
		};

		list.handleInput("\x1b[F"); // End — last item
		assert.equal(selected, "item-11");
		list.handleInput("\x1b[H"); // Home — first item
		assert.equal(selected, "item-0");
	});

	it("normalizes multiline descriptions to single line", () => {
		const items = [
			{
				value: "test",
				label: "test",
				description: "Line one\nLine two\nLine three",
			},
		];

		const list = new SelectList(items, 5, testTheme);
		const rendered = list.render(100);

		assert.ok(rendered.length > 0);
		assert.ok(!rendered[0].includes("\n"));
		assert.ok(rendered[0].includes("Line one Line two Line three"));
	});

	it("keeps descriptions aligned when the primary text is truncated", () => {
		const items = [
			{ value: "short", label: "short", description: "short description" },
			{
				value: "very-long-command-name-that-needs-truncation",
				label: "very-long-command-name-that-needs-truncation",
				description: "long description",
			},
		];

		const list = new SelectList(items, 5, testTheme);
		const rendered = list.render(80);

		assert.equal(visibleIndexOf(rendered[0], "short description"), visibleIndexOf(rendered[1], "long description"));
	});

	it("uses the configured minimum primary column width", () => {
		const items = [
			{ value: "a", label: "a", description: "first" },
			{ value: "bb", label: "bb", description: "second" },
		];

		const list = new SelectList(items, 5, testTheme, {
			minPrimaryColumnWidth: 12,
			maxPrimaryColumnWidth: 20,
		});
		const rendered = list.render(80);

		assert.equal(rendered[0].indexOf("first"), 14);
		assert.equal(rendered[1].indexOf("second"), 14);
	});

	it("uses the configured maximum primary column width", () => {
		const items = [
			{
				value: "very-long-command-name-that-needs-truncation",
				label: "very-long-command-name-that-needs-truncation",
				description: "first",
			},
			{ value: "short", label: "short", description: "second" },
		];

		const list = new SelectList(items, 5, testTheme, {
			minPrimaryColumnWidth: 12,
			maxPrimaryColumnWidth: 20,
		});
		const rendered = list.render(80);

		assert.equal(visibleIndexOf(rendered[0], "first"), 22);
		assert.equal(visibleIndexOf(rendered[1], "second"), 22);
	});

	it("allows overriding primary truncation while preserving description alignment", () => {
		const items = [
			{
				value: "very-long-command-name-that-needs-truncation",
				label: "very-long-command-name-that-needs-truncation",
				description: "first",
			},
			{ value: "short", label: "short", description: "second" },
		];

		const list = new SelectList(items, 5, testTheme, {
			minPrimaryColumnWidth: 12,
			maxPrimaryColumnWidth: 12,
			truncatePrimary: ({ text, maxWidth }) => {
				if (text.length <= maxWidth) {
					return text;
				}

				return `${text.slice(0, Math.max(0, maxWidth - 1))}…`;
			},
		});
		const rendered = list.render(80);

		assert.ok(rendered[0].includes("…"));
		assert.equal(visibleIndexOf(rendered[0], "first"), visibleIndexOf(rendered[1], "second"));
	});

	it("pages down by the viewport height and clamps at the bottom", () => {
		const items = Array.from({ length: 12 }, (_, i) => ({ value: `item-${i}`, label: `item-${i}` }));
		const list = new SelectList(items, 5, testTheme);

		list.handleInput("\x1b[6~");
		assert.equal(list.getSelectedItem()?.value, "item-5");

		list.handleInput("\x1b[6~");
		assert.equal(list.getSelectedItem()?.value, "item-10");

		// Clamped at the last item, not wrapped
		list.handleInput("\x1b[6~");
		assert.equal(list.getSelectedItem()?.value, "item-11");
	});

	it("pages up by the viewport height and clamps at the top", () => {
		const items = Array.from({ length: 12 }, (_, i) => ({ value: `item-${i}`, label: `item-${i}` }));
		const list = new SelectList(items, 5, testTheme);

		list.setSelectedIndex(11);
		list.handleInput("\x1b[5~");
		assert.equal(list.getSelectedItem()?.value, "item-6");

		list.handleInput("\x1b[5~");
		assert.equal(list.getSelectedItem()?.value, "item-1");

		// Clamped at the first item, not wrapped
		list.handleInput("\x1b[5~");
		assert.equal(list.getSelectedItem()?.value, "item-0");
	});

	it("notifies selection change on paging like on arrow navigation", () => {
		const items = Array.from({ length: 12 }, (_, i) => ({ value: `item-${i}`, label: `item-${i}` }));
		const list = new SelectList(items, 5, testTheme);
		const selected: string[] = [];
		list.onSelectionChange = (item) => selected.push(item.value);

		list.handleInput("\x1b[A"); // up wraps to the last item
		list.handleInput("\x1b[5~"); // page up from the bottom: item-6
		list.handleInput("\x1b[6~"); // page down back to the bottom

		assert.deepEqual(selected, ["item-11", "item-6", "item-11"]);
	});
});

describe("SelectList section headers (Semplice W10)", () => {
	const sectionTheme = {
		...testTheme,
		sectionLabel: (text: string) => `§ ${text}`,
	};
	const groupedItems = [
		{ value: "__group:Session", label: "Session", selectable: false },
		{ value: "new", label: "new" },
		{ value: "resume", label: "resume" },
		{ value: "__group:Display", label: "Display", selectable: false },
		{ value: "theme", label: "theme" },
	];

	it("initial selection lands on the first SELECTABLE row, never a header", () => {
		const list = new SelectList(groupedItems, 5, sectionTheme);
		let selected = "";
		list.onSelect = (item) => {
			selected = item.value;
		};
		list.handleInput("\r"); // Enter — the initially-selected row fires
		assert.equal(selected, "new");
	});

	it("down/up navigation skips header rows both directions", () => {
		const list = new SelectList(groupedItems, 5, sectionTheme);
		const landed: string[] = [];
		list.onSelectionChange = (item) => {
			landed.push(item.value);
		};
		list.handleInput("\x1b[B"); // down → resume
		list.handleInput("\x1b[B"); // down → skips Display header → theme
		list.handleInput("\x1b[B"); // down → wraps, skips headers → new
		list.handleInput("\x1b[A"); // up → wraps past the Session header → theme (last selectable)
		assert.deepEqual(landed, ["resume", "theme", "new", "theme"]);
	});

	it("home/end land on first/last selectable; Enter on a header never fires", () => {
		const list = new SelectList(groupedItems, 5, sectionTheme);
		let selected = "";
		list.onSelectionChange = (item) => {
			selected = item.value;
		};
		list.handleInput("\x1b[F"); // End → last selectable (theme), not the header above it
		assert.equal(selected, "theme");
		list.handleInput("\x1b[H"); // Home → first selectable (new)
		assert.equal(selected, "new");
	});

	it("render styles headers through sectionLabel and keeps them non-selected", () => {
		const list = new SelectList(groupedItems, 5, sectionTheme);
		const lines = list.render(60).join("\n");
		assert.ok(lines.includes("§ Session"));
		assert.ok(lines.includes("§ Display"));
	});

	it("selectItemByValue selects through interleaved headers", () => {
		const list = new SelectList(groupedItems, 5, sectionTheme);
		let selected = "";
		list.onSelect = (item) => {
			selected = item.value;
		};
		list.selectItemByValue("theme");
		list.handleInput("\r");
		assert.equal(selected, "theme");
	});
});
