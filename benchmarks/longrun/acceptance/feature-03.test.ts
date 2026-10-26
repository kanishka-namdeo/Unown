import { describe, expect, test } from "bun:test";
import { cli, state } from "./_helpers";

describe("feature 03 - CSV export", () => {
  test("header + rows, insertion order, integer cents", () => {
    const c = state();
    cli(["add", "2500", "food", "--date", "2026-01-02", "--payee", "grocer", "--note", "weekly shop"], c);
    cli(["add", "800", "food", "--date", "2026-01-04"], c);
    const r = cli(["export", "--csv"], c);
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines[0]).toBe("date,amount_cents,category,payee,note");
    expect(lines[1]).toBe("2026-01-02,2500,food,grocer,weekly shop");
    expect(lines[2]).toBe("2026-01-04,800,food,,");
  });

  test("commas and quotes are RFC-4180 escaped", () => {
    const c = state();
    cli(["add", "100", "food", "--date", "2026-01-02", "--note", 'say "hi", ok'], c);
    const r = cli(["export", "--csv"], c);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('"say ""hi"", ok"');
  });

  test("empty ledger prints only the header", () => {
    const c = state();
    const r = cli(["export", "--csv"], c);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("date,amount_cents,category,payee,note");
  });
});
