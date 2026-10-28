/**
 * The composer — the reply box with the `/`-prefix canned-reply
 * insertion (typing `/` opens the filtered canned list), the
 * viewer-disabled state + the ReasonTooltip reason, and the
 * customer-side send box (the portal view).
 */
import { useMemo, useState } from "react";
import { useParley } from "@/app/parley/client-store";
import { ReasonTooltip } from "./primitives";

export function Composer({
  convoId,
  customerMode = false,
  customerName,
  customerEmail,
  tenantSlug,
}: {
  convoId: string;
  customerMode?: boolean;
  customerName?: string;
  customerEmail?: string;
  tenantSlug?: string;
}) {
  const parley = useParley();
  const [text, setText] = useState("");
  const [cannedOpen, setCannedOpen] = useState(false);
  const allowed = parley.canDo("conversation.reply");
  const busy = useMemo(() => false, []);

  // The `/`-prefix filter: when the text starts with `/`, show the
  // tenant's canned replies filtered by the query after `/`.
  const cannedQuery = text.startsWith("/") ? text.slice(1).toLowerCase() : "";
  const cannedMatches = cannedOpen && cannedQuery !== ""
    ? parley.canned.filter((c) =>
        c.title.toLowerCase().includes(cannedQuery) ||
        c.body.toLowerCase().includes(cannedQuery),
      )
    : parley.canned;

  async function send() {
    const body = text.trim();
    if (!body) return;
    if (customerMode && tenantSlug && customerName && customerEmail) {
      // New-customer-thread flow: create the conversation (quota-
      // gated, the 402 upgrade prompt renders in the portal too).
      await fetch("/parley/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantSlug,
          subject: body.slice(0, 120),
          customerName,
          customerEmail,
        }),
      }).catch(() => {});
    } else {
      await fetch(`/parley/api/conversations/${convoId}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      }).catch(() => {});
    }
    setText("");
    setCannedOpen(false);
    await parley.refresh();
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      {cannedMatches.length > 0 && (
        <div className="mb-2 rounded-lg border border-line bg-surface-2 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">
            Canned replies
          </div>
          <div className="flex flex-wrap gap-1">
            {cannedMatches.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setText(c.body);
                  setCannedOpen(false);
                }}
                className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent hover:bg-accent/25"
                title={c.title}
              >
                {c.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <ReasonTooltip
        reason={
          allowed || customerMode
            ? undefined
            : "Viewers can't reply — owner/admin/agent only"
        }
        disabled={!allowed && !customerMode}
      >
        <div className="flex gap-2">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCannedOpen(e.target.value.startsWith("/"));
            }}
            onFocus={() => setCannedOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={customerMode ? "Message the customer…" : "Reply…  (type / for canned)"}
            rows={2}
            disabled={!allowed && !customerMode}
            aria-label={customerMode ? "Customer message" : "Reply"}
            className="min-h-10 flex-1 resize-none rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus-visible:border-accent disabled:opacity-50"
          />
          <button
            onClick={() => void send()}
            disabled={busy || (!allowed && !customerMode) || !text.trim()}
            className="self-end rounded-lg bg-accent-strong px-3 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-40"
          >
            {customerMode ? "Send" : "Reply"}
          </button>
        </div>
      </ReasonTooltip>
      {!allowed && !customerMode && (
        <p className="mt-1.5 text-[11px] text-muted">
          Viewing as a read-only role — replies are disabled.
        </p>
      )}
    </div>
  );
}
