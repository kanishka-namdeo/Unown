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
 * cube corners). Code-block text is neutral zinc, not green. Headings use the
 * deeper amber (#eab308) — full-bright #fbbf24 read as a shout at body scale.
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
		zinc500: "#71717a",
		zinc600: "#52525b",
		zinc700: "#3f3f46",
		zinc800: "#27272a",
		selectedBg: "#303030",
	},
	colors: {
		accent: "emerald",
		border: "zinc700",
		borderAccent: "emerald",
		borderMuted: "zinc800",
		success: "emerald",
		error: "red",
		warning: "amber",
		muted: "zinc500",
		dim: "zinc600",
		text: "text",
		thinkingText: "zinc500",

		selectedBg: "selectedBg",
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
		toolOutput: "zinc500",

		mdHeading: "amberDeep",
		mdLink: "emerald",
		mdLinkUrl: "zinc500",
		mdCode: "emerald",
		mdCodeBlock: "zinc300",
		mdCodeBlockBorder: "zinc700",
		mdQuote: "zinc500",
		mdQuoteBorder: "zinc700",
		mdHr: "zinc700",
		mdListBullet: "emerald",

		toolDiffAdded: "#4ade80",
		toolDiffRemoved: "red",
		toolDiffContext: "zinc500",

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
	},
	export: {
		pageBg: "#09090b",
		cardBg: "#18181b",
		infoBg: "#1c2333",
	},
} as const;
