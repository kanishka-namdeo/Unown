/**
 * spend.ts — the spend meter (F-5, ticket 3).
 *
 * DOM-free render (the job-list.ts kin). Consumes the adapter's
 * `spend()` view (the /api/automations/spend kin — the UI never fetches
 * directly): the window budget, the consumed share, and the THROTTLE
 * STATE. The E-04 pin: when the canned spend JSON says `throttled`,
 * the meter shows the throttled state AND the runs render with the
 * budget-throttled marker — a throttled window is NEVER a silent zero.
 */
import type { SpendReport } from "../adapter/engine-adapter.js";

export interface SpendMeterViewModel {
  /** The consumed share of the window budget, 0..1; `null` when the
   *  window is unlimited (`windowLimit === 0`) — "unlimited" is shown,
   *  not 0%. */
  consumedShare: number | null;
  /** The honest throttle line: "throttled — the governor is holding
   *  new jobs" when `throttled`, the consumed-share line otherwise,
   *  "unlimited window" when there is no budget. */
  throttleLine: string;
  throttled: boolean;
}

/** Compute the meter's view model from the adapter's SpendReport.
 *  Pure; the numbers come from the engine's own accounting — the
 *  console never invents shares. */
export function spendMeterViewModel(sp: SpendReport): SpendMeterViewModel {
  const total = sp.calls;
  if (sp.throttled) {
    return {
      consumedShare:
        sp.windowLimit > 0 ? Math.min(1, total / sp.windowLimit) : null,
      throttleLine: "throttled — the governor is holding new jobs",
      throttled: true,
    };
  }
  if (sp.windowLimit === 0) {
    return {
      consumedShare: null,
      throttleLine: "unlimited window",
      throttled: false,
    };
  }
  const share = Math.min(1, total / sp.windowLimit);
  return {
    consumedShare: share,
    throttleLine: `${sp.calls} / ${sp.windowLimit} calls`,
    throttled: false,
  };
}

/** Format a share (0..1) as the meter's percentage label. */
export function formatShare(share: number | null): string {
  if (share === null) return "unlimited";
  return `${Math.round(share * 100)}%`;
}

/** Render the meter HTML. The E-04 honesty law: `throttled` paints a
 *  red, non-silent state (never a zeroed bar). */
export function renderSpendMeter(sp: SpendReport): string {
  const vm = spendMeterViewModel(sp);
  const barPct = vm.consumedShare === null ? 0 : Math.round(vm.consumedShare * 100);
  const stateClass = vm.throttled ? "is-throttled" : "is-ok";
  const budgetLabel =
    sp.windowLimit === 0 ? "unlimited window" : `${sp.calls} / ${sp.windowLimit} calls`;
  return [
    `<section class="fugue-route" data-route="spend" aria-label="Spend meter">`,
    `  <h2>Spend</h2>`,
    `  <div class="fugue-spend-meter ${stateClass}" data-throttled="${vm.throttled ? "true" : "false"}" data-spend-link="">`,
    `    <div class="fugue-spend-bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${vm.throttled ? 100 : barPct}" aria-label="Window budget consumed">`,
    `      <div class="fugue-spend-bar-fill" style="width:${vm.throttled ? 100 : barPct}%"></div>`,
    `    </div>`,
    `    <p class="fugue-spend-budget" data-field="budget">${budgetLabel}</p>`,
    `    <p class="fugue-spend-share" data-field="share">${formatShare(vm.consumedShare)}</p>`,
    `    <p class="fugue-spend-throttle" data-field="throttle">${escapeHtml(vm.throttleLine)}</p>`,
    `    <p class="fugue-spend-tokens" data-field="tokens">${sp.tokensIn.toLocaleString()} in / ${sp.tokensOut.toLocaleString()} out</p>`,
    `    <p class="fugue-spend-window" data-field="window">window started ${escapeHtml(sp.windowStartedAt)}</p>`,
    `  </div>`,
    `</section>`,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
