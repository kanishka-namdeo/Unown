import { type RgbColor, shimmerWeights } from "@earendil-works/pi-tui";
import { nearestAnsi256Index, type Theme } from "../theme/theme.ts";

/**
 * shimmer-label.ts — the working line's gradient sweep (beauty-4).
 *
 * While a turn runs, the verb label ("Editing pagination.ts...") gets a subtle
 * animated gradient: a raised-cosine band of light travels across its
 * characters, muted at rest and leaning toward the accent at the band's center
 * — the Claude Code shimmer working-line variants and Gemini CLI's gradient
 * status text are the precedents. The phase steps on the loader's existing
 * tick lane (the elapsed chip's 1s interval) — no new timers.
 *
 * Degradation ladder (the beauty-1 contract):
 *   truecolor  — a per-character 24-bit ramp between the theme's muted/accent
 *   256-color  — a 2-3 step ramp (weights quantized onto the theme's own
 *                quantized muted/mid/accent ladder entries — never neon)
 *   plain      — the solid muted label, no animation
 */

/** How far the band may push the label color toward the accent (subtle). */
const SHIMMER_AMPLITUDE = 0.6;

function lerpRgb(base: RgbColor, peak: RgbColor, t: number): RgbColor {
	return {
		r: Math.round(base.r + (peak.r - base.r) * t),
		g: Math.round(base.g + (peak.g - base.g) * t),
		b: Math.round(base.b + (peak.b - base.b) * t),
	};
}

/**
 * Paint runs of equal color with one escape per run — the rest of the label
 * stays in the muted base at rest. A "" color emits the run bare (no escape).
 */
function paintRuns(chars: string[], colorOf: (index: number) => string, reset: string): string {
	let out = "";
	let runStart = 0;
	let runColor = colorOf(0);
	for (let i = 1; i <= chars.length; i++) {
		const color = i < chars.length ? colorOf(i) : null;
		if (color !== runColor) {
			const run = chars.slice(runStart, i).join("");
			out += runColor === "" ? run : runColor + run + reset;
			runStart = i;
			runColor = color as string;
		}
	}
	return out;
}

/**
 * The per-phase label colorizer for the working line. Receives the phase
 * (advanced once per second by the status indicator) and the label text;
 * returns the styled label for that phase.
 */
export function workingLabelShimmer(t: Theme): (phase: number, text: string) => string {
	const mode = t.getColorMode();
	if (mode === "plain") {
		// Plain/NO_COLOR: solid label, no animation.
		return (_phase, text) => t.fg("muted", text);
	}
	const base = t.getFgRgb("muted");
	const peak = t.getFgRgb("accent");
	if (!base || !peak) {
		// A transparent endpoint can't be ramped — degrade to the solid label.
		return (_phase, text) => t.fg("muted", text);
	}

	if (mode === "256color") {
		// Ladder-safe 2-3 step ramp: quantized weights onto the theme's own
		// muted/accent ladder entries plus the quantized midpoint (which may
		// collapse onto base or peak — a legal 2-step ramp).
		const baseAnsi = t.getFgAnsi("muted");
		const peakAnsi = t.getFgAnsi("accent");
		const midAnsi = `\x1b[38;5;${nearestAnsi256Index(lerpRgb(base, peak, 0.5))}m`;
		const reset = "\x1b[39m";
		return (phase, text) => {
			const chars = Array.from(text);
			const weights = shimmerWeights(phase, chars.length);
			return paintRuns(
				chars,
				(i) => {
					const lit = (weights[i] ?? 0) * SHIMMER_AMPLITUDE;
					return lit >= 2 / 3 ? peakAnsi : lit >= 1 / 3 ? midAnsi : baseAnsi;
				},
				reset,
			);
		};
	}

	// Truecolor: a per-character 24-bit ramp between muted and accent. Unlit
	// runs keep the theme's own muted escape, so the label at rest renders
	// exactly as the solid one did.
	const mutedAnsi = t.getFgAnsi("muted");
	const reset = "\x1b[39m";
	return (phase, text) => {
		const chars = Array.from(text);
		const weights = shimmerWeights(phase, chars.length);
		return paintRuns(
			chars,
			(i) => {
				const lit = (weights[i] ?? 0) * SHIMMER_AMPLITUDE;
				if (lit <= 0) {
					return mutedAnsi;
				}
				const c = lerpRgb(base, peak, lit);
				return `\x1b[38;2;${c.r};${c.g};${c.b}m`;
			},
			reset,
		);
	};
}
