/**
 * browser/index.ts — public surface of the browser automation module.
 *
 * Consumers import from here so the internal file layout can move:
 *   - tools.ts        → registerBrowserTools (the `browser` session tool)
 *   - session.ts      → BrowserSession, getBrowserSession (process singleton)
 *   - config.ts       → discovery + env knobs
 *   - cdp.ts / a11y.ts transport + snapshot internals (re-exported for tests)
 */

export {
	formatSnapshot,
	type RefEntry,
	SNAPSHOT_SCRIPT,
	type Snapshot,
	type SnapshotNode,
	snapshotRefs,
} from "./a11y.ts";
export {
	CAPTCHA_PROBE_SRC,
	CapSolverClient,
	type CapSolverSubmit,
	type CaptchaConfig,
	CaptchaServiceError,
	capSolverJobFor,
	DEFAULT_VISION_BASE_URL,
	DEFAULT_VISION_MODEL,
	type DetectedChallenge,
	type FetchLike,
	formatChallenges,
	INJECT_TOKEN_SRC,
	injectTokenExpression,
	resolveCaptchaConfig,
	TwoCaptchaClient,
	type TwoCaptchaSubmit,
	tiersFor,
	twoCaptchaJobFor,
	visionReadCaptcha,
} from "./captcha.ts";
export { CdpConnection, CdpError, modifierBits, parseKeyCombo } from "./cdp.ts";
export {
	BROWSER_NAV_TIMEOUT_MS,
	BROWSER_SNAPSHOT_MAX,
	BROWSER_SNAPSHOT_MAX_CHARS,
	type BrowserEnv,
	browserCandidates,
	browserEnv,
	type DiscoveredBrowser,
	defaultProfileDir,
	discoverBrowser,
	hostMatchesGlob,
	normalizeUrl,
	urlAllowed,
} from "./config.ts";
export { BrowserSession, getBrowserSession } from "./session.ts";
export {
	buildIdentity,
	type ChromeVersion,
	clearChromeVersionCache,
	FALLBACK_CHROME_VERSION,
	humanKeyGap,
	humanPath,
	humanTypeDelays,
	mulberry32,
	type PathPoint,
	parseProxy,
	parseScreen,
	type ResolvedIdentity,
	readChromeVersion,
	resolveStealthConfig,
	type StealthConfig,
	type StealthEnvOverrides,
	type StealthOs,
	stealthAcceptsCandidate,
	stealthLaunchArgs,
	type UserAgentMetadata,
} from "./stealth.ts";
export { type BrowserToolsOptions, registerBrowserTools } from "./tools.ts";
