"use client";

/**
 * The runbooks view — the tenant's runbooks (the ordered checklists
 * per service) + the runbook detail (the steps + the per-incident
 * checklists). The `checklist.start` / `checklist.update` lanes are
 * the responder surfaces.
 */
import { useState } from "react";
import { useNocturne } from "@/components/nocturne/nocturne-provider";
import type { ChecklistStepState } from "@/lib/nocturne/types";
import { ReasonGate, SeverityChip } from "./primitives";

export function RunbooksView() {
  const nocturne = useNocturne();
  const detail = nocturne.runbookDetail;

  if (detail) {
    return <RunbookDetail onBack={() => void nocturne.openRunbook(null)} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{nocturne.runbooks.length} runbooks</span>
      </div>
      {nocturne.runbooks.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
          No runbooks yet.
        </div>
      ) : (
        <ul className="space-y-1.5" aria-label="Runbooks">
          {nocturne.runbooks.map((rb) => (
            <li key={rb.id}>
              <button
                type="button"
                onClick={() => void nocturne.openRunbook(rb.id)}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-left hover:border-accent"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{rb.name}</div>
                  <div className="truncate text-xs text-muted">
                    {rb.steps.length} steps
                    {rb.forSeverities.length > 0 ? " · " + rb.forSeverities.join(", ") : " · all severities"}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {rb.forSeverities.map((s) => (
                    <SeverityChip key={s} severity={s} />
                  ))}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The runbook detail: the ordered steps + the per-incident
 * checklists (the progress overlay). */
function RunbookDetail({ onBack }: { onBack: () => void }) {
  const nocturne = useNocturne();
  const detail = nocturne.runbookDetail!;
  const rb = detail.runbook;
  const checklists = detail.checklists ?? [];

  const denyChecklist = nocturne.denyReason("checklist.update");
  const serviceName = nocturne.services.find((s) => s.service.id === rb.serviceId)?.service.name ?? rb.serviceId;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg border border-line bg-surface-2 px-3 py-1 text-sm text-muted hover:text-foreground"
      >
        ← All runbooks
      </button>

      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{rb.name}</h2>
          <span className="text-xs text-muted">{serviceName}</span>
        </div>

        <ol className="mt-3 space-y-1.5" aria-label="Runbook steps">
          {rb.steps.map((step, i) => (
            <li key={step.id} className="rounded-lg bg-surface-2 px-3 py-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{i + 1}. {step.title}</span>
              </div>
              {step.command && (
                <code className="mt-1 block rounded bg-black/30 px-2 py-1 text-xs text-accent">
                  {step.command}
                </code>
              )}
            </li>
          ))}
        </ol>
      </section>

      {/* the per-incident checklists (the progress overlay) */}
      {checklists.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4">
          <h3 className="text-sm font-bold">Active checklists</h3>
          <ul className="mt-2 space-y-2">
            {checklists.map((cl) => {
              const state = (stepId: string): ChecklistStepState =>
                cl.stepStates[stepId] ?? "pending";
              const doneCount = rb.steps.filter((s) => state(s.id) === "done").length;
              return (
                <li key={cl.id} className="rounded-lg bg-surface-2 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">
                      incident {cl.incidentId} · {doneCount}/{rb.steps.length} done
                    </span>
                    <span className="tabular-nums">{Math.round((doneCount / Math.max(1, rb.steps.length)) * 100)}%</span>
                  </div>
                  <ol className="mt-1.5 space-y-1">
                    {rb.steps.map((step) => {
                      const st = state(step.id);
                      return (
                        <li key={step.id} className="flex items-center gap-2 text-xs">
                          <span
                            role="img"
                            aria-label={st}
                            className={st === "done" ? "text-ok" : "text-muted"}
                          >
                            {st === "done" ? "✓" : st === "skipped" ? "–" : "○"}
                          </span>
                          <span className={st === "done" ? "line-through text-muted" : ""}>
                            {step.title}
                          </span>
                          <span className="ml-auto flex gap-1">
                            <ReasonGate reason={denyChecklist}>
                              <button
                                type="button"
                                onClick={() => void nocturne.setChecklistStep(cl.id, step.id, "done")}
                                disabled={st === "done" || !!denyChecklist}
                                className="rounded border border-line px-1.5 text-[10px] hover:border-accent disabled:opacity-50"
                              >
                                done
                              </button>
                            </ReasonGate>
                            <ReasonGate reason={denyChecklist}>
                              <button
                                type="button"
                                onClick={() => void nocturne.setChecklistStep(cl.id, step.id, "skipped")}
                                disabled={st === "skipped" || !!denyChecklist}
                                className="rounded border border-line px-1.5 text-[10px] hover:border-accent disabled:opacity-50"
                              >
                                skip
                              </button>
                            </ReasonGate>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
