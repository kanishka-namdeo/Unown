/**
 * browser/stealth.ts — the stealth tier (v2 browser automation).
 *
 * What "stealth" means here, precisely (all claims verified live against
 * Chrome for Testing 143 — see scripts-dev/dbg-stealth-probe*.ts, the
 * receipts):
 *
 *   1. NO Runtime.enable. The CDP signal (Error.prepareStackTrace firing
 *      during console-argument serialization, publicized by DataDome/Vastel
 *      2024, refined by rebrowser 2026) fires the moment Runtime.enable is
 *      called — measured FIRED with it, silent without it. Stealth sessions
 *      never enable the Runtime domain; page JS runs in isolated worlds
 *      (Page.createIsolatedWorld), which needs no enable.
 *   2. CDP-native fingerprint overrides — no page-JS patching (the 2026
 *      consensus: JS-injected lies are themselves detectable). All overrides
 *      happen in Blink through the protocol: Network.setUserAgentOverride
 *      (with full userAgentMetadata — verified coherent: UA, platform,
 *      userAgentData brands/platform/mobile all agree), Emulation.
 *      setLocaleOverride, Emulation.setTimezoneOverride, and
 *      Emulation.setDeviceMetricsOverride with screenWidth/screenHeight
 *      (accepted by Chrome 143; fixes the 800x600 headless default screen).
 *   3. Honest engine: the claimed Chrome version IS the launched engine's
 *      real version (read from `--version`), so UA-CH never over-claims.
 *   4. Flag hygiene (already v1): never --enable-automation, always drop
 *      AutomationControlled; headless-shell binaries are excluded from
 *      stealth discovery (they lack window.chrome and Notification
 *      coherence).
 *   5. Humanized trusted input: mouse paths from a seeded PRNG (bezier +
 *      jitter + easing, ghost-cursor-style), per-character typing with
 *      human-ish delays. Deterministic under a fixed seed for tests.
 *   6. Honest degradation: console capture is NOT possible without
 *      Runtime.enable (Log.entryAdded carries network/browser errors only —
 *      measured; Runtime.bindingCalled events need the enable — measured).
 *      Stealth sessions keep the Log tap and say so in results. Same
 *      tradeoff Patchright documents.
 *
 * Pure module (node builtins only) so every decision is unit-testable.
 */

import { execFile } from "node:child_process";

// ---------------------------------------------------------------------------
// identities
// ---------------------------------------------------------------------------

export type StealthOs = "windows" | "macos" | "linux";

export interface UserAgentMetadata {
	brands: Array<{ brand: string; version: string }>;
	fullVersionList: Array<{ brand: string; version: string }>;
	fullVersion: string;
	platform: string;
	platformVersion: string;
	architecture: string;
	model: string;
	mobile: boolean;
	bitness: string;
	wow64: boolean;
}

/** A fully resolved identity — every field the session will apply. */
export interface ResolvedIdentity {
	os: StealthOs;
	userAgent: string;
	platform: string;
	uaMetadata: UserAgentMetadata;
	acceptLanguage: string;
	locale: string;
	timezone: string;
	screen: { width: number; height: number };
	viewport: { width: number; height: number };
}

/** Chrome version facts read from the executable (or the conservative fallback). */
export interface ChromeVersion {
	major: number;
	full: string;
}

/** Fallback when `--version` cannot be parsed: a real, stable Chrome release. */
export const FALLBACK_CHROME_VERSION: ChromeVersion = { major: 143, full: "143.0.0.0" };

/** Cached `--version` probe per executable path. */
const versionCache = new Map<string, ChromeVersion>();

/**
 * Read the real Chrome version of an executable so the spoofed UA claims
 * exactly the engine that runs it. Cached; never throws (falls back).
 */
export function readChromeVersion(
	executablePath: string,
	opts: { exec?: (cmd: string, args: string[], cb: (err: Error | null, stdout: string) => void) => void } = {},
): Promise<ChromeVersion> {
	const cached = versionCache.get(executablePath);
	if (cached) return Promise.resolve(cached);
	return new Promise((resolve) => {
		const done = (v: ChromeVersion) => {
			versionCache.set(executablePath, v);
			resolve(v);
		};
		const exec =
			opts.exec ??
			((cmd: string, args: string[], cb: (err: Error | null, stdout: string) => void) => {
				try {
					execFile(cmd, args, { timeout: 5_000 }, (err: Error | null, stdout: string | Buffer) => {
						cb(err, String(stdout ?? ""));
					});
				} catch {
					done(FALLBACK_CHROME_VERSION);
				}
			});
		exec(executablePath, ["--version"], (err, stdout) => {
			// "Google Chrome 143.0.7499.4" / "Chromium 143.0.x" / "HeadlessChrome/143..."
			const m = /(\d+)\.(\d+)\.(\d+)\.(\d+)/.exec(stdout ?? "");
			if (err || !m) {
				done(FALLBACK_CHROME_VERSION);
				return;
			}
			done({ major: Number(m[1]), full: m[0] });
		});
	});
}

/** Test hook: clear the version cache. */
export function clearChromeVersionCache(): void {
	versionCache.clear();
}

/** The "Not_A Brand" grease version Chromium ships with. */
const NOT_A_BRAND_VERSION = "24";

/**
 * Build a coherent identity for the claimed OS around the real engine
 * version. Every field pair (UA string, navigator.platform, userAgentData,
 * acceptLanguage) matches what a real Chrome of that version on that OS
 * would report.
 */
export function buildIdentity(
	os: StealthOs,
	version: ChromeVersion,
	overrides: Partial<ResolvedIdentity> = {},
): ResolvedIdentity {
	const maj = String(version.major);
	const full = version.full;
	const brands = [
		{ brand: "Google Chrome", version: maj },
		{ brand: "Chromium", version: maj },
		{ brand: "Not_A Brand", version: NOT_A_BRAND_VERSION },
	];
	const fullVersionList = [
		{ brand: "Google Chrome", version: full },
		{ brand: "Chromium", version: full },
		{ brand: "Not_A Brand", version: NOT_A_BRAND_VERSION },
	];

	let base: ResolvedIdentity;
	switch (os) {
		case "macos":
			base = {
				os,
				userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${maj}.0.0.0 Safari/537.36`,
				platform: "MacIntel",
				uaMetadata: {
					brands,
					fullVersionList,
					fullVersion: full,
					platform: "macOS",
					platformVersion: "14.5.0",
					architecture: "x86",
					model: "",
					mobile: false,
					bitness: "64",
					wow64: false,
				},
				acceptLanguage: "en-US,en;q=0.9",
				locale: "en-US",
				timezone: "America/New_York",
				screen: { width: 1920, height: 1080 },
				viewport: { width: 1440, height: 900 },
			};
			break;
		case "linux":
			// the honest identity: a desktop Linux user running real Chrome.
			// (Claiming an OS you are not on leaks at the TCP layer — the hosted-
			// stealth-browser surveys' #1 finding. Users who want to claim
			// windows from a linux host may, but the default stays honest.)
			base = {
				os,
				userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${maj}.0.0.0 Safari/537.36`,
				platform: "Linux x86_64",
				uaMetadata: {
					brands,
					fullVersionList,
					fullVersion: full,
					platform: "Linux",
					platformVersion: "6.8.0",
					architecture: "x86",
					model: "",
					mobile: false,
					bitness: "64",
					wow64: false,
				},
				acceptLanguage: "en-US,en;q=0.9",
				locale: "en-US",
				timezone: "America/New_York",
				screen: { width: 1920, height: 1080 },
				viewport: { width: 1440, height: 900 },
			};
			break;
		default:
			base = {
				os: "windows",
				userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${maj}.0.0.0 Safari/537.36`,
				platform: "Win32",
				uaMetadata: {
					brands,
					fullVersionList,
					fullVersion: full,
					platform: "Windows",
					platformVersion: "15.0.0", // Win11
					architecture: "x86",
					model: "",
					mobile: false,
					bitness: "64",
					wow64: false,
				},
				acceptLanguage: "en-US,en;q=0.9",
				locale: "en-US",
				timezone: "America/New_York",
				screen: { width: 1920, height: 1080 },
				viewport: { width: 1440, height: 900 },
			};
			break;
	}
	return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

export interface StealthConfig {
	/** Stealth mode on (changes the CDP handshake and applies overrides). */
	enabled: boolean;
	/** The resolved identity (always present, even when disabled, for status). */
	identity: ResolvedIdentity;
	/** Humanized mouse paths + per-character typing. Default true in stealth. */
	humanize: boolean;
	/** `--proxy-server` value (scheme://host:port or host:port). */
	proxy?: string;
}

export interface StealthEnvOverrides {
	/** UNOWN_BROWSER_OS */
	os?: string;
	/** UNOWN_BROWSER_USER_AGENT */
	userAgent?: string;
	/** UNOWN_BROWSER_LOCALE */
	locale?: string;
	/** UNOWN_BROWSER_TIMEZONE */
	timezone?: string;
	/** UNOWN_BROWSER_SCREEN (WxH) */
	screen?: string;
	/** UNOWN_BROWSER_HUMANIZE ("0" disables) */
	humanize?: string;
	/** UNOWN_BROWSER_PROXY */
	proxy?: string;
}

/**
 * Validate an IANA timezone id. Invalid ids are silently ignored by
 * Emulation.setTimezoneOverride (measured), so the config layer must catch
 * them here - a wrong override is worse than no override.
 */
export function validTimezone(tz: string | undefined): string | undefined {
	const raw = (tz ?? "").trim();
	if (!raw) return undefined;
	try {
		const zones: string[] = (Intl as any).supportedValuesOf?.("timeZone") ?? [];
		if (zones.length && !zones.includes(raw)) return undefined;
		// engines without supportedValuesOf: let Intl itself decide
		new Intl.DateTimeFormat("en-US", { timeZone: raw });
	} catch {
		return undefined;
	}
	return raw;
}

/** Parse "1920x1080" → {width, height}; null when malformed. */
export function parseScreen(input: string | undefined): { width: number; height: number } | null {
	if (!input) return null;
	const m = /^\s*(\d{3,5})\s*[x×]\s*(\d{3,5})\s*$/.exec(input);
	if (!m) return null;
	const width = Number(m[1]);
	const height = Number(m[2]);
	if (width < 320 || height < 240 || width > 8192 || height > 8192) return null;
	return { width, height };
}

/** Parse a proxy spec into a `--proxy-server` value; null when unusable. */
export function parseProxy(input: string | undefined): string | undefined {
	const raw = (input ?? "").trim();
	if (!raw) return undefined;
	// explicit schemes pass through (http/https/socks4/socks5)
	if (/^(https?|socks4|socks5):\/\//i.test(raw)) return raw;
	// host:port
	if (/^[a-zA-Z0-9._-]+:\d{2,5}$/.test(raw)) return `http://${raw}`;
	return undefined;
}

/**
 * Resolve the stealth config from env-shaped overrides. Identity chrome
 * version is filled later (once the executable is discovered) via
 * {@link withChromeVersion}.
 */
export function resolveStealthConfig(o: {
	enabled: boolean;
	overrides: StealthEnvOverrides;
	version?: ChromeVersion;
}): StealthConfig {
	const osRaw = (o.overrides.os ?? "").trim().toLowerCase();
	const os: StealthOs =
		osRaw === "macos" || osRaw === "mac" || osRaw === "darwin" ? "macos" : osRaw === "linux" ? "linux" : "windows";
	const screen = parseScreen(o.overrides.screen) ?? undefined;
	const timezone = validTimezone(o.overrides.timezone);
	const identity = buildIdentity(os, o.version ?? FALLBACK_CHROME_VERSION, {
		...(o.overrides.userAgent?.trim() ? { userAgent: o.overrides.userAgent.trim() } : {}),
		...(o.overrides.locale?.trim()
			? { locale: o.overrides.locale.trim(), acceptLanguage: `${o.overrides.locale.trim()},en;q=0.9` }
			: {}),
		...(timezone ? { timezone } : {}),
		...(screen ? { screen } : {}),
	});
	const humanize = o.overrides.humanize?.trim() !== "0";
	const proxy = parseProxy(o.overrides.proxy);
	return { enabled: o.enabled, identity, humanize, proxy };
}

// ---------------------------------------------------------------------------
// launch args + discovery filtering
// ---------------------------------------------------------------------------

/**
 * Extra Chromium flags for a stealth launch. The base set (no
 * --enable-automation, --disable-blink-features=AutomationControlled) lives
 * in cdp.ts and applies to BOTH modes; these are the stealth additions.
 */
export function stealthLaunchArgs(cfg: StealthConfig): string[] {
	const args: string[] = [];
	// --lang must agree with the claimed locale, or Chrome's own UI language
	// (and Accept-Language defaults) betray the override.
	args.push(`--lang=${cfg.identity.locale}`);
	if (cfg.proxy) {
		args.push(`--proxy-server=${cfg.proxy}`);
		// keep the local dev server (first-class use case) off the proxy
		args.push("--proxy-bypass-list=<-loopback>");
	}
	if (cfg.identity.os === "linux") {
		// avoid gnome-keyring prompts on headless linux hosts
		args.push("--password-store=basic");
	}
	return args;
}

/** True when a discovered executable is acceptable for stealth mode. */
export function stealthAcceptsCandidate(path: string): boolean {
	// headless-shell builds lack window.chrome and coherent Notifications —
	// excluded from stealth. Full chromium-NNN builds pass.
	return !/headless[_-]shell/i.test(path);
}

// ---------------------------------------------------------------------------
// humanized input (seeded, deterministic under test)
// ---------------------------------------------------------------------------

/** mulberry32 — tiny, fast, seedable PRNG (deterministic for tests). */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface PathPoint {
	x: number;
	y: number;
	/** Pause AFTER arriving at this point (ms). */
	delayMs: number;
}

/**
 * A human-ish mouse path from `from` to `to`: a quadratic bezier through a
 * perpendicular-offset control point, N steps scaled by distance, small
 * jitter per waypoint, eased timing. Not a straight teleport — sites watch.
 */
export function humanPath(
	from: { x: number; y: number },
	to: { x: number; y: number },
	rng: () => number,
): PathPoint[] {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const dist = Math.hypot(dx, dy);
	if (dist < 2) return [{ x: to.x, y: to.y, delayMs: 40 + Math.floor(rng() * 60) }];
	const steps = Math.max(8, Math.min(25, Math.round(dist / 25)));
	// control point: midpoint pushed along the normal by up to ~18% of dist
	const norm = Math.hypot(dx, dy) || 1;
	const px = -dy / norm;
	const py = dx / norm;
	const bow = (rng() - 0.5) * dist * 0.36;
	const cx = from.x + dx * 0.5 + px * bow;
	const cy = from.y + dy * 0.5 + py * bow;
	const points: PathPoint[] = [];
	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		// ease-in-out so the cursor accelerates then settles
		const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
		const inv = 1 - e;
		let x = inv * inv * from.x + 2 * inv * e * cx + e * e * to.x;
		let y = inv * inv * from.y + 2 * inv * e * cy + e * e * to.y;
		// waypoint jitter (not on the final point — the click must land true)
		if (i < steps) {
			x += (rng() - 0.5) * 4;
			y += (rng() - 0.5) * 4;
		}
		// per-step pause: 6-16ms, with a 10% chance of a 40-90ms micro-hesitation
		let delayMs = 6 + Math.floor(rng() * 10);
		if (rng() < 0.1) delayMs += 40 + Math.floor(rng() * 50);
		points.push({ x: Math.round(x), y: Math.round(y), delayMs });
	}
	// settle before the press
	points[points.length - 1].delayMs += 30 + Math.floor(rng() * 90);
	return points;
}

/**
 * Per-character typing delays (ms before each char): 45-140ms base, longer
 * after spaces/punctuation, occasional "thinking" pauses.
 */
export function humanTypeDelays(text: string, rng: () => number): number[] {
	const out: number[] = [];
	for (const ch of text) {
		let d = 45 + Math.floor(rng() * 95);
		if (/[ .,;:!?@_\-\n]/.test(ch)) d += 30 + Math.floor(rng() * 60);
		if (rng() < 0.05) d += 150 + Math.floor(rng() * 150);
		out.push(d);
	}
	return out;
}

/** Keystroke timing for one press/release pair (humans separate them). */
export function humanKeyGap(rng: () => number): number {
	return 35 + Math.floor(rng() * 55);
}
