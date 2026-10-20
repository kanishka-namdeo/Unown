import { Container, Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import type { MarkdownTransformer } from "../../../core/extensions/types.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/**
 * Component that renders a user message.
 *
 * Beauty contract: the user's words are marked by an accent-colored rail glyph
 * (») on the first line and a two-space gutter for the rest — never a
 * background slab (the old full-width fill read as a gray block clashing with
 * the terminal canvas).
 */
export class UserMessageComponent extends Container {
	private text: string;
	private markdownTheme: MarkdownTheme;
	private outputPad: number;
	private markdownTransformers: readonly MarkdownTransformer[];

	constructor(
		text: string,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
	) {
		super();
		this.text = text;
		this.markdownTheme = markdownTheme;
		this.outputPad = outputPad;
		this.markdownTransformers = markdownTransformers;
		this.rebuild();
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();
		this.addChild(
			new Markdown(
				this.text,
				0,
				0,
				this.markdownTheme,
				{
					color: (content: string) => theme.fg("userMessageText", content),
				},
				{
					preserveOrderedListMarkers: true,
					preserveBackslashEscapes: true,
					transform: createMarkdownTransform("user", false, this.markdownTransformers),
				},
			),
		);
	}

	override render(width: number): string[] {
		const lines = super.render(Math.max(1, width - 2));
		if (lines.length === 0) {
			return lines;
		}

		const rail = theme.fg("accent", "» ");
		for (let i = 0; i < lines.length; i++) {
			lines[i] = (i === 0 ? rail : "  ") + lines[i];
		}

		// OSC 133 zone markers stay at line start (deliberate: a prior fix moved
		// the closing markers off line end to keep rendered height stable). On a
		// single-line message both markers open the same line, in order.
		if (lines.length === 1) {
			lines[0] = OSC133_ZONE_START + OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[0];
		} else {
			lines[0] = OSC133_ZONE_START + lines[0];
			lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		}
		return lines;
	}
}
