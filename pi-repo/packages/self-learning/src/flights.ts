/**
 * flights.ts — the "First flights" guided first-task extension.
 *
 * Onboarding 2.0's last mile: a fresh interactive session used to land the
 * user in an empty editor with no idea what to type. The Hermes-posture fix
 * is a one-time starter catalog INSIDE the TUI (the chat-onboarding
 * "first-task catalog" beat): when the interactive session starts and the
 * user has never sent a message, the editor slot is replaced by a catalog
 * card (the model-selector mount — ctx.ui.custom, non-overlay) listing four
 * concrete starter tasks. Digits or arrows+Enter pick one; the prompt is
 * PREFILLED into the editor with a hint to press Enter; Esc closes it for
 * this session; "x" never auto-shows it again; /flights reopens it anytime.
 *
 * The latch lives in <UNOWN_HOME>/onboarding.json (onboarding-state.ts):
 *
 *   - flightsDismissed  the user pressed "x" — never auto-show again
 *   - firstTaskAt       the timestamp of the FIRST real interactive message
 *   - tipsSeen          one-time tip ids already shown (see below)
 *
 * firstTaskAt is deliberately NOT set by the catalog itself: the latch is
 * the first REAL user message (the "input" event, source "interactive"), so
 * a user who looks at the card, escapes and goes on typing their own thing
 * is still counted as onboarded — and a user who picks a flight and sends
 * it is too (the prefilled prompt becomes their first message).
 *
 * The catalog content itself (titles, blurbs, prompts, summary lines) is
 * shared with the setup wizard's closing summary through flights-core.ts —
 * one source of truth, so `unown setup` and the in-TUI card can never drift.
 *
 * On top of the catalog, the same extension renders two one-time-ever TIP
 * surfaces (the pinned copy lives in onboarding-tips.ts, the pure core):
 *
 *   - the "You're flying" tip — on agent_settled, only when THIS process
 *     latched the first-ever firstTaskAt (the user's first real task just
 *     fully settled). A firstTaskAt left over from an earlier session never
 *     re-triggers it, and it fires at most once per process.
 *
 *   - one rotating session-start tip for RETURNING users (firstTaskAt set or
 *     flightsDismissed — the catalog's own "not a fresh boot" conditions):
 *     exactly one unseen tip per boot, in list order, until the list is
 *     exhausted; then nothing, forever.
 *
 * Both latch their id in tipsSeen and render as quiet in-transcript status
 * lines (ctx.ui.notify(text, "info")) — never dialogs, never LLM context,
 * never blocking. One onboarding surface per boot: a session that shows the
 * catalog never also shows a rotating tip, and the initialMessage lane
 * (autoShow=false — `unown "prompt"`) shows NEITHER: its message is
 * mid-task from t=0 and earns the flying tip itself.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { firstFlightCatalog, flightsHandleKey, type Flight } from "./flights-core.ts";
import { readOnboardingState, writeOnboardingState } from "./onboarding-state.ts";
import { flyingTipText, FLYING_TIP_ID, nextSessionTip } from "./onboarding-tips.ts";

export interface FirstFlightsOptions {
        cwd: string;
        /** Auto-show the catalog on TUI startup. Default true. Pass false when an initialMessage will fire immediately. */
        autoShow?: boolean;
        /** Test seam: override the unown home (defaults to the module UNOWN_HOME inside onboarding-state). */
        home?: string;
}

/** What the catalog settles to: a picked Flight, "never-again", or undefined (Esc). */
export type FlightsCatalogResult = Flight | "never-again" | undefined;

/**
 * Footer status line: pi's `ctx.ui.setStatus(key, text)` seam — the footer
 * renders one joined row from all extension statuses (pass undefined to
 * clear the key). Guarded on every call, same contract as tools.ts/mcp.ts:
 * the UI shape varies across pi modes/builds, so a missing or throwing
 * setStatus degrades to no status line — never a crash.
 */
const setStatusLine = (ctx: ExtensionContext, key: string, text: string | undefined): void => {
        try {
                if (!ctx?.hasUI || typeof ctx.ui?.setStatus !== "function") return;
                ctx.ui.setStatus(key, text);
        } catch {
                /* the footer is cosmetic — degrade silently */
        }
};

/**
 * One quiet in-transcript tip line: pi's `ctx.ui.notify(text, "info")` seam
 * — a status line in the transcript, NOT LLM context and NOT a blocking
 * dialog. Same cosmetic contract as setStatusLine: the UI shape varies
 * across pi modes/builds, so a missing or throwing notify degrades to
 * silence — a tip failure must never break anything.
 */
const notifyLine = (ctx: ExtensionContext, text: string): void => {
        try {
                if (!ctx?.hasUI || typeof ctx.ui?.notify !== "function") return;
                ctx.ui.notify(text, "info");
        } catch {
                /* a tip is cosmetic — degrade silently */
        }
};

// ---------------------------------------------------------------------------
// The catalog component
// ---------------------------------------------------------------------------

export interface FlightsCatalogOptions {
        flights: Flight[];
        selected: number;
        theme: Theme;
        done: (result: FlightsCatalogResult) => void;
}

/**
 * The First flights card. A manually bordered box (the ask-user-question
 * idiom: theme-tinted border, width-fit, stateless render), one row per
 * flight with its blurb indented below, the selected row accented. Raw
 * handleInput — digits are free keys there, which is the whole point of a
 * custom component over the SelectList pickers.
 */
export class FlightsCatalogComponent implements Component {
        private readonly flights: Flight[];
        private selected: number;
        private readonly theme: Theme;
        private readonly done: (result: FlightsCatalogResult) => void;
        private settled = false;

        constructor(options: FlightsCatalogOptions) {
                this.flights = options.flights;
                this.selected = Math.min(Math.max(options.selected, 0), Math.max(options.flights.length - 1, 0));
                this.theme = options.theme;
                this.done = options.done;
        }

        // -- Component contract ------------------------------------------------

        render(width: number): string[] {
                const contentWidth = Math.max(width - 4, 20);
                const inner = this.renderInner(contentWidth);
                const lines: string[] = [];
                const top = `┌${"─".repeat(Math.max(contentWidth, 1))}┐`;
                const bottom = `└${"─".repeat(Math.max(contentWidth, 1))}┘`;
                lines.push(this.theme.fg("accent", top));
                for (const line of inner) {
                        const padded = line + " ".repeat(Math.max(contentWidth - visibleWidth(line), 0));
                        lines.push(`${this.theme.fg("accent", "│")}${padded}${this.theme.fg("accent", "│")}`);
                }
                lines.push(this.theme.fg("accent", bottom));
                lines.push("");
                return lines;
        }

        invalidate(): void {
                /* stateless render — nothing cached */
        }

        handleInput(data: string): void {
                if (this.settled) return;
                const { action, selected } = flightsHandleKey(data, this.selected, this.flights.length);
                switch (action.type) {
                        case "none": {
                                return;
                        }
                        case "move": {
                                // The TUI re-renders synchronously after handleInput
                                // (requestImmediateRender), so updating the index is enough.
                                this.selected = selected;
                                return;
                        }
                        case "pick": {
                                const flight = this.flights[action.index];
                                if (flight) this.finish(flight);
                                return;
                        }
                        case "dismiss": {
                                this.finish(undefined);
                                return;
                        }
                        case "never-again": {
                                this.finish("never-again");
                                return;
                        }
                }
        }

        // -- Settling ------------------------------------------------------------

        private finish(result: FlightsCatalogResult): void {
                if (this.settled) return;
                this.settled = true;
                this.done(result);
        }

        // -- Rendering -----------------------------------------------------------

        private renderInner(width: number): string[] {
                const lines: string[] = [];
                lines.push(`  ${this.theme.bg("selectedBg", this.theme.fg("accent", " First flights "))}`);
                lines.push("");
                const intro = wrapTextWithAnsi(
                        this.theme.fg("muted", "Pick a starter task — it lands in the editor, ready to send."),
                        Math.max(width - 4, 10),
                );
                for (const line of intro) {
                        lines.push(`  ${line}`);
                }
                lines.push("");
                this.flights.forEach((flight, index) => {
                        const active = index === this.selected;
                        const prefix = active ? this.theme.fg("accent", "❯ ") : "  ";
                        const row = `${prefix}${index + 1}  ${this.theme.bold(flight.title)}`;
                        lines.push(`  ${active ? this.theme.fg("accent", row) : this.theme.fg("muted", row)}`);
                        for (const line of wrapTextWithAnsi(this.theme.fg("dim", flight.blurb), Math.max(width - 8, 10))) {
                                lines.push(`    ${line}`);
                        }
                });
                lines.push(...this.renderFooter(width));
                return lines;
        }

        private renderFooter(width: number): string[] {
                const hintWidth = Math.max(width - 4, 10);
                return [
                        "",
                        `  ${this.theme.fg("dim", truncateToWidth(`1-${this.flights.length} pick · ↑↓ move · enter use · esc close`, hintWidth))}`,
                        `  ${this.theme.fg("dim", truncateToWidth("x  don't show this again", hintWidth))}`,
                ];
        }
}

// ---------------------------------------------------------------------------
// Showing the catalog
// ---------------------------------------------------------------------------

/**
 * Mount the catalog in the editor slot (the model-selector mount: non-overlay
 * ctx.ui.custom swaps the editor out and restores it when the component
 * settles). A pick PREFILLS the prompt into the (by then restored) editor and
 * leaves a footer hint; "never-again" persists flightsDismissed; Esc is a
 * no-op (the card simply shows again next session). `pi` is part of the
 * pinned signature for future extension points; the component talks to the
 * host exclusively through ctx.ui.
 */
async function showCatalog(pi: ExtensionAPI, ctx: ExtensionContext, home?: string): Promise<void> {
        void pi; // reserved by the pinned signature — see the doc comment
        const result = await ctx.ui.custom<FlightsCatalogResult>(
                (_tui, theme, _keybindings, done) =>
                        new FlightsCatalogComponent({ flights: firstFlightCatalog(), selected: 0, theme, done }),
        );
        if (result === undefined) {
                return; // Esc — dismissed for this session only.
        }
        if (result === "never-again") {
                writeOnboardingState({ ...readOnboardingState(home), flightsDismissed: true }, home);
                return;
        }
        // A pick: the custom() promise resolves after the editor slot was
        // restored (showExtensionCustom's close → restoreEditor → resolve), so
        // the prefill lands in the real editor, then the footer hint says what
        // to do with it. The hint is cleared by the input handler on the first
        // real message.
        ctx.ui.setEditorText(result.prompt);
        setStatusLine(ctx, "flights", "press Enter to send — or edit the prompt first");
}

// ---------------------------------------------------------------------------
// The extension
// ---------------------------------------------------------------------------

/**
 * Create the First flights extension. Registered in cli.ts's extensionFactories
 * (same inline-extension shape as the addons/checkpoints extensions).
 */
export function createFirstFlightsExtension(options: FirstFlightsOptions) {
        const autoShow = options.autoShow ?? true;
        const home = options.home;

        const factory = (pi: ExtensionAPI): void => {
                // One auto-show per process: session_start also fires for /new,
                // /resume and /reload (each with its own reason), and only the
                // FIRST interactive boot may replace the editor with the card.
                let shownThisProcess = false;
                // One rotating tip per process — a second session_start (test
                // harnesses, exotic embedders) never doubles the hint.
                let tipShownThisProcess = false;
                // firstTaskAt is written at most once per process (this flag)
                // and never over an existing value (the original timestamp of
                // the user's very first task is the point of the field).
                let latched = false;
                // The flying tip is only for the process that WATCHED the
                // first-ever task happen (the input handler actually wrote
                // firstTaskAt just now) — a value left over from an earlier
                // session never sets this flag.
                let firstTaskLatchedThisProcess = false;
                // The flying tip fires at most once per process, even before
                // the onboarding state is read again.
                let flyingShownThisProcess = false;

                pi.on("session_start", (event, ctx) => {
                        if (!autoShow) return;
                        if (event?.reason !== "startup") return;
                        if (!ctx?.hasUI || ctx?.mode !== "tui") return;
                        const state = readOnboardingState(home);
                        if (!state.firstTaskAt && !state.flightsDismissed) {
                                // The fresh boot: the catalog card owns this
                                // session. One onboarding surface per boot —
                                // never also a rotating tip.
                                if (shownThisProcess) return;
                                shownThisProcess = true;
                                // Fire-and-forget with a silent catch: the catalog is
                                // cosmetic — a failure must NEVER break boot.
                                void showCatalog(pi, ctx, home).catch(() => {
                                        /* the card is best-effort */
                                });
                                return;
                        }
                        // The returning boot (firstTaskAt set OR flightsDismissed
                        // — the catalog's own "not fresh" conditions): show
                        // exactly one unseen rotating tip instead. An
                        // exhausted list means onboarding has said its piece.
                        if (tipShownThisProcess) return;
                        const tip = nextSessionTip(state.tipsSeen);
                        if (!tip) return;
                        tipShownThisProcess = true;
                        writeOnboardingState({ ...state, tipsSeen: [...state.tipsSeen, tip.id] }, home);
                        notifyLine(ctx, tip.text);
                });

                pi.on("agent_settled", (_event, ctx) => {
                        // AgentSettledEvent carries no payload — the timing is
                        // the signal: the first task has fully settled (no
                        // retry, compaction or continuation pending).
                        if (!firstTaskLatchedThisProcess) return;
                        if (flyingShownThisProcess) return;
                        if (!ctx?.hasUI || ctx?.mode !== "tui") return;
                        flyingShownThisProcess = true;
                        const state = readOnboardingState(home);
                        if (state.tipsSeen.includes(FLYING_TIP_ID)) return;
                        writeOnboardingState({ ...state, tipsSeen: [...state.tipsSeen, FLYING_TIP_ID] }, home);
                        notifyLine(ctx, flyingTipText());
                });

                pi.on("input", (event, ctx) => {
                        const text = typeof event?.text === "string" ? event.text : "";
                        if (event?.source !== "interactive" || !text.trim()) return;
                        // The prefilled prompt IS the first real message — the
                        // hint has done its job either way (no-op when unset).
                        setStatusLine(ctx, "flights", undefined);
                        if (latched) return;
                        latched = true;
                        const state = readOnboardingState(home);
                        if (!state.firstTaskAt) {
                                writeOnboardingState({ ...state, firstTaskAt: new Date().toISOString() }, home);
                                // This process watched the first-ever task
                                // happen — the flying tip may fire when that
                                // task settles on agent_settled.
                                firstTaskLatchedThisProcess = true;
                        }
                });

                pi.registerCommand("flights", {
                        description: "Reopen the First flights starter catalog",
                        handler: async (_args: string | undefined, ctx: ExtensionContext) => {
                                if (!ctx.hasUI || ctx.mode !== "tui") {
                                        ctx.ui.notify(
                                                "First flights lives inside the TUI — run `unown` and press /flights.",
                                                "info",
                                        );
                                        return;
                                }
                                // Manual reopen never flips any latch — a
                                // dismissed user can still browse the catalog.
                                await showCatalog(pi, ctx, home);
                        },
                });
        };

        return { name: "unown-first-flights", factory, hidden: true } as const;
}
