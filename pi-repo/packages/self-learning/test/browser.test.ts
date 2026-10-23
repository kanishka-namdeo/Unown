// Unit tests for the browser automation module — pure parts only (no browser
// needed): discovery, URL gating, snapshot formatting, key parsing.
//
// The live browser loop (launch → navigate → snapshot → act) is
// test/browser-live.test.ts, gated on UNOWN_BROWSER_LIVE=1 + a discoverable
// Chromium, per the repo's live-suite convention.
import { describe, expect, test } from "bun:test";
import "./_env.ts";
import { join } from "node:path";
import {
        browserCandidates,
        defaultProfileDir,
        discoverBrowser,
        hostMatchesGlob,
        normalizeUrl,
        urlAllowed,
} from "../src/browser/config.ts";
import { formatSnapshot, snapshotRefs, SNAPSHOT_SCRIPT } from "../src/browser/a11y.ts";
import { modifierBits, parseKeyCombo } from "../src/browser/cdp.ts";

// ---------------------------------------------------------------------------
// discovery
// ---------------------------------------------------------------------------

describe("browser discovery", () => {
        test("env path wins when it exists", () => {
                const found = discoverBrowser({
                        platform: "linux",
                        home: "/home/u",
                        envPath: "/opt/chrome",
                        exists: (p) => p === "/opt/chrome",
                        readdir: () => null,
                });
                expect(found.path).toBe("/opt/chrome");
                expect(found.source).toBe("env");
        });

        test("env path that does not exist is a hard error", () => {
                expect(() =>
                        discoverBrowser({ platform: "linux", home: "/home/u", envPath: "/nope", exists: () => false, readdir: () => null }),
                ).toThrow(/UNOWN_BROWSER_PATH/);
        });

        test("linux: system chromium beats playwright cache (candidate order)", () => {
                const candidates = browserCandidates("linux", { home: "/home/u" });
                const chromiumIdx = candidates.indexOf("/usr/bin/chromium");
                const cacheIdx = candidates.findIndex((c) => c.includes("ms-playwright"));
                expect(chromiumIdx).toBeGreaterThan(-1);
                expect(cacheIdx).toBeGreaterThan(chromiumIdx);
        });

        test("windows candidates include Program Files chrome and ms-playwright cache", () => {
                const candidates = browserCandidates("win32", { home: "C:\\Users\\u", localAppData: "C:\\Users\\u\\AppData\\Local" });
                expect(candidates.some((c) => c.startsWith("C:\\Program Files\\Google\\Chrome"))).toBe(true);
                expect(candidates.some((c) => c.includes("ms-playwright") && c.includes("chromium-<WILDCARD>"))).toBe(true);
        });

        test("macOS candidates include the .app bundle paths", () => {
                const candidates = browserCandidates("darwin", { home: "/Users/u" });
                expect(candidates.some((c) => c.includes("Google Chrome.app"))).toBe(true);
                expect(candidates.some((c) => c.includes("ms-playwright"))).toBe(true);
        });

        test("playwright cache wildcard expands newest-first", () => {
                const found = discoverBrowser({
                        platform: "linux",
                        home: "/home/u",
                        exists: (p) => p.includes("chromium-1200"),
                        readdir: (dir) => (dir === "/home/u/.cache/ms-playwright" ? ["chromium-1190", "chromium-1200", "ffmpeg-1011"] : null),
                });
                expect(found.source).toBe("playwright-cache");
                expect(found.path).toContain("chromium-1200");
        });

        test("no browser anywhere → actionable error naming both install paths", () => {
                try {
                        discoverBrowser({ platform: "linux", home: "/home/u", exists: () => false, readdir: () => null });
                        expect.unreachable();
                } catch (err: any) {
                        expect(String(err?.message)).toMatch(/playwright install chromium|package manager/);
                        expect(String(err?.message)).toMatch(/UNOWN_BROWSER_PATH/);
                }
        });

        test("default profile lives under the unown home", () => {
                // join() on the HOST separator: the expectation must hold on
                // windows too (where join("/tmp/x", "browser") yields
                // "\tmp\x\browser" — caught by the 3-OS release runner)
                expect(defaultProfileDir("/tmp/unown-home")).toBe(join("/tmp/unown-home", "browser", "profile"));
        });
});

// ---------------------------------------------------------------------------
// URL gating + normalization
// ---------------------------------------------------------------------------

describe("url gating", () => {
        test("hostMatchesGlob: exact, suffix, per-label", () => {
                expect(hostMatchesGlob("example.com", "example.com")).toBe(true);
                expect(hostMatchesGlob("www.example.com", "*.example.com")).toBe(true);
                expect(hostMatchesGlob("example.com", "*.example.com")).toBe(true);
                expect(hostMatchesGlob("a.b.example.com", "**.example.com")).toBe(true);
                expect(hostMatchesGlob("example.org", "*.example.com")).toBe(false);
                expect(hostMatchesGlob("evil-example.com", "*.example.com")).toBe(false);
                expect(hostMatchesGlob("img.foo.com", "img.*.com")).toBe(true);
                expect(hostMatchesGlob("img.a.b.com", "img.*.com")).toBe(false); // * is one label
        });

        test("urlAllowed blocks matching hosts and passes everything else", () => {
                const blocks = ["*.bank.example"];
                expect(urlAllowed("https://www.bank.example/pay", blocks)).toEqual({ ok: false, blockedBy: "*.bank.example" });
                expect(urlAllowed("https://github.com/kanishka-namdeo/Unown", blocks).ok).toBe(true);
                expect(urlAllowed("not a url at all", blocks).ok).toBe(true); // fails later with a real navigation error
        });

        test("normalizeUrl: schemes preserved, bare hosts get https", () => {
                expect(normalizeUrl("example.com")).toBe("https://example.com");
                expect(normalizeUrl("localhost:3000/dashboard")).toBe("https://localhost:3000/dashboard");
                expect(normalizeUrl("http://localhost:3000")).toBe("http://localhost:3000");
                expect(normalizeUrl("file:///tmp/page.html")).toBe("file:///tmp/page.html");
                expect(normalizeUrl("  example.com  ")).toBe("https://example.com");
                expect(normalizeUrl("//example.com/x")).toBe("https://example.com/x");
        });
});

// ---------------------------------------------------------------------------
// snapshot formatting + refs
// ---------------------------------------------------------------------------

describe("snapshot formatting", () => {
        const snap = {
                url: "https://example.com/",
                title: "Example",
                count: 5,
                truncated: false,
                nodes: [
                        {
                                role: "heading",
                                name: "Example Domain",
                                level: 1,
                                children: [
                                        { role: "paragraph", name: "This domain is for use in examples." },
                                ],
                        },
                        { role: "link", name: "More information...", ref: "e1", url: "https://iana.org/domains/example" },
                        {
                                role: "textbox",
                                name: "Email",
                                ref: "e2",
                                value: "a@b.c",
                                state: { required: true },
                                box: [10, 20, 200, 30],
                        },
                        { role: "iframe", name: "ad", note: "cross-origin" },
                ],
        } as any;

        test("renders a YAML-ish tree with refs and states", () => {
                const text = formatSnapshot(snap);
                expect(text).toContain("# Example — https://example.com/");
                expect(text).toContain('- heading "Example Domain" level=1');
                expect(text).toContain('- link "More information..." url="https://iana.org/domains/example" [e1]');
                expect(text).toContain('- textbox "Email" value="a@b.c" required=true [e2]');
                expect(text).toContain("(cross-origin)");
                // indentation nests (heading depth 0, its paragraph depth 1)
                const headingIdx = text.indexOf("- heading");
                const paraIdx = text.indexOf("- paragraph");
                expect(paraIdx).toBeGreaterThan(headingIdx);
                expect(text.slice(paraIdx - 3, paraIdx)).toBe("\n  "); // depth-1 indent
        });

        test("truncation note appended when the walker hit the cap", () => {
                const text = formatSnapshot({ ...snap, truncated: true });
                expect(text).toMatch(/snapshot truncated/);
        });

        test("snapshotRefs collects refs with data-attribute selectors and boxes", () => {
                const refs = snapshotRefs(snap, true);
                expect(refs.get("e1")?.selector).toBe('[data-unown-ref="e1"]');
                expect(refs.get("e2")?.box).toEqual([10, 20, 200, 30]);
                expect(refs.size).toBe(2);
        });

        test("the walker source is self-contained parseable JS", () => {
                expect(typeof SNAPSHOT_SCRIPT).toBe("string");
                // starts with the parenthesized function
                expect(SNAPSHOT_SCRIPT.startsWith("(function")).toBe(true);
                // must parse as plain JS (bun already stripped the TS types when
                // stringifying — this guards against TS-only syntax sneaking in, which
                // would SyntaxError inside Runtime.evaluate)
                expect(() => new Function(SNAPSHOT_SCRIPT)).not.toThrow();
                // no closure capture of module identifiers
                expect(SNAPSHOT_SCRIPT).not.toContain("__");
        });
});

// ---------------------------------------------------------------------------
// key parsing
// ---------------------------------------------------------------------------

describe("parseKeyCombo", () => {
        test("plain Enter maps to the Enter key", () => {
                const { parts } = parseKeyCombo("Enter");
                expect(parts).toHaveLength(1);
                expect(parts[0].key).toBe("Enter");
                expect(parts[0].vk).toBe(13);
                // the char event is load-bearing: a keyDown without text does
                // not run the default action, so Enter would not submit a
                // form (the news.ycombinator.com regression)
                expect(parts[0].text).toBe("\r");
        });

        test("Space carries its char event (button activation needs it)", () => {
                const { parts } = parseKeyCombo("Space");
                expect(parts[0].key).toBe(" ");
                expect(parts[0].text).toBe(" ");
        });

        test("Control+a yields modifier + printable with text", () => {
                const { parts } = parseKeyCombo("Control+a");
                expect(parts.map((p) => p.key)).toEqual(["Control", "a"]);
                expect(parts[1].text).toBe("a");
        });

        test("mac spellings (cmd+shift+p) normalize to Meta/Shift/p", () => {
                const { parts } = parseKeyCombo("cmd+shift+p");
                expect(parts.map((p) => p.key)).toEqual(["Meta", "Shift", "p"]);
        });

        test("modifierBits maps all four families", () => {
                expect(modifierBits(["Alt"])).toBe(1);
                expect(modifierBits(["Control"])).toBe(2);
                expect(modifierBits(["Meta"])).toBe(4);
                expect(modifierBits(["Shift"])).toBe(8);
                expect(modifierBits(["ctrl", "shift"])).toBe(10);
                expect(modifierBits(undefined)).toBe(0);
        });
});
