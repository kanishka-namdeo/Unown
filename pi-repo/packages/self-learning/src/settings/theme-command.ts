/**
 * settings/theme-command.ts — the `/theme` command (Toccata round A13).
 *
 * Claude Code's `/theme` contract (the commands reference): "Change the color
 * theme." Unown's theme surface is the settings hub's Interface → Theme row;
 * `/theme` is its alias. The picker previews each theme live while you
 * navigate (in-memory theme instances — nothing persists until Enter),
 * Enter commits through the same `ctx.ui.setTheme(name)` write the hub row
 * makes, and Esc restores the theme you started from. `/theme <name>`
 * switches directly, which also works headless.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, Theme } from "@earendil-works/pi-tui";
import { currentThemeSetting } from "./registry.ts";

interface ThemePickerResult {
        committed: boolean;
        theme: string;
}

/**
 * The live-preview picker. `preview` is called on every selection move (the
 * host applies an in-memory theme instance); `done(undefined)` means Esc (the
 * host restores the original), `done({committed, theme})` means Enter.
 */
export class ThemePickerComponent implements Component {
        private readonly themes: Array<{ name: string; path?: string }>;
        private readonly current: string;
        private readonly preview: (name: string) => void;
        private readonly done: (result: ThemePickerResult | undefined) => void;
        private readonly theme: Theme;
        private selected: number;
        private settled = false;

        constructor(options: {
                themes: Array<{ name: string; path?: string }>;
                current: string;
                theme: Theme;
                preview: (name: string) => void;
                done: (result: ThemePickerResult | undefined) => void;
        }) {
                this.themes = options.themes;
                this.current = options.current;
                this.theme = options.theme;
                this.preview = options.preview;
                this.done = options.done;
                this.selected = Math.max(
                        0,
                        this.themes.findIndex((candidate) => candidate.name === this.current),
                );
        }

        invalidate(): void {}

        private settle(result: ThemePickerResult | undefined): void {
                if (this.settled) return;
                this.settled = true;
                this.done(result);
        }

        handleInput(data: string): void {
                const current = this.themes[this.selected]?.name;
                if (data === "up" || data === "k" || data === "\x1b[A") {
                        this.selected = Math.max(0, this.selected - 1);
                } else if (data === "down" || data === "j" || data === "\x1b[B") {
                        this.selected = Math.min(this.themes.length - 1, this.selected + 1);
                } else if (data === "home") {
                        this.selected = 0;
                } else if (data === "end") {
                        this.selected = this.themes.length - 1;
                } else if (data === "enter" || data === "\n" || data === "\r") {
                        const name = this.themes[this.selected]?.name;
                        if (name) this.settle({ committed: true, theme: name });
                        return;
                } else if (data === "escape" || data === "\x1b" || data === "\x03") {
                        this.settle(undefined);
                        return;
                } else {
                        return;
                }
                const next = this.themes[this.selected]?.name;
                if (next && next !== current) this.preview(next);
        }

        render(width: number): string[] {
                const lines: string[] = [];
                lines.push(this.theme.fg("accent", this.theme.bold("Theme — live preview (Enter to keep · Esc to restore)")));
                lines.push("");
                for (let index = 0; index < this.themes.length; index++) {
                        const entry = this.themes[index]!;
                        const isSelected = index === this.selected;
                        const isCurrent = entry.name === this.current;
                        const marker = isSelected ? "→ " : "  ";
                        const label = `${entry.name}${isCurrent ? "  (current)" : ""}`;
                        lines.push(isSelected ? this.theme.fg("accent", marker + label) : this.theme.fg("text", marker + label));
                }
                return lines;
        }
}

export function registerThemeCommand(pi: ExtensionAPI): void {
        pi.registerCommand("theme", {
                description: "Change the colour theme — live preview while you navigate; /theme <name> switches directly",
                handler: async (args: string | undefined, ctx: ExtensionContext) => {
                        const trimmed = (args ?? "").trim();
                        const themes = ctx.ui.getAllThemes();
                        const originalSetting = currentThemeSetting();
                        const current = originalSetting?.includes("/") ? "" : (originalSetting ?? "");

                        if (trimmed) {
                                const match = themes.find((entry) => entry.name === trimmed);
                                if (!match) {
                                        ctx.ui.notify(
                                                `Unknown theme "${trimmed}" — available: ${themes.map((t) => t.name).join(", ")}`,
                                                "warning",
                                        );
                                        return;
                                }
                                const result = ctx.ui.setTheme(match.name);
                                ctx.ui.notify(result.success ? `Theme: ${match.name}` : `Theme switch failed: ${result.error ?? "unknown error"}`, result.success ? "info" : "error");
                                return;
                        }

                        if (!ctx.hasUI || ctx.mode !== "tui" || themes.length === 0) {
                                ctx.ui.notify(
                                        `The theme picker needs a TTY. Themes: ${themes.map((t) => t.name).join(", ")} — /theme <name> switches directly.`,
                                        "info",
                                );
                                return;
                        }

                        let activeInstance: Theme | undefined;
                        const result = await ctx.ui.custom<ThemePickerResult | undefined>((tui, theme, _keybindings, done) => {
                                activeInstance = theme;
                                // Preview through in-memory theme instances: `setTheme(Theme)`
                                // never persists (only the string form writes the setting), so
                                // arrowing through the list leaves settings.json untouched.
                                const preview = (name: string) => {
                                        const instance = ctx.ui.getTheme(name);
                                        if (instance) {
                                                ctx.ui.setTheme(instance);
                                                tui.requestRender();
                                        }
                                };
                                return new ThemePickerComponent({ themes, current, theme, preview, done });
                        });
                        if (result === undefined) {
                                // Esc: restore the theme the picker started from. A plain
                                // setting restores by name (the string form — same value, no
                                // effective write); an automatic composite restores the active
                                // instance captured when the picker opened.
                                if (originalSetting && !originalSetting.includes("/")) {
                                        ctx.ui.setTheme(originalSetting);
                                } else if (activeInstance) {
                                        ctx.ui.setTheme(activeInstance);
                                }
                                ctx.ui.notify(`Theme unchanged (${current || "automatic"})`, "info");
                                return;
                        }
                        if (!result.committed) return;
                        // Commit through the same write the hub's theme row makes: the
                        // string form applies AND persists the setting.
                        const commit = ctx.ui.setTheme(result.theme);
                        if (!commit.success) {
                                ctx.ui.notify(`Theme switch failed: ${commit.error ?? "unknown error"}`, "error");
                                return;
                        }
                        ctx.ui.notify(`Theme: ${result.theme}`, "info");
                },
        });
}
