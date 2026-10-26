import { describe, expect, test } from "bun:test";
import { cli, state } from "./_helpers";

describe("feature 02 - date range filter", () => {
  test("range filters inclusively on both ends", () => {
    const c = state();
    cli(["add", "100", "a", "--date", "2026-01-01"], c);
    cli(["add", "200", "b", "--date", "2026-01-15"], c);
    cli(["add", "300", "c", "--date", "2026-01-31"], c);
    cli(["add", "400", "d", "--date", "2026-02-01"], c);
    const r = cli(["list", "--from", "2026-01-01", "--to", "2026-01-31"], c);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("100");
    expect(r.stdout).toContain("200");
    expect(r.stdout).toContain("300");
    expect(r.stdout).not.toContain("400");
  });

  test("combines with --category (AND)", () => {
    const c = state();
    cli(["add", "100", "food", "--date", "2026-01-05"], c);
    cli(["add", "200", "rent", "--date", "2026-01-06"], c);
    cli(["add", "300", "food", "--date", "2026-02-06"], c);
    const r = cli(["list", "--category", "food", "--from", "2026-01-01", "--to", "2026-01-31"], c);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("100");
    expect(r.stdout).not.toContain("rent");
    expect(r.stdout).not.toContain("300");
  });

  test("invalid date value is an error naming the value", () => {
    const c = state();
    const r = cli(["list", "--from", "01-01-2026", "--to", "2026-01-31"], c);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain("01-01-2026");
  });

  test("inverted range matches nothing, not an error", () => {
    const c = state();
    cli(["add", "100", "a", "--date", "2026-01-05"], c);
    const r = cli(["list", "--from", "2026-02-01", "--to", "2026-01-01"], c);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("no entries");
  });
});
