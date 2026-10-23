/**
 * browser/config.ts — configuration + cross-platform browser discovery.
 *
 * Everything the `browser` tool reads from the environment, plus the
 * executable discovery chain (D14 in docs/browser-research.md):
 *
 *   1. UNOWN_BROWSER_PATH          (explicit, wins always)
 *   2. system Chrome / Chromium / Edge per-OS paths
 *   3. the Playwright ms-playwright cache (chromium + chrome-headless-shell)
 *
 * Pure module (node builtins only) so the discovery contract is unit-testable
 * without a real browser (paths are injectable).
 */

import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// env-tunable knobs
// ---------------------------------------------------------------------------

/** Navigation timeout (ms). */
export const BROWSER_NAV_TIMEOUT_MS = envInt("UNOWN_BROWSER_TIMEOUT_MS", 30_000);
/** Action settle timeout (ms) — post-action quiet wait. */
export const BROWSER_SETTLE_MS = envInt("UNOWN_BROWSER_SETTLE_MS", 300);
/** Max elements in one snapshot before truncation. */
export const BROWSER_SNAPSHOT_MAX = envInt("UNOWN_BROWSER_SNAPSHOT_MAX", 400);
/** Max characters of a snapshot the tool returns. */
export const BROWSER_SNAPSHOT_MAX_CHARS = envInt("UNOWN_BROWSER_SNAPSHOT_MAX_CHARS", 60_000);
/** Default viewport (CSS px). */
export const BROWSER_VIEWPORT = { width: 1280, height: 720 };

export interface BrowserEnv {
        /** Explicit executable path (UNOWN_BROWSER_PATH). */
        executablePath?: string;
        /** Attach to a running browser instead of launching (UNOWN_BROWSER_CDP). */
        cdpUrl?: string;
        /** 1 (default) headless, 0 headed. */
        headless: boolean;
        /** Persistent user-data-dir (UNOWN_BROWSER_PROFILE). */
        profileDir?: string;
        /** Host-glob deny list (UNOWN_BROWSER_BLOCK, comma-separated). */
        blockList: string[];
}

export function browserEnv(): BrowserEnv {
        return {
                executablePath: process.env.UNOWN_BROWSER_PATH?.trim() || undefined,
                cdpUrl: process.env.UNOWN_BROWSER_CDP?.trim() || undefined,
                headless: process.env.UNOWN_BROWSER_HEADLESS !== "0",
                profileDir: process.env.UNOWN_BROWSER_PROFILE?.trim() || undefined,
                blockList: (process.env.UNOWN_BROWSER_BLOCK || "")
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
        };
}

/** Default persistent profile: <unown home>/browser/profile. */
export function defaultProfileDir(unownHome?: string): string {
        // `||`, never `??` (the repo's env convention): the repo-root .env
        // ships UNOWN_HOME= EMPTY, and an empty string must mean "unset" or
        // the profile lands at <cwd>/browser/profile instead of ~/.unown.
        const home = unownHome || process.env.UNOWN_HOME || join(homedir(), ".unown");
        return join(home, "browser", "profile");
}

function envInt(name: string, fallback: number): number {
        const n = Number(process.env[name] ?? "");
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// ---------------------------------------------------------------------------
// executable discovery
// ---------------------------------------------------------------------------

export interface DiscoveredBrowser {
        /** Absolute path to a Chrome/Chromium-family executable. */
        path: string;
        /** How it was found ("env" | "system" | "playwright-cache"). */
        source: string;
}

/**
 * Candidate list, platform-aware. Exported (with injectable dirs) for unit
 * tests; the production entry point is {@link discoverBrowser}.
 */
export function browserCandidates(
        platform: NodeJS.Platform,
        dirs: { home: string; envPath?: string; localAppData?: string },
): string[] {
        const out: string[] = [];
        if (dirs.envPath) out.push(dirs.envPath);

        if (platform === "win32") {
                // literal backslash strings, NOT path.join: join() uses the
                // HOST separator, so a linux-run test with platform="win32"
                // would produce mixed-separator paths (and the compiled
                // windows binary must see real backslash paths).
                const lad = dirs.localAppData ?? `${dirs.home}\\AppData\\Local`;
                const pf = "C:\\Program Files";
                const pf86 = "C:\\Program Files (x86)";
                out.push(
                        `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
                        `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
                        `${lad}\\Google\\Chrome\\Application\\chrome.exe`,
                        `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
                        `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
                        `${lad}\\Microsoft\\Edge\\Application\\msedge.exe`,
                        `${lad}\\Chromium\\Application\\chrome.exe`,
                );
        } else if (platform === "darwin") {
                out.push(
                        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                        join(dirs.home, "Applications", "Google Chrome.app/Contents/MacOS/Google Chrome"),
                        "/Applications/Chromium.app/Contents/MacOS/Chromium",
                        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
                        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
                );
        } else {
                out.push(
                        "/usr/bin/google-chrome",
                        "/usr/bin/google-chrome-stable",
                        "/usr/bin/chromium",
                        "/usr/bin/chromium-browser",
                        "/opt/google/chrome/chrome",
                        "/usr/bin/microsoft-edge",
                        "/usr/bin/microsoft-edge-stable",
                        "/snap/bin/chromium",
                );
        }

        // Playwright cache (the headless shell counts — for a headless default it
        // is a full Chromium, just without a headed UI). The <WILDCARD> marker
        // stands for the versioned dir segment (chromium-1200, …).
        const cacheRoots =
                platform === "win32"
                        ? [`${dirs.localAppData ?? `${dirs.home}\\AppData\\Local`}\\ms-playwright`]
                        : platform === "darwin"
                                ? [`${dirs.home}/Library/Caches/ms-playwright`]
                                : [`${dirs.home}/.cache/ms-playwright`];
        for (const root of cacheRoots) {
                out.push(
                        `${root}/chromium-<WILDCARD>/chrome-linux/chrome`,
                        `${root}/chromium-<WILDCARD>/chrome-linux64/chrome`,
                        `${root}/chromium-<WILDCARD>/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
                        `${root}/chrome-headless_shell-<WILDCARD>/chrome-linux/chrome-headless-shell`,
                        `${root}/chrome-headless_shell-<WILDCARD>/chrome-linux64/chrome-headless-shell`,
                        `${root}/chromium_headless_shell-<WILDCARD>/chrome-linux/headless_shell`,
                        `${root}/chromium_headless_shell-<WILDCARD>/chrome-linux64/headless_shell`,
                );
        }
        return out;
}

/**
 * Expand `…/chromium-<WILDCARD>/…` candidates against the real dir listing.
 * The marker sits INSIDE a versioned segment (`chromium-1200`), so the scan
 * dir is the marker segment's PARENT and the prefix must be preserved.
 */
function expandWildcards(candidates: string[], readdir: (dir: string) => string[] | null): string[] {
        const out: string[] = [];
        for (const cand of candidates) {
                if (!cand.includes("<WILDCARD>")) {
                        out.push(cand);
                        continue;
                }
                const segments = cand.split("/");
                const segIdx = segments.findIndex((s) => s.includes("<WILDCARD>"));
                if (segIdx < 0) continue;
                const dir = segments.slice(0, segIdx).join("/");
                const prefix = segments[segIdx].replace("<WILDCARD>", "");
                const rest = segments.slice(segIdx + 1).join("/");
                const entries = readdir(dir);
                if (!entries) continue;
                // newest (highest numeric suffix) first — playwright names them chromium-1200 etc.
                const numeric = entries
                        .filter((e) => e.startsWith(prefix) && /^\d+$/.test(e.slice(prefix.length)))
                        .sort((a, b) => {
                                const na = Number(a.slice(prefix.length));
                                const nb = Number(b.slice(prefix.length));
                                return nb - na;
                        });
                for (const entry of numeric) out.push(`${dir}/${entry}/${rest}`);
        }
        return out;
}

/** Find a usable Chromium-family executable. Throws with actionable hints. */
export function discoverBrowser(
        opts: {
                platform?: NodeJS.Platform;
                home?: string;
                envPath?: string;
                localAppData?: string;
                exists?: (p: string) => boolean;
                readdir?: (dir: string) => string[] | null;
        } = {},
): DiscoveredBrowser {
        const platform = opts.platform ?? process.platform;
        const home = opts.home ?? homedir();
        const envPath = opts.envPath ?? process.env.UNOWN_BROWSER_PATH?.trim();
        const exists =
                opts.exists ??
                ((p: string) => {
                        try {
                                return statSync(p).isFile();
                        } catch {
                                return false;
                        }
                });
        const readdir =
                opts.readdir ??
                ((dir: string): string[] | null => {
                        try {
                                return readdirSync(dir) as string[];
                        } catch {
                                return null;
                        }
                });

        if (envPath) {
                if (exists(envPath)) return { path: envPath, source: "env" };
                throw new Error(`UNOWN_BROWSER_PATH is set but does not point at a file: ${envPath}`);
        }

        const expanded = expandWildcards(
                browserCandidates(platform, { home, envPath, localAppData: opts.localAppData }),
                readdir,
        );
        for (const cand of expanded) {
                if (exists(cand)) {
                        const source = cand.includes("ms-playwright") ? "playwright-cache" : "system";
                        return { path: cand, source };
                }
        }

        const hints =
                platform === "darwin"
                        ? "install Google Chrome (https://www.google.com/chrome/) or run: bunx playwright install chromium"
                        : platform === "win32"
                                ? "install Google Chrome or Microsoft Edge, or run: bunx playwright install chromium"
                                : "install chromium via your package manager (e.g. sudo apt install chromium), or run: bunx playwright install chromium";
        throw new Error(
                `no Chromium-family browser found — ${hints} (or set UNOWN_BROWSER_PATH to an executable)`,
        );
}

// ---------------------------------------------------------------------------
// URL gating (D10)
// ---------------------------------------------------------------------------

/** Host-glob match: `*` matches one label segment, `**`/leading `*` matches any suffix. */
export function hostMatchesGlob(host: string, pattern: string): boolean {
        const h = host.toLowerCase();
        const p = pattern.toLowerCase();
        if (p === h) return true;
        if (p.startsWith("**")) {
                const rest = p.slice(2).replace(/^\./, "");
                return h === rest || h.endsWith(`.${rest}`);
        }
        if (p.startsWith("*.")) {
                const rest = p.slice(2);
                return h === rest || h.endsWith(`.${rest}`);
        }
        // per-label glob: foo.*.example.com
        const rx = new RegExp(
                `^${p
                        .split(".")
                        .map((seg) => (seg === "*" ? "[^.]+" : seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&")))
                        .join("\\.")}$`,
        );
        return rx.test(h);
}

/** True when the URL is allowed by the block list. */
export function urlAllowed(rawUrl: string, blockList: string[]): { ok: boolean; blockedBy?: string } {
        if (blockList.length === 0) return { ok: true };
        let u: URL;
        try {
                u = new URL(rawUrl);
        } catch {
                return { ok: true }; // invalid URLs fail later in navigation with a real error
        }
        for (const pattern of blockList) {
                if (hostMatchesGlob(u.hostname, pattern)) return { ok: false, blockedBy: pattern };
        }
        return { ok: true };
}

/** Schemes we pass through untouched. */
const KNOWN_SCHEMES = new Set([
        "http", "https", "file", "about", "data", "blob", "ws", "wss", "ftp", "ftps",
        "chrome", "chrome-extension", "view-source", "javascript", "intent", "mailto",
]);

/** Normalize user input into a navigable URL (bare host → https://). */
export function normalizeUrl(input: string): string {
        const trimmed = input.trim();
        if (/^\/\/[^/]/.test(trimmed)) return `https:${trimmed}`;
        // "localhost:3000/x" parses its host:port as a URI scheme — only pass
        // through REAL schemes, and only when the rest doesn't start like a port.
        const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/.exec(trimmed);
        if (schemeMatch) {
                const [, scheme, rest] = schemeMatch;
                if (KNOWN_SCHEMES.has(scheme.toLowerCase())) return trimmed;
                // unknown "scheme" followed by a port-looking remainder → host:port
                if (!/^\d/.test(rest)) return trimmed; // e.g. C:\... on windows or data-ish garbage — pass through, navigation will error
        }
        return `https://${trimmed}`;
}
