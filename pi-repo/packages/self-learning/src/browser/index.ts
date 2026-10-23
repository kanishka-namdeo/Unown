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
