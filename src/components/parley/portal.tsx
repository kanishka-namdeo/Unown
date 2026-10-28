/**
 * The portal view — the customer-side toggle (the brief's "A view
 * toggle that flips a conversation into the customer-side view: what
 * the customer would see — their thread, no internal controls").
 *
 * The two-sided product in one app: the customer's own bubbles + the
 * agent's replies only. NO assign/status/priority/tags/`/`-canned,
 * NO detail panel. The new-conversation path hits the same 402 quota
 * gate (the upgrade prompt renders here too).
 */
import { useState } from "react";
import { useParley } from "@/app/parley/client-store";
import type { Conversation, Message } from "@/lib/parley/types";
import { timeOf } from "./format";
import { Composer } from "./composer";

export function PortalView({
  convo,
  messages,
}: {
  convo: Conversation;
  messages: Message[];
}) {
  const parley = useParley();
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newMsg, setNewMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const tenantSlug = parley.tenant?.slug ?? "lumen";

  async function createConvo() {
    const subject = newMsg.trim().slice(0, 120);
    if (!newName.trim() || !newEmail.trim() || !subject) {
      setError("Please fill in your name, email, and message.");
      return;
    }
    setError(null);
    const res = await fetch("/parley/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenantSlug,
        subject,
        customerName: newName.trim(),
        customerEmail: newEmail.trim(),
      }),
    });
    if (res.status === 402) {
      const body = await res.json().catch(() => ({}));
      setError(
        (body as { error?: string }).error === "quota_exceeded"
          ? "This inbox is at its plan cap — please try again later or contact the account owner."
          : "Could not create the conversation.",
      );
      return;
    }
    if (!res.ok) {
      setError("Could not create the conversation.");
      return;
    }
    setNewOpen(false);
    setNewName("");
    setNewEmail("");
    setNewMsg("");
    await parley.refresh();
  }

  return (
    <div className="my-3 flex-1 space-y-3" aria-label="Portal view (customer side)">
      <div className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
        portal view — what the customer sees
      </div>

      {/* The customer's own bubbles + the agent's replies only */}
      <div className="space-y-2 overflow-y-auto" role="log" aria-label="Customer thread">
        {messages.map((m) => {
          const isAgent = m.role === "agent";
          return (
            <div key={m.id} className={"flex " + (isAgent ? "justify-end" : "justify-start")}>
              <div
                className={
                  "max-w-[80%] rounded-xl px-3 py-2 text-sm " +
                  (isAgent
                    ? "bg-accent-strong/25 text-foreground"
                    : "bg-surface-2 text-foreground")
                }
              >
                <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted">
                  {isAgent ? "Support" : "You"} · {timeOf(m.createdAt)}
                </div>
                {m.body}
              </div>
            </div>
          );
        })}
      </div>

      {/* The customer's send box — a NEW customer thread */}
      {newOpen ? (
        <div className="space-y-2 rounded-xl border border-line bg-surface p-3">
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Your name"
            aria-label="Your name"
            className="w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm"
          />
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="Your email"
            type="email"
            aria-label="Your email"
            className="w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm"
          />
          <textarea
            value={newMsg}
            onChange={(e) => setNewMsg(e.target.value)}
            placeholder="Your message"
            rows={2}
            aria-label="Your message"
            className="w-full resize-none rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={() => void createConvo()}
              className="rounded-lg bg-accent-strong px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent"
            >
              Send
            </button>
            <button
              onClick={() => {
                setNewOpen(false);
                setError(null);
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setNewOpen(true)}
          className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-muted hover:bg-surface-2/70"
        >
          + New message to {tenantSlug === "lumen" ? "Lumen" : "Northwind"}
        </button>
      )}
    </div>
  );
}
