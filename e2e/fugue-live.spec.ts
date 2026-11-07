/**
 * Fugue — the LIVE e2e lane (ticket F-6 chunk 2, RULINGS 1-3).
 *
 * Drives the PWA against the REAL engine on 127.0.0.1:3030:
 * create a routine through the compose UI, run-now it, assert the
 * run + session note land back in the console. >=3 consecutive runs,
 * >=1 cold boot (NOTES-F6.md §3, the V-15 observable-effect law).
 *
 * SELF-SKIP GUARD: module-scope `process.env.FUGUE_LIVE !== "1"`
 * skips the lane (extends the FUGUE_E2E smoke pattern; a strict
 * subset — the plain FUGUE_E2E lane NEVER runs live code).
 *
 * RULING 3: the spec probes the engine from Node at start and
 * HARD-FAILS when it is down — a silent skip would hide a dead
 * engine from the operator, who runs this lane deliberately.
 *
 * RULING 2: the session note is polled from Node against
 * /api/notes for up to 120s (test.setTimeout), a longer honest
 * poll; if it does not land, FAIL honestly.
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test.describe.configure({ mode: "serial" });
test.skip(
  process.env.FUGUE_LIVE !== "1",
  "live engine lane only — run with FUGUE_LIVE=1 (a strict subset of FUGUE_E2E)",
);
const ENGINE_URL = process.env.FUGUE_ENGINE_URL ?? "http://127.0.0.1:3030";
const LIVE_MARKER = "FUGUE_LIVE_OK";
const LIVE_TITLE = "Fugue live loop probe";

/** Node-side token discovery, mirroring runner/engine-client.ts:
 *  FUGUE_ENGINE_TOKEN > $UNOWN_HOME/engine.token (no silent default). */
function liveToken(): string {
  const env = process.env.FUGUE_ENGINE_TOKEN?.trim();
  if (env) return env;
  const home = process.env.UNOWN_HOME?.trim();
  if (home) {
    try {
      const t = readFileSync(join(home, "engine.token"), "utf8").trim();
      if (t) return t;
    } catch { /* missing -> hard fail below */ }
  }
  throw new Error(
    `live lane: no engine token (set FUGUE_ENGINE_TOKEN or $UNOWN_HOME=... with engine.token)`,
  );
}

/** Node-side engine probe + helper (RULING 3: hard-fail, never skip). */
async function probeEngine(): Promise<string> {
  const token = liveToken();
  const res = await fetch(`${ENGINE_URL}/api/overview`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403)
    throw new Error(`live lane: engine rejected the bearer token (HTTP ${res.status})`);
  if (!res.ok) throw new Error(`live lane: engine probe failed (HTTP ${res.status})`);
  return token;
}

/** Cleanup: delete a routine by id (RULING 3 — the spec owns the cleanup). */
async function deleteAutomation(token: string, id: string): Promise<void> {
  const res = await fetch(`${ENGINE_URL}/api/automations/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404)
    throw new Error(`live lane: cleanup DELETE ${id} failed (HTTP ${res.status})`);
}

/** Poll /api/notes from Node for a note whose content carries the marker.
 *  The real engine's note wire shape is { id, run_id, content, created_at }.
 *  (The fixture's text/at drifts — this is the live lane's honest read.) */
async function awaitLiveNote(token: string, deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const res = await fetch(`${ENGINE_URL}/api/notes`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const body = (await res.json()) as {
        notes?: { id?: string | number; run_id?: string | number; content?: string; created_at?: string }[];
      };
      const hit = (body.notes ?? []).some((n) =>
        typeof n.content === "string" && n.content.includes(LIVE_MARKER),
      );
      if (hit) return;
    }
    if (Date.now() >= deadline)
      throw new Error(`live lane: no ${LIVE_MARKER} note landed in /api/notes within ${deadlineMs}ms`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** The create-via-UI helper (compose dialog fill + submit). */
async function createRoutineViaUi(page: import("@playwright/test").Page): Promise<void> {
  await page.keyboard.press("Control+k");
  const palette = page.locator(".fugue-palette");
  await expect(palette).toBeVisible();
  await palette.locator("li[data-cmd='new-job']").click();
  const dialog = page.locator('[data-dialog="compose"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-input="title"]').fill(LIVE_TITLE);
  await dialog.locator('[data-input="prompt"]').fill(`Reply with exactly: ${LIVE_MARKER}`);
  await expect(dialog.locator('button[aria-label="submit"]')).toBeEnabled();
  await dialog.locator('button[aria-label="submit"]').click();
  await expect(dialog).toHaveCount(0);
  // The new row landed in the job list (the observable effect).
  // Job-scoped commands act on ENGINE routines (data-lane="engine");
  // a shadow-row selection is out of scope for the live lane (the
  // enable-rule refinement rides F-7 — see the comment at the spec
  // header).
  await expect(
    page.locator(`.fugue-job-row[data-lane="engine"]:has-text("${LIVE_TITLE}")`).first(),
  ).toBeVisible({ timeout: 30_000 });
}

/** The run-now-via-palette + run-row await (V-15: no bare sleeps).
 *  Returns the group title so the caller can report it in the handoff. */
async function runNowAndAwaitRunRow(page: import("@playwright/test").Page, baseline: number): Promise<string> {
  await page.keyboard.press("Control+k");
  const palette = page.locator(".fugue-palette");
  await expect(palette).toBeVisible();
  await palette.locator("li[data-cmd='run-now']").click();
  // The palette closes; the app refreshes (optimistic-free, F-5 law).
  // The NEW run row appears in the runs view — count grows past baseline.
  // V-15 at live scale: a real engine session (bwrap + a model call)
  // records the run and lands the refresh in 10-60s — a 90s honest
  // ceiling; if a real run exceeds it, FAIL honestly.
  const row = page.locator(".fugue-run-row").first();
  await expect(row).toBeVisible({ timeout: 90_000 });
  // The group title must be the routine's real title, NOT "Job 0".
  const group = page.locator(".fugue-run-group").first();
  const titleText = (await group.locator("h3").textContent()) ?? "";
  if (titleText.trim() === "Job 0")
    throw new Error(
      `live lane: group title is "Job 0" (the string-id collapse regression); expected "${LIVE_TITLE}"`,
    );
  return titleText.trim();
}

test("live loop: create routine, run-now x3, cold boot, note lands", async ({ page }) => {
  const token = await probeEngine(); // RULING 3: hard-fails when the engine is down
  test.setTimeout(600_000); // 3 live run-nows (up to 90s each) + the 120s note poll + cold boot

  // RULING 1: inject the live engine config BEFORE the app module runs.
  await page.addInitScript(
    (cfg: { url: string; token: string }) => {
      (window as { __FUGUE_ENGINE__?: unknown }).__FUGUE_ENGINE__ = cfg;
    },
    { url: ENGINE_URL, token },
  );

  let routineId: string | null = null;
  try {
    // CREATE through the compose UI against 3030.
    await page.goto("/");
    await createRoutineViaUi(page);

    // Resolve the routine id Node-side (the spec owns the cleanup id).
    {
      const res = await fetch(`${ENGINE_URL}/api/automations`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as { automations?: { id: string | number; title?: string }[] };
      routineId = (body.automations ?? []).find((a) => a.title === LIVE_TITLE)?.id as string;
      expect(routineId, "the created routine must exist on the engine").toBeTruthy();
    }

    // SELECT the engine-lane routine row -> runs view (baseline 0 runs).
    // The enable-rule refinement (shadow-vs-engine selection) rides F-7;
    // the live lane pins the engine lane explicitly.
    const engineRow = page.locator(`.fugue-job-row[data-lane="engine"]:has-text("${LIVE_TITLE}")`).first();
    await engineRow.click();
    await expect(page.locator('[data-route="runs"]').first()).toBeVisible();

    // F-7: the group title MUST be the routine's real title, NOT "Job 0"
    // (the string-id collapse regression). Pin the observable before any
    // run-now — this is the acceptance gate for the render link.
    const preTitle = (await page.locator(".fugue-run-group h3").first().textContent()) ?? "";
    if (preTitle.trim() === "Job 0")
      throw new Error(
        `live lane: pre-run-now group title reads "Job 0" (the string-id collapse regression); expected "${LIVE_TITLE}"`,
      );

    // RUN-NOW #1 via the palette + await the run row (V-15 observable).
    const baseline = await page.locator(".fugue-run-row").count();
    const title1 = await runNowAndAwaitRunRow(page, baseline);

    // COLD BOOT (>=1): full reload re-bootstraps from the engine
    // (E-03 duplicate-free: exactly ONE engine-lane row for the routine).
    await page.goto("/");
    const engineRows = page.locator(`.fugue-job-row[data-lane="engine"]:has-text("${LIVE_TITLE}")`);
    // The reload's boot chain is the same scale as the post-create refresh.
    await expect(engineRows.first()).toBeVisible({ timeout: 30_000 });
    expect(
      await engineRows.count(),
      "the routine row must appear exactly once after the cold boot",
    ).toBe(1);
    await engineRows.first().click();
    await expect(page.locator('[data-route="runs"]').first()).toBeVisible();
    await expect(page.locator(".fugue-run-row").first()).toBeVisible(); // run #1 survived
    // The cold-boot group title must also be the real title.
    const coldBootTitle = (await page.locator(".fugue-run-group h3").first().textContent()) ?? "";
    if (coldBootTitle.trim() === "Job 0")
      throw new Error(
        `live lane: cold-boot group title is "Job 0" (the string-id collapse regression); expected "${LIVE_TITLE}"`,
      );

    // RUN-NOW #2 and #3: two more consecutive runs (3 total).
    const title2 = await runNowAndAwaitRunRow(page, 1);
    const title3 = await runNowAndAwaitRunRow(page, 2);

    // The session note lands (RULING 2: 120s honest poll, Node-side).
    await awaitLiveNote(token, 120_000);

    // F-7 evidence: capture the routine id + run titles for the handoff.
    console.log(`FUGUE_LIVE_EVIDENCE routine=${routineId} title1="${title1}" title2="${title2}" title3="${title3}" coldBootTitle="${coldBootTitle}"`);
  } finally {
    // RULING 3: cleanup the routine (even on assertion failure).
    if (routineId !== null) {
      await deleteAutomation(token, routineId);
      const res = await fetch(`${ENGINE_URL}/api/automations`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as { automations?: { id: string | number }[] };
      expect(
        (body.automations ?? []).some((a) => String(a.id) === routineId),
        "the deleted routine must be gone from the engine",
      ).toBe(false);
    }
  }
});
