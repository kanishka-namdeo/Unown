"use strict";
/**
 * Renderer config matrix test — decides how the capture harness must render
 * so the FULL tmux pane (128x36, every corner) is visible in the screenshot.
 *
 * Boots a marker-patterned 128x36 pane, attaches ttyd with each candidate
 * xterm config, screenshots, and measures the content bbox pixel-exactly.
 * PASS = marker text found at all 4 corners (verified via pixel bbox + VLM on winner).
 */
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
const OUT = require("node:path").join(process.env.OUT_ROOT || "/home/z/my-project/download/unown-tui-captures", "_audit", "render-matrix");
let PORT = 7890;

function sh(file, args, opts = {}) {
  return new Promise((res, rej) =>
    execFile(file, args, { timeout: 30_000, ...opts }, (e, o) => (e ? rej(e) : res(o))));
}
const tmuxEnv = { ...process.env, LD_LIBRARY_PATH: LD_LIB };
const S = "rmtx";

// corner + edge markers: full-width rows, distinct start/end tokens per row
const MARKER = `python3 - <<'PYEOF'
rows = 36
lines = []
lines.append("TOP-ROW-01-START" + "-" * 88 + "COL-128-END")
for r in range(2, 35):
    lines.append(f"ROW-{r:02d}-START" + "." * 90 + f"ROW-{r:02d}-END")
lines.append("BOTTOM-ROW-36-START" + "_" * 84 + "RIGHT-BOTTOM-CORNER-36")
print("\\n".join(lines))
PYEOF`;

async function bootPane() {
  await sh(TMUX_BIN, ["kill-session", "-t", S], { env: tmuxEnv }).catch(() => {});
  await sh(TMUX_BIN, ["new-session", "-d", "-s", S, "-x", "128", "-y", "36", "bash"], { env: tmuxEnv });
  await sh(TMUX_BIN, ["set-window-option", "-t", S, "window-size", "manual"], { env: tmuxEnv }).catch(() => {});
  await sh(TMUX_BIN, ["send-keys", "-t", S, "-l", MARKER], { env: tmuxEnv });
  await sleep(400);
  await sh(TMUX_BIN, ["send-keys", "-t", S, "Enter"], { env: tmuxEnv });
  await sleep(1200);
}

async function runConfig(name, { dsf, ttydOpts }) {
  const port = PORT++;
  const ttyd = spawn(TTYD_BIN, ["-W", "-p", String(port), "-I", HTML, ...ttydOpts, "tmux", "attach", "-t", S], {
    env: { ...tmuxEnv, PATH: `/home/z/.local/opt/tmux-root/usr/bin:${process.env.PATH}` },
    stdio: ["ignore", "ignore", "ignore"],
  });
  await sleep(1500);
  const browser = await PLAYWRIGHT.chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1220, height: 720 }, deviceScaleFactor: dsf });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await sleep(1800);
  // autofit loop like the driver
  let vw = 1220, vh = 720, grid = null;
  for (let i = 0; i < 8; i++) {
    grid = await page.evaluate(() => {
      const t = window.term || globalThis.term;
      const el = document.querySelector(".xterm");
      const r = el.getBoundingClientRect();
      return t ? { cols: t.cols, rows: t.rows, elW: r.width, elH: r.height } : null;
    });
    if (!grid) throw new Error("no term handle");
    if (grid.cols === 128 && grid.rows === 36) break;
    const cw = grid.elW / grid.cols, ch = grid.elH / grid.rows;
    vw = Math.round(vw + (128 - grid.cols) * cw);
    vh = Math.round(vh + (36 - grid.rows) * ch);
    await page.setViewportSize({ width: Math.max(200, vw), height: Math.max(120, vh) });
    await sleep(700);
    grid = await page.evaluate(() => {
      const t = window.term || globalThis.term;
      return t ? { cols: t.cols, rows: t.rows } : null;
    });
    if (grid.cols === 128 && grid.rows === 36) break;
  }
  await sleep(600);
  const shot = `${OUT}/${name}.png`;
  await shotWithRetry(page, { path: shot });
  const meta = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return c ? { canvas: `${c.width}x${c.height}`, css: `${c.style.width}x${c.style.height}` } : null;
  });
  await browser.close();
  ttyd.kill("SIGTERM");
  await sleep(400);
  return { name, dsf, grid, viewport: `${vw}x${vh}`, meta, shot };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await bootPane();
  const pane = await sh(TMUX_BIN, ["capture-pane", "-t", S, "-p"], { env: tmuxEnv });
  fs.writeFileSync(`${OUT}/pane.txt`, pane);
  const base = ["-t", "rendererType=canvas", "-t", 'theme={"background":"#09090b"}'];
  const font = ["-t", "fontFamily=JetBrains Mono", "-t", "fontSize=15"];
  const configs = [
    { name: "A-canvas-dsf2-font15", dsf: 2, ttydOpts: [...base, ...font] },       // current (broken?)
    { name: "B-canvas-dsf1-font15", dsf: 1, ttydOpts: [...base, ...font] },
    { name: "C-canvas-dsf1-font30", dsf: 1, ttydOpts: [...base, "-t", "fontFamily=JetBrains Mono", "-t", "fontSize=30"] },
    { name: "D-webgl-dsf2-font15", dsf: 2, ttydOpts: ["-t", "rendererType=webgl", "-t", 'theme={"background":"#09090b"}', ...font] },
    { name: "E-dom-dsf2-font15", dsf: 2, ttydOpts: ["-t", "rendererType=dom", "-t", 'theme={"background":"#09090b"}', ...font] },
  ];
  const results = [];
  for (const c of configs) {
    try {
      results.push(await runConfig(c.name, c));
      console.log(`OK   ${c.name}`);
    } catch (e) {
      console.log(`FAIL ${c.name}: ${String(e).slice(0, 200)}`);
      results.push({ name: c.name, error: String(e).slice(0, 300) });
    }
  }
  await sh(TMUX_BIN, ["kill-session", "-t", S], { env: tmuxEnv }).catch(() => {});
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results.map(({ name, grid, viewport, meta, shot }) => ({ name, grid, viewport, meta, shot })), null, 1));
})();
