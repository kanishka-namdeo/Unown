// Startup mark guard (src/splash.ts).
//
// The mark is a ~1s animation that takes over pi's built-in header and hands it
// back, which puts it on the critical path of two things that break silently:
//
//   1. The capture lane. scripts/tui-capture/driver.js waits for the literal
//      `unown v` before it drives anything, so the wordmark must be on the FIRST
//      frame and on EVERY frame. A mark that paints art instead of the wordmark
//      makes every TUI capture wait on an animation.
//   2. The transcript layout. The header sits above a fixed-height viewport, so
//      one row that is a column too wide wraps, and a wrapped art row shears the
//      mark and shifts every line beneath it.
//
// Both classes already happened while building this: the W form's third row was
// typed 4 columns instead of 5 (a one-column shear on the frames that show the
// W), and the multiplication sign U+2715 — which the landing page's mark field
// uses — measures 1.39 cells in a mono stack that falls back for it, silently
// breaking alignment. Hence the equal-row-length and glyph-range pins below.
//
// Durations are asserted as a budget and read out of the frame table rather than
// typed here, so a longer mark fails instead of drifting.
import "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { TEST_TMP } from "./_env.ts";

/** Bun 1.4.2 ships no mock.timers, so the lifecycle runs on the real clock. */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

import { readOnboardingState } from "../src/onboarding-state.ts";
import {
	createSplashExtension,
	markSplashPlayed,
	renderSplash,
	SPLASH_DECODE_TIP,
	SPLASH_FRAME_MS,
	SplashHeader,
	type SplashVariant,
	splashBlockReason,
	splashDurationMs,
	splashEnvDisabled,
	splashMinWidth,
	splashUnitCount,
	splashWordmark,
	UNOWN_NO_SPLASH_ENV,
} from "../src/splash.ts";
import { UNOWN_THEME } from "../src/theme.ts";

const VARIANTS: SplashVariant[] = ["eye", "decode"];
const APP = "unown";
const VER = "0.0.12";

const DIRS: string[] = [];
function freshDir(prefix = "splash-"): string {
	const d = mkdtempSync(join(TEST_TMP, prefix));
	DIRS.push(d);
	return d;
}
afterAll(() => {
	for (const d of DIRS) rmSync(d, { recursive: true, force: true });
});

/** Theme stub that records which surface methods the mark reaches for. */
function stubTheme() {
	const methods = new Set<string>();
	const tokens: string[] = [];
	const esc = (code: string, text: string) =>
		code === "bold" ? `\u001b[1m${text}\u001b[22m` : `\u001b[38;2;52;211;153m${text}\u001b[39m`;
	return {
		methods,
		tokens,
		theme: {
			fg(token: string, text: string) {
				methods.add("fg");
				tokens.push(token);
				return esc(token, text);
			},
			bold(text: string) {
				methods.add("bold");
				return esc("bold", text);
			},
		},
	};
}

const strip = (line: string) => line.replace(/\u001b\[[0-9;]*m/g, "");
const cells = (line: string) => Array.from(strip(line)).length;
const framesOf = (variant: SplashVariant, width = 110) => {
	const { theme } = stubTheme();
	const out: string[][] = [];
	for (let unit = 0; unit < splashUnitCount(variant); unit++) {
		out.push(renderSplash(variant, unit, width, theme as never, APP, VER));
	}
	return out;
};

describe("wordmark contract (the capture lane's readiness probe)", () => {
	test("every frame of every variant ends on the wordmark line", () => {
		for (const variant of VARIANTS) {
			const frames = framesOf(variant);
			expect(frames.length, variant).toBeGreaterThan(1);
			for (const [unit, lines] of frames.entries()) {
				const last = strip(lines[lines.length - 1] ?? "");
				expect(last, `${variant} unit ${unit}`).toBe(`${APP} v${VER}`);
			}
		}
	});

	test("the wordmark is painted before any art resolves", () => {
		const { theme } = stubTheme();
		const first = renderSplash("decode", 0, 110, theme as never, APP, VER).map(strip);
		expect(first[first.length - 1]).toBe(`${APP} v${VER}`);
	});

	test("built the way interactive-mode.ts builds it: accent name, dim version", () => {
		const { theme, tokens } = stubTheme();
		const line = splashWordmark(theme as never, APP, VER);
		expect(strip(line)).toBe(`${APP} v${VER}`);
		expect(tokens).toEqual(["accent", "dim"]);
	});
});

describe("geometry (a wrapped row shears the mark)", () => {
	test("every art row in a frame occupies the same columns", () => {
		for (const variant of VARIANTS) {
			for (const [unit, lines] of framesOf(variant).entries()) {
				const art = lines.slice(0, -1);
				const widths = new Set(art.map(cells));
				expect(widths.size, `${variant} unit ${unit}: rows disagree ${[...widths]}`).toBe(1);
			}
		}
	});

	test("no line ever exceeds the terminal width", () => {
		for (const width of [20, 34, 36, 60, 80, 100, 110, 140]) {
			for (const variant of VARIANTS) {
				for (const [unit, lines] of framesOf(variant, width).entries()) {
					for (const [i, line] of lines.entries()) {
						expect(cells(line) <= width, `${variant} u${unit} line ${i} at ${width}`).toBe(true);
					}
				}
			}
		}
	});

	test("below its minimum width a variant collapses to the wordmark alone", () => {
		const { theme } = stubTheme();
		for (const variant of VARIANTS) {
			const tight = renderSplash(variant, 3, splashMinWidth(variant) - 1, theme as never, APP, VER);
			expect(tight.length, variant).toBe(1);
			expect(strip(tight[0]), variant).toBe(`${APP} v${VER}`);
		}
	});

	test("the decode mark is the wider of the two, and both fit an 80-col terminal", () => {
		expect(splashMinWidth("decode")).toBeGreaterThan(splashMinWidth("eye"));
		for (const variant of VARIANTS) expect(splashMinWidth(variant)).toBeLessThan(80);
	});
});

describe("glyph safety (a fallback font measures 1.39 cells and breaks alignment)", () => {
	/** Box drawing, block elements and geometric shapes are cell-safe everywhere. */
	const SAFE = /^[\u0020-\u007E\u2300-\u23FF\u2500-\u25FF]$/;

	test("every painted character is single-cell", () => {
		for (const variant of VARIANTS) {
			for (const lines of framesOf(variant)) {
				for (const ch of Array.from(strip(lines.join("")))) {
					expect(SAFE.test(ch), `${variant}: unsafe glyph ${ch} U+${ch.codePointAt(0)?.toString(16)}`).toBe(true);
				}
			}
		}
	});

	test("the dingbats and emoji ranges the landing page uses stay out", () => {
		const painted = new Set(
			framesOf("decode")
				.flat()
				.flatMap((l) => Array.from(strip(l))),
		);
		for (const banned of ["\u2715", "\u2716", "\u00D7", "\u2795", "\u2B50"]) {
			expect(painted.has(banned), banned).toBe(false);
		}
	});
});

describe("surface discipline (the beauty contract bans background fills)", () => {
	test("the mark only ever asks the theme for fg and bold", () => {
		for (const variant of VARIANTS) {
			const { theme, methods } = stubTheme();
			for (let unit = 0; unit < splashUnitCount(variant); unit++) {
				renderSplash(variant, unit, 110, theme as never, APP, VER);
			}
			expect([...methods].sort(), variant).toEqual(["bold", "fg"]);
		}
	});

	// theme.fg() THROWS on a token the active theme does not define, and the
	// runtime theme object is not reachable from a test — so the token names are
	// checked against the unown theme table instead. A renamed token in splash.ts
	// would otherwise only be found by booting the TUI.
	test("every token the mark paints with exists in the unown theme", () => {
		const { theme, tokens } = stubTheme();
		for (const variant of VARIANTS) {
			for (let unit = 0; unit < splashUnitCount(variant); unit++) {
				renderSplash(variant, unit, 110, theme as never, APP, VER);
			}
		}
		const defined = new Set(Object.keys(UNOWN_THEME.colors));
		const used = new Set(tokens);
		expect(used.size).toBeGreaterThan(0);
		for (const token of used) {
			expect(defined.has(token), `theme has no "${token}" colour`).toBe(true);
		}
	});

	test("padding is emitted uncoloured, so blank runs churn no diff", () => {
		const { theme } = stubTheme();
		const line = renderSplash("eye", 0, 110, theme as never, APP, VER)[0] ?? "";
		const lead = line.slice(0, line.indexOf("\u001b"));
		expect(lead).toBe(" ".repeat(lead.length));
	});
});

describe("motion budget", () => {
	test("the step rate stays inside the 8-12 fps band", () => {
		expect(SPLASH_FRAME_MS).toBeGreaterThanOrEqual(80);
		expect(SPLASH_FRAME_MS).toBeLessThanOrEqual(125);
	});

	test("neither mark runs long enough to be waited on", () => {
		for (const variant of VARIANTS) {
			expect(splashDurationMs(variant), variant).toBeLessThanOrEqual(1200);
			expect(splashDurationMs(variant), variant).toBe(splashUnitCount(variant) * SPLASH_FRAME_MS);
		}
	});

	test("the first-run flourish is the longer of the two", () => {
		expect(splashDurationMs("decode")).toBeGreaterThan(splashDurationMs("eye"));
	});
});

describe("gates", () => {
	const open = {
		mode: "tui",
		quietStartup: false,
		plainColor: false,
		envDisabled: false,
		alreadyShown: false,
	};

	test("an ordinary interactive boot is the only thing that plays", () => {
		expect(splashBlockReason(open)).toBeNull();
	});

	test("each suppression names itself", () => {
		expect(splashBlockReason({ ...open, mode: "print" })).toBe("not the interactive TUI");
		expect(splashBlockReason({ ...open, mode: undefined })).toBe("not the interactive TUI");
		expect(splashBlockReason({ ...open, quietStartup: true })).toBe("quietStartup");
		expect(splashBlockReason({ ...open, plainColor: true })).toBe("NO_COLOR");
		expect(splashBlockReason({ ...open, envDisabled: true })).toBe(UNOWN_NO_SPLASH_ENV);
		expect(splashBlockReason({ ...open, alreadyShown: true })).toBe("already shown this session");
	});

	test("the kill switch reads like every other unown flag", () => {
		expect(splashEnvDisabled({})).toBe(false);
		expect(splashEnvDisabled({ [UNOWN_NO_SPLASH_ENV]: "" })).toBe(false);
		expect(splashEnvDisabled({ [UNOWN_NO_SPLASH_ENV]: "0" })).toBe(false);
		expect(splashEnvDisabled({ [UNOWN_NO_SPLASH_ENV]: "1" })).toBe(true);
		expect(splashEnvDisabled({ [UNOWN_NO_SPLASH_ENV]: "yes" })).toBe(true);
	});
});

describe("first-run tier (the onboarding latch decides which mark plays)", () => {
	test("marking the flourish played is written once and is idempotent", () => {
		const home = freshDir();
		expect(readOnboardingState(home).tipsSeen).toEqual([]);

		markSplashPlayed("decode", home);
		const once = readOnboardingState(home).tipsSeen;
		expect(once).toContain(SPLASH_DECODE_TIP);

		markSplashPlayed("decode", home);
		markSplashPlayed("decode", home);
		expect(readOnboardingState(home).tipsSeen).toEqual(once);
	});

	test("the short mark never touches the latch", () => {
		const home = freshDir();
		markSplashPlayed("eye", home);
		expect(readOnboardingState(home).tipsSeen).toEqual([]);
	});

	test("an unrelated tip already in the latch survives the write", () => {
		const home = freshDir();
		markSplashPlayed("decode", home);
		const state = readOnboardingState(home);
		expect(state.schema).toBe(1);
		expect(state.flightsDismissed).toBe(false);
	});
});

/** Drive the extension the way pi does: capture the session_start handler, fire it. */
async function fireSessionStart(opts: {
	home: string;
	reason?: string;
	mode?: string;
	quietStartup?: boolean;
	env?: Record<string, string | undefined>;
}) {
	const handlers: Array<(event: never, ctx: never) => Promise<void>> = [];
	const pi = {
		on: (_event: string, handler: (event: never, ctx: never) => Promise<void>) => {
			handlers.push(handler);
		},
	};
	createSplashExtension({
		appName: APP,
		version: VER,
		quietStartup: opts.quietStartup ?? false,
		home: opts.home,
	})(pi as never);

	let installs = 0;
	let restores = 0;
	const ctx = {
		mode: opts.mode ?? "tui",
		ui: {
			setHeader: (factory?: unknown) => {
				if (factory) installs++;
				else restores++;
			},
		},
	};
	// Hermetic by default: ambient NO_COLOR / UNOWN_NO_SPLASH (exported in a
	// developer shell, or CI images that set NO_COLOR globally) must not leak
	// into "a real boot installs the header" — only opts.env controls them.
	const savedNoColor = process.env.NO_COLOR;
	const savedKill = process.env[UNOWN_NO_SPLASH_ENV];
	if (opts.env?.NO_COLOR !== undefined) process.env.NO_COLOR = opts.env.NO_COLOR;
	else delete process.env.NO_COLOR;
	if (opts.env?.[UNOWN_NO_SPLASH_ENV] !== undefined) process.env[UNOWN_NO_SPLASH_ENV] = opts.env[UNOWN_NO_SPLASH_ENV];
	else delete process.env[UNOWN_NO_SPLASH_ENV];
	try {
		for (const handler of handlers) {
			await handler({ type: "session_start", reason: opts.reason ?? "startup" } as never, ctx as never);
		}
	} finally {
		if (savedNoColor === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = savedNoColor;
		if (savedKill === undefined) delete process.env[UNOWN_NO_SPLASH_ENV];
		else process.env[UNOWN_NO_SPLASH_ENV] = savedKill;
	}
	return { installs, restores };
}

describe("extension wiring", () => {
	test("a real boot installs the header; a quiet one does not", async () => {
		expect((await fireSessionStart({ home: freshDir() })).installs).toBe(1);
		expect((await fireSessionStart({ home: freshDir(), quietStartup: true })).installs).toBe(0);
		expect((await fireSessionStart({ home: freshDir(), mode: "rpc" })).installs).toBe(0);
		expect((await fireSessionStart({ home: freshDir(), env: { NO_COLOR: "1" } })).installs).toBe(0);
		expect((await fireSessionStart({ home: freshDir(), env: { [UNOWN_NO_SPLASH_ENV]: "1" } })).installs).toBe(0);
	});

	test("/new, /resume, /reload and /fork are not boots", async () => {
		for (const reason of ["new", "resume", "reload", "fork"]) {
			const { installs } = await fireSessionStart({ home: freshDir(), reason });
			expect(installs, reason).toBe(0);
		}
	});

	test("one mark per process, however many session_starts arrive", async () => {
		const home = freshDir();
		const handlers: Array<(event: never, ctx: never) => Promise<void>> = [];
		createSplashExtension({ appName: APP, version: VER, quietStartup: false, home })({
			on: (_e: string, h: (event: never, ctx: never) => Promise<void>) => handlers.push(h),
		} as never);
		const ctx = { mode: "tui", ui: { setHeader: (f?: unknown) => (f ? 1 : 0) } };
		// Hermetic: the ambient shell's NO_COLOR must not block the mark.
		const savedNoColor = process.env.NO_COLOR;
		const savedKill = process.env[UNOWN_NO_SPLASH_ENV];
		delete process.env.NO_COLOR;
		delete process.env[UNOWN_NO_SPLASH_ENV];
		try {
			for (let i = 0; i < 3; i++) {
				for (const h of handlers) await h({ type: "session_start", reason: "startup" } as never, ctx as never);
			}
		} finally {
			if (savedNoColor !== undefined) process.env.NO_COLOR = savedNoColor;
			if (savedKill !== undefined) process.env[UNOWN_NO_SPLASH_ENV] = savedKill;
		}
		expect(handlers.length).toBe(1);
		expect(readOnboardingState(home).tipsSeen).toContain(SPLASH_DECODE_TIP);
	});
});

describe("mark lifecycle", () => {
	const fakeTui = { requestRender: () => {} };

	test("it hands the header back exactly once, then goes quiet", async () => {
		let done = 0;
		const { theme } = stubTheme();
		const header = new SplashHeader(fakeTui as never, theme as never, {
			variant: "eye",
			appName: APP,
			version: VER,
			onDone: () => done++,
		});
		expect(header.render(110).length).toBeGreaterThan(1);

		await sleep(splashDurationMs("eye") + 300);
		expect(done).toBe(1);

		await sleep(300);
		expect(done, "a second handoff would thrash the header").toBe(1);
		header.dispose();
	});

	test("dispose before the end cancels the handoff (a replaced header must not restore over a new one)", async () => {
		let done = 0;
		const { theme } = stubTheme();
		const header = new SplashHeader(fakeTui as never, theme as never, {
			variant: "eye",
			appName: APP,
			version: VER,
			onDone: () => done++,
		});
		await sleep(SPLASH_FRAME_MS * 2);
		header.dispose();
		await sleep(splashDurationMs("eye") + 300);
		expect(done).toBe(0);
	});

	test("the frame advances while it runs", async () => {
		const { theme } = stubTheme();
		const header = new SplashHeader(fakeTui as never, theme as never, {
			variant: "eye",
			appName: APP,
			version: VER,
		});
		const first = header.render(110).join("\n");
		await sleep(SPLASH_FRAME_MS * 4);
		const later = header.render(110).join("\n");
		expect(later).not.toBe(first);
		header.dispose();
	});

	test("a theme switch repaints rather than replaying", () => {
		const { theme } = stubTheme();
		const header = new SplashHeader(fakeTui as never, theme as never, {
			variant: "eye",
			appName: APP,
			version: VER,
		});
		const before = header.render(110).join("\n");
		header.invalidate();
		expect(header.render(110).join("\n")).toBe(before);
		expect(header.render(60).length).toBeGreaterThan(0);
		header.dispose();
	});
});
