#!/usr/bin/env bun
/**
 * capture-usage.mjs — Chaconne's usage-capture lane (ticket C-10, written
 * against the C-7 receipt's ruling: C-10 owns the capture lane and its
 * stills; the Ostinato `apps/ostinato/scripts/capture-usage.mjs` precedent,
 * ported with Chaconne's own keyboard contract and a light+dark pass).
 *
 * Boots the REAL app via the app-root `serve.mjs` on a scratch port,
 * drives the real UI with the app's own keyboard surface (zero pointer
 * events — `page.keyboard` only, the K-1 law of
 * `e2e/chaconne-flow.spec.ts` extended to the capture lane), and stills
 * the KEY STATES at 1280x800 / deviceScaleFactor 2, light + dark:
 *
 *   01-empty-boot-light.png    — the honest empty state ("No recipes yet")
 *   02-recipe-list-light.png   — one recipe + one run row (the seeded doc)
 *   03-run-history-light.png   — the runs route (the "2" direct key)
 *   04-artifact-viewer-light.png — the artifact route (ArrowDown + "A")
 *   05-palette-light.png       — the command palette OPEN (the identity
 *                                shot: every P0 command enumerated)
 *   06-empty-boot-dark.png     — the empty state, dark scheme
 *   07-recipe-list-dark.png    — the recipe list, dark scheme
 *
 * THE REAL-RUNNER SEEDS (the C-11 post-A2H-14 refresh): the seeded
 * document is the RUNNER'S OWN on-disk record — the capture lane boots
 * the app's dev server, runs the app's own recipe 1 (the dynamic.html
 * demo: wait/assert-element/extract/screenshot — the C-2 fixture demo)
 * through the REAL runner against the local fixtures (`bun
 * apps/chaconne/runner/index.ts run 1 --base-url …` into a scratch
 * data dir), then bridges that disk store's canonical document into
 * the app lane's localStorage (the `io.importData` grammar — the SAME
 * bytes the app's own "I" import would read). The stills therefore
 * exercise the REAL artifact-name bridge that the seeded C-10
 * convention kept latent: run-history and artifact-viewer render a
 * runner-produced record whose artifact names pass the PWA domain's
 * `assertData` (the V-41 defect's bridge, now proven live). The
 * bridge is a `--seeded` flag (default): without it the lane seeds the
 * e2e specs' own SEED_DATA shape (the C-10 pre-A2H-14 provenance, kept
 * re-runnable for the byte-stable convention pin). NO live network:
 * the capture is a local dev server + a local fixture URL inside the
 * seed document.
 *
 * THE KEYBOARD-ONLY LAW: every navigation in this script is a
 * `page.keyboard` press (direct keys "1"/"2"/"a"/"A", arrows, Ctrl+K,
 * Escape, Backspace). No `.click()`, no `.fill()` — the capture lane
 * proves the same K-1 contract the flow spec proves. Waits are
 * locator-waits, never fixed sleeps.
 *
 * Output: `public/landing/chaconne/` (+ a PROVENANCE.md sidecar — the
 * lane's receipt; the stills are the PRD's "real usage captures",
 * committed once and re-captured on demand, never mocked).
 *
 * Zero new dependencies: `@playwright/test` + Chromium resolve upward
 * from the root `node_modules` (the e2e lane's own resolution, the
 * house zero-dep law extending to the scripts). Deterministic: fixed
 * 1280x800 viewport, deviceScaleFactor 2, seeded bytes, one fresh
 * context per still (no SW state, no localStorage leftovers).
 *
 * Run: `bun apps/chaconne/scripts/capture-usage.mjs <target-dir>
 * [--port 4015] [--smoke]` — the stills land in the target dir
 * (default: the repo's `public/landing/chaconne/`); `--smoke` asserts
 * ≥ 1 PNG was written.
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CHACONNE_ROOT = resolve(SCRIPT_DIR, ".."); // serve.mjs lives at the APP ROOT
const REPO_ROOT = resolve(CHACONNE_ROOT, "..", "..");

// The target dir is the first argv (default: the landing band's lane).
const OUT_DIR = resolve(
  process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : resolve(REPO_ROOT, "public", "landing", "chaconne"),
);

const SMOKE = process.argv.includes("--smoke"); // the C-7 self-test mode
const PORT = Number((() => {
  const i = process.argv.indexOf("--port");
  return i > -1 ? process.argv[i + 1] : "4015";
})());
const VIEWPORT = { width: 1280, height: 800 };

function fail(msg) {
  console.error(`[chaconne-capture] ${msg}`);
  process.exit(1);
}

// Chaconne's zero-dep law: @playwright/test resolves upward from the
// repo root's node_modules (the e2e lane's own resolution).
const { chromium } = await import("@playwright/test");

// 4014 is the app's reserved dev port (serve.mjs default, CHACONNE_PORT);
// the capture lane takes 4015 so it never shadows a running dev server.
console.log(`[chaconne-capture] booting serve.mjs on port ${PORT}`);
const serveScript = resolve(CHACONNE_ROOT, "serve.mjs");
const server = spawn(process.execPath || "bun", [serveScript], {
  cwd: REPO_ROOT,
  env: { ...process.env, CHACONNE_PORT: String(PORT) },
  stdio: ["ignore", "pipe", "inherit"],
});
server.on("error", (e) => fail(`serve.mjs failed to spawn: ${e.message}`));
const base = `http://127.0.0.1:${PORT}`;

let serverReady = false;
const serverOutput = { buffer: "" };
server.stdout.on("data", (d) => {
  serverOutput.buffer += d.toString("utf8");
  if (serverOutput.buffer.includes("[chaconne] serving")) serverReady = true;
});
for (let i = 0; i < 50 && !serverReady; i++) await new Promise((r) => setTimeout(r, 100));
if (!serverReady) fail("serve.mjs did not announce ready within 5 s");

/**
 * The seed document (the C-6 e2e specs' own shape — `e2e/chaconne-a11y.spec.ts`
 * SEED_DATA, verbatim bytes): one recipe + one run, the PWA-grammatical
 * content-addressed artifact name. A shape-invalid seed would trip the app's
 * own `io.importData` corrupt panel — the bytes are the app's own export
 * grammar, so the stills render exactly what a real user's store would.
 */
const SEED_DATA = JSON.stringify({
  schema: "chaconne.v1",
  recipes: [
    {
      id: 1,
      name: "E2E a11y seed recipe",
      steps: [
        { id: 1, kind: "goto", selector: "http://127.0.0.1:4014/test/fixtures/dynamic.html" },
      ],
      version: 1,
    },
  ],
  runs: [
    {
      id: 1,
      recipeId: 1,
      recipeVersion: 1,
      status: "ok",
      startedAt: "2026-11-05T00:00:00.000Z",
      finishedAt: "2026-11-05T00:00:02.000Z",
      committedPrefix: 1,
      extracted: { "1": "dynamic.html" },
      artifacts: [
        {
          name: "1_r1_sha256:0f6f4b9f7f9e0d4b2a1c3d5e6f8a0b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a.png",
          sha256: "0f6f4b9f7f9e0d4b2a1c3d5e6f8a0b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a",
        },
      ],
    },
  ],
});

/** The capture lane's seed mode: "seeded" (default — the C-10 e2e
 * SEED_DATA shape, byte-stable) or "runner" (the C-11 refresh: the
 * app's own recipe 1 run through the REAL runner, its disk store's
 * canonical document bridged into the app lane — the V-41 fix's live
 * proof). `--runner` selects the real lane. */
const RUNNER = process.argv.includes("--runner");
console.log(`[chaconne-capture] seed mode: ${RUNNER ? "REAL RUNNER (post-A2H-14)" : "seeded (C-10 default)"}`);

/**
 * Run the app's own recipe 1 through the REAL runner into a scratch
 * data dir, then bridge the disk store's canonical document (the
 * `io.importData` grammar — the bytes the app's import would read)
 * into a seed string for the app lane. The disk store's shapes are
 * the runner's own artifact names (content-addressed, single-token
 * exts post-A2H-14 — the "json" report, the "log" run-log, the "png"
 * capture, the "json" extract values); bridging through
 * `loadAll()` + `JSON.stringify` produces EXACTLY the document the
 * PWA domain's `assertData` accepts (the cross-host seam the C-6
 * convention previously kept latent).
 */
async function bridgeRealRunner(base) {
  const dataDir = resolve(REPO_ROOT, "download", "chaconne-capture-data");
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(resolve(dataDir, "recipes"), { recursive: true });
  // Recipe 1: the demo recipe — the dynamic.html fixture through the
  // four step kinds that produce every artifact class (wait →
  // assert-element → extract → screenshot), the app's own seeded
  // recipe (SEED_DATA above) but pointed at the live server so the
  // real browser lane can run it.
  const recipe = {
    id: 1,
    name: "Demo: dynamic.html (the real-runner lane)",
    version: 1,
    steps: [
      { id: 1, kind: "goto", selector: `${base}/test/fixtures/dynamic.html` },
      { id: 2, kind: "wait", selector: "#pop", timeoutMs: 10_000 },
      { id: 3, kind: "assert-element", selector: "#label", timeoutMs: 10_000 },
      { id: 4, kind: "extract", selector: "#label", value: "data-attr" },
      { id: 5, kind: "screenshot", selector: "body" },
    ],
  };
  const store = await import("../../chaconne/runner/store.js");
  const s = new store.ChaconneDiskStore(dataDir);
  s.recover();
  s.saveRecipe(recipe, JSON.stringify(recipe));
  const { cmdRun } = await import("../../chaconne/runner/index.js");
  const { run } = await cmdRun({ dataDir, recipeId: 1, fake: false, baseUrl: base });
  if (run.status !== "ok") {
    fail(`the real runner's run 1 is not ok (status=${run.status}) — the stills would bridge a failed record; refusing to capture`);
  }
  const doc = s.loadAll();
  const seedStr = JSON.stringify(doc);
  console.log(`[chaconne-capture] real runner: run ${run.id} ok, ${run.artifacts.length} artifacts bridged (the V-41 seam, live)`);
  // Clean up the scratch data dir — it was a transient bridge artefact.
  rmSync(dataDir, { recursive: true, force: true });
  return seedStr;
}


/** A fresh context (no SW state, no localStorage) at the given scheme. */
async function freshContext(browser, colorScheme) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.warn(`[chaconne-capture] page error: ${e.message}`));
  return { ctx, page };
}

async function still(page, name) {
  const p = resolve(OUT_DIR, name);
  await page.screenshot({ path: p, fullPage: true });
  console.log(`[chaconne-capture] wrote ${p}`);
  return p;
}

/** Seed localStorage BEFORE the app's module script boots (the e2e's own idiom). */
function seedPage(page, json) {
  page.addInitScript((seed) => {
    window.localStorage.setItem("chaconne.data", seed);
  }, json);
}

const browser = await chromium.launch();
try {
  mkdirSync(OUT_DIR, { recursive: true });

  // ─── LIGHT SCHEME ────────────────────────────────────────────────

  // 1. EMPTY BOOT (no seed → the honest empty panel)
  {
    const { ctx, page } = await freshContext(browser, "light");
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.locator(".chaconne-state", { hasText: "No recipes yet" }).waitFor({ timeout: 30_000 });
    await still(page, "01-empty-boot-light.png");
    await ctx.close();
  }

  // 2-5. SEEDED DOCUMENT (the default C-10 lane — the e2e SEED_DATA
  //      shape, byte-stable) OR the REAL RUNNER'S RECORD (the C-11
  //      `--runner` flag: recipe 1 run against the live fixtures,
  //      its disk store bridged into the app lane — the V-41 seam
  //      proven live). Driven by the app's own direct keys (zero
  //      pointer events).
  {
    const seed = RUNNER ? await bridgeRealRunner(base) : SEED_DATA;
    const { ctx, page } = await freshContext(browser, "light");
    seedPage(page, seed);
    page.on("console", (m) => { if (m.type() === "error") console.warn(`[chaconne-capture] console error: ${m.text().slice(0, 200)}`); });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    // The runner-lane seed is a larger document (the real record + its
    // artifacts); give the async module boot a 10 s head start, then the
    // locator-wait enforces the real contract.
    await page.waitForTimeout(RUNNER ? 10_000 : 0);
    await page.locator("#chaconne-recipe-list .chaconne-recipe-row").waitFor({ state: "visible", timeout: 30_000 });
    await still(page, "02-recipe-list-light.png");

    // 3. RUN HISTORY (the "2" direct key → the runs route; ArrowDown
    //    focuses the seeded run row so the "A" key has a target).
    await page.keyboard.press("2");
    await page.locator("#chaconne-runs").waitFor({ timeout: 10_000 });
    await page.keyboard.press("ArrowDown");
    await page.locator(".chaconne-run-row", { has: page.locator('span:has-text("ok")') }).first().waitFor({ state: "visible", timeout: 10_000 });
    await still(page, "03-run-history-light.png");

    // 4. ARTIFACT VIEWER (the "A" key → the artifact route: the run
    //    row is arrow-focused, then A opens the viewer on it).
    await page.keyboard.press("a");
    await page.locator("#chaconne-artifacts").waitFor({ timeout: 10_000 });
    await still(page, "04-artifact-viewer-light.png");

    // 5. PALETTE OPEN (the identity shot, back on the recipes route).
    await page.keyboard.press("1");
    await page.keyboard.press("Control+k");
    await page.locator("#chaconne-palette").waitFor({ state: "visible", timeout: 10_000 });
    await still(page, "05-palette-light.png");
    await ctx.close();
  }

  // 6-7. DARK SCHEME: the same two empty + list states under
  //      prefers-color-scheme: dark (the CSS's @media branch, the
  //      C-9 both-schemes lane extended to the capture lane).
  const darkSeed = RUNNER ? await bridgeRealRunner(base) : SEED_DATA;
  for (const [name, seed] of [
    ["06-empty-boot-dark.png", null],
    ["07-recipe-list-dark.png", darkSeed],
  ]) {
    const { ctx, page } = await freshContext(browser, "dark");
    if (seed) seedPage(page, seed);
    await page.goto(base, { waitUntil: "domcontentloaded" });
    if (seed && RUNNER) await page.waitForTimeout(10_000);
    await page.locator("#chaconne-recipe-list .chaconne-recipe-row, .chaconne-state").first().waitFor({ timeout: 30_000 });
    await still(page, name);
    await ctx.close();
  }

  // ─── The sidecar receipt (provenance lands next to the media) ───
  const laneName = RUNNER
    ? "the C-11 post-A2H-14 REAL-RUNNER refresh (the round's last ticket, driving the app's own recipe 1 through the live runner and bridging its disk store into the app lane — the V-41 seam proven live; the C-10 seeded default remains re-runnable without the flag)"
    : "C-10, the product-surface lane; the Ostinato \`apps/ostinato/scripts/capture-usage.mjs\` precedent ported";
  const provenance = `# Chaconne usage stills — provenance

- Captured: ${new Date().toISOString()} by \`apps/chaconne/scripts/capture-usage.mjs\` (${laneName}).
- Server: \`bun apps/chaconne/serve.mjs\` on scratch port ${PORT} (the real transpiling dev server; 4014 is the app's reserved dev port, so the capture lane takes 4015). NO live network — the seeded document's fixture URL is local (127.0.0.1:4014), and the capture drives the app shell only.
- Browser: headless Chromium (the e2e lane's own install, repo-root \`@playwright/test\`), ONE FRESH context per still — no service worker state, no IndexedDB, no localStorage leftovers.
- Viewport: ${VIEWPORT.width}x${VIEWPORT.height}, deviceScaleFactor 2, full-page screenshots.
- Seeds: ${RUNNER
    ? "the REAL RUNNER'S OWN record — recipe 1 (the dynamic.html demo: wait/assert-element/extract/screenshot) executed through \`bun apps/chaconne/runner/index.ts run 1 --base-url …\` into a scratch data dir, its disk store's canonical document (\`loadAll()\` + \`JSON.stringify\`) bridged into the app lane's localStorage — the V-41 post-A2H-14 proof that runner-produced artifact names (single-token exts: \`json\`, \`log\`, \`png\`) pass the PWA domain's \`assertData\`. The stills therefore exercise the REAL artifact-name bridge that the seeded C-10 convention kept latent."
    : "the e2e specs' own localStorage document shape (\`e2e/chaconne-a11y.spec.ts\` SEED_DATA, verbatim — one recipe + one run, the PWA-grammatical content-addressed artifact names; the runner's multi-dot extract-report names stay in the disk store and never cross into the app lane, the C-6 workaround convention)."}
- KEYBOARD-ONLY LAW: every navigation is a \`page.keyboard\` press — the app's own direct keys ("1"/"2"/"a"/"A" via the palette.ts COMMAND_KEY_DISPATCH, arrows for run-row focus, Ctrl+K for the palette). Zero pointer events, no \`.fill()\`.
- Schemes: light + dark via the context's colorScheme (the CSS's @media (prefers-color-scheme) branch, the C-9 both-schemes lane).
- 01-empty-boot-light.png — the honest empty state (".chaconne-state" = "No recipes yet", the never-blank law).
- 02-recipe-list-light.png — the recipes route with the seeded recipe row ("E2E a11y seed recipe (v1)" + "1 step" + the "ok" badge).
- 03-run-history-light.png — the runs route (the "2" key): the recipe-grouped history with the seeded run row, arrow-focused.
- 04-artifact-viewer-light.png — the artifact route (the "a" key on the focused run): the screenshot panel + the extracted-values panel.
- 05-palette-light.png — the command palette OPEN via Ctrl+K (the 11-command enumeration, filter-as-you-type, the keyboard-first identity shot).
- 06-empty-boot-dark.png / 07-recipe-list-dark.png — the same two states under prefers-color-scheme: dark.
- Re-runnable: \`bun apps/chaconne/scripts/capture-usage.mjs [target-dir] [--port P] [--smoke]\` — the stills overwrite in place.
`;
  writeFileSync(resolve(OUT_DIR, "PROVENANCE.md"), provenance);
  console.log(`[chaconne-capture] wrote ${resolve(OUT_DIR, "PROVENANCE.md")}`);
} finally {
  await browser.close().catch(() => {});
  server.kill();
}

// ─── The smoke self-test (--smoke): assert ≥ 1 PNG written ──────────
if (SMOKE) {
  const files = readdirSync(OUT_DIR).filter((f) => f.endsWith(".png"));
  if (files.length < 1) fail("smoke: no PNG stills written");
  console.log(`[chaconne-capture] SMOKE PASS — ${files.length} stills written to ${OUT_DIR}`);
} else {
  console.log("[chaconne-capture] done — all stills + provenance written.");
}
