// Native web search + web fetch for unown (the "websearch" module).
//
// Reverse-engineered from how mature coding agents ship this surface
// (OpenCode's websearch/webfetch tools + provider plugins, Claude Code's
// WebSearch/WebFetch tools, Roo/OpenClaw provider stacks):
//
//   - a normalized result shape every provider adapter maps onto
//   - provider auto-selection from environment keys, with an explicit
//     `UNOWN_WEB_SEARCH_PROVIDER` override and a keyless fallback chain
//   - a fetch pipeline that converts HTML to text, hardens against SSRF
//     (private-range DNS resolution is refused — the documented fetch_url
//     gap in docs/testing-strategy.md) and falls back to extraction
//     services (Tavily extract keyless, Jina reader, Firecrawl) when a
//     site refuses plain HTTP clients
//   - robots.txt honoring for the webfetch side (cache per host)
//
// Providers (tier: free = no API key needed for the documented mode):
//
//   free (keyless):  duckduckgo, tavily (keyless mode), youcom (MCP free
//                    profile, 100 q/day), wikipedia, hn (Algolia),
//                    stackexchange (300 q/day per IP), npm (registry search),
//                    github (repo search; optional GITHUB_TOKEN),
//                    searxng (self-hosted via UNOWN_SEARXNG_URL)
//   paid (API key):  tavily, brave, serper, exa, perplexity, jina, zhipu,
//                    dashscope (enable_search grounding — standard keys
//                    only; coding-plan sk-sp-* keys are refused up front
//                    with an actionable note), kagi, serpapi, firecrawl
//
// All provider keys are read at call time (the unown env convention: `||`
// never `??`, empty string means unset) so a user can drop keys into a
// shell or `.env` without restarting the session.
//
// The web results store (webcache.ts) wraps both tools: searches and
// fetches are served from a persistent, cross-process cache when fresh
// ("not too old": TTL windows, origin Cache-Control honored on fetches),
// revalidated conditionally when the origin sent validators (ETag /
// Last-Modified — a 304 means "no version change", and the stored body is
// re-served without paying for a full response), and served stale — always
// flagged — when every upstream attempt fails within a bounded window.
// Every answer carries its provenance (`· cached (12m old)` and friends).
// Kill switch: UNOWN_WEB_CACHE=0. Live verification paths pass noCache.

import { lookup } from "node:dns/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
        coalesce,
        computeFetchTtlMs,
        eligibleForSwr,
        fetchCacheKey,
        isFresh,
        lookupFresh,
        lookupStale,
        normalizeFetchUrl,
        resetCoalesce,
        searchCacheKey,
        webCacheGet,
        webCacheLogEvent,
        webCachePut,
        webCacheRefresh,
        type WebCacheHit,
} from "./webcache.ts";
import { annotateToolOutput, recordShieldFlag } from "./shield.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Normalized web-search result — every provider adapter maps onto this. */
export interface WebSearchResult {
        url: string;
        title: string;
        snippet: string;
        /** Extended content when the provider returns more than a snippet. */
        content?: string;
        /** ISO-ish publication date when the provider reports one. */
        published?: string;
}

/** Options accepted by runWebSearch / the web_search tool. */
export interface WebSearchOptions {
        /** Hard cap on returned results (default 8, clamped 1-20). */
        maxResults?: number;
        /** Keep only results whose URL host matches one of these domains. */
        allowedDomains?: string[];
        /** Drop results whose URL host matches one of these domains. */
        blockedDomains?: string[];
        /** Explicit provider id (or comma-separated chain) overriding auto-selection. */
        provider?: string;
        /** Abort signal from the agent loop. */
        signal?: AbortSignal;
        /** Skip the persistent results store (live verification, force-refresh). */
        noCache?: boolean;
}

/** Provenance of a served answer — how the web results store answered. */
export interface WebCacheProvenance {
        /** hit: served from the store while fresh; revalidated: origin answered
         * 304 (unchanged); refreshing: stale answer served immediately while a
         * background refresh restores freshness (stale-while-revalidate,
         * RFC 5861 — nginx `proxy_cache_use_stale updating` / Varnish grace);
         * stale: last good answer after upstream failure. */
        provenance: "hit" | "revalidated" | "refreshing" | "stale";
        ageMs: number;
}

/** Outcome of a resolved search run. */
export interface WebSearchOutcome {
        results: WebSearchResult[];
        provider: string;
        /** Providers attempted with the failure reason (chain transparency). */
        attempted: Array<{ provider: string; ok: boolean; note: string }>;
        query: string;
        /** Set when the answer came from the web results store. */
        cache?: WebCacheProvenance;
}

/** A single provider adapter. */
export interface WebSearchProvider {
        /** Registry id (used by UNOWN_WEB_SEARCH_PROVIDER). */
        id: string;
        /** Human name for the transcript. */
        name: string;
        /** "free" = usable without any API key; "paid" = key required. */
        tier: "free" | "paid";
        /** Env vars whose presence makes this provider "keyed" (required for use). */
        keyEnvVars: string[];
        /** Optional enhancement keys (keyless mode still works without them). */
        optionalKeyEnvVars?: string[];
        /** True when the provider can serve right now (keys / URL present). */
        isConfigured: () => boolean;
        /** Run the search. Errors are caught by the chain runner. */
        search: (query: string, opts: WebSearchOptions) => Promise<WebSearchResult[]>;
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** Default per-provider timeout (ms). */
const DEFAULT_SEARCH_TIMEOUT_MS = 20_000;

function searchTimeoutMs(): number {
        const raw = Number(process.env.UNOWN_WEB_SEARCH_TIMEOUT_MS || "");
        return Number.isFinite(raw) && raw >= 2000 && raw <= 120_000 ? raw : DEFAULT_SEARCH_TIMEOUT_MS;
}

function maxResultsCap(requested: number | undefined): number {
        const envRaw = Number(process.env.UNOWN_WEB_SEARCH_MAX_RESULTS || "");
        let raw = 8;
        if (requested !== undefined && Number.isFinite(requested)) raw = requested;
        else if (Number.isFinite(envRaw) && envRaw > 0) raw = envRaw;
        return Math.min(Math.max(Math.trunc(raw), 1), 20);
}

const SEARCH_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) unown-agent/1.0";

function httpError(status: number, provider: string, body: string): Error {
        const excerpt = body.slice(0, 200).replace(/\s+/g, " ").trim();
        const hints: Record<number, string> = {
                401: " (authentication failed — check the provider API key)",
                402: " (payment required — provider credits exhausted?)",
                403: " (forbidden — key valid for this endpoint?)",
                404: " (endpoint moved — provider API changed?)",
                429: " (rate limited — retry later or pick another provider)",
        };
        return new Error(`${provider} HTTP ${status}${hints[status] ?? ""}${excerpt ? `: ${excerpt}` : ""}`);
}

/** JSON POST/GET with timeout, status mapping and JSON parsing. */
async function jsonRequest(
        url: string,
        init: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string; timeoutMs?: number },
): Promise<any> {
        const timeoutMs = init.timeoutMs ?? searchTimeoutMs();
        const res = await fetch(url, {
                method: init.method ?? "GET",
                headers: { "user-agent": SEARCH_USER_AGENT, accept: "application/json", ...(init.headers ?? {}) },
                body: init.body,
                redirect: "follow",
                signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        if (!res.ok) throw httpError(res.status, new URL(url).hostname, text);
        try {
                return JSON.parse(text);
        } catch {
                throw new Error(`non-JSON response from ${new URL(url).hostname} (${text.slice(0, 120)}...)`);
        }
}

function clampResults(results: WebSearchResult[], cap: number): WebSearchResult[] {
        return results.filter((r) => typeof r?.url === "string" && r.url.startsWith("http")).slice(0, cap);
}

/** Strip HTML tags/entities from provider snippets (Wikipedia excerpts etc.). */
export function stripInlineHtml(html: string): string {
        // Tag strip LOOPS until stable: a single pass can leave a re-formed
        // tag behind (`<scr<script>ipt>` — one tag's `>` gets consumed with
        // another's opener and the leftovers recombine; js/incomplete-
        // multi-character-sanitization).
        let s = html;
        let prev: string;
        do {
                prev = s;
                s = s.replace(/<[^>]*>/g, "");
        } while (s !== prev);
        // Entity decode with `&amp;` LAST: decoding it first would turn
        // `&amp;lt;` into `&lt;` and then `<` — a double-unescape
        // (js/double-escaping).
        return s
                .replace(/&nbsp;/g, " ")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&amp;/g, "&")
                .replace(/\s+/g, " ")
                .trim();
}

/** Host-based allow/block filter (Claude Code WebSearch parity). */
export function filterByDomains(results: WebSearchResult[], allowed?: string[], blocked?: string[]): WebSearchResult[] {
        const allowedList = (allowed ?? []).map((d) => d.toLowerCase().trim()).filter(Boolean);
        const blockedList = (blocked ?? []).map((d) => d.toLowerCase().trim()).filter(Boolean);
        if (allowedList.length === 0 && blockedList.length === 0) return results;
        const hostMatches = (host: string, domain: string) =>
                host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`);
        return results.filter((r) => {
                let host = "";
                try {
                        host = new URL(r.url).hostname.toLowerCase();
                } catch {
                        return false;
                }
                if (blockedList.some((d) => hostMatches(host, d))) return false;
                if (allowedList.length > 0 && !allowedList.some((d) => hostMatches(host, d))) return false;
                return true;
        });
}

// ---------------------------------------------------------------------------
// SSRF guard (shared by webfetch + fetch_url delegation)
// ---------------------------------------------------------------------------

const PRIVATE_IPV4_RANGES: Array<[string, number]> = [
        ["0.0.0.0", 8],
        ["10.0.0.0", 8],
        ["100.64.0.0", 10],
        ["127.0.0.0", 8],
        ["169.254.0.0", 16],
        ["172.16.0.0", 12],
        ["192.0.0.0", 24],
        ["192.0.2.0", 24],
        ["192.168.0.0", 16],
        ["198.18.0.0", 15],
        ["198.51.100.0", 24],
        ["203.0.113.0", 24],
        ["224.0.0.0", 4],
        ["240.0.0.0", 4],
];

function ipv4ToInt(ip: string): number | null {
        const parts = ip.split(".");
        if (parts.length !== 4) return null;
        let value = 0;
        for (const part of parts) {
                const octet = Number(part);
                if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
                value = value * 256 + octet;
        }
        return value;
}

function isPrivateIPv4(ip: string): boolean {
        const value = ipv4ToInt(ip);
        if (value === null) return false;
        return PRIVATE_IPV4_RANGES.some(([base, bits]) => {
                const baseValue = ipv4ToInt(base);
                if (baseValue === null) return false;
                const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
                return (value & mask) === (baseValue & mask);
        });
}

function isPrivateIPv6(ip: string): boolean {
        const lowered = ip.toLowerCase().replace(/^\[|\]$/g, "");
        if (lowered === "::" || lowered === "::1") return true;
        if (lowered.startsWith("fe80:") || lowered.startsWith("fc") || lowered.startsWith("fd")) return true;
        if (lowered.startsWith("::ffff:")) {
                const mapped = lowered.slice(7);
                return mapped.includes(".") ? isPrivateIPv4(mapped) : true;
        }
        return false;
}

/** Literal hostname checks that skip DNS entirely. */
export function isPrivateHostname(hostname: string): boolean {
        const host = hostname.toLowerCase().replace(/\.$/, "");
        if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal"))
                return true;
        if (host === "metadata.google.internal" || host === "169.254.169.254") return true;
        if (host.includes(":")) return isPrivateIPv6(host);
        if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPrivateIPv4(host);
        // IPv6 literal in brackets or bare
        const bareV6 = host.replace(/^\[|\]$/g, "");
        if (bareV6.includes(":")) return isPrivateIPv6(bareV6);
        return false;
}

/**
 * Validate a URL for outbound fetching: http(s) only, standard ports,
 * and a hostname that neither literally nor (after DNS resolution) points
 * at a private / reserved address. Resolves DNS for non-literal hosts so
 * hostnames like `internal-service.corp` cannot reach the LAN.
 *
 * `UNOWN_WEBFETCH_ALLOW_PRIVATE=1` opts out of the private-range and port
 * guards (self-hosted users fetching internal docs mirrors, or tests) —
 * the http(s)-only protocol check always applies.
 */
export async function assertFetchableUrl(rawUrl: string): Promise<URL> {
        const allowPrivate = (process.env.UNOWN_WEBFETCH_ALLOW_PRIVATE || "") === "1";
        let parsed: URL;
        try {
                parsed = new URL(rawUrl);
        } catch {
                throw new Error(`invalid URL: ${rawUrl}`);
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                throw new Error(`only http(s) URLs are supported (got ${parsed.protocol})`);
        }
        if (allowPrivate) return parsed;
        if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
                throw new Error(`non-standard port ${parsed.port} refused (SSRF guard)`);
        }
        const host = parsed.hostname.replace(/^\[|\]$/g, "");
        if (isPrivateHostname(host)) {
                throw new Error(`refusing to fetch private/reserved host: ${host}`);
        }
        if (host.includes(":")) return parsed; // IPv6 literal already checked
        if (!/^[a-z0-9.-]+$/i.test(host)) return parsed; // unusual but not DNS-resolvable
        // Resolve DNS and refuse private answers (guards DNS-rebinding to LAN).
        if (typeof lookup === "function") {
                try {
                        const records = await lookup(host, { all: true });
                        for (const record of records) {
                                const address = record.address;
                                const privateHit = address.includes(":") ? isPrivateIPv6(address) : isPrivateIPv4(address);
                                if (privateHit) throw new Error(`host ${host} resolves to private address ${address} (SSRF guard)`);
                        }
                } catch (err: any) {
                        if (err?.message?.includes("SSRF guard")) throw err;
                        // DNS failure surfaces as the fetch's own network error later.
                }
        }
        return parsed;
}

// ---------------------------------------------------------------------------
// robots.txt (webfetch side; 15-minute per-host cache, honoring *)
// ---------------------------------------------------------------------------

interface RobotsCacheEntry {
        fetchedAt: number;
        rules: Array<{ allow: boolean; path: string }>;
}

const robotsCache = new Map<string, RobotsCacheEntry>();
const ROBOTS_TTL_MS = 15 * 60_000;

/** Parse a robots.txt body into `*`-scoped rules (longest-path-match). */
export function parseRobots(body: string): Array<{ allow: boolean; path: string }> {
        const rules: Array<{ allow: boolean; path: string }> = [];
        let starScoped = false;
        for (const rawLine of body.split(/\r?\n/)) {
                const line = rawLine.replace(/#.*$/, "").trim();
                if (!line) continue;
                const [rawKey, ...rest] = line.split(":");
                const key = rawKey.trim().toLowerCase();
                const value = rest.join(":").trim();
                if (key === "user-agent") {
                        starScoped = value === "*";
                } else if ((key === "disallow" || key === "allow") && starScoped) {
                        rules.push({ allow: key === "allow", path: value });
                }
        }
        return rules;
}

/** Longest-match evaluation of one URL path against parsed robots rules. */
export function isAllowedByRobots(path: string, rules: Array<{ allow: boolean; path: string }>): boolean {
        let best: { allow: boolean; path: string } | undefined;
        for (const rule of rules) {
                if (!rule.path) continue;
                if (!path.startsWith(rule.path)) continue;
                if (!best || rule.path.length > best.path.length) best = rule;
        }
        if (!best) return true;
        return best.allow;
}

async function isRobotsAllowed(url: URL): Promise<boolean> {
        const robotsOn = (process.env.UNOWN_WEBFETCH_ROBOTS || "") !== "0";
        if (!robotsOn) return true;
        const host = url.host; // host:port
        const cached = robotsCache.get(host);
        if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS) {
                return isAllowedByRobots(url.pathname + url.search, cached.rules);
        }
        let rules: Array<{ allow: boolean; path: string }> = [];
        try {
                const res = await fetch(`${url.protocol}//${url.host}/robots.txt`, {
                        headers: { "user-agent": SEARCH_USER_AGENT },
                        redirect: "follow",
                        signal: AbortSignal.timeout(8000),
                });
                if (res.ok) rules = parseRobots(await res.text());
        } catch {
                rules = []; // unreachable robots.txt = allow
        }
        robotsCache.set(host, { fetchedAt: Date.now(), rules });
        if (robotsCache.size > 100) {
                const oldest = robotsCache.keys().next().value;
                if (oldest) robotsCache.delete(oldest);
        }
        return isAllowedByRobots(url.pathname + url.search, rules);
}

// ---------------------------------------------------------------------------
// HTML to text (shared with tools.ts's fetch_url)
// ---------------------------------------------------------------------------

export function htmlToText(html: string): string {
        // Strip phase, LOOPED until stable (see stripInlineHtml): the loop
        // clears re-formed tags (`<scr<script>ipt>`, `<a<b>`), and the element
        // strips below tolerate whitespace in the closing tag (`</script >`
        // — js/bad-tag-filter; without it the script BODY leaked through as
        // text).
        let s = html;
        let prev: string;
        do {
                prev = s;
                s = s
                        .replace(/<script\b[\s\S]*?<\/script[^>]*>/gi, " ")
                        .replace(/<style\b[\s\S]*?<\/style[^>]*>/gi, " ")
                        .replace(/<noscript\b[\s\S]*?<\/noscript[^>]*>/gi, " ")
                        .replace(/<svg\b[\s\S]*?<\/svg[^>]*>/gi, " ")
                        .replace(/<!--[\s\S]*?-->/g, " ")
                        .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|blockquote|pre|ul|ol|dl|table)>/gi, "\n")
                        .replace(/<br\s*\/?>/gi, "\n")
                        .replace(/<[^>]*>/g, " ");
        } while (s !== prev);
        // Entity decode with `&amp;` LAST (see stripInlineHtml: `&amp;lt;`
        // must decode to the literal text `&lt;`, never `<`).
        return s
                .replace(/&nbsp;/g, " ")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&amp;/g, "&")
                .replace(/[ \t]+/g, " ")
                .replace(/\n{3,}/g, "\n\n")
                .trim();
}

// ---------------------------------------------------------------------------
// Provider adapters — free (keyless)
// ---------------------------------------------------------------------------

/** DuckDuckGo HTML endpoint. Unlimited for personal/agent use, but datacenter
 *  IPs receive an anomaly challenge (HTTP 202) — detected and surfaced so the
 *  fallback chain can move on. Unwraps the uddg= redirect links. */
export function parseDuckduckgoHtml(html: string, cap: number): WebSearchResult[] {
        const results: WebSearchResult[] = [];
        const blockRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        const snippetRe = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i;
        let match: RegExpExecArray | null;
        while ((match = blockRe.exec(html)) !== null && results.length < cap) {
                const href = match[1];
                const title = stripInlineHtml(match[2] || "");
                if (!href || !title) continue;
                const url = unwrapDuckduckgoUrl(href);
                if (!url || !/^https?:\/\//.test(url)) continue;
                const tail = html.slice(blockRe.lastIndex, blockRe.lastIndex + 2000);
                const snippetMatch = tail.match(snippetRe);
                const snippet = snippetMatch ? stripInlineHtml(snippetMatch[1] || "") : "";
                results.push({ url, title, snippet: snippet.slice(0, 400) });
        }
        return results;
}

/** DDG wraps result URLs in https://duckduckgo.com/l/?uddg=<encoded>&rut=... */
export function unwrapDuckduckgoUrl(href: string): string | null {
        try {
                const absolute = href.startsWith("//") ? `https:${href}` : href;
                const parsed = new URL(absolute, "https://duckduckgo.com");
                const uddg = parsed.searchParams.get("uddg");
                if (uddg) return decodeURIComponent(uddg);
                return parsed.toString();
        } catch {
                return null;
        }
}

async function duckduckgoSearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const cap = maxResultsCap(opts.maxResults);
        const res = await fetch("https://html.duckduckgo.com/html/", {
                method: "POST",
                headers: {
                        "content-type": "application/x-www-form-urlencoded",
                        "user-agent": SEARCH_USER_AGENT,
                        accept: "text/html",
                },
                body: new URLSearchParams({ q: query }).toString(),
                redirect: "follow",
                signal: AbortSignal.timeout(searchTimeoutMs()),
        });
        const html = await res.text();
        // DDG soft-blocks datacenter IPs with HTTP 202 + an anomaly challenge page.
        if (res.status === 202 || /anomaly|challenge|captcha/i.test(html.slice(0, 4000))) {
                throw new Error("duckduckgo returned a bot challenge (202) — likely IP reputation; trying next provider");
        }
        if (!res.ok) throw httpError(res.status, "duckduckgo", html);
        const results = parseDuckduckgoHtml(html, cap);
        if (results.length === 0) throw new Error("duckduckgo returned no parsable results");
        return clampResults(results, cap);
}

/** Tavily. Keyless mode (X-Tavily-Access-Mode: keyless) is rate-limited but
 *  needs no signup; with TAVILY_API_KEY the same endpoint runs keyed. */
export function parseTavilyResponse(body: any, cap: number): WebSearchResult[] {
        const rows: any[] = Array.isArray(body?.results) ? body.results : [];
        return clampResults(
                rows.map((row) => ({
                        url: String(row.url ?? ""),
                        title: String(row.title ?? row.url ?? ""),
                        snippet: String(row.content ?? "").slice(0, 600),
                        content: typeof row.content === "string" && row.content.length > 600 ? row.content : undefined,
                        published: row.published_date ? String(row.published_date) : undefined,
                })),
                cap,
        );
}

async function tavilySearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const cap = maxResultsCap(opts.maxResults);
        const key = process.env.TAVILY_API_KEY || "";
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (key) headers.authorization = `Bearer ${key}`;
        else headers["x-tavily-access-mode"] = "keyless";
        const body = await jsonRequest("https://api.tavily.com/search", {
                method: "POST",
                headers,
                body: JSON.stringify({
                        query,
                        max_results: cap,
                        search_depth: "basic",
                        include_answer: key ? true : false,
                }),
        });
        if (typeof body?.answer === "string" && body.answer.trim()) {
                const results = parseTavilyResponse(body, cap);
                // Prepend Tavily's synthesized answer as the first result context.
                if (results.length > 0) {
                        return [
                                {
                                        url: results[0]?.url ?? "https://tavily.com",
                                        title: "Tavily answer",
                                        snippet: body.answer.slice(0, 1200),
                                },
                                ...results,
                        ].slice(0, cap);
                }
        }
        const results = parseTavilyResponse(body, cap);
        if (results.length === 0) throw new Error("tavily returned no results");
        return results;
}

/** You.com free MCP profile: keyless JSON-RPC over streamable HTTP, 100
 *  queries/day. The SSE event stream carries the JSON-RPC result envelope. */
export function parseYoucomMcpText(text: string, cap: number): WebSearchResult[] {
        let payload: any;
        try {
                payload = JSON.parse(text);
        } catch {
                return [];
        }
        const web: any[] = payload?.results?.web ?? [];
        return clampResults(
                web.map((row) => ({
                        url: String(row.url ?? ""),
                        title: String(row.title ?? row.url ?? ""),
                        snippet: String(row.description ?? "").slice(0, 400),
                        published: row.page_age ? String(row.page_age) : undefined,
                })),
                cap,
        );
}

async function youcomSearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const cap = maxResultsCap(opts.maxResults);
        const res = await fetch("https://api.you.com/mcp?profile=free", {
                method: "POST",
                headers: {
                        "content-type": "application/json",
                        accept: "application/json, text/event-stream",
                        "user-agent": SEARCH_USER_AGENT,
                },
                body: JSON.stringify({
                        jsonrpc: "2.0",
                        id: 1,
                        method: "tools/call",
                        params: { name: "you-search", arguments: { query, count: cap } },
                }),
                signal: AbortSignal.timeout(searchTimeoutMs() + 10_000),
        });
        const text = await res.text();
        if (!res.ok) throw httpError(res.status, "you.com", text);
        // The response is SSE: data lines, one carrying the JSON-RPC result.
        let resultPayload: any;
        for (const line of text.split("\n")) {
                if (!line.startsWith("data: ")) continue;
                try {
                        const frame = JSON.parse(line.slice(6));
                        if (frame?.result && (frame.id === 1 || frame.result?.content)) {
                                resultPayload = frame.result;
                                break;
                        }
                } catch {
                        /* keep scanning */
                }
        }
        const inner = resultPayload?.content?.[0]?.text;
        if (typeof inner !== "string") throw new Error("you.com MCP returned no result content");
        const results = parseYoucomMcpText(inner, cap);
        if (results.length === 0) throw new Error("you.com returned no web results");
        return results;
}

/** Wikipedia REST search — keyless, encyclopedic coverage; perfect for
 *  concept/library questions when general engines fail. */
export function parseWikipediaResponse(body: any, cap: number): WebSearchResult[] {
        const pages: any[] = Array.isArray(body?.pages) ? body.pages : [];
        return clampResults(
                pages.map((page) => ({
                        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(page.key ?? page.title ?? ""))}`,
                        title: String(page.title ?? ""),
                        snippet: stripInlineHtml(String(page.excerpt ?? page.description ?? "")).slice(0, 400),
                })),
                cap,
        );
}

async function wikipediaSearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const cap = maxResultsCap(opts.maxResults);
        const url = `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=${cap}`;
        // Wikipedia's UA policy: descriptive, non-browser UA with contact/project
        // info — spoofing a browser UA gets 403s from their edge.
        const body = await jsonRequest(url, {
                headers: { "user-agent": "unown-agent/1.0 (https://github.com/kanishka-namdeo/Unown)" },
        });
        const results = parseWikipediaResponse(body, cap);
        if (results.length === 0) throw new Error("wikipedia returned no pages");
        return results;
}

/** Hacker News (Algolia) — keyless, instant; tech discussions and launches. */
export function parseHnResponse(body: any, cap: number): WebSearchResult[] {
        const hits: any[] = Array.isArray(body?.hits) ? body.hits : [];
        return clampResults(
                hits.map((hit) => {
                        const discussionUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
                        const target = typeof hit.url === "string" && hit.url ? hit.url : discussionUrl;
                        return {
                                url: target,
                                title: String(hit.title ?? hit.story_title ?? "HN item"),
                                snippet: stripInlineHtml(String(hit.story_text ?? hit._highlightResult?.title?.value ?? "")).slice(0, 400),
                                published: hit.created_at ? String(hit.created_at) : undefined,
                        };
                }),
                cap,
        );
}

/** npm registry search — keyless, package discovery with download counts;
 *  the dependency-research provider coding agents actually need. */
export function parseNpmResponse(body: any, cap: number): WebSearchResult[] {
        const rows: any[] = Array.isArray(body?.objects) ? body.objects : [];
        return clampResults(
                rows.map((row) => {
                        const pkg = row?.package ?? {};
                        const name = String(pkg.name ?? "");
                        const version = pkg.version ? `@${pkg.version}` : "";
                        const monthly = row?.downloads?.monthly;
                        return {
                                url: String(pkg.links?.npm ?? `https://www.npmjs.com/package/${name}`),
                                title: `${name}${version}`,
                                snippet: `${String(pkg.description ?? "").slice(0, 240)}${monthly ? ` · ${Math.round(monthly / 1000)}k downloads/mo` : ""}`,
                                published: row?.updated ? String(row.updated) : undefined,
                        };
                }),
                cap,
        );
}

async function npmSearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const cap = maxResultsCap(opts.maxResults);
        const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${cap}`;
        const body = await jsonRequest(url, {});
        const results = parseNpmResponse(body, cap);
        if (results.length === 0) throw new Error("npm returned no packages");
        return results;
}

/** GitHub repository search — keyless (10 req/min per IP; a GITHUB_TOKEN in
 *  the environment lifts the search limit and is attached when present). */
export function parseGithubResponse(body: any, cap: number): WebSearchResult[] {
        const rows: any[] = Array.isArray(body?.items) ? body.items : [];
        return clampResults(
                rows.map((row) => ({
                        url: String(row?.html_url ?? ""),
                        title: String(row?.full_name ?? row?.html_url ?? ""),
                        snippet: `${String(row?.description ?? "").slice(0, 240)} · ${row?.stargazers_count ?? 0} stars · ${row?.language ?? "?"}`,
                        published: row?.updated_at ? String(row?.updated_at) : undefined,
                })),
                cap,
        );
}

async function githubSearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const cap = maxResultsCap(opts.maxResults);
        const token = process.env.GITHUB_TOKEN || "";
        const headers: Record<string, string> = { accept: "application/vnd.github+json" };
        if (token) headers.authorization = `Bearer ${token}`;
        const body = await jsonRequest(
                `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${cap}`,
                { headers },
        );
        const results = parseGithubResponse(body, cap);
        if (results.length === 0) throw new Error("github returned no repositories");
        return results;
}

async function hnSearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const cap = maxResultsCap(opts.maxResults);
        const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=${cap}&tags=story`;
        const body = await jsonRequest(url, {});
        const results = parseHnResponse(body, cap);
        if (results.length === 0) throw new Error("hn returned no hits");
        return results;
}

/** StackExchange — keyless 300 req/day per IP (10k with a free stackapps key
 *  via UNOWN_STACKEXCHANGE_KEY). Shared cloud IPs may see 429. */
export function parseStackexchangeResponse(body: any, cap: number): WebSearchResult[] {
        const items: any[] = Array.isArray(body?.items) ? body.items : [];
        return clampResults(
                items.map((item) => ({
                        url: String(item.link ?? ""),
                        title: stripInlineHtml(String(item.title ?? "")),
                        snippet: `${item.is_answered ? "answered" : "unanswered"} · score ${item.score ?? 0} · ${item.answer_count ?? 0} answers · tags: ${(item.tags ?? []).join(", ")}`,
                        published: item.creation_date ? new Date(item.creation_date * 1000).toISOString() : undefined,
                })),
                cap,
        );
}

async function stackexchangeSearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const cap = maxResultsCap(opts.maxResults);
        const key = process.env.UNOWN_STACKEXCHANGE_KEY || "";
        const params = new URLSearchParams({
                order: "desc",
                sort: "relevance",
                q: query,
                site: "stackoverflow",
                pagesize: String(cap),
        });
        if (key) params.set("key", key);
        const body = await jsonRequest(`https://api.stackexchange.com/2.3/search/advanced?${params}`, {});
        const results = parseStackexchangeResponse(body, cap);
        if (results.length === 0) throw new Error("stackexchange returned no items");
        return results;
}

/** SearXNG — self-hosted (docker run searxng/searxng with formats: [html, json])
 *  or any trusted instance. Public instances rate-limit/bot-wall datacenter
 *  IPs, so UNOWN_SEARXNG_URL is the supported path. Aggregates Google/Bing/DDG. */
export function parseSearxngResponse(body: any, cap: number): WebSearchResult[] {
        const rows: any[] = Array.isArray(body?.results) ? body.results : [];
        return clampResults(
                rows.map((row) => ({
                        url: String(row.url ?? ""),
                        title: String(row.title ?? row.url ?? ""),
                        snippet: String(row.content ?? "").slice(0, 400),
                        published: row.publishedDate ? String(row.publishedDate) : undefined,
                })),
                cap,
        );
}

async function searxngSearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const base = (process.env.UNOWN_SEARXNG_URL || "").replace(/\/+$/, "");
        if (!base) throw new Error("searxng needs UNOWN_SEARXNG_URL (self-host with formats: [html, json])");
        const cap = maxResultsCap(opts.maxResults);
        const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&language=en`;
        const body = await jsonRequest(url, {});
        const results = parseSearxngResponse(body, cap);
        if (results.length === 0) throw new Error("searxng returned no results");
        return results;
}

// ---------------------------------------------------------------------------
// Provider adapters — paid (API key)
// ---------------------------------------------------------------------------

/** Brave Search API — independent index, $5 monthly credit (card required). */
export function parseBraveResponse(body: any, cap: number): WebSearchResult[] {
        const rows: any[] = body?.web?.results ?? [];
        return clampResults(
                rows.map((row) => ({
                        url: String(row.url ?? ""),
                        title: String(row.title ?? row.url ?? ""),
                        snippet: String(row.description ?? "").slice(0, 400),
                        published: row.age ? String(row.age) : undefined,
                })),
                cap,
        );
}

async function braveSearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const cap = maxResultsCap(opts.maxResults);
        const key = process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY || "";
        if (!key) throw new Error("brave needs BRAVE_SEARCH_API_KEY");
        const body = await jsonRequest(
                `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${cap}`,
                { headers: { "x-subscription-token": key, accept: "application/json" } },
        );
        const results = parseBraveResponse(body, cap);
        if (results.length === 0) throw new Error("brave returned no results");
        return results;
}

/** Serper.dev — Google results via API, cheapest CPM, 2500 signup credits. */
export function parseSerperResponse(body: any, cap: number): WebSearchResult[] {
        const rows: any[] = body?.organic ?? [];
        return clampResults(
                rows.map((row) => ({
                        url: String(row.link ?? ""),
                        title: String(row.title ?? row.link ?? ""),
                        snippet: String(row.snippet ?? "").slice(0, 400),
                        published: row.date ? String(row.date) : undefined,
                })),
                cap,
        );
}

async function serperSearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const cap = maxResultsCap(opts.maxResults);
        const key = process.env.SERPER_API_KEY || "";
        if (!key) throw new Error("serper needs SERPER_API_KEY");
        const body = await jsonRequest("https://google.serper.dev/search", {
                method: "POST",
                headers: { "x-api-key": key },
                body: JSON.stringify({ q: query, num: cap }),
        });
        const results = parseSerperResponse(body, cap);
        if (results.length === 0) throw new Error("serper returned no organic results");
        return results;
}

/** Exa — neural/code search; contents.text returns page text with results. */
export function parseExaResponse(body: any, cap: number): WebSearchResult[] {
        const rows: any[] = Array.isArray(body?.results) ? body.results : [];
        return clampResults(
                rows.map((row) => ({
                        url: String(row.url ?? ""),
                        title: String(row.title ?? row.url ?? ""),
                        snippet: String(row.snippet ?? row.summary ?? "").slice(0, 400),
                        content: typeof row.text === "string" ? row.text.slice(0, 4000) : undefined,
                        published: row.publishedDate ? String(row.publishedDate) : undefined,
                })),
                cap,
        );
}

async function exaSearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const cap = maxResultsCap(opts.maxResults);
        const key = process.env.EXA_API_KEY || "";
        if (!key) throw new Error("exa needs EXA_API_KEY");
        const body = await jsonRequest("https://api.exa.ai/search", {
                method: "POST",
                headers: { "x-api-key": key },
                body: JSON.stringify({
                        query,
                        numResults: cap,
                        type: "auto",
                        contents: { text: { maxCharacters: 1200 } },
                }),
        });
        const results = parseExaResponse(body, cap);
        if (results.length === 0) throw new Error("exa returned no results");
        return results;
}

/** Perplexity Search API — ranked results endpoint (falls back to sonar). */
export function parsePerplexityResponse(body: any, cap: number): WebSearchResult[] {
        const rows: any[] = Array.isArray(body?.results) ? body.results : [];
        return clampResults(
                rows.map((row) => ({
                        url: String(row.url ?? ""),
                        title: String(row.title ?? row.url ?? ""),
                        snippet: String(row.snippet ?? "").slice(0, 400),
                        published: (row.date ?? row.last_updated) ? String(row.date ?? row.last_updated) : undefined,
                })),
                cap,
        );
}

async function perplexitySearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const cap = maxResultsCap(opts.maxResults);
        const key = process.env.PERPLEXITY_API_KEY || process.env.PPLX_API_KEY || "";
        if (!key) throw new Error("perplexity needs PERPLEXITY_API_KEY");
        try {
                const body = await jsonRequest("https://api.perplexity.ai/search", {
                        method: "POST",
                        headers: { authorization: `Bearer ${key}` },
                        body: JSON.stringify({ query, max_results: cap }),
                });
                const results = parsePerplexityResponse(body, cap);
                if (results.length > 0) return results;
                throw new Error("perplexity /search returned no results");
        } catch (err: any) {
                // Older plans/accounts lack the /search endpoint — use sonar chat with
                // citations and map the answer + citations into results.
                const chat = await jsonRequest("https://api.perplexity.ai/chat/completions", {
                        method: "POST",
                        headers: { authorization: `Bearer ${key}` },
                        body: JSON.stringify({
                                model: "sonar",
                                messages: [{ role: "user", content: query }],
                        }),
                });
                const answer = chat?.choices?.[0]?.message?.content ?? "";
                const citations: string[] = Array.isArray(chat?.citations) ? chat.citations : [];
                const results: WebSearchResult[] = citations.slice(0, cap - 1).map((url) => ({
                        url: String(url),
                        title: "perplexity source",
                        snippet: "",
                }));
                if (answer.trim()) {
                        results.unshift({
                                url: "https://perplexity.ai",
                                title: "Perplexity sonar answer",
                                snippet: answer.slice(0, 2000),
                        });
                }
                if (results.length === 0) throw new Error(`perplexity returned nothing (${err?.message ?? "unknown"})`);
                return clampResults(results, cap);
        }
}

/** Jina s.jina.ai search — Bearer key, 100 RPM on the free key tier. */
export function parseJinaSearchResponse(body: any, cap: number): WebSearchResult[] {
        const rows: any[] = Array.isArray(body?.data) ? body.data : [];
        return clampResults(
                rows.map((row) => ({
                        url: String(row.url ?? ""),
                        title: String(row.title ?? row.url ?? ""),
                        snippet: String(row.description ?? "").slice(0, 400),
                        content: typeof row.content === "string" ? row.content.slice(0, 4000) : undefined,
                        published: row.publishedTime ? String(row.publishedTime) : undefined,
                })),
                cap,
        );
}

async function jinaSearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const cap = maxResultsCap(opts.maxResults);
        const key = process.env.JINA_API_KEY || process.env.JINA_READER_API_KEY || "";
        if (!key) throw new Error("jina needs JINA_API_KEY");
        const body = await jsonRequest(`https://s.jina.ai/?q=${encodeURIComponent(query)}&num=${cap}`, {
                headers: { authorization: `Bearer ${key}`, accept: "application/json" },
                timeoutMs: searchTimeoutMs() + 10_000,
        });
        const results = parseJinaSearchResponse(body, cap);
        if (results.length === 0) throw new Error("jina returned no results");
        return results;
}

/** Zhipu (Z.AI) web_search — cheapest raw search (~$0.0014/call). */
export function parseZhipuResponse(body: any, cap: number): WebSearchResult[] {
        const rows: any[] = Array.isArray(body?.search_result) ? body.search_result : [];
        return clampResults(
                rows.map((row) => ({
                        url: String(row.link ?? row.url ?? ""),
                        title: String(row.title ?? row.link ?? ""),
                        snippet: String(row.content ?? "").slice(0, 400),
                        published: row.publish_date ? String(row.publish_date) : undefined,
                })),
                cap,
        );
}

async function zhipuSearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const cap = maxResultsCap(opts.maxResults);
        const key = process.env.ZHIPU_API_KEY || "";
        if (!key) throw new Error("zhipu needs ZHIPU_API_KEY");
        const body = await jsonRequest("https://api.z.ai/api/paas/v4/web_search", {
                method: "POST",
                headers: { authorization: `Bearer ${key}` },
                body: JSON.stringify({ search_query: query, count: cap }),
        });
        const results = parseZhipuResponse(body, cap);
        if (results.length === 0) throw new Error("zhipu returned no results");
        return results;
}

/** DashScope (Qwen) enable_search grounding — model-mediated search: the
 *  query is answered by a Qwen model with live web results injected. Works
 *  with any OpenAI-compatible DashScope endpoint (override base/model via
 *  UNOWN_DASHSCOPE_BASE_URL / UNOWN_DASHSCOPE_MODEL).
 *
 *  Key classes (verified live 2026-10-19, receipts in
 *  benchmarks/websearch-live/): STANDARD keys (sk-…) get real grounding on
 *  the standard endpoints, where enable_search is a documented, metered
 *  feature. CODING-PLAN keys (sk-sp-…) are accepted only by the coding
 *  endpoints — which silently ignore enable_search (the model answers from
 *  training data and, asked directly, reports no live access; no search
 *  fields come back) — while both standard endpoints reject them with 401.
 *  A coding key therefore cannot ground a search anywhere; presenting its
 *  ungrounded answer as "search results" would be dishonest, so the
 *  adapter refuses up front with an actionable note and the chain
 *  cascades transparently. */
async function dashscopeSearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const key = process.env.DASHSCOPE_API_KEY || "";
        if (!key) throw new Error("dashscope needs DASHSCOPE_API_KEY");
        if (/^sk-sp-/.test(key)) {
                throw new Error(
                        "coding-plan keys (sk-sp-…) cannot power enable_search grounding — the coding " +
                                "endpoints silently ignore the flag and the standard endpoints reject these keys (401). " +
                                "Set a standard DashScope API key (sk-…) for this provider, or unset DASHSCOPE_API_KEY " +
                                "to let the chain use the keyless providers.",
                );
        }
        const base = (process.env.UNOWN_DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(
                /\/+$/,
                "",
        );
        const model = process.env.UNOWN_DASHSCOPE_MODEL || "qwen-plus";
        const request = () =>
                jsonRequest(`${base}/chat/completions`, {
                        method: "POST",
                        headers: { authorization: `Bearer ${key}` },
                        body: JSON.stringify({
                                model,
                                messages: [
                                        {
                                                role: "user",
                                                content: `Use web search to answer this query concisely (max 200 words), then list source URLs you used, one per line: ${query}`,
                                        },
                                ],
                                enable_search: true,
                        }),
                        timeoutMs: searchTimeoutMs() + 20_000,
                });
        let body: any;
        try {
                body = await request();
        } catch (err: any) {
                // enable_search is hourly-metered; a transient throttle deserves one
                // short backoff retry before the chain moves on.
                if (!/429|throttling/i.test(String(err?.message ?? ""))) throw err;
                await new Promise((resolve) => setTimeout(resolve, 5000));
                body = await request();
        }
        const answer = body?.choices?.[0]?.message?.content ?? "";
        if (!answer.trim()) throw new Error("dashscope returned an empty answer");
        const urls = [...answer.matchAll(/https?:\/\/[^\s)"']+/g)].map((m) => m[0]);
        const sources = [...new Set(urls)].slice(0, maxResultsCap(opts.maxResults) - 1);
        const results: WebSearchResult[] = sources.map((url) => ({
                url,
                title: "dashscope source",
                snippet: "",
        }));
        results.unshift({
                url: "https://dashscope.aliyuncs.com",
                title: "Qwen grounded answer",
                snippet: answer.slice(0, 2500),
        });
        return clampResults(results, maxResultsCap(opts.maxResults));
}

/** Kagi search API — pay-as-you-go, high quality. */
export function parseKagiResponse(body: any, cap: number): WebSearchResult[] {
        const rows: any[] = Array.isArray(body?.data) ? body.data : [];
        return clampResults(
                rows.map((row) => ({
                        url: String(row.u ?? row.url ?? ""),
                        title: String(row.t ?? row.title ?? row.u ?? ""),
                        snippet: String(row.snippet ?? "").slice(0, 400),
                })),
                cap,
        );
}

async function kagiSearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const cap = maxResultsCap(opts.maxResults);
        const key = process.env.KAGI_API_KEY || "";
        if (!key) throw new Error("kagi needs KAGI_API_KEY");
        const body = await jsonRequest(`https://kagi.com/api/v0/search?q=${encodeURIComponent(query)}`, {
                headers: { authorization: `Bearer ${key}` },
        });
        if (Array.isArray(body?.error) && body.error.length > 0) {
                throw new Error(`kagi error: ${JSON.stringify(body.error).slice(0, 200)}`);
        }
        const results = parseKagiResponse(body, cap);
        if (results.length === 0) throw new Error("kagi returned no results");
        return results;
}

/** SerpApi — Google SERP, 250 free searches/month. */
export function parseSerpApiResponse(body: any, cap: number): WebSearchResult[] {
        const rows: any[] = body?.organic_results ?? [];
        return clampResults(
                rows.map((row) => ({
                        url: String(row.link ?? ""),
                        title: String(row.title ?? row.link ?? ""),
                        snippet: String(row.snippet ?? "").slice(0, 400),
                        published: row.date ? String(row.date) : undefined,
                })),
                cap,
        );
}

async function serpapiSearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const cap = maxResultsCap(opts.maxResults);
        const key = process.env.SERPAPI_API_KEY || "";
        if (!key) throw new Error("serpapi needs SERPAPI_API_KEY");
        const params = new URLSearchParams({ engine: "google", q: query, num: String(cap), api_key: key });
        const body = await jsonRequest(`https://serpapi.com/search.json?${params}`, {});
        if (body?.error) throw new Error(`serpapi error: ${String(body.error).slice(0, 200)}`);
        const results = parseSerpApiResponse(body, cap);
        if (results.length === 0) throw new Error("serpapi returned no organic results");
        return results;
}

/** Firecrawl /v1/search — search + scrape in one call (credit-metered). */
export function parseFirecrawlSearchResponse(body: any, cap: number): WebSearchResult[] {
        const rows: any[] = Array.isArray(body?.data) ? body.data : [];
        return clampResults(
                rows.map((row) => ({
                        url: String(row.url ?? ""),
                        title: String(row.title ?? row.url ?? ""),
                        snippet: String(row.description ?? "").slice(0, 400),
                        content: typeof row.markdown === "string" ? row.markdown.slice(0, 4000) : undefined,
                })),
                cap,
        );
}

async function firecrawlSearch(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
        const cap = maxResultsCap(opts.maxResults);
        const key = process.env.FIRECRAWL_API_KEY || "";
        if (!key) throw new Error("firecrawl needs FIRECRAWL_API_KEY");
        const body = await jsonRequest("https://api.firecrawl.dev/v1/search", {
                method: "POST",
                headers: { authorization: `Bearer ${key}` },
                body: JSON.stringify({ query, limit: cap }),
                timeoutMs: searchTimeoutMs() + 15_000,
        });
        const results = parseFirecrawlSearchResponse(body, cap);
        if (results.length === 0) throw new Error("firecrawl returned no results");
        return results;
}

// ---------------------------------------------------------------------------
// Registry + chain resolution
// ---------------------------------------------------------------------------

function envKey(vars: string[]): string {
        for (const name of vars) {
                const value = process.env[name] || "";
                if (value) return value;
        }
        return "";
}

function keyConfigured(vars: string[]): boolean {
        return envKey(vars) !== "";
}

const allSearchProviders: WebSearchProvider[] = [
        // --- free (keyless modes) ---
        {
                id: "duckduckgo",
                name: "DuckDuckGo",
                tier: "free",
                keyEnvVars: [],
                isConfigured: () => true,
                search: duckduckgoSearch,
        },
        {
                id: "tavily",
                name: "Tavily",
                tier: "free",
                keyEnvVars: ["TAVILY_API_KEY"],
                isConfigured: () => true, // keyless mode always available
                search: tavilySearch,
        },
        {
                id: "youcom",
                name: "You.com (free MCP)",
                tier: "free",
                keyEnvVars: [],
                isConfigured: () => true,
                search: youcomSearch,
        },
        {
                id: "wikipedia",
                name: "Wikipedia",
                tier: "free",
                keyEnvVars: [],
                isConfigured: () => true,
                search: wikipediaSearch,
        },
        {
                id: "hn",
                name: "Hacker News (Algolia)",
                tier: "free",
                keyEnvVars: [],
                isConfigured: () => true,
                search: hnSearch,
        },
        {
                id: "npm",
                name: "npm registry",
                tier: "free",
                keyEnvVars: [],
                isConfigured: () => true,
                search: npmSearch,
        },
        {
                id: "github",
                name: "GitHub repos",
                tier: "free",
                keyEnvVars: [],
                optionalKeyEnvVars: ["GITHUB_TOKEN"],
                isConfigured: () => true, // keyless (10 req/min per IP); token lifts limits
                search: githubSearch,
        },
        {
                id: "stackexchange",
                name: "StackExchange",
                tier: "free",
                keyEnvVars: [],
                optionalKeyEnvVars: ["UNOWN_STACKEXCHANGE_KEY"],
                isConfigured: () => true, // keyless (IP-limited) works; key boosts limits
                search: stackexchangeSearch,
        },
        {
                id: "searxng",
                name: "SearXNG",
                tier: "free",
                keyEnvVars: ["UNOWN_SEARXNG_URL"],
                isConfigured: () => (process.env.UNOWN_SEARXNG_URL || "") !== "",
                search: searxngSearch,
        },
        // --- paid (API key) ---
        {
                id: "brave",
                name: "Brave Search",
                tier: "paid",
                keyEnvVars: ["BRAVE_SEARCH_API_KEY", "BRAVE_API_KEY"],
                isConfigured: () => keyConfigured(["BRAVE_SEARCH_API_KEY", "BRAVE_API_KEY"]),
                search: braveSearch,
        },
        {
                id: "serper",
                name: "Serper (Google)",
                tier: "paid",
                keyEnvVars: ["SERPER_API_KEY"],
                isConfigured: () => keyConfigured(["SERPER_API_KEY"]),
                search: serperSearch,
        },
        {
                id: "exa",
                name: "Exa",
                tier: "paid",
                keyEnvVars: ["EXA_API_KEY"],
                isConfigured: () => keyConfigured(["EXA_API_KEY"]),
                search: exaSearch,
        },
        {
                id: "perplexity",
                name: "Perplexity",
                tier: "paid",
                keyEnvVars: ["PERPLEXITY_API_KEY", "PPLX_API_KEY"],
                isConfigured: () => keyConfigured(["PERPLEXITY_API_KEY", "PPLX_API_KEY"]),
                search: perplexitySearch,
        },
        {
                id: "jina",
                name: "Jina AI",
                tier: "paid",
                keyEnvVars: ["JINA_API_KEY", "JINA_READER_API_KEY"],
                isConfigured: () => keyConfigured(["JINA_API_KEY", "JINA_READER_API_KEY"]),
                search: jinaSearch,
        },
        {
                id: "zhipu",
                name: "Zhipu (Z.AI)",
                tier: "paid",
                keyEnvVars: ["ZHIPU_API_KEY"],
                isConfigured: () => keyConfigured(["ZHIPU_API_KEY"]),
                search: zhipuSearch,
        },
        {
                id: "dashscope",
                name: "DashScope (Qwen grounded)",
                tier: "paid",
                keyEnvVars: ["DASHSCOPE_API_KEY"],
                isConfigured: () => keyConfigured(["DASHSCOPE_API_KEY"]),
                search: dashscopeSearch,
        },
        {
                id: "kagi",
                name: "Kagi",
                tier: "paid",
                keyEnvVars: ["KAGI_API_KEY"],
                isConfigured: () => keyConfigured(["KAGI_API_KEY"]),
                search: kagiSearch,
        },
        {
                id: "serpapi",
                name: "SerpApi",
                tier: "paid",
                keyEnvVars: ["SERPAPI_API_KEY"],
                isConfigured: () => keyConfigured(["SERPAPI_API_KEY"]),
                search: serpapiSearch,
        },
        {
                id: "firecrawl",
                name: "Firecrawl",
                tier: "paid",
                keyEnvVars: ["FIRECRAWL_API_KEY"],
                isConfigured: () => keyConfigured(["FIRECRAWL_API_KEY"]),
                search: firecrawlSearch,
        },
];

export interface ProviderSummary {
        id: string;
        name: string;
        tier: "free" | "paid";
        keyEnvVars: string[];
        optionalKeyEnvVars?: string[];
        configured: boolean;
}

export function listSearchProviders(): ProviderSummary[] {
        return allSearchProviders.map((p) => ({
                id: p.id,
                name: p.name,
                tier: p.tier,
                keyEnvVars: p.keyEnvVars,
                optionalKeyEnvVars: p.optionalKeyEnvVars,
                configured: p.isConfigured(),
        }));
}

/** Keyed-provider priority when keys are present (quality-then-cost order). */
const KEYED_PRIORITY = [
        "tavily",
        "serper",
        "exa",
        "brave",
        "perplexity",
        "dashscope",
        "jina",
        "zhipu",
        "firecrawl",
        "kagi",
        "serpapi",
];

/** Keyless chain: works out of the box; general engines first, domain-
 *  specific (wikipedia/hn) as terminal safety nets. */
const KEYLESS_CHAIN = [
        "searxng",
        "duckduckgo",
        "tavily",
        "youcom",
        "stackexchange",
        "wikipedia",
        "hn",
        "npm",
        "github",
];

/**
 * Resolve the provider chain for a search: explicit env override first,
 * then every keyed provider whose key is present, then the keyless chain.
 * Deduplicated; unknown explicit ids surface as an error at run time.
 */
export function resolveSearchChain(explicit?: string): string[] {
        const fromArg = (explicit || "").trim();
        const override = (fromArg || process.env.UNOWN_WEB_SEARCH_PROVIDER || "").trim();
        const chain: string[] = [];
        const push = (ids: string[]) => {
                for (const id of ids) if (!chain.includes(id)) chain.push(id);
        };
        if (override) {
                push(
                        override
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean),
                );
                return chain;
        }
        const keyed = KEYED_PRIORITY.filter((id) => {
                const provider = allSearchProviders.find((p) => p.id === id);
                return provider
                        ? provider.isConfigured() && provider.keyEnvVars.length > 0 && keyConfigured(provider.keyEnvVars)
                        : false;
        });
        push(keyed);
        // Keyless chain: unconfigured entries (searxng without a URL) drop out.
        push(
                KEYLESS_CHAIN.filter((id) => {
                        const provider = allSearchProviders.find((p) => p.id === id);
                        return provider ? provider.isConfigured() : false;
                }),
        );
        return chain;
}

/** Background refresh for a stale-while-revalidate serve (search). The
 *  caller already got the marked stale answer; this restores freshness for
 *  the NEXT caller. Detached (never throws into the serve path) and
 *  collapsed through its own single-flight key — a burst of identical
 *  stale-served calls costs exactly one upstream round. Distinct from the
 *  foreground `search:` key on purpose: joining that one would return the
 *  stale serve itself and refresh nothing. */
function kickSwrSearchRefresh(ckey: SearchCacheKey, query: string, opts: WebSearchOptions): void {
        void coalesce(`swr:${ckey.key}`, async () => {
                try {
                        const outcome = await runWebSearchUncached(query, opts);
                        webCachePut({
                                schema: 1,
                                kind: "search",
                                key: ckey.key,
                                keyMaterial: ckey.keyMaterial,
                                payload: outcome,
                                provider: outcome.provider,
                                storedAt: Date.now(),
                                ttlMs: ckey.ttlMs,
                                staleIfErrorMs: ckey.staleIfErrorMs,
                        });
                        webCacheLogEvent({ ts: Date.now(), kind: "miss", tool: "web_search", provider: outcome.provider, detail: `${query.slice(0, 80)} (swr refresh)` });
                } catch (err) {
                        webCacheLogEvent({ ts: Date.now(), kind: "error", tool: "web_search", detail: `swr refresh failed: ${(err as Error)?.message ?? String(err)}`.slice(0, 120) });
                }
        }).catch(() => {
                /* detached by contract */
        });
}

/**
 * Run a web search across the resolved provider chain. Providers are tried
 * in order; the first one returning results wins, and failures cascade with
 * per-provider notes (surfaced to the model for transparency).
 */
export async function runWebSearch(query: string, opts: WebSearchOptions = {}): Promise<WebSearchOutcome> {
        // The web results store wraps the provider chain: fresh identical
        // queries answer from disk (zero upstream calls), and every upstream
        // failure can still be answered stale within the bounded window.
        // In-process coalescing means parallel subagents asking the same
        // thing pay for exactly one provider call.
        const ckey = searchCacheKey(query, opts);
        if (opts.noCache) {
                return runWebSearchUncached(query, opts);
        }
        return coalesce(`search:${ckey.key}`, async () => {
                const hit = lookupFresh<WebSearchOutcome>(ckey.key);
                if (hit) {
                        webCacheLogEvent({
                                ts: Date.now(),
                                kind: "hit",
                                tool: "web_search",
                                provider: hit.value.provider,
                                detail: query.slice(0, 80),
                                ageMs: hit.ageMs,
                        });
                        return { ...hit.value, query, cache: { provenance: hit.provenance, ageMs: hit.ageMs } };
                }
                // Stale-while-revalidate (RFC 5861): a stale answer inside the
                // window serves immediately — marked "refreshing" — while a
                // background refresh restores freshness for the next caller.
                // nginx's `proxy_cache_use_stale updating` / Varnish grace are
                // the production precedent; UNOWN_WEB_CACHE_SWR=0 disables.
                const swrCandidate = webCacheGet<WebSearchOutcome>(ckey.key);
                if (swrCandidate && eligibleForSwr(swrCandidate)) {
                        const ageMs = Date.now() - swrCandidate.storedAt;
                        kickSwrSearchRefresh(ckey, query, opts);
                        webCacheLogEvent({ ts: Date.now(), kind: "stale", tool: "web_search", provider: swrCandidate.payload.provider, detail: `${query.slice(0, 80)} (swr)`, ageMs });
                        return { ...swrCandidate.payload, query, cache: { provenance: "refreshing", ageMs } };
                }
                try {
                        const outcome = await runWebSearchUncached(query, opts);
                        // Only successful outcomes are cached — the chain throws on
                        // total failure, and a provider cascade's partial failure
                        // notes ride `attempted` (kept, they describe the win too).
                        webCachePut({
                                schema: 1,
                                kind: "search",
                                key: ckey.key,
                                keyMaterial: ckey.keyMaterial ?? JSON.stringify({ kind: "search", query }),
                                payload: outcome,
                                provider: outcome.provider,
                                storedAt: Date.now(),
                                ttlMs: ckey.ttlMs,
                                staleIfErrorMs: ckey.staleIfErrorMs,
                        });
                        webCacheLogEvent({
                                ts: Date.now(),
                                kind: "miss",
                                tool: "web_search",
                                provider: outcome.provider,
                                detail: query.slice(0, 80),
                        });
                        return outcome;
                } catch (err) {
                        // Stale-if-error: every provider failed (quota exhausted,
                        // network down, provider 5xx) — the last good answer is
                        // better than an error, within the bounded window.
                        const stale = lookupStale<WebSearchOutcome>(ckey.key);
                        if (stale) {
                                webCacheLogEvent({
                                        ts: Date.now(),
                                        kind: "stale",
                                        tool: "web_search",
                                        provider: stale.value.provider,
                                        detail: query.slice(0, 80),
                                        ageMs: stale.ageMs,
                                });
                                return { ...stale.value, query, cache: { provenance: "stale", ageMs: stale.ageMs } };
                        }
                        throw err;
                }
        });
}

/** The provider chain proper — what runWebSearch shrinks to when the store
 *  is disabled (UNOWN_WEB_CACHE=0) or bypassed (noCache: live verification). */
async function runWebSearchUncached(query: string, opts: WebSearchOptions): Promise<WebSearchOutcome> {
        const chain = resolveSearchChain(opts.provider);
        const attempted: Array<{ provider: string; ok: boolean; note: string }> = [];
        if (chain.length === 0) {
                throw new Error("no web-search provider resolved (set a provider key or check UNOWN_WEB_SEARCH_PROVIDER)");
        }
        // Cap cascade at 4 providers so a fully-walled network fails fast.
        for (const id of chain.slice(0, 4)) {
                const provider = allSearchProviders.find((p) => p.id === id);
                if (!provider) {
                        attempted.push({ provider: id, ok: false, note: "unknown provider id" });
                        continue;
                }
                if (id !== "tavily" && provider.keyEnvVars.length > 0 && !keyConfigured(provider.keyEnvVars)) {
                        attempted.push({ provider: id, ok: false, note: "API key not set" });
                        continue;
                }
                if (opts.signal?.aborted) throw new Error("web search aborted");
                try {
                        let results = await provider.search(query, opts);
                        results = filterByDomains(results, opts.allowedDomains, opts.blockedDomains);
                        if (results.length === 0) {
                                attempted.push({ provider: id, ok: false, note: "no results after domain filter" });
                                continue;
                        }
                        attempted.push({ provider: id, ok: true, note: `${results.length} results` });
                        return { results, provider: id, attempted, query };
                } catch (err: any) {
                        attempted.push({ provider: id, ok: false, note: err?.message ?? String(err) });
                }
        }
        const notes = attempted.map((a) => `${a.provider}: ${a.note}`).join("; ");
        throw new Error(`all web-search providers failed — ${notes}`);
}

/** Compact, model-friendly rendering of search results. */
export function formatSearchResults(outcome: WebSearchOutcome): string {
        const lines: string[] = [];
        const cacheNote = renderCacheNote(outcome.cache);
        lines.push(
                `Web search: "${outcome.query}" — ${outcome.results.length} result(s) via ${outcome.provider}${
                        cacheNote ? ` ${cacheNote}` : ""
                }`,
        );
        lines.push("");
        for (const [index, result] of outcome.results.entries()) {
                lines.push(`${index + 1}. ${result.title || result.url}`);
                lines.push(`   ${result.url}`);
                if (result.snippet) lines.push(`   ${result.snippet.replace(/\s+/g, " ").slice(0, 400)}`);
                if (result.published) lines.push(`   published: ${result.published}`);
                if (result.content && result.content.length > result.snippet.length) {
                        lines.push(`   content: ${result.content.replace(/\s+/g, " ").slice(0, 1200)}`);
                }
        }
        const failed = outcome.attempted.filter((a) => !a.ok);
        if (failed.length > 0) {
                lines.push("");
                lines.push(`providers skipped: ${failed.map((f) => `${f.provider} (${f.note.slice(0, 80)})`).join(", ")}`);
        }
        return lines.join("\n");
}

/** Human/model-readable provenance note appended to header lines — the
 *  agent (and the user reading the transcript) always sees where an answer
 *  came from. Compact on purpose: it rides every cached tool result. */
function renderCacheNote(cache?: WebCacheProvenance): string {
        if (!cache) return "";
        const age = formatAge(cache.ageMs);
        if (cache.provenance === "hit") return `· cached (${age} old)`;
        if (cache.provenance === "revalidated") return `· revalidated (unchanged, ${age} old)`;
        if (cache.provenance === "refreshing") return `· stale — refreshing in background (${age} old)`;
        return `· STALE — served after provider error (${age} old)`;
}

function formatAge(ms: number): string {
        const minutes = Math.floor(ms / 60_000);
        if (minutes < 1) return "<1m";
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
        const days = Math.floor(hours / 24);
        return `${days}d${hours % 24 ? ` ${hours % 24}h` : ""}`;
}

// ---------------------------------------------------------------------------
// Fetch pipeline (webfetch): direct → Tavily extract → Jina → Firecrawl
// ---------------------------------------------------------------------------

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_FETCH_MAX_CHARS = 20_000;
const FETCH_BODY_HARD_CAP = 4_000_000;
/** Fetches are STORED at the ceiling (fetchMaxChars' clamp max) and sliced
 *  per-request at render time — one entry serves every max_chars value. */
const FETCH_STORE_CEILING_CHARS = 200_000;

function fetchTimeoutMs(): number {
        const raw = Number(process.env.UNOWN_WEBFETCH_TIMEOUT_MS || "");
        return Number.isFinite(raw) && raw >= 2000 && raw <= 180_000 ? raw : DEFAULT_FETCH_TIMEOUT_MS;
}

export function fetchMaxChars(requested: number | undefined): number {
        const envRaw = Number(process.env.UNOWN_WEBFETCH_MAX_CHARS || "");
        let raw = DEFAULT_FETCH_MAX_CHARS;
        if (requested !== undefined && Number.isFinite(requested)) raw = requested;
        else if (Number.isFinite(envRaw) && envRaw > 0) raw = envRaw;
        return Math.min(Math.max(Math.trunc(raw), 500), 200_000);
}

interface FetchOutcome {
        url: string;
        /** Body stored at the ceiling (FETCH_STORE_CEILING_CHARS); sliced to
         *  the caller's maxChars at render time. */
        content: string;
        /** Full body length before the ceiling slice (drives `truncated`). */
        contentLength: number;
        method: "direct" | "tavily-extract" | "jina-reader" | "firecrawl-scrape";
        status?: number;
        contentType?: string;
        /** RFC 9111 validators (direct fetches only) — the "version change"
         *  detectors for conditional revalidation. */
        validators?: { etag?: string; lastModified?: string };
        /** Origin freshness directives (direct fetches only). */
        cacheControl?: string;
        expiresMs?: number;
}

function renderFetchOutcome(outcome: FetchOutcome, maxChars: number, cache?: WebCacheProvenance): string {
        const content = outcome.content.slice(0, maxChars);
        const truncated = outcome.contentLength > maxChars;
        const cacheNote = renderCacheNote(cache);
        const header = `GET ${outcome.url} -> ${outcome.method}${outcome.status ? ` (HTTP ${outcome.status})` : ""}${
                outcome.contentType ? ` (${outcome.contentType.split(";")[0]})` : ""
        }${cacheNote ? ` ${cacheNote}` : ""}`;
        if (truncated) {
                return `${header}\n\n${content}\n\n... (truncated at ${maxChars} chars)`;
        }
        return `${header}\n\n${content}`;
}

/** Pull the RFC 9111 validators + freshness directives off a direct response. */
function captureValidators(res: Response): { validators?: { etag?: string; lastModified?: string }; cacheControl?: string; expiresMs?: number } {
        const etag = res.headers.get("etag") ?? undefined;
        const lastModified = res.headers.get("last-modified") ?? undefined;
        const cacheControl = res.headers.get("cache-control") ?? undefined;
        const expiresHeader = res.headers.get("expires");
        let expiresMs: number | undefined;
        if (expiresHeader) {
                const parsed = Date.parse(expiresHeader);
                if (Number.isFinite(parsed)) expiresMs = parsed;
        }
        const validators = etag || lastModified ? { etag, lastModified } : undefined;
        return { validators, cacheControl, expiresMs };
}

/** Direct HTTP GET with the SSRF guard, robots check, real browser-ish UA
 *  and size caps. HTML is stripped to text. When `validators` is passed the
 *  request becomes a conditional GET (If-None-Match/If-Modified-Since) and
 *  a 304 resolves as `{ notModified: true }` — the caller serves the stored
 *  body (this is the "no version change" check). */
async function directFetch(
        url: URL,
        maxChars: number,
        signal?: AbortSignal,
        validators?: { etag?: string; lastModified?: string },
): Promise<FetchOutcome & { notModified?: boolean }> {
        if (!(await isRobotsAllowed(url))) {
                throw new Error(`robots.txt disallows fetching ${url.pathname} on ${url.host}`);
        }
        const headers: Record<string, string> = {
                "user-agent": SEARCH_USER_AGENT,
                accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5",
                "accept-language": "en-US,en;q=0.9",
        };
        if (validators?.etag) headers["if-none-match"] = validators.etag;
        if (validators?.lastModified) headers["if-modified-since"] = validators.lastModified;
        const res = await fetch(url, {
                redirect: "follow",
                signal: signal ?? AbortSignal.timeout(fetchTimeoutMs()),
                headers,
        });
        if (res.status === 304) {
                return { url: url.toString(), content: "", contentLength: 0, method: "direct", status: 304, notModified: true };
        }
        const captured = captureValidators(res);
        const contentType = res.headers.get("content-type") ?? "";
        const declaredLength = Number(res.headers.get("content-length") ?? "0");
        if (declaredLength && declaredLength > FETCH_BODY_HARD_CAP) {
                throw new Error(`body too large (${(declaredLength / 1_000_000).toFixed(1)} MB > 4 MB cap)`);
        }
        const raw = await res.text();
        if (raw.length > FETCH_BODY_HARD_CAP) throw new Error(`body too large (${raw.length} chars > cap)`);
        const looksHtml = /text\/html/i.test(contentType) || /^\s*(<!doctype html|<html)/i.test(raw);
        const text = looksHtml ? htmlToText(raw) : raw;
        return {
                url: url.toString(),
                content: text.slice(0, maxChars),
                contentLength: text.length,
                method: "direct",
                status: res.status,
                contentType,
                validators: captured.validators,
                cacheControl: captured.cacheControl,
                expiresMs: captured.expiresMs,
        };
}

/** Tavily /extract — keyless mode works (rate-limited), keyed mode better. */
async function tavilyExtractFetch(url: URL, maxChars: number): Promise<FetchOutcome> {
        const key = process.env.TAVILY_API_KEY || "";
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (key) headers.authorization = `Bearer ${key}`;
        else headers["x-tavily-access-mode"] = "keyless";
        const body = await jsonRequest("https://api.tavily.com/extract", {
                method: "POST",
                headers,
                body: JSON.stringify({ urls: [url.toString()] }),
                timeoutMs: fetchTimeoutMs(),
        });
        const rows: any[] = body?.results ?? [];
        const failed: any[] = body?.failed_results ?? [];
        const text = rows.find((row) => typeof row?.raw_content === "string" && row.raw_content)?.raw_content;
        if (typeof text !== "string" || !text.trim()) {
                const reason = failed[0]?.error ? String(failed[0].error) : "no raw_content";
                throw new Error(`tavily extract failed for ${url.hostname}: ${reason}`);
        }
        return {
                url: url.toString(),
                content: text.slice(0, maxChars),
                contentLength: text.length,
                method: "tavily-extract",
        };
}

/** Jina r.jina.ai reader — returns markdown; needs a key (keyless is
 *  IP-reputation gated). */
async function jinaReaderFetch(url: URL, maxChars: number): Promise<FetchOutcome> {
        const key = process.env.JINA_API_KEY || process.env.JINA_READER_API_KEY || "";
        if (!key) throw new Error("jina reader needs JINA_API_KEY");
        const res = await fetch(`https://r.jina.ai/${url.toString()}`, {
                headers: { authorization: `Bearer ${key}`, "x-return-format": "markdown" },
                redirect: "follow",
                signal: AbortSignal.timeout(fetchTimeoutMs()),
        });
        const text = await res.text();
        if (!res.ok) throw httpError(res.status, "r.jina.ai", text);
        if (!text.trim()) throw new Error("jina reader returned empty content");
        return {
                url: url.toString(),
                content: text.slice(0, maxChars),
                contentLength: text.length,
                method: "jina-reader",
        };
}

/** Firecrawl /v1/scrape — JS rendering, markdown output; keyed. */
async function firecrawlScrapeFetch(url: URL, maxChars: number): Promise<FetchOutcome> {
        const key = process.env.FIRECRAWL_API_KEY || "";
        if (!key) throw new Error("firecrawl needs FIRECRAWL_API_KEY");
        const body = await jsonRequest("https://api.firecrawl.dev/v1/scrape", {
                method: "POST",
                headers: { authorization: `Bearer ${key}` },
                body: JSON.stringify({ url: url.toString(), formats: ["markdown"] }),
                timeoutMs: fetchTimeoutMs() + 30_000,
        });
        const markdown = body?.data?.markdown;
        if (typeof markdown !== "string" || !markdown.trim()) {
                throw new Error(`firecrawl scrape returned no markdown for ${url.hostname}`);
        }
        return {
                url: url.toString(),
                content: markdown.slice(0, maxChars),
                contentLength: markdown.length,
                method: "firecrawl-scrape",
        };
}

// (The old process-local fetch cache — 10-minute Map, 20 URLs — was replaced
// by the persistent web results store: same lookup semantics, but it survives
// process exits, is shared by every unown surface on the machine, honors
// origin Cache-Control/validators, and serves stale on upstream failure.)

/** Origin said no-store/no-cache — the ONE case where a successful direct
 *  fetch must not enter the store at all (RFC 9111 §5.2.2.3–4). Note the
 *  contrast: max-age=0 or TTL knobs at 0 mean "never fresh, always
 *  revalidate" — those entries ARE stored, because revalidation needs the
 *  body + validators to compare against. */
function originRefusesStorage(cacheControl?: string): boolean {
        const cc = (cacheControl ?? "").toLowerCase();
        return /\bno-store\b/.test(cc) || /\bno-cache\b/.test(cc);
}

/** Compute the TTL for a freshly fetched outcome: direct fetches honor the
 *  origin's Cache-Control/Expires (capped 24 h); extraction fallbacks get
 *  the heuristic default (no origin headers). */
function outcomeTtlMs(outcome: FetchOutcome, heuristicMs: number): number {
        if (outcome.method !== "direct") return heuristicMs;
        return computeFetchTtlMs(outcome.cacheControl, outcome.expiresMs, Date.now());
}

/**
 * Fetch a page as text with the full hardening + fallback chain:
 * SSRF guard → robots → web results store → direct fetch → tavily extract
 * (keyless-capable) → jina reader (keyed) → firecrawl (keyed).
 *
 * Store flow: fresh hit → serve (zero upstream). Stale entry with
 * validators → conditional GET: 304 = "no version change" → revalidate +
 * serve the stored body; 200 = changed → replace. Every attempt failed →
 * stale-if-error within the bounded window, always flagged. `noCache`
 * bypasses the store entirely (live verification, force-refresh).
 */
export async function fetchPageContent(
        rawUrl: string,
        opts: { maxChars?: number; signal?: AbortSignal; noCache?: boolean; tool?: "webfetch" | "fetch_url" } = {},
): Promise<string> {
        const url = await assertFetchableUrl(rawUrl);
        const maxChars = fetchMaxChars(opts.maxChars);
        const tool = opts.tool ?? "webfetch";
        const ckey = fetchCacheKey(normalizeFetchUrl(rawUrl), false);
        const storeChars = FETCH_STORE_CEILING_CHARS;

        if (opts.noCache) {
                // Bypass: live verification, force-refresh. No store reads or
                // writes — the caller's cap is also the fetch cap.
                const outcome = await fetchOutcomeUncached(url, opts, maxChars);
                return renderFetchOutcome(outcome, maxChars);
        }
        return coalesce(`fetch:${ckey.key}`, async () => {
                // 1. Fresh hit — zero upstream calls.
                const hit = lookupFresh<FetchOutcome>(ckey.key);
                if (hit) {
                        webCacheLogEvent({
                                ts: Date.now(),
                                kind: "hit",
                                tool,
                                provider: hit.value.method,
                                detail: url.host,
                                ageMs: hit.ageMs,
                        });
                        return renderFetchOutcome(hit.value, maxChars, {
                                provenance: hit.provenance,
                                ageMs: hit.ageMs,
                        });
                }

                // 2. Stale entry with validators → conditional revalidation
                //    (the "no version change" path).
                const staleEntry = webCacheGet<FetchOutcome>(ckey.key);
                if (staleEntry && !isFresh(staleEntry) && staleEntry.validators && staleEntry.payload.method === "direct") {
                        try {
                                const probed = await directFetch(url, storeChars, opts.signal, staleEntry.validators);
                                if (probed.notModified) {
                                        webCacheRefresh(ckey.key);
                                        const ageMs = Date.now() - staleEntry.storedAt;
                                        webCacheLogEvent({
                                                ts: Date.now(),
                                                kind: "revalidated",
                                                tool,
                                                provider: "direct",
                                                detail: url.host,
                                                ageMs,
                                        });
                                        return renderFetchOutcome(staleEntry.payload, maxChars, { provenance: "revalidated", ageMs });
                                }
                                // 200: the page changed — serve the new body and replace.
                                if (probed.content.trim().length > 0) {
                                        storeFetchOutcome(ckey, probed, tool, url);
                                        return renderFetchOutcome(probed, maxChars);
                                }
                        } catch {
                                // Revalidation itself failed (network) — fall through to
                                // the full attempt chain below.
                        }
                }

                // 2b. Stale-while-revalidate (RFC 5861) for entries WITHOUT
                //     validators — the fallback-chain pages where a refresh
                //     re-burns provider quota. Entries WITH validators keep
                //     their precise blocking 304 path above and its
                //     fall-through semantics (a failed revalidation still
                //     reaches the full chain and stale-if-error, unchanged).
                if (staleEntry && !staleEntry.validators && eligibleForSwr(staleEntry)) {
                        const ageMs = Date.now() - staleEntry.storedAt;
                        kickSwrFetchRefresh(ckey, url, opts, tool);
                        webCacheLogEvent({ ts: Date.now(), kind: "stale", tool, provider: staleEntry.payload.method, detail: `${url.host} (swr)`, ageMs });
                        return renderFetchOutcome(staleEntry.payload, maxChars, { provenance: "refreshing", ageMs });
                }

                // 3. Full pipeline (fetched at the ceiling so one entry serves
                //    every max_chars; rendered at the caller's cap).
                try {
                        const outcome = await fetchOutcomeUncached(url, opts, storeChars);
                        storeFetchOutcome(ckey, outcome, tool, url);
                        return renderFetchOutcome(outcome, maxChars);
                } catch (err) {
                        // 4. Stale-if-error: bounded window, always flagged.
                        const stale = lookupStale<FetchOutcome>(ckey.key);
                        if (stale) {
                                webCacheLogEvent({
                                        ts: Date.now(),
                                        kind: "stale",
                                        tool,
                                        provider: stale.value.method,
                                        detail: url.host,
                                        ageMs: stale.ageMs,
                                });
                                return renderFetchOutcome(stale.value, maxChars, {
                                        provenance: "stale",
                                        ageMs: stale.ageMs,
                                });
                        }
                        throw err;
                }
        });
}

/** Background refresh for a stale-while-revalidate serve (fetch). Same
 *  contract as the search kicker: detached, single-flighted under its own
 *  key, never throws into the serve path. */
function kickSwrFetchRefresh(
        ckey: FetchCacheKey,
        url: URL,
        opts: { signal?: AbortSignal },
        tool: "webfetch" | "fetch_url",
): void {
        void coalesce(`swr-fetch:${ckey.key}`, async () => {
                try {
                        const outcome = await fetchOutcomeUncached(url, opts, FETCH_STORE_CEILING_CHARS);
                        storeFetchOutcome(ckey, outcome, tool, url);
                        webCacheLogEvent({ ts: Date.now(), kind: "miss", tool, provider: outcome.method, detail: `${url.host} (swr refresh)` });
                } catch (err) {
                        webCacheLogEvent({ ts: Date.now(), kind: "error", tool, detail: `swr refresh failed: ${(err as Error)?.message ?? String(err)}`.slice(0, 120) });
                }
        }).catch(() => {
                /* detached by contract */
        });
}

/** Store a fresh fetch outcome under its key (no-store origins skip). */
function storeFetchOutcome(
        ckey: { key: string; keyMaterial: string; ttlMs: number; staleIfErrorMs: number },
        outcome: FetchOutcome,
        tool: "webfetch" | "fetch_url",
        url: URL,
): void {
        const ttlMs = outcomeTtlMs(outcome, ckey.ttlMs);
        if (originRefusesStorage(outcome.cacheControl)) return; // origin said no-store — respect it
        webCachePut({
                schema: 1,
                kind: "fetch-text",
                key: ckey.key,
                keyMaterial: ckey.keyMaterial,
                payload: outcome,
                provider: outcome.method,
                storedAt: Date.now(),
                ttlMs,
                staleIfErrorMs: ckey.staleIfErrorMs,
                validators: outcome.validators,
        });
        webCacheLogEvent({
                ts: Date.now(),
                kind: "miss",
                tool,
                provider: outcome.method,
                detail: url.host,
        });
}

/** The attempt chain proper: direct → tavily extract → jina → firecrawl,
 *  returning the winning outcome (throws when every attempt fails). No
 *  store interaction — callers decide whether to store and how to render. */
async function fetchOutcomeUncached(
        url: URL,
        opts: { signal?: AbortSignal },
        fetchChars: number,
): Promise<FetchOutcome> {
        const attempts: Array<() => Promise<FetchOutcome>> = [
                () => directFetch(url, fetchChars, opts.signal),
                () => tavilyExtractFetch(url, fetchChars),
                () => jinaReaderFetch(url, fetchChars),
                () => firecrawlScrapeFetch(url, fetchChars),
        ];
        const notes: string[] = [];
        for (const attempt of attempts) {
                if (opts.signal?.aborted) throw new Error("webfetch aborted");
                try {
                        const outcome = await attempt();
                        if (outcome.content.trim().length === 0) {
                                notes.push(`${outcome.method}: empty content`);
                                continue;
                        }
                        return outcome;
                } catch (err: any) {
                        if (err?.message?.includes("SSRF guard") || err?.message?.includes("robots.txt disallows")) throw err;
                        notes.push(err?.message ?? String(err));
                }
        }
        throw new Error(`webfetch failed for ${url.toString()} — ${notes.join("; ")}`);
}

// ---------------------------------------------------------------------------
// Tool schemas + the web-tools extension factory
// ---------------------------------------------------------------------------

const WebSearchParams = Type.Object({
        query: Type.String({ description: "Search query (keywords work better than sentences)" }),
        max_results: Type.Optional(Type.Number({ description: "Maximum results to return (default 8, max 20)" })),
        allowed_domains: Type.Optional(Type.Array(Type.String(), { description: "Only keep results from these domains" })),
        blocked_domains: Type.Optional(Type.Array(Type.String(), { description: "Drop results from these domains" })),
        provider: Type.Optional(
                Type.String({ description: "Explicit provider id or comma-separated chain (default: auto)" }),
        ),
});

const WebFetchParams = Type.Object({
        url: Type.String({ description: "http(s) URL to fetch (GET); HTML is converted to text" }),
        max_chars: Type.Optional(Type.Number({ description: "Cap on returned characters (default 20000)" })),
        raw: Type.Optional(Type.Boolean({ description: "Skip HTML stripping and return the raw body text" })),
});

export interface WebToolsOptions {
        /** Label prefix for log lines. */
        verbose?: boolean;
}

/**
 * Injection-shield annotation for a web tool result: scan + (when suspect)
 * prepend the `[unown-injection-shield]` banner, then record the flag in the
 * session via pi.appendEntry. Wrapped around the execute() returns below —
 * the cleanest interception point: the text is post-processed BEFORE it goes
 * back to the model. annotateToolOutput is fail-open by contract, so a shield
 * error can never fail a webfetch/web_search call.
 */
function shieldWebText(pi: ExtensionAPI, log: (msg: string) => void, text: string, source: string): string {
        return annotateToolOutput(text, source, {
                onFlag: (info) => {
                        log(`injection shield flagged ${info.source}: ${info.flags.join(", ")}`);
                        recordShieldFlag(pi, info);
                },
        });
}

/**
 * Registers `web_search` + `webfetch` on a pi ExtensionAPI. Used by the
 * unown-tools extension (terminal sessions) and by the engine sandbox
 * runner (when the sandbox network namespace is enabled).
 */
export function registerWebTools(pi: ExtensionAPI, opts: WebToolsOptions = {}): void {
        const log = (msg: string) => {
                if (opts.verbose) console.error(`[unown-web] ${msg}`);
        };

        pi.registerTool({
                name: "web_search",
                label: "Web search",
                description:
                        "Search the web for current information beyond training data (library versions, release notes, error messages, documentation, news). Returns ranked results with title, URL and snippet. Providers: DuckDuckGo/Tavily/You.com/SearXNG/Wikipedia/HN (free) and Tavily/Brave/Serper/Exa/Perplexity/Jina/Zhipu/DashScope/Kagi/SerpApi/Firecrawl (API key) — auto-selected from environment keys, overridable via provider parameter or UNOWN_WEB_SEARCH_PROVIDER. Use webfetch to read a result URL in full.",
                parameters: WebSearchParams,
                async execute(_toolCallId, params) {
                        if ((process.env.UNOWN_WEB_SEARCH || "") === "0") {
                                return { content: [{ type: "text", text: "web_search is disabled (UNOWN_WEB_SEARCH=0)" }], isError: true };
                        }
                        try {
                                const outcome = await runWebSearch(params.query, {
                                        maxResults: params.max_results,
                                        allowedDomains: params.allowed_domains,
                                        blockedDomains: params.blocked_domains,
                                        provider: params.provider,
                                });
                                log(`search "${params.query}" via ${outcome.provider}: ${outcome.results.length} results`);
                                // Injection shield: web_search snippets are hostile-web
                                // content — scan the rendered results before the model sees them.
                                const text = shieldWebText(pi, log, formatSearchResults(outcome), "websearch");
                                return { content: [{ type: "text", text }] };
                        } catch (err: any) {
                                return {
                                        content: [{ type: "text", text: `web_search failed: ${err?.message ?? String(err)}` }],
                                        isError: true,
                                };
                        }
                },
                renderCall(args: any, theme: any) {
                        return new Text(
                                theme.fg("toolTitle", theme.bold("web ")) + theme.fg("accent", String(args?.query ?? "").slice(0, 70)),
                                0,
                                0,
                        );
                },
        });

        pi.registerTool({
                name: "webfetch",
                label: "Web fetch",
                description:
                        "Fetch an http(s) URL and return the page/document as text (HTML stripped, capped). Hardened against SSRF (private addresses refused) and robots-aware, with an extraction fallback chain (Tavily extract, Jina reader, Firecrawl) for sites that block plain HTTP clients. Use after web_search to read a result, or for any known docs URL.",
                parameters: WebFetchParams,
                async execute(_toolCallId, params) {
                        if ((process.env.UNOWN_WEBFETCH || "") === "0") {
                                return { content: [{ type: "text", text: "webfetch is disabled (UNOWN_WEBFETCH=0)" }], isError: true };
                        }
                        try {
                                if (params.raw) {
                                        // Raw mode: bypass the text pipeline, keep the guard.
                                        // Same web results store flow: fresh hit → serve,
                                        // conditional revalidation, stale-if-error.
                                        const url = await assertFetchableUrl(params.url);
                                        const maxChars = fetchMaxChars(params.max_chars);
                                        const ckey = fetchCacheKey(normalizeFetchUrl(params.url), true);
                                        const renderRaw = (payload: { status?: number; content: string; contentLength: number }, cache?: WebCacheProvenance) => {
                                                const cacheNote = renderCacheNote(cache);
                                                const content = payload.content.slice(0, maxChars);
                                                const truncated = payload.contentLength > maxChars;
                                                return `GET ${params.url} -> ${payload.status ?? ""}${cacheNote ? ` ${cacheNote}` : ""}\n\n${content}${
                                                        truncated ? "\n\n... (truncated)" : ""
                                                }`;
                                        };
                                        interface RawPayload {
                                                status: number;
                                                content: string;
                                                contentLength: number;
                                                validators?: { etag?: string; lastModified?: string };
                                                cacheControl?: string;
                                                expiresMs?: number;
                                        }
                                        const hit = lookupFresh<RawPayload>(ckey.key);
                                        if (hit) {
                                                webCacheLogEvent({ ts: Date.now(), kind: "hit", tool: "webfetch", provider: "direct", detail: url.host, ageMs: hit.ageMs });
                                                return { content: [{ type: "text", text: shieldWebText(pi, log, renderRaw(hit.value, { provenance: hit.provenance, ageMs: hit.ageMs }), `webfetch:${params.url}`) }] };
                                        }
                                        const headers: Record<string, string> = { "user-agent": SEARCH_USER_AGENT, accept: "*/*" };
                                        const staleEntry = webCacheGet<RawPayload>(ckey.key);
                                        if (staleEntry && !isFresh(staleEntry) && staleEntry.validators) {
                                                if (staleEntry.validators.etag) headers["if-none-match"] = staleEntry.validators.etag;
                                                if (staleEntry.validators.lastModified) headers["if-modified-since"] = staleEntry.validators.lastModified;
                                        }
                                        try {
                                                const res = await fetch(url, {
                                                        redirect: "follow",
                                                        signal: AbortSignal.timeout(fetchTimeoutMs()),
                                                        headers,
                                                });
                                                if (res.status === 304 && staleEntry) {
                                                        webCacheRefresh(ckey.key);
                                                        const ageMs = Date.now() - staleEntry.storedAt;
                                                        webCacheLogEvent({ ts: Date.now(), kind: "revalidated", tool: "webfetch", provider: "direct", detail: url.host, ageMs });
                                                        return {
                                                                content: [
                                                                        {
                                                                                type: "text",
                                                                                text: shieldWebText(
                                                                                        pi,
                                                                                        log,
                                                                                        renderRaw(staleEntry.payload, { provenance: "revalidated", ageMs }),
                                                                                        `webfetch:${params.url}`,
                                                                                ),
                                                                        },
                                                                ],
                                                        };
                                                }
                                                const text = await res.text();
                                                const captured = captureValidators(res);
                                                const payload: RawPayload = {
                                                        status: res.status,
                                                        content: text.slice(0, FETCH_STORE_CEILING_CHARS),
                                                        contentLength: text.length,
                                                        validators: captured.validators,
                                                        cacheControl: captured.cacheControl,
                                                        expiresMs: captured.expiresMs,
                                                };
                                                const ttlMs = computeFetchTtlMs(payload.cacheControl, payload.expiresMs, Date.now());
                                                if (!originRefusesStorage(payload.cacheControl)) {
                                                        webCachePut({
                                                                schema: 1,
                                                                kind: "fetch-raw",
                                                                key: ckey.key,
                                                                keyMaterial: ckey.keyMaterial,
                                                                payload,
                                                                provider: "direct",
                                                                storedAt: Date.now(),
                                                                ttlMs,
                                                                staleIfErrorMs: ckey.staleIfErrorMs,
                                                                validators: payload.validators,
                                                        });
                                                        webCacheLogEvent({ ts: Date.now(), kind: "miss", tool: "webfetch", provider: "direct", detail: url.host });
                                                }
                                                return {
                                                        content: [
                                                                {
                                                                        type: "text",
                                                                        text: shieldWebText(pi, log, renderRaw(payload), `webfetch:${params.url}`),
                                                                },
                                                        ],
                                                };
                                        } catch (err) {
                                                const stale = lookupStale<RawPayload>(ckey.key);
                                                if (stale) {
                                                        webCacheLogEvent({ ts: Date.now(), kind: "stale", tool: "webfetch", provider: "direct", detail: url.host, ageMs: stale.ageMs });
                                                        return {
                                                                content: [
                                                                        {
                                                                                type: "text",
                                                                                text: shieldWebText(pi, log, renderRaw(stale.value, { provenance: "stale", ageMs: stale.ageMs }), `webfetch:${params.url}`),
                                                                        },
                                                                ],
                                                        };
                                                }
                                                throw err;
                                        }
                                }
                                const text = await fetchPageContent(params.url, { maxChars: params.max_chars });
                                // Injection shield: fetched pages are first-class injection
                                // carriers (a hostile page addressing the reading agent).
                                return { content: [{ type: "text", text: shieldWebText(pi, log, text, `webfetch:${params.url}`) }] };
                        } catch (err: any) {
                                return {
                                        content: [{ type: "text", text: `webfetch failed: ${err?.message ?? String(err)}` }],
                                        isError: true,
                                };
                        }
                },
                renderCall(args: any, theme: any) {
                        return new Text(
                                theme.fg("toolTitle", theme.bold("web ")) + theme.fg("dim", String(args?.url ?? "").slice(0, 70)),
                                0,
                                0,
                        );
                },
        });
}

/** Slim extension that only registers the web tools (engine sandbox path). */
export function createWebToolsExtension(opts: WebToolsOptions = {}) {
        const factory = (pi: ExtensionAPI) => {
                registerWebTools(pi, opts);
        };
        return { id: "unown-web-tools", factory };
}
