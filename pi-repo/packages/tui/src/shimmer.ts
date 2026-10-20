/**
 * shimmer.ts — a moving highlight band for a line of text.
 *
 * Beauty-4 (the feedback release): while a turn runs, the working line's verb
 * label gets a subtle gradient sweep — a raised-cosine band of light that
 * travels across the label's characters, one step per phase (the Claude Code
 * "shimmer" working-line variants and Gemini CLI's gradient status text are
 * the precedents). Pure module: it yields a per-character weight in [0, 1];
 * the consumer maps weights onto colors per terminal capability —
 *
 *   truecolor: 24-bit lerp between the label's base and peak colors
 *   256-color: a small 2-3 step ramp (quantized weights, ladder-safe)
 *   plain:     solid base color, no animation
 *
 * The loader drives the phase on its existing tick lane (the elapsed-time
 * chip's 1s interval) — no new timers.
 */

export interface ShimmerOptions {
	/** Phases for the band to travel the full label width (default 12). */
	period?: number;
	/** Fraction of the label the band covers, edge to edge (default 0.35). */
	width?: number;
}

/**
 * Per-character shimmer weights for one phase: weights[i] is 1 at the band's
 * center, 0 outside the band, raised-cosine in between. The band starts at the
 * left edge at phase 0 and travels right, wrapping; phase may be negative or
 * larger than the period (modulo handles both).
 */
export function shimmerWeights(phase: number, len: number, options: ShimmerOptions = {}): number[] {
	if (len <= 0) {
		return [];
	}
	const period = options.period ?? 12;
	const width = options.width ?? 0.35;
	const safePeriod = period > 0 ? period : 12;
	const safeWidth = width > 0 && width <= 1 ? width : 0.35;
	const center = (((phase % safePeriod) + safePeriod) % safePeriod) / safePeriod;
	const halfBand = safeWidth / 2;
	const weights: number[] = new Array(len);
	for (let i = 0; i < len; i++) {
		// Signed distance from the band center on the unit label, wrapped.
		let d = i / len - center;
		d -= Math.round(d);
		const t = Math.abs(d) / halfBand;
		weights[i] = t >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * t));
	}
	return weights;
}
