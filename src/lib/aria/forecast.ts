/**
 * Pure forecast math: weighted pipeline value, the commit ladder,
 * rollups and coverage. All functions take state + an explicit
 * `now` where time matters; zero I/O.
 *
 * The invariant pinned by `invariant.test.ts`: every total here is
 * recomputable from the raw deal rows — `snapshotMath` is the single
 * source of truth both the live report route and the snapshot
 * drill-down recompute with.
 */

import type { AriaDeal, AriaPipeline, AriaState } from "./types";

/** `amount × stage probability` (a 0..1 fraction; `probability` is stored 0..1). */
export function weightedValue(deal: AriaDeal, pipeline: AriaPipeline): number {
  const stage = pipeline.stages.find((s) => s.id === deal.stageId);
  const p = stage ? stage.probability : 0;
  return deal.amount * p;
}

export interface ForecastRollup {
  /** Sum of `weightedValue` over the given deals. */
  weightedTotal: number;
  byStage: Record<string, number>;
  byCategory: Record<string, number>;
  /** The raw record ids this total was computed from (drill-down). */
  dealIds: string[];
}

/**
 * The snapshot math over a set of deals + their pipeline. This is
 * what `AriaForecastSnapshot` freezes, and what the drill-down route
 * recomputes — same inputs, same totals (the P1 forecast-drift pin).
 */
export function snapshotMath(deals: AriaDeal[], pipeline: AriaPipeline): ForecastRollup {
  const byStage: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let weightedTotal = 0;
  const dealIds: string[] = [];
  for (const d of deals) {
    const w = weightedValue(d, pipeline);
    weightedTotal += w;
    byStage[d.stageId] = (byStage[d.stageId] ?? 0) + w;
    byCategory[d.forecastCategory] = (byCategory[d.forecastCategory] ?? 0) + w;
    dealIds.push(d.id);
  }
  return { weightedTotal, byStage, byCategory, dealIds };
}

/**
 * The open pipeline for a tenant at `now` (the forecast's input):
 * open deals only (`closedAt === null`), optionally scoped to a
 * pipeline.
 */
export function openDealsFor(state: AriaState, tenantId: string, pipelineId?: string): AriaDeal[] {
  return state.deals.filter(
    (d) =>
      d.tenantId === tenantId &&
      d.closedAt === null &&
      (pipelineId ? d.pipelineId === pipelineId : true),
  );
}

/** The commit ladder (the `reports/forecast` route's core). */
export interface CommitLadder {
  /** Sum of open deals in the commit category. */
  commit: number;
  /** commit + best_case. */
  bestCase: number;
  /** bestCase + pipeline (the weighted totals, unadjusted amounts in-category). */
  pipeline: number;
}

/**
 * The ladder sums UNADJUSTED amounts by category (the standard
 * forecast shape: "how much did I commit, how much on top").
 * `omitted` deals are excluded from every rung.
 */
export function commitLadder(deals: AriaDeal[]): CommitLadder {
  const sum = (cats: string[]) =>
    deals
      .filter((d) => cats.includes(d.forecastCategory))
      .reduce((acc, d) => acc + d.amount, 0);
  return {
    commit: sum(["commit"]),
    bestCase: sum(["commit", "best_case"]),
    pipeline: sum(["commit", "best_case", "pipeline"]),
  };
}

/**
 * Coverage ratio: `commit / target` (0 when the target is 0 — a
 * no-quota tenant shows "n/a" in the UI).
 */
export function coverage(commit: number, target: number): number {
  if (target <= 0) return 0;
  return commit / target;
}

/**
 * Per-rep breakdown for the forecast report: each rep's quota (the
 * tenant's `quotas` map), their open commit + booked amounts, and
 * what remains. Pure.
 */
export function byRep(
  state: AriaState,
  tenantId: string,
  ownerId: string,
): { quota: number; actual: number; remaining: number } {
  const tenant = state.tenants.find((t) => t.id === tenantId);
  const quota = tenant?.quotas[ownerId] ?? 0;
  const open = state.deals.filter(
    (d) => d.tenantId === tenantId && d.ownerId === ownerId && d.closedAt === null,
  );
  const actual = open
    .filter((d) => d.forecastCategory === "commit" || d.forecastCategory === "best_case")
    .reduce((acc, d) => acc + d.amount, 0);
  return { quota, actual, remaining: Math.max(0, quota - actual) };
}
