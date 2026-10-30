/**
 * dashboard/widgets/bits.ts — the dashboard's shared rendering vocabulary:
 * pills, badges, meters, sparklines, KPI cards, empty/loading/error states
 * and the formatting helpers (timeAgo, tokens, bytes, duration).
 *
 * All styling goes through the passed Theme instance (theme.fg/bg tokens) so
 * the unown brand theme, user themes and the 256-color ladder apply for free
 * (the beauty contract: state via glyphs + color, never background fills —
 * chromeBg/overlayBg are the only allowed surfaces, see theme.ts).
 *
 * These are pure line-producing helpers, not components: screens compose
 * them into string[] rows inside their render(width).
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export type Tone = "emerald" | "amber" | "rose" | "zinc" | "dim";

/** Map an activity tone onto the theme's accent vocabulary. */
export function toneToken(tone: Tone): "success" | "warning" | "error" | "text" | "muted" {
	switch (tone) {
		case "emerald":
			return "success";
		case "amber":
			return "warning";
		case "rose":
			return "error";
		case "zinc":
			return "text";
		case "dim":
			return "muted";
	}
}

/** A `[ text ]` chip colored by tone. */
export function pill(theme: Theme, text: string, tone: Tone = "zinc"): string {
	return theme.fg(toneToken(tone), `[ ${text} ]`);
}

/** A bare `text` label colored by tone (no brackets) — for inline chips. */
export function badge(theme: Theme, text: string, tone: Tone = "zinc"): string {
	return theme.fg(toneToken(tone), text);
}

/** A `▐ label` section heading — the deep-amber heading idiom. */
export function heading(theme: Theme, text: string): string {
	return `${theme.fg("borderMuted", "▐ ")}${theme.fg("mdHeading", text)}`;
}

/** A `──── title ────` rule that fills the width. */
export function rule(theme: Theme, title: string | null, width: number): string {
	const label = title ? ` ${title} ` : "";
	const used = visibleWidth(label);
	const dashes = Math.max(0, width - used);
	const left = Math.floor(dashes / 2);
	const right = dashes - left;
	return `${theme.fg("borderMuted", "─".repeat(left))}${label ? theme.fg("muted", label) : ""}${theme.fg("borderMuted", "─".repeat(right))}`;
}

/** A block-glyph meter: `█████░░░░░ 48%` — threshold-colored (footer idiom). */
export function meter(theme: Theme, ratio: number, width = 10, label = ""): string {
	const clamped = Math.max(0, Math.min(1, ratio));
	const filled = Math.round(clamped * width);
	const tone: Tone = clamped >= 0.9 ? "rose" : clamped >= 0.7 ? "amber" : "emerald";
	const bar = "█".repeat(filled) + "░".repeat(width - filled);
	const pct = `${Math.round(clamped * 100)}%`;
	return `${theme.fg(toneToken(tone), bar)} ${theme.fg("muted", pct)}${label ? ` ${theme.fg("dim", label)}` : ""}`;
}

/** A block-glyph sparkline over a numeric series (newest right).
 * Zero-dependency, braille-free (core-terminal Unicode law). */
export function sparkline(theme: Theme, values: readonly number[], width: number, tone: Tone = "emerald"): string {
	if (values.length === 0) return theme.fg("dim", "· no data");
	const w = Math.max(4, width);
	// Downsample/upsample to w points.
	const pts: number[] = [];
	for (let i = 0; i < w; i++) {
		const idx = (i / (w - 1 || 1)) * (values.length - 1);
		const lo = Math.floor(idx);
		const hi = Math.ceil(idx);
		const frac = idx - lo;
		pts.push(values[lo]! + (values[hi]! - values[lo]!) * frac);
	}
	const min = Math.min(...pts);
	const max = Math.max(...pts);
	const span = max - min || 1;
	// 5 levels: ░ ▁ ▃ ▅ █ (space for 0).
	const levels = [" ", "▁", "▃", "▅", "█"];
	const cells = pts.map((v) => {
		const level = Math.min(4, Math.floor(((v - min) / span) * 4.999));
		return level === 0 && v > 0 ? levels[1]! : levels[level]!;
	});
	return theme.fg(toneToken(tone), cells.join(""));
}

/** A KPI row cell: `label\nvalue` with the value large-toned. Returns [labelLine, valueLine]. */
export function kpiCell(theme: Theme, label: string, value: string, tone: Tone = "zinc"): string[] {
	return [theme.fg("muted", label), theme.fg(toneToken(tone), value)];
}

/** Pad/align two strings into columns within `width` (left + right-aligned). */
export function twoEnds(theme: Theme, left: string, right: string, width: number, rightTone: Tone = "dim"): string {
	const lw = visibleWidth(left);
	const rw = visibleWidth(right);
	const gap = Math.max(1, width - lw - rw);
	return `${left}${" ".repeat(gap)}${theme.fg(toneToken(rightTone), right)}`;
}

/** Standard empty-state block. */
export function emptyState(theme: Theme, message: string, hint?: string, width = 40): string[] {
	const lines = [theme.fg("dim", `○ ${message}`)];
	if (hint) lines.push(theme.fg("dim", `  ${hint}`));
	return lines;
}

/** Standard loading block. */
export function loadingState(theme: Theme, what: string): string[] {
	return [theme.fg("muted", `◌ loading ${what}…`)];
}

/** Standard error block with a down-engine hint. */
export function errorState(theme: Theme, message: string, width = 40): string[] {
	const wrapped = wrapTextWithAnsi(`✗ ${message}`, Math.max(20, width - 2));
	const lines = wrapped.map((l) => theme.fg("error", l));
	lines.push(theme.fg("dim", "  · the dashboard keeps its last snapshot — data ages, nothing is lost"));
	return lines;
}

/** `cached 4m ago` / `fresh` data-age stamp (k9s cached-as-of pattern). */
export function ageStamp(theme: Theme, ageMs: number | null, extra?: string): string {
	if (ageMs === null) return theme.fg("dim", extra ?? "");
	const s = Math.floor(ageMs / 1000);
	const age =
		s < 5 ? "fresh" : s < 90 ? `${s}s old` : s < 5400 ? `${Math.round(s / 60)}m old` : `${Math.round(s / 3600)}h old`;
	const tone: Tone = s < 30 ? "dim" : s < 300 ? "zinc" : "amber";
	const stamp = theme.fg(toneToken(tone), age);
	return extra ? `${stamp} ${theme.fg("dim", extra)}` : stamp;
}

// ---- formatters ----

export function timeAgo(ts: number | null | undefined, now = Date.now()): string {
	if (!ts) return "never";
	const s = Math.max(0, Math.floor((now - ts) / 1000));
	if (s < 10) return "just now";
	if (s < 90) return `${s}s ago`;
	if (s < 5400) return `${Math.round(s / 60)}m ago`;
	if (s < 172800) return `${Math.round(s / 3600)}h ago`;
	return `${Math.round(s / 86400)}d ago`;
}

export function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return `${n}`;
}

export function formatBytes(n: number): string {
	if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
	if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
	if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${n} B`;
}

export function formatDuration(ms: number | null | undefined): string {
	if (ms === null || ms === undefined) return "—";
	const s = Math.floor(ms / 1000);
	if (s < 90) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 90) return `${m}m ${s % 60}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatInterval(ms: number): string {
	if (ms >= 3_600_000) return `${Math.round(ms / 3_600_000)}h`;
	if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
	return `${Math.round(ms / 1000)}s`;
}

/** Difficulty stars: ★★☆ (1-5). */
export function difficultyStars(n: number): string {
	const clamped = Math.max(1, Math.min(5, n));
	return "★".repeat(clamped) + "☆".repeat(5 - clamped);
}

/** Truncate a possibly-ANSI string to a visible width (ellipsis). */
export function trunc(s: string, width: number): string {
	if (visibleWidth(s) <= width) return s;
	return truncateToWidth(s, Math.max(0, width - 1)) + "…";
}

/** Wrap a possibly-ANSI string to width, preserving styling per line. */
export function wrap(s: string, width: number): string[] {
	if (width < 8) return [trunc(s, Math.max(1, width))];
	return wrapTextWithAnsi(s, width);
}

/** Status → tone mapping shared by screens. */
export function statusTone(status: string): Tone {
	switch (status) {
		case "passed":
		case "done":
		case "improved":
		case "shipped":
		case "succeeded":
		case "active":
			return "emerald";
		case "running":
		case "validating":
		case "proposed":
		case "gated":
			return "amber";
		case "failed":
		case "error":
		case "regressed":
		case "denied":
			return "rose";
		default:
			return "zinc";
	}
}

/** Inline single-line text input state (compose fields, provider forms).
 *
 * The dashboard is not an editor playground — forms are short single-line
 * fields, so a tiny buffer with printable-char insert + backspace beats
 * mounting pi's full Editor (focus juggling, IME markers). `insert` returns
 * true when the data was consumed as input. */
export class InlineInput {
	text = "";
	/** Max chars (callers pass caps: notes 20000, labels ~120). */
	readonly maxChars: number;

	constructor(maxChars = 200) {
		this.maxChars = maxChars;
	}

	insert(data: string): boolean {
		// Control sequences start with ESC; single printable runes (incl.
		// multi-byte UTF-8 and full-width CJK) pass through.
		if (data === "\x7f" || data === "\b") {
			this.text = this.text.slice(0, -1);
			return true;
		}
		if (data >= " ") {
			const next = this.text + data;
			if (next.length <= this.maxChars) this.text = next;
			return true;
		}
		return false;
	}

	clear(): void {
		this.text = "";
	}

	/** Render the field: `label [text‸]  n/max` */
	renderField(theme: Theme, label: string, width: number): string {
		const shown = trunc(this.text || "", Math.max(4, width - label.length - 14));
		const cursor = theme.fg("accent", "‸");
		const count = theme.fg("dim", `${this.text.length}/${this.maxChars}`);
		return `${theme.fg("muted", label)} ${theme.fg("text", shown)}${cursor}  ${count}`;
	}
}
