/**
 * Read-only analytics over the parley store. Pure functions,
 * explicit `now`, no crypto, no DOM — the UI's analytics dashboard
 * (accessible SVG, the cadence stats-chart pattern) renders the
 * output of `computeAnalytics`.
 */

import type { ParleyState } from "./types";

export interface Analytics {
  /** Total conversations broken down by status. */
  volumeByStatus: { open: number; pending: number; closed: number };
  /** Median time-to-first-response (ms) over replied conversations; 0 when none. */
  medianFirstResponseMs: number;
  /** 0–1 fraction of all conversations that reached a reply. */
  resolutionRate: number;
  /** Open conversations per assignee (the per-agent load chart). */
  perAgentLoad: Record<string, number>;
}

/**
 * Compute the analytics snapshot for a tenant at the explicit `now`.
 *
 * - `volumeByStatus`: the donut chart's three segments.
 * - `medianFirstResponseMs`: the KPI chip; 0 when no conversation
 *   has a `firstRespondedAt` yet (the floor pin).
 * - `resolutionRate`: fraction of conversations with any agent
 *   reply (a replied conversation counts as "reached resolution"
 *   in the demo's KPI sense — a real product would tie this to
 *   closed-without-reopen; the brief's "resolution rate" KPI).
 * - `perAgentLoad`: open conversations per assignee; unassigned
 *   gets the `"__unassigned"` key.
 */
export function computeAnalytics(state: ParleyState, tenantId: string, now: string): Analytics {
  const nowMs = new Date(now).getTime();
  const convos = state.conversations.filter((c) => c.tenantId === tenantId);
  const total = convos.length;

  const volumeByStatus = { open: 0, pending: 0, closed: 0 };
  const frDeltas: number[] = [];
  let replied = 0;
  const perAgentLoad: Record<string, number> = {};

  for (const c of convos) {
    volumeByStatus[c.status] += 1;
    if (c.firstRespondedAt !== null) {
      replied += 1;
      const delta = new Date(c.firstRespondedAt).getTime() - new Date(c.createdAt).getTime();
      frDeltas.push(delta);
    }
    if (c.status === "open") {
      const key = c.assigneeId ?? "__unassigned";
      perAgentLoad[key] = (perAgentLoad[key] ?? 0) + 1;
    }
  }

  frDeltas.sort((a, b) => a - b);
  const medianFirstResponseMs =
    frDeltas.length === 0
      ? 0
      : frDeltas.length % 2 === 1
        ? frDeltas[(frDeltas.length - 1) / 2]
        : (frDeltas[frDeltas.length / 2 - 1] + frDeltas[frDeltas.length / 2]) / 2;

  return {
    volumeByStatus,
    medianFirstResponseMs,
    resolutionRate: total === 0 ? 0 : replied / total,
    perAgentLoad,
  };
}

/** Format a ms delta as a human-readable "2h 14m" (the KPI chip text). */
export function formatDurationMs(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
