import { type KeyId, matchesKey } from "./keys.ts";

/**
 * Global keybinding registry.
 * Downstream packages can add keybindings via declaration merging.
 */
export interface Keybindings {
        // Editor navigation and editing
        "tui.editor.cursorUp": true;
        "tui.editor.cursorDown": true;
        "tui.editor.historyPrevious": true;
        "tui.editor.historyNext": true;
        "tui.editor.cursorLeft": true;
        "tui.editor.cursorRight": true;
        "tui.editor.cursorWordLeft": true;
        "tui.editor.cursorWordRight": true;
        "tui.editor.cursorLineStart": true;
        "tui.editor.cursorLineEnd": true;
        "tui.editor.jumpForward": true;
        "tui.editor.jumpBackward": true;
        "tui.editor.pageUp": true;
        "tui.editor.pageDown": true;
        "tui.editor.deleteCharBackward": true;
        "tui.editor.deleteCharForward": true;
        "tui.editor.deleteWordBackward": true;
        "tui.editor.deleteWordForward": true;
        "tui.editor.deleteToLineStart": true;
        "tui.editor.deleteToLineEnd": true;
        "tui.editor.yank": true;
        "tui.editor.yankPop": true;
        "tui.editor.undo": true;
        // Generic input actions
        "tui.input.newLine": true;
        "tui.input.submit": true;
        "tui.input.tab": true;
        "tui.input.copy": true;
        // Generic selection actions
        "tui.select.up": true;
        "tui.select.down": true;
        "tui.select.pageUp": true;
        "tui.select.pageDown": true;
        "tui.select.confirm": true;
        "tui.select.cancel": true;
        "tui.select.first": true;
        "tui.select.last": true;
        // Alternate-screen viewport navigation
        "tui.altScreen.pageUp": true;
        "tui.altScreen.pageDown": true;
        "tui.altScreen.halfPageUp": true;
        "tui.altScreen.halfPageDown": true;
        "tui.altScreen.lineUp": true;
        "tui.altScreen.lineDown": true;
        "tui.altScreen.previousPrompt": true;
        "tui.altScreen.nextPrompt": true;
        "tui.altScreen.search": true;
        "tui.altScreen.searchNext": true;
        "tui.altScreen.searchPrevious": true;
        "tui.altScreen.searchClose": true;
        "tui.altScreen.top": true;
        "tui.altScreen.bottom": true;
        // Transcript mode (the Claude Code Ctrl+O viewer lane, Toccata round)
        "tui.altScreen.transcript": true;
        "tui.altScreen.transcriptExit": true;
        "tui.altScreen.transcriptHelp": true;
        "tui.altScreen.transcriptPrevPrompt": true;
        "tui.altScreen.transcriptNextPrompt": true;
        "tui.altScreen.transcriptSearch": true;
        "tui.altScreen.transcriptSearchNext": true;
        "tui.altScreen.transcriptSearchPrevious": true;
        "tui.altScreen.transcriptLineUp": true;
        "tui.altScreen.transcriptLineDown": true;
        "tui.altScreen.transcriptHalfPageUp": true;
        "tui.altScreen.transcriptHalfPageDown": true;
        "tui.altScreen.transcriptPageUp": true;
        "tui.altScreen.transcriptPageDown": true;
        "tui.altScreen.transcriptTop": true;
        "tui.altScreen.transcriptBottom": true;
        "tui.altScreen.transcriptWriteScrollback": true;
        "tui.altScreen.transcriptOpenEditor": true;
}

export type Keybinding = keyof Keybindings;

export interface KeybindingDefinition {
        defaultKeys: KeyId | KeyId[];
        description?: string;
}

export type KeybindingDefinitions = Record<string, KeybindingDefinition>;
export type KeybindingsConfig = Record<string, KeyId | KeyId[] | undefined>;

export const TUI_KEYBINDINGS = {
        "tui.editor.cursorUp": { defaultKeys: "up", description: "Move cursor up" },
        "tui.editor.cursorDown": { defaultKeys: "down", description: "Move cursor down" },
        "tui.editor.historyPrevious": {
                defaultKeys: [],
                description: "Select previous prompt history entry",
        },
        "tui.editor.historyNext": {
                defaultKeys: [],
                description: "Select next prompt history entry",
        },
        "tui.editor.cursorLeft": {
                defaultKeys: ["left", "ctrl+b"],
                description: "Move cursor left",
        },
        "tui.editor.cursorRight": {
                defaultKeys: ["right", "ctrl+f"],
                description: "Move cursor right",
        },
        "tui.editor.cursorWordLeft": {
                defaultKeys: ["alt+left", "ctrl+left", "alt+b"],
                description: "Move cursor word left",
        },
        "tui.editor.cursorWordRight": {
                defaultKeys: ["alt+right", "ctrl+right", "alt+f"],
                description: "Move cursor word right",
        },
        "tui.editor.cursorLineStart": {
                defaultKeys: ["home", "ctrl+home", "ctrl+a"],
                description: "Move to line start",
        },
        "tui.editor.cursorLineEnd": {
                defaultKeys: ["end", "ctrl+end", "ctrl+e"],
                description: "Move to line end",
        },
        "tui.editor.jumpForward": {
                defaultKeys: "ctrl+]",
                description: "Jump forward to character",
        },
        "tui.editor.jumpBackward": {
                defaultKeys: "ctrl+alt+]",
                description: "Jump backward to character",
        },
        "tui.editor.pageUp": { defaultKeys: ["pageUp", "ctrl+pageUp"], description: "Page up" },
        "tui.editor.pageDown": { defaultKeys: ["pageDown", "ctrl+pageDown"], description: "Page down" },
        "tui.editor.deleteCharBackward": {
                defaultKeys: "backspace",
                description: "Delete character backward",
        },
        "tui.editor.deleteCharForward": {
                defaultKeys: ["delete", "ctrl+d"],
                description: "Delete character forward",
        },
        "tui.editor.deleteWordBackward": {
                defaultKeys: ["ctrl+w", "alt+backspace"],
                description: "Delete word backward",
        },
        "tui.editor.deleteWordForward": {
                defaultKeys: ["alt+d", "alt+delete"],
                description: "Delete word forward",
        },
        "tui.editor.deleteToLineStart": {
                defaultKeys: "ctrl+u",
                description: "Delete to line start",
        },
        "tui.editor.deleteToLineEnd": {
                defaultKeys: "ctrl+k",
                description: "Delete to line end",
        },
        "tui.editor.yank": { defaultKeys: "ctrl+y", description: "Yank" },
        "tui.editor.yankPop": { defaultKeys: "alt+y", description: "Yank pop" },
        "tui.editor.undo": { defaultKeys: "ctrl+-", description: "Undo" },
        "tui.input.newLine": { defaultKeys: ["shift+enter", "ctrl+j"], description: "Insert newline" },
        "tui.input.submit": { defaultKeys: "enter", description: "Submit input" },
        "tui.input.tab": { defaultKeys: "tab", description: "Tab / autocomplete" },
        "tui.input.copy": { defaultKeys: "ctrl+c", description: "Copy selection" },
        "tui.select.up": { defaultKeys: "up", description: "Move selection up" },
        "tui.select.down": { defaultKeys: "down", description: "Move selection down" },
        "tui.select.pageUp": { defaultKeys: "pageUp", description: "Selection page up" },
        "tui.select.pageDown": {
                defaultKeys: "pageDown",
                description: "Selection page down",
        },
        "tui.select.confirm": { defaultKeys: "enter", description: "Confirm selection" },
        "tui.select.cancel": {
                defaultKeys: ["escape", "ctrl+c"],
                description: "Cancel selection",
        },
        "tui.select.first": {
                defaultKeys: "home",
                description: "Selection to first item",
        },
        "tui.select.last": {
                defaultKeys: "end",
                description: "Selection to last item",
        },
        // These intentionally shadow the unmodified editor bindings in fullscreen mode.
        "tui.altScreen.pageUp": {
                defaultKeys: "pageUp",
                description: "Scroll viewport up one page",
        },
        "tui.altScreen.pageDown": {
                defaultKeys: "pageDown",
                description: "Scroll viewport down one page",
        },
        "tui.altScreen.halfPageUp": {
                defaultKeys: [],
                description: "Scroll viewport up half a page",
        },
        "tui.altScreen.halfPageDown": {
                defaultKeys: [],
                description: "Scroll viewport down half a page",
        },
        "tui.altScreen.lineUp": {
                defaultKeys: [],
                description: "Scroll viewport up one line",
        },
        "tui.altScreen.lineDown": {
                defaultKeys: [],
                description: "Scroll viewport down one line",
        },
        "tui.altScreen.previousPrompt": {
                defaultKeys: ["ctrl+shift+up", "ctrl+up"],
                description: "Jump to previous semantic prompt",
        },
        "tui.altScreen.nextPrompt": {
                defaultKeys: ["ctrl+shift+down", "ctrl+down"],
                description: "Jump to next semantic prompt",
        },
        "tui.altScreen.search": {
                defaultKeys: "ctrl+shift+f",
                description: "Search the primary scroll view",
        },
        "tui.altScreen.searchNext": {
                defaultKeys: ["enter", "ctrl+g"],
                description: "Select the next search match",
        },
        "tui.altScreen.searchPrevious": {
                defaultKeys: ["shift+enter", "ctrl+shift+g"],
                description: "Select the previous search match",
        },
        "tui.altScreen.searchClose": {
                defaultKeys: "escape",
                description: "Close transcript search",
        },
        "tui.altScreen.top": { defaultKeys: "home", description: "Scroll viewport to top" },
        "tui.altScreen.bottom": { defaultKeys: "end", description: "Scroll viewport to bottom" },
        // Transcript mode — the modal review view (Claude Code's Ctrl+O
        // transcript viewer contract, Toccata round A9). These bindings are
        // matched ONLY while transcript mode is active (and the toggle below),
        // so the bare symbol/letter keys never shadow editor typing.
        "tui.altScreen.transcript": {
                defaultKeys: "ctrl+o",
                description: "Toggle transcript mode (expanded review view)",
        },
        "tui.altScreen.transcriptExit": {
                defaultKeys: ["q", "escape", "ctrl+c"],
                description: "Exit transcript mode",
        },
        "tui.altScreen.transcriptHelp": {
                defaultKeys: "?",
                description: "Toggle the transcript keyboard-help panel",
        },
        "tui.altScreen.transcriptPrevPrompt": {
                defaultKeys: "{",
                description: "Jump to the previous user prompt",
        },
        "tui.altScreen.transcriptNextPrompt": {
                defaultKeys: "}",
                description: "Jump to the next user prompt",
        },
        "tui.altScreen.transcriptSearch": {
                defaultKeys: "/",
                description: "Search the transcript",
        },
        "tui.altScreen.transcriptSearchNext": {
                defaultKeys: "n",
                description: "Next search match",
        },
        "tui.altScreen.transcriptSearchPrevious": {
                defaultKeys: "shift+n",
                description: "Previous search match",
        },
        "tui.altScreen.transcriptLineUp": {
                defaultKeys: ["k", "up"],
                description: "Scroll up one line",
        },
        "tui.altScreen.transcriptLineDown": {
                defaultKeys: ["j", "down"],
                description: "Scroll down one line",
        },
        "tui.altScreen.transcriptHalfPageUp": {
                defaultKeys: "ctrl+u",
                description: "Scroll up half a page",
        },
        "tui.altScreen.transcriptHalfPageDown": {
                defaultKeys: "ctrl+d",
                description: "Scroll down half a page",
        },
        "tui.altScreen.transcriptPageUp": {
                defaultKeys: ["ctrl+b", "b"],
                description: "Scroll up one page",
        },
        "tui.altScreen.transcriptPageDown": {
                defaultKeys: ["ctrl+f", "space"],
                description: "Scroll down one page",
        },
        "tui.altScreen.transcriptTop": {
                defaultKeys: ["g", "home"],
                description: "Jump to the top",
        },
        "tui.altScreen.transcriptBottom": {
                defaultKeys: ["shift+g", "end"],
                description: "Jump to the bottom",
        },
        "tui.altScreen.transcriptWriteScrollback": {
                defaultKeys: "[",
                description: "Write the conversation to the terminal scrollback",
        },
        "tui.altScreen.transcriptOpenEditor": {
                defaultKeys: "v",
                description: "Open the conversation in $VISUAL/$EDITOR",
        },
} as const satisfies KeybindingDefinitions;

export interface KeybindingConflict {
        key: KeyId;
        keybindings: string[];
}

// ---------------------------------------------------------------------------
// Binding-key string validation (the Da capo round, R15)
// ---------------------------------------------------------------------------

/**
 * Named (non-single-character) key identifiers a binding string may name.
 * Mirrors the keys `parseKeyId`/`matchesKey` understand. A single alphanumeric
 * or symbol character is always a valid key name.
 */
const NAMED_BINDING_KEYS = new Set([
        "escape",
        "esc",
        "tab",
        "enter",
        "return",
        "backspace",
        "delete",
        "insert",
        "space",
        "up",
        "down",
        "left",
        "right",
        "home",
        "end",
        "pageup",
        "pagedown",
        "kpenter",
        "kp0",
        "kp1",
        "kp2",
        "kp3",
        "kp4",
        "kp5",
        "kp6",
        "kp7",
        "kp8",
        "kp9",
        "kpadd",
        "kpsubtract",
        "kpmultiply",
        "kpdivide",
        "kpdecimal",
        ...Array.from({ length: 24 }, (_, i) => `f${i + 1}`),
]);

/** Canonical modifier spellings; aliases normalize onto them. */
const MODIFIER_ALIASES: Record<string, string> = {
        control: "ctrl",
        option: "alt",
        meta: "super",
        cmd: "super",
        win: "super",
};

export interface ValidatedBindingKey {
        valid: boolean;
        /** The normalized key id (aliases resolved) when valid. */
        normalized?: string;
        /** Human-readable reason when invalid. */
        error?: string;
}

/**
 * Validate one user-supplied binding key string (Da capo R15 — Claude Code
 * v2.1.323's contract: "a misspelled keybinding modifier, such as `ctl+k`,
 * binding the bare key; the binding is now ignored").
 *
 * Before this, `ctl+k` parsed as the bare `k` (parseKeyId takes the last
 * `+`-separated token as the key and only recognizes the exact modifier
 * spellings) — a silent footgun that rebound a printable key. Now unknown
 * modifier tokens and unknown key names invalidate the binding, and the
 * common alias spellings (control/option/meta/cmd/win) normalize instead.
 * Programmatic callers keep passing canonical ids; this is a load-time gate.
 */
export function validateBindingKey(keyId: string): ValidatedBindingKey {
        const raw = keyId.trim().toLowerCase();
        if (!raw) return { valid: false, error: "empty key" };
        const parts = raw.split("+").map((part) => part.trim()).filter(Boolean);
        if (parts.length === 0) return { valid: false, error: `"${keyId}" has no key` };
        const keyName = parts[parts.length - 1]!;
        const canonical: string[] = [];
        for (const part of parts.slice(0, -1)) {
                if (part === "ctrl" || part === "shift" || part === "alt" || part === "super") {
                        canonical.push(part);
                        continue;
                }
                const alias = MODIFIER_ALIASES[part];
                if (alias) {
                        canonical.push(alias);
                        continue;
                }
                return {
                        valid: false,
                        error: `"${part}" in "${keyId}" is not a known modifier (ctrl, shift, alt, super)`,
                };
        }
        if (!/^[a-z0-9]$/.test(keyName) && !NAMED_BINDING_KEYS.has(keyName) && keyName.length !== 1) {
                return {
                        valid: false,
                        error: `"${keyName}" in "${keyId}" is not a known key name`,
                };
        }
        if (keyName.length === 1 && !/^[a-z0-9!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]$/.test(keyName)) {
                return { valid: false, error: `"${keyName}" in "${keyId}" is not a printable key` };
        }
        return { valid: true, normalized: [...canonical, keyName].join("+") };
}

function normalizeKeys(keys: KeyId | KeyId[] | undefined): KeyId[] {
        if (keys === undefined) return [];
        const keyList = Array.isArray(keys) ? keys : [keys];
        const seen = new Set<KeyId>();
        const result: KeyId[] = [];
        for (const key of keyList) {
                if (!seen.has(key)) {
                        seen.add(key);
                        result.push(key);
                }
        }
        return result;
}

export class KeybindingsManager {
        private definitions: KeybindingDefinitions;
        private userBindings: KeybindingsConfig;
        private keysById = new Map<Keybinding, KeyId[]>();
        private conflicts: KeybindingConflict[] = [];

        constructor(definitions: KeybindingDefinitions, userBindings: KeybindingsConfig = {}) {
                this.definitions = definitions;
                this.userBindings = userBindings;
                this.rebuild();
        }

        private rebuild(): void {
                this.keysById.clear();
                this.conflicts = [];

                const userClaims = new Map<KeyId, Set<Keybinding>>();
                for (const [keybinding, keys] of Object.entries(this.userBindings)) {
                        if (!(keybinding in this.definitions)) continue;
                        for (const key of normalizeKeys(keys)) {
                                const claimants = userClaims.get(key) ?? new Set<Keybinding>();
                                claimants.add(keybinding as Keybinding);
                                userClaims.set(key, claimants);
                        }
                }

                for (const [key, keybindings] of userClaims) {
                        if (keybindings.size > 1) {
                                this.conflicts.push({ key, keybindings: [...keybindings] });
                        }
                }

                for (const [id, definition] of Object.entries(this.definitions)) {
                        const userKeys = this.userBindings[id];
                        const keys = userKeys === undefined ? normalizeKeys(definition.defaultKeys) : normalizeKeys(userKeys);
                        this.keysById.set(id as Keybinding, keys);
                }
        }

        matches(data: string, keybinding: Keybinding): boolean {
                const keys = this.keysById.get(keybinding) ?? [];
                for (const key of keys) {
                        if (matchesKey(data, key)) return true;
                }
                return false;
        }

        getKeys(keybinding: Keybinding): KeyId[] {
                return [...(this.keysById.get(keybinding) ?? [])];
        }

        getDefinition(keybinding: Keybinding): KeybindingDefinition {
                return this.definitions[keybinding];
        }

        getConflicts(): KeybindingConflict[] {
                return this.conflicts.map((conflict) => ({ ...conflict, keybindings: [...conflict.keybindings] }));
        }

        setUserBindings(userBindings: KeybindingsConfig): void {
                this.userBindings = userBindings;
                this.rebuild();
        }

        getUserBindings(): KeybindingsConfig {
                return { ...this.userBindings };
        }

        getResolvedBindings(): KeybindingsConfig {
                const resolved: KeybindingsConfig = {};
                for (const id of Object.keys(this.definitions)) {
                        const keys = this.keysById.get(id as Keybinding) ?? [];
                        resolved[id] = keys.length === 1 ? keys[0]! : [...keys];
                }
                return resolved;
        }
}

let globalKeybindings: KeybindingsManager | null = null;

export function setKeybindings(keybindings: KeybindingsManager): void {
        globalKeybindings = keybindings;
}

export function getKeybindings(): KeybindingsManager {
        if (!globalKeybindings) {
                globalKeybindings = new KeybindingsManager(TUI_KEYBINDINGS);
        }
        return globalKeybindings;
}
