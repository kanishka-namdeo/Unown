/**
 * browser/session.ts — one browser, driven over CDP, per unown session.
 *
 * Responsibilities (docs/browser-research.md D2, D5-D7, D9, D12, D13):
 *   - lazy start: launch (auto-fallback to a temp profile when the persistent
 *     one is locked) or attach to a running browser (UNOWN_BROWSER_CDP)
 *   - page/tab bookkeeping over Target.setAutoAttach flat sessions
 *   - event taps: console, network, downloads, dialogs, file choosers
 *   - the high-level action set the `browser` tool dispatches to
 *   - graceful teardown (Browser.close + SIGTERM) and a global lock so a
 *     crashed session never leaks a Chromium
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
	BROWSER_NAV_TIMEOUT_MS,
	BROWSER_SETTLE_MS,
	BROWSER_SNAPSHOT_MAX,
	BROWSER_VIEWPORT,
	defaultProfileDir,
	discoverBrowser,
	normalizeUrl,
	urlAllowed,
	type BrowserEnv,
	browserEnv,
} from "./config.ts";
import { CdpConnection, modifierBits, parseKeyCombo } from "./cdp.ts";
import { formatSnapshot, SNAPSHOT_SCRIPT, snapshotRefs, type RefEntry, type Snapshot } from "./a11y.ts";

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface PageInfo {
	sessionId: string;
	targetId: string;
	url: string;
	title: string;
	type: string;
}

export interface ConsoleEntry {
	source: "console" | "exception" | "log" | "dialog" | "download";
	level: string;
	text: string;
	ts: number;
}

export interface RequestEntry {
	url: string;
	method: string;
	resourceType: string;
	status?: number;
	failed?: boolean;
	ts: number;
}

export interface DownloadEntry {
	url: string;
	filename: string;
	state: "inprogress" | "completed" | "canceled";
	ts: number;
}

export interface SessionInfo {
	mode: "launch" | "attach";
	executable?: string;
	source?: string;
	profileDir?: string;
	tempProfile?: boolean;
	headless?: boolean;
	wsUrl: string;
	pages: number;
	activePage?: { url: string; title: string };
	viewport: { width: number; height: number };
}

export interface ActionReport {
	/** Human one-liner, e.g. clicked "Sign in" [e12] at (431, 287). */
	summary: string;
	/** Extra detail lines (download paths, eval results, …). */
	details?: string[];
	/** Fresh snapshot text after mutations (navigate/click/type/…). */
	snapshot?: string;
	/** Current page url/title after the action. */
	url?: string;
	title?: string;
	/** Non-fatal warnings the model should see. */
	warnings?: string[];
}

// ---------------------------------------------------------------------------
// session
// ---------------------------------------------------------------------------

export class BrowserSession {
	private conn: CdpConnection | null = null;
	private started = false;
	private starting: Promise<void> | null = null;
	private pages = new Map<string, PageInfo>();
	/** sessionId of the active tab. */
	private activeSessionId: string | null = null;
	private consoleRing: ConsoleEntry[] = [];
	private requestRing: RequestEntry[] = [];
	private requestsById = new Map<string, RequestEntry>();
	private downloads: DownloadEntry[] = [];
	private lastDialog: { message: string; type: string; ts: number } | null = null;
	private pendingChooser: { backendNodeId?: number; nodeId?: number; ts: number } | null = null;
	private refs = new Map<string, RefEntry>();
	private snapshotCount = 0;
	private viewport = { ...BROWSER_VIEWPORT };
	private info: SessionInfo | null = null;
	private tempProfileUsed: string | null = null;
	private env: BrowserEnv;
	private cwd: string;
	private readonly maxConsole = 300;
	private readonly maxRequests = 200;
	private downloadDir: string | null = null;
	private disposers: Array<() => void> = [];
	private stopped = false;

	constructor(opts: { cwd?: string; env?: BrowserEnv } = {}) {
		this.cwd = opts.cwd ?? process.cwd();
		this.env = opts.env ?? browserEnv();
	}

	// ------------------------------------------------------------- lifecycle

	get isRunning(): boolean {
		return this.started && !this.conn?.isClosed;
	}

	/** Lazily ensure a connected browser. Safe to call before every action. */
	async ensureStarted(opts: { headless?: boolean } = {}): Promise<void> {
		if (this.stopped) throw new Error("browser session was stopped — start a new one (any action auto-starts)");
		if (this.started && !this.conn?.isClosed) return;
		if (this.starting) return this.starting;
		this.starting = this.start(opts).finally(() => {
			this.starting = null;
		});
		return this.starting;
	}

	private async start(opts: { headless?: boolean }): Promise<void> {
		const headless = opts.headless ?? this.env.headless;

		if (this.env.cdpUrl) {
			const conn = await CdpConnection.attach(this.env.cdpUrl);
			this.conn = conn;
			this.info = {
				mode: "attach",
				wsUrl: conn.wsUrl,
				pages: 0,
				viewport: this.viewport,
			};
			await this.afterConnect();
			this.started = true;
			return;
		}

		const found = discoverBrowser();
		let profileDir = this.env.profileDir ?? defaultProfileDir();
		let tempProfile = false;
		// D9: a locked profile means another Chromium owns it — fall back to a
		// per-process temp dir instead of failing the session.
		const lockMarkers = ["SingletonLock", "SingletonSocket", "SingletonCookie", "lockfile"];
		const locked = lockMarkers.some((m) => existsSync(join(profileDir, m)));
		if (locked && this.env.profileDir === undefined) {
			profileDir = join(tmpdir(), `unown-browser-${process.pid}`);
			tempProfile = true;
		}
		mkdirSync(profileDir, { recursive: true });
		this.downloadDir = this.cwd;

		let conn: CdpConnection;
		try {
			conn = await CdpConnection.launch({
				executablePath: found.path,
				userDataDir: profileDir,
				headless,
				windowSize: this.viewport,
			});
		} catch (err: any) {
			const msg = err instanceof Error ? err.message : String(err);
			// containers/ci often need --no-sandbox; retry once with it
			if (/exited during startup|DevTools endpoint/i.test(msg)) {
				conn = await CdpConnection.launch({
					executablePath: found.path,
					userDataDir: profileDir,
					headless,
					windowSize: this.viewport,
					extraArgs: ["--no-sandbox", "--disable-gpu"],
				}).catch((err2: any) => {
					throw new Error(
						`browser failed to start (${err2?.message ?? err2}) — if this is a container, set UNOWN_BROWSER_NO_SANDBOX=1 or run a headed desktop`,
					);
				});
			} else {
				throw err;
			}
		}
		this.conn = conn;
		this.tempProfileUsed = tempProfile ? profileDir : null;
		this.info = {
			mode: "launch",
			executable: found.path,
			source: found.source,
			profileDir,
			tempProfile,
			headless,
			wsUrl: conn.wsUrl,
			pages: 0,
			viewport: this.viewport,
		};
		await this.afterConnect();
		// the session is live from here on — ensureStarted must not relaunch
		// (a second launch on the same profile dies on the SingletonLock)
		this.started = true;
	}

	private async afterConnect(): Promise<void> {
		const conn = this.conn!;

		// ---- event taps (browser-level)
		this.disposers.push(
			conn.on("Target.attachedToTarget", (_m, p) => this.onTargetAttached(p)),
			conn.on("Target.detachedFromTarget", (_m, p) => this.onTargetDetached(p)),
		);

		// ---- downloads: route to the project cwd (D12)
		if (this.info!.mode === "launch") {
			await conn
				.send("Browser.setDownloadBehavior", {
					behavior: "allow",
					downloadPath: this.downloadDir ?? this.cwd,
					eventsEnabled: true,
				})
				.catch(() => undefined); // older chromes: per-page Page.setDownloadBehavior
		}

		// auto-attach to every page target (flatten → sessionIds on messages)
		await conn.send("Target.setAutoAttach", {
			autoAttach: true,
			waitForDebuggerOnStart: false,
			flatten: true,
		});

		// wait briefly for the initial page(s)
		const deadline = Date.now() + 10_000;
		while (this.pages.size === 0 && Date.now() < deadline) {
			await sleep(150);
		}
		if (this.pages.size === 0) {
			// create the first tab ourselves
			const { targetId } = await conn.send("Target.createTarget", { url: "about:blank" });
			const deadline2 = Date.now() + 5_000;
			while (!this.findSessionForTarget(targetId) && Date.now() < deadline2) await sleep(100);
		}
		if (!this.activeSessionId) {
			this.activeSessionId = this.pages.keys().next().value ?? null;
		}
	}

	private onTargetAttached(params: any) {
		const { sessionId, targetInfo } = params ?? {};
		if (!sessionId || !targetInfo) return;
		if (targetInfo.type !== "page") return; // ignore iframes/workers for tab mgmt (OOPIF iframes still route events)
		const page: PageInfo = {
			sessionId,
			targetId: targetInfo.targetId,
			url: targetInfo.url ?? "",
			title: targetInfo.title ?? "",
			type: targetInfo.type,
		};
		this.pages.set(sessionId, page);
		if (!this.activeSessionId) this.activeSessionId = sessionId;
		// wire per-page domains + taps. Handlers are registered BEFORE the
		// domain enables are awaited: a page that logs during its first load
		// (inline <script>) fires Runtime.consoleAPICalled between the
		// enable round-trips, and late handlers drop those events (measured:
		// 'fixture booted' went missing exactly this way).
		void (async () => {
			try {
				this.disposers.push(
					this.conn!.on("Runtime.consoleAPICalled", (_m, p, sid) => {
						if (sid !== sessionId) return;
						this.pushConsole({
							source: "console",
							level: String(p?.type ?? "log"),
							text: (p?.args ?? [])
								.map((a: any) => (a.value !== undefined ? String(a.value) : a.description ?? ""))
								.join(" ")
								.slice(0, 400),
							ts: Date.now(),
						});
					}),
					this.conn!.on("Runtime.exceptionThrown", (_m, p, sid) => {
						if (sid !== sessionId) return;
						this.pushConsole({
							source: "exception",
							level: "error",
							text: String(p?.exceptionDetails?.text ?? "") +
								(p?.exceptionDetails?.exception?.description ? ` ${p.exceptionDetails.exception.description.slice(0, 300)}` : ""),
							ts: Date.now(),
						});
					}),
					this.conn!.on("Log.entryAdded", (_m, p, sid) => {
						if (sid !== sessionId) return;
						this.pushConsole({
							source: "log",
							level: String(p?.entry?.level ?? "info"),
							text: `${p?.entry?.source ?? ""}: ${String(p?.entry?.text ?? "").slice(0, 400)}`,
							ts: Date.now(),
						});
					}),
					this.conn!.on("Page.javascriptDialogOpening", (_m, p, sid) => {
						if (sid !== sessionId) return;
						this.lastDialog = { message: String(p?.message ?? ""), type: String(p?.type ?? "alert"), ts: Date.now() };
						this.pushConsole({
							source: "dialog",
							level: "warn",
							text: `${this.lastDialog.type} dialog (auto-dismissed): ${this.lastDialog.message.slice(0, 200)}`,
							ts: Date.now(),
						});
						void this.conn!.send("Page.handleJavaScriptDialog", { accept: false }, { sessionId: sid }).catch(() => undefined);
					}),
					this.conn!.on("Page.downloadWillBegin", (_m, p, sid) => {
						if (sid !== sessionId) return;
						this.pushDownload({
							url: String(p?.url ?? ""),
							filename: String(p?.suggestedFilename ?? "download"),
							state: "inprogress",
							ts: Date.now(),
						});
					}),
					this.conn!.on("Page.downloadProgress", (_m, p, sid) => {
						if (sid !== sessionId) return;
						const state = p?.state === "completed" ? "completed" : p?.state === "canceled" ? "canceled" : "inprogress";
						this.updateDownload(state);
					}),
					this.conn!.on("Page.fileChooserOpened", (_m, p, sid) => {
						if (sid !== sessionId) return;
						this.pendingChooser = { backendNodeId: p?.backendNodeId, nodeId: p?.elementId, ts: Date.now() };
					}),
					this.conn!.on("Page.frameNavigated", (_m, p, sid) => {
						if (sid !== sessionId) return;
						const page = this.pages.get(sessionId);
						if (page && p?.frame?.parentId === undefined) {
							page.url = p.frame.url ?? page.url;
						}
					}),
					this.conn!.on("Network.requestWillBeSent", (_m, p, sid) => {
						if (sid !== sessionId) return;
						const entry: RequestEntry = {
							url: String(p?.request?.url ?? ""),
							method: String(p?.request?.method ?? "GET"),
							resourceType: String(p?.type ?? "Other"),
							ts: Date.now(),
						};
						this.requestsById.set(String(p?.requestId ?? ""), entry);
						this.requestRing.push(entry);
						if (this.requestRing.length > this.maxRequests) this.requestRing.shift();
					}),
					this.conn!.on("Network.responseReceived", (_m, p, sid) => {
						if (sid !== sessionId) return;
						const entry = this.requestsById.get(String(p?.requestId ?? ""));
						if (entry) entry.status = p?.response?.status;
					}),
					this.conn!.on("Network.loadingFailed", (_m, p, sid) => {
						if (sid !== sessionId) return;
						const entry = this.requestsById.get(String(p?.requestId ?? ""));
						if (entry) entry.failed = true;
					}),
				);
				// domains AFTER handlers are live — the race window is closed
				await this.conn!.send("Page.enable", {}, { sessionId });
				await this.conn!.send("Runtime.enable", {}, { sessionId });
				await this.conn!.send("Network.enable", {}, { sessionId });
				await this.conn!.send("Log.enable", {}, { sessionId });
				await this.conn!.send(
					"Emulation.setDeviceMetricsOverride",
					{ width: this.viewport.width, height: this.viewport.height, deviceScaleFactor: 1, mobile: false },
					{ sessionId },
				).catch(() => undefined);
			} catch {
				/* page may close mid-setup */
			}
		})();
	}

	private onTargetDetached(params: any) {
		const { sessionId } = params ?? {};
		if (!sessionId) return;
		this.pages.delete(sessionId);
		if (this.activeSessionId === sessionId) {
			this.activeSessionId = this.pages.keys().next().value ?? null;
		}
	}

	private findSessionForTarget(targetId: string): string | null {
		for (const [sid, page] of this.pages) if (page.targetId === targetId) return sid;
		return null;
	}

	private pushConsole(entry: ConsoleEntry) {
		this.consoleRing.push(entry);
		if (this.consoleRing.length > this.maxConsole) this.consoleRing.shift();
	}

	private pushDownload(entry: DownloadEntry) {
		this.downloads.push(entry);
		if (this.downloads.length > 50) this.downloads.shift();
	}

	private updateDownload(state: DownloadEntry["state"]) {
		for (let i = this.downloads.length - 1; i >= 0; i--) {
			if (this.downloads[i].state === "inprogress") {
				this.downloads[i].state = state;
				return;
			}
		}
	}

	// ------------------------------------------------------------- accessors

	sessionInfo(): SessionInfo {
		const page = this.activeSessionId ? this.pages.get(this.activeSessionId) : undefined;
		return {
			...(this.info ?? { mode: "launch" as const, wsUrl: "(not started)" }),
			pages: this.pages.size,
			activePage: page ? { url: page.url, title: page.title } : undefined,
			viewport: this.viewport,
		};
	}

	consoleEntries(level?: string): ConsoleEntry[] {
		if (!level) return [...this.consoleRing];
		const want = level.toLowerCase();
		return this.consoleRing.filter((e) => e.level.toLowerCase() === want);
	}

	requestEntries(): RequestEntry[] {
		return [...this.requestRing];
	}

	downloadEntries(): DownloadEntry[] {
		return [...this.downloads];
	}

	lastDialogInfo() {
		return this.lastDialog;
	}

	private requireConn(): CdpConnection {
		if (!this.conn || this.conn.isClosed) throw new Error("browser is not running — call any browser action to auto-start it");
		return this.conn;
	}

	private requireSessionId(): string {
		if (!this.activeSessionId) throw new Error("no open tab — create one with browser tabs new");
		return this.activeSessionId;
	}

	// ------------------------------------------------------------- primitives

	private async pageEval(expression: string, opts: { awaitPromise?: boolean; sessionId?: string } = {}): Promise<any> {
		const conn = this.requireConn();
		const sessionId = opts.sessionId ?? this.requireSessionId();
		const res = await conn.send(
			"Runtime.evaluate",
			{
				expression,
				returnByValue: true,
				awaitPromise: opts.awaitPromise ?? false,
				userGesture: true,
			},
			{ sessionId },
		);
		if (res.exceptionDetails) {
			const d = res.exceptionDetails;
			const text = d.exception?.description || d.text || "evaluation failed";
			throw new Error(`page JS error: ${String(text).slice(0, 500)}`);
		}
		return res.result?.value;
	}

	/** Wait for the page load event (bounded by BROWSER_NAV_TIMEOUT_MS). */
	private async waitForLoad(sessionId: string, timeoutMs = BROWSER_NAV_TIMEOUT_MS): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			let done = false;
			const finish = (ok: boolean) => {
				if (done) return;
				done = true;
				clearTimeout(timer);
				off();
				resolve(ok);
			};
			const off = this.conn!.on("Page.loadEventFired", (_m, _p, sid) => {
				if (sid === sessionId) finish(true);
			});
			const timer = setTimeout(() => finish(false), timeoutMs);
			timer.unref?.();
		});
	}

	private async settle(ms = BROWSER_SETTLE_MS): Promise<void> {
		await sleep(ms);
	}

	/** Take a snapshot, refresh the ref registry, return {snap, text}. */
	private async takeSnapshot(opts: { includeBoxes?: boolean } = {}): Promise<{ snap: Snapshot; text: string }> {
		const raw = await this.pageEval(`${SNAPSHOT_SCRIPT}(${JSON.stringify({
			maxNodes: BROWSER_SNAPSHOT_MAX,
			includeBoxes: opts.includeBoxes ?? false,
		})})`);
		if (!raw || typeof raw !== "object") throw new Error("snapshot failed — the page may have navigated away mid-snapshot; retry");
		const snap = raw as Snapshot;
		this.refs = snapshotRefs(snap, opts.includeBoxes ?? false);
		this.snapshotCount++;
		const page = this.activeSessionId ? this.pages.get(this.activeSessionId) : undefined;
		if (page) {
			page.url = snap.url;
			page.title = snap.title;
		}
		return { snap, text: formatSnapshot(snap) };
	}

	/** Resolve a ref to its current box, scrolling it into view first. */
	private async resolveRefBox(ref: string): Promise<{ selector: string; box: number[] }> {
		const entry = this.refs.get(ref);
		if (!entry) {
			throw new Error(
				`unknown ref [${ref}] — refs come from browser snapshot and are invalidated by navigation; take a fresh snapshot`,
			);
		}
		const selector = entry.selector;
		const prepped = await this.prepElement(selector);
		if (!prepped) {
			throw new Error(
				`ref [${ref}] no longer resolves to a visible element — the page changed; take a fresh snapshot`,
			);
		}
		return { selector, box: prepped };
	}

	/**
	 * Scroll an element into view and return its fresh viewport box
	 * (D5 — trusted input needs real coordinates).
	 */
	private async prepElement(selector: string): Promise<number[] | null> {
		const prepped = await this.pageEval(`(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) return null;
			try { el.scrollIntoView({ block: "center", inline: "center" }); } catch (e) {}
			const r = el.getBoundingClientRect();
			if (r.width === 0 && r.height === 0) return null;
			return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
		})()`);
		return Array.isArray(prepped) ? prepped : null;
	}

	private async dispatchClick(x: number, y: number, opts: { button?: string; clickCount?: number; modifiers?: string[] } = {}): Promise<void> {
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		const button = opts.button === "right" ? "right" : opts.button === "middle" ? "middle" : "left";
		const mods = modifierBits(opts.modifiers);
		const base = { x: Math.round(x), y: Math.round(y), button, modifiers: mods, clickCount: opts.clickCount ?? 1, pointerType: "mouse" };
		await conn.send("Input.dispatchMouseEvent", { ...base, type: "mousePressed", buttons: button === "left" ? 1 : button === "right" ? 2 : 4 }, { sessionId });
		await sleep(30);
		await conn.send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" }, { sessionId });
	}

	private async pressKeyCombo(combo: string): Promise<void> {
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		const { parts } = parseKeyCombo(combo);
		const isModifier = (key: string) => ["Control", "Alt", "Meta", "Shift"].includes(key);
		// A single printable char with no modifiers: one keyDown carrying
		// `text` (a char event) + keyUp is exactly what typing produces.
		if (parts.length === 1 && parts[0].text && !parts.some((p) => isModifier(p.key))) {
			const p = parts[0];
			await conn.send(
				"Input.dispatchKeyEvent",
				{ type: "keyDown", key: p.key, code: p.code, windowsVirtualKeyCode: p.vk, text: p.text, unmodifiedText: p.text },
				{ sessionId },
			);
			await conn.send("Input.dispatchKeyEvent", { type: "keyUp", key: p.key, code: p.code, windowsVirtualKeyCode: p.vk }, { sessionId });
			return;
		}
		// Combos (Ctrl+A, cmd+shift+p): modifier key events bracket a
		// rawKeyDown for the final key — carrying `text` on it turns the
		// shortcut into a character insertion and Ctrl+A stops selecting.
		let mods = 0;
		const held: string[] = [];
		for (const p of parts) {
			if (isModifier(p.key)) {
				mods = modifierBits([p.key]);
				held.push(p.key);
			}
		}
		for (const p of parts) {
			const mod = isModifier(p.key);
			const payload: Record<string, unknown> = {
				type: mod ? "keyDown" : "rawKeyDown",
				key: p.key,
				code: p.code,
				windowsVirtualKeyCode: p.vk,
				nativeVirtualKeyCode: p.vk,
				modifiers: mods,
			};
			if (!mod && p.text && mods === 0) {
				payload.text = p.text;
				payload.unmodifiedText = p.text;
			}
			await conn.send("Input.dispatchKeyEvent", payload, { sessionId });
		}
		for (const p of [...parts].reverse()) {
			await conn.send(
				"Input.dispatchKeyEvent",
				{
					type: "keyUp",
					key: p.key,
					code: p.code,
					windowsVirtualKeyCode: p.vk,
					nativeVirtualKeyCode: p.vk,
					modifiers: mods,
				},
				{ sessionId },
			);
		}
	}

	// ------------------------------------------------------------- actions

	/** Element locator: ref (preferred), selector, or explicit coords. */
	async locate(opts: { ref?: string; selector?: string }): Promise<{ selector?: string; box: number[]; center: { x: number; y: number } }> {
		if (opts.ref) {
			const { selector, box } = await this.resolveRefBox(opts.ref);
			return { selector, box, center: { x: box[0] + box[2] / 2, y: box[1] + box[3] / 2 } };
		}
		if (opts.selector) {
			const box = await this.prepElement(opts.selector);
			if (!box) throw new Error(`selector matched no visible element: ${opts.selector}`);
			return { selector: opts.selector, box, center: { x: box[0] + box[2] / 2, y: box[1] + box[3] / 2 } };
		}
		throw new Error("provide a ref (from snapshot), a CSS selector, or x/y coordinates");
	}

	/** Arm the load listener first, then send Page.navigate — no missed loads. */
	private async raceNavigate(conn: import("./cdp.ts").CdpConnection, sessionId: string, url: string): Promise<boolean> {
		const loaded = this.waitForLoad(sessionId);
		try {
			await conn.send("Page.navigate", { url }, { sessionId });
		} catch (e: any) {
			// net errors surface here (ERR_NAME_NOT_RESOLVED etc.)
			void loaded;
			throw new Error(`navigation failed: ${e?.message ?? e}`);
		}
		return loaded;
	}

	async navigate(rawUrl: string): Promise<ActionReport> {
		const url = normalizeUrl(rawUrl);
		const gate = urlAllowed(url, this.env.blockList);
		if (!gate.ok) throw new Error(`navigation blocked by UNOWN_BROWSER_BLOCK (pattern ${gate.blockedBy}): ${url}`);
		await this.ensureStarted();
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		// fire + bounded load wait (D7). The load listener is armed BEFORE
		// Page.navigate leaves — data:/local pages can fire loadEventFired
		// between the send and a later registration (measured: 'load timed
		// out' on a Bun.serve fixture that had obviously loaded).
		const loaded = await this.raceNavigate(conn, sessionId, url);
		await this.settle();
		const { snap, text } = await this.takeSnapshot();
		return {
			summary: `navigated to ${snap.url}${loaded ? "" : " (load timed out — page may still be loading)"}`,
			snapshot: text,
			url: snap.url,
			title: snap.title,
		};
	}

	async goHistory(dir: "back" | "forward" | "reload"): Promise<ActionReport> {
		await this.ensureStarted();
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		if (dir === "reload") {
			await conn.send("Page.reload", { ignoreCache: false }, { sessionId });
		} else {
			const history = await conn.send("Page.getNavigationHistory", {}, { sessionId });
			const { currentIndex, entries } = history;
			const to = dir === "back" ? currentIndex - 1 : currentIndex + 1;
			if (to < 0 || to >= entries.length) throw new Error(`cannot go ${dir} — no ${dir} history entry`);
			await conn.send("Page.navigateToHistoryEntry", { entryId: entries[to].id }, { sessionId });
		}
		await this.waitForLoad(sessionId);
		await this.settle();
		const { snap, text } = await this.takeSnapshot();
		return { summary: `${dir} → ${snap.url}`, snapshot: text, url: snap.url, title: snap.title };
	}

	async snapshot(opts: { includeBoxes?: boolean } = {}): Promise<ActionReport> {
		await this.ensureStarted();
		const { snap, text } = await this.takeSnapshot(opts);
		return {
			summary: `snapshot: ${snap.count} elements (${snap.title || snap.url})${snap.truncated ? " [TRUNCATED]" : ""}`,
			snapshot: text,
			url: snap.url,
			title: snap.title,
		};
	}

	async find(text: string): Promise<ActionReport> {
		await this.ensureStarted();
		const { text: snapText } = await this.takeSnapshot();
		const needle = text.toLowerCase();
		const matches = snapText
			.split("\n")
			.filter((l) => l.toLowerCase().includes(needle));
		if (matches.length === 0) {
			return { summary: `no snapshot lines match ${JSON.stringify(text)}`, snapshot: snapText.split("\n").slice(0, 10).join("\n") };
		}
		return { summary: `${matches.length} matching line(s) for ${JSON.stringify(text)}`, details: matches.slice(0, 30) };
	}

	async getText(): Promise<ActionReport> {
		await this.ensureStarted();
		const text = await this.pageEval(`document.body ? document.body.innerText : ""`);
		const capped = String(text ?? "").slice(0, 60_000);
		return { summary: `page text (${capped.length} chars)`, details: [capped] };
	}

	async getHtml(selector?: string): Promise<ActionReport> {
		await this.ensureStarted();
		const html = await this.pageEval(
			`(${selector ? `() => (document.querySelector(JSON.parse(${JSON.stringify(JSON.stringify(selector))})) || {}).outerHTML` : "() => document.documentElement.outerHTML"})()`,
		);
		const capped = String(html ?? "").slice(0, 60_000);
		return { summary: `outerHTML (${capped.length} chars${selector ? ` of ${selector}` : ""})`, details: [capped] };
	}

	async click(opts: {
		ref?: string;
		selector?: string;
		x?: number;
		y?: number;
		button?: string;
		doubleClick?: boolean;
		modifiers?: string[];
	}): Promise<ActionReport> {
		await this.ensureStarted();
		let cx: number;
		let cy: number;
		let label: string;
		if (typeof opts.x === "number" && typeof opts.y === "number") {
			cx = opts.x;
			cy = opts.y;
			label = `at (${Math.round(cx)}, ${Math.round(cy)})`;
		} else {
			const loc = await this.locate(opts);
			cx = loc.center.x;
			cy = loc.center.y;
			label = opts.ref ? `[${opts.ref}]` : opts.selector ?? "";
		}
		await this.dispatchClick(cx, cy, {
			button: opts.button,
			clickCount: opts.doubleClick ? 2 : 1,
			modifiers: opts.modifiers,
		});
		await this.settle();
		const { snap, text } = await this.takeSnapshot();
		return { summary: `clicked ${label}`, snapshot: text, url: snap.url, title: snap.title };
	}

	async hover(opts: { ref?: string; selector?: string }): Promise<ActionReport> {
		await this.ensureStarted();
		const loc = await this.locate(opts);
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		await conn.send(
			"Input.dispatchMouseEvent",
			{ type: "mouseMoved", x: Math.round(loc.center.x), y: Math.round(loc.center.y), pointerType: "mouse" },
			{ sessionId },
		);
		await this.settle(150);
		const { snap, text } = await this.takeSnapshot();
		return { summary: `hovered ${opts.ref ? `[${opts.ref}]` : opts.selector}`, snapshot: text, url: snap.url, title: snap.title };
	}

	async type(opts: { ref?: string; selector?: string; text: string; submit?: boolean; clear?: boolean }): Promise<ActionReport> {
		await this.ensureStarted();
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		if (opts.ref || opts.selector) {
			const loc = await this.locate(opts);
			// focus the element with a trusted click at its center
			await this.dispatchClick(loc.center.x, loc.center.y);
		}
		if (opts.clear) {
			await this.pressKeyCombo("Control+a");
			await this.pressKeyCombo("Backspace");
		}
		if (opts.text.length > 0) {
			// insertText fires real input events (works with React/Vue controlled inputs)
			await conn.send("Input.insertText", { text: opts.text }, { sessionId });
		}
		if (opts.submit) {
			await this.pressKeyCombo("Enter");
		}
		await this.settle();
		const { snap, text } = await this.takeSnapshot();
		return {
			summary: `typed ${JSON.stringify(opts.text.slice(0, 60))}${opts.submit ? " + Enter" : ""} into ${opts.ref ? `[${opts.ref}]` : opts.selector ?? "focused element"}`,
			snapshot: text,
			url: snap.url,
			title: snap.title,
		};
	}

	async pressKey(key: string): Promise<ActionReport> {
		await this.ensureStarted();
		await this.pressKeyCombo(key);
		await this.settle();
		const { snap, text } = await this.takeSnapshot();
		return { summary: `pressed ${key}`, snapshot: text, url: snap.url, title: snap.title };
	}

	async fillForm(fields: Array<{ ref?: string; selector?: string; value: string }>): Promise<ActionReport> {
		await this.ensureStarted();
		if (!fields.length) throw new Error("fill_form needs at least one field");
		const notes: string[] = [];
		for (const f of fields) {
			const selector = f.ref ? `[data-unown-ref="${f.ref}"]` : f.selector;
			if (!selector) throw new Error("fill_form fields need a ref or selector");
			// Route by element type (typing into a <select> leaves a native
			// dropdown open and mangles the page's input state):
			//   select → native value set + change event
			//   checkbox/radio → trusted toggle click
			//   everything else → click to focus, clear, insertText
			const kind = await this.pageEval(`(() => {
				const el = document.querySelector(${JSON.stringify(selector)});
				if (!el) return null;
				if (el.tagName === "SELECT") return "select";
				if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) return "toggle";
				return "text";
			})()`);
			if (kind === null) throw new Error(`fill_form: no element for ${f.ref ? `[${f.ref}]` : f.selector}`);
			if (kind === "select") {
				await this.selectOption({ ref: f.ref, selector: f.selector, values: [f.value] });
				notes.push(`${f.ref ? `[${f.ref}]` : f.selector} selected ${JSON.stringify(f.value.slice(0, 40))}`);
				continue;
			}
			if (kind === "toggle") {
				const loc = await this.locate(f);
				await this.dispatchClick(loc.center.x, loc.center.y);
				notes.push(`${f.ref ? `[${f.ref}]` : f.selector} toggled`);
				continue;
			}
			const loc = await this.locate(f);
			await this.dispatchClick(loc.center.x, loc.center.y);
			await this.pressKeyCombo("Control+a");
			await this.pressKeyCombo("Backspace");
			await this.conn!.send("Input.insertText", { text: f.value }, { sessionId: this.requireSessionId() });
			notes.push(`${f.ref ? `[${f.ref}]` : f.selector} = ${JSON.stringify(f.value.slice(0, 40))}`);
		}
		await this.settle();
		const { snap, text } = await this.takeSnapshot();
		return { summary: `filled ${fields.length} field(s)`, details: notes, snapshot: text, url: snap.url, title: snap.title };
	}

	async selectOption(opts: { ref?: string; selector?: string; values: string[] }): Promise<ActionReport> {
		await this.ensureStarted();
		const target = opts.ref ? this.refs.get(opts.ref)?.selector : opts.selector;
		const selector = opts.ref ? `[data-unown-ref="${opts.ref}"]` : opts.selector;
		if (!selector) throw new Error("select_option needs a ref or selector");
		// native setter + change events (React-safe)
		const applied = await this.pageEval(`(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) return null;
			const values = ${JSON.stringify(opts.values)};
			let hit = 0;
			if (el.tagName === "SELECT") {
				const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
				for (const opt of el.options) {
					opt.selected = values.includes(opt.value) || values.includes(opt.label) || values.includes(opt.textContent.trim());
					if (opt.selected) hit++;
				}
				setter.call(el, el.selectedIndex >= 0 ? el.options[el.selectedIndex].value : "");
				el.dispatchEvent(new Event("input", { bubbles: true }));
				el.dispatchEvent(new Event("change", { bubbles: true }));
				return { tag: "select", hit };
			}
			if (el.tagName === "INPUT" && (el.type === "radio" || el.type === "checkbox")) {
				el.checked = values.includes(el.value) || values.includes("true");
				el.dispatchEvent(new Event("input", { bubbles: true }));
				el.dispatchEvent(new Event("change", { bubbles: true }));
				return { tag: "input", hit: el.checked ? 1 : 0 };
			}
			return { tag: el.tagName.toLowerCase(), hit: 0 };
		})()`);
		if (applied === null) throw new Error(`select_option: no element for ${opts.ref ?? opts.selector}`);
		if (applied.hit === 0 && applied.tag === "select") {
			throw new Error(`select_option: none of ${JSON.stringify(opts.values)} matched an option`);
		}
		await this.settle();
		const { snap, text } = await this.takeSnapshot();
		return {
			summary: `selected ${JSON.stringify(opts.values)} on ${opts.ref ? `[${opts.ref}]` : opts.selector} (${applied.hit} option(s))`,
			snapshot: text,
			url: snap.url,
			title: snap.title,
		};
	}

	async scroll(opts: { direction?: "up" | "down" | "left" | "right"; amount?: number; ref?: string; selector?: string }): Promise<ActionReport> {
		await this.ensureStarted();
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		const direction = opts.direction ?? "down";
		const amount = Math.max(1, Math.round(opts.amount ?? 600));
		if (opts.ref || opts.selector) {
			// scroll an element into view (Playwright scroll_into_view semantics)
			const loc = await this.locate(opts);
			const box = await this.pageEval(`(() => {
				const el = document.querySelector(${JSON.stringify(loc.selector)});
				if (!el) return null;
				el.scrollIntoView({ block: "center" });
				const r = el.getBoundingClientRect();
				return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
			})()`);
			const { snap, text } = await this.takeSnapshot();
			return { summary: `scrolled ${opts.ref ? `[${opts.ref}]` : opts.selector} into view`, snapshot: text, url: snap.url, title: snap.title };
		}
		const deltas: Record<string, [number, number]> = {
			up: [0, -amount],
			down: [0, amount],
			left: [-amount, 0],
			right: [amount, 0],
		};
		const [dx, dy] = deltas[direction] ?? deltas.down;
		// scroll at viewport center, like a real mouse wheel
		const { width, height } = this.viewport;
		await conn.send(
			"Input.dispatchMouseEvent",
			{ type: "mouseWheel", x: Math.round(width / 2), y: Math.round(height / 2), deltaX: dx, deltaY: dy, pointerType: "mouse" },
			{ sessionId },
		);
		await this.settle(150);
		const { snap, text } = await this.takeSnapshot();
		const scrolled = await this.pageEval(`window.scrollY`);
		return { summary: `scrolled ${direction} by ${amount}px (scrollY=${Math.round(Number(scrolled ?? 0))})`, snapshot: text, url: snap.url, title: snap.title };
	}

	async drag(opts: { startRef?: string; startSelector?: string; endRef?: string; endSelector?: string }): Promise<ActionReport> {
		await this.ensureStarted();
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		const start = await this.locate({ ref: opts.startRef, selector: opts.startSelector });
		const end = await this.locate({ ref: opts.endRef, selector: opts.endSelector });
		const base = { button: "left", clickCount: 1, pointerType: "mouse" };
		await conn.send("Input.dispatchMouseEvent", { ...base, type: "mousePressed", x: Math.round(start.center.x), y: Math.round(start.center.y) }, { sessionId });
		const steps = 8;
		for (let i = 1; i <= steps; i++) {
			await conn.send(
				"Input.dispatchMouseEvent",
				{
					type: "mouseMoved",
					x: Math.round(start.center.x + ((end.center.x - start.center.x) * i) / steps),
					y: Math.round(start.center.y + ((end.center.y - start.center.y) * i) / steps),
					button: "left",
					buttons: 1,
					pointerType: "mouse",
				},
				{ sessionId },
			);
			await sleep(16);
		}
		await conn.send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased", x: Math.round(end.center.x), y: Math.round(end.center.y) }, { sessionId });
		await this.settle();
		const { snap, text } = await this.takeSnapshot();
		return { summary: `dragged from ${opts.startRef ? `[${opts.startRef}]` : opts.startSelector} to ${opts.endRef ? `[${opts.endRef}]` : opts.endSelector}`, snapshot: text, url: snap.url, title: snap.title };
	}

	async screenshot(opts: {
		fullPage?: boolean;
		ref?: string;
		selector?: string;
		format?: "png" | "jpeg";
		quality?: number;
		savePath?: string;
	}): Promise<ActionReport & { image?: { data: string; mimeType: string } }> {
		await this.ensureStarted();
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined;
		if (opts.ref || opts.selector) {
			const loc = await this.locate(opts);
			clip = { x: loc.box[0], y: loc.box[1], width: loc.box[2], height: loc.box[3], scale: 1 };
		}
		const format = opts.format ?? "jpeg";
		const params: Record<string, unknown> = { format };
		if (format === "jpeg") params.quality = Math.min(100, Math.max(20, opts.quality ?? 70));
		if (clip) params.clip = clip;
		if (opts.fullPage) {
			params.captureBeyondViewport = true;
			const metrics = await conn.send("Page.getLayoutMetrics", {}, { sessionId });
			const cs = metrics?.cssContentSize ?? metrics?.contentSize;
			if (cs) params.clip = { x: 0, y: 0, width: cs.width, height: cs.height, scale: 1 };
		}
		const res = await conn.send("Page.captureScreenshot", params, { sessionId, timeoutMs: 20_000 });
		const data = String(res?.data ?? "");
		if (!data) throw new Error("screenshot returned no data");
		const details: string[] = [];
		if (opts.savePath) {
			const { writeFileSync } = await import("node:fs");
			writeFileSync(opts.savePath, Buffer.from(data, "base64"));
			details.push(`saved: ${opts.savePath}`);
		}
		return {
			summary: `screenshot (${format}${clip ? ` clip ${Math.round(clip.width)}x${Math.round(clip.height)}` : ""}${opts.fullPage ? " fullPage" : ""}, ${Math.round((data.length * 3) / 4 / 1024)} KB)`,
			details: details.length ? details : undefined,
			image: { data, mimeType: `image/${format}` },
		};
	}

	async evalCode(code: string): Promise<ActionReport> {
		await this.ensureStarted();
		// Three wrapper shapes, in order of what models actually send:
		//   1. expression (incl. `await …` and function calls)  → return (expr)
		//   2. statements (`const x = …; return x`)             → body passthrough
		//   3. function value (`async () => …`)                → call it
		const attempts = [
			`(async () => { return (${code}); })()`,
			`(async () => { ${code} })()`,
			`(async () => { return (typeof (${code}) === "function" ? (${code})() : (${code})); })()`,
		];
		let value: unknown;
		let lastErr: Error | undefined;
		for (const expression of attempts) {
			try {
				value = await this.pageEval(expression, { awaitPromise: true });
				lastErr = undefined;
				break;
			} catch (err: any) {
				lastErr = err instanceof Error ? err : new Error(String(err));
			}
		}
		if (lastErr) throw lastErr;
		let rendered: string;
		if (value === undefined) rendered = "undefined";
		else if (typeof value === "string") rendered = value;
		else {
			try {
				rendered = JSON.stringify(value, null, 2) ?? String(value);
			} catch {
				rendered = String(value);
			}
		}
		return { summary: `eval → ${rendered.slice(0, 80)}${rendered.length > 80 ? "…" : ""}`, details: [rendered.slice(0, 60_000)] };
	}

	async tabs(action: "list" | "new" | "select" | "close", opts: { index?: number; url?: string } = {}): Promise<ActionReport> {
		await this.ensureStarted();
		const conn = this.requireConn();
		const list = () => Array.from(this.pages.values()).map((p, i) => `${i}: ${p.title || p.url || "(untitled)"}`);
		if (action === "list") {
			return { summary: `${this.pages.size} tab(s)`, details: list() };
		}
		if (action === "new") {
			const url = opts.url ? normalizeUrl(opts.url) : "about:blank";
			const { targetId } = await conn.send("Target.createTarget", { url });
			// wait for auto-attach to hand us the session
			const deadline = Date.now() + 5_000;
			let sid: string | null = null;
			while (Date.now() < deadline) {
				sid = this.findSessionForTarget(targetId);
				if (sid) break;
				await sleep(100);
			}
			if (sid) {
				this.activeSessionId = sid;
				if (opts.url) {
					await this.waitForLoad(sid).catch(() => undefined);
					await this.settle();
					const { snap, text } = await this.takeSnapshot();
					return { summary: `opened tab → ${snap.url}`, snapshot: text, url: snap.url, title: snap.title };
				}
			}
			return { summary: `opened tab ${url}` };
		}
		// select/close need an index
		const keys = Array.from(this.pages.keys());
		const idx = opts.index ?? keys.length - 1;
		if (idx < 0 || idx >= keys.length) throw new Error(`tab index ${idx} out of range (0..${keys.length - 1})`);
		const sid = keys[idx];
		const page = this.pages.get(sid)!;
		if (action === "select") {
			this.activeSessionId = sid;
			await conn.send("Target.activateTarget", { targetId: page.targetId }).catch(() => undefined);
			const { snap, text } = await this.takeSnapshot();
			return { summary: `selected tab ${idx}: ${page.url}`, snapshot: text, url: snap.url, title: snap.title };
		}
		// close
		await conn.send("Target.closeTarget", { targetId: page.targetId });
		if (this.activeSessionId === sid) {
			this.activeSessionId = this.pages.keys().next().value ?? null;
		}
		await sleep(200);
		return { summary: `closed tab ${idx}`, details: list() };
	}

	async wait(opts: { text?: string; textGone?: string; url?: string; time?: number; download?: boolean; timeoutMs?: number }): Promise<ActionReport> {
		await this.ensureStarted();
		const timeoutMs = Math.min(30_000, opts.timeoutMs ?? 10_000);
		const deadline = Date.now() + timeoutMs;
		const notes: string[] = [];
		if (opts.time) {
			const ms = Math.min(30_000, Math.max(0, opts.time * 1000));
			await sleep(ms);
			notes.push(`slept ${opts.time}s`);
		}
		if (opts.text) {
			while (Date.now() < deadline) {
				const has = await this.pageEval(`document.body ? document.body.innerText.includes(${JSON.stringify(opts.text)}) : false`).catch(() => false);
				if (has) {
					notes.push(`text ${JSON.stringify(opts.text)} present`);
					break;
				}
				await sleep(200);
				if (Date.now() >= deadline) throw new Error(`wait timed out after ${timeoutMs}ms: text ${JSON.stringify(opts.text)} not found`);
			}
		}
		if (opts.textGone) {
			while (Date.now() < deadline) {
				const has = await this.pageEval(`document.body ? document.body.innerText.includes(${JSON.stringify(opts.textGone)}) : false`).catch(() => false);
				if (!has) {
					notes.push(`text ${JSON.stringify(opts.textGone)} gone`);
					break;
				}
				await sleep(200);
				if (Date.now() >= deadline) throw new Error(`wait timed out after ${timeoutMs}ms: text ${JSON.stringify(opts.textGone)} still present`);
			}
		}
		if (opts.url) {
			while (Date.now() < deadline) {
				const url = await this.pageEval(`location.href`).catch(() => "");
				if (String(url).includes(opts.url)) {
					notes.push(`url contains ${JSON.stringify(opts.url)}`);
					break;
				}
				await sleep(200);
				if (Date.now() >= deadline) throw new Error(`wait timed out after ${timeoutMs}ms: url never contained ${JSON.stringify(opts.url)}`);
			}
		}
		if (opts.download) {
			while (Date.now() < deadline) {
				const last = this.downloads[this.downloads.length - 1];
				if (last && last.state === "completed") {
					notes.push(`download complete: ${last.filename}`);
					break;
				}
				if (last && last.state === "canceled") throw new Error(`download canceled: ${last.filename}`);
				await sleep(250);
				if (Date.now() >= deadline) throw new Error(`wait timed out after ${timeoutMs}ms: no completed download`);
			}
		}
		const { snap, text } = await this.takeSnapshot();
		return { summary: `waited (${notes.join("; ") || "no condition"})`, snapshot: text, url: snap.url, title: snap.title };
	}

	async resize(width: number, height: number): Promise<ActionReport> {
		await this.ensureStarted();
		this.viewport = { width, height };
		await this.conn!.send(
			"Emulation.setDeviceMetricsOverride",
			{ width, height, deviceScaleFactor: 1, mobile: false },
			{ sessionId: this.requireSessionId() },
		);
		return { summary: `viewport ${width}x${height}` };
	}

	async uploadFiles(paths: string[], opts: { ref?: string; selector?: string } = {}): Promise<ActionReport> {
		await this.ensureStarted();
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		// upload jail (D11): project root or system tmp only — enforced HERE
		// so every caller (tool dispatch, tests, future MCP surface) gets it.
		const { isAbsolute, resolve, sep } = await import("node:path");
		const { statSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const jailed = paths.map((raw) => {
			const abs = isAbsolute(raw) ? raw : resolve(this.cwd, raw);
			const insideCwd = abs === this.cwd || abs.startsWith(this.cwd + sep);
			const insideTmp = abs.startsWith(tmpdir() + sep);
			if (!insideCwd && !insideTmp) {
				throw new Error(`upload path must be inside the project root or the system tmp dir (got ${abs})`);
			}
			try {
				statSync(abs);
			} catch {
				throw new Error(`upload path does not exist: ${abs}`);
			}
			return abs;
		});
		paths = jailed;
		// 1) explicit input element
		if (opts.ref || opts.selector) {
			const selector = opts.ref ? `[data-unown-ref="${opts.ref}"]` : opts.selector!;
			const { root } = await conn.send("DOM.getDocument", { depth: 0 }, { sessionId });
			const { nodeId } = await conn.send("DOM.querySelector", { nodeId: root.nodeId, selector }, { sessionId });
			if (!nodeId) throw new Error(`upload: no element for ${opts.ref ?? opts.selector}`);
			await conn.send("DOM.setFileInputFiles", { files: paths, nodeId }, { sessionId });
			return { summary: `uploaded ${paths.length} file(s) to ${opts.ref ? `[${opts.ref}]` : opts.selector}` };
		}
		// 2) a file chooser is open from a recent click
		if (this.pendingChooser && Date.now() - this.pendingChooser.ts < 30_000) {
			const params: Record<string, unknown> = { files: paths };
			if (this.pendingChooser.backendNodeId) params.backendNodeId = this.pendingChooser.backendNodeId;
			else if (this.pendingChooser.nodeId) params.nodeId = this.pendingChooser.nodeId;
			await conn.send("DOM.setFileInputFiles", params, { sessionId });
			return { summary: `uploaded ${paths.length} file(s) via file chooser` };
		}
		throw new Error("upload needs a ref/selector of the file input, or a file chooser opened by a click (click the upload button first, then upload without a ref)");
	}

	async pdf(opts: { filename?: string; landscape?: boolean; printBackground?: boolean }): Promise<ActionReport> {
		await this.ensureStarted();
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		const res = await conn.send(
			"Page.printToPDF",
			{
				landscape: opts.landscape ?? false,
				printBackground: opts.printBackground ?? true,
				preferCSSPageSize: true,
			},
			{ sessionId, timeoutMs: 30_000 },
		);
		const data = String(res?.data ?? "");
		if (!data) throw new Error("printToPDF returned no data");
		const { writeFileSync } = await import("node:fs");
		const { isAbsolute, join } = await import("node:path");
		const filename = opts.filename && isAbsolute(opts.filename) ? opts.filename : join(this.cwd, opts.filename ?? `page-${Date.now()}.pdf`);
		writeFileSync(filename, Buffer.from(data, "base64"));
		return { summary: `printed PDF (${Math.round((data.length * 3) / 4 / 1024)} KB)`, details: [`saved: ${filename}`] };
	}

	async cookies(action: "list" | "set" | "clear", opts: { url?: string; name?: string; value?: string; domain?: string; path?: string } = {}): Promise<ActionReport> {
		await this.ensureStarted();
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		if (action === "list") {
			const url = opts.url ?? (await this.pageEval(`location.href`));
			const res = await conn.send("Network.getCookies", { urls: [String(url)] }, { sessionId });
			const cookies = res?.cookies ?? [];
			const lines = cookies.map((c: any) => `${c.name}=${String(c.value).slice(0, 40)} (domain ${c.domain}${c.expires ? `, expires ${new Date(c.expires * 1000).toISOString()}` : ""})`);
			return { summary: `${cookies.length} cookie(s)`, details: lines.slice(0, 100) };
		}
		if (action === "set") {
			if (!opts.name) throw new Error("cookies set needs name");
			const pageUrl = String(await this.pageEval(`location.href`));
			await conn.send(
				"Network.setCookie",
				{
					name: opts.name,
					value: opts.value ?? "",
					url: opts.url ?? (/^https?:/i.test(pageUrl) ? pageUrl : undefined),
					domain: opts.domain,
					path: opts.path ?? "/",
				},
				{ sessionId },
			);
			return { summary: `set cookie ${opts.name}` };
		}
		await conn.send("Network.clearBrowserCookies", {}, { sessionId });
		return { summary: "cleared all cookies" };
	}

	async storageSave(path: string): Promise<ActionReport> {
		await this.ensureStarted();
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		const { writeFileSync } = await import("node:fs");
		// Storage.getCookies is browser-wide — but Network-domain commands
		// only exist on PAGE sessions, so everything routes through the
		// active session (measured: browser-level Network.* → "wasn't found")
		const cookiesRes = await conn.send("Storage.getCookies", {}, { sessionId }).catch(() => ({ cookies: [] }));
		const origin = String(await this.pageEval(`location.origin`));
		const local = await this.pageEval(`(() => { try { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; } catch (e) { return null; } })()`).catch(() => null);
		const payload = {
			version: 1,
			savedAt: new Date().toISOString(),
			origin,
			cookies: cookiesRes.cookies ?? [],
			localStorage: local ?? {},
		};
		writeFileSync(path, JSON.stringify(payload, null, 2));
		return { summary: `saved storage state (${payload.cookies.length} cookies)`, details: [`saved: ${path}`] };
	}

	async storageLoad(path: string): Promise<ActionReport> {
		await this.ensureStarted();
		const conn = this.requireConn();
		const { readFileSync } = await import("node:fs");
		let payload: any;
		try {
			payload = JSON.parse(readFileSync(path, "utf8"));
		} catch (err: any) {
			throw new Error(`cannot read storage state ${path}: ${err?.message ?? err}`);
		}
		const sessionId = this.requireSessionId();
		let n = 0;
		for (const c of payload.cookies ?? []) {
			const res = await conn
				.send(
					"Network.setCookie",
					{ name: c.name, value: c.value ?? "", domain: c.domain, path: c.path ?? "/", secure: !!c.secure, httpOnly: !!c.httpOnly, expires: c.expires, sameSite: c.sameSite === "Strict" ? "Strict" : c.sameSite === "Lax" ? "Lax" : undefined },
					{ sessionId },
				)
				.catch(() => ({ success: false }));
			if ((res as any)?.success !== false) n++;
		}
		if (payload.localStorage && Object.keys(payload.localStorage).length) {
			await this.pageEval(`(() => { const o = JSON.parse(${JSON.stringify(JSON.stringify(payload.localStorage))}); for (const k of Object.keys(o)) { try { localStorage.setItem(k, o[k]); } catch (e) {} } })()`).catch(() => undefined);
		}
		return { summary: `loaded storage state from ${path} (${n} cookies)` };
	}

	// ------------------------------------------------------------- teardown

	/** Save screenshots dir etc. — informational path for the status action. */
	browserArtifactsDir(): string | null {
		return this.tempProfileUsed;
	}

	/** Full teardown: Browser.close (launch mode), socket, temp profile. */
	async stop(): Promise<ActionReport> {
		this.stopped = true;
		const wasRunning = !!this.conn && !this.conn.isClosed;
		if (wasRunning && this.conn) {
			await this.conn.close();
		}
		if (this.tempProfileUsed) {
			try {
				rmSync(this.tempProfileUsed, { recursive: true, force: true });
			} catch {
				/* best effort */
			}
		}
		for (const d of this.disposers) {
			try {
				d();
			} catch {
				/* ignore */
			}
		}
		this.disposers = [];
		this.pages.clear();
		this.refs.clear();
		this.consoleRing = [];
		this.requestRing = [];
		this.started = false;
		this.stopped = false; // a future action may start a new browser
		return { summary: wasRunning ? "browser stopped" : "browser was not running" };
	}

	/** Sync-safe teardown for process exit hooks. */
	syncKill(): void {
		try {
			this.conn?.close();
		} catch {
			/* ignore */
		}
	}
}

// ---------------------------------------------------------------------------
// process-wide singleton + exit hygiene (D15)
// ---------------------------------------------------------------------------

let activeSession: BrowserSession | null = null;
let exitHooksInstalled = false;

/** Get (or create) the shared session for this process. */
export function getBrowserSession(cwd?: string): BrowserSession {
	if (!activeSession) {
		activeSession = new BrowserSession({ cwd });
	}
	if (!exitHooksInstalled) {
		exitHooksInstalled = true;
		const kill = () => {
			try {
				activeSession?.syncKill();
			} catch {
				/* ignore */
			}
		};
		process.once("exit", kill);
		process.once("SIGINT", () => {
			kill();
			process.exit(130);
		});
		process.once("SIGTERM", () => {
			kill();
			process.exit(143);
		});
	}
	return activeSession;
}
