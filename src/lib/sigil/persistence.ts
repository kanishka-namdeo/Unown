import type { AppStore, PersistedStore } from "./types";
import { normalizeFocusLog, normalizeTasks } from "./tasks";
import { buildDemoStore, DEMO_BADGE_KEY } from "./demo-data";

const STORAGE_KEY = "sigil-focus-store-v1";
const THEME_KEY = "sigil-focus-theme";

export const DEFAULT_STORE: Omit<AppStore, "tasks" | "focusLog"> = {
  version: 1,
  timer: { focusMin: 25, breakMin: 5 },
  theme: "dark",
};

export function isDemoSeeded(): boolean {
  try {
    return localStorage.getItem(DEMO_BADGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markDemoSeeded(): void {
  try {
    localStorage.setItem(DEMO_BADGE_KEY, "1");
  } catch {
    /* noop */
  }
}

export function clearDemoSeeded(): void {
  try {
    localStorage.removeItem(DEMO_BADGE_KEY);
  } catch {
    /* noop */
  }
}

/**
 * Wipe every persisted key the app owns — the store, the demo-seeded flag,
 * the badge-dismissed flag, the theme preference. The next loadStore() then
 * takes the first-load path (demo seeding). Used by the embed reset channel
 * (the landing page's "Reset demo" button) so every visitor of the live
 * demo is one click from the pristine seeded board.
 */
export function wipePersistedState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DEMO_BADGE_KEY);
    localStorage.removeItem("sigil-focus-demo-dismissed");
    localStorage.removeItem(THEME_KEY);
  } catch {
    /* noop */
  }
}

/**
 * Load the store, seeding demo data on the very first run (no saved state).
 * The demo badge key persists so re-visits do not reseed.
 * When embed is requested, the theme is forced to dark regardless of stored value.
 */
export function loadStore(opts?: { embed?: boolean }): AppStore {
  const fallback = defaultStore();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = deserializeStore(raw);
      if (opts?.embed) s.theme = "dark";
      return s;
    }
    // No saved state: seed the demo set once, and remember that we did.
    const demo = buildDemoStore();
    markDemoSeeded();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeStore(demo)));
    } catch {
      /* noop */
    }
    if (opts?.embed) demo.theme = "dark";
    return demo;
  } catch {
    return fallback;
  }
}

/** Persist the store to localStorage. Returns false when unavailable. */
export function saveStore(store: AppStore): boolean {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(serializeStore(store)),
    );
    if (typeof document !== "undefined") {
      document.documentElement.dataset["sf-theme"] = store.theme;
    }
    return true;
  } catch {
    return false;
  }
}

/** Serialize an in-memory store into its compact persisted form. */
export function serializeStore(store: AppStore): PersistedStore {
  return {
    version: 1,
    tasks: store.tasks,
    focusLog: store.focusLog,
    timer: store.timer,
    theme: store.theme,
  };
}

/**
 * Deserialize + validate persisted JSON into a safe AppStore.
 * Never throws; unknown/invalid fields fall back to defaults.
 */
export function deserializeStore(raw: string): AppStore {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (typeof parsed !== "object" || parsed === null) return defaultStore();
  const r = parsed as Record<string, unknown>;
  const timer = normalizeTimer(r.timer);
  const theme = r.theme === "light" ? "light" : "dark";
  return {
    version: 1,
    tasks: normalizeTasks(r.tasks),
    focusLog: normalizeFocusLog(r.focusLog),
    timer,
    theme,
  };
}

function defaultStore(): AppStore {
  return {
    version: 1,
    tasks: [],
    focusLog: [],
    timer: { ...DEFAULT_STORE.timer },
    theme: "dark",
  };
}

function normalizeTimer(raw: unknown): AppStore["timer"] {
  const base = { ...DEFAULT_STORE.timer };
  if (typeof raw !== "object" || raw === null) return base;
  const r = raw as Record<string, unknown>;
  if (typeof r.focusMin === "number" && Number.isFinite(r.focusMin) && r.focusMin >= 1) {
    base.focusMin = Math.min(180, Math.round(r.focusMin));
  }
  if (typeof r.breakMin === "number" && Number.isFinite(r.breakMin) && r.breakMin >= 0) {
    base.breakMin = Math.min(60, Math.round(r.breakMin));
  }
  return base;
}

export function readThemePreference(): "dark" | "light" {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "light" || t === "dark") return t;
  } catch {
    /* noop */
  }
  return "dark";
}

export function writeThemePreference(theme: "dark" | "light"): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* noop */
  }
}

export { STORAGE_KEY, THEME_KEY };
