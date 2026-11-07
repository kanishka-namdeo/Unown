/**
 * app.ts — the Fugue UI shell (F-4: PWA shell + job authoring).
 *
 * Boot → adapter resolution → route-by-route rendering → every-
 * transition `persistAll` through the F-1 domain StoragePort. The DOM
 * wiring lives here; the pure semantics live in src/domain and
 * src/adapter (the adapter seam, PLAN §1 law — the browser closure is
 * network-free; the real engine transport arrives through an injected
 * `RestAdapterClient`).
 *
 * Adapter resolution (the F-4 SPIKE lane, PLAN §7 unknown #2):
 *   - A RestAdapter built over the browser's native `fetch` client is
 *     the live proxy path (the runner's engine-client.ts is that
 *     client in production; in dev/test the browser talks to the
 *     fixture server on 4130 directly — CORS headers are pinned).
 *   - When the live lane is unreachable (EngineDown), the app
 *     DEGRADES to the `#fugue-engine-down` panel + FakeEngineAdapter
 *     for the local data store — never a crash, never a blank.
 *
 * Every transition through the app state machine ends in
 * `persistAll`, which writes canonical bytes through the domain's
 * StoragePort (temp-key + commit-swap, the Ostinato law).
 */
import type { FugueData, Job } from "../domain/types.js";
import { DomainInvariantError } from "../domain/types.js";
import { load, save, recover, CorruptStoreError, type StorageLike } from "../domain/storage.js";
import { emptyData, addJob, updateJob, recordEngine, recomputeNextId } from "../domain/model.js";
import { toCanonicalJson, parseFugue } from "../domain/io.js";
import type {
  EngineAdapter,
  AutomationRecord,
  CreateAutomationInput,
} from "../adapter/engine-adapter.js";
import { EngineDown, EngineLocked, EngineDrift } from "../adapter/engine-adapter.js";
import { FakeEngineAdapter, makeFakeClock } from "../adapter/fake-engine-adapter.js";
import { RestAdapter, type RestAdapterClient } from "../adapter/rest-adapter.js";
import { PALETTE_COMMANDS, filterCommands, isCommandEnabled, type PaletteCommand, type PaletteCtx } from "./palette.js";
import { DEFAULT_DRAFT, validateDraft, draftToScheduleSpec, type JobEditorDraft } from "./job-editor.js";
import { renderJobList, jobListViewModel, moveSelection, type JobListOptions } from "./job-list.js";
import { renderEmptyPanel, type EmptyPanelKind } from "./empty.js";

/* ------------------------------------------------------------------ */
/* The Fugue UI state machine                                          */
/* ------------------------------------------------------------------ */

export interface FugueState {
  data: FugueData;
  automations: AutomationRecord[];
  engineLane: "live" | "down" | "locked";
  engineDownReason?: string;
  route: "jobs" | "runs" | "engine" | "dreams";
  selectedJobId: number | null;
  dialog: "closed" | "compose";
}

export const initialState: FugueState = {
  data: emptyData(),
  automations: [],
  engineLane: "live",
  route: "jobs",
  selectedJobId: null,
  dialog: "closed",
};

/* ------------------------------------------------------------------ */
/* The browser storage adapter (the F-1 StoragePort host binding)      */
/* ------------------------------------------------------------------ */

export function createLocalStorageAdapter() {
  let corrupt = false;
  const ls: StorageLike =
    typeof globalThis.localStorage !== "undefined"
      ? (globalThis.localStorage as unknown as StorageLike)
      : ({} as unknown as StorageLike);
  function recoverLocal() {
    try {
      recover(ls);
    } catch {
      corrupt = true;
    }
  }
  function loadLocal() {
    try {
      return load(ls);
    } catch (e) {
      if (e instanceof CorruptStoreError) corrupt = true;
      throw e;
    }
  }
  function saveLocal(bytes: string) {
    save(ls, bytes);
  }
  return {
    load: loadLocal,
    save: saveLocal,
    recover: recoverLocal,
    isCorrupt: () => corrupt,
  };
}

/* ------------------------------------------------------------------ */
/* The browser fetch client (the RestAdapterClient injection point)    */
/* ------------------------------------------------------------------ */

export function createFetchClient(
  baseUrl: string,
  token?: string,
): RestAdapterClient {
  return {
    call: async (method, path, body) => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401) {
        throw new EngineLocked(`engine 401 on ${method} ${path}`);
      }
      const text = await res.text();
      if (!res.ok && res.status >= 500) {
        throw new EngineDown(`engine ${res.status} on ${method} ${path}: ${text.slice(0, 160)}`);
      }
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
    nowMs: () => Date.now(),
  };
}

/* ------------------------------------------------------------------ */
/* Adapter resolution (the F-4 SPIKE lane)                             */
/* ------------------------------------------------------------------ */

export async function resolveAdapter(
  liveClient?: RestAdapterClient,
): Promise<{
  live: EngineAdapter;
  fake: EngineAdapter;
  lane: "live" | "down" | "locked";
  reason?: string;
}> {
  const fake = new FakeEngineAdapter(makeFakeClock(0).now);
  if (!liveClient) {
    return { live: fake, fake, lane: "down", reason: "no live transport injected" };
  }
  try {
    await liveClient.call("GET", "/api/overview");
    const live = new RestAdapter(liveClient);
    return { live, fake, lane: "live" };
  } catch (e) {
    if (e instanceof EngineLocked) {
      return { live: fake, fake, lane: "locked", reason: e.message };
    }
    if (e instanceof EngineDown) {
      return { live: fake, fake, lane: "down", reason: e.message };
    }
    return {
      live: fake,
      fake,
      lane: "down",
      reason: `probe failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/* ------------------------------------------------------------------ */
/* The render entry point                                              */
/* ------------------------------------------------------------------ */

export function render(state: FugueState): string {
  const parts: string[] = [];

  if (state.engineLane === "down") {
    parts.push(renderEmptyPanel("engine-down", state.engineDownReason));
  } else if (state.engineLane === "locked") {
    parts.push(renderEmptyPanel("engine-locked", state.engineDownReason));
  }

  if (state.route === "jobs") {
    const hasAny = state.automations.length > 0 || state.data.jobs.length > 0;
    if (!hasAny) {
      parts.push(renderEmptyPanel("no-jobs"));
    } else {
      parts.push(
        renderJobList(state, {
          automations: state.automations,
          shadow: state.data.jobs,
          selected: state.selectedJobId,
        }),
      );
    }
  } else if (state.route === "runs") {
    if (state.data.runs.length === 0) {
      parts.push(renderEmptyPanel("no-runs"));
    } else {
      parts.push(
        `<section class="fugue-route" data-route="runs" aria-label="Run history">
           <h2>Runs</h2>
           <ul class="fugue-runs">${state.data.runs
             .map((r) => `<li data-run="${r.id}" data-status="${r.status}">${escapeHtml(r.status)}</li>`)
             .join("")}</ul>
         </section>`,
      );
    }
  } else if (state.route === "engine") {
    parts.push(
      `<section class="fugue-route" data-route="engine" aria-label="Engine">
         <h2>Engine</h2>
         <div class="fugue-engine-panel" data-lane="${state.engineLane}">
           <span class="fugue-engine-phase">${escapeHtml(state.engineLane)}</span>
         </div>
       </section>`,
    );
  } else if (state.route === "dreams") {
    parts.push(renderEmptyPanel("no-dreams"));
  }

  if (state.dialog === "compose") {
    parts.push(renderComposeDialog(DEFAULT_DRAFT));
  }

  return parts.join("\n");
}

function renderComposeDialog(d: JobEditorDraft): string {
  const errs = validateDraft(d);
  const field = (
    name: keyof JobEditorDraft,
    label: string,
    type: "text" | "select" = "text",
    options?: readonly string[],
  ) => {
    if (type === "select") {
      return `<label class="fugue-field" data-field="${name}"><span>${label}</span><select data-input="${name}" aria-label="${label}">${(options ?? [])
        .map((o) => `<option value="${o}" ${String(d[name]) === o ? "selected" : ""}>${o}</option>`)
        .join("")}</select>${errs[name] ? `<p class="fugue-field-error" data-error="${name}">${errs[name]}</p>` : ""}</label>`;
    }
    return `<label class="fugue-field" data-field="${name}"><span>${label}</span><input data-input="${name}" value="${escapeHtml(String(d[name]))}" aria-label="${label}" />${errs[name] ? `<p class="fugue-field-error" data-error="${name}">${errs[name]}</p>` : ""}</label>`;
  };
  const valid = Object.keys(errs).length === 0;
  return [
    `<div class="fugue-dialog is-open" role="dialog" aria-modal="true" data-dialog="compose">`,
    `  <div class="fugue-dialog-inner">`,
    `    <h2>New job</h2>`,
    `    <form data-compose-form aria-label="Compose a new job" novalidate>`,
    field("title", "Title"),
    field("prompt", "Prompt"),
    field("scheduleKind", "Schedule", "select", ["cron", "every", "after", "once", "event"]),
    field("scheduleExpr", "Schedule value"),
    field("scheduleMinutes", "Delay (min, once only)"),
    field("mode", "Mode", "select", ["read-only", "standard"]),
    field("model", "Model"),
    field("timezone", "Timezone"),
    field("misfire", "Misfire", "select", ["skip", "catch-up"]),
    field("spendCap", "Spend cap"),
    `      <div class="fugue-dialog-actions">`,
    `        <button type="submit" aria-label="submit" ${valid ? "" : "disabled"}>Create</button>`,
    `        <button type="button" aria-label="cancel">Cancel</button>`,
    `      </div>`,
    `    </form>`,
    `  </div>`,
    `</div>`,
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* The every-transition persistAll (the O-1/O-2 house law)            */
/* ------------------------------------------------------------------ */

export function persistAll(
  state: FugueState,
  adapter: { save: (bytes: string) => void },
): void {
  const data = recomputeNextId(state.data);
  adapter.save(toCanonicalJson(data));
}

/* ------------------------------------------------------------------ */
/* A minimal DOM boot (the F-4 SPIKE stub lane)                       */
/* ------------------------------------------------------------------ */

export async function boot(
  liveClient?: RestAdapterClient,
): Promise<FugueState> {
  const adapter = createLocalStorageAdapter();
  adapter.recover();
  let data: FugueData;
  try {
    data = adapter.load() ?? emptyData();
  } catch {
    data = emptyData();
  }
  const resolved = await resolveAdapter(liveClient);
  const state: FugueState = {
    data,
    automations:
      resolved.lane === "live" ? await safeList(resolved.live) : [],
    engineLane: resolved.lane === "live" ? "live" : resolved.lane,
    engineDownReason: resolved.reason,
    route: "jobs",
    selectedJobId: null,
    dialog: "closed",
  };
  // The every-transition persistAll law: guarded so the DOM-free Lane A
  // (no localStorage global — the Fugue app's bunfig has no DOM
  // preload, the Ostinato law) can drive `boot` + `persistAll` over
  // an in-memory adapter without a real StorageLike.
  try {
    persistAll(state, adapter);
  } catch {
    // No host storage available (the unit lane): the persistence
    // lane is a no-op; the app state still renders (the O-1 law —
    // never a crash, never a blank).
  }
  return state;
}

async function safeList(a: EngineAdapter): Promise<AutomationRecord[]> {
  try {
    return await a.listAutomations();
  } catch {
    return [];
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export { DomainInvariantError, addJob, updateJob, parseFugue, recordEngine };

/* ------------------------------------------------------------------ */
/* The DOM wiring (the ostinato app.ts kin: overlay render + key)     */
/* ------------------------------------------------------------------ */

/** The palette's DOM (the overlay + the 11 P0 command rows).
 *  The filter input + the rows are the ostinato palette kin. */
function renderPalette(app: {
  state: FugueState;
  onCommand: (id: string) => void;
}): void {
  let overlay = document.getElementById("fugue-palette");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "fugue-palette";
    overlay.className = "fugue-palette is-open";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Command palette");
    document.body.append(overlay);
  }
    const ctx: PaletteCtx = {
    selectedJobId: app.state.selectedJobId,
    selectedJobState: null,
    hasData: true, // the palette's enumeration: 11 commands, all shown;
  }
  // Enumerate ALL commands (disabled rows stay visible, dimmed — the
  // ostinato enumeration kin); filter only hides on a non-empty query.
  const cmds = PALETTE_COMMANDS;
  const inner = document.createElement("div");
  inner.className = "fugue-palette-inner";
  const input = document.createElement("input");
  input.className = "fugue-palette-filter";
  input.setAttribute("aria-label", "Filter commands");
  const list = document.createElement("ul");
  list.className = "fugue-palette-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Commands");
  cmds.forEach((c) => {
    const enabled = isCommandEnabled(c.id, ctx);
    const li = document.createElement("li");
    li.className = `fugue-palette-row${enabled ? "" : " is-disabled"}`;
    li.setAttribute("data-cmd", c.id);
    li.setAttribute("role", "option");
    li.setAttribute("aria-disabled", enabled ? "false" : "true");
    const label = document.createElement("span");
    label.className = "fugue-palette-label";
    label.textContent = c.label;
    const hint = document.createElement("span");
    hint.className = "fugue-palette-hint";
    hint.textContent = c.hint ?? "";
    li.append(label, hint);
    if (enabled) {
      li.addEventListener("click", () => {
        document.body.removeChild(overlay!);
        app.onCommand(c.id);
      });
    }
    list.append(li);
  });
  input.oninput = () => {
    const f = input.value.trim().toLowerCase();
    const hits = filterCommands(f, ctx);
    list.replaceChildren();
    for (const c of hits) {
      const enabled = isCommandEnabled(c.id, ctx);
      const li = document.createElement("li");
      li.className = `fugue-palette-row${enabled ? "" : " is-disabled"}`;
      li.setAttribute("data-cmd", c.id);
      const label = document.createElement("span");
      label.className = "fugue-palette-label";
      label.textContent = c.label;
      const hint = document.createElement("span");
      hint.className = "fugue-palette-hint";
      hint.textContent = c.hint ?? "";
      li.append(label, hint);
      list.append(li);
    }
  };
  inner.append(input, list);
  overlay.replaceChildren(inner);
  input.focus();
}

/** Close the palette overlay (Esc / Enter-pick). */
export function closePaletteDom(): void {
  const o = document.getElementById("fugue-palette");
  if (o) document.body.removeChild(o);
}

/** The browser's own main() (index.html loads this module; the module
 *  defines `main` but nothing called it without this, so the page sat
 *  blank — the ostinato main.ts fix). */
export function main(): void {
  const app: { state: FugueState } = { state: { ...initialState } };
  const container = document.getElementById("fugue-app")!;

  function rerender() {
    const state = app.state;
    container.innerHTML = render(state);
    // The every-transition law: every transition ends in persistAll.
    const adapter = createLocalStorageAdapter();
    adapter.recover();
    persistAll(state, adapter);
  }

  function openCompose() {
    app.state.dialog = "compose";
    rerender();
    const form = document.querySelector("[data-compose-form]") as HTMLFormElement | null;
    if (!form) return;
    const draft: JobEditorDraft = { ...DEFAULT_DRAFT };
    // The inline-validation law: re-validate on every field change,
    // update the per-field error lines in place, and flip the submit
    // button's disabled state (the form never reflows; the user sees
    // each field's error as they type).
    form.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement | HTMLSelectElement;
      const name = target.dataset.input;
      if (!name) return;
      (draft as unknown as Record<string, unknown>)[name] =
        name === "scheduleMinutes" || name === "spendCap"
          ? target.value === "off" ? "off" : Number(target.value || 0)
          : target.value;
      // Re-validate over the LATEST draft (fresh errors), patch the
      // per-field error lines in place, and flip the submit button.
      const errs = validateDraft(draft);
      const f2 = document.querySelector("[data-compose-form]") as HTMLFormElement | null;
      if (f2) {
        for (const [n, msg] of Object.entries(errs)) {
          const errEl = f2.querySelector(`[data-error="${n}"]`);
          if (errEl) errEl.textContent = msg;
        }
        const submitBtn = f2.querySelector('button[aria-label="submit"]') as HTMLButtonElement | null;
        if (submitBtn) submitBtn.disabled = Object.keys(errs).length > 0;
      }
    });
    function rebindDialog() {
      const f = document.querySelector("[data-compose-form]") as HTMLFormElement | null;
      if (!f) return;
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const errs = validateDraft(draft);
        if (Object.keys(errs).length > 0) return; // never submits invalid
        const spec = draftToScheduleSpec(draft);
        const res = addJob(
          app.state.data,
          {
            title: draft.title,
            prompt: draft.prompt,
            schedule: spec,
            mode: draft.mode,
            model: draft.model,
            timezone: draft.timezone,
            misfire: draft.misfire,
            spendCap: draft.spendCap,
          },
          Date.now(),
        );
        app.state.data = res.data;
        app.state.dialog = "closed";
        rerender();
        // The live lane: create on the engine when the lane is live.
        if (app.state.engineLane === "live") {
          try {
            await appAdapter.createAutomation({
              title: draft.title,
              prompt: draft.prompt,
              schedule: spec,
              mode: draft.mode,
            });
          } catch {
            // The outbox surfaces the failure (E-02), never a silent
            // success.
          }
        }
      });
      const cancel = f.querySelector('button[aria-label="cancel"]');
      cancel?.addEventListener("click", () => {
        app.state.dialog = "closed";
        rerender();
      });
    }
    rebindDialog();
  }

  // The live adapter (fixture server on 4130 in dev; the runner's
  // engine-client in production, injected through the same seam).
  const appAdapter: EngineAdapter =
    "fetch" in globalThis
      ? new RestAdapter(createFetchClient("http://127.0.0.1:4130"))
      : new FakeEngineAdapter(makeFakeClock(0).now);

  // Boot the app state (the live-lane probe + the degrade lane).
  const bootClient =
    "fetch" in globalThis
      ? createFetchClient("http://127.0.0.1:4130")
      : undefined;
  const resolved = awaitBoot(bootClient);
  app.state = { ...initialState };
  void resolved;

  async function doBoot() {
    const s = await boot(bootClient);
    app.state = s;
    rerender();
  }
  void doBoot();

  // The Ctrl+K palette key.
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      renderPalette({ state: app.state, onCommand: (id) => dispatchCommand(id) });
      return;
    }
    if (e.key === "Escape") {
      const palette = document.getElementById("fugue-palette");
      if (palette) {
        document.body.removeChild(palette);
        return;
      }
      const dialog = document.querySelector('[data-dialog="compose"]');
      if (dialog) {
        app.state.dialog = "closed";
        rerender();
      }
    }
  });

  function dispatchCommand(id: string) {
    const s = app.state;
    switch (id) {
      case "new-job":
        openCompose();
        break;
      case "refresh":
        void doBoot();
        break;
      case "theme":
        document.documentElement.style.colorScheme =
          document.documentElement.style.colorScheme === "dark" ? "light" : "dark";
        break;
      case "help":
        // The key surface hint.
        const notice = document.createElement("div");
        notice.textContent =
          "Ctrl+K palette · ↑/↓ navigate jobs · Enter select · Esc close · j/k scroll";
        notice.className = "fugue-panel";
        container.append(notice);
        break;
      case "run-now":
      case "pause":
      case "resume":
      case "skip":
      case "snooze":
      case "export":
      case "import":
        // The job-scoped + io commands: the F-5/F-8 tickets own the
        // live implementations; F-4 wires the command to a no-op
        // toast so the palette is never a dead end.
        {
          const s2 = document.createElement("div");
          s2.textContent = `${id}: wired (F-5/F-8 lanes)`;
          s2.className = "fugue-panel";
          container.append(s2);
        }
        break;
    }
  }

  void rerender;
}

async function awaitBoot(client?: RestAdapterClient) {
  if (!client) return undefined;
  try {
    await client.call("GET", "/api/overview");
    return "live";
  } catch {
    return "down";
  }
}

// The module-scope bootstrap: index.html loads this as a module; the
// main() call happens when the DOM is ready.
if (typeof document !== "undefined" && document.getElementById("fugue-app")) {
  main();
}
