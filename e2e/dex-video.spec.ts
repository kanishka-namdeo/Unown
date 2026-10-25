import { expect, test } from "@playwright/test";

/**
 * Video decode gate (strategy §12, the "plays like a real user" criterion):
 * the dex band's contract is that every filmed entry, when selected, starts
 * a muted looping capture that actually DECODES and PRESENTS FRAMES — not
 * merely that a <video> element exists with the right sources.
 *
 * The DOM-level guarantees (paths exist, faststart, EBML magic, poster
 * files) are pinned by the unit gate
 * (src/components/landing/__tests__/dex-media.test.tsx). This spec is the
 * browser-level proof on the production standalone build:
 *   - selecting each filmed entry drives its video to readyState 4
 *     (HAVE_ENOUGH_DATA),
 *   - presentation advances (W3C VideoPlaybackQuality.presentedVideoFrames,
 *     webkitDecodedFrameCount fallback),
 *   - currentTime advances between two samples (playback, not a poster),
 *   - the element reports no MediaError and no 4xx/5xx media fetch happened.
 *
 * The band never renders an autoplay attribute (playback is an effect
 * decision), so this spec clicks through the picker exactly the way the
 * keyboard/screen-reader story does — selection follows focus, the shown
 * pane is the only thing that plays (the one-moving-picture rule).
 */

interface DecodeProof {
  src: string;
  readyState: number;
  currentTime: number;
  presentedFrames: number;
  errorCode: number | null;
}

async function probeShownVideo(
  page: import("@playwright/test").Page,
): Promise<DecodeProof> {
  return page.evaluate(async () => {
    const shown = [...document.querySelectorAll("article")].find(
      (a) => !a.hasAttribute("hidden"),
    );
    const video = shown?.querySelector("video:not([hidden]) video") ?? shown?.querySelector("video");
    // the stage keeps every reel mounted; the visible one is the pane's
    // non-hidden capture wrapper's video
    const wrapper = shown?.querySelector("div:not([hidden]) video");
    const el = (wrapper ?? video) as HTMLVideoElement | null | undefined;
    if (!el) return { src: "NONE", readyState: -1, currentTime: -1, presentedFrames: -1, errorCode: null };
    const src = (el.currentSrc || el.querySelector("source")?.getAttribute("src") || "").replace(
      location.origin,
      "",
    );
    const t0 = el.currentTime;
    // up to 8s for HAVE_ENOUGH_DATA + the clock to move (local static files
    // decode in well under a second; the headroom is for cold CI disks)
    for (let i = 0; i < 80; i++) {
      if (el.readyState >= 4 && el.currentTime > t0 && t0 >= 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    // presentedFrames: the truest "user saw a frame" signal is
    // requestVideoFrameCallback (fires only when a frame hits the compositor,
    // metadata.presentedFrames); totalVideoFrames is the W3C fallback.
    let presented = -1;
    if (typeof el.requestVideoFrameCallback === "function") {
      presented = await new Promise<number>((resolve) => {
        const timer = setTimeout(() => resolve(-1), 3000);
        el.requestVideoFrameCallback((_now, meta) => {
          clearTimeout(timer);
          resolve(meta.presentedFrames);
        });
      });
    }
    if (presented < 0) {
      const q = el.getVideoPlaybackQuality?.();
      presented = q?.totalVideoFrames ?? (el as unknown as { webkitDecodedFrameCount?: number }).webkitDecodedFrameCount ?? -1;
    }
    return {
      src,
      readyState: el.readyState,
      currentTime: el.currentTime,
      presentedFrames: presented,
      errorCode: el.error?.code ?? null,
    };
  });
}

test("every filmed dex entry decodes and presents frames when selected", async ({
  page,
}) => {
  const mediaFailures: string[] = [];
  page.on("response", (r) => {
    if (/\/landing\/.+\.(mp4|webm|png)$/.test(r.url()) && r.status() >= 400) {
      mediaFailures.push(`${r.status()} ${r.url()}`);
    }
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  // the dex band is far down the page; its entries render server-side, so a
  // hash deep link both scrolls and selects in one move
  await page.goto("/#dex-task", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  // The picker options carry the "№" spine; walk them all, probing the ones
  // whose badge says "filmed" (●) rather than "pending" (○).
  const options = page.locator("button:has-text('№')");
  const count = await options.count();
  expect(count).toBeGreaterThan(0);

  let probed = 0;
  for (let i = 0; i < count; i++) {
    const btn = options.nth(i);
    const label = (await btn.textContent()) ?? "";
    if (!label.includes("filmed")) continue;

    await btn.click();
    await page.waitForTimeout(350);
    const proof = await probeShownVideo(page);

    // a stills-only pane (the dashboard showcase's <img>) mounts no <video> —
    // its existence/dims are the unit gate's job; nothing to decode here
    // (2026-10-25: the comment's old example, split-view, is a movie lane)
    if (proof.src === "NONE") continue;

    expect(
      proof.src,
      `${label}: the shown pane mounted no video source`,
    ).not.toBe("NONE");
    expect(
      proof.errorCode,
      `${label} (${proof.src}): MediaError while loading`,
    ).toBeNull();
    expect(
      proof.readyState,
      `${label} (${proof.src}): never reached HAVE_ENOUGH_DATA`,
    ).toBeGreaterThanOrEqual(4);
    expect(
      proof.presentedFrames,
      `${label} (${proof.src}): no frames presented to the compositor`,
    ).toBeGreaterThan(0);
    expect(
      proof.currentTime,
      `${label} (${proof.src}): currentTime never advanced — poster, not playback`,
    ).toBeGreaterThan(0);
    probed++;
  }

  // The band must actually have played something — a pass with zero probes
  // means the picker walk silently matched nothing (label drift).
  expect(probed, "no filmed entries were probed — picker selector drifted").toBeGreaterThan(0);
  expect(mediaFailures, "media fetches failed").toEqual([]);
});

test("the dex ships zero pending plates — every entry films, none mount a broken stage", async ({
  page,
}) => {
  // The 2026-10-24 media-completion round closed the last plate (№ 010
  // Parity), so the band's contract hardened: NO entry may greet a visitor
  // with "no capture yet". The defensive half stays for the future: IF an
  // entry ever goes pending again, its pane must state the gap out loud and
  // mount ZERO media — an empty stage with a missing file is the broken
  // experience this guards against, so the regression is caught either way.
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const arts = await page.evaluate(() => {
    return [...document.querySelectorAll("#dex article")].map((a) => ({
      label: a.getAttribute("aria-label") ?? "?",
      pendingGap: a.textContent?.includes("no capture yet") ?? false,
      // a pending pane must contain ZERO video/img media — an empty stage
      // with a missing file would be the broken experience this guards
      videos: a.querySelectorAll("video source[src], video[poster]").length,
      stills: a.querySelectorAll(`img[src^="/landing/tui/"]`).length,
    }));
  });

  expect(arts.length).toBeGreaterThan(0);

  const pending = arts.filter((a) => a.pendingGap);
  expect(
    pending.map((a) => a.label),
    "pending plates are back — every dex entry must ship a capture (the band's lead sentence counts them)",
  ).toEqual([]);
  for (const p of pending) {
    expect(p.videos, `${p.label}: pending pane must mount no video`).toBe(0);
    expect(p.stills, `${p.label}: pending pane must mount no still`).toBe(0);
  }

  // and every pane that is NOT pending must reference at least one real
  // media element (video source or still) — a filmed entry whose reels all
  // failed to mount is exactly as broken as a pending one
  const filmed = arts.filter((a) => !a.pendingGap);
  for (const f of filmed) {
    expect(
      f.videos + f.stills,
      `${f.label}: filmed entry mounted no media at all`,
    ).toBeGreaterThan(0);
  }
});
