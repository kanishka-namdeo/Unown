/**
 * Chaconne runner — the disk store (PLAN §1/§2, Ostinato atomic law on
 * fs: temp-file + rename-swap).
 *
 * Layout under `apps/chaconne/data/` (gitignored; `.gitignore` here):
 *
 *   recipes/<id>.json   one canonical recipe document per file
 *   runs/<id>.json      one canonical run record per file
 *   artifacts/          content-addressed: <name> where the name IS
 *                       "<stepIdx>_r<runId>_sha256:<64hex>.<ext>"
 *
 * Atomicity: every write goes to `<path>.tmp` first, then
 * `fs.renameSync(tmp, path)` — atomic on POSIX, so a killed process
 * leaves either the old file or the new one, NEVER a partial one.
 * Boot `recover()` discards orphaned `*.tmp` files (the Ostinato
 * `recover()` law, re-pinned on fs).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { ChaconneData, Recipe, RunRecord } from "../src/domain/types.js";

/** The runner's artifact-name grammar (invariants.ts' check, shared). */
export function artifactName(stepIdx: number, runId: number, sha256: string, ext: string): string {
  return `${stepIdx}_r${runId}_sha256:${sha256}.${ext}`;
}

/** sha256 hex of arbitrary payload bytes (content-addressing). */
export function sha256Hex(payload: Uint8Array | string | Buffer): string {
  return createHash("sha256").update(payload).digest("hex");
}

export class ChaconneDiskStore {
  private readonly dir: string;
  private readonly recipesDir: string;
  private readonly runsDir: string;
  private readonly artifactsDir: string;

  constructor(baseDir: string) {
    this.dir = baseDir;
    this.recipesDir = path.join(baseDir, "recipes");
    this.runsDir = path.join(baseDir, "runs");
    this.artifactsDir = path.join(baseDir, "artifacts");
  }

  /** Boot: create the tree (if needed) and discard orphaned temps. */
  recover(): void {
    for (const d of [this.recipesDir, this.runsDir, this.artifactsDir]) {
      fs.mkdirSync(d, { recursive: true });
    }
    for (const d of [this.recipesDir, this.runsDir]) {
      for (const f of fs.readdirSync(d)) {
        if (f.endsWith(".tmp")) fs.rmSync(path.join(d, f));
      }
    }
  }

  private atomicWrite(finalPath: string, bytes: string | Uint8Array): void {
    const tmp = finalPath + ".tmp";
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, finalPath);
  }

  /** Load every recipe (id-ascending; a missing dir = fresh store). */
  loadRecipes(): Recipe[] {
    if (!fs.existsSync(this.recipesDir)) return [];
    const ids = fs
      .readdirSync(this.recipesDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => parseInt(path.basename(f, ".json"), 10))
      .filter((n) => Number.isInteger(n))
      .sort((a, b) => a - b);
    return ids.map((id) => JSON.parse(fs.readFileSync(path.join(this.recipesDir, `${id}.json`), "utf8")) as Recipe);
  }

  /** Load every run (id-ascending = the run-history order). */
  loadRuns(): RunRecord[] {
    if (!fs.existsSync(this.runsDir)) return [];
    const ids = fs
      .readdirSync(this.runsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => parseInt(path.basename(f, ".json"), 10))
      .filter((n) => Number.isInteger(n))
      .sort((a, b) => a - b);
    return ids.map((id) => JSON.parse(fs.readFileSync(path.join(this.runsDir, `${id}.json`), "utf8")) as RunRecord);
  }

  loadAll(): ChaconneData {
    return { schema: "chaconne.v1", recipes: this.loadRecipes(), runs: this.loadRuns() };
  }

  /** Persist one recipe document (canonical JSON bytes). */
  saveRecipe(recipe: Recipe, canonicalJson: string): void {
    this.atomicWrite(path.join(this.recipesDir, `${recipe.id}.json`), canonicalJson);
  }

  /** Persist one run record (canonical JSON bytes). */
  saveRun(run: RunRecord, canonicalJson: string): void {
    this.atomicWrite(path.join(this.runsDir, `${run.id}.json`), canonicalJson);
  }

  /**
   * Persist an artifact's payload under its CONTENT-ADDRESSED name.
   * Identical bytes → identical name → the same file is re-used
   * (dedup by construction, PRD edge case 7/PLAN §5 row 8). The name
   * is computed here from the payload, so a lying caller cannot
   * clobber a different payload's slot.
   */
  saveArtifact(stepIdx: number, runId: number, ext: string, payload: Uint8Array | string): string {
    const hex = sha256Hex(payload);
    const name = artifactName(stepIdx, runId, hex, ext);
    this.atomicWrite(path.join(this.artifactsDir, name), payload);
    return name;
  }

  artifactRef(stepIdx: number, runId: number, ext: string, payload: Uint8Array | string) {
    const hex = sha256Hex(payload);
    return { name: artifactName(stepIdx, runId, hex, ext), sha256: hex };
  }

  /** Read one artifact back (run-log / extraction report). */
  readArtifact(name: string): string {
    return fs.readFileSync(path.join(this.artifactsDir, name), "utf8");
  }
}
