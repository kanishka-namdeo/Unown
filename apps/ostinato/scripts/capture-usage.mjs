#!/usr/bin/env bun
/**
 * Ostinato — the usage-capture lane (ticket O-5, chunk 1; the Coda T3
 * `capture-usage.mjs` precedent, ported with the keyboard-only twist).
 *
 * Boots the REAL app via the app-root `serve.mjs` on a scratch port,
 * drives the e2e spec's own interactions (verbatim idiom — the K-1
 * zero-mouse flow, truncated before the grade: the stills want the
 * in-use review screen, not the done screen), and stills the four
 * honest states through the real UI at 1280x800 / deviceScaleFactor 2:
 *
 *   01-fresh-boot.png — the app at its honest empty state ("No decks yet")
 *   02-palette.png    — the command palette OPEN (the keyboard-first
 *                       identity shot)
 *   03-review.png     — the review screen, card front + progress
 *                       ("1 of 1")
 *   04-revealed.png   — the back face revealed, the markdown bold
 *                       ("command palette") rendered as <strong>
 *
 * THE KEYBOARD-ONLY LAW: Ostinato is keyboard-first — every interaction
 * in this script goes through `page.keyboard` (press/type). NO
 * `.click()`, NO `.fill()` anywhere (fill is a value-set, not
 * keyboard input). Waits are locator-waits, never fixed sleeps.
 *
 * Output: `public/landing/ostinato/` (+ a PROVENANCE.md sidecar — the
 * lane never regenerates for a new consumer; the sidecar is the
 * media's receipt). The lane itself is NOT run by the build agent —
 * the browser lane is the operator's gate; this file ships
 * unexecuted by design (V-23 execution honesty, the O-4 precedent).
 *
 * Zero new dependencies: Playwright + Chromium resolve upward from the
 * root `node_modules` exactly as `e2e/` does (the zero-dep law
 * extends to the scripts). Run with `bun` from anywhere:
 *
 *   bun apps/ostinato/scripts/capture-usage.mjs [--port 4015]
 *
 * Exit 0 = all four stills + the sidecar written; any failure prints
 * the reason and exits 1.
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OSTINATO_ROOT = resolve(SCRIPT_DIR, ".."); // serve.mjs lives at the APP ROOT
const REPO_ROOT = resolve(OSTINATO_ROOT, "..", "..");
const OUT_DIR = resolve(REPO_ROOT, "public", "landing", "ostinato");

// Ostinato's zero-dep law: @playwright/test resolves upward from the
// repo root's node_modules (the e2e lane's own resolution).
const { chromium } = await import("@playwright/test");

// 4013 is the app's reserved dev port (serve.mjs default, OSTINATO_PORT);
// the capture lane takes 4015 so it never shadows a running dev server.
const PORT = Number(process.argv[2] === "--port" ? process.argv[3] : 4015);
const VIEWPORT = { width: 1280, height: 800 };

function fail(msg) {
  console.error(`[ostinato-capture] ${msg}`);
  process.exit(1);
}

// 1. Boot the real dev server on a scratch port, waiting for its real
//    ready line (serve.mjs announces `[ostinato] serving ...`).
console.log(`[ostinato-capture] booting serve.mjs on port ${PORT}`);
const serveScript = resolve(OSTINATO_ROOT, "serve.mjs");
const server = spawn(process.execPath || "bun", [serveScript], {
  cwd: REPO_ROOT,
  env: { ...process.env, OSTINATO_PORT: String(PORT) },
  stdio: ["ignore", "pipe", "inherit"],
});
server.on("error", (e) => fail(`serve.mjs failed to spawn: ${e.message}`));
const base = `http://127.0.0.1:${PORT}`;

let serverReady = false;
const serverOutput = { buffer: "" };
server.stdout.on("data", (d) => {
  serverOutput.buffer += d.toString("utf8");
  if (serverOutput.buffer.includes("[ostinato] serving")) {
    serverReady = true;
  }
});
for (let i = 0; i < 50 && !serverReady; i++) {
  await new Promise((r) => setTimeout(r, 100));
}
if (!serverReady) fail("serve.mjs did not announce ready within 5 s");

// 2. The real browser, one fresh context (no SW, no IndexedDB, no
//    localStorage — the e2e spec's own starting state).
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.warn(`[ostinato-capture] page error: ${e.message}`));

  // ─── 1. EMPTY BOOT: no seed → the honest empty panel ──────────
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator(".ostinato-state").filter({ hasText: "No decks yet" }).waitFor({ timeout: 30_000 });

  // ─── STILL 1: the honest empty state ──────────────────────────
  mkdirSync(OUT_DIR, { recursive: true });
  const p1 = resolve(OUT_DIR, "01-fresh-boot.png");
  await page.screenshot({ path: p1, fullPage: true });
  console.log(`[ostinato-capture] wrote ${p1}`);

  // ─── STILL 2: the command palette OPEN (the identity shot) ────
  await page.keyboard.press("Control+k");
  await page.locator("#ostinato-palette").waitFor({ state: "visible", timeout: 10_000 });
  const p2 = resolve(OUT_DIR, "02-palette.png");
  await page.screenshot({ path: p2, fullPage: true });
  console.log(`[ostinato-capture] wrote ${p2}`);

  // ─── Close the palette: focus returns, the state is untouched ─
  await page.keyboard.press("Escape");
  await page.locator("#ostinato-palette").waitFor({ state: "hidden", timeout: 10_000 });

  // ─── CREATE THE DECK VIA THE PALETTE (the enumeration law) ────
  // The idiom is the e2e spec's, verbatim (the K-1 zero-mouse lane):
  // Ctrl+K → filter to the create-deck row → Enter → the form opens
  // with #ostinato-create-name focused.
  await page.keyboard.press("Control+k");
  await page.keyboard.type("create deck");
  await page.locator('#ostinato-palette li[data-cmd="create-deck"]').waitFor({ state: "visible", timeout: 10_000 });
  await page.keyboard.press("Enter");
  await page.locator("#ostinato-palette").waitFor({ state: "hidden", timeout: 10_000 });
  await page.locator("#ostinato-create-form").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#ostinato-create-name").waitFor({ state: "visible", timeout: 10_000 });

  // ─── SUBMIT THE DECK (implicit submit from the single input) ──
  await page.keyboard.type("Terminal basics");
  await page.keyboard.press("Enter");
  await page.locator("#ostinato-create-form").waitFor({ state: "hidden", timeout: 10_000 });
  await page.locator(".ostinato-notice").filter({ hasText: 'Deck "Terminal basics" created.' }).waitFor({ timeout: 10_000 });
  await page.locator(".ostinato-state").filter({ hasText: "No cards yet" }).waitFor({ timeout: 10_000 });

  // ─── CREATE THE CARD VIA THE DIRECT KEY (the hint honesty) ────
  // C is the palette row's kbd hint AND the runner key. Tab walks:
  // deck select → front input → back textarea → the submit button.
  await page.keyboard.press("C");
  await page.locator("#ostinato-create-form").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#ostinato-create-deck").waitFor({ state: "visible", timeout: 10_000 });
  await page.keyboard.press("Tab");
  await page.locator("#ostinato-create-front").waitFor({ state: "visible", timeout: 10_000 });
  await page.keyboard.type("What does Ctrl+K open?");
  await page.keyboard.press("Tab");
  await page.locator("#ostinato-create-back").waitFor({ state: "visible", timeout: 10_000 });
  await page.keyboard.type("The **command palette** — every command, zero mouse.");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.locator("#ostinato-create-form").waitFor({ state: "hidden", timeout: 10_000 });
  await page.locator(".ostinato-notice").filter({ hasText: "Card created." }).waitFor({ timeout: 10_000 });
  await page.locator(".ostinato-card-front").filter({ hasText: "What does Ctrl+K open?" }).waitFor({ timeout: 10_000 });
  await page.locator(".ostinato-progress").filter({ hasText: "1 of 1" }).waitFor({ timeout: 10_000 });

  // ─── STILL 3: the review screen (card front + progress) ───────
  const p3 = resolve(OUT_DIR, "03-review.png");
  await page.screenshot({ path: p3, fullPage: true });
  console.log(`[ostinato-capture] wrote ${p3}`);

  // ─── REVEAL: Space flips the card; the bold renders as <strong>
  await page.keyboard.press(" ");
  await page.locator(".ostinato-card-back").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator(".ostinato-card-back strong").filter({ hasText: "command palette" }).waitFor({ timeout: 10_000 });

  // ─── STILL 4: the back face revealed (DO NOT grade — the stills
  //     want the in-use review screen, not the done state) ────────
  const p4 = resolve(OUT_DIR, "04-revealed.png");
  await page.screenshot({ path: p4, fullPage: true });
  console.log(`[ostinato-capture] wrote ${p4}`);

  // ─── The sidecar receipt — provenance lands next to the media ─
  const provenance = `# Ostinato usage stills — provenance

- Captured: ${new Date().toISOString()} by \`apps/ostinato/scripts/capture-usage.mjs\` (O-5 chunk 1, the PWA tooling lane).
- Server: \`bun apps/ostinato/serve.mjs\` on scratch port ${PORT} (the real transpiling dev server, no build step; 4013 is the app's reserved dev port, so the capture lane takes 4015).
- Browser: headless Chromium (the e2e lane's own install), ONE FRESH context — no service worker state, no IndexedDB, no localStorage.
- Viewport: ${VIEWPORT.width}x${VIEWPORT.height}, deviceScaleFactor 2, full-page screenshots.
- KEYBOARD-ONLY LAW: every interaction above is a \`page.keyboard\` press/type — zero pointer events, no \`.fill()\` (the K-1 zero-mouse lane extended from \`e2e/ostinato-flow.spec.ts\` to the capture lane).
- 01-fresh-boot.png — the honest empty state (\`.ostinato-state\` = "No decks yet").
- 02-palette.png — the command palette OPEN via Ctrl+K (the keyboard-first identity shot).
- 03-review.png — the review screen: deck "Terminal basics" created, card front "What does Ctrl+K open?" + progress "1 of 1".
- 04-revealed.png — the back face revealed with Space; the markdown bold "**command palette**" rendered as a <strong>. Left ungraded on purpose (the in-use state, not the done state).
- Re-runnable: \`bun apps/ostinato/scripts/capture-usage.mjs [--port P]\` — output overwrites the stills in place.
`;
  writeFileSync(resolve(OUT_DIR, "PROVENANCE.md"), provenance);
  console.log(`[ostinato-capture] wrote ${resolve(OUT_DIR, "PROVENANCE.md")}`);
} finally {
  await browser.close().catch(() => {});
  server.kill();
}
console.log("[ostinato-capture] done — all four stills + provenance written.");
