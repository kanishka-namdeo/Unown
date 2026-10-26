import { describe, expect, test } from "bun:test";
import { cli, state } from "./_helpers";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

describe("feature 07 - undo", () => {
  test("undo reverts the last add", () => {
    const c = state();
    cli(["add", "100", "food", "--date", "2026-01-02"], c);
    cli(["add", "200", "rent", "--date", "2026-01-03"], c);
    const u = cli(["undo"], c);
    expect(u.code).toBe(0);
    const list = cli(["list"], c);
    expect(list.stdout).toContain("100");
    expect(list.stdout).not.toContain("200");
  });

  test("multi-level undo walks the stack across invocations", () => {
    const c = state();
    cli(["add", "100", "food", "--date", "2026-01-02"], c);
    cli(["add", "200", "rent", "--date", "2026-01-03"], c);
    cli(["add", "300", "fun", "--date", "2026-01-04"], c);
    expect(cli(["undo"], c).code).toBe(0);
    expect(cli(["undo"], c).code).toBe(0);
    const list = cli(["list"], c);
    expect(list.stdout).toContain("100");
    expect(list.stdout).not.toContain("200");
    expect(list.stdout).not.toContain("300");
    expect(cli(["balance"], c).stdout).toContain("1.00");
  });

  test("an import undoes as one level", () => {
    const c = state();
    const p = join(c, "in.csv");
    writeFileSync(p, "date,amount_cents,category,payee,note\n2026-01-02,2500,food,,\n2026-01-03,12000,rent,,\n");
    cli(["import", "--csv", p], c);
    cli(["add", "500", "fun", "--date", "2026-01-04"], c);
    const u1 = cli(["undo"], c); // undoes the add
    expect(u1.stdout).toContain("undo add");
    const u2 = cli(["undo"], c); // undoes the WHOLE import
    expect(u2.code).toBe(0);
    const list = cli(["list"], c);
    expect(list.stdout).toContain("no entries");
  });

  test("empty stack: nothing to undo, exit 1", () => {
    const c = state();
    const r = cli(["undo"], c);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain("nothing to undo");
  });
});
