import { type Component, truncateToWidth, visibleWidth, type ViewportTier, viewportTier } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

/**
 * SelectorHints (round 5, R4) — a one-line keybinding hint strip that
 * degrades by priority instead of wrapping.
 *
 * Selectors render "in place of the editor" at the full terminal width; at
 * narrow widths a long fixed hint line ("Enter to select · Ctrl+S to set as
 * default · Esc to cancel") wraps onto a second line mid-word. This
 * component drops trailing segments — the caller orders them from most to
 * least essential — and only ever truncates the final surviving segment,
 * with an ellipsis, never a bare wrap.
 */
export class SelectorHints implements Component {
        private readonly segments: string[];
        private readonly minTierForExtras: ViewportTier;

        /**
         * @param segments hint fragments, most essential first ("Enter to
         *   select" must survive every width; the tail drops first).
         * @param minTierForExtras the tier at which segments beyond the first
         *   may render at all (default: every tier — the width fit loop alone
         *   decides). Pass "regular" to keep selectors to the bare essentials
         *   below 80 columns.
         */
        constructor(segments: string[], minTierForExtras: ViewportTier = "narrow") {
                this.segments = segments;
                this.minTierForExtras = minTierForExtras;
        }

        render(width: number): string[] {
                const tier = viewportTier(width);
                const eligible =
                        tier === "narrow" && this.minTierForExtras !== "narrow" ? this.segments.slice(0, 1) : this.segments;

                // Admit segments while the joined line fits; the tail drops first.
                let line = "";
                for (const segment of eligible) {
                        const candidate = line ? `${line} · ${segment}` : `  ${segment}`;
                        if (visibleWidth(candidate) > width) break;
                        line = candidate;
                }
                if (!line) {
                        // Width below even the first segment: truncate it with an ellipsis.
                        line = truncateToWidth(`  ${eligible[0] ?? ""}`, width, "…");
                }
                return [theme.fg("dim", line)];
        }

        invalidate(): void {}
}
