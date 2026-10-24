// Media integrity gate for the landing page's captured assets — the test
// that goes red when a dex capture or showcase still is dropped, mis-sized
// or corrupt, so "the video doesn't work" can never again be discovered by
// a visitor.
//
// The changed-line coverage gate (scripts/check_coverage.mjs) flags landing
// edits that no test exercises — this file pins the media contract of the
// two bands that consume public/landing/:
//   - every media path the rendered DOM references (video <source>, poster,
//     data-poster, <img src>) exists under public/ — a REEL whose lane
//     folder was never curated fails here, not in production;
//   - every <img> that declares intrinsic width/height against a PNG still
//     matches the file's real IHDR dimensions — the split-view stills shipped
//     1792×1042 while the dex declared 2214×1369 (2026-10-24), which
//     letterboxed the stage and lied to the aspect-ratio calculator;
//   - every referenced .mp4 is a real ISO-BMFF file with the moov atom
//     BEFORE mdat (faststart — a moov at EOF means the browser cannot start
//     playing until the whole file is downloaded), every .webm begins with
//     the EBML magic — the codec-level "it loads but never plays" class.
//
// Rendered under the global happy-dom preload (bunfig.toml [test] preload →
// src/test-dom-setup.ts), same as the other landing component tests; the
// binary probes are plain fs reads, so the gate stays offline and fast.

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Same reason as creature.test.tsx: the StarCount fetch is rate-limited from
// a shared sandbox IP and suspends the tree — mock it out.
mock.module("../star-count", () => ({
  StarCount: () => null,
  getStars: async () => 128,
}));

const { DexSection } = await import("../dex");
const { ShowcaseSection } = await import("../showcase");

// The dex renders framer-motion mount animations; settle before unmount so
// cleanup does not reject mid-flight (same reason as creature.test.tsx).
// @ts-expect-error deliberately removing a browser API for this run
Element.prototype.animate = undefined;

const PUBLIC = join(import.meta.dir, "..", "..", "..", "..", "public");

/** PNG IHDR is bytes 16-23: width/height, big-endian, no decoder needed. */
const pngDims = (file: string): { w: number; h: number } => {
  const b = readFileSync(file);
  if (b.length < 24 || b.toString("latin1", 1, 4) !== "PNG") {
    throw new Error(`${file} is not a PNG`);
  }
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

/** An mp4 plays progressively only when the moov (index) atom precedes the
 *  mdat (media) atom — +faststart. A moov at EOF is the silent killer: the
 *  file loads, content-type is right, and playback still waits for the last
 *  byte. Scanning the first 64KiB is enough: with faststart the moov lives
 *  in the head by construction. */
const mp4FaststartOk = (file: string): boolean => {
  const head = readFileSync(file).subarray(0, 65_536).toString("latin1");
  const moov = head.indexOf("moov");
  const mdat = head.indexOf("mdat");
  return moov !== -1 && (mdat === -1 || moov < mdat);
};

/** WebM is EBML: the 4-byte magic 0x1A45DFA3. */
const webmMagicOk = (file: string): boolean => {
  const b = readFileSync(file).subarray(0, 4);
  return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
};

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 320));
  cleanup();
});

describe("the landing's captured media, on disk and byte-true", () => {
  test("every media path the dex and showcase DOM reference exists in public/", () => {
    const refs = new Set<string>();

    for (const Component of [DexSection, ShowcaseSection]) {
      const { container } = render(<Component />);
      container.querySelectorAll("source[src]").forEach((el) => refs.add(el.getAttribute("src")!));
      container.querySelectorAll("img[src]").forEach((el) => refs.add(el.getAttribute("src")!));
      container.querySelectorAll("video[poster]").forEach((el) => refs.add(el.getAttribute("poster")!));
      // hidden panes carry data-poster instead of a real poster attr
      container.querySelectorAll("video[data-poster]").forEach((el) => refs.add(el.getAttribute("data-poster")!));
    }

    expect(refs.size).toBeGreaterThan(0);
    const missing = [...refs].filter((p) => !existsSync(join(PUBLIC, p)));
    expect(
      missing,
      `referenced but missing under public/ — capture the lane and curate it (scripts/tui-capture/): ${missing.join(", ")}`,
    ).toEqual([]);
  });

  test("every <img> with declared intrinsic dims matches the PNG's real IHDR size", () => {
    const mismatches: string[] = [];
    const { container } = render(<DexSection />);

    container.querySelectorAll("img[src]").forEach((el) => {
      const src = el.getAttribute("src")!;
      const w = Number(el.getAttribute("width"));
      const h = Number(el.getAttribute("height"));
      if (!src.startsWith("/landing/") || !w || !h) return;
      const file = join(PUBLIC, src);
      if (!existsSync(file)) return; // the existence test reports this
      if (!src.endsWith(".png")) return;
      const real = pngDims(file);
      if (real.w !== w || real.h !== h) {
        mismatches.push(`${src}: declares ${w}×${h}, file is ${real.w}×${real.h}`);
      }
    });

    expect(mismatches, `intrinsic-dimension drift (wrong width/height attrs)`).toEqual([]);
  });

  test("every referenced video is codec-true: mp4 has faststart, webm has EBML magic", () => {
    const broken: string[] = [];
    const { container } = render(<DexSection />);

    container.querySelectorAll("source[src]").forEach((el) => {
      const src = el.getAttribute("src")!;
      const file = join(PUBLIC, src);
      if (!existsSync(file)) return; // the existence test reports this
      if (src.endsWith(".mp4") && !mp4FaststartOk(file)) broken.push(`${src}: moov atom not before mdat (no faststart)`);
      if (src.endsWith(".webm") && !webmMagicOk(file)) broken.push(`${src}: missing EBML magic — not a WebM`);
    });

    expect(broken, `videos that load but would not play`).toEqual([]);
  });

  test("no two entries ship the same poster — a duplicate face reads as a broken lane", () => {
    // The 2026-10-23 set shipped three lanes sharing one byte-identical boot
    // frame as their posters (review ≡ plan-mode ≡ hero-bugfix, and fleet ≡
    // subagent-explore): clicking through the spine showed the same image
    // under different names, which is exactly what "the videos don't work"
    // looked like to a visitor. Two entries must never wear the same face.
    const posters = new Map<string, string>(); // md5 → first poster path
    const dupes: string[] = [];
    const { container } = render(<DexSection />);

    container.querySelectorAll("video[data-poster]").forEach((el) => {
      const poster = el.getAttribute("data-poster")!;
      const file = join(PUBLIC, poster);
      if (!existsSync(file)) return; // the existence test reports this
      const md5 = new Bun.CryptoHasher("md5");
      md5.update(readFileSync(file));
      const hash = md5.digest("hex");
      const first = posters.get(hash);
      if (first && first !== poster) {
        dupes.push(`${poster} is byte-identical to ${first}`);
      } else {
        posters.set(hash, poster);
      }
    });

    expect(dupes, `posters that duplicate another entry's face`).toEqual([]);
  });
});
