/**
 * Chaconne — the UI shell (C-3; P0 #4's keyboard-first surface).
 *
 * Boot → three states (loading / corrupt-error / ready) → route-by-
 * route render (recipes ⇄ runs ⇄ artifact) → the Ctrl+K palette →
 * the key surface (N new, E edit, R run, V view-run, A artifact, 1/2
 * route, Ctrl+E export, Ctrl+O import). The DOM-free semantics live
 * in `palette.ts` + `run-history.ts` + `artifact-viewer.ts` +
 * `status.ts` + `empty.ts`; this file owns the render + the event
 * plumbing.
 *
 * What is DOM (and therefore lives here):
 *   - `document` / `window` global access
 *   - the localStorage adapter wiring (`createLocalStorageAdapter`)
 *   - the boot state renderers (loading / corrupt / empty)
 *   - the route renderers (recipes list, run history, artifact view)
 *   - the palette open/close/filter/select/enter
 *   - the recipe editor's dialog open/submit/close (the modal module
 *     paints the form; this file owns the state)
 *   - the key handler (the `keydown` event → command dispatch)
 *
 * What is NOT here (stays in the domain / storage):
 *   - the recipe/run mutations (model.ts — pure, returns NEW data)
 *   - the canonical JSON bytes (io.ts's exportData)
 *   - the atomic-writes law (local-storage.ts's save/recover)
 *   - the palette command table (palette.ts's PALETTE_COMMANDS)
 *
 * EVERY TRANSITION PERSISTS: `persistAll` runs on every ready-state
 * render (the Ostinato B-3 lane) — data + session state written NOW,
 * so a killed tab restores by construction.
 *
 * Boot law: `load()` null → first boot (honest empty state); corrupt
 * (undecodable bytes) → the error panel (never a wipe, never a
 * crash — Ostinato's `load()` receipt, verbatim).
 */
import type { ChaconneData, Recipe } from "../domain/types.js";
import { DomainInvariantError } from "../domain/types.js";
import { createImportExport } from "../domain/io.js";
import {
  addRecipe,
  updateRecipe,
  removeRecipe,
} from "../domain/model.js";
import { createLocalStorageAdapter } from "../storage/local-storage.js";
import { STORAGE_KEY, STORAGE_TMP_KEY } from "../storage/local-storage.js";
import { el } from "./el.js";
import {
  PALETTE_BY_ID,
  filterCommands,
  isCommandEnabled,
  COMMAND_KEY_DISPATCH,
  PALETTE_GROUPS,
  type PaletteCommand,
  type Selection,
  type ChaconneRoute,
} from "./palette.js";
import {
  renderRecipeEditor,
  handleEditorEscape,
  closeRecipeEditor,
  type EditorState,
  type RecipeDraft,
} from "./recipe-editor.js";
import {
  renderRunHistory,
  renderStatusBadge,
  moveRunSelection,
  orderedRunIds,
} from "./run-history.js";
import {
  renderScreenshotArtifact,
  renderExtractedValues,
} from "./artifact-viewer.js";
import { renderStatusIdle } from "./status.js";
import { renderEmpty, renderFailedRun } from "./empty.js";

// ─── The app's clock (the injected Clock; the UI edge reads the wall) ────────

function appClock(): string {
  return new Date().toISOString();
}

// ─── The boot state machine (P0 #5: loading / corrupt / ready, never blank) ─

type BootState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ChaconneData };

type AppState = {
  boot: BootState;
  route: ChaconneRoute;
  /** The focused recipe on the recipes route (edit/delete/run target). */
  focusedRecipeId: number | null;
  /** The focused run on the runs route (view/delete target). */
  focusedRunId: number | null;
  /** The focused artifact (the artifact route's target). */
  focusedArtifact: { runId: number; index: number } | null;
  /** The palette's state. */
  paletteOpen: boolean;
  paletteQuery: string;
  paletteSelection: number;
  /** The invoking control (P0 #9: Esc returns focus to it). */
  invokingEl: HTMLElement | null;
  /** The open recipe editor (null = closed; the D8 discard guard). */
  editor: EditorState | null;
  /** The editor's submit actions (set once in main). */
  editorActions: {
    submit: (draft: RecipeDraft, recipeId: number | null) => string | null;
    close: () => void;
  } | null;
  /** The notice line (rendered under the header; cleared on the next transition). */
  notice: string | null;
  /** The not-scheduled flag (the Run action's honest placeholder). */
  lastRunNotice: string | null;
};

// ─── The main entry (the index.html's module script) ─────────────────────────

export type { AppState };

export async function main(): Promise<void> {
  const storage = createLocalStorageAdapter(window.localStorage);
  // P0 #6: the crash-recovery pass (an orphaned temp key from an
  // interrupted save is discarded; the committed key is last-good).
  await storage.recover();

  const app: AppState = {
    boot: { kind: "loading" },
    route: "recipes",
    focusedRecipeId: null,
    focusedRunId: null,
    focusedArtifact: null,
    paletteOpen: false,
    paletteQuery: "",
    paletteSelection: 0,
    invokingEl: null,
    editor: null,
    editorActions: null,
    notice: null,
    lastRunNotice: null,
  };

  const io = createImportExport();
  let data: ChaconneData;
  try {
    const loaded = await storage.load();
    if (loaded === null) {
      // First boot (no committed key) OR corrupt committed bytes —
      // the honest distinction (Ostinato's boot law): corrupt stores
      // their bytes for forensics; the panel's Clear button wipes.
      const raw = window.localStorage.getItem(STORAGE_KEY);
      data = raw === null
        ? { schema: "chaconne.v1", recipes: [], runs: [] } // first boot
        : (() => {
            // Corrupt bytes: attempt the import gate; a DomainInvariant
            // throw means the bytes decoded but are structurally wrong.
            try {
              const res = io.importData(raw);
              return res.rejected ? { schema: "chaconne.v1", recipes: [], runs: [] } : res.data;
            } catch {
              throw new DomainInvariantError("stored data is undecodable (corrupt store)");
            }
          })();
    } else {
      // Loadable bytes: validate through the import gate (the byte-
      // stable round-trip — the Ostinato lane I-1 law).
      const res = io.importData(JSON.stringify(loaded));
      data = res.rejected ? { schema: "chaconne.v1", recipes: [], runs: [] } : res.data;
    }
  } catch (e) {
    app.boot = {
      kind: "error",
      message:
        e instanceof DomainInvariantError
          ? `Stored data is corrupt: ${e.message}. Your last good state was kept on disk for forensics; clear it to start fresh.`
          : `Failed to load stored data: ${(e as Error).message}`,
    };
    app.editorActions = { submit: () => "Not ready.", close: () => {} };
    renderAll(app);
    return;
  }

  app.boot = { kind: "ready", data };

  const persistAll = () => {
    if (app.boot.kind !== "ready") return;
    void storage.save(app.boot.data, io.exportData(app.boot.data));
  };

  // The data group's key-driven actions (export / import / clear).
  const actions = {
    export: () => {
      if (app.boot.kind !== "ready") return;
      const json = io.exportData(app.boot.data);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "chaconne-export.json";
      // Attach before click: a detached anchor's programmatic click
      // does not reliably dispatch the download (the Ostinato B-7
      // receipt — the flow lane's live kin).
      document.body.append(a);
      a.click();
      a.remove();
      // Revoke LATE: a synchronous revoke cancels the download the
      // click just scheduled.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      app.notice = "Exported the data set (canonical JSON).";
      rerender();
    },
    import: () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.style.display = "none";
      document.body.append(input);
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const res = io.importData(await file.text());
          if (res.rejected) {
            const r = res.report;
            app.notice = `Import refused: ${r.reasons.join("; ")} (${r.wouldImport.recipes} recipe(s), ${r.wouldImport.runs} run(s) would have imported — none did).`;
          } else {
            app.boot = { kind: "ready", data: res.data };
            app.focusedRecipeId = null;
            app.focusedRunId = null;
            app.focusedArtifact = null;
            app.notice = "Imported the data set.";
            persistAll();
          }
          rerender();
        } catch (e) {
          app.notice = `Import failed: ${(e as Error).message}`;
          rerender();
        }
        input.remove();
      };
      input.click();
    },
  };

  // The editor's submit lane (the recipe create/update over the C-1
  // model functions; the every-transition persist rides rerender's
  // persistAll).
  const editorActions = {
    submit: (draft: RecipeDraft, recipeId: number | null): string | null => {
      if (app.boot.kind !== "ready") return "Not ready.";
      try {
        let next: ChaconneData;
        if (recipeId === null) {
          next = addRecipe(app.boot.data, draft.name, draft.steps as never[]).data;
        } else {
          next = updateRecipe(app.boot.data, recipeId, { name: draft.name, steps: draft.steps as never[] });
        }
        app.boot = { kind: "ready", data: next };
        app.notice = recipeId === null ? `Recipe "${draft.name}" created.` : `Recipe "${draft.name}" saved (version bumped).`;
        if (recipeId === null) app.focusedRecipeId = next.recipes[next.recipes.length - 1]?.id ?? null;
        return null;
      } catch (e) {
        return e instanceof DomainInvariantError ? e.message : String(e);
      }
    },
    close: () => {
      app.editor = null;
      closeRecipeEditor("chaconne-editor", app.invokingEl);
      app.invokingEl = null;
    },
  };
  app.editorActions = editorActions;

  function rerender() {
    renderAll(app, persistAll);
  }

  // The key surface (P0 #3 + P0 #4: the keyboard-first contract).
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    onKey(e, app, actions, rerender);
  });

  renderAll(app, persistAll);
}

// ─── The key handler (the command dispatch, P0 #3/#4) ────────────────────────

function onKey(
  e: KeyboardEvent,
  app: AppState,
  actions: { export: () => void; import: () => void },
  rerender: () => void,
) {
  // The editor's own keys (when open, the form owns the event — the
  // Ostinato modal contract: ONLY Escape is intercepted; typing
  // flows to the form's inputs, Tab moves focus, Enter submits).
  if (app.editor) {
    if (e.key === "Escape") {
      e.preventDefault();
      handleEditorEscape({
        overlayId: "chaconne-editor",
        state: app.editor,
        isDirty: () => true, // the guard's hasInput check does the real work
        onClose: () => {
          app.editor = null;
          closeRecipeEditor("chaconne-editor", app.invokingEl);
          app.invokingEl = null;
        },
      });
      return;
    }
    return;
  }

  // The palette's own keys (when open, the palette owns the event).
  if (app.paletteOpen) {
    if (e.key === "Escape") {
      closePalette(app);
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      movePaletteSelection(app, e.key === "ArrowDown" ? 1 : -1);
      renderPalette(app);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      runSelectedPaletteCommand(app, actions, rerender);
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      app.paletteQuery = app.paletteQuery.slice(0, -1);
      app.paletteSelection = 0;
      renderPalette(app);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      app.paletteQuery += e.key;
      app.paletteSelection = 0;
      renderPalette(app);
      return;
    }
    return; // a modal surface: the palette swallows other keys
  }

  // The Ctrl/Meta modifier keys (the data group + the palette).
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === "k") {
      e.preventDefault();
      // The B-10 lane: the overlay paints ITSELF — never through the
      // full-root rerender (the invoking element must stay alive for
      // the focus-return lane).
      openPalette(app);
      renderPalette(app);
      return;
    }
    if (k === "e") {
      e.preventDefault();
      actions.export();
      return;
    }
    if (k === "o") {
      e.preventDefault();
      actions.import();
      return;
    }
    return;
  }

  // The command dispatch (the palette.ts's COMMAND_KEY_DISPATCH table).
  const cmdId = COMMAND_KEY_DISPATCH[e.key];
  if (cmdId !== undefined) {
    e.preventDefault();
    dispatchCommand(cmdId, app, actions, rerender);
    return;
  }

  // The run-history's arrow navigation (the j/k kin on the runs route).
  if (app.route === "runs" && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    moveRunFocus(app, e.key === "ArrowDown" ? 1 : -1);
    rerender();
    return;
  }
}

// ─── The command dispatch (every palette command, P0 #4's rows) ─────────────

function currentSelection(app: AppState): Selection {
  const run = app.focusedRunId !== null
    ? app.boot.kind === "ready" ? app.boot.data.runs.find((r) => r.id === app.focusedRunId) : undefined
    : undefined;
  return {
    recipeId: app.focusedRecipeId,
    runId: app.focusedRunId,
    runHasArtifacts: run ? run.artifacts.length > 0 : false,
    artifactRunId: app.focusedArtifact?.runId ?? null,
  };
}

function dispatchCommand(
  id: string,
  app: AppState,
  actions: { export: () => void; import: () => void },
  rerender: () => void,
) {
  if (app.boot.kind !== "ready") return;
  const sel = currentSelection(app);
  const cmd: PaletteCommand | undefined = PALETTE_BY_ID[id];
  if (!cmd || !isCommandEnabled(cmd, sel, app.route)) return; // dimmed → inert
  switch (id) {
    case "new-recipe":
      openEditor(app, null);
      return;
    case "edit-recipe":
      openEditor(app, sel.recipeId);
      return;
    case "delete-recipe":
      if (sel.recipeId === null) return;
      try {
        const next = removeRecipe(app.boot.data, sel.recipeId);
        app.boot = { kind: "ready", data: next };
        app.focusedRecipeId = null;
        app.notice = "Recipe deleted (its runs stay in the history).";
      } catch (e) {
        app.notice = `Cannot delete: ${(e as Error).message}`;
      }
      rerender();
      return;
    case "run-recipe":
      if (sel.recipeId === null) return;
      // NON-OVERLAP: C-4 owns the scheduling/runner integration.
      // C-3 records the HONEST placeholder state (the ticket's ruling):
      // the Run action flips the notice to the not-scheduled copy,
      // the recipe is untouched, no fake progress.
      app.lastRunNotice = "not-scheduled";
      rerender();
      return;
    case "view-run":
      if (sel.runId === null) return;
      app.route = "runs";
      app.focusedRunId = sel.runId;
      rerender();
      return;
    case "view-artifact":
      if (!sel.runHasArtifacts && sel.artifactRunId === null) return;
      const target = sel.artifactRunId ?? app.focusedRunId;
      if (target === null) return;
      const run = app.boot.data.runs.find((r) => r.id === target);
      if (!run || run.artifacts.length === 0) return;
      app.route = "artifact";
      app.focusedArtifact = { runId: run.id, index: 0 };
      rerender();
      return;
    case "delete-run":
      if (sel.runId === null) return;
      if (app.boot.data.runs.length > 0) {
        // Runs are the store's history — deletion is an honest
        // user action (the PRD's P0 #1 "runs" collection is mutable
        // by design). The every-transition persist rides rerender.
        app.boot = {
          kind: "ready",
          data: {
            ...app.boot.data,
            runs: app.boot.data.runs.filter((r) => r.id !== sel.runId),
          },
        };
        app.focusedRunId = null;
        app.focusedArtifact = null;
        app.notice = "Run deleted from the history.";
      }
      rerender();
      return;
    case "export":
      actions.export();
      return;
    case "import":
      actions.import();
      return;
    case "go-recipes":
      app.route = "recipes";
      rerender();
      return;
    case "go-runs":
      app.route = "runs";
      rerender();
      return;
  }
}

function openEditor(app: AppState, recipeId: number | null) {
  // The palette and the editor never coexist (the Ostinato rule).
  app.paletteOpen = false;
  document.getElementById("chaconne-palette")?.remove();
  app.invokingEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  app.editor = { recipeId, discardArmed: false };
  renderRecipeEditor({
    overlayId: "chaconne-editor",
    recipe: recipeId !== null
      ? app.boot.kind === "ready" ? app.boot.data.recipes.find((r) => r.id === recipeId) ?? null : null
      : null,
    onSubmit: (draft, rid) => {
      const a = app.editorActions;
      if (!a) return "Not ready.";
      const err = a.submit(draft, rid);
      if (err !== null) return err;
      renderAll(app);
      return null;
    },
    onClose: () => {
      app.editor = null;
      closeRecipeEditor("chaconne-editor", app.invokingEl);
      app.invokingEl = null;
    },
    isDirty: () => true,
  });
}

function moveRunFocus(app: AppState, dir: 1 | -1) {
  if (app.boot.kind !== "ready") return;
  const ids = orderedRunIds(app.boot.data);
  if (ids.length === 0) return;
  const idx = app.focusedRunId !== null ? ids.indexOf(app.focusedRunId) : -1;
  const next = idx === -1 ? 0 : moveRunSelection(idx, dir, ids.length);
  app.focusedRunId = ids[next];
}

// ─── The palette (Ctrl+K, the filter-as-you-type + arrow/wrap select) ───────

function openPalette(app: AppState) {
  app.paletteOpen = true;
  app.paletteQuery = "";
  app.paletteSelection = 0;
  app.invokingEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function closePalette(app: AppState) {
  app.paletteOpen = false;
  app.paletteQuery = "";
  document.getElementById("chaconne-palette")?.remove();
  // P0 #9: focus returns to the invoking control.
  (app.invokingEl ?? document.body).focus();
  app.invokingEl = null;
}

function movePaletteSelection(app: AppState, dir: 1 | -1) {
  const cmds = filterCommands(app.paletteQuery);
  if (cmds.length === 0) return;
  app.paletteSelection = (((app.paletteSelection + dir) % cmds.length) + cmds.length) % cmds.length;
}

function runSelectedPaletteCommand(
  app: AppState,
  actions: { export: () => void; import: () => void },
  rerender: () => void,
) {
  const cmds = filterCommands(app.paletteQuery);
  const cmd = cmds[app.paletteSelection];
  if (!cmd) return;
  closePalette(app);
  dispatchCommand(cmd.id, app, actions, rerender);
}

// ─── The DOM render (the three boot states + the routes + the palette) ──────

function renderAll(app: AppState, persistAll?: () => void) {
  const root = document.getElementById("chaconne-root") as HTMLElement;
  root.replaceChildren();

  const header = el("header", { class: "chaconne-header" });
  header.append(
    el("h1", { text: "Chaconne", class: "chaconne-title" }),
    el("span", { text: "Ctrl+K · commands", class: "chaconne-palette-hint" }),
  );
  root.append(header);

  if (app.notice) {
    root.append(el("p", { class: "chaconne-notice", role: "status", text: app.notice }));
    app.notice = null;
  }

  if (app.boot.kind === "loading") {
    root.append(renderLoading());
    return;
  }
  if (app.boot.kind === "error") {
    root.append(renderError(app.boot.message));
    return;
  }

  // The every-transition rule (P0 #6, the Ostinato B-3 lane): every
  // ready-state render rewrites the storage lane — a killed tab
  // restores by construction.
  persistAll?.();

  const { data } = app.boot;
  switch (app.route) {
    case "recipes":
      root.append(renderRecipesRoute(app, data));
      break;
    case "runs":
      root.append(renderRunsRoute(app, data));
      break;
    case "artifact":
      root.append(renderArtifactRoute(app, data));
      break;
  }
}

function renderLoading(): HTMLElement {
  const d = el("div", { class: "chaconne-state", role: "status", id: "chaconne-loading" });
  d.append(el("p", { text: "Loading your recipes…", class: "chaconne-state-copy" }));
  return d;
}

function renderError(message: string): HTMLElement {
  const d = el("div", { class: "chaconne-state chaconne-error", role: "alert", id: "chaconne-error" });
  d.append(el("h2", { text: "Storage error", class: "chaconne-state-title" }));
  d.append(el("p", { text: message, class: "chaconne-state-copy" }));
  const clear = el("button", { text: "Clear and start fresh", class: "chaconne-action", id: "chaconne-clear" });
  clear.onclick = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(STORAGE_TMP_KEY);
    location.reload();
  };
  d.append(clear);
  return d;
}

// ─── The recipes route ───────────────────────────────────────────────────────

function renderRecipesRoute(app: AppState, data: ChaconneData): HTMLElement {
  const wrap = el("div", { class: "chaconne-recipes", id: "chaconne-recipes" });
  wrap.append(el("h2", { text: "Recipes", class: "chaconne-section-title" }));
  if (data.recipes.length === 0) {
    wrap.append(
      renderEmpty("no-recipes", {
        label: "New recipe (N)",
        id: "chaconne-cta-new-recipe",
      }),
    );
    const cta = wrap.querySelector<HTMLButtonElement>("#chaconne-cta-new-recipe");
    if (cta) cta.onclick = () => openEditor(app, null);
    return wrap;
  }
  const list = el("ol", { class: "chaconne-recipe-list", role: "list", id: "chaconne-recipe-list" });
  for (const r of data.recipes) {
    const li = el("li", {
      class: "chaconne-recipe-row",
      "data-recipe": String(r.id),
      role: "option",
      "aria-selected": String(r.id === app.focusedRecipeId),
      tabindex: r.id === app.focusedRecipeId ? "0" : "-1",
    });
    if (r.id === app.focusedRecipeId) li.setAttribute("aria-current", "true");
    const lastRun = [...data.runs].reverse().find((run) => run.recipeId === r.id);
    li.append(
      el("span", { text: `${r.name} (v${r.version})`, class: "chaconne-recipe-name" }),
      el("span", { text: `${r.steps.length} step${r.steps.length === 1 ? "" : "s"}`, class: "chaconne-recipe-meta" }),
      lastRun ? renderStatusBadge(lastRun.status) : el("span", { text: "no runs yet", class: "chaconne-recipe-meta" }),
      el("button", { text: "edit", class: "chaconne-action", id: `chaconne-edit-${r.id}` }),
    );
    li.querySelector<HTMLButtonElement>(`#chaconne-edit-${r.id}`)!.onclick = () => {
      openEditor(app, r.id);
    };
    li.onclick = () => {
      app.focusedRecipeId = r.id;
      renderAll(app);
    };
    list.append(li);
  }
  wrap.append(list);
  return wrap;
}

// ─── The runs route (the grouped history + the not-scheduled placeholder) ────

function renderRunsRoute(app: AppState, data: ChaconneData): HTMLElement {
  const wrap = el("div", { class: "chaconne-runs-root" });
  wrap.append(renderRunHistory(data.recipes, data.runs, app.focusedRunId));

  // The not-scheduled placeholder (the Run action's honest state —
  // the C-4 integration flips this to the live progress row).
  if (app.lastRunNotice === "not-scheduled") {
    const recipe = data.recipes.find((r) => r.id === app.focusedRecipeId);
    if (recipe) {
      wrap.append(renderStatusIdle(recipe.name));
    }
  }
  return wrap;
}

// ─── The artifact route (the screenshot + extracted-value views) ────────────

function renderArtifactRoute(app: AppState, data: ChaconneData): HTMLElement {
  const wrap = el("div", { class: "chaconne-artifacts", id: "chaconne-artifacts" });
  const fa = app.focusedArtifact;
  const run = fa ? data.runs.find((r) => r.id === fa.runId) : undefined;
  const recipe = run ? data.recipes.find((r) => r.id === run.recipeId) : undefined;
  if (!run || !fa) {
    wrap.append(renderEmpty("no-artifacts"));
    wrap.append(el("button", { text: "Back to runs (2)", class: "chaconne-action", id: "chaconne-artifact-back" }));
    wrap.querySelector<HTMLButtonElement>("#chaconne-artifact-back")!.onclick = () => {
      app.route = "runs";
      renderAll(app);
    };
    return wrap;
  }
  const artifact = run.artifacts[fa.index];
  if (artifact && artifact.name.endsWith(".png")) {
    wrap.append(renderScreenshotArtifact(artifact, recipe?.name ?? `Recipe #${run.recipeId}`));
  } else {
    wrap.append(renderExtractedValues(run, recipe?.name ?? `Recipe #${run.recipeId}`));
  }
  if (run.status !== "ok" && run.failedStepIdx !== undefined) {
    wrap.append(
      renderFailedRun({
        recipeName: recipe?.name ?? `Recipe #${run.recipeId}`,
        status: run.status,
        failedStep: String(run.failedStepIdx),
        committedPrefix: run.committedPrefix,
        totalSteps: recipe?.steps.length ?? 0,
      }),
    );
  }
  wrap.append(el("button", { text: "Back to runs (2)", class: "chaconne-action", id: "chaconne-artifact-back" }));
  wrap.querySelector<HTMLButtonElement>("#chaconne-artifact-back")!.onclick = () => {
    app.route = "runs";
    renderAll(app);
  };
  return wrap;
}

// ─── The palette's DOM (the overlay + the filter-as-you-type rows) ───────────

function renderPalette(app: AppState) {
  let overlay = document.getElementById("chaconne-palette");
  if (!overlay) {
    overlay = el("div", { id: "chaconne-palette", class: "chaconne-palette" });
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Command palette");
    document.body.append(overlay);
  }
  const sel = currentSelection(app);
  const cmds = filterCommands(app.paletteQuery);
  const list = el("ul", {
    class: "chaconne-palette-list",
    role: "listbox",
    "aria-label": "Commands",
  });
  list.setAttribute("tabindex", "0");
  let group: string | null = null;
  cmds.forEach((cmd, i) => {
    if (cmd.group !== group) {
      group = cmd.group;
      list.append(el("li", { class: "chaconne-palette-group", text: group, role: "presentation" }));
    }
    const li = el("li", {
      class: `chaconne-palette-row${i === app.paletteSelection ? " chaconne-selected" : ""}`,
      "data-cmd": cmd.id,
      role: "option",
      "aria-selected": i === app.paletteSelection ? "true" : "false",
    });
    li.append(
      el("span", { text: cmd.label, class: "chaconne-palette-label" }),
      el("kbd", { text: cmd.hint, class: "chaconne-palette-hint" }),
    );
    if (!isCommandEnabled(cmd, sel, app.route)) {
      li.classList.add("chaconne-disabled");
    }
    list.append(li);
  });
  const input = el("input", {
    class: "chaconne-palette-input",
    "aria-label": "Filter commands",
    value: app.paletteQuery,
  });
  input.oninput = () => {
    app.paletteQuery = input.value;
    app.paletteSelection = 0;
    renderPalette(app);
  };
  overlay.replaceChildren(input, list);
  input.focus();
}

// ─── The service-worker registration (PWA lane; the fail-soft Coda
// main.ts pattern — never a boot dependency) ──────────────────────────

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js", { scope: "./" })
      .catch((err) => {
        console.warn("service worker registration failed (offline lane disabled):", err);
      });
  });
}

main().catch((err) => {
  console.error("chaconne boot failed:", err);
  const root = document.getElementById("chaconne-root");
  if (root) {
    const d = el("div", { class: "chaconne-state chaconne-error", role: "alert" });
    d.append(el("h2", { text: "Boot failed", class: "chaconne-state-title" }));
    d.append(el("p", { text: String(err), class: "chaconne-state-copy" }));
    root.replaceChildren(d);
  }
});
registerServiceWorker();
