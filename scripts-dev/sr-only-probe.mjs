#!/usr/bin/env node
/* sr-only probe: why does table.sr-only measure 392px on the 390 viewport? */
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
await new Promise((r) => setTimeout(r, 800));
const info = await page.evaluate(() => {
  const t = document.querySelector("table.sr-only");
  if (!t) return { found: false };
  const s = getComputedStyle(t);
  const r = t.getBoundingClientRect();
  return {
    found: true,
    position: s.position, width: s.width, display: s.display,
    clip: s.clip, overflow: s.overflow, whiteSpace: s.whiteSpace,
    rect: { w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right) },
    parentTag: t.parentElement?.tagName, parentCls: (t.parentElement?.className ?? "").toString().slice(0, 80),
    html: t.outerHTML.slice(0, 180),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
server.kill("SIGTERM");
