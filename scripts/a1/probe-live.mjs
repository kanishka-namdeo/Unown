#!/usr/bin/env node
/**
 * probe-live — the H-23 standing live-loop instrument (operator lane).
 *
 * Rebuilt in-repo 2026-11-07 by the thirty-first lineage per the H-12
 * mandate pattern (the prior harness died with the operator-workspace
 * recycle; the F-6 checkpoint named it "the standing instrument" — an
 * instrument that is not committed does not stand).
 *
 * What it does (the F-6 receipt's instrument, reconstructed):
 *
 * - HARD-FAILS when the engine (:3030) is down or rejects the bearer
 *   (RULING 3 of the live spec — never a silent skip).
 * - Boots the fugue PWA on its own port (default 4016, the PLAN §5
 *   probe/capture port ruling) via `bun apps/fugue/serve.mjs`.
 * - Injects `window.__FUGUE_ENGINE__` BEFORE the app module runs
 *   (mechanism C — no token in served files).
 * - Drives the LIVE loop through the PWA's own UI: compose-create →
 *   the engine row → selection → palette run-now ×N → the history
 *   re-fetch → the cold boot.
 * - Instruments EVERYTHING the operator needs to split
 *   handler-wired / propagation-blocked / state-dead (the H-23
 *   split): network request/response pairs to the engine (status +
 *   body), console messages, page errors, and the DOM state at each
 *   observable boundary (does .fugue-run-row exist after the history
 *   200?).
 * - ALWAYS cleans up (DELETE) the routine it created.
 * - Emits a structured JSON report (stdout + --out file).
 *
 * Exit codes: 0 = the full loop observed green · 2 = a boundary
 * failed (the report names which) · 1 = harness error.
 *
 * Usage: node scripts/a1/probe-live.mjs [--out FILE] [--port 4016]
 *        [--engine http://127.0.0.1:3030] [--runs 1]
 * Env: UNOWN_HOME (engine.token discovery) or FUGUE_ENGINE_TOKEN.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const REPO = resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const OUT = flag("out", null);
const PORT = Number(flag("port", "4016"));
const ENGINE_URL = flag("engine", "http://127.0.0.1:3030");
const RUNS = Number(flag("runs", "1"));
const MARKER = `PROBE_LIVE_${Date.now().toString(36)}`;
const TITLE = `Fugue probe ${MARKER}`;

function token() {
  const env = process.env.FUGUE_ENGINE_TOKEN?.trim();
  if (env) return env;
  const home = process.env.UNOWN_HOME?.trim();
  if (home) {
    try {
      const t = readFileSync(join(home, "engine.token"), "utf8").trim();
      if (t) return t;
    } catch { /* fallthrough */ }
  }
  throw new Error("probe-live: no engine token (set FUGUE_ENGINE_TOKEN or UNOWN_HOME)");
}

async function engineFetch(tok, path, init = {}) {
  const res = await fetch(`${ENGINE_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${tok}`, ...(init.headers ?? {}) },
  });
  return { status: res.status, ok: res.ok, body: await res.text() };
}

const report = {
  marker: MARKER, title: TITLE, engine: ENGINE_URL, port: PORT,
  startedAt: new Date().toISOString(),
  boundaries: {}, network: [], console: [], pageErrors: [],
  verdict: null, notes: [],
};

const net = (r) => report.network.push(r);
const boundary = (name, pass, detail) => {
  report.boundaries[name] = { pass, detail };
  console.error(`${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

async function main() {
  const tok = token();

  // RULING 3: hard-fail on a dead engine.
  const probe = await engineFetch(tok, "/api/overview");
  if (!probe.ok) throw new Error(`probe-live: engine probe failed (HTTP ${probe.status})`);
  report.engineVersion = JSON.parse(probe.body)?.version ?? null;

  // Boot the fugue server on the probe port (owned by this probe).
  const server = spawn("bun", ["apps/fugue/serve.mjs"], {
    cwd: REPO, env: { ...process.env, FUGUE_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => report.notes.push(`server: ${d.toString().trim()}`));
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > 30_000) throw new Error("probe-live: fugue server did not come up");
    try {
      const h = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (h.ok) break;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 300));
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("console", (m) => report.console.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => report.pageErrors.push(String(e)));

  // Mechanism C: the live engine config BEFORE the app module runs.
  await page.addInitScript(
    (cfg) => { window.__FUGUE_ENGINE__ = cfg; },
    { url: ENGINE_URL, token: tok },
  );
  page.on("response", async (res) => {
    const u = res.url();
    if (!u.startsWith(ENGINE_URL)) return;
    let body = "";
    try { body = (await res.text()).slice(0, 500); } catch { /* streamed */ }
    net({ url: u.replace(ENGINE_URL, ""), status: res.status(), body });
  });

  let routineId = null;
  try {
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForSelector(".fugue-job-row, [data-panel]", { timeout: 15_000 });
    boundary("boot", true, "app shell rendered");

    // CREATE through the compose UI.
    await page.keyboard.press("Control+k");
    await page.waitForSelector(".fugue-palette");
    await page.click(".fugue-palette li[data-cmd='new-job']");
    await page.waitForSelector('[data-dialog="compose"]');
    await page.fill('[data-dialog="compose"] [data-input="title"]', TITLE);
    await page.fill('[data-dialog="compose"] [data-input="prompt"]', `Reply with exactly: ${MARKER}`);
    await page.click('[data-dialog="compose"] button[aria-label="submit"]');
    const engineRow = page.locator(`.fugue-job-row[data-lane="engine"]:has-text("${TITLE}")`).first();
    await engineRow.waitFor({ state: "visible", timeout: 30_000 });
    boundary("create-engine-row", true, "the engine row rendered with the real id");

    // Resolve the routine id (the probe owns its cleanup).
    const list = await engineFetch(tok, "/api/automations");
    const autos = JSON.parse(list.body)?.automations ?? [];
    routineId = autos.find((a) => a.title === TITLE)?.id ?? null;
    boundary("id-resolve", routineId != null, `routine id ${JSON.stringify(routineId)}`);

    // SELECT the engine row -> the runs route.
    await engineRow.click();
    await page.waitForSelector('[data-route="runs"]', { timeout: 10_000 });
    const runsAfterSelect = await page.locator(".fugue-run-row").count();
    boundary("select-runs-route", true, `runs route visible, ${runsAfterSelect} run row(s)`);

    // RUN-NOW × N through the palette; await the history 200 + the row.
    for (let i = 1; i <= RUNS; i++) {
      await page.keyboard.press("Control+k");
      await page.waitForSelector(".fugue-palette");
      await page.click(".fugue-palette li[data-cmd='run-now']");

      // V-15: await the OBSERVABLE effect (the run row), live scale
      // (a real engine session: 10-90 s honest ceiling).
      const row = page.locator(".fugue-run-row").first();
      let rowSeen = false;
      try {
        await row.waitFor({ state: "visible", timeout: 90_000 });
        rowSeen = true;
      } catch { /* the boundary below reports it */ }
      const historyCalls = report.network.filter(
        (n) => n.url.includes("/runs") && n.status === 200,
      ).length;
      const domRows = await page.locator(".fugue-run-row").count();
      // The H-23 split at the failure boundary: which route is the DOM
      // actually on, which panel shows, and what does the app state hold?
      const failState = rowSeen ? null : await page.evaluate(() => ({
        route: document.querySelector("[data-route]")?.getAttribute("data-route") ?? null,
        panel: document.querySelector("[data-panel]")?.getAttribute("data-panel") ?? null,
        dialog: document.querySelector("[data-dialog]")?.getAttribute("data-dialog") ?? null,
        jobRows: document.querySelectorAll(".fugue-job-row").length,
        stateRuns: (window.__FUGUE_DEBUG_STATE__?.runs?.length) ?? null,
      })).catch(() => null);
      boundary(
        `run-now-${i}`,
        rowSeen,
        rowSeen
          ? `run row rendered (history 200s so far: ${historyCalls})`
          : `NO run row after 90 s — history 200s: ${historyCalls}, DOM rows: ${domRows}, failState: ${JSON.stringify(failState)}, last bodies: ${JSON.stringify(report.network.filter((n) => n.url.includes("/runs")).slice(-2))}`,
      );
      if (!rowSeen) break;
    }

    // COLD BOOT: the engine rows survive the reload (E-03).
    await page.reload();
    await page.waitForSelector(".fugue-job-row, [data-panel]", { timeout: 15_000 });
    const rowsAfterReload = await page
      .locator(`.fugue-job-row[data-lane="engine"]:has-text("${TITLE}")`).count();
    boundary("cold-boot-engine-row", rowsAfterReload > 0, `${rowsAfterReload} engine row(s) after reload`);

    // THE LEARNING VIEWS (F-7 chunk 2): the dreams journal + the memory
    // view against the REAL engine's own learning loop (W2 — the round's
    // keystone surface). Real data only (V-41): the engine holds real
    // dreams/tiers at this point in the loop.
    await page.keyboard.press("Control+k");
    await page.waitForSelector(".fugue-palette");
    await page.click(".fugue-palette li[data-cmd='open-dreams']");
    {
      await page.waitForSelector('[data-route="dreams"]', { timeout: 10_000 });
      const dreamRows = await page.locator("[data-dream]").count();
      const noDreams = await page.locator('[data-panel="no-dreams"]').count();
      const dreamBodies = await page.locator('[data-route="dreams"] .fugue-dream-status, [data-route="dreams"] [class*="is-"]').count();
      boundary(
        "learning-dreams-view",
        dreamRows > 0 || noDreams > 0,
        dreamRows > 0
          ? `the REAL dreams rendered: ${dreamRows} row(s), ${dreamBodies} status marker(s) (the engine's live journal — no fake data)`
          : noDreams > 0 ? "the honest no-dreams panel (0 dreams on the engine)" : "neither rows nor the honest empty panel",
      );
    }
    await page.keyboard.press("Control+k");
    await page.waitForSelector(".fugue-palette");
    await page.click(".fugue-palette li[data-cmd='open-memory']");
    {
      await page.waitForSelector('[data-route="memory"]', { timeout: 10_000 });
      const tierRows = await page.locator("[data-tier]").count();
      const health = await page.locator('[data-route="memory"]').textContent().catch(() => "");
      const hasHealth = /backend/i.test(health ?? "") && /model/i.test(health ?? "");
      boundary(
        "learning-memory-view",
        (tierRows > 0 || /no tiers/i.test(health ?? "")) && hasHealth,
        `tiers rendered: ${tierRows}; the health card ${hasHealth ? "present (backend + model)" : "MISSING"}`,
      );
    }

    // THE SKILLS VIEW (F-7 chunk 3): the engine's DB skills (honest empty
    // on a fresh home) + the REAL staged queue (the fs candidates) + the
    // promote hint (a human mv, never automated).
    await page.keyboard.press("Control+k");
    await page.waitForSelector(".fugue-palette");
    await page.click(".fugue-palette li[data-cmd='open-skills']");
    {
      await page.waitForSelector('[data-route="skills"]', { timeout: 10_000 });
      const skillsText = (await page.locator('[data-route="skills"]').textContent().catch(() => "")) ?? "";
      const stagedRows = await page.locator("[data-staged]").count();
      const hasHint = /mv \.unown\/skills-staged\//.test(skillsText);
      const honestEmpty = /no skills/i.test(skillsText) || stagedRows > 0;
      boundary(
        "learning-skills-view",
        honestEmpty && hasHint,
        `staged rows: ${stagedRows}; the promote hint ${hasHint ? "present (the human mv)" : "MISSING"}; engine skills lane ${/no skills/i.test(skillsText) ? "honest-empty" : "rendered"}`,
      );
    }

    // THE MANUAL-NOTES EDITOR (F-7 chunk 3): the real section, the budget
    // meter, the unverified label, and a SAFE idempotent PUT round-trip
    // (PUT the identical section back — zero net change, the write lane
    // proven; byte-compare before/after).
    await page.keyboard.press("Control+k");
    await page.waitForSelector(".fugue-palette");
    await page.click(".fugue-palette li[data-cmd='open-manual-notes']");
    {
      await page.waitForSelector('[data-route="manual-notes"]', { timeout: 10_000 });
      const editorText = (await page.locator('[data-route="manual-notes"]').textContent().catch(() => "")) ?? "";
      const hasUnverified = /unverified/i.test(editorText);
      const hasMeter = /\d+\s*\/\s*4096|4096/i.test(editorText);
      const hasTextarea = (await page.locator('[data-route="manual-notes"] textarea').count()) > 0;
      // The idempotent PUT round-trip through the app's own server edge.
      // V-28 hardening: byte-compare the REAL FILE before/after (a
      // GET-to-GET comparison cannot catch an extractor bug — both reads
      // return the same partial section while the file is clobbered).
      const fileBefore = readFileSync(join(REPO, ".unown", "memory", "project.md"), "utf8");
      const before = await fetch(`http://127.0.0.1:${PORT}/manual-notes`).then((r) => r.json()).catch(() => null);
      let putOk = false, fileUnchanged = false;
      if (before && typeof before.section === "string") {
        const put = await fetch(`http://127.0.0.1:${PORT}/manual-notes`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ section: before.section }),
        }).catch(() => null);
        putOk = put?.ok === true;
        const after = await fetch(`http://127.0.0.1:${PORT}/manual-notes`).then((r) => r.json()).catch(() => null);
        const fileAfter = readFileSync(join(REPO, ".unown", "memory", "project.md"), "utf8");
        fileUnchanged = fileAfter === fileBefore && after?.section === before.section;
      }
      boundary(
        "learning-manual-notes-editor",
        hasUnverified && hasMeter && hasTextarea && putOk && fileUnchanged,
        `unverified label: ${hasUnverified}; meter: ${hasMeter}; textarea: ${hasTextarea}; the idempotent PUT round-trip: ${putOk ? "200" : "FAILED"}, section byte-stable: ${fileUnchanged}`,
      );
    }

    // The session note lands (the real wire shape {content, created_at, run_id}).
    let noteSeen = false;
    const noteDeadline = Date.now() + 120_000;
    while (Date.now() < noteDeadline) {
      const notesRes = await engineFetch(tok, "/api/notes");
      if (notesRes.ok && notesRes.body.includes(MARKER)) { noteSeen = true; break; }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    boundary("note-lands", noteSeen, noteSeen ? "marker note in /api/notes" : "no marker note in 120 s");
  } finally {
    if (routineId != null) {
      const del = await engineFetch(
        tok, `/api/automations/${encodeURIComponent(String(routineId))}`, { method: "DELETE" },
      );
      report.cleanup = { id: routineId, status: del.status };
    }
    await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }

  const failed = Object.entries(report.boundaries).filter(([, b]) => !b.pass);
  report.verdict = failed.length === 0
    ? "GREEN — the full live loop observed"
    : `RED — ${failed.map(([n]) => n).join(", ")}`;
  report.finishedAt = new Date().toISOString();

  const text = JSON.stringify(report, null, 2);
  if (OUT) writeFileSync(OUT, text);
  console.log(text);
  process.exit(failed.length === 0 ? 0 : 2);
}

main().catch((e) => {
  report.verdict = `HARNESS-ERROR — ${String(e)}`;
  const text = JSON.stringify(report, null, 2);
  if (OUT) writeFileSync(OUT, text);
  console.error(text);
  process.exit(1);
});
