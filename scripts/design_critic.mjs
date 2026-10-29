#!/usr/bin/env node
/**
 * design_critic.mjs — the Website Excellence Round's self-critique driver.
 *
 * One command runs the whole critique loop against a PRODUCTION build of any
 * route: per-band + full-page screenshots (desktop 1440 and mobile 390), the
 * objective in-page audit (WCAG contrast on every visible text node, type-scale
 * fit, spacing-grid conformance, heading order, image alts, mobile overflow),
 * the cold-load core web vitals (FCP / LCP / CLS / TBT via buffered
 * PerformanceObservers installed at document start), and the VLM critique —
 * every screenshot scored 0-10 on seven axes by agnes-3.0-flash through the
 * llm-bridge, STRICT JSON, aggregated into one committed receipt.
 *
 * The receipt is the benchmark artifact (benchmarks/website-excellence-round/
 * critiques/*.json): a run without a receipt never counts, and a score without
 * a pixel ground-truth is an opinion — which is why the objective audit rides
 * along in the same receipt, not in a separate opinionated report.
 *
 * Usage:
 *   node scripts/design_critic.mjs --route / --label baseline
 *   node scripts/design_critic.mjs --route /cadenza --label iter1 --full-only
 *   node scripts/design_critic.mjs --route / --label quick --no-vlm   # audit only
 *   node scripts/design_critic.mjs --route / --label gate --enforce   # exit 1 on rubric fail
 *
 * Env:
 *   CRITIC_BASE_URL   skip the auto-boot and audit a running server instead
 *   CRITIC_VLM_URL    the OpenAI-compatible chat endpoint (default: the local
 *                     llm-bridge at http://127.0.0.1:3031/v1/chat/completions)
 *   CRITIC_VLM_MODEL  default agnes-3.0-flash (vision-capable)
 *   CRITIC_VLM_KEY    optional bearer token (the local bridge needs none)
 *   CRITIC_BOOT_PORT  port for the auto-booted standalone server (default 3211)
 *
 * Requires: `bun run build` first (the standalone server under .next/standalone)
 * and a chromium in the playwright cache. Shots land in
 * download/design-critic/<label>/ (gitignored); the receipt lands in
 * benchmarks/website-excellence-round/critiques/ (committed).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

/* ────────────────────────── flags ────────────────────────── */
function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1] : dflt;
}
const has = (name) => process.argv.includes(`--${name}`);
const ROUTE = arg("route", "/");
const LABEL = arg("label", "run");
const OUT_ROOT = arg("out", join(process.cwd(), "download", "design-critic", LABEL));
const RECEIPT_DIR = arg(
  "receipts",
  join(process.cwd(), "benchmarks", "website-excellence-round", "critiques"),
);
const FULL_ONLY = has("full-only");
const NO_VLM = has("no-vlm");
const ENFORCE = has("enforce");
const FILE = arg("file", ""); // a local HTML file (the calibration lane: file:// URL)
const BOOT_PORT = Number(process.env.CRITIC_BOOT_PORT ?? 3211);
const BASE = process.env.CRITIC_BASE_URL ?? `http://127.0.0.1:${BOOT_PORT}`;
const VLM_URL = process.env.CRITIC_VLM_URL ?? "http://127.0.0.1:3031/v1/chat/completions";
const VLM_MODEL = process.env.CRITIC_VLM_MODEL ?? "agnes-3.0-flash";
const VLM_KEY = process.env.CRITIC_VLM_KEY ?? "";

/* ─────────────────── playwright resolution (house pattern) ─────────────────── */
const PW_CANDIDATES = [
  process.env.PLAYWRIGHT_MODULE,
  join(process.cwd(), "download", ".pwtools", "node_modules", "playwright", "index.mjs"),
  "playwright",
].filter(Boolean);
let chromium = null;
for (const c of PW_CANDIDATES) {
  try {
    const absolute = c.startsWith("/") || /^[A-Za-z]:[\\/]/.test(c);
    const mod = await import(/^[a-z]+:/i.test(c) || !absolute ? c : pathToFileURL(c).href);
    chromium = mod.chromium;
    break;
  } catch { /* next candidate */ }
}
if (!chromium) {
  console.error("playwright not resolvable — run `bun add playwright` in download/.pwtools/");
  process.exit(1);
}

/* ────────────────── the standalone server (auto-boot) ────────────────── */
const STANDALONE = join(process.cwd(), ".next", "standalone", "server.js");
let server = null;
async function bootServer() {
  if (FILE || process.env.CRITIC_BASE_URL) return; // caller owns the URL (or a file)
  if (!existsSync(STANDALONE)) {
    console.error("no production build — run `bun run build` first");
    process.exit(1);
  }
  server = spawn(process.execPath, [STANDALONE], {
    env: { ...process.env, PORT: String(BOOT_PORT), HOSTNAME: "127.0.0.1" },
    stdio: "ignore",
    detached: false,
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(1500) });
      if (r.ok || r.status < 500) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`standalone server never came up on ${BASE}`);
  process.exit(1);
}
async function stopServer() {
  if (server) { try { server.kill("SIGTERM"); } catch { /* already gone */ } }
}

/* ────────────────── the rubric (thresholds, cited) ──────────────────
 * rubric.md in the round's directory is the contract; these defaults must
 * stay in sync with it. Design axes: VLM mean 0-10 must be >= 7. Objective
 * gates are zero-tolerance where the standard is a law (WCAG AA), budgetary
 * where the research gives a range (type-scale count, grid conformance). */
const RUBRIC = {
  vlmAxes: ["hierarchy", "typography", "spacing", "color", "alignment", "density", "overall"],
  vlmFloor: 7,
  contrastViolations: 0,      // WCAG 2.2 AA — the law (SC 1.4.3 / 1.4.11)
  fontSizesMax: 8,            // elite pages: ~7 text sizes on a page
  offGridMaxPct: 15,          // % of spacing values off the 4px grid
  headingSkips: 0,            // h1 → h2 → h3, no jumps
  missingAlts: 0,
  mobileOverflow: 0,          // no horizontal scroll on 390px
  fcpMs: 1800, lcpMs: 2500, cls: 0.1, tbtMs: 200, // the Core Web Vitals "good" band
};

/* ────────────────── the objective audit (in-page) ──────────────────
 * Injected at document start so the vitals observers catch everything. */
const INIT = `
window.__vitals = { fcp: 0, lcp: 0, cls: 0, tbt: 0 };
try {
  new PerformanceObserver((l) => {
    const es = l.getEntries();
    if (es.length) window.__vitals.lcp = es[es.length - 1].renderTime || es[es.length - 1].startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value;
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__vitals.tbt += Math.max(0, e.duration - 50);
  }).observe({ type: "longtask", buffered: true });
  window.addEventListener("load", () => setTimeout(() => {
    const paint = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
    if (paint) window.__vitals.fcp = paint.startTime;
  }, 0));
} catch {}`;

const AUDIT = `(() => {
  const parse = (s) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(s || "");
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const bgOf = (el) => {
    let n = el;
    while (n && n instanceof Element) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a >= 0.95) return c;
      n = n.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 }; // html default resolves elsewhere; guarded below
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const contrast = [];
  const fontSizes = new Map();
  const spacing = [];
  const offenders = { contrast: [], fonts: [], spacing: [] };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seenEls = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode;
    if (!t.textContent || !t.textContent.trim()) continue;
    const el = t.parentElement;
    if (!el || seenEls.has(el) || !visible(el)) continue;
    seenEls.add(el);
    const s = getComputedStyle(el);
    if (s.fontSize && s.fontSize !== "0px") fontSizes.set(s.fontSize, (fontSizes.get(s.fontSize) || 0) + 1);
    const fg = parse(s.color);
    const bg = bgOf(el);
    if (!fg || !bg) continue;
    const px = parseFloat(s.fontSize);
    const bold = parseInt(s.fontWeight, 10) >= 700;
    const large = px >= 24 || (px >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const r = ratio(fg, bg);
    if (r < need) {
      offenders.contrast.push({
        text: t.textContent.trim().slice(0, 40), ratio: +r.toFixed(2), need,
        size: s.fontSize, weight: s.fontWeight,
        selector: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\s+/)[0] : ""),
      });
    }
    contrast.push(r);
  }
  for (const el of document.body.querySelectorAll("section,div,header,footer,article,main")) {
    const s = getComputedStyle(el);
    for (const k of ["margin-top", "margin-bottom", "padding-top", "padding-bottom"]) {
      const v = parseFloat(s[k]);
      if (v > 0) { spacing.push(v); if (Math.round(v) % 4 !== 0) offenders.spacing.push({ selector: el.tagName.toLowerCase(), prop: k, value: s[k] }); }
    }
  }
  const headings = [...document.body.querySelectorAll("h1,h2,h3,h4,h5,h6")]
    .filter(visible).map((h) => +h.tagName[1]);
  const skips = [];
  for (let i = 1; i < headings.length; i++) {
    if (headings[i] - headings[i - 1] > 1) skips.push({ from: "h" + headings[i - 1], to: "h" + headings[i] });
  }
  const imgs = [...document.images];
  const missingAlts = imgs.filter((i) => visible(i) && !i.hasAttribute("alt")).length;
  return {
    contrast: { min: contrast.length ? +Math.min(...contrast).toFixed(2) : null, mean: contrast.length ? +(contrast.reduce((a, b) => a + b, 0) / contrast.length).toFixed(2) : null, violations: offenders.contrast },
    type: { distinctSizes: fontSizes.size, sizes: [...fontSizes.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])).map(([s, n]) => ({ size: s, uses: n })) },
    spacing: { samples: spacing.length, offGrid: offenders.spacing.length, offGridPct: spacing.length ? +(100 * offenders.spacing.length / spacing.length).toFixed(1) : 0 },
    headings: { order: headings, skips },
    images: { total: imgs.length, missingAlts },
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`;

/* ────────────────── the VLM critique ────────────────── */
const AXES = RUBRIC.vlmAxes.join(", ");
const VLM_PROMPT = (ctx) =>
  `You are a senior product designer doing a rigorous design critique — the same reviewer persona elite studios (Linear, Stripe, Vercel in-house teams) would recognize: exacting, specific, never polite at the expense of the work. This is ${ctx} of a website for "Unown", an open-source self-improving coding agent (brand: hand-drawn Unown-alphabet glyphs, warm paper/ink/gold, Game-Boy-inspired; dark-first). Judge against the elite baseline: clear visual hierarchy, a disciplined type scale, consistent spacing rhythm, WCAG-legible contrast, intentional alignment, calm density, purposeful motion.\n` +
  `Respond with ONLY a JSON object, no markdown fence, no preamble:\n` +
  `{"scores":{"hierarchy":0-10,"typography":0-10,"spacing":0-10,"color":0-10,"alignment":0-10,"density":0-10,"overall":0-10},"defects":["up to 5 concrete, visually-grounded defects with where"],"improvements":["the 3 highest-leverage fixes, max 15 words each"]}`;

function extractJson(text) {
  if (!text) return null;
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

async function vlmCritique(pngPath, ctx) {
  const buf = await sharp(pngPath).resize({ width: 1400, withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
  const body = {
    model: VLM_MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: VLM_PROMPT(ctx) },
        { type: "image_url", image_url: { url: `data:image/png;base64,${buf.toString("base64")}` } },
      ],
    }],
    max_tokens: 700,
  };
  const headers = { "Content-Type": "application/json" };
  if (VLM_KEY) headers.Authorization = `Bearer ${VLM_KEY}`;
  const resp = await fetch(VLM_URL, { method: "POST", headers, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`vlm ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const json = await resp.json();
  const text = json.choices?.[0]?.message?.content ?? "";
  let out = extractJson(text);
  if (!out) {
    // one retry with a sterner demand — the iterative-refinement recipe, one step
    const resp2 = await fetch(VLM_URL, {
      method: "POST", headers,
      body: JSON.stringify({ ...body, messages: [{ role: "user", content: [
        { type: "text", text: `${VLM_PROMPT(ctx)}\nYour previous answer was not valid JSON. Output ONLY the JSON object.` },
        { type: "image_url", image_url: { url: `data:image/png;base64,${buf.toString("base64")}` } },
      ] }] }),
    });
    if (resp2.ok) out = extractJson((await resp2.json()).choices?.[0]?.message?.content ?? "");
  }
  if (!out) throw new Error("vlm returned unparseable JSON twice");
  return out;
}

/* ────────────────── capture + audit per viewport ────────────────── */
async function capture(page, url, device, outDir, slug, scheme = "dark") {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: scheme }); // the settled state; the SCHEME the page ships dark-first (the F12-class finding: playwright defaults to light, and a dark-first page must be audited in BOTH schemes — the landing's contrast_audit contract)
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  await new Promise((r) => setTimeout(r, 900));         // let reveals settle (base-state-finished rule)

  const audit = await page.evaluate(AUDIT);
  const vitals = await page.evaluate(() => window.__vitals);
  const shots = [];

  const suffix = scheme === "dark" ? "" : "-light";
  const full = join(outDir, `${slug}-${device}${suffix}-full.png`);
  await page.screenshot({ path: full, fullPage: true });
  shots.push({ shot: `${slug}-${device}${suffix}-full.png`, kind: "full", device, scheme });

  if (!FULL_ONLY && scheme === "dark") {
    const bands = await page.$$eval("main > section, main > header, main > footer, body > section", (els) =>
      els.map((el, i) => {
        const r = el.getBoundingClientRect();
        const head = el.querySelector("h1,h2,h3");
        return { i, id: el.id || null, label: head ? head.textContent.trim().slice(0, 48) : `band-${i}`, top: r.top + window.scrollY, height: r.height };
      }).filter((b) => b.height > 80),
    );
    for (const b of bands) {
      await page.evaluate((top) => window.scrollTo(0, top), b.top);
      await new Promise((r) => setTimeout(r, 350));
      const name = `${slug}-${device}-band${String(b.i).padStart(2, "0")}.png`;
      await page.screenshot({ path: join(outDir, name) }); // viewport shot: the band as a visitor sees it
      shots.push({ shot: name, kind: "band", device, scheme: "dark", label: b.label });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  return { audit, vitals, shots };
}

/* ────────────────── main ────────────────── */
const t0 = Date.now();
await bootServer();
const slug = ROUTE === "/" ? "root" : ROUTE.replaceAll("/", "-").replace(/^-|-$/g, "");
const outDir = join(OUT_ROOT, slug);
mkdirSync(outDir, { recursive: true });
mkdirSync(RECEIPT_DIR, { recursive: true });

const url = FILE ? pathToFileURL(FILE).href : `${BASE}${ROUTE}`;
const browser = await chromium.launch();
const results = { desktop: null, mobile: null };

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.addInitScript(INIT);
  results.desktop = await capture(desktop, url, "desktop", outDir, slug, "dark");
  // the light-scheme twin (full-page + audit only — the page ships dark-first, but the landing contract audits both and so does the rubric)
  const desktopLight = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktopLight.addInitScript(INIT);
  const lightShots = await capture(desktopLight, url, "desktop", outDir, slug, "light");
  results.desktopLight = { audit: lightShots.audit, vitals: lightShots.vitals, shots: [] };
  results.desktop.shots.push(...lightShots.shots);
  await desktop.close();
  await desktopLight.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.addInitScript(INIT);
  results.mobile = await capture(mobile, url, "mobile", outDir, slug, "dark");
  await mobile.close();
} finally {
  await browser.close();
  await stopServer();
}

/* VLM critique */
const critiques = [];
if (!NO_VLM) {
  const allShots = [...results.desktop.shots, ...results.mobile.shots];
  for (const s of allShots) {
    const ctx = `a ${s.device} viewport ${s.kind} screenshot${s.label ? ` of the "${s.label}" section` : ""}`;
    try {
      const c = await vlmCritique(join(outDir, s.shot), ctx);
      critiques.push({ shot: s.shot, device: s.device, kind: s.kind, label: s.label ?? null, ...c });
      process.stdout.write(".");
    } catch (e) {
      critiques.push({ shot: s.shot, device: s.device, kind: s.kind, label: s.label ?? null, error: e.message });
      process.stdout.write("x");
    }
  }
  process.stdout.write("\n");
}

/* aggregate */
const axisMeans = {};
for (const axis of RUBRIC.vlmAxes) {
  const vals = critiques.filter((c) => c.scores && typeof c.scores[axis] === "number").map((c) => c.scores[axis]);
  axisMeans[axis] = vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null;
}
const vlmFailAxes = Object.entries(axisMeans)
  .filter(([k, v]) => v !== null && v < RUBRIC.vlmFloor).map(([k, v]) => `${k} ${v}<${RUBRIC.vlmFloor}`);
const d = results.desktop.audit, m = results.mobile.audit, dl = results.desktopLight.audit;
const gates = {
  contrastViolations: { value: d.contrast.violations.length + m.contrast.violations.length + dl.contrast.violations.length, max: RUBRIC.contrastViolations, pass: d.contrast.violations.length + m.contrast.violations.length + dl.contrast.violations.length <= RUBRIC.contrastViolations },
  fontSizes: { value: d.type.distinctSizes, max: RUBRIC.fontSizesMax, pass: d.type.distinctSizes <= RUBRIC.fontSizesMax },
  offGridPct: { value: d.spacing.offGridPct, max: RUBRIC.offGridMaxPct, pass: d.spacing.offGridPct <= RUBRIC.offGridMaxPct },
  headingSkips: { value: d.headings.skips.length, max: RUBRIC.headingSkips, pass: d.headings.skips.length <= RUBRIC.headingSkips },
  missingAlts: { value: d.images.missingAlts + m.images.missingAlts, max: RUBRIC.missingAlts, pass: d.images.missingAlts + m.images.missingAlts <= RUBRIC.missingAlts },
  mobileOverflow: { value: m.overflowX, max: RUBRIC.mobileOverflow, pass: m.overflowX <= RUBRIC.mobileOverflow },
  fcpMs: { value: Math.round(results.desktop.vitals.fcp), max: RUBRIC.fcpMs, pass: results.desktop.vitals.fcp <= RUBRIC.fcpMs },
  lcpMs: { value: Math.round(results.desktop.vitals.lcp), max: RUBRIC.lcpMs, pass: results.desktop.vitals.lcp <= RUBRIC.lcpMs },
  cls: { value: +results.desktop.vitals.cls.toFixed(3), max: RUBRIC.cls, pass: results.desktop.vitals.cls <= RUBRIC.cls },
  tbtMs: { value: Math.round(results.desktop.vitals.tbt), max: RUBRIC.tbtMs, pass: results.desktop.vitals.tbt <= RUBRIC.tbtMs },
  vlmAxes: { value: axisMeans, floor: RUBRIC.vlmFloor, pass: vlmFailAxes.length === 0, failures: vlmFailAxes },
};
const passed = Object.values(gates).every((g) => g.pass);

const receipt = {
  schema: "website-excellence/critique/1",
  route: ROUTE, url, label: LABEL, file: FILE || undefined,
  generatedAt: new Date().toISOString(),
  rubric: RUBRIC,
  audit: { desktop: results.desktop.audit, desktopLight: results.desktopLight.audit, mobile: results.mobile.audit },
  vitals: { desktop: results.desktop.vitals, mobile: results.mobile.vitals },
  critiques,
  axisMeans,
  gates,
  passed,
  shotsDir: outDir,
  wallSeconds: +((Date.now() - t0) / 1000).toFixed(1),
};
const stamp = new Date().toISOString().replaceAll(/[-:]/g, "").slice(0, 15).replace("T", "-");
const receiptPath = join(RECEIPT_DIR, `${stamp}-${LABEL}-${slug}.json`);
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");

/* report */
console.log(`\ndesign critic — ${ROUTE} [${LABEL}]`);
console.log(`  contrast: min ${d.contrast.min} (desktop dark) / ${dl.contrast.min} (light) · violations ${gates.contrastViolations.value}`);
console.log(`  type: ${d.type.distinctSizes} distinct sizes · spacing: ${d.spacing.offGridPct}% off-grid (${d.spacing.samples} samples)`);
console.log(`  headings: ${d.headings.skips.length} skips · alts missing: ${gates.missingAlts.value} · mobile overflow: ${m.overflowX}px`);
console.log(`  vitals (desktop, localhost): FCP ${gates.fcpMs.value}ms · LCP ${gates.lcpMs.value}ms · CLS ${gates.cls.value} · TBT ${gates.tbtMs.value}ms`);
if (!NO_VLM) console.log(`  vlm axes: ${RUBRIC.vlmAxes.map((a) => `${a} ${axisMeans[a] ?? "—"}`).join(" · ")}`);
console.log(`  rubric: ${passed ? "PASS" : "FAIL"} · receipt: ${receiptPath} · ${receipt.wallSeconds}s`);
if (ENFORCE && !passed) process.exit(1);
