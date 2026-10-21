// WCAG contrast guard for the unown brand theme (U1-B, theme-contrast lane).
//
// A UX audit measured the old rungs at dim #52525b = 2.57:1 on pageBg /
// 2.29:1 on chromeBg and muted #71717a = 4.12:1 / 3.67:1 — both under the
// AA 4.5:1 text bar while carrying real content (footer cwd line, context
// meter numbers, files-dock legend, selector hints, dashboard age stamps).
// The fix moved the rungs up the zinc scale (dim → zinc-400 #a1a1aa,
// muted → zinc-300 #d4d4d8, plus the secondary content tokens that shared
// the old rung: thinkingText/toolOutput/mdQuote/mdLinkUrl/toolDiffContext).
// This file pins the contract so a future palette edit cannot silently
// reintroduce a sub-AA content rung — in truecolor AND after 256-color
// quantization (the mode where terminals round every hex to the nearest
// xterm cube/gray entry).
//
// Tiers:
//   - AA (≥4.5:1, WCAG 2.1 SC 1.4.3 normal text) on pageBg/chromeBg/overlayBg:
//     dim, muted, text, accent, error + the secondary content rung.
//   - Decorative (≥3:1, WCAG SC 1.4.11 non-text / SC 1.4.3 large text) on the
//     same surfaces: thinkingMinimal, scrollbarThumb, syntaxComment,
//     thinkingLow, thinkingMedium — status glyphs and borrowed syntax tones,
//     documented as deliberately below the text bar (upstream's own dark
//     theme ships thinkingOff at 1.8:1; its syntaxComment measures 2.98:1).
//   - Selection (≥3:1) on selectedBg for the five key tokens: the selection
//     gray is a transient highlight state, held to the non-text bar. (error
//     quantizes to 4.43:1 there — above 3:1, a hair under 4.5; truecolor
//     4.77:1. Recorded, not a failure.)
//   - Hierarchy: lum(dim) < lum(muted) < lum(text) — the anti-flattening
//     rule from the fix lane ("dim must still read dimmer than muted,
//     muted dimmer than text").
//
// UNOWN_THEME ships a single dark variant; there is no light variant in
// theme.ts. If one is ever added, add its token/bg pairs to the tiers below.
import "./_env.ts";
import { describe, expect, test } from "bun:test";
import { UNOWN_THEME } from "../src/theme.ts";

// --- self-contained helpers (no deps) --------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const h = hex.replace("#", "");
	if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`not a hex color: ${hex}`);
	return {
		r: parseInt(h.slice(0, 2), 16),
		g: parseInt(h.slice(2, 4), 16),
		b: parseInt(h.slice(4, 6), 16),
	};
}

/** WCAG 2.1 relative luminance (sRGB channels linearized). */
function luminance(hex: string): number {
	const { r, g, b } = hexToRgb(hex);
	const lin = (c: number) => {
		c /= 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.1 contrast ratio, (L_lighter + 0.05) / (L_darker + 0.05). */
function contrastRatio(fg: string, bg: string): number {
	const a = luminance(fg);
	const b = luminance(bg);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Resolve a theme token (hex or var ref, var refs may chain) to its hex. */
function resolveToken(value: string, vars: Record<string, string>, seen = new Set<string>()): string {
	if (value.startsWith("#")) return value;
	if (seen.has(value)) throw new Error(`circular var ref: ${value}`);
	if (!(value in vars)) throw new Error(`unknown var ref: ${value}`);
	seen.add(value);
	return resolveToken(vars[value], vars, seen);
}

const CUBE = [0, 95, 135, 175, 215, 255];
const GRAYS = Array.from({ length: 24 }, (_, i) => 8 + i * 10);

/**
 * Replica of the TUI's 256-color quantizer (rgbTo256 in
 * coding-agent/src/modes/interactive/theme/theme.ts): nearest 6x6x6 cube
 * entry vs nearest gray-ramp entry, weighted-RGB distance, gray wins only
 * for near-neutral colors (channel spread < 10). Duplicated here so the
 * guard stays dependency-free; if the engine's quantizer ever changes,
 * mirror the change.
 */
function quantize256(hex: string): string {
	const { r, g, b } = hexToRgb(hex);
	const nearest = (v: number, xs: number[]) =>
		xs.reduce((best, x, i) => (Math.abs(v - x) < Math.abs(v - xs[best]) ? i : best), 0);
	const dist = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) =>
		(r1 - r2) ** 2 * 0.299 + (g1 - g2) ** 2 * 0.587 + (b1 - b2) ** 2 * 0.114;
	const ri = nearest(r, CUBE);
	const gi = nearest(g, CUBE);
	const bi = nearest(b, CUBE);
	const cubeDist = dist(r, g, b, CUBE[ri], CUBE[gi], CUBE[bi]);
	const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
	const gy = GRAYS[nearest(gray, GRAYS)];
	const grayDist = dist(r, g, b, gy, gy, gy);
	const useGray = Math.max(r, g, b) - Math.min(r, g, b) < 10 && grayDist < cubeDist;
	const [rr, gg, bb] = useGray ? [gy, gy, gy] : [CUBE[ri], CUBE[gi], CUBE[bi]];
	return `#${[rr, gg, bb].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

// --- the theme under test ---------------------------------------------------

const vars = UNOWN_THEME.vars as Record<string, string>;
const colors = UNOWN_THEME.colors as Record<string, string>;
const token = (name: string): string => resolveToken(colors[name], vars);

// Surfaces are read from the theme itself, so a future bg edit is guarded too.
const surfaces: Record<string, string> = {
	pageBg: UNOWN_THEME.export.pageBg,
	chromeBg: token("chromeBg"),
	overlayBg: token("overlayBg"),
	selectedBg: token("selectedBg"),
};
const contentSurfaces = ["pageBg", "chromeBg", "overlayBg"] as const;

const AA_TOKENS = [
	"dim",
	"muted",
	"text",
	"accent",
	"error",
	// Secondary content rung re-pointed with dim/muted in U1-B: they render
	// the thinking stream, tool output, quotes, link URLs and diff context —
	// real content, same bar.
	"thinkingText",
	"toolOutput",
	"mdQuote",
	"mdLinkUrl",
	"toolDiffContext",
] as const;

// Deliberately below the 4.5:1 text bar (documented in theme.ts): status
// glyphs and a borrowed syntax-comment tone. Held to the 3:1 non-text bar.
const DECORATIVE_TOKENS = [
	"thinkingMinimal",
	"scrollbarThumb",
	"syntaxComment",
	"thinkingLow",
	"thinkingMedium",
] as const;

function checkTier(tier: string, tokens: readonly string[], surfaceNames: readonly string[], min: number): string[] {
	const failures: string[] = [];
	for (const name of tokens) {
		const fg = token(name);
		for (const surfaceName of surfaceNames) {
			const bg = surfaces[surfaceName];
			for (const mode of ["truecolor", "256-color"] as const) {
				const effective = mode === "truecolor" ? fg : quantize256(fg);
				const ratio = contrastRatio(effective, bg);
				if (ratio < min) {
					failures.push(
						`${tier} ${name} (${effective} in ${mode}) on ${surfaceName} ${bg}: ${ratio.toFixed(2)}:1 < ${min}:1`,
					);
				}
			}
		}
	}
	return failures;
}

// --- guards -----------------------------------------------------------------

describe("unown theme contrast (WCAG, truecolor + 256-color)", () => {
	test("content tokens hold AA 4.5:1 on page/chrome/overlay in both color modes", () => {
		expect(checkTier("AA", AA_TOKENS, contentSurfaces, 4.5)).toEqual([]);
	});

	test("decorative tokens (documented sub-AA roles) still clear the 3:1 bar", () => {
		expect(checkTier("decorative", DECORATIVE_TOKENS, contentSurfaces, 3)).toEqual([]);
	});

	test("key tokens clear 3:1 on the transient selection surface", () => {
		expect(checkTier("selection", ["dim", "muted", "text", "accent", "error"], ["selectedBg"], 3)).toEqual([]);
	});

	test("hierarchy intact: dim reads dimmer than muted, muted dimmer than text", () => {
		const failures: string[] = [];
		const steps: Array<[string, string]> = [
			["dim", "muted"],
			["muted", "text"],
		];
		for (const [dimmer, brighter] of steps) {
			const a = luminance(token(dimmer));
			const b = luminance(token(brighter));
			if (!(a < b)) {
				failures.push(
					`${dimmer} (${token(dimmer)}, L=${a.toFixed(3)}) must be dimmer than ${brighter} (${token(brighter)}, L=${b.toFixed(3)})`,
				);
			}
		}
		expect(failures).toEqual([]);
	});

	test("dim/muted quantize onto nearby neutral entries, never neon cube corners", () => {
		const failures: string[] = [];
		for (const name of ["dim", "muted"] as const) {
			const fg = token(name);
			const q = quantize256(fg);
			const drift = contrastRatio(fg, q);
			if (drift > 1.15) {
				failures.push(
					`${name} ${fg} quantizes to ${q} — drift ${drift.toFixed(2)}:1 (nearest-entry sanity broken)`,
				);
			}
		}
		expect(failures).toEqual([]);
	});
});
