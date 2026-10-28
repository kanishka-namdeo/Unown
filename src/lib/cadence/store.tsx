"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isSeededHabitId } from "./seed";
import {
  loadState,
  saveState,
  seedState,
  wipeCadenceStorage,
} from "./persistence";
import type {
  CadenceState,
  CheckoffDate,
  Habit,
  HabitFrequency,
} from "./types";

// ── Embedding sync URLs ───────────────────────────────────────────────────
// The embedded app's API lives under /cadence/api/*; standalone serves at
// /cadence/api/* too (the root app owns its own routes).
const HABITS_SYNC_URL = "/cadence/api/habits";
const CHECKOFFS_SYNC_URL = "/cadence/api/checkoffs";

export type CadenceView = "today" | "habits" | "stats";

export interface CadenceAppState {
  habits: CadenceState["habits"];
  entries: CadenceState["entries"];
  theme: CadenceState["theme"];
  selectedHabitId: string | null;
  view: CadenceView;
}

interface CadenceApi {
  state: CadenceAppState;
  toggleCheckoff(habitId: string, date: CheckoffDate): void;
  addHabit(input: { name: string; glyph: string; frequency: HabitFrequency }): void;
  removeHabit(id: string): void;
  setView(v: CadenceView): void;
  selectHabit(id: string | null): void;
}

const CadenceContext = createContext<CadenceApi | null>(null);

/**
 * A hand-rolled zustand-lite for Cadence: one provider, one state object,
 * one commit path (mutate draft → commit) so every state change goes
 * through a single persistence effect.
 *
 * makeInitialState(now) is test-friendly: pass a fixed `now` for the
 * deterministic seed.
 */
export function makeInitialState(now?: Date): CadenceAppState {
  const base = loadState(now);
  return {
    habits: base.habits,
    entries: base.entries,
    theme: base.theme,
    selectedHabitId: null,
    view: "today",
  };
}

let habitCounter = 0;

function generateHabitId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "habit";
  // Date.now() + counter is intentional here (NOT in seed — seed must be
  // deterministic). The id only needs to be unique per session; it is
  // never persisted across server boundaries.
  const ts = Date.now();
  habitCounter = (habitCounter + 1) % 1000;
  return `hab-${slug}-${ts}-${habitCounter}`;
}

export function CadenceProvider({
  children,
  embed = false,
}: {
  children: ReactNode;
  /**
   * embed mode arms the landing frame's reset channel: a `message` listener
   * for {source: "unown-landing", type: "cadence-reset"} is mounted ONLY
   * when true. Mirrors BazaarProvider's embed contract.
   */
  embed?: boolean;
}) {
  const [state, setState] = useState<CadenceAppState>(makeInitialState);

  // Ids of habits created *in this browser session*. Only these are synced
  // to the API — seeded habits are never re-posted.
  const sessionHabitsRef = useRef<Set<string>>(new Set());
  // (habitId, date) pairs already successfully synced this session.
  const syncedCheckoffsRef = useRef<Set<string>>(new Set());
  // Guard: first mount (load only) never triggers a sync POST.
  const mountedRef = useRef(false);

  // Persist on every state change — silent.
  useEffect(() => {
    saveState({
      habits: state.habits,
      entries: state.entries,
      theme: state.theme,
    });
  }, [state]);

  // Fire-and-forget habit sync: POST new session habits on appear.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    for (const h of state.habits) {
      if (isSeededHabitId(h.id)) continue;
      const key = `h:${h.id}`;
      if (sessionHabitsRef.current.has(h.id) && !syncedCheckoffsRef.current.has(key)) {
        fetch(HABITS_SYNC_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: h.name,
            glyph: h.glyph,
            frequency: h.frequency,
          }),
        })
          .then((r) => {
            if (r.ok) syncedCheckoffsRef.current.add(key);
          })
          .catch(() => {/* silent */});
      }
    }
  }, [state.habits]);

  // Fire-and-forget checkoff sync: POST new (habitId, date) pairs.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    for (const [habitId, dates] of Object.entries(state.entries)) {
      if (isSeededHabitId(habitId)) continue;
      for (const d of dates) {
        const key = `c:${habitId}:${d}`;
        if (sessionHabitsRef.current.has(habitId) && !syncedCheckoffsRef.current.has(key)) {
          fetch(CHECKOFFS_SYNC_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ habitId, date: d }),
          })
            .then((r) => {
              if (r.ok) syncedCheckoffsRef.current.add(key);
            })
            .catch(() => {/* silent */});
        }
      }
    }
  }, [state.entries]);

  // ── Embed reset channel ──────────────────────────────────────────────
  // The landing page's "Reset demo" button posts
  // {source: "unown-landing", type: "cadence-reset"}; mounted only in embed
  // mode. Origin-checked + shape-checked: a postMessage from any other
  // window in the hierarchy (or a foreign origin) is ignored.
  useEffect(() => {
    if (!embed || typeof window === "undefined") return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.origin) return;
      const data = e.data as { source?: string; type?: string } | null;
      if (!data || data.source !== "unown-landing" || data.type !== "cadence-reset") return;
      wipeCadenceStorage();
      sessionHabitsRef.current.clear();
      syncedCheckoffsRef.current.clear();
      mountedRef.current = true; // reset is not a sync trigger
      setState({ ...makeInitialState(new Date()), selectedHabitId: null, view: "today" });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embed]);

  const commit = useCallback(
    (
      patch:
        | Partial<CadenceAppState>
        | ((s: CadenceAppState) => Partial<CadenceAppState>),
    ) =>
      setState((s) => ({
        ...s,
        ...(typeof patch === "function" ? patch(s) : patch),
      })),
    [],
  );

  const toggleCheckoff = useCallback(
    (habitId: string, date: CheckoffDate) => {
      commit((s) => {
        const dates = s.entries[habitId] ?? [];
        const has = dates.includes(date);
        const nextDates = has
          ? dates.filter((d) => d !== date)
          : [...dates, date].sort();
        return {
          ...s,
          entries: { ...s.entries, [habitId]: nextDates },
        };
      });
    },
    [commit],
  );

  const addHabit = useCallback(
    (input: { name: string; glyph: string; frequency: HabitFrequency }) => {
      const id = generateHabitId(input.name);
      const today = new Date();
      const dayKey: CheckoffDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const habit: Habit = {
        id,
        name: input.name.trim(),
        glyph: input.glyph,
        frequency: input.frequency,
        createdAt: dayKey,
      };
      if (!isSeededHabitId(id)) sessionHabitsRef.current.add(id);
      commit((s) => ({
        ...s,
        habits: [...s.habits, habit],
        entries: { ...s.entries, [id]: [] },
      }));
    },
    [commit],
  );

  const removeHabit = useCallback(
    (id: string) => {
      commit((s) => {
        const entries = { ...s.entries };
        delete entries[id];
        return {
          ...s,
          habits: s.habits.filter((h) => h.id !== id),
          entries,
          selectedHabitId: s.selectedHabitId === id ? null : s.selectedHabitId,
        };
      });
    },
    [commit],
  );

  const api = useMemo<CadenceApi>(
    () => ({
      state,
      toggleCheckoff,
      addHabit,
      removeHabit,
      setView: (v) => commit({ view: v }),
      selectHabit: (id) => commit({ selectedHabitId: id }),
    }),
    [state, commit, toggleCheckoff, addHabit, removeHabit],
  );

  return (
    <CadenceContext.Provider value={api}>
      {children}
    </CadenceContext.Provider>
  );
}

export function useCadence(): CadenceApi {
  const ctx = useContext(CadenceContext);
  if (!ctx)
    throw new Error("useCadence must be used inside <CadenceProvider>");
  return ctx;
}
