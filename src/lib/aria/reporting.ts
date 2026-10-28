/**
 * Pure reporting: win rate, sales cycle, funnel, cohorts, drill-down.
 * Every function takes state + an explicit `now` and returns
 * recomputable numbers — the "open the number" drill-down invariant
 * pins each total against the raw records.
 */

import type { AriaDeal, AriaPipeline, AriaState } from "./types";

/* ── win rate ─────────────────────────────────────────────────────── */

export interface WinRate {
  won: number;
  lost: number;
  /** 0..1 (won / closed, 0 when no closed deals). */
  rate: number;
  byOwner: Record<string, { won: number; lost: number; rate: number }>;
}

/**
 * Win rate over deals closed in `[periodStart, periodEnd)` (the
 * `reports/winrate` route's math). A deal counts when its
 * `closedAt` lands in the window; `won` = a won close.
 */
export function winRate(
  deals: AriaDeal[],
  periodStart: string,
  periodEnd: string,
): WinRate {
  const s = new Date(periodStart).getTime();
  const e = new Date(periodEnd).getTime();
  const closed = deals.filter(
    (d) =>
      d.closedAt !== null &&
      new Date(d.closedAt).getTime() >= s &&
      new Date(d.closedAt).getTime() < e,
  );
  const won = closed.filter((d) => d.forecastCategory === "closed" && d.lostReason === null).length;
  const lost = closed.length - won;
  const byOwner: Record<string, { won: number; lost: number; rate: number }> = {};
  for (const d of closed) {
    const o = (byOwner[d.ownerId] ??= { won: 0, lost: 0, rate: 0 });
    if (d.forecastCategory === "closed" && d.lostReason === null) o.won += 1;
    else o.lost += 1;
  }
  for (const o of Object.values(byOwner)) o.rate = o.won + o.lost === 0 ? 0 : o.won / (o.won + o.lost);
  return { won, lost, rate: won + lost === 0 ? 0 : won / (won + lost), byOwner };
}

/** `true` when a deal closed WON (its terminal stage is a won stage). */
export function isWon(deal: AriaDeal, pipeline: AriaPipeline | undefined): boolean {
  if (deal.closedAt === null || !pipeline) return false;
  const stage = pipeline.stages.find((s) => s.id === deal.stageId);
  return stage?.state === "closed_won";
}

/* ── sales cycle ──────────────────────────────────────────────────── */

export interface SalesCycle {
  /** Median days from createdAt → closedAt over closed deals (0 when none). */
  medianDays: number;
  byOwner: Record<string, number>;
}

/**
 * Sales cycle: median days-to-close per owner + overall, over
 * `deals` closed within the tenant scope. Pure.
 */
export function salesCycle(deals: AriaDeal[]): SalesCycle {
  const daysOf = (d: AriaDeal): number =>
    (new Date(d.closedAt!).getTime() - new Date(d.createdAt).getTime()) / 86_400_000;
  const all = deals.filter((d) => d.closedAt !== null).map(daysOf);
  const median = (xs: number[]): number => {
    if (xs.length === 0) return 0;
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const perOwner: Record<string, number[]> = {};
  for (const d of deals) {
    if (d.closedAt === null) continue;
    (perOwner[d.ownerId] ??= []).push(daysOf(d));
  }
  const byOwner: Record<string, number> = {};
  for (const [k, xs] of Object.entries(perOwner)) byOwner[k] = median(xs);
  return { medianDays: median(all), byOwner };
}

/* ── funnel ───────────────────────────────────────────────────────── */

export interface FunnelStage {
  id: string;
  name: string;
  count: number;
  /** Deals in this stage / deals in the FIRST stage (1 = 100%). */
  conversion: number;
}

/**
 * The stage funnel: deal counts per stage (current stage of each
 * deal) + the conversion ratio against the first stage.
 */
export function funnel(state: AriaState, tenantId: string, pipelineId: string): FunnelStage[] {
  const pipeline = state.pipelines.find((p) => p.id === pipelineId && p.tenantId === tenantId);
  if (!pipeline) return [];
  const deals = state.deals.filter(
    (d) => d.tenantId === tenantId && d.pipelineId === pipelineId,
  );
  const counts: Record<string, number> = {};
  for (const d of deals) counts[d.stageId] = (counts[d.stageId] ?? 0) + 1;
  const base = counts[pipeline.stages[0]?.id] ?? 0;
  return pipeline.stages.map((s) => ({
    id: s.id,
    name: s.name,
    count: counts[s.id] ?? 0,
    conversion: base === 0 ? 0 : (counts[s.id] ?? 0) / base,
  }));
}

/* ── cohorts ──────────────────────────────────────────────────────── */

export interface Cohort {
  /** YYYY-MM of the deals' creation month. */
  month: string;
  created: number;
  won: number;
  /** won / created (0 when created is 0). */
  winRate: number;
}

/**
 * Deal cohorts by creation month (the last `months` months ending at
 * `now`, inclusive). Pure.
 */
export function cohorts(deals: AriaDeal[], months: number, now: string): Cohort[] {
  const end = new Date(now);
  const out: Cohort[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const inMonth = deals.filter((x) => x.createdAt.startsWith(key));
    const won = inMonth.filter((x) => x.closedAt !== null && x.lostReason === null && x.forecastCategory === "closed").length;
    out.push({
      month: key,
      created: inMonth.length,
      won,
      winRate: inMonth.length === 0 ? 0 : won / inMonth.length,
    });
  }
  return out;
}

/* ── drill-down ───────────────────────────────────────────────────── */

export interface DrillDown {
  metric: "weighted" | "commit" | "stage";
  value: string;
  records: AriaDeal[];
}

/**
 * The "open the number" route: given a metric + value, return the
 * raw deal rows the number was computed from.
 *  - `weighted`/`commit` + value = a deal id → that deal.
 *  - `stage` + value = a stage id → the deals currently in it.
 */
export function drillDown(
  state: AriaState,
  tenantId: string,
  metric: "weighted" | "commit" | "stage",
  value: string,
): DrillDown {
  const inTenant = state.deals.filter((d) => d.tenantId === tenantId);
  let records: AriaDeal[];
  if (metric === "stage") {
    records = inTenant.filter((d) => d.stageId === value);
  } else if (metric === "commit") {
    records = inTenant.filter((d) => d.forecastCategory === "commit" && d.id === value).length
      ? inTenant.filter((d) => d.id === value)
      : inTenant.filter((d) => d.forecastCategory === "commit");
  } else {
    records = inTenant.filter((d) => d.id === value).length
      ? inTenant.filter((d) => d.id === value)
      : inTenant.filter((d) => d.closedAt === null);
  }
  return { metric, value, records };
}

/* ── stuck deals ──────────────────────────────────────────────────── */

/**
 * Deals stalled ≥ `days` in their CURRENT stage (the `reports/stuck`
 * route). A deal is stalled when `now - lastStageChangeAt ≥ days`.
 */
export function stuckDeals(
  deals: AriaDeal[],
  days: number,
  now: string,
): AriaDeal[] {
  const cutoff = new Date(now).getTime() - days * 86_400_000;
  return deals.filter(
    (d) => d.closedAt === null && new Date(d.lastStageChangeAt).getTime() <= cutoff,
  );
}

/**
 * Deals whose expected close date SLIPPED ≥ 1× from the original
 * (the `reports/slipped` route). A deal slips when its expected
 * close moved later than its createdAt-month — proxy: `expectedCloseDate`
 * is at least one full quarter after `createdAt`.
 */
export function slippedDeals(deals: AriaDeal[], now: string): AriaDeal[] {
  const quarterMs = 91 * 86_400_000;
  return deals.filter((d) => {
    if (d.closedAt !== null) return false;
    const created = new Date(d.createdAt).getTime();
    const close = new Date(d.expectedCloseDate + "T00:00:00Z").getTime();
    return close - created >= quarterMs;
  });
}
