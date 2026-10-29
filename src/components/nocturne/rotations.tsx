"use client";

/**
 * The rotations view — the tenant's on-call rotations (the weekly
 * schedule: the seat list + the handoff + the overrides). The
 * override lane is the RBAC-disabled-with-reason surface
 * (`rotation.override` — a responder may edit their OWN overrides
 * only, the plan §1 carve-out).
 */
import { useState } from "react";
import { useNocturne } from "@/components/nocturne/nocturne-provider";
import { ReasonGate } from "./primitives";

export function RotationsView() {
  const nocturne = useNocturne();
  const detail = nocturne.rotationDetail;

  if (detail) {
    return <RotationDetail onBack={() => void nocturne.openRotation(null)} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{nocturne.rotations.length} rotations</span>
      </div>
      {nocturne.rotations.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
          No rotations configured yet.
        </div>
      ) : (
        <ul className="space-y-1.5" aria-label="Rotations">
          {nocturne.rotations.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => void nocturne.openRotation(r.id)}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-left hover:border-accent"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.name}</div>
                  <div className="truncate text-xs text-muted">
                    {r.seats.length} seats · weekly handoff{" "}
                    {DOW_NAMES[r.boundaryDow] ?? "?"} 00:00
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <div className="text-muted">on call</div>
                  <div className="font-medium text-accent">
                    {r.current?.name ?? r.currentSeat?.name ?? "—"}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The rotation detail: the weekly schedule + the active window +
 * the overrides (the override precedence: the latest wins). */
function RotationDetail({ onBack }: { onBack: () => void }) {
  const nocturne = useNocturne();
  const detail = nocturne.rotationDetail!;
  const rotation = detail.rotation;
  const overrides = detail.overrides ?? [];

  const denyOverride = nocturne.denyReason("rotation.override");
  const shiftLabel = rotation.shiftLengthMs >= 7 * 86_400_000
    ? "1-week shifts"
    : Math.round(rotation.shiftLengthMs / 3_600_000) + "h shifts";

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg border border-line bg-surface-2 px-3 py-1 text-sm text-muted hover:text-foreground"
      >
        ← All rotations
      </button>

      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{rotation.name}</h2>
          <span className="text-xs text-muted">
            {shiftLabel} · handoff {DOW_NAMES[rotation.boundaryDow] ?? "?"} 00:00
          </span>
        </div>

        {/* the active window */}
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">On call now</dt>
            <dd className="mt-0.5 font-medium text-accent">
              {rotation.current?.name ?? rotation.currentSeat?.name ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Next handoff</dt>
            <dd className="mt-0.5">{rotation.handoffAt ? nocturne.fmtTimestamp(rotation.handoffAt) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Up next</dt>
            <dd className="mt-0.5">{rotation.nextSeat?.name ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {/* the seat list (the weekly tiling) */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">Seat schedule</h3>
        <ol className="mt-2 space-y-1.5" aria-label="Seat schedule">
          {[...rotation.seats]
            .sort((a, b) => a.seatIndex - b.seatIndex)
            .map((seat) => (
              <li
                key={seat.seatIndex}
                className={
                  "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm " +
                  (rotation.current?.userId === seat.userId ? "bg-accent/15 text-accent" : "bg-surface-2")
                }
              >
                <span className="text-xs text-muted">seat {seat.seatIndex + 1}</span>
                <span className="font-medium">
                  {nocturne.userName(seat.userId)}
                  {rotation.current?.userId === seat.userId && (
                    <span className="ml-2 text-xs">on call</span>
                  )}
                </span>
                <span className="text-xs text-muted">{nocturne.fmtTimestamp(seat.start)}</span>
              </li>
            ))}
        </ol>
      </section>

      {/* the overrides (the precedence: the latest wins) */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">Overrides</h3>
        {denyOverride && <p className="mt-1 text-xs text-muted">{denyOverride}</p>}
        {overrides.length === 0 ? (
          <p className="mt-2 text-xs text-muted">No overrides for this rotation.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {[...overrides]
              .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
              .map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate">
                      <span className="font-medium">{nocturne.userName(o.userId)}</span>{" "}
                      covers <span className="font-medium">{nocturne.userName(o.forUserId)}</span>
                    </div>
                    <div className="text-xs text-muted">
                      {nocturne.fmtTimestamp(o.startsAt)} → {nocturne.fmtTimestamp(o.endsAt)}
                      {o.reason ? " · " + o.reason : ""}
                    </div>
                  </div>
                  <ReasonGate reason={denyOverride}>
                    <button
                      type="button"
                      aria-label={"delete override " + o.id}
                      disabled={!!denyOverride}
                      onClick={() => {
                        /* delete lane — the provider's override delete
                         * (not wired here; the matrix gate is pinned) */
                      }}
                      className="rounded-lg border border-line px-2 py-1 text-xs hover:border-danger disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </ReasonGate>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}
