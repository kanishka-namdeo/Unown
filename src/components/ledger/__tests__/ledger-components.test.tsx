/**
 * Ledger — the component suite (the encore component-test pattern:
 * render the bands against the real seed and pin the structure, the
 * a11y wiring and the displayed figures).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { FlowChart } from "../flow-chart";
import { TxnTable } from "../txn-table";
import { LedgerShell } from "../shell";
import { flowSeries, kpis } from "@/lib/ledger/stats";
import { ACCOUNTS, TXNS } from "@/lib/ledger/seed";
import { money } from "@/lib/ledger/format";

afterEach(cleanup);

describe("LedgerShell — the whole surface", () => {
  test("renders the seven bands with the seeded figures (the drift pin)", () => {
    render(<LedgerShell embed={false} txns={TXNS} />);
    // band 2: the KPI headlines, exactly as the arithmetic computes them
    for (const k of kpis()) {
      expect(screen.getAllByText(k.figure).length).toBeGreaterThan(0);
    }
    // band 4: every merchant renders (two payroll rows share a merchant — AllBy)
    for (const t of TXNS) expect(screen.getAllByText(t.merchant).length).toBeGreaterThan(0);
    // band 5: every account renders with its balance
    for (const a of ACCOUNTS) {
      // the account names also appear in the table's Account column — AllBy
      expect(screen.getAllByText(a.name, { exact: false }).length).toBeGreaterThan(0);
      expect(screen.getByText(money(a.balance))).toBeTruthy();
    }
    // band 6 + 7: the compliance voice + the honesty line
    expect(screen.getAllByText(/Not a bank/i).length).toBeGreaterThan(0); // the compliance band + the footer line
    expect(screen.getAllByText(/design fixture/i).length).toBeGreaterThan(0);
  });

  test("the embed flag drops the header/footer chrome but keeps every band", () => {
    render(<LedgerShell embed txns={TXNS} />);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText("Open an account")).toBeNull();
    for (const k of kpis()) {
      expect(screen.getAllByText(k.figure).length).toBeGreaterThan(0);
    }
  });

  test("the heading outline: one h1, ordered h2s, no skips", () => {
    const { container } = render(<LedgerShell embed={false} txns={TXNS} />);
    const levels = [...container.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => +h.tagName[1]);
    expect(levels.filter((l) => l === 1).length).toBe(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  });

  test("the skip link is first and the sr-only table exists for screen readers", () => {
    const { container } = render(<LedgerShell embed txns={TXNS} />);
    const firstFocusable = container.querySelector("a");
    expect(firstFocusable?.textContent).toContain("Skip to overview");
    const srTable = container.querySelector(".sr-only table");
    expect(srTable).toBeTruthy();
    expect(srTable!.querySelectorAll("tbody tr").length).toBe(90);
  });
});

describe("TxnTable", () => {
  test("sort buttons carry aria-sort on the header cells", () => {
    const { container } = render(<TxnTable txns={TXNS} />);
    // only the SORTABLE ths carry aria-sort (the Account column is not
    // sortable and correctly carries none at all)
    const ths = [...container.querySelectorAll("th")].filter((th) => th.querySelector("button"));
    expect(ths.length).toBe(4);
    const sorted = ths.find((th) => th.getAttribute("aria-sort") === "descending");
    expect(sorted).toBeTruthy();
    expect(sorted?.textContent).toContain("Date"); // the default sort
    for (const th of ths) {
      expect(["none", "ascending", "descending"]).toContain(th.getAttribute("aria-sort") ?? "none");
    }
  });

  test("every status chip renders its status text (never color alone)", () => {
    render(<TxnTable txns={TXNS} />);
    expect(screen.getAllByText("settled").length).toBe(10);
    expect(screen.getAllByText("pending").length).toBe(1);
    expect(screen.getAllByText("failed").length).toBe(1);
  });
});

describe("FlowChart", () => {
  test("the svg is an img with a labeled summary; the sr-only table carries 90 days", () => {
    const { container } = render(<FlowChart series={flowSeries()} />);
    const svg = container.querySelector("svg[role=img]");
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute("aria-label")).toContain("30 Oct 2026");
    expect(container.querySelectorAll(".sr-only tbody tr").length).toBe(90);
    // the scrubber is a labeled native range
    const range = container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(range).toBeTruthy();
    expect(range.getAttribute("aria-valuetext")).toContain("Oct 2026");
  });

  test("the clamp note is honest about the truncated spike", () => {
    render(<FlowChart series={flowSeries()} />);
    expect(screen.getByText(/clamps at/i)).toBeTruthy();
    expect(screen.getAllByText(/18 Sep/i).length).toBeGreaterThan(0); // the note + the scrubber label
  });
});
