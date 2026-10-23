/**
 * btw-overlay.ts — the dismissible TUI surface for /btw answers.
 *
 * A bordered, dim-styled answer card mounted via ctx.ui.custom (the
 * questionnaire mount pattern): the question as a header line, the answer
 * word-wrapped, an Esc/Enter/q-to-dismiss hint. The overlay owns NO state
 * beyond its text — the side-channel lane (btw.ts) guarantees nothing is
 * written to the session, so dismissal is pure UI teardown.
 *
 * Component contract (pi-tui): render(width) → lines, optional
 * handleInput(data), invalidate(). Any dismiss key calls done() exactly
 * once (settled guard); unknown keys are ignored (the overlay is modal by
 * construction — ui.custom owns focus while mounted).
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export interface BtwOverlayOptions {
        header: string;
        answer: string;
        theme: Theme;
        keybindings: { matches(data: string, key: string): boolean } | undefined;
        done: () => void;
}

export class BtwOverlay {
        private readonly header: string;
        private readonly answer: string;
        private readonly theme: Theme;
        private readonly keybindings: { matches(data: string, key: string): boolean } | undefined;
        private readonly done: () => void;
        private settled = false;

        constructor(options: BtwOverlayOptions) {
                this.header = options.header;
                this.answer = options.answer;
                this.theme = options.theme;
                this.keybindings = options.keybindings;
                this.done = options.done;
        }

        private dismiss(): void {
                if (this.settled) return;
                this.settled = true;
                this.done();
        }

        render(width: number): string[] {
                const contentWidth = Math.max(width - 4, 20);
                const lines: string[] = [];
                lines.push(this.theme.fg("accent", `── ${this.header} ──`));
                lines.push("");
                for (const line of wrapTextWithAnsi(this.answer, contentWidth)) {
                        lines.push(line.length ? line : "");
                }
                lines.push("");
                lines.push(this.theme.fg("dim", "esc / enter / q — dismiss · never enters the transcript"));
                return lines;
        }

        handleInput(data: string): void {
                if (this.settled) return;
                const isDismiss =
                        data === "\x1b" || // bare Esc
                        data === "\r" ||
                        data === "\n" ||
                        data === "q" ||
                        data === "Q";
                if (isDismiss) {
                        this.dismiss();
                        return;
                }
                // Keybinding-layer dismiss (e.g. a custom quit chord) when the
                // host passed a binding set; matchesKey tolerates undefined.
                try {
                        if (matchesKey(data, "escape") || (this.keybindings && this.keybindings.matches(data, "quit"))) {
                                this.dismiss();
                        }
                } catch {
                        /* unknown key shapes are ignored */
                }
        }

        invalidate(): void {
                /* stateless render — nothing to invalidate */
        }
}
