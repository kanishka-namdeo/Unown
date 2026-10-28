/**
 * Deterministic AI triage: lead score, deal health, next-best-action
 * and anomaly detection.
 *
 * Everything is a pure function of the state + an explicit `now` —
 * no model calls, no randomness. The "AI" is the documented rule
 * engine: weighted components that sum to a 0-100 score, a A-D
 * health grade from stall/velocity signals, and three anomaly
 * detectors (amount outlier at 2σ, forecast drift vs the last
 * snapshot, quarter-end bunching).
 */

import type { AriaDeal, AriaLead, AriaPipeline, AriaState } from "./types";

/* ── lead score ─────────────────────────────────────────────────── */

export interface LeadScoreComponent {
  name: string;
  weight: number;
  value: number;
}

export interface LeadScore {
  lead: AriaLead;
  /** 0-100. */
  score: number;
  components: LeadScoreComponent[];
}

/**
 * The lead score (0-100) from four weighted components:
 *  - priority (30): urgent > high > normal > low
 *  - source (25): known high-intent sources score higher
 *  - recency (25): created within the last 14 days → full marks
 *  - freshness (20): unresponded + fresh = highest
 * Components always sum to exactly 100 (the invariant pin).
 */
export function leadScore(
  lead: AriaLead,
  state: AriaState,
  now: string,
): LeadScore {
  const priorityPoints: Record<string, number> = { low: 8, normal: 18, high: 25, urgent: 30 };
  const HIGH_INTENT_SOURCES = ["demo", "inbound", "referral", "webinar"];
  const sourcePoints = HIGH_INTENT_SOURCES.includes(lead.source.toLowerCase()) ? 25 : 12;
  const ageDays = (new Date(now).getTime() - new Date(lead.createdAt).getTime()) / 86_400_000;
  const recencyPoints = ageDays <= 14 ? 25 : Math.max(0, 25 - Math.floor(ageDays / 7));
  const freshnessPoints = lead.firstResponseAt === null && ageDays <= 7 ? 20 : lead.firstResponseAt === null ? 10 : 5;
  const components: LeadScoreComponent[] = [
    { name: "priority", weight: 30, value: priorityPoints[lead.priority] ?? 15 },
    { name: "source", weight: 25, value: sourcePoints },
    { name: "recency", weight: 25, value: recencyPoints },
    { name: "freshness", weight: 20, value: freshnessPoints },
  ];
  const score = Math.min(100, Math.round(components.reduce((acc, c) => acc + c.value, 0)));
  return { lead, score, components };
}

/** The top-N leads by score, descending (the `triage/leads` route). */
export function topLeads(
  state: AriaState,
  tenantId: string,
  top: number,
  now: string,
): LeadScore[] {
  const scored = state.leads
    .filter((l) => l.tenantId === tenantId)
    .map((l) => leadScore(l, state, now))
    .sort((a, b) => b.score - a.score || a.lead.createdAt.localeCompare(b.lead.createdAt));
  return scored.slice(0, top);
}

/* ── deal health ──────────────────────────────────────────────────── */

export type HealthGrade = "A" | "B" | "C" | "D";

export interface DealHealth {
  deal: AriaDeal;
  healthGrade: HealthGrade;
  signals: string[];
  nextBestAction: string;
}

/**
 * Deal health A-D + signals + next-best-action. Deterministic rules:
 *  - closed deals: A when won, C when lost (no further action).
 *  - stalled ≥ 21 days (open): -2 notches, signal "stalled".
 *  - stalled 14-20 days: -1 notch, signal "aging in stage".
 *  - expected close already past: -1 notch, signal "close date past".
 *  - `omitted` category: -1 notch, signal "excluded from forecast".
 */
export function dealHealth(
  deal: AriaDeal,
  state: AriaState,
  now: string,
): DealHealth {
  const pipeline = state.pipelines.find((p) => p.id === deal.pipelineId);
  const signals: string[] = [];
  let notches = 0;

  if (deal.closedAt !== null) {
    const stage = pipeline?.stages.find((s) => s.id === deal.stageId);
    const won = stage?.state === "closed_won";
    return {
      deal,
      healthGrade: won ? "A" : "C",
      signals: [won ? "won — the deal is closed" : `lost — ${deal.lostReason ?? "no reason recorded"}`],
      nextBestAction: won ? "log the win; plan the expansion" : "post-mortem the loss; move to the next opportunity",
    };
  }

  const stallDays = (new Date(now).getTime() - new Date(deal.lastStageChangeAt).getTime()) / 86_400_000;
  if (stallDays >= 21) {
    notches += 2;
    signals.push(`stalled ${Math.floor(stallDays)}d in stage`);
  } else if (stallDays >= 14) {
    notches += 1;
    signals.push(`aging ${Math.floor(stallDays)}d in stage`);
  }
  if (new Date(deal.expectedCloseDate + "T00:00:00Z").getTime() < new Date(now).getTime()) {
    notches += 1;
    signals.push("expected close date has passed");
  }
  if (deal.forecastCategory === "omitted") {
    notches += 1;
    signals.push("excluded from the forecast");
  }

  const grade: HealthGrade = notches >= 3 ? "D" : notches === 2 ? "C" : notches === 1 ? "B" : "A";
  const nba =
    grade === "A"
      ? "keep the momentum — schedule the next touch"
      : grade === "B"
        ? "nudge the deal: send a value update within 48h"
        : grade === "C"
          ? "escalate to the account owner with a recovery plan"
          : "re-qualify or pull the deal — it is not tracking";
  return { deal, healthGrade: grade, signals, nextBestAction: nba };
}

/** The top-N open deals by worst-first health (the `triage/deals` route). */
export function worstDeals(
  state: AriaState,
  tenantId: string,
  top: number,
  now: string,
): DealHealth[] {
  const order: Record<HealthGrade, number> = { D: 0, C: 1, B: 2, A: 3 };
  return state.deals
    .filter((d) => d.tenantId === tenantId)
    .map((d) => dealHealth(d, state, now))
    .sort((a, b) => order[a.healthGrade] - order[b.healthGrade] || a.deal.id.localeCompare(b.deal.id))
    .slice(0, top);
}

/* ── anomalies ────────────────────────────────────────────────────── */

export interface Anomaly {
  type: "amount_outlier" | "forecast_drift" | "quarter_end_bunching";
  deals: AriaDeal[];
}

/** The mean + 2σ over a set of numbers. */
export function sigmaBand(xs: number[]): { mean: number; sigma: number; upper: number } {
  if (xs.length === 0) return { mean: 0, sigma: 0, upper: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length;
  const sigma = Math.sqrt(variance);
  return { mean, sigma, upper: mean + 2 * sigma };
}

/**
 * Amount outliers: open deals whose amount exceeds mean + 2σ of the
 * tenant's closed deal amounts (the 2σ detector; needs ≥ 3 closed
 * deals, else no band).
 */
export function amountOutliers(state: AriaState, tenantId: string): AriaDeal[] {
  const closed = state.deals.filter((d) => d.tenantId === tenantId && d.closedAt !== null);
  if (closed.length < 3) return [];
  const band = sigmaBand(closed.map((d) => d.amount));
  return state.deals.filter(
    (d) => d.tenantId === tenantId && d.closedAt === null && d.amount > band.upper,
  );
}

/**
 * Forecast drift: deals whose stage moved forward since the LATEST
 * forecast snapshot (weighted value up by > 25% → drift). When no
 * snapshot exists, returns [] (nothing to drift against).
 */
export function forecastDrift(state: AriaState, tenantId: string): AriaDeal[] {
  const snaps = state.forecastSnapshots.filter((s) => s.tenantId === tenantId);
  if (snaps.length === 0) return [];
  const latest = snaps.reduce((a, b) => (new Date(a.capturedAt).getTime() > new Date(b.capturedAt).getTime() ? a : b));
  const pipeline = state.pipelines.find((p) => p.tenantId === tenantId);
  if (!pipeline) return [];
  return state.deals
    .filter((d) => d.tenantId === tenantId && d.closedAt === null && latest.dealIds.includes(d.id))
    .filter((d) => {
      // Drift = forward stage progress beyond what the snapshot explains.
      // Deterministic rule (exact, no estimation):
      //  1. If the snapshot recorded zero weight in the deal's CURRENT
      //     stage, the deal advanced into that stage after capture →
      //     drift (its current weighted value is pure post-capture gain).
      //  2. Otherwise, the deal's current weighted value was bounded at
      //     capture by `amount × max-open-probability`; drift when the
      //     current weight is > 1.25× that ceiling (only possible when a
      //     closed-won stage — probability 1 — is the current stage).
      const openProbs = pipeline.stages
        .filter((s) => s.state === "open")
        .map((s) => s.probability);
      if (openProbs.length === 0) return false;
      const capCeiling = d.amount * Math.max(...openProbs);
      const curWeight = d.amount * (pipeline.stages.find((s) => s.id === d.stageId)?.probability ?? 0);
      if ((latest.byStage[d.stageId] ?? 0) === 0 && curWeight > 0) return true;
      return curWeight > capCeiling * 1.25;
    });
}

/**
 * Quarter-end bunching: ≥ 40% of a rep's open deals expect to close
 * in the last 5 days of their quarter — the classic forecast-padding
 * pattern. Returns the offending deals.
 */
export function quarterEndBunching(state: AriaState, tenantId: string, now: string): AriaDeal[] {
  const out: AriaDeal[] = [];
  const last5 = 5 * 86_400_000;
  for (const d of state.deals) {
    if (d.tenantId !== tenantId || d.closedAt !== null) continue;
    const qEnd = quarterEndBefore(d.expectedCloseDate, now);
    const close = new Date(d.expectedCloseDate + "T00:00:00Z").getTime();
    const qEndMs = new Date(qEnd).getTime();
    if (qEndMs - close < last5 && close < qEndMs) out.push(d);
  }
  return out;
}

/** The end ISO of the quarter containing `dateStr` (or the quarter before `now` when it is the last). */
function quarterEndBefore(dateStr: string, now: string): string {
  const t = Math.max(new Date(dateStr + "T00:00:00Z").getTime(), new Date(now).getTime() - 86_400_000);
  const dt = new Date(t);
  const q = Math.floor(dt.getUTCMonth() / 3) + 1;
  return new Date(Date.UTC(dt.getUTCFullYear(), q * 3, 1)).toISOString().replace(".000Z", "Z");
}

/** The combined anomaly report (the `triage/anomalies` route body). */
export function anomalies(state: AriaState, tenantId: string, now: string): Anomaly[] {
  return [
    { type: "amount_outlier", deals: amountOutliers(state, tenantId) },
    { type: "forecast_drift", deals: forecastDrift(state, tenantId) },
    { type: "quarter_end_bunching", deals: quarterEndBunching(state, tenantId, now) },
  ];
}

