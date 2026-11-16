// external-editor-context.test.ts — Da capo R4: Ctrl+G prepends the last
// assistant reply as '#'-commented context above the prompt; the exact block
// is stripped on save (byte-exact prefix bookkeeping). Pure battery on the
// block builder + stripper, then real round-trips through the fixture editor
// (the user writes under the block / deletes the block / fails the editor).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildExternalEditorContextBlock,
	editInExternalEditor,
	stripExternalEditorContext,
} from "../src/modes/interactive/external-editor.ts";

const FIXTURE = join(import.meta.dirname, "fixtures", "fake-external-editor.mjs");

let tmpRoot: string | undefined;
afterEach(() => {
	if (tmpRoot) {
		rmSync(tmpRoot, { recursive: true, force: true });
		tmpRoot = undefined;
	}
});

/** Run the fixture editor with `flag`, capturing what it saw on disk. */
async function runFixtureEditor(flag?: "--append-reply" | "--fail" | "--empty") {
	tmpRoot = mkdtempSync(join(tmpdir(), "pi-editor-ctx-"));
	const capturePath = join(tmpRoot, "capture.json");
	const command = `${process.execPath} ${FIXTURE} ${capturePath}${flag ? ` ${flag}` : ""}`;
	return { command, capturePath };
}

describe("buildExternalEditorContextBlock", () => {
	it("comments every reply line and closes with a blank separator", () => {
		const block = buildExternalEditorContextBlock("line one\nline two");
		expect(block).toBe(
			"# --- previous reply (context — this block is stripped on save) ---\n# line one\n# line two\n\n",
		);
	});

	it("renders empty reply lines as bare '#' (no trailing space)", () => {
		const block = buildExternalEditorContextBlock("para one\n\npara two");
		expect(block).toContain("# para one\n#\n# para two\n");
	});

	it("never injects a '#' into reply text that already carries one", () => {
		const block = buildExternalEditorContextBlock("# not a comment\n");
		expect(block).toContain("# # not a comment");
	});
});

describe("stripExternalEditorContext", () => {
	const block = buildExternalEditorContextBlock("the reply");

	it("strips the exact prepended block byte-exactly", () => {
		expect(stripExternalEditorContext(block + "my prompt", block)).toBe("my prompt");
	});

	it("strips nothing when the user deleted the block", () => {
		expect(stripExternalEditorContext("my prompt only", block)).toBe("my prompt only");
	});

	it("strips nothing when the user edited inside the block", () => {
		const edited = block.replace("the reply", "the edited reply") + "my prompt";
		expect(stripExternalEditorContext(edited, block)).toBe(edited);
	});

	it("strips nothing when no block was prepended (setting off)", () => {
		expect(stripExternalEditorContext("my prompt", undefined)).toBe("my prompt");
	});

	it("round-trips an empty prompt: block alone strips to empty", () => {
		expect(stripExternalEditorContext(block, block)).toBe("");
	});
});

describe("editInExternalEditor round-trips (the fixture user)", () => {
	it("seeds the context block above the prompt and strips it after a reply is written under it", async () => {
		const { command, capturePath } = await runFixtureEditor("--append-reply");
		const block = buildExternalEditorContextBlock("the previous reply");
		const result = await editInExternalEditor({ command, content: `${block}my prompt` });
		expect(result.status).toBe("complete");
		if (result.status !== "complete") return;

		// What the editor SAW on disk: the block rides above the prompt.
		const captured = JSON.parse(readFileSync(capturePath, "utf-8")) as { content: string };
		expect(captured.content.startsWith(block)).toBe(true);
		expect(captured.content).toBe(`${block}my prompt`);

		// What comes back after the "user" wrote a reply under the block:
		// the block strips, the reply survives.
		expect(stripExternalEditorContext(result.content, block)).toBe("my promptmy reply");
	});

	it("leaves the content untouched when the user deleted the block", async () => {
		const { command } = await runFixtureEditor(); // rewrites the file as "edited\n"
		const block = buildExternalEditorContextBlock("the previous reply");
		const result = await editInExternalEditor({ command, content: `${block}my prompt` });
		expect(result.status).toBe("complete");
		if (result.status !== "complete") return;
		// "edited\n" does not start with the block → nothing strips.
		expect(stripExternalEditorContext(result.content, block)).toBe("edited");
	});
});
