import type { AutocompleteProvider } from "./autocomplete.ts";
import type { Component } from "./tui.ts";

/**
 * Interface for custom editor components.
 *
 * This allows extensions to provide their own editor implementation
 * (e.g., vim mode, emacs mode, custom keybindings) while maintaining
 * compatibility with the core application.
 */
export interface EditorComponent extends Component {
        // =========================================================================
        // Core text access (required)
        // =========================================================================

        /** Get the current text content */
        getText(): string;

        /** Set the text content */
        setText(text: string): void;

        /** Handle raw terminal input (key presses, paste sequences, etc.) */
        handleInput(data: string): void;

        // =========================================================================
        // Callbacks (required)
        // =========================================================================

        /** Called when user submits (e.g., Enter key) */
        onSubmit?: (text: string) => void;

        /** Called when text changes */
        onChange?: (text: string) => void;

        // =========================================================================
        // History support (optional)
        // =========================================================================

        /** Add text to history for up/down navigation */
        addToHistory?(text: string): void;

        /** Seed history with persisted entries (newest first; dedup by text). */
        seedHistory?(entries: string[]): void;

        /** Read-only view of the in-session history (newest first). */
        getHistoryEntries?(): string[];

        /** Save a restorable snapshot of the editor state (draft stash lane). */
        saveEditorState?(): import("./components/editor.ts").EditorStateSnapshot;

        /** Restore a snapshot from saveEditorState (paste markers intact). */
        restoreEditorState?(snapshot: import("./components/editor.ts").EditorStateSnapshot): void;

        /**
         * Insert an image chip — `[Image #N]` — referencing a pasted image
         * (atomic cursor unit, expands to the file path on submit).
         */
        insertImageChip?(path: string): number;

        // =========================================================================
        // Advanced text manipulation (optional)
        // =========================================================================

        /** Insert text at current cursor position */
        insertTextAtCursor?(text: string): void;

        /**
         * Get text with any markers expanded (e.g., paste markers).
         * Falls back to getText() if not implemented.
         */
        getExpandedText?(): string;

        // =========================================================================
        // Autocomplete support (optional)
        // =========================================================================

        /** Set the autocomplete provider */
        setAutocompleteProvider?(provider: AutocompleteProvider): void;

        // =========================================================================
        // Appearance (optional)
        // =========================================================================

        /** Border color function */
        borderColor?: (str: string) => string;

        /** The border style while focused (the /color session accent overrides both; Da capo R9). */
        focusBorderColor?: (str: string) => string;

        /** Mode badge rendered inline on the top border (e.g. "bash", "thinking high") */
        borderBadge?: string;

        /** Styling for the mode badge */
        borderBadgeColor?: (str: string) => string;

        /** Set horizontal padding */
        setPaddingX?(padding: number): void;

        /** Set max visible items in autocomplete dropdown */
        setAutocompleteMaxVisible?(maxVisible: number): void;
}
