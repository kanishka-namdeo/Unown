import { describe, expect, test } from "bun:test";
import { cli, state, read, exists } from "./_helpers";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

describe("feature 08 - audit log", () => {
  test("mutating ops journal; reads do not", () => {
    const c = state();
    cli(["add", "2500", "food", "--date", "2026-01-02"], c);
    cli(["list"], c);
    cli(["balance"], c);
    expect(exists(c, ".ledger/audit.log")).toBe(true);
    const log = read(c, ".ledger/audit.log");
    expect(log).toContain(" ADD e-001 food 2500");
    expect(log.split("\n").filter(Boolean)).toHaveLength(1);
  });

  test("audit prints in append order, capped at 20 entries, ellipsis when older exist", () => {
    const c = state();
    for (let i = 0; i < 25; i++) cli(["add", "100", "food", "--date", "2026-01-02"], c);
    const r = cli(["audit"], c);
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split("\n");
    // Shape-tolerant (LR calibration, 2026-10-27): the ellipsis may share the
    // first entry's line (a prefix) or stand alone — the spec pins "at most 20
    // entries shown, prefixed with …", not the line layout.
    const entryLines = lines.filter((l) => / ADD e-\d+ /.test(l));
    expect(entryLines.length).toBe(20);
    expect(lines.some((l) => l.startsWith("…"))).toBe(true);
    expect(entryLines[0]).toContain("e-006");
    expect(entryLines[19]).toContain("e-025");
  });

  test("empty journal prints placeholder exit 0", () => {
    const c = state();
    const r = cli(["audit"], c);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("no audit entries");
  });

  test("import journals one IMPORT line", () => {
    const c = state();
    const p = join(c, "in.csv");
    writeFileSync(p, "date,amount_cents,category,payee,note\n2026-01-02,2500,food,,\n2026-01-03,12000,rent,,\n");
    cli(["import", "--csv", p], c);
    const log = read(c, ".ledger/audit.log");
    expect(log).toMatch(/ IMPORT 2/);
  });
});
