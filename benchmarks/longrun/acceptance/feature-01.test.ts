import { describe, expect, test } from "bun:test";
import { cli, state } from "./_helpers";

describe("feature 01 - category filter", () => {
  test("list --category filters case-insensitively", () => {
    const c = state();
    cli(["add", "2500", "food", "--date", "2026-01-02"], c);
    cli(["add", "12000", "rent", "--date", "2026-01-03"], c);
    cli(["add", "800", "food", "--date", "2026-01-04"], c);
    const r = cli(["list", "--category", "FOOD"], c);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("2500");
    expect(r.stdout).toContain("800");
    expect(r.stdout).not.toContain("rent");
  });

  test("no match prints the empty placeholder", () => {
    const c = state();
    cli(["add", "100", "food", "--date", "2026-01-02"], c);
    const r = cli(["list", "--category", "travel"], c);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("no entries");
  });

  test("--category without a value is a usage error", () => {
    const c = state();
    const r = cli(["list", "--category"], c);
    expect(r.code).toBe(1);
  });

  test("plain list still shows everything", () => {
    const c = state();
    cli(["add", "100", "food", "--date", "2026-01-02"], c);
    cli(["add", "200", "rent", "--date", "2026-01-03"], c);
    const r = cli(["list"], c);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("food");
    expect(r.stdout).toContain("rent");
  });
});
