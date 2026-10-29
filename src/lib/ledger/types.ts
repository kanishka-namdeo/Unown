/**
 * Ledger — the domain types (plan §2).
 *
 * The round-2 validation app's data surface: a seeded, deterministic
 * treasury fixture (the Mercury genre, plan §1). Pure type layer: no
 * values, no I/O — the fugue/encore determinism pin.
 */

/** A money amount in whole dollars (integers only — cents never matter here). */
export type Dollars = number;

/** ISO date, "2026-10-30". */
export type IsoDate = string;

export type TxStatus = "settled" | "pending" | "failed";

/** One ledger transaction (seed row). */
export type Txn = {
  id: string;
  date: IsoDate;
  merchant: string;
  account: AccountId;
  /** Positive = money in, negative = money out. */
  amount: Dollars;
  status: TxStatus;
  category: string;
};

export type AccountId = "operating" | "payroll" | "reserve" | "tax";

export type Account = {
  id: AccountId;
  name: string;
  purpose: string;
  number: string;
  balance: Dollars;
};

/** One day of the 90-day cash-flow series. */
export type FlowDay = {
  date: IsoDate;
  inflow: Dollars;
  outflow: Dollars;
};

/** The whole seeded fixture (plan §2.1 — deterministic, no RNG). */
export type LedgerSeed = {
  asOf: IsoDate;
  accounts: Account[];
  txns: Txn[];
  flow: FlowDay[];
};

/** A KPI card's derived figures (stats.ts computes, the KPI band renders). */
export type Kpi = {
  id: "cash" | "net30" | "runway" | "arr";
  label: string;
  /** The headline figure (numbers-as-headlines, plan §3 band 2). */
  figure: string;
  /** Signed percent vs prior period, null when not comparable. */
  deltaPct: number | null;
  deltaLabel: string;
  receipt: string;
};

/** The chart's computed series + extents (stats.ts). */
export type FlowSeries = {
  days: { date: IsoDate; inflow: Dollars; outflow: Dollars; net: Dollars }[];
  maxAbs: Dollars;
  net90: Dollars;
  start: IsoDate;
  end: IsoDate;
};
