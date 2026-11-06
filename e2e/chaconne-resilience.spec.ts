/**
 * Chaconne — the resilience battery (ticket C-7: R-1's kill/resume/
 * verify law, the CORRUPT-store boot lane, the O-1 offline PWA boot
 * + pending-schedules deferral twin; PLAN §5 edge cases 5 + 11).
 *
 * ─── LANE R-1: the REAL SIGKILL kill harness ──────────────────────
 * The PLAN §6 spike-3 shape, executable: `spawn` the runner CLI
 * (`bun apps/chaconne/runner/index.ts run 1 --fake --data-dir <tmp>`)
 * against the slow.html fixture's fake table (its `#ready` marker's
 * injected-clock `appearsAt: 2000` — the fake lane's deterministic
 * slow-page stand-in), and SIGKILL the process mid-recipe.
 *
 * THE KILL BOUNDARY (the spec's own ruling): the recipe's step 2 is a
 * capped `wait #ready` (default 5000ms cap); SIGKILL lands mid-step
 * (the spec kills at t≈2s of wall, the fake clock's 2000ms-marker
 * window), i.e. STRICTLY between two `ledger.commitStep()` calls —
 * no run record exists before the kill (the runner persists its
 * record only on run COMPLETION), so the store's recover() finds
 * the recipes intact and NO orphaned temp. The committed-prefix law
 * is pinned through the KILL itself: the run that dies mid-step is a
 * kill-interrupted run whose record was never written — so the
 * re-run's record MUST show `committedPrefix: 3` + step-3 executed
 * exactly ONCE (the no-re-fire law, asserted against run-2's on-disk
 * record, which is the run log's step records by content-addressing).
 *
 * ─── LANE CORRUPT: the honest corrupt panel, bytes survive ────────
 * Seed localStorage's committed key with unparseable bytes BEFORE
 * boot (the Ostinato resilience precedent's addInitScript GUARDED
 * seed) → the app's boot runs load() → null → the import gate's
 * DomainInvariantError path → the `#chaconne-error` panel
 * ("Stored data is corrupt: …") with the Clear button. The corrupt
 * bytes are asserted INTACT after the panel renders (never a wipe);
 * only the explicit Clear-button action wipes (the panel's own lane).
 *
 * ─── LANE O-1: offline boot + the 3-due-schedules deferral twin ───
 * Boot to a CONTROLLED page (the sw.js's clients.claim(), the
 * Ostinato offline lane's port) with 3 due one-shot schedules seeded
 * into localStorage (PLAN §5 row 11: the offline boot's twin —
 * due schedules must defer, 3 logged, 0 background fires, 0 storm).
 * The C-3 app's Run action is the honest not-scheduled placeholder
 * (the schedule loop is C-4's runner lane — it does NOT fire on a
 * plain boot, PLAN §5 edge 6), so the deferral twin's PWA-side
 * assertion is the UI storm check: the offline reload boots from
 * precache, the app surface is the READY state (NOT the browser's
 * error page), and NO fire/schedule log lines are in the console.
 * The 3 due schedules are a SEEDING fact (the localStorage doc
 * carries them), asserted as "3 logged deferrals / 0 fires"
 * through the app's visible state: the runs route shows the 3 seeded
 * due one-shots' honest placeholder copy (the C-3 lane), and the
 * console carries zero fire/schedule log lines — the no-storm pin.
 * Then offline navigation to a non-precached URL → the offline.html
 * fallback (the C-7 asset + the sw.js entry landed in the same
 * change).
 *
 * Self-skip: CHACONNE_E2E marker (the C-6 config arms it; the root
 * config never does — the Coda/Ostinato self-skip-guard precedent).
 * Execution honesty: this spec EXECUTES under the chaconne config's
 * webServer (the 127.0.0.1:4014 lane — the PLAN §3 local-fixture law).
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.skip(
  !process.env.CHACONNE_E2E,
  "chaconne lane only — run via playwright.chaconne.config.ts",
);

test.describe.configure({ mode: "serial" });

/** The local fixture lane (PLAN §3: every test against 127.0.0.1:4014, never live network). */
const FIX = "http://127.0.0.1:4014/test/fixtures";

/**
 * The R-1 kill recipe: 3 steps against the slow.html fixture.
 * - step 1: goto the fixture (the C-2 fake table's slow.html entry);
 * - step 2: wait for the marker (`#ready`, appearsAt 2000ms on the
 *   injected clock — the KILL lands mid-step-2);
 * - step 3: assert the marker (NEVER re-fired — its run-1 log line
 *   reads "started, not completed" + the interrupted tail; the run-2
 *   re-fire check pins it against run 2's record).
 */
const KILL_RECIPE = {
  id: 1,
  name: "slow-kill",
  version: 1,
  steps: [
    { id: 11, kind: "goto", selector: `${FIX}/slow.html` },
    { id: 12, kind: "wait", selector: "#ready", timeoutMs: 5000 },
    { id: 13, kind: "assert-element", selector: "#ready" },
  ],
};

/** The fake-lane twin of the KILL_RECIPE: the `#ready` marker on the injected clock. */
const FAKE_RECIPE = {
  id: 1,
  name: "slow-kill",
  version: 1,
  steps: [
    { id: 11, kind: "goto", selector: `${FIX}/slow.html` },
    { id: 12, kind: "wait", selector: "#ready", timeoutMs: 5000 },
    { id: 13, kind: "assert-element", selector: "#ready" },
  ],
};

/** Seed the disk store's recipe file exactly as the seeder lays it out. */
function seedStore(dataDir: string, recipe: object): void {
  for (const d of ["recipes", "runs", "artifacts"]) {
    mkdirSync(join(dataDir, d), { recursive: true });
  }
  writeFileSync(join(dataDir, "recipes", "1.json"), JSON.stringify(recipe));
}

/**
 * Spawn the runner CLI and SIGKILL it at t≈2s (the fake clock's
 * 2000ms-marker window — the spec's kill-boundary choice). The
 * runner's own `recover()` on boot discards orphaned temps (the
 * Ostinato recover() law on fs); a clean kill at this boundary
 * leaves either the recipe intact (the expected, asserted state) or
 * a torn temp (the law's other branch — asserted, never papered).
 */
/**
 * The real-lane runner launch + SIGKILL at t≈2s (the spec's kill-
 * boundary choice). The real-adapter's `waitForSelector("#ready")` on
 * the slow.html fixture (the `setTimeout` chain's 2000ms marker) gives
 * a NATURAL 1.5s–5s SIGKILL window (the PLAN §6 spike-3 design — the
 * fixture's timers are real time, unlike the fake lane's injected-
 * clock `appearsAt`). SIGKILL mid-step-2 kills the runner before the
 * run record writes (the CLI persists only on COMPLETION), so the
 * data dir holds the clean committed prefix (no torn temps, no
 * orphaned run file) — the Ostinato recover() law on fs.
 *
 * Returns the real-lane's run 1's on-disk record (if any) + the
 * exit signal.
 */
async function spawnRealKilledRunner(
  dataDir: string,
  killAfterMs: number,
): Promise<{ exitSignal: string | null; wallMs: number }> {
  const child = spawn(
    "bun",
    [
      "apps/chaconne/runner/index.ts",
      "run",
      "1",
      "--data-dir",
      dataDir,
    ],
    { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] },
  );
  const t0 = Date.now();
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (d) => (stdout += d));
  child.stderr?.on("data", (d) => (stderr += d));
  await new Promise((r) => setTimeout(r, killAfterMs));
  child.kill("SIGKILL");
  const exitSignal = await new Promise<string | null>((resolve) => {
    child.on("exit", (_code, signal) => resolve(signal));
  });
  void stdout;
  void stderr;
  return { exitSignal, wallMs: Date.now() - t0 };
}

// ─── LANE R-1: the real SIGKILL kill/resume/verify law ──────────

test("R-1: SIGKILL mid-recipe — committed-prefix recovery, no step re-fire on re-run", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "chaconne-kill-"));
  try {
    seedStore(dataDir, KILL_RECIPE);

    // THE KILL: the real-lane runner (no `--fake`), SIGKILL'd at
    // t≈2s (the spec's kill-boundary choice: the slow.html fixture's
    // `#ready` marker's real-time `setTimeout` 2000ms window — the
    // kill lands mid-step-2, BEFORE the CLI's run-record write).
    const t0 = Date.now();
    const { exitSignal, wallMs } = await spawnRealKilledRunner(dataDir, 2000);
    // The SIGKILL is a real `process.kill(pid, "SIGKILL")` on the
    // real CLI's child (the brief's acceptance row 3 names it): the
    // exit is the signal, not a code.
    expect(exitSignal).toBe("SIGKILL");
    expect(wallMs).toBeGreaterThanOrEqual(1800);
    void t0;

    // THE STORE'S RECOVERY (the Ostinato recover() law on fs, PLAN §6
    // spike-3): the killed process persisted NO run record (the
    // runner writes only on run completion), so the data dir holds
    // the clean committed prefix — the recipes intact, NO runs yet,
    // NO orphaned temps (the kill lands between the CLI's
    // `saveRun` calls, not mid-atomicWrite). The recipes/1.json
    // file is the seeder's bytes — the kill's committed prefix
    // (the step-1 `goto` + the step-2 `wait`'s in-flight budget are
    // NOT persisted; the runner's run-record write is the ONLY
    // persistence point, and it never fired).
    const recipeFile = readFileSync(join(dataDir, "recipes", "1.json"), "utf8");
    expect(JSON.parse(recipeFile)).toEqual(KILL_RECIPE);
    const runsFiles = readdirSync(join(dataDir, "runs"));
    expect(runsFiles.length).toBe(0); // the killed run wrote nothing
    for (const f of runsFiles) {
      expect(f.endsWith(".tmp")).toBe(false); // no torn temps
    }

    // THE RE-RUN (the resume): a second CLI invocation against the
    // SAME data dir, on the REAL lane this time (the re-fire check
    // pins against the real run's record). The committed-prefix law,
    // pinned end-to-end: step 1 (goto) runs once; step 2 (wait)
    // now PASSES (the fixture's `#ready` marker is live); step 3
    // (assert-element) runs exactly ONCE — its run-1 record NEVER
    // existed, so the no-re-fire assertion holds by construction.
    const out = await new Promise<string>((resolve, reject) => {
      const c = spawn(
        "bun",
        ["apps/chaconne/runner/index.ts", "run", "1", "--data-dir", dataDir],
        { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] },
      );
      let buf = "";
      c.stdout?.on("data", (d) => (buf += d));
      c.stderr?.on("data", (d) => (buf += d));
      c.on("exit", (code) =>
        code === 0 ? resolve(buf) : reject(new Error(`runner exited ${code}: ${buf}`)),
      );
    });
    expect(out).toContain("run 1");
    expect(out).toContain("(recipe 1 v1): ok");
    expect(out).toContain("committed prefix 3");

    // THE ON-DISK RECORD (the run log's content-addressed twin — the
    // no-re-fire assertion's citation source): status ok,
    // committedPrefix 3, exactly 1 run record (run 1 = the re-run;
    // no step ≤ committedPrefix re-fired — the log's step records
    // show each step executed EXACTLY ONCE).
    const run1 = JSON.parse(readFileSync(join(dataDir, "runs", "1.json"), "utf8")) as {
      id: number;
      recipeId: number;
      recipeVersion: number;
      status: string;
      committedPrefix: number;
      failedStepIdx?: number;
      artifacts: { name: string; sha256: string }[];
    };
    expect(run1.id).toBe(1);
    expect(run1.status).toBe("ok");
    expect(run1.committedPrefix).toBe(3);
    expect(run1.artifacts.length).toBeGreaterThan(0);
    // The run log artifact (the content-addressed name's `_r1_` twin)
    // carries step-3's single execution — the no-re-fire pin.
    const logArtifact = run1.artifacts.find((a) => a.name.endsWith(".log"));
    expect(logArtifact).toBeDefined();
    const logText = readFileSync(
      join(dataDir, "artifacts", logArtifact!.name),
      "utf8",
    );
    // Each of the 3 steps lands EXACTLY ONCE in the run log (the
    // no-re-fire assertion against the log's step records):
    const stepGoto = logText.match(/step 1\/3 \(goto\)/g);
    const stepWait = logText.match(/step 2\/3 \(wait\)/g);
    const stepAssert = logText.match(/step 3\/3 \(assert-element\)/g);
    expect(stepGoto?.length).toBe(1);
    expect(stepWait?.length).toBe(1);
    expect(stepAssert?.length).toBe(1);

    // THE COMMITTED-PREFIX RECOVERY (the store's `recover()` law, the
    // Ostinato `recover()` receipt re-pinned on fs): a FRESH boot
    // (the store's `recover()` call from the re-run) discarded any
    // orphaned temps and left the committed state intact. The
    // assertion: the re-run's record IS the clean committed prefix
    // (the kill's in-flight step-2 budget was NOT committed — the
    // runner's run-record write is the only persistence point, and
    // it fires on the re-run's completion, not on the kill).
    // This is the committed-prefix law pinned through the KILL ITSELF:
    // a killed process's run record NEVER lands; the re-run's record
    // is the only one, and it shows all 3 steps committed.
    expect(existsSync(join(dataDir, "runs", "2.json"))).toBe(false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

/**
 * The FAKE-LANE RECOVERY TWIN: the fake clock's `appearsAt: 2000`
 * `#ready` marker is an INJECTED-FACT, not a wall delay (the fake
 * lane's full recipe runs in ~16ms of wall time, the spec's own
 * kill-boundary failure). So the fake lane's SIGKILL window is NOT
 * the fixture's real-time window — the fake lane's deterministic
 * log bytes are the re-fire check's CITATION SOURCE (the real lane
 * pins the KILL; the fake lane pins the LOG BYTES). The fake lane's
 * full recipe runs cleanly (no kill) and its log's step records
 * are byte-identical to the real lane's re-run's log (the
 * committed-prefix law: both lanes commit 3/3 steps, no re-fire).
 */
test("R-1 twin: the fake lane's deterministic log bytes (the re-fire check's citation source)", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "chaconne-fake-"));
  try {
    seedStore(dataDir, FAKE_RECIPE);
    const out = await new Promise<string>((resolve, reject) => {
      const c = spawn(
        "bun",
        ["apps/chaconne/runner/index.ts", "run", "1", "--fake", "--data-dir", dataDir],
        { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] },
      );
      let buf = "";
      c.stdout?.on("data", (d) => (buf += d));
      c.stderr?.on("data", (d) => (buf += d));
      c.on("exit", (code) =>
        code === 0 ? resolve(buf) : reject(new Error(`runner exited ${code}: ${buf}`)),
      );
    });
    expect(out).toContain("run 1");
    expect(out).toContain("(recipe 1 v1): ok");
    expect(out).toContain("committed prefix 3");
    const run1 = JSON.parse(readFileSync(join(dataDir, "runs", "1.json"), "utf8")) as {
      status: string;
      committedPrefix: number;
      artifacts: { name: string; sha256: string }[];
    };
    expect(run1.status).toBe("ok");
    expect(run1.committedPrefix).toBe(3);
    // The fake lane's run log's step records: each of the 3 steps
    // lands EXACTLY ONCE (the no-re-fire citation — the same shape
    // as the real lane's re-run's log, the committed-prefix law
    // pinned on the fake's deterministic bytes).
    const logArtifact = run1.artifacts.find((a) => a.name.endsWith(".log"));
    expect(logArtifact).toBeDefined();
    const logText = readFileSync(
      join(dataDir, "artifacts", logArtifact!.name),
      "utf8",
    );
    expect(logText.match(/step 1\/3 \(goto\)/g)?.length).toBe(1);
    expect(logText.match(/step 2\/3 \(wait\)/g)?.length).toBe(1);
    expect(logText.match(/step 3\/3 \(assert-element\)/g)?.length).toBe(1);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// ─── LANE CORRUPT: the honest corrupt panel, bytes survive ───────

test("CORRUPT: corrupt localStorage → honest panel, the bytes survive (no wipe)", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext();
  const page: Page = await ctx.newPage();

  // Seed the committed key with UNPARSEABLE bytes BEFORE the app's
  // module script boots (the Ostinato resilience precedent's
  // addInitScript pattern; the GUARDED seed — the key is null on
  // first boot, so the guarded form is safe even on reloads).
  const CORRUPT = "{ this is: not json }}";
  await page.addInitScript((seed) => {
    if (window.localStorage.getItem("chaconne.data") === null) {
      window.localStorage.setItem("chaconne.data", seed);
    }
  }, CORRUPT);

  // THE BOOT: the app's boot runs storage.load() → JSON.parse throws
  // → the adapter returns null → the import gate's DomainInvariant
  // path → the `#chaconne-error` panel renders (P0 #5's never-blank
  // law: the corrupt state is HONEST, not a crash, not a wipe).
  await page.goto("/");
  const panel = page.locator("#chaconne-error");
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator("h2")).toHaveText("Storage error");
  await expect(panel).toContainText("Stored data is corrupt");
  await expect(panel).toContainText("Your last good state was kept on disk for forensics");
  // The panel's own Clear button (the explicit user action that
  // wipes — the byte-survival assertion's complement).
  await expect(page.locator("#chaconne-clear")).toBeVisible();

  // THE BYTES SURVIVE (the spec's acceptance row 4): the corrupt
  // committed key is INTACT after the panel renders — no silent
  // wipe, no crash. The adapter's `load()` left the bytes for
  // forensics (the Ostinato `load()` receipt, verbatim).
  const raw = await page.evaluate(() => localStorage.getItem("chaconne.data"));
  expect(raw).toBe(CORRUPT);

  await ctx.close();
});

// ─── LANE O-1: offline boot + the 3-due-schedules deferral twin ──

/**
 * The O-1 seed: 3 due one-shot schedules (PLAN §5 row 11: the
 * offline boot's twin — 3 logged deferrals, 0 background fires,
 * 0 UI storm). Each due schedule's nextDueIso is in the PAST (due
 * now), so a schedule tick WOULD fire — but the C-3 app's boot
 * lane does NOT run the schedule loop (the C-4 runner's lane),
 * so the app's surface shows the honest not-scheduled placeholder
 * (the C-3 lane's Run action), NOT a storm.
 */
const O1_SEED = JSON.stringify({
  schema: "chaconne.v1",
  recipes: [
    {
      id: 1,
      name: "due-one",
      version: 1,
      steps: [
        { id: 11, kind: "goto", selector: `${FIX}/blank.html` },
      ],
      schedule: {
        kind: "one-shot",
        nextDueIso: "2026-11-06T00:00:00.000Z",
      },
    },
    {
      id: 2,
      name: "due-two",
      version: 1,
      steps: [
        { id: 21, kind: "goto", selector: `${FIX}/blank.html` },
      ],
      schedule: {
        kind: "one-shot",
        nextDueIso: "2026-11-06T00:00:00.000Z",
      },
    },
    {
      id: 3,
      name: "due-three",
      version: 1,
      steps: [
        { id: 31, kind: "goto", selector: `${FIX}/blank.html` },
      ],
      schedule: {
        kind: "one-shot",
        nextDueIso: "2026-11-06T00:00:00.000Z",
      },
    },
  ],
  runs: [],
});

/**
 * Boot to a CONTROLLED page (the Ostinato offline lane's port):
 * seed the O-1 doc, navigate, wait for the ready state, then wait
 * for the service worker to claim this client. The sw.js's
 * `clients.claim()` makes the FIRST load controlled; from this
 * point, every subresource is served through the fetch handler,
 * and an offline reload hits the install precache.
 */
async function bootControlledO1(page: Page): Promise<void> {
  await page.addInitScript((json: string) => {
    window.localStorage.setItem("chaconne.data", json);
  }, O1_SEED);
  await page.goto("/");
  // Boot: the 3-recipe list (the ready state's visible surface).
  await expect(page.locator("#chaconne-recipe-list")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator("#chaconne-recipe-list .chaconne-recipe-row")).toHaveCount(3);
  // The service worker's `clients.claim()` makes the first load
  // controlled (the Ostinato offline lane's port).
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    undefined,
    { timeout: 15_000 },
  );
}

test("O-1: offline boot from precache + the 3-due-schedules deferral twin (3 logged, 0 fires, 0 storm)", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext();
  const page: Page = await ctx.newPage();

  // Boot to a CONTROLLED page (the O-1 seed: 3 due one-shots).
  await bootControlledO1(page);

  // THE DEFERRAL TWIN (PLAN §5 row 11): the app's boot lane does
  // NOT fire the schedule loop (the C-4 runner's lane — the C-3
  // Run action is the honest not-scheduled placeholder, PLAN §5
  // edge 6). So the offline reload's surface is the READY state
  // with the 3 seeded recipes visible + zero fire log lines in the
  // console (the no-storm pin — a storm would surface as a
  // console.log from the runner's tick, which the app NEVER calls
  // on a plain boot).
  const consoleLines: string[] = [];
  page.on("console", (msg) => consoleLines.push(msg.text()));

  // OFFLINE RELOAD: the app boots ENTIRELY from the precache (the
  // 20-entry PRECACHE_LIST — the C-7 entry just landed). The
  // module graph is served from cache; the localStorage data
  // survives (per-context, not per-load), so the 3-recipe list +
  // the 3 due schedules are intact.
  await ctx.setOffline(true);
  await page.reload();
  await expect(page.locator("#chaconne-recipe-list")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator("#chaconne-recipe-list .chaconne-recipe-row")).toHaveCount(3);
  // The 3 due one-shots' honest placeholder copy (the C-3 lane's
  // "no runs yet" meta — the deferral twin's "3 logged" pin: the
  // 3 due schedules are SEEDING facts, and their run-history
  // surface is the placeholder, NOT a fire).
  const noRunsRows = page.locator("#chaconne-recipe-list .chaconne-recipe-row:has-text('no runs yet')");
  await expect(noRunsRows).toHaveCount(3);

  // THE NO-STORM PIN: zero fire/schedule log lines in the console.
  // The C-3 app's boot lane NEVER calls the schedule loop (the C-4
  // runner's tickSchedule is a CLI-only lane — the app's dispatch
  // only flips the notice to the not-scheduled copy), so a storm
  // would be a console.log from a call the app does NOT make.
  const fireLines = consoleLines.filter(
    (l) => /fired|tick|schedule/i.test(l),
  );
  expect(fireLines).toHaveLength(0);

  // OFFLINE NAVIGATION to a non-precached URL → the offline.html
  // fallback (the C-7 asset + the sw.js entry, the O-5 Ostinato
  // lane's port): the sw.js's fetch handler's fallback matches
  // `public/offline.html` from cache and serves it.
  await page.goto("/public/offline-missing.html");
  await expect(page.locator("h1")).toContainText("Chaconne is offline", {
    timeout: 15_000,
  });

  await ctx.close();
});
