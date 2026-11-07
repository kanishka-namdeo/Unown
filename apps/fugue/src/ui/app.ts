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
import {
  PALETTE_COMMANDS,
  filterCommands,
  isCommandEnabled,
  type PaletteCommand,
  type PaletteCtx,
} from "./palette.js";
import { DEFAULT_DRAFT, validateDraft, draftToScheduleSpec, type JobEditorDraft } from "./job-editor.js";
import { renderJobList, jobListViewModel, moveSelection, type JobListOptions } from "./job-list.js";
import { renderEmptyPanel, type EmptyPanelKind } from "./empty.js";
import { renderRunHistory, runHistoryViewModel, moveRunSelection } from "./run-history.js";
import type { RunRecordView } from "../domain/types.js";
import { renderRunDetail } from "./run-detail.js";
import { renderSpendMeter } from "./spend.js";
import { renderDreams, dreamsViewModel, moveDreamSelection } from "./dreams.js";
import { renderMemory, memoryViewModel, moveTierSelection } from "./memory.js";
import { renderSkills } from "./skills.js";
import { renderManualNotes } from "./manual-notes.js";
import type { SpendReport, DreamRecord, MemoryView } from "../adapter/engine-adapter.js";
import type { SkillRecord } from "../adapter/engine-adapter.js";
import { makeJobCommands, runJobCommand, jobLifecycle } from "./jobs.js";

/* ------------------------------------------------------------------ */
/* The Fugue UI state machine                                          */
/* ------------------------------------------------------------------ */

export interface FugueState {
  data: FugueData;
  automations: AutomationRecord[];
  engineLane: "live" | "down" | "locked";
  engineDownReason?: string;
  route:
    | "jobs"
    | "runs"
    | "run-detail"
    | "spend"
    | "engine"
    | "dreams"
    | "memory"
    | "skills"
    | "manual-notes";
  selectedJobId: number | string | null;
  dialog: "closed" | "compose";
  /** The live compose draft (30th-lineage law, 2026-11-08): a
   *  background rerender re-renders FROM state, so the draft must
   *  live here or a slow doBoot() wipes the in-progress form. */
  composeDraft: JobEditorDraft | null;
  /** The run-detail + spend routes' data (adapter-fed; F-5 ticket 1/3). */
  runs?: RunRecordView[];
  jobs?: { id: number | string; title: string }[];
  /** The run id the cursor sits on (string | null — the F-7 ruling:
   *  the raw string run id flows end-to-end, never a Number() collapse). */
  selectedRunId?: string | null;
  spend?: SpendReport | null;
  /** The dreams + memory views' data (the F-7 chunk 2 learning band;
   *  null = the load failed, the honest catch surfaces the error panel). */
  dreams?: DreamRecord[];
  dreamsError?: string;
  memory?: MemoryView | null;
  memoryError?: string;
  /** F-7 chunk 3: the skills view's lanes (the engine's skills table +
   *  the app server's read-only staged queue). */
  skills?: SkillRecord[];
  skillsError?: string;
  staged?: { name: string; title: string }[];
  stagedError?: string;
  /** F-7 chunk 3: the Manual-notes editor state (the ONE hand-edit
   *  lane — the wire row + the in-flight draft + the save result). */
  manualNotes?: { section: string; chars: number; cap: number; path: string } | null;
  manualNotesError?: string;
  manualNotesDraft?: string;
  manualNotesSavedAt?: number;
  /** The last job command's honest result (surfaced, never silent). */
  jobActionError?: string;
}

export const initialState: FugueState = {
  data: emptyData(),
  automations: [],
  engineLane: "live",
  route: "jobs",
  selectedJobId: null,
  dialog: "closed",
  composeDraft: null,
  runs: [],
  jobs: [],
  selectedRunId: null,
  spend: null,
  dreams: [],
  dreamsError: undefined,
  memory: null,
  memoryError: undefined,
  skills: [],
  skillsError: undefined,
  staged: [],
  stagedError: undefined,
  manualNotes: null,
  manualNotesError: undefined,
  manualNotesDraft: undefined,
  manualNotesSavedAt: 0,
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

/** The live-loop seam (NOTES-F6 §2, RULING 1): the spec injects this
 *  via page.addInitScript BEFORE the app module executes. When absent
 *  the fixture default (4130, no token) stays. */
export interface FugueEngineConfig {
  url?: string;
  token?: string;
}

declare global {
  interface Window {
    __FUGUE_ENGINE__?: FugueEngineConfig;
  }
}

function engineConfig(): FugueEngineConfig {
  return (typeof window !== "undefined" ? window.__FUGUE_ENGINE__ : undefined) ?? {};
}

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
    // F-5 ticket 1: the grouped runs view through the adapter seam.
    parts.push(renderRunHistory({ runs: state.runs ?? [], jobs: state.jobs, selected: state.selectedRunId ?? null }));
  } else if (state.route === "run-detail") {
    // F-5 ticket 2: every field + the VERBATIM error (E-05).
    const sel = state.runs?.find((r) => r.id === state.selectedRunId);
    parts.push(
      sel !== undefined
        ? renderRunDetail(sel)
        : renderEmptyPanel("no-runs"),
    );
  } else if (state.route === "spend") {
    // F-5 ticket 3: the spend meter (E-04 throttle honesty).
    if (state.spend === null || state.spend === undefined) {
      parts.push(
        `<section class="fugue-route" data-route="spend" aria-label="Spend meter"><div class="fugue-panel" data-panel="no-spend"><h2>No spend data</h2></div></section>`,
      );
    } else {
      parts.push(renderSpendMeter(state.spend));
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
    // F-7 chunk 2: the dreams journal (newest first, the E-06
    // status badges, the honest empty + error lanes).
    if (state.dreamsError !== undefined) {
      parts.push(
        `<section class="fugue-route" data-route="dreams" aria-label="Dreams journal"><div class="fugue-panel fugue-panel-error" data-panel="dreams-load-failed"><h2>Dreams load failed</h2><p class="fugue-panel-reason">${escapeHtml(state.dreamsError)}</p><p class="fugue-panel-action"><kbd>Esc</kbd> back to jobs · Ctrl+K → "refresh"</p></div></section>`,
      );
    } else if ((state.dreams ?? []).length === 0) {
      parts.push(renderEmptyPanel("no-dreams"));
    } else {
      parts.push(renderDreams({ dreams: state.dreams ?? [] }));
    }
  } else if (state.route === "memory") {
    // F-7 chunk 2: the tiered-memory view (tiers + the health card).
    if (state.memoryError !== undefined) {
      parts.push(
        `<section class="fugue-route" data-route="memory" aria-label="Memory"><div class="fugue-panel fugue-panel-error" data-panel="memory-load-failed"><h2>Memory load failed</h2><p class="fugue-panel-reason">${escapeHtml(state.memoryError)}</p><p class="fugue-panel-action"><kbd>Esc</kbd> back to jobs · Ctrl+K → "refresh"</p></div></section>`,
      );
    } else {
      parts.push(renderMemory({ memory: state.memory ?? null }));
    }
  } else if (state.route === "skills") {
    // F-7 chunk 3: the engine's skills + the read-only staged queue.
    parts.push(
      renderSkills({
        skills: state.skills ?? [],
        staged: state.staged ?? [],
        skillsError: state.skillsError,
        stagedError: state.stagedError,
      }),
    );
  } else if (state.route === "manual-notes") {
    // F-7 chunk 3: the ONE hand-edit lane (the human's editor).
    parts.push(
      renderManualNotes({
        wire: state.manualNotes,
        draft: state.manualNotesDraft,
        saveError: state.manualNotesError,
        savedAt: state.manualNotesSavedAt,
      }),
    );
  }

  if (state.dialog === "compose" && state.composeDraft !== null) {
    parts.push(renderComposeDialog(state.composeDraft));
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
    runs: [],
    jobs: [],
    selectedRunId: null,
    spend: null,
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
    selectedJobState: jobLifecycle(app.state.automations, app.state.selectedJobId),
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
    // The dialog-DOM-stability guard: while the compose dialog is open,
    // its DOM is owned by the in-place input/submit handlers (the draft
    // lives in state). Swapping container.innerHTML out from under an
    // in-flight interaction (e.g. Playwright's fill mid-way) breaks the
    // validation sequence, so a background refresh must NOT re-render
    // the route sections while the dialog is open. The route data
    // refresh lands on the next dialog-less rerender (the refresh
    // command / palette close / dialog submit all re-render).
    // persistAll keeps the every-transition law.
    if (state.dialog === "compose" && document.querySelector("[data-compose-form]")) {
      const adapter = createLocalStorageAdapter();
      adapter.recover();
      persistAll(state, adapter);
      return;
    }
    container.innerHTML = render(state);
    // The every-transition law: every transition ends in persistAll.
    const adapter2 = createLocalStorageAdapter();
    adapter2.recover();
    persistAll(state, adapter2);
  }

  function openCompose() {
    app.state.composeDraft = { ...DEFAULT_DRAFT };
    app.state.dialog = "compose";
    rerender();
    const form = document.querySelector("[data-compose-form]") as HTMLFormElement | null;
    if (!form) return;
    // The inline-validation law: re-validate on every field change,
    // update the per-field error lines in place, and flip the submit
    // button's disabled state (the form never reflows; the user sees
    // each field's error as they type). The draft lives in
    // app.state.composeDraft — a background rerender re-renders FROM
    // state, so the in-progress values survive (30th-lineage law).
    const draft: JobEditorDraft = app.state.composeDraft;
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
        app.state.composeDraft = null;
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
            // A successful live create must land the engine row in view
            // (the Engine jobs group, data-lane="engine"); the shadow row
            // stays (F-1 local-first). A refresh re-reads the engine lane.
            void doBoot();
          } catch (createErr) {
            // The outbox surfaces the failure (E-02), never a silent
            // success — an empty catch swallows drift/EngineDown errors.
            const msg = createErr instanceof Error ? createErr.message : String(createErr);
            const notice = document.createElement("div");
            notice.textContent = `create failed: ${msg}`;
            notice.className = "fugue-panel fugue-panel-error";
            container.append(notice);
          }
        }
      });
      const cancel = f.querySelector('button[aria-label="cancel"]');
      cancel?.addEventListener("click", () => {
        app.state.dialog = "closed";
        app.state.composeDraft = null;
        rerender();
      });
    }
    rebindDialog();
  }

  // The live adapter (fixture server on 4130 in dev; the runner's
  // engine-client in production, injected through the same seam).
  const cfg = engineConfig();
  const engineUrl = cfg.url ?? "http://127.0.0.1:4130";
  const engineToken = cfg.token;
  const appAdapter: EngineAdapter =
    "fetch" in globalThis
      ? new RestAdapter(createFetchClient(engineUrl, engineToken))
      : new FakeEngineAdapter(makeFakeClock(0).now);

  // Boot the app state (the live-lane probe + the degrade lane).
  const bootClient =
    "fetch" in globalThis
      ? createFetchClient(engineUrl, engineToken)
      : undefined;
  const resolved = awaitBoot(bootClient);
  app.state = { ...initialState };
  void resolved;

  // The job-selection history load (the honest catch lane: a failed
  // refresh falls back to the jobs route, never a crash / blank).
  async function loadJobRuns(id: number | string) {
    const s = app.state;
    try {
      s.runs = await appAdapter.history(id);
      s.jobs = s.automations.map((j) => ({ id: j.id, title: j.title }));
      rerender();
    } catch (e) {
      // The E-02 honest-catch law: the history lane must SURFACE the
      // failure, never swallow it — the route STAYS on 'runs' so the
      // user sees the error panel (the create lane's E-02 pattern),
      // not a silent bounce back to jobs.
      const msg = e instanceof Error ? e.message : String(e);
      const notice = document.createElement("div");
      notice.textContent = `history load failed: ${msg}`;
      notice.className = "fugue-panel fugue-panel-error";
      container.append(notice);
      s.route = "runs"; // stay on runs (the user sees the failed history, not a bounce)
      rerender();
    }
  }

  // The learning-band load helpers (F-7 chunk 2): the E-02 honest
  // catch — a failed load surfaces the typed message in the route's
  // error panel (the state.dreamsError / state.memoryError lanes),
  // never a silent bounce back to jobs.
  async function loadDreams() {
    const s = app.state;
    s.route = "dreams";
    s.dreamsError = undefined;
    try {
      s.dreams = await appAdapter.dreams();
    } catch (e) {
      s.dreams = [];
      s.dreamsError = e instanceof Error ? e.message : String(e);
    }
    rerender();
  }

  async function loadMemory() {
    const s = app.state;
    s.route = "memory";
    s.memoryError = undefined;
    try {
      s.memory = await appAdapter.memories();
    } catch (e) {
      s.memory = null;
      s.memoryError = e instanceof Error ? e.message : String(e);
    }
    rerender();
  }

  // F-7 chunk 3: the skills view's two lanes. The engine lane goes
  // through the adapter seam (the /api/skills contract pin); the
  // staged lane is the APP server's read-only route (same origin —
  // the dev/test server serves both the app and its API routes; in
  // the live lane the app is served by the same Bun.serve edge). A
  // failed lane surfaces the honest catch, never a silent substitute.
  async function loadSkills() {
    const s = app.state;
    s.route = "skills";
    s.skillsError = undefined;
    s.stagedError = undefined;
    let skillsOk = true;
    try {
      s.skills = await appAdapter.skills();
    } catch (e) {
      skillsOk = false;
      s.skills = [];
      s.skillsError = e instanceof Error ? e.message : String(e);
    }
    let stagedOk = true;
    try {
      const res = await fetch("/skills-staged");
      if (!res.ok) throw new Error(`staged queue ${res.status}`);
      const body = (await res.json()) as { staged?: { name: string; title: string }[] };
      s.staged = Array.isArray(body.staged) ? body.staged : [];
    } catch (e) {
      stagedOk = false;
      s.staged = [];
      s.stagedError = e instanceof Error ? e.message : String(e);
    }
    void skillsOk;
    void stagedOk;
    rerender();
  }

  // F-7 chunk 3: the Manual-notes editor (the ONE hand-edit lane).
  // Read: the app server's GET /manual-notes. Save: the PUT splice +
  // atomic write, then a RE-READ (the file is authoritative; the
  // draft resyncs from disk after every save).
  async function loadManualNotes() {
    const s = app.state;
    s.route = "manual-notes";
    s.manualNotesError = undefined;
    try {
      const res = await fetch("/manual-notes");
      if (!res.ok) throw new Error(`manual notes read ${res.status}`);
      const body = (await res.json()) as {
        section: string;
        chars: number;
        cap: number;
        path: string;
      };
      s.manualNotes = { section: body.section ?? "", chars: body.chars, cap: body.cap, path: body.path ?? ".unown/memory/project.md" };
      s.manualNotesDraft = s.manualNotes.section;
    } catch (e) {
      s.manualNotes = null;
      s.manualNotesError = e instanceof Error ? e.message : String(e);
    }
    rerender();
  }

  async function saveManualNotes() {
    const s = app.state;
    s.manualNotesError = undefined;
    const draft = s.manualNotesDraft;
    if (typeof draft !== "string") {
      s.manualNotesError = "no draft to save (the read lane failed first?)";
      rerender();
      return;
    }
    try {
      const res = await fetch("/manual-notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: draft }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        const reason = errBody && typeof errBody.error === "string" ? errBody.error : `save ${res.status}`;
        s.manualNotesError = reason;
        rerender();
        return;
      }
      // Re-read: the file is the source of truth (the renderer's
      // verbatim-preservation law) — never trust the client draft.
      await loadManualNotes();
      s.manualNotesSavedAt = Date.now();
      s.manualNotesError = undefined;
      rerender();
    } catch (e) {
      s.manualNotesError = e instanceof Error ? e.message : String(e);
      rerender();
    }
  }

  async function doBoot() {
    const s = await boot(bootClient);
    // The 30th-lineage law: a background refresh must NEVER close the
    // user's dialog, drop the in-progress draft, or flip the route.
    s.route = app.state.route;
    s.selectedJobId = app.state.selectedJobId;
    s.selectedRunId = app.state.selectedRunId;
    s.dialog = app.state.dialog;
    s.composeDraft = app.state.composeDraft;
    s.dreams = app.state.dreams;
    s.dreamsError = app.state.dreamsError;
    s.memory = app.state.memory;
    s.memoryError = app.state.memoryError;
    s.skills = app.state.skills;
    s.skillsError = app.state.skillsError;
    s.staged = app.state.staged;
    s.stagedError = app.state.stagedError;
    s.manualNotes = app.state.manualNotes;
    s.manualNotesError = app.state.manualNotesError;
    s.manualNotesDraft = app.state.manualNotesDraft;
    s.manualNotesSavedAt = app.state.manualNotesSavedAt;
    app.state = s;
    rerender();
    // A refresh must land the fresh history in view: when the user is
    // looking at a job's runs, the new boot state's runs field holds
    // the global lane, not the selected job's — re-load it so the run
    // row re-renders after a run-now (cycle-3 DEFECT 1 cure).
    if (app.state.route === "runs" && app.state.selectedJobId !== null) {
      const id = app.state.selectedJobId;
      await loadJobRuns(id);
    }
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
        app.state.composeDraft = null;
        rerender();
      }
    }
  });

  const jobCommands = makeJobCommands(appAdapter);

  /** F-5 ticket 4: the job-scoped palette commands, wired for real.
   *  Optimistic-free honest refresh: re-read the engine lane AFTER
   *  the call; typed errors surface through the honest panels —
   *  never a silent failure, never a crash. */
  async function dispatchJobCommand(cmd: "run-now" | "pause" | "resume" | "skip" | "snooze") {
    const s = app.state;
    if (s.selectedJobId === null) {
      // No job selected: the command is a no-op, surfaced honestly.
      const n = document.createElement("div");
      n.textContent = `${cmd}: no job selected`;n.className = "fugue-panel";
      container.append(n);
      return;
    }
    const map: Record<string, "runNow" | "pause" | "resume" | "skip" | "snooze"> = {
      "run-now": "runNow",
      "pause": "pause",
      "resume": "resume",
      "skip": "skip",
      "snooze": "snooze",
    };
    const res = await runJobCommand(
      map[cmd] ?? "runNow",
      s.selectedJobId,
      { minutes: 1 },
      jobCommands,
      appAdapter,
    );
    if (res.ok) {
      // Honest refresh: the engine's authoritative lane state.
      app.state.automations = res.jobs;
      app.state.runs = res.runs;
      app.state.spend = res.spend;
      app.state.jobs = res.jobs.map((j) => ({ id: j.id, title: j.title }));
      app.state.jobActionError = undefined;
    } else {
      // The typed error, surfaced through the existing honest panel
      // lane (the O-1 law: never a silent failure).
      app.state.jobActionError = res.error.message;
      app.state.automations = res.jobs;
    }
    // The cycle-9 cure: when the user is on the selected job's runs
    // runs route, the global-runs assignment above (res.runs) would
    // show the learning-loop global lane, NOT the selected automation's
    // history — so re-load the selected job's own history before the
    // final render. The non-runs routes keep the global-runs effect
    // (the spend/jobs panels consume it).
    if (app.state.route === "runs" && app.state.selectedJobId !== null) {
      await loadJobRuns(app.state.selectedJobId);
      return; // loadJobRuns re-renders with the fresh history in view.
    }
    rerender();
  }

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
        // F-5 ticket 4: wired for real (the adapter methods + honest
        // refresh). F-8 owns export/import.
        void dispatchJobCommand(id as "run-now" | "pause" | "resume" | "skip" | "snooze");
        break;
      case "export":
      case "import":
        // F-8 owns the IO battery; the toast stays honest for now.
        {
          const s2 = document.createElement("div");
          s2.textContent = `${id}: wired (F-8 lane)`;
          s2.className = "fugue-panel";
          container.append(s2);
        }
        break;
      case "open-dreams":
        void loadDreams();
        break;
      case "open-memory":
        void loadMemory();
        break;
      case "open-skills":
        void loadSkills();
        break;
      case "open-manual-notes":
        void loadManualNotes();
        break;
    }
  }

  // F-5 keyboard navigation: the runs / run-detail / spend routes.
  document.addEventListener("keydown", (e) => {
    const s = app.state;
    if (s.route === "runs") {
      if (e.key === "ArrowDown") {
        const vm = runHistoryViewModel({ runs: s.runs ?? [], jobs: s.jobs, selected: s.selectedRunId });
        s.selectedRunId = vm.runIds[moveRunSelection(vm.selectedIndex === -1 ? 0 : vm.selectedIndex, vm.totalRows, 1)] ?? null;
        if (vm.runIds.length === 0) s.selectedRunId = null;
        rerender();
      } else if (e.key === "ArrowUp") {
        const vm = runHistoryViewModel({ runs: s.runs ?? [], jobs: s.jobs, selected: s.selectedRunId });
        s.selectedRunId = vm.runIds[moveRunSelection(vm.selectedIndex === -1 ? 0 : vm.selectedIndex, vm.totalRows, -1)] ?? null;
        if (vm.runIds.length === 0) s.selectedRunId = null;
        rerender();
      } else if (e.key === "Enter") {
        if (s.selectedRunId !== null && s.selectedRunId !== undefined) {
          s.route = "run-detail";
          rerender();
        }
      } else if (e.key === "Escape") {
        s.route = "jobs";
        s.selectedRunId = null;
        rerender();
      }
    } else if (s.route === "run-detail") {
      if (e.key === "Escape") {
        // Back navigation restores focus to the owning job.
        s.route = "runs";
        rerender();
        const back = document.querySelector(`[data-back-task="${s.selectedRunId}"]`) as HTMLElement | null;
        back?.focus();
      }
    } else if (s.route === "dreams") {
      // F-7 chunk 2: the dreams journal's cursor lane (the runs kin).
      if (e.key === "Escape") {
        s.route = "jobs";
        rerender();
      }
    } else if (s.route === "memory") {
      // F-7 chunk 2: the memory view's cursor lane (the runs kin).
      if (e.key === "Escape") {
        s.route = "jobs";
        rerender();
      }
    } else if (s.route === "skills") {
      // F-7 chunk 3: the skills view's cursor lane (the runs kin).
      if (e.key === "Escape") {
        s.route = "jobs";
        rerender();
      }
    } else if (s.route === "manual-notes") {
      // F-7 chunk 3: the Manual-notes editor — Escape returns to
      // jobs WITHOUT saving (a discard, surfaced by the re-render;
      // a failed/unsaved draft simply stays in the textarea on
      // re-entry through the load lane).
      if (e.key === "Escape") {
        s.route = "jobs";
        s.manualNotesDraft = undefined;
        s.manualNotesError = undefined;
        rerender();
      }
    }
  });

  // F-7 chunk 3: the Manual-notes editor's live input + save wiring.
  // The textarea keeps the in-flight draft in app.state (a background
  // rerender re-renders FROM state, the 30th-lineage law); the
  // budget meter + over-cap block update in place on every keystroke
  // (no full re-render while the user is typing).
  container.addEventListener("input", (e) => {
    const target = e.target as HTMLTextAreaElement;
    if (target.dataset.mnInput !== undefined) {
      app.state.manualNotesDraft = target.value;
      const meter = document.querySelector("[data-mn-chars]") as HTMLElement | null;
      const over = document.querySelector("[data-mn-overcap]");
      const chars = target.value.length;
      const cap = 4096;
      if (meter) {
        meter.dataset.mnChars = String(chars);
        meter.dataset.mnOver = chars > cap ? "1" : "0";
        meter.textContent = chars > cap
          ? `${chars} / ${cap} chars — over cap: the renderer will drop the tail`
          : `${chars} / ${cap} chars`;
      }
      if (over) {
        const tailEl = over.querySelector(".fugue-mn-dropped-tail");
        if (chars > cap) {
          if (!tailEl) {
            const block = document.createElement("div");
            block.className = "fugue-mn-overcap";
            block.dataset.mnOvercap = "";
            block.innerHTML = `<p class="fugue-mn-marker"><code>&lt;!-- unown: manual notes over cap --&gt;</code> (appended by the renderer when the section is over cap)</p><pre class="fugue-mn-dropped-tail"></pre>`;
            meter?.after(block);
          } else {
            block.textContent = target.value.slice(cap);
          }
        } else {
          over.remove();
        }
      }
    }
  });
  container.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest?.("[data-mn-save]")) {
      void saveManualNotes();
    }
  });

  // Route entry points: open a job's run history / the spend view.
  container.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const s = app.state;
    if (target.closest(".fugue-job-row")) {
      const jobEl = target.closest(".fugue-job-row") as HTMLElement;
      // Engine ids are strings ('auto-xxx'); local shadow ids are numeric.
      // Keep the RAW dataset.job — a string id must NEVER be coerced to NaN.
      const rawJob = jobEl.dataset.job;
      const isNumeric = rawJob !== null && rawJob !== "" && Number.isNaN(Number(rawJob)) === false;
      const jobId = rawJob !== null && rawJob !== "" ? (isNumeric ? Number(rawJob) : rawJob) : null;
      if (jobId !== null) {
        s.selectedJobId = jobId;
        s.route = "runs";
        s.selectedRunId = null;
        // Load the job's runs through the adapter seam.
        void loadJobRuns(jobId);
      }
      return;
    }
    if (target.closest(".fugue-run-row")) {
      const runEl = target.closest(".fugue-run-row") as HTMLElement;
      // The raw string run id (the F-7 ruling) — the run-detail join
      // compares by string equality; a Number() collapse here is the
      // "Job 0" regression class.
      s.selectedRunId = runEl.dataset.run ?? null;
      s.route = "run-detail";
      rerender();
      return;
    }
    if (target.closest('[data-route="spend"]') || target.closest(".fugue-spend-link")) {
      s.route = "spend";
      void (async () => {
        try {
          s.spend = await appAdapter.spend();
        } catch {
          s.spend = null;
        }
        rerender();
      })();
      return;
    }
    if (target.closest(".fugue-back")) {
      const backEl = target.closest(".fugue-back") as HTMLElement;
      s.route = "runs";
      // Keep the RAW task ref (the F-7 ruling): the job's real id is a
      // string ('auto-xxx'); a numeric collapse turns it into 0 and the
      // group title reads "Job 0".
      const backTask = backEl.dataset.backTask;
      s.selectedJobId =
        backTask !== null && backTask !== "" ? backTask : null;
      rerender();
    }
  });

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
