"use client";

/**
 * The contacts list + the contact detail (profile + deals +
 * timeline).
 */
import { useState } from "react";
import { useAria } from "@/app/aria/client-store";
import { Fact, Timeline, CategoryChip, money } from "./accounts";

export function ContactsView() {
  const aria = useAria();
  const [q, setQ] = useState("");
  const detail = aria.contactDetail;

  const filtered = aria.contacts.filter((c) =>
    q === ""
      ? true
      : c.name.toLowerCase().includes(q.toLowerCase()) ||
        c.email.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search contacts…"
        aria-label="Search contacts"
        className="w-full max-w-xs rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm outline-none focus-visible:border-accent"
      />

      {detail ? (
        <ContactDetail onBack={() => void aria.openContactDetail(null)} />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" role="list" aria-label="Contacts">
          {filtered.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void aria.openContactDetail(c.id)}
                className="w-full rounded-xl border border-line bg-surface p-3 text-left hover:border-accent"
              >
                <div className="font-semibold">{c.name}</div>
                <div className="mt-1 text-xs text-muted">
                  {c.title} · {c.email}
                </div>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="col-span-full rounded-xl border border-dashed border-line bg-surface p-6 text-center text-sm text-muted">
              No contacts match.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function ContactDetail({ onBack }: { onBack: () => void }) {
  const aria = useAria();
  const detail = aria.contactDetail!;
  const c = detail.contact;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg border border-line bg-surface-2 px-3 py-1 text-sm text-muted hover:text-foreground"
      >
        ← Back to contacts
      </button>

      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-lg font-bold">{c.name}</h2>
        <div className="mt-1 text-xs text-muted">
          {c.title} · {c.email}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Fact label="Account" value={c.accountId} />
          <Fact label="Owner" value={c.ownerId} />
          <Fact label="Reply rate" value={Math.round(c.traits.replyRate * 100) + "%"} />
          <Fact label="Busy signal" value={String(c.traits.busySignal)} />
        </dl>
      </section>

      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">Deals</h3>
        {detail.deals.length === 0 ? (
          <p className="mt-2 text-xs text-muted">No deals on this contact.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-sm" role="list">
            {detail.deals.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => void aria.openDealDetail(d.id)}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left hover:bg-surface-2"
                >
                  <span className="font-medium">{d.id}</span>
                  <CategoryChip category={d.forecastCategory} />
                  <span className="tabular-nums">{money(d.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Timeline entityType="contact" entityId={c.id} activities={detail.activities} />
    </div>
  );
}
