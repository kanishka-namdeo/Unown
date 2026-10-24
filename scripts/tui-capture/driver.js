/**
 * unown TUI capture harness — drives the real `unown` TUI in a fixed-size tmux
 * pane, rendered via ttyd + headless Chromium, and records landing-page assets
 * (PNG stills + JPEG frame sequences later assembled into MP4/WebM/GIF).
 *
 * The full workflow — geometry rules, calibration gates, scenario authoring,
 * VLM audit, asset curation — is documented in docs/tui-capture-workflow.md.
 * Read that page before touching this harness.
 *
 * Design invariants:
 *   - Input goes directly to tmux (send-keys); the ttyd client is render-only.
 *   - Content-based waits poll `tmux capture-pane` for literal anchors — the
 *     pane text is the truth for timing, the screenshot is the truth for looks.
 *   - THE GEOMETRY RULE: deviceScaleFactor is ALWAYS 1. The xterm canvas
 *     renderer in this ttyd build mis-scales cells when devicePixelRatio != 1
 *     (cells drawn at 2x into a 1x canvas => only the top-left half of the
 *     pane reaches the screenshot). Hi-res comes from a big font
 *     (fontSize=30 ≈ a 15px font at 2x pixel density), never from dsf=2.
 *     Re-prove this on your machine with render-matrix.js / corner-test.js
 *     before trusting any capture.
 */
"use strict";

const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// ── machine wiring (env-overridable so the harness is clone-portable) ─────────
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const UNOWN_ROOT = process.env.UNOWN_ROOT || REPO_ROOT;
const TMUX_BIN = process.env.TMUX_BIN || "/home/z/.local/opt/tmux-root/usr/bin/tmux";
const TTYD_BIN = process.env.TTYD_BIN || "/home/z/.local/bin/ttyd";
const LD_LIB = process.env.LD_LIB || "/home/z/.local/opt/tmux-root/usr/lib/x86_64-linux-gnu";
const OUT_ROOT = process.env.OUT_ROOT || "/home/z/my-project/download/unown-tui-captures";
const PLAYWRIGHT = require(path.join(UNOWN_ROOT, "node_modules", "playwright"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SPINNER_RE = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

function sh(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 64 * 1024 * 1024, timeout: 30_000, ...opts }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr, stdout }));
      else resolve(stdout);
    });
  });
}

class TmuxSession {
  constructor(name, cols = 128, rows = 36) {
    this.name = name;
    this.cols = cols;
    this.rows = rows;
  }
  env(extra = {}) {
    // Captures must be truthful to a colored terminal: strip the host's
    // color-suppression env (NO_COLOR / CLICOLOR=0 leak from CI sandboxes and
    // silently flip the TUI to plain mode - every still renders monochrome).
    const env = { ...process.env, LD_LIBRARY_PATH: LD_LIB, ...extra };
    delete env.NO_COLOR;
    delete env.CLICOLOR;
    delete env.CLICOLOR_FORCE;
    return env;
  }
  async kill() {
    try { await sh(TMUX_BIN, ["kill-session", "-t", this.name], { env: this.env() }); } catch {}
  }
  async boot(cwd, cmd, extraEnv = {}) {
    await this.kill();
    const envPairs = Object.entries(extraEnv).map(([k, v]) => `${k}=${v}`).join(" ");
    const full = `cd ${JSON.stringify(cwd)} && exec env ${envPairs} ${cmd}`;
    await sh(TMUX_BIN, ["new-session", "-d", "-s", this.name, "-x", String(this.cols), "-y", String(this.rows), "bash", "-lc", full], { env: this.env() });
    // pin the window size so the ttyd/xterm client resize can't change it
    try { await sh(TMUX_BIN, ["set-window-option", "-t", this.name, "window-size", "manual"], { env: this.env() }); } catch {}
    // kill the tmux status bar: a real user runs `unown` in a bare terminal —
    // the bar is a harness artifact and would eat one pane row on top of that
    try { await sh(TMUX_BIN, ["set-option", "-t", this.name, "status", "off"], { env: this.env() }); } catch {}
    // tmux extended-keys: the TUI warns when the server runs with it off
    // (modified Enter keys unreliable) — a config-less server (e.g. the
    // AppImage build, no ~/.tmux.conf) starts with it off and the warning
    // films into every session-2 boot. Set it server-side so it never does.
    try { await sh(TMUX_BIN, ["set-option", "-g", "extended-keys", "on"], { env: this.env() }); } catch {}
  }
  async text() {
    return sh(TMUX_BIN, ["capture-pane", "-t", this.name, "-p"], { env: this.env() });
  }
  async sendLiteral(s) {
    await sh(TMUX_BIN, ["send-keys", "-t", this.name, "-l", s], { env: this.env() });
  }
  async sendKey(k) {
    // tmux does not know "Esc" — an unrecognized key name is typed as a
    // LITERAL STRING (verified: `send-keys ... Esc` prints "Esc" into the
    // pane), which a modal overlay silently eats. Alias the common
    // shorthand so a spec's `Esc` is a real Escape keypress.
    const KEY_ALIASES = { Esc: "Escape", Del: "Delete", Ins: "Insert", Pgup: "PageUp", Pgdn: "PageDown" };
    await sh(TMUX_BIN, ["send-keys", "-t", this.name, KEY_ALIASES[k] ?? k], { env: this.env() });
  }
}

class FrameRecorder {
  /** Change-triggered frame capture: a frame is written whenever the pane
   *  signature changes (spinner churn excluded), plus a heartbeat frame every
   *  heartbeatMs so dwell moments stay present. Long spinner-idle runs are
   *  sampled slower (see extraDelay) so assemble.py can compress them. */
  constructor(page, dir, { pollMs = 220, heartbeatMs = 1100 } = {}) {
    this.page = page;
    this.dir = dir;
    this.pollMs = pollMs;
    this.heartbeatMs = heartbeatMs;
    this.idx = 0;
    this.lastSig = null;
    this.lastFrameAt = 0;
    this.running = false;
    this.stats = { frames: 0, changes: 0, heartbeats: 0 };
    this.meta = [];
    this._queue = Promise.resolve();
  }
  start(textFn) {
    this.running = true;
    this.textFn = textFn;
    const loop = async () => {
      let extraDelay = 0;
      while (this.running) {
        const t0 = Date.now();
        try {
          const text = await this.textFn();
          // beauty-2/3 replaced the generic "Working..." loader with verb-first
          // labels ("Editing x...", "Running bun..." + an m:ss chip), so the
          // literal "Working..." no longer marks a busy turn. The stable busy
          // signal is the loader's braille spinner — the ONLY component in the
          // TUI that renders those glyphs (grep-proven), so its presence in the
          // pane == a status indicator is animating == the agent is busy.
          const working = typeof text === "string" && SPINNER_RE.test(text);
          const sig = this._sig(text);
          const now = Date.now();
          const changed = sig !== this.lastSig;
          if (changed || now - this.lastFrameAt >= this.heartbeatMs) {
            this.lastSig = sig;
            this.lastFrameAt = now;
            this.stats.frames++;
            changed ? this.stats.changes++ : this.stats.heartbeats++;
            const shotP = this.page.screenshot({ type: "jpeg", quality: 87 }).catch(() => null);
            const myIdx = this.idx;
            const rec = { i: myIdx, changed, working };
            this.meta.push(rec);
            this.idx++;
            this._queue = this._queue.then(async () => {
              const buf = await shotP;
              if (buf) fs.writeFileSync(path.join(this.dir, `f_${String(myIdx).padStart(5, "0")}.jpg`), buf);
            });
            // spinner-only churn: slow the sampling so long LLM waits stay short in the video
            extraDelay = !changed && working ? 1400 : 0;
          } else {
            extraDelay = 0;
          }
        } catch {}
        const dt = Date.now() - t0;
        const target = this.pollMs + extraDelay;
        if (dt < target) await sleep(target - dt);
      }
      await this._queue;
    };
    this.done = loop();
  }
  _sig(text) {
    const lines = text.split("\n");
    // Spinner glyphs AND the status line's m:ss elapsed chip (beauty-2/3:
    // "Editing x… 0:12") are masked — they are turn-liveness churn, not
    // content; leaving the chip unmasked kept every tick looking like a
    // content change and starved assemble.py's spinner-idle compression.
    const body = lines
      .slice(0, Math.max(0, lines.length - 3))
      .map((l) => l.replace(SPINNER_RE, "x").replace(/\b\d+:\d\d\b/g, "t"));
    return crypto.createHash("sha1").update(body.join("\n")).digest("hex");
  }
  /** Duplicate the current view for `ms` so the final video dwells on it. */
  async dwell(ms) {
    const frames = Math.max(1, Math.round(ms / 125));
    for (let i = 0; i < frames; i++) {
      const buf = await this.page.screenshot({ type: "jpeg", quality: 87 }).catch(() => null);
      if (buf) {
        fs.writeFileSync(path.join(this.dir, `f_${String(this.idx).padStart(5, "0")}.jpg`), buf);
        this.idx++;
        this.stats.frames++;
      }
      if (i < frames - 1) await sleep(125);
    }
    this.lastFrameAt = Date.now();
  }
  async stop() {
    this.running = false;
    await this.done;
    await this._queue;
    return this.stats;
  }
  writeMeta(metaPath) {
    fs.writeFileSync(metaPath, this.meta.map((m) => JSON.stringify(m)).join("\n") + "\n");
  }
}

class CaptureSession {
  constructor({ name, cwd, port, cols = 128, rows = 36, dsf = 1, env = {}, bootCmd, ready } = {}) {
    if (dsf !== 1) {
      throw new Error("dsf=2 screenshots only show the top-left half of the pane in this ttyd/xterm build — see the harness header note");
    }
    Object.assign(this, { name, cwd, port, cols, rows, dsf, env, bootCmd, ready });
    this.tmux = new TmuxSession(`cap-${name}`, cols, rows);
    this.outDir = path.join(OUT_ROOT, name);
    this.framesDir = path.join(this.outDir, "frames");
    this.stillsDir = path.join(this.outDir, "stills");
    this.logLines = [];
  }
  log(msg) {
    const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
    this.logLines.push(line);
    console.log(`(${this.name}) ${line}`);
  }
  async start() {
    fs.mkdirSync(this.framesDir, { recursive: true });
    fs.mkdirSync(this.stillsDir, { recursive: true });

    const cmd = this.bootCmd || `bun ${path.join(UNOWN_ROOT, "bin", "unown")}`;
    await this.tmux.boot(this.cwd, cmd, {
      UNOWN_DISABLE_UPDATES: "1",
      NO_UPDATE_NOTIFIER: "1",
      TERM: "xterm-256color",
      // make harness-local tools (fd, ttyd) visible to the TUI so boot stays clean
      PATH: `${path.dirname(TTYD_BIN)}:${process.env.PATH || ""}`,
      ...this.env,
    });
    this.log("tmux session booted");

    // ttyd takes the command as separate argv words (no shell string) — execvp runs directly.
    // -I serves a patched index.html (zinc-950 page bg; build with make_ttyd_index.sh);
    // -t sets xterm options. dsf=1 + fontSize=30 → full pane visible at ~2x density.
    // NO page.route: any registered route makes playwright proxy the ws upgrade and break ttyd.
    this.ttyd = spawn(
      TTYD_BIN,
      [
        "-W",
        "-p",
        String(this.port),
        "-I",
        path.join(__dirname, "ttyd-index.html"),
        "-t",
        // canvas — the geometry-proven renderer at dsf=1 (see header note).
        // Known risk: the glyph atlas corrupted ONCE across ~3 scenario-hours
        // (a solid green block + a column of repeated tiles over real
        // content, mid long session). The stills audit + frames scanner
        // detect it; the remedy is a re-run, never an image edit.
        // (dom was measured dropping colored diff rows outright; webgl
        // mis-dropped content at dsf=2 and was not needed once dsf=1 works.)
        "rendererType=canvas",
        "-t",
        "fontFamily=JetBrains Mono",
        "-t",
        "fontSize=30",
        "-t",
        "cursorBlink=false",
        "-t",
        'theme={"background":"#09090b"}',
        "tmux",
        "attach",
        "-t",
        `cap-${this.name}`,
      ],
      {
        env: { ...this.tmux.env(), PATH: `${path.dirname(TMUX_BIN)}:${process.env.PATH}` },
        stdio: ["ignore", "ignore", "inherit"],
      },
    );
    for (let i = 0; i < 50; i++) {
      try {
        await sh("curl", ["-s", "--max-time", "1", `http://127.0.0.1:${this.port}/`]);
        break;
      } catch {
        await sleep(200);
      }
    }
    this.log(`ttyd up on :${this.port}`);

    this.browser = await PLAYWRIGHT.chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      viewport: { width: 1220, height: 720 },
      deviceScaleFactor: this.dsf,
    });
    this.page = await this.context.newPage();
    await this.page.goto(`http://127.0.0.1:${this.port}/`, { waitUntil: "load" });
    await sleep(1500);
    await this.autoFitGrid();
    await sleep(1000);
    this.log("chromium attached to ttyd");
    this.recorder = new FrameRecorder(this.page, this.framesDir);
    this.recorder.start(() => this.tmux.text());
    return this;
  }

  /** Resize the viewport until xterm's fitted grid equals the tmux pane (cols×rows). */
  async autoFitGrid(maxIters = 6) {
    let vw = 1220;
    let vh = 720;
    for (let i = 0; i < maxIters; i++) {
      const g = await this.page.evaluate(() => {
        const t = window.term || globalThis.term;
        const el = document.querySelector(".xterm");
        if (!t || !el) return null;
        // the grid actually lives in .xterm-screen (the .xterm element spans
        // the viewport, which would give a wrong row pitch)
        const scr = document.querySelector(".xterm-screen");
        const r = (scr || el).getBoundingClientRect();
        return { cols: t.cols, rows: t.rows, elW: r.width, elH: r.height, elTop: r.top, elLeft: r.left };
      });
      if (!g) throw new Error("autoFitGrid: no xterm handle");
      if (g.cols === this.cols && g.rows === this.rows) {
        this.log(`grid fitted: ${g.cols}x${g.rows} @ viewport ${vw}x${vh}`);
        // persist the measured grid geometry for the audit (pane row -> pixel band)
        try {
          fs.writeFileSync(
            path.join(this.outDir, "geometry.json"),
            JSON.stringify({ cols: g.cols, rows: g.rows, elTop: Math.round(g.elTop || 0), elLeft: Math.round(g.elLeft || 0), elW: Math.round(g.elW), elH: Math.round(g.elH), viewport: `${vw}x${vh}` }, null, 1),
          );
        } catch {}
        return;
      }
      const cellW = g.elW / g.cols;
      const cellH = g.elH / g.rows;
      vw = Math.round(vw + (this.cols - g.cols) * cellW);
      vh = Math.round(vh + (this.rows - g.rows) * cellH);
      await this.page.setViewportSize({ width: Math.max(200, vw), height: Math.max(120, vh) });
      await sleep(600);
    }
    this.log(`grid fit did not converge (last viewport ${vw}x${vh}) — continuing anyway`);
  }

  async text() {
    return this.tmux.text();
  }

  /** Run a shell command in the harness (not the TUI) — used for external state checks. */
  async exec(cmd, opts = {}) {
    return sh("bash", ["-lc", cmd], { timeout: opts.timeout || 30_000, ...opts });
  }

  /** Wait until an external predicate passes (checked via bash). */
  async waitForExternal({ check, timeout = 300_000, poll = 1000, desc = "external" }) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      let ok = false;
      try {
        ok = await check();
      } catch {}
      if (ok) return;
      await sleep(poll);
    }
    throw new Error(`waitForExternal timeout (${desc}) after ${timeout}ms`);
  }

  async wait({ include, exclude, mode = "all", timeout = 240_000, poll = 160, desc = "anchor" }, _deadline = null) {
    const inc = Array.isArray(include) ? include : include ? [include] : [];
    const exc = Array.isArray(exclude) ? exclude : exclude ? [exclude] : [];
    const deadline = _deadline ?? Date.now() + timeout;
    let last = "";
    while (Date.now() < deadline) {
      last = await this.tmux.text();
      const incOk = mode === "any" ? inc.some((s) => last.includes(s)) : inc.every((s) => last.includes(s));
      const excOk = exc.every((s) => !last.includes(s));
      if (incOk && excOk) return last;
      await sleep(poll);
    }
    const tail = last.split("\n").slice(-14).join("\n");
    throw new Error(`wait timeout (${desc}) after ${timeout}ms — anchors not found (mode=${mode}). Pane tail:\n${tail}`);
  }

  /** Wait until the TUI is ready (branded header + footer model + no spinner). */
  async waitReady(timeout = 90_000) {
    const ready = this.ready || { include: ["unown v"], desc: "TUI ready" };
    await this.wait({ ...ready, timeout, desc: ready.desc || "ready" });
    await this.linger(700);
  }

  async type(s, { cps = 28, chunk = 1 } = {}) {
    // tmux's command parser eats a standalone ";" argv element (it is the
    // command separator), so NEVER send a lone ";" — every piece must carry
    // at least one non-";" character.
    const pieces = [];
    let i = 0;
    while (i < s.length) {
      let piece = s.slice(i, i + Math.max(1, chunk));
      if (piece === ";") {
        if (pieces.length) {
          pieces[pieces.length - 1] += ";"; // ride with the previous piece
        } else {
          piece = s.slice(i, i + 2); // string starts with ";" — ride with the next
          pieces.push(piece);
          i += piece.length;
          continue;
        }
        i += 1;
        continue;
      }
      i += piece.length;
      pieces.push(piece);
    }
    for (const piece of pieces) {
      await this.tmux.sendLiteral(piece);
      if (cps > 0) await sleep(Math.round((piece.length / cps) * 1000));
    }
  }

  async key(k) {
    await this.tmux.sendKey(k);
  }

  async enter() {
    await this.tmux.sendKey("Enter");
  }

  async prompt(s, opts = {}) {
    await this.type(s, opts);
    await sleep(200);
    await this.enter();
  }

  async still(name) {
    // settle first: two consecutive identical pane captures (spinner chars
    // normalized away) so the screenshot and the pane dump describe the same
    // instant — mid-stream stills otherwise drift by rows and the audit
    // correctly flags rows "missing". Bounded at ~4s.
    try {
      const norm = (t) =>
        t
          .split("\n")
          // spinner + elapsed-chip masking: mid-turn stills otherwise never
          // "settle" (the chip ticks every second) and overshoot the beat
          .map((l) => l.replace(SPINNER_RE, "x").replace(/\b\d+:\d\d\b/g, "t"))
          .join("\n");
      let prev = norm(await this.tmux.text());
      for (let i = 0; i < 20; i++) {
        await sleep(200);
        const cur = norm(await this.tmux.text());
        if (cur === prev) break;
        prev = cur;
      }
    } catch {}
    // force a synchronous full repaint: both renderers can lag or stall on
    // dense erase/redraw streams (measured: the canvas once stayed on the
    // pre-/undo frame for seconds after the pane moved on). term.refresh()
    // repaints every row with zero stream side effects.
    try {
      await this.page.evaluate(() => {
        const t = window.term || globalThis.term;
        if (t && t.refresh) t.refresh(0, t.rows - 1);
      });
      await sleep(250);
    } catch {}
    // model-vs-pane sync check: under dense erase/redraw bursts the ttyd WS
    // can drop frames and the xterm model desyncs from the tmux pane for good
    // (measured: the canvas once kept showing the pre-/undo view). A page
    // reload reconnects and tmux redraws the full grid — clean resync plus a
    // fresh renderer state. One reload max, then accept.
    try {
      const norm = (t) =>
        t
          .split("\n")
          .map((l) => l.replace(SPINNER_RE, "x").replace(/\b\d+:\d\d\b/g, "t").replace(/\s+/g, " ").trim())
          .join("\n");
      const readBuffer = () =>
        this.page.evaluate(() => {
          const t = window.term || globalThis.term;
          const b = t.buffer.active;
          const out = [];
          // read the VISIBLE rows, not buffer rows 0..rows-1: the TUI is a
          // scrolling app (no alt-screen), so xterm accumulates scrollback and
          // getLine(0) is the TOP OF SCROLLBACK — comparing that against the
          // pane mismatched on every still and triggered a pointless reload.
          const base = typeof b.baseY === "number" ? b.baseY : b.length - t.rows;
          for (let i = 0; i < t.rows; i++) out.push((b.getLine(base + i)?.translateToString(true) || ""));
          return out.join("\n");
        });
      // beauty-2/3 keeps the pane in motion (spinner 80ms, m:ss chip 1s,
      // streaming text), so a single buffer-vs-pane compare races and fires
      // the reload on nearly every mid-turn still (and one reload mid-stream
      // once stalled the recorder ~30s). Compare twice with fresh reads: only
      // a PERSISTENT mismatch is a real desync worth a reload.
      let mismatch = true;
      for (let round = 0; round < 2 && mismatch; round++) {
        const [buf, pane] = await Promise.all([readBuffer(), this.tmux.text()]);
        mismatch = norm(pane).split("\n").some((l, i) => l !== norm(buf).split("\n")[i] || "");
        if (mismatch) await sleep(250);
      }
      for (let attempt = 0; attempt < 2 && mismatch; attempt++) {
        if (attempt === 0) {
          this.log("xterm buffer desynced from pane — reloading to resync");
          await this.page.reload({ waitUntil: "load" });
          await sleep(2000);
        }
        const [buf, pane] = await Promise.all([readBuffer(), this.tmux.text()]);
        mismatch = norm(pane).split("\n").some((l, i) => l !== norm(buf).split("\n")[i] || "");
      }
    } catch {}
    // paint flush: the dom renderer paints asynchronously — wait until the
    // rendered DOM actually contains the newest pane content (tail of the
    // last non-empty line), else the screenshot can show a stale repaint.
    // The canvas renderer keeps no glyph DOM (textContent is empty) — the
    // loop is dead weight there, so skip it instead of always burning 3s.
    try {
      const paneText = await this.tmux.text();
      const lines = paneText.split("\n").map((l) => l.replace(SPINNER_RE, "x").trim()).filter(Boolean);
      const sig = (lines[lines.length - 1] || "").replace(/[^A-Za-z0-9_%./()-]+/g, " ").slice(-24).trim();
      if (sig) {
        for (let i = 0; i < 15; i++) {
          const domText = await this.page.evaluate(() => (document.querySelector(".xterm")?.textContent || "").replace(/\s+/g, " "));
          if (!domText || domText.includes(sig)) break;
          await sleep(200);
        }
      }
    } catch {}
    const file = path.join(this.stillsDir, `${name}.png`);
    await this.page.screenshot({ path: file });
    // keep the pane state that produced this still for debugging
    try {
      const t = await this.tmux.text();
      this.logLines.push(`--- pane @still ${name} ---\n${t.split("\n").map((l, i) => `${String(i + 1).padStart(2)}|${l}`).join("\n")}\n--- end pane ---`);
    } catch {}
    this.log(`still → ${name}.png`);
    return file;
  }

  async linger(ms) {
    await this.recorder.dwell(ms);
  }

  async sleep(ms) {
    await sleep(ms);
  }

  async stop() {
    try { this.recorder && (await this.recorder.stop()); } catch {}
    try {
      this.recorder && this.recorder.writeMeta(path.join(this.outDir, "frames-meta.jsonl"));
    } catch {}
    try { await this.browser.close(); } catch {}
    try { this.ttyd && this.ttyd.kill("SIGTERM"); } catch {}
    await this.tmux.kill();
    fs.writeFileSync(path.join(this.outDir, "capture.log"), this.logLines.join("\n") + "\n");
    this.log(`stopped — ${this.recorder ? this.recorder.stats.frames + " frames" : "no frames"}`);
  }
}

/**
 * Run one scenario spec:
 *   { name, cwd, port, env, cols, rows, steps: [ {t:'waitReady'} | {t:'type',s} | {t:'prompt',s}
 *      | {t:'key',k} | {t:'wait',include,exclude,timeout,desc} | {t:'still',name}
 *      | {t:'linger',ms} | {t:'sleep',ms} | {t:'fn',fn} ] }
 * `fn` steps receive the CaptureSession.
 */
async function runScenario(spec) {
  const s = new CaptureSession(spec);
  const t0 = Date.now();
  // Graceful close on SIGTERM/SIGINT (timeout(1), Ctrl-C): the finally-block
  // alone is not enough — node exits on SIGTERM without unwinding it. This
  // keeps stills/frames/meta/capture.log intact when a run is time-boxed.
  const closing = { done: false };
  const onSignal = async (sig) => {
    if (closing.done) return;
    closing.done = true;
    try {
      s.log(`received ${sig} — closing capture gracefully`);
      await s.stop();
    } catch {}
    process.exit(0);
  };
  process.once("SIGTERM", () => { void onSignal("SIGTERM"); });
  process.once("SIGINT", () => { void onSignal("SIGINT"); });
  try {
    await s.start();
    for (const [i, step] of (spec.steps || []).entries()) {
      const d = `${i + 1}/${(spec.steps || []).length} ${step.t}${step.desc ? ` (${step.desc})` : ""}${step.name ? ` ${step.name}` : ""}${step.s ? ` ${String(step.s).slice(0, 60)}` : ""}`;
      s.log(`step ${d}`);
      if (step.t === "waitReady") await s.waitReady(step.timeout || 90_000);
      else if (step.t === "type") await s.type(step.s, step);
      else if (step.t === "prompt") await s.prompt(step.s, step);
      else if (step.t === "key") await s.key(step.k);
      else if (step.t === "enter") await s.enter();
      else if (step.t === "wait") await s.wait(step);
      else if (step.t === "still") await s.still(step.name);
      else if (step.t === "linger") await s.linger(step.ms || 1500);
      else if (step.t === "sleep") await sleep(step.ms || 500);
      else if (step.t === "fn") await step.fn(s);
      else throw new Error(`unknown step type ${step.t}`);
    }
  } finally {
    closing.done = true;
    await s.stop();
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(`[${spec.name}] done in ${secs}s`);
  return s;
}

module.exports = { runScenario, CaptureSession, TmuxSession, FrameRecorder, OUT_ROOT, UNOWN_ROOT };

if (require.main === module) {
  const scenName = process.argv[2];
  if (!scenName) {
    console.error("usage: node driver.js <scenario-file.js>");
    process.exit(2);
  }
  const spec = require(path.resolve(scenName));
  runScenario(typeof spec === "function" ? spec() : spec).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
