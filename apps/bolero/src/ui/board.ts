/**
 * Bolero status board — the API client + the DOM-free render model
 * (ticket S-5). Pure-ish: fetch is injected so the lane B pins can
 * stub it; `render*` functions return DOM-free state that the boot
 * layer (app.ts) turns into nodes.
 *
 * What lives here (DOM-free): the types for the two read endpoints,
 * the `artifactUrl` helper (the screenshot route), and the four
 * surface-state computations the PLAN names (watch list, run
 * history, latest screenshot, failure detail).
 */

/** The registry row as GET /api/watches returns it (one per watch). */
export type WatchEntry = {
  id: number;
  name: string;
  specJson: string;
  createdIso: string;
  lastStatus: string | null;
};

/** One row of a watch's run history (GET /api/watches/:id). */
export type RunHistoryEntry = {
  id: number;
  receivedIso: string;
  report: import("../domain/types.js").RunReport;
};

/** The detail view payload: the watch + its runs, newest last. */
export type WatchDetail = {
  watch: WatchEntry;
  runs: RunHistoryEntry[];
};

export type BoardState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "list"; watches: WatchEntry[] }
  | { kind: "detail"; detail: WatchDetail }
  | { kind: "error"; reason: string };

/** The artifact route: content-addressed under /api/artifacts/. */
export function artifactUrl(name: string): string {
  return `/api/artifacts/${name}`;
}

/**
 * The latest screenshot of a run history: the most recent run that
 * carries a `.png` artifact. Returns undefined when none exists —
 * the UI renders an honest "no screenshot yet", never a broken img.
 */
export function latestScreenshot(runs: RunHistoryEntry[]): { url: string; runId: number } | undefined {
  for (let i = runs.length - 1; i >= 0; i--) {
    const png = runs[i].report.report.artifacts.find((a) => a.ext === "png");
    if (png) return { url: artifactUrl(png.name), runId: runs[i].id };
  }
  return undefined;
}

/** A run failed when its status is not "ok" (the PLAN §2 taxonomy). */
export function isFailedRun(report: RunHistoryEntry["report"]): boolean {
  return report.report.status !== "ok";
}

/**
 * The failure detail of a run: status, the failed step index when
 * present, and a log tail (last 400 chars — the operator wants to
 * SEE the failure, not scroll forever).
 */
export function failureDetail(runs: RunHistoryEntry[]): {
  status: string;
  failedStepIdx: number | null;
  logTail: string | null;
} | undefined {
  for (let i = runs.length - 1; i >= 0; i--) {
    if (!isFailedRun(runs[i].report)) continue;
    const r = runs[i].report.report;
    return {
      status: r.status,
      failedStepIdx: r.failedStepIdx ?? null,
      logTail: r.log ? r.log.slice(-400) : null,
    };
  }
  return undefined;
}

export type Fetcher = {
  listWatches(): Promise<WatchEntry[]>;
  getWatch(id: number): Promise<WatchDetail>;
};

/** The real fetcher (used at boot; injected into the boot layer). */
export function makeFetcher(): Fetcher {
  return {
    async listWatches() {
      const res = await fetch("/api/watches");
      if (!res.ok) throw new Error(`GET /api/watches → ${res.status}`);
      const body = (await res.json()) as { watches: WatchEntry[] };
      return body.watches;
    },
    async getWatch(id: number) {
      const res = await fetch(`/api/watches/${id}`);
      if (!res.ok) {
        let reason = `GET /api/watches/${id} → ${res.status}`;
        if (res.status === 404) {
          try {
            const b = (await res.json()) as { reason?: string };
            reason = `${reason} (${b.reason ?? ""})`;
          } catch {
            /* the status line is enough */
          }
        }
        const err = new Error(reason) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      const body = (await res.json()) as { watch: WatchEntry; runs: RunHistoryEntry[] };
      return { watch: body.watch, runs: body.runs };
    },
  };
}

/** The UI's fetch surface: a failure is a state, not a crash. */
export async function fetchBoardState(fetcher: Fetcher): Promise<BoardState> {
  const watches = await fetcher.listWatches();
  if (watches.length === 0) return { kind: "empty" };
  return { kind: "list", watches };
}

export async function fetchDetailState(id: number, fetcher: Fetcher): Promise<BoardState> {
  const detail = await fetcher.getWatch(id);
  return { kind: "detail", detail };
}

export async function loadListState(fetcher: Fetcher): Promise<BoardState> {
  try {
    return await fetchBoardState(fetcher);
  } catch (e) {
    return { kind: "error", reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function loadDetailState(id: number, fetcher: Fetcher): Promise<BoardState> {
  try {
    return await fetchDetailState(id, fetcher);
  } catch (e) {
    return { kind: "error", reason: e instanceof Error ? e.message : String(e) };
  }
}
