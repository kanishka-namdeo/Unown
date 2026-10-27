"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppStore, Task, ColumnId } from "@/lib/sigil/types";
import {
  loadStore,
  saveStore,
  writeThemePreference,
  isDemoSeeded,
  clearDemoSeeded,
  wipePersistedState,
  DEFAULT_STORE,
} from "@/lib/sigil/persistence";
import { createTask, moveTask } from "@/lib/sigil/tasks";

function defaultStore(): AppStore {
  return {
    version: 1,
    tasks: [],
    focusLog: [],
    timer: { ...DEFAULT_STORE.timer },
    theme: "dark",
  };
}

function isEmbedMode(): boolean {
  if (typeof window === "undefined") return false;
  const p = new URLSearchParams(window.location.search);
  return p.get("embed") === "1" || p.get("embed") === "true";
}

export interface AppApi {
  store: AppStore;
  hydrated: boolean;
  embed: boolean;
  demoBadgeVisible: boolean;
  dismissDemoBadge: () => void;
  resetBoard: () => void;
  addTask: (draft: Parameters<typeof createTask>[0]) => Task;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  moveTaskTo: (id: string, column: ColumnId) => void;
  replaceAll: (tasks: Task[], focusLog: AppStore["focusLog"]) => void;
  applyTemplate: (templateId: string, tasksDraft: Array<Partial<AppStore["tasks"][number]> & { title: string }>) => void;
  setTimer: (t: AppStore["timer"]) => void;
  setTheme: (theme: "dark" | "light") => void;
  toggleTheme: () => void;
  logFocus: (entry: { taskId: string; startedAt: string; durationMin: number }) => void;
}

export function useAppStore(opts?: { initialEmbed?: boolean }): AppApi {
  // Hydration contract: when the server page threads `initialEmbed` (from
  // the route's searchParams), server and hydration renders agree and the
  // flag is stable from first paint. The window-read fallback only exists
  // for callers that cannot thread the prop — it runs in the useState
  // INITIALIZER, so on the server it returns false while a client with
  // ?embed=1 returns true: React #418 (the standalone app shipped this bug
  // — it surfaced the moment the landing page iframed /demo?embed=1).
  const [embed] = useState(() => opts?.initialEmbed ?? isEmbedMode());
  // Embed mode disables the best-effort API sync (see syncBestEffort).
  syncDisabledForEmbed = embed;
  // Initial state must be identical on server + hydration: a default empty store.
  // Demo seeding is a client-only side effect that runs after mount.
  const [store, setStore] = useState<AppStore>(() => defaultStore());
  const [hydrated, setHydrated] = useState(false);
  const [demoBadgeVisible, setDemoBadgeVisible] = useState(false);

  // Load once on mount (client only).
  useEffect(() => {
    // Defer all DOM/class mutations until *after* React finishes hydrating
    // this pass, so the server HTML and the client's first hydration render
    // are identical (both from the default store) and no #418 errors fire.
    const t = setTimeout(() => {
      const s = loadStore({ embed });
      setStore(s);
      applyTheme(s.theme);
      setHydrated(true);
      // Show the demo badge only when we seeded it and it hasn't been dismissed.
      if (isDemoSeeded() && !localStorage.getItem("sigil-focus-demo-dismissed")) {
        setDemoBadgeVisible(true);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [embed]);

  // EMBED RESET CHANNEL: the landing page's live-demo frame renders this app
  // with ?embed=1 (where the in-app reset affordance is hidden) and offers
  // its own "Reset demo" button. The handshake: the EMBEDDER posts
  // { source: "unown-landing", type: "sigil-reset" }; this listener (mounted
  // only in embed mode) wipes the persisted store and re-runs the first-load
  // demo seeding, so every visitor is one click from the pristine board. The
  // source+type pair is the contract — stray same-origin messages that do
  // not carry both never trip a reset.
  useEffect(() => {
    if (!embed || typeof window === "undefined") return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string } | null;
      if (!data || data.source !== "unown-landing" || data.type !== "sigil-reset") return;
      // Wipe the persisted state entirely (store + demo-seeded + badge
      // flags), then load: with no saved state, loadStore takes the
      // first-load path and reseeds the demo set fresh.
      wipePersistedState();
      const s = loadStore({ embed: true });
      setStore(s);
      applyTheme(s.theme);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embed]);

  const dismissDemoBadge = useCallback(() => {
    setDemoBadgeVisible(false);
    try {
      localStorage.setItem("sigil-focus-demo-dismissed", "1");
    } catch {
      /* noop */
    }
  }, []);

  // Latest-reset ref for the embed message listener (declared above the
  // listener's dependency on stable identity; resetBoard itself is defined
  // further down and lands here via effect).
  const resetBoardRef = useRef<() => void>(() => {});

  const resetBoard = useCallback(() => {
    setStore((prev) => {
      const next: AppStore = {
        version: 1,
        tasks: [],
        focusLog: [],
        timer: prev.timer,
        theme: prev.theme,
      };
      saveStore(next);
      clearDemoSeeded();
      try {
        localStorage.removeItem("sigil-focus-demo-dismissed");
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  const commit = useCallback((updater: (prev: AppStore) => AppStore) => {
    setStore((prev) => {
      const next = updater(prev);
      saveStore(next);
      return next;
    });
  }, []);

  function applyTheme(theme: "dark" | "light") {
    if (typeof document !== "undefined") {
      // EMBEDDING ADAPTATION: the standalone app overwrote className
      // outright (`= "dark" : ""`), which is fine when this app owns the
      // document — but embedded as the /demo route of the unown landing,
      // documentElement is SHARED with the host layout (font + theme
      // classes live there), and an overwrite would strip them. Toggling
      // the single class is behavior-identical standalone and additive in
      // the embedded document.
      document.documentElement.classList.toggle("dark", theme === "dark");
      writeThemePreference(theme);
    }
  }

  const addTask: AppApi["addTask"] = useCallback(
    (draft) => {
      const task = createTask(draft);
      commit((prev) => ({ ...prev, tasks: [...prev.tasks, task] }));
      syncBestEffort("POST", "/api/tasks", {
        title: task.title,
        description: task.description,
        priority: task.priority,
        labels: task.labels,
        storyPoints: task.storyPoints,
        column: task.column,
      });
      return task;
    },
    [commit],
  );

  const updateTask: AppApi["updateTask"] = useCallback(
    (id, patch) => {
      commit((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t,
        ),
      }));
      syncBestEffort("PUT", `/api/tasks`, { id, ...patch });
    },
    [commit],
  );

  const deleteTask: AppApi["deleteTask"] = useCallback(
    (id) => {
      commit((prev) => ({
        ...prev,
        tasks: prev.tasks.filter((t) => t.id !== id),
        focusLog: prev.focusLog.filter((l) => l.taskId !== id),
      }));
      syncBestEffort("DELETE", `/api/tasks?id=${encodeURIComponent(id)}`, undefined);
    },
    [commit],
  );

  const moveTaskTo: AppApi["moveTaskTo"] = useCallback(
    (id, column) => {
      commit((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === id ? moveTask(t, column) : t)),
      }));
      syncBestEffort("PUT", "/api/tasks", { id, column });
    },
    [commit],
  );

  const replaceAll: AppApi["replaceAll"] = useCallback(
    (tasks, focusLog) => {
      commit((prev) => ({ ...prev, tasks, focusLog }));
      syncBestEffort("PATCH", "/api/tasks", { tasks });
      syncBestEffort("PATCH", "/api/stats", { log: focusLog });
    },
    [commit],
  );

  const applyTemplate: AppApi["applyTemplate"] = useCallback(
    (templateId, drafts) => {
      void templateId;
      const now = new Date();
      const created = drafts.map((d) => createTask({ ...d }, now));
      replaceAll(created, []);
    },
    [replaceAll],
  );

  const setTimer: AppApi["setTimer"] = useCallback(
    (timer) => {
      commit((prev) => ({ ...prev, timer }));
    },
    [commit],
  );

  const setTheme: AppApi["setTheme"] = useCallback((theme) => {
    applyTheme(theme);
    commit((prev) => ({ ...prev, theme }));
  }, [commit]);

  const toggleTheme: AppApi["toggleTheme"] = useCallback(() => {
    setStore((prev) => {
      const next: AppStore = { ...prev, theme: prev.theme === "dark" ? "light" : "dark" };
      applyTheme(next.theme);
      saveStore(next);
      return next;
    });
  }, []);

  const logFocus: AppApi["logFocus"] = useCallback(
    (entry) => {
      commit((prev) => ({
        ...prev,
        focusLog: [...prev.focusLog, entry],
        tasks: prev.tasks.map((t) =>
          t.id === entry.taskId
            ? {
                ...t,
                focusSessions: [
                  ...t.focusSessions,
                  { id: entry.taskId + "-" + Date.now(), startedAt: entry.startedAt, durationMin: entry.durationMin, completed: true },
                ],
              }
            : t,
        ),
      }));
      syncBestEffort("POST", "/api/stats", entry);
    },
    [commit],
  );

  return {
    store,
    hydrated,
    embed,
    demoBadgeVisible,
    dismissDemoBadge,
    resetBoard,
    addTask,
    updateTask,
    deleteTask,
    moveTaskTo,
    replaceAll,
    applyTemplate,
    setTimer,
    setTheme,
    toggleTheme,
    logFocus,
  };
}

/**
 * Best-effort: fire-and-forget fetch to the server API. Failures are swallowed.
 *
 * EMBED MODE OPT-OUT: when the app runs framed (?embed=1 — the landing
 * page's live-demo iframe), the sync is skipped entirely. The server store
 * is in-memory and boots EMPTY, so a client-seeded board's PUT/DELETE calls
 * can only ever 404 — the app still works (localStorage is the source of
 * truth), but every 404 is a console-noise line in the embedder's devtools.
 * The standalone /demo route keeps the full best-effort sync story.
 */
let syncDisabledForEmbed = false;

async function syncBestEffort(
  method: string,
  url: string,
  body?: unknown,
): Promise<void> {
  if (typeof fetch === "undefined" || syncDisabledForEmbed) return;
  try {
    await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    // offline or server down — localStorage already has the source of truth
  }
}
