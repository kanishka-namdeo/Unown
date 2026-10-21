"use client";

// Shared tab navigation state: the current dashboard tab lives here so the
// command palette and the tab strip can drive it without prop drilling, while
// the URL (?tab=) stays the durable, shareable source of truth via the
// History API (no next/navigation dependency — deterministic in tests).

import { create } from "zustand";

export const DASHBOARD_TABS = [
  "overview",
  "lab",
  "memory",
  "dreams",
  "hooks",
  "console",
  "sandboxes",
  "gateway",
  "router",
  "automations",
  "webcache",
] as const;

export type DashboardTab = (typeof DASHBOARD_TABS)[number];

interface TabState {
  tab: DashboardTab;
  setTab: (v: string, opts?: { updateUrl?: boolean; push?: boolean }) => void;
}

function tabFromUrl(): DashboardTab {
  if (typeof window === "undefined") return "overview";
  const fromUrl = new URLSearchParams(window.location.search).get("tab");
  return fromUrl && (DASHBOARD_TABS as readonly string[]).includes(fromUrl)
    ? (fromUrl as DashboardTab)
    : "overview";
}

export const useTabStore = create<TabState>((set, get) => ({
  tab: "overview",
  setTab: (v, opts) => {
    if (!(DASHBOARD_TABS as readonly string[]).includes(v)) return;
    // Duplicate-activation guard (audit M4-b): Radix fires onValueChange for
    // BOTH pointerdown and click on a controlled <Tabs>, so one user click
    // reaches setTab twice. The second call is a no-op when the tab AND the
    // URL already match — otherwise every click pushed TWO history entries
    // and Back needed two presses per tab. A same-tab click with a divergent
    // URL (e.g. /dashboard without ?tab=) repairs it with replaceState.
    if (get().tab === v) {
      if (typeof window === "undefined" || opts?.updateUrl === false) return;
      const urlTab = new URLSearchParams(window.location.search).get("tab");
      if (urlTab === v) return;
      window.history.replaceState(null, "", `/dashboard?tab=${v}`);
      return;
    }
    if (opts?.updateUrl !== false && typeof window !== "undefined") {
      // Tab switches PUSH a history entry (audit M4-b): replaceState made the
      // browser Back button exit the dashboard entirely instead of returning
      // to the previous tab. Programmatic navigation (initial hydration in
      // syncTabFromUrl) still replaces so a fresh load never double-pushes.
      // popstate (below) keeps the store synced on back/forward.
      if (opts?.push) {
        window.history.pushState(null, "", `/dashboard?tab=${v}`);
      } else {
        window.history.replaceState(null, "", `/dashboard?tab=${v}`);
      }
    }
    set({ tab: v as DashboardTab });
  },
}));

/** Hydrate the store from the URL and keep it synced on back/forward. */
export function syncTabFromUrl() {
  if (typeof window === "undefined") return () => {};
  useTabStore.setState({ tab: tabFromUrl() });
  const onPop = () => useTabStore.setState({ tab: tabFromUrl() });
  window.addEventListener("popstate", onPop);
  return () => window.removeEventListener("popstate", onPop);
}
