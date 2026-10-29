#!/usr/bin/env node
/* overflow-probe: find the exact elements wider than the 390px viewport. */
import { spawn } from "node:child_process";
import { join } from "node:path";

const PORT = 3219;
const STANDALONE = join(process.cwd(), ".next", "standalone", "server.js");
const server = spawn(process.execPath, [STANDALONE], {
  env: { ...process.env, PORT: String(PORT), HOSTNAME: "127.0.0.1" },
  stdio: "ignore",
});
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/encore`, { signal: AbortSignal.timeout(1500) }); if (r.ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}
const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
await page.goto(`http://127.0.0.1:${PORT}/encore`, { waitUntil: "networkidle" });
await new Promise((r) => setTimeout(r, 900));
const offenders = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.body.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") continue;
    if (r.width > vw + 0.5 || r.right > vw + 0.5) {
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === "string" ? el.className : "").slice(0, 60),
        w: Math.round(r.width), right: Math.round(r.right),
        text: (el.textContent || "").trim().slice(0, 50),
      });
    }
  }
  return { vw, scrollW: document.documentElement.scrollWidth, out: out.slice(0, 12) };
});
console.log(JSON.stringify(offenders, null, 1));
await browser.close();
server.kill("SIGTERM");
// (appended) computed-style check for the sr-only table
