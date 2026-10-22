/**
 * flights-core.ts — the "First flights" guided first-task catalog (pure core).
 *
 * The catalog data is shared by two surfaces: the setup wizard's closing
 * summary (setup.ts renders the `summary` lines under "First flights (paste
 * into a session)") and the in-TUI catalog card a fresh session can boot with.
 * The `summary` field carries the pre-existing setup.ts output lines
 * BYTE-IDENTICALLY — those bytes are pinned by tests and survive as the setup
 * summary contract — so this module is the single source of truth for both
 * surfaces.
 *
 * flightsHandleKey is the catalog component's key router, kept deliberately
 * pure: it takes the RAW key bytes exactly as a pi-tui component's
 * handleInput receives them and returns a declarative action, so the whole
 * interaction is unit-testable without a TTY — the same spirit as
 * src/setup-dialog.ts (injectable dialog) and addons/ask-user-question-core.ts
 * (pure key-routing cascade). Rendering, focus handling, the editor prefill
 * and the send live in the TUI extension shell, not here.
 *
 * ZERO imports: this file must stay importable anywhere (CLI, TUI, tests)
 * without dragging the pi/tui/term import graphs along.
 */

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

export interface Flight {
        /** Stable id. */
        id: string;
        /** Short label shown in the TUI catalog card. */
        title: string;
        /** One-line description shown under the title in the card. */
        blurb: string;
        /** Exact text prefilled into the editor when picked. */
        prompt: string;
        /** Legacy setup-summary line — byte-identical to the pre-existing setup.ts output. */
        summary: string;
}

/**
 * The four first flights. PINNED DATA — the titles/blurbs/prompts/summaries
 * must not drift: the summaries are the setup wizard's output bytes (note the
 * TWO-space gap before the "(or run: …)" suffix on the middle two entries).
 * A fresh array of fresh objects on every call, so no caller can poison the
 * catalog by mutating the result.
 */
export function firstFlightCatalog(): Flight[] {
        return [
                {
                        id: "memory",
                        title: "How unown's memory works",
                        blurb: "explain how unown's memory tiers work",
                        prompt: "explain how unown's memory tiers work",
                        summary: '"explain how unown\'s memory tiers work"',
                },
                {
                        id: "agents-md",
                        title: "Generate an AGENTS.md",
                        blurb: "scaffold repo docs for future agents (or run: unown init-agents)",
                        prompt: "generate an AGENTS.md for this repo",
                        summary: '"generate an AGENTS.md for this repo"  (or run: unown init-agents)',
                },
                {
                        id: "dashboard",
                        title: "Open the dashboard",
                        blurb: "boot it and walk me through it (or run: unown dashboard)",
                        prompt: "open the dashboard and walk me through it",
                        summary: '"open the dashboard and walk me through it"  (or run: unown dashboard)',
                },
                {
                        id: "doctor",
                        title: "Run a health check",
                        blurb: "run unown doctor and explain anything yellow",
                        prompt: "run unown doctor and explain anything yellow",
                        summary: '"run unown doctor and explain anything yellow"',
                },
        ];
}

// ---------------------------------------------------------------------------
// Key routing (pure — raw handleInput bytes in, declarative action out)
// ---------------------------------------------------------------------------

/** What one raw keypress means to the focused catalog component. */
export type FlightsKeyAction =
        | { type: "none" }
        | { type: "pick"; index: number }
        | { type: "move"; delta: number }
        | { type: "dismiss" }
        | { type: "never-again" };

/**
 * Route one raw keypress for a focused catalog of `count` flights.
 *
 *   1-9      jump-pick that numbered card (out of range → none)
 *   Enter    pick the selected card
 *   ↑ / k    move up, clamped at the top (no wrap)
 *   ↓ / j    move down, clamped at the bottom (no wrap)
 *   Esc / q  dismiss the catalog for this session
 *   x / X    never-again (persist the latch — never auto-show again)
 *   else     none
 *
 * The returned `selected` is ALWAYS clamped into [0, count-1]; with
 * count <= 0 every key is none and `selected` passes through untouched.
 */
export function flightsHandleKey(
        data: string,
        selected: number,
        count: number,
): { action: FlightsKeyAction; selected: number } {
        if (count <= 0) return { action: { type: "none" }, selected };
        const clamp = (n: number): number => Math.min(Math.max(n, 0), count - 1);
        const cur = clamp(selected);
        if (/^[1-9]$/.test(data)) {
                const index = Number(data) - 1;
                if (index < count) return { action: { type: "pick", index }, selected: index };
                return { action: { type: "none" }, selected: cur };
        }
        if (data === "\r" || data === "\n") return { action: { type: "pick", index: cur }, selected: cur };
        if (data === "\x1b[A" || data === "k") return { action: { type: "move", delta: -1 }, selected: clamp(cur - 1) };
        if (data === "\x1b[B" || data === "j") return { action: { type: "move", delta: 1 }, selected: clamp(cur + 1) };
        if (data === "\x1b" || data === "q") return { action: { type: "dismiss" }, selected: cur };
        if (data === "x" || data === "X") return { action: { type: "never-again" }, selected: cur };
        return { action: { type: "none" }, selected: cur };
}
