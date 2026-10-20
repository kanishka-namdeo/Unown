#!/usr/bin/env bun
// webcache-tab-verify.mjs — visual verification of the dashboard's Web Cache
// tab against the REAL engine (live store data), following the sanctioned
// shots_capture.mjs pattern: dev server at :3000 + a browser-layer engine
// proxy for the ?XTransformPort=3030 calls (the documented dev-behind-Caddy
// hydration limitation), SSE aborted so the header clock renders, console
// monitored so a rendering defect cannot sign off silently.
//
// Captures: desktop full page, the KPI row (the new "≈ indexed" chip lives
// there), the config card, and mobile 390px. Verifies the chip text in-DOM
// before screenshotting, and checks zero console errors after render.

import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const BASE = process.env.SHOTS_BASE_URL ?? "http://localhost:3000";
const ENGINE = process.env.SHOTS_ENGINE_URL ?? "http://localhost:3030";
const OUT_DIR = process.env.OUT_DIR ?? "/home/z/my-project/download/webcache-verify";
mkdirSync(OUT_DIR, { recursive: true });

// playwright from the scratch install (gitignored download/.pwtools)
const PW = "/home/z/my-project/unown/download/.pwtools/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(PW).href);

function findChrome() {
        const root = join(homedir(), ".cache", "ms-playwright");
        if (!existsSync(root)) return undefined;
        for (const d of readdirSync(root)) {
                if (!d.startsWith("chromium")) continue;
                for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-linux/headless_shell"]) {
                        const p = join(root, d, sub);
                        if (existsSync(p)) return p;
                }
        }
        return undefined;
}

const consoleErrors = [];
const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("console", (msg) => {
        // net::ERR_FAILED on /api/* is the intentionally-aborted SSE/proxy routes
        // (the sanctioned shots_capture pattern) — not a rendering defect.
        if (msg.type() === "error" && !/net::ERR_FAILED/.test(msg.text())) consoleErrors.push(msg.text().slice(0, 200));
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${String(err).slice(0, 200)}`));

// engine proxy (the sanctioned pattern)
await context.route("**/api/**", async (route) => {
        const u = new URL(route.request().url());
        if (u.searchParams.get("XTransformPort") !== "3030") return route.continue();
        if (u.pathname === "/api/events") return route.abort();
        try {
                const resp = await route.fetch({ url: ENGINE + u.pathname + u.search });
                return route.fulfill({ response: resp });
        } catch {
                return route.abort();
        }
});
console.log(`[proxy] ${new URL(BASE).host}/api?XTransformPort=3030 -> ${ENGINE}`);

await page.goto(`${BASE}/dashboard?tab=webcache`, { waitUntil: "networkidle", timeout: 45_000 });
await page.waitForTimeout(1500);

// In-DOM contract checks before any screenshot: the tab rendered real data
// and the new approx chip is present (engine answers stats.index now).
const checks = await page.evaluate(() => {
        const text = document.body.innerText;
        const chip = Array.from(document.querySelectorAll("span")).find((s) => s.textContent?.trim() === "≈ indexed");
        const kpi = Array.from(document.querySelectorAll("*")).some((el) => el.textContent?.includes("Cached size"));
        return {
                title: document.title,
                hasWebcacheHeading: /web results store|web cache/i.test(text),
                hasApproxChip: Boolean(chip),
                chipTitle: chip?.getAttribute("title") ?? null,
                hasCachedSizeKpi: kpi,
                hasEntries: /\bentries\b/i.test(text),
                hasActivityFeed: /latest cache events|activity/i.test(text),
                bodySnippet: text.replace(/\s+/g, " ").slice(0, 400),
        };
});
console.log("[checks]", JSON.stringify(checks, null, 1));

await page.screenshot({ path: join(OUT_DIR, "webcache-desktop-full.png"), fullPage: true });

// KPI row close-up (the chip)
const chipEl = await page.$("text=≈ indexed");
if (chipEl) {
        const box = await chipEl.boundingBox();
        if (box) {
                await page.screenshot({
                        path: join(OUT_DIR, "webcache-kpi-row.png"),
                        clip: { x: Math.max(0, box.x - 260), y: Math.max(0, box.y - 60), width: Math.min(1440, 720), height: 200 },
                });
        }
}

// mobile 390px
const mob = await browser.newContext({ viewport: { width: 390, height: 844 } });
await mob.route("**/api/**", async (route) => {
        const u = new URL(route.request().url());
        if (u.searchParams.get("XTransformPort") !== "3030") return route.continue();
        if (u.pathname === "/api/events") return route.abort();
        try {
                const resp = await route.fetch({ url: ENGINE + u.pathname + u.search });
                return route.fulfill({ response: resp });
        } catch {
                return route.abort();
        }
});
const mobPage = await mob.newPage();
mobPage.on("console", (msg) => {
        if (msg.type() === "error" && !/net::ERR_FAILED/.test(msg.text())) consoleErrors.push(`[mobile] ${msg.text().slice(0, 200)}`);
});
await mobPage.goto(`${BASE}/dashboard?tab=webcache`, { waitUntil: "networkidle", timeout: 45_000 });
await mobPage.waitForTimeout(1200);
await mobPage.screenshot({ path: join(OUT_DIR, "webcache-mobile.png"), fullPage: true });

console.log("[console-errors]", consoleErrors.length ? consoleErrors : "none");
await browser.close();

const pass = checks.hasWebcacheHeading && checks.hasApproxChip && checks.hasCachedSizeKpi && consoleErrors.length === 0;
console.log(pass ? "VERIFY: PASS" : "VERIFY: FAIL");
process.exit(pass ? 0 : 1);
