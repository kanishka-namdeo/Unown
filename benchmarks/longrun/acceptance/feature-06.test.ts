import { describe, expect, test } from "bun:test";
import { cli, state, readJson, exists } from "./_helpers";

describe("feature 06 - budgets", () => {
  test("set + report with persistence", () => {
    const c = state();
    cli(["add", "3300", "food", "--date", "2026-01-02"], c);
    const set = cli(["budget", "set", "food", "5000"], c);
    expect(set.code).toBe(0);
    expect(set.stdout).toContain("food");
    expect(set.stdout).toContain("5000");
    expect(exists(c, ".ledger/budgets.json")).toBe(true);
    expect(readJson(c, ".ledger/budgets.json").food).toBe(5000);
    const report = cli(["budget", "report"], c);
    expect(report.code).toBe(0);
    expect(report.stdout).toContain("3300");
    expect(report.stdout).toContain("5000");
    expect(report.stdout).not.toContain("OVER");
  });

  test("OVER flag when spent exceeds the cap", () => {
    const c = state();
    cli(["add", "6300", "food", "--date", "2026-01-02"], c);
    cli(["budget", "set", "food", "5000"], c);
    const r = cli(["budget", "report"], c);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("OVER");
  });

  test("no budgets -> placeholder, exit 0", () => {
    const c = state();
    const r = cli(["budget", "report"], c);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("no budgets");
  });

  test("bad values are usage errors", () => {
    const c = state();
    expect(cli(["budget", "set", "Food!", "100"], c).code).toBe(1);
    expect(cli(["budget", "set", "food", "-2"], c).code).toBe(1);
    expect(cli(["budget"], c).code).toBe(1);
  });
});
