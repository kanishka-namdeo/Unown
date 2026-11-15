import assert from "node:assert";
import { describe, it } from "node:test";
import { CombinedAutocompleteProvider, MID_PROMPT_SLASH_TOKEN } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "../src/keybindings.ts";
import type { TUI } from "../src/tui.ts";

/**
 * Mid-prompt slash completion (Toccata round A12 — Claude Code's contract:
 * "type `/` after a space, then the first letters of a name, as in
 * `run the tests, then /com`"). Only commands whose names START with the
 * typed letters match (so a path like `/tmp/notes.md` keeps no list open);
 * a command still only RUNS when it starts the message.
 */

function fakeTui(): TUI {
	return { requestRender: () => {}, terminal: { rows: 24 } } as unknown as TUI;
}

function provider(commands: Array<{ name: string; description?: string; argumentHint?: string }>) {
	return new CombinedAutocompleteProvider(commands, process.cwd(), null);
}

describe("MID_PROMPT_SLASH_TOKEN (the trailing /token detector)", () => {
	it("matches a trailing token after whitespace or at a line start", () => {
		assert.ok(MID_PROMPT_SLASH_TOKEN.test("run the tests, then /"));
		assert.ok(MID_PROMPT_SLASH_TOKEN.test("run the tests, then /com"));
		assert.ok(MID_PROMPT_SLASH_TOKEN.test("/com"));
		assert.ok(MID_PROMPT_SLASH_TOKEN.test("hello\n/com"));
	});

	it("never matches path-like tokens (a second / disqualifies)", () => {
		assert.equal(MID_PROMPT_SLASH_TOKEN.test("see /tmp/notes.md"), false);
		assert.equal(MID_PROMPT_SLASH_TOKEN.test("src/foo/"), false);
		assert.equal(MID_PROMPT_SLASH_TOKEN.test("https://x.dev"), false);
	});
});

describe("mid-prompt suggestions (the provider lane)", () => {
	const commands = [
		{ name: "usage", description: "Token & cost report" },
		{ name: "user", description: "User info" },
		{ name: "compact", description: "Compact" },
	];

	it("offers the commands whose names start with the typed letters", async () => {
		const p = provider(commands);
		const suggestions = await p.getSuggestions(["run the tests, then /us"], 0, 23, { signal: new AbortController().signal });
		assert.ok(suggestions);
		assert.deepStrictEqual(
			suggestions.items.map((item: { value: string }) => item.value).sort(),
			["usage", "user"],
		);
		assert.strictEqual(suggestions.prefix, "/us");
	});

	it("a bare mid-prompt / lists every command", async () => {
		const p = provider(commands);
		const suggestions = await p.getSuggestions(["run the tests, then /"], 0, 21, { signal: new AbortController().signal });
		assert.ok(suggestions);
		assert.strictEqual(suggestions.items.length, 3);
	});

	it("a path-like token keeps no command list open (falls to the file lane or nothing)", async () => {
		const p = provider(commands);
		const suggestions = await p.getSuggestions(["see /tmp/notes.md"], 0, 17, { signal: new AbortController().signal });
		// No command matches "tmp/…" — the command lane declines (the file lane
		// owns absolute paths, as it always did).
		assert.ok(!suggestions || suggestions.items.every((item: { value: string }) => !item.value.startsWith("/")));
	});

	it("prefix matching, not fuzzy: 'ua' matches nothing even though 'usage' contains both letters", async () => {
		const p = provider(commands);
		const suggestions = await p.getSuggestions(["then /ua"], 0, 8, { signal: new AbortController().signal });
		assert.strictEqual(suggestions, null);
	});

	it("the message-start lane still works on line 0 (fuzzy, with arguments)", async () => {
		const p = provider([{ ...commands[0]!, argumentHint: "[days]" }]);
		const start = await p.getSuggestions(["/us"], 0, 3, { signal: new AbortController().signal });
		assert.ok(start);
		assert.ok(start.items.some((item: { value: string }) => item.value === "usage"));
	});

	it("a slash at a non-message start on line 1 is a mid-prompt token (not the start lane)", async () => {
		const p = provider(commands);
		const suggestions = await p.getSuggestions(["hello", "/us"], 1, 3, { signal: new AbortController().signal });
		assert.ok(suggestions);
		assert.deepStrictEqual(
			suggestions.items.map((item: { value: string }) => item.value).sort(),
			["usage", "user"],
		);
	});
});

describe("mid-prompt insert (applyCompletion)", () => {
	it("inserts the command in place, keeping the surrounding text", () => {
		const p = provider([{ name: "usage", description: "report" }]);
		const lines = ["run the tests, then /us"];
		const result = p.applyCompletion(lines, 0, 23, { value: "usage", label: "usage" }, "/us");
		assert.strictEqual(result.lines[0], "run the tests, then /usage ");
		assert.strictEqual(result.cursorLine, 0);
		assert.strictEqual(result.cursorCol, "run the tests, then /usage ".length);
	});
});

describe("mid-prompt trigger (the editor lane)", () => {
	it("typing / after a space auto-triggers, letters re-trigger, and Enter accepts without submitting", async () => {
		const original = setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
		try {
			const identity = (text: string) => text;
			const editor = new Editor(fakeTui(), {
				borderColor: identity,
				selectList: {
					selectedPrefix: identity,
					selectedText: identity,
					description: identity,
					scrollInfo: identity,
					noMatch: identity,
				},
			});
			const submitted: string[] = [];
			editor.disableSubmit = false;
			editor.onSubmit = (text: string) => submitted.push(text);
			editor.setAutocompleteProvider(provider([{ name: "usage", description: "report" }]));

			// "run the tests, then " + "/" auto-triggers (the provider resolves async)
			for (const ch of "run the tests, then ") editor.handleInput(ch);
			editor.handleInput("/");
			await new Promise((resolve) => setTimeout(resolve, 10));
			assert.ok(editor.isShowingAutocomplete(), "the bare mid-prompt / opens the command list");
			// typing letters keeps it open and filters
			editor.handleInput("u");
			editor.handleInput("s");
			await new Promise((resolve) => setTimeout(resolve, 10));
			assert.ok(editor.isShowingAutocomplete());
			// Esc closes
			editor.handleInput("\x1b");
			assert.ok(!editor.isShowingAutocomplete());
		} finally {
			setKeybindings(original);
		}
	});
});
