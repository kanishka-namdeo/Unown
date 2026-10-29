"use client";

/**
 * The incidents view — the tenant's incident list (status/severity
 * filters) + the incident detail (the timeline in `at`-then-`id`
 * order, the notes composer, the runbook checklist overlay, the
 * postmortem link). The lifecycle actions — ack / resolve /
 * snooze / escalate — are the RBAC-disabled-with-reason surfaces,
 * and the ack-before-resolve + terminals-are-final invariants
 * surface as DISABLED states (plan §5.3's invariant pins).
 */
import { useState } from "react";
import { useNocturne, type IncidentRow } from "@/components/nocturne/nocturne-provider";
import type { NocturneRole, NocturneTimelineEvent } from "@/lib/nocturne/types";
import { postmortemDeltas } from "@/lib/nocturne/postmortem";
import { slaState as computeSlaState, remainingMs as computeRemainingMs } from "@/lib/nocturne/sla";
import {
  Kpi,
  ReasonGate,
  SeverityChip,
  IncidentStatusChip,
  SlaChip,
  AvatarInitial,
} from "./primitives";

const STATUS_FILTERS = ["", "triggered", "acknowledged", "snoozed", "resolved"] as const;
const SEVERITY_FILTERS = ["", "sev1", "sev2", "sev3", "sev4"] as const;

export function IncidentsView() {
  const nocturne = useNocturne();
  const [status, setStatus] = useState<string>("");
  const [severity, setSeverity] = useState<string>("");

  const detail = nocturne.incidentDetail;

  if (detail) {
    return <IncidentDetail id={detail.incident.id} onBack={() => void nocturne.openIncident(null)} />;
  }

  const rows = nocturne.incidents.filter(
    (i) =>
      (status === "" || i.status === status) &&
      (severity === "" || i.severity === severity),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1 text-muted">
          Status
          <select
            id="nocturne-incident-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-line bg-surface-2 px-2 py-1 outline-none focus-visible:border-accent"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s === "" ? "all" : s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-muted">
          Severity
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="rounded-lg border border-line bg-surface-2 px-2 py-1 outline-none focus-visible:border-accent"
          >
            {SEVERITY_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s === "" ? "all" : s}
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto text-muted">{rows.length} incidents</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
          No incidents match the filters.
        </div>
      ) : (
        <ul className="space-y-1.5" aria-label="Incidents">
          {rows.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => void nocturne.openIncident(i.id)}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-left hover:border-accent"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <SeverityChip severity={i.severity} />
                  <span className="truncate text-sm font-medium">{i.title}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  <IncidentStatusChip status={i.status} />
                  <SlaChip state={i.slaState} />
                  <span className="tabular-nums text-muted">
                    {i.status === "resolved" ? "—" : nocturne.fmt.countdown(i.remainingMs)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The incident detail: profile + lifecycle actions + timeline +
 * notes + the runbook checklist + the postmortem. */
function IncidentDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const nocturne = useNocturne();
  const detail = nocturne.incidentDetail;
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  if (!detail || detail.incident.id !== id) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
        Loading incident…
      </div>
    );
  }

  const incident = detail.incident;
  // The detail payload spreads the incident row — the computed
  // `slaState` / `remainingMs` / `primaryOnCall` are present when
  // the provider fetched through the API; recompute from the
  // provider's clock when missing (the pure lib helpers).
  const row = incident as IncidentRow;
  const slaState = row.slaState ?? "ok";
  const remainingMs =
    row.remainingMs ??
    (nocturne.tenant
      ? computeRemainingMs(incident, nocturne.tenant, nocturne.nowIso, tierService(nocturne, incident.serviceId))
      : 0);
  const open = incident.status !== "resolved";

  const denyAck = nocturne.denyReason("incident.ack");
  const denyResolve = nocturne.denyReason("incident.resolve");
  const denySnooze = nocturne.denyReason("incident.snooze");
  const denyEscalate = nocturne.denyReason("incident.escalate");
  const denyNote = nocturne.denyReason("incident.note");
  const denyChecklist = nocturne.denyReason("checklist.update");

  // The escalation guard: the UI never escalates a resolved incident
  // (the terminals-are-final invariant surfaces as a disabled state).
  const escalateAllowed =
    open && (incident.activeTierIndex ?? 0) < tierCount(nocturne, incident.serviceId) - 1;

  // The ack-before-resolve invariant surfaces as a disabled state:
  // the UI never offers a resolve on an unacked incident.
  const resolveAllowed = incident.status === "acknowledged" && !denyResolve;
  const snoozeAllowed = open && incident.status !== "acknowledged" && !denySnooze;

  async function addNote() {
    if (note.trim() === "") return;
    setNoteBusy(true);
    const r = await nocturne.addNote(id, note.trim());
    setNoteBusy(false);
    if (r.ok) setNote("");
  }

  async function doAck() {
    await nocturne.ackIncident(id);
  }

  async function doResolve() {
    await nocturne.resolveIncident(id);
  }

  async function doSnooze() {
    // The default snooze window: 1 hour past the provider's clock.
    const until = new Date(new Date(nocturne.nowIso).getTime() + 3_600_000)
      .toISOString()
      .replace(".000Z", "Z");
    setSnoozeOpen(false);
    await nocturne.snoozeIncident(id, until);
  }

  async function doEscalate() {
    await nocturne.escalateIncident(id);
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg border border-line bg-surface-2 px-3 py-1 text-sm text-muted hover:text-foreground"
      >
        ← All incidents
      </button>

      {/* profile */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <SeverityChip severity={incident.severity} />
            <h2 className="truncate text-lg font-bold">{incident.title}</h2>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <IncidentStatusChip status={incident.status} />
            <SlaChip state={slaState} />
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Fact label="Triggered" value={nocturne.fmtTimestamp(incident.triggeredAt)} />
          <Fact
            label="SLA target"
            value={
              incident.status === "resolved"
                ? "final"
                : nocturne.fmt.countdown(remainingMs)
            }
          />
          <Fact
            label="On call"
            value={
              row.primaryOnCall
                ? nocturne.userName(row.primaryOnCall)
                : incident.acknowledgedBy
                  ? nocturne.userName(incident.acknowledgedBy)
                  : "—"
            }
          />
          <Fact
            label="Tier"
            value={
              incident.activeTierIndex !== null
                ? String(incident.activeTierIndex + 1) + " / " + tierCount(nocturne, incident.serviceId)
                : "—"
            }
          />
        </dl>
      </section>

      {/* ── the lifecycle actions (the RBAC-disabled-with-reason) ── */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">Actions</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ReasonGate reason={open ? denyAck : "the terminal state is final — resolved incidents cannot ack"}>
            <button
              type="button"
              onClick={() => void doAck()}
              disabled={!open || !!denyAck}
              className="rounded-lg bg-accent-strong px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
            >
              Acknowledge
            </button>
          </ReasonGate>
          <ReasonGate
            reason={
              incident.status !== "acknowledged"
                ? "ack-before-resolve — resolve requires an acknowledged incident"
                : denyResolve
            }
          >
            <button
              type="button"
              onClick={() => void doResolve()}
              disabled={!resolveAllowed}
              className="rounded-lg bg-accent-strong px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
            >
              Resolve
            </button>
          </ReasonGate>
          <ReasonGate reason={open && incident.status !== "acknowledged" ? denySnooze : "the terminal state is final — resolved incidents cannot snooze"}>
            <button
              type="button"
              onClick={() => setSnoozeOpen((v) => !v)}
              disabled={!snoozeAllowed}
              className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm font-semibold hover:border-accent disabled:opacity-50"
            >
              Snooze 1h
            </button>
          </ReasonGate>
          <ReasonGate
            reason={
              !open
                ? "the terminal state is final — resolved incidents never escalate"
                : !escalateAllowed
                  ? "the incident is already at its final escalation tier"
                  : denyEscalate
            }
          >
            <button
              type="button"
              onClick={() => void doEscalate()}
              disabled={!escalateAllowed || !!denyEscalate}
              className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm font-semibold hover:border-accent disabled:opacity-50"
            >
              Escalate tier
            </button>
          </ReasonGate>
          {open && incident.snoozedUntil !== null && (
            <span className="text-xs text-muted">
              snoozed until {nocturne.fmtTimestamp(incident.snoozedUntil)} (SLA timer frozen)
            </span>
          )}
          {snoozeOpen && (
            <ReasonGate reason={denySnooze}>
              <button
                type="button"
                onClick={() => void doSnooze()}
                disabled={!!denySnooze}
                className="rounded-lg bg-accent-strong px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
              >
                Confirm snooze
              </button>
            </ReasonGate>
          )}
        </div>
      </section>

      {/* ── the timeline (at-then-id order — the PBT invariant #6) ── */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">Timeline</h3>
        <ul className="mt-2 space-y-1.5 text-sm" aria-label="Incident timeline">
          {detail.timeline.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-1.5">
              <span className="text-xs text-muted">{nocturne.fmtTimestamp(e.at)}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="font-medium">{labelOf(e.kind)}</span>
                <span className="truncate text-xs text-muted">
                  {describeEvent(e)}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted">
                {e.actorId ? nocturne.userName(e.actorId) : "system"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── the notes (the composer is a RBAC-disabled-with-reason
           surface: a viewer sees it disabled + the reason) ── */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">Notes</h3>
        {detail.notes.length > 0 && (
          <ul className="mt-2 space-y-1.5 text-sm" aria-label="Incident notes">
            {detail.notes.map((n) => (
              <li key={n.id} className="rounded-lg bg-surface-2 px-3 py-2">
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>{nocturne.userName(n.authorId)}</span>
                  <span>{nocturne.fmtTimestamp(n.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <label className="block text-xs text-muted" htmlFor="nocturne-note-body">
            Add a note
          </label>
          <textarea
            id="nocturne-note-body"
            aria-label="New note body"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            disabled={!!denyNote}
            className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus-visible:border-accent disabled:opacity-50"
          />
          <div className="mt-1 flex items-center gap-2">
            <ReasonGate reason={denyNote}>
              <button
                type="button"
                onClick={() => void addNote()}
                disabled={!!denyNote || note.trim() === "" || noteBusy}
                className="rounded-lg bg-accent-strong px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
              >
                {noteBusy ? "Adding…" : "Add note"}
              </button>
            </ReasonGate>
            {denyNote && <span className="text-xs text-muted">{denyNote}</span>}
          </div>
        </div>
      </section>

      {/* ── the runbook checklist overlay ── */}
      <RunbookChecklist incidentId={id} serviceId={incident.serviceId} denyChecklist={denyChecklist} />

      {/* ── the postmortem link (only on resolved incidents) ── */}
      {incident.status === "resolved" && detail.postmortem && (
        <PostmortemPanel pm={detail.postmortem} />
      )}
      {incident.status === "resolved" && !detail.postmortem && (
        <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
          Resolved — no postmortem written yet.
        </p>
      )}
    </div>
  );
}

/* ── the runbook checklist overlay ────────────────────────────────── */

function RunbookChecklist({
  incidentId,
  serviceId,
  denyChecklist,
}: {
  incidentId: string;
  serviceId: string;
  denyChecklist: string | null;
}) {
  const nocturne = useNocturne();
  const [started, setStarted] = useState(false);

  const serviceRunbooks = nocturne.runbooks.filter((r) => r.serviceId === serviceId);
  if (serviceRunbooks.length === 0) return null;

  // An open runbook for the pair (the provider's runbookDetail is
  // keyed by the runbook, so walk the service's runbooks).
  const existing = serviceRunbooks.map((rb) => ({
    rb,
    cl: nocturne.runbookDetail && nocturne.runbookDetail.runbook.id === rb.id ? nocturne.runbookDetail.checklists.find((c) => c.incidentId === incidentId) : undefined,
  })).filter((x) => x.cl);

  async function startFor(rbId: string) {
    const r = await nocturne.startChecklist(incidentId, rbId);
    if (r.ok) {
      setStarted(true);
      await nocturne.openRunbook(rbId);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h3 className="text-sm font-bold">Runbooks</h3>
      <ul className="mt-2 space-y-1.5 text-sm">
        {serviceRunbooks.map((rb) => (
          <li key={rb.id} className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">{rb.name}</span>
            <ReasonGate reason={denyChecklist}>
              <button
                type="button"
                onClick={() => void startFor(rb.id)}
                disabled={!!denyChecklist}
                className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs hover:border-accent disabled:opacity-50"
              >
                Start checklist
              </button>
            </ReasonGate>
          </li>
        ))}
      </ul>
      {existing.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Active checklists">
          {existing.map(({ rb, cl }) => (
            <li key={rb.id} className="rounded-lg bg-surface-2 p-3">
              <div className="text-xs font-semibold">{rb.name}</div>
              <ol className="mt-1.5 space-y-1">
                {rb.steps.map((step) => {
                  const state = cl!.stepStates[step.id] ?? "pending";
                  return (
                    <li key={step.id} className="flex items-center gap-2 text-xs">
                      <span
                        role="img"
                        aria-label={state}
                        className={
                          state === "done"
                            ? "text-ok"
                            : state === "skipped"
                              ? "text-muted"
                              : "text-muted"
                        }
                      >
                        {state === "done" ? "✓" : state === "skipped" ? "–" : "○"}
                      </span>
                      <span className={state === "done" ? "line-through text-muted" : ""}>
                        {step.title}
                      </span>
                      <span className="ml-auto flex gap-1">
                        <ReasonGate reason={denyChecklist}>
                          <button
                            type="button"
                            onClick={() => void nocturne.setChecklistStep(cl!.id, step.id, "done")}
                            disabled={state === "done" || !!denyChecklist}
                            className="rounded border border-line px-1.5 text-[10px] hover:border-accent disabled:opacity-50"
                          >
                            done
                          </button>
                        </ReasonGate>
                        <ReasonGate reason={denyChecklist}>
                          <button
                            type="button"
                            onClick={() => void nocturne.setChecklistStep(cl!.id, step.id, "skipped")}
                            disabled={state === "skipped" || !!denyChecklist}
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
          ))}
        </ul>
      )}
      {started && <p className="mt-1 text-xs text-ok">Checklist started.</p>}
    </section>
  );
}

/* ── the postmortem panel ────────────────────────────────────────── */

function PostmortemPanel({ pm }: { pm: import("@/lib/nocturne/types").NocturnePostmortem }) {
  const nocturne = useNocturne();
  const deltas = postmortemDeltas(pm);
  const denyAction = nocturne.denyReason("postmortem.action");

  const summary = [
    deltas.triggerToAckMs !== null ? "ack " + nocturne.fmt.duration(deltas.triggerToAckMs) : null,
    "total " + nocturne.fmt.duration(deltas.triggerToResolveMs),
    deltas.ackToResolveMs !== null ? "resolve " + nocturne.fmt.duration(deltas.ackToResolveMs) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">Postmortem</h3>
        <span className="text-xs text-muted">{summary}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm">{pm.body}</p>
      {pm.actionItems.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm" aria-label="Action items">
          {pm.actionItems.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
              <ReasonGate reason={denyAction}>
                <input
                  type="checkbox"
                  aria-label={"action " + a.title}
                  checked={a.done}
                  disabled={!!denyAction}
                  onChange={(e) => void nocturne.setPostmortemAction(pm.id, a.id, e.target.checked)}
                />
              </ReasonGate>
              <span className={a.done ? "line-through text-muted" : ""}>{a.title}</span>
              <span className="ml-auto text-xs text-muted">
                {a.assigneeId !== null ? nocturne.userName(a.assigneeId) : "unassigned"}
                {a.due !== null ? " · due " + nocturne.fmtTimestamp(a.due) : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── shared helpers ──────────────────────────────────────────────── */

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}

function labelOf(kind: string): string {
  switch (kind) {
    case "alert_received":
      return "alert";
    case "alert_deduped":
      return "deduped";
    case "alert_correlated":
      return "correlated";
    case "incident_created":
      return "created";
    case "acknowledged":
      return "acked";
    case "snoozed":
      return "snoozed";
    case "escalated":
      return "escalated";
    case "note":
      return "note";
    case "status_changed":
      return "status";
    case "resolved":
      return "resolved";
    default:
      return kind;
  }
}

function describeEvent(e: import("@/lib/nocturne/types").NocturneTimelineEvent): string {
  const m = e.meta as Record<string, unknown>;
  switch (e.kind) {
    case "escalated":
      return "tier " + String(m.tier ?? "?");
    case "alert_deduped":
      return "count " + String(m.count ?? "?");
    case "note":
      return String(m.noteId ?? "");
    case "status_changed":
      return String(m.from ?? "") + " → " + String(m.to ?? "");
    default:
      return "";
  }
}

/** The service's tier count (the escalation guard's denominator). */
function tierCount(
  nocturne: ReturnType<typeof useNocturne>,
  serviceId: string,
): number {
  const row = nocturne.services.find((x) => x.service.id === serviceId);
  return row?.service.escalationPolicy?.tiers.length ?? 0;
}

/** The service row for an incident's serviceId (the lib SLA helpers). */
function tierService(
  nocturne: ReturnType<typeof useNocturne>,
  serviceId: string,
): import("@/lib/nocturne/types").NocturneService | undefined {
  return nocturne.services.find((x) => x.service.id === serviceId)?.service;
}
