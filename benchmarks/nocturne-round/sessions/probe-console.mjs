/** probe-console.mjs — capture the ui-pass console errors verbatim */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3210";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push("C: " + m.text().slice(0, 300)); });
page.on("pageerror", (e) => errors.push("P: " + String(e).slice(0, 400)));
page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/nocturne")) errors.push(`HTTP ${r.status()} ${r.url().replace(BASE, "")}`); });

await page.goto(`${BASE}/nocturne`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.locator('input[type="email"]').fill("mira@lumen.test");
await page.locator('input[type="password"]').fill("nocturne-demo-1");
await page.getByRole("button", { name: /sign in/i }).click();
await page.getByRole("tablist", { name: /nocturne navigation/i }).waitFor({ timeout: 10000 });
await page.waitForTimeout(1000);
// walk all tabs like the pass does
for (const t of ["Incidents", "Services", "Rotations", "Runbooks", "Postmortems", "Analytics", "Members"]) {
  await page.getByRole("tab", { name: t }).click().catch(() => {});
  await page.waitForTimeout(700);
}
// rotations detail (the F12 path)
await page.getByRole("tab", { name: "Rotations" }).click();
await page.waitForTimeout(500);
await page.locator('ul[aria-label="Rotations"] li').first().click().catch(() => {});
await page.waitForTimeout(800);
// the public status page in an anon context
const anon = await browser.newContext();
const ap = await anon.newPage();
ap.on("console", (m) => { if (m.type() === "error") errors.push("ANON-C: " + m.text().slice(0, 300)); });
ap.on("response", (r) => { if (r.status() >= 400) errors.push(`ANON-HTTP ${r.status()} ${r.url().replace(BASE, "")}`); });
await ap.goto(`${BASE}/nocturne/status/lumen`, { waitUntil: "networkidle" });
await ap.waitForTimeout(1500);
await anon.close();
console.log("ERRORS (" + errors.length + "):");
for (const e of errors) console.log("  *", e);
await browser.close();
