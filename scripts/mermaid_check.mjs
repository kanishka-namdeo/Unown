#!/usr/bin/env node
/**
 * mermaid_check.mjs — CI gate 15 (docs/testing-strategy.md §6): README Mermaid
 * byte-identity.
 *
 * What the gate proves, in order:
 *   1. SOURCE OF TRUTH — the diagram sources are EXTRACTED from README.md
 *      itself (no hand-synced copies anywhere in this script), so what is
 *      validated is exactly what GitHub renders.
 *   2. PARSE — every fenced ```mermaid block in README.md parses cleanly
 *      under mermaid 11.16.1 — the version github.com renders as of
 *      2026-08 (github/orgs/community/discussions/70672; recheck quarterly
 *      via a ```mermaid info block). GitHub rejects unparseable blocks and
 *      renders them as code text — this gate fails before that can ship.
 *   3. BYTE IDENTITY — the SAME source, rendered twice in two INDEPENDENT
 *      fresh browser contexts, must produce byte-identical PNG screenshots
 *      (sha256). Two determinism pins make this true and keep it true:
 *      deterministicIds (stable SVG ids) and a SEEDED Math.random — mermaid
 *      11.16.1's shape generators sample Math.random (38 call sites in the
 *      dist), and without the pin the README's stadium-shaped nodes wobble
 *      by up to 30px of path control points between otherwise identical
 *      renders. Found live by this gate's first run; pinned since. github.com
 *      renders UNPINNED — its own stadium nodes wobble per reload — which is
 *      exactly why the local identity claim needs the pin.
 *
 * Mermaid is VENDORED at scripts/vendor/mermaid-11.16.1.min.js and its
 * sha256 is pinned below — no CDN at run time, so the gate is hermetic and
 * immune to upstream drift. Refresh recipe: when GitHub's version moves
 * (check with ```mermaid info), download the new dist, update VENDORED_SHA,
 * re-run, commit both.
 *
 * Identity is scoped honestly: GitHub renders client-side with the viewer's
 * system fonts, so cross-machine byte-identity with github.com is not a
 * claim anyone can make. The claim is: same-source determinism under the
 * pinned renderer, plus parse parity with the version GitHub runs.
 *
 * Usage:  bun scripts/mermaid_check.mjs
 * Output: download/brand/mermaid-<slug>.png per diagram (context A render)
 *         download/brand/mermaid-receipt.json
 * Exit:   non-zero on extraction / integrity / parse / render / identity
 *         failure.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const MERMAID_VERSION = "11.16.1";
const VENDORED = join(process.cwd(), "scripts", "vendor", `mermaid-${MERMAID_VERSION}.min.js`);
const VENDORED_SHA = "18327bef70d96fb505fe7287d9f6a7362ebf07ff6576ddfaffb1a06f3e1a2954";
const README = join(process.cwd(), "README.md");
const OUT = join(process.cwd(), "download", "brand");
mkdirSync(OUT, { recursive: true });

const fail = (msg) => {
  console.error(`FAIL ${msg}`);
  process.exit(1);
};

/* ---------- 1. vendored integrity ---------- */
if (!existsSync(VENDORED)) fail(`vendored mermaid missing: ${VENDORED}`);
const vendoredBytes = readFileSync(VENDORED);
const vendoredSha = createHash("sha256").update(vendoredBytes).digest("hex");
if (vendoredSha !== VENDORED_SHA) {
  fail(`vendored mermaid sha256 mismatch: expected ${VENDORED_SHA}, got ${vendoredSha} — the pin and the file disagree; one of them changed.`);
}

/* ---------- 2. extract the diagrams from README.md ---------- */
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "diagram";
const readme = readFileSync(README, "utf8");
const lines = readme.split(/\r?\n/);
const blocks = [];
let heading = "README";
for (let i = 0; i < lines.length; i++) {
  const h = lines[i].match(/^##\s+(.*)$/);
  if (h) heading = h[1].trim();
  if (lines[i].startsWith("```mermaid")) {
    const body = [];
    for (let j = i + 1; j < lines.length && !lines[j].startsWith("```"); j++) body.push(lines[j]);
    blocks.push({ heading, name: slug(heading), source: body.join("\n") });
  }
}
if (blocks.length === 0) fail("README.md contains no fenced ```mermaid blocks — the diagrams are gone or the fence syntax changed.");
console.log(`extracted ${blocks.length} mermaid block(s) from README.md: ${blocks.map((b) => `"${b.heading}"`).join(", ")}`);

/* ---------- 3. the render page (vendored mermaid, no network) ---------- */
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<script src="${pathToFileURL(VENDORED).href}"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    padding: 48px;
    display: flex; flex-direction: column; align-items: flex-start; gap: 64px;
  }
  .diagram { width: fit-content; min-width: 800px; }
  #status { position: fixed; top: 8px; left: 8px; font: 12px monospace; }
</style>
</head>
<body>
${blocks.map((b, i) => `<div class="diagram" id="d${i}"><pre class="mermaid">
${b.source}
</pre></div>`).join("\n")}
<div id="status">pending</div>
<script>
  // Determinism pin, part 2 — mermaid 11.16.1's shape generators (stadium /
  // rounded label containers, edge wobble) sample Math.random: 38 call sites
  // in the dist. Empirically verified on this repo's diagrams: UNPINNED,
  // consecutive renders of the loop diagram differ in 10/31 paths by up to
  // 30px of control points (the architecture diagram, which has no stadium
  // nodes, happens to be stable); PINNED, renders are byte-identical.
  // github.com renders UNPINNED, so its own stadium nodes wobble per reload —
  // which is exactly why the identity claim needs the pin locally.
  (() => {
    let s = 0x1d34ba5c;
    Math.random = () => {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  window.__setStatus = (s) => { document.getElementById("status").textContent = s; };
  mermaid.initialize({ startOnLoad: false, securityLevel: "loose", deterministicIds: true, deterministicIdSeed: "unown" });
  (async () => {
    try {
      for (const src of ${JSON.stringify(blocks.map((b) => b.source))}) await mermaid.parse(src);
      await mermaid.run({ nodes: document.querySelectorAll("pre.mermaid") });
      await document.fonts.ready;
      window.__setStatus("ok");
    } catch (e) {
      window.__setStatus("error: " + String(e).slice(0, 300));
    }
  })();
</script>
</body>
</html>`;
const htmlPath = join(OUT, "mermaid_check.html");
writeFileSync(htmlPath, html);

/* ---------- 4. resolve playwright (root devDependency first) ---------- */
const PW_CANDIDATES = [
  process.env.PLAYWRIGHT_MODULE,
  join(process.cwd(), "download", ".pwtools", "node_modules", "playwright", "index.mjs"),
  "playwright",
].filter(Boolean);
let chromium = null;
for (const c of PW_CANDIDATES) {
  try {
    // Absolute paths / URLs resolve via URL; bare specifiers ("playwright")
    // must stay bare so node resolves them from cwd's node_modules.
    const spec = /^[a-z]+:/i.test(c) ? c : c.startsWith("/") ? pathToFileURL(c).href : c;
    const mod = await import(spec);
    chromium = mod.chromium;
    break;
  } catch {
    /* next candidate */
  }
}
if (!chromium) fail("playwright not resolvable — is playwright@1.57 in root devDependencies?");

function findChrome() {
  const root = join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root)) {
    if (!d.startsWith("chromium-")) continue;
    for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const p = join(root, d, sub);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb", "--hide-scrollbars", "--font-render-hinting=none"],
});

/** One independent render pass: fresh context + page, returns per-diagram PNG buffers + SVG texts. */
async function renderPass(label) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.getElementById("status").textContent !== "pending", null, { timeout: 30000 });
  const status = await page.locator("#status").textContent();
  if (status !== "ok") fail(`pass ${label}: mermaid parse/render error — ${status}`);
  // Resize viewport so each SVG's true rendered size fits (no clipping at dsf 2).
  const need = await page.evaluate(() => {
    let w = 0, h = 0;
    for (const d of document.querySelectorAll(".diagram")) {
      const r = d.getBoundingClientRect();
      const svg = d.querySelector("svg");
      if (svg) {
        const s = svg.getBoundingClientRect();
        w = Math.max(w, s.width);
        h += s.height + 64;
      }
      w = Math.max(w, r.width);
    }
    return { w: Math.ceil(w + 120), h: Math.ceil(h + 160) };
  });
  await page.setViewportSize({ width: Math.max(1600, need.w), height: Math.max(1200, need.h) });
  await page.waitForTimeout(400);
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const buf = await page.locator(`#d${i}`).screenshot();
    const svg = await page.locator(`#d${i} svg`).innerHTML().catch(() => "");
    out.push({ png: buf, svg });
  }
  await ctx.close();
  return out;
}

try {
  const passA = await renderPass("A");
  const passB = await renderPass("B");

  const sha = (buf) => createHash("sha256").update(buf).digest("hex");
  const receipt = {
    gate: "mermaid byte-identity — docs/testing-strategy.md §6 gate 15",
    mermaidVersion: MERMAID_VERSION,
    vendored: { file: `scripts/vendor/mermaid-${MERMAID_VERSION}.min.js`, sha256: vendoredSha, bytes: statSync(VENDORED).size },
    method: "sources extracted from README.md; two independent fresh browser contexts; element screenshots at deviceScaleFactor 2; sha256 compared byte-for-byte",
    determinismPins: [
      "deterministicIds + deterministicIdSeed 'unown' (stable SVG ids)",
      "Math.random pinned to mulberry32 seed 0x1d34ba5c — mermaid 11.16.1 shape generators sample Math.random (38 call sites); unpinned, the loop diagram's stadium paths differ up to 30px between renders; pinned, byte-identical",
    ],
    diagrams: [],
  };

  let identical = true;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const pngA = passA[i].png;
    const pngB = passB[i].png;
    const shaA = sha(pngA);
    const shaB = sha(pngB);
    const svgIdentical = passA[i].svg === passB[i].svg;
    const file = join(OUT, `mermaid-${b.name}.png`);
    writeFileSync(file, pngA);
    const same = shaA === shaB;
    identical = identical && same;
    receipt.diagrams.push({
      heading: b.heading,
      sourceChars: b.source.length,
      png: `download/brand/mermaid-${b.name}.png`,
      bytes: pngA.length,
      sha256PassA: shaA,
      sha256PassB: shaB,
      pngByteIdentical: same,
      svgDomIdentical: svgIdentical,
    });
    console.log(
      `${same ? "IDENTICAL" : "DIFFERS  "}  mermaid-${b.name}.png  ${pngA.length} bytes  ${shaA.slice(0, 16)}…  (svg dom ${svgIdentical ? "identical" : "DIFFERS"})`,
    );
  }

  receipt.verdict = identical ? "byte-identical across two fresh contexts" : "NON-DETERMINISTIC RENDER";
  writeFileSync(join(OUT, "mermaid-receipt.json"), JSON.stringify(receipt, null, 2));
  if (!identical) fail("byte-identity violated — two renders of the same README source produced different PNGs; see receipt");
  console.log(`\nGATE 15 GREEN — ${blocks.length} diagram(s): parse OK under mermaid ${MERMAID_VERSION} (GitHub's version), byte-identical dual render.`);
  console.log(`receipt: download/brand/mermaid-receipt.json`);
} finally {
  await browser.close();
}
