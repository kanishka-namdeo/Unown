"use client";

/**
 * ParleyShell — the /parley app chrome: the embed-aware header
 * (smaller + a "live demo" tag when embedded), the 4 view tabs
 * (Inbox / Team / Usage / Analytics), the theme toggle (flips the
 * `.parley-scope` light/dark class — the bazaar shell pattern:
 * never <html>), the tenant + role switchers (the provider's
 * real re-login methods, the "demo session" badge when embedded),
 * the `?` shortcuts help overlay, and the keyboard shortcuts
 * (1–4 views, `t` theme, `?` help, Escape closes drawers).
 */
import { useEffect, useRef, useState } from "react";
import { useDialogDismiss } from "../bazaar/primitives";
import { useParley, DEMO_USERS, type ParleyView } from "@/app/parley/client-store";
import type { Action } from "@/lib/parley/rbac";
import { InboxView } from "./inbox";
import { MembersView } from "./members";
import { UsageView } from "./usage";
import { AnalyticsView } from "./analytics";
import { LoginScreen } from "./login";
import { RoleSwitcher } from "./role-switcher";
import { ThemeToggle } from "./theme-toggle";
import { TenantSwitcher, tenantSlug } from "./tenant-switcher";

const VIEWS: Array<{ id: ParleyView; label: string; key: string; adminOnly?: boolean }> = [
  { id: "inbox", label: "Inbox", key: "1" },
  { id: "team", label: "Team", key: "2" },
  { id: "usage", label: "Usage", key: "3" },
  { id: "analytics", label: "Analytics", key: "4" },
];

const SHORTCUTS: Array<[string, string]> = [
  ["1", "Go to Inbox"],
  ["2", "Go to Team"],
  ["3", "Go to Usage"],
  ["4", "Go to Analytics"],
  ["t", "Toggle theme"],
  ["?", "Toggle this help"],
];

export function ParleyShell({ embed }: { embed: boolean }) {
  const parley = useParley();
  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);
  useDialogDismiss(() => setHelpOpen(false), helpRef);

  // Which view tabs the current role may see (the brief's 4 views,
  // gated per-role: Usage + Analytics are owner/admin/viewer).
  const visibleViews = VIEWS.filter((v) => {
    if (v.id === "inbox" || v.id === "team") return true;
    if (v.id === "usage") return parley.canDo("usage.read" as Action);
    return parley.canDo("analytics.read" as Action);
  });

  // Keyboard shortcuts (the cadence/bazaar shell pattern).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const view = VIEWS.find((v) => v.key === e.key);
      if (view) {
        e.preventDefault();
        parley.setView(view.id);
      } else if (e.key === "t") {
        document.dispatchEvent(new CustomEvent("parley-theme-toggle"));
      } else if (e.key === "?") {
        setHelpOpen((o) => !o);
      } else if (["1", "2", "3", "4"].includes(e.key)) {
        const v = visibleViews.find((vv) => vv.key === e.key);
        if (v) parley.setView(v.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [parley]);

  // No session yet → the login screen (the embed auto-login fires
  // through the provider, so this is only the standalone path).
  if (!parley.loading && !parley.session) {
    return (
      <div className={"flex min-h-full " + (embed ? "p-4" : "p-6")}>
        <div className="mx-auto w-full max-w-sm">
          <LoginScreen />
        </div>
      </div>
    );
  }

  if (parley.loading) {
    return <div className="flex min-h-full items-center justify-center p-6 text-sm text-muted">Loading…</div>;
  }

  return (
    <div className={"flex min-h-full flex-col " + (embed ? "p-4" : "p-6")}>
      <header className={"mb-4 flex items-center justify-between gap-3 " + (embed ? "" : "pb-3")}>
        <h1 className={embed ? "text-lg font-bold" : "text-xl font-bold"}>
          <span aria-hidden="true">✉ </span>Parley
          {embed && (
            <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-normal text-accent">
              live demo
            </span>
          )}
          {embed && parley.session && (
            <span className="ml-2 text-xs text-muted">demo session</span>
          )}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <TenantSwitcher slug={tenantSlug(parley)} />
          <RoleSwitcher />
          <ThemeToggle />
          <button
            onClick={() => setHelpOpen(true)}
            aria-label="Keyboard shortcuts (?)"
            className="rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-surface-2"
          >
            ?
          </button>
        </div>
      </header>

      <nav className={"flex gap-1 " + (embed ? "mb-4" : "mb-6")} role="tablist" aria-label="Views">
        {visibleViews.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={parley.view === v.id}
            onClick={() => parley.setView(v.id)}
            className={
              "flex-1 rounded-lg px-3 py-1.5 text-sm " +
              (parley.view === v.id
                ? "bg-accent/20 font-semibold"
                : "text-muted hover:bg-surface-2")
            }
          >
            {v.label}
          </button>
        ))}
      </nav>

      <main className="flex-1">
        {parley.view === "inbox" && <InboxView />}
        {parley.view === "team" && <MembersView />}
        {parley.view === "usage" &&
          (visibleViews.some((v) => v.id === "usage") ? (
            <UsageView />
          ) : (
            <div className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
              You don't have permission to view this section.
            </div>
          ))}
        {parley.view === "analytics" &&
          (visibleViews.some((v) => v.id === "analytics") ? (
            <AnalyticsView />
          ) : (
            <div className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
              You don't have permission to view this section.
            </div>
          ))}
      </main>

      {helpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
        >
          <button
            aria-label="Close shortcuts help"
            onClick={() => setHelpOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60"
            tabIndex={-1}
          />
          <div
            ref={helpRef}
            tabIndex={-1}
            className="relative z-10 w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl animate-parley-pop"
          >
            <h2 className="text-lg font-bold">Keyboard shortcuts</h2>
            <ul className="mt-4 space-y-2 text-sm">
              {SHORTCUTS.map(([key, desc]) => (
                <li key={key} className="flex items-center justify-between">
                  <kbd className="rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-xs">
                    {key}
                  </kbd>
                  <span className="text-muted">{desc}</span>
                </li>
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

/* ── the switchers live in their own files; re-exported here ───── */
export { TenantSwitcher } from "./tenant-switcher";
