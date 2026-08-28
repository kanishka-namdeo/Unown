"use client";

// Zustand store for live activity events streamed over SSE.

import { create } from "zustand";
import type { ActivityItem } from "./agent-types";

const MAX_ITEMS = 60;

interface ActivityState {
  items: ActivityItem[];
  connected: boolean;
  lastEventAt: number | null;
  push: (item: ActivityItem) => void;
  setConnected: (v: boolean) => void;
  clear: () => void;
}

export const useActivityStore = create<ActivityState>((set) => ({
  items: [],
  connected: false,
  lastEventAt: null,
  push: (item) =>
    set((s) => ({
      items: [item, ...s.items].slice(0, MAX_ITEMS),
      lastEventAt: item.ts,
    })),
  setConnected: (v) => set({ connected: v }),
  clear: () => set({ items: [] }),
}));
