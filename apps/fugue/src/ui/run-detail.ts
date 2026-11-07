/**
 * run-detail.ts — the single-run detail view (F-5, ticket 2).
 *
 * DOM-free render (the job-list.ts kin). EVERY RunRecordView field is
 * rendered; the `error` field renders VERBATIM inside a
 * whitespace-preserving element (the E-05 pin: a failed run shows its
 * error text exactly as the engine reported — never summarized, never
 * swallowed). A partial/failed run is NEVER rendered with a success
 * badge (only `status === "ok"` gets the success badge).
 *
 * Back navigation restores focus (the app.ts kin owns the key handler;
 * this module exposes the pure helpers it needs).
 */
import type { RunRecordView } from "../domain/types.js";

/** The E-05 contract: the error text is escaped for HTML safety but
 *  otherwise UNTOUCHED — multi-line strings keep every line. */
export function verbatimError(error: string): string {
  return error
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function hasSuccessBadge(status: RunRecordView["status"]): boolean {
  return status === "ok";
}

export function renderRunDetail(r: RunRecordView): string {
  const success = hasSuccessBadge(r.status);
  const badge = success
    ? `<span class="fugue-run-badge is-success" data-badge="success">ok</span>`
    : `<span class="fugue-run-badge ${r.status === "failed" ? "is-error" : "is-warn"}" data-badge="${escapeAttr(r.status)}">${escapeHtml(r.status)}</span>`;

  const lines: string[] = [
    `<section class="fugue-route" data-route="run-detail" data-run="${r.id}" data-status="${escapeAttr(r.status)}" aria-label="Run detail">`,
    `  <h2>Run ${r.id} ${badge}</h2>`,
    `  <dl class="fugue-run-detail-fields">`,
    `    <dt>status</dt><dd data-field="status">${escapeHtml(r.status)}</dd>`,
    `    <dt>task</dt><dd data-field="task">${r.taskId}</dd>`,
    `    <dt>kind</dt><dd data-field="kind">${escapeHtml(r.kind)}</dd>`,
    `    <dt>started</dt><dd data-field="started">${escapeHtml(String(r.startedAt))}</dd>`,
    `    <dt>ended</dt><dd data-field="ended">${r.endedAt === null ? "in progress" : escapeHtml(String(r.endedAt))}</dd>`,
    `    <dt>tokens in</dt><dd data-field="tokens-in">${r.tokensIn}</dd>`,
    `    <dt>tokens out</dt><dd data-field="tokens-out">${r.tokensOut}</dd>`,
    `    <dt>tool calls</dt><dd data-field="tool-calls">${r.toolCalls}</dd>`,
    `    <dt>turns</dt><dd data-field="turns">${r.turns}</dd>`,
    `  </dl>`,
  ];

  if (r.error !== null) {
    lines.push(
      `  <div class="fugue-run-error" data-field="error" data-has-error="true">`,
      `    <h3>Error</h3>`,
      `    <pre class="fugue-run-error-verbatim">${verbatimError(r.error)}</pre>`,
      `  </div>`,
    );
  } else {
    lines.push(
      `  <div class="fugue-run-error" data-field="error" data-has-error="false"><p class="fugue-run-error-none">No error — the run completed.</p></div>`,
    );
  }

  // Back navigation restores focus to the owning run's history.
  lines.push(
    `  <button type="button" class="fugue-back" data-back-task="${r.taskId}" aria-label="Back to runs">← Back</button>`,
    `</section>`,
  );
  return lines.join("\n");
}

/** The detail's field inventory — the test pin that EVERY RunRecordView
 *  field is rendered (add a field to the type and this list goes stale
 *  loudly). */
export const RUN_DETAIL_FIELDS: readonly (keyof RunRecordView)[] = [
  "id",
  "taskId",
  "kind",
  "status",
  "startedAt",
  "endedAt",
  "tokensIn",
  "tokensOut",
  "toolCalls",
  "turns",
  "error",
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
