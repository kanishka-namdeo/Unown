#!/usr/bin/env node
/**
 * curate_assets.mjs — stages the final README asset set into .github/assets/:
 *   - brand: banner.png, diagram-memory.png, social-preview.png (1280x640, <1MB), logo.svg
 *
 * Usage: bun scripts/curate_assets.mjs
 *
 * Inputs are gitignored scratch (`download/brand/`, `download/shots/`), so
 * every step below skips when its source is absent rather than failing the
 * run or clobbering a tracked asset. The banner/social HTML SOURCES are in
 * git at `scripts/brand/` — run `bun scripts/brand_render.mjs` first.
 */
import sharp from "sharp";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const SHOTS = join(process.cwd(), "download", "shots");
const BRAND = join(process.cwd(), "download", "brand");
const OUT = join(process.cwd(), ".github", "assets");
mkdirSync(OUT, { recursive: true });

const kb = (p) => `${(statSync(p).size / 1024).toFixed(0)} KB`;
const missing = (p) => !existsSync(p);

/*
 * Every step SKIPS rather than throws when its source is absent. The sources
 * live in gitignored `download/brand/` (banner + social renders from
 * brand_render.mjs), so a clean checkout can hold the brand HTML but not the
 * rendered captures. Failing here would either abort the run mid-stage or,
 * worse, invite a "fix" that deletes the tracked outputs it could not
 * refresh. Skipping leaves them untouched.
 */

async function copy(src, dst) {
  if (missing(src)) return console.log(`skip  ${basename(dst)}  (no ${src})`);
  copyFileSync(src, dst);
  console.log(`copy ${basename(dst)}  ${kb(dst)}`);
}

// ---- brand ----
await copy(join(BRAND, "banner.png"), join(OUT, "banner.png"));
await copy(join(BRAND, "diagram-memory.png"), join(OUT, "diagram-memory.png")); // four-tier stack infographic (brand_render.mjs -> diagram-memory.html)
await copy(join(process.cwd(), "public", "logo.svg"), join(OUT, "logo.svg"));

// social preview: 2560x1280 -> exactly 1280x640, must stay under 1 MB
if (missing(join(BRAND, "social@2x.png"))) {
  console.log(
    `skip  ${basename(join(OUT, "social-preview.png"))}  (no ${join(BRAND, "social@2x.png")})`,
  );
} else {
  await sharp(join(BRAND, "social@2x.png"))
    .resize(1280, 640, { kernel: "lanczos3" })
    .png({ compressionLevel: 9, palette: true, quality: 95 })
    .toFile(join(OUT, "social-preview.png"));
  const size = statSync(join(OUT, "social-preview.png")).size;
  if (size > 1_000_000) console.error(`WARN social-preview.png is ${kb(join(OUT, "social-preview.png"))} — GitHub rejects >1 MB`);
  console.log(`make  social-preview.png  1280x640  ${kb(join(OUT, "social-preview.png"))}`);
}

console.log(`\nstaged ${statSync(OUT).isDirectory() ? "" : ""}assets in .github/assets/`);
