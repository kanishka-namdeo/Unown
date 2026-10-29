"use client";

/**
 * The accounts list + the account detail (profile + contacts +
 * timeline + notes composer). The notes composer is the
 * RBAC-disabled-with-reason surface (`note.create` ✗ for
 * rep/viewer).
 */
import { useState } from "react";
import { useAria } from "@/app/aria/client-store";
import type { AriaActivity, AriaNote } from "@/lib/aria/types";
import { AvatarInitial, CategoryChip, ReasonGate, shortDate, money } from "./primitives";

export function AccountsView() {
  const aria = useAria();
  const [q, setQ] = useState("");
  const detail = aria.accountDetail;

  const filtered = aria.accounts.filter(
    (a) =>
      q === "" ||
      a.name.toLowerCase().includes(q.toLowerCase()) ||
      a.domain.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search accounts…"
        aria-label="Search accounts"
        className="w-full max-w-xs rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm outline-none focus-visible:border-accent"
      />

      {detail ? (
        <AccountDetail onBack={() => void aria.openAccountDetail(null)} />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" role="list" aria-label="Accounts">
          {filtered.map((a) => {
            const owner = aria.members.find((m) => m.user.id === a.ownerId)?.user.name ?? a.ownerId;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => void aria.openAccountDetail(a.id)}
                  className="w-full rounded-xl border border-line bg-surface p-3 text-left hover:border-accent"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{a.name}</span>
                    <AvatarInitial name={owner} sub={"owner"} />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                    <span>{a.domain}</span>
                    <span>·</span>
                    <span>{a.industry}</span>
                    <span>·</span>
                    <span>{a.size} employees</span>
                  </div>
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="col-span-full rounded-xl border border-dashed border-line bg-surface p-6 text-center text-sm text-muted">
              No accounts match.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function AccountDetail({ onBack }: { onBack: () => void }) {
  const aria = useAria();
  const detail = aria.accountDetail!;
  const [note, setNote] = useState("");
  const denyNote = aria.denyReason("note.create");

  const owner = aria.members.find((m) => m.user.id === detail.account.ownerId)?.user.name ?? "";

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg border border-line bg-surface-2 px-3 py-1 text-sm text-muted hover:text-foreground"
      >
        ← Back to accounts
      </button>

      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{detail.account.name}</h2>
          <AvatarInitial name={owner} sub={"owner"} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Fact label="Domain" value={detail.account.domain} />
          <Fact label="Industry" value={detail.account.industry} />
          <Fact label="Size" value={String(detail.account.size)} />
          <Fact label="Status" value={detail.account.status} />
        </dl>
      </section>

      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">Contacts</h3>
        <ul className="mt-2 space-y-1.5 text-sm" role="list">
          {detail.contacts.length === 0 && <li className="text-xs text-muted">No contacts yet.</li>}
          {detail.contacts.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void aria.openContactDetail(c.id)}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left hover:bg-surface-2"
              >
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-muted">{c.title} · {c.email}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <Timeline entityType="account" entityId={detail.account.id} />

      <NotesComposer
        entityType="account"
        entityId={detail.account.id}
        denyReason={denyNote}
        value={note}
        setNote={setNote}
      />
    </div>
  );
}

/* ── shared record-detail pieces ──────────────────────────────────── */

/** The shared record-detail pieces that the deal detail view + the
 * accounts list also use. */
export { AvatarInitial, CategoryChip, ReasonGate, shortDate, money } from "./primitives";
export { GradeChip } from "./primitives";

export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

/** The activity timeline (newest-first, kind icons). */
export function Timeline({
  entityType,
  entityId,
  activities,
  notes,
}: {
  entityType: "account" | "contact" | "deal";
  entityId: string;
  activities?: AriaActivity[];
  notes?: AriaNote[];
}) {
  const rows: Array<{ key: string; at: string; icon: string; body: string; author: string }> = [];
  for (const a of activities ?? []) {
    rows.push({
      key: "act-" + a.id,
      at: a.at,
      icon: iconFor(a.kind),
      body: a.body,
      author: a.actorId ?? "system",
    });
  }
  for (const n of notes ?? []) {
    rows.push({ key: "note-" + n.id, at: n.at, icon: "📝", body: n.body, author: n.authorId });
  }
  rows.sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h3 className="text-sm font-bold">Timeline</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted">No activity yet.</p>
      ) : (
        <ol className="mt-2 space-y-1.5 text-sm" aria-label="Activity timeline">
          {rows.map((r) => (
            <li key={r.key} className="flex items-start gap-2">
              <span aria-hidden="true" className="w-4 text-center text-xs">
                {r.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-muted">{r.body}</span>
              </span>
              <span className="shrink-0 text-[10px] text-muted">{shortDate(r.at)}</span>
            </li>
          ))}
        </ol>
      )}
      <div data-timeline-entity={entityType + ":" + entityId} data-timeline-count={String(rows.length)} />
    </section>
  );
}

export function iconFor(kind: string): string {
  switch (kind) {
    case "call":
      return "📞";
    case "email":
      return "✉️";
    case "meeting":
      return "🤝";
    case "note":
      return "📝";
    default:
      return "⚙️";
  }
}

export function NotesComposer({
  entityType,
  entityId,
  denyReason,
  value,
  setNote,
}: {
  entityType: "account" | "contact" | "deal";
  entityId: string;
  denyReason: string | null;
  value: string;
  setNote: (v: string) => void;
}) {
  const aria = useAria();
  const [ok, setOk] = useState<string | null>(null);

  async function submit() {
    if (value.trim() === "") return;
    const r = await aria.addNote(entityType, entityId, value.trim());
    if (r.ok) {
      setNote("");
      setOk("Note added.");
    } else {
      setOk(r.error ?? "Note failed");
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h3 className="text-sm font-bold">Add a note</h3>
      <ReasonGate reason={denyReason}>
        <textarea
          value={value}
          onChange={(e) => setNote(e.target.value)}
          disabled={!!denyReason}
          rows={2}
          aria-label="New note body"
          placeholder={denyReason ?? "Write a note…"}
          className={
            "mt-2 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus-visible:border-accent " +
            (denyReason ? "cursor-not-allowed opacity-60" : "")
          }
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={!!denyReason || value.trim() === ""}
            onClick={() => void submit()}
            className="rounded-lg bg-accent-strong px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
          >
            Save note
          </button>
          {denyReason && <span className="text-xs text-muted">{denyReason}</span>}
          {ok && <span role="status" className="text-xs text-ok">{ok}</span>}
        </div>
      </ReasonGate>
    </section>
  );
}
