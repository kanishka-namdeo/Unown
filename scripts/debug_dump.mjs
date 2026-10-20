#!/usr/bin/env node
/** debug_dump.mjs — print each creature's pixel canvas as ASCII so the
 *  artist can eyeball the actual silhouette (one char per pixel). */
import { make, outlinePass } from "./creature_kit.mjs";
import { SPRITES } from "./creature_atlas.mjs";

const ids = process.argv.slice(2);
for (const s of SPRITES) {
  if (ids.length && !ids.includes(s.id)) continue;
  const c = outlinePass(s.draw(make()));
  console.log(`\n=== ${s.id} ===`);
  for (let y = 0; y < 64; y++) {
    let row = "";
    for (let x = 0; x < 64; x++) {
      const k = c[y][x];
      row += k === null ? " " : (k === "O" ? "#" : k === "W" ? "*" : k.toLowerCase());
    }
    if (row.trim()) console.log(String(y).padStart(2), row.replace(/\s+$/, ""));
  }
}
