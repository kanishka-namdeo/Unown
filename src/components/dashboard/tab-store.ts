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
] as const;

export type DashboardTab = (typeof DASHBOARD_TABS)[number];

interface TabState {
  tab: DashboardTab;
  setTab: (v: string, opts?: { updateUrl?: boolean }) => void;
}

function tabFromUrl(): DashboardTab {
  if (typeof window === "undefined") return "overview";
  const fromUrl = new URLSearchParams(window.location.search).get("tab");
  return fromUrl && (DASHBOARD_TABS as readonly string[]).includes(fromUrl)
    ? (fromUrl as DashboardTab)
    : "overview";
}

export const useTabStore = create<TabState>((set) => ({
  tab: "overview",
  setTab: (v, opts) => {
    if (!(DASHBOARD_TABS as readonly string[]).includes(v)) return;
    if (opts?.updateUrl !== false && typeof window !== "undefined") {
      window.history.replaceState(null, "", `/dashboard?tab=${v}`);
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
