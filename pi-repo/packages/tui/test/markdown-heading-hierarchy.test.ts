import assert from "node:assert";
import { describe, it } from "node:test";
import { Markdown, type MarkdownTheme } from "../src/components/markdown.ts";
import { stripTerminalSequences } from "../src/utils.ts";

/**
 * Tests for the beauty-2 typographic heading hierarchy: H1/H2 render as a
 * bold heading followed by a `─` rule (structure from geometry, not color);
 * H3+ render as accent-colored bold text with no `#` prefix and no rule.
 */

// Real ANSI escape byte, built programmatically so this file contains no raw
// control characters or escape-sequence literals.
const ESC = String.fromCharCode(0x1b);
const sgr = (code: string, text: string) => `${ESC}[${code}m${text}${ESC}[0m`;

const headingTheme: MarkdownTheme = {
	heading: (text) => sgr("36", text), // cyan
	accent: (text) => sgr("35", text), // magenta
	link: (text) => text,
	linkUrl: (text) => text,
	code: (text) => text,
	codeBlock: (text) => text,
	codeBlockBorder: (text) => text,
	quote: (text) => text,
	quoteBorder: (text) => text,
	hr: (text) => sgr("2", text), // dim
	listBullet: (text) => text,
	bold: (text) => sgr("1", text), // bold
	italic: (text) => text,
	strikethrough: (text) => text,
	underline: (text) => sgr("4", text), // underline
};

/** Render and return the visible content of each line, without padding. */
function plainLines(markdown: Markdown, width = 80): string[] {
	return markdown.render(width).map((line) => stripTerminalSequences(line).trimEnd());
}

describe("Markdown heading hierarchy", () => {
	it("renders H1 as a bold heading followed by a rule at the heading width", () => {
		const lines = new Markdown("# Title", 0, 0, headingTheme).render(80);

		assert.strictEqual(lines.length, 2, `expected heading + rule: ${JSON.stringify(lines)}`);
		assert.ok(lines[0].startsWith(sgr("36", sgr("1", "Title"))), `H1 should be heading(bold(text)): ${lines[0]}`);
		assert.ok(!lines[0].includes(`${ESC}[4m`), "H1 must not use the underline attribute; the rule is the underline");
		assert.strictEqual(
			stripTerminalSequences(lines[1]).trimEnd(),
			"─".repeat(5),
			`rule must track the heading width: ${lines[1]}`,
		);
		assert.ok(lines[1].startsWith(sgr("2", "─".repeat(5))), `rule uses hr styling: ${lines[1]}`);
	});

	it("renders H2 with a rule, sized to the heading text", () => {
		const lines = plainLines(new Markdown("## Sub title", 0, 0, headingTheme));
		assert.deepStrictEqual(lines, ["Sub title", "─".repeat(9)]);
	});

	it("enforces a minimum rule length of 3", () => {
		const lines = plainLines(new Markdown("## A", 0, 0, headingTheme));
		assert.deepStrictEqual(lines, ["A", "───"]);
	});

	it("caps the rule at the container width for long headings", () => {
		const lines = plainLines(new Markdown("# A very long heading indeed", 0, 0, headingTheme), 10);
		assert.strictEqual(lines.at(-1), "─".repeat(10), `rule must cap at width: ${JSON.stringify(lines)}`);
		assert.ok(lines.length > 2, "long headings wrap");
	});

	it("renders H3+ as accent-colored bold text with no rule and no # prefix", () => {
		const lines = new Markdown("### Deep", 0, 0, headingTheme).render(80);
		assert.strictEqual(lines.length, 1, `H3 renders as a single line: ${JSON.stringify(lines)}`);
		assert.ok(lines[0].includes(sgr("35", sgr("1", "Deep"))), `H3 should be accent(bold(text)): ${lines[0]}`);
		assert.strictEqual(stripTerminalSequences(lines[0]).trim(), "Deep");

		const h4 = new Markdown("#### Deeper", 0, 0, headingTheme).render(80);
		assert.ok(h4[0].includes(sgr("35", sgr("1", "Deeper"))), `H4 should be accent(bold(text)): ${h4[0]}`);
	});

	it("falls back to heading styling for H3+ when accent is not provided", () => {
		const theme: MarkdownTheme = { ...headingTheme, accent: undefined };
		const lines = new Markdown("### Deep", 0, 0, theme).render(80);
		assert.ok(lines[0].includes(sgr("36", sgr("1", "Deep"))), `H3 fallback: ${lines[0]}`);
		assert.ok(!lines[0].includes(sgr("35", "Deep")), "must not use an accent when the theme has none");
	});

	it("restores accent styling after inline tokens in H3+ (heading style context)", () => {
		// Inline tokens (codespan) emit their own ANSI and must restore the H3+
		// accent + bold style afterwards — the heading style context keeps working.
		const theme: MarkdownTheme = { ...headingTheme, code: (text) => sgr("33", text) };
		const lines = new Markdown("### Deep `code` tail", 0, 0, theme).render(80);
		const output = lines[0] ?? "";

		assert.ok(output.includes(sgr("33", "code")), `inline code keeps its own styling: ${output}`);
		const tailIndex = output.indexOf("tail");
		assert.ok(tailIndex > 0, `should contain text after inline code: ${output}`);
		const precedingChunk = output.slice(Math.max(0, tailIndex - 60), tailIndex);
		assert.ok(
			precedingChunk.includes(`${ESC}[35m`) && precedingChunk.includes(`${ESC}[1m`),
			`should re-apply accent + bold after inline code: ${precedingChunk}`,
		);
	});

	it("skips the rule for headings without visible content", () => {
		const lines = plainLines(new Markdown("# ", 0, 0, headingTheme));
		assert.strictEqual(lines.length, 1, `empty heading renders one line: ${JSON.stringify(lines)}`);
		assert.ok(
			lines.every((line) => !line.includes("─")),
			"empty heading must not draw a rule",
		);
	});

	it("keeps the single blank line between a heading block and the next paragraph", () => {
		const lines = plainLines(new Markdown("# Title\n\nBody", 0, 0, headingTheme));
		assert.deepStrictEqual(lines, ["Title", "─".repeat(5), "", "Body"]);
	});
});
