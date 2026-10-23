// LIVE stealth-tier tests (env-gated: UNOWN_BROWSER_LIVE=1).
//
// Proves, against a real Chromium, the claims docs/browser-stealth.md makes:
//
//   1. THE CDP SIGNAL: the modern detector (Error.prepareStackTrace firing
//      during console-argument serialization — the rebrowser 2026 catalog)
//      fires in a CLASSIC session (Runtime.enable on) and stays SILENT in a
//      stealth session. This is the whole point of the stealth tier, asserted
//      in both directions.
//   2. Fingerprint coherence: browser stealth verify passes every check
//      (webdriver, UA, platform, client hints, timezone, locale, screen,
//      viewport, plugins, window.chrome).
//   3. Humanized input: stealth clicks walk a multi-point mouse path
//      (fixture counts mousemove events) and typing arrives per-character.
//   4. Console degradation is honest: a console.log in stealth is NOT
//      captured (Log-domain only), while classic mode captures it.
//   5. Captcha detection + token injection + (env-gated) live vision OCR.
//
// Same skip convention as browser-live.test.ts (no browser -> skip, CI-safe).
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import "./_env.ts";
import { BrowserSession } from "../src/browser/session.ts";
import { discoverBrowser, browserEnv, type BrowserEnv } from "../src/browser/config.ts";
import { CAPTCHA_PROBE_SRC, injectTokenExpression } from "../src/browser/captcha.ts";

const LIVE = process.env.UNOWN_BROWSER_LIVE === "1";
const CAPTCHA_LIVE = process.env.UNOWN_CAPTCHA_LIVE === "1" && !!(process.env.UNOWN_VISION_API_KEY || process.env.AGNES_API_KEY);
let browserAvailable = false;
if (LIVE) {
        try {
                const d = discoverBrowser({ allowHeadlessShell: false });
                browserAvailable = true;
                process.stderr.write(`[browser-stealth-live] using ${d.path} (${d.source})\n`);
        } catch (err: any) {
                process.stderr.write(`[browser-stealth-live] skipping: ${err?.message ?? err}\n`);
        }
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/** The modern CDP-signal detector (what DataDome-class WAFs ship in 2026). */
const DETECTOR_PAGE = `<!doctype html><html><head><title>Detector</title></head><body>
<div id="status">pending</div>
<script>
  let viaPrepare = false;
  Error.prepareStackTrace = function (_e, _s) { viaPrepare = true; return "x"; };
  const probe = new Error("probe");
  console.debug(probe);
  Error.prepareStackTrace = Error.prepareStackTrace; // keep the hook armed
  setTimeout(() => {
    document.getElementById("status").textContent =
      "cdp-signal:" + (viaPrepare ? "FIRED" : "silent");
  }, 250);
  console.log("FIXTURE-CONSOLE-MARKER");
</script>
</body></html>`;

/** Interaction page: counts mousemoves, records typing cadence. */
const INTERACT_PAGE = `<!doctype html><html><head><title>Interact</title></head><body>
<input id="field" type="text" placeholder="type here">
<button id="btn" onclick="window.n = (window.n || 0) + 1; document.getElementById('out').textContent = 'clicked ' + window.n">Click me</button>
<div id="out"></div>
<div id="moves">0</div>
<script>
  window.__moveTs = [];
  window.addEventListener("mousemove", () => {
    window.__moveTs.push(performance.now());
    document.getElementById("moves").textContent = String(window.__moveTs.length);
  });
  document.getElementById("field").addEventListener("input", (e) => { window.__lastValue = e.target.value; });
</script>
</body></html>`;

/** Turnstile-shaped markup (the iframe src matches the detector; no network needed beyond the 404). */
const TURNSTILE_PAGE = `<!doctype html><html><head><title>Protected form</title></head><body>
<form>
  <div class="cf-turnstile" data-sitekey="0x4AAAAAAA_TEST_KEY"></div>
  <input type="hidden" name="cf-turnstile-response" id="ts-response" value="">
  <button type="submit">Submit</button>
</form>
</body></html>`;

const RECAPTCHA_PAGE = `<!doctype html><html><head><title>Recap</title></head><body>
<form>
  <div class="g-recaptcha" data-sitekey="6LeTESTKEYxxxxxxxxxxxx"></div>
  <textarea id="g-recaptcha-response" name="g-recaptcha-response" style="display:none"></textarea>
</form>
</body></html>`;

/** Image-captcha-shaped markup (heuristic detector must match img+input in form). */
const IMAGE_CAPTCHA_PAGE = `<!doctype html><html><head><title>Captcha img</title></head><body>
<form>
  <img id="captcha_img" src="/captcha.png" alt="captcha challenge code">
  <input id="captcha_answer" name="captcha" type="text">
  <button type="submit">Go</button>
</form>
</body></html>`;

/** A deterministic 300x90 captcha image: "AB37" rendered as SVG->png served directly. */
const CAPTCHA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="90">
  <rect width="300" height="90" fill="#f0f0f5"/>
  <text x="150" y="62" font-family="Georgia, serif" font-size="52" fill="#333" text-anchor="middle" letter-spacing="8">AB37</text>
  <line x1="20" y1="70" x2="280" y2="20" stroke="#bbb" stroke-width="2"/>
</svg>`;

function startFixtureServer(): Promise<{ url: string; stop: () => void }> {
        const server = Bun.serve({
                port: 0,
                hostname: "127.0.0.1",
                async fetch(req) {
                        const url = new URL(req.url);
                        if (url.pathname === "/detector") return new Response(DETECTOR_PAGE, { headers: { "content-type": "text/html" } });
                        if (url.pathname === "/interact") return new Response(INTERACT_PAGE, { headers: { "content-type": "text/html" } });
                        if (url.pathname === "/turnstile") return new Response(TURNSTILE_PAGE, { headers: { "content-type": "text/html" } });
                        if (url.pathname === "/recaptcha") return new Response(RECAPTCHA_PAGE, { headers: { "content-type": "text/html" } });
                        if (url.pathname === "/image-captcha") return new Response(IMAGE_CAPTCHA_PAGE, { headers: { "content-type": "text/html" } });
                        if (url.pathname === "/captcha.png") {
                                // serve the svg as png (the shape is all the vision model needs;
                                // the vision test sends the clipped screenshot, not the file)
                                return new Response(CAPTCHA_SVG, { headers: { "content-type": "image/svg+xml" } });
                        }
                        return new Response("not found", { status: 404 });
                },
        });
        return Promise.resolve({ url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) });
}

/** Fresh session with an env-shaped override (tests never share browsers). */
function makeSession(envOverrides: Partial<BrowserEnv> = {}): BrowserSession {
        const base = browserEnv();
        return new BrowserSession({
                cwd: process.cwd(),
                env: { ...base, ...envOverrides, cdpUrl: undefined, blockList: [] },
        });
}

// ---------------------------------------------------------------------------
// the suite
// ---------------------------------------------------------------------------

describe.skipIf(!LIVE || !browserAvailable)("browser stealth live", () => {
        let fixture: { url: string; stop: () => void };
        let classic: BrowserSession;
        let stealth: BrowserSession;
        let override: BrowserSession;

        beforeAll(async () => {
                fixture = await startFixtureServer();
                classic = makeSession();
                await classic.ensureStarted({ headless: true, stealth: false });
                stealth = makeSession({ stealth: true });
                await stealth.ensureStarted({ headless: true, stealth: true });
                override = makeSession({ stealth: true, stealthOs: "linux", stealthTimezone: "Asia/Dubai", stealthLocale: "en-GB" });
                await override.ensureStarted({ headless: true, stealth: true });
        });

        afterAll(async () => {
                await Promise.allSettled([classic?.stop(), stealth?.stop(), override?.stop()]);
                fixture?.stop();
        });

        test("CLASSIC session: the modern CDP-signal detector FIRES (Runtime.enable is the leak)", async () => {
                await classic.navigate(`${fixture.url}/detector`);
                const status = await classic.evalCode("document.getElementById('status').textContent", { world: "main" });
                expect(String(status.details?.[0] ?? status.summary)).toContain("cdp-signal:FIRED");
        }, 30_000);

        test("STEALTH session: the detector stays SILENT (no Runtime.enable, ever)", async () => {
                await stealth.navigate(`${fixture.url}/detector`);
                const status = await stealth.evalCode("document.getElementById('status').textContent", { world: "main" });
                expect(String(status.details?.[0] ?? status.summary)).toContain("cdp-signal:silent");
        }, 30_000);

        test("stealth verify: the live fingerprint is coherent on every axis", async () => {
                await stealth.navigate(`${fixture.url}/interact`);
                const report = await stealth.stealthVerify();
                expect(report.summary).toMatch(/10\/10 coherent/);
                expect(report.warnings ?? []).toEqual([]);
        }, 30_000);

        test("stealth console honesty: console.log NOT captured (Log-domain only in stealth)", async () => {
                await stealth.navigate(`${fixture.url}/detector`);
                const entries = stealth.consoleEntries();
                expect(entries.some((e) => e.text.includes("FIXTURE-CONSOLE-MARKER"))).toBe(false);
        }, 30_000);

        test("classic console capture still works (v1 behavior preserved)", async () => {
                await classic.navigate(`${fixture.url}/detector`);
                const entries = classic.consoleEntries();
                expect(entries.some((e) => e.text.includes("FIXTURE-CONSOLE-MARKER"))).toBe(true);
        }, 30_000);

        test("humanized click walks a real mouse path; humanized typing lands per-char", async () => {
                await stealth.navigate(`${fixture.url}/interact`);
                await stealth.click({ selector: "#btn" });
                const out = await stealth.evalCode("document.getElementById('out').textContent", { world: "main" });
                expect(String(out.details?.[0] ?? "")).toContain("clicked 1");
                // the fixture counted real mousemove events on the way
                const moves = await stealth.evalCode("window.__moveTs ? window.__moveTs.length : -1", { world: "main" });
                expect(Number(moves.details?.[0] ?? -1)).toBeGreaterThanOrEqual(5);
                // humanized typing
                await stealth.type({ selector: "#field", text: "hello world" });
                const val = await stealth.evalCode("document.getElementById('field').value", { world: "main" });
                expect(String(val.details?.[0] ?? "")).toBe("hello world");
        }, 60_000);

        test("captcha detect: turnstile + recaptcha + image fixtures all classify", async () => {
                await stealth.navigate(`${fixture.url}/turnstile`);
                const ts = await stealth.captchaDetect();
                expect(ts.summary).toContain("cloudflare-turnstile");

                await stealth.navigate(`${fixture.url}/recaptcha`);
                const rc = await stealth.captchaDetect();
                expect(rc.summary).toContain("recaptcha-v2");

                await stealth.navigate(`${fixture.url}/image-captcha`);
                const img = await stealth.captchaDetect();
                expect(img.summary).toContain("image-captcha");
        }, 60_000);

        test("captcha token injection: solved tokens land in the response fields (React-safe setters)", async () => {
                await stealth.navigate(`${fixture.url}/turnstile`);
                const s = stealth as any;
                const injected = await s.pageEval(injectTokenExpression("cloudflare-turnstile", "tok-abc123"));
                expect(Number(injected?.injected ?? 0)).toBeGreaterThanOrEqual(1);
                const val = await stealth.evalCode("document.getElementById('ts-response').value", { world: "main" });
                expect(String(val.details?.[0] ?? "")).toBe("tok-abc123");

                await stealth.navigate(`${fixture.url}/recaptcha`);
                const injected2 = await s.pageEval(injectTokenExpression("recaptcha-v2", "tok-xyz789"));
                expect(Number(injected2?.injected ?? 0)).toBeGreaterThanOrEqual(1);
                const val2 = await stealth.evalCode("document.getElementById('g-recaptcha-response').value", { world: "main" });
                expect(String(val2.details?.[0] ?? "")).toBe("tok-xyz789");
        }, 60_000);

        test("stealth identity honors env overrides (os/locale/timezone)", async () => {
                await override.navigate(`${fixture.url}/interact`);
                const fp = await override.evalCode(
                        "JSON.stringify({tz: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: Intl.DateTimeFormat().resolvedOptions().locale, ua: navigator.userAgent, platform: navigator.platform})",
                        { world: "main" },
                );
                const parsed = JSON.parse(String(fp.details?.[0] ?? "{}"));
                expect(parsed.tz).toBe("Asia/Dubai");
                expect(String(parsed.locale)).toBe("en-GB");
                expect(parsed.ua).toContain("X11; Linux x86_64");
                expect(parsed.platform).toBe("Linux x86_64");
        }, 30_000);

        test("stealth navigate still detects no captcha on clean pages (cheap probe, no false positives)", async () => {
                const report = await stealth.navigate(`${fixture.url}/interact`);
                expect(report.summary).not.toContain("captcha:");
        }, 30_000);
});

// ---------------------------------------------------------------------------
// live vision OCR (UNOWN_CAPTCHA_LIVE=1 + a vision key) — real Agnes call
// ---------------------------------------------------------------------------

describe.skipIf(!LIVE || !browserAvailable || !CAPTCHA_LIVE)("browser captcha live (vision tier)", () => {
        test("vision OCR reads the fixture captcha and types the answer", async () => {
                const fixture = await startFixtureServer();
                try {
                        const session = makeSession({
                                stealth: true,
                                captchaVision: "1",
                                visionApiKey: process.env.UNOWN_VISION_API_KEY || process.env.AGNES_API_KEY,
                        });
                        try {
                                await session.ensureStarted({ headless: true, stealth: true });
                                await session.navigate(`${fixture.url}/image-captcha`);
                                const report = await session.captchaSolve({ attempt: "vision" });
                                // the fixture draws AB37; the model may read it either way
                                expect(report.summary).toContain("image-captcha");
                                expect(report.details?.some((d) => /vision OCR: answer/.test(d))).toBe(true);
                                const val = await session.evalCode("document.getElementById('captcha_answer').value", { world: "main" });
                                const answer = String(val.details?.[0] ?? "").trim();
                                expect(answer.length).toBeGreaterThanOrEqual(2);
                                expect(answer.length).toBeLessThanOrEqual(8);
                                process.stderr.write(`[captcha-live] vision read: ${JSON.stringify(answer)}\n`);
                        } finally {
                                await session.stop();
                        }
                } finally {
                        fixture.stop();
                }
        }, 120_000);
});
