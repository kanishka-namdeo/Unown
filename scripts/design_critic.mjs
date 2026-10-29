#!/usr/bin/env node
/**
 * design_critic.mjs — the Website Excellence program's self-critique driver.
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
 * The second excellence round (2026-10-30) adds the CRAFT axes — the six
 * research-derived checks from docs/website-excellence-research-2.md, each a
 * rule the nine-site sweep verified in live production CSS and phrased so a
 * tool can enforce it: the weight census (ceiling 600, the Attio/Apple/
 * Framer weight discipline), the tracking-vs-size curve (Apple's per-size
 * optical tuning), the neutral-hue spread (Anthropic's tinted-ivory law:
 * grays cluster around one hue), the accent census (one accent + one
 * interactive variant — Apple #0071e3, Raycast #ff6363, Anthropic clay), the
 * keyframe property whitelist (compositing/paint-only; layout properties and
 * `transition: all` are violations; a prefers-reduced-motion guard must exist
 * wherever keyframes do), and the breakpoint census (elite ships 2–6).
 *
 * The receipt is the benchmark artifact: a run without a receipt never counts,
 * and a score without a pixel ground-truth is an opinion — which is why the
 * objective audit rides along in the same receipt, not in a separate
 * opinionated report. Receipts land in benchmarks/website-excellence-round-2/
 * critiques/ (schema 2 — the round-1 dir keeps its committed schema-1 set for
 * the encore drift gate).
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
  join(process.cwd(), "benchmarks", "website-excellence-round-2", "critiques"),
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
  /* -- the craft axes (round 2; every threshold cited in website-excellence-research-2.md) -- */
  weightCeiling: 600,         // the Attio census (313 medium vs 1 bold); Apple/Framer/Airbnb never exceed 600 on marketing
  weightSetMax: 4,            // Apple 3, Framer 2, Airbnb 3, Notion 4 - closed sets
  trackingOffendersMax: 3,    // the Apple curve: negative >=40px, ~0 at 17-40px, <= +0.02em below; budget for one-off labels
  neutralHueSpreadMax: 30,    // degrees - the tinted-ivory law: tinted grays cluster around one hue (circular stddev)
  accentClustersMax: 2,       // one accent + one interactive variant (Apple, Raycast, Anthropic, Framer)
  animLayoutPropsMax: 0,      // compositing/paint only - layout props and `all` are violations (Vercel guideline, web.dev)
  breakpointsMax: 8,          // Framer 2, Apple 3, Airbnb 5, Notion 6 - plus framework overhead
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
  // craft collectors (round 2)
  const weights = new Map();
  const trackingCombos = new Map();  // distinct off-curve size+tracking pairs (a census, not a node count)
  const tintedHues = [];      // hues of tinted grays (the neutral-hue spread)
  const accentHues = [];      // hues of saturated interactive colors (the accent census)
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
    // craft: the weight census + the tracking-vs-size curve (research-2 rules 1-2)
    const wNum = parseInt(s.fontWeight, 10);
    if (Number.isFinite(wNum)) weights.set(wNum, (weights.get(wNum) || 0) + 1);
    const px2 = parseFloat(s.fontSize);
    if (px2 > 0) {
      const lsRaw = s.letterSpacing;
      const em = lsRaw === "normal" ? 0 : parseFloat(lsRaw) / px2;
      if (Number.isFinite(em)) {
        let ok;
        if (px2 >= 40) ok = em <= 0.002;                       // display: negative expected (Apple -.005em at 56px, Notion -.048em at 96px)
        else if (px2 >= 17) ok = em >= -0.03 && em <= 0.02;    // display-adjacent body: tightening allowed toward the display curve (Apple 0 at 32-40px, Notion -.035em at 54px, +.012em at 19-28px)
        else ok = em <= 0.2;                                   // label: tracked small caps allowed (Raycast +.1-.3px, Airbnb .04em, the GBA pixel labels .14-.18em)
        if (!ok) { const k = Math.round(px2) + "px@" + em.toFixed(3) + "em"; trackingCombos.set(k, (trackingCombos.get(k) || 0) + 1); }
      }
    }
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
  // craft: the color census — every visible element contributes its opaque
  // background and text colors; low-saturation ones feed the neutral-hue
  // spread (the tinted-ivory law), saturated colors on INTERACTIVE elements
  // feed the accent census (the one-accent law).
  const toHsl = (c) => {
    const mx = Math.max(c.r, c.g, c.b) / 255, mn = Math.min(c.r, c.g, c.b) / 255;
    const l = (mx + mn) / 2, d = mx - mn;
    if (d === 0) return { h: null, s: 0, l };
    const r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h;
    if (mx === r / 255) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (mx === g / 255) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h * 60, s: sat, l };
  };
  const interactive = document.body.querySelectorAll('a, button, [role="button"], summary, input, select, [tabindex]:not([tabindex="-1"])');
  for (const el of document.body.querySelectorAll("*")) {
    if (!visible(el)) continue;
    const s2 = getComputedStyle(el);
    for (const col of [parse(s2.backgroundColor), parse(s2.color)]) {
      if (!col || col.a < 0.9) continue;
      const hsl = toHsl(col);
      if (hsl.h === null) continue;           // pure gray: clusters trivially, never an offender
      if (hsl.s >= 0.02 && hsl.s <= 0.30 && hsl.l >= 0.06 && hsl.l <= 0.94) tintedHues.push(hsl.h);
    }
  }
  for (const el of interactive) {
    if (!visible(el)) continue;
    const col = parse(getComputedStyle(el).color);
    if (!col || col.a < 0.9) continue;
    const hsl = toHsl(col);
    if (hsl.h !== null && hsl.s > 0.25) accentHues.push(hsl.h);
  }
  // craft: the stylesheet census — keyframe/transition property whitelist,
  // breakpoint count, the reduced-motion guard (research-2 rules 7-9)
  const animatedProps = new Set();
  let hasKeyframes = false, hasPrm = false;
  const bpSet = new Set();
  /* Whitelisted animated properties: compositing (transform/opacity/filter +
     Tailwind v4's individual translate/scale/rotate), paint (colors, shadow,
     clip-path, motion-path), discrete steps (display/overlay/pointer-events -
     the layer-swap pattern), and the height exception for the radix accordion
     keyframes (the platform-sanctioned pattern until interpolate-size is
     universal - tw-animate-css's accordion-down/up, driven by the
     --radix-accordion-content-height var). */
  const ANIM_OK = new Set(["transform", "translate", "scale", "rotate", "opacity", "filter", "backdrop-filter", "-webkit-backdrop-filter", "color", "background-color", "background-position", "background-size", "border-color", "outline-color", "text-decoration-color", "box-shadow", "fill", "stroke", "clip-path", "offset-distance", "offset-path", "view-timeline", "scroll-timeline", "animation-timeline", "transition-behavior", "content-visibility", "display", "overlay", "pointer-events", "height"]);
  const walkRules = (rules) => {
    for (const rule of rules) {
      if (!rule) continue;
      if (rule.type === 7 /* KEYFRAMES_RULE */) {
        hasKeyframes = true;
        for (const fr of rule.cssRules) for (let i = 0; i < fr.style.length; i++) animatedProps.add(fr.style.item(i));
      } else if (rule.type === 4 /* MEDIA_RULE */) {
        const mq = rule.conditionText || "";
        if (mq.includes("prefers-reduced-motion")) hasPrm = true;
        if (/width/.test(mq)) for (const m of mq.matchAll(/([0-9.]+)(px|r?em)(?![a-z])/g)) bpSet.add(m[1] + m[2]);
        if (rule.cssRules) walkRules(rule.cssRules);
      } else if (rule.style) {
        const tp = rule.style.getPropertyValue("transition-property");
        if (tp && tp !== "none") for (const p of tp.split(",").map((x) => x.trim())) animatedProps.add(p);
        if (rule.cssRules) walkRules(rule.cssRules); // supports/nested
      } else if (rule.cssRules) {
        walkRules(rule.cssRules);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; } // cross-origin: skip
    if (rules) walkRules(rules);
  }
  const animViolations = [...animatedProps].filter((p) => p !== "all" ? !ANIM_OK.has(p) && !p.startsWith("--") : false);
  const animAll = animatedProps.has("all");
  const headings = [...document.body.querySelectorAll("h1,h2,h3,h4,h5,h6")]
    .filter(visible).map((h) => +h.tagName[1]);
  const skips = [];
  for (let i = 1; i < headings.length; i++) {
    if (headings[i] - headings[i - 1] > 1) skips.push({ from: "h" + headings[i - 1], to: "h" + headings[i] });
  }
  const imgs = [...document.images];
  const missingAlts = imgs.filter((i) => visible(i) && !i.hasAttribute("alt")).length;
  // craft: circular stats for the tinted-neutral hues (degrees)
  const circ = (degs) => {
    if (degs.length < 3) return { n: degs.length, meanDeg: null, stdDeg: null };
    const rad = degs.map((d) => (d * Math.PI) / 180);
    const x = rad.reduce((a, r) => a + Math.cos(r), 0) / rad.length;
    const y = rad.reduce((a, r) => a + Math.sin(r), 0) / rad.length;
    const r = Math.sqrt(x * x + y * y);
    const mean = (Math.atan2(y, x) * 180) / Math.PI;
    const std = Math.sqrt(-2 * Math.log(Math.max(r, 1e-9))) * (180 / Math.PI);
    return { n: degs.length, meanDeg: +mean.toFixed(1), stdDeg: +std.toFixed(1) };
  };
  const hueClusters = (degs, bucket = 30) => {
    if (!degs.length) return { clusters: 0, buckets: [] };
    const bins = new Map();
    for (const d of degs) {
      const b = Math.floor((((d % 360) + 360) % 360) / bucket);
      bins.set(b, (bins.get(b) || 0) + 1);
    }
    // wrap: the first and last bucket are the same hue family
    let clusters = [...bins.entries()].filter(([, n]) => n >= 2).length;
    if (bins.has(0) && bins.has(Math.floor(360 / bucket) - 1) && bins.get(0) + bins.get(Math.floor(360 / bucket) - 1) >= 2 && (bins.get(0) < 2 || bins.get(Math.floor(360 / bucket) - 1) < 2)) clusters = Math.max(0, clusters - 1);
    return { clusters, buckets: [...bins.entries()].map(([b, n]) => ({ from: b * bucket, count: n })) };
  };
  return {
    contrast: { min: contrast.length ? +Math.min(...contrast).toFixed(2) : null, mean: contrast.length ? +(contrast.reduce((a, b) => a + b, 0) / contrast.length).toFixed(2) : null, violations: offenders.contrast },
    type: { distinctSizes: fontSizes.size, sizes: [...fontSizes.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])).map(([s, n]) => ({ size: s, uses: n })) },
    spacing: { samples: spacing.length, offGrid: offenders.spacing.length, offGridPct: spacing.length ? +(100 * offenders.spacing.length / spacing.length).toFixed(1) : 0 },
    headings: { order: headings, skips },
    images: { total: imgs.length, missingAlts },
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    craft: {
      weights: { distinct: weights.size, max: weights.size ? Math.max(...weights.keys()) : null, census: [...weights.entries()].sort((a, b) => a[0] - b[0]).map(([w, n]) => ({ weight: w, uses: n })) },
      tracking: { offenders: [...trackingCombos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([combo, n]) => ({ combo, uses: n })), total: trackingCombos.size },
      neutralHue: circ(tintedHues),
      accents: { ...hueClusters(accentHues), sampled: accentHues.length },
      anim: { props: [...animatedProps].sort(), layoutViolations: animViolations, usesAll: animAll, hasKeyframes, hasReducedMotionGuard: hasPrm },
      breakpoints: { count: bpSet.size, values: [...bpSet].sort((a, b) => parseFloat(a) - parseFloat(b)) },
    },
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
  /* the craft gates (round 2; desktop dark is the canonical measure, light scheme
     joins where the rule is scheme-independent, mobile joins the anim census) */
  weightCeiling: (() => { const v = Math.max(d.craft.weights.max ?? 0, dl.craft.weights.max ?? 0); return { value: v, max: RUBRIC.weightCeiling, pass: v <= RUBRIC.weightCeiling }; })(),
  weightSet: (() => { const v = Math.max(d.craft.weights.distinct, dl.craft.weights.distinct); return { value: v, max: RUBRIC.weightSetMax, pass: v <= RUBRIC.weightSetMax }; })(),
  trackingCurve: { value: d.craft.tracking.total + dl.craft.tracking.total, max: RUBRIC.trackingOffendersMax, pass: d.craft.tracking.total + dl.craft.tracking.total <= RUBRIC.trackingOffendersMax },
  neutralHueSpread: (() => { const c = d.craft.neutralHue.n >= 3 ? d.craft.neutralHue : dl.craft.neutralHue; return { value: c.stdDeg, max: RUBRIC.neutralHueSpreadMax, sampled: c.n, pass: c.stdDeg === null || c.stdDeg <= RUBRIC.neutralHueSpreadMax }; })(),
  accentClusters: (() => { const a = d.craft.accents; return { value: a.clusters, max: RUBRIC.accentClustersMax, sampled: a.sampled, pass: a.sampled < 3 || a.clusters <= RUBRIC.accentClustersMax }; })(),
  animLayoutProps: (() => { const v = d.craft.anim.layoutViolations.length + m.craft.anim.layoutViolations.length + (d.craft.anim.usesAll ? 1 : 0) + (m.craft.anim.usesAll ? 1 : 0); return { value: v, max: RUBRIC.animLayoutPropsMax, props: [...new Set([...d.craft.anim.layoutViolations, ...m.craft.anim.layoutViolations])], pass: v <= RUBRIC.animLayoutPropsMax }; })(),
  reducedMotionGuard: { value: d.craft.anim.hasKeyframes ? d.craft.anim.hasReducedMotionGuard : null, max: 1, pass: !d.craft.anim.hasKeyframes || d.craft.anim.hasReducedMotionGuard },
  breakpoints: { value: d.craft.breakpoints.count, max: RUBRIC.breakpointsMax, pass: d.craft.breakpoints.count <= RUBRIC.breakpointsMax },
};
const passed = Object.values(gates).every((g) => g.pass);

const receipt = {
  schema: "website-excellence/critique/2",
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
console.log(`  craft: weights ${d.craft.weights.census.map((w) => `${w.weight}x${w.uses}`).join("/")} (max ${gates.weightCeiling.value}) · tracking offenders ${gates.trackingCurve.value} · neutral hue ${d.craft.neutralHue.stdDeg ?? "—"}deg/${d.craft.neutralHue.n} · accent clusters ${gates.accentClusters.value}`);
console.log(`  anim: ${d.craft.anim.layoutViolations.length + m.craft.anim.layoutViolations.length} layout props${d.craft.anim.usesAll ? " + transition:all" : ""} · prm guard ${gates.reducedMotionGuard.value} · breakpoints ${d.craft.breakpoints.count}`);
console.log(`  rubric: ${passed ? "PASS" : "FAIL"} · receipt: ${receiptPath} · ${receipt.wallSeconds}s`);
if (ENFORCE && !passed) process.exit(1);
