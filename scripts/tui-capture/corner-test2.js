"use strict";
/** Corner test v2 — driver-exact boot (window-size manual + status off),
 *  newline-terminated full-width markers, cross-checked by pixels + VLM.
 *  Settles the pane-row → rendered-row mapping and validates the boot path. */
const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");

const TMUX_BIN = process.env.TMUX_BIN || "/home/z/.local/opt/tmux-root/usr/bin/tmux";
const TTYD_BIN = process.env.TTYD_BIN || "/home/z/.local/bin/ttyd";
const LD_LIB = process.env.LD_LIB || "/home/z/.local/opt/tmux-root/usr/lib/x86_64-linux-gnu";
const HTML = require("node:path").join(__dirname, "ttyd-index.html"); // run make_ttyd_index.sh first
const PLAYWRIGHT = require(require("node:path").join(process.env.UNOWN_ROOT || require("node:path").resolve(__dirname, "..", ".."), "node_modules", "playwright"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bounded-retry screenshot — same transient headless protocol error the
 *  driver guards against (see driver.js shotWithRetry). */
async function shotWithRetry(page, opts, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await page.screenshot(opts); }
    catch (e) { lastErr = e; if (i < attempts - 1) await sleep(i === 0 ? 120 : 450); }
  }
  throw lastErr;
}
const OUT = require("node:path").join(process.env.OUT_ROOT || "/home/z/my-project/download/unown-tui-captures", "_audit", "corner2");
let PORT = 7970;

function sh(file, args, opts = {}) {
  return new Promise((res, rej) =>
    execFile(file, args, { timeout: 30_000, ...opts }, (e, o) => (e ? rej(e) : res(o))));
}
const tmuxEnv = { ...process.env, LD_LIBRARY_PATH: LD_LIB };
const S = "corner2";

const MARKER_FILE = `#!/bin/bash
clear
for r in $(seq -w 1 34); do
  printf 'R%s:' "\$r"
  printf '=%.0s' $(seq 1 118)
  printf ':E%s' "\$r"
  printf '\\n'
done`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync("/tmp/markers2.sh", MARKER_FILE);
  await sh(TMUX_BIN, ["kill-session", "-t", S], { env: tmuxEnv }).catch(() => {});
  await sh(TMUX_BIN, ["new-session", "-d", "-s", S, "-x", "128", "-y", "36", "bash"], { env: tmuxEnv });
  await sh(TMUX_BIN, ["set-window-option", "-t", S, "window-size", "manual"], { env: tmuxEnv }).catch(() => {});
  await sh(TMUX_BIN, ["set-option", "-t", S, "status", "off"], { env: tmuxEnv }).catch(() => {});
  await sh(TMUX_BIN, ["send-keys", "-t", S, "-l", "bash /tmp/markers2.sh"], { env: tmuxEnv });
  await sleep(300);
  await sh(TMUX_BIN, ["send-keys", "-t", S, "Enter"], { env: tmuxEnv });
  await sleep(1500);
  const info = await sh(TMUX_BIN, ["display-message", "-p", "-t", S, "win=#{window_width}x#{window_height} pane=#{pane_width}x#{pane_height}"], { env: tmuxEnv });
  console.log("TMUX:", info.trim());
  const pane = await sh(TMUX_BIN, ["capture-pane", "-t", S, "-p"], { env: tmuxEnv });
  fs.writeFileSync(`${OUT}/pane.txt`, pane);
  console.log("pane lines:", pane.split("\n").length);

  const port = PORT++;
  const ttyd = spawn(TTYD_BIN, ["-W", "-p", String(port), "-I", HTML,
    "-t", "rendererType=canvas", "-t", "fontFamily=JetBrains Mono", "-t", "fontSize=30",
    "-t", "cursorBlink=false", "-t", 'theme={"background":"#09090b"}',
    "tmux", "attach", "-t", S], {
    env: { ...tmuxEnv, PATH: `/home/z/.local/opt/tmux-root/usr/bin:${process.env.PATH}` },
    stdio: ["ignore", "ignore", "ignore"],
  });
  await sleep(1500);
  const browser = await PLAYWRIGHT.chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1220, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await sleep(1800);
  let vw = 1220, vh = 720, g = null;
  for (let i = 0; i < 8; i++) {
    g = await page.evaluate(() => {
      const t = window.term || globalThis.term;
      const el = document.querySelector(".xterm");
      const r = el.getBoundingClientRect();
      const c = document.querySelector("canvas");
      return t ? { cols: t.cols, rows: t.rows, elW: r.width, elH: r.height,
        canvas: c ? `${c.width}x${c.height}` : null,
        css: c ? `${c.style.width}x${c.style.height}` : null } : null;
    });
    console.log(`iter${i}: grid=${g.cols}x${g.rows} el=${Math.round(g.elW)}x${Math.round(g.elH)} canvas=${g.canvas} css=${g.css}`);
    if (g.cols === 128 && g.rows === 36) break;
    const cw = g.elW / g.cols, ch = g.elH / g.rows;
    vw = Math.round(vw + (128 - g.cols) * cw);
    vh = Math.round(vh + (36 - g.rows) * ch);
    await page.setViewportSize({ width: Math.max(200, vw), height: Math.max(120, vh) });
    await sleep(700);
  }
  await sleep(600);
  await shotWithRetry(page, { path: `${OUT}/corner2.png` });
  await browser.close();
  ttyd.kill("SIGTERM");
  await sleep(300);
  await sh(TMUX_BIN, ["kill-session", "-t", S], { env: tmuxEnv }).catch(() => {});
  console.log("shot →", `${OUT}/corner2.png`);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
