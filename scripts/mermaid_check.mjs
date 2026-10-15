#!/usr/bin/env node
/**
 * mermaid_check.mjs — validates + locally renders the two README Mermaid
 * diagrams (architecture + self-improvement loop) exactly as GitHub will
 * render them: mermaid@11, DEFAULT theme, no custom themeVariables.
 *
 * Usage: bun scripts/mermaid_check.mjs
 * Output: download/brand/mermaid-arch.png, download/brand/mermaid-loop.png
 * Exit code non-zero if parse fails.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";

// ---- The diagram sources (kept verbatim in sync with README.md) ----
export const ARCH_MERMAID = `flowchart TB
    subgraph project["your project"]
        TUI["unown terminal agent<br>(pi TUI + guardrail hooks)"]
        PM("project memory<br>.unown/memory/project.md")
    end
    subgraph dash["dashboard · :3000"]
        UI["Next.js mission control<br>7 tabs · live SSE feed"]
    end
    subgraph engine["self-learning engine :3030"]
        ENG["memory · harness · dream<br>router · sandbox"]
        SB["bubblewrap sandbox<br>fresh per run"]
        DB[("SQLite<br>runs · cycles<br>dreams · memory")]
    end
    subgraph bridge["llm-bridge :3031"]
        BR["model routing + auth<br>SSE passthrough · backoff"]
    end
    LLM["OpenAI-compatible upstream<br>kimi-k2.5 · qwen3.7-plus · qwen3.6-plus"]

    TUI -- "session notes" --> ENG
    UI -- "REST + SSE" --> ENG
    ENG -- "agent runs" --> SB
    SB -- "chat" --> BR
    BR -- "routed" --> LLM
    ENG -- "records" --> DB
    ENG -.-> PM`;

export const LOOP_MERMAID = `flowchart TB
    A(["harness cycle"]) --> B["run benchmark task<br>in a fresh sandbox"]
    B --> C{"pass?"}
    C -- "yes" --> G{"capability eval?"}
    G -- "yes" --> GR(["graduate into<br>the regression suite"])
    G -- "no" --> Z(["done · sweep regressions"])
    C -- "no" --> D["mine the failure transcript<br>for candidate memory rules"]
    D --> E["candidate run<br>same task · patched memory"]
    E --> F{"verified twice?"}
    F -- "no" --> D2(["discard patch · re-mine"])
    F -- "yes" --> G2["ship patch to memory"]
    G2 --> H["regression sweep +<br>retention auto-unship"]
    H --> Z
    S(["suite saturated?<br>task-mint job"]) -. "mint harder tasks<br>from failures / curriculum" .-> B
    Z -. "next cycle" .-> A`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
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
<div class="diagram" id="d1"><pre class="mermaid">
${ARCH_MERMAID}
</pre></div>
<div class="diagram" id="d2"><pre class="mermaid">
${LOOP_MERMAID}
</pre></div>
<div id="status">pending</div>
<script>
  const params = new URLSearchParams(location.search);
  window.__setStatus = (s) => { document.getElementById("status").textContent = s; };
  mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
  (async () => {
    try {
      await mermaid.parse(${JSON.stringify(ARCH_MERMAID)});
      await mermaid.parse(${JSON.stringify(LOOP_MERMAID)});
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

const htmlPath = join(process.cwd(), "download", "brand", "mermaid_check.html");
writeFileSync(htmlPath, html);

// ---- render ----
const PW = join(process.cwd(), "download", ".pwtools", "node_modules", "playwright", "index.mjs");
const { chromium } = await import(pathToFileURL(PW).href);

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

try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.getElementById("status").textContent !== "pending", null, { timeout: 30000 });
  const status = await page.locator("#status").textContent();
  if (status !== "ok") {
    console.error("MERMAID PARSE FAILED:", status);
    process.exit(1);
  }
  // Resize viewport so each SVG's true rendered size fits (skill iron rule).
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
  await page.locator("#d1").screenshot({ path: join(process.cwd(), "download", "brand", "mermaid-arch.png") });
  await page.locator("#d2").screenshot({ path: join(process.cwd(), "download", "brand", "mermaid-loop.png") });
  console.log("mermaid parse OK — rendered mermaid-arch.png + mermaid-loop.png");
  await ctx.close();
} finally {
  await browser.close();
}
