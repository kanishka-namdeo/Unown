"use client";

/**
 * The sequences view — the sequence list + detail (steps timeline
 * with type icons), the enrollment list with state chips, the
 * advance/exit actions (calling the deterministic engine's API),
 * and the mailbox drawer (the simulated outbound).
 */
import { useState } from "react";
import { useAria } from "@/app/aria/client-store";
import type { AriaEngagement, AriaEnrollment } from "@/lib/aria/types";
import { AvatarInitial, ReasonGate, shortDate } from "./primitives";

const ENROLLMENT_CLS: Record<string, string> = {
  enrolled: "bg-surface-2 text-muted",
  active: "bg-accent/15 text-accent",
  completed: "bg-ok/15 text-ok",
  exited_by_reply: "bg-warn/15 text-warn",
  exited_manually: "bg-surface-2 text-muted",
  bounced: "bg-danger/15 text-danger",
};

export function SequencesView() {
  const aria = useAria();
  const detail = aria.sequenceDetail;

  return (
    <div className="space-y-3">
      {detail ? (
        <SequenceDetail onBack={() => void aria.openSequence(null)} />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" role="list" aria-label="Sequences">
          {aria.sequences.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => void aria.openSequence(s.id)}
                className="w-full rounded-xl border border-line bg-surface p-3 text-left hover:border-accent"
              >
                <div className="font-semibold">{s.name}</div>
                <div className="mt-1 text-xs text-muted">
                  {s.steps.length} steps · trait seed {s.traitSeed}
                </div>
              </button>
            </li>
          ))}
          {aria.sequences.length === 0 && (
            <li className="col-span-full rounded-xl border border-dashed border-line bg-surface p-6 text-center text-sm text-muted">
              No sequences in this tenant.
            </li>
          )}
        </ul>
      )}

      <MailboxDrawer />
    </div>
  );
}

function SequenceDetail({ onBack }: { onBack: () => void }) {
  const aria = useAria();
  const detail = aria.sequenceDetail!;
  const [advanceTarget, setAdvanceTarget] = useState<string | null>(null);
  const denyAdvance = aria.denyReason("enrollment.advance");

  const eventIcons: Record<string, string> = {
    email: "✉️",
    wait: "⏱",
    task: "✅",
    branch: "↔",
  };

  const [err, setErr] = useState<string | null>(null);

  async function advance(enrollment: AriaEnrollment, events: AriaEngagement[]) {
    setAdvanceTarget(enrollment.id);
    const r = await aria.advanceEnrollment(enrollment.id, events);
    setAdvanceTarget(null);
    if (!r.ok) {
      setErr(r.error ?? "Advance failed");
    }
  }

  async function exit(enrollment: AriaEnrollment) {
    setAdvanceTarget(enrollment.id);
    const r = await aria.exitEnrollment(enrollment.id);
    setAdvanceTarget(null);
    if (!r.ok) setErr(r.error ?? "Exit failed");
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg border border-line bg-surface-2 px-3 py-1 text-sm text-muted hover:text-foreground"
      >
        ← Back to sequences
      </button>

      {err && (
        <p role="alert" className="text-xs font-medium text-danger">
          {err}
        </p>
      )}

      {/* the steps timeline */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-lg font-bold">{detail.sequence.name}</h2>
        <p className="mt-0.5 text-xs text-muted">
          trait seed {detail.sequence.traitSeed} · {detail.sequence.steps.length} steps
        </p>
        <ol className="mt-3 space-y-2" aria-label="Sequence steps">
          {detail.sequence.steps.map((step, i) => (
            <li key={step.id} className="flex items-start gap-2">
              <span aria-hidden="true" className="w-6 shrink-0 text-center">
                {eventIcons[step.type] ?? "•"}
              </span>
              <div className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <div className="font-medium">
                  <span className="text-xs text-muted">{i + 1}.</span> {step.name}
                  <span className="ml-2 text-xs text-muted">({step.type})</span>
                </div>
                {step.email && (
                  <p className="mt-1 text-xs text-muted">{step.email.subject}</p>
                )}
                {step.waitDays !== undefined && (
                  <p className="mt-1 text-xs text-muted">wait {step.waitDays}d</p>
                )}
                {step.task && (
                  <p className="mt-1 text-xs text-muted">{step.task.title}</p>
                )}
                {step.branch && (
                  <p className="mt-1 text-xs text-muted">
                    branch on {step.branch.onEngagement}
                    {step.branch.targetStepId ? " → " + step.branch.targetStepId : ""}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* the enrollment list */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">Enrollments</h3>
        {detail.enrollments.length === 0 ? (
          <p className="mt-2 text-xs text-muted">No enrollments yet.</p>
        ) : (
          <ul className="mt-2 space-y-2" role="list">
            {detail.enrollments.map((e) => {
              const contact = aria.contacts.find((c) => c.id === e.contactId);
              const terminal =
                e.state === "completed" ||
                e.state === "exited_by_reply" ||
                e.state === "exited_manually" ||
                e.state === "bounced";
              return (
                <li
                  key={e.id}
                  className="rounded-lg border border-line bg-surface-2 p-2.5 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <AvatarInitial name={contact?.name ?? e.contactId} sub={"contact"} />
                      <span className="min-w-0 truncate">{contact?.name ?? e.contactId}</span>
                    </div>
                    <span
                      className={
                        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium " +
                        (ENROLLMENT_CLS[e.state] ?? "bg-surface-2 text-muted")
                      }
                    >
                      {e.state}
                    </span>
                  </div>

                  {advanceTarget === e.id && (
                    <p className="mt-1 text-xs text-muted">running the engine…</p>
                  )}

                  {/* the deterministic engine's actions — gated */}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ReasonGate reason={terminal ? "enrollment is terminal — no further advance" : denyAdvance}>
                      <button
                        type="button"
                        disabled={terminal || advanceTarget === e.id || !!denyAdvance}
                        onClick={() => void advance(e, ["open"])}
                        className="rounded-md bg-accent-strong px-2.5 py-1 text-xs font-semibold text-white hover:bg-accent disabled:opacity-50"
                      >
                        Advance
                      </button>
                    </ReasonGate>
                    <ReasonGate reason={terminal ? "enrollment is terminal" : denyAdvance}>
                      <button
                        type="button"
                        disabled={terminal || advanceTarget === e.id || !!denyAdvance}
                        onClick={() => void exit(e)}
                        className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:bg-surface-2 disabled:opacity-50"
                      >
                        Exit
                      </button>
                    </ReasonGate>
                    <span className="text-[10px] text-muted">
                      step {e.stepIndex + 1}/{detail.sequence.steps.length} · traitMult{" "}
                      {e.traitMult}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function MailboxDrawer() {
  const aria = useAria();
  const [open, setOpen] = useState(false);
  const msgs = aria.mailbox;

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">Mailbox</h3>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-pressed={open}
          className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:bg-surface-2"
        >
          {open ? "Hide" : "Open"} · {msgs.length}
        </button>
      </div>
      {open && (
        <ul className="mt-3 space-y-1.5 text-sm" role="list" aria-label="Mailbox">
          {msgs.length === 0 && <li className="text-xs text-muted">No outbound yet.</li>}
          {msgs.slice(0, 10).map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate">{m.subject}</span>
              <span
                role="img"
                aria-label={"outcome " + m.outcome}
                className={
                  "shrink-0 rounded-full px-2 py-0.5 text-xs " +
                  (m.outcome === "replied"
                    ? "bg-ok/15 text-ok"
                    : m.outcome === "bounced"
                      ? "bg-danger/15 text-danger"
                      : m.outcome === "opened"
                        ? "bg-warn/15 text-warn"
                        : "bg-surface-2 text-muted")
                }
              >
                {m.outcome}
              </span>
              <span className="shrink-0 text-[10px] text-muted">{shortDate(m.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
