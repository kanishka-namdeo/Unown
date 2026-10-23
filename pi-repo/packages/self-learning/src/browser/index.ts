/**
 * browser/index.ts — public surface of the browser automation module.
 *
 * Consumers import from here so the internal file layout can move:
 *   - tools.ts        → registerBrowserTools (the `browser` session tool)
 *   - session.ts      → BrowserSession, getBrowserSession (process singleton)
 *   - config.ts       → discovery + env knobs
 *   - cdp.ts / a11y.ts transport + snapshot internals (re-exported for tests)
 */

export { registerBrowserTools, type BrowserToolsOptions } from "./tools.ts";
export { BrowserSession, getBrowserSession } from "./session.ts";
export {
        BROWSER_NAV_TIMEOUT_MS,
        BROWSER_SNAPSHOT_MAX,
        browserCandidates,
        browserEnv,
        defaultProfileDir,
        discoverBrowser,
        hostMatchesGlob,
        normalizeUrl,
        urlAllowed,
        type BrowserEnv,
        type DiscoveredBrowser,
} from "./config.ts";
export { CdpConnection, CdpError, parseKeyCombo, modifierBits } from "./cdp.ts";
export { formatSnapshot, snapshotRefs, SNAPSHOT_SCRIPT, type Snapshot, type SnapshotNode, type RefEntry } from "./a11y.ts";
export {
        buildIdentity,
        clearChromeVersionCache,
        FALLBACK_CHROME_VERSION,
        humanKeyGap,
        humanPath,
        humanTypeDelays,
        mulberry32,
        parseProxy,
        parseScreen,
        readChromeVersion,
        resolveStealthConfig,
        stealthAcceptsCandidate,
        stealthLaunchArgs,
        type ChromeVersion,
        type ResolvedIdentity,
        type StealthConfig,
        type StealthOs,
        type StealthEnvOverrides,
        type PathPoint,
        type UserAgentMetadata,
} from "./stealth.ts";
export {
        CAPTCHA_PROBE_SRC,
        CapSolverClient,
        CaptchaServiceError,
        DEFAULT_VISION_BASE_URL,
        DEFAULT_VISION_MODEL,
        INJECT_TOKEN_SRC,
        TwoCaptchaClient,
        formatChallenges,
        injectTokenExpression,
        resolveCaptchaConfig,
        tiersFor,
        visionReadCaptcha,
        type CaptchaConfig,
        type DetectedChallenge,
        type FetchLike,
        type TwoCaptchaSubmit,
        type CapSolverSubmit,
} from "./captcha.ts";
