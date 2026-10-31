/**
 * Multi-line editor component for extensions.
 * Supports Ctrl+G for external editor.
 */

import {
	Container,
	Editor,
	type EditorOptions,
	type Focusable,
	getKeybindings,
	Spacer,
	Text,
	type TUI,
} from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "../../../core/keybindings.ts";
import { editInExternalEditor } from "../external-editor.ts";
import { getEditorTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint } from "./keybinding-hints.ts";

export class ExtensionEditorComponent extends Container implements Focusable {
	private editor: Editor;
	private onSubmitCallback: (value: string) => void;
	private onCancelCallback: () => void;
	private tui: TUI;
	private keybindings: KeybindingsManager;
	private externalEditorCommand: string;
	/** Content as last loaded (prefill or external-editor round trip).
	 * Escaping with edits on top of this requires a second cancel key. */
	private savedText: string;
	/** True between the first cancel key on a dirty editor and the next
	 * non-cancel keypress — the "press Esc again to discard" arm state. */
	private discardArmed = false;
	private hintText: Text;

	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.editor.focused = value;
	}

	constructor(
		tui: TUI,
		keybindings: KeybindingsManager,
		title: string,
		prefill: string | undefined,
		onSubmit: (value: string) => void,
		onCancel: () => void,
		options?: EditorOptions,
		externalEditorCommand?: string,
	) {
		super();

		this.tui = tui;
		this.keybindings = keybindings;
		this.externalEditorCommand =
			externalEditorCommand ||
			process.env.VISUAL ||
			process.env.EDITOR ||
			(process.platform === "win32" ? "notepad" : "nano");
		this.onSubmitCallback = onSubmit;
		this.onCancelCallback = onCancel;

		// Add top border
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Add title
		this.addChild(new Text(theme.fg("accent", title), 1, 0));
		this.addChild(new Spacer(1));

		// Create editor
		this.editor = new Editor(tui, getEditorTheme(), options);
		if (prefill) {
			this.editor.setText(prefill);
		}
		this.savedText = this.editor.getText();
		// Wire up Enter to submit (Shift+Enter for newlines, like the main editor)
		this.editor.onSubmit = (text: string) => {
			this.savedText = text;
			this.onSubmitCallback(text);
		};
		this.addChild(this.editor);

		this.addChild(new Spacer(1));

		// Add hint (rebuilt in place when the discard guard arms)
		this.hintText = new Text(this.buildHint(false), 1, 0);
		this.addChild(this.hintText);

		this.addChild(new Spacer(1));

		// Add bottom border
		this.addChild(new DynamicBorder());
	}

	private buildHint(discardArmed: boolean): string {
		const base =
			keyHint("tui.select.confirm", "submit") +
			"  " +
			keyHint("tui.input.newLine", "newline") +
			"  " +
			keyHint("tui.select.cancel", discardArmed ? "again to discard" : "cancel") +
			`  ${keyHint("app.editor.external", "external editor")}`;
		return discardArmed ? `${base}  — unsaved edits` : base;
	}

	private isDirty(): boolean {
		return this.editor.getText() !== this.savedText;
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		// Escape or Ctrl+C to cancel — three cases, most specific first:
		if (kb.matches(keyData, "tui.select.cancel")) {
			// 1. The inner editor's autocomplete is open: this key closes the
			//    autocomplete (the main editor's own pattern) instead of
			//    killing the whole dialog.
			if (this.editor.isShowingAutocomplete()) {
				this.editor.handleInput(keyData);
				return;
			}
			// 2. Unsaved edits: a stray cancel key must not silently discard
			//    minutes of plan editing. The first press arms (hint flips to
			//    "Esc again to discard"); any other keypress disarms; the
			//    second consecutive press discards. No timer — deterministic.
			if (this.isDirty()) {
				if (this.discardArmed) {
					this.onCancelCallback();
					return;
				}
				this.discardArmed = true;
				this.hintText.setText(this.buildHint(true));
				return;
			}
			// 3. Clean editor: cancel immediately, as before.
			this.onCancelCallback();
			return;
		}

		if (this.discardArmed) {
			this.discardArmed = false;
			this.hintText.setText(this.buildHint(false));
		}

		// External editor (app keybinding)
		if (this.keybindings.matches(keyData, "app.editor.external")) {
			void this.handleOpenExternalEditor();
			return;
		}

		// Forward to editor
		this.editor.handleInput(keyData);
	}

	private async handleOpenExternalEditor(): Promise<void> {
		const content = this.editor.getText();
		this.tui.stop();
		try {
			const result = await editInExternalEditor({
				command: this.externalEditorCommand,
				content,
			});
			if (result.status === "complete") {
				this.editor.setText(result.content);
				this.savedText = result.content;
			}
		} finally {
			this.tui.start();
			this.tui.requestRender(true);
		}
	}
}
