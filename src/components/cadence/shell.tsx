"use client";

/**
 * CadenceShell — the /cadence app chrome: an embed-aware header (smaller
 * when the landing frame embeds it), the three view tabs, the theme toggle
 * (flips the store's theme AND the .cadence-scope light/dark class — the
 * bazaar shell.tsx pattern: never <html>, the wrapper carries the class so
 * an embedded demo can't restyle the host page), and the "?" shortcuts help
 * overlay. Renders the active view: Today (Dashboard), Habits, or Stats.
 */
import { useEffect, useRef, useState } from "react";
import { useDialogDismiss } from "../bazaar/primitives";
import { useCadence, type CadenceView } from "@/lib/cadence/store";
import { Dashboard } from "./dashboard";
import { Habits } from "./habits";
import { StatsBand } from "./stats-band";

const VIEWS: Array<{ id: CadenceView; label: string; key: string }> = [
  { id: "today", label: "Today", key: "1" },
  { id: "habits", label: "Habits", key: "2" },
  { id: "stats", label: "Stats", key: "3" },
];

const SHORTCUTS: Array<[string, string]> = [
  ["1", "Go to Today"],
  ["2", "Go to Habits"],
  ["3", "Go to Stats"],
  ["t", "Toggle theme"],
  ["?", "Toggle this help"],
];

export function CadenceShell({ embed }: { embed: boolean }) {
  const { state, setView, toggleTheme } = useCadence();
  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);
  useDialogDismiss(() => setHelpOpen(false), helpRef);

  // Theme sync: flip the .cadence-scope wrapper (falls back to <html> in a
  // hypothetical standalone mount — same as bazaar).
  useEffect(() => {
    const target = document.querySelector(".cadence-scope") ?? document.documentElement;
    target.classList.toggle("light", state.theme === "light");
    target.classList.toggle("dark", state.theme === "dark");
  }, [state.theme]);

  // Keyboard shortcuts (bazaar shell.tsx pattern).
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
        setView(view.id);
      } else if (e.key === "t") {
        toggleTheme();
      } else if (e.key === "?") {
        setHelpOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setView, toggleTheme]);

  return (
    <div className={"flex min-h-full flex-col " + (embed ? "p-4" : "p-6")}>
      <header className={"mb-4 flex items-center justify-between gap-3 " + (embed ? "" : "pb-3")}>
        <h1 className={embed ? "text-lg font-bold" : "text-xl font-bold"}>
          <span aria-hidden="true">〰 </span>Cadence
          {embed && <span className="ml-2 text-xs font-normal text-muted">live demo</span>}
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHelpOpen(true)}
            aria-label="Keyboard shortcuts (?)"
            className="rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-surface-2"
          >
            ?
          </button>
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme (t)"
            className="rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-surface-2"
          >
            {state.theme === "dark" ? "☾" : "☀"}
          </button>
        </div>
      </header>

      <nav
        className={"flex gap-1 " + (embed ? "mb-4" : "mb-6")}
        role="tablist"
        aria-label="Views"
      >
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={state.view === v.id}
            onClick={() => setView(v.id)}
            className={
              "flex-1 rounded-lg px-3 py-1.5 text-sm " +
              (state.view === v.id ? "bg-accent/20 font-semibold" : "text-muted hover:bg-surface-2")
            }
          >
            {v.label}
          </button>
        ))}
      </nav>

      <main className="flex-1">
        {state.view === "today" && <Dashboard />}
        {state.view === "habits" && <Habits />}
        {state.view === "stats" && <StatsBand />}
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
            className="relative z-10 w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl animate-pop"
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
