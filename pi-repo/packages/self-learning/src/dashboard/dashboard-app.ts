/**
* dashboard-app.ts — the TUI dashboard's root shell: header band, sidebar +
* main content, footer with per-screen keybinding hints, confirm bar, toasts,
* command palette (`:`) and help overlay (`?`).
*
* Mount shapes (docs/tui-dashboard-plan.md §2, §5):
*   standalone — dashboard-boot.ts constructs it as the alt-screen layout root
*                (the layout engine hands it the full viewport; render returns
*                exactly viewport-height rows for a full-bleed frame).
*   embedded   — tools.ts mounts it via ctx.ui.custom(…, { overlay: false })
*                (the editor-replacing screen pattern); Esc-Esc or q returns.
*
* Rendering is manual line composition (k9s discipline): the app owns the
* viewport height, scrolls its own offsets, and returns exactly the rows it
* wants — no layout-engine height ambiguity between the two mounts. All color
* flows through the Theme instance so the brand theme, user themes and the
* 256-color ladder apply unchanged.
*/

import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";
import { matchesKey, SelectList, type SelectItem, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { DashboardStore } from "./dashboard-data.ts";
import type { OverviewResponse } from "./dashboard-types.ts";
import type { Screen, ScreenDeps, ScreenSpec } from "./screen.ts";
import { toneToken, trunc, type Tone } from "./widgets/bits.ts";
import { createOverviewScreen } from "./screens/overview-screen.ts";
import { createMemoryScreen } from "./screens/memory-screen.ts";
import { createDreamsScreen } from "./screens/dreams-screen.ts";
import { createNotesScreen } from "./screens/notes-screen.ts";
import { createSkillsScreen } from "./screens/skills-screen.ts";
import { createLabScreen } from "./screens/lab-screen.ts";
import { createHooksScreen } from "./screens/hooks-screen.ts";
import { createRouterScreen } from "./screens/router-screen.ts";
import { createGatewayScreen } from "./screens/gateway-screen.ts";
import { createAutomationsScreen } from "./screens/automations-screen.ts";
import { createWebCacheScreen } from "./screens/webcache-screen.ts";

export interface DashboardAppOptions {
	theme: Theme;
	store: DashboardStore;
	/** Mounted inside a live session? (Esc-Esc exits instead of owning the process.) */
	embedded: boolean;
	/** Called when the user exits (standalone: process shutdown; embedded: done()). */
	onExit: () => void;
	/** Initial screen id (deep-link support: /memory, /dreams, …). */
	initialScreen?: string;
}

/** The registry — sidebar order IS the product statement: learning first. */
export const SCREEN_SPECS: ScreenSpec[] = [
	{ id: "overview", title: "Overview", group: "learning", resources: ["overview", "tasks"] },
	{ id: "memory", title: "Memory", group: "learning", resources: ["memory", "memoryProjects"] },
	{ id: "dreams", title: "Dreams", group: "learning", resources: ["dreams", "overview"] },
	{ id: "notes", title: "Notes", group: "learning", resources: ["notes", "overview"] },
	{ id: "skills", title: "Skills", group: "learning", resources: ["skills"] },
	{ id: "lab", title: "Learning Lab", group: "learning", resources: ["cycles", "improvements", "runs", "tasks"] },
	{ id: "hooks", title: "Hooks", group: "learning", resources: ["hooks"] },
	{ id: "router", title: "Router", group: "learning", resources: ["jobs", "sandboxes"] },
	{ id: "gateway", title: "Gateway", group: "operations", resources: ["bridge"] },
	{ id: "automations", title: "Automations", group: "operations", resources: ["automations"] },
	{ id: "webcache", title: "Web Cache", group: "operations", resources: ["webcache"] },
]

/* Provider management is terminal-only by the owner's call (the M4/M5 web
 * surface was unwound in 473a7d5): the registry lives in the `unown
 * providers` CLI and the in-session /providers command — not a dashboard
 * screen. The header still shows the engine's active provider from
 * /api/overview. */

/** Key accelerators for the first ten screens (1..9, 0). */
const ACCELERATORS: Record<string, number> = {
	"1": 0,
	"2": 1,
	"3": 2,
	"4": 3,
	"5": 4,
	"6": 5,
	"7": 6,
	"8": 7,
	"9": 8,
	"0": 9,
};

export class DashboardApp {
	private tui: TUI;
	private opts: DashboardAppOptions;
	private theme: Theme;
	private store: DashboardStore;
	private screens = new Map<string, Screen>();
	private activeId: string;
	private isFocused = false;
	private lastEscapeAt = 0;
	private toastState: { text: string; tone: Tone; until: number } | null = null;
	private toastTimer: ReturnType<typeof setTimeout> | null = null;
	private confirmState: { question: string; action: () => void | Promise<void> } | null = null;
	private palette: OverlayHandle | null = null;
	private helpOverlay: OverlayHandle | null = null;
	private clockTimer: ReturnType<typeof setInterval> | null = null;
	private unsub: () => void = () => {};

	constructor(tui: TUI, opts: DashboardAppOptions) {
		this.tui = tui;
		this.opts = opts;
		this.theme = opts.theme;
		this.store = opts.store;
		this.activeId =
			opts.initialScreen && SCREEN_SPECS.some((s) => s.id === opts.initialScreen)
				? opts.initialScreen
				: "overview";
		this.unsub = this.store.subscribe(() => this.invalidate());
		// A soft clock so the header's LIVE indicator and ages stay honest even
		// when the engine is idle (renders are cheap; 1/30s is invisible).
		this.clockTimer = setInterval(() => this.invalidate(), 30_000);
	}

	// ---- Component contract ----

	render(width: number): string[] {
		const rows = this.viewportRows();
		const header = this.renderHeader(width);
		const footer = this.renderFooter(width);
		const contentH = Math.max(1, rows - header.length - footer.length);
		const content = this.renderContent(width, contentH);
		return [...header, ...content, ...footer];
	}

	invalidate(): void {
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		// Confirm bar owns everything while pending.
		if (this.confirmState) {
			if (matchesKey(data, "y")) {
				const { action } = this.confirmState;
				this.confirmState = null;
				void Promise.resolve(action()).catch((e) => this.toast(`failed: ${(e as Error).message}`, "rose"));
			} else if (matchesKey(data, "n") || matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
				this.confirmState = null;
			}
			this.invalidate();
			return;
		}
		if (matchesKey(data, "ctrl+c")) {
			this.exit();
			return;
		}
		// Text-input escape hatch: while a screen's inline field is capturing
		// (compose note, provider form, cron field…), every key except the
		// force-quit goes to the screen — global accelerators would eat "q",
		// digits, "r", "[", ":" mid-typing.
		if (this.activeScreen()?.wantsTextInput?.()) {
			this.activeScreen()?.handleKey(data);
			this.invalidate();
			return;
		}
		if (matchesKey(data, "q")) {
			this.exit();
			return;
		}
		if (matchesKey(data, "escape")) {
			// Embedded: double-Esc exits; single Esc falls through to the screen
			// (drill-out). Overlays close themselves via their own focus path.
			const now = Date.now();
			if (this.opts.embedded && now - this.lastEscapeAt < 400) {
				this.exit();
				return;
			}
			this.lastEscapeAt = now;
		}
		if (matchesKey(data, ":")) {
			this.openPalette();
			return;
		}
		if (matchesKey(data, "?")) {
			this.openHelp();
			return;
		}
		if (matchesKey(data, "shift+r")) {
			this.refreshActive();
			return;
		}
		if (matchesKey(data, "[") || matchesKey(data, "left")) {
			this.stepScreen(-1);
			return;
		}
		if (matchesKey(data, "]") || matchesKey(data, "right")) {
			this.stepScreen(1);
			return;
		}
		const accel = ACCELERATORS[data];
		if (accel !== undefined && accel < SCREEN_SPECS.length) {
			this.setScreen(SCREEN_SPECS[accel]!.id);
			return;
		}
		// Screen-local keys.
		const screen = this.activeScreen();
		if (screen?.handleKey(data)) {
			this.invalidate();
			return;
		}
		this.invalidate();
	}

	// The Focusable contract (no text cursor — the marker is never emitted).
	set focused(v: boolean) {
		this.isFocused = v;
	}
	get focused(): boolean {
		return this.isFocused;
	}

	// ---- lifecycle ----

	start(): void {
		this.setScreen(this.activeId);
	}

	dispose(): void {
		this.unsub();
		if (this.clockTimer) clearInterval(this.clockTimer);
		if (this.toastTimer) clearTimeout(this.toastTimer);
		this.palette?.hide();
		this.helpOverlay?.hide();
		this.palette = null;
		this.helpOverlay = null;
		for (const screen of this.screens.values()) screen.onDeactivate?.();
	}

	private exit(): void {
		this.dispose();
		this.opts.onExit();
	}

	// ---- helpers for screens ----

	private deps(): ScreenDeps {
		return {
			store: this.store,
			theme: this.theme,
			toast: (text, tone) => this.toast(text, tone),
			requestRender: () => this.invalidate(),
			openScreen: (id) => this.setScreen(id),
			confirm: (question, action) => {
				this.confirmState = { question, action };
				this.invalidate();
			},
			embedded: this.opts.embedded,
		};
	}

	private activeScreen(): Screen | undefined {
		return this.screens.get(this.activeId);
	}

	private factory(id: string): ((deps: ScreenDeps) => Screen) | undefined {
		switch (id) {
			case "overview":
				return createOverviewScreen;
			case "memory":
				return createMemoryScreen;
			case "dreams":
				return createDreamsScreen;
			case "notes":
				return createNotesScreen;
			case "skills":
				return createSkillsScreen;
			case "lab":
				return createLabScreen;
			case "hooks":
				return createHooksScreen;
			case "router":
				return createRouterScreen;
			case "gateway":
				return createGatewayScreen;
			case "automations":
				return createAutomationsScreen;
			case "webcache":
				return createWebCacheScreen;
			default:
				return undefined;
		}
	}

	setScreen(id: string): void {
		if (id === this.activeId && this.screens.has(id)) return;
		const prev = this.activeScreen();
		prev?.onDeactivate?.();
		this.activeId = id;
		let screen = this.screens.get(id);
		if (!screen) {
			const make = this.factory(id);
			if (!make) return;
			screen = make(this.deps());
			this.screens.set(id, screen);
		}
		const spec = SCREEN_SPECS.find((s) => s.id === id);
		if (spec) this.store.setActiveResources(spec.resources);
		screen.onActivate?.();
		this.invalidate();
	}

	private stepScreen(delta: number): void {
		const idx = SCREEN_SPECS.findIndex((s) => s.id === this.activeId);
		const next = (idx + delta + SCREEN_SPECS.length) % SCREEN_SPECS.length;
		this.setScreen(SCREEN_SPECS[next]!.id);
	}

	private refreshActive(): void {
		const spec = SCREEN_SPECS.find((s) => s.id === this.activeId);
		if (spec) for (const r of spec.resources) void this.store.refresh(r);
		this.toast("refreshing…", "zinc");
	}

	toast(text: string, tone: Tone = "emerald"): void {
		this.toastState = { text, tone, until: Date.now() + 3500 };
		if (this.toastTimer) clearTimeout(this.toastTimer);
		this.toastTimer = setTimeout(() => {
			this.toastState = null;
			this.invalidate();
		}, 3600);
		this.invalidate();
	}

	private viewportRows(): number {
		try {
			const rows = (this.tui as unknown as { terminal?: { rows?: number } }).terminal?.rows;
			if (typeof rows === "number" && rows > 0) {
				// Standalone owns the whole viewport; embedded shares it with the
				// chat (a compact dashboard, the transcript keeps its space).
				return this.opts.embedded ? Math.max(12, Math.min(rows - 12, 24)) : rows;
			}
		} catch {
			/* fall through */
		}
		return this.opts.embedded ? 18 : 30;
	}

	// ---- rendering ----

	private renderHeader(width: number): string[] {
		const brand = this.theme.fg("accent", "◆ unown");
		const dash = this.theme.fg("muted", "dashboard");
		const conn = this.store.connection;
		const connGlyph = conn === "up" ? "●" : conn === "reconnecting" ? "◐" : conn === "down" ? "○" : "◌";
		const connTone: Tone = conn === "up" ? "emerald" : conn === "down" ? "rose" : "amber";
		const connText = this.theme.fg(toneToken(connTone), `${connGlyph} engine ${conn}`);
		const ov = this.store.snapshot<OverviewResponse>("overview").data;
		let bridgeText = "";
		if (ov?.agent?.bridge) {
			const b = ov.agent.bridge;
			bridgeText = this.theme.fg(b.ok ? "success" : "error", `${b.ok ? "●" : "✗"} bridge`);
		}
		const busy = ov?.routerBusy ? this.theme.fg("warning", "⧗ busy") : "";
		const parts = [`${brand} ${dash}`, connText, bridgeText, busy].filter(Boolean);
		const left = parts.join(this.theme.fg("dim", " · "));
		const now = new Date();
		const clock = this.theme.fg(
			"dim",
			`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
		);
		const model = ov ? this.theme.fg("muted", trunc(ov.agent.provider, 30)) : "";
		const right = [model, clock].filter(Boolean).join(" ");
		return [this.joinEnds(width, left, right), this.theme.fg("borderMuted", "─".repeat(Math.max(1, width)))];
	}

	private renderFooter(width: number): string[] {
		if (this.confirmState) {
			const q = this.theme.fg("warning", `? ${this.confirmState.question}`);
			const keys = this.theme.fg("muted", "y confirm · n cancel");
			return [this.joinEnds(width, q, keys)];
		}
		if (this.toastState) {
			return [this.theme.fg(toneToken(this.toastState.tone), `▸ ${this.toastState.text}`)];
		}
		const screen = this.activeScreen();
		const hints = (screen?.footerHints() ?? []).map(
			([k, label]) => `${this.theme.fg("accent", k)} ${this.theme.fg("muted", label)}`,
		);
		const global = `${this.theme.fg("accent", ":")} ${this.theme.fg("muted", "palette")} ${this.theme.fg("accent", "?")} ${this.theme.fg("muted", "help")} ${this.theme.fg("accent", "[ ]")} ${this.theme.fg("muted", "screens")}`;
		const left = trunc([...hints, global].join(this.theme.fg("dim", " · ")), Math.max(10, width - 14));
		const exit = this.theme.fg("dim", this.opts.embedded ? "esc-esc chat" : "q quit");
		return [this.joinEnds(width, left, exit)];
	}

	private joinEnds(width: number, left: string, right: string): string {
		const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
		return `${left}${" ".repeat(gap)}${right}`;
	}

	private renderContent(width: number, height: number): string[] {
		const SIDEBAR_W = 22;
		const mainW = Math.max(10, width - SIDEBAR_W - 1);
		const h = Math.max(1, height);
		const screen = this.activeScreen();
		// Tell the active screen its viewport so it can size scroll windows.
		screen?.setViewport(h);
		const sidebarLines = this.renderSidebar(SIDEBAR_W, h);
		let mainLines: string[];
		try {
			mainLines = screen ? screen.render(mainW) : [this.theme.fg("dim", "no screen")];
		} catch (e) {
			mainLines = [this.theme.fg("error", `screen render failed: ${(e as Error).message}`)];
		}
		while (sidebarLines.length < h) sidebarLines.push("");
		while (mainLines.length < h) mainLines.push("");
		if (sidebarLines.length > h) sidebarLines.length = h;
		if (mainLines.length > h) mainLines.length = h;
		const sep = this.theme.fg("borderMuted", "│");
		const lines: string[] = [];
		for (let i = 0; i < h; i++) {
			lines.push(`${sidebarLines[i] ?? ""}${sep}${mainLines[i] ?? ""}`);
		}
		return lines;
	}

	private renderSidebar(width: number, height: number): string[] {
		const lines: string[] = [];
		let currentGroup = "";
		SCREEN_SPECS.forEach((spec, i) => {
			if (spec.group !== currentGroup) {
				currentGroup = spec.group;
				const label = currentGroup === "learning" ? "LEARNING" : "OPERATIONS";
				lines.push("", this.theme.fg("dim", ` ${label}`));
			}
			const active = spec.id === this.activeId;
			const num = i < 9 ? `${i + 1}` : i === 9 ? "0" : "·";
			const prefix = active ? this.theme.fg("accent", "▌") : " ";
			const numLab = this.theme.fg("dim", num);
			const title = active ? this.theme.fg("accent", spec.title) : this.theme.fg("muted", spec.title);
			lines.push(trunc(`${prefix}${numLab} ${title}`, width));
		});
		// Loop-state summary pinned to the sidebar's foot.
		const ov = this.store.snapshot<OverviewResponse>("overview").data;
		if (ov) {
			lines.push("");
			lines.push(this.theme.fg("dim", " ── loop state"));
			lines.push(this.theme.fg("muted", trunc(` notes ${ov.kpis.notes.pending} pending`, width)));
			lines.push(this.theme.fg("muted", trunc(` dreams ${ov.kpis.dreams}`, width)));
			lines.push(this.theme.fg("muted", trunc(` shipped ${ov.kpis.improvementsShipped}`, width)));
		}
		return lines;
	}

	// ---- overlays ----

	private overlaySelectTheme() {
		return {
			selectedPrefix: () => this.theme.fg("accent", "▸ "),
			selectedText: (t: string) => this.theme.fg("text", t),
			description: (t: string) => this.theme.fg("muted", t),
			scrollInfo: (t: string) => this.theme.fg("dim", t),
			noMatch: (t: string) => this.theme.fg("dim", t),
			background: (l: string) => this.theme.bg("overlayBg", l),
		};
	}

	private openPalette(): void {
		if (this.palette) return;
		const items: SelectItem[] = [];
		for (const [i, spec] of SCREEN_SPECS.entries()) {
			const num = i < 9 ? `${i + 1}` : i === 9 ? "0" : " ";
			items.push({
				value: `screen:${spec.id}`,
				label: `${num} ${spec.title}`,
				description: spec.group === "learning" ? "the learning loop" : "engine operations",
			});
		}
		items.push(
			{ value: "action:refresh", label: "refresh active screen", description: "refetch now (r)" },
			{ value: "action:dream", label: "run AutoDream now", description: "consolidate pending notes" },
			{ value: "action:sync", label: "sync note outbox", description: "drain queued terminal notes" },
		);
		const list = new SelectList(items, 10, this.overlaySelectTheme());
		list.onSelect = (item) => {
			this.palette?.hide();
			this.palette = null;
			if (item.value === "action:refresh") {
				this.refreshActive();
			} else if (item.value === "action:dream") {
				void this.store
					.runDream()
					.then((r) =>
						this.toast(
							r.started ? "autodream started" : (r.skipped ?? r.error ?? "dream not started"),
							r.started ? "emerald" : "amber",
						),
					);
			} else if (item.value === "action:sync") {
				void this.store.syncNotes().then((r) => this.toast(`${r.synced} notes synced`, "zinc"));
			} else if (item.value.startsWith("screen:")) {
				this.setScreen(item.value.slice("screen:".length));
			}
		};
		list.onCancel = () => {
			this.palette?.hide();
			this.palette = null;
		};
		this.palette = this.tui.showOverlay(list, {
			width: "50%",
			maxHeight: "60%",
			anchor: "center",
		});
	}

	private openHelp(): void {
		if (this.helpOverlay) return;
		const t = this.theme;
		const rows: string[] = [
			t.fg("mdHeading", "unown dashboard — keys"),
			"",
			`${t.fg("accent", "1…9 0")}     jump to screen       ${t.fg("accent", "[ ] / ← →")}   prev / next screen`,
			`${t.fg("accent", "j k ↑ ↓")}     move selection       ${t.fg("accent", "g G")}        top / bottom`,
			`${t.fg("accent", "PgUp PgDn")}   page up / down       ${t.fg("accent", "enter")}      open selection`,
			`${t.fg("accent", "esc")}       back / close         ${t.fg("accent", "R")}          refresh screen`,
			`${t.fg("accent", ":")}        command palette      ${t.fg("accent", "?")}          this help`,
			"",
			t.fg("muted", "screen-local keys are announced in the footer"),
			t.fg("dim", this.opts.embedded ? "esc-esc or q returns to the chat" : "q or ctrl+c quits"),
		];
		let handle: OverlayHandle | null = null;
		const card = {
			render: (w: number) => rows.map((r) => trunc(r, Math.max(10, w - 2))),
			invalidate: () => {},
			handleInput: () => {
				handle?.hide();
				handle = null;
				this.helpOverlay = null;
				this.invalidate();
			},
		};
		handle = this.tui.showOverlay(card as never, {
			width: "64%",
			maxHeight: "60%",
			anchor: "center",
		});
		this.helpOverlay = handle;
	}
}
