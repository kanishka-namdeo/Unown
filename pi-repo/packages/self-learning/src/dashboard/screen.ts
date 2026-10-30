/**
 * dashboard/screen.ts — the screen contract every dashboard screen implements
 * and the shared selection/scroll math (k9s-style: the app shell owns the
 * viewport; screens render rows and move a cursor).
 *
 * A screen is a plain Component plus:
 *   - footerHints(): the footer's key → label vocabulary for this screen
 *   - onActivate()/onDeactivate(): fast-lane polling + focus side effects
 *   - handleKey(data): consume a key the shell did not (returns true when
 *     consumed) — the shell calls it with raw terminal input data
 *   - onOpen?(): a detail-drill hook the app calls when Enter arrives while
 *     the sidebar is not focused (screens may instead handle Enter themselves)
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { DashboardStore, ResourceId } from "./dashboard-data.ts";
import type { Tone } from "./widgets/bits.ts";

export interface ScreenSpec {
	/** Registry id ("overview", "memory", …). */
	id: string;
	/** Sidebar label (short noun). */
	title: string;
	/** Sidebar group — the learning loop first, machinery after. */
	group: "learning" | "operations";
	/** Resources polled on the fast lane while this screen is active. */
	resources: ResourceId[];
}

export interface ScreenDeps {
	store: DashboardStore;
	theme: Theme;
	/** Transient footer toast (auto-expires). */
	toast: (text: string, tone?: Tone) => void;
	/** Ask the app shell to repaint. */
	requestRender: () => void;
	/** Open another screen by id. */
	openScreen: (id: string) => void;
	/** y/N confirm bar (destructive-action gate). */
	confirm: (question: string, action: () => void | Promise<void>) => void;
	/** True when mounted inside a live session (Esc-Esc exits, not q). */
	embedded: boolean;
}

export interface Screen extends Component {
	footerHints(): [string, string][];
	onActivate?(): void;
	onDeactivate?(): void;
	/** Consume a key the shell passed through. Return true when consumed. */
	handleKey(data: string): boolean;
	/** The app tells the screen its viewport height before render; the screen
	 * sizes its scroll windows and returns at most this many rows. */
	setViewport(height: number): void;
	/** True while an inline text field is capturing input (compose, forms).
	 * The shell then forwards EVERY key except ctrl+c to the screen instead
	 * of consuming its global accelerators — typing "0 9 * * 1" into a cron
	 * field must never switch screens. */
	wantsTextInput?(): boolean;
}

/** Shared selection/scroll window math: keep `selected` visible inside a
 * `view`-row window, moving the window only when necessary. */
export class SelectionWindow {
	selected = 0;
	scroll = 0;
	readonly count: () => number;
	readonly view: () => number;

	constructor(count: () => number, view: () => number) {
		this.count = count;
		this.view = view;
	}

	move(delta: number): boolean {
		const n = this.count();
		if (n === 0) return false;
		const next = Math.max(0, Math.min(n - 1, this.selected + delta));
		if (next === this.selected) return false;
		this.selected = next;
		this.ensureVisible();
		return true;
	}

	ensureVisible(): void {
		const view = Math.max(1, this.view());
		if (this.selected < this.scroll) this.scroll = this.selected;
		else if (this.selected >= this.scroll + view) this.scroll = this.selected - view + 1;
		// Never scroll past the last page.
		const n = this.count();
		this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, n - view)));
	}

	page(delta: number): boolean {
		const view = Math.max(1, this.view());
		return this.move(delta * Math.max(1, view - 1));
	}

	home(): boolean {
		if (this.selected === 0) return false;
		this.selected = 0;
		this.scroll = 0;
		return true;
	}

	end(): boolean {
		const n = this.count();
		if (n === 0 || this.selected === n - 1) return false;
		this.selected = n - 1;
		this.ensureVisible();
		return true;
	}

	/** Reset after a data refresh (keeps the cursor when the list is stable). */
	resync(): void {
		const n = this.count();
		if (this.selected >= n) this.selected = Math.max(0, n - 1);
		this.ensureVisible();
	}
}
