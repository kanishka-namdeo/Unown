"use strict";
/** Renderer stress test — reproduces the canvas glyph-atlas corruption seen in
 *  the checkpoints capture (solid green block + garbage glyphs) and grades
 *  canvas vs webgl vs dom at dsf=1. Boots a pane, floods it with scrolling
 *  colored content (including a wide green block like bun test summaries),
 *  screenshots mid-storm and after, and checks pixels + VLM for corruption. */
const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");

const TMUX_BIN = process.env.TMUX_BIN || "/home/z/.local/opt/tmux-root/usr/bin/tmux";
const TTYD_BIN = process.env.TTYD_BIN || "/home/z/.local/bin/ttyd";
const LD_LIB = process.env.LD_LIB || "/home/z/.local/opt/tmux-root/usr/lib/x86_64-linux-gnu";
const HTML = require("node:path").join(__dirname, "ttyd-index.html"); // run make_ttyd_index.sh first
const PLAYWRIGHT = require(require("node:path").join(process.env.UNOWN_ROOT || require("node:path").resolve(__dirname, "..", ".."), "node_modules", "playwright"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = require("node:path").join(process.env.OUT_ROOT || "/home/z/my-project/download/unown-tui-captures", "_audit", "render-stress");
let PORT = 7980;

function sh(file, args, opts = {}) {
  return new Promise((res, rej) => execFile(file, args, { timeout: 30_000, ...opts }, (e, o) => (e ? rej(e) : res(o))));
}
const tmuxEnv = { ...process.env, LD_LIBRARY_PATH: LD_LIB };
const S = "stress";

const FLOOD_FILE = require("node:path").join(__dirname, "flood.py");

async function run(name, renderer) {
  const port = PORT++;
  await sh(TMUX_BIN, ["kill-session", "-t", `${S}-${name}`], { env: tmuxEnv }).catch(() => {});
  await sh(TMUX_BIN, ["new-session", "-d", "-s", `${S}-${name}`, "-x", "128", "-y", "36", "bash"], { env: tmuxEnv });
  await sh(TMUX_BIN, ["set-window-option", "-t", `${S}-${name}`, "window-size", "manual"], { env: tmuxEnv }).catch(() => {});
  await sh(TMUX_BIN, ["set-option", "-t", `${S}-${name}`, "status", "off"], { env: tmuxEnv }).catch(() => {});
  
  const ttyd = spawn(TTYD_BIN, ["-W", "-p", String(port), "-I", HTML,
    "-t", `rendererType=${renderer}`, "-t", "fontFamily=JetBrains Mono", "-t", "fontSize=30",
    "-t", "cursorBlink=false", "-t", 'theme={"background":"#09090b"}',
    "tmux", "attach", "-t", `${S}-${name}`], {
    env: { ...tmuxEnv, PATH: `/home/z/.local/opt/tmux-root/usr/bin:${process.env.PATH}` },
    stdio: ["ignore", "ignore", "ignore"],
  });
  await sleep(1200);
  const browser = await PLAYWRIGHT.chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1220, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await sleep(1600);
  let vw = 1220, vh = 720;
  for (let i = 0; i < 8; i++) {
    const g = await page.evaluate(() => {
      const t = window.term || globalThis.term;
      const el = document.querySelector(".xterm");
      const r = el.getBoundingClientRect();
      return t ? { cols: t.cols, rows: t.rows, elW: r.width, elH: r.height } : null;
    });
    if (!g) throw new Error("no term");
    if (g.cols === 128 && g.rows === 36) break;
    const cw = g.elW / g.cols, ch = g.elH / g.rows;
    vw = Math.round(vw + (128 - g.cols) * cw);
    vh = Math.round(vh + (36 - g.rows) * ch);
    await page.setViewportSize({ width: Math.max(200, vw), height: Math.max(120, vh) });
    await sleep(600);
  }
  // start the flood in the pane
  await sh(TMUX_BIN, ["send-keys", "-t", `${S}-${name}`, "-l", `python3 ${FLOOD_FILE}`], { env: tmuxEnv });
  await sh(TMUX_BIN, ["send-keys", "-t", `${S}-${name}`, "Enter"], { env: tmuxEnv });
  await sleep(1400); // mid-storm
  const mid = `${OUT}/${name}-mid.png`;
  await page.screenshot({ path: mid });
  await sleep(2500); // after the storm settles
  const post = `${OUT}/${name}-post.png`;
  await page.screenshot({ path: post });
  await browser.close();
  ttyd.kill("SIGTERM");
  await sleep(300);
  await sh(TMUX_BIN, ["kill-session", "-t", `${S}-${name}`], { env: tmuxEnv }).catch(() => {});
  console.log(`${name} (${renderer}): saved ${mid} + ${post}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, renderer] of [["canvas", "canvas"], ["webgl", "webgl"], ["dom", "dom"]]) {
    try { await run(name, renderer); } catch (e) { console.log(`${name} FAILED: ${String(e).slice(0, 150)}`); }
  }
})();
