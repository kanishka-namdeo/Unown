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
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
        parseJinaSearchResponse,
        parseKagiResponse,
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
