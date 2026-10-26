import { describe, expect, test } from "bun:test";
import { cli, state, readJson } from "./_helpers";

describe("feature 09 - recurring entries", () => {
  test("add + list + apply", () => {
    const c = state();
    const add = cli(["recur", "add", "1500", "food", "--every", "month", "--day", "15"], c);
    expect(add.code).toBe(0);
    expect(add.stdout).toContain("r-001");
    const list = cli(["recur", "list"], c);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain("r-001");
    const apply = cli(["recur", "apply", "--month", "2026-03"], c);
    expect(apply.code).toBe(0);
    expect(apply.stdout).toContain("applied 1 entries for 2026-03");
    const entries = cli(["list"], c);
    expect(entries.stdout).toContain("2026-03-15");
    expect(entries.stdout).toContain("1500");
  });

  test("apply is idempotent per month", () => {
    const c = state();
    cli(["recur", "add", "1500", "food", "--every", "month", "--day", "15"], c);
    cli(["recur", "apply", "--month", "2026-03"], c);
    const again = cli(["recur", "apply", "--month", "2026-03"], c);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("applied 0 entries");
    const list = cli(["list"], c);
    expect(list.stdout.match(/2026-03-15/g) ?? []).toHaveLength(1);
  });

  test("appliedMonths tracked in recurring.json", () => {
    const c = state();
    cli(["recur", "add", "1500", "food", "--every", "month", "--day", "15"], c);
    cli(["recur", "apply", "--month", "2026-03"], c);
    const data = readJson(c, ".ledger/recurring.json");
    const t = (Array.isArray(data) ? data[0] : data.templates?.[0]) ?? {};
    const months = t.appliedMonths ?? [];
    expect(months).toContain("2026-03");
  });

  test("bad every/day are usage errors", () => {
    const c = state();
    expect(cli(["recur", "add", "100", "food", "--every", "week", "--day", "15"], c).code).toBe(1);
    expect(cli(["recur", "add", "100", "food", "--every", "month", "--day", "31"], c).code).toBe(1);
  });
});
