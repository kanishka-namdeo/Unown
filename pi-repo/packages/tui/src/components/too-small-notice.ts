import { visibleWidth } from "../utils.ts";
import { MIN_TERMINAL_COLS, MIN_TERMINAL_ROWS } from "../viewport-tiers.ts";

/**
 * The "terminal too small" notice (round 5, R2).
 *
 * When the fullscreen layout cannot fit (below MIN_TERMINAL_COLS x
 * MIN_TERMINAL_ROWS) the renderer shows this instead of a broken layout.
 * It is a gate on *layout*, not on the process: the component tree stays
 * alive and the session resumes untouched when the terminal grows again.
 *
 * Plain text only — no theme, no ANSI — so it renders identically in plain
 * mode, NO_COLOR, and 16-color terminals.
 */

function centerLine(text: string, width: number): string {
        const textWidth = visibleWidth(text);
        if (textWidth >= width) {
                return text.slice(0, Math.max(0, width));
        }
        const left = Math.floor((width - textWidth) / 2);
        return " ".repeat(left) + text;
}

/** Render the notice screen for a too-small terminal of `width` x `height`. */
export function renderTooSmallNotice(width: number, height: number): string[] {
        const lines: string[] = [];
        const needs = `${MIN_TERMINAL_COLS}x${MIN_TERMINAL_ROWS}`;
        const have = `${width}x${height}`;
        const body: string[] = [
                "terminal too small",
                `unown needs at least ${needs}`,
                `currently ${have}`,
                "resize to resume - session kept",
        ];

        // Vertical centering (top-weighted so a 1-row terminal still shows the first line).
        const top = Math.max(0, Math.floor((height - body.length) / 2));
        lines.push(...new Array(top).fill(""));
        for (const line of body) {
                lines.push(centerLine(line, width));
        }
        while (lines.length < height) lines.push("");
        return lines.slice(0, height);
}
