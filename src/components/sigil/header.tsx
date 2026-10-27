"use client";

import type { View } from "./app-shell";

interface HeaderProps {
  theme: "dark" | "light";
  onToggleTheme: () => void;
  view: View;
  onView: (v: View) => void;
  search: string;
  onSearch: (s: string) => void;
}

const NAV: { id: View; label: string; aria: string }[] = [
  { id: "board", label: "Board", aria: "Go to board view" },
  { id: "focus", label: "Focus", aria: "Go to focus timer view" },
  { id: "stats", label: "Stats", aria: "Go to stats view" },
];

export function Header({ theme, onToggleTheme, view, onView, search, onSearch }: HeaderProps) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-sf-border py-3">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-xl text-sf-accent">◈</span>
        <h1 className="text-base font-semibold tracking-tight sm:text-lg">Sigil Focus</h1>
      </div>

      <nav
        aria-label="Main views"
        className="flex items-center gap-0.5 rounded-xl border border-sf-border bg-sf-surface-2 p-0.5"
      >
        {NAV.map((n) => {
          const active = view === n.id;
          return (
            <button
              key={n.id}
              type="button"
              aria-label={n.aria}
              aria-current={active ? "page" : undefined}
              onClick={() => onView(n.id)}
              className={`relative rounded-lg px-3 py-1.5 text-sm font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent focus-visible:outline-offset-2 ${
                active
                  ? "bg-sf-surface text-sf shadow-sm"
                  : "text-sf-dim hover:text-sf"
              }`}
            >
              {n.label}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-sf-accent"
                />
              )}
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <label htmlFor="search-input" className="sr-only">
          Search tasks
        </label>
        <input
          id="search-input"
          type="search"
          placeholder="Search… ( / )"
          aria-label="Search tasks"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="hidden w-44 rounded-lg border border-sf-border bg-sf-surface px-3 py-1.5 text-sm placeholder:text-sf-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent sm:block"
        />
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          className="rounded-lg border border-sf-border bg-sf-surface px-3 py-1.5 text-sm transition-colors hover:bg-sf-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent"
        >
          {theme === "dark" ? "☀︎" : "☾"}
        </button>
      </div>
    </header>
  );
}
