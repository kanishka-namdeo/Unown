import { describe, expect, it } from "vitest";
import { workingLabelShimmer } from "../src/modes/interactive/components/shimmer-label.ts";
import { loadThemeFromPath, nearestAnsi256Index } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

/**
 * The working line's gradient sweep (beauty-4): a raised-cosine band of light
 * travels across the verb label, stepping on the elapsed chip's existing 1s
 * tick. Degradation ladder (the beauty-1 contract): truecolor paints a
 * per-character 24-bit ramp between muted and accent, 256-color a 2-3 step
 * ramp of ladder-safe entries, plain a solid muted label with no animation.
 */

const darkThemePath = new URL("../src/modes/interactive/theme/dark.json", import.meta.url).pathname;
const LABEL = "Editing pagination.ts...";

describe("workingLabelShimmer (the working line's sweep)", () => {
	it("truecolor: ramps per character between the theme's muted and accent", () => {
		const dark = loadThemeFromPath(darkThemePath, "truecolor");
		const shimmer = workingLabelShimmer(dark);

		const painted = shimmer(0, LABEL);
		expect(stripAnsi(painted)).toBe(LABEL);
		// 24-bit escapes for lit runs, the theme's own muted escape for the rest.
		expect(painted).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);
		expect(painted).toContain(dark.getFgAnsi("muted"));
		// The band moves: a later phase paints different bytes, same visible label.
		expect(shimmer(3, LABEL)).not.toBe(painted);
		expect(stripAnsi(shimmer(3, LABEL))).toBe(LABEL);
	});

	it("truecolor: stays subtle — the sweep never reaches the full accent and leaves unlit runs at rest color", () => {
		const dark = loadThemeFromPath(darkThemePath, "truecolor");
		const shimmer = workingLabelShimmer(dark);

		for (let phase = 0; phase < 12; phase++) {
			const painted = shimmer(phase, LABEL);
			// Muted runs always present (the band is 0.35 of the label, never all of it).
			expect(painted).toContain(dark.getFgAnsi("muted"));
			// …and the amplitude (0.6) never paints a character in the pure accent.
			expect(painted).not.toContain(`${dark.getFgAnsi("accent")}${LABEL[0]}`);
		}
	});

	it("256-color: quantizes onto a 2-3 step ramp of ladder-safe entries", () => {
		const dark256 = loadThemeFromPath(darkThemePath, "256color");
		const shimmer = workingLabelShimmer(dark256);

		// The same three steps the implementation derives: the theme's own
		// muted/accent ladder entries plus their quantized midpoint (which may
		// collapse onto base or peak — a legal 2-step ramp).
		const base = { r: 0x7d, g: 0x87, b: 0x99 };
		const peak = { r: 0x56, g: 0xb6, b: 0xc2 };
		const mid = {
			r: Math.round(base.r + (peak.r - base.r) * 0.5),
			g: Math.round(base.g + (peak.g - base.g) * 0.5),
			b: Math.round(base.b + (peak.b - base.b) * 0.5),
		};
		const allowed = new Set([
			dark256.getFgAnsi("muted"),
			dark256.getFgAnsi("accent"),
			`\x1b[38;5;${nearestAnsi256Index(mid)}m`,
		]);

		for (let phase = 0; phase < 12; phase++) {
			const painted = shimmer(phase, LABEL);
			expect(stripAnsi(painted)).toBe(LABEL);
			// Foreground colors only — the trailing [39m reset is not a step.
			const colors = painted.match(/\x1b\[38;5;\d+m/g) ?? [];
			expect(colors.length).toBeGreaterThan(0);
			const distinct = new Set(colors);
			expect(distinct.size).toBeLessThanOrEqual(3); // 2-3 step ramp
			for (const color of distinct) {
				expect(allowed.has(color)).toBe(true); // ladder-safe, never neon drift
			}
		}
	});

	it("plain/NO_COLOR: the solid muted label, no animation", () => {
		const plain = loadThemeFromPath(darkThemePath, "plain");
		const shimmer = workingLabelShimmer(plain);

		const painted = shimmer(0, LABEL);
		expect(painted).toBe(LABEL); // plain mode passes text through unstyled
		// The phase never changes what plain mode renders.
		expect(shimmer(5, LABEL)).toBe(painted);
		expect(shimmer(11, LABEL)).toBe(painted);
	});

	it("phases wrap: phase 12 paints phase 0, negative phases travel forward", () => {
		const dark = loadThemeFromPath(darkThemePath, "truecolor");
		const shimmer = workingLabelShimmer(dark);
		expect(shimmer(12, LABEL)).toBe(shimmer(0, LABEL));
		expect(shimmer(-1, LABEL)).toBe(shimmer(11, LABEL));
	});
});
