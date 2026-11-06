/**
 * Chaconne e2e lane (C-6) — the disk-store seeder.
 *
 * Seeds a fresh runner disk store (recipes/ + runs/ + artifacts/)
 * from the keyboard composer's localStorage document: one recipe
 * JSON file + one run JSON file, laid out exactly as the C-2
 * store.ts's ChaconneDiskStore expects. The e2e flow spec imports
 * this helper to stage the runner's input before launching the
 * CLI (`bun apps/chaconne/runner/index.ts run 1 --data-dir <tmp>`).
 *
 * This is a plain .js helper (no TypeScript syntax) so the e2e
 * import stays module-graph-simple from the spec's perspective.
 * It touches ONLY the tmp dir the spec created — never any file
 * outside e2e/ + the caller's tmp.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * @param {string} dataDir the temp store dir (the spec's mkdtempSync result)
 * @param {string} recipeJson the canonical recipe document (JSON.stringify of the app's localStorage recipe row)
 * @param {string} runJson the canonical earlier-run record (the fake-lane run the spec seeds so the runner's id counter starts at 2)
 */
export function seedStore(dataDir, recipeJson, runJson) {
  for (const d of ["recipes", "runs", "artifacts"]) {
    fs.mkdirSync(path.join(dataDir, d), { recursive: true });
  }
  fs.writeFileSync(path.join(dataDir, "recipes", "1.json"), recipeJson);
  fs.writeFileSync(path.join(dataDir, "runs", "1.json"), runJson);
}
