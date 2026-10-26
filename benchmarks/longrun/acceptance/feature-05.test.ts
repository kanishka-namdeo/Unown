import { describe, expect, test } from "bun:test";
import { cli, state } from "./_helpers";

describe("feature 05 - monthly summary", () => {
  test("per-category totals plus the total line", () => {
    const c = state();
    cli(["add", "2500", "food", "--date", "2026-01-02"], c);
    cli(["add", "800", "food", "--date", "2026-01-04"], c);
    cli(["add", "12000", "rent", "--date", "2026-01-03"], c);
    cli(["add", "500", "food", "--date", "2026-02-01"], c);
    const r = cli(["summary", "--month", "2026-01"], c);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("food");
    expect(r.stdout).toContain("3300");
    expect(r.stdout).toContain("rent");
    expect(r.stdout).toContain("12000");
    expect(r.stdout).toContain("total");
    expect(r.stdout).toContain("15300");
    expect(r.stdout).not.toContain("500");
  });

  test("month with no entries prints total 0", () => {
    const c = state();
    cli(["add", "100", "food", "--date", "2026-01-02"], c);
    const r = cli(["summary", "--month", "2026-05"], c);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("total");
    expect(r.stdout).toContain("0");
  });

  test("bad month format is a usage error", () => {
    const c = state();
    const r = cli(["summary", "--month", "jan-2026"], c);
    expect(r.code).toBe(1);
  });
});
