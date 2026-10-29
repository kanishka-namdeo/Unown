/** probe-shot.mjs — screenshot what /nocturne actually renders */
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push("C: " + m.text().slice(0, 300)); });
page.on("pageerror", (e) => errors.push("P: " + String(e).slice(0, 500)));
await page.goto("http://127.0.0.1:3210/nocturne", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const body = await page.textContent("body").catch(() => "(none)");
console.log("BODY TEXT (first 500):", body.slice(0, 500));
console.log("email inputs:", await page.locator('input[type="email"]').count());
console.log("buttons:", await page.locator("button").count());
console.log("ERRORS:", errors.length);
for (const e of errors) console.log("  *", e);
await page.screenshot({ path: "/home/z/my-project/logs/nocturne-standalone.png" });
await browser.close();
