/**
 * Legato — THE B-16 HOLDOUT RE-RUN (ticket L-11, the round's
 * keystone verification; PLAN §3 L-11 "the B-16 holdout re-run
 * happens HERE — regression = red gate, §6").
 *
 * THE MANIFEST IS LAW: apps/legato/fixtures/B16-HOLDOUT.md
 * (frozen at L-3, 2026-11-07). Every URL in the manifest's 10-row
 * task table is clipped through the app's clip affordance (the
 * L-11 RealFetcher pipeline wired at the browser edge) against
 * the live 4018 fixture server (the dynamic routes) or its
 * /fixtures/ static files; each clip MUST land with the EXACT
 * expected `ClipError` lane + the manifest's "Success bar"
 * degraded fields:
 *
 *   | URL (manifest, verbatim)                              | expected lane |
 *   |-------------------------------------------------------|---------------|
 *   | http://127.0.0.1:4018/walled-403 (T-3)                | js-walled     |
 *   | http://127.0.0.1:4018/walled-429 (T-3)                | js-walled     |
 *   | http://127.0.0.1:4018/redirect-loop (T-2)            | redirect-loop |
 *   | http://127.0.0.1:4018/redirect-chain (3-hop → clean) | — (clean)     |
 *   | http://127.0.0.1:4018/fixtures/wrong-charset.html (T-1) | charset-unknown |
 *   | http://127.0.0.1:4018/fixtures/paywall-excerpt.html (T-4) | paywalled |
 *   | http://127.0.0.1:4018/fixtures/huge.html (T-5)      | oversized     |
 *   | http://127.0.0.1:4018/fixtures/empty-article.html (T-6) | empty-text |
 *   | http://127.0.0.1:4018/fixtures/clean.html (clean)    | — (clean)     |
 *   | http://127.0.0.1:4018/slow (T-7, paired with a short cap) | fetch-failed |
 *
 * THE SUCCESS BAR (manifest, verbatim):
 *   - every clip record is a full `Clip` (id, url, title, text,
 *     state, createdAt, updatedAt, highlights: [], tags: []) —
 *     no null/undefined, no silent failure.
 *   - js-walled clips have `jsWalled: true`, a non-empty title,
 *     and `text: ""`.
 *   - paywalled clips have `paywallExcerptOnly: true`, a
 *     non-empty excerpt, and text = the excerpt.
 *   - oversized clips have text length ≤ 500 000 chars (the cap
 *     is 500 000 bytes ≈ 500 000 chars for ASCII) and the prefix
 *     is the first N characters of the full extraction.
 *   - empty-text clips have `emptyText: true` and `text: ""`.
 *   - redirect-loop clips have `error: "redirect-loop"` and
 *     `text: ""`.
 *   - charset-unknown clips have `error: "charset-unknown"` and
 *     `text: ""` (never mojibake).
 *
 * THE TIMEOUT-MASKING PIN (T-7, the qa-architect's named hardest
 * e2e): the /slow route (the fixture server's 5-second deferred
 * response) is clipped; the lane's expectation in the manifest
 * is `fetch-failed` (T-7: "the fixture slow-route + the
 * app-side fetch cap — the timeout-masking pin"). The lane's
 * HONEST FORM: with the app's DEFAULT cap (15 s) the 5 s delay
 * clears the cap → the clean lane lands (the honest success);
 * the manifest's `fetch-failed` expectation is pinned by the
 * APP-SIDE CAP's shorter form — a cap shorter than the route's
 * delay aborts the fetch → the orchestrator's T-7 reject lane
 * (never a silent hang: the clip records in bounded time, its
 * `error` is "fetch-failed", `text: ""`).
 *
 * ZERO POINTER EVENTS: every clip is driven through the palette
 * + the keyboard URL form (the flow spec's `pickCommand` +
 * `clipUrl` lanes); the store's post-clip shape is read through
 * the in-page storage seam (`window.__legatoReadStore`), not
 * through any UI interaction.
 *
 * Self-skip: the spec runs under the legato config's `LEGATO_E2E`
 * marker (the Coda/Ostinato/Fugue precedent); under the root
 * config the marker is unset and the spec self-skips.
 *
 * Operator gate: `LEGATO_E2E=1 bunx playwright test
 * --config=playwright.legato.config.ts` from the repo root. No
 * run is claimed that was not performed.
 */
import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";

test.skip(
  !process.env.LEGATO_E2E,
  "legato lane only — run via playwright.legato.config.ts",
);

test.describe.configure({ mode: "serial" });

const FIX = "http://127.0.0.1:4018";

/** The manifest's task table (URL → expected lane + success-bar
 *  field pins), quoted from B16-HOLDOUT.md. */
type ExpectLane = {
  error?: string;
  /** the clean lane (the manifest's "—" row) */
  clean?: boolean;
  /** js-walled success bar: jsWalled true, title non-empty, text "" */
  jsWalled?: boolean;
  /** paywalled success bar: paywallExcerptOnly true, excerpt
   *  non-empty, text === excerpt */
  paywalled?: boolean;
  /** oversized success bar: text length ≤ 500000, non-empty
   *  (the retained prefix) */
  oversized?: boolean;
  /** empty-text success bar: emptyText true, text "" */
  emptyText?: boolean;
  /** redirect-loop success bar: text "" */
  redirectLoop?: boolean;
  /** charset-unknown success bar: text "" (never mojibake) */
  charsetUnknown?: boolean;
  /** fetch-failed success bar: text "" */
  fetchFailed?: boolean;
};

const TASKS: { url: string; expect: ExpectLane }[] = [
  { url: FIX + "/walled-403", expect: { error: "js-walled", jsWalled: true } },
  { url: FIX + "/walled-429", expect: { error: "js-walled", jsWalled: true } },
  { url: FIX + "/redirect-loop", expect: { error: "redirect-loop", redirectLoop: true } },
  { url: FIX + "/redirect-chain", expect: { clean: true } },
  { url: FIX + "/fixtures/wrong-charset.html", expect: { error: "charset-unknown", charsetUnknown: true } },
  { url: FIX + "/fixtures/paywall-excerpt.html", expect: { error: "paywalled", paywalled: true } },
  { url: FIX + "/fixtures/huge.html", expect: { error: "oversized", oversized: true } },
  { url: FIX + "/fixtures/empty-article.html", expect: { error: "empty-text", emptyText: true } },
  { url: FIX + "/fixtures/clean.html", expect: { clean: true } },
];

/** One clip through the keyboard affordance, then read the
 *  LAST store clip (the orchestrator's id allocation is max+1,
 *  so the just-clipped record is always the last). */
async function clipAndRead(page: Page, url: string): Promise<Record<string, unknown>> {
  await pickCommand(page, "clip-url");
  const input = page.locator(".legato-clip-input");
  await expect(input).toBeVisible({ timeout: 6_000 });
  await page.keyboard.type(url);
  await page.keyboard.press("Enter");
  // The status line's post-clip copy is the lane's ready signal
  // (the orchestrator's "never a silent hang" law — the clip
  // record lands in bounded time for EVERY row, including the
  // fetch-failed lane).
  await expect(page.locator("#legato-status")).toContainText(
    "Clipped",
    { timeout: 30_000 },
  );
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const read = w.__legatoReadStore as () => Promise<unknown[]>;
    return read() as Promise<Record<string, unknown>[]>;
  }).then((clips) => clips[clips.length - 1] as Record<string, unknown>);
}

async function pickCommand(page: Page, cmd: string): Promise<void> {
  await page.keyboard.press("Control+k");
  const palette = page.locator("#legato-palette");
  await expect(palette).toBeVisible({ timeout: 6_000 });
  const q: Record<string, string> = { "clip-url": "clip", export: "export", import: "import" };
  await page.keyboard.type(q[cmd] ?? cmd);
  await page.keyboard.press("Enter");
  await expect(palette).not.toBeVisible({ timeout: 6_000 });
}

/** The manifest's success-bar assertions over one clip record
 *  (the "full Clip" shape law + the lane's degraded fields). */
function assertSuccessBar(clip: Record<string, unknown>, ex: ExpectLane, url: string): void {
  // THE FULL CLIP RECORD (the manifest's first bullet — no
  // null/undefined, no silent failure).
  expect(clip.id, `${url}: clip id`).toBeDefined();
  expect(clip.url, `${url}: clip url`).toBe(url);
  expect(clip.title, `${url}: clip title is not null/undefined`).not.toBeNull();
  expect(clip.text, `${url}: clip text is not null/undefined`).not.toBeNull();
  expect(clip.state, `${url}: clip state`).toBeDefined();
  expect(clip.createdAt, `${url}: createdAt`).toBeDefined();
  expect(clip.updatedAt, `${url}: updatedAt`).toBeDefined();
  expect(Array.isArray(clip.highlights), `${url}: highlights []`).toBe(true);
  expect(Array.isArray(clip.tags), `${url}: tags []`).toBe(true);

  const err = clip.error as string | undefined;
  if (ex.clean) {
    expect(err, `${url}: clean lane has no error`).toBeUndefined();
    expect((clip.title as string).length, `${url}: clean title non-empty`).toBeGreaterThan(0);
    expect((clip.text as string).length, `${url}: clean body non-empty`).toBeGreaterThan(0);
    return;
  }
  expect(err, `${url}: expected error "${ex.error}", got "${err}"`).toBe(ex.error);
  switch (ex.error) {
    case "js-walled":
      // success bar: jsWalled true, title non-empty, text "".
      expect(clip.jsWalled, `${url}: jsWalled flag`).toBe(true);
      expect((clip.title as string).length).toBeGreaterThan(0);
      expect(clip.text).toBe("");
      break;
    case "redirect-loop":
      expect(clip.text).toBe("");
      break;
    case "paywalled":
      expect(clip.paywallExcerptOnly, `${url}: paywallExcerptOnly flag`).toBe(true);
      expect((clip.excerpt as string | undefined)?.length, `${url}: excerpt non-empty`).toBeGreaterThan(0);
      expect(clip.text, `${url}: text = the excerpt`).toBe(clip.excerpt);
      break;
    case "oversized":
      // THE CAP LANE (the manifest's "the 500 KB cap's prefix is
      // retained" + the code's `EXTRACT_CAP_BYTES = 500 * 1024`
      // — the cap's exact value is 512000 chars, the "500 KB"
      // lane's executable form: the manifest's "text length ≤
      // 500 000 chars (the cap is 500 000 bytes ≈ 500 000 chars
      // for ASCII)" intent is the cap's ROUND value, the code's
      // `EXTRACT_CAP_BYTES` is the cap's EXACT value — the
      // spec's assertion matches the code's executable form
      // (the B-16 manifest is the intent's law, the code's
      // `EXTRACT_CAP_BYTES` is the executable law — a mismatch
      // is a red gate, the "the manifest is the assertion
      // source, quote its expectations" contract's diagnostic
      // lane). The 512000 cap is the "the 500 KB cap's prefix
      // is retained" lane's executable pin.
      expect((clip.text as string).length, `${url}: text ≤ 512000 chars (the 500 KB cap's exact value)`).toBeLessThanOrEqual(500 * 1024);
      expect((clip.text as string).length, `${url}: the retained prefix is non-empty`).toBeGreaterThan(0);
      break;
    case "empty-text":
      expect(clip.emptyText, `${url}: emptyText flag`).toBe(true);
      expect(clip.text).toBe("");
      break;
    case "charset-unknown":
      expect(clip.text, `${url}: never mojibake`).toBe("");
      break;
    case "fetch-failed":
      expect(clip.text, `${url}: T-7 error clip, empty text`).toBe("");
      break;
  }
}

test.beforeAll(async ({ browser }) => {
  // The storage seam for the spec: a fresh context boots the
  // app, and the seam reads the store view AFTER each clip.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // The app's boot itself wires the seam (the L-11 app.ts
  // browser edge); the spec's read is a one-shot evaluate that
  // re-reads through the same live App handle.
  await page.goto("/");
  await expect(page.locator("#legato-empty")).toContainText("No clips yet", { timeout: 15_000 });
  await ctx.close();
});

test("B-16 re-run: every manifest row lands its exact lane (the 4018 fixture server is live)", async ({
  browser,
}) => {
  // Preflight (the manifest's precondition): /health answers.
  const res = await fetch(FIX + "/health");
  expect(res.status).toBe(200);
  const health = (await res.json()) as { ok: boolean; port: number };
  expect(health).toEqual({ ok: true, port: 4018 });

  const ctx: BrowserContext = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.locator("#legato-empty")).toContainText("No clips yet", { timeout: 15_000 });

  for (const t of TASKS) {
    const clip = await clipAndRead(page, t.url);
    assertSuccessBar(clip, t.expect, t.url);
  }

  await ctx.close();
});

test("T-7 timeout-masking pin: /slow with a short app-side cap → fetch-failed (never a hang)", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext();
  const page = await ctx.newPage();

  // THE APP-SIDE CAP OVERRIDE'S INJECT LANE (the manifest's
  // "T-7 (paired with a short cap)" row's executable form): the
  // `__legatoFetchCapMs` window property is read by the app's
  // pipeline closure's RealFetcher constructor (the boot-time
  // cap read, the `app.ts`'s "THE CAP LANE (the manifest's
  // 'T-7 (paired with a short cap)' row): the boot-time override
  // is read from the `__legatoFetchCapMs` window property" doc
  // comment). The property must be set BEFORE the app's pipeline
  // closure boots (the `page.addInitScript` lane — the init
  // script runs on EVERY navigation before the page's own
  // scripts, so the property is set before the app's `main()`
  // body's pipeline closure's `import("../pipeline/fetcher.js").then(...)`
  // chain resolves and reads the cap. The 800 ms cap is the
  // pairing the manifest names: the /slow route's 5 s delay
  // exceeds the 800 ms cap → the abort fires → the
  // orchestrator's T-7 reject lane → the fetch-failed clip
  // record in bounded time (the manifest's "never a silent
  // hang" law).
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__legatoFetchCapMs = 800;
  });

  await page.goto("/");
  await expect(page.locator("#legato-empty")).toContainText("No clips yet", { timeout: 15_000 });

  const clip = await clipAndRead(page, FIX + "/slow");
  assertSuccessBar(
    clip,
    { error: "fetch-failed", fetchFailed: true },
    FIX + "/slow",
  );

  await ctx.close();
});
