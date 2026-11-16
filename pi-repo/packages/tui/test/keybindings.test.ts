import assert from "node:assert";
import { describe, it } from "node:test";
import { KeybindingsManager, TUI_KEYBINDINGS, validateBindingKey } from "../src/keybindings.ts";

describe("KeybindingsManager", () => {
	it("binds Ctrl+J as a default newline alias", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);

		assert.deepStrictEqual(keybindings.getKeys("tui.input.newLine"), ["shift+enter", "ctrl+j"]);
		assert.strictEqual(keybindings.matches("\n", "tui.input.newLine"), true);
		assert.strictEqual(keybindings.matches("\x1b[106;5u", "tui.input.newLine"), true);
	});

	it("binds modified and unmodified editor viewport navigation", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);

		assert.deepStrictEqual(keybindings.getKeys("tui.editor.cursorLineStart"), ["home", "ctrl+home", "ctrl+a"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.cursorLineEnd"), ["end", "ctrl+end", "ctrl+e"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.pageUp"), ["pageUp", "ctrl+pageUp"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.pageDown"), ["pageDown", "ctrl+pageDown"]);
	});

	it("leaves dedicated prompt history navigation unbound by default", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);

		assert.deepStrictEqual(keybindings.getKeys("tui.editor.historyPrevious"), []);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.historyNext"), []);
	});

	it("binds unmodified terminal viewport shortcuts to alternate-screen navigation", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);

		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.pageUp"), ["pageUp"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.pageDown"), ["pageDown"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.halfPageUp"), []);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.halfPageDown"), []);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.lineUp"), []);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.lineDown"), []);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.previousPrompt"), ["ctrl+shift+up", "ctrl+up"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.nextPrompt"), ["ctrl+shift+down", "ctrl+down"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.search"), ["ctrl+shift+f"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.searchNext"), ["enter", "ctrl+g"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.searchPrevious"), ["shift+enter", "ctrl+shift+g"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.searchClose"), ["escape"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.top"), ["home"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.bottom"), ["end"]);
	});

	it("binds selector home/end navigation (tui.select.first / tui.select.last)", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);

		assert.deepStrictEqual(keybindings.getKeys("tui.select.first"), ["home"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.select.last"), ["end"]);
	});

	it("does not evict selector confirm when input submit is rebound", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
			"tui.input.submit": ["enter", "ctrl+enter"],
		});

		assert.deepStrictEqual(keybindings.getKeys("tui.input.submit"), ["enter", "ctrl+enter"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.select.confirm"), ["enter"]);
	});

	it("does not evict cursor bindings when another action reuses the same key", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
			"tui.select.up": ["up", "ctrl+p"],
		});

		assert.deepStrictEqual(keybindings.getKeys("tui.select.up"), ["up", "ctrl+p"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.cursorUp"), ["up"]);
	});

	it("still reports direct user binding conflicts without evicting defaults", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
			"tui.input.submit": "ctrl+x",
			"tui.select.confirm": "ctrl+x",
		});

		assert.deepStrictEqual(keybindings.getConflicts(), [
			{
				key: "ctrl+x",
				keybindings: ["tui.input.submit", "tui.select.confirm"],
			},
		]);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.cursorLeft"), ["left", "ctrl+b"]);
	});
});

describe("validateBindingKey (the Da capo R15 lane — misspelled modifiers never bind bare keys)", () => {
	it("accepts canonical ids unchanged", () => {
		for (const key of ["ctrl+k", "shift+enter", "alt+left", "super+k", "escape", "a", "ctrl+alt+]", "f5", "pageup"]) {
			const result = validateBindingKey(key);
			assert.strictEqual(result.valid, true, key);
			assert.strictEqual(result.normalized, key);
		}
	});

	it("normalizes alias modifiers (control/option/meta/cmd/win)", () => {
		assert.deepStrictEqual(validateBindingKey("control+k"), { valid: true, normalized: "ctrl+k" });
		assert.deepStrictEqual(validateBindingKey("option+enter"), { valid: true, normalized: "alt+enter" });
		assert.deepStrictEqual(validateBindingKey("cmd+c"), { valid: true, normalized: "super+c" });
		assert.deepStrictEqual(validateBindingKey("win+l"), { valid: true, normalized: "super+l" });
	});

	it("rejects misspelled modifiers (the ctl+k footgun)", () => {
		const result = validateBindingKey("ctl+k");
		assert.strictEqual(result.valid, false);
		assert.ok(result.error?.includes("ctl"), "names the bad token");
		assert.ok(result.error?.includes("modifier"));
	});

	it("rejects unknown key names", () => {
		const result = validateBindingKey("ctrl+quux");
		assert.strictEqual(result.valid, false);
		assert.ok(result.error?.includes("not a known key name"));
	});

	it("rejects empty and modifier-only strings", () => {
		assert.strictEqual(validateBindingKey("").valid, false);
		assert.strictEqual(validateBindingKey("   ").valid, false);
		assert.strictEqual(validateBindingKey("ctrl").valid, false);
		assert.strictEqual(validateBindingKey("ctrl+").valid, false);
	});

	it("rejects non-printable single characters", () => {
		assert.strictEqual(validateBindingKey("ctrl+\u200b").valid, false);
	});

	it("accepts symbol keys", () => {
		for (const key of ["ctrl+-", "ctrl+=", "alt+[", "shift+;", "ctrl+`"]) {
			assert.strictEqual(validateBindingKey(key).valid, true, key);
		}
	});

	it("is case-insensitive and trims", () => {
		assert.deepStrictEqual(validateBindingKey("  Ctrl+K "), { valid: true, normalized: "ctrl+k" });
	});
});
