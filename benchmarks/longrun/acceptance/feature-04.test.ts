import { describe, expect, test } from "bun:test";
import { cli, state } from "./_helpers";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

describe("feature 04 - CSV import", () => {
  function csvFile(c: string, body: string): string {
    const p = join(c, "in.csv");
    writeFileSync(p, body);
    return p;
  }

  test("imports valid rows, reports counts, honors quoting", () => {
    const c = state();
    const p = csvFile(
      c,
      'date,amount_cents,category,payee,note\n2026-01-02,2500,food,grocer,"weekly, shop"\n2026-01-03,12000,rent,,\n',
    );
    const r = cli(["import", "--csv", p], c);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("imported 2 entries");
    const listed = cli(["list"], c);
    expect(listed.stdout).toContain("2500");
    expect(listed.stdout).toContain("12000");
  });

  test("bad rows are skipped with a warning; good rows still import", () => {
    const c = state();
    const p = csvFile(
      c,
      "date,amount_cents,category,payee,note\n2026-01-02,2500,food,,\n2026-01-03,-5,food,,\nbaddate,100,food,,\n2026-01-04,300,rent,,\n",
    );
    const r = cli(["import", "--csv", p], c);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("imported 2 entries, skipped 2");
    expect(r.stderr).toContain("row");
    const bal = cli(["list"], c);
    expect(bal.stdout).toContain("2500");
    expect(bal.stdout).toContain("300");
  });

  test("missing file is an error naming the path", () => {
    const c = state();
    const r = cli(["import", "--csv", join(c, "nope.csv")], c);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain("nope.csv");
  });

  test("wrong header is an error", () => {
    const c = state();
    const p = csvFile(c, "a,b,c,d,e\n1,2,3,4,5\n");
    const r = cli(["import", "--csv", p], c);
    expect(r.code).toBe(1);
  });
});
