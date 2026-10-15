/**
 * theme.ts — the `unown` brand TUI theme.
 *
 * Seeded into ~/.unown/agent/themes/unown.json on first run (never clobbers
 * user edits) and selected via settings.json's `theme` key — the same
 * discovery pi uses (~/<configDir>/agent/themes/*.json). Palette follows the
 * repo's visual identity: emerald accent (#34d399) on zinc-950, amber for
 * headings/warnings — see .github/assets/banner.png.
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
		text: "#e4e4e7",
		zinc500: "#71717a",
		zinc600: "#52525b",
		zinc700: "#3f3f46",
		zinc800: "#27272a",
		zinc850: "#212126",
		zinc900: "#1c1c1f",
		selectedBg: "#2b2b33",
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
		userMessageBg: "zinc850",
		userMessageText: "text",
		customMessageBg: "zinc900",
		customMessageText: "text",
		customMessageLabel: "emeraldDim",
		toolPendingBg: "zinc850",
		toolSuccessBg: "#12241c",
		toolErrorBg: "#2a1a1a",
		toolTitle: "text",
		toolOutput: "zinc500",

		mdHeading: "amber",
		mdLink: "emerald",
		mdLinkUrl: "zinc500",
		mdCode: "emerald",
		mdCodeBlock: "emeraldDim",
		mdCodeBlockBorder: "zinc700",
		mdQuote: "zinc500",
		mdQuoteBorder: "zinc700",
		mdHr: "zinc700",
		mdListBullet: "emerald",

		toolDiffAdded: "#4ade80",
		toolDiffRemoved: "red",
		toolDiffContext: "zinc500",

		syntaxComment: "#6A9955",
		syntaxKeyword: "#569CD6",
		syntaxFunction: "#DCDCAA",
		syntaxVariable: "#9CDCFE",
		syntaxString: "#CE9178",
		syntaxNumber: "#B5CEA8",
		syntaxType: "#4EC9B0",
		syntaxOperator: "#D4D4D4",
		syntaxPunctuation: "#D4D4D4",

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
