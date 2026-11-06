#!/usr/bin/env bun
/**
 * C-8 — the import/export battery's golden-file regenerator + drift gate
 * (PLAN §5 C-8 row, edge cases 9 + 10; the Ostinato O-4 golden-lane law).
 *
 * The SINGLE SOURCE is `test/golden/io-fixture.ts` (the fixture
 * datasets). This script serializes that source through `src/domain/io.ts`
 * (the LANDED contract — its shape governs, never re-derived here) and
 * writes three golden files under `test/golden/`:
 *
 *   - export.golden.json        — the unicode fixture through toCanonicalJson
 *     (RAW UTF-8 bytes, never \u-escaped: JSON.stringify emits the source
 *     strings as-is; the gate proves no drift).
 *   - import-refused.golden.json — the chaconne.v2 future-schema document
 *     (edge case 10's INPUT, canonical JSON so its bytes are stable too).
 *   - dry-run-refused.golden.json — the dry-run REPORT the UI renders for
 *     that refusal (wouldImport counts + the reason lines, exact string
 *     of app.ts's import action).
 *
 * Modes:
 *   `bun apps/chaconne/scripts/regen-golden.ts`          — WRITE mode:
 *     regenerate the three goldens from the fixture source; print what
 *     changed (byte-diff per file). The deliberate-update lane.
 *   `bun apps/chaconne/scripts/regen-golden.ts --check`  — CHECK mode:
 *     regenerate in memory and assert BYTE-EQUALITY with the committed
 *     goldens; exit 0 on match, exit 1 on any drift (the gate).
 *
 * The script imports io.ts's `toCanonicalJson` + `createImportExport`
 * directly (bun transpiles the .ts), so the goldens are ALWAYS
 * produced by the domain's own serializer — never by a copy of its
 * logic in this script (a copy is the drift this gate exists to catch).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toCanonicalJson, createImportExport } from "../src/domain/io.js";
import { exportFixture, refusedFixture } from "../test/golden/io-fixture.js";

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(here, "..", "test", "golden");

// ─── The three goldens, serialized through the domain's own lane ──────────

/** Edge case 9: the unicode fixture → canonical JSON, raw UTF-8. */
function buildExportGolden(): string {
  return toCanonicalJson(exportFixture);
}

/** Edge case 10: the chaconne.v2 document (canonical form of the input). */
function buildRefusedGolden(): string {
  // The refused fixture's shape is stable, but it carries schema "chaconne.v2"
  // so exportData's assertData gate would REJECT it (the schema literal is
  // "chaconne.v1"). This golden pins the INPUT document itself, serialized
  // through toCanonicalJson's sortKeysDeep (an exported function), which
  // does NOT run assertData — the byte-stability of the input is what the
  // battery compares against.
  return toCanonicalJson(refusedFixture as never);
}

/**
 * The dry-run report golden: exactly what `importData(refusedGolden)`
 * returns (the wouldImport counts + the reason lines), canonical-
 * serialized so the golden pins its byte form.
 */
function buildDryRunGolden(): string {
  const io = createImportExport();
  const res = io.importData(buildRefusedGolden());
  if (!("report" in res) || res.report === undefined) {
    throw new Error("C-8 golden build: the chaconne.v2 fixture was NOT refused — the schema gate regressed");
  }
  return toCanonicalJson(res.report as never);
}

interface Golden {
  name: string;
  build: () => string;
}

const GOLDENS: Golden[] = [
  { name: "export.golden.json", build: buildExportGolden },
  { name: "import-refused.golden.json", build: buildRefusedGolden },
  { name: "dry-run-refused.golden.json", build: buildDryRunGolden },
];

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// ─── Modes ────────────────────────────────────────────────────────────────────

const check = process.argv.includes("--check");

let anyDrift = false;

for (const g of GOLDENS) {
  const bytes = g.build();
  const path = join(GOLDEN_DIR, g.name);
  const committed = existsSync(path) ? readFileSync(path) : null;
  const committedHex = committed === null ? "(absent)" : sha256Hex(committed);
  const freshHex = sha256Hex(Buffer.from(bytes, "utf8"));

  if (check) {
    if (committed === null || committedHex !== freshHex) {
      anyDrift = true;
      console.error(`DRIFT ${g.name}`);
      console.error(`  committed sha256: ${committedHex}`);
      console.error(`  fresh     sha256: ${freshHex}`);
      if (committed !== null) {
        // Show the first diverging byte region (the honest diff surface).
        const committedText = committed.toString("utf8");
        const idx = (() => {
          for (let i = 0; i < Math.min(committedText.length, bytes.length); i++) {
            if (committedText[i] !== bytes[i]) return i;
          }
          return committedText.length === bytes.length ? -1 : committedText.length;
        })();
        if (idx === -1) {
          console.error("  (byte-identical length/chars; length mismatch only)" );
        } else {
          const around = (s: string, i: number) => s.slice(Math.max(0, i - 24), i + 24);
          console.error(`  first divergence at char ${idx}`);
          console.error(`  committed …${JSON.stringify(around(committedText, idx))}`);
          console.error(`  fresh     …${JSON.stringify(around(bytes, idx))}`);
        }
      }
    } else {
      console.log(`ok  ${g.name} (sha256 ${freshHex.slice(0, 12)}…)`);
    }
    continue;
  }

  // WRITE mode (the deliberate-update lane): write the bytes, report.
  mkdirSync(dirname(path), { recursive: true });
  const freshBuf = Buffer.from(bytes, "utf8");
  writeFileSync(path, freshBuf, "utf8");
  if (committed === null) {
    console.log(`created ${g.name} (sha256 ${freshHex.slice(0, 12)}…)`);
  } else if (committedHex !== freshHex) {
    anyDrift = true;
    console.log(`updated ${g.name}: sha256 ${committedHex.slice(0, 12)}… → ${freshHex.slice(0, 12)}…`);
  } else {
    console.log(`unchanged ${g.name} (sha256 ${freshHex.slice(0, 12)}…)`);
  }
}

if (check) {
  if (anyDrift) {
    console.error(`\nregression: golden drift detected — run WITHOUT --check to deliberately update`);
    process.exit(1);
  }
  console.log(`\nall ${GOLDENS.length} goldens byte-identical`);
} else if (anyDrift) {
  console.log(`\n${GOLDENS.length} goldens written (one or more byte-changed — review before committing)`);
} else {
  console.log(`\nall ${GOLDENS.length} goldens unchanged`);
}
