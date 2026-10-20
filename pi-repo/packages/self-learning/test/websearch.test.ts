// Unit + integration tests for src/websearch.ts — the web_search/webfetch
// provider registry. Runs on `bun test` (bun:test built in — zero new deps).
//
// Layers:
//   - pure unit tests: SSRF guard tables, robots parsing, DDG URL unwrapping,
//     HTML stripping, domain filtering, provider chain resolution, formatter
//   - mock-server integration: a local HTTP server emulating each provider's
//     documented response shape, wired through UNOWN_*_URL style env overrides
//     or direct parse-function calls (no network needed)
//   - fake-pi registration test: registerWebTools registers both tools with
//     the right names/schemas
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import {
        assertFetchableUrl,
        createWebToolsExtension,
        fetchPageContent,
        filterByDomains,
        formatSearchResults,
        htmlToText,
        isAllowedByRobots,
        isPrivateHostname,
        listSearchProviders,
        parseBraveResponse,
        parseDuckduckgoHtml,
        parseExaResponse,
        parseFirecrawlSearchResponse,
        parseHnResponse,
        parseGithubResponse,
        parseJinaSearchResponse,
        parseKagiResponse,
        parseNpmResponse,
        parsePerplexityResponse,
        parseRobots,
        parseSearxngResponse,
        parseSerperResponse,
        parseSerpApiResponse,
        parseStackexchangeResponse,
        parseTavilyResponse,
        parseWikipediaResponse,
        parseYoucomMcpText,
        parseZhipuResponse,
        resolveSearchChain,
        runWebSearch,
        stripInlineHtml,
        unwrapDuckduckgoUrl,
        type WebSearchResult,
} from "../src/websearch.ts";

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

describe("isPrivateHostname — private/reserved literal hostnames", () => {
        test.each([
                "localhost",
                "db.localhost",
                "printer.local",
                "api.internal",
                "127.0.0.1",
                "10.1.2.3",
                "172.16.0.5",
                "172.31.255.255",
                "192.168.1.1",
                "169.254.169.254",
                "0.0.0.0",
                "100.64.0.1",
                "metadata.google.internal",
                "::1",
                "[::1]",
                "fe80::1",
                "fc00::5",
                "fd12:3456::1",
        ])("blocks %s", (host) => {
                expect(isPrivateHostname(host)).toBe(true);
        });

        test.each([
                "example.com",
                "bun.sh",
                "8.8.8.8",
                "1.1.1.1",
                "172.32.0.1", // just above 172.16/12
                "172.15.255.255", // just below
        ])("allows %s", (host) => {
                expect(isPrivateHostname(host)).toBe(false);
        });
});

describe("assertFetchableUrl — protocol, port and host guards", () => {
        test("rejects non-http protocols", async () => {
                await expect(assertFetchableUrl("file:///etc/passwd")).rejects.toThrow(/only http/);
                await expect(assertFetchableUrl("ftp://example.com/x")).rejects.toThrow(/only http/);
        });
        test("rejects non-standard ports", async () => {
                await expect(assertFetchableUrl("http://example.com:8080/x")).rejects.toThrow(/non-standard port/);
                await expect(assertFetchableUrl("http://example.com:9200/x")).rejects.toThrow(/non-standard port/);
        });
        test("allows standard/empty ports", async () => {
                await expect(assertFetchableUrl("https://example.com:443/x")).resolves.toBeInstanceOf(URL);
                await expect(assertFetchableUrl("https://example.com/x")).resolves.toBeInstanceOf(URL);
        });
        test("rejects private hosts", async () => {
                await expect(assertFetchableUrl("http://localhost/admin")).rejects.toThrow(/private\/reserved host/);
                await expect(assertFetchableUrl("http://10.0.0.1/x")).rejects.toThrow(/private\/reserved host/);
        });
});

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

describe("parseRobots + isAllowedByRobots", () => {
        const rules = parseRobots(
                [
                        "User-agent: *",
                        "Disallow: /private",
                        "Disallow: /admin/",
                        "Allow: /admin/public",
                        "",
                        "User-agent: Googlebot",
                        "Disallow: /",
                ].join("\n"),
        );
        test("star-scoped rules parsed, other agents ignored", () => {
                expect(rules).toHaveLength(3);
        });
        test("blocked path", () => {
                expect(isAllowedByRobots("/private/x", rules)).toBe(false);
        });
        test("allowed path", () => {
                expect(isAllowedByRobots("/docs/x", rules)).toBe(true);
        });
        test("longest-match wins (Allow beats shorter Disallow)", () => {
                expect(isAllowedByRobots("/admin/public/file", rules)).toBe(true);
                expect(isAllowedByRobots("/admin/secret", rules)).toBe(false);
        });
        test("empty robots allows everything", () => {
                expect(isAllowedByRobots("/anything", parseRobots(""))).toBe(true);
        });
});

// ---------------------------------------------------------------------------
// DuckDuckGo HTML parsing
// ---------------------------------------------------------------------------

describe("unwrapDuckduckgoUrl + parseDuckduckgoHtml", () => {
        test("unwraps uddg redirect links", () => {
                expect(unwrapDuckduckgoUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fbun.sh%2Fdocs&rut=abc")).toBe(
                        "https://bun.sh/docs",
                );
        });
        test("passes through direct links", () => {
                expect(unwrapDuckduckgoUrl("https://example.com/x")).toBe("https://example.com/x");
        });
        test("parses result blocks with snippets", () => {
                const html = [
                        '<div class="result">',
                        '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbun.sh%2Fdocs&amp;rut=x">Bun Docs</a>',
                        '<a class="result__snippet" href="#">Bun is a fast JavaScript runtime</a>',
                        "</div>",
                ].join("\n");
                const results = parseDuckduckgoHtml(html, 10);
                expect(results).toHaveLength(1);
                expect(results[0]?.url).toBe("https://bun.sh/docs");
                expect(results[0]?.title).toBe("Bun Docs");
                expect(results[0]?.snippet).toContain("JavaScript runtime");
        });
});

// ---------------------------------------------------------------------------
// HTML/text helpers
// ---------------------------------------------------------------------------

describe("htmlToText + stripInlineHtml", () => {
        test("strips scripts, styles, svg and tags", () => {
                const html =
                        "<html><head><style>.x{}</style></head><body><script>evil()</script><svg><path/></svg><p>Hello <b>world</b></p><br/>next</body></html>";
                const text = htmlToText(html);
                expect(text).not.toContain("evil");
                expect(text).not.toContain(".x{}");
                expect(text).toContain("Hello world");
                expect(text).toContain("next");
        });
        test("decodes entities", () => {
                expect(stripInlineHtml("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;")).toBe(`a & b <c> "d" 'e'`);
        });
});

// ---------------------------------------------------------------------------
// Domain filtering
// ---------------------------------------------------------------------------

describe("filterByDomains", () => {
        const results: WebSearchResult[] = [
                { url: "https://bun.sh/docs", title: "bun", snippet: "" },
                { url: "https://docs.oven-sh.com/bun", title: "oven", snippet: "" },
                { url: "https://nodejs.org/api", title: "node", snippet: "" },
                { url: "https://github.com/oven-sh/bun", title: "gh", snippet: "" },
        ];
        test("allowed_domains keeps matching hosts (subdomains included)", () => {
                const kept = filterByDomains(results, ["bun.sh"]);
                expect(kept.map((r) => r.title)).toEqual(["bun"]);
        });
        test("blocked_domains removes matching hosts", () => {
                const kept = filterByDomains(results, undefined, ["github.com"]);
                expect(kept).toHaveLength(3);
        });
        test("no filters = passthrough", () => {
                expect(filterByDomains(results)).toHaveLength(4);
        });
        test("subdomain matches domain rule", () => {
                const kept = filterByDomains(results, ["oven-sh.com"]);
                expect(kept.map((r) => r.title)).toEqual(["oven"]);
        });
});

// ---------------------------------------------------------------------------
// Provider response parsers (documented shapes, no network)
// ---------------------------------------------------------------------------

describe("provider response parsers", () => {
        test("tavily: results + answer path", () => {
                const body = { results: [{ url: "https://a.com", title: "A", content: "long content ".repeat(50) }] };
                const results = parseTavilyResponse(body, 10);
                expect(results).toHaveLength(1);
                expect(results[0]?.content).toBeDefined();
        });
        test("wikipedia: pages with excerpt HTML", () => {
                const body = { pages: [{ key: "Bun_(software)", title: "Bun (software)", excerpt: "a <b>runtime</b>" }] };
                const results = parseWikipediaResponse(body, 10);
                expect(results[0]?.url).toBe("https://en.wikipedia.org/wiki/Bun_(software)");
                expect(results[0]?.snippet).toBe("a runtime");
        });
        test("hn: hits with null url fall back to discussion link", () => {
                const body = { hits: [{ objectID: "42", title: "Show HN", url: null, created_at: "2026-01-01" }] };
                const results = parseHnResponse(body, 10);
                expect(results[0]?.url).toBe("https://news.ycombinator.com/item?id=42");
        });
        test("searxng: results with engine metadata", () => {
                const body = { results: [{ url: "https://x.com", title: "X", content: "c", engine: "google" }] };
                expect(parseSearxngResponse(body, 10)).toHaveLength(1);
        });
        test("serper: organic array", () => {
                const body = { organic: [{ position: 1, title: "T", link: "https://t.com", snippet: "s" }] };
                expect(parseSerperResponse(body, 10)).toHaveLength(1);
        });
        test("perplexity: results endpoint shape", () => {
                const body = { results: [{ title: "T", url: "https://t.com", snippet: "s", date: "2026-02-01" }] };
                const results = parsePerplexityResponse(body, 10);
                expect(results[0]?.published).toBe("2026-02-01");
        });
        test("zhipu: search_result with search_query-style response", () => {
                const body = { search_result: [{ title: "T", content: "c", link: "https://t.com", publish_date: "2026-01-01" }] };
                expect(parseZhipuResponse(body, 10)).toHaveLength(1);
        });
        test("kagi: data array with t/u/snippet keys", () => {
                const body = { data: [{ rank: 1, t: "T", u: "https://t.com", snippet: "s" }] };
                expect(parseKagiResponse(body, 10)).toHaveLength(1);
        });
        test("brave: web.results with description", () => {
                const body = { web: { results: [{ title: "T", url: "https://t.com", description: "d", age: "2 days" }] } };
                const results = parseBraveResponse(body, 10);
                expect(results[0]?.published).toBe("2 days");
        });
        test("exa: results with text content", () => {
                const body = { results: [{ title: "T", url: "https://t.com", text: "page text", publishedDate: "2026-01-01" }] };
                const results = parseExaResponse(body, 10);
                expect(results[0]?.content).toBe("page text");
        });
        test("jina: data array from s.jina.ai", () => {
                const body = { code: 200, data: [{ title: "T", url: "https://t.com", description: "d" }] };
                expect(parseJinaSearchResponse(body, 10)).toHaveLength(1);
        });
        test("serpapi: organic_results", () => {
                const body = { organic_results: [{ position: 1, title: "T", link: "https://t.com", snippet: "s" }] };
                expect(parseSerpApiResponse(body, 10)).toHaveLength(1);
        });
        test("firecrawl: data array with markdown", () => {
                const body = { data: [{ title: "T", url: "https://t.com", description: "d", markdown: "# page" }] };
                const results = parseFirecrawlSearchResponse(body, 10);
                expect(results[0]?.content).toBe("# page");
        });
        test("youcom: MCP inner JSON text payload", () => {
                const inner = JSON.stringify({
                        results: { web: [{ url: "https://t.com", title: "T", description: "d", page_age: "2026-01-01" }] },
                });
                const results = parseYoucomMcpText(inner, 10);
                expect(results[0]?.url).toBe("https://t.com");
                expect(results[0]?.published).toBe("2026-01-01");
        });
        test("npm: objects with package metadata and downloads", () => {
                const body = {
                        objects: [
                                {
                                        package: {
                                                name: "bun",
                                                version: "1.4.3",
                                                description: "Fast runtime",
                                                links: { npm: "https://www.npmjs.com/package/bun" },
                                        },
                                        downloads: { monthly: 16514194 },
                                        updated: "2026-10-18T14:15:24Z",
                                },
                        ],
                };
                const results = parseNpmResponse(body, 10);
                expect(results[0]?.title).toBe("bun@1.4.3");
                expect(results[0]?.snippet).toContain("downloads/mo");
                expect(results[0]?.published).toBe("2026-10-18T14:15:24Z");
        });
        test("npm: falls back to a constructed URL when links are absent", () => {
                const body = { objects: [{ package: { name: "x", description: "d" } }] };
                const results = parseNpmResponse(body, 10);
                expect(results[0]?.url).toBe("https://www.npmjs.com/package/x");
        });
        test("github: items with full_name/html_url/stars", () => {
                const body = {
                        items: [
                                {
                                        full_name: "oven-sh/bun",
                                        html_url: "https://github.com/oven-sh/bun",
                                        description: "Incredibly fast runtime",
                                        stargazers_count: 80000,
                                        language: "Zig",
                                        updated_at: "2026-10-18T00:00:00Z",
                                },
                        ],
                };
                const results = parseGithubResponse(body, 10);
                expect(results[0]?.title).toBe("oven-sh/bun");
                expect(results[0]?.snippet).toContain("80000 stars");
        });
        test("stackexchange: items with link/score/tags", () => {
                const body = {
                        items: [
                                {
                                        title: "T &amp; U",
                                        link: "https://s.com/q/1",
                                        score: 5,
                                        is_answered: true,
                                        answer_count: 2,
                                        tags: ["bun"],
                                        creation_date: 1767225600,
                                },
                        ],
                };
                const results = parseStackexchangeResponse(body, 10);
                expect(results[0]?.title).toBe("T & U");
                expect(results[0]?.snippet).toContain("answered");
        });
});

// ---------------------------------------------------------------------------
// Chain resolution
// ---------------------------------------------------------------------------

describe("resolveSearchChain", () => {
        const saved: Record<string, string | undefined> = {};
        const envKeys = [
                "UNOWN_WEB_SEARCH_PROVIDER",
                "TAVILY_API_KEY",
                "BRAVE_SEARCH_API_KEY",
                "SERPER_API_KEY",
                "EXA_API_KEY",
                "PERPLEXITY_API_KEY",
                "JINA_API_KEY",
                "ZHIPU_API_KEY",
                "DASHSCOPE_API_KEY",
                "KAGI_API_KEY",
                "SERPAPI_API_KEY",
                "FIRECRAWL_API_KEY",
                "UNOWN_SEARXNG_URL",
        ];
        beforeAll(() => {
                for (const key of envKeys) {
                        saved[key] = process.env[key];
                        delete process.env[key];
                }
        });
        afterAll(() => {
                for (const key of envKeys) {
                        if (saved[key] === undefined) delete process.env[key];
                        else process.env[key] = saved[key];
                }
        });
        test("no keys: keyless chain, configured searxng first when URL set", () => {
                process.env.UNOWN_SEARXNG_URL = "http://127.0.0.1:8888";
                const chain = resolveSearchChain();
                expect(chain[0]).toBe("searxng");
                expect(chain).toContain("duckduckgo");
                expect(chain).toContain("tavily");
                expect(chain).toContain("wikipedia");
                expect(chain).toContain("hn");
                delete process.env.UNOWN_SEARXNG_URL;
        });
        test("searxng drops out when UNOWN_SEARXNG_URL is unset", () => {
                delete process.env.UNOWN_SEARXNG_URL;
                const chain = resolveSearchChain();
                expect(chain[0]).toBe("duckduckgo");
                expect(chain).not.toContain("searxng");
        });
        test("keyed providers prepend by priority", () => {
                process.env.TAVILY_API_KEY = "k";
                process.env.SERPER_API_KEY = "k";
                const chain = resolveSearchChain();
                expect(chain.slice(0, 3)).toEqual(["tavily", "serper", "duckduckgo"]);
        });
        test("explicit override wins entirely", () => {
                process.env.TAVILY_API_KEY = "k";
                const chain = resolveSearchChain("wikipedia,hn");
                expect(chain).toEqual(["wikipedia", "hn"]);
        });
        test("UNOWN_WEB_SEARCH_PROVIDER env override", () => {
                process.env.UNOWN_WEB_SEARCH_PROVIDER = "searxng";
                expect(resolveSearchChain()).toEqual(["searxng"]);
                delete process.env.UNOWN_WEB_SEARCH_PROVIDER;
        });
        test("registry covers 5+ free and 5+ paid providers", () => {
                const providers = listSearchProviders();
                const free = providers.filter((p) => p.tier === "free");
                const paid = providers.filter((p) => p.tier === "paid");
                expect(free.length).toBeGreaterThanOrEqual(5);
                expect(paid.length).toBeGreaterThanOrEqual(5);
                expect(new Set(providers.map((p) => p.id)).size).toBe(providers.length);
        });
});

// ---------------------------------------------------------------------------
// Mock-server integration: runWebSearch + fetchPageContent against a local
// HTTP server that emulates provider endpoints.
// ---------------------------------------------------------------------------

describe("runWebSearch + fetchPageContent against a mock provider server", () => {
        let server: Server;
        let port = 0;
        const hits: Array<{ method: string; url: string; body?: string }> = [];

        beforeAll(async () => {
                // The mock lives on 127.0.0.1:<random port> — the documented private
                // fetch escape hatch lets the pipeline reach it (and doubles as the
                // self-hosted internal-docs use case).
                process.env.UNOWN_WEBFETCH_ALLOW_PRIVATE = "1";
                server = createServer((req, res) => {
                        const url = req.url ?? "";
                        let body = "";
                        req.on("data", (chunk) => (body += chunk));
                        req.on("end", () => {
                                hits.push({ method: req.method ?? "GET", url, body: body || undefined });
                                if (url.startsWith("/search?") && url.includes("format=json")) {
                                        // searxng shape
                                        res.writeHead(200, { "content-type": "application/json" });
                                        res.end(
                                                JSON.stringify({
                                                        results: [
                                                                {
                                                                        url: "https://bun.sh/docs",
                                                                        title: "Bun Docs",
                                                                        content: "Fast runtime docs",
                                                                        engine: "google",
                                                                },
                                                                {
                                                                        url: "https://example.com",
                                                                        title: "Example",
                                                                        content: "Example domain",
                                                                        engine: "duckduckgo",
                                                                },
                                                        ],
                                                }),
                                        );
                                } else if (url.startsWith("/robots.txt")) {
                                        res.writeHead(200, { "content-type": "text/plain" });
                                        res.end("User-agent: *\nDisallow: /private\n");
                                } else if (url.startsWith("/page")) {
                                        res.writeHead(200, { "content-type": "text/html" });
                                        res.end("<html><body><p>Hello docs</p><script>evil()</script></body></html>");
                                } else if (url.startsWith("/denied")) {
                                        res.writeHead(200, { "content-type": "text/html" });
                                        res.end("<html><body>secret</body></html>");
                                } else {
                                        res.writeHead(404);
                                        res.end("not found");
                                }
                        });
                });
                await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
                port = (server.address() as { port: number }).port;
        });
        afterAll(() => {
                server.close();
                delete process.env.UNOWN_WEBFETCH_ALLOW_PRIVATE;
        });

        test("searxng provider end-to-end through the chain", async () => {
                const base = `http://127.0.0.1:${port}`;
                process.env.UNOWN_SEARXNG_URL = base;
                const outcome = await runWebSearch("bun docs", { provider: "searxng", maxResults: 5 });
                expect(outcome.provider).toBe("searxng");
                expect(outcome.results[0]?.url).toBe("https://bun.sh/docs");
                expect(outcome.attempted[0]?.ok).toBe(true);
                delete process.env.UNOWN_SEARXNG_URL;
        });

        test("unknown provider id surfaces as an attempted failure", async () => {
                await expect(runWebSearch("x", { provider: "nonexistent" })).rejects.toThrow(/unknown provider id/);
        });

        test("fetchPageContent: direct path, HTML stripped", async () => {
                const base = `http://127.0.0.1:${port}`;
                // The mock server's robots.txt only disallows /private.
                const text = await fetchPageContent(`${base}/page`, { noCache: true });
                expect(text).toContain("GET ");
                expect(text).toContain("direct");
                expect(text).toContain("Hello docs");
                expect(text).not.toContain("evil");
        });

        test("fetchPageContent: robots disallow is enforced", async () => {
                const base = `http://127.0.0.1:${port}`;
                // /denied is allowed by robots in the mock (only /private blocked) —
                // use a path that the mock's robots.txt denies.
                await expect(fetchPageContent(`${base}/private/secret`, { noCache: true })).rejects.toThrow(
                        /robots.txt disallows/,
                );
        });

        test("formatter renders compact result list with provider attribution", () => {
                const text = formatSearchResults({
                        query: "q",
                        provider: "searxng",
                        results: [{ url: "https://x.com", title: "X", snippet: "s" }],
                        attempted: [{ provider: "searxng", ok: true, note: "1 results" }],
                });
                expect(text).toContain('Web search: "q"');
                expect(text).toContain("via searxng");
                expect(text).toContain("https://x.com");
        });
});

// ---------------------------------------------------------------------------
// DashScope provider: coding-plan-key honesty (fast refusal) + standard-key
// request shape, both against a local mock endpoint.
// ---------------------------------------------------------------------------

describe("dashscope provider — coding-plan keys refused, standard keys grounded", () => {
        let server: Server;
        let port = 0;
        const hits: Array<{ method: string; url: string; auth?: string; body?: string }> = [];
        const saved: Record<string, string | undefined> = {};
        const envKeys = ["DASHSCOPE_API_KEY", "UNOWN_DASHSCOPE_BASE_URL", "UNOWN_DASHSCOPE_MODEL", "UNOWN_SEARXNG_URL"];

        beforeAll(async () => {
                for (const key of envKeys) {
                        saved[key] = process.env[key];
                        delete process.env[key];
                }
                server = createServer((req, res) => {
                        const url = req.url ?? "";
                        let body = "";
                        req.on("data", (chunk) => (body += chunk));
                        req.on("end", () => {
                                hits.push({
                                        method: req.method ?? "GET",
                                        url,
                                        auth: req.headers.authorization,
                                        body: body || undefined,
                                });
                                if (url.startsWith("/chat/completions")) {
                                        res.writeHead(200, { "content-type": "application/json" });
                                        res.end(
                                                JSON.stringify({
                                                        choices: [
                                                                {
                                                                        message: {
                                                                                content:
                                                                                        "Bun is at 1.4.3. Sources:\nhttps://bun.sh\nhttps://github.com/oven-sh/bun/releases",
                                                                        },
                                                                },
                                                        ],
                                                }),
                                        );
                                } else if (url.startsWith("/search?") && url.includes("format=json")) {
                                        res.writeHead(200, { "content-type": "application/json" });
                                        res.end(
                                                JSON.stringify({
                                                        results: [{ url: "https://bun.sh", title: "Bun", content: "runtime", engine: "google" }],
                                                }),
                                        );
                                } else {
                                        res.writeHead(404);
                                        res.end("not found");
                                }
                        });
                });
                await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
                port = (server.address() as { port: number }).port;
        });
        afterAll(() => {
                server.close();
                for (const key of envKeys) {
                        if (saved[key] === undefined) delete process.env[key];
                        else process.env[key] = saved[key];
                }
        });

        test("coding-plan key (sk-sp-…): refused before any request, even with an explicit base override", async () => {
                hits.length = 0;
                process.env.DASHSCOPE_API_KEY = "sk-sp-testcodingkey";
                process.env.UNOWN_DASHSCOPE_BASE_URL = `http://127.0.0.1:${port}`;
                await expect(runWebSearch("bun runtime", { provider: "dashscope" })).rejects.toThrow(
                        /coding-plan keys \(sk-sp-…\) cannot power enable_search grounding/,
                );
                // The refusal must be up front: the mock endpoint saw nothing.
                expect(hits).toHaveLength(0);
        });

        test("coding-plan refusal cascades to the next provider with a transparent note", async () => {
                hits.length = 0;
                process.env.DASHSCOPE_API_KEY = "sk-sp-testcodingkey";
                process.env.UNOWN_DASHSCOPE_BASE_URL = `http://127.0.0.1:${port}`;
                process.env.UNOWN_SEARXNG_URL = `http://127.0.0.1:${port}`;
                const outcome = await runWebSearch("bun runtime", { provider: "dashscope,searxng", maxResults: 5 });
                expect(outcome.provider).toBe("searxng");
                expect(outcome.results[0]?.url).toBe("https://bun.sh");
                expect(outcome.attempted[0]?.ok).toBe(false);
                expect(outcome.attempted[0]?.note).toContain("coding-plan");
                expect(outcome.attempted[1]?.ok).toBe(true);
                // Only the searxng leg hit the wire — no dashscope request was made.
                expect(hits.filter((h) => h.url.startsWith("/chat/completions"))).toHaveLength(0);
        });

        test("standard key (sk-…): posts the documented enable_search shape and maps the grounded answer", async () => {
                hits.length = 0;
                process.env.DASHSCOPE_API_KEY = "sk-teststandardkey";
                process.env.UNOWN_DASHSCOPE_BASE_URL = `http://127.0.0.1:${port}`;
                const outcome = await runWebSearch("bun runtime", { provider: "dashscope", maxResults: 5 });
                expect(outcome.provider).toBe("dashscope");
                expect(outcome.results[0]?.title).toBe("Qwen grounded answer");
                expect(outcome.results[0]?.snippet).toContain("Bun is at 1.4.3");
                const urls = outcome.results.map((r) => r.url);
                expect(urls).toContain("https://bun.sh");
                expect(urls).toContain("https://github.com/oven-sh/bun/releases");
                expect(hits).toHaveLength(1);
                expect(hits[0]?.url).toBe("/chat/completions");
                expect(hits[0]?.auth).toBe("Bearer sk-teststandardkey");
                const body = JSON.parse(hits[0]?.body ?? "{}");
                expect(body.model).toBe("qwen-plus");
                expect(body.enable_search).toBe(true);
                expect(body.messages[0]?.role).toBe("user");
        });
});

// ---------------------------------------------------------------------------
// Fake-pi registration test
// ---------------------------------------------------------------------------

describe("registerWebTools / createWebToolsExtension", () => {
        test("registers web_search and webfetch with schemas", () => {
                const registered: Array<{ name: string; def: any }> = [];
                const fakePi: any = {
                        registerTool: (def: any) => registered.push({ name: def.name, def }),
                };
                const ext = createWebToolsExtension();
                ext.factory(fakePi);
                expect(registered.map((r) => r.name).sort()).toEqual(["web_search", "webfetch"]);
                const search = registered.find((r) => r.name === "web_search")!;
                expect(search.def.parameters).toBeDefined();
                expect(search.def.description).toContain("Search the web");
                const fetchDef = registered.find((r) => r.name === "webfetch")!;
                expect(fetchDef.def.parameters).toBeDefined();
                expect(fetchDef.def.description).toContain("SSRF");
        });
});

// ---------------------------------------------------------------------------
// Web results store — persistent cache integration (search + fetch + raw)
// ---------------------------------------------------------------------------

describe("web results store — persistent cache integration", () => {
        let server: Server;
        let port = 0;
        let tmpCache = "";
        let mutableVersion = 1;
        const hits: Array<{ method: string; url: string; ifNoneMatch?: string }> = [];
        const saved: Record<string, string | undefined> = {};
        const envKeys = [
                "UNOWN_WEB_CACHE",
                "UNOWN_WEB_CACHE_DIR",
                "UNOWN_WEBFETCH_ALLOW_PRIVATE",
                "UNOWN_SEARXNG_URL",
                "UNOWN_WEB_SEARCH_CACHE_TTL_MS",
                "UNOWN_WEBFETCH_CACHE_TTL_MS",
                "UNOWN_WEB_SEARCH_STALE_MS",
                "UNOWN_WEBFETCH_STALE_MS",
        ];
        /** Set env for the duration of one test body (all knobs are call-time reads). */
        const withEnv = async (overrides: Record<string, string>, fn: () => Promise<void>) => {
                const before: Record<string, string | undefined> = {};
                for (const [k, v] of Object.entries(overrides)) {
                        before[k] = process.env[k];
                        process.env[k] = v;
                }
                try {
                        await fn();
                } finally {
                        for (const [k, v] of Object.entries(before)) {
                                if (v === undefined) delete process.env[k];
                                else process.env[k] = v;
                        }
                }
        };

        beforeAll(async () => {
                for (const k of envKeys) saved[k] = process.env[k];
                const { mkdtempSync } = await import("node:fs");
                const { tmpdir } = await import("node:os");
                const { join } = await import("node:path");
                tmpCache = mkdtempSync(join(tmpdir(), "unown-websearch-int-"));
                process.env.UNOWN_WEB_CACHE = "1";
                process.env.UNOWN_WEB_CACHE_DIR = tmpCache;
                process.env.UNOWN_WEBFETCH_ALLOW_PRIVATE = "1";
                process.env.UNOWN_WEB_SEARCH_CACHE_TTL_MS = "3600000";
                process.env.UNOWN_WEBFETCH_CACHE_TTL_MS = "3600000";
                process.env.UNOWN_WEB_SEARCH_STALE_MS = "600000";
                process.env.UNOWN_WEBFETCH_STALE_MS = "600000";
                server = createServer((req, res) => {
                        const url = req.url ?? "";
                        let body = "";
                        req.on("data", (chunk) => (body += chunk));
                        req.on("end", () => {
                                hits.push({ method: req.method ?? "GET", url, ifNoneMatch: req.headers["if-none-match"] as string | undefined });
                                if (url.startsWith("/robots.txt")) {
                                        res.writeHead(200, { "content-type": "text/plain" });
                                        res.end("User-agent: *\nAllow: /\n");
                                } else if (url.startsWith("/search?")) {
                                        const q = decodeURIComponent(url.split("q=")[1]?.split("&")[0] ?? "");
                                        const respond = () => {
                                                res.writeHead(200, { "content-type": "application/json" });
                                                res.end(
                                                        JSON.stringify({
                                                                results: [{ url: `https://docs.example/${encodeURIComponent(q)}`, title: `Doc ${q}`, content: `content for ${q}`, engine: "google" }],
                                                        }),
                                                );
                                        };
                                        if (q.includes("slow")) setTimeout(respond, 80);
                                        else respond();
                                } else if (url.startsWith("/docs")) {
                                        // ETag + max-age=0: storable, never fresh, always revalidates.
                                        if (req.headers["if-none-match"] === '"docs-v1"') {
                                                res.writeHead(304, { etag: '"docs-v1"', "cache-control": "max-age=0" });
                                                res.end();
                                        } else {
                                                res.writeHead(200, { etag: '"docs-v1"', "cache-control": "max-age=0", "content-type": "text/html" });
                                                res.end("<html><body><p>Docs body v1</p></body></html>");
                                        }
                                } else if (url.startsWith("/mutable")) {
                                        const current = `"mutable-v${mutableVersion}"`;
                                        if (req.headers["if-none-match"] === current) {
                                                res.writeHead(304, { etag: current, "cache-control": "max-age=0" });
                                                res.end();
                                        } else {
                                                res.writeHead(200, { etag: current, "cache-control": "max-age=0", "content-type": "text/html" });
                                                res.end(`<html><body><p>mutable version ${mutableVersion}</p></body></html>`);
                                        }
                                } else if (url.startsWith("/nostore")) {
                                        res.writeHead(200, { "cache-control": "no-store", "content-type": "text/plain" });
                                        res.end("private dynamic content");
                                } else if (url.startsWith("/plain")) {
                                        res.writeHead(200, { "cache-control": "max-age=3600", "content-type": "text/plain" });
                                        res.end("plain stable content");
                                } else if (url.startsWith("/long")) {
                                        res.writeHead(200, { "cache-control": "max-age=3600", "content-type": "text/plain" });
                                        res.end("L".repeat(2000));
                                } else if (url.startsWith("/rawdoc")) {
                                        if (req.headers["if-none-match"] === '"raw-v1"') {
                                                res.writeHead(304, { etag: '"raw-v1"', "cache-control": "max-age=3600" });
                                                res.end();
                                        } else {
                                                res.writeHead(200, { etag: '"raw-v1"', "cache-control": "max-age=3600", "content-type": "text/plain" });
                                                res.end("raw payload v1");
                                        }
                                } else {
                                        res.writeHead(404);
                                        res.end("not found");
                                }
                        });
                });
                await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
                port = (server.address() as { port: number }).port;
        });
        afterAll(async () => {
                server.close();
                for (const k of envKeys) {
                        const v = saved[k];
                        if (v === undefined) delete process.env[k];
                        else process.env[k] = v;
                }
                const { rmSync } = await import("node:fs");
                rmSync(tmpCache, { recursive: true, force: true });
        });
        beforeEach(() => {
                hits.length = 0;
        });

        test("search: identical repeat answers from the store with zero upstream calls", async () => {
                const base = `http://127.0.0.1:${port}`;
                await withEnv({ UNOWN_SEARXNG_URL: base }, async () => {
                        const first = await runWebSearch("cache hit probe", { provider: "searxng", maxResults: 5 });
                        expect(first.provider).toBe("searxng");
                        expect(first.cache).toBeUndefined();
                        const searchHits = () => hits.filter((h) => h.url.startsWith("/search?"));
                        expect(searchHits()).toHaveLength(1);

                        const second = await runWebSearch("cache hit probe", { provider: "searxng", maxResults: 5 });
                        expect(second.cache?.provenance).toBe("hit");
                        expect(second.results[0]?.url).toBe(first.results[0]?.url);
                        // ZERO new upstream calls — the store answered.
                        expect(searchHits()).toHaveLength(1);
                        // The formatter surfaces provenance to the model + transcript.
                        expect(formatSearchResults(second)).toContain("· cached (");
                });
        });

        test("search: noCache always pays the upstream call", async () => {
                const base = `http://127.0.0.1:${port}`;
                await withEnv({ UNOWN_SEARXNG_URL: base }, async () => {
                        await runWebSearch("nocache probe", { provider: "searxng", maxResults: 5, noCache: true });
                        await runWebSearch("nocache probe", { provider: "searxng", maxResults: 5, noCache: true });
                        expect(hits.filter((h) => h.url.startsWith("/search?"))).toHaveLength(2);
                });
        });

        test("search: stale-if-error serves the last good answer, flagged; beyond the window it throws", async () => {
                const base = `http://127.0.0.1:${port}`;
                // Store an immediately-stale entry (TTL 0 — never fresh, stale-eligible).
                await withEnv({ UNOWN_SEARXNG_URL: base, UNOWN_WEB_SEARCH_CACHE_TTL_MS: "0" }, async () => {
                        const stored = await runWebSearch("stale probe", { provider: "searxng", maxResults: 5 });
                        expect(stored.cache).toBeUndefined();
                });
                // Provider dies: the store answers stale, clearly flagged.
                await withEnv({ UNOWN_SEARXNG_URL: "http://127.0.0.1:9" }, async () => {
                        const stale = await runWebSearch("stale probe", { provider: "searxng", maxResults: 5 });
                        expect(stale.cache?.provenance).toBe("stale");
                        expect(formatSearchResults(stale)).toContain("STALE — served after provider error");
                        expect(stale.results[0]?.url).toContain("docs.example");
                });
                // A zero stale window is baked into the entry at store time —
                // such an entry has nothing to fall back on when upstream fails.
                await withEnv(
                        { UNOWN_SEARXNG_URL: base, UNOWN_WEB_SEARCH_CACHE_TTL_MS: "0", UNOWN_WEB_SEARCH_STALE_MS: "0" },
                        async () => {
                                await runWebSearch("stale probe nowindow", { provider: "searxng", maxResults: 5 });
                        },
                );
                await withEnv({ UNOWN_SEARXNG_URL: "http://127.0.0.1:9" }, async () => {
                        await expect(runWebSearch("stale probe nowindow", { provider: "searxng", maxResults: 5 })).rejects.toThrow(
                                /all web-search providers failed/,
                        );
                });
        });

        test("search: parallel identical calls coalesce into one upstream call", async () => {
                const base = `http://127.0.0.1:${port}`;
                await withEnv({ UNOWN_SEARXNG_URL: base }, async () => {
                        const q = "slow coalesce probe";
                        const [a, b] = await Promise.all([
                                runWebSearch(q, { provider: "searxng", maxResults: 5 }),
                                runWebSearch(q, { provider: "searxng", maxResults: 5 }),
                        ]);
                        expect(a.results[0]?.url).toBe(b.results[0]?.url);
                        expect(hits.filter((h) => h.url.startsWith("/search?"))).toHaveLength(1);
                });
        });

        test("fetch: fresh hit serves any max_chars with zero upstream calls", async () => {
                const base = `http://127.0.0.1:${port}`;
                const first = await fetchPageContent(`${base}/long`);
                expect(first).toContain("LLLL");
                expect(hits.filter((h) => h.url.startsWith("/long"))).toHaveLength(1);
                // Same URL, tighter cap: served from the store, sliced to the cap
                // (fetchMaxChars clamps requests to >= 500 chars).
                const second = await fetchPageContent(`${base}/long`, { maxChars: 500 });
                expect(hits.filter((h) => h.url.startsWith("/long"))).toHaveLength(1);
                expect(second).toContain("· cached (");
                expect(second).toContain("truncated at 500 chars");
        });

        test("fetch: stale entry with ETag revalidates via 304 — 'no version change'", async () => {
                const base = `http://127.0.0.1:${port}`;
                const first = await fetchPageContent(`${base}/docs`);
                expect(first).toContain("Docs body v1");
                expect(first).not.toContain("cached");
                // max-age=0 → the entry is never fresh; the next call must revalidate.
                const second = await fetchPageContent(`${base}/docs`);
                const docsHits = hits.filter((h) => h.url.startsWith("/docs"));
                expect(docsHits).toHaveLength(2);
                // The second request was conditional and the origin answered 304.
                expect(docsHits[1]?.ifNoneMatch).toBe('"docs-v1"');
                expect(second).toContain("Docs body v1");
                expect(second).toContain("revalidated (unchanged");
        });

        test("fetch: changed origin (200 on revalidation) replaces the stored body", async () => {
                const base = `http://127.0.0.1:${port}`;
                const first = await fetchPageContent(`${base}/mutable`);
                expect(first).toContain("mutable version 1");
                mutableVersion = 2; // the origin "changed" — next revalidation gets a 200
                const second = await fetchPageContent(`${base}/mutable`);
                const mutableHits = hits.filter((h) => h.url.startsWith("/mutable"));
                expect(mutableHits).toHaveLength(2);
                expect(mutableHits[1]?.ifNoneMatch).toBe('"mutable-v1"');
                expect(second).toContain("mutable version 2");
                expect(second).not.toContain("cached");
                // The replacement is stored: a third call revalidates against v2.
                const third = await fetchPageContent(`${base}/mutable`);
                expect(hits.filter((h) => h.url.startsWith("/mutable"))[2]?.ifNoneMatch).toBe('"mutable-v2"');
                expect(third).toContain("revalidated (unchanged");
        });

        test("fetch: no-store origin is never cached", async () => {
                const base = `http://127.0.0.1:${port}`;
                const first = await fetchPageContent(`${base}/nostore`);
                const second = await fetchPageContent(`${base}/nostore`);
                expect(first).toContain("private dynamic content");
                expect(second).toContain("private dynamic content");
                expect(second).not.toContain("cached");
                expect(hits.filter((h) => h.url.startsWith("/nostore"))).toHaveLength(2);
        });

        test("fetch: stale-if-error serves the last good body; beyond the window it throws", async () => {
                const base = `http://127.0.0.1:${port}`;
                await fetchPageContent(`${base}/docs`); // stored (never fresh: max-age=0)
                // Simulate total upstream failure with an already-aborted signal: no
                // attempt (and no fallback network) happens, the store answers stale.
                const aborted = new AbortController();
                aborted.abort();
                const stale = await fetchPageContent(`${base}/docs`, { signal: aborted.signal });
                expect(stale).toContain("Docs body v1");
                expect(stale).toContain("STALE — served after provider error");
                // Age the stored entry beyond every window (time travel via the
                // public store API — what a week of uptime does in production):
                // not fresh (max-age=0), no stale fallback left.
                const { fetchCacheKey, normalizeFetchUrl, webCacheGet, webCachePut } = await import("../src/webcache.ts");
                const docsKey = fetchCacheKey(normalizeFetchUrl(`${base}/docs`), false).key;
                const entry = webCacheGet(docsKey);
                expect(entry).not.toBeNull();
                webCachePut({ ...entry!, storedAt: Date.now() - 30 * 24 * 60 * 60_000 });
                await expect(fetchPageContent(`${base}/docs`, { signal: aborted.signal })).rejects.toThrow(/aborted/);
        });

        test("webfetch raw mode: cached with provenance + conditional revalidation", async () => {
                const base = `http://127.0.0.1:${port}`;
                const registered: Array<{ name: string; def: any }> = [];
                const fakePi: any = {
                        registerTool: (def: any) => registered.push({ name: def.name, def }),
                };
                createWebToolsExtension().factory(fakePi);
                const webfetch = registered.find((r) => r.name === "webfetch")!.def;
                const call = (params: any) => webfetch.execute("t1", params);

                const first = await call({ url: `${base}/rawdoc`, raw: true });
                expect(first.content[0].text).toContain("raw payload v1");
                expect(first.isError).toBeFalsy();
                // Fresh hit (max-age=3600): zero new upstream calls, provenance marked.
                const second = await call({ url: `${base}/rawdoc`, raw: true });
                expect(hits.filter((h) => h.url.startsWith("/rawdoc"))).toHaveLength(1);
                expect(second.content[0].text).toContain("raw payload v1");
                expect(second.content[0].text).toContain("· cached (");
        });

        test("stats reflect the integration traffic", async () => {
                const { webCacheStats } = await import("../src/webcache.ts");
                const stats = webCacheStats();
                expect(stats.enabled).toBe(true);
                expect(stats.entries).toBeGreaterThan(0);
                expect(stats.totals.hit).toBeGreaterThan(0);
                expect(stats.totals.miss).toBeGreaterThan(0);
                expect(stats.totals.revalidated).toBeGreaterThan(0);
                expect(stats.totals.stale).toBeGreaterThan(0);
                expect(stats.byProvider["searxng"]).toBeGreaterThan(0);
                expect(stats.byProvider["direct"]).toBeGreaterThan(0);
        });
});
