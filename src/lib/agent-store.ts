"use client";

// Zustand store for live activity events streamed over SSE, plus the
// per-run stream buffers (run:tool / run:text frames) that power the
// Console's true streaming transcript ahead of the polling fallback.

import { create } from "zustand";
import type { ActivityItem, RunStreamEntry } from "./agent-types";

const MAX_ITEMS = 60;
const MAX_STREAM_ENTRIES = 400; // per run; a long agent turn stays under this

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

interface RunStreamState {
  streams: Record<string, RunStreamEntry[]>;
  pushRunEvent: (runId: string, entry: RunStreamEntry) => void;
  clearRun: (runId: string) => void;
}

export const useRunStreamStore = create<RunStreamState>((set) => ({
  streams: {},
  pushRunEvent: (runId, entry) =>
    set((s) => {
      const prev = s.streams[runId] ?? [];
      const next = [...prev, entry].slice(-MAX_STREAM_ENTRIES);
      // Avoid unbounded key growth: keep at most the 6 most recent runs.
      const keys = Object.keys(s.streams);
      const streams =
        keys.length > 6 && !s.streams[runId]
          ? Object.fromEntries(keys.slice(-5).map((k) => [k, s.streams[k]]))
          : s.streams;
      return { streams: { ...streams, [runId]: next } };
    }),
  clearRun: (runId) =>
    set((s) => {
      if (!(runId in s.streams)) return s;
      const { [runId]: _drop, ...rest } = s.streams;
      return { streams: rest };
    }),
}));
