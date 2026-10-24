/**
 * splash.ts — the startup mark: a Unown form opens in the header slot, then
 * hands the header back to pi's built-in one.
 *
 * Two tiers, chosen by the caller (`tools.ts`, from the onboarding latch):
 *
 *   decode  the five forms the name is spelled with, resolving into letters —
 *           the landing page's alphabet band, played once per machine.
 *   eye     the same form blinking awake — every session after.
 *
 * The contract the rest of the stack relies on:
 *
 *   - The wordmark is painted on EVERY frame, built exactly the way
 *     interactive-mode.ts builds the built-in header's first line. The handoff
 *     is therefore invisible, and anything waiting on `unown v…` (the TUI
 *     capture lane's readiness probe, scripts/tui-capture/driver.js) never
 *     waits for the animation.
 *   - Frames are pure functions of (variant, unit, width, theme). Nothing here
 *     reads the clock, the filesystem or the terminal; the component advances a
 *     counter and asks the TUI to redraw.
 *   - Colour is resolved from theme tokens at render time, so a theme switch
 *     mid-animation repaints. No background fills anywhere — the beauty
 *     contract in theme.ts confines surfaces to chrome/overlay.
 *   - Motion is additive. The editor already holds focus when the header is
 *     installed, so a keystroke during the splash goes to the prompt; the timer
 *     is unref()'d, so a splash can never hold a process open.
 *   - Below the art's own width the mark is dropped and the wordmark renders
 *     alone, so the animation can never wrap a row or widen the header.
 *
 * Glyph safety: every character used here is from the box-drawing/block/arrow
 * ranges, which a monospace terminal renders at exactly one cell. This matters —
 * `✕` (U+2715) measures 1.39 cells in a browser mono stack and silently breaks
 * column alignment, while `╳` (U+2573) is 1.00.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { readOnboardingState, writeOnboardingState } from "./onboarding-state.ts";

export type SplashVariant = "decode" | "eye";

/** One animation step. 90 ms keeps the mark inside an 8-12 fps budget. */
export const SPLASH_FRAME_MS = 90;

/** Kill switch: scripts and the TUI capture lane want a byte-stable first frame. */
export const UNOWN_NO_SPLASH_ENV = "UNOWN_NO_SPLASH";

/** onboarding.json `tipsSeen` id, recorded once the first-run mark has played. */
export const SPLASH_DECODE_TIP = "splash:decode";

/** Extra columns the terminal must leave over before the art is drawn. */
const SPLASH_WIDTH_MARGIN = 2;

type Tone = "faint" | "rim" | "hot" | "amber";

type Slit = "none" | "one" | "three" | "closed";

interface Seg {
	text: string;
	tone: Tone;
}

type ArtRow = Seg[];

interface SplashFrame {
	/** This frame occupies hold * SPLASH_FRAME_MS of the timeline. */
	hold: number;
	rows: ArtRow[];
}

function sp(n: number): string {
	return " ".repeat(n);
}

function seg(text: string, tone: Tone = "rim"): Seg {
	return { text, tone };
}

/** A row of blanks, so a partially drawn frame keeps the full footprint. */
function blankRow(width: number): ArtRow {
	return [seg(sp(width), "faint")];
}

/** Show the first `visible` rows of a frame, padded to its full height. */
function reveal(rows: ArtRow[], visible: number, width: number): ArtRow[] {
	const out = rows.slice(0, visible);
	while (out.length < rows.length) out.push(blankRow(width));
	return out;
}

// ---------------------------------------------------------------------------
// the eye — 15 columns, five rows, drawn from the landing page's eye rules:
// a circular disc with a bright vertical slit, never an almond.
// ---------------------------------------------------------------------------

const EYE_WIDTH = 15;

function slitInner(slit: Slit, tone: Tone): ArtRow {
	if (slit === "closed") return [seg("─────────", "faint")];
	if (slit === "one") return [seg(sp(4)), seg("▌", "amber"), seg(sp(4))];
	if (slit === "three") return [seg(sp(3)), seg("███", tone), seg(sp(3))];
	return [seg(sp(9))];
}

function eyeRows(rim: Tone, slit: Slit, slitTone: Tone): ArtRow[] {
	return [
		[seg(sp(5)), seg("╭─────╮", rim), seg(sp(3))],
		[seg(sp(4)), seg("╱", rim), seg(sp(7)), seg("╲", rim), seg(sp(2))],
		[seg(sp(3)), seg("│", rim), ...slitInner(slit, slitTone), seg("│", rim), seg(sp(1))],
		[seg(sp(4)), seg("╲", rim), seg(sp(7)), seg("╱", rim), seg(sp(2))],
		[seg(sp(5)), seg("╰─────╯", rim), seg(sp(3))],
	];
}

/** The eye flattened to three rows — the mark is giving its rows back. */
function eyeFlat(rim: Tone, slitTone: Tone): ArtRow[] {
	const full = eyeRows(rim, "three", slitTone);
	return [full[0], full[2], full[4]];
}

function eyeDot(): ArtRow[] {
	return [[seg(sp(6)), seg("◉", "hot"), seg(sp(8))]];
}

const EYE_FRAMES: SplashFrame[] = [
	{ hold: 1, rows: reveal(eyeRows("faint", "none", "faint"), 1, EYE_WIDTH) },
	{ hold: 1, rows: reveal(eyeRows("faint", "none", "faint"), 2, EYE_WIDTH) },
	{ hold: 1, rows: eyeRows("faint", "none", "faint") },
	{ hold: 1, rows: eyeRows("rim", "one", "amber") },
	{ hold: 1, rows: eyeRows("rim", "three", "amber") },
	{ hold: 1, rows: eyeRows("rim", "closed", "amber") },
	{ hold: 2, rows: eyeRows("hot", "three", "hot") },
	{ hold: 1, rows: eyeFlat("hot", "hot") },
	{ hold: 1, rows: eyeDot() },
];

// ---------------------------------------------------------------------------
// decode — five forms on the shared skeleton (cap, baseline, descender), then
// the flip into letters. 33 columns wide.
// ---------------------------------------------------------------------------

const DECODE_WIDTH = 33;
const FORM_COLS = 5;
const FORM_GAP = 2;
const FORM_ROWS = 4;

/** U, N, O, W, N — stroke forms, not fills, same construction as glyphs.ts. */
const FORMS: string[][] = [
	["│   │", "│   │", "│   │", "╰───╯"],
	["│╲  │", "│ ╲ │", "│  ╲│", "│   │"],
	["╭───╮", "│   │", "│   │", "╰───╯"],
	["╲   ╱", " ╲ ╱ ", " ╱ ╲ ", "╱   ╲"],
	["│╲  │", "│ ╲ │", "│  ╲│", "│   │"],
];

const LETTERS = ["U", "N", "O", "W", "N"];

function formsRows(shown: number, tone: Tone, hot: number): ArtRow[] {
	const rows: ArtRow[] = [];
	for (let r = 0; r < FORM_ROWS; r++) {
		const row: ArtRow = [];
		for (let f = 0; f < FORMS.length; f++) {
			if (f > 0) row.push(seg(sp(FORM_GAP), "faint"));
			if (f < shown) row.push(seg(FORMS[f][r], f === hot ? "hot" : tone));
			else row.push(seg(sp(FORM_COLS), "faint"));
		}
		rows.push(row);
	}
	return rows;
}

/** A centred single line inside the forms' own 33-column footprint. */
function letterRow(text: string, tone: Tone): ArtRow {
	const side = Math.floor((DECODE_WIDTH - text.length) / 2);
	const tail = DECODE_WIDTH - side - text.length;
	return [seg(sp(side), "faint"), seg(text, tone), seg(sp(tail), "faint")];
}

const DECODE_FRAMES: SplashFrame[] = [
	{ hold: 1, rows: formsRows(1, "faint", 0) },
	{ hold: 1, rows: formsRows(2, "faint", 1) },
	{ hold: 1, rows: formsRows(3, "faint", 2) },
	{ hold: 1, rows: formsRows(4, "faint", 3) },
	{ hold: 1, rows: formsRows(5, "rim", 4) },
	{ hold: 1, rows: formsRows(5, "hot", -1) },
	{ hold: 2, rows: formsRows(5, "amber", -1) },
	{ hold: 1, rows: [letterRow(LETTERS.join(sp(FORM_GAP)), "hot")] },
	{ hold: 1, rows: [letterRow("UNOWN", "hot")] },
	{ hold: 1, rows: eyeDot() },
];

const FRAMES: Record<SplashVariant, SplashFrame[]> = {
	decode: DECODE_FRAMES,
	eye: EYE_FRAMES,
};

const ART_WIDTH: Record<SplashVariant, number> = {
	decode: DECODE_WIDTH,
	eye: EYE_WIDTH,
};

// ---------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------

function frameList(variant: SplashVariant): SplashFrame[] {
	return FRAMES[variant] ?? FRAMES.eye;
}

/** Total animation steps for a variant. */
export function splashUnitCount(variant: SplashVariant): number {
	return frameList(variant).reduce((sum, f) => sum + f.hold, 0);
}

/** Wall-clock length of the mark, derived from the frame table — never typed. */
export function splashDurationMs(variant: SplashVariant): number {
	return splashUnitCount(variant) * SPLASH_FRAME_MS;
}

function frameAt(variant: SplashVariant, unit: number): SplashFrame | null {
	const frames = frameList(variant);
	let step = 0;
	for (const frame of frames) {
		if (unit < step + frame.hold) return frame;
		step += frame.hold;
	}
	return null;
}

/** The art rows for one step, or null once the mark has run out. */
export function splashRowsAt(variant: SplashVariant, unit: number): ArtRow[] | null {
	return frameAt(variant, unit)?.rows ?? null;
}

/** Columns the mark needs before it will draw itself at all. */
export function splashMinWidth(variant: SplashVariant): number {
	return ART_WIDTH[variant] + SPLASH_WIDTH_MARGIN;
}

// ---------------------------------------------------------------------------
// painting
// ---------------------------------------------------------------------------

function colorize(theme: Theme, s: Seg): string {
	if (!s.text) return "";
	// Padding carries no colour: painting blank runs would churn the TUI's
	// diff renderer with escape sequences that change nothing on screen.
	if (!s.text.trim()) return s.text;
	if (s.tone === "faint") return theme.fg("borderMuted", s.text);
	if (s.tone === "rim") return theme.fg("muted", s.text);
	if (s.tone === "amber") return theme.fg("warning", s.text);
	return theme.bold(theme.fg("accent", s.text));
}

/**
 * The header's first line, built the way interactive-mode.ts builds it, so the
 * built-in header takes over without a visible seam.
 */
export function splashWordmark(theme: Theme, appName: string, version: string): string {
	return theme.bold(theme.fg("accent", appName)) + theme.fg("dim", ` v${version}`);
}

/** Every line of one frame, at one width, in one theme. Pure. */
export function renderSplash(
	variant: SplashVariant,
	unit: number,
	width: number,
	theme: Theme,
	appName: string,
	version: string,
): string[] {
	const wordmark = splashWordmark(theme, appName, version);
	const rows = splashRowsAt(variant, unit);
	if (!rows || width < splashMinWidth(variant)) return [wordmark];
	const artWidth = ART_WIDTH[variant];
	const pad = Math.max(0, Math.floor((width - artWidth) / 2));
	const out: string[] = [];
	for (const row of rows) {
		const painted = row.map((s) => colorize(theme, s)).join("");
		const indent = Math.max(0, pad + Math.floor((artWidth - visibleWidth(painted)) / 2));
		out.push(`${" ".repeat(indent)}${painted}`);
	}
	out.push(wordmark);
	return out;
}

// ---------------------------------------------------------------------------
// gating
// ---------------------------------------------------------------------------

export interface SplashGateInput {
	/** ctx.mode from the extension — only "tui" has a header to take over. */
	mode: string | undefined;
	/** settingsManager.getQuietStartup(), resolved by the caller. */
	quietStartup: boolean;
	/** NO_COLOR is set — pi's theme derives "plain" from exactly this (theme.ts). */
	plainColor: boolean;
	/** UNOWN_NO_SPLASH — the kill switch the capture lane uses. */
	envDisabled: boolean;
	/** True once the mark has played in this process. */
	alreadyShown: boolean;
}

/** Why the mark is off, or null when it should play. Pure, so it is testable. */
export function splashBlockReason(input: SplashGateInput): string | null {
	if (input.alreadyShown) return "already shown this session";
	if (input.mode !== "tui") return "not the interactive TUI";
	if (input.envDisabled) return UNOWN_NO_SPLASH_ENV;
	if (input.quietStartup) return "quietStartup";
	if (input.plainColor) return "NO_COLOR";
	return null;
}

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------

export interface SplashHeaderOptions {
	variant: SplashVariant;
	appName: string;
	version: string;
	/** Called once when the mark finishes, to hand the header back. */
	onDone?: () => void;
}

/**
 * A header Component that plays one splash variant and then reports done.
 *
 * It never consumes input: the built-in editor keeps focus throughout, and the
 * interval is unref()'d, so the mark can neither delay a keystroke nor keep a
 * process alive.
 */
export class SplashHeader implements Component {
	private tui: TUI;
	private theme: Theme;
	private variant: SplashVariant;
	private appName: string;
	private version: string;
	private onDone: () => void;
	private unit = 0;
	private timer: ReturnType<typeof setInterval> | null = null;
	private cacheWidth = -1;
	private cacheUnit = -1;
	private cache: string[] = [];

	constructor(tui: TUI, theme: Theme, options: SplashHeaderOptions) {
		this.tui = tui;
		this.theme = theme;
		this.variant = options.variant;
		this.appName = options.appName;
		this.version = options.version;
		this.onDone = options.onDone ?? (() => {});
		this.start();
	}

	render(width: number): string[] {
		if (width === this.cacheWidth && this.unit === this.cacheUnit) return this.cache;
		this.cache = renderSplash(this.variant, this.unit, width, this.theme, this.appName, this.version);
		this.cacheWidth = width;
		this.cacheUnit = this.unit;
		return this.cache;
	}

	invalidate(): void {
		this.cacheWidth = -1;
		this.cacheUnit = -1;
	}

	dispose(): void {
		this.stop();
		this.onDone = () => {};
	}

	private start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => this.tick(), SPLASH_FRAME_MS);
		const timer = this.timer;
		if (timer && typeof timer.unref === "function") timer.unref();
	}

	private stop(): void {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = null;
	}

	private tick(): void {
		this.unit++;
		if (this.unit >= splashUnitCount(this.variant)) {
			this.finish();
			return;
		}
		this.invalidate();
		this.tui.requestRender();
	}

	private finish(): void {
		this.stop();
		this.invalidate();
		const done = this.onDone;
		this.onDone = () => {};
		done();
	}
}

// ---------------------------------------------------------------------------
// extension
// ---------------------------------------------------------------------------

/** True when the kill switch asks for no mark. `0`/empty means "not disabled". */
export function splashEnvDisabled(env: Record<string, string | undefined> = process.env): boolean {
	const value = env[UNOWN_NO_SPLASH_ENV];
	return value !== undefined && value !== "" && value !== "0";
}

/**
 * Record that the first-run mark has played, so every later boot gets the
 * short one. A latch that cannot be written costs a replayed mark, never a
 * crash — boot paths here never throw.
 */
export function markSplashPlayed(variant: SplashVariant, home?: string): void {
	if (variant !== "decode") return;
	try {
		const state = readOnboardingState(home);
		if (state.tipsSeen.includes(SPLASH_DECODE_TIP)) return;
		writeOnboardingState({ ...state, tipsSeen: [...state.tipsSeen, SPLASH_DECODE_TIP] }, home);
	} catch {
		// ignore: unreadable latch just means the flourish plays again
	}
}

export interface SplashExtensionOptions {
	appName: string;
	version: string;
	/** settingsManager.getQuietStartup() — a quiet start gets no mark. */
	quietStartup: boolean;
	/** onboarding.json home; injectable so tests get an isolated latch. */
	home?: string;
}

/**
 * The startup mark as a standalone extension: it takes over pi's built-in
 * header for ~1 s and hands it back.
 *
 * Tier comes from the onboarding latch — `decode` on the machine's first
 * interactive session, `eye` on every one after. Like flights.ts, only
 * `reason === "startup"` counts: session_start also fires for /new, /resume
 * and /reload, and a mark on each of those would be an interruption, not a
 * welcome.
 */
export function createSplashExtension(options: SplashExtensionOptions) {
	const factory = (pi: ExtensionAPI): void => {
		let shownThisProcess = false;

		pi.on("session_start", async (event, ctx) => {
			if (event.reason !== "startup") return;

			const variant: SplashVariant = readOnboardingState(options.home).tipsSeen.includes(SPLASH_DECODE_TIP)
				? "eye"
				: "decode";
			const blockReason = splashBlockReason({
				mode: ctx.mode,
				quietStartup: options.quietStartup,
				plainColor: process.env.NO_COLOR !== undefined,
				envDisabled: splashEnvDisabled(),
				alreadyShown: shownThisProcess,
			});
			if (blockReason) return;
			if (typeof ctx.ui.setHeader !== "function") return;

			shownThisProcess = true;
			markSplashPlayed(variant, options.home);
			ctx.ui.setHeader((tui: TUI, theme: Theme) => {
				return new SplashHeader(tui, theme, {
					variant,
					appName: options.appName,
					version: options.version,
					onDone: () => ctx.ui.setHeader(undefined),
				});
			});
		});
	};
	return factory;
}
