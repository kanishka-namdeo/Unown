import type { Model } from "@earendil-works/pi-ai";
import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ScopedModelsSelectorComponent } from "../src/modes/interactive/components/scoped-models-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const makeModel = (provider: string, id: string): Model<any> =>
	({ provider, id, name: `${provider}/${id}` }) as unknown as Model<any>;

const models = [makeModel("p1", "one"), makeModel("p1", "two"), makeModel("p2", "three")];

const createSelector = (
	enabledModelIds: string[] | null,
	onChange: ReturnType<typeof vi.fn> = vi.fn(),
): ScopedModelsSelectorComponent =>
	new ScopedModelsSelectorComponent(
		{ allModels: models, enabledModelIds },
		{ onChange, onPersist: () => {}, onCancel: () => {} },
	);

describe("ScopedModelsSelectorComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	it("asks for confirmation before clearing all model assignments", () => {
		const onChange = vi.fn();
		const selector = createSelector(["p1/one", "p1/two"], onChange);

		selector.handleInput("\x18"); // ctrl+x

		expect(stripAnsi(selector.render(120).join("\n"))).toContain("Clear ALL 2 model assignments? y/N");
		expect(onChange).not.toHaveBeenCalled();
	});

	it("applies clear-all only after y", () => {
		const onChange = vi.fn();
		const selector = createSelector(["p1/one", "p1/two"], onChange);

		selector.handleInput("\x18"); // ctrl+x
		selector.handleInput("y");

		expect(onChange).toHaveBeenCalledWith([]);
	});

	it("counts every model as assigned when clearing from the all-enabled state", () => {
		const selector = createSelector(null);

		selector.handleInput("\x18"); // ctrl+x

		expect(stripAnsi(selector.render(120).join("\n"))).toContain("Clear ALL 3 model assignments? y/N");
	});

	it("asks for confirmation before enabling all models", () => {
		const onChange = vi.fn();
		const selector = createSelector(["p1/one"], onChange);

		selector.handleInput("\x01"); // ctrl+a

		expect(stripAnsi(selector.render(120).join("\n"))).toContain("Enable ALL 3 models? y/N");
		expect(onChange).not.toHaveBeenCalled();

		selector.handleInput("y");

		expect(onChange).toHaveBeenCalledWith(null);
	});

	it("treats enable-all from the all-enabled state as a silent no-op", () => {
		const onChange = vi.fn();
		const selector = createSelector(null, onChange);

		selector.handleInput("\x01"); // ctrl+a

		expect(stripAnsi(selector.render(120).join("\n"))).not.toContain("y/N");
		expect(onChange).not.toHaveBeenCalled();
	});

	it("cancels the confirmation on any non-y keypress", () => {
		for (const key of ["n", "\x1b", "\x18", "\r", "q"]) {
			const onChange = vi.fn();
			const selector = createSelector(["p1/one"], onChange);

			selector.handleInput("\x18"); // ctrl+x
			selector.handleInput(key);

			expect(stripAnsi(selector.render(120).join("\n"))).not.toContain("y/N");
			expect(onChange).not.toHaveBeenCalled();
		}
	});

	it("keeps the confirmation visible across an external model refresh", () => {
		const selector = createSelector(["p1/one", "p1/two"]);

		selector.handleInput("\x18"); // ctrl+x
		selector.updateModels(models);

		expect(stripAnsi(selector.render(120).join("\n"))).toContain("Clear ALL 2 model assignments? y/N");
	});

	it("pages the selection by the viewport height, clamping at the edges", () => {
		const manyModels = Array.from({ length: 12 }, (_, i) => makeModel("p", `m${i}`));
		const selector = new ScopedModelsSelectorComponent(
			{ allModels: manyModels, enabledModelIds: null },
			{ onChange: () => {}, onPersist: () => {}, onCancel: () => {} },
		);

		selector.handleInput("\x1b[6~"); // page down
		expect(stripAnsi(selector.render(120).join("\n"))).toContain("(9/12)");

		selector.handleInput("\x1b[6~"); // page down
		expect(stripAnsi(selector.render(120).join("\n"))).toContain("(12/12)");

		// Clamped at the bottom, not wrapped
		selector.handleInput("\x1b[6~");
		expect(stripAnsi(selector.render(120).join("\n"))).toContain("(12/12)");

		selector.handleInput("\x1b[5~"); // page up
		expect(stripAnsi(selector.render(120).join("\n"))).toContain("(4/12)");
	});
});
