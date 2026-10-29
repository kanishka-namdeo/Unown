/**
 * Ledger — the drift gate (the encore seed.test pattern: the displayed
 * figures are asserted against the SEED's arithmetic, so a fixture edit
 * that drifts a headline fails the suite).
 */
import { describe, expect, test } from "bun:test";
import { ACCOUNTS, AS_OF, CASH_POSITION, FLOW, MONTHLY_BURN, PRIOR_NET_30, TXNS } from "./seed";
import { kpis, netTrailing, runway, sortTxns, statusTone, flowSeries } from "./stats";
import { money, moneyCompact, pct, shortDate } from "./format";

describe("seed — the fixture's own arithmetic", () => {
  test("cash position is the accounts' sum", () => {
    expect(CASH_POSITION).toBe(ACCOUNTS.reduce((n, a) => n + a.balance, 0));
    expect(CASH_POSITION).toBe(3_733_800);
  });

  test("the 90-day series is 90 days, contiguous, from 2026-08-02", () => {
    expect(FLOW.length).toBe(90);
    expect(FLOW[0]!.date).toBe("2026-08-02");
    expect(FLOW[89]!.date).toBe(AS_OF);
    for (let i = 1; i < FLOW.length; i++) {
      const prev = new Date(FLOW[i - 1]!.date).getTime();
      const cur = new Date(FLOW[i]!.date).getTime();
      expect(cur - prev).toBe(86_400_000);
    }
  });

  test("the tranche and the renewal are present and fixed", () => {
    const tranche = FLOW.find((d) => d.date === "2026-09-18")!;
    const renewal = FLOW.find((d) => d.date === "2026-10-27")!;
    // the spike values are the base series + the fixed additions
    expect(tranche.inflow).toBeGreaterThan(1_250_000);
    expect(renewal.outflow).toBeGreaterThan(88_000);
  });

  test("twelve transactions, unique ids, plausible money", () => {
    expect(TXNS.length).toBe(12);
    expect(new Set(TXNS.map((t) => t.id)).size).toBe(12);
    for (const t of TXNS) expect(Number.isInteger(t.amount)).toBe(true);
  });
});

describe("stats — the derived figures the KPI band renders", () => {
  test("flowSeries: net per day, extents, the 90-day net", () => {
    const s = flowSeries();
    expect(s.days.length).toBe(90);
    expect(s.days[0]!.net).toBe(s.days[0]!.inflow - s.days[0]!.outflow);
    expect(s.maxAbs).toBe(Math.max(...s.days.flatMap((d) => [Math.abs(d.inflow), Math.abs(d.outflow)])));
    expect(s.net90).toBe(s.days.reduce((n, d) => n + d.net, 0));
  });

  test("netTrailing(30) reads the LAST 30 days", () => {
    const manual = FLOW.slice(-30).reduce((s, d) => s + (d.inflow - d.outflow), 0);
    expect(netTrailing(30)).toBe(manual);
  });

  test("runway: cash / burn, never negative", () => {
    expect(runway(3_733_800, MONTHLY_BURN)).toBeCloseTo(17.45, 1);
    expect(runway(100, MONTHLY_BURN)).toBeLessThan(0.01);
    expect(runway(1_000_000, 0)).toBe(0);
  });

  test("the four KPI cards: figures match the arithmetic (the drift pin)", () => {
    const cards = kpis();
    expect(cards.map((c) => c.id)).toEqual(["cash", "net30", "runway", "arr"]);
    const cash = cards[0]!;
    expect(cash.figure).toBe(money(CASH_POSITION));
    const net30 = cards[1]!;
    expect(net30.deltaPct).toBe(+(((netTrailing(30) - PRIOR_NET_30) / Math.abs(PRIOR_NET_30)) * 100).toFixed(1));
    const run = cards[2]!;
    expect(run.deltaPct).toBeNull();
    expect(run.figure).toBe(`${Math.round(runway(CASH_POSITION, MONTHLY_BURN))} mo`);
  });

  test("sortTxns sorts by every column, both directions, without mutating input", () => {
    const input = [...TXNS];
    for (const key of ["date", "merchant", "amount", "status"] as const) {
      const asc = sortTxns(TXNS, key, "asc");
      const desc = sortTxns(TXNS, key, "desc");
      expect(asc.length).toBe(12);
      expect(asc[0]).not.toBe(desc[0]);
    }
    expect(TXNS).toEqual(input);
  });

  test("statusTone maps the three statuses", () => {
    expect(statusTone("settled")).toBe("pos");
    expect(statusTone("pending")).toBe("neutral");
    expect(statusTone("failed")).toBe("neg");
  });
});

describe("format — one spelling per figure class", () => {
  test("money: thousands separators, the true minus sign", () => {
    expect(money(1_284_600)).toBe("$1,284,600");
    expect(money(-4_120)).toBe("−$4,120");
    expect(money(0)).toBe("$0");
  });

  test("moneyCompact: k and M bands", () => {
    expect(moneyCompact(48_213)).toBe("$48.2k");
    expect(moneyCompact(1_250_000)).toBe("$1.25M");
    expect(moneyCompact(-96_400)).toBe("−$96.4k");
    expect(moneyCompact(712)).toBe("$712");
  });

  test("pct: signed, one decimal", () => {
    expect(pct(12.44)).toBe("+12.4%");
    expect(pct(-8.06)).toBe("−8.1%");
    expect(pct(0)).toBe("0.0%");
  });

  test("shortDate: built by hand, locale-stable", () => {
    expect(shortDate("2026-10-30")).toBe("30 Oct 2026");
    expect(shortDate("2026-01-05")).toBe("5 Jan 2026");
  });
});
