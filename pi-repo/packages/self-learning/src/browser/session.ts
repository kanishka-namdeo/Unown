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
import { formatSnapshot, type RefEntry, SNAPSHOT_SCRIPT, type Snapshot, snapshotRefs } from "./a11y.ts";
import {
	CAPTCHA_PROBE_SRC,
	CapSolverClient,
	type CaptchaConfig,
	capSolverJobFor,
	type DetectedChallenge,
	formatChallenges,
	injectTokenExpression,
	resolveCaptchaConfig,
	TwoCaptchaClient,
	tiersFor,
	twoCaptchaJobFor,
	visionReadCaptcha,
} from "./captcha.ts";
import { CdpConnection, modifierBits, parseKeyCombo } from "./cdp.ts";
import {
	BROWSER_NAV_TIMEOUT_MS,
	BROWSER_SETTLE_MS,
	BROWSER_SNAPSHOT_MAX,
	BROWSER_SNAPSHOT_MAX_CHARS,
	BROWSER_VIEWPORT,
	type BrowserEnv,
	browserEnv,
	defaultProfileDir,
	discoverBrowser,
	normalizeUrl,
	urlAllowed,
} from "./config.ts";
import {
	type ChromeVersion,
	humanKeyGap,
	humanPath,
	humanTypeDelays,
	mulberry32,
	parseProxy,
	readChromeVersion,
	resolveStealthConfig,
	type StealthConfig,
	stealthLaunchArgs,
} from "./stealth.ts";

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
	/** CDP downloadId — concurrent downloads update by id, not by slot. */
	id?: string;
}

export interface DialogEntry {
	message: string;
	type: string;
	ts: number;
	/** How the dialog was resolved ("auto-dismissed", "accepted", …). */
	outcome: string;
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
	/** Stealth tier state (v2). */
	stealth?: {
		enabled: boolean;
		os: string;
		humanize: boolean;
		proxy?: string;
		userAgent: string;
	};
	/** Captcha tier state (v2). */
	captcha?: { solver: string; auto: boolean; vision: boolean };
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
	/** Ring of recent native dialogs + how each was resolved. */
	private dialogRing: DialogEntry[] = [];
	/** One-shot policy for the NEXT native dialog (browser dialog accept|dismiss). */
	private pendingDialogPolicy: { accept: boolean; promptText?: string; ts: number } | null = null;
	private pendingChooser: { backendNodeId?: number; nodeId?: number; ts: number } | null = null;
	private refs = new Map<string, RefEntry>();
	private viewport = { ...BROWSER_VIEWPORT };
	private info: SessionInfo | null = null;
	private tempProfileUsed: string | null = null;
	private env: BrowserEnv;
	private cwd: string;
	private readonly maxConsole = 300;
	private readonly maxRequests = 200;
	private downloadDir: string | null = null;
	private disposers: Array<() => void> = [];
	/** Per-page event taps, disposed when the target detaches (leak fix). */
	private pageDisposers = new Map<string, Array<() => void>>();
	/** In-flight explicit attaches — dedupes targetCreated vs getTargets racing. */
	private attachingTargets = new Set<string>();
	private stopped = false;
	// ---- v2 stealth/captcha state ----
	/** Resolved stealth config — set at start(), read-only after. */
	private stealthCfg: StealthConfig | null = null;
	/** Resolved captcha config — set at start(), read-only after. */
	private captchaCfg: CaptchaConfig | null = null;
	/** Explicit per-session stealth override (the `start` action). */
	private explicitStealth: boolean | undefined;
	/** executionContextId of the isolated world, per page session (stealth). */
	private isolatedWorlds = new Map<string, number>();
	/** Last known mouse position (viewport CSS px) — humanized paths start here. */
	private mousePos = { x: BROWSER_VIEWPORT.width / 2, y: BROWSER_VIEWPORT.height / 2 };
	/** Humanized-input PRNG — seeded (test-reproducible) when UNOWN_BROWSER_HUMANIZE_SEED is set. */
	private humanRng: () => number = mulberry32(
		Number(process.env.UNOWN_BROWSER_HUMANIZE_SEED) || 0 || (Date.now() ^ (process.pid << 8)) >>> 0,
	);

	constructor(opts: { cwd?: string; env?: BrowserEnv } = {}) {
		this.cwd = opts.cwd ?? process.cwd();
		this.env = opts.env ?? browserEnv();
	}

	/** Map the env-shaped knobs onto the stealth override shape (names differ). */
	private stealthOverridesFromEnv() {
		return {
			os: this.env.stealthOs,
			userAgent: this.env.stealthUserAgent,
			locale: this.env.stealthLocale,
			timezone: this.env.stealthTimezone,
			screen: this.env.stealthScreen,
			humanize: this.env.stealthHumanize,
			proxy: this.env.proxy,
		};
	}

	// ------------------------------------------------------------- lifecycle

	get isRunning(): boolean {
		return this.started && !this.conn?.isClosed;
	}

	/** Lazily ensure a connected browser. Safe to call before every action. */
	async ensureStarted(opts: { headless?: boolean; stealth?: boolean } = {}): Promise<void> {
		if (this.stopped) throw new Error("browser session was stopped — start a new one (any action auto-starts)");
		if (this.started && !this.conn?.isClosed) {
			// an explicit stealth request against a running session must be
			// a hard, honest error: the flags and overrides were set at launch
			if (opts.stealth !== undefined && this.stealthCfg && opts.stealth !== this.stealthCfg.enabled) {
				throw new Error(
					`browser is already running with stealth=${this.stealthCfg.enabled} - stop it first to switch (browser stop, then start stealth=${opts.stealth})`,
				);
			}
			return;
		}
		if (this.starting) return this.starting;
		this.starting = this.start(opts).finally(() => {
			this.starting = null;
		});
		return this.starting;
	}

	private async start(opts: { headless?: boolean; stealth?: boolean }): Promise<void> {
		const headless = opts.headless ?? this.env.headless;
		// resolve the stealth + captcha tiers ONCE, before any launch: the
		// identity (UA/platform/screen) decides launch args and per-page
		// overrides; the captcha config decides the navigate auto-loop.
		if (opts.stealth !== undefined) this.explicitStealth = opts.stealth;
		this.captchaCfg = resolveCaptchaConfig(this.env);

		if (this.env.cdpUrl) {
			// attach mode: launch flags are the remote browser's business, but
			// the protocol-level stealth tier (no Runtime.enable, isolated
			// worlds, fingerprint overrides) still applies per page.
			const conn = await CdpConnection.attach(this.env.cdpUrl);
			this.conn = conn;
			// honest engine version for the stealth identity: ask the browser
			// (Browser.getVersion → product "Chrome/143.0.7499.4") instead of
			// over-claiming the fallback major on an older attached engine.
			let attachVersion: ChromeVersion | undefined;
			try {
				const v = await conn.send("Browser.getVersion");
				const full = String(v?.product ?? "").replace(/^[^/]+\//, ""); // "Chrome/143.0…" → "143.0…"
				const major = Number(full.split(".")[0]);
				if (Number.isFinite(major) && major > 0) attachVersion = { major, full };
			} catch {
				/* older engines: the fallback identity applies */
			}
			this.stealthCfg = resolveStealthConfig({
				enabled: this.explicitStealth ?? this.env.stealth,
				overrides: this.stealthOverridesFromEnv(),
				version: attachVersion,
			});
			this.downloadDir = this.cwd;
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

		const stealthOn = this.explicitStealth ?? this.env.stealth;
		// a malformed proxy must fail LOUDLY, not launch unproxied (the user
		// set the env var precisely because their IP must not go out)
		if (this.env.proxy && parseProxy(this.env.proxy) === undefined) {
			throw new Error(
				`UNOWN_BROWSER_PROXY=${JSON.stringify(this.env.proxy)} is not a usable proxy spec (expected scheme://host:port or host:port) — refusing to launch unproxied rather than silently exposing your IP`,
			);
		}
		// stealth needs the REAL engine version before the identity is built
		const found = discoverBrowser({ allowHeadlessShell: !stealthOn });
		const chromeVersion = stealthOn ? await readChromeVersion(found.path) : undefined;
		this.stealthCfg = resolveStealthConfig({
			enabled: stealthOn,
			overrides: this.stealthOverridesFromEnv(),
			version: chromeVersion,
		});
		if (stealthOn) {
			// the identity's viewport is the default in stealth mode (a
			// 1280x720 window inside a claimed 1920x1080 screen is a tell)
			this.viewport = { ...this.stealthCfg.identity.viewport };
			this.mousePos = { x: this.viewport.width / 2, y: this.viewport.height / 2 };
		}
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

		// stealth launch args (lang/proxy/bypass) merge with the base flag set
		const stealthArgs = this.stealthCfg?.enabled ? stealthLaunchArgs(this.stealthCfg) : [];
		let conn: CdpConnection;
		try {
			conn = await CdpConnection.launch({
				executablePath: found.path,
				userDataDir: profileDir,
				headless,
				windowSize: this.viewport,
				// UNOWN_BROWSER_NO_SANDBOX=1 opts into --no-sandbox --disable-gpu on the
				// FIRST launch (containers/CI). The retry path below has always forced
				// them; the env knob just lets a known-container host skip the one
				// failed launch instead of paying for it.
				extraArgs: this.env.noSandbox ? ["--no-sandbox", "--disable-gpu", ...stealthArgs] : stealthArgs,
			});
		} catch (err: any) {
			const msg = err instanceof Error ? err.message : String(err);
			// two failure families land here and one retry fixes both:
			//   - containers/CI need --no-sandbox
			//   - a concurrent unown session won the default profile's
			//     SingletonLock between our check and the launch (Chrome
			//     exits during startup) — the retry must use a TEMP profile,
			//     never the still-locked one
			if (/exited during startup|DevTools endpoint/i.test(msg)) {
				const retryProfile = join(tmpdir(), `unown-browser-retry-${process.pid}-${Date.now()}`);
				conn = await CdpConnection.launch({
					executablePath: found.path,
					userDataDir: retryProfile,
					headless,
					windowSize: this.viewport,
					extraArgs: ["--no-sandbox", "--disable-gpu", ...stealthArgs],
				})
					.then((c) => {
						tempProfile = true;
						profileDir = retryProfile;
						return c;
					})
					.catch((err2: any) => {
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
			conn.on("Target.targetCreated", (_m, p) => this.onTargetDiscovered(p, "created")),
			conn.on("Target.targetInfoChanged", (_m, p) => this.onTargetDiscovered(p, "changed")),
			conn.on("Target.targetDestroyed", (_m, p) => this.onTargetDestroyed(p)),
		);

		// ---- downloads: route to the project cwd (D12) — BOTH modes. In
		// attach mode this is what makes "where did my file land" answerable
		// (and the behavior is a runtime setting, not a persistent one).
		await conn
			.send("Browser.setDownloadBehavior", {
				behavior: "allow",
				downloadPath: this.downloadDir ?? this.cwd,
				eventsEnabled: true,
			})
			.catch(() => undefined); // older chromes: per-page Page.setDownloadBehavior

		// Target DISCOVERY + explicit attach — never Target.setAutoAttach.
		// The stress round's live finding (Chrome for Testing 143): with
		// auto-attach armed, a popup opened by window.open() during trusted
		// input dispatch stalls at about:blank forever and the
		// Input.dispatchMouseEvent ack hangs for its full 30 s timeout —
		// even with waitForDebuggerOnStart:false and zero commands sent to
		// the new session (Runtime.run does not help). Discover + explicit
		// attach leaves popup navigation alone: 19 ms acks, popup navigates.
		await conn.send("Target.setDiscoverTargets", { discover: true });

		// attach to the pages that already exist (about:blank on a fresh
		// launch; real tabs when attaching to a running browser)
		const existing = await conn.send("Target.getTargets").catch(() => ({ targetInfos: [] }));
		for (const t of existing.targetInfos ?? []) {
			if (t.type !== "page") continue;
			void this.ensureAttached(String(t.targetId)).catch(() => undefined);
		}

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

	/** Explicitly attach to one page target (flatten mode → sessionIds). */
	private async attachToTarget(targetId: string): Promise<void> {
		const conn = this.requireConn();
		await conn.send("Target.attachToTarget", { targetId, flatten: true });
	}

	/** Attach exactly once per target (dedupes targetCreated vs getTargets). */
	private async ensureAttached(targetId: string): Promise<void> {
		if (this.findSessionForTarget(targetId) || this.attachingTargets.has(targetId)) return;
		this.attachingTargets.add(targetId);
		try {
			await this.attachToTarget(targetId);
		} finally {
			this.attachingTargets.delete(targetId);
		}
	}

	/** Target.targetCreated / targetInfoChanged — attach to new pages, refresh urls. */
	private onTargetDiscovered(params: any, kind: "created" | "changed"): void {
		const { targetInfo } = params ?? {};
		if (!targetInfo || targetInfo.type !== "page") return;
		const tid = String(targetInfo.targetId);
		if (kind === "created") {
			// new tabs (window.open, target=_blank, tabs new) flow through here
			void this.ensureAttached(tid).catch(() => undefined);
		}
		// url/title straight from the browser — correct even for targets whose
		// session-level frameNavigated we missed (the popup-stall class)
		const sid = this.findSessionForTarget(tid);
		if (sid) {
			const page = this.pages.get(sid);
			if (page) {
				if (targetInfo.url) page.url = String(targetInfo.url);
				if (targetInfo.title !== undefined && targetInfo.title !== "") page.title = String(targetInfo.title);
			}
		}
	}

	/** Target.targetDestroyed — drop the page even if no detach event arrives. */
	private onTargetDestroyed(params: any): void {
		const tid = String(params?.targetId ?? "");
		if (!tid) return;
		const sid = this.findSessionForTarget(tid);
		if (sid) {
			this.pages.delete(sid);
			this.isolatedWorlds.delete(sid);
			this.runPageDisposers(sid);
			if (this.activeSessionId === sid) {
				this.activeSessionId = this.pages.keys().next().value ?? null;
			}
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
				const taps: Array<() => void> = [
					this.conn!.on("Runtime.consoleAPICalled", (_m, p, sid) => {
						if (sid !== sessionId) return;
						this.pushConsole({
							source: "console",
							level: String(p?.type ?? "log"),
							text: (p?.args ?? [])
								.map((a: any) => (a.value !== undefined ? String(a.value) : (a.description ?? "")))
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
							text:
								String(p?.exceptionDetails?.text ?? "") +
								(p?.exceptionDetails?.exception?.description
									? ` ${p.exceptionDetails.exception.description.slice(0, 300)}`
									: ""),
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
						this.handleDialogOpening(sessionId, p);
					}),
					this.conn!.on("Page.downloadWillBegin", (_m, p, sid) => {
						if (sid !== sessionId) return;
						this.pushDownload({
							url: String(p?.url ?? ""),
							filename: String(p?.suggestedFilename ?? "download"),
							state: "inprogress",
							ts: Date.now(),
							id: p?.downloadId !== undefined ? String(p.downloadId) : undefined,
						});
					}),
					this.conn!.on("Page.downloadProgress", (_m, p, sid) => {
						if (sid !== sessionId) return;
						const state =
							p?.state === "completed" ? "completed" : p?.state === "canceled" ? "canceled" : "inprogress";
						this.updateDownload(state, p?.downloadId !== undefined ? String(p.downloadId) : undefined);
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
							// the isolated world died with the document;
							// the next isolated op re-creates it lazily
							this.isolatedWorlds.delete(sessionId);
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
				];
				// per-page taps are disposed on detach — a session with tab churn
				// must not accumulate no-op handlers forever (leak fix)
				this.pageDisposers.set(sessionId, taps);
				// domains AFTER handlers are live — the race window is closed
				await this.conn!.send("Page.enable", {}, { sessionId });
				if (this.stealthCfg?.enabled) {
					// THE stealth line: never Runtime.enable (the CDP
					// signal - verified: modern prepareStackTrace detectors
					// fire on it, stay silent without it). Console capture
					// degrades to Log-domain entries; reported honestly.
					await this.applyStealthToPage(sessionId);
				} else {
					await this.conn!.send("Runtime.enable", {}, { sessionId });
				}
				await this.conn!.send("Network.enable", {}, { sessionId });
				await this.conn!.send("Log.enable", {}, { sessionId });
				if (!this.stealthCfg?.enabled) {
					await this.conn!.send(
						"Emulation.setDeviceMetricsOverride",
						{ width: this.viewport.width, height: this.viewport.height, deviceScaleFactor: 1, mobile: false },
						{ sessionId },
					).catch(() => undefined);
				}
			} catch (err) {
				// a page that closes mid-setup is expected; a SYSTEMATIC
				// failure (engine mismatch, non-standard target) must not be a
				// silent debugging black hole — surface it in the console ring
				this.pushConsole({
					source: "log",
					level: "error",
					text: `page setup failed: ${err instanceof Error ? err.message : String(err)}`,
					ts: Date.now(),
				});
			}
		})();
	}

	/** Resolve one native dialog per the armed policy (default: auto-dismiss). */
	private handleDialogOpening(sessionId: string, p: any): void {
		const armed =
			this.pendingDialogPolicy && Date.now() - this.pendingDialogPolicy.ts < 120_000
				? this.pendingDialogPolicy
				: null;
		this.pendingDialogPolicy = null; // one-shot — the next dialog auto-dismisses again
		const params: Record<string, unknown> = { accept: armed ? armed.accept : false };
		if (armed?.promptText !== undefined) params.promptText = armed.promptText;
		const outcome = armed
			? armed.accept
				? armed.promptText !== undefined
					? `accepted with text ${JSON.stringify(armed.promptText)}`
					: "accepted"
				: "dismissed (armed policy)"
			: "auto-dismissed";
		this.lastDialog = {
			message: String(p?.message ?? ""),
			type: String(p?.type ?? "alert"),
			ts: Date.now(),
		};
		this.dialogRing.push({ ...this.lastDialog, outcome });
		if (this.dialogRing.length > 20) this.dialogRing.shift();
		this.pushConsole({
			source: "dialog",
			level: "warn",
			text: `${this.lastDialog.type} dialog (${outcome}): ${this.lastDialog.message.slice(0, 200)}`,
			ts: Date.now(),
		});
		void this.conn!.send("Page.handleJavaScriptDialog", params, { sessionId }).catch(() => undefined);
	}

	private onTargetDetached(params: any) {
		const { sessionId } = params ?? {};
		if (!sessionId) return;
		this.isolatedWorlds.delete(sessionId);
		this.pages.delete(sessionId);
		this.runPageDisposers(sessionId);
		if (this.activeSessionId === sessionId) {
			this.activeSessionId = this.pages.keys().next().value ?? null;
		}
	}

	private runPageDisposers(sessionId: string): void {
		const taps = this.pageDisposers.get(sessionId);
		if (!taps) return;
		this.pageDisposers.delete(sessionId);
		for (const off of taps) {
			try {
				off();
			} catch {
				/* already gone */
			}
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

	private updateDownload(state: DownloadEntry["state"], downloadId?: string) {
		// concurrent downloads update BY ID; legacy engines without one fall
		// back to the newest in-progress entry
		const target = downloadId
			? this.downloads.find((d) => d.id === downloadId)
			: [...this.downloads].reverse().find((d) => d.state === "inprogress");
		if (target) target.state = state;
	}

	// ------------------------------------------------------------- accessors

	sessionInfo(): SessionInfo {
		const page = this.activeSessionId ? this.pages.get(this.activeSessionId) : undefined;
		return {
			...(this.info ?? { mode: "launch" as const, wsUrl: "(not started)" }),
			pages: this.pages.size,
			activePage: page ? { url: page.url, title: page.title } : undefined,
			viewport: this.viewport,
			stealth: this.stealthCfg
				? {
						enabled: this.stealthCfg.enabled,
						os: this.stealthCfg.identity.os,
						humanize: this.stealthCfg.humanize,
						proxy: this.stealthCfg.proxy,
						userAgent: this.stealthCfg.identity.userAgent,
					}
				: undefined,
			captcha: this.captchaCfg
				? { solver: this.captchaCfg.solver, auto: this.captchaCfg.auto, vision: this.captchaCfg.vision }
				: undefined,
		};
	}

	consoleEntries(level?: string): ConsoleEntry[] {
		if (!level) return [...this.consoleRing];
		// "warn" and "warning" are the same level in two spellings (Log-domain
		// entries carry "warning", console entries "warn") — filtering by one
		// must not silently hide the other
		const want = level.toLowerCase() === "warn" ? "warning" : level.toLowerCase();
		return this.consoleRing.filter((e) => {
			const l = e.level.toLowerCase();
			return l === want || (want === "warning" && l === "warn");
		});
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

	/** Recent native dialogs + how each was resolved (browser dialog list). */
	dialogEntries(): DialogEntry[] {
		return [...this.dialogRing];
	}

	private requireConn(): CdpConnection {
		if (!this.conn || this.conn.isClosed)
			throw new Error("browser is not running — call any browser action to auto-start it");
		return this.conn;
	}

	private requireSessionId(): string {
		if (!this.activeSessionId) throw new Error("no open tab — create one with browser tabs new");
		return this.activeSessionId;
	}

	// ------------------------------------------------------------- primitives

	private async pageEval(
		expression: string,
		opts: { awaitPromise?: boolean; sessionId?: string; world?: "main" | "isolated" } = {},
	): Promise<any> {
		const conn = this.requireConn();
		const sessionId = opts.sessionId ?? this.requireSessionId();
		const params: Record<string, unknown> = {
			expression,
			returnByValue: true,
			awaitPromise: opts.awaitPromise ?? false,
			userGesture: true,
		};
		const world = opts.world ?? (this.stealthCfg?.enabled ? "isolated" : "main");
		if (world === "isolated") params.contextId = await this.ensureIsolatedWorld(sessionId);
		const res = await conn.send("Runtime.evaluate", params, { sessionId });
		if (res.exceptionDetails) {
			const d = res.exceptionDetails;
			const text = d.exception?.description || d.text || "evaluation failed";
			throw new Error(`page JS error: ${String(text).slice(0, 500)}`);
		}
		return res.result?.value;
	}

	/**
	 * Call a page function with ARGUMENTS instead of interpolating values into
	 * evaluated source (js/bad-code-sanitization: no stringifier can be proven
	 * complete for code construction). The function declaration is a static
	 * string; every dynamic value crosses the boundary as a CDP JSON argument —
	 * data, never code. The page's `window` object is resolved fresh each call
	 * so navigation invalidates nothing.
	 */
	private async pageCall(
		functionDeclaration: string,
		args: unknown[],
		opts: { awaitPromise?: boolean; world?: "main" | "isolated" } = {},
	): Promise<any> {
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		const world = opts.world ?? (this.stealthCfg?.enabled ? "isolated" : "main");
		const windowParams: Record<string, unknown> = { expression: "window" };
		if (world === "isolated") windowParams.contextId = await this.ensureIsolatedWorld(sessionId);
		const target = await conn.send("Runtime.evaluate", windowParams, { sessionId });
		const objectId = target?.result?.objectId;
		if (!objectId) throw new Error("page JS error: no window object to call on");
		const res = await conn.send(
			"Runtime.callFunctionOn",
			{
				functionDeclaration,
				objectId,
				arguments: args.map((a) => ({ value: a === undefined ? null : a })),
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

	/**
	 * Bounded readyState wait — the load EVENT can fire before our listener
	 * is armed (a tab created mid-suite attaches after its navigation began),
	 * but document.readyState is always queryable and always truthful.
	 */
	private async waitForPageReady(sessionId: string, timeoutMs = 5_000): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const rs = await this.pageEval("document.readyState", { sessionId }).catch(() => undefined);
			if (rs === "complete") return true;
			if (rs === "interactive") {
				// interactive counts for our purposes — DOM is addressable
				return true;
			}
			await sleep(120);
		}
		return false;
	}

	/** Take a snapshot, refresh the ref registry, return {snap, text}. */
	private async takeSnapshot(opts: { includeBoxes?: boolean } = {}): Promise<{ snap: Snapshot; text: string }> {
		const raw = await this.pageEval(
			`${SNAPSHOT_SCRIPT}(${JSON.stringify({
				maxNodes: BROWSER_SNAPSHOT_MAX,
				includeBoxes: opts.includeBoxes ?? false,
			})})`,
		);
		if (!raw || typeof raw !== "object")
			throw new Error("snapshot failed — the page may have navigated away mid-snapshot; retry");
		const snap = raw as Snapshot;
		this.refs = snapshotRefs(snap, opts.includeBoxes ?? false);
		this.snapshotCount++;
		const page = this.activeSessionId ? this.pages.get(this.activeSessionId) : undefined;
		if (page) {
			page.url = snap.url;
			page.title = snap.title;
		}
		// the char budget the docs always promised (UNOWN_BROWSER_SNAPSHOT_MAX_CHARS,
		// default 60k): a 400-element page with long names/values can otherwise
		// blow far past it straight into the model's context
		let text = formatSnapshot(snap);
		if (text.length > BROWSER_SNAPSHOT_MAX_CHARS) {
			text =
				text.slice(0, BROWSER_SNAPSHOT_MAX_CHARS) +
				`\n… [snapshot truncated at ${BROWSER_SNAPSHOT_MAX_CHARS} chars of ${text.length} — narrow with browser find, or html for a targeted subtree]`;
		}
		return { snap, text };
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
	 * Scroll an element into view and return its fresh VIEWPORT box
	 * (D5 — trusted input needs real coordinates). Resolution pierces open
	 * shadow roots and same-origin iframes — the snapshot walker mints
	 * refs in there, so clicks must reach them too. Iframe content boxes
	 * are offset-compensated so Input coordinates land in the right spot.
	 */
	private async prepElement(selector: string): Promise<number[] | null> {
		const prepped = await this.pageEval(`(() => {
                        const sel = ${JSON.stringify(selector)};
                        function findIn(root) {
                                let el = null;
                                try { el = root.querySelector(sel); } catch (e) { return null; }
                                if (el) return { el: el, frames: [] };
                                for (const k of Array.from(root.querySelectorAll("*"))) {
                                        if (k.shadowRoot) {
                                                const hit = findIn(k.shadowRoot);
                                                if (hit) return hit;
                                        }
                                }
                                for (const f of Array.from(root.querySelectorAll("iframe"))) {
                                        try {
                                                const doc = f.contentDocument;
                                                if (doc && doc.body) {
                                                        const hit = findIn(doc);
                                                        if (hit) return { el: hit.el, frames: [f].concat(hit.frames) };
                                                }
                                        } catch (e) { /* cross-origin */ }
                                }
                                return null;
                        }
                        const hit = findIn(document);
                        if (!hit) return null;
                        try { hit.el.scrollIntoView({ block: "center", inline: "center" }); } catch (e) {}
                        for (const f of hit.frames) {
                                try { f.scrollIntoView({ block: "center", inline: "center" }); } catch (e) {}
                        }
                        const r = hit.el.getBoundingClientRect();
                        if (r.width === 0 && r.height === 0) return null;
                        let x = r.x, y = r.y;
                        for (const f of hit.frames) {
                                const fr = f.getBoundingClientRect();
                                x += fr.x; y += fr.y;
                        }
                        return [Math.round(x), Math.round(y), Math.round(r.width), Math.round(r.height)];
                })()`);
		return Array.isArray(prepped) ? prepped : null;
	}

	private async dispatchClick(
		x: number,
		y: number,
		opts: { button?: string; clickCount?: number; modifiers?: string[] } = {},
	): Promise<void> {
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		const button = opts.button === "right" ? "right" : opts.button === "middle" ? "middle" : "left";
		const mods = modifierBits(opts.modifiers);
		// humanized approach: walk a jittered, eased path from wherever the
		// cursor was to the target, then press. Straight-line teleports are a
		// behavioral tell; this is the tier every stealth product ships.
		if (this.stealthCfg?.enabled && this.stealthCfg.humanize) {
			for (const pt of humanPath(this.mousePos, { x, y }, this.humanRng)) {
				await conn
					.send(
						"Input.dispatchMouseEvent",
						{ type: "mouseMoved", x: pt.x, y: pt.y, pointerType: "mouse" },
						{ sessionId },
					)
					.catch(() => undefined);
				await sleep(pt.delayMs);
			}
		}
		this.mousePos = { x, y };
		const base = {
			x: Math.round(x),
			y: Math.round(y),
			button,
			modifiers: mods,
			clickCount: opts.clickCount ?? 1,
			pointerType: "mouse",
		};
		await conn.send(
			"Input.dispatchMouseEvent",
			{ ...base, type: "mousePressed", buttons: button === "left" ? 1 : button === "right" ? 2 : 4 },
			{ sessionId },
		);
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
				{
					type: "keyDown",
					key: p.key,
					code: p.code,
					windowsVirtualKeyCode: p.vk,
					text: p.text,
					unmodifiedText: p.text,
				},
				{ sessionId },
			);
			await conn.send(
				"Input.dispatchKeyEvent",
				{ type: "keyUp", key: p.key, code: p.code, windowsVirtualKeyCode: p.vk },
				{ sessionId },
			);
			return;
		}
		// Combos (Ctrl+A, cmd+shift+p, Control+Shift+p): modifier key
		// events bracket a rawKeyDown for the final key — carrying `text` on
		// it turns the shortcut into a character insertion and Ctrl+A stops
		// selecting. Modifier bits ACCUMULATE: Control+Shift+p must press
		// with both bits set, not whichever modifier parsed last.
		const mods = parts.filter((p) => isModifier(p.key)).reduce((acc, p) => acc | modifierBits([p.key]), 0);
		let modsNow = 0;
		for (const p of parts) {
			const mod = isModifier(p.key);
			const payload: Record<string, unknown> = {
				type: mod ? "keyDown" : "rawKeyDown",
				key: p.key,
				code: p.code,
				windowsVirtualKeyCode: p.vk,
				nativeVirtualKeyCode: p.vk,
				modifiers: mod ? modsNow : mods,
			};
			if (mod) modsNow |= modifierBits([p.key]);
			if (!mod && p.text && mods === 0) {
				payload.text = p.text;
				payload.unmodifiedText = p.text;
			}
			await conn.send("Input.dispatchKeyEvent", payload, { sessionId });
		}
		let modsRel = mods;
		for (const p of [...parts].reverse()) {
			await conn.send(
				"Input.dispatchKeyEvent",
				{
					type: "keyUp",
					key: p.key,
					code: p.code,
					windowsVirtualKeyCode: p.vk,
					nativeVirtualKeyCode: p.vk,
					modifiers: modsRel,
				},
				{ sessionId },
			);
			if (isModifier(p.key)) modsRel &= ~modifierBits([p.key]);
		}
	}

	// ------------------------------------------------------------- actions

	/** Element locator: ref (preferred), selector, or explicit coords. */
	async locate(opts: {
		ref?: string;
		selector?: string;
	}): Promise<{ selector?: string; box: number[]; center: { x: number; y: number } }> {
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
	private async raceNavigate(
		conn: import("./cdp.ts").CdpConnection,
		sessionId: string,
		url: string,
	): Promise<boolean> {
		const loaded = this.waitForLoad(sessionId);
		try {
			await conn.send("Page.navigate", { url }, { sessionId });
		} catch (e: any) {
			// net errors surface here (ERR_NAME_NOT_RESOLVED etc.)
			void loaded;
			throw new Error(`navigation failed: ${e instanceof Error ? e.message : String(e)}`);
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
		// v2: captcha detection on every navigate (cheap, isolated); solving
		// runs automatically only when UNOWN_CAPTCHA_AUTO=1 and a tier is armed
		const warnings: string[] = [];
		let captchaLine: string | undefined;
		const check = await this.captchaQuickCheck();
		if (check) {
			captchaLine = `captcha: ${check.lines[0]}${check.lines.length > 1 ? ` (+${check.lines.length - 1} more)` : ""}`;
			if (check.blocked) warnings.push("page looks BLOCKED by a challenge interstitial");
			if (this.captchaCfg?.auto) {
				const r = await this.captchaSolve({ attempt: "all" }).catch(
					(e: any) =>
						({
							summary: `auto-solve failed: ${e instanceof Error ? e.message : String(e)}`,
							details: [],
						}) as ActionReport,
				);
				captchaLine += ` | auto-solve: ${r.summary}`;
			}
		}
		const summary = `navigated to ${snap.url}${loaded ? "" : " (load timed out — page may still be loading)"}${captchaLine ? ` - ${captchaLine}` : ""}`;
		return {
			summary,
			snapshot: text,
			url: snap.url,
			title: snap.title,
			warnings: warnings.length ? warnings : undefined,
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
			// the deny-list gates EVERY navigation path — history included
			// (tabs new and eval location.href complete the set)
			const dest = String(entries[to].url ?? "");
			if (dest && !/^about:/i.test(dest)) {
				const gate = urlAllowed(dest, this.env.blockList);
				if (!gate.ok)
					throw new Error(`navigation blocked by UNOWN_BROWSER_BLOCK (pattern ${gate.blockedBy}): ${dest}`);
			}
			await conn.send("Page.navigateToHistoryEntry", { entryId: entries[to].id }, { sessionId });
		}
		await this.waitForLoad(sessionId, 2_000).catch(() => undefined);
		await this.waitForPageReady(sessionId, 5_000);
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
		const matches = snapText.split("\n").filter((l) => l.toLowerCase().includes(needle));
		if (matches.length === 0) {
			return {
				summary: `no snapshot lines match ${JSON.stringify(text)}`,
				snapshot: snapText.split("\n").slice(0, 10).join("\n"),
			};
		}
		return {
			summary: `${matches.length} matching line(s) for ${JSON.stringify(text)}`,
			details: matches.slice(0, 30),
		};
	}

	async getText(): Promise<ActionReport> {
		await this.ensureStarted();
		const text = await this.pageEval(`document.body ? document.body.innerText : ""`);
		const capped = String(text ?? "").slice(0, 60_000);
		return { summary: `page text (${capped.length} chars)`, details: [capped] };
	}

	async getHtml(selector?: string): Promise<ActionReport> {
		await this.ensureStarted();
		const html = await this.pageCall(
			"(sel) => (sel ? (document.querySelector(sel) || {}).outerHTML : document.documentElement.outerHTML)",
			[selector ?? null],
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
			label = opts.ref ? `[${opts.ref}]` : (opts.selector ?? "");
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
		// humanized approach in stealth — and the cursor ORIGIN moves here, so
		// the next humanized click path starts from reality, not a stale point
		if (this.stealthCfg?.enabled && this.stealthCfg.humanize) {
			for (const pt of humanPath(this.mousePos, loc.center, this.humanRng)) {
				await conn
					.send(
						"Input.dispatchMouseEvent",
						{ type: "mouseMoved", x: pt.x, y: pt.y, pointerType: "mouse" },
						{ sessionId },
					)
					.catch(() => undefined);
				await sleep(pt.delayMs);
			}
		}
		this.mousePos = { x: loc.center.x, y: loc.center.y };
		await conn.send(
			"Input.dispatchMouseEvent",
			{ type: "mouseMoved", x: Math.round(loc.center.x), y: Math.round(loc.center.y), pointerType: "mouse" },
			{ sessionId },
		);
		await this.settle(150);
		const { snap, text } = await this.takeSnapshot();
		return {
			summary: `hovered ${opts.ref ? `[${opts.ref}]` : opts.selector}`,
			snapshot: text,
			url: snap.url,
			title: snap.title,
		};
	}

	/** Select-all key combo for the HOST platform (Cmd+A on macOS — Ctrl+A
	 *  there is line-start, and clear/type would append instead of replace). */
	private selectAllCombo(): string {
		return process.platform === "darwin" ? "Meta+a" : "Control+a";
	}

	/** Insert text: instant paste classically, per-char humanized in stealth. */
	private async insertText(text: string): Promise<void> {
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		if (this.stealthCfg?.enabled && this.stealthCfg.humanize) {
			const delays = humanTypeDelays(text, this.humanRng);
			for (let i = 0; i < text.length; i++) {
				const ch = text[i];
				await sleep(delays[i]);
				if (ch === "\n") {
					await conn.send(
						"Input.dispatchKeyEvent",
						{
							type: "keyDown",
							key: "Enter",
							code: "Enter",
							windowsVirtualKeyCode: 13,
							text: "\r",
							unmodifiedText: "\r",
						},
						{ sessionId },
					);
					await sleep(humanKeyGap(this.humanRng));
					await conn.send(
						"Input.dispatchKeyEvent",
						{ type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
						{ sessionId },
					);
					continue;
				}
				const vk = ch.toUpperCase().charCodeAt(0);
				const code = /^[a-zA-Z]$/.test(ch)
					? `Key${ch.toUpperCase()}`
					: /^[0-9]$/.test(ch)
						? `Digit${ch}`
						: undefined;
				await conn.send(
					"Input.dispatchKeyEvent",
					{ type: "keyDown", key: ch, code, windowsVirtualKeyCode: vk, text: ch, unmodifiedText: ch },
					{ sessionId },
				);
				await sleep(humanKeyGap(this.humanRng));
				await conn.send(
					"Input.dispatchKeyEvent",
					{ type: "keyUp", key: ch, code, windowsVirtualKeyCode: vk },
					{ sessionId },
				);
			}
		} else {
			// insertText fires real input events (works with React/Vue controlled inputs)
			await conn.send("Input.insertText", { text }, { sessionId });
		}
	}

	async type(opts: {
		ref?: string;
		selector?: string;
		text: string;
		submit?: boolean;
		clear?: boolean;
	}): Promise<ActionReport> {
		await this.ensureStarted();
		if (opts.ref || opts.selector) {
			const loc = await this.locate(opts);
			// focus the element with a trusted click at its center
			await this.dispatchClick(loc.center.x, loc.center.y);
		}
		if (opts.clear) {
			await this.pressKeyCombo(this.selectAllCombo());
			await this.pressKeyCombo("Backspace");
		}
		if (opts.text.length > 0) {
			await this.insertText(opts.text);
		}
		if (opts.submit) {
			await this.pressKeyCombo("Enter");
		}
		await this.settle();
		const { snap, text } = await this.takeSnapshot();
		return {
			summary: `typed ${JSON.stringify(opts.text.slice(0, 60))}${opts.submit ? " + Enter" : ""} into ${opts.ref ? `[${opts.ref}]` : (opts.selector ?? "focused element")}`,
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
			//   everything else → click to focus, clear, insert text
			// The kind probe pierces shadow roots + same-origin iframes —
			// refs minted in there must fill, not just render.
			const kind = await this.pageEval(`(() => {
                                const sel = ${JSON.stringify(selector)};
                                function findIn(root) {
                                        let el = null;
                                        try { el = root.querySelector(sel); } catch (e) { return null; }
                                        if (el) return el;
                                        for (const k of Array.from(root.querySelectorAll("*"))) {
                                                if (k.shadowRoot) { const hit = findIn(k.shadowRoot); if (hit) return hit; }
                                        }
                                        for (const f of Array.from(root.querySelectorAll("iframe"))) {
                                                try {
                                                        const doc = f.contentDocument;
                                                        if (doc && doc.body) { const hit = findIn(doc); if (hit) return hit; }
                                                } catch (e) {}
                                        }
                                        return null;
                                }
                                const el = findIn(document);
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
			await this.pressKeyCombo(this.selectAllCombo());
			await this.pressKeyCombo("Backspace");
			// humanized per-char typing in stealth — an instant paste is the
			// exact behavioral tell type() carefully avoids; fill_form must
			// not reintroduce it in the very mode that promises humanize
			await this.insertText(f.value);
			notes.push(`${f.ref ? `[${f.ref}]` : f.selector} = ${JSON.stringify(f.value.slice(0, 40))}`);
		}
		await this.settle();
		const { snap, text } = await this.takeSnapshot();
		return {
			summary: `filled ${fields.length} field(s)`,
			details: notes,
			snapshot: text,
			url: snap.url,
			title: snap.title,
		};
	}

	async selectOption(opts: { ref?: string; selector?: string; values: string[] }): Promise<ActionReport> {
		await this.ensureStarted();
		const selector = opts.ref ? `[data-unown-ref="${opts.ref}"]` : opts.selector;
		if (!selector) throw new Error("select_option needs a ref or selector");
		// native setter + change events (React-safe) — resolution pierces
		// shadow roots + same-origin iframes like every other ref action
		const applied = await this.pageEval(`(() => {
                        const sel = ${JSON.stringify(selector)};
                        function findIn(root) {
                                let el = null;
                                try { el = root.querySelector(sel); } catch (e) { return null; }
                                if (el) return el;
                                for (const k of Array.from(root.querySelectorAll("*"))) {
                                        if (k.shadowRoot) { const hit = findIn(k.shadowRoot); if (hit) return hit; }
                                }
                                for (const f of Array.from(root.querySelectorAll("iframe"))) {
                                        try {
                                                const doc = f.contentDocument;
                                                if (doc && doc.body) { const hit = findIn(doc); if (hit) return hit; }
                                        } catch (e) {}
                                }
                                return null;
                        }
                        const el = findIn(document);
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

	async scroll(opts: {
		direction?: "up" | "down" | "left" | "right";
		amount?: number;
		ref?: string;
		selector?: string;
	}): Promise<ActionReport> {
		await this.ensureStarted();
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		const direction = opts.direction ?? "down";
		const amount = Math.max(1, Math.round(opts.amount ?? 600));
		if (opts.ref || opts.selector) {
			// scroll an element into view (Playwright scroll_into_view semantics)
			const loc = await this.locate(opts);
			const _box = await this.pageEval(`(() => {
                                const el = document.querySelector(${JSON.stringify(loc.selector)});
                                if (!el) return null;
                                el.scrollIntoView({ block: "center" });
                                const r = el.getBoundingClientRect();
                                return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
                        })()`);
			const { snap, text } = await this.takeSnapshot();
			return {
				summary: `scrolled ${opts.ref ? `[${opts.ref}]` : opts.selector} into view`,
				snapshot: text,
				url: snap.url,
				title: snap.title,
			};
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
			{
				type: "mouseWheel",
				x: Math.round(width / 2),
				y: Math.round(height / 2),
				deltaX: dx,
				deltaY: dy,
				pointerType: "mouse",
			},
			{ sessionId },
		);
		await this.settle(150);
		const { snap, text } = await this.takeSnapshot();
		const scrolled = await this.pageEval(`window.scrollY`);
		return {
			summary: `scrolled ${direction} by ${amount}px (scrollY=${Math.round(Number(scrolled ?? 0))})`,
			snapshot: text,
			url: snap.url,
			title: snap.title,
		};
	}

	async drag(opts: {
		startRef?: string;
		startSelector?: string;
		endRef?: string;
		endSelector?: string;
	}): Promise<ActionReport> {
		await this.ensureStarted();
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		const start = await this.locate({ ref: opts.startRef, selector: opts.startSelector });
		const end = await this.locate({ ref: opts.endRef, selector: opts.endSelector });
		const base = { button: "left", clickCount: 1, pointerType: "mouse" };
		await conn.send(
			"Input.dispatchMouseEvent",
			{ ...base, type: "mousePressed", x: Math.round(start.center.x), y: Math.round(start.center.y) },
			{ sessionId },
		);
		if (this.stealthCfg?.enabled && this.stealthCfg.humanize) {
			// a human drag is a curved, eased path — a straight 8-step line is
			// exactly the robotic signature humanPath exists to avoid
			for (const pt of humanPath(start.center, end.center, this.humanRng)) {
				await conn
					.send(
						"Input.dispatchMouseEvent",
						{ type: "mouseMoved", x: pt.x, y: pt.y, button: "left", buttons: 1, pointerType: "mouse" },
						{ sessionId },
					)
					.catch(() => undefined);
				await sleep(pt.delayMs);
			}
		} else {
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
		}
		await conn.send(
			"Input.dispatchMouseEvent",
			{ ...base, type: "mouseReleased", x: Math.round(end.center.x), y: Math.round(end.center.y) },
			{ sessionId },
		);
		this.mousePos = { x: end.center.x, y: end.center.y };
		await this.settle();
		const { snap, text } = await this.takeSnapshot();
		return {
			summary: `dragged from ${opts.startRef ? `[${opts.startRef}]` : opts.startSelector} to ${opts.endRef ? `[${opts.endRef}]` : opts.endSelector}`,
			snapshot: text,
			url: snap.url,
			title: snap.title,
		};
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

	async evalCode(code: string, opts: { world?: "main" | "isolated" } = {}): Promise<ActionReport> {
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
				value = await this.pageEval(expression, { awaitPromise: true, world: opts.world });
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
		return {
			summary: `eval → ${rendered.slice(0, 80)}${rendered.length > 80 ? "…" : ""}`,
			details: [rendered.slice(0, 60_000)],
		};
	}

	async tabs(
		action: "list" | "new" | "select" | "close",
		opts: { index?: number; url?: string } = {},
	): Promise<ActionReport> {
		await this.ensureStarted();
		const conn = this.requireConn();
		const list = () =>
			Array.from(this.pages.values()).map((p, i) => `${i}: ${p.title || "(untitled)"}${p.url ? ` — ${p.url}` : ""}`);
		if (action === "list") {
			return { summary: `${this.pages.size} tab(s)`, details: list() };
		}
		if (action === "new") {
			const url = opts.url ? normalizeUrl(opts.url) : "about:blank";
			if (opts.url) {
				// the deny-list gates every navigation path — tabs new
				// included, not just navigate
				const gate = urlAllowed(url, this.env.blockList);
				if (!gate.ok)
					throw new Error(`navigation blocked by UNOWN_BROWSER_BLOCK (pattern ${gate.blockedBy}): ${url}`);
			}
			const { targetId } = await conn.send("Target.createTarget", { url });
			// wait for discovery + explicit attach to hand us the session
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
					// short event wait + readyState fallback: the load event may
					// have fired before our attach armed the listener (a 30 s
					// waitForLoad here was the stress round's tabs-new stall)
					await this.waitForLoad(sid, 2_000).catch(() => undefined);
					await this.waitForPageReady(sid, 5_000);
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

	async wait(opts: {
		text?: string;
		textGone?: string;
		url?: string;
		time?: number;
		download?: boolean;
		timeoutMs?: number;
	}): Promise<ActionReport> {
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
				const has = await this.pageEval(
					`document.body ? document.body.innerText.includes(${JSON.stringify(opts.text)}) : false`,
				).catch(() => false);
				if (has) {
					notes.push(`text ${JSON.stringify(opts.text)} present`);
					break;
				}
				await sleep(200);
				if (Date.now() >= deadline)
					throw new Error(`wait timed out after ${timeoutMs}ms: text ${JSON.stringify(opts.text)} not found`);
			}
		}
		if (opts.textGone) {
			while (Date.now() < deadline) {
				const has = await this.pageEval(
					`document.body ? document.body.innerText.includes(${JSON.stringify(opts.textGone)}) : false`,
				).catch(() => false);
				if (!has) {
					notes.push(`text ${JSON.stringify(opts.textGone)} gone`);
					break;
				}
				await sleep(200);
				if (Date.now() >= deadline)
					throw new Error(
						`wait timed out after ${timeoutMs}ms: text ${JSON.stringify(opts.textGone)} still present`,
					);
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
				if (Date.now() >= deadline)
					throw new Error(`wait timed out after ${timeoutMs}ms: url never contained ${JSON.stringify(opts.url)}`);
			}
		}
		if (opts.download) {
			// Semantics (the trigger-then-wait contract): satisfied when the
			// most recent download is completed — a small file can finish
			// entirely during the triggering click's settle — or when a
			// download transitions to completed while we poll. Concurrent
			// downloads are tracked BY ID, so both files of a pair report.
			const startState = new Map(this.downloads.map((d) => [d, d.state]));
			while (Date.now() < deadline) {
				const inprogress = this.downloads.filter((d) => d.state === "inprogress");
				const last = this.downloads[this.downloads.length - 1];
				const becameDone = this.downloads.filter(
					(d) => d.state === "completed" && startState.get(d) !== "completed",
				);
				const becameCanceled = this.downloads.filter(
					(d) => d.state === "canceled" && startState.get(d) !== "canceled",
				);
				if (!inprogress.length && last && last.state === "completed") {
					notes.push(`download complete: ${last.filename}`);
					break;
				}
				if (!inprogress.length && becameDone.length) {
					notes.push(`download complete: ${becameDone.map((d) => d.filename).join(", ")}`);
					break;
				}
				if (!inprogress.length && becameCanceled.length) {
					throw new Error(`download canceled: ${becameCanceled.map((d) => d.filename).join(", ")}`);
				}
				await sleep(250);
				if (Date.now() >= deadline) throw new Error(`wait timed out after ${timeoutMs}ms: no completed download`);
			}
		}
		const { snap, text } = await this.takeSnapshot();
		return {
			summary: `waited (${notes.join("; ") || "no condition"})`,
			snapshot: text,
			url: snap.url,
			title: snap.title,
		};
	}

	async resize(width: number, height: number): Promise<ActionReport> {
		await this.ensureStarted();
		this.viewport = { width, height };
		const id = this.stealthCfg?.enabled ? this.stealthCfg.identity : undefined;
		const params: Record<string, unknown> = { width, height, deviceScaleFactor: 1, mobile: false };
		if (id) {
			params.screenWidth = id.screen.width;
			params.screenHeight = id.screen.height;
			params.screenOrientation = { angle: 0, type: "landscapePrimary" };
		}
		const sessionId = this.requireSessionId();
		await this.conn!.send("Emulation.setDeviceMetricsOverride", params, { sessionId }).catch(() =>
			this.conn!.send(
				"Emulation.setDeviceMetricsOverride",
				{ width, height, deviceScaleFactor: 1, mobile: false },
				{ sessionId },
			).catch(() => undefined),
		);
		return { summary: `viewport ${width}x${height}` };
	}

	/**
	 * Native-dialog policy (the stress round's s5 finding: prompt() dialogs
	 * could never be ANSWERED — every dialog was auto-dismissed, so “type
	 * green into the prompt” was impossible). `list` shows the dialog ring;
	 * `accept`/`dismiss` arm a one-shot policy for the NEXT dialog — then
	 * trigger it (the click that opens it) and the dialog resolves your way.
	 */
	async dialog(action: "list" | "accept" | "dismiss", opts: { text?: string } = {}): Promise<ActionReport> {
		if (action === "list") {
			const entries = this.dialogEntries();
			return {
				summary: `${entries.length} dialog(s)`,
				details: entries.length
					? entries.map((d) => `[${d.type}] ${d.message} → ${d.outcome}`)
					: ["(no dialogs yet)"],
			};
		}
		this.pendingDialogPolicy = {
			accept: action === "accept",
			promptText: opts.text,
			ts: Date.now(),
		};
		return {
			summary: `next dialog will be ${action === "accept" ? "accepted" : "dismissed"}${opts.text !== undefined ? ` with text ${JSON.stringify(opts.text)}` : ""}`,
			details: ["the policy is one-shot — now trigger the dialog (e.g. click the button that opens it)"],
		};
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
		// 1) explicit input element — resolution pierces shadow roots and
		// same-origin iframes (refs minted in there must upload too); the
		// element is resolved to a Runtime objectId, then DOM.requestNode
		// mints the nodeId DOM.setFileInputFiles needs
		if (opts.ref || opts.selector) {
			const selector = opts.ref ? `[data-unown-ref="${opts.ref}"]` : opts.selector!;
			const res = await conn.send(
				"Runtime.evaluate",
				{
					expression: `(() => {
                                                const sel = ${JSON.stringify(selector)};
                                                function findIn(root) {
                                                        let el = null;
                                                        try { el = root.querySelector(sel); } catch (e) { return null; }
                                                        if (el) return el;
                                                        for (const k of Array.from(root.querySelectorAll("*"))) {
                                                                if (k.shadowRoot) { const hit = findIn(k.shadowRoot); if (hit) return hit; }
                                                        }
                                                        for (const f of Array.from(root.querySelectorAll("iframe"))) {
                                                                try {
                                                                        const doc = f.contentDocument;
                                                                        if (doc && doc.body) { const hit = findIn(doc); if (hit) return hit; }
                                                                } catch (e) {}
                                                        }
                                                        return null;
                                                }
                                                const el = findIn(document);
                                                if (!el || el.tagName !== "INPUT" || el.type !== "file") return null;
                                                return el;
                                        })()`,
					returnByValue: false,
					userGesture: true,
				},
				{ sessionId },
			);
			const objectId = res?.result?.objectId;
			if (!objectId) throw new Error(`upload: no file input for ${opts.ref ?? opts.selector}`);
			// DOM.getDocument arms the DOM agent — requestNode without it
			// answers an empty payload (measured on Chrome 143)
			await conn.send("DOM.getDocument", { depth: 0 }, { sessionId }).catch(() => undefined);
			const node = await conn.send("DOM.requestNode", { objectId }, { sessionId });
			if (!node?.nodeId) throw new Error(`upload: cannot resolve a DOM node for ${opts.ref ?? opts.selector}`);
			await conn.send("DOM.setFileInputFiles", { files: paths, nodeId: node.nodeId }, { sessionId });
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
		throw new Error(
			"upload needs a ref/selector of the file input, or a file chooser opened by a click (click the upload button first, then upload without a ref)",
		);
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
		const filename =
			opts.filename && isAbsolute(opts.filename)
				? opts.filename
				: join(this.cwd, opts.filename ?? `page-${Date.now()}.pdf`);
		writeFileSync(filename, Buffer.from(data, "base64"));
		return {
			summary: `printed PDF (${Math.round((data.length * 3) / 4 / 1024)} KB)`,
			details: [`saved: ${filename}`],
		};
	}

	async cookies(
		action: "list" | "set" | "clear",
		opts: { url?: string; name?: string; value?: string; domain?: string; path?: string } = {},
	): Promise<ActionReport> {
		await this.ensureStarted();
		const conn = this.requireConn();
		const sessionId = this.requireSessionId();
		if (action === "list") {
			const url = opts.url ?? (await this.pageEval(`location.href`));
			const res = await conn.send("Network.getCookies", { urls: [String(url)] }, { sessionId });
			const cookies = res?.cookies ?? [];
			const lines = cookies.map(
				(c: any) =>
					`${c.name}=${String(c.value).slice(0, 40)} (domain ${c.domain}${c.expires ? `, expires ${new Date(c.expires * 1000).toISOString()}` : ""})`,
			);
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
		const local = await this.pageEval(
			`(() => { try { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; } catch (e) { return null; } })()`,
		).catch(() => null);
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
			throw new Error(`cannot read storage state ${path}: ${err instanceof Error ? err.message : String(err)}`);
		}
		const sessionId = this.requireSessionId();
		let n = 0;
		for (const c of payload.cookies ?? []) {
			const res = await conn
				.send(
					"Network.setCookie",
					{
						name: c.name,
						value: c.value ?? "",
						domain: c.domain,
						path: c.path ?? "/",
						secure: !!c.secure,
						httpOnly: !!c.httpOnly,
						expires: c.expires,
						sameSite: c.sameSite === "Strict" ? "Strict" : c.sameSite === "Lax" ? "Lax" : undefined,
					},
					{ sessionId },
				)
				.catch(() => ({ success: false }));
			if ((res as any)?.success !== false) n++;
		}
		if (payload.localStorage && Object.keys(payload.localStorage).length) {
			await this.pageCall(
				"(o) => { for (const k of Object.keys(o)) { try { localStorage.setItem(k, o[k]); } catch (e) {} }",
				[payload.localStorage],
			).catch(() => undefined);
		}
		return { summary: `loaded storage state from ${path} (${n} cookies)` };
	}

	// ------------------------------------------------------------- v2: stealth internals

	/**
	 * Apply the stealth tier to one page session: CDP-native fingerprint
	 * overrides (no page-JS patching) + coherent screen metrics. Verified
	 * against Chrome 143 (scripts-dev/dbg-stealth-probe3.ts): UA, platform,
	 * userAgentData brands/platform, locale, timezone and screen all land
	 * coherently. Called per page attach, before Network/Log enables, and
	 * NEVER enables the Runtime domain.
	 */
	private async applyStealthToPage(sessionId: string): Promise<void> {
		const conn = this.conn!;
		const id = this.stealthCfg!.identity;
		// device metrics + SCREEN: fixes the 800x600 headless default
		// (screenWidth/Height still accepted by Chrome 143; degraded
		// gracefully on older engines)
		await conn
			.send(
				"Emulation.setDeviceMetricsOverride",
				{
					width: this.viewport.width,
					height: this.viewport.height,
					deviceScaleFactor: 1,
					mobile: false,
					screenWidth: id.screen.width,
					screenHeight: id.screen.height,
					screenOrientation: { angle: 0, type: "landscapePrimary" },
				},
				{ sessionId },
			)
			.catch(async () => {
				await conn
					.send(
						"Emulation.setDeviceMetricsOverride",
						{ width: this.viewport.width, height: this.viewport.height, deviceScaleFactor: 1, mobile: false },
						{ sessionId },
					)
					.catch(() => undefined);
			});
		// UA + platform + full client hints, network-level
		await conn
			.send(
				"Network.setUserAgentOverride",
				{
					userAgent: id.userAgent,
					acceptLanguage: id.acceptLanguage,
					platform: id.platform,
					userAgentMetadata: id.uaMetadata,
				},
				{ sessionId },
			)
			.catch(() => undefined);
		await conn.send("Emulation.setLocaleOverride", { locale: id.locale }, { sessionId }).catch(() => undefined);
		await conn
			.send("Emulation.setTimezoneOverride", { timezoneId: id.timezone }, { sessionId })
			.catch(() => undefined);
	}

	/** Get (or lazily create) the isolated world for a page session. */
	private async ensureIsolatedWorld(sessionId: string): Promise<number> {
		const cached = this.isolatedWorlds.get(sessionId);
		if (cached) return cached;
		const conn = this.requireConn();
		const tree = await conn.send("Page.getFrameTree", {}, { sessionId });
		const frameId = tree?.frameTree?.frame?.id;
		if (!frameId) throw new Error("cannot create isolated world: no main frame yet");
		const world = await conn.send(
			"Page.createIsolatedWorld",
			{ frameId, worldName: "unown", grantUniveralAccess: false },
			{ sessionId },
		);
		const ctxId = Number(world?.executionContextId);
		if (!ctxId) throw new Error("createIsolatedWorld returned no executionContextId");
		this.isolatedWorlds.set(sessionId, ctxId);
		return ctxId;
	}

	// ------------------------------------------------------------- v2: stealth actions

	/** Report the stealth + captcha tier configuration. */
	async stealthStatus(): Promise<ActionReport> {
		if (!this.captchaCfg) this.captchaCfg = resolveCaptchaConfig(this.env);
		if (!this.stealthCfg) {
			this.stealthCfg = resolveStealthConfig({
				enabled: this.env.stealth,
				overrides: this.stealthOverridesFromEnv(),
			});
		}
		const st = this.stealthCfg;
		const cc = this.captchaCfg;
		const details: string[] = [
			`stealth: ${st.enabled ? "ON" : "off"}${this.isRunning ? "" : " (not started - values are the pre-start config)"}`,
			`identity: os=${st.identity.os} ua=${st.identity.userAgent}`,
			`platform=${st.identity.platform} uaCh.platform=${st.identity.uaMetadata.platform} platformVersion=${st.identity.uaMetadata.platformVersion}`,
			`locale=${st.identity.locale} timezone=${st.identity.timezone}`,
			`screen=${st.identity.screen.width}x${st.identity.screen.height} viewport=${st.identity.viewport.width}x${st.identity.viewport.height}`,
			`humanize: ${st.humanize ? "on" : "off"} (seeded: ${process.env.UNOWN_BROWSER_HUMANIZE_SEED ? "yes" : "no"})`,
			`proxy: ${st.proxy ?? "(none - your IP is what sites see)"}`,
			"protocol: " +
				(st.enabled
					? "no Runtime.enable (CDP signal silent), isolated-world ops"
					: "classic (Runtime domain enabled)"),
			`captcha: solver=${cc.solver} auto=${cc.auto} vision=${cc.vision ? `on (${cc.visionModel} via ${cc.visionBaseUrl})` : "off (set UNOWN_VISION_API_KEY or AGNES_API_KEY)"}`,
		];
		return {
			summary: `stealth ${st.enabled ? "ON" : "off"} - os=${st.identity.os}, humanize=${st.humanize ? "on" : "off"}, captcha=${cc.solver}`,
			details,
		};
	}

	/** In-page coherence self-check: read the live fingerprint and compare. */
	async stealthVerify(): Promise<ActionReport> {
		await this.ensureStarted();
		const st = this.stealthCfg;
		if (!st?.enabled) {
			return {
				summary: "stealth is off - start with stealth=true to verify a stealth identity",
				details: ["(classic mode reports its real engine fingerprint by design)"],
			};
		}
		const fp = await this.pageEval(`(() => {
                        const uad = (typeof navigator.userAgentData === "undefined") ? null : {
                                platform: navigator.userAgentData.platform,
                                mobile: navigator.userAgentData.mobile,
                                brands: navigator.userAgentData.brands.map((b) => b.brand + ":" + b.version).join(","),
                        };
                        return {
                                webdriver: navigator.webdriver,
                                ua: navigator.userAgent,
                                platform: navigator.platform,
                                uad,
                                tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
                                locale: Intl.DateTimeFormat().resolvedOptions().locale,
                                screen: [screen.width, screen.height],
                                inner: [innerWidth, innerHeight],
                                plugins: navigator.plugins.length,
                                chrome: typeof window.chrome,
                                notification: (typeof Notification !== "undefined") ? Notification.permission : "absent",
                        };
                })()`);
		const id = st.identity;
		const checks: Array<[string, boolean, string]> = [];
		checks.push(["navigator.webdriver is false", fp.webdriver === false, String(fp.webdriver)]);
		checks.push(["userAgent matches identity", fp.ua === id.userAgent, String(fp.ua)]);
		checks.push(["navigator.platform matches", fp.platform === id.platform, String(fp.platform)]);
		checks.push([
			"userAgentData coherent",
			!!fp.uad && fp.uad.platform === id.uaMetadata.platform && fp.uad.mobile === id.uaMetadata.mobile,
			fp.uad ? `${fp.uad.platform} [${fp.uad.brands}]` : "absent",
		]);
		checks.push(["timezone matches", fp.tz === id.timezone, String(fp.tz)]);
		checks.push(["locale matches", String(fp.locale).startsWith(id.locale), String(fp.locale)]);
		checks.push([
			"screen matches",
			fp.screen[0] === id.screen.width && fp.screen[1] === id.screen.height,
			String(fp.screen),
		]);
		checks.push([
			"viewport matches",
			fp.inner[0] === this.viewport.width && fp.inner[1] === this.viewport.height,
			String(fp.inner),
		]);
		checks.push(["plugins present", Number(fp.plugins) > 0, String(fp.plugins)]);
		checks.push(["window.chrome present", fp.chrome !== "undefined", String(fp.chrome)]);
		const failed = checks.filter(([, ok]) => !ok);
		return {
			summary: `stealth verify: ${checks.length - failed.length}/${checks.length} coherent${failed.length ? " - MISMATCHES PRESENT" : ""}`,
			details: checks.map(([name, ok, actual]) => `${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` (got ${actual})`}`),
			warnings: failed.length ? [`fingerprint mismatches: ${failed.map(([n]) => n).join("; ")}`] : undefined,
		};
	}

	// ------------------------------------------------------------- v2: captcha pipeline

	/** Run the in-page detection probe (isolated world in stealth mode). */
	async captchaDetect(): Promise<ActionReport> {
		await this.ensureStarted();
		const raw = await this.pageEval(CAPTCHA_PROBE_SRC, { awaitPromise: false });
		const challenges = (raw?.challenges ?? []) as DetectedChallenge[];
		const blocked = !!raw?.blocked;
		return {
			summary: challenges.length
				? `captcha detected: ${challenges.map((c) => c.type).join(", ")}`
				: "no captcha detected",
			details: formatChallenges(challenges, blocked).split("\n"),
			warnings: blocked ? ["the page looks BLOCKED by a challenge interstitial"] : undefined,
		};
	}

	/** Click a Turnstile/reCAPTCHA checkbox at input level (native tier). */
	private async captchaNativeClick(challenge: DetectedChallenge): Promise<{ clicked: boolean; note: string }> {
		// js/bad-code-sanitization: challenge.type is page-derived data — it
		// crosses as a CDP JSON argument (pageCall), never interpolated into
		// evaluated source. Static declaration, data argument.
		const box = await this.pageCall(
			`(t) => {
                                let el = null;
                                if (t === "cloudflare-turnstile") {
                                        el = document.querySelector('iframe[src*="challenges.cloudflare.com"]') || document.querySelector(".cf-turnstile");
                                } else if (t === "recaptcha-v2") {
                                        el = document.querySelector('iframe[title="reCAPTCHA"], iframe[src*="recaptcha/api2/anchor"]');
                                } else if (t === "hcaptcha") {
                                        el = document.querySelector('iframe[src*="hcaptcha.com"], .h-captcha");
                                }
                                if (!el) return null;
                                const r = el.getBoundingClientRect();
                                return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
                        }`,
			[challenge.type],
		);
		if (!Array.isArray(box)) return { clicked: false, note: "no widget box found for the native click" };
		// the checkbox sits at the left edge, vertically centered
		const cx = box[0] + Math.max(14, Math.min(28, Math.round(box[2] * 0.12)));
		const cy = box[1] + Math.round(box[3] / 2);
		await this.dispatchClick(cx, cy);
		await this.settle(2_500);
		// verify: does the response field now hold a token?
		const field =
			challenge.type === "recaptcha-v2"
				? "textarea#g-recaptcha-response, .g-recaptcha-response"
				: challenge.type === "hcaptcha"
					? 'textarea[name="h-captcha-response"]'
					: 'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]';
		const val = await this.pageCall(
			'(sel) => { const el = document.querySelector(sel); return el ? String(el.value || "").length : 0; }',
			[field],
		).catch(() => 0);
		const solved = Number(val) > 20;
		return {
			clicked: true,
			note: solved
				? `native click solved it (token present, ${val} chars)`
				: "native click landed but no token yet (challenge may be interactive/explicit)",
		};
	}

	/** The full solve pipeline — every detected challenge when no type is given. */
	async captchaSolve(opts: {
		type?: string;
		attempt?: "all" | "native" | "service" | "vision";
	}): Promise<ActionReport> {
		await this.ensureStarted();
		const cfg = this.captchaCfg!;
		const attempt = opts.attempt ?? "all";
		const raw = await this.pageEval(CAPTCHA_PROBE_SRC, { awaitPromise: false });
		const challenges = (raw?.challenges ?? []) as DetectedChallenge[];
		if (!challenges.length) return { summary: "no captcha detected - nothing to solve" };
		const targets = (opts.type ? challenges.filter((c) => c.type === opts.type) : challenges).slice(0, 3);
		if (!targets.length)
			return { summary: `no ${opts.type} challenge detected (found: ${challenges.map((c) => c.type).join(", ")})` };
		const pageUrl = String(await this.pageEval(`location.href`));
		const attempts: string[] = [];
		let solvedCount = 0;
		for (const target of targets) {
			const tiers = tiersFor(target.type);
			let solved = false;

			// tier 1: native click
			if (tiers.native && attempt !== "service" && attempt !== "vision") {
				try {
					const r = await this.captchaNativeClick(target);
					attempts.push(`${target.type} native-click: ${r.note}`);
					solved = /solved it/.test(r.note);
				} catch (err: any) {
					attempts.push(`${target.type} native-click failed: ${err instanceof Error ? err.message : String(err)}`);
				}
			}

			// tier 2: solver service — image-captcha and datadome derive their submit
			// params differently (image body / captcha url), not via sitekey
			if (
				!solved &&
				tiers.service !== "none" &&
				cfg.solver !== "none" &&
				attempt !== "native" &&
				attempt !== "vision"
			) {
				if (!target.sitekey && target.type !== "image-captcha" && target.type !== "datadome") {
					attempts.push(`${target.type} service: skipped - no sitekey derivable`);
				} else {
					try {
						const token = await this.serviceSolve(target, pageUrl);
						const injected = await this.pageEval(injectTokenExpression(target.type, token));
						const n = Number(injected?.injected ?? 0);
						attempts.push(`${target.type} service (${cfg.solver}): token received, injected into ${n} field(s)`);
						solved = n > 0;
					} catch (err: any) {
						attempts.push(
							`${target.type} service (${cfg.solver}) failed: ${err instanceof Error ? err.message : String(err)}`,
						);
					}
				}
			}

			// tier 3: vision OCR (image captchas)
			if (
				!solved &&
				tiers.vision &&
				target.type === "image-captcha" &&
				attempt !== "native" &&
				attempt !== "service"
			) {
				try {
					const answer = await this.visionSolveImage(target);
					attempts.push(`${target.type} vision OCR: answer ${JSON.stringify(answer)}`);
					solved = !!answer;
				} catch (err: any) {
					attempts.push(`${target.type} vision OCR failed: ${err instanceof Error ? err.message : String(err)}`);
				}
			}

			if (!solved && tiers.service === "none" && !tiers.native && !tiers.vision) {
				attempts.push(
					`${target.type}: no tier applies (vendor support gap - see the note in browser captcha detect)`,
				);
			}
			if (solved) solvedCount++;
		}

		const after = await this.pageEval(CAPTCHA_PROBE_SRC, { awaitPromise: false });
		const remaining = ((after?.challenges ?? []) as DetectedChallenge[]).map((c) => c.type);
		return {
			summary: `${targets.length === 1 ? targets[0].type : `${solvedCount}/${targets.length} challenge(s)`}: ${solvedCount ? "SOLVED" : "not solved"}${remaining.length ? ` - still detected: ${remaining.join(", ")}` : " - challenge no longer detected"}`,
			details: attempts,
			warnings: solved
				? undefined
				: [
						"captcha not solved - consider: a residential proxy (UNOWN_BROWSER_PROXY), stealth=on, or a human takeover (UNOWN_BROWSER_HEADLESS=0)",
					],
		};
	}

	/** Service solve dispatch (2captcha or capsolver per config) — every
	 *  challenge type maps to its OWN wire format (the stress round's fix:
	 *  nearly everything previously submitted as a turnstile job, so the
	 *  documented datadome/awswaf/image/v3 service tiers never worked).
	 *  Job mappers live in captcha.ts where they are unit-testable. */
	private async serviceSolve(challenge: DetectedChallenge, pageUrl: string): Promise<string> {
		const cfg = this.captchaCfg!;
		if (!cfg.solver || cfg.solver === "none") {
			throw new Error("no solver service configured (UNOWN_CAPTCHA_SOLVER / keys)");
		}
		// image-captcha needs the image body; capture it here once
		let imageBodyB64: string | undefined;
		if (challenge.type === "image-captcha" && challenge.imageSelector) {
			const shot = await this.screenshot({ selector: challenge.imageSelector, format: "png" });
			imageBodyB64 = shot.image!.data;
		}
		if (cfg.solver === "2captcha") {
			if (!cfg.twoCaptchaKey) {
				throw new Error("UNOWN_CAPTCHA_SOLVER=2captcha but UNOWN_CAPTCHA_2CAPTCHA_KEY is not set");
			}
			const job = twoCaptchaJobFor(challenge, pageUrl, imageBodyB64);
			if (!job) throw new Error(`2captcha has no wire format for ${challenge.type}`);
			return new TwoCaptchaClient(cfg.twoCaptchaKey).solve(job);
		}
		if (cfg.solver === "capsolver") {
			if (!cfg.capSolverKey) {
				throw new Error("UNOWN_CAPTCHA_SOLVER=capsolver but UNOWN_CAPTCHA_CAPSOLVER_KEY is not set");
			}
			const job = capSolverJobFor(challenge, pageUrl, imageBodyB64);
			if (!job) throw new Error(`capsolver has no wire format for ${challenge.type}`);
			return new CapSolverClient(cfg.capSolverKey).solve(job);
		}
		throw new Error(`no solver service configured (UNOWN_CAPTCHA_SOLVER / keys)`);
	}

	/** Image-captcha vision tier: clip the image, OCR it, type the answer. */
	private async visionSolveImage(target: DetectedChallenge): Promise<string> {
		const cfg = this.captchaCfg!;
		if (!cfg.vision || !cfg.visionApiKey || !cfg.visionBaseUrl) {
			throw new Error(
				"vision OCR not configured (set UNOWN_VISION_API_KEY or AGNES_API_KEY; disable with UNOWN_CAPTCHA_VISION=0)",
			);
		}
		if (!target.imageSelector) throw new Error("no image element selector for the vision tier");
		const shot = await this.screenshot({ selector: target.imageSelector, format: "png" });
		const answer = await visionReadCaptcha(
			shot.image!.data,
			{ baseUrl: cfg.visionBaseUrl, apiKey: cfg.visionApiKey, model: cfg.visionModel ?? "agnes-3.0-flash" },
			(url, init) => fetch(url, init as any),
		);
		if (!answer) throw new Error("vision endpoint returned an empty answer");
		if (target.inputSelector) {
			// type the answer like a user would (humanized path when on)
			await this.type({ selector: target.inputSelector, text: answer });
		}
		return answer;
	}

	/** Detection result for the navigate hook (cheap; never throws). */
	private async captchaQuickCheck(): Promise<{ lines: string[]; blocked: boolean } | null> {
		try {
			const raw = await this.pageEval(CAPTCHA_PROBE_SRC, { awaitPromise: false });
			const challenges = (raw?.challenges ?? []) as DetectedChallenge[];
			const blocked = !!raw?.blocked;
			if (!challenges.length && !blocked) return null;
			return { lines: formatChallenges(challenges, blocked).split("\n"), blocked };
		} catch {
			return null;
		}
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

	/** Sync-safe teardown for process exit hooks — a direct SIGKILL to the
	 *  child beats an unflushed Browser.close when the process is already
	 *  dying (the zombie-Chromium leak the stress round caught live). */
	syncKill(): void {
		try {
			this.conn?.killChildNow();
		} catch {
			/* ignore */
		}
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
