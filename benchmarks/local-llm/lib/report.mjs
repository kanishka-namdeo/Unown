/**
 * report.mjs — results persistence + markdown rendering for the testbench.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { RESULTS_DIR, hostInfo } from "./llama.mjs";

/** Create a results run dir: results/<label>/ (default label: <date>-<platform>). */
export function newRunDir(label) {
  const info = hostInfo();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const dir = path.join(RESULTS_DIR, label ?? `${stamp}-${info.platform}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveJson(dir, name, obj) {
  const p = path.join(dir, name);
  writeFileSync(p, JSON.stringify(obj, null, 1));
  return p;
}

// ---------------------------------------------------------------- tables

/** Render rows (array of objects) as a markdown table, with column order from `cols`. */
export function mdTable(rows, cols) {
  if (!rows.length) return "_(no rows)_\n";
  const keys = cols ?? Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    let s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v);
    s = s.replace(/\|/g, "\\|").replace(/\n/g, " ");
    return s.length > 60 ? s.slice(0, 57) + "…" : s;
  };
  const head = `| ${keys.join(" | ")} |`;
  const sep = `| ${keys.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${keys.map((k) => esc(r[k])).join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}\n`;
}

/** Aggregate latency stats from an array of {latencyMs}. */
export function latencyStats(arr) {
  const xs = arr.map((x) => x.latencyMs).filter((v) => typeof v === "number" && v >= 0);
  if (!xs.length) return { n: 0 };
  xs.sort((a, b) => a - b);
  const q = (p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
  return {
    n: xs.length,
    p50: q(0.5),
    p90: q(0.9),
    mean: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length),
    min: xs[0],
    max: xs[xs.length - 1],
  };
}

export function pct(x, digits = 0) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return (100 * x).toFixed(digits) + "%";
}

/**
 * Nullable fixed-point number formatting for receipt tables. A lane can be
 * legitimately absent (e.g. E1 in --no-remote mode nulls every remote stat;
 * an empty aggregate yields {n:0} with no p50) — those render as "—", never
 * a thrown TypeError. Mirrors pct()'s null contract for raw numbers.
 */
export function num(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return Number(v).toFixed(digits);
}
