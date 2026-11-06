/**
 * Bolero status board — the boot layer (ticket S-5, K-1 law).
 *
 * Wires the board.ts DOM-free state to the DOM: renders the four
 * PLAN surfaces (watch list with lastStatus, run history, latest
 * screenshot, failure detail) + the honest states (loading skeleton,
 * empty panel, offline/API-down error panel with retry). Keyboard-
 * first: roving tabindex on the list, ArrowUp/ArrowDown move,
 * Enter opens the detail view, Esc returns to the list AND restores
 * focus to the originating row (the chaconne focus pattern).
 *
 * The service worker registers fail-soft on window load (the Coda
 * pattern): a console warn — never a boot dependency. The data path
 * is the API server; a PWA boot with no data still renders the
 * empty / error panels honestly.
 */
import {
  artifactUrl,
  failureDetail,
  isFailedRun,
  latestScreenshot,
  loadDetailState,
  loadListState,
  makeFetcher,
  type Fetcher,
  type BoardState,
  type WatchDetail,
} from "./board.js";

// The fetcher is injectable so the lane B pins can stub fetch without
// a network. The live board uses makeFetcher().
export function createBoard(
  fetcher: Fetcher,
  root: HTMLElement,
  options: { onDetail?: (detail: WatchDetail) => void; onList?: () => void } = {}
): {
  /** Boot the board: fetch the list, render whatever state comes back. */
  boot(): Promise<void>;
  /** Keyboard surface: focus the list, Enter/Esc handled per-row. */
  focusList(): void;
  /** Test / harness hook: open the detail for a watch id. */
  openDetail(id: number): Promise<void>;
  /** Test / harness hook: close the detail, focus the list. */
  closeDetail(): void;
} {
  const state = {
    view: "list" as "list" | "detail",
    detail: null as WatchDetail | null,
    detailOriginRow: null as HTMLElement | null,
    listFocusedId: 0, // 0 = first row
    retry: async () => {},
  };

  // The list lives on this stable outer element; every render only
  // replaces #bolero-list-body, so roving focus + re-open after a
  // re-render keep the same focused node (chaconne focus law).
  root.innerHTML = `<div id="bolero-list-body"></div>`;
  const bodyEl = root.querySelector<HTMLDivElement>("#bolero-list-body")!;

  const paint = (html: string) => {
    bodyEl.innerHTML = html;
  };

  const renderListLoading = () => {
    paint(`
      <section data-surface="list" data-state="loading" aria-busy="true">
        <h2>Watches</h2>
        <p class="bolero-state" data-state="loading">Loading…</p>
      </section>`);
  };

  const renderListEmpty = () => {
    paint(`
      <section data-surface="list" data-state="empty">
        <h2>Watches</h2>
        <p class="bolero-state" data-state="empty">
          No watches yet. Register one through
          <code>POST /api/watches</code> on the bolero server,
          then refresh this board.
        </p>
      </section>`);
  };

  const renderListItems = (list: BoardState["watches"]) => {
    const items = list
      .map(
        (w) => `
          <li class="bolero-row" data-id="${w.id}" data-status="${w.lastStatus ?? "none"}"
              tabindex="-1" role="option" aria-selected="false"
              aria-label="watch ${w.name}, last status ${w.lastStatus ?? "no runs"}">
            <span class="bolero-row__name">${w.name}</span>
            <span class="bolero-row__status" data-status="${w.lastStatus ?? "none"}">
              ${w.lastStatus ?? "no runs"}
            </span>
          </li>`
      )
      .join("");
    paint(`
      <section data-surface="list" data-state="list">
        <h2>Watches</h2>
        <ul class="bolero-list" role="listbox" aria-label="watch list">${items}</ul>
      </section>`);
  };

  const renderError = (reason: string) => {
    paint(`
      <section data-surface="error" data-state="error" role="alert">
        <h2>Board unavailable</h2>
        <p class="bolero-state" data-state="error">${reason}</p>
        <button class="bolero-retry" type="button">Retry</button>
      </section>`);
    bodyEl.querySelector<HTMLButtonElement>(".bolero-retry")!.addEventListener("click", async () => {
      renderListLoading();
      await state.retry();
    });
  };

  const renderDetail = (detail: WatchDetail) => {
    const shot = latestScreenshot(detail.runs);
    const fail = failureDetail(detail.runs);
    const history = detail.runs
      .map((r) => {
        const rep = r.report.report;
        const failed = isFailedRun(r.report) ? " failed" : "";
        return `<li data-run-id="${r.id}" data-status="${rep.status}">
          <span class="bolero-history__status" data-status="${rep.status}">${rep.status}</span>
          <span class="bolero-history__time">${rep.startedAt}</span>
          <span class="bolero-history__prefix">${rep.committedPrefix} steps committed</span>
          <span class="bolero-history__note">${failed ? `step ${rep.failedStepIdx ?? "?"}` : "clean"}</span>
        </li>`;
      })
      .join("");

    const shotHtml = shot
      ? `<figure class="bolero-shot" data-run="${shot.runId}">
           <img src="${shot.url}" alt="Latest screenshot of the watch (run ${shot.runId})" />
           <figcaption>run ${shot.runId}</figcaption>
         </figure>`
      : `<p class="bolero-state" data-state="no-shot">No screenshot captured yet.</p>`;

    const failHtml = fail
      ? `<details class="bolero-fail" data-status="${fail.status}">
           <summary>Failure: ${fail.status}</summary>
           ${fail.failedStepIdx !== null ? `<p>failed at step ${fail.failedStepIdx}</p>` : ""}
           ${fail.logTail ? `<pre class="bolero-fail__log">${fail.logTail}</pre>` : ""}
         </details>`
      : "";

    paint(`
      <section data-surface="detail" data-state="detail" data-watch="${detail.watch.id}">
        <header>
          <h2 tabindex="-1">${detail.watch.name}</h2>
          <p class="bolero-detail__last" data-last-status="${detail.watch.lastStatus ?? "none"}">
            last status: ${detail.watch.lastStatus ?? "no runs"}
          </p>
        </header>
        ${shotHtml}
        <h3>Run history</h3>
        <ol class="bolero-history">${history}</ol>
        ${failHtml}
      </section>`);
  };

  const focusActiveRow = () => {
    const list = root.querySelector<HTMLUListElement>(".bolero-list");
    if (!list) return;
    const rows = Array.from(list.querySelectorAll<HTMLLIElement>(".bolero-row"));
    const active = rows.find((r) => r.dataset.id === String(state.listFocusedId)) ?? rows[0];
    if (!active) return;
    rows.forEach((r) => {
      const is = r === active;
      r.tabIndex = is ? 0 : -1;
      r.setAttribute("aria-selected", is ? "true" : "false");
    });
    active.focus();
  };

  const openDetail = async (id: number) => {
    state.detailOriginRow = root.querySelector<HTMLLIElement>(`.bolero-row[data-id="${id}"]`);
    const s = await loadDetailState(id, fetcher);
    if (s.kind === "detail") {
      state.view = "detail";
      state.detail = s.detail;
      renderDetail(s.detail);
      // The detail rendered: fire the onDetail hook (the harness's
      // render-settle seam — the K-1 pin awaits it before pressing keys
      // in the detail view).
      options.onDetail?.(s.detail);
      // Move focus INTO the detail view so the keyboard surface stays
      // operable (Esc there returns to the list).
      const target = root.querySelector<HTMLHeadingElement>('[data-surface="detail"] h2');
      target?.focus?.();
    } else if (s.kind === "error") {
      renderError(s.reason);
    }
  };

  const closeDetail = () => {
    if (state.view !== "detail") return;
    state.view = "list";
    state.detail = null;
    // We have no watches list yet in this branch — re-fetch it so
    // the row focus has something to land on.
    void (async () => {
      const s = await loadListState(fetcher);
      if (s.kind === "list") {
        renderListItems(s.watches);
      } else if (s.kind === "empty") {
        renderListEmpty();
      } else if (s.kind === "error") {
        renderError(s.reason);
      } else {
        renderListLoading();
      }
      // Restore focus to the originating row (the chaconne pattern):
      // the re-rendered list re-created the DOM — grab the same
      // data-id in the new tree, land focus there.
      const origin = state.detailOriginRow;
      const originId = origin ? origin.dataset.id : null;
      state.listFocusedId = originId ? Number(originId) : 0;
      focusActiveRow();
      // Belt: focusActiveRow focuses the row by data-id, but if the
      // re-fetch came back empty/error there is no row to land on —
      // the origin's data-id is what focusActiveRow matches, so the
      // focus lands on the fresh row of the SAME watch.
      options.onList?.();
      return { originId };
    })();
  };

  // Keyboard-first surface (K-1): roving tabindex on the list,
  // ArrowUp/ArrowDown move, Enter opens, Esc returns + focuses origin.
  const onKey = (ev: KeyboardEvent) => {
    if (state.view === "detail" && ev.key === "Escape") {
      ev.preventDefault();
      closeDetail();
      return;
    }
    if (state.view !== "list") return;
    const rows = Array.from(root.querySelectorAll<HTMLLIElement>('.bolero-row'));
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const idx = rows.findIndex((r) => r.dataset.id === String(state.listFocusedId));
      const next =
        ev.key === "ArrowDown" ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx - 1);
      if (rows[next]) {
        state.listFocusedId = Number(rows[next].dataset.id);
        focusActiveRow();
      }
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const idx = rows.findIndex((r) => r.dataset.id === String(state.listFocusedId));
      const active = rows[idx] ?? rows[0];
      if (active) void openDetail(Number(active.dataset.id));
    }
  };

  root.addEventListener("keydown", onKey);

  return {
    async boot() {
      state.retry = async () => {
        const s = await loadListState(fetcher);
        if (s.kind === "list") renderListItems(s.watches);
        else if (s.kind === "empty") renderListEmpty();
        else if (s.kind === "error") renderError(s.reason);
        else renderListLoading();
      };
      renderListLoading();
      await state.retry();
      focusActiveRow();
    },
    focusList() {
      focusActiveRow();
    },
    openDetail,
    closeDetail,
  };
}

/** Register the service worker fail-soft (the Coda main.ts pattern):
 *  relative scope, on the window load event, a warn — never a boot
 *  dependency. A PWA boot without a SW still works fully offline,
 *  because the data is the server's, not the worker's. */
export function registerSw(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js", { scope: "./" })
      .catch((e) => console.warn("[bolero] service worker registration failed:", e));
  });
}

export async function main(): Promise<void> {
  const root = document.getElementById("bolero-root") ?? document.body;
  const board = createBoard(makeFetcher(), root);
  registerSw();
  await board.boot();
  board.focusList();
}

void main().catch((err) => {
  console.error("[bolero] boot failed:", err);
  const root = document.getElementById("bolero-root") ?? document.body;
  root.innerHTML = `<section data-surface="error" role="alert">
    <h2>Board unavailable</h2>
    <p class="bolero-state" data-state="error">${err instanceof Error ? err.message : String(err)}</p>
  </section>`;
});
