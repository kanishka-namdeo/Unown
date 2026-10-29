"use client";

/**
 * The deal detail view — profile + stage-history timeline + tasks +
 * notes + the triage panel (health grade + signals + next-best-
 * action). The stage picker + the note composer are the RBAC-
 * disabled-with-reason surfaces.
 */
import { useEffect, useState } from "react";
import { useAria } from "@/app/aria/client-store";
import { Fact, NotesComposer, Timeline, GradeChip } from "./accounts";
import { AvatarInitial, CategoryChip, ReasonGate, money } from "./primitives";

export function DealDetailView({ dealId, onBack }: { dealId: string; onBack: () => void }) {
  const aria = useAria();
  const detail = aria.dealDetail;
  const [note, setNote] = useState("");

  // F8 (the aria round's validation log): the view self-fetches when its
  // deal is not the one already loaded — a caller that switches to this
  // view without pre-fetching (the pipeline card did) can no longer strand
  // the view in the loading state forever.
  useEffect(() => {
    if (!detail || detail.deal.id !== dealId) {
      void aria.openDealDetail(dealId);
    }
  }, [dealId, detail, aria.openDealDetail]);

  if (!detail || detail.deal.id !== dealId) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
        Loading deal…
      </div>
    );
  }

  const deal = detail.deal;
  const pipeline = aria.pipelines.find((p) => p.id === deal.pipelineId);
  const stage = pipeline?.stages.find((s) => s.id === deal.stageId);
  const closed = deal.closedAt !== null;
  const owner =
    aria.members.find((m) => m.user.id === deal.ownerId)?.user.name ?? deal.ownerId;
  const triage = aria.triageDeals.find((t) => t.deal.id === deal.id);
  const denyStage = aria.denyReason("deal.stage");
  const denyNote = aria.denyReason("note.create");

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg border border-line bg-surface-2 px-3 py-1 text-sm text-muted hover:text-foreground"
      >
        ← Back to pipeline
      </button>

      {/* profile */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{deal.id}</h2>
          <div className="flex items-center gap-2">
            <AvatarInitial name={owner} sub={"owner"} />
            <CategoryChip category={deal.forecastCategory} />
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Fact label="Amount" value={money(deal.amount)} />
          <Fact label="Stage" value={stage?.name ?? deal.stageId} />
          <Fact label="Expected close" value={deal.expectedCloseDate} />
          <Fact label="Status" value={closed ? (deal.lostReason ? "lost" : "won") : "open"} />
        </dl>
        {closed && deal.lostReason && (
          <p className="mt-2 text-xs text-muted">Lost reason: {deal.lostReason}</p>
        )}
      </section>

      {/* the stage picker (closed deals render locked — no reopen) */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">Move stage</h3>
        {closed ? (
          <span
            role="img"
            aria-label="stage locked — this deal is closed"
            className="mt-2 inline-block rounded-md bg-surface-2 px-2 py-1 text-xs text-muted"
          >
            🔒 closed — no reopen
          </span>
        ) : (
          <ReasonGate reason={denyStage}>
            <label className="mt-2 block text-sm" htmlFor="aria-deal-stage">
              <span className="text-muted">Move to stage</span>
              <select
                id="aria-deal-stage"
                data-deal-stage-picker={deal.id}
                disabled={!!denyStage}
                value=""
                onChange={(e) => {
                  if (e.target.value) void aria.moveDealStage(deal.id, e.target.value);
                }}
                className={
                  "mt-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus-visible:border-accent " +
                  (denyStage ? "cursor-not-allowed opacity-60" : "")
                }
              >
                <option value="" disabled>
                  choose a stage…
                </option>
                {pipeline?.stages
                  .filter((s) => s.id !== deal.stageId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({Math.round(s.probability * 100)}%)
                    </option>
                  ))}
              </select>
            </label>
            {denyStage && <p className="mt-1 text-xs text-muted">{denyStage}</p>}
          </ReasonGate>
        )}
      </section>

      {/* the triage panel */}
      {triage && (
        <section className="rounded-xl border border-line bg-surface p-4" aria-label="Triage panel">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold">Triage</h3>
            <GradeChip grade={triage.healthGrade} />
          </div>
          {triage.signals.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {triage.signals.map((s) => (
                <span key={s} className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] text-warn">
                  {s}
                </span>
              ))}
            </div>
          )}
          <p className="mt-2 text-sm text-muted">NBA: {triage.nextBestAction}</p>
        </section>
      )}

      {/* tasks */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">Tasks</h3>
        {detail.tasks.length === 0 ? (
          <p className="mt-2 text-xs text-muted">No tasks.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm" role="list">
            {detail.tasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-lg bg-surface-2 px-2.5 py-1.5">
                <span className={t.done ? "text-muted line-through" : ""}>{t.title}</span>
                <span className="text-xs text-muted">
                  {t.priority} · {t.done ? "done" : "open"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* timeline */}
      <Timeline entityType="deal" entityId={deal.id} activities={detail.activities} />

      {/* notes */}
      <NotesComposer
        entityType="deal"
        entityId={deal.id}
        denyReason={denyNote}
        value={note}
        setNote={setNote}
      />
    </div>
  );
}
