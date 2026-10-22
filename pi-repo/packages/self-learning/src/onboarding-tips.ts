/**
 * onboarding-tips.ts — the post-first-task onboarding tips (pure core).
 *
 * Onboarding 2.1's quiet second beat. The First flights catalog (flights.ts)
 * gets a fresh user to their first real task; these tips are what may land
 * AFTER that moment — the "You're flying" line the instant the first-ever
 * task settles (shown by the flights.ts extension on agent_settled) and one
 * rotating tip per returning boot until the list is exhausted. Both are
 * one-time-ever.
 *
 * The Hermes posture: say the useful thing once, latch that it was said,
 * then stay silent forever. The latch is onboarding.json's tipsSeen array
 * (onboarding-state.ts, schema 1) — every tip id is persisted the moment it
 * is displayed, so a tip can never repeat across sessions. Tips render as
 * quiet in-transcript status lines (ctx.ui.notify(text, "info")) — never
 * dialogs, never overlays, never blocking, and never LLM context: they cost
 * nothing if missed and interrupt nothing if read.
 *
 * ZERO pi/tui imports — the flights-core.ts posture: this file must stay
 * importable anywhere (CLI, TUI, tests) without dragging the pi/tui/term
 * import graphs along. The flying tip is deliberately NOT part of the
 * rotating session list: it is a moment in time (the first task settling),
 * not a boot-time hint, and nextSessionTip() must never return it.
 */

// ---------------------------------------------------------------------------
// The tips
// ---------------------------------------------------------------------------

export interface OnboardingTip {
        /** Stable id — persisted in onboarding.json's tipsSeen when shown. */
        id: string;
        /** The exact line rendered via ctx.ui.notify(text, "info"). */
        text: string;
}

/** The "You're flying" tip's id (latched in tipsSeen like any other tip). */
export const FLYING_TIP_ID = "flying";

/**
 * The line shown once, right after the user's FIRST-EVER real task settles.
 * PINNED COPY — the bytes must not drift; test/flights-tips.test.ts pins them.
 */
export function flyingTipText(): string {
        return "You're flying — the first task is done. /flights has more starters · /help lists everything · ctrl+k searches commands.";
}

/**
 * The rotating session-start tips, in show order (one unseen id per boot).
 * PINNED COPY — ids and texts must not drift; test/flights-tips.test.ts pins
 * them. A fresh array of fresh objects on every call, so no caller can
 * poison the list by mutating the result.
 */
export function sessionTips(): OnboardingTip[] {
        return [
                {
                        id: "undo",
                        text: "Tip — /undo reverts the last turn's file changes; /checkpoint snapshots before a risky edit.",
                },
                {
                        id: "palette",
                        text: "Tip — ctrl+k opens the command palette; every command is one search away.",
                },
                {
                        id: "plan",
                        text: "Tip — /plan explores read-only first, then proposes a numbered plan you approve before execution.",
                },
                {
                        id: "memory",
                        text: "Tip — sessions leave notes for tomorrow: .unown/memory/project.md remembers what mattered.",
                },
        ];
}

/**
 * The next unseen rotating tip: the first sessionTips() entry in list order
 * whose id is not in `seen`, or null when the list is exhausted (unknown ids
 * in `seen` are simply ignored, and the seen order is irrelevant). NEVER the
 * flying tip: it is not part of the rotating list, and the guard below keeps
 * that promise true even if a future edit adds it by mistake.
 */
export function nextSessionTip(seen: readonly string[]): OnboardingTip | null {
        const seenIds = new Set(seen);
        for (const tip of sessionTips()) {
                if (tip.id === FLYING_TIP_ID) continue; // structurally excluded — kept defensive
                if (!seenIds.has(tip.id)) return tip;
        }
        return null;
}
