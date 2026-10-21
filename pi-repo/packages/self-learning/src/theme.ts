/**
 * theme.ts — the `unown` brand TUI theme.
 *
 * Seeded into ~/.unown/agent/themes/unown.json on first run (never clobbers
 * user edits) and selected via settings.json's `theme` key — the same
 * discovery pi uses (~/<configDir>/agent/themes/*.json). Palette follows the
 * repo's visual identity: emerald accent (#34d399) on zinc-950, amber for
 * headings/warnings — see .github/assets/banner.png.
 *
 * Beauty contract (docs/tui-beautification-plan.md): state is carried by
 * glyphs and color, never by background fills — every message/tool background
 * token is "" (transparent) so blocks never become walls of color; the only
 * background is the selection gray, which must survive 256-color quantization
 * (flat #303030 lands on the xterm gray ramp, tinted values snap to neon
 * cube corners). chromeBg/overlayBg are the ONLY allowed background surfaces
 * beyond the selection gray — the transcript canvas stays transparent.
 * Code-block text is neutral zinc, not green. Headings use the
 * deeper amber (#eab308) — full-bright #fbbf24 read as a shout at body scale.
 *
 * Contrast contract (pinned by test/theme.test.ts, U1-B): every
 * content-bearing fg token — dim/muted/text/accent/error plus the secondary
 * content rung they anchor (thinkingText, toolOutput, mdQuote, mdLinkUrl,
 * toolDiffContext) — holds WCAG AA 4.5:1 on pageBg/chromeBg/overlayBg, in
 * truecolor AND after 256-color quantization. dim = zinc-400 (#a1a1aa,
 * 6.9:1 on chromeBg; quantizes to gray 247) and muted = zinc-300 (#d4d4d8;
 * quantizes to cube 188) — the previous zinc-600/zinc-500 rungs (2.3:1 /
 * 3.7:1 on chromeBg) failed AA while carrying real content (footer cwd,
 * context meter, dock legends, selector hints, age stamps). Deliberately
 * below AA, by role: thinkingOff/thinkingMinimal (state-glyph ramp — the
 * upstream dark theme ships 1.8:1 there), syntaxComment (borrowed VS Code
 * Light+ comment tone, still brighter than upstream's own 2.98:1),
 * scrollbarThumb (glyph, clears the 3:1 non-text bar) and the border rungs
 * (decorative frame lines).
 *
 * The colors object must satisfy pi's theme schema (51 required tokens —
 * scripts/check_theme.mjs validates the contract).
 */

export const UNOWN_THEME_NAME = "unown";

export const UNOWN_THEME = {
	name: UNOWN_THEME_NAME,
	vars: {
		emerald: "#34d399",
		emeraldDim: "#10b981",
		red: "#f87171",
		amber: "#fbbf24",
		amberDeep: "#eab308",
		text: "#e4e4e7",
		zinc300: "#d4d4d8",
		zinc400: "#a1a1aa",
		zinc500: "#71717a",
		zinc600: "#52525b",
		zinc700: "#3f3f46",
		zinc800: "#27272a",
		selectedBg: "#303030",
		chromeSurface: "#18181b",
		overlaySurface: "#1c1c20",
	},
	colors: {
		accent: "emerald",
		border: "zinc700",
		borderAccent: "emerald",
		borderMuted: "zinc800",
		success: "emerald",
		error: "red",
		warning: "amber",
		muted: "zinc300",
		dim: "zinc400",
		text: "text",
		thinkingText: "zinc400",

		selectedBg: "selectedBg",
		chromeBg: "chromeSurface",
		overlayBg: "overlaySurface",
		// Scrollbar glyphs (pi-tui 1.3.0-style track/thumb painting): the track
		// reads like a frame line (borderMuted tone), the thumb like muted text.
		scrollbarTrack: "zinc800",
		scrollbarThumb: "zinc500",
		userMessageBg: "",
		userMessageText: "text",
		customMessageBg: "",
		customMessageText: "zinc300",
		customMessageLabel: "emeraldDim",
		toolPendingBg: "",
		toolSuccessBg: "",
		toolErrorBg: "",
		toolTitle: "text",
		toolOutput: "zinc400",

		mdHeading: "amberDeep",
		mdLink: "emerald",
		mdLinkUrl: "zinc400",
		mdCode: "emerald",
		mdCodeBlock: "zinc300",
		mdCodeBlockBorder: "zinc700",
		mdQuote: "zinc400",
		mdQuoteBorder: "zinc700",
		mdHr: "zinc700",
		mdListBullet: "emerald",

		toolDiffAdded: "#4ade80",
		toolDiffRemoved: "red",
		toolDiffContext: "zinc400",

		syntaxComment: "#71717a",
		syntaxKeyword: "#5c9cd6",
		syntaxFunction: "#d4cfa0",
		syntaxVariable: "#93b8dc",
		syntaxString: "#cc8f7a",
		syntaxNumber: "#b5cea8",
		syntaxType: "#3fbf9f",
		syntaxOperator: "#c9c9d4",
		syntaxPunctuation: "#c9c9d4",

		thinkingOff: "zinc600",
		thinkingMinimal: "zinc500",
		thinkingLow: "#5f87af",
		thinkingMedium: "#81a2be",
		thinkingHigh: "#34d399",
		thinkingXhigh: "#6ee7b7",
		bashMode: "emerald",

		// Subagent color lanes (beauty-4): 8 optional tokens, one stable
		// lane per named subagent (hash of its name — pi-tui's
		// stableLaneIndex). Cube-exact hexes like the beauty-1 ladder:
		// the 256-color quantizer maps each onto ITSELF (ANSI 68/74/79/
		// 149/179/173/168/134), so no fill ever lands on a neon entry.
		subagentLane0: "#5f87d7",
		subagentLane1: "#5fafd7",
		subagentLane2: "#5fd7af",
		subagentLane3: "#afd75f",
		subagentLane4: "#d7af5f",
		subagentLane5: "#d7875f",
		subagentLane6: "#d75f87",
		subagentLane7: "#af5fd7",
	},
	export: {
		pageBg: "#09090b",
		cardBg: "#18181b",
		infoBg: "#1c2333",
	},
} as const;
