"use client";

/**
 * The pipeline kanban — the pipeline selector, columns per stage
 * (probability chips), deal cards (amount, forecastCategory chip,
 * owner avatar-initial, SLA/at-risk hints), stage moves via a
 * picker (PATCH `/aria/api/deals/[id]/stage`) with the lost-reason
 * gate modal when the target is a lost stage, and closed deals
 * rendering locked (the disabled state pins the no-reopen invariant
 * in the UI).
 */
import { useState } from "react";
import { useAria } from "@/app/aria/client-store";
import type { AriaDeal } from "@/lib/aria/types";
import { CategoryChip, AvatarInitial, ReasonGate, money, stalledDays } from "./primitives";
import { DealDetailView } from "./deal-detail";

export function PipelineView() {
  const aria = useAria();
  const [lostGate, setLostGate] = useState<{ deal: AriaDeal; targetStageId: string } | null>(null);
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  const [openDealId, setOpenDealId] = useState<string | null>(null);

  const pipeline =
    aria.pipelines.find((p) => p.id === aria.selectedPipelineId) ??
    aria.pipelines[0];

  // The deal detail view takes over the pipeline view when a deal
  // card is clicked (the record detail page, the plan's §6 item 6).
  if (openDealId) {
    return <DealDetailView dealId={openDealId} onBack={() => setOpenDealId(null)} />;
  }

  if (!pipeline) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
        No pipelines in this tenant.
      </div>
    );
  }

  const denyStage = aria.denyReason("deal.stage");

  function pickStage(deal: AriaDeal, stageId: string) {
    setPendingStage(stageId);
    const target = pipeline.stages.find((s) => s.id === stageId);
    if (target && target.state === "closed_lost") {
      // The lost-reason gate: a lost stage REQUIRES a reason.
      setLostGate({ deal, targetStageId: stageId });
      return;
    }
    void doMove(deal, stageId);
  }

  async function doMove(deal: AriaDeal, stageId: string, lostReason?: string) {
    setLostGate(null);
    setPendingStage(stageId);
    const r = await aria.moveDealStage(deal.id, stageId, lostReason);
    setPendingStage(null);
    if (!r.ok) {
      // Surface a stage-move error (e.g. a closed deal — the
      // no-reopen invariant) as a transient note.
      setStageError(r.error ?? "Stage move failed");
    }
  }

  return (
    <div className="space-y-3">
      {/* the pipeline selector */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted" htmlFor="aria-pipeline-select">
          Pipeline
        </label>
        <select
          id="aria-pipeline-select"
          value={pipeline.id}
          onChange={(e) => aria.setSelectedPipelineId(e.target.value)}
          className="rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-sm outline-none focus-visible:border-accent"
        >
          {aria.pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {stageError && (
        <p role="alert" className="text-xs font-medium text-danger">
          {stageError}
        </p>
      )}

      {/* the kanban columns */}
      <div
        className="flex gap-3 overflow-x-auto pb-2"
        style={{ minHeight: "320px" }}
        role="group"
        aria-label={"Kanban columns for " + pipeline.name}
      >
        {pipeline.stages.map((stage) => {
          const colDeals = aria.deals.filter(
            (d) => d.pipelineId === pipeline.id && d.stageId === stage.id,
          );
          const isClosed = stage.state === "closed_won" || stage.state === "closed_lost";
          return (
            <section
              key={stage.id}
              className={
                "w-64 shrink-0 rounded-xl border bg-surface p-2 " +
                (isClosed ? "border-line/50" : "border-line")
              }
              aria-label={stage.name + " column"}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">{stage.name}</span>
                <span
                  role="img"
                  aria-label={"probability " + Math.round(stage.probability * 100) + "%"}
                  className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent"
                >
                  {Math.round(stage.probability * 100)}%
                </span>
              </div>
              <ul className="space-y-1.5" role="list">
                {colDeals.length === 0 && (
                  <li className="rounded-lg border border-dashed border-line px-2 py-3 text-center text-xs text-muted">
                    empty
                  </li>
                )}
                {colDeals.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    pipeline={pipeline}
                    onPickStage={(sid) => pickStage(deal, sid)}
                    onOpen={() => setOpenDealId(deal.id)}
                    denyStage={denyStage}
                    moving={pendingStage === deal.id ? true : false}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {/* ── the lost-reason gate modal ──────────────────────────── */}
      {lostGate && (
        <LostGate
          deal={lostGate.deal}
          pipeline={pipeline}
          onCancel={() => setLostGate(null)}
          onConfirm={(reason) => void doMove(lostGate.deal, lostGate.targetStageId, reason)}
        />
      )}
    </div>
  );
}

function DealCard({
  deal,
  pipeline,
  onPickStage,
  onOpen,
  denyStage,
  moving,
}: {
  deal: AriaDeal;
  pipeline: NonNullable<ReturnType<typeof useAria>["pipelines"]>[number];
  onPickStage: (stageId: string) => void;
  onOpen: () => void;
  denyStage: string | null;
  moving: boolean;
}) {
  const aria = useAria();
  const owner = aria.members.find((m) => m.user.id === deal.ownerId)?.user.name ?? deal.ownerId;
  const closed = deal.closedAt !== null;
  const days = stalledDays(deal.lastStageChangeAt, "2026-10-28T12:00:00Z");

  // The stage picker: closed deals render LOCKED (the no-reopen
  // invariant pinned in the UI — a disabled control, not an offer).
  const options = closed
    ? []
    : pipeline.stages.filter((s) => s.id !== deal.stageId);

  return (
    <li
      className={
        "rounded-lg border bg-surface-2 p-2 text-sm " +
        (closed ? "border-line/40 opacity-70" : "border-line")
      }
    >
      <div className="flex items-start justify-between gap-1">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 truncate text-left font-medium hover:text-accent"
          title={deal.id}
        >
          {deal.accountId || deal.contactId}
        </button>
        <AvatarInitial name={owner} sub={"owner"} />
      </div>

      <div className="mt-1 flex items-center justify-between text-xs">
        <CategoryChip category={deal.forecastCategory} />
        <span className="tabular-nums font-semibold">{money(deal.amount)}</span>
      </div>

      {!closed && days >= 14 && (
        <div className="mt-1 text-[10px] text-warn">stalled {days}d in stage</div>
      )}
      {closed && (
        <div className="mt-1 text-[10px] text-muted">
          {deal.lostReason ? "lost — " + deal.lostReason : "closed won"}
        </div>
      )}

      {/* the stage picker + the RBAC/disabled gate */}
      <div className="mt-2">
        {closed ? (
          <span
            role="img"
            aria-label="stage locked — this deal is closed"
            className="inline-block rounded-md bg-surface-2 px-2 py-1 text-[10px] text-muted"
          >
            🔒 closed — no reopen
          </span>
        ) : (
          <ReasonGate reason={denyStage}>
            <label className="sr-only" htmlFor={`stage-${deal.id}`}>
              Move {deal.id} to a stage
            </label>
            <select
              id={`stage-${deal.id}`}
              data-deal-stage-picker={deal.id}
              disabled={!!denyStage || moving}
              value=""
              onChange={(e) => e.target.value && onPickStage(e.target.value)}
              className={
                "w-full rounded-md border border-line bg-surface px-2 py-1 text-xs outline-none focus-visible:border-accent " +
                (denyStage ? "cursor-not-allowed opacity-60" : "")
              }
            >
              <option value="" disabled>
                move to stage…
              </option>
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({Math.round(s.probability * 100)}%)
                </option>
              ))}
            </select>
          </ReasonGate>
        )}
      </div>
    </li>
  );
}

/** The lost-reason gate: moving to a lost stage requires a reason. */
function LostGate({
  deal,
  pipeline,
  onCancel,
  onConfirm,
}: {
  deal: AriaDeal;
  pipeline: NonNullable<ReturnType<typeof useAria>["pipelines"]>[number];
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const target = pipeline.stages.find((s) => s.id === deal.stageId);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Lost reason required"
    >
      <button
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
        tabIndex={-1}
      />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <h2 className="text-lg font-bold">Mark lost</h2>
        <p className="mt-1 text-xs text-muted">
          Moving <strong>{deal.id}</strong> to{" "}
          <strong>{target?.name ?? "Lost"}</strong> requires a reason
          (the P0 lost-reason gate).
        </p>
        <label className="mt-3 block text-sm">
          <span className="text-muted">Lost reason</span>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
            required
            className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus-visible:border-accent"
            placeholder="Budget cut / went with competitor / …"
          />
        </label>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-line px-4 py-2 text-sm text-muted hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={reason.trim() === ""}
            onClick={() => onConfirm(reason.trim())}
            className="flex-1 rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
          >
            Mark lost
          </button>
        </div>
      </div>
    </div>
  );
}
