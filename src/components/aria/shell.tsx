"use client";

/**
 * AriaShell — the /aria app chrome: the embed-aware header
 * (smaller + a "live demo" tag when embedded), the sidebar nav
 * (Dashboard / Pipeline / Accounts / Contacts / Leads / Sequences /
 * Triage / Reports / Admin, gated per-role), the user/tenant
 * header, the demo-credentials helper on login (the parley pattern),
 * and the compact embed chrome.
 */
import { useState } from "react";
import { useAria, DEMO_USERS, DEMO_PASSWORD, type AriaView } from "@/app/aria/client-store";
import { DashboardView } from "./dashboard";
import { PipelineView } from "./pipeline";
import { AccountsView } from "./accounts";
import { ContactsView } from "./contacts";
import { LeadsView } from "./leads";
import { SequencesView } from "./sequences";
import { TriageView } from "./triage";
import { ReportsView } from "./reports";
import { AdminView } from "./admin";
import { LoginScreen } from "./login";

const NAV: Array<{ id: AriaView; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "pipeline", label: "Pipeline" },
  { id: "accounts", label: "Accounts" },
  { id: "contacts", label: "Contacts" },
  { id: "leads", label: "Leads" },
  { id: "sequences", label: "Sequences" },
  { id: "triage", label: "Triage" },
  { id: "reports", label: "Reports" },
  { id: "admin", label: "Admin" },
];

export function AriaShell({ embed }: { embed: boolean }) {
  const aria = useAria();
  const [helpOpen, setHelpOpen] = useState(false);

  // No session yet → the login screen (the embed auto-login fires
  // through the provider, so this is only the standalone path).
  if (!aria.loading && !aria.session) {
    return (
      <div className={"flex min-h-full " + (embed ? "p-4" : "p-6")}>
        <div className="mx-auto w-full max-w-sm">
          <LoginScreen />
        </div>
      </div>
    );
  }

  if (aria.loading) {
    return (
      <div className="flex min-h-full items-center justify-center p-6 text-sm text-muted">
        Loading…
      </div>
    );
  }

  // The nav items the current role may see (Admin is gated on
  // `audit.read` — owner + manager only).
  const visibleNav = NAV.filter((n) => aria.viewVisible(n.id));

  const activeView = aria.view;
  const viewLabel = NAV.find((n) => n.id === activeView)?.label ?? "Dashboard";

  return (
    <div className={"flex min-h-full " + (embed ? "p-3" : "p-6")}>
      {/* ── sidebar nav (hidden in compact embed chrome) ────────── */}
      {!embed && (
        <nav
          className="w-48 shrink-0 space-y-1"
          role="tablist"
          aria-label="Aria navigation"
        >
          <h1 className="mb-3 px-2 text-lg font-bold">
            <span aria-hidden="true">◈ </span>Aria
            <span className="ml-2 text-xs font-normal text-muted">CRM</span>
          </h1>
          {visibleNav.map((n) => (
            <button
              key={n.id}
              role="tab"
              aria-selected={activeView === n.id}
              onClick={() => aria.setView(n.id)}
              className={
                "w-full rounded-lg px-3 py-1.5 text-left text-sm " +
                (activeView === n.id
                  ? "bg-accent/20 font-semibold text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-foreground")
              }
            >
              {n.label}
            </button>
          ))}
        </nav>
      )}

      {/* ── main column ─────────────────────────────────────────── */}
      <div className="min-w-0 flex-1">
        {/* header: user / tenant / demo tag */}
        <header className={"mb-3 flex flex-wrap items-center justify-between gap-2 " + (embed ? "pb-2" : "pb-4")}>
          {embed ? (
            <h1 className="text-lg font-bold">
              <span aria-hidden="true">◈ </span>Aria
              <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-normal text-accent">
                live demo
              </span>
            </h1>
          ) : (
            <h1 className="text-sm text-muted">
              {aria.session?.tenant.slug ?? ""} / {viewLabel}
            </h1>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {aria.user && (
              <span className="rounded-full bg-surface-2 px-2.5 py-1 font-medium">
                {aria.user.name}
                <span className="ml-1 text-muted">({aria.role})</span>
              </span>
            )}
            {aria.session?.tenant.slug && (
              <span className="rounded-full bg-surface-2 px-2.5 py-1">{aria.session.tenant.slug}</span>
            )}
            {embed && <span>demo session</span>}
            <button
              onClick={() => setHelpOpen(true)}
              aria-label="Demo credentials (?)"
              className="rounded-md border border-line px-2 py-1 hover:bg-surface-2"
            >
              ?
            </button>
          </div>
        </header>

        {/* embed tab nav (compact chrome when embedded) */}
        {embed && (
          <nav className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Aria views">
            {visibleNav.map((n) => (
              <button
                key={n.id}
                role="tab"
                aria-selected={activeView === n.id}
                onClick={() => aria.setView(n.id)}
                className={
                  "rounded-lg px-2.5 py-1 text-xs " +
                  (activeView === n.id ? "bg-accent/20 font-semibold text-accent" : "text-muted hover:bg-surface-2")
                }
              >
                {n.label}
              </button>
            ))}
          </nav>
        )}

        {/* ── the active view ─────────────────────────────────────── */}
        <main className="min-h-0 flex-1">
          {activeView === "dashboard" && <DashboardView />}
          {activeView === "pipeline" && <PipelineView />}
          {activeView === "accounts" && <AccountsView />}
          {activeView === "contacts" && <ContactsView />}
          {activeView === "leads" && <LeadsView />}
          {activeView === "sequences" && <SequencesView />}
          {activeView === "triage" && <TriageView />}
          {activeView === "reports" && <ReportsView />}
          {activeView === "admin" &&
            (aria.viewVisible("admin") ? (
              <AdminView />
            ) : (
              <div className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
                You don&apos;t have permission to view this section.
              </div>
            ))}
        </main>
      </div>

      {/* ── the demo-credentials help overlay (parley pattern) ──── */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Demo credentials"
        >
          <button
            aria-label="Close demo credentials"
            onClick={() => setHelpOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60"
            tabIndex={-1}
          />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <h2 className="text-lg font-bold">Demo credentials</h2>
            <p className="mt-1 text-xs text-muted">
              Password for every account:{" "}
              <code className="font-mono text-accent">{DEMO_PASSWORD}</code>
            </p>
            <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted">
              {DEMO_USERS.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
            <button
              onClick={() => setHelpOpen(false)}
              className="mt-5 w-full rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-white hover:bg-accent"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
