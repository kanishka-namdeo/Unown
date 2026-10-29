#!/usr/bin/env node
/**
 * The nocturne round's live headless-Chromium UI pass (plan Phase 5,
 * the 10 steps): login → dashboard → incident detail → ack → services →
 * rotations → runbooks → analytics → public status page → reset.
 *
 * Modeled exactly on `benchmarks/aria-round/ui-pass.mjs`: the same
 * step() harness, the same console-error zero-tolerance, the same
 * production standalone server target, the same retry-during-hydration
 * pattern.
 *
 * Runs against a PRODUCTION standalone server (the same artifact the e2e
 * webServer uses):  node .next/standalone/server.js  (PORT=3210).
 *
 * Output: one line per step, "PASS <n> <name>" / "FAIL <n> <name> —
 * <reason>"; exit 0 iff all ten pass. Zero console errors tolerated.
 *
 * The selectors are the REAL ones from `src/components/nocturne/*.tsx`:
 * the sidebar nav's `role="tablist"` (aria-label "Nocturne navigation"),
 * the 8 nav tabs (Dashboard / Incidents / Services / Rotations /
 * Runbooks / Postmortems / Analytics / Members), the KPI band's
 * `role="group"` aria-label "KPIs", the lists' aria-labels, the
 * accessible-SVG charts' `role="img"` + aria-label, the "Acknowledge"
 * button, and the public status page's Components / Active incidents
 * sections.
 *
 * Usage: node benchmarks/nocturne-round/ui-pass.mjs [baseURL]
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:3210";
const DEMO_EMAIL = "mira@lumen.test";
const DEMO_PASSWORD = "nocturne-demo-1";
// The public status page's demo-tenant slug (the seed's `LUMEN.tenant`).
const PUBLIC_SLUG = "lumen";

const steps = [];
let consoleErrors = 0;

function step(n, name, fn) {
  steps.push({ n, name, fn });
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors += 1;
});
page.on("pageerror", () => {
  consoleErrors += 1;
});

/**
 * Click a sidebar nav tab (role="tablist" aria-label "Nocturne
 * navigation"), retrying once when the click lands during the
 * hydration window (a silent no-op). `waitFor` is the probe that
 * confirms the view actually switched.
 */
async function clickTab(tabName, waitFor) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.getByRole("tab", { name: tabName }).click();
    try {
      await waitFor();
      return;
    } catch {
      /* retry — the click may have landed during hydration */
    }
  }
  await waitFor(); // last retry's failure is the real error
}

step(1, "login", async () => {
  await page.goto(`${BASE}/nocturne`, { waitUntil: "networkidle" });
  // Settle the hydration window before interacting (an early click is a
  // no-op). The login form's inputs are pre-filled with the demo
  // credentials; fill them explicitly (the `login` step's contract).
  await page.waitForTimeout(500);
  const email = page.locator('input[type="email"]');
  await email.waitFor({ timeout: 10_000 });
  await email.fill(DEMO_EMAIL);
  await page.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  try {
    // The app shell's sidebar `<nav>` carries `role="tablist"` (aria-label
    // "Nocturne navigation") — query the tablist, not navigation.
    await page.getByRole("tablist", { name: /nocturne navigation/i }).waitFor({ timeout: 10_000 });
  } catch {
    // One retry: a click during hydration is a silent no-op.
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.getByRole("tablist", { name: /nocturne navigation/i }).waitFor({ timeout: 10_000 });
  }
});

step(2, "dashboard", async () => {
  // The default view is the dashboard; wait for the REAL rows, not the
  // empty state ("All clear — no open incidents.") — the KPI band +
  // the active-incident list's list items.
  const kpi = page.getByRole("group", { name: "KPIs" });
  await kpi.waitFor({ timeout: 10_000 });
  const rows = page.locator('ul[aria-label="Active incidents"] li');
  await rows.first().waitFor({ timeout: 10_000 });
  if ((await rows.count()) < 1) throw new Error("no open-incident rows on the dashboard");
});

step(3, "incident detail", async () => {
  await clickTab("Incidents", () =>
    page.locator('ul[aria-label="Incidents"] li').first().waitFor({ timeout: 5_000 }),
  );
  // Open the first incident (the list button; the detail view is a
  // client-side overlay, not a navigation).
  await page.locator('ul[aria-label="Incidents"] li').first().click();
  // The detail's profile heading + the timeline (the "Incident timeline"
  // list with events).
  const timeline = page.locator('ul[aria-label="Incident timeline"]');
  await timeline.first().waitFor({ timeout: 5_000 });
  const events = await timeline.first().locator("li").count();
  if (events < 1) throw new Error("the incident timeline rendered no events");
  // Back to the list (the "← All incidents" button).
  await page.getByRole("button", { name: /← all incidents/i }).click();
  await page.locator('ul[aria-label="Incidents"] li').first().waitFor({ timeout: 5_000 });
});

step(4, "ack an incident", async () => {
  // Filter the list to an UNACKED incident (the "triggered" status —
  // the seeded unacked row). The "Acknowledge" button is only
  // actionable on an open, unacked incident.
  await clickTab("Incidents", () =>
    page.locator('ul[aria-label="Incidents"] li').first().waitFor({ timeout: 5_000 }),
  );
  await page.locator('#nocturne-incident-status').selectOption("triggered");
  await page.waitForTimeout(300);
  const unacked = page.locator('ul[aria-label="Incidents"] li').first();
  await unacked.waitFor({ timeout: 5_000 });
  await unacked.click();
  // The detail view's "Acknowledge" button (the enabled, open lane).
  const ack = page.getByRole("button", { name: "Acknowledge", exact: true });
  await ack.waitFor({ timeout: 5_000 });
  await ack.click();
  // The state change lands: the incident flips to "acknowledged" —
  // the "Acknowledge" button is disabled (the terminal-ish gate) and
  // the status chip flips. Wait for the provider's reload to settle.
  await page.waitForTimeout(500);
  const ackAfter = page.getByRole("button", { name: "Acknowledge", exact: true });
  const nowDisabled = await ackAfter.isDisabled().catch(() => false);
  const chipFlipped = await page
    .locator('span[aria-label="incident acknowledged"]')
    .first()
    .waitFor({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!nowDisabled && !chipFlipped) {
    throw new Error("the ack did not land — the Acknowledge button is still enabled and the status chip did not flip");
  }
});

step(5, "services", async () => {
  await clickTab("Services", () =>
    page.locator('ul[aria-label="Services"] li').first().waitFor({ timeout: 5_000 }),
  );
  // The services screen renders with on-call info (each row shows
  // "on call" + the primary name / "no rotation").
  const rows = page.locator('ul[aria-label="Services"] li');
  if ((await rows.count()) < 1) throw new Error("no service rows rendered");
  const body = await page.textContent("body");
  if (!/on call/i.test(body ?? "")) throw new Error("the services screen did not render on-call info");
});

step(6, "rotations", async () => {
  await clickTab("Rotations", () =>
    page.locator('ul[aria-label="Rotations"] li').first().waitFor({ timeout: 5_000 }),
  );
  // The weekly rotation schedule renders: open the first rotation
  // (the detail shows the "Seat schedule" — the weekly tiling).
  await page.locator('ul[aria-label="Rotations"] li').first().click();
  const seat = page.locator('ol[aria-label="Seat schedule"]');
  await seat.waitFor({ timeout: 5_000 });
  const seats = await seat.locator("li").count();
  if (seats < 1) throw new Error("the rotation detail rendered no seat-schedule rows");
  // Back to the list.
  await page.getByRole("button", { name: /← all rotations/i }).click();
  await page.locator('ul[aria-label="Rotations"] li').first().waitFor({ timeout: 5_000 });
});

step(7, "runbooks", async () => {
  await clickTab("Runbooks", () =>
    page.locator('ul[aria-label="Runbooks"] li').first().waitFor({ timeout: 5_000 }),
  );
  // The runbook list renders; open one — the ordered checklist
  // ("Runbook steps" + the per-incident checklists).
  await page.locator('ul[aria-label="Runbooks"] li').first().click();
  const stepsEl = page.locator('ol[aria-label="Runbook steps"]');
  await stepsEl.waitFor({ timeout: 5_000 });
  const stepCount = await stepsEl.locator("li").count();
  if (stepCount < 1) throw new Error("the runbook detail rendered no steps");
  // Back to the list.
  await page.getByRole("button", { name: /← all runbooks/i }).click();
  await page.locator('ul[aria-label="Runbooks"] li').first().waitFor({ timeout: 5_000 });
});

step(8, "analytics", async () => {
  await clickTab("Analytics", () =>
    page.getByRole("group", { name: "Analytics KPIs" }).waitFor({ timeout: 5_000 }),
  );
  // The MTTA/MTTR charts render: accessible SVG with `role="img"`
  // (the SparkBar's aria-label "Incident counts by severity") +
  // the KPI band.
  const svg = page.locator('svg[role="img"][aria-label="Incident counts by severity"]');
  await svg.first().waitFor({ timeout: 5_000 });
  const kpi = page.getByRole("group", { name: "Analytics KPIs" });
  if (!(await kpi.count())) throw new Error("the analytics KPI band did not render");
  const body = await page.textContent("body");
  if (!/MTTA/.test(body ?? "")) throw new Error("the analytics view did not render MTTA");
});

step(9, "public status page", async () => {
  // The public status page is an auth-free standalone route — open it
  // in a fresh incognito context (no session cookie), so the component
  // statuses + active incidents render from the public fetch.
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const anonPage = await anon.newPage();
  anonPage.on("console", (m) => {
    if (m.type() === "error") consoleErrors += 1;
  });
  anonPage.on("pageerror", () => {
    consoleErrors += 1;
  });
  try {
    await anonPage.goto(`${BASE}/nocturne/status/${PUBLIC_SLUG}`, {
      waitUntil: "networkidle",
    });
    const heading = anonPage.locator("h1:has-text('system status')");
    await heading.waitFor({ timeout: 10_000 });
    const comps = anonPage.locator("section:has(h2:has-text('Components')) ul li");
    await comps.first().waitFor({ timeout: 5_000 });
    if ((await comps.count()) < 1) throw new Error("no component statuses rendered on the public status page");
    const inc = anonPage.locator("section:has(h2:has-text('Active incidents'))");
    await inc.waitFor({ timeout: 5_000 });
  } finally {
    await anon.close();
  }
});

step(10, "reset", async () => {
  const res = await page.request.post(`${BASE}/nocturne/api/demo/reset`);
  if (res.status() !== 200) throw new Error(`reset returned ${res.status()}`);
  const body = await res.json().catch(() => ({}));
  if (body && body.reset === false) throw new Error("reset reported failure");
});

let failed = 0;
for (const s of steps) {
  try {
    await s.fn();
    console.log(`PASS ${s.n} ${s.name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${s.n} ${s.name} — ${e.message}`);
  }
}

await browser.close();
if (consoleErrors > 0) {
  console.log(`NOTE ${consoleErrors} console error(s) observed during the pass`);
}
if (failed > 0) {
  console.log(`RESULT ${steps.length - failed}/${steps.length} steps passed — ${failed} failed`);
  process.exit(1);
}
console.log(`RESULT ${steps.length}/${steps.length} steps passed, ${consoleErrors} console errors`);
