import { getKeybindings } from "../keybindings.ts";
import type { Keybinding } from "../keybindings.ts";
import type { Component } from "../tui.ts";
import { truncateToWidth, visibleWidth } from "../utils.ts";

/**
 * Transcript mode chrome (Toccata round A9 — the Claude Code Ctrl+O
 * transcript-viewer lane). Two non-capturing overlays: a persistent hint
 * bar naming the mode's keys, and the `?` keyboard-help panel. Both read
 * the live keybinding registry at render time so user rebinds are honored
 * without a reload — the same config-live discipline as the main `?`
 * palette.
 */

function formatKeyList(id: Keybinding): string {
        const keys = getKeybindings().getKeys(id);
        if (keys.length === 0) return "—";
        return keys.join("/");
}

function dim(text: string): string {
        return `\x1b[2m${text}\x1b[22m`;
}

function muted(text: string): string {
        return `\x1b[2;3m${text}\x1b[23;22m`;
}

/**
 * The one-line hint bar shown while transcript mode is active. The keys are
 * resolved live from the registry; the line truncates to the overlay width.
 */
export class TranscriptModeHintComponent implements Component {
        private readonly onDismiss: () => void;

        constructor(onDismiss: () => void) {
                this.onDismiss = onDismiss;
        }

        handleInput(): void {
                // The hint bar is non-capturing: the alt screen's transcript-mode
                // input handler owns the keys. Input never reaches this component.
        }

        invalidate(): void {}

        render(width: number): string[] {
                const safeWidth = Math.max(1, width);
                const parts = [
                        `transcript`,
                        `${formatKeyList("tui.altScreen.transcriptPrevPrompt")}${formatKeyList("tui.altScreen.transcriptNextPrompt")} prompts`,
                        `${formatKeyList("tui.altScreen.transcriptSearch")} find`,
                        `${formatKeyList("tui.altScreen.transcriptWriteScrollback")} scrollback`,
                        `${formatKeyList("tui.altScreen.transcriptOpenEditor")} editor`,
                        `${formatKeyList("tui.altScreen.transcriptHelp")} keys`,
                        `${formatKeyList("tui.altScreen.transcriptExit").split("/")[0]} exit`,
                ];
                const line = parts.reduce((acc, part, index) => {
                        const segment = index === 0 ? muted(part) : `${dim(part)}`;
                        return acc + (index === 0 ? segment : acc.length > 0 ? dim(" · ") + segment : segment);
                }, "");
                return [dim(" ") + truncateToWidth(line, Math.max(1, safeWidth - 1), "")];
        }

        /** Never used — see handleInput. Kept for interface completeness. */
        get dismiss(): () => void {
                return this.onDismiss;
        }
}

interface HelpRow {
        keys: string;
        description: string;
}

const HELP_SECTIONS: Array<{ title: string; rows: Array<{ id: Keybinding; description?: string } | { keys: string; description: string }> }> = [
        {
                title: "Navigation",
                rows: [
                        { id: "tui.altScreen.transcriptLineUp", description: "Up one line (also ↑)" },
                        { id: "tui.altScreen.transcriptLineDown", description: "Down one line (also ↓)" },
                        { id: "tui.altScreen.transcriptHalfPageUp" },
                        { id: "tui.altScreen.transcriptHalfPageDown" },
                        { id: "tui.altScreen.transcriptPageUp" },
                        { id: "tui.altScreen.transcriptPageDown" },
                        { id: "tui.altScreen.transcriptTop" },
                        { id: "tui.altScreen.transcriptBottom" },
                ],
        },
        {
                title: "Prompts & search",
                rows: [
                        { id: "tui.altScreen.transcriptPrevPrompt" },
                        { id: "tui.altScreen.transcriptNextPrompt" },
                        { id: "tui.altScreen.transcriptSearch" },
                        { id: "tui.altScreen.transcriptSearchNext" },
                        { id: "tui.altScreen.transcriptSearchPrevious" },
                ],
        },
        {
                title: "Actions",
                rows: [
                        { id: "tui.altScreen.transcriptWriteScrollback" },
                        { id: "tui.altScreen.transcriptOpenEditor" },
                ],
        },
        {
                title: "Mode",
                rows: [
                        { id: "tui.altScreen.transcriptHelp" },
                        { id: "tui.altScreen.transcript" },
                        { id: "tui.altScreen.transcriptExit" },
                ],
        },
];

/**
 * The `?` keyboard-help panel: every transcript-mode binding resolved from
 * the live registry, grouped by section, in a reverse-video titled panel.
 */
export class TranscriptHelpPanelComponent implements Component {
        handleInput(): void {
                // Non-capturing overlay — the transcript-mode input handler owns keys.
        }

        invalidate(): void {}

        render(width: number): string[] {
                const safeWidth = Math.max(20, width);
                const lines: string[] = [];
                const title = " Transcript mode ";
                const titlePad = " ".repeat(Math.max(0, safeWidth - visibleWidth(title)));
                lines.push(`\x1b[7m${title}${titlePad}\x1b[27m`);
                lines.push("");

                for (const section of HELP_SECTIONS) {
                        if (lines.length > 2) lines.push("");
                        lines.push(muted(section.title));
                        for (const row of section.rows) {
                                let keys: string;
                                let description: string;
                                if ("keys" in row) {
                                        keys = row.keys;
                                        description = row.description;
                                } else {
                                        keys = formatKeyList(row.id);
                                        description = row.description ?? getDescription(row.id);
                                }
                                lines.push(this.renderRow(keys, description, safeWidth));
                        }
                }
                return lines;
        }

        private renderRow(keys: string, description: string, width: number): string {
                const keysColumn = 16;
                const keysText = keys.length > keysColumn - 1 ? `${keys.slice(0, keysColumn - 1)}…` : keys;
                const keysCell = keysText + " ".repeat(keysColumn - visibleWidth(keysText));
                const descriptionWidth = Math.max(1, width - keysColumn);
                const descriptionText = truncateToWidth(description, descriptionWidth, "…");
                return ` ${dim(keysCell)}${descriptionText}`;
        }
}

function getDescription(id: Keybinding): string {
        return getKeybindings().getDefinition(id)?.description ?? "";
}
