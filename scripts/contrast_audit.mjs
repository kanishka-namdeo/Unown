#!/usr/bin/env node
/**
 * contrast_audit.mjs — WCAG AA contrast, measured rather than eyeballed.
 *
 * The landing contract says "Contrast is a contract, not a vibe" and pins
 * every text token to 4.5:1 against the surface it lands on. That was checked
 * by hand in `globals.css` once and never again, which is how `faint` shipped
 * at 3.16:1 for a while. This walks the REAL rendered page instead: every
 * visible text node, its computed colour, and the composited background
 * actually behind it — so a token that is fine on `canvas` but lands on
 * `bg-glow` in one section is caught where it is, not where the token table
 * says it is.
 *
 * Usage:
 *   LANDING_SHOTS_URL=http://localhost:3111 bun scripts/contrast_audit.mjs
 *
 * Output: printed table + download/landing/contrast_report.json.
 * Exits non-zero on any failure.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const BASE = process.env.LANDING_SHOTS_URL ?? "http://localhost:3111";
const OUT = join(process.cwd(), "download", "landing");

/* ---------- resolve playwright (scratch install first) ---------- */
const PW_CANDIDATES = [
  process.env.PLAYWRIGHT_MODULE,
  join(process.cwd(), "download", ".pwtools", "node_modules", "playwright", "index.mjs"),
  "playwright",
].filter(Boolean);

let chromium = null;
for (const c of PW_CANDIDATES) {
  try {
    const mod = await import(/^[a-z]+:/i.test(c) ? c : pathToFileURL(c).href);
    chromium = mod.chromium;
    break;
  } catch {
    /* next candidate */
  }
}
if (!chromium) {
  console.error("playwright not resolvable — run `bun add playwright` in download/.pwtools/");
  process.exit(1);
}

function findChrome() {
  const roots = [
    join(homedir(), "AppData", "Local", "ms-playwright"),
    join(homedir(), ".cache", "ms-playwright"),
  ];
  const subs = ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux64/chrome", "chrome-linux/chrome"];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root)) {
      if (!d.startsWith("chromium-")) continue;
      for (const sub of subs) {
        const p = join(root, d, sub);
        if (existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

/**
 * Runs in the page. Returns one row per visible text node that fails AA.
 *
 * Colour normalisation goes through a 2D canvas: `ctx.fillStyle = <anything
 * the browser understands>` then reading it back yields a plain `rgba(...)`.
 * That is the only cheap way to resolve `color-mix()` — which is exactly what
 * Tailwind's `/80` opacity modifiers compile to — without reimplementing the
 * CSS colour space pipeline.
 */
const AUDIT = () => {
  const ctx = document.createElement("canvas").getContext("2d");
  // Reading `ctx.fillStyle` back is a trap: Chromium serialises opaque
  // colours as HEX (`#e9f6d9`), so an rgb() regex silently matches nothing
  // and every node is skipped — the audit then "passes" by scanning zero
  // nodes. Painting a pixel and reading the bytes works for every form the
  // computed style can take: lab(), color-mix(), hex, named, rgba().
  const norm = (css) => {
    if (!css || !CSS.supports("color", css)) return null;
    try {
      ctx.fillStyle = "#000000";
      ctx.fillStyle = css; // falls back to the previous value if unparsable
      // Clear first: source-over onto a leftover pixel corrupts every
      // translucent colour (bg-glow/10 would composite over the previous
      // text colour instead of transparency).
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    } catch {
      return null;
    }
  };

  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  // Composite everything behind an element, stopping at the first opaque layer.
  const backdrop = (el) => {
    let stack = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const c = norm(cs.backgroundColor);
      if (c && c.a > 0) {
        stack.push(c);
        if (c.a >= 1) break;
      }
    }
    let base = stack.length && stack[stack.length - 1].a >= 1 ? stack.pop() : { r: 255, g: 255, b: 255, a: 1 };
    let out = base;
    for (let i = stack.length - 1; i >= 0; i--) out = over(stack[i], out);
    return out;
  };

  const rows = [];
  const all = [];
  let scanned = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    if (!text.trim()) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript" || tag === "title") continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    // Text hidden for screen readers or off-screen is still "on the page".
    if (rect.bottom < 0 || rect.top > document.documentElement.scrollHeight) continue;

    const fgRaw = norm(cs.color);
    if (!fgRaw) continue;
    scanned += 1;
    const bg = backdrop(el);
    const fg = fgRaw.a >= 1 ? fgRaw : over(fgRaw, bg);
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const bold = weight >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;
    const got = ratio(fg, bg);
    all.push({
      text: text.trim().replace(/\s+/g, " ").slice(0, 64),
      selector:
        tag +
        (el.className && typeof el.className === "string"
          ? "." + el.className.trim().split(/\s+/).slice(0, 6).join(".")
          : ""),
      color: cs.color,
      background: `rgb(${Math.round(bg.r)} ${Math.round(bg.g)} ${Math.round(bg.b)})`,
      ratio: Number(got.toFixed(2)),
      fontSize: size,
      fontWeight: weight,
    });
    if (got + 0.005 < need) {
      rows.push({
        text: text.trim().replace(/\s+/g, " ").slice(0, 64),
        selector:
          tag +
          (el.className && typeof el.className === "string"
            ? "." + el.className.trim().split(/\s+/).slice(0, 6).join(".")
            : ""),
        fontSize: size,
        fontWeight: weight,
        color: cs.color,
        background: `rgb(${Math.round(bg.r)} ${Math.round(bg.g)} ${Math.round(bg.b)})`,
        ratio: Number(got.toFixed(2)),
        required: need,
        tokens: (typeof el.className === "string" ? el.className : "").match(
          /(?:text|bg|border)-(?:canvas|panel|line|ink|dim|faint|glow|amber|poke)[^\s]*/g,
        ),
      });
    }
  }
  return {
    scanned,
    failures: rows,
    worst: all.sort((a, b) => a.ratio - b.ratio).slice(0, 15),
  };
};

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", "--font-render-hinting=none"],
});

let failures = [];
let worst = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 982 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  // Scroll the whole page so every lazy/scroll-revealed section is rendered.
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += 700) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
  });
  await new Promise((r) => setTimeout(r, 800));
  const audit = await page.evaluate(AUDIT);
  failures = audit.failures;
  worst = audit.worst ?? [];
  console.log(`scanned ${audit.scanned} visible text nodes on ${BASE}`);
  console.log("lowest ratios:");
  for (const w of audit.worst) {
    console.log(`  ${String(w.ratio).padStart(5)}:1  ${w.color} on ${w.background}  ${w.fontSize}px  ${w.selector}`);
    console.log(`         "${w.text}"`);
  }
  await ctx.close();
} finally {
  await browser.close();
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "contrast_report.json"), JSON.stringify({ base: BASE, checkedAt: new Date().toISOString(), failures, worst }, null, 2));

if (!failures.length) {
  console.log(`PASS  no WCAG AA contrast failures on ${BASE}`);
} else {
  console.log(`FAIL  ${failures.length} text nodes below AA on ${BASE}\n`);
  for (const f of failures) {
    console.log(`  ${f.ratio}:1 (needs ${f.required})  ${f.color} on ${f.background}  ${f.fontSize}px/${f.fontWeight}`);
    console.log(`      ${f.selector}`);
    console.log(`      tokens: ${(f.tokens ?? []).join(" ") || "(none)"}`);
    console.log(`      "${f.text}"\n`);
  }
  console.log("report -> download/landing/contrast_report.json");
  process.exitCode = 1;
}
